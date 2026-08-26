/**
 * 有限并发执行异步任务池。
 * @template T,R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {(stats: { completed: number, total: number, failed: number }) => void} [onProgress] 每完成一项回调
 * @returns {Promise<{ results: Array<{ ok: true, value: R } | { ok: false, error: Error }>, succeeded: number, failed: number, total: number }>}
 */
async function runConcurrentPool(items, concurrency, worker, onProgress) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  if (total === 0) {
    return { results: [], succeeded: 0, failed: 0, total: 0 };
  }

  const limit = Math.max(1, Math.min(Number(concurrency) || 1, total));
  const results = new Array(total);
  let nextIndex = 0;
  let completed = 0;
  let failed = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= total) return;

      try {
        const value = await worker(list[index], index);
        results[index] = { ok: true, value };
      } catch (err) {
        failed += 1;
        results[index] = { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
      } finally {
        completed += 1;
        if (typeof onProgress === 'function') {
          onProgress({ completed, total, failed });
        }
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));

  const succeeded = results.filter((r) => r?.ok).length;
  return { results, succeeded, failed, total };
}

module.exports = { runConcurrentPool };
