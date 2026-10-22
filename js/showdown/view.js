// Showdown mode controller (D39/D40): owns the showdown-only DOM (header band, game line, tabs, four
// panels), fetches and normalizes the showdown board, and renders whichever tab is active. Mounted from
// app.js, which owns the mode row and the classic-vs-showdown visibility toggle (app.js reads/writes
// location.hash's "#sd=<key>" itself); this module reacts to whatever key it is told to show.
// Two tabs (Rankings, Optimizer) plus the Sources view: ONE Sources page (public/js/sources-page.js, the same file classic uses) with
// the Projections or Ownership player table under it, picked by a switch on the page (Adam 2026-10-18; tabs.js SOURCE_TABS keys).
import { getShowdownBoard, postShowdownRefresh, postShowdownProjectionsPaste } from "./api.js";
import { renderPills, kickoffDateAndClock, paintSourcesLink, wireSourcesLink, modePillHtml } from "../header.js";
import { isSourcesTab, sourcesTabToOpen } from "../tabs.js";
import { renderSourcesPage, sectionSources } from "../sources-page.js";
import { escapeHtml, dec1 } from "../format.js";
import { showAllToggleHtml, wireShowAllButtons } from "../filterbar.js";
import { store } from "../state.js";
import { renderShowdownTableHead, renderShowdownTableBody, shownRows } from "./table.js";
import { renderShowdownTabs, renderShowdownProjectionsPanel, renderShowdownOwnershipPanel, renderShowdownLineupPanel, renderShowdownEntriesPanel } from "./tabs.js";
import { figuresPillHtml } from "./figures-label.js"; // the header pill naming the sources this game's board reads (Adam 2026-10-20)
import { normalizeBoard, defaultDirFor, sortRows, filterRows, teamFullName, joinWords } from "./board-shape.js"; // the board's pure shaping (moved for the 600-line cap)

const state = {
  activeTab: "rankings",
  lastSourcesTab: null, // the Sources page's table (projections or ownership) shown last, which the Sources button reopens (Adam 2026-10-18)
  // Default sort is Proj descending, matching the hosted sheet (coordinator fix) — Val stays sortable by
  // clicking its header, same as any other column; a null projection always sorts last (board-shape.js sortRows).
  sort: { col: "proj", dir: "desc" },
  filters: { team: "both", pos: "All", maxSalary: null, minProj: null },
  board: null, // the last successfully loaded board; never cleared just because a reload or a switch to
  // a different key is in flight (🔵 finding: the page must never blank a good board out from under Adam).
  boardKey: null, // the key `board` actually belongs to
  requestedKey: null, // the key currently asked for, even if its load hasn't resolved (or failed) yet —
  // Refresh reads this so it still works after a first load that failed and left `board` null.
  loading: false,
  error: null, // only shown when there is no good board to fall back to; a failure while a good board is
  // already on screen is reported in #sd-status instead (see loadBoard).
};

// Monotonic token plus the key it was issued for: every async board-affecting call (a fresh load, Refresh,
// a paste) takes a token before awaiting anything, and only applies its result if both the token and the
// key it was issued for are still current when it resolves — so a response for a showdown Adam has since
// navigated away from (or a second click before the first settled) is discarded rather than clobbering
// whatever is now on screen (🔵 findings: load token; never blank a good board).
let loadToken = 0;
function beginRequest(key) {
  state.requestedKey = key;
  return ++loadToken;
}
function isCurrent(token, key) {
  return token === loadToken && key === state.requestedKey;
}

export function showdownKeyFromHash() {
  const h = window.location.hash || "";
  const m = h.match(/^#sd=(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null; // a malformed percent-encoding must never throw out of a hashchange handler
  }
}

// The player card's two reads of the loaded showdown board: a row (given the game's key when the row has none, so the card can say vs or @) and its time.
export function showdownRowById(id) {
  const row = state.board?.rows?.find((r) => String(r.id) === String(id) || (r.cptId != null && String(r.cptId) === String(id)));
  const g = state.board?.game;
  if (!row) return null;
  return row.gameId || !g?.away || !g?.home ? row : { ...row, gameId: `${g.away}@${g.home}` }; // the board row's figures on every tab, as the Lineup tab's slots show them
}
export const showdownBoardAsOf = () => state.board?.generatedAt ?? null;

