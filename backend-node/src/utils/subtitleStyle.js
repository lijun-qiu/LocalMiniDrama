/** 烧录字幕：底中 Alignment=2，距底边固定 12 像素 */
const DEFAULT_SUBTITLE_MARGIN_V = 12;

function buildSubtitleForceStyle(opts = {}) {
  const fontSize = Number(opts.fontSize) > 0 ? Math.round(Number(opts.fontSize)) : 24;
  const marginV = Number(opts.marginV) > 0 ? Math.round(Number(opts.marginV)) : DEFAULT_SUBTITLE_MARGIN_V;
  const outline = Number(opts.outline) >= 0 ? Math.round(Number(opts.outline)) : 2;
  return `FontSize=${fontSize},Outline=${outline},Shadow=1,Bold=1,Alignment=2,MarginV=${marginV}`;
}

const DEFAULT_SUBTITLE_STYLE = buildSubtitleForceStyle({ fontSize: 36, marginV: DEFAULT_SUBTITLE_MARGIN_V });
const FULL_NARRATION_SUBTITLE_STYLE = buildSubtitleForceStyle({ fontSize: 24, marginV: DEFAULT_SUBTITLE_MARGIN_V });

module.exports = {
  DEFAULT_SUBTITLE_MARGIN_V,
  buildSubtitleForceStyle,
  DEFAULT_SUBTITLE_STYLE,
  FULL_NARRATION_SUBTITLE_STYLE,
};
