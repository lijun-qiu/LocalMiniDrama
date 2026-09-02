/**
 * 清空本集除剧本正文外的全部生成内容（角色、场景、道具、分镜、图片、视频等）。
 * 硬删除：数据库记录 + 本地 storage 文件，不做软删除。
 */
const { loadConfig } = require('../config');
const {
  resolveStorageRoot,
  purgeAllEpisodeStoryboards,
  hardDeleteImageGenerationsWhere,
  hardDeleteVideoGenerationsWhere,
  deleteLocalRelPath,
  normalizeRelPath,
  placeholders,
} = require('./generatedAssetPurgeService');

function getStorageRoot() {
  return resolveStorageRoot(loadConfig());
}

/** 分镜行 local_path 是否为视频文件（生视频完成时会覆盖 local_path） */
function isVideoRelPath(rel) {
  const s = String(rel || '').trim();
  if (!s) return false;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(s);
}

function collectEntityMediaPaths(row) {
  const out = [];
  for (const v of [row?.local_path, row?.image_url, row?.ref_image]) {
    const rel = normalizeRelPath(v);
    if (rel) out.push(rel);
  }
  if (row?.extra_images) {
    try {
      const arr = typeof row.extra_images === 'string' ? JSON.parse(row.extra_images) : row.extra_images;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const rel = normalizeRelPath(item);
          if (rel) out.push(rel);
        }
      }
    } catch (_) {}
  }
  return out;
}

function hardDeleteCharactersByIds(db, log, ids, storageRoot) {
  if (!ids.length) return { characters: 0, images: 0 };
  const ph = placeholders(ids.length);
  const img = hardDeleteImageGenerationsWhere(
    db,
    log,
    `SELECT * FROM image_generations WHERE character_id IN (${ph})`,
    ids,
    storageRoot
  );
  const rows = db.prepare(`SELECT * FROM characters WHERE id IN (${ph})`).all(...ids);
  for (const row of rows) {
    for (const rel of collectEntityMediaPaths(row)) {
      deleteLocalRelPath(storageRoot, rel, log, `character:${row.id}`);
    }
  }
  const r = db.prepare(`DELETE FROM characters WHERE id IN (${ph})`).run(...ids);
  return { characters: r.changes, images: img.rowsDeleted };
}

function hardDeleteScenesByIds(db, log, ids, storageRoot) {
  if (!ids.length) return { scenes: 0, images: 0, videos: 0 };
  const ph = placeholders(ids.length);
  const img = hardDeleteImageGenerationsWhere(
    db,
    log,
    `SELECT * FROM image_generations WHERE scene_id IN (${ph})`,
    ids,
    storageRoot
  );
  const vid = hardDeleteVideoGenerationsWhere(
    db,
    log,
    `SELECT * FROM video_generations WHERE scene_id IN (${ph})`,
    ids,
    storageRoot
  );
  const rows = db.prepare(`SELECT * FROM scenes WHERE id IN (${ph})`).all(...ids);
  for (const row of rows) {
    for (const rel of collectEntityMediaPaths(row)) {
      deleteLocalRelPath(storageRoot, rel, log, `scene:${row.id}`);
    }
  }
  const r = db.prepare(`DELETE FROM scenes WHERE id IN (${ph})`).run(...ids);
  return { scenes: r.changes, images: img.rowsDeleted, videos: vid.rowsDeleted };
}

function hardDeletePropsByIds(db, log, ids, storageRoot) {
  if (!ids.length) return 0;
  const ph = placeholders(ids.length);
  const rows = db.prepare(`SELECT * FROM props WHERE id IN (${ph})`).all(...ids);
  for (const row of rows) {
    for (const rel of collectEntityMediaPaths(row)) {
      deleteLocalRelPath(storageRoot, rel, log, `prop:${row.id}`);
    }
  }
  const r = db.prepare(`DELETE FROM props WHERE id IN (${ph})`).run(...ids);
  return r.changes;
}

