// The Showdown field table (the Showdown meter plan 2026-10-25, section 6): for one board, the ownership weight of every
// legal Showdown lineup summed by salary left and by total projection, so the field model (./sd-field-model.js) can
// weigh each cell by its fitted curves without re-running this programme. Pure: no files, no node imports of its own
// (see "Browser safety" below).
// A legal lineup is one Captain and five FLEX, both teams present, at most the cap, no man twice (a Captain's own FLEX
// copy is never one of his five). A lineup's ownership weight is the Captain's Captain ownership times the five FLEX
// ownerships, as fractions, each in its own slot (today's straight product, ./sd-uniqueness.js). A lineup's projection
// is the Captain's FLEX projection times the Captain multiplier plus the five FLEX projections, as the meter sums it.
// A man is left out of a slot (as an unposted man is left out of Z today, section 6) when that slot's ownership is
// blank or 0, or his projection is blank; a lineup holding him is not in the table.
// The programme (section 6): one pass over every FLEX man and one per team, each a table by (men chosen, salary spent,
// projection in steps); each Captain's own FLEX copy is then taken back out by the exact recurrence
//   F_without[k][s][p] = F_all[k][s][p] - own x F_without[k-1][s - price][p - projection step],
// with negative crumbs clamped to 0 (section 6, risk 8), and the Captain's legal sets are those of everyone else minus
// those wholly from his own team. fieldTableByRestart is the slow per-Captain restart the recurrence is tested against.
// Browser safety: this file imports only CPT_MULTIPLIER from ./showdown.js (one copy of the constant). That module pulls
// ./optimize.js, which imports server/lib/log.js (node:fs); in the browser that works only because tools/publish.mjs
// puts site-src/browser-log.js in log.js's place, as for every engine module the public site already runs.
import { CPT_MULTIPLIER } from "./showdown.js";

export const DEFAULT_PROJ_STEP = 0.25; // points (section 6); the curves file names the step, and the two must match
export const MAX_CELLS_PER_COUNT = 2000000; // salary steps x projection steps per count of men (section 6's guard)
const MIN_SALARY_STEP = 50; // dollars (section 6's guard; DraftKings Showdown prices are whole hundreds)

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isBlank = (v) => v === null || v === undefined;

/** The code on a field-model refusal: a board or table the model cannot measure, said in a plain sentence meant for Adam
 *  (not a bug). The routes pass its userMessage into their "could not measure" answer; any other error stays generic. */
export const FIELD_REFUSED = "FIELD_MODEL_REFUSED";

/** A field-model refusal: an Error whose message is unchanged and whose userMessage is the same sentence without a
 *  function-name prefix ("lineupFigures: "), capitalised. The one copy (./sd-field-model.js uses it too). */
export function fieldRefusal(message) {
  const e = new Error(message);
  const plain = message.replace(/^\w+: /, "");
  e.code = FIELD_REFUSED;
  e.userMessage = plain.charAt(0).toUpperCase() + plain.slice(1);
  return e;
}

/** The plain sentence of a field-model refusal, or null for any other error (a bug keeps the routes' generic text). */
export const refusalSentence = (e) => (e && e.code === FIELD_REFUSED && typeof e.userMessage === "string" ? e.userMessage : null);

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** A man's projection in whole steps for one slot: the Captain's is his FLEX projection times the Captain multiplier,
 *  each rounded to the nearest step (section 6). The one copy of the rounding, used by the table and its tests. */
export function projSteps(proj, slot, projStep) {
  return Math.round((slot === "CPT" ? proj * CPT_MULTIPLIER : proj) / projStep);
}

/** Why an entry is left out of the table, or null when it is in. */
function leftOutReason(c, cap) {
  if (isBlank(c.own)) return "unposted";
  if (c.own === 0) return "posted at 0%";
  if (isBlank(c.proj)) return "no projection";
  if (c.slot === "CPT" && c.salary > cap) return "over the cap as Captain";
  return null;
}

const hasId = (v) => (typeof v === "string" && v !== "") || isNum(v);

/** Checks one pool entry, throwing a plain sentence for anything that is not a figure. `seen`: slot|id keys so far;
 *  `teamOf`: each person's team so far (his Captain and FLEX entries must name the same one). */
