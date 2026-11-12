// Which build a saved lineup came from (ChatGPT wish g, Adam 2026-10-17): the `build` record saved on a lineup, the words
// that describe it, and the Saved tab's As built order. Pure; lineup.js imports it and
// server/lineups/validate.js validateLineupBuild checks the same record on the way in.

const MODE_WORD = { current: "Current", custom: "Custom", twogun: "TwoGun" }; // "current" also reads the records saved before P23 for a custom board
// A stored build that was made by ceiling (optimizer standard A21) has no word here, so its card names no objective.
const OBJECTIVE_WORD = { proj: "projection", lev: "leverage", projMinusOwn: "projection minus ownership" };

/** A build id shared by every lineup saved from one batch (one per Go). `nowMs` and `random` (0 to under 1) are passed in. */
export function newBuildId(nowMs, random) {
  return `b${Math.floor(nowMs).toString(36)}${Math.floor(random * 36 ** 4).toString(36).padStart(4, "0")}`;
}

/** The `build` record for one lineup saved from a Go: `results` = {buildId, boardMode ("current" | "twogun" | null), objective}. */
export function batchBuild(results) {
  const build = { kind: "batch", id: results.buildId };
  if (results.boardMode) build.boardMode = results.boardMode;
  if (results.objective) build.objective = results.objective;
  return build;
}

/** The `build` record for a lineup saved from the manual builder. */
export function handBuild(boardMode) {
  return boardMode ? { kind: "hand", boardMode } : { kind: "hand" };
}

/** "TwoGun · by projection", "Current · by projection", "By hand · TwoGun"; "" for a lineup with no build record. */
export function buildTypeText(build) {
  if (!build || typeof build !== "object") return "";
  const mode = MODE_WORD[build.boardMode] ?? null;
  if (build.kind === "hand") return ["By hand", mode].filter(Boolean).join(" · ");
  const objective = OBJECTIVE_WORD[build.objective] ?? null;
  return [mode, objective ? `by ${objective}` : null].filter(Boolean).join(" · ");
}

