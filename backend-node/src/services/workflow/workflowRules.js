'use strict';

/**
 * Data-driven workflow step rules for every content × generation mode pair.
 * Port of ArcReel lib/workflow_rules.py (ad mode reserved but not enabled).
 */

const CONTENT_MODES = Object.freeze(['narration', 'drama']);
const GENERATION_MODES = Object.freeze(['storyboard', 'reference_video']);

/** @typedef {'narration'|'drama'} ContentMode */
/** @typedef {'storyboard'|'reference_video'} GenerationMode */

const STEP_CHECKPOINTS = Object.freeze([
  ['project_input', 'PROJECT_INPUT'],
  ['selling_points', 'SELLING_POINTS'],
  ['asset_inventory', 'ASSET_INVENTORY'],
  ['episode_plan', 'EPISODE_PLAN'],
  ['step1_content', 'STEP1_CONTENT'],
  ['step1_review', 'STEP1_REVIEW'],
  ['final_script', 'FINAL_SCRIPT'],
  ['asset_sheets', 'ASSET_SHEETS'],
  ['script_structure', null],
  ['storyboard', 'STORYBOARD'],
  ['narration_delivery', null],
  ['video', 'VIDEO'],
  ['export', 'EXPORT_READY'],
]);

const EPISODIC_STEPS = Object.freeze(
  new Set([
    'project_input',
    'asset_inventory',
    'episode_plan',
    'step1_content',
    'step1_review',
    'final_script',
    'asset_sheets',
    'script_structure',
    'narration_delivery',
    'video',
    'export',
  ])
);

const CONTENT_STEPS = Object.freeze({
  narration: EPISODIC_STEPS,
  drama: EPISODIC_STEPS,
});

const PREPROCESSORS = Object.freeze({
  'narration|storyboard': 'split-narration-segments',
  'narration|reference_video': 'split-reference-video-units',
  'drama|storyboard': 'normalize-drama-script',
  'drama|reference_video': 'split-reference-video-units',
});

const SKELETON_KIND = Object.freeze({
  'narration|storyboard': 'storyboard_segments',
  'drama|storyboard': 'storyboard_segments',
  'narration|reference_video': 'video_units',
  'drama|reference_video': 'video_units',
});

/**
 * @param {string} contentMode
 * @param {string} generationMode
 */
function buildRule(contentMode, generationMode) {
  const applicable = new Set(CONTENT_STEPS[contentMode] || []);
  if (generationMode === 'storyboard') applicable.add('storyboard');
  return Object.freeze({
    content_mode: contentMode,
    generation_mode: generationMode,
    skeleton_kind: SKELETON_KIND[`${contentMode}|${generationMode}`] || 'storyboard_segments',
    preprocessor: PREPROCESSORS[`${contentMode}|${generationMode}`] ?? null,
    steps: Object.freeze(
      STEP_CHECKPOINTS.map(([id, checkpoint]) =>
        Object.freeze({
          id,
          checkpoint,
          applicable: applicable.has(id),
        })
      )
    ),
  });
}

const WORKFLOW_RULES = Object.freeze(
  Object.fromEntries(
    CONTENT_MODES.flatMap((cm) =>
      GENERATION_MODES.map((gm) => [`${cm}|${gm}`, buildRule(cm, gm)])
    )
  )
);

/**
 * @param {string} contentMode
 * @param {string} generationMode
 */
function workflowRule(contentMode, generationMode) {
  const key = `${contentMode}|${generationMode}`;
  const rule = WORKFLOW_RULES[key];
  if (!rule) {
    throw new Error(`unsupported workflow mode pair: ${JSON.stringify(contentMode)}, ${JSON.stringify(generationMode)}`);
  }
  return rule;
}

/**
 * @param {unknown} contentMode
 * @param {unknown} generationMode
 */
function isValidModePair(contentMode, generationMode) {
  return Boolean(WORKFLOW_RULES[`${contentMode}|${generationMode}`]);
}

/**
 * Normalize drama metadata modes; default drama × storyboard（读取缺省；新建见 createDrama）.
 * @param {Record<string, unknown>|null|undefined} metadata
 */
function resolveProjectModes(metadata) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const content_mode =
    typeof meta.content_mode === 'string' && CONTENT_MODES.includes(meta.content_mode)
      ? meta.content_mode
      : 'drama';
  const generation_mode =
    typeof meta.generation_mode === 'string' && GENERATION_MODES.includes(meta.generation_mode)
      ? meta.generation_mode
      : 'storyboard';
  const grid_storyboard = meta.grid_storyboard === true;
  return { content_mode, generation_mode, grid_storyboard };
}

module.exports = {
  CONTENT_MODES,
  GENERATION_MODES,
  STEP_CHECKPOINTS,
  WORKFLOW_RULES,
  workflowRule,
  isValidModePair,
  resolveProjectModes,
};
