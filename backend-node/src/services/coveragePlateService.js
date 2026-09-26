/**
 * 定镜对白 · 场景级固定机位母版（coverage plates）
 *
 * 统一：全景座位表 + 按人数缩放的分区板 + 说话人近景（双人桌戏与多人会议同一套）。
 * 默认分配 by_speaker：单人台词→近景/分区；多人同镜→全景或同分区。
 * 双人近景：正反打 POV——平视0°正面、仅说话人、无过肩、禁止克隆。
 * 参考图：从全景裁「该侧身后」+「桌面条」+ 身份图（不喂整张双人构图）；无全景时回退场景侧裁。
 */
const fs = require('fs');
const path = require('path');
const taskService = require('./taskService');
const imageService = require('./imageService');
const { parseClassicDialogueAndNarration } = require('./dramaVideoPromptYaml');
const { bindStoryboardFrameImage } = require('./storyboardFrameBinding');
const storageLayout = require('./storageLayout');
const uploadService = require('./uploadService');
const { loadConfig } = require('../config');

const MAX_SPEAKER_PLATES_DUO = 4;
const MAX_SPEAKER_PLATES_ENSEMBLE = 8;
const MAX_CAST_FOR_SEATING = 16;
/** 全程统一走「全景 + 分区 + 近景」；分区按人数缩放（不再按 ≥5 切换旧双人模板） */
const MULTI_CAST_THRESHOLD = 1;
const MAX_WIDE_CHAR_REFS = 8;
const MAX_ZONE_CHAR_REFS = 5;
const IMAGE_WAIT_MS = 8 * 60 * 1000;
const IMAGE_POLL_MS = 2000;
const COVERAGE_IMAGE_CONCURRENCY_DEFAULT = 7;

function resolveCoverageImageConcurrency(db, opts = {}) {
  const fromOpts = Number(opts.concurrency);
  if (Number.isFinite(fromOpts) && fromOpts >= 1) {
    return Math.min(20, Math.max(1, Math.floor(fromOpts)));
  }
  try {
    const settingsService = require('./settingsService');
    const n = Number(settingsService.getGlobalSetting(db, 'pipeline_concurrency', COVERAGE_IMAGE_CONCURRENCY_DEFAULT));
    if (Number.isFinite(n) && n >= 1) return Math.min(20, Math.max(1, Math.floor(n)));
  } catch (_) {}
  return COVERAGE_IMAGE_CONCURRENCY_DEFAULT;
}

/** 简易并发池：最多同时跑 limit 个 async worker */
async function mapPool(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const conc = Math.max(1, Math.min(list.length || 1, Number(limit) || 1));
  const results = new Array(list.length);
  let next = 0;
  async function runOne() {
    while (next < list.length) {
      const i = next;
      next += 1;
      results[i] = await worker(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: conc }, () => runOne()));
  return results;
}

/** @deprecated 兼容旧常量名 */
const MAX_SPEAKER_PLATES = MAX_SPEAKER_PLATES_DUO;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseJsonArray(raw) {
  if (raw == null || String(raw).trim() === '') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function lineageKeyOf(plateOrSpec, sceneKey) {
  const sk = sceneKey || plateOrSpec.scene_key || '';
  const pt = plateOrSpec.plate_type || '';
  const zk = plateOrSpec.zone_key != null ? String(plateOrSpec.zone_key) : '';
  const sp = plateOrSpec.speaker_name != null ? String(plateOrSpec.speaker_name) : '';
  return `${sk}|${pt}|${zk}|${sp}`;
}

function rowToPlate(r) {
  if (!r) return null;
  const characterIds = parseJsonArray(r.character_ids)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
  const members = parseJsonArray(r.members_json)
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return {
    id: r.id,
    drama_id: r.drama_id,
    episode_id: r.episode_id,
    scene_key: r.scene_key,
    scene_id: r.scene_id ?? null,
    location: r.location ?? null,
    plate_type: r.plate_type,
    speaker_name: r.speaker_name ?? null,
    zone_key: r.zone_key ?? null,
    lineage_key: r.lineage_key || lineageKeyOf(r, r.scene_key),
    members,
    layout_description: r.layout_description ?? null,
    prompt: r.prompt ?? null,
    character_ids: characterIds,
    image_gen_id: r.image_gen_id ?? null,
    image_url: r.image_url ?? null,
    local_path: r.local_path ?? null,
    status: r.status,
    error_msg: r.error_msg ?? null,
    version_count: r.version_count != null ? Number(r.version_count) : undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function sceneKeyOf(sb) {
  if (sb.scene_id != null && Number.isFinite(Number(sb.scene_id))) {
    return `scene:${Number(sb.scene_id)}`;
  }
  const loc = String(sb.location || '').trim();
  if (loc) return `loc:${loc}`;
  return 'ungrouped';
}

function parseSbCharacters(raw) {
  if (raw == null || String(raw).trim() === '') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (typeof item === 'object' && item != null) {
          return { id: Number(item.id), name: String(item.name || '').trim() };
        }
        return { id: Number(item), name: '' };
      })
      .filter((c) => Number.isFinite(c.id));
  } catch (_) {
    return [];
  }
}

function isLocomotionAction(action) {
  const act = String(action || '');
  return /(走路|走开|走去|走向|走进|走出|跑开|跑向|奔跑|冲向|冲出|迈步|跨过|进入|进门|入场|出场|离开|出门|穿过|起身|站起|站起来)/.test(
    act
  );
}

function extractSpeakersFromStoryboard(sb) {
  const lines = parseClassicDialogueAndNarration(sb.dialogue, '');
  const names = [];
  const seen = new Set();
  for (const d of lines) {
    const sp = String(d.speaker || '').trim();
    if (!sp || sp === '画外音' || seen.has(sp)) continue;
    seen.add(sp);
    names.push(sp);
  }
  return names;
}

function resolveCharacterImageRef(db, charId) {
  const c = db
    .prepare('SELECT image_url, local_path, name FROM characters WHERE id = ? AND deleted_at IS NULL')
    .get(Number(charId));
  if (!c) return null;
  let ref = c.local_path || c.image_url;
  if (!ref) {
    const panel = db
      .prepare(
        `SELECT local_path, image_url FROM image_generations
         WHERE character_id = ? AND frame_type = 'quad_panel_1' AND status = 'completed'
         ORDER BY id DESC LIMIT 1`
      )
      .get(Number(charId));
    if (panel) ref = panel.local_path || panel.image_url;
  }
  return ref ? { ref, name: c.name || '' } : null;
}

/**
 * 解析场景参考图。
 * - 优先用 sceneId 的有效场景图
 * - 若场景已软删/无图：回退到同剧同地点的最新有效场景图（用户重做场景后常见）
 * - 再不行：仍可用软删场景上残留的 local_path
 */
function resolveSceneImageRef(db, sceneId, opts = {}) {
  const pick = (scene) => {
    if (!scene) return null;
    let ref = scene.local_path || scene.image_url;
    if (!ref && scene.id != null) {
      const panel = db
        .prepare(
          `SELECT local_path, image_url FROM image_generations
           WHERE scene_id = ? AND frame_type = 'quad_panel_0' AND status = 'completed'
           ORDER BY id DESC LIMIT 1`
        )
        .get(Number(scene.id));
      if (panel) ref = panel.local_path || panel.image_url;
    }
    if (!ref) return null;
    return {
      ref,
      location: scene.location || '',
      scene_id: scene.id != null ? Number(scene.id) : null,
    };
  };

  const findActiveByDramaLocation = (dramaId, location) => {
    const loc = String(location || '').trim();
    if (!Number.isFinite(Number(dramaId)) || !loc) return null;
    // 精确地点
    let row = db
      .prepare(
        `SELECT id, image_url, local_path, location FROM scenes
         WHERE drama_id = ? AND deleted_at IS NULL AND location = ?
           AND (COALESCE(local_path, '') != '' OR COALESCE(image_url, '') != '')
         ORDER BY id DESC LIMIT 1`
      )
      .get(Number(dramaId), loc);
    if (row) return pick(row);
    // 前缀/包含（分镜 location 常比场景名更长）
    row = db
      .prepare(
        `SELECT id, image_url, local_path, location FROM scenes
         WHERE drama_id = ? AND deleted_at IS NULL
           AND (location LIKE ? OR ? LIKE (location || '%'))
           AND (COALESCE(local_path, '') != '' OR COALESCE(image_url, '') != '')
         ORDER BY LENGTH(location) ASC, id DESC LIMIT 1`
      )
      .get(Number(dramaId), `${loc}%`, loc);
    return pick(row);
  };

  let dramaId = opts.drama_id != null ? Number(opts.drama_id) : null;
  let locationHint = String(opts.location || '').trim();

  if (sceneId != null && Number.isFinite(Number(sceneId))) {
    const active = db
      .prepare(
        `SELECT id, image_url, local_path, location, drama_id FROM scenes
         WHERE id = ? AND deleted_at IS NULL`
      )
      .get(Number(sceneId));
    const hit = pick(active);
    if (hit) return hit;

    const any = db
      .prepare(
        `SELECT id, image_url, local_path, location, drama_id, deleted_at FROM scenes WHERE id = ?`
      )
      .get(Number(sceneId));
    if (any) {
      if (dramaId == null && any.drama_id != null) dramaId = Number(any.drama_id);
      if (!locationHint && any.location) locationHint = String(any.location).trim();
    }

    const fallback = findActiveByDramaLocation(dramaId, locationHint);
    if (fallback) return fallback;

    // 软删但仍有文件：最后兜底
    if (any && any.deleted_at) {
      const stale = pick(any);
      if (stale) return stale;
    }
  }

  return findActiveByDramaLocation(dramaId, locationHint);
}

function orderSpeakers(speakerCounts, dramaCharacters, maxN = MAX_SPEAKER_PLATES_DUO) {
  const names = Object.keys(speakerCounts);
  if (!names.length) return [];
  const dramaOrder = new Map();
  (dramaCharacters || []).forEach((c, i) => {
    const n = String(c.name || '').trim();
    if (n) dramaOrder.set(n, i);
  });
  names.sort((a, b) => {
    const ia = dramaOrder.has(a) ? dramaOrder.get(a) : 999;
    const ib = dramaOrder.has(b) ? dramaOrder.get(b) : 999;
    if (ia !== ib) return ia - ib;
    return (speakerCounts[b] || 0) - (speakerCounts[a] || 0);
  });
  return names.slice(0, Math.max(1, maxN));
}

/**
 * 座位表：按角色顺序入座，分区随人数缩放。
 * - 1 人：中央区
 * - 2 人：左 / 右（面对面桌戏）
 * - ≥3 人：左 / 中 / 右 三等分
 * @returns {{ name: string, seat: number, zone: 'left'|'center'|'right' }[]}
 */
function buildSeatingChart(castNames) {
  const names = (castNames || []).map((n) => String(n || '').trim()).filter(Boolean);
  const n = names.length;
  if (!n) return [];

  if (n === 1) {
    return [{ name: names[0], seat: 1, zone: 'center' }];
  }
  if (n === 2) {
    return [
      { name: names[0], seat: 1, zone: 'left' },
      { name: names[1], seat: 2, zone: 'right' },
    ];
  }

  const leftEnd = Math.ceil(n / 3);
  const centerEnd = Math.ceil((2 * n) / 3);
  return names.map((name, i) => {
    const seat = i + 1;
    let zone = 'right';
    if (i < leftEnd) zone = 'left';
    else if (i < centerEnd) zone = 'center';
    return { name, seat, zone };
  });
}

function zoneLabel(zone) {
  if (zone === 'left') return '左侧区';
  if (zone === 'center') return '中央区';
  if (zone === 'right') return '右侧区';
  return String(zone || '');
}

function buildWideLayout(chart, location) {
  const place = location || '室内';
  const n = (chart || []).length;
  const seats = (chart || [])
    .map((s) => `座位${s.seat}(${zoneLabel(s.zone)})=${s.name}`)
    .join('；');

  if (n === 2) {
    const left = chart.find((s) => s.zone === 'left') || chart[0];
    const right = chart.find((s) => s.zone === 'right') || chart[1];
    return (
      `${place}。固定机位中全景（双人座位表）。` +
      `${left.name}固定在画面左侧座位，${right.name}固定在画面右侧座位，隔桌面对面坐着。` +
      `房间/背景必须匹配场景参考图（空房间：窗、工位、柜、灯），删除场景图里所有人物后再只放这两人。` +
      `有且仅有${left.name}与${right.name}各一人，禁止克隆、禁止同一人出现两次、禁止第三人。` +
      `座位表：${seats}。左右关系永久锁定，后续偏侧同框板必须服从本表；禁止起身换边。`
    );
  }

  return (
    `${place}。固定机位全景/半全景，座位表锁定。` +
    `所有人围桌（或围坐）面向桌心，禁止起身换位。` +
    `座位表（从画面左到右编号）：${seats || '按角色顺序入座'}。` +
    `分区关系永久锁定，后续分区板与单人板必须服从本表。`
  );
}

function buildZoneLayout(zone, members, chart, location) {
  const place = location || '室内';
  const zLabel = zoneLabel(zone);
  const n = (chart || []).length;

  if (n === 2) {
    const left = chart.find((s) => s.zone === 'left') || chart[0];
    const right = chart.find((s) => s.zone === 'right') || chart[1];
    const favor = zone === 'right' ? right : left;
    const partner = zone === 'right' ? left : right;
    const favorSide = zone === 'right' ? '右' : '左';
    return (
      `${place}。正反打 POV（隔桌正脸视角）：镜头在${partner.name}座位眼睛高度，正对${favor.name}；` +
      `${favor.name}正脸看镜头（禁止侧面）。画面只有${favor.name}一人，禁止克隆。` +
      `构图：下部约1/3大会议桌桌面朝向镜头，中部${favor.name}居中，背后落地窗。` +
      `桌子与全景同一张；身后=全景里该角色身后（${favorSide}侧窗），禁止正中红幅。` +
      `座位约定：${left.name}左/${right.name}右。参考=全景裁条(身后+桌面)+身份图。`
    );
  }

  const memberText = (members || []).join('、') || '本区成员';
  const seatHints = (chart || [])
    .filter((s) => s.zone === zone)
    .map((s) => `${s.name}=座位${s.seat}`)
    .join('，');
  return (
    `${place}。固定机位中景，${zLabel}分区板。` +
    `画面主体为本区就座人员：${memberText}（${seatHints || '座位锁定'}）。` +
    `其他人可只露空椅/肩部边缘，不得抢戏、不得换区。` +
    `朝向桌心，坐姿稳定，禁止起身走动。`
  );
}

