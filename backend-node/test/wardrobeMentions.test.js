'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseLooks,
  splitMentionNameLook,
  lookAssetId,
  upsertLook,
  listLookIds,
  hasLookImage,
  BASE_LOOK_ID,
} = require('../src/services/workflow/characterLooks');
const {
  parseReferenceMentions,
  renderMentionsToOmniSpeech,
  deriveVisualReferences,
  innerMonologueLipGuard,
} = require('../src/services/workflow/referenceMentions');

describe('characterLooks', () => {
  it('splits name@look and builds asset ids', () => {
    assert.deepEqual(splitMentionNameLook('林北'), { name: '林北', look: BASE_LOOK_ID });
    assert.deepEqual(splitMentionNameLook('林北@战损'), { name: '林北', look: '战损' });
    assert.equal(lookAssetId('林北', 'base'), '林北');
    assert.equal(lookAssetId('林北', '战损'), '林北__战损');
  });

  it('detects childhood age band for look sheets', () => {
    const { inferLookAgeBand, ageBandPromptBlock } = require('../src/services/workflow/characterLooks');
    assert.equal(inferLookAgeBand('童年', '浅色短袖，约8岁瘦小个子'), 'child');
    assert.equal(inferLookAgeBand('战损', '破衣血痕'), null);
    assert.match(ageBandPromptBlock('child', '平头，约8岁'), /童年|儿童|1:4/);
  });

  it('upserts looks in sqlite', () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE characters (
        id INTEGER PRIMARY KEY, name TEXT, looks TEXT, deleted_at TEXT, updated_at TEXT
      );
    `);
    db.prepare(`INSERT INTO characters (id, name, looks) VALUES (1, '林北', NULL)`).run();
    upsertLook(db, 1, '战损', { description: '破衣血痕' });
    const row = db.prepare('SELECT looks FROM characters WHERE id = 1').get();
    const looks = parseLooks(row.looks);
    assert.equal(looks.战损.description, '破衣血痕');
    assert.deepEqual(listLookIds({ looks: row.looks }), ['base', '战损']);
    assert.equal(hasLookImage({ image_url: 'http://x', looks: row.looks }, 'base'), true);
    assert.equal(hasLookImage({ looks: row.looks }, '战损'), false);
    db.close();
  });
});

describe('getAssetReview', () => {
  it('lists characters, scenes, and props together', () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE dramas (
        id INTEGER PRIMARY KEY, title TEXT, metadata TEXT, updated_at TEXT
      );
      CREATE TABLE episodes (
        id INTEGER PRIMARY KEY, drama_id INTEGER, episode_number INTEGER,
        script_content TEXT, deleted_at TEXT
      );
      CREATE TABLE characters (
        id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, appearance TEXT,
        description TEXT, image_url TEXT, local_path TEXT, looks TEXT, deleted_at TEXT
      );
      CREATE TABLE episode_characters (episode_id INTEGER, character_id INTEGER);
      CREATE TABLE scenes (
        id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER,
        location TEXT, prompt TEXT, image_url TEXT, local_path TEXT, deleted_at TEXT
      );
      CREATE TABLE props (
        id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER,
        name TEXT, description TEXT, image_url TEXT, local_path TEXT, deleted_at TEXT
      );
    `);
    db.prepare(`INSERT INTO dramas (id, title, metadata) VALUES (1, 't', '{}')`).run();
    db.prepare(
      `INSERT INTO episodes (id, drama_id, episode_number, script_content) VALUES (1, 1, 1, '剧本')`
    ).run();
    db.prepare(
      `INSERT INTO characters (id, drama_id, name, image_url) VALUES (1, 1, '林北', 'http://c.png')`
    ).run();
    db.prepare(`INSERT INTO episode_characters (episode_id, character_id) VALUES (1, 1)`).run();
    db.prepare(
      `INSERT INTO scenes (id, drama_id, episode_id, location, image_url) VALUES (1, 1, 1, '雨巷', NULL)`
    ).run();
    db.prepare(
      `INSERT INTO props (id, drama_id, episode_id, name, image_url) VALUES (1, 1, 1, '油纸伞', 'http://p.png')`
    ).run();

    require.cache[require.resolve('../src/services/dramaService')] = {
      id: require.resolve('../src/services/dramaService'),
      filename: require.resolve('../src/services/dramaService'),
      loaded: true,
      exports: {
        getDramaById: (database, id) => {
          const r = database.prepare('SELECT * FROM dramas WHERE id = ?').get(id);
          return r ? { ...r, metadata: JSON.parse(r.metadata || '{}') } : null;
        },
      },
    };

    const { getAssetReview, completeEpisodeWardrobe } = require('../src/services/workflow/episodeWardrobe');
    const review = getAssetReview(db, 1, 1);
    assert.equal(review.summary.characters, 1);
    assert.equal(review.summary.scenes, 1);
    assert.equal(review.summary.props, 1);
    assert.equal(review.scenes[0].name, '雨巷');
    assert.equal(review.scenes[0].has_image, false);
    assert.equal(review.props[0].has_image, true);

    const done = completeEpisodeWardrobe(db, 1, 1, {});
    assert.equal(done.summary.scenes, 1);
    assert.ok(done.marker.source_revision);
    db.close();
  });

  it('scanLooksFromScript registers @[角色@造型]', () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE dramas (id INTEGER PRIMARY KEY, title TEXT, metadata TEXT, updated_at TEXT);
      CREATE TABLE episodes (
        id INTEGER PRIMARY KEY, drama_id INTEGER, episode_number INTEGER,
        script_content TEXT, deleted_at TEXT
      );
      CREATE TABLE characters (
        id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, appearance TEXT,
        description TEXT, image_url TEXT, local_path TEXT, looks TEXT, deleted_at TEXT, updated_at TEXT
      );
      CREATE TABLE episode_characters (episode_id INTEGER, character_id INTEGER);
      CREATE TABLE scenes (
        id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER,
        location TEXT, prompt TEXT, image_url TEXT, local_path TEXT, deleted_at TEXT
      );
      CREATE TABLE props (
        id INTEGER PRIMARY KEY, drama_id INTEGER, episode_id INTEGER,
        name TEXT, description TEXT, image_url TEXT, local_path TEXT, deleted_at TEXT
      );
    `);
    db.prepare(`INSERT INTO dramas (id, title, metadata) VALUES (1, 't', '{}')`).run();
    db.prepare(
      `INSERT INTO episodes (id, drama_id, episode_number, script_content)
       VALUES (1, 1, 1, '@[林北@战损] 站在雨中')`
    ).run();
    db.prepare(
      `INSERT INTO characters (id, drama_id, name, image_url) VALUES (1, 1, '林北', 'http://c.png')`
    ).run();
    db.prepare(`INSERT INTO episode_characters (episode_id, character_id) VALUES (1, 1)`).run();

    require.cache[require.resolve('../src/services/dramaService')] = {
      id: require.resolve('../src/services/dramaService'),
      filename: require.resolve('../src/services/dramaService'),
      loaded: true,
      exports: {
        getDramaById: (database, id) => {
          const r = database.prepare('SELECT * FROM dramas WHERE id = ?').get(id);
          return r ? { ...r, metadata: JSON.parse(r.metadata || '{}') } : null;
        },
      },
    };

    delete require.cache[require.resolve('../src/services/workflow/episodeWardrobe')];
    const { scanLooksFromScript } = require('../src/services/workflow/episodeWardrobe');
    const out = scanLooksFromScript(db, 1, 1);
    assert.equal(out.upserted.length, 1);
    assert.equal(out.upserted[0].look_id, '战损');
    assert.ok(out.review.characters[0].look_ids.includes('战损'));
    db.close();
  });
});

describe('proposeEpisodeAssets helpers + complete scenes/props', () => {
  it('normalizeLooks accepts array and ArcReel map', () => {
    const { normalizeLooks, normalizeNamed } = require('../src/services/workflow/proposeEpisodeAssets');
    const fromArr = normalizeLooks([
      { character_name: '阿杰', look_id: '童年', description: '短袖短裤' },
    ]);
    assert.equal(fromArr[0].look_id, '童年');
    const fromMap = normalizeLooks({ 阿杰: { 童年: '短袖短裤' } });
    assert.equal(fromMap[0].character_name, '阿杰');
    assert.equal(normalizeNamed({ 雨巷: '青石板' }, 'scene')[0].name, '雨巷');
  });

  it('completeEpisodeWardrobe writes look + scene + prop', () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE dramas (id INTEGER PRIMARY KEY, title TEXT, metadata TEXT, updated_at TEXT);
      CREATE TABLE episodes (
        id INTEGER PRIMARY KEY, drama_id INTEGER, episode_number INTEGER,
        script_content TEXT, deleted_at TEXT
      );
      CREATE TABLE characters (
        id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, appearance TEXT,
        description TEXT, image_url TEXT, local_path TEXT, looks TEXT, deleted_at TEXT, updated_at TEXT
      );
      CREATE TABLE episode_characters (episode_id INTEGER, character_id INTEGER);
      CREATE TABLE scenes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, episode_id INTEGER,
        location TEXT, time TEXT, prompt TEXT, image_url TEXT, local_path TEXT,
        storyboard_count INTEGER, status TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
      );
      CREATE TABLE props (
        id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, episode_id INTEGER,
        name TEXT, type TEXT, description TEXT, prompt TEXT, negative_prompt TEXT,
        image_url TEXT, local_path TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT
      );
    `);
    db.prepare(`INSERT INTO dramas (id, title, metadata) VALUES (1, 't', '{}')`).run();
    db.prepare(
      `INSERT INTO episodes (id, drama_id, episode_number, script_content) VALUES (1, 1, 1, '童年阿杰在雨巷')`
    ).run();
    db.prepare(
      `INSERT INTO characters (id, drama_id, name, image_url) VALUES (1, 1, '阿杰', 'http://c.png')`
    ).run();
    db.prepare(`INSERT INTO episode_characters (episode_id, character_id) VALUES (1, 1)`).run();

    require.cache[require.resolve('../src/services/dramaService')] = {
      id: require.resolve('../src/services/dramaService'),
      filename: require.resolve('../src/services/dramaService'),
      loaded: true,
      exports: {
        getDramaById: (database, id) => {
          const r = database.prepare('SELECT * FROM dramas WHERE id = ?').get(id);
          return r ? { ...r, metadata: JSON.parse(r.metadata || '{}') } : null;
        },
      },
    };
    delete require.cache[require.resolve('../src/services/workflow/episodeWardrobe')];
    const { completeEpisodeWardrobe } = require('../src/services/workflow/episodeWardrobe');
    const out = completeEpisodeWardrobe(db, 1, 1, {
      looks: [{ character_name: '阿杰', look_id: '童年', description: '短袖短裤瘦小孩' }],
      scenes: [{ name: '雨巷', description: '窄巷青石板' }],
      props: [{ name: '油纸伞', description: '旧伞' }],
    });
    assert.deepEqual(out.added, ['阿杰@童年']);
    assert.deepEqual(out.added_scenes, ['雨巷']);
    assert.deepEqual(out.added_props, ['油纸伞']);
    assert.ok(out.characters[0].look_ids.includes('童年'));
    db.close();
  });
});

