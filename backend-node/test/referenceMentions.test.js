'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseReferenceMentions,
  renderMentionsToOmniSpeech,
  deriveVisualReferences,
  innerMonologueLipGuard,
} = require('../src/services/workflow/referenceMentions');
const {
  splitMentionNameLook,
  lookAssetId,
  parseLooks,
  BASE_LOOK_ID,
} = require('../src/services/workflow/characterLooks');

describe('characterLooks', () => {
  it('splits name@look', () => {
    assert.deepEqual(splitMentionNameLook('林北@战损'), { name: '林北', look: '战损' });
    assert.deepEqual(splitMentionNameLook('林北'), { name: '林北', look: BASE_LOOK_ID });
    assert.equal(lookAssetId('林北', '战损'), '林北__战损');
  });
});

describe('referenceMentions', () => {
  it('parses look, dialogue, monologue, and VO', () => {
    const text =
      '@[林北@战损] 靠在墙边。@[林北%内心独白]{不能再逃了} @[林薇]{你回来了} {夜色很深}';
    const { hits, errors } = parseReferenceMentions(text);
    assert.equal(errors.length, 0);
    assert.ok(hits.some((h) => h.kind === 'asset' && h.name === '林北' && h.look === '战损'));
    assert.ok(hits.some((h) => h.kind === 'speech' && h.innerMonologue && h.text === '不能再逃了'));
    assert.ok(hits.some((h) => h.kind === 'speech' && !h.innerMonologue && h.name === '林薇'));
    assert.ok(hits.some((h) => h.kind === 'vo' && h.text === '夜色很深'));
    const refs = deriveVisualReferences(hits);
    assert.deepEqual(refs, [{ name: '林北', look: '战损' }]);
  });

  it('renders to omni speech forms', () => {
    const out = renderMentionsToOmniSpeech(
      '@[林北@战损%内心独白]{别动} @[林薇]{站住} {雨还在下}'
    );
    assert.match(out, /【口型节拍硬约束】/);
    assert.match(out, /<林北>内心独白 \{别动\}【心声画面：嘴唇紧闭，不吐舌、不开口，无发声口部动作】/);
    assert.match(out, /<林薇>说 \{站住\}【开口说话】/);
    assert.match(out, /画外音说 \{雨还在下\}【旁白画面：在场角色嘴唇紧闭，不开口、无说话口型】/);
    const { hits } = parseReferenceMentions('@[林北%内心独白]{x}');
    assert.match(innerMonologueLipGuard(hits), /<林北>嘴唇紧闭，不吐舌、不开口，无发声口部动作。/);
  });

  it('same person 心声+对白: 心声闭嘴、对白开口、无整段封口', () => {
    const {
      appendInnerMonologueLipGuard,
    } = require('../src/services/workflow/referenceMentions');
    const raw = '@[阿杰%内心独白]{算了} @[阿杰]{我想吃这个}';
    const out = renderMentionsToOmniSpeech(raw);
    assert.match(out, /【口型节拍硬约束】/);
    assert.match(out, /<阿杰>内心独白 \{算了\}【心声画面：嘴唇紧闭，不吐舌、不开口，无发声口部动作】/);
    assert.match(out, /<阿杰>说 \{我想吃这个\}【开口说话】/);
    assert.doesNotMatch(out, /<阿杰>嘴唇紧闭，不吐舌、不开口，无发声口部动作。/);
    const { hits } = parseReferenceMentions(raw);
    assert.equal(innerMonologueLipGuard(hits), '');
    const appended = appendInnerMonologueLipGuard(
      '<阿杰>内心独白 {算了} <阿杰>说 {我想吃这个}'
    );
    assert.match(appended, /【口型节拍硬约束】/);
    assert.match(appended, /【心声画面：嘴唇紧闭，不吐舌、不开口，无发声口部动作】/);
    assert.match(appended, /<阿杰>说 \{我想吃这个\}【开口说话】/);
    assert.doesNotMatch(appended, /<阿杰>嘴唇紧闭，不吐舌、不开口，无发声口部动作。/);
  });

  it('dialogue-only units do not get open-mark or beat directive', () => {
    const out = renderMentionsToOmniSpeech('@[阿杰]{你好} @[小满]{嗨}');
    assert.doesNotMatch(out, /【口型节拍硬约束】/);
    assert.doesNotMatch(out, /【开口说话】/);
    assert.match(out, /<阿杰>说 \{你好\}/);
    assert.match(out, /<小满>说 \{嗨\}/);
  });
});
