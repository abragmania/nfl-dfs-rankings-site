// The classic Cash tab's `Left out` panel (optimizer standard Part F, the Showdown's showdown/left-out.js and its rule): at most three men the working lineup does not hold, who are in the optimal lineups and heavily
// owned, each with the cheapest legal way in. Pure and browser-safe (D71): no DOM, no network, no storage. Missing is missing, never zero (D29): a man with no ownership is not listed, and a seat with no figure gives
// no way in, never a stand-in number. Seats are the page's own shape, nine entries {id} | null (a slot's name is its index in LINEUP_SLOTS). The engine's roster rules cannot reach the browser, so positions, the cap,
// Max per team, DraftKings' two-games rule and the avoided games are checked here; tests/classic-left-out.test.mjs runs every way in through the engine's own validator.
import { dec1, money, pct1 } from "./format.js";
import { rowIsOut } from "./out.js";
import { scoreOfRow } from "./lineup-cash.js";
import { fillPool, classicFillCost, FLEX_POSITIONS } from "./lineup-fit.js";
import { shownTotal } from "./totals.js";
import { HEAVILY_OWNED_PCT } from "./left-out-rule.js"; // the lead's setting for "heavily owned", one copy for both Optimizers

export { HEAVILY_OWNED_PCT };

const SLOT_NAMES = Object.freeze(["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"]);
const SALARY_CAP = 50000;
const MAX_LISTED = 3; // Part F, Adam's steer: one to three men only
const NO_PROJECTION_FLAG = "no projection";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const seatTakes = (index, pos) => SLOT_NAMES[index] === pos || (SLOT_NAMES[index] === "FLEX" && FLEX_POSITIONS.includes(pos));
const upper = (v) => String(v ?? "").trim().toUpperCase();

/** Everything the checks read, worked out once. `rows`: the slate on screen's. Max per team: a whole number, or null for no limit. */
function contextOf({ rows, lockedIds, excludedIds, avoidGames, maxPerTeam, basis, twoGun }) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id != null);
  const n = Number(maxPerTeam);
  const ctx = {
    rows: [...list].sort((a, b) => cmpId(String(a.id), String(b.id))), // so a reason and a tie read the same whatever order the rows came in
    rowOf: new Map(list.map((r) => [String(r.id), r])),
    excluded: new Set((excludedIds ?? []).map(String)),
    locked: new Set((lockedIds ?? []).map(String)),
    avoided: new Set((avoidGames ?? []).map(upper)),
    maxPerTeam: Number.isInteger(n) && n > 0 ? n : null,
    basis: basis === "median" ? "median" : "proj",
    twoGun: Boolean(twoGun),
    held: new Set(), // the DraftKings identities of the men seated or padlocked (readHeld): a twin row of one of them is the same man
    pool: null, // the cheapest fill of open seats: the men who could come in and are not held, built once per report (readBase's seats are the same for every man)
  };
  return ctx;
}

/** The same DraftKings player: a board can carry him under two ids, so a seated or held man is compared by this (lineup.js dkIdentity's rule, the page's one meaning of "the same man"). */
const dkOf = (row) => String(row?.dkId ?? row?.id);
const revived = (row) => (row?.flags ?? []).includes("revived") || row?.override?.revive === true;
/** Barred from the panel: a man out; and in TwoGun mode a revived one too, whatever the engine would allow (Adam's standing rule: never raise an Out or revived man in TwoGun mode). */
const barred = (row, ctx) => rowIsOut(row) || (ctx.twoGun && revived(row));

/** The identities of the men in the `seats` and the padlocks: a man held is never listed, nor a twin of his. */
function readHeld(seats, lockedIds, ctx) {
  const ids = [...(seats ?? []).filter(Boolean).map((s) => String(s.id)), ...(lockedIds ?? []).map(String)];
  return new Set(ids.map((id) => dkOf(ctx.rowOf.get(id) ?? { id })));
}