function checkEntry(c, seen, teamOf) {
  if (!c || typeof c !== "object") throw new Error("fieldTable: every pool entry must be an object.");
  if (!hasId(c.personId)) throw new Error("fieldTable: every pool entry needs a person id.");
  const id = String(c.personId);
  if (c.slot !== "CPT" && c.slot !== "FLEX") throw new Error(`fieldTable: the slot of ${id} must be CPT or FLEX.`);
  if (typeof c.team !== "string" || c.team === "") throw new Error(`fieldTable: ${id} (${c.slot}) has no team.`);
  const key = `${c.slot}|${id}`;
  if (seen.has(key)) throw new Error(`fieldTable: ${id} is in the pool twice as ${c.slot}.`);
  seen.add(key);
  if (teamOf.has(id) && teamOf.get(id) !== c.team) throw new Error(`fieldTable: ${id}'s Captain and FLEX entries name different teams (${teamOf.get(id)} and ${c.team}).`);
  teamOf.set(id, c.team);
  if (!isBlank(c.own) && (!isNum(c.own) || c.own < 0 || c.own > 1)) throw new Error(`fieldTable: ownership of ${c.personId} (${c.slot}) is not a fraction from 0 to 1.`);
  if (!isBlank(c.proj) && !isNum(c.proj)) throw new Error(`fieldTable: projection of ${c.personId} (${c.slot}) is not a finite number.`);
  if (!isBlank(c.own) && (!Number.isInteger(c.salary) || c.salary <= 0)) throw new Error(`fieldTable: salary of ${c.personId} (${c.slot}) is not a whole number of dollars above 0.`);
}

/** The pool split into the men the table counts, with every refusal as one plain sentence. */
export function preparePool(pool, cap, projStep) {
  if (!isNum(cap) || cap <= 0) throw new Error("fieldTable: cap must be a positive number of dollars.");
  if (!isNum(projStep) || projStep <= 0) throw new Error("fieldTable: the projection step must be a number of points above 0.");
  if (!Array.isArray(pool)) throw new Error("fieldTable: the pool must be a list of entries.");
  const seen = new Set();
  const teamOf = new Map();
  const teams = new Set();
  const flex = [];
  const captains = [];
  const leftOut = [];
  for (const c of pool) {
    checkEntry(c, seen, teamOf);
    teams.add(c.team);
    const reason = leftOutReason(c, cap);
    if (reason) { leftOut.push({ personId: c.personId, slot: c.slot, reason }); continue; }
    const q = projSteps(c.proj, c.slot, projStep);
    const exact = c.slot === "CPT" ? c.proj * CPT_MULTIPLIER : c.proj;
    const man = { personId: String(c.personId), team: c.team, salary: c.salary, own: c.own, q, r: exact - q * projStep }; // r: what rounding took off
    (c.slot === "CPT" ? captains : flex).push(man);
  }
  if (teams.size > 2) throw fieldRefusal(`fieldTable: a Showdown pool has two teams, and this one has ${teams.size}.`);
  const unit = flex.reduce((g, m) => gcd(g, m.salary), 0) || 100;
  if (unit < MIN_SALARY_STEP) throw fieldRefusal(`The FLEX prices share a step of only $${unit}, under $${MIN_SALARY_STEP}, so the field table cannot be built for this board.`);
  // Salary left is cap - Captain price - FLEX prices: its step must divide the cap and every Captain price too
  // (a $9,400 FLEX is a $14,100 Captain, so $200 FLEX steps give $100 steps of salary left).
  const leftStep = captains.reduce((g, m) => gcd(g, m.salary), gcd(unit, cap));
  if (leftStep < MIN_SALARY_STEP) throw fieldRefusal(`Salary left on this board moves in steps of only $${leftStep}, under $${MIN_SALARY_STEP}, so the field table cannot be built.`);
  for (const m of flex) m.units = m.salary / unit;
  return { flex, captains, leftOut, unit, leftStep, teams: [...teams] };
}

/** The table's sizes: the per-count layer (salary units x projection steps) and the output (salary left x total projection). */
function tableDims(prep, cap, projStep) {
  const { flex, captains, unit, leftStep } = prep;
  const lo = Math.min(0, ...flex.map((m) => m.q)); // a negative projection shifts every FLEX man's steps up by -lo
  for (const m of flex) m.qs = m.q - lo;
  const top5 = (key) => flex.map((m) => m[key]).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const minCs = captains.length ? Math.min(...captains.map((c) => c.salary)) : cap;
  const S1 = Math.min(Math.floor((cap - minCs) / unit), top5("units")) + 1;
  const P1 = top5("qs") + 1;
  const cellsPerCount = S1 * P1;
  if (cellsPerCount > MAX_CELLS_PER_COUNT) {
    throw fieldRefusal(`The field table for this board would need ${cellsPerCount.toLocaleString("en-US")} cells per count of men, over the ${MAX_CELLS_PER_COUNT.toLocaleString("en-US")} limit, at a projection step of ${projStep} points.`);
  }
  const qs = captains.map((c) => c.q);
  const cptQmin = qs.length ? Math.min(...qs) : 0;
  const cptQmax = qs.length ? Math.max(...qs) : 0;
  return {
    cap, unit, leftStep, projStep, S1, P1, L: S1 * P1, cellsPerCount,
    nLeft: Math.floor((cap - minCs) / leftStep) + 1,
    nProj: cptQmax - cptQmin + P1,
    cptQmin,
    projOrigin: cptQmin + 5 * lo // the total projection, in steps, of output column 0
  };
}

