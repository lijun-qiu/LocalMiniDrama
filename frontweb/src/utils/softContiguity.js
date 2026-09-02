/**
 * 全能软衔接：上一镜视频末帧插入参考图第一张，并顺延 prompt 内 @图片N。
 */

/** 提示词中 @图片N / <Picture N> 整体 +delta（从大到小替换，避免二次递增） */
export function shiftOmniImageIndicesInPrompt(text, delta = 1) {
  const d = Number(delta) || 0
  if (!d) return String(text || '')
  let p = String(text || '')
  const nums = new Set()
  for (const m of p.matchAll(/@图片\s*(\d+)/g)) nums.add(Number(m[1]))
  for (const m of p.matchAll(/<Picture\s*(\d+)>/gi)) nums.add(Number(m[1]))
  for (const m of p.matchAll(/@Image\s*(\d+)/gi)) nums.add(Number(m[1]))
  const sorted = [...nums].sort((a, b) => b - a)
  for (const n of sorted) {
    const next = n + d
    p = p.replace(new RegExp(`@图片\\s*${n}(?!\\d)`, 'g'), `@图片${next}`)
    p = p.replace(new RegExp(`<Picture\\s*${n}>`, 'gi'), `<Picture ${next}>`)
    p = p.replace(new RegExp(`@Image\\s*${n}(?!\\d)`, 'gi'), `@图片${next}`)
  }
  return p
}

/**
 * @returns {{ refs: string[], prompt: string, applied: boolean }}
 */
export function applySoftContiguityToOmniSubmit(omniRefs, continuityAbsUrl, prompt) {
  const cont = (continuityAbsUrl && String(continuityAbsUrl).trim()) || ''
  const refsIn = Array.isArray(omniRefs) ? omniRefs.filter(Boolean) : []
  if (!cont) return { refs: refsIn, prompt: String(prompt || ''), applied: false }
  const rest = refsIn.filter((u) => u !== cont)
  const refs = [cont, ...rest].slice(0, 10)
  let p = shiftOmniImageIndicesInPrompt(prompt, 1)
  const banner =
    '【软衔接·起始画面=@图片1】@图片1 为上一镜视频末帧；成片须从此构图/光影/人物站位自然接续展开，再进入本段动作。原场景与角色参考序号已整体 +1。'
  if (!p.includes('【软衔接·起始画面')) p = `${banner}\n${p}`
  return { refs, prompt: p, applied: true }
}
