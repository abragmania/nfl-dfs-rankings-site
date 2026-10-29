// Points left on the table by one swap (data/findings/showdown-table-points-plan-2026-10-26.md, sections 1 and 3): for a
// Showdown lineup, over each of its six seats, the projection gain from replacing that one man with the best-projected
// man not already in the lineup who still fits under the cap and keeps both teams present. The Captain seat uses Captain
// prices and the Captain multiplier times the projection difference; a FLEX seat uses FLEX prices. Each seat's gain is
// multiplied by its seat weight (the plan's seat-weighting hook, 1 and 1 by default); the lineup's table points are the
// largest weighted gain, exactly 0 when every gain is at most 1e-9 (a one-swap local optimum, the obvious fill for that
// Captain and core). Ties break by the lowest seat, then shortlist order (projection descending, then cheaper, then pool
// order).
// The candidates are every man with a finite projection and a whole-dollar price in that seat (a Captain also at most the
// cap), whatever his ownership (Adam 1:58 PM EDT 2026-10-26: "the highest-projected remaining guy under the salary"; the
// scout's test rests on this set, and a posted 0% or a blank feed row must not stop a man being the obvious fill). The
// field table's pool (preparePool in ./sd-field-dp.js) decides only which lineups are enumerated (./sd-field-enum.js).
// The swap index (section 3) is built once per pool: at each budget level (the price step is the gcd of the cap and every
// candidate price, refused under $50) and team mode (any team, the first team only, the second team only), the six
// best-projected candidates within that budget, a FLEX list and a Captain list. Six suffices: at most five other lineup
// men are blocked, and reaching the replaced man ends the scan (nobody after him projects more).
// Pure: no files. Browser safety as ./sd-field-dp.js (CPT_MULTIPLIER from ./showdown.js).
import { CPT_MULTIPLIER } from "./showdown.js";
import { preparePool, fieldRefusal, DEFAULT_PROJ_STEP } from "./sd-field-dp.js";

/** The definition's name; a curves file fitted under another definition is refused by it (plan section 3). */
export const TABLE_RULE = "one-swap-v1";
/** Candidates kept per budget level, team mode and seat (plan section 3: five blocked men plus the replaced man). */
export const SHORTLIST = 6;
const MIN_PRICE_STEP = 50; // dollars (plan section 3's floor; DraftKings Showdown prices are whole hundreds)
const ZERO_GAIN = 1e-9; // a gain at most this is no gain (plan section 1: exactly 0 is a local optimum)
const FLEX_LIST = 0;
const CPT_LIST = 1;
const MODES = 3; // 0: any team; 1: the first team only; 2: the second team only
const STAMP_RESET = 1 << 30;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Seat weights { captain, flex }, each a finite number above 0, or a thrown plain sentence. The one check of them. */
export function checkSeatWeights(w) {
  if (!w || typeof w !== "object" || Array.isArray(w)) throw new Error("tablePoints: the seat weights must be an object { captain, flex }.");
  for (const [seat, label] of [["captain", "Captain"], ["flex", "FLEX"]]) {
    if (!isNum(w[seat]) || !(w[seat] > 0)) throw new Error(`tablePoints: the ${label} seat weight must be a finite number above 0.`);
  }
  return { captain: w.captain, flex: w.flex };
}

/** Per pool entry: person code, team code, slot, price and FLEX projection (NaN where blank), candidate flag (a finite
 *  projection and a whole-dollar price, a Captain at most the cap; ownership ignored). */
function entryArrays(pool, prep, cap) {
  const n = pool.length;
  const person = new Int32Array(n);
  const team = new Int8Array(n);
  const slot = new Int8Array(n);
  const price = new Float64Array(n);
  const proj = new Float64Array(n);
  const cand = new Uint8Array(n);
  const personCode = new Map();
  const teamCode = new Map(prep.teams.map((t, i) => [t, i]));
  pool.forEach((c, i) => {
    const id = String(c.personId);
    if (!personCode.has(id)) personCode.set(id, personCode.size);
    person[i] = personCode.get(id);
    team[i] = teamCode.get(c.team);
    slot[i] = c.slot === "CPT" ? CPT_LIST : FLEX_LIST;
    price[i] = Number.isInteger(c.salary) && c.salary > 0 ? c.salary : NaN;
    proj[i] = isNum(c.proj) ? c.proj : NaN;
    cand[i] = !Number.isNaN(proj[i]) && !Number.isNaN(price[i]) && (slot[i] === FLEX_LIST || price[i] <= cap) ? 1 : 0;
  });
  return { person, team, slot, price, proj, cand, nPersons: personCode.size };
}

