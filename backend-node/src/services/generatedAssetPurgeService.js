/**
 * 生成物硬删除：删数据库记录 + 删本地 storage 文件（不做软删除、不保留孤儿缓存）。
 */
const fs = require('fs');
const path = require('path');

function resolveStorageRoot(cfg) {
  const raw = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function normalizeRelPath(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  if (s.startsWith('/static/')) s = s.slice('/static/'.length);
  if (/^https?:\/\//i.test(s)) return null;
  return s.replace(/^\//, '');
}

function deleteLocalRelPath(storageRoot, relPath, log, tag) {
  const rel = normalizeRelPath(relPath);
  if (!rel || !storageRoot) return false;
  const abs = path.join(storageRoot, rel.replace(/\//g, path.sep));
  try {
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      return true;
    }
  } catch (e) {
    try {
      log?.warn?.('[purge] 删除文件失败', { tag, rel, error: e.message });
    } catch (_) {}
  }
  return false;
}

function collectPathsFromStoryboardRow(row) {
  const out = new Set();
  for (const v of [
    row?.local_path,
    row?.image_url,
    row?.composed_image,
    row?.last_frame_local_path,
    row?.last_frame_image_url,
    row?.video_url,
    row?.narration_audio_local_path,
    row?.audio_local_path,
  ]) {
    const rel = normalizeRelPath(v);
    if (rel) out.add(rel);
  }
  return [...out];
}

function collectPathsFromImageRow(row) {
  const out = new Set();
  for (const v of [row?.local_path, row?.image_url]) {
    const rel = normalizeRelPath(v);
    if (rel) out.add(rel);
  }
  return [...out];
}

function collectPathsFromVideoRow(row) {
  const out = new Set();
  for (const v of [row?.local_path, row?.video_url]) {
    const rel = normalizeRelPath(v);
    if (rel) out.add(rel);
  }
  const base = row?.local_path ? String(row.local_path).replace(/\.[^./]+$/, '') : '';
  if (base) {
    out.add(`${base}_narration.mp3`);
    out.add(`${base}_narration.wav`);
    out.add(`${base}_narr.srt`);
    out.add(`${base}_narration.srt`);
  }
  return [...out];
}

function hardDeleteImageGenerationRows(db, log, rows, storageRoot) {
  let files = 0;
  let rowsDeleted = 0;
  for (const row of rows) {
    for (const rel of collectPathsFromImageRow(row)) {
      if (deleteLocalRelPath(storageRoot, rel, log, `image_gen:${row.id}`)) files += 1;
    }
    const r = db.prepare('DELETE FROM image_generations WHERE id = ?').run(row.id);
    rowsDeleted += r.changes;
  }
  return { files, rowsDeleted };
}

function hardDeleteVideoGenerationRows(db, log, rows, storageRoot) {
  let files = 0;
  let rowsDeleted = 0;
  for (const row of rows) {
    for (const rel of collectPathsFromVideoRow(row)) {
      if (deleteLocalRelPath(storageRoot, rel, log, `video_gen:${row.id}`)) files += 1;
    }
    const r = db.prepare('DELETE FROM video_generations WHERE id = ?').run(row.id);
    rowsDeleted += r.changes;
  }
  return { files, rowsDeleted };
}

function placeholders(n) {
  return Array(n).fill('?').join(',');
}

/**
 * 硬删除指定分镜及其全部关联媒体（含已软删除分镜行）。
 */
function hardDeleteStoryboardIds(db, log, storyboardIds, storageRoot) {
  const ids = [...new Set((storyboardIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) {
    return { storyboards: 0, images: 0, videos: 0, files: 0 };
  }
  const ph = placeholders(ids.length);
  let files = 0;

  const sbRows = db.prepare(`SELECT * FROM storyboards WHERE id IN (${ph})`).all(...ids);
  for (const sb of sbRows) {
    for (const rel of collectPathsFromStoryboardRow(sb)) {
      if (deleteLocalRelPath(storageRoot, rel, log, `storyboard:${sb.id}`)) files += 1;
    }
  }

  const imgRows = db.prepare(`SELECT * FROM image_generations WHERE storyboard_id IN (${ph})`).all(...ids);
  const vidRows = db.prepare(`SELECT * FROM video_generations WHERE storyboard_id IN (${ph})`).all(...ids);
  const imgOut = hardDeleteImageGenerationRows(db, log, imgRows, storageRoot);
  const vidOut = hardDeleteVideoGenerationRows(db, log, vidRows, storageRoot);
  files += imgOut.files + vidOut.files;

  db.prepare(`DELETE FROM storyboard_props WHERE storyboard_id IN (${ph})`).run(...ids);
  try {
    db.prepare(`DELETE FROM frame_prompts WHERE storyboard_id IN (${ph})`).run(...ids);
  } catch (_) {}
  try {
    db.prepare(`DELETE FROM storyboard_characters WHERE storyboard_id IN (${ph})`).run(...ids);
  } catch (_) {}

  const sbDel = db.prepare(`DELETE FROM storyboards WHERE id IN (${ph})`).run(...ids);
  return {
    storyboards: sbDel.changes,
    images: imgOut.rowsDeleted,
    videos: vidOut.rowsDeleted,
    files,
  };
}

/** 删除本集全部分镜（含历史软删除行）及关联媒体。 */
function purgeAllEpisodeStoryboards(db, log, episodeId, storageRoot) {
  const epId = Number(episodeId);
  const rows = db.prepare('SELECT id FROM storyboards WHERE episode_id = ?').all(epId);
  const ids = rows.map((r) => r.id);
  const out = hardDeleteStoryboardIds(db, log, ids, storageRoot);
  log?.info?.('[purge] 本集分镜已硬删除', { episode_id: epId, ...out });
  return out;
}

function hardDeleteImageGenerationsWhere(db, log, sql, params, storageRoot) {
  const rows = db.prepare(sql).all(...params);
  return hardDeleteImageGenerationRows(db, log, rows, storageRoot);
}

function hardDeleteVideoGenerationsWhere(db, log, sql, params, storageRoot) {
  const rows = db.prepare(sql).all(...params);
  return hardDeleteVideoGenerationRows(db, log, rows, storageRoot);
}

module.exports = {
  resolveStorageRoot,
  normalizeRelPath,
  deleteLocalRelPath,
  placeholders,
  hardDeleteStoryboardIds,
  purgeAllEpisodeStoryboards,
  hardDeleteImageGenerationsWhere,
  hardDeleteVideoGenerationsWhere,
  hardDeleteImageGenerationRows,
  hardDeleteVideoGenerationRows,
};
