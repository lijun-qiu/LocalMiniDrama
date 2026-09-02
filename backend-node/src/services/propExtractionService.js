// 与 Go PropService.ExtractPropsFromScript + processPropExtraction 对齐：从剧本提取道具
const taskService = require('./taskService');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const propService = require('./propService');
const { safeParseAIJSON, extractFirstArray } = require('../utils/safeJson');
const { listPropsForStoryboardPrompt } = require('../utils/episodeAssetScope');
const { bindPropToEpisode } = require('./episodeAssetBindService');
const {
  matchPropsWithAi,
  mergePropMatchWithFallback,
} = require('./assetReuseMatchService');

let _cfg = null; // 由 extractPropsForEpisode 注入，供异步任务使用

/**
 * 落库：AI（+字符串回退）判断与本剧已有道具是否同一件，是则绑定，否则新建。
 */
async function persistExtractedProps(db, log, episode, extractedProps, cfg) {
  const episodeId = Number(episode.id);
  const dramaId = Number(episode.drama_id);
  const reusablePool = listPropsForStoryboardPrompt(db, dramaId, episodeId).filter(
    (p) => Number(p.episode_id) !== episodeId
  );

  // 补充描述字段供 AI 匹配（列表查询可能无 description）
  const catalog = reusablePool.map((p) => {
    const full = propService.getById(db, p.id) || p;
    return {
      ...p,
      description: full.description || '',
      image_url: full.image_url || p.image_url,
      local_path: full.local_path || p.local_path,
    };
  });

  const incoming = [];
  for (const p of extractedProps || []) {
    const name = (p.name && String(p.name).trim()) || '';
    if (!name) continue;
    incoming.push({
      name,
      type: (p.type && String(p.type).trim()) || null,
      description: (p.description && String(p.description).trim()) || null,
      image_prompt: (p.image_prompt && String(p.image_prompt).trim()) || null,
    });
  }

  let reuseMap = new Map();
  if (catalog.length && incoming.length) {
    const aiMap = await matchPropsWithAi(db, log, incoming, catalog, {
      isEn: promptI18n.isEnglish(cfg || {}),
    });
    reuseMap = mergePropMatchWithFallback(aiMap, incoming, catalog, episodeId);
  }

  propService.softDeletePropsByEpisodeId(db, log, episodeId);

  const createdProps = [];
  const reusedIds = new Set();
  const byId = new Map(catalog.map((p) => [Number(p.id), p]));
  let reusedCount = 0;
  let createdCount = 0;

  for (let i = 0; i < incoming.length; i++) {
    const p = incoming[i];
    const reuseId = reuseMap.get(i);

    // 精确同名且仍存活（其它集）已在 reuseMap；也处理本剧精确同名（含刚被其它路径保留的）
    if (reuseId && byId.has(Number(reuseId))) {
      const pid = Number(reuseId);
      if (reusedIds.has(pid)) continue;
      reusedIds.add(pid);
      bindPropToEpisode(db, episodeId, pid);
      const now = new Date().toISOString();
      // 不覆盖已有图；仅在描述/类型为空时补全
      try {
        const row = db
          .prepare('SELECT id, type, description, prompt FROM props WHERE id = ? AND deleted_at IS NULL')
          .get(pid);
        if (row) {
          const type = row.type || p.type;
          const description = row.description || p.description;
          const prompt = row.prompt || p.image_prompt;
          db.prepare(
            'UPDATE props SET type = ?, description = ?, prompt = ?, updated_at = ? WHERE id = ?'
          ).run(type, description, prompt, now, pid);
        }
      } catch (_) {}
      const updated = propService.getById(db, pid);
      if (updated) {
        createdProps.push({ ...updated, reused: true });
        reusedCount += 1;
        log.info('[提取道具] 复用本剧已有道具', {
          episode_id: episodeId,
          prop_id: pid,
          existing_name: byId.get(pid)?.name,
          ai_name: p.name,
        });
      }
      continue;
    }

    // 本剧精确同名（任意集，含未进 reusable 过滤的）仍更新复用
    const existingExact = db
      .prepare('SELECT id FROM props WHERE drama_id = ? AND name = ? AND deleted_at IS NULL')
      .get(dramaId, p.name);
    if (existingExact) {
      const now = new Date().toISOString();
      db.prepare(
        'UPDATE props SET type = ?, description = ?, prompt = ?, updated_at = ? WHERE id = ?'
      ).run(p.type, p.description, p.image_prompt, now, existingExact.id);
      bindPropToEpisode(db, episodeId, existingExact.id);
      const updated = propService.getById(db, existingExact.id);
      if (updated) {
        createdProps.push({ ...updated, reused: true });
        reusedCount += 1;
      }
      continue;
    }

    const prop = propService.create(db, log, {
      drama_id: dramaId,
      episode_id: episodeId,
      name: p.name,
      type: p.type,
      description: p.description,
      prompt: p.image_prompt,
    });
    if (prop) {
      createdProps.push(prop);
      createdCount += 1;
      if (!prop.prompt && (_cfg || cfg)) {
        const runCfg = _cfg || cfg;
        setImmediate(() => {
          propService.generatePropPromptOnly(db, log, runCfg, prop.id, undefined, undefined).catch((err) => {
            log.warn('[提取道具] 预生成提示词失败', { prop_id: prop.id, error: err.message });
          });
        });
      }
    }
  }

  return { props: createdProps, reusedCount, createdCount };
}

