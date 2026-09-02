// 与 Go ImageGenerationService.ExtractBackgroundsForEpisode + processBackgroundExtraction 对齐
const taskService = require('./taskService');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const sceneService = require('./sceneService');
const { safeParseAIJSON, extractFirstArray } = require('../utils/safeJson');
const {
  listScenesForStoryboardPrompt,
  findReusableDramaScene,
} = require('../utils/episodeAssetScope');
const { bindSceneToEpisode } = require('./episodeAssetBindService');
const {
  matchScenesWithAi,
  mergeSceneMatchWithFallback,
} = require('./assetReuseMatchService');

function normalizeLanguage(language) {
  const lang = (language || '').toString().trim().toLowerCase();
  return lang === 'zh' || lang === 'en' ? lang : '';
}

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text || '');
}

function withLanguage(cfg, language) {
  if (!language) return cfg;
  return {
    ...cfg,
    app: { ...(cfg?.app || {}), language },
  };
}

async function translatePromptToChinese(db, log, model, prompt) {
  const userPrompt =
    '请将以下场景图像提示词翻译为中文，保留风格词或比例（如 realistic、16:9）原样，直接返回翻译后的中文提示词，不要解释：\n' +
    prompt;
  const text = await aiClient.generateText(db, log, 'text', userPrompt, '', {
    scene_key: 'scene_extraction',
    model: model || undefined,
    temperature: 0.2,
    max_tokens: 400,
  });
  return (text || '').toString().trim();
}

/** 本剧已有场景地点名（跨集），供提取时复用命名 */
function listExistingDramaLocationNames(db, dramaId, excludeEpisodeId) {
  const scenes = listScenesForStoryboardPrompt(db, dramaId, excludeEpisodeId);
  const names = [];
  const seen = new Set();
  for (const sc of scenes) {
    if (excludeEpisodeId != null && Number(sc.episode_id) === Number(excludeEpisodeId)) continue;
    const loc = String(sc.location || '').trim();
    if (!loc) continue;
    const key = loc.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(loc);
  }
  return names;
}

async function extractBackgroundsFromScript(db, cfg, log, scriptContent, dramaId, model, style, existingLocations) {
  if (!scriptContent || !scriptContent.trim()) return [];
  const systemPrompt = promptI18n.getSceneExtractionPrompt(cfg, style, existingLocations);
  const prompt = (promptI18n.getLanguage(cfg) === 'en' ? '[Script Content]\n' : '【剧本内容】\n') + scriptContent;
  const text = await aiClient.generateText(db, log, 'text', prompt, systemPrompt, {
    scene_key: 'scene_extraction',
    model: model || undefined,
    temperature: 0.4,
  });
  let list = [];
  try {
    const parsed = safeParseAIJSON(text, log);
    list = extractFirstArray(parsed) || [];
  } catch (_) {
    list = [];
  }
  return list.map((b) => ({
    location: b.location || '',
    time: b.time || '',
    prompt: b.prompt || '',
    atmosphere: b.atmosphere,
  }));
}

/**
 * 落库：AI（+字符串回退）判断与本剧其它集是否同一场景，是则绑定复用，否则新建。
 */
