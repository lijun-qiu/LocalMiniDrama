'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const draftValidation = require('../src/services/workflow/draftValidation');
const { buildStep1SplitPrompt, buildStep2ExpandPrompt } = require('../src/services/workflow/referenceVideoPrompts');

describe('draftValidation + prompts', () => {
  it('assertDialoguePreserved detects rewrite', () => {
    const a = '@[阿杰]{你好。}\n@[阿杰] 推门。';
    const b = '@[阿杰]{你好啊。}\n景别：中景。@[阿杰] 推门。';
    const bad = draftValidation.assertDialoguePreserved(a, b);
    assert.equal(bad.ok, false);
    const good = draftValidation.assertDialoguePreserved(a, '景别：中景。\n@[阿杰]{你好。}\n@[阿杰] 推门。');
    assert.equal(good.ok, true);
  });

  it('builds arc-aligned prompts containing writing syntax', () => {
    const s1 = buildStep1SplitPrompt({
      episode: 1,
      novelText: '阿杰：你好。',
      characters: [{ name: '阿杰' }],
      scenes: [{ location: '便利店' }],
      props: [],
    });
    assert.match(s1, /source_text/);
    assert.match(s1, /内心独白/);
    assert.match(s1, /肢体归属|人物\/肢体/);
    assert.match(s1, /不会继承上一段末帧/);
    assert.match(s1, /推门/);
    assert.match(s1, /跨 unit 可见状态/);
    assert.match(s1, /仍坐在桌边/);
    assert.match(s1, /时长决策序/);
    assert.match(s1, /画面节拍下界/);
    assert.match(s1, /references 上限/);
    assert.match(s1, /追溯锚/);
    assert.match(s1, /推开 @\[酒馆\]/);
    assert.match(s1, /- character:/);
    const s2 = buildStep2ExpandPrompt({
      episode: 1,
      step1Units: [{ duration_seconds: 5, text: '@[阿杰]{你好。}' }],
      characters: [{ name: '阿杰' }],
      scenes: [],
      props: [],
    });
    assert.match(s2, /等长、同序/);
    assert.match(s2, /景别/);
    assert.match(s2, /一只手拦住了他/);
    assert.match(s2, /不继承末帧或机位/);
    assert.match(s2, /step1 已写出的这类状态在扩写时保留/);
    assert.match(s2, /反例（过短）/);
    assert.match(s2, /可读道具内容/);
    assert.match(s2, /反例（屏幕反打）/);
    assert.match(s2, /反例（写外貌）/);
  });
});
