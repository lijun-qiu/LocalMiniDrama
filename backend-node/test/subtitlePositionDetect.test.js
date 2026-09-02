const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildSubtitleForceStyle, DEFAULT_SUBTITLE_MARGIN_V } = require('../src/utils/subtitleStyle');

describe('buildSubtitleForceStyle', () => {
  it('defaults to MarginV 12', () => {
    assert.equal(DEFAULT_SUBTITLE_MARGIN_V, 12);
    const s = buildSubtitleForceStyle({ fontSize: 24 });
    assert.match(s, /Alignment=2/);
    assert.match(s, /MarginV=12/);
  });
});
