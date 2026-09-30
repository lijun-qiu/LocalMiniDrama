const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeUniversalSegmentDialogueConflicts,
  appendUniversalAudioVoiceConstraint,
  beatLineHasSpokenDialogue,
  buildFallbackUniversalMultiBeatText,
  extractSpeechSpeakerNames,
  injectVoiceDeclarationIntoPrompt,
  splitSpeechLine,
  deriveUtterances,
  renderSpeechLine,
  renderUniversalSegmentUtterancesForSubmit,
  UNIVERSAL_AUDIO_VOICE_SUFFIX,
} = require('../src/services/universalOmniMultiBeatFormat');
const { normalizeUniversalSegmentShotDurations } = require('../src/services/universalSegmentDurationNormalize');

describe('sanitizeUniversalSegmentDialogueConflicts', () => {
  it('rewrites @图片1 说 to <角色>说 and strips 【台词】 section', () => {
    const raw = [
      '【分镜1】（5秒）：',
      '@图片1 说："请坐。" 动作自然。',
      '【台词】',
      '林薇（@图片2，女声）："请坐。"',
      '【环境音】',
      '办公室空调低鸣，人声清晰在前，无BGM。',
    ].join('\n');
    const out = sanitizeUniversalSegmentDialogueConflicts(raw, {
      characterSlots: [{ name: '林薇', tag: '@图片2' }],
    });
    assert.match(out, /<林薇>说 \{请坐。\}/);
    assert.doesNotMatch(out, /@图片1 说/);
    assert.doesNotMatch(out, /【台词】/);
    assert.match(out, /空调低鸣/);
  });

  it('normalizes 角色名嗓音 to <名>说 {}', () => {
    const raw = [
      '【分镜1】（5秒）：',
      '陈浩嗓音平淡："因为我在找工作。"',
      '【台词】',
      '陈浩（@图片2，男声）："因为我在找工作。"',
      '【环境音】',
      '安静室内，人声清晰在前，无BGM。',
    ].join('\n');
    const out = sanitizeUniversalSegmentDialogueConflicts(raw, {
      characterSlots: [{ name: '陈浩', tag: '@图片2' }],
    });
    assert.match(out, /<陈浩>说 \{因为我在找工作。\}/);
    assert.doesNotMatch(out, /【台词】/);
  });

  it('keeps ambient 【环境音】 beds on dialogue shots', () => {
    const raw = [
      '【分镜1】（5秒）：',
      '<林薇>说 {请坐}。',
      '【环境音】',
      '- 氛围底噪：空调嗡鸣，车流白噪',
      '- 动作音效：衣料窸窣',
    ].join('\n');
    const out = sanitizeUniversalSegmentDialogueConflicts(raw);
    assert.match(out, /空调嗡鸣/);
    assert.doesNotMatch(out, /无额外环境音与音效/);
  });

  it('strips 仿佛说出了 and converts 口型同步说出 to <名>说', () => {
    const raw = [
      '【分镜1】（5秒）：',
      '近景，陈浩嘴角微扬，仿佛说出了世间最无可辩驳的真理，约第2秒口型同步说出「因为我不能同时在两个地方上班啊。」',
      '【环境音】',
      '低电平现场环境声，人声清晰在前，无BGM。',
    ].join('\n');
    const out = sanitizeUniversalSegmentDialogueConflicts(raw, {
      characterSlots: [{ name: '陈浩', tag: '@图片2' }],
    });
    assert.doesNotMatch(out, /仿佛说出了/);
    assert.doesNotMatch(out, /无可辩驳的真理/);
    assert.match(out, /嘴角微扬/);
    assert.match(out, /<陈浩>说 \{因为我不能同时在两个地方上班啊。\}/);
    assert.doesNotMatch(out, /口型同步说出/);
  });

  it('strips mouth cues on lines without speech marks', () => {
    const raw = [
      '【分镜1】（5秒）：',
      '林薇端坐，双唇闭合，口型开合预备。',
      '约第2秒起 <林薇>说 {请坐}。',
      '说完后嘴唇微张微笑。',
      '【环境音】',
      '安静室内，人声清晰在前，无BGM。',
    ].join('\n');
    const out = sanitizeUniversalSegmentDialogueConflicts(raw, {
      characterSlots: [{ name: '林薇', tag: '@图片2' }],
    });
    assert.doesNotMatch(out, /双唇闭合/);
    assert.doesNotMatch(out, /口型开合/);
    assert.doesNotMatch(out, /嘴唇微张/);
    assert.match(out, /<林薇>说 \{请坐\}/);
    assert.doesNotMatch(out, /【台词】/);
  });

  it('keeps ArcReel inline speech with surrounding action (no forced line split)', () => {
    const raw = [
      '【分镜1】（5秒）：',
      '固定机位。@图片3 陈浩落座，约第2秒起 <陈浩>说 {因为我没有工作}。全程连续，勿切镜。',
      '【环境音】',
      '安静室内，人声清晰在前，无BGM。',
    ].join('\n');
    const out = sanitizeUniversalSegmentDialogueConflicts(raw, {
      characterSlots: [{ name: '陈浩', tag: '@图片3' }],
    });
    assert.match(out, /约第2秒起 <陈浩>说 \{因为我没有工作\}/);
    assert.match(out, /勿切镜/);
    assert.match(out, /落座/);
  });
});

