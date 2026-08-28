/**
 * 整段解说旁白配音：一次 IndexTTS 合成全集旁白，再按各镜 narration 字数比例剪切到分镜。
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawnSync } = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const { countNarrationSpeechChars } = require('./episodeStoryboardService');

function ffprobeDurationSec(filePath) {
  const probe = getFfprobePath();
  const r = spawnSync(
    probe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  );
  if (r.status !== 0) return null;
  const d = parseFloat(String(r.stdout || '').trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

function narrationWeight(text) {
  const chars = countNarrationSpeechChars(text);
  return Math.max(1, chars || String(text || '').trim().length || 1);
}

/** @param {number} totalSec @param {string[]} texts */
function computeProportionalDurations(totalSec, texts) {
  if (!texts.length || !Number.isFinite(totalSec) || totalSec <= 0) return [];
  const weights = texts.map(narrationWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let allocated = 0;
  const durs = [];
  for (let i = 0; i < texts.length; i++) {
    if (i === texts.length - 1) {
      durs.push(Math.max(0.05, totalSec - allocated));
    } else {
      const d = totalSec * (weights[i] / totalWeight);
      durs.push(d);
      allocated += d;
    }
  }
  return durs;
}

function listStoryboardsWithNarration(db, episodeId) {
  return db
    .prepare(
      `SELECT id, storyboard_number, narration, narration_audio_local_path
       FROM storyboards
       WHERE episode_id = ? AND deleted_at IS NULL
       ORDER BY storyboard_number ASC, id ASC`
    )
    .all(Number(episodeId))
    .filter((row) => String(row.narration || '').trim());
}

function buildConcatenatedNarrationText(rows) {
  return rows.map((r) => String(r.narration).trim()).join('');
}

function deleteStorageRelPath(storageRoot, relPath, log, tag) {
  const rel = relPath && String(relPath).trim();
  if (!rel) return false;
  const abs = path.join(storageRoot, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) return false;
  try {
    fs.unlinkSync(abs);
    return true;
  } catch (err) {
    log?.warn?.('[narration-audio] delete file failed', { tag, path: rel, error: err.message });
    return false;
  }
}

function extractAudioSegment(inputAbs, startSec, durationSec, outAbs, log) {
  const bin = getFfmpegPath();
  const args = [
    '-y',
    '-ss', String(Math.max(0, startSec)),
    '-t', String(Math.max(0.05, durationSec)),
    '-i', inputAbs,
    '-c:a', 'libmp3lame',
    '-q:a', '4',
    outAbs,
  ];
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0 || !fs.existsSync(outAbs)) {
    log?.warn?.('[narration-audio] ffmpeg extract failed', {
      stderr: r.stderr?.slice(-500),
      startSec,
      durationSec,
    });
    return false;
  }
  return true;
}

/**
 * 一次 IndexTTS 合成整集旁白，写入 episodes.full_narration_audio_local_path。
 */
async function synthesizeEpisodeFullNarration(db, log, episodeId, opts = {}) {
  const episodeIdNum = Number(episodeId);
  const ep = db.prepare('SELECT id, full_narration_audio_local_path FROM episodes WHERE id = ? AND deleted_at IS NULL').get(episodeIdNum);
  if (!ep) throw new Error('集不存在');

  const rows = listStoryboardsWithNarration(db, episodeIdNum);
  if (!rows.length) throw new Error('本集没有可配音的解说旁白');

  const fullText = buildConcatenatedNarrationText(rows);
  if (!fullText.trim()) throw new Error('旁白文本为空');

  const storageRoot = opts.storage_base;
  if (!storageRoot) throw new Error('storage_base 不能为空');

  const indexTtsService = require('./indexTtsService');
  await indexTtsService.loadIndexTtsModel(log);

  const ttsService = require('./ttsService');
  const result = await ttsService.synthesize(db, log, {
    text: fullText,
    storyboard_id: `ep${episodeIdNum}_full`,
    storage_base: storageRoot,
    provider: opts.provider || 'indextts',
    voice_id: opts.voice_id,
    emotion_text: opts.emotion_text,
    speed: opts.speed,
    auto_load_indextts: true,
  });

  if (ep.full_narration_audio_local_path && ep.full_narration_audio_local_path !== result.local_path) {
    deleteStorageRelPath(storageRoot, ep.full_narration_audio_local_path, log, `ep${episodeIdNum}:old-full`);
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE episodes SET full_narration_audio_local_path = ?, updated_at = ? WHERE id = ?').run(
    result.local_path,
    now,
    episodeIdNum
  );

  log.info('[narration-audio] full episode narration synthesized', {
    episode_id: episodeIdNum,
    local_path: result.local_path,
    speech_chars: countNarrationSpeechChars(fullText),
    storyboard_count: rows.length,
  });

  return {
    local_path: result.local_path,
    url: result.local_path ? `/static/${result.local_path}` : '',
    speech_chars: countNarrationSpeechChars(fullText),
    storyboard_count: rows.length,
  };
}

/**
 * 将整段旁白按各镜 narration 可读字数比例剪切，写入各镜 narration_audio_local_path。
 */
