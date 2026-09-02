/**
 * 全能片段：角色姓名 ↔ @图片N 硬绑定，防止段落主人公/对白说话人搞混。
 */

function trim(s) {
  return s != null && String(s).trim() ? String(s).trim() : '';
}

/** 按姓名长度降序，避免短名误匹配长名子串 */
function sortNamesLongestFirst(names) {
  return [...new Set((names || []).map((n) => trim(n)).filter(Boolean))].sort(
    (a, b) => b.length - a.length || a.localeCompare(b, 'zh')
  );
}

/**
 * @param {{ tag: string, summary: string }[]} charSlots
 * @returns {Map<string, string>} name → @图片N
 */
function buildNameToImageTagMap(charSlots) {
  const map = new Map();
  for (const s of charSlots || []) {
    const name = trim(s?.summary);
    const tag = trim(s?.tag);
    if (!name || !tag) continue;
    if (!map.has(name)) map.set(name, tag);
  }
  return map;
}

/**
 * 引号/书名号内区间（标题、店招、收据抬头、帖子等「屏幕/纸面文字」）
 * 与 MENTION_NE_APPEAR_TEMPLATE 同一套语义：区内姓名不计出场。
 */
function collectQuotedRanges(text) {
  const src = String(text || '');
  if (!src) return [];
  const ranges = [];
  const re = /「[^」]*」|『[^』]*』|"[^"]*"|'[^']*'|"[^"]*"|'[^']*'/gu;
  let m;
  while ((m = re.exec(src))) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

function rangeFullyInsideQuoted(start, end, quotedRanges) {
  for (const r of quotedRanges || []) {
    if (start >= r.start && end <= r.end) return true;
  }
  return false;
}

/**
 * 从 ACTION / 对白等文本中找「出场」角色名（按首次出现顺序）
 * 统一模板：引号内姓名 = 仅提及，不记为出场（无店招后缀特判）。
 * @param {string} text
 * @param {string[]} knownNames
 * @returns {string[]}
 */
