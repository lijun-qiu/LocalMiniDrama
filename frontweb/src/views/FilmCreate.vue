<template>
  <div class="film-create" :class="{ 'sidebar-collapsed': navCollapsed }">
    <!-- 顶部 -->
    <header class="header">
      <div class="header-inner">
        <h1 class="logo" @click="goList">
          <span class="logo-main">本地短剧助手</span>
          <span class="logo-sub">LocalMiniDrama</span>
        </h1>
        <span class="breadcrumb-sep">›</span>
        <span class="page-title">{{ dramaId ? (store.drama?.title || '项目') : '新建故事' }}</span>
        <el-select
          v-if="dramaId"
          v-model="selectedEpisodeId"
          class="header-episode-select"
          placeholder="选择集数"
          clearable
          size="small"
          style="width: 130px"
          @change="onEpisodeSelect"
        >
          <el-option
            v-for="ep in (store.drama?.episodes || [])"
            :key="ep.id"
            :label="ep.title || '第' + (ep.episode_number || 0) + '集'"
            :value="ep.id"
          />
        </el-select>
        <el-button v-if="dramaId" class="btn-back-drama" @click="router.push('/drama/' + dramaId)">
          <el-icon><ArrowLeft /></el-icon>
          返回剧集
        </el-button>
        <el-button v-if="dramaId" type="primary" plain class="btn-canvas-mode" @click="goCanvasMode">
          <el-icon><Grid /></el-icon>
          画布模式
        </el-button>
        <div class="header-actions">
          <el-button
            v-if="dramaId && currentEpisodeId"
            type="danger"
            plain
            class="btn-clear-episode"
            :loading="clearingEpisode"
            :disabled="pipelineRunning || clearingEpisode"
            title="保留当前集剧本正文，删除角色、场景、道具、分镜及全部图片视频"
            @click="onClearEpisodeExceptScript"
          >
            一键清空
          </el-button>
          <el-button class="btn-theme" :title="isDark ? '切换到浅色模式' : '切换到暗色模式'" @click="toggleTheme">
            <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
            {{ isDark ? '浅色' : '暗色' }}
          </el-button><el-button class="btn-ai-config" @click="showAiConfigDialog = true">
            <el-icon><Setting /></el-icon>
            AI配置
          </el-button>
        </div>
      </div>
    </header>

    <!-- 左侧固定侧边栏 -->
    <nav class="quick-nav" :class="{ collapsed: navCollapsed }" aria-label="快捷导航">
      <div class="nav-sidebar-header">
        <span v-if="!navCollapsed" class="nav-sidebar-title">导航</span>
        <div class="nav-toggle" :title="navCollapsed ? '展开导航' : '收起导航'" @click="toggleNav()">
          <el-icon><Expand v-if="navCollapsed" /><Fold v-else /></el-icon>
        </div>
      </div>

      <!-- 步骤列表 -->
      <div class="nav-steps">
        <div
          v-for="(step, idx) in navSteps"
          :key="step.key"
          class="nav-step"
          :class="['status-' + step.status]"
          @click="scrollToAnchor(step.anchor)"
        >
          <!-- 左侧连接线 -->
          <div class="step-connector-wrap">
            <div v-if="idx > 0" class="step-line step-line-top" :class="{ filled: navSteps[idx - 1].status === 'done' }" />
            <div
              class="step-dot"
              :class="['dot-' + step.status]"
            >
              <el-icon v-if="step.status === 'done'" class="dot-icon"><Check /></el-icon>
              <el-icon v-else-if="step.status === 'generating'" class="dot-icon spin"><Loading /></el-icon>
              <span v-else class="dot-num">{{ idx + 1 }}</span>
            </div>
            <div v-if="idx < navSteps.length - 1" class="step-line step-line-bottom" :class="{ filled: step.status === 'done' }" />
          </div>

          <!-- 右侧文字 + 状态徽章 -->
          <div class="step-body">
            <span class="step-label">{{ step.label }}</span>
            <span v-if="step.count > 0 && step.status !== 'done'" class="step-count">{{ step.count }}</span>
            <span v-if="step.status === 'partial'" class="step-badge partial-badge" title="部分完成">
              <el-icon><WarningFilled /></el-icon>
            </span>
            <span v-else-if="step.status === 'generating'" class="step-badge gen-badge" title="生成中">
              <el-icon class="spin"><Loading /></el-icon>
            </span>
          </div>
        </div>
      </div>

      <!-- 分镜子列表 -->
      <div v-if="!navCollapsed && storyboards.length > 0" class="nav-group">
        <div class="nav-sub-toggle" @click="storyboardMenuExpanded = !storyboardMenuExpanded">
          <el-icon><Minus v-if="storyboardMenuExpanded" /><Plus v-else /></el-icon>
          <span>分镜列表</span>
        </div>
        <div v-show="storyboardMenuExpanded" class="nav-sub-list">
          <div v-if="storyboards.length > STORYBOARD_PAGE_SIZE" class="nav-sub-page-hint">
            当前页 {{ storyboardPage }}/{{ storyboardTotalPages }}（侧栏与主列表同步）
          </div>
          <template v-for="(sb, i) in pagedStoryboards" :key="sb.id">
            <!-- 段落标题行 -->
            <div
              v-if="sb.segment_title && (i === 0 || sb.segment_index !== pagedStoryboards[i - 1].segment_index)"
              class="nav-segment-label"
            >
              <span class="nav-segment-dot" />
              {{ sb.segment_title }}
            </div>
            <div
              class="nav-sub-item"
              :title="sb.title || '分镜 ' + (storyboardPageOffset + i + 1)"
              @click="scrollToStoryboardCard(sb.id)"
            >
              {{ storyboardPageOffset + i + 1 }}. {{ sb.title || '分镜' }}
            </div>
          </template>
        </div>
      </div>

      <!-- 当前任务面板 -->
      <div v-if="allActiveTaskItems.length > 0" class="atp-panel">
        <!-- 折叠态：只显示旋转点和数量 -->
        <div v-if="navCollapsed" class="atp-collapsed-badge" :title="allActiveTaskLabels.join('\n')">
          <span class="atp-spin-dot" />
          <span class="atp-collapsed-count">{{ allActiveTaskItems.length }}</span>
        </div>
        <!-- 展开态：标题 + 任务列表 -->
        <template v-else>
          <div class="atp-header">
            <span class="atp-spin-dot" />
            <span class="atp-title">进行中</span>
            <span class="atp-count-badge">{{ allActiveTaskItems.length }}</span>
          </div>
          <div class="atp-list">
            <div
              v-for="item in allActiveTaskItems.slice(0, 8)"
              :key="item.id"
              class="atp-item"
            >
              <span class="atp-item-dot" />
              <el-tooltip :content="item.label" placement="right" :show-after="300" :enterable="false">
                <span class="atp-item-label">{{ item.label }}</span>
              </el-tooltip>
              <button
                type="button"
                class="atp-item-close"
                title="取消任务"
                aria-label="取消任务"
                @click.stop="cancelActiveTask(item)"
              >
                <el-icon :size="12"><Close /></el-icon>
              </button>
            </div>
            <el-tooltip
              v-if="allActiveTaskItems.length > 8"
              :content="allActiveTaskItems.slice(8).map((t) => t.label).join('\n')"
              placement="right"
              :show-after="200"
            >
              <div class="atp-more">
                还有 {{ allActiveTaskItems.length - 8 }} 个任务...
              </div>
            </el-tooltip>
          </div>
        </template>
      </div>
    </nav>

    <main class="main">
      <!-- 角色/道具/场景上传图片用，单例放在外层避免 v-for 导致 ref 为数组 -->
      <input
        ref="resourceImageFileInput"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style="display: none"
        @change="onResourceImageFileChange"
      />
      <!-- 分镜图上传图片用，单例放在外层避免 v-for 导致 ref 为数组 -->
      <input
        ref="sbImageFileInput"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style="display: none"
        @change="onSbImageFileChange"
      />
      <!-- 剧本工作台：单卡片 + 选项卡（创作 / 选择） -->
      <section class="section card script-workbench-unified">
        <el-tabs v-model="scriptWorkbenchMode" class="script-workbench-tabs">
          <el-tab-pane label="创作剧本" name="create">
            <div class="script-pane-inner">
              <div class="script-sub-block">
                <h2 class="section-title">故事生成</h2>
                <p class="section-desc">输入一段故事梗概，AI 帮你扩写成完整剧本，或直接导入小说章节</p>
                <el-input
                  v-model="storyInput"
                  type="textarea"
                  :rows="4"
                  placeholder="例如：一个少女在森林里遇见会说话的狐狸，一起寻找失落的宝石..."
                  class="story-textarea"
                />
                <div class="row gap" style="margin-top: 10px; flex-wrap: wrap;">
                  <el-select v-model="storyStyle" placeholder="故事风格" clearable style="width: 120px" @change="() => saveProjectSettings(false)">
                    <el-option label="现代" value="modern" />
                    <el-option label="古风" value="ancient" />
                    <el-option label="奇幻" value="fantasy" />
                    <el-option label="日常" value="daily" />
                  </el-select>
                  <el-select v-model="storyType" placeholder="剧本类型" clearable style="width: 120px" @change="() => saveProjectSettings(false)">
                    <el-option label="剧情" value="drama" />
                    <el-option label="喜剧" value="comedy" />
                    <el-option label="冒险" value="adventure" />
                  </el-select>
                  <div style="display:flex;align-items:center;gap:6px;font-size:13px">
                    <span>集数</span>
                    <el-input-number
                      v-model="storyEpisodeCount"
                      :min="1"
                      :step="1"
                      :precision="0"
                      controls-position="right"
                      style="width: 100px"
                    />
                  </div>
                  <el-button type="primary" :loading="isStoryGenRunning" @click="onGenerateStory">
                    生成剧本
                  </el-button>
                  <el-button plain @click="showNovelImport = true">
                    <el-icon><DocumentAdd /></el-icon>
                    导入小说
                  </el-button>
                </div>
              </div>
              <div class="script-sub-divider" />
              <div id="anchor-script" class="script-sub-block">
                <h2 class="section-title">剧本</h2>
                <div class="row gap" style="margin-bottom: 10px; flex-wrap: wrap;">
                  <el-select
                    v-model="selectedEpisodeId"
                    placeholder="选择集数"
                    clearable
                    style="width: 130px"
                    :disabled="!dramaId"
                    @change="onEpisodeSelect"
                  >
                    <el-option
                      v-for="ep in (store.drama?.episodes || [])"
                      :key="ep.id"
                      :label="ep.title || '第' + (ep.episode_number || 0) + '集'"
                      :value="ep.id"
                    />
                  </el-select>
                  <el-input v-model="scriptTitle" placeholder="集标题" style="width: 150px" />
                  <el-button v-if="dramaId" style="margin-left: auto" @click="onAddEpisode">
                    <el-icon><Plus /></el-icon>添加一集
                  </el-button>
                </div>
                <el-input
                  v-model="scriptContent"
                  type="textarea"
                  :rows="8"
                  placeholder="剧本内容将显示在这里，可直接编辑..."
                  class="story-textarea"
                />
                <div class="row gap" style="margin-top: 8px; flex-wrap: wrap;">
                  <el-button
                    :loading="scriptGenerating"
                    :disabled="!!dramaId && (store.drama?.episodes?.length > 0) && !currentEpisodeId"
                    @click="onGenerateScript"
                  >
                    保存当前集
                  </el-button>
                </div>
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="选择剧本" name="select">
            <p class="section-desc script-mode-hint">
              从剧本库选择后，仅把「故事梗概」与「各集剧本正文」写入当前工程，不会导入角色、分镜、图片或视频。
            </p>
            <el-button type="primary" @click="openSelectScriptDialog">
              <el-icon><Document /></el-icon>
              从已有剧本中选择…
            </el-button>
            <div v-if="dramaId && (store.drama?.episodes?.length || storyInput)" class="script-preview-wrap">
              <h3 class="preview-block-title">故事梗概</h3>
              <el-input
                :model-value="storyInput"
                type="textarea"
                :rows="3"
                readonly
                class="story-textarea"
              />
              <template v-if="(store.drama?.episodes || []).length > 1">
                <h3 class="preview-block-title">分集剧本</h3>
                <el-tabs v-model="selectPreviewEpisodeId" class="preview-ep-tabs">
                  <el-tab-pane
                    v-for="ep in (store.drama?.episodes || [])"
                    :key="ep.id"
                    :label="ep.title || ('第' + (ep.episode_number || 0) + '集')"
                    :name="String(ep.id)"
                  >
                    <el-input
                      :model-value="ep.script_content || ''"
                      type="textarea"
                      :rows="12"
                      readonly
                      class="story-textarea"
                    />
                  </el-tab-pane>
                </el-tabs>
              </template>
              <template v-else>
                <h3 class="preview-block-title">剧本正文</h3>
                <el-input
                  :model-value="scriptContent"
                  type="textarea"
                  :rows="12"
                  readonly
                  class="story-textarea"
                />
              </template>
              <div class="preview-actions">
                <el-button type="primary" plain @click="scriptWorkbenchMode = 'create'">切换到创作剧本以编辑</el-button>
              </div>
            </div>
            <p v-else class="script-select-empty">尚未选择剧本，请点击上方按钮</p>
          </el-tab-pane>
        </el-tabs>
      </section>

      <el-dialog
        v-model="showSelectScriptDialog"
        title="从剧本库导入"
        width="640px"
        destroy-on-close
        @open="loadSelectScriptList"
      >
        <div v-loading="selectScriptLoading || selectScriptImporting" class="select-script-list">
          <div
            v-for="d in selectableScriptDramas"
            :key="d.id"
            class="select-script-item"
            :class="{ disabled: selectScriptImporting }"
            @click="!selectScriptImporting && onPickScriptFromDialog(d.id)"
          >
            <div class="select-script-title">{{ d.title || '未命名' }}</div>
            <div class="select-script-desc">{{ (d.description || '暂无简介').slice(0, 200) }}{{ (d.description && d.description.length > 200) ? '…' : '' }}</div>
          </div>
          <div v-if="!selectScriptLoading && selectScriptDramas.length === 0" class="select-script-empty">剧本库为空，请先在「剧本管理」创建剧本</div>
          <div v-else-if="!selectScriptLoading && selectableScriptDramas.length === 0" class="select-script-empty">没有可导入的其他剧本</div>
        </div>
      </el-dialog>

      <!-- 一键全流程生成 -->
      <section class="section card pipeline-section">
        <div class="one-click-actions">
          <span class="one-click-label">🚀 一键全流程</span>
          <el-select v-model="projectAspectRatio" style="width: 130px" @change="() => saveProjectSettings(false)">
            <el-option label="16:9 横屏" value="16:9" />
            <el-option label="9:16 竖屏" value="9:16" />
            <el-option label="3:4 竖版" value="3:4" />
            <el-option label="1:1 方形" value="1:1" />
            <el-option label="4:3" value="4:3" />
            <el-option label="21:9 宽银幕" value="21:9" />
          </el-select>
          <el-select v-model="videoClipDuration" style="width: 105px" @change="() => saveProjectSettings(false)">
            <el-option label="4秒/段" :value="4" />
            <el-option label="5秒/段" :value="5" />
            <el-option label="8秒/段" :value="8" />
            <el-option label="10秒/段" :value="10" />
            <el-option label="12秒/段" :value="12" />
            <el-option label="15秒/段" :value="15" />
          </el-select>
          <el-select
            v-model="defaultTextModel"
            style="width: 158px"
            @change="onDefaultTextModelChange"
          >
            <el-option
              v-for="opt in AGNES_TEXT_MODEL_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-select
            v-model="defaultImageModel"
            style="width: 168px"
            @change="onDefaultImageModelChange"
          >
            <el-option
              v-for="opt in AGNES_IMAGE_MODEL_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-select
            v-model="defaultVideoModel"
            style="width: 168px"
            @change="onDefaultVideoModelChange"
          >
            <el-option
              v-for="opt in AGNES_VIDEO_MODEL_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-select v-model="scriptLanguage" placeholder="分镜语言" clearable style="width: 105px">
            <el-option label="中文" value="zh" />
            <el-option label="英文" value="en" />
          </el-select>
          <StylePickerButton
            v-model="generationStyle"
            v-model:custom-prompt="customStylePrompt"
            :options="generationStyleOptions"
            @change="() => saveProjectSettings(true)"
          />
          <el-button
            type="primary"
            :loading="pipelineRunning && !pipelinePaused"
            :disabled="!currentEpisodeId || pipelineRunning"
            title="提取角色/场景/道具 → 分镜脚本 → 先配音 → 按配音补全生图/视频提示词 → 生图 → 生视频 → 合成整集（步骤 1–9）"
            @click="startOneClickPipeline"
          >
            一键成片带图片视频
          </el-button>
          <el-button
            :loading="pipelineRunning && !pipelinePaused"
            :disabled="!currentEpisodeId || pipelineRunning"
            title="提取→分镜脚本→先配音→按配音补全提示词→生图（步骤 1–7），不含分镜视频与成片"
            @click="startStoryboardScriptPipeline"
          >
            一键生成分镜脚本
          </el-button>
          <el-button
            :loading="pipelineRunning && !pipelinePaused"
            :disabled="!currentEpisodeId || pipelineRunning"
            title="仅提取角色、场景、道具与生成分镜文本，不生成图片与视频"
            @click="startTextFrameworkPipeline"
          >
            生成文本框架
          </el-button>
          <template v-if="pipelineRunning">
            <el-button v-if="!pipelinePaused" type="warning" @click="pipelinePaused = true">⏸ 暂停</el-button>
            <el-button v-else type="success" @click="onPipelineResume">▶ 继续</el-button>
          </template>
        </div>
        <div v-if="pipelineRunning || pipelineErrorLog.length > 0" class="pipeline-status">
          <div v-if="pipelineCurrentStep" class="pipeline-current-step">
            <span v-if="pipelineStepIndex > 0" class="pipeline-step-badge">{{ pipelineStepIndex }}/{{ pipelineStepTotal }}</span>
            {{ pipelineCurrentStep.replace(/^\[步骤 \d+\/\d+\] /, '') }}
          </div>
          <!-- 阶段间倒计时 -->
          <div v-if="pipelineCountdown > 0" class="pipeline-countdown">
            <div class="pipeline-countdown-ring">
              <span class="pipeline-countdown-num">{{ pipelineCountdown }}</span>
              <span class="pipeline-countdown-unit">秒</span>
            </div>
            <div class="pipeline-countdown-body">
              <p class="pipeline-countdown-msg">{{ pipelineCountdownMsg }}</p>
              <div class="pipeline-countdown-actions">
                <el-button size="small" type="success" @click="skipPipelineCountdown">⚡ 立即开始下一阶段</el-button>
                <el-button v-if="!pipelinePaused" size="small" type="warning" @click="pipelinePaused = true">⏸ 暂停倒计时</el-button>
                <span v-else class="pipeline-countdown-paused">已暂停 — 点击右上角"继续"恢复</span>
              </div>
            </div>
          </div>
          <div v-if="pipelineActiveTasks.size > 0" class="pipeline-active-tasks">
            <span
              v-for="label in Array.from(pipelineActiveTasks)"
              :key="label"
              class="pipeline-task-chip"
            >
              <span class="pipeline-task-dot" />{{ label }}
            </span>
          </div>
          <div v-if="pipelineErrorLog.length > 0" class="pipeline-error-log">
            <div class="pipeline-error-title">执行过程中的错误：</div>
            <div v-for="(entry, idx) in pipelineErrorLog" :key="idx" class="pipeline-error-line">
              [{{ entry.step }}] {{ entry.message }}
            </div>
          </div>
        </div>
      </section>

      <!-- 资源管理：角色 / 道具 / 场景 -->
      <section class="section card resource-panel">
        <div class="collapse-header" @click="resourcePanelCollapsed = !resourcePanelCollapsed">
          <h2 class="section-title">资源管理</h2>
          <el-icon class="collapse-icon"><ArrowUp v-if="!resourcePanelCollapsed" /><ArrowDown v-else /></el-icon>
        </div>
        <div v-show="!resourcePanelCollapsed" class="resource-panel-body">
          <div class="resource-pack-actions">
            <el-button
              size="small"
              plain
              type="primary"
              :loading="assetPackDownloading"
              :disabled="!assetPackImageCount"
              title="按顺序下载角色→场景→道具全部参考图"
              @click="downloadAllAssetImages"
            >
              {{ assetPackDownloading ? '下载中…' : `下载分图 (${assetPackImageCount})` }}
            </el-button>
          </div>
          <!-- 角色生成 -->
          <div id="anchor-characters" class="resource-block card">
            <div class="collapse-header resource-block-header" @click="charactersBlockCollapsed = !charactersBlockCollapsed">
              <h3 class="resource-block-title">角色生成</h3>
              <el-icon class="collapse-icon"><ArrowUp v-if="!charactersBlockCollapsed" /><ArrowDown v-else /></el-icon>
            </div>
            <div v-show="!charactersBlockCollapsed" class="resource-block-body">
              <div class="asset-actions">
                <el-button type="primary" size="small" :loading="charactersGenerating" :disabled="!dramaId" @click="onGenerateCharacters">
                  剧本自动提取角色
                </el-button>
                <el-button size="small" :disabled="!dramaId" @click="openAddCharacter">添加角色</el-button>
                <el-button size="small" @click="showCharLibrary = true">本剧角色库</el-button>
                <el-button
                  size="small"
                  type="success"
                  plain
                  :loading="batchGeneratingCharImages"
                  :disabled="!characters.length || batchGeneratingCharImages"
                  title="为缺图角色批量生成配图；若均已有图可选择全部重生成"
                  @click="onBatchGenerateCharacterImages"
                >
                  一键生成配图{{ batchCharImageProgress.total ? ` (${batchCharImageProgress.current}/${batchCharImageProgress.total})` : '' }}
                </el-button>
                <el-button size="small" :disabled="!characters.length" @click="copyAllCharDescriptions(characters)">一键复制全部描述词</el-button>
              </div>
              <div class="asset-list asset-list-two">
                <div v-for="char in characters" :key="char.id" class="asset-item asset-item-left-right">
                  <div class="asset-info">
                    <div class="asset-name">
                      <span style="display:inline-flex;align-items:center;gap:4px;flex:1;min-width:0;overflow:hidden">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ char.name }}</span>
                        <el-tag v-if="char.role" size="small" effect="plain" :type="char.role === 'main' ? 'danger' : char.role === 'supporting' ? 'warning' : 'info'" style="flex-shrink:0;padding:0 5px;font-size:11px;height:18px;line-height:18px">{{ charRoleLabel(char.role) }}</el-tag>
                      </span>
                      <el-button type="danger" text size="small" class="btn-delete-icon" title="删除" @click="onDeleteCharacter(char)">
                        <el-icon><Delete /></el-icon>
                      </el-button>
                    </div>
                    <div class="asset-desc-full">{{ char.appearance || char.description || '暂无描述' }}</div>
                    <div class="asset-desc-actions">
                      <el-button size="small" :disabled="!charDescription(char)" title="复制角色描述词" @click="copyCharDescription(char)">复制描述词</el-button>
                    </div>
                    <div class="asset-btns">
                      <el-button size="small" @click="editCharacter(char)">编辑</el-button>
                      <el-button size="small" :loading="addingCharToLibraryId === char.id" :disabled="!hasAssetImage(char)" @click="onAddCharacterToLibrary(char)">
                        加入本剧库
                      </el-button>
                      <el-button size="small" :loading="addingCharToMaterialId === char.id" :disabled="!hasAssetImage(char)" @click="onAddCharacterToMaterialLibrary(char)">
                        加入素材库
                      </el-button><el-button
                        size="small"
                        :type="char.seedance2_asset?.status === 'active' ? 'success' : 'warning'"
                        plain
                        :loading="sd2CertifyingId === char.id"
                        :disabled="!hasAssetImage(char)"
                        @click="onSd2PrimaryAction(char)"
                      >
                        {{ sd2ActionLabel(char) }}
                      </el-button>
                    </div>

                    <!-- Seedance 2.0 音色参考（仅该模型有效，其他模型不生效） -->
                    <div class="sd2-voice-row" style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <template v-if="char.seedance2_voice_asset?.status === 'active'">
                        <!-- 音色参考已设置：显示试听 + 更换 -->
                        <el-button
                          size="small"
                          type="success"
                          plain
                          @click="playSd2Voice(char)"
                        >
                          <el-icon><VideoPlay /></el-icon>
                          <span style="margin-left:4px">试听</span>
                        </el-button>
                        <el-button
                          size="small"
                          type="primary"
                          plain
                          :loading="sd2VoiceUploadingId === char.id"
                          @click="onSd2VoiceReplace(char)"
                        >
                          更换
                        </el-button>
                        <span style="font-size:11px;color:#67c23a">音色已设置</span>
                      </template>
                      <template v-else>
                        <el-button
                          size="small"
                          :type="char.seedance2_voice_asset?.status === 'stale' ? 'warning' : 'info'"
                          plain
                          :loading="sd2VoiceUploadingId === char.id"
                          @click="onSd2VoicePrimaryAction(char)"
                        >
                          {{ sd2VoiceActionLabel(char) }}
                        </el-button>
                        <span v-if="char.seedance2_voice_asset?.status === 'stale'" style="font-size:11px;color:#e6a23c">需刷新</span>
                      </template>
                      <span style="font-size:10px;color:#909399">仅 Seedance 2.0 模型生效</span>
                    </div>
                    <div v-if="getCharAffectedStoryboards(char.id).length" class="asset-storyboard-link">
                      <span class="asl-label">影响的分镜：</span>
                      <span
                        v-for="sb in getCharAffectedStoryboards(char.id)"
                        :key="sb.id"
                        class="asl-chip"
                        title="点击跳转到该分镜"
                        @click="scrollToStoryboard(sb.id)"
                      >#{{ sb.storyboard_number }}</span>
                      <span v-if="regenSbImagesForAsset.has('char-' + char.id) && regenSbImagesProgress['char-' + char.id]" class="asl-progress">
                        {{ regenSbImagesProgress['char-' + char.id].current }}/{{ regenSbImagesProgress['char-' + char.id].total }}
                      </span>
                      <el-button
                        size="small"
                        class="asl-regen-btn"
                        :loading="regenSbImagesForAsset.has('char-' + char.id)"
                        @click="onRegenAffectedSbImages('char-' + char.id, getCharAffectedStoryboards(char.id))"
                      >
                        <span v-if="!regenSbImagesForAsset.has('char-' + char.id)">↻ 重新生成分镜图</span>
                      </el-button>
                    </div>
                  </div>
                  <div class="asset-cover-wrap">
                    <div
                      class="asset-cover"
                      :class="{ 'asset-cover--clickable': hasAssetImage(char), 'asset-cover--dragover': dragOverResourceKey === 'char-' + char.id }"
                      role="button"
                      tabindex="0"
                      @click="hasAssetImage(char) && openImagePreview(assetImageUrl(char))"
                      @dragover="onResourceDragOver($event, 'character', char.id)"
                      @dragleave="onResourceDragLeave($event, 'char-' + char.id)"
                      @drop="onResourceDrop($event, 'character', char.id)"
                    >
                      <img v-if="hasAssetImage(char)" :src="assetImageUrl(char)" class="cover-img" alt="" />
                      <div v-else-if="char.error_msg || char.errorMsg" class="cover-placeholder error" :title="char.error_msg || char.errorMsg">{{ char.error_msg || char.errorMsg }}</div>
                      <div v-else class="cover-placeholder">暂无图</div>
                      <div v-if="dragOverResourceKey === 'char-' + char.id" class="asset-cover-drop-hint">松开上传</div>
                    </div>
                    <!-- 额外参考图条 -->
                    <div v-if="parseExtraImages(char).length" class="extra-images-strip">
                      <div v-for="ep in parseExtraImages(char)" :key="ep" class="extra-thumb" :title="'点击设为主图（悬停左上角可放大预览）'">
                        <img :src="localPathToUrl(ep)" alt="" @click="onSetPrimaryImage('character', char, ep)" />
                        <button class="thumb-preview-btn" title="放大预览" @click.stop="openImagePreview(localPathToUrl(ep))">
                          <el-icon :size="10"><ZoomIn /></el-icon>
                        </button>
                        <button class="extra-thumb-remove" title="移除" @click.stop="onRemoveExtraImage('character', char, ep)">×</button>
                      </div>
                    </div>
                    <div class="asset-cover-actions">
                      <el-button type="primary" size="small" :loading="generatingCharIds.has(char.id)" @click="onGenerateCharacterImage(char)">
                        <el-icon v-if="!generatingCharIds.has(char.id)"><MagicStick /></el-icon>
                        AI 生成
                      </el-button>
                      <el-button type="success" size="small" :loading="uploadingResourceId === 'char-' + char.id" @click="onUploadResourceClick('character', char.id)">
                        <el-icon v-if="uploadingResourceId !== 'char-' + char.id"><Upload /></el-icon>
                        上传
                      </el-button>
                    </div>
                    <div class="asset-cover-actions asset-cover-actions--secondary">
                      <el-button size="small" :disabled="!hasAssetImage(char)" title="复制角色图片到剪贴板" @click="copyCharImage(char)">复制图片</el-button>
                      <el-button size="small" :loading="uploadingResourceId === 'char-' + char.id" title="从剪贴板粘贴图片到本角色" @click="onPasteResourceImage('character', char.id)">粘贴图片</el-button>
                    </div>
                  </div>
                </div>
                <div v-if="characters.length === 0" class="empty-tip">暂无角色，请先「AI 生成角色」或在上一步保存剧本后提取</div>
              </div>
            </div>
          </div>

          <!-- 道具生成 -->
          <div id="anchor-props" class="resource-block card">
            <div class="collapse-header resource-block-header" @click="propsBlockCollapsed = !propsBlockCollapsed">
              <h3 class="resource-block-title">道具生成</h3>
              <el-icon class="collapse-icon"><ArrowUp v-if="!propsBlockCollapsed" /><ArrowDown v-else /></el-icon>
            </div>
            <div v-show="!propsBlockCollapsed" class="resource-block-body">
              <div class="asset-actions">
                <el-button type="primary" size="small" :loading="propsExtracting" :disabled="!currentEpisodeId" @click="onExtractProps">从剧本提取道具</el-button>
                <el-button size="small" :disabled="!dramaId" @click="showAddProp = true">添加道具</el-button>
                <el-button size="small" @click="showPropLibrary = true">本剧道具库</el-button>
                <el-button
                  size="small"
                  type="success"
                  plain
                  :loading="batchGeneratingPropImages"
                  :disabled="!props.length || batchGeneratingPropImages"
                  title="为缺图道具批量生成配图；若均已有图可选择全部重生成"
                  @click="onBatchGeneratePropImages"
                >
                  一键生成配图{{ batchPropImageProgress.total ? ` (${batchPropImageProgress.current}/${batchPropImageProgress.total})` : '' }}
                </el-button>
                <el-button size="small" :disabled="!props.length" @click="copyAllPropDescriptions(props)">一键复制全部描述词</el-button>
              </div>
              <div class="prop-gen-mode" style="margin: 8px 0; font-size: 13px;">
                <el-checkbox v-model="propUseQuadGrid">生成四视图道具（默认单图，纯色无缝背景）</el-checkbox>
              </div>
              <div class="asset-list asset-list-two">
                <div v-for="prop in props" :key="prop.id" class="asset-item asset-item-left-right">
                  <div class="asset-info">
                    <div class="asset-name">
                      <span>{{ prop.name }}</span>
                      <el-tag v-if="prop.bound_from_other_episode" size="small" type="info" effect="plain" style="margin-left:6px;">跨集绑定</el-tag>
                      <el-button type="danger" text size="small" class="btn-delete-icon" :title="prop.bound_from_other_episode ? '从本集解绑' : '删除'" @click="onDeleteProp(prop)">
                        <el-icon><Delete /></el-icon>
                      </el-button>
                    </div>
                    <div class="asset-desc-full">{{ prop.description || prop.prompt || '暂无描述' }}</div>
                    <div class="asset-desc-actions">
                      <el-button size="small" :disabled="!propDescription(prop)" title="复制道具描述词" @click="copyPropDescription(prop)">复制描述词</el-button>
                    </div>
                    <div class="asset-btns">
                      <el-button size="small" @click="editProp(prop)">编辑</el-button>
                      <el-button size="small" :loading="addingPropToLibraryId === prop.id" :disabled="!hasAssetImage(prop)" @click="onAddPropToLibrary(prop)">
                        加入本剧库
                      </el-button>
                      <el-button size="small" :loading="addingPropToMaterialId === prop.id" :disabled="!hasAssetImage(prop)" @click="onAddPropToMaterialLibrary(prop)">
                        加入素材库
                      </el-button></div>
                    <div v-if="getPropAffectedStoryboards(prop.id).length" class="asset-storyboard-link">
                      <span class="asl-label">影响的分镜：</span>
                      <span
                        v-for="sb in getPropAffectedStoryboards(prop.id)"
                        :key="sb.id"
                        class="asl-chip"
                        title="点击跳转到该分镜"
                        @click="scrollToStoryboard(sb.id)"
                      >#{{ sb.storyboard_number }}</span>
                      <span v-if="regenSbImagesForAsset.has('prop-' + prop.id) && regenSbImagesProgress['prop-' + prop.id]" class="asl-progress">
                        {{ regenSbImagesProgress['prop-' + prop.id].current }}/{{ regenSbImagesProgress['prop-' + prop.id].total }}
                      </span>
                      <el-button
                        size="small"
                        class="asl-regen-btn"
                        :loading="regenSbImagesForAsset.has('prop-' + prop.id)"
                        @click="onRegenAffectedSbImages('prop-' + prop.id, getPropAffectedStoryboards(prop.id))"
                      >
                        <span v-if="!regenSbImagesForAsset.has('prop-' + prop.id)">↻ 重新生成分镜图</span>
                      </el-button>
                    </div>
                  </div>
                  <div class="asset-cover-wrap">
                    <div
                      class="asset-cover"
                      :class="{ 'asset-cover--clickable': hasAssetImage(prop), 'asset-cover--dragover': dragOverResourceKey === 'prop-' + prop.id }"
                      role="button"
                      tabindex="0"
                      @click="hasAssetImage(prop) && openImagePreview(assetImageUrl(prop))"
                      @dragover="onResourceDragOver($event, 'prop', prop.id)"
                      @dragleave="onResourceDragLeave($event, 'prop-' + prop.id)"
                      @drop="onResourceDrop($event, 'prop', prop.id)"
                    >
                      <img v-if="hasAssetImage(prop)" :src="assetImageUrl(prop)" class="cover-img" alt="" />
                      <div v-else-if="prop.error_msg || prop.errorMsg" class="cover-placeholder error" :title="prop.error_msg || prop.errorMsg">{{ prop.error_msg || prop.errorMsg }}</div>
                      <div v-else class="cover-placeholder">暂无图</div>
                      <div v-if="dragOverResourceKey === 'prop-' + prop.id" class="asset-cover-drop-hint">松开上传</div>
                    </div>
                    <div v-if="parseExtraImages(prop).length" class="extra-images-strip">
                      <div v-for="ep in parseExtraImages(prop)" :key="ep" class="extra-thumb" title="点击设为主图（悬停左上角可放大预览）">
                        <img :src="localPathToUrl(ep)" alt="" @click="onSetPrimaryImage('prop', prop, ep)" />
                        <button class="thumb-preview-btn" title="放大预览" @click.stop="openImagePreview(localPathToUrl(ep))">
                          <el-icon :size="10"><ZoomIn /></el-icon>
                        </button>
                        <button class="extra-thumb-remove" title="移除" @click.stop="onRemoveExtraImage('prop', prop, ep)">×</button>
                      </div>
                    </div>
                    <div class="asset-cover-actions">
                      <el-tooltip :content="propUseQuadGrid ? '四视图道具（前/侧/后/顶，纯色无缝背景）' : '单图道具（纯色无缝背景）'" placement="top">
                        <el-button type="primary" size="small" :loading="generatingPropIds.has(prop.id)" @click="onGeneratePropImage(prop, propUseQuadGrid)">
                          <el-icon v-if="!generatingPropIds.has(prop.id)"><MagicStick /></el-icon>
                          AI 生成
                        </el-button>
                      </el-tooltip>
                      <el-button type="success" size="small" :loading="uploadingResourceId === 'prop-' + prop.id" @click="onUploadResourceClick('prop', prop.id)">
                        <el-icon v-if="uploadingResourceId !== 'prop-' + prop.id"><Upload /></el-icon>
                        上传
                      </el-button>
                    </div>
                    <div class="asset-cover-actions asset-cover-actions--secondary">
                      <el-button size="small" :disabled="!hasAssetImage(prop)" title="复制道具图片到剪贴板" @click="copyPropImage(prop)">复制图片</el-button>
                      <el-button size="small" :loading="uploadingResourceId === 'prop-' + prop.id" title="从剪贴板粘贴图片到本道具" @click="onPasteResourceImage('prop', prop.id)">粘贴图片</el-button>
                    </div>
                  </div>
                </div>
                <div v-if="props.length === 0" class="empty-tip">暂无道具，可从剧本提取或添加</div>
              </div>
            </div>
          </div>

          <!-- 场景生成 -->
          <div id="anchor-scenes" class="resource-block card">
            <div class="collapse-header resource-block-header" @click="scenesBlockCollapsed = !scenesBlockCollapsed">
              <h3 class="resource-block-title">场景生成</h3>
              <el-icon class="collapse-icon"><ArrowUp v-if="!scenesBlockCollapsed" /><ArrowDown v-else /></el-icon>
            </div>
            <div v-show="!scenesBlockCollapsed" class="resource-block-body">
              <div class="asset-actions">
                <el-button type="primary" size="small" :loading="scenesExtracting" :disabled="!currentEpisodeId" @click="onExtractScenes">
                  从剧本提取场景
                </el-button>
                <el-button size="small" :disabled="!dramaId" @click="openAddScene">添加场景</el-button>
                <el-button size="small" @click="showSceneLibrary = true">本剧场景库</el-button>
                <el-button
                  size="small"
                  type="success"
                  plain
                  :loading="batchGeneratingSceneImages"
                  :disabled="!scenes.length || batchGeneratingSceneImages"
                  title="为缺图场景批量生成配图；若均已有图可选择全部重生成"
                  @click="onBatchGenerateSceneImages"
                >
                  一键生成配图{{ batchSceneImageProgress.total ? ` (${batchSceneImageProgress.current}/${batchSceneImageProgress.total})` : '' }}
                </el-button>
                <el-button size="small" :disabled="!scenes.length" @click="copyAllSceneDescriptions(scenes)">一键复制全部描述词</el-button>
              </div>
              <div class="scene-gen-mode" style="margin: 8px 0; font-size: 13px;">
                <el-checkbox v-model="sceneUseQuadGrid">生成四宫格场景（默认单图）</el-checkbox>
              </div>
              <div class="asset-list asset-list-two">
                <div v-for="scene in scenes" :key="scene.id" class="asset-item asset-item-left-right">
                  <div class="asset-info">
                    <div class="asset-name">
                      <span>{{ scene.location }}</span>
                      <el-tag v-if="scene.bound_from_other_episode" size="small" type="info" effect="plain" style="margin-left:6px;">跨集绑定</el-tag>
                      <el-button type="danger" text size="small" class="btn-delete-icon" :title="scene.bound_from_other_episode ? '从本集解绑' : '删除'" @click="onDeleteScene(scene)">
                        <el-icon><Delete /></el-icon>
                      </el-button>
                    </div>
                    <div class="asset-desc-full">{{ scene.description || scene.prompt || scene.time || '暂无描述' }}</div>
                    <div class="asset-desc-actions">
                      <el-button size="small" :disabled="!sceneDescription(scene)" title="复制场景描述词" @click="copySceneDescription(scene)">复制描述词</el-button>
                    </div>
                    <div class="asset-btns">
                      <el-button size="small" @click="editScene(scene)">编辑</el-button>
                      <el-button size="small" :loading="addingSceneToLibraryId === scene.id" :disabled="!hasAssetImage(scene)" @click="onAddSceneToLibrary(scene)">
                        加入本剧库
                      </el-button>
                      <el-button size="small" :loading="addingSceneToMaterialId === scene.id" :disabled="!hasAssetImage(scene)" @click="onAddSceneToMaterialLibrary(scene)">
                        加入素材库
                      </el-button></div>
                    <div v-if="getSceneAffectedStoryboards(scene.id).length" class="asset-storyboard-link">
                      <span class="asl-label">影响的分镜：</span>
                      <span
                        v-for="sb in getSceneAffectedStoryboards(scene.id)"
                        :key="sb.id"
                        class="asl-chip"
                        title="点击跳转到该分镜"
                        @click="scrollToStoryboard(sb.id)"
                      >#{{ sb.storyboard_number }}</span>
                      <span v-if="regenSbImagesForAsset.has('scene-' + scene.id) && regenSbImagesProgress['scene-' + scene.id]" class="asl-progress">
                        {{ regenSbImagesProgress['scene-' + scene.id].current }}/{{ regenSbImagesProgress['scene-' + scene.id].total }}
                      </span>
                      <el-button
                        size="small"
                        class="asl-regen-btn"
                        :loading="regenSbImagesForAsset.has('scene-' + scene.id)"
                        @click="onRegenAffectedSbImages('scene-' + scene.id, getSceneAffectedStoryboards(scene.id))"
                      >
                        <span v-if="!regenSbImagesForAsset.has('scene-' + scene.id)">↻ 重新生成分镜图</span>
                      </el-button>
                    </div>
                  </div>
                  <div class="asset-cover-wrap">
                    <div
                      class="asset-cover"
                      :class="{ 'asset-cover--clickable': hasAssetImage(scene), 'asset-cover--dragover': dragOverResourceKey === 'scene-' + scene.id }"
                      role="button"
                      tabindex="0"
                      @click="hasAssetImage(scene) && openImagePreview(assetImageUrl(scene))"
                      @dragover="onResourceDragOver($event, 'scene', scene.id)"
                      @dragleave="onResourceDragLeave($event, 'scene-' + scene.id)"
                      @drop="onResourceDrop($event, 'scene', scene.id)"
                    >
                      <img v-if="hasAssetImage(scene)" :src="assetImageUrl(scene)" class="cover-img" alt="" />
                      <div v-else-if="scene.error_msg || scene.errorMsg" class="cover-placeholder error" :title="scene.error_msg || scene.errorMsg">{{ scene.error_msg || scene.errorMsg }}</div>
                      <div v-else class="cover-placeholder">暂无图</div>
                      <div v-if="dragOverResourceKey === 'scene-' + scene.id" class="asset-cover-drop-hint">松开上传</div>
                    </div>
                    <div v-if="parseExtraImages(scene).length" class="extra-images-strip">
                      <div v-for="ep in parseExtraImages(scene)" :key="ep" class="extra-thumb" title="点击设为主图（悬停左上角可放大预览）">
                        <img :src="localPathToUrl(ep)" alt="" @click="onSetPrimaryImage('scene', scene, ep)" />
                        <button class="thumb-preview-btn" title="放大预览" @click.stop="openImagePreview(localPathToUrl(ep))">
                          <el-icon :size="10"><ZoomIn /></el-icon>
                        </button>
                        <button class="extra-thumb-remove" title="移除" @click.stop="onRemoveExtraImage('scene', scene, ep)">×</button>
                      </div>
                    </div>
                    <div class="asset-cover-actions">
                      <el-tooltip :content="sceneUseQuadGrid ? '四宫格场景（正/侧/俯/仰）' : '单图场景'" placement="top">
                        <el-button type="primary" size="small" :loading="generatingSceneIds.has(scene.id)" @click="onGenerateSceneImage(scene, sceneUseQuadGrid)">
                          <el-icon v-if="!generatingSceneIds.has(scene.id)"><MagicStick /></el-icon>
                          AI 生成
                        </el-button>
                      </el-tooltip>
                      <el-button type="success" size="small" :loading="uploadingResourceId === 'scene-' + scene.id" @click="onUploadResourceClick('scene', scene.id)">
                        <el-icon v-if="uploadingResourceId !== 'scene-' + scene.id"><Upload /></el-icon>
                        上传
                      </el-button>
                    </div>
                    <div class="asset-cover-actions asset-cover-actions--secondary">
                      <el-button size="small" :disabled="!hasAssetImage(scene)" title="复制场景图片到剪贴板" @click="copySceneImage(scene)">复制图片</el-button>
                      <el-button size="small" :loading="uploadingResourceId === 'scene-' + scene.id" title="从剪贴板粘贴图片到本场景" @click="onPasteResourceImage('scene', scene.id)">粘贴图片</el-button>
                    </div>
                  </div>
                </div>
                <div v-if="scenes.length === 0" class="empty-tip">暂无场景，请从剧本提取</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 6. 分镜生成 -->
      <section id="anchor-storyboard" class="section card">
        <h2 class="section-title">
          <span>5. 分镜生成</span>
          <span class="step-desc">根据剧本、角色、场景自动生成分镜头脚本</span>
        </h2>
        <div class="sb-limit-toolbar">
          <el-button type="warning" size="small" @click="onClearStoryboardLimits">
            清空镜数/时长约束
          </el-button>
          <span class="sb-limit-status" :class="{ 'sb-limit-status--cleared': storyboardLimitJustCleared }">{{ storyboardLimitStatusLabel }}</span>
        </div>
        <div class="sb-config-row">
          <label class="sb-config-item">
            <span class="sb-config-label">分镜数量</span>
            <el-input
              :key="'sb-count-' + storyboardLimitInputsKey"
              v-model="storyboardCountInput"
              clearable
              placeholder="自动"
              class="sb-config-input"
              inputmode="numeric"
              @clear="onClearStoryboardCountInput"
              @blur="normalizeStoryboardCountInput"
            />
            <span class="sb-config-hint">
              留空由 AI 按情节决定
              <el-tooltip v-if="scriptEstimateStoryboardHint" :content="scriptEstimateStoryboardTitle" placement="top">
                <span class="sb-estimate-tag">字数参考{{ scriptEstimateStoryboardHint }}</span>
              </el-tooltip>
            </span>
          </label>
          <span class="sb-config-divider">｜</span>
          <label class="sb-config-item">
            <span class="sb-config-label">视频总时长(秒)</span>
            <el-input
              :key="'sb-dur-' + storyboardLimitInputsKey"
              v-model="videoDurationInput"
              clearable
              placeholder="自动"
              class="sb-config-input"
              inputmode="numeric"
              @clear="onClearVideoDurationInput"
              @blur="normalizeVideoDurationInput"
            />
            <span class="sb-config-hint">
              留空由 AI 按情节决定
              <el-tooltip v-if="scriptEstimateVideoDurationHint" :content="scriptEstimateVideoDurationTitle" placement="top">
                <span class="sb-estimate-tag">字数参考{{ scriptEstimateVideoDurationHint }}</span>
              </el-tooltip>
            </span>
          </label>
          <span class="sb-config-divider">｜</span>
          <label class="sb-config-item">
            <span class="sb-config-label">序列图模式</span>
            <el-select v-model="gridMode" size="small" style="width:110px" :disabled="storyboardUseFirstLastFrame">
              <el-option label="单张" value="single" />
              <el-option label="四宫格" value="quad_grid" />
              <el-option label="九宫格" value="nine_grid" />
            </el-select>
            <span class="sb-config-hint">四/九宫格自动按视角拆分</span>
          </label>
        </div>
        <div class="sb-config-row sb-narration-export-row">
          <el-checkbox v-model="storyboardUseFirstLastFrame" @change="onStoryboardUseFirstLastFrameChange">
            首尾帧参考图（经典模式：本镜图为首帧；未单独生成尾帧时，自动用「下一镜」分镜图作尾帧）
          </el-checkbox>
          <el-checkbox v-model="storyboardUniversalOmni" @change="() => saveProjectSettings(false)">
            全能分镜模式（每镜输出多子分镜段落式 universal_segment_text，与「生成/润色全能提示词」同版式）
          </el-checkbox>
          <el-checkbox v-model="storyboardIncludeNarration" @change="onStoryboardIncludeNarrationChange">
            生成分镜时生成解说旁白（narration，与对白分开，便于后期 TTS）
          </el-checkbox>
          <el-checkbox
            v-model="storyboardFullNarrationVideoMode"
            :disabled="!storyboardIncludeNarration"
            @change="onStoryboardFullNarrationModeChange"
          >
            全文解说旁白视频模式（分镜按剧本原文逐字拆段，旁白不缩写）
          </el-checkbox>
        </div>
        <div v-if="storyboardIncludeNarration" class="sb-dubbing-block">
          <template v-if="storyboardFullNarrationVideoMode">
            <p class="sb-full-narration-hint">
              全文解说（经典 / 全能统一）：旁白从<strong>第 1 镜</strong>起以<strong>。</strong>切句，连续多句合并为一镜（合计不超过约 <strong>12 秒</strong>，无句数上限）；再加下一句会超限则新开一镜。修改规则后请点「重新同步旁白分段」。
            </p>
            <div class="sb-full-narration-speed-row">
              <span class="sb-full-narration-speed-label">朗读语速</span>
              <el-select v-model="narrationCharsPerSec" size="small" style="width: 120px" @change="onNarrationCharsPerSecChange">
                <el-option v-for="opt in narrationCharsPerSecOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
              <span class="sb-full-narration-speed-hint">
                当前 {{ narrationCharsPerSec }} 字/秒 → 以。切句，连续合并至单镜硬上限 {{ fullNarrationMaxChars }} 字（≈12 秒）。修改语速后请点「重新同步旁白分段」生效。
              </span>
            </div>
          </template>

          <div class="sb-dubbing-config">
            <div class="sb-dubbing-config-head">
              <span class="sb-dubbing-config-title">旁白配音配置</span>
              <el-tag v-if="indexttsModelLoaded" type="success" size="small">模型已加载</el-tag>
              <el-tag v-else-if="indexttsInstallOk" type="info" size="small">模型未加载</el-tag>
              <el-tag v-else type="warning" size="small">IndexTTS2 未就绪</el-tag>
              <el-button
                size="small"
                type="primary"
                :loading="indexttsLoading"
                :disabled="indexttsModelLoaded || !videoIndexTtsNarration"
                @click="onLoadIndexTtsModel"
              >
                加载模型
              </el-button>
              <el-button
                size="small"
                plain
                type="danger"
                :loading="indexttsUnloading"
                :disabled="!indexttsModelLoaded"
                @click="onUnloadIndexTtsModel"
              >
                卸载模型
              </el-button>
            </div>
            <div class="indextts-controls">
              <el-form-item label="IndexTTS 旁白" class="indextts-main-item">
                <div class="video-option-row">
                  <el-switch v-model="videoIndexTtsNarration" />
                  <span v-if="videoIndexTtsNarration" class="video-option-hint">
                    开启后使用 IndexTTS2 克隆音色生成旁白；合成整集时可逐句烧录字幕。需本机已安装 IndexTTS2（默认路径 C:/my/index-tts/index-tts）。
                  </span>
                </div>
              </el-form-item>
              <template v-if="videoIndexTtsNarration">
                <el-form-item label="克隆音色">
                  <div class="sb-voice-select-row">
                    <el-select
                      v-model="indexttsVoiceId"
                      placeholder="选择克隆音色"
                      style="width: 280px"
                      filterable
                      :disabled="!gsvCatalogVoices.length"
                    >
                      <el-option
                        v-for="v in gsvCatalogVoices"
                        :key="v.voice_id"
                        :label="v.voice_name"
                        :value="v.voice_id"
                      >
                        <span>{{ v.voice_name }}</span>
                        <span class="sb-voice-option-id">{{ v.voice_id }}</span>
                      </el-option>
                    </el-select>
                    <el-button size="small" :loading="gsvPreviewing" :disabled="!indexttsVoiceId" @click="onPreviewIndexTtsVoice">试听</el-button>
                    <el-button size="small" :disabled="!selectedGsvVoice" @click="editGsvVoice(selectedGsvVoice)">编辑</el-button>
                    <el-button size="small" type="danger" plain :disabled="!selectedGsvVoice" @click="deleteGsvVoice(selectedGsvVoice)">删除</el-button>
                    <el-button size="small" @click="openGsvAddPanel">添加音色</el-button>
                  </div>
                  <span v-if="!gsvCatalogVoices.length" class="video-option-hint">暂无克隆音色，请先添加。</span>
                </el-form-item>
                <el-form-item label="情感指令">
                  <el-input
                    v-model="indexttsEmotionText"
                    placeholder="自然流畅的解说语气，情绪饱满"
                    maxlength="500"
                    show-word-limit
                    clearable
                    class="indextts-emotion-input"
                  />
                </el-form-item>
                <el-form-item label="配音速度">
                  <el-select v-model="indexttsSpeed" placeholder="语速" style="width: 120px">
                    <el-option v-for="opt in indexttsSpeedOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
                  </el-select>
                  <span class="video-option-hint">生成旁白配音时的语速，默认 1.1 倍</span>
                </el-form-item>
              </template>
            </div>

            <div v-if="videoIndexTtsNarration && gsvPanelOpen" class="indextts-clone-panel">
              <div class="indextts-clone-head">
                <strong>{{ gsvEditingId ? '编辑克隆音色' : '添加克隆音色' }}</strong>
                <el-button size="small" link @click="closeGsvPanel">收起</el-button>
              </div>
              <p class="indextts-clone-tip">上传 5～15 秒参考音 + 与音频逐字一致的参考文本；保存后可在上方下拉中选择。</p>
              <div class="indextts-clone-form">
                <el-form-item label="音色 ID">
                  <el-input v-model="gsvForm.voice_id" placeholder="如 008 或 narrator-male" :disabled="!!gsvEditingId" />
                </el-form-item>
                <el-form-item label="显示名">
                  <el-input v-model="gsvForm.voice_name" placeholder="如 云希 / 男声旁白" />
                </el-form-item>
                <el-form-item label="参考音频">
                  <input type="file" accept="audio/*" @change="onGsvFilePick" />
                  <span v-if="gsvForm.ref_audio_path" class="indextts-ref-path">{{ gsvForm.ref_audio_path }}</span>
                </el-form-item>
                <el-form-item label="参考文本">
                  <el-input v-model="gsvForm.prompt_text" type="textarea" :rows="2" placeholder="与参考音频逐字一致" />
                </el-form-item>
                <div class="indextts-clone-actions">
                  <el-button type="primary" size="small" :loading="gsvSaving" @click="saveGsvVoice">保存音色</el-button>
                  <el-button v-if="gsvEditingId" size="small" @click="resetGsvForm">取消编辑</el-button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="storyboardFullNarrationVideoMode" class="sb-dubbing-resync-row">
            <el-button
              class="sb-export-srt-btn"
              size="small"
              plain
              type="warning"
              :disabled="!currentEpisodeId"
              :loading="resyncingFullNarration"
              @click="onResyncFullNarration"
            >
              重新同步旁白分段
            </el-button>
          </div>
        </div>
        <div v-if="storyboards.length > 0" class="sb-export-actions-row">
          <el-button
            class="sb-export-srt-btn"
            size="small"
            plain
            type="primary"
            :disabled="!currentEpisodeId"
            :loading="exportingStoryboardSheet"
            @click="onExportStoryboardSheet"
          >
            导出分镜表excel
          </el-button>
          <el-button
            class="sb-export-srt-btn"
            size="small"
            plain
            type="primary"
            :disabled="!currentEpisodeId"
            @click="onExportNarrationSrt"
          >
            导出解说 SRT
          </el-button>
          <el-select
            v-if="storyboardCopyBatchOptions.length > 1"
            v-model="storyboardCopyBatchIndex"
            size="small"
            style="width: 110px"
            placeholder="批次"
          >
            <el-option
              v-for="opt in storyboardCopyBatchOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-button
            size="small"
            plain
            :disabled="!storyboardPromptCopyCount"
            @click="copyStoryboardPromptsBatch"
          >
            {{ storyboardCopyBatchOptions.length > 1 ? `复制描述词 (${storyboardCopyBatchLabel})` : `一键复制描述词（${storyboardPromptCopyCount}）` }}
          </el-button>
        </div>
        <div class="sb-workflow">
          <!-- 1. 分镜 -->
          <div class="sb-workflow-step">
            <div class="sb-workflow-step-head">
              <span class="sb-workflow-step-num">1</span>
              <span class="sb-workflow-step-title">分镜</span>
              <span v-if="storyboards.length > 0" class="sb-workflow-step-status sb-workflow-step-status--ok">
                共 {{ storyboards.length }} 镜
              </span>
              <span v-else class="sb-workflow-step-status">待生成</span>
            </div>
            <div class="sb-workflow-step-actions">
              <el-button
                type="primary"
                size="small"
                :loading="storyboardGenerating || universalOmniPolishRunning"
                :disabled="!currentEpisodeId || storyboardGenerating || universalOmniPolishRunning"
                @click="onGenerateStoryboard()"
              >
                {{ storyboards.length > 0 ? '重新生成分镜' : 'AI 生成分镜' }}
              </el-button>
              <el-tooltip content="固定生成 7 条分镜，用于快速测试流程" placement="top">
                <el-button
                  plain
                  size="small"
                  :loading="storyboardGenerating || universalOmniPolishRunning"
                  :disabled="!currentEpisodeId || storyboardGenerating || universalOmniPolishRunning"
                  @click="onGenerateTestStoryboard"
                >
                  测试（7镜）
                </el-button>
              </el-tooltip>
              <el-button type="info" plain size="small" @click="onAddSingleStoryboard">
                添加分镜
              </el-button>
            </div>
          </div>

          <template v-if="storyboards.length > 0">
            <!-- 2. 配音 -->
            <div class="sb-workflow-step">
              <div class="sb-workflow-step-head">
                <span class="sb-workflow-step-num">2</span>
                <span class="sb-workflow-step-title">配音</span>
                <span
                  v-if="storyboardNarrationCoverage.total > 0"
                  class="sb-workflow-step-status"
                  :class="{ 'sb-workflow-step-status--ok': storyboardNarrationCoverage.dubbed >= storyboardNarrationCoverage.total }"
                >
                  {{ storyboardNarrationCoverage.dubbed }}/{{ storyboardNarrationCoverage.total }}
                </span>
                <span v-else-if="!storyboardIncludeNarration" class="sb-workflow-step-status">未开启旁白</span>
                <span v-else class="sb-workflow-step-status">无旁白文本</span>
              </div>
              <div class="sb-workflow-step-actions">
                <el-button
                  type="primary"
                  size="small"
                  :disabled="!currentEpisodeId || !storyboardIncludeNarration || !videoIndexTtsNarration || indexttsLoading"
                  :loading="batchNarrationTtsRunning || indexttsLoading"
                  :title="storyboardFullNarrationVideoMode
                    ? '为本集有旁白的分镜批量配音；全部成功后自动按配音做提示词优化'
                    : '为本集有旁白的分镜批量生成 IndexTTS 配音（将自动加载模型，GPU 串行合成）'"
                  @click="onBatchGenerateNarrationTts"
                >
                  一键生成配音
                </el-button>
              </div>
            </div>

            <!-- 3. 生成提示词 -->
            <div v-if="storyboardPromptCoverage" class="sb-workflow-step">
              <div class="sb-workflow-step-head">
                <span class="sb-workflow-step-num">3</span>
                <span class="sb-workflow-step-title">生成提示词</span>
                <span
                  class="sb-workflow-step-status"
                  :class="{ 'sb-workflow-step-status--ok': storyboardPromptCoverage.imageOk && storyboardPromptCoverage.videoOk }"
                >
                  <template v-if="storyboardPromptCoverage.showImagePromptComplete">
                    生图 {{ storyboardPromptCoverage.polished }}/{{ storyboardPromptCoverage.total }}
                  </template>
                  <template v-if="storyboardUniversalOmni">
                    · 全能 {{ storyboardPromptCoverage.universal }}/{{ storyboardPromptCoverage.uniShots || storyboardPromptCoverage.total }}
                  </template>
                  <template v-else-if="storyboardPromptCoverage.showVideoPromptComplete || storyboardFullNarrationVideoMode">
                    · 视频 {{ storyboardPromptCoverage.video }}/{{ storyboardPromptCoverage.total }}
                  </template>
                </span>
              </div>
              <div class="sb-workflow-step-actions">
                <el-button
                  type="primary"
                  size="small"
                  :disabled="!currentEpisodeId || !canGenerateStoryboardPromptsStep"
                  :loading="generatingStoryboardPromptsStep"
                  :title="storyboardFullNarrationVideoMode
                    ? (storyboardUniversalOmni
                      ? '先配音后：按配音时长刷新 duration，再润色全能片段提示词'
                      : '读取各镜旁白配音实际时长，刷新 duration 并 AI 生成 polished_prompt + video_prompt')
                    : '补全缺失的生图/视频提示词'"
                  @click="onGenerateStoryboardPromptsStep"
                >
                  {{
                    storyboardFullNarrationVideoMode
                      ? (storyboardUniversalOmni ? '按配音润色全能提示词' : '按配音时长生成提示词')
                      : '生成提示词'
                  }}
                </el-button>
                <el-button
                  size="small"
                  plain
                  type="danger"
                  :disabled="!currentEpisodeId || clearingMediaKind !== '' || generatingStoryboardPromptsStep || pipelineRunning || storyboardGenerating || universalOmniPolishRunning"
                  :loading="clearingMediaKind === 'prompts'"
                  title="一键清除本集全部生图/视频/全能提示词（保留分镜文案、配音、图片与视频）"
                  @click="onClearEpisodeMedia('prompts')"
                >
                  删除提示词
                </el-button>
              </div>
            </div>

            <!-- 4. 生图 -->
            <div v-if="storyboardPromptCoverage" class="sb-workflow-step">
              <div class="sb-workflow-step-head">
                <span class="sb-workflow-step-num">4</span>
                <span class="sb-workflow-step-title">生图</span>
                <span
                  class="sb-workflow-step-status"
                  :class="{ 'sb-workflow-step-status--ok': storyboardPromptCoverage.sbImageOk }"
                >
                  {{ storyboardPromptCoverage.sbImagesReady }}/{{ storyboardPromptCoverage.total }}
                </span>
              </div>
              <div class="sb-workflow-step-actions">
                <el-button
                  type="success"
                  size="small"
                  :loading="batchImageRunning"
                  :disabled="!currentEpisodeId || batchImageRunning || batchVideoRunning || pipelineRunning || storyboardGenerating || universalOmniPolishRunning"
                  @click="startBatchImageGeneration"
                >
                  批量生成分镜图
                </el-button>
                <el-button v-if="batchImageRunning" size="small" type="danger" plain @click="batchImageStopping = true">
                  停止
                </el-button>
              </div>
            </div>

            <!-- 5. 生视频 -->
            <div v-if="storyboardPromptCoverage" class="sb-workflow-step">
              <div class="sb-workflow-step-head">
                <span class="sb-workflow-step-num">5</span>
                <span class="sb-workflow-step-title">生视频</span>
                <span
                  class="sb-workflow-step-status"
                  :class="{ 'sb-workflow-step-status--ok': storyboardPromptCoverage.sbVideoOk }"
                >
                  {{ storyboardPromptCoverage.sbVideosReady }}/{{ storyboardPromptCoverage.total }}
                </span>
                <span
                  v-if="storyboardPromptCoverage.sbVideosRevise > 0"
                  class="sb-workflow-step-status sb-workflow-step-status--revise"
                >
                  要修改 {{ storyboardPromptCoverage.sbVideosRevise }}
                </span>
              </div>
              <div class="sb-workflow-step-actions">
                <el-button
                  type="warning"
                  size="small"
                  :loading="batchVideoRunning || generatingPromptsFromAudio || universalOmniPolishRunning"
                  :disabled="!currentEpisodeId || batchImageRunning || batchVideoRunning || pipelineRunning || storyboardGenerating || universalOmniPolishRunning || generatingPromptsFromAudio"
                  :title="storyboardFullNarrationVideoMode
                    ? (storyboardUniversalOmni
                      ? '全文解说：若尚未按配音润色全能提示词，将先自动润色再批量生视频；已标记「要修改」的也会重生成'
                      : '全文解说：若尚未按配音生成提示词，将先自动生成再批量生视频；已标记「要修改」的也会重生成')
                    : '批量生成尚未完成的分镜视频，并重生成已标记「要修改」的镜头'"
                  @click="startBatchVideoGeneration"
                >
                  批量生成分镜视频
                </el-button>
                <el-button v-if="batchVideoRunning" size="small" type="danger" plain @click="batchVideoStopping = true">
                  停止
                </el-button>
              </div>
              <div class="sb-workflow-video-options">
                <span class="sb-workflow-video-options-label">文本</span>
                <el-select
                  v-model="defaultTextModel"
                  size="small"
                  style="width: 150px"
                  @change="onDefaultTextModelChange"
                >
                  <el-option
                    v-for="opt in AGNES_TEXT_MODEL_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <span class="sb-workflow-video-options-label">图片</span>
                <el-select
                  v-model="defaultImageModel"
                  size="small"
                  style="width: 158px"
                  @change="onDefaultImageModelChange"
                >
                  <el-option
                    v-for="opt in AGNES_IMAGE_MODEL_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <span class="sb-workflow-video-options-label">视频模型</span>
                <el-select
                  v-model="defaultVideoModel"
                  size="small"
                  style="width: 168px"
                  @change="onDefaultVideoModelChange"
                >
                  <el-option
                    v-for="opt in AGNES_VIDEO_MODEL_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <el-checkbox v-model="videoFrameContiguity" size="small">
                  连贯帧模式
                </el-checkbox>
                <el-tooltip placement="top" :show-after="100">
                  <template #content>
                    <div style="max-width:320px;line-height:1.7">
                      <div style="font-weight:600;margin-bottom:4px">连贯帧模式说明</div>
                      <div>启用后批量视频<strong>串行</strong>生成，每条视频的<b>末帧</b>截取并作为下一条的<b>首帧</b>。与「首尾帧参考图」（本镜图+下一镜图、可 7 路并发）不同。</div>
                      <div style="margin-top:6px">若已开「首尾帧参考图」，将优先用本镜/下一镜图片，并保持并发，不再走视频末帧衔接。</div>
                      <div style="margin-top:6px">仅作用于<strong>经典</strong>分镜（i2v/首帧）。全能请用右侧「软衔接」。</div>
                      <div style="margin-top:8px;font-weight:600">⚠️ 需要模型支持图生视频（i2v）</div>
                      <div style="margin-top:4px">
                        ✅ 支持：kling-video、kling-omni-video、wan2.2-kf2v-flash、wan2.6-i2v-flash<br/>
                        ❌ 不支持（末帧将被忽略）：wan2.6-t2v、wan2.6-r2v-flash、wanx2.1-vace-plus 等纯文生视频模型
                      </div>
                      <div style="margin-top:8px;color:#faad14">如当前视频模型不支持 i2v，启用此选项不会报错，但末帧衔接不会生效。</div>
                    </div>
                  </template>
                  <el-icon style="color:#9ca3af;cursor:help"><QuestionFilled /></el-icon>
                </el-tooltip>
                <el-checkbox
                  v-model="videoSoftContiguity"
                  size="small"
                  @change="() => saveProjectSettings(false)"
                >
                  软衔接
                </el-checkbox>
                <el-tooltip placement="top" :show-after="100">
                  <template #content>
                    <div style="max-width:340px;line-height:1.7">
                      <div style="font-weight:600;margin-bottom:4px">全能软衔接说明</div>
                      <div>批量/单镜生成时<strong>串行</strong>：截取上一镜已完成视频的末帧，作为全能参考图的<strong>第一张</strong>（@图片1），原场景/角色等参考序号顺延。</div>
                      <div style="margin-top:6px">仍走多图 reference，不是硬首帧；只能提高「看起来接上」的概率，无法保证帧级连续。</div>
                      <div style="margin-top:6px">串行时单镜失败会<strong>重试 2 次</strong>（间隔 1 分钟、换一把 Key）；仍失败则<strong>终止后续分镜</strong>。串行同样轮流使用多 Key（与 7 路并发同一套池）。</div>
                      <div style="margin-top:6px">换场、大转场时收益较小；同场景连戏更有效。</div>
                    </div>
                  </template>
                  <el-icon style="color:#9ca3af;cursor:help"><QuestionFilled /></el-icon>
                </el-tooltip>
              </div>
            </div>

            <!-- 补全 -->
            <div v-if="storyboardPromptCoverage" class="sb-workflow-section sb-workflow-section--complete">
              <span class="sb-workflow-section-label">补全</span>
              <div class="sb-workflow-section-btns">
                <el-button
                  size="small"
                  plain
                  type="primary"
                  :disabled="!currentEpisodeId || !storyboardIncludeNarration || !videoIndexTtsNarration || indexttsLoading || remainingNarrationTtsCount === 0"
                  :loading="batchNarrationTtsRunning || indexttsLoading"
                  title="仅为尚未配音的分镜补全（将自动加载模型，GPU 串行合成）"
                  @click="onCompleteRemainingNarrationTts"
                >
                  补全配音{{ remainingNarrationTtsCount > 0 ? `（${remainingNarrationTtsCount}）` : '' }}
                </el-button>
                <el-button
                  v-if="storyboardPromptCoverage.showImagePromptComplete"
                  size="small"
                  plain
                  type="primary"
                  :loading="completingImagePrompts"
                  :disabled="!currentEpisodeId || storyboardPromptCoverage.remainingImagePrompts === 0 || completingImagePrompts || storyboardGenerating || universalOmniPolishRunning || batchImageRunning || batchVideoRunning"
                  @click="onCompleteMissingImagePrompts"
                >
                  补全生图提示词{{ storyboardPromptCoverage.remainingImagePrompts > 0 ? `（${storyboardPromptCoverage.remainingImagePrompts}）` : '' }}
                </el-button>
                <el-button
                  v-if="storyboardPromptCoverage.showVideoPromptComplete"
                  size="small"
                  plain
                  type="primary"
                  :loading="completingVideoPrompts || universalOmniPolishRunning"
                  :disabled="!currentEpisodeId || storyboardPromptCoverage.remainingVideoPrompts === 0 || completingVideoPrompts || universalOmniPolishRunning || storyboardGenerating || batchImageRunning || batchVideoRunning"
                  @click="onCompleteMissingVideoPrompts"
                >
                  {{ storyboardUniversalOmni ? '补全全能片段' : '补全视频提示词' }}{{ storyboardPromptCoverage.remainingVideoPrompts > 0 ? `（${storyboardPromptCoverage.remainingVideoPrompts}）` : '' }}
                </el-button>
                <el-button
                  size="small"
                  plain
                  type="primary"
                  :loading="batchImageRunning"
                  :disabled="!currentEpisodeId || storyboardPromptCoverage.remainingSbImages === 0 || batchImageRunning || batchVideoRunning || pipelineRunning || storyboardGenerating || universalOmniPolishRunning"
                  @click="startBatchImageGeneration"
                >
                  补全分镜图{{ storyboardPromptCoverage.remainingSbImages > 0 ? `（${storyboardPromptCoverage.remainingSbImages}）` : '' }}
                </el-button>
                <el-button
                  size="small"
                  plain
                  type="primary"
                  :loading="batchVideoRunning"
                  :disabled="!currentEpisodeId || storyboardPromptCoverage.remainingSbVideos === 0 || batchImageRunning || batchVideoRunning || pipelineRunning || storyboardGenerating || universalOmniPolishRunning"
                  :title="storyboardPromptCoverage.sbVideosBlocked > 0
                    ? `另有 ${storyboardPromptCoverage.sbVideosBlocked} 镜缺分镜图或参考图，需先生图/配参考后再补全视频`
                    : '仅为缺视频且已具备首帧/参考图的分镜批量生成'"
                  @click="startBatchVideoGeneration"
                >
                  补全分镜视频{{ storyboardPromptCoverage.remainingSbVideos > 0 ? `（${storyboardPromptCoverage.remainingSbVideos}）` : '' }}
                </el-button>
              </div>
            </div>

            <!-- 清除 -->
            <div class="sb-workflow-section sb-workflow-section--clear">
              <span class="sb-workflow-section-label">清除</span>
              <div class="sb-workflow-section-btns">
                <el-button
                  size="small"
                  plain
                  type="danger"
                  :disabled="!currentEpisodeId || clearingMediaKind !== '' || generatingStoryboardPromptsStep || pipelineRunning || storyboardGenerating || universalOmniPolishRunning"
                  :loading="clearingMediaKind === 'prompts'"
                  title="清除本集全部生图/视频/全能提示词（保留分镜文案、配音、图片与视频）"
                  @click="onClearEpisodeMedia('prompts')"
                >
                  删除提示词
                </el-button>
                <el-button
                  size="small"
                  plain
                  type="danger"
                  :disabled="!currentEpisodeId || clearingMediaKind !== '' || pipelineRunning"
                  :loading="clearingMediaKind === 'narration_audio'"
                  title="清除本集全部分镜旁白/对白配音文件引用（不删分镜文本）"
                  @click="onClearEpisodeMedia('narration_audio')"
                >
                  删除配音
                </el-button>
                <el-button
                  size="small"
                  plain
                  type="danger"
                  :disabled="!currentEpisodeId || clearingMediaKind !== '' || batchImageRunning || batchVideoRunning || pipelineRunning || storyboardGenerating || universalOmniPolishRunning"
                  :loading="clearingMediaKind === 'images'"
                  title="清除本集全部分镜图（含首尾帧历史图），保留分镜文案"
                  @click="onClearEpisodeMedia('images')"
                >
                  删除分镜图
                </el-button>
                <el-button
                  size="small"
                  plain
                  type="danger"
                  :disabled="!currentEpisodeId || clearingMediaKind !== '' || batchImageRunning || batchVideoRunning || pipelineRunning || storyboardGenerating || universalOmniPolishRunning"
                  :loading="clearingMediaKind === 'videos'"
                  title="清除本集全部分镜视频与成片，保留分镜文案与图片"
                  @click="onClearEpisodeMedia('videos')"
                >
                  删除视频
                </el-button>
              </div>
            </div>

            <!-- 就绪状态 -->
            <div
              v-if="storyboardPromptCoverage"
              class="sb-prompt-coverage-bar"
              :class="`sb-prompt-coverage-bar--${storyboardPromptCoverage.status}`"
            >
              <div class="sb-prompt-coverage-head">
                <span class="sb-prompt-coverage-title">分镜就绪</span>
                <el-tag
                  v-if="storyboardPromptCoverage.status === 'generating'"
                  size="small"
                  type="primary"
                  effect="plain"
                >
                  生成中
                </el-tag>
                <el-tag
                  v-else-if="storyboardPromptCoverage.status === 'complete'"
                  size="small"
                  type="success"
                  effect="plain"
                >
                  已全部就绪
                </el-tag>
                <el-tag
                  v-else-if="storyboardPromptCoverage.status === 'partial'"
                  size="small"
                  type="warning"
                  effect="plain"
                >
                  部分缺失
                </el-tag>
                <el-tag v-else size="small" type="info" effect="plain">待生成</el-tag>
              </div>
              <div class="sb-prompt-coverage-lines">
                <div class="sb-prompt-coverage-line">
                  <span :class="{ 'sb-prompt-coverage-ok': storyboardPromptCoverage.imageOk }">
                    🖼 {{ storyboardPromptCoverage.imageLine }}
                  </span>
                </div>
                <div class="sb-prompt-coverage-line">
                  <span :class="{ 'sb-prompt-coverage-ok': storyboardPromptCoverage.videoOk }">
                    🎬 {{ storyboardPromptCoverage.videoLine }}
                  </span>
                </div>
                <div class="sb-prompt-coverage-line">
                  <span :class="{ 'sb-prompt-coverage-ok': storyboardPromptCoverage.sbImageOk }">
                    🖼 {{ storyboardPromptCoverage.sbImageLine }}
                  </span>
                </div>
                <div class="sb-prompt-coverage-line">
                  <span :class="{ 'sb-prompt-coverage-ok': storyboardPromptCoverage.sbVideoOk }">
                    🎬 {{ storyboardPromptCoverage.sbVideoLine }}
                  </span>
                </div>
              </div>
              <p v-if="storyboardPromptCoverage.modeNote" class="sb-prompt-coverage-note">{{ storyboardPromptCoverage.modeNote }}</p>
              <p v-if="storyboardPromptCoverage.isGen && storyboardGenStatusMessage" class="sb-prompt-coverage-live">
                {{ storyboardGenStatusMessage }}
              </p>
            </div>
          </template>
        </div>
        <!-- 批量生成进度 -->
        <div v-if="batchImageRunning || batchVideoRunning || batchImageErrors.length || batchVideoErrors.length" class="batch-status">
          <div v-if="batchImageRunning" class="batch-progress">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>批量生成分镜图：{{ batchImageProgress.current }}/{{ batchImageProgress.total }}</span>
            <span v-if="batchImageProgress.failed > 0" class="batch-failed">{{ batchImageProgress.failed }} 条失败</span>
            <span v-if="batchImageStopping" class="batch-stopping">（正在停止...）</span>
          </div>
          <div v-if="batchVideoRunning" class="batch-progress">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>批量生成分镜视频：{{ batchVideoProgress.current }}/{{ batchVideoProgress.total }}</span>
            <span v-if="batchVideoProgress.failed > 0" class="batch-failed">{{ batchVideoProgress.failed }} 条失败</span>
            <span v-if="batchVideoStopping" class="batch-stopping">（正在停止...）</span>
          </div>
          <div v-if="batchImageErrors.length > 0" class="batch-error-log">
            <div class="batch-error-title">分镜图生成失败记录：</div>
            <div v-for="(e, i) in batchImageErrors" :key="i" class="batch-error-line">{{ e }}</div>
          </div>
          <div v-if="batchVideoErrors.length > 0" class="batch-error-log">
            <div class="batch-error-title">分镜视频生成失败记录：</div>
            <div v-for="(e, i) in batchVideoErrors" :key="i" class="batch-error-line">{{ e }}</div>
          </div>
        </div>
        <div v-if="storyboardGenerating || universalOmniPolishRunning" class="storyboard-generating-tip">
          <el-icon class="is-loading"><Loading /></el-icon>
          <div class="storyboard-generating-tip-body">
            <span v-if="universalOmniPolishRunning">
              正在润色全能提示词：已完成 {{ universalOmniPolishProgress.current }} / {{ universalOmniPolishProgress.total }} 镜
              <template v-if="universalOmniPolishProgress.label">（{{ universalOmniPolishProgress.label }}）</template>
            </span>
            <span v-else>{{ storyboardGenStatusMessage || '正在分析剧本并拆解分镜，请稍候...' }}</span>
            <el-progress
              v-if="universalOmniPolishRunning && universalOmniPolishProgress.total > 0"
              class="universal-omni-polish-progress"
              :percentage="universalOmniPolishPercent"
              :stroke-width="10"
            />
          </div>
        </div>
        <div v-if="sbTruncatedWarning && !sbTruncatedDismissed && storyboards.length > 0" class="sb-truncated-warning">
          <el-icon><WarningFilled /></el-icon>
          <span>检测到分镜可能不完整（AI 输出被截断），请确认分镜数量是否符合预期，必要时可重新生成。</span>
          <el-button size="small" text @click="sbTruncatedDismissed = true">关闭</el-button>
        </div>
        <template v-if="storyboards.length > 0">
          <div class="sb-pagination-bar">
            <span class="sb-pagination-summary">
              共 {{ storyboards.length }} 条分镜，第 {{ storyboardPage }} / {{ storyboardTotalPages }} 页
            </span>
            <el-pagination
              v-model:current-page="storyboardPage"
              :page-size="STORYBOARD_PAGE_SIZE"
              :total="storyboards.length"
              layout="prev, pager, next"
              background
              small
              @current-change="onStoryboardPageChange"
            />
          </div>
          <template v-for="(sb, i) in pagedStoryboards" :key="sb.id">
            <!-- 段落分隔标头：本页首条或幕切换时显示（跨页续幕也显示，便于定位） -->
            <div
              v-if="sb.segment_title && (i === 0 || sb.segment_index !== pagedStoryboards[i - 1].segment_index)"
              class="segment-header"
            >
              <div class="segment-header-inner">
                <span class="segment-index-badge">第 {{ (sb.segment_index ?? 0) + 1 }} 幕</span>
                <span class="segment-title-text">{{ sb.segment_title }}</span>
                <span class="segment-shot-range">
                  镜头 {{ getSegmentShotRangeLabel(sb, storyboardPageOffset + i) }}
                </span>
              </div>
            </div>
          <!-- 分镜控制栏（卡片外，缩进表示属于当前幕） -->
          <div class="sb-ctrl-bar">
            <span class="sb-ctrl-num">{{ storyboardPageOffset + i + 1 }}</span>
            <span class="sb-ctrl-title">{{ sb.title || '未命名分镜' }}</span>
            <el-tag v-if="sb.movement" size="small" effect="plain" type="info" class="sb-movement-tag">{{ getMovementLabel(sb.movement) }}</el-tag>
            <el-button size="small" plain class="sb-ctrl-btn sb-ctrl-config-btn" @click="onOpenVideoParamsDialog(sb)">⚙ 分镜配置</el-button>
            <el-button
              size="small"
              plain
              class="sb-ctrl-btn sb-ctrl-mode-btn"
              :title="isSbUniversalMode(sb.id) ? '切换为经典分镜（中间显示参考图）' : '切换为全能模式（中间为片段描述，经典字段保留）'"
              @click="onToggleSbUniversalMode(sb)"
            >
              {{ isSbUniversalMode(sb.id) ? '经典分镜' : '全能模式' }}
            </el-button>
            <el-button size="small" plain class="sb-ctrl-btn" title="在本镜头前增加一个分镜" @click="onInsertStoryboardBefore(sb)">＋ 新增</el-button>
            <el-button
              size="small"
              plain
              class="sb-ctrl-btn"
              :loading="regeneratingSingleSbIds.has(sb.id)"
              title="仅重新生成本镜脚本；可选按 AI 结果重新绑定角色/场景/道具"
              @click="onRegenerateSingleStoryboard(sb)"
            >
              ↻ 本镜重生成
            </el-button>
            <el-button
              class="sb-ctrl-delete"
              type="danger"
              text
              size="small"
              :title="`删除分镜${storyboardPageOffset + i + 1}`"
              @click="onDeleteSingleStoryboard(sb.id)"
            >
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
          <div
            :id="'sb-' + sb.id"
            class="storyboard-row"
            :class="{ 'storyboard-row--video-revise': sbNeedsVideoRevision(sb) }"
          >
            <!-- 左：分镜脚本 -->
            <div class="sb-panel sb-script">
              <div class="sb-script-row sb-script-selects">
                <el-select
                  :model-value="getSbCharacterIds(sb.id)"
                  placeholder="选择角色"
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  size="small"
                  class="sb-select"
                  @update:model-value="(v) => setSbCharacterIds(sb.id, v)"
                >
                  <el-option
                    v-for="c in (characters || [])"
                    :key="String(c.id)"
                    :label="c.name || '未命名'"
                    :value="c.id"
                  />
                  <template v-if="!(characters || []).length" #empty>
                    <span class="sb-select-empty">请先在「角色生成」中添加角色</span>
                  </template>
                </el-select>
                <el-select
                  v-model="sbSceneId[sb.id]"
                  placeholder="选择场景"
                  clearable
                  size="small"
                  class="sb-select"
                  @change="() => onStoryboardSceneChange(sb.id)"
                >
                  <el-option
                    v-for="s in (scenes || [])"
                    :key="s.id"
                    :label="s.location"
                    :value="s.id"
                  />
                </el-select>
                <el-select
                  :model-value="getSbPropIds(sb.id)"
                  placeholder="选择物品"
                  multiple
                  collapse-tags
                  collapse-tags-tooltip
                  size="small"
                  class="sb-select"
                  @update:model-value="(v) => setSbPropIds(sb.id, v)"
                >
                  <el-option
                    v-for="p in (props || [])"
                    :key="String(p.id)"
                    :label="p.name || '未命名'"
                    :value="p.id"
                  />
                  <template v-if="!(props || []).length" #empty>
                    <span class="sb-select-empty">请先在「道具生成」中添加物品</span>
                  </template>
                </el-select>
              </div>
              <!-- 当前选中：场景 / 角色 / 物品缩略图 -->
              <div v-if="getSbSelectedScene(sb.id) || getSbSelectedCharacters(sb.id).length || getSbSelectedProps(sb.id).length || (characters || []).length" class="sb-selected-thumbs">
                <div v-if="getSbSelectedScene(sb.id)" class="sb-thumb-row">
                  <span class="sb-thumb-label">场景</span>
                  <div class="sb-thumb-list">
                    <div
                      v-for="s in [getSbSelectedScene(sb.id)]"
                      :key="s.id"
                      class="sb-thumb-item sb-thumb-scene"
                      :class="{ 'sb-thumb-clickable': hasAssetImage(s) }"
                      :title="s.location"
                      role="button"
                      @click="hasAssetImage(s) && openImagePreview(assetImageUrl(s))"
                    >
                      <img v-if="hasAssetImage(s)" :src="assetImageUrl(s)" alt="" />
                      <span v-else class="sb-thumb-placeholder">{{ (s.location || '')[0] }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="(characters || []).length" class="sb-thumb-row">
                  <span class="sb-thumb-label">角色</span>
                  <div class="sb-thumb-list">
                    <div
                      v-for="c in getSbSelectedCharacters(sb.id)"
                      :key="c.id"
                      class="sb-thumb-item sb-thumb-avatar"
                      :class="{ 'sb-thumb-clickable': hasAssetImage(c) }"
                      :title="c.name"
                      role="button"
                      @click="hasAssetImage(c) && openImagePreview(assetImageUrl(c))"
                    >
                      <img v-if="hasAssetImage(c)" :src="assetImageUrl(c)" alt="" />
                      <span v-else class="sb-thumb-placeholder">{{ (c.name || '')[0] }}</span>
                    </div>
                    <el-dropdown trigger="click" @command="(cmd) => onSbAddCharacterCommand(sb.id, cmd)">
                      <div
                        class="sb-thumb-item sb-thumb-avatar sb-thumb-add-char"
                        title="添加角色"
                        role="button"
                        @click.stop
                      >
                        <el-icon><Plus /></el-icon>
                      </div>
                      <template #dropdown>
                        <el-dropdown-menu class="sb-char-add-dropdown">
                          <el-dropdown-item
                            v-for="c in charactersAvailableToAddToSb(sb.id)"
                            :key="c.id"
                            :command="c.id"
                          >
                            {{ c.name || '未命名' }}
                          </el-dropdown-item>
                          <el-dropdown-item v-if="!charactersAvailableToAddToSb(sb.id).length" disabled>
                            已全部添加或无角色
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
                <div v-if="getSbSelectedProps(sb.id).length" class="sb-thumb-row">
                  <span class="sb-thumb-label">物品</span>
                  <div class="sb-thumb-list">
                    <div
                      v-for="p in getSbSelectedProps(sb.id)"
                      :key="p.id"
                      class="sb-thumb-item sb-thumb-prop"
                      :class="{ 'sb-thumb-clickable': hasAssetImage(p) }"
                      :title="p.name"
                      role="button"
                      @click="hasAssetImage(p) && openImagePreview(assetImageUrl(p))"
                    >
                      <img v-if="hasAssetImage(p)" :src="assetImageUrl(p)" alt="" />
                      <span v-else class="sb-thumb-placeholder">{{ (p.name || '')[0] }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <!-- 图片提示词：首尾帧模式下仍展示基础拼装版（专业首/尾帧提示词在右侧槽位「查看提示词」） -->
              <div class="sb-prompt-label">
                <span class="sb-dot"></span>
                <span>{{ storyboardUseFirstLastFrame ? '基础图片提示词' : '图片提示词' }}</span>
                <el-tag size="small" :type="sbImagePromptStatusTag(sb).type" effect="plain" class="sb-prompt-status-tag">
                  {{ sbImagePromptStatusTag(sb).text }}
                </el-tag>
                <span v-if="storyboardUseFirstLastFrame" class="sb-prompt-hint-inline">首尾帧生图优先用右侧「查看提示词」里的专业版</span>
              </div>
              <div class="sb-prompt-row">
                <span class="sb-prompt-text">{{ sbImagePromptPreview(sb) }}</span>
                <div class="sb-prompt-actions">
                  <el-button size="small" link type="primary" title="复制本分镜图片提示词" @click="copyStoryboardPrompt(sb)">复制描述词</el-button>
                  <el-button size="small" link type="primary" @click="onOpenSbPromptDialog(sb)">编辑</el-button>
                </div>
              </div>
              <template v-if="storyboardIncludeNarration || storyboardFullNarrationVideoMode || (sbNarration[sb.id] || '').trim() || (sb.narration || '').trim()">
                <div class="sb-prompt-label sb-narration-label-row">
                  <div class="sb-narration-label-left">
                    <span class="sb-dot"></span>
                    <span>解说旁白</span>
                  </div>
                  <span
                    v-if="sbNarrationText(sb).trim()"
                    class="sb-narration-stats"
                    :class="sbNarrationStatsClass(sb)"
                    :title="sbNarrationStatsTitle(sb)"
                  >
                    {{ sbNarrationStatsLabel(sb) }}
                  </span>
                </div>
                <el-input
                  v-model="sbNarration[sb.id]"
                  type="textarea"
                  :rows="2"
                  placeholder="本镜解说文案（画外音 / 纪录片式旁白，供 TTS 或导出 SRT）"
                  class="sb-narration-input"
                  @blur="() => onSaveSbNarrationField(sb)"
                />
                <div v-if="(sbNarration[sb.id] || sb.narration || '').toString().trim()" class="sb-narration-actions">
                  <el-tooltip content="为本镜解说旁白单独生成 IndexTTS 配音（生成视频时将自动混入）" placement="top">
                    <el-button
                      size="small"
                      :loading="ttsSbNarrationIds.has(sb.id)"
                      :disabled="!videoIndexTtsNarration || indexttsLoading"
                      @click="onTtsSbNarration(sb)"
                    >
                      解说配音
                    </el-button>
                  </el-tooltip>
                  <el-tooltip v-if="hasSbNarrationAudio(sb)" content="播放解说旁白配音" placement="top">
                    <el-button size="small" @click="playSbNarrationTts(sb)">
                      <el-icon><VideoPlay /></el-icon>
                    </el-button>
                  </el-tooltip>
                </div>
                <audio
                  v-if="hasSbNarrationAudio(sb)"
                  :key="`narr-audio-${sb.id}-${sbNarrationAudioRevision[sb.id] || 0}`"
                  class="sb-narration-audio"
                  controls
                  preload="metadata"
                  :src="sbNarrationAudioPlaybackUrl(sb)"
                />
              </template>
            </div>
            <!-- 中：经典模式=分镜参考图；全能模式=片段描述（独立字段，与参考图并存） -->
            <div class="sb-panel sb-image" :class="{ 'sb-image--universal': isSbUniversalMode(sb.id) }">
              <template v-if="isSbUniversalMode(sb.id)">
                <div class="sb-prompt-label sb-universal-label-row">
                  <div class="sb-universal-label-left">
                    <span class="sb-dot"></span>
                    <span>片段描述</span>
                    <el-tooltip placement="top" :show-after="280" :show-arrow="false" popper-class="sb-universal-tooltip-popper">
                      <template #content>
                        <div class="sb-universal-tooltip">
                          全能生视频链路（<strong>AI 配置 · 视频</strong> 中选接口规范：<code>kling_omni</code> 可灵 Omni，或 <code>volcengine_omni</code> 火山即梦 Seedance 2.0 多图参考；模型如 <code>kling-video-o1</code>、<code>doubao-seedance-2-0-260128</code> 等以控制台为准）：此处为提交主提示词；只要本框有内容，生视频时<strong>只</strong>发送这段，不会拼接下方「视频提示词」里的动作/对话/旁白。参考图顺序一般为：场景 → 角色（多张）→ 物品（<strong>不含</strong>经典分镜中间主图）；请用 <strong>@图片1</strong>、<strong>@图片2</strong>…（<strong>@图片N 后建议加半角空格</strong>）对应参考图，勿用 @姓名 指图；有场景图时 <strong>@图片1</strong> 只表环境，人物从 <strong>@图片2</strong> 起。若场景参考是<strong>四宫格/多视角拼图</strong>，仅借空间与氛围，须在文案中写明<strong>单镜头完整画幅、禁止分屏宫格</strong>，避免成片模仿拼图布局。全能提示词下拉中「生成」会按<strong>本条分镜总时长</strong>与本集剧本、镜序、邻镜信息，自动决定子分镜数 M（第2行「由以下M个分镜…」），第4行起为「分镜1：T1秒:」…多行，且各段秒数之和等于本镜时长；第3行仍为环境/参考图约束；「生成」与「润色」均为<strong>流式输出</strong>到本框；「润色」在此基础上增强。若本框留空，则退回仅用「视频提示词」。
                        </div>
                      </template>
                      <el-icon class="sb-universal-hint-icon" tabindex="0" role="img" aria-label="片段说明">
                        <QuestionFilled />
                      </el-icon>
                    </el-tooltip>
                  </div>
                  <el-dropdown
                    trigger="click"
                    class="sb-universal-prompt-dd"
                    @command="(cmd) => onUniversalSegmentPromptMenu(sb, cmd)"
                  >
                    <el-button
                      type="primary"
                      link
                      size="small"
                      class="sb-universal-gen-btn"
                      :loading="generatingUniversalSegmentIds.has(sb.id)"
                    >
                      全能提示词
                      <el-icon class="sb-universal-dd-caret"><ArrowDown /></el-icon>
                    </el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="generate">生成全能提示词</el-dropdown-item>
                        <el-dropdown-item command="generate-force">不查图片强制生成</el-dropdown-item>
                        <el-dropdown-item command="polish" :disabled="!sbUniversalSegmentTrimmed(sb)">
                          润色全能提示词
                        </el-dropdown-item>
                        <el-dropdown-item command="polish-force" :disabled="!sbUniversalSegmentTrimmed(sb)">
                          不查图片强制润色
                        </el-dropdown-item>
                        <el-dropdown-item
                          command="to-grok-video-tags"
                          divided
                          :disabled="!sbUniversalSegmentTrimmed(sb)"
                        >
                          改为 grok视频格式
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
                <el-input
                  v-model="sbUniversalSegmentInstruction[sb.id]"
                  size="small"
                  clearable
                  class="sb-universal-instruction"
                  placeholder="生成/润色要求（可选），如：翻相册蒙太奇，用【运镜→定格1→定格2】结构；加强暖光；不要内嵌旁白原文"
                />
                <UniversalSegmentOmniAtEditor
                  v-if="!generatingUniversalSegmentIds.has(sb.id)"
                  v-model="sbUniversalSegmentText[sb.id]"
                  :slots="getSbUniversalOmniRefSlots(sb)"
                  class="sb-universal-textarea"
                  @blur="() => onSaveUniversalSegmentField(sb)"
                />
                <el-input
                  v-else
                  v-model="sbUniversalSegmentText[sb.id]"
                  type="textarea"
                  :rows="10"
                  :autosize="{ minRows: 10, maxRows: 22 }"
                  placeholder="正在生成/润色，旧文案已清空…"
                  class="sb-universal-textarea"
                  @blur="() => onSaveUniversalSegmentField(sb)"
                />
                <el-progress
                  v-if="generatingUniversalSegmentIds.has(sb.id)"
                  class="sb-universal-stream-progress"
                  :percentage="100"
                  :indeterminate="true"
                  :stroke-width="8"
                  :show-text="false"
                  status="success"
                />
                <div
                  v-if="isSbUniversalMode(sb.id)"
                  class="sb-universal-beats"
                >
                  <div class="sb-universal-beats-toolbar">
                    <span class="sb-universal-beats-title">
                      {{ getSbUniversalBeats(sb).length > 0 ? '子分镜预览（时间轴对齐旁白；可编辑正文）' : '子分镜预览（未能解析多行分镜格式，可点重新生成）' }}
                    </span>
                    <div class="sb-universal-beats-actions">
                      <el-tag
                        v-if="getSbUniversalBeats(sb).length > 0 && sbUniversalDurationBeatSumMisaligned(sb)"
                        size="small"
                        type="danger"
                        effect="plain"
                        class="sb-universal-beats-warn"
                        :title="sbUniversalDurationBeatSumHint(sb)"
                      >
                        子分镜合计与 duration 不一致（保存后将按 duration 缩放各拍）
                      </el-tag>
                      <el-tag
                        v-if="getSbUniversalBeats(sb).length > 0 && sbUniversalBeatsMisaligned(sb)"
                        size="small"
                        type="warning"
                        effect="plain"
                        class="sb-universal-beats-warn"
                      >
                        秒数未按旁白权重
                      </el-tag>
                      <el-button
                        v-if="getSbUniversalBeats(sb).length > 0 && sbUniversalBeatsMisaligned(sb)"
                        type="warning"
                        link
                        size="small"
                        @click="onAlignUniversalBeatSeconds(sb)"
                      >
                        按旁白对齐秒数
                      </el-button>
                      <el-button
                        type="primary"
                        link
                        size="small"
                        :loading="generatingUniversalSegmentIds.has(sb.id)"
                        :disabled="generatingUniversalSegmentIds.has(sb.id)"
                        @click="onRegenerateUniversalSegment(sb)"
                      >
                        重新生成
                      </el-button>
                    </div>
                  </div>
                  <div
                    v-for="beat in getSbUniversalBeats(sb)"
                    :key="`${sb.id}-beat-${beat.index}`"
                    class="sb-universal-beat-row"
                  >
                    <div class="sb-universal-beat-head">
                      <span class="sb-universal-beat-label">
                        分镜{{ beat.index }} · {{ beat.seconds }}秒
                        <span class="sb-universal-beat-time">{{ beat.timeLabel }}</span>
                      </span>
                    </div>
                    <div v-if="beat.narrationExcerpt" class="sb-universal-beat-narr">
                      旁白 · {{ beat.narrationExcerpt }}
                    </div>
                    <el-input
                      :model-value="beat.body || ''"
                      type="textarea"
                      :autosize="{ minRows: 2, maxRows: 8 }"
                      class="sb-universal-beat-body-input"
                      placeholder="该时段的画面描述（运镜、@图片N 动作、光影）；动作须落在上方旁白时间窗内"
                      @change="(val) => onUniversalBeatBodyChange(sb, beat, val)"
                    />
                  </div>
                </div>
              </template>
              <template v-else>
              <div
                class="sb-image-area"
                :class="{
                  'sb-image-area--dragover': dragOverSbId === sb.id,
                  'sb-image-area--has-quad': !storyboardUseFirstLastFrame && getStripItems(sb.id).length > 0,
                  'sb-image-area--first-last': storyboardUseFirstLastFrame,
                }"
                @dragover="onSbImageDragOver($event, sb.id)"
                @dragleave="onSbImageDragLeave($event, sb.id)"
                @drop="onSbImageDrop($event, sb)"
              >
                <!-- 首尾帧双槽 -->
                <template v-if="storyboardUseFirstLastFrame">
                  <div class="sb-fl-dual">
                    <div class="sb-fl-slot">
                      <div class="sb-fl-slot-label">首帧</div>
                      <div class="sb-fl-slot-body">
                        <template v-if="getSbFirstImage(sb.id)">
                          <img
                            :src="assetImageUrl(getSbFirstImage(sb.id))"
                            class="sb-generated-img"
                            alt=""
                            @click="openImagePreview(assetImageUrl(getSbFirstImage(sb.id)))"
                          />
                        </template>
                        <template v-else-if="sb.image_url || sb.composed_image">
                          <img
                            :src="imageUrl(sb.composed_image || sb.image_url)"
                            class="sb-generated-img"
                            alt=""
                            @click="openImagePreview(imageUrl(sb.composed_image || sb.image_url))"
                          />
                        </template>
                        <template v-else>
                          <span class="sb-fl-empty">动作前静止</span>
                        </template>
                      </div>
                      <div v-if="getSbFirstImage(sb.id)?.prompt" class="sb-fl-slot-prompt" :title="getSbFirstImage(sb.id).prompt">
                        {{ getSbFirstImage(sb.id).prompt }}
                      </div>
                      <div class="sb-fl-slot-actions">
                        <el-button type="primary" size="small" :loading="generatingSbFirstImageIds.has(sb.id)" @click="onGenerateSbFrameImage(sb, 'first')">生成</el-button>
                        <el-tooltip v-if="canUsePrevTailAsFirst(sb)" content="直接使用上一分镜的尾帧图片（高清原图）替换本首帧，画面更清晰" placement="top">
                          <el-button size="small" :loading="usingPrevTailAsFirstIds.has(sb.id)" @click="onUsePrevTailAsFirst(sb)">上镜尾帧</el-button>
                        </el-tooltip>
                        <el-button size="small" :loading="uploadingSbImageSlot(sb.id) === 'first'" @click="onUploadSbImageClick(sb, 'first')">上传</el-button>
                        <el-button type="primary" link size="small" @click="showSbFramePromptPreview(sb, 'first')">查看提示词</el-button>
                      </div>
                    </div>
                    <div class="sb-fl-arrow" aria-hidden="true">→</div>
                    <div class="sb-fl-slot">
                      <div class="sb-fl-slot-label">尾帧</div>
                      <div class="sb-fl-slot-body">
                        <template v-if="getSbLastImage(sb.id)">
                          <img
                            :src="assetImageUrl(getSbLastImage(sb.id))"
                            class="sb-generated-img"
                            alt=""
                            :title="getSbLastImage(sb.id).prompt || ''"
                            @click="openImagePreview(assetImageUrl(getSbLastImage(sb.id)))"
                          />
                        </template>
                        <template v-else>
                          <span class="sb-fl-empty">动作后结果</span>
                        </template>
                      </div>
                      <div v-if="getSbLastImage(sb.id)?.prompt" class="sb-fl-slot-prompt" :title="getSbLastImage(sb.id).prompt">
                        {{ getSbLastImage(sb.id).prompt }}
                      </div>
                      <div class="sb-fl-slot-actions">
                        <el-button type="primary" size="small" :loading="generatingSbLastImageIds.has(sb.id)" @click="onGenerateSbFrameImage(sb, 'last')">生成</el-button>
                        <el-checkbox
                          v-model="lastFrameUseFirstLayoutLock"
                          class="sb-fl-first-lock-opt"
                          title="勾选时尾帧生成会附带首帧图作构图与左右站位参考；取消后仅使用场景/角色/道具参考，便于调整出场人物"
                          @change="onLastFrameLayoutLockChange"
                        >
                          首帧站位
                        </el-checkbox>
                        <el-button size="small" :loading="uploadingSbImageSlot(sb.id) === 'last'" @click="onUploadSbImageClick(sb, 'last')">上传</el-button>
                        <el-button type="primary" link size="small" @click="showSbFramePromptPreview(sb, 'last')">查看提示词</el-button>
                      </div>
                    </div>
                  </div>
                  <div v-if="getStripItems(sb.id).length" class="sb-imgs-strip">
                    <el-tooltip content="历史图：点击设为首帧或尾帧，左上角放大预览，右上角删除" placement="top" :show-arrow="false">
                      <el-icon class="sb-strip-hint-icon"><InfoFilled /></el-icon>
                    </el-tooltip>
                    <div
                      v-for="item in getStripItems(sb.id)"
                      :key="item.key"
                      class="sb-img-thumb"
                      :title="stripItemTitle(sb.id, item)"
                      @click="onStripItemClick(sb, item)"
                    >
                      <img :src="item.src" alt="" />
                      <span v-if="item.frameBadge" class="sb-img-thumb-label">{{ item.frameBadge }}</span>
                      <span v-else-if="item.label" class="sb-img-thumb-label">{{ item.label }}</span>
                      <button class="thumb-preview-btn" title="放大预览" @click.stop="openImagePreview(item.src)">
                        <el-icon :size="10"><ZoomIn /></el-icon>
                      </button>
                      <button v-if="item.img?.id" class="extra-thumb-remove" title="删除历史图" @click.stop="onRemoveSbHistoryImage(sb.id, item.img.id)">×</button>
                    </div>
                  </div>
                </template>
                <!-- 单主图（未勾选首尾帧） -->
                <template v-else>
                <div class="sb-main-image-wrap">
                  <template v-if="getSbImage(sb.id)">
                    <img
                      :src="assetImageUrl(getSbImage(sb.id))"
                      class="sb-generated-img"
                      alt=""
                      :title="getSbImage(sb.id).prompt || ''"
                      @click="openImagePreview(assetImageUrl(getSbImage(sb.id)))"
                    />
                    <div v-if="getSbImage(sb.id).prompt" class="sb-main-img-prompt">{{ getSbImage(sb.id).prompt }}</div>
                  </template>
                  <template v-else-if="sb.composed_image || sb.image_url">
                    <img
                      :src="imageUrl(sb.composed_image || sb.image_url)"
                      class="sb-generated-img"
                      alt=""
                      @click="openImagePreview(imageUrl(sb.composed_image || sb.image_url))"
                    />
                  </template>
                  <template v-else-if="sb.error_msg || sb.errorMsg">
                    <div class="sb-image-error" :title="sb.error_msg || sb.errorMsg">{{ sb.error_msg || sb.errorMsg }}</div>
                    <el-button type="primary" size="small" class="sb-gen-btn" :loading="generatingSbImageIds.has(sb.id)" @click="onGenerateSbImage(sb)">
                      <el-icon><Refresh /></el-icon>
                      重试
                    </el-button>
                    <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
                  </template>
                  <template v-else>
                    <el-button type="primary" size="small" class="sb-gen-btn" :loading="generatingSbImageIds.has(sb.id)" @click="onGenerateSbImage(sb)">
                      <el-icon><MagicStick /></el-icon>
                      生成分镜参考图
                    </el-button>
                    <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
                  </template>
                </div>
                <div v-if="getStripItems(sb.id).length" class="sb-imgs-strip">
                  <el-tooltip content="历史图：点击设为主图，左上角放大预览，右上角删除" placement="top" :show-arrow="false">
                    <el-icon class="sb-strip-hint-icon"><InfoFilled /></el-icon>
                  </el-tooltip>
                  <div
                    v-for="item in getStripItems(sb.id)"
                    :key="item.key"
                    class="sb-img-thumb"
                    :title="[item.label, item.prompt].filter(Boolean).join('\n\n') || '点击设为主图'"
                    @click="onSelectStripItem(sb, item)"
                  >
                    <img :src="item.src" alt="" />
                    <span v-if="item.label" class="sb-img-thumb-label">{{ item.label }}</span>
                    <button class="thumb-preview-btn" title="放大预览" @click.stop="openImagePreview(item.src)">
                      <el-icon :size="10"><ZoomIn /></el-icon>
                    </button>
                    <button v-if="item.img?.id" class="extra-thumb-remove" title="删除历史图" @click.stop="onRemoveSbHistoryImage(sb.id, item.img.id)">×</button>
                  </div>
                </div>
                </template>
                <div v-if="dragOverSbId === sb.id" class="sb-image-area-drop-hint">松开上传到首帧</div>
              </div>
              <div v-if="hasSbImage(sb) || storyboardUseFirstLastFrame" class="sb-image-actions">
                <template v-if="storyboardUseFirstLastFrame">
                  <el-button size="small" :loading="generatingSbFirstImageIds.has(sb.id) || generatingSbLastImageIds.has(sb.id)" @click="onGenerateSbFramePair(sb)">{{ hasSbFirstLastPair(sb) ? '重新生成首尾帧' : '一键生成首尾帧' }}</el-button>
                  <el-tooltip content="高清放大仅作用于首帧" placement="top">
                    <el-button size="small" :loading="upscalingSbIds.has(sb.id)" :disabled="!getSbLocalImage(sb)" @click="onUpscaleSbImage(sb)">
                      <el-icon><ZoomIn /></el-icon>超分(首帧)
                    </el-button>
                  </el-tooltip>
                </template>
                <template v-else>
                <el-button size="small" :loading="generatingSbImageIds.has(sb.id)" @click="onGenerateSbImage(sb)">重新生成</el-button>
                <el-button size="small" :loading="uploadingSbImageId === sb.id" @click="onUploadSbImageClick(sb)">上传</el-button>
                <el-tooltip content="高清放大（2x超分辨率）" placement="top">
                  <el-button
                    size="small"
                    :loading="upscalingSbIds.has(sb.id)"
                    :disabled="!getSbLocalImage(sb)"
                    @click="onUpscaleSbImage(sb)"
                  >
                    <el-icon><ZoomIn /></el-icon>超分
                  </el-button>
                </el-tooltip>
                </template>
              </div>
              </template>
            </div>
            <!-- 右：分镜视频（由 /videos?storyboard_id 拉取）；有视频时仍显示提示词与生成按钮便于调整后重新生成 -->
            <div
              class="sb-panel sb-video"
              :class="{ 'sb-video--revise': sbNeedsVideoRevision(sb) }"
            >
              <div v-if="getSbVideo(sb.id)" class="sb-video-review-bar">
                <span class="sb-video-review-label">审阅</span>
                <el-radio-group
                  :model-value="getSbVideoReview(sb)"
                  size="small"
                  class="sb-video-review-group"
                  @update:model-value="(v) => onSetSbVideoReview(sb, v)"
                >
                  <el-radio-button value="ok">可用</el-radio-button>
                  <el-radio-button value="revise">要修改</el-radio-button>
                </el-radio-group>
                <span v-if="sbNeedsVideoRevision(sb)" class="sb-video-review-hint">将纳入批量重生成</span>
              </div>
              <div v-if="getSbVideo(sb.id)" class="sb-video-area">
                <video
                  v-if="assetVideoUrl(getSbVideo(sb.id))"
                  :key="sbMainVideoPlayerKey(sb.id)"
                  :src="assetVideoUrl(getSbVideo(sb.id))"
                  controls
                  class="sb-video-player"
                  preload="metadata"
                />
                <div
                  v-else
                  class="sb-video-error"
                  :title="getSbVideoError(sb.id) || '视频地址无效'"
                >
                  <span>{{ getSbVideoError(sb.id) || '视频地址无效，请重新生成' }}</span>
                  <el-button
                    v-if="getSbResumableFailedVideo(sb.id)"
                    type="warning"
                    link
                    size="small"
                    class="sb-resume-poll-btn"
                    :loading="isSbVideoGenerating(sb.id)"
                    @click="onResumeSbVideoPoll(sb)"
                  >
                    继续查询
                  </el-button>
                </div>
                <span v-if="isSbVideoGenerating(sb.id)" class="sb-video-regenerating-overlay">
                  <el-icon class="is-loading"><Loading /></el-icon>
                  正在重新生成...
                </span>
              </div>
              <div v-else class="sb-video-area sb-video-placeholder">
                <span v-if="isSbVideoGenerating(sb.id)" class="sb-video-generating-text">
                  <el-icon class="is-loading"><Loading /></el-icon>
                  正在生成视频...
                </span>
                <template v-else>
                  <div v-if="getSbVideoError(sb.id)" class="sb-video-error">
                    <span>{{ getSbVideoError(sb.id) }}</span>
                    <el-button
                      v-if="getSbResumableFailedVideo(sb.id)"
                      type="warning"
                      link
                      size="small"
                      class="sb-resume-poll-btn"
                      :loading="isSbVideoGenerating(sb.id)"
                      @click="onResumeSbVideoPoll(sb)"
                    >
                      继续查询
                    </el-button>
                  </div>
                  <div class="sb-video-model-row">
                    <el-select
                      :model-value="getSbVideoModel(sb.id)"
                      size="small"
                      style="width: 150px"
                      @update:model-value="(v) => setSbVideoModel(sb.id, v)"
                    >
                      <el-option
                        v-for="opt in AGNES_VIDEO_MODEL_OPTIONS"
                        :key="opt.value"
                        :label="opt.label"
                        :value="opt.value"
                      />
                    </el-select>
                    <el-button
                      type="primary"
                      size="small"
                      class="sb-generate-video-btn"
                      :loading="isSbVideoGenerating(sb.id)"
                      :disabled="!sbCanSubmitVideo(sb) || isSbVideoGenerating(sb.id)"
                      :title="sbVideoBlockedReason(sb) || '生成分镜视频'"
                      @click="onGenerateSbVideo(sb)"
                    >
                      生成分镜视频
                    </el-button>
                  </div>
                </template>
              </div>
              <!-- 视频条：全部已完成视频（含当前），可切换 / 单条删除 -->
              <div v-if="getVideoStripItems(sb.id).length" class="sb-videos-strip">
                <el-tooltip content="分镜视频：点击切换当前；右上角可单条删除（仅一条时也可删，不必整集清空）" placement="top" :show-arrow="false">
                  <el-icon class="sb-strip-hint-icon"><InfoFilled /></el-icon>
                </el-tooltip>
                <div
                  v-for="item in getVideoStripItems(sb.id)"
                  :key="item.key"
                  class="sb-video-thumb"
                  :class="{ 'sb-video-thumb--current': item.isCurrent }"
                  :title="item.isCurrent ? `${item.label}（当前）` : `${item.label}（点击切换）`"
                  @click="onSelectSbMainVideo(sb, item.video)"
                >
                  <video :src="item.src" preload="metadata" class="sb-video-thumb-player" />
                  <button v-if="item.video?.id" class="extra-thumb-remove" title="删除此视频" @click.stop="onRemoveSbHistoryVideo(sb.id, item.video.id)">×</button>
                  <span class="sb-video-thumb-label">{{ item.label }}</span>
                </div>
              </div>
              <div v-if="getSbVideo(sb.id)" class="sb-video-actions">
                <el-select
                  :model-value="getSbVideoModel(sb.id)"
                  size="small"
                  style="width: 150px"
                  @update:model-value="(v) => setSbVideoModel(sb.id, v)"
                >
                  <el-option
                    v-for="opt in AGNES_VIDEO_MODEL_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <el-button size="small" :loading="isSbVideoGenerating(sb.id)" :disabled="!sbCanSubmitVideo(sb) || isSbVideoGenerating(sb.id)" :title="sbVideoBlockedReason(sb) || '重新生成'" @click="onGenerateSbVideo(sb)">重新生成</el-button>
                <el-tooltip v-if="getNextStoryboard(sb.id)" content="提取本视频尾帧，设为下一个分镜的首帧" placement="top">
                  <el-button size="small" :loading="linkingTailFrameIds.has(sb.id)" @click="onLinkTailFrameToNext(sb)">尾帧衔接</el-button>
                </el-tooltip>
                <el-tooltip v-if="sb.dialogue" content="对白配音（TTS）" placement="top">
                  <el-button size="small" :loading="ttsSbIds.has(sb.id)" @click="onTtsSbDialogue(sb)">
                    对白配音
                  </el-button>
                </el-tooltip>
                <el-tooltip v-if="sb.dialogue && sbDialogueAudioRelPath(sb)" content="播放对白配音" placement="top">
                  <el-button size="small" @click="playSbDialogueTts(sb)">
                    <el-icon><VideoPlay /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
              <div
                v-if="sbVideoLogVisible(sb.id)"
                class="sb-video-log"
              >
                <pre class="sb-video-log-body">{{ getSbVideoLogText(sb.id) }}</pre>
              </div>
              <div class="sb-video-prompt-label">
                <span class="sb-dot"></span>
                <span>视频提示词</span>
                <el-tag size="small" :type="sbVideoPromptStatusTag(sb).type" effect="plain" class="sb-prompt-status-tag">
                  {{ sbVideoPromptStatusTag(sb).text }}
                </el-tag>
              </div>
              <div class="sb-video-params-bar">
                <div class="sb-video-prompt-text sb-video-prompt-text--preview">{{ sb.video_prompt || '暂无视频提示词（在「视频配置」保存后自动生成）' }}</div>
                <el-button size="small" link type="primary" @click="onOpenSbPromptDialog(sb)">手工编辑</el-button>
              </div>
            </div>
          </div>
          </template>
          <div v-if="storyboards.length > STORYBOARD_PAGE_SIZE" class="sb-pagination-bar sb-pagination-bar--bottom">
            <el-pagination
              v-model:current-page="storyboardPage"
              :page-size="STORYBOARD_PAGE_SIZE"
              :total="storyboards.length"
              layout="total, prev, pager, next"
              background
              small
              @current-change="onStoryboardPageChange"
            />
          </div>
        </template>
        <!-- 分镜生成中提示条 -->
        <div v-if="storyboardGenerating || universalOmniPolishRunning" class="sb-generating-tip">
          <span class="sb-gen-dot" /><span class="sb-gen-dot" /><span class="sb-gen-dot" />
          <div class="sb-generating-tip-body">
            <span v-if="universalOmniPolishRunning" class="sb-gen-text">
              全能片段润色中 已完成 {{ universalOmniPolishProgress.current }}/{{ universalOmniPolishProgress.total }}
              <template v-if="universalOmniPolishProgress.label"> · {{ universalOmniPolishProgress.label }}</template>
            </span>
            <span v-else class="sb-gen-text">{{ storyboardGenStatusMessage || '分镜持续生成中，客官稍等片刻…' }}</span>
            <el-progress
              v-if="universalOmniPolishRunning && universalOmniPolishProgress.total > 0"
              class="universal-omni-polish-progress"
              :percentage="universalOmniPolishPercent"
              :stroke-width="10"
            />
          </div>
        </div>
        <div v-else-if="storyboards.length === 0" class="empty-tip">请先生成分镜</div>
      </section>

      <!-- 7. 视频配置 + AI 模型配置 -->
      <section class="section card">
        <h2 class="section-title">视频配置</h2>
        <div class="config-grid">
          <el-form-item label="分辨率">
            <el-select v-model="videoResolution" style="width: 160px">
              <el-option label="480p" value="480p" />
              <el-option label="720p" value="720p" />
              <el-option label="1080p" value="1080p" />
            </el-select>
          </el-form-item>
          <!--
          <el-form-item label="配乐">
            <el-select v-model="videoMusic" placeholder="无" clearable style="width: 160px">
              <el-option label="无" value="" />
            </el-select>
          </el-form-item>
          <el-form-item label="音效">
            <el-select v-model="videoSfx" placeholder="无" clearable style="width: 160px">
              <el-option label="无" value="" />
            </el-select>
          </el-form-item>
          <el-form-item label="画质">
            <el-select v-model="videoQuality" style="width: 120px">
              <el-option label="高" value="high" />
              <el-option label="中" value="medium" />
            </el-select>
          </el-form-item>
          -->
          <el-form-item label="字幕">
            <div class="video-option-row">
              <el-switch v-model="videoSubtitle" />
              <span v-if="videoSubtitle" class="video-option-hint">开启后会烧录解说字幕：全文解说模式下在<strong>单镜视频生成后</strong>已混旁白并烧字幕，合成整集时不再二次烧录（避免叠两层字）；非全文解说模式则在合成整集时生成 SRT 并烧录。字幕固定距底边 12 像素。</span>
            </div>
          </el-form-item>
          <el-form-item label="对白烧录">
            <div class="video-option-row">
              <el-switch v-model="videoBurnDialogue" />
              <span v-if="videoBurnDialogue" class="video-option-hint">开启后，将把各镜「配音」生成的对白 TTS 按分镜时长对齐并混入整集成片（无对白音频的分镜为静音）。可与「字幕」旁白同时开启，两条音轨会叠混。</span>
            </div>
          </el-form-item>
          <el-form-item label="水印">
            <div class="video-option-row">
              <el-switch v-model="videoWatermark" />
              <el-input
                v-if="videoWatermark"
                v-model="videoWatermarkText"
                placeholder="右上角水印文字"
                maxlength="200"
                show-word-limit
                clearable
                class="video-watermark-input"
              />
            </div>
          </el-form-item>
          <el-form-item v-if="storyboardFullNarrationVideoMode" label="旁白范围">
            <span class="video-option-hint">正文旁白从第 1 镜起连续绑定。可选片头见下方「合成视频」区的片头分镜（独立旁白，不占用正文镜号）。</span>
          </el-form-item>
        </div>
        <p class="config-tip">文本/图片/视频使用的模型以「<el-link type="primary" underline="never" @click="showAiConfigDialog = true">AI 配置</el-link>」中设为默认的为准；旁白克隆音色与一键配音见上方「分镜生成」区。</p>
      </section>

      <!-- 8. 合成视频 -->
      <section id="anchor-video" class="section card">
        <h2 class="section-title">合成视频</h2>

        <div class="intro-panel">
          <h3 class="intro-panel-title">片头分镜</h3>
          <p class="intro-panel-hint">
            自填旁白，选用本集角色/场景/道具参考图生成片头视频（旁白配音 + 字幕，无需分镜图）。有片头视频时，合成默认前置拼入成片。
            视频模型与上方「分镜生成」区的 Agnes 默认模型一致（当前：{{ AGNES_VIDEO_MODEL_OPTIONS.find(o => o.value === defaultVideoModel)?.label || defaultVideoModel }}）。
          </p>
          <el-form label-width="88px" class="intro-form">
            <el-form-item label="片头旁白" required>
              <el-input
                v-model="introNarration"
                type="textarea"
                :rows="3"
                maxlength="500"
                show-word-limit
                placeholder="例如：在这个被遗忘的小镇上，一段秘密即将被揭开……"
              />
            </el-form-item>
            <el-form-item label="角色">
              <el-select
                v-model="introCharacterIds"
                multiple
                filterable
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="选用本集角色"
                style="width: 100%; max-width: 520px"
              >
                <el-option
                  v-for="c in characters"
                  :key="c.id"
                  :label="c.name || `角色#${c.id}`"
                  :value="c.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="场景">
              <el-select
                v-model="introSceneId"
                clearable
                filterable
                placeholder="选用本集场景"
                style="width: 100%; max-width: 520px"
              >
                <el-option
                  v-for="s in scenes"
                  :key="s.id"
                  :label="s.location || s.name || `场景#${s.id}`"
                  :value="s.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="道具">
              <el-select
                v-model="introPropIds"
                multiple
                filterable
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="选用本集道具"
                style="width: 100%; max-width: 520px"
              >
                <el-option
                  v-for="p in props"
                  :key="p.id"
                  :label="p.name || `道具#${p.id}`"
                  :value="p.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="合成">
              <div class="video-option-row">
                <el-checkbox
                  v-model="includeIntroInMerge"
                  :disabled="!introHasVideo"
                >
                  合成时包含片头
                </el-checkbox>
                <span class="video-option-hint">
                  {{ introHasVideo ? '有片头视频时默认勾选，成片最前拼接片头。' : '请先生成片头视频后再勾选。' }}
                </span>
              </div>
            </el-form-item>
          </el-form>
          <div class="intro-actions">
            <el-button :loading="introSaving" :disabled="!currentEpisodeId" @click="onSaveIntroStoryboard">
              保存片头
            </el-button>
            <el-button
              :loading="introTtsRunning"
              :disabled="!currentEpisodeId || !introNarration.trim()"
              @click="onIntroGenerateTts({ force: true })"
            >
              {{ introHasNarrationAudio ? '重新生成配音' : '生成配音' }}
            </el-button>
            <el-button
              :loading="introPromptsRunning"
              :disabled="!currentEpisodeId || !introNarration.trim()"
              @click="onIntroGeneratePrompts({ force: true })"
            >
              {{ introHasPrompts ? '重新生成提示词' : '生成提示词' }}
            </el-button>
            <el-button
              :loading="introImageRunning"
              :disabled="!introStoryboardId"
              @click="onIntroGenerateImage({ force: true })"
            >
              {{ introHasImage ? '重新生图（可选）' : '生图（可选）' }}
            </el-button>
            <el-button
              type="success"
              :loading="introVideoRunning"
              :disabled="!introStoryboardId"
              @click="onIntroGenerateVideo({ force: true })"
            >
              {{ introHasVideo ? '重新生视频' : '生视频' }}
            </el-button>
            <el-button
              type="primary"
              :loading="introPipelineRunning"
              :disabled="!currentEpisodeId || !introNarration.trim()"
              @click="onIntroOneClickGenerate"
            >
              一键生成片头
            </el-button>
          </div>
          <div v-if="introStoryboardId" class="intro-readiness">
            <span class="intro-readiness-label">片头进度</span>
            <el-tag size="small" :type="introHasNarrationAudio ? 'success' : 'info'">
              配音 {{ introHasNarrationAudio ? '已就绪' : '未生成' }}
            </el-tag>
            <el-tag size="small" :type="introHasPrompts ? 'success' : 'info'">
              提示词 {{ introHasPrompts ? '已就绪' : '未生成' }}
            </el-tag>
            <el-tag size="small" :type="introHasRefs ? 'success' : 'info'">
              参考图 {{ introHasRefs ? '已就绪' : '未选或无图' }}
            </el-tag>
            <el-tag size="small" :type="introHasImage ? 'success' : 'info'">
              分镜图 {{ introHasImage ? '已有（可选）' : '可选' }}
            </el-tag>
            <el-tag size="small" :type="introHasVideo ? 'success' : 'info'">
              视频 {{ introHasVideo ? '已就绪' : '未生成' }}
            </el-tag>
          </div>
          <div v-if="introHasNarrationAudio && introAudioPreviewUrl" class="intro-preview-row">
            <p class="video-preview-label">片头配音试听</p>
            <audio :src="introAudioPreviewUrl" controls preload="metadata" class="intro-audio-preview" />
          </div>
          <div v-if="introHasPrompts && introPromptPreview" class="intro-preview-row">
            <p class="video-preview-label">片头提示词（生图 / 生视频）</p>
            <p class="intro-prompt-preview">{{ introPromptPreview }}</p>
          </div>
          <div v-if="introStatusHint" class="intro-status-hint">{{ introStatusHint }}</div>
          <div v-if="introPreviewImageUrl || introImageStrip.length" class="intro-preview-row">
            <div class="intro-video-preview-head">
              <p class="video-preview-label">片头分镜图（可选）</p>
              <el-button
                v-if="introCanClearImageBinding"
                link
                type="danger"
                size="small"
                @click="onRemoveIntroImageBinding"
              >
                删除分镜图
              </el-button>
              <el-button
                v-else-if="introPreviewImageUrl && introImageStrip.length <= 1 && introImageStrip[0]?.img?.id"
                link
                type="danger"
                size="small"
                @click="onRemoveIntroImage(introImageStrip[0].img.id)"
              >
                删除分镜图
              </el-button>
            </div>
            <img
              v-if="introPreviewImageUrl"
              :src="introPreviewImageUrl"
              class="intro-preview-img"
              alt="片头分镜图"
            />
            <div v-if="introImageStrip.length > 1" class="sb-imgs-strip intro-image-strip">
              <div
                v-for="item in introImageStrip"
                :key="item.key"
                class="sb-img-thumb"
                :class="{ 'sb-img-thumb--current': item.isCurrent }"
                :title="item.isCurrent ? `${item.label}（当前）` : `${item.label}（点击切换）`"
                @click="onSelectIntroImage(item.img)"
              >
                <img :src="item.src" alt="" />
                <span class="sb-img-thumb-label">{{ item.label }}</span>
                <button
                  v-if="item.img?.id"
                  class="extra-thumb-remove"
                  title="删除此图"
                  @click.stop="onRemoveIntroImage(item.img.id)"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
          <div v-if="introPreviewVideoUrl || introVideoStrip.length" class="intro-preview-row">
            <div class="intro-video-preview-head">
              <p class="video-preview-label">片头视频预览</p>
              <el-button
                v-if="introPreviewVideoUrl && introVideoStrip.length <= 1 && introVideoStrip[0]?.video?.id"
                link
                type="danger"
                size="small"
                @click="onRemoveIntroVideo(introVideoStrip[0].video.id)"
              >
                删除当前视频
              </el-button>
            </div>
            <video
              v-if="introPreviewVideoUrl"
              :src="introPreviewVideoUrl"
              controls
              class="video-preview-player"
              preload="metadata"
            />
            <div v-if="introVideoStrip.length" class="sb-videos-strip intro-video-strip">
              <div
                v-for="item in introVideoStrip"
                :key="item.key"
                class="sb-video-thumb"
                :class="{ 'sb-video-thumb--current': item.isCurrent }"
                :title="item.isCurrent ? `${item.label}（当前）` : `${item.label}（点击切换）`"
                @click="onSelectIntroVideo(item.video)"
              >
                <video :src="item.src" preload="metadata" class="sb-video-thumb-player" />
                <button
                  v-if="item.video?.id"
                  class="extra-thumb-remove"
                  title="删除此视频"
                  @click.stop="onRemoveIntroVideo(item.video.id)"
                >
                  ×
                </button>
                <span class="sb-video-thumb-label">{{ item.label }}</span>
              </div>
            </div>
          </div>
        </div>

        <el-button
          type="primary"
          size="large"
          :loading="videoStatus === 'generating'"
          :disabled="!currentEpisodeId || storyboards.length === 0 || videoStatus === 'generating'"
          @click="onGenerateVideo"
        >
          合成视频
        </el-button>
        <div v-if="videoStatus === 'generating'" class="video-progress">
          <el-progress :percentage="videoProgress" :status="videoProgress >= 100 ? 'success' : undefined" />
          <p>视频生成中...</p>
        </div>
        <div v-if="videoStatus === 'done'" class="video-done">
          <el-alert type="success" title="视频生成完成" show-icon />
        </div>
        <div v-else-if="videoStatus === 'error'" class="video-error">
          <el-alert type="error" :title="videoErrorMsg" show-icon />
        </div>
        <div v-if="currentEpisodeVideoUrl" class="video-preview-wrap">
          <p class="video-preview-label">本集合成视频预览（原片，不含 BGM）</p>
          <video
            :src="currentEpisodeVideoUrl"
            controls
            class="video-preview-player"
            preload="metadata"
          />
        </div>

        <!-- BGM / 音效：在合成视频旁，混入后另出成片，原片保留 -->
        <div class="bgm-panel">
          <h3 class="bgm-panel-title">BGM 生成</h3>
          <p class="bgm-panel-hint">
            先合成视频，再生成配乐并混入成片。
            <strong>原合成视频会保留</strong>，方便多次合成与对比试听。
            画面事件音效请用下方 <strong>Foley</strong> 面板。
          </p>
          <div v-if="isAceStepBgmModel" class="bgm-acestep-head">
            <el-tag v-if="aceStepModelLoaded" type="success" size="small">ACE-Step 已就绪</el-tag>
            <el-tag v-else-if="aceStepOnline" type="info" size="small">服务在线 · 模型未加载</el-tag>
            <el-tag v-else type="warning" size="small">ACE-Step 未启动</el-tag>
            <el-button
              size="small"
              type="primary"
              :loading="aceStepStarting"
              :disabled="aceStepModelLoaded || aceStepStarting"
              @click="onStartAceStep"
            >
              启动
            </el-button>
            <el-button
              size="small"
              plain
              type="danger"
              :loading="aceStepUnloading"
              :disabled="!aceStepOnline || aceStepUnloading"
              @click="onUnloadAceStep"
            >
              卸载
            </el-button>
          </div>
          <el-form label-width="100px" class="bgm-form">
            <el-form-item label="生成模型">
              <el-select v-model="bgmModel" style="width: 320px">
                <el-option label="ACE-Step 本地 · 纯器乐 BGM（推荐）" value="ace_step_local" />
                <el-option label="Suno · 纯器乐（云端）" value="suno_music_open" />
                <el-option label="Suno chirp-v3-5（云端）" value="chirp-v3-5" />
              </el-select>
            </el-form-item>
            <el-form-item label="配乐描述">
              <el-input
                v-model="bgmDescription"
                type="textarea"
                :rows="2"
                maxlength="400"
                show-word-limit
                placeholder="可手写，或点「AI 生成描述」根据本集氛围自动填写"
              />
            </el-form-item>
            <el-form-item label="BGM 音量">
              <el-slider v-model="bgmMixVolume" :min="3" :max="25" :step="1" style="max-width: 280px" />
              <span class="video-option-hint">{{ bgmMixVolume }}%（相对旁白，默认 12%）</span>
            </el-form-item>
          </el-form>
          <div class="bgm-actions">
            <el-button :loading="bgmSuggesting" :disabled="!currentEpisodeId" @click="onSuggestBgmDescription">
              AI 生成描述
            </el-button>
            <el-button
              type="success"
              :loading="bgmGenerating"
              :disabled="!currentEpisodeId || bgmGenerating"
              @click="onGenerateBgm"
            >
              生成 BGM
            </el-button>
            <el-button
              type="warning"
              :loading="bgmMixing"
              :disabled="!currentEpisodeId || !currentEpisodeVideoUrl || bgmMixing || (!bgmLibraryReady && !currentEpisodeBgmPath)"
              @click="onMixBgmToVideo"
            >
              混入成片（保留原片）
            </el-button>
            <el-button link type="primary" :disabled="!currentEpisodeId" @click="loadBgmLibrary">刷新列表</el-button>
          </div>
          <div v-if="bgmMoodHint" class="bgm-mood-hint">{{ bgmMoodHint }}</div>
          <div v-if="bgmLibraryReady && !currentEpisodeBgmVideoUrl && currentEpisodeVideoUrl" class="bgm-mood-hint">
            BGM/音效已生成完成，请点击「混入成片（保留原片）」得到带配乐的视频。
          </div>
          <div v-if="bgmLibrary.length" class="bgm-library">
            <p class="bgm-library-label">本集配乐库</p>
            <div v-for="item in bgmLibrary" :key="item.id" class="bgm-library-row">
              <el-tag size="small" :type="item.kind === 'sfx' ? 'danger' : 'success'">
                {{ item.kind === 'sfx' ? '音效' : 'BGM' }}
              </el-tag>
              <span class="bgm-library-status">{{ item.status }}</span>
              <span class="bgm-library-title">{{ item.title || item.description || `#${item.id}` }}</span>
              <audio v-if="item.local_path && item.status === 'completed'" :src="toStaticUrl(item.local_path)" controls preload="none" class="bgm-audio" />
              <el-button
                v-if="item.status === 'completed'"
                link
                type="primary"
                size="small"
                @click="onApplyBgmItem(item)"
              >
                选用
              </el-button>
              <span v-if="item.error_msg" class="bgm-library-err">{{ item.error_msg }}</span>
            </div>
          </div>
          <div v-if="currentEpisodeBgmVideoUrl" class="video-preview-wrap bgm-video-preview">
            <p class="video-preview-label">带 BGM 成片预览（原片仍在上方）</p>
            <video
              :src="currentEpisodeBgmVideoUrl"
              controls
              class="video-preview-player"
              preload="metadata"
            />
          </div>
        </div>

        <!-- Foley：分镜抽帧 → Agnes 事件 → 短音 → 独立混入（与 BGM 分开） -->
        <div class="bgm-panel foley-panel">
          <h3 class="bgm-panel-title">画面音效（Foley）</h3>
          <p class="bgm-panel-hint">
            按分镜视频每 <strong>3 秒</strong>抽一帧，用 Agnes 视觉标出明显事件音（关门、按键等），再本地生成短音并按时间轴混入。
            <strong>与上方 BGM 相互独立</strong>：结果写入单独的 Foley 成片。
          </p>
          <div class="bgm-acestep-head">
            <el-tag v-if="foleyStatus === 'mixed'" type="success" size="small">已混入成片</el-tag>
            <el-tag v-else-if="foleyStatus === 'generated'" type="success" size="small">短音已生成</el-tag>
            <el-tag v-else-if="foleyStatus === 'analyzed'" type="info" size="small">已分析</el-tag>
            <el-tag v-else-if="foleyStatus === 'analyzing' || foleyStatus === 'generating'" type="warning" size="small">处理中…</el-tag>
            <el-tag v-else-if="foleyStatus === 'failed'" type="danger" size="small">失败</el-tag>
            <el-tag v-else type="info" size="small">未开始</el-tag>
          </div>
          <el-form label-width="110px" class="bgm-form">
            <el-form-item label="视觉模型">
              <el-select v-model="foleyVisionModel" style="width: 280px">
                <el-option label="Agnes 2.5 Flash（推荐）" value="agnes-2.5-flash" />
                <el-option label="Agnes 2.0 Flash" value="agnes-2.0-flash" />
              </el-select>
            </el-form-item>
            <el-form-item label="混入底片">
              <el-radio-group v-model="foleyMixSource">
                <el-radio value="original">合成原片</el-radio>
                <el-radio value="bgm" :disabled="!currentEpisodeBgmVideoUrl">带 BGM 成片</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="Foley 音量">
              <el-slider v-model="foleyMixVolume" :min="20" :max="100" :step="5" style="max-width: 280px" />
              <span class="video-option-hint">{{ foleyMixVolume }}%</span>
            </el-form-item>
          </el-form>
          <div class="bgm-actions">
            <el-button
              type="primary"
              :loading="foleyAnalyzing"
              :disabled="!currentEpisodeId || foleyAnalyzing"
              @click="onAnalyzeFoley"
            >
              1. 分析画面音效
            </el-button>
            <el-button
              type="success"
              :loading="foleyGenerating"
              :disabled="!currentEpisodeId || !foleyEvents.length || foleyGenerating"
              @click="onGenerateFoley"
            >
              2. 生成短音
            </el-button>
            <el-button
              type="warning"
              :loading="foleyMixing"
              :disabled="!currentEpisodeId || !foleyReadyCount || foleyMixing || !currentEpisodeVideoUrl"
              @click="onMixFoleyToVideo"
            >
              3. 混入成片
            </el-button>
            <el-button link type="primary" :disabled="!currentEpisodeId" @click="loadFoleyState">刷新</el-button>
          </div>
          <div v-if="foleyError" class="bgm-library-err" style="margin-top: 8px">{{ foleyError }}</div>
          <div v-if="foleyEvents.length" class="bgm-library">
            <p class="bgm-library-label">音效事件（{{ foleyEvents.length }}）· 已生成 {{ foleyReadyCount }}</p>
            <div v-for="item in foleyEvents" :key="item.id" class="bgm-library-row">
              <el-tag size="small" :type="item.confidence === 'high' ? 'danger' : 'info'">
                {{ item.label || 'sfx' }}
              </el-tag>
              <span class="bgm-library-status">{{ item.status }}</span>
              <span class="bgm-library-title">
                {{ formatFoleyTime(item.t_episode_sec) }} · 镜{{ item.storyboard_number }} · {{ item.description || item.prompt }}
              </span>
              <audio
                v-if="item.audio_path && item.status === 'completed'"
                :src="toStaticUrl(item.audio_path)"
                controls
                preload="none"
                class="bgm-audio"
              />
              <span v-if="item.error" class="bgm-library-err">{{ item.error }}</span>
            </div>
          </div>
          <div v-if="currentEpisodeFoleyVideoUrl" class="video-preview-wrap bgm-video-preview">
            <p class="video-preview-label">带 Foley 成片预览（与 BGM 成片独立）</p>
            <video
              :src="currentEpisodeFoleyVideoUrl"
              controls
              class="video-preview-player"
              preload="metadata"
            />
          </div>
        </div>
      </section>
    </main>

    <!-- 添加道具弹窗 -->
    <el-dialog v-model="showAddProp" title="添加道具" width="600px" @close="() => { addPropForm = { name: '', type: '', description: '', prompt: '' }; addPropAddRefImage = null }">
      <el-form label-width="90px">
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" @click="addPropAddRefFileInput?.click()" @drop.prevent="onRefImageDrop2('addProp', $event)" @dragover.prevent>
              <img v-if="addPropAddRefImage" :src="addPropAddRefImage.dataUrl" class="ref-preview-img" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="addPropAddRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingPropAddDesc" @click="doExtractFromRef2('addProp')">提取特征描述</el-button>
              <el-button size="small" @click="addPropAddRefImage = null">移除</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="addPropForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="类型">
          <el-input v-model="addPropForm.type" placeholder="如：物品、建筑" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="addPropForm.description" type="textarea" :rows="3" placeholder="描述" />
        </el-form-item>
        <el-form-item label="图生提示词">
          <el-input v-model="addPropForm.prompt" type="textarea" :rows="2" placeholder="用于 AI 生成图片的提示词" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddProp = false">取消</el-button>
        <el-button type="primary" :loading="addPropSaving" :disabled="!addPropForm.name.trim()" @click="submitAddProp">确定</el-button>
      </template>
    </el-dialog>

    <!-- 隐藏的文件输入框（放在弹窗外层，避免 el-form-item 干扰） -->
    <input ref="addCharRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('character', $event)" />
    <input ref="addSceneRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('scene', $event)" />
    <input ref="addPropRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange('prop', $event)" />
    <input ref="addPropAddRefFileInput" type="file" accept="image/*" style="display:none" @change="onRefImageFileChange2('addProp', $event)" />

    <!-- 添加/编辑角色弹窗 -->
    <el-dialog v-model="showEditCharacter" :title="editCharacterForm?.id ? '编辑角色' : '添加角色'" width="75%" @close="onCloseCharDialog">
      <el-form v-if="editCharacterForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" @click="addCharRefFileInput?.click()" @drop.prevent="onRefImageDrop('character', $event)" @dragover.prevent>
              <!-- 优先：刚上传的新参考图 -->
              <img v-if="addCharRefImage" :src="addCharRefImage.dataUrl" class="ref-preview-img" />
              <!-- 次之：已保存的参考图 -->
              <img v-else-if="editCharacterForm.ref_image"
                :src="editCharacterForm.ref_image.startsWith('http') ? editCharacterForm.ref_image : '/static/' + editCharacterForm.ref_image"
                class="ref-preview-img" />
              <!-- 最后：主图（半透明，提示可上传参考图替代） -->
              <img v-else-if="editCharacterForm.id && (editCharacterForm.image_url || editCharacterForm.local_path)"
                :src="assetImageUrl(editCharacterForm)"
                class="ref-preview-img" style="opacity:0.5" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="addCharRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingCharAppearance" @click="doExtractFromRef('character')">提取特征描述</el-button>
              <el-button size="small" @click="addCharRefImage = null">移除</el-button>
            </div>
            <div v-else-if="editCharacterForm.ref_image" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingCharAppearance" @click="doExtractCharFromImage">从参考图提取描述</el-button>
              <el-button size="small" @click="clearCharRefImage">移除参考图</el-button>
            </div>
            <div v-else-if="editCharacterForm.id && (editCharacterForm.image_url || editCharacterForm.local_path) && !editCharacterForm.appearance" class="ref-actions">
              <el-button size="small" :loading="extractingCharAppearance" @click="doExtractCharFromImage">从主图提取描述</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="editCharacterForm.name" placeholder="角色名称" />
        </el-form-item>
        <el-form-item label="身份/定位">
          <el-select v-model="editCharacterForm.role" placeholder="请选择角色类型" style="width:200px">
            <el-option value="main" label="主角" />
            <el-option value="supporting" label="配角" />
            <el-option value="minor" label="次要角色" />
          </el-select>
        </el-form-item>
        <el-form-item label="外貌描述">
          <el-input v-model="editCharacterForm.appearance" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" placeholder="用于 AI 生成图像的外貌描述，尽量详细" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="editCharacterForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="角色背景简介，供剧本生成参考" />
        </el-form-item>
        <el-form-item v-if="editCharacterForm.id">
          <template #label>
            <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">图生提示词</span>
          </template>
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 润色后的最终提示词，生成四视图图片时直接使用；可手动修改</span>
              <el-button
                size="small"
                :loading="editCharacterPromptGenerating"
                @click="doGenerateCharacterPrompt"
              >重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editCharacterForm.polished_prompt"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              :placeholder="editCharacterPromptGenerating ? 'AI 正在生成提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
              :disabled="editCharacterPromptGenerating"
              style="font-size:12px"
            />
          </div>
        </el-form-item>
        <!-- P0-2: 视觉锚点（identity_anchors） -->
        <el-form-item v-if="editCharacterForm.id" label="视觉锚点">
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 从外貌描述提炼的6层视觉特征，用于保持生成图片角色一致性</span>
              <el-button
                size="small"
                :loading="extractingAnchors"
                :disabled="!editCharacterForm.appearance"
                @click="extractIdentityAnchors"
              >提炼视觉锚点</el-button>
            </div>
            <el-input
              v-if="editCharacterForm.identity_anchors"
              :value="typeof editCharacterForm.identity_anchors === 'string'
                ? editCharacterForm.identity_anchors
                : JSON.stringify(editCharacterForm.identity_anchors, null, 2)"
              type="textarea"
              :rows="4"
              readonly
              style="font-size:11px;font-family:monospace"
              placeholder="点击「提炼视觉锚点」生成"
            />
            <div v-else style="font-size:12px;color:#c0c4cc;padding:4px 0">暂无锚点，点击「提炼视觉锚点」自动提炼</div>
          </div>
        </el-form-item>
        <!-- P1-3: 多阶段造型（stages） -->
        <el-form-item v-if="editCharacterForm.id" label="多阶段造型">
          <div style="width:100%">
            <div style="font-size:12px;color:#909399;margin-bottom:6px">
              不同集次的角色造型变化，格式：JSON 数组 [{"episode_range":[1,3],"appearance":"..."}]
            </div>
            <el-input
              v-model="editCharacterForm.stages"
              type="textarea"
              :rows="4"
              placeholder='例：[{"episode_range":[1,5],"appearance":"白衣少年"},{"episode_range":[6,10],"appearance":"黑衣武者"}]'
              style="font-size:12px;font-family:monospace"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditCharacter = false">取消</el-button>
        <el-button type="primary" :loading="editCharacterSaving" :disabled="!editCharacterForm?.name?.trim()" @click="submitEditCharacter">{{ editCharacterForm?.id ? '保存' : '添加' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="showCharSd2Cert"
      title="SD2 认证详情"
      width="min(720px, 92vw)"
      destroy-on-close
      class="sd2-cert-dialog"
    >
      <template v-if="charSd2CertPayload">
        <el-descriptions :column="1" border size="small" class="sd2-cert-desc">
          <el-descriptions-item label="素材 ID">
            <span class="sd2-cert-value">{{ charSd2CertPayload.hub_asset_id || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="asset_url">
            <code class="sd2-cert-value">{{ charSd2CertPayload.asset_url || '—' }}</code>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <span class="sd2-cert-value">{{ charSd2CertPayload.status || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="注册图片 URL">
            <span class="sd2-cert-value">{{ charSd2CertPayload.source_image_url || '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item v-if="charSd2CertPayload.sd2_provider" label="认证提供方">
            <span class="sd2-cert-value">{{ charSd2CertPayload.sd2_provider }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </template>
      <template #footer>
        <el-button @click="showCharSd2Cert = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 编辑道具弹窗 -->
    <el-dialog v-model="showEditProp" :title="editPropForm?.id ? '编辑道具' : '添加道具'" width="75%" @close="onClosePropDialog">
      <el-form v-if="editPropForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" @click="addPropRefFileInput?.click()" @drop.prevent="onRefImageDrop('prop', $event)" @dragover.prevent>
              <img v-if="addPropRefImage" :src="addPropRefImage.dataUrl" class="ref-preview-img" />
              <img v-else-if="editPropForm.ref_image"
                :src="editPropForm.ref_image.startsWith('http') ? editPropForm.ref_image : '/static/' + editPropForm.ref_image"
                class="ref-preview-img" />
              <img v-else-if="editPropForm.id && (editPropForm.image_url || editPropForm.local_path)"
                :src="assetImageUrl(editPropForm)" class="ref-preview-img" style="opacity:0.5" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="addPropRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingPropDesc" @click="doExtractFromRef('prop')">提取特征描述</el-button>
              <el-button size="small" @click="addPropRefImage = null">移除</el-button>
            </div>
            <div v-else-if="editPropForm.ref_image" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingPropDesc" @click="doExtractPropFromImage">从参考图提取描述</el-button>
              <el-button size="small" @click="clearPropRefImage">移除参考图</el-button>
            </div>
            <div v-else-if="editPropForm.id && (editPropForm.image_url || editPropForm.local_path) && !editPropForm.description" class="ref-actions">
              <el-button size="small" :loading="extractingPropDesc" @click="doExtractPropFromImage">从主图提取描述</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="editPropForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="类型">
          <el-input v-model="editPropForm.type" placeholder="如：物品、建筑" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editPropForm.description" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="道具描述" />
        </el-form-item>
        <el-form-item label="图生提示词">
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 润色后的图片提示词，生成图片时直接使用；可手动修改</span>
              <el-button size="small" :loading="editPropPromptGenerating" @click="doGeneratePropPrompt">重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editPropForm.prompt"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              :placeholder="editPropPromptGenerating ? 'AI 正在生成提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
              :disabled="editPropPromptGenerating"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditProp = false">取消</el-button>
        <el-button type="primary" :loading="editPropSaving" :disabled="!editPropForm?.name?.trim()" @click="submitEditProp">保存</el-button>
      </template>
    </el-dialog>

    <!-- 添加/编辑场景弹窗 -->
    <el-dialog v-model="showEditScene" :title="editSceneForm?.id ? '编辑场景' : '添加场景'" width="75%" @close="onCloseSceneDialog">
      <el-form v-if="editSceneForm" label-width="90px">
        <!-- 参考图上传区（新增/编辑均显示） -->
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" @click="addSceneRefFileInput?.click()" @drop.prevent="onRefImageDrop('scene', $event)" @dragover.prevent>
              <img v-if="addSceneRefImage" :src="addSceneRefImage.dataUrl" class="ref-preview-img" />
              <img v-else-if="editSceneForm.ref_image"
                :src="editSceneForm.ref_image.startsWith('http') ? editSceneForm.ref_image : '/static/' + editSceneForm.ref_image"
                class="ref-preview-img" />
              <img v-else-if="editSceneForm.id && (editSceneForm.image_url || editSceneForm.local_path)"
                :src="assetImageUrl(editSceneForm)" class="ref-preview-img" style="opacity:0.5" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="addSceneRefImage" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingSceneDesc" @click="doExtractFromRef('scene')">提取特征描述</el-button>
              <el-button size="small" @click="addSceneRefImage = null">移除</el-button>
            </div>
            <div v-else-if="editSceneForm.ref_image" class="ref-actions">
              <el-button type="primary" size="small" :loading="extractingSceneDesc" @click="doExtractSceneFromImage">从参考图提取描述</el-button>
              <el-button size="small" @click="clearSceneRefImage">移除参考图</el-button>
            </div>
            <div v-else-if="editSceneForm.id && (editSceneForm.image_url || editSceneForm.local_path) && !editSceneForm.prompt" class="ref-actions">
              <el-button size="small" :loading="extractingSceneDesc" @click="doExtractSceneFromImage">从主图提取描述</el-button>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="地点" required>
          <el-input v-model="editSceneForm.location" placeholder="如：森林、教室" />
        </el-form-item>
        <el-form-item label="时间">
          <el-input v-model="editSceneForm.time" placeholder="如：白天、傍晚" />
        </el-form-item>
        <el-form-item label="场景描述">
          <el-input v-model="editSceneForm.prompt" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="场景的简要描述，供 AI 生成四视图时参考" />
        </el-form-item>
        <el-form-item v-if="editSceneForm.id">
          <template #label>
            <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">单图提示词</span>
          </template>
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">单图场景的完整图片提示词（不含四宫格布局），生图时直接使用；可手动修改</span>
              <el-button size="small" :loading="editScenePromptGenerating" @click="doGenerateSceneSinglePrompt">重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editSceneForm.polished_prompt_single"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              placeholder="单图场景提示词，点击场景列表的「AI 生成」按钮（不勾选四宫格）后会自动生成"
              style="font-size:12px"
            />
          </div>
        </el-form-item>
        <el-form-item v-if="editSceneForm.id">
          <template #label>
            <span style="font-size:12px;line-height:1.4;white-space:normal;word-break:break-all;display:inline-block;width:90px">四视图提示词</span>
          </template>
          <div style="width:100%">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span style="font-size:12px;color:#909399">AI 生成的完整四视图图片提示词，生图时直接使用；可手动修改</span>
              <el-button size="small" :loading="editScenePromptGenerating" @click="doGenerateScenePrompt">重新生成提示词</el-button>
            </div>
            <el-input
              v-model="editSceneForm.polished_prompt"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 16 }"
              :placeholder="editScenePromptGenerating ? 'AI 正在生成四视图提示词，请稍候…' : '点击「重新生成提示词」由 AI 自动生成，或直接在此输入'"
              :disabled="editScenePromptGenerating"
              style="font-size:12px"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditScene = false">取消</el-button>
        <el-button type="primary" :loading="editSceneSaving" :disabled="!editSceneForm?.location?.trim()" @click="submitEditScene">{{ editSceneForm?.id ? '保存' : '添加' }}</el-button>
      </template>
    </el-dialog>

    <!-- 角色资源库（本剧库 / 本剧全部角色 / 团队库） -->
    <el-dialog v-model="showCharLibrary" title="角色资源库" width="720px" destroy-on-close class="library-dialog" @open="onCharLibraryDialogOpen">
      <el-tabs v-model="charLibraryTab" class="char-library-tabs" @tab-change="onCharLibraryTabChange">
        <el-tab-pane label="本剧角色库" name="library">
          <div class="library-toolbar">
            <el-input v-model="charLibraryKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadCharLibrary()" />
          </div>
          <div v-loading="charLibraryLoading" class="library-list">
            <div v-for="item in charLibraryList" :key="'lib-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || '').slice(0, 60) }}{{ (item.description || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isCharAddToEpisodeLoading('library', item.id)" :disabled="!currentEpisodeId" @click="onAddCharFromLibrary(item)">加入本集</el-button>
                  <el-button size="small" @click="openEditCharLibrary(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="onDeleteCharLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!charLibraryLoading && charLibraryList.length === 0" class="library-empty">暂无本剧角色库记录，可将本剧角色「加入本剧库」后在此查看</div>
          </div>
          <div class="library-pagination">
            <el-pagination
              v-model:current-page="charLibraryPage"
              v-model:page-size="charLibraryPageSize"
              :total="charLibraryTotal"
              :page-sizes="[10, 20, 50]"
              layout="total, sizes, prev, pager, next"
              @current-change="loadCharLibraryList"
              @size-change="loadCharLibraryList"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane label="本剧所有角色" name="drama">
          <div class="library-toolbar">
            <el-input v-model="dramaAllCharKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllCharList()" />
          </div>
          <div v-loading="dramaAllCharLoading" class="library-list">
            <div v-for="item in dramaAllCharList" :key="'drama-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">
                  {{ item.name || '未命名' }}
                  <el-tag v-if="item.role" size="small" type="info" style="margin-left: 6px">{{ charRoleLabel(item.role) }}</el-tag>
                </div>
                <div class="library-item-desc">{{ (item.description || item.appearance || '').slice(0, 60) }}{{ (item.description || item.appearance || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isCharAddToEpisodeLoading('drama', item.id)" :disabled="!currentEpisodeId" @click="onAddDramaCharToEpisode(item)">加入本集</el-button>
                </div>
              </div>
            </div>
            <div v-if="!dramaAllCharLoading && dramaAllCharList.length === 0" class="library-empty">本剧暂无制作角色，请先在角色面板创建</div>
          </div>
          <div class="library-pagination">
            <el-pagination
              v-model:current-page="dramaAllCharPage"
              v-model:page-size="dramaAllCharPageSize"
              :total="dramaAllCharTotal"
              :page-sizes="[10, 20, 50]"
              layout="total, sizes, prev, pager, next"
              @current-change="loadDramaAllCharList"
              @size-change="loadDramaAllCharList"
            />
          </div>
        </el-tab-pane>

      </el-tabs>
      <template #footer>
        <el-button @click="showCharLibrary = false">关闭</el-button>
      </template>
    </el-dialog>
    <!-- 编辑公共角色 -->
    <el-dialog v-model="showEditCharLibrary" title="编辑公共角色" width="440px" @close="editCharLibraryForm = null">
      <el-form v-if="editCharLibraryForm" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="editCharLibraryForm.name" placeholder="角色名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="editCharLibraryForm.category" placeholder="可选" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editCharLibraryForm.description" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="editCharLibraryForm.tags" placeholder="可选，逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditCharLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editCharLibrarySaving" @click="submitEditCharLibrary">保存</el-button>
      </template>
    </el-dialog>

    <!-- 道具资源库 -->
    <el-dialog v-model="showPropLibrary" title="道具资源库" width="720px" destroy-on-close class="library-dialog" @open="onPropLibraryDialogOpen">
      <el-tabs v-model="propLibraryTab" class="char-library-tabs" @tab-change="onPropLibraryTabChange">
        <el-tab-pane label="本剧道具库" name="library">
          <div class="library-toolbar">
            <el-input v-model="propLibraryKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadPropLibrary()" />
          </div>
          <div v-loading="propLibraryLoading" class="library-list">
            <div v-for="item in propLibraryList" :key="'plib-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isPropAddToEpisodeLoading('library', item.id)" :disabled="!currentEpisodeId" @click="onAddPropFromLibrary(item)">加入本集</el-button>
                  <el-button size="small" @click="openEditPropLibrary(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="onDeletePropLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!propLibraryLoading && propLibraryList.length === 0" class="library-empty">暂无本剧道具库记录，可将本剧道具「加入本剧库」后在此查看</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="propLibraryPage" v-model:page-size="propLibraryPageSize" :total="propLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadPropLibraryList" @size-change="loadPropLibraryList" />
          </div>
        </el-tab-pane>
        <el-tab-pane label="本剧所有道具" name="drama">
          <div class="library-toolbar">
            <el-input v-model="dramaAllPropKeyword" placeholder="搜索名称或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllPropList()" />
          </div>
          <div v-loading="dramaAllPropLoading" class="library-list">
            <div v-for="item in dramaAllPropList" :key="'pdr-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.name || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isPropAddToEpisodeLoading('drama', item.id)" :disabled="!currentEpisodeId" @click="onAddDramaPropToEpisode(item)">加入本集</el-button>
                </div>
              </div>
            </div>
            <div v-if="!dramaAllPropLoading && dramaAllPropList.length === 0" class="library-empty">本剧暂无制作道具，请先在道具面板创建</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="dramaAllPropPage" v-model:page-size="dramaAllPropPageSize" :total="dramaAllPropTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadDramaAllPropList" @size-change="loadDramaAllPropList" />
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="showPropLibrary = false">关闭</el-button>
      </template>
    </el-dialog>
    <!-- 编辑公共道具 -->
    <el-dialog v-model="showEditPropLibrary" title="编辑公共道具" width="440px" @close="editPropLibraryForm = null">
      <el-form v-if="editPropLibraryForm" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="editPropLibraryForm.name" placeholder="道具名称" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="editPropLibraryForm.category" placeholder="可选" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editPropLibraryForm.description" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="editPropLibraryForm.tags" placeholder="可选，逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditPropLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editPropLibrarySaving" @click="submitEditPropLibrary">保存</el-button>
      </template>
    </el-dialog>

    <!-- 场景资源库 -->
    <el-dialog v-model="showSceneLibrary" title="场景资源库" width="720px" destroy-on-close class="library-dialog" @open="onSceneLibraryDialogOpen">
      <el-tabs v-model="sceneLibraryTab" class="char-library-tabs" @tab-change="onSceneLibraryTabChange">
        <el-tab-pane label="本剧场景库" name="library">
          <div class="library-toolbar">
            <el-input v-model="sceneLibraryKeyword" placeholder="搜索地点或描述" clearable style="width: 200px" @input="debouncedLoadSceneLibrary()" />
          </div>
          <div v-loading="sceneLibraryLoading" class="library-list">
            <div v-for="item in sceneLibraryList" :key="'slib-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.location || item.time || '未命名' }}</div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isSceneAddToEpisodeLoading('library', item.id)" :disabled="!currentEpisodeId" @click="onAddSceneFromLibrary(item)">加入本集</el-button>
                  <el-button size="small" @click="openEditSceneLibrary(item)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="onDeleteSceneLibrary(item)">删除</el-button>
                </div>
              </div>
            </div>
            <div v-if="!sceneLibraryLoading && sceneLibraryList.length === 0" class="library-empty">暂无本剧场景库记录，可将本剧场景「加入本剧库」后在此查看</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="sceneLibraryPage" v-model:page-size="sceneLibraryPageSize" :total="sceneLibraryTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadSceneLibraryList" @size-change="loadSceneLibraryList" />
          </div>
        </el-tab-pane>
        <el-tab-pane label="本剧所有场景" name="drama">
          <div class="library-toolbar">
            <el-input v-model="dramaAllSceneKeyword" placeholder="搜索地点或描述" clearable style="width: 200px" @input="debouncedLoadDramaAllSceneList()" />
          </div>
          <div v-loading="dramaAllSceneLoading" class="library-list">
            <div v-for="item in dramaAllSceneList" :key="'sdr-' + item.id" class="library-item">
              <div class="library-item-cover" @click="openImagePreview(assetImageUrl(item))">
                <img v-if="item.image_url || item.local_path" :src="assetImageUrl(item)" alt="" />
                <span v-else class="library-item-placeholder">暂无图</span>
              </div>
              <div class="library-item-info">
                <div class="library-item-name">{{ item.location || '未命名' }}<span v-if="item.time" class="library-item-sub"> · {{ item.time }}</span></div>
                <div class="library-item-desc">{{ (item.description || item.prompt || '').slice(0, 60) }}{{ (item.description || item.prompt || '').length > 60 ? '…' : '' }}</div>
                <div class="library-item-actions">
                  <el-button size="small" type="primary" :loading="isSceneAddToEpisodeLoading('drama', item.id)" :disabled="!currentEpisodeId" @click="onAddDramaSceneToEpisode(item)">加入本集</el-button>
                </div>
              </div>
            </div>
            <div v-if="!dramaAllSceneLoading && dramaAllSceneList.length === 0" class="library-empty">本剧暂无制作场景，请先在场景面板创建</div>
          </div>
          <div class="library-pagination">
            <el-pagination v-model:current-page="dramaAllScenePage" v-model:page-size="dramaAllScenePageSize" :total="dramaAllSceneTotal" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @current-change="loadDramaAllSceneList" @size-change="loadDramaAllSceneList" />
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="showSceneLibrary = false">关闭</el-button>
      </template>
    </el-dialog>
    <!-- 编辑公共场景 -->
    <el-dialog v-model="showEditSceneLibrary" title="编辑公共场景" width="440px" @close="editSceneLibraryForm = null">
      <el-form v-if="editSceneLibraryForm" label-width="80px">
        <el-form-item label="地点">
          <el-input v-model="editSceneLibraryForm.location" placeholder="场景地点" />
        </el-form-item>
        <el-form-item label="时间">
          <el-input v-model="editSceneLibraryForm.time" placeholder="如：浅色/夜晚" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="editSceneLibraryForm.category" placeholder="可选" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editSceneLibraryForm.description" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="editSceneLibraryForm.tags" placeholder="可选，逗号分隔" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditSceneLibrary = false">取消</el-button>
        <el-button type="primary" :loading="editSceneLibrarySaving" @click="submitEditSceneLibrary">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分镜提示词编辑弹窗 -->
    <el-dialog
      v-model="showSbPromptDialog"
      :title="`分镜 ${sbPromptTarget?.storyboard_number ?? ''} · 编辑提示词`"
      width="700px"
      @close="sbPromptTarget = null"
    >
      <el-form v-if="sbPromptTarget" label-width="0" class="sb-prompt-dialog-form">
        <!-- 图片区 -->
        <div class="sb-prompt-section-title">🖼 图片提示词</div>
        <el-form-item label="">
          <div style="width:100%">
            <div style="font-size:12px; color:#6b7280; margin-bottom:4px;">原始提示词（分镜生成时写入，仅供参考）</div>
            <el-input
              v-model="sbPromptImageText"
              type="textarea"
              :rows="4"
              placeholder="分镜生成时由 AI 写入的原始描述"
            />
          </div>
        </el-form-item>
        <el-form-item label="">
          <div style="width:100%">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <span style="font-size:12px; color:#6b7280;">通用优化提示词（<strong>仅用于分镜图片</strong>，不修改下方视频提示词）</span>
              <el-button
                size="small"
                type="warning"
                plain
                :loading="sbPromptPolishing"
                @click="onPolishSbPrompt"
              >{{ sbPromptPolishedText ? '重新生成' : '立即生成' }}</el-button>
            </div>
            <el-input
              v-model="sbPromptImageInstruction"
              size="small"
              placeholder="可选：图片润色要求，如「去掉服装描述」"
              style="margin-bottom:6px"
            />
            <el-input
              v-model="sbPromptPolishedText"
              type="textarea"
              :rows="5"
              placeholder="点击「立即生成」由 AI 润色分镜图片提示词（结果写入本框）"
            />
          </div>
        </el-form-item>
        <!-- 视频区 -->
        <div class="sb-prompt-section-title" style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span>🎬 视频提示词（提交 Agnes / 可灵 时使用）</span>
          <el-button
            size="small"
            type="primary"
            plain
            :loading="sbPromptVideoPolishing"
            @click="onPolishSbVideoPromptStream"
          >AI 润色</el-button>
        </div>
        <el-form-item label="">
          <el-input
            v-model="sbPromptVideoInstruction"
            size="small"
            placeholder="润色要求（可选），如：优化一下，去掉敏感描述，防止视频模型失败"
            style="margin-bottom:6px"
          />
          <el-input
            v-model="sbPromptVideoText"
            type="textarea"
            :rows="12"
            placeholder="视频生成提示词；可手写，或点「AI 润色」在上方要求下自动优化"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSbPromptDialog = false">取消</el-button>
        <el-button type="primary" :loading="sbPromptSaving" @click="onSaveSbPromptDialog">保存</el-button>
      </template>
    </el-dialog>

    <!-- 首尾帧提示词编辑器（显示最终发给AI的完整提示词，支持编辑保存） -->
    <el-dialog
      v-model="showFramePromptEditor"
      :title="`${editingFramePromptSlot === 'last' ? '尾帧' : '首帧'}图生提示词 · 编辑`"
      width="720px"
      destroy-on-close
    >
      <div class="frame-prompt-editor-body">
        <div class="frame-prompt-editor-hint">
          此提示词将直接发给AI生成首/尾帧图片。支持编辑后保存，保存后点击「生成」即可使用新提示词。
        </div>

        <!-- 空间布局锚点（生成分镜时 AI 输出的最高优先级站位合同） -->
        <div v-if="editingFramePromptSb?.layout_description" class="frame-layout-anchor">
          <div class="frame-layout-anchor-label">本分镜空间布局锚点（首尾帧强制一致合同，最高优先级）</div>
          <div class="frame-layout-anchor-text">{{ editingFramePromptSb.layout_description }}</div>
          <div class="frame-layout-anchor-note">首帧必须严格按此生成初始站位；尾帧必须在完全相同的左右位置、距离、构图下仅演化姿态/表情/结果。</div>
        </div>

        <el-input
          v-model="editingFramePromptInstruction"
          size="small"
          placeholder="可选：重新生成要求，如「加强暖色光感」「减少道具描述」"
          class="frame-prompt-editor-instruction"
        />

        <el-input
          v-model="editingFramePromptText"
          type="textarea"
          :rows="14"
          placeholder="在此编辑最终发给AI生图的完整提示词..."
          class="frame-prompt-editor-textarea"
        />
      </div>
      <template #footer>
        <el-button @click="showFramePromptEditor = false">关闭</el-button>
        <el-button :loading="editingFramePromptRegenerating" @click="regenerateEditingFramePrompt">重新生成</el-button>
        <el-button type="primary" :loading="editingFramePromptSaving" @click="saveEditingFramePrompt">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分镜视频参数编辑弹窗 -->
    <el-dialog
      v-model="showVideoParamsDialog"
      :title="`分镜 ${videoParamsTarget?.storyboard_number ?? ''} · 视频参数`"
      width="860px"
      destroy-on-close
      @close="onVideoParamsDialogClosed"
    >
      <el-form v-if="videoParamsTarget" label-width="115px" size="small" class="vp-dialog-form">
        <el-form-item label="创作模式">
          <el-radio-group
            :model-value="sbCreationMode[videoParamsTarget.id] === 'universal' ? 'universal' : 'classic'"
            size="small"
            @change="(v) => setSbCreationModeId(videoParamsTarget.id, v)"
          >
            <el-radio-button value="classic">经典分镜</el-radio-button>
            <el-radio-button value="universal">全能模式</el-radio-button>
          </el-radio-group>
          <div class="vp-mode-hint">全能模式：中间为片段描述；生视频时使用 <strong>AI 配置里当前启用的视频</strong>（接口规范 <code>kling_omni</code> 或 <code>volcengine_omni</code>，模型如 <code>kling-video-o1</code>、<code>doubao-seedance-2-0-260128</code> 等）并合并场景/角色/道具等参考图（不含经典分镜主图）。经典字段保留，可随时切回。</div>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="标题">
              <el-input v-model="sbTitle[videoParamsTarget.id]" placeholder="镜头标题" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="地点">
              <el-input v-model="sbLocation[videoParamsTarget.id]" placeholder="场景地点" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="时间">
              <el-input v-model="sbTime[videoParamsTarget.id]" placeholder="清晨/午后" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="时长(秒)">
              <el-input-number v-model="sbDuration[videoParamsTarget.id]" :min="1" :max="60" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="景别">
              <el-select v-model="sbShotType[videoParamsTarget.id]" placeholder="景别" style="width:100%">
                <el-option label="大远景" value="大远景" />
                <el-option label="远景" value="远景" />
                <el-option label="中景" value="中景" />
                <el-option label="近景" value="近景" />
                <el-option label="特写" value="特写" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="运镜">
              <el-select v-model="sbMovement[videoParamsTarget.id]" placeholder="运镜（推荐动态）" style="width:100%" clearable filterable>
                <el-option-group label="基础运镜">
                  <el-option label="固定（少用）" value="static" />
                  <el-option label="推镜" value="push" />
                  <el-option label="拉镜" value="pull" />
                  <el-option label="横摇（左/右）" value="pan" />
                  <el-option label="纵摇（上/下）" value="tilt" />
                  <el-option label="跟镜/跟踪" value="tracking" />
                  <el-option label="升镜（吊臂上升）" value="crane_up" />
                  <el-option label="降镜（吊臂下降）" value="crane_dn" />
                  <el-option label="环绕/轨道" value="orbit" />
                  <el-option label="手持/晃动" value="handheld" />
                </el-option-group>
                <el-option-group label="进阶运镜">
                  <el-option label="变焦（zoom in/out）" value="zoom" />
                  <el-option label="旋转/滚镜（roll）" value="roll" />
                  <el-option label="甩镜/急摇" value="whip_pan" />
                  <el-option label="螺旋上升/下降" value="spiral" />
                </el-option-group>
                <el-option-group label="电影化组合镜头">
                  <el-option label="希区柯克镜头（推+变焦）" value="hitchcock_zoom" />
                  <el-option label="子弹时间（环绕+升格）" value="bullet_time" />
                  <el-option label="荷兰角+运镜" value="dutch_angle_move" />
                  <el-option label="推轨复合（dolly+track）" value="dolly_track" />
                  <el-option label="升格环绕（slow-mo orbit）" value="slowmo_orbit" />
                </el-option-group>
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="氛围">
              <el-input v-model="sbAtmosphere[videoParamsTarget.id]" placeholder="氛围/情绪" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="镜头视角">
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <el-select v-model="sbAngleS[videoParamsTarget.id]" placeholder="景别" style="width:76px">
                  <el-option label="特写" value="close_up" />
                  <el-option label="中景" value="medium" />
                  <el-option label="远景" value="wide" />
                </el-select>
                <el-select v-model="sbAngleV[videoParamsTarget.id]" placeholder="俯仰" style="width:86px">
                  <el-option label="平视" value="eye_level" />
                  <el-option label="低角仰拍" value="low" />
                  <el-option label="高角俯拍" value="high" />
                  <el-option label="虫眼仰视" value="worm" />
                </el-select>
                <el-select v-model="sbAngleH[videoParamsTarget.id]" placeholder="方向" style="width:80px">
                  <el-option label="正面" value="front" />
                  <el-option label="前左45°" value="front_left" />
                  <el-option label="左侧" value="left" />
                  <el-option label="后左135°" value="back_left" />
                  <el-option label="背面" value="back" />
                  <el-option label="后右135°" value="back_right" />
                  <el-option label="右侧" value="right" />
                  <el-option label="前右45°" value="front_right" />
                </el-select>
                <span v-if="sbAngleS[videoParamsTarget.id] && sbAngleV[videoParamsTarget.id] && sbAngleH[videoParamsTarget.id]"
                      style="font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 6px;border-radius:4px;white-space:nowrap">
                  {{ angleToPromptFragment(sbAngleH[videoParamsTarget.id], sbAngleV[videoParamsTarget.id], sbAngleS[videoParamsTarget.id]).label }}
                </span>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="灯光">
              <el-select v-model="sbLighting[videoParamsTarget.id]" placeholder="灯光风格" style="width:100%" clearable>
                <el-option label="自然光" value="natural" />
                <el-option label="顺光" value="front" />
                <el-option label="侧光" value="side" />
                <el-option label="逆光" value="backlit" />
                <el-option label="顶光" value="top" />
                <el-option label="底光" value="under" />
                <el-option label="柔光" value="soft" />
                <el-option label="戏剧光" value="dramatic" />
                <el-option label="黄金时段" value="golden_hour" />
                <el-option label="蓝调时刻" value="blue_hour" />
                <el-option label="夜景" value="night" />
                <el-option label="霓虹" value="neon" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="景深">
              <el-select v-model="sbDof[videoParamsTarget.id]" placeholder="景深" style="width:100%" clearable>
                <el-option label="极浅景深" value="extreme_shallow" />
                <el-option label="浅景深" value="shallow" />
                <el-option label="中景深" value="medium" />
                <el-option label="深景深（全焦）" value="deep" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 空间布局锚点：生成分镜时 AI 输出的最高优先级人物站位合同（首尾帧强制一致核心） -->
        <el-form-item label="空间布局锚点（首尾帧人物站位合同）">
          <div style="display:flex; gap:8px; align-items:flex-start; width:100%">
            <el-input
              v-model="sbLayoutDescription[videoParamsTarget.id]"
              type="textarea"
              :rows="3"
              placeholder="例如：女主站画面左三分之一正对镜头，男主站右后侧侧身看向女主，中景，双人构图，平衡稳定"
              style="flex:1"
            />
            <el-button
              size="small"
              :loading="regeneratingLayoutSbIds.has(videoParamsTarget.id)"
              @click="onRegenerateLayoutDescription(videoParamsTarget)"
              style="margin-top:4px; white-space:nowrap"
            >
              AI 重新生成/优化
            </el-button>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;line-height:1.35">
            最高优先级空间合同（用于首尾帧站位锁定）。AI 可参考上下分镜一键重新生成/优化，点击右侧按钮触发。
          </div>
        </el-form-item>

        <el-form-item label="动作">
          <el-input v-model="sbAction[videoParamsTarget.id]" type="textarea" :rows="2" placeholder="动作描述" />
        </el-form-item>
        <el-form-item label="对白">
          <el-input v-model="sbDialogue[videoParamsTarget.id]" type="textarea" :rows="2" placeholder="角色对白" />
        </el-form-item>
        <el-form-item label="解说旁白">
          <el-input v-model="sbNarration[videoParamsTarget.id]" type="textarea" :rows="2" class="sb-narration-input" placeholder="画外解说 / 纪录片式旁白（与对白分开）" />
          <div
            v-if="videoParamsTarget && sbNarrationText(videoParamsTarget).trim()"
            class="sb-narration-stats sb-narration-stats--dialog"
            :class="sbNarrationStatsClass(videoParamsTarget)"
            :title="sbNarrationStatsTitle(videoParamsTarget)"
          >
            {{ sbNarrationStatsLabel(videoParamsTarget) }}
          </div>
        </el-form-item>
        <el-form-item v-if="canSplitSbByAudio(videoParamsTarget)" label="多角色对白">
          <div class="sb-split-audio-row">
            <p class="sb-split-audio-tip">
              本镜含多句对白或「对白+旁白」，Seedance 同镜易串音。可拆成多条分镜（每条仅一人说话或仅旁白），再分别生视频。
            </p>
            <el-button
              type="warning"
              plain
              :loading="splitByAudioLoading"
              @click="onSplitSbByAudio(videoParamsTarget)"
            >
              按对白拆镜
            </el-button>
          </div>
        </el-form-item>
        <el-form-item label="画面结果">
          <el-input v-model="sbResult[videoParamsTarget.id]" type="textarea" :rows="2" placeholder="动作完成后的画面结果" />
        </el-form-item>
        <el-form-item label="视频提示词">
          <div class="vp-video-prompt-hint">保存后将根据上方字段，由系统按最新规则自动生成（含角色音色锚点）。</div>
          <el-input
            v-if="videoParamsTarget?.video_prompt"
            :model-value="videoParamsTarget.video_prompt"
            type="textarea"
            :rows="3"
            readonly
            style="color:#6b7280;margin-top:8px"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showVideoParamsDialog = false">取消</el-button>
        <el-button type="primary" :loading="videoParamsSaving" @click="onSaveVideoParams">保存并更新</el-button>
      </template>
    </el-dialog>

    <!-- P1-2: 导入小说弹窗 -->
    <el-dialog v-model="showNovelImport" title="导入小说/长文" width="600px" @close="novelImportReset">
      <div class="novel-import-dialog">
        <p style="color:#6b7280;font-size:13px;margin-bottom:12px">支持粘贴小说文本或上传 txt 文件，AI 自动识别章节并转换为剧本集数</p>
        <el-tabs v-model="novelImportMode">
          <el-tab-pane label="粘贴文本" name="text">
            <el-input
              v-model="novelText"
              type="textarea"
              :rows="10"
              placeholder="粘贴小说正文，AI 会自动识别章节..."
            />
          </el-tab-pane>
          <el-tab-pane label="上传文件" name="file">
            <el-upload
              drag
              :auto-upload="false"
              :on-change="onNovelFileChange"
              accept=".txt,.md"
              :show-file-list="false"
            >
              <el-icon class="el-icon--upload"><DocumentAdd /></el-icon>
              <div class="el-upload__text">拖拽 .txt / .md 文件到此处，或<em>点击上传</em></div>
            </el-upload>
            <div v-if="novelFileName" style="margin-top:8px;font-size:13px;color:#409eff">已选择：{{ novelFileName }}</div>
          </el-tab-pane>
        </el-tabs>
        <div class="novel-import-options" style="margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px;font-size:13px">
            <span>最多导入集数：</span>
            <el-input-number v-model="novelMaxChapters" :min="1" :max="20" size="small" style="width:100px" />
          </div>
          <el-checkbox v-model="novelAiSummarize" size="small">AI 转换为剧本格式（会消耗 Token）</el-checkbox>
        </div>
      </div>
      <template #footer>
        <el-button @click="showNovelImport = false">取消</el-button>
        <el-button type="primary" :loading="novelImporting" @click="onImportNovel">开始导入</el-button>
      </template>
    </el-dialog>

    <!-- AI 配置弹窗（不跳转，避免本页内容丢失） -->
    <el-dialog v-model="showAiConfigDialog" title="AI 配置" width="90%" destroy-on-close class="ai-config-dialog">
      <AIConfigContent v-if="showAiConfigDialog" />
    </el-dialog>

    <!-- 图片放大预览：点击遮罩或图片关闭 -->
    <Teleport to="body">
      <div
        v-if="previewImageUrl"
        class="image-preview-overlay"
        @click="closeImagePreview"
      >
        <img :src="previewImageUrl" alt="" class="image-preview-img" @click.stop="closeImagePreview" />
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Setting, Plus, Minus, Sunny, Moon, MagicStick, Upload, Delete, Check, Loading, WarningFilled, User, Box, Picture, Film, VideoCamera, Document, InfoFilled, Refresh, ZoomIn, QuestionFilled, DocumentAdd, Expand, Fold, VideoPlay, Grid, Close } from '@element-plus/icons-vue'
import { useTheme } from '@/composables/useTheme'
import { useFilmStore } from '@/stores/film'
import { useGenerationTaskStore, GEN_RESOURCE } from '@/stores/generationTaskStore'
import { syncGeneratingSetsFromStore, buildEpisodeContext, buildExtractTaskMeta, isEpisodeExtractRunning } from '@/composables/useGenerationTaskSync'
import { dramaAPI } from '@/api/drama'
import { aiVoicesAPI } from '@/api/aiVoices'
import { generationAPI } from '@/api/generation'
import { aiAPI } from '@/api/ai'
import { characterAPI } from '@/api/characters'
import { propAPI } from '@/api/props'
import { sceneAPI } from '@/api/scenes'
import { taskAPI } from '@/api/task'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import { storyboardsAPI } from '@/api/storyboards'
import { uploadAPI } from '@/api/upload'
import { readImageFileFromClipboard } from '@/utils/clipboard'
import { characterLibraryAPI } from '@/api/characterLibrary'
import { sceneLibraryAPI } from '@/api/sceneLibrary'
import { propLibraryAPI } from '@/api/propLibrary'
import { generationSettingsAPI } from '@/api/prompts'
import { parseScriptIntoEpisodes, episodesListToPlainScript, normalizeScriptContentForSave } from '@/utils/scriptEpisodes'
import { exportStoryboardSheet } from '@/utils/exportStoryboardSheet'
import { getNarrationStats, UNIVERSAL_FULL_NARRATION_MAX_SEC, NARRATION_CHARS_PER_SEC_DEFAULT, collapseNarrationBlankLines } from '@/utils/narrationMetrics'
import { parseUniversalMultiBeatText, replaceBeatInUniversalText, sumUniversalBeatSeconds, recomposeUniversalMultiBeatIfParsable } from '@/utils/universalMultiBeatParse'
import { enrichUniversalBeatsWithTimeline, alignUniversalBeatSecondsToNarration, beatsSecondsMisalignedWithNarration } from '@/utils/universalNarrationBeatTimeline'
import { applySoftContiguityToOmniSubmit } from '@/utils/softContiguity'
import { nextVideoPreferredKeyIndex, SOFT_CONTIGUITY_RETRY_DELAY_MS } from '@/utils/videoKeyRoundRobin'
import StylePickerButton from '@/components/StylePickerButton.vue'
import AIConfigContent from '@/components/AIConfigContent.vue'
import UniversalSegmentOmniAtEditor from '@/components/UniversalSegmentOmniAtEditor.vue'
import {
  generationStyleOptions,
  getStylePromptEn,
  getStylePromptZh,
  stylePromptMetadataForSave,
  backfillDramaStylePromptMetadataIfNeeded,
  CUSTOM_STYLE_VALUE,
} from '@/constants/styleOptions'
import { useNavigation } from '@/composables/filmCreate/useNavigation'
import { runGenerateStoryFromPremise } from '@/composables/useStoryGeneration'
import { useCharacters } from '@/composables/filmCreate/useCharacters'
import { useProps as usePropsComposable } from '@/composables/filmCreate/useProps'
import { useScenes } from '@/composables/filmCreate/useScenes'
import { useAssetClipboard } from '@/composables/filmCreate/useAssetClipboard'

const route = useRoute()
const router = useRouter()
const store = useFilmStore()
const genStore = useGenerationTaskStore()
const { isDark, toggle: toggleTheme } = useTheme()
const { videoResolution: storeVideoResolution } = storeToRefs(store)

// ── Composable: Navigation ─────────────────────────────
const { navCollapsed, storyboardMenuExpanded, toggleNav, scrollToTop, scrollToAnchor } = useNavigation()

function goList() {
  router.push('/')
}

function goCanvasMode() {
  if (!dramaId.value) return
  const query = selectedEpisodeId.value ? { episode: String(selectedEpisodeId.value) } : {}
  router.push({ path: `/film/${dramaId.value}/canvas`, query })
}


const showAiConfigDialog = ref(false)
watch(showAiConfigDialog, (open) => {
  if (!open) invalidateActiveVideoAiConfigCache()
})
const storyInput = ref('')
const storyStyle = ref('')
const storyType = ref('')
const storyEpisodeCount = ref(1)
const storyGenerating = ref(false)
/** 剧本工作台：create 创作 | select 选择预览 */
const scriptWorkbenchMode = ref('create')
const showSelectScriptDialog = ref(false)
const selectScriptLoading = ref(false)
const selectScriptImporting = ref(false)
const selectScriptDramas = ref([])
/** 选择剧本弹窗列表：排除当前打开的项目，避免误点「导入」到自身 */
const selectableScriptDramas = computed(() => {
  const cur = store.dramaId
  const list = selectScriptDramas.value || []
  if (cur == null) return list
  return list.filter((d) => Number(d.id) !== Number(cur))
})
const selectPreviewEpisodeId = ref('')
// P1-2: 小说导入
const showNovelImport = ref(false)
const novelImportMode = ref('text')
const novelText = ref('')
const novelFileName = ref('')
const novelFileContent = ref('')
const novelMaxChapters = ref(10)
const novelAiSummarize = ref(false)
const novelImporting = ref(false)
const scriptTitle = ref('')
const selectedEpisodeId = ref(null)
/** 保存剧本后用于恢复选中集（后端重插后 id 会变，用 episode_number 匹配） */
const savedCurrentEpisodeNumber = ref(1)
const scriptLanguage = ref('zh')
const scriptStoryboardStyle = ref('')
const scriptGenerating = ref(false)
const isStoryGenRunning = computed(() => {
  if (storyGenerating.value || scriptGenerating.value) return true
  return genStore.getAllRunningTasks().some(
    (t) => Number(t.dramaId) === Number(dramaId.value) && t.resourceType === GEN_RESOURCE.GENERATE_STORY
  )
})
const generationStyle = ref('')
const customStylePrompt = ref('')
const projectAspectRatio = ref('16:9')
const videoClipDuration = ref(5)

/** Agnes 文本 / 图片 / 视频模型：外层总默认 + 视频可按镜头覆盖 */
const AGNES_TEXT_MODEL_25_FLASH = 'agnes-2.5-flash'
const AGNES_TEXT_MODEL_20_FLASH = 'agnes-2.0-flash'
const AGNES_TEXT_MODEL_OPTIONS = [
  { label: 'Agnes 文本 2.5 Flash', value: AGNES_TEXT_MODEL_25_FLASH },
  { label: 'Agnes 文本 2.0 Flash', value: AGNES_TEXT_MODEL_20_FLASH },
]
const AGNES_IMAGE_MODEL_25_FLASH = 'agnes-image-2.5-flash'
const AGNES_IMAGE_MODEL_21_FLASH = 'agnes-image-2.1-flash'
const AGNES_IMAGE_MODEL_20_FLASH = 'agnes-image-2.0-flash'
const AGNES_IMAGE_MODEL_OPTIONS = [
  { label: 'Agnes Image 2.5 Flash', value: AGNES_IMAGE_MODEL_25_FLASH },
  { label: 'Agnes Image 2.1 Flash', value: AGNES_IMAGE_MODEL_21_FLASH },
  { label: 'Agnes Image 2.0 Flash', value: AGNES_IMAGE_MODEL_20_FLASH },
]
const AGNES_VIDEO_MODEL_25_FLASH = 'agnes-video-2.5-flash'
const AGNES_VIDEO_MODEL_25 = 'agnes-video-2.5'
const AGNES_VIDEO_MODEL_20 = 'agnes-video-v2.0'
const AGNES_VIDEO_MODEL_OPTIONS = [
  { label: 'Agnes Video 2.5 Flash（免费）', value: AGNES_VIDEO_MODEL_25_FLASH },
  { label: 'Agnes Video 2.5', value: AGNES_VIDEO_MODEL_25 },
  { label: 'Agnes Video 2.0', value: AGNES_VIDEO_MODEL_20 },
]
const defaultTextModel = ref(AGNES_TEXT_MODEL_25_FLASH)
const defaultImageModel = ref(AGNES_IMAGE_MODEL_25_FLASH)
const defaultVideoModel = ref(AGNES_VIDEO_MODEL_25_FLASH)
/** 分镜级覆盖；未设置时回落到 defaultVideoModel */
const sbVideoModel = ref({})

function normalizeAgnesTextModelChoice(v) {
  const s = String(v || '').trim()
  if (/agnes-2\.5-flash/i.test(s)) return AGNES_TEXT_MODEL_25_FLASH
  if (/agnes-2\.0-flash/i.test(s)) return AGNES_TEXT_MODEL_20_FLASH
  return AGNES_TEXT_MODEL_25_FLASH
}

function normalizeAgnesImageModelChoice(v) {
  const s = String(v || '').trim()
  if (/agnes-image-2\.5-flash/i.test(s)) return AGNES_IMAGE_MODEL_25_FLASH
  if (/agnes-image-2\.1-flash/i.test(s)) return AGNES_IMAGE_MODEL_21_FLASH
  if (/agnes-image-2\.0-flash/i.test(s)) return AGNES_IMAGE_MODEL_20_FLASH
  return AGNES_IMAGE_MODEL_25_FLASH
}

function normalizeAgnesVideoModelChoice(v) {
  const s = String(v || '').trim()
  if (/agnes-video-v?2\.5-flash/i.test(s)) return AGNES_VIDEO_MODEL_25_FLASH
  if (/agnes-video-v?2\.5/i.test(s)) return AGNES_VIDEO_MODEL_25
  if (/agnes-video-v?2\.0/i.test(s)) return AGNES_VIDEO_MODEL_20
  return AGNES_VIDEO_MODEL_25_FLASH
}

function getSelectedTextModel() {
  return normalizeAgnesTextModelChoice(defaultTextModel.value)
}

function getSelectedImageModel() {
  return normalizeAgnesImageModelChoice(defaultImageModel.value)
}

function getSbVideoModel(sbId) {
  const override = sbVideoModel.value[sbId]
  if (override) return normalizeAgnesVideoModelChoice(override)
  return normalizeAgnesVideoModelChoice(defaultVideoModel.value)
}

function setSbVideoModel(sbId, model) {
  if (!sbId) return
  sbVideoModel.value = {
    ...sbVideoModel.value,
    [sbId]: normalizeAgnesVideoModelChoice(model),
  }
}

function onDefaultTextModelChange() {
  defaultTextModel.value = normalizeAgnesTextModelChoice(defaultTextModel.value)
  saveProjectSettings(false)
}

function onDefaultImageModelChange() {
  defaultImageModel.value = normalizeAgnesImageModelChoice(defaultImageModel.value)
  saveProjectSettings(false)
}

function onDefaultVideoModelChange() {
  defaultVideoModel.value = normalizeAgnesVideoModelChoice(defaultVideoModel.value)
  saveProjectSettings(false)
}

/** 根据 value 查找样式选项对象 */
function _findStyleOption(val) {
  for (const group of generationStyleOptions) {
    const found = group.options.find(o => o.value === val)
    if (found) return found
  }
  return null
}

/** 传给图像/视频 AI 用的英文 prompt（效果最好）；
 *  找不到 promptEn 时降级到 prompt，再降级到原始值；
 *  custom 时返回用户填写的自定义描述，避免把字面量 "custom" 写入提示词 */
function getSelectedStylePrompt() {
  const val = (generationStyle.value || '').toString().trim()
  if (!val) return undefined
  if (val === CUSTOM_STYLE_VALUE) {
    const text = (customStylePrompt.value || '').toString().trim()
    return text || undefined
  }
  const opt = _findStyleOption(val)
  if (opt) return opt.promptEn || opt.prompt || val
  return val
}

/** 中文风格描述（用于界面展示或中文场景提示词拼接） */
function getSelectedStylePromptZh() {
  const val = (generationStyle.value || '').toString().trim()
  if (!val) return undefined
  if (val === CUSTOM_STYLE_VALUE) {
    const text = (customStylePrompt.value || '').toString().trim()
    return text || undefined
  }
  const opt = _findStyleOption(val)
  if (opt) return opt.prompt || opt.promptEn || val
  return val
}

function projectStylePromptMetadata() {
  return stylePromptMetadataForSave(generationStyle.value, customStylePrompt.value)
}

const scriptContent = computed({
  get: () => store.scriptContent,
  set: (v) => store.setScriptContent(v)
})
const videoResolution = storeVideoResolution
const videoMusic = ref('')
const videoSfx = ref('')
const videoQuality = ref('high')
const videoSubtitle = ref(true)
/** 合成整集时把各镜对白 TTS（audio_local_path）按分镜时长对齐并混入成片 */
const videoBurnDialogue = ref(false)
/** IndexTTS2 旁白：逐句配音 + 逐句烧录字幕 */
const videoIndexTtsNarration = ref(true)
const indexttsInstallOk = ref(false)
const indexttsModelLoaded = ref(false)
const indexttsLoading = ref(false)
const indexttsUnloading = ref(false)
const indexttsVoiceId = ref('gsv:008')
const indexttsEmotionText = ref('自然流畅的解说语气，情绪饱满')
const indexttsSpeed = ref(1.1)
const indexttsSpeedOptions = [
  { label: '0.8x', value: 0.8 },
  { label: '0.9x', value: 0.9 },
  { label: '1.0x', value: 1.0 },
  { label: '1.1x（默认）', value: 1.1 },
  { label: '1.2x', value: 1.2 },
  { label: '1.3x', value: 1.3 },
  { label: '1.5x', value: 1.5 },
]
const gsvCatalogVoices = ref([])
const gsvPanelOpen = ref(false)
const gsvEditingId = ref('')
const gsvSaving = ref(false)
const gsvPreviewing = ref(false)
const gsvForm = reactive({
  voice_id: '',
  voice_name: '',
  ref_audio_path: '',
  prompt_text: '',
})
const selectedGsvVoice = computed(() =>
  gsvCatalogVoices.value.find((v) => v.voice_id === indexttsVoiceId.value) || null
)
const videoWatermark = ref(false)
/** 水印开启时烧录到成片右上角（距顶约 1/9） */
const videoWatermarkText = ref('')

const dramaId = computed(() => store.dramaId)
const characters = computed(() => store.characters)
const scenes = computed(() => store.scenes)
const props = computed(() => store.props)
const storyboards = computed(() => store.storyboards)
/** 分镜列表分页：每页固定 10 条，减轻 DOM / 卡顿 */
const STORYBOARD_PAGE_SIZE = 10
const storyboardPage = ref(1)
const storyboardTotalPages = computed(() =>
  Math.max(1, Math.ceil((storyboards.value?.length || 0) / STORYBOARD_PAGE_SIZE))
)
const storyboardPageOffset = computed(() => (storyboardPage.value - 1) * STORYBOARD_PAGE_SIZE)
const pagedStoryboards = computed(() => {
  const list = storyboards.value || []
  const start = storyboardPageOffset.value
  return list.slice(start, start + STORYBOARD_PAGE_SIZE)
})
/** 幕的镜头区间文案（按全集全局序号，不受分页影响） */
function getSegmentShotRangeLabel(sb, globalIndex) {
  const list = storyboards.value || []
  let end = globalIndex
  while (end + 1 < list.length && list[end + 1].segment_index === sb.segment_index) end++
  let start = globalIndex
  while (start > 0 && list[start - 1].segment_index === sb.segment_index) start--
  return `${start + 1}–${end + 1}`
}
/** 侧栏跳转到分镜：先切到对应页再滚动 */
async function scrollToStoryboardCard(sbId) {
  const list = storyboards.value || []
  const idx = list.findIndex((s) => Number(s.id) === Number(sbId))
  if (idx < 0) return
  storyboardPage.value = Math.floor(idx / STORYBOARD_PAGE_SIZE) + 1
  await nextTick()
  scrollToAnchor('sb-' + sbId)
}

function onStoryboardPageChange() {
  nextTick(() => scrollToAnchor('anchor-storyboard'))
}

watch(storyboardPage, () => {
  loadStoryboardMedia()
})

watch(
  () => storyboards.value?.length || 0,
  (len) => {
    const maxPage = Math.max(1, Math.ceil(len / STORYBOARD_PAGE_SIZE))
    if (storyboardPage.value > maxPage) storyboardPage.value = maxPage
  }
)

const currentEpisode = computed(() => store.currentEpisode)
const currentEpisodeId = computed(() => store.currentEpisode?.id ?? null)
const videoProgress = computed(() => store.videoProgress)
const videoStatus = computed(() => store.videoStatus)

function trackFilmCreateAction(_action, _payload = {}) {
  // 单机版：无埋点上报
}
/** 当前集合成视频的播放地址（用于按钮下方预览） */
const currentEpisodeVideoUrl = computed(() => {
  const url = currentEpisode.value?.video_url
  if (!url || !String(url).trim()) return ''
  const s = String(url).trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  return '/static/' + s.replace(/^\//, '')
})

/** 带 BGM 的成片（与原片并存） */
const currentEpisodeBgmVideoUrl = computed(() => {
  const url = currentEpisode.value?.bgm_video_url
  if (!url || !String(url).trim()) return ''
  const s = String(url).trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  return '/static/' + s.replace(/^\//, '')
})

const currentEpisodeBgmPath = computed(() => currentEpisode.value?.bgm_local_path || '')

const bgmDescription = ref('')
const bgmModel = ref('ace_step_local')
const aceStepOnline = ref(false)
const aceStepModelLoaded = ref(false)
const aceStepStarting = ref(false)
const aceStepUnloading = ref(false)
const isAceStepBgmModel = computed(() => String(bgmModel.value || '').trim() === 'ace_step_local')
const bgmMixVolume = ref(12)
const bgmSuggesting = ref(false)
const bgmGenerating = ref(false)
const bgmMixing = ref(false)
const bgmLibrary = ref([])
const bgmMoodHint = ref('')
const bgmLibraryReady = computed(() =>
  bgmLibrary.value.some((x) => x.status === 'completed' && x.kind !== 'sfx' && x.local_path)
)

const foleyVisionModel = ref('agnes-2.5-flash')
const foleyMixSource = ref('original')
const foleyMixVolume = ref(40)
const foleyAnalyzing = ref(false)
const foleyGenerating = ref(false)
const foleyMixing = ref(false)
const foleyStatus = ref('')
const foleyError = ref('')
const foleyEvents = ref([])
const foleyReadyCount = computed(() =>
  foleyEvents.value.filter((e) => e.status === 'completed' && e.audio_path).length
)
const currentEpisodeFoleyVideoUrl = computed(() => {
  const url = currentEpisode.value?.foley_video_url
  if (!url || !String(url).trim()) return ''
  const s = String(url).trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  return '/static/' + s.replace(/^\//, '')
})

/** 片头分镜（每集一条，合成时可前置） */
const introNarration = ref('')
const introCharacterIds = ref([])
const introSceneId = ref(null)
const introPropIds = ref([])
const introIncludeUserOverride = ref(null)
const introSaving = ref(false)
const introTtsRunning = ref(false)
const introPromptsRunning = ref(false)
const introImageRunning = ref(false)
const introVideoRunning = ref(false)
const introPipelineRunning = ref(false)
const introStatusHint = ref('')
const introStoryboardLocal = ref(null)

const introStoryboard = computed(() => {
  return introStoryboardLocal.value || currentEpisode.value?.intro_storyboard || null
})
const introStoryboardId = computed(() => introStoryboard.value?.id || null)
const introHasVideo = computed(() => {
  const sb = introStoryboard.value
  if (!sb?.id) return false
  if (sbHasStoryboardVideo(sb)) return true
  return !!(getSbVideo(sb.id) || isHttpVideoUrl(sb.video_url) || isStoryboardVideoLocalPath(sb.local_path))
})
const includeIntroInMerge = computed({
  get() {
    if (!introHasVideo.value) return false
    if (introIncludeUserOverride.value != null) return !!introIncludeUserOverride.value
    return true
  },
  set(v) {
    introIncludeUserOverride.value = !!v
  },
})
const introPreviewImageUrl = computed(() => {
  const sb = introStoryboard.value
  if (!sb?.id) return ''
  const img = getSbImage(sb.id)
  if (img) return assetImageUrl(img)
  if (sb.image_url || sb.local_path) {
    return assetImageUrl({ image_url: sb.image_url, local_path: isStoryboardVideoLocalPath(sb.local_path) ? null : sb.local_path })
  }
  return ''
})
const introPreviewVideoUrl = computed(() => {
  const sb = introStoryboard.value
  if (!sb?.id) return ''
  const vid = getSbVideo(sb.id)
  if (vid) return assetVideoUrl(vid)
  if (sb.video_url || isStoryboardVideoLocalPath(sb.local_path)) {
    return assetVideoUrl({ video_url: sb.video_url, local_path: sb.local_path })
  }
  return ''
})
const introVideoStrip = computed(() => {
  const sb = introStoryboard.value
  if (!sb?.id) return []
  return getVideoStripItems(sb.id)
})
const introImageStrip = computed(() => {
  const sb = introStoryboard.value
  if (!sb?.id) return []
  return getImageStripItems(sb.id)
})
/** 仅有 storyboards 字段绑定、无 image_generations 记录时可整项清除 */
const introCanClearImageBinding = computed(() => {
  const sb = introStoryboard.value
  if (!sb?.id || introImageStrip.value.length) return false
  return !!introPreviewImageUrl.value
})

function introNarrationSavedText() {
  return collapseNarrationBlankLines(introStoryboard.value?.narration || '')
}

function introNarrationDirty() {
  const draft = collapseNarrationBlankLines(introNarration.value || '')
  const saved = introNarrationSavedText()
  return draft !== saved
}

const introHasNarrationAudio = computed(() => {
  const sb = introStoryboard.value
  return !!(sb?.narration_audio_local_path && String(sb.narration_audio_local_path).trim())
})
const introHasPrompts = computed(() => {
  const sb = introStoryboard.value
  return !!(
    String(sb?.video_prompt || '').trim() ||
    String(sb?.polished_prompt || '').trim() ||
    String(sb?.image_prompt || '').trim()
  )
})
const introPromptAligned = computed(() => {
  const sb = introStoryboard.value
  return !!(sb?.narration_prompt_aligned_at && String(sb.narration_prompt_aligned_at).trim())
})
const introHasImage = computed(() => {
  const sb = introStoryboard.value
  if (!sb?.id) return false
  return sbHasStoryboardImage(sb)
})
const introHasRefs = computed(() => {
  const scene = introSceneId.value != null
    ? (scenes.value ?? []).find((s) => Number(s.id) === Number(introSceneId.value))
    : null
  if (scene && (hasAssetImage(scene) || sceneVideoRefUrl(scene))) return true
  for (const cid of introCharacterIds.value || []) {
    const c = (characters.value ?? []).find((x) => Number(x.id) === Number(cid))
    if (c && hasAssetImage(c)) return true
  }
  for (const pid of introPropIds.value || []) {
    const p = (props.value ?? []).find((x) => Number(x.id) === Number(pid))
    if (p && hasAssetImage(p)) return true
  }
  return false
})
const introAudioPreviewUrl = computed(() => {
  const sb = introStoryboard.value
  if (!sb?.narration_audio_local_path) return ''
  return toStaticUrl(sb.narration_audio_local_path)
})
const introPromptPreview = computed(() => {
  const sb = introStoryboard.value
  if (!sb) return ''
  const video = String(sb.video_prompt || '').trim()
  const image = String(sb.polished_prompt || sb.image_prompt || '').trim()
  if (video && image && video !== image) {
    return `【生图】${image.slice(0, 180)}${image.length > 180 ? '…' : ''}\n【生视频】${video.slice(0, 180)}${video.length > 180 ? '…' : ''}`
  }
  const one = video || image
  return one.length > 360 ? `${one.slice(0, 360)}…` : one
})

function syncIntroFormFromEpisode() {
  const intro = currentEpisode.value?.intro_storyboard || null
  introStoryboardLocal.value = intro
  if (!intro) {
    introNarration.value = ''
    introCharacterIds.value = []
    introSceneId.value = null
    introPropIds.value = []
    introStatusHint.value = ''
    introIncludeUserOverride.value = null
    return
  }
  introNarration.value = String(intro.narration || '')
  const chars = Array.isArray(intro.characters) ? intro.characters : []
  introCharacterIds.value = chars
    .map((c) => Number(typeof c === 'object' && c != null ? c.id : c))
    .filter((n) => Number.isFinite(n))
  introSceneId.value = intro.scene_id != null ? Number(intro.scene_id) : null
  introPropIds.value = Array.isArray(intro.prop_ids)
    ? intro.prop_ids.map((x) => Number(x)).filter((n) => Number.isFinite(n))
    : []
  if (intro.id) {
    syncIntroAssetMapsToSb(intro.id)
    loadSingleStoryboardMedia(intro.id)
  }
}

/** 片头资产勾选同步到 sb* 映射，复用分镜参考图收集逻辑 */
function syncIntroAssetMapsToSb(introId) {
  const id = Number(introId)
  if (!Number.isFinite(id) || id <= 0) return
  sbCharacterIds.value = { ...sbCharacterIds.value, [id]: [...(introCharacterIds.value || [])] }
  sbSceneId.value = { ...sbSceneId.value, [id]: introSceneId.value ?? null }
  sbPropIds.value = { ...sbPropIds.value, [id]: [...(introPropIds.value || [])] }
}

/** 片头：从已选角色/场景/道具收集参考图 URL（不需分镜图） */
async function collectIntroReferenceAbsoluteUrlsAsync() {
  const sb = introStoryboard.value
  if (!sb?.id) return []
  syncIntroAssetMapsToSb(sb.id)
  return collectSbOmniReferenceAbsoluteUrlsAsync(sb)
}

function isAgnesVideo20Model(modelName) {
  return normalizeAgnesVideoModelChoice(modelName) === AGNES_VIDEO_MODEL_20
}

/** 组装片头视频提交图字段：优先参考图，可选回退分镜图 */
async function buildIntroVideoImagePayload(intro) {
  const submitModel = getSbVideoModel(intro?.id)
  let omniRefs = await collectIntroReferenceAbsoluteUrlsAsync()
  let agnes20Truncated = false
  if (isAgnesVideo20Model(submitModel) && omniRefs.length > 1) {
    agnes20Truncated = true
    omniRefs = omniRefs.slice(0, 1)
  }
  const videoCfg = await getActiveVideoAiConfig()
  const useOmni = canUseUniversalOmniVideoApi(videoCfg)

  if (omniRefs.length > 0) {
    const payload = useOmni
      ? buildSbVideoImageSubmitPayload({ universalOmni: true, omniRefs })
      : buildSbVideoImageSubmitPayload({
          universal: true,
          sceneOnlyRefs: omniRefs,
          absoluteUrl: omniRefs[0],
        })
    return { ...payload, agnes20Truncated }
  }

  const img = getSbImage(intro.id)
  const imageUrl = img
    ? toAbsoluteImageUrl(assetImageUrl(img))
    : toAbsoluteImageUrl(assetImageUrl({
        image_url: intro.image_url,
        local_path: isStoryboardVideoLocalPath(intro.local_path) ? null : intro.local_path,
      }))
  if (imageUrl) {
    return {
      ...buildSbVideoImageSubmitPayload({
        universal: false,
        absoluteUrl: imageUrl,
        vFirst: imageUrl,
      }),
      agnes20Truncated: false,
    }
  }
  return null
}

function applyIntroToEpisodeStore(intro) {
  introStoryboardLocal.value = intro || null
  if (store.currentEpisode) {
    store.currentEpisode.intro_storyboard = intro || null
  }
  const epInDrama = store.drama?.episodes?.find((e) => Number(e.id) === Number(currentEpisodeId.value))
  if (epInDrama) epInDrama.intro_storyboard = intro || null
}

async function onSaveIntroStoryboard() {
  if (!currentEpisodeId.value) return null
  const narr = String(introNarration.value || '').trim()
  if (!narr) {
    ElMessage.warning('请先填写片头旁白')
    return null
  }
  introSaving.value = true
  introStatusHint.value = '正在保存片头…'
  try {
    const res = await dramaAPI.upsertIntroStoryboard(currentEpisodeId.value, {
      narration: narr,
      character_ids: introCharacterIds.value || [],
      scene_id: introSceneId.value || null,
      prop_ids: introPropIds.value || [],
      title: '片头',
      clear_narration_audio: introNarrationDirty(),
    })
    const intro = res?.intro_storyboard || res
    applyIntroToEpisodeStore(intro)
    introStatusHint.value = '片头已保存'
    ElMessage.success('片头已保存')
    return intro
  } catch (e) {
    introStatusHint.value = e.message || '保存失败'
    ElMessage.error(e.message || '保存片头失败')
    return null
  } finally {
    introSaving.value = false
  }
}

async function ensureIntroPromptAligned(intro) {
  if (!intro?.id) return null
  if (introPromptAligned.value) return introStoryboard.value || intro
  if (!introHasPrompts.value) return null
  const now = new Date().toISOString()
  try {
    await storyboardsAPI.update(intro.id, { narration_prompt_aligned_at: now })
    const next = { ...(introStoryboard.value || intro), narration_prompt_aligned_at: now }
    applyIntroToEpisodeStore(next)
    return next
  } catch (e) {
    console.warn('[片头] 标记提示词对齐失败', e)
    return introStoryboard.value || intro
  }
}

async function onIntroGenerateTts(opts = {}) {
  const { skipSave = false, force = false } = opts
  if (!force && introHasNarrationAudio.value && !introNarrationDirty()) {
    introStatusHint.value = '片头配音已就绪，跳过'
    return { ok: true, skipped: true }
  }
  const intro = skipSave ? (introStoryboard.value || (await onSaveIntroStoryboard())) : ((await onSaveIntroStoryboard()) || introStoryboard.value)
  if (!intro?.id) return null
  const narr = String(intro.narration || introNarration.value || '').trim()
  if (!narr) {
    ElMessage.warning('请先填写片头旁白')
    return null
  }
  introTtsRunning.value = true
  introStatusHint.value = '正在生成片头配音…'
  try {
    const tts = await requestNarrationTtsForSb(intro.id, narr)
    if (!tts.ok) {
      throw new Error(tts.error || '片头配音失败')
    }
    applySbNarrationAudioPath(intro.id, tts.local_path, tts.duration)
    if (introStoryboardLocal.value) {
      introStoryboardLocal.value = {
        ...introStoryboardLocal.value,
        narration_audio_local_path: tts.local_path,
        duration: tts.duration || introStoryboardLocal.value.duration,
      }
    }
    introStatusHint.value = '片头配音完成'
    ElMessage.success('片头配音完成')
    return tts
  } catch (e) {
    introStatusHint.value = e.message || '配音失败'
    ElMessage.error(e.message || '片头配音失败')
    return null
  } finally {
    introTtsRunning.value = false
  }
}

async function onIntroGeneratePrompts(opts = {}) {
  const { skipSave = false, force = false } = opts
  if (!force && introHasPrompts.value && !introNarrationDirty()) {
    await ensureIntroPromptAligned(introStoryboard.value)
    introStatusHint.value = '片头提示词已就绪，跳过'
    return introStoryboard.value
  }
  const intro = skipSave ? (introStoryboard.value || (await onSaveIntroStoryboard())) : ((await onSaveIntroStoryboard()) || introStoryboard.value)
  if (!intro?.id) return null
  introPromptsRunning.value = true
  introStatusHint.value = '正在生成片头提示词…'
  try {
    const res = await dramaAPI.generateIntroPrompts(currentEpisodeId.value, {
      style: getSelectedStyle(),
    })
    const next = res?.intro_storyboard || res
    applyIntroToEpisodeStore(next)
    introStatusHint.value = '片头提示词已生成'
    ElMessage.success('片头提示词已生成')
    return next
  } catch (e) {
    introStatusHint.value = e.message || '生成提示词失败'
    ElMessage.error(e.message || '生成片头提示词失败')
    return null
  } finally {
    introPromptsRunning.value = false
  }
}

async function onIntroGenerateImage(opts = {}) {
  const { skipSave = false, force = false } = opts
  if (!force && introHasImage.value) {
    introStatusHint.value = '片头分镜图已就绪，跳过'
    return true
  }
  let intro = introStoryboard.value
  if (!intro?.id) {
    intro = await onSaveIntroStoryboard()
  } else if (!skipSave) {
    intro = (await onSaveIntroStoryboard()) || intro
  }
  if (!intro?.id) return null
  if (!introHasPrompts.value || (force && introNarrationDirty())) {
    const prompted = await onIntroGeneratePrompts({ skipSave: true, force })
    if (!prompted) return null
    intro = prompted
  } else if (!introPromptAligned.value) {
    intro = (await ensureIntroPromptAligned(intro)) || intro
  }
  introImageRunning.value = true
  introStatusHint.value = '正在生成片头分镜图…'
  try {
    await storyboardsAPI.update(intro.id, {
      character_ids: introCharacterIds.value || [],
    }).catch(() => {})
    const latest = introStoryboard.value || intro
    const prompt = latest.polished_prompt || latest.image_prompt || latest.description || introNarration.value
    const res = await imagesAPI.create({
      storyboard_id: latest.id,
      drama_id: dramaId.value,
      prompt,
      style: getSelectedStyle(),
      aspect_ratio: projectAspectRatio.value || '16:9',
    })
    if (res?.task_id) {
      const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(latest.id))
      if (pollRes?.status === 'failed') throw new Error(pollRes.error || '片头生图失败')
    } else {
      await loadSingleStoryboardMedia(latest.id)
    }
    await loadDrama()
    syncIntroFormFromEpisode()
    introStatusHint.value = '片头分镜图完成'
    ElMessage.success('片头分镜图完成')
    return true
  } catch (e) {
    introStatusHint.value = e.message || '生图失败'
    ElMessage.error(e.message || '片头生图失败')
    return null
  } finally {
    introImageRunning.value = false
  }
}

async function ensureIntroVideoPrerequisites() {
  let intro = (await onSaveIntroStoryboard()) || introStoryboard.value
  if (!intro?.id) return null

  if (!introHasNarrationAudio.value || introNarrationDirty()) {
    const tts = await onIntroGenerateTts({ skipSave: true })
    if (!tts) return null
    intro = introStoryboard.value || intro
  }

  if (!introHasPrompts.value || introNarrationDirty()) {
    const prompted = await onIntroGeneratePrompts({ skipSave: true })
    if (!prompted) return null
    intro = prompted
  } else if (!introPromptAligned.value) {
    intro = (await ensureIntroPromptAligned(intro)) || intro
  }

  return introStoryboard.value || intro
}

async function onIntroGenerateVideo(opts = {}) {
  const { skipPrerequisites = false, force = false } = opts
  let intro = introStoryboard.value
  if (!skipPrerequisites) {
    intro = await ensureIntroVideoPrerequisites()
    if (!intro?.id) return null
  } else if (!intro?.id) {
    intro = await onSaveIntroStoryboard()
    if (!intro?.id) return null
  }

  introVideoRunning.value = true
  introStatusHint.value = force && introHasVideo.value ? '正在重新生成片头视频…' : '正在生成片头视频…'
  try {
    const latest = introStoryboard.value || intro
    syncIntroAssetMapsToSb(latest.id)
    const imgPayloadRaw = await buildIntroVideoImagePayload(latest)
    if (!imgPayloadRaw) {
      throw new Error('请选用带参考图的角色/场景/道具（无需分镜图）；或可选先生成分镜图')
    }
    const { agnes20Truncated, ...imgPayload } = imgPayloadRaw
    if (agnes20Truncated) {
      ElMessage.info('Agnes Video 2.0 仅支持 1 张参考图，已自动使用首张（通常为场景）')
    }
    const prompt = (latest.video_prompt || latest.polished_prompt || introNarration.value || '').trim()
    if (!prompt) throw new Error('请先生成片头视频提示词')
    const duration =
      Number(latest.duration) > 0
        ? Number(latest.duration)
        : getNarrationStats(introNarration.value, narrationCharsPerSec.value).estSec
    const meta = {
      dramaId: dramaId.value,
      episodeId: currentEpisodeId.value,
      resourceType: GEN_RESOURCE.SB_VIDEO,
      resourceId: latest.id,
      label: '片头视频',
    }
    genStore.markRunning(meta)
    const res = await videosAPI.create({
      drama_id: dramaId.value,
      storyboard_id: latest.id,
      prompt,
      model: getSbVideoModel(latest.id),
      image_url: imgPayload.image_url,
      first_frame_url: imgPayload.first_frame_url,
      last_frame_url: imgPayload.last_frame_url,
      reference_image_urls: imgPayload.reference_image_urls,
      preferred_key_index: nextVideoPreferredKeyIndex(),
      style: getSelectedStyle(),
      aspect_ratio: projectAspectRatio.value || '16:9',
      resolution: videoResolution.value || undefined,
      duration: duration || 6,
    })
    if (res?.task_id) {
      const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(latest.id), meta)
      if (pollRes?.status === 'failed') throw new Error(pollRes.error || '片头视频生成失败')
      const postWarn = pollRes?.result?.post_warning
      if (postWarn) ElMessage.warning(`片头视频已生成：${postWarn}`)
    } else {
      await loadSingleStoryboardMedia(latest.id)
    }
    await loadDrama()
    syncIntroFormFromEpisode()
    if (introIncludeUserOverride.value == null) includeIntroInMerge.value = true
    introStatusHint.value = '片头视频完成（合成默认包含）'
    ElMessage.success('片头视频完成')
    return true
  } catch (e) {
    introStatusHint.value = e.message || '生视频失败'
    ElMessage.error(e.message || '片头视频生成失败')
    return null
  } finally {
    introVideoRunning.value = false
    genStore.markDone({
      dramaId: dramaId.value,
      episodeId: currentEpisodeId.value,
      resourceType: GEN_RESOURCE.SB_VIDEO,
      resourceId: introStoryboardId.value,
    })
  }
}

async function onIntroOneClickGenerate() {
  if (!currentEpisodeId.value || !String(introNarration.value || '').trim()) {
    ElMessage.warning('请先填写片头旁白')
    return
  }
  if (introPipelineRunning.value) return
  introPipelineRunning.value = true
  try {
    const saved = await onSaveIntroStoryboard()
    if (!saved) return
    const intro = await ensureIntroVideoPrerequisites()
    if (!intro?.id) return
    await onIntroGenerateVideo({ skipPrerequisites: true })
  } finally {
    introPipelineRunning.value = false
  }
}

function onSelectIntroVideo(video) {
  const sb = introStoryboard.value
  if (!sb?.id || !video) return
  onSelectSbMainVideo(sb, video)
  if (introStoryboardLocal.value) {
    introStoryboardLocal.value = {
      ...introStoryboardLocal.value,
      video_url: video.video_url || null,
      local_path: video.local_path || introStoryboardLocal.value.local_path,
    }
  }
}

async function onRemoveIntroVideo(videoGenId) {
  const sbId = introStoryboardId.value
  if (!sbId || !videoGenId) return
  await onRemoveSbHistoryVideo(sbId, videoGenId)
  await loadDrama()
  syncIntroFormFromEpisode()
}

function onSelectIntroImage(img) {
  const sb = introStoryboard.value
  if (!sb?.id || !img) return
  onSelectSbMainImage(sb, img)
  if (introStoryboardLocal.value) {
    introStoryboardLocal.value = {
      ...introStoryboardLocal.value,
      image_url: img.image_url || null,
      local_path: img.local_path || null,
      first_frame_image_id: img.id,
    }
  }
}

async function onRemoveIntroImage(imageGenId) {
  const sbId = introStoryboardId.value
  if (!sbId || !imageGenId) return
  await onRemoveSbHistoryImage(sbId, imageGenId)
  await loadDrama()
  syncIntroFormFromEpisode()
}

async function onRemoveIntroImageBinding() {
  const sbId = introStoryboardId.value
  if (!sbId) return
  try {
    await ElMessageBox.confirm(
      '确定删除片头分镜图？删除后可重新生图或直接用参考图生视频。',
      '删除分镜图',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        distinguishCancelAndClose: true,
      }
    )
    await storyboardsAPI.update(sbId, {
      image_url: null,
      local_path: null,
      first_frame_image_id: null,
    })
    const next = {
      ...(introStoryboard.value || {}),
      image_url: null,
      local_path: null,
      first_frame_image_id: null,
    }
    applyIntroToEpisodeStore(next)
    const sel = { ...sbSelectedImgId.value }
    delete sel[sbId]
    sbSelectedImgId.value = sel
    await loadSingleStoryboardMedia(sbId)
    introStatusHint.value = '片头分镜图已删除'
    ElMessage.success('片头分镜图已删除')
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(err?.message || '删除失败')
    }
  }
}

function toStaticUrl(rel) {
  const s = String(rel || '').trim()
  if (!s) return ''
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/static/')) return s
  return '/static/' + s.replace(/^\//, '')
}

async function loadBgmLibrary() {
  if (!currentEpisodeId.value) {
    bgmLibrary.value = []
    return
  }
  try {
    const res = await dramaAPI.listBgm(currentEpisodeId.value)
    const items = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : [])
    bgmLibrary.value = items.sort((a, b) => {
      if (a.status === 'completed' && b.status !== 'completed') return -1
      if (b.status === 'completed' && a.status !== 'completed') return 1
      return (Number(b.id) || 0) - (Number(a.id) || 0)
    })
  } catch (_) {
    bgmLibrary.value = []
  }
}

async function refreshAceStepStatus() {
  if (!isAceStepBgmModel.value) return
  try {
    const res = await dramaAPI.aceStepHealth()
    aceStepOnline.value = !!res?.online
    aceStepModelLoaded.value = !!res?.loaded
  } catch (_) {
    aceStepOnline.value = false
    aceStepModelLoaded.value = false
  }
}

async function onStartAceStep() {
  aceStepStarting.value = true
  try {
    const res = await dramaAPI.aceStepStart()
    aceStepOnline.value = !!res?.online
    aceStepModelLoaded.value = !!res?.loaded
    ElMessage.success(res?.loaded ? 'ACE-Step 已启动并就绪' : 'ACE-Step 已启动')
  } catch (e) {
    ElMessage.error(e.message || 'ACE-Step 启动失败')
    await refreshAceStepStatus()
  } finally {
    aceStepStarting.value = false
  }
}

async function onUnloadAceStep() {
  aceStepUnloading.value = true
  try {
    await dramaAPI.aceStepUnload()
    aceStepOnline.value = false
    aceStepModelLoaded.value = false
    ElMessage.success('ACE-Step 已卸载，显存已释放')
  } catch (e) {
    ElMessage.error(e.message || 'ACE-Step 卸载失败')
    await refreshAceStepStatus()
  } finally {
    aceStepUnloading.value = false
  }
}

async function onSuggestBgmDescription() {
  if (!currentEpisodeId.value) return
  bgmSuggesting.value = true
  bgmMoodHint.value = ''
  try {
    const res = await dramaAPI.suggestBgmDescription(currentEpisodeId.value, {
      description: bgmDescription.value,
      include_sfx: false,
    })
    if (res?.description) bgmDescription.value = res.description
    const he = res?.moods?.high_energy_shots || []
    const ho = res?.moods?.horror_shots || []
    const parts = []
    if (he.length) parts.push(`高燃：${he.join('、')}`)
    if (ho.length) parts.push(`恐怖/悬疑：${ho.join('、')}`)
    bgmMoodHint.value = parts.length ? `检测到场景：${parts.join('；')}` : '未检测到明显高燃/恐怖镜头，仍可按整体氛围配乐'
    ElMessage.success('已生成配乐描述')
  } catch (e) {
    ElMessage.error(e.message || '生成描述失败')
  } finally {
    bgmSuggesting.value = false
  }
}

async function onGenerateBgm() {
  if (!currentEpisodeId.value) return
  if (isAceStepBgmModel.value && !aceStepModelLoaded.value) {
    ElMessage.warning('请先点击「启动」加载 ACE-Step 本地模型')
    return
  }
  bgmGenerating.value = true
  try {
    const result = await dramaAPI.generateBgm(currentEpisodeId.value, {
      description: bgmDescription.value,
      include_sfx: false,
      model: bgmModel.value,
    })
    ElMessage.success(result?.message || 'BGM 生成任务已提交')
    if (result?.task_id != null) {
      await pollTask(result.task_id, () => loadBgmLibrary())
    }
    await loadDrama()
    await loadBgmLibrary()
  } catch (e) {
    ElMessage.error(e.message || 'BGM 生成失败')
  } finally {
    bgmGenerating.value = false
  }
}

async function onApplyBgmItem(item) {
  if (!currentEpisodeId.value || !item?.id) return
  try {
    await dramaAPI.applyBgm(currentEpisodeId.value, item.id, { kind: item.kind || 'bgm' })
    await loadDrama()
    ElMessage.success(item.kind === 'sfx' ? '已选用该音效' : '已选用该 BGM')
  } catch (e) {
    ElMessage.error(e.message || '选用失败')
  }
}

async function onMixBgmToVideo() {
  if (!currentEpisodeId.value) return
  if (!currentEpisodeVideoUrl.value) {
    ElMessage.warning('请先完成「合成视频」')
    return
  }
  bgmMixing.value = true
  try {
    const result = await dramaAPI.mixBgmToVideo(currentEpisodeId.value, {
      bgm_volume: Number(bgmMixVolume.value) / 100,
      include_sfx: false,
    })
    await loadDrama()
    ElMessage.success(result?.message || '已生成带 BGM 成片')
  } catch (e) {
    ElMessage.error(e.message || '混入失败')
  } finally {
    bgmMixing.value = false
  }
}

function formatFoleyTime(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

async function loadFoleyState() {
  if (!currentEpisodeId.value) {
    foleyEvents.value = []
    foleyStatus.value = ''
    foleyError.value = ''
    return
  }
  try {
    const res = await dramaAPI.getFoley(currentEpisodeId.value)
    foleyEvents.value = Array.isArray(res?.events) ? res.events : []
    foleyStatus.value = res?.status || ''
    foleyError.value = res?.error || ''
  } catch (_) {
    foleyEvents.value = []
  }
}

async function onAnalyzeFoley() {
  if (!currentEpisodeId.value) return
  foleyAnalyzing.value = true
  try {
    const result = await dramaAPI.analyzeFoley(currentEpisodeId.value, {
      vision_model: foleyVisionModel.value,
    })
    ElMessage.success(result?.message || 'Foley 分析已启动')
    if (result?.task_id != null) {
      await pollTask(result.task_id, () => loadFoleyState())
    }
    await loadDrama()
    await loadFoleyState()
  } catch (e) {
    ElMessage.error(e.message || 'Foley 分析失败')
  } finally {
    foleyAnalyzing.value = false
  }
}

async function onGenerateFoley() {
  if (!currentEpisodeId.value) return
  foleyGenerating.value = true
  try {
    const result = await dramaAPI.generateFoley(currentEpisodeId.value, {})
    ElMessage.success(result?.message || 'Foley 生成已启动')
    if (result?.task_id != null) {
      await pollTask(result.task_id, () => loadFoleyState())
    }
    await loadDrama()
    await loadFoleyState()
  } catch (e) {
    ElMessage.error(e.message || 'Foley 生成失败')
  } finally {
    foleyGenerating.value = false
  }
}

async function onMixFoleyToVideo() {
  if (!currentEpisodeId.value) return
  if (!currentEpisodeVideoUrl.value) {
    ElMessage.warning('请先完成「合成视频」')
    return
  }
  foleyMixing.value = true
  try {
    const result = await dramaAPI.mixFoleyToVideo(currentEpisodeId.value, {
      source: foleyMixSource.value,
      foley_volume: Number(foleyMixVolume.value) / 100,
    })
    ElMessage.success(result?.message || '已混入 Foley')
    await loadDrama()
    await loadFoleyState()
  } catch (e) {
    ElMessage.error(e.message || '混入 Foley 失败')
  } finally {
    foleyMixing.value = false
  }
}

const storyboardGenerating = computed(() =>
  isEpisodeExtractRunning(genStore, dramaId.value, currentEpisodeId.value, GEN_RESOURCE.GENERATE_STORYBOARD)
)
/** 分镜生成任务轮询时的后端 message（如「正在 AI 生成各镜视频提示词 12/34...」） */
const storyboardGenStatusMessage = ref('')
/** 分镜批量生成结束后，按镜序逐个润色全能片段（仅勾选全能模式且各镜为 universal 且有正文时） */
const universalOmniPolishRunning = ref(false)
const universalOmniPolishAbort = ref(false)
const universalOmniPolishProgress = ref({ current: 0, total: 0, label: '' })
const universalOmniPolishPercent = computed(() => {
  const p = universalOmniPolishProgress.value
  if (!p?.total) return 0
  return Math.min(100, Math.round((Number(p.current) / Number(p.total)) * 100))
})
const sbTruncatedWarning = ref(false)
const sbTruncatedDismissed = ref(false)
const videoErrorMsg = ref('')
// 一键全流程流水线
const pipelineRunning = ref(false)
const clearingEpisode = ref(false)
/** '' | 'narration_audio' | 'images' | 'videos' */
const clearingMediaKind = ref('')
const pipelinePaused = ref(false)
const pipelineAbortRequested = ref(false)
const pipelineErrorLog = ref([])
const pipelineCurrentStep = ref('')
const pipelineStepIndex = ref(0)    // 当前步骤序号（1-based）
/** 全流程 9 步；文本框架 4 步；一键分镜脚本 7 步（至生图，不含视频/成片） */
const pipelineStepTotal = ref(9)
/** 批量/一键分镜视频：与生图同为 7 路并发（对应多 Key；连贯帧模式仍强制串行） */
const BATCH_VIDEO_CONCURRENCY = 7
/** 全能片段批量润色：与视频同为 7 路并发 */
const UNIVERSAL_OMNI_POLISH_CONCURRENCY = 7
/** 一键/补全解说配音：IndexTTS 本机 GPU 独占，须串行合成 */
const BATCH_NARRATION_TTS_CONCURRENCY = 1
/** 单镜配音失败时最多重试次数（不含首次，共 3 次尝试） */
const NARRATION_TTS_MAX_RETRIES = 2
const NARRATION_TTS_RETRY_DELAY_MS = 2000
let pipelineResolveResume = null
// 倒计时（两个生成阶段之间的确认窗口）
const pipelineCountdown = ref(0)      // 剩余秒数，0 表示不在倒计时
const pipelineCountdownMsg = ref('')  // 倒计时说明文字
const pipelineConcurrency = ref(3)
const pipelineVideoConcurrency = ref(BATCH_VIDEO_CONCURRENCY)
const pipelineActiveTasks = reactive(new Set())

async function loadPipelineConcurrency() {
  try {
    const res = await generationSettingsAPI.get()
    pipelineConcurrency.value = Math.max(1, Number(res?.concurrency) || 3)
    // 视频默认 7 路（与生图多 Key 对齐）；仍可读设置覆盖
    pipelineVideoConcurrency.value = Math.max(1, Number(res?.video_concurrency) || BATCH_VIDEO_CONCURRENCY)
  } catch (_) {}
}

/**
 * 带并发度的批量执行器。
 * @param {Array} items - 需要处理的项目列表
 * @param {number} concurrency - 最大并发数
 * @param {Function} fn - async (item, index) => void，内部可 throw 或 return {paused}
 * @param {{ getLabel?: (item) => string }} options
 * @returns {Promise<{paused: boolean}>}
 */
async function runConcurrently(items, concurrency, fn, options = {}) {
  let index = 0
  let anyPaused = false
  let aborted = false
  const getLabel = options.getLabel || (() => null)

  async function worker() {
    while (index < items.length) {
      if (aborted) return
      const i = index++
      const item = items[i]
      const label = getLabel(item)
      if (label) pipelineActiveTasks.add(label)
      try {
        const result = await fn(item, i)
        if (result && typeof result === 'object' && result.paused) {
          anyPaused = true
          return
        }
        if (result && typeof result === 'object' && result.abortChain) {
          aborted = true
          index = items.length
          return
        }
      } finally {
        if (label) pipelineActiveTasks.delete(label)
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.allSettled(workers)
  return { paused: anyPaused, aborted }
}
// ── Composable: Characters ────────────────────────────
const {
  showEditCharacter, editCharacterForm, editCharacterSaving, editCharacterPromptGenerating,
  extractingCharAppearance, extractingAnchors, addCharRefImage, addCharRefFileInput,
  charactersGenerating, generatingCharIds, sd2CertifyingId, showCharSd2Cert, charSd2CertPayload,
  sd2VoiceUploadingId,
  showCharLibrary, charLibraryList, charLibraryLoading, charLibraryPage, charLibraryPageSize,
  charLibraryTotal, charLibraryKeyword, charLibraryTab,
  dramaAllCharList, dramaAllCharLoading, dramaAllCharPage, dramaAllCharPageSize, dramaAllCharTotal, dramaAllCharKeyword,
  showEditCharLibrary, editCharLibraryForm,
  editCharLibrarySaving, addingCharToLibraryId, addingCharToMaterialId, addingCharFromLibraryId,
  charRoleLabel, onGenerateCharacters: onGenerateCharactersRaw, openAddCharacter, stopCharacterPromptPoll, editCharacter,
  saveCharRefImageIfAny, submitEditCharacter, doGenerateCharacterPrompt, doExtractCharFromImage,
  extractIdentityAnchors, clearCharRefImage, onCloseCharDialog, onDeleteCharacter, onGenerateCharacterImage, onSd2CertifyCharacter, onSd2CertifyRefresh, sd2ActionLabel, onSd2PrimaryAction, openCharSd2CertDialog,
  onSd2VoicePrimaryAction, onSd2VoiceReplace, sd2VoiceActionLabel, playSd2Voice,
  loadCharLibraryList, debouncedLoadCharLibrary, loadDramaAllCharList, debouncedLoadDramaAllCharList,
  onCharLibraryDialogOpen, onCharLibraryTabChange, isCharAddToEpisodeLoading,
  openEditCharLibrary, submitEditCharLibrary,
  onDeleteCharLibrary, onAddCharacterToLibrary, onAddCharacterToMaterialLibrary,
  onAddCharFromLibrary, onAddDramaCharToEpisode,
} = useCharacters({ store, dramaId, currentEpisodeId, getSelectedStyle, getSelectedImageModel, getSelectedTextModel, loadDrama, pollTask, pollUntilResourceHasImage, hasAssetImage })

// ── Composable: Props ──────────────────────────────────
const {
  showAddProp, addPropSaving, addPropForm,
  showEditProp, editPropForm, editPropSaving, editPropPromptGenerating,
  extractingPropDesc, addPropRefImage, addPropRefFileInput,
  addPropAddRefImage, addPropAddRefFileInput, extractingPropAddDesc,
  propsExtracting, generatingPropIds,
  showPropLibrary, propLibraryList, propLibraryLoading, propLibraryPage, propLibraryPageSize,
  propLibraryTotal, propLibraryKeyword, propLibraryTab,
  dramaAllPropList, dramaAllPropLoading, dramaAllPropPage, dramaAllPropPageSize, dramaAllPropTotal, dramaAllPropKeyword,
  showEditPropLibrary, editPropLibraryForm,
  editPropLibrarySaving, addingPropToLibraryId, addingPropToMaterialId, addingPropFromLibraryId,
  onExtractProps: onExtractPropsRaw, stopPropPromptPoll, editProp, doGeneratePropPrompt, savePropRefImageIfAny,
  clearPropRefImage, doExtractPropFromImage, submitEditProp, submitAddProp,
  onClosePropDialog, onDeleteProp, onGeneratePropImage,
  loadPropLibraryList, debouncedLoadPropLibrary, loadDramaAllPropList, debouncedLoadDramaAllPropList,
  onPropLibraryDialogOpen, onPropLibraryTabChange, isPropAddToEpisodeLoading,
  openEditPropLibrary, submitEditPropLibrary,
  onDeletePropLibrary, onAddPropToLibrary, onAddPropToMaterialLibrary,
  onAddPropFromLibrary, onAddDramaPropToEpisode,
  doExtractFromRef2,
} = usePropsComposable({ store, dramaId, currentEpisodeId, getSelectedStyle, getSelectedImageModel, loadDrama, pollTask, pollUntilResourceHasImage, hasAssetImage })

// ── Composable: Scenes ─────────────────────────────────
const {
  showEditScene, editSceneForm, editSceneSaving, editScenePromptGenerating,
  extractingSceneDesc, addSceneRefImage, addSceneRefFileInput,
  scenesExtracting, generatingSceneIds,
  // 场景多视角额外 state（由 FilmCreate 管理）
  showSceneLibrary, sceneLibraryList, sceneLibraryLoading, sceneLibraryPage, sceneLibraryPageSize,
  sceneLibraryTotal, sceneLibraryKeyword, sceneLibraryTab,
  dramaAllSceneList, dramaAllSceneLoading, dramaAllScenePage, dramaAllScenePageSize, dramaAllSceneTotal, dramaAllSceneKeyword,
  showEditSceneLibrary, editSceneLibraryForm,
  editSceneLibrarySaving, addingSceneToLibraryId, addingSceneToMaterialId, addingSceneFromLibraryId,
  onExtractScenes: onExtractScenesRaw, openAddScene, stopScenePromptPoll, editScene, doGenerateScenePrompt, doGenerateSceneSinglePrompt,
  saveSceneRefImageIfAny, clearSceneRefImage, doExtractSceneFromImage, submitEditScene,
  onCloseSceneDialog, onDeleteScene, onGenerateSceneImage,
  loadSceneLibraryList, debouncedLoadSceneLibrary, loadDramaAllSceneList, debouncedLoadDramaAllSceneList,
  onSceneLibraryDialogOpen, onSceneLibraryTabChange, isSceneAddToEpisodeLoading,
  openEditSceneLibrary, submitEditSceneLibrary,
  onDeleteSceneLibrary, onAddSceneToLibrary, onAddSceneToMaterialLibrary,
  onAddSceneFromLibrary, onAddDramaSceneToEpisode,
} = useScenes({ store, dramaId, currentEpisodeId, getSelectedStyle, getSelectedImageModel, getSelectedTextModel, scriptLanguage, loadDrama, pollTask, pollUntilResourceHasImage, hasAssetImage, dramaAPI })

async function onGenerateCharacters() {
  trackFilmCreateAction('generate_characters_click')
  const beforeCount = (store.currentEpisode?.characters || []).length
  try {
    await onGenerateCharactersRaw()
    const afterCount = (store.currentEpisode?.characters || []).length
    trackFilmCreateAction('generate_characters_complete', {
      extra: { before_count: beforeCount, after_count: afterCount },
    })
  } catch (e) {
    trackFilmCreateAction('generate_characters_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
    throw e
  }
}

async function onExtractProps() {
  trackFilmCreateAction('extract_props_click')
  const beforeCount = (store.props || []).length
  try {
    await onExtractPropsRaw()
    const afterCount = (store.props || []).length
    trackFilmCreateAction('extract_props_complete', {
      extra: { before_count: beforeCount, after_count: afterCount },
    })
  } catch (e) {
    trackFilmCreateAction('extract_props_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
    throw e
  }
}

async function onExtractScenes() {
  trackFilmCreateAction('extract_scenes_click')
  const beforeCount = (store.currentEpisode?.scenes || []).length
  try {
    await onExtractScenesRaw()
    const afterCount = (store.currentEpisode?.scenes || []).length
    trackFilmCreateAction('extract_scenes_complete', {
      extra: { before_count: beforeCount, after_count: afterCount },
    })
  } catch (e) {
    trackFilmCreateAction('extract_scenes_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
    throw e
  }
}



// 资源管理大面板及子区块折叠状态
const resourcePanelCollapsed = ref(false)
const charactersBlockCollapsed = ref(false)
const propsBlockCollapsed = ref(false)
const scenesBlockCollapsed = ref(false)
const sceneUseQuadGrid = ref(false)
const propUseQuadGrid = ref(false)  // 道具四视图（与场景四宫格同级选项）

// 分镜行内编辑状态（按 storyboard id 存储）
// navCollapsed/storyboardMenuExpanded/toggleNav → 已移至 useNavigation composable

/** 左侧导航各步骤状态 */
const navSteps = computed(() => {
  const epRunning = genStore.getRunningForEpisode(dramaId.value, currentEpisodeId.value)
  // 剧本
  const hasScript = !!(scriptContent?.value?.trim())
  const scriptStatus = isStoryGenRunning.value
    ? 'generating'
    : hasScript ? 'done' : 'pending'

  // 角色
  const charList = characters.value || []
  const charDone = charList.length > 0 && charList.every(c => hasAssetImage(c))
  const charGen = charactersGenerating.value || generatingCharIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.CHAR_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_CHARACTERS)
  const charStatus = charGen ? 'generating' : charDone ? 'done' : charList.length > 0 ? 'partial' : 'pending'

  // 道具
  const propList = props.value || []
  const propDone = propList.length > 0 && propList.every(p => hasAssetImage(p))
  const propGen = propsExtracting.value || generatingPropIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.PROP_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_PROPS)
  const propStatus = propGen ? 'generating' : propDone ? 'done' : propList.length > 0 ? 'partial' : 'pending'

  // 场景
  const sceneList = scenes.value || []
  const sceneDone = sceneList.length > 0 && sceneList.every(s => hasAssetImage(s))
  const sceneGen = scenesExtracting.value || generatingSceneIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.SCENE_IMAGE || t.resourceType === GEN_RESOURCE.EXTRACT_SCENES)
  const sceneStatus = sceneGen ? 'generating' : sceneDone ? 'done' : sceneList.length > 0 ? 'partial' : 'pending'

  // 分镜脚本
  const sbList = storyboards.value || []
  const sbScriptDone = sbList.length > 0
  const sbScriptGen = storyboardGenerating.value || universalOmniPolishRunning.value
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORYBOARD)
  const sbScriptStatus = sbScriptGen ? 'generating' : sbScriptDone ? 'done' : 'pending'

  // 分镜图
  const sbImgDone = sbList.length > 0 && sbList.every(sb => hasSbImage(sb))
  const sbImgGen = generatingSbImageIds.size > 0 || batchImageRunning.value || epRunning.some((t) =>
    t.resourceType === GEN_RESOURCE.SB_IMAGE
    || t.resourceType === GEN_RESOURCE.SB_FIRST_IMAGE
    || t.resourceType === GEN_RESOURCE.SB_LAST_IMAGE
  )
  const sbImgStatus = sbImgGen ? 'generating' : sbImgDone ? 'done' : sbList.length > 0 ? 'partial' : 'pending'

  // 视频
  const sbVideoAllDone = sbList.length > 0 && sbList.every(sb => getSbAllVideos(sb.id).length > 0)
  const sbVideoSome = sbList.some(sb => getSbAllVideos(sb.id).length > 0)
  const sbVideoGen = batchVideoRunning.value || generatingSbVideoIds.size > 0
    || epRunning.some((t) => t.resourceType === GEN_RESOURCE.SB_VIDEO)
  const videoStatus = sbVideoGen ? 'generating' : sbVideoAllDone ? 'done' : sbVideoSome ? 'partial' : 'pending'

  return [
    { key: 'script',   label: '故事剧本',   anchor: 'anchor-script',     status: scriptStatus,    count: hasScript ? 1 : 0 },
    { key: 'chars',    label: '角色',        anchor: 'anchor-characters', status: charStatus,      count: charList.length },
    { key: 'props',    label: '道具',        anchor: 'anchor-props',      status: propStatus,      count: propList.length },
    { key: 'scenes',   label: '场景',        anchor: 'anchor-scenes',     status: sceneStatus,     count: sceneList.length },
    { key: 'sb',       label: '分镜脚本',   anchor: 'anchor-storyboard', status: sbScriptStatus,  count: sbList.length },
    { key: 'sbimg',    label: '分镜图',      anchor: 'anchor-storyboard', status: sbImgStatus,     count: sbList.length },
    { key: 'video',    label: '分镜视频',   anchor: 'anchor-video',      status: videoStatus,     count: 0 },
  ]
})

/** 聚合所有当前正在运行的任务，用于悬浮任务面板（含跨剧跨集） */
const allActiveTaskItems = computed(() => {
  const items = []
  const seen = new Set()
  function addItem(item) {
    const id = item.id || item.label
    if (!id || seen.has(id)) return
    seen.add(id)
    items.push(item)
  }
  for (const t of genStore.getAllRunningTasks()) {
    addItem({
      id: `gen:${t.key || t.taskId || t.label}`,
      label: t.label || '任务进行中...',
      kind: 'genStore',
      task: t,
    })
  }
  if (pipelineRunning.value) {
    const step = pipelineCurrentStep.value
    addItem({
      id: 'pipeline',
      label: step ? step.replace(/^\[步骤 \d+\/\d+\] /, '') : '一键全流程运行中...',
      kind: 'pipeline',
    })
  }
  if (isStoryGenRunning.value && !genStore.getAllRunningTasks().some((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORY)) {
    addItem({ id: 'story-gen-local', label: '生成剧本...', kind: 'storyGenLocal' })
  }
  if (universalOmniPolishRunning.value) {
    const p = universalOmniPolishProgress.value
    addItem({
      id: 'universal-omni-polish',
      label: `润色全能分镜 ${p.current}/${p.total}${p.label ? ' ' + p.label : ''}`,
      kind: 'universalOmniPolish',
    })
  }
  if (batchImageRunning.value) {
    addItem({ id: 'batch-image', label: '批量生成分镜图...', kind: 'batchImage' })
  }
  if (batchVideoRunning.value) {
    const p = batchVideoProgress.value
    const suffix = p?.total ? ` ${p.current}/${p.total}` : ''
    addItem({ id: 'batch-video', label: `批量生成分镜视频${suffix}...`, kind: 'batchVideo' })
  }
  return items
})

const allActiveTaskLabels = computed(() => allActiveTaskItems.value.map((t) => t.label))

async function cancelActiveTask(item) {
  if (!item) return
  try {
    if (item.kind === 'genStore' && item.task) {
      await genStore.cancelTask(item.task)
      ElMessage.success('任务已取消')
      return
    }
    if (item.kind === 'pipeline') {
      pipelineAbortRequested.value = true
      pipelineRunning.value = false
      pipelinePaused.value = false
      for (const t of genStore.getAllRunningTasks()) {
        if (t.taskId) await genStore.cancelTask(t)
      }
      ElMessage.success('已停止全流程')
      return
    }
    if (item.kind === 'storyGenLocal') {
      storyGenerating.value = false
      scriptGenerating.value = false
      const storyTask = genStore.getAllRunningTasks().find((t) => t.resourceType === GEN_RESOURCE.GENERATE_STORY)
      if (storyTask) await genStore.cancelTask(storyTask)
      ElMessage.success('已取消剧本生成')
      return
    }
    if (item.kind === 'universalOmniPolish') {
      universalOmniPolishAbort.value = true
      ElMessage.success('正在停止润色...')
      return
    }
    if (item.kind === 'batchImage') {
      batchImageStopping.value = true
      ElMessage.info('正在停止批量生图...')
      return
    }
    if (item.kind === 'batchVideo') {
      batchVideoStopping.value = true
      ElMessage.info('正在停止批量生视频...')
      return
    }
  } catch (e) {
    ElMessage.error(e?.message || '取消失败')
  }
}
const sbCharacterIds = ref({})  // sbId -> number[] 多选角色
const sbPropIds = ref({})       // sbId -> number[] 多选物品
const sbSceneId = ref({})
const sbDialogue = ref({})
const sbNarration = ref({})
const sbShotType = ref({})
/** 视频提示词组成（可编辑），key 为分镜 id */
const sbTitle = ref({})
const sbLocation = ref({})
const sbTime = ref({})
const sbDuration = ref({})
const sbAction = ref({})
const sbResult = ref({})
const sbAtmosphere = ref({})
const sbAngle = ref({})
const sbAngleH = ref({})   // 结构化视角：水平方向
const sbAngleV = ref({})   // 结构化视角：俯仰角度
const sbAngleS = ref({})   // 结构化视角：景别
const sbMovement = ref({})
const sbLighting = ref({})   // 灯光风格
const sbDof = ref({})        // 景深
const sbLayoutDescription = ref({})  // 空间布局与人物站位描述（生成分镜时 AI 输出的最高优先级合同，用于首尾帧强制一致）
const regeneratingLayoutSbIds = reactive(new Set())  // 正在 AI 重新生成布局描述的分镜 id 集合
const regeneratingSingleSbIds = reactive(new Set())  // 正在 AI 单独重生成本镜脚本的分镜 id 集合
/** 分镜创作模式：classic | universal（默认 classic，存库 storyboards.creation_mode） */
const sbCreationMode = ref({})
/** 全能模式片段描述（存库 universal_segment_text，与经典参考图字段独立） */
const sbUniversalSegmentText = ref({})
/** 全能模式：生成/润色时的用户附加要求（按分镜 id 暂存，不入库） */
const sbUniversalSegmentInstruction = ref({})
// 分镜图片/视频列表（由 /images?storyboard_id=xx 和 /videos?storyboard_id=xx 拉取）
const sbImages = ref({})
const sbVideos = ref({})
/** 用于检测分镜 ID 是否变化（重生成分镜脚本后会换一批 id） */
let episodeStoryboardMediaKey = ''
const sbVideoErrors = ref({})
/** 每镜视频生成日志行（展示在视频下方，两行高可滚动） */
const sbVideoLogs = ref({})
const sbVideoLogLastTick = ref({})

function appendSbVideoLog(sbId, line) {
  if (sbId == null) return
  const text = String(line || '').trim()
  if (!text) return
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const msg = `[${ts}] ${text}`
  const prev = Array.isArray(sbVideoLogs.value[sbId]) ? sbVideoLogs.value[sbId] : []
  const next = [...prev, msg]
  if (next.length > 100) next.splice(0, next.length - 100)
  sbVideoLogs.value[sbId] = next
}

function sbVideoLogVisible(sbId) {
  return isSbVideoGenerating(sbId) || (Array.isArray(sbVideoLogs.value[sbId]) && sbVideoLogs.value[sbId].length > 0) || getSbVideoError(sbId)
}

function getSbVideoLogText(sbId) {
  const lines = sbVideoLogs.value[sbId]
  if (Array.isArray(lines) && lines.length) return lines.join('\n')
  const err = getSbVideoError(sbId)
  if (err) return err
  return '暂无生成日志'
}

function makeSbVideoPollOnTick(sbId) {
  return (t) => {
    if (!t || sbId == null) return
    const prog = t.progress != null && t.progress !== '' ? `${t.progress}%` : ''
    const detail = (t.message || t.status_message || t.step || '').toString().trim()
    const key = `${t.status || ''}|${prog}|${detail}`
    if (sbVideoLogLastTick.value[sbId] === key) return
    sbVideoLogLastTick.value[sbId] = key
    const bits = [t.status || 'processing']
    if (prog) bits.push(prog)
    if (detail) bits.push(detail)
    appendSbVideoLog(sbId, bits.join(' · '))
  }
}
const generatingSbImageIds = reactive(new Set())
const generatingSbVideoIds = reactive(new Set())
const generatingUniversalSegmentIds = reactive(new Set())
// 重新生成角色/场景/道具关联分镜图的 loading set，key: 'char-{id}' | 'scene-{id}' | 'prop-{id}'
const regenSbImagesForAsset = reactive(new Set())
const regenSbImagesProgress = ref({})
/** 角色/场景/道具一键批量配图 */
const batchGeneratingCharImages = ref(false)
const batchGeneratingSceneImages = ref(false)
const batchGeneratingPropImages = ref(false)
const batchCharImageProgress = ref({ current: 0, total: 0 })
const batchSceneImageProgress = ref({ current: 0, total: 0 })
const batchPropImageProgress = ref({ current: 0, total: 0 })
// 批量生成分镜图
const batchImageRunning = ref(false)
const batchImageStopping = ref(false)
const batchImageProgress = ref({ current: 0, total: 0, failed: 0 })
const inferringParams = ref(false)
const showVideoParamsDialog = ref(false)
const videoParamsTarget = ref(null)
const videoParamsSaving = ref(false)
const splitByAudioLoading = ref(false)
const batchImageErrors = ref([])
/** 补全缺失生图/视频提示词（就绪条「补全」按钮） */
const completingImagePrompts = ref(false)
const completingVideoPrompts = ref(false)
// 批量生成分镜视频
const batchVideoRunning = ref(false)
const batchVideoStopping = ref(false)
const batchVideoProgress = ref({ current: 0, total: 0, failed: 0 })
const batchVideoErrors = ref([])
// P0-1: 连贯帧模式（经典 i2v 硬首帧）
const videoFrameContiguity = ref(false)
/** 全能软衔接：上一镜视频末帧作为参考图第一张（@图片1），串行批量 */
const videoSoftContiguity = ref(false)
// P0-3: 分镜超分辨率 loading set
const upscalingSbIds = reactive(new Set())
// P2-4: TTS 状态
const ttsSbIds = reactive(new Set())
const ttsSbNarrationIds = reactive(new Set())
const batchNarrationTtsRunning = ref(false)
const remainingNarrationTtsCount = computed(() => getNarrationTtsTargets(true).length)
/** 旁白配音覆盖（工作流步骤 2 状态） */
const storyboardNarrationCoverage = computed(() => {
  const list = storyboards.value || []
  const withText = list.filter((sb) => sbNarrationText(sb).trim())
  const dubbed = withText.filter((sb) => hasSbNarrationAudio(sb))
  return {
    total: withText.length,
    dubbed: dubbed.length,
    remaining: Math.max(0, withText.length - dubbed.length),
  }
})
// 尾帧衔接 loading 状态
const linkingTailFrameIds = reactive(new Set())
// “上镜尾帧”（将上一分镜尾帧图片直接设为当前首帧）loading 状态
const usingPrevTailAsFirstIds = reactive(new Set())
/** 对白 TTS 路径缓存（与 storyboards.audio_local_path 一致） */
const sbDialogueAudioPaths = ref({})
/** 解说旁白 TTS 路径缓存（与 storyboards.narration_audio_local_path 一致） */
const sbNarrationAudioPaths = ref({})
/** 旁白配音版本号：用于强制刷新播放器与缓存 */
const sbNarrationAudioRevision = ref({})
/** 分镜 TTS 试听：避免多条同时播放 */
let sbTtsPreviewAudio = null
/** 正在编辑视频提示词的分镜 id；编辑中显示文本框与保存/取消 */
const editingSbVideoPromptId = ref(null)
const editingSbVideoPromptText = ref('')
/** 正在编辑图片提示词的分镜 id（行内编辑，保留供内部 onSaveSbImagePrompt 使用） */
const editingSbImagePromptId = ref(null)
const editingSbImagePromptText = ref('')
/** 分镜提示词弹窗 */
const showSbPromptDialog = ref(false)
const sbPromptTarget = ref(null)
const sbPromptImageText = ref('')       // 原始 image_prompt
const sbPromptPolishedText = ref('')    // AI 优化后 polished_prompt
const sbPromptVideoText = ref('')       // video_prompt
const sbPromptImageInstruction = ref('')
const sbPromptVideoInstruction = ref('')
const sbPromptSaving = ref(false)
const sbPromptPolishing = ref(false)
const sbPromptVideoPolishing = ref(false)
/** 首尾帧提示词编辑器 */
const showFramePromptEditor = ref(false)
const editingFramePromptSb = ref(null)
const editingFramePromptSlot = ref('first') // 'first' | 'last'
const editingFramePromptText = ref('')
const editingFramePromptInstruction = ref('')
const editingFramePromptSaving = ref(false)
const editingFramePromptRegenerating = ref(false)
const uploadingSbImageId = ref(null)
const sbImageFileInput = ref(null)
const sbImageUploadForId = ref(null)
// 角色/道具/场景 上传图片
const resourceImageFileInput = ref(null)
const resourceUploadType = ref(null) // 'character' | 'prop' | 'scene'
const resourceUploadId = ref(null)
const uploadingResourceId = ref(null) // 'char-1' | 'prop-2' | 'scene-3'
const dragOverResourceKey = ref(null) // 'char-1' | 'prop-2' | 'scene-3'
const dragOverSbId = ref(null)
// 公共库弹窗状态已移至各 composable
const storyboardCountInput = ref('') // 分镜数量（空=自动）
const videoDurationInput = ref('') // 视频总时长（空=自动）
const storyboardLimitInputsKey = ref(0) // 清空时递增，强制输入框重渲染
const storyboardLimitJustCleared = ref(false)
let storyboardLimitClearedTimer = null
/** 分镜生成时是否要求 AI 输出 narration（解说旁白） */
const storyboardIncludeNarration = ref(true)
/** 全文解说旁白视频模式：分镜按剧本原文逐字拆段，narration 为原文摘录 */
const storyboardFullNarrationVideoMode = ref(true)
const narrationCharsPerSec = ref(NARRATION_CHARS_PER_SEC_DEFAULT)
const narrationCharsPerSecOptions = [
  { label: '5 字/秒', value: 5 },
  { label: '5.2 字/秒', value: 5.2 },
  { label: '5.4 字/秒', value: 5.4 },
  { label: '5.5 字/秒（默认）', value: 5.5 },
  { label: '6 字/秒', value: 6 },
  { label: '6.5 字/秒', value: 6.5 },
  { label: '7 字/秒', value: 7 },
  { label: '8 字/秒', value: 8 },
  { label: '9 字/秒', value: 9 },
  { label: '10 字/秒', value: 10 },
  { label: '12 字/秒', value: 12 },
]
const fullNarrationMaxChars = computed(() => Math.round(12 * Number(narrationCharsPerSec.value || NARRATION_CHARS_PER_SEC_DEFAULT)))
const fullNarrationUniversalMaxChars = fullNarrationMaxChars
const fullNarrationMinChars = computed(() => {
  const cps = Number(narrationCharsPerSec.value || NARRATION_CHARS_PER_SEC_DEFAULT)
  const max = Math.round(12 * cps)
  return Math.min(Math.round(8 * cps), max)
})

/** 分镜提示词就绪判定（与后端 batch 写入阈值大致对齐） */
const SB_PROMPT_MIN_POLISHED = 10
const SB_PROMPT_MIN_VIDEO = 12
const SB_PROMPT_MIN_UNIVERSAL = 20

function sbIsUniversal(sb) {
  if (!sb?.id) return sb?.creation_mode === 'universal'
  return sbCreationMode.value[sb.id] === 'universal' || sb.creation_mode === 'universal'
}

function sbHasAiImagePrompt(sb) {
  return String(sb?.polished_prompt || '').trim().length >= SB_PROMPT_MIN_POLISHED
}

function sbHasVideoPrompt(sb) {
  return String(sb?.video_prompt || '').trim().length >= SB_PROMPT_MIN_VIDEO
}

function sbUniversalSegmentReady(sb) {
  if (!sb?.id) return false
  const text = (sbUniversalSegmentText.value[sb.id] ?? sb.universal_segment_text ?? '').toString().trim()
  return text.length >= SB_PROMPT_MIN_UNIVERSAL
}

function sbImagePromptStatusTag(sb) {
  if (sbHasAiImagePrompt(sb)) return { type: 'success', text: 'AI 已润色' }
  if (String(sb?.image_prompt || '').trim().length >= SB_PROMPT_MIN_POLISHED) return { type: 'info', text: '仅基础拼装' }
  return { type: 'warning', text: '未生成' }
}

function sbVideoPromptStatusTag(sb) {
  if (sbIsUniversal(sb) && sbUniversalSegmentReady(sb)) return { type: 'success', text: '全能片段就绪' }
  if (sbHasVideoPrompt(sb)) return { type: 'success', text: '已生成' }
  if (sbIsUniversal(sb)) return { type: 'warning', text: '缺全能片段' }
  return { type: 'warning', text: '未生成' }
}

/** 本集分镜生图/视频提示词与分镜图/视频覆盖（持久展示，刷新后从库字段统计） */
const storyboardPromptCoverage = computed(() => {
  const list = storyboards.value || []
  const total = list.length
  if (!total) return null

  const isFull = !!storyboardFullNarrationVideoMode.value
  const isUniversal = !!storyboardUniversalOmni.value
  const isGen = !!(
    storyboardGenerating.value ||
    universalOmniPolishRunning.value ||
    completingImagePrompts.value ||
    completingVideoPrompts.value ||
    generatingPromptsFromAudio.value ||
    batchImageRunning.value ||
    batchVideoRunning.value
  )

  let polished = 0
  let video = 0
  let universal = 0
  let uniShots = 0
  let sbImagesReady = 0
  let sbVideosReady = 0

  for (const sb of list) {
    if (sbHasAiImagePrompt(sb)) polished += 1
    if (sbHasVideoPrompt(sb)) video += 1
    if (sbIsUniversal(sb)) {
      uniShots += 1
      if (sbUniversalSegmentReady(sb)) universal += 1
    }
    if (sbHasStoryboardImage(sb)) sbImagesReady += 1
    if (sbHasStoryboardVideo(sb)) sbVideosReady += 1
  }

  let modeNote = ''
  let expectImageAi = true
  let expectVideoAi = false
  let expectUniversal = false

  if (isFull && !isUniversal) {
    modeNote = '全文解说经典：配音后须按配音生成提示词，再生视频（批量/单镜会自动补跑；亦可手动点步骤 3）'
    expectVideoAi = true
  } else if (isFull && isUniversal) {
    modeNote = '全文+全能：配音后须按配音润色全能提示词，再生视频（批量/单镜会自动补跑；亦可手动点步骤 3）'
    expectImageAi = false
    expectUniversal = true
  } else if (isUniversal) {
    modeNote = '全能分镜：AI 润色生图提示词；生视频主用全能片段（留空时用 video_prompt）'
    expectUniversal = true
  } else {
    modeNote = '经典分镜：AI 润色生图提示词；video_prompt 入库时规则拼装（视频参数保存可重建）'
  }

  const imageLine = expectImageAi
    ? `生图提示词（AI 润色 polished_prompt）${polished}/${total}`
    : `生图提示词 ${polished}/${total}（本模式不自动 AI 润色）`

  let videoLine
  if (expectUniversal && expectVideoAi) {
    videoLine = `全能片段 ${universal}/${uniShots || total} · 视频提示词（AI）${video}/${total}`
  } else if (expectUniversal) {
    videoLine = `全能片段 ${universal}/${uniShots || total} · 视频提示词（备用）${video}/${total}`
  } else if (expectVideoAi) {
    videoLine = `视频提示词（AI）${video}/${total}`
  } else {
    videoLine = `视频提示词 ${video}/${total}（规则拼装）`
  }

  const sbImageLine = `分镜图（已生成）${sbImagesReady}/${total}`

  const sbVideosMissing = total - sbVideosReady
  const sbVideosRevise = list.filter((sb) => sbNeedsVideoRevision(sb) && sbHasStoryboardVideo(sb)).length
  const remainingSbVideos = list.filter((sb) => sbNeedsBatchVideo(sb)).length
  const remainingMissingVideos = list.filter((sb) => sbNeedsBatchVideo(sb) && !sbNeedsVideoRevision(sb)).length
  const sbVideosBlocked = Math.max(0, sbVideosMissing - remainingMissingVideos)
  let sbVideoLine = `分镜视频（已生成）${sbVideosReady}/${total}`
  if (sbVideosMissing > 0) {
    sbVideoLine += sbVideosBlocked > 0
      ? ` · 缺 ${sbVideosMissing}（可补全 ${remainingMissingVideos}，${sbVideosBlocked} 需先备图/参考）`
      : ` · 待补全 ${sbVideosMissing}`
  }
  if (sbVideosRevise > 0) {
    sbVideoLine += ` · 要修改 ${sbVideosRevise}`
  }

  const imageOk = !expectImageAi || polished >= total
  const videoOk = expectVideoAi
    ? video >= total
    : expectUniversal
      ? universal >= (uniShots || total)
      : video >= total
  const sbImageOk = sbImagesReady >= total
  const sbVideoOk = sbVideosReady >= total

  const remainingImagePrompts = expectImageAi
    ? list.filter((sb) => !sbIsUniversal(sb) && !sbHasAiImagePrompt(sb)).length
    : 0
  const remainingVideoPrompts = expectUniversal
    ? list.filter((sb) => sbIsUniversal(sb) && !sbUniversalSegmentReady(sb)).length
    : list.filter((sb) => !sbIsUniversal(sb) && !sbHasVideoPrompt(sb)).length
  const remainingSbImages = list.filter((sb) => sbNeedsBatchImage(sb)).length

  let status = 'complete'
  if (isGen) status = 'generating'
  else if (!imageOk || !videoOk || !sbImageOk || !sbVideoOk) {
    status = polished > 0 || video > 0 || universal > 0 || sbImagesReady > 0 || sbVideosReady > 0 ? 'partial' : 'pending'
  }

  return {
    total,
    polished,
    video,
    universal,
    uniShots,
    sbImagesReady,
    sbVideosReady,
    sbVideosRevise,
    isGen,
    modeNote,
    imageLine,
    videoLine,
    sbImageLine,
    sbVideoLine,
    imageOk,
    videoOk,
    sbImageOk,
    sbVideoOk,
    remainingImagePrompts,
    remainingVideoPrompts,
    remainingSbImages,
    remainingSbVideos,
    sbVideosMissing,
    sbVideosBlocked,
    showImagePromptComplete: expectImageAi,
    showVideoPromptComplete: true,
    status,
  }
})

/** 步骤 3「生成提示词」是否可执行 */
const canGenerateStoryboardPromptsStep = computed(() => {
  const cov = storyboardPromptCoverage.value
  if (!cov) return false
  // 全文解说（经典或全能）：始终可点，内部会校验是否已配音
  if (storyboardFullNarrationVideoMode.value) return true
  const imageRemaining = cov.showImagePromptComplete ? cov.remainingImagePrompts : 0
  const videoRemaining = cov.showVideoPromptComplete ? cov.remainingVideoPrompts : 0
  return imageRemaining > 0 || videoRemaining > 0
})

const generatingStoryboardPromptsStep = computed(() =>
  generatingPromptsFromAudio.value ||
  completingImagePrompts.value ||
  completingVideoPrompts.value ||
  universalOmniPolishRunning.value
)

function sbNarrationText(sb) {
  if (!sb) return ''
  return collapseNarrationBlankLines((sbNarration.value[sb.id] ?? sb.narration) || '')
}

function sbNarrationStatsForSb(sb) {
  const maxSec = storyboardFullNarrationVideoMode.value ? UNIVERSAL_FULL_NARRATION_MAX_SEC : undefined
  return getNarrationStats(sbNarrationText(sb), narrationCharsPerSec.value, maxSec != null ? { maxSec } : {})
}

function sbNarrationShotDuration(sb) {
  const dur = Number(sbDuration.value[sb?.id] ?? sb?.duration)
  return Number.isFinite(dur) && dur > 0 ? dur : null
}

function sbNarrationEffectiveMaxChars() {
  return fullNarrationMaxChars.value
}

function sbNarrationStatsLabel(sb) {
  const { chars, neededSec, estSec } = sbNarrationStatsForSb(sb)
  const dur = sbNarrationShotDuration(sb)
  const maxChars = sbNarrationEffectiveMaxChars()
  const overMax = storyboardFullNarrationVideoMode.value && chars > maxChars
  const charPart = overMax ? `${chars} 字（超上限 ${maxChars}）` : `${chars} 字`
  const hasAudio = hasSbNarrationAudio(sb)
  // 有配音：以分镜 duration（配音实测写入）为准；无配音：展示字数估算
  const secPart = hasAudio
    ? (dur != null ? `配音 ${dur}s` : '已配音')
    : (neededSec > estSec
      ? `估算需约 ${neededSec} 秒（封顶 ${estSec}s）`
      : `估算约 ${estSec} 秒`)
  let durPart = ''
  if (!hasAudio && dur != null) {
    const mismatch = dur !== estSec
    durPart = mismatch ? ` · 分镜 ${dur}s（未按估算同步）` : ` · 分镜 ${dur}s`
  } else if (hasAudio && dur != null) {
    durPart = ` · 分镜 ${dur}s`
  }
  return `${charPart} · ${secPart}${durPart}`
}

function sbNarrationStatsClass(sb) {
  const { chars, neededSec, estSec } = sbNarrationStatsForSb(sb)
  const dur = sbNarrationShotDuration(sb)
  if (storyboardFullNarrationVideoMode.value && chars > sbNarrationEffectiveMaxChars()) {
    return 'sb-narration-stats--over-max'
  }
  // 有配音后不再拿字数估算对比标红
  if (!hasSbNarrationAudio(sb) && (neededSec > estSec || (dur != null && dur !== estSec))) {
    return 'sb-narration-stats--over-max'
  }
  return ''
}

function sbNarrationStatsTitle(sb) {
  const { chars, neededSec, estSec } = sbNarrationStatsForSb(sb)
  const cps = Number(narrationCharsPerSec.value || NARRATION_CHARS_PER_SEC_DEFAULT)
  const dur = sbNarrationShotDuration(sb)
  const hasAudio = hasSbNarrationAudio(sb)
  const parts = [
    `可读 ${chars} 字（不含标点）`,
    `按 ${cps} 字/秒估算 ${neededSec} 秒`,
  ]
  if (hasAudio) {
    parts.push('成片时长以配音实测为准（生成配音 / 按配音润色时写入 duration）')
    if (dur != null) parts.push(`当前分镜 duration=${dur}s`)
  } else {
    if (neededSec > estSec) parts.push(`成片时长公式封顶 ${estSec} 秒`)
    if (dur != null && dur !== estSec) {
      parts.push(`当前分镜 duration=${dur}s，与估算 ${estSec}s 不一致；配音后将以配音时长为准`)
    }
  }
  if (storyboardFullNarrationVideoMode.value) {
    parts.push(`以。切句 · 连续合并 · 硬上限 ${fullNarrationMaxChars.value} 字（≈12 秒）`)
  }
  return parts.join(' · ')
}

/** 全文解说：把本镜 duration 写成与旁白字数估算一致 */
function applyNarrationDurationToSbLocal(sb, estSec) {
  if (!sb?.id || !Number.isFinite(estSec)) return
  sbDuration.value = { ...sbDuration.value, [sb.id]: estSec }
  sb.duration = estSec
  const list = store.currentEpisode?.storyboards
  if (Array.isArray(list)) {
    const row = list.find((x) => Number(x.id) === Number(sb.id))
    if (row) row.duration = estSec
  }
}

async function syncSbDurationFromNarration(sb, { persist = true } = {}) {
  if (!sb?.id || !storyboardFullNarrationVideoMode.value) return null
  const text = sbNarrationText(sb).trim()
  const shotNum = Number(sb.storyboard_number ?? sb.shot_number) || 0
  let estSec
  if (shotNum === 1 && !text) {
    estSec = 6
  } else if (!text) {
    return null
  } else {
    estSec = sbNarrationStatsForSb(sb).estSec
  }
  applyNarrationDurationToSbLocal(sb, estSec)
  if (persist) {
    try {
      await storyboardsAPI.update(sb.id, {
        narration: text || null,
        duration: estSec,
      })
    } catch (_) { /* 静默 */ }
  }
  return estSec
}

/** 全文解说：按当前语速把本集所有有旁白的分镜 duration 对齐（不重切分段） */
async function syncAllStoryboardDurationsFromNarration() {
  if (!storyboardFullNarrationVideoMode.value) return 0
  const list = Array.isArray(storyboards.value) ? storyboards.value : []
  let n = 0
  for (const sb of list) {
    const text = sbNarrationText(sb).trim()
    const shotNum = Number(sb.storyboard_number ?? sb.shot_number) || 0
    let estSec = null
    if (shotNum === 1 && !text) estSec = 6
    else if (text) estSec = getNarrationStats(text, narrationCharsPerSec.value).estSec
    if (estSec == null) continue
    const before = Number(sbDuration.value[sb.id] ?? sb.duration)
    if (before === estSec) {
      applyNarrationDurationToSbLocal(sb, estSec)
      continue
    }
    applyNarrationDurationToSbLocal(sb, estSec)
    try {
      await storyboardsAPI.update(sb.id, { narration: text || null, duration: estSec })
      n += 1
    } catch (_) { /* 静默 */ }
  }
  return n
}

const resyncingFullNarration = ref(false)
const generatingPromptsFromAudio = ref(false)
/** 分镜生成是否使用全能模式（universal_segment_text，对接 Seedance / 可灵 Omni） */
const storyboardUniversalOmni = ref(false)
/** 经典首尾帧：默认开启（尾帧可用下一镜分镜图） */
const storyboardUseFirstLastFrame = ref(true)
const exportingStoryboardSheet = ref(false)
/** 生成尾帧时是否注入首帧作站位/构图参考（默认开启） */
const lastFrameUseFirstLayoutLock = ref(true)
const gridMode = ref('single') // 序列图模式：single / quad_grid / nine_grid

// ── 剧本长度 → 估算总时长；自动分镜数与项目「每段秒数」(videoClipDuration) 对齐 ──

/** 用于估算的每段时长（秒），与一键成片处「X秒/段」一致 */
function clipSecondsForStoryboardEstimate() {
  const c = Number(videoClipDuration.value)
  return Math.max(2, Math.min(60, Number.isFinite(c) && c > 0 ? c : 5))
}

/** 由估算总时长与每段秒数得镜数中枢与宽松参考区间（±1 镜） */
function shotCountEstimateFromDurationSec(sec) {
  const s = Math.max(10, Math.min(600, Math.round(Number(sec) || 0)))
  const clip = clipSecondsForStoryboardEstimate()
  const ideal = s / clip
  const locked = Math.max(1, Math.min(200, Math.round(ideal)))
  const minR = Math.max(1, locked - 1)
  const maxR = Math.min(200, locked + 1)
  const range = minR >= maxR ? { min: locked, max: locked } : { min: minR, max: maxR }
  return { locked, range, clip }
}

/** 由剧本字符数粗估成片总时长（短剧偏长镜）：秒数 = round(10 + (字数/600)×60)，夹在 10–600s */
function estimateVideoDurationSecFromCharLen(charLen) {
  const len = Math.max(0, Math.floor(Number(charLen) || 0))
  if (len < 1) return null
  const raw = Math.round(10 + (len / 600) * 60)
  return Math.min(600, Math.max(10, raw))
}

/** 当前剧本下的估算：总秒数、镜数中枢、镜数区间、采用的每段秒数 */
const scriptStoryboardEstimate = computed(() => {
  const script = (scriptContent.value || '').toString().trim()
  const len = script.length
  if (!len) return null
  const sec = estimateVideoDurationSecFromCharLen(len)
  if (sec == null) return null
  const { locked, range, clip } = shotCountEstimateFromDurationSec(sec)
  return { sec, locked, range, clip, len }
})

const scriptEstimateVideoDurationHint = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return ''
  return `（约 ${e.sec}s）`
})

const scriptEstimateVideoDurationTitle = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return '未填写时由 AI 根据剧本情节自然拆分镜数与单镜时长，不会按字数公式强制约束'
  return `仅供参考：按当前剧本文本约 ${e.len} 字粗估总时长约 ${e.sec} 秒（不会作为约束传给生成接口）。实际镜数由 AI 按情节决定；单镜时长优先参考项目「每段秒数」${e.clip}s，可按对白/动作调整。`
})

const scriptEstimateStoryboardHint = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return ''
  if (e.range && e.range.min !== e.range.max) {
    return `（参考约 ${e.locked} 镜，${e.range.min}–${e.range.max}，不强制）`
  }
  return `（参考约 ${e.locked} 镜，不强制）`
})

const scriptEstimateStoryboardTitle = computed(() => {
  const e = scriptStoryboardEstimate.value
  if (!e) return '留空时镜数由 AI 按剧本情节自然拆分（参照 ArcReel 剧情分镜），不会传入字数公式推算的镜数'
  return `仅供参考：若按字数公式粗算约 ${e.sec}s ÷ 每段 ${e.clip}s ≈ ${e.locked} 镜（区间 ${e.range.min}–${e.range.max}），不会作为约束传给后端。实际以情节驱动拆分。`
})


const storyboardLimitStatusLabel = computed(() => {
  const hasCount = userFilledStoryboardCount()
  const hasDur = userFilledVideoDuration()
  if (!hasCount && !hasDur) return '当前：未设约束，由 AI 按情节决定镜数与时长'
  const parts = []
  if (hasCount) parts.push(`镜数 ${storyboardCountInput.value}`)
  if (hasDur) parts.push(`总时长 ${videoDurationInput.value} 秒`)
  return `当前：${parts.join('，')}`
})

/** 清空分镜数量/总时长约束，改由 AI 按情节决定 */
function resetStoryboardLimitInputs({ silent = false, flash = false } = {}) {
  storyboardCountInput.value = ''
  videoDurationInput.value = ''
  storyboardLimitInputsKey.value += 1
  if (flash) {
    storyboardLimitJustCleared.value = true
    if (storyboardLimitClearedTimer) clearTimeout(storyboardLimitClearedTimer)
    storyboardLimitClearedTimer = setTimeout(() => {
      storyboardLimitJustCleared.value = false
      storyboardLimitClearedTimer = null
    }, 2000)
  }
  if (!silent) {
    ElMessage.success('已清空分镜数量与视频总时长，将由 AI 按情节决定')
  }
}

function onClearStoryboardLimits() {
  resetStoryboardLimitInputs({ flash: true })
}

function onClearStoryboardCountInput() {
  storyboardCountInput.value = ''
}

function onClearVideoDurationInput() {
  videoDurationInput.value = ''
}

function normalizeStoryboardCountInput() {
  const raw = String(storyboardCountInput.value ?? '').trim()
  if (!raw) {
    storyboardCountInput.value = ''
    return
  }
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 1) {
    storyboardCountInput.value = ''
    return
  }
  storyboardCountInput.value = String(Math.min(200, n))
}

function normalizeVideoDurationInput() {
  const raw = String(videoDurationInput.value ?? '').trim()
  if (!raw) {
    videoDurationInput.value = ''
    return
  }
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 10) {
    videoDurationInput.value = ''
    return
  }
  videoDurationInput.value = String(Math.min(600, n))
}

function userFilledStoryboardCount() {
  const v = String(storyboardCountInput.value ?? '').trim()
  if (!v) return false
  const n = Number(v)
  return Number.isFinite(n) && n >= 1
}

function userFilledVideoDuration() {
  const v = String(videoDurationInput.value ?? '').trim()
  if (!v) return false
  const n = Number(v)
  return Number.isFinite(n) && n >= 10
}

/** 请求后端的视频总时长：仅用户手动填写时传入 */
function getVideoDurationForApi() {
  if (userFilledVideoDuration()) return Math.round(Number(videoDurationInput.value))
  return undefined
}

/** 请求后端的分镜数量：仅用户手动填写时传入；留空则由 AI 按情节决定 */
function getStoryboardCountForApi() {
  if (userFilledStoryboardCount()) return Math.round(Number(storyboardCountInput.value))
  return undefined
}

function getFirstImageFile(dataTransfer) {
  if (!dataTransfer?.files?.length) return null
  const file = Array.from(dataTransfer.files).find((f) => f.type.startsWith('image/'))
  return file || null
}

// ── 参考图文件读取工具 ──────────────────────────────────
function readFileAsRefImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve({ dataUrl: ev.target.result, filename: file.name })
    reader.readAsDataURL(file)
  })
}

/**
 * 处理角色/道具/场景参考图文件选择（<input type="file"> change 事件）
 * type: 'character' | 'prop' | 'scene'
 */
async function onRefImageFileChange(type, event) {
  const file = event.target?.files?.[0]
  if (!file) return
  const result = await readFileAsRefImage(file)
  if (type === 'character') addCharRefImage.value = result
  else if (type === 'prop') addPropRefImage.value = result
  else if (type === 'scene') addSceneRefImage.value = result
  event.target.value = ''
}

/**
 * 处理角色/道具/场景参考图拖放（drop 事件）
 * type: 'character' | 'prop' | 'scene'
 */
async function onRefImageDrop(type, event) {
  const file = getFirstImageFile(event.dataTransfer)
  if (!file) return
  const result = await readFileAsRefImage(file)
  if (type === 'character') addCharRefImage.value = result
  else if (type === 'prop') addPropRefImage.value = result
  else if (type === 'scene') addSceneRefImage.value = result
}

/**
 * 处理"添加道具"简单弹窗的参考图文件选择
 * type: 'addProp'
 */
async function onRefImageFileChange2(type, event) {
  const file = event.target?.files?.[0]
  if (!file) return
  const result = await readFileAsRefImage(file)
  if (type === 'addProp') addPropAddRefImage.value = result
  event.target.value = ''
}

/**
 * 处理"添加道具"简单弹窗的参考图拖放
 * type: 'addProp'
 */
async function onRefImageDrop2(type, event) {
  const file = getFirstImageFile(event.dataTransfer)
  if (!file) return
  const result = await readFileAsRefImage(file)
  if (type === 'addProp') addPropAddRefImage.value = result
}

/**
 * 从本地选择（尚未保存到服务器）的参考图中提取特征描述
 * type: 'character' | 'prop' | 'scene'
 */
async function doExtractFromRef(type) {
  if (type === 'character') {
    const refImage = addCharRefImage.value
    if (!refImage) return
    extractingCharAppearance.value = true
    try {
      const name = editCharacterForm.value?.name || ''
      const res = await uploadAPI.extractDescriptionFromImage('character', refImage.dataUrl, name)
      if (res?.description && editCharacterForm.value) {
        editCharacterForm.value.appearance = res.description
        ElMessage.success('已从参考图提取外貌描述')
      }
    } catch (e) {
      ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
    } finally {
      extractingCharAppearance.value = false
    }
  } else if (type === 'prop') {
    const refImage = addPropRefImage.value
    if (!refImage) return
    extractingPropDesc.value = true
    try {
      const name = editPropForm.value?.name || ''
      const res = await uploadAPI.extractDescriptionFromImage('prop', refImage.dataUrl, name)
      if (res?.description && editPropForm.value) {
        editPropForm.value.description = res.description
        ElMessage.success('已从参考图提取特征描述')
      }
    } catch (e) {
      ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
    } finally {
      extractingPropDesc.value = false
    }
  } else if (type === 'scene') {
    const refImage = addSceneRefImage.value
    if (!refImage) return
    extractingSceneDesc.value = true
    try {
      const name = editSceneForm.value?.name || ''
      const res = await uploadAPI.extractDescriptionFromImage('scene', refImage.dataUrl, name)
      if (res?.description && editSceneForm.value) {
        editSceneForm.value.description = res.description
        ElMessage.success('已从参考图提取场景描述')
      }
    } catch (e) {
      ElMessage.error(e.message || '提取失败，请检查 AI 配置中是否有支持视觉的模型')
    } finally {
      extractingSceneDesc.value = false
    }
  }
}

function onResourceDragOver(e, type, id) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  const key = type === 'character' ? 'char-' : type === 'prop' ? 'prop-' : 'scene-'
  dragOverResourceKey.value = key + id
}
function onResourceDragLeave(e, key) {
  e.preventDefault()
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
  if (key && dragOverResourceKey.value !== key) return
  dragOverResourceKey.value = null
}
function onResourceDrop(e, type, id) {
  e.preventDefault()
  e.stopPropagation()
  dragOverResourceKey.value = null
  const file = getFirstImageFile(e.dataTransfer)
  if (file) doUploadResourceImage(type, id, file)
}
function onSbImageDragOver(e, sbId) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragOverSbId.value = sbId
}
function onSbImageDragLeave(e, sbId) {
  e.preventDefault()
  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return
  if (sbId != null && dragOverSbId.value !== sbId) return
  dragOverSbId.value = null
}
function onSbImageDrop(e, sb) {
  e.preventDefault()
  e.stopPropagation()
  dragOverSbId.value = null
  const file = getFirstImageFile(e.dataTransfer)
  if (file && sb?.id) doUploadSbImage(sb.id, file)
}

const baseUrl = ref('')
const previewImageUrl = ref(null)
function imageUrl(url) {
  if (!url) return ''
  if (url.startsWith('http')) return url
  const base = (baseUrl.value || '').replace(/\/$/, '')
  return base ? base + '/' + url.replace(/^\//, '') : url
}
/** 优先使用本地地址，避免远程图失效。item 为 { ref_image, image_url, local_path } 或字符串 url */
function assetImageUrl(item) {
  if (!item) return ''
  if (typeof item === 'string') return imageUrl(item)
  const refImage = item.ref_image && String(item.ref_image).trim()
  if (refImage) {
    if (refImage.startsWith('http')) return refImage
    return '/static/' + refImage.replace(/^\//, '')
  }
  const localPath = item.local_path && String(item.local_path).trim()
  if (localPath) {
    const p = localPath.replace(/^\//, '')
    return '/static/' + p
  }
  if (item.image_url) return imageUrl(item.image_url)
  return ''
}
function hasAssetImage(item) {
  if (!item) return false
  return !!(item.ref_image || item.image_url || item.local_path || item.video_ref_local_path)
}

/** 生视频用场景参考：禁止四宫格整图，优先 video_ref_local_path（拆分后的单格） */
function sceneVideoRefUrl(scene) {
  if (!scene) return ''
  if (scene.video_ref_local_path) {
    return assetImageUrl({ local_path: scene.video_ref_local_path })
  }
  if (scene.ref_image) return assetImageUrl({ ref_image: scene.ref_image })
  const polished = String(scene.polished_prompt || '').trim()
  const polishedSingle = String(scene.polished_prompt_single || '').trim()
  const isQuad =
    polished &&
    (/2\s*[x×]\s*2|four.?panel|quad|grid layout|四格|四宫格|top-left|top-right/i.test(polished) ||
      (polishedSingle && polishedSingle !== polished))
  if (isQuad && !scene.video_ref_local_path) {
    return ''
  }
  return assetImageUrl(scene)
}

/**
 * 挑选批量配图目标：优先缺图；若全部已有图则询问是否全部重生成。
 * @returns {Promise<object[]|null>}
 */
async function pickBatchImageTargets(list, label) {
  const all = Array.isArray(list) ? list : []
  if (!all.length) {
    ElMessage.warning(`暂无${label}`)
    return null
  }
  const missing = all.filter((x) => !hasAssetImage(x))
  if (missing.length) {
    if (missing.length < all.length) {
      ElMessage.info(`将为 ${missing.length} 个缺图${label}生成配图（已有图的 ${all.length - missing.length} 个跳过）`)
    }
    return missing
  }
  try {
    await ElMessageBox.confirm(
      `全部 ${all.length} 个${label}已有配图。是否全部重新生成？`,
      `一键生成${label}配图`,
      { confirmButtonText: '全部重新生成', cancelButtonText: '取消', type: 'warning' }
    )
    return [...all]
  } catch {
    return null
  }
}

async function onBatchGenerateCharacterImages() {
  if (batchGeneratingCharImages.value) return
  const targets = await pickBatchImageTargets(characters.value || [], '角色')
  if (!targets?.length) return
  batchGeneratingCharImages.value = true
  batchCharImageProgress.value = { current: 0, total: targets.length }
  const style = getSelectedStyle()
  const concurrency = Math.max(1, Number(pipelineConcurrency.value) || 3)
  let ok = 0
  let fail = 0
  let done = 0
  try {
    await runConcurrently(targets, concurrency, async (char) => {
      generatingCharIds.add(char.id)
      try {
        const res = await characterAPI.generateImage(char.id, getSelectedImageModel(), style)
        const taskId = res?.image_generation?.task_id ?? res?.task_id
        if (taskId) {
          const pollRes = await pollTask(taskId, () => loadDrama())
          if (pollRes?.status === 'failed') throw new Error(pollRes.error || '生成失败')
        } else {
          await loadDrama()
          await pollUntilResourceHasImage(() => {
            const list = store.drama?.characters ?? store.currentEpisode?.characters ?? []
            const c = list.find((x) => Number(x.id) === Number(char.id))
            return !!(c && (c.image_url || c.local_path))
          })
        }
        ok += 1
      } catch (e) {
        fail += 1
        console.warn('[一键角色配图]', char?.name || char?.id, e)
      } finally {
        generatingCharIds.delete(char.id)
        done += 1
        batchCharImageProgress.value = { current: done, total: targets.length }
      }
    }, { getLabel: (c) => `角色配图 ${c.name || c.id}` })
    if (fail === 0) ElMessage.success(`已生成 ${ok} 张角色配图`)
    else ElMessage.warning(`角色配图完成：成功 ${ok}，失败 ${fail}`)
    await loadDrama()
  } finally {
    batchGeneratingCharImages.value = false
    batchCharImageProgress.value = { current: 0, total: 0 }
  }
}

async function onBatchGenerateSceneImages() {
  if (batchGeneratingSceneImages.value) return
  const targets = await pickBatchImageTargets(scenes.value || [], '场景')
  if (!targets?.length) return
  batchGeneratingSceneImages.value = true
  batchSceneImageProgress.value = { current: 0, total: targets.length }
  const style = getSelectedStyle()
  const useQuad = !!sceneUseQuadGrid.value
  const concurrency = Math.max(1, Number(pipelineConcurrency.value) || 3)
  let ok = 0
  let fail = 0
  let done = 0
  try {
    await runConcurrently(targets, concurrency, async (scene) => {
      generatingSceneIds.add(scene.id)
      try {
        const res = await sceneAPI.generateImage({
          scene_id: scene.id,
          model: getSelectedImageModel(),
          style,
          use_quad_grid: useQuad,
        })
        const taskId = res?.image_generation?.task_id ?? res?.task_id
        if (taskId) {
          const pollRes = await pollTask(taskId, () => loadDrama())
          if (pollRes?.status === 'failed') throw new Error(pollRes.error || '生成失败')
        } else {
          await loadDrama()
          await pollUntilResourceHasImage(() => {
            const list = store.drama?.scenes ?? store.currentEpisode?.scenes ?? []
            const s = list.find((x) => Number(x.id) === Number(scene.id))
            return !!(s && (s.image_url || s.local_path))
          })
        }
        ok += 1
      } catch (e) {
        fail += 1
        console.warn('[一键场景配图]', scene?.location || scene?.id, e)
      } finally {
        generatingSceneIds.delete(scene.id)
        done += 1
        batchSceneImageProgress.value = { current: done, total: targets.length }
      }
    }, { getLabel: (s) => `场景配图 ${s.location || s.id}` })
    if (fail === 0) ElMessage.success(`已生成 ${ok} 张场景配图`)
    else ElMessage.warning(`场景配图完成：成功 ${ok}，失败 ${fail}`)
    await loadDrama()
  } finally {
    batchGeneratingSceneImages.value = false
    batchSceneImageProgress.value = { current: 0, total: 0 }
  }
}

async function onBatchGeneratePropImages() {
  if (batchGeneratingPropImages.value) return
  const targets = await pickBatchImageTargets(props.value || [], '道具')
  if (!targets?.length) return
  batchGeneratingPropImages.value = true
  batchPropImageProgress.value = { current: 0, total: targets.length }
  const style = getSelectedStyle()
  const concurrency = Math.max(1, Number(pipelineConcurrency.value) || 3)
  let ok = 0
  let fail = 0
  let done = 0
  try {
    await runConcurrently(targets, concurrency, async (prop) => {
      generatingPropIds.add(prop.id)
      try {
        const res = await propAPI.generateImage(prop.id, getSelectedImageModel(), style)
        const taskId = res?.task_id ?? res?.image_generation?.task_id
        if (taskId) {
          const pollRes = await pollTask(taskId, () => loadDrama())
          if (pollRes?.status === 'failed') throw new Error(pollRes.error || '生成失败')
        } else {
          await loadDrama()
          await pollUntilResourceHasImage(() => {
            const list = store.drama?.props ?? store.currentEpisode?.props ?? []
            const p = list.find((x) => Number(x.id) === Number(prop.id))
            return !!(p && (p.image_url || p.local_path))
          })
        }
        ok += 1
      } catch (e) {
        fail += 1
        console.warn('[一键道具配图]', prop?.name || prop?.id, e)
      } finally {
        generatingPropIds.delete(prop.id)
        done += 1
        batchPropImageProgress.value = { current: done, total: targets.length }
      }
    }, { getLabel: (p) => `道具配图 ${p.name || p.id}` })
    if (fail === 0) ElMessage.success(`已生成 ${ok} 张道具配图`)
    else ElMessage.warning(`道具配图完成：成功 ${ok}，失败 ${fail}`)
    await loadDrama()
  } finally {
    batchGeneratingPropImages.value = false
    batchPropImageProgress.value = { current: 0, total: 0 }
  }
}

function getSelectedStyle() {
  return getSelectedStylePrompt()
}
function openImagePreview(url) {
  previewImageUrl.value = url
}
function closeImagePreview() {
  previewImageUrl.value = null
}
/** 视频地址：优先 local_path（/static/），否则 video_url */
function assetVideoUrl(item) {
  if (!item) return ''
  const localPath = item.local_path && String(item.local_path).trim()
  if (localPath) return '/static/' + localPath.replace(/^\//, '')
  if (item.video_url) return imageUrl(item.video_url)
  return ''
}
/** 远程视频须为 http(s)，避免上游 FAILURE 时把错误文案写入 video_url */
function isHttpVideoUrl(url) {
  if (!url || typeof url !== 'string') return false
  const t = url.trim()
  return t.startsWith('http://') || t.startsWith('https://')
}
/** 分镜行 local_path 是否为视频文件（生视频完成时会覆盖 local_path） */
function isStoryboardVideoLocalPath(rel) {
  const lp = String(rel || '').trim()
  return !!(lp && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(lp))
}
/** 列表项是否具备可播放地址（避免仅有空白 local_path 时外层有卡片、内层无 <video>） */
function recordHasPlayableVideoUrl(i) {
  if (!i) return false
  const lp = i.local_path && String(i.local_path).trim()
  if (lp) return true
  return isHttpVideoUrl(i.video_url)
}
/** 分镜是否已有可播放视频（video_generations 列表 + 分镜行 video_url/local_path） */
function sbHasStoryboardVideo(sb) {
  if (!sb?.id) return false
  const vidList = sbVideos.value[sb.id]
  if (Array.isArray(vidList) && vidList.some((v) => v.status === 'completed' && recordHasPlayableVideoUrl(v))) return true
  if (isHttpVideoUrl(sb.video_url)) return true
  return isStoryboardVideoLocalPath(sb.local_path)
}
/** @deprecated 请用 sbHasStoryboardVideo(sb) */
function sbHasCompletedVideo(storyboardId) {
  const sb = (store.storyboards || []).find((b) => b.id === storyboardId)
  return sb ? sbHasStoryboardVideo(sb) : false
}
/** 主播放器强制随记录/地址重建，避免重新生成后 <video> 仍缓存旧 src */
function sbMainVideoPlayerKey(sbId) {
  const v = getSbVideo(sbId)
  if (!v) return ''
  const src = assetVideoUrl(v)
  return `${v.id}:${v.updated_at || ''}:${src.slice(0, 160)}`
}
function onStoryboardUseFirstLastFrameChange() {
  if (storyboardUseFirstLastFrame.value && gridMode.value !== 'single') {
    gridMode.value = 'single'
    ElMessage.info('首尾帧模式已开启，序列图已切换为单张')
  }
  saveProjectSettings(false)
}

function uploadingSbImageSlot(sbId) {
  return sbImageUploadSlotById.value[sbId] || null
}

function frameTypeForSlot(slot) {
  return slot === 'last' ? 'storyboard_last' : 'storyboard_first'
}

function resolveSbImageById(storyboardId, imageId) {
  if (imageId == null) return null
  const images = getSbAllImages(storyboardId)
  return images.find((i) => i.id === imageId) || null
}

/** 首帧图（首尾帧模式下严格优先服务器绑定的 first_frame_image_id） */
function getSbFirstImage(storyboardId) {
  const images = getSbAllImages(storyboardId)
  const sb = (store.storyboards || []).find((b) => b.id === storyboardId)

  // 最高权威：服务器已绑定的首帧
  if (sb?.first_frame_image_id != null) {
    const bound = resolveSbImageById(storyboardId, sb.first_frame_image_id)
    if (bound) return bound
  }

  const sel = sbSelectedImgId.value[storyboardId]
  if (sel != null) {
    const found = images.find((i) => i.id === sel)
    if (found) return found
  }

  const typed = images.find((i) => i.frame_type === 'storyboard_first')
  if (typed) return typed
  // 不再回退到 images[0]，避免把尾帧图片误显示为首帧
  return null
}

/** 尾帧图（首尾帧模式下严格优先服务器绑定的 last_frame_image_id） */
function getSbLastImage(storyboardId) {
  const images = getSbAllImages(storyboardId)
  const sb = (store.storyboards || []).find((b) => b.id === storyboardId)

  // 最高权威：服务器已绑定的尾帧（后端 bindStoryboardFrameImage 正确写入的 last_frame_image_id）
  if (sb?.last_frame_image_id != null) {
    const bound = resolveSbImageById(storyboardId, sb.last_frame_image_id)
    if (bound) return bound
  }

  // 仅在没有服务器绑定时才考虑手动选择（首尾帧生成后我们会主动清除手动选择）
  const sel = sbSelectedLastImgId.value[storyboardId]
  if (sel != null) {
    const found = images.find((i) => i.id === sel)
    if (found) return found
  }

  const typed = images.find((i) => i.frame_type === 'storyboard_last')
  if (typed) return typed

  if (sb?.last_frame_image_url || sb?.last_frame_local_path) {
    return {
      id: sb.last_frame_image_id,
      image_url: sb.last_frame_image_url,
      local_path: sb.last_frame_local_path,
      frame_type: 'storyboard_last',
    }
  }
  return null
}

/** 该分镜是否有图（接口拉取的或 composed_image） */
function hasSbImage(sb) {
  if (storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)) {
    return !!(getSbFirstImage(sb.id) || (sb && (sb.composed_image || sb.image_url)))
  }
  return !!(getSbImage(sb.id) || (sb && (sb.composed_image || sb.image_url)))
}

/** 分镜图是否已持久化（库字段 + 已拉取的 image_generations，与批量生图判定对齐） */
function sbHasStoryboardImage(sb) {
  if (!sb?.id) return false
  if (sbMediaLoadedIds.has(sb.id)) return hasSbImage(sb)
  const imgs = sbImages.value[sb.id]
  if (Array.isArray(imgs) && imgs.some(
    (i) => i.status === 'completed' && i.frame_type !== 'quad_grid' && i.frame_type !== 'nine_grid' && (i.image_url || i.local_path)
  )) return true
  if (sb.composed_image || sb.image_url) return true
  if (sb.first_frame_image_id != null) return true
  const lp = String(sb.local_path || '').trim()
  return !!(lp && !/\.(mp4|webm|mov|m4v)(\?|$)/i.test(lp))
}

/** 视频审阅标记：ok=可用 / revise=要修改 / ''=未标记 */
function getSbVideoReview(sb) {
  const v = (sb?.video_review || '').toString().trim()
  return v === 'ok' || v === 'revise' ? v : ''
}

function sbNeedsVideoRevision(sb) {
  return getSbVideoReview(sb) === 'revise'
}

async function onSetSbVideoReview(sb, value) {
  if (!sb?.id) return
  const next = value === 'ok' || value === 'revise' ? value : null
  const prev = getSbVideoReview(sb) || null
  sb.video_review = next
  const syncLists = [store.storyboards, store.currentEpisode?.storyboards]
  for (const list of syncLists) {
    if (!Array.isArray(list)) continue
    const row = list.find((x) => Number(x.id) === Number(sb.id))
    if (row) row.video_review = next
  }
  try {
    await storyboardsAPI.update(sb.id, { video_review: next })
  } catch (e) {
    sb.video_review = prev
    for (const list of syncLists) {
      if (!Array.isArray(list)) continue
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) row.video_review = prev
    }
    ElMessage.error(e.message || '保存审阅标记失败')
  }
}

/** 批量视频候选：缺视频，或已标记「要修改」需重生成 */
function sbNeedsBatchVideo(sb) {
  if (!sb?.id) return false
  if (sbNeedsNarrationAudioBeforeVideo(sb)) return false
  const canGen = (() => {
    if (isSbUniversalMode(sb.id)) {
      if (!sbCanSubmitVideo(sb)) return false
      return collectSbOmniReferenceAbsoluteUrls(sb).length > 0
    }
    if (!sbCanSubmitVideo(sb)) return false
    return !!getSbFirstFrameUrl(sb)
  })()
  if (!canGen) return false
  if (sbNeedsVideoRevision(sb)) return true
  return !sbHasStoryboardVideo(sb)
}

/** 批量分镜图补全候选：尚无分镜图 */
function sbNeedsBatchImage(sb) {
  return !!sb?.id && !sbHasStoryboardImage(sb)
}

function hasSbFirstLastPair(sb) {
  return !!(getSbFirstImage(sb.id) && getSbLastImage(sb.id))
}
/** 取该分镜下所有已完成的非四宫格图片列表 */
function getSbAllImages(storyboardId) {
  const list = sbImages.value[storyboardId]
  if (!Array.isArray(list)) return []
  return list.filter((i) => i.status === 'completed' && i.frame_type !== 'quad_grid' && i.frame_type !== 'nine_grid' && (i.image_url || i.local_path))
}
/** 取当前主图（首尾帧模式下等同首帧） */
function getSbImage(storyboardId) {
  if (storyboardUseFirstLastFrame.value) return getSbFirstImage(storyboardId)
  const images = getSbAllImages(storyboardId)
  if (!images.length) return null
  const selectedId = sbSelectedImgId.value[storyboardId]
  if (selectedId != null) {
    const found = images.find((i) => i.id === selectedId)
    if (found) return found
  }
  return images[0]
}
/** 取该分镜下的四宫格整图记录 */
/** 取该分镜下的四宫格整图记录 */
function getQuadGridImage(storyboardId) {
  const list = sbImages.value[storyboardId]
  if (!Array.isArray(list)) return null
  return list.find((i) => i.status === 'completed' && (i.frame_type === 'quad_grid' || i.frame_type === 'nine_grid') && (i.image_url || i.local_path)) || null
}
/** 取该分镜所有已完成的视频记录 */
function getSbAllVideos(storyboardId) {
  const list = sbVideos.value[storyboardId]
  if (!Array.isArray(list)) return []
  return list.filter((i) => i.status === 'completed' && recordHasPlayableVideoUrl(i))
}
/** 取该分镜当前选中的视频（尊重 sbSelectedVideoId，否则默认第一条） */
function getSbVideo(storyboardId) {
  const all = getSbAllVideos(storyboardId)
  if (all.length === 0) return null
  const selectedId = sbSelectedVideoId.value[storyboardId]
  if (selectedId != null) {
    const found = all.find((v) => v.id === selectedId)
    if (found) return found
  }
  return all[0]
}
/** 取下一个分镜（按 storyboard_number 顺序） */
function getNextStoryboard(storyboardId) {
  const list = store.storyboards || []
  const idx = list.findIndex((s) => s.id === storyboardId)
  if (idx === -1 || idx === list.length - 1) return null
  return list[idx + 1]
}

/** 取上一个分镜（按 storyboard_number 顺序，用于“上镜尾帧”快速衔接） */
function getPrevStoryboard(storyboardId) {
  const list = store.storyboards || []
  const idx = list.findIndex((s) => s.id === storyboardId)
  if (idx === -1 || idx === 0) return null
  return list[idx - 1]
}

/** 辅助判断：当前分镜是否有“上一镜尾帧”可用于快速替换首帧 */
function canUsePrevTailAsFirst(sb) {
  const p = getPrevStoryboard(sb?.id)
  return !!(p && getSbLastImage(p.id))
}

/** 分镜图条：全部已完成图片（含当前主图），便于单条删除 */
function getImageStripItems(storyboardId) {
  const all = getSbAllImages(storyboardId)
  const current = getSbImage(storyboardId)
  return all.map((img, idx) => {
    const isCurrent = !!(current && img.id === current.id)
    return {
      key: `img-${img.id}`,
      img,
      src: assetImageUrl(img),
      isCurrent,
      label: isCurrent ? (all.length === 1 ? '当前' : `当前·${idx + 1}`) : `历史${idx + 1}`,
    }
  })
}

/** 视频条：该分镜全部已完成视频（含当前选中），便于单条删除 */
function getVideoStripItems(storyboardId) {
  const all = getSbAllVideos(storyboardId)
  const current = getSbVideo(storyboardId)
  return all.map((v, idx) => {
    const isCurrent = !!(current && v.id === current.id)
    return {
      key: `vid-${v.id}`,
      video: v,
      src: assetVideoUrl(v),
      isCurrent,
      label: isCurrent ? (all.length === 1 ? '当前' : `当前·${idx + 1}`) : `历史${idx + 1}`,
    }
  })
}
/** 选中某条历史视频为当前视频，并持久化到分镜记录供合成视频使用 */
function onSelectSbMainVideo(sb, video) {
  sbSelectedVideoId.value = { ...sbSelectedVideoId.value, [sb.id]: video.id }
  storyboardsAPI.update(sb.id, {
    video_url: video.video_url || null,
    local_path: video.local_path || undefined,
  }).catch(e => console.warn('[主视频] 保存后端失败', e))
}

/** 删除分镜单条视频（当前或历史均可；删光后清空分镜绑定） */
async function onRemoveSbHistoryVideo(storyboardId, videoGenId) {
  if (!storyboardId || !videoGenId) return
  const allBefore = getSbAllVideos(storyboardId)
  const isOnly = allBefore.length <= 1
  const isCurrent = getSbVideo(storyboardId)?.id === videoGenId
  try {
    await ElMessageBox.confirm(
      isOnly
        ? '确定删除这条视频？删除后本镜将无视频，可重新生成。'
        : isCurrent
          ? '确定删除当前视频？将自动切到其余历史视频。'
          : '确定删除这条历史视频？此操作不可恢复。',
      '删除视频',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        distinguishCancelAndClose: true,
      }
    )
    await videosAPI.delete(videoGenId)
    const sel = { ...sbSelectedVideoId.value }
    if (sel[storyboardId] === videoGenId) delete sel[storyboardId]
    sbSelectedVideoId.value = sel
    await loadSingleStoryboardMedia(storyboardId)
    const remain = getSbAllVideos(storyboardId)
    if (remain.length === 0) {
      try {
        await storyboardsAPI.update(storyboardId, { video_url: null, local_path: null })
        const sb = (store.storyboards || []).find((s) => s.id === storyboardId)
        if (sb) {
          sb.video_url = null
          sb.local_path = null
        }
        const intro = store.currentEpisode?.intro_storyboard
        if (intro && Number(intro.id) === Number(storyboardId)) {
          applyIntroToEpisodeStore({ ...intro, video_url: null, local_path: null })
        }
      } catch (e) {
        console.warn('[删视频] 清空分镜绑定失败', e)
      }
    } else if (isCurrent) {
      const intro = store.currentEpisode?.intro_storyboard
      if (intro && Number(intro.id) === Number(storyboardId)) {
        onSelectIntroVideo(remain[0])
      } else {
        onSelectSbMainVideo(
          (store.storyboards || []).find((s) => s.id === storyboardId) || { id: storyboardId },
          remain[0]
        )
      }
    }
    ElMessage.success(remain.length === 0 ? '视频已删除' : '已删除')
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(err?.message || '删除失败')
    }
  }
}
/** 取该分镜最近一次视频生成的错误信息（从 API 返回的记录或本地即时错误） */
function getSbVideoError(storyboardId) {
  if (sbVideoErrors.value[storyboardId]) return sbVideoErrors.value[storyboardId]
  const list = sbVideos.value[storyboardId]
  if (!Array.isArray(list) || list.length === 0) return ''
  const hasCompleted = list.some((i) => i.status === 'completed' && recordHasPlayableVideoUrl(i))
  if (hasCompleted) return ''
  const bogusCompleted = list.find(
    (i) => i.status === 'completed' && i.video_url && !recordHasPlayableVideoUrl(i)
  )
  if (bogusCompleted) {
    const u = String(bogusCompleted.video_url || '').trim()
    if (u) return u
    if (bogusCompleted.error_msg) return bogusCompleted.error_msg
  }
  const failed = list.filter((i) => i.status === 'failed' && i.error_msg)
  if (failed.length === 0) return ''
  return failed[0].error_msg
}

/** 可「继续查询」的失败记录：有上游 task 且后端标记 can_resume_poll */
function getSbResumableFailedVideo(storyboardId) {
  const list = sbVideos.value[storyboardId]
  if (!Array.isArray(list) || list.length === 0) return null
  return list.find((i) => i.status === 'failed' && i.can_resume_poll) || null
}

function resetStoryboardMediaCache() {
  sbImages.value = {}
  sbVideos.value = {}
  sbMediaLoadedIds.clear()
  sbSelectedImgId.value = {}
  sbSelectedLastImgId.value = {}
  sbSelectedVideoId.value = {}
}

function storyboardMediaKeyForEpisode(ep) {
  if (!ep?.id) return ''
  const boards = ep.storyboards || store.storyboards || []
  return `${ep.id}:${boards.map((s) => s.id).join(',')}`
}

async function loadStoryboardMedia(options = {}) {
  const boards = store.storyboards || []
  if (boards.length === 0) {
    resetStoryboardMediaCache()
    return
  }
  if (options.force) resetStoryboardMediaCache()
  const targetBoards = options.all ? boards : pagedStoryboards.value
  await loadStoryboardMediaForBoards(targetBoards, { skipLoaded: !options.force })
}

/** 已拉取过图片/视频列表的分镜 id（按页懒加载，减轻首屏请求） */
const sbMediaLoadedIds = new Set()

async function loadStoryboardMediaForBoards(boards, options = {}) {
  const list = Array.isArray(boards) ? boards.filter(Boolean) : []
  const skipLoaded = options.skipLoaded ?? true
  const toLoad = list.filter((sb) => sb?.id && (!skipLoaded || !sbMediaLoadedIds.has(sb.id)))
  if (toLoad.length === 0) return
  await Promise.all(
    toLoad.map(async (sb) => {
      try {
        const [imgRes, vidRes] = await Promise.all([
          imagesAPI.list({ storyboard_id: sb.id, page: 1, page_size: 100 }),
          videosAPI.list({ storyboard_id: sb.id, page: 1, page_size: 50 })
        ])
        sbImages.value[sb.id] = (imgRes && imgRes.items) ? imgRes.items : []
        sbVideos.value[sb.id] = (vidRes && vidRes.items) ? vidRes.items : []
        sbMediaLoadedIds.add(sb.id)
      } catch (err) {
        // 失败时不写入空列表、不标记已加载，避免批量/并发时误判「无图无视频」并覆盖已有缓存
        console.warn('[loadStoryboardMedia] 拉取失败', sb.id, err?.message || err)
      }
    })
  )
  restoreSelectionsFromBackend()
}

function getGeneratingSetsBag() {
  return {
    generatingCharIds,
    generatingPropIds,
    generatingSceneIds,
    generatingSbImageIds,
    generatingSbFirstImageIds,
    generatingSbLastImageIds,
    generatingSbVideoIds,
  }
}

function buildSbGenMeta(sb, resourceType, labelPrefix) {
  const num = sb?.storyboard_number ?? sb?.id
  const epNum = store.currentEpisode?.episode_number
  const dramaTitle = store.drama?.title || ''
  const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
  return {
    dramaId: dramaId.value,
    episodeId: currentEpisodeId.value,
    dramaTitle,
    episodeNumber: epNum,
    resourceType,
    resourceId: sb.id,
    label: `${epLabel} ${labelPrefix} #${num}`,
  }
}

/** 分镜视频是否正在生成（单条点击、批量、一键成片、任务恢复均覆盖） */
function isSbVideoGenerating(sbId) {
  if (generatingSbVideoIds.has(sbId)) return true
  if (sbId == null || dramaId.value == null || currentEpisodeId.value == null) return false
  return genStore.isRunning({
    dramaId: dramaId.value,
    episodeId: currentEpisodeId.value,
    resourceType: GEN_RESOURCE.SB_VIDEO,
    resourceId: sbId,
  })
}

async function recoverAndSyncEpisodeTasks(epId) {
  const did = dramaId.value
  const eid = epId ?? currentEpisodeId.value
  if (!did || !eid) return
  const ctx = buildEpisodeContext(store, did, eid)
  await genStore.recoverPendingForEpisode({
    ...ctx,
    ElMessage,
    callbacks: {
      onStoryboardMedia: (sbId) => loadSingleStoryboardMedia(sbId),
      onDramaRefresh: () => loadDrama(),
      onEpisodeMergeComplete: () => {
        store.setVideoStatus('done', did, eid)
        store.setVideoProgress(100, did, eid)
      },
      onEpisodeMergeFailed: (err) => {
        store.setVideoStatus('error', did, eid)
        videoErrorMsg.value = err || '视频生成失败'
      },
    },
  })
  syncGeneratingSetsFromStore(genStore, did, eid, getGeneratingSetsBag())
  const mergeRunning = genStore.getRunningForEpisode(did, eid).some(
    (t) => t.resourceType === GEN_RESOURCE.EPISODE_MERGE
  )
  if (mergeRunning) {
    store.setVideoStatus('generating', did, eid)
  }
}

/** 只刷新单条分镜的图片/视频，避免每次单图操作都全量请求所有分镜 */
async function loadSingleStoryboardMedia(sbId) {
  if (!sbId) return
  try {
    const [imgRes, vidRes] = await Promise.all([
      imagesAPI.list({ storyboard_id: sbId, page: 1, page_size: 100 }),
      videosAPI.list({ storyboard_id: sbId, page: 1, page_size: 50 })
    ])
    sbImages.value = {
      ...sbImages.value,
      [sbId]: (imgRes && imgRes.items) ? imgRes.items : []
    }
    sbVideos.value = {
      ...sbVideos.value,
      [sbId]: (vidRes && vidRes.items) ? vidRes.items : []
    }
    sbMediaLoadedIds.add(sbId)
    restoreSelectionsFromBackend()
  } catch (_) {
    // 静默忽略，不影响其他分镜的显示
  }
}

// ── 主图选择 ─────────────────────────────────────────────────────────

const sbSelectedImgId = ref({})   // sbId → 选中的首帧/主图 image_generation.id
const sbSelectedLastImgId = ref({}) // sbId → 选中的尾帧 image_generation.id
const sbSelectedVideoId = ref({}) // sbId → 选中的 video_generation.id
const generatingSbFirstImageIds = reactive(new Set())
const generatingSbLastImageIds = reactive(new Set())
/** sbId → 'first' | 'last'，上传目标槽位 */
const sbImageUploadSlotById = ref({})

/**
 * 从后端 storyboard.image_url / local_path 恢复主图选择状态。
 * 与 image_generation 记录比对，找到匹配的记录并恢复 sbSelectedImgId。
 */
function restoreSelectionsFromBackend() {
  const boards = store.storyboards || []
  for (const sb of boards) {
    const images = getSbAllImages(sb.id)
    if (sbSelectedImgId.value[sb.id] == null) {
      if (sb.first_frame_image_id != null) {
        sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: sb.first_frame_image_id }
      } else {
        const sbPath = (sb.local_path || '').trim()
        const sbUrl = (sb.image_url || '').trim()
        if (sbPath || sbUrl) {
          const matched = images.find(
            (img) =>
              (sbPath && img.local_path && img.local_path === sbPath) ||
              (sbUrl && img.image_url && img.image_url === sbUrl)
          )
          if (matched) {
            sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: matched.id }
          }
        }
      }
    }
    if (sbSelectedLastImgId.value[sb.id] == null && sb.last_frame_image_id != null) {
      sbSelectedLastImgId.value = { ...sbSelectedLastImgId.value, [sb.id]: sb.last_frame_image_id }
    }
  }
}

/** 获取缩略图条数据：已绑定首尾帧以外的历史图 */
function getStripItems(storyboardId) {
  const allImgs = getSbAllImages(storyboardId)
  const firstImg = storyboardUseFirstLastFrame.value ? getSbFirstImage(storyboardId) : getSbImage(storyboardId)
  const lastImg = storyboardUseFirstLastFrame.value ? getSbLastImage(storyboardId) : null
  const boundIds = new Set([firstImg?.id, lastImg?.id].filter((x) => x != null))
  return allImgs
    .filter((img) => !boundIds.has(img.id))
    .map((img) => ({
      key: `img-${img.id}`,
      src: assetImageUrl(img),
      type: 'img',
      img,
      label: quadPanelLabel(img.frame_type),
      frameBadge: img.frame_type === 'storyboard_first' ? '首' : img.frame_type === 'storyboard_last' ? '尾' : null,
      prompt: img.prompt || '',
    }))
}

function stripItemTitle(sbId, item) {
  const lines = [item.label, item.prompt].filter(Boolean)
  if (storyboardUseFirstLastFrame.value) {
    lines.unshift('点击：设为首帧或尾帧')
  } else {
    lines.unshift('点击设为主图')
  }
  return lines.join('\n\n')
}

async function onStripItemClick(sb, item) {
  if (!storyboardUseFirstLastFrame.value) {
    onSelectStripItem(sb, item)
    return
  }
  try {
    await ElMessageBox.confirm('将此图绑定到哪个槽位？', '设置参考帧', {
      confirmButtonText: '设为首帧',
      cancelButtonText: '设为尾帧',
      distinguishCancelAndClose: true,
      type: 'info',
    })
    onSelectSbFrameImage(sb, item.img, 'first')
    ElMessage.success('已设为首帧')
  } catch (action) {
    if (action === 'cancel') {
      onSelectSbFrameImage(sb, item.img, 'last')
      ElMessage.success('已设为尾帧')
    }
  }
}

/** 宫格子图位置标签 */
function quadPanelLabel(frameType) {
  const map = {
    quad_panel_0: '左上', quad_panel_1: '右上', quad_panel_2: '左下', quad_panel_3: '右下',
    nine_panel_0: '左上', nine_panel_1: '中上', nine_panel_2: '右上',
    nine_panel_3: '左中', nine_panel_4: '中间', nine_panel_5: '右中',
    nine_panel_6: '左下', nine_panel_7: '中下', nine_panel_8: '右下',
  }
  return map[frameType] || null
}

/** 点击缩略图条中的图片切换为主图 */
function onSelectStripItem(sb, item) {
  onSelectSbMainImage(sb, item.img)
}

/** 选定首帧或尾帧参考图（持久化到后端） */
function onSelectSbFrameImage(sb, img, slot) {
  if (!sb?.id || !img) return
  const isLast = slot === 'last'

  // 本地选中状态（用于部分回退逻辑）
  if (isLast) {
    sbSelectedLastImgId.value = { ...sbSelectedLastImgId.value, [sb.id]: img.id }
  } else {
    sbSelectedImgId.value = { ...sbSelectedImgId.value, [sb.id]: img.id }
  }

  // 关键：乐观更新 store 里分镜的权威绑定字段（storyboards 数组是 getSbFirst/LastImage 的主要数据源）
  // 这样点击后立即生效，无需刷新页面；getStripItems 也会立即把这张图从历史条里过滤掉
  const list = store.currentEpisode?.storyboards
  if (Array.isArray(list)) {
    const row = list.find((x) => Number(x.id) === Number(sb.id))
    if (row) {
      const now = new Date().toISOString()
      if (isLast) {
        row.last_frame_image_id = img.id
        row.last_frame_image_url = img.image_url || null
        row.last_frame_local_path = img.local_path || null
      } else {
        row.first_frame_image_id = img.id
        row.image_url = img.image_url || null
        row.local_path = img.local_path || null
      }
      row.updated_at = now
    }
  }

  // 发送到后端持久化（静默，调用方按需提示）
  const patch = { updated_at: new Date().toISOString() }
  if (isLast) {
    patch.last_frame_image_id = img.id
    patch.last_frame_image_url = img.image_url || null
    patch.last_frame_local_path = img.local_path || undefined
  } else {
    patch.image_url = img.image_url || null
    patch.local_path = img.local_path || undefined
    patch.first_frame_image_id = img.id
  }

  storyboardsAPI.update(sb.id, patch).catch((e) => console.warn('[参考帧] 保存失败', e))
}

/** 选定某张 API 图为主图（持久化到后端） */
function onSelectSbMainImage(sb, img) {
  onSelectSbFrameImage(sb, img, 'first')
}

/** 删除分镜单张图（当前或历史均可；删光后清空分镜绑定） */
async function onRemoveSbHistoryImage(storyboardId, imageGenId) {
  if (!storyboardId || !imageGenId) return
  const allBefore = getSbAllImages(storyboardId)
  const isOnly = allBefore.length <= 1
  const isCurrent = getSbImage(storyboardId)?.id === imageGenId
  const isIntro = Number(introStoryboardId.value) === Number(storyboardId)
  try {
    await ElMessageBox.confirm(
      isOnly
        ? isIntro
          ? '确定删除片头分镜图？删除后可重新生图或直接用参考图生视频。'
          : '确定删除这张分镜图？删除后可重新生成。'
        : isCurrent
          ? '确定删除当前分镜图？将自动切到其余历史图。'
          : '确定删除这张历史分镜图？此操作不可恢复。',
      '删除分镜图',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        distinguishCancelAndClose: true,
      }
    )
    await imagesAPI.delete(imageGenId)
    const sel = { ...sbSelectedImgId.value }
    if (sel[storyboardId] === imageGenId) delete sel[storyboardId]
    sbSelectedImgId.value = sel
    await loadSingleStoryboardMedia(storyboardId)
    const remain = getSbAllImages(storyboardId)
    if (remain.length === 0) {
      try {
        await storyboardsAPI.update(storyboardId, {
          image_url: null,
          local_path: null,
          first_frame_image_id: null,
        })
        const sb = (store.storyboards || []).find((s) => s.id === storyboardId)
        if (sb) {
          sb.image_url = null
          sb.local_path = null
          sb.first_frame_image_id = null
        }
        const intro = store.currentEpisode?.intro_storyboard
        if (intro && Number(intro.id) === Number(storyboardId)) {
          applyIntroToEpisodeStore({
            ...intro,
            image_url: null,
            local_path: null,
            first_frame_image_id: null,
          })
        }
      } catch (e) {
        console.warn('[删分镜图] 清空分镜绑定失败', e)
      }
    } else if (isCurrent) {
      const intro = store.currentEpisode?.intro_storyboard
      if (intro && Number(intro.id) === Number(storyboardId)) {
        onSelectIntroImage(remain[0])
      } else {
        onSelectSbMainImage(
          (store.storyboards || []).find((s) => s.id === storyboardId) || { id: storyboardId },
          remain[0]
        )
      }
    }
    ElMessage.success(remain.length === 0 ? '分镜图已删除' : '已删除')
  } catch (err) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(err?.message || '删除失败')
    }
  }
}

/** 首帧图生提示词（与 onGenerateSbFrameImage 首帧分支一致） */
function sbImagePromptPreview(sb) {
  if (!sb) return '暂无图片提示词'
  const text = (sb.polished_prompt || sb.image_prompt || sb.description || '').toString().trim()
  return text || '暂无图片提示词'
}

const {
  storyboardCopyBatchIndex,
  storyboardCopyBatchOptions,
  storyboardCopyBatchLabel,
  storyboardPromptCopyCount,
  assetPackDownloading,
  assetPackImageCount,
  charDescription,
  sceneDescription,
  propDescription,
  copyCharDescription,
  copySceneDescription,
  copyPropDescription,
  copyAllCharDescriptions,
  copyAllSceneDescriptions,
  copyAllPropDescriptions,
  copyCharImage,
  copySceneImage,
  copyPropImage,
  downloadAllAssetImages,
  copyStoryboardPrompt,
  copyStoryboardPromptsBatch,
} = useAssetClipboard({ storyboards, sbImagePromptPreview, characters, scenes, props })

function buildFirstFrameImagePrompt(sbId) {
  const sbRow = (store.storyboards || []).find((b) => b.id === sbId)
  return (sbRow?.polished_prompt || sbRow?.image_prompt || sbRow?.description || '').toString().trim()
}

function buildLastFrameImagePrompt(sbId) {
  const parts = []
  const loc = (sbLocation.value[sbId] || '').toString().trim()
  const time = (sbTime.value[sbId] || '').toString().trim()
  if (loc) parts.push(time ? loc + '，' + time : loc)
  const shotType = (sbShotType.value[sbId] || '').toString().trim()
  if (shotType) parts.push(shotType)
  const angleH = sbAngleH.value[sbId] || ''
  const angleV = sbAngleV.value[sbId] || ''
  const angleS = sbAngleS.value[sbId] || ''
  if (angleH && angleV && angleS) {
    const { label } = angleToPromptFragment(angleH, angleV, angleS)
    parts.push(label)
  }
  const result = (sbResult.value[sbId] || '').toString().trim()
  const action = (sbAction.value[sbId] || '').toString().trim()
  if (result) parts.push(result)
  else if (action) parts.push(action)
  const atmosphere = (sbAtmosphere.value[sbId] || '').toString().trim()
  if (atmosphere) parts.push(atmosphere)
  const style = getSelectedStylePromptZh() || getSelectedStylePrompt() || ''
  if (style) parts.push(style)
  parts.push('尾帧静止画面，展示动作完成后的最终状态与情绪余韵')
  return parts.join('，')
}

/** 从 frame_prompts 表读取已生成的专业帧提示词 */
async function getCachedFramePromptFromDb(sbId, slot) {
  const frameType = slot === 'last' ? 'last' : 'first'
  try {
    const res = await storyboardsAPI.getFramePrompts(sbId)
    const row = (res?.frame_prompts || []).find((r) => r.frame_type === frameType)
    return row?.prompt?.trim() || ''
  } catch (_) {
    return ''
  }
}

/**
 * 首尾帧模式：优先走 framePromptService（专用系统提示词 + 文本 AI），失败则回退字段拼接。
 */
async function ensureProfessionalFramePrompt(sb, slot, { forceRegenerate = false, userInstruction = '', draftPrompt = '' } = {}) {
  const frameType = slot === 'last' ? 'last' : 'first'
  if (!forceRegenerate) {
    const cached = await getCachedFramePromptFromDb(sb.id, slot)
    if (cached) return cached
  }
  try {
    const body = { frame_type: frameType }
    const instruction = String(userInstruction || '').trim()
    const draft = String(draftPrompt || '').trim()
    if (instruction) body.user_instruction = instruction
    if (forceRegenerate && draft) body.draft_prompt = draft
    const genRes = await storyboardsAPI.generateFramePrompt(sb.id, body)
    if (!genRes?.task_id) throw new Error('帧提示词任务未创建')
    const pollRes = await pollTask(genRes.task_id)
    if (pollRes?.status !== 'completed') {
      throw new Error(pollRes?.error || '帧提示词生成失败')
    }
    const fromTask = pollRes.result?.response?.single_frame?.prompt
    if (fromTask && String(fromTask).trim()) return String(fromTask).trim()
    const cached2 = await getCachedFramePromptFromDb(sb.id, slot)
    if (cached2) return cached2
  } catch (e) {
    console.warn('[首尾帧] 专业帧提示词生成失败，使用拼接回退', e?.message)
  }
  return slot === 'last' ? buildLastFrameImagePrompt(sb.id) : buildFirstFrameImagePrompt(sb.id)
}

/** 打开首尾帧提示词编辑器（显示最终发给AI生图的完整提示词，支持编辑保存） */
async function openFramePromptEditor(sb, slot) {
  if (!sb?.id) return
  editingFramePromptSb.value = sb
  editingFramePromptSlot.value = slot
  editingFramePromptInstruction.value = ''
  const fallback = slot === 'last' ? buildLastFrameImagePrompt(sb.id) : buildFirstFrameImagePrompt(sb.id)
  editingFramePromptText.value = fallback || ''
  showFramePromptEditor.value = true
  // 异步加载最终发给AI的真实提示词
  try {
    const pro = await ensureProfessionalFramePrompt(sb, slot)
    if (pro && String(pro).trim()) editingFramePromptText.value = pro
  } catch (e) {
    if (!editingFramePromptText.value) {
      editingFramePromptText.value = slot === 'last' ? buildLastFrameImagePrompt(sb.id) : buildFirstFrameImagePrompt(sb.id)
    }
  }
}

/** 保存编辑后的帧提示词到 frame_prompts 表 */
async function saveEditingFramePrompt() {
  const sb = editingFramePromptSb.value
  const slot = editingFramePromptSlot.value
  if (!sb?.id || !slot) return
  const text = (editingFramePromptText.value || '').trim()
  if (!text) {
    ElMessage.warning('提示词不能为空')
    return
  }
  editingFramePromptSaving.value = true
  try {
    const frameType = slot === 'last' ? 'last' : 'first'
    await storyboardsAPI.saveFramePrompt(sb.id, frameType, { prompt: text })
    ElMessage.success('提示词已保存，后续生成将使用此版本')
    showFramePromptEditor.value = false
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    editingFramePromptSaving.value = false
  }
}

/** 重新生成专业帧提示词 */
async function regenerateEditingFramePrompt() {
  const sb = editingFramePromptSb.value
  const slot = editingFramePromptSlot.value
  if (!sb?.id || !slot) return
  editingFramePromptRegenerating.value = true
  try {
    ElMessage.info('正在重新生成专业帧提示词…')
    const fresh = await ensureProfessionalFramePrompt(sb, slot, {
      forceRegenerate: true,
      userInstruction: (editingFramePromptInstruction.value || '').trim(),
      draftPrompt: (editingFramePromptText.value || '').trim(),
    })
    editingFramePromptText.value = fresh || ''
    ElMessage.success('已重新生成，可编辑后保存')
  } catch (e) {
    ElMessage.error(e.message || '生成失败')
  } finally {
    editingFramePromptRegenerating.value = false
  }
}

// 兼容旧调用
const showSbFramePromptPreview = openFramePromptEditor

async function onGenerateSbFrameImage(sb, slot) {
  if (!dramaId.value || !sb?.id) return
  const isLast = slot === 'last'
  const loadingSet = isLast ? generatingSbLastImageIds : generatingSbFirstImageIds
  const meta = buildSbGenMeta(
    sb,
    isLast ? GEN_RESOURCE.SB_LAST_IMAGE : GEN_RESOURCE.SB_FIRST_IMAGE,
    isLast ? '尾帧' : '首帧'
  )
  sb.errorMsg = ''
  sb.error_msg = ''
  loadingSet.add(sb.id)
  genStore.markRunning(meta)
  try {
    let idsToSave = sbCharacterIds.value[sb.id]
    if (idsToSave === undefined) {
      const sbRowForChars = (store.storyboards || []).find((b) => b.id === sb.id)
      const charList = Array.isArray(sbRowForChars?.characters) ? sbRowForChars.characters : []
      idsToSave = charList
        .map((c) => Number(typeof c === 'object' && c != null ? c.id : c))
        .filter((n) => Number.isFinite(n))
    }
    const sbRow = (store.storyboards || []).find((b) => b.id === sb.id)
    let prompt = ''
    if (storyboardUseFirstLastFrame.value) {
      // 须在 update(character_ids) 之前读取缓存：后端在角色未变时保留 frame_prompts，但先读可避免旧版误删
      prompt = await ensureProfessionalFramePrompt(sb, isLast ? 'last' : 'first')
    } else if (isLast) {
      prompt = buildLastFrameImagePrompt(sb.id) || sbRow?.image_prompt || sbRow?.description || ''
    } else {
      prompt = sbRow?.polished_prompt || sbRow?.image_prompt || sbRow?.description || ''
    }
    try {
      await storyboardsAPI.update(sb.id, { character_ids: Array.isArray(idsToSave) ? idsToSave : [] })
    } catch (e) {
      ElMessage.warning('保存分镜角色失败')
      return
    }
    // 尾帧可选附带首帧作构图/站位参考（「首帧站位」勾选时；后端亦会按 use_first_frame_layout_lock 兜底）
    let refImagesForCreate = undefined
    const useFirstLayoutLock = isLast && lastFrameUseFirstLayoutLock.value
    if (useFirstLayoutLock) {
      const firstImg = getSbFirstImage(sb.id)
      if (firstImg) {
        const firstUrl = assetImageUrl(firstImg) || firstImg.image_url || firstImg.local_path
        if (firstUrl) {
          refImagesForCreate = [firstUrl]
        }
      }
    }
    const res = await imagesAPI.create({
      storyboard_id: sb.id,
      drama_id: dramaId.value,
      prompt,
      model: getSelectedImageModel(),
      style: getSelectedStyle(),
      frame_type: frameTypeForSlot(slot),
      aspect_ratio: projectAspectRatio.value || '16:9',
      reference_images: refImagesForCreate,
      use_first_frame_layout_lock: isLast ? !!lastFrameUseFirstLayoutLock.value : undefined,
    })
    ElMessage.success(isLast ? '尾帧生成任务已提交' : '首帧生成任务已提交')
    if (res?.task_id) {
      const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta)
      if (pollRes?.status === 'failed') {
        sb.errorMsg = pollRes.error || '生成失败'
      } else {
        await loadDrama()
        restoreSelectionsFromBackend()

        // 关键修复：专用首/尾帧生成成功后，立即清除手动选择残留
        // 让 getSbLastImage / getSbFirstImage 严格走服务器已更新的 sb.last_frame_image_id（避免新图跑到历史列表）
        if (storyboardUseFirstLastFrame.value) {
          if (isLast) {
            delete sbSelectedLastImgId.value[sb.id]
          } else {
            delete sbSelectedImgId.value[sb.id]
          }
        }
      }
    } else {
      await loadSingleStoryboardMedia(sb.id)
      restoreSelectionsFromBackend()

      if (storyboardUseFirstLastFrame.value) {
        if (isLast) {
          delete sbSelectedLastImgId.value[sb.id]
        } else {
          delete sbSelectedImgId.value[sb.id]
        }
      }
    }
  } catch (e) {
    sb.errorMsg = e.message || '生成失败'
    ElMessage.error(e.message || '生成失败')
  } finally {
    loadingSet.delete(sb.id)
    genStore.markDone(meta)
  }
}

async function onGenerateSbFramePair(sb) {
  const hasFirst = !!(getSbFirstImage(sb.id) || (sb.image_url || sb.composed_image))
  if (!hasFirst) {
    await onGenerateSbFrameImage(sb, 'first')
    if (!getSbFirstImage(sb.id) && !(sb.image_url || sb.composed_image)) return
  }
  await onGenerateSbFrameImage(sb, 'last')
}

// ──────────────────────────────────────────────────────────────────────

async function onGenerateSbImage(sb) {
  if (!dramaId.value || !sb?.id) return
  sb.errorMsg = ''
  sb.error_msg = ''
  const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_IMAGE, '分镜图')
  generatingSbImageIds.add(sb.id)
  genStore.markRunning(meta)
  try {
    let idsToSave = sbCharacterIds.value[sb.id]
    if (idsToSave === undefined) {
      const charList = Array.isArray(sb.characters) ? sb.characters : []
      idsToSave = charList
        .map((c) => Number(typeof c === 'object' && c != null ? c.id : c))
        .filter((n) => Number.isFinite(n))
    }
    try {
      await storyboardsAPI.update(sb.id, { character_ids: Array.isArray(idsToSave) ? idsToSave : [] })
    } catch (e) {
      console.warn('[分镜图] 保存角色勾选失败', e)
      ElMessage.warning('保存分镜角色失败，请稍后重试')
      return
    }
    const res = await imagesAPI.create({
      storyboard_id: sb.id,
      drama_id: dramaId.value,
      prompt: sb.polished_prompt || sb.image_prompt || sb.description || '',
      model: getSelectedImageModel(),
      style: getSelectedStyle(),
      frame_type: gridMode.value !== 'single' ? gridMode.value : undefined,
      aspect_ratio: projectAspectRatio.value || '16:9',
    })
    ElMessage.success('分镜图生成任务已提交')
    if (res?.task_id) {
      const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta)
      if (pollRes?.status === 'failed') {
        sb.errorMsg = pollRes.error || '生成失败'
      } else {
        ElMessage.success('分镜图生成完成')
      }
    } else {
      await loadSingleStoryboardMedia(sb.id)
    }
  } catch (e) {
    console.error(e)
    sb.errorMsg = e.message || '生成失败'
    ElMessage.error(e.message || '生成失败')
  } finally {
    generatingSbImageIds.delete(sb.id)
    genStore.markDone(meta)
  }
}

function onUploadSbImageClick(sb, slot = 'first') {
  if (!sb?.id) return
  sbImageUploadForId.value = sb.id
  sbImageUploadSlotById.value = { ...sbImageUploadSlotById.value, [sb.id]: slot }
  if (!storyboardUseFirstLastFrame.value) {
    uploadingSbImageId.value = sb.id
  }
  if (sbImageFileInput.value) {
    sbImageFileInput.value.value = ''
    sbImageFileInput.value.click()
  }
}

async function doUploadSbImage(sbId, file, slot = 'first') {
  if (!file || !sbId || !dramaId.value) return
  const useSlot = storyboardUseFirstLastFrame.value ? slot : 'first'
  if (storyboardUseFirstLastFrame.value) {
    sbImageUploadSlotById.value = { ...sbImageUploadSlotById.value, [sbId]: useSlot }
  } else {
    uploadingSbImageId.value = sbId
  }
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
    const url = res?.url || res?.path
    const localPath = res?.local_path
    if (!url && !localPath) {
      ElMessage.error('上传未返回地址')
      return
    }
    const uploaded = await imagesAPI.upload({
      storyboard_id: sbId,
      drama_id: dramaId.value,
      image_url: url || '',
      local_path: localPath || undefined,
      frame_type: storyboardUseFirstLastFrame.value ? frameTypeForSlot(useSlot) : undefined,
    })
    ElMessage.success(useSlot === 'last' ? '尾帧上传成功' : '首帧上传成功')
    if (uploaded?.id) {
      const sb = (store.storyboards || []).find((b) => b.id === sbId)
      if (sb) onSelectSbFrameImage(sb, uploaded, useSlot)
    } else if (!storyboardUseFirstLastFrame.value) {
      const { [sbId]: _r, ...rest } = sbSelectedImgId.value
      sbSelectedImgId.value = rest
    }
    await loadSingleStoryboardMedia(sbId)
    restoreSelectionsFromBackend()
  } catch (e) {
    ElMessage.error(e.message || '上传失败')
  } finally {
    uploadingSbImageId.value = null
    const next = { ...sbImageUploadSlotById.value }
    delete next[sbId]
    sbImageUploadSlotById.value = next
  }
}

function onSbImageFileChange(ev) {
  const file = ev.target?.files?.[0]
  const sid = sbImageUploadForId.value
  if (!file || !sid) {
    ev.target.value = ''
    return
  }
  const slot = sbImageUploadSlotById.value[sid] || 'first'
  doUploadSbImage(sid, file, slot).finally(() => {
    sbImageUploadForId.value = null
    ev.target.value = ''
  })
}

function patchStoryboardStateForSb(sb) {
  if (!sb?.id) return
  const id = sb.id
  const charList = Array.isArray(sb.characters) ? sb.characters : (sb.characters != null ? [sb.characters] : [])
  sbSceneId.value[id] = sb.scene_id ?? null
  sbDialogue.value[id] = sb.dialogue ?? ''
  sbNarration.value[id] = sb.narration ?? ''
  sbShotType.value[id] = (sb.shot_type ?? '').toString() || ''
  sbTitle.value[id] = (sb.title ?? '').toString()
  sbLocation.value[id] = (sb.location ?? '').toString()
  sbTime.value[id] = (sb.time ?? '').toString()
  sbDuration.value[id] = sb.duration != null ? Number(sb.duration) : 5
  sbAction.value[id] = (sb.action ?? '').toString()
  sbResult.value[id] = (sb.result ?? '').toString()
  sbAtmosphere.value[id] = (sb.atmosphere ?? '').toString()
  sbAngle.value[id] = (sb.angle ?? '').toString()
  sbAngleH.value[id] = sb.angle_h || ''
  sbAngleV.value[id] = sb.angle_v || ''
  sbAngleS.value[id] = sb.angle_s || ''
  sbMovement.value[id] = (sb.movement ?? '').toString()
  sbLighting.value[id] = sb.lighting_style || ''
  sbDof.value[id] = sb.depth_of_field || ''
  sbLayoutDescription.value[id] = (sb.layout_description ?? '').toString()
  sbCharacterIds.value[id] = charList
    .map((c) => (typeof c === 'object' && c != null ? Number(c.id) : Number(c)))
    .filter((n) => Number.isFinite(n))
  sbPropIds.value[id] = Array.isArray(sb.prop_ids)
    ? sb.prop_ids
    : (Array.isArray(sbPropIds.value[id]) && sbPropIds.value[id].length ? sbPropIds.value[id] : [])
  sbCreationMode.value[id] = sb.creation_mode === 'universal' ? 'universal' : 'classic'
  sbUniversalSegmentText.value[id] = (sb.universal_segment_text ?? '').toString()
}

/** 生成中轻量刷新：只补新分镜字段，不整表替换 ref（避免每 2s 全页重渲染） */
function mergeNewStoryboardsIntoState(boards) {
  const list = Array.isArray(boards) ? boards : []
  let added = 0
  for (const sb of list) {
    if (sbCharacterIds.value[sb.id] !== undefined) continue
    patchStoryboardStateForSb(sb)
    added++
  }
  if (added > 0 && (storyboardGenerating.value || universalOmniPolishRunning.value)) {
    storyboardPage.value = Math.max(1, Math.ceil(list.length / STORYBOARD_PAGE_SIZE))
    loadStoryboardMediaForBoards(pagedStoryboards.value)
  }
}

function syncStoryboardStateFromEpisode(ep) {
  const boards = ep?.storyboards || []
  const nextCharIds = {}
  const nextPropIds = {}
  const nextScene = {}
  const nextDialogue = {}
  const nextNarration = {}
  const nextShot = {}
  const nextTitle = {}
  const nextLocation = {}
  const nextTime = {}
  const nextDuration = {}
  const nextAction = {}
  const nextResult = {}
  const nextAtmosphere = {}
  const nextAngle = {}
  const nextAngleH = {}
  const nextAngleV = {}
  const nextAngleS = {}
  const nextMovement = {}
  const nextLighting = {}
  const nextDof = {}
  const nextLayoutDescription = {}
  const nextCreationMode = {}
  const nextUniversalSegment = {}
  const nextNarrationAudio = {}
  const nextNarrationRevision = {}
  for (const sb of boards) {
    nextScene[sb.id] = sb.scene_id ?? null
    nextDialogue[sb.id] = sb.dialogue ?? ''
    nextNarration[sb.id] = collapseNarrationBlankLines(sb.narration ?? '')
    nextShot[sb.id] = (sb.shot_type ?? '').toString() || ''
    nextTitle[sb.id] = (sb.title ?? '').toString()
    nextLocation[sb.id] = (sb.location ?? '').toString()
    nextTime[sb.id] = (sb.time ?? '').toString()
    let dur = sb.duration != null ? Number(sb.duration) : 5
    // 全文解说：无配音时用字数估算展示；已有配音则保留库内 duration（配音实测）
    if (storyboardFullNarrationVideoMode.value) {
      const narr = (sb.narration || '').toString().trim()
      const shotNum = Number(sb.storyboard_number ?? sb.shot_number) || 0
      const hasAudio = !!(sb.narration_audio_local_path && String(sb.narration_audio_local_path).trim())
      if (shotNum === 1 && !narr) {
        dur = 6
      } else if (narr && !hasAudio) {
        dur = getNarrationStats(narr, narrationCharsPerSec.value).estSec
      }
    }
    nextDuration[sb.id] = dur
    if (
      storyboardFullNarrationVideoMode.value &&
      sb.duration != null &&
      Number(sb.duration) !== dur &&
      !(sb.narration_audio_local_path && String(sb.narration_audio_local_path).trim())
    ) {
      sb.duration = dur
    }
    nextAction[sb.id] = (sb.action ?? '').toString()
    nextResult[sb.id] = (sb.result ?? '').toString()
    nextAtmosphere[sb.id] = (sb.atmosphere ?? '').toString()
    nextAngle[sb.id] = (sb.angle ?? '').toString()
    nextAngleH[sb.id] = sb.angle_h || ''
    nextAngleV[sb.id] = sb.angle_v || ''
    nextAngleS[sb.id] = sb.angle_s || ''
    nextMovement[sb.id] = (sb.movement ?? '').toString()
    nextLighting[sb.id] = sb.lighting_style || ''
    nextDof[sb.id] = sb.depth_of_field || ''
    nextLayoutDescription[sb.id] = (sb.layout_description ?? '').toString()
    const charList = Array.isArray(sb.characters) ? sb.characters : (sb.characters != null ? [sb.characters] : [])
    nextCharIds[sb.id] = charList.map((c) => (typeof c === 'object' && c != null ? Number(c.id) : Number(c))).filter((n) => Number.isFinite(n))
    // 轻量刷新接口若未带 prop_ids，保留当前勾选，避免「生成提示词」后 UI 误清空
    if (Array.isArray(sb.prop_ids)) {
      nextPropIds[sb.id] = sb.prop_ids
    } else if (Array.isArray(sbPropIds.value[sb.id]) && sbPropIds.value[sb.id].length) {
      nextPropIds[sb.id] = sbPropIds.value[sb.id]
    } else {
      nextPropIds[sb.id] = []
    }
    nextCreationMode[sb.id] = sb.creation_mode === 'universal' ? 'universal' : 'classic'
    nextUniversalSegment[sb.id] = (sb.universal_segment_text ?? '').toString()
    if (sb.narration_audio_local_path) {
      nextNarrationAudio[sb.id] = sb.narration_audio_local_path
      nextNarrationRevision[sb.id] = 1
    }
  }
  sbCharacterIds.value = nextCharIds
  sbPropIds.value = nextPropIds
  sbSceneId.value = nextScene
  sbDialogue.value = nextDialogue
  sbNarration.value = nextNarration
  sbShotType.value = nextShot
  sbTitle.value = nextTitle
  sbLocation.value = nextLocation
  sbTime.value = nextTime
  sbDuration.value = nextDuration
  sbAction.value = nextAction
  sbResult.value = nextResult
  sbAtmosphere.value = nextAtmosphere
  sbAngle.value = nextAngle
  sbAngleH.value = nextAngleH
  sbAngleV.value = nextAngleV
  sbAngleS.value = nextAngleS
  sbMovement.value = nextMovement
  sbLighting.value = nextLighting
  sbDof.value = nextDof
  sbLayoutDescription.value = nextLayoutDescription
  sbCreationMode.value = nextCreationMode
  sbUniversalSegmentText.value = nextUniversalSegment
  sbNarrationAudioPaths.value = nextNarrationAudio
  sbNarrationAudioRevision.value = nextNarrationRevision
}

function onEpisodeSelect(epId) {
  if (epId == null) {
    store.setCurrentEpisode(null)
    store.setScriptContent('')
    scriptTitle.value = ''
    syncStoryboardStateFromEpisode(null)
    storyboardPage.value = 1
    resetStoryboardMediaCache()
    episodeStoryboardMediaKey = ''
    return
  }
  const list = store.drama?.episodes || []
  const ep = list.find((e) => Number(e.id) === Number(epId))
  if (!ep) return
  store.setCurrentEpisode(ep)
  store.setScriptContent(ep.script_content || '')
  scriptTitle.value = ep.title || '第' + (ep.episode_number || 0) + '集'
  storyboardPage.value = 1
  resetStoryboardMediaCache()
  episodeStoryboardMediaKey = ''
  syncStoryboardStateFromEpisode(ep)
  loadStoryboardMedia()
  recoverAndSyncEpisodeTasks(epId)
}

async function onClearEpisodeExceptScript() {
  if (!currentEpisodeId.value || pipelineRunning.value || clearingEpisode.value) return
  try {
    await ElMessageBox.confirm(
      '将删除当前集已生成的角色、场景、道具、分镜、图片、视频等，剧本正文会保留。此操作不可恢复，确定继续？',
      '一键清空',
      {
        confirmButtonText: '清空',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
  } catch {
    return
  }
  clearingEpisode.value = true
  try {
    await dramaAPI.clearEpisodeGenerated(currentEpisodeId.value)
    genStore.clearAllRunningTasks('已清空本集生成内容')
    pipelineErrorLog.value = []
    pipelineCurrentStep.value = ''
    resetStoryboardMediaCache()
    episodeStoryboardMediaKey = ''
    await loadDrama()
    ElMessage.success('已清空本集生成内容，剧本正文已保留')
  } catch (e) {
    ElMessage.error(e?.message || '清空失败')
  } finally {
    clearingEpisode.value = false
  }
}

const CLEAR_MEDIA_CONFIRM = {
  prompts: {
    title: '清除提示词',
    message: '将一键清除当前集全部分镜的生图提示词、视频提示词与全能片段提示词（含按配音对齐标记），保留分镜文案、配音、图片与视频。确定继续？',
    success: '已清除全部提示词',
  },
  narration_audio: {
    title: '清除配音',
    message: '将清除当前集全部分镜的旁白/对白配音引用（不删除分镜文案、图片、视频）。确定继续？',
    success: '已清除配音',
  },
  images: {
    title: '清除分镜图',
    message: '将清除当前集全部分镜图（含首尾帧与历史图），保留分镜文案、配音与视频。确定继续？',
    success: '已清除分镜图',
  },
  videos: {
    title: '清除视频',
    message: '将清除当前集全部分镜视频与整集成片，保留分镜文案、配音与图片。确定继续？',
    success: '已清除视频',
  },
}

async function onClearEpisodeMedia(kind) {
  if (!currentEpisodeId.value || pipelineRunning.value || clearingMediaKind.value) return
  const conf = CLEAR_MEDIA_CONFIRM[kind]
  if (!conf) return
  try {
    await ElMessageBox.confirm(conf.message, conf.title, {
      confirmButtonText: '清除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  clearingMediaKind.value = kind
  try {
    await dramaAPI.clearEpisodeMedia(currentEpisodeId.value, kind)
    resetStoryboardMediaCache()
    episodeStoryboardMediaKey = ''
    if (kind === 'videos' && store.currentEpisode) {
      store.currentEpisode.video_url = null
    }
    await refreshStoryboardsForEpisode(currentEpisodeId.value)
    if (kind === 'narration_audio') {
      sbDialogueAudioPaths.value = {}
    } else if (kind === 'prompts') {
      sbPromptPolishedText.value = ''
      sbPromptVideoText.value = ''
    } else if (kind === 'images' || kind === 'videos') {
      await loadStoryboardMedia({ all: true, force: true })
    }
    ElMessage.success(conf.success)
  } catch (e) {
    ElMessage.error(e?.message || '清除失败')
  } finally {
    clearingMediaKind.value = ''
  }
}

async function loadDrama() {
  if (!store.dramaId) return
  try {
    let d = await dramaAPI.get(store.dramaId)
    d = await backfillDramaStylePromptMetadataIfNeeded(dramaAPI, store.dramaId, d)
    store.setDrama(d)
    // 恢复「故事生成」框的梗概（项目 description 存的是故事梗概）
    storyInput.value = (d.description || '').toString().trim()
    storyStyle.value = (d.metadata && d.metadata.story_style) ? d.metadata.story_style : ''
    storyType.value = d.genre || ''
    generationStyle.value = d.style || ''
    if ((d.style || '') === CUSTOM_STYLE_VALUE) {
      customStylePrompt.value = (d.metadata?.style_prompt_zh || d.metadata?.style_prompt_en || '').toString()
    } else {
      customStylePrompt.value = ''
    }
    projectAspectRatio.value = (d.metadata && d.metadata.aspect_ratio) ? d.metadata.aspect_ratio : '16:9'
    videoClipDuration.value = (d.metadata && d.metadata.video_clip_duration) ? Number(d.metadata.video_clip_duration) : 5
    defaultVideoModel.value = normalizeAgnesVideoModelChoice(d.metadata?.video_model)
    defaultImageModel.value = normalizeAgnesImageModelChoice(d.metadata?.image_model)
    defaultTextModel.value = normalizeAgnesTextModelChoice(d.metadata?.text_model)
    const meta = (d.metadata && typeof d.metadata === 'object') ? d.metadata : {}
    const metaBool = (key, defaultVal) => {
      if (meta[key] === undefined || meta[key] === null) return defaultVal
      return !!meta[key]
    }
    // 一次性迁移：默认勾选全文解说，并带上其配套三项（首尾帧 / 字幕 / IndexTTS）
    const needPipelineDefaultsV2 = meta.pipeline_defaults_v2 !== true
    let appliedPipelineDefaultsV2 = false
    if (needPipelineDefaultsV2) {
      storyboardFullNarrationVideoMode.value = true
      applyFullNarrationCompanionDefaults()
      storyboardUniversalOmni.value = metaBool('storyboard_universal_omni', false)
      videoSoftContiguity.value = metaBool('storyboard_video_soft_contiguity', false)
      lastFrameUseFirstLayoutLock.value = meta.last_frame_use_first_layout_lock !== false
      saveProjectSettings(false)
      appliedPipelineDefaultsV2 = true
    } else {
      storyboardIncludeNarration.value = metaBool('storyboard_include_narration', true)
      storyboardFullNarrationVideoMode.value = metaBool('storyboard_full_narration_video_mode', true)
      const metaCps = Number(meta.narration_chars_per_sec)
      narrationCharsPerSec.value = Number.isFinite(metaCps) && metaCps > 0 ? metaCps : NARRATION_CHARS_PER_SEC_DEFAULT
      storyboardUniversalOmni.value = metaBool('storyboard_universal_omni', false)
      videoSoftContiguity.value = metaBool('storyboard_video_soft_contiguity', false)
      lastFrameUseFirstLayoutLock.value = meta.last_frame_use_first_layout_lock !== false
      if (storyboardFullNarrationVideoMode.value) {
        // 已开全文解说：旁白/首尾帧默认开；连贯帧不默认开（首尾帧用本镜+下一镜图，可并发生视频）
        storyboardIncludeNarration.value = true
        videoFrameContiguity.value = false
        storyboardUseFirstLastFrame.value = metaBool('storyboard_use_first_last_frame', true)
        if (storyboardUseFirstLastFrame.value && gridMode.value !== 'single') {
          gridMode.value = 'single'
        }
      } else {
        storyboardUseFirstLastFrame.value = metaBool('storyboard_use_first_last_frame', false)
      }
    }
    const list = d.episodes || []
    // 优先保持当前选中的集（按 id 在最新列表中查找），避免 AI 生成角色等操作后误切到其他集
    const currentId = selectedEpisodeId.value
    let ep = currentId != null ? list.find((e) => Number(e.id) === Number(currentId)) : null
    if (!ep) {
      const wantNum = savedCurrentEpisodeNumber.value
      ep = list.find((e) => Number(e.episode_number) === Number(wantNum)) || list[0] || null
    }
    store.setCurrentEpisode(ep)
    if (ep) {
      store.setScriptContent(ep.script_content || '')
      scriptTitle.value = ep.title || '第' + (ep.episode_number || 0) + '集'
      selectedEpisodeId.value = ep.id
    } else {
      store.setScriptContent('')
      scriptTitle.value = ''
      selectedEpisodeId.value = null
    }
    syncStoryboardStateFromEpisode(ep)
    const mediaKey = storyboardMediaKeyForEpisode(ep)
    if (mediaKey !== episodeStoryboardMediaKey) {
      resetStoryboardMediaCache()
      episodeStoryboardMediaKey = mediaKey
      await loadStoryboardMedia({ all: true, force: true })
    } else {
      await loadStoryboardMedia()
    }
    await recoverAndSyncEpisodeTasks(ep?.id)
    if (appliedPipelineDefaultsV2) {
      videoSubtitle.value = true
      videoIndexTtsNarration.value = true
      persistVideoMergePrefs()
      persistIndexTtsPrefs()
    }
  } catch (e) {
    ElMessage.error(e.message || '加载失败')
  }
}

const EMPTY_ARR = []
/** 当前分镜已选角色 id 列表（供 el-select 绑定） */
function getSbCharacterIds(sbId) {
  const arr = sbCharacterIds.value[sbId]
  return Array.isArray(arr) && arr.length > 0 ? arr : EMPTY_ARR
}

/** 运镜值的简短中文标签（用于分镜控制栏显示） */
function getMovementLabel(m) {
  if (!m) return ''
  const map = {
    static: '固定',
    push: '推镜',
    pull: '拉镜',
    pan: '横摇',
    tilt: '纵摇',
    tracking: '跟镜',
    crane_up: '升镜',
    crane_dn: '降镜',
    orbit: '环绕',
    handheld: '手持',
    zoom: '变焦',
    roll: '旋转',
    whip_pan: '甩镜',
    spiral: '螺旋',
    hitchcock_zoom: '希区柯克',
    bullet_time: '子弹时间',
    dutch_angle_move: '荷兰角',
    dolly_track: '推轨',
    slowmo_orbit: '升格环绕'
  }
  return map[m] || m
}

function setSbCharacterIds(sbId, v) {
  const next = Array.isArray(v) ? v : []
  sbCharacterIds.value = { ...sbCharacterIds.value, [sbId]: next }
  onStoryboardCharacterChange(sbId)
}

/** 当前分镜尚未勾选的角色（供缩略图旁「+」下拉添加） */
function charactersAvailableToAddToSb(sbId) {
  const all = characters.value ?? []
  const cur = new Set((getSbCharacterIds(sbId) || []).map((x) => Number(x)))
  return all.filter((c) => c && !cur.has(Number(c.id)))
}

function onSbAddCharacterCommand(sbId, charId) {
  const id = Number(charId)
  if (!Number.isFinite(id)) return
  const cur = [...(getSbCharacterIds(sbId) || [])]
  if (cur.some((x) => Number(x) === id)) return
  cur.push(id)
  setSbCharacterIds(sbId, cur)
}

/** 当前分镜已选物品 id 列表 */
function getSbPropIds(sbId) {
  const arr = sbPropIds.value[sbId]
  return Array.isArray(arr) && arr.length > 0 ? arr : EMPTY_ARR
}

function setSbPropIds(sbId, v) {
  sbPropIds.value = { ...sbPropIds.value, [sbId]: Array.isArray(v) ? v : [] }
  onStoryboardPropChange(sbId)
}

function onStoryboardPropChange(sbId) {
  const ids = sbPropIds.value[sbId] || []
  storyboardsAPI.update(sbId, { prop_ids: ids }).catch(() => {})
}

/** 当前分镜选中的场景对象（用于下方缩略图） */
function getSbSelectedScene(sbId) {
  const sceneId = sbSceneId.value[sbId]
  if (sceneId == null) return null
  const list = scenes.value ?? []
  return list.find((s) => Number(s.id) === Number(sceneId)) || null
}

/** 当前分镜选中的角色对象列表（用于下方缩略图） */
function getSbSelectedCharacters(sbId) {
  const ids = getSbCharacterIds(sbId)
  if (!ids.length) return []
  const list = characters.value ?? []
  return ids.map((id) => list.find((c) => Number(c.id) === Number(id))).filter(Boolean)
}

/** 当前分镜选中的物品对象列表（用于下方缩略图） */
function getSbSelectedProps(sbId) {
  const ids = getSbPropIds(sbId)
  if (!ids.length) return []
  const list = props.value ?? []
  return ids.map((id) => list.find((p) => Number(p.id) === Number(id))).filter(Boolean)
}

async function onStoryboardCharacterChange(sbId) {
  const ids = sbCharacterIds.value[sbId] || []
  try {
    await storyboardsAPI.update(sbId, { character_ids: ids })
    // 首/尾帧提示词保留（含用户手动保存版）；图生时后端会按当前勾选做 sanitize
  } catch (e) {
    console.warn('[分镜] 保存角色失败', e)
  }
}

function onLastFrameLayoutLockChange() {
  saveProjectSettings()
}

function onStoryboardSceneChange(sbId) {
  const sceneId = sbSceneId.value[sbId] ?? null
  storyboardsAPI.update(sbId, { scene_id: sceneId }).catch(() => {})
}

/** 同镜号多行时只保留 id 最大的一条（与后端 dedupe 一致，避免「影响的分镜」重复 #N） */
function dedupeStoryboardsForAssetLink(list) {
  const byNum = new Map()
  const extras = []
  for (const sb of list || []) {
    const n = Number(sb?.storyboard_number)
    if (Number.isFinite(n) && n > 0) {
      const prev = byNum.get(n)
      if (!prev || Number(sb.id) > Number(prev.id)) byNum.set(n, sb)
    } else {
      extras.push(sb)
    }
  }
  return [...byNum.values(), ...extras].sort(
    (a, b) => (Number(a.storyboard_number) || 0) - (Number(b.storyboard_number) || 0)
  )
}

/** 返回包含指定角色的所有分镜（已排序） */
function getCharAffectedStoryboards(charId) {
  const matched = (storyboards.value || []).filter((sb) => {
    if (!sb.characters) return false
    const chars = Array.isArray(sb.characters) ? sb.characters : []
    return chars.some((c) => Number(typeof c === 'object' && c != null ? c.id : c) === Number(charId))
  })
  return dedupeStoryboardsForAssetLink(matched)
}

/** 返回指定场景关联的所有分镜 */
function getSceneAffectedStoryboards(sceneId) {
  const matched = (storyboards.value || []).filter(
    (sb) => sb.scene_id != null && Number(sb.scene_id) === Number(sceneId)
  )
  return dedupeStoryboardsForAssetLink(matched)
}

/** 返回包含指定道具的所有分镜（已排序） */
function getPropAffectedStoryboards(propId) {
  const matched = (storyboards.value || []).filter((sb) => {
    if (!sb.prop_ids) return false
    const pids = Array.isArray(sb.prop_ids) ? sb.prop_ids : []
    return pids.some((pid) => Number(pid) === Number(propId))
  })
  return dedupeStoryboardsForAssetLink(matched)
}

/** 点击分镜 chip → 切到对应页并滚动到分镜行 */
async function scrollToStoryboard(sbId) {
  await scrollToStoryboardCard(sbId)
}

/** 对关联分镜批量重新生成图片 */
async function onRegenAffectedSbImages(assetKey, affectedBoards) {
  if (!affectedBoards.length || regenSbImagesForAsset.has(assetKey)) return
  try {
    await ElMessageBox.confirm(
      `将为 ${affectedBoards.length} 个关联分镜重新生成图片（#${affectedBoards.map((s) => s.storyboard_number).join('、#')}），原有图片将被覆盖，是否继续？`,
      '重新生成关联分镜图',
      { confirmButtonText: '确认生成', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  regenSbImagesForAsset.add(assetKey)
  // 用 Map 存进度以便响应式更新
  if (!regenSbImagesProgress.value) regenSbImagesProgress.value = {}
  regenSbImagesProgress.value[assetKey] = { current: 0, total: affectedBoards.length }
  let failed = 0
  try {
    for (let i = 0; i < affectedBoards.length; i++) {
      regenSbImagesProgress.value[assetKey] = { current: i + 1, total: affectedBoards.length }
      const sb = affectedBoards[i]
      try {
        const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
        let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
        let frameTypeForCreate = undefined
        if (useFirstLast) {
          // 首尾帧模式下，关联资源触发的批量重新生成也必须走专业首帧提示词
          prompt = await ensureProfessionalFramePrompt(sb, 'first')
          frameTypeForCreate = 'storyboard_first'
        }
        const res = await imagesAPI.create({
          storyboard_id: sb.id,
          drama_id: dramaId.value,
          prompt,
          style: getSelectedStyle(),
          frame_type: frameTypeForCreate,
          aspect_ratio: projectAspectRatio.value || '16:9',
        })
        if (res?.task_id) {
          const pollRes = await new Promise((resolve) => {
            const maxAttempts = 180
            let attempts = 0
            const tick = async () => {
              attempts++
              try {
                const t = await taskAPI.get(res.task_id)
                if (t.status === 'completed') { await loadSingleStoryboardMedia(sb.id); return resolve({ status: 'completed' }) }
                if (t.status === 'failed') return resolve({ status: 'failed', error: t.error || '任务失败' })
              } catch (_) {}
              if (attempts < maxAttempts) setTimeout(tick, 2000)
              else resolve({ status: 'timeout' })
            }
            setTimeout(tick, 2000)
          })
          if (pollRes?.status !== 'completed') failed++
        } else {
          await loadSingleStoryboardMedia(sb.id)
        }
        if (useFirstLast) {
          delete sbSelectedImgId.value[sb.id]
        }
      } catch (_) {
        failed++
      }
      if (i < affectedBoards.length - 1) await new Promise((r) => setTimeout(r, 500))
    }
    if (failed === 0) ElMessage.success(`已重新生成 ${affectedBoards.length} 张关联分镜图`)
    else ElMessage.warning(`完成，${failed}/${affectedBoards.length} 条失败`)
  } finally {
    regenSbImagesForAsset.delete(assetKey)
    if (regenSbImagesProgress.value) delete regenSbImagesProgress.value[assetKey]
  }
}

function updateStoryboardDialogue(sbId) {
  // 可在此防抖后调用后端更新 dialogue
}

/** 将当前剧本内容保存到后端（创建/更新项目与集数），供「保存剧本」与「AI 生成」后自动保存共用 */
async function saveScriptToBackend(content) {
  const normalized = normalizeScriptContentForSave(content)
  if (!normalized) return
  if (normalized !== String(content ?? '').trim()) {
    store.setScriptContent(normalized)
  }
  const parsed = parseScriptIntoEpisodes(normalized)
  const multiFromMarkers = parsed.split && parsed.episodes.length >= 2
  const toPayload = (list) =>
    list.map((e, i) => ({
      episode_number: i + 1,
      title: (e.title && String(e.title).trim()) || '第' + (i + 1) + '集',
      script_content: normalizeScriptContentForSave(e.script_content ?? ''),
      description: null,
      duration: 0,
    }))

  let dramaId = store.dramaId
  const curEp = store.currentEpisode
  if (!dramaId) {
    const drama = await dramaAPI.create({
      title: scriptTitle.value || '新故事',
      description: storyInput.value?.trim() || normalized.slice(0, 200),
      genre: storyType.value || undefined,
      style: generationStyle.value || undefined,
      metadata: {
        ...projectStylePromptMetadata(),
        story_style: storyStyle.value || undefined,
        aspect_ratio: projectAspectRatio.value || '16:9',
      },
    })
    store.setDrama(drama)
    dramaId = drama.id
    savedCurrentEpisodeNumber.value = 1
    const first = parsed.episodes[0] || { title: '', script_content: normalized }
    const episodes = multiFromMarkers
      ? toPayload(parsed.episodes)
      : [
          {
            episode_number: 1,
            title: scriptTitle.value || first.title || '第1集',
            script_content: first.script_content || normalized,
          },
        ]
    await dramaAPI.saveEpisodes(dramaId, episodes)
    await loadDrama()
    if (route.params.id === 'new') {
      router.replace('/film/' + dramaId)
    }
    if (multiFromMarkers) {
      ElMessage.success(`已按「第N集/章/节」拆分为 ${episodes.length} 集`)
    }
    return { created: true }
  }
  if (multiFromMarkers) {
    savedCurrentEpisodeNumber.value = 1
    const payload = toPayload(parsed.episodes)
    await dramaAPI.saveEpisodes(dramaId, payload)
    if (storyInput.value?.trim()) {
      await dramaAPI.saveOutline(dramaId, {
        summary: storyInput.value.trim(),
        genre: storyType.value || undefined,
        style: generationStyle.value || undefined,
        metadata: {
          ...projectStylePromptMetadata(),
          story_style: storyStyle.value || undefined,
          aspect_ratio: projectAspectRatio.value || '16:9',
        },
      }).catch(() => {})
    }
    await loadDrama()
    ElMessage.success(`已按「第N集/章/节」拆分为 ${payload.length} 集`)
    return { created: false, splitEpisodes: true }
  }
  const episodes = store.drama?.episodes || []
  savedCurrentEpisodeNumber.value = curEp?.episode_number ?? 1
  const updated = episodes.map((ep, i) => {
    const num = ep.episode_number ?? i + 1
    const isCurrent = curEp && Number(ep.id) === Number(curEp.id)
    const first = parsed.episodes[0]
    const singleBody = first?.script_content ?? normalized
    const singleTitle = first?.title && String(first.title).trim()
    return {
      episode_number: num,
      title: isCurrent
        ? scriptTitle.value || singleTitle || '第' + num + '集'
        : ep.title || '',
      script_content: isCurrent
        ? normalizeScriptContentForSave(parsed.episodes.length === 1 && singleTitle ? singleBody : normalized)
        : normalizeScriptContentForSave(ep.script_content || ''),
      description: ep.description,
      duration: ep.duration,
    }
  })
  if (updated.length === 0) {
    updated.push({ episode_number: 1, title: scriptTitle.value || '第1集', script_content: normalized })
  }
  await dramaAPI.saveEpisodes(dramaId, updated)
  if (storyInput.value?.trim()) {
    await dramaAPI.saveOutline(dramaId, {
      summary: storyInput.value.trim(),
      genre: storyType.value || undefined,
      style: generationStyle.value || undefined,
      metadata: {
        ...projectStylePromptMetadata(),
        story_style: storyStyle.value || undefined,
        aspect_ratio: projectAspectRatio.value || '16:9',
      },
    }).catch(() => {})
  }
  await loadDrama()
  return { created: false }
}

function onStoryboardIncludeNarrationChange() {
  if (!storyboardIncludeNarration.value) {
    storyboardFullNarrationVideoMode.value = false
  }
  saveProjectSettings(false)
}

/** 开启「全文解说旁白视频模式」时，这三个默认一并打开 */
function applyFullNarrationCompanionDefaults() {
  storyboardIncludeNarration.value = true
  storyboardUseFirstLastFrame.value = true
  // 首尾帧=本镜图+下一镜图，无视频依赖，可 7 路并发；勿再强制开「连贯帧」（那会串行截上一条视频末帧）
  videoFrameContiguity.value = false
  videoSubtitle.value = true
  videoIndexTtsNarration.value = true
  if (gridMode.value !== 'single') gridMode.value = 'single'
}

function onStoryboardFullNarrationModeChange() {
  if (storyboardFullNarrationVideoMode.value) {
    applyFullNarrationCompanionDefaults()
  }
  saveProjectSettings(false)
  persistVideoMergePrefs()
  persistIndexTtsPrefs()
}

function onNarrationCharsPerSecChange() {
  saveProjectSettings(false)
  if (storyboardFullNarrationVideoMode.value) {
    syncAllStoryboardDurationsFromNarration().then((n) => {
      if (n > 0) ElMessage.success(`已按新语速对齐 ${n} 镜分镜时长（未重切旁白；超长段请点「重新同步旁白分段」）`)
    }).catch(() => {})
  }
}

async function onResyncFullNarration() {
  if (!currentEpisodeId.value) {
    ElMessage.warning('请先选择剧集')
    return
  }
  if (!storyboardFullNarrationVideoMode.value) {
    ElMessage.warning('请先开启全文解说旁白视频模式')
    return
  }
  try {
    await ElMessageBox.confirm(
      '将按当前集剧本正文重新切分解说旁白并写回各镜 duration；不会自动生成图/视频提示词。是否继续？',
      '重新同步旁白分段',
      { type: 'warning', confirmButtonText: '同步', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  resyncingFullNarration.value = true
  try {
    await saveProjectSettings(false)
    const data = await storyboardsAPI.resyncFullNarration(currentEpisodeId.value)
    await refreshStoryboardsForEpisode(currentEpisodeId.value)
    const msg = data?.message || `已同步 ${data?.segment_count ?? ''} 镜解说旁白`
    ElMessage.success(msg)
  } catch (e) {
    ElMessage.error(e?.message || '同步旁白失败')
  } finally {
    resyncingFullNarration.value = false
  }
}

async function saveProjectSettings(includeGenerationStyle = false) {
  if (!store.dramaId) return
  const metadata = {
    story_style: storyStyle.value || undefined,
    aspect_ratio: projectAspectRatio.value || '16:9',
    video_clip_duration: videoClipDuration.value || 5,
    video_model: normalizeAgnesVideoModelChoice(defaultVideoModel.value),
    image_model: normalizeAgnesImageModelChoice(defaultImageModel.value),
    text_model: normalizeAgnesTextModelChoice(defaultTextModel.value),
    storyboard_include_narration: !!storyboardIncludeNarration.value,
    storyboard_full_narration_video_mode: !!storyboardFullNarrationVideoMode.value,
    narration_chars_per_sec: Number(narrationCharsPerSec.value) || NARRATION_CHARS_PER_SEC_DEFAULT,
    storyboard_universal_omni: !!storyboardUniversalOmni.value,
    storyboard_video_soft_contiguity: !!videoSoftContiguity.value,
    storyboard_use_first_last_frame: !!storyboardUseFirstLastFrame.value,
    last_frame_use_first_layout_lock: !!lastFrameUseFirstLayoutLock.value,
    subtitle_auto_align: false,
    subtitle_margin_v: 12,
    pipeline_defaults_v2: true,
  }
  if (includeGenerationStyle) {
    Object.assign(metadata, projectStylePromptMetadata())
  }
  const payload = {
    genre: storyType.value || undefined,
    metadata,
  }
  if (includeGenerationStyle) {
    payload.style = generationStyle.value || undefined
  }
  dramaAPI.saveOutline(store.dramaId, payload).catch(e => console.error('Settings auto-save failed', e))
}

async function onGenerateStory() {
  trackFilmCreateAction('generate_script_click')
  await runGenerateStoryFromPremise({
    premise: storyInput.value,
    storyStyle: storyStyle.value,
    storyType: storyType.value,
    storyEpisodeCount: storyEpisodeCount.value,
    scriptTitle: scriptTitle.value,
    generationStyle: generationStyle.value,
    customStylePrompt: customStylePrompt.value,
    projectAspectRatio: projectAspectRatio.value,
    textModel: getSelectedTextModel(),
    store,
    router,
    route,
    loadDrama,
    savedCurrentEpisodeNumber,
    selectedEpisodeId,
    onEpisodeSelect,
  storyGenerating,
  scriptGenerating,
  pollTask,
  replaceRouteWhenNew: true,
    skipPostLoad: false,
    onComplete: ({ episodeCount }) => {
      trackFilmCreateAction('generate_script_complete', {
        extra: { episode_count: episodeCount },
      })
    },
  })
}

function openSelectScriptDialog() {
  showSelectScriptDialog.value = true
}

async function loadSelectScriptList() {
  selectScriptLoading.value = true
  try {
    const res = await dramaAPI.list({ page: 1, page_size: 100 })
    const items = res?.items ?? []
    selectScriptDramas.value = items.filter((d) => d?.metadata?.script_template === true)
  } catch {
    selectScriptDramas.value = []
  } finally {
    selectScriptLoading.value = false
  }
}

/**
 * 将源剧本的梗概 + 各集剧本写入当前工程（不跳转、不导入角色/分镜/视频）。
 * 在「新建故事」且尚未落库时，会创建新项目并跳转。
 */
async function onPickScriptFromDialog(sourceId) {
  if (!sourceId || selectScriptImporting.value) return
  const srcNum = Number(sourceId)
  const routeId = route.params.id
  const targetFromRoute = routeId && routeId !== 'new' ? Number(routeId) : null
  const targetId = store.dramaId ?? targetFromRoute ?? null

  if (targetId != null && Number(targetId) === srcNum) {
    ElMessage.info('当前打开的就是该项目')
    return
  }

  if (targetId != null) {
    try {
      await ElMessageBox.confirm(
        '将把所选剧本的「故事梗概」与「各集剧本正文」写入当前工程。不会导入角色、场景、分镜与视频。若源剧本集数更少，多出来的分集将从本工程移除（原分镜可能失效）。是否继续？',
        '导入剧本到当前工程',
        { type: 'warning', confirmButtonText: '导入', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }

  selectScriptImporting.value = true
  try {
    const src = await dramaAPI.get(srcNum)
    const rawEps = [...(src.episodes || [])].sort(
      (a, b) => (Number(a.episode_number) || 0) - (Number(b.episode_number) || 0)
    )
    const summary = (src.description || '').toString().trim()
    const episodesPayload = rawEps.map((ep, i) => ({
      episode_number: ep.episode_number != null ? Number(ep.episode_number) : i + 1,
      title: (ep.title || '').toString(),
      script_content: ep.script_content ?? '',
      description: ep.description ?? null,
      duration: ep.duration ?? 0,
    }))

    if (!targetId) {
      if (episodesPayload.length === 0 && !summary) {
        ElMessage.warning('所选剧本没有可导入的梗概或分集正文')
        return
      }
      const title = (src.title || '新故事').toString().trim() || '新故事'
      const created = await dramaAPI.create({
        title,
        description: summary || undefined,
        metadata: {},
      })
      const workId = created.id
      store.setDrama({ id: workId })
      if (episodesPayload.length > 0) {
        await dramaAPI.saveEpisodes(workId, episodesPayload)
      }
      if (summary) {
        await dramaAPI.saveOutline(workId, { summary }).catch(() => {})
      }
      showSelectScriptDialog.value = false
      router.replace('/film/' + workId)
      ElMessage.success('已根据所选剧本创建项目并导入梗概与正文')
      scriptWorkbenchMode.value = 'select'
      return
    }

    if (summary) {
      await dramaAPI.saveOutline(targetId, { summary }).catch(() => {})
    }
    if (episodesPayload.length > 0) {
      await dramaAPI.saveEpisodes(targetId, episodesPayload)
    } else if (!summary) {
      ElMessage.warning('所选剧本没有可导入的梗概或分集正文')
      return
    }

    showSelectScriptDialog.value = false
    await loadDrama()
    ElMessage.success('已导入故事梗概与剧本（当前工程未切换）')
    scriptWorkbenchMode.value = 'select'
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    selectScriptImporting.value = false
  }
}

watch(
  () => [store.drama?.episodes, selectedEpisodeId.value],
  () => {
    const eps = store.drama?.episodes || []
    if (eps.length > 1) {
      const cur = selectedEpisodeId.value
      const hit = cur != null && eps.some((e) => Number(e.id) === Number(cur))
      selectPreviewEpisodeId.value = hit ? String(cur) : String(eps[0].id)
    } else {
      selectPreviewEpisodeId.value = ''
    }
  },
  { deep: true, immediate: true }
)

function novelImportReset() {
  novelText.value = ''
  novelFileName.value = ''
  novelFileContent.value = ''
}

function onNovelFileChange(file) {
  novelFileName.value = file.name
  const reader = new FileReader()
  reader.onload = (ev) => { novelFileContent.value = ev.target.result }
  reader.readAsText(file.raw || file, 'utf-8')
}

async function onImportNovel() {
  const text = novelImportMode.value === 'file' ? novelFileContent.value : novelText.value
  if (!text?.trim()) {
    ElMessage.warning('请输入或上传小说内容')
    return
  }
  novelImporting.value = true
  try {
    const formData = new FormData()
    if (novelImportMode.value === 'file' && novelFileContent.value) {
      const blob = new Blob([novelFileContent.value], { type: 'text/plain' })
      formData.append('file', blob, novelFileName.value || 'novel.txt')
    } else {
      formData.append('text', text)
    }
    formData.append('title', scriptTitle.value || '导入小说')
    formData.append('max_chapters', String(novelMaxChapters.value))
    formData.append('ai_summarize', String(novelAiSummarize.value))
    const { default: axios } = await import('axios')
    const baseURL = (await import('@/utils/request')).default.defaults.baseURL || '/api/v1'
    const res = await axios.post(`${baseURL}/dramas/import-novel`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    let chapters = res.data?.data?.chapters || res.data?.chapters || []
    if (!chapters.length) {
      ElMessage.warning('未能识别到章节内容')
      return
    }
    // 若后端只识别出 1 章，但正文里有多处「第N集」行首标题，用前端规则再拆（与保存剧本一致）
    const clientParsed = parseScriptIntoEpisodes(text)
    if (clientParsed.split && clientParsed.episodes.length > chapters.length) {
      chapters = clientParsed.episodes.map((e, i) => ({
        index: i + 1,
        title: e.title,
        content: e.script_content,
        script: e.script_content,
      }))
    }
    const toEpisodeRow = (ch, i) => ({
      episode_number: i + 1,
      title: (ch.title && String(ch.title).trim()) || '第' + (i + 1) + '集',
      script_content: normalizeScriptContentForSave(String(ch.script ?? ch.content ?? '')),
      description: null,
      duration: 0,
    })
    const rows = chapters.map(toEpisodeRow)
    const plainScript = episodesListToPlainScript(
      rows.map((r) => ({ title: r.title, script_content: r.script_content }))
    )
    if (store.dramaId && rows.length >= 2) {
      await dramaAPI.saveEpisodes(store.dramaId, rows)
      await loadDrama()
      ElMessage.success(`已导入并拆分为 ${rows.length} 集`)
    } else {
      store.setScriptContent(plainScript || rows[0]?.script_content || '')
      ElMessage.success(
        rows.length >= 2
          ? `已导入 ${rows.length} 个章节（保存剧本时将写入多集）`
          : `成功导入 ${rows.length} 个章节，请继续编辑剧本`
      )
    }
    showNovelImport.value = false
    novelImportReset()
  } catch (e) {
    ElMessage.error(e.message || '导入失败')
  } finally {
    novelImporting.value = false
  }
}

async function onGenerateScript() {
  trackFilmCreateAction('save_script_click')
  const content = (scriptContent.value ?? store.scriptContent ?? '').toString().trim()
  if (!content) {
    ElMessage.warning('请先在「故事生成」中点击 AI 生成，或手动输入剧本内容')
    return
  }
  scriptGenerating.value = true
  try {
    const result = await saveScriptToBackend(content)
    if (result?.created) {
      ElMessage.success('项目已创建，剧本已保存')
    } else {
      ElMessage.success('剧本已保存')
    }
    trackFilmCreateAction('save_script_complete', {
      extra: { created_project: !!result?.created },
    })
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    scriptGenerating.value = false
  }
}

async function onAddEpisode() {
  if (!store.dramaId) return
  const list = store.drama?.episodes || []
  const nextNum = list.length > 0
    ? Math.max(...list.map((e) => Number(e.episode_number) || 0), 0) + 1
    : 1
  const updated = list.map((ep, i) => ({
    episode_number: ep.episode_number ?? i + 1,
    title: ep.title || '第' + (ep.episode_number ?? i + 1) + '集',
    script_content: ep.script_content || '',
    description: ep.description,
    duration: ep.duration
  }))
  updated.push({
    episode_number: nextNum,
    title: '第' + nextNum + '集',
    script_content: '',
    description: null,
    duration: 0
  })
  try {
    await dramaAPI.saveEpisodes(store.dramaId, updated)
    savedCurrentEpisodeNumber.value = nextNum
    await loadDrama()
    ElMessage.success('已添加第' + nextNum + '集')
  } catch (e) {
    ElMessage.error(e.message || '添加失败')
  }
}

function onUploadResourceClick(type, id) {
  resourceUploadType.value = type
  resourceUploadId.value = id
  resourceImageFileInput.value?.click()
}

/** 从剪贴板粘贴图片到角色 / 道具 / 场景（有主图则追加为额外参考图） */
async function onPasteResourceImage(type, id) {
  if (!type || id == null) return
  try {
    const file = await readImageFileFromClipboard()
    await doUploadResourceImage(type, id, file)
  } catch (e) {
    ElMessage.error(e?.message || '粘贴图片失败')
  }
}

// 解析 extra_images JSON，返回 local_path 数组
function parseExtraImages(item) {
  if (!item?.extra_images) return []
  try {
    const arr = typeof item.extra_images === 'string' ? JSON.parse(item.extra_images) : item.extra_images
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch { return [] }
}

// 将 local_path 转成可访问的 URL
function localPathToUrl(p) {
  if (!p) return ''
  if (p.startsWith('http')) return p
  return '/static/' + p.replace(/^\//, '')
}

// 查找角色/道具/场景在 store 中的当前对象
function findResource(type, id) {
  const list = type === 'character' ? (store.characters ?? [])
    : type === 'prop' ? (store.props ?? [])
    : (store.scenes ?? [])
  return list.find((x) => Number(x.id) === Number(id)) || null
}

async function doUploadResourceImage(type, id, file) {
  if (!file || !type || id == null) return
  const key = type === 'character' ? 'char-' : type === 'prop' ? 'prop-' : 'scene-'
  uploadingResourceId.value = key + id
  try {
    const res = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
    const data = res?.data ?? res
    const uploadedLocalPath = data?.local_path || data?.path || null
    const url = data?.url || uploadedLocalPath
    if (!url) { ElMessage.error('上传未返回地址'); return }

    const current = findResource(type, id)
    const hasPrimary = !!(current?.local_path || current?.image_url)

    if (hasPrimary) {
      // 已有主图 → 追加到 extra_images
      const extras = parseExtraImages(current)
      const newPath = uploadedLocalPath || url
      if (!extras.includes(newPath)) extras.push(newPath)
      const extraJson = JSON.stringify(extras)
      if (type === 'character') {
        await characterAPI.putImage(id, { extra_images: extraJson })
      } else if (type === 'prop') {
        await propAPI.update(id, { extra_images: extraJson })
      } else if (type === 'scene') {
        await sceneAPI.update(id, { extra_images: extraJson })
      }
    } else {
      // 无主图 → 设为主图
      if (type === 'character') {
        await characterAPI.putImage(id, { image_url: url, local_path: uploadedLocalPath ?? null })
      } else if (type === 'prop') {
        await propAPI.update(id, { image_url: url, local_path: uploadedLocalPath ?? null })
      } else if (type === 'scene') {
        await sceneAPI.update(id, { image_url: url, local_path: uploadedLocalPath ?? null })
      }
    }
    await loadDrama()
    ElMessage.success('上传成功')
  } catch (e) {
    ElMessage.error(e.message || '上传失败')
  } finally {
    uploadingResourceId.value = null
  }
}

// 将某张额外图片设为主图（主图降级到 extra_images 第一位）
async function onSetPrimaryImage(type, item, extraPath) {
  const extras = parseExtraImages(item)
  const oldPrimary = item.local_path || ''
  const newExtras = extras.filter((p) => p !== extraPath)
  if (oldPrimary) newExtras.unshift(oldPrimary)
  const extraJson = JSON.stringify(newExtras)
  try {
    if (type === 'character') {
      await characterAPI.putImage(item.id, { local_path: extraPath, image_url: '', extra_images: extraJson })
    } else if (type === 'prop') {
      await propAPI.update(item.id, { local_path: extraPath, image_url: '', extra_images: extraJson })
    } else if (type === 'scene') {
      await sceneAPI.update(item.id, { local_path: extraPath, image_url: '', extra_images: extraJson })
    }
    await loadDrama()
  } catch (e) {
    ElMessage.error(e.message || '操作失败')
  }
}

// 删除某张额外图片
async function onRemoveExtraImage(type, item, extraPath) {
  const extras = parseExtraImages(item).filter((p) => p !== extraPath)
  const extraJson = extras.length ? JSON.stringify(extras) : null
  try {
    if (type === 'character') {
      await characterAPI.putImage(item.id, { extra_images: extraJson })
    } else if (type === 'prop') {
      await propAPI.update(item.id, { extra_images: extraJson })
    } else if (type === 'scene') {
      await sceneAPI.update(item.id, { extra_images: extraJson })
    }
    await loadDrama()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

function onResourceImageFileChange(ev) {
  const file = ev.target?.files?.[0]
  const type = resourceUploadType.value
  const id = resourceUploadId.value
  if (!file || !type || id == null) {
    ev.target.value = ''
    return
  }
  doUploadResourceImage(type, id, file).finally(() => {
    resourceUploadType.value = null
    resourceUploadId.value = null
    ev.target.value = ''
  })
}


function getSbFirstFrameUrl(sb) {
  if (!sb?.id) return ''
  const img = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id) ? getSbFirstImage(sb.id) : getSbImage(sb.id)
  if (img && (img.image_url || img.local_path)) return assetImageUrl(img)
  if (sb.composed_image || sb.image_url) return imageUrl(sb.composed_image || sb.image_url)
  const lp = String(sb.local_path || '').trim()
  if (lp && !/\.(mp4|webm|mov|m4v)(\?|$)/i.test(lp)) return assetImageUrl({ local_path: lp })
  return ''
}

function getSbLastFrameUrl(sb) {
  const img = getSbLastImage(sb.id)
  if (img && (img.image_url || img.local_path)) return assetImageUrl(img)
  if (sb.last_frame_image_url || sb.last_frame_local_path) {
    return assetImageUrl({ image_url: sb.last_frame_image_url, local_path: sb.last_frame_local_path })
  }
  return ''
}

/** 下一镜分镜图 URL（用作本镜视频尾帧；优先其首帧，其次主图） */
function getNextStoryboardFrameUrl(sb) {
  const next = getNextStoryboard(sb?.id)
  if (!next) return ''
  const fromFirst = getSbFirstFrameUrl(next)
  if (fromFirst) return fromFirst
  const main = getSbImage(next.id)
  if (main && (main.image_url || main.local_path)) return assetImageUrl(main)
  if (next.composed_image || next.image_url) return imageUrl(next.composed_image || next.image_url)
  const lp = String(next.local_path || '').trim()
  if (lp && !/\.(mp4|webm|mov|m4v)(\?|$)/i.test(lp)) return assetImageUrl({ local_path: lp })
  return ''
}

/** 经典模式视频：首帧 URL（连贯帧可覆盖首帧）+ 尾帧（本镜尾帧优先，否则下一镜分镜图） */
function sbVideoFirstLastUrls(sb, universal, contiguityFirstFrameUrl) {
  let first =
    contiguityFirstFrameUrl ||
    (universal ? '' : toAbsoluteImageUrl(getSbFirstFrameUrl(sb) || ''))
  if (!first && !universal) {
    first = toAbsoluteImageUrl(getSbFirstFrameUrl(sb) || '')
  }
  let last = undefined
  let lastSource = ''
  if (storyboardUseFirstLastFrame.value && !universal) {
    const ownLast = getSbLastFrameUrl(sb)
    if (ownLast) {
      last = toAbsoluteImageUrl(ownLast)
      lastSource = 'own_last'
    } else {
      const nextUrl = getNextStoryboardFrameUrl(sb)
      if (nextUrl) {
        last = toAbsoluteImageUrl(nextUrl)
        lastSource = 'next_shot'
      }
    }
  }
  return { first: first || undefined, last, lastSource }
}

function formatSbVideoLastHint(lastSource) {
  if (lastSource === 'next_shot') return '尾帧=下一镜'
  if (lastSource === 'own_last') return '尾帧=本镜'
  return '无尾帧'
}

function appendSbVideoSubmitLog(sbId, imgPayload, lastSource, prefix = '提交') {
  const lastHint = formatSbVideoLastHint(lastSource)
  appendSbVideoLog(sbId, `${prefix} · ${imgPayload.submit_mode} · ${lastHint}`)
  if (storyboardUseFirstLastFrame.value && imgPayload.submit_mode === 'classic_first_only') {
    appendSbVideoLog(sbId, '提示：无尾帧（下一镜缺图或未开首尾帧）；上游将只收一张图')
  }
}

/** 经典首尾帧模式下，缺下一镜分镜图、将只能单图提交的分镜数 */
function countSbMissingNextShotTailFrame(boards) {
  if (!storyboardUseFirstLastFrame.value) return 0
  let n = 0
  for (const sb of boards || []) {
    if (!sb?.id || isSbUniversalMode(sb.id)) continue
    if (getSbLastFrameUrl(sb)) continue
    if (!getNextStoryboard(sb.id)) continue
    if (!getNextStoryboardFrameUrl(sb)) n += 1
  }
  return n
}

/**
 * 组装视频提交的图片字段。
 * 重要：后端/Agnes 只要有 reference_image_urls 就会走全能参考图，并丢弃 first/last_frame_url。
 * 因此经典首尾帧必须只传 first/last，不要带 reference_image_urls。
 */
function buildSbVideoImageSubmitPayload({
  universalOmni = false,
  universal = false,
  omniRefs = [],
  sceneOnlyRefs = [],
  absoluteUrl = '',
  vFirst,
  vLast,
  lastSource = '',
}) {
  if (universalOmni) {
    return {
      image_url: undefined,
      first_frame_url: undefined,
      last_frame_url: undefined,
      reference_image_urls: omniRefs.length ? omniRefs : undefined,
      submit_mode: 'omni_refs',
    }
  }
  if (!universal && storyboardUseFirstLastFrame.value) {
    const first = vFirst || absoluteUrl || undefined
    let submit_mode = 'classic_first_only'
    if (vLast) {
      submit_mode = lastSource === 'next_shot' ? 'classic_keyframes_next_shot' : 'classic_keyframes'
    }
    return {
      image_url: first,
      first_frame_url: first,
      last_frame_url: vLast || undefined,
      reference_image_urls: undefined,
      submit_mode,
    }
  }
  if (!universal) {
    const first = vFirst || absoluteUrl || undefined
    return {
      image_url: first,
      first_frame_url: first,
      last_frame_url: undefined,
      reference_image_urls: undefined,
      submit_mode: 'classic_single',
    }
  }
  // 全能分镜但视频协议不支持 Omni：降级为参考图 / 主图
  const refs = sceneOnlyRefs.length
    ? sceneOnlyRefs
    : absoluteUrl
      ? [absoluteUrl]
      : undefined
  const first = vFirst || absoluteUrl || undefined
  return {
    image_url: first,
    first_frame_url: first,
    last_frame_url: undefined,
    reference_image_urls: refs,
    submit_mode: 'universal_fallback_refs',
  }
}

/** 获取分镜主图的本地路径（用于超分辨率判断） */
function getSbLocalImage(sb) {
  const img = getSbImage(sb.id)
  return img?.local_path || sb.local_path || null
}

/**
 * P0-1: 从视频 URL 捕获末帧（浏览器 canvas 方案）
 * 返回 Blob（JPEG），失败返回 null
 */
async function captureVideoLastFrame(videoUrl) {
  return new Promise((resolve) => {
    if (!videoUrl) return resolve(null)
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'metadata'
    let captured = false
    const timeout = setTimeout(() => { if (!captured) resolve(null) }, 12000)
    video.addEventListener('error', () => { clearTimeout(timeout); if (!captured) resolve(null) })
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.max(0, video.duration - 0.5)
    })
    video.addEventListener('seeked', () => {
      if (captured) return
      captured = true
      clearTimeout(timeout)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 512
        canvas.height = video.videoHeight || 288
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0)
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85)
      } catch (_) {
        resolve(null)
      }
    })
    video.src = videoUrl
  })
}

/** 已完成视频条目 → 可播放 URL */
function completedVideoPlaybackUrl(videoItem) {
  if (!videoItem) return ''
  if (videoItem.local_path) {
    return toAbsoluteImageUrl('/static/' + String(videoItem.local_path).replace(/^\//, ''))
  }
  return (videoItem.video_url && String(videoItem.video_url).trim()) || ''
}

/** 截取视频末帧并上传，返回绝对 URL；失败返回 '' */
async function captureAndUploadVideoLastFrameAbsUrl(videoItem) {
  const prevVideoUrl = completedVideoPlaybackUrl(videoItem)
  if (!prevVideoUrl) return ''
  try {
    const lastFrameBlob = await captureVideoLastFrame(prevVideoUrl)
    if (!lastFrameBlob) return ''
    const file = new File([lastFrameBlob], 'soft_contiguity_frame.jpg', { type: 'image/jpeg' })
    const uploadRes = await uploadAPI.uploadImage(file, { dramaId: dramaId.value })
    if (!uploadRes?.local_path) return ''
    return toAbsoluteImageUrl('/static/' + String(uploadRes.local_path).replace(/^\//, ''))
  } catch (_) {
    return ''
  }
}

/** 取某分镜当前用于软衔接的已完成视频（优先选中条） */
function getSbCompletedVideoForContiguity(sbId) {
  if (sbId == null) return null
  const current = getSbVideo(sbId)
  if (current && current.status === 'completed') return current
  const list = sbVideos.value[sbId] || []
  return list.find((v) => v.status === 'completed') || null
}

/** P0-3: 对分镜图执行超分辨率（2x） */
async function onUpscaleSbImage(sb) {
  if (!sb?.id || upscalingSbIds.has(sb.id)) return
  upscalingSbIds.add(sb.id)
  try {
    await storyboardsAPI.upscale(sb.id)
    ElMessage.success('超分完成，图片已更新为高清版本')
    await loadSingleStoryboardMedia(sb.id)
  } catch (e) {
    ElMessage.error(e.message || '超分辨率失败')
  } finally {
    upscalingSbIds.delete(sb.id)
  }
}

function normalizeAudioRelPath(raw) {
  const s = String(raw != null ? raw : '').trim().replace(/^\//, '')
  return s
}

/** 对白 TTS 相对路径 */
function sbDialogueAudioRelPath(sb) {
  if (!sb?.id) return ''
  const fromCache = sbDialogueAudioPaths.value[sb.id]
  const fromRow = sb.audio_local_path
  const raw = (fromCache != null && String(fromCache).trim() !== '') ? fromCache : (fromRow != null ? fromRow : '')
  return normalizeAudioRelPath(raw)
}

/** 解说旁白 TTS 相对路径 */
function sbNarrationAudioRelPath(sb) {
  if (!sb?.id) return ''
  const fromCache = sbNarrationAudioPaths.value[sb.id]
  const fromRow = sb.narration_audio_local_path
  const raw = (fromCache != null && String(fromCache).trim() !== '') ? fromCache : (fromRow != null ? fromRow : '')
  return normalizeAudioRelPath(raw)
}

function hasSbNarrationAudio(sb) {
  if (!sb?.id) return false
  const cached = sbNarrationAudioPaths.value[sb.id]
  if (cached != null && String(cached).trim() !== '') return true
  const row = sb.narration_audio_local_path
  return row != null && String(row).trim() !== ''
}

function sbNarrationAudioPlaybackUrl(sb) {
  const rel = sbNarrationAudioRelPath(sb)
  if (!rel) return ''
  const rev = sbNarrationAudioRevision.value[sb.id] || 0
  return `/static/${rel}?v=${rev}`
}

function applySbNarrationAudioPath(sbId, localPath, durationSec = null) {
  if (sbId == null || !localPath) return
  sbNarrationAudioPaths.value = { ...sbNarrationAudioPaths.value, [sbId]: localPath }
  sbNarrationAudioRevision.value = {
    ...sbNarrationAudioRevision.value,
    [sbId]: (sbNarrationAudioRevision.value[sbId] || 0) + 1,
  }
  const dur = durationSec != null ? Number(durationSec) : NaN
  const hasDur = Number.isFinite(dur) && dur > 0
  if (hasDur) {
    sbDuration.value = { ...sbDuration.value, [sbId]: dur }
  }
  const list = store.currentEpisode?.storyboards
  if (Array.isArray(list)) {
    const row = list.find((x) => Number(x.id) === Number(sbId))
    if (row) {
      row.narration_audio_local_path = localPath
      row.narration_prompt_aligned_at = null
      if (hasDur) row.duration = dur
    }
  }
  const boards = storyboards.value || []
  const sb = boards.find((x) => Number(x.id) === Number(sbId))
  if (sb) {
    sb.narration_audio_local_path = localPath
    sb.narration_prompt_aligned_at = null
    if (hasDur) sb.duration = dur
  }
}

function buildNarrationTtsRequestBody(sbId, text) {
  return {
    storyboard_id: sbId,
    text: collapseNarrationBlankLines(text),
    tts_kind: 'narration',
    provider: 'indextts',
    voice_id: String(indexttsVoiceId.value || 'gsv:008').trim(),
    emotion_text: String(indexttsEmotionText.value || '自然流畅的解说语气，情绪饱满').trim(),
    speed: Number(indexttsSpeed.value) || 1.1,
    auto_load_indextts: true,
  }
}

/**
 * 单镜旁白配音：失败最多重试 NARRATION_TTS_MAX_RETRIES 次，仍失败则返回 { ok: false } 不抛错。
 * @param {{ onRetry?: (attempt: number, err: Error) => void, retryDelayMs?: number }} [opts]
 */
async function requestNarrationTtsForSb(sbId, text, opts = {}) {
  const maxAttempts = NARRATION_TTS_MAX_RETRIES + 1
  const retryDelayMs = opts.retryDelayMs ?? NARRATION_TTS_RETRY_DELAY_MS
  let lastErr = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      opts.onRetry?.(attempt, lastErr)
      const ok = await waitMsCancellable(retryDelayMs, () => pipelineAbortRequested.value)
      if (!ok) {
        return { ok: false, error: lastErr?.message || '已取消', aborted: true }
      }
    }
    try {
      const res = await fetch('/api/v1/audio/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildNarrationTtsRequestBody(sbId, text)),
      })
      const data = await res.json()
      const businessOk = data.success === true || Number(data.code) === 200
      if (!res.ok || !businessOk || !data.data?.local_path) {
        throw new Error(data.error?.message || data.message || '解说配音失败')
      }
      return {
        ok: true,
        local_path: data.data.local_path,
        duration: data.data.duration ?? null,
      }
    } catch (e) {
      lastErr = e
    }
  }
  return { ok: false, error: lastErr?.message || String(lastErr) }
}

function getNarrationTtsTargets(onlyMissing = false) {
  return (storyboards.value || []).filter((sb) => {
    const text = collapseNarrationBlankLines((sbNarration.value[sb.id] ?? sb.narration) || '')
    if (!text) return false
    if (onlyMissing && hasSbNarrationAudio(sb)) return false
    return true
  })
}

async function loadIndexTtsModelUi({ silent = false } = {}) {
  if (indexttsModelLoaded.value) return true
  indexttsLoading.value = true
  try {
    if (!silent) ElMessage.info('正在加载配音模型，首次可能需要下载资源…')
    const res = await aiVoicesAPI.indexttsLoad()
    indexttsInstallOk.value = !!res?.ok
    indexttsModelLoaded.value = !!res?.loaded
    if (!indexttsModelLoaded.value) {
      throw new Error(res?.error || res?.detail || '配音模型加载失败')
    }
    if (!silent) ElMessage.success('配音模型已加载')
    return true
  } catch (e) {
    if (!silent) ElMessage.error(e.message || '配音模型加载失败')
    throw e
  } finally {
    indexttsLoading.value = false
  }
}

async function unloadIndexTtsModelUi({ silent = false } = {}) {
  if (!indexttsModelLoaded.value) return
  indexttsUnloading.value = true
  try {
    await aiVoicesAPI.indexttsUnload()
    indexttsModelLoaded.value = false
    if (!silent) ElMessage.success('配音模型已卸载')
  } catch (e) {
    if (!silent) ElMessage.error(e.message || '卸载失败')
    throw e
  } finally {
    indexttsUnloading.value = false
  }
}

async function onLoadIndexTtsModel() {
  await loadIndexTtsModelUi()
}

async function onUnloadIndexTtsModel() {
  await unloadIndexTtsModelUi()
}

/** 配音/试听前自动加载 IndexTTS（未加载时调用 load 接口，含首次下载） */
async function ensureIndexTtsModelLoaded({ silent = false } = {}) {
  if (indexttsModelLoaded.value) return true
  return loadIndexTtsModelUi({ silent })
}

function playSbTtsFromRel(rel, revision = 0) {
  if (!rel) return
  const url = revision ? `/static/${rel}?v=${revision}` : `/static/${rel}`
  try {
    if (sbTtsPreviewAudio) {
      sbTtsPreviewAudio.pause()
      sbTtsPreviewAudio = null
    }
    const a = new Audio(url)
    sbTtsPreviewAudio = a
    a.addEventListener('ended', () => {
      if (sbTtsPreviewAudio === a) sbTtsPreviewAudio = null
    })
    a.play().catch(() => {
      ElMessage.warning('无法播放音频，请检查文件是否存在')
      if (sbTtsPreviewAudio === a) sbTtsPreviewAudio = null
    })
  } catch (_) {
    ElMessage.warning('无法播放音频')
  }
}

function playSbDialogueTts(sb) {
  playSbTtsFromRel(sbDialogueAudioRelPath(sb))
}

function playSbNarrationTts(sb) {
  playSbTtsFromRel(sbNarrationAudioRelPath(sb), sbNarrationAudioRevision.value[sb.id] || 0)
}

/** P2-4: 为分镜对白生成 TTS 配音 */
async function onTtsSbDialogue(sb) {
  if (!sb?.id || ttsSbIds.has(sb.id)) return
  if (!sb.dialogue?.trim()) {
    ElMessage.warning('该分镜没有对白内容')
    return
  }
  ttsSbIds.add(sb.id)
  try {
    const res = await fetch('/api/v1/audio/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyboard_id: sb.id, text: sb.dialogue, tts_kind: 'dialogue' }),
    })
    const data = await res.json()
    const businessOk = data.success === true || Number(data.code) === 200
    if (!res.ok || !businessOk) {
      throw new Error(data.error?.message || data.message || '配音失败')
    }
    if (data.data?.local_path) {
      sbDialogueAudioPaths.value = { ...sbDialogueAudioPaths.value, [sb.id]: data.data.local_path }
      sb.audio_local_path = data.data.local_path
      ElMessage.success('配音已生成')
    }
  } catch (e) {
    ElMessage.error(e.message || 'TTS 配音失败')
  } finally {
    ttsSbIds.delete(sb.id)
  }
}

/** 为分镜解说旁白生成 TTS（IndexTTS，与对白共用接口） */
async function onTtsSbNarration(sb) {
  if (!sb?.id || ttsSbNarrationIds.has(sb.id)) return
  const text = sbNarrationText(sb).trim()
  if (!text) {
    ElMessage.warning('该分镜没有解说旁白内容')
    return
  }
  ttsSbNarrationIds.add(sb.id)
  try {
    await ensureIndexTtsModelLoaded({ silent: true })
    const result = await requestNarrationTtsForSb(sb.id, text, {
      onRetry: (attempt) => {
        ElMessage.info(`镜#${sb.storyboard_number ?? sb.id} 配音失败，重试 ${attempt}/${NARRATION_TTS_MAX_RETRIES}…`)
      },
    })
    if (!result.ok) {
      throw new Error(result.error || '解说配音失败')
    }
    applySbNarrationAudioPath(sb.id, result.local_path, result.duration)
    if (result.duration != null) {
      ElMessage.success(`解说配音已生成（时长 ${Number(result.duration).toFixed(1)}s）`)
    } else {
      ElMessage.success('解说配音已生成')
    }
  } catch (e) {
    ElMessage.error(e.message || '解说 TTS 失败')
  } finally {
    ttsSbNarrationIds.delete(sb.id)
  }
}

/**
 * 全文解说：为本集分镜批量生成 IndexTTS 配音（GPU 串行）。
 * 配音成功后自动进入提示词优化（经典：按配音生成 polished+video；全能：同步时长并润色全能片段）。
 */
async function runNarrationTtsBatch(targets, {
  emptyMessage,
  allFailedMessage,
  successLabel = '条分镜',
  continueToPrompts = true,
} = {}) {
  if (!currentEpisodeId.value || batchNarrationTtsRunning.value) return { okCount: 0, failCount: 0 }
  if (!targets.length) {
    ElMessage.warning(emptyMessage || '当前集没有可配音的解说旁白')
    return { okCount: 0, failCount: 0 }
  }
  batchNarrationTtsRunning.value = true
  let okCount = 0
  let failCount = 0
  let batchError = null
  try {
    await ensureIndexTtsModelLoaded({ silent: false })
    const jobs = targets.filter((sb) => {
      const text = collapseNarrationBlankLines((sbNarration.value[sb.id] ?? sb.narration) || '')
      return !!text
    })
    await runConcurrently(jobs, BATCH_NARRATION_TTS_CONCURRENCY, async (sb) => {
      const text = collapseNarrationBlankLines((sbNarration.value[sb.id] ?? sb.narration) || '')
      if (!text) return
      // keep display in sync without blank lines
      if ((sbNarration.value[sb.id] || '') !== text) {
        sbNarration.value = { ...sbNarration.value, [sb.id]: text }
      }
      try {
        const result = await requestNarrationTtsForSb(sb.id, text)
        if (!result.ok) {
          throw new Error(result.error || '解说配音失败')
        }
        applySbNarrationAudioPath(sb.id, result.local_path, result.duration)
        okCount += 1
      } catch (e) {
        failCount += 1
        console.warn('[batch narration tts]', sb.id, e)
      }
    })
    if (okCount === 0) {
      ElMessage.warning(allFailedMessage || '批量配音全部失败，请检查 IndexTTS 是否就绪')
    } else if (failCount > 0) {
      ElMessage.warning(`配音成功 ${okCount} 条，失败 ${failCount} 条（已跳过失败镜继续）`)
    }
  } catch (e) {
    batchError = e
    ElMessage.error(e.message || '批量解说配音失败')
  } finally {
    batchNarrationTtsRunning.value = false
  }

  // 全文解说：配音完成后自动走提示词优化（与一键流水线同序）
  const shouldContinuePrompts =
    continueToPrompts &&
    !batchError &&
    okCount > 0 &&
    storyboardFullNarrationVideoMode.value &&
    getNarrationTtsTargets(true).length === 0
  if (shouldContinuePrompts) {
    if (failCount === 0) {
      ElMessage.success(`已为 ${okCount} ${successLabel}生成解说配音，开始提示词优化…`)
    }
    // 配音后自动续跑：仅处理尚未对齐的镜，避免重复调 AI
    await onGeneratePromptsFromAudioDuration({ forceRepolish: false })
  } else if (!batchError && okCount > 0 && failCount === 0) {
    ElMessage.success(`已为 ${okCount} ${successLabel}生成解说配音`)
  }
  return { okCount, failCount, error: batchError }
}

async function onBatchGenerateNarrationTts() {
  await runNarrationTtsBatch(getNarrationTtsTargets(false))
}

async function onCompleteRemainingNarrationTts() {
  await runNarrationTtsBatch(getNarrationTtsTargets(true), {
    emptyMessage: '所有旁白均已配音，无需补全',
    allFailedMessage: '补全配音全部失败，请检查 IndexTTS 是否就绪',
    successLabel: '条剩余分镜',
  })
}

/**
 * 全文解说：按配音刷新 duration；经典再生成提示词，全能再生成/润色全能片段。
 * @param {{ forceRepolish?: boolean }} opts
 *   forceRepolish 默认 true（全部已对齐后再手动点步骤 3）：已有草稿也会强制再润色；
 *   配音后自动续跑 / 补全 / 步骤 3 仍有缺口时传 false，仅处理尚未对齐的镜。
 */
async function onGeneratePromptsFromAudioDuration(opts = {}) {
  const forceRepolish = opts.forceRepolish !== false
  if (!currentEpisodeId.value || generatingPromptsFromAudio.value) return
  if (!storyboardFullNarrationVideoMode.value) {
    ElMessage.warning('仅全文解说模式可用')
    return
  }
  if (!(storyboards.value || []).length) {
    ElMessage.warning('请先生成分镜')
    return
  }
  const missingAudio = getNarrationTtsTargets(true).length
  if (missingAudio > 0) {
    ElMessage.warning(`还有 ${missingAudio} 镜未配音，请先「一键生成配音」`)
    return
  }
  generatingPromptsFromAudio.value = true
  try {
    const data = await storyboardsAPI.generatePromptsFromAudioDuration(currentEpisodeId.value, { force: true })
    await refreshStoryboardsForEpisode(currentEpisodeId.value, { storyboards: data?.storyboards })
    const synced = Number(data?.duration_sync?.updated) || 0

    if (storyboardUniversalOmni.value) {
      generatingPromptsFromAudio.value = false
      // 空草稿先「生成」，有草稿再「润色」；避免空文案被跳过却误报「已对齐」
      const polishRes = await polishUniversalSegmentsAfterGeneration({
        onlyUnaligned: !forceRepolish,
        onlyWithNarrationAudio: true,
        generateIfEmpty: true,
      })
      const polishedN = Number(polishRes?.polished) || 0
      const generatedN = Number(polishRes?.generated) || 0
      const failedN = Number(polishRes?.failed) || 0
      const doneN = polishedN + generatedN
      if (doneN > 0) {
        const parts = []
        if (generatedN > 0) parts.push(`生成 ${generatedN} 条`)
        if (polishedN > 0) parts.push(`润色 ${polishedN} 条`)
        ElMessage.success(
          `已按配音更新 ${synced} 镜时长，并${parts.join('、')}全能提示词` +
            (failedN > 0 ? `（失败 ${failedN}）` : '')
        )
      } else if (failedN > 0) {
        ElMessage.warning(`全能提示词处理失败 ${failedN} 镜，请检查文本模型配置`)
      } else if (polishRes?.skipped) {
        ElMessage.info(
          synced > 0
            ? `已按配音更新 ${synced} 镜时长（全能提示词已就绪，无需重复处理）`
            : '全能提示词已就绪，无需重复处理'
        )
      } else {
        ElMessage.warning('没有可处理的全能分镜（请确认已开启全能模式且分镜带旁白配音）')
      }
      return
    }

    const rebuilt = Number(data?.rebuilt) || 0
    const failed = Number(data?.failed) || 0
    if (failed > 0) {
      ElMessage.warning(`成功 ${rebuilt} 镜，失败 ${failed} 镜；${synced} 镜 duration 已按配音更新`)
    } else if (rebuilt > 0) {
      ElMessage.success(data?.message || `已为 ${rebuilt} 镜生成提示词（${synced} 镜 duration 已按配音更新）`)
    } else {
      ElMessage.info(data?.message || `已按配音更新 ${synced} 镜时长（无可重建的提示词）`)
    }
  } catch (e) {
    ElMessage.error(e?.message || '按配音时长生成提示词失败')
  } finally {
    generatingPromptsFromAudio.value = false
  }
}

/**
 * 全文解说生视频前：若尚未按配音对齐提示词，自动跑同步时长 + 润色/生成。
 * @returns {{ ok: boolean, reason?: string, aligned?: number }}
 */
async function ensureNarrationPromptsAlignedBeforeVideo(opts = {}) {
  const silent = !!opts.silent
  if (!storyboardFullNarrationVideoMode.value || !currentEpisodeId.value) {
    return { ok: true, skipped: true }
  }
  const boards = store.storyboards || store.currentEpisode?.storyboards || []
  const missingAudio = boards.filter((sb) => sbNeedsNarrationAudioBeforeVideo(sb)).length
  if (missingAudio > 0) {
    if (!silent) {
      ElMessage.warning(`还有 ${missingAudio} 镜未配音，请先「一键生成配音」后再生成视频`)
    }
    return { ok: false, reason: 'missing_audio', missingAudio }
  }
  const needAlign = boards.filter((sb) => {
    const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
    return !!text && !sbHasNarrationPromptAligned(sb)
  })
  if (!needAlign.length) return { ok: true, skipped: true, aligned: 0 }

  if (!silent) {
    ElMessage.info(
      storyboardUniversalOmni.value
        ? `生视频前先按配音润色全能提示词（${needAlign.length} 镜）…`
        : `生视频前先按配音生成提示词（${needAlign.length} 镜）…`
    )
  }

  const episodeId = currentEpisodeId.value
  generatingPromptsFromAudio.value = true
  try {
    const data = await storyboardsAPI.generatePromptsFromAudioDuration(episodeId, { force: true })
    await refreshStoryboardsForEpisode(episodeId, { storyboards: data?.storyboards })
  } catch (e) {
    if (!silent) ElMessage.error(e?.message || '同步配音时长失败')
    return { ok: false, reason: 'sync_failed', error: e }
  } finally {
    generatingPromptsFromAudio.value = false
  }

  if (storyboardUniversalOmni.value) {
    const polishRes = await polishUniversalSegmentsAfterGeneration({
      onlyUnaligned: true,
      onlyWithNarrationAudio: true,
      generateIfEmpty: true,
    })
    await loadDrama()
    const still = (store.storyboards || []).filter((sb) => {
      const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
      return !!text && !sbHasNarrationPromptAligned(sb)
    })
    if (still.length) {
      if (!silent) {
        ElMessage.warning(`仍有 ${still.length} 镜未完成按配音润色，已跳过这些镜的生视频`)
      }
      // 部分成功仍可继续：已对齐的镜可生视频
      return {
        ok: true,
        partial: true,
        aligned: (polishRes?.polished || 0) + (polishRes?.generated || 0),
        remaining: still.length,
      }
    }
    return { ok: true, aligned: (polishRes?.polished || 0) + (polishRes?.generated || 0) }
  }

  await loadDrama()
  const stillClassic = (store.storyboards || []).filter((sb) => {
    const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
    return !!text && !sbHasNarrationPromptAligned(sb)
  })
  if (stillClassic.length) {
    if (!silent) {
      ElMessage.warning(`仍有 ${stillClassic.length} 镜未完成按配音提示词，已跳过这些镜的生视频`)
    }
    return { ok: true, partial: true, remaining: stillClassic.length }
  }
  return { ok: true }
}

/** 步骤 3：全文解说先配音再提示词；全能则按配音润色全能片段 */
async function onGenerateStoryboardPromptsStep() {
  if (!currentEpisodeId.value || generatingStoryboardPromptsStep.value) return
  if (storyboardFullNarrationVideoMode.value) {
    // 仍有未对齐镜 → 只补缺口；全部已对齐再点 → 才强制全量重润色
    const boards = store.currentEpisode?.storyboards || store.storyboards || []
    const needAlign = boards.filter((sb) => {
      const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
      if (!text) return false
      if (!hasSbNarrationAudio(sb)) return false
      const hasUni =
        storyboardUniversalOmni.value
          ? !!((sbUniversalSegmentText.value[sb.id] ?? sb.universal_segment_text ?? '').toString().trim())
          : true
      if (storyboardUniversalOmni.value && !hasUni) return true
      return !sbHasNarrationPromptAligned(sb)
    })
    await onGeneratePromptsFromAudioDuration({ forceRepolish: needAlign.length === 0 })
    return
  }
  const cov = storyboardPromptCoverage.value
  if (!cov) return
  if (cov.showImagePromptComplete && cov.remainingImagePrompts > 0) {
    await onCompleteMissingImagePrompts()
  }
  if (cov.showVideoPromptComplete && cov.remainingVideoPrompts > 0) {
    await onCompleteMissingVideoPrompts()
  }
  if (!canGenerateStoryboardPromptsStep.value) {
    ElMessage.info('提示词已全部就绪')
  }
}

function formatSrtTimestamp(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const z = Math.floor(ms % 1000)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(z).padStart(3, '0')}`
}

/** 导出当前集分镜表（每镜一行；首尾帧模式含首/尾帧专用提示词） */
async function onExportStoryboardSheet() {
  const boards = storyboards.value || []
  if (!boards.length) {
    ElMessage.warning('暂无分镜')
    return
  }
  const epNum = store.currentEpisode?.episode_number
  const dramaTitle = (store.drama?.title || 'project').replace(/[\\/:*?"<>|]/g, '_')
  const epLabel = epNum != null ? `第${epNum}集` : `ep${currentEpisodeId.value || '1'}`
  const filenameBase = `${dramaTitle}-${epLabel}-分镜表`
  const useFirstLast = !!storyboardUseFirstLastFrame.value

  exportingStoryboardSheet.value = true
  const framePromptBySbId = {}
  try {
    await Promise.all(
      boards.map(async (sb) => {
        try {
          const res = await storyboardsAPI.getFramePrompts(sb.id)
          const fps = res?.frame_prompts || []
          framePromptBySbId[sb.id] = {
            first: fps.find((r) => r.frame_type === 'first')?.prompt?.trim() || '',
            last: fps.find((r) => r.frame_type === 'last')?.prompt?.trim() || '',
          }
        } catch (_) {
          framePromptBySbId[sb.id] = { first: '', last: '' }
        }
      })
    )
  } finally {
    exportingStoryboardSheet.value = false
  }

  function resolveFirstFramePrompt(sbId) {
    const cached = framePromptBySbId[sbId]?.first
    if (cached) return cached
    const imgPrompt = getSbFirstImage(sbId)?.prompt?.trim()
    if (imgPrompt) return imgPrompt
    if (useFirstLast) return buildFirstFrameImagePrompt(sbId)
    return ''
  }

  function resolveLastFramePrompt(sbId) {
    const cached = framePromptBySbId[sbId]?.last
    if (cached) return cached
    const imgPrompt = getSbLastImage(sbId)?.prompt?.trim()
    if (imgPrompt) return imgPrompt
    if (useFirstLast) return buildLastFrameImagePrompt(sbId)
    return ''
  }

  const result = exportStoryboardSheet(
    {
      storyboards: boards,
      getScene: (sbId) => getSbSelectedScene(sbId),
      getCharacters: (sbId) => getSbSelectedCharacters(sbId),
      getProps: (sbId) => getSbSelectedProps(sbId),
      getMovementLabel,
      getFirstFramePrompt: resolveFirstFramePrompt,
      getLastFramePrompt: resolveLastFramePrompt,
      getField(sb, key) {
        const id = sb.id
        const map = {
          title: sbTitle.value[id],
          location: sbLocation.value[id],
          time: sbTime.value[id],
          duration: sbDuration.value[id] ?? sb.duration,
          dialogue: sbDialogue.value[id],
          narration: sbNarration.value[id],
          action: sbAction.value[id],
          result: sbResult.value[id],
          atmosphere: sbAtmosphere.value[id],
          shot_type: sbShotType.value[id],
          movement: sbMovement.value[id],
          layout_description: sbLayoutDescription.value[id],
          universal_segment_text: sbUniversalSegmentText.value[id],
        }
        if (Object.prototype.hasOwnProperty.call(map, key)) {
          const v = map[key]
          return v != null && v !== '' ? v : sb[key]
        }
        return sb[key]
      },
    },
    filenameBase
  )

  if (!result.ok) {
    ElMessage.warning('当前分镜没有可导出的内容')
    return
  }
  ElMessage.success(`已导出分镜表（${result.count} 个镜头）`)
}

function onExportNarrationSrt() {
  const boards = storyboards.value || []
  if (!boards.length) {
    ElMessage.warning('暂无分镜')
    return
  }
  let tMs = 0
  const lines = []
  let idx = 1
  for (const sb of boards) {
    const durSec = Number(sbDuration.value[sb.id] ?? sb.duration)
    const sec = Number.isFinite(durSec) && durSec > 0 ? durSec : 5
    const durMs = Math.round(sec * 1000)
    const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
    if (text) {
      const start = formatSrtTimestamp(tMs)
      const end = formatSrtTimestamp(tMs + durMs)
      lines.push(String(idx++), `${start} --> ${end}`, text, '')
    }
    tMs += durMs
  }
  if (!lines.length) {
    ElMessage.warning('当前分镜没有可导出的解说文案')
    return
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `narration-${currentEpisodeId.value || 'episode'}.srt`
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('已下载解说 SRT')
}

async function onSaveSbNarrationField(sb) {
  if (!sb?.id) return
  const next = collapseNarrationBlankLines(sbNarration.value[sb.id] || '')
  if ((sbNarration.value[sb.id] || '') !== next) {
    sbNarration.value = { ...sbNarration.value, [sb.id]: next }
  }
  const prev = collapseNarrationBlankLines(sb.narration || '')
  const textChanged = next !== prev
  // 旁白文案未改：绝不清空配音、不因 duration≠估算而重存
  if (!textChanged) return
  try {
    const payload = {
      narration: next || null,
      narration_audio_local_path: null,
    }
    if (storyboardFullNarrationVideoMode.value) {
      const nextEst =
        Number(sb.storyboard_number) === 1 && !next
          ? 6
          : next
            ? getNarrationStats(next, narrationCharsPerSec.value).estSec
            : null
      if (nextEst != null) {
        payload.duration = nextEst
        applyNarrationDurationToSbLocal(sb, nextEst)
      }
    }
    const updated = await storyboardsAPI.update(sb.id, payload)
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) {
        row.narration = next || null
        row.narration_audio_local_path = null
        if (updated?.duration != null) {
          row.duration = Number(updated.duration)
          applyNarrationDurationToSbLocal(sb, Number(updated.duration))
        } else if (payload.duration != null) {
          row.duration = payload.duration
        }
        if (updated?.universal_segment_text != null && String(updated.universal_segment_text).trim()) {
          row.universal_segment_text = String(updated.universal_segment_text)
          applyUniversalSegmentSaveResult(sb, updated)
        }
      }
    }
    sb.narration_audio_local_path = null
    if (sbNarrationAudioPaths.value[sb.id]) {
      const nextPaths = { ...sbNarrationAudioPaths.value }
      delete nextPaths[sb.id]
      sbNarrationAudioPaths.value = nextPaths
    }
    if (sbNarrationAudioRevision.value[sb.id]) {
      const nextRev = { ...sbNarrationAudioRevision.value }
      delete nextRev[sb.id]
      sbNarrationAudioRevision.value = nextRev
    }
  } catch (_) { /* 静默失败，避免打断输入 */ }
}

function isSbUniversalMode(sbId) {
  return sbCreationMode.value[sbId] === 'universal'
}

function setSbCreationModeId(sbId, mode) {
  if (sbId == null) return
  const m = mode === 'universal' ? 'universal' : 'classic'
  sbCreationMode.value = { ...sbCreationMode.value, [sbId]: m }
}

async function onToggleSbUniversalMode(sb) {
  if (!sb?.id) return
  const cur = isSbUniversalMode(sb.id) ? 'universal' : 'classic'
  const next = cur === 'universal' ? 'classic' : 'universal'
  sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: next }
  try {
    await storyboardsAPI.update(sb.id, { creation_mode: next })
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) row.creation_mode = next
    }
  } catch (e) {
    sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: cur }
    ElMessage.error(e.message || '保存失败')
  }
}

async function onSaveUniversalSegmentField(sb) {
  if (!sb?.id) return
  let next = (sbUniversalSegmentText.value[sb.id] || '').toString()
  const prev = (sb.universal_segment_text || '').toString()
  // 编辑后可能挤成一行：保存前重整换行，避免子分镜预览/重新生成按钮消失
  const recomposed = recomposeUniversalMultiBeatIfParsable(next)
  if (recomposed && recomposed !== next) {
    next = recomposed
    sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: next }
  }
  if (next === prev) return
  try {
    const updated = await storyboardsAPI.update(sb.id, { universal_segment_text: next.trim() || null })
    applyUniversalSegmentSaveResult(sb, updated, next.trim())
  } catch (_) { /* 静默失败，避免打断输入 */ }
}

/** 保存全能片段后：应用后端 duration ↔ beat 同步结果 */
function applyUniversalSegmentSaveResult(sb, updated, fallbackText = '') {
  if (!sb?.id) return
  const list = store.currentEpisode?.storyboards
  const row = Array.isArray(list) ? list.find((x) => Number(x.id) === Number(sb.id)) : null
  const uni =
    (updated?.universal_segment_text != null ? String(updated.universal_segment_text) : '') ||
    fallbackText ||
    ''
  if (uni) {
    sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: uni }
    if (row) row.universal_segment_text = uni
    sb.universal_segment_text = uni
  }
  if (updated?.duration != null) {
    const d = Number(updated.duration)
    sbDuration.value = { ...sbDuration.value, [sb.id]: d }
    sb.duration = d
    if (row) row.duration = d
  }
}

function universalSegmentDurationSecForSb(sb) {
  const dUi = Number(sbDuration.value[sb?.id])
  const dRow = Number(sb?.duration)
  const dProj = Number(videoClipDuration.value)
  return Number.isFinite(dUi) && dUi > 0
    ? dUi
    : Number.isFinite(dRow) && dRow > 0
      ? dRow
      : Number.isFinite(dProj) && dProj > 0
        ? dProj
        : 5
}

/** 提交视频 API 时使用的时长：全文解说跟旁白估算；否则优先本分镜配置，其次项目「每段秒数」 */
function getSbVideoDurationForApi(sb) {
  if (storyboardFullNarrationVideoMode.value) {
    const text = sbNarrationText(sb).trim()
    const shotNum = Number(sb?.storyboard_number ?? sb?.shot_number) || 0
    if (shotNum === 1 && !text) return 6
    // 全能：优先用配音同步后的 duration
    if (storyboardUniversalOmni.value) {
      const perSb = Number(sbDuration.value[sb?.id] ?? sb?.duration)
      if (Number.isFinite(perSb) && perSb > 0) return Math.round(perSb)
    }
    if (text) {
      const maxSec = storyboardUniversalOmni.value ? UNIVERSAL_FULL_NARRATION_MAX_SEC : undefined
      return getNarrationStats(text, narrationCharsPerSec.value, maxSec != null ? { maxSec } : {}).estSec
    }
  }
  const perSb = Number(sbDuration.value[sb?.id] ?? sb?.duration)
  if (Number.isFinite(perSb) && perSb > 0) return perSb
  const clip = Number(videoClipDuration.value)
  if (Number.isFinite(clip) && clip > 0) return clip
  return undefined
}

/** 全能提示词生成/润色：提交当前编辑区中的分镜字段（避免未点保存时仍用库内旧对白） */
function buildUniversalSegmentFieldOverrides(sb) {
  if (!sb?.id) return {}
  const id = sb.id
  const trimOrNull = (v) => {
    const s = (v ?? '').toString().trim()
    return s || null
  }
  return {
    title: trimOrNull(sbTitle.value[id] ?? sb.title),
    description: trimOrNull(sb.description),
    location: trimOrNull(sbLocation.value[id] ?? sb.location),
    time: trimOrNull(sbTime.value[id] ?? sb.time),
    action: trimOrNull(sbAction.value[id] ?? sb.action),
    dialogue: trimOrNull(sbDialogue.value[id] ?? sb.dialogue),
    narration: trimOrNull(sbNarration.value[id] ?? sb.narration),
    result: trimOrNull(sbResult.value[id] ?? sb.result),
    atmosphere: trimOrNull(sbAtmosphere.value[id] ?? sb.atmosphere),
    shot_type: trimOrNull(sbShotType.value[id] ?? sb.shot_type),
    movement: trimOrNull(sbMovement.value[id] ?? sb.movement),
    layout_description: trimOrNull(sbLayoutDescription.value[id] ?? sb.layout_description),
  }
}

function getSbUniversalSegmentInstruction(sb) {
  if (!sb?.id) return ''
  return (sbUniversalSegmentInstruction.value[sb.id] ?? '').toString().trim()
}

function buildUniversalSegmentApiBody(sb, opts = {}) {
  const durationSec = universalSegmentDurationSecForSb(sb)
  const instruction = getSbUniversalSegmentInstruction(sb)
  return {
    duration: durationSec,
    field_overrides: buildUniversalSegmentFieldOverrides(sb),
    ...(instruction ? { user_instruction: instruction } : {}),
    ...(opts.forceWithoutReferenceImages ? { force_without_reference_images: true } : {}),
    ...(opts.extra || {}),
  }
}

/** 子分镜预览区：编辑单条 beat 正文并回写整段 universal_segment_text */
function onUniversalBeatBodyChange(sb, beat, newBody) {
  if (!sb?.id || !beat?.index) return
  const trimmed = String(newBody ?? '').trim()
  if (trimmed === (beat.body || '').trim()) return
  const full = sbUniversalSegmentTrimmed(sb)
  const r = replaceBeatInUniversalText(full, beat.index, trimmed, beat.seconds)
  if (!r.ok) {
    ElMessage.warning(r.error || '更新子分镜失败')
    return
  }
  sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: r.text }
  void onSaveUniversalSegmentField(sb)
}

/** 全能片段：@图片N 转 Grok 占位符 <IMAGE_N> */
function universalSegmentAtImageToGrokTags(text) {
  return (text || '').replace(/@图片(\d+)/g, '<IMAGE_$1>')
}

function onUniversalSegmentToGrokVideoTags(sb) {
  if (!sb?.id) return
  const raw = (sbUniversalSegmentText.value[sb.id] ?? '').toString()
  if (!raw.trim()) {
    ElMessage.warning('请先填写或生成片段描述')
    return
  }
  const next = universalSegmentAtImageToGrokTags(raw)
  if (next === raw) {
    ElMessage.info('未找到 @图片N 标记，无需转换')
    return
  }
  sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: next }
  void onSaveUniversalSegmentField(sb)
  ElMessage.success('已改为 Grok 视频占位符格式（<IMAGE_N>）')
}

function onUniversalSegmentPromptMenu(sb, cmd) {
  if (cmd === 'generate') onGenerateUniversalSegmentPrompt(sb, {})
  else if (cmd === 'generate-force') onGenerateUniversalSegmentPrompt(sb, { forceWithoutReferenceImages: true })
  else if (cmd === 'polish') onPolishUniversalSegmentPromptStream(sb, {})
  else if (cmd === 'polish-force') onPolishUniversalSegmentPromptStream(sb, { forceWithoutReferenceImages: true })
  else if (cmd === 'to-grok-video-tags') onUniversalSegmentToGrokVideoTags(sb)
}

/** 全文解说 + 全能：有旁白文案但未配音时，禁止润色（需先配音以对齐时长） */
function sbNeedsNarrationAudioBeforeUniversalPolish(sb) {
  if (!storyboardFullNarrationVideoMode.value || !storyboardUniversalOmni.value || !sb?.id) return false
  const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
  if (!text) return false
  return !hasSbNarrationAudio(sb)
}

/** 全能模式：根据当前分镜结构化字段流式生成片段描述（NDJSON） */
async function onGenerateUniversalSegmentPrompt(sb, opts = {}) {
  if (!sb?.id || generatingUniversalSegmentIds.has(sb.id)) return
  if (sbNeedsNarrationAudioBeforeUniversalPolish(sb)) {
    if (!opts.silent) ElMessage.warning('请先为本镜生成旁白配音，再生成/润色全能提示词')
    return
  }
  const force = !!opts.forceWithoutReferenceImages
  const silent = !!opts.silent
  generatingUniversalSegmentIds.add(sb.id)
  // 开始生成前先清空旧文案，避免旧内容与流式新文案叠在一起
  sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: '' }
  let live = ''
  try {
    const data = await storyboardsAPI.generateUniversalSegmentPromptStream(
      sb.id,
      buildUniversalSegmentApiBody(sb, { forceWithoutReferenceImages: force }),
      (delta) => {
        live += delta
        sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: live }
      }
    )
    const text = (data?.universal_segment_text ?? '').toString().trim()
    if (!text) {
      if (!silent) ElMessage.warning('未收到完整生成结果，请重试')
      return
    }
    sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: text }
    const list = store.currentEpisode?.storyboards
    const row = Array.isArray(list) ? list.find((x) => Number(x.id) === Number(sb.id)) : null
    if (row) row.universal_segment_text = text
    sb.universal_segment_text = text
    const alignedAt =
      (data?.narration_prompt_aligned_at && String(data.narration_prompt_aligned_at).trim()) || ''
    if (alignedAt) {
      if (row) row.narration_prompt_aligned_at = alignedAt
      sb.narration_prompt_aligned_at = alignedAt
    }
    if (!silent) {
      ElMessage.success(force ? '已强制生成全能片段提示词（无图模式）' : '已根据分镜生成全能片段提示词')
    }
  } catch (e) {
    if (!silent) ElMessage.error(e.message || '生成失败，请检查文本模型配置')
    throw e
  } finally {
    generatingUniversalSegmentIds.delete(sb.id)
  }
}

/** 全能模式：结合剧本与邻镜流式润色片段描述（服务端 NDJSON） */
async function onPolishUniversalSegmentPromptStream(sb, opts = {}) {
  if (!sb?.id || generatingUniversalSegmentIds.has(sb.id)) return
  if (sbNeedsNarrationAudioBeforeUniversalPolish(sb)) {
    ElMessage.warning('请先为本镜生成旁白配音，再润色全能提示词')
    return
  }
  const force = !!opts.forceWithoutReferenceImages
  const draft = sbUniversalSegmentTrimmed(sb)
  if (!draft) {
    ElMessage.warning('请先填写或生成片段描述后再润色')
    return
  }
  generatingUniversalSegmentIds.add(sb.id)
  // 润色开始先清空旧文案，流式写入新结果
  sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: '' }
  let live = ''
  try {
    const data = await storyboardsAPI.polishUniversalSegmentPromptStream(
      sb.id,
      buildUniversalSegmentApiBody(sb, {
        forceWithoutReferenceImages: force,
        extra: { draft_universal_segment_text: draft },
      }),
      (delta) => {
        live += delta
        sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: live }
      }
    )
    const text = (data?.universal_segment_text ?? '').toString().trim()
    if (!text) {
      ElMessage.warning('未收到完整润色结果，请重试')
      return
    }
    sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: text }
    const list = store.currentEpisode?.storyboards
    if (Array.isArray(list)) {
      const row = list.find((x) => Number(x.id) === Number(sb.id))
      if (row) row.universal_segment_text = text
    }
    ElMessage.success(force ? '全能片段已强制润色并保存（无图模式）' : '全能片段提示词已润色并保存')
  } catch (e) {
    ElMessage.error(e.message || '润色失败，请检查文本模型配置')
  } finally {
    generatingUniversalSegmentIds.delete(sb.id)
  }
}

/**
 * 批量生成/润色全能片段：空草稿走「生成」，有草稿走「润色」；7 路并发，每镜只调 1 次 AI。
 * @param {{
 *   checkPause?: () => Promise<void>,
 *   onShotProgress?: (cur:number,total:number,sb:object)=>void,
 *   onShotError?: (sb:object,msg:string)=>void,
 *   onlyUnaligned?: boolean,
 *   onlyWithNarrationAudio?: boolean,
 *   generateIfEmpty?: boolean,
 *   concurrency?: number,
 * }} opts
 */
async function polishUniversalSegmentsAfterGeneration(opts = {}) {
  const checkPause = typeof opts.checkPause === 'function' ? opts.checkPause : async () => {}
  const onShotProgress = typeof opts.onShotProgress === 'function' ? opts.onShotProgress : null
  const onShotError = typeof opts.onShotError === 'function' ? opts.onShotError : null
  const onlyUnaligned = !!opts.onlyUnaligned
  const onlyWithNarrationAudio = !!opts.onlyWithNarrationAudio
  const generateIfEmpty = opts.generateIfEmpty !== false
  const concurrency = Math.max(1, Number(opts.concurrency) || UNIVERSAL_OMNI_POLISH_CONCURRENCY)

  if (!storyboardUniversalOmni.value) {
    return { polished: 0, generated: 0, failed: 0, skipped: true }
  }

  const rawList = store.currentEpisode?.storyboards || []
  const list = rawList.slice().sort((a, b) => (Number(a.storyboard_number) || 0) - (Number(b.storyboard_number) || 0))

  // 失败批处理后 UI 可能残留空串，会挡住库内已有文案；先清掉这类空覆盖，便于正确跳过已成功镜
  {
    const healed = { ...sbUniversalSegmentText.value }
    let changed = false
    for (const sb of list) {
      if (!sb?.id) continue
      if (healed[sb.id] !== '') continue
      if ((sb.universal_segment_text || '').toString().trim()) {
        delete healed[sb.id]
        changed = true
      }
    }
    if (changed) sbUniversalSegmentText.value = healed
  }

  const resolveUniversalDraft = (sb) => {
    const fromUi = (sbUniversalSegmentText.value[sb.id] ?? '').toString().trim()
    if (fromUi) return fromUi
    return (sb.universal_segment_text ?? '').toString().trim()
  }

  const targets = list.filter((sb) => {
    if (!sb?.id || !isSbUniversalMode(sb.id)) return false
    if (onlyWithNarrationAudio) {
      const narr = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
      if (narr && !hasSbNarrationAudio(sb)) return false
    }
    const hasText = !!resolveUniversalDraft(sb)
    if (!hasText && !generateIfEmpty) return false
    // 已对齐且有文案：仅在 onlyUnaligned 时跳过；空文案即使残留 aligned 标记也要重生成
    if (onlyUnaligned && hasText && sbHasNarrationPromptAligned(sb)) return false
    return true
  })

  if (!targets.length) {
    return { polished: 0, generated: 0, failed: 0, skipped: true }
  }

  const drafts = new Map()
  const cleared = { ...sbUniversalSegmentText.value }
  for (const sb of targets) {
    drafts.set(sb.id, resolveUniversalDraft(sb))
    cleared[sb.id] = ''
    generatingUniversalSegmentIds.add(sb.id)
  }
  sbUniversalSegmentText.value = cleared

  universalOmniPolishRunning.value = true
  universalOmniPolishAbort.value = false
  universalOmniPolishProgress.value = {
    current: 0,
    total: targets.length,
    label: `${concurrency} 路并发`,
  }
  let polished = 0
  let generated = 0
  let failed = 0
  let done = 0

  const bumpProgress = (sb, modeLabel = '') => {
    done += 1
    const label =
      `${concurrency} 路并发 · ${modeLabel}#${sb.storyboard_number ?? sb.id}` +
      (sb.title ? ' ' + String(sb.title).slice(0, 16) : '')
    universalOmniPolishProgress.value = { current: done, total: targets.length, label }
    if (onShotProgress) onShotProgress(done, targets.length, sb)
  }

  const applyResult = (sb, text, alignedAt, mode) => {
    const t = (text || '').toString().trim()
    if (!t) return false
    sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: t }
    const stamp =
      (alignedAt && String(alignedAt).trim()) || new Date().toISOString()
    const storyList = store.currentEpisode?.storyboards
    if (Array.isArray(storyList)) {
      const row = storyList.find((x) => Number(x.id) === Number(sb.id))
      if (row) {
        row.universal_segment_text = t
        row.narration_prompt_aligned_at = stamp
      }
    }
    sb.universal_segment_text = t
    sb.narration_prompt_aligned_at = stamp
    if (mode === 'generate') generated += 1
    else polished += 1
    return true
  }

  try {
    await runConcurrently(
      targets,
      concurrency,
      async (sb) => {
        if (universalOmniPolishAbort.value) return { paused: true }
        await checkPause()
        if (universalOmniPolishAbort.value) return { paused: true }

        const draft = (drafts.get(sb.id) || '').toString().trim()
        const mode = draft ? 'polish' : 'generate'
        let live = ''
        try {
          let data
          if (mode === 'generate') {
            data = await storyboardsAPI.generateUniversalSegmentPromptStream(
              sb.id,
              buildUniversalSegmentApiBody(sb, { forceWithoutReferenceImages: true }),
              (delta) => {
                live += delta
                sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: live }
              }
            )
          } else {
            data = await storyboardsAPI.polishUniversalSegmentPromptStream(
              sb.id,
              buildUniversalSegmentApiBody(sb, {
                forceWithoutReferenceImages: true,
                extra: { draft_universal_segment_text: draft },
              }),
              (delta) => {
                live += delta
                sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: live }
              }
            )
          }
          const text = (data?.universal_segment_text ?? '').toString().trim()
          if (!applyResult(sb, text, data?.narration_prompt_aligned_at, mode)) {
            failed += 1
            // 恢复开跑前草稿，避免空串挡住库内文案，导致「未就绪」并反复全量重跑
            const prev = (drafts.get(sb.id) || '').toString()
            sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: prev }
            const msg = mode === 'generate' ? '生成结果为空' : '润色结果为空'
            if (onShotError) onShotError(sb, msg)
            else ElMessage.warning(`分镜 #${sb.storyboard_number ?? sb.id} 全能${mode === 'generate' ? '生成' : '润色'}失败：${msg}`)
          }
        } catch (e) {
          failed += 1
          const prev = (drafts.get(sb.id) || '').toString()
          sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: prev }
          const msg = e?.message || String(e)
          if (onShotError) onShotError(sb, msg)
          else ElMessage.warning(
            `分镜 #${sb.storyboard_number ?? sb.id} 全能${mode === 'generate' ? '生成' : '润色'}失败：${msg}`
          )
        } finally {
          generatingUniversalSegmentIds.delete(sb.id)
          bumpProgress(sb, mode === 'generate' ? '生成' : '润色')
        }
      },
      { getLabel: (sb) => {
        const draft = (drafts.get(sb.id) || '').toString().trim()
        return `${draft ? '润色' : '生成'}全能 #${sb.storyboard_number ?? sb.id}`
      } }
    )
  } finally {
    for (const sb of targets) generatingUniversalSegmentIds.delete(sb.id)
    universalOmniPolishRunning.value = false
    universalOmniPolishProgress.value = { current: 0, total: 0, label: '' }
  }
  return { polished, generated, failed, skipped: false }
}

/** 为视频生成获取参考图的真实 URL */
async function getMainImageUrlForVideo(sb) {
  return getSbFirstFrameUrl(sb)
}

/** 转为视频接口可请求的绝对 URL（后端/第三方需能访问） */
function toAbsoluteImageUrl(url) {
  if (!url || !String(url).trim()) return ''
  const s = String(url).trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  const base = (baseUrl.value || '').replace(/\/$/, '') || (typeof window !== 'undefined' ? window.location.origin : '')
  return base ? base + (s.startsWith('/') ? s : '/' + s) : s
}

function sbUniversalSegmentTrimmed(sb) {
  if (!sb?.id) return ''
  return (sbUniversalSegmentText.value[sb.id] ?? sb.universal_segment_text ?? '').toString().trim()
}

function getSbUniversalBeats(sb) {
  const text = sbUniversalSegmentTrimmed(sb)
  if (!text) return []
  const parsed = parseUniversalMultiBeatText(text)
  if (!parsed.ok) return []
  const narr = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString()
  return enrichUniversalBeatsWithTimeline(parsed.beats, narr)
}

function sbUniversalBeatsMisaligned(sb) {
  if (!sb?.id) return false
  const narr = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
  if (!narr) return false
  const text = sbUniversalSegmentTrimmed(sb)
  if (!text) return false
  const parsed = parseUniversalMultiBeatText(text)
  if (!parsed.ok || parsed.beats.length < 2) return false
  const totalSec = universalSegmentDurationSecForSb(sb)
  return beatsSecondsMisalignedWithNarration(parsed.beats, narr, totalSec)
}

/** 子分镜秒数之和与分镜 duration 不一致（应用同步前提示） */
function sbUniversalDurationBeatSumMisaligned(sb) {
  if (!sb?.id) return false
  const text = sbUniversalSegmentTrimmed(sb)
  if (!text) return false
  const beatSum = sumUniversalBeatSeconds(text)
  if (beatSum == null) return false
  const dur = universalSegmentDurationSecForSb(sb)
  return Math.abs(beatSum - dur) > 0.25
}

function sbUniversalDurationBeatSumHint(sb) {
  const text = sbUniversalSegmentTrimmed(sb)
  const beatSum = sumUniversalBeatSeconds(text)
  const dur = universalSegmentDurationSecForSb(sb)
  if (beatSum == null) return ''
  return `子分镜合计 ${beatSum}s · 分镜 duration ${dur}s`
}

/** 仅按旁白权重重分配各拍秒数（不调 AI，保留正文） */
function onAlignUniversalBeatSeconds(sb) {
  if (!sb?.id) return
  const narr = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
  if (!narr) {
    ElMessage.warning('本镜无旁白，无法按旁白对齐秒数')
    return
  }
  const draft = sbUniversalSegmentTrimmed(sb)
  if (!draft) {
    ElMessage.warning('请先填写或生成片段描述')
    return
  }
  const totalSec = universalSegmentDurationSecForSb(sb)
  const r = alignUniversalBeatSecondsToNarration(draft, totalSec, narr)
  if (!r.ok) {
    ElMessage.warning('无法解析多子分镜格式')
    return
  }
  if (!r.changed) {
    ElMessage.info('各拍秒数已与旁白权重一致')
    return
  }
  sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: r.text }
  void onSaveUniversalSegmentField(sb)
  ElMessage.success(`已按旁白对齐秒数（${(r.idealSeconds || []).join('+')}）`)
}

/** 全能模式：整段重新生成片段描述（一次生成完整多子分镜块，不按子分镜分别请求） */
async function onRegenerateUniversalSegment(sb) {
  if (!sb?.id) return
  await onGenerateUniversalSegmentPrompt(sb)
}

function sbHasNarrationPromptAligned(sb) {
  return !!(sb?.narration_prompt_aligned_at && String(sb.narration_prompt_aligned_at).trim())
}

/** 全文解说：有旁白但尚未按配音完成提示词优化时，禁止生视频 */
function sbNeedsNarrationPromptAlignBeforeVideo(sb) {
  if (!storyboardFullNarrationVideoMode.value || !sb?.id) return false
  const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
  if (!text) return false
  if (sbNeedsNarrationAudioBeforeVideo(sb)) return false
  return !sbHasNarrationPromptAligned(sb)
}

function sbCanSubmitVideo(sb) {
  if (!sb) return false
  if (sbNeedsNarrationAudioBeforeVideo(sb)) return false
  if (sbNeedsNarrationPromptAlignBeforeVideo(sb)) return false
  const vp = (sb.video_prompt || '').toString().trim()
  if (vp) return true
  if (isSbUniversalMode(sb.id)) return !!sbUniversalSegmentTrimmed(sb)
  return false
}

/** 全文解说：有旁白文案但未配音时，禁止生视频 */
function sbNeedsNarrationAudioBeforeVideo(sb) {
  if (!storyboardFullNarrationVideoMode.value || !sb?.id) return false
  const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
  if (!text) return false
  return !hasSbNarrationAudio(sb)
}

function sbVideoBlockedReason(sb) {
  if (!sb) return ''
  if (sbNeedsNarrationAudioBeforeVideo(sb)) {
    return '请先为本镜生成旁白配音，再生成视频'
  }
  if (sbNeedsNarrationPromptAlignBeforeVideo(sb)) {
    return storyboardUniversalOmni.value
      ? '请先「按配音润色全能提示词」，再生成视频'
      : '请先「按配音时长生成提示词」，再生成视频'
  }
  if (!sbCanSubmitVideo(sb)) {
    if (isSbUniversalMode(sb.id)) return '请先填写全能片段文案或视频提示词'
    return '请先生成视频提示词'
  }
  return ''
}

/** 提交给视频 API 的文案：全能模式有片段描述时仅提交该段（不拼接 video_prompt，避免动作/旁白盖过 @图片 等编排） */
function buildSbVideoPromptForApi(sb, { preferClassicPrompt = false } = {}) {
  const vp = (sb.video_prompt || '').toString().trim()
  const seg = sbUniversalSegmentTrimmed(sb)
  let base = ''
  if (preferClassicPrompt) base = vp || seg
  else if (isSbUniversalMode(sb.id)) base = seg || vp
  else base = vp
  if (!base) return base
  // 全能：提交时追加资产锁定，抑制模型脑补未绑定场景/路人/换角
  if (isSbUniversalMode(sb.id) && !preferClassicPrompt) {
    const lock = buildUniversalOmniAssetLockSuffix(sb)
    if (lock && !base.includes('【资产锁定')) base = `${base.trim()}\n${lock}`
    // 全文解说：字幕由后期 ffmpeg 烧录；剥掉「字幕浮现」类指令，避免模型再画一层字
    if (storyboardFullNarrationVideoMode.value) {
      base = sanitizeOmniPromptNoBurnedInCaptions(base)
    }
  }
  return base
}

/** 去掉会让模型在画面里直接画字幕的措辞（旁白字幕改由后期烧录） */
function sanitizeOmniPromptNoBurnedInCaptions(text) {
  let p = (text || '').toString()
  if (!p.trim()) return p
  p = p
    // 引号台词极易被模型画成字幕：提交视频前改成闭口无对白
    .replace(
      /@图片\s*(\d+)\s*(?:说|道|喊|叫|答|问|念|读|低语|怒吼)?[：:]\s*[「」""][^「」""]{0,120}[」""]/g,
      '@图片$1 人物闭口无口型，无对白'
    )
    .replace(/(?:说|道|喊|叫|答|问)[：:]\s*[「」""][^「」""]{0,120}[」""]/g, '人物闭口无口型')
    .replace(/[「」""][^「」""]{0,40}[」""]\s*字幕浮现于画面[^，。；\n]*/g, '')
    .replace(/字幕浮现于画面[^，。；\n]*/g, '')
    .replace(/下方滚动字幕[^，。；\n]*/g, '屏幕下方信息条')
    .replace(/滚动字幕[^，。；\n]*/g, '屏幕信息条')
    .replace(/烧录字幕[^，。；\n]*/g, '')
    .replace(/画面下方出现字幕[^，。；\n]*/g, '')
    .replace(/画面内字幕[^，。；\n]*/g, '')
    .replace(/下方字幕[^，。；\n]*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!/禁止画面字幕|字幕由后期|禁画面字/.test(p)) {
    p = `${p}\n【画面约束】禁止画面内字幕、烧录文字、标题字、歌词、花字、弹幕及任何 on-screen captions（旁白字幕由后期烧录）。`
  }
  return p
}

/**
 * 全能生视频提示词末尾硬约束：只提交片段描述用到的 @图片N（按最大序号截断尾部）。
 * 避免新闻里点名「苏蔓」却把其参考图整槽提交，模型就会硬塞她出镜。
 */
function buildUniversalOmniAssetLockSuffix(sb) {
  const slots = getSbUniversalOmniRefSlotsForSubmit(sb)
  if (!slots.length) {
    return '【资产锁定】禁止出现未绑定的新人物、路人、群众与未写明的地点；保持单镜头连续画面，禁止宫格/分屏。'
  }
  const parts = slots.map((s) => {
    const kind = s.kind === 'scene' ? '场景' : s.kind === 'prop' ? '道具' : '角色'
    const name = (s.name || '').toString().trim() || kind
    return `@图片${s.index}=${kind}「${name}」`
  })
  const hasScene = slots.some((s) => s.kind === 'scene')
  const sceneHint = hasScene
    ? '若 @图片1 为四宫格/多视角场景拼图，仅借空间与光影，禁止成片复刻分格或并列布局。'
    : ''
  return `【资产锁定·最高优先级】成片仅允许下列参考资产，禁止另造人脸、换角、路人、群众或未列出的地点：${parts.join('；')}。${sceneHint}禁止名单外角色与场景。仅点名未用 @图片N 绑定的人物（如电视新闻口述）不得实体出镜。`.trim()
}

/** 全能模式：与 collectSbOmniReferenceAbsoluteUrls 同序的参考槽位（用于 @ 选择器缩略图） */
function getSbUniversalOmniRefSlots(sb) {
  if (!sb?.id) return []
  const out = []
  let idx = 1
  const scene = getSbSelectedScene(sb.id)
  if (scene && (hasAssetImage(scene) || sceneVideoRefUrl(scene))) {
    out.push({
      index: idx++,
      kind: 'scene',
      name: (scene.location || scene.name || '场景').toString(),
      thumbUrl: sceneVideoRefUrl(scene) || assetImageUrl(scene),
    })
  }
  for (const c of getSbSelectedCharacters(sb.id)) {
    if (hasAssetImage(c)) {
      out.push({
        index: idx++,
        kind: 'character',
        name: (c.name || '角色').toString(),
        thumbUrl: assetImageUrl(c),
      })
    }
  }
  for (const p of getSbSelectedProps(sb.id)) {
    if (hasAssetImage(p)) {
      out.push({
        index: idx++,
        kind: 'prop',
        name: (p.name || '物品').toString(),
        thumbUrl: assetImageUrl(p),
      })
    }
  }
  return out
}

/** 片段描述中实际出现的 @图片N 序号 */
function getUsedOmniImageIndices(text) {
  const used = new Set()
  const raw = (text || '').toString()
  for (const m of raw.matchAll(/@图片\s*(\d+)/g)) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) used.add(n)
  }
  return used
}

/**
 * 生视频提交用槽位：按文案里最大 @图片N 截断尾部未引用槽（不挖中间洞，保证序号对齐）。
 */
function getSbUniversalOmniRefSlotsForSubmit(sb) {
  const slots = getSbUniversalOmniRefSlots(sb)
  if (!slots.length) return slots
  const used = getUsedOmniImageIndices(sbUniversalSegmentTrimmed(sb))
  if (!used.size) return slots
  const maxUsed = Math.max(...used)
  return slots.filter((s) => Number(s.index) <= maxUsed)
}

/** 生视频前：四宫格场景自动拆单格，写入 video_ref_local_path */
async function ensureSceneVideoRefForSb(sb) {
  const scene = getSbSelectedScene(sb?.id)
  if (!scene?.id || scene.video_ref_local_path) return
  const polished = String(scene.polished_prompt || '').trim()
  if (!polished || !/2\s*[x×]\s*2|four.?panel|quad|grid layout|四格|四宫格/i.test(polished)) return
  try {
    const res = await sceneAPI.ensureVideoRef(scene.id)
    const path = res?.video_ref_local_path
    if (!path) return
    scene.video_ref_local_path = path
    const patch = (list) => {
      if (!Array.isArray(list)) return
      const row = list.find((s) => Number(s.id) === Number(scene.id))
      if (row) row.video_ref_local_path = path
    }
    patch(store.drama?.scenes)
    patch(store.currentEpisode?.scenes)
  } catch (_) {}
}

/** 全能模式：场景/角色/物品 → 绝对 URL 列表（不含经典分镜中间主图；供可灵 Omni / 火山多图参考，最多 10，方舟侧最多取 9 张） */
async function collectSbOmniReferenceAbsoluteUrlsAsync(sb) {
  await ensureSceneVideoRefForSb(sb)
  return collectSbOmniReferenceAbsoluteUrls(sb)
}

function collectSbOmniReferenceAbsoluteUrls(sb) {
  if (!sb?.id) return []
  const urls = []
  const seen = new Set()
  function pushAbs(u) {
    const abs = toAbsoluteImageUrl(u)
    if (!abs || seen.has(abs)) return
    seen.add(abs)
    urls.push(abs)
  }
  for (const slot of getSbUniversalOmniRefSlotsForSubmit(sb)) {
    if (slot.thumbUrl) pushAbs(slot.thumbUrl)
  }
  return urls.slice(0, 10)
}

/** 非 Seedance2 全能降级：仅场景参考图（若有） */
function collectSbSceneOnlyReferenceAbsoluteUrls(sb) {
  if (!sb?.id) return []
  const scene = getSbSelectedScene(sb.id)
  const refUrl = scene ? sceneVideoRefUrl(scene) : ''
  if (refUrl) {
    const abs = toAbsoluteImageUrl(refUrl)
    return abs ? [abs] : []
  }
  return []
}

let activeVideoAiConfigCache = null
let activeVideoAiConfigCacheAt = 0
const ACTIVE_VIDEO_AI_CONFIG_TTL_MS = 15000

function invalidateActiveVideoAiConfigCache() {
  activeVideoAiConfigCache = null
  activeVideoAiConfigCacheAt = 0
}

async function getActiveVideoAiConfig() {
  const now = Date.now()
  if (activeVideoAiConfigCache && now - activeVideoAiConfigCacheAt < ACTIVE_VIDEO_AI_CONFIG_TTL_MS) {
    return activeVideoAiConfigCache
  }
  try {
    const rows = await aiAPI.list('video')
    const list = Array.isArray(rows) ? rows : []
    const active = list.filter((c) => c.is_active !== false)
    activeVideoAiConfigCache = active.find((c) => c.is_default) || active[0] || null
  } catch {
    activeVideoAiConfigCache = null
  }
  activeVideoAiConfigCacheAt = now
  return activeVideoAiConfigCache
}

function videoModelNameFromAiConfig(cfg) {
  if (!cfg) return ''
  const dm = (cfg.default_model || '').toString().trim()
  if (dm) return dm
  const m = cfg.model
  if (Array.isArray(m) && m.length) return String(m[0]).trim()
  return String(m || '').trim()
}

/**
 * Seedance 2.x 家族模型名判定（与后端 videoClient.isSeedance2FamilyModel 对齐）。
 * 含官方 doubao-seedance-2-0-* / jimeng-video-seedance-2.0，以及中转别名 mingiz-sd2、*-sd2 等。
 */
function isSeedance2VideoModel(modelName) {
  const m = String(modelName || '').toLowerCase().trim()
  if (!m) return false
  if (/seedance[-_]?2|seedance2/.test(m)) return true
  if (/2[-_]0[-_]/.test(m)) return true
  // 网关别名：mingiz-sd2、foo_sd2、sd2-bar
  if (/(^|[-_./])sd2($|[-_./])/.test(m)) return true
  return false
}

/** 全能分镜 + 当前视频配置是否可走多图参考（火山 Seedance 2.0、可灵 Omni、Agnes Video 等） */
function canUseUniversalOmniVideoApi(cfg) {
  if (!cfg) return false
  const proto = String(cfg.api_protocol || '').toLowerCase()
  const provider = String(cfg.provider || '').toLowerCase()
  const model = videoModelNameFromAiConfig(cfg).toLowerCase()
  if (proto === 'kling_omni') return true
  // 选了 volcengine_omni 即表示走多图参考；模型名可能是 996 等网关别名（如 mingiz-sd2），勿再按 seedance 字样拦截
  if (proto === 'volcengine_omni') return true
  if (proto === 'agnes' || provider === 'agnes' || /agnes-video/.test(model)) {
    return true
  }
  return false
}

async function confirmUniversalNonSeedance2Video() {
  await ElMessageBox.confirm(
    '你当前视频模型不支持多图参考，全能模式将降级：优先用分镜主图，否则仅传场景参考图。是否继续？',
    '全能模式与模型不匹配',
    { confirmButtonText: '继续', cancelButtonText: '取消', type: 'warning' }
  )
}

function onEditSbImagePrompt(sb) {
  if (!sb?.id) return
  editingSbImagePromptId.value = sb.id
  editingSbImagePromptText.value = (sb.image_prompt || '').toString()
}

async function onOpenSbPromptDialog(sb) {
  if (!sb?.id) return
  sbPromptTarget.value = sb
  sbPromptImageText.value = (sb.image_prompt || '').toString()
  sbPromptPolishedText.value = (sb.polished_prompt || '').toString()
  sbPromptImageInstruction.value = ''
  sbPromptVideoInstruction.value = ''
  const rawVideo = (sb.video_prompt || '').toString()
  sbPromptVideoText.value = formatVideoPromptForEdit(rawVideo)
  showSbPromptDialog.value = true
  try {
    const fresh = await storyboardsAPI.get(sb.id)
    if (fresh?.id) {
      sbPromptTarget.value = fresh
      sbPromptImageText.value = (fresh.image_prompt || '').toString()
      sbPromptPolishedText.value = (fresh.polished_prompt || '').toString()
      sbPromptVideoText.value = formatVideoPromptForEdit((fresh.video_prompt || '').toString())
    }
  } catch (_) {}
}

function formatVideoPromptForEdit(text) {
  if (!text) return ''
  // 按「主体：」「运动：」等分段做换行，方便阅读
  return text
    .replace(/([。；])\s*(主体|运动|环境|运镜|美学|声音|时长)：/g, '$1\n$2：')
    .replace(/^\s+|\s+$/g, '')
}

async function onPolishSbPrompt() {
  const sb = sbPromptTarget.value
  if (!sb?.id) return
  sbPromptPolishing.value = true
  try {
    const instruction = (sbPromptImageInstruction.value || '').trim()
    const res = await storyboardsAPI.polishPrompt(sb.id, instruction ? { user_instruction: instruction } : {})
    if (res?.polished_prompt) {
      sbPromptPolishedText.value = res.polished_prompt
      ElMessage.success('分镜图片优化提示词已生成')
    }
  } catch (e) {
    ElMessage.error(e.message || '生成失败，请检查 AI 配置 · 文本模型是否已启用')
  } finally {
    sbPromptPolishing.value = false
  }
}

async function onPolishSbVideoPromptStream() {
  const sb = sbPromptTarget.value
  if (!sb?.id || sbPromptVideoPolishing.value) return
  const draft = (sbPromptVideoText.value || '').replace(/\s+/g, ' ').trim()
  if (!draft) {
    ElMessage.warning('请先填写视频提示词，或在「视频参数」保存后再润色')
    return
  }
  sbPromptVideoPolishing.value = true
  let live = ''
  try {
    const instruction = (sbPromptVideoInstruction.value || '').trim()
    const data = await storyboardsAPI.polishClassicVideoPromptStream(
      sb.id,
      {
        draft_video_prompt: draft,
        ...(instruction ? { user_instruction: instruction } : {}),
      },
      (delta) => {
        live += delta
        sbPromptVideoText.value = formatVideoPromptForEdit(live)
      }
    )
    const text = (data?.video_prompt ?? '').toString().trim()
    if (!text) {
      ElMessage.warning('未收到完整润色结果，请重试')
      return
    }
    sbPromptVideoText.value = formatVideoPromptForEdit(text)
    ElMessage.success('视频提示词已 AI 润色，请点击「保存」写入分镜')
  } catch (e) {
    ElMessage.error(e.message || '润色失败，请检查 AI 配置 · 文本模型是否已启用')
  } finally {
    sbPromptVideoPolishing.value = false
  }
}

async function onSaveSbPromptDialog() {
  const sb = sbPromptTarget.value
  if (!sb?.id) return
  sbPromptSaving.value = true
  try {
    const normalizedVideo = (sbPromptVideoText.value || '').replace(/\s+/g, ' ').trim()
    await storyboardsAPI.update(sb.id, {
      image_prompt: sbPromptImageText.value.trim() || null,
      polished_prompt: sbPromptPolishedText.value.trim() || null,
      video_prompt: normalizedVideo || null,
    })
    await loadDrama()
    showSbPromptDialog.value = false
    ElMessage.success('提示词已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    sbPromptSaving.value = false
  }
}

async function onSaveSbImagePrompt(sb) {
  if (!sb?.id) return
  try {
    await storyboardsAPI.update(sb.id, { image_prompt: (editingSbImagePromptText.value || '').toString().trim() || null })
    await loadDrama()
    editingSbImagePromptId.value = null
    ElMessage.success('图片提示词已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

function onEditSbVideoPrompt(sb) {
  if (!sb?.id) return
  editingSbVideoPromptId.value = sb.id
  editingSbVideoPromptText.value = (sb.video_prompt || '').toString()
}

/** 将结构化视角三元组转为英文描述片段 + 中文标签（与 angleService.js 保持一致） */
function angleToPromptFragment(h, v, s) {
  const hDesc = { front:'shooting from the front', front_left:'shooting from front-left at 45-degree angle', left:'shooting from the left side, profile view', back_left:'shooting from back-left at 135-degree angle', back:"shooting from behind, character's back to camera", back_right:'shooting from back-right at 135-degree angle', right:'shooting from the right side, profile view', front_right:'shooting from front-right at 45-degree angle' }
  const vDesc = { worm:"extreme low-angle worm's eye view, camera near ground pointing sharply upward, strong upward perspective distortion, background shows sky/ceiling", low:'low-angle upward shot, camera below eye-line, slight upward tilt, empowering perspective', eye_level:'eye-level shot, neutral perspective, natural horizontal framing', high:"high-angle bird's eye view, camera above looking down, background shows floor/ground with downward perspective distortion" }
  const sDesc = { close_up:'close-up shot (face/bust framing), subject fills most of frame, shallow depth of field, background softly blurred', medium:'medium shot (waist-up to full body), character and immediate surroundings visible, moderate depth of field', wide:'wide shot (full body with environment), subject small relative to scene, deep depth of field, environment context prominent' }
  const hLabel = { front:'正面', front_left:'前左', left:'左侧', back_left:'后左', back:'背面', back_right:'后右', right:'右侧', front_right:'前右' }
  const vLabel = { worm:'虫眼仰', low:'仰拍', eye_level:'平视', high:'俯拍' }
  const sLabel = { close_up:'特写', medium:'中景', wide:'远景' }
  const fragment = [sDesc[s] || sDesc.medium, vDesc[v] || vDesc.eye_level, hDesc[h] || hDesc.front].join(', ')
  const label = `${sLabel[s] || '中景'}·${vLabel[v] || '平视'}·${hLabel[h] || '正面'}`
  return { fragment, label }
}

async function onSaveSbVideoFields(sb) {
  if (!sb?.id) return
  try {
    let duration = Number(sbDuration.value[sb.id]) || 5
    if (storyboardFullNarrationVideoMode.value) {
      const text = (sbNarration.value[sb.id] || '').toString().trim()
      const shotNum = Number(sb.storyboard_number ?? sb.shot_number) || 0
      if (shotNum === 1 && !text) duration = 6
      else if (text) duration = getNarrationStats(text, narrationCharsPerSec.value).estSec
      applyNarrationDurationToSbLocal(sb, duration)
    }
    await storyboardsAPI.update(sb.id, {
      title: (sbTitle.value[sb.id] || '').toString().trim() || null,
      location: (sbLocation.value[sb.id] || '').toString().trim() || null,
      time: (sbTime.value[sb.id] || '').toString().trim() || null,
      duration,
      action: (sbAction.value[sb.id] || '').toString().trim() || null,
      dialogue: (sbDialogue.value[sb.id] || '').toString().trim() || null,
      narration: (sbNarration.value[sb.id] || '').toString().trim() || null,
      atmosphere: (sbAtmosphere.value[sb.id] || '').toString().trim() || null,
      result: (sbResult.value[sb.id] || '').toString().trim() || null,
      angle: (sbAngle.value[sb.id] || '').toString().trim() || null,
      angle_h: sbAngleH.value[sb.id] || null,
      angle_v: sbAngleV.value[sb.id] || null,
      angle_s: sbAngleS.value[sb.id] || null,
      movement: (sbMovement.value[sb.id] || '').toString().trim() || null,
      lighting_style: sbLighting.value[sb.id] || null,
      depth_of_field: sbDof.value[sb.id] || null,
      shot_type: (sbShotType.value[sb.id] || '').toString().trim() || null,
      layout_description: (sbLayoutDescription.value[sb.id] || '').toString().trim() || null,
      creation_mode: sbCreationMode.value[sb.id] === 'universal' ? 'universal' : 'classic',
      universal_segment_text: (sbUniversalSegmentText.value[sb.id] || '').toString().trim() || null,
    })
    const rebuilt = await storyboardsAPI.rebuildVideoPrompt(sb.id)
    const newVp = (rebuilt?.video_prompt && String(rebuilt.video_prompt).trim()) || ''
    if (newVp) {
      videoParamsTarget.value = { ...sb, video_prompt: newVp }
    }
    await loadDrama()
    ElMessage.success(
      storyboardFullNarrationVideoMode.value && sbCreationMode.value[sb.id] !== 'universal'
        ? '已保存，视频提示词已根据旁白 AI 生成'
        : '已保存，视频提示词已按最新规则自动生成'
    )
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

async function onSaveSbVideoPrompt(sb) {
  if (!sb?.id) return
  try {
    await storyboardsAPI.update(sb.id, { video_prompt: (editingSbVideoPromptText.value || '').toString().trim() || null })
    await loadDrama()
    editingSbVideoPromptId.value = null
    ElMessage.success('视频提示词已保存')
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  }
}

function onOpenVideoParamsDialog(sb) {
  videoParamsTarget.value = sb
  showVideoParamsDialog.value = true
}

/** 取消关闭弹窗时，将创作模式与片段描述与服务器状态对齐（避免仅改单选未保存导致本地漂移） */
function onVideoParamsDialogClosed() {
  const sb = videoParamsTarget.value
  if (!sb?.id) return
  const row = (storyboards.value || []).find((x) => Number(x.id) === Number(sb.id))
  if (!row) return
  sbCreationMode.value = { ...sbCreationMode.value, [sb.id]: row.creation_mode === 'universal' ? 'universal' : 'classic' }
  sbUniversalSegmentText.value = { ...sbUniversalSegmentText.value, [sb.id]: (row.universal_segment_text ?? '').toString() }
}

function countDialogueLinesInSb(sb) {
  const raw = ((sbDialogue.value[sb.id] ?? sb.dialogue) || '').toString().trim()
  if (!raw) return 0
  const matches = raw.match(/[\u4e00-\u9fa5A-Za-z0-9·]{1,16}[：:]/g)
  return matches?.length || (raw ? 1 : 0)
}

function canSplitSbByAudio(sb) {
  if (!sb?.id) return false
  const dialogueCount = countDialogueLinesInSb(sb)
  const hasNarration = !!((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
  return dialogueCount + (hasNarration ? 1 : 0) >= 2
}

async function onSplitSbByAudio(sb) {
  if (!sb?.id) return
  try {
    await ElMessageBox.confirm(
      '将把本镜按「每句对白一条 + 旁白单独一条」拆成多个分镜，原镜变为第一条。已生成的视频不会保留。是否继续？',
      '按对白拆镜',
      { type: 'warning', confirmButtonText: '拆镜', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  splitByAudioLoading.value = true
  try {
    if (showVideoParamsDialog.value && videoParamsTarget.value?.id === sb.id) {
      await onSaveSbVideoFields(sb)
    }
    const res = await storyboardsAPI.splitByAudio(sb.id)
    const n = res?.storyboard_ids?.length ?? 0
    const summary = res?.plans_summary || ''
    showVideoParamsDialog.value = false
    await loadDrama()
    ElMessage.success(summary ? `已拆成 ${n} 条：${summary}` : `已拆成 ${n} 条分镜`)
  } catch (e) {
    ElMessage.error(e.message || '拆镜失败')
  } finally {
    splitByAudioLoading.value = false
  }
}

async function onSaveVideoParams() {
  const sb = videoParamsTarget.value
  if (!sb?.id) return
  videoParamsSaving.value = true
  try {
    await onSaveSbVideoFields(sb)
    showVideoParamsDialog.value = false
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    videoParamsSaving.value = false
  }
}

async function onBatchInferParams() {
  if (!currentEpisodeId.value) return
  inferringParams.value = true
  try {
    const res = await storyboardsAPI.batchInferParams(currentEpisodeId.value, false)
    await loadDrama()
    ElMessage.success(`摄影参数推断完成，更新了 ${res?.updated ?? 0} 条分镜`)
  } catch (e) {
    ElMessage.error(e.message || '推断失败')
  } finally {
    inferringParams.value = false
  }
}

/** 一键用 AI 重新生成/优化本分镜的布局描述（自动参考上下分镜保证前后连贯） */
async function onRegenerateLayoutDescription(sb) {
  if (sb && typeof sb === 'object' && sb.__v_isRef) sb = sb.value
  if (!sb?.id) return
  regeneratingLayoutSbIds.add(sb.id)
  try {
    const res = await storyboardsAPI.regenerateLayoutDescription(sb.id)
    const newText = res?.layout_description || res?.data?.layout_description
    if (newText) {
      // 直接用本次 AI 返回的结果更新本地编辑状态（响应里已包含新文本）
      sbLayoutDescription.value = { ...sbLayoutDescription.value, [sb.id]: newText }

      // 轻量刷新分镜列表（只更新 store 里的原始 storyboards，不触发 syncStoryboardStateFromEpisode，
      // 避免覆盖我们刚刚写入的 sbLayoutDescription 等本地字段）
      try { await refreshStoryboardsOnly() } catch (_) {}

      ElMessage.success('布局描述已由 AI 重新优化并保存（已参考上下分镜连贯性）')
      // 注意：不再调用 loadDrama()，因为它会全量重建所有 sbXxx 映射，可能用服务端旧数据覆盖本次结果。
      // 等后端 rowToStoryboard 补全 layout_description 字段后，关闭再打开对话框即可看到持久化值。
    } else {
      ElMessage.warning('AI 未返回有效的布局描述')
    }
  } catch (e) {
    ElMessage.error(e.message || '重新生成布局描述失败')
  } finally {
    regeneratingLayoutSbIds.delete(sb.id)
  }
}

async function onGenerateSbVideo(sb) {
  if (!dramaId.value || !sb?.id) return
  if (sbNeedsNarrationAudioBeforeVideo(sb)) {
    ElMessage.warning('请先为本镜生成旁白配音，再生成视频')
    return
  }
  if (storyboardFullNarrationVideoMode.value && sbNeedsNarrationPromptAlignBeforeVideo(sb)) {
    const ensure = await ensureNarrationPromptsAlignedBeforeVideo()
    if (!ensure.ok) return
    // 重新取最新分镜行（ensure 可能已刷库）
    const latest =
      (store.storyboards || []).find((x) => Number(x.id) === Number(sb.id)) ||
      (store.currentEpisode?.storyboards || []).find((x) => Number(x.id) === Number(sb.id)) ||
      sb
    if (sbNeedsNarrationPromptAlignBeforeVideo(latest)) {
      ElMessage.warning(
        storyboardUniversalOmni.value
          ? '本镜尚未完成按配音润色全能提示词，无法生成视频'
          : '本镜尚未完成按配音生成提示词，无法生成视频'
      )
      return
    }
  }
  if (!sbCanSubmitVideo(sb) && !sbCanSubmitVideo(
    (store.storyboards || []).find((x) => Number(x.id) === Number(sb.id)) || sb
  )) return
  const latestSb =
    (store.storyboards || []).find((x) => Number(x.id) === Number(sb.id)) || sb
  sb = latestSb
  const universal = isSbUniversalMode(sb.id)
  let universalOmniApi = universal
  if (universal) {
    const videoCfg = await getActiveVideoAiConfig()
    if (!canUseUniversalOmniVideoApi(videoCfg)) {
      try {
        await confirmUniversalNonSeedance2Video()
      } catch {
        return
      }
      universalOmniApi = false
    }
  }
  const omniRefs = universalOmniApi ? await collectSbOmniReferenceAbsoluteUrlsAsync(sb) : []
  let sceneOnlyRefs = []
  if (universal && !universalOmniApi) {
    await ensureSceneVideoRefForSb(sb)
    sceneOnlyRefs = collectSbSceneOnlyReferenceAbsoluteUrls(sb)
  }
  const hasClassicFrame = !!getSbFirstFrameUrl(sb)
  let hasAnyImage = false
  if (universalOmniApi) {
    hasAnyImage = omniRefs.length > 0
  } else if (universal) {
    hasAnyImage = hasClassicFrame || sceneOnlyRefs.length > 0
  } else {
    hasAnyImage = hasClassicFrame
  }
  if (!hasAnyImage) {
    if (!universal) {
      await ElMessageBox.alert(
        '当前为传统模式，生视频需要分镜参考图。请先生成或上传分镜图片后再试。',
        '传统模式缺少分镜图',
        { confirmButtonText: '知道了', type: 'warning' }
      )
      return
    }
    try {
      await ElMessageBox.confirm(
        universalOmniApi
          ? '当前没有可用的参考图（场景/角色/道具等；不含经典分镜主图），将按纯文案提交 Omni-Video（模型以 AI 配置为准），效果可能不稳定。确认继续？'
          : '当前没有分镜主图且无场景参考图，将仅按文字提示词生成视频，效果可能不稳定。确认继续？',
        universalOmniApi ? '全能模式无参考图' : '全能降级无参考图',
        { confirmButtonText: '继续生成', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
  }
  generatingSbVideoIds.add(sb.id)
  const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
  genStore.markRunning(meta)
  sbVideoErrors.value[sb.id] = ''
  sbVideoLogs.value = { ...sbVideoLogs.value, [sb.id]: [] }
  sbVideoLogLastTick.value = { ...sbVideoLogLastTick.value, [sb.id]: '' }
  appendSbVideoLog(sb.id, `开始生成 · ${getSbVideoDurationForApi(sb) || '?'}s · ${isSbUniversalMode(sb.id) ? '全能' : '经典'} · ${getSbVideoModel(sb.id)}`)
  // 清除前端选中状态 + 清除后端手动指定的 video_url，让合成时自动取最新生成的视频
  if (sbSelectedVideoId.value[sb.id] != null) {
    const next = { ...sbSelectedVideoId.value }
    delete next[sb.id]
    sbSelectedVideoId.value = next
  }
  storyboardsAPI.update(sb.id, { video_url: null }).catch(() => {})
  try {
    let absoluteUrl = ''
    let omniRefsForPayload = []
    let sceneOnlyRefsForPayload = []
    if (universalOmniApi) {
      omniRefsForPayload = omniRefs
      absoluteUrl = omniRefs[0] || ''
    } else if (universal) {
      const firstFrameUrl = await getMainImageUrlForVideo(sb)
      absoluteUrl = toAbsoluteImageUrl(firstFrameUrl)
      sceneOnlyRefsForPayload = sceneOnlyRefs
      if (!absoluteUrl && sceneOnlyRefs.length) absoluteUrl = sceneOnlyRefs[0]
    } else {
      const firstFrameUrl = await getMainImageUrlForVideo(sb)
      absoluteUrl = toAbsoluteImageUrl(firstFrameUrl)
    }
    let softContAbs = ''
    if (videoSoftContiguity.value && universalOmniApi) {
      const prevSb = getPrevStoryboard(sb.id)
      const prevVid = prevSb ? getSbCompletedVideoForContiguity(prevSb.id) : null
      if (prevVid) {
        softContAbs = await captureAndUploadVideoLastFrameAbsUrl(prevVid)
      }
    }
    const { first: vFirst, last: vLast, lastSource } = sbVideoFirstLastUrls(sb, universalOmniApi, null)
    if (storyboardUseFirstLastFrame.value && !universalOmniApi && !universal && !vLast) {
      ElMessage.warning('已开启首尾帧，但本镜无尾帧且下一镜也无分镜图，将仅用首帧提交（请先给下一镜生图）')
    }
    if (storyboardUseFirstLastFrame.value && (universalOmniApi || universal)) {
      ElMessage.warning('首尾帧仅作用于经典分镜；当前为全能模式，视频仍走参考图接口')
    }
    const imgPayload = buildSbVideoImageSubmitPayload({
      universalOmni: universalOmniApi,
      universal,
      omniRefs: omniRefsForPayload,
      sceneOnlyRefs: sceneOnlyRefsForPayload,
      absoluteUrl,
      vFirst,
      vLast,
      lastSource,
    })
    const preferClassicPrompt = universal && !universalOmniApi
    let promptForApi = buildSbVideoPromptForApi(sb, { preferClassicPrompt })
    if (softContAbs && universalOmniApi) {
      const soft = applySoftContiguityToOmniSubmit(
        imgPayload.reference_image_urls || omniRefsForPayload,
        softContAbs,
        promptForApi
      )
      if (soft.applied) {
        imgPayload.reference_image_urls = soft.refs
        promptForApi = soft.prompt
        appendSbVideoLog(sb.id, '软衔接 · 上一镜末帧已置于参考图第1张')
      }
    }
    appendSbVideoSubmitLog(sb.id, imgPayload, lastSource, '正在提交上游…')
    const res = await videosAPI.create({
      drama_id: dramaId.value,
      storyboard_id: sb.id,
      prompt: promptForApi,
      image_url: imgPayload.image_url,
      first_frame_url: imgPayload.first_frame_url,
      last_frame_url: imgPayload.last_frame_url,
      reference_image_urls: imgPayload.reference_image_urls,
      preferred_key_index: nextVideoPreferredKeyIndex(),
      style: getSelectedStyle(),
      aspect_ratio: projectAspectRatio.value || '16:9',
      resolution: videoResolution.value || undefined,
      duration: getSbVideoDurationForApi(sb),
      model: getSbVideoModel(sb.id),
    })
    if (res?.task_id) {
      appendSbVideoLog(sb.id, `已提交 · task ${String(res.task_id).slice(0, 36)}`)
      const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta, {
        onTick: makeSbVideoPollOnTick(sb.id),
      })
      if (pollRes?.status === 'failed') {
        sbVideoErrors.value[sb.id] = pollRes.error || '视频生成失败'
        appendSbVideoLog(sb.id, `失败 · ${pollRes.error || '视频生成失败'}`)
      } else if (pollRes?.status === 'completed') {
        sbVideoErrors.value[sb.id] = ''
        const postWarn = pollRes?.result?.post_warning
        if (postWarn) {
          sbVideoErrors.value[sb.id] = postWarn
          appendSbVideoLog(sb.id, `完成（旁白后处理警告）· ${postWarn}`)
          ElMessage.warning(`#${sb.storyboard_number ?? sb.id} 视频已生成，旁白后处理：${postWarn}`)
        } else {
          appendSbVideoLog(sb.id, '完成')
          ElMessage.success('视频生成完成')
        }
      } else if (pollRes?.status === 'timeout') {
        appendSbVideoLog(sb.id, `超时 · ${pollRes.error || ''}`)
      } else if (pollRes?.status === 'cancelled') {
        appendSbVideoLog(sb.id, '已停止')
      }
    } else {
      appendSbVideoLog(sb.id, '已提交（无 task_id，请稍后刷新查看）')
      await loadSingleStoryboardMedia(sb.id)
      ElMessage.success('视频生成已提交，请稍后查看')
    }
  } catch (e) {
    sbVideoErrors.value[sb.id] = e.message || '提交失败'
    appendSbVideoLog(sb.id, `提交失败 · ${e.message || '提交失败'}`)
    ElMessage.error(e.message || '提交失败')
  } finally {
    generatingSbVideoIds.delete(sb.id)
    genStore.markDone(meta)
    await loadSingleStoryboardMedia(sb.id)
  }
}

/** 失败后继续查询上游任务（复用 provider_task_id，不重新提交） */
async function onResumeSbVideoPoll(sb) {
  if (!sb?.id || isSbVideoGenerating(sb.id)) return
  const failed = getSbResumableFailedVideo(sb.id)
  if (!failed?.id) {
    ElMessage.warning('当前失败记录无法继续查询，请重新生成')
    return
  }
  generatingSbVideoIds.add(sb.id)
  const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '继续查询')
  genStore.markRunning(meta)
  sbVideoErrors.value[sb.id] = ''
  appendSbVideoLog(sb.id, `继续查询 · video_gen #${failed.id}`)
  try {
    const res = await videosAPI.resumePoll(failed.id)
    const taskId = res?.task_id
    if (!taskId) {
      throw new Error('未返回任务 ID')
    }
    appendSbVideoLog(sb.id, `恢复轮询 · task ${String(taskId).slice(0, 36)}`)
    const pollRes = await pollTask(taskId, () => loadSingleStoryboardMedia(sb.id), meta, {
      onTick: makeSbVideoPollOnTick(sb.id),
    })
    if (pollRes?.status === 'failed') {
      sbVideoErrors.value[sb.id] = pollRes.error || '继续查询失败'
      appendSbVideoLog(sb.id, `失败 · ${pollRes.error || '继续查询失败'}`)
    } else if (pollRes?.status === 'completed') {
      sbVideoErrors.value[sb.id] = ''
      appendSbVideoLog(sb.id, '查询完成')
      ElMessage.success('视频查询完成')
    } else if (pollRes?.error) {
      appendSbVideoLog(sb.id, pollRes.error)
    }
  } catch (e) {
    sbVideoErrors.value[sb.id] = e.message || '继续查询失败'
    appendSbVideoLog(sb.id, `继续查询失败 · ${e.message || ''}`)
    ElMessage.error(e.message || '继续查询失败')
  } finally {
    generatingSbVideoIds.delete(sb.id)
    genStore.markDone(meta)
    await loadSingleStoryboardMedia(sb.id)
  }
}

/** 尾帧衔接：提取当前视频最后一帧，设为下一个分镜的首帧 */
async function onLinkTailFrameToNext(sb) {
  if (!dramaId.value || !sb?.id) return
  const nextSb = getNextStoryboard(sb.id)
  if (!nextSb) {
    ElMessage.warning('已是最后一个分镜，没有下一个分镜可衔接')
    return
  }
  const video = getSbVideo(sb.id)
  if (!video) {
    ElMessage.warning('当前分镜没有视频')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定将 #${sb.storyboard_number ?? sb.id} 视频的尾帧设为 #${nextSb.storyboard_number ?? nextSb.id} 的首帧？\n原首帧将自动进入历史。`,
      '尾帧衔接',
      { confirmButtonText: '确认执行', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  linkingTailFrameIds.add(sb.id)
  try {
    const data = await storyboardsAPI.linkTailFrame(sb.id, { drama_id: dramaId.value })
    if (data?.error) {
      throw new Error(data.error)
    }
    ElMessage.success(`已将尾帧设为 #${nextSb.storyboard_number ?? nextSb.id} 的首帧`)
    // 刷新两个分镜的媒体
    await Promise.all([
      loadSingleStoryboardMedia(sb.id),
      loadSingleStoryboardMedia(nextSb.id)
    ])
  } catch (e) {
    ElMessage.error(e.message || '尾帧衔接失败')
  } finally {
    linkingTailFrameIds.delete(sb.id)
  }
}

/** 上镜尾帧：直接把上一分镜的尾帧图片（高清原图）设为当前分镜的首帧，无需 ffmpeg 提取视频帧，画面更清晰 */
async function onUsePrevTailAsFirst(sb) {
  if (!dramaId.value || !sb?.id) return
  const prevSb = getPrevStoryboard(sb.id)
  if (!prevSb) {
    ElMessage.warning('已是第一个分镜，没有上一分镜可取尾帧')
    return
  }
  const prevLastImg = getSbLastImage(prevSb.id)
  if (!prevLastImg) {
    ElMessage.warning(`上一分镜 #${prevSb.storyboard_number ?? prevSb.id} 尚无尾帧图片`)
    return
  }

  // 直接执行，不再弹确认框（用户已通过按钮 + tooltip 明确意图）
  usingPrevTailAsFirstIds.add(sb.id)
  try {
    // 通过 upload 接口在“当前分镜”下创建一个 image 记录（复用上一镜尾帧的物理文件路径/URL），frame_type 触发后端自动 bind
    const uploaded = await imagesAPI.upload({
      storyboard_id: sb.id,
      drama_id: dramaId.value,
      image_url: prevLastImg.image_url || '',
      local_path: prevLastImg.local_path || undefined,
      prompt: `上镜尾帧（直接复用 #${prevSb.storyboard_number ?? prevSb.id} 尾帧高清原图）`,
      frame_type: 'storyboard_first'
    })
    if (uploaded?.id) {
      // 手动设置本地选中，确保显示立即切换；同时调用 onSelect 做一次 server patch（与 upload 里的 bind 互补）
      onSelectSbFrameImage(sb, uploaded, 'first')
    }
    ElMessage.success(`已将 #${prevSb.storyboard_number ?? prevSb.id} 尾帧设为本分镜首帧（高清原图）`)

    // 刷新分镜元数据（拿回服务器最新的 first_frame_image_id）+ 媒体列表
    await Promise.all([
      refreshStoryboardsOnly(),
      loadSingleStoryboardMedia(sb.id)
    ])
    // 清除可能残留的手动选中（让服务器权威绑定 id 生效）
    delete sbSelectedImgId.value[sb.id]
  } catch (e) {
    ElMessage.error(e.message || '上镜尾帧设置失败')
  } finally {
    usingPrevTailAsFirstIds.delete(sb.id)
  }
}

/** 生成期间轻量刷新分镜列表（只更新指定集 storyboards，不重载整个 drama） */
async function refreshStoryboardsForEpisode(episodeId, options = {}) {
  const light = options.light ?? false
  if (!episodeId) return
  try {
    let list = options.storyboards
    if (!Array.isArray(list)) {
      const res = await dramaAPI.getStoryboards(episodeId)
      list = Array.isArray(res) ? res : (res?.storyboards ?? null)
    }
    if (!Array.isArray(list)) return
    if (Number(store.currentEpisode?.id) === Number(episodeId)) {
      store.currentEpisode.storyboards = list
      if (light) {
        mergeNewStoryboardsIntoState(list)
      } else {
        syncStoryboardStateFromEpisode(store.currentEpisode)
      }
    }
    const epInDrama = store.drama?.episodes?.find((e) => Number(e.id) === Number(episodeId))
    if (epInDrama) {
      epInDrama.storyboards = list
    }
  } catch (_) { /* 静默忽略，不影响主流程 */ }
}

/** @deprecated 使用 refreshStoryboardsForEpisode */
async function refreshStoryboardsOnly() {
  return refreshStoryboardsForEpisode(currentEpisodeId.value)
}

/** 仅包含用户显式填写的分镜生成参数（留空则不传 storyboard_count / video_duration） */
function buildStoryboardGenerateOptions(extra = {}) {
  const opts = {
    model: getSelectedTextModel(),
    style: getSelectedStyle(),
    aspect_ratio: projectAspectRatio.value || '16:9',
    include_narration: !!storyboardIncludeNarration.value,
    full_narration_video_mode: !!storyboardFullNarrationVideoMode.value,
    narration_chars_per_sec: Number(narrationCharsPerSec.value) || NARRATION_CHARS_PER_SEC_DEFAULT,
    universal_omni_storyboard: !!storyboardUniversalOmni.value,
    ...extra,
  }
  if (opts.storyboard_count == null) {
    const count = getStoryboardCountForApi()
    if (count != null) opts.storyboard_count = count
  }
  if (opts.video_duration == null) {
    const duration = getVideoDurationForApi()
    if (duration != null) opts.video_duration = duration
  }
  return opts
}

const TEST_STORYBOARD_COUNT = 7

async function onGenerateStoryboard(extra = {}) {
  trackFilmCreateAction('generate_storyboard_click')
  const epId = currentEpisodeId.value
  if (!epId) return
  const isTest = Number(extra.storyboard_count) === TEST_STORYBOARD_COUNT
  const meta = buildExtractTaskMeta(
    store,
    dramaId.value,
    epId,
    GEN_RESOURCE.GENERATE_STORYBOARD,
    isTest ? `测试生成分镜（${TEST_STORYBOARD_COUNT}镜）` : 'AI生成分镜'
  )
  genStore.markRunning(meta)
  storyboardGenStatusMessage.value = ''
  // 生成期间每 2 秒刷新该集分镜列表，让已解析的分镜逐步出现（切集后仍更新原集缓存）
  const refreshTimer = setInterval(() => refreshStoryboardsForEpisode(epId, { light: true }), 2000)
  try {
    const res = await dramaAPI.generateStoryboard(epId, buildStoryboardGenerateOptions(extra))
    const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
    if (taskId) {
      const pollRes = await pollTask(taskId, () => loadDrama(), meta, {
        onTick: (t) => {
          const msg = t?.message != null ? String(t.message).trim() : ''
          if (msg) storyboardGenStatusMessage.value = msg
        },
      })
      // failed / timeout：pollTask 内已展示对应提示，直接返回，不显示「完成」
      if (pollRes?.status !== 'completed') return
      if (pollRes?.result?.truncated) {
        sbTruncatedWarning.value = true
        sbTruncatedDismissed.value = false
      }
    }
    await loadDrama()
    // 生成完成后静默补全空缺的摄影参数（只填未填字段，不覆盖 AI 已填的）
    storyboardsAPI.batchInferParams(epId, false).catch(() => {})
    // 全能片段描述已在分镜 JSON 生成时写入，不再二次自动润色（避免每镜多调一次 AI）
    if (storyboardUniversalOmni.value && storyboardFullNarrationVideoMode.value) {
      ElMessage.success('全能分镜已生成；请先「一键生成配音」，再点「按配音润色全能提示词」')
    } else if (storyboardUniversalOmni.value) {
      ElMessage.success('全能分镜生成完成（片段描述已写入，可按需手动润色）')
    } else {
      ElMessage.success(
        storyboardFullNarrationVideoMode.value
          ? '分镜已按规则切分旁白；请先配音，再点「按配音时长生成提示词」'
          : isTest
            ? `测试分镜生成完成（${TEST_STORYBOARD_COUNT} 镜）`
            : '分镜生成完成'
      )
    }
    trackFilmCreateAction('generate_storyboard_complete', {
      extra: { storyboard_count: (store.storyboards || []).length },
    })
  } catch (e) {
    // HTTP 错误由 request 拦截器统一展示，此处仅处理拦截器未覆盖的异常
    if (!e.response) ElMessage.error(e.message || '生成失败')
  } finally {
    clearInterval(refreshTimer)
    storyboardGenStatusMessage.value = ''
    genStore.markDone(meta)
  }
}

function onGenerateTestStoryboard() {
  onGenerateStoryboard({ storyboard_count: TEST_STORYBOARD_COUNT })
}

async function onAddSingleStoryboard(){
  if (!currentEpisodeId.value) {
    ElMessage.warning('请先选择集')
    return
  }
  try {
    // 获取当前最大序号（仅计算当前集的分镜）
    const maxNum = (store.storyboards || [])
      .filter(sb => sb.episode_id === currentEpisodeId.value)
      .reduce((max, sb) => Math.max(max, sb.storyboard_number || 0), 0)
    await storyboardsAPI.create({
      episode_id: currentEpisodeId.value,
      storyboard_number: maxNum + 1,
      title: `镜头 ${maxNum + 1}`,
      description: '',
    })
    ElMessage.success('添加成功')
    await loadDrama() // 刷新列表
  } catch (e) {
    ElMessage.error(e.message || '添加失败')
  }
}

async function onDeleteSingleStoryboard(id){
  try {
    await ElMessageBox.confirm('确定要删除这个分镜吗？', '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await storyboardsAPI.delete(id)
    ElMessage.success('删除成功')
    await loadDrama() // 刷新列表
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.message || '删除失败')
    }
  }
}

async function onInsertStoryboardBefore(sb) {
  try {
    await storyboardsAPI.insertBefore(sb.id)
    ElMessage.success('已在此位置前新增空白分镜')
    await loadDrama()
  } catch (e) {
    ElMessage.error(e.message || '新增失败')
  }
}

/**
 * 单独重新生成本镜脚本；确认框可选是否按 AI 结果重新绑定角色/场景/道具。
 * - 确认「生成并重绑」→ rebind_assets=true
 * - 取消但选「仅生成」→ rebind_assets=false
 * - 关闭对话框 → 不操作
 */
async function onRegenerateSingleStoryboard(sb) {
  if (!sb?.id || regeneratingSingleSbIds.has(sb.id)) return
  const shotLabel = sb.storyboard_number != null ? `#${sb.storyboard_number}` : ''
  let rebindAssets = false
  try {
    await ElMessageBox.confirm(
      `将 AI 重新生成分镜 ${shotLabel} 的脚本（标题/动作/对白/景别等），不删除本镜、不改镜号。\n\n「生成并重绑」：按 AI 结果更新角色/场景/道具；「仅生成」：保留当前勾选。`,
      '重新生成本镜',
      {
        distinguishCancelAndClose: true,
        confirmButtonText: '生成并重绑',
        cancelButtonText: '仅生成',
        type: 'warning',
      }
    )
    rebindAssets = true
  } catch (action) {
    if (action === 'cancel') {
      rebindAssets = false
    } else {
      return
    }
  }

  regeneratingSingleSbIds.add(sb.id)
  try {
    ElMessage.info(rebindAssets ? '正在重新生成本镜并重绑资产…' : '正在重新生成本镜脚本…')
    await storyboardsAPI.regenerateOne(sb.id, { rebind_assets: rebindAssets })
    await loadDrama()
    ElMessage.success(rebindAssets ? '本镜已重新生成，资产已按 AI 重绑' : '本镜已重新生成（保留原资产绑定）')
  } catch (e) {
    ElMessage.error(e.message || '重新生成本镜失败')
  } finally {
    regeneratingSingleSbIds.delete(sb.id)
  }
}

async function onCompleteMissingImagePrompts() {
  if (!currentEpisodeId.value || completingImagePrompts.value) return
  const remaining = storyboardPromptCoverage.value?.remainingImagePrompts ?? 0
  if (remaining <= 0) {
    ElMessage.info('生图提示词已全部就绪')
    return
  }
  completingImagePrompts.value = true
  try {
    const data = await storyboardsAPI.completeMissingImagePrompts(currentEpisodeId.value)
    await loadDrama()
    const polished = Number(data?.polished) || 0
    const failed = Number(data?.failed) || 0
    const skipped = Number(data?.skipped) || 0
    if (data?.skipped_reason === 'no_text_model') {
      ElMessage.warning('未配置文本模型，无法补全生图提示词')
      return
    }
    if (failed > 0) {
      ElMessage.warning(`生图提示词补全完成：成功 ${polished} 条，失败 ${failed} 条${skipped > 0 ? `，跳过 ${skipped} 条` : ''}`)
    } else if (polished > 0) {
      ElMessage.success(`已补全 ${polished} 条生图提示词`)
    } else {
      ElMessage.info('没有需要补全的生图提示词')
    }
  } catch (e) {
    ElMessage.error(e.message || '补全生图提示词失败')
  } finally {
    completingImagePrompts.value = false
  }
}

async function onCompleteMissingVideoPrompts() {
  if (!currentEpisodeId.value || completingVideoPrompts.value || universalOmniPolishRunning.value) return
  if (storyboardFullNarrationVideoMode.value && storyboardUniversalOmni.value) {
    // 补全只处理尚未对齐/失败的镜，禁止 forceRepolish（否则会把已成功的也全部重跑，易再次失败形成死循环）
    await onGeneratePromptsFromAudioDuration({ forceRepolish: false })
    return
  }
  const cov = storyboardPromptCoverage.value
  const remaining = cov?.remainingVideoPrompts ?? 0
  if (remaining <= 0) {
    ElMessage.info(cov?.showVideoPromptComplete && storyboardUniversalOmni.value ? '全能片段已全部就绪' : '视频提示词已全部就绪')
    return
  }

  if (storyboardUniversalOmni.value) {
    const targets = (storyboards.value || []).filter((sb) => sbIsUniversal(sb) && !sbUniversalSegmentReady(sb))
    if (!targets.length) {
      ElMessage.info('全能片段已全部就绪')
      return
    }
    universalOmniPolishRunning.value = true
    universalOmniPolishAbort.value = false
    universalOmniPolishProgress.value = { current: 0, total: targets.length, label: '' }
    let okCount = 0
    try {
      for (let i = 0; i < targets.length; i++) {
        if (universalOmniPolishAbort.value) break
        const sb = targets[i]
        universalOmniPolishProgress.value = {
          current: i + 1,
          total: targets.length,
          label: '#' + (sb.storyboard_number ?? sb.id),
        }
        try {
          await onGenerateUniversalSegmentPrompt(sb, { silent: true })
          const row = (store.storyboards || []).find((x) => Number(x.id) === Number(sb.id)) || sb
          if (sbUniversalSegmentReady(row)) okCount += 1
        } catch (e) {
          console.warn('[补全全能片段] 失败', sb.id, e?.message)
        }
        await pipelineRest()
      }
      if (okCount > 0) ElMessage.success(`已补全 ${okCount} 条全能片段`)
      else ElMessage.warning('全能片段补全未成功，请检查文本模型配置')
    } finally {
      universalOmniPolishRunning.value = false
      universalOmniPolishProgress.value = { current: 0, total: 0, label: '' }
    }
    return
  }

  completingVideoPrompts.value = true
  try {
    const data = await storyboardsAPI.completeMissingVideoPrompts(currentEpisodeId.value)
    await loadDrama()
    const rebuilt = Number(data?.rebuilt) || 0
    const failed = Number(data?.failed) || 0
    if (failed > 0) {
      ElMessage.warning(`视频提示词补全完成：成功 ${rebuilt} 条，失败 ${failed} 条`)
    } else if (rebuilt > 0) {
      ElMessage.success(`已补全 ${rebuilt} 条视频提示词`)
    } else {
      ElMessage.info('没有需要补全的视频提示词')
    }
  } catch (e) {
    ElMessage.error(e.message || '补全视频提示词失败')
  } finally {
    completingVideoPrompts.value = false
  }
}

async function startBatchImageGeneration() {
  if (!currentEpisodeId.value || batchImageRunning.value || pipelineRunning.value) return
  batchImageErrors.value = []
  batchImageStopping.value = false
  batchImageRunning.value = true
  try {
    // 批量前必须拉齐本集全部分镜媒体（按页懒加载时 sbImages 可能只有部分 key，不能靠 length===0 判断）
    await loadStoryboardMedia({ all: true })
    const boards = store.storyboards || []
    const todo = boards.filter((sb) => sbNeedsBatchImage(sb))
    if (todo.length === 0) {
      ElMessage.info('所有分镜均已有图片，无需重新生成')
      return
    }
    batchImageProgress.value = { current: 0, total: todo.length, failed: 0 }
    const concurrency = pipelineConcurrency.value || 3
    let doneCount = 0

    // 并发执行，使用与 pipeline 相同的并发模型
    let queueIdx = 0
    const worker = async () => {
      while (queueIdx < todo.length) {
        if (batchImageStopping.value) break
        const sb = todo[queueIdx++]
        const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
        try {
          let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
          let frameTypeForCreate = gridMode.value !== 'single' ? gridMode.value : undefined
          if (useFirstLast) {
            // 首尾帧模式下，批量生成分镜图也必须走专业首帧提示词（含 layout_description 空间合同、专用 system prompt 等）
            prompt = await ensureProfessionalFramePrompt(sb, 'first')
            frameTypeForCreate = 'storyboard_first'
          }
          const res = await imagesAPI.create({
            storyboard_id: sb.id,
            drama_id: dramaId.value,
            prompt,
            style: getSelectedStyle(),
            frame_type: frameTypeForCreate,
            aspect_ratio: projectAspectRatio.value || '16:9',
          })
          if (res?.task_id) {
            const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(sb.id))
            if (pollRes?.status === 'failed') {
              batchImageErrors.value.push(`#${sb.storyboard_number ?? sb.id}: ${pollRes.error || '生成失败'}`)
              batchImageProgress.value = { ...batchImageProgress.value, failed: batchImageProgress.value.failed + 1 }
            }
          } else {
            await loadSingleStoryboardMedia(sb.id)
          }
          // 成功后清理手动选中，让服务器 first_frame_image_id 成为权威（与单条生成首帧的清理逻辑一致）
          if (useFirstLast) {
            delete sbSelectedImgId.value[sb.id]
          }
        } catch (e) {
          batchImageErrors.value.push(`#${sb.storyboard_number ?? sb.id}: ${e.message || '提交失败'}`)
          batchImageProgress.value = { ...batchImageProgress.value, failed: batchImageProgress.value.failed + 1 }
        }
        doneCount++
        batchImageProgress.value = { ...batchImageProgress.value, current: doneCount }
      }
    }
    await Promise.allSettled(Array.from({ length: Math.min(concurrency, todo.length) }, () => worker()))
    if (!batchImageStopping.value) {
      // 最终统一恢复选中状态，确保所有首帧生成后服务器绑定立即生效（与单条生成路径一致）
      restoreSelectionsFromBackend()
      if (batchImageProgress.value.failed === 0) ElMessage.success(`分镜图批量生成完成（共 ${todo.length} 条）`)
      else ElMessage.warning(`批量完成，${batchImageProgress.value.failed}/${todo.length} 条失败`)
    } else {
      ElMessage.info('批量生成已停止')
    }
  } finally {
    batchImageRunning.value = false
  }
}

async function startBatchVideoGeneration() {
  if (!currentEpisodeId.value || batchVideoRunning.value || pipelineRunning.value) return
  batchVideoErrors.value = []
  batchVideoStopping.value = false
  batchVideoRunning.value = true
  try {
    // 批量前必须拉齐本集全部分镜媒体（按页懒加载时 sbVideos 可能只有部分 key，不能靠 length===0 判断）
    await loadStoryboardMedia({ all: true })
    // 全文解说：先按配音对齐提示词，再筛选可生视频镜头
    if (storyboardFullNarrationVideoMode.value) {
      const ensure = await ensureNarrationPromptsAlignedBeforeVideo()
      if (!ensure.ok && ensure.reason === 'missing_audio') return
      if (!ensure.ok) return
    }
    const boards = store.storyboards || []
    // 只处理：有参考图（经典=分镜主图；全能=场景/角色/道具）且还没有已完成视频的分镜
    const todo = boards.filter((sb) => sbNeedsBatchVideo(sb))
    if (todo.length === 0) {
      const blockedByAudio = boards.filter((sb) => {
        if (!sb?.id || sbHasStoryboardVideo(sb)) return false
        return sbNeedsNarrationAudioBeforeVideo(sb)
      }).length
      const blockedByAlign = boards.filter((sb) => {
        if (!sb?.id || sbHasStoryboardVideo(sb)) return false
        return sbNeedsNarrationPromptAlignBeforeVideo(sb)
      }).length
      if (blockedByAudio > 0) {
        ElMessage.warning(`有 ${blockedByAudio} 镜尚未配音，请先「一键生成配音」后再生成视频`)
      } else if (blockedByAlign > 0) {
        ElMessage.warning(
          storyboardUniversalOmni.value
            ? `有 ${blockedByAlign} 镜尚未按配音润色全能提示词，请先完成步骤 3`
            : `有 ${blockedByAlign} 镜尚未按配音生成提示词，请先完成步骤 3`
        )
      } else {
        ElMessage.info('没有需要生成视频的分镜（缺视频已全部生成，且无标记「要修改」的镜头）')
      }
      return
    }
    const missingTail = countSbMissingNextShotTailFrame(todo)
    if (missingTail > 0) {
      ElMessage.warning(
        `已开首尾帧参考图：${missingTail} 镜因「下一镜尚无分镜图」将仅用首帧提交（末镜除外）。请先生成后续镜的分镜图。`
      )
    }
    batchVideoProgress.value = { current: 0, total: todo.length, failed: 0 }
    // 「首尾帧参考图」= 本镜图为首帧、下一镜图为尾帧，无视频依赖 → 7 路并发
    // 「连贯帧」= 截取上一条已完成视频末帧作下一条首帧（经典）→ 必须串行
    // 「软衔接」= 末帧插入全能参考图第一张 → 必须串行；失败重试 2 次后终止后续
    const hardContiguity = videoFrameContiguity.value && !storyboardUseFirstLastFrame.value
    const softContiguity = !!videoSoftContiguity.value
    const contiguity = hardContiguity || softContiguity
    const videoConcurrency = contiguity ? 1 : BATCH_VIDEO_CONCURRENCY
    const softMaxAttempts = 3 // 首次 + 重试 2 次
    let videoDoneCount = 0
    let prevVideoItem = null  // 连贯帧 / 软衔接串行路径使用
    let softChainAborted = false

    let videoQueueIdx = 0
    const videoWorker = async () => {
      while (videoQueueIdx < todo.length) {
        if (batchVideoStopping.value || softChainAborted) break
        const sb = todo[videoQueueIdx++]
        const universal = isSbUniversalMode(sb.id)
        const omniRefs = universal ? await collectSbOmniReferenceAbsoluteUrlsAsync(sb) : []
        if (!universal && !getSbFirstFrameUrl(sb)) {
          videoDoneCount++
          batchVideoProgress.value = { ...batchVideoProgress.value, current: videoDoneCount }
          continue
        }
        if (universal && !omniRefs.length) {
          videoDoneCount++
          batchVideoProgress.value = { ...batchVideoProgress.value, current: videoDoneCount }
          continue
        }

        const attempts = softContiguity ? softMaxAttempts : 1
        let shotOk = false
        let lastFailMsg = ''

        generatingSbVideoIds.add(sb.id)
        try {
          for (let attempt = 1; attempt <= attempts; attempt++) {
            if (batchVideoStopping.value || softChainAborted) break
            try {
              if (softContiguity && attempt > 1) {
                appendSbVideoLog(
                  sb.id,
                  `软衔接重试 ${attempt - 1}/2 · 等待 ${Math.round(SOFT_CONTIGUITY_RETRY_DELAY_MS / 1000)}s 后换 Key 再提交`
                )
                const waited = await waitMsCancellable(
                  SOFT_CONTIGUITY_RETRY_DELAY_MS,
                  () => batchVideoStopping.value || softChainAborted
                )
                if (!waited) break
              }
              const firstFrameUrl = await getMainImageUrlForVideo(sb)
              const absoluteUrl = universal ? (omniRefs[0] || '') : toAbsoluteImageUrl(firstFrameUrl)
              let contiguityFirstFrameUrl = absoluteUrl
              if (hardContiguity && prevVideoItem && !universal) {
                const uploaded = await captureAndUploadVideoLastFrameAbsUrl(prevVideoItem)
                if (uploaded) contiguityFirstFrameUrl = uploaded
              }
              let softContAbs = ''
              if (softContiguity && prevVideoItem && universal) {
                softContAbs = await captureAndUploadVideoLastFrameAbsUrl(prevVideoItem)
              }
              const { first: vFirst, last: vLast, lastSource } = sbVideoFirstLastUrls(
                sb,
                universal,
                contiguityFirstFrameUrl || undefined
              )
              const imgPayload = buildSbVideoImageSubmitPayload({
                universalOmni: universal,
                universal,
                omniRefs,
                absoluteUrl: contiguityFirstFrameUrl || absoluteUrl,
                vFirst,
                vLast,
                lastSource,
              })
              let promptForApi = buildSbVideoPromptForApi(sb)
              if (softContAbs && universal) {
                const soft = applySoftContiguityToOmniSubmit(
                  imgPayload.reference_image_urls || omniRefs,
                  softContAbs,
                  promptForApi
                )
                if (soft.applied) {
                  imgPayload.reference_image_urls = soft.refs
                  promptForApi = soft.prompt
                  if (attempt === 1) {
                    appendSbVideoLog(sb.id, '软衔接 · 上一镜末帧已置于参考图第1张')
                  }
                }
              }
              appendSbVideoSubmitLog(
                sb.id,
                imgPayload,
                lastSource,
                softContiguity && attempt > 1 ? `批量提交·重试${attempt - 1}` : '批量提交'
              )
              const res = await videosAPI.create({
                drama_id: dramaId.value,
                storyboard_id: sb.id,
                prompt: promptForApi,
                image_url: imgPayload.image_url,
                first_frame_url: imgPayload.first_frame_url,
                last_frame_url: imgPayload.last_frame_url,
                reference_image_urls: imgPayload.reference_image_urls,
                preferred_key_index: nextVideoPreferredKeyIndex(),
                style: getSelectedStyle(),
                aspect_ratio: projectAspectRatio.value || '16:9',
                resolution: videoResolution.value || undefined,
                duration: getSbVideoDurationForApi(sb),
                model: getSbVideoModel(sb.id),
              })
              if (res?.task_id) {
                const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
                appendSbVideoLog(sb.id, `task ${String(res.task_id).slice(0, 36)}`)
                const pollRes = await pollTask(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta, {
                  onTick: makeSbVideoPollOnTick(sb.id),
                })
                if (pollRes?.status === 'failed') {
                  lastFailMsg = pollRes.error || '生成失败'
                  appendSbVideoLog(sb.id, `失败 · ${lastFailMsg}`)
                  continue
                }
                if (pollRes?.status === 'completed') {
                  const postWarn = pollRes?.result?.post_warning
                  if (postWarn) {
                    batchVideoErrors.value.push(`#${sb.storyboard_number ?? sb.id}: 旁白后处理：${postWarn}`)
                    appendSbVideoLog(sb.id, `完成（警告）· ${postWarn}`)
                  } else {
                    appendSbVideoLog(sb.id, '完成')
                  }
                  if (contiguity) {
                    prevVideoItem = getSbCompletedVideoForContiguity(sb.id)
                  }
                  shotOk = true
                  break
                }
                lastFailMsg = pollRes?.error || '未知状态'
              } else {
                await loadSingleStoryboardMedia(sb.id)
                const done = getSbCompletedVideoForContiguity(sb.id)
                if (done) {
                  if (contiguity) prevVideoItem = done
                  shotOk = true
                  break
                }
                lastFailMsg = '未返回 task_id 且无已完成视频'
              }
            } catch (e) {
              lastFailMsg = e.message || '提交失败'
              appendSbVideoLog(sb.id, `异常 · ${lastFailMsg}`)
            }
          }

          if (!shotOk) {
            batchVideoErrors.value.push(
              softContiguity
                ? `#${sb.storyboard_number ?? sb.id}: ${lastFailMsg || '生成失败'}（已重试2次）`
                : `#${sb.storyboard_number ?? sb.id}: ${lastFailMsg || '生成失败'}`
            )
            batchVideoProgress.value = {
              ...batchVideoProgress.value,
              failed: batchVideoProgress.value.failed + 1,
            }
            if (contiguity) prevVideoItem = null
            if (softContiguity) {
              softChainAborted = true
              batchVideoStopping.value = true
              const left = Math.max(0, todo.length - videoDoneCount - 1)
              ElMessage.error(
                `#${sb.storyboard_number ?? sb.id} 软衔接生成失败（已重试2次），已终止后续 ${left} 镜`
              )
            }
          }
        } finally {
          generatingSbVideoIds.delete(sb.id)
        }
        videoDoneCount++
        batchVideoProgress.value = { ...batchVideoProgress.value, current: videoDoneCount }
      }
    }
    await Promise.allSettled(Array.from({ length: Math.min(videoConcurrency, todo.length) }, () => videoWorker()))
    if (softChainAborted) {
      ElMessage.warning(
        `软衔接串行已终止：成功 ${videoDoneCount - batchVideoProgress.value.failed}/${todo.length}，后续未继续`
      )
    } else if (!batchVideoStopping.value) {
      if (batchVideoProgress.value.failed === 0) ElMessage.success(`分镜视频批量生成完成（共 ${todo.length} 条）`)
      else ElMessage.warning(`批量完成，${batchVideoProgress.value.failed}/${todo.length} 条失败`)
    } else {
      ElMessage.info('批量生成已停止')
    }
  } finally {
    batchVideoRunning.value = false
  }
}

function getFinalizeMergeOptions() {
  const useIndexTts = !!videoIndexTtsNarration.value
  return {
    burn_narration_subtitles: !!videoSubtitle.value || useIndexTts,
    burn_dialogue_audio: !!videoBurnDialogue.value,
    watermark_text: videoWatermark.value ? String(videoWatermarkText.value || '').trim().slice(0, 200) : '',
    use_indextts_narration: useIndexTts,
    indextts_voice: String(indexttsVoiceId.value || 'gsv:008').trim(),
    indextts_emotion: String(indexttsEmotionText.value || '自然流畅的解说语气，情绪饱满').trim(),
    indextts_speed: Number(indexttsSpeed.value) || 1.1,
    narration_subtitle_mode: useIndexTts ? 'per_line' : 'per_shot',
    include_intro: !!includeIntroInMerge.value,
    subtitle_auto_align: false,
    subtitle_margin_v: 12,
  }
}

function videoMergePrefsKey(suffix) {
  const epId = currentEpisodeId.value
  return epId ? `episode-${epId}-video-merge-${suffix}` : null
}

function persistVideoMergePrefs() {
  const keys = [
    ['subtitle', videoSubtitle.value],
    ['burn-dialogue', videoBurnDialogue.value],
  ]
  for (const [suffix, val] of keys) {
    const k = videoMergePrefsKey(suffix)
    if (!k) continue
    try { localStorage.setItem(k, String(val)) } catch (_) {}
  }
}

function loadVideoMergePrefs() {
  const subKey = videoMergePrefsKey('subtitle')
  if (!subKey) {
    videoSubtitle.value = true
    return
  }
  try {
    const sub = localStorage.getItem(subKey)
    videoSubtitle.value = sub == null ? true : sub === 'true'
    const dial = localStorage.getItem(videoMergePrefsKey('burn-dialogue'))
    if (dial != null) videoBurnDialogue.value = dial === 'true'
  } catch (_) {
    videoSubtitle.value = true
  }
}

function indexTtsStorageKey(suffix) {
  const epId = currentEpisodeId.value
  return epId ? `episode-${epId}-indextts-${suffix}` : null
}

function persistIndexTtsPrefs() {
  const keys = [
    ['narration', videoIndexTtsNarration.value],
    ['voice', indexttsVoiceId.value],
    ['emotion', indexttsEmotionText.value],
    ['speed', indexttsSpeed.value],
  ]
  for (const [suffix, val] of keys) {
    const k = indexTtsStorageKey(suffix)
    if (!k) continue
    try { localStorage.setItem(k, String(val)) } catch (_) {}
  }
}

function loadIndexTtsPrefs() {
  const narrKey = indexTtsStorageKey('narration')
  if (!narrKey) {
    videoIndexTtsNarration.value = true
    return
  }
  try {
    const narr = localStorage.getItem(narrKey)
    videoIndexTtsNarration.value = narr == null ? true : narr === 'true'
    const voice = localStorage.getItem(indexTtsStorageKey('voice'))
    if (voice) indexttsVoiceId.value = voice
    const emotion = localStorage.getItem(indexTtsStorageKey('emotion'))
    if (emotion) indexttsEmotionText.value = emotion
    const speed = localStorage.getItem(indexTtsStorageKey('speed'))
    if (speed != null && speed !== '') {
      const s = Number(speed)
      if (Number.isFinite(s) && s > 0) indexttsSpeed.value = s
    }
  } catch (_) {
    videoIndexTtsNarration.value = true
  }
}

async function refreshIndexTtsHealth() {
  try {
    const res = await aiVoicesAPI.indexttsHealth()
    indexttsInstallOk.value = !!res?.ok
    indexttsModelLoaded.value = !!res?.loaded
  } catch (_) {
    indexttsInstallOk.value = false
    indexttsModelLoaded.value = false
  }
}

async function loadGsvCatalogVoices() {
  try {
    const res = await aiVoicesAPI.listCloneVoices()
    const list = res?.voices || []
    gsvCatalogVoices.value = Array.isArray(list) ? list : []
    if (!gsvCatalogVoices.value.some((v) => v.voice_id === indexttsVoiceId.value)) {
      const first = gsvCatalogVoices.value[0]
      if (first?.voice_id) indexttsVoiceId.value = first.voice_id
    }
  } catch (_) {
    gsvCatalogVoices.value = []
  }
}

function resetGsvForm() {
  gsvEditingId.value = ''
  gsvForm.voice_id = ''
  gsvForm.voice_name = ''
  gsvForm.ref_audio_path = ''
  gsvForm.prompt_text = ''
  gsvPanelOpen.value = false
}

function openGsvAddPanel() {
  gsvEditingId.value = ''
  gsvForm.voice_id = ''
  gsvForm.voice_name = ''
  gsvForm.ref_audio_path = ''
  gsvForm.prompt_text = ''
  gsvPanelOpen.value = true
}

function closeGsvPanel() {
  resetGsvForm()
}

function editGsvVoice(v) {
  if (!v) return
  gsvEditingId.value = String(v.voice_id || '').replace(/^gsv:/i, '')
  gsvForm.voice_id = gsvEditingId.value
  gsvForm.voice_name = v.voice_name || ''
  gsvForm.ref_audio_path = v.ref_audio_path || ''
  gsvForm.prompt_text = v.prompt_text || ''
  gsvPanelOpen.value = true
}

async function onGsvFilePick(ev) {
  const file = ev?.target?.files?.[0]
  if (!file) return
  try {
    const res = await aiVoicesAPI.uploadRef(file)
    gsvForm.ref_audio_path = res?.ref_audio_path || ''
    ElMessage.success('参考音频已上传')
  } catch (e) {
    ElMessage.error(e.message || '上传失败')
  } finally {
    if (ev?.target) ev.target.value = ''
  }
}

async function saveGsvVoice() {
  if (!gsvForm.voice_id?.trim() || !gsvForm.ref_audio_path?.trim()) {
    ElMessage.warning('请填写音色 ID 并上传参考音频')
    return
  }
  gsvSaving.value = true
  try {
    await aiVoicesAPI.saveCloneVoice({
      voice_id: gsvForm.voice_id.trim(),
      voice_name: gsvForm.voice_name.trim() || gsvForm.voice_id.trim(),
      ref_audio_path: gsvForm.ref_audio_path.trim(),
      prompt_text: gsvForm.prompt_text.trim(),
    })
    ElMessage.success('克隆音色已保存')
    resetGsvForm()
    await loadGsvCatalogVoices()
  } catch (e) {
    ElMessage.error(e.message || '保存失败')
  } finally {
    gsvSaving.value = false
  }
}

async function deleteGsvVoice(v) {
  if (!v) return
  const id = String(v.voice_id || '').replace(/^gsv:/i, '')
  if (!id) return
  try {
    await ElMessageBox.confirm(`确定删除克隆音色「${v.voice_name || id}」？`, '删除确认', { type: 'warning' })
  } catch (_) { return }
  try {
    await aiVoicesAPI.deleteCloneVoice(id)
    ElMessage.success('已删除')
    if (indexttsVoiceId.value === v.voice_id) indexttsVoiceId.value = 'gsv:008'
    await loadGsvCatalogVoices()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  }
}

async function onPreviewIndexTtsVoice() {
  if (!indexttsVoiceId.value) return
  gsvPreviewing.value = true
  try {
    await ensureIndexTtsModelLoaded({ silent: false })
    const res = await aiVoicesAPI.preview({
      local_voice: indexttsVoiceId.value,
      voicebox_instruct: indexttsEmotionText.value,
    })
    const playUrl = res?.audio_url || (res?.local_path ? `/static/${res.local_path}` : '')
    if (!playUrl) throw new Error('无试听地址')
    const a = new Audio(playUrl)
    await a.play()
  } catch (e) {
    ElMessage.error(e.message || '试听失败')
  } finally {
    gsvPreviewing.value = false
  }
}

watch([videoIndexTtsNarration, indexttsVoiceId, indexttsEmotionText, indexttsSpeed], persistIndexTtsPrefs)
watch([videoSubtitle, videoBurnDialogue], persistVideoMergePrefs)
watch(currentEpisodeId, () => {
  loadIndexTtsPrefs()
  persistIndexTtsPrefs()
  loadVideoMergePrefs()
  persistVideoMergePrefs()
  loadBgmLibrary()
  loadFoleyState()
  refreshAceStepStatus()
  syncIntroFormFromEpisode()
})
watch(bgmModel, () => {
  refreshAceStepStatus()
})

async function onGenerateVideo() {
  if (!currentEpisodeId.value) return
  const epId = currentEpisodeId.value
  const did = dramaId.value
  const dramaTitle = store.drama?.title || ''
  const epNum = store.currentEpisode?.episode_number
  const epLabel = dramaTitle ? `${dramaTitle} · 第${epNum ?? ''}集` : `第${epNum ?? ''}集`
  const mergeMeta = {
    dramaId: did,
    episodeId: epId,
    dramaTitle,
    episodeNumber: epNum,
    resourceType: GEN_RESOURCE.EPISODE_MERGE,
    resourceId: epId,
    label: `${epLabel} 合成视频`,
  }
  store.setVideoStatus('generating', did, epId)
  store.setVideoProgress(5, did, epId)
  genStore.markRunning(mergeMeta)
  videoErrorMsg.value = ''
  try {
    const result = await dramaAPI.finalizeEpisode(epId, getFinalizeMergeOptions())
    if (result?.task_id != null) {
      store.setVideoProgress(10, did, epId)
      ElMessage.success(result?.message || '视频合成任务已提交，请稍后查看')
      const pollResult = await pollTask(result.task_id, () => loadDrama(), mergeMeta)
      await loadDrama()
      if (pollResult?.status === 'completed') {
        store.setVideoProgress(100, did, epId)
        const postWarn = pollResult?.result?.post_warning
        const postErr = pollResult?.result?.post_error
        if (currentEpisodeVideoUrl.value) {
          store.setVideoStatus('done', did, epId)
          if (postErr) {
            videoErrorMsg.value = `视频已合成，但配音/字幕后处理失败：${postErr}`
            ElMessage.warning(videoErrorMsg.value)
          } else if (postWarn) {
            ElMessage.warning(postWarn)
          } else {
            ElMessage.success('视频生成完成')
          }
        } else {
          store.setVideoStatus('error', did, epId)
          videoErrorMsg.value = '视频生成完成但未获取到播放地址，请稍后刷新'
          ElMessage.warning(videoErrorMsg.value)
        }
      } else if (pollResult?.status === 'failed') {
        store.setVideoStatus('error', did, epId)
        videoErrorMsg.value = pollResult?.error || '视频生成失败'
      } else if (pollResult?.status === 'timeout') {
        store.setVideoStatus('generating', did, epId)
        videoErrorMsg.value = '任务仍在排队或生成中，请稍后刷新查看'
        ElMessage.warning(videoErrorMsg.value)
      }
    } else {
      store.setVideoStatus('error', did, epId)
      const msg = result?.message || '本集没有可合成的视频片段'
      videoErrorMsg.value = msg
      ElMessage.warning(msg)
    }
  } catch (e) {
    videoErrorMsg.value = e.message || '生成失败'
    store.setVideoStatus('error', did, epId)
  } finally {
    if (store.getVideoStatus(did, epId) !== 'generating') {
      genStore.markDone(mergeMeta)
    }
  }
}

/** 无 task_id 时轮询刷新直到资源出现图片或超时（用于角色/道具/场景图生成） */
async function pollUntilResourceHasImage(checker, maxAttempts = 20, intervalMs = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs))
    await loadDrama()
    if (checker()) return
  }
}

function resolvePollMeta(meta = {}) {
  return {
    dramaId: meta.dramaId ?? dramaId.value,
    episodeId: meta.episodeId ?? currentEpisodeId.value,
    dramaTitle: meta.dramaTitle ?? store.drama?.title,
    episodeNumber: meta.episodeNumber ?? store.currentEpisode?.episode_number,
    resourceType: meta.resourceType || 'unknown',
    resourceId: meta.resourceId,
    label: meta.label,
    ...meta,
  }
}

function pollTask(taskId, onDone, meta = {}, options = {}) {
  return genStore.pollTask(taskId, resolvePollMeta(meta), onDone, { ElMessage, ...options })
}

/** 一键生成视频：暂停时等待，返回 { paused: true } 表示被暂停中断 */
function pollTaskWithPause(taskId, onDone, meta = {}) {
  const resolvedMeta = resolvePollMeta(meta)
  const trackInStore = resolvedMeta.resourceType !== 'unknown' && resolvedMeta.resourceId != null
  if (trackInStore && taskId) {
    genStore.markRunning({ ...resolvedMeta, taskId })
  }
  const maxAttempts = 450  // 450 × 2s = 15 分钟
  const interval = 2000
  let attempts = 0
  return new Promise((resolve, reject) => {
    const finishStore = (status, error) => {
      if (!trackInStore || !taskId) return
      if (status === 'completed') genStore.markDone({ ...resolvedMeta, taskId })
      else genStore.markFailed({ ...resolvedMeta, taskId }, error || '任务失败')
    }
    const tick = async () => {
      if (pipelineAbortRequested.value) {
        finishStore('failed', '全流程已取消')
        reject(Object.assign(new Error('全流程已取消'), { pipelineAborted: true }))
        return
      }
      if (pipelinePaused.value) {
        resolve({ paused: true })
        return
      }
      attempts++
      try {
        const t = await taskAPI.get(taskId)
        if (pipelineAbortRequested.value) {
          finishStore('failed', '全流程已取消')
          reject(Object.assign(new Error('全流程已取消'), { pipelineAborted: true }))
          return
        }
        if (t.status === 'completed') {
          if (onDone) await onDone()
          finishStore('completed')
          resolve({ status: 'completed', result: t.result })
          return
        }
        if (t.status === 'failed') {
          const errMsg = (t.error || t.message || '任务失败').trim()
          finishStore('failed', errMsg)
          resolve({ status: 'failed', error: errMsg })
          return
        }
      } catch (pollErr) {
        console.warn('[pollTaskWithPause] poll attempt failed:', pollErr?.message)
      }
      if (attempts < maxAttempts) setTimeout(tick, interval)
      else {
        const timeoutMsg = '任务查询超时（超过15分钟）'
        finishStore('failed', timeoutMsg)
        resolve({ status: 'timeout', error: timeoutMsg })
      }
    }
    setTimeout(tick, interval)
  })
}

function waitForResume() {
  return new Promise((resolve) => {
    pipelineResolveResume = resolve
  })
}

function onPipelineResume() {
  pipelinePaused.value = false
  if (pipelineResolveResume) {
    pipelineResolveResume()
    pipelineResolveResume = null
  }
}

function addPipelineError(step, message) {
  const time = new Date().toLocaleTimeString('zh-CN')
  pipelineErrorLog.value = [...pipelineErrorLog.value, { time, step, message }]
}

async function checkPause() {
  if (pipelineAbortRequested.value) {
    throw Object.assign(new Error('全流程已取消'), { pipelineAborted: true })
  }
  while (pipelinePaused.value) {
    if (pipelineAbortRequested.value) {
      throw Object.assign(new Error('全流程已取消'), { pipelineAborted: true })
    }
    await waitForResume()
  }
}

/** 每生成好一个图片或内容后休息，防止任务队列过紧 */
function pipelineRest() {
  return new Promise((r) => setTimeout(r, 1000))
}

/** 可取消的等待（软衔接重试 1 分钟等）；每秒检查停止标志 */
async function waitMsCancellable(ms, shouldAbort) {
  const end = Date.now() + Math.max(0, Number(ms) || 0)
  while (Date.now() < end) {
    if (typeof shouldAbort === 'function' && shouldAbort()) return false
    await new Promise((r) => setTimeout(r, Math.min(1000, end - Date.now())))
  }
  return !(typeof shouldAbort === 'function' && shouldAbort())
}

/** 跳过倒计时，立即进入下一阶段 */
function skipPipelineCountdown() {
  pipelineCountdown.value = 0
}

/** 阶段间倒计时，支持暂停冻结 + 立即跳过 */
async function runPipelineCountdown(totalSeconds, msg) {
  pipelineCountdown.value = totalSeconds
  pipelineCountdownMsg.value = msg
  try {
    while (pipelineCountdown.value > 0) {
      await checkPause()                              // 暂停时冻结在此
      await new Promise((r) => setTimeout(r, 1000))  // 等 1 秒
      if (pipelineCountdown.value > 0) pipelineCountdown.value--
    }
  } finally {
    pipelineCountdown.value = 0
    pipelineCountdownMsg.value = ''
  }
}

/** 执行可失败步骤，失败时重试最多 maxRetries 次；fn 返回 { paused: true } 表示暂停不重试；返回 true 表示成功；抛错会触发重试 */
async function pipelineWithRetry(stepName, fn, maxRetries = 3, retryDelayMs = 1000) {
  let lastErr
  for (let r = 0; r < maxRetries; r++) {
    try {
      const result = await fn()
      if (result && result.paused === true) return result
      return true
    } catch (e) {
      lastErr = e
      if (r < maxRetries - 1) {
        if (retryDelayMs > 1000) {
          const ok = await waitMsCancellable(retryDelayMs, () => pipelineAbortRequested.value)
          if (!ok) break
        } else {
          await pipelineRest()
        }
      }
    }
  }
  addPipelineError(stepName, '重试3次均失败: ' + (lastErr?.message || String(lastErr)))
  return false
}

async function startOneClickPipeline() {
  if (!currentEpisodeId.value || pipelineRunning.value) return
  trackFilmCreateAction('one_click_generate_start')
  pipelineErrorLog.value = []
  pipelineCurrentStep.value = ''
  pipelineStepIndex.value = 0
  pipelineActiveTasks.clear()
  pipelineStepTotal.value = 9
  pipelineRunning.value = true
  pipelinePaused.value = false
  pipelineAbortRequested.value = false
  try {
    await runOneClickPipeline(false)
  } catch (e) {
    if (!e?.pipelineAborted) throw e
  } finally {
    pipelineRunning.value = false
    pipelineActiveTasks.clear()
  }
}

async function startStoryboardScriptPipeline() {
  if (!currentEpisodeId.value || pipelineRunning.value) return
  trackFilmCreateAction('storyboard_script_generate_start')
  pipelineErrorLog.value = []
  pipelineCurrentStep.value = ''
  pipelineStepIndex.value = 0
  pipelineActiveTasks.clear()
  pipelineStepTotal.value = 7
  pipelineRunning.value = true
  pipelinePaused.value = false
  pipelineAbortRequested.value = false
  try {
    await runOneClickPipeline(true, 'storyboard_script')
    if (!pipelineErrorLog.value.length) {
      trackFilmCreateAction('storyboard_script_generate_complete')
    }
  } catch (e) {
    if (!e?.pipelineAborted) throw e
    trackFilmCreateAction('storyboard_script_generate_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
  } finally {
    pipelineRunning.value = false
    pipelineActiveTasks.clear()
  }
}

async function startTextFrameworkPipeline() {
  if (!currentEpisodeId.value || pipelineRunning.value) return
  pipelineErrorLog.value = []
  pipelineCurrentStep.value = ''
  pipelineStepIndex.value = 0
  pipelineActiveTasks.clear()
  pipelineStepTotal.value = 4
  pipelineRunning.value = true
  pipelinePaused.value = false
  pipelineAbortRequested.value = false
  try {
    await runOneClickPipeline(true, 'framework')
  } catch (e) {
    if (!e?.pipelineAborted) throw e
  } finally {
    pipelineRunning.value = false
    pipelineActiveTasks.clear()
  }
}

function setPipelineStep(idx, text) {
  pipelineStepIndex.value = idx
  pipelineCurrentStep.value = `[步骤 ${idx}/${pipelineStepTotal.value}] ${text}`
}

/** 流水线配音步骤：分镜脚本完成后必须先配音，再生成提示词/图/视频 */
async function runPipelineNarrationTtsStep(opts = {}) {
  const { onlyMissing = true, stepIndex = 5 } = opts
  const setStatus = (text) => {
    if (stepIndex != null) setPipelineStep(stepIndex, text)
    else pipelineCurrentStep.value = text
  }
  await checkPause()

  // 全文解说成片：强制走配音，避免跳过导致后续提示词/视频配音错乱
  if (storyboardFullNarrationVideoMode.value) {
    storyboardIncludeNarration.value = true
    videoIndexTtsNarration.value = true
  }

  if (!storyboardIncludeNarration.value || !videoIndexTtsNarration.value) {
    setStatus('跳过配音（未开启旁白或 IndexTTS）')
    if (storyboardFullNarrationVideoMode.value) {
      addPipelineError('配音', '全文解说模式必须开启旁白配音，已无法跳过')
    }
    return
  }
  const targets = getNarrationTtsTargets(onlyMissing)
  if (!targets.length) {
    setStatus(onlyMissing ? '配音已齐全，跳过' : '跳过配音（无旁白文本）')
    return
  }
  setStatus(`生成旁白配音（${targets.length} 镜，GPU 串行）...`)
  batchNarrationTtsRunning.value = true
  let okCount = 0
  let failCount = 0
  let modelLoadedByPipeline = false
  try {
    setStatus('加载配音模型...')
    await ensureIndexTtsModelLoaded({ silent: true })
    modelLoadedByPipeline = true
    setStatus(`生成旁白配音（${targets.length} 镜，GPU 串行）...`)
    for (const sb of targets) {
      await checkPause()
      const text = collapseNarrationBlankLines((sbNarration.value[sb.id] ?? sb.narration) || '')
      if (!text) continue
      if ((sbNarration.value[sb.id] || '') !== text) {
        sbNarration.value = { ...sbNarration.value, [sb.id]: text }
      }
      const sbLabel = sb.storyboard_number ?? sb.id
      const result = await requestNarrationTtsForSb(sb.id, text, {
        onRetry: (attempt, err) => {
          setStatus(`镜#${sbLabel} 配音重试 ${attempt}/${NARRATION_TTS_MAX_RETRIES}…`)
          addPipelineError('配音', `镜#${sbLabel}: ${err?.message || err}（重试 ${attempt}/${NARRATION_TTS_MAX_RETRIES}）`)
        },
      })
      if (result.aborted) return
      if (!result.ok) {
        failCount += 1
        addPipelineError('配音', `镜#${sbLabel}: ${result.error || '解说配音失败'}（已重试${NARRATION_TTS_MAX_RETRIES}次）`)
        continue
      }
      applySbNarrationAudioPath(sb.id, result.local_path, result.duration)
      okCount += 1
    }
    if (failCount > 0 && okCount === 0) {
      addPipelineError('配音', `全部镜配音失败（各镜已重试${NARRATION_TTS_MAX_RETRIES}次），后续将跳过未配音镜继续`)
    } else if (failCount > 0) {
      addPipelineError('配音', `${failCount} 镜配音失败（已重试${NARRATION_TTS_MAX_RETRIES}次），已跳过继续`)
    }
  } catch (e) {
    addPipelineError('配音', e.message || String(e))
  } finally {
    if (modelLoadedByPipeline) {
      try {
        await unloadIndexTtsModelUi({ silent: true })
      } catch (_) {}
    }
    batchNarrationTtsRunning.value = false
  }
  const stillMissing = getNarrationTtsTargets(true).length
  if (storyboardFullNarrationVideoMode.value && stillMissing > 0) {
    addPipelineError('配音', `仍有 ${stillMissing} 镜未配音；后续将按已配音镜头继续，未配音镜不会生视频`)
  }
  await pipelineRest()
}

/** 流水线提示词步骤：全文解说须在配音之后做提示词优化（按配音时长生成/润色） */
async function runPipelinePromptsStep(opts = {}) {
  const { stepIndex = 6 } = opts
  const setStatus = (text) => {
    if (stepIndex != null) setPipelineStep(stepIndex, text)
    else pipelineCurrentStep.value = text
  }
  await checkPause()
  const episodeId = currentEpisodeId.value
  if (!episodeId) return

  // 全文解说：配音完成后必须走提示词优化（与手动「一键生成配音」后续同序）
  if (storyboardFullNarrationVideoMode.value) {
    const missingAudio = getNarrationTtsTargets(true).length
    if (missingAudio > 0) {
      addPipelineError(
        '提示词优化',
        `还有 ${missingAudio} 镜未配音；将仅为已配音镜头做提示词优化，未配音镜不会生视频`
      )
      setStatus(`提示词优化（跳过 ${missingAudio} 镜未配音）...`)
    }

    if (storyboardUniversalOmni.value) {
      setStatus('提示词优化：按配音同步时长并润色全能提示词...')
      generatingPromptsFromAudio.value = true
      try {
        const data = await storyboardsAPI.generatePromptsFromAudioDuration(episodeId, { force: true })
        await refreshStoryboardsForEpisode(episodeId, { storyboards: data?.storyboards })
      } catch (e) {
        addPipelineError('同步配音时长', e.message || String(e))
      } finally {
        generatingPromptsFromAudio.value = false
      }
      await polishUniversalSegmentsAfterGeneration({
        checkPause,
        onlyUnaligned: true,
        onlyWithNarrationAudio: true,
        generateIfEmpty: true,
        onShotProgress: (cur, total, sb) =>
          setStatus(`提示词优化·全能(${cur}/${total}) #${sb.storyboard_number ?? cur}`),
        onShotError: (sb, msg) =>
          addPipelineError('全能提示词', `镜#${sb.storyboard_number ?? sb.id}: ${msg}`),
      })
      await loadDrama()
      await pipelineRest()
      return
    }

    if (missingAudio > 0 && missingAudio === (store.storyboards || []).filter((sb) => {
      const text = ((sbNarration.value[sb.id] ?? sb.narration) || '').toString().trim()
      return !!text
    }).length) {
      setStatus(`跳过提示词优化（全部有旁白镜均未配音）`)
      return
    }

    setStatus('提示词优化：按配音时长生成生图/视频提示词...')
    generatingPromptsFromAudio.value = true
    try {
      const data = await storyboardsAPI.generatePromptsFromAudioDuration(episodeId, { force: true })
      await refreshStoryboardsForEpisode(episodeId, { storyboards: data?.storyboards })
      const failed = Number(data?.failed) || 0
      if (failed > 0) addPipelineError('提示词优化', `${failed} 镜失败`)
    } catch (e) {
      addPipelineError('提示词优化', e.message || String(e))
    } finally {
      generatingPromptsFromAudio.value = false
    }
    await pipelineRest()
    return
  }

  await loadDrama()
  let boards = store.storyboards || []
  const expectImageAi = !(storyboardFullNarrationVideoMode.value && storyboardUniversalOmni.value)
  const imageRemaining = expectImageAi
    ? boards.filter((sb) => !sbIsUniversal(sb) && !sbHasAiImagePrompt(sb)).length
    : 0
  const videoRemaining = storyboardUniversalOmni.value
    ? boards.filter((sb) => sbIsUniversal(sb) && !sbUniversalSegmentReady(sb)).length
    : boards.filter((sb) => !sbIsUniversal(sb) && !sbHasVideoPrompt(sb)).length

  if (imageRemaining === 0 && videoRemaining === 0) {
    setStatus('提示词已就绪，跳过')
    return
  }

  setStatus(`生成提示词（生图 ${imageRemaining} · 视频/全能 ${videoRemaining}）...`)

  if (imageRemaining > 0) {
    completingImagePrompts.value = true
    try {
      const data = await storyboardsAPI.completeMissingImagePrompts(episodeId)
      await loadDrama()
      boards = store.storyboards || []
      const failed = Number(data?.failed) || 0
      if (failed > 0) addPipelineError('生图提示词', `${failed} 条失败`)
      if (data?.skipped_reason === 'no_text_model') addPipelineError('生图提示词', '未配置文本模型')
    } catch (e) {
      addPipelineError('生图提示词', e.message || String(e))
    } finally {
      completingImagePrompts.value = false
    }
  }

  if (storyboardUniversalOmni.value) {
    // 仅补全空缺：用「生成」而非「润色」，避免对已有片段描述再调一次 AI
    const uniTargets = boards.filter((sb) => sbIsUniversal(sb) && !sbUniversalSegmentReady(sb))
    if (uniTargets.length) {
      universalOmniPolishRunning.value = true
      universalOmniPolishAbort.value = false
      universalOmniPolishProgress.value = { current: 0, total: uniTargets.length, label: '' }
      try {
        for (let i = 0; i < uniTargets.length; i++) {
          if (universalOmniPolishAbort.value) break
          await checkPause()
          const sb = uniTargets[i]
          const cur = i + 1
          universalOmniPolishProgress.value = {
            current: cur,
            total: uniTargets.length,
            label: '#' + (sb.storyboard_number ?? cur),
          }
          setStatus(`补全全能片段(${cur}/${uniTargets.length}) #${sb.storyboard_number ?? cur}`)
          try {
            await onGenerateUniversalSegmentPrompt(sb, { silent: true })
          } catch (e) {
            addPipelineError('全能片段', `镜#${sb.storyboard_number ?? sb.id}: ${e?.message || e}`)
          }
          await pipelineRest()
        }
      } finally {
        universalOmniPolishRunning.value = false
        universalOmniPolishProgress.value = { current: 0, total: 0, label: '' }
      }
      await loadDrama()
    }
  } else if (videoRemaining > 0) {
    completingVideoPrompts.value = true
    try {
      const data = await storyboardsAPI.completeMissingVideoPrompts(episodeId)
      await loadDrama()
      const failed = Number(data?.failed) || 0
      if (failed > 0) addPipelineError('视频提示词', `${failed} 条失败`)
    } catch (e) {
      addPipelineError('视频提示词', e.message || String(e))
    } finally {
      completingVideoPrompts.value = false
    }
  }

  await pipelineRest()
}

async function runOneClickPipeline(textOnly = false, textOnlyVariant = 'framework') {
  const episodeId = currentEpisodeId.value
  const dramaIdVal = dramaId.value
  if (!episodeId || !dramaIdVal) return
  const style = getSelectedStyle()
  const stopAfterStep = textOnly
    ? (textOnlyVariant === 'storyboard_script' ? 7 : 4)
    : null
  const assetImageConcurrency = pipelineConcurrency.value

  try {
    // ════════════════════════════════════════════════════════
    // 阶段一：内容提取 & 分镜生成（快速、低成本）
    // ════════════════════════════════════════════════════════

    // 步骤 1：提取角色
    await checkPause()
    let chars = store.currentEpisode?.characters ?? []
    if (chars.length === 0) {
      setPipelineStep(1, '提取角色...')
      try {
        const outline = (store.scriptContent || '').toString().trim() || (storyInput.value || '').toString().trim() || undefined
        const res = await generationAPI.generateCharacters(dramaIdVal, { episode_id: store.currentEpisode?.id ?? undefined, outline: outline || undefined })
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('提取角色', result.error); return }
        } else {
          await loadDrama()
        }
        await pipelineRest()
      } catch (e) {
        addPipelineError('提取角色', e.message || String(e))
        return
      }
      chars = store.currentEpisode?.characters ?? []
    } else {
      setPipelineStep(1, `已有 ${chars.length} 个角色，跳过提取`)
    }

    // 步骤 2：提取场景
    await checkPause()
    let sceneList = store.currentEpisode?.scenes ?? []
    if (sceneList.length === 0) {
      setPipelineStep(2, '提取场景...')
      try {
        const res = await dramaAPI.extractBackgrounds(episodeId, { model: getSelectedTextModel(), style, language: scriptLanguage.value })
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('提取场景', result.error); return }
        } else {
          await loadDrama()
        }
        await pipelineRest()
      } catch (e) {
        addPipelineError('提取场景', e.message || String(e))
        return
      }
      sceneList = store.currentEpisode?.scenes ?? []
    } else {
      setPipelineStep(2, `已有 ${sceneList.length} 个场景，跳过提取`)
    }

    // 步骤 3：提取道具
    await checkPause()
    let propList = store.props ?? []
    if (propList.length === 0) {
      setPipelineStep(3, '提取道具...')
      try {
        const res = await propAPI.extractFromScript(episodeId)
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('提取道具', result.error); return }
        } else {
          await loadDrama()
        }
        await pipelineRest()
      } catch (e) {
        addPipelineError('提取道具', e.message || String(e))
        // 道具提取失败不中断流程
      }
      propList = store.props ?? []
    } else {
      setPipelineStep(3, `已有 ${propList.length} 个道具，跳过提取`)
    }

    // 步骤 4：生成分镜脚本
    await checkPause()
    await loadStoryboardMedia({ all: true })
    let boards = store.storyboards || []
    const hadBoardsBeforeStep4 = boards.length > 0
    if (boards.length === 0) {
      setPipelineStep(4, '生成分镜脚本...')
      // 与手动生成一样，每 2 秒刷新一次分镜列表，让已解析的分镜逐步显示
      const sbRefreshTimer = setInterval(
        () => refreshStoryboardsForEpisode(currentEpisodeId.value, { light: true }),
        2000
      )
      try {
        const res = await dramaAPI.generateStoryboard(episodeId, buildStoryboardGenerateOptions({
          style,
        }))
        const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { clearInterval(sbRefreshTimer); await waitForResume(); return }
          if (result?.error) {
            // 任务失败，但后端可能已保存了部分分镜，确保最新状态显示出来再停止
            await loadDrama()
            addPipelineError('生成分镜', result.error)
            clearInterval(sbRefreshTimer)
            return
          }
          if (result?.result?.truncated) {
            sbTruncatedWarning.value = true
            sbTruncatedDismissed.value = false
          }
        }
        await loadDrama()
        await pipelineRest()
      } catch (e) {
        addPipelineError('生成分镜', e.message || String(e))
        clearInterval(sbRefreshTimer)
        return
      }
      clearInterval(sbRefreshTimer)
      await loadStoryboardMedia({ all: true })
      boards = store.storyboards || []
    } else {
      setPipelineStep(4, `已有 ${boards.length} 个分镜，跳过生成`)
    }

    const generatedSbThisPipeline = !hadBoardsBeforeStep4
    // 全能片段已在分镜生成时写入，流水线不再二次自动润色；全文解说+全能仍等配音后手动/步骤润色
    if (generatedSbThisPipeline && storyboardUniversalOmni.value && !storyboardFullNarrationVideoMode.value) {
      setPipelineStep(4, `已生成 ${boards.length} 个全能分镜（片段描述已写入）`)
    }

    if (stopAfterStep === 4) {
      pipelineCurrentStep.value = '文本框架已就绪（未生成配音、提示词、图片与视频）'
      ElMessage.success('文本框架已生成：角色、场景、道具与分镜脚本已就绪')
      return
    }

    // ════════════════════════════════════════════════════════
    // 分镜工作流（固定顺序）：配音 → 按配音补全提示词 → 生图 → 生视频 → 合成
    // ════════════════════════════════════════════════════════

    await runPipelineCountdown(20, '分镜脚本生成完毕，请浏览确认内容。倒计时结束后将先配音，再自动做提示词优化。')
    await checkPause()

    await runPipelineNarrationTtsStep({ onlyMissing: true, stepIndex: 5 })
    await checkPause()
    await runPipelinePromptsStep({ stepIndex: 6 })

    await runPipelineCountdown(30, '配音与提示词优化已就绪，请确认。倒计时结束后将开始生图（角色/场景/道具/分镜图）。')
    await checkPause()

    // ════════════════════════════════════════════════════════
    // 步骤 7：生图（角色 / 场景 / 道具 / 分镜图）
    // ════════════════════════════════════════════════════════

    // 7a：生成角色图
    {
      const charsWithoutImage = chars.filter((c) => !hasAssetImage(c))
      const concurrency = assetImageConcurrency
      setPipelineStep(7, `生成角色图（${charsWithoutImage.length} 个，并发 ${concurrency}）...`)
      const { paused } = await runConcurrently(charsWithoutImage, concurrency, async (char) => {
        await checkPause()
        generatingCharIds.add(char.id)
        try {
          const stepName = '角色图 ' + (char.name || char.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const res = await characterAPI.generateImage(char.id, getSelectedImageModel(), style)
            const taskId = res?.image_generation?.task_id ?? res?.task_id
            if (taskId) {
              const result = await pollTaskWithPause(taskId, () => loadDrama())
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else {
              await loadDrama()
              await pollUntilResourceHasImage(() => {
                const list = store.currentEpisode?.characters ?? []
                const c = list.find((x) => Number(x.id) === Number(char.id))
                return !!(c && (c.image_url || c.local_path))
              })
            }
          })
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
        } finally {
          generatingCharIds.delete(char.id)
        }
      }, { getLabel: (char) => '角色图 ' + (char.name || char.id) })
      if (paused) { await waitForResume() }
    }

    // 7b：生成场景图
    {
      const scenesWithoutImage = sceneList.filter((s) => !hasAssetImage(s))
      const concurrency = assetImageConcurrency
      setPipelineStep(7, `生成场景图（${scenesWithoutImage.length} 个，并发 ${concurrency}）...`)
      await checkPause()
      const { paused } = await runConcurrently(scenesWithoutImage, concurrency, async (scene) => {
        await checkPause()
        generatingSceneIds.add(scene.id)
        try {
          const stepName = '场景图 ' + (scene.location || scene.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const useQuad = !!sceneUseQuadGrid.value
            const res = await sceneAPI.generateImage({ scene_id: scene.id, model: getSelectedImageModel(), style, use_quad_grid: useQuad })
            const taskId = res?.image_generation?.task_id ?? res?.task_id
            if (taskId) {
              const result = await pollTaskWithPause(taskId, () => loadDrama())
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else {
              await loadDrama()
              await pollUntilResourceHasImage(() => {
                const list = store.currentEpisode?.scenes ?? []
                const s = list.find((x) => Number(x.id) === Number(scene.id))
                return !!(s && (s.image_url || s.local_path))
              })
            }
          })
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
        } finally {
          generatingSceneIds.delete(scene.id)
        }
      }, { getLabel: (scene) => '场景图 ' + (scene.location || scene.id) })
      if (paused) { await waitForResume() }
    }

    // 7c：生成道具图
    {
      const propsWithoutImage = propList.filter((p) => !hasAssetImage(p))
      const concurrency = assetImageConcurrency
      setPipelineStep(7, `生成道具图（${propsWithoutImage.length} 个，并发 ${concurrency}）...`)
      await checkPause()
      const { paused } = await runConcurrently(propsWithoutImage, concurrency, async (prop) => {
        await checkPause()
        generatingPropIds.add(prop.id)
        try {
          const stepName = '道具图 ' + (prop.name || prop.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const res = await propAPI.generateImage(prop.id, getSelectedImageModel(), style)
            const taskId = res?.image_generation?.task_id ?? res?.task_id
            if (taskId) {
              const result = await pollTaskWithPause(taskId, () => loadDrama())
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else {
              await loadDrama()
              await pollUntilResourceHasImage(() => {
                const list = store.props ?? []
                const p = list.find((x) => Number(x.id) === Number(prop.id))
                return !!(p && (p.image_url || p.local_path))
              })
            }
          })
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
        } finally {
          generatingPropIds.delete(prop.id)
        }
      }, { getLabel: (prop) => '道具图 ' + (prop.name || prop.id) })
      if (paused) { await waitForResume() }
    }

    // 7d：生成分镜图
    {
      await loadStoryboardMedia({ all: true })
      boards = store.storyboards || []
      const boardsWithoutImg = boards.filter((sb) => sbNeedsBatchImage(sb))
      const concurrency = pipelineConcurrency.value
      setPipelineStep(7, `生成分镜图（${boardsWithoutImg.length} 个，并发 ${concurrency}）...`)
      const { paused } = await runConcurrently(boardsWithoutImg, concurrency, async (sb) => {
        await checkPause()
        generatingSbImageIds.add(sb.id)
        try {
          const stepName = '分镜图 #' + (sb.storyboard_number ?? sb.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
            let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
            let frameTypeForCreate = undefined
            if (useFirstLast) {
              prompt = await ensureProfessionalFramePrompt(sb, 'first')
              frameTypeForCreate = 'storyboard_first'
            }
            const res = await imagesAPI.create({
              storyboard_id: sb.id,
              drama_id: dramaIdVal,
              prompt,
              model: getSelectedImageModel(),
              style,
              frame_type: frameTypeForCreate,
              aspect_ratio: projectAspectRatio.value || '16:9',
            })
            if (res?.task_id) {
              const result = await pollTaskWithPause(res.task_id, () => loadSingleStoryboardMedia(sb.id))
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else await loadSingleStoryboardMedia(sb.id)
          })
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
        } finally {
          generatingSbImageIds.delete(sb.id)
        }
      }, { getLabel: (sb) => '分镜图 #' + (sb.storyboard_number ?? sb.id) })
      if (paused) { await waitForResume() }
    }

    if (stopAfterStep === 7) {
      pipelineCurrentStep.value = '分镜脚本与图片已就绪（未生成分镜视频与成片）'
      ElMessage.success('分镜脚本流程已完成：提取、分镜、配音、提示词与图片均已生成（未生成视频）')
      return
    }

    await runPipelineCountdown(20, '分镜图生成完毕，请浏览确认图片效果。倒计时结束后将开始生成分镜视频（消耗最多 Token）。')
    await checkPause()

    // ════════════════════════════════════════════════════════
    // 步骤 8：生成分镜视频
    // ════════════════════════════════════════════════════════

    // 步骤 8：生成分镜视频
    {
      await loadStoryboardMedia({ all: true })
      if (storyboardFullNarrationVideoMode.value) {
        setPipelineStep(8, '生视频前检查：按配音提示词是否已对齐…')
        const ensure = await ensureNarrationPromptsAlignedBeforeVideo({ silent: true })
        if (!ensure.ok && ensure.reason === 'missing_audio') {
          addPipelineError('分镜视频', `还有 ${ensure.missingAudio || 0} 镜未配音，已跳过生视频`)
        }
      }
      const boards2 = (store.storyboards || []).filter((sb) => {
        if (sbHasCompletedVideo(sb.id)) return false
        if (sbNeedsNarrationAudioBeforeVideo(sb)) return false
        if (sbNeedsNarrationPromptAlignBeforeVideo(sb)) return false
        if (isSbUniversalMode(sb.id)) {
          if (!sbCanSubmitVideo(sb)) return false
          return collectSbOmniReferenceAbsoluteUrls(sb).length > 0
        }
        if (!sbCanSubmitVideo(sb)) return false
        return !!getSbFirstFrameUrl(sb)
      })
      const blockedAudioCount = (store.storyboards || []).filter((sb) => {
        if (sbHasCompletedVideo(sb.id)) return false
        return sbNeedsNarrationAudioBeforeVideo(sb)
      }).length
      const blockedAlignCount = (store.storyboards || []).filter((sb) => {
        if (sbHasCompletedVideo(sb.id)) return false
        return sbNeedsNarrationPromptAlignBeforeVideo(sb)
      }).length
      if (blockedAudioCount > 0) {
        addPipelineError(
          '分镜视频',
          `跳过 ${blockedAudioCount} 镜：尚未配音（请先一键生成配音）`
        )
      }
      if (blockedAlignCount > 0) {
        addPipelineError(
          '分镜视频',
          `跳过 ${blockedAlignCount} 镜：尚未按配音完成提示词优化`
        )
      }
      const missingTailPipeline = countSbMissingNextShotTailFrame(boards2)
      if (missingTailPipeline > 0) {
        addPipelineError(
          '分镜视频',
          `首尾帧已开：${missingTailPipeline} 镜因下一镜尚无分镜图将仅用首帧提交（末镜除外）`
        )
      }
      const softContiguityPipe = !!videoSoftContiguity.value
      const hardContiguityPipe = videoFrameContiguity.value && !storyboardUseFirstLastFrame.value
      const concurrency = softContiguityPipe || hardContiguityPipe ? 1 : BATCH_VIDEO_CONCURRENCY
      let prevVideoItemPipe = null
      setPipelineStep(8, `生成分镜视频（${boards2.length} 个，${concurrency === 1 ? '串行衔接' : `并发 ${concurrency}`}）...`)
      const { paused, aborted } = await runConcurrently(boards2, concurrency, async (sb) => {
        await checkPause()
        generatingSbVideoIds.add(sb.id)
        try {
          const stepName = '分镜视频 #' + (sb.storyboard_number ?? sb.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const universal = isSbUniversalMode(sb.id)
            const omniRefs = universal ? await collectSbOmniReferenceAbsoluteUrlsAsync(sb) : []
            const firstFrameUrl = await getMainImageUrlForVideo(sb)
            let absoluteUrl = universal ? (omniRefs[0] || '') : toAbsoluteImageUrl(firstFrameUrl)
            if (hardContiguityPipe && prevVideoItemPipe && !universal) {
              const uploaded = await captureAndUploadVideoLastFrameAbsUrl(prevVideoItemPipe)
              if (uploaded) absoluteUrl = uploaded
            }
            const { first: vFirst, last: vLast, lastSource } = sbVideoFirstLastUrls(sb, universal, absoluteUrl || null)
            const imgPayload = buildSbVideoImageSubmitPayload({
              universalOmni: universal,
              universal,
              omniRefs,
              absoluteUrl,
              vFirst,
              vLast,
              lastSource,
            })
            let promptForApi = buildSbVideoPromptForApi(sb)
            if (softContiguityPipe && universal && prevVideoItemPipe) {
              const softContAbs = await captureAndUploadVideoLastFrameAbsUrl(prevVideoItemPipe)
              if (softContAbs) {
                const soft = applySoftContiguityToOmniSubmit(
                  imgPayload.reference_image_urls || omniRefs,
                  softContAbs,
                  promptForApi
                )
                if (soft.applied) {
                  imgPayload.reference_image_urls = soft.refs
                  promptForApi = soft.prompt
                }
              }
            }
            appendSbVideoSubmitLog(sb.id, imgPayload, lastSource, '成片提交')
            const res = await videosAPI.create({
              drama_id: dramaIdVal,
              storyboard_id: sb.id,
              prompt: promptForApi,
              image_url: imgPayload.image_url,
              first_frame_url: imgPayload.first_frame_url,
              last_frame_url: imgPayload.last_frame_url,
              reference_image_urls: imgPayload.reference_image_urls,
              preferred_key_index: nextVideoPreferredKeyIndex(),
              style,
              aspect_ratio: projectAspectRatio.value || '16:9',
              resolution: videoResolution.value || undefined,
              duration: getSbVideoDurationForApi(sb),
              model: getSbVideoModel(sb.id),
            })
            if (res?.task_id) {
              const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
              const result = await pollTaskWithPause(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta)
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else await loadSingleStoryboardMedia(sb.id)
            if (softContiguityPipe || hardContiguityPipe) {
              prevVideoItemPipe = getSbCompletedVideoForContiguity(sb.id)
            }
          }, softContiguityPipe ? 3 : 3, softContiguityPipe ? SOFT_CONTIGUITY_RETRY_DELAY_MS : 1000)
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
          if (!ok && softContiguityPipe) {
            addPipelineError(
              stepName,
              '软衔接生成失败（已重试2次），终止后续分镜'
            )
            return { abortChain: true }
          }
        } finally {
          generatingSbVideoIds.delete(sb.id)
        }
      }, { getLabel: (sb) => '分镜视频 #' + (sb.storyboard_number ?? sb.id) })
      if (paused) { await waitForResume() }
      if (aborted) {
        addPipelineError('分镜视频', '软衔接串行已终止，未继续生成后续分镜')
      }
    }

    // 步骤 9：合成整集视频
    await checkPause()
    setPipelineStep(9, '合成整集视频...')
    try {
      const result = await dramaAPI.finalizeEpisode(episodeId, getFinalizeMergeOptions())
      if (result?.task_id != null) {
        const pollResult = await pollTaskWithPause(result.task_id, () => loadDrama())
        if (pollResult?.paused) { await waitForResume(); return }
        if (pollResult?.error) addPipelineError('合成整集视频', pollResult.error)
        else await pipelineRest()
      } else {
        addPipelineError('合成整集视频', result?.message || '本集没有可合成的视频片段')
      }
    } catch (e) {
      addPipelineError('合成整集视频', e.message || String(e))
    }

    pipelineCurrentStep.value = '一键生成视频流程已执行完成'
    ElMessage.success('一键成片完成：分镜 → 配音 → 提示词 → 生图 → 生视频 → 合成')
    trackFilmCreateAction('one_click_generate_complete', {
      extra: { error_count: pipelineErrorLog.value.length },
    })
  } catch (e) {
    addPipelineError('流程', e.message || String(e))
    trackFilmCreateAction('one_click_generate_failed', {
      extra: { message: String(e?.message || 'failed').slice(0, 120) },
    })
  }
}

async function startRepairPipeline() {
  if (!currentEpisodeId.value || pipelineRunning.value) return
  pipelineErrorLog.value = []
  pipelineCurrentStep.value = ''
  pipelineActiveTasks.clear()
  pipelineRunning.value = true
  pipelinePaused.value = false
  try {
    await runRepairPipeline()
  } finally {
    pipelineRunning.value = false
    pipelineActiveTasks.clear()
  }
}

/** 修复缺失：哪一步没有就生成哪一步，有图/有内容就跳过 */
async function runRepairPipeline() {
  const episodeId = currentEpisodeId.value
  const dramaIdVal = dramaId.value
  if (!episodeId || !dramaIdVal) return
  const style = getSelectedStyle()

  try {
    pipelineCurrentStep.value = '正在加载数据...'
    await loadDrama()

    // 1. 角色：没有则生成角色；再为每个无图角色生成图
    let chars = store.currentEpisode?.characters ?? []
    if (chars.length === 0) {
      await checkPause()
      pipelineCurrentStep.value = '正在生成角色列表...'
      try {
        const outline = (store.scriptContent || '').toString().trim() || (storyInput.value || '').toString().trim() || undefined
        const res = await generationAPI.generateCharacters(dramaIdVal, { episode_id: store.currentEpisode?.id ?? undefined, outline: outline || undefined })
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('生成角色', result.error); return }
        } else await loadDrama()
        await pipelineRest()
      } catch (e) {
        addPipelineError('生成角色', e.message || String(e))
        return
      }
      chars = store.currentEpisode?.characters ?? []
    }
    const charsWithoutImage = chars.filter((c) => !hasAssetImage(c))
    {
      const concurrency = pipelineConcurrency.value
      pipelineCurrentStep.value = `正在生成角色图（并发${concurrency}）...`
      const { paused } = await runConcurrently(charsWithoutImage, concurrency, async (char) => {
        await checkPause()
        const stepName = '角色图 ' + (char.name || char.id)
        const ok = await pipelineWithRetry(stepName, async () => {
          const res = await characterAPI.generateImage(char.id, getSelectedImageModel(), style)
          const taskId = res?.image_generation?.task_id ?? res?.task_id
          if (taskId) {
            const result = await pollTaskWithPause(taskId, () => loadDrama())
            if (result?.paused) return { paused: true }
            if (result?.error) throw new Error(result.error)
          } else {
            await loadDrama()
            await pollUntilResourceHasImage(() => {
              const list = store.currentEpisode?.characters ?? []
              const c = list.find((x) => Number(x.id) === Number(char.id))
              return !!(c && (c.image_url || c.local_path))
            })
          }
        })
        if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
      }, { getLabel: (char) => '角色图 ' + (char.name || char.id) })
      if (paused) { await waitForResume() }
    }

    // 2. 场景：没有则提取；再为每个无图场景生成图
    let sceneList = store.currentEpisode?.scenes ?? []
    if (sceneList.length === 0) {
      await checkPause()
      pipelineCurrentStep.value = '正在提取场景...'
      try {
        const res = await dramaAPI.extractBackgrounds(episodeId, { model: getSelectedTextModel(), style, language: scriptLanguage.value })
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('提取场景', result.error); return }
        } else await loadDrama()
        await pipelineRest()
      } catch (e) {
        addPipelineError('提取场景', e.message || String(e))
        return
      }
      sceneList = store.currentEpisode?.scenes ?? []
    }
    const scenesWithoutImage = sceneList.filter((s) => !hasAssetImage(s))
    {
      const concurrency = pipelineConcurrency.value
      pipelineCurrentStep.value = `正在生成场景图（并发${concurrency}）...`
      const { paused } = await runConcurrently(scenesWithoutImage, concurrency, async (scene) => {
        await checkPause()
        const stepName = '场景图 ' + (scene.location || scene.id)
        const ok = await pipelineWithRetry(stepName, async () => {
          const useQuad = !!sceneUseQuadGrid.value
          const res = await sceneAPI.generateImage({ scene_id: scene.id, model: getSelectedImageModel(), style, use_quad_grid: useQuad })
          const taskId = res?.image_generation?.task_id ?? res?.task_id
          if (taskId) {
            const result = await pollTaskWithPause(taskId, () => loadDrama())
            if (result?.paused) return { paused: true }
            if (result?.error) throw new Error(result.error)
          } else {
            await loadDrama()
            await pollUntilResourceHasImage(() => {
              const list = store.currentEpisode?.scenes ?? []
              const s = list.find((x) => Number(x.id) === Number(scene.id))
              return !!(s && (s.image_url || s.local_path))
            })
          }
        })
        if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
      }, { getLabel: (scene) => '场景图 ' + (scene.location || scene.id) })
      if (paused) { await waitForResume() }
    }

    // 2.5 道具：没有则提取；再为每个无图道具生成图
    let propList2 = store.props ?? []
    if (propList2.length === 0) {
      await checkPause()
      pipelineCurrentStep.value = '正在提取道具...'
      try {
        const res = await propAPI.extractFromScript(episodeId)
        const taskId = res?.task_id
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('提取道具', result.error); /* 不中断 */ }
        } else await loadDrama()
        await pipelineRest()
      } catch (e) {
        addPipelineError('提取道具', e.message || String(e))
      }
      propList2 = store.props ?? []
    }
    const propsWithoutImage2 = propList2.filter((p) => !hasAssetImage(p))
    {
      const concurrency = pipelineConcurrency.value
      pipelineCurrentStep.value = `正在生成道具图（并发${concurrency}）...`
      await checkPause()
      const { paused } = await runConcurrently(propsWithoutImage2, concurrency, async (prop) => {
        await checkPause()
        generatingPropIds.add(prop.id)
        try {
          const stepName = '道具图 ' + (prop.name || prop.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const res = await propAPI.generateImage(prop.id, getSelectedImageModel(), style)
            const taskId = res?.image_generation?.task_id ?? res?.task_id
            if (taskId) {
              const result = await pollTaskWithPause(taskId, () => loadDrama())
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else {
              await loadDrama()
              await pollUntilResourceHasImage(() => {
                const list = store.props ?? []
                const p = list.find((x) => Number(x.id) === Number(prop.id))
                return !!(p && (p.image_url || p.local_path))
              })
            }
          })
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
        } finally {
          generatingPropIds.delete(prop.id)
        }
      }, { getLabel: (prop) => '道具图 ' + (prop.name || prop.id) })
      if (paused) { await waitForResume() }
    }

    // 3. 分镜：没有则生成分镜；再逐个检查分镜图，没有则生成；再逐个检查分镜视频，没有则生成
    let boards = store.storyboards || []
    const hadBoardsBeforeRepairSb = boards.length > 0
    if (boards.length === 0) {
      await checkPause()
      pipelineCurrentStep.value = '正在生成分镜...'
      try {
        const res = await dramaAPI.generateStoryboard(episodeId, buildStoryboardGenerateOptions())
        const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
        if (taskId) {
          const result = await pollTaskWithPause(taskId, () => loadDrama())
          if (result?.paused) { await waitForResume(); return }
          if (result?.error) { addPipelineError('分镜生成', result.error); return }
        }
        await loadDrama()
        await pipelineRest()
      } catch (e) {
        addPipelineError('分镜生成', e.message || String(e))
        return
      }
      boards = store.storyboards || []
    }
    // 全能片段描述已在分镜生成时写入；全文解说须先配音再按配音润色，见下方步骤

    // 分镜脚本就绪后：先配音 → 再补全/润色提示词 → 再生图生视频
    await checkPause()
    await runPipelineNarrationTtsStep({ onlyMissing: true, stepIndex: null })
    await checkPause()
    await runPipelinePromptsStep({ stepIndex: null })
    await checkPause()

    // 先拉取分镜图片/视频列表，再批量生成分镜图（并发）
    await loadStoryboardMedia({ all: true })
    boards = store.storyboards || []
    const boardsWithoutImg = boards.filter((sb) => sbNeedsBatchImage(sb))
    {
      const concurrency = pipelineConcurrency.value
      pipelineCurrentStep.value = `正在生成分镜图（并发${concurrency}）...`
      const { paused } = await runConcurrently(boardsWithoutImg, concurrency, async (sb) => {
        await checkPause()
        const stepName = '分镜图 #' + (sb.storyboard_number ?? sb.id)
        const ok = await pipelineWithRetry(stepName, async () => {
          const useFirstLast = storyboardUseFirstLastFrame.value && !isSbUniversalMode(sb.id)
          let prompt = sb.polished_prompt || sb.image_prompt || sb.description || ''
          let frameTypeForCreate = undefined
          if (useFirstLast) {
            prompt = await ensureProfessionalFramePrompt(sb, 'first')
            frameTypeForCreate = 'storyboard_first'
          }
          const res = await imagesAPI.create({
            storyboard_id: sb.id,
            drama_id: dramaIdVal,
            prompt,
            model: getSelectedImageModel(),
            style,
            frame_type: frameTypeForCreate,
            aspect_ratio: projectAspectRatio.value || '16:9',
          })
          if (res?.task_id) {
            const result = await pollTaskWithPause(res.task_id, () => loadSingleStoryboardMedia(sb.id))
            if (result?.paused) return { paused: true }
            if (result?.error) throw new Error(result.error)
          } else await loadSingleStoryboardMedia(sb.id)
        })
        if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
      }, { getLabel: (sb) => '分镜图 #' + (sb.storyboard_number ?? sb.id) })
      if (paused) { await waitForResume() }
    }
    await loadStoryboardMedia({ all: true })
    if (storyboardFullNarrationVideoMode.value) {
      pipelineCurrentStep.value = '生视频前检查：按配音提示词是否已对齐…'
      await ensureNarrationPromptsAlignedBeforeVideo({ silent: true })
    }
    const boards2 = (store.storyboards || []).filter((sb) => sbNeedsBatchVideo(sb))
    {
      const missingTailRepair = countSbMissingNextShotTailFrame(boards2)
      if (missingTailRepair > 0) {
        addPipelineError(
          '分镜视频',
          `首尾帧已开：${missingTailRepair} 镜因下一镜尚无分镜图将仅用首帧提交（末镜除外）`
        )
      }
      const softContiguityRepair = !!videoSoftContiguity.value
      const hardContiguityRepair = videoFrameContiguity.value && !storyboardUseFirstLastFrame.value
      const concurrency = softContiguityRepair || hardContiguityRepair ? 1 : BATCH_VIDEO_CONCURRENCY
      let prevVideoItemRepair = null
      pipelineCurrentStep.value = `正在生成分镜视频（${concurrency === 1 ? '串行衔接' : `并发${concurrency}`}）...`
      const { paused, aborted } = await runConcurrently(boards2, concurrency, async (sb) => {
        await checkPause()
        generatingSbVideoIds.add(sb.id)
        try {
          const stepName = '分镜视频 #' + (sb.storyboard_number ?? sb.id)
          const ok = await pipelineWithRetry(stepName, async () => {
            const universal = isSbUniversalMode(sb.id)
            const omniRefs = universal ? await collectSbOmniReferenceAbsoluteUrlsAsync(sb) : []
            const firstFrameUrl = await getMainImageUrlForVideo(sb)
            let absoluteUrl = universal ? (omniRefs[0] || '') : toAbsoluteImageUrl(firstFrameUrl)
            if (hardContiguityRepair && prevVideoItemRepair && !universal) {
              const uploaded = await captureAndUploadVideoLastFrameAbsUrl(prevVideoItemRepair)
              if (uploaded) absoluteUrl = uploaded
            }
            const { first: vFirst, last: vLast, lastSource } = sbVideoFirstLastUrls(sb, universal, absoluteUrl || null)
            const imgPayload = buildSbVideoImageSubmitPayload({
              universalOmni: universal,
              universal,
              omniRefs,
              absoluteUrl,
              vFirst,
              vLast,
              lastSource,
            })
            let promptForApi = buildSbVideoPromptForApi(sb)
            if (softContiguityRepair && universal && prevVideoItemRepair) {
              const softContAbs = await captureAndUploadVideoLastFrameAbsUrl(prevVideoItemRepair)
              if (softContAbs) {
                const soft = applySoftContiguityToOmniSubmit(
                  imgPayload.reference_image_urls || omniRefs,
                  softContAbs,
                  promptForApi
                )
                if (soft.applied) {
                  imgPayload.reference_image_urls = soft.refs
                  promptForApi = soft.prompt
                }
              }
            }
            appendSbVideoSubmitLog(sb.id, imgPayload, lastSource, '补全提交')
            const res = await videosAPI.create({
              drama_id: dramaIdVal,
              storyboard_id: sb.id,
              prompt: promptForApi,
              image_url: imgPayload.image_url,
              first_frame_url: imgPayload.first_frame_url,
              last_frame_url: imgPayload.last_frame_url,
              reference_image_urls: imgPayload.reference_image_urls,
              preferred_key_index: nextVideoPreferredKeyIndex(),
              aspect_ratio: projectAspectRatio.value || '16:9',
              resolution: videoResolution.value || undefined,
              duration: getSbVideoDurationForApi(sb),
              model: getSbVideoModel(sb.id),
            })
            if (res?.task_id) {
              const meta = buildSbGenMeta(sb, GEN_RESOURCE.SB_VIDEO, '分镜视频')
              const result = await pollTaskWithPause(res.task_id, () => loadSingleStoryboardMedia(sb.id), meta)
              if (result?.paused) return { paused: true }
              if (result?.error) throw new Error(result.error)
            } else await loadSingleStoryboardMedia(sb.id)
            if (softContiguityRepair || hardContiguityRepair) {
              prevVideoItemRepair = getSbCompletedVideoForContiguity(sb.id)
            }
          }, softContiguityRepair ? 3 : 3, softContiguityRepair ? SOFT_CONTIGUITY_RETRY_DELAY_MS : 1000)
          if (ok && typeof ok === 'object' && ok.paused) return { paused: true }
          if (!ok && softContiguityRepair) {
            addPipelineError(
              stepName,
              '软衔接生成失败（已重试2次），终止后续分镜'
            )
            return { abortChain: true }
          }
        } finally {
          generatingSbVideoIds.delete(sb.id)
        }
      }, { getLabel: (sb) => '分镜视频 #' + (sb.storyboard_number ?? sb.id) })
      if (paused) { await waitForResume() }
      if (aborted) {
        addPipelineError('分镜视频', '软衔接串行已终止，未继续生成后续分镜')
      }
    }

    // 4. 生成整集视频（合成整个视频）
    await checkPause()
    pipelineCurrentStep.value = '正在生成整集视频...'
    try {
      const result = await dramaAPI.finalizeEpisode(episodeId, getFinalizeMergeOptions())
      if (result?.task_id != null) {
        const pollResult = await pollTaskWithPause(result.task_id, () => loadDrama())
        if (pollResult?.paused) { await waitForResume(); return }
        if (pollResult?.error) addPipelineError('生成整集视频', pollResult.error)
        else await pipelineRest()
      } else {
        addPipelineError('生成整集视频', result?.message || '本集没有可合成的视频片段')
      }
    } catch (e) {
      addPipelineError('生成整集视频', e.message || String(e))
    }

    pipelineCurrentStep.value = '补全并生成流程已执行完成'
    ElMessage.success('修复缺失完成：缺啥补啥（分镜后先配音→提示词→生图→生视频）')
  } catch (e) {
    addPipelineError('流程', e.message || String(e))
  }
}


onBeforeUnmount(() => {
  if (storyboardLimitClearedTimer) clearTimeout(storyboardLimitClearedTimer)
})

watch(dramaId, (id, prev) => {
  if (id && id !== prev) resetStoryboardLimitInputs({ silent: true })
})

function applyRouteToStore() {
  const id = route.params.id
  if (id && id !== 'new') {
    store.setDrama({ id: Number(id) })
    if (route.query.episode) {
      selectedEpisodeId.value = Number(route.query.episode)
    }
    loadDrama()
  } else {
    store.reset()
    storyInput.value = ''
    scriptTitle.value = ''
    selectedEpisodeId.value = null
    savedCurrentEpisodeNumber.value = 1
    storyStyle.value = ''
    storyType.value = ''
    scriptLanguage.value = 'zh'
    scriptStoryboardStyle.value = ''
    generationStyle.value = ''
    customStylePrompt.value = ''
  }
}

onMounted(async () => {
  loadPipelineConcurrency()
  applyRouteToStore()
  loadIndexTtsPrefs()
  loadVideoMergePrefs()
  syncIntroFormFromEpisode()
  await Promise.all([refreshIndexTtsHealth(), loadGsvCatalogVoices(), refreshAceStepStatus()])
})

watch(
  () => currentEpisode.value?.intro_storyboard?.id,
  () => {
    // loadDrama 刷新后同步片头表单（避免覆盖用户正在编辑的旁白时，仅在 id 变化时）
    syncIntroFormFromEpisode()
  }
)

watch(() => route.params.id, () => {
  applyRouteToStore()
})

// 剧本分集切换时同步 URL query 参数（?episode=<episode_id>），使刷新/分享页面仍保持当前选中集
// 同时监听 query 变化，支持浏览器前进/后退时自动切换对应集次
watch(
  () => selectedEpisodeId.value,
  (newId) => {
    if (!dramaId.value) return
    const currentInQuery = route.query.episode != null ? Number(route.query.episode) : null
    const desired = newId != null ? Number(newId) : null
    if (currentInQuery !== desired) {
      const newQuery = { ...route.query }
      if (desired != null) {
        newQuery.episode = String(desired)
      } else {
        delete newQuery.episode
      }
      router.replace({ query: newQuery }).catch(() => {})
    }
  },
  { flush: 'post' }
)

watch(
  () => route.query.episode,
  (newEp) => {
    if (!dramaId.value) return
    const newVal = newEp != null ? Number(newEp) : null
    const currentSel = selectedEpisodeId.value != null ? Number(selectedEpisodeId.value) : null
    if (currentSel !== newVal) {
      onEpisodeSelect(newVal)
    }
  }
)
</script>

<style scoped>
.script-workbench-unified {
  margin-bottom: 0;
}
.script-workbench-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}
.script-workbench-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}
.script-workbench-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  font-weight: 600;
}
.script-pane-inner {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.script-sub-block {
  padding-top: 4px;
}
.script-sub-divider {
  margin: 20px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
html.light .script-sub-divider {
  border-top-color: rgba(0, 0, 0, 0.08);
}
.script-mode-hint {
  margin-top: 0;
  margin-bottom: 12px;
}
.script-preview-wrap {
  margin-top: 20px;
}
.preview-block-title {
  margin: 16px 0 8px;
  font-size: 0.95rem;
  font-weight: 600;
  color: #a1a1aa;
}
html.light .preview-block-title {
  color: #64748b;
}
.preview-block-title:first-of-type {
  margin-top: 0;
}
.preview-actions {
  margin-top: 16px;
}
.script-select-empty {
  margin-top: 16px;
  color: #71717a;
  font-size: 14px;
}
.select-script-list {
  min-height: 120px;
  max-height: 420px;
  overflow-y: auto;
}
.select-script-item {
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.select-script-item:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(99, 102, 241, 0.35);
}
.select-script-item.disabled,
.select-script-item.disabled:hover {
  cursor: not-allowed;
  opacity: 0.55;
  border-color: rgba(255, 255, 255, 0.06);
  background: transparent;
}
html.light .select-script-item {
  border-color: rgba(99, 102, 241, 0.15);
}
html.light .select-script-item:hover {
  background: rgba(99, 102, 241, 0.06);
}
.select-script-title {
  font-weight: 600;
  color: #e4e4e7;
  margin-bottom: 6px;
}
html.light .select-script-title {
  color: #1e1b4b;
}
.select-script-desc {
  font-size: 13px;
  color: #9ca0b2;
  line-height: 1.45;
}
.select-script-empty {
  text-align: center;
  color: #71717a;
  padding: 24px;
}
.preview-ep-tabs {
  margin-top: 4px;
}

.film-create {
  min-height: 100vh;
  background: #16171e;
  background-image:
    radial-gradient(ellipse 80% 50% at 60% -5%, rgba(99, 102, 241, 0.13) 0%, transparent 65%),
    radial-gradient(ellipse 50% 40% at 90% 50%, rgba(139, 92, 246, 0.07) 0%, transparent 55%),
    radial-gradient(ellipse 45% 35% at 5% 75%, rgba(79, 70, 229, 0.06) 0%, transparent 55%),
    linear-gradient(180deg, #16171e 0%, #1a1b24 40%, #1e1f29 100%);
  color: #e4e4e7;
}
html.light .film-create {
  background: #f8f7ff;
  background-image:
    radial-gradient(ellipse 80% 50% at 10% -10%, rgba(139, 92, 246, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse 50% 40% at 85% 110%, rgba(99, 102, 241, 0.06) 0%, transparent 50%);
  color: #1e1b4b;
}
.header {
  background: rgba(20, 21, 28, 0.78);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 10px 28px;
  position: sticky;
  top: 0;
  z-index: 200;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.15), 0 4px 20px rgba(0, 0, 0, 0.2);
  margin-left: 180px;
  transition: margin-left 0.25s cubic-bezier(.4,0,.2,1);
}
.sidebar-collapsed .header {
  margin-left: 48px;
}
html.light .header {
  background: rgba(255, 255, 255, 0.82) !important;
  border-bottom-color: rgba(139, 92, 246, 0.1) !important;
  box-shadow: 0 1px 0 rgba(139,92,246,0.06), 0 4px 20px rgba(139, 92, 246, 0.05) !important;
}
.header-inner {
  display: flex;
  align-items: center;
  gap: 16px;
}
.logo {
  margin: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
  transition: filter 0.3s;
}
.logo:hover { filter: drop-shadow(0 0 10px rgba(139, 92, 246, 0.5)); }
.logo-main {
  font-size: 1.05rem;
  font-weight: 700;
  background: linear-gradient(135deg, #d0d5e8 0%, #a8b0cc 50%, #8890b0 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.01em;
  filter: drop-shadow(0 0 8px rgba(160, 170, 200, 0.15));
}
.logo-sub {
  font-size: 0.65rem;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: #52525e;
  -webkit-text-fill-color: #52525e;
  text-transform: uppercase;
}
html.light .logo-main {
  background: linear-gradient(135deg, #6d28d9, #4f46e5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
.breadcrumb-sep {
  color: #3a3a44;
  font-size: 0.9rem;
  font-weight: 300;
  flex-shrink: 0;
  user-select: none;
}
html.light .breadcrumb-sep { color: #d1d5db; }
.page-title {
  font-size: 0.82rem;
  font-weight: 500;
  color: #7a7a88;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 4px 12px;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html.light .page-title {
  color: #6b7280;
  background: rgba(99, 102, 241, 0.04);
  border-color: rgba(99, 102, 241, 0.1);
}
.header-episode-select {
  flex-shrink: 0;
}
.btn-back-drama {
  flex-shrink: 0;
}
.header-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.btn-theme {
  --el-button-bg-color: rgba(255, 255, 255, 0.04);
  --el-button-border-color: rgba(255, 255, 255, 0.08);
  --el-button-text-color: #8b8b96;
  --el-button-hover-bg-color: rgba(255, 255, 255, 0.08);
  --el-button-hover-border-color: rgba(255, 255, 255, 0.18);
  --el-button-hover-text-color: #c8c8d0;
  transition: all 0.2s ease;
}
html.light .btn-theme {
  --el-button-bg-color: rgba(99, 102, 241, 0.04);
  --el-button-border-color: rgba(99, 102, 241, 0.12);
  --el-button-text-color: #6b7280;
  --el-button-hover-bg-color: rgba(99, 102, 241, 0.08);
  --el-button-hover-border-color: rgba(99, 102, 241, 0.3);
  --el-button-hover-text-color: #4f46e5;
}
/* ===== 左侧固定侧边栏 ===== */
.quick-nav {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 210;
  display: flex;
  flex-direction: column;
  padding: 14px 0 10px;
  background: linear-gradient(180deg, #131318 0%, #111116 50%, #0f0f14 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 1px 0 0 rgba(255,255,255,0.02), 4px 0 24px rgba(0, 0, 0, 0.4);
  width: 180px;
  overflow-y: auto;
  overflow-x: hidden;
  transition: width 0.25s cubic-bezier(.4,0,.2,1), padding 0.25s cubic-bezier(.4,0,.2,1);
}
html.light .quick-nav {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 247, 255, 0.99) 100%);
  border-right-color: rgba(139, 92, 246, 0.1);
  box-shadow: 1px 0 0 rgba(139,92,246,0.06), 4px 0 20px rgba(139, 92, 246, 0.04);
}
.quick-nav::-webkit-scrollbar { width: 4px; }
.quick-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
.quick-nav::-webkit-scrollbar-track { background: transparent; }
.quick-nav.collapsed {
  width: 48px;
  padding: 12px 0;
}
.quick-nav.collapsed .nav-steps,
.quick-nav.collapsed .nav-group {
  display: none;
}
@media (max-width: 768px) {
  .quick-nav { width: 48px; padding: 12px 0; }
  .quick-nav .nav-steps, .quick-nav .nav-group { display: none; }
  .quick-nav .nav-sidebar-title { display: none; }
  .quick-nav .nav-sidebar-header { justify-content: center; padding: 0 4px 8px; }
  .header, .main { margin-left: 48px !important; }
  .main { padding: 16px 12px 48px; }
  .asset-list-two { grid-template-columns: 1fr; }
}
/* 当前任务面板 */
.atp-panel {
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 6px 0 4px;
}
.atp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 4px;
}
.atp-title {
  font-size: 0.72rem;
  font-weight: 600;
  color: #a78bfa;
  letter-spacing: 0.03em;
  flex: 1;
}
.atp-count-badge {
  font-size: 0.68rem;
  background: rgba(139, 92, 246, 0.25);
  color: #c4b5fd;
  border-radius: 8px;
  padding: 1px 5px;
  min-width: 16px;
  text-align: center;
}
.atp-spin-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a78bfa;
  flex-shrink: 0;
  animation: atp-pulse 1.2s ease-in-out infinite;
}
@keyframes atp-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}
.atp-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.atp-list :deep(.el-tooltip__trigger) {
  display: block;
  width: 100%;
  min-width: 0;
}
.atp-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 6px;
  transition: background 0.15s;
  min-width: 0;
  cursor: default;
}
.atp-item:hover { background: rgba(255,255,255,0.05); }
.atp-item-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #7c3aed;
  flex-shrink: 0;
  animation: atp-pulse 1.6s ease-in-out infinite;
}
.atp-item-label {
  font-size: 0.72rem;
  color: #a1a1aa;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.atp-item-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #71717a;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}
.atp-item:hover .atp-item-close,
.atp-item-close:focus-visible {
  opacity: 1;
}
.atp-item-close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}
.atp-more {
  font-size: 0.68rem;
  color: #71717a;
  padding: 2px 10px 2px 19px;
}
/* 折叠态任务徽章 */
.atp-collapsed-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px 0;
  cursor: default;
}
.atp-collapsed-count {
  font-size: 0.65rem;
  color: #a78bfa;
  font-weight: 700;
  line-height: 1;
}
html.light .atp-title { color: #7c3aed; }
html.light .atp-count-badge { background: rgba(139,92,246,0.12); color: #7c3aed; }
html.light .atp-spin-dot { background: #7c3aed; }
html.light .atp-item-dot { background: #8b5cf6; }
html.light .atp-item-label { color: #374151; }
html.light .atp-item:hover { background: rgba(0,0,0,0.04); }
html.light .atp-item-close { color: #9ca3af; }
html.light .atp-item-close:hover { background: rgba(239,68,68,0.1); color: #dc2626; }
html.light .atp-panel { border-top-color: rgba(139,92,246,0.15); }
.nav-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 8px;
  flex-shrink: 0;
}
html.light .nav-sidebar-header { border-bottom-color: rgba(139, 92, 246, 0.12); }
.quick-nav.collapsed .nav-sidebar-header {
  justify-content: center;
  padding: 0 4px 8px;
}
.nav-sidebar-title {
  font-size: 13px;
  font-weight: 600;
  color: #7a7a88;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
}
html.light .nav-sidebar-title { color: #7c3aed; }
.nav-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  cursor: pointer;
  color: #5a5a66;
  transition: color 0.15s, background 0.15s;
  border-radius: 6px;
  flex-shrink: 0;
  font-size: 16px;
}
.nav-toggle:hover { color: #c8c8d0; background: rgba(255,255,255,0.06); }
html.light .nav-toggle { color: #9ca3af; }
html.light .nav-toggle:hover { color: #374151; background: rgba(0,0,0,0.05); }

/* ─── Steps ─── */
.nav-steps {
  display: flex;
  flex-direction: column;
  padding: 0 10px 0 10px;
}
.nav-step {
  display: flex;
  align-items: stretch;
  gap: 8px;
  cursor: pointer;
  border-radius: 6px;
  padding: 3px 6px 3px 0;
  transition: background 0.2s ease;
  user-select: none;
}
.nav-step:hover { background: rgba(255,255,255,0.04); }
html.light .nav-step:hover { background: rgba(99,102,241,0.05); }

/* connector column */
.step-connector-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
  flex-shrink: 0;
}
.step-line {
  width: 2px;
  flex: 1;
  min-height: 6px;
  background: rgba(255,255,255,0.1);
  border-radius: 1px;
  transition: background 0.3s;
}
html.light .step-line { background: rgba(0,0,0,0.1); }
.step-line.filled { background: rgba(34, 197, 94, 0.5); }

/* dot */
.step-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  transition: all 0.25s;
  border: 2px solid transparent;
}
.dot-pending {
  background: rgba(39,39,42,0.6);
  border-color: rgba(63,63,70,0.4);
  color: #52525b;
}
html.light .dot-pending {
  background: rgba(229,231,235,0.6);
  border-color: rgba(156,163,175,0.3);
  color: #9ca3af;
}
.dot-partial {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.45);
  color: #f59e0b;
}
.dot-generating {
  background: rgba(139, 92, 246, 0.15);
  border-color: rgba(139, 92, 246, 0.5);
  color: #a78bfa;
  box-shadow: 0 0 8px rgba(139, 92, 246, 0.2);
}
.dot-done {
  background: rgba(34, 197, 94, 0.12);
  border-color: rgba(34, 197, 94, 0.5);
  color: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.15);
}
.dot-icon { font-size: 13px; }
.dot-num { font-size: 11px; line-height: 1; }

/* step body */
.step-body {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  padding: 3px 0;
  min-width: 0;
}
.step-label {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #71717a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.2s ease;
}
html.light .step-label { color: #6b7280; }
.nav-step:hover .step-label { color: #d4d4d8; }
html.light .nav-step:hover .step-label { color: #1e1b4b; }
.status-done .step-label { color: #6ee7b7; }
html.light .status-done .step-label { color: #059669; }
.status-generating .step-label { color: #c4b5fd; }
html.light .status-generating .step-label { color: #7c3aed; }
.status-partial .step-label { color: #fbbf24; }
html.light .status-partial .step-label { color: #d97706; }

.step-count {
  font-size: 10px;
  color: #52525b;
  background: rgba(255,255,255,0.04);
  border-radius: 10px;
  padding: 1px 5px;
  flex-shrink: 0;
  font-weight: 500;
}
html.light .step-count { background: rgba(0,0,0,0.04); color: #9ca3af; }

.step-badge {
  display: flex;
  align-items: center;
  font-size: 11px;
  flex-shrink: 0;
}
.partial-badge { color: #f59e0b; }
.gen-badge { color: #a78bfa; }

/* spin animation */
@keyframes navSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spin { animation: navSpin 1s linear infinite; display: inline-flex; }

/* sub-toggle & sub-list */
.nav-group { margin-top: 4px; }
.nav-sub-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12px;
  color: #5a5a66;
  cursor: pointer;
  transition: color 0.15s;
  border-top: 1px solid rgba(255,255,255,0.04);
}
html.light .nav-sub-toggle { border-top-color: rgba(0,0,0,0.07); color: #9ca3af; }
.nav-sub-toggle:hover { color: #e4e4e7; }
html.light .nav-sub-toggle:hover { color: #374151; }
.nav-sub-list {
  background: rgba(0,0,0,0.15);
  padding: 4px 0;
  border-radius: 0 0 6px 6px;
}
html.light .nav-sub-list { background: rgba(99,102,241,0.03); }
.nav-sub-page-hint {
  padding: 4px 10px 6px 26px;
  font-size: 10.5px;
  color: #71717a;
  line-height: 1.4;
}
html.light .nav-sub-page-hint { color: #9ca3af; }
.nav-sub-item {
  padding: 4px 10px 4px 26px;
  font-size: 11.5px;
  color: #52525b;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.15s, background 0.15s;
  border-radius: 4px;
  margin: 0 4px;
}
html.light .nav-sub-item { color: #9ca3af; }
.nav-sub-item:hover { color: #d4d4d8; background: rgba(255,255,255,0.04); }
html.light .nav-sub-item:hover { color: #1e1b4b; background: rgba(99,102,241,0.06); }

.main {
  margin-left: 180px;
  margin-right: 0;
  padding: 24px 32px 48px;
  transition: margin-left 0.25s cubic-bezier(.4,0,.2,1);
}
.sidebar-collapsed .main {
  margin-left: 48px;
}
.section {
  margin-bottom: 24px;
}
.card {
  background: #1e1f28;
  border-radius: 14px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
}
.card:hover {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.25);
}
html.light .card {
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
  border-color: rgba(139, 92, 246, 0.08);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 4px 20px rgba(99, 102, 241, 0.05);
}
html.light .card:hover {
  border-color: rgba(139, 92, 246, 0.18);
  box-shadow: 0 1px 0 rgba(255,255,255,0.8) inset, 0 8px 36px rgba(99, 102, 241, 0.08);
}
.section-title {
  font-size: 1.05rem;
  margin: 0 0 4px;
  color: #f4f4f5;
  font-weight: 600;
  letter-spacing: -0.01em;
}
html.light .section-title { color: #1e1b4b; }
.pipeline-section {
  padding: 12px 16px !important;
}
.one-click-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.one-click-label {
  font-size: 14px;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  font-weight: 600;
}
.pipeline-status {
  margin-top: 12px;
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 13px;
}
.pipeline-current-step {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--el-text-color-primary);
  font-weight: 500;
  font-size: 13px;
}
.pipeline-step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.pipeline-active-tasks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.pipeline-task-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px 2px 6px;
  border-radius: 12px;
  background: rgba(64, 158, 255, 0.12);
  border: 1px solid rgba(64, 158, 255, 0.3);
  color: var(--el-color-primary);
  font-size: 12px;
  white-space: nowrap;
}
.pipeline-task-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  flex-shrink: 0;
  animation: pipeline-dot-pulse 1.2s ease-in-out infinite;
}
@keyframes pipeline-dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.75); }
}
.pipeline-error-log {
  margin-top: 0;
  padding: 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  font-size: 13px;
  color: #fca5a5;
  max-height: 200px;
  overflow-y: auto;
}
.pipeline-status .pipeline-error-log {
  margin-top: 8px;
}
.pipeline-error-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.pipeline-error-line {
  margin-bottom: 4px;
  word-break: break-all;
}
/* 阶段间倒计时 */
.pipeline-countdown {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin: 10px 0 8px;
  padding: 12px 14px;
  background: rgba(103, 194, 58, 0.08);
  border: 1px solid rgba(103, 194, 58, 0.35);
  border-radius: 10px;
}
.pipeline-countdown-ring {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 54px;
  height: 54px;
  border-radius: 50%;
  background: rgba(103, 194, 58, 0.15);
  border: 2px solid rgba(103, 194, 58, 0.6);
  flex-shrink: 0;
}
.pipeline-countdown-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--el-color-success);
  line-height: 1;
}
.pipeline-countdown-unit {
  font-size: 11px;
  color: var(--el-color-success);
  opacity: 0.8;
}
.pipeline-countdown-body {
  flex: 1;
  min-width: 0;
}
.pipeline-countdown-msg {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--el-text-color-primary);
  line-height: 1.5;
}
.pipeline-countdown-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.pipeline-countdown-paused {
  font-size: 12px;
  color: var(--el-color-warning);
}
/* 批量生成分镜图/视频 */
.sb-batch-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.sb-batch-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.batch-status {
  margin-top: 12px;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.batch-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-primary);
  font-weight: 500;
}
.batch-failed {
  color: var(--el-color-danger);
  font-size: 12px;
}
.batch-stopping {
  color: var(--el-color-warning);
  font-size: 12px;
}
.batch-error-log {
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  font-size: 13px;
  color: #fca5a5;
  max-height: 160px;
  overflow-y: auto;
}
.batch-error-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: #f87171;
}
.batch-error-line {
  margin-bottom: 3px;
  word-break: break-all;
}
/* 角色/场景/道具 → 影响的分镜 */
.asset-storyboard-link {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  padding: 6px 8px;
  background: rgba(99, 102, 241, 0.07);
  border: 1px solid rgba(99, 102, 241, 0.18);
  border-radius: 6px;
  min-height: 28px;
}
.asl-label {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}
.asl-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(99, 102, 241, 0.15);
  border: 1px solid rgba(99, 102, 241, 0.35);
  color: #a5b4fc;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}
.asl-chip:hover {
  background: rgba(99, 102, 241, 0.28);
  box-shadow: 0 0 6px rgba(99, 102, 241, 0.4);
  color: #c7d2fe;
}
.asl-regen-btn {
  margin-left: auto !important;
  flex-shrink: 0;
  height: 22px !important;
  padding: 0 10px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  background: rgba(251, 146, 60, 0.15) !important;
  border: 1px solid rgba(251, 146, 60, 0.5) !important;
  color: #fb923c !important;
  border-radius: 11px !important;
  transition: background 0.15s, box-shadow 0.15s !important;
}
.asl-regen-btn:not(.is-loading):hover {
  background: rgba(251, 146, 60, 0.28) !important;
  box-shadow: 0 0 6px rgba(251, 146, 60, 0.35) !important;
  color: #fdba74 !important;
}
.asl-progress {
  font-size: 11px;
  color: #fb923c;
  margin-left: 4px;
  flex-shrink: 0;
}
/* 参考图上传区（添加角色/道具/场景弹窗顶部） */
.ref-image-zone {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.ref-image-box {
  width: 120px;
  height: 120px;
  border: 2px dashed #c0c4cc;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  background: #fafafa;
  flex-shrink: 0;
  transition: border-color 0.2s;
}
.ref-image-box:hover {
  border-color: #409eff;
}
.ref-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ref-upload-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #909399;
  font-size: 12px;
  text-align: center;
  padding: 8px;
}
.ref-upload-icon {
  font-size: 28px;
  line-height: 1;
}
.ref-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 资源管理大面板 + 可折叠标题 */
.resource-panel {
  padding: 0;
  overflow: hidden;
}
.collapse-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}
.collapse-header:hover {
  background: rgba(255, 255, 255, 0.04);
}
.resource-panel .collapse-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.resource-panel .collapse-header .section-title {
  margin: 0;
}
.collapse-icon {
  font-size: 1.1rem;
  color: #a1a1aa;
  flex-shrink: 0;
  margin-left: 8px;
}
.resource-panel-body {
  padding: 16px 20px 20px;
}
.resource-pack-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
}
.resource-block {
  margin-bottom: 20px;
  padding: 0;
  overflow: hidden;
}
.resource-block:last-child {
  margin-bottom: 0;
}
.resource-block-header {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.resource-block-header .collapse-icon {
  font-size: 1rem;
}
.resource-block-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
  color: #e4e4e7;
}
html.light .resource-block-title {
  color: #18181b;
}
.resource-block-body {
  padding: 12px 14px 14px;
}
.resource-block-body .asset-actions {
  margin-bottom: 12px;
}
.resource-block-body .asset-list-two {
  gap: 16px;
}
.section-desc {
  color: #52525b;
  font-size: 0.82rem;
  margin: 0 0 14px;
  line-height: 1.5;
}
html.light .section-desc { color: #6b7280; }
.story-textarea {
  margin-bottom: 12px;
}
.row { display: flex; flex-wrap: wrap; align-items: center; }
.gap { gap: 12px; }
.asset-actions { margin-bottom: 12px; }
.asset-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.asset-list-two {
  grid-template-columns: repeat(auto-fill, minmax(460px, 1fr));
  gap: 20px;
}
.asset-item {
  background: #22232d;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.asset-item-left-right {
  flex-direction: row;
  align-items: stretch;
}
.asset-item-left-right .asset-info {
  flex: 1;
  min-width: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
}
.asset-item-left-right .asset-name {
  font-size: 1.05rem;
  margin-bottom: 8px;
}
.asset-item-left-right .asset-desc-full {
  flex: 1;
  font-size: 0.875rem;
  color: #a1a1aa;
  line-height: 1.5;
  margin-bottom: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.asset-item-left-right .asset-cover-wrap {
  flex-shrink: 0;
  align-self: flex-start;
}
.asset-item-left-right .asset-cover {
  width: 200px;
  height: 200px;
}
.asset-item-left-right .asset-cover.asset-cover--clickable {
  cursor: pointer;
}
.asset-cover {
  width: 100%;
  aspect-ratio: 1;
  background: #2a2b36;
  position: relative;
  overflow: hidden;
}
.asset-item-left-right .asset-cover .cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5a5a66;
  font-size: 0.85rem;
}
.cover-placeholder.error {
  background: #450a0a;
  color: #f87171;
  font-size: 0.8rem;
  padding: 8px;
  line-height: 1.4;
  word-break: break-all;
  text-align: center;
}
.sb-image-error {
  width: 100%;
  flex: 1;
  background: #450a0a;
  color: #f87171;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
  font-size: 0.85rem;
  overflow: hidden;
  margin-bottom: 8px;
}
.asset-cover--dragover {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -2px;
  background: rgba(64, 158, 255, 0.08);
}
.asset-cover-drop-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.9rem;
  pointer-events: none;
}
.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(10, 10, 15, 0.88);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.image-preview-img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  cursor: pointer;
  pointer-events: auto;
}
.asset-info { padding: 10px; }
.asset-name { font-weight: 600; margin-bottom: 4px; color: #e4e4e7; }
.asset-desc {
  font-size: 0.8rem;
  color: #a1a1aa;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-desc-full {
  font-size: 0.875rem;
  color: #a1a1aa;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.asset-desc-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.asset-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
.asset-item-left-right .asset-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.asset-item-left-right .asset-name span { flex: 1; min-width: 0; }
.btn-delete-icon { flex-shrink: 0; padding: 2px 4px !important; opacity: 0.45; transition: opacity 0.15s; }
.btn-delete-icon:hover { opacity: 1; }
/* 图片 + 操作按钮 竖向包裹 */
.asset-cover-wrap {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 200px;
}
.asset-cover-actions {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.asset-cover-actions .el-button { flex: 1; justify-content: center; }
.asset-cover-actions--secondary {
  border-top: none;
  padding-top: 0;
}
html.light .asset-cover-actions { border-top-color: rgba(139,92,246,0.1); }
.sb-prompt-actions {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  gap: 4px;
}
/* 额外参考图缩略图条 */
.extra-images-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 5px 8px;
  background: rgba(0,0,0,0.15);
}
.extra-thumb {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  border: 1.5px solid transparent;
  transition: border-color 0.15s;
}
.extra-thumb:hover { border-color: #a78bfa; }
.extra-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.extra-thumb-remove {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 16px;
  height: 16px;
  background: rgba(239,68,68,0.85);
  color: #fff;
  border: none;
  border-radius: 50%;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  cursor: pointer;
  padding: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.thumb-preview-btn {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  background: rgba(59,130,246,0.85);
  color: #fff;
  border: none;
  border-radius: 50%;
  font-size: 9px;
  line-height: 1;
  text-align: center;
  cursor: pointer;
  padding: 0;
  opacity: 0;
  transition: opacity 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.thumb-preview-btn .el-icon,
.thumb-preview-btn svg {
  width: 10px;
  height: 10px;
}
.extra-thumb:hover .extra-thumb-remove,
.extra-thumb:hover .thumb-preview-btn { opacity: 1; }
.sb-img-thumb:hover .extra-thumb-remove,
.sb-img-thumb:hover .thumb-preview-btn { opacity: 1; }
.sb-video-thumb:hover .extra-thumb-remove { opacity: 1; }
html.light .extra-images-strip { background: rgba(139,92,246,0.05); }
.empty-tip {
  color: #5a5a66;
  font-size: 0.9rem;
  padding: 16px 0;
}

/* 亮色模式：资源卡片 */
html.light .asset-item {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(139, 92, 246, 0.12);
  box-shadow: 0 2px 10px rgba(139, 92, 246, 0.06);
}
html.light .asset-item:hover {
  box-shadow: 0 6px 20px rgba(139, 92, 246, 0.12);
  border-color: rgba(139, 92, 246, 0.3);
  transform: translateY(-2px);
  transition: box-shadow 0.25s, transform 0.2s, border-color 0.25s;
}
html.light .asset-cover {
  background: #f3f4f6;
}
html.light .asset-name {
  color: #18181b;
}
html.light .asset-desc,
html.light .asset-desc-full,
html.light .asset-item-left-right .asset-desc-full {
  color: #6b7280;
}
html.light .cover-placeholder {
  color: #9ca3af;
  background: #f3f4f6;
}
html.light .cover-placeholder.error {
  background: #fef2f2;
  color: #dc2626;
}
html.light .empty-tip {
  color: #9ca3af;
}

/* 分镜：每行一个，三列布局 */
@keyframes sb-fade-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* ── 段落分隔标头 ─────────────────────────────── */
.segment-header {
  margin: 24px 0 14px;
  position: relative;
}
.segment-header:first-child { margin-top: 0; }
.segment-header-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  background: linear-gradient(90deg, rgba(139,92,246,0.12) 0%, transparent 80%);
  border-left: 3px solid rgba(139,92,246,0.6);
  border-radius: 0 10px 10px 0;
}
.segment-index-badge {
  font-size: 11px;
  font-weight: 600;
  color: #a78bfa;
  background: rgba(139,92,246,0.15);
  padding: 2px 8px;
  border-radius: 20px;
  letter-spacing: 0.3px;
  white-space: nowrap;
}
.segment-title-text {
  font-size: 14px;
  font-weight: 600;
  color: #d4d4d8;
  flex: 1;
  letter-spacing: -0.01em;
}
.segment-shot-range {
  font-size: 11px;
  color: #52525b;
  white-space: nowrap;
}
html.light .segment-header-inner {
  background: linear-gradient(90deg, rgba(139,92,246,0.07) 0%, transparent 80%);
  border-left-color: rgba(124,58,237,0.5);
}
html.light .segment-title-text { color: #1e1b4b; }
html.light .segment-index-badge { color: #7c3aed; background: rgba(124,58,237,0.08); }
html.light .segment-shot-range { color: #9ca3af; }

/* 左侧导航段落标签 */
.nav-segment-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px 2px;
  font-size: 10px;
  font-weight: 700;
  color: #a78bfa;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.nav-segment-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8b5cf6;
  flex-shrink: 0;
}

.storyboard-row {
  display: flex;
  align-items: flex-start;
  gap: 0;
  margin-bottom: 16px;
  background: #1e1f28;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
  position: relative;
  transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.25s ease;
  animation: sb-fade-in 0.35s ease both;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}
.storyboard-row:hover {
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.25);
  transform: translateY(-1px);
}
html.light .storyboard-row {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(139, 92, 246, 0.06);
  box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset, 0 2px 12px rgba(99, 102, 241, 0.04);
}
html.light .storyboard-row:hover {
  border-color: rgba(139, 92, 246, 0.18);
  box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset, 0 6px 24px rgba(99, 102, 241, 0.08);
  transform: translateY(-1px);
}
.storyboard-row:last-child { margin-bottom: 0; }
/* ── 分镜控制栏（卡片外，缩进） ── */
.sb-ctrl-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 32px;
  margin-bottom: 4px;
  height: 26px;
}
.sb-ctrl-num {
  background: var(--el-color-primary);
  color: #fff;
  border-radius: 5px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
.sb-ctrl-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: #e4e4e7;
  max-width: 12em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
html.light .sb-ctrl-title {
  color: #000;
}
.sb-movement-tag.el-tag {
  height: 18px;
  line-height: 18px;
  padding: 0 6px;
  font-size: 11px;
  margin-left: 6px;
  flex-shrink: 0;
}
.sb-ctrl-btn.el-button {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}
.sb-ctrl-config-btn.el-button {
  border-color: rgba(139,92,246,0.45);
  color: #a78bfa;
  background: rgba(139,92,246,0.08);
}
.sb-ctrl-config-btn.el-button:hover {
  border-color: #8b5cf6;
  color: #fff;
  background: rgba(139,92,246,0.6);
}
html.light .sb-ctrl-config-btn.el-button {
  border-color: rgba(124,58,237,0.35);
  color: #7c3aed;
  background: rgba(124,58,237,0.06);
}
html.light .sb-ctrl-config-btn.el-button:hover {
  border-color: #7c3aed;
  color: #fff;
  background: #7c3aed;
}
.sb-ctrl-delete {
  margin-left: auto;
  opacity: 0.4;
  transition: opacity 0.2s;
  height: 22px;
  padding: 0 4px;
}
.sb-ctrl-bar:hover .sb-ctrl-delete {
  opacity: 1;
}
.sb-panel {
  flex: 1;
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid rgba(255,255,255,0.05);
  display: flex;
  flex-direction: column;
}
html.light .sb-panel {
  border-right-color: rgba(139,92,246,0.08);
}
.sb-panel:last-child { border-right: none; }
.sb-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  color: #e4e4e7;
  margin-bottom: 10px;
}
.sb-panel-title .el-icon { font-size: 1rem; color: #a1a1aa; }
.sb-panel-title-name {
  margin-left: 4px;
  color: #a1a1aa;
  font-weight: 500;
  max-width: 12em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sb-script { padding-top: 10px; }
.sb-script-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.sb-select { flex: 1; min-width: 0; }
.sb-select-empty { font-size: 0.8rem; color: #71717a; padding: 8px; }
.sb-selected-thumbs {
  margin: 10px 0;
  padding: 8px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.sb-thumb-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.sb-thumb-row:last-child { margin-bottom: 0; }
.sb-thumb-label {
  font-size: 0.8rem;
  color: #71717a;
  flex-shrink: 0;
  width: 36px;
}
.sb-thumb-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.sb-thumb-item {
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background: #22232d;
}
.sb-thumb-item.sb-thumb-clickable {
  cursor: pointer;
}
.sb-thumb-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}
.sb-thumb-add-char {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1.5px dashed #52525b;
  background: transparent;
  color: #a1a1aa;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.sb-thumb-add-char:hover {
  color: #e4e4e7;
  border-color: #71717a;
  background: rgba(63, 63, 70, 0.5);
}
html.light .sb-thumb-add-char {
  border-color: #d4d4d8;
  color: #71717a;
}
html.light .sb-thumb-add-char:hover {
  color: #18181b;
  border-color: #a1a1aa;
  background: #f4f4f5;
}
.sb-thumb-prop,
.sb-thumb-scene {
  width: 36px;
  height: 36px;
}
.sb-script-row.sb-script-selects {
  gap: 6px;
}
.sb-script-row.sb-script-selects .sb-select {
  min-width: 0;
}
.sb-script-row.sb-script-selects .el-select { flex: 1; min-width: 0; }
.sb-thumb-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sb-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: #7a7a88;
  background: #2a2b36;
}
.sb-script-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: #71717a;
  margin-bottom: 6px;
}
.sb-script-label .el-icon { font-size: 0.9rem; }
.sb-upload-icon { margin-left: auto; cursor: pointer; color: #a1a1aa; }
.sb-meta {
  font-size: 0.75rem;
  color: #71717a;
  display: flex;
  gap: 12px;
}
.sb-image-area {
  flex: 1;
  min-height: 200px;
  max-height: 320px;
  background: linear-gradient(145deg, #1a1b24 0%, #1e1f28 60%, #1c1d26 100%);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: hidden;
  position: relative;
  transition: border-color 0.2s, background 0.2s;
}
.sb-image-area:hover {
  border-color: rgba(255, 255, 255, 0.15);
}
html.light .sb-image-area {
  background: linear-gradient(145deg, #f5f3ff 0%, #ede9fe 100%);
  border-color: rgba(124,58,237,0.2);
}
html.light .sb-image-area:hover {
  border-color: rgba(124,58,237,0.45);
}
.sb-image-area--dragover {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -2px;
  background: rgba(64, 158, 255, 0.1);
}
.sb-image-area-drop-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.9rem;
  border-radius: 8px;
  pointer-events: none;
}
.sb-generated-img {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
}
.sb-image-file-input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
.sb-gen-btn { margin-top: 4px; }
.sb-image-area img.sb-generated-img { cursor: pointer; }
.sb-panel.sb-image.sb-image--universal {
  min-height: 300px;
  justify-content: flex-start;
}
.sb-universal-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.sb-universal-label-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sb-universal-hint-icon {
  cursor: help;
  color: #9ca3af;
  font-size: 16px;
  flex-shrink: 0;
}
.sb-universal-hint-icon:hover {
  color: #a78bfa;
}
.sb-universal-gen-btn {
  flex-shrink: 0;
}
.sb-universal-prompt-dd {
  flex-shrink: 0;
}
.sb-universal-dd-caret {
  margin-left: 2px;
  font-size: 12px;
  vertical-align: middle;
}
.sb-universal-instruction {
  margin-bottom: 6px;
}
.sb-universal-instruction :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-border-color-lighter, #ebeef5) inset;
}
.sb-universal-beats {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sb-universal-beats-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.sb-universal-beats-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.sb-universal-beats-warn {
  margin-right: 2px;
}
.sb-universal-beats-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary, #909399);
}
.sb-universal-beat-row {
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--el-fill-color-blank, #fff);
}
.sb-universal-beat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.sb-universal-beat-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular, #606266);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sb-universal-beat-time {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--el-color-primary, #409eff);
  background: var(--el-color-primary-light-9, #ecf5ff);
  border-radius: 4px;
  padding: 0 6px;
  line-height: 1.6;
}
.sb-universal-beat-narr {
  font-size: 11px;
  line-height: 1.45;
  color: var(--el-text-color-secondary, #909399);
  margin-bottom: 6px;
  padding: 4px 8px;
  border-left: 2px solid var(--el-border-color, #dcdfe6);
  background: var(--el-fill-color-lighter, #fafafa);
  border-radius: 0 4px 4px 0;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 4.2em;
  overflow: hidden;
}
.sb-universal-beat-body-input :deep(.el-textarea__inner) {
  font-size: 12px;
  line-height: 1.45;
  padding: 6px 8px;
  border: none;
  box-shadow: none;
  background: var(--el-fill-color-light, #f5f7fa);
}
:global(.sb-universal-tooltip-popper.el-popper) {
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
.sb-universal-tooltip {
  max-width: 360px;
  font-size: 12px;
  line-height: 1.55;
  padding: 10px 12px;
  border-radius: 8px;
  color: #f1f5f9;
  background: #0f172a;
  border: 1px solid rgba(248, 250, 252, 0.22);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.sb-universal-tooltip strong {
  font-weight: 600;
  color: #ffffff;
}
html.light .sb-universal-tooltip {
  color: #0f172a;
  background: #ffffff;
  border-color: #cbd5e1;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
}
html.light .sb-universal-tooltip strong {
  color: #020617;
}
.sb-universal-textarea {
  flex: 1;
  min-height: 0;
}
.sb-universal-textarea :deep(.el-textarea__inner) {
  min-height: 220px !important;
  font-size: 13px;
  line-height: 1.55;
}
.vp-mode-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.45;
  margin-top: 8px;
  max-width: 520px;
}
.sb-ctrl-mode-btn.el-button {
  border-color: rgba(34, 197, 94, 0.35);
  color: #86efac;
  background: rgba(34, 197, 94, 0.08);
}
.sb-ctrl-mode-btn.el-button:hover {
  border-color: #22c55e;
  color: #fff;
  background: rgba(34, 197, 94, 0.45);
}
html.light .sb-ctrl-mode-btn.el-button {
  border-color: rgba(22, 163, 74, 0.35);
  color: #15803d;
  background: rgba(22, 163, 74, 0.06);
}
html.light .sb-ctrl-mode-btn.el-button:hover {
  border-color: #16a34a;
  color: #fff;
  background: #16a34a;
}
/* 有四宫格或多图时，image-area 改为纵向滚动布局 */
.sb-image-area--first-last {
  min-height: 220px;
  max-height: none;
  padding: 8px;
  align-items: stretch;
  justify-content: flex-start;
}
.sb-fl-dual {
  display: flex;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  flex: 1;
  min-height: 180px;
}
.sb-fl-slot {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sb-fl-slot-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: #a78bfa;
  text-align: center;
}
.sb-fl-slot-body {
  flex: 1;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  overflow: hidden;
}
.sb-fl-slot-body .sb-generated-img {
  max-height: 160px;
}
.sb-fl-empty {
  font-size: 0.75rem;
  color: #71717a;
}
.sb-fl-arrow {
  flex-shrink: 0;
  align-self: center;
  font-size: 1.25rem;
  color: #a78bfa;
  opacity: 0.85;
}
.sb-fl-slot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  align-items: center;
}
.sb-fl-first-lock-opt {
  margin: 0 2px;
  height: auto;
}
.sb-fl-first-lock-opt :deep(.el-checkbox__label) {
  font-size: 12px;
  padding-left: 4px;
}
.sb-fl-slot-prompt {
  font-size: 0.68rem;
  line-height: 1.35;
  color: #9ca3af;
  max-height: 2.7em;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  padding: 0 4px;
  word-break: break-all;
}
.sb-image-area--has-quad {
  flex-direction: column;
  align-items: stretch;
  overflow-y: auto;
  max-height: 340px;
}
/* 普通多图缩略图条 */
.sb-imgs-strip {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 8px 4px;
  overflow-x: auto;
  border-top: 1px solid var(--el-border-color-lighter);
  flex-shrink: 0;
}
.sb-strip-hint-icon {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  cursor: default;
  transition: color 0.15s;
}
.sb-strip-hint-icon:hover {
  color: var(--el-color-primary);
}
.sb-img-thumb {
  position: relative;
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.2s;
  flex-shrink: 0;
  width: 52px;
  height: 52px;
}
.sb-img-thumb:hover { border-color: var(--el-color-primary); }
.sb-img-thumb--current {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px rgba(64, 158, 255, 0.35);
}
.sb-img-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.sb-img-thumb-label {
  position: absolute;
  bottom: 1px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 10px;
  color: #fff;
  background: rgba(0,0,0,0.45);
  pointer-events: none;
}
/* 主图容器 */
.sb-main-image-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 80px;
}
/* 主图下方提示词预览 */
.sb-main-img-prompt {
  width: 100%;
  font-size: 10px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border-top: 1px solid var(--el-border-color-lighter);
  padding: 4px 6px;
  line-height: 1.4;
  max-height: 48px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  word-break: break-all;
  cursor: default;
}
/* 四宫格整图作为上方预览时稍微缩小 */
.sb-quad-preview { max-height: 160px; }
/* 四宫格拆分中占位 */
.quad-splitting-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 8px;
}
.sb-image-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-shrink: 0;
  padding-top: 6px;
}
.sb-video-area {
  flex: 1;
  min-height: 200px;
  background: linear-gradient(145deg, #1a1b24 0%, #1e1f28 60%, #1c1d26 100%);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s;
}
html.light .sb-video-area {
  background: linear-gradient(145deg, #f5f3ff 0%, #ede9fe 100%);
  border-color: rgba(124,58,237,0.2);
}
.sb-video-placeholder {
  color: #71717a;
  font-size: 0.9rem;
  flex-direction: column;
  gap: 10px;
  text-align: center;
  padding: 16px;
}
html.light .sb-video-placeholder {
  color: #7c3aed;
}
.sb-video-generating-text {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #409eff;
  font-size: 0.85rem;
}
.sb-video-error {
  color: #f56c6c;
  font-size: 0.75rem;
  line-height: 1.4;
  word-break: break-word;
  max-height: 80px;
  overflow-y: auto;
  padding: 4px 8px;
  background: rgba(245, 108, 108, 0.08);
  border-radius: 4px;
  text-align: left;
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}
.sb-resume-poll-btn {
  flex-shrink: 0;
}
.sb-video-player {
  width: 100%;
  max-height: 240px;
  border-radius: 8px;
}
.sb-video-review-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}
html.light .sb-video-review-bar {
  background: rgba(0, 0, 0, 0.03);
}
.sb-video-review-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary, #909399);
}
.sb-video-review-hint {
  font-size: 12px;
  color: #ef4444;
}
.sb-panel.sb-video.sb-video--revise {
  outline: 2px solid #ef4444;
  outline-offset: -2px;
  background: rgba(239, 68, 68, 0.08);
}
html.light .sb-panel.sb-video.sb-video--revise {
  background: rgba(239, 68, 68, 0.06);
}
.storyboard-row--video-revise {
  box-shadow: inset 3px 0 0 #ef4444;
}
.sb-workflow-step-status--revise {
  color: #ef4444 !important;
  font-weight: 600;
}
.sb-video-actions {

  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-shrink: 0;
  padding-top: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.sb-video-model-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}
.sb-video-regenerating-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 6px;
  font-size: 0.82rem;
  color: #a78bfa;
}
.sb-videos-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.sb-video-thumb {
  position: relative;
  width: 72px;
  height: 48px;
  border-radius: 5px;
  overflow: hidden;
  cursor: pointer;
  border: 1.5px solid transparent;
  flex-shrink: 0;
  transition: border-color 0.15s;
}
.sb-video-thumb:hover {
  border-color: #a855f7;
}
.sb-video-thumb--current {
  border-color: #a855f7;
  box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.35);
}
.sb-video-thumb-player {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.sb-video-thumb-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0,0,0,0.55);
  color: #e4e4e7;
  font-size: 0.65rem;
  text-align: center;
  padding: 1px 0;
  pointer-events: none;
}
.sb-video-prompt-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.sb-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a855f7;
  flex-shrink: 0;
}
.sb-video-prompt-label > span:not(.sb-dot) { font-size: 0.85rem; color: #e4e4e7; }
.sb-video-params-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 4px 0;
}
.sb-video-params-bar .sb-video-prompt-text {
  flex: 1;
  min-width: 0;
}
.sb-video-log {
  margin: 6px 0 4px;
  border: 1px solid rgba(63, 63, 70, 0.9);
  border-radius: 6px;
  background: rgba(24, 24, 27, 0.85);
  overflow: hidden;
}
.sb-video-log-body {
  margin: 0;
  padding: 4px 8px;
  max-height: 3em; /* 两行：line-height 1.5 × 2 */
  overflow-x: hidden;
  overflow-y: auto;
  font-size: 11px;
  line-height: 1.5;
  color: #a1a1aa;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.sb-video-prompt-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}
.sb-video-prompt-row .sb-video-prompt-text {
  flex: 1;
  min-width: 0;
}
.vp-dialog-form .el-form-item {
  margin-bottom: 12px;
}
.sb-video-prompt-text {
  font-size: 0.85rem;
  color: #a1a1aa;
  line-height: 1.5;
  padding: 8px 0;
}
.sb-video-prompt-text--preview {
  display: block;
  max-height: 3em; /* 两行高，超出可滚动 */
  overflow-x: hidden;
  overflow-y: auto;
  word-break: break-all;
  white-space: pre-wrap;
  padding: 4px 0;
}
.sb-video-prompt-edit {
  margin-bottom: 8px;
}
.sb-video-prompt-edit .el-textarea { margin-bottom: 8px; }
.sb-video-prompt-edit-actions { display: flex; gap: 8px; }
.sb-generate-video-btn { margin-top: 0; }
.sb-prompt-label { display: flex; align-items: center; gap: 8px; margin: 10px 0 6px; }
.sb-prompt-label .sb-dot { flex-shrink: 0; }
.sb-prompt-label > span:not(.sb-dot) { font-size: 0.85rem; color: #e4e4e7; }
.sb-prompt-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
.sb-prompt-row .sb-prompt-text { flex: 1; min-width: 0; font-size: 0.85rem; color: #a1a1aa; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sb-prompt-hint-inline { margin-left: 8px; font-size: 0.72rem; font-weight: normal; color: #71717a; }
.sb-image-prompt-edit .el-textarea { margin-bottom: 6px; }
.sb-prompt-edit-actions { display: flex; gap: 8px; }
.sb-video-fields-collapse { margin: 8px 0; }
.sb-video-fields-collapse .el-collapse-item__header { font-size: 0.9rem; }
.sb-prompt-section-title { font-size: 0.9rem; font-weight: 600; color: #e4e4e7; margin-bottom: 8px; }
.sb-prompt-section-title--row { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.vp-video-prompt-hint { font-size: 12px; color: #909399; line-height: 1.5; }
.sb-split-audio-tip { font-size: 12px; color: #64748b; line-height: 1.45; margin: 0 0 8px; }
.sb-split-audio-row { display: flex; flex-direction: column; align-items: flex-start; }
.sb-prompt-dialog-form .el-form-item { margin-bottom: 10px; }
.sb-collapse-title { color: #a1a1aa; }
.sb-video-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; padding: 8px 0; }
.sb-field { display: flex; flex-direction: column; gap: 4px; }
.sb-field-full { grid-column: 1 / -1; }
.sb-field-label { font-size: 0.8rem; color: #a1a1aa; }
.sb-field-select { width: 100%; }
.sb-video-fields-actions { grid-column: 1 / -1; margin-top: 8px; }
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px 24px;
  margin-bottom: 16px;
}
.video-option-hint {
  flex: 1;
  min-width: 200px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--el-text-color-secondary);
}
.video-option-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 12px;
}
.video-option-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  max-width: 640px;
}
.video-watermark-input {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}
.indextts-config-block {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.indextts-main-item {
  margin-bottom: 8px;
}
.indextts-controls {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px 20px;
  margin-bottom: 12px;
}
.indextts-emotion-input {
  min-width: 260px;
  max-width: 480px;
}
.indextts-clone-panel {
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}
.indextts-clone-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.indextts-clone-tip {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.45;
}
.indextts-clone-form {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px 16px;
  margin-bottom: 12px;
}
.indextts-ref-path {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.indextts-clone-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 8px;
}
.indextts-clone-empty {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 8px 0;
}
.indextts-clone-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.indextts-clone-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}
.indextts-clone-row:last-child {
  border-bottom: none;
}
.indextts-clone-row code {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.config-tip {
  margin: 12px 0 0;
  font-size: 0.9rem;
  color: #a1a1aa;
}
.config-tip .el-link { font-size: inherit; }
.sb-truncated-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 14px;
  background: rgba(234, 179, 8, 0.12);
  border: 1px solid rgba(234, 179, 8, 0.4);
  border-radius: 8px;
  color: #fbbf24;
  font-size: 0.875rem;
  line-height: 1.5;
}
.sb-truncated-warning .el-icon {
  flex-shrink: 0;
  font-size: 1rem;
  color: #fbbf24;
}
.sb-truncated-warning span {
  flex: 1;
}
.sb-prompt-coverage-bar {
  margin-bottom: 14px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid rgba(96, 165, 250, 0.35);
  background: rgba(59, 130, 246, 0.08);
  font-size: 0.84rem;
  line-height: 1.5;
  color: #cbd5e1;
}
.sb-prompt-coverage-bar--complete {
  border-color: rgba(74, 222, 128, 0.35);
  background: rgba(34, 197, 94, 0.08);
}
.sb-prompt-coverage-bar--partial {
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(234, 179, 8, 0.1);
}
.sb-prompt-coverage-bar--pending {
  border-color: rgba(161, 161, 170, 0.35);
  background: rgba(113, 113, 122, 0.1);
}
.sb-prompt-coverage-bar--generating {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(59, 130, 246, 0.12);
}
.sb-prompt-coverage-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}
.sb-prompt-coverage-title {
  font-weight: 600;
  color: #e4e4e7;
}
.sb-prompt-coverage-lines {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sb-prompt-coverage-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.sb-prompt-coverage-ok {
  color: #86efac;
}
.sb-prompt-coverage-note {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: #a1a1aa;
}
.sb-prompt-coverage-live {
  margin: 6px 0 0;
  font-size: 0.78rem;
  color: #93c5fd;
}
.sb-prompt-status-tag {
  margin-left: 4px;
  vertical-align: middle;
}
html.light .sb-prompt-coverage-bar {
  color: #374151;
  border-color: rgba(59, 130, 246, 0.25);
  background: rgba(239, 246, 255, 0.9);
}
html.light .sb-prompt-coverage-bar--complete {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(240, 253, 244, 0.95);
}
html.light .sb-prompt-coverage-bar--partial {
  border-color: rgba(234, 179, 8, 0.4);
  background: rgba(254, 252, 232, 0.95);
}
html.light .sb-prompt-coverage-title {
  color: #1e1b4b;
}
html.light .sb-prompt-coverage-ok {
  color: #15803d;
}
html.light .sb-prompt-coverage-note {
  color: #6b7280;
}
html.light .sb-prompt-coverage-live {
  color: #2563eb;
}
/* 分镜生成中提示条 */
.storyboard-generating-tip {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 10px;
  padding: 12px 14px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.storyboard-generating-tip-body,
.sb-generating-tip-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.universal-omni-polish-progress {
  width: 100%;
  max-width: 420px;
}
.sb-universal-stream-progress {
  margin-top: 8px;
  width: 100%;
}
.sb-generating-tip {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 12px 18px;
  margin-top: 10px;
  background: rgba(139, 92, 246, 0.08);
  border: 1px dashed rgba(139, 92, 246, 0.35);
  border-radius: 10px;
  color: #a78bfa;
  font-size: 0.9rem;
}
.sb-gen-text {
  flex: 1;
  letter-spacing: 0.03em;
}
.sb-gen-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a78bfa;
  animation: sb-dot-bounce 1.2s infinite ease-in-out both;
}
.sb-gen-dot:nth-child(1) { animation-delay: 0s; }
.sb-gen-dot:nth-child(2) { animation-delay: 0.2s; }
.sb-gen-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes sb-dot-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40%            { transform: scale(1);   opacity: 1;   }
}
.sb-limit-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.sb-limit-status {
  font-size: 0.82rem;
  color: #a1a1aa;
}
.sb-limit-status--cleared {
  color: #4ade80;
  font-weight: 600;
}
.sb-estimate-tag {
  margin-left: 4px;
  font-size: 0.75rem;
  color: #71717a;
  cursor: help;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}
.sb-dubbing-block {
  margin: -6px 0 12px;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(124, 58, 237, 0.08);
  border: 1px solid rgba(124, 58, 237, 0.18);
}
.sb-dubbing-config {
  margin-top: 10px;
}
.sb-dubbing-config-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.sb-dubbing-config-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: #e4e4e7;
}
.sb-dubbing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed rgba(124, 58, 237, 0.22);
}
.sb-dubbing-resync-row {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed rgba(124, 58, 237, 0.22);
}
/* 分镜五步工作流 */
.sb-workflow {
  margin: 12px 0 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sb-workflow-step {
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid rgba(113, 113, 122, 0.35);
  background: rgba(39, 39, 42, 0.45);
}
.sb-workflow-step-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.sb-workflow-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  color: #e4e4e7;
  background: rgba(99, 102, 241, 0.35);
  border: 1px solid rgba(129, 140, 248, 0.5);
  flex-shrink: 0;
}
.sb-workflow-step-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: #e4e4e7;
}
.sb-workflow-step-status {
  font-size: 0.78rem;
  color: #a1a1aa;
}
.sb-workflow-step-status--ok {
  color: #86efac;
}
.sb-workflow-step-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.sb-workflow-step-hint {
  font-size: 0.78rem;
  color: #a1a1aa;
  line-height: 1.5;
}
.sb-workflow-video-options {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  font-size: 13px;
}
.sb-workflow-video-options-label {
  color: #a1a1aa;
}
.sb-workflow-section {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 8px;
}
.sb-workflow-section--complete {
  border: 1px dashed rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.06);
}
.sb-workflow-section--clear {
  border: 1px dashed rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.06);
}
.sb-workflow-section-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: #d4d4d8;
  min-width: 36px;
  padding-top: 4px;
  flex-shrink: 0;
}
.sb-workflow-section-btns {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
}
html.light .sb-workflow-step {
  background: rgba(249, 250, 251, 0.95);
  border-color: rgba(209, 213, 219, 0.9);
}
html.light .sb-workflow-step-num {
  color: #312e81;
  background: rgba(199, 210, 254, 0.6);
  border-color: rgba(129, 140, 248, 0.45);
}
html.light .sb-workflow-step-title {
  color: #1f2937;
}
html.light .sb-workflow-step-status {
  color: #6b7280;
}
html.light .sb-workflow-step-status--ok {
  color: #15803d;
}
html.light .sb-workflow-step-hint {
  color: #6b7280;
}
html.light .sb-workflow-section-label {
  color: #374151;
}
html.light .sb-workflow-section--complete {
  border-color: rgba(59, 130, 246, 0.25);
  background: rgba(239, 246, 255, 0.85);
}
html.light .sb-workflow-section--clear {
  border-color: rgba(239, 68, 68, 0.25);
  background: rgba(254, 242, 242, 0.85);
}
.sb-voice-select-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sb-voice-option-id {
  float: right;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.sb-full-narration-block {
  margin: -6px 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(124, 58, 237, 0.08);
  border: 1px solid rgba(124, 58, 237, 0.18);
}
.sb-full-narration-hint {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.55;
  color: #a1a1aa;
  white-space: normal;
  word-break: break-word;
}
.sb-full-narration-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.sb-full-narration-speed-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.sb-full-narration-speed-label {
  font-size: 0.82rem;
  color: #d4d4d8;
}
.sb-full-narration-speed-hint {
  font-size: 0.76rem;
  color: #a1a1aa;
  line-height: 1.45;
}
.sb-export-actions-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
}
.sb-config-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.sb-narration-export-row {
  margin-top: 10px;
}
.sb-config-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sb-config-label {
  font-size: 0.85rem;
  color: #a1a1aa;
  white-space: nowrap;
}
.sb-config-input {
  width: 110px;
}
.sb-config-hint {
  font-size: 0.78rem;
  color: #52525b;
  white-space: nowrap;
}
.sb-config-hint--estimate {
  white-space: normal;
  max-width: 220px;
  line-height: 1.35;
}
.sb-config-divider {
  color: #3a3a44;
  font-size: 0.85rem;
  margin: 0 4px;
}
/* 解说导出行：避免浅色主题下勾选文案与卡片背景对比度不足 */
.sb-narration-export-row :deep(.el-checkbox) {
  flex: 1 1 100%;
  max-width: 100%;
  margin-right: 0;
  align-items: flex-start;
  height: auto;
}
.sb-narration-export-row :deep(.el-checkbox__label) {
  color: #e4e4e7;
  font-size: 0.875rem;
  line-height: 1.45;
  white-space: normal;
  word-break: break-word;
}
html.light .sb-dubbing-block,
html.light .sb-full-narration-block {
  background: rgba(124, 58, 237, 0.06);
  border-color: rgba(124, 58, 237, 0.15);
}
html.light .sb-dubbing-config-title {
  color: #374151;
}
html.light .sb-full-narration-hint {
  color: #52525b;
}
html.light .sb-narration-export-row :deep(.el-checkbox__label) {
  color: #374151;
}
.sb-export-srt-btn.el-button--primary.is-plain {
  --el-button-bg-color: rgba(124, 58, 237, 0.75);
  --el-button-border-color: #a78bfa;
  --el-button-text-color: #fff;
  --el-button-hover-text-color: #fff;
  --el-button-hover-bg-color: #8b5cf6;
  --el-button-hover-border-color: #c4b5fd;
}
html.light .sb-export-srt-btn.el-button--primary.is-plain {
  --el-button-bg-color: #7c3aed;
  --el-button-border-color: #6d28d9;
  --el-button-text-color: #fff;
  --el-button-hover-text-color: #fff;
  --el-button-hover-bg-color: #6d28d9;
  --el-button-hover-border-color: #5b21b6;
}
.sb-narration-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.sb-narration-label-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sb-narration-stats {
  font-size: 12px;
  line-height: 1.4;
  color: #a1a1aa;
  white-space: nowrap;
}
.sb-narration-stats--dialog {
  margin-top: 6px;
}
.sb-narration-stats--near-max {
  color: #fbbf24;
}
.sb-narration-stats--over-max {
  color: #f87171;
  font-weight: 600;
}
html.light .sb-narration-stats {
  color: #71717a;
}
html.light .sb-narration-stats--near-max {
  color: #d97706;
}
html.light .sb-narration-stats--over-max {
  color: #dc2626;
}
.sb-narration-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.sb-narration-audio {
  display: block;
  width: 100%;
  max-width: 360px;
  height: 32px;
  margin-top: 6px;
}
/* 分镜内解说旁白输入框：强制字/底对比，避免主题变量与页面继承冲突导致「看不见字」 */
.sb-narration-input :deep(.el-textarea__inner) {
  color: #e4e4e7 !important;
  background-color: rgba(24, 24, 27, 0.85) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  box-shadow: none;
}
.sb-narration-input :deep(.el-textarea__inner::placeholder) {
  color: #71717a !important;
}
html.light .sb-narration-input :deep(.el-textarea__inner) {
  color: #1e1b4b !important;
  background-color: #ffffff !important;
  border-color: rgba(139, 92, 246, 0.22) !important;
}
html.light .sb-narration-input :deep(.el-textarea__inner::placeholder) {
  color: #9ca3af !important;
}
.sub-title {
  font-size: 1rem;
  margin: 16px 0 8px;
  color: #e4e4e7;
}
.video-progress, .video-done, .video-error {
  margin-top: 16px;
}
.video-preview-wrap {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.video-preview-label {
  margin: 0 0 10px;
  font-size: 0.95rem;
  color: #a1a1aa;
}
.video-preview-player {
  display: block;
  max-width: 100%;
  max-height: 360px;
  border-radius: 8px;
  background: #1a1b24;
}
.bgm-panel {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.bgm-acestep-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.intro-panel {
  margin: 0 0 24px;
  padding: 16px 16px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}
.intro-panel-title {
  margin: 0 0 8px;
  font-size: 1.05rem;
  font-weight: 600;
}
.intro-panel-hint {
  margin: 0 0 14px;
  font-size: 0.88rem;
  color: #a1a1aa;
  line-height: 1.5;
}
.intro-form {
  max-width: 720px;
}
.intro-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 4px 0 12px;
}
.intro-readiness {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
}
.intro-readiness-label {
  font-size: 0.88rem;
  color: #a1a1aa;
  margin-right: 4px;
}
.intro-audio-preview {
  width: 100%;
  max-width: 420px;
}
.intro-prompt-preview {
  margin: 0;
  padding: 10px 12px;
  font-size: 0.82rem;
  line-height: 1.55;
  color: #d4d4d8;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow: auto;
}
.intro-status-hint {
  font-size: 0.85rem;
  color: #93c5fd;
  margin-bottom: 10px;
}
.intro-preview-row {
  margin: 12px 0;
}
.intro-preview-img {
  display: block;
  max-width: 320px;
  max-height: 200px;
  border-radius: 8px;
  object-fit: cover;
  background: #1a1b24;
}
.intro-video-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.intro-video-preview-head .video-preview-label {
  margin: 0;
}
.intro-video-strip {
  margin-top: 10px;
}
.bgm-panel-title {
  margin: 0 0 8px;
  font-size: 1.1rem;
  font-weight: 600;
}
.bgm-panel-hint {
  margin: 0 0 14px;
  font-size: 0.88rem;
  color: #a1a1aa;
  line-height: 1.5;
}
.bgm-form {
  max-width: 720px;
}
.bgm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 8px 0 12px;
}
.bgm-mood-hint {
  font-size: 0.85rem;
  color: #fbbf24;
  margin-bottom: 10px;
}
.bgm-library {
  margin-top: 8px;
}
.bgm-library-label {
  margin: 0 0 8px;
  color: #a1a1aa;
  font-size: 0.9rem;
}
.bgm-library-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.bgm-library-status {
  font-size: 0.8rem;
  color: #71717a;
  min-width: 72px;
}
.bgm-library-title {
  flex: 1;
  min-width: 120px;
  font-size: 0.9rem;
}
.bgm-audio {
  height: 32px;
  max-width: 220px;
}
.bgm-library-err {
  color: #f87171;
  font-size: 0.8rem;
  width: 100%;
}
.bgm-video-preview {
  margin-top: 16px;
}

/* 公共库弹窗 */
.library-dialog .el-dialog__body { padding-top: 8px; }
.sd2-cert-dialog .el-dialog__body { padding-top: 10px; }
.sd2-cert-desc :deep(.el-descriptions__cell) {
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.sd2-cert-value {
  display: inline-block;
  max-width: 100%;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.library-toolbar { margin-bottom: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.library-team-hint { font-size: 12px; color: var(--el-text-color-secondary); }
.library-team-hint--warn { color: var(--el-color-warning); }
.char-library-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.library-item-sub { font-size: 12px; color: var(--el-text-color-secondary); font-weight: normal; }
.library-list {
  min-height: 200px;
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.library-item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px;
  background: #1e1f28;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}
.library-item-cover {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  background: #252630;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.library-item-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.library-item-placeholder {
  font-size: 0.8rem;
  color: #5a5a66;
}
.library-item-info { flex: 1; min-width: 0; }
.library-item-name { font-weight: 500; margin-bottom: 4px; }
.library-item-desc { font-size: 0.85rem; color: #7a7a88; margin-bottom: 8px; }
.library-item-actions { display: flex; gap: 8px; }
.library-empty {
  text-align: center;
  color: #5a5a66;
  padding: 40px 20px;
}
.library-pagination {
  margin-top: 12px;
  display: flex;
  justify-content: center;
}
.sb-pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 8px 0 14px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.06);
}
.sb-pagination-bar--bottom {
  margin: 14px 0 4px;
  justify-content: center;
}
.sb-pagination-summary {
  font-size: 13px;
  color: #6b7280;
}
html.light .sb-pagination-bar {
  background: #f3f4f6;
}
.library-placeholder {
  padding: 40px 20px;
  text-align: center;
  color: #5a5a66;
}

/* 专业帧提示词弹窗 - 干净美观版 */
.sb-frame-prompt-clean .el-message-box__content {
  padding: 16px 20px 8px;
}
.sb-prompt-clean-body {
  max-width: 680px;
  min-width: 480px;
}
.sb-prompt-pre {
  margin: 0 0 12px 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  line-height: 1.65;
  color: #e2e8f0;
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 8px;
  padding: 14px 16px;
  max-height: 420px;
  overflow-y: auto;
}
html.light .sb-prompt-pre {
  color: #1e2937;
  background: #f8fafc;
  border-color: #cbd5e1;
}
.sb-prompt-meta-line {
  font-size: 11px;
  color: #64748b;
  padding: 0 4px 8px;
  line-height: 1.4;
}
html.light .sb-prompt-meta-line {
  color: #64748b;
}

/* 首尾帧提示词编辑器 */
.frame-prompt-editor-body {
  padding: 4px 0;
}
.frame-prompt-editor-hint {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 10px;
  line-height: 1.5;
}
html.light .frame-prompt-editor-hint {
  color: #475569;
}
.frame-prompt-editor-instruction {
  margin-bottom: 8px;
}
.frame-prompt-editor-textarea :deep(.el-textarea__inner) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  line-height: 1.65;
}

/* 空间布局锚点展示（首尾帧一致性合同） */
.frame-layout-anchor {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
}
html.light .frame-layout-anchor {
  background: #f1f5f9;
  border-color: #cbd5e1;
}
.frame-layout-anchor-label {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 4px;
}
.frame-layout-anchor-text {
  font-size: 12.5px;
  line-height: 1.5;
  color: #1e293b;
  background: #fff;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}
.frame-layout-anchor-note {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.4;
}
</style>
