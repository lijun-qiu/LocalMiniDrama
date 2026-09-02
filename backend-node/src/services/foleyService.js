/**
 * 分镜 Foley：每 3s 抽帧 → Agnes 视觉标事件 → ACE-Step 短音 → 按时间轴混入成片（与 BGM 独立）
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
  checkAceStepHealth,
  generateAceStepMusic,
} = require('./aceStepMusicAdapter');

const FRAME_INTERVAL_SEC = 3;
const MAX_FRAMES_PER_SHOT = 12;
const FOLEY_CLIP_SEC = 2.2;
const FOLEY_GEN_DURATION_SEC = 8;
const FOLEY_MIX_VOLUME = 0.40;
const VISION_MODEL_CANDIDATES = ['agnes-2.5-flash', 'agnes-2.0-flash'];

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
    log?.warn?.('foley ffmpeg spawn', { tag, error: r.error.message });
    return false;
  }
  if (r.status !== 0) {
    log?.warn?.('foley ffmpeg failed', { tag, stderr: r.stderr?.slice(-1200) });
    return false;
  }
  return true;
}

function parseFoleyEventsJson(raw) {
  if (!raw) return { events: [], analyzed_at: null };
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { events: [] };
  } catch {
    return { events: [], analyzed_at: null };
  }
}

function saveFoleyEvents(db, episodeId, payload) {
  const ts = nowIso();
  db.prepare(
    `UPDATE episodes SET foley_events_json = ?, updated_at = ? WHERE id = ?`
  ).run(JSON.stringify(payload), ts, episodeId);
}

function setFoleyStatus(db, episodeId, status, error = null) {
  const ts = nowIso();
  db.prepare(
    `UPDATE episodes SET foley_status = ?, foley_error = ?, updated_at = ? WHERE id = ?`
  ).run(status, error, ts, episodeId);
}

function listStoryboardVideos(db, storageRoot, episodeId) {
  const rows = db.prepare(
    `SELECT id, storyboard_number, title, description, action, atmosphere, narration, dialogue,
            video_url, local_path, duration
     FROM storyboards
     WHERE episode_id = ? AND deleted_at IS NULL
     ORDER BY storyboard_number ASC`
  ).all(episodeId);

  const shots = [];
  let cursor = 0;
  for (const row of rows) {
    const abs = resolveAbsMedia(storageRoot, row.local_path)
      || resolveAbsMedia(storageRoot, row.video_url);
    if (!abs) continue;
    const dur = ffprobeDurationSec(abs) || Number(row.duration) || 0;
    shots.push({
      storyboard_id: row.id,
      storyboard_number: row.storyboard_number,
      title: row.title || '',
      description: row.description || '',
      action: row.action || '',
      atmosphere: row.atmosphere || '',
      abs_path: abs,
      duration_sec: dur,
      episode_offset_sec: cursor,
    });
    cursor += dur;
  }
  return shots;
}

/** 每 3s 抽一帧，返回 { t_clip_sec, abs_path }[] */
function extractFramesEvery3s(videoAbs, outDir, log) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const duration = ffprobeDurationSec(videoAbs) || 0;
  const times = [];
  if (duration <= 0) {
    times.push(0);
  } else {
    for (let t = 0; t < duration && times.length < MAX_FRAMES_PER_SHOT; t += FRAME_INTERVAL_SEC) {
      times.push(Number(t.toFixed(2)));
    }
    if (times.length === 0) times.push(0);
  }

  const frames = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const out = path.join(outDir, `f${String(i).padStart(2, '0')}_${String(t).replace('.', 'p')}s.jpg`);
    const ok = runFfmpeg([
      '-y', '-ss', String(t), '-i', videoAbs,
      '-frames:v', '1', '-q:v', '3',
      out,
    ], log, 'extract_frame');
    if (ok && fs.existsSync(out) && fs.statSync(out).size > 100) {
      frames.push({ t_clip_sec: t, abs_path: out });
    }
  }
  return frames;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(body);
  } catch (_) {}
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch (_) {}
  }
  return null;
}

