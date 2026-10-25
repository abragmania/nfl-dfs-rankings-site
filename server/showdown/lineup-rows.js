// The rows the Showdown Lineup tab reads from a served board, the one copy for the app's routes
// (./uniqueness-routes.js, ./optimizer-routes.js, ./lineups-routes.js) and the public site's Build
// (site-src/site-showdown.js, D71). Pure and browser-safe: no node: module, no file, no logging; tools/publish.mjs copies
// it, unchanged, to out/server/showdown/ by walking the site's imports.
import { isRevived } from "../rank/sidelined.js";
import { valueOf } from "../rank/value-core.js";

const cache = new WeakMap();

/**
 * The rows the Showdown Lineup tab reads on the board path (the meter, the six slots, both lists, swaps, Build, Generate):
 * the served board's own rows, Adam's typed numbers included (D28, D45), except that while TwoGun is the only ticked
 * projection source (board.mode.cashMode "twogun") a revive of a sidelined man is ignored: he stays out at 0, his TwoGun
 * median and ceiling count 0 (cash.js medianOf, objective.js ceilingOf), as the Figures switch's TwoGun mode has always
 * read him (Adam 2026-10-18: "TwoGun mode ignores a revive"). Every other typed number is kept, and any other board gives
 * board.rows itself, so nothing else moves. One array per board object.
 */
export function lineupRows(board) {
  const rows = Array.isArray(board?.rows) ? board.rows : [];
  if (board?.mode?.cashMode !== "twogun" || !rows.some(isRevived)) return rows;
  if (!cache.has(board)) cache.set(board, rows.map((r) => (isRevived(r) ? unrevived(r) : r)));
  return cache.get(board);
}

/** A revived row read as out (zeroOutRows' out row, D45): projection 0, the typed projection and the revive set aside
 *  (his typed ownership, if any, kept). */
export function unrevived(r) {
  return { ...r, proj: 0, cptProj: 0, value: valueOf(0, r.salary), override: { ...r.override, proj: null, revive: false }, flags: (r.flags ?? []).filter((f) => f !== "revived") };
}
