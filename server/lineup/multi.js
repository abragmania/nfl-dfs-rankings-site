// The Optimizer's engine (PROJECT.md Part 4 "Optimizer"; DECISIONS.md D55 as amended 2026-10-10): N DraftKings
// classic lineups, one at a time, each the highest-projection lineup that keeps every rule Adam has switched on,
// every lock, the uniqueness he set against his saved lineups and every earlier lineup of the batch, and the
// per-position exposure caps as they stand at that moment. It is a pure function over board rows: no network, no
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
import { rowIsSidelined } from "../rank/sidelined.js"; // pure: the public site runs this engine in the browser (D69)
import { assignSlots } from "./dk-entries.js";
import { warn } from "../lib/log.js";

// --------------------------------------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------------------------------------

const POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "DST"]);
const SLOT_COUNT = 9;
/** The most players of each position a classic lineup can hold (FLEX included). */
const MAX_AT = Object.freeze({ QB: 1, RB: 3, WR: 4, TE: 2, DST: 1 });
/** The three position mixes the FLEX allows. Every legal lineup is exactly one of them. */
const CONFIGS = Object.freeze([
  Object.freeze({ QB: 1, RB: 3, WR: 3, TE: 1, DST: 1 }),
  Object.freeze({ QB: 1, RB: 2, WR: 4, TE: 1, DST: 1 }),
  Object.freeze({ QB: 1, RB: 2, WR: 3, TE: 2, DST: 1 })
]);
const GROUP_ORDER = Object.freeze(["QB", "RB", "WR", "TE", "DST"]);
const DEFAULT_CAP = 50000; // D1; optimize.js uses the same default and the board carries no cap of its own
const MAX_LINEUPS = 150;
const CATCHER_MIN_REC = 3.0; // D55: a "regular pass catcher" is projected for 3.0 or more catches
const SCORE_SCALE = 1e6;
const MAX_UNITS = 2000; // salary resolution of the knapsack bound
// A counter, never a clock, so two runs on the same input always agree. Generous: the real week 5 board needs a
// few hundred thousand nodes per lineup.
const NODE_LIMIT = 40000000;
const DIAG_NODE_LIMIT = 3000000;
const BATCH_NODE_LIMIT = 200000000; // the whole request, so 150 slow lineups can never run away

/** Adam's D55 rules, each a toggle, all on unless he switches one off. */
export const RULE_KEYS = Object.freeze([
  "starredQbOnly",
  "qbStack",
  "rbWithOwnQbOnlyIfCatcher",
  "oneOffensivePerOtherTeam",
  "noSameTeamRbs",
  "noSameGameRbs",
  "noDstVsOwnPlayers"
]);

const RULE_LABELS = Object.freeze({
  starredQbOnly: "only starred quarterbacks",
  qbStack: "the quarterback needs at least one teammate (a running back counts only as a regular pass catcher)",
  rbWithOwnQbOnlyIfCatcher: "a running back with his own quarterback only if he is a regular pass catcher",
  oneOffensivePerOtherTeam: "at most one offensive player from each team other than the quarterback's",
  noSameTeamRbs: "no two running backs from the same team",
  noSameGameRbs: "no two running backs from the same game",
  noDstVsOwnPlayers: "no defense facing a player in the same lineup"
});

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

