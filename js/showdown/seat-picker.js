// What a click on each Showdown pool row may do while Adam hand-builds a lineup (optimizer standard A18, C19 and D3, round 3). Pure and browser-safe: the
// pool (pool.js) asks pickOf(row, tab) for every row and draws a row it answers null for greyed, the reason on hover; lineup.js applies a pick
// through placeCaptain, the one copy of the Captain rule.
//
// A man in the lineup is clickable on the list of his own seat (the click takes him out) unless that seat is locked (then he is greyed: unlock him
// first, or click his slot). A Captain is greyed on the FLEX list. A FLEX man stays clickable on the Captain list: the click swaps the two (C19), unless the
// FLEX seat he would leave is locked or the Captain's seat is locked. A locked Captain is never moved by another man's Captain click. A man who is excluded (on
// that list), is locked in the other seat, has no salary or no projection for that seat, or whose seat cannot be taken (all five FLEX full) or cannot be paid
// for (his salary against the salary left, less the cheapest legal fill of the other open seats, the Captain's 1.5x counted; lineup-fit.js showdownFit) is
// greyed too. The fill leaves out the men the pool greys for a missing figure and the men excluded (a Captain exclude takes only the Captain seat). It
// decides clicks only; a Build never reads it.
import { showdownFit, fitReasonText } from "../lineup-fit.js";

/**
 * Whether the man who was Captain can take a FLEX seat: he needs a FLEX salary and must not be excluded from FLEX. `row`: his board row; `excluded(row, tab)`:
 * the Optimizer's excludes. A man with no FLEX projection cannot either (his FLEX row would be greyed). Returns {ok: true} or {ok: false, why: "salary" | "projection" | "excluded"}. Pure.
 */
export function oldCaptainCanFlex(row, excluded = () => false) {
  if (!row) return { ok: true }; // a man the board does not list: nothing says he cannot move, so he keeps the old rule (a free seat)
  if (!Number.isFinite(row.salary)) return { ok: false, why: "salary" };
  if (!Number.isFinite(row.proj)) return { ok: false, why: "projection" }; // his FLEX row would be greyed for it (A18): he is not moved into a seat the pool would refuse
  if (excluded(row, "flex")) return { ok: false, why: "excluded" };
  return { ok: true };
}

/**
 * The lineup after `newId` becomes Captain (C19): the old Captain goes to the first empty FLEX seat, or, when the new Captain was in FLEX, takes the seat he
 * leaves (a swap); with no FLEX seat free the old Captain is out, and the caller says `FLEX is full; <name> was removed.` An old Captain who cannot be FLEX
 * (`canFlex(oldId)` answers {ok: false, why}) is out too, whichever seat is free. Pure.
 * `cpt`: {id} or null; `flex`: the five seats ({id} or null each). Returns {cpt, flex, removed: the old Captain's id when he had no seat to go to, else null,
 * removedWhy: "full" | "salary" | "excluded" | null}.
 */
export function placeCaptain(cpt, flex, newId, { canFlex = () => ({ ok: true }) } = {}) {
  const id = String(newId);
  const next = flex.map((s) => (s ? { ...s } : null));
  const old = cpt && String(cpt.id) !== id ? String(cpt.id) : null;
  const was = next.findIndex((s) => s && String(s.id) === id);
  let removed = null;
  let removedWhy = null;
  const can = old ? canFlex(old) : { ok: true };
  if (was >= 0) {
    if (old && can.ok) next[was] = { id: old }; // a FLEX man made Captain: the old Captain takes his seat (a swap)
    else {
      next[was] = null;
      if (old) {
        removed = old;
        removedWhy = can.why;
      }
    }
  } else if (old) {
    const free = next.findIndex((s) => !s);
    if (!can.ok) {
      removed = old;
      removedWhy = can.why;
    } else if (free >= 0) next[free] = { id: old };
    else {
      removed = old;
      removedWhy = "full";
    }
  }
  return { cpt: { id }, flex: next, removed, removedWhy };
}

/** The sentence for a Captain who lost his seat in placeCaptain: the plain reason he could not move to FLEX. `name`: the old Captain's name. */
export function removedCaptainText(name, why) {
  if (why === "salary") return `${name} has no FLEX salary, so he was removed.`;
  if (why === "excluded") return `${name} is excluded from FLEX, so he was removed.`;
  if (why === "projection") return `${name} has no FLEX projection, so he was removed.`;
  return `FLEX is full; ${name} was removed.`;
}

/** The hover of a seated, locked man (the classic Optimizer's own words). */
export const lockedInText = (name) => `${name} is locked into your lineup. Unlock him first, or click his slot.`;

const none = () => new Set();

/**
 * `board`: the served board; `cap`: the salary cap; `placed` = {cpt: {id} | null, flex: [{id} | null x5]}; `excluded(row, tab)`: whether the list's row is excluded
 * (the Optimizer's excludes; false off the live app); `locks` = {cpt: Set of person ids locked as Captain, flex: Set locked in FLEX} (empty off the live app).
 * Returns pickOf(row, tab, base) -> {action, reason}: `base` is poolPickAction's answer for the row on `tab`; the result is that action or null with the reason.
 */
