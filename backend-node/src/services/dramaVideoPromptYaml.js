/**
 * 全能片段 / 经典分镜 → ArcReel drama 结构化视频提示词（对齐 ArcReel video_prompt_to_yaml）
 *
 * 最终提交形态：
 *   Voice_Profiles? / Action / Camera_Motion / Ambiance_Audio / Dialogue?
 *   + 文末「禁止出现：BGM、文字字幕、水印。」
 *
 * 台词只在 Dialogue[].Line；无 Spoken、无 <名>说 {}、无【音轨】长约束。
 */
const {
  deriveUtterances,
  splitSpeechLine,
  splitDialogueField,
  normalizeUniversalSegmentTextNewlines,
} = require('./universalOmniMultiBeatFormat');

/** 对齐 ArcReel lib/prompt_builders.py _NEGATIVE_TAIL_VIDEO */
const ARCREEL_VIDEO_NEGATIVE_TAIL = '禁止出现：BGM、文字字幕、水印。';

/**
 * 对齐 ArcReel reference_video.prompt_render._TWIN_PACK
 * （≥2 张角色参考图时追加，压双胞胎/分身）
 */
const ARCREEL_TWIN_PACK =
  '视频全程禁止出现外形、着装、配饰完全一致的人物，禁止生成同款分身、双胞胎效果，同一画面中仅保留单个对应人物，不出现人物重复复刻。';

/**
 * 对齐 ArcReel _OFFSCREEN_SPEECH_LIP_PACK（drama YAML 路径挂在 Action 尾，压心声口型）
 * Action 禁止写发声相关行为；心声只走 Dialogue 画外音色。
 */
const ARCREEL_INNER_MONOLOGUE_LIP_PACK =
  '【心声口型】内心独白/旁白只出画外音色、不做说话口型；Action 禁止描写任何与发声有关的行为（说话、嘟囔、轻声、耳语、咂嘴、啧舌、叹气、清嗓、哼唱等）；心声或旁白对应瞬间嘴唇紧闭，不吐舌、不开口、无发声口部动作；同一人既有心里话又有开口对白时：心里话时段闭嘴，仅 Speaker 无%内心独白的对白瞬间才正常张嘴口型；禁止整段跟心声/旁白对口型；Speaker 含%内心独白的条目禁止张嘴说话，不要把心声口型加到画面人物脸上。';

/** Dialogue Speaker 内心独白后缀（与 @[角色%内心独白] 对齐） */
const INNER_MONOLOGUE_SPEAKER_SUFFIX = '%内心独白';

/** 剥 YAML/JSON 外层引号（可多次，避免 "\"阿杰%内心独白\""） */
function unquoteYamlScalar(value) {
  let v = String(value ?? '').trim();
  for (let i = 0; i < 4; i++) {
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      try {
        const parsed = JSON.parse(v.startsWith("'") ? `"${v.slice(1, -1).replace(/"/g, '\\"')}"` : v);
        if (typeof parsed === 'string') {
          v = parsed.trim();
          continue;
        }
      } catch (_) {
        v = v.slice(1, -1).trim();
        continue;
      }
    }
    break;
  }
  return v;
}

/** @deprecated 兼容旧导出名 */
const ARCREEL_SPOKEN_CONSTRAINT = ARCREEL_VIDEO_NEGATIVE_TAIL;

function baseSpeakerName(speaker) {
  return String(speaker || '')
    .trim()
    .replace(/%内心独白$/, '');
}

function isInnerMonologueSpeaker(speaker) {
  return /%内心独白$/.test(String(speaker || '').trim());
}

/**
 * Dialogue 说话人标签：内心独白 →「阿杰%内心独白」；旁白 →「画外音」；开口 →「阿杰」
 */
function formatDialogueSpeaker(name, { innerMonologue = false } = {}) {
  const n = baseSpeakerName(name);
  if (!n) return '画外音';
  if (n === '画外音') return '画外音';
  if (innerMonologue || isInnerMonologueSpeaker(name)) {
    return `${n}${INNER_MONOLOGUE_SPEAKER_SUFFIX}`;
  }
  return n;
}

