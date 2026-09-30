'use strict';

/**
 * reference_video final script: promote step1 units → video_units + storyboard bindings.
 */

const scriptReview = require('./scriptReviewService');
const { resolveProjectModes } = require('./workflowRules');
const { WorkflowRequestError } = require('./workflowErrors');
const artifactCurrency = require('./artifactCurrency');
const { digestRaw } = require('./canonicalDigest');

function resolveEpisode(db, episodeId) {
  const ep = db
    .prepare(
      `SELECT id, drama_id, episode_number, title, script_content FROM episodes
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get(Number(episodeId));
  if (!ep) throw new WorkflowRequestError('episode not found');
  const dramaService = require('../dramaService');
  const drama = dramaService.getDramaById(db, ep.drama_id);
  if (!drama) throw new WorkflowRequestError('drama not found');
  return { ep, drama };
}

/**
 * ArcReel generate_episode_script (step2 visual expand) + promote to video_units / storyboards.
 */
async function generateReferenceScript(db, log, episodeId, opts = {}) {
  const { ep, drama } = resolveEpisode(db, episodeId);
  const modes = resolveProjectModes(drama.metadata);
  if (modes.generation_mode !== 'reference_video') {
    throw new WorkflowRequestError('generateReferenceScript requires generation_mode=reference_video');
  }

  const review = scriptReview.getReview(db, episodeId);
  if (review.status !== 'confirmed') {
    throw new WorkflowRequestError('step1 must be confirmed before generate_script');
  }
  const step1 = review.content;
  const rawUnits = Array.isArray(step1?.units) ? step1.units : [];
  if (!rawUnits.length) throw new WorkflowRequestError('step1 has no units');

  const {
    renderMentionsToOmniSpeech,
    parseReferenceMentions,
    innerMonologueLipGuard,
    appendInnerMonologueLipGuard,
    convertChineseScreenplayToMentions,
    resolveAssetBindings,
  } = require('./referenceMentions');
  const draftValidation = require('./draftValidation');
  const prompts = require('./referenceVideoPrompts');
  const episodeWardrobe = require('./episodeWardrobe');

  const dramaChars = db
    .prepare(
      `SELECT id, name, appearance, description, local_path, image_url, looks FROM characters
       WHERE drama_id = ? AND deleted_at IS NULL`
    )
    .all(drama.id);
  const dramaScenes = db
    .prepare(
      `SELECT id, location, prompt, local_path, image_url FROM scenes
       WHERE drama_id = ? AND deleted_at IS NULL`
    )
    .all(drama.id);
  const dramaProps = db
    .prepare(
      `SELECT id, name, description, local_path, image_url FROM props
       WHERE drama_id = ? AND deleted_at IS NULL`
    )
    .all(drama.id);

  // Prefer wardrobe episode lists for LLM candidate tables
  let characters = dramaChars;
  let scenes = dramaScenes;
  let propsList = dramaProps;
  try {
    characters = episodeWardrobe.listDramaCharacters(db, drama.id, ep.id);
    scenes = episodeWardrobe.listEpisodeScenes(db, drama.id, ep.id);
    propsList = episodeWardrobe.listEpisodeProps(db, drama.id, ep.id);
  } catch (_) {}

  let expandedTexts = null;
  let expandMeta = { method: 'passthrough' };
  if (opts.skip_llm !== true) {
    try {
      const aiClient = require('../aiClient');
      const { safeParseAIJSON } = require('../../utils/safeJson');
      const systemPrompt = prompts.buildStep2ExpandPrompt({
        episode: ep.episode_number,
        overview: {
          synopsis: drama.description || '',
          genre: drama.genre || '',
        },
        style: drama.style || drama.metadata?.style_prompt_zh || '',
        styleDescription: drama.metadata?.style_prompt_en || '',
        aspectRatio: drama.metadata?.aspect_ratio || '16:9',
        characters,
        scenes,
        props: propsList,
        step1Units: rawUnits,
        maxRefs: 9,
      });
      const raw = await aiClient.generateText(
        db,
        log,
        'text',
        `请按系统提示对第 ${ep.episode_number} 集已确认的 step1_units 做视觉展开 JSON。`,
        systemPrompt,
        {
          scene_key: opts.scene_key || 'reference_step2_expand',
          max_tokens: opts.max_tokens || 8000,
          temperature: 0.3,
          json_mode: true,
        }
      );
      const parsed = safeParseAIJSON(raw, log);
      const step2Units = Array.isArray(parsed?.units) ? parsed.units : [];
      if (step2Units.length !== rawUnits.length) {
        throw new Error(`unit_count_changed: step1=${rawUnits.length} step2=${step2Units.length}`);
      }
      const merged = [];
      for (let i = 0; i < rawUnits.length; i += 1) {
        const s1 = String(rawUnits[i].text || '');
        const sourceText = String(rawUnits[i].source_text || '').trim();
        let s2 = String(step2Units[i]?.text || '').trim();
        if (!s2) throw new Error(`step2 unit ${i + 1} empty`);
        // 统一规则：相对 step1 text 与 source_text 都必须保住台词/心声
        const check = draftValidation.assertDialoguePreserved(s1, s2);
        if (!check.ok) {
          log?.warn?.('[step2] dialogue not preserved vs step1, keep step1 text', {
            unit: i + 1,
            code: check.code,
            message: check.message,
          });
          s2 = s1;
        }
        s2 = draftValidation.ensureSourceSpeechInText(sourceText, s2);
        const srcCheck = draftValidation.assertSourceSpeechCovered(sourceText, s2);
        if (!srcCheck.ok) {
          log?.warn?.('[step2] source speech still missing after repair, fallback step1+repair', {
            unit: i + 1,
            missing: srcCheck.missing?.slice(0, 3),
          });
          s2 = draftValidation.ensureSourceSpeechInText(sourceText, s1);
        }
        merged.push(s2);
      }
      expandedTexts = merged;
      expandMeta = {
        method: 'llm_expand',
        title: String(parsed?.title || '').trim() || null,
      };
    } catch (e) {
      log?.warn?.('[generate_script] step2 LLM failed, use step1 text', { error: e.message });
      expandMeta = { method: 'passthrough_fallback', error: e.message };
    }
  }

  const bindCatalog = {
    characters: dramaChars,
    scenes: dramaScenes,
    props: dramaProps,
  };

  /** Merge bindings from step1 + expanded text so LLM drop of @[场景]/@[道具] still binds */
  function mergeBindings(parts) {
    const charMap = new Map();
    let sceneId = null;
    const propIds = [];
    const propSeen = new Set();
    const unresolved = [];
    for (const part of parts) {
      if (!part) continue;
      const b = resolveAssetBindings(part, bindCatalog);
      for (const cb of b.characterBindings || []) {
        const prev = charMap.get(cb.id);
        if (!prev) charMap.set(cb.id, { ...cb });
        else if (cb.look && cb.look !== 'base' && prev.look === 'base') prev.look = cb.look;
      }
      if (sceneId == null && b.sceneId != null) sceneId = b.sceneId;
      for (const pid of b.propIds || []) {
        if (!propSeen.has(pid)) {
          propSeen.add(pid);
          propIds.push(pid);
        }
      }
      for (const u of b.unresolved || []) unresolved.push(u);
    }
    const characterBindings = [...charMap.values()];
    return {
      characterIds: characterBindings.map((c) => c.id),
      characterBindings,
      sceneId,
      propIds,
      unresolved: [...new Set(unresolved)],
    };
  }

  const videoUnits = rawUnits.map((u, i) => {
    const step1Text = String(u.text || '').trim();
    const sourceText = String(u.source_text || '').trim();
    let rawText = expandedTexts ? expandedTexts[i] : step1Text;
    // 出口硬规则（任意剧本）：source_text 台词/心声必须进最终 text
    rawText = draftValidation.ensureSourceSpeechInText(sourceText, rawText);
    if (rawText && !/@\[/.test(rawText) && /[：:]/.test(rawText)) {
      rawText = convertChineseScreenplayToMentions(rawText);
    }
    rawText = draftValidation.ensureSourceSpeechInText(sourceText, rawText);
    const covered = draftValidation.assertSourceSpeechCovered(sourceText, rawText);
    if (!covered.ok) {
      throw new WorkflowRequestError(
        `unit ${u.unit_id || i + 1} 台词覆盖失败：${covered.message}。请重跑整理内容。`
      );
    }
    const { hits } = parseReferenceMentions(rawText);
    let text = renderMentionsToOmniSpeech(rawText);
    // 幂等补齐：心声【心声画面】/旁白【旁白画面】/混排【开口说话】+段首节拍约束
    text = appendInnerMonologueLipGuard(text);
    // 仅心声无对白时再挂整段闭嘴（混排不加，避免封死对白口型）
    const lip = innerMonologueLipGuard(hits);
    if (lip && !text.includes(lip.split('\n')[0])) text = `${text}\n${lip}`;
    const bindings = mergeBindings([step1Text, sourceText, rawText, text]);
    if (bindings.unresolved?.length) {
      log?.warn?.('[generate_script] unresolved @[mentions]', {
        unit: u.unit_id || i + 1,
        names: bindings.unresolved.slice(0, 12),
      });
    }
    return {
      unit_id: u.unit_id || `E${ep.episode_number}U${String(i + 1).padStart(2, '0')}`,
      text,
      duration_seconds: Number(u.duration_seconds) || 5,
      transition_to_next: u.transition_to_next || 'cut',
      note: u.note || null,
      source_text: u.source_text || null,
      generated_assets: {
        storyboard_image: null,
        video_clip: null,
        video_uri: null,
        status: 'pending',
      },
      needs_replan: false,
      _bindings: bindings,
    };
  });

  const now = new Date().toISOString();
  const map = {};

  const existing = db
    .prepare(`SELECT id FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL`)
    .all(ep.id);
  for (const row of existing) {
    db.prepare(`UPDATE storyboards SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(now, now, row.id);
  }

  let num = 1;
  for (const unit of videoUnits) {
    const bindings = unit._bindings || { characterIds: [], sceneId: null, propIds: [] };
    delete unit._bindings;
    const charJson =
      bindings.characterBindings && bindings.characterBindings.length
        ? bindings.characterBindings
        : (bindings.characterIds || []).map((id) => ({ id }));
    const info = db
      .prepare(
        `INSERT INTO storyboards (
          episode_id, scene_id, storyboard_number, title, description, narration, duration,
          creation_mode, universal_segment_text, characters, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'universal', ?, ?, 'pending', ?, ?)`
      )
      .run(
        ep.id,
        bindings.sceneId,
        num,
        unit.unit_id,
        unit.text.slice(0, 200),
        modes.content_mode === 'narration' ? unit.text : null,
        unit.duration_seconds,
        unit.text,
        JSON.stringify(charJson),
        now,
        now
      );
    const sbId = info.lastInsertRowid;
    map[unit.unit_id] = sbId;
    if (bindings.propIds?.length) {
      try {
        const ins = db.prepare(
          `INSERT OR IGNORE INTO storyboard_props (storyboard_id, prop_id) VALUES (?, ?)`
        );
        for (const pid of bindings.propIds) ins.run(sbId, pid);
      } catch (e) {
        log?.warn?.('[generate_script] storyboard_props insert failed', {
          storyboard_id: sbId,
          error: e.message,
        });
      }
    }
    num += 1;
  }

  const meta = scriptReview.getWorkflowMeta(drama.metadata);
  const epKey = String(ep.episode_number);
  meta.workflow.episodes[epKey] = {
    ...(meta.workflow.episodes[epKey] || {}),
    video_units: videoUnits,
    unit_storyboard_map: map,
    script_step1_revision: review.fingerprint,
    script_title: expandMeta.title || null,
    script_expand: expandMeta,
  };
  if (expandMeta.title) {
    try {
      db.prepare('UPDATE episodes SET title = ?, updated_at = ? WHERE id = ?').run(
        expandMeta.title,
        now,
        ep.id
      );
    } catch (_) {}
  }
  scriptReview.saveDramaMeta(db, drama.id, meta);

  try {
    const projectDir = scriptReview.projectAbsDir(db, drama);
    artifactCurrency.registerCurrent(
      projectDir,
      artifactCurrency.ArtifactKey.episodeScript(ep.episode_number),
      `metadata.workflow.episodes.${epKey}.video_units`,
      {
        kind: 'structured-content/episode-script',
        kind_version: 2,
        inputs: {
          content_mode: modes.content_mode,
          generation_mode: modes.generation_mode,
          step1_content: review.fingerprint,
          source_content: digestRaw(ep.script_content || ''),
          expand_method: expandMeta.method,
        },
      }
    );
  } catch (e) {
    log?.warn?.('register script currency failed', { error: e.message });
  }

  log?.info?.('reference video_units generated', {
    episode_id: ep.id,
    units: videoUnits.length,
    expand: expandMeta.method,
  });

  return {
    episode_id: ep.id,
    episode: ep.episode_number,
    video_units: videoUnits,
    unit_storyboard_map: map,
    storyboard_count: videoUnits.length,
    expand: expandMeta,
  };
}

function listVideoUnits(db, episodeId) {
  const { ep, drama } = resolveEpisode(db, episodeId);
  const meta = scriptReview.getWorkflowMeta(drama.metadata);
  const epMeta = meta.workflow.episodes[String(ep.episode_number)] || {};
  return {
    episode: ep.episode_number,
    episode_id: ep.id,
    video_units: epMeta.video_units || [],
    unit_storyboard_map: epMeta.unit_storyboard_map || {},
  };
}

module.exports = {
  generateReferenceScript,
  listVideoUnits,
};
