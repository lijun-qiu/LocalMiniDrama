const path = require('path');
const fs = require('fs');
const { getFfmpegPath, getFfprobePath, hasLocalFfmpeg, hasLocalFfprobe } = require('../utils/ffmpegPath');
const storageLayout = require('./storageLayout');

function list(db, query) {
  let sql = 'FROM video_merges WHERE deleted_at IS NULL';
  const params = [];
  if (query.episode_id) {
    sql += ' AND episode_id = ?';
    params.push(query.episode_id);
  }
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(query.drama_id);
  }
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC').all(...params);
  return rows.map(rowToItem);
}

function rowToItem(r) {
  return {
    id: r.id,
    episode_id: r.episode_id,
    drama_id: r.drama_id,
    title: r.title,
    provider: r.provider,
    status: r.status,
    merged_url: r.merged_url,
    duration: r.duration ?? undefined,
    task_id: r.task_id,
    error_msg: r.error_msg ?? undefined,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}

function getById(db, id) {
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

function create(db, log, req) {
  const now = new Date().toISOString();
  const taskService = require('./taskService');
  const task = taskService.createTask(db, log, 'video_merge', String(req.episode_id || ''));
  const mergeOptionsJson = (() => {
    const o = req.merge_options;
    if (o && typeof o === 'object') return JSON.stringify(o);
    return '{}';
  })();
  const info = db.prepare(
    `INSERT INTO video_merges (episode_id, drama_id, title, provider, model, status, scenes, merge_options, task_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
  ).run(
    Number(req.episode_id) || 0,
    Number(req.drama_id) || 0,
    req.title ?? null,
    req.provider || 'ffmpeg',
    req.model ?? null,
    req.scenes ? JSON.stringify(req.scenes) : '[]',
    mergeOptionsJson,
    task.id,
    now
  );
  return { merge_id: info.lastInsertRowid, task_id: task.id, ...getById(db, info.lastInsertRowid) };
}

function deleteById(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE video_merges SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, Number(id));
  return result.changes > 0;
}

/** 获取 storage 根目录（绝对路径） */
function getStorageRoot() {
  const loadConfig = require('../config').loadConfig;
  const cfg = loadConfig();
  const p = cfg.storage?.local_path || './data/storage';
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

/** 将 video_url 解析为本地文件路径，或下载到 temp 返回路径 */
async function resolveVideoToLocalPath(videoUrl, baseUrl, storageRoot, tempDir, index, log) {
  if (!videoUrl || typeof videoUrl !== 'string') return null;
  const u = videoUrl.trim();
  // 1) URL 以 baseUrl 开头（如 http://localhost:5679/static）-> 对应 storageRoot 下相对路径
  if (baseUrl && (u.startsWith(baseUrl) || u.startsWith(baseUrl.replace(/\/$/, '')))) {
    const base = baseUrl.replace(/\/$/, '');
    const rel = u.startsWith(base + '/') ? u.slice(base.length + 1) : u.slice(base.length).replace(/^\//, '');
    if (rel && !rel.startsWith('http')) {
      const localPath = path.join(storageRoot, rel.replace(/\//g, path.sep));
      if (fs.existsSync(localPath)) {
        log.info('Video merge: using local static file', { index, path: localPath });
        return localPath;
      }
    }
  }
  // 2) 已是本地绝对路径且存在
  if (path.isAbsolute(u) && fs.existsSync(u)) {
    log.info('Video merge: using absolute path', { index, path: u });
    return u;
  }
  // 3) 相对路径（相对 storageRoot）
  if (!u.startsWith('http://') && !u.startsWith('https://')) {
    const localPath = path.join(storageRoot, u.replace(/^\//, '').replace(/\//g, path.sep));
    if (fs.existsSync(localPath)) {
      log.info('Video merge: using relative path', { index, path: localPath });
      return localPath;
    }
  }
  // 4) 远程 URL：下载到 temp
  const ext = u.includes('.mp4') ? '.mp4' : u.includes('.webm') ? '.webm' : '.mp4';
  const destPath = path.join(tempDir, `dl_${Date.now()}_${index}${ext}`);
  try {
    const res = await fetch(u, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    log.info('Video merge: downloaded to temp', { index, dest: destPath });
    return destPath;
  } catch (e) {
    log.warn('Video merge: download failed', { index, url: u, error: e.message });
    return null;
  }
}

/** 使用 ffmpeg concat 合并多个视频文件（先统一音视频参数，避免 -c copy 在镜间卡死） */
function probeClipSignature(filePath) {
  const ffprobeBin = getFfprobePath();
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync(
      ffprobeBin,
      [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,codec_name,width,height,sample_rate,channels',
        '-of', 'json',
        filePath,
      ],
      { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }
    );
    if (r.status !== 0) return null;
    const data = JSON.parse(r.stdout || '{}');
    const streams = Array.isArray(data.streams) ? data.streams : [];
    const v = streams.find((s) => s.codec_type === 'video');
    const a = streams.find((s) => s.codec_type === 'audio');
    return {
      hasVideo: !!v,
      hasAudio: !!a,
      vCodec: v?.codec_name || '',
      width: Number(v?.width) || 0,
      height: Number(v?.height) || 0,
      aCodec: a?.codec_name || '',
      sampleRate: Number(a?.sample_rate) || 0,
      channels: Number(a?.channels) || 0,
    };
  } catch (_) {
    return null;
  }
}

function clipsCompatibleForStreamCopy(sigs) {
  if (!sigs?.length || sigs.some((s) => !s)) return false;
  const first = sigs[0];
  if (!first.hasVideo) return false;
  return sigs.every(
    (s) =>
      s.hasVideo === first.hasVideo &&
      s.hasAudio === first.hasAudio &&
      s.vCodec === first.vCodec &&
      s.width === first.width &&
      s.height === first.height &&
      s.aCodec === first.aCodec &&
      s.sampleRate === first.sampleRate &&
      s.channels === first.channels
  );
}

/**
 * 将单镜规范为统一参数，供 concat demuxer + copy 安全拼接。
 * 典型坑：片头原片 AAC 32kHz stereo，旁白后处理片 AAC 22.05kHz mono → 浏览器播完第 1 镜后卡死。
 */
function normalizeClipForConcat(inputPath, outputPath, log) {
  const ffmpegBin = getFfmpegPath();
  const { spawnSync } = require('child_process');
  const sig = probeClipSignature(inputPath);
  const hasAudio = !!(sig && sig.hasAudio);

  const commonVideo = [
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
  ];
  const commonAudio = ['-c:a', 'aac', '-ar', '44100', '-ac', '2', '-b:a', '192k'];

  let args;
  if (hasAudio) {
    args = [
      '-y', '-i', inputPath,
      ...commonVideo,
      '-af', 'aformat=sample_rates=44100:channel_layouts=stereo,aresample=async=1:first_pts=0',
      ...commonAudio,
      '-movflags', '+faststart',
      outputPath,
    ];
  } else {
    // 无音轨：补静音，保证 concat 时每段都有 audio
    args = [
      '-y',
      '-i', inputPath,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      ...commonVideo,
      '-map', '0:v:0',
      '-map', '1:a:0',
      ...commonAudio,
      '-shortest',
      '-movflags', '+faststart',
      outputPath,
    ];
  }

  const result = spawnSync(ffmpegBin, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) {
    log.warn('Video merge: normalize spawn error', { error: result.error.message, input: inputPath });
    return false;
  }
  if (result.status !== 0) {
    log.warn('Video merge: normalize failed', {
      input: inputPath,
      stderr: result.stderr?.slice(-600),
    });
    return false;
  }
  return fs.existsSync(outputPath);
}

function runFfmpegConcatCopy(localPaths, outputPath, log) {
  const ffmpegBin = getFfmpegPath();
  const listFile = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);
  try {
    const lines = localPaths.map((p) => {
      const normalized = path.resolve(p).replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    });
    fs.writeFileSync(listFile, lines.join('\n'), 'utf8');
    const { spawnSync } = require('child_process');
    const args = [
      '-f', 'concat',
      '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ];
    const result = spawnSync(ffmpegBin, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (result.error) {
      log.warn('Video merge: ffmpeg spawn error', { error: result.error.message });
      return false;
    }
    if (result.status !== 0) {
      log.warn('Video merge: ffmpeg concat failed', { stderr: result.stderr?.slice(-500) });
      return false;
    }
    return fs.existsSync(outputPath);
  } finally {
    try {
      if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
    } catch (_) {}
  }
}

/** 使用 ffmpeg concat 合并多个视频文件 */
function runFfmpegConcat(localPaths, outputPath, log) {
  if (!localPaths?.length) return false;
  if (localPaths.length === 1) {
    try {
      fs.copyFileSync(localPaths[0], outputPath);
      return true;
    } catch (e) {
      log.warn('Video merge: single-clip copy failed', { error: e.message });
      return false;
    }
  }

  const sigs = localPaths.map((p) => probeClipSignature(p));
  const canCopy = clipsCompatibleForStreamCopy(sigs);
  if (canCopy) {
    log.info('Video merge: clips compatible, concat with stream copy', { count: localPaths.length });
    return runFfmpegConcatCopy(localPaths, outputPath, log);
  }

  log.info('Video merge: clips mismatched (e.g. sample rate/channels), normalizing before concat', {
    count: localPaths.length,
    signatures: sigs.map((s, i) =>
      s
        ? `#${i + 1} ${s.width}x${s.height} a=${s.sampleRate}/${s.channels}ch`
        : `#${i + 1} unknown`
    ),
  });

  const normDir = path.join(path.dirname(outputPath), `norm_${Date.now()}`);
  const normalized = [];
  try {
    fs.mkdirSync(normDir, { recursive: true });
    for (let i = 0; i < localPaths.length; i++) {
      const out = path.join(normDir, `clip_${String(i).padStart(3, '0')}.mp4`);
      if (!normalizeClipForConcat(localPaths[i], out, log)) {
        log.warn('Video merge: normalize clip failed', { index: i, path: localPaths[i] });
        return false;
      }
      normalized.push(out);
    }
    return runFfmpegConcatCopy(normalized, outputPath, log);
  } finally {
    for (const p of normalized) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (_) {}
    }
    try {
      if (fs.existsSync(normDir)) fs.rmSync(normDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * 异步处理视频合成：优先使用 ffmpeg 真正合并多段视频；失败或无 ffmpeg 时用首段作为 merged_url。
 */
async function processVideoMerge(db, log, mergeId, baseUrl) {
  const r = db.prepare('SELECT * FROM video_merges WHERE id = ? AND deleted_at IS NULL').get(mergeId);
  if (!r) return;
  const taskId = r.task_id;
  const episodeId = r.episode_id;
  let scenes = [];
  try {
    scenes = JSON.parse(r.scenes || '[]');
  } catch (_) {
    log.warn('video merge parse scenes failed', { merge_id: mergeId });
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE video_merges SET status = ? WHERE id = ?').run('processing', mergeId);
  const taskService = require('./taskService');
  if (scenes.length === 0) {
    db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', '无有效视频片段', mergeId);
    if (taskId) taskService.updateTaskError(db, taskId, '无有效视频片段');
    return;
  }
  const first = scenes[0];
  const mergedUrlFallback = first && first.video_url ? first.video_url : null;
  if (!mergedUrlFallback) {
    db.prepare('UPDATE video_merges SET status = ?, error_msg = ? WHERE id = ?').run('failed', '首段无视频地址', mergeId);
    if (taskId) taskService.updateTaskError(db, taskId, '首段无视频地址');
    return;
  }

  const totalDuration = scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
  const storageRoot = getStorageRoot();
  const tempDir = path.join(require('os').tmpdir(), 'drama-video-merge');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const localPaths = [];
  const toCleanup = [];
  for (let i = 0; i < scenes.length; i++) {
    const p = await resolveVideoToLocalPath(
      scenes[i].video_url,
      baseUrl,
      storageRoot,
      tempDir,
      i,
      log
    );
    if (p) {
      localPaths.push(p);
      if (p.startsWith(tempDir)) toCleanup.push(p);
    }
  }

  const ffmpegAvailable = hasLocalFfmpeg();
  log.info('Video merge: ffmpeg check', {
    merge_id: mergeId,
    has_ffmpeg: ffmpegAvailable,
    ffmpeg_path: getFfmpegPath(),
    local_video_count: localPaths.length,
    cwd: process.cwd(),
  });

  let mergedRelativePath = null;
  let postProcessWarning = null;
  let postProcessError = null;
  if (localPaths.length > 0 && ffmpegAvailable && localPaths.length <= 100) {
    const projectSubdir = storageLayout.getProjectStorageSubdir(db, r.drama_id);
    const sub = projectSubdir && String(projectSubdir).trim();
    const mergedDir = sub
      ? path.join(storageRoot, sub, 'videos', 'merged')
      : path.join(storageRoot, 'videos', 'merged');
    if (!fs.existsSync(mergedDir)) fs.mkdirSync(mergedDir, { recursive: true });
    const outputFileName = `merged_${Date.now()}.mp4`;
    const outputPath = path.join(mergedDir, outputFileName);
    const ok = runFfmpegConcat(localPaths, outputPath, log);
    if (ok && fs.existsSync(outputPath)) {
      mergedRelativePath = sub
        ? path.join(sub, 'videos', 'merged', outputFileName).replace(/\\/g, '/')
        : path.join('videos', 'merged', outputFileName).replace(/\\/g, '/');
      log.info('Video merge completed (ffmpeg)', { merge_id: mergeId, episode_id: episodeId, output: mergedRelativePath });
    }
  }

  let mergeOpts = {};
  try {
    mergeOpts = JSON.parse(r.merge_options || '{}');
  } catch (_) {
    mergeOpts = {};
  }
  const postNeed =
    !!mergeOpts.burn_narration_subtitles
    || !!mergeOpts.burn_dialogue_audio
    || !!mergeOpts.use_indextts_narration
    || !!(mergeOpts.watermark_text && String(mergeOpts.watermark_text).trim());
  if (mergedRelativePath && ffmpegAvailable && postNeed) {
    if (!hasLocalFfprobe()) {
      postProcessError = '未找到 ffprobe，无法对齐音轨/字幕（请将 ffprobe.exe 与 ffmpeg 放在同一目录）';
      log.warn('Video merge: ffprobe missing, post-process skipped', { merge_id: mergeId });
    } else {
    const mergedAbsPath = path.join(storageRoot, mergedRelativePath.replace(/\//g, path.sep));
    if (fs.existsSync(mergedAbsPath)) {
      const mergedPP = require('./mergedEpisodePostProcess');
      const post = await mergedPP.runMergedEpisodePostProcess(db, log, {
        mergedAbsPath,
        storageRoot,
        scenes,
        episodeId,
        mergeOpts,
      });
      if (post.ok && post.relativePath) {
        mergedRelativePath = post.relativePath;
        postProcessWarning = post.warning || null;
        log.info('Video merge: merged episode post-process', { merge_id: mergeId, out: mergedRelativePath });
      } else if (post.error && post.error !== 'NO_POST_OPTS') {
        postProcessError = post.error;
        log.warn('Video merge: post-process skipped', { merge_id: mergeId, err: post.error });
      }
    }
    }
  }

  for (const p of toCleanup) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }

  const finalMergedUrl = mergedRelativePath || mergedUrlFallback;
  const mergeErrorMsg = postProcessError
    || (postProcessWarning ? `后处理部分成功：${postProcessWarning}` : null);
  db.prepare(
    'UPDATE video_merges SET status = ?, merged_url = ?, duration = ?, completed_at = ?, error_msg = ? WHERE id = ?'
  ).run('completed', finalMergedUrl, Math.round(totalDuration) || null, now, mergeErrorMsg, mergeId);
  db.prepare('UPDATE episodes SET video_url = ?, status = ?, updated_at = ? WHERE id = ?').run(finalMergedUrl, 'completed', now, episodeId);
  if (taskId) {
    taskService.updateTaskResult(db, taskId, {
      merge_id: mergeId,
      video_url: finalMergedUrl,
      duration: Math.round(totalDuration),
      post_warning: postProcessWarning || undefined,
      post_error: postProcessError || undefined,
    });
  }
  if (!mergedRelativePath) {
    log.info('Video merge completed (first-clip fallback)', { merge_id: mergeId, episode_id: episodeId });
  }
}

module.exports = {
  list,
  getById,
  create,
  deleteById,
  processVideoMerge,
};
