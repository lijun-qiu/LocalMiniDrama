<script setup>
/**
 * ArcReel-aligned workflow plan panel — three axes kept separate.
 * Read-only projection + execute next_action.
 */
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dramaAPI } from '@/api/drama'

const props = defineProps({
  dramaId: { type: [Number, String], required: true },
  episodeNumber: { type: Number, default: 1 },
  collapsed: { type: Boolean, default: false },
})

const emit = defineEmits(['plan-updated', 'need-ui-action'])

const loading = ref(false)
const executing = ref(false)
const plan = ref(null)
const narrationDelivery = ref('post_production')
const errorMsg = ref('')

const STEP_LABELS = {
  project_input: '项目输入',
  selling_points: '卖点',
  asset_inventory: '资产盘点',
  episode_plan: '分集规划',
  step1_content: '内容整理',
  step1_review: '内容确认',
  final_script: '正式剧本',
  asset_sheets: '资产设定图',
  script_structure: '剧本结构',
  storyboard: '分镜图',
  narration_delivery: '旁白交付',
  video: '视频',
  export: '导出',
}

const STATE_LABELS = {
  completed: '已完成',
  ready: '可执行',
  active: '进行中',
  blocked: '受阻',
  pending: '等待',
  skipped: '不适用',
}

const ACTION_LABELS = {
  none: '无',
  collect_project_input: '填写项目/剧本',
  analyze_assets: '提取资产',
  plan_episodes: '规划分集',
  prepare_step1: '整理内容',
  confirm_step1: '确认内容',
  reset_step1: '重跑整理内容',
  reset_episode_planning: '重跑整理内容',
  propose_character_looks: '资产确认',
  generate_script: '生成正式剧本',
  generate_asset_sheets: '生成资产图',
  generate_storyboards: '生成分镜图',
  generate_grid: '生成宫格分镜',
  choose_narration_delivery: '选择旁白交付',
  generate_videos: '生成视频',
  generate_tts: '生成 TTS',
  wait_for_task: '等待任务',
  export: '合成导出',
}

const steps = computed(() => (plan.value?.steps || []).filter((s) => s.state !== 'skipped'))
const nextAction = computed(() => plan.value?.next_action)
const statusState = computed(() => plan.value?.status?.state || '—')
const modes = computed(() => plan.value?.status?.project || {})

async function refresh() {
  if (!props.dramaId) return
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await dramaAPI.getWorkflowPlan(props.dramaId, {
      episode: props.episodeNumber,
      narration_delivery: narrationDelivery.value,
    })
    // request interceptor already unwraps { success, data }
    plan.value = res?.steps ? res : res?.data || res
    emit('plan-updated', { plan: plan.value })
  } catch (e) {
    errorMsg.value = e?.message || '加载工作流失败'
  } finally {
    loading.value = false
  }
}

/** 整理已完成后直接打开核对弹窗（不必先点执行） */
function openStep1Review() {
  emit('need-ui-action', {
    ui: 'confirm_step1',
    message: '整理内容已就绪，请核对分场与对白（超 12s 台词会标红）',
    episode_id: null,
  })
}

async function runNext(extraBody = {}) {
  if (!props.dramaId || !nextAction.value) return
  const t = nextAction.value.type
  if (t === 'choose_narration_delivery') {
    // Selection already bound; re-fetch plan with delivery so next_action advances.
    await refresh()
    if (plan.value?.next_action?.type === 'choose_narration_delivery') {
      ElMessage.info('请确认旁白交付方式后再次执行')
    }
    return
  }
  // 确认内容：先打开核对弹窗，真正盖章走弹窗内「确认并继续」
  if (t === 'confirm_step1' && extraBody?.confirmed !== true && extraBody?.confirm !== true) {
    openStep1Review()
    return
  }
  executing.value = true
  try {
    const res = await dramaAPI.executeWorkflow(props.dramaId, {
      episode: props.episodeNumber,
      narration_delivery: narrationDelivery.value,
      ...(extraBody && typeof extraBody === 'object' ? extraBody : {}),
    })
    const data = res?.executed != null ? res : res?.data || res
    plan.value = data.plan || plan.value
    emit('plan-updated', { plan: plan.value, executed: data.executed, ok: data.ok !== false, detail: data.detail })
    if (data.ok === false && data.detail?.ui) {
      emit('need-ui-action', data.detail)
      if (data.detail.ui !== 'confirm_step1') {
        ElMessage.warning(data.detail.message || '需要在界面完成该步骤')
      }
    } else if (data.ok) {
      ElMessage.success(`已执行：${ACTION_LABELS[data.executed] || data.executed}`)
      // 整理内容后立刻弹出确认，避免再点一次才看到核对界面
      const nextType = data.plan?.next_action?.type || data.plan_after?.next_action?.type
      if (data.executed === 'prepare_step1' && nextType === 'confirm_step1') {
        const again = await dramaAPI.executeWorkflow(props.dramaId, {
          episode: props.episodeNumber,
          narration_delivery: narrationDelivery.value,
        })
        const againData = again?.executed != null ? again : again?.data || again
        plan.value = againData.plan || plan.value
        emit('plan-updated', {
          plan: plan.value,
          executed: againData.executed,
          ok: againData.ok !== false,
          detail: againData.detail,
        })
        if (againData.ok === false && againData.detail?.ui === 'confirm_step1') {
          emit('need-ui-action', againData.detail)
        }
      }
    }
  } catch (e) {
    ElMessage.error(e?.message || '执行失败')
  } finally {
    executing.value = false
  }
}

