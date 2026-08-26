const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  agnesEffectiveDurationSec,
  agnesSnapNumFrames,
  rewritePromptDurationHints,
} = require('../src/services/videoClient');

describe('agnesSnapNumFrames (8n+1 per second 3–10)', () => {
  const expected = {
    3: 73,
    4: 97,
    5: 121,
    6: 145,
    7: 169,
    8: 193,
    9: 217,
    10: 241,
  };

  for (const [sec, frames] of Object.entries(expected)) {
    it(`${sec}s → ${frames} frames (~${sec}s)`, () => {
      assert.equal(agnesSnapNumFrames(Number(sec)), frames);
      assert.equal(agnesEffectiveDurationSec(Number(sec)), Number(sec));
      assert.equal(frames % 8, 1);
    });
  }

  it('never exceeds 441', () => {
    assert.equal(agnesSnapNumFrames(20), 441);
  });
});

describe('rewritePromptDurationHints', () => {
  it('rewrites universal and classic duration markers', () => {
    const raw =
      '叙事动态：约8秒内——在客厅走动。时长：8秒。动作：行走。';
    const out = rewritePromptDurationHints(raw, 8);
    assert.ok(out.includes('约8秒内'));
    assert.ok(out.includes('时长：8秒'));
  });
});
