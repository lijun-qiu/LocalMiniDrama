const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  stripQuotedSpeechFromVisual,
  stripDialogueEchoFromVisual,
  normalizeDialogueFieldForPrompt,
  getDialogueVisualSeparationContract,
} = require('../src/services/dialogueVisualSeparation');
const { composeStoryboardVideoPrompt } = require('../src/services/episodeStoryboardService');

describe('dialogueVisualSeparation', () => {
  it('normalize empty dialogue to 无', () => {
    assert.equal(normalizeDialogueFieldForPrompt(''), '无');
    assert.equal(normalizeDialogueFieldForPrompt(null), '无');
    assert.equal(normalizeDialogueFieldForPrompt('陈浩："你好"'), '陈浩："你好"');
  });

  it('strips quoted lines from visual action', () => {
    const raw = '林薇合上简历。陈浩说："因为我在找工作。"林薇愣住。';
    const out = stripQuotedSpeechFromVisual(raw);
    assert.doesNotMatch(out, /因为我在找工作/);
    assert.match(out, /林薇合上简历/);
    assert.match(out, /说话口型|愣住/);
  });

  it('strips unquoted dialogue echo from action when dialogue given', () => {
    const action = '镜头2：陈浩回答你们公司在找人。镜头3：林薇继续追问。镜头4：林薇扶额。';
    const dialogue = '陈浩：诶——你们公司在找人呐。林薇：你为什么选择我们呐？';
    const out = stripDialogueEchoFromVisual(action, dialogue);
    assert.doesNotMatch(out, /你们公司在找人/);
    assert.match(out, /开口说话/);
    assert.match(out, /镜头3/);
    // 追问视为开口；无说话意图的镜头4闭口
    assert.match(out, /镜头3：[\s\S]*开口说话/);
    assert.match(out, /镜头4：[\s\S]*闭口无口型/);
  });

  it('splits 镜头2（快速切镜）： as its own beat', () => {
    const {
      extractSpeakingShotIndexesFromAction,
    } = require('../src/services/dialogueVisualSeparation');
    const action =
      '镜头1：林薇合上简历，神情疑惑。镜头2（快速切镜）：陈浩回答，表情自然。镜头3：林薇愣住。';
    const out = stripDialogueEchoFromVisual(
      action,
      '陈浩：因为我在找工作。林薇：为什么要来我们这儿？陈浩：因为我没有工作。'
    );
    assert.deepEqual(extractSpeakingShotIndexesFromAction(out).sort((a, b) => a - b), [1, 2]);
    assert.match(out, /镜头1：[^。]*开口说话/);
    assert.match(out, /镜头2（快速切镜）：[^。]*开口说话/);
    assert.match(out, /镜头3：[^。]*闭口无口型/);
  });

  it('treats 回答/追问/嘀咕 as speaking when dialogue present', () => {
    const action =
      '镜头1：林薇合上简历，神情疑惑。镜头2：陈浩回答，表情自然。镜头3：林薇愣住，深吸一口气。';
    const dialogue =
      '陈浩：因为我在找工作。林薇：为什么要来我们这儿？陈浩：因为我没有工作。';
    const out = stripDialogueEchoFromVisual(action, dialogue);
    const {
      extractSpeakingShotIndexesFromAction,
    } = require('../src/services/dialogueVisualSeparation');
    // 陈浩回答 → 镜头2；林薇有台词且出现在镜头1 → 一并开口
    assert.deepEqual(extractSpeakingShotIndexesFromAction(out).sort((a, b) => a - b), [1, 2]);
    assert.match(out, /镜头2：[^。]*开口说话/);
    assert.match(out, /镜头1：[^。]*开口说话/);
    assert.match(out, /镜头3：[^。]*闭口无口型/);
  });

  it('forbids all-closed action when dialogue exists (嘀咕 / 无动词)', () => {
    const {
      extractSpeakingShotIndexesFromAction,
    } = require('../src/services/dialogueVisualSeparation');
    const muttering = stripDialogueEchoFromVisual(
      '镜头1：陈浩一边走一边嘀咕。镜头2：他摇头叹气。镜头3：走廊尽头透进阳光。',
      '陈浩：现在的面试都这么奇怪吗？'
    );
    assert.deepEqual(extractSpeakingShotIndexesFromAction(muttering), [1]);
    assert.match(muttering, /镜头1：[^。]*开口说话/);

    const noVerb = stripDialogueEchoFromVisual(
      '镜头1：林薇坐在会议桌后审视。镜头2：门被推开陈浩走进。镜头3：林薇抬头看他。',
      '林薇：你为什么要来我们公司面试？'
    );
    const speaking = extractSpeakingShotIndexesFromAction(noVerb);
    assert.ok(speaking.length >= 1, '至少一拍开口');
    assert.match(noVerb, /开口说话/);
  });

  it('retags dialogue when shot tags are outside speaking beats', () => {
    const {
      formatClassicDialogueTaggedToShots,
      sanitizeClassicVideoPromptActionEcho,
    } = require('../src/services/dialogueVisualSeparation');
    const action =
      '镜头1：林薇耐着性子追问。镜头2：陈浩开口说话。镜头3：林薇继续追问。镜头4：陈浩开口说话。';
    const cleaned = stripDialogueEchoFromVisual(
      action,
      '林薇：你为什么选择我们公司？陈浩：你们公司在找人呐。林薇：为什么选择我们呐？陈浩：总得选一个嘛。'
    );
    const wrongTagged =
      '镜头1：林薇："你为什么选择我们公司？" 镜头1：陈浩："你们公司在找人呐。" 镜头1：林薇："为什么选择我们呐？" 镜头4：陈浩："总得选一个嘛。"';
    const out = formatClassicDialogueTaggedToShots(wrongTagged, cleaned);
    assert.doesNotMatch(out, /镜头1：陈浩/);
    assert.match(out, /镜头2：陈浩|镜头4：陈浩/);
    assert.match(out, /镜头1：林薇|镜头3：林薇/);

    const vp = sanitizeClassicVideoPromptActionEcho(
      `场景：会议室。动作：${action}。对话：${wrongTagged}。时长：10秒。=VideoRatio: 16:9`,
      '林薇：你为什么选择我们公司？陈浩：你们公司在找人呐。林薇：为什么选择我们呐？陈浩：总得选一个嘛。'
    );
    const dlgLine = vp.split('\n').find((l) => l.startsWith('对话：'));
    assert.ok(dlgLine);
    assert.doesNotMatch(dlgLine, /镜头1：陈浩/);
    const actionLine = vp.split('\n').find((l) => l.startsWith('动作：'));
    assert.ok(actionLine);
    assert.match(actionLine, /开口说话/);
    assert.doesNotMatch(actionLine, /全闭口|^动作：[^开]*闭口[^开]*$/);
  });

  it('strips paraphrased 他说… echo without matching punctuation', () => {
    const action =
      '镜头1：陈浩站起身。镜头2：他说公司太low都不会说人话，散了吧浪费时间。镜头3：他转身离开。';
    const dialogue = '陈浩：这家公司太low，都不会说人话。散了吧，浪费时间。';
    const out = stripDialogueEchoFromVisual(action, dialogue);
    assert.doesNotMatch(out, /太low/);
    assert.doesNotMatch(out, /浪费时间/);
    assert.match(out, /开口说话/);
    assert.match(out, /站起身/);
    assert.match(out, /转身离开/);
    assert.match(out, /闭口无口型/);
  });

  it('silent action without dialogue gets closed-mouth constraint', () => {
    const out = stripDialogueEchoFromVisual('他起身走向窗边望雨。', '无');
    assert.match(out, /闭口无口型/);
    assert.doesNotMatch(out, /开口说话/);
  });

  it('normalizes glued 无对白对话 and peels 结果 out of dialogue', () => {
    const {
      normalizeClassicVideoPromptLayout,
    } = require('../src/services/dialogueVisualSeparation');
    const glued =
      '场景：公司办公室会议室，两人中近景，午后。镜头标题：加班问题。动作：镜头1：林薇深吸一口气，准备换个问题问话。镜头2（快速切镜）：林薇向陈浩提问，人物开口说话口型同步镜头3：陈浩淡定回答，人物开口说话口型同步镜头4：林薇愣住，张了张嘴却不知该说什么，人物闭口无口型，无对白对话：林薇："不给你加班费的情况下，你还愿意加班吗？"陈浩："我上班不要钱。"林薇："你是在开玩笑吧？"陈浩："是你先开的玩笑。"结果：林薇张了张嘴却不知该说什么。景别：中近景。时长：10秒。=VideoRatio: 16:9';
    const out = normalizeClassicVideoPromptLayout(glued, {
      dialogue:
        '林薇："不给你加班费的情况下，你还愿意加班吗？"陈浩："我上班不要钱。"林薇："你是在开玩笑吧？"陈浩："是你先开的玩笑。"',
      result: '林薇张了张嘴却不知该说什么。',
    });
    assert.match(out, /\n对话：/);
    assert.match(out, /\n结果：/);
    assert.doesNotMatch(out, /无对白对话/);
    assert.doesNotMatch(out, /口型同步镜头/);
    const dlgLine = out.split('\n').find((l) => l.startsWith('对话：'));
    assert.ok(dlgLine);
    assert.doesNotMatch(dlgLine, /结果：/);
    assert.doesNotMatch(dlgLine, /张了张嘴却不知该说什么/);
    assert.match(dlgLine, /镜头2：|镜头3：/);
    assert.match(out, /镜头1：[\s\S]*闭口无口型/);
    assert.match(out, /镜头4：[\s\S]*无对白/);
    const actionLine = out.split('\n').find((l) => l.startsWith('动作：'));
    assert.ok(actionLine);
    assert.match(actionLine, /口型同步。镜头3|口型同步。\s*镜头3/);
  });

  it('formatClassicDialogueTaggedToShots maps speakers to speaking shots', () => {
    const {
      formatClassicDialogueTaggedToShots,
    } = require('../src/services/dialogueVisualSeparation');
    const action =
      '镜头1：准备提问，人物闭口无口型，无对白。镜头2：林薇提问，开口说话口型同步。镜头3：陈浩回答，开口说话口型同步。镜头4：愣住，人物闭口无口型，无对白。';
    const dlg =
      '林薇："不给你加班费的情况下，你还愿意加班吗？"陈浩："我上班不要钱。"林薇："你是在开玩笑吧？"陈浩："是你先开的玩笑。"';
    const out = formatClassicDialogueTaggedToShots(dlg, action);
    assert.match(out, /镜头2：林薇/);
    assert.match(out, /镜头3：陈浩/);
    assert.doesNotMatch(out, /镜头4：/);
    assert.doesNotMatch(out, /镜头1：林薇|镜头1：陈浩/);
  });

  it('sanitizeClassicVideoPromptActionEcho cleans inline 动作 before 对话', () => {
    const {
      sanitizeClassicVideoPromptActionEcho,
    } = require('../src/services/dialogueVisualSeparation');
    const vp =
      '场景：会议室。动作：她问为什么我们公司吸引你。陈浩回答因为你们在招聘。对话：林薇："我们公司为什么会吸引你过来？"陈浩："因为你们在招聘。"结果：无语。';
    const out = sanitizeClassicVideoPromptActionEcho(
      vp,
      '林薇：我们公司为什么会吸引你过来？陈浩：因为你们在招聘。'
    );
    assert.match(out, /对话：林薇/);
    assert.doesNotMatch(out.split(/对话[：:]/)[0], /因为你们在招聘/);
  });

  it('normalizeSoundEffect strips dialogue tone and keeps foley', () => {
    const { normalizeSoundEffectForPrompt } = require('../src/services/dialogueVisualSeparation');
    assert.equal(normalizeSoundEffectForPrompt(''), '无');
    assert.equal(
      normalizeSoundEffectForPrompt('椅子吱呀声，简历翻页声，对话音量中等，林薇语气正式'),
      '椅子吱呀声，简历翻页声'
    );
  });

  it('infers diegetic SFX from action when sound_effect empty', () => {
    const {
      resolveSoundEffectForStoryboard,
      sanitizeClassicVideoPromptSoundEffect,
    } = require('../src/services/dialogueVisualSeparation');
    const sb = {
      action:
        '门被推开，陈浩大步走进来，坐下时椅子发出吱呀声。林薇合上简历。',
      atmosphere: '室内安静只有椅子的吱呀声',
      sound_effect: null,
    };
    const sfx = resolveSoundEffectForStoryboard(sb);
    assert.doesNotMatch(sfx, /^无$/);
    assert.match(sfx, /吱呀|门|椅子|纸/);
    const vp = sanitizeClassicVideoPromptSoundEffect(
      '场景：会议室。动作：进门落座。对话：无。音效：无。时长：8秒。=VideoRatio: 16:9',
      sfx
    );
    assert.match(vp, /音效：(?!无)/);
    assert.doesNotMatch(vp, /音效：无/);
  });

  it('splitFullNarrationVoAndDialogue moves spoken lines out of narration', () => {
    const { splitFullNarrationVoAndDialogue } = require('../src/services/dialogueVisualSeparation');
    const seg =
      '你的手在发抖。苏蔓——你杀的？"你不是凶手。"一个声音从身后传来。你转身。陈警官站在门口。"我追踪了你的手机信号。"陈警官说，"周衡设了一个局。"';
    const { narration, dialogue } = splitFullNarrationVoAndDialogue(seg, '无', {
      knownNames: ['林深', '苏蔓', '陈警官', '周衡'],
    });
    assert.match(dialogue, /陈警官/);
    assert.match(dialogue, /追踪了你的手机信号|周衡设了一个局|你不是凶手/);
    assert.doesNotMatch(dialogue, /角色/);
    assert.doesNotMatch(narration, /追踪了你的手机信号/);
    assert.doesNotMatch(narration, /周衡设了一个局/);
    assert.match(narration, /你的手在发抖|你转身|站在门口/);
  });

  it('keeps screen/note quotes in narration', () => {
    const { splitFullNarrationVoAndDialogue } = require('../src/services/dialogueVisualSeparation');
    const seg =
      '屏幕亮着，显示着一行字："记忆清除进度——林深：73%。"你走近电脑。';
    const { narration, dialogue } = splitFullNarrationVoAndDialogue(seg, '');
    assert.equal(dialogue, '');
    assert.match(narration, /记忆清除进度/);
  });

  it('does not treat 写道 as spoken dialogue', () => {
    const { splitFullNarrationVoAndDialogue } = require('../src/services/dialogueVisualSeparation');
    const seg = '门上写道："闲人免进。"你推开门。';
    const { narration, dialogue } = splitFullNarrationVoAndDialogue(seg, '', {
      knownNames: ['林深'],
    });
    assert.equal(dialogue, '');
    assert.match(narration, /闲人免进/);
  });

  it('resolves 他说 to nearby character name instead of 角色', () => {
    const { splitFullNarrationVoAndDialogue } = require('../src/services/dialogueVisualSeparation');
    const seg =
      '陈警官是在门口拦住你的。他三十多岁。"林深。"他说，"我等你很久了。"你知道我会来？';
    const { dialogue, narration } = splitFullNarrationVoAndDialogue(seg, '', {
      knownNames: ['林深', '陈警官'],
    });
    assert.match(dialogue, /陈警官："/);
    assert.doesNotMatch(dialogue, /角色/);
    assert.match(dialogue, /我等你很久了/);
    assert.doesNotMatch(narration, /我等你很久了/);
  });

  it('leaves anonymous unresolved quotes in narration', () => {
    const { splitFullNarrationVoAndDialogue } = require('../src/services/dialogueVisualSeparation');
    const seg = '"你选错了。陈警官已经暴露。"落款是一个字母：G。';
    const { dialogue, narration } = splitFullNarrationVoAndDialogue(seg, '', {
      knownNames: ['陈警官', '林深'],
    });
    assert.equal(dialogue, '');
    assert.match(narration, /你选错了/);
  });

  it('contract mentions ArcReel separation', () => {
    assert.match(getDialogueVisualSeparationContract(false), /台词↔画面分离/);
    assert.match(getDialogueVisualSeparationContract(false), /对话：无/);
  });
});

describe('composeStoryboardVideoPrompt dialogue separation', () => {
  it('always emits 对话 and strips quotes from 动作', () => {
    const prompt = composeStoryboardVideoPrompt(
      {
        location: '会议室',
        time: '午后',
        title: '为什么来面试',
        action: '林薇合上简历。陈浩说："因为我在找工作。"',
        dialogue: '陈浩："因为我在找工作。"林薇："为什么要来我们这儿？"',
        shot_type: '近景',
        movement: 'static',
        duration: 6,
      },
      'anime style',
      '16:9'
    );
    assert.match(prompt, /对话：陈浩/);
    assert.match(prompt, /为什么要来我们这儿/);
    const actionPart = prompt.split('\n').find((p) => p.startsWith('动作：'));
    assert.ok(actionPart);
    assert.doesNotMatch(actionPart, /因为我在找工作/);
    assert.match(prompt, /\n对话：/);
  });

  it('writes 对话：无 when dialogue empty', () => {
    const prompt = composeStoryboardVideoPrompt(
      {
        location: '街道',
        action: '行人走过',
        duration: 5,
      },
      '',
      '16:9'
    );
    assert.match(prompt, /对话：无/);
  });
});