/** The shortlists: lists[((list x MODES + mode) x nLevels + level) x SHORTLIST + k], a pool index or -1. */
function shortlists(e, step, nLevels) {
  const lists = new Int32Array(2 * MODES * nLevels * SHORTLIST).fill(-1);
  const order = (a, b) => e.proj[b] - e.proj[a] || e.price[a] - e.price[b] || a - b;
  for (const list of [FLEX_LIST, CPT_LIST]) {
    const cands = [];
    for (let i = 0; i < e.cand.length; i++) if (e.cand[i] && e.slot[i] === list) cands.push(i);
    cands.sort(order);
    for (let mode = 0; mode < MODES; mode++) {
      const mine = mode === 0 ? cands : cands.filter((i) => e.team[i] === mode - 1);
      for (let level = 0; level < nLevels; level++) {
        const budget = level * step;
        const at = ((list * MODES + mode) * nLevels + level) * SHORTLIST;
        let k = 0;
        for (let j = 0; j < mine.length && k < SHORTLIST; j++) if (e.price[mine[j]] <= budget) lists[at + k++] = mine[j];
      }
    }
  }
  return lists;
}

/**
 * The swap index of a pool (plan section 3), built once. `pool`: the field table's entries { personId, team, slot: "CPT" |
 * "FLEX", salary (that slot's price), own, proj (the man's FLEX projection) }, checked by preparePool; `cap` in dollars.
 * Returns { pool, cap, step (dollars), nLevels, teams, ... } for tablePoints; refused in a plain sentence when the
 * price step is under $50.
 * The index carries one scratch area per index (stamp, tick, bySeat, inBySeat, seat) that every tablePoints call
 * overwrites: synchronous use only; never hold its fields across an await (each call's answer is copied out first).
 */
export function buildSwapIndex(pool, { cap } = {}) {
  const prep = preparePool(pool, cap, DEFAULT_PROJ_STEP); // the pool's checks, and its teams
  const e = entryArrays(pool, prep, cap);
  let step = cap;
  for (let i = 0; i < e.cand.length; i++) if (e.cand[i]) step = gcd(step, e.price[i]);
  if (!Number.isInteger(step) || step < MIN_PRICE_STEP) {
    throw fieldRefusal(`buildSwapIndex: the cap and the candidates' prices share a step of only $${step}, under $${MIN_PRICE_STEP}, so points left on the table cannot be measured on this board.`);
  }
  const nLevels = Math.floor(cap / step) + 1;
  return {
    pool, cap, step, nLevels, teams: prep.teams, ...e,
    lists: shortlists(e, step, nLevels),
    stamp: new Int32Array(e.nPersons), tick: 0,
    bySeat: new Float64Array(6), inBySeat: new Int32Array(6), seat: -1 // the hot path's scratch: synchronous use only
  };
}

/** The most table points any lineup can score on this index: the largest weighted gain one seat allows over the
 *  candidates, in tablePointsOf's own arithmetic (multiplier x FLEX projection difference, then the seat weight). */
export function maxTablePoints(ix, seatWeights) {
  const w = checkSeatWeights(seatWeights);
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (let i = 0; i < ix.cand.length; i++) {
    if (!ix.cand[i]) continue;
    lo[ix.slot[i]] = Math.min(lo[ix.slot[i]], ix.proj[i]);
    hi[ix.slot[i]] = Math.max(hi[ix.slot[i]], ix.proj[i]);
  }
  const span = (s) => (hi[s] >= lo[s] ? hi[s] - lo[s] : 0);
  return Math.max((CPT_MULTIPLIER * span(CPT_LIST)) * w.captain, (1 * span(FLEX_LIST)) * w.flex, 0);
}

/**
 * The hot path: a legal lineup's weighted table points, with no checks and no allocation. `six`: pool indices, the
 * Captain's Captain entry then five FLEX entries, legal by construction (the enumerator's). Leaves each seat's weighted
 * gain in ix.bySeat, the incoming man's pool index in ix.inBySeat (-1 where none gains) and the winning seat in ix.seat
 * (-1 at a local optimum); returns the points (plan section 1). The scratch is the index's own: read it before the next
 * call, synchronously; never hold it across an await.
 */
