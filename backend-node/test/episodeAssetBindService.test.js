const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  bindPropToEpisode,
  bindSceneToEpisode,
  syncEpisodeAssetBindsFromStoryboards,
  unbindPropFromEpisode,
} = require('../src/services/episodeAssetBindService');

function setupDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE props (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      name TEXT,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      location TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      scene_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER,
      prop_id INTEGER,
      PRIMARY KEY (storyboard_id, prop_id)
    );
  `);
  return db;
}

describe('episodeAssetBindService', () => {
  it('binds cross-episode prop used by storyboard into current episode', () => {
    const db = setupDb();
    db.prepare('INSERT INTO props (id, drama_id, episode_id, name, deleted_at) VALUES (109, 7, 11, ?, NULL)').run(
      '手机'
    );
    db.prepare('INSERT INTO storyboards (id, episode_id, scene_id, deleted_at) VALUES (1, 12, NULL, NULL)').run();
    db.prepare('INSERT INTO storyboard_props (storyboard_id, prop_id) VALUES (1, 109)').run();

    const r = syncEpisodeAssetBindsFromStoryboards(db, null, 12);
    assert.equal(r.props, 1);
    const link = db.prepare('SELECT * FROM episode_props WHERE episode_id = 12 AND prop_id = 109').get();
    assert.ok(link);
  });

  it('binds scene from previous episode when used by current storyboard', () => {
    const db = setupDb();
    db.prepare('INSERT INTO scenes (id, drama_id, episode_id, location, deleted_at) VALUES (2, 7, 11, ?, NULL)').run(
      '公寓'
    );
    db.prepare('INSERT INTO storyboards (id, episode_id, scene_id, deleted_at) VALUES (1, 12, 2, NULL)').run();

    const r = syncEpisodeAssetBindsFromStoryboards(db, null, 12);
    assert.equal(r.scenes, 1);
  });

  it('manual bind and unbind work', () => {
    const db = setupDb();
    db.prepare('INSERT INTO props (id, drama_id, episode_id, name, deleted_at) VALUES (1, 7, 11, ?, NULL)').run(
      '钥匙'
    );
    assert.equal(bindPropToEpisode(db, 12, 1), true);
    assert.ok(db.prepare('SELECT 1 FROM episode_props WHERE episode_id = 12 AND prop_id = 1').get());
    unbindPropFromEpisode(db, 12, 1);
    assert.equal(db.prepare('SELECT 1 FROM episode_props WHERE episode_id = 12 AND prop_id = 1').get(), undefined);
  });

  it('does not junction-bind own-episode assets', () => {
    const db = setupDb();
    db.prepare('INSERT INTO props (id, drama_id, episode_id, name, deleted_at) VALUES (3, 7, 12, ?, NULL)').run(
      '钢笔'
    );
    assert.equal(bindPropToEpisode(db, 12, 3), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM episode_props WHERE episode_id = 12').get().n, 0);
    assert.equal(bindSceneToEpisode(db, 12, 99), false);
  });
});
