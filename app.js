// Entry point: wires the DOM to the store and the renderers in public/js/*.js. Kept deliberately
// thin — every screen concern lives in its own module.
import {
  store,
  filterRows,
  defaultFilters,
  activeSlate,
  activeSlateRows,
  activeSlateGames,
  slateDisplayName,
  sortForBoard,
  DEFAULT_SORT,
} from "./js/state.js";
import { createViewMemory, uniqueTeams } from "./js/classic-view-memory.js"; // A9: the filters and the sort per slate
import {
  getBoard,
  getSlate,
  postRefresh,
  putOverrides,
  deleteAllOverrides,
  deleteOverride,
  postProjectionsPaste,
  postMode,
} from "./js/api.js";
import { modeStampText, twoGunCoverageText, renderPills, renderSlateLine, wireUpload, wireRefresh, wireThemeToggle, wireThemeSwitch, secondSlateSavedText, renderModeBox, uploadStatusSetter, entriesUploadedHandler, paintSourcesLink, wireSourcesLink, wireTrackedLink } from "./js/header.js";
import { uploadEntriesText, setUploadRouter } from "./js/entries-wire.js"; // Adam 2026-10-18: one upload for every DraftKings export
import { showdownKeyFromHash, showdownRowById, showdownBoardAsOf, showdownBoardNow } from "./js/showdown/view.js";
import { configureShowdown, setRouteDkFile, uploadShowdownText, uploadShowdownEntriesText, renderModeRowNow, renderShowdownTabNow, loadShowdownList, applyMode } from "./js/app-showdown.js";
import { adjustScrollPanels } from "./js/scroll-panels.js";
import { normalizeBoard } from "./js/normalize.js";
import { applyGrades, rowsGradedForView } from "./js/grade.js";
import { favoriteRows } from "./js/favorites.js";
import { toggleStarredQbOnly, starredQbViewNow, togglePoolOnly, clearPoolOnly, setPoolRowError, hydrateOptimizer, lineupsCountNow as optimizerLineupsCount, opt as optimizerState } from "./js/lineup.js";
import { setTabSwitchGate } from "./js/lineup-tabs.js"; // Part F: a GPP | Cash click waits for that tab's board
import { makeTabBoards, otherTab, tabWord } from "./js/showdown/tab-boards.js"; // Part F: the Showdown's per-tab boards and numbered flows
import { tabResetQuestion } from "./js/showdown/filter-bar.js"; // Part F: Reset all's question names the tab it clears, the same words as Showdown's
import { renderGameStrip, getGamestripCollapsed, setGamestripCollapsed } from "./js/gamestrip.js";
import { renderFilterBar, updateFilterSummary, showButtonError, hasAnyOverride } from "./js/filterbar.js";
import { renderTabs, isSourcesTab, sourcesTabToOpen, shownTab, renderProjectionsPanel, renderOwnershipPanel, renderLineupPanel, renderEntriesPanel } from "./js/tabs.js";
import { renderSourcesPage, APPLIED_ALL_EVENT } from "./js/sources-page.js"; // the one Sources page (Adam 2026-10-18), shared with the Showdown view
import { initExpand, syncExpandUi } from "./js/expand.js";
import { makeFilterDebounce } from "./js/filter-debounce.js";
import { initPlayerCard } from "./js/player-card.js";
import { delegateBumpClicks, bumpPatch } from "./js/bump-control.js"; // Adam 2026-10-22: ± bump
import { delegateRowReset } from "./js/row-reset.js"; // B12: the pool's row reset (typed numbers and bump)
import { stickyHeights } from "./js/build-notice.js"; // A15: the sticky stack's heights, the notice a layer of it
import { staleLineText, ownCoverageLine } from "./js/data-as-of.js"; // item 7: the main view's one short stale line; the rest is the Sources page's Data as of block

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
  status: document.getElementById("status"),
  tabs: document.getElementById("tabs"),
  sourcesBtn: document.getElementById("sources-btn"), // Adam 2026-10-18: the header link to the Sources view
  sourcesPanel: document.getElementById("sources-panel"),
  slateNote: document.getElementById("slate-note"),
  projectionsPanel: document.getElementById("projections-panel"),
  ownBanner: document.getElementById("own-banner"),
  ownershipPanel: document.getElementById("ownership-panel"),
  lineupPanel: document.getElementById("lineup-panel"),
  lineupMount: document.getElementById("lineup-mount"), // the Optimizer's redrawn part inside #lineup-panel (step 4); the strip, filter bar and ranked list around it are static
  showdownPanel: document.getElementById("showdown-panel"), // ChatGPT wish t, Adam 2026-10-17
  entriesPanel: document.getElementById("entries-panel"), // rules repo 2026-10-17: Entries is its own tab
  emptyState: document.getElementById("empty-state"),
  gamestrip: document.getElementById("gamestrip"),
  filterbar: document.getElementById("filterbar"),
};

