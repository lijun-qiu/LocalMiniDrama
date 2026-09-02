import request from '@/utils/request'

export const sceneAPI = {
  get(sceneId) {
    return request.get(`/scenes/${sceneId}`)
  },
  list(dramaId) {
    return request.get(`/dramas/${dramaId}/scenes`)
  },
  generatePrompt(sceneId, model, style, mode) {
    return request.post(`/scenes/${sceneId}/generate-prompt`, { model, style, mode })
  },
  create(data) {
    return request.post('/scenes', data)
  },
  generateImage(data) {
    return request.post('/scenes/generate-image', data)
  },
  update(sceneId, data) {
    return request.put(`/scenes/${sceneId}`, data)
  },
  delete(sceneId, episodeId) {
    const q = episodeId != null ? `?episode_id=${encodeURIComponent(episodeId)}` : ''
    return request.delete(`/scenes/${sceneId}${q}`)
  },
  bindToEpisode(episodeId, sceneId) {
    return request.post(`/episodes/${episodeId}/scenes/${sceneId}/bind`)
  },
  addToLibrary(sceneId, body = {}) {
    return request.post(`/scenes/${sceneId}/add-to-library`, body)
  },
  addToMaterialLibrary(sceneId) {
    return request.post(`/scenes/${sceneId}/add-to-material-library`, {})
  },
  addToTeamLibrary(sceneId, body = {}) {
    return request.post(`/scenes/${sceneId}/add-to-team-library`, body)
  },
  extractFromImage(sceneId) {
    return request.post(`/scenes/${sceneId}/extract-from-image`, {})
  },
  /** 四宫格场景拆分为单格，供生视频参考（避免成片出现分格） */
  ensureVideoRef(sceneId) {
    return request.post(`/scenes/${sceneId}/ensure-video-ref`, {})
  },
  putRefImage(sceneId, refImagePath) {
    return request.put(`/scenes/${sceneId}`, { ref_image: refImagePath ?? null })
  },
  generateFourViewImage(sceneId, model, style) {
    return request.post(`/scenes/${sceneId}/generate-four-view-image`, { model, style })
  }
}
