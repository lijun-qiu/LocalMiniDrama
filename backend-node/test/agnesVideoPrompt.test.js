const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  prepareAgnesVideoPrompt,
  buildAgnes25VideoBody,
  applyAgnesSilentNegativePrompt,
} = require('../src/services/videoClient');

describe('prepareAgnesVideoPrompt', () => {
  it('normal mode keeps dialogue for lip sync (no force silent on speech cues)', () => {
    const raw =
      '场景：办公室。动作：人物开口。对话：张三："剩下的全交给老婆刘念处理。"景别：中景。';
    const { prompt, useSilentNegative } = prepareAgnesVideoPrompt(raw);
    assert.equal(useSilentNegative, false);
    assert.ok(prompt.includes('剩下的全交给老婆'));
    assert.ok(prompt.includes('对话：'));
    assert.ok(!prompt.includes('禁止人物开口'));
    assert.ok(prompt.includes('禁止画面字幕') || prompt.includes('画面约束'));
  });

  it('forceSilent strips narration VO but keeps character dialogue for lip sync', () => {
    const raw =
      '场景：办公室。动作：人物静坐。对话：张三："你怎么又迟到了"。解说旁白：剩下的全交给老婆刘念处理。景别：中景。';
    const { prompt, useSilentNegative } = prepareAgnesVideoPrompt(raw, { forceSilent: true });
    assert.equal(useSilentNegative, false);
    assert.ok(!prompt.includes('解说旁白：'));
    assert.ok(!prompt.includes('剩下的全交给老婆'));
    assert.ok(prompt.includes('你怎么又迟到了'));
    assert.ok(prompt.includes('对话：'));
    assert.ok(prompt.includes('角色对白须口型'));
    assert.ok(prompt.startsWith('【最高优先级·禁画面字】'));
  });

  it('strips universal 旁白（画面无声） under forceSilent but keeps @图片N dialogue', () => {
    const raw =
      '分镜1： 3秒: @图片2 说："你怎么又迟到了"，转身离开。旁白（画面无声）："这是第二段解说内容需要足够长" [禁BGM][禁字幕]';
    const { prompt } = prepareAgnesVideoPrompt(raw, { forceSilent: true });
    assert.ok(!prompt.includes('这是第二段解说'));
    assert.ok(!prompt.includes('旁白（画面无声）'));
    assert.ok(!prompt.includes('[禁BGM]'));
    assert.ok(prompt.includes('你怎么又迟到了'));
    assert.ok(prompt.includes('@图片2 说'));
    assert.ok(!prompt.includes('禁止人物开口'));
  });

  it('forceSilent without speech still adds caption + lipsync VO constraint', () => {
    const { prompt, useSilentNegative } = prepareAgnesVideoPrompt('场景：街道。动作：行走。', {
      forceSilent: true,
    });
    assert.equal(useSilentNegative, false);
    assert.ok(prompt.includes('角色对白须口型') || prompt.includes('禁止画面字幕'));
    assert.ok(prompt.startsWith('【最高优先级·禁画面字】'));
  });
});

describe('applyAgnesSilentNegativePrompt', () => {
  it('does not add negative_prompt for Agnes 2.5 Flash (API rejects the field)', () => {
    const prepared = prepareAgnesVideoPrompt('场景：街道。动作：行走。', { forceSilent: true });
    const { body } = buildAgnes25VideoBody({
      model: 'agnes-video-v2.5-flash',
      prompt: prepared.prompt,
      duration: 5,
      aspect_ratio: '16:9',
      useOmniReference: false,
      resolvedRefs: [],
      firstResolved: null,
      lastResolved: null,
    });
    applyAgnesSilentNegativePrompt(body, prepared.useSilentNegative, { model: 'agnes-video-2.5-flash' });
    assert.equal(body.negative_prompt, undefined);
    assert.ok(body.prompt.includes('禁画面字') || body.prompt.includes('禁止画面字幕'));
  });

  it('adds caption-oriented negative_prompt for Agnes V2.0 when explicitly requested', () => {
    const body = { model: 'agnes-video-v2.0', prompt: 'test' };
    applyAgnesSilentNegativePrompt(body, true, { model: 'agnes-video-v2.0' });
    assert.ok(body.negative_prompt);
    assert.match(body.negative_prompt, /subtitle|字幕/);
    assert.doesNotMatch(body.negative_prompt, /lip sync/);
  });
});
