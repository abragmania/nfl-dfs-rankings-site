// Optimizer tab (PROJECT.md D21/D32, D70, Part 4 Lineup Builder screen): the main screen since Optimizer-first step 4 (D21's
// "secondary section" wording is amended by step 6's documents). Top: the Optimizer band (its max-per-team and D73 QB-stack controls included). Left column: the
// nine DraftKings classic slots (D1), a salary bar, totals, Clear all and Save lineup. Right column: the same rows the ranked list
// below is showing — same store, same filters (the one filter bar above sets them, Optimizer-first step 4), same sort (its headers
// set it) — with per-row Lock, Exclude and Add-to-slot buttons. app.js passes #lineup-mount as the container: only that part of
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
import { escapeHtml } from "./format.js";
import { store, FLEX_POS, defaultDirFor, activeSlateRows } from "./state.js";
import { rowIsOut, twoGunOutReason, STATUS_INFO } from "./table.js"; // D43: the one copy of "vs DAL" / "@ DET"
import { shownTotal } from "./totals.js";
import { handBuild } from "./lineup-builds.js";
import { cleanSortState } from "./lineup-sort.js"; // Adam 2026-10-17: sort options; geo own = geometric mean of ownership, his multiplicative uniqueness
import { optExposureHtml, sortExposure, exposureLimit, minLimit, exposureMark, zeroMinRows } from "./lineup-exposure.js";
import { newQbState, listedQbs, pruneEntries, cleanSavedEntries, qbStacksPayload } from "./lineup-qb-stacks.js";
import { getLineups, postLineup, putLineup, deleteLineup } from "./api.js";
import { renderEntriesSection, wireEntries } from "./entries-wire.js";
import { phoneMinHeight, panelMinHeight } from "./expand.js";
import { defaultCashState, cleanCashState, swapModeStash } from "./lineup-cash.js";
import { setPoolCallbacks, poolStarClick, panelHtml, savedOfActiveSlate } from "./lineup-view.js";
import { cleanPlayerMax, boardModeOf, slateKeyOf, uniqueSavedName, lockedIds, cashPick, wireOptimizer } from "./lineup-optimizer.js";

export const LINEUP_SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
export const SALARY_CAP = 50000;
// The lineups maximise projection or TwoGun's ceiling, Adam's pick each time (TwoGun merge 2026-10-15; server/lineup/
// multi.js OBJECTIVES). Ceiling needs a board carrying TwoGun's ceilings (TwoGun mode): otherwise it is greyed with the
// reason on hover and the build is by projection. The Leverage and Projection-minus-ownership objectives are gone
// (Adam 2026-10-15); the server builds any older request naming a retired one on projection, with a note.
export const OBJECTIVES = [
  { value: "proj", label: "Projection" },
  { value: "ceil", label: "Ceiling" },
];
export const NO_CEILING_REASON = "Ceiling needs TwoGun's ceilings, and this board has none (current mode, or no TwoGun board could be read).";

/** The objective a build uses: Adam's pick, except Ceiling on a board with no ceilings, which builds by projection
 *  (the Ceiling choice is greyed then; his pick comes back when the board has ceilings again). */
export function effectiveObjective(picked, hasCeilings) {
  if (picked === "ceil") return hasCeilings ? "ceil" : "proj";
  return OBJECTIVES.some((o) => o.value === picked) ? picked : "proj";
}

/** The Projection / Ceiling choice in the Optimizer band. A greyed choice keeps its hover reason (aria-disabled, not
 *  disabled, so the browser still shows the title) and a short dim "(TwoGun mode only)" after it (visual QA V4). */
