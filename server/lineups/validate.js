// Saving a lineup ("draw up a lineup, press Save, see it in a list"): the checks on a POST /api/lineups body and the
// snapshot taken from the board, shared by the routes (server/server.js handleLineupsPost and handleLineupUpdate)
// and the public site's device lineups (site-src/site-lineups.js buildDeviceLineup; DECISIONS.md D69). One copy,
// so both refuse with the same messages; the saved snapshot is always what the board showed at save time.
//
// Pure and browser-safe: its one import is the engine's objective names (server/lineup/multi.js, which the site copies too).
// tools/publish.mjs copies it, unchanged, to out/server/lineups/ and privacy-scans it.
import { OBJECTIVES } from "../lineup/multi.js";

const LINEUP_SLOT_NAMES = new Set(["QB", "RB", "WR", "TE", "FLEX", "DST"]);

// Validates the POSTed {slots}: a non-empty array of {slot, playerId} objects, slot one of the six
// roster-slot names, playerId a string/number, and no playerId repeated. Unknown-player checking happens
// after this, once the current board is loaded, since that's the only place that knows what's on it.
export function validateLineupSlots(value) {
  if (!Array.isArray(value) || value.length === 0) return { error: "slots must be a non-empty array" };
  const seen = new Set();
  const slots = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { error: "each slot entry must be an object" };
    }
    const slot = String(item.slot ?? "").trim().toUpperCase();
    if (!LINEUP_SLOT_NAMES.has(slot)) {
      return { error: `slot must be one of ${[...LINEUP_SLOT_NAMES].join(", ")}` };
    }
    if (typeof item.playerId !== "string" && typeof item.playerId !== "number") {
      return { error: "each slot entry needs a playerId" };
    }
    const playerId = String(item.playerId);
    if (seen.has(playerId)) return { error: `duplicate player ${playerId}` };
    seen.add(playerId);
    slots.push({ slot, playerId });
  }
  return { slots };
}

// A saved-lineup name is optional (blank/omitted becomes "Lineup N" in store.js's buildLineupEntry), but
// when present it must be a string of at most 80 characters after trimming. Shared by POST (create) and
// PUT (update) so neither route can pass a non-string straight through to store.js's name.trim(), which
// would otherwise throw and surface as a 500 instead of a 400.
export function validateLineupName(value) {
  if (value === undefined) return { name: value };
  if (typeof value !== "string") return { error: "name must be a string" };
  if (value.trim().length > 80) return { error: "name must be at most 80 characters" };
  return { name: value };
}

// Optional saved-lineup mode (PROJECT.md Part 4 Cash mode): omitted stays omitted, and a missing or unknown stored
// mode reads as gpp, so no existing file is rewritten. A PUT may flip it (PROJECT.md Part 4 Entries, Adam 2026-10-17).
export function validateLineupMode(value) {
  if (value === undefined) return { mode: value };
  if (value === "cash" || value === "gpp") return { mode: value };
  return { error: "mode must be cash or gpp" };
}

// Optional saved-lineup `build` record (ChatGPT wish g, Adam 2026-10-17): where the lineup came from, so the Saved tab
// groups by build. {kind: "batch" (made by the Optimizer; id = one stamp per Go, shared by every lineup saved from it) or
// "hand" (manual builder; no id), boardMode "current" | "twogun", objective (batch only), totalCeil (batch only: TwoGun's
// ceilings summed, null when a player has none), edited (true only: the players were replaced by hand after the save, set by
// buildAfterSlotEdit)}. Omitted stays omitted; the stored copy holds only these keys.
const BUILD_KEYS = new Set(["kind", "id", "boardMode", "objective", "totalCeil", "edited"]);
const BUILD_MODES = new Set(["current", "twogun"]);
// The engine's own objective names (multi.js OBJECTIVES) plus the retired ones an older saved lineup may still carry.
const RETIRED_BUILD_OBJECTIVES = Object.freeze(["lev", "projMinusOwn"]);
const BUILD_OBJECTIVES = new Set([...OBJECTIVES, ...RETIRED_BUILD_OBJECTIVES]);
const BUILD_ID = /^[A-Za-z0-9_-]{1,40}$/;
const CEIL_TOTAL_MAX = 1000; // nine players cannot score more
export function validateLineupBuild(value) {
  if (value === undefined || value === null) return { build: undefined };
  if (typeof value !== "object" || Array.isArray(value)) return { error: "build must be an object" };
  for (const key of Object.keys(value)) if (!BUILD_KEYS.has(key)) return { error: `build has an unknown field ${JSON.stringify(key)}` };
  const { kind, id, boardMode, objective, totalCeil, edited } = value;
  if (kind !== "batch" && kind !== "hand") return { error: "build.kind must be batch or hand" };
  if (kind === "batch" && !(typeof id === "string" && BUILD_ID.test(id))) return { error: "build.id must be 1 to 40 letters, digits, - or _" };
  if (kind === "hand" && (id !== undefined || objective !== undefined || totalCeil !== undefined || edited !== undefined)) return { error: "a build by hand has no id, objective, ceiling total or edited flag" };
  if (edited !== undefined && totalCeil !== undefined) return { error: "build.edited and build.totalCeil cannot both be set" };
  if (boardMode !== undefined && !BUILD_MODES.has(boardMode)) return { error: "build.boardMode must be current or twogun" };
  if (objective !== undefined && !BUILD_OBJECTIVES.has(objective)) return { error: `build.objective must be one of ${[...BUILD_OBJECTIVES].join(", ")}` };
  if (edited !== undefined && edited !== true) return { error: "build.edited must be true" };
  if (totalCeil !== undefined && totalCeil !== null && !(typeof totalCeil === "number" && Number.isFinite(totalCeil) && totalCeil >= 0 && totalCeil <= CEIL_TOTAL_MAX)) {
    return { error: `build.totalCeil must be a number from 0 to ${CEIL_TOTAL_MAX}, or null` };
  }
  const build = { kind };
  if (kind === "batch") build.id = id;
  if (boardMode !== undefined) build.boardMode = boardMode;
  if (objective !== undefined) build.objective = objective;
  if (totalCeil !== undefined) build.totalCeil = totalCeil;
  if (edited === true) build.edited = true;
  return { build };
}

