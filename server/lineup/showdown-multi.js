// The showdown Optimizer's engine (Adam 2026-10-18: "make an OPTIMIZER the same way there is one for classic, but it will
// have to optimize under showdown constraints"; PROJECT.md D39). N showdown lineups, one at a time, each the best by
// projection under DraftKings' showdown rules and the settings Adam has switched on. Pure over board rows: no network,
// no clock, no file. multi.js is NOT taught showdown; this file imports its percent helpers and soft.js' Min % helpers
// and runs server/lineup/showdown.js' exact search (exactSearch) once per lineup.
//
// Hard rules, never bent (Adam 2026-10-18: "these are the only constraints"): one Captain (1.5x points at the CSV's
// Captain price) plus five FLEX, $50,000 at the CSV's prices, at least one man from each team (so at most five from one),
// no man in two slots, nobody without a projection unless locked or included, every lock, every include (at Captain or
// FLEX, the search's pick; Adam 2026-10-19, showdown-includes.js), no exclude. K and DST may be Captain or FLEX. checkShowdownLineup below re-proves all of these on every lineup the engine makes.
// Settings carried from the classic Optimizer: count, Projection, minimum unique, locks, excludes, and Max % / Min %,
// kept SEPARATE for the Captain and for FLEX (Adam 2026-10-18: "keep cpt and flex ownership separate, do not combine
// them"): each is counted over that man's Captain lineups or that man's FLEX lineups of this batch alone, never summed.
// A lineup's identity is its man-and-slot pairs (Adam 2026-10-18: CPT is a different position than FLEX): the same six
// men under a different Captain is a different lineup, for minimum unique and against saved lineups.
// Bends (least change, the lineup marked bent): Min forcing first, then Max %, then minimum unique. Locks, includes,
// excludes, the cap and the DraftKings rules never bend. Output is deterministic: a tie in points is settled by the search order, which never varies.
// Lineup rules (settings.lineupRules, D81) are hard too: enforced inside the search, never bent (showdown-rules.js).
// Max per team (settings.maxPerTeam, 3, 4 or 5; absent = 5, DraftKings' rule) is hard as well (Adam 2026-10-18). The
// objective is "proj" (default), "ceil" or "median": TwoGun's figure per man, the Captain's at 1.5x of it, scored as
// classic does (objective.js). settings.mode "cash" is showdown-cash.js: the X best distinct lineups by the basis it picks.
import { pctToLineups, minLineups } from "./multi.js";
import { mustAppear, listNames, unmetMinNotes, percentNote } from "./soft.js";
import { showdownCandidates, exactSearch, rosterable, SHOWDOWN_SLOTS, SHOWDOWN_MAX_FROM_TEAM, CPT_MULTIPLIER } from "./showdown.js";
import { readShowdownRules, searchGate, assertKeepsRules, rulesShortNote } from "./showdown-rules.js";
import { showdownCashSettings, cashRanOutNote } from "./showdown-cash.js";
import { figureOf, FIGURE_BUILDS, NO_CEILING_SENTENCE, NO_MEDIAN_GPP_SENTENCE } from "./objective.js";
import { outReason, rosterTest, buildPool } from "./showdown-pool.js"; // the search pool and its notes
import { readIncludes, withIncludes, noIncludeFitSentence, roleMax, captainSteer, solveSteered } from "./showdown-includes.js"; // includes (Adam 2026-10-19)
import { warn } from "../lib/log.js";

export const SHOWDOWN_CAP = 50000;
export const MAX_LINEUPS = 150;
export const MAX_UNIQUE = SHOWDOWN_SLOTS.length; // six slots
// Least change first; locks, includes, excludes, the cap and the DraftKings rules never bend (Adam 2026-10-18; includes 2026-10-19).
export const BEND_ORDER = Object.freeze(["minForce", "playerMax", "minUnique"]);
const PER_LINEUP_STEPS = 3000000; // a counter, never a clock, so two runs agree
const BATCH_STEPS = 60000000;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hasId = (v) => v !== null && v !== undefined && String(v) !== "";

export const MAX_PER_TEAM_SENTENCE = "Max per team must be 3, 4 or 5.";
/** Max per team is the whole number 3, 4 or 5 (the request route and the engine share this one test). */
export const maxPerTeamOk = (v) => v === 3 || v === 4 || v === 5;
/** `teams`: the team of each locked man. The sentence when more of them share one team than Max per team allows, else null. */
export function lockedTeamBreak(teams, maxPerTeam) {
  const n = new Map();
  for (const t of teams) n.set(t, (n.get(t) ?? 0) + 1);
  const over = [...n].find(([, k]) => k > maxPerTeam);
  return over ? `${over[1]} of the locked men are from ${over[0]} but Max per team is ${maxPerTeam}.` : null;
}

