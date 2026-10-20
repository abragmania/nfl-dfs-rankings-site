// Raw value (PROJECT.md Part 4 "Value and leverage").
//   value = blended DraftKings points / (salary / 1000)  - blank when there is no projection, never 0.
// Lev: Adam 2026-10-15, Lev measure to be redesigned. The classic board no longer computes or serves a Lev number
// (the old z(value) - lambda * z(own%) "makes no sense"); the Lev column stays on the tables with every cell
// empty until a new measure is chosen.
//
// The rank settings file (data/config/rank.json: lambda, ownPenaltyK, chalkMinOwn, valueMinPtsPerK) is retired:
// review Q1 (Adam 2026-10-14) removed the chalk and value lines, and Adam 2026-10-15 removed Lev (lambda) and the
// projection-minus-ownership objective (ownPenaltyK), so nothing is left to configure.
//
// Pure (no node modules, no file reads), so the public site can run it in the visitor's browser (DECISIONS.md D71).
// value.js re-exports everything here, so every existing caller is unchanged.

// isSidelined / rowIsSidelined live in sidelined.js (pure, so the Optimizer's engine also runs in a browser, D69)
// and are re-exported here for every existing caller.
import { isSidelined, rowIsSidelined } from "./sidelined.js";
export { isSidelined, rowIsSidelined };

/**
 * A finite number, or null. The one guard every caller in the ranking layer must use before a comparison:
 * Number(null) is 0 and Number.isFinite(0) is true, so casting first turns "no ownership" into "0% owned" and
 * "no projection" into "0 points", both of which then take part in averages and percentiles.
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * D52: true when the row's projection is a real one - a source projected him, or Adam typed one (D28). A row
 * flagged "no projection" whose proj is DraftKings' average (blend.js's "avgPoints" stand-in) is not: D52 hides
 * him like any unprojected player, and he gets no value, grade or tag on that number. The Optimizer's pool
 * uses the same test (server/lineup/multi.js noProjection); public/js/state.js hasRealProjection is the
 * browser's copy and must stay identical.
 */
export function hasRealProjection(row) {
  if (toNumber(row?.proj) === null) return false;
  if (toNumber(row?.override?.proj) !== null) return true;
  return !(Array.isArray(row?.flags) && row.flags.includes("no projection"));
}

/** Points per $1,000 of salary, or null when either number is missing (D27: blank, never 0). */
export function valueOf(proj, salary) {
  // Number(null) is 0, so a missing projection has to be rejected before the cast: a blank projection must stay
  // blank, never become a value of 0 (D27).
  if (proj === null || proj === undefined || proj === "") return null;
  const p = Number(proj);
  const s = Number(salary);
  if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0) return null;
  return p / (s / 1000);
}

/**
 * Adds value to a set of rows.
 * rows - objects carrying { id, proj, salary, flags, override }.
 * Returns Map id -> { value }: value is null without a projection. A row whose proj is only the D52 stand-in
 * (hasRealProjection false) gets value null like any unprojected player (D27), unless Adam typed his projection
 * (D28); that also keeps him out of the Value grade (public/js/grade.js grades only rows with a value). No Lev
 * (Adam 2026-10-15, Lev measure to be redesigned).
 */
export function computeValue(rows) {
  const out = new Map();
  for (const row of rows ?? []) {
    out.set(row.id, { value: hasRealProjection(row) ? valueOf(row.proj, row.salary) : null });
  }
  return out;
}
