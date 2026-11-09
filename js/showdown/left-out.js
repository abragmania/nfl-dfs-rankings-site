// The Cash tab's `Left out` panel (optimizer standard Part F): at most three men the working lineup does not hold, who are in the optimal lineups and heavily owned, each with the
// cheapest legal way in. Pure and browser-safe (D71): no DOM, no network, no storage. Missing is missing, never zero (D29): a man with no ownership is not listed, and a seat with
// no figure gives no way in, never a stand-in number. Seats are the panel's own shape, {cpt: {id} | null, flex: [{id} | null x5]}, ids being person ids (the board row's id).
// The roster rules are checked here because server/lineup/showdown-multi.js checkShowdownLineup and showdown.js rosterable cannot reach the browser; tests/showdown-left-out.test.mjs
// runs every way in through both, so the two copies cannot drift apart.
// The live app serves this file (server.js SHARED_SERVER_FILES); the published copy needs tools/publish.mjs PAGE_MODULES_WITH_SERVER_IMPORTS. A man out unless revived on this tab.
import { rowIsOut } from "../../server/rank/sidelined.js";

/** TwoGun's median as the Cash build reads it: a copy of server/lineup/cash.js medianOf, which the app does not serve to the browser (tests/showdown-left-out.test.mjs compares them). */
export function medianOf(row) {
  const median = typeof row?.tg?.median === "number" && Number.isFinite(row.tg.median) ? row.tg.median : null;
  return median !== null && rowIsOut(row) ? 0 : median;
}
import { money } from "../format.js";
import { showdownFillCost } from "../lineup-fit.js";
import { shownTotal } from "../totals.js";
import { playerFigures } from "./lineup-meter.js";
import { SALARY_CAP, FLEX_COUNT } from "./lineup-saved.js";
import { boardIndex, TEAM_OPTIONS, DEFAULT_MAX_PER_TEAM } from "./optimizer-state.js";

import { HEAVILY_OWNED_PCT } from "../left-out-rule.js"; // the lead's setting for "heavily owned", one copy for both Optimizers
export { HEAVILY_OWNED_PCT };
const MAX_LISTED = 3; // Part F, Adam's steer: one to three men only

const CPT_INDEX = 0; // a seat's index: 0 the Captain, 1 to 5 the FLEX seats (seats.js lockedSeatPositions)
const SEAT_COUNT = FLEX_COUNT + 1;
const NO_PROJECTION_FLAG = "no projection";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const seatWord = (index) => (index === CPT_INDEX ? "CPT" : "FLEX");
const dropDrift = (n) => Math.round(n * 1e6) / 1e6; // ownership adds as floats; the line at 20 must not turn on the sixteenth digit

/** Everything the checks read, worked out once. A FLEX id in excludes takes the man out of both seats, a Captain id only his Captain seat (server/lineup/showdown.js). */
function contextOf({ rows, lockedIds, excludedIds, maxPerTeam, figures, basis }) {
  const list = Array.isArray(rows) ? rows : [];
  const { personOf, rowOf } = boardIndex({ rows: list });
  const excludedWhole = new Set();
  const excludedCpt = new Set();
  for (const raw of excludedIds ?? []) {
    const id = String(raw);
    if (rowOf.has(id)) excludedWhole.add(id);
    else if (personOf.has(id)) excludedCpt.add(personOf.get(id));
  }
  const locked = new Set();
  for (const raw of lockedIds ?? []) if (personOf.has(String(raw))) locked.add(personOf.get(String(raw)));
  return {
    personOf,
    rowOf,
    rows: [...rowOf.values()].sort((a, b) => cmpId(String(a.id), String(b.id))), // so a reason and a tie read the same whatever order the rows came in
    excludedWhole,
    excludedCpt,
    locked,
    teams: [...new Set(list.map((r) => r?.team).filter((t) => t != null))].sort(),
    maxPerTeam: TEAM_OPTIONS.includes(String(maxPerTeam)) ? Number(maxPerTeam) : Number(DEFAULT_MAX_PER_TEAM), // the rule optimizer-state.js buildSettings sends a Build
    figures,
    basis: basis === "median" ? "median" : "proj",
  };
}

