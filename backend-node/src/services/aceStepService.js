/**
 * ACE-Step 本地服务：启动 API、加载模型、卸载释放显存
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const {
  aceStepBaseUrl,
  checkAceStepHealth,
  ensureAceStepInitialized,
} = require('./aceStepMusicAdapter');

const ACE_STEP_ROOT = process.env.ACE_STEP_ROOT || 'C:\\my\\ace-step\\ACE-Step-1.5';
const START_POLL_MS = 2000;
const START_TIMEOUT_MS = Number(process.env.ACE_STEP_START_TIMEOUT_MS || 180000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseAceStepHostPort() {
  try {
    const u = new URL(aceStepBaseUrl());
    return {
      host: u.hostname || '127.0.0.1',
      port: u.port || '8001',
    };
  } catch {
    return { host: '127.0.0.1', port: '8001' };
  }
}

function spawnDetached(command, args, opts = {}) {
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32',
    windowsHide: true,
  });
  child.unref();
}

async function waitUntil(checkFn, label, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkFn()) return true;
    await sleep(START_POLL_MS);
  }
  return false;
}

async function getAceStepStatus(options = {}) {
  const timeoutMs = Number(options.timeoutMs || 5000);
  const health = await checkAceStepHealth(timeoutMs);
  return {
    ok: health.ok,
    online: health.ok,
    models_initialized: !!health.modelsInitialized,
    loaded: health.ok && !!health.modelsInitialized,
    error: health.error,
    base_url: aceStepBaseUrl(),
    root: ACE_STEP_ROOT,
  };
}

function resolveAceStepPython(root) {
  const candidates = [
    process.env.ACE_STEP_PYTHON,
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    'python',
  ].filter(Boolean);
  for (const python of candidates) {
    if (python === 'python') return python;
    if (fs.existsSync(python)) return python;
  }
  return 'python';
}

function assertAceStepInstall(root) {
  const apiScript = path.join(root, 'acestep', 'api_server.py');
  if (!fs.existsSync(apiScript)) {
    throw new Error(`未找到 ACE-Step：${root}。请安装 ACE-Step-1.5 或设置 ACE_STEP_ROOT`);
  }
  const emb = path.join(root, 'checkpoints', 'Qwen3-Embedding-0.6B', 'model.safetensors');
  const dit = path.join(root, 'checkpoints', 'acestep-v15-turbo', 'model.safetensors');
  if (!fs.existsSync(dit) || !fs.existsSync(emb)) {
    throw new Error('ACE-Step checkpoints 不完整，请确认权重已下载到 checkpoints 目录');
  }
  return apiScript;
}

async function ensureAceStepServerRunning(log) {
  const status = await getAceStepStatus();
  if (status.online) return status;

  const root = ACE_STEP_ROOT;
  const apiScript = assertAceStepInstall(root);
  const { host, port } = parseAceStepHostPort();
  const python = resolveAceStepPython(root);

  log?.info?.('[ACE-Step] 正在启动 API 服务', { root, host, port, python });
  spawnDetached(python, [
    apiScript,
    '--host', host,
    '--port', port,
    '--download-source', 'modelscope',
  ], {
    cwd: root,
    env: {
      HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com',
      ACESTEP_INIT_LLM: process.env.ACESTEP_INIT_LLM || 'auto',
      CHECK_UPDATE: 'false',
    },
  });

  const online = await waitUntil(async () => {
    const h = await checkAceStepHealth(4000);
    return h.ok;
  }, 'ace-step');
  if (!online) {
    throw new Error(`ACE-Step 启动超时（${Math.round(START_TIMEOUT_MS / 1000)}s），请检查 ${root} 或手动运行 scripts/start-ace-step.ps1`);
  }
  return getAceStepStatus();
}

/**
 * 启动 ACE-Step 并加载模型到显存（/v1/init）
 */
async function startAceStepService(log) {
  await ensureAceStepServerRunning(log);
  log?.info?.('[ACE-Step] 正在初始化模型（首次约 2～3 分钟）…');
  await ensureAceStepInitialized();
  const status = await getAceStepStatus({ timeoutMs: 8000 });
  log?.info?.('[ACE-Step] 模型已就绪', { loaded: status.loaded });
  return { ...status, started: true };
}

function killProcessOnPort(port) {
  const p = String(port || '8001');
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore', timeout: 20000 },
    );
    return;
  }
  try {
    execSync(`lsof -ti:${p} | xargs kill -9`, { stdio: 'ignore', timeout: 10000 });
  } catch {
    // ignore
  }
}

/**
 * 卸载 ACE-Step：终止监听端口的进程以释放 GPU 显存
 */
async function unloadAceStepService(log) {
  const { port } = parseAceStepHostPort();
  log?.info?.('[ACE-Step] 正在卸载', { port });
  killProcessOnPort(port);
  await sleep(1500);
  const status = await getAceStepStatus({ timeoutMs: 2500 });
  if (status.online) {
    throw new Error('ACE-Step 卸载失败，进程可能仍在运行');
  }
  return { ok: true, loaded: false, online: false, base_url: aceStepBaseUrl(), root: ACE_STEP_ROOT };
}

function getAceStepConfigSummary() {
  const { host, port } = parseAceStepHostPort();
  return { root: ACE_STEP_ROOT, base_url: aceStepBaseUrl(), host, port };
}

module.exports = {
  getAceStepStatus,
  startAceStepService,
  unloadAceStepService,
  getAceStepConfigSummary,
};
