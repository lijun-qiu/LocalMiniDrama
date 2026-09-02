const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSunoBaseUrl,
  buildSunoSubmitRequest,
  buildSunoPollRequest,
} = require('../src/services/sunoMusicAdapter');

describe('sunoMusicAdapter', () => {
  it('strips trailing /v1 from base URL for Suno endpoints', () => {
    assert.equal(normalizeSunoBaseUrl('https://api.chatfire.site/v1'), 'https://api.chatfire.site');
    assert.equal(normalizeSunoBaseUrl('https://api.chatfire.site/v1/'), 'https://api.chatfire.site');
    assert.equal(normalizeSunoBaseUrl('https://gateway.example.com'), 'https://gateway.example.com');
  });

  it('builds submit URL without /v1 prefix', () => {
    const req = buildSunoSubmitRequest(
      { base_url: 'https://api.chatfire.site/v1', api_key: 'sk-test' },
      { gpt_description_prompt: 'calm piano', make_instrumental: true },
    );
    assert.equal(req.url, 'https://api.chatfire.site/suno/submit/music');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.Authorization, 'Bearer sk-test');
  });

  it('builds poll URL without /v1 prefix', () => {
    const req = buildSunoPollRequest(
      { base_url: 'https://api.chatfire.site/v1', api_key: 'sk-test' },
      'task-abc',
    );
    assert.equal(req.url, 'https://api.chatfire.site/suno/fetch/task-abc');
    assert.equal(req.method, 'GET');
  });
});
