// The showdown Optimizer's request checks and response shaping (Adam 2026-10-18; PROJECT.md D39), the showdown twin of
// server/lineup/generate-request.js: used by POST /api/showdown/<key>/lineup/generate (./optimizer-routes.js) and
// later by the public site's copy of that route. One copy, so both answer message for message alike.
//
// The settings are the classic Optimizer's, and only these (Adam 2026-10-18: "these are the only constraints"): count,
// objective (Projection, ceiling or median), minUnique, locks, includes (Adam 2026-10-19), excludes, maxPerTeam, mode (gpp
// or cash), and a Max % and a Min % for the Captain and for FLEX kept apart:
//   captainMaxExposure, captainMinExposure, flexMaxExposure, flexMinExposure  ({"<player id>": {pct: 0-100}})
// A player id is the man's FLEX id or his Captain id; either names the same man. Locks and excludes use candidate ids as
// optimizeShowdown does: a FLEX id is his FLEX row, a Captain id his Captain row; excluding a FLEX id removes the man.
//
// Pure and browser-safe: no node modules, no network, no storage. It is not free of logging: its imports (the engine
// server/lineup/showdown-multi.js, and multi.js and optimize.js) reach server/lib/log.js, and the site build swaps that
// file for site-src/browser-log.js (tools/publish.mjs), so the published copy runs in a browser.
import { validateIdArray, isPlainObject } from "../lineup/generate-request.js";
import { RETIRED_OBJECTIVES, BUILD_OPTIONS, staleModeError } from "./lineup-checks.js";
import { minLineups, pctToLineups } from "../lineup/multi.js";
import { CPT_MULTIPLIER, SHOWDOWN_MAX_FROM_TEAM } from "../lineup/showdown.js";
// The engine's own limits, one copy; its log.js import is swapped for site-src/browser-log.js on the site, as multi.js's is.
import { MAX_LINEUPS, MAX_UNIQUE, showdownBoard, maxPerTeamOk, MAX_PER_TEAM_SENTENCE, lockedTeamBreak } from "../lineup/showdown-multi.js";
import { rosterTest } from "../lineup/showdown-pool.js";
import { figureOf } from "../lineup/objective.js"; // the engine's figure accessor: whether a median or ceiling build has a figure to build on
import { readIncludes, withIncludes } from "../lineup/showdown-includes.js";
import { readShowdownRules } from "../lineup/showdown-rules.js";
import { SHOWDOWN_CASH_REFUSED } from "../lineup/showdown-cash.js";
import { rowIsSidelined } from "../rank/sidelined.js"; // pure: the one copy of who the board lists sidelined (D45)
import { bumpFigures } from "../overrides/merge.js"; // pure: the ± bump's one copy (Adam 2026-10-22)

// lineupRules: the GPP lineup rules (server/lineup/lineup-rules.js shape, D81); classic's settings.rules is unrelated.
// maxPerTeam (3, 4 or 5; absent = 5) and mode ("gpp" or "cash", showdown-cash.js) are the classic Optimizer's twins (Adam 2026-10-18).
// includes: men in every lineup at Captain or FLEX, the search's pick (Adam 2026-10-19; ../lineup/showdown-includes.js),
// GPP and Cash; an array of FLEX or Captain ids, held as person ids; absent or empty means none.
export const SHOWDOWN_GENERATE_SETTING_KEYS = new Set([
  "count", "minUnique", "locks", "excludes", "objective", "captainMaxExposure", "captainMinExposure", "flexMaxExposure", "flexMinExposure",
  "lineupRules", "maxPerTeam", "mode", "includes"
]);
// The builds a request may ask for: Projection, TwoGun's ceiling, TwoGun's median (the Captain at 1.5x of it). The one list,
// lineup-checks.js BUILD_OPTIONS.objectives, the one the saved lineups' build record accepts, pinned to the engine's figure builds.
const GENERATE_OBJECTIVES = BUILD_OPTIONS.objectives;
const PCT_SETTINGS = [
  { key: "captainMaxExposure", role: "CPT", word: "Max %" },
  { key: "captainMinExposure", role: "CPT", word: "Min %" },
  { key: "flexMaxExposure", role: "FLEX", word: "Max %" },
  { key: "flexMinExposure", role: "FLEX", word: "Min %" }
];
const FLEX_SLOTS = 5;
const roleName = (role) => (role === "CPT" ? "Captain" : "FLEX");
const hasId = (v) => v !== null && v !== undefined && String(v) !== "";

