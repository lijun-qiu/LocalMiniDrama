const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAgnesVideoImagePayload,
  buildAgnes25VideoBody,
  agnes25ClampSeconds,
  normalizeAgnesVideoModel,
  isAgnesVideo25Model,
  isAgnesVideo25FlashModel,
  isAgnesVideo25FamilyModel,
  rewriteAgnes25ReferenceTags,
  formatVideoPostBodyForLog,
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

describe('normalizeAgnesVideoModel / isAgnesVideo25Model', () => {
  it('defaults empty to 2.5 flash', () => {
    assert.equal(normalizeAgnesVideoModel(''), 'agnes-video-2.5-flash');
    assert.equal(normalizeAgnesVideoModel(null), 'agnes-video-2.5-flash');
  });

  it('normalizes 2.5 flash aliases', () => {
    assert.equal(normalizeAgnesVideoModel('agnes-video-2.5-flash'), 'agnes-video-2.5-flash');
    assert.equal(isAgnesVideo25FlashModel('agnes-video-2.5-flash'), true);
    assert.equal(isAgnesVideo25Model('agnes-video-2.5-flash'), false);
    assert.equal(isAgnesVideo25FamilyModel('agnes-video-2.5-flash'), true);
  });

  it('normalizes 2.5 aliases', () => {
    assert.equal(normalizeAgnesVideoModel('agnes-video-2.5'), 'agnes-video-2.5');
    assert.equal(normalizeAgnesVideoModel('agnes-video-v2.5'), 'agnes-video-2.5');
    assert.equal(isAgnesVideo25Model('agnes-video-2.5'), true);
    assert.equal(isAgnesVideo25Model('agnes-video-v2.0'), false);
  });

  it('keeps official 2.0 id', () => {
    assert.equal(normalizeAgnesVideoModel('agnes-video-v2.0'), 'agnes-video-v2.0');
    assert.equal(normalizeAgnesVideoModel('agnes-video-2.0'), 'agnes-video-v2.0');
  });
});

describe('agnes25ClampSeconds / rewriteAgnes25ReferenceTags', () => {
  it('clamps seconds to 4–12 as string', () => {
    assert.equal(agnes25ClampSeconds(3), '4');
    assert.equal(agnes25ClampSeconds(5), '5');
    assert.equal(agnes25ClampSeconds(15), '12');
  });

  it('rewrites @图片N to <Picture N>', () => {
    assert.equal(
      rewriteAgnes25ReferenceTags('用@图片1 做角色，@图片2 是场景'),
      '用<Picture 1> 做角色，<Picture 2> 是场景'
    );
  });
});

describe('buildAgnes25VideoBody', () => {
  it('builds flash text mode without media', () => {
    const { body, strategy } = buildAgnes25VideoBody({
      model: 'agnes-video-2.5-flash',
      prompt: 'a cat walks',
      duration: 5,
      aspect_ratio: '16:9',
      useOmniReference: false,
      resolvedRefs: [],
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(strategy, 'v25_flash_text');
    assert.equal(body.model, 'agnes-video-2.5-flash');
    assert.equal(body.mode, 'text');
    assert.equal(body.seconds, '5');
    assert.equal(body.size, '720P');
    assert.equal(body.aspect_ratio, '16:9');
    assert.equal(body.first_frame, undefined);
    assert.equal(body.images, undefined);
    assert.equal(body.width, undefined);
    assert.equal(body.num_frames, undefined);
  });

  it('builds text mode without media', () => {
    const { body, strategy } = buildAgnes25VideoBody({
      model: 'agnes-video-2.5',
      prompt: 'a cat walks',
      duration: 5,
      aspect_ratio: '16:9',
      useOmniReference: false,
      resolvedRefs: [],
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(strategy, 'v25_text');
    assert.equal(body.model, 'agnes-video-2.5');
    assert.equal(body.mode, 'text');
    assert.equal(body.seconds, '5');
    assert.equal(body.size, '720P');
    assert.equal(body.aspect_ratio, '16:9');
    assert.equal(body.first_frame, undefined);
    assert.equal(body.images, undefined);
    assert.equal(body.width, undefined);
    assert.equal(body.num_frames, undefined);
  });

  it('flash reference mode caps images at 5', () => {
    const refs = Array.from({ length: 8 }, (_, i) => `https://cdn/ref${i}.jpg`);
    const { body, strategy } = buildAgnes25VideoBody({
      model: 'agnes-video-2.5-flash',
      prompt: '角色参考@图片1',
      duration: 6,
      aspect_ratio: '16:9',
      useOmniReference: true,
      resolvedRefs: refs,
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(strategy, 'v25_flash_reference');
    assert.equal(body.images.length, 5);
  });

  it('builds keyframe mode with first/last', () => {
    const { body, strategy } = buildAgnes25VideoBody({
      model: 'agnes-video-2.5',
      prompt: 'walk to window',
      duration: 8,
      aspect_ratio: '9:16',
      useOmniReference: false,
      resolvedRefs: [],
      firstResolved: 'https://cdn/first.jpg',
      lastResolved: 'https://cdn/last.jpg',
    });
    assert.equal(strategy, 'v25_keyframe');
    assert.equal(body.mode, 'keyframe');
    assert.equal(body.first_frame, 'https://cdn/first.jpg');
    assert.equal(body.last_frame, 'https://cdn/last.jpg');
    assert.equal(body.images, undefined);
  });

  it('builds reference mode for omni refs and rewrites tags', () => {
    const { body, strategy } = buildAgnes25VideoBody({
      model: 'agnes-video-2.5',
      prompt: '角色按@图片1 奔跑，场景参考@图片2',
      duration: 6,
      aspect_ratio: '16:9',
      useOmniReference: true,
      resolvedRefs: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
      firstResolved: null,
      lastResolved: null,
    });
    assert.equal(strategy, 'v25_reference');
    assert.equal(body.mode, 'reference');
    assert.deepEqual(body.images, ['https://cdn/a.jpg', 'https://cdn/b.jpg']);
    assert.match(body.prompt, /<Picture 1>/);
    assert.match(body.prompt, /<Picture 2>/);
    assert.equal(body.first_frame, undefined);
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