const els = {
  status: document.getElementById("sd-status"),
  tabs: document.getElementById("sd-tabs"),
  sourcesPanel: document.getElementById("sd-sources-panel"),
  sourcesBtn: document.getElementById("sd-sources-btn"),
  salaryBtn: document.getElementById("sd-salary-btn"),
  band: document.getElementById("sd-band"),
  pillsRow: document.getElementById("sd-pills-row"),
  figuresPill: document.getElementById("sd-figures-pill"),
  refreshBtn: document.getElementById("sd-refresh-btn"),
  rankingsPanel: document.getElementById("sd-rankings-panel"),
  gameline: document.getElementById("sd-gameline"),
  filterbar: document.getElementById("sd-filterbar"),
  thead: document.getElementById("sd-thead"),
  tbody: document.getElementById("sd-tbody"),
  legend: document.getElementById("sd-legend"),
  projectionsPanel: document.getElementById("sd-projections-panel"),
  ownershipPanel: document.getElementById("sd-ownership-panel"),
  lineupPanel: document.getElementById("sd-lineup-panel"),
  entriesPanel: document.getElementById("sd-entries-panel"),
  emptyState: document.getElementById("sd-empty-state"),
};

// --------------------------------------------------------------------------------------------------------
// Filter / sort (the pure sort and filter live in board-shape.js)
// --------------------------------------------------------------------------------------------------------

// Position chips, same six positions the showdown board actually carries (server/showdown/board.js rows:
// QB/RB/WR/TE/K/DST — no FLEX chip here, unlike the classic filter bar, since a showdown pool has no FLEX
// position of its own to combine RB/WR/TE into). Colours match the sd-pos-<pos> pill classes (style.css).
const SD_POSITION_CHIPS = ["All", "QB", "RB", "WR", "TE", "K", "DST"];

function computeVisibleRows() {
  const rows = state.board?.rows ?? [];
  const filtered = filterRows(shownRows(rows), state.filters, state.board?.game);
  return sortRows(filtered, state.sort.col, state.sort.dir);
}

// --------------------------------------------------------------------------------------------------------
// Render
// --------------------------------------------------------------------------------------------------------

function renderBand() {
  const g = state.board?.game ?? {};
  const away = teamFullName(g.away);
  const home = teamFullName(g.home);
  const when = kickoffDateAndClock(g.kickoffEt);
  els.band.innerHTML = `<span class="sd-band-text">SHOWDOWN &middot; ${escapeHtml(away)} at ${escapeHtml(home)}${when ? ` &middot; ${escapeHtml(when)} ET` : ""}</span>`;
}

// Four small boxes above the Rankings table (👁 visual-qa: like the hosted sheet's Total/Line/implied
// boxes), built from payload.game — never re-derived, just the numbers the board already computed.
function renderGameLine() {
  if (!els.gameline) return;
  const g = state.board?.game;
  if (!g) {
    els.gameline.innerHTML = "";
    return;
  }
  const total = g.total != null ? dec1(g.total) : "—";
  const line = g.favorite && g.spread != null ? `${g.favorite} -${dec1(Math.abs(g.spread))}` : "—";
  const awayImplied = g.implied?.[g.away] != null ? dec1(g.implied[g.away]) : "—";
  const homeImplied = g.implied?.[g.home] != null ? dec1(g.implied[g.home]) : "—";
  els.gameline.innerHTML = `
    <div class="sd-gameline-box"><span class="sd-gameline-label">Total</span><span class="sd-gameline-value">${escapeHtml(total)}</span></div>
    <div class="sd-gameline-box"><span class="sd-gameline-label">Line</span><span class="sd-gameline-value">${escapeHtml(line)}</span></div>
    <div class="sd-gameline-box"><span class="sd-gameline-label">${escapeHtml(g.away ?? "Away")} implied</span><span class="sd-gameline-value">${escapeHtml(awayImplied)}</span></div>
    <div class="sd-gameline-box"><span class="sd-gameline-label">${escapeHtml(g.home ?? "Home")} implied</span><span class="sd-gameline-value">${escapeHtml(homeImplied)}</span></div>`;
}

