// The one totals block under a lineup's last slot (optimizer standard A11, A19; 2026-11-03): the builder, every result card and every saved card
// read `Salary used`, `Salary left`, `Proj` and `Own` through these two functions, from the first man in. An empty lineup reads `$0`, the
// full cap and dashes; a lineup that is not loaded reads dashes with the reason. A missing figure is a dash with its reason, never zero.
// Pure: tests/optimizer-round2.test.mjs.
import { escapeHtml, money, dec1, pct1 } from "./format.js";
import { shownTotal } from "./totals.js";

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * The four figures for `men` ({salary, proj, own} of each man placed, a missing figure null or absent). `notLoaded`: a sentence when the lineup
 * itself has not been read (no board yet); then every figure is unknown. Returns { used, left, proj, own, over, fillPct, reasons }, each
 * figure a number or null, `reasons` the sentence for each null one.
 */
export function lineupTotals(men, { cap = 50000, notLoaded = null } = {}) {
  if (notLoaded) {
    return { used: null, left: null, proj: null, own: null, over: false, fillPct: 0, reasons: { used: notLoaded, left: notLoaded, proj: notLoaded, own: notLoaded } };
  }
  const list = men ?? [];
  const all = (f) => list.length > 0 && list.every((m) => finite(m?.[f]));
  const sumSalary = all("salary") ? list.reduce((s, m) => s + m.salary, 0) : null;
  const noMan = "no man in this lineup yet";
  const noSalary = "a man in this lineup has no salary or is no longer on this slate";
  const used = list.length === 0 ? 0 : sumSalary;
  const left = used === null ? null : cap - used;
  const own = all("own") ? list.reduce((s, m) => s + m.own, 0) : null;
  const proj = all("proj") ? shownTotal(list.map((m) => m.proj)) : null;
  return {
    used,
    left,
    proj,
    own,
    over: left !== null && left < 0,
    fillPct: used === null ? 0 : Math.max(0, Math.min(100, (used / cap) * 100)),
    reasons: {
      used: noSalary,
      left: noSalary,
      proj: list.length === 0 ? noMan : "a man in this lineup has no projection or is no longer on this slate",
      own: list.length === 0 ? noMan : "a man in this lineup has no published ownership or is no longer on this slate",
    },
  };
}

/** The block's markup: the cap bar, then the four figures. `extra` (html, optional) follows on a line of its own (a card's meter figures), then `line` (a GPP lineup's three own-vs-field readings, lineup-contrarian.js). */
export function lineupTotalsHtml(t, { cap = 50000, extra = "", line = "", bar = true, attrs = "" } = {}) {
  const fig = (label, value, reason, cls = "") =>
    `<span class="lt-fig${cls}"><i>${label}</i> ${value === null ? `<b class="lt-dash" title="${escapeHtml(reason)}">—</b>` : `<b>${escapeHtml(value)}</b>`}</span>`;
  const left = t.left === null ? null : t.over ? `−${money(-t.left)}` : money(t.left);
  const barHtml = bar
    ? `<div class="salary-bar-track" title="${money(cap)} cap"><div class="salary-bar-fill${t.over ? " over" : ""}" style="width:${t.fillPct}%"></div></div>`
    : "";
  return `<div class="lt" data-lineup-totals${attrs}>${barHtml}<div class="lt-figs">`
    + fig("Salary used", t.used === null ? null : money(t.used), t.reasons.used)
    + fig("Salary left", left, t.reasons.left, t.over ? " lt-over" : "")
    + fig("Proj", t.proj === null ? null : dec1(t.proj), t.reasons.proj)
    + fig("Own", t.own === null ? null : pct1(t.own), t.reasons.own)
    + `</div>${extra ? `<div class="lt-extra">${extra}</div>` : ""}${line ? `<div class="lt-read">${line}</div>` : ""}</div>`;
}
