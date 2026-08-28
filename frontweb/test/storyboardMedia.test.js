import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  findNextStoryboard,
  resolveNextStoryboardFrameUrl,
  sbVideoFirstLastUrls,
} from '../src/utils/storyboardMedia.js'

describe('findNextStoryboard', () => {
  it('returns next shot by storyboard_number', () => {
    const boards = [
      { id: 10, storyboard_number: 1 },
      { id: 20, storyboard_number: 2 },
      { id: 30, storyboard_number: 3 },
    ]
    assert.equal(findNextStoryboard(boards, 10)?.id, 20)
    assert.equal(findNextStoryboard(boards, 30), null)
  })
})

describe('resolveNextStoryboardFrameUrl', () => {
  it('prefers next shot first frame over main image', () => {
    const next = { id: 2, storyboard_number: 2, local_path: 'images/main.jpg' }
    const imagesBySbId = {
      2: [
        { id: 1, status: 'completed', frame_type: 'storyboard_first', local_path: 'images/first.jpg' },
        { id: 2, status: 'completed', local_path: 'images/main.jpg' },
      ],
    }
    assert.match(resolveNextStoryboardFrameUrl(next, imagesBySbId), /first\.jpg/)
  })
})

describe('sbVideoFirstLastUrls', () => {
  it('uses next shot image as last frame when own last is missing', () => {
    const boards = [
      { id: 1, storyboard_number: 1, local_path: 'a.jpg' },
      { id: 2, storyboard_number: 2, local_path: 'b.jpg' },
    ]
    const imagesBySbId = {
      1: [{ id: 11, status: 'completed', frame_type: 'storyboard_first', local_path: 'a-first.jpg' }],
      2: [{ id: 21, status: 'completed', frame_type: 'storyboard_first', local_path: 'b-first.jpg' }],
    }
    const { first, last } = sbVideoFirstLastUrls(boards[0], imagesBySbId, true, { storyboards: boards })
    assert.match(first, /a-first\.jpg/)
    assert.match(last, /b-first\.jpg/)
  })
})
