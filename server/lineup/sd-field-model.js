// The Showdown field model (the Showdown meter plan 2026-10-25, sections 3 and 5): a legal lineup's weight is its
// ownership product times a salary-left factor f and a projection-gap factor g, both read from fitted knot tables; the
// field's chance of building it is that weight over Z, the same weight summed over every legal lineup, which is the dot
// product of the board's field table (./sd-field-dp.js) with the two curves (RULES.md D82). Pure: the curves are passed in
// as an object (server/showdown/field-curves.js reads and checks data/showdown-field/curves.json), no files, no node
// imports of its own. The slate's best legal lineup (section 4) is bestLegalProjection below, the one copy the app's meter
// and the fit tool (tools/sd_field_fit.mjs) both call, so the gap is measured against the same best on both sides.
// Browser safety: CPT_MULTIPLIER comes from ./showdown.js (one copy of the constant), which pulls ./optimize.js and so
// server/lib/log.js (node:fs); in the browser that works only because tools/publish.mjs puts site-src/browser-log.js in
// log.js's place, as for every engine module the public site already runs.
// A lineup's own weight uses its exact projections; only Z uses the table's cells, each read at the one point
// fieldCells gives (the fit must read the table at the same point, or its curves are not the ones this Z uses).
// The table unit (data/findings/showdown-table-points-plan-2026-10-26.md, section 3; schema 3): the second factor reads
// a lineup's points left on the table by one swap (./sd-field-swaps.js) in place of its projection gap. Table points are
// per lineup, so its Z is summed from the board's table-points histogram (fieldHistogram in ./sd-field-enum.js, passed
// in as a value; nothing is imported from that file), each cell read at the one point histogramCells gives; a lineup's
// own factor reads its exact table points, which the caller computes (tablePoints) and passes in. A table-unit file never
// falls back to the field table (plan section 6, "a silent downgrade").
import { CPT_MULTIPLIER, optimizeShowdown, showdownCandidates } from "./showdown.js";
import { DEFAULT_FIELD } from "./sd-uniqueness.js";
import { fieldRefusal } from "./sd-field-dp.js"; // a table that does not fit the lineup or curves is a plain refusal, not a bug
import { TABLE_RULE } from "./sd-field-swaps.js"; // the table-points definition a table-unit file must name (imports nothing from here)

// Version 2 (2026-10-26, the rare-end diagnosis step 2): the seat pair ownershipExponents { captain, flex } replaces version
// 1's single ownershipExponent. Version 3 (2026-10-26, the table-points plan step 2) adds the gap unit "table" with its
// tableStep, tableSeatWeights and tableRule; a version 3 file in pct, points or rank is read exactly as version 2. All
// three versions are read (a version 1 file is both seats at its one exponent); the fit tool writes version 3 only.
export const CURVES_SCHEMA_VERSION = 3;
const READ_VERSIONS = [1, 2, 3];
const TABLE_FROM_VERSION = 3; // the first version that may name the table unit
// Section 3 experiment a: percent of the best (default), points, rank; the table-points plan's table (schema 3 on).
export const GAP_UNITS = ["pct", "points", "rank", "table"];
const OLD_GAP_UNITS = ["pct", "points", "rank"]; // the units schemas 1 and 2 may name

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isBlank = (v) => v === null || v === undefined;
const CURVE_NAMES = { left: "salary-left", gap: "projection-gap" };
const TABLE_CURVE = "table-points"; // the gap table's name in a table-unit file
const MAX_LOG_FACTOR = 50; // exp(50) is about 5e21; far past any fitted curve and far below exp's overflow near 709

/** One knot table's refusal sentence, or null when it is a usable table. `label`: the table's name in the sentence. */
function knotsError(knots, name, label = CURVE_NAMES[name]) {
  if (!Array.isArray(knots) || knots.length === 0) return `The field curves have no ${label} table.`;
  for (let i = 0; i < knots.length; i++) {
    const k = knots[i];
    if (!k || typeof k !== "object") return `The ${label} curve's knot ${i + 1} is not an {x, logFactor} pair.`;
    if (!isNum(k.x)) return `The ${label} curve's knot ${i + 1} has an x that is not a finite number.`;
    if (!isNum(k.logFactor)) return `The ${label} curve's knot ${i + 1} has a log factor that is not a finite number.`;
    if (Math.abs(k.logFactor) > MAX_LOG_FACTOR) return `The ${label} curve's knot ${i + 1} has a log factor beyond plus or minus ${MAX_LOG_FACTOR}, which no fitted curve needs.`;
    if (i > 0 && !(k.x > knots[i - 1].x)) return `The ${label} curve's knots are not in ascending order of x (knot ${i + 1}).`;
  }
  if (knots[0].logFactor !== 0) return `The ${label} curve's first knot must have a log factor of 0 (the overall scale cancels).`;
  // Salary left starts at $0; the gap's first x is left free (a rank starts at 1).
  if (name === "left" && knots[0].x !== 0) return `The ${label} curve's first knot must be at $0 left.`;
  return null;
}

