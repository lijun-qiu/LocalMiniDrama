'use strict';

/**
 * Authoritative workflow status from SQLite + step1 files + video_units.
 * Three axes stay separate — this module only emits WorkflowStatus.
 */

const crypto = require('crypto');
const { resolveProjectModes, workflowRule, isValidModePair } = require('./workflowRules');
const {
  makeAction,
  emptyCollection,
  notApplicableCollection,
  mediaCollection,
} = require('./workflowActions');
const { WorkflowRequestError } = require('./workflowErrors');
const scriptReview = require('./scriptReviewService');
const artifactCurrency = require('./artifactCurrency');
const { digestRaw } = require('./canonicalDigest');

function parseMeta(drama) {
  if (!drama) return {};
  if (drama.metadata && typeof drama.metadata === 'object') return { ...drama.metadata };
  if (typeof drama.metadata === 'string') {
    try {
      return JSON.parse(drama.metadata) || {};
    } catch {
      return {};
    }
  }
  return {};
}

function projectRevision(drama, meta) {
  const raw = `${drama?.updated_at || ''}|${JSON.stringify({
    content_mode: meta.content_mode,
    generation_mode: meta.generation_mode,
    title: drama?.title,
  })}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function hasAssetImage(row) {
  return Boolean((row?.image_url && String(row.image_url).trim()) || (row?.local_path && String(row.local_path).trim()));
}

function playableVideo(row) {
  if (!row || row.status !== 'completed') return false;
  const url = row.local_path || row.video_url;
  return Boolean(url && String(url).trim());
}

function listEpisodes(db, dramaId) {
  return db
    .prepare(
      `SELECT id, episode_number, title, script_content, status, video_url, updated_at
       FROM episodes WHERE drama_id = ? AND deleted_at IS NULL
       ORDER BY episode_number ASC, id ASC`
    )
    .all(dramaId);
}

function listStoryboards(db, episodeId) {
  return db
    .prepare(
      `SELECT id, storyboard_number, creation_mode, image_url, local_path, composed_image,
              video_url, audio_local_path, narration_audio_local_path, universal_segment_text, video_prompt
       FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL
       ORDER BY storyboard_number ASC, id ASC`
    )
    .all(episodeId);
}

function listCharacters(db, dramaId, episodeId) {
  const viaEp = db
    .prepare(
      `SELECT c.id, c.image_url, c.local_path FROM characters c
       INNER JOIN episode_characters ec ON ec.character_id = c.id
       WHERE ec.episode_id = ? AND c.drama_id = ? AND c.deleted_at IS NULL`
    )
    .all(episodeId, dramaId);
  if (viaEp.length) return viaEp;
  return db
    .prepare(
      `SELECT id, image_url, local_path FROM characters
       WHERE drama_id = ? AND deleted_at IS NULL`
    )
    .all(dramaId);
}

function listScenes(db, dramaId, episodeId) {
  const rows = db
    .prepare(
      `SELECT id, image_url, local_path FROM scenes
       WHERE drama_id = ? AND episode_id = ? AND deleted_at IS NULL`
    )
    .all(dramaId, episodeId);
  if (rows.length) return rows;
  return db
    .prepare(
      `SELECT id, image_url, local_path FROM scenes
       WHERE drama_id = ? AND (episode_id IS NULL OR episode_id = ?) AND deleted_at IS NULL`
    )
    .all(dramaId, episodeId);
}

function listProps(db, dramaId, episodeId) {
  try {
    const rows = db
      .prepare(
        `SELECT id, image_url, local_path FROM props
         WHERE drama_id = ? AND episode_id = ? AND deleted_at IS NULL`
      )
      .all(dramaId, episodeId);
    if (rows.length) return rows;
  } catch {
    /* older schema */
  }
  return db
    .prepare(`SELECT id, image_url, local_path FROM props WHERE drama_id = ? AND deleted_at IS NULL`)
    .all(dramaId);
}

function latestVideosByStoryboard(db, storyboardIds) {
  const map = new Map();
  if (!storyboardIds.length) return map;
  const placeholders = storyboardIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, storyboard_id, status, local_path, video_url, created_at
       FROM video_generations
       WHERE storyboard_id IN (${placeholders}) AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC`
    )
    .all(...storyboardIds);
  for (const row of rows) {
    if (!map.has(row.storyboard_id)) map.set(row.storyboard_id, row);
  }
  return map;
}

