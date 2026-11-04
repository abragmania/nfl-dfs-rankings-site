// Whether a man can still go into the lineup being built by hand (optimizer standard A18, round 3). Pure and browser-safe: no DOM, no state; the
// classic Optimizer (lineup-view.js) and the Showdown pool (showdown/pool.js) ask it for every row and grey the ones that cannot fit, with the
// reason on hover. It counts salary and positions only: his salary against the salary left, less the cheapest legal fill of the other open
// slots (the cheapest men on the slate who could take each of them, each man used once). It never looks at projections, ownership, injuries,
// stacks or team limits, so it can only say "no" when the cap itself rules him out; it is a hand-build aid and never stops a Build.
//
// Classic: slots QB, RB, RB, WR, WR, WR, TE, FLEX, DST (FLEX takes an RB, WR or TE). Showdown: one Captain (1.5x salary) and five FLEX,
// any man in any seat.
import { money } from "./format.js";

export const FLEX_POSITIONS = Object.freeze(["RB", "WR", "TE"]);
const CLASSIC_POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "DST"]);

// ---------------------------------------------------------------------------------------------------------------------------------
// Classic
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The men who could still fill a seat, by position, cheapest first: `men` = [{id, pos, salary}] (the slate's unplaced, unexcluded men
 * with a salary and a position the lineup uses). Built once per draw; classicFit reads it for every row.
 */
export function fillPool(men) {
  const pool = Object.fromEntries(CLASSIC_POSITIONS.map((p) => [p, []]));
  for (const m of men ?? []) {
    if (!pool[m?.pos] || !Number.isFinite(m.salary) || m.salary < 0) continue;
    pool[m.pos].push({ id: String(m.id), salary: m.salary });
  }
  for (const p of CLASSIC_POSITIONS) pool[p].sort((a, b) => a.salary - b.salary || (a.id < b.id ? -1 : 1));
  const index = new Map(); // id -> his place in his position's list, so a candidate can be skipped when he is the one asking
  for (const p of CLASSIC_POSITIONS) pool[p].forEach((m, i) => index.set(m.id, i));
  return { ...pool, index };
}

/** The `n`th (from 0) entry of `list` leaving out the entry at `skip` (-1: leave none out); undefined when the list has no such entry. */
function nthSkipping(list, n, skip) {
  return list[skip >= 0 && n >= skip ? n + 1 : n];
}

/**
 * The cheapest total salary that fills `openSlots` (slot names, e.g. ["RB", "WR", "FLEX", "DST"]) from `pool` (fillPool's), each man once,
 * leaving out the man `skipId` (the one asking). A position's own slots take that position's cheapest men; a FLEX seat then takes the
 * cheapest man left of RB, WR and TE. Exact: the cheapest men per position are what any cheapest fill uses, and FLEX is the cheapest of what is left.
 * A seat the pool has nobody left for adds nothing (the cost is of the seats that can be filled): the check says "no" only when the cap itself rules a
 * man out, never because a thin slate or a test pool lacks someone, so a greyed row is never wrong.
 */
export function classicFillCost(openSlots, pool, skipId = null) {
  const need = Object.fromEntries(CLASSIC_POSITIONS.map((p) => [p, 0]));
  let flex = 0;
  for (const s of openSlots) {
    if (s === "FLEX") flex++;
    else if (s in need) need[s]++;
  }
  const at = skipId == null ? null : pool.index.get(String(skipId));
  let total = 0;
  const used = {};
  for (const p of CLASSIC_POSITIONS) {
    const skip = at != null && pool[p][at]?.id === String(skipId) ? at : -1;
    used[p] = 0;
    for (let i = 0; i < need[p]; i++) {
      const m = nthSkipping(pool[p], i, skip);
      if (!m) break;
      used[p]++;
      total += m.salary;
    }
  }
  for (let k = 0; k < flex; k++) {
    let best = null;
    for (const p of FLEX_POSITIONS) {
      const skip = at != null && pool[p][at]?.id === String(skipId) ? at : -1;
      const m = nthSkipping(pool[p], used[p], skip);
      if (m && (best === null || m.salary < best.m.salary)) best = { p, m };
    }
    if (!best) break;
    used[best.p]++;
    total += best.m.salary;
  }
  return total;
}

/** The open seats a man of position `pos` could take, in the order tried: his own position's seat, then FLEX for an RB, WR or TE. */
function seatsFor(pos, openSlots) {
  const seats = [];
  if (openSlots.includes(pos)) seats.push(pos);
  if (FLEX_POSITIONS.includes(pos) && openSlots.includes("FLEX")) seats.push("FLEX");
  return seats;
}

/** `slots` without one seat named `name`. */
function without(slots, name) {
  const i = slots.indexOf(name);
  return i < 0 ? slots : [...slots.slice(0, i), ...slots.slice(i + 1)];
}

/**
 * Whether `man` ({id, pos, salary}) fits: some open seat can take him and the other open seats can still be filled for what is left.
 * `salaryLeft`: the cap less the salary already used (may be negative); `openSlots`: the names of the empty seats; `pool`: fillPool's.
 * Returns {fits: true} or {fits: false, why: "noSeat" | "salary", ...}: "salary" carries `left` (the salary left), `fill` (the cheapest
 * fill of the other seats at his best seat) and `others` (how many other seats). Pure.
 */
