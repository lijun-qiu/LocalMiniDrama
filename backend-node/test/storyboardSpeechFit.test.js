'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateSpokenBudgetForClip,
  getStoryboardSpeechFitConstraint,
  getStoryboardNarrationExtraInstructions,
  getStoryboardUserPromptSuffix,
} = require('../src/services/promptI18n');

describe('estimateSpokenBudgetForClip', () => {
  it('budgets ~45+ Chinese chars for a 10s clip', () => {
    const b = estimateSpokenBudgetForClip(10, false);
    assert.equal(b.sec, 10);
    assert.ok(b.maxChars >= 40 && b.maxChars <= 55, `maxChars=${b.maxChars}`);
    assert.ok(b.preferMin < b.maxChars);
  });

  it('scales with duration', () => {
    const a = estimateSpokenBudgetForClip(5, false);
    const b = estimateSpokenBudgetForClip(15, false);
    assert.ok(b.maxChars > a.maxChars);
  });
});

describe('speech-fit prompt constraints', () => {
  const cfgZh = { language: 'zh' };

  it('locks duration and forbids dropping VO', () => {
    const c = getStoryboardSpeechFitConstraint(cfgZh, 10);
    assert.match(c, /10\s*秒/);
    assert.match(c, /严禁删掉|必须保留/);
    assert.match(c, /拆成多镜|拆成连续多镜/);
    const budget = estimateSpokenBudgetForClip(10, false);
    assert.match(c, new RegExp(String(budget.maxChars)));
  });

  it('narration instructions use clip budget when provided', () => {
    const text = getStoryboardNarrationExtraInstructions(cfgZh, 10);
    const budget = estimateSpokenBudgetForClip(10, false);
    assert.match(text, new RegExp(`${budget.preferMin}～${budget.maxChars}`));
    assert.match(text, /严禁丢掉剧本旁白|严禁省略/);
  });

  it('user suffix forbids deleting VO to fit duration', () => {
    const suffix = getStoryboardUserPromptSuffix(cfgZh, 10);
    assert.match(suffix, /必须写 \*\*10\*\*/);
    assert.match(suffix, /禁止为压时长删掉画外音/);
  });
});
