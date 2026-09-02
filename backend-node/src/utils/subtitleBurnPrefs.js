function parseDramaMetadata(row) {
  if (!row?.metadata) return {};
  try {
    return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
  } catch (_) {
    return {};
  }
}

/** 从 drama.metadata 读取字幕烧录偏好 */
function loadSubtitleBurnPrefs(db, dramaId) {
  const defaults = {
    autoAlign: true,
    marginVOverride: null,
  };
  if (!db || !dramaId) return defaults;
  try {
    const row = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(dramaId));
    const meta = parseDramaMetadata(row);
    const rawMargin = meta.subtitle_margin_v;
    const marginVOverride =
      rawMargin != null && rawMargin !== '' && Number.isFinite(Number(rawMargin))
        ? Math.round(Number(rawMargin))
        : null;
    return {
      autoAlign: meta.subtitle_auto_align !== false,
      marginVOverride,
    };
  } catch (_) {
    return defaults;
  }
}

module.exports = {
  loadSubtitleBurnPrefs,
};
