// The public site's Optimizer runs off the page's thread (DECISIONS.md D69): a module worker (opt-worker.js) when the browser
// allows one, else the page's thread. The one copy of that runner, for the classic Optimizer (site-src/api.js) and the
// Showdown Optimizer (site-showdown.js; RULES.md D71). tools/publish.mjs copies this file to out/js/site-worker.js, beside
// opt-worker.js. Nothing runs at import time.

/**
 * A runner for one kind of work: run(args) resolves to the answer. `kind` ("classic" or "showdown") tells opt-worker.js
 * which answer to make; `timeoutMs` is the longest wait for the worker (the search is bounded, so a worker that has not
 * answered by then is stuck: it is stopped, a fresh one starts next time, and the visitor gets `failed()` instead of the
 * screen staying on "Making lineups"); `onPage(args)` makes the answer on the page's thread when the worker cannot start,
 * crashes or cannot read a message; `failed()` is the route's own failure answer; `label` heads the console line.
 */
export function createWorkerRunner({ kind, timeoutMs, failed, onPage, label = "lineup generate: failed" }) {
  let worker = null;
  let workerBroken = false;
  let workerSeq = 0;
  const pending = new Map();
  class GenerateTimeout extends Error {}

  function optWorker() {
    if (workerBroken || typeof Worker === "undefined") return null;
    if (worker) return worker;
    try {
      worker = new Worker(new URL("./opt-worker.js", import.meta.url), { type: "module" });
    } catch {
      workerBroken = true;
      return null;
    }
    worker.onmessage = (event) => {
      const p = pending.get(event.data?.id);
      if (!p) return;
      pending.delete(event.data.id);
      p.resolve(event.data.response);
    };
    // The worker could not start, crashed, or could not read a message: every waiting request is run on the page
    // instead, and so is every later one.
    const broken = () => {
      workerBroken = true;
      try { worker?.terminate(); } catch { /* terminate throws only for a worker that is already gone: nothing to stop and no state to restore, the waits are rejected below */ }
      worker = null;
      for (const p of pending.values()) p.reject(new Error("worker failed"));
      pending.clear();
    };
    worker.onerror = broken;
    worker.onmessageerror = broken;
    return worker;
  }

  return async function run(args) {
    const w = optWorker();
    if (w) {
      try {
        return await new Promise((resolve, reject) => {
          const id = ++workerSeq;
          const timer = setTimeout(() => {
            if (!pending.has(id)) return;
            pending.delete(id);
            try { w.terminate(); } catch { /* terminate throws only for a worker that is already gone: nothing to stop and no state to restore, this wait is answered as failed below */ }
            if (worker === w) worker = null;
            for (const p of pending.values()) p.reject(new GenerateTimeout());
            pending.clear();
            reject(new GenerateTimeout());
          }, timeoutMs);
          const done = (fn) => (value) => { clearTimeout(timer); fn(value); };
          pending.set(id, { resolve: done(resolve), reject: done(reject) });
          w.postMessage({ id, kind, args });
        });
      } catch (e) {
        if (e instanceof GenerateTimeout) return failed();
        /* the worker failed: fall through to the page's thread */
      }
    }
    try {
      return await onPage(args);
    } catch (e) {
      console.error(label, e);
      return failed();
    }
  };
}
