import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STORYBOARD_PROMPT_COPY_BATCH_SIZE,
  buildStoryboardCopyBatchOptions,
  buildStoryboardPromptBatchText,
} from '../src/utils/clipboard.js'

test('buildStoryboardCopyBatchOptions splits into batches of 10', () => {
  const boards = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    storyboard_number: i + 1,
    image_prompt: `prompt ${i + 1}`,
  }))
  const getPrompt = (sb) => sb.image_prompt
  const getNo = (sb) => String(sb.storyboard_number).padStart(2, '0')
  const { list, options } = buildStoryboardCopyBatchOptions(boards, getPrompt, getNo)
  assert.equal(list.length, 25)
  assert.equal(options.length, 3)
  assert.equal(options[0].label, '#01-#10')
  assert.equal(options[1].label, '#11-#20')
  assert.equal(options[2].label, '#21-#25')
  assert.equal(STORYBOARD_PROMPT_COPY_BATCH_SIZE, 10)
})

test('buildStoryboardPromptBatchText formats blocks', () => {
  const batch = [
    { storyboard_number: 1, image_prompt: 'a' },
    { storyboard_number: 2, image_prompt: 'b' },
  ]
  const text = buildStoryboardPromptBatchText(
    batch,
    (sb) => sb.image_prompt,
    (sb) => String(sb.storyboard_number).padStart(2, '0')
  )
  assert.equal(text, '【#01】\na\n\n【#02】\nb')
})
