const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAgnesRetryableSubmitError,
  isAgnesRetryableNetworkError,
} = require('../src/services/videoClient');

describe('isAgnesRetryableSubmitError', () => {
  it('retries 503 video_queue_full (logged production case)', () => {
    const raw = '{"code":"video_queue_full","message":"video queue is full, please retry later","data":null}';
    assert.equal(isAgnesRetryableSubmitError(503, raw), true);
  });

  it('retries 429 rate limit', () => {
    assert.equal(isAgnesRetryableSubmitError(429, '{"message":"rate limit"}'), true);
  });

  it('retries 503 memory overload (Agnes image-style transient)', () => {
    const raw = '{"code":"do_request_failed","message":"memory overload, try again later"}';
    assert.equal(isAgnesRetryableSubmitError(503, raw), true);
  });

  it('does not retry 401/403 auth', () => {
    assert.equal(isAgnesRetryableSubmitError(401, '{"code":"invalid_api_key"}'), false);
    assert.equal(isAgnesRetryableSubmitError(403, '{"message":"forbidden"}'), false);
  });

  it('does not retry 400 invalid parameter / prompt', () => {
    assert.equal(isAgnesRetryableSubmitError(400, '{"code":"invalid_parameter","message":"num_frames invalid"}'), false);
    assert.equal(isAgnesRetryableSubmitError(422, '{"message":"prompt too long"}'), false);
  });

  it('does not retry insufficient quota / moderation', () => {
    assert.equal(isAgnesRetryableSubmitError(402, '{"code":"insufficient_quota"}'), false);
    assert.equal(isAgnesRetryableSubmitError(400, '{"code":"content_policy_violation"}'), false);
  });

  it('does not retry generic 500 without transient hints', () => {
    assert.equal(isAgnesRetryableSubmitError(500, '{"message":"internal server error"}'), false);
  });

  it('does not retry 502/504 gateway (avoid wasting keys)', () => {
    assert.equal(isAgnesRetryableSubmitError(502, 'bad gateway'), false);
    assert.equal(isAgnesRetryableSubmitError(504, 'gateway timeout'), false);
  });
});

describe('isAgnesRetryableNetworkError', () => {
  it('retries transient network failures only', () => {
    assert.equal(isAgnesRetryableNetworkError(new Error('fetch failed')), true);
    assert.equal(isAgnesRetryableNetworkError(new Error('read ECONNRESET')), true);
    assert.equal(isAgnesRetryableNetworkError(new Error('invalid api key')), false);
  });
});
