// The NFL adapter of the copied NBA look (PROJECT.md Part 4 item 5, NBA commit a39b37e): the look's drawing code takes only these neutral shapes, filled from NFL's own board rows and lineup figures.
// Nothing here computes a figure of its own: a number the row or the lineup carries is passed through, a number it does not carry is null, and a null figure is drawn as a dash with its reason (router Data rules, G5),
// never as 0. Pure: no DOM (tests/look-adapter.test.mjs).
import { money, dec1, pct1 } from "./format.js";
import { shownTotal } from "./totals.js";
import { opponentLabel, rowIsOut } from "./table.js";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const NO_FIGURE = "—"; // a figure no source published: the dash, never 0

/** One man as the look's rows draw him. `figures`: {id, name, pos, team, salary, proj, own} (a board row, a batch's player or a saved snapshot); `row`: his live board row when there is one (his matchup, status). */
export function lookMan(figures, row = null) {
  const f = figures ?? {};
  const live = row ?? f;
  return {
    id: f.id != null ? String(f.id) : null,
    name: String(f.name ?? ""),
    pos: f.pos ?? null,
    team: f.team ?? null,
    matchup: opponentLabel(live) || null, // D43: v KC, @MIA; a man with no opponent on the board has no matchup, not a guess
    salary: num(f.salary),
    proj: num(f.proj),
    own: num(f.own),
    out: rowIsOut(live),
    tagRow: live,
  };
}

/** The three figures a row shows, as text; a missing figure is the dash. `moneyText`, `projText` and `ownText` have one meaning everywhere in the look. */
export const moneyText = (v) => (num(v) === null ? NO_FIGURE : money(v));
export const projText = (v) => (num(v) === null ? NO_FIGURE : dec1(v));
export const ownText = (v) => (num(v) === null ? NO_FIGURE : pct1(v));

/** The reason a dash shows, by figure, for its hover (the row builder uses them). */
export const MISSING_WHY = Object.freeze({
  salary: "no salary in the DraftKings file",
  proj: "no projection",
  own: "no published ownership",
});

/** The totals line's figures for a list of men's {salary, proj, own}, from the rows as shown (A11): {used, left, proj, own, value, perOpen}, each null when any man lacks the figure or there is nobody yet (`value`, the projection per $1,000 of salary used, and `perOpen`, salary left over the open seats, are null in those cases too). `cap`: DraftKings' salary cap. Pure. */
export function lookTotals(men, { cap = 50000, seats = 9 } = {}) {
  const list = (men ?? []).filter(Boolean);
  const every = (key) => list.length > 0 && list.every((m) => num(m?.[key]) !== null);
  const used = list.length === 0 ? 0 : every("salary") ? list.reduce((t, m) => t + m.salary, 0) : null;
  const left = used === null ? null : cap - used;
  const proj = every("proj") ? shownTotal(list.map((m) => m.proj)) : null;
  const own = every("own") ? list.reduce((t, m) => t + m.own, 0) : null;
  const value = proj !== null && used ? proj / (used / 1000) : null;
  const open = seats - list.length;
  const perOpen = left !== null && left >= 0 && open > 0 ? Math.floor(left / open) : null;
  return { used, left, proj, own, value, perOpen, count: list.length, over: left !== null && left < 0, fillPct: used === null ? 0 : Math.max(0, Math.min(100, (used / cap) * 100)) };
}

/** A man's exposure against the field: his share of these lineups minus his projected ownership, or null when ownership was not published for him. Pure. */
export function lookFieldDiff(pct, own) {
  const p = num(pct);
  const o = num(own);
  return p === null || o === null ? null : p - o;
}
