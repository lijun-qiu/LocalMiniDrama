/** 旁白可读字数：汉字/字母/数字，不含标点与空白（与后端 split 规则一致） */
const NARRATION_SPEECH_CHAR_RE = /[\u4e00-\u9fa5A-Za-z0-9]/g

const NARRATION_CHARS_PER_SEC_DEFAULT = 5.5
const FULL_NARRATION_DURATION_MIN_SEC = 4
const FULL_NARRATION_MAX_SEC = 12
/** @deprecated 与 FULL_NARRATION_MAX_SEC 相同 */
const UNIVERSAL_FULL_NARRATION_MAX_SEC = 12

/**
 * 配音用旁白展示：去掉空行（保留单行换行），避免 TTS 文本框与朗读出现空白停顿。
 */
export function collapseNarrationBlankLines(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!raw) return ''
  return raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n')
    .trim()
}

export function countNarrationSpeechChars(text) {
  const m = String(text || '').match(NARRATION_SPEECH_CHAR_RE)
  return m ? m.length : 0
}

export function clampNarrationCharsPerSec(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return NARRATION_CHARS_PER_SEC_DEFAULT
  return Math.min(16, Math.max(4, Math.round(n * 10) / 10))
}

/** 按旁白可读字数估算时长（ceil(字数÷语速)，默认限制 4～12 秒） */
export function estimateNarrationDurationSec(text, charsPerSec = NARRATION_CHARS_PER_SEC_DEFAULT, opts = {}) {
  const cps = clampNarrationCharsPerSec(charsPerSec)
  const minSec = opts.minSec ?? FULL_NARRATION_DURATION_MIN_SEC
  const maxSec = opts.maxSec ?? FULL_NARRATION_MAX_SEC
  const { neededSec } = getNarrationStats(text, cps, { minSec, maxSec })
  if (!neededSec) return minSec
  return Math.max(minSec, Math.min(maxSec, neededSec))
}

/**
 * @returns {{ chars: number, neededSec: number, estSec: number }}
 * neededSec = 未封顶的朗读秒数；estSec = 限制在 min～max 秒后的成片估算
 */
export function getNarrationStats(text, charsPerSec = NARRATION_CHARS_PER_SEC_DEFAULT, opts = {}) {
  const cps = clampNarrationCharsPerSec(charsPerSec)
  const minSec = opts.minSec ?? FULL_NARRATION_DURATION_MIN_SEC
  const maxSec = opts.maxSec ?? FULL_NARRATION_MAX_SEC
  const chars = countNarrationSpeechChars(text)
  if (!chars) {
    return { chars: 0, neededSec: minSec, estSec: minSec }
  }
  const neededSec = Math.ceil(chars / cps)
  const estSec = Math.max(minSec, Math.min(maxSec, neededSec))
  return { chars, neededSec, estSec }
}

export {
  FULL_NARRATION_DURATION_MIN_SEC,
  FULL_NARRATION_MAX_SEC,
  UNIVERSAL_FULL_NARRATION_MAX_SEC,
  NARRATION_CHARS_PER_SEC_DEFAULT,
}