function buildTwoShotLayout(leftName, rightName, location) {
  const place = location || '室内';
  return (
    `${place}。固定机位中景，两人隔桌（或隔空）面对面坐着谈话。` +
    `${leftName}固定坐在画面左侧座位，身体与视线朝向右侧对方；` +
    `${rightName}固定坐在画面右侧座位，身体与视线朝向左侧对方。` +
    `两人相对而坐，左右座位锁定，禁止起身、换边、并肩同向或并排朝镜头。`
  );
}

function buildSpeakerLayout(speakerName, partnerName, side, location, seatInfo = null) {
  const place = location || '室内';
  if (seatInfo && seatInfo.seat) {
    const zLabel = zoneLabel(seatInfo.zone);
    return (
      `${place}。固定机位中近景，严格单人出境。` +
      `画面中只能出现${speakerName}一人，禁止出现任何其他人物（含虚化、半身、手、肩、倒影）。` +
      `${speakerName}坐在会议桌${zLabel}座位${seatInfo.seat}，面向桌心说话。` +
      `周围只保留空椅暗示会场，禁止第二人入画，禁止换座。`
    );
  }
  const sideLabel = side === 'left' ? '左侧' : '右侧';
  const faceDir = side === 'left' ? '右侧（对面座位方向）' : '左侧（对面座位方向）';
  const partnerNote = partnerName
    ? `对面原是${partnerName}的座位，现为空椅/空桌，仅作空间暗示。`
    : '对面空座位保留，仅作空间暗示。';
  return (
    `${place}。固定机位中近景，严格单人出境。` +
    `画面中只能出现${speakerName}一人，禁止出现任何其他人物（含虚化、半身、手、肩、倒影）。` +
    `${speakerName}坐在画面${sideLabel}座位，身体与视线朝向${faceDir}，保持隔桌面对面谈话姿态。` +
    `${partnerNote}禁止起身换位，禁止第二人入画。`
  );
}

