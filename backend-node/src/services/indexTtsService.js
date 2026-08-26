/**
 * IndexTTS2 本地情感配音（CLI 子进程）
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const {
  GSV_VOICE_PREFIX,
  resolveGptSovitsRefAudioPath,
  getGptSovitsVoice,
  resolveGptSovitsVoiceId,
} = require('./gptSovitsVoiceService');

const IDX_VOICE_PREFIX = 'idx:';

const INDEX_TTS_ROOT = process.env.INDEX_TTS_ROOT || 'C:\\my\\index-tts\\index-tts';
const INDEX_TTS_MODEL_DIR = process.env.INDEX_TTS_MODEL_DIR || path.join(INDEX_TTS_ROOT, 'checkpoints');
const INDEX_TTS_PYTHON = process.env.INDEX_TTS_PYTHON || path.join(INDEX_TTS_ROOT, '.venv', 'Scripts', 'python.exe');
const INDEX_TTS_TIMEOUT_MS = Number(process.env.INDEX_TTS_TIMEOUT_MS || 600000);
const INDEX_TTS_FP16 = process.env.INDEX_TTS_FP16 !== 'false';
const INDEX_TTS_DEVICE = process.env.INDEX_TTS_DEVICE || 'cuda';
const INDEX_TTS_HEALTH_CACHE_MS = Number(process.env.INDEX_TTS_HEALTH_CACHE_MS || 300000);
const INDEX_TTS_DOWNLOAD_TIMEOUT_MS = Number(process.env.INDEX_TTS_DOWNLOAD_TIMEOUT_MS || 1800000);
const INDEX_TTS_REQUIRED_MODEL_FILES = ['gpt.pth', 's2mel.pth', 'config.yaml'];

let cachedHealth = null;
let cachedHealthAt = 0;
let ensurePromise = null;

function listMissingIndexTtsModelFiles(modelDir = INDEX_TTS_MODEL_DIR) {
  return INDEX_TTS_REQUIRED_MODEL_FILES.filter((f) => !fs.existsSync(path.join(modelDir, f)));
}

function checkIndexTtsHealthFilesystem() {
  const modelDir = INDEX_TTS_MODEL_DIR;
  if (!fs.existsSync(path.join(INDEX_TTS_ROOT, 'pyproject.toml'))) {
    return { ok: false, error: `IndexTTS2 未安装：${INDEX_TTS_ROOT}` };
  }
  const missing = listMissingIndexTtsModelFiles(modelDir);
  if (missing.length) {
    return { ok: false, model_dir: modelDir, error: `缺少模型文件：${missing[0]}`, missing_models: missing };
  }
  return { ok: true, model_dir: modelDir, root: INDEX_TTS_ROOT, detail: 'filesystem-check' };
}

function invalidateIndexTtsHealthCache() {
  cachedHealth = null;
  cachedHealthAt = 0;
}

function runIndexTtsCli(args, timeoutMs = INDEX_TTS_TIMEOUT_MS) {
  const python = fs.existsSync(INDEX_TTS_PYTHON) ? INDEX_TTS_PYTHON : 'python';
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-m', 'indextts.cli_v2', ...args], {
      cwd: INDEX_TTS_ROOT,
      env: {
        ...process.env,
        HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
        HF_HUB_CACHE: path.join(INDEX_TTS_MODEL_DIR, 'hf_cache'),
      },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`IndexTTS2 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function checkIndexTtsHealthFull() {
  const fsHealth = checkIndexTtsHealthFilesystem();
  if (!fsHealth.ok) return fsHealth;
  try {
    const result = await runIndexTtsCli(['check', '--model-dir', INDEX_TTS_MODEL_DIR, '--device', INDEX_TTS_DEVICE], 120000);
    const text = `${result.stdout}\n${result.stderr}`;
    const cuda = /cuda:\s*available/i.test(text);
    if (result.code === 0) {
      return { ok: true, model_dir: INDEX_TTS_MODEL_DIR, root: INDEX_TTS_ROOT, cuda, detail: result.stdout.trim() };
    }
    return {
      ok: false,
      model_dir: INDEX_TTS_MODEL_DIR,
      root: INDEX_TTS_ROOT,
      cuda,
      error: 'IndexTTS2 check 失败',
      detail: text.trim().slice(-2000),
    };
  } catch (err) {
    return { ok: false, model_dir: INDEX_TTS_MODEL_DIR, root: INDEX_TTS_ROOT, error: err.message };
  }
}

async function checkIndexTtsHealth(options = {}) {
  const force = options.force === true;
  if (!force && cachedHealth && Date.now() - cachedHealthAt < INDEX_TTS_HEALTH_CACHE_MS) {
    return { ...cachedHealth, cached: true };
  }
  const health = await checkIndexTtsHealthFull();
  cachedHealth = { ...health };
  cachedHealthAt = Date.now();
  return health;
}

/**
 * 试听/配音前确保 IndexTTS2 可用：缺模型则自动 init + download，再执行完整健康检查。
 */
async function ensureIndexTtsReady(log) {
  if (ensurePromise) return ensurePromise;
  ensurePromise = ensureIndexTtsReadyInner(log).finally(() => {
    ensurePromise = null;
  });
  return ensurePromise;
}