function findNamesInTextInOrder(text, knownNames) {
  const src = String(text || '');
  if (!src || !knownNames?.length) return [];
  const names = sortNamesLongestFirst(knownNames);
  const quoted = collectQuotedRanges(src);
  const hits = [];
  const occupied = new Array(src.length).fill(false);
  const matches = [];
  for (const name of names) {
    let from = 0;
    while (from < src.length) {
      const idx = src.indexOf(name, from);
      if (idx < 0) break;
      const end = idx + name.length;
      // 引号内：标题/店招/抬头等文字提及，不算出场
      if (!rangeFullyInsideQuoted(idx, end, quoted)) {
        matches.push({ name, idx, end });
      }
      from = end;
    }
  }
  matches.sort((a, b) => a.idx - b.idx || b.name.length - a.name.length);
  const seen = new Set();
  for (const m of matches) {
    let overlap = false;
    for (let i = m.idx; i < m.end; i++) {
      if (occupied[i]) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    for (let i = m.idx; i < m.end; i++) occupied[i] = true;
    if (!seen.has(m.name)) {
      seen.add(m.name);
      hits.push(m.name);
    }
  }
  return hits;
}

/**
 * 解析对白中的「说话人 → 台词」行
 * 支持：张三："…" / 张三：「…」 / 张三说："…" / 张三：'…'
 * @param {string} dialogue
 * @param {string[]} knownNames
 * @returns {{ speaker: string, line: string }[]}
 */
function parseDialogueSpeakerLines(dialogue, knownNames) {
  const raw = String(dialogue || '').trim();
  if (!raw) return [];
  const names = sortNamesLongestFirst(knownNames);
  const results = [];
  const chunks = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const tryOne = (chunk) => {
    for (const name of names) {
      // 姓名 + 可选「说/道/问/答」+ ：/: + 引号台词
      const re = new RegExp(
        `^${escapeRegExp(name)}(?:说|道|问|答|喊|叫)?\\s*[:：]\\s*[「『"“']([\\s\\S]*?)[」』"”']\\s*$`
      );
      const m = chunk.match(re);
      if (m) {
        const line = trim(m[1]);
        if (line) results.push({ speaker: name, line });
        return true;
      }
    }
    // 无已知姓名前缀：整段当无说话人标注的台词
    const bare = chunk.match(/^[「『"“']([\s\S]*?)[」』"”']\s*$/);
    if (bare && trim(bare[1])) {
      results.push({ speaker: '', line: trim(bare[1]) });
      return true;
    }
    return false;
  };

  if (chunks.length > 1) {
    for (const c of chunks) tryOne(c);
  } else {
    // 单行可能含多段「名：\"台词\"」
    let rest = raw;
    let guard = 0;
    while (rest && guard++ < 20) {
      let matched = false;
      for (const name of names) {
        const re = new RegExp(
          `${escapeRegExp(name)}(?:说|道|问|答|喊|叫)?\\s*[:：]\\s*[「『"“']([\\s\\S]*?)[」』"”']`
        );
        const m = rest.match(re);
        if (m && m.index != null) {
          results.push({ speaker: name, line: trim(m[1]) });
          rest = rest.slice(m.index + m[0].length).trim();
          matched = true;
          break;
        }
      }
      if (!matched) break;
    }
    if (!results.length) tryOne(raw);
  }
  return results;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 旁白是否以第二人称指代主人公（你/您）——与提及≠出场模板同一 POV 语义 */
function narrationUsesSecondPerson(narration) {
  const n = trim(narration);
  if (!n) return false;
  // 「你不认识」「但你注意到」「在你家」「你不记得」等；避免「迷你」类非代词误命中
  return /(?:^|[^\u4e00-\u9fff]|[但而却可若因所以及与和乃就又也还是在让给对向把被比连替为叫])(?:你|您)(?:们)?/u.test(
    n
  );
}

/**
 * 旁白是否列举同一人的多地点/多活动（你在A…你在B… / 在A、在B、在C）
 * 此类勿拆成相册多格或三个陌生人。
 */
function narrationListsMultipleActivities(narration) {
  const n = trim(narration);
  if (!n) return false;
  const niPattern = /你在[^，,。！？；;]{1,24}/gu;
  const niHits = n.match(niPattern);
  if (niHits && niHits.length >= 2) return true;
  const clauses = n.split(/[，,；;]/).map((s) => s.trim()).filter(Boolean);
  if (clauses.length >= 2 && clauses.every((c) => /^(你|您)?在/u.test(c) || /写作|散步|煮|厨房|公园|咖啡/u.test(c))) {
    return true;
  }
  return false;
}

/**
 * ACTION/DESCRIPTION/NARRATION 是否指向「翻相册/相页」类蒙太奇
 */
function textSuggestsAlbumMontage(...texts) {
  const blob = texts.map((t) => trim(t)).filter(Boolean).join(' ');
  if (!blob) return false;
  return /相册|相页|相片|老照片|相纸|相册本|翻阅|翻(?:开|阅|过|动)|定格(?:画面|相片|照片)|照片里|相片中|被(?:定格|拍摄)|扫过.*(?:相册|相页|相片)/u.test(
    blob
  );
}

/**
 * 构建旁白人称与多活动解读块（写入 USER prompt）
 */
function buildNarrationSubjectHintBlock(narration, primary, opts = {}) {
  const n = trim(narration);
  if (!n || !primary?.name || !primary?.tag) return '';
  const lines = ['NARRATION_SUBJECT_HINT（旁白人称与多活动 — 违反即失败）:'];
  if (narrationUsesSecondPerson(n)) {
    lines.push(
      `- 旁白中的「你/您」= 段落主人公「${primary.name}」=${primary.tag}；禁止把「你」写成无 @图片 绑定的路人、剪影或另一张脸。`,
      `- 写可见人物时须用 ${primary.tag}（同一外貌参考），禁止仅写「某人」「身影」「路人」。`
    );
  }
  if (narrationListsMultipleActivities(n)) {
    const { MULTI_PLACE_ACTIVITY_TEMPLATE_ZH } = require('./universalAgnesTimelineContract');
    lines.push(
      `- 旁白列举多地点/多活动 = **同一人**「${primary.name}」在不同时空的片段，不是多个不同角色。`,
      `- 禁止多定格里出现多个不同陌生人；每一格（或每一拍）里的人物必须是 ${primary.tag} **同一张脸、同一套外貌**。`,
      `- **禁止**在 beat 内写 旁白（画面无声）："…" 或照抄旁白原文；须把每句旁白**转写为该定格/该拍的可视画面**。`,
      MULTI_PLACE_ACTIVITY_TEMPLATE_ZH
    );
    const album = textSuggestsAlbumMontage(opts.action, opts.description, n);
    if (album) {
      lines.push(
        `- 本镜 ACTION/DESCRIPTION 指向相册/相页/翻阅时：上述多时空模板中的「定格」可理解为相页内画面；或 M=定格数、每拍一张。`
      );
    } else {
      lines.push(
        `- 若本镜 ACTION 未要求多时空拼贴：优先只呈现与**当前旁白摘录**对应的一个**实景** + ${primary.tag} 的一个动作。`
      );
    }
  }
  if (lines.length <= 1) return '';
  return lines.join('\n');
}

/**
 * 推断本镜段落主人公（与 MENTION_NE_APPEAR_TEMPLATE 同一优先级）：
 * 1) 旁白第二人称「你/您」→ 绑定表首槽（POV），勿被引号外点名的陌生人抢走
 * 2) ACTION 中引号外最先出场的角色
 * 3) 对白说话人
 * 4) 旁白引号外点名
 * 5) 绑定表首槽
 * @returns {{ name: string, tag: string } | null}
 */
function inferPrimarySubject(action, dialogue, charSlots, narration = '') {
  const nameToTag = buildNameToImageTagMap(charSlots);
  if (!nameToTag.size) return null;
  const knownNames = [...nameToTag.keys()];

  // 提及≠出场：第二人称优先于 ACTION/旁白里的姓名扫描
  if (narrationUsesSecondPerson(narration)) {
    const first = charSlots[0];
    if (first?.summary && first?.tag) {
      return { name: trim(first.summary), tag: trim(first.tag) };
    }
  }

  const fromAction = findNamesInTextInOrder(action, knownNames);
  for (const n of fromAction) {
    const tag = nameToTag.get(n);
    if (tag) return { name: n, tag };
  }

  const speakers = parseDialogueSpeakerLines(dialogue, knownNames);
  for (const s of speakers) {
    if (s.speaker && nameToTag.has(s.speaker)) {
      return { name: s.speaker, tag: nameToTag.get(s.speaker) };
    }
  }

  const fromNarr = findNamesInTextInOrder(narration, knownNames);
  for (const n of fromNarr) {
    const tag = nameToTag.get(n);
    if (tag) return { name: n, tag };
  }

  const first = charSlots[0];
  if (first?.summary && first?.tag) {
    return { name: trim(first.summary), tag: trim(first.tag) };
  }
  return null;
}

/**
 * 构建写入 USER prompt 的主体锁定块
 * @param {{ charSlots: object[], action?: string, dialogue?: string, narration?: string, sceneFirst?: boolean }} opts
 */
function buildSubjectIdentityLockBlock(opts = {}) {
  const charSlots = opts.charSlots || [];
  if (!charSlots.length) {
    return [
      'SUBJECT_IDENTITY_LOCK（本镜无角色参考槽）:',
      '- 若正文出现人物，勿把人物外貌/动作绑到场景槽 @图片1（若存在）。',
    ].join('\n');
  }

  const nameToTag = buildNameToImageTagMap(charSlots);
  const knownNames = [...nameToTag.keys()];
  const primary = inferPrimarySubject(opts.action, opts.dialogue, charSlots, opts.narration);
  const speakers = parseDialogueSpeakerLines(opts.dialogue, knownNames);

  const { MENTION_NE_APPEAR_LINE_ZH } = require('./universalAgnesTimelineContract');
  const lines = [
    'SUBJECT_IDENTITY_LOCK（最高优先级——段落主人公/说话人不得搞混；违反即失败）:',
    ...(opts.sceneFirst
      ? ['- @图片1 仅为场景/环境；人物外貌、动作、表情、台词只能绑到下列角色槽。']
      : ['- 人物外貌、动作、表情、台词必须严格按下列姓名→@图片N 映射，禁止串槽。']),
    MENTION_NE_APPEAR_LINE_ZH,
  ];

  for (const s of charSlots) {
    const name = trim(s.summary);
    const tag = trim(s.tag);
    const isPrimary = primary && primary.name === name;
    lines.push(
      `- 「${name}」→ ${tag}${isPrimary ? ' 【本镜段落主人公 PRIMARY_SUBJECT】' : ''}（仅此人的动作/表情/站位/台词可写在 ${tag}）`
    );
  }

  if (primary) {
    lines.push(
      `PRIMARY_SUBJECT: 「${primary.name}」=${primary.tag}`,
      `- 每个「分镜k：」子时段的戏核主人公默认是 ${primary.tag}（「${primary.name}」）。`,
      `- 旁白中的「你/您」若无其它指代对象，一律视为「${primary.name}」=${primary.tag}。`,
      `- 仅当 ACTION/DIALOGUE 明确写到另一角色在做该拍主戏时，该拍才可改绑到其映射槽；禁止无依据地把主人公换成别人。`,
      `- 禁止把「${primary.name}」的动作/对白写到非 ${primary.tag} 的 @图片槽；禁止把其他人的戏写到 ${primary.tag}。`
    );
  }

  const narrHint = buildNarrationSubjectHintBlock(opts.narration, primary, {
    action: opts.action,
    description: opts.description,
  });
  if (narrHint) lines.push('', narrHint);

  lines.push(
    '- 严禁交换映射（例如把「甲」的动作写给「乙」对应的 @图片N）。',
    '- 禁止用「他/她」含糊指代后却绑错 @图片N；写动作时紧挨对应 @图片N。',
    '- 润色时：可改运镜措辞，但姓名↔@图片N 与说话人归属必须与本表一致，不得因改写而串人。'
  );

  if (speakers.length) {
    lines.push('DIALOGUE_SPEAKER_MAP（对白说话人→必须使用的 @图片N；台词原文须保留在「」内）:');
    for (const sp of speakers) {
      if (sp.speaker && nameToTag.has(sp.speaker)) {
        const tag = nameToTag.get(sp.speaker);
        lines.push(`- 「${sp.speaker}」说 → ${tag} 说："${sp.line}"`);
      } else if (primary) {
        lines.push(`- （未标注说话人）默认段落主人公 ${primary.tag} 说："${sp.line}"`);
      } else {
        lines.push(`- （未标注说话人）台词："${sp.line}" — 须绑到实际说话人的 @图片N`);
      }
    }
    lines.push('DIALOGUE_VERBATIM（必须逐字出现在输出中的台词）:');
    for (const sp of speakers) {
      lines.push(`- "${sp.line}"`);
    }
  }

  // ACTION 中出现的角色出场顺序提示
  const actionOrder = findNamesInTextInOrder(opts.action, knownNames);
  if (actionOrder.length > 1) {
    lines.push(
      `ACTION_CHARACTER_ORDER（ACTION 中出现顺序，供分拍，不得串槽）: ${actionOrder
        .map((n) => `「${n}」=${nameToTag.get(n)}`)
        .join(' → ')}`
    );
  }

  return lines.join('\n');
}

module.exports = {
  buildNameToImageTagMap,
  findNamesInTextInOrder,
  collectQuotedRanges,
  parseDialogueSpeakerLines,
  inferPrimarySubject,
  buildSubjectIdentityLockBlock,
  buildNarrationSubjectHintBlock,
  textSuggestsAlbumMontage,
  narrationUsesSecondPerson,
  narrationListsMultipleActivities,
  sortNamesLongestFirst,
};
