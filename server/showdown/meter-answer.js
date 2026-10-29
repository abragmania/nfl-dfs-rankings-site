// The Showdown lineup meter's maths and answers (Adam 2026-10-18: "When I click a 6th player in a lineup, let's have it show
// projection (vs optimal, how far off is it) and then expected uniqueness based on ownership"), the one copy the app's routes
// (./uniqueness-routes.js, ./optimizer-routes.js, ./swaps.js) and the public site (site-src/site-showdown.js; RULES.md D71:
// the site does everything the app does) both run. Pure and browser-safe: no node: module, no file; the curves come in
// through the caller's loadCurves (./field-curves.js on the app, the baked file on the site), and tools/publish.mjs copies
// this file, unchanged, to out/server/showdown/ by walking the site's imports.
// One path (Adam 2026-10-20: "change sources to anything for any game ... make it uniform across everything"): the served
// board's own rows (this game's ticked sources plus Adam's typed numbers, ./lineup-rows.js lineupRows), its source lines
// from board.figures. A body still carrying the old Figures switch's mode, any value, gets lineup-checks.js
// RELOAD_PAGE_SENTENCE (staleModeError). Captain and FLEX ownership are separate and never combined; a blank is unposted,
// never zero (D29); a lineup holding an unposted man gets no uniqueness figures; while TwoGun's posted ownership is a ticked
// source, a man his board has no row for is 0% in each slot whose figure is his alone, labelled (Q8 Adam 2026-10-18).
// Copies come from the fitted field model (RULES.md D82; ./field-figures.js on ../lineup/sd-field-model.js): the board's
// field table, built once per board object (zFor), weighed by the curves, with the gap measured against the field's best
// legal lineup (no excludes). Adam's excludes never change the table, Z or any copies (the field does not know them); they
// change only the displayed best possible lineup, as in the Optimizer.
import { rowIsOut } from "../rank/sidelined.js";
import { TWOGUN_ID } from "../sources/selection-core.js";
import { lineupRows, boardTwoGun } from "./lineup-rows.js"; // the board path's rows and what this game's ticks say about TwoGun (Adam 2026-10-20)
import { staleModeError } from "./lineup-checks.js"; // the old mode field's refusal, shared with Build and Generate
import { showdownCandidates, CPT_MULTIPLIER } from "../lineup/showdown.js";
import { SHOWDOWN_CAP, showdownBoard } from "../lineup/showdown-multi.js";
import { noTwoGunProjectionNote } from "../lineup/showdown-pool.js";
import { lockedNoProjectionNote } from "../lineup/optimize.js"; // classic's sentence, swapped out below
import { DEFAULT_FIELD } from "../lineup/sd-uniqueness.js";
import { fieldTable, refusalSentence } from "../lineup/sd-field-dp.js";
import { fieldZ, bestLegalProjection, seatExponents } from "../lineup/sd-field-model.js"; // RULES.md D82: the field model, the one copy of the slate's best and the seats' exponents
import { fieldPool, fieldUniqueness } from "./field-figures.js";

/** The one path's name in every answer (the meter's and the swaps' `mode`, the modes answer's key), so a page reading it is unchanged. */
export const BOARD_PATH = "current";
const METER_FIELDS = ["cpt", "flex", "excludes", "field", "mode"]; // mode: only so an old page's body gets the reload sentence (staleModeError), not "Unknown field"
const MAX_FIELD = 10000000;
// Only for a board with no board.figures (a stand-in build with no ticked list); a served board names its ticked sources.
const CURRENT_PROJ_SOURCE = "This app's showdown projections (the board's sources, plus Adam's typed numbers)";
const CURRENT_OWN_SOURCE = "This app's showdown ownership (the published sources consolidated, plus Adam's typed numbers)";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const hasId = (v) => (typeof v === "string" && v !== "") || (typeof v === "number" && Number.isFinite(v));
const round2 = (n) => Math.round(n * 100) / 100;
const dollars = (n) => `$${n.toLocaleString("en-US")}`;
const sortedIds = (ids) => [...new Set(ids.map(String))].sort(); // excludes as the best-lineup cache keys them: strings, once each, sorted

