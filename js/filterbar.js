// Filter bar: position chips, team multi-select chips (one per team on the slate, in team colours),
// salary range, search, the Starred only toggle, reset-all-overrides. Rendered once per board load; after
// that only class names are toggled (never innerHTML) so the salary/search inputs never lose focus
// or cursor position while Adam is typing. The "Starred only" chip carries the starred count of the slate on screen (Adam, 2026-10-21; D53).
import { escapeHtml, logoFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { POSITION_CHIPS, CLASSIC_PROJ_FLOOR, store } from "./state.js";
import { askInline, anchorHtml } from "./confirm-inline.js";
import { rowMessageHtml } from "./row-message.js";
import { bumpStepsOf } from "./bump-control.js";

// `updateFilterSummary` is called on every filter change (app.js) to patch just the "N of M players"
// count and the removable active-game chip, without touching the rest of the bar — the position chips,
// search box and salary inputs are only fully re-rendered on a board load or an explicit "Clear
// filters", so a keystroke in the search box never loses focus.
/** The starred filter chip's text (optimizer standard D5): "Starred only (3)", "(0)" included. A missing or non-finite count gives the label
 *  with no parenthesis. Pure; the one place the chip's text is built (renderFilterBar draws it, updateFilterSummary patches it). */
export function favoritesChipLabel(count) {
  return Number.isFinite(count) ? `Starred only (${count})` : "Starred only";
}

/** Paints the Starred QBs only chip and its note (optimizer standard C12: the box lives in the filter bar). `view` = {hidden, on, note: {text, warn} | null}
 *  from lineup-view.js starredQbChipView; the Optimizer's panel calls this after each draw, and renderFilterBar once as the bar is built. */
export function paintStarredQbChip(container, view) {
  const chip = container?.querySelector?.("#starred-qb-toggle");
  if (!chip || !view) return;
  chip.hidden = Boolean(view.hidden);
  chip.classList.toggle("active", Boolean(view.on));
  chip.setAttribute("aria-pressed", String(Boolean(view.on)));
  const note = container.querySelector("#starred-qb-note");
  if (!note) return;
  note.textContent = view.hidden || !view.on || !view.note ? "" : view.note.text;
  note.classList.toggle("opt-warn", Boolean(view.note?.warn));
}

/** The Locked and Excluded chips' numbers and on look (the approved look's filter row): called after each draw of the pool. */
export function paintPoolOnlyChips(container, { locked = 0, excluded = 0, only = null } = {}) {
  const set = (id, n, on) => {
    const chip = container?.querySelector?.(id);
    if (!chip) return;
    chip.classList.toggle("on", Boolean(on));
    chip.querySelector("b").textContent = String(n);
  };
  set("#locked-only-toggle", locked, only === "locked");
  set("#excluded-only-toggle", excluded, only === "excluded");
}

export function updateFilterSummary(container, { filteredCount, totalCount, activeGameLabel, onClearGame, starredCount }) {
  // The starred count of the slate on screen, unfiltered and unfloored (D53). Text only: the chip and its active class stay as they are.
  const starredEl = container.querySelector("#starred-toggle");
  if (starredEl) starredEl.textContent = favoritesChipLabel(starredCount);
  const countEl = container.querySelector("#filter-count");
  if (countEl) {
    // While the three-point floor is applying (Show all players off, no search text), say why the count is short.
    const f = store.get().filters;
    const floorOn = !f.showAllPlayers && !(f.search && f.search.trim());
    countEl.textContent =
      `${filteredCount} of ${totalCount} player${totalCount === 1 ? "" : "s"}` +
      (floorOn ? ` · projected above ${CLASSIC_PROJ_FLOOR.toFixed(1)}` : "");
  }
  const slot = container.querySelector("#active-game-chip-slot");
  if (!slot) return;
  if (!activeGameLabel) {
    slot.innerHTML = "";
    return;
  }
  slot.innerHTML = `<button type="button" class="chip active-game-chip" id="active-game-chip">${escapeHtml(activeGameLabel)} &times;</button>`;
  slot.querySelector("#active-game-chip").addEventListener("click", () => onClearGame?.());
}

/** The position chips (All, QB, ... FLEX) of the filter bar, which since Optimizer-first step 4 filters the Optimizer pool and the
 *  ranked list alike (the pool's own chip row is gone). */
export function posChipsHtml(currentPos) {
  return POSITION_CHIPS.map(
    (pos) => `<button type="button" class="chip pos-chip${pos === currentPos ? " active" : ""}" data-pos="${pos}">${pos}</button>`
  ).join("");
}

export function showAllToggleHtml(active, extraAttrs = "") {
  return `<button type="button"${extraAttrs ? ` ${extraAttrs}` : ""} class="chip toggle-chip${active ? " active" : ""}">Show all players</button>`;
}

/** Wires every `Show all players` button under `container`. `flag` {get(), set(on)}: a screen with its own switch (the Showdown's, C24); left out, it is classic's (the store's). */
export function wireShowAllButtons(container, flag = null) {
  container.querySelectorAll("[data-action='show-all']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (flag) {
        flag.set(!flag.get());
        return;
      }
      const on = !store.get().filters.showAllPlayers;
      if (typeof document !== "undefined") document.querySelector("#show-all-toggle")?.classList.toggle("active", on);
      store.setFilters({ showAllPlayers: on });
    });
  });
}

