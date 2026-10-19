// Lineup optimiser for the DraftKings classic slate (PROJECT.md D1: QB, RB, RB, WR, WR, WR, TE, FLEX (RB/WR/TE),
// DST, $50,000 cap). It is a pure function over board rows (server/rank/board.js gives id, dkId, name, pos,
// rosterPositions, team, opp, gameId, salary, proj, own, value, flags, status): no network, no date or time
// logic at all (D30). It reads no file, so the public site can run it in a browser (DECISIONS.md D71). It
// maximises projection; the "lev" and "projMinusOwn" objectives are retired (Adam 2026-10-15, Lev measure to be
// redesigned; projection minus ownership removed) and a request naming one is built on projection with a note
// (retiredObjectiveNote). Overrides are already merged into the rows it receives (D28), and it only ever rosters
// players the DraftKings CSV supplied (D27).
//
// It never throws. Bad input, impossible locks, or a cap that cannot be met all come back as
// { feasible: false, message, notes: [] } with a sentence a human can act on (PROJECT.md Part 4, Lineup Builder
// screen: "infeasibility explained in a sentence"). A successful build carries its remarks in `notes` and leaves
// `message` empty, so the UI can show the infeasibility sentence and the remarks in different places.
import { warn } from "../lib/log.js";
import { rowIsOut } from "../rank/sidelined.js"; // pure: the public site runs this in a browser (D71)
import { countsTowardStack } from "./stack-rules.js";

// --------------------------------------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------------------------------------

const DEFAULT_CAP = 50000;
const DEFAULT_SLOTS = Object.freeze(["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"]);
const DEFAULT_FLEX = Object.freeze(["RB", "WR", "TE"]);
const OBJECTIVES = Object.freeze(new Set(["proj"]));

/**
 * The note a build carries when its request (or a setting saved before 2026-10-15) names a retired objective:
 * "lev" (Adam 2026-10-15, Lev measure to be redesigned) or "projMinusOwn" (Adam 2026-10-15: projection minus
 * ownership removed). Such a request is built on projection instead, never refused. Null for any other value.
 * The one copy: multi.js, showdown.js and the routes use it too.
 */
export function retiredObjectiveNote(objective) {
  if (objective === "lev") return "Leverage is no longer an objective (it has no measure yet), so these lineups maximise projection.";
  if (objective === "projMinusOwn") return "Projection minus ownership is no longer an objective, so these lineups maximise projection.";
  return null;
}
const BUILD_MODES = Object.freeze(["score", "perDollar", "cheap"]);

// Search bounds. The pool is pruned to the best TOP_PER_POS players per position by the chosen objective, plus
// CHEAP_PER_POS cheapest per position (without them a top-40-by-projection pool can be unaffordable and the
// builder would report a false infeasibility), plus every lock. Everything else is bounded by counters, never
// by a clock, so two runs on the same input always return the same lineup.
const TOP_PER_POS = 40;
const CHEAP_PER_POS = 10;
const PAIR_CANDIDATES = 20; // per slot, for the pairwise improvement pass
const MAX_IMPROVE_STEPS = 80;
const MAX_PAIR_EVALS = 400000;
const QB_STACK_OPTIONS = 10; // quarterbacks tried when a stack is required and no QB is locked

// --------------------------------------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------------------------------------

const WORDS = Object.freeze(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);
const word = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const plural = (n, s) => `${word(n)} ${s}${n === 1 ? "" : "s"}`;
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round2 = (n) => Math.round(n * 100) / 100;

/** Plain comparison of two id strings: the ids are opaque keys, so locale rules have no business in the order,
 *  and a plain comparison sorts the same way on every machine. */
const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Locks and excludes may arrive as ids, as numbers, or as row objects; all become string ids. */
function idList(value) {
  if (value === null || value === undefined) return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of arr) {
    if (item === null || item === undefined) continue;
    const id = typeof item === "object" ? item.id : item;
    if (id === null || id === undefined) continue;
    const key = String(id);
    if (key !== "" && !out.includes(key)) out.push(key);
  }
  return out;
}

/** The real positions a row can play, ignoring the FLEX marker DraftKings puts in Roster Position. */
function rowPositions(row) {
  const list = Array.isArray(row.rosterPositions) ? row.rosterPositions.map((p) => String(p).trim().toUpperCase()) : [];
  const real = list.filter((p) => p && p !== "FLEX");
  if (real.length) return real;
  const pos = row.pos ? String(row.pos).trim().toUpperCase() : "";
  return pos ? [pos] : [];
}

