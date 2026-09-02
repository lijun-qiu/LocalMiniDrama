/**
 * 解析全能片段多子分镜段落文本。
 * 结构：第1–3行固定头 + 「分镜k： Tk秒: 正文」行。
 */

const BEAT_LINE_RE = /^分镜\s*(\d+)\s*[：:]\s*([\d.]+)\s*秒\s*[：:]\s*(.*)$/;
/** 行内粘连的「分镜k：」拆到新行，避免编辑后整段挤成一行导致解析失败 */
const INLINE_BEAT_SPLIT_RE = /(?=分镜\s*\d+\s*[：:]\s*[\d.]+\s*秒\s*[：:])/g;

function normalizeUniversalMultiBeatNewlines(text) {
  let raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!raw) return '';
  // 「……连续画面。分镜1：」→ 换行后再接分镜
  raw = raw.replace(/([^\n])(分镜\s*\d+\s*[：:])/g, '$1\n$2');
  // 同一行多个分镜：按「分镜k：」切开
  const parts = raw.split(INLINE_BEAT_SPLIT_RE);
  return parts
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join('\n');
}

function parseUniversalMultiBeatText(text) {
  const raw = normalizeUniversalMultiBeatNewlines(text);
  if (!raw) {
    return { headerLines: [], beats: [], ok: false };
  }
  const lines = raw.split('\n');
  const headerLines = [];
  const beats = [];
  let seenBeat = false;
  for (const line of lines) {
    const m = String(line).trim().match(BEAT_LINE_RE);
    if (m) {
      seenBeat = true;
      beats.push({
        index: Number(m[1]),
        seconds: Number(m[2]),
        body: m[3] != null ? String(m[3]) : '',
        rawLine: line,
      });
    } else if (!seenBeat) {
      headerLines.push(line);
    } else {
      // 节拍行之后的非标准行并入上一拍正文
      if (beats.length) {
        const last = beats[beats.length - 1];
        last.body = `${last.body}\n${line}`.trim();
        last.rawLine = `分镜${last.index}： ${last.seconds}秒: ${last.body}`;
      } else {
        headerLines.push(line);
      }
    }
  }
  return { headerLines, beats, ok: beats.length > 0 };
}

function composeUniversalMultiBeatText(headerLines, beats) {
  const heads = (headerLines || []).map((l) => String(l ?? ''));
  const beatLines = (beats || []).map((b, i) => {
    const idx = Number(b.index) || i + 1;
    const sec = Number.isFinite(Number(b.seconds)) ? Number(b.seconds) : 1;
    const body = String(b.body || '').replace(/\r?\n/g, ' ').trim();
    return `分镜${idx}： ${sec}秒: ${body}`;
  });
  return [...heads, ...beatLines].join('\n').trim();
}

function replaceBeatInUniversalText(fullText, beatIndex1Based, newBody, secondsOpt) {
  const parsed = parseUniversalMultiBeatText(fullText);
  if (!parsed.ok) return { ok: false, text: String(fullText || ''), error: '无法解析多子分镜格式' };
  const ix = parsed.beats.findIndex((b) => Number(b.index) === Number(beatIndex1Based));
  if (ix < 0) return { ok: false, text: String(fullText || ''), error: `找不到分镜${beatIndex1Based}` };
  const beat = parsed.beats[ix];
  beat.body = String(newBody || '').replace(/\r?\n/g, ' ').trim();
  if (secondsOpt != null && Number.isFinite(Number(secondsOpt)) && Number(secondsOpt) > 0) {
    beat.seconds = Number(secondsOpt);
  }
  return {
    ok: true,
    text: composeUniversalMultiBeatText(parsed.headerLines, parsed.beats),
  };
}

/** 子分镜 Tk 之和；无法解析时返回 null */
function sumUniversalBeatSeconds(text) {
  const parsed = parseUniversalMultiBeatText(text);
  if (!parsed.ok || !parsed.beats.length) return null;
  const sum = parsed.beats.reduce((a, b) => a + (Number.isFinite(Number(b.seconds)) && Number(b.seconds) > 0 ? Number(b.seconds) : 0), 0);
  return sum > 0 ? Math.round(sum * 10) / 10 : null;
}

module.exports = {
  BEAT_LINE_RE,
  normalizeUniversalMultiBeatNewlines,
  parseUniversalMultiBeatText,
  composeUniversalMultiBeatText,
  replaceBeatInUniversalText,
  sumUniversalBeatSeconds,
};