describe('ArcReel utterance parse + submit render', () => {
  it('splitSpeechLine keeps action outside braces as description', () => {
    const parts = splitSpeechLine(
      '固定机位。@图片3 陈浩落座，约第2秒起 <陈浩>说 {因为我没有工作}。全程连续，勿切镜。'
    );
    const desc = parts.filter((p) => typeof p === 'string').join('');
    const marks = parts.filter((p) => typeof p !== 'string');
    assert.equal(marks.length, 1);
    assert.equal(marks[0].speaker, '陈浩');
    assert.equal(marks[0].text, '因为我没有工作');
    assert.match(desc, /落座/);
    assert.match(desc, /勿切镜/);
    assert.doesNotMatch(desc, /因为我没有工作/);
  });

  it('renders @[名]{台词} to <名>说 {台词} at submit', () => {
    const raw = [
      '【分镜1】（5秒）：',
      '@[陈浩] 落座。@[陈浩]{因为我没有工作}',
      '【环境音】',
      '安静。',
    ].join('\n');
    const out = renderUniversalSegmentUtterancesForSubmit(raw);
    assert.match(out, /<陈浩>说 \{因为我没有工作\}/);
    assert.doesNotMatch(out, /@\[陈浩\]\{/);
    assert.match(out, /<陈浩> 落座/);
  });

  it('preserves 内心独白 and never rewrites it to 画外音', () => {
    const raw = [
      '【分镜1】（5秒）：',
      '<阿杰>内心独白 {男生的遗憾，是从一枚奇趣蛋开始的。} <阿杰>说 {我想吃这个。}',
      '【环境音】',
      '便利店冷柜嗡鸣。',
    ].join('\n');
    const parts = splitSpeechLine(raw.split('\n')[1]);
    const marks = parts.filter((p) => typeof p !== 'string');
    assert.equal(marks.length, 2);
    assert.equal(marks[0].innerMonologue, true);
    assert.equal(marks[0].speaker, '阿杰');
    assert.equal(marks[1].innerMonologue, false);

    const out = renderUniversalSegmentUtterancesForSubmit(raw);
    assert.match(
      out,
      /<阿杰>内心独白 \{男生的遗憾，是从一枚奇趣蛋开始的。\}【心声画面：嘴唇紧闭，不吐舌、不开口，无发声口部动作】/
    );
    assert.match(out, /<阿杰>说 \{我想吃这个。\}/);
    assert.doesNotMatch(out, /画外音说 \{男生的遗憾/);
    // 同人另有对白：不追加整段 <阿杰>嘴唇紧闭
    assert.doesNotMatch(out, /<阿杰>嘴唇紧闭，不吐舌、不开口，无发声口部动作。/);

    const fromAt = renderUniversalSegmentUtterancesForSubmit(
      '【分镜1】（5秒）：\n@[阿杰%内心独白]{别再逃了} {夜深了}'
    );
    assert.match(fromAt, /<阿杰>内心独白 \{别再逃了\}【心声画面：嘴唇紧闭，不吐舌、不开口，无发声口部动作】/);
    assert.match(fromAt, /画外音说 \{夜深了\}/);

    const utt = deriveUtterances(raw.split('\n')[1]);
    assert.equal(utt[0].kind, 'inner_monologue');
    assert.equal(utt[0].speaker, '阿杰');
    assert.equal(utt[1].kind, 'dialogue');
  });

  it('deriveUtterances only takes brace interiors', () => {
    const u = deriveUtterances(
      '推门。<林薇>说 {请坐}，点头。{夜风灌进来}'
    );
    assert.deepEqual(
      u.map((x) => [x.kind, x.speaker, x.text]),
      [
        ['dialogue', '林薇', '请坐'],
        ['voiceover', '', '夜风灌进来'],
      ]
    );
  });

  it('renderSpeechLine does not promote 勿切镜 into 说{}', () => {
    const line =
      '约第2秒起 <陈浩>说 {因为我没有工作}。全程连贯一气呵成，勿切镜。';
    const out = renderSpeechLine(line);
    assert.match(out, /<陈浩>说 \{因为我没有工作\}/);
    assert.match(out, /勿切镜/);
    const spoken = deriveUtterances(out).map((x) => x.text);
    assert.deepEqual(spoken, ['因为我没有工作']);
  });

  it('blank @[ ]{x} is not a speech mark', () => {
    const parts = splitSpeechLine('@[ ]{你好}继续走。');
    assert.equal(parts.filter((p) => typeof p !== 'string').length, 0);
  });
});

describe('appendUniversalAudioVoiceConstraint', () => {
  it('appends once and allows ambient while forbidding 【台词】', () => {
    const once = appendUniversalAudioVoiceConstraint('hello');
    assert.match(once, /【音轨硬约束】/);
    assert.match(once, /禁止输出【台词】栏/);
    assert.match(once, /【环境音】可写/);
    assert.match(once, /花括号外/);
    // 约束文案本身不得含花括号示例，否则会被当成真台词念出
    assert.doesNotMatch(UNIVERSAL_AUDIO_VOICE_SUFFIX, /\{/);
    const twice = appendUniversalAudioVoiceConstraint(once);
    assert.equal(twice, once);
  });

  it('does not treat constraint brace examples as utterances', () => {
    const {
      deriveUtterances,
      renderUniversalSegmentUtterancesForSubmit,
    } = require('../src/services/universalOmniMultiBeatFormat');
    const dirty =
      '【分镜1】（5秒）：约第1秒起 <林薇>说 {请坐。}\n\n' +
      '【音轨硬约束】成片人声仅来自「<角色>说 {台词}」或「画外音说 {…}」';
    assert.deepEqual(
      deriveUtterances(dirty).map((u) => u.text),
      ['请坐。']
    );
    const cleaned = renderUniversalSegmentUtterancesForSubmit(dirty);
    assert.doesNotMatch(cleaned, /\{台词\}/);
    assert.doesNotMatch(cleaned, /\{…\}/);
    assert.match(cleaned, /<林薇>说 \{请坐。\}/);
  });
});

describe('beatLineHasSpokenDialogue', () => {
  it('detects ArcReel speech marks', () => {
    assert.equal(beatLineHasSpokenDialogue('<林薇>说 {请坐。}'), true);
    assert.equal(beatLineHasSpokenDialogue('无对白。'), false);
  });
});

describe('buildFallbackUniversalMultiBeatText', () => {
  it('puts <名>说 {} in 【分镜】 and keeps ambient 【环境音】', () => {
    const text = buildFallbackUniversalMultiBeatText(
      { location: '办公室', time: '午后', atmosphere: '安静', sound_effect: '键盘轻响' },
      { durationSec: 5, action: '抬头提问', dialogue: '林薇：你为什么面试？', result: '对视' },
      '自然光'
    );
    assert.match(text, /【分镜1】（5秒）：/);
    assert.doesNotMatch(text, /【分镜2】/);
    assert.match(text, /<林薇>说 \{你为什么面试？\}/);
    assert.doesNotMatch(text, /【台词】/);
    assert.doesNotMatch(text, /口型同步说出/);
    assert.match(text, /键盘轻响/);
    assert.match(text, /【环境音】/);
  });
});

describe('voice declaration helpers', () => {
  it('extracts speakers and injects 【主体与音色】', () => {
    const body = [
      '【风格锚点】',
      '写实。',
      '【分镜1】（5秒）：',
      '<林薇>说 {请坐}，随后 <陈浩>说 {好的}。',
    ].join('\n');
    assert.deepEqual(extractSpeechSpeakerNames(body), ['林薇', '陈浩']);
    const out = injectVoiceDeclarationIntoPrompt(body, [
      { name: '林薇', audioIndex: 1, voiceStyle: '清亮冷静' },
      { name: '陈浩', audioIndex: 2 },
    ]);
    assert.match(out, /^【主体与音色】/);
    assert.match(out, /<林薇>的台词音色参考 @音频1，声音特征：清亮冷静。/);
    assert.match(out, /<陈浩>的台词音色参考 @音频2。/);
    assert.match(out, /【风格锚点】/);
  });

  it('uses 旁白 wording for 画外音 binding', () => {
    const body = '【分镜1】（5秒）：\n画外音说 {夜色渐深}。';
    const out = injectVoiceDeclarationIntoPrompt(body, [
      { name: '画外音', audioIndex: 1, voiceStyle: '沉稳解说' },
    ]);
    assert.match(out, /画外音的旁白音色参考 @音频1，声音特征：沉稳解说。/);
    assert.doesNotMatch(out, /<画外音>的台词音色/);
  });
});

describe('normalizeUniversalSegmentShotDurations', () => {
  it('normalizes 【分镜k】（秒） headers', () => {
    const raw = [
      '【风格锚点】',
      '写实。',
      '【分镜1】（3秒）：',
      '动作A',
      '【环境音】',
      '低电平现场环境声，人声清晰在前，无BGM。',
      '【分镜2】（7秒）：',
      '动作B',
      '【环境音】',
      '低电平现场环境声，人声清晰在前，无BGM。',
    ].join('\n');
    const out = normalizeUniversalSegmentShotDurations(raw, '10', 10);
    const secs = [...out.matchAll(/【分镜\d+】（([\d.]+)秒）：/g)].map((m) => Number(m[1]));
    assert.equal(secs.length, 2);
    assert.ok(Math.abs(secs[0] + secs[1] - 10) < 0.15);
  });
});
