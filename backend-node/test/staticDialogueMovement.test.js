const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Re-implement same helper locally via requiring service internals is awkward;
// test through a tiny extract by evaluating the exported path after we export it.
const episodeStoryboardService = require('../src/services/episodeStoryboardService');

describe('applyStaticDialogueMovement', () => {
  const fn = episodeStoryboardService.applyStaticDialogueMovement;

  it('forces static when dialogue present and no travel', () => {
    assert.equal(
      fn('横摇pan', '林薇：为什么来这儿？', '林薇皱眉追问，横摇从林薇到陈浩'),
      '固定镜头static'
    );
  });

  it('keeps original when no dialogue', () => {
    assert.equal(fn('横摇pan', '', '缓慢横摇扫过办公室'), '横摇pan');
  });

  it('keeps dynamic when action has travel', () => {
    assert.equal(
      fn('跟镜tracking', '陈浩：散了吧', '陈浩起身出门离开办公室'),
      '跟镜tracking'
    );
  });
});
