const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveNarrationSlotPlan,
  computeNarrationLineWeights,
  refineSplitBoundaries,
  snapOffsetToSilence,
} = require('../src/utils/narrationAudioFit');

describe('resolveNarrationSlotPlan', () => {
  it('pads when narration shorter than slot', () => {
    const plan = resolveNarrationSlotPlan(8, 10);
    assert.equal(plan.outputSlotSec, 10);
    assert.equal(plan.preferExtendVideo, false);
  });

  it('never schedules post speedup for slight overrun', () => {
    const plan = resolveNarrationSlotPlan(10.5, 10);
    assert.equal(plan.outputSlotSec, 10.5);
    assert.equal(plan.preferExtendVideo, true);
  });

  it('extends video for large overrun instead of speedup', () => {
    const plan = resolveNarrationSlotPlan(12, 10);
    assert.equal(plan.outputSlotSec, 12);
    assert.equal(plan.preferExtendVideo, true);
  });
});

describe('computeNarrationLineWeights', () => {
  it('gives stronger weight to sentence-ending punctuation', () => {
    const [wComma, wPeriod] = computeNarrationLineWeights(['你好，', '你好。']);
    assert.ok(wPeriod > wComma);
  });
});

describe('snapOffsetToSilence', () => {
  it('snaps to nearest silence_end within range', () => {
    assert.equal(snapOffsetToSilence(5.02, [1.2, 4.98, 9.0], 0.35), 4.98);
  });

  it('keeps offset when no silence nearby', () => {
    assert.equal(snapOffsetToSilence(5.0, [1.0, 9.0], 0.2), 5.0);
  });
});

describe('refineSplitBoundaries', () => {
  it('adjusts segment durations toward silence and preserves total', () => {
    const durs = refineSplitBoundaries([5, 5], 10, [4.95, 9.9]);
    assert.equal(durs.length, 2);
    const sum = durs.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 10) < 0.03);
    assert.ok(durs[0] > 0 && durs[1] > 0);
  });
});