/** A lineup's identity pair for one man: his slot and his person id (Adam 2026-10-18). One function, so the identity
 *  rule has one home. */
export function slotKey(slot, personId) {
  return `${slot === "CPT" ? "CPT" : "FLEX"}:${personId}`;
}

function idList(value) {
  if (value === null || value === undefined) return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of arr) {
    const id = item && typeof item === "object" ? item.id ?? item.playerId : item;
    if (!hasId(id)) continue;
    const s = String(id).trim();
    if (s !== "" && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * The board's candidates and lookups, shared by the engine and the checker: every row becomes a Captain and a FLEX
 * candidate (showdown.js showdownCandidates). personOf maps a FLEX id or a Captain id to the row's person id; a FLEX id
 * in `excludes` takes the person out (both roles), a Captain id only his Captain.
 */
export function showdownBoard(rows, excludesInput = []) {
  const byCand = new Map();
  const rowOfPerson = new Map();
  const personOf = new Map();
  const candidates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !hasId(row.id)) continue;
    const person = String(row.id);
    rowOfPerson.set(person, row);
    personOf.set(person, person);
    if (hasId(row.cptId)) personOf.set(String(row.cptId), person);
    for (const c of showdownCandidates(row)) {
      candidates.push(c);
      byCand.set(c.id, c);
    }
  }
  const excludeIds = new Set(idList(excludesInput));
  const personOut = new Set([...excludeIds].filter((id) => rowOfPerson.has(id)));
  const excluded = new Set(excludeIds);
  for (const c of candidates) if (personOut.has(c.personId)) excluded.add(c.id);
  return { candidates, byCand, rowOfPerson, personOf, excluded, teams: [...new Set(candidates.map((c) => c.team))].sort() };
}

/**
 * The hard rules, proved on one finished lineup. `lineup`: { slots: [{slot, id}], salary, proj } (candidate ids, the
 * Captain's being his Captain id). `ctx`: { board (showdownBoard), cap, locks: Set, excludes? (board.excluded),
 * maxPerTeam? (default 5), canRoster? (candidate -> boolean, default rosterable; a ceiling or median build passes its own),
 * includes? (Set of person ids: each must be in the lineup once, at either role; showdown-includes.js) }.
 * Returns the broken rules as sentences; an empty list means the lineup is legal. Pure.
 */
export function checkShowdownLineup(lineup, ctx) {
  const problems = [];
  const { board } = ctx;
  const cap = Math.min(SHOWDOWN_CAP, num(ctx.cap) ?? SHOWDOWN_CAP); // never above DraftKings' $50,000 (Adam 2026-10-18)
  const locks = ctx.locks ?? new Set();
  const includes = ctx.includes ?? new Set();
  const slots = Array.isArray(lineup?.slots) ? lineup.slots : [];
  if (slots.length !== SHOWDOWN_SLOTS.length) problems.push(`the lineup has ${slots.length} men, not ${SHOWDOWN_SLOTS.length}`);
  if (slots.filter((s) => s.slot === "CPT").length !== 1) problems.push("the lineup does not have exactly one Captain");
  if (slots.filter((s) => s.slot === "FLEX").length !== SHOWDOWN_SLOTS.length - 1) problems.push(`the lineup does not have exactly ${SHOWDOWN_SLOTS.length - 1} FLEX`);
  const men = [];
  const seen = new Set();
  let salary = 0;
  let proj = 0;
  for (const s of slots) {
    const c = board.byCand.get(String(s.id));
    if (!c) {
      problems.push(`${s.id} is not a candidate on this board`);
      continue;
    }
    men.push(c);
    if ((s.slot === "CPT") !== (c.pos === "CPT")) problems.push(`${c.name} is in a ${s.slot} slot but his ${c.pos === "CPT" ? "Captain" : "FLEX"} row`);
    if (seen.has(c.personId)) problems.push(`${c.name} is in the lineup twice`);
    seen.add(c.personId);
    const row = board.rowOfPerson.get(c.personId);
    const price = c.pos === "CPT" ? row.cptSalary : row.salary;
    if (num(price) === null || c.salary !== price) problems.push(`${c.name}'s price is not the salary file's ${c.pos === "CPT" ? "Captain" : "FLEX"} price`);
    salary += num(c.salary) ?? 0;
    if (c.pos === "CPT") {
      const base = num(row.proj);
      if (base !== null && Math.abs(c.proj - base * CPT_MULTIPLIER) > 1e-9) problems.push(`${c.name}'s Captain points are not ${CPT_MULTIPLIER}x his projection`);
    }
    proj += num(c.proj) ?? 0;
    // Adam 2026-10-18 and D45: status never filters; a projection of 0 or less, or none, is never auto-rostered.
    if (!locks.has(c.id) && !includes.has(c.personId) && !(ctx.canRoster ?? rosterable)(c)) problems.push(`${c.name} has no projection above 0 or no price and is not locked`);
    if (board.excluded.has(c.id)) problems.push(`${c.name} is excluded`);
  }
  if (salary > cap) problems.push(`the lineup costs $${salary.toLocaleString("en-US")}, over the $${cap.toLocaleString("en-US")} cap`);
  if (lineup && num(lineup.salary) !== null && lineup.salary !== salary) problems.push(`the lineup reports $${lineup.salary} but its men cost $${salary}`);
  if (lineup && num(lineup.proj) !== null && Math.abs(lineup.proj - proj) > 0.011) problems.push(`the lineup reports ${lineup.proj} points but its men score ${round2(proj)}`);
  const perTeam = new Map();
  for (const c of men) perTeam.set(c.team, (perTeam.get(c.team) ?? 0) + 1);
  for (const team of board.teams) if (!perTeam.get(team)) problems.push(`the lineup has no one from ${team}`);
  for (const [team, n] of perTeam) if (n > (ctx.maxPerTeam ?? SHOWDOWN_MAX_FROM_TEAM)) problems.push(`the lineup has ${n} men from ${team}`);
  for (const id of locks) if (!slots.some((s) => String(s.id) === id)) problems.push(`the locked ${board.byCand.get(id)?.name ?? id} is missing`);
  for (const p of includes) if (!men.some((c) => c.personId === p)) problems.push(`the included ${board.rowOfPerson.get(p)?.name ?? p} is missing`);
  return problems;
}

