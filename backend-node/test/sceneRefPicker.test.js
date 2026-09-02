const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  isSceneFourViewComposite,
  pickSceneRefForVideo,
  pickLatestSceneQuadPanel,
} = require('../src/utils/sceneRefPicker');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      local_path TEXT,
      image_url TEXT,
      ref_image TEXT,
      polished_prompt TEXT,
      polished_prompt_single TEXT,
      deleted_at TEXT
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      scene_id INTEGER,
      frame_type TEXT,
      local_path TEXT,
      image_url TEXT,
      status TEXT
    );
  `);
  return db;
}

describe('sceneRefPicker', () => {
  it('detects four-view composite from polished_prompt', () => {
    assert.equal(
      isSceneFourViewComposite({ polished_prompt: '2x2 grid layout with four panels' }),
      true
    );
    assert.equal(
      isSceneFourViewComposite({ polished_prompt: 'single wide establishing shot of a room' }),
      false
    );
  });

  it('pickSceneRefForVideo uses quad_panel_0 instead of whole grid', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO scenes (id, drama_id, local_path, polished_prompt) VALUES (1, 7, 'scenes/quad.jpg', '2x2 grid four panels')`
    ).run();
    db.prepare(
      `INSERT INTO image_generations (drama_id, scene_id, frame_type, local_path, status)
       VALUES (7, 1, 'quad_panel_0', 'scenes/quad_panel0.jpg', 'completed')`
    ).run();
    const scene = db.prepare('SELECT * FROM scenes WHERE id = 1').get();
    const picked = pickSceneRefForVideo(db, null, scene, null);
    assert.equal(picked.ref, 'scenes/quad_panel0.jpg');
    assert.equal(picked.isPanel, true);
  });

  it('pickSceneRefForVideo skips whole grid when no panel exists', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO scenes (id, drama_id, local_path, polished_prompt) VALUES (2, 7, 'scenes/quad.jpg', '2x2 grid four panels')`
    ).run();
    const scene = db.prepare('SELECT * FROM scenes WHERE id = 2').get();
    const picked = pickSceneRefForVideo(db, null, scene, null);
    assert.equal(picked.ref, null);
  });

  it('pickSceneRefForVideo uses single scene local_path when not composite', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO scenes (id, drama_id, local_path, polished_prompt_single) VALUES (3, 7, 'scenes/single.jpg', 'wide room')`
    ).run();
    const scene = db.prepare('SELECT * FROM scenes WHERE id = 3').get();
    const picked = pickSceneRefForVideo(db, null, scene, null);
    assert.equal(picked.ref, 'scenes/single.jpg');
  });

  it('pickLatestSceneQuadPanel finds panel by index', () => {
    const db = makeDb();
    db.prepare(
      `INSERT INTO image_generations (drama_id, scene_id, frame_type, local_path, status)
       VALUES (1, 5, 'quad_panel_0', 'p0.jpg', 'completed')`
    ).run();
    assert.equal(pickLatestSceneQuadPanel(db, 5, 0), 'p0.jpg');
  });
});