function buildPlatePrompt({ plateType, layout, speakers, location, time, style, zoneKey }) {
  const place = [location, time].filter(Boolean).join('，') || '室内场景';
  const styleLine = style ? `画风必须遵守：${style}（不要改成写实摄影）。` : '';
  const stableTail = style
    ? `稳定机位，电影构图，适合多镜复用的首帧锚点。`
    : `写实摄影质感可选，稳定机位，适合多镜复用的首帧锚点。`;
  if (plateType === 'wide') {
    const duo = (speakers || []).length === 2;
    return [
      duo ? `电影剧照，定镜对白母版（全景座位表·双人面对面）。` : `电影剧照，定镜对白母版（全景座位表）。`,
      layout,
      `场景：${place}。`,
      duo
        ? `构图：正面中全景，两人上半身完整入画、坐在画面中部偏下，头顶留白约10%-20%；隔桌面对面；有且仅有 ${(speakers || []).join('与')} 两人。禁止只露出头顶、禁止脚部占满半幅。`
        : `构图：长桌/围坐全貌，每人座位清晰可辨，分区锁定。`,
      duo
        ? `COUNT LOCK: exactly 2 people total. No third person, no bystander, no standing colleague behind desk, no extra silhouette.`
        : `禁止：站立走动、换座、人物重叠成糊、文字水印、分屏宫格。`,
      duo ? `禁止：第三人、路人、背景人影、站立走动、换座、文字水印、分屏宫格。` : null,
      styleLine,
      stableTail,
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (plateType === 'zone') {
    const zLabel = zoneLabel(zoneKey);
    const names = (speakers || []).join('、');
    const duoBias = (speakers || []).length === 2;
    const favor =
      zoneKey === 'right'
        ? (speakers || [])[1] || (speakers || [])[0]
        : (speakers || [])[0];
    const partner =
      duoBias && favor
        ? (speakers || []).find((n) => n && n !== favor) || (speakers || [])[1] || (speakers || [])[0]
        : null;
    return [
      duoBias
        ? `定镜对白母版：正反打 POV（${partner || '对方'}眼睛视角·仅${favor || '说话人'}）。`
        : `电影剧照，定镜对白母版（分区板·${zLabel}）。`,
      layout,
      `场景：${place}。`,
      duoBias
        ? buildDuoReverseShotGenPrompt({
            favorName: favor,
            partnerName: partner,
            location: place,
            style,
            favorSide: zoneKey === 'right' ? 'right' : 'left',
          })
        : `主体：${names || zLabel}就座于本区，其余区域以空椅暗示。`,
      duoBias ? null : `禁止：换区、起身、全桌无关路人抢戏、文字水印、分屏宫格。`,
      duoBias ? null : styleLine,
      duoBias ? null : stableTail,
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (plateType === 'two_shot') {
    const [a, b] = speakers;
    return [
      `电影剧照，定镜对白母版（同框双人·面对面）。`,
      layout,
      `场景：${place}。`,
      `${a}在左、${b}在右，隔桌面对面坐姿，表情克制，口型闭合或微张。`,
      `构图：两人同框，座位左右关系绝对锁定，中间桌子清晰。COUNT LOCK: exactly 2 people.`,
      `禁止：第三人、站立、走动、换边、并肩同向、背对对方、大动作、花哨运镜、文字水印、分屏宫格。`,
      styleLine,
      stableTail,
    ]
      .filter(Boolean)
      .join(' ');
  }
  const speaker = speakers[0];
  const multi = (speakers || []).length >= 2;
  return [
    multi
      ? `电影剧照，定镜对白母版（偏主体同框·过肩）。`
      : `电影剧照，定镜对白母版（单人出境）。`,
    layout,
    `场景：${place}。`,
    multi
      ? `CRITICAL：${(speakers || []).join('与')}同框；机位偏向 ${speaker}，禁止删人成单人肖像。`
      : `CRITICAL：画面中有且仅有 ${speaker} 一人；不要生成第二个人。`,
    multi ? `主体偏重：${speaker}。` : `主体：${speaker}坐姿面向桌心/对面空位说话。`,
    multi
      ? `禁止：单人出境、换边、起身、文字水印、分屏宫格。`
      : `禁止：第二人、双人同框、起身、走动、换边、文字水印、分屏宫格。`,
    styleLine,
    stableTail,
  ]
    .filter(Boolean)
    .join(' ');
}

const COVERAGE_DUO_NEGATIVE =
  'third person, fourth person, crowd, bystander, extra people, group photo, three people, standing colleague, ' +
  'duplicate same person twice, clone, twin, two copies of same face, identical character twice, ' +
  'frontal wide establishing two-shot, panoramic seating chart framing, split screen, collage, watermark, text overlay';

const COVERAGE_OTS_NEGATIVE =
  COVERAGE_DUO_NEGATIVE +
  ', frontal wide shot, both faces fully frontal, both faces sharp, ' +
  'second full body across desk, establishing wide office shot, medium wide two-shot facing camera, seating chart composition';

/**
 * 从场景图裁切左/右侧窗景作 POV 背景锁（无全景时的回退）
 * @returns {Promise<string|null>} 相对 storage 路径
 */
async function cropSceneSideBackdropRef(db, sceneRef, side, dramaId, log) {
  const relIn = String(sceneRef || '').trim();
  if (!relIn) return null;
  let sharp;
  try {
    sharp = require('sharp');
  } catch (_) {
    log?.warn?.('[coverage] sharp missing, skip scene side crop');
    return null;
  }
  const cfg = loadConfig();
  const storagePath = path.isAbsolute(cfg.storage?.local_path)
    ? cfg.storage.local_path
    : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
  const absIn = path.isAbsolute(relIn) ? relIn : path.join(storagePath, relIn);
  if (!fs.existsSync(absIn)) {
    log?.warn?.('[coverage] scene file missing for side crop', { ref: relIn });
    return null;
  }
  const inputBuf = fs.readFileSync(absIn);
  const meta = await sharp(inputBuf).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (w < 64 || h < 64) return null;

  const cropW = Math.max(48, Math.floor(w * 0.42));
  const left = side === 'right' ? Math.min(w - cropW, Math.floor(w * 0.58)) : 0;
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId);
  const absDir = path.join(storagePath, projectSubdir || '', 'images');
  fs.mkdirSync(absDir, { recursive: true });
  const filename = `cvg_scene_${side}_${Date.now().toString(36)}.jpg`;
  const absOut = path.join(absDir, filename);
  const outBuf = await sharp(inputBuf)
    .extract({ left, top: 0, width: cropW, height: h })
    .resize(Math.max(512, Math.floor(w * 0.7)), h, { fit: 'fill' })
    .jpeg({ quality: 90 })
    .toBuffer();
  fs.writeFileSync(absOut, outBuf);
  return path.relative(storagePath, absOut).replace(/\\/g, '/');
}

/**
 * 从已完成全景座位表裁出 POV 支撑条（不喂整张双人构图）：
 * - backdrop：该侧上半身后背景（窗/墙）
 * - desk：下部桌面条（锁材质/颜色/桌面物品）
 * @returns {Promise<{ backdrop: string|null, desk: string|null }>}
 */
async function extractWidePovSupportCrops(db, wideRow, side, dramaId, log) {
  const out = { backdrop: null, desk: null };
  if (!wideRow) return out;
  let sharp;
  try {
    sharp = require('sharp');
  } catch (_) {
    log?.warn?.('[coverage] sharp missing, skip wide pov crops');
    return out;
  }
  const cfg = loadConfig();
  const storagePath = path.isAbsolute(cfg.storage?.local_path)
    ? cfg.storage.local_path
    : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
  let absWide = null;
  if (wideRow.local_path) {
    absWide = path.isAbsolute(wideRow.local_path)
      ? wideRow.local_path
      : path.join(storagePath, wideRow.local_path);
  }
  if ((!absWide || !fs.existsSync(absWide)) && wideRow.image_url) {
    try {
      const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId || wideRow.drama_id);
      const rel = await uploadService.downloadImageToLocal(
        storagePath,
        wideRow.image_url,
        'images',
        log,
        'cvg_wide',
        projectSubdir
      );
      if (rel) absWide = path.join(storagePath, rel);
    } catch (_) {}
  }
  if (!absWide || !fs.existsSync(absWide)) return out;

  const inputBuf = fs.readFileSync(absWide);
  const meta = await sharp(inputBuf).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (w < 64 || h < 64) return out;

  const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId || wideRow.drama_id);
  const absDir = path.join(storagePath, projectSubdir || '', 'images');
  fs.mkdirSync(absDir, { recursive: true });
  const stamp = Date.now().toString(36);
  const sideKey = side === 'right' ? 'right' : 'left';

  // 该侧上半外缘：身后窗/墙（尽量避开人脸与对坐构图）
  const bdW = Math.max(48, Math.floor(w * 0.32));
  const bdH = Math.max(48, Math.floor(h * 0.48));
  const bdLeft = sideKey === 'right' ? Math.min(w - bdW, Math.floor(w * 0.68)) : 0;
  const bdTop = 0;
  const bdName = `cvg_wide_bd_${sideKey}_${stamp}.jpg`;
  const bdAbs = path.join(absDir, bdName);
  await sharp(inputBuf)
    .extract({ left: bdLeft, top: bdTop, width: bdW, height: bdH })
    .resize(Math.max(640, bdW * 2), Math.max(480, bdH * 2), { fit: 'fill' })
    .jpeg({ quality: 90 })
    .toFile(bdAbs);
  out.backdrop = path.relative(storagePath, bdAbs).replace(/\\/g, '/');

  // 桌面中部偏下：留够前景大桌面（约画面下部 1/3 的参考）
  const deskH = Math.max(48, Math.floor(h * 0.32));
  const deskTop = Math.min(h - deskH, Math.floor(h * 0.58));
  const deskW = Math.max(64, Math.floor(w * 0.55));
  const deskLeft = Math.floor((w - deskW) / 2);
  const deskName = `cvg_wide_desk_${stamp}.jpg`;
  const deskAbs = path.join(absDir, deskName);
  await sharp(inputBuf)
    .extract({ left: deskLeft, top: deskTop, width: deskW, height: deskH })
    .resize(Math.max(768, deskW * 2), Math.max(256, deskH * 2), { fit: 'fill' })
    .jpeg({ quality: 90 })
    .toFile(deskAbs);
  out.desk = path.relative(storagePath, deskAbs).replace(/\\/g, '/');

  return out;
}

/** 正反打 POV 统一负面（禁克隆对坐、禁侧脸、禁无大前景桌） */
const COVERAGE_REVERSE_NEGATIVE =
  '过肩镜头, 后脑勺, 肩膀入镜, 斜角度, 斜视, 侧面, 侧脸, 半侧面, 侧身对坐, 文字, 水印, 3d, 写实, 照片, 模糊, 畸形, ' +
  '重复角色, 克隆, 双胞胎, 同一人两次, 分身, 两个相同的人面对面, 两人同框, ' +
  '没有桌子, 无桌, 悬空坐, 桌面太小, 只露一条桌沿, floating chair, missing desk, no table, tiny desk strip, ' +
  '中间红幅居中背后, same center banner behind both, ' +
  'profile view, side view, three-quarter profile, two people facing each other, mirror twin across desk, ' +
  'sitting at table end, head of table, swapped left-right backdrop, bird eye view, low angle, ' +
  'over-the-shoulder, occiput, dutch angle, watermark, text, ' +
  'duplicate same person twice, clone, twin, two copies of same face, ' +
  'third person, two people, duo two-shot, seating chart composition, three people, group photo';

/**
 * 双人正反打 POV 生图提示
 * 目标构图（用户示意）：隔桌正脸 POV——前景大桌面约占画面下部1/3，人物居中正脸看镜头，身后落地窗
 */
function buildDuoReverseShotGenPrompt({
  favorName,
  partnerName,
  location,
  style,
  appearance,
  mode = 'pov',
  hasSceneRef = false,
  hasWideRef = false,
  hasSideBackdrop = false,
  hasDeskCrop = false,
  favorSide = 'left',
}) {
  const place = String(location || '').trim() || '现代明亮开放式办公室';
  const favor = favorName || '说话人';
  const partner = partnerName || '对方';
  const side = favorSide === 'right' ? 'right' : 'left';
  const sideZh = side === 'right' ? '右' : '左';
  const otherZh = side === 'right' ? '左' : '右';
  const styleLine = style
    ? `画风必须遵守：${style}（赛璐璐平涂、干净线条优先）。`
    : '现代日系动漫，赛璐璐画风，平涂上色，干净线条。';
  const look = String(appearance || '').trim()
    ? String(appearance).trim().slice(0, 160)
    : `与身份参考图及全景中的${favor}同人同服同发型`;

  void mode;
  void hasWideRef;

  const roomLine = hasSideBackdrop
    ? `身后大面积落地窗/城市天际线必须匹配「${sideZh}侧背景裁条」；两侧可有工位隔断；禁止正中红幅贴在脑后。`
    : hasSceneRef
      ? `身后大面积落地窗取自场景/全景${sideZh}侧窗景；禁止正中红幅。`
      : `房间：${place}；${favor}身后应是大面积${sideZh}侧落地窗。`;

  const deskLine = hasDeskCrop
    ? `DESK LOCK：前景会议桌必须与「桌面条裁切」同材质同颜色同桌面物品；桌面从画面底部向上占约 28%-35% 高度，呈「对面坐着看过来」的近大远小透视；禁止只剩一条细桌沿。`
    : `DESK LOCK：前景大桌面约占画面下部 1/3，桌面物品清晰；禁止无桌或只露细桌沿。`;

  return [
    `masterpiece, best quality, ${styleLine}`,
    `COMPOSITION RECIPE（用户指定视角）：第一人称隔桌正脸 POV。` +
      `画面分三层——①下部：大会议桌桌面朝向镜头；②中部：${favor}坐在桌对面正中；③上部/背后：落地窗。`,
    `FRONTAL EYE-LEVEL（CRITICAL）：平视 0°，镜头高度约在${partner}眼睛位置，正对${favor}；` +
      `${favor}正脸面向镜头、双眼直视镜头；禁止侧面/半侧面/侧脸对坐。`,
    roomLine,
    `POV：镜头位于${otherZh}侧座位（${partner}视角），但画面完全不出现${partner}，也不克隆第二个${favor}。`,
    deskLine,
    `BACKDROP LOCK：${favor}正后方是全景里TA身后那一侧的落地窗（${sideZh}侧），窗前可有矮柜/绿植；禁止正中红幅。`,
    `SUBJECT：画面中心只有${favor}一人，${look}，胸部以上中近景，居中对称构图。`,
    `SINGLE SUBJECT LOCK：有且仅有 1 个${favor}；禁止克隆/分身；禁止两人同框；对面座位留空。`,
    `明亮办公室自然光+顶灯，干净漫画阴影，无过肩，16:9，no text, no watermark`,
  ].join('\n');
}

function getCharacterAppearanceText(db, charId) {
  if (!Number.isFinite(Number(charId))) return '';
  const c = db
    .prepare(
      'SELECT appearance, description, name FROM characters WHERE id = ? AND deleted_at IS NULL'
    )
    .get(Number(charId));
  if (!c) return '';
  return String(c.appearance || c.description || '').trim().slice(0, 160);
}

function idsForNames(names, nameToChar, limit) {
  const ids = [];
  for (const n of names || []) {
    const id = nameToChar.get(n)?.id;
    if (Number.isFinite(Number(id))) ids.push(Number(id));
    if (limit && ids.length >= limit) break;
  }
  return ids;
}

function buildDuoPlates(speakers, g, style, nameToChar) {
  const plates = [];
  if (speakers.length >= 2) {
    const [left, right] = speakers;
    const layout = buildTwoShotLayout(left, right, g.location);
    plates.push({
      plate_type: 'two_shot',
      speaker_name: null,
      zone_key: null,
      members: [left, right],
      speakers: [left, right],
      layout_description: layout,
      prompt: buildPlatePrompt({
        plateType: 'two_shot',
        layout,
        speakers: [left, right],
        location: g.location,
        time: g.time,
        style,
      }),
      character_ids: idsForNames([left, right], nameToChar, 4),
    });
  }
  speakers.forEach((name, idx) => {
    const partner = speakers.find((s) => s !== name) || null;
    const side = idx === 0 ? 'left' : idx === 1 ? 'right' : idx % 2 === 0 ? 'left' : 'right';
    const layout = buildSpeakerLayout(name, partner, side, g.location);
    plates.push({
      plate_type: 'speaker',
      speaker_name: name,
      zone_key: side === 'left' ? 'left' : 'right',
      members: [name],
      speakers: [name],
      layout_description: layout,
      prompt: buildPlatePrompt({
        plateType: 'speaker',
        layout,
        speakers: [name],
        location: g.location,
        time: g.time,
        style,
      }),
      character_ids: idsForNames([name], nameToChar, 1),
    });
  });
  return plates;
}

function buildEnsemblePlates(cast, g, style, nameToChar, speakerCounts) {
  const chart = buildSeatingChart(cast);
  const plates = [];

  const wideLayout = buildWideLayout(chart, g.location);
  plates.push({
    plate_type: 'wide',
    speaker_name: null,
    zone_key: 'wide',
    members: cast.slice(),
    speakers: cast.slice(0, MAX_WIDE_CHAR_REFS),
    layout_description: wideLayout,
    prompt: buildPlatePrompt({
      plateType: 'wide',
      layout: wideLayout,
      speakers: cast,
      location: g.location,
      time: g.time,
      style,
    }),
    character_ids: idsForNames(cast, nameToChar, MAX_WIDE_CHAR_REFS),
  });

  for (const zone of ['left', 'center', 'right']) {
    const zoneMembers = chart.filter((s) => s.zone === zone).map((s) => s.name);
    if (!zoneMembers.length) continue;
    const favorName = zoneMembers[0];
    // 双人：分区板仍引用双方外貌，画面同框；members/speakers 放双方，speaker_name 标记偏重侧
    const duo = cast.length === 2;
    const plateMembers = duo ? cast.slice() : zoneMembers;
    const layout = buildZoneLayout(zone, zoneMembers, chart, g.location);
    plates.push({
      plate_type: 'zone',
      speaker_name: duo ? favorName : null,
      zone_key: zone,
      members: plateMembers,
      speakers: plateMembers,
      layout_description: layout,
      prompt: buildPlatePrompt({
        plateType: 'zone',
        layout,
        speakers: plateMembers,
        location: g.location,
        time: g.time,
        style,
        zoneKey: zone,
      }),
      character_ids: idsForNames(plateMembers, nameToChar, duo ? 4 : MAX_ZONE_CHAR_REFS),
    });
  }

  // 双人桌戏：左右偏置同框已覆盖说话切换，不再单独出「真·单人」板（避免对方消失）
  if (cast.length === 2) {
    return { plates, chart, mode: 'duo_unified' };
  }

  // 多人：高频说话人近景改为「偏主体但仍可带同区邻座」的过肩感，禁止硬删全场
  const maxSp = cast.length <= 4 ? Math.max(cast.length, MAX_SPEAKER_PLATES_DUO) : MAX_SPEAKER_PLATES_ENSEMBLE;
  let topSpeakers = orderSpeakers(speakerCounts, [...nameToChar.values()], maxSp).filter((n) =>
    cast.includes(n)
  );
  if (cast.length <= 4) {
    for (const n of cast) {
      if (!topSpeakers.includes(n)) topSpeakers.push(n);
    }
  }
  for (const name of topSpeakers) {
    const seatInfo = chart.find((s) => s.name === name) || null;
    const side = seatInfo?.zone === 'right' ? 'right' : 'left';
    const neighbors = chart
      .filter((s) => s.zone === seatInfo?.zone && s.name !== name)
      .map((s) => s.name);
    const partner = neighbors[0] || cast.find((s) => s !== name) || null;
    const layout = buildFavoredTwoShotLayout(name, partner, side, g.location, seatInfo);
    const memberList = partner ? [name, partner] : [name];
    plates.push({
      plate_type: 'speaker',
      speaker_name: name,
      zone_key: seatInfo?.zone || null,
      members: memberList,
      speakers: memberList,
      layout_description: layout,
      prompt: buildPlatePrompt({
        plateType: 'speaker',
        layout,
        speakers: memberList,
        location: g.location,
        time: g.time,
        style,
      }),
      character_ids: idsForNames(memberList, nameToChar, 4),
    });
  }

  return { plates, chart, mode: 'ensemble' };
}

/** 偏主体同框（过肩/斜切），用于多人「说话人板」——不再做真单人删人 */
function buildFavoredTwoShotLayout(favorName, partnerName, side, location, seatInfo = null) {
  const place = location || '室内';
  const sideLabel = side === 'right' ? '右侧' : '左侧';
  if (!partnerName) {
    return (
      `${place}。固定机位中近景。${favorName}在${sideLabel}座位说话` +
      (seatInfo?.seat ? `（座位${seatInfo.seat}）` : '') +
      `，可保留邻座空椅暗示，禁止换座。`
    );
  }
  return (
    `${place}。固定机位中近景，偏${sideLabel}同框。` +
    `CRITICAL：${favorName}与${partnerName}同框；机位偏向${favorName}（过肩/斜切），` +
    `${partnerName}仍入画。禁止删掉${partnerName}做成单人肖像，禁止换边。`
  );
}

function planCoveragePlatesForEpisode(db, episodeId) {
  const epId = Number(episodeId);
  const ep = db.prepare('SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(epId);
  if (!ep) {
    const err = new Error('集不存在');
    err.code = 'not_found';
    throw err;
  }
  const dramaId = ep.drama_id;
  const drama = db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
  let meta = {};
  try {
    meta = drama?.metadata ? JSON.parse(drama.metadata) : {};
  } catch (_) {}
  const style = String(drama?.style || meta.story_style || '').trim();

  const storyboards = db
    .prepare(
      `SELECT id, storyboard_number, scene_id, location, time, title, dialogue, narration, action, characters, movement
       FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC`
    )
    .all(epId);

  const dramaCharacters = db
    .prepare(
      `SELECT id, name, image_url, local_path FROM characters
       WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC`
    )
    .all(dramaId);

  const groupsMap = new Map();
  for (const sb of storyboards) {
    const key = sceneKeyOf(sb);
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        scene_key: key,
        scene_id: sb.scene_id != null ? Number(sb.scene_id) : null,
        location: null,
        time: String(sb.time || '').trim() || null,
        storyboard_ids: [],
        speaker_counts: {},
        character_ids: new Set(),
      });
    }
    const g = groupsMap.get(key);
    g.storyboard_ids.push(sb.id);
    if (g.scene_id == null && sb.scene_id != null) g.scene_id = Number(sb.scene_id);
    if (!g.time && sb.time) g.time = String(sb.time).trim();
    for (const name of extractSpeakersFromStoryboard(sb)) {
      g.speaker_counts[name] = (g.speaker_counts[name] || 0) + 1;
    }
    for (const c of parseSbCharacters(sb.characters)) {
      g.character_ids.add(c.id);
      if (c.name) g.speaker_counts[c.name] = g.speaker_counts[c.name] || 0;
    }
  }

  // 地点名优先取 scenes.location（短名）；避免分镜 location 里「林薇坐在桌后…」污染单人板
  for (const g of groupsMap.values()) {
    if (g.scene_id != null) {
      const scene = db
        .prepare('SELECT location FROM scenes WHERE id = ? AND deleted_at IS NULL')
        .get(g.scene_id);
      const loc = String(scene?.location || '').trim();
      if (loc) {
        g.location = loc.length > 40 ? loc.slice(0, 40) : loc;
        continue;
      }
    }
    const sample = storyboards.find((s) => sceneKeyOf(s) === g.scene_key);
    const raw = String(sample?.location || '').trim();
    if (!raw) {
      g.location = null;
      continue;
    }
    // 分镜 location 常是长描述：只取首句/逗号前短片段，并去掉角色坐姿叙述
    let short = raw.split(/[。！？\n]/)[0] || raw;
    short = short.split(/[，,]/)[0] || short;
    short = short.replace(/[\u4e00-\u9fff]{1,8}(坐在|站在|拿着|看着).*$/g, '').trim();
    g.location = (short || '室内场景').slice(0, 40);
  }

  const nameToChar = new Map();
  for (const c of dramaCharacters) {
    const n = String(c.name || '').trim();
    if (n) nameToChar.set(n, c);
  }

  const groups = [];
  for (const g of groupsMap.values()) {
    // 全场出场名单（用于座位表），可多于近景板数量
    let cast = orderSpeakers(g.speaker_counts, dramaCharacters, MAX_CAST_FOR_SEATING);
    if (cast.length < 2) {
      const fromChars = [...g.character_ids]
        .map((id) => dramaCharacters.find((c) => Number(c.id) === Number(id)))
        .filter(Boolean)
        .map((c) => String(c.name || '').trim())
        .filter(Boolean);
      for (const n of fromChars) {
        if (!cast.includes(n)) cast.push(n);
      }
      cast = cast.slice(0, MAX_CAST_FOR_SEATING);
    }
    if (!cast.length && dramaCharacters.length) {
      cast = dramaCharacters
        .slice(0, 2)
        .map((c) => String(c.name || '').trim())
        .filter(Boolean);
    }

    const maxSp = cast.length <= 4 ? Math.max(cast.length, MAX_SPEAKER_PLATES_DUO) : MAX_SPEAKER_PLATES_ENSEMBLE;
    let speakers = orderSpeakers(g.speaker_counts, dramaCharacters, maxSp).filter((n) => cast.includes(n));
    if (cast.length <= 4) {
      for (const n of cast) {
        if (!speakers.includes(n)) speakers.push(n);
      }
    }
    if (!speakers.length) speakers = cast.slice();

    // 统一：全景座位表 + 按人数缩放的分区板 + 单人近景（含 ≤4 人桌戏）
    const built = buildEnsemblePlates(cast, g, style, nameToChar, g.speaker_counts);
    const plates = built.plates;
    const chart = built.chart;
    const mode = built.mode;

    groups.push({
      scene_key: g.scene_key,
      scene_id: g.scene_id,
      location: g.location,
      time: g.time,
      storyboard_ids: g.storyboard_ids,
      storyboard_count: g.storyboard_ids.length,
      speakers,
      cast,
      coverage_mode: mode,
      seating_chart: chart,
      plates,
    });
  }

  return {
    episode_id: epId,
    drama_id: dramaId,
    style,
    group_count: groups.length,
    plate_count: groups.reduce((n, g) => n + g.plates.length, 0),
    groups,
  };
}