/** The key that decides "this is the same DraftKings player". Two board rows can carry the same DraftKings id
 *  (the same man listed twice), and rostering both would be an illegal lineup on the site, so the DK id is the
 *  identity the optimiser counts by; the board id is the fallback when the CSV had no DK id. */
function dkKeyOf(row, id) {
  const raw = row.dkId === null || row.dkId === undefined ? "" : String(row.dkId).trim();
  return raw ? `dk:${raw}` : `id:${id}`;
}

/**
 * Slot legality. A row fits a named slot when that slot is one of its roster positions (falling back to its
 * Position column when Roster Position is missing). The FLEX slot takes any row whose real position is in
 * flexPositions, which is what keeps a QB or DST out of FLEX on the default configuration.
 */
function eligibleForSlot(cand, slot, flexPositions) {
  if (slot === "FLEX") return cand.positions.some((p) => flexPositions.includes(p));
  return cand.positions.includes(slot);
}

/** Objective score for one row: his projection. A missing projection counts as 0 so a locked player without one
 *  never poisons the arithmetic (his zero is reported as a note instead). */
function scoreOf(row) {
  return num(row.proj) ?? 0;
}

/** The optimiser's infeasible answer (exported so a caller with no lineup to build answers in the same shape). */
export function failure(message, cap) {
  return {
    lineup: [],
    salaryUsed: 0,
    salaryLeft: cap,
    totalProj: 0,
    totalOwn: 0,
    feasible: false,
    message,
    notes: []
  };
}

// --------------------------------------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------------------------------------

/**
 * Build the best legal lineup it can.
 *
 * @param {Array<object>} rows       board rows (server/rank/board.js)
 * @param {object}  [options]
 * @param {Array}   [options.locks]          player ids that must appear
 * @param {Array}   [options.excludes]       player ids that must not appear
 * @param {string}  [options.objective]      "proj" (the retired "lev" and "projMinusOwn" build on projection, with a note)
 * @param {number}  [options.cap]            salary cap, default 50000 (D1)
 * @param {Array}   [options.slots]          slot names in display order, default the classic nine (D1)
 * @param {Array}   [options.flexPositions]  positions the FLEX slot accepts, default RB/WR/TE (D1)
 * @param {number}  [options.maxFromTeam]    most players from one NFL team, null for no limit
 * @param {number}  [options.stackQbWith]    minimum RB/WR/TE from each rostered QB's own team
 * @returns {{lineup:Array,salaryUsed:number,salaryLeft:number,totalProj:number,totalOwn:(number|null),feasible:boolean,message:string,notes:Array<string>}}
 */
export function optimizeLineup(rows, options = {}) {
  const cap = num(options && options.cap) ?? DEFAULT_CAP;
  let result;
  try {
    result = run(rows, options || {}, cap);
  } catch (e) {
    warn("lineup: optimise failed", { error: e && e.message });
    result = failure(`Could not build a lineup: ${e && e.message ? e.message : "unexpected error"}.`, cap);
  }
  // Adam 2026-10-15: a request naming a retired objective is told so whatever happens, an infeasible build included.
  const retiredNote = retiredObjectiveNote(options && options.objective);
  if (retiredNote && !result.notes.includes(retiredNote)) result = { ...result, notes: [retiredNote, ...result.notes] };
  return result;
}