/** 是否像全能片段（应自动转 ArcReel 结构化） */
function looksLikeUniversalOmniPrompt(text) {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (/【风格锚点】|【场景设定】|【分镜\d*】|【环境音】/.test(t)) return true;
  if (/<\s*[^>]{1,24}>\s*(?:说|内心独白)\s*\{/.test(t)) return true;
  if (/<\s*[^>]{1,24}>\s*\{/.test(t)) return true;
  if (/@\[[^\]]+%内心独白\]\s*\{/.test(t)) return true;
  if (/画外音(?:说)?\s*\{/.test(t)) return true;
  return false;
}

/** 是否像经典分镜拼装的 video_prompt（场景/动作/对话…） */
function looksLikeClassicVideoPrompt(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isArcReelStructuredPrompt(t) || looksLikeUniversalOmniPrompt(t)) return false;
  return /(?:^|[。；\n\s])(?:场景|镜头标题|动作|对话|解说旁白|结果|景别|运镜|氛围|音效)[：:]/.test(
    ` ${t}`
  );
}

function extractClassicLabeledField(text, label) {
  const esc = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc}[：:]\\s*([^。]*)`);
  const m = String(text || '').match(re);
  return m ? String(m[1] || '').trim() : '';
}

/** 从经典 generateVideoPrompt 散文抽字段 */
function parseClassicVideoPromptProse(text) {
  const t = String(text || '').trim();
  if (!t) {
    return {
      action: '',
      dialogue: '',
      narration: '',
      result: '',
      atmosphere: '',
      sound_effect: '',
      movement: '',
      shot_type: '',
      location: '',
      time: '',
      title: '',
    };
  }
  const scene = extractClassicLabeledField(t, '场景');
  let location = '';
  let time = '';
  if (scene) {
    const sepIdx = scene.search(/[，,、]/);
    if (sepIdx > 0) {
      location = scene.slice(0, sepIdx).trim();
      time = scene.slice(sepIdx + 1).trim();
    } else {
      location = scene;
    }
  }
  return {
    action: extractClassicLabeledField(t, '动作'),
    dialogue: extractClassicLabeledField(t, '对话'),
    narration: extractClassicLabeledField(t, '解说旁白'),
    result: extractClassicLabeledField(t, '结果'),
    atmosphere: extractClassicLabeledField(t, '氛围'),
    sound_effect: extractClassicLabeledField(t, '音效'),
    movement: extractClassicLabeledField(t, '运镜'),
    shot_type: extractClassicLabeledField(t, '景别'),
    location,
    time,
    title: extractClassicLabeledField(t, '镜头标题'),
  };
}

function stripClassicDialogueQuotes(spoken) {
  let s = String(spoken || '').trim();
  // 成对包裹的中英文引号
  s = s.replace(/^[\s]*[「『“"']+/, '').replace(/[」』”"']+[\s]*$/, '').trim();
  return s;
}

/** 将经典对白拆成若干「一句一人」片段（支持换行，以及「A：…。B：…」同行） */
function splitClassicDialogueChunks(dialogueText) {
  const raw = String(dialogueText || '').trim();
  if (!raw) return [];
  const lines = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    // 在句末标点 / 闭引号后，若紧跟「短名：」则切开
    const parts = line.split(
      /(?<=[。！？!?…」』”“"'])\s*(?=[^：:\n「『“"']{1,16}[：:])/u
    );
    if (parts.length > 1) {
      for (const p of parts) {
        const t = String(p || '').trim();
        if (t) out.push(t);
      }
      continue;
    }
    // 「A：「x」B：「y」」无句号间隔
    const quoteParts = line.split(
      /(?<=[」』”“"'])\s*(?=[^：:\n「『“"']{1,16}[：:]\s*[「『“"'])/u
    );
    if (quoteParts.length > 1) {
      for (const p of quoteParts) {
        const t = String(p || '').trim();
        if (t) out.push(t);
      }
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * 经典 dialogue / narration → Dialogue[]（有序）
 * 支持：角色：台词 / 角色说「台词」/ 纯引号 / ArcReel <名>说 {…} / 同行多说话人
 */
function parseClassicDialogueAndNarration(dialogueText, narrationText) {
  const dialogue = [];
  const push = (speaker, line, opts = {}) => {
    const spoken = stripClassicDialogueQuotes(line);
    if (!spoken) return;
    const sp = formatDialogueSpeaker(speaker, { innerMonologue: !!opts.innerMonologue });
    dialogue.push({ speaker: sp, line: spoken });
  };

  const dlg = String(dialogueText || '').trim();
  if (dlg) {
    if (
      /<\s*[^>]+\s*>\s*(?:说|内心独白)?\s*\{/.test(dlg) ||
      /@\[[^\]]+\]\s*[：:]?\s*\{/.test(dlg) ||
      /画外音(?:说)?\s*\{/.test(dlg)
    ) {
      for (const u of deriveUtterances(dlg)) {
        const spoken = String(u.text || '').trim();
        if (!spoken) continue;
        if (u.kind === 'inner_monologue' || u.innerMonologue) {
          push(u.speaker, spoken, { innerMonologue: true });
        } else if (u.kind === 'voiceover' || !u.speaker) {
          push('画外音', spoken);
        } else {
          push(u.speaker, spoken);
        }
      }
    } else {
      for (const chunk of splitClassicDialogueChunks(dlg)) {
        const heart = chunk.match(
          /^([^说：:\n「『“"']{1,24})[（(]\s*(?:心里话|内心独白|心声)\s*[）)]\s*[：:\s]*[「『“"']?([^」』”"']+)[」』”"']?\s*$/u
        );
        if (heart) {
          push(heart[1], heart[2], { innerMonologue: true });
          continue;
        }
        const sayM = chunk.match(
          /^([^说：:\n「『“"']{1,24})\s*说[道着]?[：:\s]*[「『“"']([^」』”"']+)[」』”"']\s*$/u
        );
        if (sayM) {
          push(sayM[1], sayM[2]);
          continue;
        }
        const quoteOnly = chunk.match(/^[「『“"']([^」』”"']+)[」』”"']\s*$/u);
        if (quoteOnly) {
          push('画外音', quoteOnly[1]);
          continue;
        }
        const { name, spoken, innerMonologue } = splitDialogueField(chunk);
        push(name, spoken, { innerMonologue });
      }
    }
  }

  for (const line of String(narrationText || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    // narration 字段里若仍是心里话行，不要一律打成画外音
    const heart = line.match(
      /^(.{1,24}?)[（(]\s*(?:心里话|内心独白|心声)\s*[）)]\s*[：:]\s*(.+)$/
    );
    if (heart) {
      push(heart[1], heart[2], { innerMonologue: true });
      continue;
    }
    const atInner = line.match(/@\[([^\]]+%内心独白)\]\s*[：:]?\s*\{([^}]*)\}/);
    if (atInner) {
      push(atInner[1].replace(/%内心独白$/, ''), atInner[2], { innerMonologue: true });
      continue;
    }
    push('画外音', line);
  }
  return dialogue;
}

function hasUsefulClassicFields(fields) {
  const f = fields || {};
  return !!(
    String(f.action || '').trim() ||
    String(f.dialogue || '').trim() ||
    String(f.narration || '').trim() ||
    String(f.result || '').trim() ||
    String(f.video_prompt || '').trim()
  );
}

/** 经典分镜字段 → drama video_prompt 结构 */
function classicStoryboardToDramaVideoPrompt(fields, opts = {}) {
  let f = { ...(fields || {}) };
  const bare =
    !String(f.action || '').trim() &&
    !String(f.dialogue || '').trim() &&
    !String(f.narration || '').trim();
  if (bare && String(f.video_prompt || '').trim()) {
    const vp = String(f.video_prompt).trim();
    // 已是 ArcReel YAML：直接读结构，勿当「动作：」散文解析
    if (isArcReelStructuredPrompt(vp)) {
      const parsed = parseArcReelYamlLoose(vp);
      const dialogue = Array.isArray(parsed.dialogue) ? parsed.dialogue : [];
      return {
        action: cleanActionBlob(parsed.action).slice(0, 600),
        camera_motion: parsed.camera_motion || 'Static',
        ambiance_audio: sanitizeAmbianceAudio(parsed.ambiance_audio) || '低电平现场环境声',
        dialogue,
        voice_profiles: buildVoiceProfiles(dialogue, opts.characters),
      };
    }
    f = { ...parseClassicVideoPromptProse(vp), video_prompt: vp };
  }

  const location = String(f.location || '').trim();
  const time = String(f.time || '').trim();
  const title = String(f.title || '').trim();
  const shotType = String(f.shot_type || '').trim();
  const action = cleanActionBlob(String(f.action || '').trim());
  const result = cleanActionBlob(String(f.result || '').trim());
  const movement = String(f.movement || f.camera_movement || '').trim();
  const atmosphere = String(f.atmosphere || '').trim();
  const soundEffect = String(f.sound_effect || '').trim();

  const actionParts = [];
  const scene = [location, time].filter(Boolean).join('，');
  if (scene) actionParts.push(scene);
  if (title) actionParts.push(title);
  if (shotType) actionParts.push(shotType);
  if (action) actionParts.push(action);
  if (result) actionParts.push(result);

  const dialogue = parseClassicDialogueAndNarration(f.dialogue, f.narration);
  const cameraSrc = [movement, action, shotType, String(f.angle || '')].filter(Boolean).join(' ');
  const ambiance = sanitizeAmbianceAudio([atmosphere, soundEffect].filter(Boolean).join('，'));

  return {
    action: actionParts.join('。').trim().slice(0, 600),
    camera_motion: inferCameraMotion(cameraSrc) || 'Static',
    ambiance_audio: ambiance || '低电平现场环境声',
    dialogue,
    voice_profiles: buildVoiceProfiles(dialogue, opts.characters),
  };
}

function convertClassicStoryboardToArcReelYaml(fields, opts = {}) {
  const structured = classicStoryboardToDramaVideoPrompt(fields, opts);
  if (!String(structured.action || '').trim() && !(structured.dialogue || []).length) {
    throw new Error('无法从经典分镜字段提取画面或台词，请先填写动作/对白或生成视频提示词');
  }
  return dramaVideoPromptToYaml(structured);
}

/** 规范化经典字段，必要时从 video_prompt 散文补 narration/dialogue */
function resolveClassicSpeechFields(fields) {
  const f = { ...(fields || {}) };
  const needNarr = !String(f.narration || '').trim();
  const needDlg = !String(f.dialogue || '').trim();
  if ((needNarr || needDlg) && String(f.video_prompt || '').trim() && !isArcReelStructuredPrompt(f.video_prompt)) {
    try {
      const parsed = parseClassicVideoPromptProse(f.video_prompt);
      if (needNarr && String(parsed.narration || '').trim()) f.narration = parsed.narration;
      if (needDlg && String(parsed.dialogue || '').trim()) f.dialogue = parsed.dialogue;
    } catch (_) {}
  }
  return f;
}

function normalizeSpokenKey(speaker, line) {
  return `${String(speaker || '').trim()}::${String(line || '')
    .replace(/\s+/g, '')
    .slice(0, 120)}`;
}

/**
 * 把分镜 dialogue/narration 并入 ArcReel 结构的 Dialogue[]。
 * 全能稿常只写 Action、漏掉 Speaker: 画外音 —— 用 narration 字段补回。
 */
function mergeClassicSpeechIntoDramaPrompt(structured, classicFields, opts = {}) {
  const base = structured && typeof structured === 'object'
    ? {
        action: structured.action || '',
        camera_motion: structured.camera_motion || 'Static',
        ambiance_audio: structured.ambiance_audio || '',
        dialogue: Array.isArray(structured.dialogue) ? [...structured.dialogue] : [],
        voice_profiles: Array.isArray(structured.voice_profiles)
          ? [...structured.voice_profiles]
          : [],
      }
    : {
        action: '',
        camera_motion: 'Static',
        ambiance_audio: '',
        dialogue: [],
        voice_profiles: [],
      };

  const speechFields = resolveClassicSpeechFields(classicFields);
  const fromClassic = parseClassicDialogueAndNarration(
    speechFields.dialogue,
    speechFields.narration
  );
  if (!fromClassic.length) return base;

  const seen = new Set(
    base.dialogue.map((d) => normalizeSpokenKey(d.speaker, d.line)).filter(Boolean)
  );
  let added = 0;
  for (const item of fromClassic) {
    const key = normalizeSpokenKey(item.speaker, item.line);
    if (!key.endsWith('::') && seen.has(key)) continue;
    // 若已有同 speaker 且行文高度重叠（一方包含另一方），视为已覆盖
    const sp = String(item.speaker || '').trim();
    const line = String(item.line || '').trim();
    const overlap = base.dialogue.some((d) => {
      if (String(d.speaker || '').trim() !== sp) return false;
      const a = String(d.line || '').replace(/\s+/g, '');
      const b = line.replace(/\s+/g, '');
      if (!a || !b) return false;
      return a.includes(b) || b.includes(a);
    });
    if (overlap) continue;
    base.dialogue.push({ speaker: sp || '画外音', line });
    seen.add(key);
    added += 1;
  }
  if (added > 0) {
    base.voice_profiles = buildVoiceProfiles(base.dialogue, opts.characters);
  }
  return base;
}

/**
 * 已有 ArcReel YAML 但缺旁白 Dialogue 时，用 classicFields.narration 补上并重建。
 * @returns {{ text: string, merged: boolean }}
 */
function ensureArcReelYamlHasClassicSpeech(yamlText, classicFields, opts = {}) {
  const raw = String(yamlText || '').trim();
  if (!raw || !isArcReelStructuredPrompt(raw)) {
    return { text: raw, merged: false };
  }
  const speechFields = resolveClassicSpeechFields(classicFields);
  if (
    !String(speechFields.narration || '').trim() &&
    !String(speechFields.dialogue || '').trim()
  ) {
    return { text: appendArcReelNegativeTail(normalizeArcReelYamlForSubmit(raw)), merged: false };
  }

  const parsed = parseArcReelYamlLoose(raw);
  const before = (parsed.dialogue || []).length;
  const mergedStruct = mergeClassicSpeechIntoDramaPrompt(parsed, speechFields, opts);
  const after = (mergedStruct.dialogue || []).length;
  if (after <= before) {
    return { text: appendArcReelNegativeTail(normalizeArcReelYamlForSubmit(raw)), merged: false };
  }
  return { text: dramaVideoPromptToYaml(mergedStruct), merged: true };
}

/** 是否已是 ArcReel 分栏提示词（含旧 Spoken 稿，便于一次迁移） */
function isArcReelStructuredPrompt(text) {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (/^Spoken:\s*$/m.test(t) && (/<\s*[^>]+>\s*\{/.test(t) || /说\s*\{/.test(t) || /画外音\s*\{/.test(t))) {
    return true;
  }
  if (!/^Voice_Profiles:|^Action:/m.test(t)) return false;
  return /^(Action|Camera_Motion|Ambiance_Audio|Dialogue|Spoken):/m.test(t);
}

/**
 * 已对齐 ArcReel drama、可原样提交：
 * Action + Camera + Ambiance +（可选 Dialogue）+ 负向尾；无 Spoken / 无【音轨】/ 无全能硬约束
 */
function isArcReelSubmitReady(text) {
  const t = String(text || '').trim();
  if (!isArcReelStructuredPrompt(t)) return false;
  if (!/^Action:/m.test(t)) return false;
  if (!/^Camera_Motion:/m.test(t)) return false;
  if (!/^Ambiance_Audio:/m.test(t)) return false;
  if (/^Spoken:\s*$/m.test(t)) return false;
  if (/【音轨】/.test(t)) return false;
  if (/【音轨硬约束】/.test(t)) return false;
  if (/【口型】/.test(t)) return false;
  if (/\\"/.test(t) && /%内心独白/.test(t)) return false; // "\"阿杰%内心独白\"" 脏 Speaker
  // 有心声但未挂 ArcReel 口型包 → 须规范化后再提交
  if (/%内心独白/.test(t) && !/【心声口型】/.test(t)) return false;
  if (/<\s*[^>]+\s*>\s*(?:说\s*)?\{/.test(t)) return false;
  if (/\.\s*Style:/i.test(t)) return false;
  if (!t.includes(ARCREEL_VIDEO_NEGATIVE_TAIL)) return false;
  return true;
}

function appendArcReelNegativeTail(text, opts = {}) {
  let t = String(text || '').trim();
  if (!t) t = '';
  if (opts.twinGuard && !t.includes('禁止生成同款分身')) {
    t = t ? `${t}\n\n${ARCREEL_TWIN_PACK}` : ARCREEL_TWIN_PACK;
  }
  if (!t) return ARCREEL_VIDEO_NEGATIVE_TAIL;
  if (t.includes(ARCREEL_VIDEO_NEGATIVE_TAIL)) return t;
  return `${t}\n\n${ARCREEL_VIDEO_NEGATIVE_TAIL}`;
}

/** 在已含负向尾的 ArcReel 文案上补双胞胎约束（幂等） */
function appendArcReelTwinPack(text) {
  const t = String(text || '').trim();
  if (!t || t.includes('禁止生成同款分身')) return t;
  if (t.includes(ARCREEL_VIDEO_NEGATIVE_TAIL)) {
    return t.replace(
      ARCREEL_VIDEO_NEGATIVE_TAIL,
      `${ARCREEL_TWIN_PACK}\n\n${ARCREEL_VIDEO_NEGATIVE_TAIL}`
    );
  }
  return `${t}\n\n${ARCREEL_TWIN_PACK}\n\n${ARCREEL_VIDEO_NEGATIVE_TAIL}`;
}

/**
 * 生成视频前：未结构化则自动转；残缺则修补；就绪则原样。
 * opts.classicFields：经典分镜字段（优先于散文解析）
 * 返回 source: 'omni' | 'classic' | 'yaml' | null —— 写回分镜时区分字段
 */
function ensureArcReelStructuredForVideoSubmit(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!raw && !hasUsefulClassicFields(opts.classicFields)) {
    return { prompt: raw, converted: false, structured: false, source: null };
  }

  const applySpeechMerge = (yamlText, source, converted) => {
    const { text: next, merged } = ensureArcReelYamlHasClassicSpeech(
      yamlText,
      opts.classicFields,
      opts
    );
    return {
      prompt: next,
      converted: converted || merged,
      structured: true,
      passthrough: !converted && !merged,
      source,
    };
  };

  if (raw && isArcReelSubmitReady(raw)) {
    return applySpeechMerge(raw, 'yaml', false);
  }

  if (raw && isArcReelStructuredPrompt(raw)) {
    const next = appendArcReelNegativeTail(normalizeArcReelYamlForSubmit(raw));
    return applySpeechMerge(next, 'yaml', false);
  }

  if (raw && looksLikeUniversalOmniPrompt(raw)) {
    try {
      const next = appendArcReelNegativeTail(convertUniversalSegmentToArcReelYaml(raw, opts));
      return applySpeechMerge(next, 'omni', true);
    } catch (_) {
      /* fall through to classic */
    }
  }

  const classicFields = opts.classicFields && hasUsefulClassicFields(opts.classicFields)
    ? opts.classicFields
    : raw && looksLikeClassicVideoPrompt(raw)
      ? { video_prompt: raw }
      : null;

  if (classicFields) {
    try {
      const next = appendArcReelNegativeTail(convertClassicStoryboardToArcReelYaml(classicFields, opts));
      return { prompt: next, converted: true, structured: true, passthrough: false, source: 'classic' };
    } catch (_) {
      return { prompt: raw, converted: false, structured: false, source: null };
    }
  }

  return { prompt: raw, converted: false, structured: false, source: null };
}

function stripSpeechMarksFromLine(line) {
  const parts = splitSpeechLine(line);
  return parts
    .filter((p) => typeof p === 'string')
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripDeliveryAside(text) {
  return String(text || '')
    .replace(/[，,]?\s*语气(?:平淡|平静|自然|轻松|笃定|理所当然)?[^，。；\n]{0,36}/gu, '')
    .replace(/[，,]?\s*语调[^，。；\n]{0,36}/gu, '')
    .replace(/[，,]?\s*嗓音[^，。；\n]{0,36}/gu, '')
    .replace(/平淡如叙述事实/g, '')
    .replace(/仿佛这(?:番话|是)[^，。；\n]{0,28}/g, '')
    .replace(/(?:话音|语音|声音)落下后[^，。；\n]{0,8}/g, '')
    // (?<!不)开口：勿误伤「不开口」心声硬约束
    .replace(/[，,]?\s*(?:清晰)?(?:作答|回答|答道|(?<!不)开口|脱口而出|念出|说出|说完)[^，。；\n]{0,12}/gu, '')
    .replace(/理所当然地(?:作答|回答)?/g, '')
    .replace(/约第?\d+(?:\.\d+)?秒起\s*/g, '')
    .replace(/[，。；]\s*[，。；]/g, '。')
    .replace(/[，,]\s*[，,]/g, '，')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 心声节拍的 Action：剥掉与发声/口部出声相关的画面描写（对齐 ArcReel writing_syntax）。
 * Dialogue 已承载心声台词，Action 只留静默画面。
 */
function stripSoundRelatedActionPhrases(text) {
  return String(text || '')
    .replace(
      /[，,]?\s*(?:低声|轻声|小声|压低声音|压着嗓子)?(?:嘟囔|喃喃|自语|耳语|嘀咕|哼唱|清嗓|咂嘴|啧舌|叹气|出声|发声|轻哼)(?:着|道|了|一声)?[^，。；\n]{0,24}/gu,
      ''
    )
    .replace(
      /[，,]?\s*(?:说着话|说着|说道|说完|说了句|开了口|张开嘴|张嘴说话|动了动嘴唇|嘴唇微张|嘴角开合|双唇开合|嘴唇翕动)[^，。；\n]{0,16}/gu,
      ''
    )
    .replace(
      /[，,]?\s*(?:嗓音|声音|嗓子|喉音)(?:微微|轻轻|低沉)?(?:响起|发出|传来)?[^，。；\n]{0,20}/gu,
      ''
    )
    .replace(
      /[，,]?\s*(?:发出|传来)(?:一声)?(?:轻笑|苦笑|冷笑|叹息|鼻音|喉音)[^，。；\n]{0,12}/gu,
      ''
    )
    .replace(/[，,]?\s*(?:嘴里念叨|念念有词|自言自语)[^，。；\n]{0,16}/gu, '')
    .replace(/[，。；]\s*[，。；]/g, '。')
    .replace(/[，,]\s*[，,]/g, '，')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeAmbianceAudio(text) {
  return String(text || '')
    .split(/[；;，,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/人声|对白|台词|旁白|念白|说话|嗓音|语气|语调/.test(s))
    .join('，')
    .replace(/，?无BGM\.?$/i, '')
    .trim();
}

function extractSection(body, title) {
  const re = new RegExp(`【${title}】\\s*\\n([\\s\\S]*?)(?=\\n【|$)`);
  const m = String(body || '').match(re);
  return m ? String(m[1] || '').trim() : '';
}

function stripSection(body, title) {
  return String(body || '')
    .replace(new RegExp(`【${title}】\\s*\\n[\\s\\S]*?(?=\\n【|$)`, 'g'), '')
    .trim();
}

function inferCameraMotion(text) {
  const t = String(text || '');
  if (/固定机位|Static|定镜/i.test(t)) return 'Static';
  if (/缓推|推进|Push/i.test(t)) return 'Push in';
  if (/缓拉|拉远|Pull/i.test(t)) return 'Pull out';
  if (/横摇|Pan/i.test(t)) return 'Pan';
  if (/跟拍|Tracking/i.test(t)) return 'Tracking';
  return 'Static';
}

function cleanActionBlob(text) {
  let desc = String(text || '');
  // 先剥泄漏进 Action 的约束/口型垃圾（勿经 stripDeliveryAside 误伤「不开口」）
  desc = desc
    .replace(/【音轨硬约束】[\s\S]*$/g, '')
    .replace(/【音轨】[\s\S]*$/g, '')
    .replace(/【口型】[^【\n]*/g, '')
    .replace(/【心声画面：[^\]]*】/g, '')
    .replace(/【心声口型】[^【\n]*/g, '')
    .replace(/<[^>\n]{1,24}>嘴唇紧闭[^【\n。]*/g, '')
    .replace(/内心独白时嘴唇紧闭[^【\n。]*/g, '')
    .replace(/（此时嘴唇紧闭[^）]*）/g, '')
    .replace(/视频全程禁止出现外形[^。\n]*。?/g, '');
  desc = stripDeliveryAside(desc);
  desc = desc
    .replace(/日本动漫画风[^。]{0,120}/g, '动画风格。')
    .replace(/精细赛璐璐[^。]{0,80}/g, '')
    .replace(/若\s*@图片1\s*为宫格[^。；]{0,80}[。；]?/g, '')
    .replace(/禁止成片复刻[^。；]{0,60}[。；]?/g, '')
    .replace(/仅提取统一的室内空间与光线语义[；。]?/g, '')
    .replace(/须单镜头完整连续画面[。；]?/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，。；]\s*[，。；]/g, '。')
    .trim();
  return desc;
}

/** Action 尾注入心声口型包（幂等）；仅当 Dialogue 含 %内心独白 */
function ensureInnerMonologueLipPackInAction(action, dialogue) {
  const hasMono = (Array.isArray(dialogue) ? dialogue : []).some((d) =>
    isInnerMonologueSpeaker(unquoteYamlScalar(d?.speaker))
  );
  let a = cleanActionBlob(action);
  // 去掉旧包再按需重挂，避免重复与脏文本
  a = a.replace(/\s*【心声口型】[^【]*/g, '').trim();
  if (!hasMono) return a;
  a = stripSoundRelatedActionPhrases(a);
  return `${a} ${ARCREEL_INNER_MONOLOGUE_LIP_PACK}`.trim();
}

function universalSegmentToDramaVideoPrompt(text, opts = {}) {
  const body = normalizeUniversalSegmentTextNewlines(text);
  if (!body) {
    return {
      action: '',
      camera_motion: 'Static',
      ambiance_audio: '',
      dialogue: [],
      voice_profiles: [],
    };
  }

  if (isArcReelStructuredPrompt(body)) {
    const parsed = parseArcReelYamlLoose(body);
    // 迁移/修补时清洗；就绪原样路径不走这里
    parsed.action = ensureInnerMonologueLipPackInAction(parsed.action, parsed.dialogue);
    parsed.ambiance_audio = sanitizeAmbianceAudio(parsed.ambiance_audio);
    return parsed;
  }

  const ambiance = sanitizeAmbianceAudio(
    extractSection(body, '环境音')
      .split('\n')
      .map((l) => l.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean)
      .join('，')
  );

  let visual = body;
  visual = stripSection(visual, '环境音');
  visual = stripSection(visual, '音轨硬约束');
  visual = stripSection(visual, '音轨');
  visual = stripSection(visual, '主体与音色');
  visual = stripSection(visual, '台词');

  visual = visual
    .replace(/^【风格锚点】\s*\n?/m, '')
    .replace(/^【场景设定】\s*\n?/m, '')
    .replace(/^【分镜\d*】[^：:\n]*[：:]\s*/gm, '')
    .replace(/^【[^】]+】\s*$/gm, '');

  const actionLines = [];
  for (const line of visual.split('\n')) {
    const raw = String(line || '').trim();
    if (!raw) continue;
    let desc = cleanActionBlob(stripSpeechMarksFromLine(raw));
    desc = desc.replace(/^[，。；、\s]+|[，。；、\s]+$/g, '').trim();
    if (desc) actionLines.push(desc);
  }

  const utterances = deriveUtterances(body);
  const dialogue = [];
  for (const u of utterances) {
    const spoken = String(u.text || '').trim();
    if (!spoken) continue;
    if (u.kind === 'voiceover' || (!u.speaker && u.kind !== 'inner_monologue')) {
      dialogue.push({ speaker: '画外音', line: spoken });
      continue;
    }
    let speaker = String(u.speaker || '').trim();
    if (/^@图片\d+$/.test(speaker) && opts.nameToTag instanceof Map) {
      for (const [name, tag] of opts.nameToTag.entries()) {
        if (tag === speaker) {
          speaker = name;
          break;
        }
      }
    }
    dialogue.push({
      speaker: formatDialogueSpeaker(speaker, {
        innerMonologue: u.kind === 'inner_monologue' || !!u.innerMonologue,
      }),
      line: spoken,
    });
  }

  return {
    action: actionLines.join(' ').trim().slice(0, 600),
    camera_motion: inferCameraMotion(body),
    ambiance_audio: ambiance || '低电平现场环境声',
    dialogue,
    voice_profiles: buildVoiceProfiles(dialogue, opts.characters),
  };
}

function buildVoiceProfiles(dialogue, characters) {
  const list = Array.isArray(characters) ? characters : [];
  const byName = new Map();
  for (const c of list) {
    const name = String(c?.name || '').trim();
    if (!name) continue;
    byName.set(name, String(c.voice_style || '').trim());
  }
  const seen = new Set();
  const profiles = [];
  for (const d of dialogue) {
    const speaker = baseSpeakerName(d?.speaker);
    if (!speaker || speaker === '画外音' || seen.has(speaker)) continue;
    seen.add(speaker);
    const style = byName.get(speaker) || '';
    if (style) profiles.push({ Speaker: speaker, Voice_Style: style });
  }
  return profiles;
}

function parseArcReelYamlLoose(text) {
  const t = String(text || '')
    .replace(/\n【音轨硬约束】[\s\S]*$/m, '')
    .replace(/\n【音轨】[\s\S]*$/m, '')
    .replace(/\n禁止出现：BGM、文字字幕、水印。\s*$/m, '')
    .replace(new RegExp(`\\n${ARCREEL_TWIN_PACK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'), '')
    .trim();
  const actionM = t.match(/^Action:\s*(.*)$/m);
  const action = unquoteYamlScalar((actionM && actionM[1]) || '');
  const camera = unquoteYamlScalar((t.match(/^Camera_Motion:\s*(.*)$/m) || [])[1] || 'Static');
  const ambM = t.match(/^Ambiance_Audio:\s*(.*)$/m);
  const ambiance = unquoteYamlScalar((ambM && ambM[1]) || '');
  const dialogue = [];

  // Dialogue 优先（对齐 ArcReel）；兼容旧 Spoken 稿迁移
  {
    const dlgBlock = (t.split(/^Dialogue:\s*$/m)[1] || '').split(/^Spoken:\s*$/m)[0] || '';
    const speakerRe = /-\s*Speaker:\s*(.+)\n\s*Line:\s*(.+)/g;
    let m;
    while ((m = speakerRe.exec(dlgBlock)) !== null) {
      const speaker = unquoteYamlScalar(m[1]);
      const line = unquoteYamlScalar(m[2]);
      if (!line) continue;
      dialogue.push({
        speaker: formatDialogueSpeaker(speaker, {
          innerMonologue: isInnerMonologueSpeaker(speaker),
        }),
        line,
      });
    }
  }
  if (!dialogue.length) {
    const spokenBlock = (t.split(/^Spoken:\s*$/m)[1] || '').split(/\n【|\n禁止出现/)[0] || '';
    for (const line of spokenBlock.split('\n')) {
      const inner = line.match(/^<([^>]+)>内心独白\s*\{([^}]*)\}/);
      if (inner) {
        dialogue.push({
          speaker: formatDialogueSpeaker(inner[1].trim(), { innerMonologue: true }),
          line: inner[2].trim(),
        });
        continue;
      }
      const sm = line.match(/^<([^>]+)>(?:说)?\s*\{([^}]*)\}/);
      if (sm) dialogue.push({ speaker: sm[1].trim(), line: sm[2].trim() });
      const vo = line.match(/^(?:画外音说|画外音)\s*\{([^}]*)\}/);
      if (vo) dialogue.push({ speaker: '画外音', line: vo[1].trim() });
    }
  }

  const voice_profiles = [];
  const vpBlock = (t.split(/^Voice_Profiles:\s*$/m)[1] || '').split(/^Action:/m)[0] || '';
  const vpRe = /-\s*Speaker:\s*(.+)\n\s*Voice_Style:\s*(.+)/g;
  let m;
  while ((m = vpRe.exec(vpBlock)) !== null) {
    voice_profiles.push({
      Speaker: unquoteYamlScalar(m[1]),
      Voice_Style: unquoteYamlScalar(m[2]),
    });
  }
  return {
    action,
    camera_motion: camera || 'Static',
    ambiance_audio: ambiance,
    dialogue,
    voice_profiles,
  };
}