function listCoveragePlates(db, episodeId) {
  const rows = db
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(1) FROM coverage_plate_versions v
          WHERE v.episode_id = p.episode_id
            AND (v.plate_id = p.id OR (v.lineage_key != '' AND v.lineage_key = COALESCE(p.lineage_key, ''))))
           AS version_count
       FROM coverage_plates p
       WHERE p.episode_id = ? AND p.deleted_at IS NULL
       ORDER BY p.scene_key ASC,
         CASE p.plate_type
           WHEN 'wide' THEN 0
           WHEN 'zone' THEN 1
           WHEN 'two_shot' THEN 2
           WHEN 'speaker' THEN 3
           ELSE 9
         END ASC,
         CASE p.zone_key
           WHEN 'wide' THEN 0
           WHEN 'left' THEN 1
           WHEN 'center' THEN 2
           WHEN 'right' THEN 3
           ELSE 9
         END ASC,
         p.speaker_name ASC, p.id ASC`
    )
    .all(Number(episodeId));
  return rows.map(rowToPlate);
}

function softDeleteEpisodePlates(db, episodeId) {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT * FROM coverage_plates WHERE episode_id = ? AND deleted_at IS NULL AND status = 'completed'`
    )
    .all(Number(episodeId));
  for (const row of rows) {
    archivePlateVersion(db, row, { note: 'replaced_batch' });
  }
  db.prepare(
    `UPDATE coverage_plates SET deleted_at = ?, updated_at = ? WHERE episode_id = ? AND deleted_at IS NULL`
  ).run(now, now, Number(episodeId));
}

function archivePlateVersion(db, plateRow, _meta = {}) {
  if (!plateRow) return null;
  const hasImg = !!(plateRow.local_path || plateRow.image_url);
  if (!hasImg) return null;
  const lineage =
    plateRow.lineage_key ||
    lineageKeyOf(plateRow, plateRow.scene_key);
  const info = db
    .prepare(
      `INSERT INTO coverage_plate_versions
        (plate_id, episode_id, lineage_key, prompt, image_url, local_path, image_gen_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(plateRow.id) || 0,
      Number(plateRow.episode_id) || 0,
      lineage,
      plateRow.prompt || null,
      plateRow.image_url || null,
      plateRow.local_path || null,
      plateRow.image_gen_id || null,
      new Date().toISOString()
    );
  return info.lastInsertRowid;
}

function listPlateVersions(db, plateId) {
  const plate = db
    .prepare('SELECT * FROM coverage_plates WHERE id = ?')
    .get(Number(plateId));
  if (!plate) {
    const err = new Error('母版不存在');
    err.code = 'not_found';
    throw err;
  }
  const lineage = plate.lineage_key || lineageKeyOf(plate, plate.scene_key);
  const rows = db
    .prepare(
      `SELECT * FROM coverage_plate_versions
       WHERE plate_id = ? OR (episode_id = ? AND lineage_key = ? AND lineage_key != '')
       ORDER BY id DESC
       LIMIT 40`
    )
    .all(Number(plateId), Number(plate.episode_id), lineage);
  // 去重：同一 local_path/image_url 只留最新
  const seen = new Set();
  const items = [];
  for (const r of rows) {
    const key = `${r.local_path || ''}|${r.image_url || ''}|${r.image_gen_id || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: r.id,
      plate_id: r.plate_id,
      episode_id: r.episode_id,
      lineage_key: r.lineage_key,
      prompt: r.prompt,
      image_url: r.image_url,
      local_path: r.local_path,
      image_gen_id: r.image_gen_id,
      created_at: r.created_at,
    });
  }
  return { plate_id: Number(plateId), lineage_key: lineage, items, total: items.length };
}

function restorePlateVersion(db, plateId, versionId) {
  const plate = db
    .prepare('SELECT * FROM coverage_plates WHERE id = ? AND deleted_at IS NULL')
    .get(Number(plateId));
  if (!plate) {
    const err = new Error('母版不存在');
    err.code = 'not_found';
    throw err;
  }
  const ver = db
    .prepare('SELECT * FROM coverage_plate_versions WHERE id = ?')
    .get(Number(versionId));
  if (!ver || !(ver.local_path || ver.image_url)) {
    const err = new Error('历史版本不存在或无图');
    err.code = 'not_found';
    throw err;
  }
  // 当前图先入历史
  if (plate.local_path || plate.image_url) {
    archivePlateVersion(db, plate);
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE coverage_plates SET image_url = ?, local_path = ?, image_gen_id = ?,
       prompt = COALESCE(?, prompt), status = 'completed', error_msg = NULL, updated_at = ?
     WHERE id = ?`
  ).run(
    ver.image_url || null,
    ver.local_path || null,
    ver.image_gen_id || null,
    ver.prompt || null,
    now,
    Number(plateId)
  );
  return getCoveragePlate(db, plateId);
}

async function waitImageGeneration(db, imageGenId, log) {
  const t0 = Date.now();
  while (Date.now() - t0 < IMAGE_WAIT_MS) {
    const row = db
      .prepare(
        `SELECT id, status, error_msg, image_url, local_path FROM image_generations
         WHERE id = ? AND deleted_at IS NULL`
      )
      .get(Number(imageGenId));
    if (!row) throw new Error(`图片任务不存在: ${imageGenId}`);
    if (row.status === 'completed') return row;
    if (row.status === 'failed') throw new Error(row.error_msg || `图片生成失败 #${imageGenId}`);
    await sleep(IMAGE_POLL_MS);
  }
  throw new Error(`图片生成超时 #${imageGenId}`);
}

function collectReferenceImages(db, sceneId, characterIds, opts = {}) {
  const refs = [];
  const seen = new Set();
  const push = (u) => {
    const s = String(u || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    refs.push(s);
  };
  // 过肩单图 reframing：只放全景母版
  for (const u of opts.reframeRefs || []) push(u);
  if (!opts.skipScene) {
    const sceneRef = resolveSceneImageRef(db, sceneId);
    if (sceneRef?.ref) push(sceneRef.ref);
  }
  for (const cid of characterIds || []) {
    const c = resolveCharacterImageRef(db, cid);
    if (c?.ref) push(c.ref);
  }
  return refs.slice(0, 8);
}

function findCompletedWideRef(db, episodeId, sceneKey) {
  const row = findCompletedWideRow(db, episodeId, sceneKey);
  if (!row) return null;
  return row.local_path || row.image_url || null;
}

function findCompletedWideRow(db, episodeId, sceneKey) {
  return (
    db
      .prepare(
        `SELECT * FROM coverage_plates
         WHERE episode_id = ? AND scene_key = ? AND plate_type = 'wide'
           AND status = 'completed' AND deleted_at IS NULL
           AND (local_path IS NOT NULL OR image_url IS NOT NULL)
         ORDER BY id DESC LIMIT 1`
      )
      .get(Number(episodeId), String(sceneKey || '')) || null
  );
}

/**
 * 双人左右板：从已完成全景做确定性偏侧裁切（同源像素，杜绝风格漂移/第三人）
 * favor=left → 偏左裁；favor=right → 偏右裁
 */
async function deriveDuoZoneCropFromWide(db, log, zonePlate, wideRow, favorSide) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    throw new Error('sharp 未安装，无法从全景裁切偏侧近景');
  }
  const cfg = loadConfig();
  const storagePath = path.isAbsolute(cfg.storage?.local_path)
    ? cfg.storage.local_path
    : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, zonePlate.drama_id || wideRow.drama_id);

  let absWide = null;
  if (wideRow.local_path) {
    absWide = path.isAbsolute(wideRow.local_path)
      ? wideRow.local_path
      : path.join(storagePath, wideRow.local_path);
  }
  if ((!absWide || !fs.existsSync(absWide)) && wideRow.image_url) {
    const rel = await uploadService.downloadImageToLocal(
      storagePath,
      wideRow.image_url,
      'images',
      log,
      'cvg_wide',
      projectSubdir
    );
    if (rel) absWide = path.join(storagePath, rel);
  }
  if (!absWide || !fs.existsSync(absWide)) {
    throw new Error('全景图文件不存在，无法裁切偏侧近景');
  }

  const inputBuf = fs.readFileSync(absWide);
  const meta = await sharp(inputBuf).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (w < 64 || h < 64) throw new Error('全景图尺寸过小');

  // 偏侧近景：更紧的半幅裁切（约 48% 宽），放大为主体中近景，仍同源自全景
  const cropW = Math.max(32, Math.floor(w * 0.48));
  const cropH = Math.max(32, Math.floor(h * 0.72));
  const top = Math.max(0, Math.floor((h - cropH) * 0.28));
  const left =
    favorSide === 'right'
      ? Math.min(w - cropW, Math.floor(w * 0.52))
      : 0;

  const absDir = path.join(storagePath, projectSubdir || '', 'images');
  fs.mkdirSync(absDir, { recursive: true });
  const filename = `cvg_crop_${zonePlate.id}_${favorSide}_${Date.now().toString(36)}.jpg`;
  const absOut = path.join(absDir, filename);
  const outBuf = await sharp(inputBuf)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(w, h, { fit: 'fill' })
    .jpeg({ quality: 92 })
    .toBuffer();
  fs.writeFileSync(absOut, outBuf);
  const relOut = path.relative(storagePath, absOut).replace(/\\/g, '/');
  return applyLocalImageToPlate(db, zonePlate, relOut, wideRow.image_gen_id || null);
}

/**
 * 双人左右板：以已完成全景 reframing 出正脸向镜头中近景
 */
async function deriveDuoZonesAfterWide(db, log, episodeId, sceneKey) {
  const all = listCoveragePlates(db, episodeId).filter((p) => p.scene_key === sceneKey);
  const bundle = detectDuoCoverageBundle(all);
  if (!bundle) return [];
  const wideRow = findCompletedWideRow(db, episodeId, sceneKey);
  if (!wideRefOk(wideRow)) return [];
  const ctx = resolvePlateGenContext(db, bundle.wide);
  const outs = [];
  for (const raw of [bundle.left, bundle.right]) {
    const zp = refreshStaleDuoZonePrompt(db, raw);
    const group = {
      scene_key: zp.scene_key,
      scene_id: zp.scene_id,
      location: zp.location,
      storyboard_ids: [],
    };
    const plateSpec = {
      plate_type: zp.plate_type,
      speaker_name: zp.speaker_name,
      zone_key: zp.zone_key,
      members: zp.members,
      prompt: zp.prompt,
      layout_description: zp.layout_description,
      character_ids: zp.character_ids || [],
    };
    outs.push(await generateOnePlate(db, log, ctx, group, plateSpec, zp.id));
  }
  return outs;
}

/** 识别双人定镜三件套：全景 + 左过肩 + 右过肩 */
function detectDuoCoverageBundle(platesForScene) {
  const list = Array.isArray(platesForScene) ? platesForScene : [];
  const wide = list.find((p) => p.plate_type === 'wide');
  const left = list.find((p) => p.plate_type === 'zone' && p.zone_key === 'left');
  const right = list.find((p) => p.plate_type === 'zone' && p.zone_key === 'right');
  if (!wide || !left || !right) return null;
  const members = left.members || [];
  if (members.length !== 2 && (wide.members || []).length !== 2) return null;
  return { wide, left, right };
}