// ---- Request checks (pure) ------------------------------------------------------------------------------------------

/** The Captain row for `id` or a plain-English refusal. */
function captainRow(id, rows) {
  if (!hasId(id)) return { error: "Pick a Captain: cpt must be his Captain id." };
  const sid = String(id);
  const row = rows.find((r) => hasId(r.cptId) && String(r.cptId) === sid);
  if (row) return isNum(row.cptSalary) ? { row } : { error: `${row.name} has no Captain price on this slate.` };
  const flexOf = rows.find((r) => String(r.id) === sid);
  if (flexOf) return { error: `${flexOf.name} was sent as Captain with his FLEX id; send his Captain id.` };
  return { error: `The Captain (id ${sid}) is not on this showdown's board.` };
}

/** The FLEX row for `id` or a plain-English refusal. */
function flexRow(id, rows) {
  if (!hasId(id)) return { error: "Each FLEX must be a player id." };
  const sid = String(id);
  const row = rows.find((r) => String(r.id) === sid && !(hasId(r.cptId) && String(r.cptId) === sid));
  if (row) return isNum(row.salary) ? { row } : { error: `${row.name} has no FLEX price on this slate.` };
  const cptOf = rows.find((r) => hasId(r.cptId) && String(r.cptId) === sid);
  if (cptOf) return { error: `${cptOf.name} was sent as FLEX with his Captain id; send his FLEX id.` };
  return { error: `The FLEX player with id ${sid} is not on this showdown's board.` };
}

/**
 * Checks a meter body against the board. Returns { error } or { cpt, flex, excludes, field } with cpt and flex as board
 * rows. Six different people, both teams, at most the $50,000 cap, every id on the board; an old page's mode, any value, is
 * refused with the reload sentence (staleModeError).
 */
export function validateMeterBody(body, rows, { cap = SHOWDOWN_CAP } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "The request must be an object of {cpt, flex, excludes, field}." };
  const unknown = Object.keys(body).find((k) => !METER_FIELDS.includes(k));
  if (unknown) return { error: `Unknown field "${unknown}"; send {cpt, flex, excludes, field}.` };
  const stale = staleModeError(body.mode);
  if (stale) return { error: stale };
  const list = Array.isArray(rows) ? rows : [];
  const c = captainRow(body.cpt, list);
  if (c.error) return { error: c.error };
  if (!Array.isArray(body.flex) || body.flex.length !== 5) {
    return { error: `flex must list exactly five FLEX ids (got ${Array.isArray(body.flex) ? body.flex.length : "none"}).` };
  }
  const flex = [];
  for (const id of body.flex) {
    const f = flexRow(id, list);
    if (f.error) return { error: f.error };
    flex.push(f.row);
  }
  const seen = new Set();
  for (const r of [c.row, ...flex]) {
    if (seen.has(String(r.id))) return { error: `${r.name} is in the lineup twice; a Showdown lineup has six different players.` };
    seen.add(String(r.id));
  }
  const teams = new Set([c.row, ...flex].map((r) => r.team));
  if (teams.size < 2) return { error: `All six players are from ${[...teams][0]}; DraftKings requires at least one player from each team.` };
  const salary = c.row.cptSalary + flex.reduce((a, r) => a + r.salary, 0);
  if (salary > cap) return { error: `This lineup costs ${dollars(salary)}, over the ${dollars(cap)} cap.` };
  let excludes = [];
  if (body.excludes !== undefined && body.excludes !== null) {
    if (!Array.isArray(body.excludes) || !body.excludes.every(hasId)) return { error: "excludes must be an array of player ids." };
    const ids = new Set(list.flatMap((r) => [r.id, r.cptId]).filter(hasId).map(String));
    const stray = body.excludes.map(String).find((id) => !ids.has(id));
    if (stray) return { error: `excludes names a player who is not on the board: ${stray}.` };
    excludes = sortedIds(body.excludes);
  }
  const f = checkMeterField(body.field);
  if (f.error) return { error: f.error };
  return { cpt: c.row, flex, excludes, field: f.field };
}

