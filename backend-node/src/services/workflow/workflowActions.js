'use strict';

/**
 * Closed action set + shared enums for workflow status / plan.
 * Port of ArcReel WorkflowActionType + step/artifact axes.
 */

const WORKFLOW_ACTION_TYPES = Object.freeze([
  'none',
  'collect_project_input',
  'draft_selling_points',
  'analyze_assets',
  'propose_character_looks',
  'plan_episodes',
  'reset_episode_planning',
  'reset_step1',
  'prepare_step1',
  'confirm_step1',
  'generate_script',
  'generate_asset_sheets',
  'generate_storyboards',
  'generate_grid',
  'repair_video_units',
  'generate_videos',
  'export',
  'retry_project_migration',
  'patch_episode_script',
  'choose_narration_delivery',
  'retry',
  'fix_input',
  'generate_dependency',
  'generate_tts',
  'regenerate_tts',
  'wait_for_task',
  'replan_unit',
  'confirm_request_duration',
  'configure_provider',
  'repair_artifact_state',
]);

const WORKFLOW_STEP_STATES = Object.freeze([
  'completed',
  'ready',
  'active',
  'blocked',
  'pending',
  'skipped',
]);

const ARTIFACT_STATUSES = Object.freeze(['current', 'stale', 'missing', 'blocked']);

const WORKFLOW_STATE_NAMES = Object.freeze([
  'PROJECT_INPUT',
  'SELLING_POINTS',
  'ASSET_INVENTORY',
  'EPISODE_PLAN',
  'STEP1_CONTENT',
  'STEP1_REVIEW',
  'FINAL_SCRIPT',
  'ASSET_SHEETS',
  'STORYBOARD',
  'VIDEO',
  'EXPORT_READY',
]);

const NARRATION_DELIVERIES = Object.freeze(['post_production', 'use_tts']);

/**
 * @param {string} type
 * @param {string} reason
 * @param {{ args?: Record<string, unknown>, ids?: string[], requires_confirmation?: boolean }} [opts]
 */
function makeAction(type, reason, opts = {}) {
  return {
    type,
    args: opts.args && typeof opts.args === 'object' ? { ...opts.args } : {},
    requested_ids: Array.isArray(opts.ids) ? opts.ids.map(String) : [],
    requires_confirmation: Boolean(opts.requires_confirmation),
    reason: String(reason || ''),
  };
}

function emptyCollection() {
  return { state: 'missing', current_ids: [], stale_ids: [], missing_ids: [] };
}

function notApplicableCollection() {
  return { state: 'not_applicable', current_ids: [], stale_ids: [], missing_ids: [] };
}

/**
 * @param {string[]} currentIds
 * @param {string[]} missingIds
 * @param {string[]} [staleIds]
 */
function mediaCollection(currentIds, missingIds, staleIds = []) {
  const current_ids = currentIds.map(String);
  const missing_ids = missingIds.map(String);
  const stale_ids = staleIds.map(String);
  let state = 'current';
  if (missing_ids.length && !current_ids.length && !stale_ids.length) state = 'missing';
  else if (missing_ids.length) state = 'partial';
  else if (stale_ids.length && !current_ids.length) state = 'stale';
  else if (stale_ids.length) state = 'partial';
  return { state, current_ids, stale_ids, missing_ids };
}

module.exports = {
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_STEP_STATES,
  ARTIFACT_STATUSES,
  WORKFLOW_STATE_NAMES,
  NARRATION_DELIVERIES,
  makeAction,
  emptyCollection,
  notApplicableCollection,
  mediaCollection,
};
