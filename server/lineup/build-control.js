// One Optimizer build at a time, off the main thread, never cut off in seconds (Adam 2026-11-02): the one copy of the reservation, the
// Stop, the ceiling and the words of a build ended early, for the app (server/lib/app-build.js, worker_threads) and the public site
// (site-src/site-worker.js, a module worker). Pure and browser-safe (D69): it starts nothing itself; `launch` is the caller's.

/** A build ended early: how far it got. `reason` "stopped" (the Stop button), "ceiling" (the time limit, `ceilingMs`) or "failed" (the worker died). */
export function stopSentence(reason, made, asked, ceilingMs) {
  const finished = made === 0 ? "no lineup was finished"
    : `${made} of ${asked} lineup${asked === 1 ? "" : "s"} ${made === 1 ? "was" : "were"} finished and ${made === 1 ? "is" : "are"} here`;
  if (reason === "stopped") return `Stopped: ${finished}.`;
  if (reason === "failed") return `The build failed part way: ${finished}.`;
  return `This build reached its ${Math.round(ceilingMs / 60000)} minute limit: ${finished}. Fewer lineups or looser settings take less time.`;
}

/** The engine's answer for a build ended early: the lineups of its last snapshot (`partial`, or none yet) plus the sentence, in the shape of a finished answer. */
export function endedResult(partial, reason, asked, ceilingMs) {
  const base = partial ?? { lineups: [], exposure: [], notes: [], bends: [], problems: [], ruleWarnings: [] };
  return { ...base, notes: [...base.notes, stopSentence(reason, base.lineups.length, asked, ceilingMs)] };
}

/**
 * The build's place held for one app request (`res`, the response): reserved, and if the connection closes before the answer has gone, a reload for
 * one, the build ends as Stop ends it. A browser waiting on its answer keeps the connection open, so this cannot end a build someone is waiting on.
 * Returns the function that frees the place, or null when it is taken. Nothing happens after that, so a late close can never end the next build.
 */
export function holdBuild(control, res) {
  if (!control.reserve()) return null;
  const onClose = () => {
    if (!res.writableFinished) control.stop();
  };
  res.on("close", onClose);
  return () => {
    res.off("close", onClose);
    control.release();
  };
}

/**
 * The control of one kind of build. reserve() before any waiting (false when one is already reserved), release() when its answer is
 * sent, busy() in between. run(launch) starts the work: `launch({onPartial, onDone, onFail})` returns the function that stops it, and
 * run resolves once to { result }, { ended: "stopped" or "ceiling", partial } or { failed: error, partial }, `partial` being the last
 * snapshot or null. stop() ends a running build, or one still only reserved, which then never starts (a Stop pressed while the
 * request is on its way); false when nothing is reserved. Timers are the caller's for tests.
 */
export function createBuildControl({ ceilingMs, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let reserved = false;
  let stopAsked = false;
  let endLive = null;
  return {
    ceilingMs,
    reserve() {
      if (reserved) return false;
      reserved = true;
      stopAsked = false;
      return true;
    },
    release() {
      reserved = false;
      stopAsked = false;
    },
    busy: () => reserved,
    stopAsked: () => stopAsked,
    stop() {
      if (endLive) {
        endLive("stopped");
        return true;
      }
      if (!reserved) return false;
      stopAsked = true;
      return true;
    },
    run(launch) {
      if (stopAsked) return Promise.resolve({ ended: "stopped", partial: null });
      return new Promise((resolve) => {
        let partial = null;
        let settled = false;
        let stopWork = () => {};
        let timer = null;
        const settle = (answer) => {
          if (settled) return false;
          settled = true;
          if (timer !== null) clearTimer(timer);
          endLive = null;
          resolve(answer);
          return true;
        };
        endLive = (reason) => {
          if (settle({ ended: reason, partial })) stopWork();
        };
        timer = setTimer(() => endLive?.("ceiling"), ceilingMs);
        const hooks = {
          onPartial: (p) => { if (!settled) partial = p; },
          onDone: (result) => settle({ result }),
          onFail: (error) => settle({ failed: error, partial })
        };
        try {
          stopWork = launch(hooks) ?? stopWork;
        } catch (e) {
          hooks.onFail(e);
        }
      });
    }
  };
}