async function processPropExtraction(db, log, taskId, episodeId) {
  taskService.updateTaskStatus(db, taskId, 'processing', 0, '正在分析剧本...');

  const episode = db.prepare(
    'SELECT id, drama_id, script_content FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(episodeId));
  if (!episode) {
    taskService.updateTaskError(db, taskId, '剧集不存在');
    return;
  }

  const scriptContent = episode.script_content;
  if (!scriptContent || !String(scriptContent).trim()) {
    taskService.updateTaskError(db, taskId, '剧本内容为空');
    return;
  }

  const loadConfig = require('../config').loadConfig;
  let cfg = loadConfig();
  try {
    const dramaRow = db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(episode.drama_id);
    if (dramaRow) {
      const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
      let next = { ...cfg, style: { ...(cfg?.style || {}), default_prop_style: '' } };
      if (dramaRow.metadata) {
        const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
        if (meta && meta.aspect_ratio) {
          next.style.default_prop_ratio = meta.aspect_ratio;
          next.style.default_image_ratio = meta.aspect_ratio;
        }
      }
      cfg = mergeCfgStyleWithDrama(next, dramaRow);
    }
  } catch (_) {}

  // 注入已有道具名，便于模型沿用规范名
  const existingPropNames = listPropsForStoryboardPrompt(db, episode.drama_id, episodeId)
    .filter((p) => Number(p.episode_id) !== Number(episodeId))
    .map((p) => p.name)
    .filter(Boolean);
  let systemPrompt = promptI18n.getPropExtractionPrompt(cfg);
  if (existingPropNames.length) {
    systemPrompt += promptI18n.isEnglish(cfg)
      ? `\n\nReuse existing prop names when it is the same object:\n${existingPropNames.map((n) => `- ${n}`).join('\n')}`
      : `\n\n【本剧已有道具】若为同一物件，name 请尽量使用以下已有名称：\n${existingPropNames.map((n) => `- ${n}`).join('\n')}`;
  }

  const contentLabel = promptI18n.isEnglish(cfg) ? '[Script Content]\n' : '【剧本内容】\n';
  const prompt = contentLabel + String(scriptContent).trim();

  let response;
  try {
    response = await aiClient.generateText(db, log, 'text', prompt, systemPrompt, {
      scene_key: 'prop_extraction',
      max_tokens: 2000,
      temperature: 0.3,
    });
  } catch (err) {
    log.error('Prop extraction AI failed', { error: err.message, task_id: taskId });
    taskService.updateTaskError(db, taskId, 'AI 提取失败: ' + (err.message || '未知错误'));
    return;
  }

  let extractedProps = [];
  try {
    const parsed = safeParseAIJSON(response, log);
    extractedProps = extractFirstArray(parsed) || [];
  } catch (_) {
    taskService.updateTaskError(db, taskId, '解析 AI 返回的 JSON 失败');
    return;
  }

  taskService.updateTaskStatus(db, taskId, 'processing', 45, '正在分析是否与已有道具相同…');

  const { props: createdProps, reusedCount, createdCount } = await persistExtractedProps(
    db,
    log,
    episode,
    extractedProps,
    cfg
  );

  taskService.updateTaskResult(db, taskId, {
    props: createdProps,
    count: createdProps.length,
    reused_count: reusedCount,
    created_count: createdCount,
    episode_id: episodeId,
    drama_id: episode.drama_id,
  });
  log.info('Prop extraction completed', {
    task_id: taskId,
    episode_id: episodeId,
    count: createdProps.length,
    reused: reusedCount,
    created: createdCount,
  });
}

function extractPropsForEpisode(db, log, episodeId, cfg) {
  if (cfg) _cfg = cfg;
  const episode = db.prepare(
    'SELECT id, drama_id, script_content FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(episodeId));
  if (!episode) throw new Error('episode not found');
  if (!episode.script_content || !String(episode.script_content).trim()) {
    throw new Error('剧集剧本内容为空，无法提取道具');
  }

  const task = taskService.createTask(db, log, 'prop_extraction', String(episodeId));
  setImmediate(() => {
    processPropExtraction(db, log, task.id, episodeId).catch((err) => {
      log.error('processPropExtraction fatal', { error: err.message, task_id: task.id });
    });
  });
  return task.id;
}

module.exports = {
  extractPropsForEpisode,
  processPropExtraction,
  persistExtractedProps,
};
