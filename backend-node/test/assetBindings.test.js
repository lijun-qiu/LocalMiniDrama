'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveAssetBindings } = require('../src/services/workflow/referenceMentions');

describe('resolveAssetBindings (ArcReel-aligned)', () => {
  const catalogs = {
    characters: [
      { id: 1, name: '阿杰' },
      { id: 2, name: '妈' },
      { id: 3, name: '小满' },
    ],
    scenes: [
      { id: 10, location: '便利店·童年' },
      { id: 11, location: '出租屋·宜家风格公寓' },
      { id: 12, location: '家里·高中' },
    ],
    props: [
      { id: 20, name: '奇趣蛋' },
      { id: 21, name: '手机' },
      { id: 22, name: 'EV63机械键盘' },
    ],
  };

  it('binds scene/prop/character from @[mentions]', () => {
    const text =
      '【分场】便利店·童年 @[便利店·童年] @[阿杰@童年] 拿起@[奇趣蛋]。@[阿杰%内心独白]{男生的遗憾}@[妈]{别吃}';
    const b = resolveAssetBindings(text, catalogs);
    assert.equal(b.sceneId, 10);
    assert.deepEqual(b.propIds, [20]);
    assert.ok(b.characterIds.includes(1));
    assert.ok(b.characterIds.includes(2));
    const aj = b.characterBindings.find((c) => c.id === 1);
    assert.equal(aj.look, '童年');
  });

  it('binds scene from 【分场】 when no @[场景]', () => {
    const b = resolveAssetBindings(
      '【分场】家里·高中\n@[阿杰]{生日想换手机}',
      catalogs
    );
    assert.equal(b.sceneId, 12);
    assert.deepEqual(b.characterIds, [1]);
  });

  it('binds scene from short @[便利店] to 便利店·童年', () => {
    const b = resolveAssetBindings('【分场】便利店·童年 @[便利店] @[阿杰]{买蛋}', catalogs);
    assert.equal(b.sceneId, 10);
  });

  it('binds props via soft <名> after omni render', () => {
    const b = resolveAssetBindings(
      '<阿杰>说 {就只有三千了。} 盯着 <奇趣蛋> 。',
      catalogs
    );
    assert.ok(b.characterIds.includes(1));
    assert.deepEqual(b.propIds, [20]);
  });

  it('soft-binds bare registered prop name when LLM omits @[道具]', () => {
    const b = resolveAssetBindings('阿杰看着奇趣蛋发呆，桌上还有EV63机械键盘。', catalogs);
    assert.ok(b.propIds.includes(20));
    assert.ok(b.propIds.includes(22));
  });

  it('collision: character name wins over same-named scene', () => {
    const cats = {
      characters: [{ id: 1, name: '雨巷' }],
      scenes: [{ id: 10, location: '雨巷' }],
      props: [],
    };
    const b = resolveAssetBindings('@[雨巷] 站着。', cats);
    assert.deepEqual(b.characterIds, [1]);
    assert.equal(b.sceneId, null);
  });
});
