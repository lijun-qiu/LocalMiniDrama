/**
 * 多 API Key 池：每个 Key 独立并发上限（默认 1），轮询分配。
 * 用于 Agnes 等单 Key 并发受限的中转；图片/视频提交共享同一 Key 指纹池。
 */

const AGNES_TASK_KEY_PREFIX = 'agnesk:';

/** 解析 api_key 字段：英文逗号、分号、换行分隔 */
function parseApiKeys(apiKeyField) {
  const raw = String(apiKeyField || '').trim();
  if (!raw) return [];
  const parts = raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function encodeAgnesTaskId(keyIndex, taskId) {
  const id = String(taskId || '').trim();
  if (!id) return id;
  const idx = Number(keyIndex);
  if (!Number.isFinite(idx) || idx < 0) return id;
  if (id.startsWith(AGNES_TASK_KEY_PREFIX)) return id;
  return `${AGNES_TASK_KEY_PREFIX}${idx}:${id}`;
}

/**
 * 从 provider_task_id 解析 Agnes 上游 task_id 与所用 Key 索引
 * @returns {{ taskId: string, keyIndex: number }}
 */
function parseAgnesTaskId(encoded) {
  const s = String(encoded || '').trim();
  if (!s.startsWith(AGNES_TASK_KEY_PREFIX)) {
    return { taskId: s, keyIndex: 0 };
  }
  const rest = s.slice(AGNES_TASK_KEY_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon < 0) return { taskId: s, keyIndex: 0 };
  const idx = parseInt(rest.slice(0, colon), 10);
  const taskId = rest.slice(colon + 1);
  return {
    taskId: taskId || s,
    keyIndex: Number.isFinite(idx) && idx >= 0 ? idx : 0,
  };
}

function getApiKeyAtIndex(apiKeyField, index) {
  const keys = parseApiKeys(apiKeyField);
  if (keys.length === 0) return String(apiKeyField || '').trim();
  const i = Number(index);
  if (Number.isFinite(i) && i >= 0 && i < keys.length) return keys[i];
  return keys[0];
}

/** 轮询时根据编码 task_id 取对应 Key */
function resolveAgnesPollAuth(apiKeyField, encodedTaskId) {
  const { taskId, keyIndex } = parseAgnesTaskId(encodedTaskId);
  const apiKey = getApiKeyAtIndex(apiKeyField, keyIndex);
  return { taskId, keyIndex, apiKey };
}

/** Agnes 视频：上游每 Key 每分钟最多 1 次 POST 提交 */
const AGNES_VIDEO_MIN_INTERVAL_MS = 60_000;

class ApiKeyPool {
  constructor(keys, perKeyLimit = 1, minIntervalMs = 0) {
    this.keys = keys.length ? [...keys] : [];
    this.perKeyLimit = Math.max(1, perKeyLimit);
    this.minIntervalMs = Math.max(0, minIntervalMs);
    this.activeCounts = new Map(this.keys.map((k) => [k, 0]));
    this.lastUsedAt = new Map(this.keys.map((k) => [k, 0]));
    this.waiters = [];
    this.rr = 0;
    this.cooldownTimer = null;
  }

  get maxConcurrency() {
    return this.keys.length * this.perKeyLimit;
  }

  _keyReady(key) {
    const count = this.activeCounts.get(key) || 0;
    if (count >= this.perKeyLimit) return false;
    if (this.minIntervalMs <= 0) return true;
    const last = this.lastUsedAt.get(key) || 0;
    return Date.now() - last >= this.minIntervalMs;
  }

  _tryAcquire() {
    const n = this.keys.length;
    if (n === 0) return null;
    for (let i = 0; i < n; i++) {
      const idx = (this.rr + i) % n;
      const key = this.keys[idx];
      if (this._keyReady(key)) {
        this.activeCounts.set(key, (this.activeCounts.get(key) || 0) + 1);
        this.rr = (idx + 1) % n;
        return { key, index: idx };
      }
    }
    return null;
  }

  _msUntilNextKeyReady() {
    if (this.minIntervalMs <= 0) return 0;
    let minWait = Infinity;
    const now = Date.now();
    for (const key of this.keys) {
      if ((this.activeCounts.get(key) || 0) >= this.perKeyLimit) continue;
      const wait = this.minIntervalMs - (now - (this.lastUsedAt.get(key) || 0));
      if (wait > 0 && wait < minWait) minWait = wait;
    }
    return minWait === Infinity ? 0 : minWait;
  }

  _scheduleCooldownWake() {
    if (this.minIntervalMs <= 0 || this.cooldownTimer || this.waiters.length === 0) return;
    const waitMs = this._msUntilNextKeyReady();
    if (waitMs <= 0) {
      const next = this.waiters.shift();
      if (next) next();
      return;
    }
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null;
      const next = this.waiters.shift();
      if (next) next();
      if (this.waiters.length) this._scheduleCooldownWake();
    }, waitMs + 1);
  }

  acquire() {
    return new Promise((resolve) => {
      const attempt = () => {
        const got = this._tryAcquire();
        if (got) resolve(got);
        else {
          this.waiters.push(attempt);
          if (this.minIntervalMs > 0) this._scheduleCooldownWake();
        }
      };
      attempt();
    });
  }

  release(key) {
    const count = this.activeCounts.get(key) || 0;
    if (count > 0) this.activeCounts.set(key, count - 1);
    if (this.minIntervalMs > 0) this.lastUsedAt.set(key, Date.now());
    const next = this.waiters.shift();
    if (next) next();
    else if (this.waiters.length && this.minIntervalMs > 0) this._scheduleCooldownWake();
  }

  _msUntilKeyReady(key) {
    if (this.minIntervalMs <= 0) return 0;
    if ((this.activeCounts.get(key) || 0) >= this.perKeyLimit) {
      // 占用中：短暂轮询，等 release 后再判冷却
      return 50;
    }
    const wait = this.minIntervalMs - (Date.now() - (this.lastUsedAt.get(key) || 0));
    return wait > 0 ? wait : 0;
  }

  /**
   * 指定 Key 下标获取（串行轮询用）；该 Key 冷却中则等待，不抢其它 Key。
   */
  acquirePreferred(preferredIndex) {
    const n = this.keys.length;
    if (!n) {
      return Promise.resolve({ key: '', index: 0 });
    }
    const want = ((Number(preferredIndex) % n) + n) % n;
    return new Promise((resolve) => {
      const attempt = () => {
        const key = this.keys[want];
        if (this._keyReady(key)) {
          this.activeCounts.set(key, (this.activeCounts.get(key) || 0) + 1);
          this.rr = (want + 1) % n;
          resolve({ key, index: want });
          return;
        }
        const waitMs = Math.max(1, this._msUntilKeyReady(key));
        setTimeout(attempt, waitMs);
      };
      attempt();
    });
  }

  async run(fn) {
    const { key, index } = await this.acquire();
    try {
      return await fn(key, index);
    } finally {
      this.release(key);
    }
  }

  async runPreferred(preferredIndex, fn) {
    if (this.keys.length === 0) {
      return fn('', 0);
    }
    if (preferredIndex == null || !Number.isFinite(Number(preferredIndex))) {
      return this.run(fn);
    }
    const { key, index } = await this.acquirePreferred(preferredIndex);
    try {
      return await fn(key, index);
    } finally {
      this.release(key);
    }
  }
}

const poolRegistry = new Map();

function getApiKeyPool(apiKeyField, perKeyLimit = 1, minIntervalMs = 0) {
  const keys = parseApiKeys(apiKeyField);
  if (keys.length === 0) return null;
  const fingerprint = `${keys.join('\0')}\0${perKeyLimit}\0${minIntervalMs}`;
  let pool = poolRegistry.get(fingerprint);
  if (!pool) {
    pool = new ApiKeyPool(keys, perKeyLimit, minIntervalMs);
    poolRegistry.set(fingerprint, pool);
  }
  return pool;
}

module.exports = {
  parseApiKeys,
  encodeAgnesTaskId,
  parseAgnesTaskId,
  getApiKeyAtIndex,
  resolveAgnesPollAuth,
  ApiKeyPool,
  getApiKeyPool,
  AGNES_TASK_KEY_PREFIX,
  AGNES_VIDEO_MIN_INTERVAL_MS,
};
