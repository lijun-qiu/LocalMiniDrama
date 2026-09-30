'use strict';

/**
 * step1 content organization + review gate (ArcReel script_review subset).
 * Files under {projectStorage}/drafts/episode_{N}/
 * Gate record in dramas.metadata.workflow.episodes[N]
 */

const fs = require('fs');
const path = require('path');
const storageLayout = require('../storageLayout');
const { loadConfig } = require('../../config');
const { canonicalJsonDigest, digestRaw } = require('./canonicalDigest');
const { resolveProjectModes, workflowRule } = require('./workflowRules');
const artifactCurrency = require('./artifactCurrency');
const { WorkflowRequestError } = require('./workflowErrors');
const draftValidation = require('./draftValidation');

function storageRoot() {
  if (process.env.LMD_STORAGE_ROOT) {
    return path.resolve(process.env.LMD_STORAGE_ROOT);
  }
  const cfg = loadConfig();
  const p = cfg.storage?.local_path || './data/storage';
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function projectAbsDir(db, drama) {
  const sub = storageLayout.getProjectStorageSubdir(db, drama.id);
  return path.join(storageRoot(), sub);
}

function step1Kind(modes) {
  if (modes.generation_mode === 'reference_video') return 'reference_video';
  if (modes.content_mode === 'narration') return 'narration';
  return 'drama';
}

function step1FileName(kind) {
  if (kind === 'reference_video') return 'step1_reference_units.json';
  if (kind === 'narration') return 'step1_segments.json';
  return 'step1_normalized_script.json';
}

function quarantineFileName(kind) {
  if (kind === 'reference_video') return 'step1_reference_units.invalid.json';
  if (kind === 'drama') return 'step1_normalized_script.invalid.json';
  return null;
}

function draftsDir(projectDir, episodeNumber) {
  return path.join(projectDir, 'drafts', `episode_${episodeNumber}`);
}

function step1RelPath(episodeNumber, kind) {
  return `drafts/episode_${episodeNumber}/${step1FileName(kind)}`;
}

function getWorkflowMeta(meta) {
  const m = meta && typeof meta === 'object' ? { ...meta } : {};
  m.workflow = m.workflow && typeof m.workflow === 'object' ? { ...m.workflow } : {};
  m.workflow.episodes =
    m.workflow.episodes && typeof m.workflow.episodes === 'object'
      ? { ...m.workflow.episodes }
      : {};
  return m;
}

function saveDramaMeta(db, dramaId, meta) {
  const now = new Date().toISOString();
  db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(meta),
    now,
    Number(dramaId)
  );
}

function episodeGate(meta, episodeNumber) {
  const ep = meta.workflow?.episodes?.[String(episodeNumber)];
  return ep && typeof ep === 'object' ? ep : {};
}

/** 超上限时合并尾部，禁止静默丢弃对白所在片段 */
function packUnitsToMax(chunks, maxUnits) {
  const list = (chunks || []).map((s) => String(s || '').trim()).filter(Boolean);
  const max = Math.max(1, Number(maxUnits) || 80);
  if (list.length <= max) return list;
  const out = list.slice();
  while (out.length > max) {
    const b = out.pop();
    out[out.length - 1] = `${out[out.length - 1]}\n\n${b}`;
  }
  return out;
}

