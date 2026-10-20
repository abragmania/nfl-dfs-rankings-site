// Entry point: wires the DOM to the store and the renderers in public/js/*.js. Kept deliberately
// thin — every screen concern lives in its own module.
import {
  store,
  filterRows,
  sortRows,
  defaultDirFor,
  defaultFilters,
  activeSlate,
  activeSlateRows,
  activeSlateGames,
  slateDisplayName,
  isTwoGunMode,
  sortForBoard,
} from "./js/state.js";
import {
  getBoard,
  getSlate,
  postRefresh,
  putOverrides,
  deleteAllOverrides,
  postProjectionsPaste,
  postMode,
} from "./js/api.js";
import { renderPills, renderSlateLine, wireUpload, wireRefresh, wireThemeToggle, secondSlateSavedText, renderModeBox, uploadStatusSetter, entriesUploadedHandler, paintSourcesLink, wireSourcesLink, wireTrackedLink } from "./js/header.js";
import { uploadEntriesText, setUploadRouter } from "./js/entries-wire.js"; // Adam 2026-10-18: one upload for every DraftKings export
import { showdownKeyFromHash, showdownRowById, showdownBoardAsOf } from "./js/showdown/view.js";
import { configureShowdown, setRouteDkFile, uploadShowdownText, renderModeRowNow, renderShowdownTabNow, loadShowdownList, applyMode } from "./js/app-showdown.js";
import { adjustScrollPanels } from "./js/scroll-panels.js";
import { normalizeBoard } from "./js/normalize.js";
import { applyGrades, rowsGradedForView } from "./js/grade.js";
import { renderGameStrip, getGamestripCollapsed, setGamestripCollapsed } from "./js/gamestrip.js";
import { renderFilterBar, updateFilterSummary } from "./js/filterbar.js";
import { renderTableHead, renderTableBody, updateRow } from "./js/table.js";
import { renderTabs, isSourcesTab, sourcesTabToOpen, shownTab, renderProjectionsPanel, renderOwnershipPanel, renderLineupPanel, renderEntriesPanel } from "./js/tabs.js";
import { renderSourcesPage, APPLIED_ALL_EVENT } from "./js/sources-page.js"; // the one Sources page (Adam 2026-10-18), shared with the Showdown view
import { teamsSampleHtml } from "./js/teams-sample.js"; // Temporary (Adam 2026-10-18)
import { renderFavoritesPanel, favoriteRows } from "./js/favorites.js";
import { initExpand, syncExpandUi } from "./js/expand.js";
import { initPlayerCard } from "./js/player-card.js";

const el = {
  modeRow: document.getElementById("mode-row"),
  classicHeader: document.getElementById("classic-header"),
  classicMain: document.getElementById("classic-main"),
  showdownHeader: document.getElementById("showdown-header"),
  showdownMain: document.getElementById("showdown-main"),
  slateLine: document.getElementById("slate-line"),
  pillsRow: document.getElementById("pills-row"),
  uploadInfo: document.getElementById("upload-info"),
  csvInput: document.getElementById("csv-input"),
  refreshBtn: document.getElementById("refresh-btn"),
  themeToggleBtn: document.getElementById("theme-toggle-btn"),
  status: document.getElementById("status"),
  tabs: document.getElementById("tabs"),
  sourcesBtn: document.getElementById("sources-btn"), // Adam 2026-10-18: the header link to the Sources view
  sourcesPanel: document.getElementById("sources-panel"),
  slateNote: document.getElementById("slate-note"),
  rankingsPanel: document.getElementById("rankings-panel"),
  projectionsPanel: document.getElementById("projections-panel"),
  favoritesPanel: document.getElementById("favorites-panel"),
  favorites: {
    note: document.getElementById("favorites-note"),
    empty: document.getElementById("favorites-empty"),
    wrap: document.getElementById("favorites-wrap"),
    thead: document.getElementById("favorites-thead"),
    tbody: document.getElementById("favorites-tbody"),
  },
  ownBanner: document.getElementById("own-banner"),
  ownershipPanel: document.getElementById("ownership-panel"),
  teamsPanel: document.getElementById("teams-panel"), // Temporary (Adam 2026-10-18): the Teams (sample) tab
  lineupPanel: document.getElementById("lineup-panel"),
  showdownPanel: document.getElementById("showdown-panel"), // ChatGPT wish t, Adam 2026-10-17
  entriesPanel: document.getElementById("entries-panel"), // rules repo 2026-10-17: Entries is its own tab
  emptyState: document.getElementById("empty-state"),
  gamestrip: document.getElementById("gamestrip"),
  filterbar: document.getElementById("filterbar"),
  thead: document.getElementById("rankings-thead"),
  tbody: document.getElementById("rankings-tbody"),
};

