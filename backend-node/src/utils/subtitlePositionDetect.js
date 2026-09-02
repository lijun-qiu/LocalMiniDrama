/**
 * 从视频帧中估算画面下方「高对比文字带」位置，用于将 ffmpeg 烧录字幕对齐到模型画字区域。
 * 启发式：无 OCR，扫描下半屏水平条带的梯度能量。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const { getFfmpegPath } = require('./ffmpegPath');

function extractVideoFramePng(videoAbsPath, timestampSec, outPng, log) {
  const bin = getFfmpegPath();
  const args = [
    '-y',
    '-ss', String(Math.max(0, timestampSec)),
    '-i', videoAbsPath,
    '-frames:v', '1',
    '-q:v', '2',
    outPng,
  ];
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    log?.warn?.('[subtitle-align] extract frame failed', {
      error: r.error?.message || r.stderr?.slice(-200),
    });
    return false;
  }
  return fs.existsSync(outPng);
}

/**
 * @param {string} framePng
 * @returns {Promise<number|null>} MarginV（距底边像素），失败返回 null
 */
async function detectMarginVFromFramePng(framePng) {
  const meta = await sharp(framePng).metadata();
  const H = meta.height;
  const W = meta.width;
  if (!H || !W || H < 64 || W < 64) return null;

  const cropTop = Math.floor(H * 0.42);
  const cropH = H - cropTop;
  const cropLeft = Math.floor(W * 0.12);
  const cropW = W - cropLeft * 2;

  const { data } = await sharp(framePng)
    .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bandH = Math.max(8, Math.round(cropH / 24));
  const step = Math.max(2, Math.floor(bandH / 3));
  let bestScore = 0;
  let bestCenterRel = Math.floor(cropH * 0.55);

  for (let y = 0; y <= cropH - bandH; y += step) {
    let score = 0;
    for (let row = y; row < y + bandH; row++) {
      const rowOff = row * cropW;
      for (let x = 2; x < cropW - 2; x++) {
        const idx = rowOff + x;
        const gx = Math.abs(data[idx + 1] - data[idx - 1]);
        const gy =
          row > 0 && row < cropH - 1
            ? Math.abs(data[idx + cropW] - data[idx - cropW])
            : 0;
        score += gx + gy * 0.6;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCenterRel = y + bandH / 2;
    }
  }

  const minScore = cropW * bandH * 4;
  if (bestScore < minScore) return null;

  const textCenterY = cropTop + bestCenterRel;
  // 字幕基线略低于检测到的文字带中心
  const marginV = Math.round(H - textCenterY + bandH * 0.35);
  const minV = Math.max(28, Math.round(H * 0.06));
  const maxV = Math.round(H * 0.38);
  return Math.min(maxV, Math.max(minV, marginV));
}

/**
 * @param {string} videoAbsPath
 * @param {{ log?: object, timestampSec?: number, videoDurSec?: number|null }} [opts]
 * @returns {Promise<number|null>}
 */
async function detectSubtitleMarginVFromVideo(videoAbsPath, opts = {}) {
  const log = opts.log;
  if (!videoAbsPath || !fs.existsSync(videoAbsPath)) return null;

  let ts = Number(opts.timestampSec);
  if (!Number.isFinite(ts) || ts < 0) {
    const dur = opts.videoDurSec;
    ts = Number.isFinite(dur) && dur > 1 ? dur * 0.35 : 1;
  }

  const tempRoot = path.join(os.tmpdir(), 'subtitle-align', String(Date.now()));
  fs.mkdirSync(tempRoot, { recursive: true });
  const framePng = path.join(tempRoot, 'frame.png');

  try {
    if (!extractVideoFramePng(videoAbsPath, ts, framePng, log)) return null;
    const marginV = await detectMarginVFromFramePng(framePng);
    if (marginV != null) {
      log?.info?.('[subtitle-align] detected MarginV', {
        margin_v: marginV,
        timestamp_sec: ts,
        video: path.basename(videoAbsPath),
      });
    }
    return marginV;
  } catch (e) {
    log?.warn?.('[subtitle-align] detect failed', { error: e.message });
    return null;
  } finally {
    try {
      if (fs.existsSync(framePng)) fs.unlinkSync(framePng);
      fs.rmdirSync(tempRoot);
    } catch (_) {}
  }
}

module.exports = {
  detectSubtitleMarginVFromVideo,
  detectMarginVFromFramePng,
};