function run(rows, options, cap) {
  // ---- validate options ---------------------------------------------------------------------------------
  if (!Array.isArray(rows) || rows.length === 0) {
    return failure("No player rows were supplied, so there is nothing to build a lineup from.", cap);
  }
  if (!Number.isFinite(cap) || cap <= 0) {
    return failure("The salary cap must be a positive number.", DEFAULT_CAP);
  }
  const asked = options.objective === undefined || options.objective === null ? "proj" : String(options.objective);
  const retiredNote = retiredObjectiveNote(asked);
  const objective = retiredNote ? "proj" : asked;
  if (!OBJECTIVES.has(objective)) {
    return failure(`Unknown objective "${objective}". Use proj.`, cap);
  }
  const slots = (Array.isArray(options.slots) && options.slots.length ? options.slots : DEFAULT_SLOTS)
    .map((s) => String(s).trim().toUpperCase());
  if (!slots.length) return failure("The lineup has no slots to fill.", cap);
  const flexPositions = (Array.isArray(options.flexPositions) && options.flexPositions.length
    ? options.flexPositions
    : DEFAULT_FLEX).map((p) => String(p).trim().toUpperCase());
  const maxFromTeam = num(options.maxFromTeam);
  const stackQbWith = Math.max(0, Math.trunc(num(options.stackQbWith) ?? 0));

  const lockIds = idList(options.locks);
  const excludeIds = new Set(idList(options.excludes));

  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object" || row.id === null || row.id === undefined) continue;
    const key = String(row.id);
    if (!byId.has(key)) byId.set(key, row);
  }

  const clash = lockIds.filter((id) => excludeIds.has(id));
  if (clash.length) {
    const names = clash.map((id) => byId.get(id)?.name ?? id);
    return failure(
      `${names.join(", ")} ${clash.length > 1 ? "are" : "is"} both locked and excluded, so no lineup can satisfy both.`,
      cap
    );
  }
  if (lockIds.length > slots.length) {
    return failure(
      sentence(`${plural(lockIds.length, "player")} are locked but the lineup has only ${plural(slots.length, "slot")}.`),
      cap
    );
  }
  const missing = lockIds.filter((id) => !byId.has(id));
  if (missing.length) {
    return failure(
      `Locked player${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not on this slate.`,
      cap
    );
  }

  // ---- candidates ---------------------------------------------------------------------------------------
  const lockedSet = new Set(lockIds);
  const notes = retiredNote ? [retiredNote] : [];
  const all = [];
  for (const [key, row] of byId) {
    if (excludeIds.has(key)) continue; // an excluded player never appears, locked or not (that clash was caught above)
    const locked = lockedSet.has(key);
    const proj = num(row.proj);
    const salary = num(row.salary);
    const flags = Array.isArray(row.flags) ? row.flags : [];
    // D28: a projection Adam typed in overrides the "no projection" fallback, so the player competes for a slot.
    const overridden = num(row.override && row.override.proj) !== null;
    const noProjection = !overridden && flags.includes("no projection");
    if (locked && salary === null) {
      // Missing money is never zero: a player the DraftKings CSV never priced cannot be weighed against the cap
      // at all, so a lineup containing him would be a lie about what it costs.
      return failure(
        `Locked ${row.name ?? key} has no salary in the DraftKings CSV, so he cannot be costed against the cap.`,
        cap
      );
    }
    if (!locked) {
      if (proj === null) continue;        // no projection: never auto-rostered (D27 keeps him visible on the board)
      if (noProjection) continue;         // no source projected him: the AvgPointsPerGame stand-in is not a projection
      if (rowIsOut(row)) continue;        // out / IR / doubtful / suspended: never auto-rostered
      if (salary === null) continue;      // no price means he cannot be costed against the cap
    }
    const positions = rowPositions(row);
    if (!positions.length) {
      if (locked) {
        return failure(`Locked player ${row.name ?? key} has no position, so he cannot fill a slot.`, cap);
      }
      continue;
    }
    if (locked && proj === null) {
      notes.push(`Locked ${row.name ?? key} has no projection and counts as 0.`);
    } else if (locked && noProjection) {
      notes.push(`Locked ${row.name ?? key} has no projection from any source; his average points per game stands in for one.`);
    }
    all.push({
      id: key,
      dkKey: dkKeyOf(row, key),
      name: row.name ?? key,
      team: row.team ?? null,
      pos: row.pos ? String(row.pos).trim().toUpperCase() : positions[0],
      positions,
      salary: salary ?? 0,
      proj,
      own: num(row.own),
      score: scoreOf(row),
      locked
    });
  }

  const base = {
    slots,
    flexPositions,
    cap,
    maxFromTeam: maxFromTeam !== null && maxFromTeam >= 1 ? Math.trunc(maxFromTeam) : null,
    stackQbWith,
    objective,
    lockIds,
    lockNames: new Map(all.filter((c) => c.locked).map((c) => [c.id, c.name]))
  };

  // Prune: best TOP_PER_POS per position by the objective, plus the CHEAP_PER_POS cheapest per position so the
  // cap always remains reachable, plus every lock.
  const pruned = prunePool(all);
  let ctx = makeCtx(pruned, base);

  const empties = slots
    .map((slot, i) => ({ slot, i }))
    .filter(({ i }) => ctx.slotPool[i].length === 0);
  if (empties.length) {
    const names = [...new Set(empties.map((e) => e.slot))].join(", ");
    return failure(
      `No eligible player is available for the ${names} slot${empties.length > 1 ? "s" : ""} after exclusions, injuries and missing projections.`,
      cap
    );
  }

  // ---- locks: each must be available and must consume one legal slot ------------------------------------
  const lockCands = lockIds.map((id) => ctx.pool.find((c) => c.id === id)).filter(Boolean);
  if (lockCands.length !== lockIds.length) {
    const lost = lockIds.filter((id) => !lockCands.some((c) => c.id === id));
    const names = lost.map((id) => byId.get(id)?.name ?? id).join(", ");
    return failure(
      `Locked player${lost.length > 1 ? "s" : ""} ${names} ${lost.length > 1 ? "are" : "is"} not available to roster on this slate.`,
      cap
    );
  }
  const seenDk = new Map();
  for (const c of lockCands) {
    const twin = seenDk.get(c.dkKey);
    if (twin) {
      return failure(`${twin.name} and ${c.name} are the same DraftKings player, so both cannot be locked.`, cap);
    }
    seenDk.set(c.dkKey, c);
  }

  const lockFit = assignLocks(lockCands, ctx);
  if (!lockFit.ok) return failure(lockFit.message, cap);

  const lockSalary = lockCands.reduce((sum, c) => sum + c.salary, 0);
  if (lockSalary > cap) {
    return failure(`The locked players cost ${money(lockSalary)}, which is already over the ${money(cap)} cap.`, cap);
  }
  if (ctx.maxFromTeam !== null) {
    const counts = new Map();
    for (const c of lockCands) counts.set(c.team, (counts.get(c.team) ?? 0) + 1);
    for (const [team, n] of counts) {
      if (n > ctx.maxFromTeam) {
        return failure(
          sentence(`${plural(n, "locked player")} are from ${team ?? "the same team"}, but at most ${plural(ctx.maxFromTeam, "player")} per team are allowed.`),
          cap
        );
      }
    }
  }

  // ---- build, then improve ------------------------------------------------------------------------------
  let starts = buildStarts(ctx, lockFit.slotToLock, lockCands);

  // Constraint-safe pruning: the top-by-objective plus cheapest pool is enough for a plain build, but a team
  // limit or a stack needs breadth the prune may have thrown away (the cheap end of the pool can be four teams
  // deep). Rather than call an artefact of the prune "infeasible", the whole pool is tried once more.
  if (!starts.length && (ctx.maxFromTeam !== null || ctx.stackQbWith > 0) && all.length > pruned.length) {
    const fullCtx = makeCtx(all, base);
    const fullFit = assignLocks(lockCands, fullCtx);
    if (fullFit.ok) {
      const retry = buildStarts(fullCtx, fullFit.slotToLock, lockCands);
      if (retry.length) {
        ctx = fullCtx;
        starts = retry;
      }
    }
  }
  if (!starts.length) return failure(infeasibleMessage(ctx, lockCands), cap);

  // Every greedy start is improved and the best kept: the three construction modes lead to different local
  // optima, and the one that started highest does not always finish highest.
  let best = null;
  for (const start of starts) {
    const improved = improve(start, ctx);
    if (violation(improved, ctx)) continue;
    const score = total(improved);
    if (!best || score > best.score || (score === best.score && lineupKey(improved) < lineupKey(best.lineup))) {
      best = { lineup: improved, score };
    }
  }
  if (!best) return failure(infeasibleMessage(ctx, lockCands), cap);

  return present(best.lineup, ctx, notes);
}

