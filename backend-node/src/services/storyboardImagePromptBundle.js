/**
 * 分镜图片提示词（polished_prompt）AI 写入：
 * - 分镜入库后批量并发生成（对齐视频提示词 batchRebuildClassicVideoPromptsForEpisode）
 * - 单条 API 润色复用
 * - 生图 Step3.5 若已有 polished_prompt 则跳过再调 AI
 */
const loadConfig = require('../config').loadConfig;
const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const { runConcurrentPool } = require('../utils/concurrentPool');
const taskService = require('./taskService');

const BATCH_IMAGE_PROMPT_CONCURRENCY = 7;
const BATCH_IMAGE_PROMPT_PROGRESS_START = 76;
const BATCH_IMAGE_PROMPT_PROGRESS_END = 81;

function resolveStyleBlock(db, dramaId) {
  let styleZh = '';
  let styleEn = '';
  let cfg = loadConfig();
  try {
    const dr = dramaId
      ? db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)
      : null;
    cfg = mergeCfgStyleWithDrama(cfg, dr || {});
    styleEn = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').trim();
    styleZh = (cfg?.style?.default_style_zh || '').trim();
  } catch (_) {}
  const styleForTokens =
    styleEn ||
    styleZh ||
    'cinematic movie still, anamorphic lens, film grain, dramatic lighting, shallow depth of field, professional cinematography';
  const styleBlockLines = [];
  if (styleZh) styleBlockLines.push(`【画风·最高优先级】${styleZh}`);
  if (styleEn && styleEn !== styleZh) styleBlockLines.push(`MANDATORY ART STYLE: ${styleEn}.`);
  else if (styleEn && !styleZh) styleBlockLines.push(`MANDATORY ART STYLE: ${styleEn}.`);
  else if (!styleZh && !styleEn) styleBlockLines.push(`MANDATORY ART STYLE: ${styleForTokens}.`);
  return { cfg, styleBlockLines, styleForTokens };
}

function collectStoryboardAssetNames(db, sbId) {
  const nameSet = new Set();
  try {
    const sbFull = db.prepare('SELECT characters FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sbId);
    if (sbFull?.characters) {
      const parsed = JSON.parse(sbFull.characters);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const cid = typeof item === 'object' && item != null ? item.id : item;
          const c = db.prepare('SELECT name FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(cid));
          if (c?.name) nameSet.add(c.name);
        }
      }
    }
  } catch (_) {}
  try {
    const libLinks = db.prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ?').all(sbId);
    for (const link of libLinks) {
      const lib = db.prepare('SELECT name FROM character_libraries WHERE id = ? AND deleted_at IS NULL').get(link.character_id);
      if (lib?.name) nameSet.add(lib.name);
    }
  } catch (_) {}
  return [...nameSet].join(', ');
}

