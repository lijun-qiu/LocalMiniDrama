/**
 * 规范化全能片段里分镜时长：
 * 支持新格式「【分镜k】（X秒）：」与旧格式「分镜k： X秒:」
 * 单条时对齐总时长；多条时按比例缩放使秒数之和等于 totalSec。
 */
function normalizeUniversalSegmentShotDurations(text, durationLabel, totalSec) {
  if (!text || typeof text !== 'string' || !durationLabel) return text;
  const total = Number(totalSec);
  if (!Number.isFinite(total) || total <= 0) return text;

  const lines = text.split(/\r?\n/);
  /** @type {{ i: number, k: number, sec: number, kind: 'bracket' | 'legacy' }[]} */
  const hits = [];
  const bracketRe = /^\s*【分镜(\d+)】\s*[（(]\s*([\d.]+)\s*秒\s*[）)]\s*[：:]?\s*$/;
  const legacyRe = /^\s*分镜(\d+)\s*[:：]\s*([\d.]+)\s*秒\s*[:：]\s*/i;

  for (let i = 0; i < lines.length; i++) {
    let m = lines[i].match(bracketRe);
    if (m) {
      const k = Number(m[1]);
      const sec = Number(m[2]);
      if (Number.isFinite(k) && k >= 1) {
        hits.push({ i, k, sec: Number.isFinite(sec) && sec > 0 ? sec : 1, kind: 'bracket' });
      }
      continue;
    }
    m = lines[i].match(legacyRe);
    if (m) {
      const k = Number(m[1]);
      const sec = Number(m[2]);
      if (Number.isFinite(k) && k >= 1) {
        hits.push({ i, k, sec: Number.isFinite(sec) && sec > 0 ? sec : 1, kind: 'legacy' });
      }
    }
  }
  if (hits.length === 0) return text;

  hits.sort((a, b) => a.k - b.k || a.i - b.i);
  const uniq = [];
  const seenK = new Set();
  for (const h of hits) {
    if (seenK.has(h.k)) continue;
    seenK.add(h.k);
    uniq.push(h);
  }
  if (uniq.length === 0) return text;

  const fmt = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10));

  if (uniq.length === 1 && uniq[0].k === 1) {
    const { i, kind } = uniq[0];
    if (kind === 'bracket') {
      lines[i] = lines[i].replace(bracketRe, `【分镜1】（${durationLabel}秒）：`);
    } else {
      lines[i] = lines[i].replace(legacyRe, `分镜1： ${durationLabel}秒: `);
    }
    return lines.join('\n');
  }

  const weights = uniq.map((h) => Math.max(0.05, h.sec));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let allocated = 0;
  const newSecs = uniq.map((_, idx) => {
    if (idx === uniq.length - 1) {
      const last = Math.round((total - allocated) * 10) / 10;
      return Math.max(0.1, last);
    }
    const raw = (total * weights[idx]) / wsum;
    const v = Math.max(0.1, Math.round(raw * 10) / 10);
    allocated += v;
    return v;
  });
  const sumMid = newSecs.slice(0, -1).reduce((a, b) => a + b, 0);
  newSecs[newSecs.length - 1] = Math.max(0.1, Math.round((total - sumMid) * 10) / 10);
  const sumAll = newSecs.reduce((a, b) => a + b, 0);
  if (sumAll > total + 0.05 || newSecs[newSecs.length - 1] < 0.09) {
    const each = Math.max(0.1, Math.round((total / uniq.length) * 10) / 10);
    for (let i = 0; i < uniq.length - 1; i++) newSecs[i] = each;
    newSecs[uniq.length - 1] = Math.max(0.1, Math.round((total - each * (uniq.length - 1)) * 10) / 10);
  }

  for (let j = 0; j < uniq.length; j++) {
    const { i, k, kind } = uniq[j];
    const lab = fmt(newSecs[j]);
    if (kind === 'bracket') {
      lines[i] = lines[i].replace(bracketRe, `【分镜${k}】（${lab}秒）：`);
    } else {
      lines[i] = lines[i].replace(legacyRe, `分镜${k}： ${lab}秒: `);
    }
  }
  return lines.join('\n');
}

module.exports = { normalizeUniversalSegmentShotDurations };
