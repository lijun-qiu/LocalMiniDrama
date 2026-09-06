/**
 * 画面描述 ↔ 台词分离（对齐 ArcReel：visual / Action 不含口播原文；Dialogue / utterances 单独承载）。
 * 经典首尾帧、全能、全文解说统一口径。
 */

/** 注入 LLM 系统/用户提示的硬性合同 */
function getDialogueVisualSeparationContract(isEn = false) {
  if (isEn) {
    return `DIALOGUE↔VISUAL SEPARATION (ArcReel-aligned, all modes):
- 「动作：」/ beat bodies = VISUAL ONLY (blocking, expression, lip motion, camera). NEVER paste spoken lines, quote marks, or 「Name: "line"」 inside action/description.
- 「对话：」= spoken lines ONLY as Name："verbatim". NO stage directions in parentheses (（疑惑地）/（画外）etc.) — stage directions go in action, or write 无.
- No dialogue →「对话：无」exactly. Do not invent lines.
- Universal multi-beat: tag lines to beats as「对话：分镜2：Name："line"」(or 镜头2：); ONLY that beat gets lip sync; other beats MUST say 人物闭口无口型，无对白 — no mouth movement, no speech.
- 「音效：」= diegetic ambience/foley only (door, chair creak, footsteps, laughter); may infer from action/atmosphere. NEVER paraphrase dialogue tone/lines. Only「音效：无」when the shot is truly silent.
- Lip sync: action may say "口型同步/开口说话" without quoting the line; the verbatim text lives only under「对话：」.`;
  }
  return `【台词↔画面分离合同（对齐 ArcReel，经典/首尾帧/全能/全文解说统一）】
- 「动作：」与全能「分镜k」正文 = **纯画面**（走位、表情、口型、运镜）。**禁止**把台词原文、引号对白、「角色：…"…"」写进动作/描述。
- 「对话：」= **只**写 角色名："台词原文"。**禁止**括号舞台指示（（疑惑地）（画外）（叹气）等）；舞台指示写进动作，对话侧舞台指示一律写 **无**（或不出现）。
- 无对白 → 必须写 **对话：无**（不要留空省略、不要用动作里「某某回答」代替台词）。**禁止编造对白**。
- 全能多子分镜：对白须标注归属拍「对话：分镜2：角色："原文"」（也可用「镜头2：」）；**仅该拍**写开口/口型同步；其它拍必须写 **人物闭口无口型，无对白**，禁止口型与对白。
- 「音效：」写现场环境声/动作音（门响、椅子吱呀、脚步、笑声等，可从动作/氛围提炼）；**禁止**写对白语气或台词内容；确无环境声才写 **音效：无**。
- 口型：动作里可写「开口说话/口型同步」，台词原文只出现在「对话：」。全能模式：节拍正文纯画面；台词放文末独立「对话：」块（见 MULTI_BEAT 规格）。`;
}

/** 对话字段归一：空 →「无」；去掉首尾空白 */
function normalizeDialogueFieldForPrompt(dialogue) {
  const t = dialogue != null ? String(dialogue).trim() : '';
  if (!t || t === '""' || t === "''") return '无';
  return t;
}

/**
 * 音效字段归一：去掉对白语气侧写；空 →「无」。
 * 保留门响/椅子/脚步等现场 Foley。
 */
function normalizeSoundEffectForPrompt(soundEffect) {
  let t = soundEffect != null ? String(soundEffect).trim() : '';
  if (!t || t === '""' || t === "''" || /^无(音效)?$/u.test(t)) return '无';
  t = t
    .replace(/(?:^|[，,、；;])\s*对话(?:音量|声线|音色)[^，,、；;。]*/gu, '')
    .replace(/(?:^|[，,、；;])\s*[\u4e00-\u9fffA-Za-z0-9·・]{1,8}语气[^，,、；;。]*/gu, '')
    .replace(/(?:^|[，,、；;])\s*(?:口型同步|对白清晰)[^，,、；;。]*/gu, '')
    .replace(/^[，,、；;\s]+|[，,、；;\s]+$/g, '')
    .replace(/[，,]{2,}/g, '，')
    .trim();
  return t || '无';
}

/**
 * 从动作/氛围文案提炼现场 Foley（库内 sound_effect 为空时的兜底）。
 * 优先摘取文中已写的短「…声」，再按关键词补常见事件音；去重压短。
 */
function inferDiegeticSoundEffectFromTexts(...texts) {
  const blob = texts
    .map((t) => (t != null ? String(t) : ''))
    .filter((t) => t.trim())
    .join('。');
  if (!blob.trim()) return '';

  const found = [];
  const seen = new Set();
  const push = (s) => {
    let t = String(s || '')
      .replace(/^[的地得与和]/u, '')
      .replace(/^(?:只有|安静只有|室内安静只有)/u, '')
      .trim();
    if (!t || t.length < 2 || t.length > 16) return;
    if (/对白|语气|台词|音量|开口|说话/.test(t)) return;
    // 丢掉「她笑声越来越大声」这类整句碎片，只留词级
    if (/[她他其我你]/.test(t) || /越来越|突然|然后/.test(t)) return;
    if (!/[声响鸣响]$/u.test(t) && !/回响|嗡鸣/.test(t)) {
      if (/吱呀|沙沙|脚步|翻页|门|椅|笑|叹|衣料|纸/.test(t)) t = `${t.replace(/声$/u, '')}声`;
      else return;
    }
    const key = t.replace(/的/g, '');
    if (seen.has(key)) return;
    // 若已有更短包含关系则跳过
    for (const prev of found) {
      if (prev.includes(t) || t.includes(prev)) {
        if (t.length >= prev.length) return;
        // 用更短的替换
        const idx = found.indexOf(prev);
        found[idx] = t;
        seen.delete(prev.replace(/的/g, ''));
        seen.add(key);
        return;
      }
    }
    seen.add(key);
    found.push(t);
  };

  let m;
  const emitRe = /发出([^。，,、；;]{1,12}声)/g;
  while ((m = emitRe.exec(blob)) != null) push(m[1]);

  const phraseRe =
    /((?:椅子|门|纸张|简历|树叶|窗外|走廊|衣料)?(?:的)?(?:吱呀|沙沙|脚步|翻页|回响|嗡鸣|轻响|撞击|敲门|开关|落座|笑声|哭声|叹息)(?:声|回响)?)/g;
  while ((m = phraseRe.exec(blob)) != null) push(m[1]);

  const heuristics = [
    [/门被推开|推开门|开门|关门|摔门/, '门开关声'],
    [/椅子|落座|坐下时/, '椅子轻响'],
    [/大步走|脚步|步伐|走出|走进|走廊/, '脚步声'],
    [/笑了|笑声|大笑|忍俊不禁/, '笑声'],
    [/风吹树叶|树叶|沙沙/, '树叶沙沙声'],
    [/翻页|合上简历|简历滑/, '纸张轻响'],
    [/拍打衣服|衣褶/, '衣料轻响'],
    [/叹气/, '叹息声'],
  ];
  for (const [re, label] of heuristics) {
    if (re.test(blob)) push(label);
  }

  // 对话戏且无任何动作音时：给一点房间底噪，避免整集「音效：无」
  if (!found.length) {
    const loc = texts.map((t) => String(t || '')).join('');
    if (/办公|会议|室内|工位/.test(blob + loc)) push('室内环境轻响');
    else if (/走廊|楼道/.test(blob + loc)) push('走廊环境回响');
    else if (/街|室外|户外/.test(blob + loc)) push('环境底噪');
  }

  return found.slice(0, 4).join('，');
}

/**
 * 解析本镜最终音效：优先库字段；空则从动作/氛围/地点提炼；再空才「无」。
 */
