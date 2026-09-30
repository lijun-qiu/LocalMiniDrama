const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isGenericExtraName,
  filterGenericExtraCharacters,
} = require('../src/utils/assetExtractionFilters');

describe('assetExtractionFilters', () => {
  it('flags numbered extras and collectives', () => {
    assert.equal(isGenericExtraName('老人甲'), true);
    assert.equal(isGenericExtraName('村民乙'), true);
    assert.equal(isGenericExtraName('路人 A'), true);
    assert.equal(isGenericExtraName('士兵们'), true);
    assert.equal(isGenericExtraName('村民若干'), true);
    assert.equal(isGenericExtraName('一个老人'), true);
    assert.equal(isGenericExtraName('无（空镜）'), true);
  });

  it('keeps named individuals', () => {
    assert.equal(isGenericExtraName('李明'), false);
    assert.equal(isGenericExtraName('老村长'), false);
    assert.equal(isGenericExtraName('林婉'), false);
  });

  it('filters list in place semantics', () => {
    const out = filterGenericExtraCharacters([
      { name: '李明' },
      { name: '老人甲' },
      { name: '村民若干' },
      { name: '林婉' },
    ]);
    assert.deepEqual(out.map((x) => x.name), ['李明', '林婉']);
  });
});