export function objectiveChipsHtml(picked, hasCeilings) {
  const active = effectiveObjective(picked, hasCeilings);
  return OBJECTIVES.map((o) => {
    const off = o.value === "ceil" && !hasCeilings;
    const on = o.value === active;
    const title = off ? NO_CEILING_REASON : o.value === "ceil" ? "Build the lineups with the highest total of TwoGun's published ceilings" : "Build the lineups with the highest total projection";
    const chip = `<button type="button" class="chip toggle-chip opt-chip${on ? " active" : ""}${off ? " is-disabled" : ""}" data-action="opt-objective" data-value="${o.value}" aria-pressed="${on}"${off ? ` aria-disabled="true"` : ""} title="${escapeHtml(title)}">${escapeHtml(o.label)}</button>`;
    return off ? `${chip}<span class="opt-sub" title="${escapeHtml(NO_CEILING_REASON)}">(TwoGun mode only)</span>` : chip;
  }).join("");
}

/** The words a set of new lineups is labelled with: the mode and objective it was built in, so a set made before a
 *  mode flip says so ("TwoGun mode, by ceiling"). */
export function builtInText(mode, objective) {
  return `${mode === "twogun" ? "TwoGun" : "current"} mode, by ${objective === "ceil" ? "ceiling" : "projection"}`;
}

export { optExposureHtml, sortExposure, exposureLimit, minLimit, exposureMark, zeroMinRows }; // lineup-exposure.js
export const MAX_TEAM_OPTIONS = ["", "1", "2", "3", "4"];
const STORAGE_KEY = "nfldfs.lineupBuilder.v1";

export const state = {
  slots: new Array(LINEUP_SLOTS.length).fill(null), // each: {id, slot} or null; row fields are read live
  locks: new Set(), // player ids (strings) the Optimizer must use (D70: a filled slot is always one)
  excludes: new Set(), // player ids (strings) that must never appear
  addError: null, // set when Add is blocked, or as a non-blocking warning after a successful Add

  // Saved lineups (Adam's "draw up a lineup, press Save, see it in a list").
  savedLineups: [], // server records: [{id, name, savedAt, slots:[{slot,playerId,name,team,pos,salary,proj,own}], salaryUsed, totalProj}]
  savedLoaded: false, // true once the current GET /api/lineups has resolved (success or failure)
  savedError: null, // the server's error.message from a failed GET (e.g. LINEUPS_UNREADABLE), else null
  saveName: "", // the name box's value, only read/committed at Save-click time so typing never re-renders
  loadedId: null, // id of the saved lineup the builder was loaded from (Save writes back to it), else null
  saving: false,
  saveError: null,
  saveConfirm: null, // a short "Saved ..." message shown once after a successful save
  renamingId: null, // id of the saved lineup currently showing its inline rename box, or null
  deleteConfirmId: null, // id of the saved lineup currently showing its inline "Delete this lineup?" prompt, or null
  lineupErrors: {}, // saved lineup id -> the server's message for a refused letter change; cleared by its next good PUT
};

let savedFetchInFlightKey = null; // the season-week key a GET is currently in flight for, else null

/** Forgets the loaded saved lineup and its prefilled name together (PROJECT.md Part 4 Lineups). */
function clearLoaded() {
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

export function savePersisted() {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        slots: state.slots,
        locks: [...state.locks],
        excludes: [...state.excludes],
        playerMax: opt.playerMax, // per slate key: {id: "typed text"} (the pool's Max % boxes)
        playerMin: opt.playerMin,
        qbStacks: opt.qb.entries,
        spreadDst: opt.spreadDst,
        mode: opt.mode, // Cash mode job 3b, 2026-10-17: the switch, cash's own settings and Want lists, and the other mode's slots
        cash: opt.cash,
        stash: opt.stash,
        sort: opt.sort,
      })
    );
  } catch (e) {
    // localStorage unavailable (private mode, quota, disabled) — state just won't survive a reload.
  }
}

let hydrated = false;

