const multer = require('multer');
const response = require('../response');
const {
  checkIndexTtsHealth,
  ensureIndexTtsReady,
  loadIndexTtsModel,
  unloadIndexTtsModel,
  isIndexTtsModelLoaded,
  getIndexTtsConfigSummary,
} = require('../services/indexTtsService');
const {
  listGptSovitsVoices,
  upsertGptSovitsVoice,
  deleteGptSovitsVoice,
  saveGptSovitsRefAudio,
  toGptSovitsVoiceRef,
  getGptSovitsConfigSummary,
} = require('../services/gptSovitsVoiceService');
const ttsService = require('../services/ttsService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function routes(db, log, cfg) {
  const storageBase = (() => {
    const raw = cfg?.storage?.local_path || './data/storage';
    const path = require('path');
    return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  })();

  return {
    indexttsHealth: async (req, res) => {
      try {
        const health = await checkIndexTtsHealth({ force: true });
        response.success(res, {
          ...health,
          loaded: isIndexTtsModelLoaded(),
          ...getIndexTtsConfigSummary(),
        });
      } catch (err) {
        log.warn('ai-voices indextts health', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    indexttsEnsure: async (req, res) => {
      try {
        const health = await ensureIndexTtsReady(log);
        response.success(res, { ...health, ...getIndexTtsConfigSummary(), started: true });
      } catch (err) {
        log.warn('ai-voices indextts ensure', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    indexttsLoad: async (req, res) => {
      try {
        const health = await loadIndexTtsModel(log);
        response.success(res, { ...health, ...getIndexTtsConfigSummary() });
      } catch (err) {
        log.warn('ai-voices indextts load', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    indexttsUnload: async (req, res) => {
      try {
        const result = await unloadIndexTtsModel(log);
        response.success(res, { ...result, ...getIndexTtsConfigSummary() });
      } catch (err) {
        log.warn('ai-voices indextts unload', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    listCloneVoices: async (req, res) => {
      try {
        const voices = listGptSovitsVoices();
        response.success(res, {
          voices: voices.map((v) => ({
            voice_id: toGptSovitsVoiceRef(v.voice_id),
            voice_name: v.voice_name,
            description: v.description || [],
            language: v.language || '中文',
            prompt_text: v.prompt_text || '',
            ref_audio_path: v.ref_audio_path,
          })),
          voice_count: voices.length,
          ...getGptSovitsConfigSummary(),
        });
      } catch (err) {
        response.internalError(res, err.message);
      }
    },

    saveCloneVoice: async (req, res) => {
      try {
        const body = req.body || {};
        const voice = upsertGptSovitsVoice({
          voice_id: String(body.voice_id || body.voiceId || '').trim(),
          voice_name: String(body.voice_name || body.voiceName || '').trim(),
          ref_audio_path: String(body.ref_audio_path || body.refAudioPath || '').trim(),
          prompt_text: String(body.prompt_text || body.promptText || '').trim(),
          prompt_lang: String(body.prompt_lang || body.promptLang || 'zh').trim(),
          language: String(body.language || '中文').trim(),
          description: Array.isArray(body.description) ? body.description : [],
        });
        response.success(res, { ...voice, voice_id: toGptSovitsVoiceRef(voice.voice_id) });
      } catch (err) {
        response.badRequest(res, err.message);
      }
    },

    deleteCloneVoice: async (req, res) => {
      try {
        const ok = deleteGptSovitsVoice(req.params.id);
        if (!ok) return response.badRequest(res, '音色不存在');
        response.success(res, { deleted: true, voice_id: req.params.id });
      } catch (err) {
        response.internalError(res, err.message);
      }
    },

    uploadRef: [
      upload.single('file'),
      async (req, res) => {
        try {
          if (!req.file?.buffer) return response.badRequest(res, 'file 必填');
          const absPath = saveGptSovitsRefAudio(req.file.buffer, req.file.originalname || 'ref.wav');
          response.success(res, { ref_audio_path: absPath, file_name: req.file.originalname });
        } catch (err) {
          response.badRequest(res, err.message);
        }
      },
    ],

    preview: async (req, res) => {
      try {
        const body = req.body || {};
        const text = String(body.text || '这是一段旁白试听，用于感受当前音色和感情效果。').trim();
        const voiceId = String(body.local_voice || body.voice_id || 'gsv:008').trim();
        const emotionText = String(body.voicebox_instruct || body.emotion_text || '自然流畅的解说语气，情绪饱满').trim();
        const synth = await ttsService.synthesize(db, log, {
          text,
          storyboard_id: null,
          storage_base: storageBase,
          provider: 'indextts',
          voice_id: voiceId,
          emotion_text: emotionText,
          auto_load_indextts: true,
        });
        response.success(res, { local_path: synth.local_path, audio_url: `/static/${synth.local_path}` });
      } catch (err) {
        response.badRequest(res, err.message);
      }
    },
  };
}

module.exports = routes;
