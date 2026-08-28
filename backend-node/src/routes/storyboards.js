const fs = require('fs');
const path = require('path');
const response = require('../response');
const storyboardService = require('../services/storyboardService');
const episodeStoryboardService = require('../services/episodeStoryboardService');
const framePromptService = require('../services/framePromptService');
const aiClient = require('../services/aiClient');
const promptI18n = require('../services/promptI18n');
const {
  polishStoryboardImagePrompt,
  batchPolishStoryboardImagePromptsForEpisode,
} = require('../services/storyboardImagePromptBundle');
const angleService = require('../services/angleService');
const { buildUniversalSegmentUserPromptBundle } = require('../services/universalSegmentPromptBundle');
const { normalizeUniversalSegmentShotDurations } = require('../services/universalSegmentDurationNormalize');
const {
  loadClassicVideoPromptContext,
  generateClassicVideoPromptWithAi,
  hasClassicVideoPromptInputs,
} = require('../services/classicVideoPromptBundle');

/** 润色接口：邻镜结构化摘要（含全能片段与其它提示词字段） */
function formatNeighborShotPolishContext(row) {
  if (!row) return '(none)';
  const chunk = (k, v) => {
    const s = v != null && String(v).trim() ? String(v).trim() : '';
    return s ? `${k}: ${s}` : null;
  };
  const bits = [
    chunk('SHOT_NUM', row.storyboard_number),
    chunk('TITLE', row.title),
    chunk('DESCRIPTION', row.description),
    chunk('ACTION', row.action),
    chunk('DIALOGUE', row.dialogue),
    chunk('NARRATION', row.narration),
    chunk('VIDEO_PROMPT', row.video_prompt),
    chunk('UNIVERSAL_SEGMENT_TEXT', row.universal_segment_text),
  ].filter(Boolean);
  return bits.length ? bits.join('\n') : '(empty)';
}

/**
 * 分镜主图路径：storyboards.local_path 常与图生记录不同步（图在 image_generations），按存在性解析。
 * @returns {string|null} storage 相对路径
 */
