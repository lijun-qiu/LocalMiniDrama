const response = require('../response');
const videoService = require('../services/videoService');
const taskService = require('../services/taskService');
const { normalizeAspectRatioForApi } = require('../services/videoClient');
const {
  isLatinHeavyStyle,
  sanitizeChineseOmniStyleAnchor,
} = require('../services/universalOmniMultiBeatFormat');

function routes(db, log) {
  function loadClassicFieldsForStoryboard(storyboardId) {
    const id = Number(storyboardId);
    if (!Number.isFinite(id) || id <= 0) return null;
    try {
      return (
        db
          .prepare(
            `SELECT action, dialogue, narration, result, atmosphere, location, time, title,
                    movement, shot_type, angle, sound_effect, video_prompt, creation_mode
             FROM storyboards WHERE id = ? AND deleted_at IS NULL`
          )
          .get(id) || null
      );
    } catch (_) {
      return null;
    }
  }

  function writeBackArcReelPrompt(storyboardId, prompt, source) {
    const id = Number(storyboardId);
    if (!Number.isFinite(id) || id <= 0 || !prompt) return;
    const now = new Date().toISOString();
    if (source === 'classic') {
      db.prepare(
        `UPDATE storyboards SET video_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
      ).run(prompt, now, id);
      return;
    }
    if (source === 'omni') {
      db.prepare(
        `UPDATE storyboards SET universal_segment_text = ?, creation_mode = 'universal', updated_at = ? WHERE id = ? AND deleted_at IS NULL`
      ).run(prompt, now, id);
    }
  }

  return {
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const { items, total, page, pageSize } = videoService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('videos list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    create: (req, res) => {
      try {
        const body = req.body || {};
        const task = taskService.createTask(db, log, 'video_generation', String(body.drama_id || ''));
        const now = new Date().toISOString();
        const dramaId = Number(body.drama_id) || 0;
        const storyboardId = body.storyboard_id != null ? Number(body.storyboard_id) : null;
        const provider = body.provider || 'chatfire';
        let prompt = body.prompt || '';
        const style = (body.style || '').toString().trim();
        const isZhOmniPrompt = /【风格锚点】/.test(prompt);
        let isArcReelStructured = false;
        // 全能 / 经典：入库前转为 ArcReel 结构化，避免未手点「改为结构化」就提交
        try {
          const {
            ensureArcReelStructuredForVideoSubmit,
            isArcReelStructuredPrompt,
            looksLikeClassicVideoPrompt,
          } = require('../services/dramaVideoPromptYaml');
          const characters = dramaId
            ? db
                .prepare(
                  `SELECT name, voice_style FROM characters WHERE drama_id = ? AND deleted_at IS NULL`
                )
                .all(dramaId)
            : [];
          const nameToTag = new Map();
          if (storyboardId) {
            try {
              const { buildUniversalSegmentUserPromptBundle } = require('../services/universalSegmentPromptBundle');
              const built = buildUniversalSegmentUserPromptBundle(db, storyboardId, {}, {});
              if (built.ok && Array.isArray(built.characterSlots)) {
                for (const s of built.characterSlots) {
                  if (s?.name && s?.tag) nameToTag.set(String(s.name), String(s.tag));
                }
              }
            } catch (_) {}
          }
          const classicRow = storyboardId ? loadClassicFieldsForStoryboard(storyboardId) : null;
          // 全能模式也要带上 narration/dialogue，否则 ArcReel 只有 Action、缺 Speaker: 画外音
          const classicFields =
            classicRow ||
            (looksLikeClassicVideoPrompt(prompt) ? { video_prompt: prompt } : null);
          const ensured = ensureArcReelStructuredForVideoSubmit(prompt, {
            characters,
            nameToTag,
            classicFields,
          });
          if (ensured.structured && ensured.prompt) {
            prompt = ensured.prompt;
            isArcReelStructured = true;
            if ((ensured.converted || !ensured.passthrough) && storyboardId) {
              const writeAs =
                classicRow?.creation_mode === 'universal' || ensured.source === 'omni'
                  ? 'omni'
                  : 'classic';
              writeBackArcReelPrompt(storyboardId, prompt, writeAs);
            }
            log.info('[视频] create 已确保 ArcReel 结构化', {
              storyboard_id: storyboardId,
              converted: ensured.converted,
              source: ensured.source || null,
              has_negative_tail: prompt.includes('禁止出现：BGM、文字字幕、水印。'),
            });
          } else {
            isArcReelStructured = isArcReelStructuredPrompt(prompt);
          }
        } catch (_) {
          isArcReelStructured = false;
        }
        if (style) {
          const baseLower = String(prompt || '').toLowerCase();
          const styleLower = style.toLowerCase();
          const skipLatinIntoZhOmni = isZhOmniPrompt && isLatinHeavyStyle(style);
          if (!isArcReelStructured && !skipLatinIntoZhOmni && !baseLower.includes(styleLower)) {
            if (isZhOmniPrompt) {
              prompt = prompt.replace(
                /(【风格锚点】\s*\n)([^\n【]*)/,
                (_, head, bodyLine) => `${head}${String(bodyLine || '').trim()}，${style}`
              );
            } else {
              prompt = prompt ? `${prompt}. Style: ${style}` : `Style: ${style}`;
            }
          }
        }
        if (isZhOmniPrompt && !isArcReelStructured) {
          prompt = sanitizeChineseOmniStyleAnchor(prompt);
        }
        const model = body.model ?? null;
        const duration = body.duration ?? null;
        // 画幅：请求体归一化（全角冒号等）后写入 DB；未传则从 drama.metadata 读取并同样归一化
        let aspectRatio = null;
        if (body.aspect_ratio != null && String(body.aspect_ratio).trim() !== '') {
          aspectRatio = normalizeAspectRatioForApi(body.aspect_ratio);
        }
        if (!aspectRatio && dramaId) {
          try {
            const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
            if (dramaRow && dramaRow.metadata) {
              const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
              if (meta && meta.aspect_ratio) aspectRatio = normalizeAspectRatioForApi(meta.aspect_ratio);
            }
          } catch (_) {}
        }
        const resolution = body.resolution ?? null;
        const seed = body.seed != null ? Number(body.seed) : null;
        const cameraFixed = body.camera_fixed != null ? (body.camera_fixed ? 1 : 0) : null;
        const watermark = body.watermark != null ? (body.watermark ? 1 : 0) : 0;
        const imageUrl = body.image_url ?? null;
        // 首尾帧：支持 URL 或本地路径（sxy，存到 first_frame_url / last_frame_url）
        const firstFrameUrl = body.first_frame_url ?? body.first_frame_local_path ?? null;
        const lastFrameUrl = body.last_frame_url ?? body.last_frame_local_path ?? null;
        // 多图模式：sxy，存 JSON 数组到 reference_image_urls
        const refImagesJson =
          body.reference_image_urls && Array.isArray(body.reference_image_urls)
            ? JSON.stringify(body.reference_image_urls.slice(0, 10))
            : null;
        db.prepare(
          `INSERT INTO video_generations (drama_id, storyboard_id, provider, prompt, model, duration, aspect_ratio, resolution, seed, camera_fixed, watermark, image_url, first_frame_url, last_frame_url, reference_image_urls, status, task_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`
        ).run(dramaId, storyboardId, provider, prompt, model, duration, aspectRatio, resolution, seed, cameraFixed, watermark, imageUrl, firstFrameUrl, lastFrameUrl, refImagesJson, task.id, now, now);
        const videoGenId = db.prepare('SELECT last_insert_rowid() as id').get().id;
        setImmediate(() => {
          videoService.processVideoGeneration(db, log, videoGenId);
        });
        const item = videoService.getById(db, videoGenId);
        response.created(res, item || { id: videoGenId, task_id: task.id, status: 'processing' });
      } catch (err) {
        log.error('videos create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    get: (req, res) => {
      try {
        const item = videoService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('videos get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = videoService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('videos delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    /** 失败后复用 provider_task_id 继续轮询上游，避免浪费已提交任务 */
    resumePoll: (req, res) => {
      try {
        const result = videoService.resumeFailedVideoPoll(db, log, req.params.id);
        if (!result.ok) {
          if (result.status === 404) return response.notFound(res, result.error);
          return response.badRequest(res, result.error);
        }
        response.success(res, result.item);
      } catch (err) {
        log.error('videos resumePoll', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    fromImage: (req, res) => {
      try {
        const task = taskService.createTask(db, log, 'video_generation', req.params.image_gen_id);
        response.success(res, { task_id: task.id });
      } catch (err) {
        log.error('videos fromImage', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeBatch: (req, res) => {
      try {
        response.success(res, []);
      } catch (err) {
        log.error('videos episode batch', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