// D40: the legend names its actual sources instead of a hard-coded sentence, read straight off the board
// payload so it always matches whatever sources actually fed this week's numbers (the words joined by board-shape.js joinWords).
function renderLegend() {
  if (!els.legend) return;
  const sources = state.board?.sources ?? [];
  const projLabels = joinWords(sources.filter((s) => s.kind === "projection").map((s) => s.label));
  const hasKickerCard = sources.some((s) => s.kind === "kicker");
  // R85: only the sources in board.ownershipUsedIds fed the numbers (a set-aside source is not named); an older board without the list names them all.
  const ownSources = state.board?.ownershipSources ?? [];
  const usedIds = state.board?.ownershipUsedIds;
  const usedOwn = Array.isArray(usedIds) ? ownSources.filter((s) => usedIds.includes(s.id)) : ownSources;
  const ownLabels = joinWords(usedOwn.map((s) => s.label));
  const projText = projLabels ? `Proj from ${projLabels}${hasKickerCard ? " (kickers as consolidated)" : ""}` : "";
  const ownText = ownLabels
    ? `Own from ${ownLabels}; a dash where nobody has published one`
    : ownSources.some((s) => (s.rows ?? []).length) ? "Own: no source in use names enough of the main players" : "Own: no source has published showdown ownership yet";
  const sourceSentence = [projText, ownText].filter(Boolean).join("; ");
  const legendText = [
    sourceSentence,
    "hover any Proj or Own cell for exactly how that number was made",
  ]
    .filter(Boolean)
    .join(" · ");
  els.legend.textContent = legendText;
}

function renderEmpty() {
  els.emptyState.hidden = false;
  for (const p of [els.rankingsPanel, els.sourcesPanel, els.projectionsPanel, els.ownershipPanel, els.lineupPanel, els.entriesPanel]) p.hidden = true;
  els.band.innerHTML = "";
  els.emptyState.textContent = state.loading ? "Loading the showdown board…" : state.error ?? "Could not load this showdown.";
}

function onSortClick(col) {
  if (state.sort.col === col) state.sort = { col, dir: state.sort.dir === "asc" ? "desc" : "asc" };
  else state.sort = { col, dir: defaultDirFor(col) };
  renderRankingsTable();
}

function renderRankingsTable() {
  const visible = computeVisibleRows();
  renderShowdownTableHead(els.thead, state.sort, onSortClick);
  renderShowdownTableBody(els.tbody, visible);
  const countEl = els.filterbar.querySelector("#sd-filter-count");
  if (countEl) countEl.textContent = `${visible.length} of ${(state.board?.rows ?? []).length} players`;
}