function buildDuoCoverageGridPrompt({ leftName, rightName, location, style }) {
  const place = location || '室内办公室';
  const styleLine = style ? `Art style MUST be: ${style}.` : '';
  return [
    `Create ONE seamless 2x2 grid image (exactly 4 equal panels, no borders, no gutters, no labels, no text watermark).`,
    `Same two characters only in every panel: "${leftName}" (left seat) and "${rightName}" (right seat). Same clothes/hair/faces. Same office room.`,
    `COUNT LOCK: exactly 2 people total across the whole image content; no third person, no bystander.`,
    `Panel layout (2x2):`,
    `Top-left: WIDE seating master — frontal medium-wide, ${leftName} left seat, ${rightName} right seat, face-to-face across desk.`,
    `Top-right: TIGHT OTS MCU of ${leftName} — camera behind ${rightName}'s shoulder; ${rightName}=blurred occiput+shoulder on edge only; only ${leftName}'s face clear in center.`,
    `Bottom-left: TIGHT OTS MCU of ${rightName} — camera behind ${leftName}'s shoulder; ${leftName}=blurred occiput+shoulder on edge only; only ${rightName}'s face clear in center.`,
    `Bottom-right: same WIDE seating master as top-left (duplicate framing OK for consistency).`,
    `Scene: ${place}.`,
    styleLine,
    `CRITICAL: top-right and bottom-left must NOT be frontal wide two-shots; they must be true over-the-shoulder MCU.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * 将宫格图裁成 4 象限（无角标），写入 images/ 目录
 * @returns {Promise<Array<{ idx:number, local_path:string }>>}
 */
async function splitCoverageGridFile(absLocalPath, storagePath, projectSubdir) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    throw new Error('sharp 未安装，无法拆分定镜宫格');
  }
  const inputBuf = fs.readFileSync(absLocalPath);
  const meta = await sharp(inputBuf).metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) throw new Error('定镜宫格图片尺寸无效');
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  const quadrants = [
    { left: 0, top: 0, width: hw, height: hh, idx: 0 },
    { left: hw, top: 0, width: w - hw, height: hh, idx: 1 },
    { left: 0, top: hh, width: hw, height: h - hh, idx: 2 },
    { left: hw, top: hh, width: w - hw, height: h - hh, idx: 3 },
  ];
  const absDir = path.join(
    storagePath,
    projectSubdir || '',
    'images'
  );
  fs.mkdirSync(absDir, { recursive: true });
  const stamp = `cvg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const out = [];
  for (const q of quadrants) {
    const filename = `${stamp}_p${q.idx}.jpg`;
    const absPanel = path.join(absDir, filename);
    const buf = await sharp(inputBuf)
      .extract({ left: q.left, top: q.top, width: q.width, height: q.height })
      .jpeg({ quality: 92 })
      .toBuffer();
    fs.writeFileSync(absPanel, buf);
    const rel = path.relative(storagePath, absPanel).replace(/\\/g, '/');
    out.push({ idx: q.idx, local_path: rel });
  }
  return out;
}

function applyLocalImageToPlate(db, plate, localPath, imageGenId = null) {
  const prev = db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(Number(plate.id));
  if (prev && (prev.local_path || prev.image_url)) archivePlateVersion(db, prev);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE coverage_plates SET status = 'completed', local_path = ?, image_url = COALESCE(image_url, ?),
       image_gen_id = COALESCE(?, image_gen_id), error_msg = NULL, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`
  ).run(localPath, localPath, imageGenId, now, Number(plate.id));
  return rowToPlate(db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(Number(plate.id)));
}

/**
 * 双人场景：一次生成 2×2 定镜宫格，拆给 全景 / 左过肩 / 右过肩
 */
async function generateDuoCoverageGridBundle(db, log, ctx, bundle) {
  const { wide, left, right } = bundle;
  const members = left.members?.length === 2 ? left.members : wide.members || [];
  const leftName = members[0] || left.speaker_name || 'Left';
  const rightName = members[1] || right.speaker_name || 'Right';
  const location = wide.location || left.location || '室内';
  const prompt = buildDuoCoverageGridPrompt({
    leftName,
    rightName,
    location,
    style: ctx.style,
  });

  const charIds = Array.from(
    new Set([...(wide.character_ids || []), ...(left.character_ids || []), ...(right.character_ids || [])])
  ).filter((n) => Number.isFinite(Number(n)));

  // 宫格：场景空房间 + 角色外貌（不要喂旧全景，避免锁死旧构图）
  const refs = collectReferenceImages(db, wide.scene_id, charIds.slice(0, 4), {
    skipScene: false,
  });
  const refNotes = [];
  let idx = 1;
  const sceneRef = resolveSceneImageRef(db, wide.scene_id);
  if (sceneRef?.ref && refs.some((r) => String(r) === String(sceneRef.ref))) {
    refNotes.push(
      `Image ${idx}: SCENE ROOM ONLY for "${sceneRef.location || location}". Delete all people from this plate.`
    );
    idx += 1;
  }
  for (const cid of charIds.slice(0, 4)) {
    const c = resolveCharacterImageRef(db, cid);
    if (c?.ref && refs.some((r) => String(r) === String(c.ref))) {
      refNotes.push(`Image ${idx}: character identity only for "${c.name}"`);
      idx += 1;
    }
  }
  const promptWithRef = refNotes.length ? `${refNotes.join('\n')}\n\n${prompt}` : prompt;

  const nowMark = new Date().toISOString();
  for (const p of [wide, left, right]) {
    db.prepare(
      `UPDATE coverage_plates SET status = 'generating', updated_at = ? WHERE id = ? AND deleted_at IS NULL`
    ).run(nowMark, p.id);
  }

  const created = imageService.create(db, log, {
    drama_id: ctx.drama_id,
    episode_id: ctx.episode_id,
    storyboard_id: null,
    scene_id: null,
    prompt: promptWithRef,
    negative_prompt: COVERAGE_DUO_NEGATIVE + ', watermark, text overlay, third person, panel labels, thick borders',
    style: ctx.style || undefined,
    frame_type: 'coverage_grid',
    aspect_ratio: ctx.aspect_ratio || '1:1',
    reference_images: refs.length ? refs : undefined,
  });

  const done = await waitImageGeneration(db, created.id, log);
  const cfg = loadConfig();
  const storagePath = path.isAbsolute(cfg.storage?.local_path)
    ? cfg.storage.local_path
    : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, ctx.drama_id);

  let absLocal = null;
  if (done.local_path) {
    absLocal = path.isAbsolute(done.local_path)
      ? done.local_path
      : path.join(storagePath, done.local_path);
  }
  if (!absLocal || !fs.existsSync(absLocal)) {
    // 兜底再下一遍
    const rel = await uploadService.downloadImageToLocal(
      storagePath,
      done.image_url,
      'images',
      log,
      'cvg',
      projectSubdir
    );
    if (!rel) throw new Error('定镜宫格落盘失败');
    absLocal = path.join(storagePath, rel);
    db.prepare(`UPDATE image_generations SET local_path = ?, updated_at = ? WHERE id = ?`).run(
      rel,
      new Date().toISOString(),
      created.id
    );
  }

  const panels = await splitCoverageGridFile(absLocal, storagePath, projectSubdir);
  // 0=全景 1=左过肩(林薇) 2=右过肩(陈浩) 3=弃用/备份全景
  const map = [
    { plate: wide, idx: 0 },
    { plate: left, idx: 1 },
    { plate: right, idx: 2 },
  ];
  const results = [];
  for (const m of map) {
    const panel = panels.find((p) => p.idx === m.idx);
    if (!panel) {
      db.prepare(
        `UPDATE coverage_plates SET status = 'failed', error_msg = ?, updated_at = ? WHERE id = ?`
      ).run('定镜宫格拆分缺少面板', new Date().toISOString(), m.plate.id);
      results.push(rowToPlate(db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(m.plate.id)));
      continue;
    }
    results.push(applyLocalImageToPlate(db, m.plate, panel.local_path, created.id));
  }
  log.info('[coverage] duo grid applied', {
    scene_key: wide.scene_key,
    image_gen_id: created.id,
    plates: results.map((p) => p?.id),
  });
  return results;
}

function pickSeedStoryboardId(db, storyboardIds, characterIds) {
  const ids = (storyboardIds || []).map(Number).filter(Number.isFinite);
  if (!ids.length) return null;
  if (!characterIds?.length) return ids[0];
  for (const sid of ids) {
    const row = db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(sid);
    const chars = parseSbCharacters(row?.characters);
    const charIds = new Set(chars.map((c) => c.id));
    if (characterIds.every((id) => charIds.has(Number(id)))) return sid;
  }
  return ids[0];
}

async function generateOnePlate(db, log, ctx, group, plateSpec, existingPlateId = null) {
  const now = new Date().toISOString();
  let plateId = existingPlateId != null ? Number(existingPlateId) : null;
  const charIdsJson = JSON.stringify(
    (plateSpec.character_ids || []).map((x) => Number(x)).filter((n) => Number.isFinite(n))
  );
  const membersJson = JSON.stringify(
    (plateSpec.members || plateSpec.speakers || []).map((x) => String(x || '').trim()).filter(Boolean)
  );
  const zoneKey = plateSpec.zone_key != null ? String(plateSpec.zone_key) : null;
  const lineage = lineageKeyOf(
    {
      plate_type: plateSpec.plate_type,
      zone_key: zoneKey,
      speaker_name: plateSpec.speaker_name,
      scene_key: group.scene_key,
    },
    group.scene_key
  );

  if (!plateId) {
    const info = db
      .prepare(
        `INSERT INTO coverage_plates
          (drama_id, episode_id, scene_key, scene_id, location, plate_type, speaker_name, zone_key,
           members_json, lineage_key, layout_description, prompt, character_ids, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        ctx.drama_id,
        ctx.episode_id,
        group.scene_key,
        group.scene_id,
        group.location,
        plateSpec.plate_type,
        plateSpec.speaker_name,
        zoneKey,
        membersJson,
        lineage,
        plateSpec.layout_description,
        plateSpec.prompt,
        charIdsJson,
        now,
        now
      );
    plateId = info.lastInsertRowid;
  } else {
    const prev = db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(plateId);
    if (prev && (prev.local_path || prev.image_url)) {
      archivePlateVersion(db, prev);
    }
    db.prepare(
      `UPDATE coverage_plates SET status = 'generating', error_msg = NULL,
         prompt = COALESCE(?, prompt), layout_description = COALESCE(?, layout_description),
         character_ids = COALESCE(?, character_ids), zone_key = COALESCE(?, zone_key),
         members_json = COALESCE(?, members_json), lineage_key = COALESCE(?, lineage_key),
         updated_at = ? WHERE id = ? AND deleted_at IS NULL`
    ).run(
      plateSpec.prompt || null,
      plateSpec.layout_description || null,
      charIdsJson || null,
      zoneKey,
      membersJson || null,
      lineage,
      now,
      plateId
    );
  }

  const plateRow = db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(plateId);
  const prompt = String(plateRow?.prompt || plateSpec.prompt || '').trim();
  if (!prompt) {
    db.prepare(
      `UPDATE coverage_plates SET status = 'failed', error_msg = ?, updated_at = ? WHERE id = ?`
    ).run('缺少生图提示词', new Date().toISOString(), plateId);
    return rowToPlate(db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(plateId));
  }

  let characterIds = plateSpec.character_ids || [];
  if (!characterIds.length) {
    try {
      const parsed = plateRow?.character_ids ? JSON.parse(plateRow.character_ids) : [];
      if (Array.isArray(parsed)) characterIds = parsed.map(Number).filter(Number.isFinite);
    } catch (_) {}
  }

  // 参考图策略（双人定镜硬规则）：
  // - 全景：场景图(空房间背景) + 2 张角色外貌；场景里的人必须删掉，只留这两人、禁克隆
  // - 双人正反打 POV：只喂 场景图 + 说话人身份；绝不喂全景座位表（空间左右只在文案对应）
  // - 多人分区等：场景空房间 + 角色
  const memberNames = plateSpec.members || plateSpec.speakers || [];
  const castN = Array.isArray(memberNames) ? memberNames.length : 0;
  const isDuoCast = castN === 2 || (Array.isArray(characterIds) && characterIds.length === 2);
  const isDuoWide = isDuoCast && (plateSpec.plate_type === 'wide' || plateSpec.plate_type === 'two_shot');
  const isDuoZone = plateSpec.plate_type === 'zone' && isDuoCast;
  const isOtsLike =
    !isDuoZone && plateSpec.plate_type === 'speaker' && castN >= 2;

  // 双人全景强制只用两个角色 id
  if (isDuoWide && characterIds.length > 2) {
    characterIds = characterIds.slice(0, 2);
  }

  const favorName =
    (plateSpec.speaker_name && String(plateSpec.speaker_name).trim()) ||
    (isDuoZone && plateSpec.zone_key === 'right' ? memberNames[1] : memberNames[0]) ||
    '';
  const otherName =
    isDuoCast && favorName
      ? memberNames.find((n) => n && n !== favorName) || memberNames[0]
      : '';
  const favorSide = plateSpec.zone_key === 'right' ? 'right' : 'left';

  const sceneId = group.scene_id ?? plateRow?.scene_id;
  let refs;
  let refNoteParts = [];
  let frameType = 'coverage_plate';
  let duoZoneFavorRef = null;
  let duoZoneFavorId = null;
  let duoZoneSceneRef = null;
  let duoZoneSideBackdrop = null;
  let duoZoneDeskCrop = null;
  let duoZoneBackdropRef = null;
  let duoWideSceneRef = null;

  const rebindSceneIdIfNeeded = (sceneInfo) => {
    if (
      sceneInfo?.scene_id &&
      plateRow?.id &&
      Number(sceneInfo.scene_id) !== Number(plateRow.scene_id)
    ) {
      try {
        db.prepare(
          `UPDATE coverage_plates SET scene_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
        ).run(Number(sceneInfo.scene_id), new Date().toISOString(), Number(plateRow.id));
        log.info('[coverage] plate scene_id rebound', {
          plate_id: plateRow.id,
          from: plateRow.scene_id,
          to: sceneInfo.scene_id,
        });
      } catch (_) {}
    }
  };

  if (isDuoWide) {
    // 与近景同一场景图作空房间背景 + 两人身份
    const sceneInfo = resolveSceneImageRef(db, sceneId, {
      drama_id: ctx.drama_id || plateRow.drama_id,
      location: group.location || plateRow.location,
    });
    if (sceneInfo?.ref) duoWideSceneRef = sceneInfo.ref;
    rebindSceneIdIfNeeded(sceneInfo);
    refs = [];
    if (duoWideSceneRef) refs.push(duoWideSceneRef);
    let idx = 1;
    if (duoWideSceneRef) {
      refNoteParts.push(
        `Image ${idx}: SCENE ROOM ONLY for "${sceneInfo?.location || group.location || 'office'}". Match windows/furniture/layout as BACKGROUND. DELETE every person from this plate — then seat ONLY the two leads.`
      );
      idx += 1;
    }
    for (const cid of characterIds.slice(0, 2)) {
      const c = resolveCharacterImageRef(db, cid);
      if (c?.ref) {
        refs.push(c.ref);
        refNoteParts.push(
          `Image ${idx}: identity ONLY for "${c.name}" (face/hair/clothes). One instance only — never clone this person twice.`
        );
        idx += 1;
      }
    }
  } else if (isDuoZone) {
    // POV：不喂整张全景构图。优先从全景裁「该侧身后」+「桌面条」，再加身份；无全景则回退场景侧裁
    const sceneInfo = resolveSceneImageRef(db, sceneId, {
      drama_id: ctx.drama_id || plateRow.drama_id,
      location: group.location || plateRow.location,
    });
    if (sceneInfo?.ref) duoZoneSceneRef = sceneInfo.ref;
    rebindSceneIdIfNeeded(sceneInfo);
    if (favorName) {
      const favorId = characterIds.find((cid) => {
        const c = resolveCharacterImageRef(db, cid);
        return c?.name === favorName;
      });
      if (Number.isFinite(Number(favorId))) duoZoneFavorId = Number(favorId);
    }
    if (duoZoneFavorId == null && characterIds.length) {
      const idx = plateSpec.zone_key === 'right' ? 1 : 0;
      if (Number.isFinite(Number(characterIds[idx]))) duoZoneFavorId = Number(characterIds[idx]);
      else duoZoneFavorId = Number(characterIds[0]);
    }
    if (duoZoneFavorId != null) {
      const c = resolveCharacterImageRef(db, duoZoneFavorId);
      if (c?.ref) duoZoneFavorRef = c.ref;
    }

    const wideRow = findCompletedWideRow(
      db,
      plateRow.episode_id || ctx.episode_id,
      group.scene_key || plateRow.scene_key
    );
    let wideCrops = { backdrop: null, desk: null };
    if (wideRefOk(wideRow)) {
      try {
        wideCrops = await extractWidePovSupportCrops(
          db,
          wideRow,
          favorSide,
          ctx.drama_id || plateRow.drama_id,
          log
        );
      } catch (e) {
        log?.warn?.('[coverage] wide pov crops failed', { error: e.message });
      }
    }
    duoZoneDeskCrop = wideCrops.desk || null;
    duoZoneSideBackdrop = wideCrops.backdrop || null;
    if (!duoZoneSideBackdrop && duoZoneSceneRef) {
      try {
        duoZoneSideBackdrop = await cropSceneSideBackdropRef(
          db,
          duoZoneSceneRef,
          favorSide,
          ctx.drama_id || plateRow.drama_id,
          log
        );
      } catch (e) {
        log?.warn?.('[coverage] scene side crop failed', { error: e.message });
      }
    }
    duoZoneBackdropRef = duoZoneSideBackdrop || duoZoneSceneRef;

    refs = [];
    if (duoZoneBackdropRef) refs.push(duoZoneBackdropRef);
    if (duoZoneDeskCrop) refs.push(duoZoneDeskCrop);
    if (duoZoneFavorRef) refs.push(duoZoneFavorRef);
    frameType = 'coverage_pov';
    let idx = 1;
    const sideZh = favorSide === 'right' ? '右' : '左';
    if (duoZoneBackdropRef) {
      refNoteParts.push(
        wideCrops.backdrop
          ? `Image ${idx}: ${sideZh}-SIDE BACKDROP STRIP cropped from seating-chart wide (windows/wall BEHIND ${favorName}). DELETE any face. Do NOT use center red banner.`
          : `Image ${idx}: ${sideZh}-side window backdrop. DELETE people. Not center red banner.`
      );
      idx += 1;
    }
    if (duoZoneDeskCrop) {
      refNoteParts.push(
        `Image ${idx}: DESK SURFACE BAND only (center of table from seating chart) — copy desk material/color/props. Do NOT recreate two people facing each other.`
      );
      idx += 1;
    }
    if (duoZoneFavorRef) {
      refNoteParts.push(
        `Image ${idx}: identity ONLY for "${favorName}". Exactly ONE instance — never clone.`
      );
    }
  } else if (isOtsLike) {
    refs = collectReferenceImages(db, sceneId, characterIds, { skipScene: true });
    let idx = 1;
    for (const cid of characterIds) {
      const c = resolveCharacterImageRef(db, cid);
      if (c?.ref && refs.some((r) => String(r) === String(c.ref))) {
        refNoteParts.push(`Image ${idx}: character identity only for "${c.name}"`);
        idx += 1;
      }
    }
  } else {
    const skipScene = !!plateSpec.skip_scene_ref;
    refs = collectReferenceImages(db, sceneId, characterIds, { skipScene });
    let idx = 1;
    const sceneRef = resolveSceneImageRef(db, sceneId);
    if (!skipScene && sceneRef?.ref && refs.some((r) => String(r) === String(sceneRef.ref))) {
      refNoteParts.push(
        `Image ${idx}: SCENE ROOM ONLY — match office of "${sceneRef.location || group.location || 'scene'}". DELETE every person from this plate.`
      );
      idx += 1;
    }
    for (const cid of characterIds) {
      const c = resolveCharacterImageRef(db, cid);
      if (c?.ref && refs.some((r) => String(r) === String(c.ref))) {
        refNoteParts.push(
          `Image ${idx}: character identity only for "${c.name}" (face/hair/clothes)`
        );
        idx += 1;
      }
    }
  }

  let promptWithRef = refNoteParts.length ? `${refNoteParts.join('\n')}\n\n${prompt}` : prompt;
  if (isDuoWide) {
    const place = group.location || plateRow?.location || '办公室';
    const names = (memberNames || []).slice(0, 2).join(' and ') || 'the two leads';
    promptWithRef +=
      `\n\nHARD COUNT: exactly TWO seated people only (${names}) — one instance each, never clone either person twice. ` +
      (duoWideSceneRef
        ? `Image 1 is EMPTY ROOM BACKGROUND only: match that office layout, DELETE every person from the scene plate, then place only ${names}. `
        : `Empty ${place} background from text description. `) +
      `No bystander, no third colleague, no standing person behind desk, no duplicate face.`;
  }
  if (isDuoZone && favorName) {
    const appearance = getCharacterAppearanceText(db, duoZoneFavorId);
    const genPrompt = buildDuoReverseShotGenPrompt({
      favorName,
      partnerName: otherName,
      location: group.location || plateRow?.location,
      style: ctx.style,
      appearance,
      mode: 'pov',
      hasSceneRef: !!duoZoneSceneRef,
      hasWideRef: false,
      hasSideBackdrop: !!duoZoneSideBackdrop,
      hasDeskCrop: !!duoZoneDeskCrop,
      favorSide,
    });
    promptWithRef = refNoteParts.length ? `${refNoteParts.join('\n')}\n\n${genPrompt}` : genPrompt;
  }

  const negativePrompt = isDuoZone
    ? COVERAGE_REVERSE_NEGATIVE
    : isDuoWide || isDuoCast
      ? COVERAGE_DUO_NEGATIVE
      : 'crowd, extra bystander, split screen, collage, watermark, text overlay';

  try {
    db.prepare(
      `UPDATE coverage_plates SET status = 'generating', updated_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), plateId);

    const maxAttempts = isDuoZone ? 2 : isDuoWide ? 2 : 1;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let attemptRefs = refs;
        let attemptPrompt = promptWithRef;
        let attemptFrame = frameType;
        let attemptNeg = negativePrompt;

        if (isDuoZone && favorName) {
          const appearance = getCharacterAppearanceText(db, duoZoneFavorId);
          attemptNeg =
            COVERAGE_REVERSE_NEGATIVE +
            ', second person, two people, duo two-shot, wide shot, seating chart, profile, side view, ' +
            'duplicate, clone, twin, two copies of same face, two identical people facing each other';
          attemptFrame = 'coverage_pov';

          if (attempt === 1 && (duoZoneBackdropRef || duoZoneDeskCrop || duoZoneFavorRef)) {
            // 背景裁条 + 桌面中部条 + 身份（正脸单人）
            const povBody = buildDuoReverseShotGenPrompt({
              favorName,
              partnerName: otherName,
              location: group.location || plateRow?.location,
              style: ctx.style,
              appearance,
              mode: 'pov',
              hasSceneRef: !!duoZoneSceneRef,
              hasWideRef: false,
              hasSideBackdrop: !!duoZoneSideBackdrop,
              hasDeskCrop: !!duoZoneDeskCrop,
              favorSide,
            });
            attemptRefs = [];
            const notes = [];
            const sideZh = favorSide === 'right' ? '右' : '左';
            if (duoZoneBackdropRef) {
              attemptRefs.push(duoZoneBackdropRef);
              notes.push(
                `Image ${notes.length + 1}: ${sideZh}-side BACKDROP strip behind "${favorName}". Windows/wall only. DELETE faces. Not center red banner.`
              );
            }
            if (duoZoneDeskCrop) {
              attemptRefs.push(duoZoneDeskCrop);
              notes.push(
                `Image ${notes.length + 1}: DESK SURFACE only — match material/color/props. Empty opposite seat. Do NOT place a second "${favorName}" across the desk.`
              );
            }
            if (duoZoneFavorRef) {
              attemptRefs.push(duoZoneFavorRef);
              notes.push(
                `Image ${notes.length + 1}: identity ONLY for "${favorName}" — ONE frontal face looking at camera. Never clone to both seats.`
              );
            }
            attemptPrompt = `${notes.join('\n')}\n\n${povBody}`;
          } else if (duoZoneFavorRef) {
            const povBody = buildDuoReverseShotGenPrompt({
              favorName,
              partnerName: otherName,
              location: group.location || plateRow?.location,
              style: ctx.style,
              appearance,
              mode: 'solo',
              hasSceneRef: false,
              hasWideRef: false,
              hasSideBackdrop: false,
              hasDeskCrop: !!duoZoneDeskCrop,
              favorSide,
            });
            attemptRefs = [duoZoneFavorRef];
            if (duoZoneDeskCrop) attemptRefs.push(duoZoneDeskCrop);
            attemptFrame = 'coverage_plate';
            attemptPrompt =
              `Image 1: identity ONLY for "${favorName}" — frontal face to camera, ONE person only.\n` +
              (duoZoneDeskCrop
                ? `Image 2: DESK SURFACE — keep this desk; leave opposite seat empty.\n\n`
                : `\n`) +
              povBody;
          } else if (duoZoneBackdropRef) {
            const povBody = buildDuoReverseShotGenPrompt({
              favorName,
              partnerName: otherName,
              location: group.location || plateRow?.location,
              style: ctx.style,
              appearance,
              mode: 'pov',
              hasSceneRef: true,
              hasWideRef: false,
              hasSideBackdrop: !!duoZoneSideBackdrop,
              hasDeskCrop: !!duoZoneDeskCrop,
              favorSide,
            });
            attemptRefs = [duoZoneBackdropRef];
            if (duoZoneDeskCrop) attemptRefs.push(duoZoneDeskCrop);
            attemptPrompt =
              `Frontal MCU of exactly ONE "${favorName}" facing camera. Empty opposite seat.\n\n${povBody}`;
          }
        }

        const created = imageService.create(db, log, {
          drama_id: ctx.drama_id,
          episode_id: ctx.episode_id,
          storyboard_id: null,
          scene_id: null,
          prompt: attemptPrompt,
          negative_prompt: attemptNeg,
          style: ctx.style || undefined,
          frame_type: attemptFrame,
          aspect_ratio: ctx.aspect_ratio || '16:9',
          reference_images: attemptRefs.length ? attemptRefs : undefined,
        });
        const igId = created.id;
        db.prepare(
          `UPDATE coverage_plates SET image_gen_id = ?, status = 'generating', updated_at = ? WHERE id = ?`
        ).run(igId, new Date().toISOString(), plateId);

        const done = await waitImageGeneration(db, igId, log);
        db.prepare(
          `UPDATE coverage_plates SET status = 'completed', image_url = ?, local_path = ?, error_msg = NULL, updated_at = ?
           WHERE id = ?`
        ).run(done.image_url || null, done.local_path || null, new Date().toISOString(), plateId);
        return rowToPlate(db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(plateId));
      } catch (err) {
        lastErr = err;
        log.warn('[coverage] plate attempt failed', {
          plate_id: plateId,
          attempt,
          maxAttempts,
          duo_zone: !!isDuoZone,
          error: err.message,
        });
        if (attempt >= maxAttempts) break;
      }
    }
    throw lastErr || new Error('生图失败');
  } catch (err) {
    db.prepare(
      `UPDATE coverage_plates SET status = 'failed', error_msg = ?, updated_at = ? WHERE id = ?`
    ).run(String(err.message || err).slice(0, 500), new Date().toISOString(), plateId);
    log.warn('[coverage] plate failed', { plate_id: plateId, error: err.message });
    return rowToPlate(db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(plateId));
  }
}