function yamlQuote(s) {
  const v = String(s ?? '');
  if (v === '') return '""';
  // 与 PyYAML 常见行为接近：含冒号等特殊字符时加引号
  if (/[:#{}[\],&*?|>!%@`]/.test(v) || /^\s|\s$/.test(v) || /\n/.test(v)) {
    return JSON.stringify(v);
  }
  return v;
}

/** 对齐 ArcReel video_prompt_to_yaml */
function dramaVideoPromptToYaml(videoPrompt, opts = {}) {
  const vp = videoPrompt || {};
  const lines = [];
  const profiles = Array.isArray(vp.voice_profiles) ? vp.voice_profiles : [];
  if (profiles.length) {
    lines.push('Voice_Profiles:');
    for (const p of profiles) {
      const sp = unquoteYamlScalar(p.Speaker);
      const st = unquoteYamlScalar(p.Voice_Style);
      lines.push(`- Speaker: ${yamlQuote(sp)}`);
      lines.push(`  Voice_Style: ${yamlQuote(st)}`);
    }
  }
  const dialogueRaw = Array.isArray(vp.dialogue) ? vp.dialogue : [];
  const dialogue = [];
  for (const d of dialogueRaw) {
    const speakerRaw = unquoteYamlScalar(d.speaker) || '画外音';
    const line = unquoteYamlScalar(d.line);
    if (!line) continue;
    dialogue.push({
      speaker: formatDialogueSpeaker(speakerRaw, {
        innerMonologue: isInnerMonologueSpeaker(speakerRaw),
      }),
      line,
    });
  }
  const action = ensureInnerMonologueLipPackInAction(vp.action, dialogue);
  lines.push(`Action: ${yamlQuote(action)}`);
  lines.push(`Camera_Motion: ${yamlQuote(unquoteYamlScalar(vp.camera_motion) || 'Static')}`);
  lines.push(`Ambiance_Audio: ${yamlQuote(unquoteYamlScalar(vp.ambiance_audio))}`);
  if (dialogue.length) {
    lines.push('Dialogue:');
    for (const d of dialogue) {
      lines.push(`- Speaker: ${yamlQuote(d.speaker)}`);
      lines.push(`  Line: ${yamlQuote(d.line)}`);
    }
  }
  return appendArcReelNegativeTail(lines.join('\n').trim(), opts);
}

function convertUniversalSegmentToArcReelYaml(text, opts = {}) {
  let structured = universalSegmentToDramaVideoPrompt(text, opts);
  if (opts.classicFields || opts.narration || opts.dialogue) {
    structured = mergeClassicSpeechIntoDramaPrompt(
      structured,
      {
        ...(opts.classicFields || {}),
        narration: opts.narration != null ? opts.narration : opts.classicFields?.narration,
        dialogue: opts.dialogue != null ? opts.dialogue : opts.classicFields?.dialogue,
      },
      opts
    );
  }
  if (!String(structured.action || '').trim() && !(structured.dialogue || []).length) {
    throw new Error('无法从片段描述提取画面或台词，请先生成全能提示词');
  }
  return dramaVideoPromptToYaml(structured);
}

function extractSpeakersFromArcReelYaml(text) {
  const parsed = parseArcReelYamlLoose(text);
  const names = [];
  const seen = new Set();
  for (const d of parsed.dialogue || []) {
    const s = baseSpeakerName(d.speaker);
    if (!s || s === '画外音' || seen.has(s)) continue;
    seen.add(s);
    names.push(s);
  }
  return names;
}

function normalizeArcReelYamlForSubmit(text) {
  const raw = String(text || '').trim();
  if (!raw || !isArcReelStructuredPrompt(raw)) return raw;
  const structured = universalSegmentToDramaVideoPrompt(raw);
  return dramaVideoPromptToYaml(structured);
}

/** 仅注入/替换 Voice_Profiles，不重写 Action / Dialogue / 负向尾 */
function injectAudioRefsIntoArcReelYaml(yamlText, bindings) {
  const list = Array.isArray(bindings) ? bindings.filter((b) => b && b.name && b.audioIndex) : [];
  let body = String(yamlText || '').trim();
  if (!body || !list.length) return body;

  body = body
    .replace(/^Voice_Profiles:\n(?:[ \t]*- Speaker:[^\n]*\n[ \t]*Voice_Style:[^\n]*\n?)+/m, '')
    .trim();

  const speakers = extractSpeakersFromArcReelYaml(body);
  const byName = new Map(list.map((b) => [b.name, b]));
  const profiles = [];
  const seen = new Set();
  const order = speakers.length ? speakers : list.map((b) => b.name);
  for (const name of order) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const b = byName.get(name);
    if (!b) continue;
    // ArcReel Voice_Style 只写风格；@音频N 为本项目 Agnes/Seedance 参考音绑定扩展
    const style = [b.voiceStyle, `音色参考 @音频${b.audioIndex}`].filter(Boolean).join('；');
    profiles.push({ Speaker: name, Voice_Style: style });
  }
  for (const b of list) {
    if (seen.has(b.name)) continue;
    profiles.push({
      Speaker: b.name,
      Voice_Style: [b.voiceStyle, `音色参考 @音频${b.audioIndex}`].filter(Boolean).join('；'),
    });
  }
  if (!profiles.length) return body;

  const vpLines = ['Voice_Profiles:'];
  for (const p of profiles) {
    vpLines.push(`- Speaker: ${yamlQuote(p.Speaker)}`);
    vpLines.push(`  Voice_Style: ${yamlQuote(p.Voice_Style)}`);
  }
  return `${vpLines.join('\n')}\n${body}`.trim();
}

