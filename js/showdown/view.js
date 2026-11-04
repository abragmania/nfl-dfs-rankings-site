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
import { deleteShowdownOverrides } from "./optimizer.js";
import { renderPills, kickoffDateAndClock, paintSourcesLink, wireSourcesLink, modePillHtml } from "../header.js";
import { isSourcesTab, sourcesTabToOpen } from "../tabs.js";
import { renderSourcesPage, sectionSources } from "../sources-page.js";
import { escapeHtml, dec1 } from "../format.js";
import { store } from "../state.js";
import { sdShowAll, setSdShowAll, onSdShowAllChange } from "./show-all.js"; // C24: the Showdown's own Show all players
import { boardStamps, stampsLineHtml } from "../stamps.js"; // B11, C26: Board, Injuries, Pulled and Lock, with the Sources link
import { makeWriteSeq } from "../write-seq.js"; // item 10: the writes' one numbered flow
import { makeBoardFlow } from "../write-runner.js";
import { makeFilterDebounce } from "../filter-debounce.js"; // the typed boxes wait out classic's 150 ms pause
import { syncExpandUi } from "../expand.js";
import { adjustScrollPanels } from "../scroll-panels.js";
import { renderShowdownTabs, renderShowdownProjectionsPanel, renderShowdownOwnershipPanel, renderShowdownLineupPanel, renderShowdownEntriesPanel, shownShowdownTab } from "./tabs.js";
import { repaintShowdownPool } from "./lineup.js";
import { lineupFigureRow } from "./lineup-meter.js";
import { poolState, poolCountText } from "./pool.js";
import { restoreView } from "./view-memory.js"; // A9: the pool's filters and sort per game
import { filterBarHtml, wireFilterBar, takeBarFocus, restoreBarFocus } from "./filter-bar.js"; // the filter bar above the builder (team and position chips, search, salary range, Min Proj)
import { figuresPillHtml } from "./figures-label.js"; // the header pill naming the sources this game's board reads (Adam 2026-10-20)
import { normalizeBoard, teamFullName } from "./board-shape.js"; // the board's pure shaping (moved for the 600-line cap)

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
  const row = lineupFigureRow(found); // a typed revive set aside under TwoGun only reads 0 here, as Build counts him (round 4, item 5)
  return row.gameId || !g?.away || !g?.home ? row : { ...row, gameId: `${g.away}@${g.home}` }; // the board row's figures on every tab, as the Lineup tab's slots show them
}
export const showdownBoardAsOf = () => state.board?.generatedAt ?? null;
export const showdownBoardNow = () => state.board ?? null; // the player card names the board's own source lines (A8)

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
  gameline: document.getElementById("sd-gameline"),
  stamps: document.getElementById("sd-stamps"),
  filterbar: document.getElementById("sd-filterbar"),
  projectionsPanel: document.getElementById("sd-projections-panel"),
  ownershipPanel: document.getElementById("sd-ownership-panel"),
  lineupPanel: document.getElementById("sd-lineup-panel"),
  lineupMount: document.getElementById("sd-lineup-mount"), // the Optimizer's redrawn part inside #sd-lineup-panel; the game line and the filter bar around it are not
  entriesPanel: document.getElementById("sd-entries-panel"),
  emptyState: document.getElementById("sd-empty-state"),
};

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

// Four small boxes at the top of the Optimizer tab (once above the Rankings table; 👁 visual-qa: like the hosted sheet's Total/Line/implied
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

function renderEmpty() {
  els.emptyState.hidden = false;
  for (const p of [els.sourcesPanel, els.projectionsPanel, els.ownershipPanel, els.lineupPanel, els.entriesPanel]) p.hidden = true;
  els.band.innerHTML = "";
  if (els.stamps) els.stamps.innerHTML = "";
  els.emptyState.textContent = state.loading ? "Loading the showdown board…" : state.error ?? "Could not load this showdown.";
}

// Drawn on a board load, a tab switch, a chip click or Clear filters, never on a keystroke: the typed boxes only patch the pool
// (through the pause), so a box never loses its caret. A rebuild first flushes the boxes' waiting changes, so it never redraws a box
// from older text. The markup and the wiring are filter-bar.js's.
function renderFilterBar() {
  typedFilters.flush();
  const focused = takeBarFocus(els.filterbar); // item 9: a board answer redraws the bar while he is typing in a box; the box keeps the keyboard and its caret
  const starred = (state.board?.rows ?? []).filter((r) => r.starred).length; // every starred man of the game, unfiltered (D53)
  els.filterbar.innerHTML = filterBarHtml(poolState.filters, state.board?.game, sdShowAll(), resetButton(), starred);
  wireFilterBar(els.filterbar, {
    typed: typedFilters,
    rebuild: renderFilterBar,
    repaint: repaintShowdownPool,
    clearShowAll: () => setSdShowAll(false), // the Showdown's own switch (C24), not classic's
    onResetOverrides: () => writeBoard((key) => deleteShowdownOverrides(key), "the reset"),
  });
  restoreBarFocus(els.filterbar, focused);
}

