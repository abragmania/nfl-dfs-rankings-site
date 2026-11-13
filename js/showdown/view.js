// Showdown mode controller (D39/D40): owns the showdown-only DOM (header band, game line, tabs, four
// panels), fetches and normalizes the showdown board, and renders whichever tab is active. Mounted from
// app.js, which owns the mode row and the classic-vs-showdown visibility toggle (app.js reads/writes
// location.hash's "#sd=<key>" itself); this module reacts to whatever key it is told to show.
// Two tabs (Optimizer, Entries; the Rankings tab folded into the Optimizer 2026-10-26) plus the Sources view: ONE Sources page
// (public/js/sources-page.js, the same file classic uses) with the Projections or Ownership player table under it, picked by a switch on
// the page (Adam 2026-10-18; tabs.js SOURCE_TABS keys). The Optimizer tab (Adam 2026-10-26 3:22 PM, D81, as classic's step 4): the game
// line and the filter bar (sticky at the window's top) are drawn here, outside #sd-lineup-mount, which lineup.js redraws; the filter bar
// filters the pool (pool.js poolState), so a keystroke in its boxes never destroys a box.
import { getShowdownBoard, postShowdownRefresh, postShowdownProjectionsPaste, supports, isShowdownSampleMode } from "./api.js";
import { resetAllEnabled } from "../row-reset.js";
import { stickyHeights } from "../build-notice.js"; // A15: the sticky stack's heights, the notice a layer of it
import { deleteShowdownOverrides, putShowdownOverrides, optimizerLive, optimizerTabFor, setTabSwitchGate } from "./optimizer.js";
import { delegateStatusClicks, statusPatch } from "../status-switch.js"; // Adam 2026-11-12: the Sources page's Player status card
import { makeTabBoards, otherTab, tabWord } from "./tab-boards.js"; // Part F: the GPP and Cash tabs' own boards
import { renderPills, renderSlateLine, paintSourcesLink, wireSourcesLink, modePillHtml } from "../header.js";
import { isSourcesTab, sourcesTabToOpen, onSitePage } from "../tabs.js";
import { renderSourcesPage, sectionSources } from "../sources-page.js";
import { escapeHtml } from "../format.js";
import { gameTileHtml } from "./game-tile.js"; // the one game tile, the classic strip's
import { store } from "../state.js";
import { sdShowAll, setSdShowAll, onSdShowAllChange } from "./show-all.js"; // C24: the Showdown's own Show all players
import { staleLineText, savedCopiesLine, selfCheckLines } from "../data-as-of.js"; // item 7: one short stale line under the game line; Board, Injuries, Pulled and Lock are on the Sources page
import { makeFilterDebounce } from "../filter-debounce.js"; // the typed boxes wait out classic's 150 ms pause
import { syncExpandUi } from "../expand.js";
import { adjustScrollPanels } from "../scroll-panels.js";
import { renderShowdownTabs, renderShowdownProjectionsPanel, renderShowdownOwnershipPanel, renderShowdownLineupPanel, renderShowdownEntriesPanel, renderShowdownLineupsPanel, shownShowdownTab } from "./tabs.js";
import { keptCount, onKeptChange } from "./lineups-store.js"; // the Lineups tab's count and its redraw when a build is kept
import { setTabOpener } from "./lineups-nav.js";
import { repaintShowdownPool } from "./lineup.js";
import { poolState, poolCountText, poolNoteText, ownTotalsLine, poolMarkCounts, poolMarksLive, poolOnlyView } from "./pool.js";
import { restoreView } from "./view-memory.js"; // A9: the pool's filters and sort per game
import { filterBarHtml, wireFilterBar, takeBarFocus, restoreBarFocus, tabResetQuestion, paintMarkChips } from "./filter-bar.js"; // the filter bar above the builder (the classic bar's rows: pool switch, team and position chips, search, salary range, Min Proj)
import { figuresPillHtml } from "./figures-label.js"; // the pill naming the sources this game's board reads (Adam 2026-10-20), kept in the header's hidden source-state box
import { normalizeBoard } from "./board-shape.js"; // the board's pure shaping (moved for the 600-line cap)

