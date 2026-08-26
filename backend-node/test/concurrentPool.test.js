const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runConcurrentPool } = require('../src/utils/concurrentPool');

describe('runConcurrentPool', () => {
  it('runs all items with limited concurrency', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    let inFlight = 0;
    let maxInFlight = 0;
    const progress = [];

    const { succeeded, failed, total } = await runConcurrentPool(
      items,
      3,
      async (n) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return n * 2;
      },
      (stats) => progress.push({ ...stats })
    );

    assert.equal(total, 8);
    assert.equal(succeeded, 8);
    assert.equal(failed, 0);
    assert.ok(maxInFlight <= 3);
    assert.equal(progress.length, 8);
    assert.deepEqual(progress[progress.length - 1], { completed: 8, total: 8, failed: 0 });
  });

  it('counts failures without stopping other workers', async () => {
    const { succeeded, failed } = await runConcurrentPool(
      [1, 2, 3],
      2,
      async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }
    );
    assert.equal(succeeded, 2);
    assert.equal(failed, 1);
  });
});