function buildStarts(ctx, slotToLock, lockCands) {
  const starts = [];
  for (const mode of BUILD_MODES) {
    const built = build(ctx, slotToLock, lockCands, mode);
    if (built) starts.push(built);
  }
  return starts;
}

const lineupKey = (lineup) => lineup.map((c) => c.id).join("|");

// --------------------------------------------------------------------------------------------------------
// Pool
// --------------------------------------------------------------------------------------------------------

const cmpScore = (a, b) => b.score - a.score || a.salary - b.salary || cmpId(a.id, b.id);
const cmpCost = (a, b) => a.salary - b.salary || b.score - a.score || cmpId(a.id, b.id);

function prunePool(all) {
  const byPos = new Map();
  for (const c of all) {
    if (!byPos.has(c.pos)) byPos.set(c.pos, []);
    byPos.get(c.pos).push(c);
  }
  const keep = new Map();
  for (const c of all) if (c.locked) keep.set(c.id, c);
  for (const list of byPos.values()) {
    for (const c of [...list].sort(cmpScore).slice(0, TOP_PER_POS)) keep.set(c.id, c);
    for (const c of [...list].sort(cmpCost).slice(0, CHEAP_PER_POS)) keep.set(c.id, c);
  }
  return [...keep.values()].sort(cmpScore);
}

/** The per-slot candidate lists for one pool. Everything downstream reads these, so the retry on the unpruned
 *  pool is just a second ctx. */
function makeCtx(pool, base) {
  const ctx = { ...base, pool };
  ctx.slotPool = ctx.slots.map((slot) => pool.filter((c) => eligibleForSlot(c, slot, ctx.flexPositions)));
  ctx.byScore = ctx.slotPool.map((list) => [...list].sort(cmpScore));
  ctx.byCost = ctx.slotPool.map((list) => [...list].sort(cmpCost));
  return ctx;
}