/** A man in one seat: the Captain's row, price and points in the Captain seat, the figures being the ones the working lineup shows (`figures`, computeTotals' default). `value`: the
 *  figure the Cash build ranks by (its basis): the projection, or TwoGun's median (1.5x in the Captain seat); null when he has none. */
function manAt(row, index, ctx) {
  const isCpt = index === CPT_INDEX;
  const proj = num(ctx.figures(row, isCpt).proj);
  const median = ctx.basis === "median" ? medianOf(row) : null;
  const value = ctx.basis === "median" ? (median === null ? null : isCpt ? median * 1.5 : median) : proj;
  return { id: String(row.id), name: row.name, team: row.team, index, proj, value, salary: num(isCpt ? row.cptSalary : row.salary) };
}

/** May this man come into this seat? Not sidelined, not excluded, a row for the seat, a price and a projection above 0 (server/lineup/showdown.js rosterable, showdownCandidates). */
function canTake(row, index, ctx) {
  const id = String(row.id);
  if (ctx.excludedWhole.has(id) || rowIsOut(row)) return false;
  const hasCptRow = row.cptId !== null && row.cptId !== undefined && String(row.cptId) !== "";
  if (index === CPT_INDEX ? !hasCptRow || ctx.excludedCpt.has(id) : hasCptRow && String(row.cptId) === id) return false;
  const man = manAt(row, index, ctx);
  if (man.salary === null || !(man.proj > 0) || man.value === null) return false; // a man with no figure on the build's basis cannot be ranked in
  return num(row.override?.proj) !== null || !(row.flags ?? []).includes(NO_PROJECTION_FLAG);
}

/** The men who could fill an open seat ({id, salary, cptSalary}, lineup-fit.js showdownFillCost), each priced only for the seats he can take. */
function fillersOf(after, ctx) {
  const seated = new Set(after.filter(Boolean).map((m) => m.id));
  const out = [];
  for (const row of ctx.rows) {
    if (seated.has(String(row.id))) continue;
    const salary = canTake(row, 1, ctx) ? row.salary : null;
    const cptSalary = canTake(row, CPT_INDEX, ctx) ? row.cptSalary : null;
    if (salary !== null || cptSalary !== null) out.push({ id: String(row.id), salary, cptSalary });
  }
  return out;
}

/** The first roster rule the lineup `after` (six places, a man or null) breaks, as {rule: "both" | "team" | "cap", team?}; null when it keeps them all. Open seats are costed at their cheapest legal fill. */
function brokenRule(after, ctx) {
  const men = after.filter(Boolean);
  const perTeam = new Map();
  for (const m of men) perTeam.set(m.team, (perTeam.get(m.team) ?? 0) + 1);
  if (men.length === SEAT_COUNT) {
    const missing = ctx.teams.find((t) => !perTeam.has(t));
    if (missing !== undefined) return { rule: "both", team: missing };
  }
  const over = [...perTeam].sort((a, b) => cmpId(String(a[0]), String(b[0]))).find(([, n]) => n > ctx.maxPerTeam);
  if (over) return { rule: "team", team: over[0] };
  const open = { cpt: !after[CPT_INDEX], flex: after.slice(1).filter((m) => !m).length };
  const fill = men.length === SEAT_COUNT ? 0 : showdownFillCost(open, fillersOf(after, ctx));
  return men.reduce((sum, m) => sum + m.salary, 0) + fill > SALARY_CAP ? { rule: "cap" } : null;
}

const tenths = (values) => Math.round((shownTotal(values) ?? 0) * 10); // the lineup total's one copy (totals.js): each seat rounded as it is shown, then summed

