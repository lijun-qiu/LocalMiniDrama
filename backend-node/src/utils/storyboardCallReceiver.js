/** 远程通话场景：以接听方为主镜 */
const REMOTE_CALL_SCENE_RE =
  /视频电话|语音电话|远程会议|视频通话|语音通话|微信视频|facetime|zoom|teams|打(?:来|给).{0,12}(?:视频|语音)?电话|(?:视频|语音)?电话(?:打来|响起|接通)/i;

const RECEIVER_PATTERNS = [
  /([\u4e00-\u9fa5A-Za-z·]{2,8})接(?:起|通|听|了|过来)?(?:视频|语音)?电话/,
  /([\u4e00-\u9fa5A-Za-z·]{2,8}).{0,4}接听(?:了)?(?:视频|语音)?电话/,
  /(?:视频|语音)?电话.{0,16}([\u4e00-\u9fa5A-Za-z·]{2,8})接(?:起|通|听|了)?/,
  /手机.{0,24}([\u4e00-\u9fa5A-Za-z·]{2,8})接(?:起|通|听|了)?/,
  /([\u4e00-\u9fa5A-Za-z·]{2,8})(?:滑动|按下)接听/,
];

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveKnownName(candidate, characterNames) {
  const c = String(candidate || '').trim();
  if (!c || !characterNames?.length) return null;
  const sorted = [...characterNames].sort((a, b) => b.length - a.length);
  return sorted.find((n) => n === c || c.includes(n) || n.includes(c)) || null;
}

function isRemoteCallScene(text) {
  return REMOTE_CALL_SCENE_RE.test(String(text || ''));
}

/**
 * 从分镜叙述文本中识别接听方姓名（须在 characterNames 中）。
 * 优先 action/description/result，不含对白字段。
 */
function extractCallReceiverName(text, characterNames) {
  const src = String(text || '');
  if (!src || !characterNames?.length) return null;

  for (const pattern of RECEIVER_PATTERNS) {
    const m = src.match(pattern);
    if (m?.[1]) {
      const hit = resolveKnownName(m[1], characterNames);
      if (hit) return hit;
    }
  }

  const sorted = [...characterNames].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const re = escapeRegExp(name);
    if (new RegExp(`${re}接(?:起|通|听|了|过来)?`).test(src)) return name;
    if (new RegExp(`${re}.{0,3}接听`).test(src)) return name;
  }
  return null;
}

module.exports = {
  isRemoteCallScene,
  extractCallReceiverName,
};