// --------------------------------------------------------------------------------------------------------
// Locks -> slots (bipartite matching, with a Hall violator for the failure sentence)
// --------------------------------------------------------------------------------------------------------

function assignLocks(lockCands, ctx) {
  const slotToLock = new Array(ctx.slots.length).fill(-1);
  // Tightest slot first, most permissive last: a locked running back should take an RB slot before he takes the
  // FLEX, or the FLEX is gone when the second locked back needs it. How many players a slot can hold is what
  // says which slots are the permissive ones, so the order of the slot list never decides it.
  const eligible = lockCands.map((c) =>
    ctx.slots
      .map((slot, i) => i)
      .filter((i) => eligibleForSlot(c, ctx.slots[i], ctx.flexPositions))
      .sort((a, b) => ctx.slotPool[a].length - ctx.slotPool[b].length || a - b)
  );

  for (let i = 0; i < lockCands.length; i++) {
    if (eligible[i].length === 0) {
      return {
        ok: false,
        message: `Locked player ${lockCands[i].name} (${lockCands[i].pos}) does not fit any slot in this lineup.`
      };
    }
  }

  for (let i = 0; i < lockCands.length; i++) {
    const seenSlots = new Set();
    const seenLocks = new Set([i]);
    if (!augment(i, eligible, slotToLock, seenSlots, seenLocks)) {
      return { ok: false, message: hallMessage(lockCands, ctx, seenLocks, seenSlots) };
    }
  }
  return { ok: true, slotToLock };
}

function augment(lock, eligible, slotToLock, seenSlots, seenLocks) {
  for (const si of eligible[lock]) {
    if (seenSlots.has(si)) continue;
    seenSlots.add(si);
    const other = slotToLock[si];
    if (other === -1) {
      slotToLock[si] = lock;
      return true;
    }
    seenLocks.add(other);
    if (augment(other, eligible, slotToLock, seenSlots, seenLocks)) {
      slotToLock[si] = lock;
      return true;
    }
  }
  return false;
}

/** When matching fails, the locks and slots visited by the search are a Hall violator: more locked players
 *  than the slots they can legally occupy. That is the sentence the user needs. */
function hallMessage(lockCands, ctx, seenLocks, seenSlots) {
  const locks = [...seenLocks].sort((a, b) => a - b).map((i) => lockCands[i]);
  const slotNames = [...seenSlots].sort((a, b) => a - b).map((i) => ctx.slots[i]);
  const uniqueSlots = [...new Set(slotNames)];
  const positions = [...new Set(locks.map((c) => c.pos))];
  const names = locks.map((c) => c.name).join(", ");
  if (positions.length === 1 && uniqueSlots.length === 1) {
    return sentence(
      `${plural(locks.length, positions[0])} locked (${names}) but only ${plural(slotNames.length, `${uniqueSlots[0]} slot`)} available.`
    );
  }
  return sentence(`${plural(locks.length, "locked player")} (${names}) fit only ${plural(slotNames.length, "slot")} (${uniqueSlots.join(", ")}).`);
}

// --------------------------------------------------------------------------------------------------------
// Construction
// --------------------------------------------------------------------------------------------------------

const modeScore = (c, mode) => {
  if (mode === "cheap") return -c.salary;
  if (mode === "perDollar") return c.salary > 0 ? c.score / (c.salary / 1000) : c.score;
  return c.score;
};

function build(ctx, slotToLock, lockCands, mode) {
  const qbSlots = ctx.slots.map((s, i) => (s === "QB" ? i : -1)).filter((i) => i >= 0);
  if (ctx.stackQbWith <= 0 || qbSlots.length === 0) return buildWith(ctx, slotToLock, lockCands, mode, null);

  // A stack needs a quarterback first, because the required RB/WR/TE teammates depend on his team. A locked QB
  // settles it; otherwise the best few quarterbacks are each tried and the best resulting lineup kept.
  const lockedQb = qbSlots.map((i) => slotToLock[i]).find((l) => l !== undefined && l !== -1);
  const options =
    lockedQb !== undefined && lockedQb !== -1
      ? [lockCands[lockedQb]]
      : ctx.byScore[qbSlots[0]].filter((c) => !c.locked).slice(0, QB_STACK_OPTIONS);

  let bestLineup = null;
  for (const qb of options) {
    const built = buildWith(ctx, slotToLock, lockCands, mode, qb);
    if (!built) continue;
    if (!bestLineup || total(built) > total(bestLineup)) bestLineup = built;
  }
  return bestLineup;
}

