'use strict';

const response = require('../response');

module.exports = function scriptReviewRoutes(db, log) {
  const scriptReview = () => require('../services/workflow/scriptReviewService');
  const videoUnits = () => require('../services/workflow/videoUnitsService');

  function handleReviewErr(res, err, logLabel) {
    if (err?.name === 'WorkflowRequestError') {
      const code = err.code;
      if (code === 'conflict' || code === 'quarantined' || code === 'no_step1') {
        return response.error(res, 409, String(code).toUpperCase(), err.message);
      }
      return response.badRequest(res, err.message);
    }
    log.error(logLabel, { error: err.message, stack: err.stack });
    return response.internalError(res, err.message);
  }

  return {
    get: (req, res) => {
      try {
        response.success(res, scriptReview().getReview(db, req.params.episode_id));
      } catch (err) {
        handleReviewErr(res, err, 'script-review get');
      }
    },
    prepare: async (req, res) => {
      try {
        const out = await scriptReview().prepareStep1(db, req.params.episode_id, { log });
        response.success(res, out);
      } catch (err) {
        handleReviewErr(res, err, 'script-review prepare');
      }
    },
    putContent: (req, res) => {
      try {
        const base = req.query.base_fingerprint || req.body?.base_fingerprint;
        const content = req.body?.content != null ? req.body.content : req.body;
        response.success(res, scriptReview().putStep1Content(db, req.params.episode_id, content, base));
      } catch (err) {
        handleReviewErr(res, err, 'script-review put');
      }
    },
    confirm: (req, res) => {
      try {
        response.success(res, scriptReview().confirmStep1(db, req.params.episode_id));
      } catch (err) {
        handleReviewErr(res, err, 'script-review confirm');
      }
    },
    listVideoUnits: (req, res) => {
      try {
        response.success(res, videoUnits().listVideoUnits(db, req.params.episode_id));
      } catch (err) {
        handleReviewErr(res, err, 'video-units list');
      }
    },
    generateVideoUnits: async (req, res) => {
      try {
        const out = await videoUnits().generateReferenceScript(db, log, req.params.episode_id, req.body || {});
        response.success(res, out);
      } catch (err) {
        handleReviewErr(res, err, 'video-units generate');
      }
    },
    getWardrobe: (req, res) => {
      try {
        const episodeWardrobe = require('../services/workflow/episodeWardrobe');
        const ep = db
          .prepare(
            `SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL`
          )
          .get(Number(req.params.episode_id));
        if (!ep) return response.notFound(res, '章节不存在');
        response.success(res, episodeWardrobe.getAssetReview(db, ep.drama_id, ep.id));
      } catch (err) {
        handleReviewErr(res, err, 'wardrobe get');
      }
    },
    completeWardrobe: (req, res) => {
      try {
        const episodeWardrobe = require('../services/workflow/episodeWardrobe');
        const ep = db
          .prepare(`SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL`)
          .get(Number(req.params.episode_id));
        if (!ep) return response.notFound(res, '章节不存在');
        const out = episodeWardrobe.completeEpisodeWardrobe(db, ep.drama_id, ep.id, req.body || {});
        response.success(res, out);
      } catch (err) {
        handleReviewErr(res, err, 'wardrobe complete');
      }
    },
    scanWardrobeLooks: (req, res) => {
      try {
        const episodeWardrobe = require('../services/workflow/episodeWardrobe');
        const ep = db
          .prepare(`SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL`)
          .get(Number(req.params.episode_id));
        if (!ep) return response.notFound(res, '章节不存在');
        const out = episodeWardrobe.scanLooksFromScript(db, ep.drama_id, ep.id);
        response.success(res, out);
      } catch (err) {
        handleReviewErr(res, err, 'wardrobe scan-looks');
      }
    },
    proposeWardrobe: async (req, res) => {
      try {
        const { proposeEpisodeAssets } = require('../services/workflow/proposeEpisodeAssets');
        const out = await proposeEpisodeAssets(db, log, req.params.episode_id, req.body || {});
        response.success(res, out);
      } catch (err) {
        handleReviewErr(res, err, 'wardrobe propose');
      }
    },
  };
};