const manOut = (m) => ({ id: m.id, name: m.name, seat: seatWord(m.index), seatIndex: m.index, proj: m.proj, value: m.value, salary: m.salary });

/** The lineup after `placements` ([{index, row}]), as a move, or as the rule it breaks. */
function tryMove(kind, base, placements, ctx) {
  const after = [...base];
  for (const { index, row } of placements) after[index] = manAt(row, index, ctx);
  const problem = brokenRule(after, ctx);
  if (problem) return { problem };
  const out = placements.map(({ index }) => base[index]).filter(Boolean);
  const inn = placements.map(({ index }) => after[index]);
  return {
    move: {
      kind,
      out: out.map(manOut),
      in: inn.map(manOut),
      projChange: (tenths(inn.map((m) => m.proj)) - tenths(out.map((m) => m.proj))) / 10,
      change: (tenths(inn.map((m) => m.value)) - tenths(out.map((m) => m.value))) / 10, // on the Cash build's basis, which ranks the ways in
      basis: ctx.basis,
      salaryChange: inn.reduce((s, m) => s + m.salary, 0) - out.reduce((s, m) => s + m.salary, 0),
      seats: { cpt: after[CPT_INDEX] ? { id: after[CPT_INDEX].id } : null, flex: after.slice(1).map((m) => (m ? { id: m.id } : null)) },
    },
  };
}

// Part F: the change that costs the least on the Cash build's basis (projection, or TwoGun's median), ties going to the most salary left, then a fixed id order.
const idOrder = (w) => `${w.out.map((m) => m.id).join(",")}|${w.in.map((m) => m.id).join(",")}`;
const cheaper = (a, b) => b.change - a.change || a.salaryChange - b.salaryChange || cmpId(idOrder(a), idOrder(b));

/** The cheapest of `tries` that keeps the rules, null when none does; the rules the others broke go on `problems`. */
function cheapestOf(tries, problems) {
  const moves = [];
  for (const t of tries) {
    if (t.move) moves.push(t.move);
    else problems.push(t.problem);
  }
  return moves.sort(cheaper)[0] ?? null;
}

/** The open seats he could take: the Captain's, and the first open FLEX (the FLEX seats are alike). */
function addTries(row, base, ctx) {
  const firstFlex = base.findIndex((m, i) => i !== CPT_INDEX && !m);
  return [CPT_INDEX, firstFlex].filter((i) => i >= 0 && !base[i] && canTake(row, i, ctx)).map((index) => tryMove("add", base, [{ index, row }], ctx));
}

/** He takes a seat in that seat's role and the man there leaves; a locked man never leaves. */
function oneForOneTries(row, free, base, ctx) {
  return free.filter((i) => canTake(row, i, ctx)).map((index) => tryMove("one-for-one", base, [{ index, row }], ctx));
}

/** He takes one seat and a second seat changes to another man from off the lineup. */
function twoForTwoTries(row, free, base, ctx) {
  const seated = new Set(base.filter(Boolean).map((m) => m.id));
  const others = ctx.rows.filter((r) => String(r.id) !== String(row.id) && !seated.has(String(r.id)));
  const tries = [];
  for (const index of free.filter((i) => canTake(row, i, ctx))) {
    for (const second of free.filter((i) => i !== index)) {
      for (const other of others.filter((r) => canTake(r, second, ctx))) tries.push(tryMove("two-for-two", base, [{ index, row }, { index: second, row: other }], ctx));
    }
  }
  return tries;
}

/** One plain sentence for a man with no legal way in, from the rules that blocked him. */
function noWayText(name, problems, ctx) {
  const rules = new Set(problems.map((p) => p.rule));
  if (rules.size === 0) return `Every seat ${name} can take holds a locked man, so he cannot come in.`;
  if (rules.size > 1) return `No swap of one or two men gets ${name} in under the ${money(SALARY_CAP)} cap and the team rules.`;
  const { rule, team } = problems[0];
  if (rule === "both") return `Getting ${name} in would leave your lineup with nobody from ${team}, and DraftKings requires both teams.`;
  if (rule === "team") return `Getting ${name} in would put more than ${ctx.maxPerTeam} men from ${team} in your lineup, over your Max per team.`;
  return `No swap of one or two men gets ${name} in under the ${money(SALARY_CAP)} cap.`;
}

