const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAgnesVideoImagePayload,
  buildAgnes25VideoBody,
  formatVideoPostBodyForLog,
  isAgnesVideo25FamilyModel,
  normalizeAgnesVideoModel,
} = require('../src/services/videoClient');

describe('formatVideoPostBodyForLog', () => {
  it('keeps full http URLs and labels extra_body images with index', () => {
    const formatted = formatVideoPostBodyForLog({
      model: 'agnes-video-v2.0',
      prompt: 'test prompt',
      extra_body: {
        image: ['https://cdn/a.jpg', 'https://cdn/b.png'],
      },
    });
    assert.deepEqual(formatted.extra_body.image, [
      '[0] https://cdn/a.jpg',
      '[1] https://cdn/b.png',
    ]);
    assert.equal(formatted.prompt, 'test prompt');
  });

  it('summarizes base64 image fields', () => {
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(100);
    const formatted = formatVideoPostBodyForLog({ image: dataUrl });
    assert.match(formatted.image, /^\(base64, \d+ chars\)$/);
  });
});

describe('normalizeAgnesVideoModel / isAgnesVideo25FamilyModel', () => {
  it('normalizes 2.5 flash aliases', () => {
    assert.equal(normalizeAgnesVideoModel('agnes-video-v2.5-flash'), 'agnes-video-2.5-flash');
    assert.equal(isAgnesVideo25FamilyModel('agnes-video-2.5-flash'), true);
    assert.equal(isAgnesVideo25FamilyModel('agnes-video-v2.0'), false);
  });
});

describe('buildAgnes25VideoBody', () => {
  it('builds text mode without width/height/num_frames', () => {
    const { body, strategy } = buildAgnes25VideoBody({
      model: 'agnes-video-2.5-flash',
      prompt: 'a cat',
      duration: 5,
      aspect_ratio: '16:9',
      useOmniReference: false,
      resolvedRefs: [],
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(strategy, 'v25_flash_text');
    assert.equal(body.mode, 'text');
    assert.equal(body.seconds, '5');
    assert.equal(body.size, '720P');
    assert.equal(body.width, undefined);
    assert.equal(body.num_frames, undefined);
  });

  it('builds reference mode with images array', () => {
    const refs = ['https://cdn/a.jpg', 'https://cdn/b.jpg'];
    const { body, strategy } = buildAgnes25VideoBody({
      model: 'agnes-video-2.5',
      prompt: '@图片1 walking',
      duration: 8,
      aspect_ratio: '9:16',
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(strategy, 'v25_reference');
    assert.equal(body.mode, 'reference');
    assert.deepEqual(body.images, refs);
    assert.match(body.prompt, /<Picture 1>/);
  });
  it('builds reference mode with images and audios, rewrites @音频', () => {
    const refs = ['https://cdn/a.jpg', 'https://cdn/b.jpg'];
    const audios = ['https://cdn/v1.mp3', 'https://cdn/v2.mp3'];
    const { body, strategy } = buildAgnes25VideoBody({
      model: 'agnes-video-2.5-flash',
      prompt: '@图片1 与 <林薇>说 {请坐}；音色参考 @音频1',
      duration: 5,
      aspect_ratio: '16:9',
      useOmniReference: true,
      resolvedRefs: refs,
      resolvedAudios: audios,
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(strategy, 'v25_flash_reference');
    assert.equal(body.mode, 'reference');
    assert.deepEqual(body.images, refs);
    assert.deepEqual(body.audios, audios);
    assert.match(body.prompt, /<Picture 1>/);
    assert.match(body.prompt, /<Audio 1>/);
  });

  it('caps flash audios at 3', () => {
    const { body } = buildAgnes25VideoBody({
      model: 'agnes-video-2.5-flash',
      prompt: 'x',
      duration: 5,
      aspect_ratio: '16:9',
      useOmniReference: true,
      resolvedRefs: ['https://cdn/a.jpg'],
      resolvedAudios: [
        'https://cdn/1.mp3',
        'https://cdn/2.mp3',
        'https://cdn/3.mp3',
        'https://cdn/4.mp3',
      ],
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(body.audios.length, 3);
  });
});

describe('buildAgnesVideoImagePayload', () => {
  it('uses extra_body.image array for omni multi-reference without keyframes mode', () => {
    const refs = ['https://cdn/a.jpg', 'https://cdn/b.png', 'https://cdn/c.png'];
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: 'https://cdn/a.jpg',
      lastResolved: 'https://cdn/z.jpg',
    });
    assert.equal(out.strategy, 'omni_reference_extra_body');
    assert.deepEqual(out.extra_body, { image: refs });
    assert.equal(out.image, undefined);
    assert.equal(out.extra_body.mode, undefined);
  });

  it('uses single top-level image string for one omni reference', () => {
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: ['https://cdn/scene.jpg'],
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(out.strategy, 'omni_reference_single');
    assert.equal(out.image, 'https://cdn/scene.jpg');
  });

  it('uses extra_body keyframes only for classic first/last (not omni)', () => {
    const out = buildAgnesVideoImagePayload({
      useOmniReference: false,
      resolvedRefs: [],
      firstResolved: 'https://cdn/first.jpg',
      lastResolved: 'https://cdn/last.jpg',
    });
    assert.equal(out.strategy, 'classic_keyframes');
    assert.deepEqual(out.extra_body, {
      mode: 'keyframes',
      image: ['https://cdn/first.jpg', 'https://cdn/last.jpg'],
    });
    assert.equal(out.image, undefined);
  });

  it('does not use keyframes mode when omni refs exist', () => {
    const refs = ['https://cdn/s.jpg', 'https://cdn/c.jpg'];
    const out = buildAgnesVideoImagePayload({
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: 'https://cdn/s.jpg',
      lastResolved: 'https://cdn/l.jpg',
    });
    assert.equal(out.strategy, 'omni_reference_extra_body');
    assert.equal(out.extra_body.mode, undefined);
  });
});
