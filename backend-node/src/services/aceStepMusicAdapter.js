/**
 * ACE-Step 1.5 本地配乐 — OpenRouter 兼容 API（默认 http://127.0.0.1:8001）
 * 与 huobao-drama adapters/ace-step-music.ts 对齐
 */

const ACE_STEP_DEFAULT_MODEL = 'ace_step_local';
const ACE_STEP_API_MODEL = 'acemusic/acestep-v15-turbo';
const ACE_STEP_LM_MODEL = process.env.ACE_STEP_LM_MODEL || 'acestep-5Hz-lm-0.6B';

function aceStepBaseUrl() {
  return String(process.env.ACE_STEP_BASE_URL || 'http://127.0.0.1:8001').replace(/\/+$/, '');
}

function isAceStepMusicModel(model) {
  const m = String(model || '').toLowerCase();
  return m === ACE_STEP_DEFAULT_MODEL
    || m === 'acestep-v15-turbo'
    || m === 'acestep'
    || m.startsWith('acemusic/acestep');
}

async function checkAceStepHealth(timeoutMs = 5000) {
  try {
    const resp = await fetch(`${aceStepBaseUrl()}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return { ok: false, error: `ACE-Step health ${resp.status}` };
    const json = await resp.json().catch(() => ({}));
    const data = json?.data || json;
    return {
      ok: true,
      modelsInitialized: Boolean(data?.models_initialized),
    };
  } catch (err) {
    return { ok: false, error: err.message || 'ACE-Step 未启动' };
  }
}

/** lazy-start 时需先 /v1/init，否则 /v1/chat/completions 会 503 */
async function ensureAceStepInitialized(timeoutMs = 600000) {
  const health = await checkAceStepHealth();
  if (!health.ok) {
    throw new Error(health.error || 'ACE-Step 未启动，请运行 scripts/start-ace-step.ps1');
  }
  if (health.modelsInitialized) return;

  const resp = await fetch(`${aceStepBaseUrl()}/v1/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'acestep-v15-turbo',
      init_llm: true,
      lm_model_path: ACE_STEP_LM_MODEL,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`ACE-Step init 返回非 JSON: ${text.slice(0, 200)}`);
  }
  if (!resp.ok || (json?.code != null && Number(json.code) >= 400)) {
    throw new Error(String(json?.error || json?.detail || json?.data?.message || `ACE-Step init ${resp.status}`));
  }
}

function extractAceStepAudioUrl(json) {
  const msg = json?.choices?.[0]?.message;
  const candidates = [
    msg?.audio?.[0]?.audio_url?.url,
    msg?.audio?.[0]?.url,
    msg?.audios?.[0]?.url,
    msg?.audio?.[0]?.audio_url,
    json?.audio?.[0]?.url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.includes('base64,')) return c;
  }
  return undefined;
}

/** 调用本地 ACE-Step 生成纯器乐 BGM，返回 data:audio/...;base64,... */
async function generateAceStepMusic(input) {
  await ensureAceStepInitialized();

  const caption = String(input.prompt || '').trim();
  if (!caption) throw new Error('ACE-Step 生成需要音乐描述（prompt）');

  // BGM 默认 ≥15s；Foley 短音可降至 5s（再由调用方 ffmpeg 裁剪）
  const minDur = Math.max(5, Number(input.minDurationSec) || 15);
  const duration = Math.max(minDur, Math.min(180, Number(input.durationSec) || 60));
  const instrumental = input.instrumental !== false;
  const lyrics = instrumental ? '[Instrumental]' : '';
  const body = {
    model: ACE_STEP_API_MODEL,
    stream: false,
    thinking: false,
    use_format: false,
    use_cot_caption: true,
    use_cot_language: false,
    batch_size: 1,
    task_type: 'text2music',
    lyrics,
    messages: [
      {
        role: 'user',
        content: instrumental
          ? `<prompt>${caption}</prompt>\n<lyrics>[Instrumental]</lyrics>`
          : caption,
      },
    ],
    audio_config: {
      duration,
      instrumental: true,
      format: 'mp3',
      vocal_language: 'zh',
      ...(input.bpm ? { bpm: input.bpm } : {}),
    },
  };

  const timeoutMs = Math.max(120000, Number(input.timeoutMs) || 600000);
  const resp = await fetch(`${aceStepBaseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`ACE-Step 返回非 JSON: ${text.slice(0, 200)}`);
  }
  if (!resp.ok) {
    throw new Error(String(json?.error?.message || json?.detail || `ACE-Step ${resp.status}: ${text.slice(0, 240)}`));
  }

  const audioUrl = extractAceStepAudioUrl(json);
  if (!audioUrl) {
    throw new Error('ACE-Step 未返回音频 data URL');
  }

  return {
    audioDataUrl: audioUrl,
    content: typeof json?.choices?.[0]?.message?.content === 'string'
      ? json.choices[0].message.content
      : undefined,
  };
}

module.exports = {
  ACE_STEP_DEFAULT_MODEL,
  ACE_STEP_API_MODEL,
  aceStepBaseUrl,
  isAceStepMusicModel,
  checkAceStepHealth,
  ensureAceStepInitialized,
  generateAceStepMusic,
};