/** 回退到整理内容：清空本集 step1 / 正式剧本 / 分镜，并立刻重跑整理 */
async function reprepareStep1() {
  if (!props.dramaId) return
  if (
    !window.confirm(
      '将清空本集「整理内容 / 正式剧本 / 分镜」，然后重新整理。已生成的视频文件不会删除。是否继续？'
    )
  ) {
    return
  }
  executing.value = true
  try {
    const resetRes = await dramaAPI.executeWorkflow(props.dramaId, {
      episode: props.episodeNumber,
      narration_delivery: narrationDelivery.value,
      action_type: 'reset_step1',
    })
    const resetData = resetRes?.executed != null ? resetRes : resetRes?.data || resetRes
    plan.value = resetData.plan || plan.value
    emit('plan-updated', {
      plan: plan.value,
      executed: resetData.executed || 'reset_step1',
      ok: resetData.ok !== false,
      detail: resetData.detail,
    })

    const nextType = resetData.plan?.next_action?.type || resetData.plan_after?.next_action?.type
    if (nextType !== 'prepare_step1') {
      ElMessage.success(
        `已回退。下一步是「${ACTION_LABELS[nextType] || nextType}」，请先完成后再整理内容`
      )
      return
    }

    ElMessage.success('已回退，开始重新整理内容…')
    const prepRes = await dramaAPI.executeWorkflow(props.dramaId, {
      episode: props.episodeNumber,
      narration_delivery: narrationDelivery.value,
    })
    const prepData = prepRes?.executed != null ? prepRes : prepRes?.data || prepRes
    plan.value = prepData.plan || plan.value
    emit('plan-updated', {
      plan: plan.value,
      executed: prepData.executed,
      ok: prepData.ok !== false,
      detail: prepData.detail,
    })
    if (prepData.ok) {
      ElMessage.success('已重新整理内容')
      const afterType = prepData.plan?.next_action?.type || prepData.plan_after?.next_action?.type
      if (afterType === 'confirm_step1') {
        const again = await dramaAPI.executeWorkflow(props.dramaId, {
          episode: props.episodeNumber,
          narration_delivery: narrationDelivery.value,
        })
        const againData = again?.executed != null ? again : again?.data || again
        plan.value = againData.plan || plan.value
        emit('plan-updated', {
          plan: plan.value,
          executed: againData.executed,
          ok: againData.ok !== false,
          detail: againData.detail,
        })
        if (againData.ok === false && againData.detail?.ui === 'confirm_step1') {
          emit('need-ui-action', againData.detail)
        }
      }
    } else if (prepData.detail?.ui) {
      emit('need-ui-action', prepData.detail)
    }
  } catch (e) {
    ElMessage.error(e?.message || '重跑失败')
  } finally {
    executing.value = false
  }
}

defineExpose({ refresh, plan, runNext, reprepareStep1 })

function artifactHint(step) {
  const a = step.artifacts || {}
  if (a.state === 'not_applicable') return ''
  const bits = []
  if (a.state) bits.push(a.state)
  if (a.missing_ids?.length) bits.push(`缺${a.missing_ids.length}`)
  if (a.stale_ids?.length) bits.push(`旧${a.stale_ids.length}`)
  if (a.current_ids?.length) bits.push(`可用${a.current_ids.length}`)
  return bits.join(' · ')
}

watch(
  () => [props.dramaId, props.episodeNumber],
  () => refresh(),
  { immediate: true }
)
</script>

