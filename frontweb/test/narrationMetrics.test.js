import test from 'node:test'
import assert from 'node:assert/strict'
import {
  countNarrationSpeechChars,
  estimateNarrationDurationSec,
  getNarrationStats,
} from '../src/utils/narrationMetrics.js'

test('countNarrationSpeechChars excludes punctuation', () => {
  assert.equal(countNarrationSpeechChars('剩下的全交给老婆刘念。她以前是小'), 15)
})

test('estimateNarrationDurationSec uses ceil and clamps 4–10s at 5 default', () => {
  assert.equal(estimateNarrationDurationSec('一'.repeat(20)), 4)
  assert.equal(estimateNarrationDurationSec('一'.repeat(50)), 10)
  assert.equal(estimateNarrationDurationSec('一'.repeat(54), 6), 9)
  assert.equal(estimateNarrationDurationSec('一'.repeat(60), 6), 10)
})

test('getNarrationStats returns chars and estSec', () => {
  const stats = getNarrationStats('一'.repeat(50), 5)
  assert.equal(stats.chars, 50)
  assert.equal(stats.neededSec, 10)
  assert.equal(stats.estSec, 10)
})

test('getNarrationStats exposes uncapped neededSec for overlong text', () => {
  const stats = getNarrationStats('一'.repeat(82), 5)
  assert.equal(stats.chars, 82)
  assert.equal(stats.neededSec, 17)
  assert.equal(stats.estSec, 10)
})
