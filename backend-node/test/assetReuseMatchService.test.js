const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const {
  matchRowsToMap,
  parseMatchArray,
  mergeSceneMatchWithFallback,
  mergePropMatchWithFallback,
  findReusableDramaProp,
  scorePropNameSimilarity,
  matchScenesWithAi,
} = require('../src/services/assetReuseMatchService');

describe('assetReuseMatchService', () => {
  it('parses AI match array and maps valid existing ids', () => {
    const rows = parseMatchArray(
      JSON.stringify([
        { incoming_index: 0, existing_id: 12, same: true, reason: '同公寓' },
        { incoming_index: 1, existing_id: 99, same: true, reason: '无效id' },
        { incoming_index: 2, existing_id: null, same: false, reason: '新地点' },
      ])
    );
    const map = matchRowsToMap(rows, [12, 15]);
    assert.equal(map.get(0), 12);
    assert.equal(map.has(1), false);
    assert.equal(map.has(2), false);
  });

  it('falls back to string similarity for scenes when AI map empty', () => {
    const incoming = [{ location: '公寓', time: '夜' }];
    const catalog = [
      { id: 1, location: '公寓卧室', time: '夜', episode_id: 1, local_path: 'a.png' },
    ];
    const map = mergeSceneMatchWithFallback(new Map(), incoming, catalog, 3);
    assert.equal(map.get(0), 1);
  });

  it('falls back to string similarity for props', () => {
    assert.ok(scorePropNameSimilarity('智能手机备忘录截图', '手机') >= 70);
    const hit = findReusableDramaProp(
      [{ id: 5, name: '智能手机备忘录截图', episode_id: 1, local_path: 'p.png' }],
      '手机',
      { excludeEpisodeId: 2 }
    );
    assert.equal(hit.prop.id, 5);
    const map = mergePropMatchWithFallback(
      new Map(),
      [{ name: '手机' }],
      [{ id: 5, name: '智能手机备忘录截图', episode_id: 1, local_path: 'p.png' }],
      2
    );
    assert.equal(map.get(0), 5);
  });

  it('uses AI scene match result when model returns mapping', async () => {
    const aiClient = require('../src/services/aiClient');
    mock.method(aiClient, 'generateText', async () =>
      JSON.stringify([{ incoming_index: 0, existing_id: 1, same: true, reason: '同一公寓' }])
    );
    const log = { info() {}, warn() {}, error() {} };
    const map = await matchScenesWithAi(
      {},
      log,
      [{ location: '公寓小居', time: '夜' }],
      [{ id: 1, location: '公寓卧室', time: '夜', local_path: 'x.png' }]
    );
    assert.equal(map.get(0), 1);
    mock.restoreAll();
  });
});
