'use strict';

/**
 * Episode asset review (衣橱/资产确认) — reference_video pre-step1 gate.
 * Covers characters (looks) + scenes + props in one confirmation.
 * Marker: dramas.metadata.workflow.episode_wardrobe["{episodeNumber}"]
 */

const scriptReview = require('./scriptReviewService');
const characterLooks = require('./characterLooks');
const { makeAction } = require('./workflowActions');
const { digestRaw } = require('./canonicalDigest');

function episodeSourceRevision(scriptContent) {
  return `sha256-v1:${digestRaw(String(scriptContent || ''))}`;
}

function getWardrobeMarker(meta, episodeNumber) {
  const map = meta?.workflow?.episode_wardrobe;
  if (!map || typeof map !== 'object') return null;
  const m = map[String(episodeNumber)];
  return m && typeof m === 'object' ? m : null;
}

function listDramaCharacters(db, dramaId, episodeId) {
  const viaEp = db
    .prepare(
      `SELECT c.id, c.name, c.appearance, c.description, c.image_url, c.local_path, c.looks
       FROM characters c
       INNER JOIN episode_characters ec ON ec.character_id = c.id
       WHERE ec.episode_id = ? AND c.drama_id = ? AND c.deleted_at IS NULL`
    )
    .all(episodeId, dramaId);
  if (viaEp.length) return viaEp;
  return db
    .prepare(
      `SELECT id, name, appearance, description, image_url, local_path, looks
       FROM characters WHERE drama_id = ? AND deleted_at IS NULL`
    )
    .all(dramaId);
}

function listEpisodeScenes(db, dramaId, episodeId) {
  let rows = db
    .prepare(
      `SELECT id, location, prompt, image_url, local_path
       FROM scenes
       WHERE drama_id = ? AND episode_id = ? AND deleted_at IS NULL`
    )
    .all(dramaId, episodeId);
  if (rows.length) return rows;
  return db
    .prepare(
      `SELECT id, location, prompt, image_url, local_path
       FROM scenes
       WHERE drama_id = ? AND (episode_id IS NULL OR episode_id = ?) AND deleted_at IS NULL`
    )
    .all(dramaId, episodeId);
}

function listEpisodeProps(db, dramaId, episodeId) {
  try {
    const rows = db
      .prepare(
        `SELECT id, name, description, image_url, local_path
         FROM props
         WHERE drama_id = ? AND episode_id = ? AND deleted_at IS NULL`
      )
      .all(dramaId, episodeId);
    if (rows.length) return rows;
  } catch {
    /* older schema without episode_id */
  }
  return db
    .prepare(
      `SELECT id, name, description, image_url, local_path
       FROM props WHERE drama_id = ? AND deleted_at IS NULL`
    )
    .all(dramaId);
}

function hasSheet(row) {
  return Boolean(
    (row?.image_url && String(row.image_url).trim()) ||
      (row?.local_path && String(row.local_path).trim())
  );
}

/**
 * Full asset-review payload for GET /wardrobe (characters + scenes + props).
 */
function getAssetReview(db, dramaId, episodeId) {
  const dramaService = require('../dramaService');
  const drama = dramaService.getDramaById(db, Number(dramaId));
  if (!drama) throw new Error('drama not found');
  const ep = db
    .prepare(
      `SELECT id, drama_id, episode_number, script_content FROM episodes
       WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
    )
    .get(Number(episodeId), Number(dramaId));
  if (!ep) throw new Error('episode not found');

  const meta = scriptReview.getWorkflowMeta(drama.metadata);
  const characters = listDramaCharacters(db, drama.id, ep.id).map((c) => ({
    id: c.id,
    name: c.name,
    look_ids: characterLooks.listLookIds(c),
    looks: characterLooks.parseLooks(c.looks),
    base_has_image: characterLooks.hasLookImage(c, 'base'),
    missing_looks: characterLooks
      .listLookIds(c)
      .filter((lid) => !characterLooks.hasLookImage(c, lid)),
  }));
  const scenes = listEpisodeScenes(db, drama.id, ep.id).map((s) => ({
    id: s.id,
    name: s.location || `场景#${s.id}`,
    description: s.prompt || '',
    has_image: hasSheet(s),
  }));
  const props = listEpisodeProps(db, drama.id, ep.id).map((p) => ({
    id: p.id,
    name: p.name || `道具#${p.id}`,
    description: p.description || '',
    has_image: hasSheet(p),
  }));

  return {
    episode: ep.episode_number,
    episode_id: ep.id,
    source_revision: episodeSourceRevision(ep.script_content),
    marker: getWardrobeMarker(meta, ep.episode_number),
    characters,
    scenes,
    props,
    summary: {
      characters: characters.length,
      scenes: scenes.length,
      props: props.length,
      missing_character_looks: characters.reduce((n, c) => n + (c.missing_looks?.length || 0), 0),
      missing_scene_sheets: scenes.filter((s) => !s.has_image).length,
      missing_prop_sheets: props.filter((p) => !p.has_image).length,
    },
    syntax: {
      look: '@[角色@造型]',
      dialogue: '@[角色]{台词}',
      monologue: '@[角色%内心独白]{台词}',
      vo: '{旁白}',
    },
  };
}

