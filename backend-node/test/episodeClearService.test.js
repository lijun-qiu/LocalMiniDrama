const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { clearEpisodeExceptScript, clearEpisodeMedia } = require('../src/services/episodeClearService');

function createTestDb() {
  const db = new Database(':memory:');
  const now = new Date().toISOString();
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, title TEXT, description TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY, drama_id INTEGER, episode_number INTEGER, title TEXT, script_content TEXT,
      description TEXT, duration INTEGER, video_url TEXT, thumbnail TEXT, status TEXT,
      full_narration_audio_local_path TEXT,
      created_at TEXT, updated_at TEXT, deleted_at TEXT
    );
    CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, deleted_at TEXT);
    CREATE TABLE episode_characters (episode_id INTEGER, character_id INTEGER, PRIMARY KEY (episode_id, character_id));
    CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, location TEXT, deleted_at TEXT);
    CREATE TABLE props (id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER, name TEXT, deleted_at TEXT);
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, episode_id INTEGER, title TEXT, deleted_at TEXT,
      narration_audio_local_path TEXT, audio_local_path TEXT,
      image_url TEXT, local_path TEXT, composed_image TEXT, video_url TEXT,
      first_frame_image_id INTEGER, last_frame_image_id INTEGER,
      last_frame_image_url TEXT, last_frame_local_path TEXT, updated_at TEXT
    );
    CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER, PRIMARY KEY (storyboard_id, prop_id));
    CREATE TABLE image_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, character_id INTEGER, scene_id INTEGER, deleted_at TEXT, local_path TEXT, image_url TEXT);
    CREATE TABLE video_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, scene_id INTEGER, deleted_at TEXT, local_path TEXT, video_url TEXT);
  `);
  db.prepare('INSERT INTO dramas (id, title, created_at, updated_at) VALUES (1, ?, ?, ?)').run('测试剧', now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, script_content, description, duration, video_url, status, created_at, updated_at)
     VALUES (10, 1, 1, '第1集', '保留的剧本正文', '集简介', 120, '/v/final.mp4', 'done', ?, ?)`
  ).run(now, now);
  db.prepare('INSERT INTO characters (id, drama_id, name) VALUES (100, 1, ?)').run('主角');
  db.prepare('INSERT INTO episode_characters (episode_id, character_id) VALUES (10, 100)').run();
  db.prepare('INSERT INTO scenes (id, drama_id, episode_id, location) VALUES (200, 1, 10, ?)').run('客厅');
  db.prepare('INSERT INTO props (id, drama_id, episode_id, name) VALUES (300, 1, 10, ?)').run('宝剑');
  db.prepare(
    `INSERT INTO storyboards (
      id, episode_id, title, narration_audio_local_path, audio_local_path,
      image_url, local_path, composed_image, video_url, first_frame_image_id, last_frame_image_id
    ) VALUES (400, 10, ?, 'audio/n.wav', 'audio/d.wav', 'img.png', 'img/local.png', 'composed.png', 'vid.mp4', 500, NULL)`
  ).run('开场');
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (400, 300)').run();
  db.prepare('INSERT INTO image_generations (id, storyboard_id) VALUES (500, 400)').run();
  db.prepare('INSERT INTO video_generations (id, storyboard_id) VALUES (600, 400)').run();
  return db;
}

describe('clearEpisodeExceptScript', () => {
  it('hard-deletes generated content but keeps script_content', () => {
    const db = createTestDb();
    const log = { info() {} };
    const result = clearEpisodeExceptScript(db, log, 10);
    assert.ok(result);
    assert.equal(result.script_preserved, true);
    assert.equal(result.storyboards, 1);
    assert.equal(result.characters, 1);
    assert.equal(result.scenes, 1);
    assert.equal(result.props, 1);

    const ep = db.prepare('SELECT script_content, video_url, status FROM episodes WHERE id = 10').get();
    assert.equal(ep.script_content, '保留的剧本正文');
    assert.equal(ep.video_url, null);
    assert.equal(ep.status, 'draft');

    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = 10').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM characters').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM episode_characters WHERE episode_id = 10').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM image_generations').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_generations').get().n, 0);
  });

  it('returns null for missing episode', () => {
    const db = createTestDb();
    const result = clearEpisodeExceptScript(db, { info() {} }, 999);
    assert.equal(result, null);
  });
});

describe('clearEpisodeMedia', () => {
  it('clears narration audio only', () => {
    const db = createTestDb();
    const result = clearEpisodeMedia(db, { info() {} }, 10, 'narration_audio');
    assert.equal(result.narration_audio, 1);
    const sb = db.prepare('SELECT * FROM storyboards WHERE id = 400').get();
    assert.equal(sb.narration_audio_local_path, null);
    assert.equal(sb.audio_local_path, null);
    assert.equal(sb.image_url, 'img.png');
    assert.equal(sb.video_url, 'vid.mp4');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM image_generations').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_generations').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM storyboards').get().n, 1);
  });

  it('hard-deletes storyboard images only', () => {
    const db = createTestDb();
    const result = clearEpisodeMedia(db, { info() {} }, 10, 'images');
    assert.equal(result.images, 1);
    const sb = db.prepare('SELECT * FROM storyboards WHERE id = 400').get();
    assert.equal(sb.image_url, null);
    assert.equal(sb.composed_image, null);
    assert.equal(sb.first_frame_image_id, null);
    assert.equal(sb.narration_audio_local_path, 'audio/n.wav');
    assert.equal(sb.local_path, null);
    assert.equal(sb.video_url, 'vid.mp4');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM image_generations').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_generations').get().n, 1);
  });

  it('hard-deletes storyboard videos only', () => {
    const db = createTestDb();
    const result = clearEpisodeMedia(db, { info() {} }, 10, 'videos');
    assert.equal(result.videos, 1);
    const sb = db.prepare('SELECT * FROM storyboards WHERE id = 400').get();
    assert.equal(sb.video_url, null);
    assert.equal(sb.image_url, 'img.png');
    assert.equal(sb.local_path, 'img/local.png');
    assert.equal(sb.narration_audio_local_path, 'audio/n.wav');
    const ep = db.prepare('SELECT video_url, duration FROM episodes WHERE id = 10').get();
    assert.equal(ep.video_url, null);
    assert.equal(ep.duration, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_generations').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM image_generations').get().n, 1);
  });

  it('clears video local_path when overwritten by video generation', () => {
    const db = createTestDb();
    db.prepare('UPDATE storyboards SET local_path = ? WHERE id = 400').run('videos/clip.mp4');
    clearEpisodeMedia(db, { info() {} }, 10, 'videos');
    const sb = db.prepare('SELECT local_path, video_url FROM storyboards WHERE id = 400').get();
    assert.equal(sb.video_url, null);
    assert.equal(sb.local_path, null);
  });

  it('rejects invalid kind', () => {
    const db = createTestDb();
    assert.throws(() => clearEpisodeMedia(db, { info() {} }, 10, 'other'), /不支持的清除类型/);
  });
});
