'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('canonicalDigest + artifactCurrency', () => {
  const { canonicalJsonDigest, basisDigest } = require('../src/services/workflow/canonicalDigest');
  const currency = require('../src/services/workflow/artifactCurrency');
  let dir;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-art-'));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('canonical digest is key-order independent', () => {
    assert.equal(canonicalJsonDigest({ a: 1, b: 2 }), canonicalJsonDigest({ b: 2, a: 1 }));
  });

  it('register then compare current / stale', () => {
    const key = currency.ArtifactKey.episodeStep1(1);
    const rel = 'drafts/episode_1/step1_segments.json';
    fs.mkdirSync(path.join(dir, 'drafts', 'episode_1'), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), '{"segments":[]}', 'utf8');
    const basis = {
      kind: 'structured-content/step1',
      kind_version: 2,
      inputs: { source_content: 'aaa' },
    };
    currency.registerCurrent(dir, key, rel, basis);
    assert.equal(currency.compare(dir, key, rel, basis), 'current');
    assert.equal(
      currency.compare(dir, key, rel, {
        ...basis,
        inputs: { source_content: 'bbb' },
      }),
      'stale'
    );
    assert.ok(basisDigest(basis).startsWith('sha256-v1:'));
  });
});

describe('scriptReview + videoUnits + enforced gate', () => {
  let db;
  let tmpStorage;
  let scriptReview;
  let videoUnits;
  let getWorkflowStatus;

  before(() => {
    tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-sr-'));
    process.env.LMD_STORAGE_ROOT = tmpStorage;
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
        image_url TEXT, local_path TEXT, looks TEXT,
        updated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE episode_characters (episode_id INTEGER, character_id INTEGER);
      CREATE TABLE scenes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drama_id INTEGER, episode_id INTEGER, location TEXT, prompt TEXT,
        image_url TEXT, local_path TEXT, updated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE props (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drama_id INTEGER, episode_id INTEGER, name TEXT, description TEXT,
        image_url TEXT, local_path TEXT, updated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE storyboards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_id INTEGER, scene_id INTEGER, storyboard_number INTEGER, creation_mode TEXT,
        title TEXT, description TEXT, narration TEXT, duration REAL,
        image_url TEXT, local_path TEXT, composed_image TEXT,
        video_url TEXT, audio_local_path TEXT, narration_audio_local_path TEXT,
        universal_segment_text TEXT, video_prompt TEXT, characters TEXT, status TEXT,
        created_at TEXT, updated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE storyboard_props (
        storyboard_id INTEGER, prop_id INTEGER,
        PRIMARY KEY (storyboard_id, prop_id)
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
    // Fresh require after env set
    delete require.cache[require.resolve('../src/services/workflow/scriptReviewService')];
    delete require.cache[require.resolve('../src/services/workflow/videoUnitsService')];
    delete require.cache[require.resolve('../src/services/workflow/workflowStateService')];
    scriptReview = require('../src/services/workflow/scriptReviewService');
    videoUnits = require('../src/services/workflow/videoUnitsService');
    getWorkflowStatus = require('../src/services/workflow/workflowStateService').getWorkflowStatus;
  });

  after(() => {
    try {
      db.close();
    } catch (_) {}
    delete process.env.LMD_STORAGE_ROOT;
    fs.rmSync(tmpStorage, { recursive: true, force: true });
  });

  function seedDrama(meta) {
    const now = new Date().toISOString();
    const id = db
      .prepare(
        `INSERT INTO dramas (title, metadata, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)`
      )
      .run('测', JSON.stringify(meta), now, now).lastInsertRowid;
    const ep = db
      .prepare(
        `INSERT INTO episodes (drama_id, episode_number, title, script_content, status, created_at, updated_at)
         VALUES (?, 1, 'E1', '第一段。\n\n第二段对白。', 'draft', ?, ?)`
      )
      .run(id, now, now).lastInsertRowid;
    db.prepare(
      `INSERT INTO characters (drama_id, name, image_url, deleted_at) VALUES (?, 'A', 'http://x/a.png', NULL)`
    ).run(id);
    return { id, ep };
  }

  function dramaRow(id) {
    const r = db.prepare('SELECT * FROM dramas WHERE id = ?').get(id);
    return { ...r, metadata: JSON.parse(r.metadata || '{}') };
  }

  // dramaService.getDramaById used by scriptReview — stub via require cache
  before(() => {
    const fake = {
      getDramaById: (database, id) => {
        const r = database.prepare('SELECT * FROM dramas WHERE id = ?').get(id);
        if (!r) return null;
        return { ...r, metadata: JSON.parse(r.metadata || '{}') };
      },
    };
    require.cache[require.resolve('../src/services/dramaService')] = {
      id: require.resolve('../src/services/dramaService'),
      filename: require.resolve('../src/services/dramaService'),
      loaded: true,
      exports: fake,
    };
  });

  it('enforced gate: prepare → pending → confirm', async () => {
    const { id, ep } = seedDrama({
      content_mode: 'drama',
      generation_mode: 'storyboard',
      workflow: { step1_enforced: true },
      storage_folder_label: 'test',
    });
    let status = getWorkflowStatus(db, dramaRow(id), { episode: 1 });
    assert.equal(status.state, 'STEP1_CONTENT');
    assert.equal(status.next_action.type, 'prepare_step1');

    const prepared = await scriptReview.prepareStep1(db, ep, { skip_llm: true });
    assert.equal(prepared.status, 'pending_review');
    assert.ok(prepared.fingerprint);

    status = getWorkflowStatus(db, dramaRow(id), { episode: 1 });
    assert.equal(status.state, 'STEP1_REVIEW');
    assert.equal(status.next_action.type, 'confirm_step1');

    const confirmed = scriptReview.confirmStep1(db, ep);
    assert.equal(confirmed.status, 'confirmed');

    status = getWorkflowStatus(db, dramaRow(id), { episode: 1 });
    assert.equal(status.state, 'FINAL_SCRIPT');
  });

  it('reference_video: wardrobe then confirm step1 then generate video_units', async () => {
    const { id, ep } = seedDrama({
      content_mode: 'narration',
      generation_mode: 'reference_video',
      workflow: { step1_enforced: true },
      storage_folder_label: 'rv',
    });
    const episodeWardrobe = require('../src/services/workflow/episodeWardrobe');
    episodeWardrobe.completeEpisodeWardrobe(db, id, ep, {});

    await scriptReview.prepareStep1(db, ep, { skip_llm: true });
    scriptReview.confirmStep1(db, ep);
    const out = await videoUnits.generateReferenceScript(db, { info() {}, warn() {} }, ep, {
      skip_llm: true,
    });
    assert.ok(out.video_units.length >= 1);
    assert.ok(out.unit_storyboard_map[out.video_units[0].unit_id]);

    const status = getWorkflowStatus(db, dramaRow(id), { episode: 1 });
    assert.equal(status.project.generation_mode, 'reference_video');
    assert.equal(status.state, 'VIDEO');
    assert.equal(status.next_action.type, 'generate_videos');
    assert.equal(
      require('../src/services/workflow/workflowPlan')
        .buildWorkflowPlan(status, { narration_delivery: 'post_production' })
        .steps.find((s) => s.id === 'storyboard').state,
      'skipped'
    );

    // reset_step1 回退到整理内容
    const reset = scriptReview.resetStep1(db, ep);
    assert.equal(reset.review.status, 'no_step1');
    let after = getWorkflowStatus(db, dramaRow(id), { episode: 1 });
    assert.equal(after.next_action.type, 'prepare_step1');
  });
});
