/**
 * 全能模式 universal_segment_text 统一格式：
 * 【风格锚点】【场景设定】+ 每个子分镜一块【分镜k】【环境音】
 * 台词采用 ArcReel 句式：<角色>说 {原文}（禁止【台词】栏）
 */

/** 写入【场景设定】时须保留的参考图约束（有场景槽位时） */
const DEFAULT_SCENE_NOTE =
  '环境、光影与陈设定性参考 @图片1。若 @图片1 为宫格或多画面拼图，禁止成片复刻其分格或并列布局，仅提取统一的室内空间与光线语义；须单镜头完整连续画面。';

/** @deprecated 兼容旧导出名 */
const DEFAULT_LINE3 = DEFAULT_SCENE_NOTE;

/**
 * 提交视频 API 时追加的音轨硬约束。
 * 禁止在约束文案里写「说 {…}」示例：花括号会被模型/解析器当成真台词念出（曾抽出「台词」「…」）。
 */
const UNIVERSAL_AUDIO_VOICE_SUFFIX =
  '【音轨硬约束】成片人声仅来自【分镜】里角色说话句式中花括号内的原文（一句一段，勿复述）；花括号外的机位/动作描写勿念出；禁止输出【台词】栏；禁止编造额外对白/旁白/闲语；禁止BGM；【环境音】可写低电平现场环境声与动作音效且不得压过人声；除说话句式本身外禁止冗余口型/开口/双唇描写。';

/** 英文画风描述（拉丁字母远多于汉字）——写入中文【风格锚点】会导致口播语言错乱 */
function isLatinHeavyStyle(text) {
  const t = String(text || '');
  if (!t) return false;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  return latin >= 12 && latin > cjk;
}

/** 去掉【风格锚点】首行里混入的英文 style dump，保留中文画风（分镜落库 / 视频提交共用） */
function sanitizeChineseOmniStyleAnchor(prompt) {
  if (!/【风格锚点】/.test(prompt || '')) return prompt;
  return String(prompt).replace(
    /(【风格锚点】\s*\n)([^\n【]*)/,
    (_, head, bodyLine) => {
      let line = String(bodyLine || '');
      line = line.replace(/[，,]\s*(?=[A-Za-z])[A-Za-z0-9 ,.\-/&'%]+/g, '');
      line = line.replace(/\s+[A-Za-z][A-Za-z0-9 ,.\-/&'%]{15,}\s*$/g, '');
      line = line.replace(/[，,。.]\s*$/g, '').trim();
      return `${head}${line}`;
    }
  );
}

/** 【分镜】/【环境音】中易诱发提前人声的隐喻（有对白拍也删） */
const SPEECH_METAPHOR_RE =
  /仿佛说出了[^，。；、！？\n]{0,48}|仿佛在[讲说]着?[^，。；、！？\n]{0,24}|说出了[^，。；、！？\n]{0,36}|(?:^|[，、；\s])说出(?![「"』{])[^，。；、！？\n]{0,24}|喃喃(?:自语)?|低声细语|低语|自言自语|掷地有声/g;

/** 口型/开口描写（非说话句式行时删除；ArcReel 句式本身已隐含口型） */
const MOUTH_CUE_RE =
  /口型(?:开合|同步|说话|与下列【台词】同步|仅与下列【台词】同步)?|开口(?:说话|讲话)?|吐字|在说话|正在说|双唇(?:开合|闭合)|嘴唇开合|嘴唇微张|张嘴|勿额外开口|口型同步说出/g;

/** ArcReel 说话句式 */
const SPEECH_MARK_RE = /<(?<name>[^\s>]{1,24})>说\s*\{(?<text>[^}]{1,200})\}/g;
const VO_SPEECH_MARK_RE = /画外音说\s*\{(?<text>[^}]{1,200})\}/g;
const AT_SPEECH_BRACE_RE = /@图片(?<n>\d+)\s*说\s*\{(?<text>[^}]{1,200})\}/g;

function cleanupScrubbedClause(s) {
  return String(s || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，、；]{2,}/g, '，')
    .replace(/^[，、；。！？\s]+/g, '')
    .replace(/[，、；\s]+$/g, '')
    .replace(/([。！？])\1+/g, '$1')
    .trim();
}

/** 行内是否含可听见台词（ArcReel 花括号 或 旧引号） */
function lineHasSpokenDialogueMark(line) {
  const s = String(line || '');
  if (/<[^\s>]{1,24}>说\s*\{[^}]{1,200}\}/.test(s)) return true;
  if (/画外音说\s*\{[^}]{1,200}\}/.test(s)) return true;
  if (/@图片\d+\s*说\s*\{[^}]{1,200}\}/.test(s)) return true;
  if (/[「"『][^」"'』]{1,120}[」"'』]/.test(s)) return true;
  return false;
}