export function renderFilterBar(container, teamAbbrs, filters, callbacks, hasOverrides = true) {
  const chipsHtml = posChipsHtml(filters.pos);

  const teamChipsHtml = teamAbbrs
    .map((abbr) => {
      const t = TEAM_BY_ABBR[abbr];
      const logo = logoFor(t);
      const active = filters.teams.has(abbr) ? " active" : "";
      return `<button type="button" class="chip tchip team-chip${active}" data-team="${abbr}" title="Only ${escapeHtml(t?.name ?? abbr)}">${logo ? `<img class="logo xs" src="${escapeHtml(logo)}" alt="" />` : ""}${escapeHtml(abbr)}</button>`;
    })
    .join("");

  // The approved look's row order (PROJECT.md Part 4 item 5): positions, Locked / Excluded / Starred, search, the count, Columns (#columns-slot, filled at each draw by lineup.js); then salary, Clear filters, Starred QBs only, Show all, Reset all; then the team chips.
  container.innerHTML = `
    <div class="tools">
      <div class="tabs" id="pos-chips">${chipsHtml}</div>
      <div class="chips">
        <button type="button" id="locked-only-toggle" class="chip locked" title="Show only the locked men">Locked<b id="locked-count">0</b></button>
        <button type="button" id="excluded-only-toggle" class="chip excluded" title="Show only the excluded men">Excluded<b id="excluded-count">0</b></button>
        <button type="button" id="starred-toggle" class="chip starred toggle-chip${filters.starredOnly ? " active" : ""}">${favoritesChipLabel()}</button>
      </div>
      <input id="search-input" class="search" type="search" placeholder="Search players" value="${escapeHtml(filters.search ?? "")}" />
      <span id="filter-count" class="cnt filter-count"></span>
      <span id="columns-slot" class="colslot"></span>
    </div>
    <div class="fil">
      <label>Min salary<input id="salary-min" class="search salb" type="number" step="100" placeholder="min" value="${filters.salaryMin ?? ""}" /></label>
      <label>Max salary<input id="salary-max" class="search salb" type="number" step="100" placeholder="max" value="${filters.salaryMax ?? ""}" /></label>
      <button type="button" id="clear-filters-btn" class="chip">Clear filters</button>
      <button type="button" id="starred-qb-toggle" class="chip starred toggle-chip" aria-pressed="false">Starred QBs only</button>
      <span id="starred-qb-note" class="filter-qb-note"></span>
      ${showAllToggleHtml(filters.showAllPlayers, `id="show-all-toggle"`)}
      ${anchorHtml(`<button type="button" id="reset-overrides-btn" class="chip ovr reset-btn"${hasOverrides ? "" : " disabled"}>Reset all overrides</button>`)}
      <span id="active-game-chip-slot"></span>
      <div class="tchips" id="team-chips">${teamChipsHtml}</div>
    </div>
  `;

  const posChips = container.querySelectorAll(".pos-chip");
  posChips.forEach((el) => {
    el.addEventListener("click", () => {
      posChips.forEach((c) => c.classList.remove("active"));
      el.classList.add("active");
      callbacks.onPosChange(el.dataset.pos);
    });
  });

  container.querySelectorAll(".team-chip").forEach((el) => {
    el.addEventListener("click", () => {
      el.classList.toggle("active");
      callbacks.onTeamToggle(el.dataset.team);
    });
  });

  container.querySelector("#search-input").addEventListener("input", (e) => {
    callbacks.onSearchChange(e.target.value);
  });

  const minInput = container.querySelector("#salary-min");
  const maxInput = container.querySelector("#salary-max");
  const emitSalary = () => {
    const min = minInput.value === "" ? null : Number(minInput.value);
    const max = maxInput.value === "" ? null : Number(maxInput.value);
    callbacks.onSalaryChange({ min, max });
  };
  minInput.addEventListener("input", emitSalary);
  maxInput.addEventListener("input", emitSalary);

  const starredToggle = container.querySelector("#starred-toggle");
  starredToggle.addEventListener("click", () => {
    starredToggle.classList.toggle("active");
    callbacks.onStarredToggle(starredToggle.classList.contains("active"));
  });

  // Locked and Excluded narrow the table to those men (lineup-pool.js); their numbers and look follow each draw of the pool (paintPoolOnlyChips).
  container.querySelector("#locked-only-toggle").addEventListener("click", () => callbacks.onPoolOnlyToggle?.("locked"));
  container.querySelector("#excluded-only-toggle").addEventListener("click", () => callbacks.onPoolOnlyToggle?.("excluded"));

  // Starred QBs only is an Optimizer rule (lineup.js owns it): a click flips it there, and the panel's redraw repaints this chip.
  container.querySelector("#starred-qb-toggle").addEventListener("click", () => callbacks.onStarredQbToggle?.());
  paintStarredQbChip(container, callbacks.starredQbView?.());

  const showAllToggle = container.querySelector("#show-all-toggle");
  showAllToggle.addEventListener("click", () => {
    showAllToggle.classList.toggle("active");
    callbacks.onShowAllToggle(showAllToggle.classList.contains("active"));
  });

  container.querySelector("#clear-filters-btn").addEventListener("click", () => {
    callbacks.onClearFilters();
  });

  // A6 (round 3): the one question, asked beside the button, the same on the app and on the site. D72: the reset clears typed numbers and bumps only;
  // stars stay. On the public site it puts back the published numbers (D71; site-src/site-overrides.js).
  const resetBtn = container.querySelector("#reset-overrides-btn");
  resetBtn.addEventListener("click", () => {
    if (resetBtn.disabled) return;
    askInline(resetBtn, callbacks.resetQuestion?.() ?? RESET_ALL_QUESTION, () => callbacks.onResetOverrides()); // floats right-aligned under the button, so the bar does not grow; on the Optimizer's tabs the question names the tab it clears (Part F)
  });
}

