/**
 * 前端：旁白时间轴 ↔ 子分镜秒数（与后端 universalNarrationBeatTimeline 对齐）
 */

import { parseUniversalMultiBeatText, composeUniversalMultiBeatText } from './universalMultiBeatParse.js'

const SPEECH_CHAR_RE = /[\u4e00-\u9fa5A-Za-z0-9]/g
const STRONG_PUNCT_RE = /([。！？!?；;])/g
const WEAK_PUNCT_RE = /([，,、：:])/g

function splitByPunct(text, re) {
  const parts = String(text || '').split(re)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    const chunk = (parts[i] || '').trim()
    const punct = parts[i + 1] || ''
    if (!chunk && !punct) continue
    const line = `${chunk}${punct}`.trim()
    if (line) out.push(line)
  }
  return out.length ? out : [String(text || '').trim()].filter(Boolean)
}

function mergeWeakParts(parts) {
  const out = []
  let buf = ''
  for (const p of parts) {
    if (!buf) {
      buf = p
      continue
    }
    if (buf.length < 8) buf += p
    else {
      out.push(buf)
      buf = p
    }
  }
  if (buf) out.push(buf)
  return out
}

function splitNarrationChunk(chunk) {
  const flat = String(chunk || '').replace(/\s+/g, ' ').trim()
  if (!flat) return []
  const strongParts = splitByPunct(flat, STRONG_PUNCT_RE)
  const result = []
  for (const strongPart of strongParts) {
    const weakParts = splitByPunct(strongPart, WEAK_PUNCT_RE)
    result.push(...(weakParts.length > 1 ? mergeWeakParts(weakParts) : weakParts))
  }
  return result.length ? result : [flat]
}

export function splitNarrationUnits(narration) {
  const normalized = String(narration || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const lines = []
  for (const block of normalized.split(/\n+/)) {
    const flat = block.replace(/\s+/g, ' ').trim()
    if (!flat) continue
    lines.push(...splitNarrationChunk(flat))
  }
  return lines.filter(Boolean)
}

function mergeUnitsToBeatCount(units, M) {
  const m = Math.max(1, M)
  const out = Array.from({ length: m }, () => [])
  if (!units.length) return out
  if (m === 1) {
    out[0] = units.slice()
    return out
  }
  if (units.length === m) {
    for (let i = 0; i < m; i++) out[i] = [units[i]]
    return out
  }
  for (let i = 0; i < units.length; i++) {
    const bi = Math.min(m - 1, Math.floor((i * m) / units.length))
    out[bi].push(units[i])
  }
  return out
}

export function countSpeechChars(text) {
  const m = String(text || '').match(SPEECH_CHAR_RE)
  return m ? m.length : 0
}

/** 按旁白可读字权重分配整数秒，和为 totalSec（每拍至少 1 秒） */
export function splitDurationByNarrationWeights(totalSec, texts) {
  const total = Math.max(1, Math.round(Number(totalSec) || 1))
  const list = Array.isArray(texts) ? texts : []
  const m = Math.max(1, list.length)
  if (m === 1) return [total]

  const weights = list.map((t) => Math.max(1, countSpeechChars(t) || 1))
  const wsum = weights.reduce((a, b) => a + b, 0)
  let allocated = 0
  const secs = weights.map((w, idx) => {
    if (idx === m - 1) return Math.max(1, total - allocated)
    const ideal = (total * w) / wsum
    const v = Math.max(1, Math.round(ideal))
    allocated += v
    return v
  })
  let sum = secs.reduce((a, b) => a + b, 0)
  if (sum !== total) {
    secs[m - 1] = Math.max(1, secs[m - 1] + (total - sum))
    sum = secs.reduce((a, b) => a + b, 0)
  }
  while (sum > total) {
    const i = secs.findIndex((s) => s > 1)
    if (i < 0) break
    secs[i] -= 1
    sum -= 1
  }
  while (sum < total) {
    secs[0] += 1
    sum += 1
  }
  return secs
}

/** @returns {{ beats: Array, units: string[] }} */
export function buildNarrationBeatTimeline(narration, totalSec, M) {
  const total = Math.max(1, Math.round(Number(totalSec) || 1))
  const beatM = Math.max(1, Math.min(8, Number(M) || 1))
  const units = splitNarrationUnits(narration)
  const groups = mergeUnitsToBeatCount(units, beatM)
  const excerpts = groups.map((g) => g.join('').trim())
  const secs = splitDurationByNarrationWeights(total, excerpts)
  let t = 0
  const beats = secs.map((sec, i) => {
    const startSec = t
    const endSec = t + sec
    t = endSec
    return {
      index: i + 1,
      seconds: sec,
      startSec,
      endSec,
      narrationExcerpt: excerpts[i] || '',
    }
  })
  return { beats, units }
}

/** 当前 beat 秒数是否与旁白权重建议一致 */
export function beatsSecondsMisalignedWithNarration(beats, narration, totalSec) {
  const list = Array.isArray(beats) ? beats : []
  const narr = String(narration || '').trim()
  if (!list.length || !narr) return false
  const { beats: ideal } = buildNarrationBeatTimeline(narr, totalSec, list.length)
  return list.some((b, i) => ideal[i] && Number(b.seconds) !== Number(ideal[i].seconds))
}

/**
 * 按旁白权重重写各「分镜k： Tk秒:」的 Tk（保留正文）
 * @returns {{ ok: boolean, text: string, changed: boolean, idealSeconds?: number[] }}
 */
export function alignUniversalBeatSecondsToNarration(text, totalSec, narration) {
  const raw = String(text || '').trim()
  if (!raw || !String(narration || '').trim()) {
    return { ok: false, text: raw, changed: false }
  }
  const parsed = parseUniversalMultiBeatText(raw)
  if (!parsed.ok || !parsed.beats.length) {
    return { ok: false, text: raw, changed: false }
  }
  const M = parsed.beats.length
  const { beats: timeline } = buildNarrationBeatTimeline(narration, totalSec, M)
  const idealSeconds = timeline.map((t) => t.seconds)
  let changed = false
  const newBeats = parsed.beats.map((b, i) => {
    const tl = timeline[i]
    if (!tl || Number(b.seconds) === Number(tl.seconds)) return b
    changed = true
    return { ...b, seconds: tl.seconds }
  })
  if (!changed) {
    return { ok: true, text: raw, changed: false, idealSeconds }
  }
  return {
    ok: true,
    text: composeUniversalMultiBeatText(parsed.headerLines, newBeats),
    changed: true,
    idealSeconds,
  }
}

/** 为已解析的 beats 补 startSec/endSec/timeLabel；有旁白时附 narrationExcerpt */
export function enrichUniversalBeatsWithTimeline(beats, narration = '') {
  const list = Array.isArray(beats) ? beats : []
  if (!list.length) return []
  let t = 0
  const withTime = list.map((b) => {
    const sec = Number.isFinite(Number(b.seconds)) && Number(b.seconds) > 0 ? Number(b.seconds) : 1
    const startSec = t
    const endSec = t + sec
    t = endSec
    const fmt = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10))
    return {
      ...b,
      seconds: sec,
      startSec,
      endSec,
      timeLabel: `${fmt(startSec)}～${fmt(endSec)}s`,
      narrationExcerpt: '',
    }
  })

  const units = splitNarrationUnits(narration)
  if (!units.length) return withTime
  const groups = mergeUnitsToBeatCount(units, withTime.length)
  return withTime.map((b, i) => ({
    ...b,
    narrationExcerpt: (groups[i] || []).join('').trim(),
  }))
}