/** @deprecated 兼容旧名 */
function lineHasQuoteDialogue(line) {
  return lineHasSpokenDialogueMark(line);
}

function stripSpeechCuesFromLine(line, { silentBeat, keepMouthNearQuote }) {
  let s = String(line || '');
  s = s.replace(new RegExp(SPEECH_METAPHOR_RE.source, 'gu'), '');
  // ArcReel 句式已隐含口型：整行统一去掉口型类描述，避免「口型 + 说 {}」双写
  if (silentBeat || !keepMouthNearQuote || !lineHasSpokenDialogueMark(s) || /说\s*\{/.test(s)) {
    s = s.replace(new RegExp(MOUTH_CUE_RE.source, 'gu'), '');
  }
  return cleanupScrubbedClause(s);
}

/**
 * 按子分镜清洗：口型仅保留在含台词标记的行（随后再统一剥口型，只留说{}）；整段删除旧版【台词】栏。
 */
function scrubSpeechCueInShotAndEnv(lines) {
  const beats = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const headed = lines[i].match(/^【([^】]+)】/);
    const title = headed ? headed[1] : '';
    if (/^分镜\d+/.test(title)) {
      if (cur) beats.push(cur);
      cur = {
        shotIdx: i,
        bodyStart: i + 1,
        bodyEnd: -1,
        dialogueStart: -1,
        envStart: -1,
        hasShotQuote: false,
      };
      continue;
    }
    if (!cur) {
      if (title === '台词') {
        lines[i] = null;
        let j = i + 1;
        while (j < lines.length && !/^【/.test(lines[j] || '')) {
          lines[j] = null;
          j++;
        }
      }
      continue;
    }
    if (title === '台词') {
      if (cur.bodyEnd < 0) cur.bodyEnd = i;
      cur.dialogueStart = i;
      continue;
    }
    if (title === '环境音') {
      if (cur.bodyEnd < 0) cur.bodyEnd = i;
      cur.envStart = i;
      continue;
    }
    if (title) {
      if (cur.bodyEnd < 0) cur.bodyEnd = i;
      beats.push(cur);
      cur = null;
      continue;
    }
    if (cur.dialogueStart < 0 && cur.envStart < 0 && lineHasSpokenDialogueMark(lines[i])) {
      cur.hasShotQuote = true;
    }
  }
  if (cur) {
    if (cur.bodyEnd < 0) cur.bodyEnd = cur.dialogueStart >= 0 ? cur.dialogueStart : cur.envStart >= 0 ? cur.envStart : lines.length;
    beats.push(cur);
  }

  for (let b = 0; b < beats.length; b++) {
    const beat = beats[b];
    const nextShot = b + 1 < beats.length ? beats[b + 1].shotIdx : lines.length;
    if (beat.bodyEnd < 0) {
      beat.bodyEnd =
        beat.dialogueStart >= 0 ? beat.dialogueStart : beat.envStart >= 0 ? beat.envStart : nextShot;
    }
    const silentBeat = !beat.hasShotQuote;

    for (let i = beat.bodyStart; i < beat.bodyEnd; i++) {
      if (!lines[i] || /^【/.test(lines[i])) continue;
      lines[i] =
        stripSpeechCuesFromLine(lines[i], {
          silentBeat,
          keepMouthNearQuote: !silentBeat,
        }) || '';
    }
    if (beat.dialogueStart >= 0) {
      const dlgEnd = beat.envStart >= 0 ? beat.envStart : nextShot;
      for (let i = beat.dialogueStart; i < dlgEnd; i++) {
        if (i > beat.dialogueStart && /^【/.test(lines[i] || '')) break;
        lines[i] = null;
      }
    }
    if (beat.envStart >= 0) {
      for (let i = beat.envStart + 1; i < nextShot; i++) {
        if (!lines[i] || /^【/.test(lines[i])) break;
        const next = stripSpeechCuesFromLine(lines[i], { silentBeat: true, keepMouthNearQuote: false });
        if (next) lines[i] = next;
      }
    }
  }
  return lines;
}

