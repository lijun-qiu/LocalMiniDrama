/**
 * 全能模式 universal_segment_text 统一格式：多子分镜段落（与 generate/polish 接口一致）
 */

const DEFAULT_LINE3 =
  '环境、光影与陈设定性参考 @图片1。若 @图片1 为宫格或多画面拼图，禁止成片复刻其分格或并列布局，仅提取统一的室内空间与光线语义；须单镜头完整连续画面。';

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

/** 按中文句读切语义单元（句号/问叹/分号；过长再按逗号拆） */
function splitSemanticUnits(text) {
  const raw = trim(text);
  if (!raw) return [];
  let parts = raw
    .split(/(?<=[。！？；.!?;])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1 && raw.length > 28) {
    parts = raw
      .split(/(?<=[，,、])/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
  }
  return parts.length ? parts : [raw];
}

/**
 * 根据总秒数 + 旁白/动作语义决定子分镜数 M（1–8）
 * 禁止机械「约每 5 秒一拍 → 固定三镜」；短内容可 M=1，多句旁白才提高 M。
 * @param {number} durationSec
 * @param {{ narration?: string, action?: string, dialogue?: string }} [opts]
 */
function chooseBeatCount(durationSec, opts = {}) {
  const dur = Math.max(1, Math.min(120, Math.round(Number(durationSec) || 5)));
  const narrUnits = splitSemanticUnits(opts.narration);
  const actUnits = splitSemanticUnits(opts.action);
  const diaUnits = splitSemanticUnits(opts.dialogue);
  const contentUnits = Math.max(narrUnits.length, actUnits.length, diaUnits.length > 0 ? diaUnits.length : 0);

  // 每拍至少约 2 秒，避免把短镜切碎
  const maxByDur = Math.max(1, Math.floor(dur / 2));
  let M;
  if (contentUnits > 0) {
    M = Math.min(8, Math.max(1, Math.min(contentUnits, maxByDur)));
  } else {
    // 无旁白/动作时略放宽：约每 6～7 秒一拍，避免 15 秒必出 3
    M = Math.min(8, Math.max(1, Math.round(dur / 6.5)));
  }

  if (dur <= 4) M = 1;
  else if (dur <= 7) M = Math.min(M, 2);
  else if (dur <= 10) M = Math.min(M, 3);

  // 单句短旁白：不要硬拆成三镜
  if (narrUnits.length === 1 && narrUnits[0].length <= 24 && actUnits.length <= 1) {
    M = Math.min(M, dur <= 8 ? 1 : 2);
  }

  return Math.min(8, Math.max(1, M));
}

/** 将总秒数拆成 M 个正整数且和为 dur */
function splitDurationSeconds(dur, m) {
  const base = Math.floor(dur / m);
  const rem = dur - base * m;
  return Array.from({ length: m }, (_, i) => base + (i < rem ? 1 : 0));
}

/** 把旁白单元均摊到 M 拍（可为空拍） */
function distributeUnitsAcrossBeats(units, M) {
  const out = Array.from({ length: M }, () => []);
  if (!units.length) return out;
  if (units.length === M) {
    for (let i = 0; i < M; i++) out[i] = [units[i]];
    return out;
  }
  if (M === 1) {
    out[0] = units.slice();
    return out;
  }
  for (let i = 0; i < units.length; i++) {
    const bi = Math.min(M - 1, Math.floor((i * M) / units.length));
    out[bi].push(units[i]);
  }
  return out;
}

const BEAT_SPEAKING_RE = /说话口型|口型同步|开口说话|开口对口型|对口型/;
const BEAT_SILENT_RE = /人物闭口无口型|闭口无口型|无对白|无对话/;

function beatBodyIndicatesSpeaking(body) {
  return BEAT_SPEAKING_RE.test(String(body || ''));
}

function beatBodyIndicatesSilent(body) {
  const b = String(body || '');
  return BEAT_SILENT_RE.test(b) && !BEAT_SPEAKING_RE.test(b);
}

/** 无对白拍：强制闭口，剥开口型措辞 */
function ensureSilentBeatBody(body) {
  let b = String(body || '')
    .replace(/，?\s*(?:说话口型同步|说话口型|口型同步|开口说话|开口对口型|对口型)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[。.\s,，]+$/g, '')
    .trim();
  if (!b) return '人物闭口无口型，无对白';
  if (!/闭口无口型/.test(b)) b += '，人物闭口无口型';
  if (!/无对白|无对话/.test(b)) b += '，无对白';
  return b;
}

/** 有对白拍：强制口型同步，剥闭口/无对白措辞 */
function ensureSpeakingBeatBody(body) {
  let b = String(body || '')
    .replace(/，?\s*人物闭口无口型/g, '')
    .replace(/，?\s*闭口无口型/g, '')
    .replace(/，?\s*无对白/g, '')
    .replace(/，?\s*无对话/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[。.\s,，]+$/g, '')
    .trim();
  if (!b) return '开口说话口型同步';
  if (!BEAT_SPEAKING_RE.test(b)) b += '，开口说话口型同步';
  return b;
}

/**
 * 解析文末「对话：」中按分镜/镜头标注的台词归属。
 * 支持：分镜2：… / 镜头2：… / 【分镜2】…
 * @returns {{ byBeat: Map<number,string>, unassigned: string, empty: boolean }}
 */
function parseDialogueBeatAssignments(trailer) {
  const byBeat = new Map();
  let raw = String(trailer || '').trim();
  if (!raw) return { byBeat, unassigned: '', empty: true };
  raw = raw.replace(/^(?:对话|对白)\s*[：:]\s*/u, '').replace(/^【\s*对话\s*】\s*/u, '').trim();
  if (!raw || /^无\s*$/u.test(raw)) return { byBeat, unassigned: '', empty: true };

  const taggedRe = /(?:【\s*)?(?:分镜|镜头)\s*(\d+)\s*(?:】)?\s*[：:]/g;
  const hits = [];
  let m;
  while ((m = taggedRe.exec(raw)) != null) {
    hits.push({
      index: Number(m[1]),
      start: m.index + m[0].length,
      tagStart: m.index,
    });
  }
  if (!hits.length) {
    return { byBeat, unassigned: raw.trim(), empty: false };
  }

  // 标签前的游离台词
  const before = raw.slice(0, hits[0].tagStart).replace(/^[；;\s]+|[；;\s]+$/g, '').trim();
  let unassigned = before;
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].tagStart : raw.length;
    const chunk = raw.slice(hits[i].start, end).replace(/^[；;\s]+|[；;\s]+$/g, '').trim();
    if (!chunk || /^无\s*$/u.test(chunk)) continue;
    const prev = byBeat.get(hits[i].index);
    byBeat.set(hits[i].index, prev ? `${prev} ${chunk}` : chunk);
  }
  return { byBeat, unassigned, empty: byBeat.size === 0 && !unassigned };
}

