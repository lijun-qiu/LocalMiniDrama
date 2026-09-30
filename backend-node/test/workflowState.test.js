'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('getWorkflowStatus SQLite ladder', () => {
  let db;
  let tmpDir;
  let getWorkflowStatus;
  let buildWorkflowPlan;
  let getWorkflowPlan;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-wf-'));
    process.env.LOCAL_MINI_DRAMA_DB_PATH = path.join(tmpDir, 'test.db');
    // Prefer in-memory via better-sqlite3 directly to avoid full app boot
    const Database = require('better-sqlite3');
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE dramas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT, description TEXT, genre TEXT, style TEXT,
        metadata TEXT, status TEXT, thumbnail TEXT,
        total_episodes INTEGER, total_duration INTEGER,
        narration_seedance2_voice_asset TEXT,
        created_at TEXT, updated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drama_id INTEGER, episode_number INTEGER, title TEXT,
        script_content TEXT, description TEXT, duration INTEGER,
        status TEXT, video_url TEXT, thumbnail TEXT,
        created_at TEXT, updated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drama_id INTEGER, name TEXT, appearance TEXT, description TEXT,
        image_url TEXT, local_path TEXT, looks TEXT, deleted_at TEXT, updated_at TEXT
      );
      CREATE TABLE episode_characters (
        episode_id INTEGER, character_id INTEGER
      );
      CREATE TABLE scenes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drama_id INTEGER, episode_id INTEGER, location TEXT, prompt TEXT,
        image_url TEXT, local_path TEXT, deleted_at TEXT
      );
      CREATE TABLE props (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drama_id INTEGER, episode_id INTEGER, name TEXT, description TEXT,
        image_url TEXT, local_path TEXT, deleted_at TEXT
      );
      CREATE TABLE storyboards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id INTEGER, storyboard_number INTEGER, creation_mode TEXT,
        image_url TEXT, local_path TEXT, composed_image TEXT,
        video_url TEXT, audio_local_path TEXT, narration_audio_local_path TEXT,
        universal_segment_text TEXT, video_prompt TEXT, deleted_at TEXT
      );
      CREATE TABLE video_generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        storyboard_id INTEGER, status TEXT, local_path TEXT, video_url TEXT,
        created_at TEXT, deleted_at TEXT, provider_task_id TEXT
      );
      CREATE TABLE image_generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        storyboard_id INTEGER, status TEXT, task_id TEXT, created_at TEXT, deleted_at TEXT
      );
      CREATE TABLE async_tasks (
        id TEXT PRIMARY KEY, type TEXT, status TEXT, resource_id TEXT,
        created_at TEXT, deleted_at TEXT
      );
    `);
    ({ getWorkflowStatus } = require('../src/services/workflow/workflowStateService'));
    ({ buildWorkflowPlan } = require('../src/services/workflow/workflowPlan'));
    ({ getWorkflowPlan } = require('../src/services/workflow/workflowPlanner'));
  });

  after(() => {
    try {
      db.close();
    } catch (_) {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  function insertDrama(meta = {}) {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO dramas (title, metadata, status, created_at, updated_at)
         VALUES (?, ?, 'draft', ?, ?)`
      )
      .run(
        '测试剧',
        JSON.stringify({
          content_mode: 'drama',
          generation_mode: 'storyboard',
          ...meta,
        }),
        now,
        now
      );
    return info.lastInsertRowid;
  }

  function dramaRow(id) {
    const r = db.prepare('SELECT * FROM dramas WHERE id = ?').get(id);
    let metadata = {};
    try {
      metadata = JSON.parse(r.metadata || '{}');
    } catch (_) {}
    return { ...r, metadata };
  }

  it('asks collect_project_input when script empty', () => {
    const id = insertDrama();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO episodes (drama_id, episode_number, title, script_content, status, created_at, updated_at)
       VALUES (?, 1, 'E1', '', 'draft', ?, ?)`
    ).run(id, now, now);
    const status = getWorkflowStatus(db, dramaRow(id), { episode: 1 });
    assert.equal(status.state, 'PROJECT_INPUT');
    assert.equal(status.next_action.type, 'collect_project_input');
  });

  it('asks analyze_assets when script exists but no assets', () => {
    const id = insertDrama();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO episodes (drama_id, episode_number, title, script_content, status, created_at, updated_at)
       VALUES (?, 1, 'E1', '开场：少年出场。', 'draft', ?, ?)`
    ).run(id, now, now);
    const status = getWorkflowStatus(db, dramaRow(id), { episode: 1 });
    assert.equal(status.state, 'ASSET_INVENTORY');
    assert.equal(status.next_action.type, 'analyze_assets');
  });

  it('asks generate_script when assets exist but no storyboards', () => {
    const id = insertDrama();
    const now = new Date().toISOString();
    const ep = db
      .prepare(
        `INSERT INTO episodes (drama_id, episode_number, title, script_content, status, created_at, updated_at)
         VALUES (?, 1, 'E1', '开场。', 'draft', ?, ?)`
      )
      .run(id, now, now).lastInsertRowid;
    db.prepare(
      `INSERT INTO characters (drama_id, name, image_url, deleted_at) VALUES (?, '少年', 'http://x/a.png', NULL)`
    ).run(id);
    const status = getWorkflowStatus(db, dramaRow(id), { episode: 1 });
    assert.equal(status.state, 'FINAL_SCRIPT');
    assert.equal(status.next_action.type, 'generate_script');
    assert.ok(ep);
  });

  it('narration × reference_video skips storyboard and requests video_units', () => {
    const id = insertDrama({ content_mode: 'narration', generation_mode: 'reference_video' });
    const now = new Date().toISOString();
    const epId = db
      .prepare(
        `INSERT INTO episodes (drama_id, episode_number, title, script_content, status, created_at, updated_at)
         VALUES (?, 1, 'E1', '旁白解说稿。', 'draft', ?, ?)`
      )
      .run(id, now, now).lastInsertRowid;
    db.prepare(
      `INSERT INTO characters (drama_id, name, image_url, deleted_at) VALUES (?, '旁白视角', 'http://x/a.png', NULL)`
    ).run(id);

    // wardrobe gate must complete before step1 / final_script for reference_video
    const fakeDramaService = {
      getDramaById: (database, dramaId) => {
        const r = database.prepare('SELECT * FROM dramas WHERE id = ?').get(dramaId);
        if (!r) return null;
        let metadata = {};
        try {
          metadata = JSON.parse(r.metadata || '{}');
        } catch (_) {}
        return { ...r, metadata };
      },
    };
    require.cache[require.resolve('../src/services/dramaService')] = {
      id: require.resolve('../src/services/dramaService'),
      filename: require.resolve('../src/services/dramaService'),
      loaded: true,
      exports: fakeDramaService,
    };
    const episodeWardrobe = require('../src/services/workflow/episodeWardrobe');
    episodeWardrobe.completeEpisodeWardrobe(db, id, epId, {});

    const status = getWorkflowStatus(db, dramaRow(id), { episode: 1 });
    assert.equal(status.project.content_mode, 'narration');
    assert.equal(status.project.generation_mode, 'reference_video');
    assert.equal(status.state, 'FINAL_SCRIPT');
    assert.equal(status.next_action.type, 'generate_script');
    assert.equal(status.next_action.args.skeleton_kind, 'video_units');
    const plan = buildWorkflowPlan(status, { narration_delivery: 'post_production' });
    assert.equal(plan.steps.find((s) => s.id === 'storyboard').state, 'skipped');
  });

  it('getWorkflowPlan returns schema_version 1 envelope', () => {
    const id = insertDrama({ content_mode: 'drama', generation_mode: 'storyboard' });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO episodes (drama_id, episode_number, title, script_content, status, created_at, updated_at)
       VALUES (?, 1, 'E1', '', 'draft', ?, ?)`
    ).run(id, now, now);
    const plan = getWorkflowPlan(db, dramaRow(id), { episode: 1 });
    assert.equal(plan.schema_version, 1);
    assert.ok(Array.isArray(plan.steps));
    assert.ok(plan.next_action?.type);
    assert.equal(plan.narration_delivery.persisted, false);
  });
});
