/**
 * 克隆音色库（IndexTTS / GPT-SoVITS 共用参考音 catalog）
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const GSV_VOICE_PREFIX = 'gsv:';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const GPT_SOVITS_REF_ROOT = process.env.GPT_SOVITS_REF_ROOT
  || path.join(PROJECT_ROOT, 'data', 'gptsovits-refs');
const GPT_SOVITS_VOICES_FILE = process.env.GPT_SOVITS_VOICES_FILE
  || path.join(PROJECT_ROOT, 'data', 'gptsovits', 'voices.json');

function ensureVoiceCatalogFile() {
  const dir = path.dirname(GPT_SOVITS_VOICES_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(GPT_SOVITS_REF_ROOT, { recursive: true });
  if (!fs.existsSync(GPT_SOVITS_VOICES_FILE)) {
    fs.writeFileSync(GPT_SOVITS_VOICES_FILE, JSON.stringify({ voices: [] }, null, 2), 'utf8');
  }
}

function readVoiceCatalog() {
  ensureVoiceCatalogFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(GPT_SOVITS_VOICES_FILE, 'utf8'));
    return { voices: Array.isArray(parsed.voices) ? parsed.voices : [] };
  } catch (_) {
    return { voices: [] };
  }
}

function writeVoiceCatalog(catalog) {
  ensureVoiceCatalogFile();
  fs.writeFileSync(GPT_SOVITS_VOICES_FILE, JSON.stringify(catalog, null, 2), 'utf8');
}

function parseGptSovitsVoiceRef(voiceId) {
  const raw = String(voiceId || '').trim();
  if (!raw.startsWith(GSV_VOICE_PREFIX)) return null;
  const id = raw.slice(GSV_VOICE_PREFIX.length).trim();
  return id || null;
}

function toGptSovitsVoiceRef(voiceId) {
  const id = String(voiceId || '').trim();
  if (!id) throw new Error('音色 ID 为空');
  return id.startsWith(GSV_VOICE_PREFIX) ? id : `${GSV_VOICE_PREFIX}${id}`;
}

function resolveGptSovitsRefAudioPath(refPath) {
  const raw = String(refPath || '').trim();
  if (!raw) throw new Error('参考音频路径为空');
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(GPT_SOVITS_REF_ROOT, raw);
}

function listGptSovitsVoices() {
  return readVoiceCatalog().voices;
}

function getGptSovitsVoice(voiceId) {
  const id = parseGptSovitsVoiceRef(voiceId) || String(voiceId || '').trim();
  if (!id) return null;
  return readVoiceCatalog().voices.find((v) => v.voice_id === id) || null;
}

function upsertGptSovitsVoice(input) {
  const voiceId = String(input.voice_id || '').trim().replace(/^gsv:/i, '');
  if (!voiceId) throw new Error('voice_id 不能为空');
  const refAudio = String(input.ref_audio_path || '').trim();
  if (!refAudio) throw new Error('ref_audio_path 不能为空');

  const voice = {
    voice_id: voiceId,
    voice_name: String(input.voice_name || voiceId).trim() || voiceId,
    ref_audio_path: refAudio,
    prompt_text: String(input.prompt_text || '').trim(),
    prompt_lang: String(input.prompt_lang || 'zh').trim() || 'zh',
    language: String(input.language || '中文').trim() || '中文',
    description: Array.isArray(input.description) ? input.description : [],
  };

  const catalog = readVoiceCatalog();
  const idx = catalog.voices.findIndex((v) => v.voice_id === voiceId);
  if (idx >= 0) catalog.voices[idx] = { ...catalog.voices[idx], ...voice };
  else catalog.voices.push(voice);
  writeVoiceCatalog(catalog);
  return voice;
}

function deleteGptSovitsVoice(voiceId) {
  const id = parseGptSovitsVoiceRef(voiceId) || String(voiceId || '').trim();
  const catalog = readVoiceCatalog();
  const next = catalog.voices.filter((v) => v.voice_id !== id);
  if (next.length === catalog.voices.length) return false;
  writeVoiceCatalog({ voices: next });
  return true;
}

function saveGptSovitsRefAudio(buffer, fileName) {
  ensureVoiceCatalogFile();
  const safeName = String(fileName || 'ref.wav').replace(/[^\w.\-()\u4e00-\u9fff]/g, '_');
  const ext = path.extname(safeName).toLowerCase();
  if (!['.wav', '.mp3', '.flac', '.ogg', '.m4a'].includes(ext)) {
    throw new Error('参考音频仅支持 wav / mp3 / flac / ogg / m4a');
  }
  const filename = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  const abs = path.join(GPT_SOVITS_REF_ROOT, filename);
  fs.writeFileSync(abs, buffer);
  return abs;
}

function resolveGptSovitsVoiceId(voiceId) {
  const raw = String(voiceId || '').trim();
  const id = parseGptSovitsVoiceRef(raw) || raw;
  if (!id) throw new Error('未选择克隆音色');
  const voice = getGptSovitsVoice(id);
  if (!voice) throw new Error(`克隆音色不存在：${id}`);
  return id;
}

function getGptSovitsConfigSummary() {
  return {
    ref_root: GPT_SOVITS_REF_ROOT,
    voices_file: GPT_SOVITS_VOICES_FILE,
  };
}

module.exports = {
  GSV_VOICE_PREFIX,
  parseGptSovitsVoiceRef,
  toGptSovitsVoiceRef,
  resolveGptSovitsRefAudioPath,
  listGptSovitsVoices,
  getGptSovitsVoice,
  upsertGptSovitsVoice,
  deleteGptSovitsVoice,
  saveGptSovitsRefAudio,
  resolveGptSovitsVoiceId,
  getGptSovitsConfigSummary,
};