// The Showdown module (public/js/app-showdown.js) reaches back for the element map and these three functions.
configureShowdown({ el, renderFilterBarNow, renderDynamic, renderSlateChrome, syncPageLook });

function findRow(id) {
  return store.get().board?.rows.find((r) => String(r.id) === String(id));
}

function setStatusMessage(text, isError) {
  el.status.textContent = text;
  el.status.className = isError ? "status error" : "status";
}

const setUploadStatus = uploadStatusSetter({ statusEl: el.status, sdStatusEl: () => document.getElementById("sd-status"), showdownOn: () => Boolean(showdownKeyFromHash()) });

// Part F: the tab whose board is on screen: Cash only while the Optimizer or Lineups tab is up with the Cash tab chosen; every other screen (Sources, Projections, Ownership, Entries) reads GPP's, the board published and ranked.
const shownBoardTab = () => ((store.get().activeTab === "lineup" || store.get().activeTab === "lineups") && optimizerState.mode === "cash" ? "cash" : "gpp");
// A board's page shape (normalize.js, grade.js), once as it lands.
function shapeBoard(raw) {
  if (!raw?.ok) return raw;
  const data = normalizeBoard(raw);
  data.rows = applyGrades(data.rows ?? []);
  return data;
}
// Every write path (star, reset, edit, reset-all, source change, paste, refresh) shares this: on
// success the whole board is reloaded as usual; on failure (a thrown network error, or a response that
// came back but isn't ok) a plain message goes into #status and, when a row id is given, exactly that
// row is redrawn to its last-known-good state so a still-open input is never left dangling.
// A3 (round 3 fixes): writes are numbered as they start; an answer older than one already painted is not painted (its board is the older one),
// so a slow first answer can never put the screen back over a newer one. A refusal is still said.
// Every board read is numbered too (write-runner.js): a read that began before a write cannot paint over it, and a dropped older write answer is followed by one fresh read.
// Part F: each tab (GPP, Cash) keeps its own board and numbered flow (showdown/tab-boards.js): a board answer is kept for the tab it was asked for and painted only while that tab is on screen, so a late Cash answer never paints over GPP's.
const CLASSIC_KEY = "main-slate"; // tab-boards.js is keyed by game; the classic slate is one key
const tabBoards = makeTabBoards({
  read: (_key, tab) => getBoard(tab),
  shape: shapeBoard,
  shownTab: shownBoardTab,
  show: (board, tab, _key, n) => handleBoardLoaded(board, tab, n),
  fail: (text, rowId) => failWrite(text, rowId),
});
tabBoards.setKey(CLASSIC_KEY);
/** A write that answers a board (`send(tab)` makes the request) on the tab on screen (a typed number, a bump, a reset); `shared` for a star, kept once for both tabs, and for a change every board reads (`postMode`), which re-reads the other tab. */
const writeOnTab = (send, label, { shared = false, rowId } = {}) => tabBoards.write(shownBoardTab(), (_key, tab) => send(tab), label, { shared, rowId });
// A read through the shown tab's flow (it paints unless newer answers were painted meanwhile; `okOnly` keeps the last good board on a bad answer), the other tab's read alongside so a tab switch finds it kept.
function loadBoard(opts) {
  const tab = shownBoardTab();
  tabBoards.reread(otherTab(tab));
  return tabBoards.load(tab, opts);
}

// A refused or lost write is said in the status line and, when it was for a row, beside that row (the project's rule), in red. The pool redraws from the board already in the store (as it stood before
// the failed edit), so a box left open is never left dangling (lineup.js setPoolRowError).
function failWrite(text, rowId) {
  setStatusMessage(text, true);
  if (rowId == null) return;
  setPoolRowError(rowId, text);
}

