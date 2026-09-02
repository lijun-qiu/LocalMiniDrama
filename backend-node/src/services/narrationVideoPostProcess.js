/**
 * 合成后处理：解说旁白 SRT、按分镜时长生成/加速/补齐旁白 TTS，烧录字幕并与旁白音轨 mux。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const { fitNarrationAudioToSlot, alignNarrationAudioToVideoDuration, extendVideoToDuration } = require('../utils/narrationAudioFit');

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

function formatSrtTimestamp(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const z = Math.floor(ms % 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(z).padStart(3, '0')}`;
}

/** 构造 atempo 链，总倍率 = factor（>1 加速变短） */
function buildAtempoChain(factor) {
  if (!Number.isFinite(factor) || factor <= 0) return null;
  if (Math.abs(factor - 1) < 0.002) return null;
  const parts = [];
  let f = factor;
  while (f > 2.001) {
    parts.push('atempo=2');
    f /= 2;
  }
  while (f < 0.499) {
    parts.push('atempo=0.5');
    f /= 0.5;
  }
  parts.push(`atempo=${Math.min(2, Math.max(0.5, f))}`);
  return parts.join(',');
}

function escapeSubtitlesPathForFfmpeg(absPath) {
  let s = path.resolve(absPath).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(s)) s = s.replace(/^([A-Za-z]):/, '$1\\:');
  return s.replace(/'/g, "\\'");
}

function runFfmpeg(args, log, tag) {
  const bin = getFfmpegPath();
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (r.error) {
    log.warn('narration post: ffmpeg spawn', { tag, error: r.error.message });
    return false;
  }
  if (r.status !== 0) {
    log.warn('narration post: ffmpeg failed', { tag, stderr: r.stderr?.slice(-800) });
    return false;
  }
  return true;
}

function writeSilenceMp3(slotSec, outPath, log) {
  return runFfmpeg(
    [
      '-y',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-t', String(slotSec),
      '-c:a', 'libmp3lame', '-q:a', '6',
      outPath,
    ],
    log,
    'silence'
  );
}

/**
 * 将单段音频调整为精确时长 slotSec：过长则加速，过短则尾部静音补齐。
 */
