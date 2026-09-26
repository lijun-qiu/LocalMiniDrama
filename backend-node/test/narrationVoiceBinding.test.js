'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  promptHasNarrationVoiceover,
  resolveVoiceBindingsForStoryboard,
} = require('../src/services/videoClient');

describe('promptHasNarrationVoiceover', () => {
  it('detects 画外音说 and storyboard narration field', () => {
    assert.equal(promptHasNarrationVoiceover('画外音说 {夜色渐深}', ''), true);
    assert.equal(promptHasNarrationVoiceover('', '旁白一句'), true);
    assert.equal(promptHasNarrationVoiceover('<林薇>说 {你好}', ''), false);
  });
});

describe('resolveVoiceBindingsForStoryboard + narration', () => {
  function makeDb({ dramaVoice, characters = [], storyboard = null }) {
    return {
      prepare(sql) {
        const s = String(sql);
        return {
          get(...args) {
            if (s.includes('narration_seedance2_voice_asset') && s.includes('FROM dramas')) {
              return { narration_seedance2_voice_asset: dramaVoice };
            }
            if (s.includes('FROM storyboards') && storyboard) {
              return storyboard;
            }
            return null;
          },
          all() {
            if (s.includes('FROM characters')) return characters;
            return [];
          },
        };
      },
    };
  }

  it('binds 画外音 alone when only narration voice is uploaded', () => {
    const db = makeDb({
      dramaVoice: JSON.stringify({
        status: 'active',
        url: '/static/drama_1/narration/voice/a.mp3',
      }),
    });
    const bindings = resolveVoiceBindingsForStoryboard(
      db,
      1,
      null,
      '画外音说 {夜色渐深}。'
    );
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].name, '画外音');
    assert.equal(bindings[0].audioIndex, 1);
    assert.match(bindings[0].url, /narration\/voice/);
  });

  it('appends 画外音 after character speakers', () => {
    const db = makeDb({
      dramaVoice: JSON.stringify({
        status: 'active',
        url: '/static/drama_1/narration/voice/a.mp3',
      }),
      characters: [
        {
          id: 10,
          name: '林薇',
          voice_style: '清亮',
          seedance2_voice_asset: JSON.stringify({
            status: 'active',
            url: '/static/drama_1/characters/voice/c.mp3',
          }),
        },
      ],
    });
    const bindings = resolveVoiceBindingsForStoryboard(
      db,
      1,
      null,
      '<林薇>说 {请坐}，画外音说 {随后}。'
    );
    assert.equal(bindings.length, 2);
    assert.equal(bindings[0].name, '林薇');
    assert.equal(bindings[1].name, '画外音');
    assert.equal(bindings[1].audioIndex, 2);
  });

  it('skips narration voice when prompt has no voiceover', () => {
    const db = makeDb({
      dramaVoice: JSON.stringify({
        status: 'active',
        url: '/static/drama_1/narration/voice/a.mp3',
      }),
      characters: [
        {
          id: 10,
          name: '林薇',
          voice_style: '',
          seedance2_voice_asset: JSON.stringify({
            status: 'active',
            url: '/static/drama_1/characters/voice/c.mp3',
          }),
        },
      ],
    });
    const bindings = resolveVoiceBindingsForStoryboard(db, 1, null, '<林薇>说 {请坐}。');
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].name, '林薇');
  });
});
