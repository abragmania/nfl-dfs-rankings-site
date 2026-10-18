// The Optimizer's objective helpers (moved out of multi.js, cash mode job 1, 2026-10-17; plan CQ6): the number a lineup
// maximises, per player. Pure and browser-safe: the public site runs the engine in the browser (D69), so no node: imports.
import { rowIsOut } from "../rank/sidelined.js"; // pure: the public site runs this engine in the browser (D69)
import { medianOf } from "./cash.js"; // pure; the cash build's median (cash mode job 1, 2026-10-17)

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The refusal when a ceiling build is asked of a board with no TwoGun ceiling on any row. */
export const NO_CEILING_SENTENCE = "This board has no TwoGun ceilings (current mode, or no TwoGun board could be read), so lineups cannot be built by ceiling; build by projection.";

/** The score one candidate adds: his projection, or for "ceil" TwoGun's published ceiling (D25 as amended
 *  2026-10-15), 0 for a locked player without one, never an estimate; a typed projection never moves a ceiling. */
export function objectiveScore(row, proj, objective) {
  if (objective === "median") return medianOf(row) ?? 0; // cash mode job 1, 2026-10-17: TwoGun's median, 0 when locked without one
  return objective === "ceil" ? ceilingOf(row) ?? 0 : proj;
}

/** The builds that score by one of TwoGun's published figures, and that figure's word (cash mode job 1, 2026-10-17). */
export const FIGURE_BUILDS = Object.freeze({ ceil: "ceiling", median: "median" });

/** A figure build's figure for a row (ceilingOf or cash.js medianOf), or null when he has none. */
export function figureOf(row, objective) {
  return objective === "median" ? medianOf(row) : ceilingOf(row);
}

/** TwoGun's published ceiling for a board row (row.tg.ceil, TwoGun mode only), or null; 0 for an out row that has one
 *  (out = projection 0 and ceiling 0, Adam). Nothing else is read. */
export function ceilingOf(row) {
  const ceil = num(row && row.tg && row.tg.ceil);
  return ceil !== null && rowIsOut(row) ? 0 : ceil;
}

/** A ceiling build's notes: how many were left out for want of a ceiling, and that typed projections do not move it.
 *  `word` names the figure ("median" for a cash median build, FIGURE_BUILDS). */
export function ceilingNotes(leftOut, typed, notes, word = "ceiling") {
  if (leftOut > 0) {
    notes.push(`${leftOut} player${leftOut === 1 ? "" : "s"} with no TwoGun ${word} ${leftOut === 1 ? "was" : "were"} left out of this ${word} build.`);
  }
  if (typed > 0) {
    notes.push(`${typed} typed projection${typed === 1 ? "" : "s"} ${typed === 1 ? "does" : "do"} not change a ${word} build; it ranks by TwoGun's ${word}s as he publishes them.`);
  }
}
