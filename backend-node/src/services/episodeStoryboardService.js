// 与 Go StoryboardService.GenerateStoryboard + processStoryboardGeneration 对齐
const taskService = require('./taskService');
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const { syncStoryboardCharacters, syncStoryboardProps } = require('./imageService');
const { syncStoryboardCharacterLinksFromCharactersColumn } = require('./storyboardService');
const safeJson = require('../utils/safeJson');
const { safeParseAIJSON, extractJsonCandidate, repairTruncatedJsonArray, extractFirstArray } = safeJson;
const loadConfig = require('../config').loadConfig;
const {
  purgeAllEpisodeStoryboards,
  hardDeleteStoryboardIds,
  resolveStorageRoot,
} = require('./generatedAssetPurgeService');
const angleService = require('./angleService');
const {
  NARRATION_CHARS_PER_SEC,
  FULL_NARRATION_TARGET_SEC,
  FULL_NARRATION_MIN_SEC,
  FULL_NARRATION_MAX_SEC,
  FULL_NARRATION_DURATION_MIN_SEC,
  FULL_NARRATION_TARGET_CHARS,
  FULL_NARRATION_MIN_CHARS,
  FULL_NARRATION_MAX_CHARS,
  resolveFullNarrationLimits,
} = require('./fullNarrationConstants');
const { runConcurrentPool } = require('../utils/concurrentPool');
const {
  batchPolishStoryboardImagePromptsForEpisode,
  BATCH_IMAGE_PROMPT_CONCURRENCY,
} = require('./storyboardImagePromptBundle');

const DEFAULT_NARRATION_LIMITS = resolveFullNarrationLimits();
const BATCH_VIDEO_PROMPT_CONCURRENCY = 7;
const BATCH_VIDEO_PROMPT_PROGRESS_START = 82;
const BATCH_VIDEO_PROMPT_PROGRESS_END = 89;

function parseDramaMetadata(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return {};
  }
}

function getNarrationLimitsFromDramaRow(drama) {
  const meta = parseDramaMetadata(drama?.metadata);
  return resolveFullNarrationLimits(meta.narration_chars_per_sec);
}

function getNarrationLimitsForEpisode(db, episodeId) {
  const ep = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
  if (!ep?.drama_id) return DEFAULT_NARRATION_LIMITS;
  const drama = db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(ep.drama_id);
  return getNarrationLimitsFromDramaRow(drama);
}

/**
 * 分镜专用 generateText 包装：
 * 1. 默认携带 max_tokens:16384，让模型输出更长，减少截断续写次数。
 * 2. 若 API 立即返回参数错误（HTTP 4xx，且错误体提到 max_tokens/length/token），
 *    自动降级为不传 max_tokens 重试一次。
 * 3. 所有尝试均记录日志。
 */
const DEFAULT_STORYBOARD_MAX_TOKENS = 16384;

/** 统一镜号（AI 可能返回字符串 "1"，须与 Set 去重键一致） */
function normalizeStoryboardShotNumber(rawOrSb) {
  const raw =
    rawOrSb != null && typeof rawOrSb === 'object'
      ? rawOrSb.shot_number ?? rawOrSb.storyboard_number
      : rawOrSb;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 同集相同 storyboard_number 多行时保留 id 最大的一条（通常为最新入库） */
function dedupeStoryboardRowsByNumber(rows) {
  const byNum = new Map();
  const extras = [];
  for (const r of rows || []) {
    const num = normalizeStoryboardShotNumber(r.storyboard_number ?? r);
    if (num > 0) {
      const prev = byNum.get(num);
      if (!prev || Number(r.id) > Number(prev.id)) byNum.set(num, r);
    } else {
      extras.push(r);
    }
  }
  return [...byNum.values(), ...extras].sort(
    (a, b) =>
      normalizeStoryboardShotNumber(a.storyboard_number) - normalizeStoryboardShotNumber(b.storyboard_number) ||
      Number(a.id) - Number(b.id)
  );
}

function isMaxTokensParamError(errMsg) {
  const m = (errMsg || '').toLowerCase();
  return (
    m.includes('max_tokens') ||
    m.includes('max_completion_tokens') ||
    m.includes('maximum_context_length') ||
    m.includes('context_length_exceeded') ||
    m.includes('maximum length') ||
    m.includes('token limit') ||
    (m.includes('http 4') && (m.includes('token') || m.includes('length') || m.includes('parameter')))
  );
}

async function generateTextForStoryboard(db, log, userPrompt, systemPrompt, options = {}) {
  const { model, streamCallback, temperature = 0.7 } = options;

  // 第一次尝试：带 max_tokens:16384
  log.info('Storyboard generateText attempt 1', { model: model || '(default)', max_tokens: DEFAULT_STORYBOARD_MAX_TOKENS });
  try {
    const text = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      scene_key: 'storyboard_extraction',
      model: model || undefined,
      temperature,
      max_tokens: DEFAULT_STORYBOARD_MAX_TOKENS,
      streamCallback,
    });
    return text;
  } catch (e) {
    if (isMaxTokensParamError(e.message)) {
      log.warn('Storyboard generateText: max_tokens rejected by model, retrying without it', {
        model: model || '(default)',
        error: e.message.slice(0, 200),
      });
      // 第二次尝试：不传 max_tokens，让模型用自己默认值
      log.info('Storyboard generateText attempt 2 (no max_tokens)', { model: model || '(default)' });
      const text = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
        scene_key: 'storyboard_extraction',
        model: model || undefined,
        temperature,
        streamCallback,
      });
      log.info('Storyboard generateText attempt 2 succeeded');
      return text;
    }
    // 其他错误直接抛出
    throw e;
  }
}

