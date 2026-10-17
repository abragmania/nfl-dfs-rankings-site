// The Optimizer's engine (PROJECT.md Part 4 "Optimizer"; DECISIONS.md D55 as amended 2026-10-10, D73, D74): N DraftKings
// classic lineups, one at a time, each the best lineup by projection or, when Adam picks it, by TwoGun's published ceiling
// (D25 as amended 2026-10-15; scoring only, see objectiveScore) that keeps every rule Adam has switched on,
// every lock, the uniqueness he set against his saved lineups and every earlier lineup of the batch, and the
// per-position exposure caps as they stand at that moment (counted over this batch only, D74). It is a pure function over board rows: no network, no
// clock, no file writes. The single-lineup builder (optimize.js) is separate and unchanged.
//
// Search: exact depth-first branch and bound, deterministic, no dependencies. A lineup is enumerated as one of the
// three position mixes the FLEX allows (3 RB, 4 WR or 2 TE), group by group (QB, RB, WR, TE, DST), each group a
// combination in projection order, so no lineup is visited twice. The bound for the unfilled part of a lineup is a
// per-position 0/1 knapsack (best projection for k players of a position within a salary budget), combined across
// the remaining positions; it ignores the team rules, so it is always an upper bound. Before each lineup, players
// that are dominated (dearer and lower projected than enough others that one of them can always replace them
// without breaking a rule) are trimmed; the safety argument is at trimPosition() and a test proves it.
//
// Lineups are ranked by total projection, then by lower salary, then by the sorted player ids, so ties are settled
// the same way on every machine. Projections are compared as integers (millionths of a point) so float rounding
// never decides anything.
import { rowIsOut } from "../rank/sidelined.js"; // pure: the public site runs this engine in the browser (D69)
import { assignSlots } from "./dk-entries.js";
import { warn } from "../lib/log.js";
import { retiredObjectiveNote } from "./optimize.js"; // pure: the site copies the engine (D69); one copy of the note
import {
  parseEntries, qbStackPrepare, globalRule, ruleFromEntry, mustPlan, withReachable, stackTrials, setsTeammates, setsOpponents, cappedMustNotes
} from "./qb-stacks.js"; // pure; per-QB stack settings
import {
  MAX_AT, CONFIGS, listNames, slotsFull, lockedSlotWords, minPlan, forcedSet, lowestScoreFirst, trialOrder, chooseBend, bendLabel, settleBend,
  bendTrials, diagnosisSentence, percentNote, unmetMinNotes
} from "./soft.js"; // pure; Min % and soft rules

// --------------------------------------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------------------------------------

const POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "DST"]);
const SLOT_COUNT = 9;
const GROUP_ORDER = Object.freeze(["QB", "RB", "WR", "TE", "DST"]);
const DEFAULT_CAP = 50000; // D1; optimize.js uses the same default and the board carries no cap of its own
const MAX_LINEUPS = 150;
const SCORE_SCALE = 1e6;
const MAX_UNITS = 2000; // salary resolution of the knapsack bound
// A counter, never a clock, so two runs on the same input always agree; a real board needs a few hundred thousand.
const NODE_LIMIT = 40000000;
const DIAG_NODE_LIMIT = 3000000;
const BATCH_NODE_LIMIT = 200000000; // the whole request, so 150 slow lineups can never run away

/** Adam's D55 rules, each a toggle, all on unless he switches one off (the QB stack is stackOwn / stackOpp, D73). */
export const RULE_KEYS = Object.freeze([
  "starredQbOnly",
  "noSameTeamRbs",
  "noSameGameRbs",
  "noDstVsOwnPlayers"
]);

/** Rule keys an older saved request may still carry (D73): qbStack means "1 or more teammates" (true) or "0 or more"
 *  (false) unless stackOwn is given; oneOffensivePerOtherTeam and rbWithOwnQbOnlyIfCatcher (D55 amended 2026-10-17) are ignored. */
export const LEGACY_RULE_KEYS = Object.freeze(["qbStack", "oneOffensivePerOtherTeam", "rbWithOwnQbOnlyIfCatcher"]);

/** What the lineups maximise: "proj" (projection, as optimize.js scores it) or "ceil" (TwoGun's published ceiling,
 *  row.tg.ceil, D25 as amended 2026-10-15), refused on a board without ceilings. The retired "lev" and "projMinusOwn"
 *  are built on projection with optimize.js retiredObjectiveNote's note. */
export const OBJECTIVES = Object.freeze(["proj", "ceil"]);

/** The refusal when a ceiling build is asked of a board with no TwoGun ceiling on any row. */
export const NO_CEILING_SENTENCE = "This board has no TwoGun ceilings (current mode, or no TwoGun board could be read), so lineups cannot be built by ceiling; build by projection.";

/** D73: the most teammates and opponents the QB stack can ask for, and the defaults (1 or more, 0 or more). */
export const STACK_OWN_MAX = 4;
export const STACK_OPP_MAX = 3;
/** D55 as amended 2026-10-17: every running back, receiver and tight end counts toward his quarterback's stack. */
export const countsTowardStack = (pos) => pos === "RB" || pos === "WR" || pos === "TE";
const STACK_OWN_DEFAULT = 1;
const STACK_OPP_DEFAULT = 0;

const RULE_LABELS = Object.freeze({
  starredQbOnly: "only starred quarterbacks",
  noSameTeamRbs: "no two running backs from the same team",
  noSameGameRbs: "no two running backs from the same game",
  noDstVsOwnPlayers: "no defense facing a player in the same lineup"
});

/** D73 in plain words: "exactly 2 teammates" / "1 or more opponents". */
function stackWords(n, orMore, one, many) {
  return `${orMore ? "" : "exactly "}${n}${orMore ? " or more" : ""} ${n === 1 && !orMore ? one : many}`;
}

// --------------------------------------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------------------------------------

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const upper = (v) => (v === null || v === undefined ? "" : String(v).trim().toUpperCase());

