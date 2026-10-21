// The filter bar's typed boxes (search, salary min and max) reach the store once typing pauses (Optimizer-first step 4): every change of the
// filters redraws the pool and the ranked list, both up to 525 rows, which measured about 300 ms per keystroke in headless Chrome at 1920x947.
// One pending patch per box; a new keystroke replaces its box's patch and restarts its timer, so the last value wins. `flush` writes every
// pending patch at once (app.js calls it before the filter bar is rebuilt, so a rebuild never redraws a box from older text and loses letters);
// `cancelAll` drops them (Clear filters). The timer functions are injectable for tests.
export const FILTER_DEBOUNCE_MS = 150;

export function makeFilterDebounce({ apply, wait = FILTER_DEBOUNCE_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = new Map(); // key -> { timer, patch }
  const drop = (key) => {
    const p = pending.get(key);
    if (p) clearTimer(p.timer);
    pending.delete(key);
  };
  return {
    /** Waits `wait` ms after this call, then applies `patch` (an object of filter fields), unless the same key is scheduled again first. */
    schedule(key, patch) {
      drop(key);
      const timer = setTimer(() => {
        pending.delete(key);
        apply(patch);
      }, wait);
      pending.set(key, { timer, patch });
    },
    /** Applies every pending patch now, as one change; nothing when none is pending. */
    flush() {
      if (pending.size === 0) return;
      const merged = {};
      for (const [key, { patch }] of [...pending]) {
        drop(key);
        Object.assign(merged, patch);
      }
      apply(merged);
    },
    cancelAll() {
      for (const key of [...pending.keys()]) drop(key);
    },
    pendingCount: () => pending.size,
  };
}