/**
 * The field size check, one copy: the meter's body and the Optimizer's optional field (optimizer-routes.js) both run it.
 * Returns { field } (absent or null is DEFAULT_FIELD) or { error } with the sentence.
 */
export function checkMeterField(value) {
  const field = value ?? DEFAULT_FIELD;
  if (!Number.isInteger(field) || field < 1 || field > MAX_FIELD) return { error: `field must be a whole number of lineups from 1 to ${MAX_FIELD.toLocaleString("en-US")}.` };
  return { field };
}

// ---- The board's numbers ---------------------------------------------------------------------------------------------

/**
 * The ownership sources behind the board's consolidated figures: only those in board.ownershipUsedIds (R85 sets a source
 * that covers too little of the main players' projected points aside, and its fetch time says nothing about the figures). A board that carries no
 * such list (built before R85) has no set-aside source, so every source counts.
 */
export function usedOwnershipSources(board) {
  const sources = board?.ownershipSources ?? [];
  if (!Array.isArray(board?.ownershipUsedIds)) return sources;
  const used = new Set(board.ownershipUsedIds);
  return sources.filter((s) => used.has(s?.id));
}

/** The oldest fetchedAt among the board's ownership sources in use (the consolidated figure is no fresher), or null. */
function ownershipFetchedAt(sources) {
  const times = (sources ?? []).map((s) => s?.fetchedAt).filter((t) => typeof t === "string" && Number.isFinite(Date.parse(t)));
  return times.length ? times.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a)) : null;
}

/**
 * The ownership half: { posted, source, asOf, asOfFrom, error, ownOf(row, slot) -> percentage or null, pool (Z's
 * candidates, own as a fraction or null), unposted: {cpt: [names], flex: [names]}, unpostedCount, isNotOnBoard(row,
 * slot?) (Q8's 0% in that slot, "CPT" or "FLEX"; with no slot, in both), reasonOf(row) -> why he stays missing or null,
 * notOnBoard: [names], cacheKey, extra: { incompleteReason } }, read from the served board alone (board.figures, board-view.js
 * boardFigures): `board` names the source and as-of, and its ticks say whether TwoGun's file is one of this game's ownership
 * sources. asOfFrom says what the time is: "posted" (TwoGun's stamp), "fetched" (the sources' fetch) or "board built".
 */