/** The fill pool for the open seats: the men who could take a seat (canTake), not held (lineup-fit.js fillPool). */
function buildFillPool(ctx) {
  return fillPool(ctx.rows.filter((r) => !ctx.held.has(dkOf(r)) && canTake(r, ctx)).map((r) => ({ id: String(r.id), pos: r.pos, salary: r.salary })));
}

/** A man as the checks read him: the figures the Cash build ranks by (`value`: its basis, the projection or TwoGun's median; null when he has none). */
function manOf(row, ctx) {
  return { id: String(row.id), name: row.name, pos: row.pos, team: upper(row.team), game: upper(row.gameId), salary: num(row.salary), proj: num(row.proj), value: scoreOfRow(row, ctx.basis) };
}

/** May this man come in? Not sidelined (and not revived in TwoGun mode), not excluded, not in an avoided game, a position the roster uses, a price, and a projection above 0 and a figure on the build's basis (the engine's own pool rules: server/lineup/optimize.js). */
function canTake(row, ctx) {
  const man = manOf(row, ctx);
  if (ctx.excluded.has(man.id) || barred(row, ctx) || ctx.avoided.has(man.game)) return false;
  if (!["QB", "RB", "WR", "TE", "DST"].includes(row.pos)) return false;
  if (man.salary === null || !(man.proj > 0) || man.value === null) return false; // a man with no figure on the build's basis cannot be ranked in
  return num(row.override?.proj) !== null || !(row.flags ?? []).includes(NO_PROJECTION_FLAG);
}

/** The seats for `men` (nine places, a man or null): each keeps the seat `base` has him in when he can, the others take their own position's open seat, else FLEX; a man moves seat only to make the new men fit. Null when no seating fits. Pure. */
function seatMen(men, base) {
  const held = new Map(base.map((m, i) => (m ? [m.id, i] : null)).filter(Boolean));
  const order = [...men].sort((a, b) => (held.has(b.id) ? 1 : 0) - (held.has(a.id) ? 1 : 0)); // the men already seated are placed first
  const seats = new Array(SLOT_NAMES.length).fill(null);
  const options = (m) => {
    const own = SLOT_NAMES.map((_, i) => i).filter((i) => seatTakes(i, m.pos));
    return held.has(m.id) && seatTakes(held.get(m.id), m.pos) ? [held.get(m.id), ...own.filter((i) => i !== held.get(m.id))] : own;
  };
  const place = (k) => {
    if (k === order.length) return true;
    for (const i of options(order[k])) {
      if (seats[i]) continue;
      seats[i] = order[k];
      if (place(k + 1)) return true;
      seats[i] = null;
    }
    return false;
  };
  return place(0) ? seats : null;
}

/** The roster rule the seated `men` break, as {rule, team?}; null when they keep them all. An open seat is costed at its cheapest legal fill (lineup-fit.js, the one the pool greys by), leaving out the man asked about. */
function brokenRule(men, seats, ctx, askedId) {
  const perTeam = new Map();
  for (const m of men) perTeam.set(m.team, (perTeam.get(m.team) ?? 0) + 1);
  if (ctx.maxPerTeam !== null) {
    const over = [...perTeam].sort((a, b) => cmpId(a[0], b[0])).find(([, n]) => n > ctx.maxPerTeam);
    if (over) return { rule: "team", team: over[0] };
  }
  if (men.length === SLOT_NAMES.length && new Set(men.map((m) => m.game)).size < 2) return { rule: "games" };
  const open = SLOT_NAMES.filter((_, i) => !seats[i]);
  const fill = open.length ? classicFillCost(open, ctx.pool, askedId) : 0;
  return men.reduce((sum, m) => sum + m.salary, 0) + fill > SALARY_CAP ? { rule: "cap" } : null;
}

const tenths = (values) => Math.round((shownTotal(values) ?? 0) * 10); // the lineup total's one copy (totals.js): each seat rounded as it is shown, then summed
const manOut = (m, seat) => ({ id: m.id, name: m.name, seat: seat ?? m.pos, pos: m.pos, proj: m.proj, value: m.value, salary: m.salary });