// The Showdown module (public/js/app-showdown.js) reaches back for the element map and these three functions.
configureShowdown({ el, renderFilterBarNow, renderDynamic, renderSlateChrome });

function findRow(id) {
  return store.get().board?.rows.find((r) => String(r.id) === String(id));
}

function setStatusMessage(text, isError) {
  el.status.textContent = text;
  el.status.className = isError ? "status error" : "status";
}

const setUploadStatus = uploadStatusSetter({ statusEl: el.status, sdStatusEl: () => document.getElementById("sd-status"), showdownOn: () => Boolean(showdownKeyFromHash()) });

// Every write path (star, reset, edit, reset-all, source change, paste, refresh) shares this: on
// success the whole board is reloaded as usual; on failure (a thrown network error, or a response that
// came back but isn't ok) a plain message goes into #status and, when a row id is given, exactly that
// row is redrawn to its last-known-good state so a still-open input is never left dangling.
async function runWrite(action, { rowId, label = "the override" } = {}) {
  try {
    const data = await action();
    if (!data || !data.ok) {
      setStatusMessage(`Could not save ${label}: ${data?.error?.message ?? "unknown error"}`, true);
      if (rowId != null) restoreRow(rowId);
      return null;
    }
    handleBoardLoaded(data);
    return data;
  } catch (e) {
    setStatusMessage(`Could not save ${label}: ${e.message}`, true);
    if (rowId != null) restoreRow(rowId);
    return null;
  }
}

// Redraws one row from the board already in the store (i.e. as it stood before the failed edit), used
// only on a write-path failure; it never touches any other row or re-renders the whole tbody.
function restoreRow(rowId) {
  const row = findRow(rowId);
  const board = store.get().board;
  if (!row || !board) return;
  const hasNoteColumn = activeSlateRows(board).some((r) => r.note);
  // A failed save redraws the row in whichever table is on screen (Rankings or Favorites).
  updateRow(store.get().activeTab === "favorites" ? el.favorites.tbody : el.tbody, row, hasNoteColumn);
}

function handleBoardFailure(raw) {
  const code = raw?.error?.code ?? "UNKNOWN";
  const message = raw?.error?.message ?? "Something went wrong.";
  store.set({ board: null, boardError: { code, message }, loading: false });
  renderPills(el.pillsRow, { staleIds: raw?.stale ?? [], sources: null, warnings: [] });
  // The board failed, but the slate itself may still be readable (e.g. a source blew up building the
  // board) — show its line if GET /api/slate answers.
  getSlate()
    .then((s) => {
      if (s && s.ok) renderSlateLine(el.slateLine, s);
      else el.slateLine.textContent = "No slate loaded";
    })
    .catch(() => {
      el.slateLine.textContent = "No slate loaded";
    });
}

async function handleBoardLoaded(raw) {
  if (!raw || !raw.ok) {
    handleBoardFailure(raw);
    return;
  }
  const data = normalizeBoard(raw);
  data.rows = applyGrades(data.rows ?? []);
  // Board responses don't carry warnings (only GET /api/slate does, PROJECT.md Part 4); fetch them
  // best-effort so a failure here never blocks the board itself from rendering.
  try {
    const slateResp = await getSlate();
    data.warnings = slateResp?.ok ? slateResp.warnings ?? [] : [];
  } catch (e) {
    data.warnings = [];
  }
  setStatusMessage("", false);
  // A sort on a TwoGun column falls back to Value high to low once the board is not in TwoGun mode (state.js).
  store.set({ board: data, boardError: null, loading: false, sort: sortForBoard(store.get().sort, data) });
  renderStatic(data);
}

