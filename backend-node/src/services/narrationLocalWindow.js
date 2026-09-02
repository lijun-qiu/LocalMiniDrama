/**
 * 从本集剧本中定位「当前镜旁白」，截取前后约 radius 字作为局部上下文。
 * 用于生成/润色每镜片段描述（全能 / 经典视频提示词），避免整集剧本淹没本镜语义。
 */

const DEFAULT_RADIUS = 100;

function stripOuterQuotes(s) {
  return String(s || '')
    .trim()
    .replace(/^[「」""''『』]+/, '')
    .replace(/[「」""''『』]+$/, '')
    .trim();
}

/** 去掉空白与常见引号，便于在剧本中模糊定位 */
function compactForMatch(s) {
  return String(s || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[「」""''『』]/g, '');
}

/**
 * 在 script 中定位 narration 原文区间 [start, end)（相对 script 原始下标）。
 * @returns {{ start: number, end: number } | null}
 */
function locateNarrationInScript(script, narration) {
  const raw = String(script || '');
  const narr = String(narration || '').trim();
  if (!raw || !narr) return null;

  let idx = raw.indexOf(narr);
  if (idx >= 0) return { start: idx, end: idx + narr.length };

  const stripped = stripOuterQuotes(narr);
  if (stripped && stripped !== narr) {
    idx = raw.indexOf(stripped);
    if (idx >= 0) return { start: idx, end: idx + stripped.length };
  }

  // 紧凑匹配：在去空白剧本中找去空白旁白，再映射回原始区间
  const compactScript = compactForMatch(raw);
  const compactNarr = compactForMatch(stripped || narr);
  if (!compactNarr || compactNarr.length < 4) return null;
  const cIdx = compactScript.indexOf(compactNarr);
  if (cIdx < 0) return null;

  let si = 0;
  let ci = 0;
  let startRaw = -1;
  let endRaw = -1;
  while (si < raw.length && ci < compactScript.length) {
    const ch = raw[si];
    const isSkipped = /[\s\u3000「」""''『』]/.test(ch);
    if (isSkipped) {
      si += 1;
      continue;
    }
    if (ci === cIdx && startRaw < 0) startRaw = si;
    if (ci === cIdx + compactNarr.length - 1) {
      endRaw = si + 1;
      break;
    }
    ci += 1;
    si += 1;
  }
  if (startRaw >= 0 && endRaw > startRaw) return { start: startRaw, end: endRaw };
  return null;
}

/**
 * 当剧本定位失败时：用相邻镜旁白拼出前后文。
 */
function fallbackFromNeighborNarrations(current, prevNarration, nextNarration, radius) {
  const cur = String(current || '').trim();
  const prev = String(prevNarration || '').trim();
  const next = String(nextNarration || '').trim();
  const before = prev ? prev.slice(Math.max(0, prev.length - radius)) : '';
  const after = next ? next.slice(0, radius) : '';
  return {
    before,
    current: cur,
    after,
    matched: false,
    source: 'neighbor_narrations',
    start: -1,
    end: -1,
    radius,
  };
}

/**
 * @param {string} script 本集剧本 / 全文旁白原文
 * @param {string} narration 当前镜旁白
 * @param {object} [opts]
 * @param {number} [opts.radius=100] 前后各取字数
 * @param {string} [opts.prevNarration] 定位失败时的上一镜旁白
 * @param {string} [opts.nextNarration] 定位失败时的下一镜旁白
 * @returns {{ before: string, current: string, after: string, matched: boolean, source: string, start: number, end: number, radius: number, windowText: string }}
 */
function extractNarrationLocalWindow(script, narration, opts = {}) {
  const radiusRaw = opts.radius != null ? Number(opts.radius) : DEFAULT_RADIUS;
  const radius =
    Number.isFinite(radiusRaw) && radiusRaw > 0 ? Math.min(500, Math.floor(radiusRaw)) : DEFAULT_RADIUS;
  const cur = String(narration || '').trim();
  const raw = String(script || '');

  if (!cur) {
    return {
      before: '',
      current: '',
      after: '',
      matched: false,
      source: 'empty_narration',
      start: -1,
      end: -1,
      radius,
      windowText: '',
    };
  }

  const loc = locateNarrationInScript(raw, cur);
  if (!loc) {
    const fb = fallbackFromNeighborNarrations(cur, opts.prevNarration, opts.nextNarration, radius);
    return { ...fb, windowText: formatNarrationLocalWindowText(fb) };
  }

  const before = raw.slice(Math.max(0, loc.start - radius), loc.start);
  const after = raw.slice(loc.end, Math.min(raw.length, loc.end + radius));
  const current = raw.slice(loc.start, loc.end) || cur;
  const result = {
    before,
    current,
    after,
    matched: true,
    source: 'script',
    start: loc.start,
    end: loc.end,
    radius,
  };
  return { ...result, windowText: formatNarrationLocalWindowText(result) };
}

function formatNarrationLocalWindowText(win) {
  if (!win) return '';
  const lines = [
    `【前文约${win.radius}字】`,
    win.before ? win.before : '（无/篇首）',
    '',
    '【当前镜旁白】',
    win.current || '（空）',
    '',
    `【后文约${win.radius}字】`,
    win.after ? win.after : '（无/篇末）',
  ];
  return lines.join('\n');
}

/**
 * 供提示词注入的说明块。
 */
function buildNarrationLocalContextBlock(win, opts = {}) {
  const label = opts.label || 'NARRATION_LOCAL_CONTEXT';
  const radius = (win && win.radius) || opts.radius || DEFAULT_RADIUS;
  if (!win || (!win.current && !win.before && !win.after)) {
    return `${label}（当前镜旁白 ±${radius}字；用于设计本镜可视画面）:\n(无可用旁白局部上下文；仅凭本镜 NARRATION / ACTION 推断，勿编造大段新剧情)`;
  }
  const srcHint =
    win.source === 'script'
      ? '已在本集剧本中定位当前旁白'
      : win.source === 'neighbor_narrations'
        ? '剧本未精确命中，以下由相邻镜旁白近似拼出'
        : '局部上下文';
  return [
    `${label}（当前镜旁白 ±${win.radius}字剧本上下文；${srcHint}）:`,
    '用途：据此设计本镜片段描述/画面动作——以【当前镜旁白】为主，【前文/后文】只作因果衔接与语气，禁止把后文未发生事件提前拍完，禁止因文中点名就让未出场人物实体入画（提及≠出场）。',
    win.windowText || formatNarrationLocalWindowText(win),
  ].join('\n');
}

module.exports = {
  DEFAULT_RADIUS,
  stripOuterQuotes,
  compactForMatch,
  locateNarrationInScript,
  extractNarrationLocalWindow,
  formatNarrationLocalWindowText,
  buildNarrationLocalContextBlock,
};
