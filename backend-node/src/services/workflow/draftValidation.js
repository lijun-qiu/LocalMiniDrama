'use strict';

/**
 * ArcReel draft_validation subset for reference_video step1 / step2.
 */

const { parseReferenceMentions } = require('./referenceMentions');
const { DEFAULT_DURATIONS } = require('./referenceVideoPrompts');

function normalizeForSubstring(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/\s+/g, '');
}

/** 台词比对：忽略空白、括注动作、包裹引号、句末标点 */
function normalizeSpokenLine(s) {
  return normalizeForSubstring(s)
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/^[“"「『]+/g, '')
    .replace(/[”"」』]+$/g, '')
    .replace(/[。！？!?…~.]+$/g, '');
}

function extractNormativeSpeech(text) {
  const src = String(text || '');
  const { hits } = parseReferenceMentions(src);
  const out = hits
    .filter((h) => h.kind === 'speech' || h.kind === 'vo')
    .map((h) => ({
      kind: h.kind,
      name: h.name || '',
      innerMonologue: !!h.innerMonologue,
      text: String(h.text || '').trim(),
    }));

  // LLM 偶发 @{名}{台词}（应为 @[名]{台词}）
  const atBraceSpeech = /@\{([^\s{}]{1,24})\}\{([^}]*)\}/g;
  let m;
  while ((m = atBraceSpeech.exec(src)) !== null) {
    const name = m[1].trim();
    const spoken = String(m[2] || '').trim();
    if (!name || !spoken) continue;
    if (
      out.some(
        (s) =>
          s.kind === 'speech' &&
          !s.innerMonologue &&
          s.name === name &&
          normalizeSpokenLine(s.text) === normalizeSpokenLine(spoken)
      )
    ) {
      continue;
    }
    out.push({ kind: 'speech', name, innerMonologue: false, text: spoken });
  }

  // 兼容已渲染的全能句式：<名>说 / <名>内心独白 / 画外音说
  const omniSpeech = /<([^\s>]{1,24})>(?:说|内心独白)\s*\{([^}]*)\}/g;
  while ((m = omniSpeech.exec(src)) !== null) {
    const name = m[1].trim();
    const spoken = String(m[2] || '').trim();
    const innerMonologue = /内心独白\s*\{/.test(m[0]);
    if (!spoken) continue;
    if (
      out.some(
        (s) =>
          s.name === name &&
          !!s.innerMonologue === innerMonologue &&
          normalizeSpokenLine(s.text) === normalizeSpokenLine(spoken)
      )
    ) {
      continue;
    }
    out.push({
      kind: 'speech',
      name,
      innerMonologue,
      text: spoken,
    });
  }
  const omniVo = /画外音说\s*\{([^}]*)\}/g;
  while ((m = omniVo.exec(src)) !== null) {
    const spoken = String(m[1] || '').trim();
    if (!spoken) continue;
    if (out.some((s) => s.kind === 'vo' && normalizeSpokenLine(s.text) === normalizeSpokenLine(spoken))) {
      continue;
    }
    out.push({ kind: 'vo', name: '', innerMonologue: false, text: spoken });
  }

  // 兼容中文剧本行：角色（心里话）：… / 角色：…
  for (const line of collectSourceDialogueLines(src)) {
    if (
      out.some((s) => {
        if (line.vo) return s.kind === 'vo' && normalizeSpokenLine(s.text) === normalizeSpokenLine(line.text);
        if (line.inner) {
          return (
            s.innerMonologue &&
            s.name === line.name &&
            normalizeSpokenLine(s.text) === normalizeSpokenLine(line.text)
          );
        }
        return (
          s.kind === 'speech' &&
          !s.innerMonologue &&
          s.name === line.name &&
          normalizeSpokenLine(s.text) === normalizeSpokenLine(line.text)
        );
      })
    ) {
      continue;
    }
    if (line.vo) out.push({ kind: 'vo', name: '', innerMonologue: false, text: line.text });
    else {
      out.push({
        kind: 'speech',
        name: line.name,
        innerMonologue: !!line.inner,
        text: line.text,
      });
    }
  }

  return out;
}

/**
 * 把 source_text 里有、画面 text 里漏掉的台词补回（step2 扩写丢心声时的兜底）。
 * 缺失项按 source 顺序插到正文前部（画面描述之后、首句动作旁）。
 */
function ensureSourceSpeechInText(sourceText, bodyText) {
  const source = String(sourceText || '').trim();
  const body = String(bodyText || '').trim();
  if (!source) return body;
  const needed = collectSourceDialogueLines(source);
  if (!needed.length) return body;
  const present = extractNormativeSpeech(body);
  const missing = [];
  for (const n of needed) {
    const hit = present.find((s) => {
      if (n.vo) return s.kind === 'vo' && normalizeSpokenLine(s.text) === normalizeSpokenLine(n.text);
      if (n.inner) {
        return (
          s.innerMonologue &&
          s.name === n.name &&
          normalizeSpokenLine(s.text) === normalizeSpokenLine(n.text)
        );
      }
      return (
        s.kind === 'speech' &&
        !s.innerMonologue &&
        s.name === n.name &&
        normalizeSpokenLine(s.text) === normalizeSpokenLine(n.text)
      );
    });
    if (!hit) missing.push(n);
  }
  if (!missing.length) return body;

  const inject = missing
    .map((n) => {
      if (n.vo) return `{${n.text}}`;
      if (n.inner) return `@[${n.name}%内心独白]{${n.text}}`;
      return `@[${n.name}]{${n.text}}`;
    })
    .join(' ');

  // 插在「画面内容：」后；否则插在正文开头
  if (/画面内容：/.test(body)) {
    return body.replace(/画面内容：/, `画面内容：${inject} `);
  }
  return `${inject} ${body}`.trim();
}

function assertDialoguePreserved(step1Text, step2Text) {
  const a = extractNormativeSpeech(step1Text);
  const b = extractNormativeSpeech(step2Text);
  if (a.length !== b.length) {
    return {
      ok: false,
      code: 'dialogue_count_changed',
      message: `台词条数变化 ${a.length} → ${b.length}`,
    };
  }
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i].kind !== b[i].kind ||
      a[i].name !== b[i].name ||
      a[i].innerMonologue !== b[i].innerMonologue ||
      normalizeSpokenLine(a[i].text) !== normalizeSpokenLine(b[i].text)
    ) {
      return {
        ok: false,
        code: 'dialogue_not_preserved',
        message: `第 ${i + 1} 条台词被改写`,
        expected: a[i],
        got: b[i],
      };
    }
  }
  return { ok: true };
}

