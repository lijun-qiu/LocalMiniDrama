import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  enrichUniversalBeatsWithTimeline,
  splitNarrationUnits,
  alignUniversalBeatSecondsToNarration,
  beatsSecondsMisalignedWithNarration,
} from '../src/utils/universalNarrationBeatTimeline.js'

describe('universalNarrationBeatTimeline (front)', () => {
  it('splits narration into units', () => {
    const units = splitNarrationUnits('第一句。你推开门。第三句旁白。')
    assert.ok(units.length >= 2)
    assert.ok(units.some((u) => u.includes('推开门')))
  })

  it('adds time windows and narration excerpts to beats', () => {
    const beats = enrichUniversalBeatsWithTimeline(
      [
        { index: 1, seconds: 3, body: 'A' },
        { index: 2, seconds: 2, body: '推门' },
        { index: 3, seconds: 4, body: 'C' },
      ],
      '第一句旁白较长一些。你推开门。第三句也比较长继续叙述。'
    )
    assert.equal(beats.length, 3)
    assert.equal(beats[0].timeLabel, '0～3s')
    assert.equal(beats[1].timeLabel, '3～5s')
    assert.equal(beats[2].timeLabel, '5～9s')
    assert.match(beats[1].narrationExcerpt, /推开门/)
    assert.ok(beats[1].startSec <= 4.5 && beats[1].endSec >= 4.5)
  })

  it('alignUniversalBeatSecondsToNarration rewrites beat seconds only', () => {
    const raw = [
      '画面风格和类型: 测试',
      '生成一个由以下3个分镜组成的视频。',
      '环境 @图片1。',
      '分镜1： 3秒: 动作A。',
      '分镜2： 3秒: 推门。',
      '分镜3： 3秒: 动作C。',
    ].join('\n')
    const narr = '较长第一句旁白。你推开门。第三句旁白。'
    const r = alignUniversalBeatSecondsToNarration(raw, 9, narr)
    assert.equal(r.ok, true)
    assert.equal(r.changed, true)
    assert.match(r.text, /分镜2： 2秒:/)
    assert.ok(r.idealSeconds)
    assert.equal(r.idealSeconds.reduce((a, b) => a + b, 0), 9)
  })

  it('beatsSecondsMisalignedWithNarration detects equal split', () => {
    const beats = [
      { index: 1, seconds: 3 },
      { index: 2, seconds: 3 },
      { index: 3, seconds: 3 },
    ]
    const narr = '较长第一句。你推开门。第三句也比较长一些。'
    assert.equal(beatsSecondsMisalignedWithNarration(beats, narr, 9), true)
  })
})