function resolveVisionModel(db, requested) {
  const req = String(requested || '').trim();
  if (req) return req;
  for (const m of VISION_MODEL_CANDIDATES) {
    if (aiClient.getConfigForModel(db, 'text', m)) return m;
  }
  return undefined;
}

/**
 * 对单镜多帧做视觉分析，返回明显 Foley 事件（相对镜头时间）
 */
async function analyzeShotFrames(db, log, shot, frames, visionModel) {
  if (!frames.length) return [];

  const system = [
    '你是影视 Foley / 音效指导。根据分镜画面帧，只标注「明显、具体、可听到」的短事件音效。',
    '要：关门、开门、按键、点击、脚步、敲门、摔杯、碰撞、枪械机械、电话铃、键盘、抽屉、拉链等。',
    '不要：背景音乐、旁白、对白、持续环境氛围床、抽象情绪音。',
    '若画面无明显事件音，返回空 events。',
    '只输出 JSON，不要 markdown。',
  ].join('');

  const frameLines = frames.map((f, i) => `帧${i + 1}: t=${f.t_clip_sec}s`).join('\n');
  const userPrompt = [
    `分镜 #${shot.storyboard_number}「${shot.title || ''}」`,
    `动作/描述: ${(shot.action || shot.description || '').slice(0, 280)}`,
    `下列图片按时间顺序，间隔约 ${FRAME_INTERVAL_SEC}s：`,
    frameLines,
    '',
    '输出格式：',
    '{"events":[{"t_clip_sec":0,"label":"door_close","description":"木门关上","prompt":"short dry wooden door slam foley, no music, no reverb wash","confidence":"high"}]}',
    '规则：t_clip_sec 取最接近事件的帧时间；prompt 用英文短 Foley 描述；confidence 仅 high/medium；最多 6 条；宁缺毋滥。',
  ].join('\n');

  // 多图：扩展 vision 消息
  const fsLocal = require('fs');
  const content = [{ type: 'text', text: userPrompt }];
  for (const f of frames.slice(0, MAX_FRAMES_PER_SHOT)) {
    const buf = fsLocal.readFileSync(f.abs_path);
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` },
    });
  }

  const preferredModel = resolveVisionModel(db, visionModel);
  let config = preferredModel
    ? aiClient.getConfigForModel(db, 'text', preferredModel)
    : aiClient.getDefaultConfig(db, 'text');
  if (!config) config = aiClient.getDefaultConfig(db, 'text');
  if (!config) throw new Error('未配置文本/视觉模型：请在 AI 配置中添加 Agnes（agnes-2.5-flash）');

  const model = (() => {
    const models = Array.isArray(config.model) ? config.model : [config.model];
    if (preferredModel && models.includes(preferredModel)) return preferredModel;
    if (preferredModel) return preferredModel;
    for (const c of VISION_MODEL_CANDIDATES) {
      if (models.includes(c)) return c;
    }
    return models[0] || 'agnes-2.5-flash';
  })();

  const url = (() => {
    const base = String(config.base_url || '').replace(/\/+$/, '');
    if (!base) throw new Error('文本配置缺少 base_url');
    let ep = config.endpoint || '/chat/completions';
    if (!ep.startsWith('/')) ep = `/${ep}`;
    if (/\/chat\/completions$/i.test(base)) return base;
    return `${base}${ep}`;
  })();

  log.info('[Foley] vision analyze shot', {
    storyboard_id: shot.storyboard_id,
    frames: frames.length,
    model,
  });

  const body = {
    model,
    temperature: 0.2,
    max_tokens: 1200,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
  };

  const resp = await aiClient.withAgnesApiKey(config, async (apiKey) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  });
  let json;
  try {
    json = JSON.parse(resp.text);
  } catch {
    throw new Error(`Foley 视觉返回非 JSON: ${resp.text.slice(0, 200)}`);
  }
  if (!resp.ok) {
    throw new Error(String(json?.error?.message || json?.detail || `Vision ${resp.status}: ${resp.text.slice(0, 240)}`));
  }
  const reply = json?.choices?.[0]?.message?.content || '';
  const parsed = extractJsonObject(reply) || { events: [] };
  const events = Array.isArray(parsed.events) ? parsed.events : [];

  return events
    .map((e, idx) => {
      const tClip = Number(e.t_clip_sec);
      const nearest = frames.reduce((best, f) => {
        if (!best) return f;
        return Math.abs(f.t_clip_sec - tClip) < Math.abs(best.t_clip_sec - tClip) ? f : best;
      }, null);
      const t = Number.isFinite(tClip) ? tClip : (nearest?.t_clip_sec || 0);
      const conf = String(e.confidence || 'medium').toLowerCase();
      if (conf === 'low') return null;
      const label = String(e.label || e.description || `sfx_${idx}`).trim().slice(0, 64);
      const description = String(e.description || label).trim().slice(0, 120);
      const prompt = String(e.prompt || `${description} short foley sound effect, no music`).trim().slice(0, 280);
      if (!label && !description) return null;
      return {
        id: `sb${shot.storyboard_id}_${Math.round(t * 10)}_${idx}`,
        storyboard_id: shot.storyboard_id,
        storyboard_number: shot.storyboard_number,
        t_clip_sec: Math.max(0, Number(t.toFixed(2))),
        t_episode_sec: Number((shot.episode_offset_sec + Math.max(0, t)).toFixed(2)),
        label,
        description,
        prompt,
        confidence: conf === 'high' ? 'high' : 'medium',
        status: 'pending',
        audio_path: null,
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

async function saveBase64FoleyClip(db, storageRoot, dramaId, dataUrl, log) {
  const raw = String(dataUrl || '').trim();
  const comma = raw.indexOf(',');
  const b64 = raw.startsWith('data:') && comma >= 0 ? raw.slice(comma + 1) : raw;
  const data = Buffer.from(b64, 'base64');
  if (!data || data.length < 256) throw new Error('Foley 音频过短');

  const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId);
  const sub = projectSubdir && String(projectSubdir).trim();
  const dir = sub
    ? path.join(storageRoot, sub, 'audio', 'foley')
    : path.join(storageRoot, 'audio', 'foley');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmpName = `foley_raw_${Date.now()}_${randomUUID().slice(0, 8)}.mp3`;
  const tmpAbs = path.join(dir, tmpName);
  fs.writeFileSync(tmpAbs, data);

  const outName = `foley_${Date.now()}_${randomUUID().slice(0, 8)}.mp3`;
  const outAbs = path.join(dir, outName);
  // 裁成短冲击音：取前 FOLEY_CLIP_SEC，淡出
  const fade = Math.min(0.35, FOLEY_CLIP_SEC / 3);
  const ok = runFfmpeg([
    '-y', '-i', tmpAbs,
    '-t', String(FOLEY_CLIP_SEC),
    '-af', `afade=t=out:st=${Math.max(0, FOLEY_CLIP_SEC - fade)}:d=${fade}`,
    '-c:a', 'libmp3lame', '-b:a', '192k',
    outAbs,
  ], log, 'trim_foley');
  try { fs.unlinkSync(tmpAbs); } catch (_) {}
  if (!ok || !fs.existsSync(outAbs)) {
    // 裁剪失败则用原文件
    fs.writeFileSync(outAbs, data);
  }

  const rel = sub
    ? path.join(sub, 'audio', 'foley', outName).replace(/\\/g, '/')
    : path.join('audio', 'foley', outName).replace(/\\/g, '/');
  return rel;
}

async function generateFoleyAudioForEvents(db, log, cfg, episodeId, dramaId, events) {
  const health = await checkAceStepHealth();
  if (!health.ok) {
    throw new Error(health.error || 'ACE-Step 未启动，请先在 BGM 面板启动本地模型');
  }
  const storageRoot = resolveStorageRoot(cfg);
  const out = [];
  for (const ev of events) {
    if (ev.status === 'skipped') {
      out.push(ev);
      continue;
    }
    try {
      const prompt = [
        String(ev.prompt || ev.description || ev.label),
        'single short foley one-shot, dry, no melody, no vocals, no long ambience bed',
      ].join('. ');
      log.info('[Foley] ACE-Step generate', { id: ev.id, label: ev.label });
      const result = await generateAceStepMusic({
        prompt,
        durationSec: FOLEY_GEN_DURATION_SEC,
        minDurationSec: 5,
        instrumental: true,
      });
      const rel = await saveBase64FoleyClip(db, storageRoot, dramaId, result.audioDataUrl, log);
      out.push({ ...ev, status: 'completed', audio_path: rel, error: null });
    } catch (err) {
      log.warn('[Foley] generate failed', { id: ev.id, error: err.message });
      out.push({ ...ev, status: 'failed', error: err.message || String(err) });
    }
  }
  return out;
}

function mixFoleyOntoEpisodeVideo(db, log, cfg, episodeId, body = {}) {
  const ep = db.prepare(
    `SELECT id, drama_id, video_url, bgm_video_url, foley_events_json, foley_video_url
     FROM episodes WHERE id = ? AND deleted_at IS NULL`
  ).get(episodeId);
  if (!ep) throw new Error('剧集不存在');

  const preferBgm = body.source === 'bgm' || body.onto_bgm === true;
  const sourceRel = preferBgm && ep.bgm_video_url ? ep.bgm_video_url : ep.video_url;
  if (!sourceRel) throw new Error('请先完成「合成视频」再混入 Foley');

  const storageRoot = resolveStorageRoot(cfg);
  const videoAbs = resolveAbsMedia(storageRoot, sourceRel);
  if (!videoAbs) throw new Error('成片文件不存在，请重新合成');

  const payload = parseFoleyEventsJson(ep.foley_events_json);
  const ready = (payload.events || []).filter((e) => e.status === 'completed' && e.audio_path);
  if (!ready.length) throw new Error('没有已生成的 Foley 音效，请先分析并生成');

  const audioAbsList = [];
  for (const ev of ready) {
    const abs = resolveAbsMedia(storageRoot, ev.audio_path);
    if (abs) audioAbsList.push({ ev, abs });
  }
  if (!audioAbsList.length) throw new Error('Foley 音频文件缺失');

  const projectSubdir = storageLayout.getProjectStorageSubdir(db, ep.drama_id);
  const sub = projectSubdir && String(projectSubdir).trim();
  const outDir = sub
    ? path.join(storageRoot, sub, 'videos', 'merged')
    : path.join(storageRoot, 'videos', 'merged');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outName = `merged_foley_${Date.now()}.mp4`;
  const outAbs = path.join(outDir, outName);
  const tempOut = `${outAbs}.tmp.mp4`;

  const hasAudio = (() => {
    const probe = getFfprobePath();
    const r = spawnSync(
      probe,
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', videoAbs],
      { encoding: 'utf8', maxBuffer: 256 * 1024 }
    );
    return r.status === 0 && String(r.stdout || '').trim().length > 0;
  })();

  const vol = Math.max(0.15, Math.min(1, Number(body.foley_volume) || FOLEY_MIX_VOLUME));
  const inputs = ['-y', '-i', videoAbs];
  for (const item of audioAbsList) {
    inputs.push('-i', item.abs);
  }

  const filterParts = [];
  const mixLabels = [];
  if (hasAudio) {
    filterParts.push('[0:a]volume=1[voice]');
    mixLabels.push('[voice]');
  }
  audioAbsList.forEach((item, i) => {
    const delayMs = Math.max(0, Math.round(Number(item.ev.t_episode_sec || 0) * 1000));
    const lab = `f${i}`;
    filterParts.push(`[${i + 1}:a]volume=${vol},adelay=${delayMs}|${delayMs},apad[${lab}]`);
    mixLabels.push(`[${lab}]`);
  });
  const n = mixLabels.length;
  filterParts.push(
    `${mixLabels.join('')}amix=inputs=${n}:duration=first:dropout_transition=0:normalize=0[aout]`
  );

  const args = [
    ...inputs,
    '-filter_complex', filterParts.join(';'),
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    tempOut,
  ];

  const ok = runFfmpeg(args, log, 'mix_foley');
  if (!ok || !fs.existsSync(tempOut)) {
    throw new Error('混入 Foley 失败（ffmpeg）');
  }
  try {
    if (fs.existsSync(outAbs)) fs.unlinkSync(outAbs);
    fs.renameSync(tempOut, outAbs);
  } catch (_) {
    fs.copyFileSync(tempOut, outAbs);
    try { fs.unlinkSync(tempOut); } catch (__) {}
  }

  const rel = sub
    ? path.join(sub, 'videos', 'merged', outName).replace(/\\/g, '/')
    : path.join('videos', 'merged', outName).replace(/\\/g, '/');
  const ts = nowIso();
  db.prepare(
    `UPDATE episodes SET foley_video_url = ?, foley_status = ?, foley_error = NULL, updated_at = ? WHERE id = ?`
  ).run(rel, 'mixed', ts, episodeId);

  return {
    message: '已生成带 Foley 成片（与 BGM 成片相互独立）',
    source_video: sourceRel,
    foley_video_url: rel,
    event_count: audioAbsList.length,
  };
}

/**
 * 分析：分镜抽帧 + Agnes 事件 JSON（异步任务）
 */
function analyzeEpisodeFoley(db, log, cfg, episodeId, body = {}) {
  const ep = db.prepare(
    'SELECT id, drama_id, video_url FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(episodeId);
  if (!ep) throw new Error('剧集不存在');

  const storageRoot = resolveStorageRoot(cfg);
  const shots = listStoryboardVideos(db, storageRoot, episodeId);
  if (!shots.length) throw new Error('本集没有可用的分镜视频，请先生成镜头视频');

  const visionModel = String(body.model || body.vision_model || '').trim() || undefined;
  setFoleyStatus(db, episodeId, 'analyzing', null);

  const task = taskService.createTask(db, log, 'foley_analyze', String(episodeId));
  const taskId = task?.id || null;
  if (taskId) {
    taskService.updateTaskStatus(db, taskId, 'processing', 5, 'Foley 抽帧分析中…');
    db.prepare('UPDATE episodes SET foley_task_id = ?, updated_at = ? WHERE id = ?')
      .run(taskId, nowIso(), episodeId);
  }

  setImmediate(async () => {
    try {
      const projectSubdir = storageLayout.getProjectStorageSubdir(db, ep.drama_id);
      const sub = projectSubdir && String(projectSubdir).trim();
      const frameRoot = sub
        ? path.join(storageRoot, sub, 'audio', 'foley_frames', `ep_${episodeId}`)
        : path.join(storageRoot, 'audio', 'foley_frames', `ep_${episodeId}`);

      const allEvents = [];
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i];
        const outDir = path.join(frameRoot, `sb_${shot.storyboard_id}`);
        const frames = extractFramesEvery3s(shot.abs_path, outDir, log);
        if (taskId) {
          const pct = 10 + Math.round((i / Math.max(1, shots.length)) * 70);
          taskService.updateTaskStatus(db, taskId, 'processing', pct, `分析分镜 ${shot.storyboard_number}…`);
        }
        const events = await analyzeShotFrames(db, log, shot, frames, visionModel);
        allEvents.push(...events);
      }

      // 去重：同一秒附近同类 label
      const deduped = [];
      for (const ev of allEvents) {
        const hit = deduped.find((x) =>
          x.label === ev.label
          && Math.abs(x.t_episode_sec - ev.t_episode_sec) < 1.2
        );
        if (!hit) deduped.push(ev);
      }

      const payload = {
        analyzed_at: nowIso(),
        frame_interval_sec: FRAME_INTERVAL_SEC,
        vision_model: visionModel || 'auto',
        shot_count: shots.length,
        events: deduped,
      };
      saveFoleyEvents(db, episodeId, payload);
      setFoleyStatus(db, episodeId, 'analyzed', null);
      if (taskId) {
        taskService.updateTaskResult(db, taskId, {
          event_count: deduped.length,
          events: deduped,
        });
      }
      log.info('[Foley] analyze done', { episode_id: episodeId, events: deduped.length });
    } catch (err) {
      const msg = err.message || String(err);
      log.error('[Foley] analyze failed', { episode_id: episodeId, error: msg });
      setFoleyStatus(db, episodeId, 'failed', msg);
      if (taskId) taskService.updateTaskError(db, taskId, msg);
    }
  });

  return {
    message: 'Foley 画面分析已启动（每 3 秒一帧）',
    task_id: taskId,
    shot_count: shots.length,
  };
}

/**
 * 为已分析事件生成短音（ACE-Step）
 */
function generateEpisodeFoley(db, log, cfg, episodeId, body = {}) {
  const ep = db.prepare(
    'SELECT id, drama_id, foley_events_json FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(episodeId);
  if (!ep) throw new Error('剧集不存在');
  const payload = parseFoleyEventsJson(ep.foley_events_json);
  let events = payload.events || [];
  if (!events.length) throw new Error('请先执行「分析画面音效」');

  if (Array.isArray(body.event_ids) && body.event_ids.length) {
    const set = new Set(body.event_ids.map(String));
    events = events.filter((e) => set.has(String(e.id)));
  }
  // 默认只生成 high；body.include_medium !== false 时 medium 也生成
  if (body.only_high) {
    events = events.filter((e) => e.confidence === 'high');
  }

  setFoleyStatus(db, episodeId, 'generating', null);
  const task = taskService.createTask(db, log, 'foley_generate', String(episodeId));
  const taskId = task?.id || null;
  if (taskId) {
    taskService.updateTaskStatus(db, taskId, 'processing', 5, 'Foley 短音生成中…');
    db.prepare('UPDATE episodes SET foley_task_id = ?, updated_at = ? WHERE id = ?')
      .run(taskId, nowIso(), episodeId);
  }

  setImmediate(async () => {
    try {
      const updatedSubset = await generateFoleyAudioForEvents(
        db, log, cfg, episodeId, ep.drama_id, events
      );
      const byId = new Map(updatedSubset.map((e) => [String(e.id), e]));
      const merged = (payload.events || []).map((e) => byId.get(String(e.id)) || e);
      const next = { ...payload, events: merged, generated_at: nowIso() };
      saveFoleyEvents(db, episodeId, next);
      const okCount = merged.filter((e) => e.status === 'completed').length;
      setFoleyStatus(db, episodeId, okCount ? 'generated' : 'failed', okCount ? null : '全部 Foley 生成失败');
      if (taskId) {
        taskService.updateTaskResult(db, taskId, { event_count: okCount, events: merged });
      }
    } catch (err) {
      const msg = err.message || String(err);
      log.error('[Foley] generate failed', { episode_id: episodeId, error: msg });
      setFoleyStatus(db, episodeId, 'failed', msg);
      if (taskId) taskService.updateTaskError(db, taskId, msg);
    }
  });

  return {
    message: 'Foley 短音生成任务已提交',
    task_id: taskId,
    event_count: events.length,
  };
}

function getEpisodeFoley(db, episodeId) {
  const ep = db.prepare(
    `SELECT id, foley_events_json, foley_status, foley_error, foley_video_url, foley_task_id
     FROM episodes WHERE id = ? AND deleted_at IS NULL`
  ).get(episodeId);
  if (!ep) throw new Error('剧集不存在');
  const payload = parseFoleyEventsJson(ep.foley_events_json);
  return {
    status: ep.foley_status || null,
    error: ep.foley_error || null,
    foley_video_url: ep.foley_video_url || null,
    task_id: ep.foley_task_id || null,
    ...payload,
    events: payload.events || [],
  };
}

module.exports = {
  FRAME_INTERVAL_SEC,
  analyzeEpisodeFoley,
  generateEpisodeFoley,
  mixFoleyOntoEpisodeVideo,
  getEpisodeFoley,
  parseFoleyEventsJson,
  extractJsonObject,
};