// Cash mode job 3b, 2026-10-17: hydrate's slot normalising, also run on the slots a mode switch restores; null when `raw` is no nine-slot list.
const normalSlots = (raw) =>
  Array.isArray(raw) && raw.length === LINEUP_SLOTS.length ? raw.map((s, i) => (s && s.id != null ? { id: String(s.id), slot: LINEUP_SLOTS[i] } : null)) : null;

// Cash mode job 3b: the other mode's saved build as storage gives it back (loadedId and saveName live in memory only).
function cleanStash(raw) {
  const out = {};
  for (const mode of ["gpp", "cash"]) {
    const s = raw?.[mode];
    if (!s || typeof s !== "object") continue;
    const ids = (list) => (Array.isArray(list) ? list.map(String) : []);
    out[mode] = { slots: normalSlots(s.slots) ?? new Array(LINEUP_SLOTS.length).fill(null), locks: ids(s.locks), excludes: ids(s.excludes), loadedId: null, saveName: "" };
  }
  return out;
}

/** Reads localStorage exactly once per page load. Everything it accepts is still subject to
 *  validateAgainstBoard() once a board exists (🔵 finding 1), so a stale slate never survives here. */
function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  const persisted = loadPersisted();
  if (!persisted) return;
  const slots = normalSlots(persisted.slots);
  if (slots) state.slots = slots;
  opt.mode = persisted.mode === "cash" ? "cash" : "gpp"; // Cash mode job 3b
  opt.cash = cleanCashState(persisted.cash);
  opt.stash = cleanStash(persisted.stash);
  opt.sort = cleanSortState(persisted.sort);
  if (Array.isArray(persisted.locks)) state.locks = new Set(persisted.locks.map(String));
  if (Array.isArray(persisted.excludes)) state.excludes = new Set(persisted.excludes.map(String));
  opt.playerMax = cleanPlayerMax(persisted.playerMax);
  opt.playerMin = cleanPlayerMax(persisted.playerMin);
  opt.qb.entries = cleanSavedEntries(persisted.qbStacks, OPT_STACK_OWN_MAX, OPT_STACK_OPP_MAX);
  opt.spreadDst = persisted.spreadDst === true;
  // Older saved state may still carry the removed Build's objective / maxFromTeam / stackQbWith; they are ignored
  // and dropped on the next save.
  // 🔵 finding 5: an id in both locks and excludes is dropped from both.
  for (const id of [...state.locks]) {
    if (state.excludes.has(id)) {
      state.locks.delete(id);
      state.excludes.delete(id);
    }
  }
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
  lastValidatedBoard = board;
  opt.cashUndo = null; // Cash 3b fix round 2, 2026-10-17: a snapshot made on another board never comes back past this check
  const savedKey = seasonWeekKey(board);
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
  }
  const rowById = new Map((board.rows ?? []).map((r) => [String(r.id), r]));
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

export function renderLineupPanel(container, callbacks) {
  lastContainer = container;
  if (callbacks) setPoolCallbacks(callbacks);
  hydrateFromStorage();
  validateAgainstBoard(store.get().board);
  if (state.loadedId && state.savedLoaded && !state.savedLineups.some((l) => l.id === state.loadedId)) clearLoaded();
  pruneQbStacks(store.get().board);
  syncOptimizerSlate();
  // 🔵 finding 9: the pool's scroll position must survive the innerHTML rebuild below.
  const prevPool = container.querySelector(".lineup-rows-wrap");
  const savedScrollTop = prevPool ? prevPool.scrollTop : 0;
  container.innerHTML = panelHtml();
  wire(container);
  const newPool = container.querySelector(".lineup-rows-wrap");
  if (newPool) newPool.scrollTop = savedScrollTop;
  resizeLineupScrollPanels(container);
  watchFooter(container);
}