/**
 * If reference_video and asset review / look sheets incomplete, return next_action; else null.
 */
function referenceVideoPreStep1Action(db, drama, episodeRow) {
  const meta = scriptReview.getWorkflowMeta(drama.metadata);
  const modes = require('./workflowRules').resolveProjectModes(meta);
  if (modes.generation_mode !== 'reference_video') return null;

  const epNum = Number(episodeRow.episode_number);
  const revision = episodeSourceRevision(episodeRow.script_content);
  const marker = getWardrobeMarker(meta, epNum);
  if (!marker || marker.source_revision !== revision) {
    return makeAction(
      'propose_character_looks',
      'reference_video requires asset review (characters / scenes / props) before step1',
      {
        args: {
          episode: epNum,
          episode_id: episodeRow.id,
          expected_episode_source_revision: revision,
        },
        requires_confirmation: true,
      }
    );
  }

  const chars = listDramaCharacters(db, drama.id, episodeRow.id);
  const missing = characterLooks.missingLookSheetIds(chars);
  if (missing.length) {
    return makeAction('generate_asset_sheets', 'wardrobe looks need sheets before step1', {
      ids: missing.map((id) => `look:${id}`),
      args: { episode: epNum, episode_id: episodeRow.id, phase: 'wardrobe_sheets' },
    });
  }
  return null;
}

/**
 * Scan episode script for @[角色@造型] mentions and register missing looks.
 * Does not invent looks from prose — only explicit mention syntax.
 */
