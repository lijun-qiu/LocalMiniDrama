/**
 * 旁白配音时长对齐：后处理不做 atempo 加速，仅补静音 / 原速复制 / 必要时截尾；超时由延长视频解决。
 */
const { spawnSync } = require('child_process');
const { getFfmpegPath } = require('./ffmpegPath');

const NARRATION_FIT_EPS_SEC = 0.06;

/** 句末强/弱标点赋予更多权重，使字幕时间轴更贴近自然停顿 */
function computeNarrationLineWeight(line) {
  const readable = String(line || '').replace(/[^\u4e00-\u9fff\w]/g, '');
  let w = Math.max(1, readable.length || String(line || '').length || 1);
  const t = String(line || '').trim();
  if (/[。！？!?]$/.test(t)) w *= 1.35;
  else if (/[，,、；;：:]$/.test(t)) w *= 1.12;
  return w;
}

function computeNarrationLineWeights(lines) {
  return (lines || []).map(computeNarrationLineWeight);
}

/**
 * @param {number} naturalDur 配音自然时长（秒）
 * @param {number} slotSec 目标槽位（视频/分镜时长）
 * @returns {{ outputSlotSec: number, preferExtendVideo: boolean }}
 */
function resolveNarrationSlotPlan(naturalDur, slotSec) {
  const slot = Math.max(0.2, Number(slotSec) || 0);
  const eps = NARRATION_FIT_EPS_SEC;
  if (!Number.isFinite(naturalDur) || naturalDur <= 0) {
    return { outputSlotSec: slot, preferExtendVideo: false };
  }
  if (naturalDur <= slot + eps) {
    return { outputSlotSec: slot, preferExtendVideo: false };
  }
  return { outputSlotSec: naturalDur, preferExtendVideo: true };
}

function runFfmpeg(args, log, tag) {
  const bin = getFfmpegPath();
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) {
    log?.warn?.('[narration-fit] ffmpeg spawn', { tag, error: r.error.message });
    return false;
  }
  if (r.status !== 0) {
    log?.warn?.('[narration-fit] ffmpeg failed', { tag, stderr: r.stderr?.slice(-800) });
    return false;
  }
  return true;
}

/**
 * 旁白对齐槽位：不加速。短于槽位补静音；长于槽位原速输出（由调用方延长视频）或 allowTrim 时截尾。
 * @returns {boolean}
 */
