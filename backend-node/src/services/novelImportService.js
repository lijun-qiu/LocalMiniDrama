'use strict';

/**
 * 小说/长文章节导入 + 强对话驱动剧本改写（火宝 dialogue_driven skill）
 */
const aiClient = require('./aiClient');
const {
  buildRewriteSystemPrompt,
  buildRewriteUserPrompt,
} = require('./scriptRewriteSkill');

/**
 * 简单的章节检测（不调用 AI，基于规则）
 */
function detectChaptersByRules(text) {
  const lines = text.split(/\r?\n/);
  const chapterPatterns = [
    /^第[零一二三四五六七八九十百千\d]+章/,
    /^第[零一二三四五六七八九十百千\d]+节/,
    /^第[零一二三四五六七八九十百千\d]+集/,
    /^Chapter\s+\d+/i,
    /^CHAPTER\s+\d+/,
    /^\d+[\.、]\s*.{2,20}$/,
    /^【.{1,30}】$/,
    /^「.{1,30}」$/,
  ];
  const chapters = [];
  let currentStart = 0;
  let currentTitle = '序章';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const isChapter = chapterPatterns.some((p) => p.test(line));
    if (isChapter) {
      if (i > currentStart) {
        const content = lines.slice(currentStart, i).join('\n').trim();
        if (content.length > 20) {
          chapters.push({ title: currentTitle, content });
        }
      }
      currentTitle = line;
      currentStart = i + 1;
    }
  }
  const lastContent = lines.slice(currentStart).join('\n').trim();
  if (lastContent.length > 20) {
    chapters.push({ title: currentTitle, content: lastContent });
  }
  return chapters;
}

function stripCodeFence(text) {
  let t = String(text || '').trim();
  if (/^```/.test(t)) {
    t = t.replace(/^```(?:markdown|md|text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return t;
}

/**
 * 用火宝「强对话驱动」skill 将原文改写为格式化剧本
 */
async function rewriteToScreenplay(db, log, { title, content, previousContext, dramaTitle } = {}) {
  const raw = String(content || '').trim();
  if (!raw) throw new Error('改写内容为空');

  const maxLen = 12000;
  const truncated = raw.length > maxLen ? `${raw.slice(0, maxLen)}\n…（原文已截断）` : raw;
  const { skillId, systemPrompt } = buildRewriteSystemPrompt();
  const userPrompt = buildRewriteUserPrompt({
    title: title || dramaTitle || '',
    content: truncated,
    previousContext,
  });

  const result = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    scene_key: 'novel_import',
    max_tokens: 8192,
    temperature: 0.55,
  });
  const out = stripCodeFence(result);
  if (!out || out.length < 40) {
    throw new Error('AI 改写结果过短或为空');
  }
  log?.info?.('[剧本改写] 完成', { skillId, chars: out.length, title: title || '' });
  return { script: out, skillId };
}

/**
 * 用 AI 将章节内容改写为剧本形式（导入路径）
 */
async function summarizeChapterToScript(db, log, chapterTitle, chapterContent, dramaTitle, previousContext) {
  try {
    const { script } = await rewriteToScreenplay(db, log, {
      title: chapterTitle,
      content: chapterContent,
      dramaTitle,
      previousContext,
    });
    return script;
  } catch (err) {
    log.warn('[小说导入] AI改写章节失败，使用原文截断', { error: err.message });
    return chapterContent.slice(0, 2000);
  }
}

/**
 * 主入口：解析小说文本，返回章节列表
 * @returns {{ chapters: Array<{title, content, script}>, skillId?: string }}
 */
async function importNovel(db, log, { text, title, maxChapters, aiSummarize }) {
  if (!text || !text.trim()) throw new Error('小说内容不能为空');

  const chapters = detectChaptersByRules(text);
  if (chapters.length === 0) {
    chapters.push({ title: title || '第一集', content: text.trim() });
  }

  const limit = Math.min(maxChapters || 20, chapters.length);
  const result = [];
  let skillId = '';
  let previousTail = '';

  for (let i = 0; i < limit; i++) {
    const ch = chapters[i];
    let script = ch.content;
    if (aiSummarize) {
      script = await summarizeChapterToScript(db, log, ch.title, ch.content, title, previousTail);
      if (!skillId) {
        try {
          skillId = require('./scriptRewriteSkill').readActiveSkillId();
        } catch (_) {}
      }
      // 跨集衔接：取上集改写结果末尾
      previousTail = String(script || '').slice(-2500);
    }
    result.push({
      index: i + 1,
      title: ch.title,
      content: ch.content.slice(0, 300),
      script,
    });
  }

  return { chapters: result, total: chapters.length, skillId: skillId || undefined };
}

module.exports = {
  importNovel,
  detectChaptersByRules,
  rewriteToScreenplay,
  summarizeChapterToScript,
};
