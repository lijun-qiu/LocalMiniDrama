const angleService = require('./angleService');
const promptI18n = require('./promptI18n');
const aiClient = require('./aiClient');
const { isDramaFullNarrationVideoMode } = require('./videoClient');

function composeStoryboardVideoPrompt(sb, style, videoRatio) {
  return require('./episodeStoryboardService').composeStoryboardVideoPrompt(sb, style, videoRatio);
}

function clipClassicCtx(s, maxLen) {
  if (s == null) return '';
  const t = String(s).trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

function extractRetentionClausesFromVideoPrompts(draft, composed) {
  const seen = new Set();
  const out = [];
  const sources = [draft, composed].map((x) => (x != null ? String(x).trim() : '')).filter(Boolean);
  for (const full of sources) {
    const pieces = full
      .replace(/\r\n/g, '\n')
      .trim()
      .split(/。+/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (let piece of pieces) {
      piece = piece.replace(/\s*=\s*VideoRatio\s*:/gi, '=VideoRatio:').trim();
      if (!piece) continue;
      const labeled = /^(场景|镜头标题|动作|对话|对白|结果|景别|镜头角度|运镜|氛围|情绪|情绪强度|配乐|音效|时长|风格|解说旁白)[：:]/.test(
        piece
      );
      const hasRatio = /=VideoRatio\s*:/i.test(piece);
      if (!labeled && !hasRatio) continue;
      const dedupKey = piece.slice(0, 140);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      let c = piece;
      if (/^镜头角度/.test(c) && c.length > 920) c = `${c.slice(0, 920)}…`;
      else if (c.length > 560) c = `${c.slice(0, 560)}…`;
      if (!/[。．…]$/.test(c)) c += '。';
      out.push(c);
    }
  }
  return out;
}

const MOVEMENT_LABEL_ZH = {
  static: '固定镜头',
  push: '推镜',
  pull: '拉镜',
  pan: '横摇',
  tilt: '纵摇',
  tracking: '跟镜',
  crane_up: '升镜',
  crane_dn: '降镜',
  orbit: '环绕',
  handheld: '手持',
};

const LIGHTING_LABEL_ZH = {
  natural: '自然光',
  front: '顺光',
  side: '侧光',
  backlit: '逆光',
  top: '顶光',
  under: '底光',
  soft: '柔光',
  dramatic: '戏剧光',
  golden_hour: '黄金时段',
  blue_hour: '蓝调时刻',
  night: '夜景',
  neon: '霓虹',
};

const DEPTH_LABEL_ZH = {
  extreme_shallow: '极浅景深',
  shallow: '浅景深',
  medium: '中景深',
  deep: '深景深（全焦）',
};

function movementDisplay(sbRow) {
  const raw = sbRow.movement != null ? String(sbRow.movement).trim() : '';
  if (!raw) return '';
  const zh = MOVEMENT_LABEL_ZH[raw];
  return zh ? `${zh}（${raw}）` : raw;
}

function lightingDisplay(sbRow) {
  const raw = sbRow.lighting_style != null ? String(sbRow.lighting_style).trim() : '';
  if (!raw) return '';
  const zh = LIGHTING_LABEL_ZH[raw];
  return zh ? `${zh}（${raw}）` : raw;
}

function depthDisplay(sbRow) {
  const raw = sbRow.depth_of_field != null ? String(sbRow.depth_of_field).trim() : '';
  if (!raw) return '';
  const zh = DEPTH_LABEL_ZH[raw];
  return zh ? `${zh}（${raw}）` : raw;
}

function angleCoverageLine(sbRow) {
  if (sbRow.angle_h && sbRow.angle_v && sbRow.angle_s) {
    try {
      const zh = angleService.toChineseLabel(sbRow.angle_h, sbRow.angle_v, sbRow.angle_s);
      const en = angleService.toPromptFragment(sbRow.angle_h, sbRow.angle_v, sbRow.angle_s);
      return `镜头角度（机位/景别）：${zh}；${en}`;
    } catch (_) {
      return sbRow.angle ? String(sbRow.angle).trim() : '';
    }
  }
  return sbRow.angle ? String(sbRow.angle).trim() : '';
}

function buildClassicRequiredCoverageDigest(sbRow, linkedSceneText) {
  const lines = [];
  const add = (label, text) => {
    const s = text != null ? String(text).trim() : '';
    if (s) lines.push(`- ${label}：${s}`);
  };
  const sceneLocTime = [sbRow.location, sbRow.time].filter((x) => x != null && String(x).trim()).join('，');
  add('场景（地点与时间）', sceneLocTime);
  if (linkedSceneText) add('关联场景库（地点/时间/摘要）', linkedSceneText);
  add('镜头标题', sbRow.title);
  add('分镜描述', sbRow.description);
  add('人物动作', sbRow.action);
  add('人物对白', sbRow.dialogue);
  add('解说旁白', sbRow.narration);
  add('画面结果/落幅', sbRow.result);
  add('氛围', sbRow.atmosphere);
  add('情绪', sbRow.emotion);
  if (sbRow.emotion_intensity != null && sbRow.emotion_intensity !== '') {
    const ei = Number(sbRow.emotion_intensity);
    if (Number.isFinite(ei)) add('情绪强度', String(ei));
    else add('情绪强度', String(sbRow.emotion_intensity).trim());
  }
  add('景别', sbRow.shot_type);
  const ang = angleCoverageLine(sbRow);
  if (ang) add('镜头方式（视角/机位）', ang);
  add('光线/灯光风格', lightingDisplay(sbRow) || sbRow.lighting_style);
  add('景深', depthDisplay(sbRow) || sbRow.depth_of_field);
  add('运镜', movementDisplay(sbRow) || sbRow.movement);
  const dur = Number(sbRow.duration);
  const sec = Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 5;
  add('时长（秒）', `${sec}`);
  if (sbRow.segment_title != null && String(sbRow.segment_title).trim()) {
    add(
      '剧情段落',
      `「${String(sbRow.segment_title).trim()}」` +
        (sbRow.segment_index != null ? `（段序号 ${sbRow.segment_index}）` : '')
    );
  }
  if (!lines.length) return '(当前无非空结构化字段；请依据剧本与 AUTO_COMPOSED 生成)';
  return [
    '下列维度在库中均有值——成稿须**全部覆盖**其语义（允许电影化改写，禁止删事实、改秒数、改旁白/对白原意）：',
    ...lines,
  ].join('\n');
}

function formatClassicVideoNeighborBlock(label, row) {
  if (!row) return `${label}:\n(none)`;
  const lines = [
    row.storyboard_number != null && row.storyboard_number !== ''
      ? `SHOT_NUM: ${row.storyboard_number}`
      : null,
    row.title ? `TITLE: ${clipClassicCtx(row.title, 180)}` : null,
    row.description ? `DESCRIPTION: ${clipClassicCtx(row.description, 420)}` : null,
    row.action ? `ACTION: ${clipClassicCtx(row.action, 450)}` : null,
    row.dialogue ? `DIALOGUE: ${clipClassicCtx(row.dialogue, 320)}` : null,
    row.narration ? `NARRATION: ${clipClassicCtx(row.narration, 320)}` : null,
    row.video_prompt ? `VIDEO_PROMPT: ${clipClassicCtx(row.video_prompt, 450)}` : null,
    row.universal_segment_text
      ? `UNIVERSAL_SEGMENT_TEXT: ${clipClassicCtx(row.universal_segment_text, 260)}`
      : null,
  ].filter(Boolean);
  return `${label}:\n${lines.length ? lines.join('\n') : '(empty)'}`;
}

function resolveDramaIdFromStoryboard(db, sbRow) {
  if (!sbRow?.episode_id) return null;
  try {
    const ep = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(sbRow.episode_id);
    return ep?.drama_id ?? null;
  } catch (_) {
    return null;
  }
}

function isFullNarrationClassicStoryboard(db, sbRow) {
  if (!sbRow || sbRow.creation_mode === 'universal') return false;
  const dramaId = sbRow.drama_id ?? resolveDramaIdFromStoryboard(db, sbRow);
  return isDramaFullNarrationVideoMode(db, dramaId);
}

async function loadClassicVideoPromptContext(db, sbRow, body = {}) {
  const dramaId = sbRow.drama_id ?? resolveDramaIdFromStoryboard(db, sbRow);
  const fullNarration = isFullNarrationClassicStoryboard(db, sbRow);

  let styleEn = '';
  let styleZh = '';
  let videoRatio = '9:16';
  let cfg = null;
  try {
    const loadConfig = require('../config').loadConfig;
    const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
    cfg = loadConfig();
    const dr = dramaId
      ? db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)
      : null;
    cfg = mergeCfgStyleWithDrama(cfg, dr || {});
    styleEn = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').trim();
    styleZh = (cfg?.style?.default_style_zh || '').trim();
    try {
      const meta = dr?.metadata ? JSON.parse(dr.metadata) : {};
      if (meta?.aspect_ratio && String(meta.aspect_ratio).trim()) {
        videoRatio = String(meta.aspect_ratio).trim().replace(/\uFF1A/g, ':');
      }
    } catch (_) {}
  } catch (_) {}

  const autoComposed = composeStoryboardVideoPrompt(sbRow, styleEn || styleZh, videoRatio);

  const userInstruction =
    body && body.user_instruction != null ? String(body.user_instruction).trim() : '';
  const draftRaw =
    body && body.draft_video_prompt != null ? String(body.draft_video_prompt) : '';
  const draftTrim = draftRaw.trim();
  const dbVp = sbRow.video_prompt != null ? String(sbRow.video_prompt).trim() : '';
  const currentDraft = draftTrim || dbVp;

  let scriptText = '';
  try {
    const ep = db
      .prepare('SELECT script_content FROM episodes WHERE id = ? AND deleted_at IS NULL')
      .get(sbRow.episode_id);
    scriptText = (ep?.script_content && String(ep.script_content).trim()) || '';
  } catch (_) {}

  let prevRow = null;
  let nextRow = null;
  try {
    const num = sbRow.storyboard_number;
    const eid = sbRow.episode_id;
    prevRow = db
      .prepare(
        `SELECT storyboard_number, title, description, action, dialogue, narration, video_prompt, universal_segment_text
         FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL
         ORDER BY storyboard_number DESC LIMIT 1`
      )
      .get(eid, num);
    nextRow = db
      .prepare(
        `SELECT storyboard_number, title, description, action, dialogue, narration, video_prompt, universal_segment_text
         FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL
         ORDER BY storyboard_number ASC LIMIT 1`
      )
      .get(eid, num);
  } catch (_) {}

  const {
    extractNarrationLocalWindow,
    buildNarrationLocalContextBlock,
  } = require('./narrationLocalWindow');
  const narrationLocalWin = extractNarrationLocalWindow(scriptText, sbRow.narration, {
    radius: 100,
    prevNarration: prevRow?.narration,
    nextNarration: nextRow?.narration,
  });
  const narrationLocalBlock = buildNarrationLocalContextBlock(narrationLocalWin);

  let dramaTitle = '';
  let episodeTitle = '';
  let shotTotalInEpisode = 0;
  try {
    if (dramaId) {
      const drT = db.prepare('SELECT title FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
      dramaTitle = drT?.title != null ? String(drT.title).trim() : '';
    }
    const epT = db
      .prepare('SELECT title FROM episodes WHERE id = ? AND deleted_at IS NULL')
      .get(sbRow.episode_id);
    episodeTitle = epT?.title != null ? String(epT.title).trim() : '';
    const cnt = db
      .prepare('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL')
      .get(sbRow.episode_id);
    shotTotalInEpisode = cnt?.n != null ? Number(cnt.n) : 0;
  } catch (_) {}

  const firstFrameAnchor = clipClassicCtx(
    (sbRow.polished_prompt && String(sbRow.polished_prompt).trim()) ||
      (sbRow.image_prompt && String(sbRow.image_prompt).trim()) ||
      '',
    980
  );

  let linkedSceneText = '';
  try {
    if (sbRow.scene_id) {
      const sc = db
        .prepare('SELECT location, time, prompt FROM scenes WHERE id = ? AND deleted_at IS NULL')
        .get(sbRow.scene_id);
      if (sc) {
        const bits = [sc.location, sc.time].filter((x) => x != null && String(x).trim());
        const head = bits.join('，');
        const pr = sc.prompt != null ? String(sc.prompt).trim() : '';
        linkedSceneText = [head, pr ? `场景库文案摘要：${clipClassicCtx(pr, 280)}` : '']
          .filter(Boolean)
          .join('；');
      }
    }
  } catch (_) {}

  const fieldLines = [
    ['SHOT_NUM', sbRow.storyboard_number],
    ['TITLE', sbRow.title],
    ['DESCRIPTION', sbRow.description],
    ['LOCATION', sbRow.location],
    ['TIME', sbRow.time],
    ['DURATION_SEC', sbRow.duration],
    ['ACTION', sbRow.action],
    ['DIALOGUE', sbRow.dialogue],
    ['NARRATION', sbRow.narration],
    ['RESULT', sbRow.result],
    ['ATMOSPHERE', sbRow.atmosphere],
    ['EMOTION', sbRow.emotion],
    ['EMOTION_INTENSITY', sbRow.emotion_intensity],
    ['SHOT_TYPE', sbRow.shot_type],
    ['ANGLE_H', sbRow.angle_h],
    ['ANGLE_V', sbRow.angle_v],
    ['ANGLE_S', sbRow.angle_s],
    ['ANGLE_LEGACY', sbRow.angle],
    ['MOVEMENT', sbRow.movement],
    ['LIGHTING_STYLE', sbRow.lighting_style],
    ['DEPTH_OF_FIELD', sbRow.depth_of_field],
    ['SEGMENT_INDEX', sbRow.segment_index],
    ['SEGMENT_TITLE', sbRow.segment_title],
    ['IMAGE_PROMPT', sbRow.image_prompt],
    ['POLISHED_IMAGE_PROMPT', sbRow.polished_prompt],
  ]
    .map(([k, v]) => {
      if (v == null || v === '') return null;
      const s = String(v).trim();
      return s ? `${k}: ${s}` : null;
    })
    .filter(Boolean)
    .join('\n');

  const retentionClauses = extractRetentionClausesFromVideoPrompts(
    currentDraft || '',
    String(autoComposed || '').trim()
  );

  return {
    cfg,
    fullNarration,
    dramaId,
    styleEn,
    styleZh,
    videoRatio,
    autoComposed,
    userInstruction,
    currentDraft,
    scriptText,
    narrationLocalBlock,
    prevRow,
    nextRow,
    dramaTitle,
    episodeTitle,
    shotTotalInEpisode,
    firstFrameAnchor,
    linkedSceneText,
    fieldLines,
    retentionClauses,
  };
}

function buildClassicVideoPromptUserPrompt(ctx, sbRow, opts = {}) {
  const mode = opts.mode === 'generate' ? 'generate' : 'polish';
  const fullNarration = !!ctx.fullNarration;
  const task =
    mode === 'generate' && fullNarration
      ? 'GENERATE_FULL_NARRATION_CLASSIC_VIDEO_PROMPT'
      : 'POLISH_CLASSIC_STORYBOARD_STILL_TO_VIDEO_PROMPT';
  const polishPassStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const outputGoal =
    mode === 'generate' && fullNarration
      ? '根据旁白与分镜字段生成单段、可直接送图生视频模型的专业提示词；旁白驱动画面，成片须无声（旁白后处理叠加）。'
      : '单段、可直接送图生视频模型的专业提示词；首帧画面已由参考图锁定，文案负责动效、节奏、运镜意图、声画暗示与画风气质。';

  const draftSection =
    mode === 'generate' && fullNarration && !ctx.currentDraft
      ? '(empty — generate from STORYBOARD_FIELDS + NARRATION + FULL_EPISODE_SCRIPT + NARRATION_LOCAL_CONTEXT/neighbors; AUTO_COMPOSED 仅作字段顺序参考，须据旁白合理扩展动作与运镜)'
      : ctx.currentDraft || '(empty — use AUTO_COMPOSED + FIELDS)';

  const polishRefreshLine =
    mode === 'polish'
      ? 'POLISH_REFRESH: 用户可多次润色；事实与时长不变，但须明显换表述；禁止与 CURRENT_VIDEO_DRAFT 仅标点或个别虚词差异。'
      : 'GENERATE_REFRESH: 首次生成或重建；须完整覆盖字段与旁白，动作/运镜须与 narration 及 NARRATION_LOCAL_CONTEXT 语义匹配（整集剧本仅作因果/语气参考）。';

  return [
    `TASK: ${task}`,
    `POLISH_PASS_STAMP: ${polishPassStamp}`,
    polishRefreshLine,
    `OUTPUT_GOAL: ${outputGoal}`,
    fullNarration
      ? 'FULL_NARRATION_MODE: true（旁白 IndexTTS 后处理；Agnes 提交前会剥离对白/旁白配音要求，成片人物闭口）'
      : 'FULL_NARRATION_MODE: false',
    '',
    `PROJECT:\nDRAMA_TITLE: ${ctx.dramaTitle || '(unknown)'}\nEPISODE_TITLE: ${ctx.episodeTitle || '(unknown)'}`,
    `SHOT_SEQUENCE: 当前镜号 ${sbRow.storyboard_number ?? '?'} / 本集共 ${ctx.shotTotalInEpisode || '?'} 镜`,
    `VIDEO_RATIO: ${ctx.videoRatio}`,
    '',
    `FULL_EPISODE_SCRIPT（用于人物关系、因果与语气；勿编造剧本未出现的情节）:\n${ctx.scriptText || '(本集剧本正文为空)'}`,
    '',
    ctx.narrationLocalBlock ||
      'NARRATION_LOCAL_CONTEXT（当前镜旁白 ±100字）:\n(无可用旁白局部上下文)',
    '',
    'NEIGHBOR_PREV（上一镜：用于入戏衔接、情绪与空间连贯）:',
    formatClassicVideoNeighborBlock('PREV', ctx.prevRow),
    '',
    'NEIGHBOR_NEXT（下一镜：用于本镜收束与出口暗示，勿剧透下一镜未发生的具体事件）:',
    formatClassicVideoNeighborBlock('NEXT', ctx.nextRow),
    '',
    'STORYBOARD_FIELDS（当前镜结构化事实）:',
    ctx.fieldLines || '(empty)',
    '',
    'REQUIRED_COVERAGE_DIGEST（下列凡出现「- 维度：」行的，成稿必须全部体现其语义；可与邻镜/剧本/局部旁白融合叙述，禁止省略事实、禁止改旁白/对白原意、禁止改时长秒数）:',
    buildClassicRequiredCoverageDigest(sbRow, ctx.linkedSceneText),
    '',
    `FIRST_FRAME_VISUAL_ANCHOR（分镜参考静帧对应的英文/中文图提示摘要；动效须与此一致，禁止改换装、改人脸特征、改场景时代）:\n${
      ctx.firstFrameAnchor || '(无图侧文本；仅依据 STORYBOARD_FIELDS 与剧本推断画面)'
    }`,
    '',
    `AUTO_COMPOSED_VIDEO_PROMPT（程序字段拼装参考，作事实底线与标签顺序范例）:\n${ctx.autoComposed}`,
    '',
    `CURRENT_VIDEO_DRAFT（${mode === 'polish' ? '用户当前 video_prompt，优先在其上润色' : '当前库内草稿；生成模式可忽略并据字段重写'}）:\n${draftSection}`,
    '',
    ctx.userInstruction
      ? `USER_INSTRUCTION（用户要求，须在不丢事实前提下优先满足）:\n${ctx.userInstruction}`
      : 'USER_INSTRUCTION: (none)',
    '',
    'RETENTION_CLAUSES_FROM_SOURCE（由 CURRENT_VIDEO_DRAFT / AUTO_COMPOSED 按句号拆出的「标签分句」；每一条中的**全部信息点**须在成稿中出现——含：配乐侧写、音效层次、情绪强度数值、括号内**完整**英文镜头/景深/透视描述、=VideoRatio 画幅；允许调整语序与衔接词，**禁止**把多条合并后只剩笼统氛围描写而导致某类信息消失）:',
    ctx.retentionClauses.length
      ? ctx.retentionClauses.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '(未解析到标签分句；须把 STORYBOARD_FIELDS 与 AUTO_COMPOSED 信息等价写入成稿。)',
    '',
    `VISUAL_STYLE（须内化进成稿；中文气质描写 + 英文质感词均可）:\nSTYLE_ZH: ${ctx.styleZh || '(none)'}\nSTYLE_EN: ${ctx.styleEn || '(none)'}`,
  ].join('\n');
}

function hasClassicVideoPromptInputs(sbRow, ctx) {
  const narr = sbRow.narration != null ? String(sbRow.narration).trim() : '';
  const action = sbRow.action != null ? String(sbRow.action).trim() : '';
  const title = sbRow.title != null ? String(sbRow.title).trim() : '';
  const draft = ctx.currentDraft || '';
  const composed = String(ctx.autoComposed || '').trim();
  if (ctx.fullNarration) {
    return !!(narr || draft || composed);
  }
  return !!(draft || composed || action || narr);
}

async function generateClassicVideoPromptWithAi(db, log, sbRow, opts = {}) {
  const mode = opts.mode === 'polish' ? 'polish' : 'generate';
  const body = {
    draft_video_prompt: opts.draftVideoPrompt,
    user_instruction: opts.userInstruction,
  };
  const ctx = await loadClassicVideoPromptContext(db, sbRow, body);
  if (!hasClassicVideoPromptInputs(sbRow, ctx)) {
    throw new Error('缺少旁白/动作/场景等字段，无法生成视频提示词');
  }

  const userPrompt = buildClassicVideoPromptUserPrompt(ctx, sbRow, { mode });
  const systemPrompt = promptI18n.getClassicVideoPromptSystemPrompt(ctx.cfg || {}, {
    fullNarration: ctx.fullNarration,
    mode,
  });

  const onDelta = typeof opts.onDelta === 'function' ? opts.onDelta : null;
  let text;
  if (onDelta) {
    text = await aiClient.streamGenerateText(
      db,
      log,
      'text',
      userPrompt,
      systemPrompt,
      {
        scene_key: 'image_polish',
        max_tokens: 3600,
        temperature: mode === 'generate' ? 0.32 : 0.28,
        silence_timeout_ms: 180000,
      },
      onDelta
    );
  } else {
    text = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      scene_key: 'image_polish',
      max_tokens: 3600,
      temperature: mode === 'generate' ? 0.32 : 0.28,
    });
  }

  const trimmed = text != null ? String(text).trim() : '';
  if (trimmed.length < 12) {
    throw new Error('AI 返回内容过短，请检查文本模型配置');
  }
  return { text: trimmed, fullNarration: ctx.fullNarration, mode };
}


