const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseUniversalMultiBeatText,
  composeUniversalMultiBeatText,
  replaceBeatInUniversalText,
} = require('../src/services/universalMultiBeatParse');
const {
  chooseBeatCount,
  buildFallbackUniversalMultiBeatText,
  stripInlineNarrationFromUniversalText,
} = require('../src/services/universalOmniMultiBeatFormat');
const { buildSrtEntriesFromPrebuiltNarration } = require('../src/services/mergedEpisodePostProcess');

describe('chooseBeatCount narration-driven', () => {
  it('does not force 3 beats for short single-sentence narration on ~12s', () => {
    const M = chooseBeatCount(12, { narration: '雨下了一整夜。' });
    assert.ok(M <= 2, `expected M<=2 got ${M}`);
  });

  it('splits multi-sentence narration across beats', () => {
    const M = chooseBeatCount(12, {
      narration: '雨下了一整夜。他终于下定决心离开。街灯在水洼里碎成一片。',
    });
    assert.ok(M >= 2 && M <= 3, `expected 2–3 got ${M}`);
  });

  it('uses M=1 for very short duration', () => {
    assert.equal(chooseBeatCount(4, { narration: '第一句。第二句。第三句。' }), 1);
  });
});

describe('buildFallbackUniversalMultiBeatText narration-visual sync', () => {
  it('writes visual-only beats without inline narration quotes', () => {
    const text = buildFallbackUniversalMultiBeatText(
      { location: '窗边', time: '夜' },
      {
        action: '他起身走向窗边',
        narration: '雨下了一整夜。他终于下定决心离开。',
        durationSec: 10,
        primaryImageTag: '@图片2',
      },
      '纪录片'
    );
    assert.match(text, /生成一个由以下[12]个分镜组成的视频/);
    assert.doesNotMatch(text, /旁白（画面无声）：/);
    assert.match(text, /人物闭口无口型，无对白/);
    const firstBeat = text.split('\n').find((l) => l.startsWith('分镜1：'));
    assert.ok(firstBeat);
    assert.match(firstBeat, /@图片2/);
    assert.doesNotMatch(firstBeat, /雨下了一整夜/);
  });
});

describe('stripInlineNarrationFromUniversalText', () => {
  it('removes embedded 旁白 from beat lines', () => {
    const raw = [
      '画面风格和类型: 真人写实, 电影风格, 高清画质',
      '生成一个由以下1个分镜组成的视频。',
      '环境参考 @图片1。',
      '分镜1： 10秒: 镜头缓推，@图片2 在咖啡馆伏案写作，无对白。 旁白（画面无声）："你在咖啡馆写作。"',
    ].join('\n');
    const out = stripInlineNarrationFromUniversalText(raw);
    assert.doesNotMatch(out, /旁白（画面无声）/);
    assert.match(out, /咖啡馆伏案写作/);
    assert.doesNotMatch(out, /你在咖啡馆写作/);
  });
});

describe('universalMultiBeatParse', () => {
  const sample = [
    '画面风格和类型: 真人写实, 电影风格, 高清画质',
    '生成一个由以下2个分镜组成的视频。',
    '环境、光影与陈设定性参考 @图片1。',
    '分镜1： 5秒: 镜头缓推，@图片2 抬头。',
    '分镜2： 5秒: @图片2 说："走吧。"',
  ].join('\n');

  it('parses header and beats', () => {
    const p = parseUniversalMultiBeatText(sample);
    assert.equal(p.ok, true);
    assert.equal(p.headerLines.length, 3);
    assert.equal(p.beats.length, 2);
    assert.equal(p.beats[0].index, 1);
    assert.equal(p.beats[0].seconds, 5);
    assert.match(p.beats[1].body, /走吧/);
  });

  it('replaces one beat without touching others', () => {
    const r = replaceBeatInUniversalText(sample, 2, '@图片2 转身离开，无对白。');
    assert.equal(r.ok, true);
    const p = parseUniversalMultiBeatText(r.text);
    assert.equal(p.beats[0].body, '镜头缓推，@图片2 抬头。');
    assert.equal(p.beats[1].body, '@图片2 转身离开，无对白。');
    assert.equal(p.beats[1].seconds, 5);
  });

  it('compose round-trip keeps structure', () => {
    const p = parseUniversalMultiBeatText(sample);
    const text = composeUniversalMultiBeatText(p.headerLines, p.beats);
    assert.match(text, /分镜1： 5秒:/);
    assert.match(text, /分镜2： 5秒:/);
  });
});

describe('universalNarrationBeatTimeline', () => {
  const {
    splitDurationByNarrationWeights,
    buildNarrationBeatTimeline,
    alignUniversalBeatSecondsToNarration,
  } = require('../src/services/universalNarrationBeatTimeline');

  it('allocates 9s by narration char weights not equal 3+3+3', () => {
    const texts = [
      '你走进便利店，货架上的荧光灯惨白。',
      '你推开门。',
      '电视新闻里跳出通缉令，你手里的水瓶掉了。',
    ];
    const secs = splitDurationByNarrationWeights(9, texts);
    assert.equal(secs.reduce((a, b) => a + b, 0), 9);
    assert.notDeepEqual(secs, [3, 3, 3]);
    // middle clause shortest → middle beat shortest
    assert.ok(secs[1] <= secs[0]);
    assert.ok(secs[1] <= secs[2]);
  });

  it('places ~4.5s narration midpoint in beat2 when split 3+2+4', () => {
    const narr = '第一句旁白较长一些。你推开门。第三句也比较长继续叙述。';
    const { beats } = buildNarrationBeatTimeline(narr, 9, 3);
    const mid = beats.find((b) => b.narrationExcerpt.includes('推开门'));
    assert.ok(mid, '应有包含推开门的一拍');
    assert.equal(mid.index, 2);
    assert.ok(mid.startSec <= 4.5 && mid.endSec >= 4.5, `beat2 window should cover 4.5s got ${mid.startSec}-${mid.endSec}`);
  });

  it('alignUniversalBeatSecondsToNarration rewrites beat headers', () => {
    const raw = [
      '画面风格和类型: 测试',
      '生成一个由以下3个分镜组成的视频。',
      '环境 @图片1。',
      '分镜1： 3秒: 动作A。',
      '分镜2： 3秒: 推门。',
      '分镜3： 3秒: 动作C。',
    ].join('\n');
    const narr = '较长第一句旁白。你推开门。第三句旁白。';
    const out = alignUniversalBeatSecondsToNarration(raw, 9, narr, 3);
    assert.match(out, /分镜2： 2秒:/);
    assert.doesNotMatch(out, /分镜1： 3秒:.*分镜2： 3秒:.*分镜3： 3秒:/s);
  });
});

describe('buildSrtEntriesFromPrebuiltNarration speechSec', () => {
  it('lays subtitles only across speechSec when shorter than slot', () => {
    const entries = buildSrtEntriesFromPrebuiltNarration(
      '第一句。第二句更长一些的内容。',
      10,
      0,
      { speechSec: 4 }
    );
    assert.ok(entries.length >= 1);
    const last = entries[entries.length - 1];
    assert.equal(last.endMs, 4000);
    assert.ok(entries[0].startMs === 0);
  });

  it('defaults to full slot when speechSec omitted', () => {
    const entries = buildSrtEntriesFromPrebuiltNarration('一句旁白。', 8, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].endMs, 8000);
  });
});