describe('referenceMentions', () => {
  it('parses look asset, dialogue, monologue, and VO', () => {
    const text =
      '@[林北@战损] 站在雨中 @[林北%内心独白]{完了} @[林薇]{快走} {远处传来汽笛}';
    const { hits, errors } = parseReferenceMentions(text);
    assert.equal(errors.length, 0);
    assert.ok(hits.some((h) => h.kind === 'asset' && h.name === '林北' && h.look === '战损'));
    assert.ok(hits.some((h) => h.kind === 'speech' && h.innerMonologue && h.text === '完了'));
    assert.ok(hits.some((h) => h.kind === 'speech' && !h.innerMonologue && h.name === '林薇'));
    assert.ok(hits.some((h) => h.kind === 'vo'));
    const refs = deriveVisualReferences(hits);
    assert.deepEqual(refs, [{ name: '林北', look: '战损' }]);
  });

  it('renders to omni speech forms with lip guard', () => {
    const raw = '@[林北@战损%内心独白]{别怕} @[林薇]{跟我走} {旁白一句}';
    const rendered = renderMentionsToOmniSpeech(raw);
    assert.match(rendered, /<林北>内心独白 \{别怕\}【心声画面：嘴唇紧闭，不吐舌、不开口，无发声口部动作】/);
    assert.match(rendered, /<林薇>说 \{跟我走\}/);
    assert.match(rendered, /画外音说 \{旁白一句\}/);
    const { hits } = parseReferenceMentions(raw);
    // 林北本段只有心声、无对白 → 可追加整段闭嘴句
    assert.match(innerMonologueLipGuard(hits), /<林北>嘴唇紧闭，不吐舌、不开口/);
  });
});
