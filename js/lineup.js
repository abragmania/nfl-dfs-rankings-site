// Optimizer tab (PROJECT.md D21/D32, D70, Part 4 Lineup Builder screen): the main screen since Optimizer-first step 4 (D21's
// "secondary section" wording is amended by step 6's documents). Top: the Optimizer band (its max-per-team and D73 QB-stack controls included). Left column: the
// nine DraftKings classic slots (D1), a salary bar, totals, Clear lineup and Save lineup. Right column: the same rows the ranked list
// below is showing — same store, same filters (the one filter bar above sets them, Optimizer-first step 4), same sort (its headers
// set it) — with per-row Lock and Exclude buttons; a click on a row puts the man in or takes him out (D81, 2026-10-29). app.js passes #lineup-mount as the container: only that part of
// #lineup-panel is redrawn here, never the filter bar, game strip or ranked list around it.
//
// State (locks, excludes, the nine slots, and the option controls) lives in this module for the life of
// the page load, independent of the app-level store in state.js (this tab never edits Proj/Own, and
// nothing else on the page needs to know about a lock or an exclude). It is optionally mirrored to
// localStorage, wrapped in try/catch, so a reload doesn't lose an in-progress build; if storage is
// unavailable the tab still works, it just starts empty on the next load.
//
// A slot holds only `{id, slot}` — never a name/salary/proj/own snapshot — so every render reads those
// fields from whatever board.rows currently says for that id. That is what makes an override show up in
// a placed slot without this module doing anything, and it's why the persisted state (slots, locks, excludes) is
// re-validated against the live board on every board load rather than trusted as-is (🔵 finding 1): an id
// with no row anymore (a stale localStorage entry, or last week's slate) is dropped instead of rendering
// stale data or throwing.
//
// Split in three (Adam 2026-10-18, moved not edited): this file keeps the state (`state`, `opt` and the module `let`s that
// only it assigns), storage, the entry points tabs.js imports, the builder and saved-lineup actions, and the wiring.
// lineup-view.js holds every piece of panel markup; lineup-optimizer.js holds cash mode, the request/validation helpers
// and the Optimizer actions. Every name this file exported before is still exported from here.
import { store, FLEX_POS, defaultDirFor, activeSlateRows } from "./state.js";
import { storableClassicFilters } from "./memory.js";
import { showBand } from "./show-band.js"; // A12, A15: a Load brings the whole band into view
import { focusOpenRename, wireRenameEnter } from "./rename-focus.js"; // the rename box: focused and selected on open, Enter saves
import { keepPoolHeadInView, poolAvailableKeys } from "./lineup-pool.js"; // A15: a filter from far down puts the table back in view
import { saveClassicMemory, syncLineupMemory, restoreForMode, migrateLegacyLineups, droppedMenSentence, currentMemoryKey } from "./lineup-memory-sync.js"; // A9: the browser's memory of the settings and the working lineups, per slate
import { rowIsOut, twoGunOutReason, STATUS_INFO } from "./table.js"; // D43: the one copy of "vs DAL" / "@ DET"
import { shownTotal } from "./totals.js";
import { handBuild } from "./lineup-builds.js";
import { cleanSortState } from "./lineup-sort.js"; // Adam 2026-10-17: sort options; the `Own vs field` key is stored as "geo"
import { optExposureHtml, exposureLimit, minLimit, exposureMark, zeroMinRows, defaultExpState } from "./lineup-exposure.js";
import { newQbState, listedQbs, pruneEntries, qbStacksPayload } from "./lineup-qb-stacks.js";
import { getLineups, postLineup, putLineup, deleteLineup } from "./api.js";
import { renderEntriesSection, wireEntries } from "./entries-wire.js";
import { phoneMinHeight } from "./expand.js";
import { defaultCashState, cleanCashState, swapModeStash, COUNT_DEFAULTS_VERSION } from "./lineup-cash.js";
import { newClassicTabs, bindClassicTabFields, clearTabBuilds, clearTabFilters } from "./lineup-tabs.js"; // Part F: GPP and Cash each keep their own batch, messages and filter
import { syncLeftOut } from "./lineup-left-out-panel.js"; // Part F: the Cash tab's Left out panel
import { ruleOn } from "./lineup-settings.js";
import { paintStarredQbChip } from "./filterbar.js";
import { setPoolCallbacks, poolStarClick, panelHtml, savedOfActiveSlate, starredQbChipView, poolColumnSetup, CLASSIC_POOL_PICK_SKIP, shownSavedLineups, poolPickerNow } from "./lineup-view.js";
import { wireColumns } from "./columns.js";
import { wirePoolEdits, takePoolEdit, restorePoolEdit } from "./lineup-pool-edit.js"; // C9, C17: the pool's typed Proj and Own, taken over from the retired ranked list
import { clearLineupHasContent, clearedLineup } from "./lineup-clear.js"; // B6: Clear lineup empties the slots and their locks, never the excludes
import { wireDkDownload } from "./dk-lineup-ui.js"; // A12: Download DK CSV for the saved lineups ticked
import { takeOpenLimit, restoreOpenLimit, limitRefusals, dropOlderLimitRefusals, noteLimitPress } from "./limit-box.js"; // A3: the Min % and Max % boxes survive a redraw; a refused text is held
import { onConfirmDismiss } from "./confirm-inline.js"; // B13: Esc and a click outside close an open confirm
import { notDeletedText } from "./delete-words.js"; // A12: the one sentence a failed delete leaves
import { fitPoolNames, wirePoolFit } from "./pool-fit.js"; // Round 5 last batch: the pool's name column is the one that gives when the ticked columns overflow
import { wireStaleMessages } from "./stale-messages.js"; // item 17: a one-shot message goes at the next click on any control
import { wirePick, wirePickRows, SLOT_PICK_SKIP } from "./pick-rows.js"; // click-to-pick, the one wiring the Showdown Optimizer shares (D81)
import { cleanPlayerMax, boardModeOf, slateKeyOf, uniqueSavedName, lockedIds, cashPick, wireOptimizer, savedSetKeys, lineupSetKey, refreshBuildNotice, resetBuildNotice } from "./lineup-optimizer.js";

export const LINEUP_SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
export const SALARY_CAP = 50000;
// The lineups maximise projection, the only objective, so the screen has no Build by control (optimizer standard A21 and A13, 2026-11-03:
// the Ceiling choice was removed and the control returns with a second objective). The Leverage and Projection-minus-ownership
// objectives are gone too (Adam 2026-10-15); the server builds any older request naming one on projection, with a note.
export const OBJECTIVES = [
  { value: "proj", label: "Projection" },
];

/** The objective a build uses: Projection, whatever was picked or remembered (a stale "ceil" falls back silently). */
export function effectiveObjective(picked) {
  return OBJECTIVES.some((o) => o.value === picked) ? picked : "proj";
}

/** The words a set of new lineups is labelled with: the mode it was built in, so a set made before a mode flip says so
 *  ("TwoGun mode, by projection"). */
export function builtInText(mode) {
  return `${mode === "twogun" ? "TwoGun" : "current"} mode, by projection`;
}

export { optExposureHtml, exposureLimit, minLimit, exposureMark, zeroMinRows }; // lineup-exposure.js
export const MAX_TEAM_OPTIONS = ["", "1", "2", "3", "4"];
const STORAGE_KEY = "nfldfs.lineupBuilder.v1";