function uniqueTeams(games) {
  const teams = new Set();
  for (const g of games ?? []) {
    if (g.away) teams.add(g.away);
    if (g.home) teams.add(g.home);
  }
  return [...teams].sort();
}

// "Reset all overrides" (D28) clears only typed projection and ownership numbers, never stars or notes (D72), so
// it has nothing to do while no row carries a typed number; it starts muted and inert rather than reading as a
// live destructive action (👁 visual-qa third pass). On the public site the board says whether the visitor typed
// any number (site-src/site-overrides.js), since there Reset all puts back the published numbers (D71, D72).
function hasAnyOverride(rows, siteTypedNumbers) {
  if (typeof siteTypedNumbers === "boolean") return siteTypedNumbers;
  return (rows ?? []).some((r) => r.override && (r.override.proj != null || r.override.own != null));
}

const filterCallbacks = {
  onPosChange: (pos) => store.setFilters({ pos }),
  onTeamToggle: (abbr) => {
    const teams = new Set(store.get().filters.teams);
    if (teams.has(abbr)) teams.delete(abbr);
    else teams.add(abbr);
    store.setFilters({ teams });
  },
  onSalaryChange: ({ min, max }) => store.setFilters({ salaryMin: min, salaryMax: max }),
  onSearchChange: (text) => store.setFilters({ search: text }),
  onStarredToggle: (bool) => store.setFilters({ starredOnly: bool }),
  onShowAllToggle: (bool) => store.setFilters({ showAllPlayers: bool }),
  onClearFilters: () => {
    store.setFilters(defaultFilters());
    const board = store.get().board;
    if (board) {
      // A full rebuild (chips/search/salary all reset) is fine here since it's a deliberate click, not
      // a keystroke; re-run the dynamic render afterwards so the "N of M players" count and any
      // active-game chip reflect the just-cleared filters instead of the rebuild's blank placeholders.
      renderFilterBarNow(board);
      renderDynamic();
    }
  },
  onResetOverrides: async () => {
    await runWrite(() => deleteAllOverrides());
  },
};

function onGameClick(gameId) {
  const current = store.get().filters.gameId;
  store.setFilters({ gameId: current === gameId ? null : gameId });
}

function onSortClick(col) {
  const sort = store.get().sort;
  if (sort.col === col) store.setSort({ dir: sort.dir === "asc" ? "desc" : "asc" });
  else store.setSort({ col, dir: defaultDirFor(col) });
}

const tableCallbacks = {
  onToggleStar: async (id) => {
    const row = findRow(id);
    await runWrite(() => putOverrides({ stars: { [id]: !row?.starred } }), { rowId: id });
  },
  onResetField: async (id, field) => {
    await runWrite(() => putOverrides({ [field]: { [id]: null } }), { rowId: id });
  },
  onEditValue: async (id, field, value) => {
    await runWrite(() => putOverrides({ [field]: { [id]: value } }), { rowId: id });
  },
  onEditNote: async (id, text) => {
    await runWrite(() => putOverrides({ notes: { [id]: text } }), { rowId: id });
  },
};

// The Sources page saves its own choices (public/js/sources-page.js); this is the board repaint it asks for afterwards: a plain
// board read, so nothing is re-downloaded from a source. A board that cannot be read leaves the one on screen and says so under the row.
async function repaintAfterSourceSave() {
  const board = await getBoard();
  if (!board?.ok) throw new Error(board?.error?.message ?? "the server did not return the board");
  await handleBoardLoaded(board);
}
// "Apply to the main slate and every game" on a Showdown game's Sources page saved the main slate's choices too (Adam 2026-10-20),
// so the main slate's board held here is reloaded the same way; one that cannot be read stays and the status line says so.
window.addEventListener(APPLIED_ALL_EVENT, () => {
  repaintAfterSourceSave().catch((e) => setStatusMessage(`The sources were applied, but the main slate's board could not be reloaded: ${e.message}`, true));
});