function renderFilterBar() {
  const g = state.board?.game ?? {};
  const posChipsHtml = SD_POSITION_CHIPS.map(
    (pos) => `<button type="button" class="chip pos-chip sd-pos-chip${pos === state.filters.pos ? " active" : ""}" data-pos-filter="${pos}" data-pos="${pos}">${pos}</button>`
  ).join("");
  els.filterbar.innerHTML = `
    <div class="filter-row">
      <div class="chip-group">
        <button type="button" class="chip pos-chip${state.filters.team === "both" ? " active" : ""}" data-team-filter="both">Both</button>
        <button type="button" class="chip pos-chip${state.filters.team === "away" ? " active" : ""}" data-team-filter="away">${escapeHtml(g.away ?? "Away")}</button>
        <button type="button" class="chip pos-chip${state.filters.team === "home" ? " active" : ""}" data-team-filter="home">${escapeHtml(g.home ?? "Home")}</button>
      </div>
      <div class="chip-group" id="sd-pos-chips">${posChipsHtml}</div>
      <div class="filter-salary">
        <label>Max FLEX salary <input id="sd-max-salary" type="number" step="200" placeholder="any" value="${state.filters.maxSalary ?? ""}" /></label>
        <label>Min FLEX pts <input id="sd-min-proj" type="number" step="1" placeholder="any" value="${state.filters.minProj ?? ""}" /></label>
      </div>
      ${showAllToggleHtml(store.get().filters.showAllPlayers, `data-action="show-all"`)}
      <span id="sd-filter-count" class="filter-count"></span>
      <button type="button" id="sd-clear-filters-btn" class="link-btn">Clear filters</button>
    </div>`;
  wireShowAllButtons(els.filterbar);
  els.filterbar.querySelectorAll("[data-team-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filters.team = btn.dataset.teamFilter;
      renderFilterBar();
      renderRankingsTable();
    });
  });
  els.filterbar.querySelectorAll("[data-pos-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filters.pos = btn.dataset.posFilter;
      renderFilterBar();
      renderRankingsTable();
    });
  });
  // Same as classic's "Clear filters": a deliberate click, so a full rebuild of the bar is fine.
  els.filterbar.querySelector("#sd-clear-filters-btn")?.addEventListener("click", () => {
    state.filters = { team: "both", pos: "All", maxSalary: null, minProj: null };
    document.querySelector("#show-all-toggle")?.classList.remove("active");
    store.setFilters({ showAllPlayers: false });
    renderFilterBar();
    renderRankingsTable();
  });
  // Patches the table only (not the whole filter bar) on every keystroke, same reasoning as the classic
  // filter bar's salary inputs (public/js/filterbar.js): rebuilding the input itself would steal focus.
  const maxInput = els.filterbar.querySelector("#sd-max-salary");
  maxInput?.addEventListener("input", () => {
    state.filters.maxSalary = maxInput.value === "" ? null : Number(maxInput.value);
    renderRankingsTable();
  });
  const minProjInput = els.filterbar.querySelector("#sd-min-proj");
  minProjInput?.addEventListener("input", () => {
    state.filters.minProj = minProjInput.value === "" ? null : Number(minProjInput.value);
    renderRankingsTable();
  });
}

// Applies an already-fetched, already-ok board response as the new current board, gated by the same
// token/key check as a plain load (🔵 findings: use the board that refresh/paste already return instead
// of a second GET; discard a response for a key that's no longer current).
function applyBoardResponse(raw, key, token) {
  if (!isCurrent(token, key)) return false;
  state.board = normalizeBoard(raw);
  state.boardKey = key;
  state.error = null;
  state.loading = false;
  render();
  return true;
}

// A write from the Lineup tab that answers this game's board (the ± bump, Adam 2026-10-22): `send(key)` makes the request; the answer
// is applied as a refresh's, and a refusal or a failure puts the server's sentence in the status line, as a failed refresh does.
// The load token is read, not taken (🔵 2026-10-22): a Refresh or load already out keeps its answer, and this answer is applied only
// when no other request started since. Resolves true when the server took the write, false when it did not.
async function writeBoard(send, label) {
  const key = state.boardKey;
  const token = loadToken;
  const failed = `Could not save ${label}: `;
  try {
    const r = await send(key);
    if (!r || r.ok === false) throw new Error(r?.error?.message ?? "unknown error");
    applyBoardResponse(r, key, token);
    if (els.status.textContent.startsWith(failed)) { // this write's earlier refusal is over; any other line stays
      els.status.textContent = "";
      els.status.className = "status";
    }
    return true;
  } catch (e) {
    if (state.boardKey === key) { // the same game is still on screen
      els.status.textContent = `${failed}${e.message}`;
      els.status.className = "status error";
    }
    return false;
  }
}

