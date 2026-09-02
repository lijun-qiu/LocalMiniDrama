/**
 * 全能片段 duration ↔ 子分镜秒数之和
 *
 * 权威时长：配音实际时长（或旁白估算）写入的 storyboards.duration。
 * 改片段描述：只把各拍秒数缩放到 duration，绝不反向改 duration。
 */

const { sumUniversalBeatSeconds } = require('./universalMultiBeatParse');
const { normalizeUniversalSegmentShotDurations } = require('./universalSegmentDurationNormalize');

const DURATION_EPS = 0.25;

function toDurationSec(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.min(120, Math.max(1, Math.round(v * 10) / 10));
}

/**
 * @param {object} opts
 * @param {string} [opts.universalSegmentText]
 * @param {number|null} [opts.durationSec]
 * @param {boolean} [opts.segmentTextChanged] 保存片段描述 → 缩放各拍到 duration
 * @param {boolean} [opts.durationChanged] 手动改 duration → 缩放各拍
 * @param {boolean} [opts.narrationDerivedDuration] 旁白/配音刷新 duration → 缩放各拍
 * @returns {{ durationSec: number|null, universalSegmentText: string|null, synced: boolean, mode: string|null }}
 */
function syncUniversalSegmentDurationPair(opts = {}) {
  const text = opts.universalSegmentText != null ? String(opts.universalSegmentText).trim() : '';
  if (!text) {
    return {
      durationSec: toDurationSec(opts.durationSec),
      universalSegmentText: null,
      synced: false,
      mode: null,
    };
  }

  const beatSum = sumUniversalBeatSeconds(text);
  if (beatSum == null) {
    return {
      durationSec: toDurationSec(opts.durationSec),
      universalSegmentText: null,
      synced: false,
      mode: null,
    };
  }

  const curDur = toDurationSec(opts.durationSec);

  // 片段描述变更 / duration 变更 / 旁白·配音刷新：一律以 duration 为准，缩放各拍
  const shouldScaleBeats =
    opts.segmentTextChanged || opts.durationChanged || opts.narrationDerivedDuration;

  if (shouldScaleBeats && curDur != null && Math.abs(beatSum - curDur) > DURATION_EPS) {
    const label = Number.isInteger(curDur) ? String(curDur) : String(curDur);
    const normalized = normalizeUniversalSegmentShotDurations(text, label, curDur);
    return {
      durationSec: curDur,
      universalSegmentText: normalized,
      synced: true,
      mode: 'duration_to_beats',
    };
  }

  return { durationSec: curDur, universalSegmentText: null, synced: false, mode: null };
}

module.exports = {
  syncUniversalSegmentDurationPair,
  sumUniversalBeatSeconds,
  DURATION_EPS,
};
