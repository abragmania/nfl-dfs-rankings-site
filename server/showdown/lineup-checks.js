// The showdown lineup checks shared by the app's routes (server/showdown/routes.js) and the public site's browser
// copy (site-src/site-showdown.js; DECISIONS.md D39, D71): the optimiser request, the slot list and the saved-lineup
// snapshot, so both refuse with the same messages and save the same snapshot. The lineup-name check is the classic
// one (server/lineups/validate.js validateLineupName).
//
// Pure and browser-safe: no node: module, no file, no config read. tools/publish.mjs copies it, unchanged, to
// out/server/showdown/ and privacy-scans it.

/** What a showdown with no known week answers when asked to keep a lineup: the app's route and the site say the same. */
export const WEEK_UNKNOWN_MESSAGE = "This showdown's week is not known yet; re-upload once the week resolves.";

export const LINEUP_OBJECTIVES = new Set(["proj"]);
// Objectives the showdown optimiser no longer offers. A request (or an old page) naming one builds by projection and
// carries this note, never an error: "projection minus ownership" was removed (Adam, 2026-10-15), and Lev has no
// measure (Adam 2026-10-15, Lev measure to be redesigned).
export const RETIRED_OBJECTIVES = Object.freeze({
  projMinusOwn: "\"Projection minus ownership\" has been removed, so this lineup was built by projection.",
  lev: "Leverage has no measure yet, so this lineup was built by projection."
});
// The build record a Showdown lineup may carry (server/lineups/validate.js validateLineupBuild): classic's, with the Showdown
// engine's objectives (Projection plus the figure builds ceil and median, the list generate-request.js accepts); `projection`
// admits the Showdown-only keys (build.projection, which an older page sends and the save neither checks nor keeps, and
// build.figuresKey). The figure builds are named here, not read from ../lineup/objective.js FIGURE_BUILDS, so this file
// keeps no import (the public site copies it unchanged); tests/showdown-lineups-routes.test.mjs pins the two lists equal.
export const BUILD_OPTIONS = Object.freeze({ objectives: Object.freeze(["proj", "ceil", "median"]), projection: true });

/** What a Lineup request that names a figures mode gets (Adam 2026-10-20: every game reads its ticked sources, with no mode):
 *  only a page opened before the board became the only source of Lineup figures sends one, "twogun" or "current" alike. */
export const RELOAD_PAGE_SENTENCE = "This page is older than the server: its Lineup request named a figures mode, and the Lineup tab now follows the game's ticked sources with no mode; reload the page.";

/** The old mode field of a meter, swaps or Build body (or Generate's boardMode): absent (undefined or null) is the one
 *  accepted shape and reads null; any value, "current" included, is an old open tab and reads RELOAD_PAGE_SENTENCE. Pure. */
export function staleModeError(value) {
  return value === undefined || value === null ? null : RELOAD_PAGE_SENTENCE;
}

const SHOWDOWN_SLOT_NAMES = new Set(["CPT", "FLEX"]);
const MAX_FLEX = 5;

function validateIdArray(value, name) {
  if (value === undefined || value === null) return { ids: [] };
  if (!Array.isArray(value)) return { error: `${name} must be an array of player ids` };
  for (const item of value) {
    if (typeof item !== "string" && typeof item !== "number") return { error: `${name} must contain only player id strings or numbers` };
  }
  return { ids: value };
}

/**
 * The body of POST .../lineup/optimize ({objective, locks, excludes, includes}, all optional) -> {objective, locks,
 * excludes, objectiveNote, includes?} or {error}. A retired objective becomes "proj" with objectiveNote saying so;
 * objectiveNote is null otherwise. includes (Adam 2026-10-19: men in the lineup at Captain or FLEX, the search's pick) is
 * checked for shape here and against the board in the route (server/lineup/showdown-includes.js readIncludes); it is in
 * the answer only when it names someone, so a body without it reads exactly as before.
 */
export function validateOptimizeBody(body) {
  body = body ?? {};
  let objective = body.objective === undefined || body.objective === null ? "proj" : body.objective;
  let objectiveNote = null;
  if (typeof objective === "string" && Object.prototype.hasOwnProperty.call(RETIRED_OBJECTIVES, objective)) {
    objectiveNote = RETIRED_OBJECTIVES[objective];
    objective = "proj";
  }
  if (typeof objective !== "string" || !LINEUP_OBJECTIVES.has(objective)) {
    return { error: `objective must be one of ${[...LINEUP_OBJECTIVES].join(", ")}` };
  }
  const locks = validateIdArray(body.locks, "locks");
  if (locks.error) return { error: locks.error };
  const excludes = validateIdArray(body.excludes, "excludes");
  if (excludes.error) return { error: excludes.error };
  const includes = validateIdArray(body.includes, "includes");
  if (includes.error) return { error: includes.error };
  return { objective, locks: locks.ids, excludes: excludes.ids, objectiveNote, ...(includes.ids.length ? { includes: includes.ids } : {}) };
}