// Never rejects. Returns null when the board was read (or a newer request took over), else the plain reason it could not be, which the
// Sources page shows under the row it just saved (onChanged in renderSourcesView).
async function loadBoard(key) {
  const token = beginRequest(key);
  // A good board for a DIFFERENT key is not shown while the new one loads (there is nothing honest to
  // show), but a good board for THIS SAME key (a Refresh, or navigating back to a key already loaded) is
  // never cleared just because a reload started (🔵 finding: never blank a good board).
  if (state.boardKey !== key) {
    state.board = null;
    state.error = null;
  }
  state.loading = true;
  render();
  try {
    const raw = await getShowdownBoard(key);
    if (!isCurrent(token, key)) return null;
    if (!raw || !raw.ok) {
      state.loading = false;
      // A good board already on screen (same key, a prior success) stays up; the failure is reported in
      // the status line rather than blanking the page.
      if (state.board && state.boardKey === key) {
        els.status.textContent = `Could not reload: ${raw?.error?.message ?? "unknown error"}`;
        els.status.className = "status error";
        render();
      } else {
        state.error = raw?.error?.message ?? "Could not load this showdown.";
        render();
      }
      return raw?.error?.message ?? "the server did not return the board";
    }
    applyBoardResponse(raw, key, token);
    return null;
  } catch (e) {
    if (!isCurrent(token, key)) return null;
    state.loading = false;
    if (state.board && state.boardKey === key) {
      els.status.textContent = `Could not reload: ${e.message}`;
      els.status.className = "status error";
      render();
    } else {
      state.error = e.message;
      render();
    }
    return e.message;
  }
}

function onTabClick(tab) {
  state.activeTab = tab;
  render();
}

function render() {
  if (isSourcesTab(state.activeTab)) state.lastSourcesTab = state.activeTab;
  renderShowdownTabs(els.tabs, state.activeTab, onTabClick);
  paintSourcesLink(els.sourcesBtn, isSourcesTab(state.activeTab));
  if (els.figuresPill) els.figuresPill.hidden = !(els.figuresPill.innerHTML = figuresPillHtml(state.board, modePillHtml)); // none for no board or one with no figures
  if (!state.board) {
    renderEmpty();
    return;
  }
  els.emptyState.hidden = true;
  els.rankingsPanel.hidden = state.activeTab !== "rankings";
  els.sourcesPanel.hidden = !isSourcesTab(state.activeTab);
  els.projectionsPanel.hidden = state.activeTab !== "projections";
  els.ownershipPanel.hidden = state.activeTab !== "ownership";
  els.lineupPanel.hidden = state.activeTab !== "lineup";
  els.entriesPanel.hidden = state.activeTab !== "entries";

  // The gold band and stale/failed source pills show on both tabs and the Sources view (brief).
  renderBand();
  renderPills(els.pillsRow, { staleIds: state.board.stale ?? [], sources: state.board.sources ?? null, warnings: [], injuryReport: state.board.injuryReport });

  if (state.activeTab === "rankings") {
    renderGameLine();
    renderFilterBar();
    renderRankingsTable();
    renderLegend();
  } else if (isSourcesTab(state.activeTab)) {
    renderSourcesView();
  } else if (state.activeTab === "lineup") {
    renderShowdownLineupPanel(els.lineupPanel, state.board, state.boardKey, { onOpenSources: openSources, onBoardWrite: writeBoard });
  } else if (state.activeTab === "entries") {
    renderShowdownEntriesPanel(els.entriesPanel, state.board, state.boardKey);
  }
}

