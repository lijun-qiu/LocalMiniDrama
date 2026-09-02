/**
 * 全能多拍 → Agnes 统一时间轴模板（提交前适配）。
 * 生成时契约见 universalAgnesTimelineContract.js（同一套语义）。
 *
 * 不做业务动作特判；统一规则：
 * 1. 按拍缩放至 API duration，1:1 映射时段
 * 2. 每拍只保留原文，不改写、不拆拍、不注入场景剧本
 * 3. 每拍套同一套约束：本段唯一主事件 + 禁抢跑（后拍摘要）+ 禁重复（前拍摘要）
 */

const { parseUniversalMultiBeatText } = require('./universalMultiBeatParse');

function isUniversalMultiBeatPrompt(text) {
  const raw = String(text || '');
  return (
    /生成一个由以下\s*\d+\s*个分镜组成的视频/.test(raw) &&
    /分镜\s*\d+\s*[：:]\s*[\d.]+\s*秒/.test(raw)
  );
}

function fmtSec(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10);
}

function scaleBeatSeconds(beats, targetSec) {
  const target = Math.max(1, Math.round(Number(targetSec) || 0));
  if (!target) return beats.map((b) => ({ ...b }));
  const sum = beats.reduce((a, b) => a + Math.max(0.5, Number(b.seconds) || 1), 0);
  if (Math.abs(sum - target) < 0.01) return beats.map((b) => ({ ...b }));

  let allocated = 0;
  return beats.map((b, i) => {
    const raw = Math.max(0.5, Number(b.seconds) || 1);
    if (i === beats.length - 1) {
      return { ...b, seconds: Math.max(0.5, target - allocated) };
    }
    const v = Math.max(0.5, Math.round((raw / sum) * target));
    allocated += v;
    return { ...b, seconds: v };
  });
}

const NOISE_CLAUSE_RE =
  /^(?:人物闭口无口型|无对白|无画面字幕|须单镜头|环境、光影|画面风格|参考图)/;

/**
 * 从拍正文抽「事件摘要」短句，供统一禁抢跑 / 禁重复引用。
 * 与具体剧情无关：按标点切分后取有信息量的短句。
 */