function loadNeighborShotContext(db, episodeId, storyboardNumber) {
  let prevDesc = '(first shot)';
  let nextDesc = '(last shot)';
  let prevContinuityState = null;
  if (episodeId == null || storyboardNumber == null) {
    return { prevDesc, nextDesc, prevContinuityState };
  }
  const prevShot = db.prepare(
    `SELECT action, location, time, continuity_snapshot
     FROM storyboards
     WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL
     ORDER BY storyboard_number DESC LIMIT 1`
  ).get(episodeId, storyboardNumber);
  const nextShot = db.prepare(
    `SELECT action, location, time
     FROM storyboards
     WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL
     ORDER BY storyboard_number ASC LIMIT 1`
  ).get(episodeId, storyboardNumber);
  if (prevShot) {
    prevDesc =
      (prevShot.action || [prevShot.location, prevShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() ||
      '(first shot)';
    if (prevShot.continuity_snapshot) {
      try {
        prevContinuityState = JSON.parse(prevShot.continuity_snapshot);
      } catch (_) {}
    }
  }
  if (nextShot) {
    nextDesc =
      (nextShot.action || [nextShot.location, nextShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() ||
      '(last shot)';
  }
  return { prevDesc, nextDesc, prevContinuityState };
}

function scheduleContinuitySnapshot(db, log, sbId, polished, assetNames) {
  try {
    const snapshotPrompt = promptI18n.getContinuitySnapshotPrompt();
    const snapshotUserPrompt = [`PROMPT: ${polished}`, `ASSETS: ${assetNames || 'none'}`].join('\n');
    aiClient
      .generateText(db, log, 'text', snapshotUserPrompt, snapshotPrompt, {
        scene_key: 'image_polish',
        max_tokens: 200,
        temperature: 0.1,
      })
      .then((snapshotJson) => {
        if (!snapshotJson?.trim()) return;
        const cleaned = snapshotJson.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        try {
          JSON.parse(cleaned);
          db.prepare(
            'UPDATE storyboards SET continuity_snapshot = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
          ).run(cleaned, new Date().toISOString(), sbId);
          if (log?.info) log.info('[分镜] imagePrompt 连戏快照已保存', { id: sbId });
        } catch (_) {}
      })
      .catch(() => {});
  } catch (_) {}
}

/**
 * 单条分镜：AI 写入 polished_prompt（原始 image_prompt 不变）。
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] 已有 polished_prompt 时是否强制重写
 * @param {string} [opts.userInstruction]
 * @param {boolean} [opts.skipContinuitySnapshot=false]
 */
async function polishStoryboardImagePrompt(db, log, storyboardId, opts = {}) {
  const sbId = Number(storyboardId);
  if (!Number.isFinite(sbId) || sbId <= 0) {
    throw new Error('无效的分镜 id');
  }

  const sb = db
    .prepare(
      `SELECT id, episode_id, storyboard_number, image_prompt, action, dialogue, result, atmosphere, shot_type, polished_prompt
       FROM storyboards WHERE id = ? AND deleted_at IS NULL`
    )
    .get(sbId);
  if (!sb) throw new Error('分镜不存在');

  const existing = sb.polished_prompt != null ? String(sb.polished_prompt).trim() : '';
  if (!opts.force && existing.length > 10) {
    return { polished_prompt: existing, skipped: true, source: 'existing' };
  }

  if (!sb.image_prompt && !sb.action && !sb.dialogue) {
    throw new Error('该分镜暂无可优化的内容（image_prompt / action / dialogue 均为空）');
  }

  let dramaId = null;
  try {
    const ep = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(sb.episode_id);
    dramaId = ep?.drama_id ?? null;
  } catch (_) {}

  const { cfg, styleBlockLines, styleForTokens } = resolveStyleBlock(db, dramaId);
  const { prevDesc, nextDesc, prevContinuityState } = loadNeighborShotContext(
    db,
    sb.episode_id,
    sb.storyboard_number
  );
  const assetNames = collectStoryboardAssetNames(db, sbId);
  const userInstruction = opts.userInstruction != null ? String(opts.userInstruction).trim() : '';

  const userPromptLines = [
    ...styleBlockLines,
    userInstruction ? `USER_INSTRUCTION: ${userInstruction}` : null,
    sb.image_prompt ? `PROMPT: ${sb.image_prompt}` : null,
    sb.action ? `ACTION: ${sb.action}` : null,
    sb.dialogue ? `DIALOGUE: ${sb.dialogue}` : null,
    sb.result ? `RESULT: ${sb.result}` : null,
    sb.atmosphere ? `ATMOSPHERE: ${sb.atmosphere}` : null,
    sb.shot_type ? `SHOT_TYPE: ${sb.shot_type}` : null,
    `STYLE_TOKENS (repeat in output): ${styleForTokens}`,
    `ASSETS: ${assetNames || 'none'}`,
    prevContinuityState ? `PREV_CONTINUITY_STATE: ${JSON.stringify(prevContinuityState)}` : null,
    `CONTEXT_PREV: ${prevDesc}`,
    `CONTEXT_NEXT: ${nextDesc}`,
    `REMINDER: Output a STATIC SINGLE-FRAME image prompt only. No camera motion, no transitions, no split panels.`,
  ].filter(Boolean);

  const polishedPrompt = await aiClient.generateText(
    db,
    log,
    'text',
    userPromptLines.join('\n'),
    promptI18n.getImagePolishPrompt(cfg),
    { scene_key: 'image_polish', max_tokens: 300, temperature: 0.3 }
  );

  if (!polishedPrompt || polishedPrompt.trim().length < 10) {
    throw new Error('AI 返回内容过短，请检查文本模型配置');
  }

  const polished = polishedPrompt.trim();
  const nowIso = new Date().toISOString();
  db.prepare('UPDATE storyboards SET polished_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    polished,
    nowIso,
    sbId
  );
  if (log?.info) {
    log.info('[分镜] polishImagePrompt 完成', {
      id: sbId,
      len: polished.length,
      has_prev_continuity: !!prevContinuityState,
    });
  }

  if (!opts.skipContinuitySnapshot) {
    scheduleContinuitySnapshot(db, log, sbId, polished, assetNames);
  }

  return { polished_prompt: polished, skipped: false, source: 'ai' };
}

function batchImagePromptProgressPercent(completed, total) {
  if (!total || total <= 0) return BATCH_IMAGE_PROMPT_PROGRESS_START;
  const ratio = Math.min(1, Math.max(0, completed / total));
  const span = BATCH_IMAGE_PROMPT_PROGRESS_END - BATCH_IMAGE_PROMPT_PROGRESS_START;
  return BATCH_IMAGE_PROMPT_PROGRESS_START + Math.floor(ratio * span);
}

/**
 * 分镜入库后批量 AI 写入 polished_prompt（有限并发）。
 */
async function batchPolishStoryboardImagePromptsForEpisode(db, log, episodeId, opts = {}) {
  const episodeIdNum = Number(episodeId);
  if (!Number.isFinite(episodeIdNum) || episodeIdNum <= 0) {
    return { polished: 0, failed: 0, skipped: 0, total: 0 };
  }

  const anyTextConfig = db
    .prepare(
      "SELECT id FROM ai_service_configs WHERE service_type = 'text' AND deleted_at IS NULL LIMIT 1"
    )
    .get();
  if (!anyTextConfig) {
    if (log?.warn) {
      log.warn('[分镜] 跳过批量 AI 图片提示词：未配置文本模型', { episode_id: episodeIdNum });
    }
    return { polished: 0, failed: 0, skipped: 0, total: 0, skipped_reason: 'no_text_model' };
  }

  const rows = db
    .prepare(
      `SELECT id FROM storyboards
       WHERE episode_id = ? AND deleted_at IS NULL AND COALESCE(is_intro, 0) = 0
       ORDER BY storyboard_number ASC`
    )
    .all(episodeIdNum);

  const total = rows.length;
  const taskId = opts.taskId != null ? String(opts.taskId) : null;
  const concurrency = Math.max(1, Number(opts.concurrency) || BATCH_IMAGE_PROMPT_CONCURRENCY);
  // 入库默认强制重写；手动批量可传 force:false 以跳过已有
  const force = opts.force !== false;

  const reportProgress = (completed) => {
    if (!taskId) return;
    const progress = batchImagePromptProgressPercent(completed, total);
    taskService.updateTaskStatus(
      db,
      taskId,
      'processing',
      progress,
      `正在 AI 生成各镜图片提示词 ${completed}/${total}...`
    );
  };

  if (total === 0) {
    reportProgress(0);
    return { polished: 0, failed: 0, skipped: 0, total: 0 };
  }

  reportProgress(0);

  let skipped = 0;
  const { succeeded, failed, results } = await runConcurrentPool(
    rows,
    concurrency,
    async (row) => {
      const out = await polishStoryboardImagePrompt(db, log, row.id, {
        force,
        skipContinuitySnapshot: false,
      });
      if (out.skipped) skipped += 1;
      return out;
    },
    ({ completed }) => reportProgress(completed)
  );

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (r?.ok) continue;
    if (log?.warn) {
      log.warn('[分镜] 批量 AI 生成 polished_prompt 失败', {
        storyboard_id: rows[i]?.id,
        error: r?.error?.message || 'unknown',
      });
    }
  }

  reportProgress(total);

  if (log?.info) {
    log.info('[分镜] 批量 AI 生成图片提示词完成', {
      episode_id: episodeIdNum,
      polished: succeeded,
      failed,
      skipped,
      total,
      concurrency,
    });
  }

  return { polished: succeeded, failed, skipped, total };
}

module.exports = {
  BATCH_IMAGE_PROMPT_CONCURRENCY,
  BATCH_IMAGE_PROMPT_PROGRESS_START,
  BATCH_IMAGE_PROMPT_PROGRESS_END,
  polishStoryboardImagePrompt,
  batchPolishStoryboardImagePromptsForEpisode,
  collectStoryboardAssetNames,
};
