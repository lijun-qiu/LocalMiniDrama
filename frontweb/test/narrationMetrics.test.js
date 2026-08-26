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

test('estimateNarrationDurationSec uses ceil and clamps 4–10s', () => {
  assert.equal(estimateNarrationDurationSec('一'.repeat(22)), 4)
  assert.equal(estimateNarrationDurationSec('一'.repeat(50)), 10)
  assert.equal(estimateNarrationDurationSec('一'.repeat(54), 6), 9)
  assert.equal(estimateNarrationDurationSec('一'.repeat(60), 6), 10)
})

test('getNarrationStats returns chars and estSec', () => {
  const stats = getNarrationStats('一'.repeat(54), 6)
  assert.equal(stats.chars, 54)
  assert.equal(stats.neededSec, 9)
  assert.equal(stats.estSec, 9)
})

test('getNarrationStats exposes uncapped neededSec for overlong text', () => {
  const stats = getNarrationStats('一'.repeat(82), 6)
  assert.equal(stats.chars, 82)
  assert.equal(stats.neededSec, 14)
  assert.equal(stats.estSec, 10)
})