function trim(s) {
  return s != null && String(s).trim() ? String(s).trim() : '';
}

/** 保留多行，仅规范换行 */
function normalizeUniversalSegmentTextNewlines(text) {
  if (!text) return '';
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/** 是否已含对白句（含 ArcReel / 旧引号） */
function beatLineHasSpokenDialogue(line) {
  const s = String(line || '');
  if (lineHasSpokenDialogueMark(s)) return true;
  if (/(?:说|嗓音|声音)[^：:\n「"」']{0,48}[：:]\s*[「"『]/.test(s)) return true;
  if (/@图片\d+[^\n]{0,40}[：:]\s*[「"『]/.test(s)) return true;
  return false;
}

/**
 * 解析 dialogue 字段「角色名：台词」→ { name, spoken }
 */
function splitDialogueField(dialogue) {
  const raw = trim(dialogue);
  if (!raw) return { name: '', spoken: '' };
  const m = raw.match(/^([^：:]{1,16})[：:]\s*(.+)$/s);
  if (m) return { name: trim(m[1]), spoken: trim(m[2]).replace(/^["「『]|["」』]$/g, '') };
  return { name: '', spoken: raw.replace(/^["「『]|["」』]$/g, '') };
}

/**
 * 将各类旧对白写法归一为 ArcReel：<角色>说 {原文}
 * @param {string} line
 * @param {{ nameToTag: Map<string,string>, tagToName: Map<string,string>, firstCharName: string }} maps
 */
function normalizeLineToArcReelSpeech(line, maps) {
  const { nameToTag, tagToName, firstCharName } = maps;
  let s = String(line || '');

  // 旧式 @图片N 嗓音/说 → 暂转花括号，再升格为 <名>
  s = s.replace(
    /@图片(\d+)\s*(?:的\s*)?(?:嗓音|声音)[^：:\n「"」'{]{0,40}[：:]\s*[「"『]([^」"'』]+)[」"'』]/gu,
    '@图片$1 说 {$2}'
  );
  s = s.replace(/@图片(\d+)\s*说\s*[：:]\s*[「"『]([^」"'』]+)[」"'』]/gu, '@图片$1 说 {$2}');
  s = s.replace(/@图片(\d+)\s*说："([^"]*)"/g, '@图片$1 说 {$2}');
  s = s.replace(/@图片(\d+)\s*说\s*\{([^}]*)\}/g, '@图片$1 说 {$2}');

  // 场景图误绑：@图片1 说 → 首个角色
  if (firstCharName && maps.firstCharTag && maps.firstCharTag !== '@图片1') {
    s = s.replace(/@图片1\s*说\s*\{([^}]*)\}/g, `<${firstCharName}>说 {$1}`);
  }

  // @图片N 说 {x} → <名>说 {x}
  s = s.replace(/@图片(\d+)\s*说\s*\{([^}]*)\}/g, (_, n, spoken) => {
    const tag = `@图片${n}`;
    const name = tagToName.get(tag) || firstCharName;
    if (name) return `<${name}>说 {${spoken}}`;
    return `@图片${n} 说 {${spoken}}`;
  });

  const names = [...nameToTag.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const tag = nameToTag.get(name);
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 名嗓音…："x" / 名（…）："x"
    s = s.replace(
      new RegExp(
        `${esc}\\s*(?:的\\s*)?(?:嗓音|声音)([^：:\\n「"」'{]{0,40})[：:]\\s*[「"『]([^」"'』]+)[」"'』]`,
        'gu'
      ),
      (_, _tone, spoken) => `<${name}>说 {${spoken}}`
    );
    s = s.replace(
      new RegExp(`${esc}\\s*[（(]([^）)]*)[）)]\\s*[：:]\\s*[「"『]([^」"'』]+)[」"'』]`, 'gu'),
      (_, _inner, spoken) => `<${name}>说 {${spoken}}`
    );
    // 已是 <名>说 {x} 保持
    // 名 口型同步说出「x」
    s = s.replace(
      new RegExp(`${esc}[^\\n「"『{]{0,24}口型同步说出[「"『]([^」"'』]+)[」"'』]`, 'gu'),
      (_, spoken) => `<${name}>说 {${spoken}}`
    );
  }

  // 无姓名的「口型同步说出『x』」→ 首个角色或画外音
  s = s.replace(/口型同步说出[「"『]([^」"'』]+)[」"'』]/gu, (_, spoken) => {
    if (firstCharName) return `<${firstCharName}>说 {${spoken}}`;
    return `画外音说 {${spoken}}`;
  });
  s = s.replace(/(?:^|[，、；\s])说出[「"『]([^」"'』]+)[」"'』]/gu, (m, spoken) => {
    const prefix = /^[，、；\s]/.test(m) ? m[0] : '';
    if (firstCharName) return `${prefix}<${firstCharName}>说 {${spoken}}`;
    return `${prefix}画外音说 {${spoken}}`;
  });

  return s;
}

/**
 * 从全能文案中按出现顺序提取说话角色名（不含画外音）
 */
function extractSpeechSpeakerNames(text) {
  const names = [];
  const seen = new Set();
  for (const u of deriveUtterances(text)) {
    if (u.kind !== 'dialogue') continue;
    const name = trim(u.speaker);
    if (!name || name.startsWith('@图片') || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * 把一行拆成「画面描述片段」与「发声记号」（对齐 ArcReel split_speech_line）。
 * 认：<名>说 {…} / 画外音说 {…} / @图片N 说 {…} / @[名]{…} / 裸 {…}（画外音）
 * 花括号内才是 utterance；括号外一律当画面描述，不升格为台词。
 *
 * @returns {Array<string|{ type:'speech', speaker:string, imageN:number|null, text:string, raw:string }>}
 */
function splitSpeechLine(line) {
  const text = String(line || '');
  if (!text) return [];
  const parts = [];
  let cursor = 0;
  let scan = 0;
  while (true) {
    const open = text.indexOf('{', scan);
    if (open < 0) break;
    const close = text.indexOf('}', open + 1);
    if (close < 0) break;
    const inner = text.slice(open + 1, close);
    if (inner.includes('{') || !String(inner).trim()) {
      scan = open + 1;
      continue;
    }

    const before = text.slice(cursor, open);
    let start = open;
    let speaker = '';
    let imageN = null;
    let skip = false;
    let m;

    if ((m = before.match(/<([^\s>]{1,24})>说\s*$/))) {
      start = cursor + before.length - m[0].length;
      speaker = trim(m[1]);
    } else if ((m = before.match(/画外音说\s*$/))) {
      start = cursor + before.length - m[0].length;
      speaker = '';
    } else if ((m = before.match(/@图片(\d+)\s*说\s*$/))) {
      start = cursor + before.length - m[0].length;
      imageN = Number(m[1]);
      speaker = '';
    } else if ((m = before.match(/@\[([^\]]{0,40})\]\s*[：:]?\s*$/))) {
      start = cursor + before.length - m[0].length;
      speaker = trim(m[1]);
      if (!speaker) {
        // @[ ]{台词}：说话人位写坏，不成记号（对齐 ArcReel）
        skip = true;
      }
    }
    // else: 裸 {台词} → 画外音

    if (skip) {
      scan = close + 1;
      continue;
    }

    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push({
      type: 'speech',
      speaker,
      imageN: Number.isFinite(imageN) ? imageN : null,
      text: inner,
      raw: text.slice(start, close + 1),
    });
    cursor = close + 1;
    scan = cursor;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/** 发声记号 → 官方提交句式（只输出花括号内原文） */
function renderSpeechMark(mark) {
  if (!mark || mark.type !== 'speech') return '';
  const spoken = String(mark.text || '').replace(/[{}]/g, '');
  if (!spoken.trim()) return '';
  if (mark.imageN != null) return `@图片${mark.imageN} 说 {${spoken}}`;
  if (mark.speaker) return `<${mark.speaker}>说 {${spoken}}`;
  return `画外音说 {${spoken}}`;
}

/** 描述里的 @[名] → <名>（对齐 ArcReel render_mentions_as_subjects；不碰发声记号） */
function renderDescriptionMentions(desc) {
  return String(desc || '').replace(/@\[([^\]]{1,40})\]/g, (full, name) => {
    const n = String(name || '').trim();
    return n ? `<${n}>` : full;
  });
}

/** 单行：描述原样（@[名]→<名>）+ 记号机械重写为 说{} */
function renderSpeechLine(line) {
  const parts = splitSpeechLine(line);
  if (parts.length === 1 && typeof parts[0] === 'string') {
    return renderDescriptionMentions(parts[0]);
  }
  return parts
    .map((p) => (typeof p === 'string' ? renderDescriptionMentions(p) : renderSpeechMark(p)))
    .join('');
}

/**
 * 从全文派生 utterances（阅读顺序）
 * @returns {Array<{ kind:'dialogue'|'voiceover', speaker:string, text:string }>}
 */
/** 约束/说明段里的占位花括号，不是剧本台词 */
function isMetaSpeechPlaceholder(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^(台词|原文|对白|旁白|…|\.{2,3}|…+)$/u.test(t)) return true;
  return false;
}

function deriveUtterances(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    // 勿从【音轨硬约束】等元说明行抽台词
    if (/^【(?:音轨硬约束|主体与音色)/.test(line)) continue;
    for (const part of splitSpeechLine(line)) {
      if (typeof part === 'string' || part.type !== 'speech') continue;
      const spoken = String(part.text || '').trim();
      if (!spoken || isMetaSpeechPlaceholder(spoken)) continue;
      if (part.imageN != null) {
        out.push({ kind: 'dialogue', speaker: `@图片${part.imageN}`, text: spoken });
      } else if (part.speaker) {
        out.push({ kind: 'dialogue', speaker: part.speaker, text: spoken });
      } else {
        out.push({ kind: 'voiceover', speaker: '', text: spoken });
      }
    }
  }
  return out;
}

/**
 * 提交视频前：逐行把发声记号机械重渲染为 <名>说 {…} / 画外音说 {…}
 * （不改画面描述；不把括号外文字升格为台词）
 */
function renderUniversalSegmentUtterancesForSubmit(text) {
  const body = normalizeUniversalSegmentTextNewlines(text);
  if (!body) return body;
  if (!/\{/.test(body)) return body;
  return body
    .split('\n')
    .map((line) => {
      // 旧版约束含「说 {台词}」示例：提交前剥掉花括号，避免模型念出「台词」「…」
      if (/^【音轨硬约束】/.test(line) || /^【主体与音色】/.test(line)) {
        return line
          .replace(/「[^」]*\{[^}]*\}[^」]*」/g, '「角色说话句式中的花括号原文」')
          .replace(/\{(?:台词|原文|对白|旁白|…|\.{2,3})\}/g, '花括号原文');
      }
      if (/^【/.test(line)) return line;
      if (!/\{/.test(line)) return line;
      return renderSpeechLine(line);
    })
    .join('\n')
    .trim();
}

/**
 * 机械写入音色声明段（提交视频前；与 content 里 reference_audio 顺序一致）
 * @param {Array<{ name: string, audioIndex: number, voiceStyle?: string }>} bindings
 */
function buildVoiceDeclarationBlock(bindings) {
  const list = Array.isArray(bindings) ? bindings.filter((b) => b && b.name && b.audioIndex) : [];
  if (!list.length) return '';
  const lines = list.map((b) => {
    const style = trim(b.voiceStyle);
    const isVo = String(b.name || '').trim() === '画外音';
    if (isVo) {
      return style
        ? `画外音的旁白音色参考 @音频${b.audioIndex}，声音特征：${style}。`
        : `画外音的旁白音色参考 @音频${b.audioIndex}。`;
    }
    return style
      ? `<${b.name}>的台词音色参考 @音频${b.audioIndex}，声音特征：${style}。`
      : `<${b.name}>的台词音色参考 @音频${b.audioIndex}。`;
  });
  return ['【主体与音色】', ...lines].join('\n');
}

/**
 * 将音色声明插到文案最前（替换已有【主体与音色】段）
 */
function injectVoiceDeclarationIntoPrompt(text, bindings) {
  let body = normalizeUniversalSegmentTextNewlines(text);
  if (!body) return body;
  // 去掉旧声明段
  body = body.replace(/^【主体与音色】\n[\s\S]*?(?=\n【|$)/, '').trim();
  const block = buildVoiceDeclarationBlock(bindings);
  if (!block) return body;
  return `${block}\n\n${body}`;
}

/**
 * 生成/润色后校正：
 * - 台词归一为 <角色>说 {原文}；删除整块【台词】栏
 * - 口型/开口隐喻清洗；【环境音】去掉掷地有声等发声修辞（保留真实环境床）
 */
function sanitizeUniversalSegmentDialogueConflicts(text, opts = {}) {
  if (!text || typeof text !== 'string') return text;
  const slots = Array.isArray(opts.characterSlots) ? opts.characterSlots : [];
  const nameToTag = new Map();
  const tagToName = new Map();
  for (const s of slots) {
    const name = trim(s?.name);
    const tag = trim(s?.tag);
    if (name && tag) {
      nameToTag.set(name, tag);
      tagToName.set(tag, name);
    }
  }
  const firstCharName = slots[0]?.name ? trim(slots[0].name) : '';
  const firstCharTag = slots[0]?.tag || '';
  const maps = { nameToTag, tagToName, firstCharName, firstCharTag };

  const lines = normalizeUniversalSegmentTextNewlines(text).split('\n');
  let inDialogueSection = false;
  const out = lines.map((line) => {
    const headed = line.match(/^【([^】]+)】/);
    if (headed) {
      inDialogueSection = headed[1] === '台词';
    }

    if (inDialogueSection || /^【台词】/.test(line)) {
      return line;
    }

    // 标题行与环境音标题不改写说话句式
    if (/^【/.test(line)) return line;

    return normalizeLineToArcReelSpeech(line, maps);
  });

  scrubSpeechCueInShotAndEnv(out);

  return out.filter((x) => x != null && String(x).length >= 0).join('\n').trim();
}

/** 若文案未含人声硬约束，追加一段（生视频时用） */
function appendUniversalAudioVoiceConstraint(text) {
  const t = String(text || '').trim();
  if (!t) return t;
  if (t.includes('【音轨硬约束】') || t.includes('成片音轨硬性约束')) return t;
  return `${t}\n\n${UNIVERSAL_AUDIO_VOICE_SUFFIX}`;
}

/** 根据总秒数决定子分镜数 M（约每 5 秒一拍，1–8） */
function chooseBeatCount(durationSec) {
  const dur = Math.max(1, Math.min(120, Math.round(Number(durationSec) || 5)));
  return Math.min(8, Math.max(1, Math.round(dur / 5)));
}

/** 将总秒数拆成 M 个正整数且和为 dur */
function splitDurationSeconds(dur, m) {
  const base = Math.floor(dur / m);
  const rem = dur - base * m;
  return Array.from({ length: m }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * 分镜批量生成时模型未返回 universal_segment_text 时的多段兜底（ArcReel 台词 + 可有环境音）
 */
function buildFallbackUniversalMultiBeatText(sb, d, styleHint) {
  const dur = Math.max(1, Number(d.durationSec) || 5);
  const { name: diaName, spoken } = splitDialogueField(d.dialogue);
  const M = 1;
  const secs = [dur];
  const loc = [sb?.location, sb?.time].filter(Boolean).join('，').trim() || '叙事空间';
  const act = trim(d.action) || '人物在场景内完成本镜戏核动作';
  const res = trim(d.result);
  const atm = trim(sb?.atmosphere);
  const sfx = trim(sb?.sound_effect) || trim(d.sound_effect);
  const styleTail = trim(styleHint) || '自然光，电影质感';
  const speaker = diaName || '角色';
  const spokenClean = spoken ? spoken.replace(/[{}]/g, '') : '';

  const lines = [
    '【风格锚点】',
    `电影质感，真人写实，8K高清，${styleTail}。`,
    '',
    '【场景设定】',
    `${loc}。${DEFAULT_SCENE_NOTE}${atm ? ` 氛围：${atm}。` : ''}`,
  ];

  const tk = secs[0];
  let shotBody = '';
  if (spoken) {
    shotBody =
      `固定机位，中景，连续单镜头共${tk}秒。${act.slice(0, 120)}` +
      `；约中段起 <${speaker}>说 {${spokenClean.slice(0, 40)}}` +
      `${res ? `；收束：${res.slice(0, 60)}` : ''}。全程同一空间连续叙述。`;
  } else {
    shotBody =
      `固定或缓推机位，中景，连续单镜头共${tk}秒。@图片2 ${act.slice(0, 140)}` +
      `${res ? `；结果：${res.slice(0, 60)}` : ''}。`;
  }
  lines.push('');
  lines.push(`【分镜1】（${tk}秒）：`);
  lines.push(shotBody);
  lines.push('');
  lines.push('【环境音】');
  if (sfx) {
    lines.push(`${sfx.slice(0, 120)}；人声清晰在前，无BGM。`);
  } else if (atm) {
    lines.push(`${atm.slice(0, 60)}现场环境声，人声清晰在前，无BGM。`);
  } else if (spoken) {
    lines.push('低电平现场环境声，人声清晰在前，无BGM。');
  } else {
    lines.push('现场环境声，无BGM。');
  }
  return lines.join('\n');
}

module.exports = {
  DEFAULT_LINE3,
  DEFAULT_SCENE_NOTE,
  UNIVERSAL_AUDIO_VOICE_SUFFIX,
  SPEECH_MARK_RE,
  VO_SPEECH_MARK_RE,
  AT_SPEECH_BRACE_RE,
  isLatinHeavyStyle,
  sanitizeChineseOmniStyleAnchor,
  normalizeUniversalSegmentTextNewlines,
  sanitizeUniversalSegmentDialogueConflicts,
  appendUniversalAudioVoiceConstraint,
  beatLineHasSpokenDialogue,
  lineHasSpokenDialogueMark,
  lineHasQuoteDialogue,
  splitDialogueField,
  chooseBeatCount,
  splitDurationSeconds,
  buildFallbackUniversalMultiBeatText,
  extractSpeechSpeakerNames,
  splitSpeechLine,
  renderSpeechMark,
  renderSpeechLine,
  deriveUtterances,
  renderUniversalSegmentUtterancesForSubmit,
  buildVoiceDeclarationBlock,
  injectVoiceDeclarationIntoPrompt,
};