function parseDualPromptJson(raw) {
  const { safeParseAIJSON } = require('../utils/safeJson');
  const text = raw != null ? String(raw).trim() : '';
  if (!text) throw new Error('AI 返回为空');
  const meta = {};
  let parsed = safeParseAIJSON(text, null, null, meta);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // fallback: strip fences and try JSON.parse
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      throw new Error('双提示词 JSON 解析失败');
    }
  }
  const polished =
    (parsed.polished_prompt != null && String(parsed.polished_prompt).trim()) ||
    (parsed.image_prompt != null && String(parsed.image_prompt).trim()) ||
    '';
  const video =
    (parsed.video_prompt != null && String(parsed.video_prompt).trim()) ||
    '';
  if (polished.length < 10 && video.length < 12) {
    throw new Error('双提示词内容过短');
  }
  return { polished_prompt: polished, video_prompt: video };
}

/**
 * 全文解说经典模式：一次 AI 同时生成 polished_prompt + video_prompt
 */
async function generateFullNarrationDualPromptsWithAi(db, log, sbRow, opts = {}) {
  const body = {
    draft_video_prompt: opts.draftVideoPrompt,
    user_instruction: opts.userInstruction,
  };
  const ctx = await loadClassicVideoPromptContext(db, sbRow, body);
  if (!ctx.fullNarration) {
    throw new Error('仅全文解说经典模式支持双提示词一次生成');
  }
  if (!hasClassicVideoPromptInputs(sbRow, ctx)) {
    throw new Error('缺少旁白/动作/场景等字段，无法生成提示词');
  }

  const { collectStoryboardAssetNames } = require('./storyboardImagePromptBundle');
  const assetNames = collectStoryboardAssetNames(db, sbRow.id);

  // image continuity neighbors (lightweight)
  let prevContinuityState = null;
  let prevDesc = '(first shot)';
  let nextDesc = '(last shot)';
  try {
    const prevShot = db
      .prepare(
        `SELECT action, location, time, continuity_snapshot
         FROM storyboards
         WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL
         ORDER BY storyboard_number DESC LIMIT 1`
      )
      .get(sbRow.episode_id, sbRow.storyboard_number);
    const nextShot = db
      .prepare(
        `SELECT action, location, time
         FROM storyboards
         WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL
         ORDER BY storyboard_number ASC LIMIT 1`
      )
      .get(sbRow.episode_id, sbRow.storyboard_number);
    if (prevShot) {
      prevDesc =
        (prevShot.action || [prevShot.location, prevShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() ||
        '(first shot)';
      if (prevShot.continuity_snapshot) {
        try {
          prevContinuityState = JSON.parse(prevShot.continuity_snapshot);
        } catch (_) {}
      }
    }
    if (nextShot) {
      nextDesc =
        (nextShot.action || [nextShot.location, nextShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() ||
        '(last shot)';
    }
  } catch (_) {}

  const videoUser = buildClassicVideoPromptUserPrompt(ctx, sbRow, { mode: 'generate' });
  const styleBlock = [
    ctx.styleZh ? `【画风·最高优先级】${ctx.styleZh}` : null,
    ctx.styleEn && ctx.styleEn !== ctx.styleZh ? `MANDATORY ART STYLE: ${ctx.styleEn}.` : ctx.styleEn ? `MANDATORY ART STYLE: ${ctx.styleEn}.` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const imageBlock = [
    styleBlock || null,
    sbRow.image_prompt ? `PROMPT: ${sbRow.image_prompt}` : null,
    sbRow.action ? `ACTION: ${sbRow.action}` : null,
    sbRow.dialogue ? `DIALOGUE: ${sbRow.dialogue}` : null,
    sbRow.result ? `RESULT: ${sbRow.result}` : null,
    sbRow.atmosphere ? `ATMOSPHERE: ${sbRow.atmosphere}` : null,
    sbRow.shot_type ? `SHOT_TYPE: ${sbRow.shot_type}` : null,
    `STYLE_TOKENS (repeat in polished_prompt): ${ctx.styleEn || ctx.styleZh || 'cinematic'}`,
    `ASSETS: ${assetNames || 'none'}`,
    prevContinuityState ? `PREV_CONTINUITY_STATE: ${JSON.stringify(prevContinuityState)}` : null,
    `CONTEXT_PREV: ${prevDesc}`,
    `CONTEXT_NEXT: ${nextDesc}`,
    'IMAGE_REMINDER: polished_prompt must be STATIC SINGLE-FRAME only.',
  ]
    .filter(Boolean)
    .join('\n');

  const userPrompt = [
    'TASK: FULL_NARRATION_DUAL_PROMPTS — return JSON with polished_prompt + video_prompt',
    '',
    '=== IMAGE_PROMPT_INPUTS ===',
    imageBlock,
    '',
    '=== VIDEO_PROMPT_INPUTS ===',
    videoUser,
  ].join('\n');

  const systemPrompt = promptI18n.getFullNarrationDualPromptSystemPrompt(ctx.cfg || {});
  const raw = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'image_polish',
    max_tokens: 4200,
    temperature: 0.3,
  });

  const parsed = parseDualPromptJson(raw);
  // soft fallbacks if one side short
  let polished = parsed.polished_prompt;
  let video = parsed.video_prompt;
  if (!polished || polished.length < 10) {
    polished =
      (sbRow.image_prompt && String(sbRow.image_prompt).trim()) ||
      (sbRow.action && String(sbRow.action).trim()) ||
      '';
  }
  if (!video || video.length < 12) {
    // leave empty — caller may fallback to rule compose
    video = '';
  }
  if ((!polished || polished.length < 10) && (!video || video.length < 12)) {
    throw new Error('双提示词生成失败：图/视频均过短');
  }
  return { polished_prompt: polished, video_prompt: video, fullNarration: true };
}

module.exports = {
  clipClassicCtx,
  extractRetentionClausesFromVideoPrompts,
  buildClassicRequiredCoverageDigest,
  formatClassicVideoNeighborBlock,
  isFullNarrationClassicStoryboard,
  loadClassicVideoPromptContext,
  buildClassicVideoPromptUserPrompt,
  generateClassicVideoPromptWithAi,
  generateFullNarrationDualPromptsWithAi,
  hasClassicVideoPromptInputs,
};
