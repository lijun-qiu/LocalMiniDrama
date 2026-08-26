const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  splitScriptIntoNarrationSegments,
  mergeShortNarrationSegments,
  enforceFullNarrationSegments,
  countNarrationSpeechChars,
  normalizeNarrationCoverageText,
  resolveFullNarrationLimits,
  FULL_NARRATION_TARGET_CHARS,
  FULL_NARRATION_MIN_CHARS,
  FULL_NARRATION_MAX_CHARS,
} = require('../src/services/episodeStoryboardService');

const TARGET = FULL_NARRATION_TARGET_CHARS;
const MIN = FULL_NARRATION_MIN_CHARS;
const MAX = FULL_NARRATION_MAX_CHARS;

function segN(n, ch = '一') {
  return ch.repeat(n);
}

describe('estimateDurationFromSpeechText', () => {
  it('uses 5.5 chars/sec, ceil on overflow, clamps to 4–10s', () => {
    const { estimateDurationFromSpeechText } = require('../src/services/episodeStoryboardService');
    assert.equal(estimateDurationFromSpeechText('一'.repeat(22)), 4);
    assert.equal(estimateDurationFromSpeechText('一'.repeat(50)), 10);
    assert.equal(estimateDurationFromSpeechText('一'.repeat(55)), 10);
    assert.equal(estimateDurationFromSpeechText('一'.repeat(15)), 4);
    assert.equal(
      estimateDurationFromSpeechText(
        '府里那位俊俏的少爷常引得姑娘们脸红心跳，你却心如止水。'
      ),
      5
    );
  });
});

describe('countNarrationSpeechChars', () => {
  it('excludes punctuation from char count', () => {
    assert.equal(countNarrationSpeechChars('剩下的全交给老婆刘念。她以前是小'), 15);
    assert.equal(countNarrationSpeechChars('学美术老师，结婚后嫌累辞了，在家画画、养猫、做做烘焙。'), 22);
  });
});

describe('resolveFullNarrationLimits', () => {
  it('scales target/max chars with chars per sec (6 → 54/60)', () => {
    const limits = resolveFullNarrationLimits(6);
    assert.equal(limits.NARRATION_CHARS_PER_SEC, 6);
    assert.equal(limits.FULL_NARRATION_TARGET_CHARS, 54);
    assert.equal(limits.FULL_NARRATION_MAX_CHARS, 60);
  });
});