function lookup(mapOrObject, id) {
  if (!mapOrObject) return undefined;
  if (typeof mapOrObject.get === "function") return mapOrObject.get(id);
  return mapOrObject[id];
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
function dkKeyOf(row, id) {
  const raw = row.dkId === null || row.dkId === undefined ? "" : String(row.dkId).trim();
  return raw ? `dk:${raw}` : `id:${id}`;
}

function rowPos(row) {
  const pos = upper(row.pos);
  if (POSITIONS.includes(pos)) return pos;
  const list = Array.isArray(row.rosterPositions) ? row.rosterPositions.map(upper).filter((p) => p && p !== "FLEX") : [];
  return list.find((p) => POSITIONS.includes(p)) ?? null;
}

function listNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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

  // Exposure: {pct: 50} is a percentage of all lineups (saved plus this batch as asked for), {count: 3} a lineup
  // count. Anything else is ignored with a note (the route refuses it). Nothing set means no cap (D55 amended).
  const totalLineups = existingCount + count;
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
      n = Math.floor((raw.pct / 100) * totalLineups + 1e-9);
      label = `${raw.pct}%`;
      capPct[pos] = raw.pct;
      if (n === 0 && raw.pct > 0) {
        notes.push(`The ${pos} maximum exposure of ${raw.pct}% of ${totalLineups} lineups rounds down to 0, so no ${pos} can be used unless he is locked.`);
      }
    } else {
      notes.push(`The ${pos} maximum exposure must be given as {pct} or {count}; ${JSON.stringify(raw)} was ignored, so ${pos} has no cap.`);
      continue;
    }
    capCount[pos] = n;
    capLabel[pos] = label;
  }

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
    existingCount,
    maxPerTeam,
    locks: idList(s.locks),
    excludes: new Set(idList(s.excludes)),
    allowRbGames: new Set(idList(s.allowRbGames).map(upper)),
    avoidGames: new Set(idList(s.avoidGames).map(upper)),
    fpCatches: s.fpCatches ?? null,
    catchers: new Set(idList(s.catchers)),
    noTrim: Boolean(s._noTrim),
    nodeLimit: num(s._nodeLimit) ?? NODE_LIMIT,
    batchNodeLimit: num(s._batchNodeLimit) ?? BATCH_NODE_LIMIT,
    diagNodeLimit: num(s._diagNodeLimit) ?? DIAG_NODE_LIMIT,
    stats: s._stats && typeof s._stats === "object" ? s._stats : null
  };
}

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
 *   maxExposure: {QB, RB, WR, TE, DST}, each {pct} (percent of saved plus the lineups asked for) or {count}; per
 *     player, over existing plus batch; default none. Any other form is ignored with a note.
 *   rules: {starredQbOnly, qbStack, rbWithOwnQbOnlyIfCatcher, oneOffensivePerOtherTeam, noSameTeamRbs,
 *     noSameGameRbs, noDstVsOwnPlayers}, each boolean, all true by default.
 *   allowRbGames, avoidGames: game keys as on the board (row.gameId, e.g. "DET@ARI").
 *   maxPerTeam: most players (defense included) from one team, as optimize.js maxFromTeam; default none.
 *   fpCatches: Map or object id -> FantasyPros projected catches; when absent, row.fpRec is read instead. The D55
 *     pass-catcher test uses FantasyPros' number first, then the board's all-source average row.projStats.rec.
 *     catchers: ids Adam names as pass catchers whatever the number.
 * @param {Array}    [args.existing] Adam's saved lineups (arrays of ids, or objects with ids/lineup/players/slots)
 * @returns {{lineups: Array<{ids: string[], salary: number, proj: number}>, exposure: object, notes: string[]}}
 *   ids are in DraftKings slot order QB, RB, RB, WR, WR, WR, TE, FLEX, DST. Never throws.
 */
