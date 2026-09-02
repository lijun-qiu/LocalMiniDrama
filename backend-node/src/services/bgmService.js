/**
 * 整集 BGM / 音效生成，并混入已有合成视频（保留原 video_url，另写 bgm_video_url）。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const storageLayout = require('./storageLayout');
const taskService = require('./taskService');
const aiClient = require('./aiClient');
const {
  SUNO_DEFAULT_MODEL,
  buildSunoSubmitRequest,
  buildSunoPollRequest,
  parseSunoSubmitResponse,
  parseSunoPollResponse,
} = require('./sunoMusicAdapter');
const {
  ACE_STEP_DEFAULT_MODEL,
  checkAceStepHealth,
  generateAceStepMusic,
  isAceStepMusicModel,
} = require('./aceStepMusicAdapter');
const {
  buildBgmPrompt,
  loadEpisodeContext,
  suggestBgmDescription,
} = require('./bgmPromptService');

const BGM_VOICE_MIX_VOLUME = 0.12;
const SFX_MIX_VOLUME = 0.14;
const SUNO_POLL_INTERVAL_MS = 4000;
const SUNO_POLL_MAX_MS = 8 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function resolveStorageRoot(cfg) {
  const loadConfig = require('../config').loadConfig;
  const c = (cfg && cfg.storage) ? cfg : loadConfig();
  return path.isAbsolute(c.storage?.local_path)
    ? c.storage.local_path
    : path.join(process.cwd(), c.storage?.local_path || './data/storage');
}

function resolveBgmProvider(model) {
  return isAceStepMusicModel(model) ? 'acestep' : 'suno';
}

function buildAceStepMusicConfig(model) {
  const m = String(model || ACE_STEP_DEFAULT_MODEL).trim() || ACE_STEP_DEFAULT_MODEL;
  return {
    provider: 'acestep',
    service_type: 'music',
    base_url: '',
    api_key: '',
    model: m,
    default_model: ACE_STEP_DEFAULT_MODEL,
  };
}

function getMusicConfig(db, configId, modelHint) {
  const hintedModel = String(modelHint || '').trim();
  const wantsCloudMusic = hintedModel && !isAceStepMusicModel(hintedModel);

  const aiConfigService = require('./aiConfigService');
  if (configId) {
    const cfg = aiConfigService.getConfig(db, configId);
    if (cfg && cfg.is_active !== false) return cfg;
  }

  if (isAceStepMusicModel(hintedModel) && !configId) {
    return buildAceStepMusicConfig(hintedModel);
  }

  const music = aiClient.getDefaultConfig(db, 'music');
  if (music) return music;

  // 无 music 配置时默认本地 ACE-Step；勿回退 Agnes/图片网关调 Suno（该网关无 /suno 接口）
  if (!wantsCloudMusic) {
    return buildAceStepMusicConfig(hintedModel || ACE_STEP_DEFAULT_MODEL);
  }

  // 仅当用户显式选择 Suno 模型时，才回退图片网关
  const image = aiClient.getDefaultConfig(db, 'image');
  if (image) {
    const models = Array.isArray(image.model) ? image.model : [image.model];
    return {
      ...image,
      service_type: 'music',
      model: models.includes(SUNO_DEFAULT_MODEL) ? SUNO_DEFAULT_MODEL : (models[0] || SUNO_DEFAULT_MODEL),
      default_model: SUNO_DEFAULT_MODEL,
    };
  }

  return buildAceStepMusicConfig(ACE_STEP_DEFAULT_MODEL);
}

function resolveModel(config, requested) {
  const req = String(requested || '').trim();
  if (req) return req;
  if (String(config?.provider || '').toLowerCase() === 'acestep') {
    return ACE_STEP_DEFAULT_MODEL;
  }
  if (config.default_model) return String(config.default_model).trim();
  const models = Array.isArray(config.model) ? config.model : [config.model];
  const first = String(models[0] || '').trim();
  if (first) return first;
  return ACE_STEP_DEFAULT_MODEL;
}

function rowToMusic(r) {
  if (!r) return null;
  return {
    id: r.id,
    drama_id: r.drama_id,
    episode_id: r.episode_id,
    storyboard_id: r.storyboard_id,
    provider: r.provider,
    model: r.model,
    prompt: r.prompt,
    description: r.description,
    title: r.title,
    audio_url: r.audio_url,
    local_path: r.local_path,
    cover_url: r.cover_url,
    duration: r.duration,
    kind: r.kind || 'bgm',
    task_id: r.task_id,
    status: r.status,
    error_msg: r.error_msg,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

function listMusicForEpisode(db, episodeId, kind) {
  let sql = `SELECT * FROM music_generations
    WHERE episode_id = ? AND deleted_at IS NULL
    ORDER BY id DESC`;
  const params = [episodeId];
  if (kind) {
    sql = `SELECT * FROM music_generations
      WHERE episode_id = ? AND deleted_at IS NULL AND kind = ?
      ORDER BY id DESC`;
    params.push(kind);
  }
  return db.prepare(sql).all(...params).map(rowToMusic);
}

function getMusicById(db, id) {
  const row = db.prepare(
    'SELECT * FROM music_generations WHERE id = ? AND deleted_at IS NULL'
  ).get(id);
  return rowToMusic(row);
}

async function saveBase64AudioToProject(db, storageRoot, dramaId, dataUrlOrBase64, log) {
  const raw = String(dataUrlOrBase64 || '').trim();
  if (!raw) throw new Error('空音频数据');
  const comma = raw.indexOf(',');
  const b64 = raw.startsWith('data:') && comma >= 0 ? raw.slice(comma + 1) : raw;
  const data = Buffer.from(b64, 'base64');
  if (!data || data.length < 256) throw new Error('下载的音频过短或为空');

  const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId);
  const sub = projectSubdir && String(projectSubdir).trim();
  const dir = sub
    ? path.join(storageRoot, sub, 'audio', 'bgm')
    : path.join(storageRoot, 'audio', 'bgm');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `bgm_${Date.now()}_${randomUUID().slice(0, 8)}.mp3`;
  const abs = path.join(dir, filename);
  fs.writeFileSync(abs, data);
  const rel = sub
    ? path.join(sub, 'audio', 'bgm', filename).replace(/\\/g, '/')
    : path.join('audio', 'bgm', filename).replace(/\\/g, '/');
  log?.info?.('BGM audio saved (base64)', { rel, bytes: data.length });
  return rel;
}

async function saveRemoteAudioToProject(db, storageRoot, dramaId, url, log) {
  const http = require('http');
  const https = require('https');
  const downloadOnce = (mediaUrl, timeoutMs = 45000, redirectCount = 0) => new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('too many redirects'));
    const lib = mediaUrl.startsWith('https') ? https : http;
    const req = lib.get(mediaUrl, { timeout: timeoutMs }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(downloadOnce(res.headers.location, timeoutMs, redirectCount + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`download status ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('download timeout')); });
    req.on('error', reject);
  });

  const data = await downloadOnce(url);
  if (!data || data.length < 256) throw new Error('下载的音频过短或为空');

  const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId);
  const sub = projectSubdir && String(projectSubdir).trim();
  const dir = sub
    ? path.join(storageRoot, sub, 'audio', 'bgm')
    : path.join(storageRoot, 'audio', 'bgm');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ext = /\.wav(\?|$)/i.test(url) ? 'wav' : 'mp3';
  const filename = `bgm_${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;
  const abs = path.join(dir, filename);
  fs.writeFileSync(abs, data);
  const rel = sub
    ? path.join(sub, 'audio', 'bgm', filename).replace(/\\/g, '/')
    : path.join('audio', 'bgm', filename).replace(/\\/g, '/');
  log?.info?.('BGM audio saved', { rel, bytes: data.length });
  return rel;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollSunoUntilDone(config, sunoTaskId, log, leadId) {
  const started = Date.now();
  while (Date.now() - started < SUNO_POLL_MAX_MS) {
    const poll = buildSunoPollRequest(config, sunoTaskId);
    const resp = await fetch(poll.url, {
      method: poll.method,
      headers: poll.headers,
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
      throw new Error(`Suno 查询失败 ${resp.status}: ${(await resp.text()).slice(0, 240)}`);
    }
    const json = await resp.json();
    const parsed = parseSunoPollResponse(json);
    if (parsed.status === 'failed') {
      throw new Error(parsed.error || 'Suno 生成失败');
    }
    if (parsed.status === 'completed' && parsed.tracks.length) {
      return parsed.tracks;
    }
    log?.info?.('BGM Suno polling', { id: leadId, sunoTaskId, elapsed_ms: Date.now() - started });
    await sleep(SUNO_POLL_INTERVAL_MS);
  }
  throw new Error('Suno 生成超时，请稍后在 BGM 列表中重试同步');
}

async function processAceStepMusicJob(db, log, cfg, leadId) {
  const row = db.prepare('SELECT * FROM music_generations WHERE id = ?').get(leadId);
  if (!row || row.status === 'deleted') return;

  const health = await checkAceStepHealth();
  if (!health.ok) {
    throw new Error(health.error || 'ACE-Step 未启动，请运行 scripts/start-ace-step.ps1');
  }

  const taskId = `acestep-${leadId}-${randomUUID().slice(0, 8)}`;
  const ts = nowIso();
  db.prepare('UPDATE music_generations SET task_id = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(taskId, 'processing', ts, leadId);

  log.info('BGM ACE-Step generate', { id: leadId, kind: row.kind, prompt_len: (row.prompt || '').length });
  const result = await generateAceStepMusic({
    prompt: row.prompt,
    durationSec: 60,
    instrumental: true,
  });

  const storageRoot = resolveStorageRoot(cfg);
  const localPath = await saveBase64AudioToProject(db, storageRoot, row.drama_id, result.audioDataUrl, log);
  const doneAt = nowIso();
  db.prepare(
    `UPDATE music_generations SET
      title = ?, audio_url = ?, local_path = ?, cover_url = NULL, duration = ?,
      status = ?, completed_at = ?, updated_at = ?, error_msg = NULL
     WHERE id = ?`
  ).run(
    `${row.kind === 'sfx' ? 'SFX' : 'BGM'} ACE-Step ${leadId}`,
    localPath,
    localPath,
    60,
    'completed',
    doneAt,
    doneAt,
    leadId
  );

  if (row.episode_id) {
    if (row.kind === 'sfx') {
      db.prepare(
        'UPDATE episodes SET sfx_local_path = ?, sfx_music_id = ?, updated_at = ? WHERE id = ?'
      ).run(localPath, leadId, doneAt, row.episode_id);
    } else {
      db.prepare(
        'UPDATE episodes SET bgm_local_path = ?, bgm_music_id = ?, updated_at = ? WHERE id = ?'
      ).run(localPath, leadId, doneAt, row.episode_id);
    }
  }
  log.info('BGM ACE-Step completed', { id: leadId, localPath, kind: row.kind });
}

async function processSunoMusicJob(db, log, cfg, leadId) {
  const row = db.prepare('SELECT * FROM music_generations WHERE id = ?').get(leadId);
  if (!row || row.status === 'deleted') return;
  const musicConfig = getMusicConfig(db, null);
  const model = row.model || SUNO_DEFAULT_MODEL;
  const submit = buildSunoSubmitRequest(musicConfig, {
    model,
    gpt_description_prompt: row.prompt,
    make_instrumental: true,
  });

  log.info('BGM Suno submit', { id: leadId, url: submit.url.slice(0, 80), model, kind: row.kind });
  const submitResp = await fetch(submit.url, {
    method: submit.method,
    headers: submit.headers,
    body: JSON.stringify(submit.body),
    signal: AbortSignal.timeout(120000),
  });
  if (!submitResp.ok) {
    throw new Error(`Suno 提交失败 ${submitResp.status}: ${(await submitResp.text()).slice(0, 300)}`);
  }
  const submitJson = await submitResp.json();
  const sunoTaskId = parseSunoSubmitResponse(submitJson);
  const ts = nowIso();
  db.prepare('UPDATE music_generations SET task_id = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(sunoTaskId, 'processing', ts, leadId);

  const tracks = await pollSunoUntilDone(musicConfig, sunoTaskId, log, leadId);
  const first = tracks[0];
  if (!first?.audioUrl) throw new Error('Suno 完成但无音频地址');

  const storageRoot = resolveStorageRoot(cfg);
  const localPath = await saveRemoteAudioToProject(db, storageRoot, row.drama_id, first.audioUrl, log);
  const doneAt = nowIso();
  db.prepare(
    `UPDATE music_generations SET
      title = ?, audio_url = ?, local_path = ?, cover_url = ?, duration = ?,
      status = ?, completed_at = ?, updated_at = ?, error_msg = NULL
     WHERE id = ?`
  ).run(
    first.title || `${row.kind === 'sfx' ? 'SFX' : 'BGM'} ${leadId}`,
    first.audioUrl,
    localPath,
    first.imageUrl || null,
    first.duration != null ? Number(first.duration) : null,
    'completed',
    doneAt,
    doneAt,
    leadId
  );

  if (row.episode_id) {
    if (row.kind === 'sfx') {
      db.prepare(
        'UPDATE episodes SET sfx_local_path = ?, sfx_music_id = ?, updated_at = ? WHERE id = ?'
      ).run(localPath, leadId, doneAt, row.episode_id);
    } else {
      db.prepare(
        'UPDATE episodes SET bgm_local_path = ?, bgm_music_id = ?, updated_at = ? WHERE id = ?'
      ).run(localPath, leadId, doneAt, row.episode_id);
    }
  }
  log.info('BGM generation completed', { id: leadId, localPath, kind: row.kind });
}

/**
 * @returns {{ music_ids: number[], task_id: number|null }}
 */