const sourceCallbacks = {
  onPaste: async (payload) => {
    // The paste result (row/dropped/unmatched counts) is reported by tabs.js itself regardless of
    // success; only a genuinely thrown error (network down) needs to propagate to #status here.
    try {
      const result = await postProjectionsPaste(payload);
      if (result?.ok) {
        try {
          const board = await getBoard();
          handleBoardLoaded(board);
        } catch (e) {
          // Board reload failing after a paste isn't fatal to reporting the paste result itself.
        }
      }
      return result;
    } catch (e) {
      setStatusMessage(`Could not save the paste: ${e.message}`, true);
      throw e;
    }
  },
};

function onTabClick(tabKey) {
  store.set({ activeTab: tabKey });
}

// The header's Sources link opens the Sources page with the table last shown under it (Projections the first time).
let lastSourcesTab = null;
function onSourcesOpen() {
  store.set({ activeTab: sourcesTabToOpen(store.get().activeTab, lastSourcesTab) });
}

function onToggleGamestripCollapse() {
  const collapsed = !getGamestripCollapsed();
  setGamestripCollapsed(collapsed);
  store.set({}); // no state change of its own; just re-triggers renderDynamic to pick up the new value
}

function renderStatic(board) {
  renderSlateLine(el.slateLine, board.slate);
  renderPills(el.pillsRow, {
    staleIds: board.stale,
    sources: board.sources,
    warnings: board.warnings,
    injuryReport: board.injuryReport,
  });
  // TwoGun mode switch and board-stamp pill (merge plan 2026-10-15): a flip answers the recomputed board.
  renderModeBox(el.classicHeader, board.mode, { onSwitch: (mode) => runWrite(() => postMode(mode), { label: "the mode" }) });
  renderFilterBarNow(board);
  renderSlateChrome(); // the header label and the one-line note follow the slate on screen
  renderModeRowNow(); // the "Main slate" tile's game count depends on this board
  renderDynamic();
}

// The filter bar's team chips are the teams of the slate on screen (D57: the active second slate's games, or
// every game on the main slate). "Reset all overrides" clears the whole week's typed numbers (D72), so whether it has anything to do
// is still judged on the whole board, not just the slate on screen.
function renderFilterBarNow(board) {
  renderFilterBar(el.filterbar, uniqueTeams(activeSlateGames(board)), store.get().filters, filterCallbacks, hasAnyOverride(board.rows, board.siteTypedNumbers));
}

// Second slates (D57): the header label next to the title ("MAIN SLATE" / "AFTERNOON SLATE") and the one plain
// line under the tab bar that says what the second slate is and whose numbers it shows.
function renderSlateChrome() {
  const board = store.get().board;
  const slate = activeSlate(board);
  const tag = el.classicHeader?.querySelector(".mode-tag");
  if (tag) tag.textContent = slate ? slateDisplayName(slate).toUpperCase() : "MAIN SLATE";
  if (!el.slateNote) return;
  el.slateNote.hidden = !slate;
  if (!slate) {
    el.slateNote.textContent = "";
    return;
  }
  const n = slate.gameIds.length;
  const total = board?.slate?.games?.length ?? 0;
  el.slateNote.textContent = `${slateDisplayName(slate)}: ${n} of this week's ${total} game${total === 1 ? "" : "s"}. Projections and ownership are the main slate's numbers.`;
}

// The one line above the Rankings table that says where Own% comes from: only numbers a named source
// published for the DraftKings main slate. Everyone else is blank, and the app never estimates.
function ownBannerText(rows) {
  const published = (rows ?? []).filter((r) => r.ownKind === "quoted").length;
  if (published === 0) {
    return "No published DraftKings ownership numbers yet for this week. Own% is blank until real numbers are added.";
  }
  return `Own% shows published DraftKings numbers only (${published} player${published === 1 ? "" : "s"}). Everyone else is blank.`;
}

function renderEmptyState({ loading, boardError }) {
  el.emptyState.hidden = false;
  el.gamestrip.innerHTML = "";
  el.filterbar.innerHTML = "";
  el.thead.innerHTML = "";
  el.tbody.innerHTML = "";
  if (loading) {
    el.emptyState.textContent = "Building the board... this can take up to 40 seconds on first load.";
    return;
  }
  if (boardError?.code === "NO_SLATE") {
    el.emptyState.textContent = "Upload the DraftKings CSV to start.";
    return;
  }
  el.emptyState.textContent = boardError?.message ?? "Something went wrong.";
}

