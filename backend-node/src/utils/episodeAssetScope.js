/**
 * 分镜道具/场景：全剧可选，按镜头文本合理分配。
 * - 列表：本集排前，供 AI 选择
 * - 分配：名称/关键词命中 + 冲突族消歧（电脑≠手机）+ 同分优先本集
 */

/** 互斥道具族：同族内一镜只保留最匹配的一条 */
const PROP_KEYWORD_GROUPS = [
  ['电脑', '计算机', '笔记本', '台式机', 'computer', 'laptop', 'desktop', 'pc'],
  ['手机', '智能手机', '电话', 'smartphone', 'cellphone', 'mobile phone', 'phone'],
  ['平板', '平板电脑', 'tablet', 'ipad'],
  ['地图', '导航', 'map', 'gps'],
];

function normalizeScanText(...parts) {
  return parts
    .filter(Boolean)
    .map((p) => String(p))
    .join(' ')
    .toLowerCase();
}

function propCoreName(name) {
  return String(name || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .trim()
    .toLowerCase();
}

function listPropsForStoryboardPrompt(db, dramaId, episodeId) {
  const dId = Number(dramaId);
  const eId = Number(episodeId);
  if (!Number.isFinite(dId)) return [];
  return db
    .prepare(
      `SELECT id, name, type, episode_id FROM props
       WHERE drama_id = ? AND deleted_at IS NULL
       ORDER BY CASE WHEN episode_id = ? THEN 0 ELSE 1 END, id ASC`
    )
    .all(dId, Number.isFinite(eId) ? eId : -1);
}

function listScenesForStoryboardPrompt(db, dramaId, episodeId) {
  const dId = Number(dramaId);
  const eId = Number(episodeId);
  if (!Number.isFinite(dId)) return [];
  return db
    .prepare(
      `SELECT id, location, time, episode_id, image_url, local_path FROM scenes
       WHERE drama_id = ? AND deleted_at IS NULL
       ORDER BY CASE WHEN episode_id = ? THEN 0 ELSE 1 END, location ASC, time ASC`
    )
    .all(dId, Number.isFinite(eId) ? eId : -1);
}

/** @deprecated 兼容旧名：现为全剧列表（本集排前） */
function listPropsForEpisodeScope(db, dramaId, episodeId) {
  return listPropsForStoryboardPrompt(db, dramaId, episodeId);
}

/** @deprecated 兼容旧名：现为全剧列表（本集排前） */
function listScenesForEpisodeScope(db, dramaId, episodeId) {
  return listScenesForStoryboardPrompt(db, dramaId, episodeId);
}

function normalizeSceneLocationKey(location) {
  return String(location || '')
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[（(][^）)]*[）)]/g, '');
}

function sceneHasImage(scene) {
  return !!(
    (scene?.local_path && String(scene.local_path).trim()) ||
    (scene?.image_url && String(scene.image_url).trim())
  );
}

/**
 * 地点名相似度：用于跨集复用（公寓 ↔ 公寓卧室）与分镜绑景。
 * @returns {number} 0–100+
 */
function scoreSceneLocationSimilarity(existingLocation, incomingLocation) {
  const a = normalizeSceneLocationKey(existingLocation);
  const b = normalizeSceneLocationKey(incomingLocation);
  if (!a || !b) return 0;
  if (a === b) return 100;
  // 单字互含误伤太大（如「街」），至少 2 字
  if (a.length < 2 || b.length < 2) return 0;
  if (a.includes(b)) {
    // 已有场景更具体（公寓卧室 ⊃ 公寓）
    return 88 + Math.min(10, a.length - b.length);
  }
  if (b.includes(a)) {
    // 新名更具体（公寓 ⊃ 已有「公」不会到这；公寓卧室 ⊃ 公寓 走上面）
    return 72 + Math.min(8, b.length - a.length);
  }
  return 0;
}

/**
 * 从本剧已有场景中找可复用项（提取场景时避免「公寓/公寓卧室」拆成两个资产）。
 * 不优先本集：跨集一致性更重要；同分偏好有图、名称更长者。
 * @returns {{ scene: object, score: number } | null}
 */
function findReusableDramaScene(existingScenes, location, time, opts = {}) {
  const minScore = opts.minScore != null ? Number(opts.minScore) : 70;
  const excludeEpisodeId = opts.excludeEpisodeId != null ? Number(opts.excludeEpisodeId) : null;
  const incomingLoc = String(location || '').trim();
  if (!incomingLoc || !Array.isArray(existingScenes) || !existingScenes.length) return null;

  const incomingTime = String(time || '').trim().toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const sc of existingScenes) {
    if (excludeEpisodeId != null && Number(sc.episode_id) === excludeEpisodeId) continue;
    let score = scoreSceneLocationSimilarity(sc.location, incomingLoc);
    if (score <= 0) continue;
    const tm = String(sc.time || '').trim().toLowerCase();
    if (tm && incomingTime) {
      if (tm === incomingTime) score += 12;
      else if (incomingTime.includes(tm) || tm.includes(incomingTime)) score += 6;
    }
    if (sceneHasImage(sc)) score += 15;
    // 更长地点名略加分，倾向复用「公寓卧室」而非短名「公寓」
    const locLen = normalizeSceneLocationKey(sc.location).length;
    score += Math.min(6, Math.max(0, locLen - 2) * 0.5);
    if (
      score > bestScore ||
      (score === bestScore && best && normalizeSceneLocationKey(sc.location).length >
        normalizeSceneLocationKey(best.location).length)
    ) {
      bestScore = score;
      best = sc;
    }
  }
  if (!best || bestScore < minScore) return null;
  return { scene: best, score: bestScore };
}

