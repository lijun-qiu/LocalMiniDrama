/** 复制纯文本到剪贴板，失败时回退到 execCommand */
export async function copyTextToClipboard(text) {
  const value = String(text ?? '').trim()
  if (!value) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }
}

async function blobToPngClipboardBlob(blob) {
  const bmp = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(bmp, 0, 0)
    const png = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 转换失败'))), 'image/png')
    })
    return png
  } finally {
    bmp.close?.()
  }
}

function normalizeFetchUrl(src) {
  const url = String(src || '').trim()
  if (!url) return ''
  if (url.startsWith('/') || url.startsWith('http')) return url
  return `/${url}`
}

/** 复制图片 URL 到剪贴板（image/png） */
export async function copyImageUrlToClipboard(src) {
  const url = normalizeFetchUrl(src)
  if (!url) throw new Error('暂无图片')
  if (!navigator?.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前浏览器不支持复制图片到剪贴板')
  }
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`读取图片失败 (${res.status})`)
  const raw = await res.blob()
  if (!raw || !String(raw.type || '').startsWith('image/')) {
    throw new Error('文件不是图片')
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [raw.type || 'image/png']: raw })])
  } catch {
    const blob = await blobToPngClipboardBlob(raw)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }
}

/** 从系统剪贴板读取第一张图片，返回 File；无图片或不受支持时抛错 */
export async function readImageFileFromClipboard() {
  if (!navigator?.clipboard?.read) {
    throw new Error('当前浏览器不支持从剪贴板读取图片（需 HTTPS 或 localhost）')
  }
  let items
  try {
    items = await navigator.clipboard.read()
  } catch (e) {
    const msg = String(e?.message || e || '')
    if (/denied|permission|NotAllowed/i.test(msg)) {
      throw new Error('剪贴板权限被拒绝：请允许本站读取剪贴板后再试')
    }
    throw new Error(msg || '读取剪贴板失败')
  }
  for (const item of items || []) {
    const type = (item.types || []).find((t) => String(t).startsWith('image/'))
    if (!type) continue
    const blob = await item.getType(type)
    if (!blob) continue
    const mime = blob.type || type
    const ext =
      mime === 'image/jpeg' || mime === 'image/jpg'
        ? 'jpg'
        : mime === 'image/webp'
          ? 'webp'
          : mime === 'image/gif'
            ? 'gif'
            : 'png'
    return new File([blob], `clipboard.${ext}`, { type: mime })
  }
  throw new Error('剪贴板中没有图片，请先复制一张图片')
}

/** 下载图片到本地 */
export async function downloadImageUrl(src, filename = 'image.png') {
  const url = normalizeFetchUrl(src)
  if (!url) throw new Error('暂无图片')
  const safeName = String(filename || 'image.png').replace(/[\\/:*?"<>|]/g, '_')
  try {
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res.ok) throw new Error(`下载失败 (${res.status})`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = safeName
    a.click()
    URL.revokeObjectURL(objectUrl)
  } catch {
    const a = document.createElement('a')
    a.href = url
    a.download = safeName
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
  }
}

/** 按顺序批量下载图片（01-标签.png…） */
export async function downloadImagePack(items) {
  const list = Array.isArray(items) ? items : []
  let ok = 0
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const url = normalizeFetchUrl(item?.src)
    if (!url) continue
    try {
      const res = await fetch(url, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`下载失败 (${res.status})`)
      const blob = await res.blob()
      const safe = String(item.label || `图${i + 1}`).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${String(i + 1).padStart(2, '0')}-${safe}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      ok++
      if (i < list.length - 1) await new Promise((r) => setTimeout(r, 120))
    } catch (e) {
      console.error(e)
    }
  }
  return ok
}

/** 分镜描述词批量复制：每批条数 */
export const STORYBOARD_PROMPT_COPY_BATCH_SIZE = 10

export function buildStoryboardCopyBatchOptions(storyboards, getPromptText, getDisplayNo) {
  const list = (storyboards || [])
    .slice()
    .sort((a, b) => (Number(a.storyboard_number) || 0) - (Number(b.storyboard_number) || 0))
    .filter((sb) => String(getPromptText(sb) || '').trim())
  const total = list.length
  if (!total) return { list: [], options: [] }
  const batchCount = Math.ceil(total / STORYBOARD_PROMPT_COPY_BATCH_SIZE)
  const options = Array.from({ length: batchCount }, (_, idx) => {
    const batchItems = list.slice(
      idx * STORYBOARD_PROMPT_COPY_BATCH_SIZE,
      (idx + 1) * STORYBOARD_PROMPT_COPY_BATCH_SIZE
    )
    const firstNo = getDisplayNo(batchItems[0])
    const lastNo = getDisplayNo(batchItems[batchItems.length - 1])
    return { value: idx + 1, label: `#${firstNo}-#${lastNo}` }
  })
  return { list, options }
}

export function buildStoryboardPromptBatchText(batch, getPromptText, getDisplayNo) {
  return batch
    .map((sb) => {
      const prompt = String(getPromptText(sb) || '').trim()
      if (!prompt) return ''
      const no = getDisplayNo(sb)
      return `【#${no}】\n${prompt}`
    })
    .filter(Boolean)
    .join('\n\n')
}