// Every build runs on the served board (this game's ticked sources, Adam 2026-10-20); its wording and Cash basis follow the
// board's own reading (board.mode.cashMode). boardMode is the old Figures switch's field: any value, "current" included, is
// an old open tab, refused with the reload sentence (lineup-checks.js staleModeError); absent or null is accepted. field: the uniqueness meter's field size for a GPP batch, checked by the meter's own check
// (uniqueness-routes.js checkMeterField) in the route.
const BODY_KEYS = new Set(["settings", "boardMode", "field"]);

/** The request body's shape: an object of {settings} and an optional field only (an old page's boardMode as above). Returns an error sentence or null. */
export function generateBodyError(body) {
  if (!isPlainObject(body)) return "The request body must be an object.";
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) return `Unknown field ${JSON.stringify(key)}; send {settings, field}.`;
  }
  return staleModeError(body.boardMode);
}

/**
 * The served board's rows (board-view.js serveShowdownBoard) carrying tg = TwoGun's own {proj, median, ceil} from
 * `figuresById` (twogun-projections.js), or null for a man the file has no row for, which the engine's median and ceiling
 * builds and the cash basis read (objective.js ceilingOf, cash.js medianOf; both count an out man's figure as 0). D45: a man
 * the board lists sidelined (rowIsSidelined) carries tg.proj 0, so nothing downstream can show his raw TwoGun projection
 * while row.proj is 0. Adam 2026-10-22, the ± bump: his figures are scaled by the row's override.bump steps (bumpFigures),
 * as the merge scales row.proj, since they are attached after the merge. Pure.
 */
export function withTwoGunFigures(rows, figuresById) {
  return (rows ?? []).map((r) => {
    // D45 first, then the bump, so his raw projection never rides along in bumpBase.
    const f = figuresById?.get(String(r.id)) ?? null;
    return { ...r, tg: bumpFigures(f && rowIsSidelined(r) ? { ...f, proj: 0 } : f, r.override?.bump) };
  });
}

/** Lookups over the board's rows: the person for a FLEX id or a Captain id, and each id's candidate (role and person). */
function boardIds(rows) {
  const personOf = new Map();
  const candOf = new Map(); // candidate id -> { person, role }
  const rowOf = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !hasId(row.id)) continue;
    const person = String(row.id);
    rowOf.set(person, row);
    personOf.set(person, person);
    candOf.set(person, { person, role: "FLEX" });
    if (hasId(row.cptId)) {
      personOf.set(String(row.cptId), person);
      candOf.set(String(row.cptId), { person, role: "CPT" });
    }
  }
  return { personOf, candOf, rowOf };
}

/** Validates the settings against the board `rows`. Returns {error} with a plain sentence, or {settings} ready for
 *  generateShowdownLineups (ids as strings; `notes` carries the retired-objective note). */
