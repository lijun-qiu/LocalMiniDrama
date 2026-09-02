const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildNameToImageTagMap,
  findNamesInTextInOrder,
  parseDialogueSpeakerLines,
  inferPrimarySubject,
  buildSubjectIdentityLockBlock,
  buildNarrationSubjectHintBlock,
  textSuggestsAlbumMontage,
  narrationUsesSecondPerson,
  narrationListsMultipleActivities,
} = require('../src/services/universalSubjectLock');
const { buildFallbackUniversalMultiBeatText } = require('../src/services/universalOmniMultiBeatFormat');

describe('universalSubjectLock', () => {
  const slots = [
    { tag: '@图片2', summary: '林薇', kind: '角色' },
    { tag: '@图片3', summary: '陈默', kind: '角色' },
  ];

  it('maps names to image tags', () => {
    const map = buildNameToImageTagMap(slots);
    assert.equal(map.get('林薇'), '@图片2');
    assert.equal(map.get('陈默'), '@图片3');
  });

  it('finds names in action order without short-name steal', () => {
    const order = findNamesInTextInOrder('陈默看着林薇转身离开', ['林', '林薇', '陈默']);
    assert.deepEqual(order, ['陈默', '林薇']);
  });

  it('parses dialogue speaker lines', () => {
    const lines = parseDialogueSpeakerLines('林薇："你休想。"\n陈默说：「我已经决定了。」', [
      '林薇',
      '陈默',
    ]);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].speaker, '林薇');
    assert.equal(lines[0].line, '你休想。');
    assert.equal(lines[1].speaker, '陈默');
    assert.equal(lines[1].line, '我已经决定了。');
  });

  it('infers primary subject from action not character list order', () => {
    // characters list has 林薇 first (@图片2), but ACTION leads with 陈默
    const primary = inferPrimarySubject('陈默猛地抓住门把', '林薇："放开！"', slots);
    assert.equal(primary.name, '陈默');
    assert.equal(primary.tag, '@图片3');
  });

  it('builds SUBJECT_IDENTITY_LOCK with PRIMARY and speaker map', () => {
    const block = buildSubjectIdentityLockBlock({
      charSlots: slots,
      action: '陈默推门而入，林薇后退一步',
      dialogue: '陈默："给我一个解释。"',
      sceneFirst: true,
    });
    assert.match(block, /SUBJECT_IDENTITY_LOCK/);
    assert.match(block, /PRIMARY_SUBJECT: 「陈默」=@图片3/);
    assert.match(block, /DIALOGUE_SPEAKER_MAP/);
    assert.match(block, /「陈默」说 → @图片3 说："给我一个解释。"/);
    assert.match(block, /DIALOGUE_VERBATIM/);
  });

  it('maps narration 你 to PRIMARY and gives album structure when action mentions 相册', () => {
    const narr = '你在咖啡馆写作，你在公园散步，你在厨房煮咖啡。';
    assert.equal(narrationUsesSecondPerson(narr), true);
    assert.equal(narrationListsMultipleActivities(narr), true);
    assert.equal(textSuggestsAlbumMontage('镜头扫过桌上相册', narr), true);
    const hint = buildNarrationSubjectHintBlock(narr, { name: '林薇', tag: '@图片2' }, {
      action: '镜头沿相页表面斜向推进',
    });
    assert.match(hint, /「你\/您」= 段落主人公「林薇」=@图片2/);
    assert.match(hint, /同一人/);
    assert.match(hint, /多时空\/多活动模板|相册|相页/);
    assert.match(hint, /【运镜】|定格/);
    const block = buildSubjectIdentityLockBlock({
      charSlots: slots,
      action: '镜头扫过桌上相册',
      narration: narr,
      sceneFirst: true,
    });
    assert.match(block, /NARRATION_SUBJECT_HINT/);
  });

  it('does not treat quoted 周衡诊所 as character appear; 你 POV stays 林深', () => {
    const action =
      '镜头深入抽屉最深处，发现一把黄铜色钥匙和一张医院收据。收据抬头清晰显示"周衡诊所"，日期三天前。';
    const narration =
      '抽屉最深处有一把钥匙。旁边压着一张医院收据，抬头是"周衡诊所"。周衡？你不认识这个人。至少你不记得。';
    const sb14Slots = [
      { tag: '@图片2', summary: '林深', kind: '角色' },
      { tag: '@图片3', summary: '周衡', kind: '角色' },
    ];
    // 引号内店招 = 仅提及；不是「诊所」后缀特判
    assert.deepEqual(findNamesInTextInOrder(action, ['林深', '周衡']), []);
    assert.equal(narrationUsesSecondPerson(narration), true);
    const primary = inferPrimarySubject(action, null, sb14Slots, narration);
    assert.equal(primary.name, '林深');
    assert.equal(primary.tag, '@图片2');
    const block = buildSubjectIdentityLockBlock({
      charSlots: sb14Slots,
      action,
      narration,
      sceneFirst: true,
    });
    assert.match(block, /PRIMARY_SUBJECT: 「林深」=@图片2/);
    assert.doesNotMatch(block, /PRIMARY_SUBJECT: 「周衡」/);
    assert.match(block, /提及≠出场模板/);
  });

  it('ep3#4: 但你 + quoted post title 周衡诊所的秘密 → PRIMARY 林深', () => {
    const action =
      '推镜推进，镜头聚焦在电脑屏幕上，一条本地论坛帖子标题"周衡诊所的秘密"格外显眼，发帖时间显示昨天深夜。';
    const narration =
      '大部分是无关的，但你注意到一条本地论坛的帖子——发帖时间是昨天深夜，标题是"周衡诊所的秘密"。';
    const slots = [
      { tag: '@图片2', summary: '林深', kind: '角色' },
      { tag: '@图片3', summary: '周衡', kind: '角色' },
      { tag: '@图片4', summary: '林先生', kind: '角色' },
    ];
    assert.equal(narrationUsesSecondPerson(narration), true);
    assert.deepEqual(findNamesInTextInOrder(action, ['林深', '周衡', '林先生']), []);
    const primary = inferPrimarySubject(action, null, slots, narration);
    assert.equal(primary.name, '林深');
    assert.equal(primary.tag, '@图片2');
  });

  it('still counts unquoted on-screen names as appear', () => {
    assert.deepEqual(
      findNamesInTextInOrder('周衡推开门走进诊室', ['林深', '周衡']),
      ['周衡']
    );
  });
});

describe('buildFallbackUniversalMultiBeatText subject lock', () => {
  it('uses primaryImageTag instead of hardcoding @图片2', () => {
    const text = buildFallbackUniversalMultiBeatText(
      { location: '办公室', time: '夜', atmosphere: '紧张' },
      {
        action: '陈默摔门而出',
        dialogue: '陈默："结束了。"',
        result: '走廊空无一人',
        durationSec: 10,
        primaryImageTag: '@图片3',
        primarySubjectName: '陈默',
        dialogueSpeakerTag: '@图片3',
        dialogueSpeakerName: '陈默',
      },
      '都市情感'
    );
    assert.match(text, /@图片3/);
    assert.match(text, /@图片3 说："结束了。"/);
    assert.doesNotMatch(text, /跟住 @图片2 /);
  });
});