export function ownershipHalf(rows, { generatedAt = null, ownershipSources = [], board = null } = {}) {
  const ownOf = (row, slot) => {
    const v = slot === "CPT" ? row.ownCpt : row.ownFlex;
    return isNum(v) ? v : null;
  };
  // While TwoGun's posted file is one of this game's ticked ownership sources, Q8 holds slot by slot (Captain and FLEX
  // apart: a slot whose figure is TwoGun's 0 alone, row.src.ownCpt / ownFlex, says so; a blend or another source's figure
  // does not), a man left blank carries TwoGun's reason, and a list that looks partial says so (incompleteReason); with
  // TwoGun unticked, or a board with no figures, none of these applies.
  const his = board?.figures?.twogun ?? null;
  const off = new Set(his?.notOnBoardIds ?? []);
  const hisSlot = (row, slot) => row.src?.[slot === "CPT" ? "ownCpt" : "ownFlex"] === TWOGUN_ID;
  const isNotOnBoard = (row, slot) => off.has(String(row.id)) && (slot ? hisSlot(row, slot) : hisSlot(row, "CPT") && hisSlot(row, "FLEX"));
  const reasonOf = (row) => (his && !(isNum(row.ownFlex) && isNum(row.ownCpt)) ? his.unpostedReasons?.[String(row.id)] ?? null : null);
  const extra = { incompleteReason: his?.incompleteReason ?? null };
  const fig = board?.figures?.ownership ?? null;
  const fetched = ownershipFetchedAt(ownershipSources);
  const asOf = fetched ?? generatedAt;
  const head = fig
    ? { source: fig.source, asOf: fig.asOf, asOfFrom: fig.asOfFrom, error: fig.error ?? null, cacheKey: BOARD_PATH, extra }
    : { source: CURRENT_OWN_SOURCE, asOf, asOfFrom: fetched ? "fetched" : asOf ? "board built" : null, error: null, cacheKey: BOARD_PATH, extra };
  const pool = [];
  const unposted = { cpt: [], flex: [] };
  for (const row of rows) {
    for (const c of showdownCandidates(row)) {
      if (!isNum(c.salary)) continue;
      const slot = c.pos === "CPT" ? "CPT" : "FLEX";
      const pct = ownOf(row, slot);
      if (pct === null) unposted[slot === "CPT" ? "cpt" : "flex"].push(row.name);
      pool.push({ personId: c.personId, team: c.team, slot, salary: c.salary, own: pct === null ? null : pct / 100 });
    }
  }
  const postedIn = (slot) => pool.some((c) => c.slot === slot && c.own !== null);
  const posted = postedIn("CPT") && postedIn("FLEX");
  const notOnBoard = rows.filter((r) => isNotOnBoard(r, "FLEX") || isNotOnBoard(r, "CPT")).map((r) => r.name); // counted at 0% in at least one slot
  return { ...head, posted, ownOf, pool, unposted, unpostedCount: { cpt: unposted.cpt.length, flex: unposted.flex.length }, isNotOnBoard, reasonOf, notOnBoard };
}

/** How the injury report names a sidelined man's status, for a sentence ("Out", "Doubtful", "IR"; "injured" when only the flag says so). */
function sidelinedWord(row) {
  const s = String(row?.status ?? "").trim();
  const up = s.toUpperCase();
  if (up === "O" || up === "OUT") return "Out";
  if (up === "D" || up === "DOUBTFUL") return "Doubtful";
  if (up === "IR" || up === "INJURED RESERVE") return "IR";
  if (up === "PUP" || up === "PHYSICALLY UNABLE TO PERFORM") return "PUP";
  if (up === "NFI" || up === "NON-FOOTBALL INJURY") return "NFI";
  if (up === "INACTIVE") return "Inactive";
  if (up === "SUSPENDED" || up === "SUSPENSION") return "Suspended";
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "injured";
}

/**
 * The projection half: { posted, source, asOf, asOfFrom ("meta", "file time", "fetched" or "board built"), error,
 * projOf(row) -> FLEX projection or null, noteOf(row) -> the hover sentence for a man counted out or null, rowsForBest,
 * unposted: [names], cacheKey, extra }. `rows` are lineupRows(board), and a man is read by id from them, so a row of
 * board.rows sent in (the meter's checked lineup) gets the same figure (a revive set aside under TwoGun only included).
 * Any number on the row counts, a man counted out (D45) at his 0 and a DraftKings-average stand-in at his average, exactly
 * as Build, Generate, the saved snapshot and the public site's Build sum him (Adam 10-18 removed the stand-in under TwoGun
 * only, select.js standInRows; whether one should ever count when gaps are blank is open for Adam). `tp`: TwoGun's
 * projections file as read (twogun-projections.js loadTwoGunProjections), used only for noteOf's sentence, or null.
 */
export function projectionHalf(rows, { tp = null, generatedAt = null, board = null } = {}) {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const mine = (row) => byId.get(String(row.id)) ?? row;
  const projOf = (row) => (isNum(mine(row).proj) ? mine(row).proj : null);
  // While TwoGun is a ticked projection source, a man counted out (D45) shows TwoGun's own figure beside his 0.
  const two = boardTwoGun(board);
  const noteOf = (row) => (two.proj && tp?.posted && rowIsOut(mine(row)) ? countsAsZeroNote(row, tp.byId.get(String(row.id)) ?? null) : null);
  const fig = board?.figures?.projection ?? null;
  return {
    posted: rows.some((r) => projOf(r) !== null), source: fig ? fig.source : CURRENT_PROJ_SOURCE, asOf: fig ? fig.asOf : generatedAt,
    asOfFrom: fig ? fig.asOfFrom : generatedAt ? "board built" : null, error: fig?.error ?? null, projOf, noteOf, rowsForBest: rows,
    unposted: rows.filter((r) => projOf(r) === null).map((r) => r.name), cacheKey: BOARD_PATH, extra: {}
  };
}