export function validateShowdownGenerateSettings(raw, rows) {
  if (raw === undefined || raw === null) raw = {};
  if (!isPlainObject(raw)) return { error: "settings must be an object" };
  for (const key of Object.keys(raw)) {
    if (!SHOWDOWN_GENERATE_SETTING_KEYS.has(key)) return { error: `Unknown setting ${JSON.stringify(key)}.` };
  }
  const mode = raw.mode === undefined || raw.mode === null ? "gpp" : raw.mode;
  if (mode !== "gpp" && mode !== "cash") return { error: "mode must be cash or gpp" };
  if (mode === "cash") {
    const refused = SHOWDOWN_CASH_REFUSED.find(({ keys }) => keys.some((k) => raw[k] !== undefined && raw[k] !== null));
    if (refused) return { error: refused.error };
  }
  const { personOf, candOf, rowOf } = boardIds(rows);
  const nameOf = (id) => rowOf.get(personOf.get(id))?.name ?? id;
  const out = { notes: [] };
  if (raw.mode !== undefined && raw.mode !== null) out.mode = mode;
  if (raw.maxPerTeam !== undefined && raw.maxPerTeam !== null) {
    if (!maxPerTeamOk(raw.maxPerTeam)) return { error: MAX_PER_TEAM_SENTENCE };
    out.maxPerTeam = raw.maxPerTeam;
  }
  if (raw.count !== undefined && raw.count !== null) {
    if (!Number.isInteger(raw.count) || raw.count < 1 || raw.count > MAX_LINEUPS) return { error: `count must be a whole number from 1 to ${MAX_LINEUPS}` };
    out.count = raw.count;
  }
  if (raw.minUnique !== undefined && raw.minUnique !== null) {
    if (!Number.isInteger(raw.minUnique) || raw.minUnique < 1 || raw.minUnique > MAX_UNIQUE) return { error: `minUnique must be a whole number from 1 to ${MAX_UNIQUE}` };
    out.minUnique = raw.minUnique;
  }
  // The retired objectives build on Projection with a note, never an error, so an old saved request still works.
  // The objective is set only when sent (as classic's generate-request.js does), so a cash request that sent none carries
  // no "server picks the basis" note (showdown-cash.js counts a carried objective).
  if (raw.objective !== undefined && raw.objective !== null) {
    const objective = raw.objective;
    if (typeof objective === "string" && Object.prototype.hasOwnProperty.call(RETIRED_OBJECTIVES, objective)) out.notes.push(RETIRED_OBJECTIVES[objective]);
    else if (typeof objective !== "string" || !GENERATE_OBJECTIVES.includes(objective)) return { error: `objective must be one of ${GENERATE_OBJECTIVES.join(", ")}` };
    out.objective = GENERATE_OBJECTIVES.includes(objective) ? objective : "proj"; // a retired one builds on projection
  }

  for (const name of ["locks", "excludes"]) {
    const result = validateIdArray(raw[name], name);
    if (result.error) return { error: result.error };
    const ids = [...new Set(result.ids.map((id) => String(id).trim()))];
    const unknown = ids.filter((id) => !candOf.has(id));
    if (unknown.length) return { error: `${name} names a player who is not on the board: ${unknown.join(", ")}` };
    out[name] = ids;
  }

  // Max % and Min %: {"<player id>": {pct}}; null drops the entry. Stored under the man's FLEX id.
  for (const { key, word } of PCT_SETTINGS) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (!isPlainObject(value)) return { error: `${key} must be an object keyed by player id` };
    const pcts = {};
    for (const [rawId, entry] of Object.entries(value)) {
      const id = String(rawId).trim();
      if (!personOf.has(id)) return { error: `${key} names a player who is not on the board: ${rawId}` };
      if (entry === null || entry === undefined) continue;
      const keys = isPlainObject(entry) ? Object.keys(entry) : [];
      if (keys.length !== 1 || keys[0] !== "pct") return { error: `${key} for ${nameOf(id)} must be {pct: 0-100}` };
      const n = entry.pct;
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) return { error: `${key} for ${nameOf(id)} must be a ${word} from 0 to 100` };
      pcts[personOf.get(id)] = { pct: n };
    }
    out[key] = pcts;
  }

  // Combinations that can never be met, each with a plain sentence.
  const personName = (p) => rowOf.get(p)?.name ?? p;
  const lockedAs = new Map(); // person -> roles locked
  for (const id of out.locks ?? []) {
    const { person, role } = candOf.get(id);
    lockedAs.set(person, [...(lockedAs.get(person) ?? []), role]);
  }
  for (const [person, roles] of lockedAs) {
    if (roles.length > 1) return { error: `${personName(person)} is locked as both Captain and FLEX; a man fills only one spot.` };
  }
  const roleLocks = [...lockedAs.values()].flat();
  if (roleLocks.filter((r) => r === "CPT").length > 1) return { error: "Two Captains are locked; a lineup has one Captain." };
  if (roleLocks.filter((r) => r === "FLEX").length > FLEX_SLOTS) return { error: `More than ${FLEX_SLOTS} FLEX are locked; a lineup has ${FLEX_SLOTS}.` };
  // Checked against DraftKings' five when no Max per team is sent, so {} and {maxPerTeam: 5} answer the same.
  const teamBreak = lockedTeamBreak((out.locks ?? []).map((id) => rowOf.get(candOf.get(id).person)?.team), out.maxPerTeam ?? SHOWDOWN_MAX_FROM_TEAM);
  if (teamBreak) return { error: teamBreak };
  // An exclude by FLEX id removes the man (both rows); by Captain id only his Captain row.
  const excludedAs = (person, role) => (out.excludes ?? []).some((id) => candOf.get(id).person === person && (candOf.get(id).role === "FLEX" || candOf.get(id).role === role));
  for (const id of out.locks ?? []) {
    const { person, role } = candOf.get(id);
    if (excludedAs(person, role)) return { error: `${personName(person)} is both locked and excluded.` };
  }
  for (const role of ["CPT", "FLEX"]) {
    const maxKey = role === "CPT" ? "captainMaxExposure" : "flexMaxExposure";
    const minKey = role === "CPT" ? "captainMinExposure" : "flexMinExposure";
    for (const [person, { pct }] of Object.entries(out[minKey] ?? {})) {
      if (!(pct > 0)) continue;
      const max = out[maxKey]?.[person]?.pct;
      if (max !== undefined && pct > max) return { error: `${personName(person)}'s ${roleName(role)} Min % (${pct}) is above his ${roleName(role)} Max % (${max})` };
      if (excludedAs(person, role)) return { error: `${personName(person)} is excluded and has a ${roleName(role)} Min %` };
      const other = role === "CPT" ? "FLEX" : "CPT";
      if (lockedAs.get(person)?.[0] === other) return { error: `${personName(person)} is locked as ${roleName(other)} and has a ${roleName(role)} Min %` };
    }
  }
  // A locked Captain fills the one Captain spot of every lineup, so another man's Captain Min that reaches a lineup (rounded
  // down, as the engine counts it) can never be met (code review of 297c2bb and its follow-up, 2026-10-18).
  const count = out.count ?? 1;
  const lockedCaptain = [...lockedAs].find(([, roles]) => roles[0] === "CPT")?.[0];
  if (lockedCaptain !== undefined) {
    for (const [person, { pct }] of Object.entries(out.captainMinExposure ?? {})) {
      if (minLineups(pct, count) > 0 && person !== lockedCaptain) return { error: `${personName(lockedCaptain)} is locked as Captain, so ${personName(person)}'s Captain Min % can never be met` };
    }
  }
  // Each lineup has one Captain, so the Captain Mins (rounded down, as the engine counts them) must fit the count
  // (code review of 5500554, 2026-10-18; the wording follows classic soft.js minSlotProblem).
  const captainNeed = Object.values(out.captainMinExposure ?? {}).reduce((s, { pct }) => s + minLineups(pct, count), 0);
  if (captainNeed > count) return { error: `The Captain Min % settings need ${captainNeed} Captain spots but only ${count} fit: each lineup has one Captain` };
  // Includes (Adam 2026-10-19), GPP and Cash: refused with the engine's own sentences (showdown-includes.js readIncludes),
  // the Max % counted in lineups as the engine counts them (rounded up). Kept as person ids, a locked man dropped (the
  // lock already puts him in); set only when one is left, so a request without includes is unchanged.
  const includeIds = validateIdArray(raw.includes, "includes");
  if (includeIds.error) return { error: includeIds.error };
  let includeSet = new Set();
  if (includeIds.ids.length) {
    const maxOf = (role, person) => {
      const pct = out[role === "CPT" ? "captainMaxExposure" : "flexMaxExposure"]?.[person]?.pct;
      return pct === undefined ? null : { n: pctToLineups(pct, count), pct };
    };
    const read = readIncludes(includeIds.ids, showdownBoard(rows, out.excludes), { locks: out.locks, maxPerTeam: out.maxPerTeam ?? SHOWDOWN_MAX_FROM_TEAM, count, maxOf });
    if (read.error) return { error: read.error };
    if (read.people.length) out.includes = read.people;
    includeSet = new Set(read.people);
  }
  // Lineup rules (D81): refused when malformed, naming someone off the board, or contradicting each other or the locks.
  // A rule naming a man is judged by this build's own pool (rosterTest: a median build rosters a priced, not-out man with
  // a median whatever his projection; a ceiling build needs a ceiling; an included man is let in, withIncludes), exactly
  // as the engine judges it (D81). For a median or ceiling build whose figure no row carries (the engine then answers
  // NO_MEDIAN_GPP_SENTENCE or NO_CEILING_SENTENCE before any rule is read), or a Projection build where no row projects above
  // 0 (nothing posted, so D45 rosters nobody), any priced man can sit: the rules are judged on everything but who the build
  // could seat, so the answer is the build's own sentence, not a rule sentence about a pool that seats nobody (code review
  // of 7bafd38).
  if (raw.lineupRules !== undefined && raw.lineupRules !== null) {
    const ruleBoard = showdownBoard(rows, out.excludes);
    const objective = out.objective ?? "proj";
    const projects = (r) => typeof r.proj === "number" && Number.isFinite(r.proj) && r.proj > 0;
    const judged = objective === "proj" ? rows.some(projects) : rows.some((r) => figureOf(r, objective) !== null);
    const canRoster = judged ? rosterTest(ruleBoard, objective) : (c) => typeof c.salary === "number" && Number.isFinite(c.salary);
    const read = readShowdownRules(raw.lineupRules, ruleBoard, out.locks, withIncludes(canRoster, includeSet));
    if (read.error) return { error: read.error };
    out.lineupRules = read.rules;
  }
  return { settings: out };
}

