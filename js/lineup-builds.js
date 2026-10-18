// Which build a saved lineup came from (ChatGPT wish g, Adam 2026-10-17): the `build` record saved on a lineup, the words
// that describe it, and the Saved tab's As built order. Pure; lineup.js imports it and
// server/lineups/validate.js validateLineupBuild checks the same record on the way in.
import { lineupCeilTotal } from "./totals.js";

const MODE_WORD = { current: "Current", twogun: "TwoGun" };
const OBJECTIVE_WORD = { proj: "projection", ceil: "ceiling", lev: "leverage", projMinusOwn: "projection minus ownership" };

/** A build id shared by every lineup saved from one batch (one per Go). `nowMs` and `random` (0 to under 1) are passed in. */
export function newBuildId(nowMs, random) {
  return `b${Math.floor(nowMs).toString(36)}${Math.floor(random * 36 ** 4).toString(36).padStart(4, "0")}`;
}

/** The `build` record for one lineup saved from a Go: `results` = {buildId, boardMode ("current" | "twogun" | null), objective}.
 *  totalCeil is there only when the lineup carries TwoGun figures (lineup.ceil defined): the shown sum of its players'
 *  ceilings, null when any player has none. */
export function batchBuild(results, lineup) {
  const build = { kind: "batch", id: results.buildId };
  if (results.boardMode) build.boardMode = results.boardMode;
  if (results.objective) build.objective = results.objective;
  const ceil = lineupCeilTotal(lineup);
  if (ceil !== undefined) build.totalCeil = ceil;
  return build;
}

/** The `build` record for a lineup saved from the manual builder. */
export function handBuild(boardMode) {
  return boardMode ? { kind: "hand", boardMode } : { kind: "hand" };
}

/** "TwoGun · by ceiling", "Current · by projection", "By hand · TwoGun"; "" for a lineup with no build record. */
export function buildTypeText(build) {
  if (!build || typeof build !== "object") return "";
  const mode = MODE_WORD[build.boardMode] ?? null;
  if (build.kind === "hand") return ["By hand", mode].filter(Boolean).join(" · ");
  const objective = OBJECTIVE_WORD[build.objective] ?? null;
  return [mode, objective ? `by ${objective}` : null].filter(Boolean).join(" · ");
}

function groupKey(lineup) {
  const build = lineup?.build;
  if (build?.kind === "hand") return "hand";
  if (build?.kind === "batch" && typeof build.id === "string" && build.id !== "") return `batch:${build.id}`;
  return "earlier";
}

const savedMs = (lineup) => {
  const ms = Date.parse(lineup?.savedAt);
  return Number.isNaN(ms) ? 0 : ms;
};

/** Lineups grouped by build, newest build first. A group is {key, kind ("batch" | "hand" | "earlier"), build (the first
 *  lineup's record, or null), newest (ms of its newest lineup), lineups (oldest saved first, Adam 2026-10-17, so a build's
 *  cards read 1, 2, 3; an unreadable time sorts as oldest; equal times keep the order given)}. Lineups saved by hand form one "hand" group;
 *  lineups with no build record (saved before the field existed) form the "earlier" group, last. */
export function groupByBuild(lineups) {
  const groups = new Map();
  for (const lineup of lineups ?? []) {
    const key = groupKey(lineup);
    let group = groups.get(key);
    if (!group) {
      group = { key, kind: key === "hand" ? "hand" : key === "earlier" ? "earlier" : "batch", build: lineup.build ?? null, newest: 0, lineups: [] };
      groups.set(key, group);
    }
    group.newest = Math.max(group.newest, savedMs(lineup));
    group.lineups.push(lineup);
  }
  for (const group of groups.values()) group.lineups.sort((a, b) => savedMs(a) - savedMs(b)); // stable: equal times keep the given order
  const rank = (g) => (g.kind === "earlier" ? 1 : 0);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.newest - a.newest);
}
