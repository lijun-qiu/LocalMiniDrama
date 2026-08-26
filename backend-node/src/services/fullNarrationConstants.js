/** 中文解说朗读语速默认值：5.5 字/秒（不含标点） */
const NARRATION_CHARS_PER_SEC_DEFAULT = 5.5;
/**
 * 全文解说分段（统一规则）：
 * - 目标约 9 秒 / 50 字（= 语速 × 9）
 * - 硬上限 10 秒 / 55 字（= 语速 × 10）
 * - 只在句读符号处切开；即将超 55 字时退回上一符号
 */
const FULL_NARRATION_TARGET_SEC = 9;
const FULL_NARRATION_MAX_SEC = 10;
/** 兼容旧名：软下限仍按约 8 秒字数提示（不再强制并短段） */
const FULL_NARRATION_MIN_SEC = 8;
/**
 * 按旁白字数估算视频时长时的下限（秒）。
 * 短孤儿段按时长真实字数估，不再硬抬到 8/9 秒。
 */
const FULL_NARRATION_DURATION_MIN_SEC = 4;

function clampNarrationCharsPerSec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return NARRATION_CHARS_PER_SEC_DEFAULT;
  return Math.min(16, Math.max(4, Math.round(n * 10) / 10));
}

/** 根据每秒字数计算全文解说分段目标/上限（字数 = 语速 × 秒数） */
function resolveFullNarrationLimits(charsPerSec = NARRATION_CHARS_PER_SEC_DEFAULT) {
  const cps = clampNarrationCharsPerSec(charsPerSec);
  const maxChars = Math.round(FULL_NARRATION_MAX_SEC * cps);
  const targetChars = Math.min(Math.round(FULL_NARRATION_TARGET_SEC * cps), maxChars);
  const minChars = Math.min(Math.round(FULL_NARRATION_MIN_SEC * cps), maxChars);
  return {
    NARRATION_CHARS_PER_SEC: cps,
    FULL_NARRATION_TARGET_SEC,
    FULL_NARRATION_MIN_SEC,
    FULL_NARRATION_MAX_SEC,
    FULL_NARRATION_DURATION_MIN_SEC,
    FULL_NARRATION_TARGET_CHARS: targetChars,
    FULL_NARRATION_MIN_CHARS: minChars,
    FULL_NARRATION_MAX_CHARS: maxChars,
  };
}

const DEFAULT_LIMITS = resolveFullNarrationLimits(NARRATION_CHARS_PER_SEC_DEFAULT);
const NARRATION_CHARS_PER_SEC = DEFAULT_LIMITS.NARRATION_CHARS_PER_SEC;
const FULL_NARRATION_TARGET_CHARS = DEFAULT_LIMITS.FULL_NARRATION_TARGET_CHARS;
const FULL_NARRATION_MIN_CHARS = DEFAULT_LIMITS.FULL_NARRATION_MIN_CHARS;
const FULL_NARRATION_MAX_CHARS = DEFAULT_LIMITS.FULL_NARRATION_MAX_CHARS;

module.exports = {
  NARRATION_CHARS_PER_SEC_DEFAULT,
  NARRATION_CHARS_PER_SEC,
  FULL_NARRATION_TARGET_SEC,
  FULL_NARRATION_MIN_SEC,
  FULL_NARRATION_MAX_SEC,
  FULL_NARRATION_DURATION_MIN_SEC,
  FULL_NARRATION_TARGET_CHARS,
  FULL_NARRATION_MIN_CHARS,
  FULL_NARRATION_MAX_CHARS,
  clampNarrationCharsPerSec,
  resolveFullNarrationLimits,
};