/** The lineup with `inMen` in and `outMen` out, as a move, or as the rule it breaks. */
function tryMove(kind, base, outMen, inMen, ctx, askedId) {
  const gone = new Set(outMen.map((m) => m.id));
  const after = [...base.filter((m) => m && !gone.has(m.id)), ...inMen];
  const seats = seatMen(after, base);
  if (!seats) return { problem: { rule: "positions" } };
  const problem = brokenRule(after, seats, ctx, askedId);
  if (problem) return { problem };
  const seatOf = (m) => SLOT_NAMES[seats.findIndex((s) => s && s.id === m.id)];
  const seatedOut = (m) => SLOT_NAMES[base.findIndex((s) => s && s.id === m.id)];
  return {
    move: {
      kind,
      out: outMen.map((m) => manOut(m, seatedOut(m))),
      in: inMen.map((m) => manOut(m, seatOf(m))),
      projChange: (tenths(inMen.map((m) => m.proj)) - tenths(outMen.map((m) => m.proj))) / 10,
      change: (tenths(inMen.map((m) => m.value)) - tenths(outMen.map((m) => m.value))) / 10, // on the Cash build's basis, which ranks the ways in
      basis: ctx.basis,
      salaryChange: inMen.reduce((s, m) => s + m.salary, 0) - outMen.reduce((s, m) => s + m.salary, 0),
      seats: seats.map((m) => (m ? { id: m.id } : null)),
    },
  };
}

// The change that costs the least on the Cash build's basis, ties going to the most salary left, then a fixed id order (as the Showdown's).
const idOrder = (w) => `${w.out.map((m) => m.id).join(",")}|${w.in.map((m) => m.id).join(",")}`;
const cheaper = (a, b) => b.change - a.change || a.salaryChange - b.salaryChange || cmpId(idOrder(a), idOrder(b));

function cheapestOf(tries, problems) {
  const moves = [];
  for (const t of tries) {
    if (t.move) moves.push(t.move);
    else problems.push(t.problem);
  }
  return moves.sort(cheaper)[0] ?? null;
}

/** One plain sentence for a man with no legal way in, from the rules that blocked him. */
function noWayText(name, problems, ctx) {
  const rules = new Set(problems.map((p) => p.rule));
  if (rules.size === 0) return `Every seat ${name} can take holds a locked man, so he cannot come in.`;
  if (rules.size > 1) return `No swap of one or two men gets ${name} in under the ${money(SALARY_CAP)} cap and the roster rules.`;
  const { rule, team } = problems[0];
  if (rule === "team") return `Getting ${name} in would put more than ${ctx.maxPerTeam} men from ${team} in your lineup, over your Max per team.`;
  if (rule === "games") return `Getting ${name} in would leave your lineup in one game; DraftKings needs players from at least two.`;
  if (rule === "positions") return `No swap of one or two men gives ${name} a seat his position can take.`;
  return `No swap of one or two men gets ${name} in under the ${money(SALARY_CAP)} cap.`;
}

/** {wayIn, reason} for one man: an add, else a one-for-one, else a two-for-two with another man from off the lineup (never a locked man out; an open seat is filled before a man is moved), so the panel offers the simplest move. */
function wayInFor(row, base, ctx) {
  const name = row.name;
  if (!canTake(row, ctx)) {
    const noMedian = ctx.basis === "median" && scoreOfRow(row, "median") === null;
    return { wayIn: null, reason: noMedian ? `${name} has no TwoGun median, which the Cash build ranks by, so his way in cannot be worked out.` : `${name} has no usable projection or salary for a seat, so he cannot come in.` };
  }
  const him = manOf(row, ctx);
  const free = base.filter((m) => m && !ctx.locked.has(m.id));
  const problems = [];
  const add = base.some((m) => !m) ? [tryMove("add", base, [], [him], ctx, him.id)] : [];
  const one = free.map((m) => tryMove("one-for-one", base, [m], [him], ctx, him.id));
  let wayIn = cheapestOf(add, problems) ?? cheapestOf(one, problems);
  if (!wayIn) {
    const others = ctx.rows.filter((r) => !ctx.held.has(dkOf(r)) && dkOf(r) !== dkOf(row) && canTake(r, ctx)).map((r) => manOf(r, ctx));
    const two = [];
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) for (const other of others) two.push(tryMove("two-for-two", base, [free[i], free[j]], [him, other], ctx, him.id));
    wayIn = cheapestOf(two, problems);
  }
  return wayIn ? { wayIn, reason: null } : { wayIn: null, reason: noWayText(name, problems, ctx) };
}

