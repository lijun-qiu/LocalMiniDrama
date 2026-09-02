// 内存覆盖缓存：key => body（仅存可编辑部分，不含锁定的 JSON 格式要求）
const _overrideCache = {};

function loadOverridesIntoCache(overrides) {
  for (const o of overrides) {
    _overrideCache[o.key] = o.content;
  }
}

function setOverrideInMemory(key, content) {
  _overrideCache[key] = content;
}

function clearOverrideInMemory(key) {
  delete _overrideCache[key];
}

// 与 Go application/services/prompt_i18n.go 对齐：提示词与语言
function getLanguage(cfg) {
  return (cfg?.app?.language || 'zh').toLowerCase();
}

function isEnglish(cfg) {
  return getLanguage(cfg) === 'en';
}

/** 画风由前端写入 dramas.metadata.style_prompt_zh / style_prompt_en，mergeCfgStyleWithDrama 注入 cfg.style */

function styleTextForCfgLang(cfg) {
  const z = (cfg?.style?.default_style_zh || '').trim();
  const e = (cfg?.style?.default_style_en || '').trim();
  const d = (cfg?.style?.default_style || '').trim();
  if (isEnglish(cfg)) return e || d;
  return z || d;
}

function styleTextZhForPolish(cfg) {
  return (cfg?.style?.default_style_zh || cfg?.style?.default_style || '').trim();
}

function styleTextEnForImage(cfg) {
  return (cfg?.style?.default_style_en || cfg?.style?.default_style || '').trim();
}