// The Sources view: the one Sources page, then the Projections or Ownership player table under its Players heading.
function renderSourcesView() {
  renderSourcesPage(els.sourcesPanel, {
    board: state.board,
    slate: state.boardKey,
    showdown: true,
    activeKey: state.activeTab,
    onPlayersTab: onTabClick,
    onChanged: async () => { // a plain board read: the saved choices rebuild the board, nothing is re-downloaded
      const why = await loadBoard(state.boardKey);
      if (why) throw new Error(why); // loadBoard never rejects: the page says "Saved, but the board could not be refreshed" from this
    },
    onSelection: () => { if (isSourcesTab(state.activeTab) && state.board) render(); }, // the ticks arrived after the first draw: the Projections table's columns follow them
  });
  if (state.activeTab === "projections") {
    renderShowdownProjectionsPanel(els.projectionsPanel, state.board, {
      selection: sectionSources(state.boardKey, "projection"), // ticked and unticked: an unticked source's column is dimmed, as classic's
      onPaste: async (payload) => {
        const key = state.boardKey;
        const token = beginRequest(key);
        const result = await postShowdownProjectionsPaste(key, payload);
        if (result?.ok && result.board) applyBoardResponse(result.board, key, token);
        return result;
      },
    });
  } else {
    renderShowdownOwnershipPanel(els.ownershipPanel, state.board, { flex: sectionSources(state.boardKey, "sdOwnFlex"), cpt: sectionSources(state.boardKey, "sdOwnCpt") });
  }
}

store.subscribe(() => {
  if (state.board && document.getElementById("showdown-main")?.hidden === false) render();
});

// The Sources button opens the Sources page on the table already showing, else the last one shown, else Projections (tabs.js sourcesTabToOpen);
// the header's sources pill and the Lineup meter's figures label open it the same way.
function openSources() {
  state.activeTab = sourcesTabToOpen(state.activeTab, state.lastSourcesTab);
  render();
}
wireSourcesLink(els.sourcesBtn, { onOpen: openSources });
els.figuresPill?.addEventListener("click", (e) => { if (e.target?.closest?.("[data-sd-open-sources]")) openSources(); });

// The Salary used button opens the contest salary-used page, naming the Showdown on screen so its Back button returns here.
// The address is relative (the page sits beside index.html), so it works on localhost and under the public site's sub-path.
els.salaryBtn?.addEventListener("click", () => {
  const key = showdownKeyFromHash() ?? state.boardKey ?? state.requestedKey;
  window.location.assign(key ? `showdown-salary.html?from=${encodeURIComponent(key)}` : "showdown-salary.html");
});

els.refreshBtn?.addEventListener("click", async () => {
  const key = state.boardKey ?? state.requestedKey;
  if (!key) return;
  const token = beginRequest(key);
  els.status.textContent = "Refreshing sources...";
  els.status.className = "status";
  try {
    const r = await postShowdownRefresh(key);
    if (!isCurrent(token, key)) return;
    if (!r || r.ok === false) throw new Error(r?.error?.message ?? "unknown error");
    applyBoardResponse(r, key, token);
    els.status.textContent = "Refreshed.";
  } catch (e) {
    if (!isCurrent(token, key)) return;
    els.status.textContent = `Could not refresh: ${e.message}`;
    els.status.className = "status error";
  }
});

// Called by app.js whenever the mode row or a hash change points at a given showdown key. Reloads the
// board only when the key actually changed (a tab click or sort re-renders through render() directly,
// above, without refetching) — but a key that's already the requested one (e.g. the same tile clicked
// twice) does not re-fetch either.
export async function renderShowdownView(key) {
  if (!key) return;
  if (state.requestedKey !== key) {
    await loadBoard(key);
  } else if (state.board) {
    render();
  }
}

// Exported for app-showdown.js: a Showdown entries upload opens that game's tab; another game's board draws it when its hashchange load lands.
export function openShowdownTab(tab) {
  state.activeTab = tab;
  if (state.boardKey === showdownKeyFromHash()) render();
}

// Exported for app.js (🔵 finding): after a successful CSV upload of the showdown already on screen, the
// board is stale (new salaries, maybe a new week) and must be reloaded even though the hash didn't change.
export async function forceReloadShowdown(key) {
  if (!key) return;
  await loadBoard(key);
}

// Exported for app.js's upload flow (🔵 finding): the upload response's own stale list is shown
// immediately, the same way the classic header's wireUpload shows pills before the board reload lands.
export function showUploadPills(staleIds) {
  renderPills(els.pillsRow, { staleIds: staleIds ?? [], sources: state.board?.sources ?? null, warnings: [], injuryReport: state.board?.injuryReport });
}