const state = {
  activeTab: "lineup", // the Optimizer (the Rankings tab is retired, tabs.js RETIRED_SHOWDOWN_TABS)
  lastSourcesTab: null, // the Sources page's table (projections or ownership) shown last, which the Sources button reopens (Adam 2026-10-18)
  board: null, // the last successfully loaded board; never cleared just because a reload or a switch to
  // a different key is in flight (🔵 finding: the page must never blank a good board out from under Adam).
  boardKey: null, // the key `board` actually belongs to
  requestedKey: null, // the key currently asked for, even if its load hasn't resolved (or failed) yet —
  // Refresh reads this so it still works after a first load that failed and left `board` null.
  loading: false,
  error: null, // only shown when there is no good board to fall back to; a failure while a good board is
  // already on screen is reported in #sd-status instead (see loadBoard).
  uploadStale: null, // {key, ids}: the last upload's saved copies for that game, for the Sources page's Data as of (showUploadPills)
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
  const found = state.board?.rows?.find((r) => String(r.id) === String(id) || (r.cptId != null && String(r.cptId) === String(id)));
  const g = state.board?.game;
  if (!found) return null;
  const row = found; // the board's row, as Build counts him (a typed number always wins, Adam 2026-11-12)
  return row.gameId || !g?.away || !g?.home ? row : { ...row, gameId: `${g.away}@${g.home}` }; // the board row's figures on every tab, as the Lineup tab's slots show them
}
let boardShownHook = null;
/** app-showdown.js registers what runs when a game's first board lands (the top bar's Main slate / Showdown switch is drawn again, naming the game). */
export function setBoardShownHook(fn) {
  boardShownHook = typeof fn === "function" ? fn : null;
}
/** The game of the board on screen as the switch names it ("WAS@NYG"), or null before a board is read. */
export const showdownGameLabel = () => {
  const g = state.board?.game;
  return g?.gameId ?? (g?.away && g?.home ? `${g.away}@${g.home}` : null);
};
export const showdownBoardAsOf = () => state.board?.generatedAt ?? null;
export const showdownBoardNow = () => state.board ?? null; // the player card names the board's own source lines (A8)

const els = {
  status: document.getElementById("sd-status"),
  tabs: document.getElementById("sd-tabs"),
  sourcesPanel: document.getElementById("sd-sources-panel"),
  sourcesBtn: document.getElementById("sd-sources-btn"),
  salaryBtn: document.getElementById("sd-salary-btn"),
  slateLine: document.getElementById("sd-slate-line"), // Season, Week and Cap of this game's slate, in the shared header
  header: document.getElementById("classic-header"),
  pillsRow: document.getElementById("sd-pills-row"),
  figuresPill: document.getElementById("sd-figures-pill"),
  refreshBtn: document.getElementById("sd-refresh-btn"),
  gameline: document.getElementById("sd-gameline"),
  stamps: document.getElementById("sd-stamps"),
  filterbar: document.getElementById("sd-filterbar"),
  projectionsPanel: document.getElementById("sd-projections-panel"),
  ownershipPanel: document.getElementById("sd-ownership-panel"),
  lineupPanel: document.getElementById("sd-lineup-panel"),
  lineupMount: document.getElementById("sd-lineup-mount"), // the Optimizer's redrawn part inside #sd-lineup-panel; the game line and the filter bar around it are not
  entriesPanel: document.getElementById("sd-entries-panel"),
  lineupsPanel: document.getElementById("sd-lineups-panel"), // the Lineups tab (lineups-screen.js)
  emptyState: document.getElementById("sd-empty-state"),
  foot: document.getElementById("sd-foot-note"), // the page's foot: the details of a board the site could not read (G64)
};

const MISSING_ON_SITE = "This game's board is not on the site.";
/** The site has no copy of this game's board: a hash for a game that was never published reads a baked file that is not there (status 404). The app's own errors are never this. */
const boardMissingOnSite = (message) => onSitePage() && /\(status 404\)/.test(String(message ?? ""));
const footLines = [];
function setFoot(text) { // "" clears; a sentence is added once (the GPP read and the Cash read of one game can both fail)
  if (!els.foot) return;
  if (!text) footLines.length = 0;
  else if (!footLines.includes(text)) footLines.push(text);
  els.foot.textContent = footLines.length ? `Details: ${footLines.join(" · ")}` : "";
  els.foot.hidden = !footLines.length;
}