function buildWith(ctx, slotToLock, lockCands, mode, forcedQb) {
  const chosen = new Array(ctx.slots.length).fill(null);
  const used = new Set();
  const teams = new Map();
  let left = ctx.cap;

  const place = (si, cand) => {
    chosen[si] = cand;
    used.add(cand.dkKey);
    teams.set(cand.team, (teams.get(cand.team) ?? 0) + 1);
    left -= cand.salary;
  };

  for (let si = 0; si < ctx.slots.length; si++) {
    const lock = slotToLock[si];
    if (lock !== -1) place(si, lockCands[lock]);
  }

  if (forcedQb && !used.has(forcedQb.dkKey)) {
    const si = ctx.slots.findIndex((s, i) => s === "QB" && chosen[i] === null);
    if (si === -1) return null;
    if (forcedQb.salary > left) return null;
    place(si, forcedQb);
  }

  // Stack: every rostered QB needs stackQbWith RB/WR/TE teammates from his own team.
  if (ctx.stackQbWith > 0) {
    for (let qi = 0; qi < ctx.slots.length; qi++) {
      if (ctx.slots[qi] !== "QB" || !chosen[qi]) continue;
      const team = chosen[qi].team;
      let have = chosen.filter((c) => c && countsTowardStack(c.pos) && c.team === team).length;
      while (have < ctx.stackQbWith) {
        let pick = null;
        for (let si = 0; si < ctx.slots.length; si++) {
          if (chosen[si] !== null) continue;
          for (const cand of sortByMode(ctx.byScore[si], mode)) {
            if (used.has(cand.dkKey) || cand.team !== team || !countsTowardStack(cand.pos)) continue;
            if (cand.salary > left) continue;
            if (!teamOk(teams, cand.team, ctx.maxFromTeam)) continue;
            if (!completable(ctx, chosen, used, teams, left, si, cand)) continue;
            const value = modeScore(cand, mode);
            // The partners are placed one at a time: `completable` proves the rest of the lineup can be filled,
            // but not that the NEXT partner will still be affordable. When that bites, the cheaper construction
            // modes usually succeed; if none does, the run is reported infeasible rather than illegal.
            if (!pick || value > pick.value || (value === pick.value && cand.id < pick.cand.id)) {
              pick = { si, cand, value };
            }
            break; // candidates are score-ordered: the first affordable one is this slot's best
          }
        }
        if (!pick) return null;
        place(pick.si, pick.cand);
        have++;
      }
    }
  }

  // Remaining slots, most restrictive first, best affordable candidate that still leaves a legal completion.
  const order = ctx.slots
    .map((s, i) => i)
    .filter((i) => chosen[i] === null)
    .sort((a, b) => ctx.slotPool[a].length - ctx.slotPool[b].length || a - b);

  for (const si of order) {
    let picked = null;
    for (const cand of sortByMode(ctx.byScore[si], mode)) {
      if (used.has(cand.dkKey) || cand.salary > left) continue;
      if (!teamOk(teams, cand.team, ctx.maxFromTeam)) continue;
      if (!completable(ctx, chosen, used, teams, left, si, cand)) continue;
      picked = cand;
      break;
    }
    if (!picked) return null;
    place(si, picked);
  }

  return chosen.every(Boolean) && !violation(chosen, ctx) ? chosen : null;
}

function sortByMode(list, mode) {
  if (mode === "score") return list;
  return [...list].sort(
    (a, b) => modeScore(b, mode) - modeScore(a, mode) || a.salary - b.salary || cmpId(a.id, b.id)
  );
}

function teamOk(teams, team, maxFromTeam) {
  if (maxFromTeam === null || team === null || team === undefined) return true;
  return (teams.get(team) ?? 0) < maxFromTeam;
}

/** Could the rest of the lineup still be filled under the cap if `cand` went into `si`? Answered by actually
 *  building the cheapest completion; if that exists the greedy pick can never dead-end. */
function completable(ctx, chosen, used, teams, left, si, cand) {
  const usedNow = new Set(used);
  usedNow.add(cand.dkKey);
  const teamsNow = new Map(teams);
  teamsNow.set(cand.team, (teamsNow.get(cand.team) ?? 0) + 1);
  let capLeft = left - cand.salary;
  if (capLeft < 0) return false;

  const rest = ctx.slots
    .map((s, i) => i)
    .filter((i) => i !== si && chosen[i] === null)
    .sort((a, b) => ctx.slotPool[a].length - ctx.slotPool[b].length || a - b);

  for (const idx of rest) {
    let found = null;
    for (const c of ctx.byCost[idx]) {
      if (c.salary > capLeft) break; // cost-ordered
      if (usedNow.has(c.dkKey)) continue;
      if (!teamOk(teamsNow, c.team, ctx.maxFromTeam)) continue;
      found = c;
      break;
    }
    if (!found) return false;
    usedNow.add(found.dkKey);
    teamsNow.set(found.team, (teamsNow.get(found.team) ?? 0) + 1);
    capLeft -= found.salary;
  }
  return true;
}