// Optimizer-first step 4: the ranked list sits under this part. style.css lays #lineup-panel out as a column with this mount as
// display: contents and the Build footer ordered last, so the footer's sticky place is the end of the whole tab: it stays pinned to the
// window's bottom and never rests mid-page between the results and the ranked list (it stays in this mount's DOM, so its wiring is as
// before). It is shown only while the builder or its results are in view (footerShown; .is-away hides it, visibility only). The ranked
// list below gives the room for the last slot and the last result to scroll into view above it.
/** Whether the Build footer shows: some of the Optimizer's part (its first element's top to the results' bottom) lies between the
 *  sticky filter bar's bottom and the footer's top. All four are window coordinates in px. */
export function footerShown({ partTop, partBottom, barBottom, footerTop }) {
  return partBottom > barBottom && partTop < footerTop;
}

let footerWatched = false;
let footerFrame = 0;
function updateFooter() {
  footerFrame = 0;
  const footer = lastContainer?.querySelector?.(":scope > .opt-footer");
  const first = lastContainer?.firstElementChild;
  const results = footer?.previousElementSibling;
  const bar = document.querySelector("#filterbar");
  if (!footer || !first || !results || !bar) return;
  const rect = (el) => el.getBoundingClientRect();
  footer.classList.toggle("is-away", !footerShown({ partTop: rect(first).top, partBottom: rect(results).bottom, barBottom: rect(bar).bottom, footerTop: rect(footer).top }));
}

