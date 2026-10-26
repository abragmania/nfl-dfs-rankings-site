// The Showdown Optimizer's filter bar (Adam 2026-10-26 3:22 PM, the retired Rankings tab's bar on the Optimizer tab; 3:26 PM: Min FLEX
// salary first, then Max, as classic's salary range): team chips, position chips, the FLEX salary range, Min FLEX pts (Adam kept it
// 2026-10-14), Show all players, the count and Clear filters. It writes the pool's filters (pool.js poolState); view.js draws it above
// #sd-lineup-mount (sticky at the window's top, static on a phone) so a redraw of the Optimizer never replaces a box Adam is typing in.
// Markup and wiring only: the caller (view.js) passes the typed boxes' pause (classic's 150 ms one), the bar's own redraw and the pool's.
import { escapeHtml } from "../format.js";
import { showAllToggleHtml, wireShowAllButtons } from "../filterbar.js";
import { poolState, resetPoolFilters } from "./pool.js";

// Position chips, same six positions the showdown board actually carries (server/showdown/board.js rows:
// QB/RB/WR/TE/K/DST — no FLEX chip here, unlike the classic filter bar, since a showdown pool has no FLEX
// position of its own to combine RB/WR/TE into). Colours match the sd-pos-<pos> pill classes (style.css).
export const SD_POSITION_CHIPS = ["All", "QB", "RB", "WR", "TE", "K", "DST"];

/** The bar's markup for the filters `f` (poolState.filters), the game's two teams and the Show all players state. Pure. The two
 *  wrappers do nothing on a wide window (display: contents); under 600px each is one sideways-scrolling line (style.css). */
export function filterBarHtml(f, game, showAll) {
  const g = game ?? {};
  const num = (v) => (v == null ? "" : escapeHtml(String(v)));
  const posChipsHtml = SD_POSITION_CHIPS.map(
    (pos) => `<button type="button" class="chip pos-chip sd-pos-chip${pos === f.pos ? " active" : ""}" data-pos-filter="${pos}" data-pos="${pos}">${pos}</button>`
  ).join("");
  return `
    <div class="filter-row">
      <div class="sd-filter-chips">
        <div class="chip-group">
          <button type="button" class="chip pos-chip${f.team === "both" ? " active" : ""}" data-team-filter="both">Both</button>
          <button type="button" class="chip pos-chip${f.team === "away" ? " active" : ""}" data-team-filter="away">${escapeHtml(g.away ?? "Away")}</button>
          <button type="button" class="chip pos-chip${f.team === "home" ? " active" : ""}" data-team-filter="home">${escapeHtml(g.home ?? "Home")}</button>
        </div>
        <div class="chip-group" id="sd-pos-chips">${posChipsHtml}</div>
      </div>
      <div class="sd-filter-inputs">
        <div class="filter-salary">
          <label>FLEX salary <input id="sd-min-salary" type="number" step="100" placeholder="min" aria-label="Min FLEX salary" value="${num(f.minSalary)}" /></label>
          <span>-</span>
          <label><input id="sd-max-salary" type="number" step="100" placeholder="max" aria-label="Max FLEX salary" value="${num(f.maxSalary)}" /></label>
          <span id="sd-salary-note" class="sd-filter-note" role="status" hidden>Min is above Max</span>
        </div>
        <div class="filter-salary">
          <label>Min FLEX pts <input id="sd-min-proj" type="number" step="1" placeholder="any" value="${num(f.minProj)}" /></label>
        </div>
      </div>
      ${showAllToggleHtml(showAll, `data-action="show-all"`)}
      <span id="sd-filter-count" class="filter-count"></span>
      <button type="button" id="sd-clear-filters-btn" class="link-btn">Clear filters</button>
    </div>`;
}

/**
 * Wires the drawn bar. A chip click sets its filter, redraws the bar (its active chip) and the pool; a typed box goes through the pause
 * (`deps.typed`: one waiting change per box, the last value wins), which writes the filters and redraws the pool, never the bar, so the
 * box keeps its caret; Clear filters cancels anything waiting, resets every filter, turns Show all players off (`deps.clearShowAll`) and
 * redraws both. deps = { typed, rebuild(), repaint(), clearShowAll() }.
 */
export function wireFilterBar(bar, deps) {
  wireShowAllButtons(bar);
  bar.querySelectorAll("[data-team-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      poolState.filters.team = btn.dataset.teamFilter;
      deps.rebuild();
      deps.repaint();
    });
  });
  bar.querySelectorAll("[data-pos-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      poolState.filters.pos = btn.dataset.posFilter;
      deps.rebuild();
      deps.repaint();
    });
  });
  // Same as classic's "Clear filters": a deliberate click, so a full rebuild of the bar is fine; a value typed just before it never comes back.
  bar.querySelector("#sd-clear-filters-btn")?.addEventListener("click", () => {
    deps.typed.cancelAll();
    resetPoolFilters();
    deps.clearShowAll();
    deps.rebuild();
    deps.repaint();
  });
  const minSalary = bar.querySelector("#sd-min-salary");
  const maxSalary = bar.querySelector("#sd-max-salary");
  const note = bar.querySelector("#sd-salary-note");
  // 🔵 R3: a Min above the Max says so in the bar and is not applied; the pool keeps the last valid range instead of emptying.
  const salary = () => {
    const range = { minSalary: boxValue(minSalary), maxSalary: boxValue(maxSalary) };
    const crossed = salaryCrossed(range);
    if (note) note.hidden = !crossed;
    if (!crossed) deps.typed.schedule("salary", range);
  };
  minSalary?.addEventListener("input", salary);
  maxSalary?.addEventListener("input", salary);
  const minProj = bar.querySelector("#sd-min-proj");
  minProj?.addEventListener("input", () => deps.typed.schedule("minProj", { minProj: boxValue(minProj) }));
}

/** A typed box's number: null when empty or not a finite number (🔵 R3: "1e999" or a stray "-" is no filter, never Infinity or NaN). */
export function boxValue(el) {
  const text = String(el?.value ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** True when both ends of the FLEX salary range are set and the Min is above the Max. */
export function salaryCrossed({ minSalary, maxSalary }) {
  return minSalary != null && maxSalary != null && minSalary > maxSalary;
}
