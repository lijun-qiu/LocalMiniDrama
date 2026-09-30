'use strict';

/**
 * Character wardrobe (衣橱) — ArcReel ADR 0066 subset.
 * Base look = characters.image_url / appearance; non-base looks live in characters.looks JSON.
 * Do NOT invent parallel fake characters for costume changes.
 */

const BASE_LOOK_ID = 'base';
const LOOK_FILE_SEP = '__';

function parseLooks(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function looksToJson(looks) {
  return JSON.stringify(looks && typeof looks === 'object' ? looks : {});
}

/**
 * Collapse "A或B" alternatives and relative-to-other-look comparisons so i2i gets one outfit.
 * Keep absolute age/height cues like「约8岁」「成人一半高」— those are needed for childhood sheets.
 */
function sanitizeLookDescription(desc) {
  let s = String(desc || '').trim();
  if (!s) return '';
  // （校服或简约学生装）→（校服）
  s = s.replace(/（([^）]*?)或([^）]*?)）/g, '（$1）');
  s = s.replace(/\(([^)]*?)[/|]([^)]*?)\)/g, '($1)');
  s = s.replace(/\(([^)]*?)或([^)]*?)\)/g, '($1)');
  // 校服或简约学生装 → 校服
  s = s.replace(/([^，。；、\s（）()]{1,24})或([^，。；、\s（）()]{1,24})/g, '$1');
  // 去掉「比童年高」「比成年稍矮」这类相对其它造型的比较（保留「成人一半高」绝对值）
  s = s.replace(/[，、]?\s*体型比[^，。；]*/g, '');
  s = s.replace(/[，、]?\s*比(?:童年|幼年|成年|高中)(?:版|造型|定装)?[^，。；]*/g, '');
  s = s.replace(/[，、]{2,}/g, '，').replace(/^[，、\s]+|[，、\s]+$/g, '');
  return s.trim();
}

/**
 * Detect age-band wardrobe looks that must NOT copy adult base body via i2i.
 * @returns {'child'|'teen'|'elder'|null}
 */
function inferLookAgeBand(lookId, lookDesc) {
  const s = `${lookId || ''} ${lookDesc || ''}`;
  if (/童年|幼年|孩童|儿童|小儿|小学生|幼儿园|婴儿|学龄前|约\s*[3-9]\s*岁|[3-9]\s*岁/.test(s)) {
    return 'child';
  }
  if (/少年|初中|高中|青春期|约\s*1[0-7]\s*岁|1[0-7]\s*岁/.test(s)) {
    return 'teen';
  }
  if (/老年|年迈|白发苍苍|约\s*(?:[6-9]\d|\d{3})\s*岁|[6-9]\d\s*岁/.test(s)) {
    return 'elder';
  }
  return null;
}

function isAgeShiftLook(lookId, lookDesc) {
  return inferLookAgeBand(lookId, lookDesc) != null;
}

/** Age-band prompt block for look sheet generation */
function ageBandPromptBlock(band, lookDesc) {
  if (band === 'child') {
    return (
      `【年龄硬锁·童年】本造型是儿童（约小学低年级/8岁左右），不是成年青年。` +
      `头身比约1:4～1:5，个子娇小约为成人一半高，四肢偏短，脸圆、下颌柔和；` +
      `禁止成年男性/青年体型、禁止成年长发发型、禁止成人脸骨相。` +
      `发型、身高、体型以本造型描述为准：${String(lookDesc || '').trim() || '儿童短发，瘦小个子'}。`
    );
  }
  if (band === 'teen') {
    return (
      `【年龄硬锁·少年】本造型是青少年体型（非完全成年），身高与脸型介于儿童与成年之间；` +
      `禁止直接复制成年基准图的成年体型与发型长度。以本造型描述为准：${String(lookDesc || '').trim()}。`
    );
  }
  if (band === 'elder') {
    return (
      `【年龄硬锁·老年】本造型是老年体态与面容（皱纹、发色、体态按描述），禁止复制青年基准图的年轻脸与体型。` +
      `以本造型描述为准：${String(lookDesc || '').trim()}。`
    );
  }
  return '';
}

/**
 * Base appearance must be a single age band for the main sheet.
 * Strip multi-age spans that would collage childhood faces onto the adult sheet / look refs.
 */
function stripMultiAgeAppearance(text) {
  let s = String(text || '').trim();
  if (!s) return '';
  s = s.replace(/年龄跨度[^，。；]*/g, '');
  s = s.replace(/从童年到成年[^，。；]*/g, '');
  s = s.replace(/童年[到至]成年[^，。；]*/g, '');
  s = s.replace(/跨越[^，。；]*年龄[^，。；]*/g, '');
  s = s.replace(/[，、]{2,}/g, '，').replace(/^[，、\s]+|[，、\s]+$/g, '');
  return s.trim();
}