function idList(value) {
  if (value === null || value === undefined) return [];
  const arr = Array.isArray(value) ? value : value instanceof Set ? [...value] : [value];
  const out = [];
  for (const item of arr) {
    if (item === null || item === undefined) continue;
    const id = typeof item === "object" ? item.id ?? item.playerId : item;
    if (id === null || id === undefined) continue;
    const key = String(id).trim();
    if (key !== "" && !out.includes(key)) out.push(key);
  }
  return out;
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** The ids of one saved lineup, whatever shape it arrives in: an array of ids or of {id}/{playerId}, or an object
 *  with `ids`, `lineup`, `players` or `slots` (the saved-lineups store keeps `slots: [{slot, playerId, ...}]`). */
function idsOfExisting(item) {
  if (Array.isArray(item)) return idList(item);
  if (item && typeof item === "object") {
    for (const field of ["ids", "lineup", "players", "slots"]) {
      if (Array.isArray(item[field])) return idList(item[field]);
    }
  }
  return [];
}

/** The key that decides "the same DraftKings player" (optimize.js dkKeyOf): two board rows can share a DK id. */
export function dkKeyOf(row, id) {
  const raw = row.dkId === null || row.dkId === undefined ? "" : String(row.dkId).trim();
  return raw ? `dk:${raw}` : `id:${id}`;
}

function rowPos(row) {
  const pos = upper(row.pos);
  if (POSITIONS.includes(pos)) return pos;
  const list = Array.isArray(row.rosterPositions) ? row.rosterPositions.map(upper).filter((p) => p && p !== "FLEX") : [];
  return list.find((p) => POSITIONS.includes(p)) ?? null;
}

/** True when any quarterback row is starred (D55: with none starred or locked, the Optimizer asks for one). */
function anyStarredQb(rows) {
  return rows.some((row) => row && typeof row === "object" && row.starred && rowPos(row) === "QB");
}

// --------------------------------------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------------------------------------

function normaliseSettings(settings, slate, existingCount, notes) {
  const s = settings && typeof settings === "object" ? settings : {};
  const cap = num(s.cap) ?? num(slate && slate.cap) ?? num(slate && slate.salaryCap) ?? DEFAULT_CAP;

  let count = num(s.count) === null ? 1 : Math.trunc(s.count);
  if (count < 1 || count > MAX_LINEUPS) {
    const clamped = Math.min(MAX_LINEUPS, Math.max(1, count));
    notes.push(`${count} lineups were asked for; the Optimizer makes between 1 and ${MAX_LINEUPS}, so it made up to ${clamped}.`);
    count = clamped;
  }

  let minUnique = num(s.minUnique) === null ? 1 : Math.trunc(s.minUnique);
  if (minUnique < 1 || minUnique > SLOT_COUNT) {
    const clamped = Math.min(SLOT_COUNT, Math.max(1, minUnique));
    notes.push(`Minimum unique players must be between 1 and ${SLOT_COUNT}; ${clamped} was used.`);
    minUnique = clamped;
  }

  const rules = {};
  const given = s.rules && typeof s.rules === "object" ? s.rules : {};
  for (const key of RULE_KEYS) rules[key] = given[key] === undefined ? true : Boolean(given[key]);

  // D73 QB stack: exactly N teammates and O opponents when "or more" is unticked (ticked by default); an older
  // request's rules.qbStack, without stackOwn, becomes "1 or more" (true) or "0 or more" (false) teammates.
  const legacyStack = given.qbStack !== undefined && num(s.stackOwn) === null;
  const orMore = (v) => (v === undefined || v === null ? true : Boolean(v));
  const stackOwn = legacyStack ? (given.qbStack ? 1 : 0) : stackNumber(s.stackOwn, STACK_OWN_DEFAULT, STACK_OWN_MAX, "teammates", notes);
  const stackOpp = stackNumber(s.stackOpp, STACK_OPP_DEFAULT, STACK_OPP_MAX, "opponents", notes);
  const stackOwnOrMore = legacyStack ? true : orMore(s.stackOwnOrMore);
  const stackOppOrMore = orMore(s.stackOppOrMore);

  // The objective: projection or TwoGun's ceiling; a retired one is built on projection with a note, never refused.
  let fatal = null;
  const asked = s.objective === undefined || s.objective === null ? "proj" : String(s.objective);
  const retiredNote = retiredObjectiveNote(asked);
  if (retiredNote) notes.push(retiredNote);
  const objective = retiredNote ? "proj" : asked;
  if (!OBJECTIVES.includes(objective)) {
    fatal = `The objective "${objective}" is not one the Optimizer knows; use Projection or Ceiling.`;
  }

  // Exposure: {pct} of this batch rounded up to whole lineups (0% is never) or {count}; saved lineups never count
  // toward a cap (D74). Anything else is ignored with a note (the route refuses it); nothing set means no cap.
  const totalLineups = count;
  const capCount = {};
  const capLabel = {};
  const capPct = {};
  const given2 = s.maxExposure && typeof s.maxExposure === "object" ? s.maxExposure : {};
  for (const pos of POSITIONS) {
    const raw = given2[pos];
    if (raw === undefined || raw === null || raw === "") continue;
    const isObj = typeof raw === "object" && !Array.isArray(raw);
    let n = null;
    let label = "";
    if (isObj && num(raw.count) !== null && raw.count >= 0) {
      n = Math.floor(raw.count);
      label = `${n} lineup${n === 1 ? "" : "s"}`;
    } else if (isObj && num(raw.pct) !== null && raw.pct >= 0) {
      n = pctToLineups(raw.pct, totalLineups);
      label = `${raw.pct}%`;
      capPct[pos] = raw.pct;
    } else {
      notes.push(`The ${pos} maximum exposure must be given as {pct} or {count}; ${JSON.stringify(raw)} was ignored, so ${pos} has no cap.`);
      continue;
    }
    capCount[pos] = n;
    capLabel[pos] = label;
  }

  // Per-player Max % and Min % (D74): {id: {pct}}, sized like the position caps, a Min rounded down; a malformed entry is
  // ignored with a note. A Min of 0 is none; one under a lineup forces nothing and is noted.
  const playerCap = playerPcts(s.playerMaxExposure, count, "maximum", notes); // id -> {n, pct}
  const mins = [...playerPcts(s.playerMinExposure, count, "minimum", notes, minLineups)].filter(([, m]) => m.pct > 0);
  const playerMin = new Map(mins.filter(([, m]) => m.n > 0));
  const minUnderOne = mins.filter(([, m]) => m.n === 0);

  const maxPerTeamRaw = num(s.maxPerTeam);
  const maxPerTeam = maxPerTeamRaw !== null && maxPerTeamRaw >= 1 ? Math.trunc(maxPerTeamRaw) : null;

  return {
    cap,
    count,
    minUnique,
    rules,
    capCount,
    capLabel,
    capPct,
    playerCap,
    playerMin,
    minUnderOne,
    existingCount,
    maxPerTeam,
    stackOwn,
    stackOwnOrMore,
    stackOpp,
    stackOppOrMore,
    qbStacks: parseEntries(s.qbStacks, STACK_OWN_MAX, STACK_OPP_MAX, notes),
    spreadDst: spreadFlag(s.spreadDst, notes),
    objective,
    fatal,
    locks: idList(s.locks),
    excludes: new Set(idList(s.excludes)),
    allowRbGames: new Set(idList(s.allowRbGames).map(upper)),
    avoidGames: new Set(idList(s.avoidGames).map(upper)),
    noTrim: Boolean(s._noTrim),
    nodeLimit: num(s._nodeLimit) ?? NODE_LIMIT,
    batchNodeLimit: num(s._batchNodeLimit) ?? BATCH_NODE_LIMIT,
    diagNodeLimit: num(s._diagNodeLimit) ?? DIAG_NODE_LIMIT,
    stats: s._stats && typeof s._stats === "object" ? s._stats : null
  };
}

/** A percent of the batch as whole lineups, rounded up (50% of 5 is 3); 0% is 0. The epsilon keeps 20% of 5 at 1. */
export function pctToLineups(pct, count) {
  if (!(pct > 0)) return 0;
  return Math.ceil((pct / 100) * count - 1e-9);
}

/** D74 and PROJECT.md Part 4 Optimizer: a Min % as whole lineups, rounded DOWN for flexibility (Adam 2026-10-17): 40% of 3 is 1. */
export function minLineups(pct, count) {
  if (!(pct > 0)) return 0;
  return Math.floor((pct / 100) * count + 1e-9);
}

function playerPcts(given, count, word, notes, toLineups = pctToLineups) {
  const out = new Map();
  for (const [rawId, raw] of Object.entries(given && typeof given === "object" ? given : {})) {
    if (raw === undefined || raw === null) continue;
    const id = String(rawId).trim();
    const pct = typeof raw === "object" ? num(raw.pct) : null;
    if (!id || pct === null || pct < 0 || pct > 100) {
      notes.push(`The ${word} exposure for player ${id} must be given as {pct} from 0 to 100; ${JSON.stringify(raw)} was ignored.`);
      continue;
    }
    out.set(id, { n: toLineups(pct, count), pct });
  }
  return out;
}

function spreadFlag(value, notes) {
  if (value === undefined || value === null || value === false) return false;
  if (value === true) return true;
  notes.push(`Spread defenses must be true or false; ${JSON.stringify(value)} was ignored.`);
  return false;
}

/** A stack count from the settings: a whole number from 0 to `max`; absent means `fallback`; anything else is
 *  clamped with a note (the request checks refuse it before it gets here). */
function stackNumber(value, fallback, max, what, notes) {
  const n = num(value);
  if (value === undefined || value === null) return fallback;
  if (n === null) {
    notes.push(`The number of ${what} to stack with the quarterback must be a whole number; ${fallback} was used.`);
    return fallback;
  }
  const clamped = Math.min(max, Math.max(0, Math.trunc(n)));
  if (clamped !== n) notes.push(`The number of ${what} to stack with the quarterback must be a whole number from 0 to ${max}; ${clamped} was used.`);
  return clamped;
}

/** The score one candidate adds: his projection, or for "ceil" TwoGun's published ceiling (D25 as amended
 *  2026-10-15), 0 for a locked player without one, never an estimate; a typed projection never moves a ceiling. */
function objectiveScore(row, proj, objective) {
  return objective === "ceil" ? ceilingOf(row) ?? 0 : proj;
}

/** TwoGun's published ceiling for a board row (row.tg.ceil, TwoGun mode only), or null; 0 for an out row that has one
 *  (out = projection 0 and ceiling 0, Adam). Nothing else is read. */
export function ceilingOf(row) {
  const ceil = num(row && row.tg && row.tg.ceil);
  return ceil !== null && rowIsOut(row) ? 0 : ceil;
}

/** Ruled out after TwoGun's board stamp: out of every build unless locked. */
function outAfterStamp(flags) {
  return flags.includes("outAfterStamp") && !flags.includes("revived");
}

/** D73: the global stack as one rule; an inactive side ("0 or more") never binds. */
function stackRuleOf(opts) {
  const ownOn = ownStackActive(opts);
  const oppOn = oppStackActive(opts);
  return globalRule(
    ownOn ? opts.stackOwn : 0, ownOn && !opts.stackOwnOrMore ? opts.stackOwn : Infinity,
    oppOn ? opts.stackOpp : 0, oppOn && !opts.stackOppOrMore ? opts.stackOpp : Infinity
  );
}

function rowFlags(row, pos, opts) {
  const proj = num(row.proj);
  const flags = Array.isArray(row.flags) ? row.flags : [];
  const overridden = num(row.override && row.override.proj) !== null;
  const game = upper(row.gameId) || null;
  const ceil = ceilingOf(row);
  return {
    proj, overridden, game, ceil,
    noProjection: proj === null || (!overridden && flags.includes("no projection")),
    sidelined: rowIsOut(row),
    avoided: game !== null && opts.avoidGames.has(game),
    unstarredQb: opts.rules.starredQbOnly && pos === "QB" && !row.starred,
    noCeiling: opts.objective === "ceil" && ceil === null,
    lateOut: outAfterStamp(flags)
  };
}

/** A ceiling build's notes: how many were left out for want of a ceiling, and that typed projections do not move it. */
function ceilingNotes(leftOut, typed, notes) {
  if (leftOut > 0) {
    notes.push(`${leftOut} player${leftOut === 1 ? "" : "s"} with no TwoGun ceiling ${leftOut === 1 ? "was" : "were"} left out of this ceiling build.`);
  }
  if (typed > 0) {
    notes.push(`${typed} typed projection${typed === 1 ? "" : "s"} ${typed === 1 ? "does" : "do"} not change a ceiling build; it ranks by TwoGun's ceilings as he publishes them.`);
  }
}

/** D73: the stack constraints that bind at all ("0 or more" binds nothing). */
const ownStackActive = (opts) => !(opts.stackOwn === 0 && opts.stackOwnOrMore);
const oppStackActive = (opts) => !(opts.stackOpp === 0 && opts.stackOppOrMore);

// --------------------------------------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------------------------------------

/**
 * Make up to `settings.count` lineups.
 *
 * @param {object}   args
 * @param {object[]} args.rows      board rows (server/rank/board.js); overrides already merged (D28)
 * @param {object}   [args.slate]   the slate; `cap` or `salaryCap` is used when present, else $50,000 (D1)
 * @param {object}   [args.settings]
 *   locks, excludes: player ids. count: 1-150 (default 1). minUnique: 1-9 (default 1).
 *   maxExposure: {QB, RB, WR, TE, DST}, each {pct} (percent of the lineups asked for, rounded up) or {count}; per
 *     player, over this batch only, never the saved lineups (D74); default none. Any other form is ignored with a note.
 *   playerMaxExposure: {id: {pct}}, one player's own cap, sized and counted the same way; a locked player with a
 *     cap under 100% is refused (no lineups, a note).
 *   playerMinExposure: {id: {pct}}, rounded DOWN (minLineups; under one lineup forces nothing, with a note);
 *     soft.js forcedSet puts him in the lineups his pace needs
 *     (PROJECT.md Part 4 Optimizer (Min % and soft rules, Adam 2026-10-17)). No effect on a locked player.
 *   rules: {starredQbOnly, noSameTeamRbs, noSameGameRbs, noDstVsOwnPlayers}, each boolean, all true by default.
 *     Older keys qbStack, oneOffensivePerOtherTeam and rbWithOwnQbOnlyIfCatcher are accepted (LEGACY_RULE_KEYS).
 *   stackOwn (0-4, default 1), stackOwnOrMore (default true), stackOpp (0-3, default 0), stackOppOrMore (default
 *     true): D73, the lineup's quarterback with exactly (or, ticked, at least) that many offensive teammates
 *     and offensive players of the team he faces; never the defense.
 *   spreadDst (default false, Adam 2026-10-16): no defense in more than max(20% of count, count / usable DSTs) lineups.
 *   qbStacks (D73 amended 2026-10-17): per-QB entries; a side with either number set replaces the global side (qb-stacks.js).
 *   objective: "proj" (default) or "ceil" (TwoGun's ceiling, row.tg.ceil; refused with NO_CEILING_SENTENCE when no
 *     row carries one); the retired "lev" and "projMinusOwn" are built on projection with a note. Rows flagged
 *     "outAfterStamp" are left out of every build unless locked.
 *   allowRbGames, avoidGames: game keys as on the board (row.gameId, e.g. "DET@ARI").
 *   maxPerTeam: most players (defense included) from one team, as optimize.js maxFromTeam; default none. D76: it
 *     never limits the lineup quarterback's team or the team he faces, only every other team.
 *   Every running back, receiver and tight end counts toward the stack (D55 as amended 2026-10-17); catchers is ignored.
 * @param {Array}    [args.existing] Adam's saved lineups (arrays of ids, or objects with ids/lineup/players/slots);
 *   they count for minimum unique players only, never for the exposure caps (D74)
 * @returns {{lineups: Array<{ids: string[], salary: number, proj: number, ceil?: number|null, bent?: string}>, exposure: object, notes: string[], bends: Array<{lineup: number, label: string}>}}
 *   exposure is still reported over saved plus new lineups (the Optimizer tab computes its own per tab, D74).
 *   ids are in DraftKings slot order QB, RB, RB, WR, WR, WR, TE, FLEX, DST; proj is always the lineup's projection,
 *   whatever the objective. ceil (TwoGun's ceilings summed) is present only when some row carries one, and null when
 *   any player in the lineup lacks one; a board without ceilings gives exactly the output it always did. Never throws.
 */
export function generateLineups(args) {
  const notes = [];
  try {
    const { rows, slate, settings, existing } = args ?? {};
    return run(rows, slate, settings, existing, notes);
  } catch (e) {
    warn("lineup: generate failed", { error: e && e.message });
    notes.push(`Could not make lineups: ${e && e.message ? e.message : "unexpected error"}.`);
    return { lineups: [], exposure: emptyExposure(), notes, bends: [] };
  }
}

function emptyExposure() {
  const out = {};
  for (const pos of POSITIONS) out[pos] = [];
  return out;
}

function run(rows, slate, settings, existing, notes) {
  if (!Array.isArray(rows) || rows.length === 0) {
    notes.push("No player rows were supplied, so there is nothing to build lineups from.");
    return { lineups: [], exposure: emptyExposure(), notes, bends: [] };
  }
  const existingList = Array.isArray(existing) ? existing.map(idsOfExisting).filter((ids) => ids.length) : [];
  const opts = normaliseSettings(settings, slate, existingList.length, notes);
  if (opts.fatal) {
    notes.push(opts.fatal);
    return { lineups: [], exposure: emptyExposure(), notes, bends: [] };
  }

  const st = prepare(rows, opts, notes);
  if (st.fatal) {
    notes.push(st.fatal);
    return { lineups: [], exposure: exposureOf(st, existingList.map((ids) => ids.map((id) => st.keyOfId.get(id) ?? `id:${id}`)), opts), notes, bends: [] };
  }
  // A locked player is in every lineup, so a Max % allowing fewer than the count is refused, never broken (D74).
  const lockedCapped = opts.locks.filter((id) => opts.playerCap.has(id) && opts.playerCap.get(id).n < opts.count);
  if (lockedCapped.length) {
    for (const id of lockedCapped) {
      const name = st.byId.get(id)?.name ?? id;
      const { n, pct } = opts.playerCap.get(id);
      notes.push(`Locked ${name} is capped at ${n} of ${opts.count} lineups (${pct}%); unlock him or raise his Max %.`);
    }
    return { lineups: [], exposure: emptyExposure(), notes, bends: [] };
  }

  // Saved lineups, as DK keys (two board rows of one man count as one player).
  const prevKeys = existingList.map((ids) => ids.map((id) => st.keyOfId.get(id) ?? `id:${id}`));
  const unknown = new Set();
  for (const ids of existingList) for (const id of ids) if (!st.keyOfId.has(id)) unknown.add(id);
  if (unknown.size) {
    notes.push(`${unknown.size} player${unknown.size === 1 ? "" : "s"} in the saved lineups ${unknown.size === 1 ? "is" : "are"} not on this board; they still count for uniqueness but not for exposure by position.`);
  }

  const prev = makePrevIndex(st, prevKeys, opts.count);
  // D74: the caps count this batch only, so the counts start empty; saved lineups are in `prev` for uniqueness alone.
  const counts = new Map();

  // Locks above a position's exposure cap: the lock wins (every lineup must hold him), and Adam is told.
  for (const c of st.lockCands) {
    const capN = opts.capCount[c.pos];
    if (capN !== undefined && opts.count > capN) {
      notes.push(`${c.name} is locked, so he is in every new lineup even though that takes him past the ${c.pos} maximum exposure (${opts.capLabel[c.pos]}).`);
    }
  }

  // One step budget; the quarterback checks never take the half kept for the lineups — rules-repo review 2026-10-17 finding 4
  opts.budget = { used: 0, floor: Math.ceil(opts.batchNodeLimit / 2) };
  const mustNoted = entryQbChecks(rows, settings, slate, existingList.length, prevKeys, opts, st, notes);

  if (opts.stats) opts.stats.exactSalaryUnits = st.exact;
  // D74: a Min under one lineup forces nothing; one note per player on the board (twin rows are one man), and none when
  // another row of his DraftKings key has a Min that reaches a lineup (it forces him).
  const forcedKeys = new Set([...opts.playerMin.keys()].filter((id) => st.byId.has(id)).map((id) => st.keyOfId.get(id)));
  const underKeys = new Set(forcedKeys);
  for (const [id, { pct }] of opts.minUnderOne) {
    if (!st.byId.has(id) || underKeys.has(st.keyOfId.get(id))) continue;
    underKeys.add(st.keyOfId.get(id));
    notes.push(`${st.byId.get(id).name ?? id}'s Min % of ${pct} is under one lineup of ${opts.count}, so it forces nothing.`);
  }
  const plan = minPlan(minEntries(opts, st));
  const b = buildBatch({ rows, settings, slate, existingCount: existingList.length, prevKeys, prev, counts, opts, st, plan, notes, mustNoted });
  if (b.aborted && b.lineups.length) {
    notes.push(`The search hit its step limit on at least one lineup, so that lineup may not be the very best available.`);
  }
  notes.push(...unmetMinNotes(plan, counts, { complete: b.lineups.length === opts.count, bentKeys: b.bentKeys, waits: b.waits }));
  const named = (map) => [...map].map(([id, { pct }]) => ({ name: st.byId.get(id)?.name ?? id, pct }));
  const short = percentNote(opts.capPct, named(opts.playerCap), named(opts.playerMin), opts.count, b.lineups.length);
  if (short) notes.push(short);
  return { lineups: b.lineups, exposure: exposureOf(st, prevKeys, opts), notes, bends: b.bends };
}

/** The lineups one at a time: soft.js forcedSet's Min % players locked into each, a lineup no setting allows bent. */
function buildBatch(c) {
  const { opts, st, counts, prev, prevKeys, notes } = c;
  const lineups = [];
  const bends = [];
  const bentKeys = new Set(); // closing-note reason: his latest drop was a bend (cleared when he is forced again)
  const bentOut = new Set(); // forcedSet's guard: dropped by any bend, never forced again once past saving (never cleared)
  const waits = new Map();
  const easedUntil = new Map(); // DK key -> last lineup index a bent-out Min player is left unforced
  const stepOut = new Map();
  const room = forcedRoom(st, opts, prevKeys);
  const forcedStates = new Map();
  const madeBefore = () => (lineups.length ? `The ${lineups.length} made before it are returned.` : "No lineups were made.");
  // The whole request's step budget is spent: the lineup in hand is not proven best, so it is dropped.
  const budgetNote = (n) => `The search hit its step limit of ${opts.batchNodeLimit.toLocaleString("en-US")} for the whole request while making lineup ${n + 1} of ${opts.count}; ${lineups.length ? `the ${lineups.length} made before it are returned` : "no lineups were made"}.`;
  let aborted = false;
  for (let n = 0; n < opts.count; n++) {
    const eased = new Set([...easedUntil].filter(([, last]) => last >= n).map(([key]) => key));
    const { ids: forced, waits: waited } = forcedSet(c.plan, counts, n, opts.count, room, eased, bentOut);
    for (const w of waited) waits.set(w.key, w.why);
    // PROJECT.md Part 4 Optimizer: forced again, his older drop reason gives way to a later one. `bentOut` (every key
    // any bend ever dropped) is never cleared: it is forcedSet's never-forced-again-past-saving guard, and clearing it
    // here let a bent, then re-forced, player drain the step budget once more (round-ten review, 2026-10-17).
    for (const id of forced) {
      bentKeys.delete(st.keyOfId.get(id));
      stepOut.delete(st.keyOfId.get(id));
    }
    const lst = forced.length ? forcedState(c.rows, opts, st, forced, forcedStates) : st;
    const lprev = lst === st ? prev : lst.fatal ? null : makePrevIndex(lst, prevKeys, 1);
    const avail = lst.fatal ? { trimmed: 0 } : availableLists(lst, opts, counts, lprev);
    const batchLeft = opts.batchNodeLimit - opts.budget.used;
    const batchBinds = batchLeft <= opts.nodeLimit;
    const result = lst.fatal ? { best: null, nodes: 0, aborted: false } : searchOne(lst, avail, lprev, opts, Math.max(0, Math.min(opts.nodeLimit, batchLeft)));
    opts.budget.used += result.nodes;
    if (opts.stats) {
      opts.stats.nodes = (opts.stats.nodes ?? 0) + result.nodes;
      opts.stats.trimmed = (opts.stats.trimmed ?? 0) + avail.trimmed;
    }
    if (result.aborted && batchBinds) {
      notes.push(budgetNote(n));
      break;
    }
    if (result.aborted) aborted = true;
    let players = result.best;
    let bent = null;
    if (!players) {
      // PROJECT.md Part 4 Optimizer, Min % and soft rules: a step run-out may drop only this lineup's Min players.
      const b = result.aborted && !forced.length ? { nodes: 0 } : bendLineup(c, forced, lst, n, opts.batchNodeLimit - opts.budget.used, result.aborted);
      opts.budget.used += b.nodes;
      if (b.budgetOut) {
        notes.push(budgetNote(n));
        break;
      }
      if (!b.players && result.aborted) {
        notes.push(`Lineup ${n + 1} of ${opts.count} could not be made: the search stopped at its limit of ${opts.nodeLimit.toLocaleString("en-US")} steps without finding one. ${madeBefore()}`);
        break;
      }
      if (!b.players) {
        notes.push(`No single setting could be bent for lineup ${n + 1} of ${opts.count}: ${b.why}. ${madeBefore()}`);
        break;
      }
      if (b.aborted) aborted = true;
      // PROJECT.md Part 4 Optimizer, Min % and soft rules: a dropped Min waits two lineups unless out of slack.
      for (const id of b.dropped.filter((d) => !b.players.some((p) => p.key === st.keyOfId.get(d)))) {
        const key = st.keyOfId.get(id);
        bentOut.add(key);
        if (result.aborted) {
          stepOut.set(key, `the search hit its step limit of ${opts.nodeLimit.toLocaleString("en-US")} on a lineup that held him`);
          waits.set(key, stepOut.get(key));
        } else bentKeys.add(key);
        easedUntil.set(key, n + 2);
      }
      players = b.players;
      bent = b.label;
    }
    // Rules-repo review 2026-10-17 finding 3: a QB whose "must" player reached a cap is named once, judged on the settled lineup.
    if (st.perQb && st.locksAt.QB === 0) {
      const qbs = (lst.fatal ? availableLists(st, opts, counts, prev) : avail).QB.filter((q) => !players.some((p) => p.key === q.key));
      notes.push(...cappedMustNotes(qbs, (lst.fatal ? st : lst).candByKey, (m) => mustCapCause(m, counts, st, opts), c.mustNoted, n + 1));
    }
    const keys = players.map((p) => p.key);
    prevKeys.push(keys);
    addPrev(prev, keys);
    for (const k of keys) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      waits.delete(k); // placed after all, so an earlier clash note no longer holds
    }
    const lineup = presentLineup(st, players);
    if (bent !== null) {
      lineup.bent = bent;
      bends.push({ lineup: n + 1, label: bent });
    }
    lineups.push(lineup);
  }
  for (const [key, why] of stepOut) if (!waits.has(key)) waits.set(key, why);
  return { lineups, bends, bentKeys, waits, aborted };
}

