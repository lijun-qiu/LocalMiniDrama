# ArcReel Workflow 整包移植计划

> 目标：把 ArcReel 的 **状态机 + 三轴模型 + agent 契约** 整包迁入 LocalMiniDrama，覆盖：
>
> | content_mode | generation_mode | 中文 |
> |---|---|---|
> | `narration` | `storyboard` | 旁白解说 × 分镜 |
> | `narration` | `reference_video` | 旁白解说 × 参考视频 |
> | `drama` | `storyboard` | 剧情演绎 × 分镜 |
> | `drama` | `reference_video` | 剧情演绎 × 参考视频 |
>
> **不移植** `ad`（广告）模式。

## 三轴（不得折叠）

1. **步骤进度** `WorkflowStepState`：`completed | ready | active | blocked | pending | skipped`
2. **产物时效** `ArtifactStatus`：`current | stale | missing | blocked`（stale ≠ 缺口，不自动重生）
3. **任务 / provider checkpoint**：in-flight 生成尝试与供应商是否已收单

REST 与 agent（OpenClaw `http` → 同一 JSON）共用 `WorkflowPlan`。

## 分期完成状态

### Phase 1 — 契约与分镜路径 ✅

- [x] `workflowRules` / action 闭集 / `buildWorkflowPlan`
- [x] SQLite `getWorkflowStatus`：四模式矩阵
- [x] `POST .../workflow-plan`；`PUT .../workflow-modes`
- [x] 单测；OpenClaw 契约说明

### Phase 2 — 时效轴 + step1 真门禁 ✅

- [x] `.lmd_artifacts.json` currency（current/stale/missing/blocked）
- [x] step1 文件 + prepare / content OCC / confirm / quarantine 钩子
- [x] `workflow.step1_enforced`（新项目默认 true；旧项目缺省走 legacy 旁路）
- [x] stale 不阻断导出

### Phase 3 — 参考视频模式 ✅

- [x] step1 `reference_video` units → `generateReferenceScript` → `video_units` + storyboard 绑定
- [x] plan 中 `storyboard` 步骤 `skipped`
- [x] 视频缺口驱动 `generate_videos`（复用现有 storyboard 视频 API）

### Phase 4 — UI + 执行桥 ✅

- [x] `WorkflowPanel.vue`（三轴展示 + 执行下一步）
- [x] FilmCreate：模式选择（旁白/剧情 × 分镜/参考）+ 侧栏面板
- [x] `POST .../workflow-execute` → prepare/confirm/generate_script/export + UI hint

### Phase 5 — Agent 强化 ✅

- [x] OpenClaw `workflow-contract.md` 强制 plan 循环
- [x] `mcp-workflow-tools.json` 薄封装描述（与 REST 同序列化）

## 关键路径

| 能力 | 路径 |
|------|------|
| 核心模块 | `backend-node/src/services/workflow/` |
| 计划 API | `POST /api/v1/dramas/:id/workflow-plan` |
| 执行 API | `POST /api/v1/dramas/:id/workflow-execute` |
| step1 | `/api/v1/episodes/:id/script-review/*` |
| video_units | `/api/v1/episodes/:id/video-units*` |
| UI | `frontweb/src/components/WorkflowPanel.vue` |
| Agent | `openclaw-skill/workflow-contract.md` |

## 复查后已修（2026-09-26）

- [x] `choose_narration_delivery` 仅对 `content_mode=narration` 生效（剧情项目不再被卡住）
- [x] `async_tasks` 归属匹配不再误绑其它 drama（去掉空 rid / 前缀撞号）
- [x] 取消 currency「读时自动 register」（避免旧图被标成 current）
- [x] reference `video_units` 相对 step1 fingerprint 过期 → 重回 `generate_script`
- [x] 改模式后刷新 WorkflowPanel；隐藏 skipped 步骤；状态中文化
- [x] UI hint 接入批量分镜图/视频/提取

## Phase 6 — ArcReel LLM step1/step2（2026-09-26 夜）

- [x] `writingSyntax.js` + `referenceVideoPrompts.js`：对齐 ArcReel 提示词
- [x] `draftValidation.js`：source_text / 台词覆盖 / 时长档 / dialogue preserve
- [x] `prepare_step1`：reference_video 走 **LLM split**（失败回退启发式）
- [x] `generate_script`：reference_video 走 **LLM step2 视觉扩写** + 台词锁定校验（失败保留 step1）
- [x] 内容确认硬门禁；分镜自动绑角色/场景参考图

## 已知未做（有意延后 / 非阻断）

| 项 | 说明 |
|----|------|
| 出图/出视频 write-path 注册 currency | 需挂钩 imageService/videoService 完成回调 |
| quarantine 写入 | `writeQuarantine` 已备，尚无 AI 校验器调用 |
| 一键流水线改走 plan 循环 | 旧 `runOneClickPipeline` 仍并行存在；侧栏工作流是权威路径 |
| DramaCanvas 未挂 WorkflowPanel | 列表模式已挂 |
| video batch admission | `admission` 恒 null；费用确认未移植 |
| TTS 不挡导出 | 与 ArcReel 一致：缺 TTS 只报告，不挡 `export` |
| script_structure / repair_video_units | 动作闭集保留，状态机尚未产出 |
