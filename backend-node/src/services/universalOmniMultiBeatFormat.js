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

/** 从 beat 正文剔除内嵌旁白引文与 markdown，保留纯画面描述 */
function cleanBeatVisualBody(body, { ensureSilent = true } = {}) {
  let b = String(body || '')
    .replace(/\*{1,2}旁白（画面无声）\*{1,2}\s*[：:]\s*[""「][^""」]*[""」]/g, '')
    .replace(/旁白（画面无声）\s*[：:]\s*[""「][^""」]*[""」]/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (ensureSilent && b && !/无对白/.test(b) && !/说[：:"]/.test(b)) {
    b = b.replace(/[。.\s,，]+$/, '');
    b += '，人物闭口无口型，无对白。';
  }
  return b;
}

/**
 * 旁白已在 storyboards.narration + IndexTTS 后期叠加；beat 行只保留画面分镜描述。
 */
function stripInlineNarrationFromUniversalText(fullText) {
  const raw = String(fullText || '').trim();
  if (!raw) return raw;
  const { parseUniversalMultiBeatText, composeUniversalMultiBeatText } = require('./universalMultiBeatParse');
  const parsed = parseUniversalMultiBeatText(raw);
  if (!parsed.ok) {
    return cleanBeatVisualBody(raw, { ensureSilent: false });
  }
  const beats = parsed.beats.map((b) => ({
    ...b,
    body: cleanBeatVisualBody(b.body),
  }));
  return composeUniversalMultiBeatText(parsed.headerLines, beats);
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
  const speakTag = trim(d.dialogueSpeakerTag) || subjectTag;

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

    if (dia && isLast) {
      let spoken = dia.replace(/"/g, '').replace(/[「」『』“”]/g, '');
      const namePrefix = trim(d.primarySubjectName) || trim(d.dialogueSpeakerName);
      if (namePrefix) {
        const re = new RegExp(
          `^${namePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:说|道|问|答|喊|叫)?\\s*[:：]\\s*`
        );
        spoken = spoken.replace(re, '').trim();
      }
      body += ` ${speakTag} 说："${spoken}"`;
    } else {
      body = body.replace(/[。.\s,，]+$/, '');
      body += '，人物闭口无口型，无对白。';
    }

    lines.push(`分镜${k + 1}： ${tk}秒: ${body}`);
  }
  return lines.join('\n');
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
};
