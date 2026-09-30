'use strict';

/**
 * Side-effect-free projection of WorkflowStatus → WorkflowPlan.
 * Port of ArcReel lib/workflow_plan.py build_workflow_plan.
 */

const { workflowRule } = require('./workflowRules');
const { makeAction, NARRATION_DELIVERIES } = require('./workflowActions');

const ARTIFACT_BY_STEP = Object.freeze({
  asset_inventory: 'asset_inventory',
  asset_sheets: 'asset_sheets',
  step1_content: 'step1',
  step1_review: 'step1',
  final_script: 'script',
  storyboard: 'storyboards',
  narration_delivery: 'audio',
  video: 'videos',
});

const TASK_STEP = Object.freeze({
  storyboard: 'storyboard',
  grid: 'storyboard',
  image: 'storyboard',
  tts: 'narration_delivery',
  audio: 'narration_delivery',
  video: 'video',
  reference_video: 'video',
});

/**
 * @param {{ applicable: boolean, id: string }} rule
 * @param {{ index: number, currentIndex: number, status: object }} ctx
 */
function baselineStepState(rule, { index, currentIndex, status }) {
  if (!rule.applicable) return 'skipped';
  if (index < currentIndex) return 'completed';
  if (index > currentIndex) return 'pending';
  if ((status.blockers && status.blockers.length) || status.next_action?.type === 'none') {
    return 'blocked';
  }
  return 'ready';
}

/**
 * @param {object} status
 * @param {Array<{ id: string, checkpoint: string|null, applicable: boolean }>} rules
 */
function currentRuleIndex(status, rules) {
  if (status.next_action?.type === 'repair_video_units') {
    return rules.findIndex((r) => r.id === 'script_structure');
  }
  const idx = rules.findIndex((r) => r.applicable && r.checkpoint === status.state);
  if (idx < 0) {
    throw new Error(`workflow state ${status.state} is absent from its mode rule`);
  }
  return idx;
}

function contractsForStep(stepId) {
  if (stepId === 'script_structure') return { script_edit: 'script_batch_edit/v1', batch_admission: null };
  if (stepId === 'video') return { script_edit: null, batch_admission: 'video_batch_admission/v1' };
  return { script_edit: null, batch_admission: null };
}

function problemUnitIds(problems) {
  const ids = [];
  for (const problem of problems || []) {
    let unitId = problem?.params?.unit_id;
    if (typeof unitId !== 'string') {
      const admission = problem?.params?.speech_admission;
      unitId = admission && typeof admission.unit_id === 'string' ? admission.unit_id : null;
    }
    if (typeof unitId === 'string' && unitId && !ids.includes(unitId)) ids.push(unitId);
  }
  return ids;
}

function structureAction(problems, scriptRevision) {
  return makeAction('patch_episode_script', problems[0]?.detail || 'script structure problems', {
    args: {
      expected_revision: scriptRevision ?? null,
      problems: problems || [],
    },
    ids: problemUnitIds(problems),
  });
}

function admissionAction(admission, problems, requestedIds) {
  const requiresConfirmation = admission?.decision === 'confirmation_required';
  const action = problems[0]?.action || 'confirm_request_duration';
  return makeAction(action, problems[0]?.detail || 'video batch requires confirmation', {
    args: { admission },
    ids: requestedIds,
    requires_confirmation: requiresConfirmation,
  });
}

function admissionProblems(admission) {
  if (!admission || !Array.isArray(admission.units)) return [];
  const out = [];
  for (const unit of admission.units) {
    if (!unit || !Array.isArray(unit.problems)) continue;
    for (const raw of unit.problems) {
      if (raw && typeof raw === 'object') out.push(raw);
    }
  }
  return out;
}

/**
 * @param {object} status WorkflowStatus
 * @param {{
 *   narration_delivery?: string|null,
 *   structure_problems?: object[],
 *   script_revision?: string|null,
 *   task_observations?: object[],
 *   admission?: object|null,
 * }} [opts]
 */