function findPropGroupIndex(text) {
  const t = String(text || '').toLowerCase();
  for (let i = 0; i < PROP_KEYWORD_GROUPS.length; i++) {
    if (PROP_KEYWORD_GROUPS[i].some((k) => t.includes(k.toLowerCase()))) return i;
  }
  return -1;
}

/**
 * 道具相对镜头文本的匹配分。越高越该挂上；负分表示族冲突应剔除。
 */
function scorePropAgainstText(prop, scanText, currentEpisodeId) {
  const name = String(prop.name || '').trim();
  if (!name || !scanText) return 0;
  const nameLower = name.toLowerCase();
  const core = propCoreName(name);
  let score = 0;

  if (scanText.includes(nameLower)) score += 100;
  else if (core.length >= 2 && scanText.includes(core)) score += 80;

  const nameGroup = findPropGroupIndex(nameLower);
  if (nameGroup >= 0) {
    const textSameGroup = PROP_KEYWORD_GROUPS[nameGroup].some((k) =>
      scanText.includes(k.toLowerCase())
    );
    if (textSameGroup) score += 50;
    else {
      // 道具属某设备族，但镜头文本完全未出现该族 → 惩罚（避免手机挂到电脑镜）
      const textInAnyDeviceGroup = PROP_KEYWORD_GROUPS.some((g) =>
        g.some((k) => scanText.includes(k.toLowerCase()))
      );
      if (textInAnyDeviceGroup) score -= 60;
    }
  }

  if (Number(prop.episode_id) === Number(currentEpisodeId)) score += 5;
  return score;
}

/**
 * 从候选道具中按镜头文本合理选出应关联的道具 id 列表。
 */
function allocatePropIds(props, scanText, currentEpisodeId) {
  const text = String(scanText || '').toLowerCase();
  if (!text || !Array.isArray(props) || props.length === 0) return [];

  const scored = props
    .map((p) => ({
      id: Number(p.id),
      name: p.name,
      episode_id: p.episode_id,
      score: scorePropAgainstText(p, text, currentEpisodeId),
      group: findPropGroupIndex(p.name),
    }))
    .filter((x) => Number.isFinite(x.id) && x.score >= 40);

  // 同族只留最高分（同分优先本集已在 score 里体现）
  const bestByGroup = new Map();
  const ungrouped = [];
  for (const item of scored) {
    if (item.group < 0) {
      ungrouped.push(item);
      continue;
    }
    const prev = bestByGroup.get(item.group);
    if (!prev || item.score > prev.score) bestByGroup.set(item.group, item);
  }

  const selected = [...bestByGroup.values(), ...ungrouped];
  selected.sort((a, b) => b.score - a.score || a.id - b.id);
  return selected.map((x) => x.id);
}

function scoreSceneAgainstShot(scene, { location, time, scanText }, currentEpisodeId) {
  const loc = String(scene.location || '').trim().toLowerCase();
  const tm = String(scene.time || '').trim().toLowerCase();
  const shotLoc = String(location || '').trim().toLowerCase();
  const shotTime = String(time || '').trim().toLowerCase();
  const text = String(scanText || '').toLowerCase();
  let score = 0;

  if (loc && shotLoc) {
    const sim = scoreSceneLocationSimilarity(loc, shotLoc);
    if (sim > 0) score += sim;
    // 「公寓卧室」⊃「公寓」且已有参考图：压过本集新建短名精确匹配，保跨集一致性
    if (
      sim >= 88 &&
      normalizeSceneLocationKey(loc).length > normalizeSceneLocationKey(shotLoc).length &&
      sceneHasImage(scene)
    ) {
      score += 20;
    }
  }
  if (loc && text.includes(loc)) score += 40;
  else if (
    shotLoc &&
    loc &&
    normalizeSceneLocationKey(loc).includes(normalizeSceneLocationKey(shotLoc)) &&
    text.includes(shotLoc)
  ) {
    score += 36;
  }
  if (tm && shotTime) {
    if (tm === shotTime) score += 20;
    else if (shotTime.includes(tm) || tm.includes(shotTime)) score += 10;
  }
  if (tm && text.includes(tm)) score += 5;
  if (sceneHasImage(scene)) score += 12;
  // 跨集一致性：有图的具体场景可压过「本集新建的短名空场景」
  if (Number(scene.episode_id) === Number(currentEpisodeId)) score += 8;
  return score;
}

/**
 * 为镜头选择最匹配场景 id；无合适则返回 null。
 */
function allocateSceneId(scenes, shot, currentEpisodeId) {
  if (!Array.isArray(scenes) || scenes.length === 0) return null;
  const location = shot?.location || '';
  const time = shot?.time || '';
  const scanText = normalizeScanText(
    shot?.action,
    shot?.narration,
    shot?.dialogue,
    shot?.description,
    shot?.title,
    location,
    time
  );
  let best = null;
  let bestScore = 0;
  for (const sc of scenes) {
    const score = scoreSceneAgainstShot(sc, { location, time, scanText }, currentEpisodeId);
    if (score > bestScore) {
      bestScore = score;
      best = sc;
    }
  }
  // 至少要有地点命中（>=40）才自动分配，避免乱挂
  if (!best || bestScore < 40) return null;
  return Number(best.id);
}

module.exports = {
  PROP_KEYWORD_GROUPS,
  normalizeScanText,
  normalizeSceneLocationKey,
  listPropsForStoryboardPrompt,
  listScenesForStoryboardPrompt,
  listPropsForEpisodeScope,
  listScenesForEpisodeScope,
  scorePropAgainstText,
  allocatePropIds,
  scoreSceneAgainstShot,
  scoreSceneLocationSimilarity,
  findReusableDramaScene,
  sceneHasImage,
  allocateSceneId,
};
