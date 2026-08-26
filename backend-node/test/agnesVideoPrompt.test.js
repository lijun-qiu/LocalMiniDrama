const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { prepareAgnesVideoPrompt } = require('../src/services/videoClient');

describe('prepareAgnesVideoPrompt', () => {
  it('strips 解说旁白 and appends silent constraint', () => {
    const raw =
      '场景：办公室。动作：人物静坐。解说旁白：剩下的全交给老婆刘念处理。景别：中景。镜头角度：平视（medium shot, eye level, front）。';
    const { prompt, useSilentNegative } = prepareAgnesVideoPrompt(raw);
    assert.equal(useSilentNegative, true);
    assert.ok(!prompt.includes('解说旁白：'));
    assert.ok(!prompt.includes('剩下的全交给老婆'));
    assert.ok(prompt.includes('禁止人物开口'));
  });

  it('strips universal 旁白（画面无声） segment and removes 禁BGM', () => {
    const raw =
      '主体：@人物1 叙事动态：约5秒内——在客厅走动 旁白（画面无声）："这是第二段解说内容需要足够长" 音效：环境层 [禁BGM][禁字幕]';
    const { prompt } = prepareAgnesVideoPrompt(raw);
    assert.ok(!prompt.includes('这是第二段解说'));
    assert.ok(!prompt.includes('旁白（画面无声）'));
    assert.ok(!prompt.includes('[禁BGM]'));
    assert.ok(prompt.includes('可有轻柔背景音乐'));
    assert.ok(prompt.includes('禁止人物开口'));
  });

  it('forceSilent always adds negative cue even without speech fields', () => {
    const { prompt, useSilentNegative } = prepareAgnesVideoPrompt('场景：街道。动作：行走。', {
      forceSilent: true,
    });
    assert.equal(useSilentNegative, true);
    assert.ok(prompt.includes('禁止人物开口'));
  });
});
