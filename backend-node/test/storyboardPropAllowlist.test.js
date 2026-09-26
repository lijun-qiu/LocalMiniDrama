const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStoryboardPropIdsField,
  filterPropIdsAgainstAllowlist,
  deriveStoryboardFieldsFromAi,
} = require('../src/services/episodeStoryboardService');

describe('normalizeStoryboardPropIdsField', () => {
  it('accepts bare ids and {id} objects', () => {
    assert.deepEqual(normalizeStoryboardPropIdsField([181, { id: 182 }, '183']), [181, 182, 183]);
  });

  it('returns empty for non-array', () => {
    assert.deepEqual(normalizeStoryboardPropIdsField(null), []);
  });
});

describe('filterPropIdsAgainstAllowlist', () => {
  it('keeps only ids in allowlist', () => {
    const kept = filterPropIdsAgainstAllowlist([2, 181, 3, 182], [181, 182]);
    assert.deepEqual(kept, [181, 182]);
  });

  it('drops all when allowlist empty', () => {
    assert.deepEqual(filterPropIdsAgainstAllowlist([2, 3, 4], []), []);
  });

  it('passes through when allowlist omitted (undefined)', () => {
    assert.deepEqual(filterPropIdsAgainstAllowlist([2, 3], undefined), [2, 3]);
  });
});

describe('deriveStoryboardFieldsFromAi prop allowlist', () => {
  it('filters hallucinated cross-drama prop ids when allowlist provided', () => {
    const d = deriveStoryboardFieldsFromAi(
      {
        storyboard_number: 3,
        title: 'test',
        action: '动作',
        props: [2, 3, 181],
        characters: [129],
        duration: 5,
      },
      'realistic',
      '16:9',
      { allowedPropIds: [181, 182] }
    );
    assert.deepEqual(d.propIds, [181]);
  });

  it('clears props when drama has no props', () => {
    const d = deriveStoryboardFieldsFromAi(
      {
        storyboard_number: 1,
        title: 'empty',
        props: [2, 3, 4],
        duration: 5,
      },
      '',
      '16:9',
      { allowedPropIds: [] }
    );
    assert.deepEqual(d.propIds, []);
  });
});
