import request from '@/utils/request'

export const aiVoicesAPI = {
  indexttsHealth() {
    return request.get('/ai-voices/indextts/health')
  },
  indexttsEnsure() {
    return request.post('/ai-voices/indextts/ensure')
  },
  indexttsLoad() {
    return request.post('/ai-voices/indextts/load')
  },
  indexttsUnload() {
    return request.post('/ai-voices/indextts/unload')
  },
  listCloneVoices() {
    return request.get('/ai-voices/clone/voices')
  },
  saveCloneVoice(data) {
    return request.post('/ai-voices/clone/voices', data)
  },
  deleteCloneVoice(id) {
    return request.delete(`/ai-voices/clone/voices/${encodeURIComponent(id)}`)
  },
  uploadRef(file) {
    const form = new FormData()
    form.append('file', file)
    return request.post('/ai-voices/clone/upload-ref', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  preview(data) {
    return request.post('/ai-voices/preview', data)
  },
}
