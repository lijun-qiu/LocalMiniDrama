/**
 * BGM / 音效提示词：从本集分镜提炼氛围，高燃/恐怖镜自动注入音效意向。
 */

const aiClient = require('./aiClient');

const HIGH_ENERGY_RE = /高燃|燃向|爆发|决战|对决|反击|觉醒|高潮|热血|震撼|爆炸|冲击|追逐|厮杀|战斗|对战|狂喜|胜利|逆袭|燃爆/;
const HORROR_RE = /恐怖|惊悚|悬疑|阴森|诡异|鬼|血腥|窒息|恐惧|噩梦|黑暗|压迫|惊恐|颤栗|毛骨|阴冷|低语|心跳/;

function sanitizeBgmDescription(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  text = text.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/i, '').trim();
  text = text.replace(/^(BGM|配乐|音效|音乐)描述[:：]\s*/i, '').trim();
  text = text
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^#{1,6}\s*/, '')
      .replace(/^\*\*(.+?)\*\*[:：]?\s*/, '$1：')
      .replace(/^[-*•]\s+/, '')
      .trim())
    .filter((line) => {
      if (!line) return false;
      if (/^(作品|题材|本集|范围|输出类型)\s*[:：]/.test(line)) return false;
      return true;
    })
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return text.replace(/^["'`]+|["'`]+$/g, '').trim();
}

function collectMoodSignals(storyboards) {
  const highEnergy = [];
  const horror = [];
  for (const sb of storyboards || []) {
    const blob = [
      sb.atmosphere,
      sb.emotion,
      sb.action,
      sb.description,
      sb.narration,
      sb.dialogue,
      sb.segment_title,
      sb.title,
    ].map((x) => String(x || '')).join(' ');
    const label = `第${sb.storyboard_number || '?'}镜`;
    if (HIGH_ENERGY_RE.test(blob)) highEnergy.push(label);
    if (HORROR_RE.test(blob)) horror.push(label);
  }
  return { highEnergy, horror };
}

function buildBgmPrompt(options = {}) {
  const parts = [];
  const userDesc = String(options.description || '').trim();
  const content = String(options.content || '').trim();
  const includeSfx = !!options.include_sfx;
  const moods = options.moods || { highEnergy: [], horror: [] };

  if (userDesc) parts.push(userDesc);
  if (content) parts.push(`Scene context: ${content.slice(0, 400)}`);
  if (moods.highEnergy?.length) {
    parts.push(`High-energy climax shots: ${moods.highEnergy.slice(0, 6).join(', ')}`);
  }
  if (moods.horror?.length) {
    parts.push(`Horror/tension shots: ${moods.horror.slice(0, 6).join(', ')}`);
  }

  if (includeSfx) {
    parts.push(
      'Cinematic instrumental underscore with subtle trailer-style sound design accents '
      + '(impacts, risers, heartbeat pulses for horror, whooshes for action); no vocals, do not overpower narration'
    );
  } else {
    parts.push(
      'Instrumental background music only, no vocals, cinematic, suitable for short drama narration, smooth and non-distracting'
    );
  }
  return parts.join('. ').slice(0, 900);
}

function buildSfxPrompt(options = {}) {
  const parts = [];
  const userDesc = String(options.description || '').trim();
  const moods = options.moods || { highEnergy: [], horror: [] };
  if (userDesc) parts.push(userDesc);
  if (moods.highEnergy?.length) {
    parts.push(`Action impacts and risers for: ${moods.highEnergy.slice(0, 6).join(', ')}`);
  }
  if (moods.horror?.length) {
    parts.push(`Horror ambience, heartbeat, whispers, tension drones for: ${moods.horror.slice(0, 6).join(', ')}`);
  }
  parts.push(
    'Pure cinematic sound-design bed for short drama: impacts, risers, heartbeats, dark ambience; '
    + 'no melody lead, no vocals, sparse enough to sit under narration'
  );
  return parts.join('. ').slice(0, 900);
}

function loadEpisodeContext(db, episodeId) {
  const ep = db.prepare(
    'SELECT id, drama_id, title, episode_number, script_content, description FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(episodeId);
  if (!ep) return null;
  const drama = db.prepare(
    'SELECT id, title, genre FROM dramas WHERE id = ? AND deleted_at IS NULL'
  ).get(ep.drama_id);
  const storyboards = db.prepare(
    `SELECT storyboard_number, title, description, atmosphere, emotion, action, narration, dialogue, segment_title
     FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL
     ORDER BY storyboard_number ASC`
  ).all(episodeId);
  return { ep, drama, storyboards, moods: collectMoodSignals(storyboards) };
}

async function suggestBgmDescription(db, log, episodeId, options = {}) {
  const ctx = loadEpisodeContext(db, episodeId);
  if (!ctx) throw new Error('剧集不存在');
  const { ep, drama, storyboards, moods } = ctx;
  const includeSfx = !!options.include_sfx;
  const userHint = String(options.description || '').trim();

  const moodSamples = storyboards.slice(0, 12).map((sb) => {
    const bits = [sb.atmosphere, sb.emotion, sb.action, (sb.narration || sb.dialogue || '').slice(0, 80)]
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    return `第${sb.storyboard_number}镜：${bits.join(' / ') || '（无描述）'}`;
  });

  const system = includeSfx
    ? [
      '你是短视频配乐与音效设计师。',
      '为短剧成片写一条可直接用于 Suno 生成的中文描述。',
      '必须根据本集解说/分镜情绪写，覆盖整体氛围；若存在高燃或恐怖镜头，明确加入对应音效意向（冲击、心跳、暗氛围等）。',
      '只输出一段连续中文正文（60-140 字）：写乐器/情绪/节奏，并点到关键场景音效，强调无人声、不抢旁白。',
      '禁止：歌词、人声、markdown、标题、列表、作品名复述。',
    ].join('')
    : [
      '你是短视频配乐师。',
      '为短剧成片写一条可直接用于 Suno 纯器乐 BGM 的中文描述。',
      '必须根据解说/分镜情绪写，与旁白氛围一致。',
      '只输出一段连续中文正文（50-130 字）：写乐器、情绪、节奏、氛围；强调无人声、不抢旁白。',
      '禁止：歌词、人声、markdown、标题、列表、作品名复述。',
    ].join('');

  const userParts = [
    drama?.title ? `作品：${drama.title}` : '',
    drama?.genre ? `题材：${drama.genre}` : '',
    ep.title ? `本集：${ep.title}` : `第${ep.episode_number}集`,
    `范围：整集通用配乐（共 ${storyboards.length} 镜）`,
    moods.highEnergy.length ? `高燃镜头：${moods.highEnergy.join('、')}` : '',
    moods.horror.length ? `恐怖/悬疑镜头：${moods.horror.join('、')}` : '',
    userHint ? `用户补充意向：${userHint}` : '',
    moodSamples.length ? `各镜头氛围摘要：\n${moodSamples.join('\n')}` : '',
    ep.script_content ? `解说稿/剧本摘录：\n${String(ep.script_content).slice(0, 1200)}` : '',
    includeSfx ? '输出类型：含场景音效意向的成片配乐描述' : '输出类型：纯器乐背景音乐',
    '请直接输出描述正文，不要解释。',
  ].filter(Boolean);

  const raw = await aiClient.generateText(db, log, 'text', userParts.join('\n\n'), system, {
    max_tokens: 400,
  });
  const cleaned = sanitizeBgmDescription(raw);
  if (!cleaned) throw new Error('AI 未返回有效 BGM 描述');

  let sfxDescription = '';
  if (includeSfx && (moods.highEnergy.length || moods.horror.length)) {
    const sfxSystem = [
      '你是影视音效设计师。',
      '为短剧高燃/恐怖段落写一条可直接用于生成「音效床」的中文描述。',
      '只输出一段连续中文正文（40-100 字）：冲击音、心跳、暗氛围、上升音等；禁止旋律主线、人声、歌词、markdown。',
    ].join('');
    const sfxUser = [
      moods.highEnergy.length ? `高燃镜头：${moods.highEnergy.join('、')}` : '',
      moods.horror.length ? `恐怖镜头：${moods.horror.join('、')}` : '',
      userHint ? `用户补充：${userHint}` : '',
      cleaned ? `成片配乐方向：${cleaned}` : '',
      '请直接输出音效描述。',
    ].filter(Boolean).join('\n');
    try {
      const sfxRaw = await aiClient.generateText(db, log, 'text', sfxUser, sfxSystem, { max_tokens: 280 });
      sfxDescription = sanitizeBgmDescription(sfxRaw).slice(0, 300);
    } catch (err) {
      log?.warn?.('bgm suggest sfx description failed', { error: err.message });
    }
  }

  return {
    description: cleaned.slice(0, 400),
    sfx_description: sfxDescription || null,
    moods: {
      high_energy_shots: moods.highEnergy,
      horror_shots: moods.horror,
    },
  };
}

module.exports = {
  HIGH_ENERGY_RE,
  HORROR_RE,
  sanitizeBgmDescription,
  collectMoodSignals,
  buildBgmPrompt,
  buildSfxPrompt,
  loadEpisodeContext,
  suggestBgmDescription,
};