function getCharacterExtractionPrompt(cfg) {
  const style = styleTextForCfgLang(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional character analyst, skilled at extracting and analyzing character information from scripts.

Your task is to extract and organize character settings for all named characters in the script.

Requirements:
1. Extract all characters with names (ignore unnamed passersby or background characters)
2. For each character, extract:
   - name: Character name
   - role: Character role (main/supporting/minor)
   - appearance: Detailed physical appearance for AI image generation (gender, age, body type, facial features, hairstyle, clothing style — NO scene or background info)
   - description: Brief background and relationships (50-100 words)
3. Main characters need detailed appearance; supporting characters can be simplified
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}
Output Format:
**CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code blocks, explanations, or other text. Start directly with [ and end with ].**
Each element is a character object containing the above fields.`;
  }
  const _charOverride = _overrideCache['character_extraction'];
  if (_charOverride) {
    return _charOverride + `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n输出格式：\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个元素是一个角色对象，包含上述字段。`;
  }
  return `你是一个专业的角色分析师，擅长从剧本中提取和分析角色信息。

**【语言要求】所有字段的值必须使用中文，禁止出现英文内容（role字段的值除外，固定为 main/supporting/minor）。**

你的任务是根据提供的剧本内容，提取并整理剧中出现的所有有名字角色的设定。

要求：
1. 提取所有有名字的角色（忽略无名路人或背景角色）
2. 对每个角色，提取以下信息（全部用中文填写）：
   - name: 角色名字（中文）
   - role: 角色类型，固定值之一：main / supporting / minor
   - appearance: 外貌描述（中文，100-200字，包含性别、年龄、体型、面部特征、发型、服装风格等，不含任何场景或环境信息）
   - description: 背景故事和角色关系（中文，50-100字）
3. 主要角色外貌要详细，次要角色可简化
- **风格要求**：${style}
- **图片比例**：${imageRatio}
输出格式：
**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**
每个元素是一个角色对象，包含上述字段。`;
}

function getStoryboardSystemPrompt(cfg) {
  if (isEnglish(cfg)) {
    return `[Role] You are a senior film storyboard artist, proficient in Robert McKee's shot breakdown theory, skilled at building emotional rhythm.

[Task] Break down the novel script into storyboard shots based on **independent action units**.

[Shot Breakdown Principles]
1. **Action Unit Division**: Each storyboard shot corresponds to a **narrative beat**, and may contain 1-4 rapid internal cuts (described in the style of "Shot 1 ... Cut to Shot 2 ...") to fully utilize AI video clips of 5-15 seconds, avoiding excessive short clips caused by the old "one action per shot" rule that wastes generation time.
   - Ideal for merging character power awakening, quick reactions, or continuous actions into one storyboard entry connected by internal cuts
   - Only split into separate shots when there are clear pauses, scene changes, or narrative reasons for independent presentation
   - Traditional storyboard prompt style (with multi-shot cut descriptions) is fully supported

2. **Shot Type Standards** (choose based on storytelling needs):
   - Extreme Long Shot (ELS): Environment, atmosphere building
   - Long Shot (LS): Full body action, spatial relationships
   - Medium Shot (MS): Interactive dialogue, emotional communication
   - Close-Up (CU): Detail display, emotional expression
   - Extreme Close-Up (ECU): Key props, intense emotions

3. **Camera Movement Requirements**（**Dynamic Priority Mandatory**）:
   - 【Core Rule】: Every video segment MUST use **dynamic camera movement**. **Static/fixed shots shall not exceed 20%**. Prioritize push/pull/pan/tilt/track/crane/orbit/whip/roll/zoom.
   - Basic movements:
     * Push In: Forward approach, builds tension/intimacy
     * Pull Out: Backward reveal, shows environment or emotional release
     * Pan: Horizontal rotation, spatial reveal or lateral following
     * Tilt: Vertical rotation, height reveal or emotional rise/fall
     * Tracking/Follow: Camera follows subject, keeps subject framed
     * Crane Up: Ascending boom, grandeur or liberation
     * Crane Down: Descending boom, oppression or weight
     * Orbit: 360° circling around subject,立体 spatial depth
     * Handheld: Slight shake, realism/tension
   - Advanced movements:
     * Zoom: Optical zoom in/out without moving camera position
     * Roll: Rotation along lens axis, vertigo or weightlessness
     * Whip Pan: Rapid whip pan, temporal jump or chaos
     * Spiral: Ascend/descend while orbiting, dreamlike or crushing
   - Cinematic compound shots (use based on emotion):
     * Hitchcock Zoom (hitchcock_zoom): Push + zoom out (or reverse), spatial distortion vertigo, expresses terror/disorientation
     * Bullet Time (bullet_time): Orbit + slow-motion, subject ultra-slow, background spins fast, captures peak dramatic moment
     * Dutch Angle + Move (dutch_angle_move): Tilted frame + pan/orbit, mental breakdown/world collapse
     * Dolly + Track (dolly_track): Push + lateral move, complex emotional progression
     * Slow-mo Orbit (slowmo_orbit): Slow-motion circling, time-freezing dramatic instant

4. **Emotion & Intensity Markers**:
   - Emotion: Brief description (excited, sad, nervous, happy, etc.)
   - Intensity: Emotion level using arrows
     * Extremely strong ↑↑↑ (3): Emotional peak, high tension
     * Strong ↑↑ (2): Significant emotional fluctuation
     * Moderate ↑ (1): Noticeable emotional change
     * Stable → (0): Emotion remains unchanged
     * Weak ↓ (-1): Emotion subsiding

5. **Narrative Segment Grouping**:
   - Group consecutive shots into named narrative segments (e.g., "Arrival", "Confrontation", "Resolution")
   - Each segment = a coherent dramatic beat or scene transition
   - Segment rules:
     * 1–3 segments for short scripts (≤10 shots)
     * 3–6 segments for medium scripts (10–30 shots)
     * Shot count per segment: suggest 3–8 shots (avoid 1-shot segments unless a major turning point)
     * Opening shots: wide/establishing, closing shots: close-up/reaction to cap the beat

[Output Requirements]
1. Return a JSON array. Each element is one shot object containing ALL of the following fields:
   - shot_number: Shot number (integer, starting from 1)
   - title: Shot title (3–8 words, concise summary of this shot's key action or visual, e.g., "Lin Wei Enters the Room", "Tense Eye Contact")
   - segment_index: Segment index (0-based integer, e.g., 0, 1, 2…)
   - segment_title: Segment name (short 2–6 words, e.g., "Chance Encounter", "Hidden Truth Revealed")
   - location: Location name (e.g., "bedroom interior", "rooftop", "hospital corridor")
   - time: Time of day (e.g., "morning", "dusk", "night", "afternoon")
   - shot_type: Shot type (extreme long shot/long shot/medium shot/close-up/extreme close-up)
   - camera_angle: Camera angle (eye-level/low-angle/high-angle/side/back)
   - camera_movement: Camera movement — MUST be one of: static, push, pull, pan, tilt, tracking, crane_up, crane_dn, orbit, handheld, zoom, roll, whip_pan, spiral, hitchcock_zoom, bullet_time, dutch_angle_move, dolly_track, slowmo_orbit (prefer dynamic over static)
   - lighting_style: Lighting style — choose ONE: natural/front/side/backlit/top/under/soft/dramatic/golden_hour/blue_hour/night/neon
   - depth_of_field: Depth of field — choose ONE: extreme_shallow/shallow/medium/deep (close-up → shallow/extreme_shallow; wide shot → deep)
   - action: Action description
   - result: Visual result of the action
   - dialogue: Character dialogue or narration (if any)
   - emotion: Current emotion
   - emotion_intensity: Emotion intensity level (3/2/1/0/-1)

**CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code blocks, explanations, or other text. Start directly with [ and end with ].**

[Important Notes]
- Shot count should match the number of **narrative beats** in the script (merging rapid consecutive actions with internal cuts inside a single storyboard entry is encouraged to optimize AI video duration)
- Each shot must have clear title, action (which may include multi-cut descriptions), result
- Shot types must match storytelling rhythm (don't use same shot type continuously)
- Emotion intensity must accurately reflect script atmosphere changes
- segment_index must be sequential integers starting from 0; all shots in the same segment share the same index and title`;
  }
  const _sbOverride = _overrideCache['storyboard_system'];
  if (_sbOverride) {
    return _sbOverride + '\n\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n\n【重要提示】\n- 镜头数量必须与剧本中的独立动作数量匹配（不允许合并或减少）\n- 每个镜头必须有明确的动作和结果\n- 景别选择必须符合叙事节奏（不要连续使用同一景别）\n- 情绪强度必须准确反映剧本氛围变化';
  }
  return `【角色】你是一位资深影视分镜师，精通罗伯特·麦基的镜头拆解理论，擅长构建情绪节奏。

【任务】将小说剧本按**独立动作单元**拆解为分镜头方案。

【分镜拆解原则】
1. **动作单元划分**：每个分镜对应一个**叙事节拍**，允许包含1-4个快速连续的内部切镜（使用“镜头1 ... 切镜到镜头2 ...”风格描述），以充分利用AI视频至少5秒、最长可达15秒的时长，避免因“一个镜头一个动作”导致产生过多短时长片段造成时间浪费。
   - 适合将角色能量觉醒、快速反应、连续动作等合并在一个分镜内，用内部切镜串联
   - 仅当动作间有明显停顿、场景切换或叙事需要独立呈现时，才拆分为多个分镜
   - 传统分镜风格的提示词（含多镜头切镜描述）同样支持

2. **景别标准**（根据叙事需要选择）：
   - 大远景：环境、氛围营造
   - 远景：全身动作、空间关系
   - 中景：交互对话、情感交流
   - 近景：细节展示、情绪表达
   - 特写：关键道具、强烈情绪

3. **运镜要求**（**强制动态优先**）：
   - 【运镜总原则】：每段视频必须使用**动态运镜**，**固定镜头不得超过20%**。优先选择推/拉/摇/跟/升/降/环绕/甩/旋转/变焦等运动镜头。
   - 基础运镜：
     * 推镜（push）：镜头向前推进，增强紧张/亲密感
     * 拉镜（pull）：镜头向后拉开，揭示环境或情绪回落
     * 横摇（pan）：水平旋转摄像机，展现空间或跟随横向动作
     * 纵摇（tilt）：垂直旋转摄像机，展现高度或情绪起伏
     * 跟镜/跟踪（tracking）：摄像机跟随主体移动，保持主体在画框内
     * 升镜（crane_up）：吊臂上升，展现宏大或解放感
     * 降镜（crane_dn）：吊臂下降，压迫或沉重感
     * 环绕（orbit）：绕主体360°运动，展现立体空间
     * 手持（handheld）：轻微晃动，增加真实/紧张感
   - 进阶运镜：
     * 变焦（zoom）：光学变焦推进或拉远，不移动机位
     * 旋转/滚镜（roll）：镜头沿光轴旋转，制造眩晕/失重
     * 甩镜（whip_pan）：快速急摇，制造时空跳转或混乱感
     * 螺旋（spiral）：边升/降边环绕，梦幻或压迫感
   - 电影化组合镜头（根据剧情情绪选用）：
     * 希区柯克镜头（hitchcock_zoom）：向前推+变焦拉远（或反向），制造空间扭曲的眩晕感，表现惊恐/错乱
     * 子弹时间（bullet_time）：环绕+升格（slow-motion），主体动作极缓，背景高速旋转，表现关键高能时刻
     * 荷兰角+运镜（dutch_angle_move）：倾斜构图+横摇/环绕，表现精神错乱/世界崩塌
     * 推轨复合（dolly_track）：推镜+横向移动，复杂情绪递进
     * 升格环绕（slowmo_orbit）：慢动作环绕，时间凝固的戏剧性时刻

4. **情绪与强度标记**：
   - emotion：简短描述（兴奋、悲伤、紧张、愉快等）
   - emotion_intensity：用箭头表示情绪等级
     * 极强 ↑↑↑ (3)：情绪高峰、高度紧张
     * 强 ↑↑ (2)：情绪明显波动
     * 中 ↑ (1)：情绪有所变化
     * 平稳 → (0)：情绪不变
     * 弱 ↓ (-1)：情绪回落

5. **叙事段落分组**：
   - 将连续镜头归组为命名段落（如"邂逅"、"矛盾激化"、"和解"）
   - 每个段落 = 一个连贯的戏剧节拍或场景切换
   - 分组规则：
     * 短剧本（≤10个镜头）：1–3个段落
     * 中等剧本（10–30个镜头）：3–6个段落
     * 每段建议3–8个镜头，避免1镜头单独成段（除非是重大转折点）
     * 段落开篇用大远景/远景建立环境，段落结尾用近景/特写收尾

【输出要求】
1. 返回一个JSON数组，每个元素是一个镜头对象，必须包含以下**全部**字段：
   - shot_number：镜头号（整数，从1开始）
   - title：镜头标题（3–8字，简洁概括本镜头的核心动作或视觉重点，如"林薇走进房间"、"紧张的对视"）
   - segment_index：段落索引（从0开始的整数，如 0、1、2……）
   - segment_title：段落名称（简短2–6字，如"意外相遇"、"真相大白"）
   - location：场景地点名称（如"卧室内"、"天台"、"医院走廊"）
   - time：拍摄时间（如"清晨"、"黄昏"、"夜晚"、"午后"）
   - shot_type：景别（大远景/远景/中景/近景/特写）
   - camera_angle：机位角度（平视/仰视/俯视/侧面/背面）
   - camera_movement：运镜方式（static/推镜push/拉镜pull/横摇pan/纵摇tilt/跟镜tracking/升镜crane_up/降镜crane_dn/环绕orbit/手持handheld/变焦zoom/旋转roll/甩镜whip_pan/螺旋spiral/希区柯克hitchcock_zoom/子弹时间bullet_time/荷兰角dutch_angle_move/推轨复合dolly_track/升格环绕slowmo_orbit）——**强制动态优先，固定镜头不得超过20%**
   - lighting_style：灯光风格 — 从以下选一个填入：natural/front/side/backlit/top/under/soft/dramatic/golden_hour/blue_hour/night/neon（根据 time 和 atmosphere 判断；夜晚→night，黄昏→golden_hour，室内暖光→soft，强情绪→dramatic，逆光→backlit）
   - depth_of_field：景深 — 从以下选一个填入：extreme_shallow/shallow/medium/deep（特写/近景→shallow，中景→medium，远景/大远景→deep）
   - action：动作描述
   - result：动作完成后的画面结果
   - dialogue：角色对话或旁白（如有）
   - emotion：当前情绪
   - emotion_intensity：情绪强度等级（3/2/1/0/-1）

2. **构图与视觉设计参考**（生成分镜时运用）：
   - 景别变化规律：禁止连续3个及以上镜头使用相同景别，情绪递进时逐步推近（远→中→近→特写）
   - 构图建议：三分法（稳定叙事）/ 对角线（动态张力）/ 框架构图（增加纵深）/ 中心构图（庄重仪式感）
   - 光线方向：在 atmosphere 字段中注明光源方向和色温（如"左侧冷蓝光，逆光轮廓"）
   - 对话场景：使用正反打（过肩镜头交替），避免连续同向构图
   - 视频电话/语音电话/远程会议：以**接听方**为主镜（中近景），characters只填接听方；对方仅在手机/屏幕小窗或画外音，禁止两人实体同框

**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**

【重要提示】
- 镜头数量应与剧本中的**叙事节拍**数量匹配（允许在单个分镜内用内部切镜合并快速连续动作，以优化AI视频时长）
- 每个分镜必须有明确的 title（标题）、action（动作）和 result（结果）；action 中可包含多镜头切镜描述
- 景别选择必须符合叙事节奏（不要连续使用同一景别）
- 情绪强度必须准确反映剧本氛围变化
- segment_index 必须从0开始递增的整数，同一段落内所有镜头共享相同的 segment_index 和 segment_title`;
}

/**
 * 全能片段描述统一格式说明（分镜批量生成 / 生成全能提示词 / 润色 共用）
 */
function getUniversalOmniMultiBeatFormatSpec(cfg) {
  const { DEFAULT_LINE3 } = require('./universalOmniMultiBeatFormat');
  const {
    GEN_TIME_TIMELINE_CONTRACT_ZH,
    GEN_TIME_TIMELINE_CONTRACT_EN,
    MULTI_PLACE_ACTIVITY_TEMPLATE_ZH,
    MULTI_PLACE_ACTIVITY_TEMPLATE_EN,
    MENTION_NE_APPEAR_TEMPLATE_ZH,
    MENTION_NE_APPEAR_TEMPLATE_EN,
  } = require('./universalAgnesTimelineContract');
  if (isEnglish(cfg)) {
    return `
[UNIVERSAL_SEGMENT_TEXT — MULTI-BEAT BLOCK FORMAT ONLY]
FORBIDDEN: SoulLens/SEEDANCE single-line rows (主体:/叙事动态:/空间:/[禁BGM]); FORBIDDEN @人物N — use @图片1, @图片2, … only.

Field "universal_segment_text" is a **multi-line string** (use \\n in JSON). Structure:
Line 1: 画面风格和类型: 真人写实, 电影风格, 高清画质, <short style from project>
Line 2: 生成一个由以下M个分镜组成的视频. (M integer 1–8)
Line 3 (copy verbatim): ${DEFAULT_LINE3}
Lines 4..(3+M): 分镜k： Tk秒: <cinematic Chinese prose for that slice; camera motion chain; light; emotion>
Sum(T1..TM) MUST equal this shot's JSON "duration" seconds exactly.

Reference tokens: @图片1 = scene/environment only; @图片2+ = characters in characters[] order; then props if any.
CRITICAL: Follow SUBJECT_IDENTITY_LOCK / PRIMARY_SUBJECT — never swap who acts or speaks onto another character's @图片N.
Dialogue: speaker's mapped @图片N says:"verbatim line". No speech: end with 无对白。 or 人物闭口无口型，无对白。
**Narration field separation**: NARRATION lives in storyboard.narration and is added post via IndexTTS. **FORBIDDEN** inside beat lines: 旁白（画面无声）："…" or copying narration verbatim. Each beat must be **visual-only** cinematic prose (camera, @图片N action, light, blocking) that **shows** what NARRATION means — never paste VO text into the beat body.
**M selection**: choose M from narration/action semantic beats — NOT a fixed 3. Short single-beat VO → M=1–2; multi-sentence VO → split by sentence/action. Never pad empty beats to force three shots.
**AV sync**: in each beat, visible action must match the **same semantic moment** as the corresponding NARRATION excerpt (from STORYBOARD_FIELDS) — keep picture and VO in sync. Forbid empty camera moves with no visual payoff for that beat's narration slice.
${MENTION_NE_APPEAR_TEMPLATE_EN}
${GEN_TIME_TIMELINE_CONTRACT_EN}
${MULTI_PLACE_ACTIVITY_TEMPLATE_EN}
Each beat: rich motion picture prose (push in, pull back, rack focus).`;
  }
  return `
【universal_segment_text — 多子分镜段落格式（与「生成全能提示词」「润色」完全一致）】
**禁止**使用已废弃的灵境/SoulLens **单行**格式（含「主体：」「叙事动态：」「空间：」「镜头：」段标、行末 [禁BGM][禁字幕]、@人物N 指代参考图）。

本字段为 **多行字符串**（JSON 中用 \\n 换行），结构固定：
第1行：画面风格和类型: 真人写实, 电影风格, 高清画质, <可再加项目风格短语>
第2行：生成一个由以下M个分镜组成的视频。（M 为 1–8 的整数，与下文分镜条数一致）
第3行（必须逐字一致）：${DEFAULT_LINE3}
第4行起：分镜1： T1秒: …、分镜2： T2秒: … … 分镜M： TM秒: …
**硬性约束**：T1+T2+…+TM 必须严格等于本镜 JSON 的 duration（秒）；每行一条子分镜，禁止额外说明行。

子分镜正文写法（电影化中文长句，参考产品范例）：
- **参考图**：仅用 @图片1、@图片2…（阿拉伯数字）；@图片1 只写环境/光影/陈设；角色从 @图片2 起按 characters[] 顺序；有道具则继续 @图片3 …
- **主人公锁定（最高优先级）**：必须遵守 SUBJECT_IDENTITY_LOCK / PRIMARY_SUBJECT；ACTION 里谁做主戏，正文只能绑到其映射的 @图片N；禁止把甲的动作/表情/台词写到乙的 @图片槽。
- **运镜**：每段含至少两步运镜（如 缓推、横移、跟拍、拉回、俯拍特写），与人物动作同步。
- **对白**：有 dialogue 时必须写出原文，且说话人必须用 DIALOGUE_SPEAKER_MAP 指定的 @图片N（如 @图片3 说："对白原文"）；无对白则句末写 **无对白。** 或 **人物闭口无口型，无对白。**
- **解说与节拍（最高优先级之一）**：
  - **旁白不进 beat 正文**：旁白原文仅存在于分镜字段 narration，成片由 IndexTTS 后期叠加。**禁止**在「分镜k」行内写「旁白（画面无声）："…"」或照抄旁白原文；须将旁白语义**转写为可视动作/场景/运镜**（谁在 @图片N 做什么、镜头如何运动、光线氛围）。
  - **M 按旁白/动作语义分配**，禁止机械固定三镜或照抄「约每 5 秒一拍」。单句短旁白或单一动作 → M=1～2；多句旁白/多步动作 → 按句或动作拆分；秒数不够则合并相邻短句，**禁止为空镜硬凑 M=3**。
  - **旁白时间轴（硬性）**：T1+…+TM=本镜 duration；**各 Tk 按 NARRATION 可读字权重分配**（与 IndexTTS/字幕一致），**禁止机械均分**（9s 勿默认 3+3+3）。每个 beat 的画面动作须落在该拍时间窗内对应旁白语义；例：9s 为 3+2+4，「你推开门」约在 4.5s → 属分镜2（3～5s），推门须写在分镜2。
  - **声画同步**：每个语义点的可见动作/结果须与 STORYBOARD_FIELDS 中 **NARRATION 对应摘录** 同一时段对齐（画面与旁白同步发生，不要求画面提前也不滞后）。禁止前几行只有空运镜、末行堆整段旁白原文。
  - **旁白「你/您」= PRIMARY_SUBJECT**：第二人称须绑到 SUBJECT_IDENTITY_LOCK 中的主人公 @图片N，禁止写成无绑定的路人/剪影/另一张脸。
  - **旁白多地点列举（你在A…你在B…）**：同一人不同时空片段，**不是**三个不同角色；每格/每拍须 @图片N 同一张脸。
  ${MULTI_PLACE_ACTIVITY_TEMPLATE_ZH}
  - 多句旁白按时间顺序拆到各「分镜k」的**画面动作**；每行只覆盖本子时段正在发生的可见事件。
  ${GEN_TIME_TIMELINE_CONTRACT_ZH}
- **禁止**：概括式台词（如「他说了一句重要的话」）、@人物N、markdown、SoulLens 段标签、角色串槽、beat 内嵌旁白引文

范例结构（勿照抄剧情或固定三镜；M 可为 1/2/4…，仅学排版与纯画面写法）：
画面风格和类型: 真人写实, 电影风格, 高清画质, 纪录片质感
生成一个由以下2个分镜组成的视频。
${DEFAULT_LINE3}
分镜1： 6秒: 镜头缓推，@图片2 抬手指向窗外雨幕并起身走向窗边，人物闭口无口型，无对白。
分镜2： 4秒: 镜头定近，@图片2 望向远处街灯，情绪落定，人物闭口无口型，无对白。

多时空模板范例（同一人多地点；勿照抄；M=1 单行或 M=3 每地一拍）：
分镜1： 12秒: 【运镜】镜头沿时间线缓推——【定格1·地点A】@图片2 + 该地具体动作与光线；【定格2·地点B】@图片2 同一张脸 + 另一地动作；【定格3·地点C】@图片2 同一张脸；人物闭口无口型，无对白。`;
}

/**
 * 分镜生成「全能分镜模式」：JSON 每镜带 creation_mode + universal_segment_text（多子分镜段落格式）
 */
function getStoryboardUniversalOmniModeSuffix(cfg) {
  const spec = getUniversalOmniMultiBeatFormatSpec(cfg);
  if (isEnglish(cfg)) {
    return `

[HIGHEST PRIORITY — UNIVERSAL OMNI STORYBOARD MODE]
Every shot object MUST also include:
1. "creation_mode": exact string "universal".
2. "universal_segment_text": multi-line block per spec below (NOT a single SoulLens line).
${spec}`;
  }
  return `

【最高优先级——全能分镜模式】
每个镜头在保留上述全部原有字段的同时，还必须额外包含：
1. "creation_mode"：固定字符串 "universal"（不可省略）。
2. "universal_segment_text"：按下列 **多子分镜段落** 规范书写（与后续「生成全能提示词」「润色」同一套版式，禁止单行灵境格式）。
${spec}`;
}

/** 全文解说旁白视频模式：任务说明（替换默认 task_instruction） */
function getStoryboardFullNarrationTaskInstruction(cfg) {
  if (isEnglish(cfg)) {
    return 'Treat the script block above as the **full verbatim narration script** (not a plot summary). Split it into consecutive shots by readable VO length: each shot\'s "narration" must be a **continuous verbatim excerpt** from that script — no paraphrase, no shortening, no skipped sentences. Concatenating all "narration" fields in shot order must cover the **entire** script text exactly once. Shot count follows script length and per-shot duration, not arbitrary plot merging.';
  }
  return '将上方【剧本内容】视为**全文解说旁白原文**（不是剧情摘要或提纲）。按朗读时长把原文**逐字连续分段**拆成多个镜头：每镜 "narration" 必须是原文的**连续摘录**，禁止改写、缩写、概括或跳句；所有镜头的 narration 按镜序拼接后须**完整覆盖**原文且每句只出现一次。镜数由原文长度与每镜可读时长决定，禁止为凑镜数合并段落或跳过原文。';
}

/**
 * 全文解说旁白视频模式：追加到用户提示词
 * @param {{ clipDuration?: number|null, scriptLength?: number }} opts
 */
function getStoryboardFullNarrationModeInstructions(cfg, opts = {}) {
  const { resolveFullNarrationLimits } = require('./fullNarrationConstants');
  const limits = opts.narrationLimits || resolveFullNarrationLimits();
  const {
    NARRATION_CHARS_PER_SEC: charsPerSec,
    FULL_NARRATION_MAX_SEC: maxSegmentSec,
    FULL_NARRATION_DURATION_MIN_SEC: durationMinSec,
    FULL_NARRATION_MAX_CHARS: maxCharsPerShot,
  } = limits;
  const exampleFloor = Math.round(durationMinSec * charsPerSec);
  const exampleMax = maxCharsPerShot;
  if (isEnglish(cfg)) {
    return `

【FULL VERBATIM NARRATION — PERIOD SPLIT (classic / universal unified)】
- The script is the **only** narration source. Split by **。** (each sentence is one unit); merge **consecutive sentences** into one shot while combined speech chars ≤ **${maxCharsPerShot} (~${maxSegmentSec}s)**; start a new shot when the next sentence would exceed the limit (no sentence-count cap).
- Each shot's "narration" = **verbatim** excerpt.
- **duration**: ceil(speech chars ÷ ${charsPerSec}) seconds, clamped to **${durationMinSec}–${maxSegmentSec}s**.
- **Forbidden**: rewriting, summarizing, or inventing narration. "dialogue" empty unless labeled character lines exist.
- **Shot 1**: open with the first narration segment (non-empty). Do **not** insert an empty title-card shot.`;
  }
  return `

【全文解说旁白视频模式 — 硬性要求（经典 / 全能统一）】
- 上方剧本正文即**唯一旁白来源**；以**。**切分为句段，**连续多句**合并为一镜（合计可读字数不超过 **${maxCharsPerShot} 字 / ${maxSegmentSec} 秒**，无句数上限）；再加下一句会超限则新开一镜。
- 每镜 "narration" = 原文**逐字连续摘录**。
- 每镜 **duration**：ceil(旁白可读字数 ÷ ${charsPerSec}) 秒，限制在 **${durationMinSec}～${maxSegmentSec} 秒**。可读字数 = 汉字/字母/数字，**不含标点**；例：${exampleFloor}字→${durationMinSec}秒，${exampleMax}字→${maxSegmentSec}秒。
- **禁止**：改写、缩写、概括、编造旁白。"dialogue" 一律留空（除非剧本有明确角色对白）。
- "action" / "result" / 画面：配合该段旁白设计镜头；画内人物**闭口无口型**（仅画外解说）。
- **第 1 镜**即从原文第一个字开始旁白（非空）。**不要**插入空旁白的片头镜。`;
}

/** 全文解说旁白视频模式：系统提示词最高优先级覆盖 */
function getStoryboardFullNarrationSystemOverride(cfg, opts = {}) {
  const { resolveFullNarrationLimits } = require('./fullNarrationConstants');
  const limits = opts.narrationLimits || resolveFullNarrationLimits();
  const {
    FULL_NARRATION_MAX_CHARS: maxCharsPerShot,
    FULL_NARRATION_MAX_SEC: maxSegmentSec,
  } = limits;
  if (isEnglish(cfg)) {
    return `

[HIGHEST PRIORITY — FULL NARRATION PERIOD SPLIT]
- Split script by **。**; merge consecutive sentences per shot while combined speech chars ≤ ${maxCharsPerShot} (~${maxSegmentSec}s); no sentence-count cap.
- Every "narration" (from shot 1): verbatim. Do not insert an empty title-card shot.`;
  }
  return `

【最高优先级——全文解说：句号切分合并】
- 以**。**切句；连续多句合并为一镜（合计不超过 ${maxCharsPerShot} 字 / ${maxSegmentSec} 秒），无句数上限；再加下一句会超限则新开一镜。
- 从第 1 镜起 narration 必须逐字摘录原文；不要插入空旁白片头镜。`;
}

/** 分镜生成勾选「解说旁白」时追加到用户提示词末尾 */
function getStoryboardNarrationExtraInstructions(cfg) {
  if (isEnglish(cfg)) {
    return `

【VO / Narration mode — STRICT (user enabled full VO pipeline)】
- Add string field "narration" to **each** shot. **Every "narration" MUST be a non-empty string** (at least one full sentence), readable within this shot's "duration".
- **Shot with shot_number = 1 MUST** open with narrator lines: set time/place/mood or a hook — never leave empty because the shot is "establishing only".
- **Shot 2** should also carry narration if it is still wide/establishing; do not leave both 1 and 2 empty.
- Third-person / documentary narrator voice — **not** character dialogue (keep spoken lines in "dialogue" only). Do not copy dialogue text into "narration".
- 1–3 short sentences per shot; forbid consecutive shots with empty "narration".`;
  }
  return `

【解说旁白模式 — 硬性要求（用户已开启全片解说管线）】
- 在 "storyboards" 数组的**每一个**镜头对象中必须有字符串字段 "narration"，且 **narration 一律不得为空字符串**（每镜至少一句完整解说，约 10～50 字，须在本镜 duration 秒内能读完）。
- **shot_number 为 1 的第一个镜头**：必须有**开场解说**（交代时间、空间、氛围或悬念钩子），禁止以「纯建立镜头、无对白所以无旁白」为由留空；大远景/远景用旁白描述环境与基调，把观众带进故事。
- **第 2 个镜头**：若仍为远景/大远景/环境铺垫，同样必须写旁白；**禁止第 1、2 镜连续留空**。
- narration 为画外第三人称或纪录片式解说，与角色对白 dialogue 严格区分；对白只写在 dialogue，不要把对白原文复制进 narration。
- 每镜 1～3 句为宜；禁止连续多个镜头的 narration 为空。`;
}

function formatUserPrompt(cfg, key, ...args) {
  const style = styleTextForCfgLang(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  const templates = {
    en: {
      character_request: 'Script content:\n%s\n\nPlease extract and organize detailed character profiles for ALL named characters from the script.',
      drama_info_template: `Title: %s\nSummary: %s\nGenre: %s\nStyle: ${style}\nImage ratio: ${imageRatio}`,
      script_content_label: '【Script Content】',
      task_label: '【Task】',
      character_list_label: '【Available Character List】',
      scene_list_label: '【Extracted Scene Backgrounds (prefer this episode)】',
      task_instruction: 'Break down the novel script into storyboard shots based on **independent action units**.',
      character_constraint: '**Important** — characters field rules:\n1. Only use character IDs (numbers) from the above character list. Do not invent IDs.\n2. Only include characters who **physically appear and act** in this specific shot. Do NOT list characters who are merely mentioned, offscreen, or appear in the overall scene but not in this shot.\n3. The number of characters listed must match who is described in the action/dialogue fields. If the action only describes one person, list only that one character.\n4. **MUST fill**: if action/dialogue/narration names a character from the list who is on screen, their ID **must** appear in characters — never leave characters as [] when someone is clearly in the shot.\n5. **Video/voice call or remote meeting**: use the **person who answers/receives the call** as the on-screen subject. characters must list only that receiver; the remote party may appear only on a phone/screen inset or as voice — never both people physically in the same frame.',
      scene_constraint: '**Important** — scene_id rules:\n1. Choose the best-matching background ID from the list above (prefer this episode\'s scenes).\n2. Match the shot\'s actual location; do not reuse a wrong-location scene just because it is available.\n3. If no suitable background exists, use null.',
      prop_list_label: '【Available Prop List (prefer this episode)】',
      prop_constraint: '**Important** — props field rules:\n1. Only use prop IDs (numbers) from the above prop list. Do not invent IDs.\n2. Only include props that are **visually present and actively used or prominently featured** in this specific shot.\n3. **Exact object match**: the prop name must match the object in action/dialogue/narration (e.g. computer ≠ phone; photo wall ≠ paper note). Never substitute a similar "digital carrier" from another context.\n4. **MUST fill**: if action/dialogue/narration clearly shows a listed prop on screen, include its ID — do not default to [] out of caution.\n5. If no props from the list appear in the shot, use an empty array [].',
      frame_info: 'Shot information:\n%s\n\nPlease directly generate the image prompt for the first frame without any explanation:',
      key_frame_info: 'Shot information:\n%s\n\nPlease directly generate the image prompt for the key frame without any explanation:',
      last_frame_info: 'Shot information:\n%s\n\nPlease directly generate the image prompt for the last frame without any explanation:',
      shot_description_label: 'Shot description: %s',
      scene_label: 'Scene: %s, %s',
      characters_label: 'Characters: %s',
      action_label: 'Action: %s',
      result_label: 'Result: %s',
      dialogue_label: 'Dialogue: %s',
      atmosphere_label: 'Atmosphere: %s',
      shot_type_label: 'Shot type: %s',
      angle_label: 'Angle: %s',
      movement_label: 'Movement: %s',
      storyboard_count_constraint: '**Constraint**: Total shot count must be around %s (allow ±20%). Please merge or split actions to meet this requirement.',
      video_duration_constraint: '**Constraint**: Total video duration must be around %s seconds (allow ±10%). Please adjust shot count and duration to meet this requirement.',
    },
    zh: {
      character_request: '剧本内容：\n%s\n\n请提取剧本中所有有名字角色的设定。',
      drama_info_template: `剧名：%s\n简介：%s\n类型：%s\n风格: ${style}\n图片比例: ${imageRatio}`,
      script_content_label: '【剧本内容】',
      task_label: '【任务】',
      character_list_label: '【本剧可用角色列表】',
      scene_list_label: '【本集已提取的场景背景列表】',
      task_instruction: '将小说剧本按**独立动作单元**拆解为分镜头方案。',
      character_constraint: '**重要** — characters字段填写规则：\n1. 只能使用上述角色列表中的角色ID（数字），不得自创ID。\n2. 只填写在**本镜头中实际出现并有具体行为**的角色。不要把"提到的"、"画面外的"、或整个场景里有但本镜头动作中未描述的角色也列进去。\n3. characters数量必须与action/dialogue中实际描写的人物数量一致。如果action只描述了一个人的动作，characters里就只填那一个人的ID。\n4. **必须填写**：若 action/dialogue/narration 中点名且画面内出现列表中的角色，则 characters **必须**包含其ID，禁止在有人出镜时仍填空数组[]。\n5. **视频电话/语音电话/远程会议**：以**接听方**为主镜构图，characters只填接听方一人；对方仅可在手机/屏幕小窗或画外音中出现，禁止两人实体同框。',
      scene_constraint: '**重要** — scene_id填写规则：\n1. 必须从上述背景列表中选择最匹配的背景ID（数字），优先匹配本集场景。\n2. 地点必须与镜头实际地点一致，禁止用错误地点的场景凑数。\n3. 如果没有合适的背景，则填null。',
      prop_list_label: '【本集可用道具列表】',
      prop_constraint: '**重要** — props字段填写规则：\n1. 只能使用上述道具列表中的道具ID（数字），不得自创ID。\n2. 只填写在**本镜头中视觉上出现并被使用或显著展示**的道具。\n3. **物体必须一致**：道具名须与 action/dialogue/narration 中的实物一致（如电脑≠手机、照片墙≠纸条），禁止用近似「数字信息载体」跨场景顶替。\n4. **必须填写**：若 action/dialogue/narration 明确写出列表中的道具出现在画面中，则 props **必须**包含其ID，禁止因保守而一律填[]。\n5. 如果本镜头中没有列表中的道具出现，则填空数组[]。',
      frame_info: '镜头信息：\n%s\n\n请直接生成首帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：',
      key_frame_info: '镜头信息：\n%s\n\n请直接生成关键帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：',
      last_frame_info: '镜头信息：\n%s\n\n请直接生成尾帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：',
      shot_description_label: '镜头描述: %s',
      scene_label: '场景: %s, %s',
      characters_label: '角色: %s',
      action_label: '动作: %s',
      result_label: '结果: %s',
      dialogue_label: '对白: %s',
      atmosphere_label: '氛围: %s',
      shot_type_label: '景别: %s',
      angle_label: '角度: %s',
      movement_label: '运镜: %s',
      storyboard_count_constraint: '**重要约束**：总分镜数量必须控制在 %s 个左右（允许 ±20% 的偏差）。请务必合并或拆分动作以满足此数量要求。',
      video_duration_constraint: '**重要约束**：视频总时长必须控制在 %s 秒左右（允许 ±10% 的偏差）。请调整分镜数量和单镜时长以满足此要求。',
    },
  };
  const lang = isEnglish(cfg) ? 'en' : 'zh';
  const t = templates[lang][key] || templates.zh[key];
  if (!t) return args[0] != null ? String(args[0]) : '';
  let i = 0;
  return t.replace(/%[sd]/g, () => (args[i] != null ? String(args[i++]) : ''));
}

/** 项目常用单镜时长档位（与前端「X秒/段」选项对齐） */
const STORYBOARD_DURATION_TIERS = [4, 5, 6, 8, 10, 12, 15];

/**
 * ArcReel 风格：未指定总分镜数时，由 AI 按情节自然拆分镜数与单镜时长。
 * @param {object} cfg
 * @param {{ clipDuration?: number|null }} opts
 */
function getStoryboardPlotDrivenInstructions(cfg, opts = {}) {
  const clip = opts.clipDuration != null && Number(opts.clipDuration) > 0 ? Math.round(Number(opts.clipDuration)) : null;
  const tiers = STORYBOARD_DURATION_TIERS.join(', ');
  const maxDur = STORYBOARD_DURATION_TIERS[STORYBOARD_DURATION_TIERS.length - 1];
  if (isEnglish(cfg)) {
    const durationBlock = clip
      ? `Pick each shot's "duration" from [${tiers}] seconds. Default preference: **${clip}s** when content fits; use longer tiers (up to ${maxDur}s) for dialogue-heavy, action, or emotional beats—do NOT default every shot to the shortest tier. If dialogue would take longer to speak than the chosen duration, raise duration to fit (rough guide: ~4 characters per second for Chinese dialogue).`
      : `Pick each shot's "duration" from [${tiers}] seconds based on content complexity (max ${maxDur}s). Dialogue-heavy shots need enough time to deliver lines; action/emotion beats may use longer tiers.`;
    return `

【PLOT-DRIVEN SHOT COUNT — HIGHEST PRIORITY WHEN NO TARGET COUNT IS SET (overrides "one action = one shot" rules above)】
- Cover the **entire script** in order; shot count follows plot, **NOT** char-count÷clip formula.
- **Split by scene first** (location/time change → new shot); merge continuous action in the same scene into one shot (use internal cuts in action).
- One shot = one completable visual beat (one dialogue exchange or one action chain). Do **NOT** split every short sentence or micro-gesture.
- Typical short episode: **8–25 shots**; only exceed **30** with strong plot justification.
- Opening hook ~2–4s; end on a visual hook when the script implies suspense.
- **duration**: ${durationBlock}`;
  }
  const durationBlock = clip
    ? `每镜 duration 从 [${tiers}] 秒档位中按画面内容选择：默认偏好 **${clip} 秒**（项目「每段秒数」），对白多/打斗/情绪铺陈可取更长档至 ${maxDur} 秒，禁止机械全部选最短档。若对白朗读时间超过所选时长，应提高 duration（中文对白粗估约每 4 字 1 秒）。`
    : `每镜 duration 从 [${tiers}] 秒档位中按画面复杂度选择（最长 ${maxDur} 秒）；对白多的镜头要给足朗读时间，动作/情绪镜头可用更长档。`;
  return `

【情节驱动分镜数——未指定目标镜数时最高优先级（参照 ArcReel 剧情分镜，覆盖上文「一动作一镜/禁止合并」类规则）】
- **必须覆盖剧本全部情节**，镜数由情节自然决定，**不由字数÷每段秒数公式推算**。
- **先按场景/场次拆分**（地点或时间明显切换 → 新镜头），同一场景内连续动作链 **合并为一镜**（action 内可用「镜头1…切镜到镜头2…」描述子画面）。
- 一镜 = 一个可完成的视觉节拍（一轮核心对白、或一段连续动作），**禁止**把每个短句、每个微小动作都拆成独立分镜。
- **禁止**为凑数量填充重复/空泛镜头；**禁止**把无关节拍硬合并成一镜。
- 一集短剧通常 **8–25 镜** 即可讲完；剧本较长（>2500字）可适当增加，但 **超过 30 镜需有充分情节依据**，不要机械细拆。
- 开篇钩子宜 2–4 秒节奏感；中段情绪转折可用更长单镜；剧本有悬念收束时末镜定格悬念画面。
- **duration**：${durationBlock}`;
}

/** 分镜用户提示词后缀：详细输出格式与要求
 * @param {object} cfg - 配置对象
 * @param {number|null} shotDuration - 单镜建议时长（秒）
 * @param {'fixed'|'preferred'|'auto'} [durationMode] - fixed=用户指定总时长+镜数；preferred=项目每段秒数为偏好；auto=纯按内容
 */
function getStoryboardUserPromptSuffix(cfg, shotDuration, durationMode = 'auto', opts = {}) {
  const includeNarration = !!opts.includeNarration;
  const fullNarration = !!opts.fullNarration;
  const narrFieldEn = includeNarration
    ? (fullNarration
      ? ', narration (REQUIRED: verbatim excerpt from user script, non-empty string)'
      : ', narration (REQUIRED: non-empty narrator VO string per shot)')
    : '';
  const narrFieldZh = includeNarration
    ? (fullNarration
      ? '、**narration（必填：剧本原文逐字连续摘录，非空字符串）**'
      : '、**narration（必填：每镜解说旁白原文，非空字符串）**')
    : '';
  const lang = isEnglish(cfg) ? 'en' : 'zh';
  const durationHint = shotDuration && Number.isFinite(Number(shotDuration)) && Number(shotDuration) > 0
    ? Number(shotDuration)
    : null;
  if (lang === 'en') {
    let durationInstruction = 'pick from supported tiers [4,5,6,8,10,12,15] based on dialogue length, action complexity, and emotion';
    if (durationMode === 'fixed' && durationHint) {
      durationInstruction = `approximately ${durationHint}s per shot (user total budget), adjust ±1s based on dialogue and action`;
    } else if (durationMode === 'preferred' && durationHint) {
      durationInstruction = `prefer ~${durationHint}s from tiers [4,5,6,8,10,12,15], override when dialogue/action needs longer`;
    }
    return `

**dialogue field**: "Character: \"line\"". Multiple: "A: \"...\" B: \"...\"". Monologue: "(Monologue) content". No dialogue: "".

**scene_id**: Select the most matching background ID from the scene list above, or null if none suitable.

**duration (seconds)**: ${durationInstruction}.

**Audio rule**: bgm_prompt MUST be an empty string or "No BGM". Do not design background music per shot. Put only diegetic ambience, foley, and voice/timbre details in sound_effect, so audio remains consistent across clips.

**Output**: JSON with "storyboards" array. Each item: shot_number, segment_index, segment_title, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters (array of IDs), props (array of prop IDs), is_primary${narrFieldEn}. Return ONLY valid JSON, no markdown.`;
  }
  const _sbUserLocked = `\n\n【输出格式】请以JSON格式输出，包含 "storyboards" 数组。每个镜头包含：shot_number, segment_index, segment_title, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters（角色ID数组）, props（道具ID数组）, is_primary, **layout_description（画面布局与人物站位描述，必填，最高优先级空间合同）**${narrFieldZh}。**必须只返回纯JSON，不要markdown。**`;
  const _sbUserOverride = _overrideCache['storyboard_user_suffix'];
  if (_sbUserOverride) {
    return '\n\n' + _sbUserOverride + _sbUserLocked;
  }
  let durationInstruction = '从档位 [4,5,6,8,10,12,15] 秒中按对话、动作、情绪选择';
  if (durationMode === 'fixed' && durationHint) {
    durationInstruction = `每镜头约${durationHint}秒（用户指定总时长规划），综合对话、动作可适当±1秒`;
  } else if (durationMode === 'preferred' && durationHint) {
    durationInstruction = `优先约${durationHint}秒（项目每段秒数偏好），对白/动作需要时可选用更长档`;
  }
  return `

【分镜要素】每个分镜聚焦一个叙事节拍（可包含内部多切镜序列），描述要详尽具体：
1. **镜头标题(title)**：用3-5个字概括该镜头的核心内容或情绪
2. **时间**：[清晨/午后/深夜/具体时分+详细光线描述]
3. **地点**：[场景完整描述+空间布局+环境细节]
4. **镜头设计**：**景别(shot_type)**、**镜头角度(angle)**、**运镜方式(movement)**
5. **人物行为**：**详细动作描述**
6. **对话/独白**：提取该镜头中的完整对话或独白内容（如无对话则为空字符串）
${includeNarration ? (fullNarration ? '6b. **解说旁白 narration（必填）**：必须是上方剧本正文的**逐字连续摘录**，禁止改写；画外解说写在 narration，不要写进 dialogue 或 sound_effect' : '6b. **解说旁白 narration（必填）**：画外第三人称解说，与 dialogue 严格区分；禁止留空') : ''}
7. **画面结果**：动作的即时后果+视觉细节+氛围变化
8. **环境氛围**：光线质感+色调+声音环境+整体氛围
9. **声音设计**：bgm_prompt 必须填空字符串""或"无背景音乐/禁BGM"；**不要为单个片段设计背景音乐**。sound_effect 只写现场环境声、动作音效、对白/旁白音色（如低沉、沙哑、颤抖、冷静、急促等）和口型同步要求
10. **观众情绪**：[情绪类型]（[强度：↑↑↑/↑↑/↑/→/↓]）

**【最高优先级空间合同 - layout_description（必填，最高优先级铁律）】**
这是本分镜的**核心空间锚点 + 真实物体尺度 + 运镜呼吸空间**铁律，用于首帧/尾帧图片生成时在保持一致性的同时，为运镜留出必要空间（尤其是 Seedance 1.5 Pro 等依赖首尾帧的模型）：

- 必须明确写出**主要角色在画面中的核心站位**（画面左/中/右三分、朝向、与关键道具的基本空间关系）。这是硬性锁定。
- **必须同时写出所有主要道具的真实物理尺度与相对比例**（仅描述本分镜/剧本中实际出现的道具，尺度须符合其所属时代与场景；例如古代场景写案几高度、书卷尺寸、铜器体量等，现代场景写对应家具与小物件真实尺寸；所有道具均为次要环境元素）。严禁任何会导致AI把道具做大、立起或当成主导元素的描述；**严禁写入与时代背景不符的道具**（古代/古装分镜不得出现智能手机、遥控器、现代茶几等现代物品）。
- 必须写明**整体构图方式和基本机位距离感**（中景、三分法等）。
- **必须为 declared movement（运镜方式）预留电影化演化空间**：明确说明首尾帧在核心站位和真实尺度保持一致的前提下，允许根据 movement 进行自然的取景微调（例如：缓推时尾帧可比首帧稍紧；手持时允许轻微取景晃动与不完美平衡；横摇/跟拍时允许画面左右自然的进入/退出变化）。目标是让首尾帧既像“同一场同一空间的连续镜头”，又能真正支持运镜产生动态视频，而不是变成几乎定格的画面。
- **严禁写入会导致比例失真或完全锁死运镜的表述**（即使剧本里有相关描述也禁止）："道具作为视觉焦点/占画面主导"、"手持晃动带来纪实感"、"完全相同的构图平衡"等。
- 好示例（古代场景，带运镜空间）："主角坐画面左中榻上，是绝对视觉焦点；右下前景木质案几高约75cm，书卷平放于案面为正常尺寸，铜灯与茶具均为次要环境小物件，绝不可夸大；中景，三分法构图，核心平衡稳定。若 movement 为缓推，尾帧允许人物在画面中占比自然增加、背景稍被压缩；若为手持，允许轻微取景不完美偏移。"
- **执行原则**：首帧按此锚点生成初始画面；尾帧必须保持核心站位、角色与道具的真实尺度与基本空间关系，仅根据 movement 和 result 进行自然的取景演化。违背核心锁定 = 失败；完全没有运镜演化空间也属于不合格结果。

**dialogue字段说明**：角色名："台词内容"。无对话时填空字符串""。
**scene_id**：从上方场景列表中选择最匹配的背景ID，如无合适背景则填null。
**duration时长**：${durationInstruction}。
**声音一致性**：所有镜头默认无BGM；若有对白/旁白，sound_effect 必须补充音色与情绪强度，并与动作节奏、环境声保持一致。

【输出格式】请以JSON格式输出，包含 "storyboards" 数组。每个镜头包含：shot_number, segment_index, segment_title, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters（角色ID数组）, props（道具ID数组）, is_primary${narrFieldZh}。**必须只返回纯JSON，不要markdown。**`;
}

/**
 * 真实物理尺度铁律 — 时代/场景自适应，专治布局描述冲突与跨时代道具幻觉
 */
function getRealisticPhysicalScaleContract(isEn) {
  if (isEn) {
    return `【HIGHEST PRIORITY REALISTIC PHYSICAL SCALE & PROPORTION CONTRACT — ERA-AWARE, ABSOLUTE OVERRIDE】
Every visible object in the scene MUST be rendered at 100% correct real-world physical dimensions for its era/setting, with correct relative proportions and accurate photographic perspective. This rule has HIGHER PRIORITY than any conflicting instruction in the layout_description / spatial anchor above.
CRITICAL RULES:
- **Era fidelity (MANDATORY)**: Props MUST match the story's time period and location. In ancient/historical/costume drama scenes, NEVER include smartphones, remote controls, modern coffee tables, A4 books, or any anachronistic modern items. Only describe props that actually belong in this shot according to the script and scene context.
- **Scale only for props actually present**: For each major prop visible in the frame, state realistic size relative to the human figure and environment (e.g. ancient: writing desk ~70–85 cm, scroll ~25–35 cm; modern: side table ~38–52 cm, small handheld device lying flat at true size). Never invent props not in the shot.
- **Secondary props**: The human character is the ONLY primary visual subject. All props are strictly secondary environmental elements — never oversized, never upright as dominant elements, never breaking perspective.
- If layout_description contains scale-distorting phrases, IGNORE those implications and follow era-appropriate realistic scale and "secondary prop" rules above.
This contract applies to BOTH first frame and last frame with zero exception.
Violation (anachronistic props, oversized objects, broken perspective, props as dominant elements) = critical generation failure.`;
  }
  return `【最高优先级真实物理尺度与道具比例铁律 — 时代自适应，绝对覆盖，违反即严重失败】
本分镜内所有可见物体必须100%遵循其所属时代/场景的真实世界物理尺寸、正确相对比例和电影摄影透视法则。本铁律的优先级绝对高于上方布局描述中任何可能导致比例失真的表述。
【关键规则（即使布局描述写得有问题也必须遵守）】
- **时代一致性（强制）**：道具必须严格符合剧本设定的时代背景。古代/古装/架空历史场景中**严禁**出现智能手机、遥控器、现代茶几、A4书籍、平板等任何现代物品；只描述本分镜中实际存在且符合时代的道具。
- **仅描述画面内实际道具的尺度**：对每个主要道具写出相对人体与环境的合理真实尺寸（例如古代：案几高约70-85cm、书卷长约25-35cm、铜镜直径约15-20cm；现代：边桌高约38-52cm等），不得凭空添加剧本未出现的道具。
- **次要环境元素**：角色是画面中唯一的首要视觉主体和焦点；所有道具均为严格次要的小型环境元素，不得夸大、立起成为主导视觉、或破坏透视。
- 若布局描述中有会导致不真实尺度的表述，必须忽略其对物体尺寸和透视的影响，只严格执行本铁律中符合时代的真实尺度与「次要道具」要求。
本铁律同时适用于首帧和尾帧生成，零例外。
任何生成结果出现时代错乱道具、物体过大失真、透视错误、道具成为主导元素，均视为严重失败。`;
}

function getFirstFramePrompt(cfg) {
  const style = isEnglish(cfg) ? styleTextEnForImage(cfg) : styleTextZhForPolish(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional cinematic storyboard image prompt expert. Generate AI image generation prompts based on the shot information provided.

Important: This is the FIRST FRAME - a completely static image showing the initial state BEFORE the action begins.

Core Rules:
1. Static initial state only - the moment before any action
2. NO movement or action descriptions
3. Describe character's initial posture, screen position (left/center/right), and expression
4. ONLY characters listed in "ALLOWED CHARACTERS IN THIS SHOT" may appear — never add unlisted characters
5. For each allowed character write ONLY "Name (use appearance from reference image)" plus position/posture/expression/props — NEVER put hair, face, skin, makeup, or temperament inside parentheses or anywhere else. Scene/environment lines must contain ZERO human appearance descriptions
6. Include character appearance details if provided (ONLY fixed identity anchors from the provided CHARACTER VISUAL ANCHORS block. Copy exactly the traits listed there. NEVER hallucinate new hair style/color/length, face shape, expression details, or temperament not explicitly present in the anchor. If no detailed anchor is provided for a character, write only "Name (use appearance from reference image)" and add ZERO invented visual details)

Cinematic Language (must apply):
- COMPOSITION: Choose based on shot type: Rule of Thirds (subject at grid intersections), Frame Composition (use doors/windows/branches as natural frame), Center Composition (symmetrical, ceremonial), Foreground Layering (blurred foreground for depth)
- LIGHTING: Specify light source direction (left/right/top/backlight/bottom), quality (hard light=dramatic shadows / soft light=natural warmth), color temperature (warm=golden/orange, cool=blue/cyan)
- DEPTH OF FIELD: Close-up/medium-close=shallow DOF, background blur; Medium shot=medium DOF; Long shot/wide=deep DOF, full scene clarity
- CHARACTER POSITION: Describe placement in frame, facing direction (toward/away from camera/profile), body language
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}
Output Format:
Return a JSON object containing:
- prompt: Complete image generation prompt (detailed cinematic description)
- description: Simplified Chinese description (for reference)`;
  }
  const _ffLocked = `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n输出格式：\n返回一个JSON对象，包含：\n- prompt：完整的中文图片生成提示词（详细的电影语言描述）\n- description：简化的中文描述（供参考）`;
  const _ffOverride = _overrideCache['first_frame_prompt'];
  if (_ffOverride) {
    return _ffOverride + _ffLocked;
  }
  const ffScaleContract = getRealisticPhysicalScaleContract(false);
  return `你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。

重要：这是镜头的首帧 - 一个完全静态的画面，展示动作发生之前的初始状态。

${ffScaleContract}

核心规则：
1. 聚焦初始静态状态 - 动作发生之前的那一瞬间，禁止包含任何动作或运动描述
2. 描述角色在画面中的位置（画面左/中/右）、朝向（面向/背对/侧面）、初始姿态和表情
3. 【出场角色铁律】仅允许 CONTEXT 中「本分镜允许出场的角色」名单内的人物出现；名单外角色严禁写入 prompt（不得出现其名字、站位、动作、表情）
4. 【角色外貌写法铁律 - 违反即失败】每个允许出场的角色在 prompt 中**只能**写为「**真实角色名**（参考图中的人物形象）」+ 画面位置 + 姿态 + 表情 + 手持道具；**严禁**「角色A/B」「参照角色A」等匿名占位。括号内及前后**严禁**写发型、发色、发长、五官、面容、眉眼、轮廓、肤质、妆容、气质等任何外貌词。**禁止**把锚点/appearance 里的外貌特征抄进 prompt（图生图由参考图锁定外貌）
5. 【场景描写铁律】「场景为…」「环境…」等空间/环境句**严禁**出现任何人物外貌描写，只写空间、道具、光线、氛围
6. 如 CONTEXT 提供了角色视觉锚点，仅供理解身份，**不得**将锚点内容写入 prompt 正文

【电影语言规范（必须应用）】

构图规则（根据景别选择）：
- 三分法：主体置于三分线交点，稳定平衡，适合大多数叙事镜头
- 框架构图：用门窗/树枝/栏杆形成自然画框，突出主体，增加纵深
- 中心构图：对称庄重，适合特写和仪式感场景
- 前景遮挡：前景虚化元素增加层次感

光线设计（必须描述）：
- 光源方向：左侧光/右侧光/顶光/逆光（轮廓光）/底光
- 光线质感：硬光（强烈阴影，戏剧张力）/ 柔光（柔和过渡，自然温馨）
- 色温：暖光（金黄/橙红，温暖怀旧）/ 冷光（蓝调/青白，冷漠疏离）

景深设置：
- 特写/近景：浅景深，背景虚化，突出人物情绪
- 中景：中等景深，人物与环境均清晰
- 远景/全景：深景深，前后均清晰，交代空间关系
- **风格要求**：${style}
- **图片比例**：${imageRatio}

【5层结构输出格式 + 尺度强制要求】
返回JSON对象，prompt 字段按以下5层顺序拼接成**中文**，各层间用中文逗号「，」分隔（不加「第1层」等层标签文字）。**在第3层“内容焦点”中必须包含一段符合时代背景的真实物体尺度描述**（仅写本分镜实际出现的道具；古代场景示例：“所有道具严格符合古代真实物理比例，案几高约75cm，书卷为正常尺寸平放于案面，铜灯与茶具均为次要环境小物件，绝不可夸大，主角为绝对视觉焦点”）。
第1层-镜头设计：景别 + 机位角度 + 构图方式（如「中景，平视角度，三分法构图」）
第2层-光线：光源方向 + 光线质感 + 色温（如「左侧柔暖光，黄金时刻暖调」）
第3层-内容焦点：角色（仅「名字（参考图中的人物形象）」+初始姿态+表情，不写外貌）+ 场景环境关键细节（不含人物外貌） + **必须包含真实物体尺度描述（见上方强制要求）**
第4层-氛围：情绪基调 + 色彩倾向（如「安静紧张氛围，低饱和冷色调」）
第5层-视觉风格：${style ? style + '，' : ''}电影分镜质感，${imageRatio} 画幅，高清细节，所有物体严格真实尺度

JSON字段：
- prompt：**必须全文中文**的图片生成提示词（直接给图片AI使用；禁止整句英文，仅允许必要风格专有名如 realistic 等单个词；必须自然融入符合时代的真实尺度描述，严禁时代错乱道具或物体过大失真）
- description：一句话中文描述（供人类参考）`;
}

function getKeyFramePrompt(cfg) {
  const style = isEnglish(cfg) ? styleTextEnForImage(cfg) : styleTextZhForPolish(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional cinematic storyboard image prompt expert. Generate AI image generation prompts based on the shot information provided.

Important: This is the KEY FRAME - capturing the most intense and climactic moment of the action.

Core Rules:
1. Focus on the peak moment of the action - maximum dramatic tension
2. Capture the emotional climax - character's most expressive state
3. Can include dynamic effects (motion blur, impact lines, visual tension)
4. Include character appearance details if provided (ONLY fixed identity anchors from the provided CHARACTER VISUAL ANCHORS block. Copy exactly the traits listed there. NEVER hallucinate new hair style/color/length, face shape, expression details, or temperament not explicitly present in the anchor. If no detailed anchor is provided for a character, write only "Name (use appearance from reference image)" and add ZERO invented visual details)
5. Show character's body language and expression at climax

Cinematic Language (must apply):
- COMPOSITION: For action/climax - diagonal composition (dynamic tension, leads viewer's eye), Dutch angle (unease/intensity for conflict scenes), over-shoulder (confrontation/dialogue tension)
- LIGHTING: Dramatic lighting for peak moments - rim light separating subject from background, strong chiaroscuro (light/shadow contrast), or explosive bright key light for revelations
- DEPTH OF FIELD: Usually shallow to isolate the critical action; deep for wide action involving environment
- EMOTIONAL COLOR: Warm saturated (passion/anger), cool desaturated (shock/loss), high contrast (climax/confrontation)
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}
Output Format:
Return a JSON object containing:
- prompt: Complete image generation prompt (detailed cinematic description)
- description: Simplified Chinese description (for reference)`;
  }
  const _kfLocked = `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n输出格式：\n返回一个JSON对象，包含：\n- prompt：完整的中文图片生成提示词（详细的电影语言描述）\n- description：简化的中文描述（供参考）`;
  const _kfOverride = _overrideCache['key_frame_prompt'];
  if (_kfOverride) {
    return _kfOverride + _kfLocked;
  }
  return `你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。

重要：这是镜头的关键帧 - 捕捉动作最激烈、情绪最饱满的高潮瞬间。

核心规则：
1. 聚焦动作高潮时刻，最大化戏剧张力
2. 捕捉情绪顶点，角色表情和肢体语言处于最强烈状态
3. 可包含动态效果（动作模糊、视觉冲击感）
4. 【出场角色铁律】仅允许「本分镜允许出场的角色」名单内人物；名单外角色严禁出现
5. 【角色外貌写法铁律】每个角色只写「名字（参考图中的人物形象）」+ 姿态 + 表情，严禁外貌描写；锚点内容不得写入 prompt
6. 【场景描写铁律】环境/场景句严禁人物外貌描写
7. 展示角色高潮状态下的肢体姿态和神情

【电影语言规范（必须应用）】

构图规则（高潮/动作场景）：
- 对角线构图：强烈动态感，视觉引导，适合冲突/行动镜头
- 荷兰角/斜角：不安感和紧张感，适合对峙/心理冲击场景
- 过肩镜头：适合对话高潮、面对面对峙

光线设计（高潮时刻）：
- 轮廓光：将主体从背景中分离，突出人物
- 强烈明暗对比（硬光）：戏剧张力，冲突感
- 爆发性亮光：适合揭示真相、情绪爆发时刻
- 色温情绪化：暖色饱和（激情/愤怒）/ 冷色低饱和（震惊/失落）

景深与色调：
- 通常使用浅景深聚焦关键动作，隔离背景
- 高对比度色调强化高潮感
- **风格要求**：${style}
- **图片比例**：${imageRatio}

【5层结构输出格式 + 尺度强制要求】
返回JSON对象，prompt 字段按以下5层顺序拼接成**中文**，各层间用中文逗号「，」分隔（不加层标签文字）。**在第3层“内容焦点”中必须包含一段符合时代背景的真实物体尺度描述**（仅写本分镜实际出现的道具，严禁写入与时代不符的现代物品）。
第1层-镜头设计：景别 + 机位角度 + 构图方式（如「特写，低角度，对角线构图」）
第2层-光线：光源方向 + 光线质感 + 色温（如「轮廓光，强明暗对比，暖色饱和」）
第3层-内容焦点：角色（仅「名字（参考图中的人物形象）」+高潮姿态+情绪表情）+ 场景关键细节（不含外貌） + **必须包含真实物体尺度描述**
第4层-氛围：情绪基调 + 色彩倾向（如「激烈对峙，高对比，鲜艳饱和色调」）
第5层-视觉风格：${style ? style + '，' : ''}电影分镜质感，${imageRatio} 画幅，动态张力，所有物体严格真实尺度

JSON字段：
- prompt：**必须全文中文**的图片生成提示词（直接给图片AI使用；禁止整句英文；必须自然融入真实尺度描述）
- description：一句话中文描述（供人类参考）`;
}

