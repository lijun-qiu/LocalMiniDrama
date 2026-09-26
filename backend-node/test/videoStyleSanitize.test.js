const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isLatinHeavyStyle,
  sanitizeChineseOmniStyleAnchor,
} = require('../src/services/universalOmniMultiBeatFormat');

describe('isLatinHeavyStyle', () => {
  it('detects English anime style dumps', () => {
    assert.equal(
      isLatinHeavyStyle('anime style, Japanese animation, clean cel shading, vibrant colors'),
      true
    );
  });

  it('keeps Chinese style as non-latin-heavy', () => {
    assert.equal(isLatinHeavyStyle('日本动漫画风，清晰赛璐璐上色'), false);
  });
});

describe('sanitizeChineseOmniStyleAnchor', () => {
  it('strips English style tail from 风格锚点', () => {
    const input = [
      '【风格锚点】',
      '日本动漫画风，清晰赛璐璐，anime style, Japanese animation, clean cel shading',
      '【场景设定】',
      '办公室',
    ].join('\n');
    const out = sanitizeChineseOmniStyleAnchor(input);
    assert.match(out, /日本动漫画风/);
    assert.doesNotMatch(out, /anime style/i);
    assert.doesNotMatch(out, /clean cel shading/i);
  });
});
