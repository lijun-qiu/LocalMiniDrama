/**
 * 提取场景/道具后：用 AI 判断与本剧已有资产是否为「同一处/同一件」，再决定绑定复用。
 * 失败时回退到字符串相似匹配。
 */
const aiClient = require('./aiClient');
const { safeParseAIJSON, extractFirstArray, extractJsonCandidate } = require('../utils/safeJson');
const {
  findReusableDramaScene,
  scoreSceneLocationSimilarity,
  normalizeSceneLocationKey,
} = require('../utils/episodeAssetScope');

function normalizePropNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[（(][^）)]*[）)]/g, '');
}

/**
 * 道具名字符串相似（手机 ↔ 智能手机备忘录）
 */
function scorePropNameSimilarity(existingName, incomingName) {
  const a = normalizePropNameKey(existingName);
  const b = normalizePropNameKey(incomingName);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.length < 2 || b.length < 2) return 0;
  if (a.includes(b)) return 88 + Math.min(10, a.length - b.length);
  if (b.includes(a)) return 72 + Math.min(8, b.length - a.length);
  return 0;
}

function findReusableDramaProp(existingProps, name, opts = {}) {
  const minScore = opts.minScore != null ? Number(opts.minScore) : 70;
  const excludeEpisodeId = opts.excludeEpisodeId != null ? Number(opts.excludeEpisodeId) : null;
  const incoming = String(name || '').trim();
  if (!incoming || !Array.isArray(existingProps) || !existingProps.length) return null;
  let best = null;
  let bestScore = 0;
  for (const p of existingProps) {
    if (excludeEpisodeId != null && Number(p.episode_id) === excludeEpisodeId) continue;
    let score = scorePropNameSimilarity(p.name, incoming);
    if (score <= 0) continue;
    if ((p.local_path && String(p.local_path).trim()) || (p.image_url && String(p.image_url).trim())) {
      score += 15;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best || bestScore < minScore) return null;
  return { prop: best, score: bestScore };
}

function buildSceneMatchSystemPrompt(isEn) {
  if (isEn) {
    return `You match newly extracted story locations to an EXISTING drama scene catalog.
Decide if each NEW location is the SAME physical place as an existing scene (even if names differ, e.g. "apartment" vs "apartment bedroom", "living room" vs "home living room").
Different places must NOT match (library ≠ cafe, outdoor street ≠ indoor apartment).
Return ONLY a JSON array. Each item: {"incoming_index":0,"existing_id":123|null,"same":true|false,"reason":"short"}.
Use existing_id only when same=true. Prefer the more specific existing name when multiple could match.`;
  }
  return `你负责判断「新提取的场景」与「本剧已有场景目录」是否为**同一处物理空间**，以便跨集绑定同一资产、保证画面一致。
即使名称不同，只要是同一地点也应判定相同（例：公寓≈公寓卧室、客厅≈家中客厅、医院走廊≈医院过道）。
明显不同地点不得判同（图书馆≠咖啡馆、室外街道≠室内公寓）。
只返回 JSON 数组，每项：{"incoming_index":0,"existing_id":123或null,"same":true或false,"reason":"简述"}。
仅当 same=true 时填写 existing_id；多个候选时优先更具体且已有图的已有场景。`;
}

function buildPropMatchSystemPrompt(isEn) {
  if (isEn) {
    return `You match newly extracted props to an EXISTING drama prop catalog.
Decide if each NEW prop is the SAME object as an existing prop (even if names differ, e.g. "phone" vs "smartphone memo screenshot", "laptop" vs "library computer" only if clearly the same device in the story).
Different objects must NOT match (phone ≠ computer, map ≠ photo).
Return ONLY a JSON array. Each item: {"incoming_index":0,"existing_id":123|null,"same":true|false,"reason":"short"}.
Use existing_id only when same=true.`;
  }
  return `你负责判断「新提取的道具」与「本剧已有道具目录」是否为**同一件视觉物体**，以便跨集绑定同一资产。
即使名称不同，只要剧中是同一物件也应判定相同（例：手机≈智能手机备忘录截图、信封≈牛皮纸信封）。
不同物体不得判同（手机≠电脑、地图≠照片）。
只返回 JSON 数组，每项：{"incoming_index":0,"existing_id":123或null,"same":true或false,"reason":"简述"}。
仅当 same=true 时填写 existing_id。`;
}

function parseMatchArray(raw, log) {
  if (!raw) return [];
  let text = String(raw).trim()
    .replace(/^```json\s*/gim, '')
    .replace(/^```\s*/gm, '')
    .replace(/```\s*$/gm, '')
    .trim();
  const cand = extractJsonCandidate(text) || text;
  let parsed = null;
  try {
    parsed = safeParseAIJSON(cand, log);
  } catch (_) {
    try {
      parsed = JSON.parse(cand);
    } catch (_) {
      parsed = null;
    }
  }
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.matches)) return parsed.matches;
  if (Array.isArray(parsed.results)) return parsed.results;
  const inner = extractFirstArray(parsed);
  return Array.isArray(inner) ? inner : [];
}

/**
 * @returns {Map<number, number>} incomingIndex -> existingId
 */
function matchRowsToMap(rows, catalogIds) {
  const idSet = new Set((catalogIds || []).map((n) => Number(n)).filter(Number.isFinite));
  const map = new Map();
  for (const row of rows || []) {
    const idx = Number(row.incoming_index ?? row.index);
    if (!Number.isFinite(idx) || idx < 0) continue;
    const same = row.same === true || row.same === 1 || String(row.same).toLowerCase() === 'true';
    const eid = Number(row.existing_id ?? row.id);
    if (!same || !Number.isFinite(eid) || !idSet.has(eid)) continue;
    if (!map.has(idx)) map.set(idx, eid);
  }
  return map;
}

/**
 * AI 批量匹配场景；失败返回空 Map（由调用方回退字符串相似）。
 * @param {Array<{location:string,time?:string,prompt?:string}>} incoming
 * @param {Array<{id:number,location:string,time?:string,episode_id?:number}>} catalog
 */
async function matchScenesWithAi(db, log, incoming, catalog, opts = {}) {
  const list = Array.isArray(incoming) ? incoming : [];
  const cat = Array.isArray(catalog) ? catalog : [];
  if (!list.length || !cat.length) return new Map();

  const isEn = !!opts.isEn;
  const catalogJson = cat.map((s) => ({
    id: Number(s.id),
    location: s.location || '',
    time: s.time || '',
    has_image: !!(s.local_path || s.image_url),
  }));
  const incomingJson = list.map((s, i) => ({
    incoming_index: i,
    location: s.location || '',
    time: s.time || '',
  }));
  const userPrompt = isEn
    ? `EXISTING_SCENES:\n${JSON.stringify(catalogJson, null, 0)}\n\nNEW_SCENES:\n${JSON.stringify(incomingJson, null, 0)}\n\nReturn the JSON array only.`
    : `【本剧已有场景】\n${JSON.stringify(catalogJson, null, 0)}\n\n【新提取场景】\n${JSON.stringify(incomingJson, null, 0)}\n\n请只返回 JSON 数组。`;

  try {
    const raw = await aiClient.generateText(db, log, 'text', userPrompt, buildSceneMatchSystemPrompt(isEn), {
      scene_key: 'scene_extraction',
      model: opts.model || undefined,
      temperature: 0.1,
      max_tokens: 1200,
    });
    const rows = parseMatchArray(raw, log);
    const map = matchRowsToMap(rows, cat.map((s) => s.id));
    log.info('[资产复用] AI 场景匹配完成', { incoming: list.length, catalog: cat.length, matched: map.size });
    return map;
  } catch (err) {
    log.warn('[资产复用] AI 场景匹配失败，将回退字符串相似', { error: err.message });
    return new Map();
  }
}

/**
 * AI 批量匹配道具
 */
async function matchPropsWithAi(db, log, incoming, catalog, opts = {}) {
  const list = Array.isArray(incoming) ? incoming : [];
  const cat = Array.isArray(catalog) ? catalog : [];
  if (!list.length || !cat.length) return new Map();

  const isEn = !!opts.isEn;
  const catalogJson = cat.map((p) => ({
    id: Number(p.id),
    name: p.name || '',
    type: p.type || '',
    description: String(p.description || '').slice(0, 80),
    has_image: !!(p.local_path || p.image_url),
  }));
  const incomingJson = list.map((p, i) => ({
    incoming_index: i,
    name: p.name || '',
    type: p.type || '',
    description: String(p.description || '').slice(0, 80),
  }));
  const userPrompt = isEn
    ? `EXISTING_PROPS:\n${JSON.stringify(catalogJson, null, 0)}\n\nNEW_PROPS:\n${JSON.stringify(incomingJson, null, 0)}\n\nReturn the JSON array only.`
    : `【本剧已有道具】\n${JSON.stringify(catalogJson, null, 0)}\n\n【新提取道具】\n${JSON.stringify(incomingJson, null, 0)}\n\n请只返回 JSON 数组。`;

  try {
    const raw = await aiClient.generateText(db, log, 'text', userPrompt, buildPropMatchSystemPrompt(isEn), {
      scene_key: 'prop_extraction',
      model: opts.model || undefined,
      temperature: 0.1,
      max_tokens: 1200,
    });
    const rows = parseMatchArray(raw, log);
    const map = matchRowsToMap(rows, cat.map((p) => p.id));
    log.info('[资产复用] AI 道具匹配完成', { incoming: list.length, catalog: cat.length, matched: map.size });
    return map;
  } catch (err) {
    log.warn('[资产复用] AI 道具匹配失败，将回退字符串相似', { error: err.message });
    return new Map();
  }
}

/**
 * 合并 AI 匹配与字符串回退：返回 Map(incomingIndex -> existingId)
 */
function mergeSceneMatchWithFallback(aiMap, incoming, catalog, excludeEpisodeId) {
  const map = new Map(aiMap || []);
  for (let i = 0; i < (incoming || []).length; i++) {
    if (map.has(i)) continue;
    const bg = incoming[i];
    const hit = findReusableDramaScene(catalog, bg.location, bg.time, {
      excludeEpisodeId,
      minScore: 70,
    });
    if (hit?.scene?.id) map.set(i, Number(hit.scene.id));
  }
  return map;
}

function mergePropMatchWithFallback(aiMap, incoming, catalog, excludeEpisodeId) {
  const map = new Map(aiMap || []);
  for (let i = 0; i < (incoming || []).length; i++) {
    if (map.has(i)) continue;
    const p = incoming[i];
    const hit = findReusableDramaProp(catalog, p.name, {
      excludeEpisodeId,
      minScore: 70,
    });
    if (hit?.prop?.id) map.set(i, Number(hit.prop.id));
  }
  return map;
}

module.exports = {
  normalizePropNameKey,
  scorePropNameSimilarity,
  findReusableDramaProp,
  matchScenesWithAi,
  matchPropsWithAi,
  mergeSceneMatchWithFallback,
  mergePropMatchWithFallback,
  parseMatchArray,
  matchRowsToMap,
  // re-export for tests
  scoreSceneLocationSimilarity,
  normalizeSceneLocationKey,
};
