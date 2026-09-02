const path = require('path');
const fs = require('fs');

/** 场景图是否为四宫格/四视图合图（不应直接作为视频参考） */
function isSceneFourViewComposite(scene) {
  if (!scene) return false;
  const polished = String(scene.polished_prompt || '').trim();
  const polishedSingle = String(scene.polished_prompt_single || '').trim();
  if (!polished) return false;
  if (polishedSingle && polishedSingle !== polished) {
    // 同时有单图提示词：若当前图更可能是单图则不算四宫格
    const p = polished.toLowerCase();
    if (/2\s*[x×]\s*2|four.?panel|quad|grid layout|四格|四宫格/.test(p)) return true;
    return false;
  }
  const p = polished.toLowerCase();
  return /2\s*[x×]\s*2|four.?panel|quad|grid layout|四格|四宫格|top-left|top-right|bottom-left|bottom-right/.test(p);
}

function pickLatestSceneQuadPanel(db, sceneId, panelIdx = 0) {
  if (!db || sceneId == null) return null;
  const frameType = `quad_panel_${panelIdx}`;
  const row = db
    .prepare(
      `SELECT local_path, image_url FROM image_generations
       WHERE scene_id = ? AND frame_type = ? AND status = 'completed'
       ORDER BY id DESC LIMIT 1`
    )
    .get(Number(sceneId), frameType);
  if (!row) return null;
  return row.local_path || row.image_url || null;
}

/**
 * 确保四宫格场景已拆分为 quad_panel_*（幂等，供历史数据修复）
 */
async function ensureSceneQuadPanelsSplit(db, log, sceneId, storageRoot) {
  if (!db || sceneId == null || !storageRoot) return false;
  if (pickLatestSceneQuadPanel(db, sceneId, 0)) return true;

  const scene = db
    .prepare('SELECT id, drama_id, local_path, image_url, polished_prompt, polished_prompt_single FROM scenes WHERE id = ? AND deleted_at IS NULL')
    .get(Number(sceneId));
  if (!scene?.local_path || !isSceneFourViewComposite(scene)) return false;

  const rel = String(scene.local_path).trim();
  const abs = path.join(storageRoot, rel.replace(/^\//, ''));
  if (!fs.existsSync(abs)) return false;

  let parentRow = db
    .prepare(
      `SELECT * FROM image_generations
       WHERE scene_id = ? AND status = 'completed' AND (frame_type IS NULL OR frame_type = 'quad_grid')
       ORDER BY id DESC LIMIT 1`
    )
    .get(Number(sceneId));

  if (!parentRow) {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO image_generations (drama_id, scene_id, provider, prompt, model, frame_type, image_url, local_path, status, created_at, updated_at, completed_at)
         VALUES (?, ?, 'system', ?, NULL, 'quad_grid', ?, ?, 'completed', ?, ?, ?)`
      )
      .run(scene.drama_id || 0, Number(sceneId), scene.polished_prompt || '', scene.image_url || null, rel, now, now, now);
    parentRow = db.prepare('SELECT * FROM image_generations WHERE id = ?').get(info.lastInsertRowid);
  }

  const { splitQuadGridToImages } = require('../services/imageService');
  try {
    await splitQuadGridToImages(db, log, parentRow, abs, storageRoot, scene.image_url || null);
  } catch (e) {
    log?.warn?.('[sceneRefPicker] split quad panels failed', { scene_id: sceneId, error: e.message });
    return false;
  }
  return !!pickLatestSceneQuadPanel(db, sceneId, 0);
}

/**
 * 视频/全能参考：禁止提交四宫格整图，优先单图或拆分后的首格（establishing wide）。
 * @returns {Promise<{ ref: string|null, isPanel: boolean, isUserRef: boolean }>}
 */
async function pickSceneRefForVideoAsync(db, log, scene, storageRoot) {
  if (!scene) return { ref: null, isPanel: false, isUserRef: false };

  const refImage = scene.ref_image && String(scene.ref_image).trim();
  if (refImage) return { ref: refImage, isPanel: false, isUserRef: true };

  const sceneId = scene.id != null ? Number(scene.id) : null;
  if (sceneId != null && db && isSceneFourViewComposite(scene)) {
    let panelRef = pickLatestSceneQuadPanel(db, sceneId, 0);
    if (!panelRef && storageRoot) {
      await ensureSceneQuadPanelsSplit(db, log, sceneId, storageRoot);
      panelRef = pickLatestSceneQuadPanel(db, sceneId, 0);
    }
    if (panelRef) return { ref: panelRef, isPanel: true, isUserRef: false };
    log?.warn?.('[sceneRefPicker] four-view scene has no splittable panel, skip scene ref for video', {
      scene_id: sceneId,
    });
    return { ref: null, isPanel: false, isUserRef: false };
  }

  const localPath = scene.local_path && String(scene.local_path).trim();
  if (localPath) return { ref: localPath, isPanel: false, isUserRef: false };
  const imageUrl = scene.image_url && String(scene.image_url).trim();
  if (imageUrl) return { ref: imageUrl, isPanel: false, isUserRef: false };
  return { ref: null, isPanel: false, isUserRef: false };
}

/** 同步版：不触发拆分，仅使用已有 panel 或单图 */
function pickSceneRefForVideo(db, log, scene, storageRoot) {
  if (!scene) return { ref: null, isPanel: false, isUserRef: false };

  const refImage = scene.ref_image && String(scene.ref_image).trim();
  if (refImage) return { ref: refImage, isPanel: false, isUserRef: true };

  const sceneId = scene.id != null ? Number(scene.id) : null;
  if (sceneId != null && db && isSceneFourViewComposite(scene)) {
    const panelRef = pickLatestSceneQuadPanel(db, sceneId, 0);
    if (panelRef) return { ref: panelRef, isPanel: true, isUserRef: false };
    log?.warn?.('[sceneRefPicker] four-view scene: skip whole grid for video (no panel yet)', {
      scene_id: sceneId,
    });
    return { ref: null, isPanel: false, isUserRef: false };
  }

  const localPath = scene.local_path && String(scene.local_path).trim();
  if (localPath) return { ref: localPath, isPanel: false, isUserRef: false };
  const imageUrl = scene.image_url && String(scene.image_url).trim();
  if (imageUrl) return { ref: imageUrl, isPanel: false, isUserRef: false };
  return { ref: null, isPanel: false, isUserRef: false };
}

function resolveStorageRoot(cfg) {
  const c = cfg || require('../config').loadConfig();
  const raw = c.storage?.local_path || './data/storage';
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

module.exports = {
  isSceneFourViewComposite,
  pickLatestSceneQuadPanel,
  ensureSceneQuadPanelsSplit,
  pickSceneRefForVideo,
  pickSceneRefForVideoAsync,
  resolveStorageRoot,
};
