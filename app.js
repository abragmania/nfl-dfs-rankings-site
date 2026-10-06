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
  slateKeyFromHashString,
} from "./js/state.js";
import {
  getBoard,
  getSlate,
  postRefresh,
  putOverrides,
  deleteAllOverrides,
  postSources,
  postProjectionsPaste,
} from "./js/api.js";
import { renderPills, renderSlateLine, wireUpload, wireRefresh, renderModeRow, wireThemeToggle, secondSlateSavedText } from "./js/header.js";
import { getShowdowns, postShowdownUpload } from "./js/showdown/api.js";
import { renderShowdownView, showdownKeyFromHash, forceReloadShowdown, showUploadPills } from "./js/showdown/view.js";
import { normalizeBoard } from "./js/normalize.js";
import { applyGrades } from "./js/grade.js";
import { renderGameStrip, getGamestripCollapsed, setGamestripCollapsed } from "./js/gamestrip.js";
import { renderFilterBar, updateFilterSummary } from "./js/filterbar.js";
import { renderTableHead, renderTableBody, updateRow } from "./js/table.js";
import { renderTabs, renderProjectionsPanel, renderOwnershipPanel, renderLineupPanel } from "./js/tabs.js";
import { renderFavoritesPanel, favoriteRows } from "./js/favorites.js";

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
  lineupPanel: document.getElementById("lineup-panel"),
  emptyState: document.getElementById("empty-state"),
  gamestrip: document.getElementById("gamestrip"),
  filterbar: document.getElementById("filterbar"),
  thead: document.getElementById("rankings-thead"),
  tbody: document.getElementById("rankings-tbody"),
};

function findRow(id) {
  return store.get().board?.rows.find((r) => String(r.id) === String(id));
}

function setStatusMessage(text, isError) {
  el.status.textContent = text;
  el.status.className = isError ? "status error" : "status";
}

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
  store.set({ board: data, boardError: null, loading: false });
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

// "Reset all overrides" (D28) has nothing to do while no row carries an override, a star or a note (👁
// visual-qa third pass); it starts muted and inert rather than reading as a live destructive action.
function hasAnyOverride(rows) {
  return (rows ?? []).some(
    (r) => r.starred || r.note || (r.override && (r.override.proj != null || r.override.own != null))
  );
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

const sourceCallbacks = {
  onSourceChange: async (id, patch) => {
    // A failed save must revert whatever the user just typed/toggled back to the board's actual,
    // still-current settings, so the panel is re-rendered from the unchanged board on failure.
    const data = await runWrite(() => postSources({ id, ...patch }), { label: "the source setting" });
    if (!data) renderDynamic();
  },
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
  });
  renderFilterBarNow(board);
  renderSlateChrome(); // the header label and the one-line note follow the slate on screen
  renderModeRowNow(); // the "Main slate" tile's game count depends on this board
  renderDynamic();
}

