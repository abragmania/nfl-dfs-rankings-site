// One saved copy only (Adam 2026-10-18): a duplicate shares the slate (none = "main"), the mode (none = GPP; cash and GPP never
// compared) and the set of player ids in any slots. Pure, browser-safe, shared by server/server.js and site-src/site-lineups.js.
import { lineupModeOf } from "./validate.js";

export const DUPLICATE_CODE = "DUPLICATE_LINEUP";

export function lineupPlayerKey(slots) {
  return (Array.isArray(slots) ? slots : []).map((s) => String(s?.playerId)).sort().join("|");
}

// `keyOf` (optional, default lineupPlayerKey) is the lineup's identity: Showdown passes its Captain-aware key
// (server/showdown/lineup-checks.js showdownLineupKey; Part 4 "Showdown Optimizer port": the same six men under another
// Captain are distinct lineups). Classic passes nothing.
export function findDuplicate(candidateSlots, mode, slateKey, existing, { exceptId, keyOf = lineupPlayerKey } = {}) {
  const key = keyOf(candidateSlots);
  const wantMode = mode === "cash" ? "cash" : "gpp";
  const wantSlate = slateKey || "main";
  for (const l of Array.isArray(existing) ? existing : []) {
    if (!l || (exceptId !== undefined && l.id === exceptId) || !Array.isArray(l.slots) || l.slots.length === 0) continue;
    if (lineupModeOf(l) === wantMode && (l.slate || "main") === wantSlate && keyOf(l.slots) === key) return l;
  }
  return null;
}

// An edit keeping the same players and slate is never refused, so a twin saved before this rule can still be renamed.
// `keyOf` as findDuplicate's, used for both the "same players" test and the search.
export function duplicateAfterEdit(stored, nextSlots, nextSlate, existing, { keyOf = lineupPlayerKey } = {}) {
  const slots = nextSlots ?? stored.slots;
  const slate = (typeof nextSlate === "string" && nextSlate !== "" ? nextSlate : stored.slate) || "main";
  if (keyOf(slots) === keyOf(stored.slots) && slate === (stored.slate || "main")) return null;
  return findDuplicate(slots, lineupModeOf(stored), slate, existing, { exceptId: stored.id, keyOf });
}

export function duplicateMessage(dup) {
  const d = new Date(dup?.savedAt ?? "");
  const when = Number.isNaN(d.getTime()) ? "" : ` (${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})`;
  return `Already saved in ${lineupModeOf(dup) === "cash" ? "Cash" : "GPP"} as "${dup?.name ?? ""}"${when}; one saved copy only`;
}
