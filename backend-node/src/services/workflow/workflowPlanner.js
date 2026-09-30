'use strict';

/**
 * Async-friendly planner: status + active tasks (+ optional admission) → WorkflowPlan.
 */

const { WorkflowRequestError } = require('./workflowErrors');
const { getWorkflowStatus } = require('./workflowStateService');
const { buildWorkflowPlan } = require('./workflowPlan');
const { NARRATION_DELIVERIES } = require('./workflowActions');
const { resolveProjectModes } = require('./workflowRules');

const TASK_TYPE_MAP = Object.freeze({
  storyboard_image: 'storyboard',
  storyboard_images: 'storyboard',
  batch_image: 'storyboard',
  image: 'storyboard',
  grid: 'grid',
  video: 'video',
  batch_video: 'video',
  reference_video: 'reference_video',
  tts: 'tts',
  audio: 'tts',
  narration_audio: 'tts',
});

function resourceBelongsToDrama(rid, dramaId, episodeId) {
  const id = String(dramaId);
  const ep = episodeId != null ? String(episodeId) : null;
  if (!rid) return false;
  if (rid === id || rid === `drama:${id}`) return true;
  if (ep && (rid === ep || rid === `episode:${ep}`)) return true;
  // Exact prefix with separator to avoid drama 1 matching "10" / "12"
  if (rid.startsWith(`${id}:`) || rid.startsWith(`${id}/`) || rid.startsWith(`${id}_`)) return true;
  if (ep && (rid.startsWith(`${ep}:`) || rid.startsWith(`episode:${ep}`))) return true;
  return false;
}

/**
 * Map LMD async_tasks / generation rows onto WorkflowTaskObservation[].
 * @param {import('better-sqlite3').Database} db
 * @param {number} dramaId
 * @param {number|null} episodeId
 */
function collectTaskObservations(db, dramaId, episodeId) {
  const observations = [];

  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT id, type, status, resource_id FROM async_tasks
         WHERE deleted_at IS NULL AND status IN ('pending', 'processing', 'running', 'queued')
         ORDER BY created_at DESC LIMIT 50`
      )
      .all();
  } catch {
    return observations;
  }

  for (const row of rows) {
    const rid = String(row.resource_id || '');
    if (!resourceBelongsToDrama(rid, dramaId, episodeId)) continue;
    const mapped = TASK_TYPE_MAP[row.type] || null;
    if (!mapped) continue;
    const status =
      row.status === 'processing' || row.status === 'pending'
        ? row.status === 'pending'
          ? 'queued'
          : 'running'
        : row.status;
    observations.push({
      unit_id: rid || String(dramaId),
      task_id: String(row.id),
      task_type: mapped,
      status,
      provider_checkpoint: null,
      problem: null,
    });
  }

  // In-flight video generations for this episode's storyboards
  if (episodeId) {
    try {
      const vids = db
        .prepare(
          `SELECT vg.id, vg.storyboard_id, vg.status, vg.provider_task_id
           FROM video_generations vg
           INNER JOIN storyboards sb ON sb.id = vg.storyboard_id
           WHERE sb.episode_id = ? AND vg.deleted_at IS NULL
             AND vg.status IN ('pending', 'processing', 'queued', 'running')
           ORDER BY vg.created_at DESC LIMIT 40`
        )
        .all(episodeId);
      for (const v of vids) {
        observations.push({
          unit_id: String(v.storyboard_id),
          task_id: String(v.id),
          task_type: 'video',
          status: v.status === 'pending' ? 'queued' : 'running',
          provider_checkpoint: v.provider_task_id
            ? { submitted: true, provider_job_id: String(v.provider_task_id) }
            : { submitted: false },
          problem: null,
        });
      }
    } catch {
      /* ignore */
    }

    try {
      const imgs = db
        .prepare(
          `SELECT ig.id, ig.storyboard_id, ig.status, ig.task_id
           FROM image_generations ig
           INNER JOIN storyboards sb ON sb.id = ig.storyboard_id
           WHERE sb.episode_id = ? AND ig.deleted_at IS NULL
             AND ig.status IN ('pending', 'processing', 'queued', 'running')
           ORDER BY ig.created_at DESC LIMIT 40`
        )
        .all(episodeId);
      for (const im of imgs) {
        observations.push({
          unit_id: String(im.storyboard_id),
          task_id: String(im.id),
          task_type: 'storyboard',
          status: im.status === 'pending' ? 'queued' : 'running',
          provider_checkpoint: null,
          problem: null,
        });
      }
    } catch {
      /* ignore */
    }
  }

  return observations;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} drama
 * @param {{
 *   episode?: number|null,
 *   narration_delivery?: string|null,
 *   confirmed_request_durations?: Record<string, number>,
 * }} [request]
 */
function getWorkflowPlan(db, drama, request = {}) {
  const narrationDelivery = request.narration_delivery ?? null;
  if (
    narrationDelivery != null &&
    !NARRATION_DELIVERIES.includes(narrationDelivery)
  ) {
    throw new WorkflowRequestError(
      `narration_delivery must be one of ${NARRATION_DELIVERIES.join(', ')}`
    );
  }

  const status = getWorkflowStatus(db, drama, { episode: request.episode });
  const episodeId = status.target
    ? (() => {
        const row = db
          .prepare(
            `SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? AND deleted_at IS NULL`
          )
          .get(Number(drama.id), status.target.episode);
        return row ? Number(row.id) : null;
      })()
    : null;

  const taskObservations = collectTaskObservations(db, Number(drama.id), episodeId);

  // Phase 1: no video batch admission yet
  const admission = null;

  return buildWorkflowPlan(status, {
    narration_delivery: narrationDelivery,
    task_observations: taskObservations,
    admission,
  });
}

/**
 * Persist content_mode / generation_mode onto drama metadata (merge).
 */
function saveWorkflowModes(db, dramaId, { content_mode, generation_mode, grid_storyboard }) {
  const dramaService = require('../dramaService');
  const drama = dramaService.getDramaById(db, Number(dramaId));
  if (!drama) return null;
  const meta =
    drama.metadata && typeof drama.metadata === 'object'
      ? { ...drama.metadata }
      : {};
  if (content_mode != null) meta.content_mode = content_mode;
  if (generation_mode != null) meta.generation_mode = generation_mode;
  if (grid_storyboard != null) meta.grid_storyboard = Boolean(grid_storyboard);
  const resolved = resolveProjectModes(meta);
  if (!require('./workflowRules').isValidModePair(resolved.content_mode, resolved.generation_mode)) {
    throw new WorkflowRequestError(
      `unsupported workflow mode pair: ${resolved.content_mode}, ${resolved.generation_mode}`
    );
  }
  meta.content_mode = resolved.content_mode;
  meta.generation_mode = resolved.generation_mode;
  if (!meta.workflow || typeof meta.workflow !== 'object') meta.workflow = {};
  // Do not force-enable step1 on old projects that already opted out (explicit false).
  // New projects get step1_enforced=true at create; prepare_step1 also enables it.
  if (meta.workflow.step1_enforced == null) meta.workflow.step1_enforced = true;
  const now = new Date().toISOString();
  db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(meta),
    now,
    Number(dramaId)
  );
  return dramaService.getDramaById(db, Number(dramaId));
}

module.exports = {
  WorkflowRequestError,
  getWorkflowPlan,
  collectTaskObservations,
  saveWorkflowModes,
  TASK_TYPE_MAP,
};
