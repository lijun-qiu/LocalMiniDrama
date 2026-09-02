import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeScriptContentForSave } from '../src/utils/scriptEpisodes.js'

test('normalizeScriptContentForSave removes blank lines', () => {
  const input = '第一句。\n\n第二句。\n\n\n第三句。'
  assert.equal(normalizeScriptContentForSave(input), '第一句。\n第二句。\n第三句。')
})

test('normalizeScriptContentForSave normalizes CRLF and trims', () => {
  assert.equal(normalizeScriptContentForSave('\r\n  \r\n甲。\r\n\r\n'), '甲。')
})

test('normalizeScriptContentForSave returns empty for blank input', () => {
  assert.equal(normalizeScriptContentForSave('   \n\n  '), '')
})