/** {wayIn, reason} for one man: an add, else a one-for-one, else a two-for-two, so the panel offers the simplest move. */
function wayInFor(row, base, ctx) {
  const name = row.name;
  const seats = Array.from({ length: SEAT_COUNT }, (_, i) => i);
  if (!seats.some((i) => canTake(row, i, ctx))) {
    const noMedian = ctx.basis === "median" && medianOf(row) === null;
    return { wayIn: null, reason: noMedian ? `${name} has no TwoGun median, which the Cash build ranks by, so his way in cannot be worked out.` : `${name} has no usable projection or salary for a seat he can take, so he cannot come in.` };
  }
  const problems = [];
  const free = seats.filter((i) => base[i] && !ctx.locked.has(base[i].id));
  const wayIn = cheapestOf(addTries(row, base, ctx), problems) ?? cheapestOf(oneForOneTries(row, free, base, ctx), problems) ?? cheapestOf(twoForTwoTries(row, free, base, ctx), problems);
  return wayIn ? { wayIn, reason: null } : { wayIn: null, reason: noWayText(name, problems, ctx) };
}

/** The six places as men (null for an open seat) or {issue: why no change can be worked out}: a seat with no figure gives no way in, never a stand-in number. */
function readBase(seats, ctx) {
  const ids = [seats?.cpt ?? null, ...Array.from({ length: FLEX_COUNT }, (_, i) => seats?.flex?.[i] ?? null)];
  const base = [];
  for (const [index, seat] of ids.entries()) {
    if (!seat) {
      base.push(null);
      continue;
    }
    const row = ctx.rowOf.get(String(seat.id));
    if (!row) return { issue: "A man in your lineup is no longer on this board, so the change to your lineup cannot be worked out." };
    const man = manAt(row, index, ctx);
    if (man.proj === null) return { issue: `${man.name} in your lineup has no projection, so the change to your lineup's projection cannot be worked out.` };
    if (man.salary === null) return { issue: `${man.name} in your lineup has no salary, so the change to your lineup's salary cannot be worked out.` };
    if (man.value === null) return { issue: `${man.name} in your lineup has no TwoGun median, which the Cash build ranks by, so the change cannot be worked out.` }; // never counted as 0
    base.push(man);
  }
  return { base };
}

