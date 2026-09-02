const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeBgmDescription,
  collectMoodSignals,
  buildBgmPrompt,
  buildSfxPrompt,
} = require('../src/services/bgmPromptService');

describe('bgmPromptService', () => {
  it('sanitizeBgmDescription strips markdown wrappers', () => {
    const raw = '```\n**配乐描述：** 紧张弦乐，暗色氛围\n```';
    assert.match(sanitizeBgmDescription(raw), /紧张弦乐/);
    assert.doesNotMatch(sanitizeBgmDescription(raw), /```/);
  });

  it('collectMoodSignals detects high-energy and horror shots', () => {
    const moods = collectMoodSignals([
      { storyboard_number: 1, atmosphere: '平静', narration: '日常开场' },
      { storyboard_number: 2, action: '决战爆发', atmosphere: '高燃对决' },
      { storyboard_number: 3, atmosphere: '阴森恐怖', emotion: '惊恐' },
    ]);
    assert.deepEqual(moods.highEnergy, ['第2镜']);
    assert.deepEqual(moods.horror, ['第3镜']);
  });

  it('buildBgmPrompt includes sfx guidance when include_sfx', () => {
    const p = buildBgmPrompt({
      description: '史诗感配乐',
      include_sfx: true,
      moods: { highEnergy: ['第2镜'], horror: [] },
    });
    assert.match(p, /史诗感配乐/);
    assert.match(p, /High-energy/);
    assert.match(p, /sound design|impacts/i);
  });

  it('buildSfxPrompt focuses on sound design bed', () => {
    const p = buildSfxPrompt({
      moods: { highEnergy: [], horror: ['第5镜'] },
    });
    assert.match(p, /Horror|horror|heartbeat|ambience/i);
    assert.match(p, /no melody|sound-design/i);
  });
});