// --------------------------------------------------------------------------------------------------------
// Legality
// --------------------------------------------------------------------------------------------------------

/** Returns null when the lineup is legal, otherwise the sentence explaining what is wrong. */
function violation(lineup, ctx) {
  if (!lineup || lineup.length !== ctx.slots.length || !lineup.every(Boolean)) {
    return "No legal lineup fits these locks, exclusions and the salary cap.";
  }
  const ids = new Set();
  const dkKeys = new Map();
  let salary = 0;
  const teams = new Map();
  for (let i = 0; i < lineup.length; i++) {
    const c = lineup[i];
    if (ids.has(c.id)) return `${c.name} appears twice in the lineup.`;
    ids.add(c.id);
    const twin = dkKeys.get(c.dkKey);
    if (twin) return `${twin.name} and ${c.name} are the same DraftKings player, so only one of them can be rostered.`;
    dkKeys.set(c.dkKey, c);
    if (!eligibleForSlot(c, ctx.slots[i], ctx.flexPositions)) {
      return `${c.name} (${c.pos}) cannot fill the ${ctx.slots[i]} slot.`;
    }
    salary += c.salary;
    teams.set(c.team, (teams.get(c.team) ?? 0) + 1);
  }
  for (const id of ctx.lockIds) {
    if (!ids.has(id)) return `Locked ${ctx.lockNames.get(id) ?? id} is not in this lineup.`;
  }
  if (salary > ctx.cap) return `The lineup costs ${money(salary)}, over the ${money(ctx.cap)} cap.`;
  if (ctx.maxFromTeam !== null) {
    for (const [team, n] of teams) {
      if (n > ctx.maxFromTeam) {
        return sentence(`${plural(n, "player")} from ${team} exceeds the limit of ${plural(ctx.maxFromTeam, "player")} per team.`);
      }
    }
  }
  if (ctx.stackQbWith > 0) {
    for (let i = 0; i < lineup.length; i++) {
      if (ctx.slots[i] !== "QB") continue;
      const team = lineup[i].team;
      const mates = lineup.filter((c, j) => j !== i && countsTowardStack(c.pos) && c.team === team).length;
      if (mates < ctx.stackQbWith) {
        return `${lineup[i].name} is stacked with only ${plural(mates, "RB/WR/TE teammate")} from ${team}; ${word(ctx.stackQbWith)} required.`;
      }
    }
  }
  return null;
}

function infeasibleMessage(ctx, lockCands) {
  const cheapest = ctx.slots
    .map((s, i) => i)
    .sort((a, b) => ctx.slotPool[a].length - ctx.slotPool[b].length || a - b);
  const test = completableFromEmpty(ctx, cheapest);
  if (ctx.stackQbWith > 0) {
    return `No legal lineup fits these locks and exclusions with ${plural(ctx.stackQbWith, "RB/WR/TE teammate")} stacked with the quarterback under the ${money(ctx.cap)} cap.`;
  }
  if (!test) {
    return `No combination of the available players fills every slot under the ${money(ctx.cap)} cap${lockCands.length ? " with these locks" : ""}.`;
  }
  return `No legal lineup fits these locks, exclusions and the ${money(ctx.cap)} cap.`;
}

function completableFromEmpty(ctx, order) {
  const used = new Set();
  const teams = new Map();
  let left = ctx.cap;
  for (const si of order) {
    let found = null;
    for (const c of ctx.byCost[si]) {
      if (c.salary > left) break;
      if (used.has(c.dkKey)) continue;
      if (!teamOk(teams, c.team, ctx.maxFromTeam)) continue;
      found = c;
      break;
    }
    if (!found) return false;
    used.add(found.dkKey);
    teams.set(found.team, (teams.get(found.team) ?? 0) + 1);
    left -= found.salary;
  }
  return true;
}

// --------------------------------------------------------------------------------------------------------
// Improvement: steepest-ascent single swaps, then pairwise swaps, until nothing gains
// --------------------------------------------------------------------------------------------------------

const total = (lineup) => lineup.reduce((sum, c) => sum + c.score, 0);
const EPS = 1e-9;