export const state = {
  slots: new Array(LINEUP_SLOTS.length).fill(null), // each: {id, slot} or null; row fields are read live
  locks: new Set(), // player ids (strings) the Optimizer must use (D70: a filled slot is always one)
  excludes: new Set(), // player ids (strings) that must never appear
  addError: null, // set when Add is blocked, or as a non-blocking warning after a successful Add
  addErrorId: null, // the pool row (board id) whose click made addError: the message is drawn beside that row (row-message.js, standard A14)
  addTone: undefined, // how addError is drawn: undefined is amber (a refusal); "error" for a write that failed (setPoolRowError)
  confirm: null, // the inline confirm that is open (confirm-inline.js): "clear" (Clear lineup) or "load:<saved lineup id>" (Load over an unsaved working lineup)
  memoryNote: "", // the sentence a remembered lineup that lost men leaves (A9): who is gone from this slate; one-shot, goes at the next click
  dkSelected: new Set(), // saved lineup ids ticked for Download DK CSV (dk-lineup-ui.js); page-only
  dkStatus: "", // the sentence the last Download DK CSV left under its button

  // Saved lineups (Adam's "draw up a lineup, press Save, see it in a list").
  savedLineups: [], // server records: [{id, name, savedAt, slots:[{slot,playerId,name,team,pos,salary,proj,own}], salaryUsed, totalProj}]
  savedLoaded: false, // true once the current GET /api/lineups has resolved (success or failure)
  savedError: null, // the server's error.message from a failed GET (e.g. LINEUPS_UNREADABLE), else null
  saveName: "", // the name box's value, only read/committed at Save-click time so typing never re-renders
  loadedId: null, // id of the saved lineup the builder was loaded from (Save writes back to it), else null
  saving: false,
  saveError: null,
  saveTone: "error", // how saveError is drawn: "warn" for a refusal (nothing to save), "error" for a failure (row-message.js)
  saveConfirm: null, // a short "Saved ..." message shown once after a successful save
  renamingId: null, // id of the saved lineup currently showing its inline rename box, or null
  deleteConfirmId: null, // id of the saved lineup currently showing its inline "Delete this lineup?" prompt, or null
  lineupErrors: {}, // saved lineup id -> the server's message for a refused letter change; cleared by its next good PUT
  deleteErrors: {}, // saved lineup id -> why its delete did not happen (A12), one sentence on the card's Load and Delete row until the next try
};

let savedFetchInFlightKey = null; // the season-week key a GET is currently in flight for, else null

/** Forgets the message a pool-row click made, and the row it sits beside (row-message.js, standard A14). */
export function clearAddMessage() {
  state.addError = null;
  state.addErrorId = null;
  state.addTone = undefined;
}

/** A write for a pool row failed (the reset x): the sentence sits beside that row in red (the project's rule: a failed write is shown beside the row). */
export function setPoolRowError(id, text) {
  state.addErrorId = String(id);
  state.addError = text || "The change was not saved.";
  state.addTone = "error";
  commit();
}

/** Forgets the loaded saved lineup and its prefilled name together (PROJECT.md Part 4 Lineups). */
export function clearLoaded() {
  state.loadedId = null;
  state.saveName = "";
}

/** Fires a GET for the saved lineups of `key` (a "season-week" string). Guarded by a module-level flag
 *  (not state.savedLoaded) keyed to `key` itself, so a re-render before the fetch resolves never starts a
 *  second request for the same week, but a week change (a new CSV upload, no page reload) always re-fires
 *  (🔵 finding: the list was previously fetched once per page load and never again). */
function loadSavedLineups(key) {
  if (savedFetchInFlightKey === key) return;
  savedFetchInFlightKey = key;
  getLineups()
    .then((data) => {
      if (!data || data.ok === false) {
        state.savedLineups = [];
        state.savedError = data?.error?.message ?? "Could not load saved lineups.";
      } else {
        state.savedLineups = Array.isArray(data?.lineups) ? data.lineups : [];
        state.savedError = null;
      }
      state.savedLoaded = true;
      commit();
      redrawEntries();
    })
    .catch((e) => {
      state.savedLineups = [];
      state.savedError = `Could not reach the server: ${e.message}`;
      state.savedLoaded = true;
      commit();
      redrawEntries();
    });
}

/** The identity Add and "already placed" checks compare on (🔵 finding 6): a board row's DraftKings id
 *  when it has one, else its own board id. Two board rows can be the same DraftKings player. */
export function dkIdentity(row) {
  const v = row?.dkId ?? row?.id;
  return v == null ? null : String(v);
}

function loadPersisted() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

/** What this key still carries of the Optimizer: the per-player Max % and Min % boxes (per slate key), the card lists' sort, the mode and Cash's Want lists (per slate key). The working lineup and every
 *  setting (how many lineups, the caps, the rules, the stack, Spread defenses, the per-QB panels, the avoided games, Cash's count and Max per team) are the browser memory's (lineup-memory-sync.js, A9), per slate. */
export function savePersisted() {
  saveClassicMemory();
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        playerMax: opt.playerMax, // per slate key: {id: "typed text"} (the pool's Max % boxes)
        playerMin: opt.playerMin,
        mode: opt.mode, // Cash mode job 3b, 2026-10-17: the switch and Cash's Want lists
        cash: { want: opt.cash.want },
        sort: opt.sort,
        countsV: COUNT_DEFAULTS_VERSION, // D9: a saved state without it that remembers a count of 1 takes the new default once (hydrateFromStorage)
      })
    );
  } catch (e) {
    // localStorage unavailable (private mode, quota, disabled) — state just won't survive a reload.
  }
}

let hydrated = false;
/** The Optimizer's remembered state read before the first board is asked for, so a page opened on the Cash tab asks for that tab's board first (app.js). */
export function hydrateOptimizer() {
  hydrateFromStorage();
}

// Cash mode job 3b, 2026-10-17: hydrate's slot normalising, also run on the slots a mode switch restores; null when `raw` is no nine-slot list.
const normalSlots = (raw) =>
  Array.isArray(raw) && raw.length === LINEUP_SLOTS.length ? raw.map((s, i) => (s && s.id != null ? { id: String(s.id), slot: LINEUP_SLOTS[i] } : null)) : null;

/** Reads localStorage exactly once per page load. Everything it accepts is still subject to
 *  validateAgainstBoard() once a board exists (🔵 finding 1), so a stale slate never survives here. The settings and the working lineups are the browser memory's, read per slate when a slate is drawn
 *  (lineup-memory-sync.js syncLineupMemory); an older browser's one global lineup, still in this key, is moved into that memory here, before the first save of this key drops it (A9). */
function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  const persisted = loadPersisted();
  if (!persisted) return;
  migrateLegacyLineups(persisted);
  opt.mode = persisted.mode === "cash" ? "cash" : "gpp"; // Cash mode job 3b
  opt.cash = cleanCashState(persisted.cash, persisted.countsV ?? null); // null: a state saved before the count defaults changed (D9)
  opt.sort = cleanSortState(persisted.sort);
  opt.playerMax = cleanPlayerMax(persisted.playerMax);
  opt.playerMin = cleanPlayerMax(persisted.playerMin);
  // The per-QB panels, Spread defenses and Cash's count, Max per team and avoided games an older browser kept here are carried by migrateLegacyLineups to the first main slate; later saves of this key leave them out.
  // Older saved state may still carry the removed Build's objective / maxFromTeam / stackQbWith; they are ignored
  // and dropped on the next save.
}


let lastValidatedBoard = null;
let lastSavedKey = null; // "season-week" the saved-lineups list was last requested for

/** The season-week the saved-lineups list is keyed to (🔵 finding: a new CSV upload changes the week
 *  without a page reload, and the saved list must follow it rather than keep showing last week's). */
export function seasonWeekKey(board) {
  return `${board?.slate?.season ?? ""}-${board?.slate?.week ?? ""}`;
}

/** Re-validates locks, excludes and slots against whatever board is current (🔵 finding 1). Runs whenever
 *  a fresh board object lands (compared by reference, not a one-time "loaded" flag), including the very
 *  first render, so a reload, a re-upload or a slate change never leaves a dangling id behind. Also
 *  re-fetches the saved-lineups list whenever the board's own season/week changed, not on a one-shot flag,
 *  so a new week's upload shows that week's saved lineups without a page reload. */