/** One Max % or Min % setting ({"<id>": {pct}}) as a Map of candidate id -> {n, pct} for one role. The engine's own
 *  guard for callers that skip the route's checks (generate-request.js); classic multi.js keeps its own copy. */
function pctMap(given, role, count, toLineups, board, word, notes) {
  const out = new Map();
  for (const [rawId, raw] of Object.entries(given && typeof given === "object" && !Array.isArray(given) ? given : {})) {
    if (raw === undefined || raw === null) continue;
    const id = String(rawId).trim();
    const pct = raw && typeof raw === "object" ? num(raw.pct) : null;
    if (!id || pct === null || pct < 0 || pct > 100) {
      notes.push(`The ${role === "CPT" ? "Captain" : "FLEX"} ${word} exposure for player ${id} must be given as {pct} from 0 to 100; ${JSON.stringify(raw)} was ignored.`);
      continue;
    }
    const person = board.personOf.get(id);
    const row = person === undefined ? null : board.rowOfPerson.get(person);
    const candId = row ? (role === "CPT" ? (hasId(row.cptId) ? String(row.cptId) : null) : String(row.id)) : null;
    // A Captain-only row's id is his Captain id, so the candidate's own role must match the setting's.
    const cand = candId === null ? null : board.byCand.get(candId);
    if (!cand || (cand.pos === "CPT") !== (role === "CPT")) {
      notes.push(`The ${role === "CPT" ? "Captain" : "FLEX"} ${word} exposure for player ${id} was ignored: he has no ${role === "CPT" ? "Captain" : "FLEX"} row on this board.`);
      continue;
    }
    out.set(candId, { n: toLineups(pct, count), pct });
  }
  return out;
}

const roleWord = (c) => (c.pos === "CPT" ? "Captain" : "FLEX");

/** A figure build's projection total: null when any of the six men has no projection of his own (the "no projection"
 *  stand-in or none), never a partial sum (cash 2b fix, 2026-10-17). */
function projTotal(men) {
  const known = (c) => num(c.proj) !== null && (num(c.override?.proj) !== null || !(c.flags ?? []).includes("no projection"));
  return men.every(known) ? round2(men.reduce((a, c) => a + c.proj, 0)) : null;
}