function generateEpisodeBgm(db, log, cfg, episodeId, body = {}) {
  const ctx = loadEpisodeContext(db, episodeId);
  if (!ctx) throw new Error('剧集不存在');
  const { ep, moods } = ctx;

  const requestedModel = String(body.model || '').trim();
  let musicConfig;
  try {
    musicConfig = getMusicConfig(db, body.config_id, requestedModel);
  } catch (err) {
    throw err;
  }

  const description = String(body.description || '').trim();
  const model = resolveModel(musicConfig, body.model);
  const provider = resolveBgmProvider(model);
  const ts = nowIso();
  const batchId = randomUUID();

  const bgmPrompt = buildBgmPrompt({
    description,
    content: ep.script_content || ep.description || '',
    include_sfx: false,
    moods,
  });

  const insert = db.prepare(
    `INSERT INTO music_generations
      (drama_id, episode_id, storyboard_id, provider, model, prompt, description, kind, batch_id, status, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 'bgm', ?, 'pending', ?, ?)`
  );
  const info = insert.run(
    ep.drama_id,
    episodeId,
    provider === 'acestep' ? 'acestep' : (musicConfig.provider || 'chatfire'),
    model,
    bgmPrompt,
    description || null,
    batchId,
    ts,
    ts
  );
  const bgmId = Number(info.lastInsertRowid);
  const musicIds = [bgmId];

  const task = taskService.createTask(db, log, 'bgm_generate', String(episodeId));
  const taskId = task?.id || null;
  if (taskId) {
    taskService.updateTaskStatus(db, taskId, 'processing', 5, 'BGM 生成中…');
  }

  const processMusicJob = provider === 'acestep' ? processAceStepMusicJob : processSunoMusicJob;

  setImmediate(async () => {
    try {
      await processMusicJob(db, log, cfg, bgmId);
      if (taskId) {
        taskService.updateTaskResult(db, taskId, {
          music_ids: musicIds,
          bgm_id: bgmId,
          sfx_id: null,
        });
      }
    } catch (err) {
      const msg = err.message || String(err);
      log.error('BGM generate failed', { episode_id: episodeId, error: msg });
      const failAt = nowIso();
      for (const id of musicIds) {
        const cur = db.prepare('SELECT status FROM music_generations WHERE id = ?').get(id);
        if (cur && cur.status !== 'completed') {
          db.prepare(
            'UPDATE music_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?'
          ).run('failed', msg, failAt, id);
        }
      }
      if (taskId) {
        taskService.updateTaskError(db, taskId, msg);
      }
    }
  });

  return {
    message: 'BGM 生成任务已提交',
    music_ids: musicIds,
    bgm_id: bgmId,
    sfx_id: null,
    task_id: taskId,
  };
}