// "Reset all overrides" (D28) clears only typed projection and ownership numbers, never stars or notes (D72), so
// it has nothing to do while no row carries a typed number; it starts muted and inert rather than reading as a
// live destructive action (👁 visual-qa third pass). On the public site the board says whether the visitor typed
// any number (site-src/site-overrides.js), since there Reset all puts back the published numbers (D71, D72).
// Optimizer standard A6 (round 3): a ± bump is a number change too, so a board with only bumps enables it (the reset clears them with the typed numbers).
export function hasAnyOverride(rows, siteTypedNumbers) {
  if (typeof siteTypedNumbers === "boolean") return siteTypedNumbers;
  return (rows ?? []).some((r) => r.override && (r.override.proj != null || r.override.own != null || bumpStepsOf(r) !== 0));
}

export const RESET_ALL_QUESTION ="Clear every typed projection, typed ownership and bump? Stars stay.";

/** A write that failed beside the button it came from (the project's rule: a failed write is shown beside what was clicked), in red; the next one replaces it. */
export function showButtonError(btn, text) {
  btn?.parentNode?.querySelectorAll(".button-error").forEach((el) => el.remove());
  btn?.insertAdjacentHTML("afterend", rowMessageHtml(text, "error").replace('class="row-msg', 'class="button-error row-msg'));
}
