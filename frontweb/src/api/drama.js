import request from '@/utils/request'

export const dramaAPI = {
  list(params) {
    return request.get('/dramas', { params: params || {} })
  },
  create(data) {
    return request.post('/dramas', data)
  },
  get(id) {
    return request.get(`/dramas/${id}`)
  },
  update(id, data) {
    return request.put(`/dramas/${id}`, data)
  },
  delete(id) {
    return request.delete(`/dramas/${id}`)
  },
  saveEpisodes(id, episodes) {
    return request.put(`/dramas/${id}/episodes`, { episodes })
  },
  saveCharacters(id, data) {
    return request.put(`/dramas/${id}/characters`, data)
  },
  /** 保存梗概/故事摘要到项目（outline），body: { summary, title?, genre?, tags? } */
  saveOutline(id, data) {
    return request.put(`/dramas/${id}/outline`, data)
  },
  saveProgress(id, data) {
    return request.put(`/dramas/${id}/progress`, data)
  },
  saveCanvasLayout(id, canvasLayout, workflowGroups) {
    const body = {}
    if (canvasLayout != null) body.canvas_layout = canvasLayout
    if (workflowGroups !== undefined) body.workflow_groups = workflowGroups
    return request.put(`/dramas/${id}/canvas-layout`, body)
  },
  getStoryboards(episodeId) {
    return request.get(`/episodes/${episodeId}/storyboards`)
  },
  generateStoryboard(episodeId, options) {
    // 兼容旧调用方式: generateStoryboard(episodeId, model, style)
    let body = {};
    if (arguments.length > 2 || typeof options === 'string') {
       body.model = arguments[1];
       body.style = arguments[2];
    } else {
       body = options || {};
    }
    return request.post(`/episodes/${episodeId}/storyboards`, body)
  },
  finalizeEpisode(episodeId, data) {
    return request.post(`/episodes/${episodeId}/finalize`, data || {})
  },
  /** 本集片头分镜 */
  getIntroStoryboard(episodeId) {
    return request.get(`/episodes/${episodeId}/intro-storyboard`)
  },
  upsertIntroStoryboard(episodeId, data) {
    return request.put(`/episodes/${episodeId}/intro-storyboard`, data || {})
  },
  generateIntroPrompts(episodeId, data) {
    return request.post(`/episodes/${episodeId}/intro-storyboard/generate-prompts`, data || {})
  },
  /** AI 生成 BGM/音效描述 */
  suggestBgmDescription(episodeId, data) {
    return request.post(`/episodes/${episodeId}/bgm/suggest-description`, data || {})
  },
  /** 生成整集 BGM */
  generateBgm(episodeId, data) {
    return request.post(`/episodes/${episodeId}/bgm/generate`, data || {})
  },
  /** 本集 BGM/音效库 */
  listBgm(episodeId, params) {
    return request.get(`/episodes/${episodeId}/bgm`, { params: params || {} })
  },
  /** 选用某条 BGM/音效 */
  applyBgm(episodeId, musicId, data) {
    return request.post(`/episodes/${episodeId}/bgm/${musicId}/apply`, data || {})
  },
  /** 将 BGM 混入已有合成视频（保留原片，另出带 BGM 成片） */
  mixBgmToVideo(episodeId, data) {
    return request.post(`/episodes/${episodeId}/bgm/mix-to-video`, data || {})
  },
  aceStepHealth() {
    return request.get('/bgm/ace-step/health')
  },
  aceStepStart() {
    return request.post('/bgm/ace-step/start')
  },
  aceStepUnload() {
    return request.post('/bgm/ace-step/unload')
  },
  getFoley(episodeId) {
    return request.get(`/episodes/${episodeId}/foley`)
  },
  analyzeFoley(episodeId, data) {
    return request.post(`/episodes/${episodeId}/foley/analyze`, data || {})
  },
  generateFoley(episodeId, data) {
    return request.post(`/episodes/${episodeId}/foley/generate`, data || {})
  },
  mixFoleyToVideo(episodeId, data) {
    return request.post(`/episodes/${episodeId}/foley/mix-to-video`, data || {})
  },
  /** 清空本集除剧本正文外的全部生成内容 */
  clearEpisodeGenerated(episodeId) {
    return request.post(`/episodes/${episodeId}/clear-generated`)
  },
  /** 按类型清除本集媒体/提示词：kind = narration_audio | images | videos | prompts */
  clearEpisodeMedia(episodeId, kind) {
    return request.post(`/episodes/${episodeId}/clear-media`, { kind })
  },
  extractBackgrounds(episodeId, body) {
    return request.post(`/images/episode/${episodeId}/backgrounds/extract`, body || {})
  },
  extractEpisodeCharacters(episodeId) {
    return request.post(`/episodes/${episodeId}/characters/extract`)
  },
  exportDrama(id) {
    return request.get(`/dramas/${id}/export`, { responseType: 'blob' })
  },
  importDrama(file) {
    const form = new FormData()
    form.append('file', file)
    return request.post('/dramas/import', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  listExamples() {
    return request.get('/dramas/examples')
  },
  importExample(filename) {
    return request.post('/dramas/import-example', { filename })
  }
}