function validateAgainstBoard(board) {
  if (!board || board === lastValidatedBoard) return;
  const before = lastValidatedBoard; // the board the lineup was last checked against: where a man who is gone from this one can still be named
  lastValidatedBoard = board;
  opt.cashUndo = null; // Cash 3b fix round 2, 2026-10-17: a snapshot made on another board never comes back past this check
  const savedKey = seasonWeekKey(board);
  const sameWeek = savedKey === lastSavedKey;
  if (savedKey !== lastSavedKey) {
    lastSavedKey = savedKey;
    state.savedLoaded = false;
    state.savedLineups = [];
    state.savedError = null;
    clearLoaded();
    loadSavedLineups(savedKey);
    resetOptimizerResults(); // new lineups belong to the week they were made for
    clearMustHave(); // the players he filtered by belong to that week too
    opt.avoid.clear(); // avoid-game picks are games of that week
    opt.cash.avoid = []; // Cash mode job 3b: the same for cash's avoided games
    clearAddMessage(); // a refusal beside a row of last week's pool is not this week's
    state.dkSelected.clear(); // last week's ticked saved lineups, and the last download's sentence, are not this week's
    state.dkStatus = "";
  }
  const rowById = new Map((board.rows ?? []).map((r) => [String(r.id), r]));
  // A9: a re-upload or a refresh of the same week that no longer has a man (a new id, or he left the file) takes him out, and a sentence names him; his name is the old board's or the memory's, never blank.
  const lost = sameWeek ? [...new Set([...state.slots.filter(Boolean).map((s) => String(s.id)), ...state.locks])].filter((id) => !rowById.has(id)) : [];
  if (lost.length) state.memoryNote = droppedMenSentence(lost, before);
  for (const id of [...state.locks]) if (!rowById.has(id)) state.locks.delete(id);
  for (const id of [...state.excludes]) if (!rowById.has(id)) state.excludes.delete(id);
  for (const key of Object.keys(opt.cash.want)) opt.cash.want[key] = opt.cash.want[key].filter((id) => rowById.has(id)); // Cash mode job 3b: Want ids off the board go, as locks do
  for (const map of [...Object.values(opt.playerMax), ...Object.values(opt.playerMin)]) for (const id of Object.keys(map)) if (!rowById.has(id)) delete map[id];
  state.slots = state.slots.map((s, i) => {
    if (!s) return null;
    if (!rowById.has(String(s.id))) return null; // no row on this board: drop it
    return { id: String(s.id), slot: LINEUP_SLOTS[i] }; // rebuilt fresh; nothing else is ever stored
  });
}

export let lastContainer = null;

/** The season-week the Entries section loads for, or null when no board or week is loaded yet. */
function entriesWeekKey(board) {
  return board?.slate?.season != null && board?.slate?.week != null ? seasonWeekKey(board) : null;
}

let lastMessageScope = null; // "slate|optimizer mode|board mode" the one-shot messages were made under
/** Item 17 (round 3 fixes): the messages a click leaves (`Saved "..."`, the DK status, a refused pool click) belong to the slate and mode they
 *  were made in; a different slate or mode starts clean. */
function dropStaleMessages(board) {
  const scope = `${slateKeyOf(board)}|${opt.mode}|${boardModeOf(board)}`;
  if (lastMessageScope !== null && scope !== lastMessageScope) {
    state.dkStatus = "";
    state.saveConfirm = null;
    clearAddMessage();
  }
  lastMessageScope = scope;
}

let lastFiltersJson = null; // the filters as of the last draw: a draw after a filter changed puts the table back in view (keepPoolHeadInView)

export function renderLineupPanel(container, callbacks) {
  const filtersNow = JSON.stringify(storableClassicFilters(store.get().filters));
  const filtersChanged = lastFiltersJson !== null && filtersNow !== lastFiltersJson;
  lastFiltersJson = filtersNow;
  lastContainer = container;
  if (callbacks) setPoolCallbacks(callbacks);
  hydrateFromStorage();
  validateAgainstBoard(store.get().board);
  syncLineupMemory(store.get().board); // A9: after the board check (a new week clears the avoided games), so the remembered ones are the slate's own
  dropStaleMessages(store.get().board);
  if (state.loadedId && state.savedLoaded && !state.savedLineups.some((l) => l.id === state.loadedId)) clearLoaded();
  pruneQbStacks(store.get().board);
  syncOptimizerSlate();
  syncLeftOut({ key: currentMemoryKey(), board: store.get().board, container, commit }); // Part F: the Cash tab's Left out panel asks again when its board or settings changed (its own draw comes with the panel's)
  wirePoolEdits(container, { rowOf: (id) => store.get().board?.rows.find((r) => String(r.id) === String(id)) }); // C9, C17: the pool's typed Proj and Own (one listener on the mount)
  wireStaleMessages(container, {
    hasAny: () => Boolean(state.dkStatus || state.saveConfirm || state.addError || state.memoryNote || limitRefusals().length),
    clear: () => { state.dkStatus = ""; state.saveConfirm = null; state.memoryNote = ""; clearAddMessage(); dropOlderLimitRefusals(container); }, // a refused Min % / Max % text made in this very press stays (limit-box.js)
    press: noteLimitPress,
    selector: ".dk-status, .row-msg-warn, .row-msg-notice, .lineup-status:not(.lineup-status-error):not(.lineup-status-warning)", // a notice such as `Saved "..."`, the DK status, an amber refusal
  });
  const openLimit = takeOpenLimit(); // a Min % or Max % box he is typing in survives the redraw with its text and focus (A3)
  const openEdit = takePoolEdit(container); // so does a typed Proj or Own box
  container.innerHTML = panelHtml();
  wire(container);
  restoreOpenLimit(container, openLimit);
  restorePoolEdit(container, openEdit, { rowOf: (id) => store.get().board?.rows.find((r) => String(r.id) === String(id)) });
  focusOpenConfirm(container);
  focusOpenRename(container, state.renamingId); // the rename box takes the keyboard when it opens, its name selected
  syncStarredQbChip();
  fitPoolNames(container); // the name line gives way (an ellipsis, the full name on hover) only when the ticked columns would overflow the panel
  wirePoolFit();
  if (filtersChanged) keepPoolHeadInView(); // a filter from far down that shrank the table leaves him at the table, not past it
  refreshBuildNotice(); // A15: the notice under the filter bar follows the build's state and where the Build row is
}

/** The Starred QBs only chip lives in the filter bar (standard C12); its look follows the rule, the mode and the board, so each draw repaints it. */
export function syncStarredQbChip() {
  const bar = typeof document !== "undefined" ? document.querySelector?.("#filterbar") : null;
  if (bar) paintStarredQbChip(bar, starredQbChipView(store.get().board));
}

/** The chip's view for the board on screen (renderFilterBar paints it as the bar is built). */
export const starredQbViewNow = () => starredQbChipView(store.get().board);

/** A click on the filter bar's Starred QBs only chip: flips the rule and redraws the panel (which repaints the chip). */
export function toggleStarredQbOnly() {
  opt.rules.starredQbOnly = !ruleOn(opt.rules, "starredQbOnly");
  commit();
}

// A15 (round 5): there is no sticky Build footer. The Build row (the summary and the button) sits under the settings, the pool and then the results run down the page, and a build that ends with its
// button off screen says `Build finished.` with a link to the results (build-notice.js, lineup-optimizer.js doGenerate).

let entriesContainer = null; // the Entries tab's panel, once drawn (rules repo 2026-10-17)

/** The Entries tab (rules repo 2026-10-17: its own tab, it was a section under the Optimizer). It reads the saved lineups
 *  this module holds, so it does the same first steps as renderLineupPanel (storage read once, then the board check that
 *  starts the saved-lineups load); nothing of the Optimizer's own DOM is needed. */