/** Pure: a lineup's `build` after its players were replaced by hand. A build that had a ceiling total (totalCeil defined,
 *  even null) no longer describes the rows with it, so the total goes and `edited: true` says so (the Saved card shows a dash
 *  for it); the group and the rest stay. A build with no ceiling total (current mode, a hand build) is returned unchanged,
 *  with no edited key, and so is no build at all. */
export function buildAfterSlotEdit(build) {
  if (!build || typeof build !== "object") return build;
  const { totalCeil, ...rest } = build;
  if (totalCeil === undefined) return build;
  return { ...rest, edited: true };
}

/** Pure: whether two slot lists hold different players. The sorted String(playerId) lists are compared, so the same nine
 *  players in other slots (across FLEX) are not a difference; a list that is not an array counts as different. The
 *  builder's Update always sends slots, so store.js and site-lineups.js ask this before dropping a build's ceiling total. */
export function slotsPlayersDiffer(oldSlots, newSlots) {
  if (!Array.isArray(oldSlots) || !Array.isArray(newSlots)) return true;
  const ids = (slots) => slots.map((s) => String(s && s.playerId)).sort();
  const a = ids(oldSlots);
  const b = ids(newSlots);
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

export function lineupModeOf(lineup) {
  return lineup?.mode === "cash" ? "cash" : "gpp";
}

// Optional saved-lineup letter `tag`, Adam's stable handle (PROJECT.md Part 4 Entries, Adam 2026-10-17; the plan file
// data/findings/entries-fill-plan-2026-10-17.md item 7a): "A" to "Z", then "AA" to "ZZ". Omitted stays omitted; null
// means no letter (a PUT clears it with null).
export const LINEUP_TAG_MESSAGE = "tag must be one or two capital letters, A to Z or AA to ZZ";
export function validateLineupTag(value) {
  if (value === undefined || value === null) return { tag: value };
  if (typeof value === "string" && /^[A-Z]{1,2}$/.test(value)) return { tag: value };
  return { error: LINEUP_TAG_MESSAGE };
}

/** Pure: one letter per week and slate (same source): every OTHER lineup on lineup `id`'s slate (no slate = "main")
 *  holding its tag loses it, so a write that gives `id` a letter moves it. A new array; the input is never mutated. */
export function releaseLineupTag(lineups, id) {
  const owner = lineups.find((l) => l?.id === id);
  if (typeof owner?.tag !== "string" || owner.tag === "") return [...lineups];
  const slate = owner.slate || "main";
  return lineups.map((l) => {
    if (l.id === id || l.tag !== owner.tag || (l.slate || "main") !== slate) return l;
    const { tag, ...rest } = l;
    return rest;
  });
}

/**
 * Optional `slate` (the Optimizer counts saved lineups per slate): "main" or a loaded second slate's key (D57),
 * looked up in `secondSlates`. Omitted means none is recorded, as for every lineup saved before the field existed.
 * Returns {lineupSlate, lineupSecondSlate} (lineupSlate undefined when omitted; lineupSecondSlate null unless a
 * second slate) or {error}.
 */
export function findLineupSlate(slate, secondSlates) {
  let lineupSlate;
  let lineupSecondSlate = null;
  if (slate !== undefined && slate !== null) {
    if (slate !== "main") {
      lineupSecondSlate = typeof slate === "string" ? secondSlates.find((s) => s.key === slate) ?? null : null;
      if (!lineupSecondSlate) {
        return { error: `There is no second slate called ${JSON.stringify(slate)} for the loaded week.` };
      }
    }
    lineupSlate = slate;
  }
  return { lineupSlate, lineupSecondSlate };
}

/**
 * The saved snapshot of validated `slots` (from validateLineupSlots), each player looked up in `rowById` (every
 * board row by string id). A lineup saved to a second slate must have every known player in its games. Returns
 * {error} or {slots, salaryUsed, totalProj}.
 */
export function buildLineupSnapshot(slots, rowById, lineupSecondSlate) {
  if (lineupSecondSlate) {
    const games = new Set(lineupSecondSlate.gameIds);
    const outside = slots.map((s) => rowById.get(s.playerId)).filter((r) => r && !games.has(r.gameId));
    if (outside.length) {
      return { error: `${outside.map((r) => r.name).join(", ")} ${outside.length === 1 ? "is" : "are"} not in the ${lineupSecondSlate.label} games, so this lineup cannot be saved to that slate.` };
    }
  }
  const snapshotSlots = [];
  for (const item of slots) {
    const row = rowById.get(item.playerId);
    if (!row) return { error: `unknown playerId ${item.playerId}` };
    snapshotSlots.push({
      slot: item.slot,
      playerId: item.playerId,
      name: row.name,
      team: row.team ?? null,
      pos: row.pos ?? null,
      salary: row.salary ?? null,
      proj: row.proj ?? null,
      own: row.own ?? null,
    });
  }
  const salaryUsed = snapshotSlots.reduce((sum, s) => sum + (s.salary ?? 0), 0);
  const totalProj = snapshotSlots.reduce((sum, s) => sum + (s.proj ?? 0), 0);
  return { slots: snapshotSlots, salaryUsed, totalProj };
}