async function persistExtractedBackgrounds(db, log, episode, backgroundsInfo, effectiveCfg, style, opts = {}) {
  const episodeId = Number(episode.id);
  const dramaId = Number(episode.drama_id);
  const reusablePool = listScenesForStoryboardPrompt(db, dramaId, episodeId).filter(
    (sc) => Number(sc.episode_id) !== episodeId
  );
  const incoming = Array.isArray(backgroundsInfo) ? backgroundsInfo : [];

  let reuseMap = new Map();
  if (reusablePool.length && incoming.length) {
    if (opts.taskId) {
      try {
        taskService.updateTaskStatus(db, opts.taskId, 'processing', 40, '正在分析是否与已有场景相同…');
      } catch (_) {}
    }
    const aiMap = await matchScenesWithAi(db, log, incoming, reusablePool, {
      model: opts.model,
      isEn: !!opts.isEn,
    });
    reuseMap = mergeSceneMatchWithFallback(aiMap, incoming, reusablePool, episodeId);
  }

  sceneService.deleteScenesByEpisodeId(db, log, episodeId);

  const scenes = [];
  const reusedIds = new Set();
  let reusedCount = 0;
  let createdCount = 0;
  const byId = new Map(reusablePool.map((s) => [Number(s.id), s]));

  for (let i = 0; i < incoming.length; i++) {
    const bg = incoming[i];
    const reuseId = reuseMap.get(i);
    if (reuseId && byId.has(Number(reuseId))) {
      const sid = Number(reuseId);
      if (reusedIds.has(sid)) continue;
      reusedIds.add(sid);
      bindSceneToEpisode(db, episodeId, sid);
      try {
        const row = db
          .prepare('SELECT id, prompt FROM scenes WHERE id = ? AND deleted_at IS NULL')
          .get(sid);
        const incomingPrompt = String(bg.prompt || '').trim();
        if (row && incomingPrompt && !(row.prompt && String(row.prompt).trim())) {
          db.prepare('UPDATE scenes SET prompt = ?, updated_at = ? WHERE id = ?').run(
            incomingPrompt,
            new Date().toISOString(),
            sid
          );
        }
      } catch (_) {}
      const scene = sceneService.getSceneById(db, sid);
      if (scene) {
        scenes.push({ ...scene, reused: true, matched_location: bg.location });
        reusedCount += 1;
        log.info('[提取场景] 复用本剧已有场景', {
          episode_id: episodeId,
          scene_id: sid,
          existing_location: byId.get(sid)?.location,
          ai_location: bg.location,
        });
      }
      continue;
    }

    const scene = sceneService.createSceneForEpisode(db, log, dramaId, episodeId, {
      location: bg.location,
      time: bg.time,
      prompt: bg.prompt,
    });
    if (scene) {
      scenes.push(scene);
      createdCount += 1;
      if (effectiveCfg) {
        const capturedStyle = style;
        setImmediate(() => {
          sceneService.generateScenePromptOnly(db, log, effectiveCfg, scene.id, undefined, capturedStyle).catch((err) => {
            log.warn('[提取场景] 预生成polished_prompt失败', { scene_id: scene.id, error: err.message });
          });
        });
      }
    }
  }

  return { scenes, reusedCount, createdCount };
}

/**
 * 本集重提取后：把仍指向已软删场景的分镜，改绑到同剧仍存活的相似场景。
 */
function remapStoryboardsFromDeletedEpisodeScenes(db, log, dramaId, episodeId) {
  const eId = Number(episodeId);
  const dId = Number(dramaId);
  if (!Number.isFinite(eId) || !Number.isFinite(dId)) return 0;
  let deletedRows = [];
  try {
    deletedRows = db
      .prepare(
        `SELECT id, location, time FROM scenes
         WHERE drama_id = ? AND episode_id = ? AND deleted_at IS NOT NULL`
      )
      .all(dId, eId);
  } catch (_) {
    return 0;
  }
  if (!deletedRows.length) return 0;
  const live = listScenesForStoryboardPrompt(db, dId, eId);
  let remapped = 0;
  for (const dead of deletedRows) {
    const hit = findReusableDramaScene(live, dead.location, dead.time, { minScore: 70 });
    if (!hit?.scene?.id) continue;
    const targetId = Number(hit.scene.id);
    if (targetId === Number(dead.id)) continue;
    const r = db
      .prepare(
        `UPDATE storyboards SET scene_id = ?, updated_at = ?
         WHERE episode_id = ? AND scene_id = ? AND deleted_at IS NULL`
      )
      .run(targetId, new Date().toISOString(), eId, Number(dead.id));
    if (r.changes > 0) {
      remapped += r.changes;
      bindSceneToEpisode(db, eId, targetId);
      log.info('[提取场景] 分镜场景已改绑到复用资产', {
        episode_id: eId,
        from_scene_id: dead.id,
        to_scene_id: targetId,
        storyboards: r.changes,
      });
    }
  }
  return remapped;
}