function fitNarrationAudioToSlot(inputPath, slotSec, outPath, log, opts = {}) {
  const fs = require('fs');
  const ffprobeDurationSec = opts.ffprobeDurationSec;
  if (!ffprobeDurationSec) throw new Error('fitNarrationAudioToSlot 需要 ffprobeDurationSec');

  const d = ffprobeDurationSec(inputPath);
  if (d == null || d <= 0.01) return false;

  const allowTrim = opts.allowTrim === true;
  const plan = resolveNarrationSlotPlan(d, slotSec);
  const target = plan.outputSlotSec;
  const eps = NARRATION_FIT_EPS_SEC;

  if (plan.preferExtendVideo && !allowTrim) {
    try {
      fs.copyFileSync(inputPath, outPath);
      return true;
    } catch (_) {
      return runFfmpeg(
        ['-y', '-i', inputPath, '-c:a', 'libmp3lame', '-q:a', '4', outPath],
        log,
        'narr_fit_natural'
      );
    }
  }

  if (d < target - eps) {
    const pad = target - d;
    return runFfmpeg(
      ['-y', '-i', inputPath, '-af', `apad=pad_dur=${pad}`, '-t', String(target), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'narr_fit_pad'
    );
  }

  if (d > target + eps && allowTrim) {
    log?.info?.('[narration-fit] trim narration tail to slot (no post speedup)', {
      natural_sec: d,
      slot_sec: target,
    });
    return runFfmpeg(
      ['-y', '-i', inputPath, '-t', String(target), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'narr_fit_trim'
    );
  }

  try {
    fs.copyFileSync(inputPath, outPath);
    return true;
  } catch (_) {
    return runFfmpeg(
      ['-y', '-i', inputPath, '-t', String(target), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'narr_fit_copy'
    );
  }
}

/**
 * 旁白音轨与视频总时长对齐：不加速；音轨更长则返回需延长视频的时长。
 * @returns {{ ok: boolean, outputVideoDur: number, extended: boolean }}
 */
function alignNarrationAudioToVideoDuration(inMp3, videoDur, outPath, log, ffprobeDurationSec) {
  const fs = require('fs');
  const n = ffprobeDurationSec(inMp3);
  if (n == null || !Number.isFinite(videoDur) || videoDur <= 0.1) {
    return { ok: false, outputVideoDur: videoDur, extended: false };
  }
  const eps = 0.08;
  if (n > videoDur + eps) {
    try {
      fs.copyFileSync(inMp3, outPath);
    } catch (_) {
      if (!runFfmpeg(
        ['-y', '-i', inMp3, '-c:a', 'libmp3lame', '-q:a', '4', outPath],
        log,
        'narr_align_natural'
      )) {
        return { ok: false, outputVideoDur: videoDur, extended: false };
      }
    }
    log?.info?.('[narration-fit] narration longer than video; will extend video instead of speedup', {
      audio_sec: n,
      video_sec: videoDur,
    });
    return { ok: true, outputVideoDur: n, extended: true };
  }
  if (n < videoDur - eps) {
    const pad = videoDur - n;
    const ok = runFfmpeg(
      ['-y', '-i', inMp3, '-af', `apad=pad_dur=${pad}`, '-t', String(videoDur), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'narr_align_pad'
    );
    return { ok, outputVideoDur: videoDur, extended: false };
  }
  try {
    fs.copyFileSync(inMp3, outPath);
    return { ok: true, outputVideoDur: videoDur, extended: false };
  } catch (_) {
    const ok = runFfmpeg(
      ['-y', '-i', inMp3, '-t', String(videoDur), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'narr_align_copy'
    );
    return { ok, outputVideoDur: videoDur, extended: false };
  }
}

/** 视频不足目标时长时定格最后一帧补齐（用于旁白比视频长） */
function extendVideoToDuration(inputPath, targetSec, outPath, log, ffprobeDurationSec) {
  const fs = require('fs');
  const vDur = ffprobeDurationSec(inputPath);
  if (vDur == null) return false;
  const target = Math.max(0.2, Number(targetSec) || 0);
  if (vDur >= target - 0.05) {
    if (Math.abs(vDur - target) < 0.05) {
      try {
        fs.copyFileSync(inputPath, outPath);
        return true;
      } catch (_) { /* fall through */ }
    }
    return runFfmpeg(
      ['-y', '-i', inputPath, '-t', String(target), '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-an', outPath],
      log,
      'video_extend_trim'
    );
  }
  const pad = target - vDur;
  return runFfmpeg(
    [
      '-y', '-i', inputPath,
      '-vf', `tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`,
      '-t', String(target),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
      '-an', outPath,
    ],
    log,
    'video_extend_pad'
  );
}

/** ffmpeg silencedetect → silence_end 时间列表（秒） */
function detectSilenceEnds(absPath, log, opts = {}) {
  const noiseDb = opts.noiseDb ?? -35;
  const minSilence = opts.minSilence ?? 0.12;
  const bin = getFfmpegPath();
  const r = spawnSync(
    bin,
    ['-i', absPath, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSilence}`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  if (r.error) {
    log?.warn?.('[narration-fit] silencedetect failed', { error: r.error.message });
    return [];
  }
  const text = `${r.stderr || ''}\n${r.stdout || ''}`;
  const ends = [];
  for (const m of text.matchAll(/silence_end:\s*([\d.]+)/g)) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v)) ends.push(v);
  }
  return ends.sort((a, b) => a - b);
}

/** 将切分点吸附到附近静音结束处，减少句中被切断 */
function snapOffsetToSilence(targetOffset, silenceEnds, maxShift = 0.35) {
  if (!silenceEnds?.length || !Number.isFinite(targetOffset)) return targetOffset;
  let best = targetOffset;
  let bestDist = maxShift + 1;
  for (const end of silenceEnds) {
    const dist = Math.abs(end - targetOffset);
    if (dist <= maxShift && dist < bestDist) {
      bestDist = dist;
      best = end;
    }
  }
  return bestDist <= maxShift ? best : targetOffset;
}

/**
 * 按比例切分点 + 静音吸附，返回各段 [start, duration]（秒）。
 */
function refineSplitBoundaries(proportionalDurs, totalDur, silenceEnds, opts = {}) {
  const durs = proportionalDurs.map((d) => Math.max(0.05, d));
  if (durs.length <= 1 || !Number.isFinite(totalDur) || totalDur <= 0) {
    return durs;
  }
  const maxShift = opts.maxShift ?? 0.35;
  const minSeg = opts.minSegSec ?? 0.15;
  const starts = [0];
  let cum = 0;
  for (let i = 0; i < durs.length - 1; i++) {
    cum += durs[i];
    starts.push(snapOffsetToSilence(cum, silenceEnds, maxShift));
  }
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] <= starts[i - 1] + minSeg) {
      starts[i] = starts[i - 1] + minSeg;
    }
  }
  if (starts[starts.length - 1] >= totalDur - minSeg) {
    starts[starts.length - 1] = Math.max(minSeg, totalDur - minSeg);
  }
  const out = [];
  for (let i = 0; i < durs.length; i++) {
    const end = i < durs.length - 1 ? starts[i + 1] : totalDur;
    out.push(Math.max(minSeg, end - starts[i]));
  }
  const sum = out.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - totalDur) > 0.02 && out.length) {
    out[out.length - 1] = Math.max(minSeg, out[out.length - 1] + (totalDur - sum));
  }
  return out;
}

module.exports = {
  NARRATION_FIT_EPS_SEC,
  computeNarrationLineWeight,
  computeNarrationLineWeights,
  resolveNarrationSlotPlan,
  fitNarrationAudioToSlot,
  alignNarrationAudioToVideoDuration,
  extendVideoToDuration,
  detectSilenceEnds,
  snapOffsetToSilence,
  refineSplitBoundaries,
};
