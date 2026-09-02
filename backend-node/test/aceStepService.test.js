const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getAceStepConfigSummary } = require('../src/services/aceStepService');

describe('aceStepService', () => {
  it('returns config summary with default host/port', () => {
    const summary = getAceStepConfigSummary();
    assert.equal(summary.host, '127.0.0.1');
    assert.equal(summary.port, '8001');
    assert.match(summary.base_url, /^http:\/\/127\.0\.0\.1:8001$/);
    assert.ok(summary.root);
  });
});
