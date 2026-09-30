'use strict';

/**
 * 加载火宝同源的剧本改写 SKILL.md（默认强对话驱动 dialogue_driven）。
 * skill 文件在仓库根 skills/；启用项写在 backend-node/data/active_skills.json。
 */

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.resolve(__dirname, '../../../skills');
const ACTIVE_SKILLS_PATH = path.resolve(__dirname, '../../data/active_skills.json');
const DEFAULT_SKILL_ID = 'script_rewriter/dialogue_driven';

function stripFrontmatter(content) {
  const raw = String(content || '');
  if (!raw.startsWith('---')) return raw.trim();
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return raw.trim();
  return raw.slice(end + 4).trim();
}

function readActiveSkillId() {
  try {
    if (!fs.existsSync(ACTIVE_SKILLS_PATH)) return DEFAULT_SKILL_ID;
    const parsed = JSON.parse(fs.readFileSync(ACTIVE_SKILLS_PATH, 'utf8'));
    const id = parsed && parsed.script_rewriter;
    return id && typeof id === 'string' ? id : DEFAULT_SKILL_ID;
  } catch {
    return DEFAULT_SKILL_ID;
  }
}

function resolveSkillPath(skillId) {
  return path.join(SKILLS_DIR, skillId, 'SKILL.md');
}

/**
 * @returns {{ skillId: string, body: string }}
 */
function loadScriptRewriteSkill() {
  let skillId = readActiveSkillId();
  let skillPath = resolveSkillPath(skillId);
  if (!fs.existsSync(skillPath)) {
    skillId = DEFAULT_SKILL_ID;
    skillPath = resolveSkillPath(skillId);
  }
  if (!fs.existsSync(skillPath)) {
    skillId = 'script_rewriter';
    skillPath = resolveSkillPath(skillId);
  }
  if (!fs.existsSync(skillPath)) {
    return { skillId: '', body: '' };
  }
  const body = stripFrontmatter(fs.readFileSync(skillPath, 'utf8'));
  return { skillId, body };
}

/**
 * 组装一次性 LLM 改写的 system prompt（本仓库无 Agent 工具链）。
 */
function buildRewriteSystemPrompt() {
  const { skillId, body } = loadScriptRewriteSkill();
  if (!body) {
    return {
      skillId: '',
      systemPrompt: `你是专业短剧编剧。将小说/草稿改写为格式化短剧剧本。
格式：## S编号 | 内景/外景 · 地点 | 时间段；动作自然段；角色名：（状态）台词。
按戏剧节拍切场，一场约 10–12 秒；不写镜头语言。只输出剧本正文。`,
    };
  }
  const systemPrompt = [
    '你是专业短剧编剧，擅长将小说或草稿改写为可拍的格式化短剧剧本。',
    `当前启用 skill：${skillId || 'script_rewriter'}（火宝同源）。`,
    '必须优先遵守下方 Skill 规范；若与用户明确要求冲突，以用户要求为准。',
    '本环境没有 read_episode_script / rewrite_to_screenplay / save_script 等工具：读取原文后直接改写，只输出最终剧本正文。',
    '输出要求：从 ## S01 起的连续场次；不要 markdown 代码块、不要前言后语、不要解释。',
    '',
    '---------- Skill 正文 ----------',
    body,
    '---------- Skill 结束 ----------',
  ].join('\n');
  return { skillId, systemPrompt };
}

/**
 * @param {{ title?: string, content: string, previousContext?: string }} opts
 */
function buildRewriteUserPrompt({ title, content, previousContext } = {}) {
  const parts = [];
  if (previousContext && String(previousContext).trim()) {
    parts.push('【上一集结尾（衔接用，勿重演）】');
    parts.push(String(previousContext).trim().slice(-4000));
    parts.push('');
  }
  parts.push('【本集待改写原文】');
  if (title) parts.push(`标题：${title}`);
  parts.push(String(content || '').trim());
  parts.push('');
  parts.push('请按当前 Skill 整段改写为本集格式化剧本，从 ## S01 开始输出。');
  return parts.join('\n');
}

module.exports = {
  DEFAULT_SKILL_ID,
  loadScriptRewriteSkill,
  buildRewriteSystemPrompt,
  buildRewriteUserPrompt,
  readActiveSkillId,
};
