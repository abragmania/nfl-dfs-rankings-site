// The Optimizer engine's constants, small helpers and settings (split from multi.js under R87, moved not edited; see multi.js for the engine's description).
import { rowIsOut, statusSetting, inNeedsNumber, twogunCallsOut } from "../rank/sidelined.js"; // pure: the public site runs this engine in the browser (D69)
import { parseEntries, globalRule } from "./qb-stacks.js"; // pure; per-QB stack settings
import { FIGURE_BUILDS, figureOf, retiredObjectiveNote } from "./objective.js"; // pure; cash mode job 1, 2026-10-17
import { resolveVariance, varianceIgnoredNotes, CLASSIC_VARIANCE_POSITIONS } from "./sd-variance.js"; // pure; GPP variance per position (PROJECT.md Part 4 item 5, Adam 2026-11-11)
import { validateCountRules } from "./count-rules.js"; // pure; team, game and ownership rules (items 8 and 9, Adam 2026-11-16)

// --------------------------------------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------------------------------------

const POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "DST"]);
const SLOT_COUNT = 9;
const GROUP_ORDER = Object.freeze(["QB", "RB", "WR", "TE", "DST"]);
const DEFAULT_CAP = 50000; // D1; optimize.js uses the same default and the board carries no cap of its own
const MAX_LINEUPS = 150;
const SCORE_SCALE = 1e6;
const LAG_WEIGHTS = Object.freeze([1, 3, 8]); // points a man of a tight at-least rule's set is raised by in the rule-aware bound tables (configTables); each weight is its own valid bound
const LAG_RULES = 2; // the tightest at-least rules (the largest counts, at 3 or more) that get those tables
const MAX_UNITS = 2000; // salary resolution of the knapsack bound
const MAX_REBUILD_SALARY_STEPS = 1000; // a real slate's prices move in $100 steps: 501
// No step limit on the lineups (Adam 2026-11-03): a build ends on finishing, the ten minute limit (server/lib/app-build.js,
// site-src/site-worker.js) or Stop, and every lineup served is proven best. The one counters left are the quarterback pre-checks':
// each search's own limit and one total for all the checks and their diagnoses (the old half of the request's budget), so they
// can never eat the build; they only write notes and never choose or change a lineup.
const DIAG_NODE_LIMIT = 3000000;
const CHECK_TOTAL_LIMIT = 300000000;

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

/** What the lineups maximise: "proj" (projection, as optimize.js scores it) only; "ceil" was removed (optimizer standard A21,
 *  2026-11-03) and is refused. The retired "lev" and "projMinusOwn" are built on projection with optimize.js retiredObjectiveNote's note. */
import { OBJECTIVES } from "./objectives.js"; // the names live in a leaf so request checks need not load this engine
export { OBJECTIVES };

/** D73: the most teammates and opponents the QB stack can ask for, and the defaults (1 or more, 0 or more). */
export const STACK_OWN_MAX = 4;
export const STACK_OPP_MAX = 3;
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

/** The note for a man the board lists out who is kept because he is locked ("Locked"; the showdown Optimizer says it of an
 *  included man too, word "Included"). One copy: showdown-pool.js keptNotes (Generate and Build) uses it. `status`: his listed status (statusWordOf(row));
 *  `markedOut`: Adam's own Out set him out, so the note says he did, not the injury report. */
export function keptSidelinedNote(name, status, word = "Locked", markedOut = false) {
  if (markedOut) return `${word} ${name}: you marked him Out; he is kept because he is ${word.toLowerCase()}.`;
  return `${word} ${name} is listed ${status ?? "injured"}; he is kept because he is ${word.toLowerCase()}.`;
}

/** The note for a man kept because he is locked ("Locked"; the showdown Optimizer says it of an included man too, word
 *  "Included") who has no projection from any source. One copy: showdown-pool.js keptNotes uses it. */