/** The hover sentence for a man counted as 0 because the injury report lists him out (D45), TwoGun's own figure named:
 *  one decimal, from the unrounded figures, exactly as the slots and lists print them (format.js dec1). */
function countsAsZeroNote(row, theirs) {
  return `${row.name} is listed ${sidelinedWord(row)} by the injury report, so he counts as 0; ${theirs === null ? "TwoGun has no projection for him" : `TwoGun projects ${theirs.toFixed(1)} at FLEX (${(theirs * CPT_MULTIPLIER).toFixed(1)} as Captain)`}.`;
}

/**
 * Both halves on one board, the one way the meter, the modes answer and the swaps build them: { rows, own, proj }, from
 * lineupRows(board) and the served board's figures and ticks. `tp` (optional): TwoGun's projections file, for noteOf only.
 */
export function halvesOf(board, { tp = null } = {}) {
  const rows = lineupRows(board);
  const generatedAt = board.generatedAt ?? null;
  return {
    rows,
    own: ownershipHalf(rows, { generatedAt, ownershipSources: usedOwnershipSources(board), board }),
    proj: projectionHalf(rows, { tp, generatedAt, board })
  };
}

// ---- Caches: per board object (a rebuilt board is a new object), per cap or excludes -----------------------------------
const zCache = new WeakMap();
const bestCache = new WeakMap();

function cached(store, board, key, compute) {
  if (!store.has(board)) store.set(board, new Map());
  const m = store.get(board);
  if (m.has(key)) return { ...m.get(key), cached: true };
  const value = compute();
  m.set(key, value);
  return { ...value, cached: false };
}

/** The best legal lineup's projection on the projection half's rows under `excludes` (sorted id strings), no locks and
 *  `cap`, unrounded, or null when none: bestLegalProjection, cached per board object and cap. With no excludes it is the
 *  field's best (the one the gap and Z use, plan section 4), the same cache entry the displayed best uses then. */
function bestFor(board, proj, excludes, cap) {
  return cached(bestCache, board, `${proj.cacheKey}|${cap}|${excludes.join(",")}`, () => ({ best: bestLegalProjection(proj.rowsForBest, { excludes, cap }) })).best;
}

/**
 * The board's field for these halves, cap and curves (RULES.md D82), shared by the meter and the swaps: { table (the field
 * table, ../lineup/sd-field-dp.js, built once per board object, cap, projection step and pair of seat ownership exponents,
 * seatExponents: the Captain's and the FLEX one are both in the key, so curves differing in either get their own table), z (fieldZ
 * for these curves and the field's best), best (the field's best legal projection under the same cap, no excludes, unrounded; null when it
 * cannot be worked out, and then no table is built), ms (the cold build: the table plus its Z), cached (the table came
 * from the cache) }. Adam's excludes are never an input: the field does not know them.
 */
