/**
 * 整集合并后的后处理：对白 TTS 轨、解说旁白轨+SRT、右下角文字水印（可组合）。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const { splitNarrationLines } = require('../utils/narrationLineSplit');

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

function escapeFfmpegPath(absPath) {
  let s = path.resolve(absPath).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(s)) s = s.replace(/^([A-Za-z]):/, '$1\\:');
  return s.replace(/'/g, "\\'");
}

function runFfmpeg(args, log, tag) {
  const bin = getFfmpegPath();
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) {
    log.warn('merged post: ffmpeg spawn', { tag, error: r.error.message });
    return false;
  }
  if (r.status !== 0) {
    log.warn('merged post: ffmpeg failed', { tag, stderr: r.stderr?.slice(-1000) });
    return false;
  }
  return true;
}

function resolveStorageAudioAbs(storageRoot, relPath) {
  const rel = relPath && String(relPath).trim();
  if (!rel) return null;
  const abs = path.join(storageRoot, rel.replace(/\//g, path.sep));
  return fs.existsSync(abs) ? abs : null;
}

/** 烧录字幕样式：描边保证可读 */
const SUBTITLE_FORCE_STYLE = "FontSize=36,Outline=2,Shadow=1,Bold=1,MarginV=48";
/** 全文解说旁白视频模式：字号略小，避免逐句字幕占屏过多 */
const FULL_NARRATION_SUBTITLE_FORCE_STYLE = "FontSize=24,Outline=2,Shadow=1,Bold=1,MarginV=48";

function resolveSubtitleForceStyle(db, episodeId) {
  if (!db || !episodeId) return SUBTITLE_FORCE_STYLE;
  try {
    const ep = db.prepare('SELECT drama_id FROM episodes WHERE id = ?').get(episodeId);
    const videoClient = require('./videoClient');
    if (videoClient.isDramaFullNarrationVideoMode(db, ep?.drama_id)) {
      return FULL_NARRATION_SUBTITLE_FORCE_STYLE;
    }
  } catch (_) { /* fall through */ }
  return SUBTITLE_FORCE_STYLE;
}

function buildVideoFilterParts(srtPath, watermarkText, tempRoot, subtitleStyle = SUBTITLE_FORCE_STYLE) {
  const vfParts = [];
  if (srtPath && fs.existsSync(srtPath)) {
    const simpleSrt = path.join(tempRoot, 'burn_subs.srt');
    try { fs.copyFileSync(srtPath, simpleSrt); } catch (_) { /* use original */ }
    const subEsc = escapeFfmpegPath(fs.existsSync(simpleSrt) ? simpleSrt : srtPath);
    vfParts.push(`subtitles='${subEsc}':charenc=UTF-8:force_style='${subtitleStyle}'`);
  }
  if (watermarkText) {
    const wmFile = path.join(tempRoot, 'watermark.txt');
    fs.writeFileSync(wmFile, watermarkText, 'utf8');
    const wmEsc = escapeFfmpegPath(wmFile);
    const fontOpt = getDrawtextFontOption();
    vfParts.push(
      `drawtext=textfile='${wmEsc}':reload=1${fontOpt}:x=w-tw-16:y=h-th-16:fontsize=22:fontcolor=white@0.82:borderw=2:bordercolor=black@0.55`
    );
  }
  let filterComplex = '';
  if (vfParts.length === 1) {
    filterComplex = `[0:v]${vfParts[0]}[vout]`;
  } else if (vfParts.length === 2) {
    filterComplex = `[0:v]${vfParts[0]}[vx];[vx]${vfParts[1]}[vout]`;
  }
  return filterComplex;
}

