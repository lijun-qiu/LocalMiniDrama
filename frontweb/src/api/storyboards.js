import request from '@/utils/request'

/**
 * @param {string} url
 * @param {object} body
 * @param {(delta: string) => void} [onDelta]
 * @returns {Promise<{ universal_segment_text: string }>}
 */
function postStoryboardNdjsonStream(url, body, onDelta, doneField = 'universal_segment_text') {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify(body || {}),
  }).then(async (res) => {
    if (!res.ok) {
      let msg = `请求失败 (${res.status})`
      try {
        const j = await res.json()
        if (j?.error?.message) msg = j.error.message
        else if (j?.message) msg = j.message
      } catch (_) {
        try {
          const t = await res.text()
          if (t) msg = t.slice(0, 200)
        } catch (_) {}
      }
      throw new Error(msg)
    }
    const reader = res.body && res.body.getReader()
    if (!reader) throw new Error('浏览器不支持流式读取')
    const dec = new TextDecoder()
    let buf = ''
    let finalText = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let obj
        try {
          obj = JSON.parse(line)
        } catch (_) {
          continue
        }
        if (obj.type === 'delta' && obj.text && typeof onDelta === 'function') onDelta(String(obj.text))
        if (obj.type === 'error') throw new Error(obj.message || '请求失败')
        if (obj.type === 'done') {
          const v = obj[doneField]
          finalText = (v != null && String(v).trim()) || ''
        }
      }
    }
    const tail = buf.trim()
    if (tail) {
      try {
        const obj = JSON.parse(tail)
        if (obj.type === 'error') throw new Error(obj.message || '请求失败')
        if (obj.type === 'done') {
          const v = obj[doneField]
          finalText = (v != null && String(v).trim()) || finalText
        }
      } catch (e) {
        if (e instanceof Error && e.message && !e.message.includes('JSON')) throw e
      }
    }
    return { [doneField]: finalText }
  })
}

/** @deprecated use postStoryboardNdjsonStream */
function postUniversalSegmentNdjsonStream(url, body, onDelta) {
  return postStoryboardNdjsonStream(url, body, onDelta, 'universal_segment_text')
}

export const storyboardsAPI = {
  get(id) {
    return request.get(`/storyboards/${id}`)
  },
  create(data) {
    return request.post('/storyboards', data)
  },
  update(id, data) {
    return request.put(`/storyboards/${id}`, data)
  },
  delete(id) {
    return request.delete(`/storyboards/${id}`)
  },
  generateFramePrompt(id, data) {
    return request.post(`/storyboards/${id}/frame-prompt`, data)
  },
  getFramePrompts(id) {
    return request.get(`/storyboards/${id}/frame-prompts`)
  },
  /** 保存/覆盖首帧或尾帧提示词（用于用户手动编辑后保存） */
  saveFramePrompt(id, frameType, data) {
    return request.put(`/storyboards/${id}/frame-prompts/${frameType}`, data || {})
  },
  polishPrompt(id, body = {}) {
    return request.post(`/storyboards/${id}/polish-prompt`, body)
  },
  /** 全能模式：根据分镜内容 AI 生成片段描述（非流式，兼容旧调用） */
  generateUniversalSegmentPrompt(id, body = {}) {
    return request.post(`/storyboards/${id}/universal-segment-prompt`, body)
  },
  /** 全能模式生成：NDJSON 流式，可选 body.duration、body.force_without_reference_images */
  generateUniversalSegmentPromptStream(id, body, onDelta) {
    return postUniversalSegmentNdjsonStream(
      `/api/v1/storyboards/${id}/universal-segment-prompt-stream`,
      body,
      onDelta
    )
  },
  /**
   * 流式润色全能片段：NDJSON 行 {type:'delta',text} / {type:'done',universal_segment_text} / {type:'error',message}
   * body.draft_universal_segment_text 为当前编辑区全文；可选 duration、force_without_reference_images
   */
  polishUniversalSegmentPromptStream(id, body, onDelta) {
    return postStoryboardNdjsonStream(
      `/api/v1/storyboards/${id}/universal-segment-polish-stream`,
      body,
      onDelta,
      'universal_segment_text'
    )
  },
  /** 经典模式：流式 AI 润色 video_prompt（含可选 user_instruction / draft_video_prompt） */
  polishClassicVideoPromptStream(id, body, onDelta) {
    return postStoryboardNdjsonStream(
      `/api/v1/storyboards/${id}/classic-video-prompt-polish-stream`,
      body,
      onDelta,
      'video_prompt'
    )
  },
  insertBefore(id) {
    return request.post(`/storyboards/${id}/insert-before`, {})
  },
  batchInferParams(episodeId, overwrite = false) {
    return request.post('/storyboards/batch-infer-params', { episode_id: episodeId, overwrite })
  },
  upscale(id) {
    return request.post(`/storyboards/${id}/upscale`, {})
  },
  /** 尾帧衔接：提取当前分镜视频最后一帧，设为下一个分镜的首帧 */
  linkTailFrame(id, data) {
    return request.post(`/storyboards/${id}/link-tail-frame`, data || {})
  },
  /** 一键 AI 重新生成/优化本分镜的 layout_description（空间布局合同），自动参考上下分镜 */
  regenerateLayoutDescription(id) {
    return request.post(`/storyboards/${id}/regenerate-layout-description`, {})
  },
  /** 按后端最新规则重建单镜 video_prompt（含音色锚点，不调用 AI） */
  rebuildVideoPrompt(id) {
    return request.post(`/storyboards/${id}/rebuild-video-prompt`, {})
  },
  /** 按对白/旁白拆成多条分镜（每条仅一人说话或仅画外旁白） */
  splitByAudio(id) {
    return request.post(`/storyboards/${id}/split-by-audio`, {})
  },
  /** 全文解说模式：按剧本正文重新切分并写回各镜 narration（不调 AI） */
  resyncFullNarration(episodeId) {
    return request.post(`/episodes/${episodeId}/resync-full-narration`, {})
  },
  /** 补全本集缺失的生图提示词（polished_prompt，跳过已有） */
  completeMissingImagePrompts(episodeId) {
    return request.post(`/episodes/${episodeId}/complete-missing-image-prompts`, {})
  },
  /** 补全本集缺失的视频提示词 */
  completeMissingVideoPrompts(episodeId) {
    return request.post(`/episodes/${episodeId}/complete-missing-video-prompts`, {})
  },
  /** 全文解说：按旁白配音时长刷新 duration 并 AI 生成生图+视频提示词 */
  generatePromptsFromAudioDuration(episodeId, body = {}) {
    return request.post(`/episodes/${episodeId}/generate-prompts-from-audio`, body)
  },
}
