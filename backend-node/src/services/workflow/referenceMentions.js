'use strict';

/**
 * ArcReel reference-video writing syntax subset:
 * @[名称] | @[角色@造型] | @[角色]{台词} | @[角色%内心独白]{台词} | {旁白}
 * Optional combine: @[角色@造型%内心独白]{台词}
 */

const { BASE_LOOK_ID, splitMentionNameLook } = require('./characterLooks');

const INNER_SUFFIX = '内心独白';

/**
 * Parse one speaker token before {dialogue}: "林北" | "林北@战损" | "林北%内心独白" | "林北@战损%内心独白"
 */
function parseSpeakerToken(token) {
  const raw = String(token || '').trim();
  let innerMonologue = false;
  let body = raw;
  const pct = body.indexOf('%');
  if (pct >= 0) {
    const suffix = body.slice(pct + 1).trim();
    body = body.slice(0, pct).trim();
    if (suffix !== INNER_SUFFIX) {
      return { ok: false, error: `unsupported %suffix: ${suffix}` };
    }
    innerMonologue = true;
  }
  try {
    const { name, look } = splitMentionNameLook(body);
    if (!name) return { ok: false, error: 'empty speaker name' };
    return { ok: true, name, look, innerMonologue };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * @typedef {{ kind: 'asset'|'speech'|'vo', name?: string, look?: string, text?: string, innerMonologue?: boolean, index: number }} MentionHit
 */

/**
 * Extract mentions in order from unit / segment text.
 * @returns {{ hits: MentionHit[], errors: string[] }}
 */
function parseReferenceMentions(text) {
  const src = String(text || '');
  const hits = [];
  const errors = [];

  // @[token]{dialogue} or @[token]：{dialogue}
  const speechRe = /@\[([^\]]+)\]\s*[：:]?\s*\{([^}]*)\}/g;
  let m;
  const speechSpans = [];
  while ((m = speechRe.exec(src)) !== null) {
    const token = m[1];
    const dialogue = m[2];
    const parsed = parseSpeakerToken(token);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }
    speechSpans.push([m.index, m.index + m[0].length]);
    hits.push({
      kind: 'speech',
      name: parsed.name,
      look: parsed.look,
      text: dialogue,
      innerMonologue: parsed.innerMonologue,
      index: m.index,
    });
  }

  // bare {vo} not inside already-matched speech
  const voRe = /\{([^}]*)\}/g;
  while ((m = voRe.exec(src)) !== null) {
    const inside = speechSpans.some(([a, b]) => m.index >= a && m.index < b);
    if (inside) continue;
    hits.push({ kind: 'vo', text: m[1], index: m.index });
  }

  // @[asset] not part of speech form — scan remaining
  const assetRe = /@\[([^\]]+)\]/g;
  while ((m = assetRe.exec(src)) !== null) {
    const insideSpeech = speechSpans.some(([a, b]) => m.index >= a && m.index < b);
    if (insideSpeech) continue;
    // skip if followed by dialogue braces nearby already handled
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 8);
    if (/^\s*[：:]?\s*\{/.test(after)) continue;
    const token = m[1];
    // asset mentions cannot use %内心独白 alone without braces
    if (token.includes('%')) {
      errors.push(`asset mention cannot use % without dialogue braces: ${token}`);
      continue;
    }
    try {
      const { name, look } = splitMentionNameLook(token);
      hits.push({ kind: 'asset', name, look, index: m.index });
    } catch (e) {
      errors.push(e.message);
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return { hits, errors };
}

/**
 * Derive ordered visual references for @图片N (characters with looks; speakers off-screen don't add assets).
 * Scene/prop names are returned as type hints for the caller to resolve.
 */
function deriveVisualReferences(hits) {
  const seen = new Set();
  const refs = [];
  for (const h of hits) {
    if (h.kind === 'vo') continue;
    if (h.kind === 'speech') continue; // speaker mention does not force on-screen ref
    if (h.kind !== 'asset') continue;
    const key = `${h.name}@${h.look || BASE_LOOK_ID}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ name: h.name, look: h.look || BASE_LOOK_ID });
  }
  return refs;
}

/**
 * Render ArcReel mention text into LMD omni speech forms used by video prompts.
 * @[名]{x} → <名>说 {x}
 * @[名%内心独白]{x} → <名>内心独白 {x}
 * {x} → 画外音说 {x}
 * @[名@造型] kept as visual hooks; look stripped from speech name.
 */
/** 心声对应画面硬约束（写死）；只挂在心声句上，不对整段角色封口 */
const INNER_MONOLOGUE_LIP_PHRASE = '嘴唇紧闭，不吐舌、不开口，无发声口部动作。';
const INNER_MONOLOGUE_LIP_INLINE = '【心声画面：嘴唇紧闭，不吐舌、不开口，无发声口部动作】';
/** 同段有心声/旁白时，开口对白句尾显式标记，避免模型整段对口型 */
const SPOKEN_LIP_INLINE = '【开口说话】';
/** 旁白/画外音瞬间：在场角色闭嘴 */
const VO_LIP_INLINE = '【旁白画面：在场角色嘴唇紧闭，不开口、无说话口型】';
/**
 * 心声/旁白 + 对白同段时的节拍硬约束（写在段首）。
 * 视频模型常把角色音色的心声也对口型；用节拍拆开：心声闭嘴、对白才开口。
 */
const MIXED_LIP_BEAT_DIRECTIVE =
  '【口型节拍硬约束】本段若有「内心独白」或「画外音说」：该发音瞬间画面人物必须嘴唇紧闭、不吐舌、不开口、无说话口型；' +
  '仅出现「说 {…}」或带【开口说话】的瞬间，该角色才正常开口口型。' +
  '同一人既有心里话又有对话时：心里话时段闭嘴，对话时段才张嘴；禁止整段跟心声/旁白对口型。';

function formatInnerMonologueSpeech(name, dialogue) {
  return `<${name}>内心独白 {${dialogue}}${INNER_MONOLOGUE_LIP_INLINE}`;
}

function formatSpokenSpeech(name, dialogue, { openMark = false } = {}) {
  const base = `<${name}>说 {${dialogue}}`;
  return openMark ? `${base}${SPOKEN_LIP_INLINE}` : base;
}

function formatVoSpeech(dialogue) {
  return `画外音说 {${dialogue}}${VO_LIP_INLINE}`;
}

function detectSpeechKindsFromMentions(text) {
  const s = String(text || '');
  let hasMono = false;
  let hasSpoken = false;
  let hasVo = false;

  // @[…] mention 形态
  const { hits } = parseReferenceMentions(s);
  for (const h of hits || []) {
    if (h.kind === 'speech') {
      if (h.innerMonologue) hasMono = true;
      else hasSpoken = true;
    }
  }

  // omni 句式
  if (/<[^>\n]{1,24}>内心独白\s*\{/.test(s)) hasMono = true;
  if (/<[^>\n]{1,24}>说\s*\{/.test(s)) hasSpoken = true;
  if (/@\[[^\]]+%内心独白\]\s*[：:]?\s*\{/.test(s)) hasMono = true;
  if (/画外音说\s*\{/.test(s)) hasVo = true;

  // 裸 {旁白}：排除已挂在 说/内心独白/画外音说 后的花括号
  const bareVo = /\{([^}]*)\}/g;
  let m;
  while ((m = bareVo.exec(s)) !== null) {
    const before = s.slice(Math.max(0, m.index - 24), m.index);
    if (/说\s*$|内心独白\s*$|画外音说\s*$/.test(before)) continue;
    if (/<[^\s>]{1,24}>\s*$/.test(before)) continue;
    if (/@\[[^\]]*\]\s*[：:]?\s*$/.test(before)) continue;
    hasVo = true;
    break;
  }

  return { hasMono, hasSpoken, hasVo, needOpenMark: hasMono || hasVo, needBeat: hasMono || hasVo };
}

function ensureMixedLipBeatDirective(text) {
  let out = String(text || '');
  if (!out.trim()) return out;
  if (out.includes('【口型节拍硬约束】')) return out;
  const kinds = detectSpeechKindsFromMentions(out);
  if (!kinds.needBeat) return out;
  return `${MIXED_LIP_BEAT_DIRECTIVE}\n${out}`;
}

function renderMentionsToOmniSpeech(text) {
  let out = String(text || '');
  const kinds = detectSpeechKindsFromMentions(out);
  out = out.replace(/@\[([^\]]+)\]\s*[：:]?\s*\{([^}]*)\}/g, (_, token, dialogue) => {
    const parsed = parseSpeakerToken(token);
    if (!parsed.ok) return formatVoSpeech(dialogue);
    if (parsed.innerMonologue) return formatInnerMonologueSpeech(parsed.name, dialogue);
    return formatSpokenSpeech(parsed.name, dialogue, { openMark: kinds.needOpenMark });
  });
  // Convert remaining bare {…} to VO, skipping already-rendered speech forms
  out = out.replace(/\{([^}]*)\}/g, (full, body, offset) => {
    const before = out.slice(Math.max(0, offset - 24), offset);
    if (/说\s*$|内心独白\s*$|画外音说\s*$/.test(before)) return full;
    if (/<[^\s>]{1,24}>\s*$/.test(before)) return full;
    return formatVoSpeech(body);
  });
  // 已写成「画外音说 {…}」但缺旁白画面标记时补上
  out = out.replace(/画外音说\s*\{([^}]*)\}(?!\s*【旁白画面)/g, (_, body) => formatVoSpeech(body));
  return ensureMixedLipBeatDirective(out);
}

/**
 * 尾部整段闭嘴句：仅当该角色本段只有心声、没有开口对白时才加。
 * 同人既有心声又有对白时不加，避免把对白也封口（心声口型已挂在句尾【心声画面】）。
 */
function innerMonologueLipGuard(hits) {
  const mono = new Set();
  const spoken = new Set();
  for (const h of hits) {
    if (h.kind !== 'speech' || !h.name) continue;
    if (h.innerMonologue) mono.add(h.name);
    else spoken.add(h.name);
  }
  const onlyMono = [...mono].filter((n) => !spoken.has(n));
  if (!onlyMono.length) return '';
  return onlyMono.map((n) => `<${n}>${INNER_MONOLOGUE_LIP_PHRASE}`).join('\n');
}

/**
 * 给已有 `<名>内心独白 {…}` 补【心声画面】；旁白补【旁白画面】；
 * 同段有心声/旁白时给 `<名>说 {…}` 补【开口说话】；段首挂【口型节拍硬约束】。
 * 同人另有对白时不追加整段 `<名>嘴唇紧闭`，对白口型放开。
 * @param {string} text
 */
function appendInnerMonologueLipGuard(text) {
  let out = String(text || '');
  if (!out.trim()) return out;

  out = out.replace(
    /<([^\s>]{1,24})>内心独白\s*\{([^}]*)\}(?!\s*【心声画面)/g,
    (_, name, spoken) => formatInnerMonologueSpeech(name, spoken)
  );

  out = out.replace(/画外音说\s*\{([^}]*)\}(?!\s*【旁白画面)/g, (_, body) => formatVoSpeech(body));

  const kinds = detectSpeechKindsFromMentions(out);
  if (kinds.needOpenMark) {
    out = out.replace(
      /<([^\s>]{1,24})>说\s*\{([^}]*)\}(?!\s*【开口说话)/g,
      (_, name, spoken) => formatSpokenSpeech(name, spoken, { openMark: true })
    );
  }

  const monoNames = new Set();
  const spokenNames = new Set();
  let m;
  const monoRe = /<([^\s>]{1,24})>内心独白\s*\{/g;
  while ((m = monoRe.exec(out))) monoNames.add(m[1]);
  const sayRe = /<([^\s>]{1,24})>说\s*\{/g;
  while ((m = sayRe.exec(out))) spokenNames.add(m[1]);

  let result = out.replace(/\s+$/, '');
  for (const n of monoNames) {
    if (spokenNames.has(n)) continue;
    if (result.includes(`<${n}>嘴唇紧闭`)) continue;
    result += `\n<${n}>${INNER_MONOLOGUE_LIP_PHRASE}`;
  }
  return ensureMixedLipBeatDirective(result);
}

/**
 * Convert Chinese screenplay lines into ArcReel mention syntax.
 * 阿杰：台词 → @[阿杰]{台词}
 * 阿杰（心里话）：… → @[阿杰%内心独白]{…}
 * Leaves existing @[…] untouched.
 */
/**
 * Convert Chinese screenplay lines into ArcReel mention syntax.
 * 阿杰：台词 → @[阿杰]{台词}
 * 阿杰（心里话）：… → @[阿杰%内心独白]{…}
 * Supports multiple speakers on one line; leaves existing @[…] untouched when whole line is already mention-heavy.
 */
function convertChineseScreenplayToMentions(text) {
  const isEpisodeTitle = (name) =>
    /^第\s*[\d一二三四五六七八九十百千两零〇]+\s*集$/.test(String(name || '').trim());

  function convertPlainLine(line) {
    const raw = String(line || '');
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    // Already ArcReel mention syntax — keep (still fix bare 心里话 leftovers)
    if (/@\[/.test(trimmed) && !/[（(]\s*(?:心里话|内心独白)\s*[）)]/.test(trimmed)) {
      return raw;
    }

    // 画外声叙述：厨房外面，母亲的声音远远传来：“找到了吗？”
    const offscreen = trimmed.match(
      /^(.*?)([\u4e00-\u9fffA-Za-z0-9·]{1,8})的声音[^：“"「]{0,30}[：:]\s*[“"「](.+?)[”"」]\s*$/
    );
    if (offscreen) {
      const prefix = String(offscreen[1] || '').trim().replace(/[，,]\s*$/, '');
      const name = offscreen[2].trim();
      const spoken = String(offscreen[3] || '').trim();
      return [prefix, `@[${name}]{${spoken}}`].filter(Boolean).join(' ');
    }
    // 字迹引文：保留叙述，不伪造成说话人
    if (/的字迹\s*[：:]/.test(trimmed)) {
      return raw;
    }

    const markRe =
      /([^\s@【\]{：:（(。！？.!?、，；]{1,24})(?:[（(]\s*(心里话|内心独白)\s*[）)])?\s*[：:]\s*/g;
    const marks = [];
    let m;
    while ((m = markRe.exec(raw)) !== null) {
      const name = m[1].trim();
      if (!name || isEpisodeTitle(name)) continue;
      marks.push({
        index: m.index,
        end: m.index + m[0].length,
        name,
        inner: Boolean(m[2]),
      });
    }
    if (!marks.length) {
      const vo = trimmed.match(/^(旁白|画外音|VO)\s*[：:]\s*(.+)$/i);
      if (vo) return `{${vo[2].trim()}}`;
      return raw;
    }

    const parts = [];
    const prefix = raw.slice(0, marks[0].index).trim();
    if (prefix) parts.push(prefix);
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].end;
      const stop = i + 1 < marks.length ? marks[i + 1].index : raw.length;
      const dialogue = raw.slice(start, stop).trim();
      if (!dialogue) continue;
      const n = marks[i].name;
      if (marks[i].inner) parts.push(`@[${n}%内心独白]{${dialogue}}`);
      else if (/^(旁白|画外音|VO)$/i.test(n)) parts.push(`{${dialogue}}`);
      else parts.push(`@[${n}]{${dialogue}}`);
    }
    return parts.join(' ');
  }

  return String(text || '')
    .split(/\r?\n/)
    .map(convertPlainLine)
    .join('\n');
}

/** Markdown 场次标题：## S01 | … / ## 场景1 / ### 第1场 */
const MD_SCENE_HEADER_RE =
  /^#{2,3}\s+(?:S\s*\d+|场景\s*\d+|第\s*[\d一二三四五六七八九十百千两零〇]+\s*场)\b/i;

/**
 * Prefer 【分场】 / ## S0x 场次块；else blank-line / sentence heuristic.
 * 避免纯空行拆成「一句一段」后被上限截断丢对白。
 */
function splitScreenplayUnits(script) {
  const text = String(script || '').trim();
  if (!text) return [];
  const isTitleOnly = (s) =>
    /^第\s*[\d一二三四五六七八九十百千两零〇]+\s*集\s*$/.test(String(s || '').trim()) ||
    /^#\s+[^#\n]+$/.test(String(s || '').trim()); // 剧名行 # 药盒
  const byScene = text
    .split(/(?=【分场】)/)
    .map((s) => s.trim())
    .filter((s) => s && !isTitleOnly(s));
  if (byScene.length > 1 || (byScene.length === 1 && byScene[0].startsWith('【分场】'))) {
    return byScene;
  }

  // ## S01 | 内景 · …  一类 Markdown 分场
  const lines = text.split(/\r?\n/);
  const mdStarts = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (MD_SCENE_HEADER_RE.test(lines[i].trim())) mdStarts.push(i);
  }
  if (mdStarts.length >= 1) {
    const units = [];
    for (let i = 0; i < mdStarts.length; i += 1) {
      const start = mdStarts[i];
      const end = i + 1 < mdStarts.length ? mdStarts[i + 1] : lines.length;
      const chunk = lines.slice(start, end).join('\n').trim();
      if (chunk && !isTitleOnly(chunk)) units.push(chunk);
    }
    if (units.length) return units;
  }

  const chunks = text
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !isTitleOnly(s));
  if (chunks.length > 1) return chunks;
  return text
    .split(/(?<=[。！？.!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && !isTitleOnly(s));
}

/**
 * Resolve unit / segment @[mentions] → storyboard asset IDs (ArcReel-aligned).
 *
 * Bucket order on name collision: character → scene → prop.
 * - kind=asset → visual bind (scene/prop/character on-screen)
 * - kind=speech → character bind (voice / on-screen speaker; ArcReel excludes speech from
 *   @图片N visual refs, but LMD storyboards.characters still needs the speaker id)
 * - kind=vo → no asset
 * Also: 【分场】location fallback; soft match `<名>` / `@[名` for scenes/props after omni render.
 *
 * @param {string} text
 * @param {{
 *   characters?: Array<{id:number, name?:string}>,
 *   scenes?: Array<{id:number, location?:string}>,
 *   props?: Array<{id:number, name?:string}>,
 * }} catalogs
 */
function resolveAssetBindings(text, catalogs = {}) {
  const chars = Array.isArray(catalogs.characters) ? catalogs.characters : [];
  const scenes = Array.isArray(catalogs.scenes) ? catalogs.scenes : [];
  const props = Array.isArray(catalogs.props) ? catalogs.props : [];

  const byChar = new Map();
  for (const c of chars) {
    const n = String(c?.name || '').trim();
    if (n && !byChar.has(n)) byChar.set(n, c);
  }
  const byScene = new Map();
  for (const s of scenes) {
    const n = String(s?.location || '').trim();
    if (n && !byScene.has(n)) byScene.set(n, s);
  }
  const byProp = new Map();
  for (const p of props) {
    const n = String(p?.name || '').trim();
    if (n && !byProp.has(n)) byProp.set(n, p);
  }

  let src = String(text || '');
  if (src && !/@\[/.test(src) && /[：:]/.test(src)) {
    src = convertChineseScreenplayToMentions(src);
  }

  const { hits } = parseReferenceMentions(src);
  /** @type {Array<{ id:number, name:string, look:string }>} */
  const characterBindings = [];
  const charSeen = new Set();
  /** @type {number[]} */
  const propIds = [];
  const propSeen = new Set();
  let sceneId = null;
  /** @type {string[]} */
  const unresolved = [];

  function addChar(name, look) {
    const c = byChar.get(String(name || '').trim());
    if (!c) return false;
    const lookId = look && look !== BASE_LOOK_ID ? String(look) : BASE_LOOK_ID;
    if (charSeen.has(c.id)) {
      const existing = characterBindings.find((b) => b.id === c.id);
      if (existing && lookId !== BASE_LOOK_ID && existing.look === BASE_LOOK_ID) {
        existing.look = lookId;
      }
      return true;
    }
    charSeen.add(c.id);
    characterBindings.push({
      id: c.id,
      name: String(c.name || name).trim(),
      look: lookId,
    });
    return true;
  }

  function addProp(name) {
    const p = byProp.get(String(name || '').trim());
    if (!p) return false;
    if (!propSeen.has(p.id)) {
      propSeen.add(p.id);
      propIds.push(p.id);
    }
    return true;
  }

  /** Exact location, or @[便利店] → 便利店·童年 */
  function resolveSceneEntry(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    if (byScene.has(n)) return byScene.get(n);
    for (const [loc, s] of byScene) {
      const head = loc.split(/[·•]/)[0].trim();
      if (head === n || loc.startsWith(`${n}·`) || loc.startsWith(`${n}•`)) return s;
    }
    return null;
  }

  function addScene(name) {
    const s = resolveSceneEntry(name);
    if (!s) return false;
    if (sceneId == null) sceneId = s.id;
    return true;
  }

  for (const h of hits) {
    if (h.kind === 'vo') continue;
    if (h.kind === 'speech') {
      if (h.name && !addChar(h.name, h.look)) unresolved.push(h.name);
      continue;
    }
    if (h.kind !== 'asset' || !h.name) continue;
    // collision order mirrors ArcReel (sans product): character → scene → prop
    if (byChar.has(h.name)) {
      addChar(h.name, h.look);
      continue;
    }
    if (resolveSceneEntry(h.name)) {
      addScene(h.name);
      continue;
    }
    if (byProp.has(h.name)) {
      addProp(h.name);
      continue;
    }
    unresolved.push(h.name);
  }

  // LMD 【分场】 header → scene.location (exact, then · prefix, then includes)
  if (sceneId == null) {
    const sceneHeader = src.match(/【分场】\s*([^\n]+)/);
    if (sceneHeader) {
      const locFull = sceneHeader[1].trim();
      const locHint = locFull.split(/[·•]/)[0].trim() || locFull;
      const hit =
        resolveSceneEntry(locFull) ||
        resolveSceneEntry(locHint) ||
        scenes.find((s) => {
          const loc = String(s.location || '').trim();
          if (!loc) return false;
          return (
            loc === locFull ||
            loc === locHint ||
            (locHint.length >= 2 && (loc.includes(locHint) || locFull.includes(loc)))
          );
        });
      if (hit) sceneId = hit.id;
    }
  }

  // Soft bind after omni render: <场景> / <道具> / @[名 (prefix-safe via delimiter)
  // Skip names that already resolved as a higher-priority bucket (character > scene > prop)
  if (sceneId == null) {
    for (const [name, s] of byScene) {
      if (byChar.has(name)) continue;
      if (src.includes(`<${name}>`) || src.includes(`@[${name}]`) || src.includes(`@[${name}@`)) {
        sceneId = s.id;
        break;
      }
      const head = name.split(/[·•]/)[0].trim();
      if (
        head &&
        head.length >= 2 &&
        !byChar.has(head) &&
        (src.includes(`@[${head}]`) || src.includes(`<${head}>`))
      ) {
        sceneId = s.id;
        break;
      }
    }
  }
  for (const [name, p] of byProp) {
    if (propSeen.has(p.id)) continue;
    if (byChar.has(name) || byScene.has(name)) continue;
    if (src.includes(`<${name}>`) || src.includes(`@[${name}]`) || src.includes(`@[${name}@`)) {
      propSeen.add(p.id);
      propIds.push(p.id);
      continue;
    }
    // LLM 常把道具写成白话「奇趣蛋」而不写 @[奇趣蛋] —— 登记名整词出现则软绑
    if (name.length >= 2 && src.includes(name)) {
      propSeen.add(p.id);
      propIds.push(p.id);
    }
  }
  for (const [name, c] of byChar) {
    if (charSeen.has(c.id)) continue;
    if (src.includes(`<${name}>`) || src.includes(`@[${name}]`) || src.includes(`@[${name}@`)) {
      addChar(name, BASE_LOOK_ID);
    }
  }

  return {
    characterIds: characterBindings.map((b) => b.id),
    characterBindings,
    sceneId,
    propIds,
    unresolved,
  };
}

module.exports = {
  INNER_SUFFIX,
  INNER_MONOLOGUE_LIP_PHRASE,
  INNER_MONOLOGUE_LIP_INLINE,
  SPOKEN_LIP_INLINE,
  VO_LIP_INLINE,
  MIXED_LIP_BEAT_DIRECTIVE,
  parseSpeakerToken,
  parseReferenceMentions,
  deriveVisualReferences,
  renderMentionsToOmniSpeech,
  formatInnerMonologueSpeech,
  formatSpokenSpeech,
  formatVoSpeech,
  detectSpeechKindsFromMentions,
  ensureMixedLipBeatDirective,
  innerMonologueLipGuard,
  appendInnerMonologueLipGuard,
  convertChineseScreenplayToMentions,
  splitScreenplayUnits,
  resolveAssetBindings,
  BASE_LOOK_ID,
};