function muxVideoWithAudio(mergedAbsPath, alignedAudioPath, outAbs, filterComplex, log, tag) {
  const args = ['-y', '-i', mergedAbsPath, '-i', alignedAudioPath];
  if (filterComplex) {
    args.push('-filter_complex', filterComplex, '-map', '[vout]', '-map', '1:a');
  } else {
    args.push('-map', '0:v', '-map', '1:a');
  }
  args.push(
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', outAbs
  );
  return runFfmpeg(args, log, tag);
}

function writeSilenceMp3(slotSec, outPath, log) {
  return runFfmpeg(
    ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '6', outPath],
    log,
    'silence'
  );
}

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
  const listFile = path.join(path.dirname(outPath), `mix_concat_${Date.now()}.txt`);
  try {
    const lines = segmentPaths.map((p) => {
      const normalized = path.resolve(p).replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    });
    fs.writeFileSync(listFile, lines.join('\n'), 'utf8');
    return runFfmpeg(
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'concat_mix'
    );
  } finally {
    try {
      if (fs.existsSync(listFile)) fs.unlinkSync(listFile);
    } catch (_) {}
  }
}

function alignAudioToVideoDuration(inMp3, videoDur, outPath, log) {
  const n = ffprobeDurationSec(inMp3);
  if (n == null || !Number.isFinite(videoDur) || videoDur <= 0.1) return false;
  const eps = 0.08;
  if (n > videoDur + eps) {
    const factor = n / videoDur;
    const chain = buildAtempoChain(factor);
    if (!chain) {
      try {
        fs.copyFileSync(inMp3, outPath);
        return true;
      } catch (_) {
        return false;
      }
    }
    return runFfmpeg(
      ['-y', '-i', inMp3, '-af', chain, '-t', String(videoDur), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'align_speed'
    );
  }
  if (n < videoDur - eps) {
    const pad = videoDur - n;
    return runFfmpeg(
      ['-y', '-i', inMp3, '-af', `apad=pad_dur=${pad}`, '-t', String(videoDur), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'align_pad'
    );
  }
  try {
    fs.copyFileSync(inMp3, outPath);
    return true;
  } catch (_) {
    return false;
  }
}

function amixTwoTracks(pathA, pathB, slotSec, outPath, log) {
  return runFfmpeg(
    [
      '-y', '-i', pathA, '-i', pathB,
      '-filter_complex', `[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      '-map', '[aout]',
      '-t', String(slotSec),
      '-c:a', 'libmp3lame', '-q:a', '4',
      outPath,
    ],
    log,
    'amix_seg'
  );
}

function getDrawtextFontOption() {
  const candidates = [];
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    candidates.push(
      path.join(root, 'Fonts', 'msyh.ttc'),
      path.join(root, 'Fonts', 'msyhbd.ttc'),
      path.join(root, 'Fonts', 'simhei.ttf')
    );
  }
  candidates.push('/System/Library/Fonts/PingFang.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      return `:fontfile='${escapeFfmpegPath(p)}'`;
    }
  }
  return '';
}

function buildNarrationTtsOpts(mergeOpts) {
  if (!mergeOpts?.use_indextts_narration) return {};
  const opts = {
    provider: 'indextts',
    voice_id: mergeOpts.indextts_voice || 'gsv:008',
    emotion_text: mergeOpts.indextts_emotion || '自然流畅的解说语气，情绪饱满',
  };
  if (mergeOpts.indextts_speed != null && mergeOpts.indextts_speed !== '') {
    const s = Number(mergeOpts.indextts_speed);
    if (Number.isFinite(s) && s > 0) opts.speed = s;
  }
  return opts;
}

function usePerLineNarration(mergeOpts) {
  if (mergeOpts?.use_indextts_narration) return true;
  return mergeOpts?.narration_subtitle_mode === 'per_line';
}

/**
 * 逐句合成旁白并生成 SRT 行（一句一显）
 * @returns {{ narrFitPath: string, srtEntries: Array<{ startMs: number, endMs: number, text: string }> }}
 */
async function synthesizeNarrationPerLine(db, log, opts) {
  const {
    narrText, slotSec, tempRoot, shotIndex, storageRoot, mergeOpts, shotStartMs,
  } = opts;
  const lines = splitNarrationLines(narrText);
  const effectiveLines = lines.length ? lines : [narrText.trim()];
  const ttsOpts = buildNarrationTtsOpts(mergeOpts);
  const lineRawPaths = [];
  const lineDurations = [];

  for (let j = 0; j < effectiveLines.length; j++) {
    const lineText = effectiveLines[j];
    const rawPath = path.join(tempRoot, `narr_line_raw_${shotIndex}_${j}.mp3`);
    let synth;
    try {
      synth = await require('./ttsService').synthesize(db, log, {
        text: lineText,
        storyboard_id: null,
        storage_base: storageRoot,
        ...ttsOpts,
      });
    } catch (e) {
      throw new Error(`解说 TTS 失败（第 ${j + 1} 句）：${e.message}`);
    }
    const srcAbs = synth.abs_path || path.join(storageRoot, synth.local_path.replace(/\//g, path.sep));
    if (!fs.existsSync(srcAbs)) throw new Error(`旁白 TTS 文件不存在：${lineText.slice(0, 20)}`);
    try { fs.copyFileSync(srcAbs, rawPath); } catch (_) { throw new Error('复制旁白 TTS 失败'); }
    lineRawPaths.push(rawPath);
    const d = ffprobeDurationSec(rawPath);
    lineDurations.push(Math.max(0.15, d || 0.5));
  }

  const naturalTotal = lineDurations.reduce((a, b) => a + b, 0);
  const slotEps = 0.06;
  const scale = naturalTotal > slotSec + slotEps ? slotSec / naturalTotal : 1;
  const scaledDurations = lineDurations.map((d) => d * scale);

  const srtEntries = [];
  let offsetSec = 0;
  const lineFitPaths = [];
  for (let j = 0; j < effectiveLines.length; j++) {
    const targetDur = scaledDurations[j];
    const fitPath = path.join(tempRoot, `narr_line_fit_${shotIndex}_${j}.mp3`);
    if (!fitAudioToSlot(lineRawPaths[j], targetDur, fitPath, log)) {
      throw new Error(`旁白第 ${j + 1} 句时长对齐失败`);
    }
    lineFitPaths.push(fitPath);
    const startMs = shotStartMs + Math.round(offsetSec * 1000);
    const endMs = shotStartMs + Math.round((offsetSec + targetDur) * 1000);
    srtEntries.push({ startMs, endMs, text: effectiveLines[j] });
    offsetSec += targetDur;
  }

  const narrFit = path.join(tempRoot, `narr_fit_${shotIndex}.mp3`);
  if (lineFitPaths.length === 1) {
    try { fs.copyFileSync(lineFitPaths[0], narrFit); } catch (_) { throw new Error('旁白片段复制失败'); }
  } else if (!concatMp3List(lineFitPaths, narrFit, log)) {
    throw new Error('旁白逐句拼接失败');
  }
  if (offsetSec < slotSec - slotEps) {
    const padded = path.join(tempRoot, `narr_fit_pad_${shotIndex}.mp3`);
    if (!fitAudioToSlot(narrFit, slotSec, padded, log)) throw new Error('旁白补静音失败');
    try { fs.copyFileSync(padded, narrFit); } catch (_) { throw new Error('旁白片段复制失败'); }
  }

  return { narrFitPath: narrFit, srtEntries };
}

/**
 * 使用预生成旁白音频时，按逐句拆分与可读字权重分配字幕时间轴（不再重复 TTS）
 */
function buildSrtEntriesFromPrebuiltNarration(narrText, slotSec, shotStartMs = 0) {
  const lines = splitNarrationLines(narrText);
  const effectiveLines = lines.length ? lines : [String(narrText || '').trim()].filter(Boolean);
  if (!effectiveLines.length || !Number.isFinite(slotSec) || slotSec <= 0) return [];

  const weights = effectiveLines.map((line) => {
    const readable = String(line).replace(/[^\u4e00-\u9fff\w]/g, '');
    return Math.max(1, readable.length || String(line).length || 1);
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const srtEntries = [];
  let offsetSec = 0;
  for (let j = 0; j < effectiveLines.length; j++) {
    const targetDur = slotSec * (weights[j] / totalWeight);
    const startMs = shotStartMs + Math.round(offsetSec * 1000);
    const endMs = shotStartMs + Math.round((offsetSec + targetDur) * 1000);
    srtEntries.push({ startMs, endMs, text: effectiveLines[j] });
    offsetSec += targetDur;
  }
  if (srtEntries.length) {
    srtEntries[srtEntries.length - 1].endMs = shotStartMs + Math.round(slotSec * 1000);
  }
  return srtEntries;
}

async function synthesizeNarrationWhole(db, log, opts) {
  const { narrText, slotSec, tempRoot, shotIndex, storageRoot, mergeOpts } = opts;
  const segRaw = path.join(tempRoot, `narr_raw_${shotIndex}.mp3`);
  const narrFit = path.join(tempRoot, `narr_fit_${shotIndex}.mp3`);
  const ttsOpts = buildNarrationTtsOpts(mergeOpts);
  let synth;
  try {
    synth = await require('./ttsService').synthesize(db, log, {
      text: narrText,
      storyboard_id: null,
      storage_base: storageRoot,
      ...ttsOpts,
    });
  } catch (e) {
    throw new Error(`解说旁白 TTS 失败：${e.message}`);
  }
  const narrAbs = synth.abs_path || path.join(storageRoot, synth.local_path.replace(/\//g, path.sep));
  if (!fs.existsSync(narrAbs)) throw new Error('旁白 TTS 文件不存在');
  try { fs.copyFileSync(narrAbs, segRaw); } catch (_) { throw new Error('复制旁白 TTS 失败'); }
  if (!fitAudioToSlot(segRaw, slotSec, narrFit, log)) {
    throw new Error(`旁白时长对齐失败 #${shotIndex}`);
  }
  return { narrFitPath: narrFit, srtEntries: null };
}

/**
 * @param {object} mergeOpts — burn_dialogue_audio, burn_narration_subtitles, watermark_text,
 *   use_indextts_narration, indextts_voice, indextts_emotion, narration_subtitle_mode
 */
async function runMergedEpisodePostProcess(db, log, opts) {
  const { mergedAbsPath, storageRoot, scenes, episodeId, mergeOpts = {} } = opts;
  const wantDial = !!mergeOpts.burn_dialogue_audio;
  let wantNarr = !!mergeOpts.burn_narration_subtitles || !!mergeOpts.use_indextts_narration;
  const watermarkText = (mergeOpts.watermark_text && String(mergeOpts.watermark_text).trim())
    ? String(mergeOpts.watermark_text).trim().slice(0, 200)
    : '';

  if (!mergedAbsPath || !fs.existsSync(mergedAbsPath) || !Array.isArray(scenes) || scenes.length === 0) {
    return { ok: false, error: '无效合成参数' };
  }

  // 全文解说：单镜生成后已跑过 runStoryboardNarrationPostProcess（混旁白 + 烧字幕）。
  // 成片再烧一遍会叠出「两层字幕」，旁白音轨也会重复；此处跳过旁白后处理。
  if (wantNarr && episodeId) {
    try {
      const ep = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
      const { isDramaFullNarrationVideoMode } = require('./videoClient');
      if (ep?.drama_id && isDramaFullNarrationVideoMode(db, ep.drama_id)) {
        wantNarr = false;
        log.info('merged post: skip narration burn/mix (already applied per storyboard)', {
          episode_id: episodeId,
          drama_id: ep.drama_id,
        });
      }
    } catch (_) {}
  }

  const needAudio = wantDial || wantNarr;
  if (!needAudio && !watermarkText) {
    return { ok: false, error: 'NO_POST_OPTS' };
  }

  const videoDur = ffprobeDurationSec(mergedAbsPath);
  if (videoDur == null) {
    return { ok: false, error: '无法读取合成视频时长' };
  }

  const tempRoot = path.join(require('os').tmpdir(), 'drama-merged-post', String(episodeId || 0), String(Date.now()));
  fs.mkdirSync(tempRoot, { recursive: true });

  try {
    let alignedAudioPath = null;
    let srtPath = null;
    let srtLines = [];

    if (needAudio) {
      let tMs = 0;
      let srtIdx = 1;
      const segmentFiles = [];

      for (let i = 0; i < scenes.length; i++) {
        const sc = scenes[i];
        const sbId = Number(sc.scene_id);
        const slotSec = Math.max(0.2, Number(sc.duration) || 5);
        const row = db.prepare(
          'SELECT dialogue, narration, audio_local_path, narration_audio_local_path FROM storyboards WHERE id = ? AND deleted_at IS NULL'
        ).get(sbId);

        const narrText = (row?.narration && String(row.narration).trim()) ? String(row.narration).trim() : '';
        const perLine = usePerLineNarration(mergeOpts);
        const shotStartMs = tMs;

        const diaFit = path.join(tempRoot, `dia_fit_${i}.mp3`);
        const narrFit = path.join(tempRoot, `narr_fit_${i}.mp3`);
        const segOut = path.join(tempRoot, `seg_mix_${i}.mp3`);

        if (wantDial) {
          const rel = row?.audio_local_path && String(row.audio_local_path).trim();
          const srcAbs = rel ? path.join(storageRoot, rel.replace(/\//g, path.sep)) : null;
          if (srcAbs && fs.existsSync(srcAbs)) {
            if (!fitAudioToSlot(srcAbs, slotSec, diaFit, log)) {
              return { ok: false, error: `对白配音时长对齐失败 #${i}` };
            }
          } else if (!writeSilenceMp3(slotSec, diaFit, log)) {
            return { ok: false, error: `对白静音片段失败 #${i}` };
          }
        }

        if (wantNarr) {
          const prebuiltNarrAbs = resolveStorageAudioAbs(storageRoot, row?.narration_audio_local_path);
          if (!narrText && !prebuiltNarrAbs) {
            if (!writeSilenceMp3(slotSec, narrFit, log)) {
              return { ok: false, error: `旁白静音片段失败 #${i}` };
            }
          } else if (prebuiltNarrAbs) {
            if (perLine && narrText) {
              const srtEntries = buildSrtEntriesFromPrebuiltNarration(narrText, slotSec, shotStartMs);
              for (const entry of srtEntries) {
                srtLines.push(
                  String(srtIdx++),
                  `${formatSrtTimestamp(entry.startMs)} --> ${formatSrtTimestamp(entry.endMs)}`,
                  entry.text,
                  ''
                );
              }
            } else if (narrText) {
              const durMs = Math.round(slotSec * 1000);
              srtLines.push(String(srtIdx++), `${formatSrtTimestamp(shotStartMs)} --> ${formatSrtTimestamp(shotStartMs + durMs)}`, narrText, '');
            }
            if (!fitAudioToSlot(prebuiltNarrAbs, slotSec, narrFit, log)) {
              return { ok: false, error: `旁白配音时长对齐失败 #${i}` };
            }
          } else if (perLine) {
            try {
              const { narrFitPath, srtEntries } = await synthesizeNarrationPerLine(db, log, {
                narrText,
                slotSec,
                tempRoot,
                shotIndex: i,
                storageRoot,
                mergeOpts,
                shotStartMs,
              });
              for (const entry of srtEntries) {
                srtLines.push(
                  String(srtIdx++),
                  `${formatSrtTimestamp(entry.startMs)} --> ${formatSrtTimestamp(entry.endMs)}`,
                  entry.text,
                  ''
                );
              }
              try { fs.copyFileSync(narrFitPath, narrFit); } catch (_) { return { ok: false, error: `旁白片段复制失败 #${i}` }; }
            } catch (e) {
              log.warn('merged post: per-line narration failed', { segment: i, error: e.message });
              return { ok: false, error: e.message };
            }
          } else {
            const durMs = Math.round(slotSec * 1000);
            srtLines.push(String(srtIdx++), `${formatSrtTimestamp(shotStartMs)} --> ${formatSrtTimestamp(shotStartMs + durMs)}`, narrText, '');
            try {
              const { narrFitPath } = await synthesizeNarrationWhole(db, log, {
                narrText,
                slotSec,
                tempRoot,
                shotIndex: i,
                storageRoot,
                mergeOpts,
              });
              try { fs.copyFileSync(narrFitPath, narrFit); } catch (_) { return { ok: false, error: `旁白片段复制失败 #${i}` }; }
            } catch (e) {
              log.warn('merged post: narration TTS failed', { segment: i, error: e.message });
              return { ok: false, error: e.message };
            }
          }
        }

        tMs += Math.round(slotSec * 1000);

        if (wantDial && wantNarr) {
          if (!amixTwoTracks(diaFit, narrFit, slotSec, segOut, log)) {
            return { ok: false, error: `对白与旁白混音失败 #${i}` };
          }
        } else if (wantDial) {
          try {
            fs.copyFileSync(diaFit, segOut);
          } catch (_) {
            return { ok: false, error: `对白片段复制失败 #${i}` };
          }
        } else if (wantNarr) {
          try {
            fs.copyFileSync(narrFit, segOut);
          } catch (_) {
            return { ok: false, error: `旁白片段复制失败 #${i}` };
          }
        }

        segmentFiles.push(segOut);
      }

      const concatOut = path.join(tempRoot, 'full_mix.mp3');
      if (!concatMp3List(segmentFiles, concatOut, log)) {
        return { ok: false, error: '音轨拼接失败' };
      }

      alignedAudioPath = path.join(tempRoot, 'aligned_mix.mp3');
      if (!alignAudioToVideoDuration(concatOut, videoDur, alignedAudioPath, log)) {
        return { ok: false, error: '音轨与视频总时长对齐失败' };
      }

      if (wantNarr && srtLines.length > 0) {
        const baseName = path.basename(mergedAbsPath, path.extname(mergedAbsPath));
        srtPath = path.join(path.dirname(mergedAbsPath), `${baseName}_narration.srt`);
        fs.writeFileSync(srtPath, `\uFEFF${srtLines.join('\n')}\n`, 'utf8');
      }
    }

    const baseName = path.basename(mergedAbsPath, path.extname(mergedAbsPath));
    const outAbs = path.join(path.dirname(mergedAbsPath), `${baseName}_post.mp4`);

    const hasSubs = !!(srtPath && fs.existsSync(srtPath));
    const subtitleStyle = resolveSubtitleForceStyle(db, episodeId);
    const filterComplex = buildVideoFilterParts(hasSubs ? srtPath : null, watermarkText, tempRoot, subtitleStyle);
    let subsBurnSkipped = false;

    if (needAudio) {
      if (!alignedAudioPath || !fs.existsSync(alignedAudioPath)) {
        return { ok: false, error: '内部错误：缺少对齐音轨' };
      }
      if (!muxVideoWithAudio(mergedAbsPath, alignedAudioPath, outAbs, filterComplex, log, 'mux_av')) {
        if (hasSubs && filterComplex) {
          log.warn('merged post: subtitle burn failed, retrying audio-only mux');
          if (!muxVideoWithAudio(mergedAbsPath, alignedAudioPath, outAbs, '', log, 'mux_audio_only')) {
            return { ok: false, error: '混音失败（请确认 ffmpeg 含 libx264 与 ffprobe 可用）' };
          }
          subsBurnSkipped = true;
        } else {
          return { ok: false, error: '烧录字幕/水印或混音失败（请确认 ffmpeg 含 libx264 与 libass）' };
        }
      }
    } else {
      if (!filterComplex) {
        return { ok: false, error: '内部错误：仅水印但无滤镜链' };
      }
      const args = ['-y', '-i', mergedAbsPath, '-filter_complex', filterComplex, '-map', '[vout]'];
      if (ffprobeHasAudio(mergedAbsPath)) {
        args.push('-map', '0:a', '-c:a', 'copy');
      } else {
        args.push('-an');
      }
      args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-movflags', '+faststart', outAbs);
      if (!runFfmpeg(args, log, 'watermark_only')) {
        return { ok: false, error: '水印烧录失败' };
      }
    }

    if (!fs.existsSync(outAbs)) {
      return { ok: false, error: '输出文件未生成' };
    }

    const relFromRoot = path.relative(storageRoot, outAbs).replace(/\\/g, '/');

    try {
      if (fs.existsSync(mergedAbsPath) && outAbs !== mergedAbsPath) {
        fs.unlinkSync(mergedAbsPath);
      }
    } catch (e) {
      log.warn('merged post: could not remove intermediate', { error: e.message });
    }

    log.info('merged post: done', { episode_id: episodeId, video: relFromRoot, subs_burn_skipped: subsBurnSkipped });
    return {
      ok: true,
      relativePath: relFromRoot,
      warning: subsBurnSkipped ? '旁白/对白已混入，但字幕烧录失败（请使用含 libass 的 ffmpeg 完整版）' : undefined,
    };
  } catch (e) {
    log.warn('merged post: exception', { error: e.message });
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

function ffprobeHasAudio(filePath) {
  const probe = getFfprobePath();
  const r = spawnSync(
    probe,
    ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  );
  return r.status === 0 && String(r.stdout || '').trim().length > 0;
}

/**
 * 单镜视频后处理：全文解说模式下 IndexTTS 逐句旁白 + 烧录字幕
 */
async function runStoryboardNarrationPostProcess(db, log, opts) {
  const { videoAbsPath, storageRoot, storyboardId, dramaId } = opts;
  const videoClient = require('./videoClient');
  if (!videoClient.isDramaFullNarrationVideoMode(db, dramaId)) {
    return { ok: false, error: 'NOT_FULL_NARRATION' };
  }
  if (!videoAbsPath || !fs.existsSync(videoAbsPath)) {
    return { ok: false, error: '无效视频路径' };
  }

  const sb = db.prepare(
    'SELECT narration, duration, narration_audio_local_path FROM storyboards WHERE id = ? AND deleted_at IS NULL'
  ).get(storyboardId);
  const narrText = (sb?.narration && String(sb.narration).trim()) ? String(sb.narration).trim() : '';
  if (!narrText) {
    return { ok: false, error: 'NO_NARRATION' };
  }

  const videoDur = ffprobeDurationSec(videoAbsPath);
  if (videoDur == null) {
    return { ok: false, error: '无法读取视频时长' };
  }

  const mergeOpts = {
    use_indextts_narration: true,
    indextts_voice: 'gsv:008',
    indextts_emotion: '自然流畅的解说语气，情绪饱满',
  };

  const tempRoot = path.join(require('os').tmpdir(), 'drama-sb-narr-post', String(storyboardId), String(Date.now()));
  fs.mkdirSync(tempRoot, { recursive: true });

  try {
    const prebuiltNarrAbs = resolveStorageAudioAbs(storageRoot, sb?.narration_audio_local_path);
    let narrFitPath;
    let srtEntries;

    if (prebuiltNarrAbs) {
      narrFitPath = path.join(tempRoot, 'narr_prebuilt_fit.mp3');
      if (!fitAudioToSlot(prebuiltNarrAbs, videoDur, narrFitPath, log)) {
        return { ok: false, error: '预生成旁白配音时长对齐失败' };
      }
      srtEntries = buildSrtEntriesFromPrebuiltNarration(narrText, videoDur, 0);
      log.info('sb narr post: using prebuilt narration audio', { storyboard_id: storyboardId });
    } else {
      const synthResult = await synthesizeNarrationPerLine(db, log, {
        narrText,
        slotSec: videoDur,
        tempRoot,
        shotIndex: 0,
        storageRoot,
        mergeOpts,
        shotStartMs: 0,
      });
      narrFitPath = synthResult.narrFitPath;
      srtEntries = synthResult.srtEntries;
      log.info('sb narr post: synthesized narration (no prebuilt audio)', { storyboard_id: storyboardId });
    }

    if (!srtEntries || srtEntries.length === 0) {
      return { ok: false, error: '旁白字幕为空' };
    }

    const srtLines = [];
    let srtIdx = 1;
    for (const e of srtEntries) {
      srtLines.push(String(srtIdx++), `${formatSrtTimestamp(e.startMs)} --> ${formatSrtTimestamp(e.endMs)}`, e.text, '');
    }

    const baseName = path.basename(videoAbsPath, path.extname(videoAbsPath));
    const srtPath = path.join(path.dirname(videoAbsPath), `${baseName}_narration.srt`);
    fs.writeFileSync(srtPath, `\uFEFF${srtLines.join('\n')}\n`, 'utf8');

    const outAbs = path.join(path.dirname(videoAbsPath), `${baseName}_narr.mp4`);
    const filterComplex = buildVideoFilterParts(srtPath, '', tempRoot, FULL_NARRATION_SUBTITLE_FORCE_STYLE);
    let subsBurnSkipped = false;

    if (!muxVideoWithAudio(videoAbsPath, narrFitPath, outAbs, filterComplex, log, 'sb_narr_mux')) {
      if (filterComplex && !muxVideoWithAudio(videoAbsPath, narrFitPath, outAbs, '', log, 'sb_narr_mux_audio')) {
        return { ok: false, error: '旁白混音失败（请确认 ffmpeg 含 libx264 与 ffprobe 可用）' };
      }
      subsBurnSkipped = true;
    }

    if (!fs.existsSync(outAbs)) {
      return { ok: false, error: '输出文件未生成' };
    }

    try {
      if (fs.existsSync(videoAbsPath) && outAbs !== videoAbsPath) {
        fs.unlinkSync(videoAbsPath);
      }
    } catch (e) {
      log.warn('sb narr post: could not remove silent video', { error: e.message });
    }

    const relFromRoot = path.relative(storageRoot, outAbs).replace(/\\/g, '/');
    log.info('sb narr post: done', { storyboard_id: storyboardId, video: relFromRoot, subs_burn_skipped: subsBurnSkipped });
    return {
      ok: true,
      relativePath: relFromRoot,
      warning: subsBurnSkipped ? '旁白已混入，但字幕烧录失败（请使用含 libass 的 ffmpeg 完整版）' : undefined,
    };
  } catch (e) {
    log.warn('sb narr post: exception', { storyboard_id: storyboardId, error: e.message });
    return { ok: false, error: e.message || String(e) };
  } finally {
    try {
      for (const p of fs.readdirSync(tempRoot)) {
        try { fs.unlinkSync(path.join(tempRoot, p)); } catch (_) {}
      }
      fs.rmdirSync(tempRoot);
    } catch (_) {}
  }
}

module.exports = {
  runMergedEpisodePostProcess,
  runStoryboardNarrationPostProcess,
  buildSrtEntriesFromPrebuiltNarration,
  ffprobeDurationSec,
};