/**
 * The response body's {lineups, exposure, notes, bends, ruleWarnings} from generateShowdownLineups' result and the board `rows`.
 * Each lineup lists its six men in slot order (Captain first) with name, real position, team, matchup, the price in his
 * slot, his points in his slot (the Captain's at 1.5x) and his ownership in his slot. Exposure is two figures per man,
 * Captain and FLEX (counts and percent of the lineups made), never combined (Adam 2026-10-18).
 */
export function enrichShowdownResult(result, rows) {
  const { rowOf, personOf } = boardIds(rows);
  const made = result.lineups.length;
  const pct = (n) => (made ? Math.round((n / made) * 1000) / 10 : 0);
  const lineups = result.lineups.map((l) => ({
    salary: l.salary,
    proj: l.proj,
    ...(l.ceil !== undefined ? { ceil: l.ceil } : {}),
    ...(l.median !== undefined ? { median: l.median } : {}),
    ...(l.bent !== undefined ? { bent: l.bent } : {}),
    slots: l.slots.map((sl) => {
      const r = rowOf.get(sl.personId) ?? {};
      const cpt = sl.slot === "CPT";
      return {
        slot: sl.slot,
        playerId: sl.id,
        personId: sl.personId,
        name: r.name ?? sl.personId,
        pos: r.pos ?? null,
        team: r.team ?? null,
        opp: r.opp ?? null,
        salary: (cpt ? r.cptSalary : r.salary) ?? null,
        proj: typeof r.proj === "number" ? (cpt ? r.proj * CPT_MULTIPLIER : r.proj) : null,
        own: (cpt ? r.ownCpt : r.ownFlex) ?? null
      };
    })
  }));
  const exposure = result.exposure.map((e) => {
    const r = rowOf.get(personOf.get(e.personId)) ?? {};
    return { id: e.personId, name: r.name ?? e.personId, pos: r.pos ?? null, team: r.team ?? null, cpt: e.cpt, flex: e.flex, cptPct: pct(e.cpt), flexPct: pct(e.flex) };
  });
  // mode and basis only when the engine set them (cash), so a GPP answer is unchanged (classic's enrichGenerateResult does the same).
  const cash = { ...(result.mode !== undefined ? { mode: result.mode } : {}), ...(result.basis !== undefined ? { basis: result.basis } : {}) };
  return { lineups, exposure, notes: result.notes, bends: result.bends, ruleWarnings: result.ruleWarnings ?? [], ...cash };
}