module.exports = {
  ARCREEL_VIDEO_NEGATIVE_TAIL,
  ARCREEL_TWIN_PACK,
  ARCREEL_INNER_MONOLOGUE_LIP_PACK,
  ARCREEL_SPOKEN_CONSTRAINT,
  isArcReelStructuredPrompt,
  isArcReelSubmitReady,
  looksLikeUniversalOmniPrompt,
  looksLikeClassicVideoPrompt,
  ensureArcReelStructuredForVideoSubmit,
  appendArcReelNegativeTail,
  appendArcReelTwinPack,
  unquoteYamlScalar,
  stripSpeechMarksFromLine,
  stripDeliveryAside,
  stripSoundRelatedActionPhrases,
  sanitizeAmbianceAudio,
  cleanActionBlob,
  ensureInnerMonologueLipPackInAction,
  universalSegmentToDramaVideoPrompt,
  classicStoryboardToDramaVideoPrompt,
  parseClassicVideoPromptProse,
  parseClassicDialogueAndNarration,
  splitClassicDialogueChunks,
  dramaVideoPromptToYaml,
  convertUniversalSegmentToArcReelYaml,
  convertClassicStoryboardToArcReelYaml,
  mergeClassicSpeechIntoDramaPrompt,
  ensureArcReelYamlHasClassicSpeech,
  extractSpeakersFromArcReelYaml,
  injectAudioRefsIntoArcReelYaml,
  normalizeArcReelYamlForSubmit,
  parseArcReelYamlLoose,
  formatDialogueSpeaker,
  baseSpeakerName,
};