async function ensureIndexTtsReadyInner(log) {
  const cached = await checkIndexTtsHealth({ force: false });
  if (cached.ok) return cached;

  const fsHealth = checkIndexTtsHealthFilesystem();
  if (fsHealth.error?.includes('未安装')) {
    throw new Error(fsHealth.error);
  }

  const missing = listMissingIndexTtsModelFiles();
  if (missing.length) {
    log?.info?.('[IndexTTS] 模型未就绪，正在自动初始化并下载…', { missing });
    const initResult = await runIndexTtsCli(['init', '--model-dir', INDEX_TTS_MODEL_DIR], 120000);
    if (initResult.code !== 0) {
      const detail = `${initResult.stderr}\n${initResult.stdout}`.trim().slice(-2000);
      throw new Error(detail || 'IndexTTS2 初始化失败');
    }
    const downloadResult = await runIndexTtsCli(
      ['download', '--model-dir', INDEX_TTS_MODEL_DIR],
      INDEX_TTS_DOWNLOAD_TIMEOUT_MS,
    );
    if (downloadResult.code !== 0) {
      const detail = `${downloadResult.stderr}\n${downloadResult.stdout}`.trim().slice(-2000);
      throw new Error(detail || 'IndexTTS2 模型下载失败');
    }
    invalidateIndexTtsHealthCache();
  }

  log?.info?.('[IndexTTS] 正在检查运行环境…');
  const health = await checkIndexTtsHealth({ force: true });
  if (!health.ok) {
    throw new Error(health.error || health.detail || 'IndexTTS2 启动失败，请检查 INDEX_TTS_ROOT 与 CUDA 环境');
  }
  log?.info?.('[IndexTTS] 已就绪', { cuda: health.cuda, model_dir: health.model_dir });
  return health;
}

async function resolveVoiceRefPathAsync(voiceId) {
  const raw = String(voiceId || '').trim();
  if (!raw) throw new Error('IndexTTS2 参考音为空');

  if (raw.startsWith(IDX_VOICE_PREFIX)) {
    const rel = raw.slice(IDX_VOICE_PREFIX.length);
    const abs = path.isAbsolute(rel) ? rel : resolveGptSovitsRefAudioPath(rel);
    if (!fs.existsSync(abs)) throw new Error(`IndexTTS2 参考音不存在：${abs}`);
    return abs;
  }

  const gsvId = raw.startsWith(GSV_VOICE_PREFIX) ? raw : `${GSV_VOICE_PREFIX}${raw}`;
  const resolvedId = resolveGptSovitsVoiceId(gsvId);
  const voice = getGptSovitsVoice(resolvedId);
  if (!voice?.ref_audio_path) throw new Error(`IndexTTS2 音色不存在：${resolvedId}`);
  const abs = resolveGptSovitsRefAudioPath(voice.ref_audio_path);
  if (!fs.existsSync(abs)) throw new Error(`IndexTTS2 参考音不存在：${abs}`);
  return abs;
}

function getIndexTtsConfigSummary() {
  return {
    root: INDEX_TTS_ROOT,
    model_dir: INDEX_TTS_MODEL_DIR,
    python: INDEX_TTS_PYTHON,
    fp16: INDEX_TTS_FP16,
    device: INDEX_TTS_DEVICE,
  };
}

/**
 * @returns {Promise<{ absPath: string, local_path: string }>}
 */
async function generateIndexTtsTTS(text, voiceId, options = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('配音文本为空');

  await ensureIndexTtsReady(options.log);

  const voicePath = await resolveVoiceRefPathAsync(voiceId);
  const emotionText = String(options.emotionText || '自然流畅的解说语气，情绪饱满').trim();
  const emotionWeight = Math.min(1.5, Math.max(0.1, Number(options.emotionWeight) || 0.65));
  const storageBase = options.storage_base;
  if (!storageBase) throw new Error('storage_base 不能为空');

  const audioDir = path.join(storageBase, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const filename = `indextts_${randomUUID().slice(0, 8)}.wav`;
  const outputAbs = path.join(audioDir, filename);

  const args = [
    'synth',
    '--model-dir', INDEX_TTS_MODEL_DIR,
    '--text', trimmed,
    '--voice', voicePath,
    '--emotion-text', emotionText,
    '--emotion-weight', String(emotionWeight),
    '--output', outputAbs,
    '--force',
    '--device', INDEX_TTS_DEVICE,
  ];
  if (INDEX_TTS_FP16) args.push('--fp16');

  const result = await runIndexTtsCli(args);
  if (result.code !== 0 || !fs.existsSync(outputAbs) || fs.statSync(outputAbs).size < 44) {
    const detail = `${result.stderr}\n${result.stdout}`.trim().slice(-2000);
    throw new Error(detail || 'IndexTTS2 合成失败');
  }

  return {
    absPath: outputAbs,
    local_path: `audio/${filename}`,
  };
}

module.exports = {
  IDX_VOICE_PREFIX,
  checkIndexTtsHealth,
  ensureIndexTtsReady,
  getIndexTtsConfigSummary,
  generateIndexTtsTTS,
  resolveVoiceRefPathAsync,
};