function buildWorkflowPlan(status, opts = {}) {
  const narrationDelivery = opts.narration_delivery ?? null;
  const structureProblems = [...(opts.structure_problems || [])];
  const taskObservations = [...(opts.task_observations || [])];
  const admission = opts.admission ?? null;
  const scriptRevision = opts.script_revision ?? null;
  const admProblems = admissionProblems(admission);

  const rule = workflowRule(status.project.content_mode, status.project.generation_mode);
  const rules = rule.steps;
  const currentIndex = currentRuleIndex(status, rules);
  const steps = [];

  for (let index = 0; index < rules.length; index++) {
    const stepRule = rules[index];
    const artifactKey = ARTIFACT_BY_STEP[stepRule.id];
    const step = {
      id: stepRule.id,
      state: baselineStepState(stepRule, { index, currentIndex, status }),
      required: stepRule.applicable,
      action: stepRule.checkpoint === status.state ? status.next_action : null,
      requested_ids:
        stepRule.checkpoint === status.state ? [...(status.next_action.requested_ids || [])] : [],
      artifacts: artifactKey ? { ...(status.artifacts?.[artifactKey] || {}) } : {},
      problems: [],
      tasks: [],
      admission: null,
      contracts: contractsForStep(stepRule.id),
    };
    if (stepRule.id === 'narration_delivery') {
      // Only required when narration projects are about to generate videos.
      step.required =
        status.project?.content_mode === 'narration' &&
        status.state === 'VIDEO' &&
        status.next_action?.type === 'generate_videos';
      if (status.project?.content_mode !== 'narration' && step.state !== 'skipped') {
        // Keep applicable from rules (narration_delivery is always applicable in episodic
        // rules) but treat as completed/not blocking for drama.
        if (index < currentIndex || status.state === 'EXPORT_READY') step.state = 'completed';
      }
    }
    if (step.artifacts.state === 'blocked' && step.state !== 'skipped') {
      step.state = 'blocked';
    }
    steps.push(step);
  }

  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  const structureStep = byId.script_structure;
  if (structureProblems.length) {
    structureStep.state = 'blocked';
    structureStep.problems = structureProblems;
    structureStep.requested_ids = problemUnitIds(structureProblems);
    structureStep.action = structureAction(structureProblems, scriptRevision);
    for (const mediaStep of ['storyboard', 'narration_delivery', 'video']) {
      if (byId[mediaStep].state !== 'skipped') {
        byId[mediaStep].state = 'pending';
        byId[mediaStep].action = null;
      }
    }
  }

  const deliveryStep = byId.narration_delivery;
  const deliveryIndex = rules.findIndex((r) => r.id === 'narration_delivery');
  if (!structureProblems.length && currentIndex >= deliveryIndex) {
    const ttsBlocked = narrationDelivery === 'use_tts' && deliveryStep.state === 'blocked';
    if (!ttsBlocked) {
      deliveryStep.state = narrationDelivery != null ? 'completed' : 'ready';
    }
  }

  for (const observation of taskObservations) {
    const stepId = TASK_STEP[observation.task_type];
    if (!stepId || !byId[stepId]) continue;
    const step = byId[stepId];
    step.tasks.push(observation);
    if (['queued', 'running', 'cancelling', 'pending', 'processing'].includes(observation.status)) {
      step.state = 'active';
    }
  }

  const videoStep = byId.video;
  videoStep.admission = admission;
  videoStep.problems = admProblems;
  if (admission && admission.decision !== 'admitted' && !videoStep.tasks.length) {
    videoStep.state = 'blocked';
  }

  const activeTasks = taskObservations.filter((t) =>
    ['queued', 'running', 'cancelling', 'pending', 'processing'].includes(t.status)
  );

  let nextAction;
  if (status.blockers?.length) {
    nextAction = status.next_action;
  } else if (structureProblems.length) {
    nextAction = structureAction(structureProblems, scriptRevision);
  } else if (activeTasks.length) {
    nextAction = makeAction('wait_for_task', 'workflow has active generation tasks', {
      args: { task_ids: activeTasks.map((t) => t.task_id) },
      ids: activeTasks.map((t) => t.unit_id),
    });
    for (const step of steps) {
      if (step.state === 'active') step.action = nextAction;
    }
    if (videoStep.state !== 'active') videoStep.action = null;
  } else if (
    status.state === 'VIDEO' &&
    status.next_action?.type === 'generate_videos' &&
    narrationDelivery == null &&
    status.project?.content_mode === 'narration'
  ) {
    nextAction = makeAction('choose_narration_delivery', 'choose narration delivery for this video request', {
      args: { options: [...NARRATION_DELIVERIES] },
      ids: [...(status.next_action.requested_ids || [])],
    });
    deliveryStep.action = nextAction;
    videoStep.state = 'pending';
    videoStep.action = null;
  } else if (admission && admission.decision !== 'admitted') {
    nextAction = admissionAction(admission, admProblems, [...(status.next_action.requested_ids || [])]);
    videoStep.action = nextAction;
  } else {
    nextAction = status.next_action;
  }

  return {
    schema_version: 1,
    status,
    narration_delivery: {
      selected: narrationDelivery,
      options: [...NARRATION_DELIVERIES],
      persisted: false,
    },
    steps,
    blockers: [...(status.blockers || [])],
    problems: [...structureProblems, ...admProblems],
    next_action: nextAction,
  };
}

module.exports = {
  ARTIFACT_BY_STEP,
  TASK_STEP,
  buildWorkflowPlan,
  baselineStepState,
  currentRuleIndex,
};