function getLastFramePrompt(cfg) {
  const style = isEnglish(cfg) ? styleTextEnForImage(cfg) : styleTextZhForPolish(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional cinematic storyboard image prompt expert. Generate AI image generation prompts based on the shot information provided.

Important: This is the LAST FRAME - a static image showing the final state AFTER the action ends.

Core Rules:
1. Focus on the final resting state after action completion
2. Show the visible result/consequence of the action
3. Describe character's final posture, position, and emotional expression
4. Emphasize the emotional aftermath - relief, tension, sadness, triumph
5. ONLY characters in "ALLOWED CHARACTERS IN THIS SHOT" may appear; write each as "Name (use appearance from reference image)" plus position/posture/expression only — no hair/face/skin in scene or character lines
6. Include character appearance details if provided (ONLY fixed identity anchors from the provided CHARACTER VISUAL ANCHORS block. Copy exactly the traits listed there. NEVER hallucinate new hair style/color/length, face shape, expression details, or temperament not explicitly present in the anchor. If no detailed anchor is provided for a character, write only "Name (use appearance from reference image)" and add ZERO invented visual details)
7. **CORE POSITION + SCALE LOCK + MOVEMENT EVOLUTION (for 5-15s videos)**: 
- Must keep core character screen placement (left/center/right third, facing), realistic physical sizes of all props, and basic spatial relationships consistent with the first frame / layout contract (no left-right swaps, no major repositioning of key elements, no scale distortion).
- However, for 5-15 second clips, the last frame MUST show meaningful cinematic evolution driven by the declared camera_movement + the RESULT:
  - Slow push-in → noticeably tighter framing on the character (higher screen occupancy).
  - Handheld / tracking → natural slight framing drift and imperfect composition.
  - Pan / orbit → natural entry/exit changes or minor camera drift on sides.
- Goal: First and last frames must feel like the same continuous physical scene, but with enough visual progression that the generated video actually realizes the declared movement instead of looking nearly static. Zero movement evolution = undesirable result.

Cinematic Language (must apply):
- COMPOSITION: For 5-15s videos, the last frame must balance "same physical space" consistency with visible evolution from the declared movement. Keep core placement and realistic prop scales, but allow framing changes that naturally result from the camera movement (tighter on push-in, natural drift on handheld, side shifts on pan). The goal is meaningful visual progression, not near-identical framing that kills motion.
- LIGHTING: Reflect emotional aftermath - soft warm light (resolution/comfort), lingering dramatic shadows (unresolved tension), fading light (loss/ending)
- DEPTH OF FIELD: Match the emotional tone - shallow for intimate emotional close, deep for consequential wide shots showing impact on environment
- CHARACTER POSITION: Show the final state after the full action + movement. Character's ending posture/expression per RESULT, with framing that reflects the cumulative effect of the declared camera_movement over the clip duration (more significant evolution allowed for 5-15s videos), while strictly keeping core placement, realistic prop scales, and no major spatial violations of the layout contract.
- ATMOSPHERE: Describe color tone and mood that carries the emotional weight of the scene's conclusion
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}
Output Format:
Return a JSON object containing:
- prompt: Complete image generation prompt (detailed cinematic description). For 5-15s videos, the prompt must describe visible framing evolution caused by the declared camera_movement (e.g. tighter framing after push-in, natural drift on handheld) while keeping core positions and realistic prop scales.
- description: Simplified Chinese description (for reference)`;
  }
  const _lfLocked = `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n输出格式：\n返回一个JSON对象，包含：\n- prompt：完整的中文图片生成提示词（详细的电影语言描述）\n- description：简化的中文描述（供参考）`;
  const _lfOverride = _overrideCache['last_frame_prompt'];
  if (_lfOverride) {
    return _lfOverride + _lfLocked;
  }
  const lfScaleContract = getRealisticPhysicalScaleContract(false);
  return `你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。

重要：这是镜头的尾帧 - 一个静态画面，展示动作结束后的最终状态和结果。

【最高优先级真实物理尺度与道具比例铁律 + 运镜演化（5-15秒视频）】（详见本分镜“空间布局锚点”中的完整铁律）
本分镜内所有可见物体必须100%遵循其所属时代/场景的真实世界物理尺寸、正确相对比例和电影摄影透视法则；仅描述实际出现的道具，严禁时代错乱物品。所有道具均为次要环境元素。
尾帧允许根据 movement 进行取景演化（例如缓推后人物占比明显增加、手持后自然漂移），但严禁改变任何物体的真实物理尺寸、相对比例或破坏透视。尺度失真 = 失败；完全没有运镜演化 = 同样不理想。

核心规则：
1. 聚焦动作完成后的最终静态状态
2. 展示动作的可见结果和后果
3. 描述角色在动作完成后的最终姿态、位置和情绪表情
4. 强调情绪余韵：释然/平静/悲伤/胜利/遗憾
5. 【出场角色铁律】仅允许「本分镜允许出场的角色」名单内人物；名单外角色严禁出现
6. 【角色外貌写法铁律】每个角色只写「名字（参考图中的人物形象）」+ 最终姿态 + 表情，严禁外貌描写；锚点不得写入 prompt
7. 【场景描写铁律】环境/场景句严禁人物外貌描写
8. 【人物站位与运镜演化铁律（5-15秒视频专用）】如果提供了首帧参考图或首帧构图描述（包括空间布局锚点），**必须保持核心站位、真实物理尺度、基本空间关系与透视一致**（主要角色不左右互换、主要道具不大幅移位、所有物体真实尺寸不变）。但**必须根据本分镜的 movement（运镜方式）和视频时长（通常5-15秒）进行有意义的取景演化**：
   - 例如：缓推（slow push-in）时，尾帧人物在画面中的占比应明显比首帧更大、背景更被压缩；
   - 手持跟拍时，允许自然的取景轻微晃动与不完美偏移；
   - 横摇/环绕时，画面可有自然的左右进入/退出变化或轻微机位漂移。
   目标是让尾帧体现运镜的累积视觉结果 + result 描述的最终状态，而非与首帧几乎一模一样。完全没有运镜演化空间属于不合格。

【电影语言规范（必须应用）】

构图规则（收尾镜头，5-15秒视频）：
- 收尾镜头必须在核心站位、真实物体尺度、基本空间关系上与首帧保持一致（硬锁）。
- 但**必须体现 declared movement 的累积视觉效果**：例如缓推后尾帧应比首帧更紧（人物占比明显增加）、手持跟拍后允许自然取景漂移、横摇后画面可有轻微左右偏移。
- 目标是让首尾帧之间有足够但合理的视觉差异，使基于它们的视频能真正“动”起来，而不是几乎定格。
- 严禁大幅移动主要角色或道具位置、破坏真实尺度或透视。

光线设计（情绪余韵）：
- 柔和暖光：事件解决后的温情/宽慰
- 残留戏剧阴影：未解决的张力，悬念延续
- 渐弱光线/冷调：失去/结束/遗憾的情绪
- 色调整体偏暗或偏亮反映情绪归宿

景深与氛围：
- 情绪收场：浅景深，聚焦面部情绪细节
- 结果展示：深景深，展示行动对环境/他人的影响
- 整体色调和氛围承载本镜头情绪的收尾重量
- **风格要求**：${style}
- **图片比例**：${imageRatio}

【5层结构输出格式 + 尺度 + 运镜演化强制要求（5-15秒视频）】
返回JSON对象，prompt 字段按以下5层顺序拼接成**中文**，各层间用中文逗号「，」分隔（不加层标签文字）。
- **第3层“内容焦点”必须同时包含**：真实物体尺度描述 + 根据本分镜 movement 和时长（5-15秒）进行的取景演化描述（例如“缓推后人物画面占比明显增加”、“手持跟拍后取景有自然轻微漂移”等）。
第1层-镜头设计：景别 + 机位角度 + 构图方式（需体现尾帧相对于首帧的自然演化）
第2层-光线：光源方向 + 光线质感 + 色温
第3层-内容焦点：角色（仅「名字（参考图中的人物形象）」+最终姿态+情绪余韵）+ 场景最终状态（不含外貌） + 真实尺度 + **运镜累积演化描述**（必须写，5-15秒视频需有明显但合理的视觉差异）
第4层-氛围：情绪基调 + 色彩倾向
第5层-视觉风格：${style ? style + '，' : ''}电影分镜质感，${imageRatio} 画幅，所有物体严格真实尺度，运镜自然演化

JSON字段：
- prompt：**必须全文中文**的图片生成提示词（直接给图片AI使用；禁止整句英文；必须自然融入符合时代的真实尺度 + 根据 movement 的取景演化描述，5-15秒视频尾帧需体现运镜累积效果，严禁时代错乱道具或物体过大失真）
- description：一句话中文描述（供人类参考）`;
}

/** 道具提取系统提示词（system prompt，剧本内容由 user prompt 单独传入） */
function getPropExtractionPrompt(cfg) {
  const base = styleTextForCfgLang(cfg);
  const propExtra = (cfg?.style?.default_prop_style || '').toString().trim();
  const style = [base, propExtra].filter(Boolean).join(', ');
  const imageRatio = cfg?.style?.default_prop_ratio || cfg?.style?.default_image_ratio || '16:9';
  if (isEnglish(cfg)) {
    return `You are a professional script prop analyst, skilled at extracting visually actionable props from scripts.

Your task is to extract and organize **all clearly mentioned props** that characters use, hold, look at, or that appear as important on-screen objects in the provided script.

[Requirements]
1. **Be comprehensive for explicit props**: extract every tangible object the script clearly names when it is used, searched on, held, opened, read, shown, or drives a beat (e.g. computer, phone, tablet, keys, letters, notes, photos, albums, weapons, boxes, jewelry, documents, maps).
2. **Must extract information/query devices**: if the script says someone borrows/uses a computer, phone, tablet, or map app to search or navigate, that device **must** be a separate prop (do not skip as "daily item").
3. Still skip pure ambient furniture that is only set dressing with no beat (generic chairs, walls) — those belong to the scene, not props. But if an item is named and acted on (e.g. "a pen on the desk", "a note on the door"), extract it.
4. Prefer **one prop per distinct object**; do not merge computer and phone into a vague "digital carrier".
5. If a prop has a clear owner, note it **only** in "description". **Never** put character names, nicknames, or relationship words in "image_prompt".
6. "image_prompt" must be **English**, written as a **professional catalog / product-hero** shot for a single prop: describe shape, material, color, wear, scale cues, and finish in detail.
7. In "image_prompt" you **must** specify: **one seamless solid-color studio backdrop** (matte, no gradient), **only the prop as the sole subject**, **soft even studio lighting** (readable micro-detail, no dramatic movie lighting), and explicitly forbid people, hands, furniture, floors, tables, scenery, packaging (unless the prop *is* the package), text, logos, dust/debris, or any secondary objects.
8. **No script leakage in "image_prompt"**: forbid character names, place names, organization names, dialogue, plot beats, and other **original-script identifiers**. Replace with generic visual terms. The **only** exception is text that is **visibly printed or engraved on the prop itself**.
9. **Strict, non-expanding "image_prompt"**: include **only** attributes grounded in the script or the "description" you output—**no** invented accessories or filler. Prefer a **tight** prompt over a long one.
- **Style Requirement**: ${style}
- **Image Ratio**: ${imageRatio}

[Output Format]
**CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code blocks, explanations, or other text. Start directly with [ and end with ].**
Each object containing:
- name: Prop Name
- type: Type (e.g., Weapon/Key Item/Daily Item/Special Device)
- description: Role in the drama and visual description
- image_prompt: English hero product shot prompt (single prop, solid seamless backdrop, no clutter, no environment, soft studio light, tight wording, no names/places from script, ultra-detailed only where visually grounded)`;
  }
  const _propLocked = `\n- **风格要求**：${style}\n- **图片比例**：${imageRatio}\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个对象包含：\n- name: 道具名称\n- type: 类型 (如：武器/关键证物/日常用品/特殊装置)\n- description: 在剧中的作用和中文外观描述（人名、归属可写在此字段，勿写入 image_prompt）\n- image_prompt: 单道具主图提示词（纯色无缝背景、仅主体、无杂物无场景、柔和棚拍光；**禁止**剧本人名/地名/组织名/台词/剧情标签；只写有依据的外观词，**不脑补、不扩写**；中文项目输出中文提示词并匹配项目「语音」与尺度铁律）`;
  const _propOverride = _overrideCache['prop_extraction'];
  if (_propOverride) {
    return _propOverride + _propLocked;
  }
  return `你是一位专业的剧本道具分析师，擅长从剧本中提取角色会使用、持有、查看或作为重要出镜物体的道具。

你的任务是根据提供的剧本内容，**全面提取剧本中明确提到、且会进入画面或推动情节的可见道具**。

要求：
1. **明显提到的道具都要提取**：凡剧本点名、且被使用/持有/打开/阅读/搜索/展示/推动情节的实物，均应提取（如电脑、手机、平板、钥匙、信件、纸条、照片、相册、武器、盒子、首饰、文件、地图等）。
2. **查询/通讯设备强制提取**：若剧本写借电脑、用手机、看平板、用地图软件查询或导航等，该设备**必须**单独成条道具，不得当作「普通日用品」跳过。
3. 仍可跳过纯布景家具（仅当背景、无人互动的椅子/墙面等，应归场景而非道具）；但只要被点名并发生互动（如「桌上的钢笔」「门上的纸条」），就必须提取。
4. **一物一条**：不同物体分开提取；禁止把电脑与手机合并成含糊的「数字信息载体」。
5. 若道具有明确归属者，**仅**写在 "description" 中（可用中文人名）；**禁止**在 "image_prompt" 中出现任何角色名、昵称、称谓或人际关系用语。
6. **description 字段强制纯中文**：必须输出**纯中文、80-150字**的详细视觉外观描述 + 该道具在剧中的核心作用/归属/剧情功能。必须严格遵循本项目一贯的中文影视提示词「语音」：融入符合道具所属时代的真实物理尺度意识、材质工艺细节、磨损痕迹、柔和棚拍光质感、电影化构图暗示。严禁任何英文单词/句子，严禁只写剧情不写可用于画图的外观细节，严禁空泛或翻译腔。
7. "image_prompt" 按项目语言撰写（**中文项目必须输出纯中文提示词**、英文项目用英文），按**影视资产库 / 电商主图级**单道具产品照标准：写清轮廓、材质、颜色、磨损与工艺细节、体量感。必须完整匹配项目中文影视提示词「语音」（融入真实尺度铁律、次要道具原则、电影化细节、纯色无缝背景、柔和均匀棚光）。
8. "image_prompt" 中**必须**写明：**单一无缝纯色棚拍背景**（哑光、无渐变）、**画面中仅有该道具一个主体**、**柔和均匀的棚拍光**（便于看清细节，避免电影化强反差光），并**明确禁止**：人物、手、家具、地面/台面、室内外环境、散落杂物、其他道具、文字商标、包装（除非该道具本身就是包装）、烟尘粒子等任何多余元素。
9. **image_prompt 禁止泄漏剧本特征**：不得出现剧本人名、地名、组织名、台词、情节梗专有称呼等；一律改写为**泛化视觉描述**。**唯一例外**：文字**实体印/刻在道具表面**且剧本明确要求还原该字样时，可保留该可见字样；否则用泛化描述。
10. **image_prompt 严格不扩展**：只写剧本与你在本对象 "description" 中已交代、且**肉眼可见**的外观信息；禁止凭空增加配饰、品牌故事、时代煽情形容词、叙事性铺垫；宁可**短而准**，不要为凑字数扩写。必须自然融入「符合时代的真实物理比例」等项目铁律。
- **风格要求**：${style}
- **图片比例**：${imageRatio}

【输出格式】
**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**
每个对象包含：
- name: 道具名称
- type: 类型 (如：武器/关键证物/日常用品/特殊装置)
- description: **纯中文**的在剧中的作用 + 详细视觉外观描述（必须80-150字，严格遵循项目中文提示词语音：真实尺度、次要元素、电影化细节等）
- image_prompt: **纯中文**（中文项目）单道具主图提示词（纯色无缝背景、仅主体、无杂物无场景、柔和棚拍光；融入项目真实尺度铁律与次要道具语音；无剧本人名地名等；只写有依据的外观词，简练不扩写）`;
}

function getSceneExtractionPrompt(cfg, style, existingLocations) {
  const styleText = (style || '').toString().trim();
  const s = styleText || styleTextForCfgLang(cfg);
  const imageRatio = cfg?.style?.default_image_ratio || '16:9';
  const existingList = Array.isArray(existingLocations)
    ? existingLocations.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const existingBlockEn = existingList.length
    ? `\n7. **Reuse existing drama locations (CRITICAL for visual consistency)**: The drama already has these scene names:\n${existingList.map((n) => `   - ${n}`).join('\n')}\n   When the script refers to the **same place** (e.g. "apartment" vs "apartment bedroom"), output the **exact existing location string** above. Do NOT invent a near-duplicate name.`
    : '';
  const existingBlockZh = existingList.length
    ? `\n7. **复用本剧已有地点名（画面一致性铁律）**：本剧已有以下场景名称：\n${existingList.map((n) => `   - ${n}`).join('\n')}\n   若剧本描述的是**同一处空间**（例如「公寓」与「公寓卧室」），location **必须原样使用上方已有名称**，禁止另造近义短名/长名导致拆成两个场景资产。`
    : '';
  if (isEnglish(cfg)) {
    return `[Task] Extract all unique scene backgrounds from the script

[Requirements]
1. **Be comprehensive**: identify **every clearly mentioned distinct location** in the script (location + time), including transitional places (library, clinic, street, alley, factory, apartment, cafe, etc.). Do not skip a place just because it is brief.
2. Split when the location clearly changes (e.g. library interior vs clinic interior vs abandoned factory vs outdoor street are separate scenes).
3. Generate detailed **English** image generation prompts for each scene
4. **Important**: Scene descriptions must be **pure backgrounds** without any characters, people, or actions
5. Prompt requirements:
   - Must use **English**, no Chinese characters
   - Detailed description of scene, time, atmosphere, style
   - Must explicitly specify "no people, no characters, empty scene"
   - **Style Requirement**: ${s}
   - **Image Ratio**: ${imageRatio}
${existingBlockEn}

[Output Format]
**CRITICAL: Return ONLY a valid JSON array. Do NOT include any markdown code blocks. Start directly with [ and end with ].**
Each element: location, time, prompt (English image generation prompt for pure background).`;
  }
  const _sceneLocked = `\n5. **风格要求**：${s}\n   - **图片比例**：${imageRatio}\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块。直接以 [ 开头，以 ] 结尾。**\n每个元素包含：location（地点）, time（时间）, prompt（完整的中文图片生成提示词，纯背景，明确说明无人物）。`;
  const _sceneOverride = _overrideCache['scene_extraction'];
  if (_sceneOverride) {
    return _sceneOverride + _sceneLocked + (existingBlockZh ? `\n${existingBlockZh}` : '');
  }
  return `【任务】从剧本中提取所有唯一的场景背景

【要求】
1. **全面提取**：识别剧本中**所有明确提到的不同地点**（地点+时间组合），包括过渡性场所（图书馆、诊所、街道、小巷、工厂、公寓、咖啡馆等），不得因戏份短就漏提。
2. 地点明显切换时必须拆分（如图书馆内景、诊所内景、废弃工厂、室外街道应分为不同场景）。
3. 为每个场景生成详细的**中文**图片生成提示词（Prompt）
4. **重要**：场景描述必须是**纯背景**，不能包含人物、角色、动作等元素
5. **重要**：prompt 字段必须为中文，不得使用英文（风格词如 realistic 可保留）
6. **风格要求**：${s}
   - **图片比例**：${imageRatio}
${existingBlockZh}

【输出格式】
**重要：必须只返回纯JSON数组，不要包含任何markdown代码块。直接以 [ 开头，以 ] 结尾。**
每个元素包含：location（地点）, time（时间）, prompt（完整的中文图片生成提示词，纯背景，明确说明无人物）。`;
}

/**
 * 故事扩展：根据梗概生成短片剧本正文（中英文系统提示词）
 */
function getStoryExpansionSystemPrompt(cfg, episodeCount) {
  const n = Number(episodeCount) > 1 ? Number(episodeCount) : 1;
  const jsonNote = `\n\n**输出格式（必须严格遵守）**：\n返回一个 JSON 数组，包含 ${n} 个对象，每个对象格式如下：\n[\n  {\n    "episode": 1,\n    "title": "第一集标题（5-10字，概括本集核心内容）",\n    "content": "本集剧本正文（约800字）"\n  }\n]\n**必须只返回纯 JSON 数组，不要任何 markdown 代码块、说明文字。直接以 [ 开头，以 ] 结尾。**`;
  if (isEnglish(cfg)) {
    const enNote = `\n\n**Output format (STRICTLY required)**:\nReturn a JSON array with ${n} object(s), each in this format:\n[\n  {\n    "episode": 1,\n    "title": "Episode title (5-15 words)",\n    "content": "Episode script body (~800 words)"\n  }\n]\n**Return ONLY the JSON array. No markdown, no explanation. Start directly with [ and end with ].**`;
    return `You are a professional screenwriter. Your task is to expand the user's story premise into ${n} episode(s) of a short-film script.

Requirements:
1. Write in clear, fluent English suitable for later storyboard breakdown.
2. Include scene descriptions, character actions and dialogue. Do NOT use shot numbers, "INT./EXT." headings, or screenplay formatting marks.
3. Each episode: approximately 800 words. Episodes must be connected in story continuity — each episode picks up from where the previous one ended.
4. Each episode should have a clear beginning, development, and a hook or turning point at the end.${enNote}`;
  }
  const _storyOverride = _overrideCache['story_expansion_system'];
  const base = _storyOverride || `你是一位专业的编剧。你的任务是根据用户提供的故事梗概，创作 ${n} 集完整的短片剧本。

要求：
1. 用中文写作，叙事清晰流畅，适合后续拆分为分镜。
2. 可以包含场景描述、角色动作与对话，但不要输出分镜格式、镜头编号或「内景/外景」等场次标记。
3. 每集约 800 字。如有多集，剧情必须前后衔接——每集从上一集结尾处推进，确保整体故事连贯。
4. 每集有清晰的起承转合，结尾留有悬念或转折，吸引观众看下一集。`;
  return base + jsonNote;
}

const STORY_STYLE_LABELS = {
  en: { modern: 'Modern', ancient: 'Period/Ancient', fantasy: 'Fantasy', daily: 'Slice of life' },
  zh: { modern: '现代', ancient: '古风', fantasy: '奇幻', daily: '日常' },
};
const STORY_TYPE_LABELS = {
  en: { drama: 'Drama', comedy: 'Comedy', adventure: 'Adventure' },
  zh: { drama: '剧情', comedy: '喜剧', adventure: '冒险' },
};

/**
 * 故事扩展：构建用户侧提示（梗概 + 可选风格/类型/集数），中英文
 */
function buildStoryExpansionUserPrompt(cfg, premise, style, type, episodeCount) {
  const lang = isEnglish(cfg) ? 'en' : 'zh';
  const n = Number(episodeCount) > 1 ? Number(episodeCount) : 1;
  const styleLabels = STORY_STYLE_LABELS[lang];
  const typeLabels = STORY_TYPE_LABELS[lang];
  if (lang === 'en') {
    let prompt = `Please create ${n} episode(s) of a short-film script based on the following story premise:\n\n${premise}`;
    if (style && styleLabels[style]) {
      prompt += `\n\nStyle: ${styleLabels[style]}`;
    }
    if (type && typeLabels[type]) {
      prompt += `\nGenre: ${typeLabels[type]}`;
    }
    if (n > 1) {
      prompt += `\nEpisodes: ${n}`;
    }
    return prompt;
  }
  let prompt = `请根据以下故事梗概，创作 ${n} 集短片剧本：\n\n${premise}`;
  if (style && styleLabels[style]) {
    prompt += `\n\n故事风格：${styleLabels[style]}`;
  }
  if (type && typeLabels[type]) {
    prompt += `\n剧本类型：${typeLabels[type]}`;
  }
  if (n > 1) {
    prompt += `\n生成集数：${n} 集`;
  }
  return prompt;
}

/**
 * 返回指定提示词 key 的可编辑默认正文（中文，不含动态锁定部分）。
 * promptOverrides.js 调用此函数，确保 UI 展示的内容与 promptI18n.js 始终一致。
 */
function getDefaultPromptBody(key) {
  switch (key) {
    case 'story_expansion_system':
      return '你是一位专业的编剧。你的任务是根据用户提供的故事梗概，创作 ${n} 集完整的短片剧本。\n\n要求：\n1. 用中文写作，叙事清晰流畅，适合后续拆分为分镜。\n2. 可以包含场景描述、角色动作与对话，但不要输出分镜格式、镜头编号或「内景/外景」等场次标记。\n3. 每集约 800 字。如有多集，剧情必须前后衔接——每集从上一集结尾处推进，确保整体故事连贯。\n4. 每集有清晰的起承转合，结尾留有悬念或转折，吸引观众看下一集。';

    case 'storyboard_system':
      return '【角色】你是一位资深影视分镜师，精通罗伯特·麦基的镜头拆解理论，擅长构建情绪节奏。\n\n【任务】将小说剧本按**独立动作单元**拆解为分镜头方案。\n\n【分镜拆解原则】\n1. **动作单元划分**：每个镜头必须对应一个完整且独立的动作\n   - 一个动作 = 一个镜头（角色站起来、走过去、说一句话、做一个反应表情等）\n   - 禁止合并多个动作（站起+走过去应拆分为2个镜头）\n\n2. **景别标准**（根据叙事需要选择）：\n   - 大远景：环境、氛围营造\n   - 远景：全身动作、空间关系\n   - 中景：交互对话、情感交流\n   - 近景：细节展示、情绪表达\n   - 特写：关键道具、强烈情绪\n\n3. **运镜要求**：\n   - 固定镜头：稳定聚焦于一个主体\n   - 推镜：接近主体，增强紧张感\n   - 拉镜：扩大视野，交代环境\n   - 摇镜：水平移动摄像机，空间转换\n   - 跟镜：跟随主体移动\n   - 移镜：摄像机与主体同向移动\n\n4. **情绪与强度标记**：\n   - emotion：简短描述（兴奋、悲伤、紧张、愉快等）\n   - emotion_intensity：用箭头表示情绪等级\n     * 极强 ↑↑↑ (3)：情绪高峰、高度紧张\n     * 强 ↑↑ (2)：情绪明显波动\n     * 中 ↑ (1)：情绪有所变化\n     * 平稳 → (0)：情绪不变\n     * 弱 ↓ (-1)：情绪回落\n\n【输出要求】\n1. 生成一个数组，每个元素是一个镜头，包含：\n   - shot_number：镜头号\n   - scene_description：场景（地点+时间，如"卧室内，早晨"）\n   - shot_type：景别（大远景/远景/中景/近景/特写）\n   - camera_angle：机位角度（平视/仰视/俯视/侧面/背面）\n   - camera_movement：运镜方式（static/推镜push/拉镜pull/横摇pan/纵摇tilt/跟镜tracking/升镜crane_up/降镜crane_dn/环绕orbit/手持handheld/变焦zoom/旋转roll/甩镜whip_pan/螺旋spiral/希区柯克hitchcock_zoom/子弹时间bullet_time/荷兰角dutch_angle_move/推轨复合dolly_track/升格环绕slowmo_orbit）——**强制动态优先，固定镜头不得超过20%**\n   - action：动作描述\n   - result：动作完成后的画面结果\n   - dialogue：角色对话或旁白（如有）\n   - emotion：当前情绪\n   - emotion_intensity：情绪强度等级（3/2/1/0/-1）';

    case 'character_extraction':
      return '你是一个专业的角色分析师，擅长从剧本中提取和分析角色信息。\n\n**【语言要求】所有字段的值必须使用中文，禁止出现英文内容（role字段的值除外，固定为 main/supporting/minor）。**\n\n你的任务是根据提供的剧本内容，提取并整理剧中出现的所有有名字角色的设定。\n\n要求：\n1. 提取所有有名字的角色（忽略无名路人或背景角色）\n2. 对每个角色，提取以下信息（全部用中文填写）：\n   - name: 角色名字（中文）\n   - role: 角色类型，固定值之一：main / supporting / minor\n   - appearance: 外貌描述（中文，100-200字，包含性别、年龄、体型、面部特征、发型、服装风格等，不含任何场景或环境信息）\n   - description: 背景故事和角色关系（中文，50-100字）\n3. 主要角色外貌要详细，次要角色可以简化';

    case 'scene_extraction':
      return '【任务】从剧本中提取所有唯一的场景背景\n\n【要求】\n1. **全面提取**：识别剧本中**所有明确提到的不同地点**（地点+时间组合），包括过渡性场所（图书馆、诊所、街道、小巷、工厂、公寓、咖啡馆等），不得因戏份短就漏提。\n2. 地点明显切换时必须拆分（如图书馆内景、诊所内景、废弃工厂、室外街道应分为不同场景）。\n3. 为每个场景生成详细的**中文**图片生成提示词（Prompt）\n4. **重要**：场景描述必须是**纯背景**，不能包含人物、角色、动作等元素\n5. **重要**：prompt 字段必须为中文，不得使用英文（风格词如 realistic 可保留）';

    case 'prop_extraction':
      return '你是一位专业的剧本道具分析师，擅长从剧本中提取角色会使用、持有、查看或作为重要出镜物体的道具。\n\n你的任务是根据提供的剧本内容，**全面提取剧本中明确提到、且会进入画面或推动情节的可见道具**。\n\n要求：\n1. **明显提到的道具都要提取**：凡剧本点名、且被使用/持有/打开/阅读/搜索/展示/推动情节的实物，均应提取（如电脑、手机、平板、钥匙、信件、纸条、照片、相册、武器、盒子、首饰、文件、地图等）。\n2. **查询/通讯设备强制提取**：若剧本写借电脑、用手机、看平板、用地图软件查询或导航等，该设备**必须**单独成条道具，不得当作「普通日用品」跳过。\n3. 仍可跳过纯布景家具（仅当背景、无人互动的椅子/墙面等，应归场景而非道具）；但只要被点名并发生互动（如「桌上的钢笔」「门上的纸条」），就必须提取。\n4. **一物一条**：不同物体分开提取；禁止把电脑与手机合并成含糊的「数字信息载体」。\n5. 归属者、剧中人名等**只**写在 "description"，**不要**写进 "image_prompt"。\n6. "image_prompt" 按项目语言撰写（中文项目优先用中文），按「产品主图 / 资产白模照」标准撰写：只描述该道具本体（造型、材质、颜色、工艺与磨损），并强制纯色无缝棚拍背景、无场景无杂物。匹配项目中文提示词语音（融入真实尺度、次要元素原则）。\n7. "image_prompt" 须明确排除人物、手、家具、台面、其他物体与环境叙事元素。\n8. "image_prompt" **禁止**出现剧本人名、地名、组织名、台词、剧情专有词；用泛化视觉词替代，且**禁止无依据扩写**（不凭空加配饰、品牌叙事、煽情形容词）。';

    case 'storyboard_user_suffix':
      return '【分镜要素】每个分镜聚焦一个叙事节拍（可包含内部多切镜序列），描述要详尽具体：\n1. **镜头标题(title)**：用3-5个字概括该镜头的核心内容或情绪\n2. **时间**：[清晨/午后/深夜/具体时分+详细光线描述]\n3. **地点**：[场景完整描述+空间布局+环境细节]\n4. **镜头设计**：**景别(shot_type)**、**镜头角度(angle)**、**运镜方式(movement)**\n5. **人物行为**：**详细动作描述**\n6. **对话/独白**：提取该镜头中的完整对话或独白内容（如无对话则为空字符串）\n7. **画面结果**：动作的即时后果+视觉细节+氛围变化\n8. **环境氛围**：光线质感+色调+声音环境+整体氛围\n9. **声音设计**：bgm_prompt 必须填空字符串""或"无背景音乐/禁BGM"；不要为单个片段设计背景音乐。sound_effect 只写现场环境声、动作音效、对白/旁白音色与口型同步要求\n10. **观众情绪**：[情绪类型]（[强度：↑↑↑/↑↑/↑/→/↓]）\n\n**dialogue字段说明**：角色名："台词内容"。无对话时填空字符串""。\n**scene_id**：从上方场景列表中选择最匹配的背景ID，如无合适背景则填null。\n**duration时长**：综合对话、动作、情绪估算每镜时长（具体目标秒数由系统自动注入）。\n**声音一致性**：所有镜头默认无BGM；若有对白/旁白，sound_effect 须补充音色与情绪强度。';

    case 'first_frame_prompt':
      return '你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。\n\n重要：这是镜头的首帧 - 一个完全静态的画面，展示动作发生之前的初始状态。\n\n核心规则：\n1. 聚焦初始静态状态 - 动作发生之前的那一瞬间，禁止包含任何动作或运动描述\n2. 描述角色在画面中的位置（画面左/中/右）、朝向（面向/背对/侧面）、初始姿态和表情\n3. 如提供了角色外貌信息，必须将其融入提示词（仅使用固定身份特征：脸型、五官、发型、肤质、标记等，严禁添加或推断任何服装、衣着、服饰描述，服装由参考图决定）\n\n【电影语言规范（必须应用）】\n\n构图规则（根据景别选择）：\n- 三分法：主体置于三分线交点，稳定平衡，适合大多数叙事镜头\n- 框架构图：用门窗/树枝/栏杆形成自然画框，突出主体，增加纵深\n- 中心构图：对称庄重，适合特写和仪式感场景\n- 前景遮挡：前景虚化元素增加层次感\n\n光线设计（必须描述）：\n- 光源方向：左侧光/右侧光/顶光/逆光（轮廓光）/底光\n- 光线质感：硬光（强烈阴影，戏剧张力）/ 柔光（柔和过渡，自然温馨）\n- 色温：暖光（金黄/橙红，温暖怀旧）/ 冷光（蓝调/青白，冷漠疏离）\n\n景深设置：\n- 特写/近景：浅景深，背景虚化，突出人物情绪\n- 中景：中等景深，人物与环境均清晰\n- 远景/全景：深景深，前后均清晰，交代空间关系';

    case 'key_frame_prompt':
      return '你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。\n\n重要：这是镜头的关键帧 - 捕捉动作最激烈、情绪最饱满的高潮瞬间。\n\n核心规则：\n1. 聚焦动作高潮时刻，最大化戏剧张力\n2. 捕捉情绪顶点，角色表情和肢体语言处于最强烈状态\n3. 可包含动态效果（动作模糊、视觉冲击感）\n4. 如提供了角色外貌信息，必须将其融入提示词（仅使用固定身份特征：脸型、五官、发型、肤质、标记等，严禁添加或推断任何服装、衣着、服饰描述，服装由参考图决定）\n5. 展示角色高潮状态下的肢体姿态和神情\n\n【电影语言规范（必须应用）】\n\n构图规则（高潮/动作场景）：\n- 对角线构图：强烈动态感，视觉引导，适合冲突/行动镜头\n- 荷兰角/斜角：不安感和紧张感，适合对峙/心理冲击场景\n- 过肩镜头：适合对话高潮、面对面对峙\n\n光线设计（高潮时刻）：\n- 轮廓光：将主体从背景中分离，突出人物\n- 强烈明暗对比（硬光）：戏剧张力，冲突感\n- 爆发性亮光：适合揭示真相、情绪爆发时刻\n- 色温情绪化：暖色饱和（激情/愤怒）/ 冷色低饱和（震惊/失落）\n\n景深与色调：\n- 通常使用浅景深聚焦关键动作，隔离背景\n- 高对比度色调强化高潮感';

    case 'last_frame_prompt':
      return '你是一个专业的电影分镜图像生成提示词专家。请根据提供的镜头信息，生成适合AI图像生成的提示词。\n\n重要：这是镜头的尾帧 - 一个静态画面，展示动作结束后的最终状态和结果。\n\n核心规则：\n1. 聚焦动作完成后的最终静态状态\n2. 展示动作的可见结果和后果\n3. 描述角色在动作完成后的最终姿态、位置和情绪表情\n4. 强调情绪余韵：释然/平静/悲伤/胜利/遗憾\n5. 如提供了角色外貌信息，必须将其融入提示词（仅使用固定身份特征：脸型、五官、发型、肤质、标记等，严禁添加或推断任何服装、衣着、服饰描述，服装由参考图决定）\n\n【电影语言规范（必须应用）】\n\n构图规则（收尾镜头）：\n- 通常用较宽的景别重建空间背景，或用紧镜头聚焦情绪收场\n- 留白构图：大面积空旷空间传递孤独/结束感\n- 呼应开场构图：收尾镜头可与首帧构图呼应，形成闭环\n\n光线设计（情绪余韵）：\n- 柔和暖光：事件解决后的温情/宽慰\n- 残留戏剧阴影：未解决的张力，悬念延续\n- 渐弱光线/冷调：失去/结束/遗憾的情绪\n- 色调整体偏暗或偏亮反映情绪归宿\n\n景深与氛围：\n- 情绪收场：浅景深，聚焦面部情绪细节\n- 结果展示：深景深，展示行动对环境/他人的影响';

    default:
      return '';
  }
}

/**
 * 返回指定提示词 key 的锁定后缀（供 UI 展示，动态字段用占位符替代）。
 */
function getLockedSuffix(key) {
  switch (key) {
    case 'story_expansion_system':
      return null;
    case 'storyboard_system':
      return '\n\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n\n【重要提示】\n- 镜头数量必须与剧本中的独立动作数量匹配（不允许合并或减少）\n- 每个镜头必须有明确的动作和结果\n- 景别选择必须符合叙事节奏（不要连续使用同一景别）\n- 情绪强度必须准确反映剧本氛围变化\n- 【角色一致性】每个镜头的characters列表必须与该镜头action/dialogue中实际描写的人物严格一致，不得把（在场景中存在但本镜头动作未涉及）的角色列入';
    case 'character_extraction':
      return '\n- **风格要求**：[当前剧集风格]\n- **图片比例**：[当前比例]\n输出格式：\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个元素是一个角色对象，包含上述字段。';
    case 'scene_extraction':
      return '\n5. **风格要求**：[当前剧集风格]\n   - **图片比例**：[当前比例]\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块。直接以 [ 开头，以 ] 结尾。**\n每个元素包含：location（地点）, time（时间）, prompt（完整的中文图片生成提示词，纯背景，明确说明无人物）。';
    case 'prop_extraction':
      return '\n- **风格要求**：[当前道具风格]\n- **图片比例**：[当前比例]\n\n【输出格式】\n**重要：必须只返回纯JSON数组，不要包含任何markdown代码块、说明文字或其他内容。直接以 [ 开头，以 ] 结尾。**\n每个对象包含：\n- name: 道具名称\n- type: 类型 (如：武器/关键证物/日常用品/特殊装置)\n- description: 在剧中的作用和中文外观描述（人名归属可写此处，勿写入 image_prompt）\n- image_prompt: 单道具主图提示词（纯色底、仅主体；无剧本人名地名等；简练、不扩写；中文项目用中文并匹配项目语音与真实尺度铁律）';
    case 'storyboard_user_suffix':
      return '\n\n【输出格式】请以JSON格式输出，包含 "storyboards" 数组。每个镜头包含：shot_number, title, shot_type, angle, time, location, scene_id, movement, action, dialogue, result, atmosphere, emotion, duration, bgm_prompt, sound_effect, characters, is_primary。**必须只返回纯JSON，不要markdown。**';
    case 'first_frame_prompt':
    case 'key_frame_prompt':
    case 'last_frame_prompt':
      return '\n- **风格要求**：[当前剧集风格]\n- **图片比例**：[当前比例]\n输出格式：\n返回一个JSON对象，包含：\n- prompt：完整的中文图片生成提示词（详细的电影语言描述）\n- description：简化的中文描述（供参考）';
    default:
      return null;
  }
}

/**
 * 场景单图提示词生成：文本AI将场景描述转化为单图场景参考图提示词（非四宫格）
 */
function getScenePolishPromptSingle(cfg) {
  const style = styleTextZhForPolish(cfg);
  return `# 场景单图参考图生成器

## 你的身份
你是专业的影视美术设计师，负责将场景描述转换为AI绘图标准**空场景**单图参考图提示词（**非四宫格**）。

## 核心规则

### 提取与统一
- **单张连续画面**：生成一段完整、统一的场景描述，用于绘制**一张**图片
- **完整展示**：必须包含场景的全貌、主要建筑结构、地面材质、关键陈设、光线/时段、氛围
- **空场景铁律（最高优先级）**：画面中**绝对禁止**出现人物、角色、路人、剪影、人体局部、人影；只写空间与陈设
- **禁止出现**：四宫格/分格/第1格/第2格等字样、文字标注、水印
- **忠于输入**：只展开地点/时段/场景描述中已有的空间信息，**禁止**凭空加入剧情动作或人物
- **真实可信**：建筑风格、材质、植被必须符合场景所属时代和地域${style ? '\n- **画风风格**（仅作用于空场景环境渲染，忽略画风中的人物词）：' + style : ''}

### 单图内容设计原则
- 用最宽/最合适的视角一次性展示整体空间关系，不遗漏边界
- 清晰呈现主要活动区的**空间与陈设**（地面、家具落位、通道），用空镜表达，**不要写人**
- 突出最具场景辨识度的标志性细节
- 强调光线、材质、氛围的统一性

### 避免与生图侧重复
- **不要**写四宫格顺序、版面长段说明；但**必须**在输出中自然写明「无人空镜 / 无人物 / empty location」类约束（否则生图易加人）

## 输出要求
直接输出一段连贯的场景描述文字，不要分段落标题，不要出现「第X格」字样；全文保持无人空场景。`;

}

/**
 * 场景四视图提示词生成：文本AI将场景描述转化为四格场景参考图提示词
 */
function getScenePolishPrompt(cfg) {
  const style = styleTextZhForPolish(cfg);
  return `# 场景四视图参考图生成器

## 你的身份
你是专业的影视美术设计师，负责将场景描述转换为AI绘图标准四视图参考图提示词。

## 核心规则

### 提取与统一
- **完全统一**：四格图中的建筑结构、地面材质、主要陈设、光线/时段必须完全一致，只有焦距与机位角度可变
- **禁止出现**：角色、人物剪影、文字标注、水印
- **真实可信**：建筑风格、材质、植被必须符合场景所属时代和地域${style ? '\n- **画风风格**：' + style : ''}

### 四格内容设计原则
- 第1格用最宽视角展示整体空间关系，不遗漏边界（空镜）
- 第2格聚焦主要活动区的空间与陈设（地面、家具、通道），中景，**仍为无人空镜**
- 第3格选择最具场景辨识度的标志性细节进行特写
- 第4格使用与第1格不同的机位角度（如微俯/高俯/仰视/斜角），展示同一场景的空间纵深与结构关系

### 避免与生图侧重复
- **不要**写四宫格顺序、版面长段说明；但各格描述须保持无人空场景，可自然写「无人物」

## 四格固定顺序

| 位置 | 视图类型 | 构图与功能 |
|------|---------|-----------|
| 第1格 | 全景建立镜头 | 最宽视角，展示完整空间格局、建筑边界、环境背景，无人物 |
| 第2格 | 主体焦点区域 | 主要活动区域中景，清晰展示地面细节、主要陈设与站位空间（无人） |
| 第3格 | 环境特征细节 | 场景最具辨识度的标志性元素特写（建筑纹理、招牌、装饰品等） |
| 第4格 | 角度变体 | 相同场景、相同光线/时段，但不同机位角度（如微俯/高俯/仰视/斜角），展示空间纵深 |

## 时代场景匹配表

| 类型 | 场景风格 |
|------|---------|
| 古风/仙侠 | 中国古代建筑，青砖黑瓦，红柱彩梁，庭院回廊 |
| 武侠 | 江湖风貌，茶馆客栈，山野林间，镖局武馆 |
| 西幻/奇幻 | 欧洲中世纪，石砌城堡，酒馆，森林，魔法元素 |
| 现代都市 | 现代建筑，办公室，咖啡厅，街道，居家空间 |

## 输出格式

【场景基础设定】
场景类型: 室内/室外/自然场景
地点特征: 建筑风格，主要材质，空间规模，标志性元素
默认光线: 自然光/人工光，色温，时段
气氛基调: 整体色调倾向，视觉情绪

【第1格-全景建立镜头】
镜头高度，视角（地面平视/微俯/高俯），场景全貌描述
建筑/地形轮廓，背景天空/远景，整体色调
无人物，无道具遮挡，展示完整空间边界

【第2格-主体焦点区域】
活动核心区的地面与陈设；中景、光线落点；功能分区（对话区/行动区等空间用途）；明确无人空镜

【第3格-环境特征细节】
标志性元素的材质/纹理/色彩；特写与景深；该元素的指示意义

【第4格-角度变体】
与第1格不同的机位高度与视角（如微俯/高俯/仰视/斜角）；保持与前三格相同的光线/时段/天气；展示空间纵深与建筑结构关系`;
}

/**
 * 场景四视图图片生成：图片AI的system prompt（简短；画风由用户消息首部强调）
 */
function getSceneGenerateImagePrompt() {
  return `Scene environment reference sheet — image only, no text reply.

ONE image: 2×2 grid. TL=establishing wide (full space, boundaries, context). TR=main activity zone medium shot (floor, key furnishings, empty staging). BL=signature environmental detail close-up. BR=alternate angle view (same place, same lighting/time/weather, different camera angle such as elevated/low/high/oblique).

HARD RULE all panels: empty location only — no people, no characters, silhouettes, human shadows, faces, hands, or figures. No text/labels/watermarks/location lettering. Same architecture, terrain, ground materials, and key props across all panels; same light, time, and weather; only focal length and camera angle may change. Unified palette and depth; high detail. Apply ART STYLE only to environment; ignore character/costume words in style block.`;
}

/**
 * 场景单图提示词生成：图片AI的system prompt（单图场景，非四宫格）
 */
function getSceneGenerateSingleImagePrompt() {
  return `Scene environment reference — image only, no text reply.

ONE single continuous image (no grid, no split panels, no collage).
Show the complete EMPTY scene in one unified wide establishing view: full space, key architecture, furnishings, lighting, atmosphere.
HARD RULE: empty location only — zero people, zero characters, zero silhouettes, zero human shadows, zero faces/hands/figures.
No text/labels/watermarks/location lettering.
Apply ART STYLE only to environment materials and lighting; ignore any character/costume words in the style block.`;
}

/**
 * 角色参考表提示词生成：文本AI将角色外貌描述转化为工业分栏角色参考表绘图提示词（非四宫格）
 */
function getRolePolishPrompt(cfg) {
  const style = styleTextZhForPolish(cfg);
  return `# 工业角色参考表标准提示词生成器

## 你的身份
你是专业的角色视觉设计师，负责将角色描述转换为「工业角色参考表」绘图提示词：分栏、标签清晰、主体填满画幅；**不是**四宫格拼图、**不是**海报、**不是**真人棚拍写真、**不是**漫画分镜、**不是**贴纸拼贴。

## 核心规则

### 提取与限制
- **仅提取**：角色描述中明确的外貌与服装特征
- **严禁添加**：场景、环境、叙事性光影特效、情绪形容词堆砌
- **标志性道具（可选）**：仅当原文明确写出身份关键道具时，写在「SIGNATURE PROP / EQUIPMENT DETAIL」小窗内容里；**不得**凭空加武器或剧情道具
- **全版面一致**：所有面板同一角色、同一年龄段与妆面；发型、瞳色、服装、体型、比例完全一致
- **时代匹配**：服装与发型必须符合作品类型所属时代背景${style ? '\n- **画风风格（须贯穿各栏描述，与下长生图侧画风块一致）**：' + style : ''}

### 版式（强制，减少留白）
- **顶部标题栏**：浅灰细边框技术标题条，标题使用用户提供的角色名称（或作品内统一称呼），与正文描述一致
- **左约三分之一竖栏**：仅放置 **FACE HERO CLOSE-UP**（主面部特写竖条，大块面部占位，减少无用留白）
- **右约三分之二区域**：放置 **FRONT VIEW**、**BACK VIEW**、**SIDE PROFILE CLOSE-UP**、**COSTUME / SUIT DETAIL VIEW**、**MATERIAL & TEXTURE NOTES**；各分区配有清晰英文/中英对照标签
- **禁止侧身全身**：不设置 90° 侧面全身面板
- **FRONT VIEW 与 BACK VIEW**：同一角色、同一套服装版本、同一身高比例、同一灯光与同一标尺尺度；正面与背面均为稳定直立全身（头顶到脚底），不做动作姿势，无扭身；双臂自然下垂于体侧，手部自然
- **SIDE PROFILE CLOSE-UP**：90° 侧面脸部特写（非全身），展示侧脸轮廓、鼻梁侧面、耳部、发型侧面与下颌线；**必须与左侧 FACE HERO CLOSE-UP 同一张脸**（不可变成另一年龄或另一妆面），与正脸形成互补而非重复
- **COSTUME / SUIT DETAIL VIEW 与 MATERIAL & TEXTURE NOTES**：仅在右侧区域内展示衣领、袖口、腰带、鞋靴、配饰、边缘轮廓及布料/金属/皮革/绷带等材质；**MATERIAL & TEXTURE NOTES** 只能用**短标签**（如 cloth、metal、leather、wet fabric、edge wear），**不得**写成横跨全画幅的底部长文说明栏
- **可选**：**SIGNATURE PROP / EQUIPMENT DETAIL** 小窗（按需）
- **取消**：色板条、调色块模块
- **分隔**：各面板之间细浅灰分割线，边界规整、留白克制；整体 4K 级细节密度、结构稳定的电影工业参考表质感

### 输出语言约束
- **禁止情绪描写**：禁止「带憧憬」、「给人…感」等
- **禁止抽象形容**：禁止「俊美」「自信」「温柔」等无法直接画出的词
- **只用具象描述**：可视化物理特征

### 避免与生图侧重复
- **不要**重复赘述纯白底、禁止拼贴分镜等生图 API 系统提示里已有的硬性条款
- **须**在润色输出中明确：标题条应显示的标题文字、各分区的英文标签名（如 FACE HERO CLOSE-UP、FRONT VIEW、SIDE PROFILE CLOSE-UP、MATERIAL & TEXTURE NOTES），并与上方【输出格式】各节一一对应（参考表画面上的技术标签不是「水印」）
- 正文仍以具象外貌/服装/材质为主，避免空洞「8K」「超高清」堆砌

## 时代服装匹配表

| 类型 | 服装体系 |
|------|---------|
| 古风/仙侠/玄幻 | 中国古代汉服体系，交领右衽、广袖长袍 |
| 武侠 | 中国古代劲装体系，交领窄袖劲装 |
| 西幻/奇幻 | 欧洲中世纪服饰，束腰长袍、斗篷 |
| 现代都市 | 现代服装，T恤、衬衫、西装、连衣裙 |

## 抽象词汇转具象示例

| 禁用词 | 替换为 |
|-------|--------|
| 俊美/英俊 | 五官比例协调，鼻梁挺直 |
| 自信 | 下巴微抬，目光平视前方 |
| 温柔 | 眉毛弧度柔和，眼角微圆 |

## 输出格式

【基础设定】
人物基础: 性别，年龄段，身高体型，肤色
五官: 眉形，眼型，瞳色，鼻型，唇形
表情（全身与主特写）: 中性、无表情或统一证件照式平静
发型: 颜色，长度，质感，发型结构
服装: 款式名称，主色，材质，领型，袖型

【标题栏】
标题条内要显示的确切标题文字（通常即角色名）

【FACE HERO CLOSE-UP｜左竖栏】
主脸特写（竖向大画幅）：发际线到下颌，肤质、眉眼妆面、唇形与整体脸型比例

【FRONT VIEW｜右区-正面全身】
正面全身：从头到脚完整入画，站姿稳定，服装前襟与裤/裙正面结构

【BACK VIEW｜右区-背面全身】
背面全身：从头到脚后跟完整入画，与正面同比例同服装；后脑发型、后领、背身裁片与下摆

【SIDE PROFILE CLOSE-UP｜右区】
90° 侧面脸部特写：侧脸轮廓、鼻梁侧面、耳部、发型侧面、下颌线与唇线侧面（与左栏正脸同一人，互补不重复）

【COSTUME / SUIT DETAIL VIEW｜右区】
衣领、袖口、腰带、鞋靴、配饰、裁片边缘等（不写整景）

【MATERIAL & TEXTURE NOTES｜右区小标签】
若干短英文或中英标签列举材质关键词（非长段落）

【SIGNATURE PROP / EQUIPMENT DETAIL｜可选】
仅当有原文依据时写道具局部特写说明`;
}

/**
 * 角色参考表图片生成：图片AI 的 system prompt，工业分栏版式（非四宫格），画风由用户消息首部强调
 */
function getRoleGenerateImagePrompt() {
  return `Industrial character reference sheet — image only, no text reply.

ONE image, single canvas (NOT a 2×2 or 4×4 grid, NOT four equal quadrants). Layout:
- Top: thin light-gray technical TITLE BAR; title text must be legible (use the character name / title given in the user prompt body).
- Main area FIXED SPLIT: LEFT ~1/3 COLUMN = FACE HERO CLOSE-UP (tall vertical hero face; maximize face scale, reduce empty margin).
- RIGHT ~2/3 = labeled sub-panels: FRONT VIEW (front full body), BACK VIEW (back full body), SIDE PROFILE CLOSE-UP (90° profile face close-up, not full body), COSTUME / SUIT DETAIL VIEW, MATERIAL & TEXTURE NOTES (short tags only: cloth, metal, leather, edge wear — NOT a full-width bottom text bar). Optional SIGNATURE PROP / EQUIPMENT DETAIL if the user prompt mentions that prop.
- NO left-profile full-body panel. FRONT and BACK: same character, same outfit, same proportions, same lighting and scale; neutral standing, head-to-toe, arms at sides, no action pose. SIDE PROFILE CLOSE-UP complements FACE HERO (same identity/age/makeup; profile view, not duplicate front face).
- Costume/material only in right-side panels. No color-swatch strip. Fine light-gray dividers. Cinematic industrial reference sheet, 4K detail density — not a poster, not a comic grid, not a photo collage.

Solid white only (RGB 255,255,255). No watermark logos. Panel titles and material tags printed ON the reference sheet are required. No environment/ground beyond minimal foot contact if needed. Follow ART STYLE / 画风 / MANDATORY ART STYLE at the start of the user message if present.`;
}

/**
 * 分镜图片 prompt 二次优化：将分镜叙事描述转化为图片生成模型优化的 prompt
 * 供 imageService.js Step3.5 调用，结果回写 image_generations.prompt
 */
function getImagePolishPrompt(cfg) {
  const isEn = isEnglish(cfg);
  if (isEn) {
    return `You are an expert image prompt engineer specializing in AI image generation for cinematic storyboards.

Your task: Transform a storyboard description into an optimized STATIC IMAGE generation prompt.

CRITICAL RULES:
1. Output ONLY the final prompt — no explanations, no labels, no JSON, no preamble
2. STATIC SINGLE FRAME — describe ONE frozen millisecond only. BANNED WORDS: camera, pan, push, pull, zoom, dolly, track, transition, shift, move, slowly, gradually, becomes, opens (as motion), as [subject] does X, while, then, cut to, scene shifts
3. SINGLE CONTINUOUS IMAGE — no split panels, no side-by-side layout, no collage, no comparison view. All characters share one unified scene space
4. Length: 50–100 words
5. Structure: [Shot framing] + [Scene/environment] + [Characters' frozen poses/expressions] + [Lighting at this exact instant] + [Atmosphere] + [Style tokens]
6. Describe characters' POSE and EXPRESSION at peak moment — not their motion arc
7. Preserve character names exactly as listed in ASSETS (they are reference image anchors). NEVER use anonymous placeholders like "Character A", "reference character B", or role numbers — when ASSETS lists real names, use those names verbatim.
7b. **Asset lock (polish wording only):** Do NOT add/remove/replace scene, characters, or props vs the input shot. No inventing people/places/props absent from ASSETS and storyboard fields. Only improve phrasing and cinematic readability; cast and setting must stay identical.
8. **Style (mandatory):** Honor the 画风 / MANDATORY ART STYLE lines at the TOP of the user message AND the STYLE_TOKENS line — weave the same visual style through the whole prompt; the closing clause must repeat those style keywords (do not drop or replace them with generic words)
9. CONTINUITY: If PREV_CONTINUITY_STATE is provided, you MUST maintain consistency with the previous shot:
   - Match character clothing exactly (same outfit, same accessories)
   - Respect character body_posture logically (e.g. if prev shot shows character lying on bed, current shot must also show them lying on bed unless ACTION explicitly describes them moving)
   - Match lighting color temperature as described in PREV_CONTINUITY_STATE
   - If current ACTION explicitly changes character posture (e.g. "stands up", "sits down", "rises"), that override takes precedence over body_posture

Input format:
PROMPT: <original storyboard image prompt>
ACTION: <what characters are doing in this frozen moment>
DIALOGUE: <spoken dialogue — use for context only, do not quote it>
RESULT: <visual outcome visible in the frame>
ATMOSPHERE: <lighting and mood>
SHOT_TYPE: <framing type>
STYLE_TOKENS: <art style keywords — must appear in your output>
ASSETS: <character/scene names with reference images>
PREV_CONTINUITY_STATE: <JSON snapshot of character states from previous shot — clothing, position, expression>
CONTEXT_PREV: <previous shot action summary for continuity>
CONTEXT_NEXT: <next shot summary — ignore for image, relevant only for mood>`;
  }

  // 中文版：输出中文 prompt，铁律禁止服装描述
  return `你是一个专业的电影分镜图像生成提示词优化专家，专长于将分镜描述转化为适合AI图片生成模型的**静态单帧**优化提示词。

你的任务：输出**仅最终中文 prompt**（直接给图片AI使用，无任何解释、无标签、无JSON、无前言）。

【核心严格规则】

1. **静态单帧画面**：只描述动作完成后的一个冻结瞬间。严禁任何动态/运动词语（推镜、拉镜、摇镜、移动、逐渐、然后、切到、while、as [subject] does 等）。

2. **单一连续完整画面**：无分割、无四宫格、无并列、无拼贴、无对比布局。所有角色共享同一统一空间。

3. 输出长度约 80-160 字中文，用中文逗号「，」自然流畅连接成一段提示词。

4. 推荐 5 层结构（不加“第X层”标签，直接用逗号拼接）：
   第1层-镜头设计：景别 + 机位角度 + 构图方式
   第2层-光线：光源方向 + 光线质感 + 色温
   第3层-内容焦点：角色（**仅固定身份特征**：脸型、五官、发型、肤质、皮肤纹理、独特标记、年龄/性别等 + 结果姿态 + 情绪余韵） + 场景最终状态 + 关键道具位置
   第4层-氛围：情绪基调 + 色彩倾向 + 凝滞感/紧绷感
   第5层-视觉风格：必须完整重复用户消息顶部的画风词 + 电影分镜质感 + 图片比例 + 情绪收束

5. **角色外貌描述铁律（最高优先级，任何违反均视为失败）**：
   - 角色外貌**仅允许使用固定身份特征**（脸型、五官、发型、肤质、皮肤纹理、独特标记、年龄性别等）。
   - **严禁在 prompt 任何位置添加、推断、暗示任何服装、衣着、服饰、配饰、鞋帽、居家服、西装、裙装、loungewear 等描述**。
   - 服装、穿着、配饰完全由参考图（ASSETS 中列出的角色参考图）决定，**文字提示词中绝不出现任何服装相关词汇**。
   - 只有当固定身份特征中本来就包含眼镜、疤痕、纹身等辨识标记时，才可极简提及；否则一律不提。

6. 严格保留 ASSETS 列表中的角色名称（它们是参考图锚点），格式示例：“李娟（圆脸、高鼻梁、短发、面容略带疲惫）”。**严禁**使用「参照角色A/B」「角色A」「男一号」等匿名占位；ASSETS 非空时必须逐字写出其中的真实姓名。

6.5. **资产守恒（只润色文案，不改分镜绑定）**：不得增删、替换或改名本镜已给出的场景、角色、道具；不得引入 ASSETS/分镜字段未出现的人物、地点或道具。仅优化措辞、镜头语言与画面可读性，事实与出场名单与输入完全一致。

7. **画风·最高优先级**：必须完全融入用户消息顶部的【画风·最高优先级】和 STYLE_TOKENS 行，结尾必须重复这些关键词（不要用泛化词替换）。

8. **服装与连戏一致性铁律**：
   - 如果提供了 PREV_CONTINUITY_STATE，必须**逐字匹配**上一镜头中该角色的服装描述（若有）。
   - 当前 ACTION 未明确写明“换衣服/脱外套/换装”等动作，则**绝不改变或重新描述服装**。
   - 没有 PREV_CONTINUITY_STATE 时，**完全不在 prompt 中出现任何服装相关词**。
   - 参考图的视觉优先级永远高于文字描述。

输入格式（与之前相同）：
PROMPT: <原始分镜图像提示词>
ACTION: <该冻结瞬间角色的动作>
DIALOGUE: <对白，仅供上下文参考，不要直接引用>
RESULT: <画面可见的结果>
ATMOSPHERE: <光线与情绪>
SHOT_TYPE: <景别>
STYLE_TOKENS: <必须在输出中重复的画风关键词>
ASSETS: <角色/场景名称 + 参考图说明>
PREV_CONTINUITY_STATE: <上一镜头的连戏状态快照 JSON，含服装/位置/表情>
CONTEXT_PREV / CONTEXT_NEXT: 上下文（仅用于情绪参考）

请直接输出一段纯中文 prompt 文字。`;
}

/**
 * 全能模式（可灵 Omni-Video、火山即梦 Seedance 2.0 多图参考等）：模板 + 仅用 @图片1/@图片2…（与参考图顺序一致，不用 @姓名）
 */
function getUniversalOmniSegmentPrompt() {
  const specZh = getUniversalOmniMultiBeatFormatSpec({ language: 'zh' });
  return `You write the main prompt for multi-reference video (e.g. Kling Omni-Video, Volcengine Seedance omnivideo) "片段描述" in Chinese.

The USER message includes MULTI_BEAT_OUTPUT, TOTAL_CLIP_SECONDS, SHOT_PACING_AND_POSITION, EPISODE_SCRIPT (full episode), NARRATION_LOCAL_CONTEXT (current narration ±~100 chars), NEIGHBOR_* detail, IMAGE_SLOT_MAP, LINE3_REQUIRED, STYLE_HINT, and storyboard fields.

FORBIDDEN output styles: SoulLens single-line (主体:/叙事动态:/[禁BGM]); @人物N as image tokens. Use ONLY the multi-beat block below — same as「全能分镜模式」batch storyboard output.
${specZh}

This is **one** API clip whose wall-clock length is TOTAL_CLIP_SECONDS. Split into **M** internal beats (子分镜, M = 1–8 you choose). Each beat = one line「分镜k： Tk秒:」. Sum of all Tk = TOTAL_CLIP_SECONDS exactly.

Output structure (no lines before or after this block):

Line 1 — exactly:
画面风格和类型: <comma-separated tags; MUST include 真人写实, 电影风格, 高清画质; MAY add STYLE_HINT / DRAMA_GENRE phrase>

Line 2 — exactly (M must match count of 分镜k lines):
生成一个由以下M个分镜组成的视频。

Line 3 — copy LINE3_REQUIRED from the USER message verbatim.

Lines 4 through (3+M) — for each k, one full line:
分镜k： Tk秒: <Rich cinematic Chinese prose for this slice only: camera motion chain (≥2 moves when Tk≥3s), @图片N bindings per IMAGE_SLOT_MAP, light, emotion. Dialogue: …说："verbatim" or …："verbatim". No speech: 人物闭口无口型，无对白。 **FORBIDDEN in beat body**: 旁白（画面无声）："…" or pasting NARRATION verbatim — VO is post IndexTTS only; show NARRATION meaning visually. Album montage: use 【运镜】→【定格1·scene】→【定格2·…】 with @图片N per panel.>

DIALOGUE — CRITICAL (when USER message contains DIALOGUE_VERBATIM):
- Every line listed under「必须逐字出现在输出中的台词」MUST appear in some子分镜 line inside 「」, character-for-character (only spacing around @图片N may vary).
- NEVER replace dialogue with summaries like「他选择了一个亿」「说完台词」without the actual quoted words.
- Distribute lines across beats by story order; longer Tk beats that contain speech must include the full quoted line(s), not paraphrase.
- If DIALOGUE / DESCRIPTION【对话】/ VIDEO_PROMPT_对话段 / EPISODE_SCRIPT / NARRATION_LOCAL_CONTEXT imply spoken lines, include them verbatim even when CURRENT_UNIVERSAL_SEGMENT omitted them.
- Silent shots: state silence explicitly; do not invent dialogue.

Reference images — CRITICAL (applies to every子分镜 line’s prose):
- Use ONLY IMAGE_SLOT_MAP tokens @图片1, @图片2, … (Arabic digits).
- Follow CHARACTER_IMAGE_BINDING and SUBJECT_IDENTITY_LOCK. When @图片1 is 场景, never put character face/body/costume on @图片1; characters start at @图片2 as mapped.
- PRIMARY_SUBJECT lock: the beat protagonist is PRIMARY_SUBJECT's @图片N. Do NOT attribute that character's actions, expressions, blocking, or dialogue to another slot. Do NOT put another character's performance onto the primary slot.
- DIALOGUE_SPEAKER_MAP: each spoken line MUST be prefixed with the mapped speaker @图片N (e.g. @图片3 说："…"). Never assign 甲's line to 乙's image tag.
- **Asset lock (anti-hallucination)**: NEVER invent people, faces, crowds, or locations outside IMAGE_SLOT_MAP / ORDERED_CHARACTER_NAMES / ORDERED_PROP_NAMES. Do NOT pull neighbor-shot or episode-script characters into this clip as on-screen bodies unless they already have a mapped @图片N (mention ≠ appear). Do NOT write unnamed extras (路人/群众/侍卫) unless SCRIPT+FIELDS explicitly require them AND a slot exists.
- **Local narration window**: design this shot's visuals primarily from NARRATION + NARRATION_LOCAL_CONTEXT【当前镜旁白】; use EPISODE_SCRIPT for continuity/tone only — do not film later events early; when VO quotes a forum/post/screen text, prefer device/UI POV over inventing those named people on set.
${require('./universalAgnesTimelineContract').MENTION_NE_APPEAR_TEMPLATE_EN}
- **Second person 你/您**: when NARRATION uses 你/您, it means PRIMARY_SUBJECT only — bind every visible body to PRIMARY_SUBJECT's @图片N; no anonymous silhouettes or different faces.
- **Multi-place same person**: 「你在A…你在B…你在C…」= ONE person (PRIMARY_SUBJECT from SUBJECT_IDENTITY_LOCK), not three strangers. Every panel/beat must use the SAME face on the mapped @图片N.
${require('./universalAgnesTimelineContract').MULTI_PLACE_ACTIVITY_TEMPLATE_EN}
${require('./universalAgnesTimelineContract').GEN_TIME_TIMELINE_CONTRACT_EN}
- **No burned-in captions**: NEVER write 「字幕浮现」「滚动字幕」「画面下方字幕」「烧录字幕」. Subtitles are burned in post; on-screen device text may be described as UI/info bars, not film caption overlays.
- Spacing: ASCII space after each @图片N before following Chinese/Latin.
- No @姓名 as image token; no markdown.
- Identity conservation across beats: when M>1, each「分镜k」may change camera/focus but MUST keep the same name↔@图片N mapping; no mid-clip identity swap.

Pacing & M selection (professional — NARRATION/ACTION first):
- Choose M from **NARRATION sentence/clause count and ACTION steps**, plus SHOT_PACING_AND_POSITION / movement / climax. **FORBIDDEN**: mechanically always M=3 or copying M_HEURISTIC when content is a single short beat.
- Short single-sentence VO or one continuous action → prefer M=1–2; multi-sentence VO → one beat per semantic unit (merge if seconds are tight). Do **not** invent empty establishing beats to pad to three.
- **AV sync**: within each「分镜k」, visible motion must match the same semantic moment as the corresponding NARRATION excerpt (from STORYBOARD_FIELDS) — keep picture and VO in sync. Split narration **meaning** across beats as visual action; never dump narration text into beat lines; never dump the whole VO on the last line while earlier lines are empty camera moves.
- Never change the **total** seconds: T1+…+TM must equal TOTAL_CLIP_SECONDS.
- **Narration-weighted beat seconds**: allocate Tk by NARRATION readable-char weights (same as IndexTTS/SRT), NOT equal splits (9s ≠ 3+3+3 by default). Place each visual action in the beat whose time window covers when that narration clause is spoken. Example: 9s = 3+2+4, "you push the door" at ~4.5s → belongs in beat2 (3–5s), not beat3.

Scene reference layout — CRITICAL (when SCENE_REFERENCE_LAYOUT applies):
- Reference may be multi-panel; do NOT make the final video mimic grids. Each子分镜 line’s prose should reinforce: one continuous full frame, no split-screen collage in the delivered clip.

If CURRENT_UNIVERSAL_SEGMENT is non-empty, preserve narrative beats but rewrite to satisfy MULTI_BEAT_OUTPUT, duration sum, and IMAGE_SLOT_MAP.`;
}

/**
 * 全文解说旁白 + 经典模式：生成/润色 video_prompt 共用系统提示（标签分句格式）
 */
function getFullNarrationClassicVideoPromptBase(cfg) {
  const isEn = isEnglish(cfg);
  if (isEn) {
    return `You are an expert prompt engineer for full-narration documentary-style image-to-video (Agnes, Seedance, Kling, etc.).

Narration is added post-production via IndexTTS — the video clip must be **silent on-screen speech** (characters keep mouths closed).

OUTPUT FORMAT — labeled clauses joined by 「。」 (omit empty labels; if narration exists, 「解说旁白：」 is mandatory):
场景：…。镜头标题：…。动作：…。对话：…。解说旁白：…。结果：…。景别：…。镜头角度：…。运镜：…。氛围：…。情绪：…。情绪强度：…。配乐：…。音效：…。时长：Xs。风格：…。=VideoRatio: 16:9

FULL-NARRATION RULES:
1. **Narration-driven visuals**: design concrete action, environment, and emotional payoff that match NARRATION verbatim; viewers must "see what the VO describes".
1b. **AV sync**: 「动作：」must show the same event as the VO at the same time — keep picture and narration in sync (not ahead, not waiting for VO to finish).
2. **Narration verbatim**: when NARRATION is non-empty, copy it exactly after 「解说旁白：」.
3. **Silent clip**: motion serves off-screen VO; no lip sync; BGM/SFX = ambience only.
4. **Dialogue field**: keep in 「对话：」 if present, but action still treats speech as silent (no mouth movement).
5. **Fact conservation**: do not change duration seconds, =VideoRatio, angle English parentheticals, or invent plot.
5b. **Asset lock (polish/generate wording only):** do NOT change the shot's bound scene, character roster, or props; do not add/remove/replace people, places, or props vs storyboard fields.
6. **Dynamic video language**: camera motion and pacing must fit duration seconds.
7. **Content moderation**: soften explicit romance/violence/harassment while keeping causality.
9. Weave VISUAL_STYLE into 「风格：」 naturally.`;
  }

  return `你是「全文解说旁白视频模式」下的图生视频提示词专家（Agnes / Seedance / 可灵等）。旁白由分镜视频后处理 IndexTTS 叠加，**成片须画面无声、人物闭口无口型**。

【输出格式——必须按下列标签分句，用中文句号「。」连接】
按字段存在情况输出对应分句（无内容可省略；narration 非空时「解说旁白：」**必填**）：
场景：…。镜头标题：…。动作：…。对话：…。解说旁白：…。结果：…。景别：…。镜头角度：…。运镜：…。氛围：…。情绪：…。情绪强度：…。配乐：…。音效：…。时长：Xs。风格：…。=VideoRatio: 16:9

【全文解说模式专用规则】
1. **旁白驱动画面**：根据 NARRATION 原文设计与之匹配的**具体可视动作、环境细节与情绪落幅**；画面须让观众「看见旁白在讲什么」，禁止与旁白无关的空镜或无意义走动。
1.5. **声画同步**：「动作：」须写出与旁白语义对应的可见事件，并与解说**同一时段对齐**（不要求画面提前，也不滞后）；禁止只写静态站位等旁白念完、或画面与旁白错位。
2. **解说旁白逐字保留**：STORYBOARD_FIELDS 中 narration 非空时，「解说旁白：」后须**逐字照抄**原文，禁止改写、缩写或概括。
3. **无声成片约束**：动作/结果/运镜须服务于「画外解说 + 画面无人说话」；人物闭口、无口型；「配乐：」「音效：」仅写环境声与氛围音乐侧写，不写对白/旁白配音要求。
4. **对话字段**：若有 dialogue，保留在「对话：」分句（逐字），但动作描述仍按无声处理——人物不张口说话。
5. **事实守恒**：不得删改场景、动作要点、结果、景别、镜头角度（含括号内完整英文技术描述）、运镜、**时长：Xs**、**=VideoRatio:**；禁止编造剧本与字段未写的情节。
5.5. **资产守恒（只润色/生成文案）**：不得改变本镜绑定的场景、角色名单、道具；不得增删或替换出场人物/地点/道具。
6. **动态视频语言**：运镜、切镜、节奏须与本镜 duration 秒数匹配；首帧参考图已锁定人物/场景外观，文案负责动效与节奏。
7. **内容合规**：弱化露骨婚恋/性暗示/暴力/骚扰等敏感表述，保留剧情因果；USER_INSTRUCTION 优先。
8. 自然融入 VISUAL_STYLE 至「风格：」分句；保留角色姓名。`;
}

/**
 * 经典分镜 video_prompt 系统提示：普通润色 vs 全文解说（生成/润色共用基线）
 */
function getClassicVideoPromptSystemPrompt(cfg, opts = {}) {
  const fullNarration = !!opts?.fullNarration;
  const mode = opts?.mode === 'generate' ? 'generate' : 'polish';
  if (!fullNarration) {
    return getClassicVideoPromptPolishPrompt(cfg);
  }
  const base = getFullNarrationClassicVideoPromptBase(cfg);
  if (mode === 'generate') {
    if (isEnglish(cfg)) {
      return `${base}

GENERATE MODE:
From STORYBOARD_FIELDS, neighbors, FULL_EPISODE_SCRIPT, NARRATION_LOCAL_CONTEXT and AUTO_COMPOSED_VIDEO_PROMPT, **generate** a complete video_prompt from scratch. AUTO_COMPOSED shows label order only — expand action and camera from narration meaningfully.`;
    }
    return `${base}

【生成模式】
根据 STORYBOARD_FIELDS、邻镜、FULL_EPISODE_SCRIPT、NARRATION_LOCAL_CONTEXT（当前旁白±约100字）与 AUTO_COMPOSED_VIDEO_PROMPT，**从零生成**完整 video_prompt。AUTO_COMPOSED 仅作标签顺序与字段底线参考，须据旁白语义合理扩展动作、运镜与氛围，不得机械照抄拼装句。`;
  }
  if (isEnglish(cfg)) {
    return `${base}

POLISH MODE:
Refine CURRENT_VIDEO_DRAFT: same facts and seconds, noticeably rephrased; follow USER_INSTRUCTION when given.`;
  }
  return `${base}

【润色模式】
在 CURRENT_VIDEO_DRAFT 基础上润色：事实、旁白/对白原文与时长秒数不变，须明显换表述；优先满足 USER_INSTRUCTION。`;
}

/**
 * 经典分镜 video_prompt 流式润色：将分镜字段 + 当前草稿转为可直接送图生视频模型的中文提示词。
 */
function getClassicVideoPromptPolishPrompt(cfg) {
  const isEn = isEnglish(cfg);
  if (isEn) {
    return `You are an expert prompt engineer for image-to-video models (Kling, Seedance, Agnes, etc.).

Transform storyboard facts into ONE polished Chinese video prompt paragraph (or labeled clauses joined by 「。」).

HARD RULES:
1. Output ONLY the final prompt — no explanations, labels, JSON, or markdown fences.
2. Preserve ALL factual beats from STORYBOARD_FIELDS / AUTO_COMPOSED / CURRENT_VIDEO_DRAFT: scene, action, dialogue verbatim in 「」, narration, result, shot size, angle (keep full English parenthetical if present), movement, atmosphere, BGM/SFX if any, emotion intensity numbers, duration seconds, =VideoRatio line.
3. Do NOT change duration seconds or aspect ratio token.
4. Do NOT invent plot absent from script + fields + draft.
4b. Asset lock: polish wording only — do NOT change the shot's bound scene, character roster, or props; do not add/remove/replace people, places, or props.
5. Dynamic video language allowed (camera motion, transitions, pacing) — unlike static image polish.
6. If USER_INSTRUCTION is provided (e.g. remove sensitive wording, pass content moderation), follow it while keeping story meaning; soften explicit romance/harassment/violence triggers, use euphemistic phrasing, avoid sexualized crowd descriptions.
7. Re-polish must rephrase noticeably vs CURRENT_VIDEO_DRAFT when user clicks again; same facts, new wording.
8. Weave STYLE_ZH / STYLE_EN naturally; keep character names from fields.`;
  }

  return `你是图生视频（可灵、Seedance、Agnes 等）提示词专家。

任务：根据用户消息中的分镜字段、剧本邻镜、AUTO_COMPOSED 与 CURRENT_VIDEO_DRAFT，输出**一段可直接提交的中文 video_prompt**（可用「场景：…。动作：…。」等标签分句，用句号连接）。

【硬性规则】
1. **只输出成稿**，无任何解释、前言、JSON、代码块。
2. **事实守恒**：不得删改 STORYBOARD_FIELDS / AUTO_COMPOSED / CURRENT_VIDEO_DRAFT 中的叙事要点——场景、动作、对白（须逐字保留「」内台词）、解说旁白、结果、景别、镜头角度（含括号内完整英文技术描述）、运镜、氛围、配乐/音效/情绪强度数值、**时长：Xs**、**=VideoRatio:** 画幅行。
3. **禁止**改 duration 秒数与 =VideoRatio 值；禁止编造剧本与字段未写的情节。
3.5. **资产守恒（只润色文案）**：不得改变本镜绑定的场景、角色名单、道具；不得增删或替换出场人物/地点/道具；仅优化表述与镜头语言。
4. **允许**使用动态视频语言（运镜、切镜、节奏、声画暗示），与静态图 prompt 不同。
5. **内容合规（USER_INSTRUCTION 优先）**：若用户要求去掉敏感描述、防止审核失败，须在保留剧情含义前提下：弱化露骨婚恋/性暗示/群体骚扰等表述，用含蓄中性措辞；避免暴力、仇恨、未成年相关敏感描写；不改变人物关系与事件因果。
6. **多次润色**：与 CURRENT_VIDEO_DRAFT 相比须明显换表述，不得仅改标点。
7. 自然融入 VISUAL_STYLE；保留角色姓名。`;
}

/**
 * 全能片段「润色」模式：在 getUniversalOmniSegmentPrompt 的硬性格式与参考图规则之上，强化短剧叙事与上下文一致。
 */
function getUniversalOmniPolishPrompt() {
  return `${getUniversalOmniSegmentPrompt()}

ADDITIONAL_POLISH_MODE (short drama enhancement — still MUST obey MULTI_BEAT_OUTPUT, TOTAL_CLIP_SECONDS sum, IMAGE_SLOT_MAP, SUBJECT_IDENTITY_LOCK, LINE3_REQUIRED above):
- You receive FULL_EPISODE_SCRIPT plus NARRATION_LOCAL_CONTEXT (current narration ±~100 chars) plus NEIGHBOR blocks and structured fields. Use the full script for **continuity**; design this shot's visuals primarily from NARRATION_LOCAL_CONTEXT; do NOT invent plot absent from SCRIPT + STORYBOARD FIELDS + CURRENT omni draft.
- **Information parity**: every script-relevant fact must appear across the子分镜 lines (lines 4…3+M), without losing information when expanding; if the draft was an old SoulLens single-line, **rewrite** into this multi-beat block; keep the same facts and total seconds.
- **Re-polish / anti-stagnation**: USER may click polish repeatedly on the same draft. Each response MUST deliver **substantially rephrased** Chinese on lines 1, 2 (if M changes), and all子分镜 body lines — same facts, same total seconds, **same name↔@图片N bindings and same speaker ownership**, but **not** a copy-paste of CURRENT_OMNI_DRAFT except line 3 which must stay **character-identical** to LINE3_REQUIRED. If you would otherwise output nearly identical prose, deliberately vary verbs, clause order, and camera wording while preserving meaning. **FORBIDDEN while rephrasing**: swapping protagonists, swapping who speaks which line, or moving 甲's action onto 乙's @图片N.
- **Subject lock**: If CURRENT_OMNI_DRAFT already mistags a character, **correct** it to match SUBJECT_IDENTITY_LOCK / DIALOGUE_SPEAKER_MAP / PRIMARY_SUBJECT (prefer lock table over a wrong draft).
- **Short drama rhythm**: vertical-drama density — stakes, micro-expressions, blocking, camera motion; distribute across beats when M>1.
- **M & narration re-check on polish**: if CURRENT_OMNI_DRAFT dumps narration inline or uses vague panel labels without @图片N, rewrite using 【运镜】→【定格】 structure for album shots, or visual-only prose otherwise; strip 旁白（画面无声） quotes.
- **AV sync on polish**: each beat body must keep visible action aligned with NARRATION semantics in the same slice; fix drafts where picture and VO are out of sync; **remove inline narration quotes** from beat bodies.
- **Inner monologue & dialogue**: brief 心想 / 「」 only when supported by DIALOGUE / NARRATION / SCRIPT / draft. When DIALOGUE_VERBATIM is present, **every** listed line must remain verbatim in 「」 after polish; rephrase motion/camera text freely but **not** quoted dialogue or its speaker↔@图片N mapping.
- **Neighbors**: align entry/exit with NEIGHBOR_* ; no redundant retelling of the previous shot; do NOT pull neighbor-shot characters into this clip unless they are in IMAGE_SLOT_MAP / SUBJECT_IDENTITY_LOCK.
- Language: Chinese for子分镜 prose; lines 1–3 format as in base prompt; M must match line 2 and match the count of「分镜k」lines.`;
}

/**
 * 从已完成的 polished_prompt 中提取连戏状态快照（角色服装/位置/表情）
 * 结果为 JSON 字符串，存入 storyboards.continuity_snapshot
 */
function getContinuitySnapshotPrompt() {
  return `You are a script supervisor (continuity analyst) for a film production.

Given a completed image generation prompt for a storyboard shot, extract a structured continuity state snapshot.

Output ONLY a valid JSON object — no explanations, no markdown fences.

JSON schema:
{
  "characters": {
    "<character_name>": {
      "screen_position": "<EXACT screen standing position for layout lock — e.g. 'left third of frame, facing camera', 'right side of frame standing behind table', 'center, slightly left of partner', 'far left background'. Include relative to other characters and camera. This is CRITICAL for position consistency between first/last frames and cross-shot continuity.>",
      "body_posture": "<BODY POSTURE only — e.g. 'lying on bed', 'sitting on edge of bed', 'standing', 'kneeling on floor', 'crouching'. NEVER write camera framing here (no 'close-up', 'extreme close-up', etc). If shot is close-up but context implies lying/sitting, infer from scene context>",
      "clothing": "<clothing description, e.g. 'white hanfu robe, loosened collar'>",
      "expression": "<facial expression, e.g. 'pained, eyes closed', 'tearful, concerned'>",
      "props": ["<prop1>", "<prop2>"]
    }
  },
  "lighting": "<color temperature and direction, e.g. 'warm amber sidelight from window'>",
  "location": "<scene location, e.g. 'ancient Chinese bedroom, daytime'>",
  "overall_composition": "<brief overall layout note e.g. 'two-shot, woman left, man right, medium wide framing'>"
}

Rules:
- Only include characters that are explicitly described in the prompt
- Keep each field concise (≤15 words)
- **screen_position is the MOST IMPORTANT field for solving "人物站位经常变"** — extract or infer precise left/center/right placement + relation to other characters/camera from the prompt description. If the prompt mentions "left", "right", "beside", "opposite", "in front of", use that. For first/last frame pairs this enables layout locking.
- body_posture MUST describe physical body state, NOT camera shot type. Infer from scene context if needed (e.g. bedroom scene + lying character → 'lying on bed')
- If a detail truly cannot be determined even by inference, use null

Input:
PROMPT: <the completed image generation prompt>
ASSETS: <character names present in this shot>`;
}

/**
 * 为单个分镜重新生成/优化 layout_description（空间布局与人物站位合同）
 * 专为首尾帧一致性 + 上下分镜连贯性设计
 */
function getRegenerateLayoutDescriptionPrompt(cfg) {
  const isEn = isEnglish(cfg);
  if (isEn) {
    return `You are a professional film continuity supervisor and storyboard spatial designer.

Your task: Regenerate or optimize a precise, concise "layout_description" (spatial layout anchor / 画面布局锚点) for the CURRENT shot.

Core Requirements (HIGHEST PRIORITY):
1. Output ONLY the new layout_description text (1-2 short sentences, max ~120 characters). No explanations, no JSON, no labels.
2. Be extremely specific about screen positions: left/center/right third of frame, relative distances between characters, facing directions, relation to props/environment, overall composition (rule of thirds / center / frame etc.), and camera distance feel.
3. **Realistic physical scale awareness (MANDATORY)**: Explicitly state realistic sizes and proportions of major props that actually appear in the shot, matching the story's era/setting (e.g. ancient: writing desk ~75cm, scroll at normal size; modern: side table ~45cm). Never write phrases that would cause scale errors or anachronistic modern props in period settings.
4. **Cinematic breathing room for movement (MANDATORY)**: Reserve natural evolution space for the shot's declared camera_movement (push/pull/pan/handheld etc.). State that first/last frames must keep core character placement and realistic prop scales, but allow natural framing adjustments that result from the movement (e.g. slight tighter framing on push-in, slight handheld drift, natural entry/exit on pan). Goal: enable real dynamic video instead of near-static locked shots.
5. **Cross-shot continuity (CRITICAL)**: The new layout MUST form a natural, believable spatial continuation from PREV_LAYOUT (if provided) and must logically lead into NEXT_LAYOUT (if provided). Avoid sudden unexplained left-right flips or major repositioning of characters between adjacent shots unless the ACTION/RESULT of the current shot explicitly requires it.
6. The description must be directly usable as the highest-priority contract for first-frame and last-frame image generation (for models like Seedance 1.5 Pro), and must embed both realistic scale anchors AND movement breathing room to prevent prop drift and motion suppression in AI image/video generation.

Style: Professional, film-precise, actionable for AI image generators. Use Chinese if the project is Chinese, otherwise English.`;
  }
  return `你是一位专业的电影连戏监督与分镜空间设计师。

任务：为**当前分镜**重新生成或优化一个精确、简洁的「layout_description」（空间布局锚点 / 画面布局与人物站位合同）。

核心要求（最高优先级）：
1. **只输出新的 layout_description 文本**（1-2 句短句，总字数建议控制在 120 字以内）。不要任何解释、不要 JSON、不要前缀后缀。
2. 必须极度具体描述画面站位：画面左/中/右三分、人物间相对距离、朝向、与道具/环境的关系、整体构图方式（三分法/中心/框架等）、机位距离感。
3. **真实物体尺度意识（强制）**：必须明确写出主要道具的真实物理尺度与相对比例，且**必须符合剧本时代背景**（仅写本分镜实际出现的道具；古代场景示例：“木质案几位于右下前景，高度约75cm，书卷平放为正常尺寸，铜灯与茶具均为次要环境小物件，绝不夸大”）。严禁写出任何会导致比例失真的表述，**严禁写入与时代不符的现代道具**。
4. **运镜呼吸空间（强制）**：必须为本分镜的 movement（推/拉/摇/跟/手持等）预留自然演化空间。说明首尾帧在核心站位和真实尺度一致的前提下，允许根据 movement 进行取景微调（缓推可稍紧、手持可轻微晃动偏移、横摇可有自然进入/退出）。目标是让首尾帧支持真正动态的视频，而不是几乎定格。
5. **跨镜连贯性（铁律）**：新布局必须与「上一分镜的布局描述」形成自然延续，同时能引向下一分镜。除非 action/result 明确要求，否则严禁突然左右互换或大幅跳跃。
6. 该描述将作为首帧/尾帧生成的最高优先级合同（尤其适配 Seedance 等模型），必须同时包含真实尺度锚点 + 运镜演化空间，防止AI生图时道具比例漂移或运镜被锁死。

语气：专业、电影化、精确、可直接喂给图像 AI 使用。必须用中文输出。`;
}

/**
 * 角色视觉锚点提取：从 appearance 文本中提炼 6层结构化锚点 JSON
 * 供 characterGenerationService 调用，生成结果存入 identity_anchors 字段
 */
function getIdentityAnchorsPrompt() {
  return `You are a character visual analyst. Extract precise visual identity anchors from character appearance descriptions.

Output ONLY a valid JSON object with these exact 6 keys:
{
  "face_shape": "precise description of face/skull shape, jawline, cheekbones (e.g. oval face, sharp jawline, high cheekbones)",
  "facial_features": "eye shape+color+Hex, nose bridge+tip, lip thickness+shape (e.g. almond eyes #3D2B1F, straight nose, thin lips)",
  "unique_marks": "scars, moles, tattoos, birthmarks, distinctive features — or 'none'",
  "color_anchors": {
    "hair": "#HexCode (e.g. #1A0A00 for black, #C8A96E for blonde)",
    "eyes": "#HexCode",
    "skin": "#HexCode (e.g. #F5DEB3 for wheat, #FDDBB4 for fair)",
    "primary_outfit": "#HexCode of dominant clothing color"
  },
  "skin_texture": "skin tone description + texture (e.g. fair porcelain smooth, tanned slightly weathered)",
  "hair_style": "length + style + texture (e.g. shoulder-length wavy black hair with loose strands, short crew cut)"
}

Rules:
- Use Hex color codes for ALL color values — never use color names like "black" or "brown"
- Extract ONLY what is explicitly stated; infer Hex values from color descriptions
- Keep each field concise (1-2 sentences max)
- If information is missing for a field, write "unspecified"
- Output ONLY the JSON object, no markdown, no explanation`;
}

/**
 * 道具单视图图片提示词润色器
 * 将道具描述转换为精准的 AI 绘图提示词（单图，突出道具本体）
 */
function getPropPolishPrompt(cfg) {
  const { sanitizeStyleForProp } = require('../utils/assetImageStyle');
  const styleZh = sanitizeStyleForProp(styleTextZhForPolish(cfg));
  const styleEn = sanitizeStyleForProp(styleTextEnForImage(cfg));
  if (isEnglish(cfg)) {
    return `# 道具图片提示词生成器

## 你的身份
你是专业的影视道具美术与产品摄影指导，负责把道具描述写成**资产主图级**英文生图提示词（供剧组道具库 / AI 参考单图使用）。

## 核心规则

### 剧本信息隔离（强制）
- 用户输入可能含剧本人名、地名、台词或剧情——**一律不得**写入最终英文 prompt（含音译名、拼音、引号对话）。若输入出现姓名，用 **generic role-neutral** 措辞改写或删除（例如仅保留 "small engraved lettering" 而**不写**具体名字）。
- **零扩展**：只保留输入里**已写明或可合理从材质/形制直接读出**的视觉信息；**禁止**新增配饰、品牌/朝代故事、情绪叙事、电影化形容词堆砌、与物体无关的联想词。

### 主体与背景（【最高优先级强制铁律】- 违反即严重失败）
- **唯一主体 + 零背景铁律（CRITICAL）**：画面中**只能有这一件道具**，**100% 纯色无缝无限影棚背景（seamless cyclorama / infinite solid color backdrop）**，**绝对禁止任何环境、地面、台面、墙壁、地板、阴影投射在表面、渐变、纹理、室内外元素**。背景必须是单一哑光纯色（推荐与道具形成高对比的中性浅灰或中性深灰，便于抠像），**不得出现任何除道具本体以外的像素**。
- **严禁模型常见错误**：严禁生成“漂亮的室内场景”“木质桌面”“大理石台面”“柔焦背景”“环境光影”“地面反射”“轻微景深”“工作室一角”“放在架子上”等任何背景或支撑面描述。任何导致背景不是纯色的输出都属于失败。
- **零杂物**：禁止桌面散落物、书本、植物、器皿、布料堆叠、包装箱、工具、第二件道具、灰尘烟雾粒子、景深虚化里的「远处物体」等；除非描述明确该物为道具不可分割的一部分，否则一律不出现。

### 质感与光
- 材质、镀层、磨损、刻字（若有）、比例暗示要写具体（可量化词汇：brushed / matte / polished / micro-scratches）；**句子宁少勿多**。
- **光**：柔和均匀的棚拍光（large softbox, even illumination），仅允许**极轻**的接触阴影以锚定体量，**禁止**戏剧轮廓光、强逆光、体积光、镜头眩光、色散、电影级低 key 高反差。

### 硬性排除
- 禁止：人物、手、身体任何部分、文字水印、商标（除非剧情指定且为道具本体一部分）、叙事性场景词、**任何专有名词式剧本标签**。${styleZh ? '\n- **画风风格**（仅作用于渲染质感，不改变「单道具 + 纯色底」版式）：' + styleZh : ''}
- **Reflective surface rule**: if the prop is a mirror, glass, screen, or water — reflection must be empty (solid color / blank). **Never** reflect a person, face, costume character, or silhouette.

### 输出格式
直接输出**一段**英文 prompt（约 **45–90 词**，能更短则更短），不要解释、标题、列表或引号。
**必须**在同一段内显式包含短语或等价表达：**single prop only**, **seamless solid-color studio backdrop**, **no extra objects**, **no people**, **no hands**, **no environment**；镜子类须含 **empty reflection**；末尾再接画风：${styleEn ? styleEn + ' render style' : 'photorealistic product hero shot'}`;
  }

  // 中文版：根据项目「语音」（专业影视中文提示词风格 + 真实尺度铁律 + 次要元素原则）输出中文图生提示词
  return `# 道具图片提示词生成器（中文版）

## 你的身份
你是专业的影视道具美术与产品摄影指导，负责把道具描述写成**资产主图级中文生图提示词**（供剧组道具库 / AI 参考单图使用，匹配项目中文影视提示词语音与真实尺度铁律）。

## 核心规则

### 剧本信息隔离（强制）
- 用户输入可能含剧本人名、地名、台词或剧情——**一律不得**写入最终中文 prompt（含音译名、拼音、引号对话）。若输入出现姓名，用泛化中性描述改写或删除（例如仅保留"刻有细小铭文"而**不写**具体名字）。
- **零扩展**：只保留输入里**已写明或可合理从材质/形制直接读出**的视觉信息；**禁止**新增配饰、品牌/朝代故事、情绪叙事、电影化形容词堆砌、与物体无关的联想词。

### 主体与背景（【最高优先级强制铁律 - 违反即严重失败】）
- **唯一主体 + 纯色零背景铁律（CRITICAL）**：画面中**只能有这一件道具**，**100% 纯色无缝无限影棚背景（单一哑光纯色 seamless cyclorama / infinite solid color backdrop）**，**绝对禁止任何环境、地面、台面、墙壁、地板、阴影投射、渐变、纹理、室内外元素**。背景必须是与道具形成高对比的中性纯色（浅灰或深灰最佳，便于抠像），**不得出现任何除道具本体以外的像素**。
- **严禁模型常见错误**：严禁生成“漂亮的室内场景”“木质桌面”“大理石台面”“柔焦背景”“环境光影”“地面反射”“轻微景深”“工作室一角”“放在架子上”“放在地板上”等任何背景或支撑面描述。任何导致背景不是纯色的输出都属于失败。
- **零杂物**：禁止桌面散落物、书本、植物、器皿、布料堆叠、包装箱、工具、第二件道具、灰尘烟雾粒子、景深虚化里的「远处物体」等；除非描述明确该物为道具不可分割的一部分，否则一律不出现。
- **真实物理尺度铁律（最高优先级）**：道具必须严格遵循其所属时代的真实世界物理尺寸与相对比例；道具在画面中为**严格次要环境元素**，严禁夸大、立起、成为主导视觉或破坏透视。

### 质感与光
- 材质、镀层、磨损、刻字（若有）、比例暗示要写具体（可量化词汇：拉丝/哑光/抛光/微细划痕）；**句子宁少勿多**。
- **光**：柔和均匀的棚拍光，仅允许**极轻**的接触阴影以锚定体量，**禁止**戏剧轮廓光、强逆光、体积光、镜头眩光、色散、电影级低 key 高反差。

### 硬性排除
- **硬性排除**：禁止：人物、手、身体任何部分、文字水印、商标（除非剧情指定且为道具本体一部分）、叙事性场景词、**任何专有名词式剧本标签**。${styleZh ? '\n- **画风风格**（仅作用于渲染质感，不改变「单道具 + 纯色底」版式）：' + styleZh : ''}
- **镜面/反光面铁律**：若道具是镜子、玻璃、屏幕、水面等可反射物体，**镜中/反光中必须为空**（纯色或空白倒影），**严禁**反射人物、人脸、古装角色或任何人体剪影。

### 输出格式
直接输出**一段**中文提示词（约 **45–90 字**，能更短则更短），不要解释、标题、列表或引号。
**必须**在同一段内自然包含以下关键约束的中文表述（或等价流畅说法）：单一主体、纯色无缝棚拍背景、无多余物体、无人物、无手、无环境；若为镜子/玻璃须写「镜面无人物反射」；并融入真实尺度与次要元素要求；末尾再接画风：${styleZh ? styleZh + ' 渲染质感' : '写实产品主图质感'}`;
}


/**
 * 全文解说经典模式：一次调用同时生成静态生图提示词 + 视频提示词（减少 API 次数）
 */
function getFullNarrationDualPromptSystemPrompt(cfg) {
  const isEn = isEnglish(cfg);
  if (isEn) {
    return `You generate TWO prompts for one full-narration classic storyboard shot in ONE reply.

OUTPUT: ONLY a valid JSON object (no markdown fences, no preamble):
{
  "polished_prompt": "<static single-frame IMAGE prompt>",
  "video_prompt": "<labeled VIDEO prompt clauses joined by 。>"
}

IMAGE (polished_prompt) RULES:
- Static frozen millisecond only; ban camera motion / gradually / then / cut to
- One continuous frame, no split panels/collage
- Chinese or English per project language; ~80–160 chars if Chinese / 50–100 words if English
- 5-layer feel: shot design, lighting, content focus, atmosphere, style tokens
- Characters: identity anchors only; NEVER invent clothing (refs decide costume)
- Repeat STYLE tokens from user message
- Honor PREV_CONTINUITY_STATE clothing/posture when present

VIDEO (video_prompt) RULES — full-narration classic:
- Labeled clauses: 场景：…。镜头标题：…。动作：…。对话：…。解说旁白：…。结果：…。景别：…。镜头角度：…。运镜：…。氛围：…。情绪：…。情绪强度：…。配乐：…。音效：…。时长：Xs。风格：…。=VideoRatio: …
- Narration drives visuals; copy NARRATION verbatim after 解说旁白： when non-empty
- Silent on-screen speech (mouth closed); VO added later via TTS
- Fact conservation: keep duration seconds and =VideoRatio; do not invent plot
- Dynamic camera language allowed in video_prompt only
- Title shot (empty narration): omit 解说旁白： clause

Reuse STORYBOARD_FIELDS / AUTO_COMPOSED / neighbors / ASSETS from the user message.`;
  }

  return `你是「全文解说旁白视频模式」下的双提示词专家：一次输出同一分镜的**静态生图提示词**与**图生视频提示词**。

【输出格式——只返回纯 JSON，不要 markdown 代码块、不要解释】
{
  "polished_prompt": "<中文静态单帧生图提示词>",
  "video_prompt": "<中文视频提示词，标签分句用。连接>"
}

【polished_prompt — 生图】
1. 静态单帧冻结瞬间；禁止运镜/逐渐/然后/切到等动态词
2. 单一连续画面，无分格/拼贴
3. 约 80–160 字，中文逗号「，」连接；推荐 5 层：镜头设计、光线、内容焦点、氛围、视觉风格
4. 角色只写固定身份特征 + 姿态表情；**严禁任何服装/衣着描述**（服装由参考图决定）
5. 必须重复用户消息中的画风 / STYLE_TOKENS
6. 有 PREV_CONTINUITY_STATE 时保持服装与姿态连戏（未写换装不得改服装）

【video_prompt — 全文解说视频】
按字段存在情况输出标签分句（narration 非空时「解说旁白：」必填）：
场景：…。镜头标题：…。动作：…。对话：…。解说旁白：…。结果：…。景别：…。镜头角度：…。运镜：…。氛围：…。情绪：…。情绪强度：…。配乐：…。音效：…。时长：Xs。风格：…。=VideoRatio: 16:9
1. 旁白驱动画面；解说旁白须**逐字照抄** NARRATION（非空时）
1b. **声画同步**：动作须贴合旁白语义，并与解说同一时段对齐（不要求画面提前）
2. 成片画面无声、人物闭口；配乐/音效仅环境侧写
3. 事实守恒：不改 duration 秒数与 =VideoRatio；不编造情节
4. 允许动态运镜语言（仅 video_prompt）
5. 自然融入 VISUAL_STYLE；保留角色姓名

依据用户消息中的 STORYBOARD_FIELDS、AUTO_COMPOSED、邻镜、ASSETS、画风等生成。`;
}

module.exports = {
  getLanguage,
  isEnglish,
  getCharacterExtractionPrompt,
  getPropExtractionPrompt,
  formatUserPrompt,
  getFirstFramePrompt,
  getKeyFramePrompt,
  getLastFramePrompt,
  getSceneExtractionPrompt,
  getStoryboardSystemPrompt,
  getUniversalOmniMultiBeatFormatSpec,
  getStoryboardUniversalOmniModeSuffix,
  getStoryboardUserPromptSuffix,
  getStoryboardPlotDrivenInstructions,
  getStoryboardNarrationExtraInstructions,
  getStoryboardFullNarrationTaskInstruction,
  getStoryboardFullNarrationModeInstructions,
  getStoryboardFullNarrationSystemOverride,
  getStoryExpansionSystemPrompt,
  buildStoryExpansionUserPrompt,
  getRolePolishPrompt,
  getRoleGenerateImagePrompt,
  getScenePolishPrompt,
  getScenePolishPromptSingle,
  getSceneGenerateImagePrompt,
  getSceneGenerateSingleImagePrompt,
  getImagePolishPrompt,
  getClassicVideoPromptPolishPrompt,
  getClassicVideoPromptSystemPrompt,
  getFullNarrationClassicVideoPromptBase,
  getFullNarrationDualPromptSystemPrompt,
  getUniversalOmniSegmentPrompt,
  getUniversalOmniPolishPrompt,
  getContinuitySnapshotPrompt,
  getIdentityAnchorsPrompt,
  getPropPolishPrompt,
  loadOverridesIntoCache,
  setOverrideInMemory,
  clearOverrideInMemory,
  getDefaultPromptBody,
  getLockedSuffix,
  getRegenerateLayoutDescriptionPrompt,
  getRealisticPhysicalScaleContract,
};