function fitAudioToSlot(inputPath, slotSec, outPath, log) {
  const d = ffprobeDurationSec(inputPath);
  if (d == null || d <= 0.01) return false;
  const eps = 0.06;
  if (d > slotSec + eps) {
    const factor = d / slotSec;
    const chain = buildAtempoChain(factor);
    const af = chain || 'anull';
    return runFfmpeg(
      ['-y', '-i', inputPath, '-af', af, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_speed'
    );
  }
  if (d < slotSec - eps) {
    const pad = slotSec - d;
    return runFfmpeg(
      ['-y', '-i', inputPath, '-af', `apad=pad_dur=${pad}`, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_pad'
    );
  }
  try {
    fs.copyFileSync(inputPath, outPath);
    return true;
  } catch (_) {
    return runFfmpeg(
      ['-y', '-i', inputPath, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_copy'
    );
  }
}

function concatMp3List(segmentPaths, outPath, log) {
  const listFile = path.join(path.dirname(outPath), `narr_concat_${Date.now()}.txt`);
  try {
    const lines = segmentPaths.map((p) => {
      const normalized = path.resolve(p).replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    });
    fs.writeFileSync(listFile, lines.join('\n'), 'utf8');
    return runFfmpeg(
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'concat_narr'
    );
  } finally {
    try {
      if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
    } catch (_) {}
  }
}

/**
 * @deprecated 使用 alignNarrationAudioToVideoDuration（旁白不加速）
 */
function alignNarrationToVideoDuration(narrMp3, videoDur, outPath, log) {
  const r = alignNarrationAudioToVideoDuration(narrMp3, videoDur, outPath, log, ffprobeDurationSec);
  return r.ok;
}

function burnSubtitlesAndMux(mergedVideoPath, narrAlignedMp3, srtPath, outPath, log, subtitleStyle) {
  const sub = escapeSubtitlesPathForFfmpeg(srtPath);
  const forceStyle = subtitleStyle || "FontSize=24,Outline=2,Shadow=1,Bold=1,Alignment=2,MarginV=12";
  const vf = `subtitles='${sub}':charenc=UTF-8:force_style='${forceStyle}'`;
  const args = [
    '-y',
    '-i', mergedVideoPath,
    '-i', narrAlignedMp3,
    '-filter_complex', `[0:v]${vf}[v]`,
    '-map', '[v]',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-ar', '44100',
    '-ac', '2',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-shortest',
    outPath,
  ];
  return runFfmpeg(args, log, 'burn_mux');
}

/**
 * @returns {Promise<{ ok: boolean, relativePath?: string, error?: string }>}
 */
async function runNarrationSubtitlePostProcess(db, log, opts) {
  const {
    mergedAbsPath,
    mergedRelativePath,
    projectSubdir,
    storageRoot,
    scenes,
    episodeId,
  } = opts;

  if (!mergedAbsPath || !fs.existsSync(mergedAbsPath) || !Array.isArray(scenes) || scenes.length === 0) {
    return { ok: false, error: '无效合成参数' };
  }

  const videoDur = ffprobeDurationSec(mergedAbsPath);
  if (videoDur == null) {
    return { ok: false, error: '无法读取合成视频时长' };
  }

  let tMs = 0;
  const srtLines = [];
  let srtIdx = 1;
  const segmentFiles = [];
  const tempRoot = path.join(require('os').tmpdir(), 'drama-narr-post', String(episodeId || 0), String(Date.now()));
  fs.mkdirSync(tempRoot, { recursive: true });
  const ttsService = require('./ttsService');

  try {
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const sbId = Number(sc.scene_id);
      const slotSec = Math.max(0.2, Number(sc.duration) || 5);
      const row = db.prepare('SELECT narration FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sbId);
      const text = (row?.narration && String(row.narration).trim()) ? String(row.narration).trim() : '';

      if (text) {
        const durMs = Math.round(slotSec * 1000);
        const start = formatSrtTimestamp(tMs);
        const end = formatSrtTimestamp(tMs + durMs);
        srtLines.push(String(srtIdx++), `${start} --> ${end}`, text, '');
      }
      tMs += Math.round(slotSec * 1000);

      const segFit = path.join(tempRoot, `seg_${i}_fit.mp3`);

      if (!text) {
        if (!writeSilenceMp3(slotSec, segFit, log)) {
          return { ok: false, error: `生成静音片段失败 #${i}` };
        }
      } else {
        const segRaw = path.join(tempRoot, `seg_${i}_raw.mp3`);
        let synth;
        try {
          synth = await ttsService.synthesize(db, log, {
            text,
            storyboard_id: null,
            storage_base: storageRoot,
          });
        } catch (e) {
          log.warn('narration post: TTS failed', { segment: i, error: e.message });
          return { ok: false, error: `旁白 TTS 失败：${e.message}` };
        }
        const srcAbs = path.join(storageRoot, synth.local_path.replace(/\//g, path.sep));
        if (!fs.existsSync(srcAbs)) {
          return { ok: false, error: `TTS 文件不存在：${synth.local_path}` };
        }
        try {
          fs.copyFileSync(srcAbs, segRaw);
        } catch (_) {
          return { ok: false, error: '复制 TTS 文件失败' };
        }
        if (!fitNarrationAudioToSlot(segRaw, slotSec, segFit, log, {
          ffprobeDurationSec,
          allowTrim: true,
        })) {
          return { ok: false, error: `旁白时长对齐失败 #${i}` };
        }
      }
      segmentFiles.push(segFit);
    }

    if (srtLines.length === 0) {
      log.info('narration post: skip (no narration text in merged scenes)', { episode_id: episodeId });
      return { ok: false, error: 'NO_NARRATION' };
    }

    const narrConcat = path.join(tempRoot, 'narr_concat.mp3');
    if (!concatMp3List(segmentFiles, narrConcat, log)) {
      return { ok: false, error: '旁白拼接失败' };
    }

    const narrAligned = path.join(tempRoot, 'narr_aligned.mp3');
    const align = alignNarrationAudioToVideoDuration(narrConcat, videoDur, narrAligned, log, ffprobeDurationSec);
    if (!align.ok) {
      return { ok: false, error: '旁白与视频总时长对齐失败' };
    }
    let videoForMux = mergedAbsPath;
    const outputVideoDur = align.outputVideoDur;
    if (align.extended && outputVideoDur > videoDur + 0.05) {
      const extendedVideo = path.join(tempRoot, 'merged_extended.mp4');
      if (!extendVideoToDuration(mergedAbsPath, outputVideoDur, extendedVideo, log, ffprobeDurationSec)) {
        return { ok: false, error: '旁白长于视频且延长画面失败' };
      }
      videoForMux = extendedVideo;
    }

    const baseName = path.basename(mergedAbsPath, path.extname(mergedAbsPath));
    const srtPath = path.join(path.dirname(mergedAbsPath), `${baseName}_narration.srt`);
    fs.writeFileSync(srtPath, `\uFEFF${srtLines.join('\n')}\n`, 'utf8');

    const outAbs = path.join(path.dirname(mergedAbsPath), `${baseName}_subs.mp4`);
    let dramaId = null;
    if (episodeId) {
      try {
        dramaId = db.prepare('SELECT drama_id FROM episodes WHERE id = ?').get(Number(episodeId))?.drama_id ?? null;
      } catch (_) {}
    }
    const { resolveSubtitleForceStyleAsync } = require('../utils/subtitleBurnStyle');
    const subtitleStyle = await resolveSubtitleForceStyleAsync(db, log, {
      dramaId,
      episodeId,
      videoAbsPath: videoForMux,
      videoDurSec: outputVideoDur,
      fullNarration: true,
    });
    if (!burnSubtitlesAndMux(videoForMux, narrAligned, srtPath, outAbs, log, subtitleStyle)) {
      return { ok: false, error: '烧录字幕或混音失败（请确认已安装 ffmpeg 且支持 libx264）' };
    }

    if (!fs.existsSync(outAbs)) {
      return { ok: false, error: '输出文件未生成' };
    }

    const relFromRoot = path.relative(storageRoot, outAbs).replace(/\\/g, '/');
    const subRel = path.relative(storageRoot, srtPath).replace(/\\/g, '/');

    try {
      if (fs.existsSync(mergedAbsPath) && outAbs !== mergedAbsPath) {
        fs.unlinkSync(mergedAbsPath);
      }
    } catch (e) {
      log.warn('narration post: could not remove intermediate merge', { error: e.message });
    }

    log.info('narration post: done', { episode_id: episodeId, video: relFromRoot, srt: subRel });

    return { ok: true, relativePath: relFromRoot, srtRelativePath: subRel };
  } catch (e) {
    log.warn('narration post: exception', { error: e.message });
    return { ok: false, error: e.message || String(e) };
  } finally {
    try {
      for (const p of fs.readdirSync(tempRoot)) {
        try {
          fs.unlinkSync(path.join(tempRoot, p));
        } catch (_) {}
      }
      fs.rmdirSync(tempRoot);
    } catch (_) {}
  }
}

module.exports = {
  runNarrationSubtitlePostProcess,
  ffprobeDurationSec,
};