function watchFooter(container) {
  if (typeof window === "undefined" || !container.querySelector?.(":scope > .opt-footer")) return; // a test's stand-in container
  if (!footerWatched) {
    footerWatched = true;
    const later = () => {
      if (!footerFrame) footerFrame = requestAnimationFrame(updateFooter);
    };
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
  }
  updateFooter();
}

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
    getSlates: () => store.get().board?.slates ?? [],
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
//
// This exact function also lives in public/app.js as adjustScrollPanels's per-panel sizing step
// (snapPanelMaxHeight there). It's duplicated here rather than imported because app.js is the page's
// entry module — it imports tabs.js, which imports this module, so importing app.js back into lineup.js
// would make that a circular module dependency. Keep both copies in sync.
export function snapPanelMaxHeight(panelEl, top, reserve) {
  // Layout round 2, 2026-10-17: a panel in a hidden tab reads every rect as 0 and would be sized to 0px: leave it alone.
  if (panelEl.getClientRects().length === 0) return;
  // Layout round 2, 2026-10-17: the room is measured from the panel's place in the document (docTop), not its place
  // in the window, so a page scrolled past the panel's top (a negative `top`, 586 px became 1,769 px after Undo at
  // 1920x947) sizes it exactly as an unscrolled page does; nothing is stored, so nothing goes stale.
  const docTop = top + window.scrollY;
  // Same phone minimum as app.js's copy (70% of the window's height at max-width 700px, via expand.js).
  const phoneMin = Math.max(phoneMinHeight(), panelMinHeight(panelEl, top)); // the Optimizer pool's floor too (expand.js)
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

// Mirrors app.js's adjustScrollPanels() sizing for this panel's own .scroll-panel element. app.js is out
// of scope for this pass and doesn't export that function; it also only runs after the app-level
// renderDynamic, which this module's own re-renders (Lock, Add, Clear, Go — all via commit(), below)
// bypass entirely, so the pool needs its own call (🔵 finding 9).
function resizeLineupScrollPanels(container) {
  container.querySelectorAll(".scroll-panel").forEach((panelEl) => {
    const top = panelEl.getBoundingClientRect().top;
    // The repeated ownership legend (👁 visual-qa third pass) sits right below this panel, same as the
    // Rankings table's own legend in app.js's adjustScrollPanels — its height has to be reserved here
    // too, or the pool table claims that room and clips the legend.
    let reserve = 16;
    const legend = panelEl.parentElement?.querySelector(".table-legend");
    if (legend) reserve += legend.getBoundingClientRect().height + 8;
    // The sticky Build footer covers the window bottom, so the pool must end above it (🔵 d842f0b); app.js keeps the same line.
    reserve += document.querySelector("#lineup-panel .opt-footer")?.getBoundingClientRect().height ?? 0;
    snapPanelMaxHeight(panelEl, top, reserve);
  });
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

function addPlayer(row, rowById) {
  const rowId = String(row.id);
  if (state.excludes.has(rowId)) return;
  const identity = dkIdentity(row);
  const alreadyPlaced = state.slots.some((s) => {
    if (!s) return false;
    const placedRow = rowById.get(String(s.id));
    return placedRow && dkIdentity(placedRow) === identity;
  });
  if (alreadyPlaced) return;
  // 🔵 finding 4: a player with no DraftKings salary can never be weighed against the cap.
  if (row.salary == null) {
    state.addError = `${row.name} has no DraftKings salary, so he cannot be costed against the cap.`;
    return;
  }
  const idx = legalSlotIndex(row.pos);
  if (idx === -1) {
    const flexNote = FLEX_POS.has(row.pos) ? " or FLEX" : "";
    state.addError = `No empty ${row.pos}${flexNote} slot is open for ${row.name}.`;
    return;
  }
  state.slots[idx] = { id: rowId, slot: LINEUP_SLOTS[idx] };
  state.locks.add(rowId);
  state.addError = addWarning(row);
}

// DECISIONS.md D70: pool Lock = in the base lineup, unlock = out of it. Unlock clears his slot too (a pool-only
// lock from older saved state has no slot and just loses the lock). Lock places him like Add does (which also
// adds the lock); already placed (under this id, or the same DraftKings player under another id): lock that
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
  if (placedSlot) state.locks.add(String(placedSlot.id));
  else addPlayer(row, rowById);
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
  const loadedAtStart = state.loadedId;
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
  const after = afterSave({ data, name, editId, weekChanged: lastSavedKey !== keyAtStart, loadedAtStart, loadedNow: state.loadedId });
  if (!after.discard) {
    if (Array.isArray(data?.lineups)) state.savedLineups = data.lineups;
    if (after.dropId) state.savedLineups = state.savedLineups.filter((l) => l.id !== after.dropId);
    if ("loadedId" in after) state.loadedId = after.loadedId;
    if ("saveName" in after) state.saveName = after.saveName;
    state.saveError = failure ?? after.saveError ?? null;
    state.saveConfirm = after.saveConfirm ?? null;
  }
  state.saving = false;
  commit();
}

/** What a finished save changes (PROJECT.md Part 4 Lineups): {discard} for a week changed under the request; a Load or
 *  Clear all made during the save keeps its loadedId and name; NOT_FOUND and READ_ONLY unload the edited lineup. */
export function afterSave({ data, name, editId, weekChanged, loadedAtStart, loadedNow }) {
  if (weekChanged) return { discard: true };
  const moved = loadedNow !== loadedAtStart;
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

async function doDeleteLineup(id) {
  state.deleteConfirmId = null;
  commit();
  try {
    const data = await deleteLineup(id);
    if (data && data.ok !== false && Array.isArray(data.lineups)) state.savedLineups = data.lineups;
  } catch (e) {
    // Best-effort: nothing destructive happened locally, the list just won't reflect the delete until reloaded.
  }
  commit();
}

/** Puts a saved lineup's players back into the builder's slots, replacing whatever is there, via
 *  placeBySlotName() — so an off-slate player (dropped by validateAgainstBoard on the next render) and
 *  totals/locks behave exactly as they do after any other slot change. */
function doLoadLineup(id) {
  const lineup = state.savedLineups.find((l) => l.id === id);
  if (!lineup) return;
  state.slots = placeBySlotName((lineup.slots ?? []).map((s) => ({ slot: s.slot, id: s.playerId })));
  state.loadedId = lineup.id;
  state.saveName = lineup.name ?? "";
  state.saveError = null;
  state.saveConfirm = null;
  state.addError = null;
  opt.cashUndo = null; // Cash 3b fix round 2, 2026-10-17: Undo never replaces a loaded lineup
  commit();
}

// --------------------------------------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------------------------------------

function wire(container) {
  container.querySelector("#lineup-clear-all-btn")?.addEventListener("click", () => {
    state.slots = new Array(LINEUP_SLOTS.length).fill(null);
    state.locks = new Set();
    state.excludes = new Set();
    state.addError = null;
    if (opt.mode === "cash") {
      delete opt.cash.want[slateKeyOf(store.get().board)]; // Cash mode job 3b: Clear all in cash clears cash's slots, Must, Want and excludes only (Cash 3b fix round: the Wants of the slate on screen only)
      opt.cashUndo = null;
    }
    clearLoaded();
    commit();
  });

  container.querySelectorAll("[data-action='slot-clear']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.slot);
      const p = state.slots[i];
      if (!p) return;
      state.locks.delete(p.id);
      state.slots[i] = null;
      state.addError = null;
      opt.cashUndo = null; // Cash 3b fix round 2, 2026-10-17: a cleared slot is never silently refilled by Undo
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
          if (state.slots[i] && state.slots[i].id === id) state.slots[i] = null;
        }
      }
      commit();
    });
  });
  container.querySelectorAll("[data-action='row-add']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const board = store.get().board;
      const rows = board?.rows ?? [];
      const rowById = new Map(rows.map((r) => [String(r.id), r]));
      const row = rowById.get(btn.dataset.id);
      if (!row) return;
      opt.cashUndo = null; // Cash 3b fix round, 2026-10-17: as for an exclude
      addPlayer(row, rowById);
      commit();
    });
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

  container.querySelectorAll("[data-action='lineup-tag']").forEach((sel) => {
    sel.addEventListener("change", () => doLineupPut(sel.dataset.id, { tag: sel.value || null }));
  });

  container.querySelectorAll("[data-action='lineup-delete-start']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.deleteConfirmId = btn.dataset.id;
      state.renamingId = null;
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
    btn.addEventListener("click", () => doLoadLineup(btn.dataset.id));
  });

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
  { key: "starredQbOnly", label: "starred QBs only" },
  { key: "noSameTeamRbs", label: "no same-team RBs" },
  { key: "noSameGameRbs", label: "no same-game RBs" },
  { key: "noDstVsOwnPlayers", label: "no DST vs own players" },
];