export function tablePointsOf(ix, six, wCaptain, wFlex) {
  const { person, team, price, proj, lists, stamp, bySeat, inBySeat, step, nLevels } = ix;
  if (++ix.tick >= STAMP_RESET) { stamp.fill(0); ix.tick = 1; }
  const tick = ix.tick;
  let total = 0;
  let firstTeam = 0;
  for (let s = 0; s < 6; s++) {
    const m = six[s];
    stamp[person[m]] = tick;
    total += price[m];
    if (team[m] === 0) firstTeam++;
  }
  const left = ix.cap - total;
  let points = 0;
  ix.seat = -1;
  for (let s = 0; s < 6; s++) {
    const r = six[s];
    const othersFirst = firstTeam - (team[r] === 0 ? 1 : 0);
    const mode = othersFirst === 5 ? 2 : othersFirst === 0 ? 1 : 0; // the other five all of one team: the swap brings the other
    const level = Math.min(nLevels - 1, Math.floor((left + price[r]) / step));
    const at = (((s === 0 ? CPT_LIST : FLEX_LIST) * MODES + mode) * nLevels + level) * SHORTLIST;
    bySeat[s] = 0;
    inBySeat[s] = -1;
    for (let k = 0; k < SHORTLIST; k++) {
      const c = lists[at + k];
      if (c < 0 || person[c] === person[r]) break; // nobody left, or the replaced man: nobody after him projects more
      if (stamp[person[c]] === tick) continue; // already in the lineup
      const gain = (s === 0 ? CPT_MULTIPLIER : 1) * (proj[c] - proj[r]);
      if (gain > ZERO_GAIN) { bySeat[s] = gain * (s === 0 ? wCaptain : wFlex); inBySeat[s] = c; }
      break;
    }
    if (bySeat[s] > points) { points = bySeat[s]; ix.seat = s; }
  }
  return points;
}

/** A lineup of pool indices checked against the index's pool, or a thrown plain sentence. */
function checkLineup(lineup, ix) {
  if (!Array.isArray(lineup) && !ArrayBuffer.isView(lineup)) throw new Error("tablePoints: a lineup is a list of six pool indices, the Captain first.");
  if (lineup.length !== 6) throw new Error(`tablePoints: a Showdown lineup has six men, not ${lineup.length}.`);
  const n = ix.pool.length;
  const seen = new Set();
  let total = 0;
  for (let s = 0; s < 6; s++) {
    const i = lineup[s];
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`tablePoints: seat ${s + 1} names pool index ${String(i)}, which is not in the pool.`);
    const name = String(ix.pool[i].personId);
    if ((ix.slot[i] === CPT_LIST) !== (s === 0)) throw new Error(`tablePoints: seat ${s + 1} holds ${name}'s ${s === 0 ? "FLEX" : "Captain"} entry; the first seat is the Captain's and the other five FLEX.`);
    if (seen.has(ix.person[i])) throw new Error(`tablePoints: ${name} is in the lineup twice; a Showdown lineup has six different players.`);
    seen.add(ix.person[i]);
    // Data conditions a live lineup can hit (a blank feed row): plain refusals, not bugs.
    if (Number.isNaN(ix.proj[i])) throw fieldRefusal(`tablePoints: ${name} has no projection, so no swap can be measured against him.`);
    if (Number.isNaN(ix.price[i])) throw fieldRefusal(`tablePoints: ${name} has no price in his seat.`);
    total += ix.price[i];
  }
  if (total > ix.cap) throw new Error(`tablePoints: the lineup is $${total - ix.cap} over the $${ix.cap} cap.`);
  const firstTeam = [...lineup].filter((i) => ix.team[i] === 0).length;
  if (firstTeam === 0 || firstTeam === 6) throw new Error("tablePoints: a Showdown lineup has men from both teams.");
}

/**
 * A lineup's points left on the table by one swap (plan section 1). `lineup`: six pool indices of `pool`, the Captain's
 * Captain entry first, then five FLEX entries; `index`: buildSwapIndex(pool, ...) of this same pool; `seatWeights`
 * { captain, flex } (each above 0). Returns { points, seat (0 the Captain, 1 to 5 the FLEX seats in lineup order),
 * slot ("CPT" or "FLEX"), outIdx (the replaced man's pool index), inIdx (the incoming man's, in the same slot),
 * bySeat (each seat's weighted gain, 0 where no swap gains), seatWeights (the { captain, flex } actually used, 1 and 1
 * when none were passed, so the field model can refuse table points measured at other weights than its curves') }; at a
 * local optimum points is exactly 0 and seat, slot, outIdx and inIdx are null. Every lineup man needs a projection and a
 * price (a plain refusal otherwise); his ownership is never read.
 */
export function tablePoints(lineup, index, pool, seatWeights = { captain: 1, flex: 1 }) {
  if (!index || index.pool !== pool) throw new Error("tablePoints: the swap index was built from another pool; build it with buildSwapIndex for this one.");
  const w = checkSeatWeights(seatWeights);
  checkLineup(lineup, index);
  const points = tablePointsOf(index, lineup, w.captain, w.flex);
  const bySeat = Array.from(index.bySeat);
  if (index.seat < 0) return { points: 0, seat: null, slot: null, outIdx: null, inIdx: null, bySeat, seatWeights: w };
  const s = index.seat;
  return { points, seat: s, slot: s === 0 ? "CPT" : "FLEX", outIdx: lineup[s], inIdx: index.inBySeat[s], bySeat, seatWeights: w };
}
