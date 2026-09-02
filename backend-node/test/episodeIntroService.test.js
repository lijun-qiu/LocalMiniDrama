const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  upsertIntro,
} = require('../src/services/episodeIntroService');
const { purgeAllEpisodeStoryboards } = require('../src/services/generatedAssetPurgeService');
const { finalizeEpisode, rowToStoryboard } = require('../src/services/dramaService');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      metadata TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_number INTEGER,
      status TEXT,
      video_url TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER,
      scene_id INTEGER,
      storyboard_number INTEGER DEFAULT 0,
      is_intro INTEGER DEFAULT 0,
      title TEXT,
      description TEXT,
      action TEXT,
      atmosphere TEXT,
      narration TEXT,
      duration REAL,
      characters TEXT,
      creation_mode TEXT,
      status TEXT,
      video_url TEXT,
      local_path TEXT,
      image_url TEXT,
      polished_prompt TEXT,
      image_prompt TEXT,
      video_prompt TEXT,
      narration_audio_local_path TEXT,
      narration_prompt_aligned_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER,
      prop_id INTEGER,
      PRIMARY KEY (storyboard_id, prop_id)
    );
    CREATE TABLE storyboard_characters (
      storyboard_id INTEGER,
      character_id INTEGER,
      created_at TEXT,
      PRIMARY KEY (storyboard_id, character_id)
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      name TEXT,
      deleted_at TEXT
    );
    CREATE TABLE character_libraries (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      name TEXT,
      deleted_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      name TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      status TEXT,
      video_url TEXT,
      local_path TEXT,
      completed_at TEXT,
      updated_at TEXT,
      created_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      status TEXT,
      image_url TEXT,
      local_path TEXT,
      deleted_at TEXT
    );
    CREATE TABLE frame_prompts (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      frame_type TEXT
    );
    CREATE TABLE video_merges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER,
      drama_id INTEGER,
      title TEXT,
      scenes TEXT,
      provider TEXT,
      merge_options TEXT,
      merged_url TEXT,
      status TEXT,
      error_msg TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT,
      resource_type TEXT,
      resource_id INTEGER,
      status TEXT,
      progress INTEGER,
      result TEXT,
      error_msg TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  db.prepare('INSERT INTO dramas (id, title, metadata, deleted_at) VALUES (1, ?, ?, NULL)').run(
    '测试剧',
    '{}'
  );
  db.prepare(
    'INSERT INTO episodes (id, drama_id, episode_number, status, deleted_at) VALUES (10, 1, 1, ?, NULL)'
  ).run('draft');
  return db;
}

const silentLog = { info() {}, warn() {}, error() {} };

describe('episodeIntroService', () => {
  it('upserts a single intro per episode and updates narration', () => {
    const db = setupDb();
    const a = upsertIntro(db, silentLog, 10, { narration: '第一段片头旁白', character_ids: [] }, rowToStoryboard);
    assert.ok(a);
    assert.equal(a.is_intro, 1);
    assert.equal(a.storyboard_number, 0);
    assert.equal(a.narration, '第一段片头旁白');

    const b = upsertIntro(db, silentLog, 10, { narration: '改后的片头旁白' }, rowToStoryboard);
    assert.equal(b.id, a.id);
    assert.equal(b.narration, '改后的片头旁白');

    const rows = db
      .prepare('SELECT id FROM storyboards WHERE episode_id = 10 AND COALESCE(is_intro,0)=1 AND deleted_at IS NULL')
      .all();
    assert.equal(rows.length, 1);
  });

  it('stores scene and prop links on intro', () => {
    const db = setupDb();
    db.prepare('INSERT INTO props (id, drama_id, episode_id, name, deleted_at) VALUES (5, 1, 10, ?, NULL)').run(
      '灯笼'
    );
    const intro = upsertIntro(
      db,
      silentLog,
      10,
      { narration: '灯笼亮起', scene_id: 3, prop_ids: [5], character_ids: [] },
      rowToStoryboard
    );
    assert.equal(intro.scene_id, 3);
    assert.deepEqual(intro.prop_ids, [5]);
    const link = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').get(intro.id);
    assert.equal(link.prop_id, 5);
  });

  it('does not clear narration audio when narration text unchanged on upsert', () => {
    const db = setupDb();
    const a = upsertIntro(db, silentLog, 10, { narration: '同一段旁白' }, rowToStoryboard);
    db.prepare(
      'UPDATE storyboards SET narration_audio_local_path = ?, narration_prompt_aligned_at = ? WHERE id = ?'
    ).run('audio/intro.mp3', '2026-01-01T00:00:00.000Z', a.id);
    upsertIntro(db, silentLog, 10, { narration: '同一段旁白', title: '片头' }, rowToStoryboard);
    const row = db.prepare('SELECT narration_audio_local_path, narration_prompt_aligned_at FROM storyboards WHERE id = ?').get(a.id);
    assert.equal(row.narration_audio_local_path, 'audio/intro.mp3');
    assert.equal(row.narration_prompt_aligned_at, '2026-01-01T00:00:00.000Z');
  });

  it('clears narration audio when narration text changes', () => {
    const db = setupDb();
    const a = upsertIntro(db, silentLog, 10, { narration: '旧旁白' }, rowToStoryboard);
    db.prepare('UPDATE storyboards SET narration_audio_local_path = ? WHERE id = ?').run('audio/intro.mp3', a.id);
    upsertIntro(db, silentLog, 10, { narration: '新旁白' }, rowToStoryboard);
    const row = db.prepare('SELECT narration_audio_local_path FROM storyboards WHERE id = ?').get(a.id);
    assert.equal(row.narration_audio_local_path, null);
  });
});

