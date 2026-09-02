/**
 * 本集绑定跨集道具/场景：资产仍保留原 episode_id，通过 junction 在本集显示与选用。
 */

function ensureEpisodeAssetBindTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS episode_props (
      episode_id INTEGER NOT NULL,
      prop_id INTEGER NOT NULL,
      PRIMARY KEY (episode_id, prop_id)
    );
    CREATE TABLE IF NOT EXISTS episode_scenes (
      episode_id INTEGER NOT NULL,
      scene_id INTEGER NOT NULL,
      PRIMARY KEY (episode_id, scene_id)
    );
  `);
}

function bindPropToEpisode(db, episodeId, propId) {
  const eId = Number(episodeId);
  const pId = Number(propId);
  if (!Number.isFinite(eId) || !Number.isFinite(pId)) return false;
  ensureEpisodeAssetBindTables(db);
  const prop = db
    .prepare('SELECT id, episode_id FROM props WHERE id = ? AND deleted_at IS NULL')
    .get(pId);
  if (!prop) return false;
  // 本集自有道具无需 junction
  if (Number(prop.episode_id) === eId) return true;
  db.prepare('INSERT OR IGNORE INTO episode_props (episode_id, prop_id) VALUES (?, ?)').run(eId, pId);
  return true;
}

function bindSceneToEpisode(db, episodeId, sceneId) {
  const eId = Number(episodeId);
  const sId = Number(sceneId);
  if (!Number.isFinite(eId) || !Number.isFinite(sId)) return false;
  ensureEpisodeAssetBindTables(db);
  const scene = db
    .prepare('SELECT id, episode_id FROM scenes WHERE id = ? AND deleted_at IS NULL')
    .get(sId);
  if (!scene) return false;
  if (Number(scene.episode_id) === eId) return true;
  db.prepare('INSERT OR IGNORE INTO episode_scenes (episode_id, scene_id) VALUES (?, ?)').run(eId, sId);
  return true;
}

function unbindPropFromEpisode(db, episodeId, propId) {
  const eId = Number(episodeId);
  const pId = Number(propId);
  if (!Number.isFinite(eId) || !Number.isFinite(pId)) return false;
  ensureEpisodeAssetBindTables(db);
  const r = db.prepare('DELETE FROM episode_props WHERE episode_id = ? AND prop_id = ?').run(eId, pId);
  // 同时解开本集分镜上的该道具关联，避免幽灵引用
  try {
    db.prepare(
      `DELETE FROM storyboard_props
       WHERE prop_id = ?
         AND storyboard_id IN (
           SELECT id FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL
         )`
    ).run(pId, eId);
  } catch (_) {}
  return r.changes > 0;
}

function unbindSceneFromEpisode(db, episodeId, sceneId) {
  const eId = Number(episodeId);
  const sId = Number(sceneId);
  if (!Number.isFinite(eId) || !Number.isFinite(sId)) return false;
  ensureEpisodeAssetBindTables(db);
  const r = db.prepare('DELETE FROM episode_scenes WHERE episode_id = ? AND scene_id = ?').run(eId, sId);
  try {
    db.prepare(
      `UPDATE storyboards SET scene_id = NULL, updated_at = ?
       WHERE episode_id = ? AND scene_id = ? AND deleted_at IS NULL`
    ).run(new Date().toISOString(), eId, sId);
  } catch (_) {}
  return r.changes > 0;
}

/**
 * 根据本集分镜实际使用的道具/场景，自动写入绑定表（跨集资产才会写入）。
 */
function syncEpisodeAssetBindsFromStoryboards(db, log, episodeId) {
  const eId = Number(episodeId);
  if (!Number.isFinite(eId)) return { props: 0, scenes: 0 };
  ensureEpisodeAssetBindTables(db);

  let propBound = 0;
  let sceneBound = 0;

  const propRows = db
    .prepare(
      `SELECT DISTINCT p.id AS prop_id, p.episode_id AS owner_episode_id
       FROM props p
       INNER JOIN storyboard_props sp ON sp.prop_id = p.id
       INNER JOIN storyboards sb ON sb.id = sp.storyboard_id AND sb.episode_id = ? AND sb.deleted_at IS NULL
       WHERE p.deleted_at IS NULL`
    )
    .all(eId);
  const insProp = db.prepare('INSERT OR IGNORE INTO episode_props (episode_id, prop_id) VALUES (?, ?)');
  for (const row of propRows) {
    if (Number(row.owner_episode_id) === eId) continue;
    const r = insProp.run(eId, Number(row.prop_id));
    if (r.changes) propBound += 1;
  }

  const sceneRows = db
    .prepare(
      `SELECT DISTINCT s.id AS scene_id, s.episode_id AS owner_episode_id
       FROM scenes s
       INNER JOIN storyboards sb ON sb.scene_id = s.id AND sb.episode_id = ? AND sb.deleted_at IS NULL
       WHERE s.deleted_at IS NULL`
    )
    .all(eId);
  const insScene = db.prepare('INSERT OR IGNORE INTO episode_scenes (episode_id, scene_id) VALUES (?, ?)');
  for (const row of sceneRows) {
    if (Number(row.owner_episode_id) === eId) continue;
    const r = insScene.run(eId, Number(row.scene_id));
    if (r.changes) sceneBound += 1;
  }

  if ((propBound || sceneBound) && log) {
    log.info('[本集资产绑定] 已同步跨集引用', {
      episode_id: eId,
      props_bound: propBound,
      scenes_bound: sceneBound,
    });
  }
  return { props: propBound, scenes: sceneBound };
}

module.exports = {
  ensureEpisodeAssetBindTables,
  bindPropToEpisode,
  bindSceneToEpisode,
  unbindPropFromEpisode,
  unbindSceneFromEpisode,
  syncEpisodeAssetBindsFromStoryboards,
};