function splitScriptHeuristic(script, episodeNumber, kind) {
  const { convertChineseScreenplayToMentions, splitScreenplayUnits } = require('./referenceMentions');
  const prompts = require('./referenceVideoPrompts');
  const rawUnits = splitScreenplayUnits(script);
  const units = packUnitsToMax(
    rawUnits.length ? rawUnits : [String(script || '').trim() || '（空）'],
    80
  );

  if (kind === 'reference_video') {
    return {
      units: units.map((t, i) => {
        const converted = convertChineseScreenplayToMentions(t);
        const speechFloor = draftValidation.estimateSpeechSeconds(
          converted,
          draftValidation.SPEECH_CHARS_PER_SECOND
        );
        const duration_seconds = draftValidation.snapDuration(
          Math.max(5, speechFloor),
          prompts.DEFAULT_DURATIONS,
          [speechFloor, 5]
        );
        return {
          unit_id: `E${episodeNumber}U${String(i + 1).padStart(2, '0')}`,
          text: converted,
          duration_seconds,
          // 完整源片段：台词硬规则依赖 source_text，不可截断
          source_text: String(t),
        };
      }),
    };
  }
  if (kind === 'narration') {
    return {
      segments: units.map((t, i) => ({
        segment_id: `E${episodeNumber}S${String(i + 1).padStart(2, '0')}`,
        novel_text: t,
        duration_seconds: 5,
        segment_break: true,
        characters_in_segment: [],
        scenes: [],
        props: [],
      })),
    };
  }
  return {
    title: `Episode ${episodeNumber}`,
    scenes: units.map((t, i) => ({
      scene_id: `E${episodeNumber}C${String(i + 1).padStart(2, '0')}`,
      scene_description: t,
      utterances: [],
      source_text: t.slice(0, 200),
      duration_seconds: 5,
      characters_in_scene: [],
      scenes: [],
      props: [],
    })),
  };
}

function contentFingerprint(data) {
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      return canonicalJsonDigest(JSON.parse(data));
    } catch {
      return digestRaw(data);
    }
  }
  return canonicalJsonDigest(data);
}

