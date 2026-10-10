// @ts-check

/**
 * Run `worker(item, index)` over `items` with at most `limit` invocations
 * in flight at any time. Returns an array parallel to `items` describing
 * the outcome of each task as `{ ok: true, value }` or `{ ok: false, error }`.
 *
 * By default, a rejection from one worker does not stop the others — the
 * caller inspects the results array. Set `failFast: true` to stop dequeueing
 * new work as soon as any worker rejects; in-flight tasks still finish and
 * their results are included. The first rejection is rethrown after the
 * in-flight tasks settle.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @param {{ failFast?: boolean }} [opts]
 * @returns {Promise<Array<{ ok: true, value: R } | { ok: false, error: unknown }>>}
 */
export async function runPool(items, limit, worker, { failFast = false } = {}) {
    const results = new Array(items.length);
    let nextIndex = 0;
    let aborted = false;
    /** @type {unknown} */
    let abortError = null;

    const effectiveLimit = Math.max(1, Math.min(limit, items.length));

    async function runner() {
        while (!aborted) {
            const i = nextIndex++;
            if (i >= items.length) return;
            try {
                results[i] = { ok: true, value: await worker(items[i], i) };
            } catch (error) {
                results[i] = { ok: false, error };
                if (failFast && !aborted) {
                    aborted = true;
                    abortError = error;
                }
            }
        }
    }

    const runners = [];
    for (let i = 0; i < effectiveLimit; i++) runners.push(runner());
    await Promise.all(runners);

    if (aborted && abortError) throw abortError;
    return results;
}