export function renderEntriesPanel(container) {
  entriesContainer = container;
  const board = store.get().board;
  hydrateFromStorage();
  validateAgainstBoard(board);
  container.innerHTML = renderEntriesSection(state.savedLineups, board?.slates ?? [], entriesWeekKey(board));
  wireEntries(container, {
    weekKey: entriesWeekKey(board),
    getSaved: () => state.savedLineups,
    getFileContext: () => store.get().board?.slates ?? [],
  });
}

// The saved-lineups list arrives after the first draw; the Entries tab, when it is the one on screen, is drawn again then.
function redrawEntries() {
  if (entriesContainer && !entriesContainer.hidden) renderEntriesPanel(entriesContainer);
}

// Whole-row snapping by geometry rather than by one row's height (👁 visual-qa fourth/fifth pass): finds
// the last tbody row whose bottom edge actually fits within the available height and snaps the panel's
// max-height to that row's bottom, so a row that renders taller/shorter than another (wrapped text,
// badges, etc.) never leaves a partial row peeking out at the bottom. `panelEl.offsetHeight -
// panelEl.clientHeight` is added back on as the panel's own border/scrollbar allowance. Falls back to the
// previous head+available calc() only when the panel has no tbody rows yet (e.g. an empty table).
// The Optimizer pools are no longer scroll panels (A15); the Sources tables still are, and showdown/tabs.js sizes its tables with this.
//
// This exact function also lives in public/js/scroll-panels.js as adjustScrollPanels's per-panel sizing step
// (snapPanelMaxHeight there). It's duplicated here rather than imported because tabs.js imports this module and
// scroll-panels.js imports expand.js; keep both copies in sync.
export function snapPanelMaxHeight(panelEl, top, reserve) {
  // Layout round 2, 2026-10-17: a panel in a hidden tab reads every rect as 0 and would be sized to 0px: leave it alone.
  if (panelEl.getClientRects().length === 0) return;
  // Layout round 2, 2026-10-17: the room is measured from the panel's place in the document (docTop), not its place
  // in the window, so a page scrolled past the panel's top (a negative `top`, 586 px became 1,769 px after Undo at
  // 1920x947) sizes it exactly as an unscrolled page does; nothing is stored, so nothing goes stale.
  const docTop = top + window.scrollY;
  // Same phone minimum as app.js's copy (70% of the window's height at max-width 700px, via expand.js).
  const phoneMin = phoneMinHeight();
  const available = Math.max(window.innerHeight - docTop - reserve, phoneMin);
  const rows = panelEl.querySelectorAll("tbody tr");
  const borderAllowance = panelEl.offsetHeight - panelEl.clientHeight;
  if (rows.length === 0) {
    panelEl.style.maxHeight = phoneMin
      ? `${Math.max(Math.round(window.innerHeight - docTop - reserve), phoneMin)}px`
      : `calc(100vh - ${Math.round(docTop)}px - ${Math.round(reserve)}px)`;
    return;
  }
  let lastFitBottom = null;
  rows.forEach((row) => {
    const bottomOffset = row.getBoundingClientRect().bottom + window.scrollY - docTop; // the row's bottom below the panel's top
    if (bottomOffset <= available) lastFitBottom = bottomOffset;
  });
  if (lastFitBottom == null) {
    // Not even one body row fits: show through the header only rather than clip a partial row.
    const theadEl = panelEl.querySelector("thead");
    lastFitBottom = theadEl ? theadEl.getBoundingClientRect().bottom + window.scrollY - docTop : 0;
  }
  panelEl.style.maxHeight = `${Math.floor(lastFitBottom + borderAllowance)}px`;
}

export function commit() {
  savePersisted();
  if (lastContainer) renderLineupPanel(lastContainer);
}

// --------------------------------------------------------------------------------------------------------
// Derived data
// --------------------------------------------------------------------------------------------------------

// 🔵 finding 3: the totals are read live off the current board rows, and a null own on any placed player makes
// the total unknown rather than silently smaller.
export function computeTotals(rowById) {
  let salaryUsed = 0;
  const projs = [];
  let totalOwn = 0;
  let ownUnknown = false;
  let filled = 0;
  for (const s of state.slots) {
    if (!s) continue;
    const row = rowById.get(String(s.id));
    if (!row) continue; // not on this slate; validateAgainstBoard drops these on the next board load
    filled++;
    salaryUsed += row.salary ?? 0;
    projs.push(row.proj);
    if (row.own == null) ownUnknown = true;
    else totalOwn += row.own;
  }
  // ChatGPT wish d, Adam 2026-10-17: the total is the sum of the slot projections as shown (totals.js).
  return { filled, salaryUsed, salaryLeft: SALARY_CAP - salaryUsed, totalProj: shownTotal(projs) ?? 0, totalOwn: ownUnknown ? null : totalOwn };
}

/** First empty slot legal for `pos`: its own slot(s) first, then FLEX for RB/WR/TE. -1 if none is free. */
function legalSlotIndex(pos) {
  for (let i = 0; i < LINEUP_SLOTS.length; i++) {
    if (!state.slots[i] && LINEUP_SLOTS[i] === pos) return i;
  }
  if (FLEX_POS.has(pos)) {
    for (let i = 0; i < LINEUP_SLOTS.length; i++) {
      if (!state.slots[i] && LINEUP_SLOTS[i] === "FLEX") return i;
    }
  }
  return -1;
}

/** A non-blocking heads-up for Add on a sidelined or projection-less row (🔵 finding 8): Adam may know
 *  better than the board does, so the player is still added — this only tells him why the row looked odd. */
function addWarning(row) {
  const reasons = [];
  const statusKey = (row.status ?? "").trim().toLowerCase();
  if (rowIsOut(row)) {
    const label = STATUS_INFO[statusKey]?.label ?? row.status;
    const tgReason = row.tg?.call === "OUT" ? twoGunOutReason(row) : null;
    if (tgReason) reasons.push(`is ruled out (${tgReason.replace(/\.$/, "")})`);
    else reasons.push(label ? `is listed ${label} and may not play` : "is ruled out");
  }
  if (row.proj == null) reasons.push("has no projection");
  if (!reasons.length) return null;
  return `${row.name} ${reasons.join(" and ")} — added anyway.`;
}

/** Puts him in the first slot his position can fill. True when he went in. Optimizer standard D3 (round 3): the click that puts him in never locks him;
 *  the slots are the base lineup a Build starts from (lockedIds), and his Lock button is his own. */
function addPlayer(row, rowById) {
  const rowId = String(row.id);
  if (state.excludes.has(rowId)) return false;
  const identity = dkIdentity(row);
  const alreadyPlaced = state.slots.some((s) => {
    if (!s) return false;
    const placedRow = rowById.get(String(s.id));
    return placedRow && dkIdentity(placedRow) === identity;
  });
  if (alreadyPlaced) return false;
  // 🔵 finding 4: a player with no DraftKings salary can never be weighed against the cap.
  state.addErrorId = rowId; // whatever this click says is drawn beside his row (row-message.js)
  state.addTone = undefined;
  if (row.salary == null) {
    state.addError = `${row.name} has no DraftKings salary, so he cannot be costed against the cap.`;
    return false;
  }
  const idx = legalSlotIndex(row.pos);
  if (idx === -1) {
    const flexNote = FLEX_POS.has(row.pos) ? " or FLEX" : "";
    state.addError = `No empty ${row.pos}${flexNote} slot is open for ${row.name}.`;
    return false;
  }
  state.slots[idx] = { id: rowId, slot: LINEUP_SLOTS[idx] };
  state.addError = addWarning(row);
  return true;
}

// DECISIONS.md D70: pool Lock = in the base lineup, unlock = out of it. Unlock clears his slot too (a pool-only
// lock from older saved state has no slot and just loses the lock). Lock places him like a click does and then
// locks him (a click alone never does, D3); already placed (under this id, or the same DraftKings player under another id): lock that
// placed copy. Excluded or refused: nothing locks, and addPlayer's state.addError sentence shows.
export function unlockPool(id) {
  state.locks.delete(id);
  for (let i = 0; i < state.slots.length; i++) {
    if (state.slots[i] && String(state.slots[i].id) === id) state.slots[i] = null;
  }
  state.addError = null;
}

