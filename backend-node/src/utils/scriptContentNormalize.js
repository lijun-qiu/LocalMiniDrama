/**
 * 保存剧本时规范化正文：去掉空行，统一换行符，去掉首尾空白。
 * @param {string} text
 * @returns {string}
 */
function normalizeScriptContentForSave(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!raw.trim()) return '';
  return raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n')
    .trim();
}

module.exports = {
  normalizeScriptContentForSave,
};