export function generateLineups(args) {
  const notes = [];
  try {
    const { rows, slate, settings, existing } = args ?? {};
    return run(rows, slate, settings, existing, notes);
  } catch (e) {
    warn("lineup: generate failed", { error: e && e.message });
    notes.push(`Could not make lineups: ${e && e.message ? e.message : "unexpected error"}.`);
    return { lineups: [], exposure: emptyExposure(), notes };
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
    return { lineups: [], exposure: emptyExposure(), notes };
  }
  const existingList = Array.isArray(existing) ? existing.map(idsOfExisting).filter((ids) => ids.length) : [];
  const opts = normaliseSettings(settings, slate, existingList.length, notes);

  const st = prepare(rows, opts, notes);
  if (st.fatal) {
    notes.push(st.fatal);
    return { lineups: [], exposure: exposureOf(st, existingList.map((ids) => ids.map((id) => st.keyOfId.get(id) ?? `id:${id}`)), opts), notes };
  }

  // Saved lineups, as DK keys (two board rows of one man count as one player).
  const prevKeys = existingList.map((ids) => ids.map((id) => st.keyOfId.get(id) ?? `id:${id}`));
  const unknown = new Set();
  for (const ids of existingList) for (const id of ids) if (!st.keyOfId.has(id)) unknown.add(id);
  if (unknown.size) {
    notes.push(`${unknown.size} player${unknown.size === 1 ? "" : "s"} in the saved lineups ${unknown.size === 1 ? "is" : "are"} not on this board; they still count for uniqueness but not for exposure by position.`);
  }

  const prev = makePrevIndex(st, prevKeys, opts.count);
  const counts = new Map();
  for (const keys of prevKeys) for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);

  // Locks above a position's exposure cap: the lock wins (every lineup must hold him), and Adam is told.
  for (const c of st.lockCands) {
    const capN = opts.capCount[c.pos];
    if (capN !== undefined && (counts.get(c.key) ?? 0) + opts.count > capN) {
      notes.push(`${c.name} is locked, so he is in every new lineup even though that takes him past the ${c.pos} maximum exposure (${opts.capLabel[c.pos]}).`);
    }
  }

  if (opts.stats) opts.stats.exactSalaryUnits = st.exact;
  const lineups = [];
  let aborted = false;
  let batchNodes = 0;
  for (let n = 0; n < opts.count; n++) {
    const avail = availableLists(st, opts, counts, prev);
    const batchLeft = opts.batchNodeLimit - batchNodes;
    const batchBinds = batchLeft <= opts.nodeLimit;
    const result = searchOne(st, avail, prev, opts, Math.max(0, Math.min(opts.nodeLimit, batchLeft)));
    batchNodes += result.nodes;
    if (opts.stats) {
      opts.stats.nodes = (opts.stats.nodes ?? 0) + result.nodes;
      opts.stats.trimmed = (opts.stats.trimmed ?? 0) + avail.trimmed;
    }
    if (result.aborted && batchBinds) {
      // The whole request's step budget is spent: the lineup in hand is not proven best, so it is dropped.
      notes.push(`The search hit its step limit of ${opts.batchNodeLimit.toLocaleString("en-US")} for the whole request while making lineup ${n + 1} of ${opts.count}; ${lineups.length ? `the ${lineups.length} made before it are returned` : "no lineups were made"}.`);
      break;
    }
    if (result.aborted) aborted = true;
    if (!result.best) {
      const why = result.aborted
        ? `the search stopped at its limit of ${opts.nodeLimit.toLocaleString("en-US")} steps without finding one`
        : diagnose(rows, settings, slate, existingList.length, prevKeys, opts, n);
      notes.push(`Lineup ${n + 1} of ${opts.count} could not be made: ${why}. ${lineups.length ? `The ${lineups.length} made before it are returned.` : "No lineups were made."}`);
      break;
    }
    const players = result.best;
    const keys = players.map((c) => c.key);
    prevKeys.push(keys);
    addPrev(prev, keys);
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    lineups.push(presentLineup(st, players));
  }
  if (aborted && lineups.length) {
    notes.push(`The search hit its step limit on at least one lineup, so that lineup may not be the very best available.`);
  }
  const pctCaps = Object.entries(opts.capPct);
  if (lineups.length < opts.count && pctCaps.length) {
    const saved = opts.existingCount ? ` plus ${opts.existingCount} saved` : "";
    notes.push(`The percentage caps (${pctCaps.map(([pos, p]) => `${pos} ${p}%`).join(", ")}) were sized for the ${opts.count} lineups asked for${saved}, not the ${lineups.length} made.`);
  }
  return { lineups, exposure: exposureOf(st, prevKeys, opts), notes };
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
  const st = { keyOfId, byId, fatal: null, cap: opts.cap, rules: opts.rules, maxPerTeam: opts.maxPerTeam, minUnique: opts.minUnique };

  const lockSet = new Set(opts.locks);
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
    st.fatal = `${opts.locks.length} players are locked but a lineup has only nine slots.`;
    return st;
  }

  const teamIx = new Map();
  const gameIx = new Map();
  const ix = (map, key) => {
    if (!map.has(key)) map.set(key, map.size);
    return map.get(key);
  };

  const byKey = new Map();
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
    const proj = num(row.proj);
    const flags = Array.isArray(row.flags) ? row.flags : [];
    const overridden = num(row.override && row.override.proj) !== null;
    const noProjection = proj === null || (!overridden && flags.includes("no projection"));
    const sidelined = rowIsSidelined(row);
    const game = upper(row.gameId) || null;
    const avoided = game !== null && opts.avoidGames.has(game);
    const unstarredQb = opts.rules.starredQbOnly && pos === "QB" && !row.starred;
    if (!locked && (noProjection || sidelined || avoided || unstarredQb)) continue;
    if (locked) {
      if (sidelined) notes.push(`Locked ${name} is listed ${row.status ?? "injured"}; he is kept because he is locked.`);
      if (noProjection) notes.push(`Locked ${name} has no projection from any source and counts as ${proj === null ? "0" : `his stand-in ${round2(proj)}`}.`);
      if (avoided) notes.push(`Locked ${name} plays in ${game}, a game set to avoid; he is kept because he is locked.`);
      if (unstarredQb) notes.push(`Locked ${name} is not starred; he is used because he is locked.`);
    }

    let catcher = false;
    if (pos === "RB") {
      if (opts.catchers.has(id)) catcher = true;
      else {
        const fpRaw = opts.fpCatches ? lookup(opts.fpCatches, id) : row.fpRec;
        const fp = num(Number(fpRaw ?? NaN));
        const rec = fp !== null ? fp : num(row.projStats && row.projStats.rec);
        catcher = rec !== null && rec >= CATCHER_MIN_REC;
      }
    }

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
      score: Math.round((proj ?? 0) * SCORE_SCALE),
      catcher,
      stackOk: pos === "WR" || pos === "TE" || (pos === "RB" && catcher),
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
      st.fatal = `${locksAt[pos]} ${pos}s are locked but a lineup holds at most ${MAX_AT[pos]}.`;
      return st;
    }
  }
  if (locksAt.RB + locksAt.WR + locksAt.TE > 7 || !CONFIGS.some((cfg) => POSITIONS.every((p) => locksAt[p] <= cfg[p]))) {
    st.fatal = `The locked running backs, receivers and tight ends (${locksAt.RB} RB, ${locksAt.WR} WR, ${locksAt.TE} TE) do not fit the RB, RB, WR, WR, WR, TE and FLEX slots.`;
    return st;
  }
  const lockSalary = lockCands.reduce((s, c) => s + c.salary, 0);
  if (lockSalary > opts.cap) {
    st.fatal = `The locked players cost ${money(lockSalary)}, which is already over the ${money(opts.cap)} cap.`;
    return st;
  }
  st.lockSalary = lockSalary;

  st.pool = all.filter((c) => !c.locked);
  const byPos = {};
  for (const pos of POSITIONS) byPos[pos] = st.pool.filter((c) => c.pos === pos).sort(cmpCand);
  st.byPos = byPos;

  // Teams that could be the quarterback's: the locked QB's, or every QB in the pool.
  const lockedQb = lockCands.find((c) => c.pos === "QB");
  st.qbTeams = new Set(lockedQb ? [lockedQb.teamIx] : byPos.QB.map((c) => c.teamIx));

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