// --------------------------------------------------------------------------------------------------------
// Filter (the state and the one call that applies it live in pool.js; the pure filter and sort in board-shape.js)
// --------------------------------------------------------------------------------------------------------

// The typed boxes (search, Min and Max salary, Min Proj) reach the pool once typing pauses (classic's filter-debounce.js, 150 ms): one
// waiting change per box, the last value wins; Clear filters cancels them and a filter bar rebuild flushes them first.
const typedFilters = makeFilterDebounce({ apply: (patch) => { Object.assign(poolState.filters, patch); repaintShowdownPool(); } });

// The filter bar's count, written by the pool after every draw from the same rows it shows (pool.js poolVisibleRows).
function setPoolCount(shown, total) {
  const countEl = els.filterbar?.querySelector("#sd-filter-count");
  if (countEl) countEl.textContent = poolCountText(shown, total);
  paintMarkChips(els.filterbar, poolMarkCounts(state.board), poolOnlyView()); // the Locked and Excluded chips follow the same draw
}

// --------------------------------------------------------------------------------------------------------
// Render
// --------------------------------------------------------------------------------------------------------

// The game's one tile at the top of the Optimizer tab (the classic game strip's tile, game-tile.js: kickoff, total, the two teams with spread and implied total), built from payload.game
// — never re-derived, just the numbers the board already computed.
function renderGameLine() {
  if (!els.gameline) return;
  els.gameline.innerHTML = gameTileHtml(state.board?.game);
}

function renderEmpty() {
  els.emptyState.hidden = false;
  for (const p of [els.sourcesPanel, els.projectionsPanel, els.ownershipPanel, els.lineupPanel, els.lineupsPanel, els.entriesPanel]) if (p) p.hidden = true;
  if (els.stamps) els.stamps.innerHTML = "";
  if (els.slateLine) els.slateLine.textContent = "";
  const missing = !state.loading && boardMissingOnSite(state.error);
  els.emptyState.textContent = state.loading ? "Loading the showdown board…" : missing ? MISSING_ON_SITE : state.error ?? "Could not load this showdown.";
  if (missing) setFoot(state.error);
}

// Drawn on a board load, a tab switch, a chip click or Clear filters, never on a keystroke: the typed boxes only patch the pool
// (through the pause), so a box never loses its caret. A rebuild first flushes the boxes' waiting changes, so it never redraws a box
// from older text. The markup and the wiring are filter-bar.js's.
function renderFilterBar() {
  typedFilters.flush();
  const focused = takeBarFocus(els.filterbar); // item 9: a board answer redraws the bar while he is typing in a box; the box keeps the keyboard and its caret
  const starred = (state.board?.rows ?? []).filter((r) => r.starred).length; // every starred man of the game, unfiltered (D53)
  const marks = poolMarksLive() ? { ...poolMarkCounts(state.board), only: poolOnlyView() } : null; // the Locked and Excluded chips: only where a lock or an exclude can be set
  els.filterbar.innerHTML = filterBarHtml(poolState.filters, state.board?.game, sdShowAll(), resetButton(), starred, marks);
  wireFilterBar(els.filterbar, {
    typed: typedFilters,
    rebuild: renderFilterBar,
    repaint: repaintShowdownPool,
    clearShowAll: () => setSdShowAll(false), // the Showdown's own switch (C24), not classic's
    onResetOverrides: () => writeBoard((key, tab) => deleteShowdownOverrides(key, undefined, tab), "the reset"), // Part F: the tab on screen's numbers only
    resetQuestion: () => (optimizerLive() ? tabResetQuestion(shownTab()) : null),
  });
  restoreBarFocus(els.filterbar, focused);
}