window.addEventListener("resize", adjustScrollPanels);
// Expand / Minimize on the four player tables (public/js/expand.js); minimizing re-sizes the table for its place.
initExpand({ onLayout: adjustScrollPanels });
// The player card: a click on any player's name opens his page (public/js/player-card.js); a showdown name reads the showdown board's row.
initPlayerCard({ findRow: (id, sd) => (sd ? showdownRowById(id) : findRow(id)), sdKey: showdownKeyFromHash, boardAsOf: (sd) => (sd ? showdownBoardAsOf() : store.get().board?.generatedAt) });

function renderDynamic() {
  const { board, filters, sort, loading, boardError } = store.get();
  const activeTab = shownTab(store.get().activeTab); // a tab the page does not draw (Entries on the site) shows Rankings

  // Every list below reads the slate on screen's rows (D57): the whole board, or the active second slate's.
  const slateRows = activeSlateRows(board);
  renderTabs(el.tabs, activeTab, onTabClick, favoriteRows(slateRows).length);
  if (isSourcesTab(activeTab)) lastSourcesTab = activeTab;
  paintSourcesLink(el.sourcesBtn, isSourcesTab(activeTab));

  if (!board) {
    // #empty-state lives as a sibling of the five tab panels (not nested inside #rankings-panel), so a
    // board failure or a still-loading board hides every panel and shows the one message regardless of
    // which tab is active — previously a failure while on a non-Rankings tab left that tab's blank
    // panel on screen instead of the error text.
    el.rankingsPanel.hidden = true;
    el.favoritesPanel.hidden = true;
    el.sourcesPanel.hidden = true;
    el.projectionsPanel.hidden = true;
    el.ownershipPanel.hidden = true;
    el.teamsPanel.hidden = true;
    el.lineupPanel.hidden = true;
    el.entriesPanel.hidden = true;
    // ChatGPT wish t, Adam 2026-10-17: the Showdown tab needs no main-slate board, so it stands in for the message.
    el.showdownPanel.hidden = activeTab !== "showdown";
    if (activeTab === "showdown") {
      el.emptyState.hidden = true;
      renderShowdownTabNow();
      syncExpandUi();
      return;
    }
    renderEmptyState({ loading, boardError });
    syncExpandUi();
    return;
  }
  el.emptyState.hidden = true;
  el.rankingsPanel.hidden = activeTab !== "rankings";
  el.favoritesPanel.hidden = activeTab !== "favorites";
  el.sourcesPanel.hidden = !isSourcesTab(activeTab);
  el.projectionsPanel.hidden = activeTab !== "projections";
  el.ownershipPanel.hidden = activeTab !== "ownership";
  el.teamsPanel.hidden = activeTab !== "teams";
  el.lineupPanel.hidden = activeTab !== "lineup";
  el.showdownPanel.hidden = activeTab !== "showdown";
  el.entriesPanel.hidden = activeTab !== "entries";

  if (activeTab === "rankings") {
    const collapsed = getGamestripCollapsed();
    renderGameStrip(el.gamestrip, activeSlateGames(board) ?? [], filters.gameId, onGameClick, {
      collapsed,
      onToggleCollapse: onToggleGamestripCollapse,
    });
    const allRows = rowsGradedForView(slateRows, filters.pos, board.rows); // D33: the FLEX view pools RB, WR and TE
    el.ownBanner.textContent = [ownBannerText(allRows), board.injuryNote].filter(Boolean).join(" ");
    const filtered = filterRows(allRows, filters);
    const sorted = sortRows(filtered, sort.col, sort.dir);
    const hasNoteColumn = allRows.some((r) => r.note);
    const tg = { twogun: isTwoGunMode(board), pos: filters.pos }; // TwoGun mode adds Med, Ceil, Ceil/$, Nuke, 3x%, 4x% (table.js TG_COLUMNS); a one-position list hides Pos (D80)
    renderTableHead(el.thead, sort, onSortClick, hasNoteColumn, tg);
    renderTableBody(el.tbody, sorted, tableCallbacks, hasNoteColumn, tg);
    const activeGame = filters.gameId ? (board.slate?.games ?? []).find((g) => g.id === filters.gameId) : null;
    updateFilterSummary(el.filterbar, {
      filteredCount: filtered.length,
      totalCount: allRows.length,
      activeGameLabel: activeGame ? `${activeGame.away} @ ${activeGame.home}` : null,
      onClearGame: () => store.setFilters({ gameId: null }),
    });
  } else if (activeTab === "favorites") {
    // Every starred player on the slate; the Rankings filters and the projection floor do not apply.
    renderFavoritesPanel(el.favorites, slateRows, tableCallbacks, slateRows.some((r) => r.note), [...(board.tabNotes?.favorites ?? []), board.injuryNote].filter(Boolean));
  } else if (isSourcesTab(activeTab)) {
    // The Sources page (always the main slate's choices, D57), then the Projections or Ownership table under its Players heading.
    renderSourcesPage(el.sourcesPanel, { board, slate: "main", showdown: false, activeKey: activeTab, onPlayersTab: onTabClick, onChanged: repaintAfterSourceSave });
    if (activeTab === "projections") renderProjectionsPanel(el.projectionsPanel, board, sourceCallbacks);
    else renderOwnershipPanel(el.ownershipPanel, board, sourceCallbacks);
  } else if (activeTab === "teams") {
    el.teamsPanel.innerHTML = teamsSampleHtml(); // Temporary (Adam 2026-10-18)
  } else if (activeTab === "lineup") {
    renderLineupPanel(el.lineupPanel, tableCallbacks);
  } else if (activeTab === "showdown") {
    renderShowdownTabNow();
  } else if (activeTab === "entries") {
    renderEntriesPanel(el.entriesPanel);
  }

  syncExpandUi();
  adjustScrollPanels();
}