/** The part of a curves object the model reads (fieldZ and lineupFigures check this much on every call): one plain
 *  sentence, or null. */
function shapeError(curves) {
  if (!curves || typeof curves !== "object" || Array.isArray(curves)) return "The field curves are not an object.";
  if (!READ_VERSIONS.includes(curves.schemaVersion)) return `The field curves file is schema version ${String(curves.schemaVersion)}; this app reads versions ${READ_VERSIONS.slice(0, -1).join(", ")} and ${READ_VERSIONS[READ_VERSIONS.length - 1]}.`;
  const tableRead = curves.schemaVersion >= TABLE_FROM_VERSION; // schemas 1 and 2 know only pct, points and rank
  const byTable = tableRead && curves.gapUnit === "table";
  for (const name of ["left", "gap"]) {
    const e = knotsError(curves[name], name, byTable && name === "gap" ? TABLE_CURVE : CURVE_NAMES[name]);
    if (e) return e;
  }
  if (!(tableRead ? GAP_UNITS : OLD_GAP_UNITS).includes(curves.gapUnit)) {
    return `The field curves name the gap unit "${String(curves.gapUnit)}"; it must be ${tableRead ? "pct, points, rank or table" : "pct, points or rank"}.`;
  }
  if (byTable) {
    const e = tableShapeError(curves);
    if (e) return e;
  } else if (!isNum(curves.projStep) || curves.projStep <= 0) return "The field curves' projection step must be a number of points above 0.";
  const s = curves.scale;
  if (!s || typeof s !== "object" || !isNum(s.uniqueEnd) || !isNum(s.chalkyEnd) || s.uniqueEnd <= 0 || s.chalkyEnd <= 0) {
    return "The field curves' scale anchors (uniqueEnd and chalkyEnd, in copies) must both be numbers above 0.";
  }
  if (!(s.uniqueEnd < s.chalkyEnd)) return "The field curves' unique end must be fewer copies than the chalky end.";
  const p = curves.provenance;
  if (!Array.isArray(p) || p.length === 0 || !p.every((n) => n && typeof n === "object" && !Array.isArray(n))) {
    return "The field curves carry no provenance (one entry for each night they were fitted on).";
  }
  return null;
}

/** The table unit's own settings (plan section 3) of a schema 3 file naming it (shapeError refuses the unit in schemas
 *  1 and 2), its knot tables already checked: one plain sentence, or null. tableStep above 0 and at most 1 point;
 *  tableSeatWeights optional (absent is 1 and 1); tableRule this code's TABLE_RULE; the table-points knots start at 0
 *  (so, ascending, none is negative); projStep is not read; the rank unit and the interaction cells (experimentsAdopted
 *  "a rank" and "c") are refused, since the table unit replaces the one and cannot carry the other. */
function tableShapeError(curves) {
  const step = curves.tableStep;
  if (!isNum(step) || !(step > 0) || step > 1) return "The field curves' table-points step (tableStep) must be a number of points above 0 and at most 1.";
  const w = curves.tableSeatWeights;
  if (w !== undefined) {
    if (!w || typeof w !== "object" || Array.isArray(w)) return "The field curves' table seat weights (tableSeatWeights) must be an object { captain, flex }.";
    const extra = Object.keys(w).find((k) => k !== "captain" && k !== "flex");
    if (extra !== undefined) return `The field curves' table seat weights carry the key "${extra}"; they hold only captain and flex.`;
    for (const [seat, label] of [["captain", "Captain"], ["flex", "FLEX"]]) {
      if (!isNum(w[seat]) || !(w[seat] > 0)) return `The field curves' ${label} table seat weight must be a finite number above 0.`;
    }
  }
  if (isBlank(curves.tableRule)) return "The field curves name no table-points rule (tableRule), so the definition they were fitted under is unknown.";
  if (curves.tableRule !== TABLE_RULE) return `The field curves were fitted under the table-points rule "${String(curves.tableRule)}"; this code computes "${TABLE_RULE}".`;
  if (curves.gap[0].x !== 0) return `The ${TABLE_CURVE} curve's first knot must be at 0 points left on the table.`;
  const adopted = Array.isArray(curves.experimentsAdopted) ? curves.experimentsAdopted : [];
  if (adopted.includes("a rank")) return "The field curves adopt the gap as a rank (experiment a), which the table unit replaces and cannot be combined with.";
  if (adopted.includes("c")) return "The field curves adopt the salary-left x gap interaction cells (experiment c), which the table unit does not carry.";
  return null;
}

