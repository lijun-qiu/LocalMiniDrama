'use strict';

/**
 * ArcReel prompt_builders_reference.py — 几乎逐字端口（step1 split + step2 visual expand）。
 * LMD 仅保留：人物/肢体归属、speech_overload 标红说明（后处理仍会标注）。
 */

const { WRITING_SYNTAX_SPEC } = require('./writingSyntax');

/** 参考视频 unit 时长：4–12 秒，每秒一档 */
const DEFAULT_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12];

function formatAssetLines(items, lookFn) {
  const lines = [];
  for (const it of items || []) {
    const name = String(it.name || it.location || '').trim();
    if (!name) continue;
    const desc = String(it.appearance || it.description || it.prompt || '').trim().slice(0, 120);
    lines.push(`- ${name}: ${desc}`);
  }
  return lines.join('\n') || '（暂无）';
}

/** ArcReel _candidate_block 口径 */
function candidateBlock(characters, scenes, props) {
  const charTokens = [];
  for (const c of characters || []) {
    const name = String(c.name || '').trim();
    if (!name) continue;
    charTokens.push(name);
    try {
      const characterLooks = require('./characterLooks');
      for (const lookId of characterLooks.listLookIds(c)) {
        if (lookId === characterLooks.BASE_LOOK_ID) continue;
        charTokens.push(`${name}@${lookId}`);
      }
    } catch {
      /* ignore */
    }
  }
  const sceneNames = (scenes || []).map((s) => String(s.location || s.name || '').trim()).filter(Boolean);
  const propNames = (props || []).map((p) => String(p.name || '').trim()).filter(Boolean);
  return [
    `  - character: ${charTokens.join(', ') || '（暂无）'}`,
    `  - scene: ${sceneNames.join(', ') || '（暂无）'}`,
    `  - prop: ${propNames.join(', ') || '（暂无）'}`,
  ].join('\n');
}

function lookIdsOf(char) {
  try {
    const characterLooks = require('./characterLooks');
    return characterLooks.listLookIds(char).filter((id) => id !== characterLooks.BASE_LOOK_ID);
  } catch {
    return [];
  }
}

function formatOutlineBlock(episodeOutline, nextEpisodeOutline) {
  const blocks = [];
  for (const [tag, outline] of [
    ['episode_outline', episodeOutline],
    ['next_episode_outline', nextEpisodeOutline],
  ]) {
    if (!outline || typeof outline !== 'object') continue;
    const lines = [];
    if (typeof outline.title === 'string' && outline.title.trim()) {
      lines.push(`标题：${outline.title.trim()}`);
    }
    if (typeof outline.hook === 'string' && outline.hook.trim()) {
      lines.push(`钩子：${outline.hook.trim()}`);
    }
    if (Array.isArray(outline.story_beats)) {
      for (const beat of outline.story_beats) {
        if (typeof beat === 'string' && beat.trim()) lines.push(`- ${beat.trim()}`);
      }
    }
    if (typeof outline.next_episode_teaser === 'string' && outline.next_episode_teaser.trim()) {
      lines.push(`下集预告：${outline.next_episode_teaser.trim()}`);
    }
    if (lines.length) blocks.push(`<${tag}>\n${lines.join('\n')}\n</${tag}>`);
  }
  return blocks.length ? `${blocks.join('\n\n')}\n\n` : '';
}

/**
 * ArcReel build_reference_units_split_prompt
 */