function readJsonIfExists(abs) {
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

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
 * Derived review status (ArcReel review_status).
 */
function reviewStatus(db, drama, episodeNumber) {
  const meta = getWorkflowMeta(drama.metadata);
  const modes = resolveProjectModes(meta);
  const kind = step1Kind(modes);
  const projectDir = projectAbsDir(db, drama);
  const formalAbs = path.join(draftsDir(projectDir, episodeNumber), step1FileName(kind));
  const qName = quarantineFileName(kind);
  const qAbs = qName ? path.join(draftsDir(projectDir, episodeNumber), qName) : null;
  const data = readJsonIfExists(formalAbs);
  const fingerprint = data ? contentFingerprint(data) : null;
  const gate = episodeGate(meta, episodeNumber);
  const storedFp = gate.step1_review?.fingerprint || null;
  const enforced = meta.workflow?.step1_enforced === true;

  if (!enforced) {
    // Legacy: script alone counts as confirmed organized content
    const scriptOk = Boolean(String(
      db.prepare(
        `SELECT script_content FROM episodes WHERE drama_id = ? AND episode_number = ? AND deleted_at IS NULL`
      ).get(drama.id, episodeNumber)?.script_content || ''
    ).trim());
    return {
      status: scriptOk ? 'confirmed' : 'no_step1',
      fingerprint: fingerprint || (scriptOk ? `legacy-script-ep${episodeNumber}` : null),
      confirmed_at: gate.step1_review?.confirmed_at || null,
      kind,
      enforced: false,
      content: data,
      quarantined: false,
    };
  }

  if (qAbs && fs.existsSync(qAbs)) {
    return {
      status: 'pending_review',
      fingerprint,
      confirmed_at: null,
      kind,
      enforced: true,
      content: data,
      quarantined: true,
    };
  }
  if (!data) {
    return {
      status: 'no_step1',
      fingerprint: null,
      confirmed_at: null,
      kind,
      enforced: true,
      content: null,
      quarantined: false,
    };
  }
  if (storedFp && storedFp === fingerprint) {
    return {
      status: 'confirmed',
      fingerprint,
      confirmed_at: gate.step1_review?.confirmed_at || null,
      kind,
      enforced: true,
      content: data,
      quarantined: false,
    };
  }
  // Grandfather: storyboards already exist and confirmation was never written
  const epRow = db
    .prepare(
      `SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? AND deleted_at IS NULL`
    )
    .get(drama.id, episodeNumber);
  const gateHasReviewKey =
    gate && Object.prototype.hasOwnProperty.call(gate, 'step1_review');
  if (epRow && !gateHasReviewKey) {
    const sbCount = db
      .prepare(`SELECT COUNT(*) AS c FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL`)
      .get(epRow.id)?.c;
    if (sbCount > 0) {
      return {
        status: 'confirmed',
        fingerprint,
        confirmed_at: null,
        kind,
        enforced: true,
        content: data,
        quarantined: false,
        grandfathered: true,
      };
    }
  }
  return {
    status: 'pending_review',
    fingerprint,
    confirmed_at: null,
    kind,
    enforced: true,
    content: data,
    quarantined: false,
  };
}

function getReview(db, episodeId) {
  const { ep, drama } = resolveEpisode(db, episodeId);
  const modes = resolveProjectModes(drama.metadata);
  const st = reviewStatus(db, drama, ep.episode_number);
  const projectDir = projectAbsDir(db, drama);
  const qName = quarantineFileName(st.kind);
  let quarantine = null;
  if (qName) {
    const qAbs = path.join(draftsDir(projectDir, ep.episode_number), qName);
    quarantine = readJsonIfExists(qAbs);
  }
  return {
    episode: ep.episode_number,
    episode_id: ep.id,
    content_mode: modes.content_mode,
    generation_mode: modes.generation_mode,
    status: st.status,
    fingerprint: st.fingerprint,
    confirmed_at: st.confirmed_at,
    content: st.content,
    quarantine,
    preprocessor: workflowRule(modes.content_mode, modes.generation_mode).preprocessor,
  };
}

function writeFormalStep1(db, drama, episodeNumber, content, { sourceScript }) {
  const meta = getWorkflowMeta(drama.metadata);
  const modes = resolveProjectModes(meta);
  const kind = step1Kind(modes);
  const projectDir = projectAbsDir(db, drama);
  const dir = draftsDir(projectDir, episodeNumber);
  fs.mkdirSync(dir, { recursive: true });
  const rel = step1RelPath(episodeNumber, kind);
  const abs = path.join(projectDir, rel);
  fs.writeFileSync(abs, JSON.stringify(content, null, 2), 'utf8');

  // Clear confirmation on content change
  const epKey = String(episodeNumber);
  meta.workflow.episodes[epKey] = {
    ...(meta.workflow.episodes[epKey] || {}),
    step1_review: null,
  };
  // Clear quarantine
  const qName = quarantineFileName(kind);
  if (qName) {
    const qAbs = path.join(dir, qName);
    if (fs.existsSync(qAbs)) fs.unlinkSync(qAbs);
  }

  artifactCurrency.registerCurrent(projectDir, artifactCurrency.ArtifactKey.episodeStep1(episodeNumber), rel, {
    kind: 'structured-content/step1',
    kind_version: 2,
    inputs: {
      content_mode: modes.content_mode,
      generation_mode: modes.generation_mode,
      source_content: digestRaw(sourceScript || ''),
    },
  });

  saveDramaMeta(db, drama.id, meta);
  return { fingerprint: contentFingerprint(content), path: rel, kind };
}

function resolveDurationTiers(drama) {
  const prompts = require('./referenceVideoPrompts');
  const clipDur = Number(drama?.metadata?.video_clip_duration) || 5;
  if (prompts.DEFAULT_DURATIONS.includes(clipDur)) return prompts.DEFAULT_DURATIONS.slice();
  return [...new Set([...prompts.DEFAULT_DURATIONS, clipDur])].sort((a, b) => a - b);
}

/**
 * 台词回填 → 剧本级漏句补全 → 超长拆/并 → 5字/秒压到最短够用档（最长 12s）；仍超则 speech_overload 标红。
 */
function applySpeechAndDurationGates(units, { script, durations, hardFailOmissions = true } = {}) {
  const tiers = durations || require('./referenceVideoPrompts').DEFAULT_DURATIONS;
  const rate = draftValidation.SPEECH_CHARS_PER_SECOND;
  let speech_repaired = 0;
  let working = units;

  const enforced = draftValidation.enforceUnitsSourceSpeech(working);
  working = enforced.units;
  speech_repaired += enforced.repaired || 0;

  if (script) {
    const covFix = draftValidation.repairScriptDialogueCoverage(script, working);
    working = covFix.units;
    speech_repaired += covFix.repaired || 0;
    // 补句后再按 unit source 回填一次
    const enforced2 = draftValidation.enforceUnitsSourceSpeech(working);
    working = enforced2.units;
    speech_repaired += enforced2.repaired || 0;
  }

  const repaired = draftValidation.repairSpeechOverloadUnits(working, {
    durations: tiers,
    speechRate: rate,
  });
  const coverage = script
    ? draftValidation.validateSourceDialogueCoverage(script, repaired.units)
    : [];
  if (hardFailOmissions && coverage.length) {
    const err = new WorkflowRequestError(
      `源文有 ${coverage.length} 句对白/心声未写入画面（例：${coverage[0].name || '旁白'}：${coverage[0].text || ''}）。`
    );
    err.code = 'source_dialogue_omitted';
    err.violations = coverage.slice(0, 40);
    throw err;
  }
  // 拆并后按集号重排 unit_id
  let epNum = null;
  for (const u of repaired.units) {
    const m = String(u.unit_id || '').match(/^E(\d+)/i);
    if (m) {
      epNum = m[1];
      break;
    }
  }
  const finalUnits = repaired.units.map((u, i) => ({
    ...u,
    unit_id: epNum
      ? `E${epNum}U${String(i + 1).padStart(2, '0')}`
      : u.unit_id || `U${String(i + 1).padStart(2, '0')}`,
  }));

  return {
    units: finalUnits,
    speech_repaired,
    duration_adjusted: repaired.adjusted,
    speech_overloads: repaired.overloads,
    splits: repaired.splits || 0,
    merges: repaired.merges || 0,
    omissions: coverage,
  };
}

/**
 * prepare_step1: ArcReel split_reference_video_units (LLM) for reference_video;
 * other modes keep heuristic organize.
 */
async function prepareStep1(db, episodeId, opts = {}) {
  const { ep, drama } = resolveEpisode(db, episodeId);
  const meta = getWorkflowMeta(drama.metadata);
  meta.workflow.step1_enforced = true;
  saveDramaMeta(db, drama.id, meta);
  drama.metadata = meta;

  const modes = resolveProjectModes(meta);
  const kind = step1Kind(modes);
  const script = String(ep.script_content || '').trim();
  if (!script) throw new WorkflowRequestError('episode script is required before prepare_step1');

  let content;
  let prepareMeta = { method: 'heuristic' };
  if (kind === 'reference_video' && opts.skip_llm !== true) {
    try {
      const llmOut = await prepareReferenceStep1WithLlm(db, opts.log || { info() {}, warn() {}, error() {} }, ep, drama, script, opts);
      content = llmOut.content;
      prepareMeta = { method: 'llm_split', ...llmOut.meta };
    } catch (e) {
      // LLM 失败（含台词漏句硬失败）一律启发式兜底，避免用户卡死
      (opts.log || console).warn?.('[prepare_step1] LLM split failed, fallback heuristic', {
        error: e.message,
        code: e.code,
      });
      content = splitScriptHeuristic(script, ep.episode_number, kind);
      prepareMeta = { method: 'heuristic_fallback', error: e.message, llm_code: e.code || null };
    }
  } else {
    content = splitScriptHeuristic(script, ep.episode_number, kind);
  }

  // 任意剧本统一出口：台词回填 + 5字/秒压到最短够用档
  if (kind === 'reference_video' && Array.isArray(content?.units)) {
    const gated = applySpeechAndDurationGates(content.units, {
      script,
      durations: resolveDurationTiers(drama),
    });
    content = { ...content, units: gated.units };
    prepareMeta.speech_repaired = (prepareMeta.speech_repaired || 0) + gated.speech_repaired;
    prepareMeta.duration_adjusted = (prepareMeta.duration_adjusted || 0) + gated.duration_adjusted;
    prepareMeta.speech_splits = gated.splits || 0;
    prepareMeta.speech_merges = gated.merges || 0;
  }

  const written = writeFormalStep1(db, drama, ep.episode_number, content, { sourceScript: script });
  return { ...getReview(db, episodeId), prepared: true, prepare: prepareMeta, ...written };
}

async function prepareReferenceStep1WithLlm(db, log, ep, drama, script, opts = {}) {
  const aiClient = require('../aiClient');
  const { safeParseAIJSON } = require('../../utils/safeJson');
  const prompts = require('./referenceVideoPrompts');
  const episodeWardrobe = require('./episodeWardrobe');

  const characters = episodeWardrobe.listDramaCharacters(db, drama.id, ep.id);
  const scenes = episodeWardrobe.listEpisodeScenes(db, drama.id, ep.id);
  const props = episodeWardrobe.listEpisodeProps(db, drama.id, ep.id);
  const registeredNames = [
    ...characters.map((c) => c.name),
    ...scenes.map((s) => s.location || s.name),
    ...props.map((p) => p.name),
  ]
    .map((n) => String(n || '').trim())
    .filter(Boolean);

  const clipDur = Number(drama.metadata?.video_clip_duration) || 5;
  const durations = prompts.DEFAULT_DURATIONS.includes(clipDur)
    ? prompts.DEFAULT_DURATIONS
    : [...new Set([...prompts.DEFAULT_DURATIONS, clipDur])].sort((a, b) => a - b);

  const systemPrompt = prompts.buildStep1SplitPrompt({
    episode: ep.episode_number,
    novelText: script,
    overview: {
      synopsis: drama.description || '',
      genre: drama.genre || '',
      theme: '',
      world_setting: '',
    },
    characters,
    scenes,
    props,
    supportedDurations: durations,
    maxDuration: Math.max(...durations),
    defaultDuration: clipDur,
    maxRefs: 9,
    speechRate: 5,
  });

  const raw = await aiClient.generateText(
    db,
    log,
    'text',
    `请按系统提示拆分第 ${ep.episode_number} 集源文为 video_units JSON。`,
    systemPrompt,
    {
      scene_key: opts.scene_key || 'reference_step1_split',
      max_tokens: opts.max_tokens || 8000,
      temperature: 0.2,
      json_mode: true,
    }
  );

  let parsed;
  try {
    parsed = safeParseAIJSON(raw, log);
  } catch (e) {
    const err = new Error('step1 LLM 解析失败: ' + (e.message || 'invalid json'));
    err.code = 'parse_error';
    err.raw = String(raw || '').slice(0, 2000);
    throw err;
  }

  let units = draftValidation.normalizeStep1Units(parsed?.units || [], {
    novelText: script,
    durations,
    speechRate: draftValidation.SPEECH_CHARS_PER_SECOND,
  });
  if (!units.length) throw new Error('step1 LLM 未返回 units');

  // 台词回填后再按 5 字/秒压到最短够用档（回填可能加长口播）
  const gated = applySpeechAndDurationGates(units, {
    script,
    durations,
    hardFailOmissions: true,
  });
  units = gated.units;
  if (gated.speech_repaired) {
    log.info?.('[prepare_step1] repaired missing source speech into unit text', {
      repaired: gated.speech_repaired,
    });
  }
  if (gated.duration_adjusted) {
    log.info?.('[prepare_step1] raised duration for speech floor (5字/秒)', {
      adjusted: gated.duration_adjusted,
    });
  }

  const unitViolations = [];
  units.forEach((u, i) => {
    const vs = draftValidation.validateStep1Unit(u, {
      novelText: script,
      registeredNames,
      durations,
      maxRefs: 9,
      speechRate: draftValidation.SPEECH_CHARS_PER_SECOND,
    });
    for (const v of vs) unitViolations.push({ unit_index: i, ...v });
  });
  // 台词遗漏已在 gate 硬失败；此处只留软警告（时长超载已在 gate 处理）
  const softViolations = unitViolations.filter(
    (v) => v.code !== 'source_dialogue_omitted' && v.code !== 'dialogue_overload'
  );

  units = units
    .map((u, i) => ({
      unit_id: u.unit_id || `E${ep.episode_number}U${String(i + 1).padStart(2, '0')}`,
      duration_seconds: u.duration_seconds,
      source_text: u.source_text,
      text: u.text,
      speech_seconds: u.speech_seconds,
      speech_chars: u.speech_chars,
      speech_overload: !!u.speech_overload,
    }))
    .filter((u) => u.text);

  if (!units.length) {
    const err = new Error('step1 LLM units 全部无效');
    err.code = 'validation_failed';
    err.violations = softViolations;
    throw err;
  }

  if (softViolations.length) {
    log.warn?.('[prepare_step1] validation warnings', {
      count: softViolations.length,
      sample: softViolations.slice(0, 8),
    });
  }
  if (gated.speech_overloads?.length) {
    log.warn?.('[prepare_step1] speech overload (mark red in UI)', {
      count: gated.speech_overloads.length,
      sample: gated.speech_overloads.slice(0, 5),
    });
  }

  return {
    content: { units },
    meta: {
      unit_count: units.length,
      violation_count: softViolations.length,
      violations: softViolations.slice(0, 40),
      speech_repaired: gated.speech_repaired,
      duration_adjusted: gated.duration_adjusted,
      speech_overloads: gated.speech_overloads || [],
    },
  };
}

function putStep1Content(db, episodeId, content, baseFingerprint) {
  const { ep, drama } = resolveEpisode(db, episodeId);
  // 手工改稿：台词覆盖 + 5字/秒时长
  if (Array.isArray(content?.units)) {
    const gated = applySpeechAndDurationGates(content.units, {
      script: String(ep.script_content || ''),
      durations: resolveDurationTiers(drama),
    });
    content = { ...content, units: gated.units };
  }
  const current = getReview(db, episodeId);
  if (baseFingerprint != null && current.fingerprint && current.fingerprint !== baseFingerprint) {
    const err = new WorkflowRequestError('step1 fingerprint conflict');
    err.code = 'conflict';
    throw err;
  }
  if (current.quarantine) {
    const err = new WorkflowRequestError('quarantined step1 must be repaired before edit');
    err.code = 'quarantined';
    throw err;
  }
  const script = String(ep.script_content || '');
  writeFormalStep1(db, drama, ep.episode_number, content, { sourceScript: script });
  return getReview(db, episodeId);
}

function confirmStep1(db, episodeId) {
  const { ep, drama } = resolveEpisode(db, episodeId);
  const st = reviewStatus(db, drama, ep.episode_number);
  if (st.quarantined) {
    const err = new WorkflowRequestError('quarantined step1 must be repaired before confirmation');
    err.code = 'quarantined';
    throw err;
  }
  if (st.status === 'no_step1') {
    const err = new WorkflowRequestError('no formal step1 to confirm');
    err.code = 'no_step1';
    throw err;
  }

  // 确认前：台词覆盖 + 5字/秒压到最短够用档
  const script = String(ep.script_content || '');
  const rawUnits = Array.isArray(st.content?.units) ? st.content.units : [];
  let confirmedFp = st.fingerprint;
  if (rawUnits.length) {
    const gated = applySpeechAndDurationGates(rawUnits, {
      script,
      durations: resolveDurationTiers(drama),
    });
    const changed = gated.speech_repaired || gated.duration_adjusted;
    if (changed) {
      const written = writeFormalStep1(
        db,
        drama,
        ep.episode_number,
        { units: gated.units },
        { sourceScript: script }
      );
      confirmedFp = written.fingerprint;
      const row = db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(drama.id);
      if (row?.metadata) {
        drama.metadata =
          typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      }
    }
  }

  const meta = getWorkflowMeta(drama.metadata);
  meta.workflow.step1_enforced = true;
  const epKey = String(ep.episode_number);
  meta.workflow.episodes[epKey] = {
    ...(meta.workflow.episodes[epKey] || {}),
    step1_review: {
      fingerprint: confirmedFp,
      confirmed_at: new Date().toISOString(),
    },
  };
  saveDramaMeta(db, drama.id, meta);
  return getReview(db, episodeId);
}

/**
 * Clear formal step1 + confirmed gate + final video_units/storyboards for one episode,
 * so next_action returns to prepare_step1 (重跑整理内容).
 */
function resetStep1(db, episodeId, opts = {}) {
  const { ep, drama } = resolveEpisode(db, episodeId);
  const modes = resolveProjectModes(drama.metadata);
  const kind = step1Kind(modes);
  const projectDir = projectAbsDir(db, drama);
  const dir = draftsDir(projectDir, ep.episode_number);
  const formalAbs = path.join(dir, step1FileName(kind));
  const qName = quarantineFileName(kind);
  const qAbs = qName ? path.join(dir, qName) : null;

  if (fs.existsSync(formalAbs)) fs.unlinkSync(formalAbs);
  if (qAbs && fs.existsSync(qAbs)) fs.unlinkSync(qAbs);

  const meta = getWorkflowMeta(drama.metadata);
  meta.workflow.step1_enforced = true;
  const epKey = String(ep.episode_number);
  const prev = meta.workflow.episodes[epKey] || {};
  meta.workflow.episodes[epKey] = {
    ...prev,
    step1_review: null,
    video_units: [],
    unit_storyboard_map: {},
    script_step1_revision: null,
    script_expand: null,
  };
  saveDramaMeta(db, drama.id, meta);

  if (opts.clear_storyboards !== false) {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE storyboards SET deleted_at = ?, updated_at = ?
       WHERE episode_id = ? AND deleted_at IS NULL`
    ).run(now, now, ep.id);
  }

  return {
    episode: ep.episode_number,
    episode_id: ep.id,
    cleared: {
      step1_file: true,
      step1_review: true,
      video_units: true,
      storyboards: opts.clear_storyboards !== false,
    },
    review: getReview(db, episodeId),
  };
}

function writeQuarantine(db, drama, episodeNumber, content, violations) {
  const modes = resolveProjectModes(drama.metadata);
  const kind = step1Kind(modes);
  const qName = quarantineFileName(kind);
  if (!qName) return null;
  const projectDir = projectAbsDir(db, drama);
  const dir = draftsDir(projectDir, episodeNumber);
  fs.mkdirSync(dir, { recursive: true });
  const envelope = {
    kind: `${kind}_step1`,
    episode: episodeNumber,
    meta: { promote_attempts: 0 },
    violations: violations || [],
    content,
  };
  fs.writeFileSync(path.join(dir, qName), JSON.stringify(envelope, null, 2), 'utf8');
  return envelope;
}

module.exports = {
  step1Kind,
  step1FileName,
  reviewStatus,
  getReview,
  prepareStep1,
  prepareReferenceStep1WithLlm,
  putStep1Content,
  confirmStep1,
  resetStep1,
  writeQuarantine,
  writeFormalStep1,
  contentFingerprint,
  projectAbsDir,
  step1RelPath,
  getWorkflowMeta,
  saveDramaMeta,
  splitScriptHeuristic,
};
