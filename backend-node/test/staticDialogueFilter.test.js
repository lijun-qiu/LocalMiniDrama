const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');

describe('filterDialogueDrivenStoryboards', () => {
  const fn = episodeStoryboardService.filterDialogueDrivenStoryboards;

  it('drops silent padding and renumbers', () => {
    const out = fn([
      { shot_number: 1, title: '候场', dialogue: '', movement: 'pan' },
      { shot_number: 2, title: '入场', dialogue: '', action: '走进来' },
      { shot_number: 3, title: '请坐', dialogue: '林薇：请坐。', movement: '横摇pan' },
      { shot_number: 4, title: '回答', dialogue: '陈浩："因为我在找工作。"', movement: 'push' },
    ], null);
    assert.equal(out.length, 2);
    assert.equal(out[0].shot_number, 1);
    assert.equal(out[0].title, '请坐');
    assert.equal(out[0].movement, '固定镜头static');
    assert.equal(out[1].shot_number, 2);
    assert.equal(out[1].title, '回答');
  });

  it('falls back when all silent', () => {
    const list = [{ shot_number: 1, title: '空', dialogue: '' }];
    const out = fn(list, null);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, '空');
  });
});