function resolveSoundEffectForStoryboard(sb) {
  const fromField = normalizeSoundEffectForPrompt(sb && sb.sound_effect);
  if (fromField !== '无') return fromField;
  const inferred = inferDiegeticSoundEffectFromTexts(
    sb && sb.action,
    sb && sb.atmosphere,
    sb && sb.result,
    sb && sb.location,
    sb && sb.title
  );
  return normalizeSoundEffectForPrompt(inferred);
}

/**
 * 若成稿写了「音效：无」但本镜能提炼出现场声，则替换；无标签则补上。
 */
function sanitizeClassicVideoPromptSoundEffect(prompt, soundEffectResolved) {
  const raw = prompt != null ? String(prompt) : '';
  if (!raw.trim()) return raw;
  const sfx = normalizeSoundEffectForPrompt(soundEffectResolved);
  if (sfx === '无') {
    // 仍保证有音效标签（规则拼装口径）
    if (/音效\s*[：:]/.test(raw)) return raw;
    if (/=VideoRatio\s*:/i.test(raw)) {
      return raw.replace(/(=VideoRatio\s*:[^\n]*)/i, `音效：无\n$1`);
    }
    return `${raw}\n音效：无`;
  }

  if (/音效\s*[：:]\s*无(?:\s|[。.\n]|$)/.test(raw)) {
    return raw.replace(/音效\s*[：:]\s*无(?=\s|[。.\n]|$)/g, `音效：${sfx}`);
  }
  if (/音效\s*[：:]/.test(raw)) {
    // 已有非空音效：保留 AI 写法（可能更细），仅当过短时用解析值
    return raw.replace(/音效\s*[：:]\s*([^\n。]*)/, (full, body) => {
      const cur = normalizeSoundEffectForPrompt(body);
      if (cur === '无' || cur.length < 2) return `音效：${sfx}`;
      return full;
    });
  }
  if (/=VideoRatio\s*:/i.test(raw)) {
    return raw.replace(/(=VideoRatio\s*:[^\n]*)/i, `音效：${sfx}\n$1`);
  }
  // 插在时长前或文末
  if (/时长\s*[：:]/.test(raw)) {
    return raw.replace(/时长\s*[：:]/, `音效：${sfx}\n时长：`);
  }
  return `${raw}\n音效：${sfx}`;
}

/**
 * 从画面描述中剥离已嵌入的引号台词 /「角色：说"…"」，避免与「对话：」混写。
 * 保留「开口/口型」等视觉措辞。
 */
function stripQuotedSpeechFromVisual(action) {
  let a = action != null ? String(action) : '';
  if (!a.trim()) return a;
  a = a
    // @图片N 说："…"
    .replace(
      /@图片\s*\d+\s*(?:说|道|喊|叫|答|问|念|读|低语|怒吼)?[：:]\s*[「」""][^「」""]{0,200}[」""]/g,
      '说话口型'
    )
    // 角色名："台词" / 角色名：说"台词"
    .replace(
      /[\u4e00-\u9fffA-Za-z0-9]{1,16}\s*(?:说|道|喊|叫|答|问)?\s*[：:]\s*[「」""][^「」""]{1,200}[」""]/g,
      '说话口型'
    )
    // 无说话人前缀的 说："…"
    .replace(/(?:说|道|喊|叫|答|问)[：:]\s*[「」""][^「」""]{1,200}[」""]/g, '说话口型')
    // 残留成对引号短句（像台词）
    .replace(/[「」""][^「」""]{2,80}[」""]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，,]{2,}/g, '，')
    .replace(/\s*[，,]\s*[。.]/g, '。')
    .trim();
  return a;
}

/**
 * 从 dialogue 字段抽出「纯台词正文」片段（去掉角色名与引号）。
 */
function extractDialogueUtteranceBodies(dialogue) {
  const dlg = normalizeDialogueFieldForPrompt(dialogue);
  if (!dlg || dlg === '无') return [];
  const bodies = [];
  const labeled =
    /[\u4e00-\u9fffA-Za-z0-9·・\.]{1,16}\s*[：:]\s*[「」""]?([^「」""\n]{2,120}?)(?=[」""]?(?:\s*[\u4e00-\u9fffA-Za-z0-9·・\.]{1,16}\s*[：:]|$))/g;
  let m;
  while ((m = labeled.exec(dlg)) != null) {
    const body = String(m[1] || '')
      .replace(/^[「」""]+|[」""]+$/g, '')
      .trim();
    if (body.length >= 2) bodies.push(body);
  }
  if (bodies.length === 0) {
    // 无「角色：」结构时，整段当作一句
    const fallback = dlg.replace(/[「」""]/g, '').trim();
    if (fallback.length >= 2) bodies.push(fallback);
  }
  return bodies;
}

/** 压掉空白/标点，便于把「转述台词」与 dialogue 原文对齐 */
function collapseSpeechNoise(s) {
  return String(s || '')
    .replace(/[\s「」""''。．.！？!?，,；;：:…\-—~～·・]/g, '')
    .trim();
}

/**
 * 从单句台词生成用于匹配动作回声的变体（去语气词/标点）。
 */
function expandDialogueVariants(body) {
  const out = new Set();
  const push = (x) => {
    const t = String(x || '').trim();
    if (t.length >= 4) out.add(t);
  };
  let t = String(body || '').trim();
  push(t);
  t = t.replace(/[「」""']/g, '').trim();
  push(t);
  t = t.replace(/[。．.！？!?，,；;…]+$/g, '').trim();
  push(t);
  // 按句号拆开，便于「他说A。散了吧B」只命中半句
  for (const chunk of t.split(/[。．.！？!?]+/)) {
    const c = chunk.replace(/^[，,；;\s]+|[，,；;\s]+$/g, '').trim();
    if (c.length >= 4) push(c);
  }
  // 反复去掉句首语气词 / 单一人称（保留「你们/我们」）
  let core = t;
  for (let i = 0; i < 3; i += 1) {
    const next = core
      .replace(/^[诶啊呢嘛呐吧哦嗯呵哈欸唉哎—\-…\s，,]+/u, '')
      .replace(/^(?:这家|这个|那个)/u, '')
      .replace(/^[我你他她它](?!们)/u, '')
      .trim();
    if (next === core) break;
    core = next;
  }
  push(core);
  push(core.replace(/[呐呢嘛吧啊呀了欸]$/u, ''));
  return [...out];
}

/**
 * 把台词变体编成「字间可插标点」的正则，吃掉「他说公司太low都不会说人话」这类转述。
 */
function flexibleUtterancePattern(body) {
  const compact = collapseSpeechNoise(body);
  if (compact.length < 6) return null;
  const chars = [...compact];
  const slice = chars.length > 36 ? chars.slice(0, 36) : chars;
  const esc = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return slice.map((ch) => esc(ch)).join('[\\s「」""\'\'。．.！？!?，,；;：:…\\-—~～·・]*');
}

/** 显式口型/开口标记 */
const LIP_SYNC_MARK_RE = /开口说话|说话口型|口型同步|开口对口型|对口型/;

/**
 * 子镜头边界：允许「镜头2（快速切镜）：」这类括号注解。
 */
const SHOT_BOUNDARY_RE = /(?:镜头|分镜)\s*\d+(?:\s*[（(][^）)]*[）)])?\s*[：:]/;
const SHOT_BOUNDARY_SPLIT_RE = /(?=(?:镜头|分镜)\s*\d+(?:\s*[（(][^）)]*[）)])?\s*[：:])/;
const SHOT_HEAD_RE = /^(?:镜头|分镜)\s*(\d+)/;

function joinShotSegments(segs) {
  return (segs || [])
    .map((s) => String(s || '').replace(/[。.\s]+$/g, '').trim())
    .filter(Boolean)
    .join('。');
}