// B11, C26: the four as-of stamps under the game line, with the Sources link (the same opener as the header's Sources button).
function renderStamps() {
  if (!els.stamps) return;
  els.stamps.innerHTML = state.board ? stampsLineHtml(boardStamps(state.board), { sourcesLink: true }) : "";
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
  els.lineupPanel.style.setProperty("--filterbar-bar-h", `${bar}px`);
  els.lineupPanel.style.setProperty("--filterbar-h", `${total}px`);
}
window.addEventListener("resize", syncFilterbarHeight);
if (typeof ResizeObserver !== "undefined") {
  const notice = document.getElementById("sd-build-notice");
  if (notice) new ResizeObserver(syncFilterbarHeight).observe(notice);
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
/** A refresh's or a paste's answer (write number `n`, from writeSeq.start() before it was sent): painted unless a newer write's answer is already on screen, in which case the board is read
 *  once more and that read painted (write-runner.js runWrite's rule), so a late Refresh answer can never put a typed Proj back. */
function paintAnswer(raw, key, token, n) {
  if (writeSeq.take(n)) return applyBoardResponse(raw, key, token);
  writeFlow.loadBoard().catch((e) => { els.status.textContent = `The board could not be reread: ${e?.message ?? e}`; els.status.className = "status error"; });
  return false;
}

function applyBoardResponse(raw, key, token) {
  if (!isCurrent(token, key)) return false;
  state.board = normalizeBoard(raw);
  state.boardKey = key;
  state.error = null;
  state.loading = false;
  render();
  return true;
}

// A write from the Lineup tab that answers this game's board (a star, a typed number, a note, the ± bump, a reset): `send(key)` makes the request. Since the round 4 fix batch
// (item 10) every write goes through classic's one numbered flow (write-seq.js, write-runner.js makeBoardFlow): each is numbered as it starts and an answer older than one already
// painted is not painted (a read of the board follows it instead), so a slow first answer can never put the screen back over a newer one. A refusal or a failure puts the
// server's sentence in the status line, as a failed refresh does. Resolves true when the server took the write, false when it did not.
const writeSeq = makeWriteSeq();
const writeFlow = makeBoardFlow({
  seq: writeSeq,
  getBoard: () => getShowdownBoard(state.boardKey),
  paint: (board) => {
    if (board?.key && state.boardKey && board.key !== state.boardKey) return; // an answer for a game that is no longer on screen paints nothing
    state.board = normalizeBoard(board);
    state.error = null;
    state.loading = false;
    render();
  },
  fail: (text) => {
    els.status.textContent = text;
    els.status.className = "status error";
  },
});
async function writeBoard(send, label) {
  const key = state.boardKey;
  const data = await writeFlow.runWrite(() => send(key), { label });
  if (data !== null && els.status.textContent.startsWith(`Could not save ${label}: `)) { // this write's earlier refusal is over; any other line stays
    els.status.textContent = "";
    els.status.className = "status";
  }
  return data !== null;
}

// Never rejects. Returns null when the board was read (or a newer request took over), else the plain reason it could not be, which the
// Sources page shows under the row it just saved (onChanged in renderSourcesView).
async function loadBoard(key) {
  const token = beginRequest(key);
  const n = writeSeq.start(); // numbered as classic's reads are (write-seq.js): a board read that started before a write's answer is not painted over it
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
    // The same game already on screen: an answer older than one a write painted is dropped (a later Proj, star or note is not put back). A game that is not on screen yet always applies.
    if (state.boardKey === key && !writeSeq.take(n)) return null;
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
  state.activeTab = shownShowdownTab(state.activeTab); // a retired key ("rankings") or a tab not drawn here opens the Optimizer
  if (isSourcesTab(state.activeTab)) state.lastSourcesTab = state.activeTab;
  renderShowdownTabs(els.tabs, state.activeTab, onTabClick);
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
  els.entriesPanel.hidden = state.activeTab !== "entries";

  // The gold band and stale/failed source pills show on both tabs and the Sources view (brief).
  renderBand();
  renderPills(els.pillsRow, { staleIds: state.board.stale ?? [], sources: state.board.sources ?? null, warnings: [], injuryReport: state.board.injuryReport });

  if (state.activeTab === "lineup") {
    // One screen (Adam 2026-10-26, D81): the game line and the filter bar, then the Optimizer's own part, with the pool, in its mount.
    renderGameLine();
    renderStamps();
    restoreView(state.boardKey, state.board); // A9: a game not drawn last gets its remembered filters and sort before the filter bar is drawn from them
    renderFilterBar();
    renderShowdownLineupPanel(els.lineupMount, state.board, state.boardKey, { onOpenSources: openSources, onBoardWrite: writeBoard, onPoolCount: setPoolCount, onDrawn: afterLineupDraw });
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
  });
  if (state.activeTab === "projections") {
    renderShowdownProjectionsPanel(els.projectionsPanel, state.board, {
      selection: sectionSources(state.boardKey, "projection"), // ticked and unticked: an unticked source's column is dimmed, as classic's
      onPaste: async (payload) => {
        const key = state.boardKey;
        const token = beginRequest(key);
        const n = writeSeq.start();
        const result = await postShowdownProjectionsPaste(key, payload);
        if (result?.ok && result.board) paintAnswer(result.board, key, token, n);
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
  const n = writeSeq.start(); // numbered as it starts, as a write is
  els.status.textContent = "Refreshing sources...";
  els.status.className = "status";
  try {
    const r = await postShowdownRefresh(key);
    if (!isCurrent(token, key)) return;
    if (!r || r.ok === false) throw new Error(r?.error?.message ?? "unknown error");
    paintAnswer(r, key, token, n);
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