/** Per man, how many of the optimal lineups hold him at either seat. A slot names him by person id, or by either role's id on a saved or engine lineup; a man off this board is not counted. */
function optimalCounts(optimalLineups, ctx) {
  const counts = new Map();
  for (const lineup of optimalLineups) {
    const people = new Set((lineup?.slots ?? []).map((s) => ctx.personOf.get(String(s?.personId ?? s?.playerId ?? s?.id))).filter((p) => p !== undefined));
    for (const p of people) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return counts;
}

/** A seat's ownership as the working lineup reads it: TwoGun's 0% for a man his board has no row for is not posted ownership (lineup.js workingTotalsHtml). */
const postedOwn = (f) => (f.notOnBoard ? null : num(f.own));

/** One man's figures as the panel prints them. fieldOwn: FLEX and Captain ownership added, the share of the field that has him at either seat. With one of the two not posted it is
 *  the posted one, a floor (`missingOwn` names the seat not posted: the field has him at least that much); null when neither is posted. */
function entryOf(row, inOptimal, ctx) {
  const flex = ctx.figures(row, false);
  const cpt = ctx.figures(row, true);
  const ownFlex = postedOwn(flex);
  const ownCpt = postedOwn(cpt);
  const both = ownFlex !== null && ownCpt !== null;
  return {
    id: String(row.id),
    name: row.name,
    team: row.team,
    pos: row.pos,
    fieldOwn: both ? dropDrift(ownFlex + ownCpt) : ownFlex ?? ownCpt,
    missingOwn: both ? null : ownFlex === null && ownCpt === null ? "both" : ownCpt === null ? "CPT" : "FLEX",
    ownFlex,
    ownCpt,
    proj: num(flex.proj),
    cptProj: num(cpt.proj),
    salary: num(row.salary),
    cptSalary: num(row.cptSalary),
    inOptimal,
  };
}

/**
 * The `Left out` report: {entries, unjudged}. entries: at most three men, most owned first. `rows`: the board rows. `seats`: the working lineup. `lockedIds`: the padlocks (FLEX or
 * Captain ids), not the seated men a Build also holds. `excludedIds`: the mode's excludes. `optimalLineups`: the engine's lineups ({slots: [{slot, id, personId}]}). `maxPerTeam`: 3,
 * 4 or 5. `figures`: as computeTotals'. `basis`: the Cash build's own ("median" while it builds on TwoGun's median, else "proj"), which ranks the ways in.
 * Each entry: {id, name, team, pos, fieldOwn, missingOwn, ownFlex, ownCpt, proj, cptProj, salary, cptSalary, inOptimal, optimalTotal, wayIn, reason}. A man with one seat's ownership
 * not posted is listed when the posted one alone reaches the line (fieldOwn is then a floor, missingOwn the seat not posted). wayIn: {kind: "add" | "one-for-one" | "two-for-two",
 * out: [man], in: [man], projChange, change (on the basis), basis, salaryChange, seats (the lineup after the change, the same shape as `seats`)}, man being {id, name, seat: "CPT" |
 * "FLEX", seatIndex, proj, value, salary}; null with `reason`, one sentence, when there is no legal way or no figure to work it out by. unjudged: the names of the optimal men off the
 * lineup whose ownership is not posted well enough to say (missing is never read as 0). Never changes its input.
 */
export function leftOutReport({ rows, seats, lockedIds, excludedIds, optimalLineups, maxPerTeam, figures = playerFigures, basis = "proj" }) {
  if (!Array.isArray(optimalLineups) || optimalLineups.length === 0) return { entries: [], unjudged: [] }; // no optimal lineups: an empty list, never a guess
  const ctx = contextOf({ rows, lockedIds, excludedIds, maxPerTeam, figures, basis });
  const seated = new Set([seats?.cpt, ...(seats?.flex ?? [])].filter(Boolean).map((s) => String(s.id)));
  const counts = optimalCounts(optimalLineups, ctx);
  const candidates = ctx.rows
    .filter((row) => !seated.has(String(row.id)) && counts.has(String(row.id)) && !ctx.excludedWhole.has(String(row.id)) && !rowIsOut(row))
    .map((row) => entryOf(row, counts.get(String(row.id)), ctx));
  const heavy = (e) => e.fieldOwn !== null && e.fieldOwn >= HEAVILY_OWNED_PCT;
  const unjudged = candidates.filter((e) => e.missingOwn !== null && !heavy(e)).map((e) => e.name);
  const listed = candidates
    .filter(heavy)
    .sort((a, b) => b.fieldOwn - a.fieldOwn || b.inOptimal - a.inOptimal || cmpId(a.id, b.id))
    .slice(0, MAX_LISTED);
  if (listed.length === 0) return { entries: [], unjudged };
  const { base, issue } = readBase(seats, ctx);
  const entries = listed.map((e) => ({ ...e, optimalTotal: optimalLineups.length, ...(issue ? { wayIn: null, reason: issue } : wayInFor(ctx.rowOf.get(e.id), base, ctx)) }));
  return { entries, unjudged };
}

/** The report's entries alone (leftOutReport). */
export function leftOut(args) {
  return leftOutReport(args).entries;
}
