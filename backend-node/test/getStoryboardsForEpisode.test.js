const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { getStoryboardsForEpisode } = require('../src/services/episodeStoryboardService');

function createTestDb() {
  const db = new Database(':memory:');
  const now = new Date().toISOString();
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, deleted_at TEXT);
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
    CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER, location TEXT, deleted_at TEXT);
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      storyboard_number INTEGER,
      title TEXT,
      duration REAL,
      characters TEXT,
      deleted_at TEXT,
      status TEXT,
      creation_mode TEXT
    );
    CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER, PRIMARY KEY (storyboard_id, prop_id));
  `);
  db.prepare('INSERT INTO dramas (id) VALUES (1)').run();
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (10, 1)').run();
  db.prepare('INSERT INTO scenes (id, drama_id, location) VALUES (5, 1, ?)').run('大厅');
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, duration, characters, status, creation_mode)
     VALUES (1, 10, 1, '镜1', 6, ?, 'pending', 'classic')`
  ).run(JSON.stringify([{ id: 100, name: '甲' }]));
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, duration, characters, status, creation_mode)
     VALUES (2, 10, 2, '镜2', 8, '[]', 'pending', 'classic')`
  ).run();
  db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (1, 300), (1, 301), (2, 300)').run();
  return db;
}

describe('getStoryboardsForEpisode', () => {
  it('includes prop_ids from storyboard_props for each shot', () => {
    const db = createTestDb();
    const list = getStoryboardsForEpisode(db, 10);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0].prop_ids, [300, 301]);
    assert.deepEqual(list[1].prop_ids, [300]);
    assert.deepEqual(list[0].characters, [{ id: 100, name: '甲' }]);
  });

  it('returns empty prop_ids when no links exist', () => {
    const db = createTestDb();
    db.prepare('DELETE FROM storyboard_props WHERE storyboard_id = 2').run();
    const list = getStoryboardsForEpisode(db, 10);
    assert.deepEqual(list[1].prop_ids, []);
  });
});
