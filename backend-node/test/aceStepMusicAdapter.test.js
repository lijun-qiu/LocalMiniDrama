const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACE_STEP_DEFAULT_MODEL,
  isAceStepMusicModel,
  aceStepBaseUrl,
} = require('../src/services/aceStepMusicAdapter');
const { resolveBgmProvider } = require('../src/services/bgmService');

describe('aceStepMusicAdapter', () => {
  it('detects ace step model names', () => {
    assert.equal(isAceStepMusicModel('ace_step_local'), true);
    assert.equal(isAceStepMusicModel('acemusic/acestep-v15-turbo'), true);
    assert.equal(isAceStepMusicModel('suno_music_open'), false);
  });

  it('uses default local base url', () => {
    assert.match(aceStepBaseUrl(), /^http:\/\/127\.0\.0\.1:8001$/);
  });
});

describe('bgmService provider routing', () => {
  it('routes ace_step_local to acestep', () => {
    assert.equal(resolveBgmProvider(ACE_STEP_DEFAULT_MODEL), 'acestep');
    assert.equal(resolveBgmProvider('suno_music_open'), 'suno');
    assert.equal(resolveBgmProvider('chirp-v3-5'), 'suno');
  });
});