// The weight pass also carries a first moment beside each weight: M = the summed weight x (exact projection minus
// stepped projection) of the same sets, so the model can place each cell at its lineups' mean exact projection. Rounding
// each man to the nearest step is not a random error: the same chalky men sit in most of the field's weight, so their
// rounding shifts whole cells together (measured on KC@SEA: Z off by 6% at 0.25 points with a smooth gap curve).
// The counts pass (every weight 1) carries no moment. A layer set is { F, M } with M null for counts.

/** Layers F[k][s][p], k = 0..5: summed weight of every set of k of `men` costing s units with p shifted projection steps. */
function buildLayers(men, dims, ones) {
  const { S1, P1, L } = dims;
  const F = new Float64Array(6 * L);
  const M = ones ? null : new Float64Array(6 * L);
  F[0] = 1;
  for (const m of men) {
    if (m.units >= S1) continue; // he alone is over every Captain's budget
    const w = ones ? 1 : m.own;
    const r = m.r;
    const shift = m.units * P1 + m.qs;
    const pEnd = P1 - m.qs;
    const sEnd = S1 - m.units;
    for (let k = 4; k >= 0; k--) { // downwards, so layer k is read before this man is added to it
      const src0 = k * L;
      const dst0 = (k + 1) * L + shift;
      for (let s = 0; s < sEnd; s++) {
        const a = src0 + s * P1;
        const b = dst0 + s * P1;
        for (let p = 0; p < pEnd; p++) {
          const v = F[a + p];
          if (v === 0) continue;
          F[b + p] += w * v;
          if (M) M[b + p] += w * (M[a + p] + r * v);
        }
      }
    }
  }
  return { F, M };
}

/** A layer set with one man taken back out, written into `into` (section 6's recurrence; negative weight crumbs clamped to 0). */
function withoutMan(src, m, dims, ones, into) {
  const { S1, P1, L } = dims;
  const G = into.F;
  const GM = src.M ? into.M : null;
  G.set(src.F);
  if (GM) GM.set(src.M);
  if (m.units >= S1) return { F: G, M: GM }; // he was never added
  const w = ones ? 1 : m.own;
  const r = m.r;
  const back = L + m.units * P1 + m.qs; // from layer k, salary s, step p to layer k - 1, s - price, p - his steps
  for (let k = 1; k <= 5; k++) {
    const row0 = k * L;
    for (let s = m.units; s < S1; s++) {
      const a = row0 + s * P1;
      for (let p = m.qs; p < P1; p++) {
        const i = a + p;
        const prev = G[i - back];
        const v = G[i] - w * prev;
        G[i] = v > 0 ? v : 0;
        if (GM) GM[i] -= w * (GM[i - back] + r * prev);
      }
    }
  }
  return { F: G, M: GM };
}

/** Adds one Captain's legal lineups to the output: his weight x (five-man sets of everyone else minus those wholly from his team). */
function addCaptain(out, A, T, capt, dims, w) {
  const { S1, P1, L, unit, leftStep, cap, nProj, cptQmin } = dims;
  const budget = cap - capt.salary;
  const sMax = Math.min(S1 - 1, Math.floor(budget / unit));
  const jOff = capt.q - cptQmin;
  for (let s = 0; s <= sMax; s++) {
    const a = 5 * L + s * P1;
    const row = ((budget - s * unit) / leftStep) * nProj + jOff;
    for (let p = 0; p < P1; p++) {
      const i = a + p;
      const v = T ? A.F[i] - T.F[i] : A.F[i];
      if (!(v > 0)) continue;
      out.W[row + p] += w * v;
      if (out.M) out.M[row + p] += w * ((T ? A.M[i] - T.M[i] : A.M[i]) + capt.r * v);
    }
  }
}

