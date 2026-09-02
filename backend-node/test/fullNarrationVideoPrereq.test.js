const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const {
  assertFullNarrationVideoPrerequisites,
  MISSING_NARRATION_AUDIO_MSG,
  MISSING_NARRATION_PROMPT_ALIGN_MSG,
} = require('../src/services/videoService');

describe('assertFullNarrationVideoPrerequisites', () => {
  let db;
  let tmpDir;
  let prevCwd;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fnv-prereq-'));
    prevCwd = process.cwd();
    process.chdir(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'data', 'storage'), { recursive: true });
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE dramas (id INTEGER PRIMARY KEY, metadata TEXT, deleted_at TEXT);
      CREATE TABLE storyboards (
        id INTEGER PRIMARY KEY,
        storyboard_number INTEGER,
        is_intro INTEGER DEFAULT 0,
        narration TEXT,
        narration_audio_local_path TEXT,
        narration_prompt_aligned_at TEXT,
        deleted_at TEXT
      );
    `);
  });

  after(() => {
    try { db.close(); } catch (_) {}
    process.chdir(prevCwd);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  it('allows when not full-narration mode', () => {
    db.prepare('DELETE FROM dramas').run();
    db.prepare('DELETE FROM storyboards').run();
    db.prepare('INSERT INTO dramas (id, metadata) VALUES (1, ?)').run(JSON.stringify({}));
    db.prepare('INSERT INTO storyboards (id, storyboard_number, narration) VALUES (10, 1, ?)').run('有旁白无配音');
    assert.equal(assertFullNarrationVideoPrerequisites(db, 1, 10).ok, true);
  });

  it('allows empty narration without audio', () => {
    db.prepare('DELETE FROM dramas').run();
    db.prepare('DELETE FROM storyboards').run();
    db.prepare('INSERT INTO dramas (id, metadata) VALUES (1, ?)').run(
      JSON.stringify({ storyboard_full_narration_video_mode: true })
    );
    db.prepare('INSERT INTO storyboards (id, storyboard_number, narration) VALUES (10, 1, ?)').run('');
    assert.equal(assertFullNarrationVideoPrerequisites(db, 1, 10).ok, true);
  });

  it('blocks when narration exists but no audio path (including shot 1)', () => {
    db.prepare('DELETE FROM dramas').run();
    db.prepare('DELETE FROM storyboards').run();
    db.prepare('INSERT INTO dramas (id, metadata) VALUES (1, ?)').run(
      JSON.stringify({ storyboard_full_narration_video_mode: true })
    );
    db.prepare('INSERT INTO storyboards (id, storyboard_number, narration) VALUES (10, 1, ?)').run('你睁开眼。');
    const r = assertFullNarrationVideoPrerequisites(db, 1, 10);
    assert.equal(r.ok, false);
    assert.match(r.error, /配音/);
    assert.equal(r.error, MISSING_NARRATION_AUDIO_MSG);
  });

  it('blocks when audio exists but prompts not aligned after narration', () => {
    db.prepare('DELETE FROM dramas').run();
    db.prepare('DELETE FROM storyboards').run();
    db.prepare('INSERT INTO dramas (id, metadata) VALUES (1, ?)').run(
      JSON.stringify({ storyboard_full_narration_video_mode: true })
    );
    const rel = 'audio/test_narr.mp3';
    const abs = path.join(tmpDir, 'data', 'storage', 'audio');
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, 'test_narr.mp3'), 'x');
    db.prepare(
      'INSERT INTO storyboards (id, storyboard_number, narration, narration_audio_local_path) VALUES (10, 1, ?, ?)'
    ).run('你睁开眼。', rel);
    const r = assertFullNarrationVideoPrerequisites(db, 1, 10);
    assert.equal(r.ok, false);
    assert.equal(r.error, MISSING_NARRATION_PROMPT_ALIGN_MSG);
  });

  it('allows when audio file exists and prompts aligned', () => {
    db.prepare('DELETE FROM dramas').run();
    db.prepare('DELETE FROM storyboards').run();
    db.prepare('INSERT INTO dramas (id, metadata) VALUES (1, ?)').run(
      JSON.stringify({ storyboard_full_narration_video_mode: true })
    );
    const rel = 'audio/test_narr2.mp3';
    const abs = path.join(tmpDir, 'data', 'storage', 'audio');
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, 'test_narr2.mp3'), 'x');
    db.prepare(
      `INSERT INTO storyboards
       (id, storyboard_number, narration, narration_audio_local_path, narration_prompt_aligned_at)
       VALUES (10, 1, ?, ?, ?)`
    ).run('你睁开眼。', rel, new Date().toISOString());
    assert.equal(assertFullNarrationVideoPrerequisites(db, 1, 10).ok, true);
  });
});