/** The Min % players as soft.js minPlan entries: the pool candidate with his caps as limits, or `out` with the reason. */
function minEntries(opts, st) {
  const lockedKeys = new Set(st.lockCands.map((c) => c.key));
  const out = [];
  for (const [id, { n, pct }] of opts.playerMin) {
    const key = st.keyOfId.get(id);
    if (key === undefined || lockedKeys.has(key)) continue;
    const row = st.byId.get(id);
    const base = { id, key, name: row.name ?? id, pct, asked: n };
    const cand = st.candByKey.get(key);
    const lockClash = cand && st.lockCands.map((l) => [l, pairRule(cand, l, opts)]).find(([, rule]) => rule);
    const why = !cand ? minOutReason(row, id, opts) ?? "he is not in the pool" : slotsFull(st.locksAt, cand.pos) ? lockedSlotWords(cand.pos)
      : lockClash ? `${lockClash[1]} keeps him apart from locked ${lockClash[0].name}` : lockedQbRefuses(cand, st, opts);
    if (why) {
      out.push({ ...base, out: why });
      continue;
    }
    const limits = [];
    const own = st.playerCapN.get(key);
    if (own !== undefined) limits.push({ n: own, why: `his Max % allows ${own} of ${opts.count} lineups` });
    if (opts.capCount[cand.pos] !== undefined) limits.push({ n: opts.capCount[cand.pos], why: `the ${cand.pos} maximum exposure is ${opts.capLabel[cand.pos]}` });
    if (cand.pos === "DST" && st.spreadCap !== null) limits.push({ n: st.spreadCap, why: `Spread defenses allow each defense ${st.spreadCap} of ${opts.count} lineups` });
    out.push({ ...base, id: cand.id, pos: cand.pos, salary: cand.salary, score: cand.score, cand, limits });
  }
  return out;
}

/** Why the pool keeps an unlocked row out, in plain words, or null when it does not (the route counts Mins by it). */
export function minOutReason(row, id, opts) {
  if (opts.excludes.has(id)) return "he is excluded";
  const pos = rowPos(row);
  const salary = num(row.salary);
  if (!pos || salary === null || salary < 0) return "he has no salary or position a classic lineup can use";
  const f = rowFlags(row, pos, opts);
  if (f.lateOut) return "he was ruled out after TwoGun's board was made";
  if (f.sidelined) return `he is listed ${row.status ?? "injured"}`;
  if (f.noProjection) return "he has no projection";
  if (f.avoided) return "his game is set to avoid";
  if (f.unstarredQb) return "he is not starred";
  if (f.noCeiling) return "he has no TwoGun ceiling for this ceiling build";
  return null;
}

