/** 中文解说朗读语速默认值：5.5 字/秒（不含标点；更贴近 IndexTTS 实测，约 66 字 ≈ 12 秒） */
const NARRATION_CHARS_PER_SEC_DEFAULT = 5.5;
/**
 * 全文解说分段（经典 / 全能统一规则）：
 * - 以「。」为最小句段；连续多句合并为一镜，合并后可读字数不超过 12 秒（无句数上限）
 * - 再加下一句会超 12 秒则新开一镜；单句超 12 秒再在句末标点处硬拆
 */
const FULL_NARRATION_MAX_SEC = 12;
/** @deprecated 兼容旧引用，与 FULL_NARRATION_MAX_SEC 相同 */
const FULL_NARRATION_TARGET_SEC = 12;
/** 兼容旧名：软下限仍按约 8 秒字数提示（不再强制并短段） */
const FULL_NARRATION_MIN_SEC = 8;
/**
 * 按旁白字数估算视频时长时的下限（秒）。
 * 短孤儿段按时长真实字数估，不再硬抬到 8 秒。
 */
const FULL_NARRATION_DURATION_MIN_SEC = 4;

/** @deprecated 兼容旧引用，与 FULL_NARRATION_MAX_SEC 相同 */
const UNIVERSAL_FULL_NARRATION_MAX_SEC = 12;

/** @deprecated 已无句数上限，保留兼容旧引用 */
const PERIOD_MAX_SENTENCES_PER_SEGMENT = null;

function clampNarrationCharsPerSec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return NARRATION_CHARS_PER_SEC_DEFAULT;
  return Math.min(16, Math.max(4, Math.round(n * 10) / 10));
}

/** 根据每秒字数计算全文解说分段上限（字数 = 语速 × 12 秒） */
function resolveFullNarrationLimits(charsPerSec = NARRATION_CHARS_PER_SEC_DEFAULT) {
  const cps = clampNarrationCharsPerSec(charsPerSec);
  const maxChars = Math.round(FULL_NARRATION_MAX_SEC * cps);
  const minChars = Math.min(Math.round(FULL_NARRATION_MIN_SEC * cps), maxChars);
  return {
    NARRATION_CHARS_PER_SEC: cps,
    FULL_NARRATION_TARGET_SEC: FULL_NARRATION_MAX_SEC,
    FULL_NARRATION_MIN_SEC,
    FULL_NARRATION_MAX_SEC,
    FULL_NARRATION_DURATION_MIN_SEC,
    FULL_NARRATION_TARGET_CHARS: maxChars,
    FULL_NARRATION_MIN_CHARS: minChars,
    FULL_NARRATION_MAX_CHARS: maxChars,
    PERIOD_MAX_SENTENCES_PER_SEGMENT,
    splitMode: 'period',
  };
}

/** @deprecated 与 resolveFullNarrationLimits 相同（经典 / 全能已统一） */
function resolveUniversalFullNarrationLimits(charsPerSec = NARRATION_CHARS_PER_SEC_DEFAULT) {
  return resolveFullNarrationLimits(charsPerSec);
}

const DEFAULT_LIMITS = resolveFullNarrationLimits();
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
  UNIVERSAL_FULL_NARRATION_MAX_SEC,
  PERIOD_MAX_SENTENCES_PER_SEGMENT,
  FULL_NARRATION_TARGET_CHARS,
  FULL_NARRATION_MIN_CHARS,
  FULL_NARRATION_MAX_CHARS,
  clampNarrationCharsPerSec,
  resolveFullNarrationLimits,
  resolveUniversalFullNarrationLimits,
};
