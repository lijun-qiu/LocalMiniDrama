/**
 * 视频提交 Key 轮询：串行/并发均传 preferred_key_index，后端按实际 Key 数取模。
 * Agnes 多 Key（常见 7）时保证串行也不会总打同一把。
 */

let videoPreferredKeyCursor = 0

/** @returns {number} 单调递增下标（后端 % keyCount） */
export function nextVideoPreferredKeyIndex() {
  return videoPreferredKeyCursor++
}

/** 软衔接失败后重试间隔（与 Agnes 单 Key 冷却一致） */
export const SOFT_CONTIGUITY_RETRY_DELAY_MS = 60_000
