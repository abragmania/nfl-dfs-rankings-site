// The Showdown Optimizer's filter bar (Adam 2026-10-26 3:22 PM, the retired Rankings tab's bar on the Optimizer tab; 3:26 PM: Min salary first, then Max, as classic's salary range):
// team chips, position chips, `Search players` (B1), the salary range and `Min Proj` (Adam kept it 2026-10-14; since round 4, C24, both compare the figures of the list on
// screen: the Captain list's price and Captain projection), `Starred only` (B2), the Showdown's own `Show all players` (C24), the count and Clear filters. It writes the pool's filters
// (pool.js poolState); view.js draws it above #sd-lineup-mount (sticky at the window's top, static on a phone) so a redraw of the Optimizer never replaces a box Adam is typing in.
// Markup and wiring only: the caller (view.js) passes the typed boxes' pause (classic's 150 ms one), the bar's own redraw and the pool's.
import { escapeHtml } from "../format.js";
import { showAllToggleHtml, wireShowAllButtons, favoritesChipLabel, RESET_ALL_QUESTION, showButtonError } from "../filterbar.js";
import { askInline, anchorHtml } from "../confirm-inline.js";
import { poolState, resetPoolFilters } from "./pool.js";
import { sdShowAllFlag } from "./show-all.js";

// Position chips, same six positions the showdown board actually carries (server/showdown/board.js rows:
// QB/RB/WR/TE/K/DST — no FLEX chip here, unlike the classic filter bar, since a showdown pool has no FLEX
// position of its own to combine RB/WR/TE into). Colours match the sd-pos-<pos> pill classes (style.css).
export const SD_POSITION_CHIPS = ["All", "QB", "RB", "WR", "TE", "K", "DST"];

/** The bar's markup for the filters `f` (poolState.filters), the game's two teams and the Show all players state. `reset` (A6, round 3): {enabled} draws the
 *  one Reset all overrides button, off when no man has a typed number or a bump; null draws none (the public site cannot write overrides, D71, and sample mode
 *  refuses every write). `starred`: how many men on the board are starred (the chip's number, as classic's, D53). Pure. The two wrappers do nothing on a wide window
 *  (display: contents); under 600px each is one sideways-scrolling line (style.css). */
export function filterBarHtml(f, game, showAll, reset = null, starred = null) {
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
        <div class="filter-search">
          <input id="sd-search" type="search" placeholder="Search players" aria-label="Search players" value="${num(f.search)}" />
        </div>
        <div class="filter-salary">
          <label>Salary <input id="sd-min-salary" type="number" step="100" placeholder="min" aria-label="Min salary" value="${num(f.minSalary)}" /></label>
          <span>-</span>
          <label><input id="sd-max-salary" type="number" step="100" placeholder="max" aria-label="Max salary" value="${num(f.maxSalary)}" /></label>
          <span id="sd-salary-note" class="sd-filter-note" role="status" hidden>Min is above Max</span>
        </div>
        <div class="filter-salary">
          <label>Min Proj <input id="sd-min-proj" type="number" step="1" placeholder="any" aria-label="Min Proj" value="${num(f.minProj)}" /></label>
        </div>
      </div>
      <button type="button" id="sd-starred-toggle" class="chip toggle-chip${f.starredOnly ? " active" : ""}" aria-pressed="${Boolean(f.starredOnly)}">${favoritesChipLabel(starred)}</button>
      ${showAllToggleHtml(showAll, `data-action="show-all"`)}
      <span id="sd-filter-count" class="filter-count"></span>
      <button type="button" id="sd-clear-filters-btn" class="link-btn">Clear filters</button>
      ${reset ? anchorHtml(`<button type="button" id="sd-reset-overrides-btn" class="reset-btn"${reset.enabled ? "" : " disabled"}>Reset all overrides</button>`) : ""}
    </div>`;
}

/**
 * Wires the drawn bar. A chip click sets its filter, redraws the bar (its active chip) and the pool; a typed box (search, salary, Min Proj) goes through the pause
 * (`deps.typed`: one waiting change per box, the last value wins), which writes the filters and redraws the pool, never the bar, so the
 * box keeps its caret; Clear filters cancels anything waiting, resets every filter, turns Show all players off (`deps.clearShowAll`) and
 * redraws both. deps = { typed, rebuild(), repaint(), clearShowAll() }.
 */
export function wireFilterBar(bar, deps) {
  wireShowAllButtons(bar, sdShowAllFlag); // the Showdown's own switch (C24); it redraws the screen through show-all.js's listener (view.js)
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
  // Starred only (B2): a deliberate click, so the bar's chip is redrawn with the pool.
  bar.querySelector("#sd-starred-toggle")?.addEventListener("click", () => {
    poolState.filters.starredOnly = !poolState.filters.starredOnly;
    deps.rebuild();
    deps.repaint();
  });
  // Same as classic's "Clear filters": a deliberate click, so a full rebuild of the bar is fine; a value typed just before it never comes back.
  bar.querySelector("#sd-clear-filters-btn")?.addEventListener("click", () => {
    deps.typed.cancelAll();
    resetPoolFilters();
    deps.clearShowAll();
    deps.rebuild();
    deps.repaint();
  });
  // A6 (round 3): the same question as classic's Reset all overrides, asked beside the button; Yes clears this game's typed numbers and bumps.
  const resetBtn = bar.querySelector("#sd-reset-overrides-btn");
  resetBtn?.addEventListener("click", () => {
    if (resetBtn.disabled) return;
    askInline(resetBtn, RESET_ALL_QUESTION, async () => {
      const taken = await deps.onResetOverrides?.();
      if (!taken) showButtonError(resetBtn, "The reset was not saved. The message above says why.");
    });
  });
  const search = bar.querySelector("#sd-search");
  search?.addEventListener("input", () => deps.typed.schedule("search", { search: String(search.value ?? "") })); // B1: filters live; the pause keeps the caret
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

/** The box of the bar that has the keyboard, so a redraw of the bar (a board answer, a chip click) can give it back: {id, start, end}, or null when none of the bar's boxes has focus
 *  (round 4, item 9). `doc` is the page (a stand-in in tests). */
export function takeBarFocus(bar, doc = typeof document === "undefined" ? null : document) {
  const el = doc?.activeElement;
  if (!el || !el.id || typeof bar?.contains !== "function" || !bar.contains(el) || !/^(INPUT|SELECT|TEXTAREA)$/i.test(String(el.tagName ?? ""))) return null;
  return { id: el.id, start: el.selectionStart ?? null, end: el.selectionEnd ?? null };
}

/** Puts the keyboard back in the redrawn bar's box with the same caret or selection (what the visitor typed is already in the box: the pause had flushed it before the redraw). */
export function restoreBarFocus(bar, carry) {
  if (!carry) return;
  const el = bar?.querySelector?.(`#${carry.id}`);
  if (!el) return;
  el.focus?.({ preventScroll: true });
  // A number box has no selection to restore (setSelectionRange throws on it), a text or search box does.
  if (carry.start !== null && typeof el.setSelectionRange === "function" && !/^(number|email)$/i.test(String(el.type ?? ""))) el.setSelectionRange(carry.start, carry.end ?? carry.start);
}

/** A typed box's number: null when empty or not a finite number (🔵 R3: "1e999" or a stray "-" is no filter, never Infinity or NaN). */
export function boxValue(el) {
  const text = String(el?.value ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** True when both ends of the salary range are set and the Min is above the Max. */
export function salaryCrossed({ minSalary, maxSalary }) {
  return minSalary != null && maxSalary != null && minSalary > maxSalary;
}