function buildStep1SplitPrompt({
  episode,
  novelText,
  overview = {},
  characters = [],
  scenes = [],
  props = [],
  supportedDurations = DEFAULT_DURATIONS,
  referenceSupportedDurations = null,
  textSupportedDurations = null,
  maxDuration,
  defaultDuration,
  maxRefs = 9,
  speechRate = 5,
  unitLabel = '字',
  targetLanguage = '中文',
  episodeOutline = null,
  nextEpisodeOutline = null,
}) {
  const durations = [...new Set((supportedDurations || DEFAULT_DURATIONS).map((d) => Number(d) || 0).filter(Boolean))].sort(
    (a, b) => a - b
  );
  const maxDur = maxDuration || durations[durations.length - 1] || 12;
  const defDur =
    defaultDuration != null && durations.includes(Number(defaultDuration))
      ? Number(defaultDuration)
      : durations.includes(5)
        ? 5
        : durations[0];
  const durationsStr = durations.join(', ');

  const refTiers = [...new Set((referenceSupportedDurations || []).map((d) => Number(d) || 0).filter(Boolean))].sort(
    (a, b) => a - b
  );
  const textTiers = [...new Set((textSupportedDurations || []).map((d) => Number(d) || 0).filter(Boolean))].sort(
    (a, b) => a - b
  );
  const tiersDiffer =
    refTiers.length > 0 && textTiers.length > 0 && refTiers.join(',') !== textTiers.join(',');
  const referenceRule = tiersDiffer
    ? `\n     本型号下该档位还随「有无参考图」分两套，按该 unit **画面描述里有没有 \`@\` 资产引用**` +
      `取用（台词记号 \`@[角色]{台词}\` 的说话人不计入——它不生成参考图，只驱动音色声明）：` +
      `带 \`@\` 引用取（${refTiers.join(', ')}），` +
      `不带取（${textTiers.join(', ')}）。` +
      `两者取其一：要么改取该 unit 引用状态对应档位内的值，要么调整引用——` +
      `把次要资产融入描述文字、不用 \`@\` 引用，从而适用不带引用的那套档位。`
    : '';

  let defaultScope = '';
  if (defDur != null && tiersDiffer) {
    const inRef = refTiers.includes(defDur);
    const inText = textTiers.includes(defDur);
    if (inRef !== inText) {
      const applies = inRef ? '带 `@` 引用的' : '不带 `@` 引用的';
      defaultScope = `（该默认值只落在${applies} unit 的档位内，另一种状态的 unit 按上面的硬约束取值）`;
    }
  }
  const defaultRule =
    defDur != null
      ? `unit 默认取 ${defDur} 秒${defaultScope}，` +
        '仅当动作链或台词下界确实需要时再取更长档（偏好可被内容需要覆盖，硬约束不可）'
      : '按叙事需要从档位中取值，优先满足台词下界与画面节拍下界后的最短够用档，不强制默认值；不要默认贴近最长档';

  const maxRefsRule =
    maxRefs != null
      ? `\n- **references 上限**：一个 unit 的**画面描述里** \`@\` 引用的资产名（去重后）不超过 ` +
        `${maxRefs} 个（台词记号 \`@[角色]{台词}\` 的说话人不计入——它不生成参考图）；` +
        '超出时把次要角色融入背景描述（不用 `@` 引用），不要压缩主体资产。'
      : '';

  const overviewBlock = {
    synopsis: overview.synopsis || overview.description || '',
    genre: overview.genre || '',
    theme: overview.theme || '',
    world_setting: overview.world_setting || '',
  };

  const outlineBlock = formatOutlineBlock(episodeOutline, nextEpisodeOutline);

  // LMD：超长台词后处理标红；prompt 侧与 ArcReel「拆开」同口径，并补充 overload 标记说明
  const speechOverloadNote =
    `\n     若平台最长档仅 ${maxDur} 秒而台词仍念不完：仍取 ${maxDur}，并在该 unit 标注 ` +
    `"speech_overload": true 与 "speech_seconds": <所需秒数>（前端标红提醒拆镜；勿静默删台词）。`;

  return `# 角色与任务

你是一位参考生视频单元架构师，本任务是把源文拆分为适配多模态参考视频模型的 video_unit 表（step1 内容拆分）。
每个 video_unit 对应**一次视频生成调用**，正文是一段连续的画面描述，一次生成完整覆盖它。
本阶段定的是**结构与内容契约**：unit 边界、时长（时长即计费单位）、台词落位、核心资产指认——用户会逐 unit 审阅确认这份契约。
视觉编排（景别 / 构图 / 运镜扩写）由后续 step2 以你的拆分为基底生成，本阶段不写。

**输出语言**：所有字符串值必须使用 ${targetLanguage}；JSON 键名保持英文。
例外（逐字保留、不翻译）：\`@[名称]\` 中的资产名须逐字等于下方候选表中的登记名；\`source_text\` 须逐字复制小说原文。
**结构约束**：字段 / 枚举 / 必填项由 response_schema 强制；本提示只解释**如何写好每个字段的内容**。

# 上下文

<overview>
${overviewBlock.synopsis}

题材：${overviewBlock.genre}
主题：${overviewBlock.theme}
世界观：${overviewBlock.world_setting}
</overview>

<characters>
${formatAssetLines(characters, lookIdsOf)}
</characters>

<scenes>
${formatAssetLines(scenes)}
</scenes>

<props>
${formatAssetLines(props)}
</props>

## 小说原文

<novel>
${String(novelText || '').slice(0, 28000)}
</novel>

${outlineBlock}# 拆分规则

当前正在生成第 ${episode} 集。请覆盖全部源文情节，按叙事顺序逐 unit 产出。

- **unit 边界**（每个 unit 是一次**独立**视频生成，**无跨 unit 画面衔接**——下一段不会继承上一段末帧/机位）：
  1. 优先：同一连续动作 / 同一连续场景收进**一个** unit；动作在本 unit 内收完，下一 unit 开新场
     （换时间、换地点、或情节硬切），不要把同一连续场景拆成「上段末 + 下段初」两半。
  2. 仅当叙事需要的时长超过最长档（${maxDur} 秒）才被迫拆开；拆开时也要切在**自然节拍边界**，
     使每一段仍是可独立成片的完整小单元（各自有起承收束），禁止把同一 unbroken 动作链
     （如「枪口抵头 → 开枪」）拆进相邻两个 unit 指望画面连续。
  3. 时间 / 空间 / 情节重大切换点开新 unit。
  4. 开新场只切断机位与末帧，不抹掉仍成立的角色状态：同一角色在下一 unit 再次出场时，
     把上一 unit 收束时仍成立的姿态、位置或手持写进新 unit 画面描述的开头（见下方写作指引）。
- **source_text**：该 unit 所依据的小说原文片段，**逐字复制**（可截断首尾，但中间不得删字、改写、翻译或概括）。
  它是追溯锚，用于把生成结果对回原文；不逐字复制会被机械校验拒绝。
- **时长决策序**（自上而下，高优先级是硬边界，低优先级在其内做优化）：
  1. 硬约束：\`duration_seconds\` 是 unit 时长（一次生成调用一个时长），必须取支持档位（${durationsStr}）中的值。
     叙事需要的时长放不下时，按上面的 unit 边界规则重拆为多个**彼此独立**的 unit，**不得违约时长**，
     也不得拆成需要跨段机位连续才能看懂的半截。${referenceRule}
  2. 台词下界：先估算该 unit 全部台词与画外音念完约需的秒数（口播语速约 ${speechRate} ${unitLabel}/秒），
     取**不低于**这个秒数的档位。这是单向下界——台词永不压进念不完的短档；无台词的 unit 没有此下界。
     台词量超过最长档（${maxDur} 秒）时把该 unit 拆开，不要把台词硬塞进一个 unit。${speechOverloadNote}
  3. 画面节拍下界：剥掉台词 / 画外音记号后，按句号、叹号、问号、分号或换行切开的**非空画面描述段**计为一个可见节拍
     （约每 1.5 秒容纳一个独立动作 / 场面切换）。取**不低于**「节拍数 × 1.5 秒」的档位——这与台词下界同等重要：
     多段动作、闪回、环境蒙太奇不得只因台词短就压进最短档。节拍下界超过最长档时把该 unit 拆开。
  4. 默认偏好：${defaultRule}。
  5. 节奏：在 1-4 之内取**同时满足台词下界与画面节拍下界后的最短够用档**；无对白且画面节拍很少时，
     尤其避免无必要地贴近最长档（${maxDur} 秒）。禁止为「塞满」时长而注水动作。${maxRefsRule}

# 正文书写语法

${WRITING_SYNTAX_SPEC}

# 本阶段的正文写作指引

- 画面描述聚焦当下瞬间的**可见动作**：谁做了什么、物件互动、环境动态；动词描述物理可观察动作
  （伸手 / 转身 / 推门 / 投向），避免「陷入 / 回忆 / 意识到 / 决定」等内心动词。
- **跨 unit 可见状态**（不继承末帧或机位）：同一角色再次出场、且上一 unit 收束时仍成立的姿态、位置或手持
  在叙事上未变时，用一句话写进本 unit 画面描述的开头（如「@[李明] 仍坐在桌边，手中仍握着 @[长剑]」），
  再写本 unit 的新动作。换时间、换地点、或情节已改变该状态时不要沿用。不写外貌、服装、妆伤。
- **人物/肢体写清归属**（LMD）：出现角色或手/臂/脚等局部时，能判明是谁就必须 \`@[角色]\` 标明
  （如 \`@[阿杰] 伸手去拿\`、\`@[妈] 的手拦住 @[阿杰]\`），禁止「一只手拦住了他」无主语句。
- 资产名必须逐字取自下列候选，不要发明候选之外的名称：
${candidateBlock(characters, scenes, props)}
- 原文里每一句人物对白（行首「角色：台词」）都必须写成台词记号（\`@[角色]{台词}\`），说话人用源文里的名字，
  台词逐字保留（行首舞台提示括号可略去）；源文写「角色（心里话）/（内心独白）/（心声）：台词」的，写成
  \`@[角色%内心独白]{台词}\`（挂角色音色、不做说话口型）。旁白 / 解说（行首「旁白：」等）写成画外音记号
  （\`{台词}\`）。不要把心里话写成裸 \`{台词}\`，也不要登记成「阿杰（心里话）」这种假角色名。
  禁止用口型、比划、点头、报出一个数字、简短回应等动作描写代替对白。
  心声对应瞬间的画面动作不得写发声相关行为（说话 / 嘟囔 / 轻声 / 耳语 / 啧 / 咂嘴 / 吐舌 / 叹气 /
  清嗓等）；把心声记号写在静默节拍旁，画面保持闭嘴。
  未出镜的说话人只写在台词记号的说话人位，不要在画面描述里再 \`@\` 引用他们。
  台词是内容契约的一部分，step2 不会再改动它。
- **硬约束**（LMD）：source_text 里出现的每一句对白 / 心声 / 旁白，都必须原样出现在同 unit 的 text 里；
  不得为「画面干净」省略心声。漏句会导致整份产出被拒。
- 本阶段不写景别 / 构图 / 运镜（step2 补），把叙事内容与动作过程写清楚即可。

# 输出格式

只输出一个 JSON 对象（不要 markdown）：
{
  "units": [
    {
      "duration_seconds": ${defDur},
      "source_text": "原文逐字片段",
      "text": "画面描述与 @[角色]{台词} …"
    }
  ]
}`;
}