function rowToScene(r) {
  if (!r) return null;
  return {
    id: r.id,
    drama_id: r.drama_id,
    location: r.location,
    time: r.time,
    prompt: r.prompt,
    storyboard_count: r.storyboard_count ?? 1,
    image_url: r.image_url,
    local_path: r.local_path,
    status: r.status || 'pending',
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** 全文解说：第 1 镜固定为片头/标题镜（无旁白），旁白段落从第 2 镜起绑定 */
const FULL_NARRATION_TITLE_SHOT_DURATION = 6;
/** 句末标点（优先在此处分段） */
const NARRATION_PRIMARY_PUNCT_RE = /(?<=[。！？!?；;])\s*/;
/** 句内次级标点（仅当单句超上限可读字时再拆） */
const NARRATION_SECONDARY_PUNCT_RE = /(?<=[，,、：:])\s*/;
/** 旁白字数统计：汉字/字母/数字，不含标点与空白 */
const NARRATION_SPEECH_CHAR_RE = /[\u4e00-\u9fa5A-Za-z0-9]/g;

function countNarrationSpeechChars(text) {
  const m = String(text || '').match(NARRATION_SPEECH_CHAR_RE);
  return m ? m.length : 0;
}

/** 在原文中按「可读字数」切分，返回 head/tail（head 含至多 maxSpeech 个可读字） */
function sliceNarrationBySpeechChars(text, maxSpeech) {
  const s = String(text || '');
  if (!s || maxSpeech <= 0) return { head: '', tail: s };
  let count = 0;
  let i = 0;
  for (; i < s.length; i++) {
    if (/[\u4e00-\u9fa5A-Za-z0-9]/.test(s[i])) {
      count += 1;
      if (count >= maxSpeech) {
        i += 1;
        break;
      }
    }
  }
  return { head: s.slice(0, i), tail: s.slice(i) };
}

function sortStoryboardsByShotNumber(storyboards) {
  return [...(storyboards || [])].sort(
    (a, b) =>
      normalizeStoryboardShotNumber(a) - normalizeStoryboardShotNumber(b) ||
      Number(a?.id) - Number(b?.id)
  );
}

/** 镜号缺失时按序补 1、2、3…，避免旁白绑定错位 */
function normalizeStoryboardListShotNumbers(storyboards) {
  const sorted = sortStoryboardsByShotNumber(storyboards);
  let next = 1;
  for (const sb of sorted) {
    const n = normalizeStoryboardShotNumber(sb);
    if (n > 0) {
      next = Math.max(next, n + 1);
      continue;
    }
    sb.shot_number = next;
    sb.storyboard_number = next;
    next += 1;
  }
  return sorted;
}

/**
 * 按旁白字数估算单镜视频时长（秒）。
 * 公式：朗读所需秒数 = ceil(字数 ÷ 语速)；超出整秒容量时向上取整补全到下一秒。
 * 默认语速 5 字/秒；时长限制在 [durationMinSec, maxSec]（默认 4～10 秒）。
 * 分段仍尽量合并到 8～10 秒字数；短孤儿段按时长真实字数估，不再硬抬到 8 秒。
 * 例（5 字/秒）：21字→5秒；45字→9秒；46字→10秒；50字→10秒。
 */
function estimateDurationFromSpeechText(text, limitsOrOpts = {}) {
  const opts = limitsOrOpts && limitsOrOpts.NARRATION_CHARS_PER_SEC != null
    ? {
      charsPerSec: limitsOrOpts.NARRATION_CHARS_PER_SEC,
      minSec: limitsOrOpts.FULL_NARRATION_DURATION_MIN_SEC ?? FULL_NARRATION_DURATION_MIN_SEC,
      maxSec: limitsOrOpts.FULL_NARRATION_MAX_SEC,
    }
    : limitsOrOpts;
  const {
    charsPerSec = NARRATION_CHARS_PER_SEC,
    minSec = FULL_NARRATION_DURATION_MIN_SEC,
    maxSec = FULL_NARRATION_MAX_SEC,
  } = opts;
  const len = countNarrationSpeechChars(text);
  if (!len) return minSec;
  // 超出当前秒数可读容量时向上补全（ceil）到下一秒
  const neededSec = Math.ceil(len / charsPerSec);
  return Math.max(minSec, Math.min(maxSec, neededSec));
}

/** 规范为数字秒：前端左侧用 {{ shot.duration }}s，右侧用 Math.round(duration)；避免 "5s" 导致 5ss，或非数字导致 NaN */
function normalizeDuration(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const s = String(v).trim().replace(/s$/i, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

const _SB_PROMPT_LOG_CHUNK = 14000;

/**
 * 调试：完整打印分镜 system / user 提示词（可能很长，按块写入日志）。
 * 启动后端前设置环境变量：DEBUG_STORYBOARD_PROMPTS=1
 */
function logDebugStoryboardPrompts(log, tag, userPrompt, systemPrompt) {
  const on = String(process.env.DEBUG_STORYBOARD_PROMPTS || '').trim();
  if (on !== '1' && on.toLowerCase() !== 'true') return;
  const sp = systemPrompt != null ? String(systemPrompt) : '';
  const up = userPrompt != null ? String(userPrompt) : '';
  log.info(`[StoryboardPrompt:${tag}] system_prompt_bytes=${sp.length} user_prompt_bytes=${up.length}`);
  for (let i = 0; i < sp.length; i += _SB_PROMPT_LOG_CHUNK) {
    log.info(`[StoryboardPrompt:${tag}] system_part_${Math.floor(i / _SB_PROMPT_LOG_CHUNK) + 1}\n${sp.slice(i, i + _SB_PROMPT_LOG_CHUNK)}`);
  }
  for (let i = 0; i < up.length; i += _SB_PROMPT_LOG_CHUNK) {
    log.info(`[StoryboardPrompt:${tag}] user_part_${Math.floor(i / _SB_PROMPT_LOG_CHUNK) + 1}\n${up.slice(i, i + _SB_PROMPT_LOG_CHUNK)}`);
  }
}

/** 将 lighting_style 枚举转为中文布光提示（兜底用） */
function lightingStyleHintZh(code) {
  const m = {
    natural: '自然窗光或环境散射光',
    front: '正面柔光面部受光均匀',
    side: '侧光约45°勾勒轮廓',
    backlit: '逆光轮廓光发丝边缘发亮',
    top: '顶光压暗眼窝',
    under: '底光或脚光非常规氛围',
    soft: '软光低反差过渡柔和',
    dramatic: '戏剧高反差主辅分明',
    golden_hour: '金色时刻暖斜阳',
    blue_hour: '蓝调时刻冷环境光',
    night: '夜景人工点光源',
    neon: '霓虹混合色温',
  };
  return m[String(code || '').trim()] || '主光方向明确侧光或窗光';
}

/** 按时长与已有运镜字段拼灵境式「运镜链」（至少两步，强调摄影机在动） */
function buildCameraMotionChain(movement, shotType, durationSec) {
  const dur = Math.max(1, Number(durationSec) || 5);
  const mv = String(movement || '').trim();
  const st = String(shotType || '').trim();
  const parts = [];
  if (dur >= 12) {
    parts.push('定镜约1秒建立空间');
    if (/跟|追随|尾随/.test(mv)) parts.push('侧后方跟拍主体位移');
    else if (/摇/.test(mv)) parts.push(`${mv || '轻摇'}拓展画幅信息`);
    else parts.push('缓推轨贴近动作核心');
    parts.push('横移从前景遮挡或门框一侧滑出拓宽视野带出纵深与环境细节');
  } else if (dur >= 8) {
    parts.push('定镜');
    parts.push(mv && !/^固定|^定镜/.test(mv) ? mv : '缓推轨由远及近');
    parts.push('微横移或轻摇让背景纵深与环境细节可读');
  } else if (dur >= 5) {
    parts.push('定镜起幅');
    parts.push(mv || '缓推轨或短跟拍强化动线');
  } else {
    parts.push(mv || '短跟拍或微推');
  }
  if ((st.includes('远') || st.includes('全景')) && !parts.some((p) => /推|移|跟|摇/.test(p))) {
    parts.push('缓推轨向事件中心');
  }
  const chain = [...new Set(parts)].filter(Boolean).join('，');
  return chain || '定镜，缓推轨';
}

/** 全能分镜：模型未返回 universal_segment_text 时的灵境式高密度单行（视频时间轴 + 运镜链） */
function buildFallbackUniversalSeedanceLine(sb, d, styleHint) {
  const act = (d.action || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  const res = (d.result || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const emo = (d.emotion || sb.emotion || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const atm = (sb.atmosphere || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const shotBits = [d.shotType, d.angle].filter(Boolean).join('，').trim();
  const loc = [sb.location, sb.time].filter(Boolean).join('，').trim() || '叙事空间';
  const dur = Math.max(1, Number(d.durationSec) || normalizeDuration(sb.duration) || 5);
  const lightZh = lightingStyleHintZh(d.lightingStyle);
  const dof = d.depthOfField === 'extreme_shallow' ? '浅景深前景虚化明显' : d.depthOfField === 'shallow' ? '浅景深背景柔化' : d.depthOfField === 'deep' ? '深焦前后景均清晰' : d.depthOfField === 'medium' ? '景深适中' : '景深随景别可感';
  const shotNum = Math.max(1, Number(d.shotNumber) || 1);
  const link = shotNum <= 1 ? '开篇情绪奠基' : '延续上一镜动势与视线';
  const motionCore =
    act ||
    '在镜内时长里完成一段可感知的动作阶段变化，含走位或身体重心的转移，避免单姿势摆拍';
  const emoParen = emo ? `（${emo}）` : '（专注投入）';
  const fg = atm ? `${atm.slice(0, 42)}与主体相关的虚化层次` : '与动作相关的近景细节或桌面器物';
  const mg = act ? '主体动作与表情核心区' : '主体占据画面叙事中心';
  const bg = loc ? `${loc}的环境延展与氛围层次` : '环境纵深与空间气氛';
  const lightBlock = `[${lightZh}；结合${loc}，建议色温具象化如4500K-5600K区间择一；明暗比约2:1至3:1；${dof}]`;
  const camChain = buildCameraMotionChain(d.movement, d.shotType, dur);
  const narrDyn = `约${dur}秒内——在${loc}，@人物1${act ? `先后：${act}` : '持续推进戏内动作'}，${res ? `阶段收束为：${res}` : '动作与视线随时间有阶段推进'}；镜头以「${camChain}」配合人物动线，读出空间纵深与时间流逝`;
  const lensBlock = `运镜链：${camChain}；景别机位：${shotBits || '中景，平视'}，三分法或对角线择一（结尾动势：[${res || '视线或身体动线指向下一个节拍，动势渐收可衔接下镜'}]）`;
  const sfx = `环境层-[与${loc}一致的环境声底与远处细节] 动作层-[与动作同步的物理接触声] 情绪层-[无旋律仅以空间混响与材质细微声烘托情绪张力]`;
  const styleTail = (styleHint && String(styleHint).trim()) || '电影感叙事光色';
  const dia = (d.dialogue || '').trim().replace(/"/g, "'");
  let line = `主体：@人物1${emoParen}[朝向：依轴线面向戏中对象或画左/画右择一并保持统一] 正在 ${motionCore}（与上镜衔接：${link}） 叙事动态：${narrDyn} 空间：前景-[${fg}] 中景-[${mg}] 背景-[${bg}] 光影：${lightBlock} 镜头：${lensBlock}`;
  if (dia) line += ` 台词：第1秒 @人物1："${dia.slice(0, 120)}"`;
  line += ` 音效：${sfx} ${styleTail} [禁BGM][禁字幕]`;
  return line.replace(/\r?\n/g, ' ');
}

function getStoryboardsForEpisode(db, episodeId) {
  const rows = dedupeStoryboardRowsByNumber(
    db.prepare(
      'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC'
    ).all(episodeId)
  );
  const propMap = {};
  try {
    const sbIds = rows.map((r) => r.id).filter(Boolean);
    if (sbIds.length > 0) {
      const placeholders = sbIds.map(() => '?').join(',');
      const spRows = db
        .prepare(`SELECT storyboard_id, prop_id FROM storyboard_props WHERE storyboard_id IN (${placeholders})`)
        .all(...sbIds);
      for (const row of spRows) {
        if (!propMap[row.storyboard_id]) propMap[row.storyboard_id] = [];
        propMap[row.storyboard_id].push(Number(row.prop_id));
      }
    }
  } catch (_) {}
  return rows.map((r) => {
    let background = null;
    if (r.scene_id != null) {
      const sceneRow = db.prepare('SELECT * FROM scenes WHERE id = ? AND deleted_at IS NULL').get(r.scene_id);
      if (sceneRow) background = rowToScene(sceneRow);
    }
    return {
      id: r.id,
      episode_id: r.episode_id,
      scene_id: r.scene_id,
      storyboard_number: r.storyboard_number,
      title: r.title,
      description: r.description,
      location: r.location,
      time: r.time,
      duration: normalizeDuration(r.duration),
      dialogue: r.dialogue,
      narration: r.narration ?? null,
      action: r.action,
      result: r.result,
      atmosphere: r.atmosphere,
      image_prompt: r.image_prompt,
      polished_prompt: r.polished_prompt ?? null,
      video_prompt: r.video_prompt,
      shot_type: r.shot_type,
      angle: r.angle,
      angle_h: r.angle_h ?? null,
      angle_v: r.angle_v ?? null,
      angle_s: r.angle_s ?? null,
      movement: r.movement,
      segment_index: r.segment_index ?? 0,
      segment_title: r.segment_title ?? null,
      creation_mode: r.creation_mode === 'universal' ? 'universal' : 'classic',
      universal_segment_text: r.universal_segment_text ?? null,
      characters: (() => {
        if (!r.characters) return [];
        if (typeof r.characters !== 'string') return Array.isArray(r.characters) ? r.characters : [];
        try { return JSON.parse(r.characters); } catch (_) { return []; }
      })(),
      prop_ids: propMap[r.id] || [],
      composed_image: r.composed_image,
      video_url: r.video_url,
      audio_local_path: r.audio_local_path ?? null,
      narration_audio_local_path: r.narration_audio_local_path ?? null,
      status: r.status || 'pending',
      created_at: r.created_at,
      updated_at: r.updated_at,
      background,
    };
  });
}

function extractInitialPose(action) {
  if (!action || typeof action !== 'string') return '';
  const processWords = [
    '然后', '接着', '接下来', '随后', '紧接着',
    '向下', '向上', '向前', '向后', '向左', '向右',
    '开始', '继续', '逐渐', '慢慢', '快速', '突然', '猛然',
  ];
  let result = action;
  for (const word of processWords) {
    const idx = result.indexOf(word);
    if (idx > 0) {
      result = result.slice(0, idx);
      break;
    }
  }
  return result.replace(/[，。,.]\s*$/, '').trim();
}

function generateImagePrompt(sb, style) {
  const parts = [];
  // 场景位置与时间
  if (sb.location) {
    let locationDesc = sb.location;
    if (sb.time) locationDesc += '，' + sb.time;
    parts.push(locationDesc);
  }
  // 镜头视角：优先结构化三元组（中文标签），降级到旧文本
  if (sb.angle_h && sb.angle_v && sb.angle_s) {
    parts.push(angleService.toChineseLabel(sb.angle_h, sb.angle_v, sb.angle_s));
  } else if (sb.angle || sb.shot_type) {
    const { h, v, s } = angleService.parseFromLegacyText(sb.angle || '', sb.shot_type || '');
    parts.push(angleService.toChineseLabel(h, v, s));
  }
  // 画面动作（取动作的起始状态）
  if (sb.action) {
    const initialPose = extractInitialPose(sb.action);
    if (initialPose) parts.push(initialPose);
  }
  // 情绪
  if (sb.emotion) parts.push(sb.emotion);
  // 风格（英文 prompt token，保持英文以兼容图片 AI）
  const styleText = style && String(style).trim();
  if (styleText) parts.push(styleText);
  parts.push('首帧静止画面');
  return parts.join('，');
}

function generateVideoPrompt(sb, style, videoRatio) {
  const parts = [];
  // 场景与标题
  if (sb.scene_description) {
    parts.push('场景：' + sb.scene_description);
  } else if (sb.location) {
    const scene = sb.time ? sb.location + '，' + sb.time : sb.location;
    parts.push('场景：' + scene);
  }
  if (sb.title) parts.push('镜头标题：' + sb.title);
  // 动作与对白（核心叙事）
  if (sb.action) parts.push('动作：' + sb.action);
  if (sb.dialogue) parts.push('对话：' + sb.dialogue);
  if (sb.narration) parts.push('解说旁白：' + sb.narration);
  if (sb.result) parts.push('结果：' + sb.result);
  // 镜头与运镜
  const shotType = sb.shot_type || sb.camera_shot_type;
  if (shotType) parts.push('景别：' + shotType);
  // 结构化视角：中文标签 + 英文描述（兼顾中英文视频模型）
  if (sb.angle_h && sb.angle_v && sb.angle_s) {
    const chLabel = angleService.toChineseLabel(sb.angle_h, sb.angle_v, sb.angle_s);
    const angleFragment = angleService.toPromptFragment(sb.angle_h, sb.angle_v, sb.angle_s);
    parts.push(`镜头角度：${chLabel}（${angleFragment}）`);
  } else {
    const angle = sb.angle ?? sb.camera_angle;
    if (angle) parts.push('镜头角度：' + angle);
  }
  const movement = sb.movement ?? sb.camera_movement;
  if (movement) parts.push('运镜：' + movement);
  // 氛围与情绪
  if (sb.atmosphere) parts.push('氛围：' + sb.atmosphere);
  if (sb.emotion) parts.push('情绪：' + sb.emotion);
  if (sb.emotion_intensity != null && sb.emotion_intensity !== '') {
    parts.push('情绪强度：' + String(sb.emotion_intensity));
  }
  // 声音
  if (sb.bgm_prompt) parts.push('配乐：' + sb.bgm_prompt);
  if (sb.sound_effect) parts.push('音效：' + sb.sound_effect);
  // 时长
  const durationSec = normalizeDuration(sb.duration) || 5;
  parts.push('时长：' + durationSec + '秒');
  // 风格（英文 token 保持英文以兼容视频 AI）与画面比例
  if (style) parts.push('风格：' + style);
  if (videoRatio) parts.push('=VideoRatio: ' + videoRatio);
  return parts.length ? parts.join('。') : '视频场景';
}

/**
 * 从 AI 输出的单个分镜对象计算入库字段（INSERT/UPDATE 共用）。
 * 会就地写入 sb.location / sb.time（由 scene_description 拆分）。
 */
function deriveStoryboardFieldsFromAi(sb, style, videoRatio, opts = {}) {
  const universalOmni = !!opts.universalOmni;
  const angleValFn = (x) => x.angle ?? x.camera_angle ?? null;
  const shotNumber = normalizeStoryboardShotNumber(sb);
  const title = sb.title ?? '';
  const shotType = sb.shot_type ?? '';
  const movement = sb.movement ?? sb.camera_movement ?? '';
  const angle = angleValFn(sb);
  const action = sb.action ?? '';
  const dialogue = sb.dialogue ?? '';
  const narration = sb.narration ?? '';
  const result = sb.result ?? '';
  const emotion = sb.emotion ?? '';
  const segmentIndex = sb.segment_index != null ? Number(sb.segment_index) : 0;
  const segmentTitle = sb.segment_title ?? null;
  const lightingStyle = sb.lighting_style ?? null;
  const depthOfField = sb.depth_of_field ?? null;
  let durationSec = normalizeDuration(sb.duration) || 5;
  const targetClip = opts.targetClipDuration != null ? Number(opts.targetClipDuration) : 0;
  const narrText = String(narration || '').trim();
  if (opts.fullNarrationMode) {
    const limits = opts.narrationLimits || DEFAULT_NARRATION_LIMITS;
    // 按时长公式对全文旁白估算；勿按字符串 length 截断（标点会计入 length 但不计入可读字数）
    durationSec = estimateDurationFromSpeechText(narrText, limits);
  } else if (Number.isFinite(targetClip) && targetClip > 0) {
    durationSec = Math.max(durationSec, Math.round(targetClip));
  }
  durationSec = Math.min(120, Math.max(1, Math.round(durationSec)));
  sb.duration = durationSec;
  if (!sb.location && sb.scene_description) {
    const sceneDesc = String(sb.scene_description).trim();
    const sepIdx = sceneDesc.search(/[，,、]/);
    if (sepIdx > 0) {
      sb.location = sceneDesc.slice(0, sepIdx).trim();
      if (!sb.time) sb.time = sceneDesc.slice(sepIdx + 1).trim();
    } else {
      sb.location = sceneDesc;
    }
  }
  const { h: angleH, v: angleV, s: angleS } = (angle || shotType)
    ? angleService.parseFromLegacyText(angle || '', shotType || '')
    : { h: null, v: null, s: null };
  const description = `【镜头类型】${shotType}\n【运镜】${movement}\n【动作】${action}\n【对话】${dialogue}\n【解说】${narration}\n【结果】${result}\n【情绪】${emotion}`;
  const sbWithAngles = { ...sb, angle_h: angleH, angle_v: angleV, angle_s: angleS };
  const imagePrompt = generateImagePrompt(sbWithAngles, style);
  const skipRuleVideoPrompt = opts.fullNarrationMode && !universalOmni;
  const videoPrompt = skipRuleVideoPrompt ? '' : generateVideoPrompt(sbWithAngles, style, videoRatio);
  const sceneId = sb.scene_id != null ? Number(sb.scene_id) : null;
  // 与 7b6c1a7 一致：原样保留 AI 的 characters；同时兼容 id / {id,name} / 纯数字字符串
  const charactersJson = Array.isArray(sb.characters)
    ? JSON.stringify(sb.characters)
    : (sb.characters ? JSON.stringify([].concat(sb.characters)) : '[]');
  // props 兼容 [1,2] 与 [{id:1},{id:2}]（后者若直接 Number() 会变成 NaN 导致道具全丢）
  const propIds = Array.isArray(sb.props)
    ? sb.props
      .map((p) => Number(typeof p === 'object' && p != null ? p.id : p))
      .filter(Number.isFinite)
    : [];
  let universalSegmentText = '';
  if (sb.universal_segment_text != null && String(sb.universal_segment_text).trim()) {
    universalSegmentText = String(sb.universal_segment_text).trim().replace(/\r?\n/g, ' ');
  }
  if (universalOmni && !universalSegmentText) {
    universalSegmentText = buildFallbackUniversalSeedanceLine(
      sb,
      {
        shotNumber,
        durationSec,
        shotType,
        movement,
        angle,
        action,
        dialogue,
        result,
        emotion,
        lightingStyle,
        depthOfField,
      },
      style
    );
  }
  const creationMode = universalOmni ? 'universal' : 'classic';
  if (!universalOmni) universalSegmentText = null;
  return {
    shotNumber,
    title,
    shotType,
    movement,
    angle,
    action,
    dialogue,
    narration,
    result,
    emotion,
    segmentIndex,
    segmentTitle,
    lightingStyle,
    depthOfField,
    description,
    imagePrompt,
    videoPrompt,
    sceneId,
    charactersJson,
    angleH,
    angleV,
    angleS,
    propIds,
    creationMode,
    universalSegmentText,
  };
}

/** 用最终解析的分镜对象覆盖已存在的行（修正流式增量先入库时缺 narration 等字段的问题） */
function updateStoryboardRowFromDerived(db, existingId, episodeIdNum, d, sb, now) {
  let charactersJson = d.charactersJson;
  let propIds = Array.isArray(d.propIds) ? [...d.propIds] : [];
  try {
    const existingRow = db.prepare('SELECT characters FROM storyboards WHERE id = ?').get(existingId);
    const existingChars = normalizeStoryboardCharactersField(existingRow?.characters);
    const incomingChars = normalizeStoryboardCharactersField(charactersJson);
    if (incomingChars.length === 0 && existingChars.length > 0) {
      charactersJson = JSON.stringify(existingChars);
    }
    const existingPropLinks = db
      .prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?')
      .all(existingId);
    const existingPropIds = existingPropLinks
      .map((p) => Number(p.prop_id))
      .filter(Number.isFinite);
    if (propIds.length === 0 && existingPropIds.length > 0) {
      propIds = existingPropIds;
    }
  } catch (_) {}

  db.prepare(
    `UPDATE storyboards SET
      scene_id = ?, title = ?, description = ?, location = ?, time = ?, duration = ?,
      dialogue = ?, narration = ?, action = ?, result = ?, atmosphere = ?,
      image_prompt = ?, video_prompt = ?, characters = ?,
      shot_type = ?, angle = ?, angle_h = ?, angle_v = ?, angle_s = ?, movement = ?,
      lighting_style = ?, depth_of_field = ?, segment_index = ?, segment_title = ?,
      creation_mode = ?, universal_segment_text = ?,
      updated_at = ?
     WHERE id = ? AND episode_id = ? AND deleted_at IS NULL`
  ).run(
    d.sceneId,
    d.title || null,
    d.description,
    sb.location ?? null,
    sb.time ?? null,
    sb.duration ?? 5,
    d.dialogue || null,
    d.narration || null,
    d.action || null,
    d.result || null,
    sb.atmosphere ?? null,
    d.imagePrompt,
    d.videoPrompt,
    charactersJson,
    d.shotType || null,
    d.angle,
    d.angleH,
    d.angleV,
    d.angleS,
    d.movement || null,
    d.lightingStyle,
    d.depthOfField,
    d.segmentIndex,
    d.segmentTitle,
    d.creationMode || 'classic',
    d.universalSegmentText != null ? d.universalSegmentText : null,
    now,
    existingId,
    episodeIdNum
  );
  try {
    if (propIds.length > 0) {
      db.prepare('DELETE FROM storyboard_props WHERE storyboard_id = ?').run(existingId);
      const insProp = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
      for (const pid of propIds) insProp.run(existingId, pid);
    }
  } catch (_) {}
}

/**
 * 将单个分镜对象插入 DB，供增量流式保存使用。
 * 返回插入后的 id，出错则返回 null（不抛异常）。
 */
function insertOneStoryboard(db, episodeIdNum, sb, style, videoRatio, now, deriveOpts = {}) {
  const d = deriveStoryboardFieldsFromAi(sb, style, videoRatio, deriveOpts);
  const shotNumber = d.shotNumber;
  try {
    db.prepare(
      `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, description, location, time, duration, dialogue, narration, action, result, atmosphere, image_prompt, video_prompt, characters, shot_type, angle, angle_h, angle_v, angle_s, movement, lighting_style, depth_of_field, segment_index, segment_title, creation_mode, universal_segment_text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      episodeIdNum, d.sceneId, shotNumber, d.title || null, d.description,
      sb.location ?? null, sb.time ?? null, sb.duration ?? 5,
      d.dialogue || null, d.narration || null, d.action || null, d.result || null, sb.atmosphere ?? null,
      d.imagePrompt, d.videoPrompt, d.charactersJson,
      d.shotType || null, d.angle, d.angleH, d.angleV, d.angleS,
      d.movement || null, d.lightingStyle, d.depthOfField, d.segmentIndex, d.segmentTitle,
      d.creationMode || 'classic',
      d.universalSegmentText != null ? d.universalSegmentText : null,
      now, now
    );
    const newId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    if (d.propIds.length > 0) {
      try {
        const insProp = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
        for (const pid of d.propIds) insProp.run(newId, pid);
      } catch (_) {}
    }
    return newId;
  } catch (_) {
    return null;
  }
}

/**
 * 在流式输出过程中，从已积累的文本尝试解析并保存尚未保存的分镜。
 * savedNums：已保存的 storyboard_number Set，用于去重。
 */
function tryIncrementalSave(db, log, episodeIdNum, accumulated, savedNums, style, videoRatio, deriveOpts = {}) {
  try {
    let cleaned = accumulated.trim()
      .replace(/^```json\s*/gm, '').replace(/^```\s*/gm, '').replace(/```\s*$/gm, '').trim();
    // 转义字符串字段里的原始换行符，防止 JSON.parse 报 "Unterminated string"
    cleaned = safeJson.escapeNewlinesInStrings(cleaned);
    let candidate = extractJsonCandidate(cleaned);
    if (!candidate) return;

    // 如果 AI 将数组包在对象里（如 doubao 的 {"storyboards":[...]}），提取内部数组
    const innerArray = safeJson.extractWrappedArrayStr(candidate);
    const arrayCandidate = innerArray || candidate;

    // 策略A：截断修复（找到已完整闭合的顶层元素）
    let parsed = null;
    const repaired = repairTruncatedJsonArray(arrayCandidate);
    if (repaired) {
      try { parsed = JSON.parse(repaired); } catch (_) {}
      // 策略B：截断修复 + jsonrepair
      if (!parsed && safeJson._jsonrepair) {
        try { parsed = JSON.parse(safeJson._jsonrepair(repaired)); } catch (_) {}
      }
    }
    // 策略C：直接 jsonrepair 整体修复
    if (!parsed && safeJson._jsonrepair) {
      try { parsed = JSON.parse(safeJson._jsonrepair(arrayCandidate)); } catch (_) {}
    }
    if (!parsed) return;
    const items = Array.isArray(parsed) ? parsed : extractFirstArray(parsed);
    if (!items || items.length === 0) return;
    const now = new Date().toISOString();
    let newCount = 0;
    for (const sb of items) {
      const shotNumber = normalizeStoryboardShotNumber(sb);
      if (deriveOpts.fullNarrationMode && shotNumber <= 0) continue;
      if (shotNumber > 0 && savedNums.has(shotNumber)) continue;
      const id = insertOneStoryboard(db, episodeIdNum, sb, style, videoRatio, now, deriveOpts);
      if (id !== null) {
        savedNums.add(shotNumber);
        newCount++;
      }
    }
    if (newCount > 0) {
      log.info('Storyboard incremental save', { episode_id: episodeIdNum, new_count: newCount, total_saved: savedNums.size });
    }
  } catch (_) { /* 流式解析错误静默忽略，等待最终完整解析 */ }
}

/**
 * @param {Set|null} skipShotNumbers - 已通过增量流式保存的 storyboard_number 集合，跳过重复插入
 */
function saveStoryboards(db, log, episodeId, storyboards, cfg, styleOverride, skipShotNumbers = null, deriveOpts = {}) {
  const episodeIdNum = Number(episodeId);
  if (storyboards.length === 0) {
    throw new Error('AI生成分镜失败：返回的分镜数量为0');
  }
  const style = (styleOverride && String(styleOverride).trim()) || cfg?.style?.default_style || '';
  const videoRatio = cfg?.style?.default_video_ratio || '16:9';
  const now = new Date().toISOString();

  // 仅在非增量模式下才删除旧数据（增量模式时已在流式开始前硬删除）
  if (skipShotNumbers === null) {
    purgeAllEpisodeStoryboards(db, log, episodeIdNum, resolveStorageRoot(loadConfig()));
  }

  const saved = [];
  const processedInSave = new Set();
  for (const sb of storyboards) {
    const shotNumber = normalizeStoryboardShotNumber(sb);
    if (shotNumber > 0 && processedInSave.has(shotNumber)) {
      log.warn('Duplicate storyboard_number in final AI batch, skipping extra row', {
        episode_id: episodeIdNum,
        storyboard_number: shotNumber,
      });
      continue;
    }

    // 已由增量流式保存过的分镜：必须用**最终完整 JSON** 再 UPDATE 一行（否则首镜常在流式阶段缺 narration 等字段且永不修正）
    if (skipShotNumbers && skipShotNumbers.has(shotNumber)) {
      const existing = db.prepare(
        'SELECT * FROM storyboards WHERE episode_id = ? AND storyboard_number = ? AND deleted_at IS NULL'
      ).get(episodeIdNum, shotNumber);
      if (existing) {
        const d = deriveStoryboardFieldsFromAi(sb, style, videoRatio, deriveOpts);
        updateStoryboardRowFromDerived(db, existing.id, episodeIdNum, d, sb, now);
        log.info('Storyboard merged from final parse after incremental save', {
          episode_id: episodeIdNum,
          storyboard_id: existing.id,
          storyboard_number: shotNumber,
        });
        const refreshed = db.prepare(
          'SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL'
        ).get(existing.id);
        let propIds = [];
        try {
          const propLinks = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').all(refreshed.id);
          propIds = propLinks.map((p) => p.prop_id);
        } catch (_) {}
        saved.push({
          id: refreshed.id,
          episode_id: episodeIdNum,
          scene_id: refreshed.scene_id,
          storyboard_number: shotNumber,
          title: refreshed.title,
          description: refreshed.description,
          location: refreshed.location,
          time: refreshed.time,
          duration: refreshed.duration,
          dialogue: refreshed.dialogue,
          narration: refreshed.narration ?? null,
          action: refreshed.action,
          result: refreshed.result,
          atmosphere: refreshed.atmosphere,
          image_prompt: refreshed.image_prompt,
          video_prompt: refreshed.video_prompt,
          shot_type: refreshed.shot_type,
          angle: refreshed.angle,
          movement: refreshed.movement,
          segment_index: refreshed.segment_index ?? 0,
          segment_title: refreshed.segment_title ?? null,
          creation_mode: refreshed.creation_mode === 'universal' ? 'universal' : 'classic',
          universal_segment_text: refreshed.universal_segment_text ?? null,
          characters: (() => { try { return JSON.parse(refreshed.characters || '[]'); } catch (_) { return []; } })(),
          prop_ids: propIds,
          status: refreshed.status,
          created_at: refreshed.created_at,
          updated_at: refreshed.updated_at,
        });
        if (shotNumber > 0) processedInSave.add(shotNumber);
        continue;
      }
      log.warn('Incremental shot missing in DB at final save, will insert', {
        episode_id: episodeIdNum,
        storyboard_number: shotNumber,
      });
    }

    const d = deriveStoryboardFieldsFromAi(sb, style, videoRatio, deriveOpts);

    try {
      db.prepare(
        `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, description, location, time, duration, dialogue, narration, action, result, atmosphere, image_prompt, video_prompt, characters, shot_type, angle, angle_h, angle_v, angle_s, movement, lighting_style, depth_of_field, segment_index, segment_title, creation_mode, universal_segment_text, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(
        episodeIdNum, d.sceneId, shotNumber, d.title || null, d.description,
        sb.location ?? null, sb.time ?? null, sb.duration ?? 5,
        d.dialogue || null, d.narration || null, d.action || null, d.result || null, sb.atmosphere ?? null,
        d.imagePrompt, d.videoPrompt, d.charactersJson,
        d.shotType || null, d.angle, d.angleH, d.angleV, d.angleS,
        d.movement || null, d.lightingStyle, d.depthOfField, d.segmentIndex, d.segmentTitle,
        d.creationMode || 'classic',
        d.universalSegmentText != null ? d.universalSegmentText : null,
        now, now
      );
    } catch (e) {
      if ((e.message || '').includes('shot_type') || (e.message || '').includes('angle') || (e.message || '').includes('movement') || (e.message || '').includes('result') || (e.message || '').includes('segment') || (e.message || '').includes('narration')) {
        db.prepare(
          `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, description, location, time, duration, dialogue, action, atmosphere, image_prompt, video_prompt, characters, creation_mode, universal_segment_text, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        ).run(
          episodeIdNum, d.sceneId, shotNumber, d.title || null, d.description,
          sb.location ?? null, sb.time ?? null, sb.duration ?? 5,
          d.dialogue || null, d.action || null, sb.atmosphere ?? null,
          d.imagePrompt, d.videoPrompt, d.charactersJson,
          d.creationMode || 'classic',
          d.universalSegmentText != null ? d.universalSegmentText : null,
          now, now
        );
      } else {
        throw e;
      }
    }
    const id = db.prepare('SELECT last_insert_rowid() as id').get().id;
    if (d.propIds.length > 0) {
      try {
        const insProp = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
        for (const pid of d.propIds) insProp.run(id, pid);
      } catch (_) {}
    }
    saved.push({
      id,
      episode_id: episodeIdNum,
      scene_id: d.sceneId,
      storyboard_number: shotNumber,
      title: d.title || null,
      description: d.description,
      location: sb.location ?? null,
      time: sb.time ?? null,
      duration: sb.duration ?? 5,
      dialogue: d.dialogue || null,
      narration: d.narration || null,
      action: d.action || null,
      result: d.result || null,
      atmosphere: sb.atmosphere ?? null,
      image_prompt: d.imagePrompt,
      video_prompt: d.videoPrompt,
      shot_type: d.shotType || null,
      angle: d.angle,
      movement: d.movement || null,
      segment_index: d.segmentIndex,
      segment_title: d.segmentTitle,
      creation_mode: d.creationMode || 'classic',
      universal_segment_text: d.universalSegmentText != null ? d.universalSegmentText : null,
      characters: Array.isArray(sb.characters) ? sb.characters : [],
      prop_ids: d.propIds,
      status: 'pending',
      created_at: now,
      updated_at: now,
    });
    if (shotNumber > 0) processedInSave.add(shotNumber);
  }

  // 增量保存后若最终镜数变少（如全文解说裁剪），硬删除本集未出现在最终列表中的分镜
  if (skipShotNumbers && processedInSave.size > 0) {
    const keepNums = [...processedInSave];
    const placeholders = keepNums.map(() => '?').join(',');
    const toRemove = db
      .prepare(
        `SELECT id FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL AND storyboard_number NOT IN (${placeholders})`
      )
      .all(episodeIdNum, ...keepNums)
      .map((r) => r.id);
    if (toRemove.length > 0) {
      const purged = hardDeleteStoryboardIds(db, log, toRemove, resolveStorageRoot(loadConfig()));
      log.info('Storyboards pruned after final save (hard delete)', {
        episode_id: episodeIdNum,
        removed_count: purged.storyboards,
        kept_numbers: keepNums,
      });
    }
  }

  log.info('Storyboards saved', { episode_id: episodeId, count: saved.length });
  return saved;
}

/**
 * 将剧本正文按标点拆分为全文解说段落。
 * 统一规则：目标约 9 秒 / 语速×9 字；在当前符号处切开；即将超 语速×10 字则退回上一符号；
 * 末段 ≤上限保留，>上限再拆成两镜（仍只在标点处切）。
 */
function splitScriptIntoNarrationSegments(script, limits = DEFAULT_NARRATION_LIMITS) {
  const text = String(script || '').trim();
  if (!text) return [];
  const units = tokenizeNarrationAtoms(text, limits);
  if (!units.length) return [];
  return packNarrationUnitsByTarget(units, limits);
}

/**
 * 拆成标点单元（句末 + 句内逗号等），单段无标点且超上限时才硬切可读字。
 */
function tokenizeNarrationAtoms(text, limits = DEFAULT_NARRATION_LIMITS) {
  const cap = limits.FULL_NARRATION_MAX_CHARS;
  const atoms = [];
  const paragraphs = String(text).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const blocks = paragraphs.length ? paragraphs : [String(text).trim()];

  for (const block of blocks) {
    const primaryParts = block.split(NARRATION_PRIMARY_PUNCT_RE).map((s) => s.trim()).filter(Boolean);
    for (const part of primaryParts) {
      if (countNarrationSpeechChars(part) <= cap) {
        // 句内再拆成逗号级单元，便于装到约目标字数
        const secondaryParts = part.split(NARRATION_SECONDARY_PUNCT_RE).map((s) => s.trim()).filter(Boolean);
        if (secondaryParts.length > 1) {
          for (const sub of secondaryParts) {
            if (countNarrationSpeechChars(sub) <= cap) atoms.push(sub);
            else atoms.push(...splitOversizedNarrationClause(sub, cap));
          }
        } else {
          atoms.push(part);
        }
        continue;
      }
      const secondaryParts = part.split(NARRATION_SECONDARY_PUNCT_RE).map((s) => s.trim()).filter(Boolean);
      if (secondaryParts.length <= 1) {
        atoms.push(...splitOversizedNarrationClause(part, cap));
        continue;
      }
      for (const sub of secondaryParts) {
        if (countNarrationSpeechChars(sub) <= cap) atoms.push(sub);
        else atoms.push(...splitOversizedNarrationClause(sub, cap));
      }
    }
  }
  return atoms;
}

/**
 * 单句仍超上限：在句内标点处尽量切分；整段无任何标点时才按可读字数硬切（极少见）
 */
function splitOversizedNarrationClause(clause, capSpeech) {
  const s = String(clause || '').trim();
  if (!s) return [];
  if (countNarrationSpeechChars(s) <= capSpeech) return [s];

  const punct = ['，', ',', '、', '：', ':', '；', ';', '。', '！', '？', '!', '?', '—', '–', '-'];
  const out = [];
  let rest = s;
  while (countNarrationSpeechChars(rest) > capSpeech) {
    let bestCut = -1;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (!punct.includes(ch)) continue;
      const head = rest.slice(0, i + 1);
      const headSpeech = countNarrationSpeechChars(head);
      if (headSpeech > 0 && headSpeech <= capSpeech) bestCut = i;
    }
    if (bestCut >= 0) {
      out.push(rest.slice(0, bestCut + 1).trim());
      rest = rest.slice(bestCut + 1).trim();
      continue;
    }
    const { head, tail } = sliceNarrationBySpeechChars(rest, capSpeech);
    if (!head) break;
    out.push(head.trim());
    rest = (tail || '').trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/**
 * 按目标字数装箱：已满约 target 字则在当前符号处成镜；
 * 再加一段会超 max 则退回上一符号成镜；末段超 max 再拆两镜。
 */
function packNarrationUnitsByTarget(units, limits = DEFAULT_NARRATION_LIMITS) {
  const target = limits.FULL_NARRATION_TARGET_CHARS
    ?? Math.round((limits.FULL_NARRATION_TARGET_SEC || FULL_NARRATION_TARGET_SEC) * (limits.NARRATION_CHARS_PER_SEC || NARRATION_CHARS_PER_SEC));
  const max = limits.FULL_NARRATION_MAX_CHARS;
  const speechLen = (s) => countNarrationSpeechChars(s);
  const segments = [];
  let buf = '';

  const flush = () => {
    if (!buf) return;
    segments.push(buf);
    buf = '';
  };

  for (const raw of units || []) {
    const unit = String(raw || '').trim();
    if (!unit) continue;

    if (speechLen(unit) > max) {
      flush();
      segments.push(...splitOversizedNarrationClause(unit, max));
      continue;
    }

    if (!buf) {
      buf = unit;
      continue;
    }

    const next = buf + unit;
    const nextLen = speechLen(next);
    const bufLen = speechLen(buf);

    if (nextLen > max) {
      // 超出硬上限：退回上一符号，本单元开新镜
      flush();
      buf = unit;
      continue;
    }

    if (bufLen >= target) {
      // 已达约目标字数：在当前符号处切开，不再硬拼
      flush();
      buf = unit;
      continue;
    }

    buf = next;
  }
  flush();

  // 末段及任何超上限段：再拆（只在标点处），保证每镜 ≤硬上限
  return finalizeNarrationSegmentsMax(segments, max);
}

/** 保证每段 ≤max；末段若超限拆成两段（优先中位标点） */
function finalizeNarrationSegmentsMax(segments, max) {
  const out = [];
  for (const seg of segments || []) {
    const s = String(seg || '').trim();
    if (!s) continue;
    if (countNarrationSpeechChars(s) <= max) {
      out.push(s);
      continue;
    }
    const parts = splitOversizedNarrationClause(s, max);
    if (parts.length <= 1) {
      out.push(...parts);
      continue;
    }
    // 超长末段：尽量均分成两镜（仍只在已切好的标点块边界合并）
    if (parts.length === 2) {
      out.push(...parts);
      continue;
    }
    let best = 1;
    let bestDiff = Infinity;
    let left = 0;
    const total = parts.reduce((a, p) => a + countNarrationSpeechChars(p), 0);
    for (let i = 1; i < parts.length; i++) {
      left += countNarrationSpeechChars(parts[i - 1]);
      if (left > max || total - left > max) continue;
      const diff = Math.abs(left - (total - left));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    const a = parts.slice(0, best).join('');
    const b = parts.slice(best).join('');
    if (countNarrationSpeechChars(a) <= max && countNarrationSpeechChars(b) <= max && b) {
      out.push(a, b);
    } else {
      out.push(...parts);
    }
  }
  return out;
}

/** @deprecated 兼容旧调用：改为按目标字数装箱 */
function mergeNarrationAtomsIntoSegments(atoms, limits = DEFAULT_NARRATION_LIMITS) {
  return packNarrationUnitsByTarget(atoms, limits);
}

/**
 * 兼容旧接口：短段仅在「合并后仍 ≤ 目标字数」时并入，绝不拼超上限。
 */
function mergeShortNarrationSegments(
  segments,
  min = FULL_NARRATION_MIN_CHARS,
  cap = FULL_NARRATION_MAX_CHARS,
  target = FULL_NARRATION_TARGET_CHARS
) {
  const effectiveTarget = Math.min(target, cap);
  const out = (segments || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (out.length <= 1) return finalizeNarrationSegmentsMax(out, cap);
  const speechLen = (s) => countNarrationSpeechChars(s);

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      if (speechLen(out[i]) >= min) continue;
      if (i < out.length - 1 && speechLen(out[i]) + speechLen(out[i + 1]) <= effectiveTarget) {
        out[i] = out[i] + out[i + 1];
        out.splice(i + 1, 1);
        changed = true;
        break;
      }
      if (i > 0 && speechLen(out[i - 1]) + speechLen(out[i]) <= effectiveTarget) {
        out[i - 1] = out[i - 1] + out[i];
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return finalizeNarrationSegmentsMax(out, cap);
}

/** 比较旁白覆盖范围时忽略空白与换行 */
function normalizeNarrationCoverageText(text) {
  return String(text || '').replace(/\s+/g, '');
}

/** 仅拆分超长镜段（不触发短段合并，避免递归） */
function splitOverlongNarrationSegments(segments, cap = FULL_NARRATION_MAX_CHARS) {
  const out = [];
  for (const seg of segments || []) {
    const s = String(seg || '').trim();
    if (!s) continue;
    if (countNarrationSpeechChars(s) <= cap) out.push(s);
    else out.push(...splitOversizedNarrationClause(s, cap));
  }
  return out;
}

/** @deprecated 保留兼容：仅做标点级拆分后的合并，不再按字数硬切 */
function ensureNarrationSegmentsWithinLimit(segments, limits = DEFAULT_NARRATION_LIMITS) {
  const cap = limits.FULL_NARRATION_MAX_CHARS;
  const atoms = [];
  for (const seg of segments || []) {
    const s = String(seg || '').trim();
    if (!s) continue;
    if (countNarrationSpeechChars(s) <= cap) atoms.push(s);
    else atoms.push(...tokenizeNarrationAtoms(s, limits));
  }
  return mergeNarrationAtomsIntoSegments(atoms.length ? atoms : segments, limits);
}

/** @deprecated 保留兼容：整段合并，不拆字借位 */
function ensureNarrationSegmentsMinLength(segments, limits = DEFAULT_NARRATION_LIMITS) {
  return mergeShortNarrationSegments(
    ensureNarrationSegmentsWithinLimit(segments, limits),
    limits.FULL_NARRATION_MIN_CHARS,
    limits.FULL_NARRATION_MAX_CHARS,
    limits.FULL_NARRATION_TARGET_CHARS
  );
}

function buildFullNarrationSegmentBinding(cfg, segments, limits = DEFAULT_NARRATION_LIMITS) {
  if (!segments?.length) return '';
  const targetChars = limits.FULL_NARRATION_TARGET_CHARS ?? FULL_NARRATION_TARGET_CHARS;
  const maxChars = limits.FULL_NARRATION_MAX_CHARS;
  const isEn = promptI18n.isEnglish(cfg);
  const totalShots = segments.length + 1;
  const lines = segments.map((seg, i) => {
    const len = countNarrationSpeechChars(seg);
    const dur = estimateDurationFromSpeechText(seg, limits);
    const shotNum = i + 2;
    return isEn
      ? `  Shot ${shotNum} narration (verbatim; target ~${targetChars}, max ${maxChars} speech chars; this segment ${len} speech chars), duration=${dur}s:\n  """\n  ${seg}\n  """`
      : `  第 ${shotNum} 镜 narration（逐字照抄；目标约 ${targetChars} 字、上限 ${maxChars} 字；本段 ${len} 字），duration=${dur}秒：\n  """\n  ${seg}\n  """`;
  }).join('\n\n');
  if (isEn) {
    return `

[FULL NARRATION BINDING — MANDATORY]
You MUST output exactly ${totalShots} shots total:
- **Shot 1**: title/establishing card only — "narration" MUST be empty string ""; include scene/characters/props like shot 2; duration ${FULL_NARRATION_TITLE_SHOT_DURATION}s.
- **Shots 2–${totalShots}**: for shot j (j≥2), "narration" MUST equal segment (j−1) below verbatim. Pack ~${targetChars} chars (max ${maxChars}) at punctuation only.

${lines}`;
  }
  return `

【全文解说分段绑定 — 硬性要求】
你必须输出恰好 ${totalShots} 个分镜：
- **第 1 镜**：片头/标题氛围镜 — "narration" 必须为空字符串 ""；须填写场景、角色、物品（与第 2 镜一致即可）；duration=${FULL_NARRATION_TITLE_SHOT_DURATION} 秒。
- **第 2～${totalShots} 镜**：第 j 镜（j≥2）的 "narration" 必须**逐字等于**下列第 (j−1) 段原文；按约 ${targetChars} 字（上限 ${maxChars} 字）在标点处切分。

${lines}`;
}

function normalizeStoryboardCharactersField(chars) {
  if (chars == null) return [];
  if (Array.isArray(chars)) return chars;
  if (typeof chars === 'string') {
    const t = chars.trim();
    if (!t || t === '[]') return [];
    try {
      const parsed = JSON.parse(t);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function isEmptyStoryboardCharactersField(chars) {
  return normalizeStoryboardCharactersField(chars).length === 0;
}

function normalizeStoryboardPropIdsField(props) {
  if (!Array.isArray(props)) return [];
  return props
    .map((p) => Number(typeof p === 'object' && p != null ? p.id : p))
    .filter(Number.isFinite);
}

/** 从 AI 分镜列表中选取「有角色/道具/场景」的捐赠镜，避免用最后一镜（常为空）作模板 */
function pickFullNarrationAssetDonor(ordered) {
  if (!Array.isArray(ordered) || !ordered.length) return {};
  const contentShots = ordered.length > 1 ? ordered.slice(1) : ordered;
  for (const sb of contentShots) {
    if (!isEmptyStoryboardCharactersField(sb?.characters)) return sb;
  }
  for (const sb of contentShots) {
    if (normalizeStoryboardPropIdsField(sb?.props).length > 0) return sb;
  }
  for (const sb of contentShots) {
    if (sb?.scene_id) return sb;
  }
  return contentShots[0] || ordered[0] || {};
}

/** 目标镜缺少资产字段时，从捐赠镜补全（只补空，不覆盖已有） */
function inheritStoryboardAssetFields(target, donor) {
  if (!target || !donor) return target;
  if (!target.scene_id && donor.scene_id) target.scene_id = donor.scene_id;
  if (!target.location && donor.location) target.location = donor.location;
  if (!target.time && donor.time) target.time = donor.time;
  if (!target.scene_description && donor.scene_description) {
    target.scene_description = donor.scene_description;
  }
  if (isEmptyStoryboardCharactersField(target.characters) && !isEmptyStoryboardCharactersField(donor.characters)) {
    target.characters = normalizeStoryboardCharactersField(donor.characters);
  }
  const targetProps = normalizeStoryboardPropIdsField(target.props);
  const donorProps = normalizeStoryboardPropIdsField(donor.props);
  if (!targetProps.length && donorProps.length) {
    target.props = donorProps;
  }
  return target;
}

/** 全文解说：各镜统一继承捐赠镜的角色/道具/场景（AI 常只填第 2 镜） */
function propagateFullNarrationAssetsAcrossShots(storyboards) {
  if (!Array.isArray(storyboards) || storyboards.length < 2) return storyboards;
  const ordered = normalizeStoryboardListShotNumbers(storyboards);
  const donor = pickFullNarrationAssetDonor(ordered);
  for (let i = 0; i < storyboards.length; i += 1) {
    const sb = storyboards[i];
    inheritStoryboardAssetFields(sb, i === 0 ? (storyboards[1] || donor) : donor);
  }
  enrichFullNarrationTitleShotFields(storyboards[0], storyboards[1]);
  return storyboards;
}

/** 入库后：将捐赠镜的角色/道具写入本集仍为空的分镜 */
function propagateFullNarrationAssetsInDb(db, log, episodeIdNum) {
  const rows = db
    .prepare(
      `SELECT id, storyboard_number, scene_id, location, time, characters
       FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL
       ORDER BY storyboard_number ASC, id ASC`
    )
    .all(episodeIdNum);
  if (rows.length < 2) return { characters_updated: 0, props_added: 0 };

  let donor = null;
  let donorProps = [];
  for (const row of rows) {
    if (Number(row.storyboard_number) === 1) continue;
    const chars = normalizeStoryboardCharactersField(row.characters);
    let propIds = [];
    try {
      propIds = db
        .prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?')
        .all(row.id)
        .map((p) => Number(p.prop_id))
        .filter(Number.isFinite);
    } catch (_) {}
    if (chars.length || propIds.length || row.scene_id) {
      donor = row;
      donorProps = propIds;
      if (chars.length || propIds.length) break;
    }
  }
  if (!donor) return { characters_updated: 0, props_added: 0 };

  const donorCharsJson = JSON.stringify(normalizeStoryboardCharactersField(donor.characters));
  const now = new Date().toISOString();
  let charactersUpdated = 0;
  let propsAdded = 0;
  const insProp = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');

  for (const row of rows) {
    const chars = normalizeStoryboardCharactersField(row.characters);
    const updates = [];
    const params = [];
    if (isEmptyStoryboardCharactersField(chars) && !isEmptyStoryboardCharactersField(donor.characters)) {
      updates.push('characters = ?');
      params.push(donorCharsJson);
    }
    if (!row.scene_id && donor.scene_id) {
      updates.push('scene_id = ?');
      params.push(donor.scene_id);
    }
    if (!row.location && donor.location) {
      updates.push('location = ?');
      params.push(donor.location);
    }
    if (!row.time && donor.time) {
      updates.push('time = ?');
      params.push(donor.time);
    }
    if (updates.length) {
      updates.push('updated_at = ?');
      params.push(now);
      params.push(row.id);
      db.prepare(`UPDATE storyboards SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      charactersUpdated += 1;
    }
    if (donorProps.length) {
      let existingProps = [];
      try {
        existingProps = db
          .prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?')
          .all(row.id)
          .map((p) => Number(p.prop_id))
          .filter(Number.isFinite);
      } catch (_) {}
      if (!existingProps.length) {
        for (const pid of donorProps) {
          insProp.run(row.id, pid);
          propsAdded += 1;
        }
      }
    }
    try {
      syncStoryboardCharacterLinksFromCharactersColumn(db, row.id);
    } catch (_) {}
  }

  if ((charactersUpdated > 0 || propsAdded > 0) && log?.info) {
    log.info('[分镜] 全文解说资产字段已跨镜继承', {
      episode_id: episodeIdNum,
      donor_storyboard_id: donor.id,
      characters_updated: charactersUpdated,
      props_added: propsAdded,
    });
  }
  return { characters_updated: charactersUpdated, props_added: propsAdded };
}

/** 片头镜从第 2 镜继承场景/角色/物品（内存对象，enforce 阶段） */
function enrichFullNarrationTitleShotFields(titleShot, contentShot) {
  if (!titleShot || !contentShot) return;
  if (!titleShot.scene_id && contentShot.scene_id) titleShot.scene_id = contentShot.scene_id;
  if (!titleShot.location && contentShot.location) titleShot.location = contentShot.location;
  if (!titleShot.time && contentShot.time) titleShot.time = contentShot.time;
  if (!titleShot.scene_description && contentShot.scene_description) {
    titleShot.scene_description = contentShot.scene_description;
  }
  const titleChars = titleShot.characters;
  const contentChars = contentShot.characters;
  const titleEmpty = !titleChars || (Array.isArray(titleChars) && titleChars.length === 0);
  if (titleEmpty && contentChars && (Array.isArray(contentChars) ? contentChars.length > 0 : true)) {
    titleShot.characters = contentChars;
  }
  if ((!titleShot.props || titleShot.props.length === 0) && contentShot.props?.length) {
    titleShot.props = contentShot.props;
  }
}

/** 清理镜号 ≤0 的流式脏数据 */
function cleanupGhostStoryboardRows(db, log, episodeIdNum) {
  const ghosts = db
    .prepare(
      'SELECT id, storyboard_number FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL AND (storyboard_number IS NULL OR storyboard_number <= 0)'
    )
    .all(episodeIdNum);
  if (ghosts.length) {
    hardDeleteStoryboardIds(
      db,
      log,
      ghosts.map((g) => g.id),
      resolveStorageRoot(loadConfig())
    );
    log.info('[分镜] 已硬删除无效镜号分镜', { episode_id: episodeIdNum, count: ghosts.length });
  }
}

/** 入库后：片头镜继承第 2 镜的角色/场景/物品 */
function enrichFullNarrationTitleShotInDb(db, log, episodeIdNum) {
  const rows = db.prepare(
    'SELECT id, storyboard_number, narration, scene_id, location, time, characters FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC, id ASC'
  ).all(episodeIdNum);
  if (rows.length < 2) return;
  const title = rows[0];
  const content = rows[1];
  if (Number(title.storyboard_number) !== 1) return;
  if (String(title.narration || '').trim()) return;

  const now = new Date().toISOString();
  const updates = [];
  const params = [];
  if (!title.scene_id && content.scene_id) {
    updates.push('scene_id = ?');
    params.push(content.scene_id);
  }
  if (!title.location && content.location) {
    updates.push('location = ?');
    params.push(content.location);
  }
  if (!title.time && content.time) {
    updates.push('time = ?');
    params.push(content.time);
  }
  let titleChars = [];
  try { titleChars = JSON.parse(title.characters || '[]'); } catch (_) {}
  if (!Array.isArray(titleChars) || titleChars.length === 0) {
    const cc = content.characters;
    if (cc && String(cc).trim() && String(cc).trim() !== '[]') {
      updates.push('characters = ?');
      params.push(cc);
    }
  }
  if (updates.length) {
    updates.push('updated_at = ?');
    params.push(now);
    params.push(title.id);
    db.prepare(`UPDATE storyboards SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const titleProps = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').all(title.id);
  if (titleProps.length === 0) {
    const contentProps = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').all(content.id);
    const ins = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
    for (const p of contentProps) ins.run(title.id, p.prop_id);
  }
  try {
    syncStoryboardCharacterLinksFromCharactersColumn(db, title.id);
  } catch (e) {
    log.warn('[分镜] 片头镜角色库链接同步失败', { storyboard_id: title.id, error: e.message });
  }
}

async function recoverFullNarrationFromPartial(db, log, episodeIdNum, taskId, fullNarrationSegments, errorMessage) {
  cleanupGhostStoryboardRows(db, log, episodeIdNum);
  const resynced = await resyncFullNarrationForEpisodeAsync(db, log, episodeIdNum);
  enrichFullNarrationTitleShotInDb(db, log, episodeIdNum);
  const totalDuration = resynced.total_duration || 0;
  taskService.updateTaskResult(db, taskId, {
    storyboards: resynced.storyboards,
    total: resynced.total,
    total_duration: totalDuration,
    duration_minutes: Math.ceil((totalDuration + 59) / 60),
    truncated: true,
    error_message: errorMessage,
  });
  return resynced;
}

/** 全文解说模式：第 1 镜片头（无旁白），第 2 镜起绑定预切分原文 */
function enforceFullNarrationSegments(storyboards, segments, log, taskId, limits = DEFAULT_NARRATION_LIMITS) {
  if (!Array.isArray(storyboards) || !segments?.length) return storyboards;
  // 入库/同步时的 segments 已按目标/硬上限规则切好；此处只保证不超硬上限，不再强行并短段
  const safeSegments = finalizeNarrationSegmentsMax(
    (segments || []).map((s) => String(s || '').trim()).filter(Boolean),
    limits.FULL_NARRATION_MAX_CHARS
  );
  const segCount = safeSegments.length;
  const totalShots = segCount + 1;
  const ordered = normalizeStoryboardListShotNumbers(storyboards);
  const aiCount = ordered.length;

  if (aiCount > totalShots) {
    log.warn('[分镜] 全文解说镜数多于段落数+片头，已裁剪多余分镜', {
      task_id: taskId,
      ai_shots: aiCount,
      segment_count: segCount,
      expected_shots: totalShots,
    });
  } else if (aiCount < totalShots) {
    log.warn('[分镜] 全文解说镜数不足，按段落数+片头补齐', {
      task_id: taskId,
      ai_shots: aiCount,
      segment_count: segCount,
      expected_shots: totalShots,
    });
  }

  const assetDonor = pickFullNarrationAssetDonor(ordered);
  const structuralTemplate = ordered[0] || assetDonor || {};
  const titleBase = ordered[0] || structuralTemplate;
  const contentBases = ordered.length > 1 ? ordered.slice(1) : ordered;

  const rebuilt = [];
  rebuilt.push({
    ...structuralTemplate,
    ...titleBase,
    shot_number: 1,
    storyboard_number: 1,
    title: titleBase.title || titleBase.segment_title || '片头',
    dialogue: '',
    narration: '',
    duration: FULL_NARRATION_TITLE_SHOT_DURATION,
  });

  for (let i = 0; i < segCount; i++) {
    const base = contentBases[i] || contentBases[contentBases.length - 1] || assetDonor || structuralTemplate;
    rebuilt.push({
      ...structuralTemplate,
      ...base,
      shot_number: i + 2,
      storyboard_number: i + 2,
      title: base.title || (structuralTemplate.title ? `${structuralTemplate.title}·解说${i + 1}` : `解说${i + 1}`),
      dialogue: base.dialogue != null ? base.dialogue : '',
      narration: safeSegments[i],
      duration: estimateDurationFromSpeechText(safeSegments[i], limits),
    });
  }

  propagateFullNarrationAssetsAcrossShots(rebuilt);

  storyboards.length = 0;
  storyboards.push(...rebuilt);
  return storyboards;
}

/**
 * 按当前集剧本正文重新切分并写回各镜 narration（不调用 AI，保留已有画面/提示词等字段）。
 * 用于全文解说模式规则更新后，或旧分镜旁白错位时的快速修复。
 */
function resyncFullNarrationForEpisode(db, log, episodeId) {
  return resyncFullNarrationForEpisodeAsync(db, log, episodeId);
}

async function resyncFullNarrationForEpisodeAsync(db, log, episodeId) {
  const episodeIdNum = Number(episodeId);
  const episode = db.prepare(
    'SELECT id, script_content, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(episodeIdNum);
  if (!episode) throw new Error('剧集不存在');
  const script = String(episode.script_content || '').trim();
  if (!script) throw new Error('当前集无剧本正文，无法同步旁白');

  const narrationLimits = getNarrationLimitsForEpisode(db, episodeIdNum);
  const segments = splitScriptIntoNarrationSegments(script, narrationLimits);
  if (!segments.length) throw new Error('剧本正文无法切分为解说段落');

  const existingRows = getStoryboardsForEpisode(db, episodeIdNum);
  if (!existingRows.length) throw new Error('当前集尚无分镜，请先生成分镜');

  const storyboards = existingRows.map((row) => {
    let propIds = [];
    try {
      propIds = db
        .prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?')
        .all(row.id)
        .map((p) => Number(p.prop_id))
        .filter(Number.isFinite);
    } catch (_) {}
    return {
      id: row.id,
      shot_number: row.storyboard_number,
      storyboard_number: row.storyboard_number,
      title: row.title,
      location: row.location,
      time: row.time,
      scene_id: row.scene_id,
      dialogue: row.dialogue,
      action: row.action,
      atmosphere: row.atmosphere,
      creation_mode: row.creation_mode,
      universal_segment_text: row.universal_segment_text,
      narration: row.narration,
      duration: row.duration,
      characters: row.characters,
      props: propIds,
    };
  });

  enforceFullNarrationSegments(storyboards, segments, log, `resync-${episodeIdNum}`, narrationLimits);

  const now = new Date().toISOString();
  const n = storyboards.length;
  const template = existingRows[existingRows.length - 1] || {};

  for (const row of existingRows) {
    db.prepare('UPDATE storyboards SET storyboard_number = ? WHERE id = ?').run(-Number(row.id), row.id);
  }

  const keptIds = new Set();
  for (let i = 0; i < n; i++) {
    const sb = storyboards[i];
    const num = i + 1;
    const narr = sb.narration || '';
    // 第 1 镜片头无旁白：固定 6 秒；其余镜按旁白可读字数估算
    const dur = num === 1 && !String(narr).trim()
      ? FULL_NARRATION_TITLE_SHOT_DURATION
      : estimateDurationFromSpeechText(narr, narrationLimits);

    if (sb.id) {
      db.prepare(
        'UPDATE storyboards SET storyboard_number = ?, narration = ?, duration = ?, updated_at = ? WHERE id = ?'
      ).run(num, narr || null, dur, now, sb.id);
      keptIds.add(sb.id);
      continue;
    }

    db.prepare(
      `INSERT INTO storyboards (episode_id, scene_id, storyboard_number, title, location, time, duration, dialogue, narration, action, atmosphere, creation_mode, universal_segment_text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      episodeIdNum,
      template.scene_id ?? null,
      num,
      sb.title || `解说${num}`,
      template.location ?? sb.location ?? null,
      template.time ?? sb.time ?? null,
      dur,
      sb.dialogue || null,
      narr || null,
      template.action ?? sb.action ?? null,
      template.atmosphere ?? sb.atmosphere ?? null,
      template.creation_mode || 'classic',
      null,
      now,
      now
    );
    keptIds.add(db.prepare('SELECT last_insert_rowid() as id').get().id);
  }

  let removed = 0;
  const storageRoot = resolveStorageRoot(loadConfig());
  for (const row of existingRows) {
    if (!keptIds.has(row.id)) {
      hardDeleteStoryboardIds(db, log, [row.id], storageRoot);
      removed += 1;
    }
  }

  const saved = getStoryboardsForEpisode(db, episodeIdNum);
  enrichFullNarrationTitleShotInDb(db, log, episodeIdNum);
  propagateFullNarrationAssetsInDb(db, log, episodeIdNum);
  const totalDuration = saved.reduce((s, sb) => s + (Number(sb.duration) || 0), 0);
  db.prepare('UPDATE episodes SET duration = ?, updated_at = ? WHERE id = ?').run(
    Math.ceil((totalDuration + 59) / 60),
    now,
    episodeIdNum
  );

  try {
    require('./narrationAudioService').clearEpisodeFullNarrationAudio(db, log, episodeIdNum, storageRoot);
  } catch (err) {
    log.warn('[分镜] 重新同步后清除整段旁白配音失败', { episode_id: episodeIdNum, error: err.message });
  }

  log.info('[分镜] 全文解说旁白已重新同步', {
    episode_id: episodeIdNum,
    segment_count: n,
    removed_storyboards: removed,
  });

  return {
    storyboards: saved,
    total: saved.length,
    total_duration: totalDuration,
    segment_count: n,
    removed_storyboards: removed,
  };
}

/**
 * 构建续写 prompt：当首次响应被截断时，携带已生成分镜完整列表 + 末尾详情作为上下文，
 * 请求 AI 从 lastShotNum+1 继续生成剩余分镜。
 * 关键：必须把所有已生成分镜的 shot_number + segment_title + title 全部列出，
 * 防止 AI 因不知道哪些情节已覆盖而重复生成相同内容。
 */
function buildContinuationPrompt(originalUserPrompt, alreadySaved, lastShotNum, attempt, includeNarration, universalOmni = false, fullNarrationMode = false) {
  let narrLine = '';
  if (fullNarrationMode) {
    const tailNarr = alreadySaved
      .slice(-3)
      .map((sb) => (sb.narration != null ? String(sb.narration).trim() : ''))
      .filter(Boolean)
      .join('\n---\n');
    narrLine = '\n- 续写须含片头第 1 镜（narration 留空）；旁白从第 2 镜起，须紧接原文未覆盖部分，仍为原文逐字连续摘录，禁止改写、重复已覆盖内容';
    if (tailNarr) {
      narrLine += `\n\n【已覆盖的末尾旁白原文（下一段须紧接其后继续，不得重复）】\n${tailNarr}`;
    }
  } else if (includeNarration) {
    narrLine = '\n- 每条新增分镜必须含非空字符串 narration（至少一句解说，与首次任务一致；禁止留空）';
  }
  const uniLine = universalOmni
    ? '\n- 每条新增分镜必须含 creation_mode:"universal" 与非空 universal_segment_text（单行：须含「叙事动态」时间线+「镜头」运镜链至少两步如定镜/缓推轨/横移从遮挡后滑出；按 duration 秒写视频动势，禁止静帧式描写；与首轮要求一致）'
    : '';
  // 全量已生成分镜摘要（每行一个，仅 shot_number + segment + title）
  const allSummary = alreadySaved.map((sb) => {
    const num = sb.shot_number ?? sb.storyboard_number ?? 0;
    const seg = (sb.segment_title || '').replace(/"/g, '\\"');
    const title = (sb.title || '').replace(/"/g, '\\"');
    return `  ${num}. [${seg}] ${title}`;
  }).join('\n');

  // 末尾 5 个分镜的详细内容（供衔接用）
  const lastCtx = alreadySaved.slice(-5).map((sb) => {
    const num = sb.shot_number ?? sb.storyboard_number ?? 0;
    const title = (sb.title || '').replace(/"/g, '\\"');
    const loc = (sb.location || '').replace(/"/g, '\\"');
    const action = (sb.action || '').slice(0, 120).replace(/"/g, '\\"');
    return `  {"shot_number": ${num}, "title": "${title}", "location": "${loc}", "action": "${action}"}`;
  }).join(',\n');

  return `[续写指令 - 第${attempt}次续写]
之前的分镜生成因长度限制在 shot_number ${lastShotNum} 处中断，已生成 ${alreadySaved.length} 个分镜。

━━━ 已生成分镜完整列表（绝对不能重复以下内容）━━━
${allSummary}
━━━ 列表结束 ━━━

以上所有情节均已覆盖，请勿重复。末尾几个分镜详情供衔接参考：
[
${lastCtx}
]

请从 shot_number ${lastShotNum + 1} 继续生成剩余分镜，直至剧本全部场景覆盖完毕。
要求：
- 仅返回新增分镜（JSON数组），shot_number 从 ${lastShotNum + 1} 开始递增
- 格式与之前完全相同，字段保持一致${narrLine}${uniLine}
- 严禁重复已生成列表中的任何情节或场景
- 不要输出任何解释文字，直接输出 JSON

原始剧本与任务说明：
${originalUserPrompt}`;
}

/**
 * 全文解说经典：仅按规则切分旁白入库，不调用 AI 生成分镜结构，不写 polished/video 提示词。
 */
async function processFullNarrationRulesStoryboardGeneration(
  db, log, cfg, taskId, episodeId, style, fullNarrationSegments, narrationLimits, episodeRow
) {
  const episodeIdNum = Number(episodeId);
  const limits = narrationLimits || DEFAULT_NARRATION_LIMITS;
  const segments = fullNarrationSegments || [];
  if (!segments.length) {
    throw new Error('剧本正文无法切分为解说段落');
  }

  const streamStyle = (style && String(style).trim()) || cfg?.style?.default_style || '';
  const streamVideoRatio = cfg?.style?.default_video_ratio || '16:9';
  const deriveOpts = {
    universalOmni: false,
    targetClipDuration: null,
    fullNarrationMode: true,
    narrationLimits: limits,
  };

  try {
    taskService.updateTaskStatus(db, taskId, 'processing', 15, '正在按规则切分旁白分镜...');

    purgeAllEpisodeStoryboards(db, log, episodeIdNum, resolveStorageRoot(loadConfig()));

    const dramaId = episodeRow?.drama_id;
    const defaultScene = dramaId
      ? db.prepare(
        'SELECT id, location, time FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1'
      ).get(dramaId)
      : null;

    const template = {
      title: '片头',
      location: defaultScene?.location || '',
      time: defaultScene?.time || '',
      scene_id: defaultScene?.id || null,
      action: '',
      atmosphere: '',
      dialogue: '',
      characters: [],
    };

    const storyboards = [{ ...template }];
    enforceFullNarrationSegments(storyboards, segments, log, taskId, limits);

    taskService.updateTaskStatus(db, taskId, 'processing', 50, '正在保存分镜头...');
    const saved = saveStoryboards(db, log, episodeId, storyboards, cfg, streamStyle, new Set(), deriveOpts);

    cleanupGhostStoryboardRows(db, log, episodeIdNum);
    enrichFullNarrationTitleShotInDb(db, log, episodeIdNum);
    propagateFullNarrationAssetsInDb(db, log, episodeIdNum);

    taskService.updateTaskStatus(db, taskId, 'processing', 75, '正在校验分镜角色与道具关联...');
    let totalCharAdded = 0;
    let totalPropAdded = 0;
    for (const sb of saved) {
      if (!sb?.id) continue;
      const { added } = syncStoryboardCharacters(db, log, sb.id);
      totalCharAdded += added.length;
      const propSync = syncStoryboardProps(db, log, sb.id);
      totalPropAdded += propSync.added.length;
      try {
        syncStoryboardCharacterLinksFromCharactersColumn(db, sb.id);
      } catch (_) {}
    }
    if (totalCharAdded > 0 || totalPropAdded > 0) {
      log.info('[分镜] 规则分镜角色/道具补全完成', {
        episode_id: episodeId,
        total_char_added: totalCharAdded,
        total_prop_added: totalPropAdded,
      });
    }

    const savedWithPrompts = getStoryboardsForEpisode(db, episodeIdNum);
    const totalDuration = savedWithPrompts.reduce((sum, sb) => sum + (Number(sb.duration) || 0), 0);

    taskService.updateTaskStatus(db, taskId, 'processing', 90, '正在更新剧集时长...');
    db.prepare('UPDATE episodes SET duration = ?, updated_at = ? WHERE id = ?').run(
      Math.ceil((totalDuration + 59) / 60),
      new Date().toISOString(),
      episodeIdNum
    );

    taskService.updateTaskResult(db, taskId, {
      storyboards: savedWithPrompts,
      total: savedWithPrompts.length,
      total_duration: totalDuration,
      duration_minutes: Math.ceil((totalDuration + 59) / 60),
      truncated: false,
      rules_only: true,
    });
    log.info('Full-narration rules storyboard generation completed', {
      task_id: taskId,
      episode_id: episodeId,
      count: savedWithPrompts.length,
    });
  } catch (err) {
    log.error('Full-narration rules storyboard generation failed', { error: err.message, task_id: taskId });
    taskService.updateTaskError(db, taskId, err.message || '规则分镜生成失败');
  }
}

/** 按旁白配音实际时长刷新 duration 后，AI 批量生成 polished_prompt + video_prompt */
async function generateStoryboardPromptsFromAudioDurationAsync(db, log, episodeId, opts = {}) {
  const episodeIdNum = Number(episodeId);
  if (!Number.isFinite(episodeIdNum) || episodeIdNum <= 0) {
    throw new Error('episode_id 无效');
  }

  const ep = db.prepare('SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(episodeIdNum);
  if (!ep) throw new Error('剧集不存在');

  const { isDramaFullNarrationVideoMode } = require('./videoClient');
  if (!isDramaFullNarrationVideoMode(db, ep.drama_id)) {
    throw new Error('仅全文解说经典模式支持按配音时长生成提示词');
  }

  const storageRoot = resolveStorageRoot(loadConfig());
  const { syncStoryboardDurationsFromNarrationAudio } = require('./narrationAudioService');
  const durationSync = syncStoryboardDurationsFromNarrationAudio(db, log, episodeIdNum, storageRoot);

  const rows = db
    .prepare(
      `SELECT id FROM storyboards
       WHERE episode_id = ? AND deleted_at IS NULL
         AND (creation_mode IS NULL OR creation_mode != 'universal')
       ORDER BY storyboard_number ASC`
    )
    .all(episodeIdNum);
  if (!rows.length) throw new Error('当前集尚无分镜');

  const force = opts.force !== false;
  let promptResult;
  if (force) {
    promptResult = await batchRebuildFullNarrationDualPromptsForEpisode(db, log, episodeIdNum, {
      taskId: opts.taskId,
      concurrency: opts.concurrency,
    });
  } else {
    promptResult = await completeMissingVideoPromptsForEpisode(db, log, episodeIdNum, opts);
  }

  propagateFullNarrationAssetsInDb(db, log, episodeIdNum);
  for (const row of rows) {
    try {
      syncStoryboardProps(db, log, row.id);
      syncStoryboardCharacterLinksFromCharactersColumn(db, row.id);
    } catch (_) {}
  }

  const saved = getStoryboardsForEpisode(db, episodeIdNum);
  const totalDuration = saved.reduce((s, sb) => s + (Number(sb.duration) || 0), 0);
  db.prepare('UPDATE episodes SET duration = ?, updated_at = ? WHERE id = ?').run(
    Math.ceil((totalDuration + 59) / 60),
    new Date().toISOString(),
    episodeIdNum
  );

  return {
    ...promptResult,
    duration_sync: durationSync,
    total_duration: totalDuration,
    storyboard_count: saved.length,
    storyboards: saved,
  };
}

async function processStoryboardGeneration(db, log, cfg, taskId, episodeId, model, style, userPrompt, systemPrompt, includeNarration, universalOmni, targetClipDurationSec = null, fullNarrationSegments = null, narrationLimits = DEFAULT_NARRATION_LIMITS) {
  const fullNarrationMode = Array.isArray(fullNarrationSegments) && fullNarrationSegments.length > 0;
  const limits = narrationLimits || DEFAULT_NARRATION_LIMITS;
  // 增量保存状态放在 try 外，catch 里可用于部分恢复
  const episodeIdNum = Number(episodeId);
  const streamSavedNums = new Set();
  const streamStyle = (style && String(style).trim()) || cfg?.style?.default_style || '';
  const streamVideoRatio = cfg?.style?.default_video_ratio || '16:9';
  const deriveOpts = {
    universalOmni: !!universalOmni,
    targetClipDuration: fullNarrationMode
      ? null
      : (targetClipDurationSec != null && Number(targetClipDurationSec) > 0 ? Number(targetClipDurationSec) : null),
    fullNarrationMode: !!fullNarrationMode,
    narrationLimits: limits,
  };
  let streamThrottle = 0;

  try {
    taskService.updateTaskStatus(db, taskId, 'processing', 10, '开始生成分镜头...');
    log.info('Processing storyboard generation', { task_id: taskId, episode_id: episodeId });
    log.info('Storyboard prompt preview', {
      user_prompt_len: userPrompt ? userPrompt.length : 0,
      system_prompt_len: systemPrompt ? systemPrompt.length : 0,
      user_prompt_head: userPrompt ? userPrompt.slice(0, 200) : '',
    });
    logDebugStoryboardPrompts(log, `task-${taskId}-initial`, userPrompt, systemPrompt);

    purgeAllEpisodeStoryboards(db, log, episodeIdNum, resolveStorageRoot(loadConfig()));

    // 不使用 json_mode：response_format:json_object 要求返回 JSON 对象而非数组，会导致模型包装成
    // {"storyboards":[...]} 或产生乱码 key，改由 extractFirstArray 统一处理任意包装格式。
    const text = await generateTextForStoryboard(db, log, userPrompt, systemPrompt, {
      model: model || undefined,
      // 每积累约 400 字符触发一次增量解析，尝试提前保存已完成的分镜
      streamCallback: (accumulated) => {
        if (accumulated.length - streamThrottle < 400) return;
        streamThrottle = accumulated.length;
        tryIncrementalSave(db, log, episodeIdNum, accumulated, streamSavedNums, streamStyle, streamVideoRatio, deriveOpts);
        // 同步更新任务进度（根据已保存分镜数量）
        if (streamSavedNums.size > 0) {
          taskService.updateTaskStatus(db, taskId, 'processing', 30,
            `已解析 ${streamSavedNums.size} 个分镜，生成中...`);
        }
      },
    });

    taskService.updateTaskStatus(db, taskId, 'processing', 50, '分镜头生成完成，正在解析结果...');

    log.info('AI raw response received', {
      task_id: taskId,
      text_type: typeof text,
      text_length: text ? String(text).length : 0,
      text_preview: text ? String(text).slice(0, 2000) : '(empty)',
    });

    let storyboards = [];
    const parseMeta = {};
    try {
      const parsed = safeParseAIJSON(text, null, log, parseMeta);
      storyboards = extractFirstArray(parsed) || [];
    } catch (e) {
      log.error('Parse storyboard JSON failed', {
        error: e.message,
        task_id: taskId,
        text_type: typeof text,
        text_length: text ? String(text).length : 0,
        raw_text: text ? String(text).slice(0, 2000) : '(empty)',
      });

      // 解析失败时，若流式增量保存已有部分分镜，视为截断的部分成功
      if (streamSavedNums.size > 0) {
        const partialBoards = getStoryboardsForEpisode(db, episodeIdNum);
        if (partialBoards.length > 0) {
          if (fullNarrationMode) {
            recoverFullNarrationFromPartial(
              db, log, episodeIdNum, taskId, fullNarrationSegments,
              `AI输出含JSON格式缺陷（${e.message}），已按剧本重新同步旁白分段`
            );
            log.warn('Parse failed; full-narration resync from partial incremental saves', {
              task_id: taskId, recovered_count: partialBoards.length, parse_error: e.message,
            });
            return;
          }
          const totalDuration = partialBoards.reduce((s, sb) => s + (Number(sb.duration) || 0), 0);
          log.warn('Parse failed but partial storyboards already saved incrementally, treating as truncated success', {
            task_id: taskId, recovered_count: partialBoards.length, parse_error: e.message,
          });
          taskService.updateTaskResult(db, taskId, {
            storyboards: partialBoards,
            total: partialBoards.length,
            total_duration: totalDuration,
            duration_minutes: Math.ceil((totalDuration + 59) / 60),
            truncated: true,
            error_message: `AI输出含JSON格式缺陷（${e.message}），已恢复 ${partialBoards.length} 个分镜`,
          });
          return;
        }
      }

      taskService.updateTaskError(db, taskId, '解析分镜头结果失败: ' + (e.message || ''));
      return;
    }

    if (storyboards.length === 0) {
      // 最终解析为空，但流式已保存了内容，同样回退使用增量结果
      if (streamSavedNums.size > 0) {
        const partialBoards = getStoryboardsForEpisode(db, episodeIdNum);
        if (partialBoards.length > 0) {
          if (fullNarrationMode) {
            recoverFullNarrationFromPartial(
              db, log, episodeIdNum, taskId, fullNarrationSegments,
              'AI 最终解析为空，已按剧本重新同步旁白分段'
            );
            log.warn('Final parse empty; full-narration resync from incremental saves', {
              task_id: taskId, recovered_count: partialBoards.length,
            });
            return;
          }
          const totalDuration = partialBoards.reduce((s, sb) => s + (Number(sb.duration) || 0), 0);
          log.warn('Final parse returned 0 items but incremental saves exist, using those', {
            task_id: taskId, recovered_count: partialBoards.length,
          });
          taskService.updateTaskResult(db, taskId, {
            storyboards: partialBoards,
            total: partialBoards.length,
            total_duration: totalDuration,
            duration_minutes: Math.ceil((totalDuration + 59) / 60),
            truncated: true,
          });
          return;
        }
      }
      log.error('AI returned 0 storyboards', { task_id: taskId });
      taskService.updateTaskError(db, taskId, 'AI生成分镜失败：返回的分镜数量为0');
      return;
    }

    if (parseMeta.truncated) {
      log.warn('Storyboard JSON was truncated by AI (max_tokens limit), will attempt continuation', {
        task_id: taskId, episode_id: episodeId,
        rescued_count: storyboards.length,
        raw_text_length: text ? String(text).length : 0,
      });
    }
    log.info('Storyboard initial parse', { task_id: taskId, episode_id: episodeId, count: storyboards.length, truncated: parseMeta.truncated || false });

    // ── 自动续写：若 AI 输出被截断，最多续写 3 次直到完整 ──────────────────
    const MAX_CONTINUATION = 3;
    let contAttempt = 0;
    while (parseMeta.truncated && storyboards.length > 0 && contAttempt < MAX_CONTINUATION) {
      contAttempt++;
      const lastShot = Math.max(...storyboards.map(s => Number(s.shot_number ?? s.storyboard_number) || 0));
      log.info('Storyboard continuation start', { task_id: taskId, attempt: contAttempt, last_shot: lastShot, current_count: storyboards.length });
      taskService.updateTaskStatus(db, taskId, 'processing', 50 + contAttempt * 5,
        `已生成 ${storyboards.length} 个分镜，正在续写剩余部分（第${contAttempt}次）...`);

      const contPrompt = buildContinuationPrompt(userPrompt, storyboards, lastShot, contAttempt, !!includeNarration, !!universalOmni, !!fullNarrationMode);
      logDebugStoryboardPrompts(log, `task-${taskId}-continuation-${contAttempt}`, contPrompt, systemPrompt);
      streamThrottle = 0; // 重置节流，让续写段落也能增量保存

      // 等待 3 秒后再发续写请求：避免流式请求刚结束服务端连接未释放导致 "socket hang up"
      await new Promise(r => setTimeout(r, 3000));

      let contText;
      try {
        contText = await generateTextForStoryboard(db, log, contPrompt, systemPrompt, {
          model: model || undefined,
          streamCallback: (accumulated) => {
            if (accumulated.length - streamThrottle < 400) return;
            streamThrottle = accumulated.length;
            tryIncrementalSave(db, log, episodeIdNum, accumulated, streamSavedNums, streamStyle, streamVideoRatio, deriveOpts);
          },
        });
      } catch (e) {
        log.warn('Continuation request failed', { task_id: taskId, attempt: contAttempt, error: e.message });
        break;
      }

      const contMeta = {};
      let contItems = [];
      try {
        const contParsed = safeParseAIJSON(contText, null, log, contMeta);
        contItems = extractFirstArray(contParsed) || [];
      } catch (e) {
        log.warn('Continuation parse failed', { task_id: taskId, attempt: contAttempt, error: e.message });
        break;
      }

      if (contItems.length === 0) {
        log.warn('Continuation returned 0 items', { task_id: taskId, attempt: contAttempt });
        break;
      }

      // 按 shot_number 去重，防止 AI 重复已生成的分镜
      const existingNums = new Set(storyboards.map((s) => normalizeStoryboardShotNumber(s)));
      const newItems = contItems.filter((s) => !existingNums.has(normalizeStoryboardShotNumber(s)));
      if (newItems.length === 0) {
        log.warn('Continuation returned only duplicate items', { task_id: taskId, attempt: contAttempt });
        break;
      }

      storyboards = [...storyboards, ...newItems];
      parseMeta.truncated = contMeta.truncated || false;
      log.info('Storyboard continuation done', {
        task_id: taskId, attempt: contAttempt,
        new_items: newItems.length, total_count: storyboards.length, still_truncated: parseMeta.truncated,
      });
    }
    // ── 续写结束 ────────────────────────────────────────────────────────────

    if (fullNarrationMode) {
      enforceFullNarrationSegments(storyboards, fullNarrationSegments, log, taskId, limits);
    }

    const totalDuration = storyboards.reduce((sum, sb) => sum + (Number(sb.duration) || 0), 0);
    if (parseMeta.truncated) {
      log.warn('Storyboard still truncated after max continuations', {
        task_id: taskId, final_count: storyboards.length, continuation_attempts: contAttempt,
      });
    }
    log.info('Storyboard generated', { task_id: taskId, episode_id: episodeId, count: storyboards.length, total_duration_seconds: totalDuration, truncated: parseMeta.truncated || false, continuation_attempts: contAttempt });

    taskService.updateTaskStatus(db, taskId, 'processing', 70, '正在保存分镜头...');

    // 传入 streamSavedNums：已增量保存的项目直接从 DB 读取，跳过重复 INSERT
    const saved = saveStoryboards(db, log, episodeId, storyboards, cfg, style, streamSavedNums, deriveOpts);

    if (fullNarrationMode) {
      cleanupGhostStoryboardRows(db, log, episodeIdNum);
      enrichFullNarrationTitleShotInDb(db, log, episodeIdNum);
      propagateFullNarrationAssetsInDb(db, log, episodeIdNum);
    }

    // ── 分镜角色/道具补全（字符串匹配，无 AI，只增不减；对齐 7b6c1a7 角色补全，并同样补道具）──
    taskService.updateTaskStatus(db, taskId, 'processing', 75, '正在校验分镜角色与道具关联...');
    let totalCharAdded = 0;
    let totalPropAdded = 0;
    for (const sb of saved) {
      if (!sb?.id) continue;
      const { added } = syncStoryboardCharacters(db, log, sb.id);
      totalCharAdded += added.length;
      const propSync = syncStoryboardProps(db, log, sb.id);
      totalPropAdded += propSync.added.length;
      try {
        syncStoryboardCharacterLinksFromCharactersColumn(db, sb.id);
      } catch (_) {}
    }
    if (totalCharAdded > 0 || totalPropAdded > 0) {
      log.info('[分镜] 角色/道具补全完成', {
        episode_id: episodeId,
        total_char_added: totalCharAdded,
        total_prop_added: totalPropAdded,
      });
    }

    // 全文解说经典：提示词改由「按配音时长生成」按钮单独触发，生成分镜时不跑 AI
    if (!fullNarrationMode) {
      taskService.updateTaskStatus(db, taskId, 'processing', 76, '正在 AI 生成各镜图片提示词 0/0...');
      await batchPolishStoryboardImagePromptsForEpisode(db, log, episodeIdNum, {
        taskId,
        concurrency: BATCH_IMAGE_PROMPT_CONCURRENCY,
        force: true,
      });
    }

    // 回读分镜，带上入库后写入的 polished_prompt（全文解说此时仍为空，待后续按钮生成）
    const savedWithPrompts = getStoryboardsForEpisode(db, episodeIdNum);

    taskService.updateTaskStatus(db, taskId, 'processing', 90, '正在更新剧集时长...');

    const durationMinutes = Math.ceil((totalDuration + 59) / 60);
    db.prepare('UPDATE episodes SET duration = ?, updated_at = ? WHERE id = ?').run(durationMinutes, new Date().toISOString(), Number(episodeId));
    log.info('Episode duration updated', { episode_id: episodeId, duration_seconds: totalDuration, duration_minutes: durationMinutes });

    const resultData = {
      storyboards: savedWithPrompts.length ? savedWithPrompts : saved,
      total: saved.length,
      total_duration: totalDuration,
      duration_minutes: durationMinutes,
      truncated: parseMeta.truncated || false,
    };
    taskService.updateTaskResult(db, taskId, resultData);
    log.info('Storyboard generation completed', { task_id: taskId, episode_id: episodeId });
  } catch (err) {
    log.error('Storyboard generation failed', { error: err.message, task_id: taskId });

    // 若连接中断（ECONNRESET 等）但已通过增量流式保存了部分分镜，视为部分成功而非彻底失败
    if (streamSavedNums.size > 0) {
      try {
        if (fullNarrationMode) {
          await recoverFullNarrationFromPartial(
            db, log, episodeIdNum, taskId, fullNarrationSegments,
            `连接中断（${err.message}），已恢复分镜并重新同步旁白`
          );
          log.warn('Partial storyboards recovered with full-narration resync', {
            task_id: taskId, error: err.message,
          });
          return;
        }
        const partialBoards = getStoryboardsForEpisode(db, episodeIdNum);
        if (partialBoards.length > 0) {
          const totalDuration = partialBoards.reduce((s, sb) => s + (Number(sb.duration) || 0), 0);
          log.warn('Partial storyboards recovered after error, treating as truncated success', {
            task_id: taskId, recovered_count: partialBoards.length, error: err.message,
          });
          taskService.updateTaskResult(db, taskId, {
            storyboards: partialBoards,
            total: partialBoards.length,
            total_duration: totalDuration,
            duration_minutes: Math.ceil((totalDuration + 59) / 60),
            truncated: true,
            error_message: `连接中断（${err.message}），已恢复 ${partialBoards.length} 个分镜`,
          });
          return;
        }
      } catch (_) {}
    }

    taskService.updateTaskError(db, taskId, (err.message || '生成分镜头失败'));
  }
}

function generateStoryboard(db, log, episodeId, model, style, storyboardCount, videoDuration, aspectRatio, includeNarration, universalOmni, fullNarrationVideoMode) {
  const cfg = loadConfig();
  const episode = db.prepare(
    'SELECT id, script_content, description, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(episodeId));
  if (!episode) {
    throw new Error('剧集不存在或无权限访问');
  }

  // 获取剧集风格和比例（如果未指定，则从 drama metadata / style 中获取完整提示词）
  const drama = db.prepare('SELECT style, metadata FROM dramas WHERE id = ?').get(episode.drama_id);
  const { resolvedStreamStyleFromDrama } = require('../utils/dramaStyleMerge');
  const finalStyle = resolvedStreamStyleFromDrama(style, drama);

  // 图片比例 + 每镜时长：优先用传入值，再从 drama.metadata 读，最后兜底全局配置
  let dramaAspectRatio = null;
  let videoClipDuration = null;
  let narrationLimits = DEFAULT_NARRATION_LIMITS;
  try {
    if (drama && drama.metadata) {
      const meta = typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata;
      if (meta && meta.aspect_ratio) dramaAspectRatio = meta.aspect_ratio;
      if (meta && meta.video_clip_duration) videoClipDuration = Number(meta.video_clip_duration) || null;
      narrationLimits = resolveFullNarrationLimits(meta?.narration_chars_per_sec);
    }
  } catch (_) {}
  const imageRatio = aspectRatio || dramaAspectRatio || cfg?.style?.default_video_ratio || '16:9';

  // 计算单镜建议时长（秒）：
  // 项目 metadata 中的 video_clip_duration（如 15 秒/段）优先于「总时长÷镜数」，
  // 否则前端同时传总时长+镜数时会把每镜压成过短（与「每段秒数」配置矛盾）。
  // 无项目配置时再使用总时长÷镜数；再否则 null。
  let effectiveShotDuration = null;
  const impliedFromTotal =
    videoDuration && storyboardCount
      ? Math.round(Number(videoDuration) / Number(storyboardCount))
      : null;
  if (videoClipDuration && Number(videoClipDuration) > 0) {
    effectiveShotDuration = Number(videoClipDuration);
  } else if (impliedFromTotal && impliedFromTotal > 0) {
    effectiveShotDuration = impliedFromTotal;
  } else {
    effectiveShotDuration = null;
  }

  let scriptContent = (episode.script_content && String(episode.script_content).trim())
    ? String(episode.script_content)
    : (episode.description && String(episode.description).trim())
      ? String(episode.description)
      : '';
  if (!scriptContent) {
    throw new Error('剧本内容为空，请先生成剧集内容');
  }

  const characters = db.prepare(
    'SELECT id, name FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY name ASC'
  ).all(episode.drama_id);
  let characterList = '无角色';
  if (characters.length > 0) {
    characterList = '[' + characters.map((c) => `{"id": ${c.id}, "name": "${(c.name || '').replace(/"/g, '\\"')}"}`).join(', ') + ']';
  }

  const scenes = db.prepare(
    'SELECT id, location, time FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY location ASC, time ASC'
  ).all(episode.drama_id);
  let sceneList = '无场景';
  if (scenes.length > 0) {
    sceneList = '[' + scenes.map((s) => `{"id": ${s.id}, "location": "${(s.location || '').replace(/"/g, '\\"')}", "time": "${(s.time || '').replace(/"/g, '\\"')}"}`).join(', ') + ']';
  }

  const props = db.prepare(
    'SELECT id, name, type FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(episode.drama_id);
  let propList = '无道具';
  if (props.length > 0) {
    propList = '[' + props.map((p) => `{"id": ${p.id}, "name": "${(p.name || '').replace(/"/g, '\\"')}"${p.type ? `, "type": "${p.type.replace(/"/g, '\\"')}"` : ''}}`).join(', ') + ']';
  }

  const scriptLabel = promptI18n.formatUserPrompt(cfg, 'script_content_label');
  const taskLabel = promptI18n.formatUserPrompt(cfg, 'task_label');
  const taskInstruction = promptI18n.formatUserPrompt(cfg, 'task_instruction');
  
  // 处理分镜数量和时长约束（仅用户显式指定时才作为硬约束）
  const userSpecifiedCount = storyboardCount != null && Number(storyboardCount) > 0;
  const userSpecifiedDuration = videoDuration != null && Number(videoDuration) > 0;
  let extraConstraint = '';
  if (userSpecifiedCount) {
    const countVal = Number(storyboardCount);
    if (Number.isFinite(countVal) && countVal > 0) {
      const countLabel = promptI18n.formatUserPrompt(cfg, 'storyboard_count_constraint', countVal);
      if (countLabel) extraConstraint += `\n${countLabel}`;
    }
  }
  if (userSpecifiedDuration) {
    const durationVal = Number(videoDuration);
    if (Number.isFinite(durationVal) && durationVal > 0) {
      const durationLabel = promptI18n.formatUserPrompt(cfg, 'video_duration_constraint', durationVal);
      if (durationLabel) extraConstraint += `\n${durationLabel}`;
    }
  }
  // 当同时指定总时长和数量时，补充单镜 duration 说明（与项目「每段秒数」一致时勿用总÷镜压短）
  if (userSpecifiedCount && userSpecifiedDuration && effectiveShotDuration) {
    const isEn = promptI18n.isEnglish(cfg);
    const clipFromProject = videoClipDuration && Number(videoClipDuration) > 0;
    const implied =
      impliedFromTotal && impliedFromTotal > 0 ? impliedFromTotal : Math.round(Number(videoDuration) / Number(storyboardCount));
    if (clipFromProject) {
      const clip = Number(videoClipDuration);
      if (isEn) {
        extraConstraint += `\nEach shot "duration" field: prioritize **~${clip}s per shot** (project clip-length setting); ±1s OK. Total ~${Number(videoDuration)}s and ~${Number(storyboardCount)} shots are overall planning hints—do NOT force every shot to ~${implied}s (total÷count) when it conflicts with the project clip length.`;
      } else {
        extraConstraint += `\n每个镜头的 **duration** 请优先按项目「每段约 **${clip} 秒**」填写（可 ±1 秒微调）。全片总时长约 ${Number(videoDuration)} 秒、镜头数约 ${Number(storyboardCount)} 为整体规划参考，**禁止**为机械凑「总时长÷镜数」（约 ${implied}s）而把每镜普遍写成过短镜头；除非该镜对白与动作为实需的极短镜头。`;
      }
    } else if (isEn) {
      extraConstraint += `\nEach shot target duration: approximately ${effectiveShotDuration}s (= total ${Number(videoDuration)}s ÷ ${Number(storyboardCount)} shots). Set each shot's duration field to this value, adjusting ±1s for dialogue/action length.`;
    } else {
      extraConstraint += `\n每镜头目标时长：约 ${effectiveShotDuration} 秒（= 总时长 ${Number(videoDuration)}s ÷ ${Number(storyboardCount)} 个镜头）。每个镜头的 duration 字段请设为此值，可根据对话/动作长短适当调整 ±1 秒。`;
    }
  }

  log.info('Storyboard generation params', {
    storyboard_count: userSpecifiedCount ? storyboardCount : null,
    video_duration: userSpecifiedDuration ? videoDuration : null,
    plot_driven: !userSpecifiedCount,
    video_clip_duration: videoClipDuration,
    effective_shot_duration: effectiveShotDuration,
  });

  const charListLabel = promptI18n.formatUserPrompt(cfg, 'character_list_label');
  const charConstraint = promptI18n.formatUserPrompt(cfg, 'character_constraint');
  const sceneListLabel = promptI18n.formatUserPrompt(cfg, 'scene_list_label');
  const sceneConstraint = promptI18n.formatUserPrompt(cfg, 'scene_constraint');
  const propListLabel = promptI18n.formatUserPrompt(cfg, 'prop_list_label');
  const propConstraint = promptI18n.formatUserPrompt(cfg, 'prop_constraint');

  const wantFullNarration =
    fullNarrationVideoMode === true ||
    fullNarrationVideoMode === 1 ||
    String(fullNarrationVideoMode || '').toLowerCase() === 'true';

  let durationMode = 'auto';
  if (userSpecifiedCount && userSpecifiedDuration && effectiveShotDuration) {
    durationMode = 'fixed';
  } else if (videoClipDuration && Number(videoClipDuration) > 0 && !wantFullNarration) {
    durationMode = 'preferred';
  }
  const suffixDuration =
    durationMode === 'fixed' || durationMode === 'preferred' ? effectiveShotDuration : null;

  const wantNarration =
    wantFullNarration ||
    includeNarration === true ||
    includeNarration === 1 ||
    String(includeNarration).toLowerCase() === 'true';

  const suffix = promptI18n.getStoryboardUserPromptSuffix(cfg, suffixDuration, durationMode, {
    includeNarration: wantNarration,
    fullNarration: wantFullNarration,
  });

  let fullNarrationSegments = null;
  if (wantFullNarration) {
    fullNarrationSegments = splitScriptIntoNarrationSegments(scriptContent, narrationLimits);
    const normScript = normalizeNarrationCoverageText(scriptContent);
    const normSegs = normalizeNarrationCoverageText((fullNarrationSegments || []).join(''));
    if (normScript && normSegs !== normScript) {
      log.warn('[分镜] 全文解说预切分未完整覆盖剧本正文', {
        script_chars: normScript.length,
        segment_chars: normSegs.length,
        segment_count: fullNarrationSegments?.length || 0,
      });
    }
  }

  let userPrompt =
    `${scriptLabel}\n${scriptContent}\n\n${taskLabel}\n${taskInstruction}${extraConstraint}\n\n${charListLabel}\n${characterList}\n\n${charConstraint}\n\n${sceneListLabel}\n${sceneList}\n\n${sceneConstraint}\n\n${propListLabel}\n${propList}\n\n${propConstraint}`;

  if (!userSpecifiedCount && !wantFullNarration) {
    userPrompt += promptI18n.getStoryboardPlotDrivenInstructions(cfg, {
      clipDuration: videoClipDuration && Number(videoClipDuration) > 0 ? Number(videoClipDuration) : null,
    });
    const taskInst = promptI18n.formatUserPrompt(cfg, 'task_instruction');
    const plotTask = promptI18n.isEnglish(cfg)
      ? 'Break down the script by **scenes and narrative beats**: merge continuous actions within the same scene into one shot; only split on scene changes, time jumps, or emotional turning points.'
      : '将剧本按**场景与叙事节拍**拆解为分镜头方案：同一场景内的连续动作优先合并为一镜，仅在场景切换、时间跳跃或情绪转折点拆出新镜头。';
    if (taskInst) userPrompt = userPrompt.replace(taskInst, plotTask);
  } else if (wantFullNarration) {
    const taskInst = promptI18n.formatUserPrompt(cfg, 'task_instruction');
    const fullTask = promptI18n.getStoryboardFullNarrationTaskInstruction(cfg);
    if (taskInst) userPrompt = userPrompt.replace(taskInst, fullTask);
    else userPrompt += `\n\n${fullTask}`;
  }

  userPrompt += `\n\n${suffix}`;

  if (wantFullNarration && fullNarrationSegments?.length) {
    userPrompt += buildFullNarrationSegmentBinding(cfg, fullNarrationSegments, narrationLimits);
    userPrompt += promptI18n.getStoryboardFullNarrationModeInstructions(cfg, {
      clipDuration: videoClipDuration && Number(videoClipDuration) > 0 ? Number(videoClipDuration) : null,
      scriptLength: scriptContent.length,
      narrationLimits,
    });
  } else if (wantNarration) {
    userPrompt += promptI18n.getStoryboardNarrationExtraInstructions(cfg);
  }

  let systemPrompt = promptI18n.getStoryboardSystemPrompt(cfg);

  if (!userSpecifiedCount && !wantFullNarration) {
    systemPrompt += `

【最高优先级——情节驱动分镜模式（覆盖上文冲突规则）】
用户未指定目标镜数。此模式下：
- **覆盖**任何「一动作一镜、禁止合并、镜头数=独立动作数」的要求；
- 按场景+叙事节拍拆镜，同场景连续动作合并（action 内可写多切镜）；
- 一集短剧优先控制在约 8–25 镜；无充分理由不要产出 30 镜以上。`;
  }

  // 当用户显式指定分镜数量时，在系统提示词后追加最高优先级覆盖指令
  if (userSpecifiedCount && !wantFullNarration) {
    const targetCount = Number(storyboardCount);
    const isEn = systemPrompt.includes('[Role]');
    if (isEn) {
      systemPrompt += `\n\n[HIGHEST PRIORITY — USER SPECIFIED COUNT]
The user requires exactly ${targetCount} shots (±10% tolerance is acceptable).
This requirement OVERRIDES the "one action = one shot, no merging" rule above.
You MUST merge related consecutive actions into fewer shots OR split key moments into more shots to reach this target.
Do NOT produce a shot count far from ${targetCount} under any circumstance.`;
    } else {
      systemPrompt += `\n\n【最高优先级——用户指定分镜数量】
用户要求生成恰好 ${targetCount} 个分镜（允许 ±10% 的偏差，即 ${Math.floor(targetCount * 0.9)}~${Math.ceil(targetCount * 1.1)} 个均可接受）。
此要求优先级高于上述所有原则，包括"一动作一镜头、禁止合并"的规则。
- 若动作较多、自然拆分超过目标数量，请将相关联的连续小动作合并为一个镜头
- 若动作较少、自然拆分不足目标数量，请将重要场景或情绪转折拆分为多个镜头
- 严禁生成数量与 ${targetCount} 相差悬殊的分镜方案`;
    }
  }

  if (wantFullNarration) {
    systemPrompt += promptI18n.getStoryboardFullNarrationSystemOverride(cfg, { narrationLimits });
  } else if (wantNarration) {
    const isEn = systemPrompt.includes('[Role]');
    if (isEn) {
      systemPrompt += `\n\n[HIGHEST PRIORITY — NARRATION / VO MODE]
The user enabled narrator voice-over for the whole episode. Every shot object MUST include non-empty "narration" (≥1 sentence). Shot 1 MUST have an opening VO hook (time/place/mood). Shots 1 and 2 MUST NOT both have empty narration. Empty "narration" is NOT allowed in this mode.`;
    } else {
      systemPrompt += `\n\n【最高优先级——解说旁白已开启】
用户已开启全片解说：每个分镜的 narration 必须为非空字符串（至少一句）。第 1 镜必须有开场解说。第 1、2 镜禁止同时留空 narration。本模式下不允许 narration 为空。`;
    }
  }

  const wantUniversalOmni =
    universalOmni === true ||
    universalOmni === 1 ||
    String(universalOmni || '').toLowerCase() === 'true';
  if (wantUniversalOmni) {
    systemPrompt += promptI18n.getStoryboardUniversalOmniModeSuffix(cfg);
  }

  const task = taskService.createTask(db, log, 'storyboard_generation', String(episodeId));
  log.info('Generating storyboard asynchronously', {
    task_id: task.id,
    episode_id: episodeId,
    drama_id: episode.drama_id,
    script_length: scriptContent.length,
    character_count: characters.length,
    scene_count: scenes.length,
    storyboard_count: userSpecifiedCount ? storyboardCount : undefined,
    video_duration: userSpecifiedDuration ? videoDuration : undefined,
    universal_omni_storyboard: wantUniversalOmni,
    full_narration_video_mode: wantFullNarration,
    include_narration: wantNarration,
    full_narration_segment_count: fullNarrationSegments?.length || 0,
  });

  setImmediate(() => {
    // 传入 imageRatio 同时覆盖 default_video_ratio 和 default_image_ratio，
    // 确保分镜图/视频提示词、场景提取提示词都使用项目设定的比例
    const runCfg = { ...cfg, style: { ...(cfg?.style || {}), default_video_ratio: imageRatio, default_image_ratio: imageRatio } };
    const clipSec =
      videoClipDuration && Number(videoClipDuration) > 0 ? Number(videoClipDuration) : null;
    // 全文解说经典也走 AI 分镜（对齐 7b6c1a7）：由模型填写 scene_id / characters / props，
    // 入库后再用 enforceFullNarrationSegments 锁定旁白切段；不再用「空角色空道具」的纯规则壳。
    // 如果 model 为 null，则传 undefined，让 generateText 内部去兜底找默认配置
    processStoryboardGeneration(
      db,
      log,
      runCfg,
      task.id,
      String(episodeId),
      model || undefined,
      finalStyle,
      userPrompt,
      systemPrompt,
      wantNarration,
      wantUniversalOmni,
      clipSec,
      fullNarrationSegments,
      narrationLimits
    );
  });

  return { task_id: task.id, status: 'pending', message: '分镜生成任务已创建，正在后台处理...' };
}


function rebuildVideoPromptForStoryboard(db, log, storyboardId, opts = {}) {
  return rebuildVideoPromptForStoryboardAsync(db, log, storyboardId, opts);
}

async function rebuildVideoPromptForStoryboardAsync(db, log, storyboardId, opts = {}) {
  const sbId = Number(storyboardId);
  if (!Number.isFinite(sbId) || sbId <= 0) return null;

  const row = db.prepare(
    `SELECT s.*, e.drama_id
     FROM storyboards s
     JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
     WHERE s.id = ? AND s.deleted_at IS NULL`
  ).get(sbId);
  if (!row) return null;

  const loadConfig = require('../config').loadConfig;
  const cfg = loadConfig();
  const drama = row.drama_id
    ? db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(row.drama_id)
    : null;
  const { resolvedStreamStyleFromDrama } = require('../utils/dramaStyleMerge');
  const finalStyle = resolvedStreamStyleFromDrama('', drama) || cfg?.style?.default_style || '';

  let dramaAspectRatio = null;
  try {
    if (drama?.metadata) {
      const meta = typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata;
      if (meta?.aspect_ratio) dramaAspectRatio = meta.aspect_ratio;
    }
  } catch (_) {}

  const videoRatio = dramaAspectRatio || cfg?.style?.default_video_ratio || '16:9';

  let videoPrompt = '';
  let source = 'rule';
  const { isFullNarrationClassicStoryboard, generateClassicVideoPromptWithAi } = require('./classicVideoPromptBundle');
  const useAi =
    !opts.forceRuleBased &&
    isFullNarrationClassicStoryboard(db, row);

  if (useAi) {
    try {
      const { text } = await generateClassicVideoPromptWithAi(db, log, row, {
        mode: 'generate',
        userInstruction: opts.userInstruction,
      });
      videoPrompt = text;
      source = 'ai_full_narration';
    } catch (err) {
      if (log?.warn) {
        log.warn('[分镜] 全文解说 AI 生成 video_prompt 失败，回退规则拼装', {
          id: sbId,
          error: err.message,
        });
      }
      videoPrompt = generateVideoPrompt(row, finalStyle, videoRatio);
      source = 'rule_fallback';
    }
  } else {
    videoPrompt = generateVideoPrompt(row, finalStyle, videoRatio);
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE storyboards SET video_prompt = ?, updated_at = ? WHERE id = ?').run(videoPrompt, now, sbId);

  if (log?.info) {
    log.info('[分镜] 已重建 video_prompt', {
      id: sbId,
      len: videoPrompt.length,
      source,
    });
  }

  const storyboardService = require('./storyboardService');
  const sb = storyboardService.getStoryboardById(db, sbId);
  if (sb) sb.video_prompt_source = source;
  return sb;
}

function batchVideoPromptProgressPercent(completed, total) {
  if (!total || total <= 0) return BATCH_VIDEO_PROMPT_PROGRESS_START;
  const ratio = Math.min(1, Math.max(0, completed / total));
  const span = BATCH_VIDEO_PROMPT_PROGRESS_END - BATCH_VIDEO_PROMPT_PROGRESS_START;
  return BATCH_VIDEO_PROMPT_PROGRESS_START + Math.floor(ratio * span);
}


async function rebuildFullNarrationDualPromptsForStoryboardAsync(db, log, storyboardId, opts = {}) {
  const sbId = Number(storyboardId);
  if (!Number.isFinite(sbId) || sbId <= 0) return null;

  const row = db.prepare(
    `SELECT s.*, e.drama_id
     FROM storyboards s
     JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
     WHERE s.id = ? AND s.deleted_at IS NULL`
  ).get(sbId);
  if (!row) return null;

  const {
    isFullNarrationClassicStoryboard,
    generateFullNarrationDualPromptsWithAi,
    generateClassicVideoPromptWithAi,
  } = require('./classicVideoPromptBundle');

  if (!isFullNarrationClassicStoryboard(db, row)) {
    // 非全文解说：退回仅视频重建
    return rebuildVideoPromptForStoryboardAsync(db, log, sbId, opts);
  }

  const loadConfig = require('../config').loadConfig;
  const cfg = loadConfig();
  const drama = row.drama_id
    ? db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(row.drama_id)
    : null;
  const { resolvedStreamStyleFromDrama } = require('../utils/dramaStyleMerge');
  const finalStyle = resolvedStreamStyleFromDrama('', drama) || cfg?.style?.default_style || '';
  let dramaAspectRatio = null;
  try {
    if (drama?.metadata) {
      const meta = typeof drama.metadata === 'string' ? JSON.parse(drama.metadata) : drama.metadata;
      if (meta?.aspect_ratio) dramaAspectRatio = meta.aspect_ratio;
    }
  } catch (_) {}
  const videoRatio = dramaAspectRatio || cfg?.style?.default_video_ratio || '16:9';

  let polished = '';
  let videoPrompt = '';
  let source = 'dual_ai';

  try {
    const dual = await generateFullNarrationDualPromptsWithAi(db, log, row, {
      userInstruction: opts.userInstruction,
    });
    polished = dual.polished_prompt || '';
    videoPrompt = dual.video_prompt || '';
  } catch (err) {
    if (log?.warn) {
      log.warn('[分镜] 双提示词一次生成失败，回退分拆生成', { id: sbId, error: err.message });
    }
    source = 'fallback_split';
    try {
      const { text } = await generateClassicVideoPromptWithAi(db, log, row, {
        mode: 'generate',
        userInstruction: opts.userInstruction,
      });
      videoPrompt = text;
    } catch (e2) {
      videoPrompt = generateVideoPrompt(row, finalStyle, videoRatio);
      source = 'rule_fallback';
      if (log?.warn) log.warn('[分镜] 双提示词回退视频 AI 失败，用规则拼装', { id: sbId, error: e2.message });
    }
    try {
      const { polishStoryboardImagePrompt } = require('./storyboardImagePromptBundle');
      const imgOut = await polishStoryboardImagePrompt(db, log, sbId, { force: true });
      polished = imgOut.polished_prompt || '';
    } catch (e3) {
      if (log?.warn) log.warn('[分镜] 双提示词回退图片润色失败', { id: sbId, error: e3.message });
      polished = (row.image_prompt && String(row.image_prompt).trim()) || '';
    }
  }

  if (!videoPrompt || String(videoPrompt).trim().length < 12) {
    videoPrompt = generateVideoPrompt(row, finalStyle, videoRatio);
    if (source === 'dual_ai') source = 'dual_ai_video_rule_fill';
  }

  const now = new Date().toISOString();
  if (polished && String(polished).trim().length >= 10) {
    db.prepare(
      'UPDATE storyboards SET polished_prompt = ?, video_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(String(polished).trim(), String(videoPrompt).trim(), now, sbId);
  } else {
    db.prepare(
      'UPDATE storyboards SET video_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).run(String(videoPrompt).trim(), now, sbId);
  }

  if (log?.info) {
    log.info('[分镜] 已写入双提示词', {
      id: sbId,
      source,
      polished_len: (polished || '').length,
      video_len: (videoPrompt || '').length,
    });
  }

  const storyboardService = require('./storyboardService');
  const sb = storyboardService.getStoryboardById(db, sbId);
  if (sb) {
    sb.video_prompt_source = source;
    sb.dual_prompt_source = source;
  }
  return sb;
}

function batchDualPromptProgressPercent(completed, total) {
  const start = 76;
  const end = 89;
  if (!total || total <= 0) return start;
  const ratio = Math.min(1, Math.max(0, completed / total));
  return start + Math.floor(ratio * (end - start));
}

/** 全文解说经典：一次 AI 并发生成各镜 polished_prompt + video_prompt */
async function batchRebuildFullNarrationDualPromptsForEpisode(db, log, episodeId, opts = {}) {
  const episodeIdNum = Number(episodeId);
  if (!Number.isFinite(episodeIdNum) || episodeIdNum <= 0) {
    return { rebuilt: 0, failed: 0, total: 0 };
  }

  const rows = db
    .prepare(
      `SELECT id FROM storyboards
       WHERE episode_id = ? AND deleted_at IS NULL
         AND (creation_mode IS NULL OR creation_mode != 'universal')
       ORDER BY storyboard_number ASC`
    )
    .all(episodeIdNum);

  const total = rows.length;
  const taskId = opts.taskId != null ? String(opts.taskId) : null;
  const concurrency = Math.max(1, Number(opts.concurrency) || BATCH_VIDEO_PROMPT_CONCURRENCY);

  const reportProgress = (completed) => {
    if (!taskId) return;
    const progress = batchDualPromptProgressPercent(completed, total);
    taskService.updateTaskStatus(
      db,
      taskId,
      'processing',
      progress,
      `正在 AI 生成各镜图+视频提示词 ${completed}/${total}...`
    );
  };

  if (total === 0) {
    reportProgress(0);
    return { rebuilt: 0, failed: 0, total: 0 };
  }

  reportProgress(0);

  const { succeeded, failed, results } = await runConcurrentPool(
    rows,
    concurrency,
    async (row) => rebuildFullNarrationDualPromptsForStoryboardAsync(db, log, row.id),
    ({ completed }) => reportProgress(completed)
  );

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (r?.ok) continue;
    if (log?.warn) {
      log.warn('[分镜] 批量双提示词失败', {
        storyboard_id: rows[i]?.id,
        error: r?.error?.message || 'unknown',
      });
    }
  }

  reportProgress(total);
  if (log?.info) {
    log.info('[分镜] 批量双提示词完成', {
      episode_id: episodeIdNum,
      rebuilt: succeeded,
      failed,
      total,
      concurrency,
    });
  }
  return { rebuilt: succeeded, failed, total };
}

async function batchRebuildClassicVideoPromptsForEpisode(db, log, episodeId, opts = {}) {
  const episodeIdNum = Number(episodeId);
  if (!Number.isFinite(episodeIdNum) || episodeIdNum <= 0) return { rebuilt: 0, failed: 0, total: 0 };

  const rows = db
    .prepare(
      `SELECT id FROM storyboards
       WHERE episode_id = ? AND deleted_at IS NULL
         AND (creation_mode IS NULL OR creation_mode != 'universal')
       ORDER BY storyboard_number ASC`
    )
    .all(episodeIdNum);

  const total = rows.length;
  const taskId = opts.taskId != null ? String(opts.taskId) : null;
  const concurrency = Math.max(1, Number(opts.concurrency) || BATCH_VIDEO_PROMPT_CONCURRENCY);

  const reportProgress = (completed) => {
    if (!taskId) return;
    const progress = batchVideoPromptProgressPercent(completed, total);
    taskService.updateTaskStatus(
      db,
      taskId,
      'processing',
      progress,
      `正在 AI 生成各镜视频提示词 ${completed}/${total}...`
    );
  };

  if (total === 0) {
    reportProgress(0);
    return { rebuilt: 0, failed: 0, total: 0 };
  }

  reportProgress(0);

  const { succeeded, failed, results } = await runConcurrentPool(
    rows,
    concurrency,
    async (row) => rebuildVideoPromptForStoryboardAsync(db, log, row.id),
    ({ completed }) => reportProgress(completed)
  );

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    if (r?.ok) continue;
    const row = rows[i];
    if (log?.warn) {
      log.warn('[分镜] 批量重建 video_prompt 失败', {
        storyboard_id: row?.id,
        error: r?.error?.message || 'unknown',
      });
    }
  }

  reportProgress(total);

  if (log?.info) {
    log.info('[分镜] 批量 AI 重建 video_prompt 完成', {
      episode_id: episodeIdNum,
      rebuilt: succeeded,
      failed,
      total,
      concurrency,
    });
  }

  return { rebuilt: succeeded, failed, total };
}

const SB_PROMPT_MIN_POLISHED_LEN = 10;
const SB_PROMPT_MIN_VIDEO_LEN = 12;

/** 仅为缺少 video_prompt（全文解说经典时含 polished_prompt）的分镜补全提示词 */
async function completeMissingVideoPromptsForEpisode(db, log, episodeId, opts = {}) {
  const episodeIdNum = Number(episodeId);
  if (!Number.isFinite(episodeIdNum) || episodeIdNum <= 0) {
    return { rebuilt: 0, failed: 0, skipped: 0, total: 0, targets: 0 };
  }

  const { isFullNarrationClassicStoryboard } = require('./classicVideoPromptBundle');
  const rows = db
    .prepare(
      `SELECT s.*, e.drama_id
       FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
       WHERE s.episode_id = ? AND s.deleted_at IS NULL
         AND (s.creation_mode IS NULL OR s.creation_mode != 'universal')
       ORDER BY s.storyboard_number ASC`
    )
    .all(episodeIdNum);

  const targets = rows.filter((row) => {
    const vp = String(row.video_prompt || '').trim();
    const needVideo = vp.length < SB_PROMPT_MIN_VIDEO_LEN;
    const needPolished =
      isFullNarrationClassicStoryboard(db, row) &&
      String(row.polished_prompt || '').trim().length < SB_PROMPT_MIN_POLISHED_LEN;
    return needVideo || needPolished;
  });

  const skipped = rows.length - targets.length;
  if (!targets.length) {
    return { rebuilt: 0, failed: 0, skipped, total: rows.length, targets: 0 };
  }

  const concurrency = Math.max(1, Number(opts.concurrency) || BATCH_VIDEO_PROMPT_CONCURRENCY);
  const { succeeded, failed } = await runConcurrentPool(
    targets,
    concurrency,
    async (row) => {
      if (isFullNarrationClassicStoryboard(db, row)) {
        return rebuildFullNarrationDualPromptsForStoryboardAsync(db, log, row.id, opts);
      }
      return rebuildVideoPromptForStoryboardAsync(db, log, row.id, opts);
    }
  );

  if (log?.info) {
    log.info('[分镜] 补全缺失视频提示词完成', {
      episode_id: episodeIdNum,
      rebuilt: succeeded,
      failed,
      skipped,
      targets: targets.length,
    });
  }

  return { rebuilt: succeeded, failed, skipped, total: rows.length, targets: targets.length };
}

function copyStoryboardAssetLinks(db, fromSbId, toSbId) {
  const from = Number(fromSbId);
  const to = Number(toSbId);
  const now = new Date().toISOString();
  try {
    const chars = db.prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ?').all(from);
    const insC = db.prepare(
      'INSERT OR IGNORE INTO storyboard_characters (storyboard_id, character_id, created_at) VALUES (?, ?, ?)'
    );
    for (const c of chars) insC.run(to, c.character_id, now);
  } catch (_) {}
  try {
    const props = db.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id = ?').all(from);
    const insP = db.prepare('INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)');
    for (const p of props) insP.run(to, p.prop_id);
  } catch (_) {}
}

function durationForSplitSegment(type, text) {
  const w = charSpeechWeight(text);
  if (type === 'narration') return Math.min(12, Math.max(6, Math.round(w + 2)));
  return Math.min(10, Math.max(5, Math.round(w)));
}

function buildSplitPlansFromStoryboard(row) {
  const dialogueEntries = parseDialogueToEntries(row.dialogue);
  const narrationText = row.narration != null ? String(row.narration).trim() : '';
  const segmentCount = dialogueEntries.length + (narrationText ? 1 : 0);
  if (segmentCount < 2) {
    throw new Error('当前分镜仅有一段对白或旁白，无需拆镜');
  }
  if (dialogueEntries.length === 0 && narrationText) {
    throw new Error('仅有旁白无法按对白拆镜');
  }

  const allSpeakers = dialogueEntries.map((d) => d.speaker).filter(Boolean);
  const plans = [];

  for (const { speaker, text } of dialogueEntries) {
    const who = speaker || '角色';
    const others = allSpeakers.filter((n) => n && n !== who);
    const closed = others.length ? others.join('、') : '对方';
    const isReporter = /记者/.test(who) || who === '小雅';
    plans.push({
      type: 'dialogue',
      speaker: who,
      dialogue: `${who}：${text}`,
      narration: null,
      title: `${(row.title || '分镜').trim()}·${who}对白`,
      duration: durationForSplitSegment('dialogue', text),
      action: isReporter
        ? `采访场景，${who}面向对方发问，仅${who}开口说话，${closed}闭口聆听无口型。`
        : `镜头聚焦${who}，仅${who}开口对口型说话，${closed}全程闭口无口型。`,
      result: isReporter ? `${closed}保持静默聆听。` : `${who}完成台词，情绪鲜明。`,
      shot_type: isReporter ? row.shot_type || '中景' : '近景',
      movement: isReporter ? row.movement || '固定' : '推镜',
    });
  }

  if (narrationText) {
    const focus =
      inferPrimaryOnScreenCharacter(
        { action: row.action, result: row.result, title: row.title, dialogue: row.dialogue },
        allSpeakers
      ) || allSpeakers[allSpeakers.length - 1] || '角色';
    plans.push({
      type: 'narration',
      speaker: null,
      dialogue: null,
      narration: narrationText,
      title: `${(row.title || '分镜').trim()}·画外旁白`,
      duration: durationForSplitSegment('narration', narrationText),
      action: `${focus}在画面中保持静止，双唇闭合，无口型，听画外纪录片旁白。`,
      result: `${focus}表情维持强硬自信，无唇动。`,
      shot_type: '近景',
      movement: row.movement || '固定',
    });
  }

  return plans;
}

function persistSplitStoryboardRow(db, episodeId, storyboardNumber, baseRow, plan, now) {
  const info = db.prepare(
    `INSERT INTO storyboards (
      episode_id, scene_id, storyboard_number, title, description, layout_description,
      location, time, duration, dialogue, narration, action, result, atmosphere,
      image_prompt, characters, shot_type, angle, angle_h, angle_v, angle_s,
      movement, lighting_style, depth_of_field, segment_index, segment_title,
      creation_mode, universal_segment_text, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    episodeId,
    baseRow.scene_id ?? null,
    storyboardNumber,
    plan.title,
    baseRow.description ?? null,
    baseRow.layout_description ?? null,
    baseRow.location ?? null,
    baseRow.time ?? null,
    plan.duration,
    plan.dialogue,
    plan.narration,
    plan.action,
    plan.result,
    baseRow.atmosphere ?? null,
    baseRow.image_prompt ?? null,
    baseRow.characters ?? null,
    plan.shot_type ?? baseRow.shot_type ?? null,
    baseRow.angle ?? null,
    baseRow.angle_h ?? null,
    baseRow.angle_v ?? null,
    baseRow.angle_s ?? null,
    plan.movement ?? baseRow.movement ?? null,
    baseRow.lighting_style ?? null,
    baseRow.depth_of_field ?? null,
    baseRow.segment_index ?? null,
    baseRow.segment_title ?? null,
    baseRow.creation_mode === 'universal' ? 'universal' : 'classic',
    null,
    now,
    now
  );
  return info.lastInsertRowid;
}

function updateStoryboardAsSplitSegment(db, sbId, baseRow, plan, now) {
  db.prepare(
    `UPDATE storyboards SET
      title = ?, duration = ?, dialogue = ?, narration = ?, action = ?, result = ?,
      shot_type = ?, movement = ?, universal_segment_text = NULL,
      video_prompt = NULL, video_url = NULL, audio_local_path = NULL,
      narration_audio_local_path = NULL, status = 'pending', updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`
  ).run(
    plan.title,
    plan.duration,
    plan.dialogue,
    plan.narration,
    plan.action,
    plan.result,
    plan.shot_type ?? baseRow.shot_type ?? null,
    plan.movement ?? baseRow.movement ?? null,
    now,
    sbId
  );
}

/**
 * 按对白/旁白拆成多条分镜（每条仅一人说话或仅旁白），解决多角色同镜串音。
 * @returns {{ source_id, storyboard_ids, created_count, plans_summary }}
 */
function splitStoryboardByAudio(db, log, storyboardId) {
  return splitStoryboardByAudioAsync(db, log, storyboardId);
}

async function splitStoryboardByAudioAsync(db, log, storyboardId) {
  const sbId = Number(storyboardId);
  if (!Number.isFinite(sbId) || sbId <= 0) throw new Error('无效的分镜 id');

  const row = db
    .prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL')
    .get(sbId);
  if (!row) throw new Error('分镜不存在');

  const plans = buildSplitPlansFromStoryboard(row);
  const extraCount = plans.length - 1;
  const now = new Date().toISOString();
  const episodeId = row.episode_id;
  const baseNumber = Number(row.storyboard_number) || 0;

  if (extraCount > 0) {
    db.prepare(
      `UPDATE storyboards SET storyboard_number = storyboard_number + ?, updated_at = ?
       WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL`
    ).run(extraCount, now, episodeId, baseNumber);
  }

  const storyboardIds = [];
  updateStoryboardAsSplitSegment(db, sbId, row, plans[0], now);
  storyboardIds.push(sbId);

  for (let i = 1; i < plans.length; i++) {
    const newNum = baseNumber + i;
    const newId = persistSplitStoryboardRow(db, episodeId, newNum, row, plans[i], now);
    copyStoryboardAssetLinks(db, sbId, newId);
    storyboardIds.push(newId);
  }

  for (const id of storyboardIds) {
    await rebuildVideoPromptForStoryboardAsync(db, log, id);
  }

  const summary = plans.map((p) => `${p.duration}s ${p.title}`).join('；');
  if (log?.info) {
    log.info('[分镜] 按对白拆镜完成', { source_id: sbId, storyboard_ids: storyboardIds, plans: summary });
  }

  const storyboardService = require('./storyboardService');
  return {
    source_id: sbId,
    storyboard_ids: storyboardIds,
    created_count: extraCount,
    plans_summary: summary,
    storyboards: storyboardIds.map((id) => storyboardService.getStoryboardById(db, id)),
  };
}

module.exports = {
  normalizeStoryboardShotNumber,
  dedupeStoryboardRowsByNumber,
  splitScriptIntoNarrationSegments,
  mergeShortNarrationSegments,
  enforceFullNarrationSegments,
  resyncFullNarrationForEpisode,
  resyncFullNarrationForEpisodeAsync,
  countNarrationSpeechChars,
  estimateDurationFromSpeechText,
  NARRATION_CHARS_PER_SEC,
  FULL_NARRATION_TARGET_SEC,
  FULL_NARRATION_TARGET_CHARS,
  FULL_NARRATION_MIN_SEC,
  FULL_NARRATION_MAX_SEC,
  FULL_NARRATION_DURATION_MIN_SEC,
  FULL_NARRATION_MIN_CHARS,
  FULL_NARRATION_MAX_CHARS,
  resolveFullNarrationLimits,
  getNarrationLimitsForEpisode,
  normalizeNarrationCoverageText,
  getStoryboardsForEpisode,
  generateStoryboard,
  /** 与分镜入库时一致的「视频提示词」拼装（供经典模式润色等复用） */
  composeStoryboardVideoPrompt: generateVideoPrompt,
  rebuildVideoPromptForStoryboard,
  rebuildVideoPromptForStoryboardAsync,
  batchRebuildClassicVideoPromptsForEpisode,
  batchRebuildFullNarrationDualPromptsForEpisode,
  completeMissingVideoPromptsForEpisode,
  generateStoryboardPromptsFromAudioDurationAsync,
  rebuildFullNarrationDualPromptsForStoryboardAsync,
  splitStoryboardByAudio,
  splitStoryboardByAudioAsync,
};