/** The hard pair rule two players break together, in words, or null. a, b: {pos, team, opp, game, key, name, never
 *  (a QB's "no" keys)}; `rules` the D55 switches, `allowRbGames` a Set of games. One copy for the engine and the route. */
export function pairBreak(a, b, rules, allowRbGames) {
  if (a.pos === "RB" && b.pos === "RB") {
    if (rules.noSameTeamRbs && a.team && a.team === b.team) return `the rule "${RULE_LABELS.noSameTeamRbs}"`;
    if (rules.noSameGameRbs && a.game && a.game === b.game && !allowRbGames.has(a.game)) return `the rule "${RULE_LABELS.noSameGameRbs}"`;
  }
  const [d, o] = a.pos === "DST" ? [a, b] : [b, a];
  if (rules.noDstVsOwnPlayers && d.pos === "DST" && o.pos !== "DST" && d.opp && o.team === d.opp) return `the rule "${RULE_LABELS.noDstVsOwnPlayers}"`;
  for (const [q, p] of [[a, b], [b, a]]) if (q.pos === "QB" && q.never && q.never.has(p.key)) return `the "no" mark for ${q.name}`;
  return null;
}

const pairSide = (c) => ({ pos: c.pos, team: upper(c.team), opp: upper(c.opp), game: c.game, key: c.key, name: c.name, never: c.rule?.neverKeys });
const pairRule = (a, b, opts) => pairBreak(pairSide(a), pairSide(b), opts.rules, opts.allowRbGames);

/** Why the locked quarterback's stack (`rule`) or the per-team limit with the locks refuses `min` every lineup, or
 *  null. Sides: {pos, team, opp, name, stackOk}. One copy for the engine and the route. */
export function lockedQbBlocks(min, locks, rule, maxPerTeam) {
  const qb = locks.find((c) => c.pos === "QB");
  if (!qb || !min || min.pos === "QB") return null;
  const offense = locks.filter((c) => c.pos !== "QB" && c.pos !== "DST");
  if (min.pos !== "DST" && min.stackOk && min.team === qb.team && offense.filter((c) => c.stackOk && c.team === qb.team).length >= rule.capOwn) {
    return `locked ${qb.name}'s stack takes no more teammates`;
  }
  if (min.pos !== "DST" && qb.opp && min.team === qb.opp && offense.filter((c) => c.team === qb.opp).length >= rule.capOpp) {
    return `locked ${qb.name}'s stack takes no more players from the team he faces`;
  }
  const outside = min.team !== qb.team && min.team !== qb.opp;
  if (maxPerTeam !== null && outside && locks.filter((c) => c.team === min.team).length >= maxPerTeam) {
    return `the limit of ${maxPerTeam} per team is already filled by locked players from ${min.team}`;
  }
  return null;
}

const stackSide = (c) => ({ pos: c.pos, team: upper(c.team), opp: upper(c.opp), name: c.name, stackOk: c.stackOk });
function lockedQbRefuses(cand, st, opts) {
  const qb = st.lockCands.find((c) => c.pos === "QB");
  return qb ? lockedQbBlocks(stackSide(cand), st.lockCands.map(stackSide), qb.rule ?? st.global, opts.maxPerTeam) : null;
}

/** RULES.md D73: a quarterback's stack entry (`entries`: [id, entry] pairs) saved under any row of his DraftKings key; of
 *  several, the last in key order, as qbStackPrepare keeps it (number-string ids sort numerically: the higher id wins). */
export function qbEntryByKey(entries, keyOf, qbId) {
  return [...entries].filter(([id]) => keyOf(id) === keyOf(qbId)).map(([, e]) => e).pop();
}

/** lockedQbBlocks from board rows and a request's checked settings, as the engine reads them (the route skips such a
 *  Min in its slot count). */
export function lockedQbBlocksRow(settings, rowOf, minId) {
  const opts = normaliseSettings(settings, null, 0, []);
  const side = (id) => {
    const row = rowOf(id);
    const pos = row ? rowPos(row) : null;
    return pos ? { pos, team: upper(row.team), opp: upper(row.opp), name: row.name ?? id, stackOk: countsTowardStack(pos) } : null;
  };
  // By DraftKings key, as the engine reads them: twin locked rows are one man (qbEntryByKey for the stack entry).
  const keyOf = (id) => dkKeyOf(rowOf(id) ?? {}, id);
  const locks = [...new Map(opts.locks.map((id) => [keyOf(id), id])).values()];
  const qbId = locks.find((id) => side(id)?.pos === "QB");
  if (qbId === undefined) return null;
  const entry = qbEntryByKey(opts.qbStacks, keyOf, qbId);
  const rule = entry ? ruleFromEntry(entry, new Map(), stackRuleOf(opts)) : stackRuleOf(opts);
  return lockedQbBlocks(side(minId), locks.map(side).filter(Boolean), rule, opts.maxPerTeam);
}

function forcedRoom(st, opts, prevKeys) {
  const lockKeys = st.lockCands.map((c) => c.key);
  // Locks plus forced players sharing more than 9 - minUnique with an earlier lineup (saved or batch) can never pass.
  const tooAlike = (keys) => {
    if (lockKeys.length + keys.length <= SLOT_COUNT - opts.minUnique) return false;
    const alike = prevKeys.some((prev) => [...lockKeys, ...keys].filter((k) => prev.includes(k)).length > SLOT_COUNT - opts.minUnique);
    if (alike && opts.stats) opts.stats.repeatsHeld = (opts.stats.repeatsHeld ?? 0) + 1;
    return alike;
  };
  // D73: the places a locked or forced quarterback still needs for his stack beyond those already held, at the
  // positions where the pool has a teammate (or opponent) who would count and a held defense does not ban.
  const stackNeed = (set) => {
    const held = [...st.lockCands, ...set.map((p) => p.cand)];
    const qb = held.find((c) => c.pos === "QB");
    if (!qb) return [];
    const rule = qb.rule ?? st.global;
    const offense = held.filter((c) => c.pos !== "QB" && c.pos !== "DST");
    const dstOpp = held.find((c) => c.pos === "DST")?.oppIx ?? -1;
    const reach = (counts, ban) => POSITIONS.filter(countsTowardStack).filter((pos) => st.byPos[pos].some((c) => countsFor(c, counts) && !held.includes(c) && !(ban && defenseBans(opts.rules, dstOpp, c))));
    const side = (counts) => {
      const at = reach(counts, true);
      const why = !at.length && reach(counts, false).length ? `the defense rule bans every player of the team the held defense faces, and the quarterback's stack needs ${counts === "own" ? "a teammate" : "an opponent"} from it` : undefined;
      return { side: counts, n: Math.max(0, (counts === "own" ? rule.needOwn : rule.needOpp) - offense.filter((c) => countsFor(c, counts)).length), at, why };
    };
    const countsFor = (c, counts) => (counts === "own" ? c.stackOk && c.teamIx === qb.teamIx : qb.oppIx >= 0 && c.teamIx === qb.oppIx);
    return [side("own"), side("opp")].filter((r) => r.n > 0);
  };
  const cheapest = {};
  for (const pos of POSITIONS) cheapest[pos] = st.byPos[pos].map((c) => ({ key: c.key, salary: c.salary })).sort((a, b) => a.salary - b.salary);
  // The two back rules make one-per-lineup classes (one team; one game unless allowed).
  const classes = (p) => (p.pos !== "RB" ? [] : [
    opts.rules.noSameTeamRbs && upper(p.cand.team) ? `team:${upper(p.cand.team)}` : null,
    opts.rules.noSameGameRbs && p.cand.game && !opts.allowRbGames.has(p.cand.game) ? `game:${p.cand.game}` : null
  ].filter(Boolean));
  return { locksAt: st.locksAt, lockSalary: st.lockSalary, cap: opts.cap, cheapest, clash: (p, q) => pairRule(p.cand, q.cand, opts), classes, tooAlike, stackNeed };
}

/** prepare() for one lineup: `forced` Min players are locks for it alone; the spread-defense cap stays the batch's. */
function prepareLineup(rows, o, forced, spreadCap, notes) {
  if (!forced.length) return prepare(rows, o, notes);
  const st = prepare(rows, { ...o, locks: [...o.locks, ...forced], forced: new Set(forced) }, notes);
  st.spreadCap = spreadCap;
  return st;
}

function forcedState(rows, opts, st, forced, cache) {
  const sig = forced.join("\n");
  if (!cache.has(sig)) cache.set(sig, prepareLineup(rows, opts, forced, st.spreadCap, []));
  return cache.get(sig);
}

/** Lineup n bent by soft.js chooseBend's trial; {why} when nothing bends, {budgetOut} when the step budget ran out. */
function bendLineup(c, forced, lst, n, budget, runOut) {
  const { opts } = c;
  const d = diagnose(c.rows, c.settings, c.slate, c.existingCount, c.prevKeys, opts, null, { forced, budget, runOut });
  const pick = chooseBend(d.trials);
  if (!pick) {
    if (d.nodes >= budget) return { budgetOut: true, nodes: d.nodes };
    const names = listNames(forced.map((id) => c.st.byId.get(id)?.name ?? id));
    const minUnchecked = d.trials.some((t) => t.kind === "minForce" && t.unchecked);
    const why = lst.fatal && minUnchecked ? `the Min % players for this lineup (${names}) cannot all be placed: ${lst.fatal.replace(/\.$/, "")}`
      : diagnosisSentence(d.trials, { n, existingCount: c.existingCount, perQb: opts.qbStacks.size > 0, capText: money(opts.cap) });
    return { why, nodes: d.nodes };
  }
  const limit = Math.max(0, Math.min(opts.nodeLimit, budget - d.nodes));
  const again = pick.aborted ? { ...d.run(pick, limit), limit } : null;
  if (again && opts.stats) {
    opts.stats.reSearches = (opts.stats.reSearches ?? 0) + 1;
    opts.stats.bendNodes = (opts.stats.bendNodes ?? 0) + again.nodes;
  }
  const dropped = pick.dropAll ? forced : pick.drop ? [pick.drop] : [];
  return { ...settleBend(pick, again), label: bendLabel(pick, d.trials), dropped, nodes: d.nodes + (again ? again.nodes : 0) };
}

/** Per-QB entries: each unlocked entry QB is tried alone first; one who fits no lineup gets a note; returns the keys noted. */
function entryQbChecks(rows, settings, slate, existingCount, prevKeys, opts, st, notes) {
  const reported = new Set();
  if (!st.perQb || st.lockCands.some((c) => c.pos === "QB") || opts.capCount.QB === 0) return reported;
  const base = settings && typeof settings === "object" ? settings : {};
  for (const qb of st.byPos.QB) {
    if (!qb.rule || st.qbNoted.has(qb.key) || st.playerCapN.get(qb.key) === 0) continue;
    const scratch = [];
    const o2 = normaliseSettings({ ...base, locks: [...opts.locks, qb.id], count: opts.count }, slate, existingCount, scratch);
    o2.capCount = opts.capCount;
    const st2 = prepare(rows, o2, scratch);
    if (st2.fatal) continue; // he and the locks do not fit together (salary or slots): not his stack settings, as for any quarterback
    const lim = stepsLeft(opts, opts.diagNodeLimit, opts.budget.floor);
    if (lim === 0) {
      notes.push(uncheckedQbNote(qb.name, opts, true));
      reported.add(qb.key);
      continue;
    }
    const prev2 = makePrevIndex(st2, prevKeys, 1);
    const r = searchOne(st2, availableLists(st2, o2, new Map(), prev2), prev2, o2, lim);
    opts.budget.used += r.nodes;
    if (opts.stats) opts.stats.checkNodes = (opts.stats.checkNodes ?? 0) + r.nodes;
    if (r.best) continue;
    reported.add(qb.key);
    if (r.aborted) {
      notes.push(uncheckedQbNote(qb.name, opts, lim < opts.diagNodeLimit)); // never a silent drop — rules-repo review 2026-10-17 finding 3
      continue;
    }
    const d = diagnose(rows, settings, slate, existingCount, prevKeys, opts, qb.id);
    opts.budget.used += d.nodes;
    notes.push(`${qb.name} cannot be in any lineup with his stack settings: ${checkSentence(d.trials, opts, existingCount)}.`);
  }
  return reported;
}

