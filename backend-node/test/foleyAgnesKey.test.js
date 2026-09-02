const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseApiKeys } = require('../src/utils/apiKeyPool');

describe('agnes multi-key for foley auth', () => {
  it('splits comma-separated keys so Bearer uses one key', () => {
    const field = 'sk-aaa111,sk-bbb222,sk-ccc333';
    const keys = parseApiKeys(field);
    assert.equal(keys.length, 3);
    assert.equal(keys[0], 'sk-aaa111');
    assert.notEqual(field, keys[0]);
  });
});