store.subscribe(renderDynamic);

const { handleFile } = wireUpload(
  { csvInput: el.csvInput, uploadInfo: el.uploadInfo, slateLine: el.slateLine, pillsRow: el.pillsRow },
  {
    setStatus: setUploadStatus,
    onShowdownText: uploadShowdownText,
    // Adam 2026-10-18: an entries file loaded from any button shows the Entries tab (🔵: from a showdown screen, the main page first).
    onEntriesText: entriesUploadedHandler({
      upload: uploadEntriesText,
      showdownOn: () => Boolean(showdownKeyFromHash()),
      clearHash: () => { window.location.hash = ""; },
      showEntriesTab: () => onTabClick("entries"),
    }),
    onUploaded: async (data) => {
      try {
        const board = await getBoard();
        await handleBoardLoaded(board);
      } catch (e) {
        // /api/board may not be live yet; the upload's own status/pills are already shown.
      }
      // D57: the file was saved as a second slate. Switch to its tile, and put the message back (the board
      // reload above clears #status).
      if (data?.secondSlate) {
        window.location.hash = `slate=${encodeURIComponent(data.secondSlate.key)}`;
        setStatusMessage(secondSlateSavedText(data.secondSlate), false);
      }
    },
  }
);

setRouteDkFile(handleFile);
setUploadRouter(handleFile);

wireThemeToggle(el.themeToggleBtn);
wireSourcesLink(el.sourcesBtn, { onOpen: onSourcesOpen });
// The Tracked button sits on both headers (main slate and Showdown); both are in index.html, so both are wired here.
wireTrackedLink(document.getElementById("tracked-btn"));
wireTrackedLink(document.getElementById("sd-tracked-btn"), showdownKeyFromHash); // ?from= brings the page's back link to this game

wireRefresh({ refreshBtn: el.refreshBtn, statusEl: el.status }, {
  onRefresh: async () => {
    const refreshed = await postRefresh();
    if (!refreshed || !refreshed.ok) {
      throw new Error(refreshed?.error?.message ?? "unknown error");
    }
    const board = await getBoard();
    handleBoardLoaded(board);
  },
});

async function init() {
  store.set({ loading: true, boardError: null });
  try {
    const board = await getBoard();
    handleBoardLoaded(board);
  } catch (e) {
    handleBoardFailure({ ok: false, error: { code: "NETWORK_ERROR", message: e.message }, stale: [] });
  }
}

init();

window.addEventListener("hashchange", applyMode);
loadShowdownList();
applyMode();
