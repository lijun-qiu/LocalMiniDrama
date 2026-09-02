/**
 * 每集独立片头分镜：自填旁白 + 共用角色/场景/道具，旁白式生成后可前置合成。
 */
const { syncStoryboardCharacterLinks, parseDramaCharacterIds } = require('./storyboardService');
const { estimateDurationFromSpeechText, collapseNarrationBlankLines } = require('./episodeStoryboardService');
const { resolveFullNarrationLimits } = require('./fullNarrationConstants');
const { collectStoryboardAssetNames } = require('./storyboardImagePromptBundle');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');

function isIntroRow(row) {
  return row && (Number(row.is_intro) === 1 || row.is_intro === true);
}

function attachPropIds(db, sb) {
  if (!sb || sb.id == null) return sb;
  try {
    const links = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').all(sb.id);
    sb.prop_ids = links.map((r) => Number(r.prop_id)).filter((n) => Number.isFinite(n));
  } catch (_) {
    sb.prop_ids = [];
  }
  return sb;
}

function getIntroStoryboardRow(db, episodeId) {
  const epId = Number(episodeId);
  if (!Number.isFinite(epId) || epId <= 0) return null;
  return db
    .prepare(
      `SELECT * FROM storyboards
       WHERE episode_id = ? AND COALESCE(is_intro, 0) = 1 AND deleted_at IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(epId);
}

function getIntroStoryboard(db, episodeId, rowToStoryboard) {
  const row = getIntroStoryboardRow(db, episodeId);
  if (!row) return null;
  const mapped = typeof rowToStoryboard === 'function' ? rowToStoryboard(row) : { ...row };
  mapped.is_intro = 1;
  return attachPropIds(db, mapped);
}

function ensureEpisodeExists(db, episodeId) {
  const ep = db
    .prepare('SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL')
    .get(Number(episodeId));
  if (!ep) {
    const err = new Error('剧集不存在');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return ep;
}

function setStoryboardProps(db, storyboardId, propIds) {
  const sid = Number(storyboardId);
  db.prepare('DELETE FROM storyboard_props WHERE storyboard_id = ?').run(sid);
  const ids = Array.isArray(propIds)
    ? propIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
    : [];
  if (ids.length === 0) return;
  const ins = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
  for (const pid of ids.slice(0, 40)) ins.run(sid, pid);
}

/**
 * Upsert 本集片头分镜（每集最多一条 is_intro=1）。
 */
function upsertIntro(db, log, episodeId, body = {}, rowToStoryboard) {
  const ep = ensureEpisodeExists(db, episodeId);
  const epId = Number(ep.id);
  const now = new Date().toISOString();
  const req = body && typeof body === 'object' ? body : {};

  const narration =
    req.narration !== undefined ? collapseNarrationBlankLines(req.narration) || null : undefined;
  const title = req.title !== undefined ? (req.title != null ? String(req.title).trim() : null) : undefined;
  const description =
    req.description !== undefined
      ? req.description != null
        ? String(req.description).trim()
        : null
      : undefined;
  const action =
    req.action !== undefined ? (req.action != null ? String(req.action).trim() : null) : undefined;
  const atmosphere =
    req.atmosphere !== undefined
      ? req.atmosphere != null
        ? String(req.atmosphere).trim()
        : null
      : undefined;
  const sceneId =
    req.scene_id !== undefined
      ? req.scene_id == null || req.scene_id === ''
        ? null
        : Number(req.scene_id)
      : undefined;

  const characterIds =
    req.character_ids !== undefined
      ? parseDramaCharacterIds(req.character_ids) ?? []
      : req.characters !== undefined
        ? parseDramaCharacterIds(req.characters) ?? []
        : undefined;
  const propIds = req.prop_ids !== undefined ? req.prop_ids : undefined;

  let duration = req.duration !== undefined ? Number(req.duration) : undefined;
  if (narration !== undefined) {
    const narrTrim = String(narration || '').trim();
    if (narrTrim) {
      const drama = db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(ep.drama_id);
      let meta = {};
      try {
        meta = typeof drama?.metadata === 'string' ? JSON.parse(drama.metadata || '{}') : drama?.metadata || {};
      } catch (_) {
        meta = {};
      }
      const limits = resolveFullNarrationLimits(meta.narration_chars_per_sec);
      duration = estimateDurationFromSpeechText(narrTrim, limits);
    }
  }

  let existing = getIntroStoryboardRow(db, epId);
  if (existing) {
    const dupes = db
      .prepare(
        `SELECT id FROM storyboards
         WHERE episode_id = ? AND COALESCE(is_intro, 0) = 1 AND deleted_at IS NULL AND id != ?`
      )
      .all(epId, existing.id);
    for (const d of dupes) {
      db.prepare('UPDATE storyboards SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, d.id);
    }
  }

  if (!existing) {
    const charsJson = characterIds !== undefined ? JSON.stringify(characterIds) : '[]';
    const info = db
      .prepare(
        `INSERT INTO storyboards (
           episode_id, scene_id, storyboard_number, is_intro, title, description, action, atmosphere,
           narration, duration, characters, creation_mode, status, created_at, updated_at
         ) VALUES (?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, 'classic', 'draft', ?, ?)`
      )
      .run(
        epId,
        sceneId !== undefined ? sceneId : null,
        title !== undefined ? title : '片头',
        description !== undefined ? description : null,
        action !== undefined ? action : null,
        atmosphere !== undefined ? atmosphere : null,
        narration !== undefined ? narration : null,
        duration != null && Number.isFinite(duration) ? duration : 6,
        charsJson,
        now,
        now
      );
    existing = db.prepare('SELECT * FROM storyboards WHERE id = ?').get(info.lastInsertRowid);
    if (characterIds !== undefined) {
      syncStoryboardCharacterLinks(db, existing.id, characterIds);
    }
    if (propIds !== undefined) setStoryboardProps(db, existing.id, propIds);
    log?.info?.('[片头] 已创建', { episode_id: epId, storyboard_id: existing.id });
  } else {
    const updates = ['storyboard_number = 0', 'is_intro = 1'];
    const params = [];
    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (action !== undefined) {
      updates.push('action = ?');
      params.push(action);
    }
    if (atmosphere !== undefined) {
      updates.push('atmosphere = ?');
      params.push(atmosphere);
    }
    if (narration !== undefined) {
      const prevNarr = collapseNarrationBlankLines(existing.narration || '') || '';
      const nextNarr = collapseNarrationBlankLines(narration) || '';
      updates.push('narration = ?');
      params.push(nextNarr || null);
      // 旁白未改时不重置配音/提示词对齐，避免一键流程反复清空再生成
      if (prevNarr !== nextNarr) {
        updates.push('narration_prompt_aligned_at = NULL');
        if (req.clear_narration_audio !== false) {
          updates.push('narration_audio_local_path = NULL');
        }
      }
    }
    if (duration !== undefined && Number.isFinite(duration)) {
      updates.push('duration = ?');
      params.push(duration);
    }
    if (sceneId !== undefined) {
      updates.push('scene_id = ?');
      params.push(sceneId);
    }
    if (characterIds !== undefined) {
      updates.push('characters = ?');
      params.push(JSON.stringify(characterIds));
    }
    params.push(now, existing.id);
    db.prepare(
      `UPDATE storyboards SET ${updates.join(', ')}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
    ).run(...params);
    if (characterIds !== undefined) {
      syncStoryboardCharacterLinks(db, existing.id, characterIds);
    }
    if (propIds !== undefined) setStoryboardProps(db, existing.id, propIds);
    existing = db.prepare('SELECT * FROM storyboards WHERE id = ?').get(existing.id);
    log?.info?.('[片头] 已更新', { episode_id: epId, storyboard_id: existing.id });
  }

  try {
    const { syncEpisodeAssetBindsFromStoryboards } = require('./episodeAssetBindService');
    syncEpisodeAssetBindsFromStoryboards(db, log, epId);
  } catch (_) {}

  return getIntroStoryboard(db, epId, rowToStoryboard);
}

