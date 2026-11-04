// DraftKings Showdown entries file (the "DKEntries.csv" Adam exports from his Showdown contest entries, edits and
// uploads back; data/findings/showdown-entries-plan-2026-10-20.md section 2(1)). Pure functions only: no file and
// no network access. The reading and writing are classic's (./dk-entries.js) taught the six-cell roster below; only
// the Showdown rules live here.
//
// The file's layout (Adam's week 5 export): a header `Entry ID,Contest Name,Contest ID,Entry Fee,CPT,FLEX,FLEX,FLEX,
// FLEX,FLEX,,Instructions`, one row per entry carrying six roster cells written `Name (DraftKingsId)`, one blank
// column, then DraftKings' instructions and the player list, which lists every man twice: a CPT row and a FLEX row,
// each with its own DraftKings id and price (D13: both prices are read from the file, never computed). The Captain
// cell carries the CPT row's id. Not carried from classic (D81): the latest-kickoff FLEX choice (one game), second
// slates (each game is its own key) and the two-games rule, which becomes "a man from each team".
import { parseEntriesCsv, buildUpload, describe, salaryNotes, injuryNotes } from "./dk-entries.js";

/** The Showdown roster columns, in the file's column order. */
export const DK_SHOWDOWN_SLOTS = Object.freeze(["CPT", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX"]);

const hasId = v => v !== undefined && v !== null && String(v).trim() !== "";
const rosterPosOf = (pool, id) => String(pool.get(id).rosterPos ?? "").trim().toUpperCase();
/** One man across his two rows: Name, TeamAbbrev and Position from the file's player list. */
const manOf = (pool, id) => {
  const p = pool.get(id);
  return `${String(p.name ?? "").trim()}|${p.team}|${p.pos}`;
};

/**
 * Structural problems of six file ids in slot order (Captain first): wrong count, an id twice, an id not in the
 * file's player list, a cell holding the wrong kind of row (cell 1 must be a CPT row, cells 2 to 6 FLEX rows), the
 * same man twice through his CPT row and his FLEX row. Returns plain sentences.
 */
function showdownStructureErrors(slots, pool) {
  const errors = [];
  if (!Array.isArray(slots) || slots.length !== DK_SHOWDOWN_SLOTS.length) {
    errors.push(`The lineup has ${Array.isArray(slots) ? slots.length : 0} players; a DraftKings Showdown lineup needs exactly six (one CPT and five FLEX).`);
    if (!Array.isArray(slots)) return errors;
  }
  const seen = new Set();
  const repeated = new Set();
  for (const id of slots) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  for (const id of repeated) errors.push(`${describe(pool, id)} is in the lineup more than once.`);
  const unknown = [...seen].filter(id => !pool.has(id));
  for (const id of unknown) errors.push(`The id ${id} is not in the entries file's player list.`);
  if (unknown.length > 0) return errors;

  if (slots.length === DK_SHOWDOWN_SLOTS.length) {
    slots.forEach((id, i) => {
      const slot = DK_SHOWDOWN_SLOTS[i];
      const rowKind = rosterPosOf(pool, id);
      if (rowKind !== slot) errors.push(`${describe(pool, id)} is the ${rowKind || "unmarked"} row and cannot go in the ${slot} slot.`);
    });
  }
  const idsOfMan = new Map();
  for (const id of seen) {
    const man = manOf(pool, id);
    if (!idsOfMan.has(man)) idsOfMan.set(man, []);
    idsOfMan.get(man).push(id);
  }
  for (const ids of idsOfMan.values()) {
    if (ids.length > 1) errors.push(`${pool.get(ids[0]).name} is in the lineup twice (${ids.map(id => describe(pool, id)).join(" and ")}); a player can fill only one spot.`);
  }
  return errors;
}

/** The Showdown roster layout for ./dk-entries.js (see CLASSIC_LAYOUT there). */
export const SHOWDOWN_LAYOUT = Object.freeze({
  slots: DK_SHOWDOWN_SLOTS,
  start: 4,
  end: 10,
  countWord: "six",
  structureErrors: showdownStructureErrors,
  wrongFile:
    "This is not a DraftKings Showdown entries file: the first line must start with Entry ID and carry the roster columns CPT, FLEX, FLEX, FLEX, FLEX, FLEX."
});

/** Parses a DraftKings Showdown entries file: parseEntriesCsv's answer, read with the Showdown layout. */
export function parseShowdownEntriesCsv(text) {
  return parseEntriesCsv(text, SHOWDOWN_LAYOUT);
}

/**
 * The six file ids (Captain first, then the FLEX men in the saved order) for one saved Showdown lineup.
 * `savedLineup.slots` is the saved record's [{slot: "CPT"|"FLEX", playerId}]; a slot names its man by his FLEX id or
 * his Captain id (the batch save sends the Captain under his FLEX id, public/js/showdown/optimizer.js saveBody; the
 * hand save under the id picked). `slatePlayers` is the game's salary-file players, each { id (the FLEX row's id; an
 * orphan Captain row's own), cptId (the CPT row's id or null) } as server/showdown/parse.js person() makes them.
 * Returns { ids } or { error } with a plain sentence: an incomplete lineup, a man not in the slate, a man twice, a
 * Captain with no CPT row or a FLEX man with no FLEX row are refused.
 */
export function showdownSlotsFor(savedLineup, slatePlayers) {
  const slots = Array.isArray(savedLineup?.slots) ? savedLineup.slots : [];
  const slotOf = s => String(s?.slot ?? "").trim().toUpperCase();
  const count = slot => slots.filter(s => slotOf(s) === slot).length;
  if (slots.length !== 6 || count("CPT") !== 1 || count("FLEX") !== 5) {
    return { error: `This lineup has ${count("CPT")} Captain and ${count("FLEX")} FLEX; only a complete lineup (one Captain and five FLEX) can go into an entry.` };
  }
  const byAnyId = new Map();
  for (const p of slatePlayers ?? []) {
    if (hasId(p?.id)) byAnyId.set(String(p.id).trim(), p);
    if (hasId(p?.cptId)) byAnyId.set(String(p.cptId).trim(), p);
  }
  const ids = [];
  const used = new Set();
  for (const s of [...slots.filter(x => slotOf(x) === "CPT"), ...slots.filter(x => slotOf(x) === "FLEX")]) {
    const sent = String(s.playerId ?? "").trim();
    const p = byAnyId.get(sent);
    const label = s.name ? `${s.name} (${sent})` : `The player id ${sent}`;
    if (!p) return { error: `${label} is not in this game's salary file.` };
    if (used.has(p)) return { error: `${p.name} is in the lineup twice; a player can fill only one spot.` };
    used.add(p);
    const isCpt = slotOf(s) === "CPT";
    const flexRow = hasId(p.cptId) && String(p.id) === String(p.cptId) ? null : p.id;
    const fileId = isCpt ? p.cptId : flexRow;
    if (!hasId(fileId)) {
      return { error: isCpt ? `${p.name} has no Captain row in this game's salary file, so he cannot be the Captain.` : `${p.name} has no FLEX row in this game's salary file, so he cannot fill a FLEX spot.` };
    }
    ids.push(String(fileId).trim());
  }
  return { ids };
}

/**
 * A per-person status map, sidelined set or revived map (keyed by either of a man's ids, as the board's rows key him
 * by his FLEX id) spread over both of his ids from the slate's `id` and `cptId`, so validateShowdownEntry's options
 * find a Captain by his CPT-row id too (a sidelined Captain must never pass). Returns the same kind (Set or Map);
 * the value of a Map entry is copied to both ids. A man the input does not name stays out.
 */
export function overBothIds(byPerson, slatePlayers) {
  const isSet = byPerson instanceof Set;
  const out = isSet ? new Set() : new Map();
  if (!byPerson || typeof byPerson.has !== "function") return out;
  for (const p of slatePlayers ?? []) {
    const ids = [p?.id, p?.cptId].filter(hasId).map(v => String(v).trim());
    const named = ids.find(id => byPerson.has(id));
    if (named === undefined) continue;
    for (const id of ids) {
      if (isSet) out.add(id);
      else out.set(id, byPerson.get(named));
    }
  }
  return out;
}

/**
 * Checks six file ids in slot order against DraftKings' Showdown rules, the file's own prices and the injury
 * statuses passed in. Options as classic validateLineup's (`statusById`, `sidelinedIds`, `revived`, keyed by the
 * file's ids: a caller enters both of a man's ids; `salaryCap` default 50000). Returns { errors, warnings, salary,
 * teams }; every error and warning is one plain sentence (classic's for the salary and injuries).
 */
export function validateShowdownEntry(slots, pool, { statusById, sidelinedIds, revived, salaryCap = 50000 } = {}) {
  const errors = showdownStructureErrors(slots, pool);
  const warnings = [];
  const known = Array.isArray(slots) ? [...new Set(slots)].filter(id => pool.has(id)) : [];
  const salary = known.reduce((sum, id) => sum + pool.get(id).salary, 0);
  if (errors.length === 0) {
    const notes = salaryNotes(salary, salaryCap);
    errors.push(...notes.errors);
    warnings.push(...notes.warnings);
  }
  const teams = new Set(known.map(id => pool.get(id).team).filter(Boolean));
  if (known.length > 0) {
    if (known.some(id => !pool.get(id).team)) {
      warnings.push("The both-teams rule could not be checked because a player's TeamAbbrev in the entries file is blank.");
    } else if (teams.size < 2) {
      errors.push(`Every player is from one team (${[...teams][0]}); DraftKings needs a player from each team.`);
    }
  }
  const injuries = injuryNotes(known, pool, { statusById, sidelinedIds, revived });
  errors.push(...injuries.errors);
  warnings.push(...injuries.warnings);
  return { errors, warnings, salary, teams: [...teams] };
}

/**
 * The file to upload: classic buildUpload's byEntry path on a parseShowdownEntriesCsv answer. `byEntry` is a Map or
 * object of entry id -> six file ids in slot order (showdownSlotsFor's ids). Only the six roster cells of each named
 * row change; every other cell, line, line ending and a byte order mark are kept, and the byte-for-byte self-check
 * runs. Throws on a classic parse, and with classic's sentences on everything buildUpload refuses.
 */
export function buildShowdownUpload(parsed, byEntry) {
  if (parsed?.layout !== SHOWDOWN_LAYOUT) throw new Error("buildShowdownUpload needs a Showdown entries file read by parseShowdownEntriesCsv.");
  return buildUpload(parsed, null, null, { byEntry });
}