export function zFor(board, own, proj, curves, cap = SHOWDOWN_CAP) {
  const best = bestFor(board, proj, [], cap); // the field's best under the same cap as the table
  if (!isNum(best) || !(best > 0)) return { table: null, z: null, best: null, ms: 0, cached: false };
  const ex = seatExponents(curves);
  const key = `${own.cacheKey}|${proj.cacheKey}|${cap}|${curves.projStep}|${ex.captain}|${ex.flex}|${curves.gapUnit === "rank" ? "counts" : ""}`;
  const { entry, cached: hit } = cached(zCache, board, key, () => {
    const table = fieldTable(fieldPool(proj.rowsForBest, own, proj, ex), { cap, projStep: curves.projStep, counts: curves.gapUnit === "rank" });
    return { entry: { table, ms: table.ms, zs: new WeakMap() } };
  });
  let z = entry.zs.get(curves);
  if (!z || !Object.is(z.best, best)) {
    const started = performance.now();
    z = fieldZ(entry.table, curves, { best });
    entry.zs.set(curves, z);
    if (!hit) entry.ms += performance.now() - started; // the cold time is the table and its first Z together
  }
  return { table: entry.table, z, best, ms: entry.ms, cached: hit };
}

const pctFraction = (pct) => (pct === null ? null : pct / 100);

/**
 * The per-board half of the meter, shared by every lineup measured against it: both halves and the best projection under
 * `excludes` (sorted id strings, as validateMeterBody gives them), from the per-board cache. The field table is not built
 * here: lineupFigures asks zFor only for a lineup that can be measured, as the single meter always has. `curves`: the
 * checked field curves (./field-curves.js loadFieldCurves); without them uniqueness is a blank answer saying so (a caller
 * after the projections only, such as tools/sd_field_digest.mjs); every route passes them.
 */
function meterContext(board, { excludes, cap = SHOWDOWN_CAP, curves = null }) {
  const { own, proj } = halvesOf(board);
  const bestProj = proj.posted ? bestFor(board, proj, excludes, cap) : null;
  return { board, cap, own, proj, bestProj, curves };
}

/** The meter's answer for one checked lineup on one board; `curves` as meterContext takes them. */
export function measureLineup(board, checked, { cap = SHOWDOWN_CAP, curves = null } = {}) {
  return lineupFigures(meterContext(board, { excludes: checked.excludes, cap, curves }), checked);
}

/**
 * POST .../lineup/meter's answer for a request body on a served board, the one copy the route (./uniqueness-routes.js) and
 * the public site (site-src/site-showdown.js, RULES.md D71) both run: { ok: true, result } (the 200 body before its
 * envelope: mode, proj, bestProj, gapPts, gapPct, projection, ownership, uniqueness) or { ok: false, status, code, message,
 * log? } (`log`: { message, extra } for the caller's error log). The body is checked first (validateMeterBody, 400); only
 * then is `loadCurves()` asked for { curves } or { error } (RULES.md D82: no curves, no copies; the plain sentence names the
 * file, never a fall-back to the straight product); a board the field model refuses (too many cells, an odd price step, a
 * table that does not fit) is said in its own plain sentence, anything else keeps the generic text.
 */
export function meterAnswer(board, body, { loadCurves }) {
  const checked = validateMeterBody(body, board.rows ?? []);
  if (checked.error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: checked.error };
  const loaded = loadCurves();
  if (loaded.error) return { ok: false, status: 500, code: "LINEUP_METER_FAILED", message: loaded.error, log: { message: "showdown meter: the field curves could not be loaded", extra: { error: loaded.error } } };
  try {
    return { ok: true, result: measureLineup(board, checked, { curves: loaded.curves }) };
  } catch (e) {
    const why = refusalSentence(e);
    return {
      ok: false, status: 500, code: "LINEUP_METER_FAILED", message: why ? `Could not measure this lineup: ${why}` : "Could not measure this lineup.",
      log: { message: "showdown meter: failed", extra: { error: e.message, stack: e.stack } }
    };
  }
}

/**
 * The meter on a batch of the Optimizer's lineups (Adam 2026-10-18: "being unique is more important than any
 * projection optimization"). `lineups`: the generate answer's lineups (generate-request.js enrichShowdownResult), each
 * slot carrying slot ("CPT" or "FLEX") and playerId (the Captain's Captain id, a FLEX man's FLEX id). Each lineup is
 * checked by validateMeterBody and measured by lineupFigures, exactly as POST .../lineup/meter does with the body
 * {cpt, flex, excludes, field}, so the batch and the single meter cannot disagree; the halves and the best projection are
 * built once per batch and the field table comes from the per-board cache (built at most once). `curves`: the checked
 * field curves (the route passes them). Returns { results: one meter answer per lineup in the lineups' order, meter: the
 * batch's facts { field, bestProj, zMs, zCached (both null when no lineup could be measured), projection, ownership } }.
 * A lineup the board cannot hold throws: the engine only builds from the board, so that is a bug, never a figure.
 */