/**
 * 按旁白+资产生成片头 image/video 提示词（不依赖全文解说模式开关）。
 */
async function generateIntroPromptsForEpisode(db, log, episodeId, rowToStoryboard, opts = {}) {
  const ep = ensureEpisodeExists(db, episodeId);
  const row = getIntroStoryboardRow(db, ep.id);
  if (!row) {
    const err = new Error('请先保存片头旁白与资产');
    err.code = 'NO_INTRO';
    throw err;
  }
  const narr = (row.narration && String(row.narration).trim()) || '';
  if (!narr) {
    const err = new Error('片头旁白不能为空');
    err.code = 'EMPTY_NARRATION';
    throw err;
  }

  const assetNames = collectStoryboardAssetNames(db, row.id);
  let styleZh = '';
  let styleEn = '';
  try {
    const drama = db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(ep.drama_id);
    let meta = {};
    try {
      meta = typeof drama?.metadata === 'string' ? JSON.parse(drama.metadata || '{}') : drama?.metadata || {};
    } catch (_) {
      meta = {};
    }
    styleZh = String(meta.style || meta.style_zh || opts.style || '').trim();
    styleEn = String(meta.style_en || opts.style || styleZh).trim();
  } catch (_) {}

  const systemPrompt =
    typeof promptI18n.getFullNarrationDualPromptSystemPrompt === 'function'
      ? promptI18n.getFullNarrationDualPromptSystemPrompt({})
      : 'You generate JSON {"polished_prompt":"...","video_prompt":"..."} for one intro title shot with voice-over. Output JSON only.';

  const userPrompt = [
    'TASK: EPISODE_INTRO_DUAL_PROMPTS — return JSON with polished_prompt + video_prompt',
    'This is a TITLE/INTRO shot for a short drama episode (not body storyboard).',
    styleZh ? `【画风】${styleZh}` : null,
    styleEn ? `MANDATORY ART STYLE: ${styleEn}` : null,
    `NARRATION (VO, user-written): ${narr}`,
    row.action ? `ACTION: ${row.action}` : null,
    row.atmosphere ? `ATMOSPHERE: ${row.atmosphere}` : null,
    row.description ? `DESCRIPTION: ${row.description}` : null,
    `ASSETS: ${assetNames || 'none'}`,
    `DURATION_HINT_SEC: ${Number(row.duration) || 6}`,
    'IMAGE_REMINDER: polished_prompt must be STATIC SINGLE-FRAME only.',
    'VIDEO_REMINDER: video_prompt should fit the narration length; no on-screen text/titles unless narration implies it.',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'image_polish',
    max_tokens: 4200,
    temperature: 0.3,
  });

  let polished = '';
  let video = '';
  try {
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    if (m) {
      const obj = JSON.parse(m[0]);
      polished = String(obj.polished_prompt || obj.image_prompt || '').trim();
      video = String(obj.video_prompt || '').trim();
    }
  } catch (_) {}
  if (!polished || polished.length < 10) {
    polished = `Cinematic intro frame. Voice-over mood. ${narr.slice(0, 200)}. ${assetNames || ''}`.trim();
  }
  if (!video || video.length < 12) {
    video = `Slow cinematic push-in intro shot. Narration mood. ${narr.slice(0, 180)}`.trim();
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE storyboards SET
       polished_prompt = ?,
       image_prompt = COALESCE(NULLIF(TRIM(image_prompt), ''), ?),
       video_prompt = ?,
       narration_prompt_aligned_at = ?,
       updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`
  ).run(polished, polished, video, now, now, row.id);

  log?.info?.('[片头] 提示词已生成', {
    episode_id: ep.id,
    storyboard_id: row.id,
    polished_len: polished.length,
    video_len: video.length,
  });

  return getIntroStoryboard(db, ep.id, rowToStoryboard);
}

module.exports = {
  isIntroRow,
  attachPropIds,
  getIntroStoryboardRow,
  getIntroStoryboard,
  upsertIntro,
  generateIntroPromptsForEpisode,
};