/** The step limit for one check or diagnosis trial: `cap`, cut to what is left above `floor` (0 once reached). */
function stepsLeft(opts, cap, floor) {
  return Math.max(0, Math.min(cap, opts.batchNodeLimit - floor - opts.budget.used));
}

/** "the <who> used up their share of the request's step limit (S of L)": the words both kinds of check notes use. */
function checksShareText(opts, who) {
  const share = opts.batchNodeLimit - opts.budget.floor;
  return `the ${who} used up their share of the request's step limit (${share.toLocaleString("en-US")} of ${opts.batchNodeLimit.toLocaleString("en-US")})`;
}

/** An entry quarterback whose solo check ran out of steps (its own limit, or the checks' share when `budgetSpent`). */
function uncheckedQbNote(name, opts, budgetSpent) {
  const why = budgetSpent ? checksShareText(opts, "quarterback checks") : `the check hit its step limit of ${opts.diagNodeLimit.toLocaleString("en-US")}`;
  return `${name}'s stack settings could not be checked (${why}); if he is in no lineup, they may be why.`;
}

/** soft.js diagnosisSentence for a quarterback check, the trials cut short by the checks' share of the step budget
 *  named as such, never as "no single setting is the cause" — rules-repo review 2026-10-17 finding 4. */
function checkSentence(trials, opts, existingCount) {
  const ctx = { n: 0, existingCount, perQb: opts.qbStacks.size > 0, capText: money(opts.cap) };
  const skipped = trials.filter((t) => t.skipped).map((t) => t.label);
  if (!skipped.length) return diagnosisSentence(trials, ctx);
  const rest = trials.filter((t) => !t.skipped);
  const tail = `; ${checksShareText(opts, "quarterback checks")} before these could be checked: ${skipped.join("; ")}`;
  if (!rest.some((t) => t.found || t.unchecked)) return `no lineup keeps every setting; no single setting was found to be the cause${tail}`;
  return `${diagnosisSentence(rest, ctx)}${tail}`;
}

/** The cap a "must" player has reached for this lineup (his own Max % first, then his position's), or null. */
function mustCapCause(c, counts, st, opts) {
  const used = counts.get(c.key) ?? 0;
  const own = st.playerCapN.get(c.key);
  if (own !== undefined && used >= own) {
    const pct = opts.playerCap.get(c.id)?.pct;
    return `his Max %${pct === undefined ? "" : ` of ${pct}%`} (${own} of ${opts.count} lineups)`;
  }
  const capN = opts.capCount[c.pos];
  return capN !== undefined && used >= capN ? `the ${c.pos} maximum exposure (${opts.capLabel[c.pos]})` : null;
}

// --------------------------------------------------------------------------------------------------------
// Pool
// --------------------------------------------------------------------------------------------------------

/**
 * Builds the candidate pool and the bound tables. Returns { fatal } with a sentence when the locks themselves are
 * impossible (unknown, clashing with an exclude, unpriceable, too many at a position, over the cap).
 */
function prepare(rows, opts, notes) {
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object" || row.id === null || row.id === undefined) continue;
    const id = String(row.id);
    if (!byId.has(id)) byId.set(id, row);
  }
  const keyOfId = new Map();
  for (const [id, row] of byId) keyOfId.set(id, dkKeyOf(row, id));
  // hasCeil: the board carries TwoGun ceilings (TwoGun mode); only then does a lineup report a ceiling total.
  const hasCeil = [...byId.values()].some((row) => ceilingOf(row) !== null);
  const st = { keyOfId, byId, fatal: null, cap: opts.cap, rules: opts.rules, maxPerTeam: opts.maxPerTeam, minUnique: opts.minUnique, hasCeil };
  const ceilBuild = opts.objective === "ceil";
  if (ceilBuild && !hasCeil) {
    st.fatal = NO_CEILING_SENTENCE;
    return st;
  }

  const lockSet = new Set(opts.locks);
  const forcedIds = opts.forced ?? new Set();
  const held = forcedIds.size ? "locked and Min %" : "locked";
  const heldAre = forcedIds.size ? "locked or held by a Min %" : "locked";
  const clash = opts.locks.filter((id) => opts.excludes.has(id));
  if (clash.length) {
    st.fatal = `${listNames(clash.map((id) => byId.get(id)?.name ?? id))} ${clash.length > 1 ? "are" : "is"} both locked and excluded.`;
    return st;
  }
  const missing = opts.locks.filter((id) => !byId.has(id));
  if (missing.length) {
    st.fatal = `Locked player${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not on this slate.`;
    return st;
  }
  if (opts.locks.length > SLOT_COUNT) {
    st.fatal = `${opts.locks.length} players are ${heldAre} but a lineup has only nine slots.`;
    return st;
  }

  const teamIx = new Map();
  const gameIx = new Map();
  const ix = (map, key) => {
    if (!map.has(key)) map.set(key, map.size);
    return map.get(key);
  };

  // D55 "only starred quarterbacks": lineups start with a starred QB or a locked one. With the rule on, no QB
  // starred and none locked, nothing is built and Adam is told to star or lock one (no diagnosis trials).
  if (opts.rules.starredQbOnly && !anyStarredQb(rows) && !opts.locks.some((id) => rowPos(byId.get(id)) === "QB")) {
    st.fatal = `Star at least one quarterback (or lock one) first: the rule "${RULE_LABELS.starredQbOnly}" is on.`;
    return st;
  }

  const byKey = new Map();
  let noCeilingLeftOut = 0; // ceiling build: players kept out only for having no TwoGun ceiling
  let typedIgnored = 0; // ceiling build: pool players whose typed projection does not move it
  for (const [id, row] of byId) {
    if (opts.excludes.has(id)) continue;
    const locked = lockSet.has(id);
    const name = row.name ?? id;
    const pos = rowPos(row);
    if (!pos) {
      if (locked) {
        st.fatal = `Locked ${name} has no position a classic lineup can use.`;
        return st;
      }
      continue;
    }
    const salary = num(row.salary);
    if (salary === null || salary < 0) {
      if (locked) {
        st.fatal = `Locked ${name} has no salary in the DraftKings CSV, so he cannot be costed against the cap.`;
        return st;
      }
      continue;
    }
    const { proj, overridden, noProjection, sidelined, game, avoided, unstarredQb, ceil, noCeiling, lateOut } = rowFlags(row, pos, opts);
    const otherwiseOut = noProjection || sidelined || avoided || unstarredQb || lateOut;
    if (!locked && (otherwiseOut || noCeiling)) {
      if (noCeiling && !otherwiseOut) noCeilingLeftOut++;
      continue;
    }
    if (locked) {
      // A late-out row also carries "injured", so the late-out note is checked first.
      if (lateOut) notes.push(`Locked ${name} was ruled out after TwoGun's board was made; he is kept because he is locked.`);
      else if (sidelined) notes.push(`Locked ${name} is listed ${row.status ?? "injured"}; he is kept because he is locked.`);
      if (noProjection) notes.push(`Locked ${name} has no projection from any source and counts as ${proj === null ? "0" : `his stand-in ${round2(proj)}`}.`);
      if (noCeiling) notes.push(`Locked ${name} has no TwoGun ceiling and counts as 0 in this ceiling build.`);
      if (avoided) notes.push(`Locked ${name} plays in ${game}, a game set to avoid; he is kept because he is locked.`);
      if (unstarredQb) notes.push(`Locked ${name} is not starred; he is used because he is locked.`);
    }
    if (ceilBuild && overridden) typedIgnored++;

    const cand = {
      id,
      key: keyOfId.get(id),
      name,
      pos,
      team: row.team ?? null,
      opp: row.opp ?? null,
      game,
      teamIx: ix(teamIx, upper(row.team) || `?${id}`),
      oppIx: row.opp ? ix(teamIx, upper(row.opp)) : -1,
      gameIx: ix(gameIx, game ?? `?${id}`),
      salary,
      proj: proj ?? 0,
      ceil,
      own: num(row.own),
      score: Math.round(objectiveScore(row, proj ?? 0, opts.objective) * SCORE_SCALE),
      stackOk: countsTowardStack(pos),
      locked,
      kickoff: row.kickoffUtc ?? null,
      prevList: null,
      sUnits: 0
    };
    // Two rows of one DraftKings player: keep the locked one, else the better one.
    const twin = byKey.get(cand.key);
    if (twin) {
      if (twin.locked && cand.locked) {
        st.fatal = `${twin.name} and ${cand.name} are the same DraftKings player, so both cannot be locked.`;
        return st;
      }
      const better = cand.locked || (!twin.locked && cmpCand(cand, twin) < 0);
      if (!better) continue;
    }
    byKey.set(cand.key, cand);
  }
  if (ceilBuild) ceilingNotes(noCeilingLeftOut, typedIgnored, notes);

  const all = [...byKey.values()];
  st.teamCount = teamIx.size;
  st.gameCount = gameIx.size;
  st.allowRbGame = new Uint8Array(gameIx.size);
  for (const [g, i] of gameIx) if (opts.allowRbGames.has(g)) st.allowRbGame[i] = 1;
  st.candByKey = byKey;

  const lockCands = opts.locks.map((id) => all.find((c) => c.id === id)).filter(Boolean);
  if (lockCands.length !== opts.locks.length) {
    // The other row of a locked man's twin pair was locked instead; resolved above, so this cannot happen.
    st.fatal = "A locked player could not be placed in the pool.";
    return st;
  }
  st.lockCands = lockCands;
  const locksAt = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
  for (const c of lockCands) locksAt[c.pos]++;
  st.locksAt = locksAt;
  for (const pos of POSITIONS) {
    if (locksAt[pos] > MAX_AT[pos]) {
      st.fatal = `${locksAt[pos]} ${pos}s are ${heldAre} but a lineup holds at most ${MAX_AT[pos]}.`;
      return st;
    }
  }
  if (locksAt.RB + locksAt.WR + locksAt.TE > 7 || !CONFIGS.some((cfg) => POSITIONS.every((p) => locksAt[p] <= cfg[p]))) {
    st.fatal = `The ${held} running backs, receivers and tight ends (${locksAt.RB} RB, ${locksAt.WR} WR, ${locksAt.TE} TE) do not fit the RB, RB, WR, WR, WR, TE and FLEX slots.`;
    return st;
  }
  const lockSalary = lockCands.reduce((s, c) => s + c.salary, 0);
  if (lockSalary > opts.cap) {
    st.fatal = `The ${held} players cost ${money(lockSalary)}, which is already over the ${money(opts.cap)} cap.`;
    return st;
  }
  st.lockSalary = lockSalary;

  // D73 stack, resolved once: exactly N (O) unless "or more" (global rule, D73 amended 2026-10-17).
  st.global = stackRuleOf(opts);
  const qs = qbStackPrepare(opts.qbStacks, {
    byId, keyOfId, candByKey: byKey, lockCands, rules: opts.rules, ruleLabel: (key) => RULE_LABELS[key], allowRbGame: st.allowRbGame, ceilBuild,
    global: st.global
  });
  if (qs.fatal) {
    st.fatal = qs.fatal;
    return st;
  }
  notes.push(...qs.notes);
  for (const c of all) if (c.pos === "QB") c.rule = qs.rules.get(c.key) ?? null;
  st.perQb = qs.rules.size > 0;
  st.protectedKeys = qs.protectedKeys;
  st.qbNoted = qs.noted;

  st.pool = all.filter((c) => !c.locked);
  const byPos = {};
  for (const pos of POSITIONS) byPos[pos] = st.pool.filter((c) => c.pos === pos).sort(cmpCand);
  st.byPos = byPos;
  st.playerCapN = playerCapsByKey(keyOfId, opts.playerCap);

  // Teams that could be the quarterback's, and the teams he could face: the locked QB's, or every QB's in the pool.
  const lockedQb = lockCands.find((c) => c.pos === "QB");
  const qbs = lockedQb ? [lockedQb] : byPos.QB;
  st.qbTeams = new Set(qbs.map((c) => c.teamIx));
  st.qbOppTeams = new Set(qbs.map((c) => c.oppIx).filter((i) => i >= 0));
  const entryQbs = qbs.filter((c) => c.rule);
  st.entryOwnTeams = new Set(entryQbs.map((c) => c.teamIx));
  st.entryOppTeams = new Set(entryQbs.filter((c) => c.rule.oppBinds && c.oppIx >= 0).map((c) => c.oppIx));

  // Spread defenses: cap = max(ceil(20% of count), ceil(count / usable DSTs)), folded into the DST exposure cap.
  st.spreadCap = null;
  if (opts.spreadDst) {
    if (lockCands.some((c) => c.pos === "DST" && !forcedIds.has(c.id))) {
      st.fatal = "A locked defense can't be spread; unlock it or turn off Spread defenses.";
      return st;
    }
    const live = qbs.filter((q) => !st.qbNoted.has(q.key));
    const room = usableDsts(byPos.DST, live, lockCands, opts.rules, st.playerCapN, oppStackActive(opts) ? opts.stackOpp : 0, byKey).map((d) => st.playerCapN.get(d.key) ?? Infinity);
    let share = 1;
    while (share < opts.count && room.reduce((t, n) => t + Math.min(n, share), 0) < opts.count) share++;
    const spread = Math.max(pctToLineups(20, opts.count), room.length ? share : 0);
    st.spreadCap = Math.min(spread, opts.capCount.DST ?? Infinity);
    notes.push(`Spread defenses: no defense in more than ${st.spreadCap} of ${opts.count} lineups.`);
  }

  // Salary units for the knapsack bound: the common divisor of every salary and the cap when that is fine enough,
  // otherwise a coarse unit with costs rounded down and budgets rounded up (still an upper bound).
  const ints = Number.isInteger(opts.cap) && all.every((c) => Number.isInteger(c.salary));
  let unit = 0;
  if (ints) {
    unit = opts.cap;
    for (const c of all) unit = gcd(unit, c.salary);
  }
  if (ints && unit > 0 && opts.cap / unit <= MAX_UNITS) {
    st.exact = true;
    st.unit = unit;
  } else {
    st.exact = false;
    st.unit = opts.cap / MAX_UNITS;
  }
  st.S = Math.floor(opts.cap / st.unit + 1e-9) + 1;
  for (const c of all) c.sUnits = st.exact ? c.salary / st.unit : Math.max(0, Math.floor(c.salary / st.unit - 1e-9));
  st.units = st.exact ? (rem) => rem / st.unit : (rem) => Math.min(st.S - 1, Math.floor(rem / st.unit + 1e-9));

  // Bound tables, built once on the full pool; trimming and exposure only remove players, so they stay upper bounds.
  const knap = {};
  for (const pos of POSITIONS) knap[pos] = knapsack(byPos[pos], MAX_AT[pos], st.S);
  st.configs = [];
  for (let ci = 0; ci < CONFIGS.length; ci++) {
    const cfg = CONFIGS[ci];
    if (!POSITIONS.every((p) => locksAt[p] <= cfg[p])) continue;
    const groups = GROUP_ORDER.map((pos) => ({ pos, need: cfg[pos] - locksAt[pos] })).filter((g) => g.need > 0);
    st.configs.push({ index: ci, groups, ...boundTables(groups, knap, st.S) });
  }
  return st;
}