export function measureBatch(board, lineups, { excludes = [], field = DEFAULT_FIELD, cap = SHOWDOWN_CAP, curves = null } = {}) {
  const rows = board.rows ?? [];
  const checkedAll = (lineups ?? []).map((l, i) => {
    const slots = Array.isArray(l?.slots) ? l.slots : [];
    const body = { cpt: slots.find((s) => s.slot === "CPT")?.playerId, flex: slots.filter((s) => s.slot !== "CPT").map((s) => s.playerId), excludes, field };
    const checked = validateMeterBody(body, rows, { cap });
    if (checked.error) throw new Error(`measureBatch: lineup ${i + 1} cannot be measured: ${checked.error}`);
    return checked;
  });
  const ctx = meterContext(board, { excludes: sortedIds(excludes ?? []), cap, curves });
  const results = checkedAll.map((checked) => lineupFigures(ctx, checked));
  const firstZ = results.find((r) => r.uniqueness && "w" in r.uniqueness)?.uniqueness ?? null; // a blank answer has no w
  const { own, proj } = ctx;
  return {
    results,
    meter: {
      field,
      bestProj: ctx.bestProj === null ? null : round2(ctx.bestProj),
      zMs: firstZ ? firstZ.zMs : null,
      zCached: firstZ ? firstZ.zCached : null,
      projection: { posted: proj.posted, source: proj.source, asOf: proj.asOf, asOfFrom: proj.asOfFrom, error: proj.error },
      ownership: { posted: own.posted, source: own.source, asOf: own.asOf, asOfFrom: own.asOfFrom, error: own.error, unpostedCount: own.unpostedCount }
    }
  };
}

/** One lineup's meter answer on a meterContext; the one copy of the maths behind measureLineup and measureBatch. */
function lineupFigures(ctx, checked) {
  const { board, cap, own, proj, bestProj } = ctx;
  const { cpt, flex, field } = checked;
  const parts = [proj.projOf(cpt), ...flex.map((r) => proj.projOf(r))];
  const lineupProj = parts.every(isNum) ? parts[0] * CPT_MULTIPLIER + parts.slice(1).reduce((a, b) => a + b, 0) : null;
  const gapPts = lineupProj !== null && bestProj !== null ? lineupProj - bestProj : null;
  const gapPct = gapPts !== null && bestProj > 0 ? (gapPts / bestProj) * 100 : null;

  const lineupOwn = { cpt: { name: cpt.name, own: pctFraction(own.ownOf(cpt, "CPT")) }, flex: flex.map((r) => ({ name: r.name, own: pctFraction(own.ownOf(r, "FLEX")) })) };
  const unposted = [lineupOwn.cpt, ...lineupOwn.flex].filter((m) => m.own === null).map((m) => m.name);
  // Q8: counted at 0% in his seat (the Captain in the Captain slot, each FLEX in FLEX), named on the page.
  const notOnBoard = [[cpt, "CPT"], ...flex.map((r) => [r, "FLEX"])].filter(([r, slot]) => own.isNotOnBoard(r, slot)).map(([r]) => r.name);
  // A man with no ownership in his seat: null, unchanged (plan section 8). Otherwise the field model's figures, or a blank
  // { unposted, unprojected, reason } (a man with no projection, no projections posted, no curves).
  let uniqueness = null;
  if (own.posted && unposted.length === 0) {
    uniqueness = fieldUniqueness({ board, own, proj, curves: ctx.curves, field, cpt, flex, fieldFor: () => zFor(board, own, proj, ctx.curves, cap) });
  }
  return {
    mode: BOARD_PATH,
    proj: lineupProj === null ? null : round2(lineupProj),
    bestProj: bestProj === null ? null : round2(bestProj),
    gapPts: gapPts === null ? null : round2(gapPts),
    gapPct: gapPct === null ? null : round2(gapPct),
    projection: { posted: proj.posted, source: proj.source, asOf: proj.asOf, asOfFrom: proj.asOfFrom, error: proj.error },
    ownership: { posted: own.posted, source: own.source, asOf: own.asOf, asOfFrom: own.asOfFrom, error: own.error, unposted, unpostedCount: own.unpostedCount, notOnBoard },
    uniqueness
  };
}

