/**
 * 将解说旁白拆分为逐句/逐行片段（用于 IndexTTS 逐句配音与字幕）。
 */
const STRONG_PUNCT_RE = /([。！？!?；;])/g;
const WEAK_PUNCT_RE = /([，,、：:])/g;

function splitByPunct(text, re) {
  const parts = String(text || '').split(re);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) {
    const chunk = (parts[i] || '').trim();
    const punct = parts[i + 1] || '';
    if (!chunk && !punct) continue;
    const line = `${chunk}${punct}`.trim();
    if (line) out.push(line);
  }
  return out.length ? out : [String(text || '').trim()].filter(Boolean);
}

function mergeWeakParts(parts) {
  const out = [];
  let buf = '';
  for (const p of parts) {
    if (!buf) {
      buf = p;
      continue;
    }
    if (buf.length < 8) {
      buf += p;
    } else {
      out.push(buf);
      buf = p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function splitNarrationChunk(chunk) {
  const flat = String(chunk || '').replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  const strongParts = splitByPunct(flat, STRONG_PUNCT_RE);
  const result = [];
  for (const strongPart of strongParts) {
    const weakParts = splitByPunct(strongPart, WEAK_PUNCT_RE);
    result.push(...(weakParts.length > 1 ? mergeWeakParts(weakParts) : weakParts));
  }
  return result.length ? result : [flat];
}

function splitNarrationLines(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const lines = [];
  for (const block of normalized.split(/\n+/)) {
    const flat = block.replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    lines.push(...splitNarrationChunk(flat));
  }
  return lines.filter(Boolean);
}

module.exports = {
  splitNarrationLines,
};
