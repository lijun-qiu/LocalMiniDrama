const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  locateNarrationInScript,
  extractNarrationLocalWindow,
  buildNarrationLocalContextBlock,
} = require('../src/services/narrationLocalWindow');

describe('narrationLocalWindow', () => {
  const script = [
    '第二天一早，你去了图书馆。',
    '',
    '你需要查苏蔓的信息。你用同事的名字借了台电脑，搜索"苏蔓 死亡"，跳出十几条结果。大部分是无关的，但你注意到一条本地论坛的帖子——发帖时间是昨天深夜，标题是"周衡诊所的秘密"。',
    '',
    '帖子内容很零碎，像是某人断断续续写的：',
    '',
    '"周衡不是普通的精神科医生。他在做记忆实验。我见过他的患者名单，里面有几个名字后来都死了。苏蔓是最近一个。她死前三天去过诊所。"',
    '',
    '你截了图，继续搜索"周衡诊所"。地图软件显示诊所位置在一个老街区，门面已经关了。',
  ].join('\n');

  const current =
    '"周衡不是普通的精神科医生。他在做记忆实验。我见过他的患者名单，里面有几个名字后来都死了。苏蔓是最近一个。她死前三天去过诊所。"';

  it('locates current narration inside full script', () => {
    const loc = locateNarrationInScript(script, current);
    assert.ok(loc);
    assert.equal(script.slice(loc.start, loc.end), current);
  });

  it('extracts ~100 chars before and after current narration', () => {
    const win = extractNarrationLocalWindow(script, current, { radius: 100 });
    assert.equal(win.matched, true);
    assert.equal(win.source, 'script');
    assert.ok(win.before.length > 0 && win.before.length <= 100);
    assert.ok(win.after.length > 0 && win.after.length <= 100);
    assert.match(win.before, /论坛|帖子|零碎/);
    assert.match(win.after, /截了图|周衡诊所/);
    assert.equal(win.current, current);
    assert.match(win.windowText, /【当前镜旁白】/);
  });

  it('falls back to neighbor narrations when script miss', () => {
    const win = extractNarrationLocalWindow('完全无关的剧本', '本镜旁白ABC', {
      radius: 10,
      prevNarration: '前文一二三四五六七八九十多余',
      nextNarration: '后文甲乙丙丁戊己庚辛壬癸多余',
    });
    assert.equal(win.matched, false);
    assert.equal(win.source, 'neighbor_narrations');
    assert.ok(win.before.length <= 10);
    assert.equal(win.before, '前文一二三四五六七八九十多余'.slice(-10));
    assert.equal(win.after, '后文甲乙丙丁戊己庚辛');
    assert.equal(win.current, '本镜旁白ABC');
  });

  it('buildNarrationLocalContextBlock includes design guidance', () => {
    const win = extractNarrationLocalWindow(script, current, { radius: 100 });
    const block = buildNarrationLocalContextBlock(win);
    assert.match(block, /NARRATION_LOCAL_CONTEXT/);
    assert.match(block, /提及≠出场/);
    assert.match(block, /周衡不是普通的精神科医生/);
  });
});
