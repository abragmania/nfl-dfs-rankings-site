// The Optimizer's objective helpers (moved out of multi.js, cash mode job 1, 2026-10-17; plan CQ6): the number a lineup
// maximises, per player. Pure and browser-safe: the public site runs the engine in the browser (D69), so no node: imports.
// The Ceiling objective was removed 2026-11-03 (optimizer standard A21): the feed keeps TwoGun's ceilings, nothing here reads them.
import { medianOf } from "./cash.js"; // pure; the cash build's median (cash mode job 1, 2026-10-17)

/**
 * The note a build carries when its request (or a setting saved before 2026-10-15) names a retired objective:
 * "lev" (Adam 2026-10-15, Lev measure to be redesigned) or "projMinusOwn" (Adam 2026-10-15: projection minus
 * ownership removed). Such a request is built on projection instead, never refused. Null for any other value.
 * The one copy: optimize.js, multi.js, showdown.js and the routes use it.
 */
export function retiredObjectiveNote(objective) {
  if (objective === "lev") return "Leverage is no longer an objective (it has no measure yet), so these lineups maximise projection.";
  if (objective === "projMinusOwn") return "Projection minus ownership is no longer an objective, so these lineups maximise projection.";
  return null;
}

/** The refusal when a request names the removed Ceiling objective (optimizer standard A21, 2026-11-03). The app's own screens
 *  never send it (a remembered "ceil" falls back to Projection in the browser); only an old caller can. */
export const CEILING_REMOVED_SENTENCE = "Building by ceiling is no longer offered; build by projection.";

/** The refusal when a median build is asked of a GPP board with no TwoGun median on any row (the cash twin is cash.js NO_MEDIAN_SENTENCE). */
export const NO_MEDIAN_GPP_SENTENCE = "This board has no TwoGun medians, so lineups cannot be built by median; build by projection.";

/** The score one candidate adds: his projection, or for a cash "median" build TwoGun's published median (0 for a locked
 *  player without one, never an estimate; a typed projection never moves it). */
export function objectiveScore(row, proj, objective) {
  if (objective === "median") return medianOf(row) ?? 0; // cash mode job 1, 2026-10-17: TwoGun's median, 0 when locked without one
  return proj;
}

/** The builds that score by one of TwoGun's published figures, and that figure's word (cash mode job 1, 2026-10-17). */
export const FIGURE_BUILDS = Object.freeze({ median: "median" });

/** A figure build's figure for a row (cash.js medianOf), or null when he has none. */
export function figureOf(row, objective) {
  return objective === "median" ? medianOf(row) : null;
}

/** Why an unlocked player is kept out of the pool, the first that holds (rowFlags' reasons), for keptOutNote. */
export function keptOutReason({ lateOut, sidelined, noProjection, avoided, unstarredQb }) {
  if (lateOut) return "ruled out after TwoGun's board";
  if (sidelined) return "listed out";
  if (noProjection) return "no projection";
  if (avoided) return "in a game set to avoid";
  if (unstarredQb) return "quarterbacks not starred";
  return "kept out";
}

/** Global rule G62: the Optimizer note's one line on the unlocked players the pool left out, by reason ({reason: count}),
 *  most first: "212 players kept out: 180 no projection, 30 listed out, 2 no salary." Null when none was. */
export function keptOutNote(counts) {
  const parts = Object.entries(counts ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const total = parts.reduce((s, [, n]) => s + n, 0);
  return total ? `${total} player${total === 1 ? "" : "s"} kept out: ${parts.map(([why, n]) => `${n} ${why}`).join(", ")}.` : null;
}

/** A figure build's notes: how many were left out for want of the figure, that typed projections do not move it, and how
 *  many pool players' figures carry Adam's ± bump (`bumped`; Adam 2026-10-22, 5% a step, merge.js bumpFigures), in which
 *  case the figures are no longer as he publishes them. `word` names the figure ("median", FIGURE_BUILDS). */
export function ceilingNotes(leftOut, typed, notes, word = "median", bumped = 0) {
  if (leftOut > 0) {
    notes.push(`${leftOut} player${leftOut === 1 ? "" : "s"} with no TwoGun ${word} ${leftOut === 1 ? "was" : "were"} left out of this ${word} build.`);
  }
  if (typed > 0) {
    notes.push(`${typed} typed projection${typed === 1 ? "" : "s"} ${typed === 1 ? "does" : "do"} not change a ${word} build; it ranks by TwoGun's ${word}s${bumped > 0 ? "" : " as he publishes them"}.`);
  }
  if (bumped > 0) {
    notes.push(`${bumped} player${bumped === 1 ? "'s" : "s'"} TwoGun ${word}${bumped === 1 ? " carries" : "s carry"} Adam's ± adjustment.`);
  }
}