/**
 * 仅物化提示词草稿（不生图）。replace=true 时软删本集旧母版后重建。
 */
function materializeCoveragePlateDrafts(db, episodeId, opts = {}) {
  const replace = opts.replace !== false;
  const plan = planCoveragePlatesForEpisode(db, episodeId);
  if (!plan.plate_count) {
    const err = new Error('当前集无法规划母版：请先生成分镜并对白');
    err.code = 'bad_request';
    throw err;
  }
  if (replace) softDeleteEpisodePlates(db, episodeId);

  const now = new Date().toISOString();
  const created = [];
  for (const group of plan.groups) {
    for (const plateSpec of group.plates) {
      const info = db
        .prepare(
          `INSERT INTO coverage_plates
            (drama_id, episode_id, scene_key, scene_id, location, plate_type, speaker_name, zone_key,
             members_json, lineage_key, layout_description, prompt, character_ids, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
        )
        .run(
          plan.drama_id,
          plan.episode_id,
          group.scene_key,
          group.scene_id,
          group.location,
          plateSpec.plate_type,
          plateSpec.speaker_name,
          plateSpec.zone_key != null ? String(plateSpec.zone_key) : null,
          JSON.stringify(plateSpec.members || plateSpec.speakers || []),
          lineageKeyOf(plateSpec, group.scene_key),
          plateSpec.layout_description,
          plateSpec.prompt,
          JSON.stringify(plateSpec.character_ids || []),
          now,
          now
        );
      created.push(
        rowToPlate(db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(info.lastInsertRowid))
      );
    }
  }
  return {
    episode_id: plan.episode_id,
    drama_id: plan.drama_id,
    group_count: plan.group_count,
    plate_count: created.length,
    items: created,
    plan_summary: {
      group_count: plan.group_count,
      plate_count: plan.plate_count,
      groups: plan.groups.map((g) => ({
        scene_key: g.scene_key,
        location: g.location,
        speakers: g.speakers,
        cast: g.cast,
        coverage_mode: g.coverage_mode,
        seating_chart: g.seating_chart,
        storyboard_count: g.storyboard_count,
      })),
    },
  };
}

function getCoveragePlate(db, plateId) {
  const row = db
    .prepare('SELECT * FROM coverage_plates WHERE id = ? AND deleted_at IS NULL')
    .get(Number(plateId));
  return rowToPlate(row);
}

function updateCoveragePlate(db, plateId, patch = {}) {
  const row = db
    .prepare('SELECT * FROM coverage_plates WHERE id = ? AND deleted_at IS NULL')
    .get(Number(plateId));
  if (!row) {
    const err = new Error('母版不存在');
    err.code = 'not_found';
    throw err;
  }
  const prompt = patch.prompt != null ? String(patch.prompt) : row.prompt;
  const layout =
    patch.layout_description != null ? String(patch.layout_description) : row.layout_description;
  const now = new Date().toISOString();
  // 改提示词后若尚未生图保持 draft；已有图则标为 draft 提示需重生（保留旧图直到重生）
  let status = row.status;
  if (patch.prompt != null && String(patch.prompt) !== String(row.prompt || '')) {
    if (row.status === 'completed' || row.status === 'failed' || row.status === 'generating') {
      status = 'draft';
    } else if (!row.status || row.status === 'pending') {
      status = 'draft';
    }
  }
  db.prepare(
    `UPDATE coverage_plates SET prompt = ?, layout_description = ?, status = ?, error_msg = NULL, updated_at = ?
     WHERE id = ?`
  ).run(prompt, layout, status, now, Number(plateId));
  return getCoveragePlate(db, plateId);
}

/** 上传/替换模板图：旧图进历史，新图设为当前完成图 */
function applyUploadedImageToCoveragePlate(db, plateId, opts = {}) {
  const row = db
    .prepare('SELECT * FROM coverage_plates WHERE id = ? AND deleted_at IS NULL')
    .get(Number(plateId));
  if (!row) {
    const err = new Error('母版不存在');
    err.code = 'not_found';
    throw err;
  }
  const localPath = opts.local_path != null ? String(opts.local_path).trim() : '';
  const imageUrl = opts.image_url != null ? String(opts.image_url).trim() : '';
  if (!localPath && !imageUrl) {
    const err = new Error('请提供图片 local_path 或 image_url');
    err.code = 'bad_request';
    throw err;
  }
  if (row.local_path || row.image_url) archivePlateVersion(db, row);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE coverage_plates SET local_path = ?, image_url = ?, status = 'completed', error_msg = NULL,
       updated_at = ? WHERE id = ? AND deleted_at IS NULL`
  ).run(localPath || null, imageUrl || localPath || null, now, Number(plateId));
  return getCoveragePlate(db, plateId);
}

/** 删除某一历史版本记录（不删磁盘文件） */
function deletePlateVersion(db, plateId, versionId) {
  const plate = db
    .prepare('SELECT * FROM coverage_plates WHERE id = ?')
    .get(Number(plateId));
  if (!plate) {
    const err = new Error('母版不存在');
    err.code = 'not_found';
    throw err;
  }
  const ver = db
    .prepare('SELECT * FROM coverage_plate_versions WHERE id = ?')
    .get(Number(versionId));
  if (!ver) {
    const err = new Error('历史版本不存在');
    err.code = 'not_found';
    throw err;
  }
  const lineage = plate.lineage_key || lineageKeyOf(plate, plate.scene_key);
  const owned =
    Number(ver.plate_id) === Number(plateId) ||
    (Number(ver.episode_id) === Number(plate.episode_id) &&
      String(ver.lineage_key || '') === String(lineage || '') &&
      lineage);
  if (!owned) {
    const err = new Error('该历史不属于此模板');
    err.code = 'bad_request';
    throw err;
  }
  db.prepare('DELETE FROM coverage_plate_versions WHERE id = ?').run(Number(versionId));
  return { ok: true, id: Number(versionId), plate_id: Number(plateId) };
}

function softDeleteCoveragePlate(db, plateId) {
  const row = db
    .prepare('SELECT * FROM coverage_plates WHERE id = ? AND deleted_at IS NULL')
    .get(Number(plateId));
  if (!row) {
    const err = new Error('母版不存在');
    err.code = 'not_found';
    throw err;
  }
  if (row.local_path || row.image_url) archivePlateVersion(db, row);
  const now = new Date().toISOString();
  db.prepare(`UPDATE coverage_plates SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(
    now,
    now,
    Number(plateId)
  );
  // 解除分镜绑定
  db.prepare(
    `UPDATE storyboards SET coverage_plate_id = NULL, updated_at = ?
     WHERE coverage_plate_id = ? AND deleted_at IS NULL`
  ).run(now, Number(plateId));
  return { ok: true, id: Number(plateId) };
}

function resolvePlateGenContext(db, plate) {
  const ep = db
    .prepare('SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL')
    .get(Number(plate.episode_id));
  if (!ep) {
    const err = new Error('集不存在');
    err.code = 'not_found';
    throw err;
  }
  const drama = db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(ep.drama_id);
  let meta = {};
  try {
    meta = drama?.metadata ? JSON.parse(drama.metadata) : {};
  } catch (_) {}
  return {
    drama_id: ep.drama_id,
    episode_id: ep.id,
    style: String(drama?.style || meta.story_style || '').trim(),
    aspect_ratio: meta.aspect_ratio || '16:9',
  };
}

/** 旧版裁切/过肩/对着母版转正脸 → 升级为正反打 POV（0°正面、仅说话人；房间用场景图） */
function refreshStaleDuoZonePrompt(db, plate) {
  if (!plate || plate.plate_type !== 'zone') return plate;
  const members = Array.isArray(plate.members) ? plate.members : [];
  if (members.length !== 2) return plate;
  const old = String(plate.prompt || '');
  const isPov =
    /眼睛视角|0度正面|平视|隔桌正脸/.test(old) &&
    /COMPOSITION RECIPE|前景大|下部约.?1.?\/.?3|FRONTAL EYE-LEVEL|正脸看镜头/.test(old) &&
    /SINGLE SUBJECT|禁止克隆/.test(old) &&
    !/过肩近景|blurred shoulder|occiput|可只露虚化肩|MASTER WIDE|深色木会议桌桌面横过/.test(old);
  if (isPov) return plate;
  const needsRefresh =
    !old.trim() ||
    /深色木会议桌|场景左侧裁切|侧脸对坐|FRONTAL MCU（CRITICAL）|MASTER WIDE|桌面道具必须与全景母版|不喂整张双人构图|胸部以上中近景，正脸清晰/.test(
      old
    ) ||
    /裁切|偏侧|front-facing MCU|过肩|OTS|shoulder|reframing|对方视角|不喂场景图/.test(old) ||
    !/COMPOSITION RECIPE|隔桌正脸|下部约.?1.?\/.?3|FRONTAL EYE-LEVEL/.test(old) ||
    !/眼睛视角|0度正面|平视|隔桌正脸/.test(old);
  if (!needsRefresh) return plate;
  const chart = buildSeatingChart(members);
  const zone = plate.zone_key === 'right' ? 'right' : 'left';
  const layout = buildZoneLayout(zone, [plate.speaker_name || members[0]], chart, plate.location);
  let style = '';
  try {
    style = resolvePlateGenContext(db, plate).style || '';
  } catch (_) {}
  const prompt = buildPlatePrompt({
    plateType: 'zone',
    layout,
    speakers: members,
    location: plate.location,
    style,
    zoneKey: zone,
  });
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE coverage_plates SET prompt = ?, layout_description = ?, updated_at = ? WHERE id = ?`
  ).run(prompt, layout, now, Number(plate.id));
  return getCoveragePlate(db, plate.id) || { ...plate, prompt, layout_description: layout };
}

async function regenerateCoveragePlateImage(db, log, plateId) {
  let plate = getCoveragePlate(db, plateId);
  if (!plate) {
    const err = new Error('母版不存在');
    err.code = 'not_found';
    throw err;
  }
  const allScene0 = listCoveragePlates(db, plate.episode_id).filter(
    (p) => p.scene_key === plate.scene_key
  );
  if (detectDuoCoverageBundle(allScene0) && plate.plate_type === 'zone') {
    plate = refreshStaleDuoZonePrompt(db, plate);
  }
  if (!String(plate.prompt || '').trim()) {
    const err = new Error('请先填写生图提示词');
    err.code = 'bad_request';
    throw err;
  }
  const ctx = resolvePlateGenContext(db, plate);

  // 双人左右板：以全景 reframing 出正脸 MCU（不再偏侧裁切）
  const allScene = listCoveragePlates(db, plate.episode_id).filter(
    (p) => p.scene_key === plate.scene_key
  );
  const bundle = detectDuoCoverageBundle(allScene);
  if (
    bundle &&
    plate.plate_type === 'zone' &&
    (Number(plate.id) === Number(bundle.left.id) || Number(plate.id) === Number(bundle.right.id))
  ) {
    const wideRow = findCompletedWideRow(db, plate.episode_id, plate.scene_key);
    if (!wideRefOk(wideRow)) {
      const err = new Error('需先完成同场景全景座位表，再生成正脸近景');
      err.code = 'bad_request';
      throw err;
    }
  }

  const group = {
    scene_key: plate.scene_key,
    scene_id: plate.scene_id,
    location: plate.location,
    storyboard_ids: [],
  };
  const plateSpec = {
    plate_type: plate.plate_type,
    speaker_name: plate.speaker_name,
    zone_key: plate.zone_key,
    members: plate.members,
    prompt: plate.prompt,
    layout_description: plate.layout_description,
    character_ids: plate.character_ids || [],
  };
  const out = await generateOnePlate(db, log, ctx, group, plateSpec, plate.id);
  // 全景重生后，自动刷新双人正脸近景（AI reframing）
  if (out && out.status === 'completed' && plate.plate_type === 'wide' && bundle) {
    try {
      await deriveDuoZonesAfterWide(db, log, plate.episode_id, plate.scene_key);
    } catch (e) {
      log.warn('[coverage] auto frontal MCU after wide regen failed', { error: e.message });
    }
  }
  return out;
}

function wideRefOk(wideRow) {
  return !!(wideRow && (wideRow.local_path || wideRow.image_url));
}

function startCoveragePlateImageGeneration(db, log, episodeId, opts = {}) {
  const epId = Number(episodeId);
  let plates = listCoveragePlates(db, epId);
  if (opts.plate_ids && Array.isArray(opts.plate_ids) && opts.plate_ids.length) {
    const want = new Set(opts.plate_ids.map(Number));
    plates = plates.filter((p) => want.has(Number(p.id)));
  } else if (opts.only_missing !== false) {
    // 默认只生 draft/failed/pending（无完成图）
    plates = plates.filter((p) => p.status !== 'completed' || !(p.local_path || p.image_url));
  }
  plates = plates.filter((p) => String(p.prompt || '').trim());
  if (!plates.length) {
    const err = new Error('没有可生成的模板：请先生成提示词，或勾选需重生的模板');
    err.code = 'bad_request';
    throw err;
  }
  const assignAfter = opts.assign === true || opts.assign === 1;
  const strategy = opts.strategy === 'prefer_two_shot' ? 'prefer_two_shot' : 'by_speaker';
  const concurrency = resolveCoverageImageConcurrency(db, opts);
  const task = taskService.createTask(db, log, 'coverage_plate_generation', String(epId));
  setImmediate(() => {
    processCoveragePlateImageGeneration(db, log, task.id, epId, {
      plate_ids: plates.map((p) => p.id),
      assign: assignAfter,
      strategy,
      concurrency,
    });
  });
  return { task_id: task.id, status: 'pending', plate_count: plates.length, concurrency };
}

async function processCoveragePlateImageGeneration(db, log, taskId, episodeId, opts = {}) {
  const assignAfter = opts.assign === true;
  const strategy = opts.strategy === 'prefer_two_shot' ? 'prefer_two_shot' : 'by_speaker';
  const concurrency = resolveCoverageImageConcurrency(db, opts);
  try {
    let plates = listCoveragePlates(db, episodeId);
    if (opts.plate_ids?.length) {
      const want = new Set(opts.plate_ids.map(Number));
      plates = plates.filter((p) => want.has(Number(p.id)));
    }
    if (!plates.length) throw new Error('没有可生成的模板');

    const ctx = resolvePlateGenContext(db, plates[0]);
    const createdById = new Map();
    const total = plates.length;
    let doneCount = 0;

    // 双人左右板：先全景，再以全景 reframing 正脸 MCU（不与全景并行，避免无母版）
    const duoZoneIds = new Set();
    const allPlates = listCoveragePlates(db, episodeId);
    const bySceneAll = new Map();
    for (const p of allPlates) {
      const k = p.scene_key || 'ungrouped';
      if (!bySceneAll.has(k)) bySceneAll.set(k, []);
      bySceneAll.get(k).push(p);
    }
    for (const [, scenePlates] of bySceneAll) {
      const bundle = detectDuoCoverageBundle(scenePlates);
      if (bundle) {
        duoZoneIds.add(Number(bundle.left.id));
        duoZoneIds.add(Number(bundle.right.id));
      }
    }

    const widePlates = plates.filter((p) => p.plate_type === 'wide' || p.plate_type === 'two_shot');
    const aiRestPlates = plates.filter(
      (p) =>
        p.plate_type !== 'wide' &&
        p.plate_type !== 'two_shot' &&
        !duoZoneIds.has(Number(p.id))
    );
    const duoZonesInBatch = plates.filter((p) => duoZoneIds.has(Number(p.id)));

    taskService.updateTaskStatus(
      db,
      taskId,
      'processing',
      5,
      `先全景 AI，再 reframing 正脸近景（并发 ${concurrency}，共 ${total} 张）…`
    );

    async function runPlateBatch(batch, phaseLabel, markGenerating) {
      if (!batch.length) return;
      if (markGenerating) {
        const nowMark = new Date().toISOString();
        for (const plate of batch) {
          db.prepare(
            `UPDATE coverage_plates SET status = 'generating', updated_at = ? WHERE id = ? AND deleted_at IS NULL`
          ).run(nowMark, plate.id);
        }
      }
      await mapPool(batch, concurrency, async (plate) => {
        const group = {
          scene_key: plate.scene_key,
          scene_id: plate.scene_id,
          location: plate.location,
          storyboard_ids: [],
        };
        const plateSpec = {
          plate_type: plate.plate_type,
          speaker_name: plate.speaker_name,
          zone_key: plate.zone_key,
          members: plate.members,
          prompt: plate.prompt,
          layout_description: plate.layout_description,
          character_ids: plate.character_ids || [],
        };
        const out = await generateOnePlate(db, log, ctx, group, plateSpec, plate.id);
        createdById.set(plate.id, out);
        doneCount += 1;
        taskService.updateTaskStatus(
          db,
          taskId,
          'processing',
          Math.min(80, Math.round(5 + (doneCount / Math.max(1, total)) * 75)),
          `${phaseLabel} ${doneCount}/${total}（并发 ${concurrency}）`
        );
        return out;
      });
    }

    // 阶段1：AI 全景
    if (widePlates.length) {
      taskService.updateTaskStatus(
        db,
        taskId,
        'processing',
        8,
        `阶段1：生成全景座位表（${widePlates.length}）…`
      );
      await runPlateBatch(widePlates, '全景座位表', true);
    }

    // 阶段2：双人左右板从全景 reframing 正脸 MCU
    const sceneKeysNeedMcu = new Set();
    for (const p of duoZonesInBatch) sceneKeysNeedMcu.add(p.scene_key);
    // 若本批含全景且该场景是双人，也刷新左右（即使左右未列入 plate_ids）
    for (const p of widePlates) {
      const bundle = detectDuoCoverageBundle(
        allPlates.filter((x) => x.scene_key === p.scene_key)
      );
      if (bundle) sceneKeysNeedMcu.add(p.scene_key);
    }

    for (const sk of sceneKeysNeedMcu) {
      const wideRow = findCompletedWideRow(db, episodeId, sk);
      if (!wideRow) {
        const bundle = detectDuoCoverageBundle(allPlates.filter((x) => x.scene_key === sk));
        if (bundle) {
          const nowFail = new Date().toISOString();
          for (const zp of [bundle.left, bundle.right]) {
            if (!plates.some((p) => Number(p.id) === Number(zp.id)) && !duoZonesInBatch.length) continue;
            db.prepare(
              `UPDATE coverage_plates SET status = 'failed', error_msg = ?, updated_at = ? WHERE id = ?`
            ).run('需先完成全景座位表，再生成正脸近景', nowFail, zp.id);
            createdById.set(
              zp.id,
              rowToPlate(db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(zp.id))
            );
            doneCount += 1;
          }
        }
        continue;
      }
      try {
        taskService.updateTaskStatus(
          db,
          taskId,
          'processing',
          Math.min(90, Math.round(5 + (doneCount / Math.max(1, total)) * 80)),
          `阶段2：全景 reframing 正脸近景（${sk}）…`
        );
        const outs = await deriveDuoZonesAfterWide(db, log, episodeId, sk);
        for (const out of outs) {
          if (out?.id) createdById.set(out.id, out);
          doneCount += 1;
        }
      } catch (err) {
        log.warn('[coverage] duo frontal MCU failed', { scene_key: sk, error: err.message });
        const bundle = detectDuoCoverageBundle(allPlates.filter((x) => x.scene_key === sk));
        const nowFail = new Date().toISOString();
        for (const zp of bundle ? [bundle.left, bundle.right] : []) {
          db.prepare(
            `UPDATE coverage_plates SET status = 'failed', error_msg = ?, updated_at = ? WHERE id = ?`
          ).run(String(err.message || err).slice(0, 500), nowFail, zp.id);
          createdById.set(
            zp.id,
            rowToPlate(db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(zp.id))
          );
          doneCount += 1;
        }
      }
    }

    // 阶段3：多人等非双人分区/说话人仍走 AI（先全景后生成）
    const otsReady = [];
    const otsBlocked = [];
    for (const plate of aiRestPlates) {
      const wideRef = findCompletedWideRef(db, episodeId, plate.scene_key);
      if (wideRef || plate.plate_type === 'speaker') {
        // speaker 可无 wide；zone 需要
        if (plate.plate_type === 'zone' && !wideRef) otsBlocked.push(plate);
        else otsReady.push(plate);
      } else otsBlocked.push(plate);
    }
    if (otsBlocked.length) {
      const nowFail = new Date().toISOString();
      for (const plate of otsBlocked) {
        db.prepare(
          `UPDATE coverage_plates SET status = 'failed', error_msg = ?, updated_at = ? WHERE id = ?`
        ).run('需先完成同场景全景座位表', nowFail, plate.id);
        createdById.set(
          plate.id,
          rowToPlate(db.prepare('SELECT * FROM coverage_plates WHERE id = ?').get(plate.id))
        );
        doneCount += 1;
      }
    }
    if (otsReady.length) {
      for (const plate of otsReady) {
        const wideRef = findCompletedWideRef(db, episodeId, plate.scene_key);
        // attach reframe for multi OTS-like if needed — generateOnePlate handles
        void wideRef;
      }
      await runPlateBatch(otsReady, '分区/近景', true);
    }

    let assignResult = null;
    if (assignAfter) {
      taskService.updateTaskStatus(db, taskId, 'processing', 92, '分配母版到分镜…');
      assignResult = assignCoveragePlatesToStoryboards(db, log, episodeId, {
        force_static: true,
        strategy,
      });
    }

    const ok = [...createdById.values()].filter((p) => p && p.status === 'completed').length;
    const failed = [...createdById.values()].filter((p) => p && p.status === 'failed').length;
    const result = {
      episode_id: Number(episodeId),
      concurrency,
      plates: [...createdById.values()].filter(Boolean),
      plate_ok: ok,
      plate_failed: failed,
      assign: assignResult,
      mode: 'wide_then_duo_crop',
    };
    if (failed && !ok) {
      taskService.updateTaskError(db, taskId, `全部模板生成失败（${failed}）`);
      taskService.updateTaskStatus(db, taskId, 'failed', 100, `固定机位模板全部失败（${failed}）`);
      try {
        db.prepare(`UPDATE async_tasks SET result = ?, updated_at = ? WHERE id = ?`).run(
          JSON.stringify(result),
          new Date().toISOString(),
          taskId
        );
      } catch (_) {}
      return;
    }
    taskService.updateTaskResult(db, taskId, result);
    taskService.updateTaskStatus(
      db,
      taskId,
      'completed',
      100,
      `固定机位模板完成：成功 ${ok}${failed ? `，失败 ${failed}` : ''}（全景AI + 双人偏侧裁切，并发 ${concurrency}）${
        assignResult ? `，已分配 ${assignResult.assigned}/${assignResult.total}` : ''
      }`
    );
  } catch (err) {
    log.error('[coverage] generate images failed', { episode_id: episodeId, error: err.message });
    taskService.updateTaskError(db, taskId, err.message || '固定机位模板生成失败');
  }
}

/**
 * @param {'prefer_two_shot'|'by_speaker'} [strategy]
 */
function choosePlateForStoryboard(sb, platesForScene, speakersOrdered, strategy = 'by_speaker') {
  if (isLocomotionAction(sb.action)) return null;
  const spoken = extractSpeakersFromStoryboard(sb);
  const completed = (p) => p && p.status === 'completed';
  const wide = platesForScene.find((p) => p.plate_type === 'wide' && completed(p));
  const two = platesForScene.find((p) => p.plate_type === 'two_shot' && completed(p));
  const bySpeaker = (name) =>
    platesForScene.find(
      (p) => p.plate_type === 'speaker' && completed(p) && p.speaker_name === name
    ) ||
    // 双人偏置同框分区：用 speaker_name 标记对准侧
    platesForScene.find(
      (p) => p.plate_type === 'zone' && completed(p) && p.speaker_name === name
    );
  const byZoneKey = (key) =>
    platesForScene.find((p) => p.plate_type === 'zone' && completed(p) && p.zone_key === key);
  const zoneForName = (name) => {
    const sp = platesForScene.find(
      (p) => p.plate_type === 'speaker' && p.speaker_name === name && p.zone_key
    );
    if (sp?.zone_key && sp.zone_key !== 'wide') return byZoneKey(sp.zone_key);
    return platesForScene.find(
      (p) =>
        p.plate_type === 'zone' &&
        completed(p) &&
        Array.isArray(p.members) &&
        p.members.includes(name)
    );
  };
  const establishing = () => wide || two || null;

  const mode = strategy === 'prefer_two_shot' ? 'prefer_two_shot' : 'by_speaker';

  if (mode === 'prefer_two_shot') {
    if (establishing()) return establishing();
    if (spoken.length >= 1) return bySpeaker(spoken[0]) || zoneForName(spoken[0]) || null;
    if (speakersOrdered?.[0]) {
      return bySpeaker(speakersOrdered[0]) || zoneForName(speakersOrdered[0]) || null;
    }
    return platesForScene.find((p) => completed(p)) || null;
  }

  // by_speaker：单人→近景/分区；多人→若同区用分区，否则全景/同框
  if (spoken.length >= 2) {
    const speakerZones = spoken
      .map((n) => {
        const sp = platesForScene.find((p) => p.plate_type === 'speaker' && p.speaker_name === n);
        if (sp?.zone_key) return sp.zone_key;
        const zp = platesForScene.find(
          (p) => p.plate_type === 'zone' && Array.isArray(p.members) && p.members.includes(n)
        );
        return zp?.zone_key || null;
      })
      .filter(Boolean);
    if (speakerZones.length >= 2 && speakerZones.every((z) => z === speakerZones[0])) {
      return byZoneKey(speakerZones[0]) || establishing() || bySpeaker(spoken[0]) || null;
    }
    return establishing() || byZoneKey(speakerZones[0]) || bySpeaker(spoken[0]) || null;
  }
  if (spoken.length === 1) {
    return bySpeaker(spoken[0]) || zoneForName(spoken[0]) || establishing() || null;
  }
  if (establishing()) return establishing();
  if (speakersOrdered?.[0]) {
    return bySpeaker(speakersOrdered[0]) || zoneForName(speakersOrdered[0]) || null;
  }
  return platesForScene.find((p) => completed(p)) || null;
}

function assignCoveragePlatesToStoryboards(db, log, episodeId, opts = {}) {
  const epId = Number(episodeId);
  const plates = listCoveragePlates(db, epId).filter((p) => p.status === 'completed');
  if (!plates.length) {
    return {
      assigned: 0,
      skipped: 0,
      skipped_locomotion: 0,
      missing_plate: 0,
      total: 0,
      strategy: opts.strategy || 'by_speaker',
    };
  }

  const byScene = new Map();
  for (const p of plates) {
    if (!byScene.has(p.scene_key)) byScene.set(p.scene_key, []);
    byScene.get(p.scene_key).push(p);
  }

  const forcePlateId = opts.force_plate_id != null ? Number(opts.force_plate_id) : null;
  const forcedPlate =
    Number.isFinite(forcePlateId) && forcePlateId > 0
      ? plates.find((p) => Number(p.id) === forcePlateId) || null
      : null;

  const storyboards = db
    .prepare(
      `SELECT id, storyboard_number, scene_id, location, dialogue, narration, action, movement
       FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC`
    )
    .all(epId);

  const plan = planCoveragePlatesForEpisode(db, epId);
  const speakersByScene = new Map(plan.groups.map((g) => [g.scene_key, g.speakers]));
  const strategy = opts.strategy === 'prefer_two_shot' ? 'prefer_two_shot' : 'by_speaker';

  let assigned = 0;
  let skipped = 0;
  let skippedLocomotion = 0;
  let missingPlate = 0;
  const now = new Date().toISOString();
  const forceStatic = opts.force_static !== false;

  for (const sb of storyboards) {
    const key = sceneKeyOf(sb);
    const scenePlates = byScene.get(key) || [];
    if (isLocomotionAction(sb.action)) {
      skippedLocomotion += 1;
      skipped += 1;
      continue;
    }

    let plate = null;
    if (forcedPlate) {
      if (forcedPlate.scene_key !== key) {
        skipped += 1;
        continue;
      }
      plate = forcedPlate;
    } else {
      plate = choosePlateForStoryboard(sb, scenePlates, speakersByScene.get(key) || [], strategy);
    }

    if (!plate || !(plate.image_gen_id || plate.local_path || plate.image_url)) {
      missingPlate += 1;
      skipped += 1;
      continue;
    }

    bindStoryboardFrameImage(
      db,
      sb.id,
      'storyboard_first',
      plate.image_gen_id,
      plate.image_url,
      plate.local_path
    );

    const patches = ['coverage_plate_id = ?', 'updated_at = ?'];
    const params = [plate.id, now];
    if (plate.layout_description) {
      patches.push('layout_description = ?');
      params.push(plate.layout_description);
    }
    if (forceStatic) {
      patches.push('movement = ?');
      params.push('固定镜头static');
    }
    params.push(sb.id);
    db.prepare(
      `UPDATE storyboards SET ${patches.join(', ')} WHERE id = ? AND deleted_at IS NULL`
    ).run(...params);
    assigned += 1;
  }

  log.info('[coverage] assign done', {
    episode_id: epId,
    strategy: forcedPlate ? `force:${forcedPlate.id}` : strategy,
    assigned,
    skipped,
    skipped_locomotion: skippedLocomotion,
    missing_plate: missingPlate,
  });

  return {
    assigned,
    skipped,
    skipped_locomotion: skippedLocomotion,
    missing_plate: missingPlate,
    total: storyboards.length,
    strategy: forcedPlate ? 'force_plate' : strategy,
    force_plate_id: forcedPlate ? forcedPlate.id : null,
  };
}

async function processCoveragePlateGeneration(db, log, taskId, episodeId, opts = {}) {
  // 兼容旧一键流程：先草稿提示词，再按草稿生图
  const assignAfter = opts.assign !== false;
  const strategy = opts.strategy === 'prefer_two_shot' ? 'prefer_two_shot' : 'by_speaker';
  try {
    taskService.updateTaskStatus(db, taskId, 'processing', 5, '生成固定机位提示词…');
    const drafts = materializeCoveragePlateDrafts(db, episodeId, { replace: true });
    await processCoveragePlateImageGeneration(db, log, taskId, episodeId, {
      plate_ids: drafts.items.map((p) => p.id),
      assign: assignAfter,
      strategy,
      concurrency: opts.concurrency,
    });
  } catch (err) {
    log.error('[coverage] generate failed', { episode_id: episodeId, error: err.message });
    taskService.updateTaskError(db, taskId, err.message || '固定机位母版生成失败');
  }
}

function startCoveragePlateGeneration(db, log, episodeId, opts = {}) {
  const plan = planCoveragePlatesForEpisode(db, episodeId);
  if (!plan.plate_count) {
    const err = new Error('当前集无法规划母版：请先生成分镜并对白');
    err.code = 'bad_request';
    throw err;
  }
  const task = taskService.createTask(db, log, 'coverage_plate_generation', String(episodeId));
  setImmediate(() => {
    processCoveragePlateGeneration(db, log, task.id, episodeId, {
      ...opts,
      strategy: opts.strategy === 'prefer_two_shot' ? 'prefer_two_shot' : 'by_speaker',
    });
  });
  return {
    task_id: task.id,
    status: 'pending',
    plan_summary: {
      group_count: plan.group_count,
      plate_count: plan.plate_count,
      groups: plan.groups.map((g) => ({
        scene_key: g.scene_key,
        location: g.location,
        speakers: g.speakers,
        storyboard_count: g.storyboard_count,
        plates: g.plates.map((p) => ({
          plate_type: p.plate_type,
          speaker_name: p.speaker_name,
          layout_description: p.layout_description,
        })),
      })),
    },
  };
}

module.exports = {
  planCoveragePlatesForEpisode,
  listCoveragePlates,
  materializeCoveragePlateDrafts,
  updateCoveragePlate,
  applyUploadedImageToCoveragePlate,
  deletePlateVersion,
  softDeleteCoveragePlate,
  getCoveragePlate,
  listPlateVersions,
  restorePlateVersion,
  regenerateCoveragePlateImage,
  startCoveragePlateImageGeneration,
  processCoveragePlateImageGeneration,
  assignCoveragePlatesToStoryboards,
  startCoveragePlateGeneration,
  processCoveragePlateGeneration,
  sceneKeyOf,
  extractSpeakersFromStoryboard,
  choosePlateForStoryboard,
  isLocomotionAction,
  buildTwoShotLayout,
  buildSpeakerLayout,
  buildWideLayout,
  buildZoneLayout,
  buildSeatingChart,
  buildPlatePrompt,
  buildFavoredTwoShotLayout,
  buildDuoCoverageGridPrompt,
  detectDuoCoverageBundle,
  buildDuoReverseShotGenPrompt,
  cropSceneSideBackdropRef,
  extractWidePovSupportCrops,
  resolveSceneImageRef,
  MULTI_CAST_THRESHOLD,
};