/** Spread defenses (pure): a defense with Max % room counts unless, under the defense rule, he faces a locked player or no
 *  usable QB can take him (QB faces him, or is his team's and needs an opponent) — rules-repo review 2026-10-17 finding 2. */
export function usableDsts(dsts, qbs, lockCands, rules, playerCapN, globalNeedOpp, candByKey) {
  const qbOk = qbs.filter((q) => playerCapN.get(q.key) !== 0);
  const needsOpp = (q) => (q.rule ? q.rule.needOpp > 0 || q.rule.withKeys.some((k) => candByKey.get(k)?.teamIx === q.oppIx) : globalNeedOpp > 0);
  return dsts.filter((d) => {
    if ((playerCapN.get(d.key) ?? Infinity) <= 0) return false;
    if (!rules.noDstVsOwnPlayers || d.oppIx < 0) return true;
    return !lockCands.some((c) => c.teamIx === d.oppIx) && qbOk.some((q) => q.teamIx !== d.oppIx && !(d.teamIx === q.teamIx && needsOpp(q)));
  });
}

/** Projection descending, then salary ascending, then id: the order every list is searched in. */
function cmpCand(a, b) {
  return b.score - a.score || a.salary - b.salary || cmpId(a.id, b.id);
}

/** best[k][s]: the highest total score of exactly k players from `list` costing at most s units (-Infinity when
 *  no k players fit). */
function knapsack(list, K, S) {
  const best = [];
  for (let k = 0; k <= K; k++) {
    const row = new Float64Array(S);
    row.fill(k === 0 ? 0 : -Infinity);
    best.push(row);
  }
  for (const c of list) {
    const w = c.sUnits;
    for (let k = K; k >= 1; k--) {
      const cur = best[k];
      const prev = best[k - 1];
      for (let s = S - 1; s >= w; s--) {
        const v = prev[s - w] + c.score;
        if (v > cur[s]) cur[s] = v;
      }
    }
  }
  return best;
}

/** R[g][k][s]: best score for k more players of group g plus all later groups within s units. suffix[g] is R[g][need]. */
function boundTables(groups, knap, S) {
  const G = groups.length;
  const suffix = new Array(G + 1);
  suffix[G] = new Float64Array(S).fill(0);
  const R = new Array(G);
  for (let g = G - 1; g >= 0; g--) {
    const { pos, need } = groups[g];
    R[g] = new Array(need + 1);
    const next = suffix[g + 1];
    for (let k = 1; k <= need; k++) {
      const own = knap[pos][k];
      const out = new Float64Array(S).fill(-Infinity);
      for (let s1 = 0; s1 < S; s1++) {
        const a = own[s1];
        if (a === -Infinity) continue;
        if (s1 > 0 && a === own[s1 - 1]) continue; // own is non-decreasing; a repeat adds nothing new
        for (let s = s1; s < S; s++) {
          const v = a + next[s - s1];
          if (v > out[s]) out[s] = v;
        }
      }
      R[g][k] = out;
    }
    suffix[g] = R[g][need];
  }
  return { R, suffix };
}

// --------------------------------------------------------------------------------------------------------
// Earlier lineups (saved plus batch): uniqueness index
// --------------------------------------------------------------------------------------------------------

function makePrevIndex(st, prevKeys, count) {
  const prev = { byKey: new Map(), size: 0, capacity: prevKeys.length + count, usedKeys: new Set() };
  for (const c of st.candByKey.values()) {
    prev.byKey.set(c.key, []);
    c.prevList = prev.byKey.get(c.key);
  }
  for (const keys of prevKeys) addPrev(prev, keys);
  return prev;
}

function addPrev(prev, keys) {
  const L = prev.size++;
  for (const k of keys) {
    if (!prev.byKey.has(k)) prev.byKey.set(k, []);
    prev.byKey.get(k).push(L);
    prev.usedKeys.add(k);
  }
}

// --------------------------------------------------------------------------------------------------------
// Per-lineup lists: exposure caps, then dominance trimming
// --------------------------------------------------------------------------------------------------------

/** Per-player Max % (D74, this batch only) as lineup counts by DK key; two rows of one man take the smaller cap. */
function playerCapsByKey(keyOfId, playerCap) {
  const out = new Map();
  for (const [id, { n }] of playerCap) {
    const key = keyOfId.get(id);
    if (key !== undefined) out.set(key, Math.min(n, out.get(key) ?? Infinity));
  }
  return out;
}

function availableLists(st, opts, counts, prev) {
  const out = { trimmed: 0 };
  const playerCapN = st.playerCapN;
  for (const pos of POSITIONS) {
    let capN = opts.capCount[pos];
    if (pos === "DST" && st.spreadCap !== null) capN = Math.min(capN ?? Infinity, st.spreadCap);
    let list = st.byPos[pos];
    if (capN !== undefined) list = list.filter((c) => (counts.get(c.key) ?? 0) < capN);
    if (playerCapN.size) list = list.filter((c) => !playerCapN.has(c.key) || (counts.get(c.key) ?? 0) < playerCapN.get(c.key));
    if (!opts.noTrim) {
      const kept = trimPosition(list, pos, st, opts, prev);
      out.trimmed += list.length - kept.length;
      list = kept;
    }
    out[pos] = list;
  }
  return out;
}

/**
 * Drops the players at one position that can never be in the best lineup. Player p is dropped when it has
 * "dominators": players q of the same position, not locked, still available, in no earlier lineup, with
 * salary(q) <= salary(p) and projection(q) >= projection(p), strictly better on one of them or tied on both with
 * a smaller id. For any legal lineup M holding p,
 * M - p + q is cheaper or equal, projects at least as much and ranks strictly ahead of M; it is legal whenever
 * q is not already in M and q's team is not blocked by a team rule. So p can go once, for every possible M, at
 * least one dominator survives both:
 *   - at most need - 1 dominators are in M already (need = the most non-locked players of this position a
 *     lineup can hold);
 *   - the team rules block at most `b` whole teams: the quarterback's team and the team he faces while a D73 stack
 *     count binds (1 each, since a player from either changes the counts), the other backs' teams (2) and games
 *     (4 teams), the defense's opponent (1), teams at the per-team cap (8 / cap), and the one game the rest of M
 *     might sit in (2). For a defense: the teams of M's
 *     eight offensive players (8), the game (2), the per-team cap. D76: the per-team cap never blocks the
 *     quarterback's team or the team he faces, so it blocks only other teams, each holding `cap` of M's eight
 *     others; 8 / cap still bounds them, and a replacement from an exempt team is fine for the cap (any stack
 *     effect is already counted above).
 *   A dominator from p's OWN team keeps every team rule and both stack counts exactly as they were (every back,
 *   receiver and tight end counts alike, D55 as amended 2026-10-17), so `need` same-team dominators are always
 *   enough. Cross-team dominators are not used for a quarterback (his team decides the stack) or for a player who
 *   may count toward the stack (taking him out would change the count). A dominator in an
 *   earlier lineup could make M - p + q a repeat, so only unused players count. The test file checks that
 *   trimming never changes the answer.
 *   Per-QB entries (qb-stacks.js): marked players and entry QBs are never dropped or used as replacements; their teams are guarded as stack teams.
 */
