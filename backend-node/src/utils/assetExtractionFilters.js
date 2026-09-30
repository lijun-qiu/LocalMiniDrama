/**
 * ArcReel analyze-assets 口径：泛指 / 群演 / 空镜不建角色资产。
 * 用于角色提取后过滤，兜住模型漏判。
 */

/** @param {string} name */
function isGenericExtraName(name) {
  const n = String(name || '').trim();
  if (!n) return true;

  // 空镜 / 无人物
  if (/^(无|空场|空镜)([（(].*[）)])?$/u.test(n)) return true;
  if (/空镜|空场/u.test(n) && n.length <= 8) return true;

  // 编号后缀：老人甲、村民乙、路人A、士兵丙、路人 A
  if (/[甲乙丙丁戊己庚辛壬癸]$/u.test(n)) return true;
  if (/\s*[A-Za-z]$/u.test(n) && /^(路人|士兵|村民|群众|客人|乘客|观众|侍卫|保镖|侍从|杂役|差役|商贩|店小二)/u.test(n)) {
    return true;
  }

  // 群体量词 / 复数
  if (/(若干|们)$/u.test(n)) return true;
  if (/^(一群|几个|一些|一帮|一伙|一队)/u.test(n)) return true;

  // 纯泛称无专名
  if (/^(一个|一名|一位|那名|那个|这位|某)/u.test(n)) return true;
  if (/^(围观群众|群众|路人|群演|众人|大家)$/u.test(n)) return true;

  return false;
}

/**
 * @param {Array<{ name?: string }>} list
 * @returns {Array}
 */
function filterGenericExtraCharacters(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => !isGenericExtraName(item?.name));
}

module.exports = {
  isGenericExtraName,
  filterGenericExtraCharacters,
};
