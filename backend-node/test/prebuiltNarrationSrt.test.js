const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildSrtEntriesFromPrebuiltNarration } = require('../src/services/mergedEpisodePostProcess');

describe('buildSrtEntriesFromPrebuiltNarration', () => {
  it('按可读字权重分配逐句字幕时间轴', () => {
    const narr = '第一句旁白。第二句旁白更长一些。';
    const entries = buildSrtEntriesFromPrebuiltNarration(narr, 10, 0);
    assert.ok(entries.length >= 2);
    assert.equal(entries[0].startMs, 0);
    assert.equal(entries[entries.length - 1].endMs, 10000);
    const totalDur = entries.reduce((sum, e) => sum + (e.endMs - e.startMs), 0);
    assert.ok(Math.abs(totalDur - 10000) <= entries.length);
  });

  it('空旁白返回空数组', () => {
    assert.deepEqual(buildSrtEntriesFromPrebuiltNarration('', 8, 0), []);
  });
});
