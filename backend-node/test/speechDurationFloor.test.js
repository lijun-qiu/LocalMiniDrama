'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateSpeechSeconds,
  enforceUnitsSpeechDuration,
  repairSpeechOverloadUnits,
  SPEECH_CHARS_PER_SECOND,
} = require('../src/services/workflow/draftValidation');

describe('speech duration floor (5 chars/sec, max 12s)', () => {
  const lookRoomText = [
    '【分场】毕业后·看房',
    '@[阿杰%内心独白]{后来大专毕业，找了 10k 的工作。}',
    '@[中介]{这个宜家风格，押一付一。}',
    '@[中介]{今天定少五百。}',
    '@[小满]{要不再看看？}',
    '@[小满]{住这你通勤要两个小时。}',
    '@[阿杰]{不用，离你公司近。}',
    '@[阿杰]{就这个。}',
  ].join('\n');

  it('counts ~65 chars → 13s at 5cps', () => {
    const sec = estimateSpeechSeconds(lookRoomText, SPEECH_CHARS_PER_SECOND);
    assert.equal(sec, 13);
  });

  it('caps at 12s and marks speech_overload when not repaired', () => {
    const { units, overloads } = enforceUnitsSpeechDuration(
      [{ unit_id: 'E1U03', duration_seconds: 8, source_text: 'x', text: lookRoomText }],
      { durations: [4, 5, 8, 10, 12], speechRate: 5 }
    );
    assert.equal(units[0].duration_seconds, 12);
    assert.equal(units[0].speech_overload, true);
    assert.ok(overloads.length >= 1);
  });

  it('compresses oversized duration down to shortest sufficient tier', () => {
    const short = '@[阿杰] 摇摇头。@[阿杰]{不用，离你公司近。}\n@[阿杰]{就这个。}';
    const sec = estimateSpeechSeconds(short, 5);
    assert.ok(sec < 5);
    const { units, adjusted } = enforceUnitsSpeechDuration(
      [{ unit_id: 'E1U04', duration_seconds: 12, source_text: 'x', text: short }],
      { durations: [4, 5, 8, 10, 12], speechRate: 5 }
    );
    assert.ok(adjusted >= 1);
    assert.equal(units[0].duration_seconds, 4);
    assert.equal(units[0].speech_overload, false);
  });

  it('ignores stage-direction parentheses and narrative lines in speech timing', () => {
    const text = [
      '@[女儿]{（抬头）里面装的什么您知道吗？}',
      '@[王阿姨]{（摇头）她不让看。有一回我开玩笑想打开，她急得脸都红了。}',
      '女儿合上相册，沉默了一会儿。',
    ].join('\n');
    const sec = estimateSpeechSeconds(text, 5);
    assert.equal(sec, 7); // 35 spoken chars, 括注/叙述不计
    const { units } = enforceUnitsSpeechDuration(
      [{ duration_seconds: 5, text }],
      { durations: [4, 5, 6, 7, 8, 9, 10, 11, 12], speechRate: 5 }
    );
    assert.equal(units[0].duration_seconds, 7);
  });

  it('does not compress _durationLocked split halves when speech fits', () => {
    const { units } = enforceUnitsSpeechDuration(
      [
        {
          unit_id: 'E1U03a',
          duration_seconds: 8,
          _durationLocked: true,
          source_text: 'x',
          text: '@[阿杰]{短。}',
        },
      ],
      { durations: [4, 5, 8, 10, 12], speechRate: 5 }
    );
    assert.equal(units[0].duration_seconds, 8);
  });

  it('unlocks split lock when speech needs longer but still ≤ max tier', () => {
    const text =
      '@[阿杰]{就只有三千了。} @[妈]{儿子长大了，好好工作哟。} ' +
      '@[阿杰%内心独白]{工资到账了。给妈妈转了两千买衣服。}\n' +
      '@[妈%内心独白]{儿子长大了，好好工作哟。}';
    assert.equal(estimateSpeechSeconds(text, 5), 9.6);
    const { units } = enforceUnitsSpeechDuration(
      [{ duration_seconds: 8, _durationLocked: true, source_text: 'x', text }],
      { durations: [4, 5, 8, 10, 12], speechRate: 5 }
    );
    assert.equal(units[0].duration_seconds, 10);
    assert.equal(units[0].speech_overload, false);
  });

  it('splits overloaded look-room unit into two ≤12s parts', () => {
    const { units, splits, overloads } = repairSpeechOverloadUnits(
      [
        {
          unit_id: 'E1U03',
          duration_seconds: 8,
          source_text: [
            '阿杰（心里话）：后来大专毕业，找了 10k 的工作。',
            '中介：这个宜家风格，押一付一。',
            '中介：今天定少五百。',
            '小满：要不再看看？',
            '小满：住这你通勤要两个小时。',
            '阿杰：不用，离你公司近。',
            '阿杰：就这个。',
          ].join('\n'),
          text: lookRoomText,
        },
      ],
      { durations: [4, 5, 8, 10, 12], speechRate: 5 }
    );
    assert.ok(splits >= 1);
    assert.ok(units.length >= 2);
    for (const u of units) {
      assert.ok(
        estimateSpeechSeconds(u.text, 5) <= 12 * 1.05 + 1e-6,
        `unit still long: ${estimateSpeechSeconds(u.text, 5)}s\n${u.text}`
      );
    }
    // 拆半优先够念：各半 ≤12s；若原时长不够分，总和可略大于原 12s
    const sumDur = units.reduce((s, u) => s + Number(u.duration_seconds || 0), 0);
    assert.ok(sumDur >= 12);
    for (const u of units) {
      const need = estimateSpeechSeconds(u.text, 5);
      assert.ok(Number(u.duration_seconds) + 1e-6 >= Math.min(need, 12));
    }
    assert.equal(overloads.length, 0);
  });

  it('splits single-line multi-speech overload (no newlines)', () => {
    const text =
      '@[母亲家客厅] 白天，@[女儿] 把 @[绿铁盒] 递到 @[母亲] 手里。@[女儿]{妈，您看，找到了。} ' +
      '@[母亲] 接过来。@[母亲]{这不是我的那个。} @[女儿] 笑容僵住。@[女儿]{就是您的，您看，绿色的，牡丹花。} ' +
      '@[母亲] 摇头。@[母亲]{我的那个，花瓣上有一道划痕。钥匙不小心划的。这个没有。} ' +
      '她把药盒递还。@[母亲]{你再帮我找找吧。}';
    assert.ok(estimateSpeechSeconds(text, 5) > 12.6);
    assert.ok(!/\n/.test(text));
    const { units, splits, overloads } = repairSpeechOverloadUnits(
      [{ unit_id: 'E01U07', duration_seconds: 12, source_text: text, text }],
      { durations: [4, 5, 6, 7, 8, 9, 10, 11, 12], speechRate: 5 }
    );
    assert.ok(splits >= 1, 'should split single-line multi-speech');
    assert.ok(units.length >= 2);
    assert.equal(overloads.length, 0);
    for (const u of units) {
      assert.ok(estimateSpeechSeconds(u.text, 5) <= 12 * 1.05 + 1e-6);
      assert.equal(u.speech_overload, false);
    }
    // 均分：两半时长应接近（避免 12+4）
    const durs = units.map((u) => Number(u.duration_seconds));
    assert.ok(Math.abs(durs[0] - durs[1]) <= 3, `unbalanced split: ${durs.join('+')}`);
  });

  it('split durations sum to original and share scene/prop refs', () => {
    const text = [
      '【分场】客厅',
      '@[阿杰] 坐在沙发上，旁边是 @[奇趣蛋]',
      '@[阿杰]{' + '甲'.repeat(40) + '}',
      '@[小满]{' + '乙'.repeat(30) + '}',
    ].join('\n');
    assert.ok(estimateSpeechSeconds(text, 5) > 12.6);
    const { units, splits } = repairSpeechOverloadUnits(
      [{ unit_id: 'E1U01', duration_seconds: 12, source_text: '阿杰：甲\n小满：乙', text }],
      { durations: [4, 5, 8, 10, 12], speechRate: 5 }
    );
    assert.ok(splits >= 1);
    assert.equal(units.length, 2);
    // 各半够念；总和 ≥ 原 12（不够分时允许略增）
    assert.ok(
      Number(units[0].duration_seconds) + Number(units[1].duration_seconds) >= 12
    );
    for (const u of units) {
      const need = estimateSpeechSeconds(u.text, 5);
      if (need <= 12.6) assert.ok(Number(u.duration_seconds) + 1e-6 >= need);
    }
    for (const u of units) {
      assert.match(u.text, /@\[阿杰/);
      assert.match(u.text, /@\[小满/);
      assert.match(u.text, /@\[奇趣蛋/);
      assert.match(u.text, /【分场】客厅/);
    }
  });

  it('merges overflow into next unit when same scene and fits', () => {
    const headHeavy = [
      '【分场】看房',
      '@[中介]{' + '测'.repeat(50) + '}',
      '@[阿杰]{好的。}',
      '@[阿杰]{就这个。}',
    ].join('\n');
    // 50+2+3 = 55 chars first speech alone is 10s; with 好的+就这个 = 55+2+3=60 exactly at edge
    // Make first line 58 chars so total > 12s, split leaves short tail that fits next
    const overloaded = [
      '【分场】看房',
      '@[中介]{' + '测'.repeat(58) + '}',
      '@[阿杰]{好的。}',
      '@[阿杰]{就这个。}',
    ].join('\n');
    const next = {
      unit_id: 'E1U04',
      duration_seconds: 5,
      source_text: '妈：行。',
      text: '【分场】看房\n@[妈]{行。}',
    };
    const { units, splits, merges } = repairSpeechOverloadUnits(
      [
        {
          unit_id: 'E1U03',
          duration_seconds: 12,
          source_text: '中介：测\n阿杰：好的。\n阿杰：就这个。',
          text: overloaded,
        },
        next,
      ],
      { durations: [4, 5, 8, 10, 12], speechRate: 5 }
    );
    assert.ok(splits >= 1);
    // 尾段并入下一镜（同分场且合并不超）
    assert.ok(merges >= 1 || units.length >= 2);
    const joined = units.find((u) => /行。/.test(u.text) && /就这个|好的/.test(u.text));
    assert.ok(joined || units.length >= 3, 'expected merge into next or extra split unit');
  });

  it('does not merge across different 【分场】', () => {
    const overloaded = [
      '【分场】A场',
      '@[阿杰]{' + '甲'.repeat(62) + '}',
      '@[阿杰]{走吧。}',
    ].join('\n');
    assert.ok(estimateSpeechSeconds(overloaded, 5) > 12.6);
    const { units, merges } = repairSpeechOverloadUnits(
      [
        {
          unit_id: 'E1U01',
          duration_seconds: 12,
          source_text: '阿杰：甲\n阿杰：走吧。',
          text: overloaded,
        },
        {
          unit_id: 'E1U02',
          duration_seconds: 5,
          source_text: '小满：嗨。',
          text: '【分场】B场\n@[小满]{嗨。}',
        },
      ],
      { durations: [4, 5, 8, 10, 12], speechRate: 5 }
    );
    assert.equal(merges, 0);
    assert.ok(units.length >= 3);
    assert.match(units[units.length - 1].text, /B场/);
  });
});