export function classicFit({ man, salaryLeft, openSlots, pool }) {
  const seats = seatsFor(man.pos, openSlots);
  if (!seats.length) return { fits: false, why: "noSeat", full: openSlots.length === 0 };
  let best = null;
  for (const seat of seats) {
    const rest = without(openSlots, seat);
    const cost = classicFillCost(rest, pool, man.id);
    if (best === null || cost < best.cost) best = { cost, others: rest.length };
  }
  if (man.salary + best.cost > salaryLeft) return { fits: false, why: "salary", left: salaryLeft, fill: best.cost, others: best.others };
  return { fits: true };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Showdown
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Showdown's version: `seat` is the list the row is on, "cpt" (the Captain list, his Captain salary) or "flex"; `open` = {cpt: boolean, flex: count};
 * `man` = {id, salary, cptSalary}; `others` = the men who could fill the other seats ({id, salary, cptSalary}, never the man himself or anyone
 * seated); `salaryLeft` as above. Any man takes any seat. Same answer shape as classicFit; "noSeat" when the list's seat is taken.
 */
export function showdownFit({ man, seat, salaryLeft, open, others }) {
  const mine = seat === "cpt" ? man.cptSalary : man.salary;
  if (!Number.isFinite(mine)) return { fits: false, why: "noSalary" };
  if (seat === "cpt" ? !open.cpt : open.flex < 1) return { fits: false, why: "noSeat", seat };
  const rest = { cpt: seat === "cpt" ? false : open.cpt, flex: seat === "flex" ? open.flex - 1 : open.flex };
  const cost = showdownFillCost(rest, others.filter((o) => String(o.id) !== String(man.id)));
  if (mine + cost > salaryLeft) return { fits: false, why: "salary", left: salaryLeft, fill: cost, others: rest.flex + (rest.cpt ? 1 : 0) };
  return { fits: true };
}

/**
 * The cheapest total that fills `rest` ({cpt: boolean, flex: count}) from `men` ({id, salary, cptSalary}), each man once, the Captain seat costing his Captain salary. A man
 * may have only one of the two prices (a Captain-only man has no FLEX price; a man whose FLEX projection is missing has no FLEX price here either): he can fill only the seat
 * he is priced for. The Captain is among the `flex + 1` cheapest by Captain salary (the rest of the lineup then needs the cheapest FLEX men, and one of those candidates is
 * not among them). With too few men the seats that can be filled are costed and the rest add nothing (as classicFillCost: the check never greys a man for a thin pool).
 */
export function showdownFillCost(rest, men) {
  const byFlex = men.filter((m) => Number.isFinite(m.salary)).sort((a, b) => a.salary - b.salary);
  const byCpt = men.filter((m) => Number.isFinite(m.cptSalary)).sort((a, b) => a.cptSalary - b.cptSalary);
  const seats = rest.flex + (rest.cpt ? 1 : 0);
  const people = new Set(men.filter((m) => Number.isFinite(m.salary) || Number.isFinite(m.cptSalary)).map((m) => String(m.id))).size;
  const k = Math.min(seats, people);
  if (k === 0) return 0;
  const flexSum = (n, except = null) => byFlex.filter((m) => m !== except && (except === null || String(m.id) !== String(except.id))).slice(0, n).reduce((s, m) => s + m.salary, 0);
  let best = null;
  const consider = (total) => {
    if (best === null || total < best) best = total;
  };
  if (!rest.cpt || byCpt.length === 0) consider(flexSum(Math.min(k, rest.flex))); // no Captain seat to fill, or nobody has a Captain price: the FLEX seats alone
  else for (const c of byCpt.slice(0, rest.flex + 1)) consider(c.cptSalary + flexSum(Math.min(k - 1, rest.flex), c)); // the Captain seat is filled when anyone can: a thin pool leaves a FLEX seat empty
  return best ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The hover sentence for a fit result that did not fit (classicFit's or showdownFit's), about `man` ({name, salary}). Plain words, no codes. */
export function fitReasonText(result, man) {
  if (result.fits) return "";
  if (result.why === "noSalary") return `${man.name} has no DraftKings salary for this seat, so he cannot be costed against the cap.`;
  if (result.why === "noSeat") {
    if (result.seat === "cpt") return "The Captain seat is taken. Click the Captain to take him out first.";
    if (result.seat === "flex") return "All five FLEX seats are full.";
    return result.full ? "Your lineup is full." : `No open ${man.pos} seat${FLEX_POSITIONS.includes(man.pos) ? " or FLEX seat" : ""} is left for ${man.name}.`;
  }
  const left = money(result.left);
  if (result.others === 0) return `${money(man.salary)} is more than the ${left} you have left.`;
  const others = result.others === 1 ? "the other open seat" : `the other ${plural(result.others, "open seat")}`;
  return `${money(man.salary)} is too much: you have ${left} left and the cheapest way to fill ${others} costs ${money(result.fill)}.`;
}