function trimPosition(list, pos, st, opts, prev) {
  if (list.length <= 1) return list;
  const rules = opts.rules;
  const need = Math.max(1, MAX_AT[pos] - st.locksAt[pos]);
  const perTeamCap = opts.maxPerTeam ? Math.floor(8 / opts.maxPerTeam) : 0;
  const globalOwn = ownStackActive(opts);
  const globalOpp = oppStackActive(opts);
  const ownActive = globalOwn || st.entryOwnTeams.size > 0;
  const oppActive = globalOpp || st.entryOppTeams.size > 0;
  let b;
  if (pos === "QB") b = Infinity;
  else if (pos === "DST") b = (rules.noDstVsOwnPlayers ? 8 : 0) + 2 + perTeamCap;
  else {
    // D73: a replacement from the quarterback's team or the team he faces could change the stack counts.
    b = (ownActive ? 1 : 0) + (oppActive ? 1 : 0) + (rules.noDstVsOwnPlayers ? 1 : 0) + 2 + perTeamCap;
    if (pos === "RB") {
      b += (rules.noSameTeamRbs ? 2 : 0) + (rules.noSameGameRbs ? 4 : 0);
    }
  }
  const fixed = (c) => st.protectedKeys.has(c.key) || (pos === "QB" && c.rule);
  const usable = list.filter((q) => !prev.usedKeys.has(q.key) && !fixed(q));
  const kept = [];
  for (const p of list) {
    if (fixed(p)) {
      kept.push(p);
      continue;
    }
    const entryOwn = st.entryOwnTeams.has(p.teamIx);
    let sameTeam = 0;
    let total = 0;
    const byTeam = new Map();
    for (const q of usable) {
      if (q === p) continue;
      // D76: a quarterback's game decides which teams the per-team cap skips, so his dominator must face the same team.
      if (pos === "QB" && q.oppIx !== p.oppIx) continue;
      if (q.salary > p.salary || q.score < p.score) continue;
      if (q.salary === p.salary && q.score === p.score && cmpId(q.id, p.id) >= 0) continue;
      total++;
      if (q.teamIx === p.teamIx) sameTeam++;
      byTeam.set(q.teamIx, (byTeam.get(q.teamIx) ?? 0) + 1);
    }
    if (sameTeam >= need) continue; // same-team replacement: always safe
    // A player who may count toward the stack (a back, receiver or tight end of a possible quarterback's team, or any offensive
    // player of a team a possible quarterback faces) is only ever replaced from his own team.
    const stackCounted = (p.stackOk && ((globalOwn && st.qbTeams.has(p.teamIx)) || entryOwn))
      || (globalOpp && st.qbOppTeams.has(p.teamIx)) || st.entryOppTeams.has(p.teamIx);
    if (b !== Infinity && !stackCounted && total >= need) {
      const counts = [...byTeam.values()].sort((x, y) => y - x);
      let blocked = 0;
      for (let i = 0; i < Math.min(b, counts.length); i++) blocked += counts[i];
      if (total - blocked >= need) continue;
    }
    kept.push(p);
  }
  return kept;
}

// --------------------------------------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------------------------------------

const defenseBans = (rules, dstOpp, c) => rules.noDstVsOwnPlayers && dstOpp >= 0 && c.teamIx === dstOpp;

function searchOne(st, avail, prev, opts, nodeLimit) {
  const rules = st.rules;
  const T = Math.max(1, st.teamCount);
  const G = Math.max(1, st.gameCount);
  const teamN = new Int16Array(T);
  const offN = new Int16Array(T);
  const rbTeamN = new Int16Array(T);
  const rbGameN = new Int16Array(G);
  const gameN = new Int16Array(G);
  const overlap = new Int16Array(Math.max(1, prev.capacity));
  const maxShare = SLOT_COUNT - st.minUnique;
  const maxPerTeam = st.maxPerTeam;
  const allowRbGame = st.allowRbGame;
  const placed = [];
  let games = 0;
  let qbTeam = -1;
  let qbOpp = -1;
  let dstOpp = -1;
  let mates = 0; // D73: offensive teammates of the quarterback (every back counts, D55 as amended 2026-10-17)
  let opps = 0; // D73: offensive players of the team the quarterback faces
  let nodes = 0;
  let aborted = false;

  // D73 stack: the global rule prepare() resolved once (st.global).
  const global = st.global;
  let rule = global;
  let must = null; // mustPlan of the placed quarterback's "must" players, set with his rule in setMates

  let bestScore = -Infinity;
  let bestSalary = Infinity;
  let best = null;

  function canAdd(c) {
    // D76: Max per team skips the quarterback's team and the team he faces. Before he is placed (only locks: the QB
    // group is searched first) a team is not refused, since it may turn out to be his game; his own placement
    // below then checks every placed team outside his game, so the limit holds whatever the order.
    if (maxPerTeam !== null && c.pos !== "QB" && qbTeam !== -1 && c.teamIx !== qbTeam && c.teamIx !== qbOpp && teamN[c.teamIx] >= maxPerTeam) return false;
    if (c.pos !== "QB" && qbTeam !== -1 && rule.neverKeys.has(c.key)) return false;
    if (c.pos === "DST") {
      if (dstOpp !== -1) return false;
      if (rules.noDstVsOwnPlayers && c.oppIx >= 0 && offN[c.oppIx] > 0) return false;
    } else if (c.pos === "QB") {
      if (qbTeam !== -1) return false;
      let m = 0;
      let o = 0;
      const r = c.rule ?? global;
      for (const p of placed) {
        if (maxPerTeam !== null && p.teamIx !== c.teamIx && p.teamIx !== c.oppIx && teamN[p.teamIx] > maxPerTeam) return false;
        if (r.neverKeys.has(p.key)) return false;
        if (p.pos === "DST") {
          if (rules.noDstVsOwnPlayers && p.oppIx === c.teamIx) return false;
          continue;
        }
        if (p.stackOk && p.teamIx === c.teamIx) m++;
        if (c.oppIx >= 0 && p.teamIx === c.oppIx) o++;
      }
      if (m > r.capOwn || o > r.capOpp) return false;
    } else {
      if (qbTeam !== -1) {
        if (c.stackOk && c.teamIx === qbTeam && mates >= rule.capOwn) return false;
        if (c.teamIx === qbOpp && opps >= rule.capOpp) return false;
      }
      if (defenseBans(rules, dstOpp, c)) return false;
      if (c.pos === "RB") {
        if (rules.noSameTeamRbs && rbTeamN[c.teamIx] > 0) return false;
        if (rules.noSameGameRbs && rbGameN[c.gameIx] > 0 && !allowRbGame[c.gameIx]) return false;
      }
    }
    const pl = c.prevList;
    for (let i = 0; i < pl.length; i++) if (overlap[pl[i]] >= maxShare) return false;
    return true;
  }

  function add(c) {
    placed.push(c);
    teamN[c.teamIx]++;
    if (gameN[c.gameIx]++ === 0) games++;
    if (c.pos === "DST") dstOpp = c.oppIx;
    else {
      offN[c.teamIx]++;
      if (c.pos === "QB") {
        qbTeam = c.teamIx;
        qbOpp = c.oppIx;
        rule = c.rule ?? global;
        mates = 0;
        opps = 0;
        for (const p of placed) {
          if (p === c || p.pos === "DST") continue;
          if (p.stackOk && p.teamIx === qbTeam) mates++;
          if (qbOpp >= 0 && p.teamIx === qbOpp) opps++;
        }
      } else {
        if (c.pos === "RB") {
          rbTeamN[c.teamIx]++;
          rbGameN[c.gameIx]++;
        }
        if (c.teamIx === qbTeam && c.stackOk) mates++;
        if (qbOpp >= 0 && c.teamIx === qbOpp) opps++;
      }
    }
    const pl = c.prevList;
    for (let i = 0; i < pl.length; i++) overlap[pl[i]]++;
  }

  function remove(c) {
    placed.pop();
    teamN[c.teamIx]--;
    if (--gameN[c.gameIx] === 0) games--;
    if (c.pos === "DST") dstOpp = -1;
    else {
      offN[c.teamIx]--;
      if (c.pos === "QB") {
        qbTeam = -1;
        qbOpp = -1;
        rule = global;
        mates = 0;
        opps = 0;
      } else {
        if (c.pos === "RB") {
          rbTeamN[c.teamIx]--;
          rbGameN[c.gameIx]--;
        }
        if (c.teamIx === qbTeam && c.stackOk) mates--;
        if (qbOpp >= 0 && c.teamIx === qbOpp) opps--;
      }
    }
    const pl = c.prevList;
    for (let i = 0; i < pl.length; i++) overlap[pl[i]]--;
  }

  // Locks first, quarterback before the rest so every later check knows his team.
  const locks = [...st.lockCands].sort((a, b) => (a.pos === "QB" ? 0 : 1) - (b.pos === "QB" ? 0 : 1));
  for (const c of locks) {
    if (!canAdd(c)) return { best: null, nodes, aborted, lockClash: true };
    add(c);
  }
  const lockScore = st.lockCands.reduce((s, c) => s + c.score, 0);
  const rem0 = st.cap - st.lockSalary;

  // Order the position mixes by their root bound, so the best mix sets a strong incumbent first.
  const configs = st.configs
    .map((cfg) => ({ cfg, root: cfg.suffix[0][st.units(rem0)] }))
    .filter((x) => x.root > -Infinity)
    .sort((a, b) => b.root - a.root || a.cfg.index - b.cfg.index)
    .map((x) => x.cfg);

  for (const cfg of configs) {
    const groups = cfg.groups;
    const lists = groups.map((g) => avail[g.pos]);
    const R = cfg.R;
    const suffix = cfg.suffix;
    // D73 pruning: for the quarterback in place, mateSuf[h][j] / oppSuf[h][j] count the players of group h from
    // index j on who would count as a teammate / an opponent, so a branch that cannot reach N and O is cut.
    const mateSuf = lists.map((list) => new Int32Array(list.length + 1));
    const oppSuf = lists.map((list) => new Int32Array(list.length + 1));
    const stackBinds = st.perQb || global.needOwn > 0 || global.needOpp > 0;
    const idxOf = st.perQb ? lists.map((list) => new Map(list.map((c, i) => [c.key, i]))) : null;
    const mustCnt = new Int32Array(groups.length);
    const setMates = () => {
      if (!stackBinds) return;
      for (let h = 0; h < groups.length; h++) {
        const list = lists[h];
        const ms = mateSuf[h];
        const os = oppSuf[h];
        ms[list.length] = 0;
        os[list.length] = 0;
        for (let j = list.length - 1; j >= 0; j--) {
          const c = list[j];
          // A placed defense bans the team it faces (D55), so those players can never count toward the stack.
          const off = c.pos !== "DST" && c.pos !== "QB" && !defenseBans(rules, dstOpp, c);
          ms[j] = ms[j + 1] + (off && c.stackOk && c.teamIx === qbTeam ? 1 : 0);
          os[j] = os[j + 1] + (off && qbOpp >= 0 && c.teamIx === qbOpp ? 1 : 0);
        }
      }
      if (rule.withKeys.length) must = mustPlan(rule.withKeys, placed, groups, idxOf, st.candByKey);
    };
    if (qbTeam !== -1) setMates();
    /** False when the slots left (kRem in group gi from `start`, then every later group) cannot hold the
     *  teammates and opponents still needed. */
    const stackReachable = (gi, kRem, start) => {
      if (rule.withKeys.length && !withReachable(must, placed, groups, gi, kRem, start, mustCnt, canAdd)) return false;
      const wantOwn = rule.needOwn - mates;
      const wantOpp = rule.needOpp - opps;
      if (wantOwn <= 0 && wantOpp <= 0) return true;
      let canOwn = 0;
      let canOpp = 0;
      let canBoth = 0;
      for (let h = gi; h < groups.length; h++) {
        const from = h === gi ? start : 0;
        const k = h === gi ? kRem : groups[h].need;
        const m = mateSuf[h][from];
        const o = oppSuf[h][from];
        canOwn += Math.min(k, m);
        canOpp += Math.min(k, o);
        canBoth += Math.min(k, m + o);
      }
      return canOwn >= wantOwn && canOpp >= wantOpp && canBoth >= Math.max(0, wantOwn) + Math.max(0, wantOpp);
    };

    const leaf = (score, rem) => {
      if (games < 2) return;
      if (mates < rule.needOwn || mates > rule.capOwn || opps < rule.needOpp || opps > rule.capOpp) return;
      if (rule.withKeys.length && !rule.withKeys.every((k) => placed.some((p) => p.key === k))) return;
      const salary = st.cap - rem;
      if (score > bestScore || (score === bestScore && (salary < bestSalary || (salary === bestSalary && keyLess(placed, best))))) {
        bestScore = score;
        bestSalary = salary;
        best = placed.slice();
      }
    };

    const dfs = (gi, kRem, start, rem, score) => {
      if (nodes >= nodeLimit) {
        aborted = true; // the count never passes the limit, so the shared budget is never overdrawn — rules-repo review 2026-10-17 finding 4
        return;
      }
      nodes++;
      if (gi === groups.length) {
        leaf(score, rem);
        return;
      }
      if (stackBinds && qbTeam !== -1 && !stackReachable(gi, kRem, start)) return;
      const list = lists[gi];
      const last = kRem === 1;
      const nextTable = last ? suffix[gi + 1] : R[gi][kRem - 1];
      const maxNext = nextTable[st.units(rem)];
      const isQbGroup = groups[gi].pos === "QB";
      const end = list.length - (kRem - 1);
      for (let j = start; j < end; j++) {
        const c = list[j];
        const s2 = score + c.score;
        // Projection-ordered: once this player cannot reach the incumbent, nobody further down can. A bound of
        // -Infinity means nothing completes the lineup within the budget at all.
        if (maxNext === -Infinity || s2 + maxNext < bestScore) break;
        if (c.salary > rem) continue;
        const r2 = rem - c.salary;
        const lim = nextTable[st.units(r2)];
        if (lim === -Infinity || s2 + lim < bestScore) continue;
        if (!canAdd(c)) continue;
        add(c);
        if (isQbGroup) setMates();
        if (last) dfs(gi + 1, gi + 1 < groups.length ? groups[gi + 1].need : 0, 0, r2, s2);
        else dfs(gi, kRem - 1, j + 1, r2, s2);
        remove(c);
        if (aborted) return;
      }
    };

    dfs(0, groups.length ? groups[0].need : 0, 0, rem0, lockScore);
    if (aborted) break;
  }
  return { best, nodes, aborted };
}

