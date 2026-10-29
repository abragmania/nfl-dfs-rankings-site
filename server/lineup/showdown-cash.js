// Cash mode in the Showdown Optimizer's engine (Adam 2026-10-18: "with cash i still want to be able to roll off X
// lineups, lock guys, exclude, same functionality as the classic/cash"; PROJECT.md D39): the Showdown twin of
// server/lineup/cash.js, whose basis rule and sentences it imports. The server picks the basis (TwoGun's median when the
// board mode is "twogun", the projection when "current", never the ceiling), adds no points of any kind, and turns off minimum unique
// players, the four Max % and Min % settings and the lineup rules. What stays is the X best distinct lineups by that
// basis (a lineup's identity is slot-plus-man, so the same six men under another Captain is a distinct lineup), with
// locks, includes (Adam 2026-10-19), excludes, Max per team and the hard Showdown rules. Pure and browser-safe (D69): no node: import.
import { cashBasis, carried, CASH_NOTES } from "./cash.js";
import { listNames } from "./soft.js";

export const SHOWDOWN_CASH_DEFAULTS = Object.freeze({ count: 1, minUnique: 1 });

const EXPOSURE_KEYS = Object.freeze(["captainMaxExposure", "captainMinExposure", "flexMaxExposure", "flexMinExposure"]);

/** What a cash request may not send, each with cash.js' own sentence: the route refuses with it (the classic route's
 *  CASH_REFUSED), the engine ignores the setting and says it once. The basis note is classic's CASH_NOTES.basis, one copy
 *  (Adam 2026-10-20, "make it uniform across everything"): Showdown's basis now follows this game's ticked sources
 *  (board.mode.cashMode, server/showdown/optimizer-routes.js noteModeOf) as classic's does. */
export const SHOWDOWN_CASH_REFUSED = Object.freeze([
  { keys: ["objective"], error: CASH_NOTES.basis },
  { keys: ["lineupRules"], error: CASH_NOTES.rules },
  { keys: EXPOSURE_KEYS, error: CASH_NOTES.exposure },
  { keys: ["minUnique"], error: CASH_NOTES.unique } // Cash: no minimum unique, Adam 2026-10-17
]);

/** The note when a cash build runs out of distinct lineups after `made` of them. Cash turns off Min %, Max % and minimum
 *  unique players, so only the locks, the includes (`included`: their names, when any; Adam 2026-10-19), excludes, Max
 *  per team and the cap are named. */
export function cashRanOutNote(made, cap, included = []) {
  const inc = included.length ? `includes (${listNames(included)}), ` : "";
  const under = `under the locks, ${inc}excludes, Max per team and the $${cap.toLocaleString("en-US")} cap`;
  if (made === 0) return `No lineup exists ${under}.`;
  if (made === 1) return `Only 1 distinct lineup exists ${under}; it is returned.`;
  return `Only ${made} distinct lineups exist ${under}; all ${made} are returned.`;
}

/** The settings a cash build runs on (cash.js cashEngineSettings' twin): {settings, notes, fatal}. `rows` are the
 *  showdown board rows (row.tg.median per man, as the classic board carries it), `boardMode` "current" or "twogun". */
export function showdownCashSettings(settings, rows, boardMode) {
  const s = settings && typeof settings === "object" ? settings : {};
  const basis = cashBasis(rows, boardMode);
  if (basis.fatal) return { settings: null, notes: [], fatal: basis.fatal };
  const notes = SHOWDOWN_CASH_REFUSED.filter(({ keys }) => keys.some((k) => carried(s[k]))).map(({ error }) => error);
  const out = { ...s };
  for (const k of [...EXPOSURE_KEYS, "lineupRules"]) delete out[k];
  Object.assign(out, { count: s.count ?? SHOWDOWN_CASH_DEFAULTS.count, minUnique: SHOWDOWN_CASH_DEFAULTS.minUnique, objective: basis.basis });
  return { settings: out, notes, fatal: null };
}
