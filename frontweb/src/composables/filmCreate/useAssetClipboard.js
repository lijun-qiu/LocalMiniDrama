import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { assetImageUrl } from '@/utils/mediaUrl'
import {
  copyTextToClipboard,
  copyImageUrlToClipboard,
  downloadImagePack,
  STORYBOARD_PROMPT_COPY_BATCH_SIZE,
  buildStoryboardCopyBatchOptions,
  buildStoryboardPromptBatchText,
} from '@/utils/clipboard'

function charDescription(char) {
  return (char?.appearance || char?.description || '').toString().trim()
}

function sceneDescription(scene) {
  return (scene?.description || scene?.prompt || scene?.time || '').toString().trim()
}

function propDescription(prop) {
  return (prop?.description || prop?.prompt || '').toString().trim()
}

function hasAssetImage(item) {
  if (!item) return false
  return !!(item.image_url || item.local_path)
}

function listAssetPackItems(characters, scenes, props) {
  const out = []
  for (const c of characters || []) {
    if (!hasAssetImage(c)) continue
    const src = assetImageUrl(c)
    if (!src) continue
    out.push({ kind: 'character', label: c.name || '角色', src })
  }
  for (const s of scenes || []) {
    if (!hasAssetImage(s)) continue
    const src = assetImageUrl(s)
    if (!src) continue
    out.push({ kind: 'scene', label: s.location || '场景', src })
  }
  for (const p of props || []) {
    if (!hasAssetImage(p)) continue
    const src = assetImageUrl(p)
    if (!src) continue
    out.push({ kind: 'prop', label: p.name || '道具', src })
  }
  return out
}