/**
 * The per-player figures for the six lineup slots, keyed by the FLEX row id: { proj, cptProj, ownCpt, ownFlex } from the
 * same projOf and ownOf the meter uses (cptProj is projOf times the Captain multiplier; ownership in percent). A figure
 * the board does not have is null, never zero (D29); notOnBoardCpt / notOnBoardFlex say slot by slot that the figure is
 * Q8's 0% (only where that slot's figure is TwoGun's alone); a man at Q8's 0% in both slots carries notOnBoard: true.
 */
export function playerFigures(rows, own, proj) {
  const out = {};
  for (const row of rows) {
    const p = proj.projOf(row);
    out[String(row.id)] = {
      proj: p, cptProj: p === null ? null : p * CPT_MULTIPLIER, ownCpt: own.ownOf(row, "CPT"), ownFlex: own.ownOf(row, "FLEX"),
      notOnBoard: own.isNotOnBoard(row), notOnBoardCpt: own.isNotOnBoard(row, "CPT"), notOnBoardFlex: own.isNotOnBoard(row, "FLEX"), // Q8 in both slots, and slot by slot
      missingReason: own.reasonOf(row), projNote: proj.noteOf(row)
    };
  }
  return out;
}

/** GET .../modes: under "current" (BOARD_PATH), whether projections and ownership are posted, as of when, who is unposted,
 *  and each player's figures. `tp`: TwoGun's projections file, for the projNote sentence only (projectionHalf). */
export function describeModes(board, { tp = null } = {}) {
  const { rows, own, proj } = halvesOf(board, { tp });
  return {
    [BOARD_PATH]: {
      players: playerFigures(rows, own, proj),
      projection: { posted: proj.posted, source: proj.source, asOf: proj.asOf, asOfFrom: proj.asOfFrom, error: proj.error, unposted: proj.unposted, unpostedCount: proj.unposted.length, ...proj.extra },
      ownership: { posted: own.posted, source: own.source, asOf: own.asOf, asOfFrom: own.asOfFrom, error: own.error, unposted: own.unposted, unpostedCount: own.unpostedCount, notOnBoard: own.notOnBoard, ...own.extra }
    }
  };
}

// ---- Build's notes on a board TwoGun alone projects (Adam 2026-10-18 Q16) ------------------------------------------------

/**
 * Build's notes while TwoGun is the only ticked projection source (board.mode.cashMode "twogun", D81): a locked man with no
 * projection gets the Optimizer engine's sentence (showdown-pool.js noTwoGunProjectionNote) in place of the classic
 * optimiser's "has no projection and counts as 0" (optimize.js), so Build and Generate say it the same way. `rows`: Build's
 * rows (lineupRows); `lockIds`: Build's candidate-id locks. Pure.
 */
export function twoGunBuildNotes(notes, rows, lockIds) {
  const board = showdownBoard(rows);
  const ours = [];
  const classic = new Set();
  for (const id of new Set((lockIds ?? []).map(String))) {
    const c = board.byCand.get(id);
    if (!c || isNum(c.proj)) continue;
    ours.push(noTwoGunProjectionNote(c.name));
    classic.add(lockedNoProjectionNote(c.name));
  }
  return [...(Array.isArray(notes) ? notes : []).filter((n) => !classic.has(n)), ...ours];
}
