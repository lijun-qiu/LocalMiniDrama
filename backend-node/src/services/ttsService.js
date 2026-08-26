/**
 * TTS 语音合成服务
 * 支持多种 TTS 接口：minimax、edge-tts（本地）、通用 HTTP
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const { getFfmpegPath } = require('../utils/ffmpegPath');

/**
 * 使用 MiniMax T2A v2 合成语音
 */
async function synthesizeWithMinimax(text, voiceId, apiKey, groupId, model) {
  const body = JSON.stringify({
    model: model || 'speech-02-hd',
    text,
    stream: false,
    voice_setting: {
      voice_id: voiceId || 'female-shaonv',
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  });
  const url = `https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`;
  return new Promise((resolve, reject) => {
    const reqOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(urlObj, reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`MiniMax TTS HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
          return;
        }
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (data.base_resp?.status_code !== 0) {
          reject(new Error(`MiniMax TTS error: ${data.base_resp?.status_msg || 'unknown'}`));
          return;
        }
        const audioHex = data.data?.audio;
        if (!audioHex) { reject(new Error('MiniMax TTS 未返回音频')); return; }
        resolve(Buffer.from(audioHex, 'hex'));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 使用 OpenAI TTS API 合成语音（兼容所有 OpenAI 格式的代理）
 * POST {base_url}/audio/speech  body: { model, input, voice, response_format, speed }
 */
async function synthesizeWithOpenai(text, voice, apiKey, baseUrl, model, speed) {
  const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/audio/speech';
  const body = JSON.stringify({
    model: model || 'tts-1',
    input: text,
    voice: voice || 'alloy',
    response_format: 'mp3',
    speed: speed || 1.0,
  });
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
    };
    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`OpenAI TTS HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 500)}`));
          return;
        }
        resolve(buf);
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('OpenAI TTS 请求超时')); }, 120000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

function convertAudioToMp3(inputPath, outPath, log, speed = 1) {
  const bin = getFfmpegPath();
  const args = ['-y', '-i', inputPath];
  const s = Number(speed);
  if (Number.isFinite(s) && Math.abs(s - 1) > 0.001) {
    const tempo = Math.min(2, Math.max(0.5, s));
    args.push('-filter:a', `atempo=${tempo}`);
  }
  args.push('-c:a', 'libmp3lame', '-q:a', '4', outPath);
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0 || !fs.existsSync(outPath)) {
    log?.warn?.('[TTS] convert to mp3 failed', { error: r.error?.message, stderr: r.stderr?.slice(-500) });
    return false;
  }
  return true;
}

/**
 * 合成 TTS 并保存到本地文件
 * @returns {{ local_path: string, abs_path?: string }}
 */
async function synthesize(db, log, {
  text,
  storyboard_id,
  config,
  storage_base,
  voice_id,
  speed,
  provider: providerOverride,
  emotion_text,
  output_format,
}) {
  if (!text || !text.trim()) throw new Error('text 不能为空');
  const aiConfigService = require('./aiConfigService');
  const ttsConfig = config || (() => {
    const configs = aiConfigService.listConfigs(db, 'tts');
    const active = configs.filter((c) => c.is_active);
    return active.find((c) => c.is_default) || active[0];
  })();

  const provider = String(providerOverride || ttsConfig?.provider || '').toLowerCase();
  let ttsSettings = {};
  try { ttsSettings = JSON.parse(ttsConfig?.settings || '{}'); } catch (_) {}

  const voiceId = voice_id || ttsConfig?.voice_id || ttsSettings.voice_id || '';
  const groupId = ttsConfig?.group_id || ttsSettings.group_id || '';
  const ttsModel = ttsConfig?.default_model || (Array.isArray(ttsConfig?.model) ? ttsConfig.model[0] : ttsConfig?.model) || '';
  const finalSpeed = (speed != null && speed !== '') ? Number(speed) : (ttsSettings.speed != null ? Number(ttsSettings.speed) : 1.0);
  const emotionText = emotion_text || ttsSettings.emotion_text || '自然流畅的解说语气，情绪饱满';

  const audioDir = path.join(storage_base, 'audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  const baseName = `tts_sb${storyboard_id || 'x'}_${randomUUID().slice(0, 8)}`;

  if (provider === 'indextts') {
    const indexTtsService = require('./indexTtsService');
    const wavOut = await indexTtsService.generateIndexTtsTTS(text, voiceId || 'gsv:008', {
      emotionText,
      storage_base,
      log,
    });
    if (output_format === 'wav') {
      log.info('[TTS] IndexTTS 合成完成', { storyboard_id, local_path: wavOut.local_path });
      return { local_path: wavOut.local_path, abs_path: wavOut.absPath };
    }
    const mp3Path = path.join(audioDir, `${baseName}.mp3`);
    if (!convertAudioToMp3(wavOut.absPath, mp3Path, log, finalSpeed)) {
      throw new Error('IndexTTS 音频转 MP3 失败');
    }
    try { fs.unlinkSync(wavOut.absPath); } catch (_) {}
    const localPath = `audio/${baseName}.mp3`;
    log.info('[TTS] IndexTTS 合成完成', { storyboard_id, local_path: localPath });
    return { local_path: localPath, abs_path: mp3Path };
  }

  if (!ttsConfig) throw new Error('未配置 TTS 模型，请在「AI 配置」中添加 service_type=tts 的配置');

  let audioBuffer;
  if (provider === 'minimax') {
    audioBuffer = await synthesizeWithMinimax(
      text,
      voiceId || 'female-shaonv',
      ttsConfig.api_key,
      groupId,
      ttsModel || 'speech-02-hd'
    );
  } else if (provider === 'openai' || ttsConfig.base_url) {
    audioBuffer = await synthesizeWithOpenai(
      text,
      voiceId || 'alloy',
      ttsConfig.api_key,
      ttsConfig.base_url,
      ttsModel || 'tts-1',
      finalSpeed
    );
  } else {
    throw new Error(`不支持的 TTS provider: ${provider}，目前支持 openai、minimax、indextts`);
  }

  const filename = `${baseName}.mp3`;
  const filePath = path.join(audioDir, filename);
  fs.writeFileSync(filePath, audioBuffer);
  const localPath = `audio/${filename}`;
  log.info('[TTS] 合成完成', { storyboard_id, local_path: localPath, provider });
  try { const cs = require('./cloudService'); cs.reportUsage('tts', ttsModel || '', '', 0); } catch (_) {}
  return { local_path: localPath, abs_path: filePath };
}

module.exports = { synthesize, convertAudioToMp3 };