// Item 7 (Adam 2:48 PM 11-11): under the game line only one short line, and only when a feed is a saved copy or missing ("Injuries: saved copy"), with the Sources link;
// the four stamps and the injury report's counts are on the Sources page's Data as of block.
function renderStamps() {
  if (!els.stamps) return;
  const b = state.board;
  // A failed source is broken: it keeps its few words here (the header's pills row is gone, lead 3:10 PM 11-11). Counted from the board's
  // sources as header.js counts one failed: status failed or error, or whole positions missing (A1); the injury report is staleLineText's.
  const failed = b ? (b.sources ?? []).filter((s) => ["failed", "error"].includes(String(s?.status ?? "").toLowerCase()) || (s?.missingPositions?.length ?? 0) > 0).length : 0;
  const stale = b ? [staleLineText(b), failed ? `Sources: ${failed} failed` : ""].filter(Boolean).join(" · ") : "";
  els.stamps.innerHTML = stale ? `<div class="stamps-line stale-line" role="status">${escapeHtml(stale)} <button type="button" class="link-btn sd-figures-link" title="Open the Sources page: when each source was pulled">Sources</button></div>` : "";
  els.stamps.querySelectorAll(".sd-figures-link").forEach((btn) => btn.addEventListener("click", () => openSources()));
}

// The Showdown's Show all players changed (the filter bar's chip, or the one over a Sources table): the screen is drawn again.
onSdShowAllChange(() => {
  if (state.board && document.getElementById("showdown-main")?.hidden === false) render();
});

// A6 (round 3): the Reset all overrides button is drawn where overrides can be written (the app, not the public site or sample mode); enabled while any man has a typed number or a bump.
function resetButton() {
  return supports("overrides") && !isShowdownSampleMode() ? { enabled: resetAllEnabled(state.board) } : null;
}

// The sticky filter bar covers the top of the window, so a scroll to an element of the Optimizer's part (Make's results, the saved
// lineups) lands below it: style.css gives every element with an id in #sd-lineup-mount a scroll margin of --filterbar-h, kept here to
// the bar's height while it sticks (0 where it does not: another tab, or a phone, where it is static). Classic app.js syncFilterbarHeight's rule.
function syncFilterbarHeight() {
  if (!els.lineupPanel || !els.filterbar) return;
  const sticky = !els.lineupPanel.hidden && getComputedStyle(els.filterbar).position === "sticky";
  const notice = document.getElementById("sd-build-notice");
  const { bar, total } = stickyHeights({ sticky, barHeight: els.filterbar.getBoundingClientRect().height, noticeShown: Boolean(notice) && !notice.hidden, noticeHeight: notice?.getBoundingClientRect().height }); // A15: the build notice is a layer of the stack, so the head and the band sit under it too
  // The shared top bar (#classic-header: brand, stamps, tabs, the slate switch) is sticky at the top of the window, so every layer under it starts at its height (--tabs-h), as on the classic page.
  const sticks = Boolean(els.header) && getComputedStyle(els.header).position === "sticky"; // a phone's bar scrolls away with the page
  const tabsH = sticks ? els.header.getBoundingClientRect().height : 0;
  document.documentElement.style.setProperty("--tabs-h", `${tabsH}px`);
  els.lineupPanel.style.setProperty("--filterbar-bar-h", `${bar + tabsH}px`);
  els.lineupPanel.style.setProperty("--filterbar-h", `${total + tabsH}px`);
}
window.addEventListener("resize", syncFilterbarHeight);
if (typeof ResizeObserver !== "undefined") {
  const ro = new ResizeObserver(syncFilterbarHeight);
  const notice = document.getElementById("sd-build-notice");
  if (notice) ro.observe(notice);
  if (els.header) ro.observe(els.header);
}

// After each draw of the Optimizer's part (lineup.js calls it on its own redraws too): the pool's Expand bar (expand.js), its height
// (60% of the window, whole rows, scroll-panels.js) and the sticky bar's height.
function afterLineupDraw() {
  syncExpandUi();
  adjustScrollPanels();
  syncFilterbarHeight();
}

// Applies an already-fetched, already-ok board response as the new current board, gated by the same
// token/key check as a plain load (🔵 findings: use the board that refresh/paste already return instead
// of a second GET; discard a response for a key that's no longer current).
/** A refresh's or a paste's answer for `tab` (number `n`, from tabBoards.begin(tab) before it was sent): painted unless a newer write's answer is already on screen, in which case the board is read
 *  once more and that read painted (write-runner.js runWrite's rule), so a late Refresh answer can never put a typed Proj back. */
function paintAnswer(raw, key, token, n, tab) {
  if (tabBoards.take(tab, n)) return applyBoardResponse(raw, key, token, tab);
  tabBoards.reread(tab);
  return false;
}

