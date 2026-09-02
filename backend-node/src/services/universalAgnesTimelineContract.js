/**
 * Agnes / 全能多拍：统一时间轴契约（生成时 LLM + 提交前适配器同一套语义）。
 * 禁止在此处堆业务动作特判（取瓶/掉瓶/进店/出门等）。
 */

/** 写/润色 universal_segment_text 时嵌入系统/规格文案（中文） */
const GEN_TIME_TIMELINE_CONTRACT_ZH = [
  '**时间轴模板（与提交 Agnes 前适配同一套语义；无业务动作特判）**：',
  '- 每「分镜k」只写该时段主事件；须完整写清过程，勿跳切到结果态。',
  '- **禁止抢跑**：仅属于后续 beat 的人/物/动作/场景变化，不得写入前段。',
  '- **禁止重复**：前序 beat 已完成的动作，后段勿再完整重演；后段只写承接或新事件。',
  '- 若一段里有多个语义独立的微动作，拆到相邻 beat，勿挤在同一行导致模型跳步。',
  '- 提交前会自动套统一结构：【X～Y秒·仅此时间段】+【本段唯一主事件】+【严禁抢跑·后拍摘要】+【已完成·禁止重复·前拍摘要】。',
].join('\n');

/** 英文规格里的对应段落 */
const GEN_TIME_TIMELINE_CONTRACT_EN = [
  '**Timeline template** (same semantics as pre-submit Agnes adapter; no story-specific action hardcodes):',
  '- Each「分镜k」= only that beat’s main event; write the process fully, do not jump to end-state.',
  '- **No spoiling**: people/props/actions/scene changes that belong to later beats must not appear in earlier beats.',
  '- **No re-play**: do not fully re-enact actions already completed in prior beats; later beats only continue or start new events.',
  '- If one line packs multiple independent micro-actions, split across adjacent beats instead of one crowded line.',
  '- At submit time the adapter wraps every beat as: 【X～Ys·this window only】+【sole event】+【no-spoiler from later】+【no-repeat from earlier】.',
].join('\n');

/** MULTI_BEAT_OUTPUT 单行摘要（中文 bundle） */
const MULTI_BEAT_TIMELINE_LINE_ZH =
  '- **时间轴模板**：严格线性；每 beat 只写该时段画面；禁止抢跑后续事件；禁止重复前序已完成动作；独立微动作拆拍（提交前套统一时段模板，无取放/进出等业务特判）。';

/** 多时空/多活动写拍模板（非相册硬剧本） */
const MULTI_PLACE_ACTIVITY_TEMPLATE_ZH =
  '- **多时空/多活动模板**：同一人多地点时，用统一结构写清每段可见画面（【运镜】→【定格1·地点】→【定格2·…】，或 M=地点数、每拍一地）；每段绑同一主人公 @图片N；禁止空泛抽象词代替具体动作与场景；禁止把旁白原文贴在 beat 末尾。';

const MULTI_PLACE_ACTIVITY_TEMPLATE_EN =
  '- **Multi-place / multi-activity template**: one person across places — use a uniform structure (【运镜】→【定格1·label】→【定格2·…】, or M=place count); same PRIMARY @图片N every panel/beat; FORBIDDEN vague abstract labels without concrete staging; FORBIDDEN pasting VO text at beat end.';

/**
 * 提及 ≠ 出场：推断 PRIMARY / 写拍 / 勾选角色共用同一套语义（禁止堆「诊所/医院」等业务后缀特判）。
 * 机械侧：引号内姓名不计出场；旁白第二人称时主人公优先 POV 槽。
 */
const MENTION_NE_APPEAR_TEMPLATE_ZH = [
  '**提及≠出场模板（SUBJECT / 写拍 / 角色勾选同一套语义；无店招后缀特判）**：',
  '- **出场**：角色在本镜画面里以身体/脸/动作/站位/对白说话人出现，才可绑 @图片N、写入 PRIMARY、列入 characters。',
  '- **仅提及**：姓名出现在引号内标题/店招/收据抬头/帖子/新闻/屏幕文字，或旁白只点名、质疑、回忆（人未入画）→ 不算出场；禁止因此把该人定为 PRIMARY 或写成入画身体。',
  '- **第二人称「你/您」**：旁白里的你/您 = 本镜 POV 主人公（绑定表首个角色槽），优先于文案里其它被点名的陌生人。',
  '- 引号/书名号内的姓名字符串一律按「屏幕/纸面文字」处理，不得当成角色走位依据。',
].join('\n');

const MENTION_NE_APPEAR_TEMPLATE_EN = [
  '**Mention ≠ appear template** (same semantics for SUBJECT / beat writing / character ticks; no shop-suffix hardcodes):',
  '- **Appear**: a character may bind @图片N / be PRIMARY / enter characters[] only if their body/face/action/blocking/spoken line is on screen in this shot.',
  '- **Mention only**: a name inside quoted titles, signs, receipt headers, posts, news, or on-screen text — or VO that only names/questions/recalls them off-screen — is NOT an appearance; do not make them PRIMARY or write their body entering frame.',
  '- **Second person 你/您**: VO 你/您 = this shot’s POV protagonist (first character slot), ahead of other named strangers in the copy.',
  '- Names inside quotation marks are on-screen/paper text only — never use them as staging evidence for who is in frame.',
].join('\n');

/** SUBJECT_IDENTITY_LOCK / SHOT_PACING 单行摘要 */
const MENTION_NE_APPEAR_LINE_ZH =
  '- **提及≠出场模板**：引号内标题/店招/抬头/帖子等只是文字提及；旁白「你/您」= POV 首槽；勿把仅被点名的人定为 PRIMARY 或写成入画。';

const MENTION_NE_APPEAR_LINE_EN =
  '- **Mention ≠ appear**: quoted titles/signs/headers/posts = text only; VO 你/您 = POV first slot; do not make merely-named people PRIMARY or put their body on screen.';

module.exports = {
  GEN_TIME_TIMELINE_CONTRACT_ZH,
  GEN_TIME_TIMELINE_CONTRACT_EN,
  MULTI_BEAT_TIMELINE_LINE_ZH,
  MULTI_PLACE_ACTIVITY_TEMPLATE_ZH,
  MULTI_PLACE_ACTIVITY_TEMPLATE_EN,
  MENTION_NE_APPEAR_TEMPLATE_ZH,
  MENTION_NE_APPEAR_TEMPLATE_EN,
  MENTION_NE_APPEAR_LINE_ZH,
  MENTION_NE_APPEAR_LINE_EN,
};