function improve(start, ctx) {
  let lineup = [...start];
  let pairEvals = 0;

  for (let step = 0; step < MAX_IMPROVE_STEPS; step++) {
    const single = bestSingle(lineup, ctx);
    if (single) {
      lineup = single.lineup;
      continue;
    }
    const pair = bestPair(lineup, ctx, MAX_PAIR_EVALS - pairEvals);
    pairEvals += pair.evals;
    if (pair.lineup) {
      lineup = pair.lineup;
      continue;
    }
    break;
  }
  return lineup;
}

function bestSingle(lineup, ctx) {
  const inLineup = new Set(lineup.map((c) => c.dkKey));
  let best = null;
  for (let si = 0; si < lineup.length; si++) {
    if (lineup[si].locked) continue;
    for (const cand of ctx.byScore[si]) {
      if (inLineup.has(cand.dkKey)) continue;
      const gain = cand.score - lineup[si].score;
      if (gain <= EPS) break; // score-ordered: nothing further can gain
      if (best && gain <= best.gain + EPS) break;
      const next = [...lineup];
      next[si] = cand;
      if (violation(next, ctx)) continue;
      if (!best || gain > best.gain || (gain === best.gain && cand.id < best.id)) {
        best = { gain, lineup: next, id: cand.id };
      }
      break; // this slot's best legal upgrade found
    }
  }
  return best;
}

function bestPair(lineup, ctx, budget) {
  if (budget <= 0) return { lineup: null, evals: 0 };
  const inLineup = new Set(lineup.map((c) => c.dkKey));
  const shortlist = ctx.byScore.map((list) => list.filter((c) => !inLineup.has(c.dkKey)).slice(0, PAIR_CANDIDATES));
  let best = null;
  let evals = 0;

  for (let a = 0; a < lineup.length; a++) {
    if (lineup[a].locked) continue;
    for (let b = a + 1; b < lineup.length; b++) {
      if (lineup[b].locked) continue;
      if (!shortlist[a].length || !shortlist[b].length) continue;
      const baseline = lineup[a].score + lineup[b].score;
      for (const ca of shortlist[a]) {
        if (ca.score + shortlist[b][0].score - baseline <= EPS) break; // best possible partner cannot gain
        for (const cb of shortlist[b]) {
          if (ca.dkKey === cb.dkKey) continue;
          const gain = ca.score + cb.score - baseline;
          if (gain <= EPS) break;
          if (++evals > budget) return { lineup: best ? best.lineup : null, evals };
          if (best && gain <= best.gain + EPS) break;
          const next = [...lineup];
          next[a] = ca;
          next[b] = cb;
          if (violation(next, ctx)) continue;
          if (!best || gain > best.gain || (gain === best.gain && `${ca.id}|${cb.id}` < best.key)) {
            best = { gain, lineup: next, key: `${ca.id}|${cb.id}` };
          }
        }
      }
    }
  }
  return { lineup: best ? best.lineup : null, evals };
}

// --------------------------------------------------------------------------------------------------------
// Result
// --------------------------------------------------------------------------------------------------------

function present(lineup, ctx, notes) {
  // Identical slot names are interchangeable, so order them by score for a stable, readable result.
  const groups = new Map();
  for (let i = 0; i < lineup.length; i++) {
    const slot = ctx.slots[i];
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push(lineup[i]);
  }
  for (const list of groups.values()) list.sort(cmpScore);
  const taken = new Map();
  const out = [];
  let salaryUsed = 0;
  let totalProj = 0;
  let totalOwn = 0;
  let ownMissing = false;
  for (let i = 0; i < lineup.length; i++) {
    const slot = ctx.slots[i];
    const idx = taken.get(slot) ?? 0;
    taken.set(slot, idx + 1);
    const c = groups.get(slot)[idx];
    salaryUsed += c.salary;
    totalProj += c.proj ?? 0;
    // A player nobody has an ownership number for makes the lineup's total ownership unknown, not smaller: a
    // total that silently counted him as 0% owned would be wrong in the direction that flatters the lineup.
    if (c.own === null) ownMissing = true;
    else totalOwn += c.own;
    out.push({
      slot,
      id: c.id,
      name: c.name,
      team: c.team,
      pos: c.pos,
      salary: c.salary,
      proj: c.proj,
      own: c.own
    });
  }
  const outNotes = [...notes];
  return {
    lineup: out,
    salaryUsed,
    salaryLeft: ctx.cap - salaryUsed,
    totalProj: round2(totalProj),
    totalOwn: ownMissing ? null : round2(totalOwn),
    feasible: true,
    message: "",
    notes: outNotes
  };
}