/** 口播计字：去掉空白与括注动作（（抬头）不念） */
function countSpokenChars(spoken) {
  return String(spoken || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s/g, '').length;
}

function estimateSpeechSeconds(text, speechRate = 5) {
  const speech = extractNormativeSpeech(text);
  let chars = 0;
  for (const s of speech) chars += countSpokenChars(s.text);
  if (!chars) return 0;
  return chars / Math.max(1, speechRate);
}

/** 口播默认语速：1 秒 5 字 */
const SPEECH_CHARS_PER_SECOND = 5;

function estimateVisualBeats(text) {
  let body = String(text || '');
  body = body.replace(/@\[[^\]]+\]\s*[：:]?\s*\{[^}]*\}/g, '');
  body = body.replace(/\{[^}]*\}/g, '');
  body = body.replace(/@\[[^\]]+\]/g, ' ');
  const parts = body
    .split(/[。！？；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return Math.max(parts.length, body.trim() ? 1 : 0);
}

function snapDuration(seconds, tiers, floors) {
  const sorted = (tiers || DEFAULT_DURATIONS).slice().sort((a, b) => a - b);
  const need = Math.max(Number(seconds) || 0, ...(floors || []).map(Number));
  for (const t of sorted) {
    if (t >= need - 1e-6) return t;
  }
  return sorted[sorted.length - 1] || 8;
}

/**
 * 按台词字数（默认 5 字/秒）+ 画面节拍，把 duration **压到最短够用档**（只取档位表中值）。
 * 超出最长档时仍取最长档，并标记 speech_overload（供前端标红，不硬失败）。
 * 拆半锁定的 `_durationLocked` unit 不改时长（保证两半之和 = 原时长）。
 * @returns {{ units: Array, adjusted: number, overloads: Array }}
 */
function enforceUnitsSpeechDuration(units, { durations, speechRate } = {}) {
  const tiers = durations || DEFAULT_DURATIONS;
  const rate = speechRate != null ? speechRate : SPEECH_CHARS_PER_SECOND;
  const maxTier = Math.max(...tiers);
  const out = [];
  let adjusted = 0;
  const overloads = [];
  for (let i = 0; i < (units || []).length; i += 1) {
    const u = units[i] || {};
    const text = String(u.text || '').trim();
    const source_text = String(u.source_text || '').trim();
    const speechFloor = estimateSpeechSeconds(text, rate);
    const speechChars = Math.round(speechFloor * rate);
    const beatFloor = estimateVisualBeats(text) * 1.5;
    const prev = Number(u.duration_seconds);
    let duration_seconds = prev;
    const locked = !!u._durationLocked && tiers.includes(duration_seconds);
    // 未锁定：压到最短够用档。锁定但本段念不完且未超最长档：优先够念（放开锁抬档）
    if (!locked) {
      duration_seconds = snapDuration(0, tiers, [speechFloor, beatFloor]);
    } else if (speechFloor > duration_seconds * 1.05 && speechFloor <= maxTier * 1.05) {
      duration_seconds = snapDuration(0, tiers, [speechFloor, beatFloor]);
    }
    if (duration_seconds !== prev) adjusted += 1;
    const speech_overload = speechFloor > duration_seconds * 1.05 || speechFloor > maxTier * 1.05;
    if (speech_overload) {
      overloads.push({
        code: 'dialogue_overload',
        unit_index: i,
        unit_id: u.unit_id,
        speechSec: Math.round(speechFloor * 100) / 100,
        duration: duration_seconds,
        max_tier: maxTier,
        chars: speechChars,
        message: `台词约 ${speechChars} 字（${rate}字/秒≈${speechFloor.toFixed(1)}s）超过本段 ${duration_seconds}s（模型最长 ${maxTier}s）`,
      });
    }
    const { _durationLocked, ...rest } = u;
    out.push({
      ...rest,
      duration_seconds,
      source_text,
      text,
      speech_seconds: Math.round(speechFloor * 100) / 100,
      speech_chars: speechChars,
      speech_overload: !!speech_overload,
    });
  }
  return { units: out, adjusted, overloads };
}

/**
 * 原 unit 时长拆给两半：
 * 1) 优先两半都够念（可略大于原时长总和）；
 * 2) 其次 a+b === 原时长；
 * 3) 再按台词占比贴近。
 */
function allocatePairDurations(totalDur, speechHead, speechTail, tiers) {
  const sorted = (tiers || DEFAULT_DURATIONS).slice().sort((a, b) => a - b);
  const maxTier = sorted[sorted.length - 1] || 12;
  const T = Number(totalDur);
  const total = Number.isFinite(T) && T > 0 ? T : maxTier;
  const sh = Math.max(0, Number(speechHead) || 0);
  const st = Math.max(0, Number(speechTail) || 0);
  const speechSum = sh + st || 1;
  const needH = Math.min(maxTier, Math.ceil(sh - 1e-9) || sorted[0]);
  const needT = Math.min(maxTier, Math.ceil(st - 1e-9) || sorted[0]);

  function scorePair(a, b) {
    const overload = Math.max(0, sh - a) + Math.max(0, st - b);
    const prop = Math.abs(a / (a + b) - sh / speechSum);
    const sumDiff = Math.abs(a + b - Math.max(total, needH + needT));
    const balance = Math.abs(a - b);
    return overload * 1000 + sumDiff * 10 + prop * 5 + balance * 0.01;
  }

  // 优先：两半都盖住各自台词下界
  let bestFit = null;
  let bestFitScore = Infinity;
  for (const a of sorted) {
    if (a < needH && a < maxTier) continue;
    for (const b of sorted) {
      if (b < needT && b < maxTier) continue;
      if (a < sh - 1e-6 || b < st - 1e-6) {
        // 仍不够念则跳过（除非已是最长档）
        if (a < maxTier && a < sh - 1e-6) continue;
        if (b < maxTier && b < st - 1e-6) continue;
      }
      const s = scorePair(a, b);
      if (s < bestFitScore) {
        bestFitScore = s;
        bestFit = [a, b];
      }
    }
  }
  if (bestFit) return { head: bestFit[0], tail: bestFit[1] };

  const pairs = [];
  for (const a of sorted) {
    for (const b of sorted) {
      if (a + b === total) pairs.push([a, b]);
    }
  }
  if (!pairs.length) {
    let best = [sorted[0], sorted[0]];
    let bestDiff = Infinity;
    for (const a of sorted) {
      for (const b of sorted) {
        const d = Math.abs(a + b - total);
        if (d < bestDiff) {
          bestDiff = d;
          best = [a, b];
        }
      }
    }
    pairs.push(best);
  }

  let bestPair = pairs[0];
  let bestScore = Infinity;
  for (const [a, b] of pairs) {
    const s = scorePair(a, b);
    if (s < bestScore) {
      bestScore = s;
      bestPair = [a, b];
    }
  }
  return { head: bestPair[0], tail: bestPair[1] };
}

/**
 * 原 unit 里出现过的角色/场景/道具视觉引用（含说话人），拆半后两端都要带上。
 */
function collectSharedVisualTokens(text) {
  const { hits } = parseReferenceMentions(text);
  const tokens = [];
  const seen = new Set();
  for (const h of hits || []) {
    if (!h || !h.name) continue;
    if (h.kind === 'vo') continue;
    const look = h.look && h.look !== 'base' ? h.look : '';
    const key = `${h.name}@${look || 'base'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(look ? `@[${h.name}@${look}]` : `@[${h.name}]`);
  }
  return tokens;
}

function ensureSharedVisualTokens(text, tokens) {
  let body = String(text || '').trim();
  if (!tokens || !tokens.length) return body;
  const missing = [];
  for (const tok of tokens) {
    const name = String(tok).match(/@\[([^\]@%]+)/)?.[1];
    if (!name) continue;
    if (
      body.includes(`@[${name}]`) ||
      body.includes(`@[${name}@`) ||
      body.includes(`@[${name}%`)
    ) {
      continue;
    }
    missing.push(tok);
  }
  if (!missing.length) return body;
  const inject = missing.join(' ');
  const lines = body.split(/\r?\n/);
  if (lines.length && /^【分场】/.test(lines[0])) {
    return [lines[0], inject, ...lines.slice(1)].join('\n');
  }
  return `${inject}\n${body}`;
}

function validateStep1Unit(unit, { novelText, registeredNames, durations, maxRefs, speechRate }) {
  const violations = [];
  const source = String(unit.source_text || '').trim();
  const text = String(unit.text || '').trim();
  if (!source) violations.push({ code: 'source_text_empty' });
  else {
    const nNovel = normalizeForSubstring(novelText);
    const nSrc = normalizeForSubstring(source);
    if (!nSrc || !nNovel.includes(nSrc)) {
      violations.push({ code: 'source_text_not_verbatim' });
    }
  }
  if (!text) violations.push({ code: 'empty_text' });

  const speechOnly = !text.replace(/@\[[^\]]+\]\s*[：:]?\s*\{[^}]*\}/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, '');
  if (text && speechOnly) violations.push({ code: 'blank_description' });

  const { hits, errors } = parseReferenceMentions(text);
  for (const e of errors || []) violations.push({ code: 'malformed_mention', message: e });

  const nameSet = new Set((registeredNames || []).map((n) => String(n).trim()).filter(Boolean));
  const visualRefs = [];
  for (const h of hits) {
    if (h.kind === 'asset' && h.name) {
      if (!nameSet.has(h.name)) violations.push({ code: 'unregistered_asset', name: h.name });
      visualRefs.push(`${h.name}@${h.look || 'base'}`);
    }
    if ((h.kind === 'speech' || h.kind === 'vo') && h.name && !nameSet.has(h.name) && h.kind === 'speech') {
      if (!nameSet.has(h.name)) violations.push({ code: 'unregistered_speaker', name: h.name });
    }
  }
  const uniqRefs = [...new Set(visualRefs)];
  if (maxRefs && uniqRefs.length > maxRefs) {
    violations.push({ code: 'refs_over_limit', count: uniqRefs.length, max: maxRefs });
  }

  const dur = Number(unit.duration_seconds);
  const tiers = durations || DEFAULT_DURATIONS;
  if (!tiers.includes(dur)) {
    violations.push({ code: 'duration_off_tier', duration: dur, tiers });
  }
  const speechSec = estimateSpeechSeconds(text, speechRate);
  if (speechSec > dur * 1.05) {
    violations.push({ code: 'dialogue_overload', speechSec, duration: dur });
  }
  const beats = estimateVisualBeats(text);
  if (beats > 1 && beats * 1.5 > dur * 1.2) {
    violations.push({ code: 'visual_density_overload', beats, duration: dur });
  }

  return violations;
}

/** 画面要素标签，不是说话人 */
const NON_SPEAKER_LABELS = /^(景别|构图|运镜|画面内容|环境音|音效|字幕|备注|动作|镜头|时长|标题|style|Style)$/i;

/** 叙述腔「说话人」：含逗号/声音传来/字迹等，不是角色名：台词 */
const NARRATION_SPEAKER_RE = /[，,]|声音|传来|字迹|写道|说道|问道|喊道|外面|里面|这时|突然|画面|镜头|纸上|纸条/;

function stripWrappingQuotes(s) {
  return String(s || '')
    .trim()
    .replace(/^[“"「『]+/, '')
    .replace(/[”"」』]+$/, '');
}

function isPlausibleSpeakerName(name) {
  const n = String(name || '').trim();
  if (!n || n.length > 12) return false;
  if (/[，,。！？!?]/.test(n)) return false;
  if (NARRATION_SPEAKER_RE.test(n)) return false;
  if (NON_SPEAKER_LABELS.test(n)) return false;
  if (/^第\s*[\d一二三四五六七八九十百千两零〇]+\s*集$/.test(n)) return false;
  return true;
}

function collectSourceDialogueLines(novelText) {
  const lines = String(novelText || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let m = t.match(/^(.{1,24}?)[（(]\s*(?:心里话|内心独白|心声)\s*[）)]\s*[：:]\s*(.+)$/);
    if (m && isPlausibleSpeakerName(m[1])) {
      out.push({ name: m[1].trim(), text: m[2].trim(), inner: true });
      continue;
    }
    m = t.match(/^(旁白|画外音|VO)\s*[：:]\s*(.+)$/i);
    if (m) {
      out.push({ name: '', text: stripWrappingQuotes(m[2]), vo: true });
      continue;
    }
    // 画外声：…母亲的声音远远传来：“找到了吗？”
    m = t.match(
      /([\u4e00-\u9fffA-Za-z0-9·]{1,8})的声音[^：“"「]{0,30}[：:]\s*[“"「](.+?)[”"」]\s*$/
    );
    if (m) {
      out.push({ name: m[1].trim(), text: stripWrappingQuotes(m[2]), inner: false });
      continue;
    }
    // 字迹/纸条引文：道具文字，不作对白硬门禁
    if (
      /的字迹\s*[：:]/.test(t) ||
      (/^[“"「].+[”"」]\s*$/.test(t) && !/^[^\s@【\]：:]{1,12}\s*[：:]/.test(t))
    ) {
      continue;
    }
    m = t.match(/^([^\s@【\]：:]{1,24})\s*[：:]\s*(.+)$/);
    if (m && isPlausibleSpeakerName(m[1])) {
      out.push({ name: m[1].trim(), text: m[2].trim(), inner: false });
    }
  }
  return out;
}

function speechLineMatches(needed, present) {
  if (needed.vo) {
    return present.kind === 'vo' && normalizeSpokenLine(present.text) === normalizeSpokenLine(needed.text);
  }
  if (needed.inner) {
    return (
      !!present.innerMonologue &&
      present.name === needed.name &&
      normalizeSpokenLine(present.text) === normalizeSpokenLine(needed.text)
    );
  }
  return (
    present.kind === 'speech' &&
    !present.innerMonologue &&
    present.name === needed.name &&
    normalizeSpokenLine(present.text) === normalizeSpokenLine(needed.text)
  );
}

/** 列出 source 有、body 没有的台词（硬规则核对） */
function listMissingSourceSpeech(sourceText, bodyText) {
  const needed = collectSourceDialogueLines(sourceText);
  if (!needed.length) return [];
  const present = extractNormativeSpeech(bodyText);
  return needed.filter((n) => !present.some((s) => speechLineMatches(n, s)));
}

function assertSourceSpeechCovered(sourceText, bodyText) {
  const missing = listMissingSourceSpeech(sourceText, bodyText);
  if (!missing.length) return { ok: true, missing: [] };
  return {
    ok: false,
    code: 'source_dialogue_omitted',
    missing,
    message: `缺少 ${missing.length} 句源文台词/心声（例：${missing[0].name || '旁白'}：${String(missing[0].text || '').slice(0, 24)}）`,
  };
}

/**
 * 统一规则：先按 source_text 机械回填，再校验；仍缺则记 violation。
 * @returns {{ units: Array, violations: Array, repaired: number }}
 */
function enforceUnitsSourceSpeech(units) {
  const out = [];
  const violations = [];
  let repaired = 0;
  for (let i = 0; i < (units || []).length; i += 1) {
    const u = units[i] || {};
    const source_text = String(u.source_text || '').trim();
    let text = String(u.text || '').trim();
    const before = text;
    text = ensureSourceSpeechInText(source_text, text);
    if (text !== before) repaired += 1;
    const check = assertSourceSpeechCovered(source_text, text);
    if (!check.ok) {
      for (const m of check.missing) {
        violations.push({
          code: 'source_dialogue_omitted',
          unit_index: i,
          name: m.name,
          text: String(m.text || '').slice(0, 40),
          inner: !!m.inner,
          vo: !!m.vo,
        });
      }
    }
    out.push({ ...u, source_text, text });
  }
  return { units: out, violations, repaired };
}

function validateSourceDialogueCoverage(novelText, units) {
  const needed = collectSourceDialogueLines(novelText);
  if (!needed.length) return [];
  const allSpeech = [];
  for (const u of units || []) {
    allSpeech.push(...extractNormativeSpeech(u.text));
  }
  const violations = [];
  for (const n of needed) {
    const hit = allSpeech.find((s) => speechLineMatches(n, s));
    if (!hit) {
      violations.push({
        code: 'source_dialogue_omitted',
        name: n.name,
        text: n.text.slice(0, 40),
        inner: !!n.inner,
        vo: !!n.vo,
      });
    }
  }
  return violations;
}

function formatInjectSourceLine(n) {
  if (n.vo) return `旁白：${n.text}`;
  if (n.inner) return `${n.name}（心里话）：${n.text}`;
  return `${n.name}：${n.text}`;
}

/**
 * 剧本级漏句：补进最相关 unit（按说话人/片段命中），避免 LLM 略写导致硬失败。
 * @returns {{ units: Array, repaired: number, remaining: Array }}
 */
function repairScriptDialogueCoverage(novelText, units) {
  const missing = validateSourceDialogueCoverage(novelText, units);
  if (!missing.length) return { units: units || [], repaired: 0, remaining: [] };
  const list = (units || []).map((u) => ({ ...u }));
  if (!list.length) {
    list.push({ text: '', source_text: String(novelText || '') });
  }
  let repaired = 0;
  for (const m of missing) {
    const needle = normalizeSpokenLine(m.text).slice(0, 8);
    let idx = list.findIndex((u) => {
      const blob = `${u.source_text || ''}\n${u.text || ''}`;
      if (m.name && blob.includes(m.name)) return true;
      if (needle && normalizeSpokenLine(blob).includes(needle)) return true;
      return false;
    });
    if (idx < 0) idx = list.length - 1;
    const srcLine = formatInjectSourceLine(m);
    const before = String(list[idx].text || '');
    const nextText = ensureSourceSpeechInText(srcLine, before);
    const nextSource = String(list[idx].source_text || '').includes(String(m.text || '').slice(0, 6))
      ? list[idx].source_text
      : [list[idx].source_text, srcLine].filter(Boolean).join('\n');
    list[idx] = { ...list[idx], text: nextText, source_text: nextSource };
    if (nextText !== before) repaired += 1;
  }
  return {
    units: list,
    repaired,
    remaining: validateSourceDialogueCoverage(novelText, list),
  };
}

function sceneKeyFromText(text) {
  const m = String(text || '').match(/【分场】\s*([^\n]+)/);
  return m ? m[1].trim() : '';
}

function lineSpeechChars(line) {
  const speech = extractNormativeSpeech(line);
  let n = 0;
  for (const s of speech) n += countSpokenChars(s.text);
  return n;
}

function countSpeechLinesInText(text) {
  return extractNormativeSpeech(text).length;
}

/** 把同一行里多句 @[名]{台词} 拆成多行，便于按台词预算切开 */
function segmentTextBySpeechBeats(text) {
  const src = String(text || '').trim();
  if (!src) return [];
  const lines = src.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) return lines;

  // 单行多对白：在每句说话/心声后断行
  const one = lines[0] || src;
  const parts = [];
  const re = /@\[[^\]]+\](?:%内心独白)?\s*\{[^}]*\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(one)) !== null) {
    const end = m.index + m[0].length;
    const chunk = one.slice(last, end).trim();
    if (chunk) parts.push(chunk);
    last = end;
  }
  const rest = one.slice(last).trim();
  if (rest) parts.push(rest);
  return parts.length >= 2 ? parts : lines.length ? lines : [src];
}

function splitSourceBySpeechLineCount(sourceText, keepSpeechLines) {
  const lines = String(sourceText || '').split(/\r?\n/);
  if (!keepSpeechLines || keepSpeechLines <= 0) {
    return { head: '', tail: String(sourceText || '').trim() };
  }
  let seen = 0;
  let cut = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const dlg = collectSourceDialogueLines(lines[i]);
    if (dlg.length) {
      seen += dlg.length;
      if (seen >= keepSpeechLines) {
        cut = i + 1;
        break;
      }
    }
  }
  return {
    head: lines.slice(0, cut).join('\n').trim(),
    tail: lines.slice(cut).join('\n').trim(),
  };
}

/**
 * 在台词预算内切开 unit：两端各 ≤ maxChars，优先台词量接近均分（避免 12+4）。
 * 两半时长按各自台词下界取档；角色/场景/道具视觉引用两端一致。
 * 支持同一行多句对白（按 @[名]{…} 节拍切开）。
 * @returns {{ head: object, tail: object } | null}
 */
function splitUnitAtSpeechBudget(unit, maxChars, speechRate, tiers) {
  const text = String(unit.text || '').trim();
  if (!text) return null;
  const lines = segmentTextBySpeechBeats(text);
  if (lines.length < 2) return null;

  const speechAt = lines.map((l) => lineSpeechChars(l));
  const totalSpeech = speechAt.reduce((a, b) => a + b, 0);
  if (totalSpeech <= 0) return null;
  // 与时长硬门禁一致：允许略超 maxChars（≤ maxTier*1.05 字）
  const softMax = Math.max(maxChars, Math.floor(maxChars * 1.05));

  let cutAfter = -1;
  let bestScore = Infinity;
  let cum = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    cum += speechAt[i];
    const headChars = cum;
    const tailChars = totalSpeech - cum;
    if (headChars <= 0 || tailChars <= 0) continue;
    if (headChars > softMax || tailChars > softMax) continue;
    // 均分优先；其次避免某一侧过短
    const balance = Math.abs(headChars - tailChars);
    const minSide = Math.min(headChars, tailChars);
    const score = balance * 10 - minSide;
    if (score < bestScore) {
      bestScore = score;
      cutAfter = i;
    }
  }
  if (cutAfter < 0) {
    // 无法均分盖住：退回「塞满 head、尾至少 1 句」
    cum = 0;
    cutAfter = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const add = speechAt[i];
      if (add <= 0) continue;
      if (cum > 0 && cum + add > softMax) break;
      cum += add;
      cutAfter = i;
      if (cum >= maxChars) break;
    }
    if (cutAfter < 0) return null;
    let tailSpeech = 0;
    for (let j = cutAfter + 1; j < lines.length; j += 1) tailSpeech += speechAt[j];
    if (tailSpeech <= 0) {
      for (let i = cutAfter; i >= 0; i -= 1) {
        if (speechAt[i] > 0) {
          cutAfter = i - 1;
          break;
        }
      }
      if (cutAfter < 0) return null;
      tailSpeech = 0;
      for (let j = cutAfter + 1; j < lines.length; j += 1) tailSpeech += speechAt[j];
      if (tailSpeech <= 0) return null;
    }
    if (cum > softMax) return null;
  }

  const headLines = lines.slice(0, cutAfter + 1);
  let tailLines = lines.slice(cutAfter + 1);
  const scene = sceneKeyFromText(text);
  if (scene && !tailLines.some((l) => /【分场】/.test(l))) {
    tailLines = [`【分场】${scene}`, ...tailLines];
  }

  const sharedTokens = collectSharedVisualTokens(text);
  let headText = ensureSharedVisualTokens(headLines.join('\n').trim(), sharedTokens);
  let tailText = ensureSharedVisualTokens(tailLines.join('\n').trim(), sharedTokens);
  if (!headText || !tailText) return null;
  const rate = speechRate != null ? speechRate : SPEECH_CHARS_PER_SECOND;
  const headSec = estimateSpeechSeconds(headText, rate);
  const tailSec = estimateSpeechSeconds(tailText, rate);
  const maxSec = maxChars / Math.max(1, rate);
  if (headSec > maxSec * 1.05 + 0.01 || tailSec > maxSec * 1.05 + 0.01) {
    return null;
  }

  const keepSpeech = countSpeechLinesInText(headText);
  const srcParts = splitSourceBySpeechLineCount(unit.source_text, keepSpeech);
  const durTiers = tiers || DEFAULT_DURATIONS;
  const pair = allocatePairDurations(unit.duration_seconds, headSec, tailSec, durTiers);

  return {
    head: {
      ...unit,
      text: headText,
      source_text: srcParts.head || String(unit.source_text || '').trim(),
      duration_seconds: pair.head,
      _durationLocked: true,
      speech_overload: false,
    },
    tail: {
      ...unit,
      unit_id: undefined,
      text: tailText,
      source_text: srcParts.tail || '',
      duration_seconds: pair.tail,
      _durationLocked: true,
      speech_overload: false,
    },
  };
}

/**
 * 溢出段是否适合接到下一 unit：同分场、合并后不超最长档。
 */
function canJoinOverflowWithNext(overflowUnit, nextUnit, maxTier, speechRate) {
  if (!nextUnit) return false;
  const skOver = sceneKeyFromText(overflowUnit.text);
  const skNext = sceneKeyFromText(nextUnit.text);
  if (skOver && skNext && skOver !== skNext) return false;
  // 下一镜以新分场开头且与溢出段不同 → 不接
  if (skNext && skOver && skNext !== skOver) return false;
  if (!skOver && skNext) {
    // 溢出无分场、下一镜有明确分场：多为新场，不接
    return false;
  }
  const mergedText = `${String(overflowUnit.text || '').trim()}\n${String(nextUnit.text || '').trim()}`.trim();
  if (estimateSpeechSeconds(mergedText, speechRate) > maxTier * 1.05) return false;
  return true;
}

function mergeUnitTexts(front, back) {
  let frontText = String(front.text || '').trim();
  let backText = String(back.text || '').trim();
  const skF = sceneKeyFromText(frontText);
  const skB = sceneKeyFromText(backText);
  if (skF && skB && skF === skB) {
    // 去掉后段重复分场头
    backText = backText.replace(/^【分场】[^\n]*\n?/, '').trim();
  }
  const text = `${frontText}\n${backText}`.trim();
  const source_text = [front.source_text, back.source_text]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return {
    ...back,
    text,
    source_text: source_text || String(back.source_text || front.source_text || '').trim(),
  };
}

/**
 * 超最长档台词：优先拆半；若溢出段与下一镜同分场且合并不超长则并入下一镜，否则独立成新 unit。
 * 拆成两半时：时长之和 = 原时长；角色/场景/道具引用两端一致。
 * 可能多轮拆到全部 ≤ maxTier 或无法再拆。
 */
function repairSpeechOverloadUnits(units, { durations, speechRate } = {}) {
  const tiers = durations || DEFAULT_DURATIONS;
  const rate = speechRate != null ? speechRate : SPEECH_CHARS_PER_SECOND;
  const maxTier = Math.max(...tiers);
  const maxChars = Math.floor(maxTier * rate);
  let list = (units || []).map((u) => ({ ...u }));
  let splits = 0;
  let merges = 0;
  const maxPasses = Math.max(8, list.length * 3);
  const unsplittable = new Set();

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let i = list.findIndex(
      (u, idx) =>
        !unsplittable.has(idx) && estimateSpeechSeconds(u.text, rate) > maxTier * 1.05
    );
    if (i < 0) break;
    // 拆前解除锁定并抬到够用档（通常是最长档），再按该时长拆给两半
    const { _durationLocked: _ignored, ...unlocked } = list[i];
    const before = enforceUnitsSpeechDuration([unlocked], { durations: tiers, speechRate: rate });
    list[i] = before.units[0];
    const split = splitUnitAtSpeechBudget(list[i], maxChars, rate, tiers);
    if (!split) {
      unsplittable.add(i);
      continue;
    }
    list[i] = split.head;
    splits += 1;
    const next = list[i + 1];
    if (canJoinOverflowWithNext(split.tail, next, maxTier, rate)) {
      // 并入下一镜：只锁定前半时长；尾段并入后由下一镜再压到最短够用档
      const { _durationLocked, ...tailRest } = split.tail;
      list[i + 1] = mergeUnitTexts(tailRest, next);
      merges += 1;
    } else {
      list.splice(i + 1, 0, split.tail);
    }
    // 插入/合并后下标变化，清空失败标记重试
    unsplittable.clear();
  }

  const annotated = enforceUnitsSpeechDuration(list, { durations: tiers, speechRate: rate });
  return {
    ...annotated,
    splits,
    merges,
  };
}

function normalizeStep1Units(rawUnits, { novelText, durations, speechRate }) {
  const repaired = repairSpeechOverloadUnits(rawUnits, { durations, speechRate });
  return repaired.units.map((u) => ({
    duration_seconds: u.duration_seconds,
    source_text: u.source_text,
    text: u.text,
    speech_seconds: u.speech_seconds,
    speech_chars: u.speech_chars,
    speech_overload: !!u.speech_overload,
    ...(u.unit_id ? { unit_id: u.unit_id } : {}),
  }));
}

module.exports = {
  normalizeForSubstring,
  normalizeSpokenLine,
  extractNormativeSpeech,
  assertDialoguePreserved,
  assertSourceSpeechCovered,
  listMissingSourceSpeech,
  enforceUnitsSourceSpeech,
  enforceUnitsSpeechDuration,
  repairSpeechOverloadUnits,
  splitUnitAtSpeechBudget,
  canJoinOverflowWithNext,
  allocatePairDurations,
  collectSharedVisualTokens,
  ensureSharedVisualTokens,
  SPEECH_CHARS_PER_SECOND,
  estimateSpeechSeconds,
  estimateVisualBeats,
  snapDuration,
  validateStep1Unit,
  validateSourceDialogueCoverage,
  repairScriptDialogueCoverage,
  collectSourceDialogueLines,
  ensureSourceSpeechInText,
  normalizeStep1Units,
};
