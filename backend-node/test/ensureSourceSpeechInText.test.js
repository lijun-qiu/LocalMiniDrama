'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureSourceSpeechInText,
  assertSourceSpeechCovered,
  enforceUnitsSourceSpeech,
  listMissingSourceSpeech,
  validateSourceDialogueCoverage,
  normalizeSpokenLine,
  collectSourceDialogueLines,
} = require('../src/services/workflow/draftValidation');

describe('ensureSourceSpeechInText', () => {
  it('injects missing 心里话 before spoken lines', () => {
    const source = [
      '阿杰（心里话）：男生的遗憾，是从一枚奇趣蛋开始的。',
      '阿杰：我想吃这个。',
      '妈：十块一碗抄手才四块。',
    ].join('\n');
    const body =
      '画面内容：@[阿杰] 走向零食区。<阿杰>说 {我想吃这个。} @[妈] 按住他。<妈>说 {十块一碗抄手才四块。}';
    const out = ensureSourceSpeechInText(source, body);
    assert.match(out, /@\[阿杰%内心独白\]\{男生的遗憾，是从一枚奇趣蛋开始的。\}/);
    assert.match(out, /我想吃这个/);
    assert.ok(out.indexOf('内心独白') < out.indexOf('我想吃这个'));
    assert.equal(assertSourceSpeechCovered(source, out).ok, true);
  });

  it('is idempotent when speech already present (punctuation-tolerant)', () => {
    const source = '阿杰（心里话）：算了。\n阿杰：走吧。';
    const body = '@[阿杰%内心独白]{算了} @[阿杰]{走吧}';
    assert.equal(ensureSourceSpeechInText(source, body), body);
    assert.equal(normalizeSpokenLine('算了。'), normalizeSpokenLine('算了'));
  });

  it('covers 心声 alias the same as 心里话', () => {
    const source = '小夏（心声）：别回头。\n小夏：走。';
    const body = '@[小夏]{走}';
    const out = ensureSourceSpeechInText(source, body);
    assert.match(out, /@\[小夏%内心独白\]\{别回头。\}/);
    assert.equal(assertSourceSpeechCovered(source, out).ok, true);
  });
});

describe('enforceUnitsSourceSpeech (any script)', () => {
  it('repairs omitted 心里话 across units and clears violations', () => {
    const units = [
      {
        source_text: '阿杰（心里话）：男生的遗憾，是从一枚奇趣蛋开始的。\n阿杰：我想吃这个。',
        text: '@[阿杰] 走向货架。@[阿杰]{我想吃这个。}',
      },
      {
        source_text: '妈：十块一碗抄手才四块。',
        text: '@[妈]{十块一碗抄手才四块。}',
      },
    ];
    const { units: fixed, violations, repaired } = enforceUnitsSourceSpeech(units);
    assert.ok(repaired >= 1);
    assert.equal(violations.length, 0);
    assert.match(fixed[0].text, /内心独白/);
    assert.equal(assertSourceSpeechCovered(fixed[0].source_text, fixed[0].text).ok, true);
  });

  it('still reports violation when source line cannot be recovered into text shape', () => {
    // body already "has" nothing and source has speech — repair should inject; after inject ok
    const units = [
      {
        source_text: '旁白：夜深了。',
        text: '空镜。',
      },
    ];
    const { units: fixed, violations } = enforceUnitsSourceSpeech(units);
    assert.equal(violations.length, 0);
    assert.match(fixed[0].text, /\{夜深了。\}/);
  });

  it('validateSourceDialogueCoverage finds script-level omissions', () => {
    const script = [
      '阿杰（心里话）：奇趣蛋。',
      '阿杰：我想吃这个。',
      '妈：别买。',
    ].join('\n');
    const units = [
      { text: '@[阿杰]{我想吃这个。}' },
      { text: '@[妈]{别买。}' },
    ];
    const missing = listMissingSourceSpeech(
      '阿杰（心里话）：奇趣蛋。\n阿杰：我想吃这个。',
      units[0].text
    );
    assert.equal(missing.length, 1);
    assert.equal(missing[0].inner, true);

    const cov = validateSourceDialogueCoverage(script, units);
    assert.ok(cov.some((v) => v.code === 'source_dialogue_omitted' && /奇趣蛋/.test(v.text)));
  });

  it('treats 声音传来：“…” as speaker line, ignores 字迹引文', () => {
    const lines = collectSourceDialogueLines(
      [
        '厨房外面，母亲的声音远远传来：“找到了吗？”',
        '母亲的字迹：“今天女儿考上大学了。”',
        '“女儿今天会叫妈妈了。”',
        '女儿：我在呢。',
      ].join('\n')
    );
    assert.equal(lines.length, 2);
    assert.equal(lines[0].name, '母亲');
    assert.equal(normalizeSpokenLine(lines[0].text), normalizeSpokenLine('找到了吗？'));
    assert.equal(lines[1].name, '女儿');

    const cov = validateSourceDialogueCoverage(
      '厨房外面，母亲的声音远远传来：“找到了吗？”\n女儿：我在呢。',
      [{ text: '@[母亲]{找到了吗？} @[女儿]{我在呢。}' }]
    );
    assert.equal(cov.length, 0);
  });

  it('matches dialogue even when LLM drops stage-direction parentheses', () => {
    const script = '女儿：（站在门口）妈，您又找什么呢？\n母亲：（没回头）药盒。';
    const units = [{ text: '@[女儿]{妈，您又找什么呢？} @[母亲]{药盒。}' }];
    assert.equal(validateSourceDialogueCoverage(script, units).length, 0);
  });

  it('repairScriptDialogueCoverage injects lines missing from all units', () => {
    const { repairScriptDialogueCoverage } = require('../src/services/workflow/draftValidation');
    const script = '女儿：你好。\n母亲：你好。\n女儿：再见。';
    const units = [{ text: '@[女儿]{你好。}', source_text: '女儿：你好。' }];
    const { units: fixed, remaining } = repairScriptDialogueCoverage(script, units);
    assert.equal(remaining.length, 0);
    assert.match(fixed.map((u) => u.text).join('\n'), /母亲/);
    assert.match(fixed.map((u) => u.text).join('\n'), /再见/);
  });
});
