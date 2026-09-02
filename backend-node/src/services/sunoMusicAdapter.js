/** Suno 音乐网关适配（与 huobao-drama suno-music 对齐，纯 JS） */

const SUNO_DEFAULT_MODEL = 'suno_music_open';

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

/** Suno 路由在网关根路径，不在 OpenAI /v1 命名空间；兼容复用图片网关 base_url（常含 /v1） */
function normalizeSunoBaseUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return base;
  return base.replace(/\/v1$/i, '');
}

function buildSunoSubmitRequest(config, body) {
  const base = normalizeSunoBaseUrl(config.base_url || config.baseUrl);
  const model = body.model || config.model || SUNO_DEFAULT_MODEL;
  const modelStr = Array.isArray(model) ? model[0] : model;
  const payload = {
    gpt_description_prompt: body.gpt_description_prompt,
    make_instrumental: body.make_instrumental ?? true,
  };
  if (String(modelStr).startsWith('chirp')) {
    payload.mv = modelStr;
  } else {
    payload.model = modelStr;
    payload.mv = 'chirp-v3-5';
  }
  if (body.prompt) payload.prompt = body.prompt;

  return {
    url: `${base}/suno/submit/music`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.api_key || config.apiKey || ''}`,
      'Content-Type': 'application/json',
    },
    body: payload,
  };
}

function buildSunoPollRequest(config, taskId) {
  const base = normalizeSunoBaseUrl(config.base_url || config.baseUrl);
  return {
    url: `${base}/suno/fetch/${encodeURIComponent(taskId)}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.api_key || config.apiKey || ''}`,
    },
  };
}

function parseSunoSubmitResponse(result) {
  const json = result || {};
  const raw = json.data ?? json;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();

  const data = typeof raw === 'object' && raw ? raw : {};
  let taskId = data.task_id || data.taskId || data.job_id || data.jobId || json.task_id || json.taskId;
  if (typeof taskId === 'object' && taskId) {
    taskId = taskId.task_id || taskId.taskId || taskId.jobId;
  }
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new Error('Suno 提交响应缺少 task_id');
  }
  return taskId.trim();
}

function pickAudioUrl(item) {
  const candidates = [
    item.audio_url,
    item.audioUrl,
    item.stream_audio_url,
    item.streamAudioUrl,
    item.source_audio_url,
    item.sourceAudioUrl,
    item.source_stream_audio_url,
    item.sourceStreamAudioUrl,
    item.cdn_url,
    item.cdnUrl,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.startsWith('http')) return value;
  }
  return null;
}

function findAudioUrlDeep(value, depth = 0) {
  if (depth > 5 || value == null) return null;
  if (typeof value === 'string') {
    if (value.startsWith('http') && /(\.mp3|\.m4a|\.wav|audio|cdn|suno)/i.test(value)) return value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudioUrlDeep(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const direct = pickAudioUrl(value);
    if (direct) return direct;
    for (const nested of Object.values(value)) {
      const found = findAudioUrlDeep(nested, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function normalizeTrack(item) {
  if (!item || typeof item !== 'object') return null;
  const audioUrl = pickAudioUrl(item) || findAudioUrlDeep(item);
  if (!audioUrl) return null;
  return {
    id: typeof item.id === 'string' ? item.id : undefined,
    title: typeof item.title === 'string' ? item.title : undefined,
    audioUrl,
    imageUrl: typeof item.image_url === 'string'
      ? item.image_url
      : typeof item.imageUrl === 'string'
        ? item.imageUrl
        : typeof item.image_large_url === 'string'
          ? item.image_large_url
          : undefined,
    duration: typeof item.duration === 'number' ? item.duration : undefined,
  };
}

function collectTracks(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload;
  const data = (root.data ?? root);
  const dataObj = typeof data === 'object' && data ? data : {};

  const buckets = [];
  if (Array.isArray(dataObj.items)) buckets.push(...dataObj.items);
  if (Array.isArray(dataObj.songs)) buckets.push(...dataObj.songs);
  if (Array.isArray(dataObj.clips)) buckets.push(...dataObj.clips);
  const nested = dataObj.data ?? dataObj.result ?? dataObj.output ?? dataObj;
  if (Array.isArray(nested)) buckets.push(...nested);
  if (Array.isArray(dataObj.data)) buckets.push(...dataObj.data);
  if (typeof nested === 'object' && nested && !Array.isArray(nested)) {
    if (Array.isArray(nested.items)) buckets.push(...nested.items);
    if (Array.isArray(nested.songs)) buckets.push(...nested.songs);
    if (Array.isArray(nested.clips)) buckets.push(...nested.clips);
  }

  const tracks = [];
  for (const item of buckets) {
    const track = normalizeTrack(item);
    if (track) tracks.push(track);
  }
  return tracks;
}

function parseSunoPollResponse(result) {
  const root = result || {};
  const data = (root.data ?? root) || {};
  const statusRaw = String(data.taskStatus || data.status || data.task_status || data.state || '').toUpperCase();

  if (['FAILURE', 'FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(statusRaw)) {
    const error = String(data.fail_reason || data.error || data.message || 'Suno generation failed');
    return { status: 'failed', tracks: [], error };
  }

  const tracks = collectTracks(result);
  const isFinished = ['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'COMPLETE', 'DONE', 'FINISHED'].includes(statusRaw);

  if (tracks.length > 0) {
    return { status: 'completed', tracks };
  }
  if (isFinished) {
    return { status: 'pending', tracks: [] };
  }
  return { status: 'pending', tracks: [] };
}

module.exports = {
  SUNO_DEFAULT_MODEL,
  normalizeSunoBaseUrl,
  buildSunoSubmitRequest,
  buildSunoPollRequest,
  parseSunoSubmitResponse,
  parseSunoPollResponse,
};
