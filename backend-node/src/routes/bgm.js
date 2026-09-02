const response = require('../response');
const bgmService = require('../services/bgmService');
const {
  getAceStepStatus,
  startAceStepService,
  unloadAceStepService,
  getAceStepConfigSummary,
} = require('../services/aceStepService');
const { suggestBgmDescription } = require('../services/bgmPromptService');

function routes(db, log, cfg) {
  return {
    aceStepHealth: async (req, res) => {
      try {
        const status = await getAceStepStatus({ timeoutMs: 5000 });
        response.success(res, { ...status, ...getAceStepConfigSummary() });
      } catch (err) {
        log.warn('bgm ace-step health', { error: err.message });
        response.success(res, {
          ok: false,
          online: false,
          loaded: false,
          models_initialized: false,
          error: err.message,
          ...getAceStepConfigSummary(),
        });
      }
    },

    aceStepStart: async (req, res) => {
      try {
        const status = await startAceStepService(log);
        response.success(res, { ...status, ...getAceStepConfigSummary() });
      } catch (err) {
        log.error('bgm ace-step start', { error: err.message });
        response.badRequest(res, err.message || 'ACE-Step 启动失败');
      }
    },

    aceStepUnload: async (req, res) => {
      try {
        const result = await unloadAceStepService(log);
        response.success(res, { ...result, ...getAceStepConfigSummary() });
      } catch (err) {
        log.warn('bgm ace-step unload', { error: err.message });
        response.badRequest(res, err.message || 'ACE-Step 卸载失败');
      }
    },

    suggestDescription: async (req, res) => {
      const episodeId = Number(req.params.episode_id);
      if (!episodeId) return response.badRequest(res, 'episode_id 无效');
      try {
        const result = await suggestBgmDescription(db, log, episodeId, req.body || {});
        response.success(res, result);
      } catch (err) {
        log.error('bgm suggest-description', { error: err.message, episode_id: episodeId });
        response.badRequest(res, err.message || '生成描述失败');
      }
    },

    generate: (req, res) => {
      const episodeId = Number(req.params.episode_id);
      if (!episodeId) return response.badRequest(res, 'episode_id 无效');
      try {
        const result = bgmService.generateEpisodeBgm(db, log, cfg, episodeId, req.body || {});
        response.success(res, result);
      } catch (err) {
        log.error('bgm generate', { error: err.message, episode_id: episodeId });
        response.badRequest(res, err.message || 'BGM 生成失败');
      }
    },

    list: (req, res) => {
      const episodeId = Number(req.params.episode_id);
      if (!episodeId) return response.badRequest(res, 'episode_id 无效');
      try {
        const kind = req.query?.kind || null;
        const items = bgmService.listMusicForEpisode(db, episodeId, kind);
        response.success(res, { items });
      } catch (err) {
        log.error('bgm list', { error: err.message, episode_id: episodeId });
        response.internalError(res, err.message);
      }
    },

    apply: (req, res) => {
      const episodeId = Number(req.params.episode_id);
      const musicId = Number(req.params.music_id);
      if (!episodeId || !musicId) return response.badRequest(res, '参数无效');
      try {
        const kind = (req.body && req.body.kind) || 'bgm';
        const result = bgmService.applyMusicToEpisode(db, episodeId, musicId, kind);
        response.success(res, result);
      } catch (err) {
        log.error('bgm apply', { error: err.message, episode_id: episodeId });
        response.badRequest(res, err.message || '应用失败');
      }
    },

    mixToVideo: (req, res) => {
      const episodeId = Number(req.params.episode_id);
      if (!episodeId) return response.badRequest(res, 'episode_id 无效');
      try {
        const result = bgmService.mixBgmIntoEpisodeVideo(db, log, cfg, episodeId, req.body || {});
        response.success(res, result);
      } catch (err) {
        log.error('bgm mix-to-video', { error: err.message, episode_id: episodeId });
        response.badRequest(res, err.message || '混入 BGM 失败');
      }
    },
  };
}

module.exports = { routes };
