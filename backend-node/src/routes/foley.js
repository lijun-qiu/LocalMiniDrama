const response = require('../response');
const foleyService = require('../services/foleyService');

function routes(db, log, cfg) {
  return {
    get: (req, res) => {
      const episodeId = Number(req.params.episode_id);
      if (!episodeId) return response.badRequest(res, 'episode_id 无效');
      try {
        const result = foleyService.getEpisodeFoley(db, episodeId);
        response.success(res, result);
      } catch (err) {
        log.error('foley get', { error: err.message, episode_id: episodeId });
        response.badRequest(res, err.message || '获取 Foley 失败');
      }
    },

    analyze: (req, res) => {
      const episodeId = Number(req.params.episode_id);
      if (!episodeId) return response.badRequest(res, 'episode_id 无效');
      try {
        const result = foleyService.analyzeEpisodeFoley(db, log, cfg, episodeId, req.body || {});
        response.success(res, result);
      } catch (err) {
        log.error('foley analyze', { error: err.message, episode_id: episodeId });
        response.badRequest(res, err.message || 'Foley 分析失败');
      }
    },

    generate: (req, res) => {
      const episodeId = Number(req.params.episode_id);
      if (!episodeId) return response.badRequest(res, 'episode_id 无效');
      try {
        const result = foleyService.generateEpisodeFoley(db, log, cfg, episodeId, req.body || {});
        response.success(res, result);
      } catch (err) {
        log.error('foley generate', { error: err.message, episode_id: episodeId });
        response.badRequest(res, err.message || 'Foley 生成失败');
      }
    },

    mixToVideo: (req, res) => {
      const episodeId = Number(req.params.episode_id);
      if (!episodeId) return response.badRequest(res, 'episode_id 无效');
      try {
        const result = foleyService.mixFoleyOntoEpisodeVideo(db, log, cfg, episodeId, req.body || {});
        response.success(res, result);
      } catch (err) {
        log.error('foley mix', { error: err.message, episode_id: episodeId });
        response.badRequest(res, err.message || '混入 Foley 失败');
      }
    },
  };
}

module.exports = { routes };