function resolveStoryboardImageLocalPath(db, storageBase, storyboardId, sbRow) {
  const normalizeRel = (rel) => (rel && String(rel).trim() ? String(rel).trim().replace(/^\//, '') : '');
  const tryRel = (rel) => {
    const r = normalizeRel(rel);
    if (!r) return null;
    const abs = path.join(storageBase, r);
    return fs.existsSync(abs) ? r : null;
  };
  const fromSb = tryRel(sbRow?.local_path);
  if (fromSb) return fromSb;
  const ig = db.prepare(
    `SELECT local_path FROM image_generations
     WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
       AND local_path IS NOT NULL AND TRIM(local_path) != ''
     ORDER BY id DESC
     LIMIT 1`
  ).get(storyboardId);
  return tryRel(ig?.local_path);
}

/** 全能片段：@图片N 与中英字、引号之间补半角空格，便于模型与接口解析 */
function normalizeUniversalSegmentAtImageSpacing(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(
    /@图片(\d+)(?=[\u4e00-\u9fffA-Za-z「『【（])/gu,
    '@图片$1 '
  );
}

function routes(db, log) {
  return {
    create: (req, res) => {
      try {
        const sb = storyboardService.createStoryboard(db, log, req.body || {});
        response.created(res, sb);
      } catch (err) {
        log.error('storyboards create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    insertBefore: (req, res) => {
      try {
        const sb = storyboardService.insertBeforeStoryboard(db, log, req.params.id);
        if (!sb) return response.notFound(res, '目标分镜不存在');
        response.created(res, sb);
      } catch (err) {
        log.error('storyboards insertBefore', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    getOne: (req, res) => {
      try {
        const sb = storyboardService.getStoryboardById(db, req.params.id);
        if (!sb) return response.notFound(res, '分镜不存在');
        response.success(res, sb);
      } catch (err) {
        log.error('storyboards getOne', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    update: (req, res) => {
      try {
        const sb = storyboardService.updateStoryboard(db, log, req.params.id, req.body || {});
        if (!sb) return response.notFound(res, '分镜不存在');
        response.success(res, sb);
      } catch (err) {
        log.error('storyboards update', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = storyboardService.deleteStoryboard(db, log, req.params.id);
        if (!ok) return response.notFound(res, '分镜不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('storyboards delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    framePrompt: (req, res) => {
      try {
        const body = req.body || {};
        const frameType = body.frame_type || 'first';
        const panelCount = body.panel_count || 3;
        const model = body.model || '';
        const userInstruction =
          body.user_instruction != null ? String(body.user_instruction).trim() : '';
        const draftPrompt = body.draft_prompt != null ? String(body.draft_prompt).trim() : '';
        const taskId = framePromptService.generateFramePrompt(db, log, req.params.id, frameType, panelCount, model, {
          userInstruction,
          draftPrompt,
        });
        response.success(res, {
          task_id: taskId,
          status: 'pending',
          message: '帧提示词生成任务已创建，正在后台处理...',
        });
      } catch (err) {
        log.error('storyboards frame-prompt', { error: err.message });
        if (err.message && (err.message.includes('分镜不存在') || err.message.includes('不支持的'))) {
          return response.badRequest(res, err.message);
        }
        response.internalError(res, err.message);
      }
    },
    framePromptsGet: (req, res) => {
      try {
        const list = framePromptService.getFramePrompts(db, req.params.id);
        response.success(res, { frame_prompts: list });
      } catch (err) {
        log.error('storyboards frame-prompts', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    framePromptSave: (req, res) => {
      try {
        const frameType = req.params.frame_type;
        const validTypes = ['first', 'key', 'last', 'panel', 'action'];
        if (!validTypes.includes(frameType)) {
          return response.badRequest(res, '不支持的 frame_type');
        }
        const body = req.body || {};
        const prompt = typeof body.prompt === 'string' ? body.prompt : '';
        const description = typeof body.description === 'string' ? body.description : null;
        const layout = typeof body.layout === 'string' ? body.layout : null;
        if (!prompt.trim()) {
          return response.badRequest(res, 'prompt 不能为空');
        }
        framePromptService.saveFramePrompt(db, log, req.params.id, frameType, prompt, description, layout);
        response.success(res, { message: '保存成功', frame_type: frameType });
      } catch (err) {
        log.error('storyboards frame-prompt-save', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    regenerateLayoutDescription: async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!id) return response.badRequest(res, '缺少分镜 id');
        const newLayout = await framePromptService.regenerateLayoutDescription(db, log, id);
        response.success(res, {
          layout_description: newLayout,
          message: '布局描述已由 AI 重新生成并保存',
        });
      } catch (err) {
        log.error('storyboards regenerateLayoutDescription', { error: err.message, id: req.params.id });
        response.internalError(res, err.message || '重新生成布局描述失败');
      }
    },
    rebuildVideoPrompt: async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!id) return response.badRequest(res, '缺少分镜 id');
        const sb = await episodeStoryboardService.rebuildVideoPromptForStoryboardAsync(db, log, id);
        if (!sb) return response.notFound(res, '分镜不存在');
        const aiUsed = sb.video_prompt_source === 'ai_full_narration';
        response.success(res, {
          ...sb,
          message: aiUsed
            ? '视频提示词已根据旁白 AI 生成并保存'
            : '视频提示词已按最新规则重建并保存',
        });
      } catch (err) {
        log.error('storyboards rebuildVideoPrompt', { error: err.message, id: req.params.id });
        response.internalError(res, err.message || '重建视频提示词失败');
      }
    },
    splitByAudio: async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!id) return response.badRequest(res, '缺少分镜 id');
        const result = await episodeStoryboardService.splitStoryboardByAudioAsync(db, log, id);
        response.success(res, {
          ...result,
          message: `已拆成 ${result.storyboard_ids.length} 条分镜（新增 ${result.created_count} 条）`,
        });
      } catch (err) {
        log.error('storyboards splitByAudio', { error: err.message, id: req.params.id });
        response.badRequest(res, err.message || '拆镜失败');
      }
    },
    episodeStoryboardsGenerate: (req, res) => {
      try {
        const taskId = episodeStoryboardService.generateStoryboard(
          db,
          log,
          req.params.episode_id,
          req.query.model,
          req.query.style
        );
        response.success(res, { task_id: taskId, status: 'pending', message: '分镜头生成任务已创建，正在后台处理...' });
      } catch (err) {
        log.error('episode storyboards generate', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeStoryboardsGet: (req, res) => {
      try {
        const list = episodeStoryboardService.getStoryboardsForEpisode(db, req.params.episode_id);
        response.success(res, { storyboards: list, total: list.length });
      } catch (err) {
        log.error('episode storyboards get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    resyncFullNarration: async (req, res) => {
      try {
        const episodeId = Number(req.params.episode_id);
        if (!episodeId) return response.badRequest(res, '缺少 episode_id');
        const result = await episodeStoryboardService.resyncFullNarrationForEpisodeAsync(db, log, episodeId);
        response.success(res, {
          ...result,
          message: `已按剧本重新同步 ${result.segment_count} 镜解说旁白（未自动生成提示词，请配音后点「按配音时长生成提示词」）`,
        });
      } catch (err) {
        log.error('episode resync full narration', { error: err.message, episode_id: req.params.episode_id });
        response.badRequest(res, err.message || '同步旁白失败');
      }
    },

    /** 补全本集缺失的生图提示词（polished_prompt，跳过已有） */
    completeMissingImagePrompts: async (req, res) => {
      try {
        const episodeId = Number(req.params.episode_id);
        if (!episodeId) return response.badRequest(res, '缺少 episode_id');
        const result = await batchPolishStoryboardImagePromptsForEpisode(db, log, episodeId, { force: false });
        response.success(res, result);
      } catch (err) {
        log.error('episode complete missing image prompts', { error: err.message, episode_id: req.params.episode_id });
        response.internalError(res, err.message || '补全生图提示词失败');
      }
    },

    /** 补全本集缺失的视频提示词（全文解说经典时同时补 polished_prompt） */
    completeMissingVideoPrompts: async (req, res) => {
      try {
        const episodeId = Number(req.params.episode_id);
        if (!episodeId) return response.badRequest(res, '缺少 episode_id');
        const result = await episodeStoryboardService.completeMissingVideoPromptsForEpisode(db, log, episodeId);
        response.success(res, result);
      } catch (err) {
        log.error('episode complete missing video prompts', { error: err.message, episode_id: req.params.episode_id });
        response.internalError(res, err.message || '补全视频提示词失败');
      }
    },

    /** 全文解说经典：按旁白配音实际时长刷新各镜 duration 并 AI 生成 polished + video 提示词 */
    generatePromptsFromAudioDuration: async (req, res) => {
      try {
        const episodeId = Number(req.params.episode_id);
        if (!episodeId) return response.badRequest(res, '缺少 episode_id');
        const force = req.body?.force !== false;
        const result = await episodeStoryboardService.generateStoryboardPromptsFromAudioDurationAsync(
          db,
          log,
          episodeId,
          { force }
        );
        const synced = result.duration_sync?.updated ?? 0;
        response.success(res, {
          ...result,
          message: `已生成 ${result.rebuilt ?? 0} 镜提示词（${synced} 镜 duration 已按配音时长更新）`,
        });
      } catch (err) {
        log.error('episode generate prompts from audio', { error: err.message, episode_id: req.params.episode_id });
        response.badRequest(res, err.message || '按配音时长生成提示词失败');
      }
    },

    // 独立触发单条分镜的 image prompt 优化，结果保存到 storyboards.polished_prompt 并返回
    polishPrompt: async (req, res) => {
      try {
        const sbId = Number(req.params.id);
        const userInstruction =
          req.body && req.body.user_instruction != null ? String(req.body.user_instruction).trim() : '';
        const out = await polishStoryboardImagePrompt(db, log, sbId, {
          force: true,
          userInstruction: userInstruction || undefined,
        });
        response.success(res, { polished_prompt: out.polished_prompt });
      } catch (err) {
        const msg = err && err.message ? String(err.message) : '润色失败';
        if (msg.includes('不存在')) return response.notFound(res, msg);
        if (msg.includes('暂无可优化') || msg.includes('过短') || msg.includes('无效')) {
          return response.badRequest(res, msg);
        }
        log.error('storyboards polishPrompt', { error: msg });
        response.internalError(res, msg);
      }
    },

    /** 全能模式：根据分镜字段 AI 生成 universal_segment_text（含运镜/机位等专业描述） */
    generateUniversalSegmentPrompt: async (req, res) => {
      try {
        const sbId = Number(req.params.id);
        const built = buildUniversalSegmentUserPromptBundle(db, sbId, req.body || {}, {});
        if (!built.ok) {
          if (built.code === 'not_found') return response.notFound(res, built.message);
          return response.badRequest(res, built.message);
        }
        const { userPrompt, durationLabel, durationSec } = built;
        const out = await aiClient.generateText(
          db,
          log,
          'text',
          userPrompt,
          promptI18n.getUniversalOmniSegmentPrompt(),
          { scene_key: 'image_polish', max_tokens: 2400, temperature: 0.28 }
        );
        if (!out || String(out).trim().length < 20) {
          return response.badRequest(res, 'AI 返回内容过短，请检查文本模型配置');
        }
        let text = String(out).trim();
        text = normalizeUniversalSegmentShotDurations(text, durationLabel, durationSec);
        text = normalizeUniversalSegmentAtImageSpacing(text);
        const nowIso = new Date().toISOString();
        db.prepare('UPDATE storyboards SET universal_segment_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
          text,
          nowIso,
          sbId
        );
        log.info('[分镜] generateUniversalSegmentPrompt 完成', { id: sbId, len: text.length, duration_sec: durationSec });
        response.success(res, { universal_segment_text: text });
      } catch (err) {
        log.error('storyboards generateUniversalSegmentPrompt', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /** 全能模式：与 generateUniversalSegmentPrompt 相同逻辑，NDJSON 流式（delta + done） */
    generateUniversalSegmentStream: async (req, res) => {
      const sbId = Number(req.params.id);
      const built = buildUniversalSegmentUserPromptBundle(db, sbId, req.body || {}, {});
      if (!built.ok) {
        if (built.code === 'not_found') return response.notFound(res, built.message);
        return response.badRequest(res, built.message);
      }
      const { userPrompt, durationLabel, durationSec } = built;

      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const writeNd = (obj) => {
        res.write(`${JSON.stringify(obj)}\n`);
      };

      let finalRaw = '';
      try {
        finalRaw = await aiClient.streamGenerateText(
          db,
          log,
          'text',
          userPrompt,
          promptI18n.getUniversalOmniSegmentPrompt(),
          {
            scene_key: 'image_polish',
            max_tokens: 2400,
            temperature: 0.28,
            silence_timeout_ms: 180000,
          },
          (delta) => writeNd({ type: 'delta', text: delta })
        );
      } catch (err) {
        log.error('storyboards generateUniversalSegmentStream', { error: err.message, id: sbId });
        writeNd({ type: 'error', message: err.message || 'stream failed' });
        return res.end();
      }

      if (!finalRaw || String(finalRaw).trim().length < 20) {
        writeNd({ type: 'error', message: 'AI 返回内容过短，请检查文本模型配置' });
        return res.end();
      }
      let text = String(finalRaw).trim();
      text = normalizeUniversalSegmentShotDurations(text, durationLabel, durationSec);
      text = normalizeUniversalSegmentAtImageSpacing(text);
      const nowIso = new Date().toISOString();
      db.prepare('UPDATE storyboards SET universal_segment_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
        text,
        nowIso,
        sbId
      );
      log.info('[分镜] generateUniversalSegmentStream 完成', { id: sbId, len: text.length, duration_sec: durationSec });
      writeNd({ type: 'done', universal_segment_text: text });
      res.end();
    },

    /**
     * 全能片段润色：结合整集剧本与邻镜全能/分镜字段，流式返回 NDJSON（delta + done）。
     * body.draft_universal_segment_text 必填（与编辑器一致，可为未保存到 DB 的当前文本）
     */
    polishUniversalSegmentStream: async (req, res) => {
      const sbId = Number(req.params.id);
      const draftRaw =
        req.body && req.body.draft_universal_segment_text != null
          ? String(req.body.draft_universal_segment_text)
          : '';
      const draft = draftRaw.trim();
      if (!draft) {
        return response.badRequest(res, '请先填写或生成全能片段描述后再润色（编辑器内容不能为空）');
      }
      const built = buildUniversalSegmentUserPromptBundle(db, sbId, req.body || {}, {
        universalSegmentOverride: draftRaw,
      });
      if (!built.ok) {
        if (built.code === 'not_found') return response.notFound(res, built.message);
        return response.badRequest(res, built.message);
      }
      const { userPrompt: baseUser, durationLabel, durationSec, episodeId, storyboardNumber } = built;

      let scriptText = '';
      try {
        const ep = db
          .prepare('SELECT script_content, title FROM episodes WHERE id = ? AND deleted_at IS NULL')
          .get(episodeId);
        scriptText = (ep?.script_content && String(ep.script_content).trim()) || '';
      } catch (_) {}

      let prevRow = null;
      let nextRow = null;
      try {
        prevRow = db
          .prepare(
            `SELECT storyboard_number, title, description, action, dialogue, narration, video_prompt, universal_segment_text
             FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL
             ORDER BY storyboard_number DESC LIMIT 1`
          )
          .get(episodeId, storyboardNumber);
        nextRow = db
          .prepare(
            `SELECT storyboard_number, title, description, action, dialogue, narration, video_prompt, universal_segment_text
             FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL
             ORDER BY storyboard_number ASC LIMIT 1`
          )
          .get(episodeId, storyboardNumber);
      } catch (_) {}

      const polishPassStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const polishUserPrompt = [
        'TASK: POLISH_UNIVERSAL_OMNI_SEGMENT',
        `POLISH_PASS_STAMP: ${polishPassStamp}`,
        'POLISH_REFRESH（多次点击「润色」时强制）: 在严格遵守 MULTI_BEAT_OUTPUT、子分镜秒数之和=TOTAL_CLIP_SECONDS、IMAGE_SLOT_MAP、不编造剧本外情节的前提下，**本轮输出须与 CURRENT_OMNI_DRAFT 在中文表述上有明显差异**（换动词/语序、合并或拆分从句、加强或收紧运镜与情绪描写均可；**第3行仍须与 LINE3_REQUIRED 完全一致**）。除第3行外，**禁止**与草稿逐字相同或仅标点差异；若 M 与秒数分配不变，子分镜正文也须重写措辞。',
        'DIALOGUE_RETENTION（硬性，与 system 全能润色一致）: BASE_OMNI_CONTRACT 内 STORYBOARD FIELDS 的 DIALOGUE、NARRATION、VIDEO_PROMPT 及 CURRENT_OMNI_DRAFT 中一切对白/旁白/引号句，成稿各「分镜k」行须**逐条以「」或明确旁白写出**，保留笑点、数字、剧名、奖项名等关键信息；禁止用「两人对话」「念词带过」等概括替代具体台词。总秒数与各 Tk 不变前提下提高信息密度：台词与反应优先，少写无推进的纯氛围叠句。',
        'You are refining the CURRENT omni multi-beat prompt for a short drama vertical-video shot.',
        `FULL_EPISODE_SCRIPT（本集完整剧本，用于信息对齐与连戏；不得引入剧本未写的情节）:\n${scriptText || '(本集剧本正文为空，请仅依据下方 STORYBOARD FIELDS 与邻镜信息)'}`,
        '',
        'NEIGHBOR_PREV（上一分镜：含其全能片段与其它提示词字段，供衔接）:',
        formatNeighborShotPolishContext(prevRow),
        '',
        'NEIGHBOR_NEXT（下一分镜）:',
        formatNeighborShotPolishContext(nextRow),
        '',
        'CURRENT_OMNI_DRAFT（用户当前全能片段文本，必须在此基础上增强而非另起无关故事）:',
        draft,
        '',
        '--- BASE_OMNI_CONTRACT（与生成接口相同的约束与分镜字段块）---',
        baseUser,
      ].join('\n');

      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const writeNd = (obj) => {
        res.write(`${JSON.stringify(obj)}\n`);
      };

      let finalRaw = '';
      try {
        finalRaw = await aiClient.streamGenerateText(
          db,
          log,
          'text',
          polishUserPrompt,
          promptI18n.getUniversalOmniPolishPrompt(),
          {
            scene_key: 'image_polish',
            max_tokens: 4096,
            temperature: 0.52,
            silence_timeout_ms: 180000,
          },
          (delta) => writeNd({ type: 'delta', text: delta })
        );
      } catch (err) {
        log.error('storyboards polishUniversalSegmentStream', { error: err.message, id: sbId });
        writeNd({ type: 'error', message: err.message || 'stream failed' });
        return res.end();
      }

      if (!finalRaw || String(finalRaw).trim().length < 20) {
        writeNd({ type: 'error', message: 'AI 返回内容过短，请检查文本模型配置' });
        return res.end();
      }
      let text = String(finalRaw).trim();
      text = normalizeUniversalSegmentShotDurations(text, durationLabel, durationSec);
      text = normalizeUniversalSegmentAtImageSpacing(text);
      const nowIso = new Date().toISOString();
      db.prepare('UPDATE storyboards SET universal_segment_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
        text,
        nowIso,
        sbId
      );
      log.info('[分镜] polishUniversalSegmentStream 完成', { id: sbId, len: text.length, duration_sec: durationSec });
      writeNd({ type: 'done', universal_segment_text: text });
      res.end();
    },

    /**
     * 经典分镜：结合剧本与邻镜流式润色 video_prompt（NDJSON delta + done）。
     * body.draft_video_prompt 可选，为当前编辑区全文；缺省则用库内 video_prompt，再不行则用字段自动拼装。
     */
    polishClassicVideoPromptStream: async (req, res) => {
      const sbId = Number(req.params.id);
      const sbRow = db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sbId);
      if (!sbRow) return response.notFound(res, '分镜不存在');
      const mode = sbRow.creation_mode === 'universal' ? 'universal' : 'classic';
      if (mode === 'universal') {
        return response.badRequest(res, '当前为全能模式，请使用「润色全能提示词」');
      }

      const ctx = await loadClassicVideoPromptContext(db, sbRow, req.body || {});
      if (!hasClassicVideoPromptInputs(sbRow, ctx)) {
        return response.badRequest(res, '请先填写分镜的动作/旁白/场景等字段，或手写视频提示词后再润色');
      }

      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const writeNd = (obj) => {
        res.write(`${JSON.stringify(obj)}\n`);
      };

      try {
        const { text } = await generateClassicVideoPromptWithAi(db, log, sbRow, {
          mode: 'polish',
          draftVideoPrompt: req.body?.draft_video_prompt,
          userInstruction: req.body?.user_instruction,
          onDelta: (delta) => writeNd({ type: 'delta', text: delta }),
        });
        const nowIso = new Date().toISOString();
        db.prepare('UPDATE storyboards SET video_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
          text,
          nowIso,
          sbId
        );
        log.info('[分镜] polishClassicVideoPromptStream 完成', {
          id: sbId,
          len: text.length,
          full_narration: ctx.fullNarration,
        });
        writeNd({ type: 'done', video_prompt: text });
        res.end();
      } catch (err) {
        log.error('storyboards polishClassicVideoPromptStream', { error: err.message, id: sbId });
        writeNd({ type: 'error', message: err.message || 'stream failed' });
        res.end();
      }
    },

    upscale: async (req, res) => {
      const id = Number(req.params.id);
      const row = db.prepare(
        'SELECT id, local_path, image_url FROM storyboards WHERE id = ? AND deleted_at IS NULL'
      ).get(id);
      if (!row) return response.notFound(res, '分镜不存在');
      try {
        const loadConfig = require('../config').loadConfig;
        const cfg = loadConfig();
        const storageBase = path.isAbsolute(cfg.storage?.local_path)
          ? cfg.storage.local_path
          : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
        const localPath = resolveStoryboardImageLocalPath(db, storageBase, id, row);
        if (!localPath) return response.badRequest(res, '分镜没有本地图片，无法超分');
        const srcFile = path.join(storageBase, localPath);
        let sharp; try { sharp = require('sharp'); } catch (_) { sharp = null; }
        if (!sharp) return response.badRequest(res, 'sharp 模块不可用，无法超分');
        const info = await sharp(srcFile).metadata();
        const scale = 2;
        const newW = (info.width || 512) * scale;
        const newH = (info.height || 512) * scale;
        const ext = path.extname(localPath) || '.jpg';
        const baseName = path.basename(localPath, ext);
        const dirName = path.dirname(localPath);
        const newRelPath = path.join(dirName, baseName + '_2x' + ext).replace(/\\/g, '/');
        const newFile = path.join(storageBase, newRelPath);
        await sharp(srcFile).resize(newW, newH, { kernel: 'lanczos3' }).toFile(newFile);
        const now = new Date().toISOString();
        db.prepare('UPDATE storyboards SET local_path = ?, updated_at = ? WHERE id = ?').run(newRelPath, now, id);
        log.info('storyboard upscale done', { id, newRelPath, newW, newH });
        response.success(res, { local_path: newRelPath, width: newW, height: newH });
      } catch (err) {
        log.error('storyboards upscale', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    // 批量推断摄影参数（movement/lighting_style/depth_of_field）
    // 对 episode 下所有缺少这些字段的分镜进行快速文本推断，不调用 AI，毫秒级完成
    batchInferParams: (req, res) => {
      try {
        const episodeId = Number(req.body?.episode_id);
        const overwrite = !!req.body?.overwrite; // 是否覆盖已有值
        if (!episodeId) return response.badRequest(res, 'episode_id 必填');

        const rows = db.prepare(
          'SELECT id, angle_s, shot_type, atmosphere, time, description, action, movement, lighting_style, depth_of_field FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC'
        ).all(episodeId);

        let updated = 0;
        const now = new Date().toISOString();
        const stmt = db.prepare(
          'UPDATE storyboards SET movement = COALESCE(?, movement), lighting_style = COALESCE(?, lighting_style), depth_of_field = COALESCE(?, depth_of_field), updated_at = ? WHERE id = ?'
        );
        const stmtOverwrite = db.prepare(
          'UPDATE storyboards SET movement = ?, lighting_style = ?, depth_of_field = ?, updated_at = ? WHERE id = ?'
        );

        for (const row of rows) {
          const inferred = angleService.inferPhotographyParams(row);
          // 只更新缺少的字段（除非 overwrite=true）
          const newMovement   = overwrite ? inferred.movement   : (row.movement      ? null : inferred.movement);
          const newLighting   = overwrite ? inferred.lighting_style : (row.lighting_style ? null : inferred.lighting_style);
          const newDof        = overwrite ? inferred.depth_of_field : (row.depth_of_field  ? null : inferred.depth_of_field);

          if (overwrite) {
            if (inferred.movement || inferred.lighting_style || inferred.depth_of_field) {
              stmtOverwrite.run(inferred.movement, inferred.lighting_style, inferred.depth_of_field, now, row.id);
              updated++;
            }
          } else {
            if (newMovement || newLighting || newDof) {
              stmt.run(newMovement, newLighting, newDof, now, row.id);
              updated++;
            }
          }
        }

        log.info('[分镜] batchInferParams 完成', { episode_id: episodeId, total: rows.length, updated, overwrite });
        response.success(res, { total: rows.length, updated });
      } catch (err) {
        log.error('storyboards batchInferParams', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
