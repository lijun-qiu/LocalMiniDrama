const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  listPropsForStoryboardPrompt,
  listScenesForStoryboardPrompt,
  allocatePropIds,
  allocateSceneId,
  scorePropAgainstText,
  scoreSceneLocationSimilarity,
  findReusableDramaScene,
} = require('../src/utils/episodeAssetScope');
const {
  persistExtractedBackgrounds,
} = require('../src/services/backgroundExtractionService');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE props (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      name TEXT,
      type TEXT,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      location TEXT,
      time TEXT,
      prompt TEXT,
      polished_prompt TEXT,
      polished_prompt_single TEXT,
      image_url TEXT,
      local_path TEXT,
      extra_images TEXT,
      storyboard_count INTEGER,
      status TEXT,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE episode_scenes (
      episode_id INTEGER,
      scene_id INTEGER,
      PRIMARY KEY (episode_id, scene_id)
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      scene_id INTEGER,
      deleted_at TEXT,
      updated_at TEXT
    );
  `);
  return db;
}

describe('storyboard asset allocation', () => {
  it('lists all drama props with current episode first', () => {
    const db = setupDb();
    db.prepare(
      'INSERT INTO props (id, drama_id, episode_id, name, type, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)'
    ).run(109, 7, 11, '手机备忘录截图', '关键道具');
    db.prepare(
      'INSERT INTO props (id, drama_id, episode_id, name, type, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)'
    ).run(200, 7, 12, '图书馆电脑', '日常用品');

    const props = listPropsForStoryboardPrompt(db, 7, 12);
    assert.equal(props.length, 2);
    assert.equal(props[0].id, 200);
    assert.equal(props[1].id, 109);
  });

  it('allocates computer not phone when shot text says 电脑', () => {
    const props = [
      { id: 109, name: '手机备忘录截图（数字信息载体）', episode_id: 11 },
      { id: 200, name: '图书馆电脑', episode_id: 12 },
    ];
    const text = '你用同事的名字借了台电脑，搜索苏蔓死亡';
    const ids = allocatePropIds(props, text, 12);
    assert.deepEqual(ids, [200]);
    assert.ok(scorePropAgainstText(props[0], text.toLowerCase(), 12) < 40);
  });

  it('allocates phone when shot text says 手机', () => {
    const props = [
      { id: 109, name: '手机备忘录截图（数字信息载体）', episode_id: 11 },
      { id: 200, name: '图书馆电脑', episode_id: 12 },
    ];
    const text = '镜头切换到手机地图界面，显示诊所位置';
    const ids = allocatePropIds(props, text, 12);
    assert.deepEqual(ids, [109]);
  });

  it('allocates scene by location match preferring current episode on tie', () => {
    const db = setupDb();
    db.prepare(
      'INSERT INTO scenes (id, drama_id, episode_id, location, time, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)'
    ).run(1, 7, 11, '图书馆', '夜晚');
    db.prepare(
      'INSERT INTO scenes (id, drama_id, episode_id, location, time, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)'
    ).run(2, 7, 12, '图书馆', '清晨');
    db.prepare(
      'INSERT INTO scenes (id, drama_id, episode_id, location, time, deleted_at) VALUES (?, ?, ?, ?, ?, NULL)'
    ).run(3, 7, 12, '废弃工厂', '白天');

    const scenes = listScenesForStoryboardPrompt(db, 7, 12);
    const id = allocateSceneId(
      scenes,
      { location: '图书馆', time: '清晨', narration: '第二天一早，你去了图书馆。' },
      12
    );
    assert.equal(id, 2);
  });

  it('scores 公寓 vs 公寓卧室 as reusable same place', () => {
    assert.ok(scoreSceneLocationSimilarity('公寓卧室', '公寓') >= 70);
    assert.ok(scoreSceneLocationSimilarity('公寓', '公寓卧室') >= 70);
    assert.equal(scoreSceneLocationSimilarity('公寓卧室', '公寓卧室'), 100);
    assert.equal(scoreSceneLocationSimilarity('图书馆', '废弃工厂'), 0);
  });

  it('reuses 公寓卧室 when extracting 公寓 for another episode', () => {
    const existing = [
      { id: 1, location: '公寓卧室', time: '夜', episode_id: 1, local_path: 'scenes/1.png' },
      { id: 2, location: '咖啡馆', time: '日', episode_id: 1 },
    ];
    const hit = findReusableDramaScene(existing, '公寓', '夜', { excludeEpisodeId: 3 });
    assert.ok(hit);
    assert.equal(hit.scene.id, 1);
  });

  it('prefers imaged specific scene over short current-ep duplicate when allocating', () => {
    const scenes = [
      { id: 10, location: '公寓', time: '夜', episode_id: 3 },
      { id: 1, location: '公寓卧室', time: '夜', episode_id: 1, local_path: 'x.png' },
    ];
    const id = allocateSceneId(scenes, { location: '公寓', time: '夜', action: '在公寓里' }, 3);
    assert.equal(id, 1);
  });
});

describe('persistExtractedBackgrounds reuse', () => {
  it('binds existing 公寓卧室 instead of creating 公寓', async () => {
    const db = setupDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO scenes (id, drama_id, episode_id, location, time, prompt, local_path, status, created_at, updated_at)
       VALUES (1, 7, 1, '公寓卧室', '夜', '旧提示', 's.png', 'completed', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO scenes (id, drama_id, episode_id, location, time, prompt, status, created_at, updated_at)
       VALUES (9, 7, 3, '公寓', '夜', '将删', 'pending', ?, ?)`
    ).run(now, now);

    const log = { info() {}, warn() {}, error() {} };
    const out = await persistExtractedBackgrounds(
      db,
      log,
      { id: 3, drama_id: 7 },
      [{ location: '公寓', time: '夜', prompt: '新提示' }],
      null,
      ''
    );
    assert.equal(out.reusedCount, 1);
    assert.equal(out.createdCount, 0);
    assert.equal(out.scenes[0].id, 1);
    const bind = db.prepare('SELECT * FROM episode_scenes WHERE episode_id = 3 AND scene_id = 1').get();
    assert.ok(bind);
    const dead = db.prepare('SELECT deleted_at FROM scenes WHERE id = 9').get();
    assert.ok(dead.deleted_at);
  });
});