/** The table unit's seat weights of checked curves, { captain, flex }: the file's tableSeatWeights, or 1 and 1 when it
 *  carries none. The one reader (the histogram and every lineup's table points must use the same pair). */
export function tableSeatWeights(curves) {
  const w = curves.tableSeatWeights;
  return w === undefined ? { captain: 1, flex: 1 } : { captain: w.captain, flex: w.flex };
}

/** The optional gapUnitChoice record (the fit's note of how the gap unit was chosen, like ownershipExponentChoice, whose
 *  inside is not checked either): absent, null or an object; one plain sentence otherwise, or null. */
function choiceError(curves) {
  const c = curves.gapUnitChoice;
  if (isBlank(c) || (typeof c === "object" && !Array.isArray(c))) return null;
  return "The field curves' gapUnitChoice must be an object recording how the gap unit was chosen.";
}

/** The spread setting (section 7, check 6): Poisson, or a negative binomial with its size; a plain sentence when it is
 *  anything else, or null. The one copy (the fit tool's ../lineup/sd-field-curves-fit.js re-exports it). */
export function spreadError(spread) {
  if (!spread || typeof spread !== "object") return "The field curves carry no spread setting.";
  if (spread.kind === "poisson") return null;
  if (spread.kind !== "negative-binomial") return `The field curves name the spread "${String(spread.kind)}"; it must be poisson or negative-binomial.`;
  if (!isNum(spread.size) || spread.size <= 0) return "The field curves' negative-binomial size must be a finite number above 0.";
  return null;
}

/**
 * Checks a curves file (section 5's shape; RULES.md D82). Returns { ok: true } or { error } with one plain sentence: schema
 * version, both knot tables ({x, logFactor} lists, x ascending and finite, logFactor finite and within plus or minus 50,
 * the first at 0; the salary-left table's first knot at $0), the gap unit, the projection step (pct, points and rank) or
 * the table unit's settings (tableShapeError), the scale anchors
 * (uniqueEnd below chalkyEnd, both above 0), the provenance (a list of the nights fitted, one object each), the spread
 * (poisson, or negative-binomial with a finite size above 0), the ownership exponents (exponentsError below; each
 * seat's ownership is raised to its seat's exponent before the product, seatOwnership below) and the optional
 * gapUnitChoice record. fieldZ and lineupFigures
 * check only the part they read (the shape up to the provenance), so the fit's in-memory curves need no spread or exponent.
 */
export function validateCurves(curves) {
  const e = shapeError(curves) ?? spreadError(curves.spread) ?? exponentsError(curves) ?? choiceError(curves);
  if (e) return { error: e };
  return { ok: true };
}

/** The ownership exponents of a curves file whose version is already checked: one plain sentence, or null. Version 2
 *  carries the seat pair ownershipExponents { captain, flex }, version 1 the single ownershipExponent (both seats); each
 *  finite and above 0. A file carrying both keys, or neither, is refused. An undefined key is absent. */
function exponentsError(curves) {
  const one = curves.ownershipExponent !== undefined;
  const pair = curves.ownershipExponents !== undefined;
  if (one && pair) return "The field curves carry both the single ownershipExponent and the seat pair ownershipExponents; a file carries one or the other.";
  if (!one && !pair) return "The field curves carry no ownership exponents (ownershipExponents { captain, flex } from schema version 2; ownershipExponent in version 1).";
  if (curves.schemaVersion === 1) {
    if (pair) return "The field curves file is schema version 1, which carries the single ownershipExponent, not the seat pair ownershipExponents.";
    const b = curves.ownershipExponent;
    return isNum(b) && b > 0 ? null : "The field curves' ownership exponent must be a finite number above 0.";
  }
  if (one) return `The field curves file is schema version ${curves.schemaVersion}, which carries the seat pair ownershipExponents { captain, flex }, not the single ownershipExponent.`;
  const p = curves.ownershipExponents;
  if (!p || typeof p !== "object" || Array.isArray(p)) return "The field curves' ownershipExponents must be an object { captain, flex }.";
  for (const [seat, label] of [["captain", "Captain"], ["flex", "FLEX"]]) {
    if (!isNum(p[seat]) || !(p[seat] > 0)) return `The field curves' ${label} ownership exponent must be a finite number above 0.`;
  }
  return null;
}

