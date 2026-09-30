const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isArcReelStructuredPrompt,
  isArcReelSubmitReady,
  convertUniversalSegmentToArcReelYaml,
  stripDeliveryAside,
  sanitizeAmbianceAudio,
  injectAudioRefsIntoArcReelYaml,
  extractSpeakersFromArcReelYaml,
  normalizeArcReelYamlForSubmit,
  ensureArcReelStructuredForVideoSubmit,
  ARCREEL_VIDEO_NEGATIVE_TAIL,
} = require('../src/services/dramaVideoPromptYaml');

describe('dramaVideoPromptYaml (ArcReel drama aligned)', () => {
  const sample = [
    '【风格锚点】',
    '日本动漫画风，精细赛璐璐上色，清晰黑色线稿，高饱和鲜艳配色，极具表现力的角色设计，动画工作室级别质量，漫画美学影响，关键帧视觉插图风格',
    '',
    '【场景设定】',
    '公司办公室。环境参考 @图片1。',
    '',
    '【分镜1】（5秒）：',
    '固定机位，中景。@图片2 陈浩坐姿懒散，理所当然地，语气平淡如叙述事实。约第1秒起 <陈浩>说 {因为我在找工作。}，话音落下后 @图片3 林薇微愣。',
    '',
    '【环境音】',
    '空调低频运转声，人声平淡自然，无BGM。',
  ].join('\n');

  it('converts omni prose to ArcReel drama YAML with Dialogue/Line only', () => {
    const yaml = convertUniversalSegmentToArcReelYaml(sample, {
      characters: [{ name: '陈浩', voice_style: '平淡男声' }],
    });
    assert.match(yaml, /^Action:/m);
    assert.match(yaml, /^Camera_Motion:\s*Static/m);
    assert.match(yaml, /^Dialogue:/m);
    assert.match(yaml, /- Speaker: 陈浩\n  Line: 因为我在找工作。/);
    assert.doesNotMatch(yaml, /^Spoken:/m);
    assert.doesNotMatch(yaml, /<陈浩>/);
    assert.doesNotMatch(yaml, /【音轨】/);
    assert.match(yaml, new RegExp(ARCREEL_VIDEO_NEGATIVE_TAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal((yaml.match(/因为我在找工作。/g) || []).length, 1);
    assert.doesNotMatch(yaml, /语气平淡如叙述事实/);
    assert.doesNotMatch(yaml, /话音落下后/);
    assert.ok(isArcReelStructuredPrompt(yaml));
    assert.ok(isArcReelSubmitReady(yaml));
  });

  it('maps 内心独白 to Speaker 角色%内心独白, never 画外音', () => {
    const raw = [
      '【分镜1】（5秒）：',
      '@[阿杰] 看手机。@[阿杰%内心独白]{交完房租水电后，想要的一直在购物车。}@[阿杰]{就只有三千了。}',
      '【环境音】',
      '安静。',
    ].join('\n');
    const yaml = convertUniversalSegmentToArcReelYaml(raw, {
      characters: [{ name: '阿杰', voice_style: '温和内敛' }],
    });
    assert.match(yaml, /- Speaker: "?阿杰%内心独白"?\n  Line: 交完房租水电后，想要的一直在购物车。/);
    assert.match(yaml, /- Speaker: 阿杰\n  Line: 就只有三千了。/);
    assert.doesNotMatch(yaml, /Speaker: 画外音\n  Line: 交完房租/);
    assert.match(yaml, /Voice_Profiles:\n- Speaker: 阿杰\n  Voice_Style: 温和内敛/);
    assert.match(yaml, /【心声口型】/);
    assert.doesNotMatch(yaml, /【音轨硬约束】/);

    const fromOmni = convertUniversalSegmentToArcReelYaml(
      '【分镜1】（5秒）：\n<阿杰>内心独白 {算了，下个月吧。}\n【环境音】\n静。',
      { characters: [{ name: '阿杰', voice_style: '温和' }] }
    );
    assert.match(fromOmni, /- Speaker: "?阿杰%内心独白"?\n  Line: 算了，下个月吧。/);
    assert.doesNotMatch(fromOmni, /Speaker: 画外音/);
    assert.match(fromOmni, /【心声口型】/);
  });

  it('stripDeliveryAside removes tone and speech residues', () => {
    const out = stripDeliveryAside('坐姿懒散，语气平淡如叙述事实。约第1秒起，话音落下后');
    assert.doesNotMatch(out, /语气平淡/);
    assert.doesNotMatch(out, /话音落下后/);
  });

  it('inner-monologue Action strips sound-related gestures', () => {
    const { ensureInnerMonologueLipPackInAction, stripSoundRelatedActionPhrases } = require('../src/services/dramaVideoPromptYaml');
    const cleaned = stripSoundRelatedActionPhrases(
      '阿杰盯着奇趣蛋，低声嘟囔着什么，又咂嘴叹气，目光黯淡。'
    );
    assert.doesNotMatch(cleaned, /低声|嘟囔|咂嘴|叹气/);
    assert.match(cleaned, /奇趣蛋/);
    const action = ensureInnerMonologueLipPackInAction(
      '阿杰停住，轻声耳语，嘴唇微张。',
      [{ speaker: '阿杰%内心独白', line: '算了。' }]
    );
    const actionBody = action.split('【心声口型】')[0];
    assert.doesNotMatch(actionBody, /轻声|耳语|嘴唇微张/);
    assert.match(action, /【心声口型】/);
    assert.match(action, /禁止描写任何与发声有关的行为/);
  });

  it('sanitizeAmbianceAudio drops 人声 phrases', () => {
    assert.equal(
      sanitizeAmbianceAudio('空调低频运转声，人声平淡自然，无BGM'),
      '空调低频运转声'
    );
  });

  it('normalize migrates old Spoken draft to Dialogue + ArcReel negative tail', () => {
    const old = [
      'Action: "@图片2 陈浩坐姿懒散"',
      'Camera_Motion: Static',
      'Ambiance_Audio: 空调声，人声平淡自然',
      'Spoken:',
      '<陈浩> {因为我在找工作。}',
      '',
      '【音轨】人声仅念 Spoken 段花括号内原文；禁止BGM。',
    ].join('\n');
    const next = normalizeArcReelYamlForSubmit(old);
    assert.match(next, /^Dialogue:/m);
    assert.doesNotMatch(next, /^Spoken:/m);
    assert.match(next, /Line: 因为我在找工作。/);
    assert.doesNotMatch(next, /【音轨】/);
    assert.match(next, /禁止出现：BGM、文字字幕、水印。/);
    assert.equal((next.match(/因为我在找工作。/g) || []).length, 1);
  });

  it('injectAudioRefs adds @音频N without rewriting Dialogue', () => {
    const yaml = convertUniversalSegmentToArcReelYaml(sample, {
      characters: [{ name: '陈浩', voice_style: '平淡' }],
    });
    const next = injectAudioRefsIntoArcReelYaml(yaml, [
      { name: '陈浩', audioIndex: 1, voiceStyle: '平淡' },
    ]);
    assert.match(next, /@音频1/);
    assert.match(next, /^Dialogue:/m);
    assert.deepEqual(extractSpeakersFromArcReelYaml(next), ['陈浩']);
  });

  it('ensure auto-converts and passthrough when ready', () => {
    const out = ensureArcReelStructuredForVideoSubmit(sample, {
      characters: [{ name: '陈浩', voice_style: '平淡' }],
    });
    assert.equal(out.converted, true);
    assert.equal(out.structured, true);
    assert.equal(out.source, 'omni');
    assert.match(out.prompt, /^Dialogue:/m);
    assert.match(out.prompt, /禁止出现：BGM、文字字幕、水印。/);
    assert.doesNotMatch(out.prompt, /【音轨】/);
    assert.equal(isArcReelSubmitReady(out.prompt), true);

    const again = ensureArcReelStructuredForVideoSubmit(out.prompt);
    assert.equal(again.passthrough, true);
    assert.equal(again.prompt, out.prompt);
  });

  it('merges storyboard narration into Action-only ArcReel as 画外音 Dialogue', () => {
    const {
      ensureArcReelYamlHasClassicSpeech,
    } = require('../src/services/dramaVideoPromptYaml');
    const actionOnly = [
      'Action: "图书馆阅览区，缓推"',
      'Camera_Motion: Push in',
      'Ambiance_Audio: 键盘敲击声，无BGM。',
      '',
      '禁止出现：BGM、文字字幕、水印。',
    ].join('\n');
    assert.ok(isArcReelSubmitReady(actionOnly));
    const narr =
      '你注意到一条本地论坛的帖子——标题是「周衡诊所的秘密」。';
    const out = ensureArcReelStructuredForVideoSubmit(actionOnly, {
      classicFields: { narration: narr },
    });
    assert.equal(out.passthrough, false);
    assert.equal(out.converted, true);
    assert.match(out.prompt, /^Dialogue:/m);
    assert.match(out.prompt, /- Speaker: 画外音\n  Line: /);
    assert.match(out.prompt, /周衡诊所的秘密/);

    const patched = ensureArcReelYamlHasClassicSpeech(actionOnly, { narration: narr });
    assert.equal(patched.merged, true);
    assert.match(patched.text, /Speaker: 画外音/);
  });

  it('converts classic storyboard fields to ArcReel YAML', () => {
    const {
      convertClassicStoryboardToArcReelYaml,
      looksLikeClassicVideoPrompt,
    } = require('../src/services/dramaVideoPromptYaml');
    const yaml = convertClassicStoryboardToArcReelYaml(
      {
        location: '公司办公室',
        time: '白天',
        action: '陈浩坐姿懒散',
        dialogue: '陈浩：因为我在找工作。',
        narration: '',
        movement: '固定镜头static',
        atmosphere: '安静',
        sound_effect: '空调低频运转声',
      },
      { characters: [{ name: '陈浩', voice_style: '平淡男声' }] }
    );
    assert.match(yaml, /^Action:/m);
    assert.match(yaml, /公司办公室/);
    assert.match(yaml, /^Camera_Motion:\s*Static/m);
    assert.match(yaml, /- Speaker: 陈浩\n  Line: 因为我在找工作。/);
    assert.match(yaml, /Voice_Style: 平淡男声/);
    assert.match(yaml, /禁止出现：BGM、文字字幕、水印。/);
    assert.ok(isArcReelSubmitReady(yaml));
  });

  it('ensure converts classic labeled video_prompt prose', () => {
    const prose =
      '场景：公司办公室，白天。动作：陈浩坐姿懒散。对话：陈浩：因为我在找工作。运镜：固定镜头static。氛围：安静。音效：空调声。时长：5秒。';
    assert.equal(
      require('../src/services/dramaVideoPromptYaml').looksLikeClassicVideoPrompt(prose),
      true
    );
    const out = ensureArcReelStructuredForVideoSubmit(prose, {
      characters: [{ name: '陈浩', voice_style: '平淡' }],
    });
    assert.equal(out.converted, true);
    assert.equal(out.source, 'classic');
    assert.match(out.prompt, /^Dialogue:/m);
    assert.match(out.prompt, /Line: 因为我在找工作/);
    assert.doesNotMatch(out.prompt, /时长：/);
    assert.doesNotMatch(out.prompt, /\.\s*Style:/i);
    assert.doesNotMatch(out.prompt, /风格：/);
  });

  it('ensure prefers classicFields over empty omni-looking miss', () => {
    const out = ensureArcReelStructuredForVideoSubmit('随便一段不结构化文案', {
      characters: [{ name: '林薇', voice_style: '清冷' }],
      classicFields: {
        action: '林薇微愣',
        dialogue: '林薇：「你说什么？」',
        movement: 'Static',
      },
    });
    assert.equal(out.source, 'classic');
    assert.match(out.prompt, /Speaker: 林薇/);
    assert.match(out.prompt, /你说什么？/);
  });

  it('splits same-line multi-speaker classic dialogue', () => {
    const {
      parseClassicDialogueAndNarration,
      convertClassicStoryboardToArcReelYaml,
    } = require('../src/services/dramaVideoPromptYaml');
    assert.deepEqual(parseClassicDialogueAndNarration('陈浩：因为我在找工作。林薇：你说什么？', ''), [
      { speaker: '陈浩', line: '因为我在找工作。' },
      { speaker: '林薇', line: '你说什么？' },
    ]);
    assert.deepEqual(parseClassicDialogueAndNarration('陈浩：「第一句。」林薇：「第二句。」', ''), [
      { speaker: '陈浩', line: '第一句。' },
      { speaker: '林薇', line: '第二句。' },
    ]);
    const yaml = convertClassicStoryboardToArcReelYaml({
      action: '对峙',
      dialogue: '陈浩：第一句。林薇：第二句。',
    });
    assert.match(yaml, /Speaker: 陈浩\n  Line: 第一句。/);
    assert.match(yaml, /Speaker: 林薇\n  Line: 第二句。/);
  });

  it('re-reads ArcReel YAML from classic video_prompt when fields bare', () => {
    const {
      convertClassicStoryboardToArcReelYaml,
      ensureArcReelStructuredForVideoSubmit,
    } = require('../src/services/dramaVideoPromptYaml');
    const yaml = convertClassicStoryboardToArcReelYaml({
      action: '坐下',
      dialogue: '陈浩：你好。',
      characters: undefined,
    }, { characters: [{ name: '陈浩', voice_style: '平淡' }] });
    const out = ensureArcReelStructuredForVideoSubmit('', {
      classicFields: { video_prompt: yaml, action: '', dialogue: '', narration: '' },
      characters: [{ name: '陈浩', voice_style: '平淡' }],
    });
    assert.equal(out.converted, true);
    assert.equal(out.source, 'classic');
    assert.match(out.prompt, /Line: 你好。/);
    assert.equal(isArcReelSubmitReady(out.prompt), true);
  });

  it('unquotes doubled Speaker and cleans Action garbage; keeps Dialogue order', () => {
    const {
      normalizeArcReelYamlForSubmit,
      parseArcReelYamlLoose,
      appendArcReelTwinPack,
      ARCREEL_TWIN_PACK,
    } = require('../src/services/dramaVideoPromptYaml');
    const dirty = [
      'Voice_Profiles:',
      '- Speaker: 阿杰',
      '  Voice_Style: 温和内敛',
      'Action: "@[阿杰]看手机 【口型】阿杰 内心独白时嘴唇紧闭，不张嘴说话 【音轨硬约束】成片人声仅来自【分镜】里"',
      'Camera_Motion: Static',
      'Ambiance_Audio: 低电平现场环境声',
      'Dialogue:',
      '- Speaker: "\\"阿杰%内心独白\\""',
      '  Line: 工资到账了。',
      '- Speaker: 妈',
      '  Line: 儿子长大了。',
      '- Speaker: "\\"阿杰%内心独白\\""',
      '  Line: 交完房租水电后。',
      '- Speaker: 阿杰',
      '  Line: 就只有三千了。',
      '',
      '禁止出现：BGM、文字字幕、水印。',
    ].join('\n');
    const next = normalizeArcReelYamlForSubmit(dirty);
    assert.match(next, /- Speaker: "?阿杰%内心独白"?\n  Line: 工资到账了。/);
    assert.doesNotMatch(next, /\\\\"/);
    assert.doesNotMatch(next, /\\"阿杰/);
    assert.doesNotMatch(next, /【口型】/);
    assert.doesNotMatch(next, /【音轨硬约束】/);
    assert.match(next, /【心声口型】/);
    const parsed = parseArcReelYamlLoose(next);
    assert.deepEqual(
      parsed.dialogue.map((d) => `${d.speaker}:${d.line}`),
      [
        '阿杰%内心独白:工资到账了。',
        '妈:儿子长大了。',
        '阿杰%内心独白:交完房租水电后。',
        '阿杰:就只有三千了。',
      ]
    );
    const withTwin = appendArcReelTwinPack(next);
    assert.match(withTwin, new RegExp(ARCREEL_TWIN_PACK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});
