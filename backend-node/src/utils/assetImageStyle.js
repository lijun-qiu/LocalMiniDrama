/**
 * 角色/场景/道具生图时，项目画风常含「character / hanfu / expressive character design」等词。
 * 角色图可用；场景空镜与道具主图若原样置顶，模型会生成同一套古装女装人物（含镜面反射）。
 */

const SCENE_EMPTY_NEGATIVE_PROMPT =
  'people, person, human, humans, character, characters, man, woman, boy, girl, child, crowd, silhouette, figure, portrait, face, faces, hands, body, NPC, actor, actress, hanfu, hairpin, costume';

const PROP_STUDIO_NEGATIVE_PROMPT =
  'people, person, human, hands, fingers, body, character, face, reflection of person, woman in mirror, man in mirror, portrait in reflection, environment, room, interior, outdoor scene, landscape, table, desk, floor, ground, wall, furniture, shelf, pedestal, packaging, box, clutter, text, watermark, logo, brand name, hanfu, hairpin';

const EMPTY_SCENE_LOCK =
  'EMPTY LOCATION ONLY — pure environment plate: architecture, terrain, props-as-set-dressing, light and atmosphere. Absolutely no people, no characters, no silhouettes, no human shadows, no faces, no hands, no figures, no costumes of any kind.';

const PROP_STUDIO_LOCK =
  'SINGLE PROP PRODUCT HERO — only this one object on a seamless solid-color studio backdrop. No people, no hands, no environment, no table/floor/room, no extra objects. If reflective (mirror/glass/screen): empty reflection only — solid color or blank, never a person.';

/** 从画风文案中剔除人物/服化/发饰等主语词，只留渲染介质与色调 */
function sanitizeStyleForEmptyScene(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';

  const replacements = [
    [/Chinese historical 3D realistic character and scene/gi, 'Chinese historical 3D environment'],
    [/character and scene/gi, 'environment'],
    [/expressive character design[^,]*/gi, 'clean illustration quality'],
    [/elaborate hairpins?(?:\s+and\s+hanfu)?/gi, ''],
    [/\bhanfu\b/gi, ''],
    [/hairpins?/gi, ''],
    [/hair ornaments?/gi, ''],
    [/jade hair crown/gi, ''],
    [/subsurface skin(?:\s+and\s+silk fabric detail)?/gi, 'surface material detail'],
    [/silk fabric detail/gi, ''],
    [/costume drama level production design/gi, 'cinematic production design'],
    [/pretty stylized faces?(?:\s+big eyes)?[^,]*/gi, ''],
    [/delicate (?:youthful )?faces?[^,]*/gi, ''],
    [/youthful characters?/gi, ''],
    [/flowing (?:immortal |traditional )?robes?[^,]*/gi, ''],
    [/immortal robes?[^,]*/gi, ''],
    [/web novel cover and donghua character art style/gi, 'guofeng illustration look'],
    [/donghua character art/gi, 'guofeng illustration'],
    [/古风写实三维角色与场景/g, '古风写实三维环境'],
    [/次表面散射肤质与丝绸布料/g, '材质与布料质感'],
    [/高盘发与步摇细节/g, ''],
    [/汉服与发饰精细刻画/g, '建筑与陈设细节'],
    [/飘逸汉服广袖/g, ''],
    [/广袖仙袍与玉冠发饰/g, ''],
    [/古装剧级服化道/g, '古装剧级美术置景'],
    [/极具表现力的角色设计/g, '清晰画面质感'],
    [/人物美型大眼简化鼻唇/g, ''],
    [/角色清秀少年感/g, ''],
    [/人物唯美表情细腻/g, ''],
    [/国产仙侠剧与游戏CG审美/g, '国产仙侠CG审美'],
  ];
  for (const [re, to] of replacements) s = s.replace(re, to);

  s = s
    .replace(/,\s*,+/g, ',')
    .replace(/(?:^|,\s*)(?:and\s*)?(?=,|$)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;./]+|[\s,;./]+$/g, '')
    .trim();
  return s;
}

function sanitizeStyleForProp(raw) {
  let s = sanitizeStyleForEmptyScene(raw);
  if (!s) return '';
  // 道具再去掉场景叙事词，避免镜子/手机被画进宫殿街景
  const more = [
    [/palace garden or ancient street/gi, ''],
    [/imperial palace architecture/gi, ''],
    [/classical garden/gi, ''],
    [/office cafe city street backgrounds/gi, ''],
    [/pavilion or misty landscape/gi, ''],
    [/sea of clouds and celestial palace/gi, ''],
    [/宫殿园林或市井街景/g, ''],
    [/皇宫殿宇建筑/g, ''],
    [/古典园林景观/g, ''],
    [/亭台楼阁或山水留白/g, ''],
    [/云海奇峰与宫阙楼阁/g, ''],
    [/写字楼咖啡厅街景/g, ''],
  ];
  for (const [re, to] of more) s = s.replace(re, to);
  return s
    .replace(/,\s*,+/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;./]+|[\s,;./]+$/g, '')
    .trim();
}

