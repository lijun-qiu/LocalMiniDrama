const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  splitScriptIntoNarrationSegments,
  splitScriptIntoNarrationSegmentsByPeriod,
  mergeShortNarrationSegments,
  enforceFullNarrationSegments,
  countNarrationSpeechChars,
  normalizeNarrationCoverageText,
  resolveFullNarrationLimits,
  resolveFullNarrationSplitPlan,
  tokenizeNarrationByPeriod,
  packPeriodSentences,
  FULL_NARRATION_TARGET_CHARS,
  FULL_NARRATION_MIN_CHARS,
  FULL_NARRATION_MAX_CHARS,
} = require('../src/services/episodeStoryboardService');

const MAX = FULL_NARRATION_MAX_CHARS;
const MIN = FULL_NARRATION_MIN_CHARS;
const TARGET = FULL_NARRATION_TARGET_CHARS;

function segN(n, ch = '一') {
  return ch.repeat(n);
}

describe('estimateDurationFromSpeechText', () => {
  it('uses 5.5 chars/sec, ceil on overflow, clamps to 4–12s', () => {
    const { estimateDurationFromSpeechText } = require('../src/services/episodeStoryboardService');
    assert.equal(estimateDurationFromSpeechText('一'.repeat(20)), 4);
    assert.equal(estimateDurationFromSpeechText('一'.repeat(45)), 9);
    assert.equal(estimateDurationFromSpeechText('一'.repeat(66)), 12);
    assert.equal(estimateDurationFromSpeechText('一'.repeat(80)), 12);
  });
});

describe('resolveFullNarrationLimits', () => {
  it('uses 12s max for classic and period splitMode', () => {
    const limits = resolveFullNarrationLimits(5.5);
    assert.equal(limits.FULL_NARRATION_MAX_SEC, 12);
    assert.equal(limits.FULL_NARRATION_MAX_CHARS, 66);
    assert.equal(limits.splitMode, 'period');
  });

  it('scales max chars with chars per sec (6 → 72)', () => {
    const limits = resolveFullNarrationLimits(6);
    assert.equal(limits.FULL_NARRATION_MAX_CHARS, 72);
  });
});

describe('tokenizeNarrationByPeriod', () => {
  it('splits only at 。 and keeps the period', () => {
    const units = tokenizeNarrationByPeriod('第一句。第二句。第三');
    assert.deepEqual(units, ['第一句。', '第二句。', '第三']);
  });
});

describe('packPeriodSentences', () => {
  it('merges up to 3 short sentences under max chars', () => {
    const limits = resolveFullNarrationLimits(5);
    const sentences = ['他走进房间。', '窗外下着雨。', '桌上放着信。'];
    const out = packPeriodSentences(sentences, limits);
    assert.equal(out.length, 1);
    assert.equal(out[0], sentences.join(''));
  });

  it('merges many short sentences when under max chars', () => {
    const limits = resolveFullNarrationLimits(5);
    const sentences = ['一。', '二。', '三。', '四。', '五。', '六。', '七。', '八。'];
    const out = packPeriodSentences(sentences, limits);
    assert.equal(out.length, 1);
    assert.equal(out[0], sentences.join(''));
  });

  it('splits when combined would exceed max chars', () => {
    const limits = resolveFullNarrationLimits(5);
    const s1 = segN(25) + '。';
    const s2 = segN(25, '二') + '。';
    const s3 = segN(25, '三') + '。';
    const out = packPeriodSentences([s1, s2, s3], limits);
    assert.ok(out.length >= 2);
    for (const seg of out) {
      assert.ok(countNarrationSpeechChars(seg) <= limits.FULL_NARRATION_MAX_CHARS);
    }
    assert.equal(normalizeNarrationCoverageText(out.join('')), normalizeNarrationCoverageText(s1 + s2 + s3));
  });
});

describe('splitScriptIntoNarrationSegments', () => {
  it('default max is 66 chars at 5.5 cps', () => {
    assert.equal(MAX, 66);
    assert.equal(TARGET, 66);
    assert.equal(MIN, 44);
  });

  it('covers full script without dropping characters', () => {
    const script =
      '清晨，阳光洒进房间。她缓缓睁开眼睛，望向窗外。远处传来鸟鸣声，新的一天开始了。' +
      '她起身走到窗边，看着街道上渐渐热闹起来，心里想着今天要做的事情。';
    const segs = splitScriptIntoNarrationSegments(script);
    assert.ok(segs.length > 0);
    assert.equal(normalizeNarrationCoverageText(segs.join('')), normalizeNarrationCoverageText(script));
    for (const seg of segs) {
      assert.ok(countNarrationSpeechChars(seg) <= MAX, `segment too long: ${countNarrationSpeechChars(seg)}`);
    }
  });

  it('merges short sentences separated by blank lines', () => {
    const script = '他走进房间。\n\n窗外下着雨。\n\n桌上放着一封信。';
    const segs = splitScriptIntoNarrationSegments(script);
    assert.equal(segs.length, 1);
    assert.equal(normalizeNarrationCoverageText(segs.join('')), normalizeNarrationCoverageText(script));
  });

  it('merges multiple short 。 sentences into one shot', () => {
    const script = '他走进房间。窗外下着雨。桌上放着一封信。';
    const segs = splitScriptIntoNarrationSegments(script);
    assert.equal(segs.length, 1);
    assert.equal(segs[0], script);
  });

  it('splits when next sentence would exceed 12s char limit', () => {
    const script = '一。二。三。四。五。六。七。八。九。十。';
    const segs = splitScriptIntoNarrationSegments(script);
    assert.ok(segs.length >= 1);
    for (const seg of segs) {
      assert.ok(countNarrationSpeechChars(seg) <= MAX);
    }
    assert.equal(normalizeNarrationCoverageText(segs.join('')), normalizeNarrationCoverageText(script));
  });

  it('never exceeds hard max speech chars per segment', () => {
    const longSent = segN(70) + '。';
    const script = longSent + segN(20, '二') + '。';
    const segs = splitScriptIntoNarrationSegments(script);
    for (const seg of segs) {
      assert.ok(countNarrationSpeechChars(seg) <= MAX);
    }
    assert.equal(normalizeNarrationCoverageText(segs.join('')), normalizeNarrationCoverageText(script));
  });
});

describe('resolveFullNarrationSplitPlan', () => {
  it('uses period mode for both classic and universal', () => {
    const script = '短句一。短句二。短句三。';
    const planClassic = resolveFullNarrationSplitPlan(script, resolveFullNarrationLimits(5), false);
    const planUni = resolveFullNarrationSplitPlan(script, resolveFullNarrationLimits(5), true);
    assert.equal(planClassic.limits.splitMode, 'period');
    assert.equal(planUni.limits.splitMode, 'period');
    assert.deepEqual(planClassic.segments, planUni.segments);
    assert.equal(planClassic.segments.length, 1);
  });
});

describe('enforceFullNarrationSegments', () => {
  it('binds narration segments from shot 1', () => {
    const segs = ['第一段旁白内容足够长用于绑定测试甲。', '第二段旁白内容足够长用于绑定测试乙。'];
    const boards = [
      { shot_number: 1, title: 'A', narration: '旧' },
      { shot_number: 2, title: 'B', narration: '旧2' },
    ];
    const out = enforceFullNarrationSegments(boards, segs, { warn() {}, info() {} }, 't1');
    assert.equal(out.length, 2);
    assert.equal(out[0].narration, segs[0]);
    assert.equal(out[1].narration, segs[1]);
  });
});