function clearEpisodeExceptScript(db, log, episodeId) {
  const ep = db
    .prepare(
      'SELECT id, drama_id, script_content FROM episodes WHERE id = ? AND deleted_at IS NULL'
    )
    .get(Number(episodeId));
  if (!ep) return null;

  const epId = Number(episodeId);
  const dramaId = Number(ep.drama_id);
  const storageRoot = getStorageRoot();
  const stats = {
    storyboards: 0,
    characters: 0,
    scenes: 0,
    props: 0,
    images: 0,
    videos: 0,
    files: 0,
  };

  const txn = db.transaction(() => {
    const sbPurge = purgeAllEpisodeStoryboards(db, log, epId, storageRoot, { preserveIntro: false });
    stats.storyboards = sbPurge.storyboards;
    stats.images += sbPurge.images;
    stats.videos += sbPurge.videos;
    stats.files += sbPurge.files;

    const sceneRows = db.prepare('SELECT id FROM scenes WHERE episode_id = ?').all(epId);
    const sceneIds = sceneRows.map((r) => r.id);
    if (sceneIds.length > 0) {
      const sc = hardDeleteScenesByIds(db, log, sceneIds, storageRoot);
      stats.scenes = sc.scenes;
      stats.images += sc.images;
      stats.videos += sc.videos;
    }

    const linkedRows = db.prepare('SELECT character_id FROM episode_characters WHERE episode_id = ?').all(epId);
    const charIdsToDelete = [];
    for (const row of linkedRows) {
      const cid = Number(row.character_id);
      const other = db
        .prepare(
          'SELECT COUNT(*) AS n FROM episode_characters WHERE character_id = ? AND episode_id != ?'
        )
        .get(cid, epId);
      if (other && other.n === 0) charIdsToDelete.push(cid);
    }
    if (charIdsToDelete.length > 0) {
      const ch = hardDeleteCharactersByIds(db, log, charIdsToDelete, storageRoot);
      stats.characters = ch.characters;
      stats.images += ch.images;
    }
    db.prepare('DELETE FROM episode_characters WHERE episode_id = ?').run(epId);
    try {
      db.prepare('DELETE FROM episode_props WHERE episode_id = ?').run(epId);
    } catch (_) {}
    try {
      db.prepare('DELETE FROM episode_scenes WHERE episode_id = ?').run(epId);
    } catch (_) {}

    const propRows = db.prepare('SELECT id FROM props WHERE episode_id = ?').all(epId);
    const propIds = propRows.map((r) => r.id);
    if (propIds.length > 0) {
      stats.props = hardDeletePropsByIds(db, log, propIds, storageRoot);
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE episodes SET video_url = NULL, thumbnail = NULL, description = NULL, duration = 0, status = 'draft',
        bgm_local_path = NULL, bgm_music_id = NULL, sfx_local_path = NULL, sfx_music_id = NULL, bgm_video_url = NULL,
        foley_events_json = NULL, foley_status = NULL, foley_error = NULL, foley_video_url = NULL, foley_task_id = NULL,
        updated_at = ?
       WHERE id = ?`
    ).run(now, epId);
  });

  txn();
  log.info('Episode cleared except script (hard delete)', { episode_id: epId, drama_id: dramaId, stats });
  return {
    episode_id: epId,
    drama_id: dramaId,
    script_preserved: true,
    ...stats,
  };
}

const CLEAR_MEDIA_KINDS = new Set(['narration_audio', 'images', 'videos', 'prompts']);

/**
 * 按类型清空本集分镜媒体或提示词（保留分镜文本与角色/场景/道具）。硬删除媒体文件。
 * @param {'narration_audio'|'images'|'videos'|'prompts'} kind
 */
function clearEpisodeMedia(db, log, episodeId, kind) {
  const type = String(kind || '').trim();
  if (!CLEAR_MEDIA_KINDS.has(type)) {
    const err = new Error(`不支持的清除类型: ${type || '(空)'}`);
    err.code = 'INVALID_CLEAR_KIND';
    throw err;
  }

  const ep = db
    .prepare(
      'SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'
    )
    .get(Number(episodeId));
  if (!ep) return null;

  const now = new Date().toISOString();
  const epId = Number(episodeId);
  const storageRoot = getStorageRoot();
  const stats = {
    kind: type,
    storyboards: 0,
    images: 0,
    videos: 0,
    narration_audio: 0,
    prompts: 0,
    files: 0,
  };

  const txn = db.transaction(() => {
    const sbRows = db
      .prepare(
        'SELECT id FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL AND COALESCE(is_intro, 0) = 0'
      )
      .all(epId);
    const sbIds = sbRows.map((r) => r.id);
    stats.storyboards = sbIds.length;
    if (sbIds.length === 0) return;

    const ph = placeholders(sbIds.length);

    if (type === 'prompts') {
      const r = db
        .prepare(
          `UPDATE storyboards SET
             polished_prompt = NULL,
             video_prompt = NULL,
             universal_segment_text = NULL,
             narration_prompt_aligned_at = NULL,
             updated_at = ?
           WHERE id IN (${ph}) AND deleted_at IS NULL`
        )
        .run(now, ...sbIds);
      stats.prompts = r.changes;
      return;
    }

    if (type === 'narration_audio') {
      const epRow = db.prepare('SELECT full_narration_audio_local_path FROM episodes WHERE id = ?').get(episodeId);
      if (epRow?.full_narration_audio_local_path) {
        if (deleteLocalRelPath(storageRoot, epRow.full_narration_audio_local_path, log, `ep${episodeId}:full-narr`)) {
          stats.files += 1;
        }
        db.prepare(
          'UPDATE episodes SET full_narration_audio_local_path = NULL, updated_at = ? WHERE id = ?'
        ).run(now, episodeId);
      }
      const audioRows = db
        .prepare(
          `SELECT id, narration_audio_local_path, audio_local_path FROM storyboards
           WHERE id IN (${ph}) AND deleted_at IS NULL
             AND (narration_audio_local_path IS NOT NULL OR audio_local_path IS NOT NULL)`
        )
        .all(...sbIds);
      for (const row of audioRows) {
        if (deleteLocalRelPath(storageRoot, row.narration_audio_local_path, log, `narration:${row.id}`)) {
          stats.files += 1;
        }
        if (deleteLocalRelPath(storageRoot, row.audio_local_path, log, `dialogue:${row.id}`)) {
          stats.files += 1;
        }
      }
      const r = db
        .prepare(
          `UPDATE storyboards SET narration_audio_local_path = NULL, audio_local_path = NULL, updated_at = ?
           WHERE id IN (${ph}) AND deleted_at IS NULL`
        )
        .run(now, ...sbIds);
      stats.narration_audio = r.changes;
      return;
    }

    if (type === 'images') {
      const img = hardDeleteImageGenerationsWhere(
        db,
        log,
        `SELECT * FROM image_generations WHERE storyboard_id IN (${ph})`,
        sbIds,
        storageRoot
      );
      stats.images = img.rowsDeleted;
      stats.files += img.files;
      const sbMediaRows = db.prepare(`SELECT * FROM storyboards WHERE id IN (${ph})`).all(...sbIds);
      for (const sb of sbMediaRows) {
        for (const rel of [
          sb.local_path,
          sb.image_url,
          sb.composed_image,
          sb.last_frame_local_path,
          sb.last_frame_image_url,
        ]) {
          if (deleteLocalRelPath(storageRoot, rel, log, `sb_image:${sb.id}`)) stats.files += 1;
        }
      }
      db.prepare(
        `UPDATE storyboards SET
           image_url = NULL,
           local_path = NULL,
           composed_image = NULL,
           first_frame_image_id = NULL,
           last_frame_image_id = NULL,
           last_frame_image_url = NULL,
           last_frame_local_path = NULL,
           updated_at = ?
         WHERE id IN (${ph}) AND deleted_at IS NULL`
      ).run(now, ...sbIds);
      return;
    }

    const vid = hardDeleteVideoGenerationsWhere(
      db,
      log,
      `SELECT * FROM video_generations WHERE storyboard_id IN (${ph})`,
      sbIds,
      storageRoot
    );
    stats.videos = vid.rowsDeleted;
    stats.files += vid.files;
    const sbVidRows = db.prepare(`SELECT id, video_url, local_path FROM storyboards WHERE id IN (${ph})`).all(...sbIds);
    const sbIdsVideoLocalPath = [];
    for (const sb of sbVidRows) {
      if (isVideoRelPath(sb.local_path)) {
        sbIdsVideoLocalPath.push(sb.id);
        if (deleteLocalRelPath(storageRoot, sb.local_path, log, `sb_video:${sb.id}`)) stats.files += 1;
      }
      if (deleteLocalRelPath(storageRoot, sb.video_url, log, `sb_video_url:${sb.id}`)) stats.files += 1;
    }
    db.prepare(
      `UPDATE storyboards SET video_url = NULL, updated_at = ?
       WHERE id IN (${ph}) AND deleted_at IS NULL`
    ).run(now, ...sbIds);
    if (sbIdsVideoLocalPath.length > 0) {
      const vph = placeholders(sbIdsVideoLocalPath.length);
      db.prepare(
        `UPDATE storyboards SET local_path = NULL, updated_at = ?
         WHERE id IN (${vph}) AND deleted_at IS NULL`
      ).run(now, ...sbIdsVideoLocalPath);
    }
    db.prepare(
      `UPDATE episodes SET video_url = NULL, thumbnail = NULL, duration = 0,
        bgm_video_url = NULL, foley_video_url = NULL, foley_events_json = NULL,
        foley_status = NULL, foley_error = NULL, foley_task_id = NULL,
        updated_at = ? WHERE id = ?`
    ).run(now, epId);
  });

  txn();
  log.info('Episode media cleared (hard delete)', { episode_id: epId, drama_id: Number(ep.drama_id), stats });
  return {
    episode_id: epId,
    drama_id: Number(ep.drama_id),
    ...stats,
  };
}

module.exports = {
  clearEpisodeExceptScript,
  clearEpisodeMedia,
  CLEAR_MEDIA_KINDS,
};