<template>
  <div class="wf-panel" :class="{ collapsed }">
    <div class="wf-header">
      <span v-if="!collapsed" class="wf-title">工作流</span>
      <button type="button" class="wf-icon-btn" title="刷新" :disabled="loading" @click="refresh">↻</button>
    </div>

    <template v-if="!collapsed">
      <div v-if="errorMsg" class="wf-error">{{ errorMsg }}</div>

      <div class="wf-meta">
        <span class="wf-chip">{{ modes.content_mode || '—' }}</span>
        <span class="wf-chip">{{ modes.generation_mode || '—' }}</span>
        <span class="wf-state">{{ statusState }}</span>
      </div>

      <div class="wf-delivery">
        <label>旁白交付</label>
        <select v-model="narrationDelivery" @change="refresh">
          <option value="post_production">后期配音</option>
          <option value="use_tts">使用 TTS</option>
        </select>
      </div>

      <div class="wf-next">
        <div class="wf-next-label">下一步</div>
        <div class="wf-next-type">{{ ACTION_LABELS[nextAction?.type] || nextAction?.type || '—' }}</div>
        <div v-if="nextAction?.reason" class="wf-next-reason">{{ nextAction.reason }}</div>
        <button
          v-if="nextAction?.type === 'propose_character_looks'"
          type="button"
          class="wf-run wf-run-wardrobe"
          :disabled="executing || loading"
          @click="runNext"
        >
          打开资产确认
        </button>
        <button
          v-else-if="nextAction?.type === 'confirm_step1'"
          type="button"
          class="wf-run wf-run-wardrobe"
          :disabled="executing || loading"
          @click="openStep1Review"
        >
          查看整理内容
        </button>
        <button
          v-else
          type="button"
          class="wf-run"
          :disabled="executing || loading || !nextAction || nextAction.type === 'none'"
          @click="runNext"
        >
          {{ executing ? '执行中…' : '执行下一步' }}
        </button>
        <button
          v-if="nextAction?.type === 'confirm_step1'"
          type="button"
          class="wf-run"
          :disabled="executing || loading"
          @click="runNext"
        >
          {{ executing ? '执行中…' : '确认内容' }}
        </button>
        <button
          type="button"
          class="wf-run wf-run-reset"
          :disabled="executing || loading"
          title="清空本集整理内容/正式剧本/分镜并重新整理"
          @click="reprepareStep1"
        >
          重跑整理内容
        </button>
      </div>

      <ul class="wf-steps">
        <li
          v-for="step in steps"
          :key="step.id"
          class="wf-step"
          :class="'st-' + step.state"
        >
          <span class="wf-step-id">{{ STEP_LABELS[step.id] || step.id }}</span>
          <span class="wf-step-state">{{ STATE_LABELS[step.state] || step.state }}</span>
          <span v-if="step.tasks?.length" class="wf-tasks">任务{{ step.tasks.length }}</span>
          <span v-if="artifactHint(step)" class="wf-art">{{ artifactHint(step) }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.wf-panel {
  margin: 8px 10px 12px;
  padding: 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.04);
  border: 1px solid rgba(15, 23, 42, 0.08);
  font-size: 12px;
  color: #1e293b;
}
.wf-panel.collapsed { padding: 6px; }
.wf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.wf-title { font-weight: 600; font-size: 13px; }
.wf-icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: 0.7;
}
.wf-meta { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.wf-chip {
  padding: 1px 6px;
  border-radius: 4px;
  background: #e2e8f0;
  font-size: 11px;
}
.wf-state { margin-left: auto; font-weight: 600; color: #0f766e; }
.wf-delivery {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.wf-delivery select {
  flex: 1;
  font-size: 12px;
  padding: 2px 4px;
}
.wf-next {
  padding: 8px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #cbd5e1;
  margin-bottom: 8px;
}
.wf-next-label { font-size: 11px; color: #64748b; }
.wf-next-type { font-weight: 600; margin: 2px 0; }
.wf-next-reason { color: #64748b; margin-bottom: 6px; line-height: 1.35; }
.wf-run {
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: #0f766e;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}
.wf-run:disabled { opacity: 0.5; cursor: not-allowed; }
.wf-run-wardrobe { background: #c2410c; }
.wf-run-reset {
  margin-top: 6px;
  background: transparent;
  color: #0f766e;
  border: 1px solid #0f766e;
}
.wf-steps { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow: auto; }
.wf-step {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(15, 23, 42, 0.06);
}
.wf-step-id { font-weight: 500; }
.wf-step-state { color: #64748b; font-size: 11px; }
.wf-art, .wf-tasks { grid-column: 1 / -1; color: #94a3b8; font-size: 10px; }
.st-completed .wf-step-state { color: #15803d; }
.st-ready .wf-step-state { color: #0369a1; }
.st-active .wf-step-state { color: #c2410c; }
.st-blocked .wf-step-state { color: #b91c1c; }
.st-skipped { opacity: 0.45; }
.wf-error { color: #b91c1c; margin-bottom: 6px; }
</style>
