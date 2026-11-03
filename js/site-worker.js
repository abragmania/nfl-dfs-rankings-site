// The public site's Optimizer runs off the page's thread (DECISIONS.md D69): a module worker (opt-worker.js) when the browser
// allows one, else the page's thread. The one copy of that runner, for the classic Optimizer (site-src/api.js) and the
// Showdown Optimizer (site-showdown.js; RULES.md D71). tools/publish.mjs copies this file to out/js/site-worker.js, beside
// opt-worker.js. Nothing runs at import time.

import { createBuildControl, endedResult } from "../server/lineup/build-control.js";

/** The longest a build runs in a visitor's browser before it is ended with the lineups finished so far (Adam 2026-11-02: minutes, never seconds). */
export const BUILD_CEILING_MS = 300000;

/** An ended build's answer from the engine: the one copy's words (build-control.js) at this ceiling. */
export const endedSiteResult = (partial, reason, asked) => endedResult(partial, reason, asked, BUILD_CEILING_MS);

/** The note on an answer made on the page's thread: a browser with no worker cannot be stopped or timed, and the visitor is told. */
export const PAGE_THREAD_NOTE = "This browser could not run the search in the background, so it ran on this page, with no Stop and no time limit.";

/**
 * A runner for one kind of work: run(args), or run(async () => args) to hold the build's place while they load, resolves to the answer.
 * `kind` ("classic" or "showdown") tells opt-worker.js which answer to make. The worker sends a snapshot after each finished lineup
 * ({id, partial}). Nothing cuts a working build off in seconds: run.stop() (the Stop button, which also holds for a build still on its
 * way) or `ceilingMs` ends it, and the visitor gets `finish(args, snapshot or null, reason)`, the answer for the lineups finished so far
 * with a sentence, never nothing. `onPage(args)` makes the answer on the page's thread when the worker cannot start, crashes or cannot
 * read a message, and it carries PAGE_THREAD_NOTE; run.canStop() is false there. `failed()` is the route's own failure answer; `label` heads the console line.
 */
export function createWorkerRunner({ kind, ceilingMs = BUILD_CEILING_MS, failed, finish, onPage, label = "lineup generate: failed" }) {
  let worker = null;
  let workerBroken = false;
  let workerSeq = 0;
  const pending = new Map();
  const control = createBuildControl({ ceilingMs });

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
      if (event.data.partial !== undefined) {
        p.onPartial(event.data.partial);
        return;
      }
      pending.delete(event.data.id);
      p.onDone(event.data.response);
    };
    // The worker could not start, crashed, or could not read a message: every waiting request is run on the page
    // instead, and so is every later one.
    const broken = () => {
      workerBroken = true;
      try { worker?.terminate(); } catch { /* terminate throws only for a worker that is already gone: nothing to stop and no state to restore, the waits are rejected below */ }
      worker = null;
      for (const p of pending.values()) p.onFail(new Error("worker failed"));
      pending.clear();
    };
    worker.onerror = broken;
    worker.onmessageerror = broken;
    return worker;
  }

  // The build on the worker: stopping it ends the worker (a fresh one starts next time).
  const onWorker = (w, args) => (hooks) => {
    const id = ++workerSeq;
    pending.set(id, hooks);
    w.postMessage({ id, kind, args });
    return () => {
      pending.delete(id);
      try { w.terminate(); } catch { /* terminate throws only for a worker that is already gone: nothing to stop and no state to restore */ }
      if (worker === w) worker = null;
    };
  };

  async function run(input) {
    if (!control.reserve()) return failed();
    try {
      const args = typeof input === "function" ? await input() : input;
      const w = optWorker();
      if (w || control.stopAsked()) {
        const out = w ? await control.run(onWorker(w, args)) : { ended: "stopped", partial: null };
        if (out.ended) return await finish(args, out.partial, out.ended);
        if (!out.failed) return out.result;
        /* the worker failed: on to the page's thread */
      }
      const answer = await onPage(args);
      return Array.isArray(answer?.notes) ? { ...answer, notes: [...answer.notes, PAGE_THREAD_NOTE] } : answer;
    } catch (e) {
      console.error(label, e);
      return failed();
    } finally {
      control.release();
    }
  }
  run.stop = () => control.stop();
  run.canStop = () => !workerBroken && typeof Worker !== "undefined";
  return run;
}
