// Saving a lineup ("draw up a lineup, press Save, see it in a list"): the checks on a POST /api/lineups body and the
// snapshot taken from the board, shared by the route (server/server.js handleLineupsPost, and handleLineupRename for
// the name) and the public site's device lineups (site-src/site-lineups.js buildDeviceLineup; DECISIONS.md D69). One
// copy, so both refuse with the same messages; the saved snapshot is always what the board showed at save time.
//
// Pure and browser-safe: no imports at all. tools/publish.mjs copies it, unchanged, to out/server/lineups/ and
// privacy-scans it.
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
// PUT (rename) so neither route can pass a non-string straight through to store.js's name.trim(), which
// would otherwise throw and surface as a 500 instead of a 400.
export function validateLineupName(value) {
  if (value === undefined) return { name: value };
  if (typeof value !== "string") return { error: "name must be a string" };
  if (value.trim().length > 80) return { error: "name must be at most 80 characters" };
  return { name: value };
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
