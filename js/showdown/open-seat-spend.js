// What each open seat of the Showdown working lineup can still spend (parity row "Working lineup panel larger and clearer"): the salary left minus the least the OTHER open seats need
// at the cheapest prices on the board. Pure and DOM-free apart from the two small markup helpers; the men who count as fill are seat-picker.js fillerRules, the same men the pool's
// greying counts (a man excluded for that seat, with no price or no projection for it, or already seated is not fill). The Captain seat's figure is at its Captain price (1.5x),
// every open FLEX seat has the same figure. Counted on salary and seats only, like the greying (A18): the one-man-from-each-team rule is not in it.
// No invented number: a placed man the board lacks or has no price for, or a board that cannot fill the other open seats, gives null for the seat, and nothing is drawn. A figure below the
// cheapest man who could take the seat says "Nothing fits" instead of a spend nobody can use.
import { escapeHtml, money } from "../format.js";
import { fillerRules } from "./seat-picker.js";

/**
 * The least the seats in `rest` ({cpt: boolean, flex: count}) cost, filled from `men` ({id, salary, cptSalary}; a null price means he cannot take that seat), each man once;
 * null when the men cannot fill them. Exact: every Captain candidate is tried against the cheapest FLEX men left. lineup-fit.js showdownFillCost is the greying's cheaper version and
 * is not used here because it fills a thin pool with what it has and counts a Captain candidate who leaves too few FLEX men; the two agree wherever the pool is not thin
 * (tests/showdown-open-seat-spend.test.mjs pins that on frozen boards).
 */
export function cheapestFill(rest, men) {
  const flexMen = men.filter((m) => Number.isFinite(m.salary)).sort((a, b) => a.salary - b.salary);
  const flexSum = (n, exceptId = null) => {
    const pool = exceptId === null ? flexMen : flexMen.filter((m) => String(m.id) !== exceptId);
    return pool.length < n ? null : pool.slice(0, n).reduce((s, m) => s + m.salary, 0);
  };
  if (!rest.cpt) return rest.flex === 0 ? 0 : flexSum(rest.flex);
  let best = null;
  for (const c of men) {
    if (!Number.isFinite(c.cptSalary)) continue;
    const others = flexSum(rest.flex, String(c.id));
    if (others === null) continue;
    if (best === null || c.cptSalary + others < best) best = c.cptSalary + others;
  }
  return best;
}

/**
 * {left, cpt, flex, cptMin, flexMin}: `left` the salary left (null when unknown); `cpt` and `flex` the most the Captain seat and each FLEX seat can spend, each null when that seat is not open or the figure
 * is unknown; `cptMin` and `flexMin` the cheapest price a man could take that seat at (null when nobody can). A figure below its Min, or a negative one, means no man can be added there.
 * `board`: the served board; `cap`: the salary cap; `placed` = {cpt: {id}|null, flex: [{id}|null x5]}; `excluded(row, tab)`: the Optimizer's excludes (false off the live app).
 */
export function openSeatSpend({ board, cap, placed, excluded = () => false }) {
  const none = { left: null, cpt: null, flex: null, cptMin: null, flexMin: null };
  const rows = board?.rows ?? [];
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const seatedIds = [...(placed.cpt ? [String(placed.cpt.id)] : []), ...(placed.flex ?? []).filter(Boolean).map((s) => String(s.id))];
  let used = 0;
  if (placed.cpt) {
    const price = byId.get(String(placed.cpt.id))?.cptSalary;
    if (!Number.isFinite(price)) return none;
    used += price;
  }
  for (const s of (placed.flex ?? []).filter(Boolean)) {
    const price = byId.get(String(s.id))?.salary;
    if (!Number.isFinite(price)) return none;
    used += price;
  }
  const left = cap - used;
  const openCpt = !placed.cpt;
  const openFlex = (placed.flex ?? []).filter((s) => !s).length;
  const seated = new Set(seatedIds);
  const { fillable, asFiller } = fillerRules(excluded);
  const men = rows.filter((r) => !seated.has(String(r.id)) && fillable(r)).map(asFiller);
  const spend = (rest) => {
    const fill = cheapestFill(rest, men);
    return fill === null ? null : left - fill;
  };
  const cheapest = (field) => men.reduce((low, m) => (Number.isFinite(m[field]) && (low === null || m[field] < low) ? m[field] : low), null);
  return {
    left,
    cpt: openCpt ? spend({ cpt: false, flex: openFlex }) : null,
    flex: openFlex > 0 ? spend({ cpt: openCpt, flex: openFlex - 1 }) : null,
    cptMin: openCpt ? cheapest("cptSalary") : null,
    flexMin: openFlex > 0 ? cheapest("salary") : null,
  };
}

/** The words on an open seat: `Up to $4,200`; "Nothing fits" when the figure is negative or below the cheapest man who could take the seat (`min`: a number, or null when nobody can; left out, only a negative
 *  figure says it); "" when there is no figure. */
export function openSpendText(amount, min = undefined) {
  if (!Number.isFinite(amount)) return "";
  const tooLittle = amount < 0 || (min === null && amount >= 0) || (Number.isFinite(min) && amount < min);
  return tooLittle ? "Nothing fits" : `Up to ${money(amount)}`;
}

const SPEND_TITLE = "The most this seat can cost: the salary left minus the least the other open seats need at the cheapest prices on the board (excluded and seated men left out). The Captain seat's figure is at the Captain price.";

/** The figure's element inside an empty seat (`seat` "cpt" or "flex"); always drawn so a repaint finds it, empty when there is no figure. `min`: the cheapest man for the seat (openSeatSpend's cptMin or flexMin). */
export function openSpendHtml(amount, seat, min = undefined) {
  const text = openSpendText(amount, min);
  return `<span class="sd-open-spend${text ? "" : " is-empty"}" data-open-spend="${seat}" title="${text ? escapeHtml(SPEND_TITLE) : ""}">${escapeHtml(text)}</span>`;
}

/** Puts new figures into the open seats already on screen (the pool's exclude buttons change them without a redraw). `spend`: openSeatSpend's answer. */
export function repaintOpenSpend(container, spend) {
  container?.querySelectorAll?.("[data-open-spend]").forEach((el) => {
    const seat = el.dataset.openSpend;
    const text = openSpendText(spend?.[seat], spend?.[`${seat}Min`]);
    el.textContent = text;
    el.classList.toggle("is-empty", !text);
    el.title = text ? SPEND_TITLE : "";
  });
}
