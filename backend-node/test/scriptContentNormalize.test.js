const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeScriptContentForSave } = require('../src/utils/scriptContentNormalize');

describe('normalizeScriptContentForSave', () => {
  it('removes blank lines', () => {
    const input = '第一句。\n\n第二句。\n\n\n第三句。';
    assert.equal(normalizeScriptContentForSave(input), '第一句。\n第二句。\n第三句。');
  });

  it('returns empty for blank input', () => {
    assert.equal(normalizeScriptContentForSave(' \n\n '), '');
  });
});