function stripCharacterfulStyleBlocks(prompt) {
  let p = String(prompt || '');
  p = p.replace(/【画风·最高优先级】[^\n]*/g, '');
  p = p.replace(/【画风·仅空场景环境质感】[^\n]*/g, '');
  p = p.replace(/【画风·仅道具本体材质与渲染】[^\n]*/g, '');
  p = p.replace(/MANDATORY ART STYLE[^\n]*/gi, '');
  p = p.replace(/ART STYLE FOR EMPTY ENVIRONMENT ONLY[^\n]*/gi, '');
  p = p.replace(/ART STYLE FOR SINGLE PROP ONLY[^\n]*/gi, '');
  // 旧数据常把整段 gufeng 角色画风拼进正文
  p = p.replace(/Chinese historical 3D realistic character and scene[^.\n]*/gi, '');
  p = p.replace(/elaborate hairpins and hanfu[^.\n]*/gi, '');
  p = p.replace(/subsurface skin and silk fabric detail[^.\n]*/gi, '');
  p = p.replace(/costume drama level production design[^.\n]*/gi, '');
  p = p.replace(/expressive character design[^.\n]*/gi, '');
  p = p.replace(/古风写实三维角色与场景[^，。\n]*/g, '');
  p = p.replace(/高盘发与步摇细节[^，。\n]*/g, '');
  p = p.replace(/汉服与发饰精细刻画[^，。\n]*/g, '');
  // 去掉加固时重复堆叠的空镜锁，后面统一再加
  p = p.replace(/(?:EMPTY LOCATION ONLY[^\n]*\n*)+/gi, '');
  p = p.replace(/(?:SINGLE PROP PRODUCT HERO[^\n]*\n*)+/gi, '');
  return p.replace(/\n{3,}/g, '\n\n').trim();
}

function wrapStyleForEmptyScene(styleEn, styleZh) {
  const zh = sanitizeStyleForEmptyScene(styleZh);
  const en = sanitizeStyleForEmptyScene(styleEn);
  const lines = [];
  if (zh) {
    lines.push(`【画风·仅空场景环境质感】${zh}`);
  }
  if (en && en !== zh) {
    lines.push(`ART STYLE FOR EMPTY ENVIRONMENT ONLY (materials, lighting, color grade — no people): ${en}`);
  } else if (en && !zh) {
    lines.push(`ART STYLE FOR EMPTY ENVIRONMENT ONLY (materials, lighting, color grade — no people): ${en}`);
  }
  return lines;
}

function wrapStyleForProp(styleEn, styleZh) {
  const zh = sanitizeStyleForProp(styleZh);
  const en = sanitizeStyleForProp(styleEn);
  const lines = [];
  if (zh) {
    lines.push(`【画风·仅道具本体材质与渲染】${zh}`);
  }
  if (en && en !== zh) {
    lines.push(`ART STYLE FOR SINGLE PROP ONLY (material/render — no people, no scene): ${en}`);
  } else if (en && !zh) {
    lines.push(`ART STYLE FOR SINGLE PROP ONLY (material/render — no people, no scene): ${en}`);
  }
  return lines;
}

/**
 * 生图前强制清洗：去掉旧「画风·最高优先级」人物词，再套净化后的画风 + 空镜锁。
 * 解决「只加 EMPTY LOCATION 但正文仍含 hairpins/hanfu」导致统一出女装人物的问题。
 */
function scrubAndReinforceScenePrompt(prompt, styleEn, styleZh) {
  const body = stripCharacterfulStyleBlocks(prompt);
  const styleLines = wrapStyleForEmptyScene(styleEn, styleZh);
  const header = styleLines.length ? `${styleLines.join('\n')}\n\n` : '';
  return `${header}${EMPTY_SCENE_LOCK}\n\n${body}\n\n${EMPTY_SCENE_LOCK}`;
}

function scrubAndReinforcePropPrompt(prompt, styleEn, styleZh) {
  const body = stripCharacterfulStyleBlocks(prompt);
  const styleLines = wrapStyleForProp(styleEn, styleZh);
  const header = styleLines.length ? `${styleLines.join('\n')}\n\n` : '';
  return `${header}${PROP_STUDIO_LOCK}\n\n${body}\n\n${PROP_STUDIO_LOCK}`;
}

/** @deprecated 兼容旧调用：改为 scrubAndReinforceScenePrompt 无画风时的行为 */
function reinforceEmptyScenePrompt(prompt) {
  return scrubAndReinforceScenePrompt(prompt, '', '');
}

function reinforcePropStudioPrompt(prompt) {
  return scrubAndReinforcePropPrompt(prompt, '', '');
}

module.exports = {
  SCENE_EMPTY_NEGATIVE_PROMPT,
  PROP_STUDIO_NEGATIVE_PROMPT,
  EMPTY_SCENE_LOCK,
  PROP_STUDIO_LOCK,
  sanitizeStyleForEmptyScene,
  sanitizeStyleForProp,
  stripCharacterfulStyleBlocks,
  wrapStyleForEmptyScene,
  wrapStyleForProp,
  scrubAndReinforceScenePrompt,
  scrubAndReinforcePropPrompt,
  reinforceEmptyScenePrompt,
  reinforcePropStudioPrompt,
};
