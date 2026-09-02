const {
  buildSubtitleForceStyle,
  DEFAULT_SUBTITLE_MARGIN_V,
  DEFAULT_SUBTITLE_STYLE,
  FULL_NARRATION_SUBTITLE_STYLE,
} = require('./subtitleStyle');

/**
 * 烧录字幕 force_style：固定距底边 DEFAULT_SUBTITLE_MARGIN_V（12px），不做自动对齐。
 */
async function resolveSubtitleForceStyleAsync(db, log, opts = {}) {
  const fullNarration = !!opts.fullNarration;
  const fontSize = fullNarration ? 24 : 36;
  void db;
  void log;
  void opts;
  return buildSubtitleForceStyle({ fontSize, marginV: DEFAULT_SUBTITLE_MARGIN_V });
}

module.exports = {
  resolveSubtitleForceStyleAsync,
  DEFAULT_SUBTITLE_STYLE,
  FULL_NARRATION_SUBTITLE_STYLE,
};
