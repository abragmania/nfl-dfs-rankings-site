// Who is not expected to play. Pure (no node modules), so the Optimizer's engine (server/lineup/multi.js and
// dk-entries.js) can also run in a browser on the public site (DECISIONS.md D69; tools/publish.mjs copies the engine).
// value.js re-exports both functions, so every other caller is unchanged.

// A player carrying one of these, from the DraftKings CSV's Status column or from ESPN's injury report, is not
// expected to play. He keeps his projection (it still says what he would score if he did), but the Optimizer
// leaves him out unless he is locked. "Questionable" is deliberately absent: a questionable player is a normal play.
const SIDELINED = new Set([
  "OUT", "O", "INACTIVE", "IR", "INJURED RESERVE", "DOUBTFUL", "D",
  "SUSPENDED", "SUSPENSION", "PUP", "PHYSICALLY UNABLE TO PERFORM", "NFI", "NON-FOOTBALL INJURY"
]);

/** True when a status string means the player is not expected to play. Null or blank is never sidelined. */
export function isSidelined(status) {
  if (status === null || status === undefined) return false;
  return SIDELINED.has(String(status).trim().toUpperCase());
}

/** True when a board row is out, on IR or doubtful, from either the CSV's status or the board's injured flag. */
export function rowIsSidelined(row) {
  return isSidelined(row?.status) || Boolean(row?.flags?.includes?.("injured"));
}