async function processBackgroundExtraction(db, cfg, log, taskID, episodeId, model, style, language) {
  taskService.updateTaskStatus(db, taskID, 'processing', 0, '正在提取场景信息...');
  const episode = db.prepare('SELECT id, drama_id, script_content FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
  if (!episode) {
    taskService.updateTaskStatus(db, taskID, 'failed', 0, '剧集信息不存在');
    return;
  }
  const scriptContent = episode.script_content;
  if (!scriptContent || !String(scriptContent).trim()) {
    taskService.updateTaskStatus(db, taskID, 'failed', 0, '剧本内容为空');
    return;
  }

  // 合并风格：显式 style 参数优先（一般为前端传来的英文 prompt）；否则用剧集 metadata 中的完整提示词
  let effectiveCfg = cfg;
  try {
    const dramaRow = db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(episode.drama_id);
    const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
    const paramStyle = (style && String(style).trim()) || '';
    let next = { ...cfg, style: { ...(cfg?.style || {}) } };
    if (dramaRow?.metadata) {
      const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
      if (meta?.aspect_ratio) next.style.default_image_ratio = meta.aspect_ratio;
    }
    if (paramStyle) {
      next.style = {
        ...next.style,
        default_style_zh: paramStyle,
        default_style_en: paramStyle,
        default_style: paramStyle,
      };
      effectiveCfg = next;
    } else {
      effectiveCfg = mergeCfgStyleWithDrama(next, dramaRow);
    }
    style = paramStyle || effectiveCfg?.style?.default_style_en || effectiveCfg?.style?.default_style || style;
  } catch (_) {}

  const requestedLanguage = normalizeLanguage(language);
  const configuredLanguage = normalizeLanguage(promptI18n.getLanguage(effectiveCfg));
  let effectiveLanguage = requestedLanguage || configuredLanguage;
  if (!requestedLanguage && effectiveLanguage === 'en' && hasChinese(scriptContent)) {
    effectiveLanguage = 'zh';
  }
  const cfgForPrompt = withLanguage(effectiveCfg, effectiveLanguage);
  const existingLocations = listExistingDramaLocationNames(db, episode.drama_id, episodeId);
  let backgroundsInfo;
  try {
    backgroundsInfo = await extractBackgroundsFromScript(
      db,
      cfgForPrompt,
      log,
      String(scriptContent),
      episode.drama_id,
      model,
      style,
      existingLocations
    );
  } catch (err) {
    log.error('Background extraction AI failed', { error: err.message, task_id: taskID });
    taskService.updateTaskStatus(db, taskID, 'failed', 0, 'AI提取场景失败: ' + err.message);
    return;
  }
  if (effectiveLanguage === 'zh') {
    const translated = await Promise.all(
      (backgroundsInfo || []).map(async (bg) => {
        const original = (bg.prompt || '').toString().trim();
        if (!original || hasChinese(original)) return bg;
        try {
          const translatedPrompt = await translatePromptToChinese(db, log, model, original);
          if (!translatedPrompt) return bg;
          return { ...bg, prompt: translatedPrompt };
        } catch (err) {
          log.warn('Background prompt translate failed', { error: err.message, task_id: taskID });
          return bg;
        }
      })
    );
    backgroundsInfo = translated;
  }
  const { scenes, reusedCount, createdCount } = await persistExtractedBackgrounds(
    db,
    log,
    episode,
    backgroundsInfo,
    effectiveCfg,
    style,
    {
      taskId: taskID,
      model,
      isEn: effectiveLanguage === 'en',
    }
  );
  const remapped = remapStoryboardsFromDeletedEpisodeScenes(db, log, episode.drama_id, episodeId);
  taskService.updateTaskResult(db, taskID, {
    scenes,
    count: scenes.length,
    reused_count: reusedCount,
    created_count: createdCount,
    remapped_storyboards: remapped,
    episode_id: episodeId,
    drama_id: episode.drama_id,
  });
  log.info('Background extraction completed', {
    task_id: taskID,
    episode_id: episodeId,
    count: scenes.length,
    reused: reusedCount,
    created: createdCount,
    remapped_storyboards: remapped,
  });
}

function extractBackgroundsForEpisode(db, cfg, log, episodeId, model, style, language) {
  const episode = db.prepare('SELECT id, drama_id, script_content FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
  if (!episode) throw new Error('episode not found');
  if (!episode.script_content || !String(episode.script_content).trim()) {
    throw new Error('episode has no script content');
  }
  // 读取项目的 aspect_ratio，覆盖全局 cfg 中的 default_image_ratio，使 promptI18n 生成正确比例的提示词
  let runCfg = cfg;
  if (episode.drama_id) {
    try {
      const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(episode.drama_id);
      if (dramaRow && dramaRow.metadata) {
        const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
        if (meta && meta.aspect_ratio) {
          runCfg = { ...cfg, style: { ...(cfg?.style || {}), default_image_ratio: meta.aspect_ratio } };
        }
      }
    } catch (_) {}
  }
  const existing = db.prepare(
    `SELECT id FROM async_tasks
     WHERE resource_id = ? AND type = 'background_extraction'
       AND status IN ('pending', 'processing') AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(String(episodeId));
  if (existing) {
    log.info('Background extraction already running', { task_id: existing.id, episode_id: episodeId });
    return existing.id;
  }

  const task = taskService.createTask(db, log, 'background_extraction', String(episodeId));
  setImmediate(() => {
    processBackgroundExtraction(db, runCfg, log, task.id, episodeId, model, style, language).catch((err) => {
      log.error('processBackgroundExtraction fatal', { error: err.message, task_id: task.id });
      taskService.updateTaskError(db, task.id, err.message || '场景提取失败');
    });
  });
  return task.id;
}

module.exports = {
  extractBackgroundsForEpisode,
  persistExtractedBackgrounds,
  listExistingDramaLocationNames,
  remapStoryboardsFromDeletedEpisodeScenes,
};
