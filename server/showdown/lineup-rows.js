// The rows the Showdown Lineup tab reads from a served board, the one copy for the app's routes
// (./uniqueness-routes.js, ./optimizer-routes.js, ./lineups-routes.js) and the public site's Build
// (site-src/site-showdown.js, D71). Pure and browser-safe: no node: module, no file, no logging; tools/publish.mjs copies
// it, unchanged, to out/server/showdown/ by walking the site's imports.
import { TWOGUN_ID } from "../sources/selection-core.js";

/** What board.mode.ticked says about TwoGun: proj (ticked for Projections), projOnly (the only projection source ticked:
 *  board.mode.cashMode "twogun", modeOf's one reading), own (ticked for FLEX or Captain ownership) and ownOnly (the only
 *  source ticked for both). All false for a board with no ticked list (a stand-in build). Pure: here, not in board-view.js
 *  (which reads files), so the public site's meter, swaps and Optimizer read it in the browser (RULES.md D71). */
export function boardTwoGun(board) {
  const t = board?.mode?.ticked;
  const ids = (kind) => (t?.[kind]?.sources ?? []).map((s) => s.id);
  const only = (kind) => ids(kind).length === 1 && ids(kind)[0] === TWOGUN_ID;
  return {
    proj: ids("projection").includes(TWOGUN_ID), projOnly: board?.mode?.cashMode === "twogun",
    own: ids("sdOwnFlex").includes(TWOGUN_ID) || ids("sdOwnCpt").includes(TWOGUN_ID), ownOnly: only("sdOwnFlex") && only("sdOwnCpt")
  };
}

/**
 * The rows the Showdown Lineup tab reads on the board path (the meter, the six slots, both lists, swaps, Build, Generate):
 * the served board's own rows, Adam's typed numbers and his In / Out included (D28, D45), in every mode. Adam 2026-11-12: a
 * typed number always wins, so TwoGun-only mode no longer sets a revive aside (the 2026-10-18 "TwoGun mode ignores a revive"
 * is retired). One array per board object: board.rows itself.
 */
export function lineupRows(board) {
  return Array.isArray(board?.rows) ? board.rows : [];
}
