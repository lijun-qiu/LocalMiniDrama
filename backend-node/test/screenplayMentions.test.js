'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  convertChineseScreenplayToMentions,
  splitScreenplayUnits,
} = require('../src/services/workflow/referenceMentions');

describe('referenceMentions screenplay helpers', () => {
  it('splits by 【分场】 and drops 第N集 title', () => {
    const script = `第一集

【分场】便利店·童年
阿杰：你好。

【分场】家里·高中
妈：别攀比。`;
    const units = splitScreenplayUnits(script);
    assert.equal(units.length, 2);
    assert.ok(units[0].startsWith('【分场】便利店'));
    assert.ok(units[1].startsWith('【分场】家里'));
  });

  it('splits by ## S0x markdown scene headers (not blank lines)', () => {
    const script = `# 药盒

## S01 | 内景 · 卧室 | 清晨
母亲：（没回头）药盒。

## S11 | 内景 · 卧室 | 清晨
母亲：（抬起头，看着女儿）你是谁？
女儿：（蹲下来）我是您女儿。

## S12 | 内景 · 女儿的房间 | 夜晚
女儿：（对着黑暗）等您想起来，我再给您。`;
    const units = splitScreenplayUnits(script);
    assert.equal(units.length, 3);
    assert.ok(units[0].startsWith('## S01'));
    assert.ok(units[1].includes('你是谁？'));
    assert.ok(units[2].startsWith('## S12'));
  });

  it('converts 对白 and 心里话 to @[mentions]', () => {
    const raw = `【分场】便利店
阿杰（心里话）：遗憾开始了。
阿杰：我想吃这个。
妈：别吃零食。`;
    const out = convertChineseScreenplayToMentions(raw);
    assert.match(out, /@\[阿杰%内心独白\]\{遗憾开始了。\}/);
    assert.match(out, /@\[阿杰\]\{我想吃这个。\}/);
    assert.match(out, /@\[妈\]\{别吃零食。\}/);
  });

  it('converts inline 心里话 on the same line', () => {
    const out = convertChineseScreenplayToMentions(
      '阿杰（心里话）：遗憾开始了。阿杰：我想吃这个。'
    );
    assert.match(out, /@\[阿杰%内心独白\]\{遗憾开始了。\}/);
    assert.match(out, /@\[阿杰\]\{我想吃这个。\}/);
  });

  it('converts 声音传来 quotes to speaker mention, leaves 字迹 alone', () => {
    const voice = convertChineseScreenplayToMentions(
      '厨房外面，母亲的声音远远传来：“找到了吗？”'
    );
    assert.match(voice, /@\[母亲\]\{找到了吗？\}/);
    assert.doesNotMatch(voice, /厨房外面，母亲的声音远远传来/);
    const note = convertChineseScreenplayToMentions('母亲的字迹：“今天女儿考上大学了。”');
    assert.match(note, /母亲的字迹/);
    assert.doesNotMatch(note, /@\[母亲的字迹\]/);
  });
});