/** True when the sorted ids of `a` come before those of `b` (the last tie-break). */
function keyLess(a, b) {
  if (!b) return true;
  const x = a.map((c) => c.id).sort(cmpId);
  const y = b.map((c) => c.id).sort(cmpId);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = cmpId(x[i], y[i]);
    if (d) return d < 0;
  }
  return x.length < y.length;
}

// --------------------------------------------------------------------------------------------------------
// Why a lineup could not be made
// --------------------------------------------------------------------------------------------------------

/** The plain cause when no starred quarterback is in the pool (Adam 2026-10-16): { text, plainly }, plainly = all out or excluded; else null. */
function starredQbCause(rows, opts) {
  const pool = prepare(rows, opts, []).candByKey;
  const seen = new Set();
  const starred = rows.filter((r) => r && typeof r === "object" && r.id !== null && r.id !== undefined && r.starred && rowPos(r) === "QB" && !seen.has(dkKeyOf(r, String(r.id))) && seen.add(dkKeyOf(r, String(r.id))));
  if (!pool || !starred.length || starred.some((r) => pool.has(dkKeyOf(r, String(r.id))))) return null;
  const plainly = starred.every((r) => opts.excludes.has(String(r.id)) || rowIsOut(r));
  const why = `every starred quarterback is ${plainly ? "ruled out or excluded" : "ruled out, excluded or not in the pool"}`;
  const names = listNames(starred.map((r) => r.name ?? r.id));
  return { plainly, why, names, text: `${why} (${names}); star another or turn off "Starred QBs only"` };
}

/** Re-runs the failed lineup with one setting relaxed at a time; in soft mode least change first, to the first found. */
function diagnose(rows, settings, slate, existingCount, prevKeys, opts, pin = null, soft = null) {
  const given = settings && typeof settings === "object" ? settings : {};
  const base = pin ? { ...given, locks: [...opts.locks, pin] } : given;
  const rowOf = new Map(rows.filter((r) => r && typeof r === "object").map((r) => [String(r.id), r]));
  const nameOf = (id) => rowOf.get(id)?.name ?? id;
  const focusId = pin ?? opts.locks.find((id) => rowOf.has(id) && rowPos(rowOf.get(id)) === "QB") ?? null;
  const focusKey = focusId === null ? null : dkKeyOf(rowOf.get(focusId), focusId);
  const entries = focusKey === null ? opts.qbStacks
    : new Map([...opts.qbStacks].filter(([id]) => rowOf.has(id) && dkKeyOf(rowOf.get(id), id) === focusKey));
  // D73 (amended 2026-10-17): a side the focused QB sets ignores the global, so relaxing the global does not help him.
  const focusSets = (sets) => focusKey !== null && [...entries.values()].some(sets);
  const forced = soft ? soft.forced : [];
  const lockedQb = opts.locks.some((id) => rowPos(rowOf.get(id) ?? {}) === "QB");
  // D74: caps count only this batch's lineups (prevKeys holds the saved ones first, then the batch so far).
  const batchCounts = new Map();
  for (const keys of prevKeys.slice(existingCount)) for (const k of keys) batchCounts.set(k, (batchCounts.get(k) ?? 0) + 1);
  const others = Object.fromEntries([...opts.qbStacks].filter(([id]) => !entries.has(id)));
  const trials = bendTrials({
    forced: lowestScoreFirst(forced, (id) => objectiveScore(rowOf.get(id), num(rowOf.get(id)?.proj) ?? 0, opts.objective)).map((id) => ({ id, name: nameOf(id) })),
    rules: RULE_KEYS.filter((key) => opts.rules[key]).map((key) => ({
      key, label: RULE_LABELS[key], cause: key === "starredQbOnly" && !pin && !lockedQb ? starredQbCause(rows, opts) : null
    })),
    baseRules: base.rules || {},
    stacks: [
      ...(ownStackActive(opts) && !focusSets(setsTeammates) ? [{ label: `stacking the quarterback with ${stackWords(opts.stackOwn, opts.stackOwnOrMore, "teammate", "teammates")}`, patch: { stackOwn: 0, stackOwnOrMore: true } }] : []),
      ...(oppStackActive(opts) && !focusSets(setsOpponents) ? [{ label: `stacking the quarterback with ${stackWords(opts.stackOpp, opts.stackOppOrMore, "player", "players")} from the team he faces`, patch: { stackOpp: 0, stackOppOrMore: true } }] : [])
    ],
    minUnique: opts.minUnique,
    posCaps: Object.keys(opts.capCount).length > 0,
    spreadDst: opts.spreadDst,
    // Per-player Max %: only a player already at his cap can be what blocks.
    blocking: [...opts.playerCap].filter(([id, { n }]) => rowOf.has(id) && (batchCounts.get(dkKeyOf(rowOf.get(id), id)) ?? 0) >= n).map(([id, { pct }]) => ({ id, name: nameOf(id), pct })),
    givenCaps: base.playerMaxExposure && typeof base.playerMaxExposure === "object" ? base.playerMaxExposure : {},
    entryTrials: stackTrials(entries, nameOf).map((t) => ({ label: t.label, patch: { qbStacks: { ...others, ...t.patch.qbStacks } } })),
    maxPerTeam: opts.maxPerTeam,
    avoidGames: opts.avoidGames.size > 0,
    locks: opts.locks.length > 0,
    pin
  }).filter((t) => !soft?.runOut || t.kind === "minForce");

  const run = (t, limit) => {
    const scratch = [];
    const o2 = normaliseSettings({ ...base, ...t.patch, count: opts.count }, slate, existingCount, scratch);
    // Exposure caps were sized for the whole request; keep the same counts so only the patched setting differs.
    if (!("maxExposure" in t.patch)) {
      o2.capCount = opts.capCount;
    }
    const keep = t.dropAll ? [] : forced.filter((id) => id !== t.drop);
    const spreadCap = keep.length && o2.spreadDst ? prepare(rows, o2, []).spreadCap ?? null : null;
    const st2 = prepareLineup(rows, o2, keep, spreadCap, scratch);
    if (st2.fatal) return { best: null, nodes: 0, aborted: false };
    const prev2 = makePrevIndex(st2, prevKeys, 1);
    const avail = availableLists(st2, o2, batchCounts, prev2);
    return searchOne(st2, avail, prev2, o2, limit);
  };
  // One step budget (rules-repo review 2026-10-17 finding 4): a bend gets what the batch has left; a quarterback check's
  // diagnosis stops above the half kept for the lineups. The caller charges the nodes; a trial its share cut short is skipped.
  const budget = soft ? soft.budget : opts.batchNodeLimit - opts.budget.floor - opts.budget.used;
  let nodes = 0;
  for (const i of soft ? trialOrder(trials) : trials.keys()) {
    const t = trials[i];
    const limit = Math.max(0, Math.min(opts.diagNodeLimit, budget - nodes));
    const r = run(t, limit);
    nodes += r.nodes;
    if (opts.stats) {
      opts.stats.trialsRun = (opts.stats.trialsRun ?? 0) + 1;
      const key = soft ? "bendNodes" : "diagNodes"; // PROJECT.md Part 4 Optimizer: a bend's diagnosis steps are counted in stats.bendNodes, the quarterback checks' in stats.diagNodes
      opts.stats[key] = (opts.stats[key] ?? 0) + r.nodes;
    }
    Object.assign(t, { found: Boolean(r.best), unchecked: !r.best && r.aborted, aborted: r.aborted, best: r.best, limit });
    if (t.unchecked && limit < opts.diagNodeLimit) t.skipped = true;
    // The starred-quarterback cause is worded only when nothing else would allow the lineup, so that case runs on.
    if (soft && chooseBend([t]) && !(t.cause && !t.cause.plainly)) break;
  }
  return { trials, nodes, run };
}

// --------------------------------------------------------------------------------------------------------
// Output
// --------------------------------------------------------------------------------------------------------

/** Nine players in DraftKings slot order through dk-entries.js assignSlots (the spare RB, WR or TE with the
 *  latest kickoff goes to FLEX, D56), plus totals. */
function presentLineup(st, players) {
  const pool = new Map();
  const kickoff = new Map();
  for (const c of players) {
    pool.set(c.id, { name: c.name, pos: c.pos, salary: c.salary, gameInfo: c.game ?? "" });
    const t = c.kickoff ? Date.parse(c.kickoff) : NaN;
    kickoff.set(c.id, Number.isFinite(t) ? t : 0);
  }
  let ids;
  try {
    ids = assignSlots(players.map((c) => c.id), pool, kickoff);
  } catch (e) {
    warn("lineup: slot order failed", { error: e && e.message });
    const order = { QB: 0, RB: 1, WR: 2, TE: 3, DST: 5 };
    ids = [...players].sort((a, b) => order[a.pos] - order[b.pos] || b.salary - a.salary).map((c) => c.id);
  }
  const salary = players.reduce((s, c) => s + c.salary, 0);
  const proj = players.reduce((s, c) => s + c.proj, 0);
  const out = { ids, salary, proj: round2(proj) };
  // TwoGun's ceilings summed, only on a board that carries them (so a current-mode answer is unchanged); null, never
  // a partial sum, when any player lacks one.
  if (st.hasCeil) out.ceil = players.every((c) => c.ceil !== null) ? round2(players.reduce((s, c) => s + c.ceil, 0)) : null;
  return out;
}

/** Per position, every player in the saved plus new lineups: {id, name, count, pct}, most-used first. */
function exposureOf(st, prevKeys, opts) {
  const out = emptyExposure();
  const total = prevKeys.length;
  if (!total) return out;
  const counts = new Map();
  for (const keys of prevKeys) for (const k of new Set(keys)) counts.set(k, (counts.get(k) ?? 0) + 1);
  const rowByKey = new Map();
  if (st.byId) for (const [id, row] of st.byId) if (!rowByKey.has(st.keyOfId.get(id))) rowByKey.set(st.keyOfId.get(id), { id, row });
  for (const [key, count] of counts) {
    const cand = st.candByKey ? st.candByKey.get(key) : null;
    const hit = cand ? { id: cand.id, row: st.byId.get(cand.id) } : rowByKey.get(key);
    if (!hit) continue;
    const pos = rowPos(hit.row);
    if (!pos) continue;
    out[pos].push({ id: hit.id, name: hit.row.name ?? hit.id, count, pct: round1((count / total) * 100) });
  }
  for (const pos of POSITIONS) out[pos].sort((a, b) => b.count - a.count || cmpId(a.name, b.name));
  return out;
}
