import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  shiftOmniImageIndicesInPrompt,
  applySoftContiguityToOmniSubmit,
} from '../src/utils/softContiguity.js'

describe('softContiguity', () => {
  it('shifts @图片N from high to low without double increment', () => {
    const out = shiftOmniImageIndicesInPrompt('环境 @图片1；角色 @图片2；道具 @图片10', 1)
    assert.equal(out, '环境 @图片2；角色 @图片3；道具 @图片11')
  })

  it('prepends continuity as first ref and remaps prompt', () => {
    const { refs, prompt, applied } = applySoftContiguityToOmniSubmit(
      ['http://scene', 'http://char'],
      'http://tail',
      '参考 @图片1 与 @图片2'
    )
    assert.equal(applied, true)
    assert.deepEqual(refs, ['http://tail', 'http://scene', 'http://char'])
    assert.match(prompt, /软衔接·起始画面=@图片1/)
    assert.match(prompt, /参考 @图片2 与 @图片3/)
    assert.doesNotMatch(prompt, /参考 @图片1 与 @图片2/)
  })
})