export function seatPicker({ board, cap, placed, excluded = () => false, locks = { cpt: none(), flex: none() } }) {
  const rows = board?.rows ?? [];
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const cptId = placed.cpt ? String(placed.cpt.id) : null;
  const flexIds = placed.flex.filter(Boolean).map((s) => String(s.id));
  const seated = new Set([...(cptId ? [cptId] : []), ...flexIds]);
  const lockedCpt = locks.cpt ?? none();
  const lockedFlex = locks.flex ?? none();
  const salaryOf = (id, isCpt) => {
    const r = byId.get(String(id));
    return r ? (isCpt ? r.cptSalary : r.salary) ?? 0 : 0;
  };
  // The men who could fill an open seat, each for the seats he could take: a FLEX seat needs his FLEX salary and projection and no exclude from every lineup; the Captain seat
  // needs his Captain salary and projection and no Captain exclude. A man who can take only one of the two (a Captain-only man, a kicker with no FLEX projection, a man excluded
  // as Captain) stays in the fill for that seat (his other price is left out), so a man who fits is never greyed for want of a cheap Captain.
  const flexOk = (r) => Number.isFinite(r.salary) && Number.isFinite(r.proj) && !excluded(r, "flex");
  const cptOk = (r) => Number.isFinite(r.cptSalary) && Number.isFinite(r.cptProj) && !excluded(r, "cpt");
  const fillable = (r) => flexOk(r) || cptOk(r);
  const asFiller = (r) => ({ id: r.id, salary: flexOk(r) ? r.salary : null, cptSalary: cptOk(r) ? r.cptSalary : null });
  const others = rows.filter((r) => !seated.has(String(r.id)) && fillable(r)).map(asFiller);
  const grey = (reason) => ({ action: null, reason });
  return function pickOf(row, tab, base) {
    const id = String(row.id);
    const name = row.name ?? "He";
    const isCptTab = tab === "cpt";
    const mineIsCpt = cptId === id;
    const mineIsFlex = flexIds.includes(id);
    const captainSeatLocked = cptId !== null && lockedCpt.has(cptId);
    if (mineIsCpt && !isCptTab) {
      return grey(lockedCpt.has(id) ? `${name} is locked into your lineup as Captain. Unlock him first, or click his slot.` : `${name} is your Captain. Click him on the Captain list to take him out.`);
    }
    if ((mineIsCpt && isCptTab) || (mineIsFlex && !isCptTab)) {
      return (isCptTab ? lockedCpt : lockedFlex).has(id) ? grey(lockedInText(name)) : { action: base, reason: "" }; // his own seat's list: the click takes him out
    }
    if (mineIsFlex) {
      // The Captain list's row of a FLEX man: the click swaps him with the Captain (C19), unless either seat is locked.
      if (lockedFlex.has(id)) return grey(`${name} is locked into your lineup in a FLEX seat. Unlock him first, or click his slot.`);
      if (captainSeatLocked) return grey(`The Captain seat is locked on ${byId.get(cptId)?.name ?? "your Captain"}. Unlock him first.`);
    } else if (isCptTab && captainSeatLocked) {
      return grey(`The Captain seat is locked on ${byId.get(cptId)?.name ?? "your Captain"}. Unlock him first, or click his slot.`);
    }
    if (excluded(row, tab)) return grey(`${name} is excluded${isCptTab ? " as Captain" : " from every lineup"}. Take the exclude off to use him.`);
    if (!mineIsFlex && (isCptTab ? lockedFlex : lockedCpt).has(id)) {
      return grey(`${name} is locked as ${isCptTab ? "FLEX" : "Captain"}. Unlock him first, or use his ${isCptTab ? "FLEX" : "Captain"} row.`);
    }
    // A missing figure greys a row (A18): no salary for the seat, or no projection for it (never ownership). Showdown has no place to type a projection yet.
    const salary = isCptTab ? row.cptSalary : row.salary;
    if (!Number.isFinite(salary)) return grey(`${name} has no ${isCptTab ? "Captain" : "FLEX"} salary, so he cannot be costed against the cap.`);
    if (!Number.isFinite(isCptTab ? row.cptProj : row.proj)) {
      return grey(`${name} has no ${isCptTab ? "Captain" : "FLEX"} projection, so he cannot be added. Showdown has no place to type one yet.`);
    }
    // The lineup as it will stand with him in: a new Captain sends the old one to FLEX (or out), so the fit is judged on that lineup without him.
    const oldRow = cptId ? byId.get(cptId) : null;
    const base2 = isCptTab ? placeCaptain(placed.cpt, placed.flex, id, { canFlex: () => oldCaptainCanFlex(oldRow, excluded) }) : { cpt: placed.cpt, flex: placed.flex, removed: null };
    const used = (isCptTab ? 0 : cptId ? salaryOf(cptId, true) : 0) + base2.flex.filter(Boolean).reduce((s, x) => s + salaryOf(x.id, false), 0);
    const open = { cpt: isCptTab ? true : !cptId, flex: base2.flex.filter((s) => !s).length };
    const fillers = base2.removed && oldRow && fillable(oldRow) ? [...others, asFiller(oldRow)] : others; // an old Captain who was removed is free to fill a seat again
    const fit = showdownFit({ man: { id, salary: row.salary, cptSalary: row.cptSalary }, seat: isCptTab ? "cpt" : "flex", salaryLeft: cap - used, open, others: fillers });
    if (fit.fits) return { action: base, reason: "" };
    return grey(fitReasonText(fit, { ...row, name, salary }));
  };
}
