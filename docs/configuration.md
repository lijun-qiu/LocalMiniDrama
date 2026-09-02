# AI 配置指南

**导航：[项目主页](../README.md) | [快速开始](quickstart.md) | [English](en.md)**

---

## 目录

- [配置入口](#配置入口)
- [三类模型配置](#三类模型配置)
- [阿里云 DashScope（通义）](#阿里云-dashscope通义)
  - [申请 API Key](#申请-api-key)
  - [可用模型](#可用模型)
  - [配置示例](#配置示例)
- [火山引擎 Volcengine（豆包）](#火山引擎-volcengine豆包)
  - [申请 API Key](#申请-api-key-1)
  - [可用模型](#可用模型-1)
  - [配置示例](#配置示例-1)
- [本地部署模型（Ollama 等）](#本地部署模型ollama-等)
- [其他 OpenAI 兼容接口](#其他-openai-兼容接口)
- [一键配置功能](#一键配置功能)
- [连接测试](#连接测试)
- [常见问题](#常见问题)

---

## 配置入口

点击软件右上角 **「AI 配置」** 按钮，进入 AI 服务管理页面。

页面分为三个 Tab：
- **文本生成** — 用于生成剧本、分镜脚本、提示词等
- **图片生成** — 用于生成角色图、场景图、分镜图
- **视频生成** — 用于生成分镜视频片段

每类模型可独立配置不同的服务商和模型，互不影响。

---

## 三类模型配置

| 类型 | 用途 | 推荐服务商 |
|------|------|----------|
| 文本生成 | 剧本生成、角色提取、分镜脚本、提示词优化 | 通义 Qwen、豆包 Pro |
| 图片生成 | 角色形象图、场景背景图、分镜静帧图 | 通义万象、豆包图片 |
| 视频生成 | 分镜视频片段 | 豆包 Seedance（经典单链路或 **Seedance 2.0 多图 / 全能模式**） |

---

## 阿里云 DashScope（通义）

### 申请 API Key

1. 访问 [阿里云百炼控制台](https://bailian.console.aliyun.com/)
2. 注册/登录阿里云账号
3. 进入「模型广场」，开通你需要的模型（文本类、图片类等）
4. 左侧菜单点击「API-KEY 管理」，创建新的 API Key
5. 复制 API Key（以 `sk-` 开头）

> 新用户通常有免费额度，建议先用免费额度测试。

### 可用模型

**文本生成：**
| 模型名 | 说明 |
|--------|------|
| `qwen-turbo` | 速度快、成本低，适合批量生成 |
| `qwen-plus` | 性能均衡，推荐日常使用 |
| `qwen-max` | 最强文本能力，适合剧本生成 |
| `qwen-long` | 超长上下文，适合长剧本 |

**图片生成：**
| 模型名 | 说明 |
|--------|------|
| `wanx2.1-t2i-turbo` | 速度快，通用图片生成 |
| `wanx2.1-t2i-plus` | 更高质量 |
| `wanx-v1` | 经典版本 |

**视频生成：**
| 模型名 | 说明 |
|--------|------|
| `wan2.1-t2v-turbo` | 文字转视频，速度较快 |
| `wan2.1-t2v-plus` | 更高质量 |

### 配置示例

在「AI 配置」页面新增配置：

```
服务商：DashScope
Base URL：https://dashscope.aliyuncs.com/compatible-mode/v1
API Key：sk-xxxxxxxxxxxxxxxx
模型：qwen-plus（文本）/ wanx2.1-t2i-turbo（图片）/ wan2.1-t2v-turbo（视频）
```

---

## 火山引擎 Volcengine（豆包）

### 申请 API Key

1. 访问 [火山方舟控制台](https://console.volcengine.com/ark)
2. 注册/登录火山引擎账号
3. 进入「模型广场」，开通所需模型（文本/图片/视频）
4. 左侧点击「API Key 管理」，创建 API Key
5. 复制 API Key

> 💡 视频生成（Seedance）需要单独开通，且按生成时长计费，注意控制用量。

### 可用模型

**文本生成：**
| 模型名 | API 端点 ID | 说明 |
|--------|------------|------|
| `Doubao-pro-32k` | `doubao-pro-32k-241215` | 通用高性能模型 |
| `Doubao-lite-32k` | `doubao-lite-32k-241215` | 低成本模型 |
| `Doubao-pro-128k` | `doubao-pro-128k-241215` | 超长上下文 |

**图片生成：**
| 模型名 | API 端点 ID | 说明 |
|--------|------------|------|
| `Doubao-seedream-4.5` | `doubao-seedream-4-5-251128` | 高质量图片生成 |

**视频生成：**
| 模型名 | API 端点 ID | 说明 |
|--------|------------|------|
| `Doubao-Seedance-1.0-pro-fast` | `doubao-seedance-1-0-pro-250528` | 较快速度 |
| `Doubao-Seedance-1.5-pro` | `doubao-seedance-1-5-pro-251215` | 高质量版 |
| `Doubao-Seedance-2.0-pro` | `doubao-seedance-2-0-260128` | **Seedance 2.0**，方舟多参考图；配合接口规范 **`volcengine_omni`** 与分镜**全能模式** |
| `Doubao-Seedance-2.0-fast` | `doubao-seedance-2-0-fast-260128` | Seedance 2.0 快速版 |

> ⚠️ 配置中填写模型名时，系统会自动映射到正确的 API 端点 ID，两种写法均可。

**分镜「全能模式」与接口规范（v1.2.5+，v1.2.7 增强校验）：**

- 制作页单个分镜可切换为 **「全能模式」**：中间编辑区为**片段描述**，可用 **`@图片1`、`@图片2`…** 对应参考图顺序（一般为场景 → 角色 → 物品；不含经典分镜中间主图；`@图片N` 后建议加**半角空格**）。若该框有内容，生视频时**只发送这段文本**，不会拼接下方结构化「视频提示词」。
- 在 **AI 配置 → 视频生成** 中，将 **接口规范** 选为 **`volcengine_omni`**（火山即梦 Seedance 2.0 等多图参考）或 **`kling_omni`**（可灵 Omni）。Seedance **2.x** 单段时长由后端吸附到 **4–15 秒**；方舟多图侧最多 **9** 张参考图。
- **v1.2.7**：单条生视频前会检测配置是否匹配（`kling_omni`，或 `volcengine_omni` + Seedance 2.x 模型名）；不匹配时弹窗说明，可选强制继续（降级为场景图 / 分镜主图参考）。**经典模式**无分镜参考图时会提示先生成分镜图，不提供纯文案强行生成。
- 亦可使用 **可灵 Omni** 走同一套全能分镜工作流，详见 AI 配置页内嵌说明。

### 配置示例

```
服务商：Volcengine
Base URL：https://ark.cn-beijing.volces.com/api/v3
API Key：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
模型：Doubao-pro-32k（文本）/ Doubao-seedream-4.5（图片）/ Doubao-Seedance-1.0-pro-fast（视频）
```

**视频生成参数（可选）：**
| 参数 | 说明 | 默认值 |
|------|------|--------|
| 分辨率 | `720p` / `1080p` / `480p` | `720p` |
| 视频时长 | 每段分镜的视频秒数（4 / 5 / 8 / 10s） | `5` |
| seed | 随机种子，固定可复现结果 | 随机 |
| camera_fixed | 是否固定摄像机 | `false` |
| watermark | 是否添加水印 | `false` |

---

## 本地部署模型（Ollama 等）

如果你在本机或内网部署了兼容 OpenAI 接口的模型服务（如 Ollama、LM Studio、vLLM 等）：

```
服务商：自定义 / OpenAI 兼容
Base URL：http://localhost:11434/v1   （Ollama 示例）
API Key：ollama   （或任意字符串，本地服务通常不验证）
模型：qwen2.5:7b   （你下载的模型名）
```

> ⚠️ 本地模型仅适用于**文本生成**，图片和视频生成通常需要专用的云端 API。

---

## 其他 OpenAI 兼容接口

任何支持 OpenAI Chat Completions 协议的接口均可接入：

```
Base URL：https://your-api-endpoint/v1
API Key：your-api-key
模型：your-model-name
```

常见兼容服务商：DeepSeek、硅基流动（SiliconFlow）、Groq、OpenRouter 等。

---

## 一键配置功能

在「AI 配置」页面，点击顶部的：
- **「一键配置通义」** — 自动创建阿里云 DashScope 的文本/图片/视频三套配置模板
- **「一键配置火山」** — 自动创建火山引擎的文本/图片/视频三套配置模板
- **「一键配置 Agnes」**（v1.2.8+）— 自动创建/更新 Agnes AI 的文本/图片/视频配置模板（默认 `agnes-2.5-flash` / `agnes-image-2.5-flash` / `agnes-video-2.5-flash`，列表内可选 2.0 / 2.1 等旧版）

一键配置后，只需填入你的 API Key，其他参数已预填好，点击「保存」即可使用。

---

## 图床配置（v1.2.8+）

部分 AI 接口（如 Gemini 图生、Seedance 2.0 角色认证）需要将本地图片上传到公网图床。可在 `backend-node/configs/config.yaml` 的 `image_proxy` 段配置：

```yaml
image_proxy:
  expire_hours: 2              # 缓存有效期（小时）
  use_for_video: true
  upload_timeout_seconds: 180  # 上传超时（秒），默认 180
  upload_max_attempts: 2       # 失败重试次数
  # upload_url: https://your-proxy.example.com/api/upload
```

未配置 `upload_url` 时使用内置默认中转地址。缓存 URL 在使用前会探测是否仍有效，失效则自动重新上传。

---

## 连接测试

每条 AI 配置记录右侧有「测试」按钮，点击后会发送一条简短请求验证连接是否正常。  
测试成功显示绿色提示，失败会显示具体错误信息（如认证失败、模型不存在等）。

---

## 常见问题

### Q: API Key 填错了或过期了怎么办？

在「AI 配置」页面找到对应记录，点击编辑，修改 API Key 后保存即可立即生效。

---

### Q: 生成图片时提示「image size must be at least 3686400 pixels」

这是火山引擎图片生成 API 的最低像素要求。本系统会自动根据项目设定的画面比例计算合适的分辨率（最低 2560×1440），通常无需手动处理。如果仍然报错，请检查是否配置了自定义的 size 参数。

---

### Q: 视频生成提示「model does not exist」

火山引擎视频模型的 API 端点 ID 与展示名称不同。请确认你已在火山方舟控制台开通了该模型，并使用正确的模型名称。系统内置了常见模型名称的映射，两种写法（展示名 / 端点 ID）均支持。

---

### Q: 生成速度很慢怎么办？

- 图片生成通常需要 15–60 秒
- 视频生成通常需要 1–5 分钟（取决于时长和分辨率）
- 建议使用 `turbo` 或 `fast` 后缀的模型加快速度
- 如频繁遇到 429 限流，系统会自动重试，无需手动干预

---

## 画面音效 Foley（与 BGM 独立）

在 BGM 面板下方的 **画面音效（Foley）** 面板使用。

1. 先生成各镜视频并完成「合成视频」
2. 点 **分析画面音效**：按分镜每 **3 秒**抽一帧，调用 Agnes 视觉（推荐 `agnes-2.5-flash`）标出明显事件（关门、按键等）
3. 点 **生成短音**：本地 ACE-Step 为每条事件生成短 Foley（需先在 BGM 面板启动 ACE-Step）
4. 点 **混入成片**：按 `t_episode_sec` 时间轴叠到合成原片或带 BGM 成片 → 写入 `foley_video_url`（**不改写** `video_url` / `bgm_video_url`）

AI 配置：文本类型需包含 Agnes，并建议加入模型 `agnes-2.5-flash`。

## 音乐 / BGM（ACE-Step 本地 + Suno 可选）

成片配乐在「合成视频」旁的 **BGM 生成** 面板使用。

1. **推荐（本地）**：在 BGM 面板点 **「启动」**（或运行 `scripts/start-ace-step.ps1`），默认 `http://127.0.0.1:8001`，无需 API Key；不用时点 **「卸载」** 释放显存
2. **可选（云端）**：在「AI 配置」新增 **音乐/BGM** 类型，选 Suno 模型（`suno_music_open` / `chirp-v3-5`）；Base URL 指向兼容网关（如 Chatfire / 4022），含 `/v1` 后缀亦可
3. BGM 仅生成纯器乐；画面事件音效用下方 Foley 面板
4. 流程：合成视频 → AI 生成描述 / 生成 BGM → **混入成片（保留原片）**
5. 原 `video_url` 不改写；带 BGM 结果写入 `bgm_video_url`，可多次混音试听

环境变量（可选）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `ACE_STEP_BASE_URL` | `http://127.0.0.1:8001` | ACE-Step API 地址 |
| `ACE_STEP_ROOT` | `C:\my\ace-step\ACE-Step-1.5` | ACE-Step 安装目录 |
| `ACE_STEP_LM_MODEL` | `acestep-5Hz-lm-0.6B` | 规划 LM 权重 |

---

[← 返回项目主页](../README.md)