const outputOf = (dims, ones) => ({ W: new Float64Array(dims.nLeft * dims.nProj), M: ones ? null : new Float64Array(dims.nLeft * dims.nProj) });
const layerSet = (dims, ones) => ({ F: new Float64Array(6 * dims.L), M: ones ? null : new Float64Array(6 * dims.L) });

/** One pass of the table (weights with their moments, or every weight 1 for counts) with the Captain-removal recurrence. */
function removalPass(prep, dims, ones) {
  const out = outputOf(dims, ones);
  if (!prep.captains.length) return out;
  const all = buildLayers(prep.flex, dims, ones);
  const byTeam = new Map(prep.teams.map((t) => [t, buildLayers(prep.flex.filter((m) => m.team === t), dims, ones)]));
  const flexOf = new Map(prep.flex.map((m) => [m.personId, m]));
  const GA = layerSet(dims, ones);
  const GT = layerSet(dims, ones);
  for (const c of prep.captains) {
    const me = flexOf.get(c.personId); // his FLEX copy, when it is in the table
    const T = byTeam.get(c.team);
    const A = me ? withoutMan(all, me, dims, ones, GA) : all;
    const Tw = me && T ? withoutMan(T, me, dims, ones, GT) : T;
    addCaptain(out, A, Tw, c, dims, ones ? 1 : c.own);
  }
  return out;
}

/** The same pass by restarting the programme for each Captain (slow; the reference the recurrence is tested against). */
function restartPass(prep, dims, ones) {
  const out = outputOf(dims, ones);
  for (const c of prep.captains) {
    const others = prep.flex.filter((m) => m.personId !== c.personId);
    const A = buildLayers(others, dims, ones);
    const T = buildLayers(others.filter((m) => m.team === c.team), dims, ones);
    addCaptain(out, A, T, c, dims, ones ? 1 : c.own);
  }
  return out;
}

function assemble(pool, { cap, projStep = DEFAULT_PROJ_STEP, counts = false } = {}, pass) {
  const started = performance.now();
  const prep = preparePool(pool, cap, projStep);
  const dims = tableDims(prep, cap, projStep);
  const { W: weights, M: moments } = pass(prep, dims, false);
  const countTable = counts ? pass(prep, dims, true).W : null;
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  return {
    cap, unit: dims.unit, leftStep: dims.leftStep, projStep, projOrigin: dims.projOrigin,
    nLeft: dims.nLeft, nProj: dims.nProj, cellsPerCount: dims.cellsPerCount,
    weights, moments, counts: countTable, total,
    members: { CPT: new Set(prep.captains.map((m) => m.personId)), FLEX: new Set(prep.flex.map((m) => m.personId)) },
    leftOut: prep.leftOut,
    ms: performance.now() - started
  };
}

/**
 * The field table of a board. `pool`: entries { personId, team, slot: "CPT" | "FLEX", salary (whole dollars), own (a
 * fraction 0..1 or null), proj (the man's FLEX projection, or null) }, the Captain entry carrying the same FLEX
 * projection (the multiplier is applied here). Options: cap (dollars), projStep (points, default 0.25), counts (also a
 * pass with every weight 1, the number of legal lineups per cell, for the rank unit; section 3 experiment a).
 * Returns { cap, unit (the FLEX price step), leftStep, projStep, projOrigin, nLeft, nProj, cellsPerCount, weights,
 * moments, counts (or null), total, members: { CPT: Set, FLEX: Set } (person ids in the table), leftOut: [{ personId,
 * slot, reason }], ms }. Cell (i, j) is weights[i * nProj + j]: salary left i x leftStep dollars, total projection
 * (projOrigin + j) x projStep points, each man's projection rounded to the step (section 6); moments[i * nProj + j] is
 * the same lineups' summed weight x (exact projection minus that stepped total), so moments / weights is how far the
 * cell's lineups sit, on average, above the cell's stepped projection. total is the sum of every cell (the straight
 * product's Z over the men in the table).
 */
export function fieldTable(pool, opts) {
  return assemble(pool, opts, removalPass);
}

/** fieldTable by the per-Captain restart, the slow reference (section 9); the same answer, cell by cell. */
export function fieldTableByRestart(pool, opts) {
  return assemble(pool, opts, restartPass);
}

/** Salary left, in dollars, of a table row. */
export const cellLeft = (table, i) => i * table.leftStep;
/** Total projection, in points, of a table column. */
export const cellProj = (table, j) => (table.projOrigin + j) * table.projStep;
