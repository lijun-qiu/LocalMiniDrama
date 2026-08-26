const { splitNarrationLines } = require('../src/utils/narrationLineSplit');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('splitNarrationLines', () => {
  it('splits by Chinese sentence punctuation', () => {
    const lines = splitNarrationLines('你好，世界。这是第二句！还有第三句？');
    assert.ok(lines.length >= 3);
    assert.equal(lines[0], '你好，世界。');
  });

  it('handles newlines as paragraph breaks', () => {
    const lines = splitNarrationLines('第一句。\n第二句。');
    assert.equal(lines.length, 2);
  });

  it('returns empty for blank input', () => {
    assert.deepEqual(splitNarrationLines('   '), []);
  });
});