function composeDialogueTrailerFromBeatMap(byBeat, unassigned, beatCount) {
  const { normalizeDialogueFieldForPrompt } = require('./dialogueVisualSeparation');
  const keys = [...byBeat.keys()].filter((k) => Number.isFinite(k) && k >= 1).sort((a, b) => a - b);
  if (!keys.length && !unassigned) return '对话：无';
  if (!keys.length) {
    return `对话：${normalizeDialogueFieldForPrompt(unassigned)}`;
  }
  const parts = [];
  if (unassigned) parts.push(normalizeDialogueFieldForPrompt(unassigned));
  for (const k of keys) {
    if (beatCount != null && k > beatCount) continue;
    const body = normalizeDialogueFieldForPrompt(byBeat.get(k));
    if (!body || body === '无') continue;
    parts.push(`分镜${k}：${body}`);
  }
  return parts.length ? `对话：${parts.join(' ')}` : '对话：无';
}

/**
 * 按子分镜强制口型/对白归属：
 * - 无对白字段 /「对话：无」→ 全部拍闭口无口型，禁止开口
 * - 有对白时：仅标注了分镜k/镜头k 或正文已写口型的拍开口；其余拍闭口无对白
 */
function enforcePerBeatDialogueAndLipSync(fullText, { dialogueField } = {}) {
  const { parseUniversalMultiBeatText, composeUniversalMultiBeatText } = require('./universalMultiBeatParse');
  const { normalizeDialogueFieldForPrompt } = require('./dialogueVisualSeparation');
  const parsed = parseUniversalMultiBeatText(fullText);
  if (!parsed.ok || !parsed.beats.length) return String(fullText || '');

  const fieldProvided = dialogueField !== undefined && dialogueField !== null;
  const fieldNorm = fieldProvided ? normalizeDialogueFieldForPrompt(dialogueField) : null;
  const fieldHasDialogue = fieldNorm != null && fieldNorm !== '无';

  let { byBeat, unassigned, empty: trailerEmpty } = parseDialogueBeatAssignments(
    parsed.dialogueTrailer
  );
  const trailerHasDialogue = !trailerEmpty;

  // 无对白：全部闭口 + 对话：无（字段优先；否则看 trailer）
  const forceAllSilent =
    fieldNorm === '无' || (!fieldProvided && !trailerHasDialogue);
  if (forceAllSilent) {
    const silentBeats = parsed.beats.map((b) => ({
      ...b,
      body: ensureSilentBeatBody(cleanBeatVisualBody(b.body, { ensureSilent: false })),
    }));
    return composeUniversalMultiBeatText(parsed.headerLines, silentBeats, '对话：无');
  }

  // 字段有对白且 trailer 未按分镜拆开：用字段整段作未归属台词
  if (fieldHasDialogue && byBeat.size === 0 && !unassigned) {
    unassigned = fieldNorm;
  }

  const speakingSet = new Set();
  for (const k of byBeat.keys()) speakingSet.add(Number(k));
  for (const b of parsed.beats) {
    if (beatBodyIndicatesSpeaking(b.body) && !beatBodyIndicatesSilent(b.body)) {
      speakingSet.add(Number(b.index));
    }
  }
  // 有台词但无归属拍：落到最后一拍（兼容旧稿未写「分镜k：」）
  if (speakingSet.size === 0 && (unassigned || fieldHasDialogue || trailerHasDialogue)) {
    const last = parsed.beats[parsed.beats.length - 1];
    if (last) speakingSet.add(Number(last.index));
  }

  if (unassigned && speakingSet.size) {
    const firstSpeak = Math.min(...speakingSet);
    const prev = byBeat.get(firstSpeak);
    byBeat.set(firstSpeak, prev ? `${prev} ${unassigned}` : unassigned);
    unassigned = '';
  }

  const cleanedMap = new Map();
  for (const [k, v] of byBeat) {
    const nk = Number(k);
    if (!speakingSet.has(nk)) continue;
    const body = normalizeDialogueFieldForPrompt(v);
    if (body && body !== '无') cleanedMap.set(nk, body);
  }
  if (cleanedMap.size === 0) {
    const blob =
      (fieldHasDialogue && fieldNorm) ||
      normalizeDialogueFieldForPrompt(
        String(parsed.dialogueTrailer || '')
          .replace(/^(?:对话|对白)\s*[：:]\s*/u, '')
          .trim()
      );
    if (blob && blob !== '无' && speakingSet.size) {
      cleanedMap.set(Math.max(...speakingSet), blob);
    }
  }

  // 仅 cleanedMap / speakingSet 内的拍开口；其余强制闭口无对白
  const speakFinal = new Set(cleanedMap.keys());
  if (!speakFinal.size) {
    for (const k of speakingSet) speakFinal.add(k);
  }

  const beats = parsed.beats.map((b) => {
    const idx = Number(b.index);
    let body = cleanBeatVisualBody(b.body, { ensureSilent: false });
    body = speakFinal.has(idx) ? ensureSpeakingBeatBody(body) : ensureSilentBeatBody(body);
    return { ...b, body };
  });

  const trailer = composeDialogueTrailerFromBeatMap(cleanedMap, '', beats.length);
  return composeUniversalMultiBeatText(parsed.headerLines, beats, trailer);
}