/** The nine places as men (null for an open seat) or {issue: why no change can be worked out}: a seat with no figure gives no way in, never a stand-in number. */
function readBase(seats, ctx) {
  const base = [];
  for (let i = 0; i < SLOT_NAMES.length; i++) {
    const seat = seats?.[i] ?? null;
    if (!seat) {
      base.push(null);
      continue;
    }
    const row = ctx.rowOf.get(String(seat.id));
    if (!row) return { issue: "A man in your lineup is no longer on this slate, so the change to your lineup cannot be worked out." };
    const man = manOf(row, ctx);
    if (man.proj === null) return { issue: `${man.name} in your lineup has no projection, so the change to your lineup's projection cannot be worked out.` };
    if (man.salary === null) return { issue: `${man.name} in your lineup has no salary, so the change to your lineup's salary cannot be worked out.` };
    if (man.value === null) return { issue: `${man.name} in your lineup has no TwoGun median, which the Cash build ranks by, so the change cannot be worked out.` }; // never counted as 0
    base.push(man);
  }
  return { base };
}

/** Per man, how many of the optimal lineups hold him; a lineup names men by player ({id}) or by id list; a man off this slate is not counted. */
function optimalCounts(optimalLineups, ctx) {
  const counts = new Map();
  for (const lineup of optimalLineups) {
    const ids = (lineup?.players ?? []).length ? lineup.players.map((p) => String(p.id)) : (lineup?.ids ?? []).map(String);
    for (const id of new Set(ids)) if (ctx.rowOf.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * The `Left out` report: {entries, unjudged}. entries: at most three men, most owned first. `rows`: the slate on screen's board rows. `seats`: the working lineup. `lockedIds`: the padlocks, not the seated men a Build also
 * holds. `excludedIds`, `avoidGames`, `maxPerTeam` ("" or null: no limit): the Cash tab's. `optimalLineups`: the engine's. `basis`: the Cash build's own ("median" while it builds on TwoGun's median, else "proj"), which ranks the ways in.
 * Each entry: {id, name, team, pos, fieldOwn, proj, salary, inOptimal, optimalTotal, wayIn, reason}. wayIn: {kind: "add" | "one-for-one" | "two-for-two", out: [man], in: [man], projChange, change (on the basis), basis, salaryChange, seats (the nine
 * places after the change)}, man being {id, name, seat, pos, proj, value, salary}; null with `reason`, one sentence, when there is no legal way or no figure to work it out by. unjudged: the names of the optimal men off the lineup with no published
 * ownership (missing is never read as 0). `twoGun`: the board is in TwoGun mode. A second slate reads the main slate's published ownership, as the page's own note says. Never changes its input.
 */
export function leftOutReport({ rows, seats, lockedIds, excludedIds, avoidGames, optimalLineups, maxPerTeam, basis = "proj", twoGun = false }) {
  if (!Array.isArray(optimalLineups) || optimalLineups.length === 0) return { entries: [], unjudged: [] }; // no optimal lineups: an empty list, never a guess
  const ctx = contextOf({ rows, lockedIds, excludedIds, avoidGames, maxPerTeam, basis, twoGun });
  ctx.held = readHeld(seats, lockedIds, ctx);
  const counts = optimalCounts(optimalLineups, ctx);
  const byMan = new Map(); // one entry per DraftKings player: twin rows are one man, and the first by id speaks for him
  for (const row of ctx.rows) {
    if (ctx.held.has(dkOf(row)) || !counts.has(String(row.id)) || ctx.excluded.has(String(row.id)) || barred(row, ctx)) continue;
    const had = byMan.get(dkOf(row));
    if (had) had.inOptimal += counts.get(String(row.id));
    else byMan.set(dkOf(row), { id: String(row.id), name: row.name, team: row.team, pos: row.pos, fieldOwn: num(row.own), proj: num(row.proj), salary: num(row.salary), inOptimal: counts.get(String(row.id)) });
  }
  const candidates = [...byMan.values()];
  const heavy = (e) => e.fieldOwn !== null && e.fieldOwn >= HEAVILY_OWNED_PCT;
  const unjudged = candidates.filter((e) => e.fieldOwn === null).map((e) => e.name);
  const listed = candidates.filter(heavy).sort((a, b) => b.fieldOwn - a.fieldOwn || b.inOptimal - a.inOptimal || cmpId(a.id, b.id)).slice(0, MAX_LISTED);
  if (listed.length === 0) return { entries: [], unjudged };
  const { base, issue } = readBase(seats, ctx);
  if (!issue) ctx.pool = buildFillPool(ctx);
  const entries = listed.map((e) => ({ ...e, optimalTotal: optimalLineups.length, ...(issue ? { wayIn: null, reason: issue } : wayInFor(ctx.rowOf.get(e.id), base, ctx)) }));
  return { entries, unjudged };
}

/** The report's entries alone (leftOutReport). */
export function leftOut(args) {
  return leftOutReport(args).entries;
}

/** The cheapest legal way in for the man `id`, written plainly: "Swap out Jakobi Meyers (WR): −1.2 proj, $400 left", the change on the build's basis. Pure. */
export function wayInText(wayIn, left, id) {
  const MINUS = "−";
  const him = wayIn.in.find((m) => String(m.id) === String(id)) ?? wayIn.in[0];
  const word = wayIn.basis === "median" ? "median" : "proj";
  const abs = dec1(Math.abs(wayIn.change ?? wayIn.projChange));
  const change = abs === "0.0" ? `0.0 ${word}` : `${(wayIn.change ?? wayIn.projChange) < 0 ? MINUS : "+"}${abs} ${word}`;
  const tail = `${change}, ${left === null ? "salary left unknown" : `${money(left)} left`}`;
  const seatOf = (m) => `${m.name} (${m.seat})`;
  if (wayIn.kind === "add") return `Add him at ${him?.seat ?? "FLEX"}: ${tail}`;
  if (wayIn.kind === "one-for-one") return `Swap out ${seatOf(wayIn.out[0])}: ${tail}`;
  const second = wayIn.in.find((m) => m !== him);
  return `Swap out ${wayIn.out.map(seatOf).join(" and ")}${second ? `, ${seatOf(second)} in too` : ""}: ${tail}`;
}

/** The field sentence: his published ownership. On a second slate the figure is the main slate's (D29, D57), so it says so and never speaks of that slate's field. Pure. */
export function fieldText(e, secondSlate = false) {
  return secondSlate ? `${pct1(e.fieldOwn)} main-slate ownership; you do not have him` : `${pct1(e.fieldOwn)} of the field has him; you do not`;
}

/** Salary left once `seats` (nine places) are the lineup; null when a seated man has no salary on these rows. Pure. */
export function salaryLeftOf(rows, seats) {
  const rowOf = new Map((rows ?? []).map((r) => [String(r.id), r]));
  let used = 0;
  for (const seat of seats ?? []) {
    if (!seat) continue;
    const price = num(rowOf.get(String(seat.id))?.salary);
    if (price === null) return null;
    used += price;
  }
  return SALARY_CAP - used;
}
