'use strict';

/**
 * Execute WorkflowPlan.next_action against existing LMD services / return UI hints.
 */

const { getWorkflowPlan } = require('./workflowPlanner');
const { WorkflowRequestError } = require('./workflowErrors');
const scriptReview = require('./scriptReviewService');
const videoUnits = require('./videoUnitsService');
const dramaService = require('../dramaService');

function resolveEpisodeId(db, dramaId, episodeNumber, hintId) {
  if (hintId) return Number(hintId);
  const row = db
    .prepare(
      `SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? AND deleted_at IS NULL`
    )
    .get(Number(dramaId), Number(episodeNumber));
  return row ? Number(row.id) : null;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} log
 * @param {object} drama
 * @param {object} opts
 */
async function executeWorkflowAction(db, log, drama, opts = {}) {
  const plan = getWorkflowPlan(db, drama, {
    episode: opts.episode,
    narration_delivery: opts.narration_delivery ?? null,
  });
  const action = plan.next_action;
  const OVERRIDE_TYPES = new Set([
    'wait_for_task',
    'none',
    'retry',
    'reset_step1',
    'reset_episode_planning',
  ]);
  const type = opts.action_type || action.type;

  if (opts.action_type && opts.action_type !== action.type && !OVERRIDE_TYPES.has(opts.action_type)) {
    throw new WorkflowRequestError(
      `requested action ${opts.action_type} does not match next_action ${action.type}`
    );
  }

  const episodeNumber =
    opts.episode ||
    action.args?.episode ||
    plan.status?.target?.episode;
  const episodeId = resolveEpisodeId(
    db,
    drama.id,
    episodeNumber,
    opts.body?.episode_id || action.args?.episode_id
  );
  const baseUrl = opts.cfg?.storage?.base_url || '';

  const result = {
    executed: type,
    ok: true,
    detail: null,
    plan_before: { state: plan.status.state, next_action: action },
  };

  switch (type) {
    case 'none':
    case 'wait_for_task':
      result.detail = { message: action.reason, task_ids: action.args?.task_ids || [] };
      break;

    case 'collect_project_input':
      result.ok = false;
      result.detail = { message: action.reason, ui: 'collect_project_input' };
      break;

    case 'plan_episodes':
      result.ok = false;
      result.detail = {
        message: action.reason,
        ui: 'plan_episodes',
        endpoint: `PUT /api/v1/dramas/${drama.id}/episodes`,
      };
      break;

    case 'analyze_assets': {
      if (!episodeId) throw new WorkflowRequestError('episode_id required for analyze_assets');
      const taskIds = [];
      try {
        const propExtractionService = require('../propExtractionService');
        const tid = propExtractionService.extractPropsForEpisode(db, log, episodeId, opts.cfg);
        if (tid) taskIds.push(tid);
      } catch (e) {
        log?.warn?.('prop extract', { error: e.message });
      }
      try {
        const backgroundExtractionService = require('../backgroundExtractionService');
        const tid = backgroundExtractionService.extractBackgroundsForEpisode(
          db,
          opts.cfg,
          log,
          episodeId
        );
        if (tid) taskIds.push(tid);
      } catch (e) {
        log?.warn?.('scene extract', { error: e.message });
      }
      result.detail = {
        task_ids: taskIds,
        episode_id: episodeId,
        also_call: [`POST /api/v1/episodes/${episodeId}/characters/extract`],
        message: '已触发场景/道具提取；角色提取请另调 characters/extract',
      };
      break;
    }

    case 'propose_character_looks': {
      if (!episodeId) throw new WorkflowRequestError('episode_id required');
      if (opts.body?.complete === true || Array.isArray(opts.body?.looks)) {
        const episodeWardrobe = require('./episodeWardrobe');
        result.detail = episodeWardrobe.completeEpisodeWardrobe(db, drama.id, episodeId, {
          looks: opts.body.looks || [],
          expected_episode_source_revision:
            opts.body.expected_episode_source_revision || action.args?.expected_episode_source_revision,
        });
      } else {
        result.ok = false;
        result.detail = {
          message:
            '请完成本集资产/衣橱审查：先 POST /wardrobe/propose（LLM 提议阿杰@童年 等造型，勿新建假角色），核对后 POST /wardrobe/complete 写入 looks/scenes/props；或 UI「资产确认」→「AI 提议造型/场景/道具」',
          ui: 'propose_character_looks',
          episode_id: episodeId,
          endpoint: `POST /api/v1/episodes/${episodeId}/wardrobe/complete`,
          propose_endpoint: `POST /api/v1/episodes/${episodeId}/wardrobe/propose`,
          expected_episode_source_revision: action.args?.expected_episode_source_revision,
          syntax_hint: '@[角色@造型] 选用造型；@[角色%内心独白]{台词} 内心独白；{旁白} 画外音',
        };
      }
      break;
    }

    case 'reset_step1':
    case 'reset_episode_planning': {
      if (!episodeId) throw new WorkflowRequestError('episode_id required');
      result.detail = scriptReview.resetStep1(db, episodeId, {
        clear_storyboards: opts.body?.clear_storyboards !== false,
      });
      result.detail.message =
        '已回退本集内容整理：step1 / 正式剧本 / 分镜已清空，下一步为「整理内容」';
      break;
    }

    case 'prepare_step1': {
      if (!episodeId) throw new WorkflowRequestError('episode_id required');
      result.detail = await scriptReview.prepareStep1(db, episodeId, { log, cfg: opts.cfg });
      break;
    }

    case 'confirm_step1': {
      if (!episodeId) throw new WorkflowRequestError('episode_id required');
      // 必须显式确认，禁止一点「执行下一步」就空盖章过门
      if (opts.body?.confirmed !== true && opts.body?.confirm !== true) {
        const review = scriptReview.getReview(db, episodeId);
        result.ok = false;
        result.detail = {
          message: '请先核对整理后的分场/对白内容，确认无误后再点确认',
          ui: 'confirm_step1',
          episode_id: episodeId,
          review,
          expected_fingerprint: review.fingerprint,
        };
        break;
      }
      result.detail = scriptReview.confirmStep1(db, episodeId);
      break;
    }

    case 'generate_script': {
      if (!episodeId) throw new WorkflowRequestError('episode_id required');
      if (plan.status.project.generation_mode === 'reference_video') {
        result.detail = await videoUnits.generateReferenceScript(db, log, episodeId, opts.body || {});
      } else {
        result.detail = dramaService.generateStoryboard(db, log, episodeId, {
          model: opts.model,
          style: drama.style,
          include_narration: !!drama.metadata?.storyboard_include_narration,
          universal_omni_storyboard: !!drama.metadata?.storyboard_universal_omni,
          static_dialogue: !!drama.metadata?.storyboard_static_dialogue,
        });
      }
      break;
    }

    case 'generate_asset_sheets':
      result.ok = false;
      result.detail = {
        message: '请对 missing 资产触发生图',
        missing_ids: action.requested_ids || [],
        ui: 'generate_asset_sheets',
      };
      break;

    case 'generate_storyboards':
    case 'generate_grid':
      result.ok = false;
      result.detail = {
        message: '请批量生成分镜图',
        missing_ids: action.requested_ids || [],
        episode_id: episodeId,
        ui: 'generate_storyboards',
      };
      break;

    case 'choose_narration_delivery':
      result.ok = false;
      result.detail = {
        message: '请在请求中传入 narration_delivery',
        options: action.args?.options || ['post_production', 'use_tts'],
        ui: 'choose_narration_delivery',
      };
      break;

    case 'generate_videos':
      result.ok = false;
      result.detail = {
        message:
          '开始批量生成视频（全能模式需分镜已绑定场景/角色参考图；若提示缺少参考图，请先重新执行「生成正式剧本」以自动绑定）',
        missing_ids: action.requested_ids || [],
        episode_id: episodeId,
        narration_delivery: opts.narration_delivery,
        ui: 'generate_videos',
      };
      break;

    case 'generate_tts':
    case 'regenerate_tts':
      result.ok = false;
      result.detail = { message: '请调用 TTS', episode_id: episodeId, ui: 'generate_tts' };
      break;

    case 'export': {
      if (!episodeId) throw new WorkflowRequestError('episode_id required for export');
      result.detail = dramaService.finalizeEpisode(db, log, episodeId, baseUrl, opts.body || {});
      break;
    }

    default:
      result.ok = false;
      result.detail = {
        message: `action ${type} has no automated executor`,
        action,
      };
  }

  const dramaAfter = dramaService.getDramaById(db, drama.id);
  const planAfter = getWorkflowPlan(db, dramaAfter, {
    episode: opts.episode || episodeNumber,
    narration_delivery: opts.narration_delivery ?? null,
  });
  result.plan_after = {
    state: planAfter.status.state,
    next_action: planAfter.next_action,
  };
  result.plan = planAfter;
  return result;
}

module.exports = { executeWorkflowAction };