export function noSourceProjectionNote(name, word = "Locked") {
  return `${word} ${name} has no projection from any source and counts as 0.`;
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

  // The objective: projection; a retired one is built on projection with a note, never refused.
  let fatal = null;
  const asked = s.objective === undefined || s.objective === null ? "proj" : String(s.objective);
  const retiredNote = retiredObjectiveNote(asked);
  if (retiredNote) notes.push(retiredNote);
  const objective = retiredNote ? "proj" : asked;
  const cash = s._cash === true; // cash mode job 1, 2026-10-17: set only by cash.js cashEngineSettings, never by a request
  if (!OBJECTIVES.includes(objective) && !(cash && objective === "median")) {
    fatal = `The objective "${objective}" is not one the Optimizer knows; use Projection.`;
  }
  // Team, game and ownership rules (count-rules.js): hard, never bent. The route checks them first; a list that still fails here is refused whole, never partly used.
  const countChecked = validateCountRules(s.countRules);
  if (countChecked.error && fatal === null) fatal = `The team, game and ownership rules were refused: ${countChecked.error}`;

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

  // GPP variance (sd-variance.js): {pos: pct} above 0, or null (off, the unvaried path); cash never varies (cash.js drops it and says so).
  notes.push(...varianceIgnoredNotes(s, CLASSIC_VARIANCE_POSITIONS)); // the route refuses these first

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
    capAllTeams: cash && s.capAllTeams === true,
    variance: cash ? null : resolveVariance(s, CLASSIC_VARIANCE_POSITIONS),
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
    countRules: countChecked.rules ?? [],
    recheckRules: Array.isArray(s._recheckRules) ? s._recheckRules : null, // tests only: the rules the invariant re-checks, so a break can be reached
    noTrim: Boolean(s._noTrim),
    diagNodeLimit: num(s._diagNodeLimit) ?? DIAG_NODE_LIMIT,
    checkTotalLimit: num(s._checkTotalLimit) ?? CHECK_TOTAL_LIMIT, // tests only to change
    checkUsed: 0, // nodes the quarterback checks and their diagnoses have used, against checkTotalLimit
    deadline: num(s._deadline) ?? undefined, // epoch ms: the page-thread fallback's ten minute limit (site-src/site-worker.js); none in the app's worker
    bendNodeLimit: num(s._bendNodeLimit) ?? Infinity, // tests only; a bend's trials have no limit in use
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
  const figureBuild = Object.hasOwn(FIGURE_BUILDS, opts.objective);
  const figure = figureBuild ? figureOf(row, opts.objective) : null;
  // Cash 2b fix, 2026-10-17: projMissing (none, or flagged "no projection" with no typed one) makes a median lineup's proj null, never a partial sum.
  const projMissing = proj === null || (!overridden && flags.includes("no projection"));
  return {
    proj, overridden, game, projMissing,
    // Cash mode job 2b, 2026-10-17: in a median build medianOf alone decides (noCeiling below: no figure), never the projection.
    noProjection: opts.objective !== "median" && projMissing,
    needsNumber: inNeedsNumber(row), // Adam's In with no number from any source: the skip reason says to type one
    sidelined: rowIsOut(row),
    avoided: game !== null && opts.avoidGames.has(game),
    unstarredQb: opts.rules.starredQbOnly && pos === "QB" && !row.starred,
    noCeiling: figureBuild && figure === null,
    // ChatGPT wish r, Adam 2026-10-17 (D25, D27): a listed-out player brought back by a typed projection stays in a median
    // build on his own published median; he is left out (unless locked) only when he has none or TwoGun calls him OUT.
    // revivedOut is the reason ("noCeiling", meaning no figure, or "calledOut") or false.
    revivedOut: figureBuild && flags.includes("revived") && (figure === null || twogunCallsOut(row))
      ? (figure === null ? "noCeiling" : "calledOut") : false,
    lateOut: outAfterStamp(flags) && statusSetting(row) !== "in" // Adam's own In clears it (2026-11-12)
  };
}

/** Why a revived (listed-out, typed projection) player is out of a median build, by rowFlags' revivedOut reason. */
const REVIVED_OUT_WORDS = {
  noCeiling: (word) => `he is listed out with no TwoGun ${word} to build on`,
  calledOut: () => "he is listed out and TwoGun calls him OUT"
};

/** D73: the stack constraints that bind at all ("0 or more" binds nothing). */
const ownStackActive = (opts) => !(opts.stackOwn === 0 && opts.stackOwnOrMore);
const oppStackActive = (opts) => !(opts.stackOpp === 0 && opts.stackOppOrMore);

export {
  POSITIONS, SLOT_COUNT, GROUP_ORDER, SCORE_SCALE, LAG_WEIGHTS, LAG_RULES, MAX_UNITS, MAX_REBUILD_SALARY_STEPS, RULE_LABELS, stackWords,
  num, round2, round1, cmpId, money, upper, gcd, idsOfExisting, rowPos, anyStarredQb, normaliseSettings, stackRuleOf, rowFlags,
  REVIVED_OUT_WORDS, ownStackActive, oppStackActive
};
