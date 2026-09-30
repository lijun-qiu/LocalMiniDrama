'use strict';

/**
 * ArcReel propose-character-looks port: LLM reviews episode source and proposes
 * cross-shot looks + missing scenes/props (does NOT invent characters).
 */

const aiClient = require('../aiClient');
const { safeParseAIJSON } = require('../../utils/safeJson');
const episodeWardrobe = require('./episodeWardrobe');
const characterLooks = require('./characterLooks');

const SYSTEM_PROMPT = `你是本集资产完备审查者（ArcReel 衣橱审查）。在 step1 / 正式剧本之前，对照本集原文决定：
1. 是否新增跨镜造型（look）——挂在已有角色下，禁止新建假角色（如「童年阿杰」应是角色「阿杰」的造型「童年」）
2. 本集会用到、但库里还没有的场景与道具

规则：
- 造型只加跨镜稳定外观（换装、持续战损、闪回幼年 vs 成年定装等）。单镜妆伤、一闪光效不加。
- base=角色日常定装，本任务不改 base、不把日常装再登记成 look。
- 非 base 的 description：只写本造型唯一确定的可见服装/发型/配饰（款式+颜色）；禁止剧情词（重生、前世、男主…）。
- **服装必须唯一**：禁止「或」「以及可选」「二选一」并列多种装扮（如「校服或便装」会导致生图服装不一）；原文没写死颜色时也只选一种合理定装写死。
- **禁止相对其他造型比身高/年龄**（如「比童年高」「比成年稍矮」）——只写本造型自身体态（如「高中生体型偏瘦」）。
- 场景/道具：本集明确落脚出镜且会作参考图锚定才登记；路过一笔不登记。命名短而稳定。
- 不改已有条目；角色必须在已有名单里，不 invent 角色。
- 拿不准的放 uncertain，不要假装确定。

只输出一个 JSON 对象（不要 markdown）：
{
  "status": "READY" | "NEED_CONFIRM",
  "looks": [{"character_name":"阿杰","look_id":"童年","description":"浅色短袖短裤，瘦小个子，短发，约8岁小学生体型","reason":"开场闪回幼年"},{"character_name":"阿杰","look_id":"高中","description":"白色短袖校服，深色校裤，短发，清瘦高中生体型","reason":"高中回忆"}],
  "scenes": [{"name":"雨巷","description":"窄巷青石板，湿漉漉","reason":"..."}],
  "props": [{"name":"油纸伞","description":"旧油纸伞，竹骨","reason":"..."}],
  "uncertain": [{"type":"look|scene|prop","candidate":"...","description":"...","why":"..."}],
  "skipped": ["单镜妆伤不登记：..."]
}`;

function normalizeLooks(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((p) => ({
        character_name: String(p.character_name || p.character || p.name || '').trim(),
        look_id: String(p.look_id || p.look || p.id || '').trim(),
        description: characterLooks.sanitizeLookDescription(p.description || ''),
        reason: String(p.reason || '').trim(),
      }))
      .filter((p) => p.character_name && p.look_id && p.look_id !== characterLooks.BASE_LOOK_ID);
  }
  // ArcReel map form: { "阿杰": { "童年": "描述" } }
  if (typeof raw === 'object') {
    const out = [];
    for (const [charName, lookMap] of Object.entries(raw)) {
      if (!lookMap || typeof lookMap !== 'object') continue;
      for (const [lookId, desc] of Object.entries(lookMap)) {
        const rawDesc = typeof desc === 'string' ? desc : String(desc?.description || '');
        out.push({
          character_name: String(charName).trim(),
          look_id: String(lookId).trim(),
          description: characterLooks.sanitizeLookDescription(rawDesc),
          reason: '',
        });
      }
    }
    return out.filter((p) => p.character_name && p.look_id && p.look_id !== characterLooks.BASE_LOOK_ID);
  }
  return [];
}

function normalizeNamed(raw, kind) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((p) => ({
        name: String(p.name || p.id || '').trim(),
        description: String(p.description || '').trim(),
        reason: String(p.reason || '').trim(),
        type: kind,
      }))
      .filter((p) => p.name);
  }
  if (typeof raw === 'object') {
    return Object.entries(raw)
      .map(([name, desc]) => ({
        name: String(name).trim(),
        description: typeof desc === 'string' ? desc.trim() : String(desc?.description || '').trim(),
        reason: '',
        type: kind,
      }))
      .filter((p) => p.name);
  }
  return [];
}

/**
 * Filter proposals that already exist or reference unknown characters.
 */