function resolveAbsMedia(storageRoot, relOrUrl) {
  const s = String(relOrUrl || '').trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return null;
  let rel = s.replace(/^\/static\//, '').replace(/^\//, '');
  const abs = path.join(storageRoot, rel.replace(/\//g, path.sep));
  return fs.existsSync(abs) ? abs : null;
}

function ffprobeDurationSec(filePath) {
  const probe = getFfprobePath();
  const r = spawnSync(
    probe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  );
  if (r.status !== 0) return null;
  const d = parseFloat(String(r.stdout || '').trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

function runFfmpeg(args, log, tag) {
  const bin = getFfmpegPath();
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) {
    log?.warn?.('bgm mix ffmpeg spawn', { tag, error: r.error.message });
    return false;
  }
  if (r.status !== 0) {
    log?.warn?.('bgm mix ffmpeg failed', { tag, stderr: r.stderr?.slice(-1200) });
    return false;
  }
  return true;
}

/**
 * 将 BGM（及可选音效）混入已有合成视频；原 video_url 不变，结果写入 bgm_video_url。
 */
function mixBgmIntoEpisodeVideo(db, log, cfg, episodeId, body = {}) {
  const ep = db.prepare(
    `SELECT id, drama_id, episode_number, video_url, bgm_local_path, bgm_music_id,
            sfx_local_path, sfx_music_id, bgm_video_url
     FROM episodes WHERE id = ? AND deleted_at IS NULL`
  ).get(episodeId);
  if (!ep) throw new Error('剧集不存在');
  if (!ep.video_url) throw new Error('请先完成「合成视频」，再混入 BGM');

  const storageRoot = resolveStorageRoot(cfg);
  const videoAbs = resolveAbsMedia(storageRoot, ep.video_url);
  if (!videoAbs) throw new Error('原合成视频文件不存在，请重新合成');

  const bgmMusicId = body.bgm_music_id != null ? Number(body.bgm_music_id) : ep.bgm_music_id;
  const sfxMusicId = body.sfx_music_id != null
    ? Number(body.sfx_music_id)
    : (body.include_sfx === true ? ep.sfx_music_id : null);

  let bgmRel = ep.bgm_local_path;
  if (bgmMusicId) {
    const m = db.prepare(
      `SELECT local_path, status FROM music_generations
       WHERE id = ? AND deleted_at IS NULL`
    ).get(bgmMusicId);
    if (!m || m.status !== 'completed' || !m.local_path) {
      throw new Error('所选 BGM 尚未生成完成');
    }
    bgmRel = m.local_path;
  }
  if (!bgmRel) throw new Error('请先生成或选择 BGM');

  const bgmAbs = resolveAbsMedia(storageRoot, bgmRel);
  if (!bgmAbs) throw new Error('BGM 音频文件不存在');

  let sfxAbs = null;
  let sfxRel = null;
  if (sfxMusicId) {
    const sx = db.prepare(
      `SELECT local_path, status FROM music_generations
       WHERE id = ? AND deleted_at IS NULL`
    ).get(sfxMusicId);
    if (sx && sx.status === 'completed' && sx.local_path) {
      sfxRel = sx.local_path;
      sfxAbs = resolveAbsMedia(storageRoot, sfxRel);
    }
  } else if (body.include_sfx === true && ep.sfx_local_path) {
    sfxRel = ep.sfx_local_path;
    sfxAbs = resolveAbsMedia(storageRoot, sfxRel);
  }

  const bgmVol = Math.max(0.03, Math.min(0.35, Number(body.bgm_volume) || BGM_VOICE_MIX_VOLUME));
  const sfxVol = Math.max(0.03, Math.min(0.4, Number(body.sfx_volume) || SFX_MIX_VOLUME));

  const projectSubdir = storageLayout.getProjectStorageSubdir(db, ep.drama_id);
  const sub = projectSubdir && String(projectSubdir).trim();
  const outDir = sub
    ? path.join(storageRoot, sub, 'videos', 'merged')
    : path.join(storageRoot, 'videos', 'merged');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outName = `merged_bgm_${Date.now()}.mp4`;
  const outAbs = path.join(outDir, outName);
  const tempOut = `${outAbs}.tmp.mp4`;

  // 检测原片是否有音轨
  const hasAudio = (() => {
    const probe = getFfprobePath();
    const r = spawnSync(
      probe,
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', videoAbs],
      { encoding: 'utf8', maxBuffer: 256 * 1024 }
    );
    return r.status === 0 && String(r.stdout || '').trim().length > 0;
  })();

  let ok = false;
  if (sfxAbs && hasAudio) {
    ok = runFfmpeg([
      '-y', '-i', videoAbs,
      '-stream_loop', '-1', '-i', bgmAbs,
      '-stream_loop', '-1', '-i', sfxAbs,
      '-filter_complex',
      `[0:a]volume=1[voice];[1:a]volume=${bgmVol}[bgm];[2:a]volume=${sfxVol}[sfx];`
        + `[voice][bgm][sfx]amix=inputs=3:duration=first:dropout_transition=2:normalize=0[aout]`,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart',
      tempOut,
    ], log, 'mix_bgm_sfx');
  } else if (sfxAbs && !hasAudio) {
    ok = runFfmpeg([
      '-y', '-i', videoAbs,
      '-stream_loop', '-1', '-i', bgmAbs,
      '-stream_loop', '-1', '-i', sfxAbs,
      '-filter_complex',
      `[1:a]volume=${bgmVol}[bgm];[2:a]volume=${sfxVol}[sfx];`
        + `[bgm][sfx]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart',
      tempOut,
    ], log, 'mix_bgm_sfx_novoice');
  } else if (hasAudio) {
    ok = runFfmpeg([
      '-y', '-i', videoAbs,
      '-stream_loop', '-1', '-i', bgmAbs,
      '-filter_complex',
      `[0:a]volume=1[voice];[1:a]volume=${bgmVol}[bgm];`
        + `[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart',
      tempOut,
    ], log, 'mix_bgm');
  } else {
    ok = runFfmpeg([
      '-y', '-i', videoAbs,
      '-stream_loop', '-1', '-i', bgmAbs,
      '-filter_complex', `[1:a]volume=${Math.min(0.25, bgmVol * 2)}[aout]`,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart',
      tempOut,
    ], log, 'mix_bgm_solo');
  }

  if (!ok || !fs.existsSync(tempOut)) {
    throw new Error('混入 BGM 失败（ffmpeg）');
  }
  try {
    if (fs.existsSync(outAbs)) fs.unlinkSync(outAbs);
    fs.renameSync(tempOut, outAbs);
  } catch (e) {
    try { fs.copyFileSync(tempOut, outAbs); fs.unlinkSync(tempOut); } catch (_) {
      throw new Error('写出带 BGM 视频失败');
    }
  }

  const rel = sub
    ? path.join(sub, 'videos', 'merged', outName).replace(/\\/g, '/')
    : path.join('videos', 'merged', outName).replace(/\\/g, '/');

  const ts = nowIso();
  db.prepare(
    `UPDATE episodes SET
      bgm_video_url = ?,
      bgm_local_path = ?,
      bgm_music_id = ?,
      sfx_local_path = COALESCE(?, sfx_local_path),
      sfx_music_id = COALESCE(?, sfx_music_id),
      updated_at = ?
     WHERE id = ?`
  ).run(
    rel,
    bgmRel,
    bgmMusicId || ep.bgm_music_id || null,
    sfxRel || null,
    sfxMusicId || null,
    ts,
    episodeId
  );

  const duration = ffprobeDurationSec(outAbs);
  log.info('BGM mixed into episode video', {
    episode_id: episodeId,
    original: ep.video_url,
    bgm_video: rel,
    bgm_vol: bgmVol,
    has_sfx: !!sfxAbs,
  });

  return {
    message: '已生成带 BGM 的成片（原合成视频已保留）',
    video_url: ep.video_url,
    bgm_video_url: rel,
    bgm_local_path: bgmRel,
    sfx_local_path: sfxRel || ep.sfx_local_path || null,
    duration: duration != null ? Math.round(duration) : null,
  };
}

function applyMusicToEpisode(db, episodeId, musicId, kind = 'bgm') {
  const m = db.prepare(
    'SELECT * FROM music_generations WHERE id = ? AND deleted_at IS NULL'
  ).get(musicId);
  if (!m || m.status !== 'completed' || !m.local_path) {
    throw new Error('音乐尚未生成完成');
  }
  const ts = nowIso();
  if (kind === 'sfx' || m.kind === 'sfx') {
    db.prepare(
      'UPDATE episodes SET sfx_local_path = ?, sfx_music_id = ?, updated_at = ? WHERE id = ?'
    ).run(m.local_path, musicId, ts, episodeId);
  } else {
    db.prepare(
      'UPDATE episodes SET bgm_local_path = ?, bgm_music_id = ?, updated_at = ? WHERE id = ?'
    ).run(m.local_path, musicId, ts, episodeId);
  }
  return { ok: true, local_path: m.local_path, kind: m.kind || kind };
}

module.exports = {
  BGM_VOICE_MIX_VOLUME,
  SFX_MIX_VOLUME,
  ACE_STEP_DEFAULT_MODEL,
  resolveBgmProvider,
  suggestBgmDescription,
  listMusicForEpisode,
  getMusicById,
  generateEpisodeBgm,
  mixBgmIntoEpisodeVideo,
  applyMusicToEpisode,
  getMusicConfig,
};