/**
 * Makes `settings.count` showdown lineups.
 * @param {object[]} args.rows      the showdown board rows
 * @param {object}   args.settings  { count, minUnique, locks, includes (FLEX or Captain ids; each man in every lineup at
 *   either role, showdown-includes.js), excludes, cap, captainMaxExposure, captainMinExposure,
 *   flexMaxExposure, flexMinExposure (each {"<person id>": {pct}}), lineupRules (lineup-rules.js shape), notes (carried
 *   notes), maxPerTeam (3, 4 or 5; absent = 5), objective ("proj", "ceil" or "median"; anything else builds on projection),
 *   mode ("gpp" or absent, or "cash": showdown-cash.js, which ignores minUnique, the exposures, lineupRules and objective) }
 * @param {object[]} [args.existing] saved lineups of this showdown ({slots:[{slot, playerId}]}); they count for minimum
 *   unique only, never for the exposure caps (D74); never in cash
 * @param {string}   [args.boardMode] "twogun" or "current": the board's mode, which picks a cash build's basis (cash.js cashBasis)
 *   and names a locked man with no TwoGun projection in a TwoGun projection build (noTwoGunProjectionNote)
 * @param {object}   [args.limits]  { perLineup, batch } step budgets (tests)
 * @returns {{lineups: {slots: {slot, id, personId}[], salary, proj, bent?}[], exposure: {personId, cpt, flex}[], notes: string[],
 *   bends: {lineup, label}[], problems: {lineup, problems: string[]}[], ruleWarnings: string[], failed?: true}} Never throws.
 *   `problems` lists any lineup that broke a hard rule (checkShowdownLineup); the route refuses to serve one. `failed` marks
 *   a crash inside the engine (its note says what), which the route answers as a 500, never as zero lineups; a lineup that
 *   breaks a lineup rule is one. `ruleWarnings`: "Rule N never applies" sentences (lineup-rules.js ruleWarnings).
 */
export function generateShowdownLineups(args) {
  const notes = [...(Array.isArray(args?.settings?.notes) ? args.settings.notes : [])];
  try {
    return runMode(args ?? {}, notes);
  } catch (e) {
    warn("showdown lineup: generate failed", { error: e && e.message });
    notes.push(`Could not make lineups: ${e && e.message ? e.message : "unexpected error"}.`);
    return { lineups: [], exposure: [], notes, bends: [], problems: [], ruleWarnings: [], failed: true };
  }
}

/** GPP (mode absent or "gpp") runs as it always did; cash runs on showdown-cash.js' patched settings with no saved
 *  lineups (Adam 2026-10-17: no minimum unique in cash) and the result gains mode and basis; any other mode makes nothing. */
function runMode(args, notes) {
  const mode = args.settings && typeof args.settings === "object" ? args.settings.mode : undefined;
  if (mode === undefined || mode === null || mode === "gpp") return build(args, notes);
  const none = { lineups: [], exposure: [], notes, bends: [], problems: [], ruleWarnings: [] };
  if (mode !== "cash") {
    notes.push("mode must be cash or gpp");
    return none;
  }
  const c = showdownCashSettings(args.settings, args.rows, args.boardMode);
  if (c.fatal) {
    notes.push(c.fatal);
    return { ...none, mode: "cash", basis: null };
  }
  notes.push(...c.notes);
  return { ...build({ ...args, settings: c.settings, existing: [] }, notes), mode: "cash", basis: c.settings.objective };
}