// 🔵 2026-10-17: the rule keys named once; each OPT_RULES key sits in exactly one group (Pool or Build) of the panel.
export const RULE_GROUPS = Object.freeze({ pool: ["starredQbOnly"], build: ["noSameTeamRbs", "noSameGameRbs", "noDstVsOwnPlayers"] });

export const opt = {
  mode: "gpp", // Cash mode job 3b, 2026-10-17: "gpp" | "cash"; the slots, locks and excludes in `state` belong to this mode
  cash: defaultCashState(), // cash's own settings and Want lists (lineup-cash.js)
  stash: {}, // the other mode's slots, locks, excludes (swapModeStash)
  cashUndo: null, // {slots, locks, after, names}: the build before the last "Make them Must and rebuild" and the one it left (after); page-only
  count: String(OPT_DEFAULT_COUNT),
  minUnique: String(OPT_DEFAULT_UNIQUE),
  maxExp: { QB: "", RB: "", WR: "", TE: "", DST: "" }, // percent text as typed; blank = no cap
  rules: Object.fromEntries(OPT_RULES.map((r) => [r.key, true])),
  objective: "proj", // one of OBJECTIVES' values, Adam's pick (effectiveObjective decides what a build uses)
  maxPerTeam: "", // "" (no limit) or "1".."4", the <select> value
  ...OPT_DEFAULT_STACK, // D73: stackOwn / stackOpp numbers and their "or more" ticks
  avoid: new Set(), // game ids such as "DET@ARI"
  // Per-player Max % from the pool's boxes, per slate key ("main" or a second slate's key): {id: text as typed}.
  // Mirrored to localStorage with the locks (savePersisted); Clear all leaves it, as it leaves every Optimizer setting.
  playerMax: {},
  playerMin: {}, // the Min % boxes, shaped like playerMax (PROJECT.md Part 4 Optimizer (Min % and soft rules, Adam 2026-10-17))
  qb: newQbState(), // per-QB stack settings (lineup-qb-stacks.js), keyed by player id, persisted with the locks
  spreadDst: false, // "Spread defenses", persisted
  resultsTab: null, // D74: "new" or "saved" once Go or a tab click picks one this page load; null = the default
  // Adam 2026-10-11: "only lineups with" these players (identity keys, in the order chosen), shared by the New and
  // Saved tabs, page-only, kept across Go, cleared when the slate or week changes. mustHaveNames: key -> name for the chips.
  mustHave: [],
  mustHaveNames: {},
  expSortDir: "desc", // the exposure lists' one sort, by exposure: "desc" (highest first) or "asc"
  sort: cleanSortState(null), // the card lists' sort, per tab: {new: {key, dir}, saved: {key, dir}}, persisted (lineup-sort.js)
  generating: false,
  saving: false,
  error: null, // the server's sentence for a refused or failed request
  saveError: null,
  formError: null, // a sentence naming a maximum-exposure box (position or player) that is not a percent; blocks Go
  results: null, // {slateKey, lineups: [{uid, ids, salary, proj, ceil?, players, saved?}], notes, builtIn} or null
};