/** 从 beat 正文剔除内嵌旁白引文与 markdown，保留纯画面描述 */
function cleanBeatVisualBody(body, { ensureSilent = true } = {}) {
  const { stripQuotedSpeechFromVisual } = require('./dialogueVisualSeparation');
  let b = stripQuotedSpeechFromVisual(
    String(body || '')
      .replace(/\*{1,2}旁白（画面无声）\*{1,2}\s*[：:]\s*[""「][^""」]*[""」]/g, '')
      .replace(/旁白（画面无声）\s*[：:]\s*[""「][^""」]*[""」]/g, '')
      .replace(/\*\*/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
  if (ensureSilent && b && !beatBodyIndicatesSpeaking(b) && !/说[：:"]/.test(b)) {
    b = ensureSilentBeatBody(b);
  }
  return b;
}

/**
 * 旁白已在 storyboards.narration + IndexTTS 后期叠加；beat 行只保留画面分镜描述。
 * 内嵌台词抽到文末「对话：」块，再按子分镜强制口型/闭口。
 */
function stripInlineNarrationFromUniversalText(fullText, opts = {}) {
  const raw = String(fullText || '').trim();
  if (!raw) return raw;
  const { parseUniversalMultiBeatText, composeUniversalMultiBeatText } = require('./universalMultiBeatParse');
  const parsed = parseUniversalMultiBeatText(raw);
  if (!parsed.ok) {
    return cleanBeatVisualBody(raw, { ensureSilent: false });
  }

  const extractedByBeat = new Map();
  const beats = parsed.beats.map((b) => {
    let bodyRaw = String(b.body || '')
      .replace(/\*{1,2}旁白（画面无声）\*{1,2}\s*[：:]\s*[""「][^""」]*[""」]/g, '')
      .replace(/旁白（画面无声）\s*[：:]\s*[""「][^""」]*[""」]/g, '');
    const quoteRe =
      /(?:@图片\s*\d+\s*(?:说|道|喊|叫|答|问)?|(?:[\u4e00-\u9fffA-Za-z]{1,12})\s*(?:说|道|喊|叫|答|问)?)\s*[：:]\s*[「」""]([^「」""]{1,200})[」""]/g;
    let m;
    const extracted = [];
    while ((m = quoteRe.exec(bodyRaw)) !== null) {
      const line = m[0].trim();
      if (line && !/旁白/.test(line) && !extracted.includes(line)) extracted.push(line);
    }
    if (extracted.length) {
      extractedByBeat.set(Number(b.index), extracted.join(' '));
    }
    return {
      ...b,
      body: cleanBeatVisualBody(b.body, { ensureSilent: false }),
    };
  });

  let dialogueTrailer = parsed.dialogueTrailer || '';
  if (extractedByBeat.size) {
    const { byBeat, unassigned, empty } = parseDialogueBeatAssignments(dialogueTrailer);
    for (const [idx, lines] of extractedByBeat) {
      const prev = byBeat.get(idx);
      byBeat.set(idx, prev ? `${prev} ${lines}` : lines);
    }
    if (empty && !unassigned && byBeat.size) {
      dialogueTrailer = composeDialogueTrailerFromBeatMap(byBeat, '', beats.length);
    } else if (!dialogueTrailer || /^对话\s*[：:]\s*无\s*$/.test(dialogueTrailer)) {
      dialogueTrailer = composeDialogueTrailerFromBeatMap(byBeat, unassigned, beats.length);
    } else {
      dialogueTrailer = composeDialogueTrailerFromBeatMap(byBeat, unassigned, beats.length);
    }
  } else if (!dialogueTrailer) {
    dialogueTrailer = '对话：无';
  }

  const composed = composeUniversalMultiBeatText(parsed.headerLines, beats, dialogueTrailer);
  return enforcePerBeatDialogueAndLipSync(composed, {
    dialogueField: opts.dialogueField,
  });
}

/**
 * 分镜批量生成时模型未返回 universal_segment_text 时的多行兜底
 * @param {object} sb
 * @param {object} d — action/dialogue/narration/result/durationSec；可选 primaryImageTag、dialogueSpeakerTag
 * @param {string} [styleHint]
 */
function buildFallbackUniversalMultiBeatText(sb, d, styleHint) {
  const dur = Math.max(1, Number(d.durationSec) || 5);
  const narr = trim(d.narration);
  const act = trim(d.action) || '人物在场景内完成本镜戏核动作';
  const res = trim(d.result);
  const dia = trim(d.dialogue);
  const M = chooseBeatCount(dur, { narration: narr, action: act, dialogue: dia });
  const loc = [sb?.location, sb?.time].filter(Boolean).join('，').trim() || '叙事空间';
  const atm = trim(sb?.atmosphere);
  const styleTail = trim(styleHint) || '电影感叙事';
  const styleLine = `画面风格和类型: 真人写实, 电影风格, 高清画质, ${styleTail}`;
  const subjectTag = trim(d.primaryImageTag) || trim(d.dialogueSpeakerTag) || '@图片2';

  const narrUnits = narr ? (() => {
    const { splitNarrationUnits, mergeUnitsToBeatCount } = require('./universalNarrationBeatTimeline');
    return mergeUnitsToBeatCount(splitNarrationUnits(narr), M);
  })() : Array.from({ length: M }, () => []);
  const actChunks = distributeUnitsAcrossBeats(splitSemanticUnits(act), M);

  let secs;
  if (narr) {
    const { splitNarrationUnits, mergeUnitsToBeatCount, splitDurationByNarrationWeights } = require('./universalNarrationBeatTimeline');
    const units = splitNarrationUnits(narr);
    const groups = mergeUnitsToBeatCount(units, M);
    const excerpts = groups.map((g) => g.join('').trim());
    secs = splitDurationByNarrationWeights(dur, excerpts);
  } else {
    secs = splitDurationSeconds(dur, M);
  }

  // 从 action 里「镜头k / 分镜k」推断对白归属拍；否则有对白时落到末拍
  const shotSpeakIdx = new Set();
  if (dia) {
    const segs = act.split(/(?=(?:镜头|分镜)\s*\d+\s*[：:])/);
    for (const seg of segs) {
      const hm = String(seg).match(/^(?:镜头|分镜)\s*(\d+)/);
      if (hm && /说|道|问|答|喊|开口|对白|台词/.test(seg)) {
        shotSpeakIdx.add(Number(hm[1]));
      }
    }
    if (!shotSpeakIdx.size) shotSpeakIdx.add(M);
  }

  const lines = [styleLine, `生成一个由以下${M}个分镜组成的视频。`, DEFAULT_LINE3];

  for (let k = 0; k < M; k++) {
    const tk = secs[k];
    const isFirst = k === 0;
    const isLast = k === M - 1;
    const beatAct = actChunks[k].join('') || (isFirst ? act.slice(0, 80) : '');
    const beatNarrHint = narrUnits[k].join('');

    // 旁白在 storyboards.narration + IndexTTS；beat 只写可视动作与运镜
    let body = '';
    if (isFirst) {
      const visual = beatAct
        ? `${subjectTag} ${beatAct}`
        : beatNarrHint
          ? `${subjectTag} 在场景中完成与旁白语义对应的动作`
          : `${subjectTag} ${act.slice(0, 80)}`;
      body = `镜头从 @图片1 的${loc}建立画面起，平稳缓推向戏眼；${visual}，${atm ? `${atm}，` : ''}光影随空间纵深拉开`;
    } else if (isLast) {
      body = `镜头徐徐拉回或推近收束；${subjectTag} ${beatAct || res || '完成本镜动作阶段'}，情绪落点明确。`;
    } else {
      body = `镜头继续推进，跟住 ${subjectTag}；${beatAct || act.slice(0, 100)}，运镜含定镜与缓推轨衔接。`;
    }

    const beatNo = k + 1;
    if (dia && shotSpeakIdx.has(beatNo)) {
      body = ensureSpeakingBeatBody(body);
    } else {
      body = ensureSilentBeatBody(body);
    }

    lines.push(`分镜${beatNo}： ${tk}秒: ${body}`);
  }

  // 台词单独文末块，按开口拍标注「分镜k：」
  const {
    normalizeDialogueFieldForPrompt,
  } = require('./dialogueVisualSeparation');
  if (dia) {
    let spoken = dia;
    const namePrefix = trim(d.primarySubjectName) || trim(d.dialogueSpeakerName);
    if (!/[：:]\s*[「」""]?/.test(spoken) && namePrefix) {
      spoken = `${namePrefix}："${spoken.replace(/[「」""]/g, '')}"`;
    }
    const speakBeats = [...shotSpeakIdx].filter((n) => n >= 1 && n <= M).sort((a, b) => a - b);
    if (speakBeats.length === 1) {
      lines.push(`对话：分镜${speakBeats[0]}：${normalizeDialogueFieldForPrompt(spoken)}`);
    } else if (speakBeats.length > 1) {
      // 多拍开口但台词未拆：整段落到首个开口拍，避免静音拍被误赋对白
      lines.push(`对话：分镜${speakBeats[0]}：${normalizeDialogueFieldForPrompt(spoken)}`);
    } else {
      lines.push(`对话：分镜${M}：${normalizeDialogueFieldForPrompt(spoken)}`);
    }
  } else {
    lines.push('对话：无');
  }

  return enforcePerBeatDialogueAndLipSync(lines.join('\n'), { dialogueField: dia || '无' });
}

module.exports = {
  DEFAULT_LINE3,
  normalizeUniversalSegmentTextNewlines,
  chooseBeatCount,
  splitDurationSeconds,
  splitSemanticUnits,
  cleanBeatVisualBody,
  stripInlineNarrationFromUniversalText,
  buildFallbackUniversalMultiBeatText,
  enforcePerBeatDialogueAndLipSync,
  parseDialogueBeatAssignments,
  ensureSilentBeatBody,
  ensureSpeakingBeatBody,
  beatBodyIndicatesSpeaking,
  beatBodyIndicatesSilent,
};