export function useAssetClipboard({ storyboards, sbImagePromptPreview, characters, scenes, props }) {
  const storyboardCopyBatchIndex = ref(1)
  const assetPackDownloading = ref(false)

  const storyboardCopyBatchData = computed(() => {
    const getPrompt = (sb) => sbImagePromptPreview(sb)
    const getNo = (sb) => {
      const n = sb?.storyboard_number ?? sb?.id
      return String(n ?? '').padStart(2, '0')
    }
    return buildStoryboardCopyBatchOptions(storyboards.value, getPrompt, getNo)
  })

  const storyboardCopyBatchOptions = computed(() => storyboardCopyBatchData.value.options)

  const storyboardPromptCopyCount = computed(() => storyboardCopyBatchData.value.list.length)

  const assetPackItems = computed(() =>
    listAssetPackItems(characters?.value, scenes?.value, props?.value)
  )

  const assetPackImageCount = computed(() => assetPackItems.value.length)

  async function copyCharDescription(char) {
    const text = charDescription(char)
    if (!text) {
      ElMessage.warning('暂无描述词')
      return
    }
    const ok = await copyTextToClipboard(text)
    if (ok) ElMessage.success(`已复制「${char?.name || '角色'}」描述词`)
    else ElMessage.error('复制失败，请手动复制')
  }

  async function copySceneDescription(scene) {
    const text = sceneDescription(scene)
    if (!text) {
      ElMessage.warning('暂无描述词')
      return
    }
    const ok = await copyTextToClipboard(text)
    if (ok) ElMessage.success(`已复制「${scene?.location || '场景'}」描述词`)
    else ElMessage.error('复制失败，请手动复制')
  }

  async function copyPropDescription(prop) {
    const text = propDescription(prop)
    if (!text) {
      ElMessage.warning('暂无描述词')
      return
    }
    const ok = await copyTextToClipboard(text)
    if (ok) ElMessage.success(`已复制「${prop?.name || '道具'}」描述词`)
    else ElMessage.error('复制失败，请手动复制')
  }

  async function copyAllDescriptions(items, getLabel, getDesc, typeLabel) {
    const blocks = (items || [])
      .map((item) => {
        const desc = getDesc(item)
        if (!desc) return ''
        return `【${getLabel(item)}】\n${desc}`
      })
      .filter(Boolean)
    if (!blocks.length) {
      ElMessage.warning('暂无描述词')
      return
    }
    const ok = await copyTextToClipboard(blocks.join('\n\n'))
    if (ok) ElMessage.success(`已复制全部 ${blocks.length} 条${typeLabel}描述词`)
    else ElMessage.error('复制失败，请手动复制')
  }

  function copyAllCharDescriptions(characters) {
    return copyAllDescriptions(
      characters,
      (c) => c.name || '角色',
      charDescription,
      '角色'
    )
  }

  function copyAllSceneDescriptions(scenes) {
    return copyAllDescriptions(
      scenes,
      (s) => s.location || '场景',
      sceneDescription,
      '场景'
    )
  }

  function copyAllPropDescriptions(props) {
    return copyAllDescriptions(
      props,
      (p) => p.name || '道具',
      propDescription,
      '道具'
    )
  }

  async function copyAssetImage(item, label) {
    const src = assetImageUrl(item)
    if (!src) {
      ElMessage.info(`${label}暂无图片`)
      return
    }
    try {
      await copyImageUrlToClipboard(src)
      ElMessage.success(`已复制「${label}」图片`)
    } catch (e) {
      const msg = String(e?.message || e || '')
      if (/denied|permission|NotAllowed/i.test(msg)) {
        ElMessage.error('剪贴板权限被拒绝：请允许本站写入剪贴板后再试')
      } else {
        ElMessage.error(msg || '复制图片失败')
      }
    }
  }

  function copyCharImage(char) {
    return copyAssetImage(char, char?.name || '角色')
  }

  function copySceneImage(scene) {
    return copyAssetImage(scene, scene?.location || '场景')
  }

  function copyPropImage(prop) {
    return copyAssetImage(prop, prop?.name || '道具')
  }

  async function downloadAllAssetImages() {
    const items = assetPackItems.value
    if (!items.length) {
      ElMessage.info('暂无已生成的角色/场景/道具图片')
      return
    }
    assetPackDownloading.value = true
    try {
      const ok = await downloadImagePack(items)
      if (ok === items.length) {
        ElMessage.success(`已下载 ${ok} 张分图（角色→场景→道具）`)
      } else if (ok > 0) {
        ElMessage.warning(`已下载 ${ok}/${items.length} 张，部分失败请重试`)
      } else {
        ElMessage.error('分图下载失败')
      }
    } finally {
      assetPackDownloading.value = false
    }
  }

  async function copyStoryboardPrompt(sb) {
    const text = String(sbImagePromptPreview(sb) || '').trim()
    if (!text || text === '暂无图片提示词') {
      ElMessage.warning('暂无图片提示词')
      return
    }
    const no = sb?.storyboard_number ?? sb?.id
    const ok = await copyTextToClipboard(`【#${no}】\n${text}`)
    if (ok) ElMessage.success(`已复制分镜 #${no} 图片提示词`)
    else ElMessage.error('复制失败，请手动复制')
  }

  async function copyStoryboardPromptsBatch() {
    const { list } = storyboardCopyBatchData.value
    if (!list.length) {
      ElMessage.warning('暂无可复制的分镜描述词')
      return
    }
    const batchIdx = Math.max(1, Number(storyboardCopyBatchIndex.value) || 1)
    const start = (batchIdx - 1) * STORYBOARD_PROMPT_COPY_BATCH_SIZE
    const batch = list.slice(start, start + STORYBOARD_PROMPT_COPY_BATCH_SIZE)
    const getNo = (sb) => {
      const n = sb?.storyboard_number ?? sb?.id
      return String(n ?? '').padStart(2, '0')
    }
    const text = buildStoryboardPromptBatchText(batch, sbImagePromptPreview, getNo)
    if (!text) {
      ElMessage.warning('本批次暂无描述词')
      return
    }
    const ok = await copyTextToClipboard(text)
    if (!ok) {
      ElMessage.error('复制失败，请手动复制')
      return
    }
    const firstNo = getNo(batch[0])
    const lastNo = getNo(batch[batch.length - 1])
    ElMessage.success(`已复制 ${batch.length} 条分镜描述词（#${firstNo}-#${lastNo}）`)
  }

  const storyboardCopyBatchLabel = computed(() => {
    const opts = storyboardCopyBatchOptions.value
    const idx = Math.max(1, Number(storyboardCopyBatchIndex.value) || 1)
    return opts.find((o) => o.value === idx)?.label || ''
  })

  return {
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
  }
}
