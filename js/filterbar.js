// Filter bar: position chips, team multi-select chips (one per team on the slate, in team colours),
// salary range, search, starred-only toggle, reset-all-overrides. Rendered once per board load; after
// that only class names are toggled (never innerHTML) so the salary/search inputs never lose focus
// or cursor position while Adam is typing.
import { escapeHtml } from "./format.js";
import { textColourFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { POSITION_CHIPS, CLASSIC_PROJ_FLOOR, store } from "./state.js";

// `updateFilterSummary` is called on every filter change (app.js) to patch just the "N of M players"
// count and the removable active-game chip, without touching the rest of the bar — the position chips,
// search box and salary inputs are only fully re-rendered on a board load or an explicit "Clear
// filters", so a keystroke in the search box never loses focus.
export function updateFilterSummary(container, { filteredCount, totalCount, activeGameLabel, onClearGame }) {
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

export function renderFilterBar(container, teamAbbrs, filters, callbacks, hasOverrides = true) {
  const posChipsHtml = POSITION_CHIPS.map(
    (pos) => `<button type="button" class="chip pos-chip${pos === filters.pos ? " active" : ""}" data-pos="${pos}">${pos}</button>`
  ).join("");

  const teamChipsHtml = teamAbbrs
    .map((abbr) => {
      const t = TEAM_BY_ABBR[abbr];
      const primary = t?.colourPrimary ?? "#333333";
      const secondary = t?.colourSecondary ?? "#ffffff";
      const textColour = textColourFor(primary, secondary);
      const active = filters.teams.has(abbr) ? " active" : "";
      return `<button type="button" class="chip team-chip${active}" data-team="${abbr}" style="background:${primary};color:${textColour}">${escapeHtml(abbr)}</button>`;
    })
    .join("");

  container.innerHTML = `
    <div class="filter-row">
      <div class="chip-group" id="pos-chips">${posChipsHtml}</div>
      <div class="filter-search">
        <input id="search-input" type="search" placeholder="Search players" value="${escapeHtml(filters.search ?? "")}" />
      </div>
      <div class="filter-salary">
        <label>Salary <input id="salary-min" type="number" step="100" placeholder="min" value="${filters.salaryMin ?? ""}" /></label>
        <span>-</span>
        <label><input id="salary-max" type="number" step="100" placeholder="max" value="${filters.salaryMax ?? ""}" /></label>
      </div>
      <button type="button" id="starred-toggle" class="chip toggle-chip${filters.starredOnly ? " active" : ""}">★ Starred only</button>
      <button type="button" id="show-all-toggle" class="chip toggle-chip${filters.showAllPlayers ? " active" : ""}">Show all players</button>
      <button type="button" id="reset-overrides-btn" class="reset-btn"${hasOverrides ? "" : " disabled"}>Reset all overrides</button>
    </div>
    <div class="filter-row">
      <div class="chip-group" id="team-chips">${teamChipsHtml}</div>
    </div>
    <div class="filter-row filter-summary-row">
      <span id="filter-count" class="filter-count"></span>
      <button type="button" id="clear-filters-btn" class="link-btn">Clear filters</button>
      <span id="active-game-chip-slot"></span>
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

  const showAllToggle = container.querySelector("#show-all-toggle");
  showAllToggle.addEventListener("click", () => {
    showAllToggle.classList.toggle("active");
    callbacks.onShowAllToggle(showAllToggle.classList.contains("active"));
  });

  container.querySelector("#clear-filters-btn").addEventListener("click", () => {
    callbacks.onClearFilters();
  });

  container.querySelector("#reset-overrides-btn").addEventListener("click", () => {
    if (window.confirm("Reset all overrides for this week? This clears every star, note, and edited projection or ownership number.")) {
      callbacks.onResetOverrides();
    }
  });
}
