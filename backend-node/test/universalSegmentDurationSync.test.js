const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { syncUniversalSegmentDurationPair, sumUniversalBeatSeconds } = require('../src/services/universalSegmentDurationSync');

const SAMPLE = [
  '画面风格和类型: 测试',
  '生成一个由以下3个分镜组成的视频。',
  '环境 @图片1。',
  '分镜1： 3秒: A。',
  '分镜2： 6秒: B。',
  '分镜3： 1秒: C。',
].join('\n');

describe('universalSegmentDurationSync', () => {
  it('sumUniversalBeatSeconds', () => {
    assert.equal(sumUniversalBeatSeconds(SAMPLE), 10);
  });

  it('segment save: scales beats to existing duration (does not change duration)', () => {
    const r = syncUniversalSegmentDurationPair({
      universalSegmentText: SAMPLE,
      durationSec: 8,
      segmentTextChanged: true,
    });
    assert.equal(r.synced, true);
    assert.equal(r.mode, 'duration_to_beats');
    assert.equal(r.durationSec, 8);
    assert.equal(sumUniversalBeatSeconds(r.universalSegmentText), 8);
  });

  it('duration change: scales beats to match', () => {
    const r = syncUniversalSegmentDurationPair({
      universalSegmentText: SAMPLE,
      durationSec: 8,
      durationChanged: true,
    });
    assert.equal(r.synced, true);
    assert.equal(r.mode, 'duration_to_beats');
    assert.equal(sumUniversalBeatSeconds(r.universalSegmentText), 8);
  });

  it('audio-derived duration: scales beats to match', () => {
    const r = syncUniversalSegmentDurationPair({
      universalSegmentText: SAMPLE,
      durationSec: 9.2,
      narrationDerivedDuration: true,
    });
    assert.equal(r.synced, true);
    assert.equal(r.durationSec, 9.2);
    assert.ok(Math.abs(sumUniversalBeatSeconds(r.universalSegmentText) - 9.2) < 0.3);
  });
});