export function resetOptimizerResults() {
  opt.results = null;
  opt.error = null;
  opt.saveError = null;
}

export function clearMustHave() {
  opt.mustHave = [];
  opt.mustHaveNames = {};
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
  const swapped = swapModeStash({ slots: state.slots, locks: [...state.locks], excludes: [...state.excludes], loadedId: state.loadedId, saveName: state.saveName, stash: opt.stash }, opt.mode, next);
  state.slots = normalSlots(swapped.slots) ?? new Array(LINEUP_SLOTS.length).fill(null);
  state.locks = new Set(swapped.locks.map(String));
  state.excludes = new Set(swapped.excludes.map(String));
  state.loadedId = swapped.loadedId;
  state.saveName = swapped.saveName;
  opt.stash = swapped.stash;
  opt.mode = next;
  opt.cashUndo = null;
  opt.formError = null;
  state.addError = null;
  lastValidatedBoard = null; // validateAgainstBoard runs again on the restored build
  validateAgainstBoard(store.get().board);
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
    }
    lastOptSlateKey = key;
  }
}

// Re-exports: every name this module exported before the split is still importable from here (tabs.js, the tests and the site build import them).
export { setPoolCallbacks, slotPlayerHtml, savedLineupSlotHtml, savedCeilHtml, savedLineupCardHtml, savedGroupsHtml, savedLineupPlayers, savedLineupFigures, saveControlsHtml, poolStarClick, rightColumnHtml, lineupTotalsOf, ruleRowsHtml, starredQbQualifiers, usableQbIds, starredQbNote, avoidChipsHtml, optLineupCardHtml, optNotesHtml, bendsLineHtml, cardIsSaved } from "./lineup-view.js";
export { swapScanHook, parseWhole, parsePct, exposureProblem, exposureOfLineups, lineupSetKey, savedSetKeys, savedForSlate, uniqueSavedName, playerMaxProblem, playerMinProblem, minSlotsFull, minSlotWords, dkKeyOfRow, minRowOut, pairClash, lockStackRefuses, minLockSkips, playerMinPositionProblem, lockedIds, requestCount, minProblemFor, buildGenerateSettings, buildGeneratePayload, slotsForSave, duplicateSaveStatus } from "./lineup-optimizer.js";