function splitFullNarrationToStoryboards(db, log, episodeId, storageRoot) {
  const episodeIdNum = Number(episodeId);
  const ep = db
    .prepare('SELECT id, full_narration_audio_local_path FROM episodes WHERE id = ? AND deleted_at IS NULL')
    .get(episodeIdNum);
  if (!ep?.full_narration_audio_local_path) throw new Error('请先生成整段配音');

  const fullRel = String(ep.full_narration_audio_local_path).trim();
  const fullAbs = path.join(storageRoot, fullRel.replace(/\//g, path.sep));
  if (!fs.existsSync(fullAbs)) throw new Error('整段配音文件不存在，请重新生成');

  const rows = listStoryboardsWithNarration(db, episodeIdNum);
  if (!rows.length) throw new Error('本集没有可剪切的分镜旁白');

  const totalDur = ffprobeDurationSec(fullAbs);
  if (!totalDur) throw new Error('无法读取整段配音时长');

  const durs = computeProportionalDurations(totalDur, rows.map((r) => r.narration));
  const audioDir = path.join(storageRoot, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });

  let offset = 0;
  const results = [];
  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dur = durs[i];
    const baseName = `tts_sb${row.id}_${randomUUID().slice(0, 8)}.mp3`;
    const outAbs = path.join(audioDir, baseName);
    const localPath = `audio/${baseName}`;

    if (!extractAudioSegment(fullAbs, offset, dur, outAbs, log)) {
      throw new Error(`剪切分镜 #${row.storyboard_number || row.id} 失败`);
    }

    if (row.narration_audio_local_path && row.narration_audio_local_path !== localPath) {
      deleteStorageRelPath(storageRoot, row.narration_audio_local_path, log, `sb${row.id}:old-narr`);
    }

    db.prepare('UPDATE storyboards SET narration_audio_local_path = ?, updated_at = ? WHERE id = ?').run(
      localPath,
      now,
      row.id
    );

    results.push({
      storyboard_id: row.id,
      storyboard_number: row.storyboard_number,
      local_path: localPath,
      duration_sec: dur,
    });
    offset += dur;
  }

  log.info('[narration-audio] split full narration to storyboards', {
    episode_id: episodeIdNum,
    split_count: results.length,
    total_duration_sec: totalDur,
  });

  return { split_count: results.length, total_duration_sec: totalDur, results };
}

/**
 * 用各镜旁白配音文件的实际时长写回 storyboards.duration（无配音文件则保留原值）。
 */
function syncStoryboardDurationsFromNarrationAudio(db, log, episodeId, storageRoot) {
  const episodeIdNum = Number(episodeId);
  const rows = db
    .prepare(
      `SELECT id, storyboard_number, narration, narration_audio_local_path, duration
       FROM storyboards
       WHERE episode_id = ? AND deleted_at IS NULL
       ORDER BY storyboard_number ASC, id ASC`
    )
    .all(episodeIdNum);

  const now = new Date().toISOString();
  let updated = 0;
  let skippedNoAudio = 0;
  let skippedNoNarration = 0;

  for (const row of rows) {
    const narr = String(row.narration || '').trim();
    if (!narr) {
      skippedNoNarration += 1;
      continue;
    }
    const rel = row.narration_audio_local_path && String(row.narration_audio_local_path).trim();
    if (!rel) {
      skippedNoAudio += 1;
      continue;
    }
    const abs = path.join(storageRoot, rel.replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) {
      skippedNoAudio += 1;
      continue;
    }
    const dur = ffprobeDurationSec(abs);
    if (!dur) {
      skippedNoAudio += 1;
      continue;
    }
    const durSec = Math.min(120, Math.max(0.5, Math.round(dur * 100) / 100));
    db.prepare('UPDATE storyboards SET duration = ?, updated_at = ? WHERE id = ?').run(durSec, now, row.id);
    updated += 1;
  }

  log.info('[narration-audio] synced storyboard duration from narration audio', {
    episode_id: episodeIdNum,
    updated,
    skipped_no_audio: skippedNoAudio,
    skipped_no_narration: skippedNoNarration,
    total: rows.length,
  });

  return {
    updated,
    skipped_no_audio: skippedNoAudio,
    skipped_no_narration: skippedNoNarration,
    total: rows.length,
  };
}

function clearEpisodeFullNarrationAudio(db, log, episodeId, storageRoot) {
  const episodeIdNum = Number(episodeId);
  const ep = db.prepare('SELECT full_narration_audio_local_path FROM episodes WHERE id = ?').get(episodeIdNum);
  if (!ep?.full_narration_audio_local_path) return false;
  deleteStorageRelPath(storageRoot, ep.full_narration_audio_local_path, log, `ep${episodeIdNum}:full-narr`);
  db.prepare('UPDATE episodes SET full_narration_audio_local_path = NULL, updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    episodeIdNum
  );
  return true;
}

module.exports = {
  computeProportionalDurations,
  buildConcatenatedNarrationText,
  listStoryboardsWithNarration,
  synthesizeEpisodeFullNarration,
  splitFullNarrationToStoryboards,
  syncStoryboardDurationsFromNarrationAudio,
  clearEpisodeFullNarrationAudio,
  ffprobeDurationSec,
};
