const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAgnesImageRetryableHttpError,
  isAgnesImageRetryableNetworkError,
} = require('../src/services/imageClient');

describe('isAgnesImageRetryableHttpError', () => {
  it('retries 503 text image queue full', () => {
    const raw =
      '{"error":{"message":"text image queue is full, please retry later","type":"","param":"","code":null}}';
    assert.equal(isAgnesImageRetryableHttpError(503, raw), true);
  });

  it('retries 429 rate limit', () => {
    assert.equal(isAgnesImageRetryableHttpError(429, '{"message":"rate limit"}'), true);
  });

  it('retries 503 memory overload', () => {
    const raw = '{"code":"do_request_failed","message":"memory overload, try again later"}';
    assert.equal(isAgnesImageRetryableHttpError(503, raw), true);
  });

  it('does not retry auth / quota / bad request', () => {
    assert.equal(isAgnesImageRetryableHttpError(401, '{"code":"invalid_api_key"}'), false);
    assert.equal(isAgnesImageRetryableHttpError(403, '{"message":"forbidden"}'), false);
    assert.equal(isAgnesImageRetryableHttpError(402, '{"code":"insufficient_quota"}'), false);
    assert.equal(isAgnesImageRetryableHttpError(400, '{"message":"invalid parameter"}'), false);
  });

  it('does not retry generic 500 without transient hints', () => {
    assert.equal(isAgnesImageRetryableHttpError(500, '{"message":"internal error"}'), false);
  });
});

describe('isAgnesImageRetryableNetworkError', () => {
  it('retries transient network failures only', () => {
    assert.equal(isAgnesImageRetryableNetworkError(new Error('fetch failed')), true);
    assert.equal(isAgnesImageRetryableNetworkError(new Error('read ECONNRESET')), true);
    assert.equal(isAgnesImageRetryableNetworkError(new Error('request timeout')), true);
    assert.equal(isAgnesImageRetryableNetworkError(new Error('invalid api key')), false);
  });
});