function availableLists(st, opts, counts, prev) {
  const out = { trimmed: 0 };
  for (const pos of POSITIONS) {
    const capN = opts.capCount[pos];
    let list = st.byPos[pos];
    if (capN !== undefined) list = list.filter((c) => (counts.get(c.key) ?? 0) < capN);
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
 * a smaller id (and, for a running back, a pass catcher whenever p is one). For any legal lineup M holding p,
 * M - p + q is cheaper or equal, projects at least as much and ranks strictly ahead of M; it is legal whenever
 * q is not already in M and q's team is not blocked by a team rule. So p can go once, for every possible M, at
 * least one dominator survives both:
 *   - at most need - 1 dominators are in M already (need = the most non-locked players of this position a
 *     lineup can hold);
 *   - the team rules block at most `b` whole teams: the other non-quarterback-team offensive players' teams
 *     (6), the other backs' teams (2) and games (4 teams), the defense's opponent (1), the quarterback's team for
 *     a back who is not a catcher (1), teams at the per-team cap (8 / cap), and the one game the rest of M might
 *     sit in (2). For a defense: the teams of M's eight offensive players (8), the game (2), the per-team cap.
 *   A dominator from p's OWN team keeps every team rule exactly as it was, so `need` same-team dominators are
 *   always enough. Cross-team dominators are not used for a quarterback (his team decides the stack) or for a
 *   player who may be his quarterback's only stack partner (the partner must be a teammate). A dominator in an
 *   earlier lineup could make M - p + q a repeat, so only unused players count. The test file checks that
 *   trimming never changes the answer.
 */
function trimPosition(list, pos, st, opts, prev) {
  if (list.length <= 1) return list;
  const rules = opts.rules;
  const need = Math.max(1, MAX_AT[pos] - st.locksAt[pos]);
  const perTeamCap = opts.maxPerTeam ? Math.floor(8 / opts.maxPerTeam) : 0;
  let b;
  if (pos === "QB") b = Infinity;
  else if (pos === "DST") b = (rules.noDstVsOwnPlayers ? 8 : 0) + 2 + perTeamCap;
  else {
    b = (rules.oneOffensivePerOtherTeam ? 6 : 0) + (rules.noDstVsOwnPlayers ? 1 : 0) + 2 + perTeamCap;
    if (pos === "RB") {
      b += (rules.noSameTeamRbs ? 2 : 0) + (rules.noSameGameRbs ? 4 : 0) + (rules.rbWithOwnQbOnlyIfCatcher ? 1 : 0);
    }
  }
  const usable = list.filter((q) => !prev.usedKeys.has(q.key));
  const kept = [];
  for (const p of list) {
    let sameTeam = 0;
    let total = 0;
    const byTeam = new Map();
    for (const q of usable) {
      if (q === p) continue;
      if (q.salary > p.salary || q.score < p.score) continue;
      if (q.salary === p.salary && q.score === p.score && cmpId(q.id, p.id) >= 0) continue;
      if (pos === "RB" && p.catcher && !q.catcher) continue;
      total++;
      if (q.teamIx === p.teamIx) sameTeam++;
      byTeam.set(q.teamIx, (byTeam.get(q.teamIx) ?? 0) + 1);
    }
    if (sameTeam >= need) continue; // same-team replacement: always safe
    const soleMate = rules.qbStack && p.stackOk && st.qbTeams.has(p.teamIx);
    if (b !== Infinity && !soleMate && total >= need) {
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
  let dstOpp = -1;
  let mates = 0;
  let nodes = 0;
  let aborted = false;

  let bestScore = -Infinity;
  let bestSalary = Infinity;
  let best = null;

  function canAdd(c) {
    if (maxPerTeam !== null && teamN[c.teamIx] >= maxPerTeam) return false;
    if (c.pos === "DST") {
      if (dstOpp !== -1) return false;
      if (rules.noDstVsOwnPlayers && c.oppIx >= 0 && offN[c.oppIx] > 0) return false;
    } else if (c.pos === "QB") {
      if (qbTeam !== -1) return false;
      for (const p of placed) {
        if (p.pos === "DST") {
          if (rules.noDstVsOwnPlayers && p.oppIx === c.teamIx) return false;
          continue;
        }
        if (rules.oneOffensivePerOtherTeam && p.teamIx !== c.teamIx && offN[p.teamIx] > 1) return false;
        if (rules.rbWithOwnQbOnlyIfCatcher && p.pos === "RB" && p.teamIx === c.teamIx && !p.catcher) return false;
      }
    } else {
      if (rules.oneOffensivePerOtherTeam && qbTeam !== -1 && c.teamIx !== qbTeam && offN[c.teamIx] > 0) return false;
      if (rules.noDstVsOwnPlayers && c.teamIx === dstOpp) return false;
      if (c.pos === "RB") {
        if (rules.noSameTeamRbs && rbTeamN[c.teamIx] > 0) return false;
        if (rules.noSameGameRbs && rbGameN[c.gameIx] > 0 && !allowRbGame[c.gameIx]) return false;
        if (rules.rbWithOwnQbOnlyIfCatcher && c.teamIx === qbTeam && !c.catcher) return false;
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
        mates = 0;
        for (const p of placed) if (p !== c && p.stackOk && p.teamIx === qbTeam) mates++;
      } else {
        if (c.pos === "RB") {
          rbTeamN[c.teamIx]++;
          rbGameN[c.gameIx]++;
        }
        if (c.teamIx === qbTeam && c.stackOk) mates++;
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
        mates = 0;
      } else {
        if (c.pos === "RB") {
          rbTeamN[c.teamIx]--;
          rbGameN[c.gameIx]--;
        }
        if (c.teamIx === qbTeam && c.stackOk) mates--;
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
    const mateLast = new Int32Array(groups.length + 1).fill(-1);
    const setMates = () => {
      for (let h = 0; h < groups.length; h++) {
        mateLast[h] = -1;
        const list = lists[h];
        for (let j = list.length - 1; j >= 0; j--) {
          if (list[j].stackOk && list[j].teamIx === qbTeam) {
            mateLast[h] = j;
            break;
          }
        }
      }
    };
    if (qbTeam !== -1) setMates();

    const leaf = (score, rem) => {
      if (games < 2) return;
      if (rules.qbStack && mates === 0) return;
      const salary = st.cap - rem;
      if (score > bestScore || (score === bestScore && (salary < bestSalary || (salary === bestSalary && keyLess(placed, best))))) {
        bestScore = score;
        bestSalary = salary;
        best = placed.slice();
      }
    };

    const dfs = (gi, kRem, start, rem, score) => {
      if (++nodes > nodeLimit) {
        aborted = true;
        return;
      }
      if (gi === groups.length) {
        leaf(score, rem);
        return;
      }
      if (rules.qbStack && qbTeam !== -1 && mates === 0) {
        let possible = false;
        for (let h = gi; h < groups.length && !possible; h++) possible = mateLast[h] >= (h === gi ? start : 0);
        if (!possible) return;
      }
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

/** Re-runs the failed lineup with one setting relaxed at a time and names those whose relaxation alone would let
 *  it through. Bounded by a step counter, so it always finishes. */
function diagnose(rows, settings, slate, existingCount, prevKeys, opts, n) {
  const base = settings && typeof settings === "object" ? settings : {};
  const trials = [];
  for (const key of RULE_KEYS) {
    if (opts.rules[key]) trials.push({ label: `the rule "${RULE_LABELS[key]}"`, patch: { rules: { ...(base.rules || {}), [key]: false } } });
  }
  if (opts.minUnique > 1) trials.push({ label: `minimum unique players (${opts.minUnique})`, patch: { minUnique: 1 } });
  if (Object.keys(opts.capCount).length) trials.push({ label: "the maximum exposure settings", patch: { maxExposure: {} } });
  if (opts.maxPerTeam !== null) trials.push({ label: `the limit of ${opts.maxPerTeam} per team`, patch: { maxPerTeam: null } });
  if (opts.avoidGames.size) trials.push({ label: "the games to avoid", patch: { avoidGames: [] } });
  if (opts.locks.length) trials.push({ label: "the locks", patch: { locks: [] } });

  const found = [];
  const unchecked = [];
  for (const t of trials) {
    const scratch = [];
    const o2 = normaliseSettings({ ...base, ...t.patch, count: opts.count }, slate, existingCount, scratch);
    // Exposure caps were sized for the whole request; keep the same counts so only the patched setting differs.
    if (!("maxExposure" in t.patch)) {
      o2.capCount = opts.capCount;
    }
    const st2 = prepare(rows, o2, scratch);
    if (st2.fatal) continue;
    const prev2 = makePrevIndex(st2, prevKeys, 1);
    const counts = new Map();
    for (const keys of prevKeys) for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    const avail = availableLists(st2, o2, counts, prev2);
    const r = searchOne(st2, avail, prev2, o2, opts.diagNodeLimit);
    if (r.best) found.push(t.label);
    else if (r.aborted) unchecked.push(t.label);
  }
  const uncheckedText = unchecked.length ? `; these could not be checked in time: ${unchecked.join("; ")}` : "";
  if (found.length) {
    return `no lineup keeps every setting; relaxing ${found.length === 1 ? "this one alone" : "any one of these alone"} would allow one: ${found.join("; ")}${uncheckedText}`;
  }
  if (unchecked.length) {
    return `no lineup keeps every setting; no single setting was found to be the cause${uncheckedText}`;
  }
  return `no lineup keeps every setting, and no single setting is the cause (the rules together, the locks${n > 0 || existingCount > 0 ? ", the earlier lineups" : ""} and the ${money(opts.cap)} cap leave nothing legal)`;
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
  return { ids, salary, proj: round2(proj) };
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