// The filter bar's team chips are the teams of the slate on screen (D57: the active second slate's games, or
// every game on the main slate). "Reset all overrides" clears the whole week, so whether it has anything to do
// is still judged on the whole board, not just the slate on screen.
function renderFilterBarNow(board) {
  renderFilterBar(el.filterbar, uniqueTeams(activeSlateGames(board)), store.get().filters, filterCallbacks, hasAnyOverride(board.rows));
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

// ---------------------------------------------------------------------------------------------------
// Mode row (Showdown, D39/D40): a tile per loaded showdown plus "Main slate" and "Upload Showdown CSV",
// always visible above the classic game strip. app.js owns location.hash's "#sd=<key>" and the
// classic-vs-showdown visibility toggle; public/js/showdown/view.js owns everything drawn inside the
// showdown header/main once a key is active.
// ---------------------------------------------------------------------------------------------------
let showdownList = [];

function mainSlateLabel() {
  const games = store.get().board?.slate?.games?.length;
  return games != null ? `Main slate · ${games} game${games === 1 ? "" : "s"}` : "Main slate";
}

function renderModeRowNow() {
  renderModeRow(el.modeRow, {
    mainLabel: mainSlateLabel(),
    showdowns: showdownList,
    activeKey: showdownKeyFromHash(),
    slates: store.get().board?.slates ?? [],
    activeSlateKey: store.get().activeSlateKey,
    onSelectMain: () => {
      window.location.hash = "";
    },
    onSelectSlate: (key) => {
      window.location.hash = `slate=${encodeURIComponent(key)}`;
    },
    onSelectShowdown: (key) => {
      window.location.hash = `sd=${encodeURIComponent(key)}`;
    },
    onUploadShowdownCsv: async (file) => {
      // A showdown upload's own failure or success must show wherever Adam is actually looking: the
      // classic #status is hidden while a showdown is on screen, so this writes to #sd-status instead
      // whenever one is active (🔵 review item 8).
      const showdownActive = Boolean(showdownKeyFromHash());
      const sdStatusEl = document.getElementById("sd-status");
      const setUploadStatus = (text, isError) => {
        if (showdownActive && sdStatusEl) {
          sdStatusEl.textContent = text;
          sdStatusEl.className = isError ? "status error" : "status";
        } else {
          setStatusMessage(text, isError);
        }
      };
      try {
        const text = await file.text();
        const data = await postShowdownUpload(text);
        if (data?.ok) {
          await loadShowdownList();
          // The upload's own stale list is shown immediately, before any reload/navigation lands (same as
          // the classic header's wireUpload) — but only when the showdown just uploaded is the one already
          // on screen; otherwise the tile/hash switch below is about to load it fresh anyway.
          if (data.key === showdownKeyFromHash()) {
            showUploadPills(data.stale ?? []);
            await forceReloadShowdown(data.key);
          } else {
            window.location.hash = `sd=${encodeURIComponent(data.key)}`;
          }
        } else {
          setUploadStatus(`Showdown upload failed: ${data?.error?.message ?? "unknown error"}`, true);
        }
      } catch (e) {
        setUploadStatus(`Showdown upload failed: ${e.message}`, true);
      }
    },
  });
}

async function loadShowdownList() {
  try {
    const data = await getShowdowns();
    showdownList = data?.ok ? data.showdowns ?? [] : [];
  } catch (e) {
    showdownList = [];
  }
  renderModeRowNow();
}

// Switches the whole page between the classic slate and a showdown, driven entirely by location.hash so
// the mode survives a reload and is one click away from the mode row at any time.
function applyMode() {
  const key = showdownKeyFromHash();
  const isShowdown = Boolean(key);
  el.classicHeader.hidden = isShowdown;
  el.classicMain.hidden = isShowdown;
  el.showdownHeader.hidden = !isShowdown;
  el.showdownMain.hidden = !isShowdown;
  // Second slates (D57): "#slate=<key>" keeps the classic app on screen and picks which slate's players it
  // lists; any other hash (none, or a showdown's) is the main slate. A team or game filter names main-slate
  // games, so both are cleared on a switch rather than left hiding every player of the new slate.
  const slateKey = isShowdown ? null : slateKeyFromHashString(window.location.hash);
  if (slateKey !== store.get().activeSlateKey) {
    store.set({ activeSlateKey: slateKey, filters: { ...store.get().filters, teams: new Set(), gameId: null } });
    const board = store.get().board;
    if (board) {
      renderFilterBarNow(board);
      renderDynamic();
    }
  }
  renderSlateChrome();
  renderModeRowNow();
  if (isShowdown) renderShowdownView(key);
}

// The one line above the Rankings table that says where Own% comes from: only numbers a named source
// published for the DraftKings main slate. Everyone else is blank, and the app never estimates.
function ownBannerText(rows) {
  const published = (rows ?? []).filter((r) => r.ownKind === "quoted").length;
  if (published === 0) {
    return "No published DraftKings ownership numbers yet for this week. Own% and Lev are blank until real numbers are added.";
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

// Whole-row snapping by geometry rather than by one row's height (👁 visual-qa fourth/fifth pass): finds
// the last tbody row whose bottom edge actually fits within the available height and snaps the panel's
// max-height to that row's bottom, so a row that renders taller/shorter than another (wrapped text,
// badges, etc.) never leaves a partial row peeking out at the bottom. `panelEl.offsetHeight -
// panelEl.clientHeight` is added back on as the panel's own border/scrollbar allowance. Falls back to the
// previous head+available calc() only when the panel has no tbody rows yet (e.g. an empty table).
//
// This exact function also lives in public/js/lineup.js as resizeLineupScrollPanels's per-panel sizing
// step. It isn't imported from here because app.js is the page's entry module (never imported by anyone
// else) while lineup.js is imported by tabs.js which app.js itself imports — importing app.js back into
// lineup.js would make that a circular module dependency. Duplicated on purpose; keep both in sync.
function snapPanelMaxHeight(panelEl, top, reserve) {
  const available = window.innerHeight - top - reserve;
  const rows = panelEl.querySelectorAll("tbody tr");
  const borderAllowance = panelEl.offsetHeight - panelEl.clientHeight;
  if (rows.length === 0) {
    panelEl.style.maxHeight = `calc(100vh - ${Math.round(top)}px - ${Math.round(reserve)}px)`;
    return;
  }
  let lastFitBottom = null;
  rows.forEach((row) => {
    const bottomOffset = row.getBoundingClientRect().bottom - top;
    if (bottomOffset <= available) lastFitBottom = bottomOffset;
  });
  if (lastFitBottom == null) {
    // Not even one body row fits: show through the header only rather than clip a partial row.
    const theadEl = panelEl.querySelector("thead");
    lastFitBottom = theadEl ? theadEl.getBoundingClientRect().bottom - top : 0;
  }
  panelEl.style.maxHeight = `${Math.floor(lastFitBottom + borderAllowance)}px`;
}

// Keeps the table's own scroll area sized to whatever room is actually left below it, instead of a
// fixed CSS height that only fit one particular window size (👁 visual-qa: at 1366x768 a fixed height
// left just four rows visible). Every ".scroll-panel" (the rankings table plus the Projections/
// Ownership tabs' tables) gets the same treatment.
function adjustScrollPanels() {
  document.querySelectorAll(".scroll-panel").forEach((panelEl) => {
    const top = panelEl.getBoundingClientRect().top;
    // The rankings table's legend line sits right below .table-wrap; if its height isn't reserved here
    // the table claims that room too, slicing the legend and forcing a second page-level scrollbar (👁
    // visual-qa). Every other .scroll-panel has nothing below it, so this only adds for that one.
    let reserve = 16;
    const legend = panelEl.parentElement?.querySelector(".table-legend");
    if (legend) reserve += legend.getBoundingClientRect().height + 8;
    snapPanelMaxHeight(panelEl, top, reserve);
  });
}
window.addEventListener("resize", adjustScrollPanels);

function renderDynamic() {
  const { board, filters, sort, activeTab, loading, boardError } = store.get();

  // Every list below reads the slate on screen's rows (D57): the whole board, or the active second slate's.
  const slateRows = activeSlateRows(board);
  renderTabs(el.tabs, activeTab, onTabClick, favoriteRows(slateRows).length);

  if (!board) {
    // #empty-state lives as a sibling of the five tab panels (not nested inside #rankings-panel), so a
    // board failure or a still-loading board hides every panel and shows the one message regardless of
    // which tab is active — previously a failure while on a non-Rankings tab left that tab's blank
    // panel on screen instead of the error text.
    el.rankingsPanel.hidden = true;
    el.favoritesPanel.hidden = true;
    el.projectionsPanel.hidden = true;
    el.ownershipPanel.hidden = true;
    el.lineupPanel.hidden = true;
    renderEmptyState({ loading, boardError });
    return;
  }
  el.emptyState.hidden = true;
  el.rankingsPanel.hidden = activeTab !== "rankings";
  el.favoritesPanel.hidden = activeTab !== "favorites";
  el.projectionsPanel.hidden = activeTab !== "projections";
  el.ownershipPanel.hidden = activeTab !== "ownership";
  el.lineupPanel.hidden = activeTab !== "lineup";

  if (activeTab === "rankings") {
    const collapsed = getGamestripCollapsed();
    renderGameStrip(el.gamestrip, activeSlateGames(board) ?? [], filters.gameId, onGameClick, {
      collapsed,
      onToggleCollapse: onToggleGamestripCollapse,
    });
    const allRows = slateRows;
    el.ownBanner.textContent = ownBannerText(allRows);
    const filtered = filterRows(allRows, filters);
    const sorted = sortRows(filtered, sort.col, sort.dir);
    const hasNoteColumn = allRows.some((r) => r.note);
    renderTableHead(el.thead, sort, onSortClick, hasNoteColumn);
    renderTableBody(el.tbody, sorted, tableCallbacks, hasNoteColumn);
    const activeGame = filters.gameId ? (board.slate?.games ?? []).find((g) => g.id === filters.gameId) : null;
    updateFilterSummary(el.filterbar, {
      filteredCount: filtered.length,
      totalCount: allRows.length,
      activeGameLabel: activeGame ? `${activeGame.away} @ ${activeGame.home}` : null,
      onClearGame: () => store.setFilters({ gameId: null }),
    });
  } else if (activeTab === "favorites") {
    // Every starred player on the slate; the Rankings filters and the projection floor do not apply.
    renderFavoritesPanel(el.favorites, slateRows, tableCallbacks, slateRows.some((r) => r.note));
  } else if (activeTab === "projections") {
    renderProjectionsPanel(el.projectionsPanel, board, sourceCallbacks);
  } else if (activeTab === "ownership") {
    renderOwnershipPanel(el.ownershipPanel, board, sourceCallbacks);
  } else if (activeTab === "lineup") {
    renderLineupPanel(el.lineupPanel);
  }

  adjustScrollPanels();
}

store.subscribe(renderDynamic);

wireUpload(
  { csvInput: el.csvInput, uploadInfo: el.uploadInfo, statusEl: el.status, slateLine: el.slateLine, pillsRow: el.pillsRow },
  {
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

wireThemeToggle(el.themeToggleBtn);

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
