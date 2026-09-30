'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  workflowRule,
  WORKFLOW_RULES,
  CONTENT_MODES,
  GENERATION_MODES,
  isValidModePair,
  resolveProjectModes,
} = require('../src/services/workflow/workflowRules');
const { buildWorkflowPlan } = require('../src/services/workflow/workflowPlan');
const { makeAction, WORKFLOW_ACTION_TYPES } = require('../src/services/workflow/workflowActions');

describe('workflowRules mode matrix', () => {
  it('exposes four content×generation pairs', () => {
    assert.equal(Object.keys(WORKFLOW_RULES).length, 4);
    for (const cm of CONTENT_MODES) {
      for (const gm of GENERATION_MODES) {
        assert.equal(isValidModePair(cm, gm), true);
      }
    }
  });

  it('marks storyboard step only for storyboard generation_mode', () => {
    const sb = workflowRule('drama', 'storyboard').steps.find((s) => s.id === 'storyboard');
    const rv = workflowRule('drama', 'reference_video').steps.find((s) => s.id === 'storyboard');
    assert.equal(sb.applicable, true);
    assert.equal(rv.applicable, false);
  });

  it('assigns preprocessors for narration and drama', () => {
    assert.equal(workflowRule('narration', 'storyboard').preprocessor, 'split-narration-segments');
    assert.equal(workflowRule('narration', 'reference_video').preprocessor, 'split-reference-video-units');
    assert.equal(workflowRule('drama', 'storyboard').preprocessor, 'normalize-drama-script');
    assert.equal(workflowRule('drama', 'reference_video').preprocessor, 'split-reference-video-units');
  });

  it('defaults unresolved metadata to drama × storyboard', () => {
    assert.deepEqual(resolveProjectModes({}), {
      content_mode: 'drama',
      generation_mode: 'storyboard',
      grid_storyboard: false,
    });
    assert.equal(resolveProjectModes({ content_mode: 'narration' }).content_mode, 'narration');
    assert.equal(resolveProjectModes({ generation_mode: 'reference_video' }).generation_mode, 'reference_video');
  });

  it('rejects ad / unknown pairs', () => {
    assert.equal(isValidModePair('ad', 'storyboard'), false);
    assert.throws(() => workflowRule('ad', 'storyboard'));
  });
});

describe('buildWorkflowPlan three-axis projection', () => {
  function baseStatus(overrides = {}) {
    return {
      schema_version: 1,
      project_revision: 'abc',
      source_revision: null,
      project: {
        content_mode: 'drama',
        generation_mode: 'storyboard',
        grid_storyboard: false,
      },
      target: {
        episode: 1,
        script: 'episodes/1/script',
        script_filename: 'episode_1.txt',
        source: 'episodes/1/script',
      },
      state: 'VIDEO',
      blockers: [],
      gates: { step1_review: { state: 'confirmed', revision: 'r1' } },
      artifacts: {
        asset_inventory: { state: 'current' },
        asset_sheets: { state: 'current', current_ids: [], missing_ids: [], stale_ids: [] },
        step1: { state: 'current' },
        script: { state: 'current' },
        storyboards: { state: 'current', current_ids: ['1'], missing_ids: [], stale_ids: [] },
        videos: { state: 'missing', current_ids: [], missing_ids: ['1'], stale_ids: [] },
        audio: { state: 'not_applicable' },
      },
      next_action: makeAction('generate_videos', 'video clips are missing', { ids: ['1'], args: { episode: 1 } }),
      ...overrides,
    };
  }

  it('keeps step progress / artifacts / tasks as separate fields', () => {
    const plan = buildWorkflowPlan(baseStatus(), {
      narration_delivery: 'post_production',
      task_observations: [
        {
          unit_id: '1',
          task_id: 't1',
          task_type: 'video',
          status: 'running',
          provider_checkpoint: { submitted: true, provider_job_id: 'p1' },
          problem: null,
        },
      ],
    });
    const video = plan.steps.find((s) => s.id === 'video');
    assert.equal(video.state, 'active');
    assert.equal(video.tasks.length, 1);
    assert.equal(video.tasks[0].provider_checkpoint.submitted, true);
    assert.equal(plan.next_action.type, 'wait_for_task');
    assert.ok(video.artifacts.missing_ids.includes('1'));
  });

  it('asks for narration_delivery before generate_videos when unset', () => {
    const plan = buildWorkflowPlan(baseStatus({
      project: { content_mode: 'narration', generation_mode: 'storyboard', grid_storyboard: false },
    }));
    assert.equal(plan.next_action.type, 'choose_narration_delivery');
    const delivery = plan.steps.find((s) => s.id === 'narration_delivery');
    assert.equal(delivery.action?.type, 'choose_narration_delivery');
    assert.equal(plan.narration_delivery.persisted, false);
  });

  it('does not force narration_delivery for drama projects', () => {
    const plan = buildWorkflowPlan(baseStatus(), { narration_delivery: null });
    assert.equal(plan.next_action.type, 'generate_videos');
  });

  it('skips storyboard step for reference_video status projection', () => {
    const status = baseStatus({
      project: { content_mode: 'narration', generation_mode: 'reference_video', grid_storyboard: false },
      state: 'FINAL_SCRIPT',
      next_action: makeAction('generate_script', 'need video_units', { args: { episode: 1 } }),
      artifacts: {
        ...baseStatus().artifacts,
        storyboards: { state: 'not_applicable', current_ids: [], missing_ids: [], stale_ids: [] },
      },
    });
    const plan = buildWorkflowPlan(status, { narration_delivery: 'post_production' });
    const sb = plan.steps.find((s) => s.id === 'storyboard');
    assert.equal(sb.state, 'skipped');
    assert.equal(sb.required, false);
  });

  it('action type list stays a closed set', () => {
    assert.ok(WORKFLOW_ACTION_TYPES.includes('prepare_step1'));
    assert.ok(WORKFLOW_ACTION_TYPES.includes('choose_narration_delivery'));
    assert.ok(WORKFLOW_ACTION_TYPES.includes('wait_for_task'));
  });
});