describe('splitScriptIntoNarrationSegments', () => {
  it('uses target ~50 / hard max 55 by default', () => {
    assert.equal(TARGET, 50);
    assert.equal(MAX, 55);
    assert.equal(MIN, 44);
  });

  it('uses 6 chars/sec limits (54 target / 60 max)', () => {
    const limits = resolveFullNarrationLimits(6);
    const script =
      '夏天晒得满身疮，可你从不敢有半句怨言——因为这已经是活命的代价。十六岁那年，你的身子渐渐长开，心底也多了一份说不清道不明的情绪。府里那位俊俏的少爷常引得姑娘们脸红心跳，你却心如止水。';
    const segs = splitScriptIntoNarrationSegments(script, limits);
    assert.ok(segs.length >= 2);
    for (const seg of segs) {
      assert.ok(
        countNarrationSpeechChars(seg) <= limits.FULL_NARRATION_MAX_CHARS,
        `segment too long (${countNarrationSpeechChars(seg)}): ${seg}`
      );
    }
  });

  it('covers full script text without dropping characters', () => {
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

  it('packs toward ~50 chars and backs up before exceeding 55', () => {
    const script =
      '夏天晒得满身疮，可你从不敢有半句怨言——因为这已经是活命的代价。十六岁那年，你的身子渐渐长开，心底也多了一份说不清道不明的情绪。府里那位俊俏的少爷常引得姑娘们脸红心跳，你却心如止水。';
    const segs = splitScriptIntoNarrationSegments(script);
    assert.ok(segs.length >= 2, `expected >=2 segments, got ${segs.length}`);
    assert.equal(normalizeNarrationCoverageText(segs.join('')), normalizeNarrationCoverageText(script));
    for (const seg of segs) {
      assert.ok(
        countNarrationSpeechChars(seg) <= MAX,
        `segment too long (${countNarrationSpeechChars(seg)}): ${seg}`
      );
    }
  });

  it('never exceeds hard max 55 speech chars per segment', () => {
    const script =
      segN(80) +
      '。' +
      segN(90, '二') +
      '，继续说下去然后到句号。' +
      segN(70, '三');
    const segs = splitScriptIntoNarrationSegments(script);
    assert.ok(segs.length > 0);
    for (const seg of segs) {
      assert.ok(
        countNarrationSpeechChars(seg) <= MAX,
        `segment too long: ${countNarrationSpeechChars(seg)} > ${MAX}`
      );
    }
  });

  it('splits last over-max remainder into two shots', () => {
    // 一段无标点超长 + 尾部短句：末段规则仍保证 ≤55
    const script = segN(60) + '。' + segN(30, '尾') + '。';
    const segs = splitScriptIntoNarrationSegments(script);
    assert.equal(normalizeNarrationCoverageText(segs.join('')), normalizeNarrationCoverageText(script));
    for (const seg of segs) {
      assert.ok(countNarrationSpeechChars(seg) <= MAX);
    }
  });

  it('does not split words like 小学 across segments', () => {
    const script =
      '剩下的全交给老婆刘念。' +
      segN(44, '她') +
      '以前是小学美术老师，结婚后嫌累辞了，在家画画、养猫、做做烘焙。';
    const segs = splitScriptIntoNarrationSegments(script);
    const joined = segs.join('');
    for (let i = 0; i < segs.length - 1; i++) {
      const tail = segs[i].slice(-1);
      const head = segs[i + 1].slice(0, 1);
      if (tail === '小' && head === '学') {
        assert.fail(`split 小学 across segments: "${segs[i]}" | "${segs[i + 1]}"`);
      }
    }
    assert.equal(normalizeNarrationCoverageText(joined), normalizeNarrationCoverageText(script));
  });
});

describe('mergeShortNarrationSegments', () => {
  it('respects dynamic target at 6 chars/sec (54)', () => {
    const limits = resolveFullNarrationLimits(6);
    const input = [segN(30) + '。', segN(30, '二') + '。'];
    const out = mergeShortNarrationSegments(
      input,
      limits.FULL_NARRATION_MIN_CHARS,
      limits.FULL_NARRATION_MAX_CHARS,
      limits.FULL_NARRATION_TARGET_CHARS
    );
    assert.equal(out.length, 2);
    for (const seg of out) {
      assert.ok(countNarrationSpeechChars(seg) <= limits.FULL_NARRATION_MAX_CHARS);
    }
  });

  it('does not merge past target when combining shorts', () => {
    const input = [segN(30) + '。', segN(30, '二') + '。'];
    const out = mergeShortNarrationSegments(input, MIN, MAX, TARGET);
    for (const seg of out) {
      assert.ok(countNarrationSpeechChars(seg) <= MAX);
    }
    assert.equal(normalizeNarrationCoverageText(out.join('')), normalizeNarrationCoverageText(input.join('')));
  });

  it('does not merge two segments that each already meet soft min', () => {
    const input = [segN(MIN, '一') + '。', segN(MIN, '二') + '。'];
    const out = mergeShortNarrationSegments(input, MIN, MAX);
    assert.equal(out.length, 2);
  });
});

describe('enforceFullNarrationSegments', () => {
  it('uses shot 1 as empty title card; narration segments start at shot 2', () => {
    const segs = ['第一段旁白内容足够长用于绑定测试甲。', '第二段旁白内容足够长用于绑定测试乙。'];
    const boards = [
      { shot_number: 1, title: 'A', narration: '旧' },
      { shot_number: 2, title: 'B', narration: '旧2' },
    ];
    const log = { warn() {}, info() {} };
    const out = enforceFullNarrationSegments(boards, segs, log, 't1');
    assert.equal(out.length, 3);
    assert.equal(out[0].narration, '');
    assert.equal(out[1].narration, segs[0]);
    assert.equal(out[2].narration, segs[1]);
  });

  it('inherits scene/characters from shot 2 onto title shot', () => {
    const segs = ['旁白段落一足够长度用于测试继承角色场景字段。'];
    const boards = [
      { shot_number: 1, title: '片头', narration: 'x', scene_id: null, characters: [] },
      { shot_number: 2, title: '正片', narration: 'y', scene_id: 9, characters: [1, 2], props: [3] },
    ];
    const out = enforceFullNarrationSegments(boards, segs, { warn() {}, info() {} }, 't2');
    assert.equal(out[0].scene_id, 9);
    assert.deepEqual(out[0].characters, [1, 2]);
  });

  it('trims extra AI shots so last narration shot reaches script end', () => {
    const segs = ['唯一旁白段足够长度。'];
    const boards = [
      { shot_number: 1 },
      { shot_number: 2 },
      { shot_number: 3 },
      { shot_number: 4 },
    ];
    const out = enforceFullNarrationSegments(boards, segs, { warn() {}, info() {} }, 't3');
    assert.equal(out.length, 2);
    assert.equal(out[1].narration, segs[0]);
  });
});
