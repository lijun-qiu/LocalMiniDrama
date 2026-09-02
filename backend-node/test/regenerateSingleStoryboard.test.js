const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function createTestDb() {
  const db = new Database(':memory:');
  const now = new Date().toISOString();
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      style TEXT,
      metadata TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      script_content TEXT,
      description TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      name TEXT,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      location TEXT,
      time TEXT,
      deleted_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      name TEXT,
      type TEXT,
      deleted_at TEXT
    );
    CREATE TABLE character_libraries (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      name TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      scene_id INTEGER,
      storyboard_number INTEGER,
      title TEXT,
      description TEXT,
      location TEXT,
      time TEXT,
      duration REAL,
      dialogue TEXT,
      narration TEXT,
      action TEXT,
      result TEXT,
      atmosphere TEXT,
      image_prompt TEXT,
      video_prompt TEXT,
      characters TEXT,
      shot_type TEXT,
      angle TEXT,
      angle_h TEXT,
      angle_v TEXT,
      angle_s TEXT,
      movement TEXT,
      lighting_style TEXT,
      depth_of_field TEXT,
      segment_index INTEGER,
      segment_title TEXT,
      creation_mode TEXT,
      universal_segment_text TEXT,
      narration_prompt_aligned_at TEXT,
      status TEXT,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE storyboard_characters (
      storyboard_id INTEGER,
      character_id INTEGER,
      created_at TEXT,
      PRIMARY KEY (storyboard_id, character_id)
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER,
      prop_id INTEGER,
      PRIMARY KEY (storyboard_id, prop_id)
    );
  `);
  db.prepare(
    `INSERT INTO dramas (id, style, metadata) VALUES (1, '写实', ?)`
  ).run(JSON.stringify({ storyboard_universal_omni: false, storyboard_full_narration_video_mode: false }));
  db.prepare(
    `INSERT INTO episodes (id, drama_id, script_content) VALUES (10, 1, ?)`
  ).run('甲走进大厅，拿起信封。乙站在门口。');
  db.prepare(`INSERT INTO characters (id, drama_id, name) VALUES (100, 1, '甲'), (101, 1, '乙')`).run();
  db.prepare(`INSERT INTO scenes (id, drama_id, location, time) VALUES (5, 1, '大厅', '日'), (6, 1, '门口', '日')`).run();
  db.prepare(`INSERT INTO props (id, drama_id, name) VALUES (300, 1, '信封'), (301, 1, '钥匙')`).run();
  db.prepare(
    `INSERT INTO storyboards (
      id, episode_id, scene_id, storyboard_number, title, description, location, time, duration,
      dialogue, narration, action, result, atmosphere, image_prompt, video_prompt, characters,
      shot_type, movement, segment_index, segment_title, creation_mode, status, created_at, updated_at
    ) VALUES (
      1, 10, 5, 2, '旧标题', '旧描述', '大厅', '日', 8,
      '旧对白', '', '旧动作', '旧结果', '', '旧图词', '旧视词', ?,
      '中景', 'push', 0, '开场', 'classic', 'pending', ?, ?
    )`
  ).run(JSON.stringify([100]), now, now);
  db.prepare('INSERT INTO storyboard_characters (storyboard_id, character_id, created_at) VALUES (1, 100, ?)').run(now);
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (1, 300)').run();
  return db;
}

describe('regenerateSingleStoryboardAsync', () => {
  it('keeps existing asset bindings when rebind_assets is false', async () => {
    const aiClient = require('../src/services/aiClient');
    mock.method(aiClient, 'generateText', async () =>
      JSON.stringify({
        shot_number: 2,
        title: '新标题',
        segment_index: 0,
        segment_title: '开场',
        location: '门口',
        time: '日',
        shot_type: '近景',
        camera_angle: '平视',
        camera_movement: 'push',
        lighting_style: 'soft',
        depth_of_field: 'shallow',
        action: '乙推开门',
        result: '门开',
        dialogue: '谁？',
        narration: '',
        emotion: '紧张',
        duration: 6,
        scene_id: 6,
        characters: [101],
        props: [301],
      })
    );

    const { regenerateSingleStoryboardAsync } = require('../src/services/episodeStoryboardService');
    const db = createTestDb();
    const log = { info() {}, warn() {}, error() {} };
    const sb = await regenerateSingleStoryboardAsync(db, log, 1, { rebindAssets: false });

    assert.equal(sb.title, '新标题');
    assert.equal(sb.action, '乙推开门');
    assert.equal(sb.scene_id, 5, '应保留原场景绑定');
    assert.deepEqual(
      (sb.characters || []).map((c) => Number(typeof c === 'object' ? c.id : c)),
      [100]
    );
    assert.deepEqual(sb.prop_ids, [300]);
    mock.restoreAll();
  });

  it('rebinds assets when rebind_assets is true', async () => {
    const aiClient = require('../src/services/aiClient');
    mock.method(aiClient, 'generateText', async () =>
      JSON.stringify({
        shot_number: 2,
        title: '重绑标题',
        segment_index: 0,
        segment_title: '开场',
        location: '门口',
        time: '日',
        shot_type: '近景',
        camera_angle: '平视',
        camera_movement: 'push',
        lighting_style: 'soft',
        depth_of_field: 'shallow',
        action: '乙推开门拿钥匙',
        result: '门开',
        dialogue: '进来',
        narration: '',
        emotion: '平静',
        duration: 7,
        scene_id: 6,
        characters: [101],
        props: [301],
      })
    );

    const { regenerateSingleStoryboardAsync } = require('../src/services/episodeStoryboardService');
    const db = createTestDb();
    const log = { info() {}, warn() {}, error() {} };
    const sb = await regenerateSingleStoryboardAsync(db, log, 1, { rebindAssets: true });

    assert.equal(sb.title, '重绑标题');
    assert.equal(sb.scene_id, 6);
    assert.deepEqual(
      (sb.characters || []).map((c) => Number(typeof c === 'object' ? c.id : c)),
      [101]
    );
    assert.deepEqual(sb.prop_ids, [301]);
    mock.restoreAll();
  });
});
