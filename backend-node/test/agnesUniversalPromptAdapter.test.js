const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  adaptUniversalSegmentTextForAgnes,
  isUniversalMultiBeatPrompt,
  extractBeatEventSnippets,
  collectDistinctSnippets,
} = require('../src/services/agnesUniversalPromptAdapter');
const { prepareAgnesVideoPrompt } = require('../src/services/videoClient');

const SB8_LIKE = [
  '画面风格和类型: 真人写实, 电影风格, 高清画质, 悬疑惊悚质感',
  '生成一个由以下3个分镜组成的视频。',
  '环境、光影与陈设定性参考 @图片1。须单镜头完整连续画面。',
  '分镜1： 2秒: 手持跟拍，@图片2 林深推开公寓铁门步入夜色，路灯昏黄，远景便利店招牌浮现。人物闭口无口型，无对白。',
  '分镜2： 4秒: 他推开便利店玻璃门，@图片2 走向货架拿起一瓶水，随后抬头望向墙上电视，电视蓝光映脸。人物闭口无口型，无对白。',
  '分镜3： 2秒: @图片2 林深站在货架旁，眼神专注落在电视屏幕上。人物闭口无口型，无对白。',
].join('\n');

const SB9_LIKE = [
  '画面风格和类型: 真人写实, 电影风格, 高清画质, 悬疑惊悚质感',
  '生成一个由以下3个分镜组成的视频。',
  '环境 @图片1。须单镜头完整连续画面。',
  '分镜1： 6秒: @图片2 林深伫立饮料区旁盯墙上小电视，胸廓微滞，呼吸凝停。人物闭口无口型，无对白。',
  '分镜2： 2秒: @图片2 林深指尖一松，塑料水瓶自掌心脱离，慢动作追随瓶身坠落轨迹。人物闭口无口型，无对白。',
  '分镜3： 1秒: 镜头俯摇至地面，塑料水瓶滚落在地静止。人物闭口无口型，无对白。',
].join('\n');

const SB12_LIKE = [
  '画面风格和类型: 真人写实, 电影风格, 高清画质, 悬疑惊悚质感',
  '生成一个由以下3个分镜组成的视频。',
  '环境、光影与陈设定性参考 @图片1。须单镜头完整连续画面。',
  '分镜1： 4秒: 低机位贴地缓推，@图片2 林深指尖轻触滚落在瓷砖地面上的玻璃水瓶。人物闭口无口型，无对白。',
  '分镜2： 2秒: 镜头沿货架方向水平横移，@图片2 林深直起身将水瓶搁回层架边缘。人物闭口无口型，无对白。',
  '分镜3： 3秒: 跟镜自 @图片2 林深右后方贴肩缓缓后退拉远，他伸手推开玻璃店门，身影一步步退入门外昏黄街灯与黑暗交界的阴影之中。人物闭口无口型，无对白。',
].join('\n');

describe('agnesUniversalPromptAdapter', () => {
  it('detects universal multi-beat prompt', () => {
    assert.equal(isUniversalMultiBeatPrompt(SB8_LIKE), true);
    assert.equal(isUniversalMultiBeatPrompt('场景：街道。动作：行走。'), false);
  });

  it('unified template: scale duration, keep original bodies, add no-spoiler/no-repeat', () => {
    const { adapted } = adaptUniversalSegmentTextForAgnes(SB8_LIKE, { durationSec: 8 });
    assert.match(adapted, /总时长 8 秒·严格线性时间轴/);
    assert.match(adapted, /统一适用于每一时段/);
    assert.match(adapted, /仅此时间段内允许的画面/);
    assert.match(adapted, /本段唯一主事件/);
    assert.match(adapted, /严禁抢跑/);
    assert.match(adapted, /已完成·禁止重复/);
    // 不改写正文、不拆成剧本式进店/取水
    assert.match(adapted, /推开便利店玻璃门/);
    assert.match(adapted, /走向货架拿起一瓶水/);
    assert.doesNotMatch(adapted, /双手空空，推开便利店玻璃门进入店内/);
    assert.doesNotMatch(adapted, /本段才开始取瓶/);
  });

  it('extractBeatEventSnippets drops noise clauses', () => {
    const snips = extractBeatEventSnippets(
      '他推开便利店玻璃门，走向货架拿起一瓶水，人物闭口无口型，无对白。'
    );
    assert.ok(snips.some((s) => /推开便利店/.test(s)));
    assert.ok(snips.some((s) => /拿起一瓶水/.test(s)));
    assert.ok(!snips.some((s) => /闭口无口型/.test(s)));
  });

  it('collectDistinctSnippets excludes content already in current beat', () => {
    const early = '手持跟拍，@图片2 林深推开公寓铁门步入夜色';
    const later = ['@图片2 走向货架拿起一瓶水', '盯墙上小电视，电视蓝光映脸'];
    const labels = collectDistinctSnippets(later, early);
    assert.ok(labels.some((s) => /拿起一瓶水|货架/.test(s)));
    assert.ok(labels.some((s) => /电视/.test(s)));
  });

  it('SB9: early beat forbids later drop via generic snippets; does not rewrite bodies', () => {
    const { adapted } = adaptUniversalSegmentTextForAgnes(SB9_LIKE);
    assert.match(adapted, /【0～6秒·仅此时间段/);
    assert.match(adapted, /严禁抢跑[\s\S]*坠落|脱离|瓶身/u);
    assert.match(adapted, /追随瓶身坠落轨迹/);
    assert.match(adapted, /塑料水瓶滚落在地静止/);
    assert.doesNotMatch(adapted, /已落定的塑料水瓶静止不动/);
  });

  it('prepareAgnesVideoPrompt adds sequential order suffix', () => {
    const { prompt } = prepareAgnesVideoPrompt(SB9_LIKE, { forceSilent: true });
    assert.match(prompt, /【Agnes 连续单镜头/);
    assert.match(prompt, /【顺序约束·最高优先级】/);
    assert.ok(prompt.includes('禁止人物开口'));
  });

  it('SB12: put-back and exit bodies preserved (no enter+pickup rewrite)', () => {
    const { adapted } = adaptUniversalSegmentTextForAgnes(SB12_LIKE, { durationSec: 9 });
    assert.match(adapted, /搁回层架边缘/);
    assert.match(adapted, /退入门外/);
    assert.match(adapted, /严禁抢跑[\s\S]*推开玻璃店门|退入门外/u);
    assert.match(adapted, /已完成·禁止重复[\s\S]*搁回层架/u);
    assert.doesNotMatch(adapted, /进入店内，荧光灯照亮全身；本段仅进门/);
    assert.doesNotMatch(adapted, /走向货架，伸手从货架\/水柜取下一瓶水并握于手中/);
    assert.doesNotMatch(adapted, /本段唯一动作是将瓶放回货架/);
  });
});
