const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeStyleForEmptyScene,
  scrubAndReinforceScenePrompt,
  scrubAndReinforcePropPrompt,
  wrapStyleForEmptyScene,
} = require('../src/utils/assetImageStyle');
const sceneService = require('../src/services/sceneService');
const promptI18n = require('../src/services/promptI18n');

const GUFENG_EN =
  'Chinese historical 3D realistic character and scene, subsurface skin and silk fabric detail, elaborate hairpins and hanfu, palace garden or ancient street, costume drama level production design, warm cinematic color grading, refined semi-realistic 3D';

describe('assetImageStyle sanitize', () => {
  it('strips hanfu/hairpin/character words from gufeng style', () => {
    const out = sanitizeStyleForEmptyScene(GUFENG_EN);
    assert.doesNotMatch(out, /hanfu|hairpin|character and scene|subsurface skin/i);
    assert.match(out, /3D|cinematic|color grading/i);
  });

  it('scrub removes legacy 最高优先级 style and rebuilds without people tokens', () => {
    const legacy = `【画风·最高优先级】${GUFENG_EN}\n\nScene environment reference\n治疗室空镜`;
    const scrubbed = scrubAndReinforceScenePrompt(legacy, GUFENG_EN, '古风写实三维角色与场景');
    assert.doesNotMatch(scrubbed, /【画风·最高优先级】/);
    assert.doesNotMatch(scrubbed, /hairpins and hanfu/i);
    assert.doesNotMatch(scrubbed, /realistic character and scene/i);
    assert.match(scrubbed, /EMPTY LOCATION ONLY/);
    assert.match(scrubbed, /治疗室空镜/);
    assert.match(scrubbed, /ART STYLE FOR EMPTY ENVIRONMENT ONLY|【画风·仅空场景/);
  });

  it('prop scrub forbids people in mirror reflections', () => {
    const scrubbed = scrubAndReinforcePropPrompt('一面穿衣镜', GUFENG_EN, '');
    assert.match(scrubbed, /empty reflection/i);
    assert.doesNotMatch(scrubbed, /hairpins and hanfu/i);
  });

  it('wrapStyleForEmptyScene does not echo raw character style', () => {
    const lines = wrapStyleForEmptyScene(GUFENG_EN, '');
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0], /hairpins and hanfu/i);
  });
});

describe('scene single image prompt build', () => {
  it('buildSceneSingleImagePrompt drops characterful gufeng tokens', () => {
    const prompt = sceneService.buildSceneSingleImagePrompt(
      '废弃工厂内景，锈蚀管道与破碎天窗',
      GUFENG_EN,
      '古风写实三维角色与场景'
    );
    assert.match(prompt, /EMPTY LOCATION ONLY/);
    assert.doesNotMatch(prompt, /hairpins and hanfu/i);
    assert.doesNotMatch(prompt, /【画风·最高优先级】/);
  });

  it('single polish system prompt forbids people activity wording', () => {
    const sys = promptI18n.getScenePolishPromptSingle({ style: { default_style_zh: '写实' } });
    assert.match(sys, /空场景铁律|绝对禁止.*人物/);
    assert.doesNotMatch(sys, /清晰呈现人物最常活动的区域/);
  });
});