export function lockPool(id) {
  if (state.excludes.has(id)) return;
  const rowById = new Map((store.get().board?.rows ?? []).map((r) => [String(r.id), r]));
  const row = rowById.get(id);
  if (!row) return;
  state.addError = null;
  const identity = dkIdentity(row);
  const placedSlot = state.slots.find((s) => {
    const placedRow = s ? rowById.get(String(s.id)) : null;
    return placedRow && dkIdentity(placedRow) === identity;
  });
  if (placedSlot) {
    state.locks.add(String(placedSlot.id));
    return;
  }
  // A18 (round 3 fixes): Lock seats a man by the same rules as a click. A row the pool greys (it does not fit the salary left, no seat is open, no figure)
  // is refused with the greying's own sentence beside his row, and nothing locks.
  const pick = poolPickerNow(rowById)(row);
  if (pick.action !== "add") {
    state.addErrorId = String(row.id);
    state.addError = pick.reason;
    state.addTone = undefined;
    return;
  }
  if (addPlayer(row, rowById)) state.locks.add(String(row.id));
}

/** Takes slot `i`'s man out (a click on the filled slot card, the old Clear button's rule): his lock goes, and an Undo made before it is
 *  dropped (Cash 3b fix round 2, 2026-10-17: a cleared slot is never silently refilled by Undo). An empty slot does nothing. */
export function removeSlot(i) {
  const p = state.slots[i];
  if (!p) return;
  state.locks.delete(p.id);
  state.slots[i] = null;
  state.addError = null;
  opt.cashUndo = null;
}

/** A click on his pool row (D81 counterpart of 336c1f5; lineup-view.js classicPickAction drew the action): "add" places him in the first
 *  slot his position can fill, by addPlayer's rules and refusals (excluded, already placed, no salary, no open slot: the sentence shows
 *  under the slots); "remove" takes out every slot holding the same DraftKings player (🔵 finding 6), as removeSlot does. Either drops an
 *  Undo made before it (Cash 3b fix round, 2026-10-17). */
export function pickPoolRow(row, action, rowById) {
  if (!row || (action !== "add" && action !== "remove")) return;
  opt.cashUndo = null;
  if (action === "add") {
    addPlayer(row, rowById);
    return;
  }
  const identity = dkIdentity(row);
  state.slots.forEach((s, i) => {
    const placedRow = s ? rowById.get(String(s.id)) : null;
    if (!placedRow || dkIdentity(placedRow) !== identity) return;
    if (state.locks.has(String(s.id))) { // A18: a locked man is not taken out by a click (his row is greyed); Unlock does it
      state.addErrorId = String(row.id);
      state.addTone = undefined;
      state.addError = `${row.name} is locked into your lineup. Unlock him first, or click his slot.`;
      return;
    }
    removeSlot(i);
  });
}

/** Places `entries` ({slot, id}, in any order) into a fresh LINEUP_SLOTS-shaped array, each by its own
 *  `slot` name into the next free slot of that name (🔵 finding 7) — not by its position in the input
 *  array, which need not line up with LINEUP_SLOTS' order. An entry whose slot name has no free slot left
 *  is skipped rather than thrown. Shared by Load and the saved-lineup cards' own roster-order
 *  reconstruction, so both place a saved list the same way. */
export function placeBySlotName(entries) {
  const nextSlots = new Array(LINEUP_SLOTS.length).fill(null);
  for (const entry of entries) {
    const slotName = String(entry?.slot ?? "").trim().toUpperCase();
    const idx = LINEUP_SLOTS.findIndex((s, i) => s === slotName && nextSlots[i] === null);
    if (idx === -1) continue;
    nextSlots[idx] = { id: String(entry.id), slot: slotName };
  }
  return nextSlots;
}

// --------------------------------------------------------------------------------------------------------
// Saved lineups
// --------------------------------------------------------------------------------------------------------

/** The {slot, playerId} list sent for the filled slots (the server fills in the rest of the snapshot). */
export function savePayload(slots) {
  return slots.map((s, i) => (s ? { slot: LINEUP_SLOTS[i], playerId: String(s.id) } : null)).filter(Boolean);
}

/** Saves the placed players: a loaded lineup is edited in place (PUT); Copy and a save with nothing loaded POST a new
 *  one and load it (PROJECT.md Part 4 Lineups). Only a wholly empty lineup is refused here. */
async function doSaveLineup(name, { asNew = false } = {}) {
  if (state.saving) return;
  const slotsPayload = savePayload(state.slots);
  if (slotsPayload.length === 0) {
    state.saveError = "Add at least one player to the lineup before saving.";
    state.saveTone = "warn"; // a refusal, not a failure: amber (row-message.js)
    state.saveConfirm = null;
    commit();
    return;
  }
  state.saving = true;
  state.saveError = null;
  state.saveConfirm = null;
  state.saveName = name;
  commit();
  const editId = !asNew && state.loadedId ? state.loadedId : null;
  const keyAtStart = lastSavedKey;
  const slateAtStart = currentMemoryKey();
  const loadedAtStart = state.loadedId;
  const modeAtStart = opt.mode;
  const slate = slateKeyOf(store.get().board);
  // A cash hand save records the board's Cash basis (board.mode.cashMode), as a cash batch does (code review of a9455a0, MUST 1
  // follow-up); a board naming none records no boardMode. A GPP hand save keeps the header's mode.
  const handMode = opt.mode === "cash" ? store.get().board?.mode?.cashMode : boardModeOf(store.get().board);
  let data = null;
  let failure = null;
  try {
    data = editId
      ? await putLineup(editId, { name, slots: slotsPayload, slate })
      : await postLineup({ name: asNew ? uniqueSavedName(name, savedOfActiveSlate(null).map((l) => l.name)) : name, slots: slotsPayload, slate, ...(opt.mode === "cash" ? { mode: "cash" } : {}), build: handBuild(handMode) }); // Cash mode job 3b: names stay unique across both modes; a new lineup carries the mode on screen (Cash 3b fix round: only "cash" is sent, so GPP files keep their old shape)
  } catch (e) {
    failure = `Could not reach the server: ${e.message}`;
  }
  const after = afterSave({ data, name, editId, weekChanged: lastSavedKey !== keyAtStart, loadedAtStart, loadedNow: state.loadedId, slateChanged: currentMemoryKey() !== slateAtStart, modeChanged: opt.mode !== modeAtStart });
  if (!after.discard) {
    if (Array.isArray(data?.lineups)) state.savedLineups = data.lineups;
    if (after.dropId) state.savedLineups = state.savedLineups.filter((l) => l.id !== after.dropId);
    if ("loadedId" in after) state.loadedId = after.loadedId;
    if ("saveName" in after) state.saveName = after.saveName;
    state.saveError = failure ?? after.saveError ?? null;
    state.saveTone = "error"; // the server's answer or a lost connection: a failure
    state.saveConfirm = after.saveConfirm ?? null;
  }
  state.saving = false;
  commit();
}

/** What a finished save changes (PROJECT.md Part 4 Lineups): {discard} for a week changed under the request; a Load or
 *  Clear lineup made during the save keeps its loadedId and name; NOT_FOUND and READ_ONLY unload the edited lineup. */
