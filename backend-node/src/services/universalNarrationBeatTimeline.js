/**
 * 全能片段：旁白时间轴 ↔ 子分镜秒数对齐（与 IndexTTS/SRT 权重一致）
 */

const { splitSemanticUnits } = require('./universalOmniMultiBeatFormat');
const { splitNarrationLines } = require('../utils/narrationLineSplit');
const { parseUniversalMultiBeatText, composeUniversalMultiBeatText } = require('./universalMultiBeatParse');
const { NARRATION_CHARS_PER_SEC_DEFAULT } = require('./fullNarrationConstants');

const SPEECH_CHAR_RE = /[\u4e00-\u9fa5A-Za-z0-9]/g;

function trim(s) {
  return s != null && String(s).trim() ? String(s).trim() : '';
}

function countSpeechChars(text) {
  const m = String(text || '').match(SPEECH_CHAR_RE);
  return m ? m.length : 0;
}

/** 旁白拆句（优先与字幕/配音 splitNarrationLines 一致，否则语义单元） */
function splitNarrationUnits(narration) {
  const raw = trim(narration);
  if (!raw) return [];
  const lines = splitNarrationLines(raw);
  if (lines.length > 1) return lines;
  const sem = splitSemanticUnits(raw);
  return sem.length ? sem : [raw];
}

/** 将 N 条旁白单元合并为 M 组（M 拍） */
function mergeUnitsToBeatCount(units, M) {
  const out = Array.from({ length: Math.max(1, M) }, () => []);
  if (!units.length) return out;
  if (M <= 1) {
    out[0] = units.slice();
    return out;
  }
  for (let i = 0; i < units.length; i++) {
    const bi = Math.min(M - 1, Math.floor((i * M) / units.length));
    out[bi].push(units[i]);
  }
  return out;
}

/**
 * 按旁白可读字权重分配整数秒，和为 totalSec（每拍至少 1 秒）
 * @param {number} totalSec
 * @param {string[]} texts 每拍对应的旁白摘录（空串则均分剩余）
 */
function splitDurationByNarrationWeights(totalSec, texts) {
  const total = Math.max(1, Math.round(Number(totalSec) || 1));
  const list = Array.isArray(texts) ? texts : [];
  const m = Math.max(1, list.length);
  if (m === 1) return [total];

  const weights = list.map((t) => Math.max(1, countSpeechChars(t) || 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let allocated = 0;
  const secs = weights.map((w, idx) => {
    if (idx === m - 1) {
      return Math.max(1, total - allocated);
    }
    const ideal = (total * w) / wsum;
    const v = Math.max(1, Math.round(ideal));
    allocated += v;
    return v;
  });
  let sum = secs.reduce((a, b) => a + b, 0);
  if (sum !== total) {
    secs[m - 1] = Math.max(1, secs[m - 1] + (total - sum));
    sum = secs.reduce((a, b) => a + b, 0);
  }
  while (sum > total) {
    const i = secs.findIndex((s) => s > 1);
    if (i < 0) break;
    secs[i] -= 1;
    sum -= 1;
  }
  while (sum < total) {
    secs[0] += 1;
    sum += 1;
  }
  return secs;
}

/**
 * @returns {{ beats: { index, seconds, startSec, endSec, narrationExcerpt }[], units: string[] }}
 */
function buildNarrationBeatTimeline(narration, totalSec, M, charsPerSec = NARRATION_CHARS_PER_SEC_DEFAULT) {
  const total = Math.max(1, Math.round(Number(totalSec) || 1));
  const beatM = Math.max(1, Math.min(8, Number(M) || 1));
  const units = splitNarrationUnits(narration);
  const groups = mergeUnitsToBeatCount(units, beatM);
  const excerpts = groups.map((g) => g.join('').trim());
  const secs = splitDurationByNarrationWeights(total, excerpts);
  let t = 0;
  const beats = secs.map((sec, i) => {
    const startSec = t;
    const endSec = t + sec;
    t = endSec;
    return {
      index: i + 1,
      seconds: sec,
      startSec,
      endSec,
      narrationExcerpt: excerpts[i] || '',
    };
  });
  return { beats, units };
}

/** 写入 USER prompt 的旁白时间轴块 */
function buildNarrationBeatTimelineBlock(narration, totalSec, M, charsPerSec = NARRATION_CHARS_PER_SEC_DEFAULT) {
  const narr = trim(narration);
  if (!narr) return '';
  const { beats } = buildNarrationBeatTimeline(narr, totalSec, M, charsPerSec);
  if (!beats.length) return '';

  const lines = [
    'NARRATION_BEAT_TIMELINE（子分镜秒数与画面须按旁白时间轴对齐 — 违反即失败）:',
    `- 总时长 ${totalSec}s；各拍秒数按 NARRATION 可读字权重分配（与 IndexTTS/字幕一致），**禁止**机械均分（如 9s 禁止默认 3+3+3）。`,
    '- 每个「分镜k」的可见动作须发生在该拍时间窗内，对应其旁白语义；**禁止**把后段旁白的动作写进前段 beat。',
  ];
  for (const b of beats) {
    const excerpt = b.narrationExcerpt
      ? `「${b.narrationExcerpt.slice(0, 80)}${b.narrationExcerpt.length > 80 ? '…' : ''}」`
      : '（本拍无旁白，可写动作/运镜收束）';
    lines.push(
      `- 分镜${b.index}： ${b.seconds}秒（时间轴约 ${b.startSec.toFixed(1)}～${b.endSec.toFixed(1)}s）— 旁白：${excerpt} → 本 beat 画面写此段旁白对应的动作`
    );
  }
  lines.push(
    '- 例：9s、分镜 3+2+4 时，若「你推开门」约在 4.5s（落在分镜2 的 3～5s），推门动作须写在分镜2，不得写在分镜3。'
  );
  return lines.join('\n');
}

/**
 * 生成/润色后：按旁白权重重写各「分镜k： Tk秒:」的 Tk（保留正文）
 */
function alignUniversalBeatSecondsToNarration(text, totalSec, narration, M) {
  const raw = trim(text);
  if (!raw || !trim(narration)) return raw;
  const parsed = parseUniversalMultiBeatText(raw);
  if (!parsed.ok || !parsed.beats.length) return raw;

  const beatM = Math.min(parsed.beats.length, Math.max(1, Number(M) || parsed.beats.length));
  const { beats: timeline } = buildNarrationBeatTimeline(narration, totalSec, beatM);
  const newBeats = parsed.beats.map((b, i) => {
    const tl = timeline[i];
    if (!tl) return b;
    return { ...b, seconds: tl.seconds };
  });
  return composeUniversalMultiBeatText(parsed.headerLines, newBeats);
}

module.exports = {
  countSpeechChars,
  splitNarrationUnits,
  mergeUnitsToBeatCount,
  splitDurationByNarrationWeights,
  buildNarrationBeatTimeline,
  buildNarrationBeatTimelineBlock,
  alignUniversalBeatSecondsToNarration,
};
