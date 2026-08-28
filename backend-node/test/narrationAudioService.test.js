const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeProportionalDurations,
  buildConcatenatedNarrationText,
} = require('../src/services/narrationAudioService');

describe('computeProportionalDurations', () => {
  it('splits total duration by speech char weights', () => {
    const texts = ['一二三四五。', '六七八九十。'];
    const durs = computeProportionalDurations(10, texts);
    assert.equal(durs.length, 2);
    assert.ok(Math.abs(durs[0] + durs[1] - 10) < 0.001);
    assert.ok(durs[0] > 0 && durs[1] > 0);
  });

  it('last segment absorbs rounding remainder', () => {
    const texts = ['甲', '乙', '丙'];
    const durs = computeProportionalDurations(7, texts);
    assert.equal(durs.length, 3);
    const sum = durs.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 7) < 0.001);
  });
});

describe('buildConcatenatedNarrationText', () => {
  it('joins storyboard narrations in order without separators', () => {
    const rows = [
      { narration: '第一段。' },
      { narration: '第二段。' },
    ];
    assert.equal(buildConcatenatedNarrationText(rows), '第一段。第二段。');
  });
});