function extractBeatEventSnippets(body, { max = 5 } = {}) {
  const raw = String(body || '')
    .replace(/\s+/g, ' ')
    .replace(/（[^）]{0,80}）/g, '')
    .trim();
  if (!raw) return [];

  const parts = raw
    .split(/[，。；；、]/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 42)
    .filter((s) => !NOISE_CLAUSE_RE.test(s))
    .filter((s) => !/^@图片\s*\d+\s*$/.test(s));

  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const key = p.replace(/@图片\s*\d+\s*/g, '').slice(0, 16);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

function snippetOverlap(snippet, otherBody) {
  const s = String(snippet || '').replace(/@图片\s*\d+\s*/g, '').trim();
  if (s.length < 4) return false;
  const o = String(otherBody || '');
  // 短核：取前 8～12 字看是否已在本段出现
  const core = s.slice(0, Math.min(12, s.length));
  return o.includes(core);
}

/**
 * 相对当前正文，收集「仅在其他拍出现」的事件摘要。
 */
function collectDistinctSnippets(otherBodies, curBody, { max = 6 } = {}) {
  const out = [];
  const seen = new Set();
  for (const body of otherBodies) {
    for (const sn of extractBeatEventSnippets(body, { max: 5 })) {
      if (snippetOverlap(sn, curBody)) continue;
      const key = sn.slice(0, 16);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sn);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** @deprecated 兼容旧测试名：现为通用摘要差集 */
function collectFutureElementLabels(laterBodies, curBody) {
  return collectDistinctSnippets(laterBodies, curBody, { max: 8 });
}

function buildFlatTimelineSegments(beats) {
  const segments = [];
  let t = 0;
  for (const b of beats) {
    const sec = Math.max(0.5, Number(b.seconds) || 1);
    const start = t;
    const end = start + sec;
    t = end;
    segments.push({
      start,
      end,
      body: String(b.body || '').replace(/\s+/g, ' ').trim(),
      index: segments.length,
    });
  }
  return segments;
}

/**
 * 统一时段模板（每拍相同结构）：
 * 【T0～T1·仅此时间段】
 * 正文
 * 【本段唯一主事件】…
 * 【严禁抢跑】后拍摘要…
 * 【已完成·禁止重复】前拍摘要…
 */
function renderTimelineSegment(segments, index) {
  const seg = segments[index];
  const win = `${fmtSec(seg.start)}～${fmtSec(seg.end)}秒`;
  const parts = [
    `【${win}·仅此时间段内允许的画面】`,
    seg.body,
    `【本段唯一主事件·${win}】只演绎本段正文所写内容；须完整演完本段后再进入下一段；禁止跳切到结果态、禁止闪回、禁止预演未到时段。`,
  ];

  const later = segments.slice(index + 1);
  if (later.length) {
    const laterSnips = collectDistinctSnippets(
      later.map((s) => s.body),
      seg.body,
      { max: 6 }
    );
    if (laterSnips.length) {
      const laterWindows = later.map((s) => `${fmtSec(s.start)}～${fmtSec(s.end)}秒`).join('、');
      parts.push(
        `【严禁抢跑·${win}内不得出现】下列内容仅属于 ${laterWindows}，本段绝对禁止提前出现：${laterSnips.join('；')}。`
      );
    }
  }

  const earlier = segments.slice(0, index);
  if (earlier.length) {
    // 近邻前拍优先：避免远拍氛围句占满额度、漏掉刚完成的关键动作
    const prevSnips = collectDistinctSnippets(
      [...earlier].reverse().map((s) => s.body),
      seg.body,
      { max: 5 }
    );
    if (prevSnips.length) {
      parts.push(
        `【已完成·禁止重复·${win}】前序时段已完成下列内容，本段禁止再演一次：${prevSnips.join('；')}。`
      );
    }
  }

  return parts.join('\n');
}

function buildTimelineIntro(totalSec) {
  return [
    `【Agnes 连续单镜头·总时长 ${totalSec} 秒·严格线性时间轴】`,
    '生成规则（最高优先级·统一适用于每一时段）：',
    '1. 严格按下列【X～Y秒·仅此时间段】顺序播放；禁止打乱、闪回、把后续时段画面提前。',
    '2. 每一时段只允许该时段正文中的画面；后段摘要中的动作/道具/场景变化在未到时间窗前一律不得出现。',
    '3. 前序时段已完成的动作禁止在后段再次完整重演；后段只承接结果态或新动作。',
    '4. 参考图：<Picture N> 与 @图片N 对应；人物闭口无口型，无对白；画面中禁止字幕/花字/标题/任何可读文字。',
  ].join('\n');
}

/**
 * @param {string} text
 * @param {{ durationSec?: number }} [opts]
 */
function adaptUniversalSegmentTextForAgnes(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!isUniversalMultiBeatPrompt(raw)) {
    return { adapted: raw, changed: false };
  }

  const lockMatch = raw.match(/\n【资产锁定[\s\S]*$/);
  const lockSuffix = lockMatch ? lockMatch[0].trim() : '';
  const core = lockMatch ? raw.slice(0, lockMatch.index).trim() : raw;

  const parsed = parseUniversalMultiBeatText(core);
  if (!parsed.ok || !parsed.beats.length) {
    return { adapted: raw, changed: false };
  }

  const headerStyle = parsed.headerLines
    .filter((l) => /画面风格|环境、光影/.test(String(l)))
    .join('\n')
    .trim();

  const targetSec = opts.durationSec != null ? Number(opts.durationSec) : null;
  const beats = targetSec
    ? scaleBeatSeconds(parsed.beats, targetSec)
    : parsed.beats.map((b) => ({ ...b }));

  const flatSegments = buildFlatTimelineSegments(beats);
  const rendered = flatSegments.map((_, i) => renderTimelineSegment(flatSegments, i));

  const totalSec = fmtSec(targetSec || flatSegments[flatSegments.length - 1]?.end || 0);
  const adapted = [headerStyle, buildTimelineIntro(totalSec), ...rendered, lockSuffix]
    .filter(Boolean)
    .join('\n\n');
  return { adapted, changed: true };
}

const AGNES_SEQUENTIAL_ORDER_SUFFIX =
  '【顺序约束·最高优先级】成片须严格按 prompt 中各「X～Y秒·仅此时间段」顺序展开；禁止预演后续情节；禁止重复前序已完成动作；前段未写到的事件前段画面中不得出现。';

module.exports = {
  isUniversalMultiBeatPrompt,
  adaptUniversalSegmentTextForAgnes,
  extractBeatEventSnippets,
  collectDistinctSnippets,
  collectFutureElementLabels,
  scaleBeatSeconds,
  buildFlatTimelineSegments,
  AGNES_SEQUENTIAL_ORDER_SUFFIX,
};