export function afterSave({ data, name, editId, weekChanged, loadedAtStart, loadedNow, slateChanged = false, modeChanged = false }) {
  if (weekChanged) return { discard: true };
  const moved = slateChanged || modeChanged || loadedNow !== loadedAtStart; // a slate or a tab switched under the request: the list is updated, but the new lineup is not loaded (nor its name put in the box) on a slate or tab it was not made on (Part F)
  if (!data || data.ok === false) {
    const code = data?.error?.code;
    const unload = editId && (code === "NOT_FOUND" || code === "READ_ONLY");
    const out = { saveError: data?.error?.message ?? "Could not save the lineup.", dropId: editId && code === "NOT_FOUND" ? editId : null };
    return moved ? out : { ...out, loadedId: unload ? null : loadedNow };
  }
  const shown = data.lineup?.name;
  const out = { saveConfirm: editId ? `Updated "${shown ?? name}".` : `Saved "${shown ?? ""}".` };
  return moved ? out : { ...out, loadedId: editId ?? data.lineup?.id ?? null, saveName: shown ?? name };
}

export const lineupBusy = new Set(); // saved lineup ids with a card PUT in flight: their letter and rename Save are disabled
const lineupPutSeq = new Map(); // saved lineup id -> the number of its newest card PUT (busy and its refusal are per lineup)
let lineupPutLast = 0; // 🔵/👁 2026-10-17: one counter across all lineups' card PUTs
let lineupPutApplied = 0; // the newest card PUT whose answer set savedLineups; an older answer never replaces it

/** The one PUT of a saved card (letter, rename; 🔵 2026-10-17): busy until answered, only the newest answer per lineup
 *  and week counts; a refusal stays on the card until its next good PUT. True when the change held and its list is shown. */
async function putLineupGuarded(id, body) {
  const mine = ++lineupPutLast;
  lineupPutSeq.set(id, mine);
  lineupBusy.add(id);
  const keyAtStart = lastSavedKey;
  commit();
  let data = null;
  let failure = null;
  try {
    data = await putLineup(id, body);
  } catch (e) {
    failure = `Could not reach the server: ${e.message}`;
  } finally {
    if (lineupPutSeq.get(id) === mine) lineupBusy.delete(id);
  }
  if (lineupPutSeq.get(id) !== mine || lastSavedKey !== keyAtStart) return false;
  if (!failure && data && data.ok !== false && Array.isArray(data.lineups)) {
    delete state.lineupErrors[id];
    if (mine < lineupPutApplied) return false; // a newer card PUT's list (any lineup) is already shown
    lineupPutApplied = mine;
    state.savedLineups = data.lineups;
    return true;
  }
  state.lineupErrors[id] = failure ?? data?.error?.message ?? "Could not save that change.";
  return false;
}

async function doRenameLineup(id, name) {
  state.renamingId = null;
  if ((await putLineupGuarded(id, { name })) && id === state.loadedId) {
    state.saveName = state.savedLineups.find((l) => l.id === id)?.name ?? state.saveName;
  }
  commit();
}

/** A saved card's letter (Adam 2026-10-17, entries fill plan 7a). */
async function doLineupPut(id, payload) {
  await putLineupGuarded(id, payload);
  commit();
}

/** A12 (round 3): a delete that did not happen says so on the card (the badge the card keeps for a refused change), in red, until the next try or a good answer. */
async function doDeleteLineup(id) {
  state.deleteConfirmId = null;
  delete state.deleteErrors[id];
  commit();
  try {
    const data = await deleteLineup(id);
    if (data && data.ok !== false && Array.isArray(data.lineups)) state.savedLineups = data.lineups;
    else state.deleteErrors[id] = notDeletedText({ data }); // one plain red sentence on the card's Load and Delete row, the same words as Showdown's (A12, item 16)
  } catch (e) {
    console.warn("Delete: the request did not come back", e);
    state.deleteErrors[id] = notDeletedText({ error: e });
  }
  commit();
}

/** Puts a saved lineup's players back into the builder's slots, replacing whatever is there, via
 *  placeBySlotName() — so an off-slate player (dropped by validateAgainstBoard on the next render) and
 *  totals/locks behave exactly as they do after any other slot change. C11 (round 3): the old locks go with the old lineup, and the slots come into
 *  view (A12), since a saved card can be far below them. */
function doLoadLineup(id) {
  const lineup = state.savedLineups.find((l) => l.id === id);
  if (!lineup) return;
  state.confirm = null;
  state.slots = placeBySlotName((lineup.slots ?? []).map((s) => ({ slot: s.slot, id: s.playerId })));
  state.locks = new Set();
  state.loadedId = lineup.id;
  state.saveName = lineup.name ?? "";
  state.saveError = null;
  state.saveConfirm = null;
  state.addError = null;
  opt.cashUndo = null; // Cash 3b fix round 2, 2026-10-17: Undo never replaces a loaded lineup
  commit();
  if (store.get().activeTab === "lineups") store.set({ activeTab: "lineup" }); // the working lineup is hidden on the Lineups tab: Load shows the Optimizer first, as Showdown does
  scrollToSlots();
}

/** A12: brings the working lineup's band into view, whole under the sticky layers (a Load from a card far below it; show-band.js). */
function scrollToSlots() {
  showBand(lastContainer, "lineup-panel");
}

/** C11: whether the working lineup holds men that no saved lineup of this slate has as its set: loading over it would lose them, so Load asks first. */
export function workingLineupUnsaved(slots, saved, rowById) {
  const ids = slots.filter(Boolean).map((s) => s.id);
  if (!ids.length) return false;
  return !savedSetKeys(saved, rowById).has(lineupSetKey(ids, rowById));
}

/** Load: straight away, or after `Replace your working lineup?` when the working lineup is not saved (C11). */
function requestLoad(id) {
  const rowById = boardRowMap(store.get().board);
  if (workingLineupUnsaved(state.slots, savedOfActiveSlate(null), rowById)) {
    state.confirm = `load:${id}`;
    commit();
    return;
  }
  doLoadLineup(id);
}

/** B13, B6: what Clear lineup would lose (a man or a lock; never the excludes or, in Cash, the Wants): the question is asked only when there is something to lose. */
export function clearAllHasContent() {
  return clearLineupHasContent({ slots: state.slots, locks: state.locks });
}

function doClearAll() {
  state.confirm = null;
  Object.assign(state, clearedLineup(LINEUP_SLOTS.length)); // B6: the slots and the locks go; the excludes and, in Cash, the Wants stay (lineup-clear.js)
  opt.cashUndo = null; // the Undo goes: it restores a build that is no longer on the slots, so it would be a button that does nothing (removeSlot's rule)
  state.addError = null;
  clearLoaded();
  commit();
}

// --------------------------------------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------------------------------------

/** Esc and a click outside close every open confirm alike (Clear lineup, Load over unsaved work, a saved card's Delete): one registration for the page; the
 *  panel's markup is redrawn on every change, the state is what survives (confirm-inline.js onConfirmDismiss). */
let dismissWired = false;
function wireConfirmDismiss() {
  if (dismissWired || typeof document === "undefined" || typeof document.addEventListener !== "function") return; // a test's stand-in page has none
  dismissWired = true;
  onConfirmDismiss(() => {
    if (!state.confirm && !state.deleteConfirmId) return;
    state.confirm = null;
    state.deleteConfirmId = null;
    commit();
  });
}

let focusedConfirm = null; // the confirm that last took the keyboard, so a redraw while it stays open does not take it again
/** A confirm that has just opened takes the keyboard on its safe button (No); Yes and No are in the tab order after the control. */
function focusOpenConfirm(container) {
  const key = state.confirm ?? (state.deleteConfirmId ? `delete:${state.deleteConfirmId}` : null);
  if (key && key !== focusedConfirm) container.querySelector(state.confirm ? "[data-confirm='no']" : "[data-action='lineup-delete-no']")?.focus?.();
  focusedConfirm = key;
}