function handleBoardFailure(raw) {
  const code = raw?.error?.code ?? "UNKNOWN";
  const message = raw?.error?.message ?? "Something went wrong.";
  store.set({ board: null, boardError: { code, message }, loading: false });
  renderPills(el.pillsRow, { warnings: [] }); // no board, so no warning chips (the source chips are off the classic header, C30)
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

/** The board `tab` on screen (kept by tabBoards, shaped by shapeBoard). `n`: its flow number, the newer-answer check after the wait for the slate's warnings. */
async function handleBoardLoaded(data, tab = "gpp", n = null) {
  if (!data || !data.ok) {
    handleBoardFailure(data);
    return;
  }
  // Board responses don't carry warnings (only GET /api/slate does, PROJECT.md Part 4); fetch them
  // best-effort so a failure here never blocks the board itself from rendering.
  try {
    const slateResp = await getSlate();
    data.warnings = slateResp?.ok ? slateResp.warnings ?? [] : [];
  } catch (e) {
    console.warn("The slate's warnings could not be read; the board shows none:", e);
    data.warnings = [];
  }
  if (n !== null && !tabBoards.current(tab, n)) return; // a newer write's answer was taken while this one waited for the slate: the newer board stands
  if (tab !== shownBoardTab()) return; // the other tab was chosen meanwhile; this board is kept for it (tabBoards)
  setStatusMessage("", false);
  // A sort on a TwoGun column falls back to Proj high to low once the board is not in TwoGun mode (state.js).
  store.set({ board: data, boardError: null, loading: false, sort: sortForBoard(store.get().sort, data) });
  renderStatic(data);
}

// Part F: the board on screen follows the tab: a kept board comes on screen at once (the filter bar's Reset all follows its typed numbers); a tab not read yet is read and painted when it lands (tab-boards.js).
function syncShownBoard() {
  const tab = shownBoardTab();
  const kept = tabBoards.board(tab);
  if (kept?.ok) {
    if (kept === store.get().board) return;
    kept.warnings ??= store.get().board?.warnings ?? []; // the salary file's warnings are the same on both tabs
    store.set({ board: kept, boardError: null, sort: sortForBoard(store.get().sort, kept) });
    renderStatic(kept);
  } else {
    tabBoards.reread(tab);
  }
}

// A GPP | Cash click (optimizer standard Part F; the Showdown's gate): a tab whose board is kept shows at once; otherwise it is read first, the switch waits for it and a failure says so, the old tab staying.
setTabSwitchGate((next, apply) => {
  const switchTo = () => {
    apply();
    syncShownBoard();
  };
  if (tabBoards.board(next)?.ok) return switchTo();
  const loading = `Loading the ${tabWord(next)} tab's board...`;
  setStatusMessage(loading, false);
  tabBoards.reread(next).then((raw) => {
    if (el.status.textContent === loading) setStatusMessage("", false);
    if (tabBoards.board(next)?.ok) return switchTo();
    setStatusMessage(`Could not load the ${tabWord(next)} tab's board: ${raw?.error?.message ?? "the server did not return it"}. The ${tabWord(otherTab(next))} tab stays on screen.`, true);
  });
});

// Optimizer-first step 4: the typed boxes (search, salary min and max) reach the store once typing pauses (public/js/filter-debounce.js,
// 150 ms): a keystroke redraws both 525-row lists, about 300 ms. renderFilterBarNow flushes first, so a rebuild never loses typed letters.
const typedFilters = makeFilterDebounce({ apply: (patch) => store.setFilters(patch) });

const filterCallbacks = {
  onPosChange: (pos) => store.setFilters({ pos }),
  onTeamToggle: (abbr) => {
    const teams = new Set(store.get().filters.teams);
    if (teams.has(abbr)) teams.delete(abbr);
    else teams.add(abbr);
    store.setFilters({ teams });
  },
  onSalaryChange: ({ min, max }) => typedFilters.schedule("salary", { salaryMin: min, salaryMax: max }),
  onSearchChange: (text) => typedFilters.schedule("search", { search: text }),
  onStarredToggle: (bool) => store.setFilters({ starredOnly: bool }),
  onStarredQbToggle: toggleStarredQbOnly, // the Optimizer's Starred QBs only rule, drawn as a chip in this bar (standard C12)
  starredQbView: starredQbViewNow,
  onPoolOnlyToggle: togglePoolOnly, // the Locked and Excluded chips narrow the table to those men (lineup-pool.js)
  onShowAllToggle: (bool) => store.setFilters({ showAllPlayers: bool }),
  onClearFilters: () => {
    typedFilters.cancelAll(); // a search or salary typed just before Clear filters never comes back after it
    clearPoolOnly();
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
  resetQuestion: () => (el.lineupPanel.hidden ? null : tabResetQuestion(shownBoardTab())),
  onResetOverrides: async () => {
    const data = await writeOnTab((tab) => deleteAllOverrides(tab), "the reset"); // Part F: the tab on screen's numbers only
    if (data === null) showButtonError(document.getElementById("reset-overrides-btn"), el.status.textContent); // A refusal is said beside the button too
  },
};

function onGameClick(gameId) {
  const current = store.get().filters.gameId;
  store.setFilters({ gameId: current === gameId ? null : gameId });
}

const tableCallbacks = {
  // Part F: stars are kept once for both tabs (`shared` re-reads the other tab's board); a typed number, a bump and a row's reset are the tab on screen's own.
  onToggleStar: async (id) => {
    const row = findRow(id);
    await writeOnTab((tab) => putOverrides({ stars: { [id]: !row?.starred } }, tab), undefined, { rowId: id, shared: true });
  },
  // B12 (round 3): a row's reset clears his typed numbers and his bump together (DELETE /api/overrides/<id>; the site's stand-in does the same in the browser).
  onResetRow: (id) => writeOnTab((tab) => deleteOverride(id, tab), "the reset", { rowId: id }), // the board it answers, null when refused
  onEditValue: async (id, field, value) => {
    await writeOnTab((tab) => putOverrides({ [field]: { [id]: value } }, tab), undefined, { rowId: id });
  },
  // Adam 2026-10-22: ± bump from an Optimizer pool row (bumpPatch: 0 steps is sent as null, which removes it). Applied as a star
  // toggle's answer is; the answer (null when refused) goes back so the pair is re-enabled only after a refusal.
  onBump: (id, steps) => writeOnTab((tab) => putOverrides(bumpPatch(id, steps), tab), "the projection bump"),
};
// The pool's ± pairs are redrawn with the Optimizer's mount, so one listener on the mount serves them all (bump-control.js).
delegateBumpClicks(el.lineupMount, { rowOf: findRow, onBump: tableCallbacks.onBump });
// B12: the pool's row reset (the x beside a projection that carries a typed number or a bump); a refusal is said under his name in the pool.
delegateRowReset(el.lineupMount, {
  onReset: async (id) => {
    const data = await tableCallbacks.onResetRow(id);
    if (data === null) setPoolRowError(id, el.status.textContent);
  },
});

// The Sources page saves its own choices (public/js/sources-page.js); this is the board repaint it asks for afterwards: a plain
// board read, so nothing is re-downloaded from a source. A board that cannot be read leaves the one on screen and says so under the row.
async function repaintAfterSourceSave() {
  const board = await loadBoard({ okOnly: true });
  if (!board?.ok) throw new Error(board?.error?.message ?? "the server did not return the board");
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
          await loadBoard();
        } catch (e) {
          // A board reload failing after a paste is not fatal to the paste result; logged, never silent (G62).
          console.warn("Board reload after a paste failed:", e);
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
  if (tabKey !== store.get().activeTab) window.scrollTo(0, 0); // Adam 2026-11-08: a tab switch lands at the top, where the Lineups results start
  store.set({ activeTab: tabKey });
  syncShownBoard(); // Part F: the Optimizer on Cash shows Cash's board, every other screen GPP's
}

// The header's Sources link opens the Sources page with the table last shown under it (Projections the first time).
let lastSourcesTab = null;
function onSourcesOpen() {
  store.set({ activeTab: sourcesTabToOpen(store.get().activeTab, lastSourcesTab) });
  syncShownBoard();
}

function onToggleGamestripCollapse() {
  const collapsed = !getGamestripCollapsed();
  setGamestripCollapsed(collapsed);
  store.set({}); // no state change of its own; just re-triggers renderDynamic to pick up the new value
}

function renderStatic(board) {
  renderSlateLine(el.slateLine, board.slate, { slateKey: store.get().activeSlateKey ?? null });
  // Optimizer standard C30 (2026-11-03): the per-source chips (cached, failed, findings, Stokastic) are off the classic header; the salary file's warning chips stay.
  // Each source's state is on the Sources page. The branch header-rows-wip holds their replacement and stays unmerged. The Showdown header (showdown/view.js) is unchanged.
  renderPills(el.pillsRow, { warnings: board.warnings });
  // TwoGun mode switch and board-stamp pill (merge plan 2026-10-15): a flip answers the recomputed board.
  renderModeBox(el.classicHeader, board.mode, { onSwitch: (mode) => tabBoards.write("gpp", () => postMode(mode), "the mode", { shared: true }) }); // answers GPP's board; Cash's is read again with it
  renderFilterBarNow(board);
  renderSlateChrome(); // the header label and the one-line note follow the slate on screen
  renderModeRowNow(); // the "Main slate" tile's game count depends on this board
  renderDynamic();
}

// The filter bar's team chips are the teams of the slate on screen (D57: the active second slate's games, or
// every game on the main slate). "Reset all overrides" clears the whole week's typed numbers (D72), so whether it has anything to do
// is still judged on the whole board, not just the slate on screen.
function renderFilterBarNow(board) {
  typedFilters.flush(); // letters still waiting out the pause reach the store first, so the rebuilt boxes show them (🔵 step 4)
  renderFilterBar(el.filterbar, uniqueTeams(activeSlateGames(board)), store.get().filters, filterCallbacks, hasAnyOverride(board.rows, board.siteTypedNumbers));
}

// Second slates (D57): the header label next to the title ("MAIN SLATE" / "AFTERNOON SLATE") and the one plain
// line under the tab bar that says what the second slate is and whose numbers it shows.
function renderSlateChrome() {
  const board = store.get().board;
  const slate = activeSlate(board);
  const tag = el.classicHeader?.querySelector(".mode-tag");
  if (tag) tag.textContent = slate ? slateDisplayName(slate) : "DraftKings classic";
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

/** The approved look's page (dark background, full width) belongs to the classic Optimizer and Lineups tabs; Entries, Sources and the Showdown screens keep the app's own page (style.css). */
function syncPageLook() {
  const tab = shownTab(store.get().activeTab);
  document.body.classList.toggle("nl-page", !showdownKeyFromHash() && (tab === "lineup" || tab === "lineups"));
  paintThemeSwitch(); // the Showdown header's button sets the same choice
}

function renderEmptyState({ loading, boardError }) {
  el.emptyState.hidden = false;
  el.gamestrip.innerHTML = "";
  el.filterbar.innerHTML = "";
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
// Expand / Minimize on the player tables (public/js/expand.js); minimizing re-sizes the table for its place.
initExpand({ onLayout: adjustScrollPanels });
// The player card: a click on any player's name opens his page (public/js/player-card.js); a showdown name reads the showdown board's row.
initPlayerCard({ findRow: (id, sd) => (sd ? showdownRowById(id) : findRow(id)), sdKey: showdownKeyFromHash, boardAsOf: (sd) => (sd ? showdownBoardAsOf() : store.get().board?.generatedAt), boardOf: (sd) => (sd ? showdownBoardNow() : store.get().board) });

// The Optimizer screen's static parts (Optimizer-first step 4: what the Rankings tab drew, now inside #lineup-panel): the game strip, the ownership banner and the filter bar's count. The player table
// is the pool, drawn with the rest of the Optimizer's part (lineup-pool.js; the ranked list is retired, optimizer standard C9, C17). The filter bar itself is drawn only by renderFilterBarNow (a board
// load or Clear filters), never here, so a keystroke in its search box keeps the box, its value and its caret.
function renderRankedParts(board, filters, slateRows) {
  renderGameStrip(el.gamestrip, activeSlateGames(board) ?? [], filters.gameId, onGameClick, {
    collapsed: getGamestripCollapsed(),
    onToggleCollapse: onToggleGamestripCollapse,
  });
  const allRows = rowsGradedForView(slateRows, filters.pos, board.rows); // D33: the FLEX view pools RB, WR and TE
  // Item 7 (Adam 2:48 PM 11-11): no provenance prose in the main view. One short line only when a feed is stale or missing, or the site's saved changes could not be read (G62);
  // the stamps, the Own coverage and the injury report's counts are on the Sources page's Data as of block (data-as-of.js).
  el.ownBanner.textContent = [staleLineText(board, { games: activeSlateGames(board) }), ...(board.tabNotes?.favorites ?? []), board.siteEditsNote].filter(Boolean).join(" · "); // favorites: the overrides file is unreadable, an error line that stays
  el.ownBanner.hidden = !el.ownBanner.textContent;
  const filtered = filterRows(allRows, filters);
  const activeGame = filters.gameId ? (board.slate?.games ?? []).find((g) => g.id === filters.gameId) : null;
  updateFilterSummary(el.filterbar, {
    filteredCount: filtered.length,
    totalCount: allRows.length,
    starredCount: favoriteRows(allRows).length, // the one copy of "starred": unfiltered and unfloored (D53; 🔵 2026-10-21)
    activeGameLabel: activeGame ? `${activeGame.away} @ ${activeGame.home}` : null,
    onClearGame: () => store.setFilters({ gameId: null }),
  });
}

function renderDynamic() {
  const { board, filters, loading, boardError } = store.get();
  const activeTab = shownTab(store.get().activeTab); // a tab the page does not draw (Entries on the site) shows the Optimizer

  // Every list below reads the slate on screen's rows (D57): the whole board, or the active second slate's.
  const slateRows = activeSlateRows(board);
  renderTabs(el.tabs, activeTab, onTabClick, { lineupsCount: optimizerLineupsCount() });
  if (isSourcesTab(activeTab)) lastSourcesTab = activeTab;
  paintSourcesLink(el.sourcesBtn, isSourcesTab(activeTab));
  syncPageLook();

  if (!board) {
    // #empty-state lives as a sibling of the tab panels (not nested inside #lineup-panel), so a
    // board failure or a still-loading board hides every panel and shows the one message regardless of
    // which tab is active — previously a failure while on another tab left that tab's blank
    // panel on screen instead of the error text.
    el.sourcesPanel.hidden = true;
    el.projectionsPanel.hidden = true;
    el.ownershipPanel.hidden = true;
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
  el.sourcesPanel.hidden = !isSourcesTab(activeTab);
  el.projectionsPanel.hidden = activeTab !== "projections";
  el.ownershipPanel.hidden = activeTab !== "ownership";
  el.lineupPanel.hidden = activeTab !== "lineup" && activeTab !== "lineups";
  el.lineupPanel.classList.toggle("lineups-only", activeTab === "lineups"); // the Lineups tab is the Optimizer panel with only its results showing (style.css)
  el.showdownPanel.hidden = activeTab !== "showdown";
  el.entriesPanel.hidden = activeTab !== "entries";

  if (activeTab === "lineup" || activeTab === "lineups") {
    // One screen (Optimizer-first step 4): the strip, banner and ranked list, then the Optimizer's own part in its mount between them.
    renderRankedParts(board, filters, slateRows);
    renderLineupPanel(el.lineupMount, tableCallbacks);
  } else if (isSourcesTab(activeTab)) {
    // The Sources page (always the main slate's choices, D57), then the Projections or Ownership table under its Players heading.
    const asOf = { games: activeSlateGames(board), lines: [modeStampText(board.mode), twoGunCoverageText(board.mode), ownCoverageLine(slateRows), board.injuryNote].filter(Boolean) }; // item 7: what the Optimizer's banner and the line under the top bar said, here in short lines
    renderSourcesPage(el.sourcesPanel, { board, slate: "main", showdown: false, activeKey: activeTab, onPlayersTab: onTabClick, onChanged: repaintAfterSourceSave, asOf });
    if (activeTab === "projections") renderProjectionsPanel(el.projectionsPanel, board, sourceCallbacks);
    else renderOwnershipPanel(el.ownershipPanel, board, sourceCallbacks);
  } else if (activeTab === "showdown") {
    renderShowdownTabNow();
  } else if (activeTab === "entries") {
    renderEntriesPanel(el.entriesPanel);
  }

  syncExpandUi();
  adjustScrollPanels();
  syncFilterbarHeight();
}

// 🔵 step 4: the sticky filter bar covers the top of the window, so a scroll to an element of the Optimizer tab (Build's results, the
// ?scrollTo= dev link) must land below it: style.css gives every element with an id in #lineup-panel a scroll-margin-top of
// --filterbar-h, kept here to the bar's height while it sticks (0 where it does not: another tab, or a phone, where it is static).
function syncFilterbarHeight() {
  const poolTop = document.getElementById("pool-top");
  const sticky = !el.lineupPanel.hidden && poolTop.isConnected && getComputedStyle(poolTop).position === "sticky";
  const notice = document.getElementById("build-notice");
  const { bar, total } = stickyHeights({ sticky, barHeight: el.filterbar.getBoundingClientRect().height, noticeShown: Boolean(notice) && !notice.hidden, noticeHeight: notice?.getBoundingClientRect().height }); // A15: the build notice is a layer of the stack, so the head and the band sit under it too
  // The top bar is sticky at the top of the window, so every layer under it starts at its height (--tabs-h).
  const sticks = getComputedStyle(el.classicHeader).position === "sticky";
  const tabsH = sticks ? el.classicHeader.getBoundingClientRect().height : 0;
  if (tabsH || !sticks) document.documentElement.style.setProperty("--tabs-h", `${tabsH}px`); // 0 and sticking = this header is hidden (a Showdown is on screen, which keeps --tabs-h itself)
  el.lineupPanel.style.setProperty("--filterbar-bar-h", `${bar + tabsH}px`);
  el.lineupPanel.style.setProperty("--filterbar-h", `${total + tabsH}px`);
}
window.addEventListener("resize", syncFilterbarHeight);
// A15: the sticky layers under the filter bar (the pool's head, the lineup band, the build notice) sit at its height, which changes as its chips wrap or the count line appears; the notice's own height counts too.
if (typeof ResizeObserver !== "undefined") {
  const ro = new ResizeObserver(syncFilterbarHeight);
  ro.observe(el.filterbar);
  ro.observe(el.classicHeader); // the top bar wraps on a narrow window: --tabs-h follows it
  const notice = document.getElementById("build-notice");
  if (notice) ro.observe(notice);
}

// A9 (round 5): the filters and the sort are remembered per slate in the browser's one memory (classic-view-memory.js); subscribed before the screen's own draw, so the screen draws what was remembered.
store.subscribe(createViewMemory({ store, activeSlate, activeSlateGames, defaultFilters, sortForBoard, defaultSort: DEFAULT_SORT, afterRestore: (board) => renderFilterBarNow(board) }));
store.subscribe(renderDynamic);

const { handleFile } = wireUpload(
  { csvInput: el.csvInput, uploadInfo: el.uploadInfo, slateLine: el.slateLine, pillsRow: el.pillsRow },
  {
    setStatus: setUploadStatus,
    onShowdownText: uploadShowdownText,
    onShowdownEntriesText: uploadShowdownEntriesText, // Showdown Entries plan 2026-10-20 (step 4): the game's Entries tab, not classic's
    // Adam 2026-10-18: an entries file loaded from any button shows the Entries tab (🔵: from a showdown screen, the main page first).
    onEntriesText: entriesUploadedHandler({
      upload: uploadEntriesText,
      showdownOn: () => Boolean(showdownKeyFromHash()),
      clearHash: () => { window.location.hash = ""; },
      showEntriesTab: () => onTabClick("entries"),
    }),
    onUploaded: async (data) => {
      try {
        await loadBoard();
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

const paintThemeSwitch = wireThemeSwitch(document.getElementById("theme-switch"), { onChange: () => store.set({}) }); // C15: the team logos come in the theme's variant, so every list is drawn again on a switch
wireThemeToggle(document.getElementById("sd-theme-toggle-btn"), { onChange: () => store.set({}) }); // B9: the Showdown header's switch is the same choice; the Showdown screen draws again through the same store signal (showdown/view.js)
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
    // The board read after the refresh is awaited (handleBoardLoaded's last step clears #status, so "Refreshed." must come after it, standard C14),
    // and a board that cannot be read throws, so the line reads "Could not refresh: ..." and the last good board stays on screen.
    await repaintAfterSourceSave();
  },
});

async function init() {
  store.set({ loading: true, boardError: null });
  hydrateOptimizer(); // a page opened on the Cash tab asks for that tab's board first (Part F)
  try {
    await loadBoard();
  } catch (e) {
    handleBoardFailure({ ok: false, error: { code: "NETWORK_ERROR", message: e.message }, stale: [] });
  }
}

init();

window.addEventListener("hashchange", applyMode);
loadShowdownList();
applyMode();