function hasStoryboardImage(sb, meta) {
  if (sb.composed_image || sb.image_url || sb.local_path) return true;
  if (meta.storyboard_universal_omni && sb.creation_mode === 'universal') return true;
  return false;
}

function readFinalVideoUnits(meta, episodeNumber) {
  const ep = meta.workflow?.episodes?.[String(episodeNumber)];
  const units = ep?.video_units || meta.workflow?.video_units?.[String(episodeNumber)];
  return Array.isArray(units) ? units : [];
}

function assetSheetsWithCurrency(db, drama, chars, scenes, props, scriptDigest) {
  let projectDir;
  try {
    projectDir = scriptReview.projectAbsDir(db, drama);
  } catch {
    projectDir = null;
  }
  const all = [
    ...chars.map((r) => ({ type: 'character', id: r.id, row: r })),
    ...scenes.map((r) => ({ type: 'scene', id: r.id, row: r })),
    ...props.map((r) => ({ type: 'prop', id: r.id, row: r })),
  ];
  const current_ids = [];
  const missing_ids = [];
  const stale_ids = [];
  for (const a of all) {
    const aid = `${a.type}:${a.id}`;
    if (!hasAssetImage(a.row)) {
      missing_ids.push(aid);
      continue;
    }
    const rel = `db:${a.type}/${a.id}/image`;
    let state = 'current';
    if (projectDir) {
      state = artifactCurrency.compare(
        projectDir,
        artifactCurrency.ArtifactKey.assetSheet(a.type, a.id),
        rel,
        {
          kind: 'asset-sheet',
          kind_version: 1,
          inputs: { script_digest: scriptDigest, asset_id: aid, path: a.row.local_path || a.row.image_url },
        }
      );
      // No claim yet: treat as current for availability (usable), do NOT auto-register
      // on read — registration must happen at write time so script edits can stale later.
      if (state === 'missing') state = 'current';
    }
    if (state === 'stale') stale_ids.push(aid);
    else current_ids.push(aid);
  }
  return {
    state: missing_ids.length
      ? current_ids.length || stale_ids.length
        ? 'partial'
        : 'missing'
      : stale_ids.length
        ? 'partial'
        : 'current',
    current_ids,
    missing_ids,
    stale_ids,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} drama
 * @param {{ episode?: number|null }} [query]
 */
function getWorkflowStatus(db, drama, query = {}) {
  if (!drama) throw new WorkflowRequestError('drama not found');
  const dramaId = Number(drama.id);
  const metaRaw = parseMeta(drama);
  const modes = resolveProjectModes(metaRaw);
  const meta = { ...metaRaw, ...modes };
  const blockers = [];

  if (!isValidModePair(modes.content_mode, modes.generation_mode)) {
    blockers.push({
      code: 'invalid_project_mode',
      path: 'metadata.content_mode',
      reason: `unsupported mode pair ${modes.content_mode}/${modes.generation_mode}`,
    });
  }

  const episodes = listEpisodes(db, dramaId);
  const episodeNum =
    query.episode != null && query.episode !== ''
      ? Number(query.episode)
      : episodes.length
        ? Number(episodes[0].episode_number)
        : null;

  if (query.episode != null && query.episode !== '' && (!Number.isFinite(episodeNum) || episodeNum < 1)) {
    throw new WorkflowRequestError('episode must be a positive integer');
  }

  const selected = episodeNum != null ? episodes.find((e) => Number(e.episode_number) === episodeNum) : null;

  const artifacts = {
    asset_inventory: emptyCollection(),
    asset_sheets: emptyCollection(),
    step1: { state: 'missing' },
    script: { state: 'missing' },
    storyboards: emptyCollection(),
    videos: emptyCollection(),
    audio: notApplicableCollection(),
  };
  const gates = {
    step1_review: { state: 'pending', revision: null },
  };

  const project = {
    content_mode: modes.content_mode,
    generation_mode: modes.generation_mode,
    grid_storyboard: modes.grid_storyboard === true,
  };

  const baseResponse = (state, next_action, target = null) => ({
    schema_version: 1,
    project_revision: projectRevision(drama, modes),
    source_revision: null,
    project,
    target,
    state,
    blockers,
    gates,
    artifacts,
    next_action,
  });

  if (blockers.length) {
    return baseResponse('PROJECT_INPUT', makeAction('none', 'workflow is blocked'));
  }

  if (!drama.title || !String(drama.title).trim()) {
    return baseResponse('PROJECT_INPUT', makeAction('collect_project_input', 'project title is required'));
  }

  if (!episodes.length || selected == null) {
    return baseResponse(
      'EPISODE_PLAN',
      makeAction('plan_episodes', 'episode ledger has no target episode', {
        args: { episode: episodeNum || 1 },
      })
    );
  }

  const scriptText = String(selected.script_content || '').trim();
  const scriptDigest = digestRaw(scriptText);
  const target = {
    episode: Number(selected.episode_number),
    script: `episodes/${selected.id}/script`,
    script_filename: `episode_${selected.episode_number}.txt`,
    source: `episodes/${selected.id}/script`,
  };

  if (!scriptText) {
    return baseResponse(
      'PROJECT_INPUT',
      makeAction('collect_project_input', 'episode script / source text is required', {
        args: { episode: target.episode },
      }),
      target
    );
  }

  const chars = listCharacters(db, dramaId, selected.id);
  const scenes = listScenes(db, dramaId, selected.id);
  const props = listProps(db, dramaId, selected.id);
  const assetCount = chars.length + scenes.length + props.length;

  if (assetCount === 0) {
    artifacts.asset_inventory = { state: 'missing' };
    return baseResponse(
      'ASSET_INVENTORY',
      makeAction('analyze_assets', 'asset inventory is missing or out of date', {
        args: { episode: target.episode, scope: { kind: 'all', files: [] } },
      }),
      target
    );
  }
  artifacts.asset_inventory = {
    state: 'current',
    current_ids: [
      ...chars.map((c) => `character:${c.id}`),
      ...scenes.map((s) => `scene:${s.id}`),
      ...props.map((p) => `prop:${p.id}`),
    ],
    stale_ids: [],
    missing_ids: [],
  };

  // reference_video: wardrobe gate runs AFTER assets, BEFORE step1 (always visible when due)
  if (modes.generation_mode === 'reference_video') {
    const wardrobe = require('./episodeWardrobe');
    const pre = wardrobe.referenceVideoPreStep1Action(db, drama, selected);
    if (pre) {
      const state = pre.type === 'generate_asset_sheets' ? 'ASSET_SHEETS' : 'STEP1_CONTENT';
      return baseResponse(state, pre, target);
    }
  }

  // --- step1 gate (Phase 2) ---
  const review = scriptReview.reviewStatus(db, drama, target.episode);
  artifacts.step1 = {
    state:
      review.status === 'no_step1'
        ? 'missing'
        : review.quarantined
          ? 'blocked'
          : 'current',
    revision: review.fingerprint,
    path: review.content
      ? scriptReview.step1RelPath(target.episode, review.kind)
      : null,
  };
  gates.step1_review = {
    state: review.status === 'confirmed' ? 'confirmed' : 'pending',
    revision: review.fingerprint,
  };

  if (review.quarantined) {
    blockers.push({
      code: 'step1_quarantined',
      path: artifacts.step1.path || 'drafts',
      reason: 'step1 has a quarantined draft that must be repaired and promoted',
    });
    return baseResponse(
      'STEP1_REVIEW',
      makeAction('none', 'quarantined step1 must be repaired before confirmation'),
      target
    );
  }
  if (review.status === 'no_step1') {
    const rule = workflowRule(modes.content_mode, modes.generation_mode);
    return baseResponse(
      'STEP1_CONTENT',
      makeAction('prepare_step1', 'target episode has no formal step1', {
        args: { episode: target.episode, preprocessor: rule.preprocessor },
      }),
      target
    );
  }
  if (review.status !== 'confirmed') {
    return baseResponse(
      'STEP1_REVIEW',
      makeAction('confirm_step1', 'formal step1 awaits content review', {
        args: { episode: target.episode },
        requires_confirmation: true,
      }),
      target
    );
  }

  // Currency: step1 vs source script
  try {
    const projectDir = scriptReview.projectAbsDir(db, drama);
    const rel = scriptReview.step1RelPath(target.episode, review.kind);
    const step1Currency = artifactCurrency.compare(
      projectDir,
      artifactCurrency.ArtifactKey.episodeStep1(target.episode),
      rel,
      {
        kind: 'structured-content/step1',
        kind_version: 2,
        inputs: {
          content_mode: modes.content_mode,
          generation_mode: modes.generation_mode,
          source_content: scriptDigest,
        },
      }
    );
    if (step1Currency === 'stale') {
      artifacts.step1.state = 'stale';
      // stale is usable — do not block; next_action stays on downstream unless missing
    }
  } catch {
    /* storage may be unavailable */
  }

  // --- final script / video_units ---
  if (modes.generation_mode === 'reference_video') {
    artifacts.storyboards = notApplicableCollection();
    const unitList = readFinalVideoUnits(meta, target.episode);
    const epWf = meta.workflow?.episodes?.[String(target.episode)] || {};
    const scriptFromStep1 = epWf.script_step1_revision || null;
    if (unitList.length && scriptFromStep1 && review.fingerprint && scriptFromStep1 !== review.fingerprint) {
      artifacts.script = {
        state: 'stale',
        path: `metadata.workflow.episodes.${target.episode}.video_units`,
        unit_count: unitList.length,
        expected_step1_revision: review.fingerprint,
        script_step1_revision: scriptFromStep1,
      };
      return baseResponse(
        'FINAL_SCRIPT',
        makeAction('generate_script', 'video_units are stale relative to confirmed step1; regenerate final units', {
          args: {
            episode: target.episode,
            skeleton_kind: 'video_units',
            episode_id: selected.id,
          },
        }),
        target
      );
    }
    if (!unitList.length) {
      artifacts.script = { state: 'missing' };
      return baseResponse(
        'FINAL_SCRIPT',
        makeAction('generate_script', 'promote confirmed step1 units into final video_units', {
          args: {
            episode: target.episode,
            skeleton_kind: 'video_units',
            episode_id: selected.id,
          },
        }),
        target
      );
    }
    artifacts.script = {
      state: 'current',
      path: `metadata.workflow.episodes.${target.episode}.video_units`,
      unit_count: unitList.length,
    };

    const sheets = assetSheetsWithCurrency(db, drama, chars, scenes, props, scriptDigest);
    artifacts.asset_sheets = sheets;
    if (sheets.missing_ids.length) {
      return baseResponse(
        'ASSET_SHEETS',
        makeAction('generate_asset_sheets', 'asset definitions need sheets', {
          ids: sheets.missing_ids,
          args: { episode: target.episode },
        }),
        target
      );
    }

    // Map units → storyboard rows linked by unit_id in universal_segment_text prefix or workflow binding
    const bindings = meta.workflow?.episodes?.[String(target.episode)]?.unit_storyboard_map || {};
    const currentVids = [];
    const missingVids = [];
    const sbIds = [];
    for (const u of unitList) {
      const uid = String(u.unit_id || u.id);
      const sbId = bindings[uid];
      if (sbId) sbIds.push(Number(sbId));
    }
    const videoMap = latestVideosByStoryboard(db, sbIds);
    for (const u of unitList) {
      const uid = String(u.unit_id || u.id);
      const sbId = bindings[uid];
      const vid = sbId ? videoMap.get(Number(sbId)) : null;
      const clipOk =
        playableVideo(vid) ||
        (u.generated_assets && (u.generated_assets.video_clip || u.generated_assets.video_uri));
      if (clipOk) currentVids.push(uid);
      else missingVids.push(uid);
    }
    artifacts.videos = mediaCollection(currentVids, missingVids);
    artifacts.audio = notApplicableCollection();

    if (missingVids.length) {
      return baseResponse(
        'VIDEO',
        makeAction('generate_videos', 'video clips are missing', {
          args: { episode: target.episode, episode_id: selected.id, skeleton_kind: 'video_units' },
          ids: missingVids,
        }),
        target
      );
    }
    return baseResponse(
      'EXPORT_READY',
      makeAction('export', 'all required artifacts are usable', {
        args: { episode: target.episode, episode_id: selected.id },
      }),
      target
    );
  }

  // --- storyboard route ---
  const storyboards = listStoryboards(db, selected.id);
  if (!storyboards.length) {
    artifacts.script = { state: 'missing' };
    return baseResponse(
      'FINAL_SCRIPT',
      makeAction('generate_script', 'target episode has no current final script / storyboard rows', {
        args: { episode: target.episode, episode_id: selected.id },
      }),
      target
    );
  }
  artifacts.script = {
    state: 'current',
    path: target.script,
    unit_count: storyboards.length,
  };

  const sheets = assetSheetsWithCurrency(db, drama, chars, scenes, props, scriptDigest);
  artifacts.asset_sheets = sheets;
  if (sheets.missing_ids.length) {
    return baseResponse(
      'ASSET_SHEETS',
      makeAction('generate_asset_sheets', 'asset definitions need sheets', {
        ids: sheets.missing_ids,
        args: { episode: target.episode },
      }),
      target
    );
  }

  const currentSb = [];
  const missingSb = [];
  const staleSb = [];
  let projectDir = null;
  try {
    projectDir = scriptReview.projectAbsDir(db, drama);
  } catch {
    projectDir = null;
  }
  for (const sb of storyboards) {
    const id = String(sb.id);
    if (!hasStoryboardImage(sb, meta)) {
      missingSb.push(id);
      continue;
    }
    if (projectDir && (sb.local_path || sb.image_url)) {
      const rel = sb.local_path ? String(sb.local_path).replace(/\\/g, '/') : `db:storyboard/${sb.id}/image`;
      const cur = artifactCurrency.compare(
        projectDir,
        artifactCurrency.ArtifactKey.storyboardImage(target.episode, sb.id),
        rel.startsWith('projects/') || rel.startsWith('db:') ? rel : rel,
        {
          kind: 'storyboard-image',
          kind_version: 1,
          inputs: { script_digest: scriptDigest, storyboard_id: sb.id },
        }
      );
      if (cur === 'missing') {
        // Existence counts as available; do not register on read.
        currentSb.push(id);
      } else if (cur === 'stale') staleSb.push(id);
      else currentSb.push(id);
    } else {
      currentSb.push(id);
    }
  }
  artifacts.storyboards = mediaCollection(currentSb, missingSb, staleSb);
  if (missingSb.length) {
    const grid = modes.grid_storyboard === true;
    return baseResponse(
      'STORYBOARD',
      makeAction(grid ? 'generate_grid' : 'generate_storyboards', 'storyboard images are missing', {
        args: { episode: target.episode, episode_id: selected.id },
        ids: missingSb,
      }),
      target
    );
  }

  const sbIds = storyboards.map((u) => Number(u.id)).filter(Number.isFinite);
  const videoMap = latestVideosByStoryboard(db, sbIds);
  const currentVids = [];
  const missingVids = [];
  for (const sb of storyboards) {
    const id = String(sb.id);
    const vid = videoMap.get(Number(sb.id));
    if (playableVideo(vid) || (sb.video_url && String(sb.video_url).trim())) currentVids.push(id);
    else missingVids.push(id);
  }
  artifacts.videos = mediaCollection(currentVids, missingVids);

  if (modes.content_mode === 'narration' && modes.generation_mode === 'storyboard') {
    const currentAudio = [];
    const missingAudio = [];
    for (const sb of storyboards) {
      const id = String(sb.id);
      if (sb.narration_audio_local_path || sb.audio_local_path) currentAudio.push(id);
      else missingAudio.push(id);
    }
    artifacts.audio = mediaCollection(currentAudio, missingAudio);
  } else {
    artifacts.audio = notApplicableCollection();
  }

  if (missingVids.length) {
    return baseResponse(
      'VIDEO',
      makeAction('generate_videos', 'video clips are missing', {
        args: { episode: target.episode, episode_id: selected.id },
        ids: missingVids,
      }),
      target
    );
  }

  return baseResponse(
    'EXPORT_READY',
    makeAction('export', 'all required artifacts are usable', {
      args: { episode: target.episode, episode_id: selected.id },
    }),
    target
  );
}

module.exports = {
  WorkflowRequestError,
  getWorkflowStatus,
  parseMeta,
  resolveProjectModes: require('./workflowRules').resolveProjectModes,
};
