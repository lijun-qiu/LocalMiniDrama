const response = require('../response');
const path = require('path');

function routes(db, log, cfg) {
  function getStoragePath() {
    const loadConfig = require('../config').loadConfig;
    const c = (cfg && cfg.storage) ? cfg : loadConfig();
    return path.isAbsolute(c.storage?.local_path)
      ? c.storage.local_path
      : path.join(process.cwd(), c.storage?.local_path || './data/storage');
  }

  function buildSynthOpts(body, ttsText, storyboardId, storagePath) {
    const opts = {
      text: ttsText,
      storyboard_id: storyboardId || null,
      storage_base: storagePath,
    };
    if (body?.provider) opts.provider = String(body.provider).trim();
    if (body?.voice_id) opts.voice_id = String(body.voice_id).trim();
    if (body?.emotion_text != null) opts.emotion_text = String(body.emotion_text).trim();
    if (body?.speed != null && body.speed !== '') {
      const s = Number(body.speed);
      if (Number.isFinite(s) && s > 0) opts.speed = s;
    }
    const provider = String(body?.provider || opts.provider || '').toLowerCase();
    if (provider === 'indextts' && body?.auto_load_indextts !== false) {
      opts.auto_load_indextts = true;
    } else if (body?.auto_load_indextts === true) {
      opts.auto_load_indextts = true;
    }
    return opts;
  }

  return {
    /** 为单条分镜生成 TTS：对白 → audio_local_path；旁白 → narration_audio_local_path（body.tts_kind === 'narration'） */
    extract: async (req, res) => {
      const { storyboard_id, text, tts_kind } = req.body || {};
      if (!text && !storyboard_id) return response.badRequest(res, '请提供 storyboard_id 或 text');
      const kind = String(tts_kind || 'dialogue').toLowerCase() === 'narration' ? 'narration' : 'dialogue';
      let ttsText = text;
      if (kind === 'narration') {
        if ((!ttsText || !String(ttsText).trim()) && storyboard_id) {
          const row = db.prepare('SELECT narration FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboard_id));
          ttsText = row?.narration;
        }
        if (!ttsText || !String(ttsText).trim()) {
          return response.badRequest(res, '分镜解说旁白为空，无法合成语音');
        }
      } else {
        if ((!ttsText || !String(ttsText).trim()) && storyboard_id) {
          const row = db.prepare('SELECT dialogue FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboard_id));
          ttsText = row?.dialogue;
        }
        if (!ttsText || !String(ttsText).trim()) {
          return response.badRequest(res, '分镜对白为空，无法合成语音');
        }
      }
      try {
        const ttsService = require('../services/ttsService');
        const storagePath = getStoragePath();
        const synthBody = { ...req.body, text: ttsText, storyboard_id };
        if (kind === 'narration' && !synthBody.provider) {
          synthBody.provider = 'indextts';
        }
        const result = await ttsService.synthesize(db, log, buildSynthOpts(synthBody, ttsText, storyboard_id, storagePath));
        if (storyboard_id && result.local_path) {
          const now = new Date().toISOString();
          try {
            if (kind === 'narration') {
              db.prepare('UPDATE storyboards SET narration_audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, Number(storyboard_id)
              );
            } else {
              db.prepare('UPDATE storyboards SET audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, Number(storyboard_id)
              );
            }
          } catch (_) {}
        }
        response.success(res, { local_path: result.local_path, url: result.local_path ? '/static/' + result.local_path : '', tts_kind: kind });
      } catch (err) {
        log.error('audio extract', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /** 批量为多条分镜生成 TTS（支持对白 / 旁白，body.tts_kind === 'narration'） */
    extractBatch: async (req, res) => {
      const { storyboard_ids, tts_kind } = req.body || {};
      if (!Array.isArray(storyboard_ids) || storyboard_ids.length === 0) {
        return response.badRequest(res, 'storyboard_ids 不能为空');
      }
      const kind = String(tts_kind || 'dialogue').toLowerCase() === 'narration' ? 'narration' : 'dialogue';
      const results = [];
      const storagePath = getStoragePath();
      const batchBody = { ...req.body };
      if (kind === 'narration' && !batchBody.provider) {
        batchBody.provider = 'indextts';
      }
      for (const sbId of storyboard_ids) {
        const row = db.prepare(
          kind === 'narration'
            ? 'SELECT id, narration FROM storyboards WHERE id = ? AND deleted_at IS NULL'
            : 'SELECT id, dialogue FROM storyboards WHERE id = ? AND deleted_at IS NULL'
        ).get(Number(sbId));
        const ttsText = kind === 'narration' ? row?.narration : row?.dialogue;
        if (!row || !ttsText?.trim()) {
          results.push({ storyboard_id: sbId, error: kind === 'narration' ? '旁白为空' : '对白为空' });
          continue;
        }
        try {
          const ttsService = require('../services/ttsService');
          const result = await ttsService.synthesize(db, log, buildSynthOpts(batchBody, ttsText, row.id, storagePath));
          if (result.local_path) {
            const now = new Date().toISOString();
            try {
              if (kind === 'narration') {
                db.prepare('UPDATE storyboards SET narration_audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                  result.local_path, now, row.id
                );
              } else {
                db.prepare('UPDATE storyboards SET audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                  result.local_path, now, row.id
                );
              }
            } catch (_) {}
          }
          results.push({ storyboard_id: sbId, local_path: result.local_path });
        } catch (err) {
          results.push({ storyboard_id: sbId, error: err.message });
        }
      }
      response.success(res, results);
    },

    /** 整集旁白一次 IndexTTS 合成（写入 episodes.full_narration_audio_local_path） */
    synthesizeEpisodeFullNarration: async (req, res) => {
      const episodeId = Number(req.params.episode_id);
      if (!Number.isFinite(episodeId) || episodeId <= 0) {
        return response.badRequest(res, 'episode_id 无效');
      }
      try {
        const narrationAudioService = require('../services/narrationAudioService');
        const storagePath = getStoragePath();
        const body = req.body || {};
        const result = await narrationAudioService.synthesizeEpisodeFullNarration(db, log, episodeId, {
          storage_base: storagePath,
          provider: body.provider || 'indextts',
          voice_id: body.voice_id,
          emotion_text: body.emotion_text,
          speed: body.speed,
        });
        response.success(res, result);
      } catch (err) {
        log.error('audio synthesize full narration', { episode_id: episodeId, error: err.message });
        response.internalError(res, err.message);
      }
    },

    /** 将整段旁白按各镜 narration 字数比例剪切到分镜 */
    splitEpisodeFullNarration: async (req, res) => {
      const episodeId = Number(req.params.episode_id);
      if (!Number.isFinite(episodeId) || episodeId <= 0) {
        return response.badRequest(res, 'episode_id 无效');
      }
      try {
        const narrationAudioService = require('../services/narrationAudioService');
        const storagePath = getStoragePath();
        const result = narrationAudioService.splitFullNarrationToStoryboards(db, log, episodeId, storagePath);
        response.success(res, result);
      } catch (err) {
        log.error('audio split full narration', { episode_id: episodeId, error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
