/** 旁白可读字数：汉字/字母/数字，不含标点与空白（与后端 split 规则一致） */
const NARRATION_SPEECH_CHAR_RE = /[\u4e00-\u9fa5A-Za-z0-9]/g

const FULL_NARRATION_DURATION_MIN_SEC = 4
const FULL_NARRATION_MAX_SEC = 10

export function countNarrationSpeechChars(text) {
  const m = String(text || '').match(NARRATION_SPEECH_CHAR_RE)
  return m ? m.length : 0
}

export function clampNarrationCharsPerSec(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 5.5
  return Math.min(16, Math.max(4, Math.round(n * 10) / 10))
}

/** 按旁白可读字数估算时长（ceil(字数÷语速)，默认限制 4～10 秒） */
export function estimateNarrationDurationSec(text, charsPerSec = 5.5, opts = {}) {
  const cps = clampNarrationCharsPerSec(charsPerSec)
  const minSec = opts.minSec ?? FULL_NARRATION_DURATION_MIN_SEC
  const maxSec = opts.maxSec ?? FULL_NARRATION_MAX_SEC
  const { neededSec } = getNarrationStats(text, cps)
  if (!neededSec) return minSec
  return Math.max(minSec, Math.min(maxSec, neededSec))
}

/**
 * @returns {{ chars: number, neededSec: number, estSec: number }}
 * neededSec = 未封顶的朗读秒数；estSec = 限制在 4～10 秒后的成片估算
 */
export function getNarrationStats(text, charsPerSec = 5.5) {
  const cps = clampNarrationCharsPerSec(charsPerSec)
  const chars = countNarrationSpeechChars(text)
  if (!chars) {
    return { chars: 0, neededSec: FULL_NARRATION_DURATION_MIN_SEC, estSec: FULL_NARRATION_DURATION_MIN_SEC }
  }
  const neededSec = Math.ceil(chars / cps)
  const estSec = Math.max(
    FULL_NARRATION_DURATION_MIN_SEC,
    Math.min(FULL_NARRATION_MAX_SEC, neededSec)
  )
  return { chars, neededSec, estSec }
}