describe('purgeAllEpisodeStoryboards preserveIntro', () => {
  it('keeps intro when regenerating body storyboards', () => {
    const db = setupDb();
    const intro = upsertIntro(db, silentLog, 10, { narration: '保留我' }, rowToStoryboard);
    db.prepare(
      `INSERT INTO storyboards (episode_id, storyboard_number, is_intro, narration, status, created_at, updated_at)
       VALUES (10, 1, 0, '正文1', 'draft', datetime('now'), datetime('now'))`
    ).run();
    db.prepare(
      `INSERT INTO storyboards (episode_id, storyboard_number, is_intro, narration, status, created_at, updated_at)
       VALUES (10, 2, 0, '正文2', 'draft', datetime('now'), datetime('now'))`
    ).run();

    purgeAllEpisodeStoryboards(db, silentLog, 10, null, { preserveIntro: true });
    const left = db.prepare('SELECT id, is_intro FROM storyboards WHERE episode_id = 10').all();
    assert.equal(left.length, 1);
    assert.equal(Number(left[0].is_intro), 1);
    assert.equal(left[0].id, intro.id);
  });

  it('deletes intro when preserveIntro=false', () => {
    const db = setupDb();
    upsertIntro(db, silentLog, 10, { narration: '删掉我' }, rowToStoryboard);
    purgeAllEpisodeStoryboards(db, silentLog, 10, null, { preserveIntro: false });
    const left = db.prepare('SELECT id FROM storyboards WHERE episode_id = 10').all();
    assert.equal(left.length, 0);
  });
});

describe('finalizeEpisode include_intro', () => {
  it('prepends intro clip when include_intro is true', () => {
    const db = setupDb();
    const intro = upsertIntro(db, silentLog, 10, { narration: '片头旁白' }, rowToStoryboard);
    db.prepare('UPDATE storyboards SET video_url = ?, duration = 4, updated_at = ? WHERE id = ?').run(
      'http://example.com/intro.mp4',
      new Date().toISOString(),
      intro.id
    );
    const bodyInfo = db
      .prepare(
        `INSERT INTO storyboards (episode_id, storyboard_number, is_intro, narration, duration, video_url, status, created_at, updated_at)
         VALUES (10, 1, 0, '正文', 5, ?, 'draft', ?, ?)`
      )
      .run('http://example.com/body.mp4', new Date().toISOString(), new Date().toISOString());

    // stub videoMergeService.create to capture scenes without async process
    const videoMergeService = require('../src/services/videoMergeService');
    const originalCreate = videoMergeService.create;
    const originalProcess = videoMergeService.processVideoMerge;
    let captured = null;
    videoMergeService.create = (d, log, req) => {
      captured = req;
      return { merge_id: 99, id: 99, task_id: null };
    };
    videoMergeService.processVideoMerge = () => {};

    try {
      const result = finalizeEpisode(db, silentLog, 10, '', { include_intro: true });
      assert.equal(result.scenes_count, 2);
      assert.equal(result.include_intro, true);
      assert.ok(captured);
      assert.equal(captured.scenes.length, 2);
      assert.equal(captured.scenes[0].scene_id, intro.id);
      assert.equal(captured.scenes[0].is_intro, true);
      assert.equal(captured.scenes[1].scene_id, bodyInfo.lastInsertRowid);
      assert.equal(captured.scenes[0].order, 0);
      assert.equal(captured.scenes[1].order, 1);
    } finally {
      videoMergeService.create = originalCreate;
      videoMergeService.processVideoMerge = originalProcess;
    }
  });

  it('skips intro when include_intro is false', () => {
    const db = setupDb();
    const intro = upsertIntro(db, silentLog, 10, { narration: '片头旁白' }, rowToStoryboard);
    db.prepare('UPDATE storyboards SET video_url = ?, updated_at = ? WHERE id = ?').run(
      'http://example.com/intro.mp4',
      new Date().toISOString(),
      intro.id
    );
    db.prepare(
      `INSERT INTO storyboards (episode_id, storyboard_number, is_intro, narration, duration, video_url, status, created_at, updated_at)
       VALUES (10, 1, 0, '正文', 5, ?, 'draft', ?, ?)`
    ).run('http://example.com/body.mp4', new Date().toISOString(), new Date().toISOString());

    const videoMergeService = require('../src/services/videoMergeService');
    const originalCreate = videoMergeService.create;
    const originalProcess = videoMergeService.processVideoMerge;
    let captured = null;
    videoMergeService.create = (d, log, req) => {
      captured = req;
      return { merge_id: 100, id: 100, task_id: null };
    };
    videoMergeService.processVideoMerge = () => {};

    try {
      const result = finalizeEpisode(db, silentLog, 10, '', { include_intro: false });
      assert.equal(result.scenes_count, 1);
      assert.equal(result.include_intro, false);
      assert.equal(captured.scenes.length, 1);
      assert.notEqual(captured.scenes[0].scene_id, intro.id);
    } finally {
      videoMergeService.create = originalCreate;
      videoMergeService.processVideoMerge = originalProcess;
    }
  });
});