function wire(container) {
  wireConfirmDismiss();
  // An empty pool offers the filter bar's own Clear filters (lineup-pool.js NO_MATCH_TEXT): the one button does the one reset, search and salary boxes included.
  container.querySelectorAll("[data-action='pool-clear-filters']").forEach((btn) => {
    btn.addEventListener("click", () => document.getElementById("clear-filters-btn")?.click());
  });
  // B13 (round 3): Clear lineup asks first when it would lose something; the question sits beside the button (confirm-inline.js).
  container.querySelector("#lineup-clear-all-btn")?.addEventListener("click", () => {
    if (!clearAllHasContent()) return doClearAll();
    state.confirm = "clear";
    commit();
  });
  container.querySelectorAll("[data-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const which = btn.dataset.confirmFor ?? "";
      const yes = btn.dataset.confirm === "yes";
      if (!yes) {
        state.confirm = null;
        commit();
      } else if (which === "clear") doClearAll();
      else if (which.startsWith("load:")) doLoadLineup(which.slice(5));
    });
  });
  wireDkDownload(container, {
    selected: state.dkSelected,
    shown: () => shownSavedLineups(boardRowMap(store.get().board)),
    kind: "classic",
    board: () => store.get().board,
    slateKey: () => slateKeyOf(store.get().board),
    slateLabel: () => slateKeyOf(store.get().board),
    setStatus: (text) => { state.dkStatus = text; },
    redraw: () => commit(),
  });

  // A click (or Enter / Space) on a filled slot card takes his man out (D81 counterpart of 336c1f5: no Clear buttons); his name keeps opening his card.
  container.querySelectorAll("[data-action='slot-remove']").forEach((el) => {
    wirePick(el, SLOT_PICK_SKIP, () => {
      removeSlot(Number(el.dataset.slot));
      commit();
    });
  });

  container.querySelectorAll("[data-action='row-lock']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (state.locks.has(id)) unlockPool(id);
      else lockPool(id);
      commit();
    });
  });
  // Cash mode job 3b, 2026-10-17: a Must | Want | Fine click on the pool row.
  container.querySelectorAll("[data-cash-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      cashPick(btn.dataset.id, btn.dataset.cashPick);
      commit();
    });
  });
  // The pool's sortable headers write the store's global sort, exactly what the ranked list's headers write (app.js
  // onSortClick); its filters come from the one filter bar above (Optimizer-first step 4: the pool's own chip row and
  // search chip are gone, and with them its Show all players button). The store change re-renders this panel (keeping the pool's scroll position).
  container.querySelectorAll("[data-action='toggle-star']").forEach((btn) => {
    btn.addEventListener("click", () => poolStarClick(btn.dataset.id));
  });
  container.querySelectorAll(".lineup-rows-table th[data-col]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      const sort = store.get().sort;
      if (sort.col === col) store.setSort({ dir: sort.dir === "asc" ? "desc" : "asc" });
      else store.setSort({ col, dir: defaultDirFor(col) });
    });
  });
  container.querySelectorAll("[data-action='row-exclude']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      opt.cashUndo = null; // Cash 3b fix round, 2026-10-17: an exclude after Make them Must is never silently undone by Undo
      if (state.excludes.has(id)) {
        state.excludes.delete(id);
      } else {
        state.excludes.add(id);
        state.locks.delete(id);
        for (let i = 0; i < state.slots.length; i++) {
          if (state.slots[i] && state.slots[i].id === id) {
            state.slots[i] = null;
            clearAddMessage(); // the slot he held is open again: "no empty slot" is no longer true
          }
        }
      }
      commit();
    });
  });
  // A click (or Enter / Space) on a pool row puts the man in or takes him out (D81 counterpart of 336c1f5: no Add button); his name, the
  // star, the bump, the boxes, the Cash chips, Lock and Exclude keep their own jobs (CLASSIC_POOL_PICK_SKIP).
  wirePickRows(container, CLASSIC_POOL_PICK_SKIP, (id, action) => {
    const rowById = boardRowMap(store.get().board);
    const row = rowById.get(String(id));
    if (!row) return;
    pickPoolRow(row, action, rowById);
    commit();
  });

  // Save lineup: the name box is read here, at click time, rather than tracked in state on every
  // keystroke — that would re-render the whole panel on every character and steal the input's focus.
  for (const [btnId, asNew] of [["#lineup-save-btn", false], ["#lineup-save-new-btn", true]]) {
    container.querySelector(btnId)?.addEventListener("click", () => {
      const nameInput = container.querySelector("#lineup-save-name");
      doSaveLineup(nameInput ? nameInput.value : "", { asNew });
    });
  }

  container.querySelectorAll("[data-action='lineup-rename-start']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.renamingId = btn.dataset.id;
      state.deleteConfirmId = null;
      commit();
    });
  });
  container.querySelectorAll("[data-action='lineup-rename-cancel']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.renamingId = null;
      commit();
    });
  });
  container.querySelectorAll("[data-action='lineup-rename-save']").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Only one card is ever in rename mode at a time, so a single data-rename-input is on the page.
      const input = container.querySelector("[data-rename-input]");
      doRenameLineup(btn.dataset.id, input ? input.value : "");
    });
  });

  wireRenameEnter(container, "[data-action='lineup-rename-save']", (id, text) => doRenameLineup(id, text)); // Enter saves the new name, as Save does (and as Showdown's box does)

  container.querySelectorAll("[data-action='lineup-tag']").forEach((sel) => {
    sel.addEventListener("change", () => doLineupPut(sel.dataset.id, { tag: sel.value || null }));
  });

  container.querySelectorAll("[data-action='lineup-delete-start']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.deleteConfirmId = btn.dataset.id;
      state.renamingId = null;
      delete state.deleteErrors[btn.dataset.id]; // a new try clears the last delete's failure sentence (A12)
      commit();
    });
  });
  container.querySelectorAll("[data-action='lineup-delete-no']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.deleteConfirmId = null;
      commit();
    });
  });
  container.querySelectorAll("[data-action='lineup-delete-yes']").forEach((btn) => {
    btn.addEventListener("click", () => doDeleteLineup(btn.dataset.id));
  });

  container.querySelectorAll("[data-action='lineup-load']").forEach((btn) => {
    btn.addEventListener("click", () => requestLoad(btn.dataset.id));
  });

  const setup = poolColumnSetup();
  wireColumns(container, { ...setup, available: () => poolAvailableKeys(setup.defs), onChange: () => commit() }); // A17: the Columns button on the pool's heading; the TwoGun columns are offered on a TwoGun board only

  wireOptimizer(container);
}

// --------------------------------------------------------------------------------------------------------
// Optimizer (PROJECT.md Part 4 "Optimizer"; DECISIONS.md D55 as amended 2026-10-10, D43, D32, D57).
// "Make N more lineups from these locks": the slots Adam has filled (a pool Lock places the player in a slot, then locks him) are the locks, the D55
// rules are toggle chips (all on), and the per-position maximum exposure boxes are his own (blank = no cap).
// POST /api/lineup/generate returns lineups that are NOT saved; each card is saved through the existing
// save-lineup route or discarded. The form's values live in `opt` (typed text is kept as typed), so the whole
// panel can re-render without losing a box; only the pool's per-player Max % boxes go to localStorage (with the
// locks). The results are two tabs, New and Saved, each with its own exposure (D74).
// --------------------------------------------------------------------------------------------------------

export const OPT_MAX_COUNT = 150;
export const OPT_MAX_UNIQUE = 8;
export const OPT_DEFAULT_COUNT = 5;
export const OPT_DEFAULT_UNIQUE = 1;
// D73: the QB stack's choices (server/lineup/multi.js STACK_OWN_MAX / STACK_OPP_MAX) and defaults, "or more" ticked.
export const OPT_STACK_OWN_MAX = 4;
export const OPT_STACK_OPP_MAX = 3;
export const OPT_DEFAULT_STACK = { stackOwn: 1, stackOwnOrMore: true, stackOpp: 0, stackOppOrMore: true };
export const OPT_BUSY_TEXT = "Another set of lineups is still being made. Try again in a moment.";