function renderStep1UnitsForStep2(units) {
  return (units || [])
    .map((u, i) => {
      const duration = Number(u.duration_seconds) || 0;
      const body = String(u.text || '');
      return `#### unit ${i + 1}（时长 ${duration}s）\n${body}`;
    })
    .join('\n\n');
}

/**
 * ArcReel build_reference_video_prompt (step2)
 */
function buildStep2ExpandPrompt({
  episode,
  overview = {},
  style = '',
  styleDescription = '',
  aspectRatio = '16:9',
  characters = [],
  scenes = [],
  props = [],
  step1Units = [],
  maxRefs = 9,
  targetLanguage = '中文',
}) {
  const overviewBlock = {
    synopsis: overview.synopsis || overview.description || '',
    genre: overview.genre || '',
    theme: overview.theme || '',
    world_setting: overview.world_setting || '',
  };

  const maxRefsLine =
    maxRefs != null
      ? `\n- 单个 unit 的**画面描述里** \`@\` 引用的资产名（去重后）不超过 ${maxRefs} 个（模型上限）；` +
        '台词记号 `@[角色]{台词}` 的说话人不计入——它不生成参考图，只驱动音色声明。' +
        '超出时把次要角色合并到背景描述，不用 `@` 引用。'
      : '';

  return `# 角色与任务

你是一位资深的短视频分镜编剧，本任务是为「参考生视频」模式的第 ${episode} 集做**视觉展开**。
下方 step1_units 表给出的是已经用户确认的内容契约；你的任务是逐 unit 把正文扩写出景别 / 构图 / 运镜与画面细节。

**输出语言**：所有字符串值必须使用 ${targetLanguage}；JSON 键名保持英文。
**结构约束**：字段 / 必填项由 response_schema 强制；本提示只解释**如何写好正文**。

# 保结构要求（违反即整份产出被拒）

- \`units\` 数组与 step1_units **等长、同序**：不合并、不拆分、不增删 unit。
- 每个 unit 的**台词与画外音逐字保留**：不改词、不增删、不重排、不换说话人。
  特别地：\`@[角色%内心独白]{…}\` / 原文「角色（心里话/心声）：…」**一条都不能丢**（LMD）。
  台词配不上你想要的画面时，请按台词写画面——**不要**改台词、不要为了「画面干净」省略心声。
- 正文里新出现的 \`@[名称]\` 必须是候选表中的登记名（step1 没引用过的资产也可以引用，但必须已登记）。${maxRefsLine}

# 上下文

<overview>
${overviewBlock.synopsis}

题材：${overviewBlock.genre}
主题：${overviewBlock.theme}
世界观：${overviewBlock.world_setting}
</overview>

<style>
风格：${style}
描述：${styleDescription}
画面比例：${aspectRatio}
</style>

<characters>
${formatAssetLines(characters, lookIdsOf)}
</characters>

<scenes>
${formatAssetLines(scenes)}
</scenes>

<props>
${formatAssetLines(props)}
</props>

<step1_units>
${renderStep1UnitsForStep2(step1Units)}
</step1_units>

# 正文书写语法

${WRITING_SYNTAX_SPEC}

# 视觉展开写作指引

正文将直接驱动该 unit 的视频生成，按「景别 → 构图 → 运镜 → 画面内容」四要素依次组织，写足画面信息、宁详勿略：

- 景别：大全景 / 全景 / 中景 / 近景 / 特写，及拍摄角度（俯拍 / 仰拍 / 平视）。
- 构图：主体在画面中的位置、前景与背景的关系（如中心构图、对角线构图、以公路 / 廊柱作引导线）。
- 运镜：机位与镜头运动（固定机位 / 跟随 / 推近 / 拉远 / 摇移），含焦点主体的变更。
- 画面内容：占篇幅大头——unit 时长内发生的全部可见运动：每个出场主体各自的动作链（肢体 / 手势 / 神态过渡）、
  物件互动、背景与环境动态（人群、天气、衣摆、光影移动），可带运动质感（如动态模糊），末尾用一句点明氛围基调。
  动作量与 unit 时长匹配：时长越长，动作段数随之递增。
- **人物/肢体归属**（LMD）：手、臂、脚、背影等局部入画且能判明是谁时，必须写 \`@[角色]\`，
  禁止「一只手拦住了他」「伸手去拿」这类无主语；写清谁的手、拦的是谁。
- 角色 / 场景 / 道具仅用 \`@[名称]\` 引用，候选：
${candidateBlock(characters, scenes, props)}
  外貌、服装、场景陈设等静态外观由参考图承担，**不要**在文本里描写；跨镜换装 / 大战损用
  候选表中的 \`@[角色@造型]\`（须已登记），瞬时局部妆伤既不写外貌也不新建造型。动作、姿态、
  互动与环境动态则写得越具体越好。
  动词应描述物理可观察动作（伸手 / 转身 / 摩挲 / 投向 / 收紧），避免「陷入 / 回忆 / 意识到 / 决定」等内心动词。
  扩写时若 unit 含 \`@[角色%内心独白]{…}\`：心声对应瞬间不要添发声相关动作（说话 / 嘟囔 / 轻声 / 耳语 /
  啧 / 咂嘴 / 吐舌 / 叹气 / 清嗓等）；心声只出画外音色，画面保持闭嘴，记号写在该静默节拍旁。
- **跨 unit 可见状态**（不继承末帧或机位）：同一角色在相邻 unit 都出场、且上一 unit 收束时仍成立的姿态、位置或手持
  在本 unit 开头未变时，画面内容开头用一句话写明（仍坐着、仍握着已引用的道具），再写本 unit 的新动作；
  step1 已写出的这类状态在扩写时保留。换景、换时或状态已变则不要沿用。不写外貌、服装、妆伤。
- 正例：「景别：中景，轻微仰拍。构图：@[角色A] 居画面中心，@[场景A] 的窗棂与案几为前景。运镜：固定机位，缓慢推近。
  画面内容：@[角色A] 在 @[场景A] 中缓步走向窗前，抬手推开木窗，衣摆随穿堂风轻扬；随后低头凝视手中的 @[道具A]，
  指尖缓缓收紧，呼吸放缓，目光从 @[道具A] 缓慢抬起投向窗外；烛焰随风明灭，光影在面部缓慢移动，渲染压抑而克制的氛围。」
- 可读道具内容（手机 / 电脑屏幕、备忘录、纸条、书信、证件等，观众需要看清上面的字或界面）：
  优先过肩或侧脸机位，再落到道具；手从角色自身一侧自然操作，道具朝向角色而非正对镜头。
  若下一 unit 已是该道具的大特写，本 unit 更应保留人物侧脸 / 过肩，把字面清晰度交给下一镜。
  正例：「景别：近景，平拍接轻微下摇。构图：以 @[角色A] 侧脸与肩线为前景，过肩看向手中 @[手机]。
  运镜：从侧脸缓慢下摇至屏幕。画面内容：@[角色A] 以自然握姿持机，拇指从自己一侧敲击，备忘录逐字显现……」
  反例（屏幕反打）：「构图：手指与手机屏幕占据画面主体；运镜：焦点锁定屏幕上跳动的文字」——
  易被生成成屏幕正对镜头、手从观众一侧伸入的反手操作，动作别扭且不像真人用法。
- 反例（过短）：「@[角色A] 站在 @[场景A] 里。」——没有景别 / 构图 / 运镜，也没有动作过程与环境动态，生成的视频会近乎静止。
- 反例（写外貌）：「身穿某色服装的角色A 站在某色场景A 前」——外貌 / 服装 / 颜色应由参考图承担，且未用 \`@[名称]\` 引用。

\`title\` 给本集拟一个简短标题。请按 step1_units 顺序逐 unit 产出。

# 输出格式

只输出一个 JSON 对象（不要 markdown）：
{
  "title": "本集标题",
  "units": [
    { "text": "景别：… 构图：… 运镜：… 画面内容：… @[角色]{台词不变}" }
  ]
}`;
}

module.exports = {
  DEFAULT_DURATIONS,
  buildStep1SplitPrompt,
  buildStep2ExpandPrompt,
  renderStep1UnitsForStep2,
  formatAssetLines,
  candidateBlock,
  formatOutlineBlock,
};