/**
 * 动作里的说话意图（尚未写成「开口说话」）：回答/追问/嘀咕等。
 * 有对白字段时应视为开口拍，避免被强制「闭口无对白」导致 Agnes 复读/编词。
 * 刻意不含裸「说/问」（避免「说什么/问题/问话」误伤）。
 */
const SPEECH_ACT_INTENT_RE =
  /回答|答道|说道|说着|说了|提问|追问|嘀咕|低语|怒吼|喊道|叫道|(?:一边\S{0,8})?嘀咕|(?:耐着性子|继续)?追问|(?:他|她|其)(?:说|问|喊|叫)(?![题话做人明服])|(?:[\u4e00-\u9fff]{1,4})(?:回答|追问|提问|嘀咕)|(?:[\u4e00-\u9fff]{1,4})问(?=[你我他她这那为啥「」"'“”])/;

function shotSegmentLooksSpeaking(seg) {
  const s = String(seg || '');
  return LIP_SYNC_MARK_RE.test(s) || SPEECH_ACT_INTENT_RE.test(s);
}

function markShotSegmentSpeaking(seg) {
  let t = String(seg || '')
    .replace(/，?\s*人物闭口无口型/g, '')
    .replace(/，?\s*闭口无口型/g, '')
    .replace(/，?\s*无对白/g, '')
    .replace(/，?\s*无对话/g, '')
    .replace(/[。.\s,，]+$/g, '')
    .trim();
  if (!LIP_SYNC_MARK_RE.test(t)) t += '，开口说话口型同步';
  return t;
}

function markShotSegmentSilent(seg) {
  let t = String(seg || '')
    .replace(/，?\s*(?:说话口型同步|说话口型|口型同步|开口说话|开口对口型|对口型)/g, '')
    .replace(/[。.\s,，]+$/g, '')
    .replace(/([：:])\s*[，,]+/g, '$1')
    .trim();
  if (!/闭口无口型/.test(t)) t += '，人物闭口无口型';
  if (!/无对白|无对话/.test(t)) t += '，无对白';
  // 「镜头4：，人物闭口」→「镜头4：人物闭口」
  t = t.replace(/([：:])\s*，+/g, '$1');
  return t;
}

/**
 * 有对白却无开口拍时：优先提升含说话意图的拍；否则按说话人姓名命中；再否则抬第一拍。
 * 禁止「对话全文 + 全拍闭口」提交给 Agnes。
 */
function ensureSpeakingShotsForDialogue(action, dialogue) {
  const dlgNorm = normalizeDialogueFieldForPrompt(dialogue);
  const hasDlg = dlgNorm && dlgNorm !== '无';
  let a = String(action || '').trim();
  if (!hasDlg || !a) return a;

  if (!SHOT_BOUNDARY_RE.test(a)) {
    if (LIP_SYNC_MARK_RE.test(a) || SPEECH_ACT_INTENT_RE.test(a)) {
      return markShotSegmentSpeaking(a);
    }
    // 单段动作有对白：强制开口，去掉闭口冲突
    return markShotSegmentSpeaking(a);
  }

  if (extractSpeakingShotIndexesFromAction(a).length) {
    return ensureSpeakersHaveSpeakingShots(a, dlgNorm);
  }

  const lines = parseNamedDialogueLines(dlgNorm);
  const names = lines.map((l) => l.name).filter(Boolean);
  const segs = a.split(SHOT_BOUNDARY_SPLIT_RE);

  let promoted = false;
  let next = segs.map((seg) => {
    const s = String(seg || '').trim();
    if (!s || !SHOT_HEAD_RE.test(s)) return s;
    if (SPEECH_ACT_INTENT_RE.test(s)) {
      promoted = true;
      return markShotSegmentSpeaking(s);
    }
    return s;
  });

  if (!promoted && names.length) {
    next = next.map((seg) => {
      const s = String(seg || '').trim();
      if (!s || !SHOT_HEAD_RE.test(s)) return s;
      if (names.some((n) => s.includes(n))) {
        promoted = true;
        return markShotSegmentSpeaking(s);
      }
      return s;
    });
  }

  if (!promoted) {
    next = next.map((seg) => {
      const s = String(seg || '').trim();
      if (!promoted && s && SHOT_HEAD_RE.test(s)) {
        promoted = true;
        return markShotSegmentSpeaking(s);
      }
      return s;
    });
  }

  a = joinShotSegments(next);
  return ensureSpeakersHaveSpeakingShots(a, dlgNorm);
}

/**
 * 对话标注完成后：开口拍若未被「对话：镜头N」引用，改回闭口。
 * 避免「有口型无台词」诱发 Agnes 临场编词。
 */
function silenceUntaggedSpeakingShots(action, dialogue) {
  const a = String(action || '').trim();
  const dlg = normalizeDialogueFieldForPrompt(dialogue);
  if (!a || !dlg || dlg === '无' || !SHOT_BOUNDARY_RE.test(a)) return a;
  const tags = new Set(extractDialogueShotTags(dlg));
  if (!tags.size) return a;

  const segs = a.split(SHOT_BOUNDARY_SPLIT_RE);
  return joinShotSegments(
    segs.map((seg) => {
      const s = String(seg || '').trim();
      const m = s.match(SHOT_HEAD_RE);
      if (!m) return s;
      const idx = Number(m[1]);
      if (shotSegmentLooksSpeaking(s) && !tags.has(idx)) {
        return markShotSegmentSilent(s);
      }
      return s;
    })
  );
}

/**
 * 对话里出现的说话人，若当前开口拍均不含其姓名，则提升一拍含该名的静音镜。
 * 避免「林薇台词却整段挂在陈浩开口拍」导致错念/复读。
 */
function ensureSpeakersHaveSpeakingShots(action, dialogue) {
  const dlgNorm = normalizeDialogueFieldForPrompt(dialogue);
  if (!dlgNorm || dlgNorm === '无' || !SHOT_BOUNDARY_RE.test(action)) return action;

  const names = [
    ...new Set(parseNamedDialogueLines(dlgNorm).map((l) => l.name).filter(Boolean)),
  ];
  if (!names.length) return action;

  const segs = String(action).split(SHOT_BOUNDARY_SPLIT_RE);
  const hints = new Map();
  for (const seg of segs) {
    const m = String(seg).match(SHOT_HEAD_RE);
    if (!m) continue;
    hints.set(Number(m[1]), String(seg));
  }

  let speaking = extractSpeakingShotIndexesFromAction(action);
  const promoteIdx = new Set();
  for (const name of names) {
    const covered = speaking.some((idx) => (hints.get(idx) || '').includes(name));
    if (covered) continue;
    const candidate = [...hints.entries()].find(
      ([idx, body]) => body.includes(name) && !speaking.includes(idx) && !promoteIdx.has(idx)
    );
    if (candidate) {
      promoteIdx.add(candidate[0]);
      speaking = speaking.concat(candidate[0]);
    }
  }

  if (!promoteIdx.size) return action;

  return joinShotSegments(
    segs.map((seg) => {
      const s = String(seg || '').trim();
      const m = s.match(SHOT_HEAD_RE);
      if (!m) return s;
      if (promoteIdx.has(Number(m[1]))) return markShotSegmentSpeaking(s);
      return s;
    })
  );
}

/**
 * 画面动作里去掉台词回声：引号对白 + dialogue 中出现的正文复述
 * （如「陈浩回答你们公司在找人」→「陈浩开口说话」；「他说公司太low…」→「他开口说话」）。
 */
function stripDialogueEchoFromVisual(action, dialogue) {
  let a = stripQuotedSpeechFromVisual(action);
  if (!a.trim()) return a;

  const bodies = extractDialogueUtteranceBodies(dialogue);
  const variants = new Set();
  for (const body of bodies) {
    for (const v of expandDialogueVariants(body)) variants.add(v);
  }

  // 长串优先替换，避免短串先切碎导致长串匹配失败
  const ordered = [...variants].sort((x, y) => y.length - x.length);
  for (const body of ordered) {
    if (body.length < 4) continue;
    const escaped = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 「回答/说/问」+ 台词 → 开口说话（允许较短）
    a = a.replace(
      new RegExp(`(?:回答|答道|说道|说|问|喊|叫|嘀咕|追问)\\s*${escaped}`, 'g'),
      '开口说话'
    );
    // 裸露复述仅处理较长片段，避免「公司在找人」之类切碎「回答你们公司在找人」
    if (body.length >= 8) {
      a = a.replace(new RegExp(escaped, 'g'), '');
    }

    const flex = flexibleUtterancePattern(body);
    if (!flex) continue;
    // 「他/她说|问|回答…」+ 柔性台词 → 开口说话
    a = a.replace(
      new RegExp(`(?:他|她|其)?(?:回答|答道|说道|说|问|喊|叫|嘀咕|追问)\\s*${flex}`, 'g'),
      '开口说话'
    );
    // 较长柔性裸露复述（≥8 压缩字）
    if (collapseSpeechNoise(body).length >= 8) {
      a = a.replace(new RegExp(flex, 'g'), '');
    }
  }

  a = a
    .replace(/开口说话(?=镜头)/g, '开口说话。')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[。.]{2,}/g, '。')
    .replace(/\s*[，,]\s*[。.]/g, '。')
    .replace(/([：:])\s*[，,。.]/g, '$1')
    .trim();

  // 动作含「镜头k/分镜k」时：有对白回声/开口/说话意图的子镜头保留口型，其余强制闭口无口型
  if (SHOT_BOUNDARY_RE.test(a)) {
    const dlgNorm = normalizeDialogueFieldForPrompt(dialogue);
    const hasDlg = dlgNorm && dlgNorm !== '无';
    const segs = a.split(SHOT_BOUNDARY_SPLIT_RE);
    a = joinShotSegments(
      segs.map((seg) => {
        const s = String(seg || '').trim();
        if (!s) return s;
        const isShot = SHOT_HEAD_RE.test(s);
        if (!isShot) return s;
        const speaks = hasDlg && shotSegmentLooksSpeaking(s);
        if (!hasDlg || !speaks) return markShotSegmentSilent(s);
        return markShotSegmentSpeaking(s);
      })
    );
    a = ensureSpeakingShotsForDialogue(a, dialogue);
  } else {
    const dlgNorm = normalizeDialogueFieldForPrompt(dialogue);
    if (!dlgNorm || dlgNorm === '无') {
      a = markShotSegmentSilent(a);
    } else {
      a = ensureSpeakingShotsForDialogue(a, dialogue);
    }
  }

  return a;
}

/** 经典提示词字段标签（用于粘连拆分与重排） */
const CLASSIC_FIELD_LABELS =
  '场景|镜头标题|动作|对话|对白|解说旁白|结果|景别|镜头角度|运镜|氛围|情绪|情绪强度|配乐|音效|时长|风格';

/**
 * 从「对话：」正文里剥出误并入的「结果：…」及其后字段。
 * @returns {{ dialogue: string, peeled: string }}
 */
function peelTrailingFieldsFromDialogueBody(dialogueBody) {
  let body = dialogueBody != null ? String(dialogueBody) : '';
  if (!body.trim()) return { dialogue: '', peeled: '' };
  // 对话正文内出现「结果：/景别：/…」视为字段粘连，切开
  const resultCut = body.search(/(?:^|[\s。．.])结果\s*[：:]/);
  const otherCut = body.search(
    /(?:^|[\s。．.])(?:景别|镜头角度|运镜|氛围|情绪|情绪强度|配乐|音效|时长|风格)\s*[：:]/
  );
  let cutAt = -1;
  if (resultCut >= 0) cutAt = resultCut;
  if (otherCut >= 0 && (cutAt < 0 || otherCut < cutAt)) cutAt = otherCut;
  if (cutAt < 0) {
    // 无标点粘连：……玩笑。"结果：……
    const glued = body.search(/结果\s*[：:]/);
    if (glued >= 0) cutAt = glued;
  }
  if (cutAt < 0) return { dialogue: body.trim(), peeled: '' };
  let dlg = body.slice(0, cutAt).replace(/[\s。．.]+$/g, '').trim();
  let peeled = body.slice(cutAt).replace(/^[\s。．.]+/, '').trim();
  if (peeled && !/^(?:结果|景别|镜头角度)/.test(peeled)) {
    const m = peeled.match(new RegExp(`^[^]*?((?:${CLASSIC_FIELD_LABELS})\\s*[：:][\\s\\S]*)$`));
    if (m) peeled = m[1];
  }
  return { dialogue: dlg, peeled };
}

/**
 * 抽出动作里带开口口型 / 说话意图的子镜头序号。
 */
function extractSpeakingShotIndexesFromAction(action) {
  const a = String(action || '');
  if (!SHOT_BOUNDARY_RE.test(a)) return [];
  const segs = a.split(SHOT_BOUNDARY_SPLIT_RE);
  const out = [];
  for (const seg of segs) {
    const m = String(seg).match(SHOT_HEAD_RE);
    if (!m) continue;
    if (shotSegmentLooksSpeaking(seg)) {
      out.push(Number(m[1]));
    }
  }
  return out;
}

/**
 * 对话正文中已标注的镜头序号。
 */
function extractDialogueShotTags(dialogue) {
  const tags = [];
  const re = /(?:镜头|分镜)\s*(\d+)\s*[：:]/g;
  let m;
  while ((m = re.exec(String(dialogue || ''))) != null) {
    tags.push(Number(m[1]));
  }
  return tags;
}

/**
 * 解析「角色："台词"」列表。
 */
function parseNamedDialogueLines(dialogue) {
  const dlg = normalizeDialogueFieldForPrompt(dialogue);
  if (!dlg || dlg === '无') return [];
  // 去掉已有的 镜头k：/分镜k： 前缀，只留说话行
  const stripped = dlg
    .replace(/(?:镜头|分镜)\s*\d+\s*[：:]\s*/g, '')
    .trim();
  const lines = [];
  const re =
    /([\u4e00-\u9fffA-Za-z0-9·・\.]{1,16})\s*[：:]\s*[「」""]?([^「」""\n]{1,200}?)(?=[」""]?\s*(?:[\u4e00-\u9fffA-Za-z0-9·・\.]{1,16}\s*[：:]|(?:镜头|分镜)\s*\d+|$))/g;
  let m;
  while ((m = re.exec(stripped)) != null) {
    const name = String(m[1] || '').trim();
    const text = String(m[2] || '')
      .replace(/^[「」""]+|[」""]+$/g, '')
      .trim();
    if (!name || name === '无' || /^(?:镜头|分镜)\d*$/.test(name)) continue;
    if (text.length < 1) continue;
    lines.push({ name, text, formatted: `${name}："${text}"` });
  }
  if (!lines.length && stripped && stripped !== '无') {
    lines.push({ name: '', text: stripped, formatted: stripped });
  }
  return lines;
}

/**
 * 已标注的「镜头N：角色」是否与开口拍画面一致。
 * 仅检查 ⊆ speaking 不够：AI 常把多句都标成镜头1。
 */
function dialogueTagsAlignWithSpeakingShots(dialogue, action, speaking) {
  const dlg = String(dialogue || '');
  const tags = extractDialogueShotTags(dlg);
  if (!tags.length || !speaking.length) return false;
  if (!tags.every((t) => speaking.includes(t))) return false;

  const segs = String(action || '').split(SHOT_BOUNDARY_SPLIT_RE);
  const shotHints = new Map();
  for (const seg of segs) {
    const m = String(seg).match(SHOT_HEAD_RE);
    if (!m) continue;
    const idx = Number(m[1]);
    if (speaking.includes(idx)) shotHints.set(idx, String(seg));
  }

  const re =
    /(?:镜头|分镜)\s*(\d+)\s*[：:]\s*([\u4e00-\u9fffA-Za-z0-9·・\.]{1,16})\s*[：:]/g;
  let m;
  while ((m = re.exec(dlg)) != null) {
    const shot = Number(m[1]);
    const name = String(m[2] || '').trim();
    if (!name || name === '无') continue;
    const namedShots = speaking.filter((idx) => (shotHints.get(idx) || '').includes(name));
    // 说话人明确出现在其它开口拍，却标到不含该名的拍 → 需重分
    if (namedShots.length > 0 && !namedShots.includes(shot)) return false;
  }
  return true;
}

/**
 * 把台词按开口子镜头标注：对话：镜头2：林薇："…" 镜头3：陈浩："…"
 * 避免「镜头4 无对白」与整段对话字段看起来冲突。
 * 已标注但归属不在开口拍内、或说话人与画面拍不一致时重新分配。
 */
function formatClassicDialogueTaggedToShots(dialogue, action) {
  const dlg = normalizeDialogueFieldForPrompt(dialogue);
  if (!dlg || dlg === '无') return '无';
  const speaking = extractSpeakingShotIndexesFromAction(action);
  const lines = parseNamedDialogueLines(dlg);
  if (!lines.length) return dlg;
  if (!speaking.length) return dlg;

  // 已按镜头标注且归属与开口拍/说话人一致 → 仅规范化「分镜→镜头」
  if (/(?:镜头|分镜)\s*\d+\s*[：:]/.test(dlg) && speaking.length) {
    if (dialogueTagsAlignWithSpeakingShots(dlg, action, speaking)) {
      return dlg.replace(/分镜(\d+)/g, '镜头$1');
    }
    // 归属越界或说话人错拍：剥掉旧标签后按开口拍重分
  }

  if (speaking.length === 1) {
    return `镜头${speaking[0]}：${lines.map((l) => l.formatted).join('')}`;
  }

  // 多开口拍：按说话人名匹配动作段；同名轮询到各开口拍
  const segs = String(action || '').split(SHOT_BOUNDARY_SPLIT_RE);
  const shotHints = new Map();
  for (const seg of segs) {
    const m = String(seg).match(SHOT_HEAD_RE);
    if (!m) continue;
    const idx = Number(m[1]);
    if (!speaking.includes(idx)) continue;
    shotHints.set(idx, String(seg));
  }

  const usedCount = new Map();
  const parts = [];
  for (const line of lines) {
    let target = null;
    if (line.name) {
      const candidates = speaking.filter((idx) => {
        const hint = shotHints.get(idx) || '';
        return hint.includes(line.name);
      });
      if (candidates.length === 1) target = candidates[0];
      else if (candidates.length > 1) {
        const n = usedCount.get(line.name) || 0;
        target = candidates[n % candidates.length];
        usedCount.set(line.name, n + 1);
      }
    }
    if (target == null) {
      const n = usedCount.get('__rr') || 0;
      target = speaking[n % speaking.length];
      usedCount.set('__rr', n + 1);
    }
    parts.push(`镜头${target}：${line.formatted}`);
  }
  return parts.join(' ');
}

/**
 * 规范化经典 video_prompt 版式：
 * - 字段换行，禁止「无对白对话：」「口型同步镜头3」粘连
 * - 「结果：」不得留在「对话：」正文内
 * - 多子镜头时对话标注到开口镜头
 */
function normalizeClassicVideoPromptLayout(prompt, { dialogue, action, result } = {}) {
  let raw = prompt != null ? String(prompt) : '';
  if (!raw.trim()) return raw;

  // 1) 粘连修复：口型/无对白 紧贴下一镜头或「对话：」
  raw = raw
    .replace(/(口型同步|开口说话|闭口无口型|无对白|无对话)\s*(?=(?:镜头|分镜)\s*\d+)/g, '$1。')
    .replace(/(无对白|无对话|闭口无口型)\s*(?=对话\s*[：:])/g, '$1\n')
    .replace(/(口型同步|开口说话)\s*(?=对话\s*[：:])/g, '$1\n')
    .replace(/([^\n])(结果\s*[：:])/g, '$1\n$2')
    .replace(/([^\n])(对话\s*[：:])/g, '$1\n$2')
    .replace(/([^\n])(动作\s*[：:])/g, '$1\n$2')
    .replace(/([^\n])(景别\s*[：:])/g, '$1\n$2')
    .replace(/([^\n])(镜头角度\s*[：:])/g, '$1\n$2')
    .replace(/([^\n])(运镜\s*[：:])/g, '$1\n$2')
    .replace(/([^\n])(氛围\s*[：:])/g, '$1\n$2')
    .replace(/([^\n])(音效\s*[：:])/g, '$1\n$2')
    .replace(/([^\n])(时长\s*[：:])/g, '$1\n$2')
    .replace(/([^\n])(风格\s*[：:])/g, '$1\n$2')
    .replace(/([^\n])(=VideoRatio\s*:)/gi, '$1\n$2');

  // 2) 按行/句号切字段
  const fieldRe = new RegExp(
    `(?:^|[\\n。．])\\s*((?:${CLASSIC_FIELD_LABELS})\\s*[：:]|=VideoRatio\\s*:)`,
    'gi'
  );
  // 更稳：先按换行，再在行内按标签拆
  const chunks = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const t = String(line || '').trim();
    if (!t) continue;
    const parts = t.split(
      new RegExp(`(?=(?:(?:${CLASSIC_FIELD_LABELS})\\s*[：:]|=VideoRatio\\s*:))`, 'i')
    );
    for (const p of parts) {
      const s = String(p || '').trim();
      if (s) chunks.push(s);
    }
  }

  const order = [
    '场景',
    '镜头标题',
    '动作',
    '对话',
    '解说旁白',
    '结果',
    '景别',
    '镜头角度',
    '运镜',
    '氛围',
    '情绪',
    '情绪强度',
    '配乐',
    '音效',
    '时长',
    '风格',
  ];
  const map = new Map();
  let ratio = '';
  for (const chunk of chunks) {
    if (/^=VideoRatio\s*:/i.test(chunk)) {
      ratio = chunk.replace(/^=VideoRatio\s*:/i, '').trim();
      continue;
    }
    const m = chunk.match(new RegExp(`^(${CLASSIC_FIELD_LABELS})\\s*[：:]\\s*([\\s\\S]*)$`));
    if (!m) continue;
    let key = m[1] === '对白' ? '对话' : m[1];
    let body = String(m[2] || '').trim();
    if (key === '对话') {
      const peeled = peelTrailingFieldsFromDialogueBody(body);
      body = peeled.dialogue;
      if (peeled.peeled) {
        // 把剥出的结果等再解析塞回 map
        const subParts = peeled.peeled.split(
          new RegExp(`(?=(?:(?:${CLASSIC_FIELD_LABELS})\\s*[：:]))`)
        );
        for (const sp of subParts) {
          const sm = String(sp).trim().match(new RegExp(`^(${CLASSIC_FIELD_LABELS})\\s*[：:]\\s*([\\s\\S]*)$`));
          if (!sm) continue;
          const sk = sm[1] === '对白' ? '对话' : sm[1];
          if (sk === '对话') continue;
          if (!map.has(sk) || !map.get(sk)) map.set(sk, String(sm[2] || '').trim());
        }
      }
    }
    if (key === '动作') {
      body = stripDialogueEchoFromVisual(body, dialogue != null ? dialogue : map.get('对话'));
    }
    if (key === '风格') {
      // AI 偶发把口型约束写进风格行，会与「对话：」冲突
      body = body
        .replace(/，?\s*人物闭口无口型/g, '')
        .replace(/，?\s*闭口无口型/g, '')
        .replace(/，?\s*无对白/g, '')
        .replace(/，?\s*无对话/g, '')
        .replace(/，?\s*开口说话口型同步/g, '')
        .replace(/[，,]{2,}/g, '，')
        .replace(/^[，,\s]+|[，,\s]+$/g, '')
        .trim();
    }
    map.set(key, body);
  }

  // 字段优先覆盖（库内权威）
  if (action != null && String(action).trim()) {
    map.set('动作', stripDialogueEchoFromVisual(action, dialogue != null ? dialogue : map.get('对话')));
  }
  if (result != null && String(result).trim()) {
    map.set('结果', String(result).trim());
  }

  let actionBody = map.get('动作') || '';
  let dlgBody =
    dialogue != null && String(dialogue).trim()
      ? normalizeDialogueFieldForPrompt(dialogue)
      : normalizeDialogueFieldForPrompt(map.get('对话'));
  // 再次确保对话不含结果
  {
    const peeled = peelTrailingFieldsFromDialogueBody(dlgBody);
    dlgBody = peeled.dialogue;
    if (peeled.peeled && /结果\s*[：:]/.test(peeled.peeled) && !map.get('结果')) {
      const rm = peeled.peeled.match(/结果\s*[：:]\s*([^]*?)(?=(?:景别|镜头角度|运镜|氛围|音效|时长|风格)\s*[：:]|$)/);
      if (rm) map.set('结果', rm[1].trim());
    }
  }
  // 结果文案不得出现在对话正文
  const resultBody = map.get('结果') || '';
  if (resultBody && dlgBody && dlgBody !== '无') {
    const compactResult = resultBody.replace(/[\s「」""']/g, '');
    if (compactResult.length >= 4 && dlgBody.replace(/[\s「」""']/g, '').includes(compactResult)) {
      dlgBody = dlgBody.replace(resultBody, '').replace(/[，,。.\s]+$/g, '').trim();
    }
  }
  dlgBody = formatClassicDialogueTaggedToShots(dlgBody, actionBody);
  actionBody = silenceUntaggedSpeakingShots(actionBody, dlgBody);
  map.set('动作', actionBody);
  map.set('对话', dlgBody || '无');

  const out = [];
  for (const key of order) {
    if (!map.has(key)) continue;
    const v = map.get(key);
    if (v == null || !String(v).trim()) continue;
    if (key === '对话') out.push(`对话：${normalizeDialogueFieldForPrompt(v)}`);
    else out.push(`${key}：${String(v).trim()}`);
  }
  if (ratio) out.push(`=VideoRatio: ${ratio}`);
  // 保留未识别但有用的尾段？仅输出规范字段
  return out.join('\n');
}

/**
 * 对已拼好的经典 video_prompt：清洗「动作：」回声 + 字段换行规范化 + 对话按镜头标注。
 * 兼容换行分字段与「。动作：…。对话：」单行写法。
 */
function sanitizeClassicVideoPromptActionEcho(prompt, dialogue, opts = {}) {
  const raw = prompt != null ? String(prompt) : '';
  if (!raw.trim()) return raw;
  const dlg = normalizeDialogueFieldForPrompt(dialogue);
  let next = raw;

  const lineParts = next.split('\n');
  let touched = false;
  const mapped = lineParts.map((line) => {
    const m = line.match(/^(\s*动作[：:])([\s\S]*)$/);
    if (!m) return line;
    touched = true;
    return m[1] + stripDialogueEchoFromVisual(m[2], dlg === '无' ? '' : dlg);
  });
  if (touched) next = mapped.join('\n');
  else {
    next = next.replace(/动作[：:]([\s\S]*?)(?=(?:对话|对白)[：:]|$)/, (_full, actionBody) => {
      const cleaned = stripDialogueEchoFromVisual(actionBody, dlg === '无' ? '' : dlg);
      return `动作：${cleaned}`;
    });
  }

  return normalizeClassicVideoPromptLayout(next, {
    dialogue: dlg === '无' ? '无' : dialogue,
    action: opts.action,
    result: opts.result,
  });
}

/**
 * 判断引号台词前的上下文是否像「屏幕/字条/标注」而非口播对白。
 */
function looksLikeOnScreenTextContext(before) {
  const tail = String(before || '').slice(-28);
  return /(?:显示|写着|写道|标注|标题|字样|字迹|屏幕|备忘录|纸条|通知|文件夹|状态|名字是|名为|内容是|记录[——\-]|落款|短信|邮件|提示[：:]|倒计时)/u.test(
    tail
  );
}

/** 不可作为说话人的词（「写道/据说」等切出的伪姓名） */
const NON_SPEAKER_LABEL_RE =
  /^(?:写|据|传|报|标|题|名|其|此|彼|旁白|解说|字幕|屏幕|系统|内心|心中|心里|门上|墙上|纸上|信上|报上|上面|下面|里面|外面|有人|声音|一个声音|角色)$/u;

/** 口播动词：刻意不含裸「道」，避免「写道/难道」误匹配 */
const SPEECH_VERB =
  '(?:说道|说着|说了|说|问道|问了|问|喊道|喊了|喊|答道|答了|答|叫道|叫了|叫|低语|怒吼)';

function normalizeKnownSpeakerNames(knownNames) {
  const out = [];
  const seen = new Set();
  for (const raw of knownNames || []) {
    const n = String(raw || '').trim();
    if (!n || n === '无' || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

function findLastKnownNameInText(text, knownNames) {
  const s = String(text || '');
  if (!s || !knownNames?.length) return '';
  let best = '';
  let bestAt = -1;
  for (const name of knownNames) {
    let from = 0;
    while (from < s.length) {
      const at = s.indexOf(name, from);
      if (at < 0) break;
      if (at >= bestAt) {
        bestAt = at;
        best = name;
      }
      from = at + name.length;
    }
  }
  return best;
}

function findFirstKnownNameInText(text, knownNames) {
  const s = String(text || '');
  if (!s || !knownNames?.length) return '';
  let best = '';
  let bestAt = Infinity;
  for (const name of knownNames) {
    const at = s.indexOf(name);
    if (at >= 0 && at < bestAt) {
      bestAt = at;
      best = name;
    }
  }
  return best;
}

/**
 * 把「他/她/声音」等解析成剧中角色名；无法解析则返回 ''（调用方应丢弃，勿写「角色」）。
 */
function resolveSpokenSpeakerName(rawName, before, after, knownNames) {
  const names = normalizeKnownSpeakerNames(knownNames);
  let who = String(rawName || '').trim();
  if (NON_SPEAKER_LABEL_RE.test(who)) who = '';

  for (const n of names) {
    if (who === n) return n;
    if (who && who !== '你' && (who.endsWith(n) || who.includes(n))) return n;
  }

  const isPronounOrAnon = !who || /^(?:他|她|其|角色|有人|声音|一个声音)$/u.test(who);
  // 旁白第二人称「你」常嵌在句子里（拦住你/看着你），不能当「他/她/声音」的指代目标
  const resolvePool = names.filter((n) => n !== '你');

  if (who === '你') {
    if (names.includes('你')) return '你';
    // 主角常叫「你」但角色表用真名：取文中最近的非「你」名作兜底不合适，保留「你」
    return '你';
  }

  if (isPronounOrAnon) {
    const prev = findLastKnownNameInText(String(before || '').slice(-80), resolvePool);
    if (prev) return prev;
    const next = findFirstKnownNameInText(String(after || '').slice(0, 100), resolvePool);
    if (next) return next;
    return '';
  }

  // 未知但像人名（2–4 汉字 / 英文 id），保留原标注
  if (/^[\u4e00-\u9fff]{2,4}$/u.test(who) || /^(?:ghost|G)$/iu.test(who) || /^[A-Za-z][\w·・]{0,15}$/u.test(who)) {
    return who;
  }
  return '';
}

/**
 * 全文解说：从本镜剧本切段中拆出「明显角色对白」，旁白不再重复这些台词。
 * @param {string} segment
 * @param {string} [existingDialogue]
 * @param {{ knownNames?: string[] }} [opts]
 * 返回 { narration, dialogue }；无对白时 dialogue 为空串。
 */
function splitFullNarrationVoAndDialogue(segment, existingDialogue, opts = {}) {
  let text = String(segment || '');
  const knownNames = normalizeKnownSpeakerNames(opts?.knownNames);
  if (!text.trim()) {
    const ex = normalizeDialogueFieldForPrompt(existingDialogue);
    return { narration: '', dialogue: ex === '无' ? '' : ex };
  }

  const extracted = []; // { name, body, start, end }
  const pushHit = (name, body, start, end) => {
    const b = String(body || '')
      .replace(/^[「」""'\s]+|[「」""'\s]+$/g, '')
      .trim();
    if (b.length < 2) return;
    const before = text.slice(0, start);
    const after = text.slice(end);
    if (looksLikeOnScreenTextContext(before)) return;
    const who = resolveSpokenSpeakerName(name, before, after, knownNames);
    if (!who) return; // 无法标出说话人 → 留在旁白，禁止写「角色」
    extracted.push({ name: who, body: b, start, end });
  };

  /** 说话动词后紧跟的续说引号一并吃掉 */
  function extendSpeechTail(fromIdx) {
    let end = fromIdx;
    const tailRe = /^[，,。.\s]*[「」""]([^「」""]{1,120})[」""]/;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const slice = text.slice(end);
      const m = slice.match(tailRe);
      if (!m) break;
      end += m[0].length;
    }
    return end;
  }

  // Name说/问："…" + 续说引号（不含裸「道」，避免「写道」）
  {
    const re = new RegExp(
      `([\\u4e00-\\u9fffA-Za-z0-9·・]{1,12})${SPEECH_VERB}[：:，,\\s]*[「」""]([^「」""]{1,120})[」""]`,
      'g'
    );
    let m;
    while ((m = re.exec(text)) != null) {
      if (NON_SPEAKER_LABEL_RE.test(String(m[1] || '').trim())) continue;
      const end = extendSpeechTail(m.index + m[0].length);
      const full = text.slice(m.index, end);
      const quotes = [...full.matchAll(/[「」""]([^「」""]{1,120})[」""]/g)].map((x) => x[1]);
      if (quotes.length) {
        pushHit(m[1], quotes.join(''), m.index, end);
      }
    }
  }
  // "…"Name说 / "…"你问 + 续说
  {
    const re = new RegExp(
      `[「」""]([^「」""]{1,120})[」""][，,]?\\s*(你|[\\u4e00-\\u9fffA-Za-z0-9·・]{1,12})${SPEECH_VERB}`,
      'g'
    );
    let m;
    while ((m = re.exec(text)) != null) {
      if (NON_SPEAKER_LABEL_RE.test(String(m[2] || '').trim()) && m[2] !== '你') continue;
      const end = extendSpeechTail(m.index + m[0].length);
      const full = text.slice(m.index, end);
      const quotes = [...full.matchAll(/[「」""]([^「」""]{1,120})[」""]/g)].map((x) => x[1]);
      pushHit(m[2], quotes.join('') || m[1], m.index, end);
    }
  }
  // "…" + 一个声音说 / 有人说 / 声音说（不再用裸「传来」，避免环境声误判）
  {
    const re =
      /[「」""]([^「」""]{1,120})[」""][，,]?\s*(?:一个声音说|有人说|声音说|一个声音[，,]?(?:从[^。]{0,12})?(?:传来|响起))/g;
    let m;
    while ((m = re.exec(text)) != null) {
      pushHit('声音', m[1], m.index, m.index + m[0].length);
    }
  }
  // 已知角色名："…"
  if (knownNames.length) {
    for (const name of knownNames) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(
        `${esc}\\s*[：:]\\s*[「」""]([^「」""]{1,120})[」""]`,
        'g'
      );
      let m;
      while ((m = re.exec(text)) != null) {
        const end = extendSpeechTail(m.index + m[0].length);
        const full = text.slice(m.index, end);
        const quotes = [...full.matchAll(/[「」""]([^「」""]{1,120})[」""]/g)].map((x) => x[1]);
        pushHit(name, quotes.join('') || m[1], m.index, end);
      }
    }
    // Name…开口了/声音很轻…："…"（无「说」字的口播；只切除引号段，保留叙述）
    for (const name of knownNames) {
      if (name === '你') continue;
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(
        `${esc}[^「」""\\n]{0,36}(?:开口了|开口说|轻声|声音很[轻淡沉弱]|终于开口)[^「」""\\n]{0,28}([「」""][^「」""]{1,120}[」""])`,
        'g'
      );
      let m;
      while ((m = re.exec(text)) != null) {
        const q = m[1];
        const qStart = m.index + m[0].length - q.length;
        const body = q.replace(/^[「」""]+|[」""]+$/g, '');
        pushHit(name, body, qStart, qStart + q.length);
      }
    }
  } else {
    // 无角色表时：仅接受带身份后缀/常见姓氏的 Name："…"
    const re =
      /([\u4e00-\u9fffA-Za-z0-9·・]{2,12})\s*[：:]\s*[「」""]([^「」""]{1,120})[」""]/g;
    let m;
    while ((m = re.exec(text)) != null) {
      const who = m[1];
      if (/^(?:第|时间|日期|状态|结果|建议|进度|提示)/u.test(who)) continue;
      if (!/(?:警官|医生|老师|经理|老板|先生|小姐|哥|姐|妈|爸|ghost)/iu.test(who) &&
          !/^(?:林|陈|周|苏|张|刘|顾|陆|萧)/u.test(who)) {
        continue;
      }
      const end = extendSpeechTail(m.index + m[0].length);
      const full = text.slice(m.index, end);
      const quotes = [...full.matchAll(/[「」""]([^「」""]{1,120})[」""]/g)].map((x) => x[1]);
      pushHit(who, quotes.join('') || m[2], m.index, end);
    }
  }

  // 去重叠区间（保留较长/先出现）
  extracted.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let cursor = 0;
  for (const hit of extracted) {
    if (hit.start < cursor) continue;
    kept.push(hit);
    cursor = hit.end;
  }

  let narration = text;
  if (kept.length) {
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      const hit = kept[i];
      narration = narration.slice(0, hit.start) + narration.slice(hit.end);
    }
  }

  // 再清旁白里残留的、已进入 dialogue 的引号台词
  let dialogue = kept.map((h) => `${h.name}："${h.body}"`).join('');
  const existing = normalizeDialogueFieldForPrompt(existingDialogue);
  if ((!dialogue || dialogue === '无') && existing && existing !== '无') {
    // 旧 dialogue 若是「角色：…」或无说话人伪对白，尽量用角色表重标；否则保留
    const relabeled = relabelDialogueSpeakers(existing, text, knownNames);
    dialogue = relabeled || existing;
  }
  if (dialogue && dialogue !== '无') {
    const bodies = extractDialogueUtteranceBodies(dialogue);
    for (const body of bodies.sort((a, b) => b.length - a.length)) {
      if (body.length < 4) continue;
      const esc = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      narration = narration.replace(new RegExp(`[「」""]?${esc}[」""]?`, 'g'), '');
    }
  }

  narration = narration
    .replace(/[「」""]{2,}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[。.]{2,}/g, '。')
    .replace(/(?:说|问|喊|答|叫)(?:道|着|了)?\s*[，,：:]*\s*(?=[。.\n]|$)/g, '')
    .replace(/^[，,\s]+|[，,\s]+$/g, '')
    .replace(/[，,]\s*[。.]/g, '。')
    .trim();

  return {
    narration: narration || String(segment || '').trim(),
    dialogue: dialogue && dialogue !== '无' ? dialogue : '',
  };
}

/** 把已有 dialogue 里的「角色：」尽量换成上下文中的真名 */
function relabelDialogueSpeakers(dialogue, contextText, knownNames) {
  const dlg = String(dialogue || '').trim();
  if (!dlg || dlg === '无') return '';
  const names = normalizeKnownSpeakerNames(knownNames);
  if (!names.length && !/角色\s*[：:]/u.test(dlg)) return dlg;

  const parts = [];
  const re =
    /([\u4e00-\u9fffA-Za-z0-9·・]{1,16})\s*[：:]\s*[「」""]?([^「」""]+?)(?=[」""]?\s*(?:[\u4e00-\u9fffA-Za-z0-9·・]{1,16}\s*[：:]|$))/g;
  let m;
  let matched = false;
  while ((m = re.exec(dlg)) != null) {
    matched = true;
    let who = String(m[1] || '').trim();
    const body = String(m[2] || '')
      .replace(/^[「」""]+|[」""]+$/g, '')
      .trim();
    if (!body) continue;
    if (who === '角色' || NON_SPEAKER_LABEL_RE.test(who)) {
      who = resolveSpokenSpeakerName(who === '角色' ? '声音' : who, contextText, contextText, names);
    } else {
      who = resolveSpokenSpeakerName(who, contextText, contextText, names) || who;
    }
    if (!who) continue;
    parts.push(`${who}："${body}"`);
  }
  if (!matched) return dlg;
  return parts.join('');
}

/**
 * 读取分镜所属剧的角色名列表（供说话人标注）。
 */
function loadKnownSpeakerNamesForStoryboard(db, storyboardId) {
  try {
    const rows = db
      .prepare(
        `SELECT c.name
         FROM characters c
         JOIN episodes e ON e.drama_id = c.drama_id AND e.deleted_at IS NULL
         JOIN storyboards s ON s.episode_id = e.id AND s.deleted_at IS NULL
         WHERE s.id = ? AND c.deleted_at IS NULL
         ORDER BY c.sort_order ASC, c.id ASC`
      )
      .all(Number(storyboardId));
    return (rows || []).map((r) => r.name).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function loadKnownSpeakerNamesForEpisode(db, episodeId) {
  try {
    const rows = db
      .prepare(
        `SELECT c.name
         FROM characters c
         JOIN episodes e ON e.drama_id = c.drama_id AND e.deleted_at IS NULL
         WHERE e.id = ? AND c.deleted_at IS NULL
         ORDER BY c.sort_order ASC, c.id ASC`
      )
      .all(Number(episodeId));
    return (rows || []).map((r) => r.name).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/**
 * 对单镜 DB 行做全文解说「对白进 dialogue、旁白去重」。
 * @returns {{ changed: boolean, dialogue: string, narration: string } | null}
 */
function applyFullNarrationVoDialogueSplitToStoryboard(db, log, storyboardId, opts = {}) {
  const sbId = Number(storyboardId);
  if (!Number.isFinite(sbId) || sbId <= 0) return null;
  const row = db
    .prepare(
      'SELECT id, dialogue, narration FROM storyboards WHERE id = ? AND deleted_at IS NULL'
    )
    .get(sbId);
  if (!row) return null;

  const knownNames =
    opts.knownNames ||
    loadKnownSpeakerNamesForStoryboard(db, sbId);

  const oldNarr = row.narration != null ? String(row.narration).trim() : '';
  const oldDlgNorm = normalizeDialogueFieldForPrompt(row.dialogue);
  const oldDlg = oldDlgNorm === '无' ? '' : oldDlgNorm;
  if (!oldNarr && !oldDlg) {
    return { changed: false, dialogue: '', narration: '' };
  }

  const split = splitFullNarrationVoAndDialogue(oldNarr || oldDlg, oldDlg || row.dialogue, {
    knownNames,
  });
  let newNarr = String(split.narration || '').trim();
  let newDlg = String(split.dialogue || '').trim();
  if (!newNarr && oldNarr) newNarr = oldNarr;
  // 清理历史误标「角色：」
  if (/角色\s*[：:]/u.test(newDlg)) {
    newDlg = relabelDialogueSpeakers(newDlg, oldNarr || newNarr, knownNames) || newDlg.replace(/角色\s*[：:]/gu, '');
    newDlg = String(newDlg || '').trim();
  }
  if (newNarr === oldNarr && newDlg === oldDlg) {
    return { changed: false, dialogue: newDlg, narration: newNarr };
  }

  const now = new Date().toISOString();
  db.prepare(
    'UPDATE storyboards SET dialogue = ?, narration = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
  ).run(newDlg || null, newNarr || null, now, sbId);

  if (log?.info) {
    log.info('[分镜] 全文解说旁白/对白分离已写入', {
      id: sbId,
      has_dialogue: !!newDlg,
      narr_len: newNarr.length,
    });
  }
  return { changed: true, dialogue: newDlg, narration: newNarr };
}

/**
 * 整集应用旁白/对白分离（按配音润色 / 重生提示词前调用）。
 */
function applyFullNarrationVoDialogueSplitForEpisode(db, log, episodeId) {
  const episodeIdNum = Number(episodeId);
  if (!Number.isFinite(episodeIdNum) || episodeIdNum <= 0) {
    return { updated: 0, total: 0 };
  }
  const knownNames = loadKnownSpeakerNamesForEpisode(db, episodeIdNum);
  const rows = db
    .prepare(
      'SELECT id FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC'
    )
    .all(episodeIdNum);
  let updated = 0;
  for (const r of rows) {
    const out = applyFullNarrationVoDialogueSplitToStoryboard(db, log, r.id, { knownNames });
    if (out?.changed) updated += 1;
  }
  return { updated, total: rows.length };
}

/**
 * 判断一行是否为「对话：」trailer 起首（全能文末独立对白块）。
 */
function isDialogueTrailerStartLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (/^【\s*对话\s*】/.test(t)) return true;
  if (/^(?:对话|对白)\s*[：:]/.test(t)) return true;
  return false;
}

module.exports = {
  getDialogueVisualSeparationContract,
  normalizeDialogueFieldForPrompt,
  normalizeSoundEffectForPrompt,
  inferDiegeticSoundEffectFromTexts,
  resolveSoundEffectForStoryboard,
  sanitizeClassicVideoPromptSoundEffect,
  stripQuotedSpeechFromVisual,
  stripDialogueEchoFromVisual,
  sanitizeClassicVideoPromptActionEcho,
  normalizeClassicVideoPromptLayout,
  formatClassicDialogueTaggedToShots,
  peelTrailingFieldsFromDialogueBody,
  extractSpeakingShotIndexesFromAction,
  extractDialogueShotTags,
  ensureSpeakingShotsForDialogue,
  silenceUntaggedSpeakingShots,
  shotSegmentLooksSpeaking,
  extractDialogueUtteranceBodies,
  splitFullNarrationVoAndDialogue,
  applyFullNarrationVoDialogueSplitToStoryboard,
  applyFullNarrationVoDialogueSplitForEpisode,
  loadKnownSpeakerNamesForStoryboard,
  loadKnownSpeakerNamesForEpisode,
  isDialogueTrailerStartLine,
};