/** The four D55 rules, in the server's rule keys (server/lineup/multi.js RULE_KEYS), with Adam's chip words. The QB
 *  stack is the band's "Stack QB with" controls instead (D73). */
export const OPT_RULES = [
  { key: "starredQbOnly", label: "Starred QBs only" },
  { key: "noSameTeamRbs", label: "no same-team RBs" },
  { key: "noSameGameRbs", label: "no same-game RBs" },
  { key: "noDstVsOwnPlayers", label: "no DST vs own players" },
];

// 🔵 2026-10-17: the rule keys named once; each OPT_RULES key sits in exactly one group (Pool or Build) of the panel.
export const RULE_GROUPS = Object.freeze({ pool: ["starredQbOnly"], build: ["noSameTeamRbs", "noSameGameRbs", "noDstVsOwnPlayers"] });

export const opt = {
  mode: "gpp", // Cash mode job 3b, 2026-10-17: "gpp" | "cash"; the slots, locks and excludes in `state` belong to this mode
  cash: defaultCashState(), // cash's own settings and Want lists (lineup-cash.js)
  stash: {}, // the other mode's slots, locks, excludes, loadedId and name for this page view only (swapModeStash); the browser memory holds them per slate and mode (lineup-memory-sync.js), the stash is the fallback of a browser with no storage
  cashUndo: null, // {slots, locks, after, names}: the build before the last "Make them Must and rebuild" and the one it left (after); page-only
  count: String(OPT_DEFAULT_COUNT),
  minUnique: String(OPT_DEFAULT_UNIQUE),
  maxExp: { QB: "", RB: "", WR: "", TE: "", DST: "" }, // percent text as typed; blank = no cap
  rules: Object.fromEntries(OPT_RULES.map((r) => [r.key, ruleOn({}, r.key)])), // Starred QBs only starts off (C12); the others on
  objective: "proj", // one of OBJECTIVES' values (effectiveObjective decides what a build uses)
  maxPerTeam: "", // "" (no limit) or "1".."4", the <select> value
  ...OPT_DEFAULT_STACK, // D73: stackOwn / stackOpp numbers and their "or more" ticks
  avoid: new Set(), // game ids such as "DET@ARI"
  // Per-player Max % from the pool's boxes, per slate key ("main" or a second slate's key): {id: text as typed}.
  // Mirrored to localStorage with the locks (savePersisted); Clear lineup leaves it, as it leaves every Optimizer setting.
  playerMax: {},
  playerMin: {}, // the Min % boxes, shaped like playerMax (PROJECT.md Part 4 Optimizer (Min % and soft rules, Adam 2026-10-17))
  qb: newQbState(), // per-QB stack settings (lineup-qb-stacks.js), keyed by player id, persisted with the locks
  spreadDst: false, // "Spread defenses", per slate in the browser memory
  exp: defaultExpState("classic"), // the one exposure table's sort and Pos filter {col, dir, filter} (lineup-exposure.js, A10), kept in the browser
  sort: cleanSortState(null), // the card lists' sort, per tab: {new: {key, dir}, saved: {key, dir}}, persisted (lineup-sort.js)
  generating: false,
  stopping: false, // Stop was pressed and the build is ending: the button reads "Stopping..." (lineup-stop.js)
  stopError: "", // the sentence under Stop when the server did not hear it (optimizer standard D18)
  saving: false,
  // Part F: each tab's own batch, messages and filter (lineup-tabs.js): resultsTab, mustHave, mustHaveNames, doneNote, error, errorTone, saveError, saveTone, formError and results (results: {slateKey,
  // lineups: [{uid, ids, salary, proj, players, saved?}], notes, builtIn} or null; mustHave: Adam 2026-10-11, "only lineups with" these players, page-only, cleared when the slate or week changes) are properties
  // of `opt` that read and write the tab on screen.
  tabs: newClassicTabs(),
};
bindClassicTabFields(opt);

export function resetOptimizerResults() {
  clearTabBuilds(opt);
  resetBuildNotice(); // what the last build left under the filter bar belongs to the slate it was made for
}

export function clearMustHave() {
  clearTabFilters(opt);
}

export const boardRowMap = (board) => new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
export const qbGlobals = () => ({ stackOwn: opt.stackOwn, stackOwnOrMore: opt.stackOwnOrMore, stackOpp: opt.stackOpp, stackOppOrMore: opt.stackOppOrMore });
export const listedQbIds = (rows) => new Set(listedQbs(rows, lockedIds(state.slots, state.locks)).map((r) => String(r.id)));

function pruneQbStacks(board) {
  if (board && pruneEntries(opt.qb.entries, boardRowMap(board))) savePersisted();
}

export function qbStacksForRequest(board, notes) {
  return qbStacksPayload(opt.qb.entries, boardRowMap(board), listedQbIds(activeSlateRows(board)), notes, lockedIds(state.slots, state.locks));
}

/** The mode switch: the build on screen goes under its mode and the other mode's comes back, through hydrate's slot
 *  normalising and the board check (🔵 on 3a). */
export function setMode(next) {
  if ((next !== "gpp" && next !== "cash") || next === opt.mode) return;
  const wrote = saveClassicMemory(); // the mode on screen goes under its own name in this slate's memory before the other mode's comes back
  const swapped = swapModeStash({ slots: state.slots, locks: [...state.locks], excludes: [...state.excludes], loadedId: state.loadedId, saveName: state.saveName, stash: opt.stash }, opt.mode, next);
  state.slots = normalSlots(swapped.slots) ?? new Array(LINEUP_SLOTS.length).fill(null);
  state.locks = new Set(swapped.locks.map(String));
  state.excludes = new Set(swapped.excludes.map(String));
  state.loadedId = swapped.loadedId;
  state.saveName = swapped.saveName;
  opt.stash = swapped.stash;
  opt.mode = next;
  state.memoryNote = restoreForMode(store.get().board, next, wrote); // A9: the build the new mode remembered for this slate (the page-only copy above when nothing is remembered, or when the write was refused: the memory is then behind this page); a man off the slate on screen never passes
  opt.cashUndo = null;
  state.addError = null;
  lastValidatedBoard = null; // validateAgainstBoard runs again on the restored build
  validateAgainstBoard(store.get().board);
  resetBuildNotice(); // the notice under the filter bar is the last build's, which may be the other tab's
  commit();
}

let lastOptSlateKey;
/** New lineups belong to the slate they were made for (D57): switching the active slate clears them. */
function syncOptimizerSlate() {
  const key = store.get().activeSlateKey ?? null;
  if (key !== lastOptSlateKey) {
    if (lastOptSlateKey !== undefined) {
      resetOptimizerResults();
      clearMustHave(); // Adam 2026-10-11: the "only lineups with" players are cleared when the slate changes
      clearAddMessage();
    }
    lastOptSlateKey = key;
  }
}

// Re-exports: every name this module exported before the split is still importable from here (tabs.js, the tests and the site build import them).
export { setPoolCallbacks, slotPlayerHtml, savedLineupSlotHtml, savedLineupCardHtml, savedGroupsHtml, savedLineupPlayers, savedLineupFigures, saveControlsHtml, poolStarClick, rightColumnHtml, lineupTotalsOf, ruleRowsHtml, starredQbQualifiers, usableQbIds, starredQbNote, avoidChipsHtml, optLineupCardHtml, optNotesHtml, bendsLineHtml, cardIsSaved } from "./lineup-view.js";
export { swapScanHook, parseWhole, parsePct, exposureProblem, exposureOfLineups, lineupSetKey, savedSetKeys, savedForSlate, uniqueSavedName, playerMaxProblem, playerMinProblem, minSlotsFull, minSlotWords, dkKeyOfRow, minRowOut, pairClash, lockStackRefuses, minLockSkips, playerMinPositionProblem, lockedIds, requestCount, minProblemFor, buildGenerateSettings, buildGeneratePayload, slotsForSave, duplicateSaveStatus } from "./lineup-optimizer.js";
