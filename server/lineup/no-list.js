// NO ("build without him", PROJECT.md Part 4 Monday 11-23 item 4; NBA b430e7c lineup/no-list.js applyNo, Adam's rule there of 6:16 and 6:19 PM 11-19):
// the open mode's NO men are left out of what the optimizer picks on its own, and nothing else. A NO man who is locked (a filled seat is a
// lock, D70; a QB stack's "Lock" teammate whose quarterback is usable is passed in as one, qb-stacks.js heldStackLocks) is used as he chose, with no note and no refusal. A NO man whose Min % comes to
// at least one lineup of this build is held to it: his Max % for this build is the share of exactly those lineups, or his own Max when lower
// (NBA heldTo). Every other NO man joins this build's excludes (his saved exclude is not changed) and a Max % on him is left out of this
// build's settings only. Pure and browser-safe (the site copies it).
import { minLineups } from "./multi-settings.js";

/**
 * in: { noIds, locks, excludes, playerMinExposure, playerMaxExposure, count } (ids as strings; the two exposure maps {id: {pct}} or
 * undefined; count: this build's lineups, default 1). Out: { excludes, playerMaxExposure, applied, held } — the build's excludes with the NO
 * men added, the Max % map without them and with each Min-held NO man capped at his Min (the same object when nothing changed), the ids
 * actually left out, and the Min-held ids. Inputs are never changed.
 */
export function applyNo({ noIds = [], locks = [], excludes = [], playerMinExposure, playerMaxExposure, count = 1 } = {}) {
  const locked = new Set(locks.map(String));
  const ids = [...new Set(noIds.map(String))].filter((id) => !locked.has(id));
  const minN = (id) => minLineups(Number(playerMinExposure?.[id]?.pct), count); // the engine's own rounding (down)
  const held = ids.filter((id) => minN(id) > 0);
  const applied = ids.filter((id) => minN(id) === 0);
  let max = playerMaxExposure;
  if (held.length) {
    max = { ...(max ?? {}) };
    for (const id of held) {
      const own = Number(max[id]?.pct);
      max[id] = { pct: Math.min(sharePct(minN(id), count), Number.isFinite(own) ? own : Infinity) };
    }
  }
  if (!applied.length) return { excludes, playerMaxExposure: max, applied, held };
  if (max && applied.some((id) => Object.hasOwn(max, id))) {
    max = Object.fromEntries(Object.entries(max).filter(([id]) => !applied.includes(id)));
  }
  return { excludes: [...new Set([...excludes, ...applied])], playerMaxExposure: max, applied, held };
}

// Review round 2 finding 3 of 11-23: n of count as a percent cut down to two decimals, so a note never prints 33.333333333333336; the
// engine's rounding up (pctToLineups) still gives exactly n, since the cut is under 0.01 of a percent and count is at most 150.
function sharePct(n, count) {
  return Math.floor((n * 100 * 100) / count + 1e-6) / 100;
}