/** {slots}: a non-empty array of {slot: CPT|FLEX, playerId}, at most one Captain and five FLEX, no player twice. */
export function validateShowdownSlots(value) {
  if (!Array.isArray(value) || value.length === 0) return { error: "slots must be a non-empty array" };
  const seen = new Set();
  const slots = [];
  let cpt = 0;
  let flex = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return { error: "each slot entry must be an object" };
    const slot = String(item.slot ?? "").trim().toUpperCase();
    if (!SHOWDOWN_SLOT_NAMES.has(slot)) return { error: "slot must be one of CPT, FLEX" };
    if (typeof item.playerId !== "string" && typeof item.playerId !== "number") return { error: "each slot entry needs a playerId" };
    const playerId = String(item.playerId);
    if (seen.has(playerId)) return { error: `duplicate player ${playerId}` };
    seen.add(playerId);
    if (slot === "CPT" && ++cpt > 1) return { error: "a showdown lineup has one Captain (CPT)" };
    if (slot === "FLEX" && ++flex > MAX_FLEX) return { error: `a showdown lineup has at most ${MAX_FLEX} FLEX` };
    slots.push({ slot, playerId });
  }
  return { slots };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * The saved snapshot of validated `slots` (from validateShowdownSlots) against the board's `rows`. A player may be
 * named by his FLEX id or his Captain id; both find the same row. D39: the Captain scores 1.5x and costs his Captain
 * price from the CSV; a missing price must never count as $0 toward the cap. Returns {error} or
 * {slots, salaryUsed, totalProj}; totalProj is null when any slot has no projection.
 */
export function buildShowdownSnapshot(slots, rows) {
  const rowById = new Map();
  for (const r of rows ?? []) {
    rowById.set(String(r.id), r);
    if (r.cptId !== undefined && r.cptId !== null) rowById.set(String(r.cptId), r);
  }
  const snapshotSlots = [];
  const usedPeople = new Set();
  for (const item of slots) {
    const row = rowById.get(item.playerId);
    if (!row) return { error: `unknown playerId ${item.playerId}` };
    // One man cannot fill two spots: his FLEX id and his Captain id name the same row.
    if (usedPeople.has(String(row.id))) return { error: `${row.name} is in the lineup twice (Captain and FLEX); a player can fill only one spot` };
    usedPeople.add(String(row.id));
    const cpt = item.slot === "CPT";
    if (cpt ? !isNum(row.cptSalary) : !isNum(row.salary)) {
      return { error: `${row.name} has no ${cpt ? "Captain" : "FLEX"} price in the salary file` };
    }
    const proj = cpt ? (isNum(row.cptProj) ? row.cptProj : isNum(row.proj) ? row.proj * 1.5 : null) : (isNum(row.proj) ? row.proj : null);
    snapshotSlots.push({
      slot: item.slot,
      playerId: item.playerId,
      name: row.name,
      team: row.team ?? null,
      pos: row.pos ?? null,
      salary: cpt ? row.cptSalary : row.salary,
      proj,
      own: cpt ? (row.ownCpt ?? null) : (row.ownFlex ?? null)
    });
  }
  const salaryUsed = snapshotSlots.reduce((sum, s) => sum + (s.salary ?? 0), 0);
  // Missing is missing (D29 spirit, router Data rules): one slot with no projection makes the total unknown, never a
  // sum that quietly counts him as 0.
  const totalProj = snapshotSlots.every((s) => isNum(s.proj)) ? snapshotSlots.reduce((sum, s) => sum + s.proj, 0) : null;
  return { slots: snapshotSlots, salaryUsed, totalProj };
}

/** Every board row's FLEX id and Captain id -> the row's person id (his FLEX id), for showdownLineupKey. */
export function showdownPersonIndex(rows) {
  const personOf = new Map();
  for (const r of rows ?? []) {
    if (r?.id === undefined || r.id === null) continue;
    personOf.set(String(r.id), String(r.id));
    if (r.cptId !== undefined && r.cptId !== null) personOf.set(String(r.cptId), String(r.id));
  }
  return personOf;
}

/**
 * One saved copy only, Captain-aware (Adam 2026-10-18; Part 4 "Showdown Optimizer port" hard rule: the same six men under
 * another Captain are distinct lineups): the Captain's id, then the sorted FLEX ids. A saved slot names its man by his FLEX
 * id or his Captain id (buildShowdownSnapshot keeps the id sent), so `personOf` (optional, showdownPersonIndex of the board)
 * turns either into his person id; an id it does not hold keys as itself. Pure; ../lineups/duplicate.js takes it as keyOf.
 */
export function showdownLineupKey(slots, personOf) {
  const list = Array.isArray(slots) ? slots : [];
  const person = (s) => {
    const id = String(s?.playerId);
    return personOf?.get(id) ?? id;
  };
  const isCpt = (s) => String(s?.slot ?? "").trim().toUpperCase() === "CPT";
  const cpt = list.filter(isCpt).map(person);
  const flex = list.filter((s) => !isCpt(s)).map(person).sort();
  return `CPT:${cpt.join(",")}|FLEX:${flex.join("|")}`;
}