/** The two seats' ownership exponents of checked curves, { captain, flex }: version 2's pair, or version 1's single
 *  exponent in both seats. The one reader every caller uses (the app's pool, a lineup's seats, the swaps, the fit tool). */
export function seatExponents(curves) {
  const p = curves.ownershipExponents;
  if (p !== undefined) return { captain: p.captain, flex: p.flex };
  const b = curves.ownershipExponent;
  if (!isNum(b)) throw new Error("seatExponents: the curves carry no ownership exponent; check them with validateCurves first.");
  return { captain: b, flex: b };
}

/** A man's ownership in one seat as the field model weighs it: the posted fraction raised to that seat's ownership
 *  exponent (seatExponents; section 3 experiment b, the seat pair from the rare-end diagnosis step 2; 1 is the straight
 *  product and leaves the figure exactly as posted); null stays null. The one copy the app and the fit tool both apply,
 *  to the table's pool and to a lineup's own men alike: each caller passes its seat's exponent (the Captain's for the
 *  Captain seat, the FLEX one for each FLEX seat). An exponent that is not a finite number above 0 throws (a caller passing
 *  a missing seat would otherwise turn every figure into NaN). */
export function seatOwnership(own, exponent) {
  if (!isNum(exponent) || !(exponent > 0)) throw new Error(`seatOwnership: the ownership exponent ${String(exponent)} is not a finite number above 0.`);
  if (own === null || own === undefined) return null;
  return exponent === 1 ? own : own ** exponent;
}

/**
 * The slate's best legal lineup's projection (section 4), unrounded, or null when there is none: the app's optimiser
 * (optimizeShowdown, no locks) on `rows` under `excludes`, summed as each chosen candidate's own projection (the
 * Captain's at the multiplier). With no excludes this is the field's best, the one the gap and Z use (the field does not
 * know Adam's excludes); with his excludes it is the meter's displayed "best possible". The one copy the meter
 * (server/showdown/uniqueness-routes.js) and the fit tool (tools/sd_field_fit.mjs bestOf) both call. `cap`: dollars,
 * the optimiser's own default ($50,000) when absent.
 */
export function bestLegalProjection(rows, { excludes = [], cap } = {}) {
  const result = optimizeShowdown(rows, { excludes, cap });
  if (!result.feasible) return null;
  const projById = new Map(rows.flatMap((r) => showdownCandidates(r)).map((c) => [String(c.id), c.proj]));
  let sum = 0;
  for (const e of result.lineup) {
    const p = projById.get(String(e.id));
    if (!isNum(p)) return null;
    sum += p;
  }
  return sum;
}