/** Split mention inner: "林北@战损" | "林北" | "林北@战损%内心独白" handled elsewhere */
function splitMentionNameLook(inner) {
  const s = String(inner || '').trim();
  const at = s.indexOf('@');
  if (at < 0) return { name: s, look: BASE_LOOK_ID };
  const name = s.slice(0, at).trim();
  let look = s.slice(at + 1).trim();
  if (!look || look === BASE_LOOK_ID) look = BASE_LOOK_ID;
  if (look.includes('@') || look.includes(LOOK_FILE_SEP)) {
    throw new Error(`invalid look id in mention: ${s}`);
  }
  return { name, look };
}

function lookAssetId(name, lookId) {
  const n = String(name || '').trim();
  const look = !lookId || lookId === BASE_LOOK_ID ? BASE_LOOK_ID : String(lookId).trim();
  if (look === BASE_LOOK_ID) return n;
  return `${n}${LOOK_FILE_SEP}${look}`;
}

function listLookIds(characterRow) {
  const looks = parseLooks(characterRow?.looks);
  const ids = [BASE_LOOK_ID];
  for (const k of Object.keys(looks)) {
    if (k && k !== BASE_LOOK_ID && !ids.includes(k)) ids.push(k);
  }
  return ids;
}

function isLookRegistered(characterRow, lookId) {
  if (!lookId || lookId === BASE_LOOK_ID) return true;
  const looks = parseLooks(characterRow?.looks);
  return Boolean(looks[lookId]);
}

/**
 * Resolve sheet URL/path for a look. Base uses image_url/local_path.
 */
function resolveLookSheet(characterRow, lookId) {
  if (!characterRow) return { image_url: null, local_path: null, description: null };
  if (!lookId || lookId === BASE_LOOK_ID) {
    return {
      image_url: characterRow.image_url || null,
      local_path: characterRow.local_path || null,
      description: characterRow.appearance || characterRow.description || null,
    };
  }
  const looks = parseLooks(characterRow.looks);
  const entry = looks[lookId];
  if (!entry || typeof entry !== 'object') {
    return { image_url: null, local_path: null, description: null };
  }
  return {
    image_url: entry.image_url || null,
    local_path: entry.local_path || null,
    description: entry.description || null,
  };
}

function hasLookImage(characterRow, lookId) {
  const sheet = resolveLookSheet(characterRow, lookId);
  return Boolean((sheet.image_url && String(sheet.image_url).trim()) || (sheet.local_path && String(sheet.local_path).trim()));
}

/**
 * Upsert a non-base look on character. Base look updates go to appearance/image columns separately.
 */
function upsertLook(db, characterId, lookId, { description, image_url, local_path }) {
  const id = String(lookId || '').trim();
  if (!id || id === BASE_LOOK_ID) throw new Error('use character image fields for base look');
  if (id.includes('@') || id.includes(LOOK_FILE_SEP)) throw new Error('invalid look id');
  const row = db.prepare('SELECT id, looks FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(characterId));
  if (!row) throw new Error('character not found');
  const looks = parseLooks(row.looks);
  const prev = looks[id] && typeof looks[id] === 'object' ? looks[id] : {};
  const nextDesc =
    description != null ? sanitizeLookDescription(description) : sanitizeLookDescription(prev.description || '');
  looks[id] = {
    description: nextDesc,
    image_url: image_url !== undefined ? image_url : prev.image_url || null,
    local_path: local_path !== undefined ? local_path : prev.local_path || null,
  };
  const now = new Date().toISOString();
  db.prepare('UPDATE characters SET looks = ?, updated_at = ? WHERE id = ?').run(looksToJson(looks), now, Number(characterId));
  return looks[id];
}

function deleteLook(db, characterId, lookId) {
  const id = String(lookId || '').trim();
  if (!id || id === BASE_LOOK_ID) throw new Error('cannot delete base look');
  const row = db.prepare('SELECT id, looks FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(characterId));
  if (!row) throw new Error('character not found');
  const looks = parseLooks(row.looks);
  delete looks[id];
  const now = new Date().toISOString();
  db.prepare('UPDATE characters SET looks = ?, updated_at = ? WHERE id = ?').run(looksToJson(looks), now, Number(characterId));
  return true;
}

/**
 * Missing look sheets for an episode wardrobe check (base first).
 * @returns {string[]} asset ids like "林北" | "林北__战损"
 */
function missingLookSheetIds(characters) {
  const missing = [];
  for (const c of characters || []) {
    for (const lookId of listLookIds(c)) {
      if (!hasLookImage(c, lookId)) missing.push(lookAssetId(c.name, lookId));
    }
  }
  return missing;
}

module.exports = {
  BASE_LOOK_ID,
  LOOK_FILE_SEP,
  parseLooks,
  looksToJson,
  sanitizeLookDescription,
  stripMultiAgeAppearance,
  inferLookAgeBand,
  isAgeShiftLook,
  ageBandPromptBlock,
  splitMentionNameLook,
  lookAssetId,
  listLookIds,
  isLookRegistered,
  resolveLookSheet,
  hasLookImage,
  upsertLook,
  deleteLook,
  missingLookSheetIds,
};