function scanLooksFromScript(db, dramaId, episodeId) {
  const { parseReferenceMentions, deriveVisualReferences } = require('./referenceMentions');
  const dramaService = require('../dramaService');
  const drama = dramaService.getDramaById(db, Number(dramaId));
  if (!drama) throw new Error('drama not found');
  const ep = db
    .prepare(
      `SELECT id, drama_id, episode_number, script_content FROM episodes
       WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
    )
    .get(Number(episodeId), Number(dramaId));
  if (!ep) throw new Error('episode not found');

  const { hits, errors } = parseReferenceMentions(ep.script_content || '');
  const refs = deriveVisualReferences(hits);
  const chars = listDramaCharacters(db, drama.id, ep.id);
  const byName = new Map(chars.map((c) => [String(c.name || '').trim(), c]));

  const upserted = [];
  const skipped = [];
  for (const ref of refs) {
    const lookId = String(ref.look || '').trim();
    if (!lookId || lookId === characterLooks.BASE_LOOK_ID) continue;
    const char = byName.get(String(ref.name || '').trim());
    if (!char) {
      skipped.push({ character_name: ref.name, look_id: lookId, reason: 'character_not_found' });
      continue;
    }
    if (characterLooks.isLookRegistered(char, lookId)) {
      skipped.push({ character_name: char.name, look_id: lookId, reason: 'already_registered' });
      continue;
    }
    characterLooks.upsertLook(db, char.id, lookId, {
      description: `剧本提及 @[${char.name}@${lookId}]`,
    });
    // refresh local cache for subsequent isLookRegistered
    char.looks = characterLooks.looksToJson({
      ...characterLooks.parseLooks(char.looks),
      [lookId]: { description: `剧本提及 @[${char.name}@${lookId}]` },
    });
    upserted.push({ character_id: char.id, character_name: char.name, look_id: lookId });
  }

  const review = getAssetReview(db, drama.id, ep.id);
  return {
    episode: ep.episode_number,
    episode_id: ep.id,
    source_revision: episodeSourceRevision(ep.script_content),
    upserted,
    skipped,
    parse_errors: errors,
    review,
  };
}

/**
 * Stamp asset review complete after looks / scenes / props registered.
 * body.looks?: [{ character_id|character_name, look_id, description }]
 * body.scenes?: [{ name, description|prompt }]
 * body.props?: [{ name, description }]
 * body.scan_looks?: true — scan @[角色@造型] mentions before stamp
 * body.propose?: true — ignored here (use propose API); kept for agents
 */
function completeEpisodeWardrobe(db, dramaId, episodeId, body = {}) {
  const dramaService = require('../dramaService');
  const sceneService = require('../sceneService');
  const propService = require('../propService');
  const drama = dramaService.getDramaById(db, Number(dramaId));
  if (!drama) throw new Error('drama not found');
  const ep = db
    .prepare(
      `SELECT id, drama_id, episode_number, script_content FROM episodes
       WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
    )
    .get(Number(episodeId), Number(dramaId));
  if (!ep) throw new Error('episode not found');

  const expected = body.expected_episode_source_revision || episodeSourceRevision(ep.script_content);
  const live = episodeSourceRevision(ep.script_content);
  if (expected !== live) {
    const err = new Error('episode source revision mismatch; re-run asset review');
    err.code = 'conflict';
    throw err;
  }

  let scanResult = null;
  if (body.scan_looks === true) {
    scanResult = scanLooksFromScript(db, dramaId, episodeId);
  }

  const addedLooks = [];
  const proposals = Array.isArray(body.looks) ? body.looks : [];
  // Also accept ArcReel map: { "阿杰": { "童年": "desc" } }
  if (!proposals.length && body.looks && typeof body.looks === 'object' && !Array.isArray(body.looks)) {
    const { normalizeLooks } = require('./proposeEpisodeAssets');
    proposals.push(...normalizeLooks(body.looks));
  }
  for (const p of proposals) {
    const lookId = String(p.look_id || p.id || '').trim();
    if (!lookId || lookId === characterLooks.BASE_LOOK_ID) continue;
    let charId = p.character_id ? Number(p.character_id) : null;
    if (!charId && p.character_name) {
      const row = db
        .prepare(
          `SELECT id FROM characters WHERE drama_id = ? AND name = ? AND deleted_at IS NULL`
        )
        .get(Number(dramaId), String(p.character_name).trim());
      charId = row?.id || null;
    }
    if (!charId) continue;
    const before = db
      .prepare(`SELECT looks FROM characters WHERE id = ? AND deleted_at IS NULL`)
      .get(charId);
    const already = characterLooks.isLookRegistered(before, lookId);
    characterLooks.upsertLook(db, charId, lookId, {
      description: p.description || '',
      image_url: p.image_url,
      local_path: p.local_path,
    });
    if (!already) addedLooks.push(`${p.character_name || charId}@${lookId}`);
  }

  const addedScenes = [];
  let sceneItems = Array.isArray(body.scenes) ? body.scenes : [];
  if (!sceneItems.length && body.scenes && typeof body.scenes === 'object') {
    const { normalizeNamed } = require('./proposeEpisodeAssets');
    sceneItems = normalizeNamed(body.scenes, 'scene');
  }
  const existingScenes = listEpisodeScenes(db, drama.id, ep.id);
  const sceneNames = new Set(existingScenes.map((s) => String(s.location || '').trim()).filter(Boolean));
  for (const s of sceneItems) {
    const name = String(s.name || s.location || '').trim();
    if (!name || sceneNames.has(name)) continue;
    const desc = String(s.description || s.prompt || '').trim();
    sceneService.createSceneForEpisode(db, { info() {}, warn() {} }, drama.id, ep.id, {
      location: name,
      prompt: desc,
      time: s.time || '',
    });
    sceneNames.add(name);
    addedScenes.push(name);
  }

  const addedProps = [];
  let propItems = Array.isArray(body.props) ? body.props : [];
  if (!propItems.length && body.props && typeof body.props === 'object') {
    const { normalizeNamed } = require('./proposeEpisodeAssets');
    propItems = normalizeNamed(body.props, 'prop');
  }
  const existingProps = listEpisodeProps(db, drama.id, ep.id);
  const propNames = new Set(existingProps.map((p) => String(p.name || '').trim()).filter(Boolean));
  const now = new Date().toISOString();
  for (const p of propItems) {
    const name = String(p.name || '').trim();
    if (!name || propNames.has(name)) continue;
    const desc = String(p.description || '').trim();
    propService.create(db, { info() {}, warn() {} }, {
      drama_id: drama.id,
      episode_id: ep.id,
      name,
      description: desc,
      prompt: desc,
    });
    propNames.add(name);
    addedProps.push(name);
  }

  const review = getAssetReview(db, drama.id, ep.id);
  const meta = scriptReview.getWorkflowMeta(drama.metadata);
  if (!meta.workflow.episode_wardrobe || typeof meta.workflow.episode_wardrobe !== 'object') {
    meta.workflow.episode_wardrobe = {};
  }
  meta.workflow.episode_wardrobe[String(ep.episode_number)] = {
    source_revision: live,
    completed_at: new Date().toISOString(),
    summary: review.summary,
  };
  scriptReview.saveDramaMeta(db, drama.id, meta);

  return {
    episode: ep.episode_number,
    episode_id: ep.id,
    source_revision: live,
    added: addedLooks,
    added_scenes: addedScenes,
    added_props: addedProps,
    looks_upserted: addedLooks.length + (scanResult?.upserted?.length || 0),
    scan: scanResult
      ? { upserted: scanResult.upserted, skipped: scanResult.skipped }
      : null,
    summary: review.summary,
    characters: review.characters,
    scenes: review.scenes,
    props: review.props,
    marker: meta.workflow.episode_wardrobe[String(ep.episode_number)],
  };
}

module.exports = {
  episodeSourceRevision,
  getWardrobeMarker,
  getAssetReview,
  scanLooksFromScript,
  referenceVideoPreStep1Action,
  completeEpisodeWardrobe,
  listDramaCharacters,
  listEpisodeScenes,
  listEpisodeProps,
};
