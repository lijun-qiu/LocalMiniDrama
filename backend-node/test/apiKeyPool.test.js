const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseApiKeys,
  encodeAgnesTaskId,
  parseAgnesTaskId,
  resolveAgnesPollAuth,
  ApiKeyPool,
} = require('../src/utils/apiKeyPool');

describe('parseApiKeys', () => {
  it('splits comma-separated keys and dedupes', () => {
    const keys = parseApiKeys('sk-a, sk-b,sk-a,sk-c');
    assert.deepEqual(keys, ['sk-a', 'sk-b', 'sk-c']);
  });
});

describe('encodeAgnesTaskId / parseAgnesTaskId', () => {
  it('round-trips upstream task id with key index', () => {
    const encoded = encodeAgnesTaskId(2, 'task_abc');
    assert.equal(encoded, 'agnesk:2:task_abc');
    const parsed = parseAgnesTaskId(encoded);
    assert.equal(parsed.taskId, 'task_abc');
    assert.equal(parsed.keyIndex, 2);
  });

  it('passes through plain upstream ids', () => {
    assert.deepEqual(parseAgnesTaskId('task_plain'), { taskId: 'task_plain', keyIndex: 0 });
  });
});

describe('resolveAgnesPollAuth', () => {
  it('selects key by encoded index', () => {
    const field = 'key0,key1,key2';
    const auth = resolveAgnesPollAuth(field, encodeAgnesTaskId(1, 'task_x'));
    assert.equal(auth.apiKey, 'key1');
    assert.equal(auth.taskId, 'task_x');
    assert.equal(auth.keyIndex, 1);
  });
});

describe('ApiKeyPool', () => {
  it('limits per-key concurrency to 1', async () => {
    const pool = new ApiKeyPool(['a', 'b'], 1);
    let inFlight = 0;
    let maxInFlight = 0;
    const keysUsed = [];

    const work = () => pool.run(async (key) => {
      keysUsed.push(key);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
    });

    await Promise.all([work(), work(), work()]);
    assert.equal(maxInFlight, 2);
    assert.equal(keysUsed.length, 3);
    assert.ok(keysUsed.includes('a'));
    assert.ok(keysUsed.includes('b'));
  });

  it('maxConcurrency equals key count when per-key limit is 1', () => {
    const pool = new ApiKeyPool(['x', 'y', 'z'], 1);
    assert.equal(pool.maxConcurrency, 3);
  });

  it('enforces min interval between uses of the same key', async () => {
    const pool = new ApiKeyPool(['only'], 1, 50);
    const t0 = Date.now();
    await pool.run(async () => {});
    await pool.run(async () => {});
    assert.ok(Date.now() - t0 >= 50);
  });

  it('allows different keys within min interval window', async () => {
    const pool = new ApiKeyPool(['a', 'b'], 1, 1000);
    const keysUsed = [];
    await Promise.all([
      pool.run(async (key) => { keysUsed.push(key); }),
      pool.run(async (key) => { keysUsed.push(key); }),
    ]);
    assert.deepEqual(new Set(keysUsed), new Set(['a', 'b']));
  });

  it('runPreferred sticks to requested key index (mod key count)', async () => {
    const pool = new ApiKeyPool(['a', 'b', 'c'], 1, 0);
    const keys = [];
    await pool.runPreferred(1, async (key, index) => {
      keys.push({ key, index });
    });
    await pool.runPreferred(7, async (key, index) => {
      keys.push({ key, index });
    });
    assert.deepEqual(keys, [
      { key: 'b', index: 1 },
      { key: 'b', index: 1 },
    ]);
  });

  it('serial preferred round-robin uses distinct keys', async () => {
    const pool = new ApiKeyPool(['k0', 'k1', 'k2'], 1, 0);
    const used = [];
    for (let i = 0; i < 3; i++) {
      await pool.runPreferred(i, async (key) => {
        used.push(key);
      });
    }
    assert.deepEqual(used, ['k0', 'k1', 'k2']);
  });
});
