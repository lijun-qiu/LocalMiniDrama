const path = require('path');
const fs = require('fs');

/** 工业角色参考表常见宽幅；过宽时整图含多角度多人影，不宜直接作分镜参考 */
const SHEET_MIN_ASPECT = 1.35;
/** 左竖栏 FACE HERO 约占画幅宽度（与 getRoleGenerateImagePrompt 左约 1/3 一致） */
const FACE_HERO_WIDTH_RATIO = 0.34;
/** 裁掉顶部标题条 */
const TITLE_BAR_RATIO = 0.07;

function faceCropSiblingPath(absSheetPath) {
  const dir = path.dirname(absSheetPath);
  const ext = path.extname(absSheetPath);
  const base = path.basename(absSheetPath, ext);
  return path.join(dir, `${base}_face_ref.jpg`);
}

function resolveAbsUnderStorage(storageRoot, relOrAbs) {
  if (!relOrAbs || !storageRoot) return null;
  const s = String(relOrAbs).trim().replace(/\\/g, '/');
  if (!s) return null;
  if (path.isAbsolute(s) || /^[a-zA-Z]:\//.test(s)) return s;
  const cleaned = s.replace(/^\//, '');
  return path.join(storageRoot, cleaned);
}

function toStorageRel(storageRoot, absPath) {
  if (!storageRoot || !absPath) return null;
  const rel = path.relative(storageRoot, absPath).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return null;
  return rel;
}

/**
 * 判断本地图是否像「多角度角色参考表」（宽幅合图），整图作分镜参考易克隆出多人。
 */
async function looksLikeCharacterReferenceSheet(absPath) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (_) {
    return false;
  }
  try {
    const meta = await sharp(fs.readFileSync(absPath)).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (w < 64 || h < 64) return false;
    return w / h >= SHEET_MIN_ASPECT;
  } catch (_) {
    return false;
  }
}

/**
 * 从工业角色参考表裁出左栏 FACE HERO（单人正脸），供分镜生图当外观锚点。
 * @returns {Promise<string|null>} 绝对路径；失败返回 null
 */
async function ensureCharacterFaceHeroCrop(absSheetPath, log) {
  if (!absSheetPath || !fs.existsSync(absSheetPath)) return null;
  const outAbs = faceCropSiblingPath(absSheetPath);
  try {
    const srcStat = fs.statSync(absSheetPath);
    if (fs.existsSync(outAbs)) {
      const outStat = fs.statSync(outAbs);
      if (outStat.size > 0 && outStat.mtimeMs >= srcStat.mtimeMs) return outAbs;
    }
  } catch (_) {}

  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    log?.warn?.('[角色参考裁切] sharp 不可用，跳过 FACE HERO 裁切', { error: e.message });
    return null;
  }

  try {
    const inputBuf = fs.readFileSync(absSheetPath);
    const meta = await sharp(inputBuf).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (w < 64 || h < 64) return null;
    if (w / h < SHEET_MIN_ASPECT) {
      // 已是竖图/单人主图，无需裁切
      return null;
    }
    const cropW = Math.max(32, Math.floor(w * FACE_HERO_WIDTH_RATIO));
    const top = Math.floor(h * TITLE_BAR_RATIO);
    const cropH = Math.max(32, h - top);
    const outBuf = await sharp(inputBuf)
      .extract({ left: 0, top, width: cropW, height: cropH })
      .jpeg({ quality: 90 })
      .toBuffer();
    fs.writeFileSync(outAbs, outBuf);
    log?.info?.('[角色参考裁切] 已生成 FACE HERO 单人裁切', {
      src: path.basename(absSheetPath),
      out: path.basename(outAbs),
      crop: `${cropW}x${cropH}`,
    });
    return outAbs;
  } catch (e) {
    log?.warn?.('[角色参考裁切] FACE HERO 裁切失败', { error: e.message, path: absSheetPath });
    return null;
  }
}

/**
 * 分镜生图用角色参考：用户上传单图优先；否则优先 FACE HERO 裁切 / 历史正面面板，避免整张多角度表导致克隆。
 */
async function pickCharacterRefForStoryboard(db, characterId, row, storageRoot, log) {
  const isUserRef = !!(row?.ref_image && String(row.ref_image).trim());
  if (isUserRef) {
    return {
      charRef: String(row.ref_image).trim(),
      isPanel: false,
      isUserRef: true,
      isFaceCrop: false,
    };
  }

  // 历史 2×2 正面面板（若有）
  if (db && characterId != null) {
    const charPanel = db
      .prepare(
        `SELECT local_path, image_url FROM image_generations
         WHERE character_id = ? AND frame_type = 'quad_panel_1' AND status = 'completed'
         ORDER BY id DESC LIMIT 1`
      )
      .get(Number(characterId));
    if (charPanel && (charPanel.local_path || charPanel.image_url)) {
      return {
        charRef: charPanel.local_path || charPanel.image_url,
        isPanel: true,
        isUserRef: false,
        isFaceCrop: false,
      };
    }
  }

  const localPath = row?.local_path && String(row.local_path).trim();
  const imageUrl = row?.image_url && String(row.image_url).trim();
  const primary = localPath || imageUrl || null;
  if (!primary) {
    return { charRef: null, isPanel: false, isUserRef: false, isFaceCrop: false };
  }

  if (localPath && storageRoot) {
    const abs = resolveAbsUnderStorage(storageRoot, localPath);
    if (abs && fs.existsSync(abs)) {
      const sheetLike = await looksLikeCharacterReferenceSheet(abs);
      if (sheetLike) {
        const cropAbs = await ensureCharacterFaceHeroCrop(abs, log);
        const cropRel = cropAbs ? toStorageRel(storageRoot, cropAbs) : null;
        if (cropRel) {
          return {
            charRef: cropRel,
            isPanel: false,
            isUserRef: false,
            isFaceCrop: true,
          };
        }
      }
    }
  }

  return {
    charRef: primary,
    isPanel: false,
    isUserRef: false,
    isFaceCrop: false,
  };
}

module.exports = {
  SHEET_MIN_ASPECT,
  FACE_HERO_WIDTH_RATIO,
  faceCropSiblingPath,
  looksLikeCharacterReferenceSheet,
  ensureCharacterFaceHeroCrop,
  pickCharacterRefForStoryboard,
  resolveAbsUnderStorage,
  toStorageRel,
};