function filterAgainstInventory(db, dramaId, episodeId, proposal) {
  const chars = episodeWardrobe.listDramaCharacters(db, dramaId, episodeId);
  const byName = new Map(chars.map((c) => [String(c.name || '').trim(), c]));
  const scenes = episodeWardrobe.listEpisodeScenes(db, dramaId, episodeId);
  const props = episodeWardrobe.listEpisodeProps(db, dramaId, episodeId);
  const sceneNames = new Set(scenes.map((s) => String(s.location || '').trim()).filter(Boolean));
  const propNames = new Set(props.map((p) => String(p.name || '').trim()).filter(Boolean));

  const looks = [];
  const skippedLooks = [];
  for (const p of proposal.looks || []) {
    const char = byName.get(p.character_name);
    if (!char) {
      skippedLooks.push({ ...p, reason: 'character_not_found' });
      continue;
    }
    if (characterLooks.isLookRegistered(char, p.look_id)) {
      skippedLooks.push({ ...p, reason: 'already_registered' });
      continue;
    }
    looks.push({ ...p, character_id: char.id });
  }

  const scenesOut = (proposal.scenes || []).filter((s) => !sceneNames.has(s.name));
  const propsOut = (proposal.props || []).filter((p) => !propNames.has(p.name));
  const skippedScenes = (proposal.scenes || []).filter((s) => sceneNames.has(s.name));
  const skippedProps = (proposal.props || []).filter((p) => propNames.has(p.name));

  return {
    looks,
    scenes: scenesOut,
    props: propsOut,
    filtered_out: {
      looks: skippedLooks,
      scenes: skippedScenes,
      props: skippedProps,
    },
  };
}

async function proposeEpisodeAssets(db, log, episodeId, opts = {}) {
  const dramaService = require('../dramaService');
  const ep = db
    .prepare(
      `SELECT id, drama_id, episode_number, script_content, title
       FROM episodes WHERE id = ? AND deleted_at IS NULL`
    )
    .get(Number(episodeId));
  if (!ep) throw new Error('episode not found');
  const drama = dramaService.getDramaById(db, ep.drama_id);
  if (!drama) throw new Error('drama not found');

  const script = String(ep.script_content || '').trim();
  if (!script) throw new Error('episode script is empty');

  const review = episodeWardrobe.getAssetReview(db, ep.drama_id, ep.id);
  const charLines = (review.characters || [])
    .map((c) => {
      const looks = (c.look_ids || []).filter((id) => id !== 'base');
      return `- ${c.name}${looks.length ? `（已有造型: ${looks.join('、')}）` : ''}`;
    })
    .join('\n');
  const sceneLines = (review.scenes || []).map((s) => `- ${s.name}`).join('\n') || '（无）';
  const propLines = (review.props || []).map((p) => `- ${p.name}`).join('\n') || '（无）';

  const userPrompt =
    `项目：${drama.title || ''}\n集数：第 ${ep.episode_number} 集${ep.title ? `（${ep.title}）` : ''}\n` +
    `expected_episode_source_revision：${review.source_revision}\n\n` +
    `【已有角色】（造型必须挂在这些角色下，禁止新建角色名）\n${charLines || '（无——请先提取角色）'}\n\n` +
    `【已有场景】\n${sceneLines}\n\n` +
    `【已有道具】\n${propLines}\n\n` +
    `【本集原文】\n${script.slice(0, 24000)}`;

  const raw = await aiClient.generateText(db, log || { info() {}, warn() {}, error() {} }, 'text', userPrompt, SYSTEM_PROMPT, {
    scene_key: opts.scene_key || 'wardrobe_propose',
    max_tokens: opts.max_tokens || 3500,
    temperature: 0.2,
  });

  let parsed;
  try {
    parsed = safeParseAIJSON(raw, log);
  } catch (e) {
    const err = new Error('AI 提议解析失败: ' + (e.message || 'invalid json'));
    err.code = 'parse_error';
    err.raw = String(raw || '').slice(0, 2000);
    throw err;
  }

  const draft = {
    status: String(parsed?.status || 'READY').toUpperCase() === 'NEED_CONFIRM' ? 'NEED_CONFIRM' : 'READY',
    looks: normalizeLooks(parsed?.looks),
    scenes: normalizeNamed(parsed?.scenes, 'scene'),
    props: normalizeNamed(parsed?.props, 'prop'),
    uncertain: Array.isArray(parsed?.uncertain) ? parsed.uncertain : [],
    skipped: Array.isArray(parsed?.skipped) ? parsed.skipped : [],
  };

  const filtered = filterAgainstInventory(db, ep.drama_id, ep.id, draft);

  return {
    episode: ep.episode_number,
    episode_id: ep.id,
    source_revision: review.source_revision,
    status: draft.uncertain.length ? 'NEED_CONFIRM' : draft.status,
    looks: filtered.looks,
    scenes: filtered.scenes,
    props: filtered.props,
    uncertain: draft.uncertain,
    skipped: draft.skipped,
    filtered_out: filtered.filtered_out,
    inventory: {
      characters: review.characters,
      scenes: review.scenes,
      props: review.props,
      summary: review.summary,
    },
  };
}

module.exports = {
  proposeEpisodeAssets,
  normalizeLooks,
  normalizeNamed,
  filterAgainstInventory,
  SYSTEM_PROMPT,
};
