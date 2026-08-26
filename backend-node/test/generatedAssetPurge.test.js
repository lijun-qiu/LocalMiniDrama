const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hardDeleteStoryboardIds } = require('../src/services/generatedAssetPurgeService');

describe('generatedAssetPurgeService', () => {
  it('hard-deletes storyboard rows, generations, and local files', () => {
    const db = new Database(':memory:');
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-test-'));
    const rel = 'projects/demo/images/test.png';
    const abs = path.join(storageRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'png');

    db.exec(`
      CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, local_path TEXT, image_url TEXT);
      CREATE TABLE image_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, local_path TEXT, image_url TEXT);
      CREATE TABLE video_generations (id INTEGER PRIMARY KEY, storyboard_id INTEGER, local_path TEXT, video_url TEXT);
      CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER, PRIMARY KEY (storyboard_id, prop_id));
      CREATE TABLE frame_prompts (id INTEGER PRIMARY KEY, storyboard_id INTEGER);
      CREATE TABLE storyboard_characters (storyboard_id INTEGER, character_id INTEGER, created_at TEXT, PRIMARY KEY (storyboard_id, character_id));
    `);
    db.prepare('INSERT INTO storyboards (id, episode_id, local_path) VALUES (1, 9, ?)').run(rel);
    db.prepare('INSERT INTO image_generations (id, storyboard_id, local_path) VALUES (10, 1, ?)').run(rel);
    db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (1, 2)').run();

    const out = hardDeleteStoryboardIds(db, { warn() {} }, [1], storageRoot);
    assert.equal(out.storyboards, 1);
    assert.equal(out.images, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM storyboards').get().n, 0);
    assert.equal(fs.existsSync(abs), false);
    db.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });
});