function build({ rows, settings, existing, limits, boardMode }, notes) {
  const s = settings && typeof settings === "object" ? settings : {};
  let ruleWarnings = [];
  const none = () => ({ lineups: [], exposure: [], notes, bends: [], problems: [], ruleWarnings });
  if (!Array.isArray(rows) || rows.length === 0) {
    notes.push("No player rows were supplied, so there is nothing to build lineups from.");
    return none();
  }
  const board = showdownBoard(rows, s.excludes);
  if (board.teams.length !== 2) {
    notes.push(`A showdown has two teams; this board has ${board.teams.length}, so no lineups were made.`);
    return none();
  }
  const maxPerTeam = s.maxPerTeam ?? SHOWDOWN_MAX_FROM_TEAM;
  if (!maxPerTeamOk(maxPerTeam)) {
    notes.push(`${MAX_PER_TEAM_SENTENCE} No lineups were made.`);
    return none();
  }
  const objective = Object.hasOwn(FIGURE_BUILDS, s.objective) ? s.objective : "proj";
  if (objective !== "proj" && !rows.some((r) => figureOf(r, objective) !== null)) {
    notes.push(objective === "ceil" ? NO_CEILING_SENTENCE : NO_MEDIAN_GPP_SENTENCE); // cash never gets here without a median (showdown-cash.js)
    return none();
  }
  const cap = Math.min(SHOWDOWN_CAP, num(s.cap) ?? SHOWDOWN_CAP); // a lower cap is a test's; never above $50,000
  let count = num(s.count) === null ? 1 : Math.trunc(s.count);
  if (count < 1 || count > MAX_LINEUPS) {
    const clamped = Math.min(MAX_LINEUPS, Math.max(1, count));
    notes.push(`${count} lineups were asked for; the Optimizer makes between 1 and ${MAX_LINEUPS}, so it made up to ${clamped}.`);
    count = clamped;
  }
  let minUnique = num(s.minUnique) === null ? 1 : Math.trunc(s.minUnique);
  if (minUnique < 1 || minUnique > MAX_UNIQUE) {
    const clamped = Math.min(MAX_UNIQUE, Math.max(1, minUnique));
    notes.push(`Minimum unique players must be between 1 and ${MAX_UNIQUE}; ${clamped} was used.`);
    minUnique = clamped;
  }

  // Locks (candidate ids: a FLEX id is his FLEX lock, a Captain id his Captain lock) must make a legal start.
  const locks = idList(s.locks);
  const lockSet = new Set(locks);
  for (const id of locks) {
    const c = board.byCand.get(id);
    if (!c) {
      notes.push(`The lock ${id} is not a player on this board, so no lineups were made.`);
      return none();
    }
    if (board.excluded.has(id) || num(c.salary) === null) {
      notes.push(`${c.name} is locked${board.excluded.has(id) ? " and excluded" : " but has no price"}, so no lineups were made.`);
      return none();
    }
  }
  const lockedCpt = locks.filter((id) => board.byCand.get(id).pos === "CPT");
  const lockedFlex = locks.filter((id) => board.byCand.get(id).pos !== "CPT");
  const lockedPeople = locks.map((id) => board.byCand.get(id).personId);
  if (lockedCpt.length > 1 || lockedFlex.length > 5 || new Set(lockedPeople).size !== lockedPeople.length) {
    notes.push(lockedCpt.length > 1 ? "Two Captains are locked, so no lineups were made."
      : lockedFlex.length > 5 ? "Six FLEX are locked, so no lineups were made."
        : "A player is locked as both Captain and FLEX, so no lineups were made.");
    return none();
  }
  const teamBreak = lockedTeamBreak(locks.map((id) => board.byCand.get(id).team), maxPerTeam);
  if (teamBreak) {
    notes.push(`${teamBreak} No lineups were made.`);
    return none();
  }

  // Max % rounds up and Min % rounds down (D74, Adam 2026-10-17), Captain and FLEX each counted alone (Adam 2026-10-18).
  const maxes = new Map([
    ...pctMap(s.captainMaxExposure, "CPT", count, pctToLineups, board, "maximum", notes),
    ...pctMap(s.flexMaxExposure, "FLEX", count, pctToLineups, board, "maximum", notes)
  ]);
  const mins = new Map([
    ...pctMap(s.captainMinExposure, "CPT", count, minLineups, board, "minimum", notes),
    ...pctMap(s.flexMinExposure, "FLEX", count, minLineups, board, "minimum", notes)
  ]);
  const lockedCapped = locks.filter((id) => maxes.has(id) && maxes.get(id).n < count);
  if (lockedCapped.length) {
    for (const id of lockedCapped) {
      const c = board.byCand.get(id);
      notes.push(`Locked ${c.name} is capped at ${maxes.get(id).n} of ${count} lineups as ${roleWord(c)} (${maxes.get(id).pct}%); unlock him or raise his Max %.`);
    }
    return none();
  }
  // Includes (Adam 2026-10-19): each man in every lineup at Captain or FLEX, never bent; the route refuses these
  // first (generate-request.js), with the same sentences (showdown-includes.js readIncludes).
  const inc = readIncludes(idList(s.includes), board, { locks, maxPerTeam, count, maxOf: roleMax(board, maxes) });
  if (inc.error) {
    notes.push(`${inc.error} No lineups were made.`);
    return none();
  }
  const includeSet = new Set(inc.people);
  const includeNames = inc.people.map((p) => board.rowOfPerson.get(p).name);
  const canRoster = rosterTest(board, objective);
  // The engine's own check of the lineup rules (the route refuses these first, generate-request.js), D81, judged by
  // this build's own pool (canRoster, the included men let in as the locked are), as the route judges them.
  const ruleSet = readShowdownRules(s.lineupRules, board, locks, withIncludes(canRoster, includeSet));
  if (ruleSet.error) {
    notes.push(`${ruleSet.error} No lineups were made.`);
    return none();
  }
  ruleWarnings = ruleSet.warnings;
  const ruleGate = ruleSet.active ? searchGate(ruleSet.rules) : null;

  const pool = buildPool(board, lockSet, objective, notes, boardMode, includeSet);
  const poolIds = new Set(pool.map((c) => c.id));

  // Saved lineups, as man-and-slot pairs.
  const priors = [];
  let unknown = 0;
  for (const item of Array.isArray(existing) ? existing : []) {
    const list = Array.isArray(item?.slots) ? item.slots : [];
    if (!list.length) continue;
    const keys = new Set();
    for (const sl of list) {
      const person = board.personOf.get(String(sl?.playerId));
      if (person === undefined) unknown++;
      else keys.add(slotKey(String(sl.slot ?? "").trim().toUpperCase(), person));
    }
    priors.push(keys);
  }
  if (unknown) notes.push(`${unknown} player${unknown === 1 ? "" : "s"} in the saved lineups ${unknown === 1 ? "is" : "are"} not on this board; ${unknown === 1 ? "it does" : "they do"} not count for uniqueness.`);
  const savedCount = priors.length;
  const keyOf = (c) => slotKey(c.pos, c.personId);

  // The Min % plan: each Captain or FLEX Min that reaches a lineup (a Min under one lineup forces nothing).
  const plan = [];
  for (const [id, { n, pct }] of mins) {
    const c = board.byCand.get(id);
    if (pct <= 0) continue;
    if (n === 0) {
      notes.push(`${c.name}'s ${roleWord(c)} Min % of ${pct} is under one lineup of ${count}, so it forces nothing.`);
      continue;
    }
    if (lockSet.has(id)) continue; // a locked man is in every lineup already
    const room = maxes.has(id) ? maxes.get(id).n : count;
    const entry = { key: id, id, name: `${c.name} (${roleWord(c)})`, pct, asked: n, n: Math.min(n, room), why: null, out: null, pos: c.pos };
    if (n > room) entry.why = `his ${roleWord(c)} Max % allows only ${room}`;
    if (!poolIds.has(id)) entry.out = `${outReason(c, board.rowOfPerson.get(c.personId), objective)}${board.excluded.has(id) ? "" : ", so he is not rostered unless locked"}`;
    plan.push(entry);
  }
  plan.sort((a, b) => cmpId(a.id, b.id));

  const budget = { used: 0, perLineup: num(limits?.perLineup) ?? PER_LINEUP_STEPS, batch: num(limits?.batch) ?? BATCH_STEPS };
  const counts = new Map(); // candidate id -> lineups of this batch (Captain and FLEX rows are separate candidates)
  const bentKeys = new Set();
  const bentOut = new Set();
  const easedUntil = new Map();
  const lineups = [];
  const bends = [];
  const problems = [];
  let anyAborted = false;
  const madeBefore = () => (lineups.length ? `The ${lineups.length} made before it are returned.` : "No lineups were made.");

  const capped = (c) => maxes.has(c.id) && !lockSet.has(c.id) && (counts.get(c.id) ?? 0) >= maxes.get(c.id).n;
  // Every solve, bends included, carries the lineup rules and the includes: they never bend (D81; Adam 2026-10-19).
  // `noRules` and `noIncludes` are the diagnoses only.
  const solve = ({ capsOff = new Set(), forced = [], uniq = minUnique, noRules = false, noIncludes = false, steer = new Set() }) => {
    const stats = {};
    const search = pool.filter((c) => (!capped(c) || capsOff.has(c.id)) && !steer.has(c.id)); // steer: captainSteer's look-ahead
    const best = exactSearch(search, {
      lockIds: [...locks, ...forced],
      cap,
      maxFromTeam: maxPerTeam,
      overlap: priors.length ? { priors, max: MAX_UNIQUE - uniq, keyOf } : null,
      maxSteps: Math.max(0, Math.min(budget.perLineup, budget.batch - budget.used)),
      stats,
      ruleGate: noRules ? null : ruleGate,
      includePeople: noIncludes ? null : includeSet
    });
    budget.used += stats.steps ?? 0;
    return { best, aborted: Boolean(stats.aborted) };
  };
  // The rules ran out: nothing keeps them with every Max, Min and uniqueness eased, though something would without them.
  const rulesExhausted = () => {
    if (!ruleGate) return false;
    const all = new Set(pool.map((c) => c.id));
    const kept = solve({ capsOff: all, uniq: 1 });
    if (kept.best || kept.aborted) return false;
    return Boolean(solve({ capsOff: all, uniq: 1, noRules: true }).best);
  };
  // The includes ran out, as the rules do above: nothing holds them with every Max, Min and uniqueness eased, though
  // something would without them.
  const includesExhausted = () => {
    if (!includeSet.size) return false;
    const all = new Set(pool.map((c) => c.id));
    const kept = solve({ capsOff: all, uniq: 1 });
    if (kept.best || kept.aborted) return false;
    return Boolean(solve({ capsOff: all, uniq: 1, noIncludes: true }).best);
  };

  // The Min men due in lineup `index`, neediest first: behind pace or out of slack (soft.js mustAppear), at most one
  // Captain and only as many FLEX as the locks leave, nobody whose other row is already in, and no Captain row the
  // includes' look-ahead leaves out of this lineup (`steer`, captainSteer: the included men need that spot).
  const dueFor = (index, steer) => {
    const left = count - index;
    const byKey = [...plan].sort((a, b) => cmpId(a.key, b.key));
    const open = [];
    for (const p of plan) {
      const had = counts.get(p.id) ?? 0;
      if (p.out || had >= p.n || !poolIds.has(p.id) || capped(board.byCand.get(p.id)) || steer.has(p.id)) continue;
      open.push({ p, had, slack: left - (p.n - had) });
    }
    open.sort((a, b) => a.slack - b.slack || cmpId(a.p.id, b.p.id));
    const forced = [];
    const people = new Set(lockedPeople);
    const taken = new Set([...lockedPeople, ...includeSet]); // the spots the locks and includes already fill
    let cpt = lockedCpt.length;
    let flex = lockedFlex.length;
    for (const o of open) {
      const phase = (byKey.indexOf(o.p) / plan.length) * (1 - o.p.n / count);
      const eased = (easedUntil.get(o.p.id) ?? -1) >= index && o.slack > 0;
      const due = o.slack <= 0 || mustAppear(o.had, index, o.p.n, count, phase);
      if (!due || eased || (o.slack < 0 && bentOut.has(o.p.id))) continue;
      const c = board.byCand.get(o.p.id);
      if (people.has(c.personId) || (c.pos === "CPT" ? cpt >= 1 : flex >= 5)) continue;
      // An included man's Min pins his role; anyone else needs a spot the locks and includes have left.
      if (includeSet.size && !includeSet.has(c.personId) && taken.size >= SHOWDOWN_SLOTS.length) continue;
      taken.add(c.personId);
      people.add(c.personId);
      if (c.pos === "CPT") cpt++;
      else flex++;
      forced.push(o.p.id);
    }
    return forced;
  };

  for (let n = 0; n < count; n++) {
    if (budget.used >= budget.batch) {
      notes.push(`The search hit its step limit of ${budget.batch.toLocaleString("en-US")} for the whole request while making lineup ${n + 1} of ${count}; ${lineups.length ? `the ${lineups.length} made before it are returned` : "no lineups were made"}.`);
      break;
    }
    const steer = captainSteer({ people: includeSet, board, pool, poolIds, maxes, counts, left: count - n, captainLocked: lockedCpt.length > 0 });
    const forced = dueFor(n, steer);
    for (const id of forced) bentKeys.delete(id);
    // Bend, least change first (BEND_ORDER); the first setting that lets a lineup through is the one relaxed. Every
    // trial runs under `st`, the includes' look-ahead or none: steered bends come before the plain solve (solveSteered).
    const bend = (st) => {
      const blocking = pool.filter((c) => capped(c) && !st.has(c.id)); // a row the steer leaves out cannot help this trial
      const trials = {
        minForce: () => forced.length
          ? Array.from({ length: forced.length }, (_, i) => forced.length - 1 - i).map((k) => ({
            label: `the Min % on ${listNames(forced.slice(k).map((id) => board.byCand.get(id).name))}`,
            run: () => solve({ forced: forced.slice(0, k), steer: st }),
            drop: forced.slice(k)
          })) : [],
        playerMax: () => (blocking.length > 6
          ? [{ label: "the players' Max % settings", run: () => solve({ forced, capsOff: new Set(blocking.map((c) => c.id)), steer: st }) }]
          : blocking.map((c) => ({
            label: `the ${roleWord(c)} Max % of ${maxes.get(c.id).pct}% on ${c.name}`,
            run: () => solve({ forced, capsOff: new Set([c.id]), steer: st })
          }))),
        minUnique: () => (priors.length && minUnique > 1
          ? Array.from({ length: minUnique - 1 }, (_, i) => minUnique - 1 - i).map((k) => ({
            label: `minimum unique players (${minUnique}, lowered to ${k} for this lineup)`,
            run: () => solve({ forced, uniq: k, steer: st })
          })) : [])
      };
      for (const kind of BEND_ORDER) {
        for (const t of trials[kind]()) {
          if (budget.used >= budget.batch) return { result: { best: null, aborted: false }, bent: null, dropped: [] };
          const r = t.run();
          if (r.best) return { result: r, bent: t.label, dropped: t.drop ?? [] };
          if (r.aborted) return { result: r, bent: null, dropped: [] };
        }
      }
      return null;
    };
    const { result, bent, dropped } = solveSteered(solve, forced, steer, bend);
    if (!result.best) {
      if (result.aborted || budget.used >= budget.batch) {
        notes.push(`Lineup ${n + 1} of ${count} could not be made: the search stopped at its step limit without finding one. ${madeBefore()}`);
      } else if (rulesExhausted()) {
        notes.push(rulesShortNote({ made: lineups.length, count, saved: savedCount > 0, cap, rules: ruleSet.rules, nameOf: ruleSet.nameOf }));
      } else if (s.mode === "cash") {
        notes.push(cashRanOutNote(lineups.length, cap, includeNames)); // cash turns off Min %, Max % and minimum unique, so they are not named
      } else if (includesExhausted()) {
        const earlier = lineups.length || savedCount ? ", apart from the lineups before it" : "";
        notes.push(`Lineup ${n + 1} of ${count} could not be made: ${noIncludeFitSentence(includeNames, cap, { rules: Boolean(ruleGate) })}${earlier}. ${madeBefore()}`);
      } else {
        notes.push(`No single setting could be bent for lineup ${n + 1} of ${count}: no lineup keeps every setting, and relaxing any one of the Min %, the Max % or the minimum unique alone would not allow one (the locks${includeSet.size ? ", the includes" : ""}, the $${cap.toLocaleString("en-US")} cap, the DraftKings rules${ruleGate ? ", the lineup rules" : ""} and the earlier lineups leave nothing legal). ${madeBefore()}`);
      }
      break;
    }
    if (result.aborted) anyAborted = true;
    // A dropped Min man waits two lineups unless he is out of slack (soft.js's rule for the classic Min %).
    for (const id of dropped) {
      bentOut.add(id);
      bentKeys.add(id);
      easedUntil.set(id, n + 2);
    }
    const flexMen = result.best.filter((c) => c.pos !== "CPT")
      .sort((a, b) => b.score - a.score || a.salary - b.salary || cmpId(a.id, b.id));
    const men = [result.best.find((c) => c.pos === "CPT"), ...flexMen];
    const lineup = {
      slots: men.map((c) => ({ slot: c.pos === "CPT" ? "CPT" : "FLEX", id: c.id, personId: c.personId })),
      salary: men.reduce((a, c) => a + c.salary, 0),
      proj: objective === "proj" ? round2(men.reduce((a, c) => a + c.score, 0)) : projTotal(men)
    };
    if (objective !== "proj") lineup[objective] = round2(men.reduce((a, c) => a + c.score, 0)); // the build's own total (ceil or median)
    if (bent !== null) {
      lineup.bent = bent;
      bends.push({ lineup: n + 1, label: bent });
    }
    const broken = checkShowdownLineup(lineup, { board, cap, locks: lockSet, maxPerTeam, canRoster, includes: includeSet });
    if (broken.length) problems.push({ lineup: n + 1, problems: broken });
    assertKeepsRules(lineup, n + 1, ruleSet.rules, ruleSet.nameOf);
    priors.push(new Set(men.map(keyOf)));
    for (const c of men) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    lineups.push(lineup);
  }
  if (anyAborted) notes.push("The search hit its step limit on at least one lineup, so that lineup may not be the very best available.");
  notes.push(...unmetMinNotes(plan, counts, { complete: lineups.length === count, bentKeys, waits: new Map() }));
  const named = (map) => [...map].map(([id, { pct }]) => ({ name: `${board.byCand.get(id).name} (${roleWord(board.byCand.get(id))})`, pct }));
  const short = percentNote({}, named(maxes), named(mins), count, lineups.length);
  if (short) notes.push(short);
  return { lineups, exposure: exposureOf(lineups), notes, bends, problems, ruleWarnings };
}

/** Per man, how many lineups of this batch held him as Captain and how many as FLEX: two figures, never summed (Adam
 *  2026-10-18). Most Captain lineups first, then most FLEX, then id. */
export function exposureOf(lineups) {
  const byPerson = new Map();
  for (const l of lineups) {
    for (const sl of l.slots) {
      const e = byPerson.get(sl.personId) ?? { personId: sl.personId, cpt: 0, flex: 0 };
      if (sl.slot === "CPT") e.cpt++;
      else e.flex++;
      byPerson.set(sl.personId, e);
    }
  }
  return [...byPerson.values()].sort((a, b) => b.cpt - a.cpt || b.flex - a.flex || cmpId(a.personId, b.personId));
}