/** A board answer for `tab` (absent: the tab on screen): kept for its tab, and painted only while that tab is on screen (tab-boards.js). */
function applyBoardResponse(raw, key, token, tab = optimizerTabFor(key)) {
  if (!isCurrent(token, key)) return false;
  return tabBoards.land(key, tab, raw);
}

// Part F: the tab ("gpp" or "cash") whose board is on screen, for the game the boards are kept for.
const shownTab = () => optimizerTabFor(tabBoards.key());

// Each tab's board and its own numbered flow (tab-boards.js; write-seq.js and write-runner.js makeBoardFlow, the round 4 fix batch's item 10): a write, a read or a refresh is
// numbered as it starts and an answer older than one already painted on that tab is not painted (a read of the board follows it instead), so a slow first answer can never put the
// screen back over a newer one; an answer for the tab not on screen is kept for it, never painted. A refusal or a failure puts the sentence in the status line.
const tabBoards = makeTabBoards({
  read: (key, tab) => getShowdownBoard(key, tab),
  shape: normalizeBoard,
  shownTab,
  show: (board, _tab, key) => {
    const first = state.boardKey !== key;
    state.board = board;
    state.boardKey = key;
    state.error = null;
    state.loading = false;
    setFoot(""); // a board landed: the earlier read details are over
    render();
    if (first) boardShownHook?.(key); // a game's first board: the shared top bar's switch names it (app-showdown.js)
  },
  fail: (text) => {
    if (!state.board && onSitePage()) { // no board on screen on the site (a game never published): the read errors go to the foot, never the main view
      setFoot(text);
      return;
    }
    els.status.textContent = text;
    els.status.className = "status error";
  },
});

// A write from the Optimizer that answers this game's board (a star, a typed number, a note, the ± bump, a revive, a row reset, Reset all): `send(key, tab)` makes the request on the
// tab on screen (Part F: each tab has its own typed numbers; `shared` for a star or a note, which both tabs show). Resolves true when the server took the write, false when it did not.
async function writeBoard(send, label, opts = {}) {
  const data = await tabBoards.write(shownTab(), send, label, opts);
  if (data !== null && els.status.textContent.startsWith(`Could not save ${label}: `)) { // this write's earlier refusal is over; any other line stays
    els.status.textContent = "";
    els.status.className = "status";
  }
  return data !== null;
}
// Adam 2026-11-12: a switch in the Sources page's Player status card writes his In / Out / Auto, kept once for both tabs (as a star).
delegateStatusClicks(els.sourcesPanel, (id, next) => writeBoard((key, tab) => putShowdownOverrides(key, statusPatch(id, next), undefined, tab), "the In / Out setting", { shared: true }));

// Part F: a GPP | Cash click shows that tab's own board at once when it is kept; otherwise it is read first, and the switch waits for it (a failure says so and the tab stays).
// `switched`: a Load's switch (optimizer.js setOptimizerMode), made already; a board not kept yet paints when its read lands (tab-boards.js), a failure is said there.
setTabSwitchGate((next, apply, switched = false) => {
  const key = state.boardKey;
  if (!key || tabBoards.key() !== key) return; // another game is loading: the click waits for its board
  const visit = tabBoards.visit();
  const have = tabBoards.board(next);
  const switchTo = (board) => {
    if (!apply()) return;
    state.board = board;
    render();
  };
  if (have) return switchTo(have);
  if (switched) return void tabBoards.reread(next);
  const loading = `Loading the ${tabWord(next)} tab's board...`;
  els.status.textContent = loading;
  els.status.className = "status";
  tabBoards.reread(next).then((raw) => {
    if (state.boardKey !== key || tabBoards.visit() !== visit) { // another game, or another visit, is on screen now: its status line is not this click's
      if (els.status.textContent === loading) els.status.textContent = "";
      return;
    }
    const board = tabBoards.board(next);
    if (!board) {
      els.status.textContent = `Could not load the ${tabWord(next)} tab's board: ${raw?.error?.message ?? "the server did not return it"}. The ${tabWord(otherTab(next))} tab stays on screen.`;
      els.status.className = "status error";
      return;
    }
    if (els.status.textContent === loading) els.status.textContent = "";
    switchTo(board);
  });
});