/** A knot table's factor at x: log-linear between knots, exact at a knot, flat before the first and beyond the last. */
export function curveFactor(knots, x) {
  if (!isNum(x)) throw new Error("curveFactor: x must be a finite number.");
  const n = knots.length;
  if (x <= knots[0].x) return Math.exp(knots[0].logFactor);
  if (x >= knots[n - 1].x) return Math.exp(knots[n - 1].logFactor);
  let lo = 0;
  let hi = n - 1; // knots[lo].x <= x < knots[hi].x
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (knots[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = knots[lo];
  const b = knots[hi];
  return Math.exp(a.logFactor + ((x - a.x) / (b.x - a.x)) * (b.logFactor - a.logFactor));
}

/** Each table column's mid-rank among the table's legal lineups by projection (1 is the best), from the counts pass. */
export function fieldRanks(table) {
  if (!table.counts) throw new Error("The curves measure the gap by rank, so the field table must be built with its counts pass.");
  const { nLeft, nProj, counts } = table;
  const col = new Float64Array(nProj);
  for (let i = 0; i < nLeft; i++) for (let j = 0; j < nProj; j++) col[j] += counts[i * nProj + j];
  const rank = new Float64Array(nProj);
  let above = 0;
  for (let j = nProj - 1; j >= 0; j--) {
    rank[j] = 1 + above + Math.max(0, col[j] - 1) / 2;
    above += col[j];
  }
  return rank;
}

/** The gap measure (the curve's x) of a total projection, in the curves' unit. `ranks` only for the rank unit. Exported
 *  unchanged for the classic field model (./classic-field-model.js), so both measure the gap with one copy. */
export function gapX(proj, unit, best, table, ranks) {
  if (unit === "points") return best - proj;
  if (unit === "pct") return ((best - proj) / best) * 100;
  const t = Math.min(table.nProj - 1, Math.max(0, proj / table.projStep - table.projOrigin)); // fractional column
  const j = Math.floor(t);
  return j === t || j + 1 >= table.nProj ? ranks[j] : ranks[j] + (t - j) * (ranks[j + 1] - ranks[j]);
}

function checkBest(best, unit) {
  if (unit === "table" && isBlank(best)) return; // the table unit reads no best (plan section 3); a given one only describes the gap
  if (!isNum(best)) throw new Error("The slate's best projection must be a finite number of points.");
  if (unit === "pct" && best <= 0) throw new Error("The slate's best projection must be above 0 to measure the gap as a percentage.");
}

/** The curves checked and matched to the table, or a thrown plain sentence. The table unit reads no projection step. */
function checkedCurves(table, curves) {
  const e = shapeError(curves);
  if (e) throw new Error(e);
  if (curves.gapUnit !== "table" && curves.projStep !== table.projStep) {
    throw fieldRefusal(`The field table was built at a projection step of ${table.projStep} points but the curves were fitted at ${curves.projStep}; they must match.`);
  }
  return curves;
}

/**
 * Every weighted cell of a field table, read at the one point the model uses (the fit must read it the same way):
 * yields { i, j, w (summed ownership weight), left (dollars), proj (the cell's lineups' mean exact projection: the stepped
 * projection plus moments / weights, see ./sd-field-dp.js, held within the six men's rounding of 3 steps either way so a
 * crumb of a cell cannot land anywhere else), x (the gap in `gapUnit` against `best`, the field's best) }, row by row.
 * `ranks`: fieldRanks(table), computed here when the unit is rank and none is given. A table without moments (an
 * old-style table, or one a test strips) reads each cell at its stepped projection.
 */
export function* fieldCells(table, gapUnit, best, ranks = null) {
  if (gapUnit === "table") throw new Error("fieldCells: the table unit reads histogramCells, not the field table.");
  const { nLeft, nProj, weights, moments, leftStep, projOrigin, projStep } = table;
  const rk = gapUnit === "rank" ? ranks ?? fieldRanks(table) : null;
  const most = 3 * projStep; // six men, each rounded by at most half a step
  for (let i = 0; i < nLeft; i++) {
    const r = i * nProj;
    for (let j = 0; j < nProj; j++) {
      const w = weights[r + j];
      if (w === 0) continue;
      const proj = (projOrigin + j) * projStep + (moments ? Math.min(most, Math.max(-most, moments[r + j] / w)) : 0);
      yield { i, j, w, left: i * leftStep, proj, x: gapX(proj, gapUnit, best, table, rk) };
    }
  }
}

/**
 * Every weighted cell of a table-points histogram (fieldHistogram in ./sd-field-enum.js), read at the one point the table
 * unit's Z uses (the fit must read it the same way): yields { i, j (the bin: 0 holds table points exactly 0, bin j >= 1
 * from (j - 1) x tableStep up to j x tableStep), w (summed ownership weight), left (dollars, i x the histogram's
 * leftStep), x (the cell's lineups' mean table points, moments / weights; exactly 0 in bin 0, and held within its bin so
 * a rounding crumb cannot land anywhere else) }, row by row. The table unit's counterpart of fieldCells.
 */
export function* histogramCells(histogram) {
  const { nLeft, nBins, weights, moments, leftStep, tableStep } = histogram;
  for (let i = 0; i < nLeft; i++) {
    const r = i * nBins;
    for (let j = 0; j < nBins; j++) {
      const w = weights[r + j];
      if (w === 0) continue;
      const x = j === 0 ? 0 : Math.min(j * tableStep, Math.max((j - 1) * tableStep, moments[r + j] / w));
      yield { i, j, w, left: i * leftStep, x };
    }
  }
}

/** Why a histogram passed with pct, points or rank curves is refused (one sentence for fieldZ and lineupFigures). */
const histogramWithOldUnit = (unit) => `The field curves measure the gap in ${unit}, which reads the field table; a table-points histogram is read only by the table unit.`;

/** A table-unit histogram checked against the curves and the field table, or a thrown plain sentence. */
function checkedHistogram(histogram, table, curves) {
  if (isBlank(histogram)) {
    throw fieldRefusal("The field curves measure points left on the table, so Z needs this board's table-points histogram; the field table cannot stand in for it.");
  }
  const h = histogram;
  if (typeof h !== "object" || !ArrayBuffer.isView(h.weights) || !ArrayBuffer.isView(h.moments) || !Number.isInteger(h.nLeft) || !Number.isInteger(h.nBins) || h.weights.length !== h.nLeft * h.nBins || h.moments.length !== h.weights.length) {
    throw new Error("The table-points histogram is not a fieldHistogram answer (weights and moments by salary-left row and table-points bin).");
  }
  if (h.tableRule !== curves.tableRule) throw fieldRefusal(`The table-points histogram was measured under the rule "${String(h.tableRule)}" but the curves were fitted under "${curves.tableRule}"; they must match.`);
  if (h.tableStep !== curves.tableStep) throw fieldRefusal(`The table-points histogram was built at a step of ${h.tableStep} points but the curves were fitted at ${curves.tableStep}; they must match.`);
  const w = tableSeatWeights(curves);
  const hw = h.seatWeights ?? {};
  if (hw.captain !== w.captain || hw.flex !== w.flex) {
    throw fieldRefusal(`The table-points histogram weighs the Captain and FLEX seats ${hw.captain} and ${hw.flex} but the curves were fitted at ${w.captain} and ${w.flex}; they must match.`);
  }
  checkHistogramMatchesTable(h, table);
  return h;
}

/** Throws a plain refusal when a table-points histogram and a field table were not built from the same pool: their cap,
 *  salary-left step and rows, and total weight (to 1e-9 relative) must agree. The one copy: fieldZ and the fit's
 *  prepareNight (./sd-field-curves-fit.js) both call it. */
export function checkHistogramMatchesTable(histogram, table) {
  if (!table || typeof table !== "object") throw new Error("The table-points histogram is checked against the field table of the same pool, and none was given.");
  const h = histogram;
  const sameTotal = Math.abs(h.total - table.total) <= 1e-9 * Math.max(Math.abs(h.total), Math.abs(table.total));
  if (h.cap !== table.cap || h.leftStep !== table.leftStep || h.nLeft !== table.nLeft || !sameTotal) {
    throw fieldRefusal("The table-points histogram and the field table were built from different pools (their cap, salary-left rows or total weight differ); build both from this board's pool.");
  }
}

/** fieldZ for the table unit (plan section 3): the same three sums over the histogram's cells, Z1 with the salary-left
 *  factor and Z2 also with the table-points factor, read at each cell's mean table points. */
function tableZ(table, curves, best, histogram) {
  let Z0 = 0;
  let Z1 = 0;
  let Z2 = 0;
  let row = -1;
  let f = 0;
  for (const c of histogramCells(histogram)) {
    if (c.i !== row) { row = c.i; f = curveFactor(curves.left, c.left); }
    Z0 += c.w;
    Z1 += f * c.w;
    Z2 += f * c.w * curveFactor(curves.gap, c.x);
  }
  return { Z0, Z1, Z2, Z: Z2, ranks: null, table, curves, best, histogram };
}

/**
 * Z from a field table and the curves (section 6: a dot product over fieldCells): { Z0 (ownership alone, the table's
 * total), Z1 (with the salary-left factor), Z2 = Z (with both), ranks (the per-column ranks, rank unit only), and the
 * table, curves and best it was computed for (lineupFigures refuses a z from any other) }. `best`: the field's best legal
 * lineup's projection (no excludes; section 4), not the displayed best.
 * The table unit (plan section 3): `histogram`, fieldHistogram(...) of the same pool as the table at the curves'
 * tableStep and tableSeatWeights, is required (a refusal without it, never the field table instead); the sums run over
 * histogramCells, best may be null (it is not read), ranks is null, and the answer also carries the histogram. A
 * histogram passed with pct, points or rank curves is refused.
 */
export function fieldZ(table, curves, { best, histogram }) {
  checkedCurves(table, curves);
  checkBest(best, curves.gapUnit);
  if (curves.gapUnit === "table") return tableZ(table, curves, best, checkedHistogram(histogram, table, curves));
  if (!isBlank(histogram)) throw fieldRefusal(histogramWithOldUnit(curves.gapUnit));
  const ranks = curves.gapUnit === "rank" ? fieldRanks(table) : null;
  let Z0 = 0;
  let Z1 = 0;
  let Z2 = 0;
  let row = -1;
  let f = 0;
  for (const c of fieldCells(table, curves.gapUnit, best, ranks)) {
    if (c.i !== row) { row = c.i; f = curveFactor(curves.left, c.left); }
    Z0 += c.w;
    Z1 += f * c.w;
    Z2 += f * c.w * curveFactor(curves.gap, c.x);
  }
  return { Z0, Z1, Z2, Z: Z2, ranks, table, curves, best };
}

/** The six men's blanks by name: { unposted, unprojected } (both lists), or null when every figure is there. */
function blanksOf(men) {
  const unposted = men.filter((m) => isBlank(m.own)).map((m) => m.name);
  const unprojected = men.filter((m) => isBlank(m.proj)).map((m) => m.name);
  return unposted.length || unprojected.length ? { unposted, unprojected } : null;
}

/** Throws a plain sentence for a man whose figures are not usable, or who is weighted but not in the table. */
function checkMan(m, slot, table) {
  if (!isNum(m.own) || m.own < 0 || m.own > 1) throw new Error(`lineupFigures: ownership of ${m.name} is not a fraction from 0 to 1.`);
  if (!isNum(m.proj)) throw new Error(`lineupFigures: projection of ${m.name} is not a finite number.`);
  if (!Number.isInteger(m.salary) || m.salary <= 0) throw new Error(`lineupFigures: salary of ${m.name} is not a whole number of dollars above 0.`);
  if (m.own > 0 && !table.members[slot].has(String(m.personId))) {
    throw fieldRefusal(`lineupFigures: ${m.name} (${slot}) is not in the field table, so the table was built from another pool.`);
  }
}

/**
 * One lineup's figures under the field model. `lineup`: { cpt, flex: [five] }, each man { personId, name, own (a fraction
 * or null), proj (his FLEX projection or null), salary (in that slot) }. A blank ownership or projection gives
 * { unposted: [names], unprojected: [names] } and no figures (section 6). Otherwise lineupUniqueness's names { w, Z, p,
 * copies, aloneChance, oneIn, field } with w the model weight (ownership product x f x g) and Z the model's Z, plus
 * proj (the lineup's exact projection), parts { ownershipOnly, withLeft, withGap } (expected copies by ownership alone,
 * then also counting salary left, then also the gap; withGap is copies), left { dollars, factor } and gap { belowPts,
 * belowPct, factor } (how far the lineup sits below the FIELD's best, positive when under it: the opposite sign of the
 * meter's gapPts, which is also measured against the displayed best with Adam's excludes; rank too in the rank unit),
 * each factor against the average legal lineup as weighted at the step before (so ownershipOnly x left.factor x
 * gap.factor = copies). P is at most 1 and nothing is NaN. `best`: the field's best legal lineup's projection (no
 * excludes; section 4). `z`: fieldZ's answer for this same table, curves and best, to skip recomputing it; a z from any
 * other is refused. Test for figures with "w" in the answer, never by the absence of unposted (a blank answer carries
 * both lists, possibly empty).
 * The table unit (plan section 3): `tablePts`, tablePoints(...) of this lineup (./sd-field-swaps.js, at the curves'
 * tableSeatWeights; the caller holds the pool and the swap index), is required, and its points are the curve's x;
 * `histogram` goes to fieldZ when no z is given (a z must be for this table, curves and histogram; best is not
 * compared); best may be null, and gap { belowPts, belowPct } is then null too, gap.factor always null (descriptive
 * only); the answer gains table { points, factor (against the average legal lineup as weighted at the step before, as
 * gap.factor is for the old units, so ownershipOnly x left.factor x table.factor = copies), curveFactor (the
 * table-points curve's own factor at points), seat, slot, outIdx, inIdx, bySeat }, the rest copied from tablePts, whose
 * seatWeights must be the curves' (tableSeatWeights). With pct, points or rank curves a histogram or tablePts is refused.
 */
export function lineupFigures(lineup, { table, curves, best, field = DEFAULT_FIELD, z = null, histogram = null, tablePts = null }) {
  if (!lineup || typeof lineup !== "object" || !lineup.cpt || typeof lineup.cpt !== "object") throw new Error("lineupFigures: a Showdown lineup has a Captain.");
  if (!Array.isArray(lineup.flex) || lineup.flex.length !== 5 || !lineup.flex.every((m) => m && typeof m === "object")) {
    throw new Error("lineupFigures: a Showdown lineup has five FLEX.");
  }
  const men = [lineup.cpt, ...lineup.flex];
  const ids = new Set();
  for (const m of men) {
    if (ids.has(String(m.personId))) throw new Error(`lineupFigures: ${m.name} is in the lineup twice; a Showdown lineup has six different players.`);
    ids.add(String(m.personId));
  }
  const blanks = blanksOf(men);
  if (blanks) return blanks;
  if (!Number.isInteger(field) || field < 1) throw new Error("lineupFigures: field must be a whole number of lineups, 1 or more.");
  men.forEach((m, i) => checkMan(m, i === 0 ? "CPT" : "FLEX", table));
  checkedCurves(table, curves);
  checkBest(best, curves.gapUnit);
  const byTable = curves.gapUnit === "table";
  checkTableInputs(curves, histogram, tablePts);
  if (z && (z.table !== table || z.curves !== curves || (byTable ? !isBlank(histogram) && z.histogram !== histogram : !Object.is(z.best, best)))) {
    throw fieldRefusal(`lineupFigures: the z passed in was computed for another table, other curves or ${byTable ? "another table-points histogram" : "another best projection"}; compute it with fieldZ for this one.`);
  }
  const zz = z ?? fieldZ(table, curves, { best, histogram });
  if (!(zz.Z0 > 0)) throw fieldRefusal("lineupFigures: the field table holds no weighted lineup, so no lineup can be measured against it.");
  const dollars = table.cap - men.reduce((a, m) => a + m.salary, 0);
  if (dollars < 0) throw new Error(`lineupFigures: the lineup is $${-dollars} over the $${table.cap} cap.`);
  const proj = lineup.cpt.proj * CPT_MULTIPLIER + lineup.flex.reduce((a, m) => a + m.proj, 0);
  const own = men.reduce((a, m) => a * m.own, 1);
  if (own > 0 && own / zz.Z0 > 1 + 1e-9) throw fieldRefusal("lineupFigures: the lineup weighs more than the table's total, so it was not counted in the table.");
  const f = curveFactor(curves.left, dollars);
  const x = byTable ? tablePts.points : gapX(proj, curves.gapUnit, best, table, zz.ranks);
  const g = curveFactor(curves.gap, x);
  const leftFactor = f * (zz.Z0 / zz.Z1);
  const gapFactor = g * (zz.Z1 / zz.Z2);
  const w = own * f * g;
  const p = w === 0 ? 0 : Math.min(1, w / zz.Z2); // a stepping crumb above 1 is 1
  const ownershipOnly = own === 0 ? 0 : field * Math.min(1, own / zz.Z0);
  const belowPts = isNum(best) ? best - proj : null; // always a number for pct, points and rank (checkBest)
  return {
    w, Z: zz.Z2, p, copies: field * p,
    aloneChance: p === 0 || field === 1 ? 1 : Math.exp((field - 1) * Math.log1p(-p)),
    oneIn: p === 0 ? null : 1 / p,
    field, proj,
    parts: { ownershipOnly, withLeft: ownershipOnly * leftFactor, withGap: field * p },
    left: { dollars, factor: leftFactor },
    gap: { belowPts, belowPct: belowPts !== null && best > 0 ? (belowPts / best) * 100 : null, factor: byTable ? null : gapFactor, ...(curves.gapUnit === "rank" ? { rank: x } : {}) },
    ...(byTable ? { table: { points: tablePts.points, factor: gapFactor, curveFactor: g, seat: tablePts.seat, slot: tablePts.slot, outIdx: tablePts.outIdx, inIdx: tablePts.inIdx, bySeat: [...tablePts.bySeat] } } : {})
  };
}

/** lineupFigures' table-unit inputs (plan section 3), or a thrown plain sentence: with the table unit a tablePoints
 *  answer is required (a refusal without it, or with seat weights other than the curves'; a malformed one is a caller's
 *  bug); with pct, points or rank neither a histogram nor table points is read, so either is refused. */
function checkTableInputs(curves, histogram, tablePts) {
  const unit = curves.gapUnit;
  if (unit !== "table") {
    if (!isBlank(histogram)) throw fieldRefusal(histogramWithOldUnit(unit));
    if (!isBlank(tablePts)) throw fieldRefusal(`lineupFigures: the field curves measure the gap in ${unit}, so no table points are read; tablePts goes only with table-unit curves.`);
    return;
  }
  if (isBlank(tablePts)) throw fieldRefusal("lineupFigures: the field curves measure points left on the table, so this lineup's table points (tablePoints for it) must be passed in.");
  const t = tablePts;
  if (typeof t !== "object" || !isNum(t.points) || t.points < 0 || !Array.isArray(t.bySeat) || t.bySeat.length !== 6) {
    throw new Error("lineupFigures: tablePts is not a tablePoints answer ({ points at least 0, seat, slot, outIdx, inIdx, bySeat of six }).");
  }
  const want = tableSeatWeights(curves);
  const had = t.seatWeights;
  if (!had || typeof had !== "object") {
    throw fieldRefusal(`lineupFigures: the table points passed in record no seat weights, so they cannot be matched to the curves' Captain and FLEX seat weights ${want.captain} and ${want.flex}.`);
  }
  if (had.captain !== want.captain || had.flex !== want.flex) {
    throw fieldRefusal(`lineupFigures: the table points passed in were measured at Captain and FLEX seat weights ${had.captain} and ${had.flex}, but the curves were fitted at ${want.captain} and ${want.flex}; they must match.`);
  }
}