// Never rejects. Returns null when the board was read (or a newer request took over), else the plain reason it could not be, which the
// Sources page shows under the row it just saved (onChanged in renderSourcesView).
async function loadBoard(key) {
  const token = beginRequest(key);
  tabBoards.setKey(key); // another game: both tabs' kept boards are the last game's and go
  const tab = optimizerTabFor(key);
  const n = tabBoards.begin(tab); // numbered as classic's reads are (write-seq.js): a board read that started before a write's answer is not painted over it
  if (optimizerLive()) tabBoards.reread(otherTab(tab)); // Part F: the other tab's board is kept too, so a switch is instant
  // A good board for a DIFFERENT key is not shown while the new one loads (there is nothing honest to
  // show), but a good board for THIS SAME key (a Refresh, or navigating back to a key already loaded) is
  // never cleared just because a reload started (🔵 finding: never blank a good board).
  if (state.boardKey !== key) {
    state.board = null;
    state.error = null;
    setFoot("");
  }
  state.loading = true;
  render();
  try {
    const raw = await getShowdownBoard(key, tab);
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
    // The same game already on screen: an answer older than one a write painted is dropped (a later Proj, star or note is not put back). A game that is not on screen yet always applies.
    const fresh = tabBoards.take(tab, n);
    if (state.boardKey === key && !fresh) return null;
    applyBoardResponse(raw, key, token, tab);
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

const tabScroll = {}; // each tab keeps its own scroll place (Adam 2026-11-05): where the window was when it was left
function onTabClick(tab) {
  if (tab !== state.activeTab) tabScroll[state.activeTab] = window.scrollY;
  state.activeTab = tab;
  render();
  if (typeof window.scrollTo === "function") window.scrollTo(0, tabScroll[tab] ?? 0);
}
setTabOpener((tab) => { if (state.board) onTabClick(tab); }); // the Optimizer's "open Lineups" button and a Load come back through here (lineups-nav.js)
onKeptChange(() => { // a build kept, discarded or removed: the tab's count follows (the tab's own redraw is lineups-screen.js's)
  if (state.board) renderShowdownTabs(els.tabs, state.activeTab, onTabClick, tabCounts());
});
const tabCounts = () => ({ lineups: keptCount(state.boardKey) });

function render() {
  state.activeTab = shownShowdownTab(state.activeTab); // a retired key ("rankings") or a tab not drawn here opens the Optimizer
  document.body.classList.toggle("nl-page", state.activeTab === "lineup" || !state.board); // no board (loading, or one the site does not have): the classic look's page too; the Optimizer tab is in the approved look's page (the classic's; style.css keeps the app's own page for the other tabs)
  if (isSourcesTab(state.activeTab)) state.lastSourcesTab = state.activeTab;
  renderShowdownTabs(els.tabs, state.activeTab, onTabClick, tabCounts());
  paintSourcesLink(els.sourcesBtn, isSourcesTab(state.activeTab));
  if (els.figuresPill) els.figuresPill.hidden = !(els.figuresPill.innerHTML = figuresPillHtml(state.board, modePillHtml)); // none for no board or one with no figures
  if (!state.board) {
    renderEmpty();
    syncExpandUi(); // the pool's panel is hidden: an expanded pool closes
    return;
  }
  els.emptyState.hidden = true;
  els.sourcesPanel.hidden = !isSourcesTab(state.activeTab);
  els.projectionsPanel.hidden = state.activeTab !== "projections";
  els.ownershipPanel.hidden = state.activeTab !== "ownership";
  els.lineupPanel.hidden = state.activeTab !== "lineup";
  if (els.lineupsPanel) els.lineupsPanel.hidden = state.activeTab !== "lineups";
  els.entriesPanel.hidden = state.activeTab !== "entries";

  // The header's stamps are this game's slate; the stale/failed source pills are source state (the Sources page's Data as of shows them).
  if (els.slateLine) renderSlateLine(els.slateLine, state.board.slate, { file: false });
  renderPills(els.pillsRow, { staleIds: state.board.stale ?? [], sources: state.board.sources ?? null, warnings: [], injuryReport: state.board.injuryReport });

  if (state.activeTab === "lineup") {
    // One screen (Adam 2026-10-26, D81): the game line and the filter bar, then the Optimizer's own part, with the pool, in its mount.
    renderGameLine();
    renderStamps();
    restoreView(state.boardKey, state.board); // A9: a game not drawn last gets its remembered filters and sort before the filter bar is drawn from them
    renderFilterBar();
    renderShowdownLineupPanel(els.lineupMount, state.board, state.boardKey, { onOpenSources: openSources, onBoardWrite: writeBoard, onPoolCount: setPoolCount, onDrawn: afterLineupDraw });
  } else if (state.activeTab === "lineups") {
    // The Optimizer's own part is brought up to this game and board first (its saved list, seats and settings are what the Lineups tab's Saved, Load and Save act through), drawn into its hidden panel.
    restoreView(state.boardKey, state.board);
    renderShowdownLineupPanel(els.lineupMount, state.board, state.boardKey, { onOpenSources: openSources, onBoardWrite: writeBoard, onPoolCount: setPoolCount, onDrawn: afterLineupDraw });
    renderShowdownLineupsPanel(els.lineupsPanel, state.board, state.boardKey); // full width, no player list: Recently generated and Saved
  } else if (isSourcesTab(state.activeTab)) {
    renderSourcesView();
  } else if (state.activeTab === "entries") {
    renderShowdownEntriesPanel(els.entriesPanel, state.board, state.boardKey);
  }
  if (state.activeTab !== "lineup") syncExpandUi(); // the pool's panel is hidden: an expanded pool closes
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
    canSetStatus: supports("overrides") && !isShowdownSampleMode(), // the Player status card's switches (Adam 2026-11-12)
    asOf: { lines: [poolNoteText(state.board), savedCopiesLine(state.board), uploadStaleLine(), state.board ? ownTotalsLine(state.board.rows) : "", state.board?.injuryNote, ...selfCheckLines(state.board)].filter(Boolean) }, // item 7: the game's stamps, its figures reading and saved copies (the header's chips) and the injury report's counts, moved here
  });
  if (state.activeTab === "projections") {
    renderShowdownProjectionsPanel(els.projectionsPanel, state.board, {
      selection: sectionSources(state.boardKey, "projection"), // ticked and unticked: an unticked source's column is dimmed, as classic's
      onPaste: async (payload) => {
        const key = state.boardKey;
        const token = beginRequest(key);
        const n = tabBoards.begin("gpp"); // the paste answers the GPP board (server/showdown/routes.js); Cash's is read again for the new figures
        const result = await postShowdownProjectionsPaste(key, payload);
        if (result?.ok && result.board) {
          paintAnswer(result.board, key, token, n, "gpp");
          if (optimizerLive()) tabBoards.reread("cash");
        }
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
  const tab = optimizerTabFor(key);
  const n = tabBoards.begin(tab); // numbered as it starts, as a write is
  els.status.textContent = "Refreshing sources...";
  els.status.className = "status";
  try {
    const r = await postShowdownRefresh(key, tab); // Part F: answers the tab on screen's rebuilt board
    if (!isCurrent(token, key)) return;
    if (!r || r.ok === false) throw new Error(r?.error?.message ?? "unknown error");
    paintAnswer(r, key, token, n, tab);
    if (optimizerLive()) tabBoards.reread(otherTab(tab)); // the other tab's board has the new figures too
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

// Exported for app.js's upload flow (🔵 finding): the upload response's own stale list (the game on screen's), kept for the Sources
// page's Data as of (G64: the header's chip row is hidden on Showdown, so a chip there was never seen; G62: nothing dropped). A saved
// copy the reloaded board already names is said once, by its own line (uploadStaleLine).
export function showUploadPills(staleIds) {
  state.uploadStale = { key: showdownKeyFromHash() ?? state.boardKey, ids: [...(staleIds ?? [])] };
  if (isSourcesTab(state.activeTab) && state.board) render();
}

/** The upload's saved copies the board on screen does not already name, as one Data as of line, or "". */
function uploadStaleLine() {
  const up = state.uploadStale;
  if (!up || up.key !== state.boardKey) return "";
  const named = new Set(state.board?.stale ?? []);
  const line = savedCopiesLine({ stale: up.ids.filter((id) => !named.has(id)), sources: state.board?.sources ?? [] });
  return line.replace(/^Saved copies/, "At the upload, saved copies");
}
