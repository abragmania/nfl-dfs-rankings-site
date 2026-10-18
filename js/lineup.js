// Optimizer tab (PROJECT.md D21/D32, D70, Part 4 Lineup Builder screen). Secondary tab, never the main
// page. Top: the Optimizer band (its max-per-team and D73 QB-stack controls included). Left column: the
// nine DraftKings classic slots (D1), a salary bar, totals, Clear all and Save lineup. Right column: the same rows the Rankings
// tab is currently showing — same store, same filters (its own position chips set them), same sort (its headers set
// it) — with per-row Lock, Exclude and Add-to-slot buttons.
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
import { escapeHtml, money, dec1, textColourFor } from "./format.js";
import { store, matchesPosition, filterRows, sortRows, passesProjFloor, FLEX_POS, defaultDirFor, activeSlate, activeSlateRows, activeSlateGames, slateDisplayName, boardHasCeilings, isTwoGunMode } from "./state.js";
import { sortableHeadHtml } from "./tabs.js";
import { matchupText, lineupOutTagHtml, lineupRevivedTagHtml, statusTagsHtml, gradedCellHtml, rowIsOut, twoGunOutReason, STATUS_INFO } from "./table.js"; // D43: the one copy of "vs DAL" / "@ DET"; the red OUT tag (Adam 2026-10-15)
import { shownTotal, lineupCeilTotal } from "./totals.js";
import { newBuildId, batchBuild, handBuild, buildTypeText, groupByBuild, groupHeaderText } from "./lineup-builds.js";
import { rowsGradedForView } from "./grade.js";
import { posChipsHtml, showAllToggleHtml, wireShowAllButtons } from "./filterbar.js";
import { filterLineups, bulkUids, bulkLabel, toggleMustHave, pickButtonHtml, filterBarHtml } from "./lineup-filter.js";
import { OPT_POSITIONS, optExposureHtml, sortExposure, exposureLimit, minLimit, exposureMark, zeroMinRows } from "./lineup-exposure.js";
import { cardPlayerRowHtml, cardDecor, badgeHtml, teamLogoHtml, ownParen, teamColours, teamColourStyle } from "./lineup-card.js";
import { lineupRoles, roleTagsHtml } from "./lineup-marks.js";
import { paletteForRows } from "./team-palette.js";
import { poolSearchChipHtml, wirePoolSearchChip } from "./lineup-search.js";
import { settingRowHtml, settingGroupHtml, settingChipsRowHtml, settingSubtitleHtml, activeRulesSummary, switchButtonHtml, switchCheckboxHtml, numberBoxHtml } from "./lineup-settings.js";
import { newQbState, listedQbs, pruneEntries, cleanSavedEntries, qbStacksPayload, qbListHtml, qbPanelsHtml, wireQbStacks, SPREAD_HINT } from "./lineup-qb-stacks.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { postLineupGenerate, getLineups, postLineup, putLineup, deleteLineup } from "./api.js";
import { renderEntriesSection, wireEntries, slateLineups } from "./entries.js";
import { TAG_OPTIONS, numberLineups, lineupPrefix } from "./lineup-tags.js";
import { phoneMinHeight, panelMinHeight } from "./expand.js";
import {
  defaultCashState, cleanCashState, swapModeStash, modeSwitchHtml, cashChipHtml, convictionChipsHtml, cashHeadLine, buildCashSettings, boardHasMedians,
  poolReport, wantSwaps, swapDecisionHtml, excludedListHtml, cashTotalsText, unusedCapText, cashBadgeHtml, builtInTextCash, lineupModeOf,
} from "./lineup-cash.js";

const LINEUP_SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
const SALARY_CAP = 50000;
// The lineups maximise projection or TwoGun's ceiling, Adam's pick each time (TwoGun merge 2026-10-15; server/lineup/
// multi.js OBJECTIVES). Ceiling needs a board carrying TwoGun's ceilings (TwoGun mode): otherwise it is greyed with the
// reason on hover and the build is by projection. The Leverage and Projection-minus-ownership objectives are gone
// (Adam 2026-10-15); the server builds any older request naming a retired one on projection, with a note.
const OBJECTIVES = [
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
const MAX_TEAM_OPTIONS = ["", "1", "2", "3", "4"];
const STORAGE_KEY = "nfldfs.lineupBuilder.v1";

const state = {
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
function dkIdentity(row) {
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

function savePersisted() {
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
function seasonWeekKey(board) {
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

let lastContainer = null;
let poolCallbacks = null; // app.js's tableCallbacks: the pool's star writes the same override as Rankings' (Adam 2026-10-17)

export function setPoolCallbacks(callbacks) {
  poolCallbacks = callbacks;
}

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

function commit() {
  savePersisted();
  if (lastContainer) renderLineupPanel(lastContainer);
}

// --------------------------------------------------------------------------------------------------------
// Derived data
// --------------------------------------------------------------------------------------------------------

// 🔵 finding 3: the totals are read live off the current board rows, and a null own on any placed player makes
// the total unknown rather than silently smaller.
function computeTotals(rowById) {
  let salaryUsed = 0;
  const projs = [];
  let totalOwn = 0;
  let ownUnknown = false;
  for (const s of state.slots) {
    if (!s) continue;
    const row = rowById.get(String(s.id));
    if (!row) continue; // not on this slate; validateAgainstBoard drops these on the next board load
    salaryUsed += row.salary ?? 0;
    projs.push(row.proj);
    if (row.own == null) ownUnknown = true;
    else totalOwn += row.own;
  }
  // ChatGPT wish d, Adam 2026-10-17: the total is the sum of the slot projections as shown (totals.js).
  return { salaryUsed, salaryLeft: SALARY_CAP - salaryUsed, totalProj: shownTotal(projs) ?? 0, totalOwn: ownUnknown ? null : totalOwn };
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
function unlockPool(id) {
  state.locks.delete(id);
  for (let i = 0; i < state.slots.length; i++) {
    if (state.slots[i] && String(state.slots[i].id) === id) state.slots[i] = null;
  }
  state.addError = null;
}

function lockPool(id) {
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
function placeBySlotName(entries) {
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
  let data = null;
  let failure = null;
  try {
    data = editId
      ? await putLineup(editId, { name, slots: slotsPayload, slate })
      : await postLineup({ name: asNew ? uniqueSavedName(name, savedOfActiveSlate(null).map((l) => l.name)) : name, slots: slotsPayload, slate, ...(opt.mode === "cash" ? { mode: "cash" } : {}), build: handBuild(boardModeOf(store.get().board)) }); // Cash mode job 3b: names stay unique across both modes; a new lineup carries the mode on screen (Cash 3b fix round: only "cash" is sent, so GPP files keep their old shape)
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

const lineupBusy = new Set(); // saved lineup ids with a card PUT in flight: their letter and rename Save are disabled
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
// Render
// --------------------------------------------------------------------------------------------------------

function panelHtml() {
  const board = store.get().board;
  // rowById is an id lookup over the WHOLE board on purpose: the nine slots and the saved-lineup cards must
  // still find a player who is not in the second slate on screen (D57). The pool on the right is the list, and
  // it goes through activeSlateRows() like every other classic list.
  const rows = board?.rows ?? [];
  const rowById = new Map(rows.map((r) => [String(r.id), r]));
  paletteForRows(rowById, activeSlateRows(board)); // Team rows fix, 2026-10-17: the cards' palette is the active slate's teams, fixed here once per render
  const totals = computeTotals(rowById);
  const roles = lineupRoles(state.slots.map((s) => rowById.get(String(s?.id))));
  const overCap = totals.salaryUsed > SALARY_CAP;
  const fillPct = Math.max(0, Math.min(100, (totals.salaryUsed / SALARY_CAP) * 100));
  const salaryText =
    totals.salaryLeft < 0 ? `${money(totals.salaryUsed)} used · ${money(-totals.salaryLeft)} over` : `${money(totals.salaryUsed)} used · ${money(totals.salaryLeft)} left`;
  // 🔵 finding 3: any placed player with a null own% makes the total unknown, not smaller.
  const ownText = totals.totalOwn == null ? "— (not every player has a published number)" : `${Math.round(totals.totalOwn)}% own`;

  // The Optimizer band is the first thing in the tab (DECISIONS.md D70, Adam 2026-10-10: "move the optimizer stuff up"); the lineup
  // it builds from sits right under it, its results and the saved lineups below.
  const injuryNoteHtml = board?.injuryNote ? `<p class="tab-note">${escapeHtml(board.injuryNote)}</p>` : "";
  return `
    ${injuryNoteHtml}
    ${optimizerControlsHtml(rowById)}
    <div class="lineup-layout">
      <div class="lineup-left">
        ${controlsHtml()}
        <div class="lineup-slots">${slotsHtml(rowById, roles)}</div>
        <div class="salary-bar">
          <div class="salary-bar-track"><div class="salary-bar-fill${overCap ? " over" : ""}" style="width:${fillPct}%"></div></div>
          <span class="salary-bar-label${overCap ? " over" : ""}">${escapeHtml(salaryText)}</span>
        </div>
        <div class="lineup-totals">Total projection ${dec1(totals.totalProj)} &middot; Total ownership ${ownText}</div>
        ${buildStatusHtml()}
      </div>
      <div class="lineup-right">
        <h3 class="lineup-right-title">Rankings (current filters)</h3>
        ${poolPosChipsHtml()}${poolSearchChipHtml(store.get().filters.search)}
        ${rightColumnHtml(activeSlateRows(board), rowById)}
      </div>
    </div>
    ${optimizerResultsHtml(rowById)}
    ${optimizerFooterHtml(board)}`;
}

/** The Save controls (PROJECT.md Part 4 Lineups): Save and Copy when a saved lineup is loaded, else Save lineup. */
export function saveControlsHtml({ loaded, hasAnySlot, saving, saveName }) {
  const off = !hasAnySlot || saving ? " disabled" : "";
  const btn = (id, label, title = "") =>
    `<button type="button" id="${id}" class="lineup-build-btn"${title ? ` title="${title}"` : ""}${off}>${saving && id === "lineup-save-btn" ? "Saving…" : label}</button>`;
  return `
      <label class="lineup-control">${loaded ? "Name" : "Save as"}
        <input type="text" id="lineup-save-name" class="lineup-save-name-input" placeholder="Name (optional)" value="${escapeHtml(saveName)}" />
      </label>
      ${loaded ? `${btn("lineup-save-btn", "Save")}${btn("lineup-save-new-btn", "Copy", "Save as a new lineup and keep this one")}` : btn("lineup-save-btn", "Save lineup")}`;
}

function controlsHtml() {
  const hasAnySlot = state.slots.some(Boolean);
  const loaded = state.loadedId != null && state.savedLineups.some((l) => l.id === state.loadedId);
  return `
    <div class="lineup-controls">
      <button type="button" id="lineup-clear-all-btn" class="lineup-clear-all-btn">Clear all</button>${saveControlsHtml({ loaded, hasAnySlot, saving: state.saving, saveName: state.saveName })}
    </div>`;
}

function slotsHtml(rowById, roles) {
  return LINEUP_SLOTS.map((slotName, i) => {
    const s = state.slots[i];
    const row = s ? rowById.get(String(s.id)) : null;
    // 🔵 finding 2: a slot whose id no longer has a row (should already have been dropped by
    // validateAgainstBoard, but this is the defensive last line) shows a visible marker instead of
    // guessing at stale name/salary/proj/own.
    const bodyHtml = !s
      ? `<span class="lineup-slot-player lineup-slot-empty">Empty</span>`
      : row
        ? slotPlayerHtml(row, roles.get(String(row.id)))
        : `<span class="lineup-slot-player lineup-slot-missing">Not on this slate</span>`;
    const tint = row ? ` lineup-slot-filled" style="--tc:${TEAM_BY_ABBR[row.team]?.colourPrimary ?? "#333333"}` : "";
    return `
      <div class="lineup-slot lineup-slot-tall${tint}" data-slot-index="${i}">
        <span class="lineup-slot-label">${escapeHtml(slotName)}</span>
        ${bodyHtml}
        <button type="button" class="lineup-slot-clear" data-action="slot-clear" data-slot="${i}"${s ? "" : " disabled"}>Clear</button>
      </div>`;
  }).join("");
}

// `row` is the live board row for this slot's id (🔵 finding 2), never a cached copy: an override on
// Proj or Own shows up here automatically because this reads the same fields the Rankings table does.
function slotPlayerHtml(row, tags = []) {
  const t = TEAM_BY_ABBR[row.team];
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  const textColour = textColourFor(primary, secondary);
  const projText = row.proj == null ? "no proj" : dec1(row.proj);
  return `
    <span class="lineup-slot-player lineup-slot-player-2">
      ${badgeHtml(row.name, row.pos, row.team)}
      <span class="lineup-slot-body">
        <span class="lineup-slot-top">
          <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(row.team ?? "")}</span>
          <span class="lineup-slot-name">${escapeHtml(row.name)}</span>${lineupOutTagHtml(row)}
          <span class="lineup-slot-matchup">${escapeHtml(matchupText(row))}</span>
        </span>
        <span class="lineup-slot-detail">${money(row.salary)} &middot; ${projText} proj${escapeHtml(ownParen(row.own))}${roleTagsHtml(tags)}${lineupRevivedTagHtml(row, true)}</span>
      </span>
    </span>`;
}

function buildStatusHtml() {
  const parts = [];
  if (state.addError) {
    parts.push(`<div class="lineup-status lineup-status-warning">${escapeHtml(state.addError)}</div>`);
  }
  if (state.saveError) {
    parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(state.saveError)}</div>`);
  } else if (state.saveConfirm) {
    parts.push(`<div class="lineup-status">${escapeHtml(state.saveConfirm)}</div>`);
  }
  return parts.join("");
}

// --------------------------------------------------------------------------------------------------------
// Saved lineups rendering
// --------------------------------------------------------------------------------------------------------

function formatSavedAt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Re-derives a saved lineup's nine roster slots and live totals against `rowById` (the CURRENT board),
 *  so a card's salary/proj/own move after a Refresh instead of freezing at save time. A saved player no
 *  longer on the slate is reported (`row: null`, `snap` carries his saved-time fields) but contributes
 *  nothing to the live totals — there is no live number to add. */
function computeLiveTotals(lineup, rowById) {
  const placed = placeBySlotName((lineup.slots ?? []).map((s) => ({ slot: s.slot, id: s.playerId })));
  let filled = 0;
  let salaryUsed = 0;
  const projs = [];
  let totalOwn = 0;
  let ownPublished = 0;
  const slotEntries = placed.map((entry) => {
    if (!entry) return null;
    filled++;
    const snap = (lineup.slots ?? []).find((s) => String(s.playerId) === entry.id) ?? null;
    const row = rowById.get(entry.id) ?? null;
    if (row) {
      salaryUsed += row.salary ?? 0;
      projs.push(row.proj);
      if (row.own != null) {
        totalOwn += row.own;
        ownPublished++;
      }
    } else if (snap) {
      // 🔵 finding: a player no longer on the slate still costs what he cost at save time, so a $50,000
      // lineup doesn't show as under cap and lose its "over cap" badge just because he rolled off the
      // board. His projection and ownership stay out of the totals — there's no live number for those.
      salaryUsed += snap.salary ?? 0;
    }
    return { row, snap };
  });
  return { slotEntries, filled, salaryUsed, totalProj: shownTotal(projs) ?? 0, totalOwn, ownPublished }; // ChatGPT wish d: the shown sum (totals.js)
}

/** `pick` ({isChosen(id)}, see pickOptions) turns the player's name into the "only lineups with" button. `palette`: the slate's
 *  team colours (paletteForRows on the active slate's rows), so a Saved row wears the same colours as the new-lineup card's. */
export function savedLineupSlotHtml(slotName, entry, pick = null, palette = null) {
  if (!entry) {
    return `<div class="saved-lineup-slot saved-lineup-slot-tc saved-lineup-slot-empty"><span class="saved-lineup-slot-pos">${escapeHtml(slotName)}</span><span class="saved-lineup-slot-empty-text">Empty</span></div>`;
  }
  const src = entry.row ?? entry.snap;
  if (!src) return "";
  const missingCls = entry.row ? "" : " saved-lineup-slot-missing";
  const noteHtml = entry.row ? "" : `<span class="saved-lineup-slot-note">not on slate</span>`;
  const pickId = entry.row?.id ?? entry.snap?.playerId;
  const nameHtml = pick && pickId != null ? pickButtonHtml({ id: pickId, name: src.name ?? "", chosen: pick.isChosen(pickId) }) : escapeHtml(src.name ?? "");
  return `
    <div class="saved-lineup-slot saved-lineup-slot-tc${missingCls}" style="${teamColourStyle(teamColours(palette, src.team))}">
      <span class="saved-lineup-slot-pos">${escapeHtml(slotName)}</span>
      ${teamLogoHtml(src.team, "saved-lineup-slot-logo", 16) || `<span class="saved-lineup-slot-team">${escapeHtml(src.team ?? "")}</span>`}
      <span class="saved-lineup-slot-name">${nameHtml}</span>${entry.row ? lineupOutTagHtml(entry.row) : ""}${entry.row ? lineupRevivedTagHtml(entry.row, true) : ""}
      <span class="saved-lineup-slot-salary">${money(src.salary)}</span>
      ${noteHtml}
    </div>`;
}

/** The ceiling total of a saved lineup's build record (ChatGPT wish g): "· 181.4 ceil" as it was when built; a dash when a
 *  player had no TwoGun ceiling or the players were changed by hand since; "" for a hand build or a current-mode batch. */
export function savedCeilHtml(build) {
  if (!build || build.kind !== "batch") return "";
  if (build.edited) return `<span title="The players were changed by hand after this build, so its ceiling total no longer applies">&middot; — ceil</span>`;
  if (build.totalCeil === undefined) return "";
  if (build.totalCeil === null) return `<span title="A player in this lineup had no TwoGun ceiling">&middot; — ceil</span>`;
  return `<span title="TwoGun's ceilings summed, as built">&middot; ${dec1(build.totalCeil)} ceil</span>`;
}

function savedLineupCardHtml(lineup, rowById, pick = null, numbers = null) {
  const totals = computeLiveTotals(lineup, rowById);
  const isCash = lineup.mode === "cash";
  const prefix = lineupPrefix(lineup, numbers);
  const busy = lineupBusy.has(lineup.id) ? " disabled" : ""; // a card PUT is in flight (putLineupGuarded)
  const tagOptions = `<option value=""${lineup.tag ? "" : " selected"}>no letter</option>${TAG_OPTIONS.map((t) => `<option value="${t}"${t === lineup.tag ? " selected" : ""}>${t}</option>`).join("")}`;
  const tagHtml = `<select class="saved-lineup-tag" data-action="lineup-tag" data-id="${escapeHtml(lineup.id)}" aria-label="Letter for ${escapeHtml(lineup.name)}"${busy}>${tagOptions}</select>`; // Adam 2026-10-17: a lineup's mode is fixed at save, no crossover, so the card has no mode button
  const overCap = totals.salaryUsed > SALARY_CAP;
  const incomplete = totals.filled < LINEUP_SLOTS.length;
  const isRenaming = state.renamingId === lineup.id;
  const isConfirmingDelete = state.deleteConfirmId === lineup.id;

  const badges = [
    state.loadedId === lineup.id ? `<span class="saved-lineup-badge saved-lineup-badge-loaded">Loaded</span>` : "",
    isCash ? cashBadgeHtml() : "", // Cash mode job 3b
    state.lineupErrors[lineup.id] ? `<span class="saved-lineup-badge saved-lineup-badge-danger">${escapeHtml(state.lineupErrors[lineup.id])}</span>` : "",
    incomplete ? `<span class="saved-lineup-badge saved-lineup-badge-warning">Incomplete</span>` : "",
    overCap ? `<span class="saved-lineup-badge saved-lineup-badge-danger">Over cap</span>` : "",
  ].join("");

  // ChatGPT wish g, Adam 2026-10-17: the board mode and build type the lineup was made with, and its ceiling total as built.
  const buildText = buildTypeText(lineup.build);
  const buildBadge = buildText ? `<span class="saved-lineup-badge saved-lineup-badge-build" title="How this lineup was made">${escapeHtml(buildText)}</span>` : "";
  const ceilHtml = savedCeilHtml(lineup.build);

  const nameHtml = isRenaming
    ? `<span class="saved-lineup-rename">
        <input type="text" class="saved-lineup-rename-input" data-rename-input value="${escapeHtml(lineup.name)}" />
        <button type="button" class="saved-lineup-mini-btn" data-action="lineup-rename-save" data-id="${escapeHtml(lineup.id)}"${busy}>Save</button>
        <button type="button" class="saved-lineup-mini-btn" data-action="lineup-rename-cancel">Cancel</button>
      </span>`
    : `<button type="button" class="saved-lineup-name-btn" data-action="lineup-rename-start" data-id="${escapeHtml(lineup.id)}" title="Click to rename">${escapeHtml(lineup.name)}</button>`;

  const palette = paletteForRows(rowById); // Team rows round 2, Adam 2026-10-17: the Saved rows wear the new-lineup rows' colours
  const rowsHtml = totals.slotEntries.map((entry, i) => savedLineupSlotHtml(LINEUP_SLOTS[i], entry, pick, palette)).join("");

  const salaryLeft = SALARY_CAP - totals.salaryUsed;
  const salaryText = overCap
    ? `${money(totals.salaryUsed)} used &middot; ${money(-salaryLeft)} over`
    : `${money(totals.salaryUsed)} used &middot; ${money(salaryLeft)} left`;
  // Same rule as the builder panel above (🔵 finding 3 / D29): the app never estimates ownership, so a
  // total is only printed when every filled slot has a published number; otherwise it's an em dash. When all are
  // published the count is left out so the summary stays on one line (👁 visual-qa 2026-10-11).
  const ownText =
    totals.ownPublished === totals.filled
      ? `${Math.round(totals.totalOwn)}% own`
      : `— (${totals.ownPublished} of ${totals.filled} published)`;

  const deleteHtml = isConfirmingDelete
    ? `<span class="saved-lineup-confirm">Delete this lineup?
        <button type="button" class="saved-lineup-mini-btn danger" data-action="lineup-delete-yes" data-id="${escapeHtml(lineup.id)}">Yes</button>
        <button type="button" class="saved-lineup-mini-btn" data-action="lineup-delete-no">No</button>
      </span>`
    : `<button type="button" class="saved-lineup-btn danger" data-action="lineup-delete-start" data-id="${escapeHtml(lineup.id)}">Delete</button>`;

  return `
    <div class="saved-lineup-card">
      <div class="saved-lineup-card-head">
        ${prefix ? `<span class="saved-lineup-prefix">${escapeHtml(prefix)} &middot;</span>` : ""}${nameHtml}
        ${tagHtml}
        <span class="saved-lineup-time">${escapeHtml(formatSavedAt(lineup.savedAt))}</span>
        ${buildBadge}${badges}
      </div>
      <div class="saved-lineup-slots">${rowsHtml}</div>
      <div class="saved-lineup-totals">
        <span class="${overCap ? "saved-lineup-totals-over" : ""}">${salaryText}</span>
        <span>&middot; ${dec1(totals.totalProj)} proj</span>${ceilHtml}
        <span>&middot; ${escapeHtml(ownText)}</span>
      </div>
      <div class="saved-lineup-actions">
        <button type="button" class="saved-lineup-btn" data-action="lineup-load" data-id="${escapeHtml(lineup.id)}">Load</button>
        ${deleteHtml}
      </div>
    </div>`;
}

/** The Saved tab's cards under one small header per build, newest build first (ChatGPT wish g, Adam 2026-10-17). Lineups saved
 *  before builds were recorded sit last as "earlier"; when they are all there is, no header is drawn and the list reads as before.
 *  `cardHtml(lineup)` draws one card. */
export function savedGroupsHtml(lineups, cardHtml) {
  const groups = groupByBuild(lineups);
  if (groups.length === 1 && groups[0].kind === "earlier") return `<div class="saved-lineups-list">${groups[0].lineups.map(cardHtml).join("")}</div>`;
  return groups.map((g) => {
    const when = g.kind === "batch" && g.newest > 0 ? formatSavedAt(new Date(g.newest).toISOString()) : "";
    return `<section class="saved-build-group" data-build="${escapeHtml(g.key)}"><h4 class="saved-build-head">${escapeHtml(groupHeaderText(g, when))}</h4><div class="saved-lineups-list">${g.lineups.map(cardHtml).join("")}</div></section>`;
  }).join("");
}

/** The Saved lineups tab (D74): this slate's saved cards (Load, rename, Delete as before; on the site the D69
 *  device- ids work the same way). Order: the exposure tables over the shown saved lineups, then this slate's saved cards
 *  (Adam 2026-10-17: exposure above the cards). */
function savedLineupsSectionHtml(rowById, savedHere) {
  let body;
  let exposureHtml = "";
  let shownCount = 0;
  lastExposure = { exposure: {}, subtitle: "" };
  if (!state.savedLoaded) {
    // A distinct class from saved-lineups-empty (below): a QA screenshot script waits for the real
    // empty/loaded state and must never mistake "still loading" for "confirmed empty".
    body = `<div class="saved-lineups-loading">Loading…</div>`;
  } else if (state.savedError) {
    // 🔵 finding: a failed GET (e.g. LINEUPS_UNREADABLE) must say so, not render as a false "no saved
    // lineups yet" — that would read as "you have none" when the real answer is "couldn't check".
    body = `<div class="saved-lineups-empty saved-lineups-error">${escapeHtml(state.savedError)}</div>`;
  } else if (savedHere.length === 0) {
    body = `<div class="saved-lineups-empty">No saved ${opt.mode === "cash" ? "cash " : ""}lineups for this slate yet.</div>`;
  } else {
    // Adam 2026-10-11: only the saved lineups holding every chosen player show, and the exposure counts those only.
    const pick = pickOptions(rowById);
    const n = savedHere.length;
    // Plan 7a: computed, never stored; over the same list the Entries screen numbers (slateLineups), so "3" is one lineup on both (🔵 2026-10-17).
    const numbers = numberLineups(slateLineups(state.savedLineups, slateKeyOf(store.get().board)));
    const shown = filterLineups(savedHere, opt.mustHave, (l) => savedLineupPlayers(l, rowById));
    const k = shown.length;
    shownCount = k;
    if (k === 0) {
      body = `<div class="saved-lineups-empty">${NO_MATCH_TEXT}</div>`;
    } else {
      body = savedGroupsHtml(shown.map((e) => e.item), (l) => savedLineupCardHtml(l, rowById, pick, numbers));
      const subtitle = opt.mustHave.length ? `${k} of ${n} saved lineup${n === 1 ? "" : "s"}, filtered` : `${n} saved lineup${n === 1 ? "" : "s"}`;
      lastExposure = { exposure: exposureOfLineups(shown.map((e) => savedLineupPlayers(e.item, rowById))), subtitle };
      exposureHtml = optExposureHtml(lastExposure.exposure, lastExposure.subtitle, opt.expSortDir, pick);
    }
  }
  // Adam 2026-10-17: the exposure tables above the cards, so they are high on the screen
  return `
    <div class="saved-lineups" id="saved-lineups">
      ${mustHaveBarHtml(shownCount, savedHere.length)}
      ${exposureHtml}
      ${body}
      ${state.savedLoaded && !state.savedError ? otherModeSavedHtml() : ""}
    </div>`;
}

/** Cash mode job 3b, 2026-10-17: the quiet line for this slate's saved lineups of the mode not on screen. */
function otherModeSavedHtml() {
  const other = opt.mode === "cash" ? "gpp" : "cash";
  const n = savedOfActiveSlate(other).length;
  const word = other === "cash" ? "Cash" : "GPP";
  return n ? `<div class="saved-lineups-other">${n} ${word} lineup${n === 1 ? "" : "s"} saved; switch to ${word} to see ${n === 1 ? "it" : "them"}</div>` : "";
}

const NO_MATCH_TEXT = "No lineups here have all of the chosen players.";

/** The click-to-filter hooks the card and exposure builders take: `isChosen(boardId)` says whether that player is in
 *  the "only lineups with" list (matched by DraftKings identity, as exposure counts him). */
function pickOptions(rowById) {
  return { isChosen: (id) => opt.mustHave.includes(identityOf(id, rowById)) };
}

/** The "Only lineups with:" bar for the tab on screen, empty when nobody is chosen. */
function mustHaveBarHtml(shown, total) {
  const chips = opt.mustHave.map((key) => ({ key, name: opt.mustHaveNames[key] ?? key }));
  return filterBarHtml(chips, shown, total);
}

/** A saved lineup's players for the exposure tables: the live board row when there is one (matchup D43, own% D32),
 *  else the saved snapshot. */
export function savedLineupPlayers(lineup, rowById) {
  return (lineup.slots ?? []).map((s) => {
    const id = String(s.playerId);
    const row = rowById.get(id);
    return row
      ? { id, name: row.name, pos: row.pos, team: row.team, opp: matchupText(row), own: row.own ?? null, identity: dkIdentity(row) }
      : { id, name: s.name, pos: s.pos, team: s.team, opp: "", own: s.own ?? null, identity: id };
  });
}

/** The identity of every currently-placed player (🔵 finding 6), used both to disable Add on an
 *  already-placed row and to block adding the same DraftKings player twice under a different board id. */
function placedIdentities(rowById) {
  const set = new Set();
  for (const s of state.slots) {
    if (!s) continue;
    const row = rowById.get(String(s.id));
    if (row) set.add(dkIdentity(row));
  }
  return set;
}

/** The Rankings filter bar's position chips (filterbar.js's one copy), setting the same global position filter. */
export function poolPosChipsHtml() {
  const { pos, showAllPlayers, starredOnly } = store.get().filters;
  // Adam 2026-10-17: "Starred only" sits by the position tabs and is the Rankings filter itself (filters.starredOnly), so it holds across tabs.
  const starredChip = `<button type="button" data-action="pool-starred" class="chip toggle-chip${starredOnly ? " active" : ""}" aria-pressed="${starredOnly ? "true" : "false"}">★ Starred only</button>`;
  return `<div class="chip-group lineup-pos-chips">${posChipsHtml(pos, `data-action="pool-pos"`)}${starredChip}${showAllToggleHtml(showAllPlayers, `data-action="show-all"`)}</div>`;
}

/** Starred only is on and nothing is listed: say whether no one is starred at this position or other filters hide them. */
function poolEmptyRowHtml(graded, pos, colspan) {
  const hidden = graded.filter((r) => r.starred && matchesPosition(r, pos)).length;
  const text = hidden > 0
    ? `${hidden} starred at this position ${hidden === 1 ? "is" : "are"} hidden by other filters (projection floor, teams, salary, game or search)`
    : pos === "All" ? "No starred players" : "No starred players at this position";
  return `<tr><td class="lineup-pool-empty" colspan="${colspan}">${text}</td></tr>`;
}

/** The Starred only chip's click: flips the Rankings filter and keeps Rankings' own chip in step. */
export function togglePoolStarredOnly() {
  const on = !store.get().filters.starredOnly;
  document.querySelector("#starred-toggle")?.classList.toggle("active", on);
  store.setFilters({ starredOnly: on });
}

/** A pool star click goes to app.js's star toggle; with none passed (Rankings never rendered) it says so. */
export function poolStarClick(id) {
  if (poolCallbacks?.onToggleStar) poolCallbacks.onToggleStar(id);
  else console.error("Pool star clicked but no star callback is wired (renderLineupPanel got none).");
}

export function rightColumnHtml(rows, rowById) {
  const { filters, sort } = store.get();
  // The classic projection floor (D52) applies to this pool like every other classic list, with one exception:
  // a player already locked or excluded stays listed so his lock or exclude can still be undone here.
  // D33: Value colours as on Rankings, FLEX included.
  const graded = rowsGradedForView(rows, filters.pos, store.get().board?.rows ?? rows);
  const cash = opt.mode === "cash"; // Cash mode job 3b, 2026-10-17: one Cash column of Must | Want | Fine in place of Min % and Max %
  const wantSet = new Set(cash ? wantIdsFor(slateKeyOf(store.get().board)) : []);
  const filtered = filterRows(graded, { ...filters, showAllPlayers: true }).filter(
    (row) => passesProjFloor(row, filters) || state.locks.has(String(row.id)) || state.excludes.has(String(row.id)) || wantSet.has(String(row.id))
  );
  const sorted = sortRows(filtered, sort.col, sort.dir);
  const placed = placedIdentities(rowById);
  // Headers sort through the same store sort the Rankings table uses (sort.col / sort.dir; keys player,
  // salary, proj, own, value, star are the ones state.js sortRows reads); the shared sortableHeadHtml draws them.
  // Max % is a plain header, not sortable (Adam 2026-10-11); Adam 2026-10-17: it follows Value, a star column leads,
  // and Pos and Status are no longer columns (the position chip and the status tag sit in the Player cell).
  const headBefore = [
    { key: "star", label: "★", cls: "lineup-star-col" },
    { key: "player", label: "Player" },
    { key: "salary", label: "Sal" },
    { key: "proj", label: "Proj" },
    { key: "own", label: "Own%" },
    { key: "value", label: "Proj/$", title: "Proj/$: projection per $1,000 of salary" },
  ];
  const inner = (cols) => sortableHeadHtml(cols, sort).replace(/^<tr>|<\/tr>$/g, "");
  const maxHead = `<th class="lineup-max-head" title="Most of the new lineups this player may be in; blank = no cap">Max %</th>`;
  const minHead = `<th class="lineup-min-head" title="Fewest of the new lineups this player must be in; blank = none">Min %</th>`;
  const cashHead = `<th class="lineup-cash-head" title="Must puts a player in every lineup; Want puts him on your list, and each lineup shows whether he made it; Fine leaves him to the numbers">Cash</th>`;
  const headHtml = `<tr>${inner(headBefore)}${cash ? cashHead : minHead + maxHead}<th></th></tr>`;
  const slateKey = slateKeyOf(store.get().board);
  const maxMap = playerMaxFor(slateKey);
  const minMap = playerMinFor(slateKey);
  const showPos = filters.pos === "All" || filters.pos === "FLEX";
  const bodyRows = sorted.map((row) => rightRowHtml(row, placed, showPos, maxMap, minMap, cash ? wantSet : null)).join("");
  const emptyRow = sorted.length === 0 && filters.starredOnly ? poolEmptyRowHtml(graded, filters.pos, headBefore.length + (cash ? 2 : 3)) : "";
  return `
    <div class="lineup-rows-wrap scroll-panel">
      <table class="lineup-rows-table lineup-pool-table">
        <thead>${headHtml}</thead>
        <tbody>${bodyRows}${emptyRow}</tbody>
      </table>
    </div>
    <div class="table-legend">&mdash; = nobody has published one</div>`;
}

/** A finite number with at most one decimal and no trailing ".0" (25 -> "25", 23.75 -> "23.8"); null when not a finite number. */
function num1(n) {
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : null;
}

/** The pool row's matchup pill text: "vs CHI · 26.5tm / 52tot / +1" (opponent, then team total, game total and the team's own spread, joined by " / "). Each part is left out when its data is missing; "" when all are. */
function matchupPillText(row) {
  const opp = matchupText(row);
  const team = num1(row.impliedTotal);
  const game = num1(row.total);
  const nums = []; // Adam 2026-10-17: the pill reads tm / tot
  if (team !== null && game !== null) nums.push(`${team}tm / ${game}tot`);
  if (Number.isFinite(row.spread)) nums.push(row.spread < 0 ? num1(row.spread) : row.spread > 0 ? `+${num1(row.spread)}` : "pk");
  return [opp, nums.join(" / ")].filter(Boolean).join(" · ");
}

function rightRowHtml(row, placedSet, showPos, maxMap = {}, minMap = {}, cashWant = null) { // cashWant: a Set of Want ids in cash mode, else null
  const id = String(row.id);
  const maxText = maxMap[id] ?? "";
  const maxBad = Number.isNaN(parsePct(maxText));
  const minText = minMap[id] ?? "";
  const minBad = Number.isNaN(parsePct(minText));
  const t = TEAM_BY_ABBR[row.team];
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  const textColour = textColourFor(primary, secondary);
  const locked = state.locks.has(id);
  const excluded = state.excludes.has(id);
  // 🔵 finding 6: "already placed" is a DraftKings-identity comparison, not a board-id comparison.
  const placed = placedSet.has(dkIdentity(row));
  // 🔵 finding 8: same dimming rule as the Rankings table.
  const dimmed = rowIsOut(row);
  const rowClass = `${excluded ? " lineup-row-excluded" : locked ? " lineup-row-locked" : ""}${dimmed ? " row-dimmed" : ""}`;
  // Adam 2026-10-17: the status tag sits between the team chip and the name (the red OUT tag alone when the row has one),
  // the position chip only on the All and FLEX tabs, and the matchup pill (opponent, totals, the team's spread) ends the cell.
  const statusTag = lineupOutTagHtml(row) || statusTagsHtml(row);
  const pillText = matchupPillText(row);
  const posChip = showPos && row.pos ? `<span class="pos-mini">${escapeHtml(row.pos)}</span>` : "";
  const pill = pillText ? `<span class="meta-pill">${escapeHtml(pillText)}</span>` : "";
  return `
    <tr class="lineup-row${rowClass}" data-id="${escapeHtml(id)}">
      <td class="lineup-star-col"><button type="button" class="star-btn${row.starred ? " active" : ""}" data-action="toggle-star" data-id="${escapeHtml(id)}"${poolCallbacks?.onToggleStar ? "" : " disabled"}>${row.starred ? "★" : "☆"}</button></td>
      <td>
        <span class="player-cell">
          <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(row.team ?? "")}</span>${statusTag}<span class="player-name">${escapeHtml(row.name)}</span>${posChip}${pill}
        </span>
      </td>
      <td>${money(row.salary)}</td>
      <td>${row.proj == null ? "no proj" : dec1(row.proj)}</td>
      <td>${row.own == null ? "—" : `${dec1(row.own)}%`}</td>
      <td>${gradedCellHtml(row.value, row.valueGrade)}</td>
      ${cashWant
        ? `<td class="lineup-cash-cell">${convictionChipsHtml(row, { locked, wanted: cashWant.has(id), excluded })}</td>`
        : `<td class="lineup-min-cell"><input type="text" inputmode="decimal" maxlength="5" class="opt-input lineup-min-input${minBad ? " invalid" : ""}" data-player-min="${escapeHtml(id)}" value="${escapeHtml(minText)}" aria-label="Min % for ${escapeHtml(row.name ?? "")}" /></td>
      <td class="lineup-max-cell"><input type="text" inputmode="decimal" maxlength="5" class="opt-input lineup-max-input${maxBad ? " invalid" : ""}" data-player-max="${escapeHtml(id)}" value="${escapeHtml(maxText)}" aria-label="Max % for ${escapeHtml(row.name ?? "")}" /></td>`}
      <td class="lineup-row-actions">
        ${cashWant ? "" : `<button type="button" class="lineup-row-btn${locked ? " active" : ""}" data-action="row-lock" data-id="${escapeHtml(id)}"${excluded ? " disabled" : ""}>${locked ? "Locked" : "Lock"}</button>`}
        <button type="button" class="lineup-row-btn${excluded ? " active danger" : ""}" data-action="row-exclude" data-id="${escapeHtml(id)}">${excluded ? "Excluded" : "Exclude"}</button>
        <button type="button" class="lineup-row-btn" data-action="row-add" data-id="${escapeHtml(id)}"${excluded || placed ? " disabled" : ""}>Add</button>
      </td>
    </tr>`;
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
  // Pool position chips and sortable headers write the store's global filter / sort, exactly what the Rankings tab's
  // chips and headers write (app.js filterCallbacks.onPosChange / onSortClick), so "current filters" stays true.
  // The store change re-renders this panel (keeping the pool's scroll position). The Rankings filter bar's own chips
  // only get class toggles, so they are kept in step here.
  container.querySelectorAll("[data-action='pool-pos']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pos = btn.dataset.pos;
      document.querySelectorAll("#pos-chips .pos-chip").forEach((c) => c.classList.toggle("active", c.dataset.pos === pos));
      store.setFilters({ pos });
    });
  });
  container.querySelectorAll("[data-action='pool-starred']").forEach((btn) => {
    btn.addEventListener("click", togglePoolStarredOnly);
  });
  container.querySelectorAll("[data-action='toggle-star']").forEach((btn) => {
    btn.addEventListener("click", () => poolStarClick(btn.dataset.id));
  });
  wireShowAllButtons(container);
  wirePoolSearchChip(container);
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

const OPT_MAX_COUNT = 150;
const OPT_MAX_UNIQUE = 8;
const OPT_DEFAULT_COUNT = 5;
const OPT_DEFAULT_UNIQUE = 1;
// D73: the QB stack's choices (server/lineup/multi.js STACK_OWN_MAX / STACK_OPP_MAX) and defaults, "or more" ticked.
const OPT_STACK_OWN_MAX = 4;
const OPT_STACK_OPP_MAX = 3;
const OPT_DEFAULT_STACK = { stackOwn: 1, stackOwnOrMore: true, stackOpp: 0, stackOppOrMore: true };
const OPT_BUSY_TEXT = "Another set of lineups is still being made. Try again in a moment.";

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

const opt = {
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
  generating: false,
  saving: false,
  error: null, // the server's sentence for a refused or failed request
  saveError: null,
  formError: null, // a sentence naming a maximum-exposure box (position or player) that is not a percent; blocks Go
  results: null, // {slateKey, lineups: [{uid, ids, salary, proj, ceil?, players, saved?}], notes, builtIn} or null
};
let optSeq = 0;

function resetOptimizerResults() {
  opt.results = null;
  opt.error = null;
  opt.saveError = null;
}

function clearMustHave() {
  opt.mustHave = [];
  opt.mustHaveNames = {};
}

const boardRowMap = (board) => new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
const qbGlobals = () => ({ stackOwn: opt.stackOwn, stackOwnOrMore: opt.stackOwnOrMore, stackOpp: opt.stackOpp, stackOppOrMore: opt.stackOppOrMore });
const listedQbIds = (rows) => new Set(listedQbs(rows, lockedIds(state.slots, state.locks)).map((r) => String(r.id)));

function pruneQbStacks(board) {
  if (board && pruneEntries(opt.qb.entries, boardRowMap(board))) savePersisted();
}

function qbStacksForRequest(board, notes) {
  return qbStacksPayload(opt.qb.entries, boardRowMap(board), listedQbIds(activeSlateRows(board)), notes, lockedIds(state.slots, state.locks));
}

// ---- Cash mode job 3b, 2026-10-17 (PROJECT.md Part 4 "Cash mode"; the pure pieces are in lineup-cash.js) ----

const wantIdsFor = (slateKey) => opt.cash.want[slateKey] ?? [];

function setWant(slateKey, id, on) {
  const rest = wantIdsFor(slateKey).filter((w) => w !== id);
  opt.cash.want = { ...opt.cash.want, [slateKey]: on ? [...rest, id] : rest };
}

/** Must is the lock (D70), Want is membership of the cash pool for the slate on screen, Fine is neither (it takes a placed
 *  player out of his slot as unlocking does). Must keeps a Want listing; Want and Fine on a Must player unlock him first. */
function cashPick(id, pick) {
  opt.cashUndo = null; // Cash 3b fix round, 2026-10-17: a pick after Make them Must is never silently undone by Undo
  const slateKey = slateKeyOf(store.get().board);
  if (pick === "must") {
    if (!state.locks.has(id)) lockPool(id);
    return;
  }
  const wasMust = state.locks.has(id);
  if (wasMust) unlockPool(id);
  // Want: a Must or Fine player becomes Want only, a Want player goes back to Fine. Fine: off the list.
  setWant(slateKey, id, pick === "want" && (wasMust || !wantIdsFor(slateKey).includes(id)));
}

/** The mode switch: the build on screen goes under its mode and the other mode's comes back, through hydrate's slot
 *  normalising and the board check (🔵 on 3a). */
function setMode(next) {
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

/** What a cash build is made by: {basis "median" | "proj" | null, blocked, text}. TwoGun mode builds by TwoGun's median, else
 *  by projection; TwoGun mode on a board with no medians cannot build (CQ5). The server picks the same basis. */
function cashBasisInfo(board) {
  if (!isTwoGunMode(board)) return { basis: "proj", blocked: false, text: "Projection" };
  if (!boardHasMedians(activeSlateRows(board))) return { basis: null, blocked: true, text: "TwoGun mode is on but this board has no medians; switch to current mode to build by projection" };
  const when = board?.mode?.twogun?.boardUpdated;
  return { basis: "median", blocked: false, text: `TwoGun's median${when ? ` (board updated ${when})` : ""}` };
}

/** The Wants of the slate on screen that are not Must, as board rows. */
function wantRowsFor(slateKey, rowById) {
  return wantIdsFor(slateKey).filter((id) => !state.locks.has(id)).map((id) => rowById.get(id)).filter(Boolean);
}

/** The footer sentence in cash: "2 cash lineups by TwoGun's median · 1 Must · 2 Want · max 3 per team" (no minimum-unique clause: Adam 2026-10-17). */
function cashSummaryText(board) {
  const s = buildCashSettings(opt.cash);
  const info = cashBasisInfo(board);
  const rowById = currentRowById();
  const by = info.blocked ? "no basis (no TwoGun medians)" : info.basis === "median" ? "TwoGun's median" : "projection";
  const parts = [`${s.count} cash lineup${s.count === 1 ? "" : "s"} by ${by}`, `${lockedNames(rowById).length} Must`, `${wantRowsFor(slateKeyOf(board), rowById).length} Want`];
  if (s.maxPerTeam !== null) parts.push(`max ${s.maxPerTeam} per team`);
  return parts.join(" · ");
}

/** The Wants a cash batch is judged on: the slate's Want list without the players locked when it was built (a Must is in every lineup). */
const cashWantIds = (results) => wantIdsFor(results.slateKey ?? "main").filter((id) => !(results.cash?.lockedIds ?? []).includes(id));

// Cash 3b fix round, 2026-10-17: the swap search costs about 0.9 s per hard Want over 150 cards, so each card's decisions are kept
// per batch (a WeakMap on the results object: a new batch starts clean) and searched again only when the Want list or the board changes.
const swapCache = new WeakMap();
export const swapScanHook = { onScan: null }; // tests only (tests/cash-wiring.test.mjs): counts the searches through wantSwaps' onScan

/** wantSwaps for one cash card, under the limits the batch was built with (results.cash). */
function cardSwapDecisions(lineup, results) {
  const board = store.get().board;
  const wantIds = cashWantIds(results);
  const key = [...wantIds].sort().join("|");
  if (!swapCache.has(results)) swapCache.set(results, new Map());
  const perCard = swapCache.get(results);
  const hit = perCard.get(lineup.uid);
  if (hit && hit.key === key && hit.board === board) return hit.decisions;
  const c = results.cash ?? {};
  const decisions = wantSwaps(lineup, wantIds, activeSlateRows(board), {
    basis: results.basis ?? "proj", cap: SALARY_CAP, excludedIds: c.excludedIds ?? [], lockedIds: c.lockedIds ?? [], maxPerTeam: c.maxPerTeam ?? null, avoidGames: c.avoidGames ?? [], onScan: swapScanHook.onScan,
  });
  perCard.set(lineup.uid, { key, board, decisions });
  return decisions;
}

/** A cash card's pool strip: the Wants left out and the cheapest swap for each (excludedListHtml, swapDecisionHtml), and the ids of the Wants that are in.
 *  Cash 3b fix round, 2026-10-17: the swap button is drawn only in cash mode, and disabled while `busy`. */
function cashStrip(lineup, results, rowById, busy = false) {
  const wantIds = cashWantIds(results);
  if (!wantIds.length) return { html: "", wantIn: new Set() };
  const report = poolReport(lineup, wantIds, rowById);
  const decisions = cardSwapDecisions(lineup, results);
  const look = { button: opt.mode === "cash", disabled: busy };
  return { html: `<div class="cash-strip">${excludedListHtml(report)}${decisions.map((d, i) => swapDecisionHtml(d, i, look)).join("")}</div>`, wantIn: new Set(report.inLineup.map((r) => String(r.id))) };
}

// Cash 3b fix round, 2026-10-17: Make them Must and Undo act only in cash mode and never while a build or a save runs.
const cashSwapIdle = () => opt.mode === "cash" && !opt.generating && !opt.saving;

// Cash 3b fix round 2, 2026-10-17: the slots and locks as a copy, and whether the builder still holds a copy exactly.
const buildSnapshot = () => ({ slots: state.slots.map((s) => (s ? { ...s } : null)), locks: [...state.locks] });
const sameBuild = (b) => b.slots.length === state.slots.length && b.slots.every((s, i) => (s?.id ?? null) === (state.slots[i]?.id ?? null))
  && b.locks.length === state.locks.size && b.locks.every((id) => state.locks.has(id));

/** "Make them Must and rebuild": locks the Want(s) of one swap decision (never the partner), builds again, and offers Undo only
 *  when that build put a new batch in place (Cash 3b fix round 2, 2026-10-17); a build that did not run puts the locks and slots
 *  back, so the old batch stays with the form's or the server's sentence as the only message. */
async function cashMakeMust(uid, index) {
  if (!cashSwapIdle()) return;
  const board = store.get().board;
  if (cashBasisInfo(board).blocked) return;
  const r = opt.results;
  const lineup = r?.lineups.find((l) => l.uid === uid);
  if (!lineup || r.mode !== "cash") return;
  const d = cardSwapDecisions(lineup, r)[index];
  if (!d || d.kind === "none") return;
  const wants = new Set(cashWantIds(r));
  const picked = d.in.filter((x) => wants.has(String(x.id)));
  const before = buildSnapshot();
  opt.cashUndo = null;
  for (const x of picked) {
    const id = String(x.id);
    lockPool(id);
    // No open slot for him: a pool-only lock still counts as Must, since the server assigns slots itself; the Must chip instead
    // refuses with no open slot (D70). The two paths differ on purpose (Cash 3b fix round, 2026-10-17).
    if (!state.locks.has(id) && state.addError) {
      state.locks.add(id);
      state.addError = null;
    }
  }
  const after = buildSnapshot();
  const built = await doGenerate();
  // A later edit during the build wins: nothing is put back over it and no Undo is offered for it. Layout round 2, 2026-10-17:
  // a new board (a star in the pool) gates only the Undo offer, so a refused build still puts the locks back; the restore
  // also clears lockPool's "added anyway" note for a player no longer in a slot.
  if (!sameBuild(after)) return;
  if (!built) {
    state.slots = before.slots;
    state.locks = new Set(before.locks);
    state.addError = null;
  } else if (store.get().board === board) opt.cashUndo = { ...before, after, names: picked.map((x) => x.name) };
  commit();
}

/** Puts back the build before the last Make them Must and builds again; refused (the snapshot dropped, no rebuild) unless the
 *  slots and locks are still exactly what Make them Must left (Cash 3b fix round 2, 2026-10-17). */
function cashUndo() {
  if (!cashSwapIdle()) return;
  const u = opt.cashUndo;
  if (!u) return;
  opt.cashUndo = null;
  if (!sameBuild(u.after)) {
    commit();
    return;
  }
  state.slots = u.slots;
  state.locks = new Set(u.locks);
  state.addError = null;
  doGenerate();
}

// ---- Pure helpers (exported for tests/optimizer-ui.test.mjs) ----

/** A whole number from a text box, clamped to [min, max]; anything that is not a number gives `fallback`. */
export function parseWhole(text, min, max, fallback) {
  const t = String(text ?? "").trim();
  if (t === "") return fallback;
  const n = Number(t);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** A percent box: blank is "no cap" (null); a number from 0 to 100 (a trailing % sign is allowed) is that number;
 *  anything else (words, a negative, over 100) is NaN, which blocks Go (exposureProblem) and is never clamped. */
export function parsePct(text) {
  const t = String(text ?? "").trim().replace(/%$/, "").trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return NaN;
  return n;
}

/** The first maximum-exposure box that is neither blank nor a number from 0 to 100, as a plain sentence naming
 *  the position, else null. */
export function exposureProblem(maxExp) {
  for (const pos of OPT_POSITIONS) {
    if (Number.isNaN(parsePct(maxExp?.[pos]))) {
      return `${pos} maximum exposure must be a percent from 0 to 100, or blank for no cap.`;
    }
  }
  return null;
}

/** D74: exposure by position over one set of lineups, computed here so each results tab shows its own set. Each
 *  lineup is a list of players {id, name, pos, team, opp, own, identity?}; a player counts once per lineup, keyed by
 *  his DraftKings identity when given. Rows carry optExposureHtml's fields {id, name, team, opp, own, count, pct},
 *  pct of this set's lineups to one decimal. */
export function exposureOfLineups(lineups) {
  const out = Object.fromEntries(OPT_POSITIONS.map((p) => [p, []]));
  const list = (lineups ?? []).filter((l) => Array.isArray(l) && l.length);
  if (!list.length) return out;
  const byKey = new Map();
  for (const players of list) {
    const seen = new Set();
    for (const p of players) {
      if (!p || p.id == null) continue;
      const key = String(p.identity ?? p.id);
      if (seen.has(key)) continue;
      seen.add(key);
      const hit = byKey.get(key);
      if (hit) hit.count++;
      else byKey.set(key, { pos: p.pos, row: { id: String(p.id), name: p.name ?? String(p.id), team: p.team ?? null, opp: p.opp ?? "", own: p.own ?? null }, count: 1 });
    }
  }
  for (const { pos, row, count } of byKey.values()) {
    if (out[pos]) out[pos].push({ ...row, count, pct: Math.round((count / list.length) * 1000) / 10 });
  }
  return out;
}

/** A board id's DraftKings identity (dkIdentity), or the id itself when the board has no row for it. */
function identityOf(id, rowById) {
  const row = rowById?.get(String(id));
  return row ? dkIdentity(row) : String(id);
}

/** One lineup as a set: its players' DraftKings identities, sorted, so the same nine players match in any slot order. */
export function lineupSetKey(ids, rowById) {
  return [...new Set((ids ?? []).map((id) => identityOf(id, rowById)))].sort().join("|");
}

/** The set keys of saved lineups (their slots' player ids): a new card whose key is here shows "Saved ✓". */
export function savedSetKeys(savedLineups, rowById) {
  return new Set((savedLineups ?? []).map((l) => lineupSetKey((l.slots ?? []).map((s) => s.playerId), rowById)));
}

/** Per new-lineup card, the ids of players who were not in the card before it (by DraftKings identity, Adam
 *  2026-10-11: "highlight the new players from the previous lineup"); the first card has none. */
export function newPlayerIds(lineups, rowById) {
  return (lineups ?? []).map((l, k) => {
    if (k === 0) return new Set();
    const before = new Set((lineups[k - 1].ids ?? []).map((id) => identityOf(id, rowById)));
    return new Set((l.ids ?? []).map(String).filter((id) => !before.has(identityOf(id, rowById))));
  });
}

/** The saved lineups of the slate on screen: those saved with its key; one saved with no slate counts on the main
 *  slate always and on a second slate when every player is in its games. This is the server's existingForSlate rule
 *  (server/lineup/generate-request.js), repeated because the browser app cannot import server files. With a `mode` (cash
 *  mode job 3b, 2026-10-17) only lineups of that mode count, a missing mode reading as GPP, as the server's mode filter does. */
export function savedForSlate(saved, slateKey, slateIds, mode = null) {
  const key = slateKey || "main";
  return (Array.isArray(saved) ? saved : [])
    .filter((l) => Array.isArray(l?.slots) && l.slots.length > 0)
    .filter((l) => mode === null || lineupModeOf(l) === mode)
    .filter((l) => (typeof l.slate === "string" && l.slate !== "" ? l.slate === key : key === "main" || l.slots.every((s) => slateIds.has(String(s.playerId)))));
}

/** A saved name that is unique on this slate: `wanted` when no name in `taken` equals it, else the lowest free
 *  "Lineup N" (N from 1). Names compare exactly, as the server's own "Lineup N" numbering does. */
export function uniqueSavedName(wanted, taken, stem = "Lineup") {
  const used = new Set((taken ?? []).map(String));
  if (!used.has(wanted)) return wanted;
  let n = 1;
  while (used.has(`${stem} ${n}`)) n++;
  return `${stem} ${n}`;
}

/** The board mode a lineup is built in, for its saved build record: "twogun" or "current", null where the board has no mode switch. */
function boardModeOf(board) {
  return board?.mode ? (isTwoGunMode(board) ? "twogun" : "current") : null;
}

/** The active slate's key: "main", or the second slate's key (D57). */
function slateKeyOf(board) {
  return activeSlate(board)?.key ?? "main";
}

/** The pool's Max % boxes for one slate, {id: text}. */
function playerMaxFor(slateKey) {
  return opt.playerMax[slateKey] ?? {};
}

/** The pool's Min % boxes for one slate, {id: text}. */
function playerMinFor(slateKey) {
  return opt.playerMin[slateKey] ?? {};
}

/** Persisted Max % / Min % boxes, kept only as {slateKey: {id: text}} with string text; anything else is dropped. */
function cleanPlayerMax(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [slate, map] of Object.entries(raw)) {
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    const kept = {};
    for (const [id, text] of Object.entries(map)) if (typeof text === "string" && text.trim() !== "") kept[id] = text;
    out[slate] = kept;
  }
  return out;
}

/** The first per-player Max % box that is neither blank nor a percent from 0 to 100, as a sentence naming the
 *  player (`nameOf(id)`), else null; it blocks Go like exposureProblem. */
export function playerMaxProblem(map, nameOf = (id) => id) {
  for (const [id, text] of Object.entries(map ?? {})) {
    if (Number.isNaN(parsePct(text))) return `${nameOf(id)}'s Max % must be a percent from 0 to 100, or blank for no cap.`;
  }
  return null;
}

const MIN_COUNT_PROBLEM = "The number of lineups must be a whole number before the Min % boxes can be checked.";
/** The first Min % box (`minMap`, {id: text}) that blocks Go, as a sentence naming the player, else null: not a percent
 *  from 0 to 100; more of the `asked` lineups (minLimit) than that player's Max % in `maxMap` allows (exposureLimit); or on
 *  an excluded player (`excluded`, a Set of ids); never for a Min under one lineup. The server refuses the same (PROJECT.md Part 4 Optimizer). */
export function playerMinProblem(minMap, maxMap, excluded, nameOf, asked) {
  for (const [id, text] of Object.entries(minMap ?? {})) {
    const min = parsePct(text);
    if (min === null) continue;
    if (Number.isNaN(min)) return `${nameOf(id)}'s Min % must be a percent from 0 to 100, or blank for none.`;
    if (Number.isNaN(minLimit(min, asked))) return MIN_COUNT_PROBLEM;
    if (!(minLimit(min, asked) > 0)) continue;
    const max = parsePct(maxMap?.[id]);
    if (max !== null && !Number.isNaN(max) && minLimit(min, asked) > exposureLimit(max, asked)) return `${nameOf(id)}'s Min % (${min}) is above his Max % (${max}).`;
    if (excluded.has(String(id))) return `${nameOf(id)} is excluded and has a Min %.`;
  }
  return null;
}

// The three position mixes the FLEX allows: a copy of CONFIGS in server/lineup/soft.js (the browser cannot import it).
const LINEUP_MIXES = [
  { QB: 1, RB: 3, WR: 3, TE: 1, DST: 1 },
  { QB: 1, RB: 2, WR: 4, TE: 1, DST: 1 },
  { QB: 1, RB: 2, WR: 3, TE: 2, DST: 1 },
];

/** soft.js slotsFull / lockedSlotWords: whether one more `pos` player fits no mix beside the locks (`locksAt`, {pos: n}). */
export function minSlotsFull(locksAt, pos) {
  const at = { ...locksAt, [pos]: (locksAt[pos] ?? 0) + 1 };
  return !LINEUP_MIXES.some((mix) => OPT_POSITIONS.every((p) => (at[p] ?? 0) <= mix[p]));
}

export function minSlotWords(pos) {
  return `the ${pos} slot${pos === "QB" || pos === "DST" ? " is" : "s are"} locked`;
}

/** A board row's DraftKings key, as the server's dkKeyOf: "dk:<dkId>", else "id:<id>". */
export function dkKeyOfRow(row, id) {
  const raw = row?.dkId == null ? "" : String(row.dkId).trim();
  return raw ? `dk:${raw}` : `id:${id}`;
}

const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null); // multi.js num: a numeric string is not a number
const upperOf = (v) => (v === null || v === undefined ? "" : String(v).trim().toUpperCase());

/** Whether the pool drops this unlocked row, mirroring multi.js minOutReason for what the browser can see. `pool` =
 *  {excludes (Set), avoid (Set of game ids), starredQbOnly, objective}. */
export function minRowOut(row, id, pool) {
  if (pool.excludes.has(String(id))) return true;
  const raw = upperOf(row?.pos);
  const listed = (Array.isArray(row?.rosterPositions) ? row.rosterPositions : []).map(upperOf).filter((p) => p && p !== "FLEX");
  const pos = OPT_POSITIONS.includes(raw) ? raw : listed.find((p) => OPT_POSITIONS.includes(p)) ?? null;
  const salary = numOrNull(row?.salary);
  if (!pos || salary === null || salary < 0) return true;
  const flags = Array.isArray(row.flags) ? row.flags : [];
  if (flags.includes("outAfterStamp") && !flags.includes("revived")) return true;
  // ChatGPT wish r: multi.js revivedOut (a revived player is out of a ceiling build only with no ceiling of his own or a TwoGun OUT call)
  if (pool.objective === "ceil" && flags.includes("revived") && (numOrNull(row.tg?.ceil) === null || row.tg?.call === "OUT")) return true;
  if (rowIsOut(row)) return true;
  const overridden = numOrNull(row.override?.proj) !== null;
  if (numOrNull(row.proj) === null || (!overridden && flags.includes("no projection"))) return true;
  const game = upperOf(row.gameId);
  if (game && pool.avoid.has(game)) return true;
  if (pool.starredQbOnly && pos === "QB" && !row.starred) return true;
  return pool.objective === "ceil" && numOrNull(row.tg?.ceil) === null;
}

/** multi.js pairBreak as a yes/no. a, b: {pos, team, opp, game, key, never (a QB's "no" keys)}; `rules` the D55 switches.
 *  The browser sends no allowRbGames, so a same-game RB pair always clashes under noSameGameRbs. */
export function pairClash(a, b, rules) {
  if (a.pos === "RB" && b.pos === "RB") {
    if (rules.noSameTeamRbs && a.team && a.team === b.team) return true;
    if (rules.noSameGameRbs && a.game && a.game === b.game) return true;
  }
  const [d, o] = a.pos === "DST" ? [a, b] : [b, a];
  if (rules.noDstVsOwnPlayers && d.pos === "DST" && o.pos !== "DST" && d.opp && o.team === d.opp) return true;
  return [[a, b], [b, a]].some(([q, p]) => q.pos === "QB" && q.never?.has(p.key));
}

/** multi.js lockedQbRefuses: whether the first locked QB's stack caps (`rule` = {capOwn, capOpp}, Infinity for none) or
 *  the per-team limit filled by locks keep `cand` out of every lineup. Sides: {pos, team, opp, stackOk}. */
export function lockStackRefuses(cand, locks, rule, maxPerTeam) {
  const qb = locks.find((c) => c.pos === "QB");
  if (!qb || cand.pos === "QB") return false;
  const offense = locks.filter((c) => c.pos !== "QB" && c.pos !== "DST");
  if (cand.pos !== "DST" && cand.stackOk && cand.team === qb.team && offense.filter((c) => c.stackOk && c.team === qb.team).length >= rule.capOwn) return true;
  if (cand.pos !== "DST" && qb.opp && cand.team === qb.opp && offense.filter((c) => c.team === qb.opp).length >= rule.capOpp) return true;
  const outside = cand.team !== qb.team && cand.team !== qb.opp;
  return maxPerTeam !== null && outside && locks.filter((c) => c.team === cand.team).length >= maxPerTeam;
}

/** The pair-rule and locked-QB-stack skips of the route, for the request `settings` (buildGenerateSettings' output):
 *  {clashOf(id), stackOutOf(id)}; locks and stack entries by DraftKings key, the last entry winning, as the route (D73).
 *  `rowOf(id)` gives a board row; every back, receiver and tight end counts toward the stack (D55 as amended 2026-10-17). */
export function minLockSkips(rowOf, settings) {
  const rules = settings.rules ?? {};
  const keyOf = (id) => dkKeyOfRow(rowOf(id), id);
  const entryOf = (id) => Object.entries(settings.qbStacks ?? {}).filter(([qid]) => keyOf(qid) === keyOf(id)).map(([, e]) => e).pop();
  const never = (id) => new Set(Object.entries(entryOf(id)?.players ?? {}).filter(([, c]) => c === "no").map(([pid]) => keyOf(pid)));
  const side = (id) => {
    const r = rowOf(id) ?? {};
    const pos = upperOf(r.pos);
    return { pos, team: upperOf(r.team), opp: upperOf(r.opp), game: upperOf(r.gameId), key: dkKeyOfRow(r, id), never: never(id), stackOk: pos === "RB" || pos === "WR" || pos === "TE" }; // mirrors countsTowardStack in server/lineup/stack-rules.js
  };
  const locks = [...new Map((settings.locks ?? []).filter((id) => rowOf(id)).map((id) => [keyOf(id), id])).values()].map((id) => ({ id, ...side(id) }));
  const qb = locks.find((c) => c.pos === "QB");
  const stack = qb ? entryOf(qb.id) : undefined;
  const set = (a, b) => typeof a === "number" || typeof b === "number";
  const ownOn = !(settings.stackOwn === 0 && settings.stackOwnOrMore);
  const oppOn = !(settings.stackOpp === 0 && settings.stackOppOrMore);
  const rule = {
    capOwn: stack && set(stack.teammatesMin, stack.teammatesMax) ? stack.teammatesMax ?? Infinity : ownOn && !settings.stackOwnOrMore ? settings.stackOwn : Infinity,
    capOpp: stack && set(stack.opponentsMin, stack.opponentsMax) ? stack.opponentsMax ?? Infinity : oppOn && !settings.stackOppOrMore ? settings.stackOpp : Infinity,
  };
  return {
    clashOf: (id) => locks.some((l) => pairClash(side(id), l, rules)),
    stackOutOf: (id) => lockStackRefuses(side(id), locks, rule, settings.maxPerTeam ?? null),
  };
}

/** The first Min % of a lineup or more (minLimit) the position makes impossible, as a sentence, else null: the locks leave no
 *  place for him (minSlotsFull), or the Min needs more lineups than the position's maximum exposure (exposureLimit) allows.
 *  `ctx` = {posOf(id), locked (Set of the ids locked in this slate), posMax ({pos: text}), asked, keyOf(id) (his
 *  DraftKings key, default the id), outOf(id) (the pool drops him), clashOf(id) (a lock keeps him out under a pair
 *  rule), stackOutOf(id) (a locked QB's stack or the per-team limit does), all default false}; like the route, those
 *  rows and a locked player's twin row are skipped, the last two after the slot check and before the cap check. */
export function playerMinPositionProblem(minMap, ctx, nameOf = (id) => id) {
  const keyOf = ctx.keyOf ?? ((id) => `id:${id}`);
  const locksAt = Object.fromEntries(OPT_POSITIONS.map((p) => [p, [...ctx.locked].filter((id) => ctx.posOf(id) === p).length]));
  const lockedKeys = new Set([...ctx.locked].map(keyOf));
  for (const [id, text] of Object.entries(minMap ?? {})) {
    const min = parsePct(text);
    const pos = ctx.posOf(id);
    if (Number.isNaN(minLimit(min, ctx.asked))) return MIN_COUNT_PROBLEM;
    if (!(minLimit(min, ctx.asked) > 0) || !(pos in locksAt) || lockedKeys.has(keyOf(id)) || ctx.outOf?.(id)) continue;
    if (minSlotsFull(locksAt, pos)) return `${nameOf(id)} has a Min % but ${minSlotWords(pos)}`;
    if (ctx.clashOf?.(id) || ctx.stackOutOf?.(id)) continue;
    const cap = parsePct(ctx.posMax?.[pos]);
    if (cap !== null && !Number.isNaN(cap) && minLimit(min, ctx.asked) > exposureLimit(cap, ctx.asked)) {
      return `${nameOf(id)}'s Min % (${min}) is above the ${pos} maximum exposure (${cap})`;
    }
  }
  return null;
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

/** The locked player ids: every filled slot, then any pool Lock not already placed. Strings, no repeats. */
export function lockedIds(slots, locks) {
  const out = [];
  const seen = new Set();
  for (const s of slots ?? []) {
    if (s && s.id != null && !seen.has(String(s.id))) {
      seen.add(String(s.id));
      out.push(String(s.id));
    }
  }
  for (const id of locks ?? []) {
    if (!seen.has(String(id))) {
      seen.add(String(id));
      out.push(String(id));
    }
  }
  return out;
}

/** The lineup count the request sends for the count box's text (blank is 5, "200" is 150): the Min % checks size by it. */
export function requestCount(text) {
  return parseWhole(text, 1, OPT_MAX_COUNT, OPT_DEFAULT_COUNT);
}

/** The Min % problem Go shows for the count box's raw text: sized by requestCount, never by the text (PROJECT.md Part 4 Min % and soft rules, D74). */
export function minProblemFor(countText, minMap, maxMap, excluded, nameOf) {
  return playerMinProblem(minMap, maxMap, excluded, nameOf, requestCount(countText));
}

/** The `settings` object for POST /api/lineup/generate. maxExposure carries only {pct: N} for boxes that have a
 *  number (a blank box is left out, never sent as 0); every rule and both D73 stack numbers and ticks are sent
 *  explicitly; maxPerTeam only when a limit is picked. */
export function buildGenerateSettings(form) {
  const maxExposure = {};
  for (const pos of OPT_POSITIONS) {
    const pct = parsePct(form.maxExposure?.[pos]);
    if (pct !== null && !Number.isNaN(pct)) maxExposure[pos] = { pct };
  }
  const rules = {};
  for (const r of OPT_RULES) rules[r.key] = form.rules?.[r.key] !== false;
  const settings = {
    count: requestCount(form.count),
    minUnique: parseWhole(form.minUnique, 1, OPT_MAX_UNIQUE, OPT_DEFAULT_UNIQUE),
    locks: (form.locks ?? []).map(String),
    excludes: (form.excludes ?? []).map(String),
    maxExposure,
    rules,
    avoidGames: [...(form.avoid ?? [])],
    objective: OBJECTIVES.some((o) => o.value === form.objective) ? form.objective : "proj",
    stackOwn: parseWhole(form.stackOwn, 0, OPT_STACK_OWN_MAX, OPT_DEFAULT_STACK.stackOwn),
    stackOwnOrMore: form.stackOwnOrMore === undefined ? OPT_DEFAULT_STACK.stackOwnOrMore : Boolean(form.stackOwnOrMore),
    stackOpp: parseWhole(form.stackOpp, 0, OPT_STACK_OPP_MAX, OPT_DEFAULT_STACK.stackOpp),
    stackOppOrMore: form.stackOppOrMore === undefined ? OPT_DEFAULT_STACK.stackOppOrMore : Boolean(form.stackOppOrMore),
  };
  if (MAX_TEAM_OPTIONS.includes(String(form.maxPerTeam ?? "")) && String(form.maxPerTeam ?? "") !== "") {
    settings.maxPerTeam = Number(form.maxPerTeam);
  }
  // Per-player Max % (Adam 2026-10-11): only boxes holding a percent, as {id: {pct}}; sent only when there is one.
  const playerMaxExposure = {};
  for (const [id, text] of Object.entries(form.playerMax ?? {})) {
    const pct = parsePct(text);
    if (pct !== null && !Number.isNaN(pct)) playerMaxExposure[String(id)] = { pct };
  }
  if (Object.keys(playerMaxExposure).length) settings.playerMaxExposure = playerMaxExposure;
  const playerMinExposure = {};
  for (const [id, text] of Object.entries(form.playerMin ?? {})) {
    const pct = parsePct(text);
    if (pct > 0) playerMinExposure[String(id)] = { pct }; // a Min of 0 is blank; null and NaN fail the test
  }
  if (Object.keys(playerMinExposure).length) settings.playerMinExposure = playerMinExposure;
  if (form.qbStacks && Object.keys(form.qbStacks).length) settings.qbStacks = form.qbStacks;
  if (form.spreadDst === true) settings.spreadDst = true;
  return settings;
}

/** {id: {pct}} from the settings as {id: pct}; {} for none (the exposure table's Min / Max marks). */
function pctsOf(map) {
  return Object.fromEntries(Object.entries(map ?? {}).map(([id, v]) => [id, v.pct]));
}

/** The whole request body: the active slate key (D57: "main" or the second slate's key) plus the settings. */
export function buildGeneratePayload(form, slateKey) {
  return { slate: slateKey || "main", settings: buildGenerateSettings(form) };
}

/** [{slot, playerId}] for POST /api/lineups. The server returns the nine players already in DraftKings slot order,
 *  so a full lineup maps by position in the list; a short or odd one is placed by position name, spare RB/WR/TE
 *  into FLEX. */
export function slotsForSave(players) {
  const list = players ?? [];
  if (list.length === LINEUP_SLOTS.length) return list.map((p, i) => ({ slot: LINEUP_SLOTS[i], playerId: String(p.id) }));
  const out = [];
  const used = new Array(LINEUP_SLOTS.length).fill(false);
  const place = (p, name) => {
    const i = LINEUP_SLOTS.findIndex((s, k) => s === name && !used[k]);
    if (i === -1) return false;
    used[i] = true;
    out.push({ slot: name, playerId: String(p.id) });
    return true;
  };
  for (const p of list) if (!place(p, p.pos) && FLEX_POS.has(p.pos)) place(p, "FLEX");
  return out;
}

/** Salary, projection and ownership totals of a generated lineup; ownership is null unless every player has a number. */
export function lineupTotalsOf(lineup) {
  const players = lineup?.players ?? [];
  const salary = lineup?.salary ?? players.reduce((s, p) => s + (p.salary ?? 0), 0);
  // ChatGPT wish d, Adam 2026-10-17: the projection total is the sum of the rows as shown (totals.js), not the engine's raw sum.
  const proj = shownTotal(players.map((p) => p.proj)) ?? lineup?.proj ?? null;
  const allOwn = players.length > 0 && players.every((p) => p.own != null);
  return { salary, proj, own: allOwn ? players.reduce((s, p) => s + p.own, 0) : null };
}

/** `notes` (optional): {ruleKey: {text, warn}}, a line under that rule's row (ChatGPT wish k: the starred-QB count). */
export function ruleRowsHtml(rules, keys = OPT_RULES.map((r) => r.key), notes = {}) {
  return OPT_RULES.filter((r) => keys.includes(r.key))
    .map((r) => settingRowHtml(r.label, switchButtonHtml(rules?.[r.key] !== false, r.label, `data-action="opt-rule" data-key="${escapeHtml(r.key)}"`), notes?.[r.key]?.text ?? "", notes?.[r.key]?.warn ? "opt-warn" : ""))
    .join("");
}

/** How many quarterbacks "starred QBs only" leaves in the pool (ChatGPT wish k, Adam 2026-10-17): the slate's QBs that are
 *  starred and not otherwise kept out (excluded, out, no projection, avoided game, no ceiling in a ceiling build), by the
 *  same test as the Min % checks (minRowOut). `pool` = {excludes (Set), avoid (Set), objective}. */
export function starredQbQualifiers(rows, pool) {
  return (rows ?? []).filter((r) => upperOf(r?.pos) === "QB" && !minRowOut(r, r.id, { ...pool, starredQbOnly: true })).length;
}

/** The line under the "starred QBs only" rule: "3 starred QBs qualify". At 0 it warns (nothing can be built) unless a QB is
 *  locked, which the build uses instead. */
export function starredQbNote(count, lockedQb) {
  const words = `${count} starred QB${count === 1 ? "" : "s"} ${count === 1 ? "qualifies" : "qualify"}`;
  if (count > 0) return { text: words, warn: false };
  return lockedQb ? { text: `${words}; the locked QB is used`, warn: false } : { text: `${words}: star one or lock one`, warn: true };
}

// The roster rules in plain words, for the "Nothing locked" warning (ChatGPT wish k); keys as OPT_RULES.
const RULE_WORDS = {
  starredQbOnly: "starred QBs only",
  noSameTeamRbs: "no two RBs from one team",
  noSameGameRbs: "no two RBs from one game",
  noDstVsOwnPlayers: "no defense facing a player in the lineup",
};

/** The warning when nothing is locked, naming the roster rules that are on. */
export function nothingLockedText(rules) {
  const on = OPT_RULES.filter((r) => rules?.[r.key] !== false).map((r) => RULE_WORDS[r.key]);
  return `Nothing locked: plain optimal lineups ${on.length ? `under ${on.join(", ")}` : "with no roster rules"}; rarely right for tournaments.`;
}

export function avoidChipsHtml(games, avoid) {
  return (games ?? [])
    .map((g) => {
      const id = String(g.id ?? g);
      const on = avoid?.has(id);
      return `<button type="button" class="chip opt-chip opt-avoid-chip${on ? " active" : ""}" data-action="opt-avoid" data-game="${escapeHtml(id)}" aria-pressed="${on ? "true" : "false"}">${escapeHtml(id.replace("@", " @ "))}</button>`;
    })
    .join("");
}

/** One "new lineup" card: the nine players in DK slot order (name, matchup D43, salary, projection, own% D32),
 *  the totals, and Save / Discard. `busy` disables both while a save is in flight. `saved`: the card is saved, or
 *  its nine players equal a saved lineup's, so Save shows a disabled "Saved ✓" (Adam 2026-10-11). `fresh`: the
 *  ids of players not in the card before, highlighted. `pick` ({isChosen(id)}): each name is the "only lineups
 *  with" button (Adam 2026-10-11). */
export function optLineupCardHtml(lineup, index, busy, { saved = false, fresh = null, pick = null, rowById = null, cash = null } = {}) {
  const totals = lineupTotalsOf(lineup);
  const overCap = totals.salary > SALARY_CAP;
  const decor = cardDecor(lineup, rowById, paletteForRows(rowById)); // Team rows, Adam 2026-10-17: one palette per render (cached on rowById)
  // Cash mode job 3b, 2026-10-17: `cash` = {basis, strip: {html, wantIn}} on a card built in cash: "Cash N", the cash totals, the unused-cap chip, a WANT tag on the Wants that made it and the pool strip.
  if (cash) {
    // 👁 fix round, 2026-10-17: stacking is no cash goal (PROJECT.md Part 4, Cash mode), so a cash card draws no QB-stack chip and no STACK / RUNBACK / MINI / PAIR tags; WANT and the OUT tags stay.
    decor.stack = "";
    decor.rolesFor = (p) => (cash.strip.wantIn.has(String(p.id)) ? `<span class="role-tag role-want" title="On your Want list">WANT</span>` : "");
  }
  const rows = (lineup.players ?? []).map((p, i) => cardPlayerRowHtml(p, LINEUP_SLOTS[i] ?? p.pos ?? "", Boolean(fresh?.has(String(p.id))), pick, decor)).join("");
  const ownText = totals.own == null ? "" : ` &middot; ${Math.round(totals.own)}% own`;
  // TwoGun mode: the lineup's total of TwoGun's ceilings, as the server summed it (absent in current mode; a dash
  // when a player has none, never a partial sum).
  const ceil = lineupCeilTotal(lineup); // ChatGPT wish d: the shown sum, totals.js
  const ceilText = ceil === undefined ? "" : ` &middot; ${ceil == null ? `<span title="A player in this lineup has no TwoGun ceiling">—</span>` : dec1(ceil)} ceil`;
  const uid = escapeHtml(lineup.uid ?? "");
  const saveBtn = saved
    ? `<button type="button" class="saved-lineup-btn opt-saved-btn" disabled>Saved ✓</button>`
    : `<button type="button" class="saved-lineup-btn" data-action="opt-save" data-uid="${uid}"${busy ? " disabled" : ""}>Save</button>`;
  return `
    <div class="opt-card${saved ? " opt-card-saved" : ""}" data-uid="${uid}">
      <div class="opt-card-head">
        <span class="opt-card-title">${cash ? "Cash" : "Lineup"} ${index + 1}</span>${decor.stack}
        <span class="opt-card-actions">
          ${saveBtn}
          <button type="button" class="saved-lineup-btn danger" data-action="opt-discard" data-uid="${uid}"${busy ? " disabled" : ""}>Discard</button>
        </span>
      </div>
      <div class="opt-card-players">${rows}</div>
      ${cash
        ? `<div class="opt-card-totals"><span class="${overCap ? "saved-lineup-totals-over" : ""}">${escapeHtml(cashTotalsText(lineup, cash.basis))}</span>${unusedCapText(totals.salary) ? ` <span class="cash-unused-chip" title="Salary left under the $50,000 cap">${escapeHtml(unusedCapText(totals.salary))}</span>` : ""}</div>${cash.strip.html}`
        : `<div class="opt-card-totals"><span class="${overCap ? "saved-lineup-totals-over" : ""}">${money(totals.salary)}</span> &middot; ${dec1(totals.proj) ?? "—"} proj${ceilText}${ownText}</div>`}
    </div>`;
}

export function optNotesHtml(notes) {
  return (notes ?? []).map((n) => `<div class="opt-note">${escapeHtml(n)}</div>`).join("");
}

/** The quiet line under a batch for the response's `bends` ([{lineup (1-based), label}]), lineups sharing a label
 *  grouped ("lineups 2, 3 and 7–9: <label>", a run of three or more as a range); "" when none or missing. */
export function bendsLineHtml(bends, made) {
  const list = (Array.isArray(bends) ? bends : []).filter((b) => b && Number.isFinite(b.lineup) && b.label);
  if (!list.length) return "";
  const n = new Set(list.map((b) => b.lineup)).size;
  const groups = new Map();
  for (const b of list) groups.set(b.label, [...(groups.get(b.label) ?? []), b.lineup]);
  const body = [...groups].map(([label, nums]) => {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      if (j - i >= 2) parts.push(`${sorted[i]}–${sorted[j]}`);
      else for (let k = i; k <= j; k++) parts.push(String(sorted[k]));
      i = j + 1;
    }
    const who = sorted.length === 1 ? `lineup ${parts[0]}` : `lineups ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`}`;
    return `${who}: ${label}`;
  }).join("; ");
  return `<div class="opt-bends">${n} of ${made} lineup${made === 1 ? "" : "s"} ${n === 1 ? "bends" : "bend"} a setting: ${escapeHtml(body)}.</div>`;
}

// ---- Rendering inside the panel ----

function lockedNames(rowById) {
  return lockedIds(state.slots, state.locks)
    .map((id) => rowById.get(id))
    .filter(Boolean);
}

/** The pool the starred-QB count is taken over (ChatGPT wish k): excluded, avoided and ceiling-less QBs fall out. */
function starredQbPool(board) {
  return { excludes: state.excludes, avoid: new Set([...opt.avoid].map((g) => String(g).toUpperCase())), objective: effectiveObjective(opt.objective, boardHasCeilings(activeSlateRows(board))) };
}

/** ChatGPT wish i, Adam 2026-10-17: the footer's one-line summary of the settings in effect, from the same `opt` the
 *  controls edit; count and unique as the request parses them, the objective as the build will use it. */
function optSummaryText(board) {
  if (opt.mode === "cash") return cashSummaryText(board); // Cash mode job 3b
  const rows = activeSlateRows(board);
  const lockedQb = lockedNames(currentRowById()).some((r) => upperOf(r.pos) === "QB");
  const qualifiers = opt.rules.starredQbOnly !== false ? starredQbQualifiers(rows, starredQbPool(board)) : null;
  const qbOwnCount = Object.keys(qbStacksPayload(opt.qb.entries, boardRowMap(board), listedQbIds(rows), null, lockedIds(state.slots, state.locks))).length;
  // 🔵 2026-10-17: the percents parsed by parsePct as buildGenerateSettings does (a blank or invalid box is null), and the
  // players with a Max % or Min % box counted from the request's own maps, for the players still in this slate's pool.
  const maxExp = Object.fromEntries(OPT_POSITIONS.map((pos) => { const p = parsePct(opt.maxExp[pos]); return [pos, Number.isNaN(p) ? null : p]; }));
  const slateKey = slateKeyOf(board);
  const poolIds = new Set(rows.map((r) => String(r.id)));
  const inPool = (map) => Object.fromEntries(Object.entries(map).filter(([id]) => poolIds.has(id)));
  const caps = buildGenerateSettings({ playerMax: inPool(playerMaxFor(slateKey)), playerMin: inPool(playerMinFor(slateKey)) });
  const playerCapCount = new Set([...Object.keys(caps.playerMaxExposure ?? {}), ...Object.keys(caps.playerMinExposure ?? {})]).size;
  const shown = { ...opt, maxExp, count: requestCount(opt.count), minUnique: parseWhole(opt.minUnique, 1, OPT_MAX_UNIQUE, OPT_DEFAULT_UNIQUE), objective: effectiveObjective(opt.objective, boardHasCeilings(rows)) };
  return activeRulesSummary(shown, { games: activeSlateGames(board), starredQbCount: qualifiers === 0 && lockedQb ? null : qualifiers, qbOwnCount, playerCapCount });
}

function optimizerControlsHtml(rowById) {
  if (opt.mode === "cash") return cashControlsHtml(rowById); // Cash mode job 3b
  const board = store.get().board;
  const locked = lockedNames(rowById);
  const games = activeSlateGames(board);
  const info = locked.length
    ? `<span class="opt-lockinfo">${locked.length} locked: ${escapeHtml(locked.map((r) => r.name).join(", "))}</span>`
    : `<span class="opt-warn">${escapeHtml(nothingLockedText(opt.rules))}</span>`;
  // 🔵 2026-10-17 (👁 render): the five position caps are one row of five small boxes, not five rows.
  const expRows = `<div class="opt-cap-row">${OPT_POSITIONS.map((pos) =>
    `<label class="opt-cap"><span class="opt-cap-pos">${pos}</span>${numberBoxHtml(`type="text" inputmode="decimal" class="opt-input opt-input-pct" data-opt-exp="${pos}" value="${escapeHtml(opt.maxExp[pos])}" placeholder="no cap" aria-label="${pos} maximum exposure percent"`, "%")}</label>`
  ).join("")}</div>` + settingRowHtml("Spread defenses", switchButtonHtml(opt.spreadDst, "Spread defenses", `data-action="opt-spread-dst"`), SPREAD_HINT);
  const lockedList = lockedIds(state.slots, state.locks);
  const qbRows = listedQbs(activeSlateRows(board), lockedList);
  const avoidRow = games.length ? settingChipsRowHtml("Avoid game", avoidChipsHtml(games, opt.avoid)) : "";
  const formError = opt.formError ? `<div class="lineup-status lineup-status-error opt-form-error">${escapeHtml(opt.formError)}</div>` : "";
  const options = (values, current, label = (v) => String(v)) =>
    values.map((v) => `<option value="${escapeHtml(String(v))}"${String(current) === String(v) ? " selected" : ""}>${escapeHtml(label(v))}</option>`).join("");
  const upTo = (max) => Array.from({ length: max + 1 }, (_, i) => i);
  const select = (id, label, values, current, text) => `<select id="${id}" class="opt-input opt-select-n" aria-label="${label}">${options(values, current, text)}</select>`;
  // ChatGPT wish i, Adam 2026-10-17: three groups, Pool (who may be used), Stacks, Build; the exposure caps are a sub-block of Build.
  const build = [
    settingRowHtml("Lineups to make", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_COUNT}" class="opt-input opt-input-num" id="opt-count" value="${escapeHtml(opt.count)}" aria-label="How many lineups"`), "From the slots you have locked"),
    settingRowHtml("Min unique players", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_UNIQUE}" class="opt-input opt-input-num" id="opt-min-unique" value="${escapeHtml(opt.minUnique)}" aria-label="Minimum unique players between lineups"`), "Between any two lineups"),
    settingRowHtml("Build by", `<span class="opt-chips">${objectiveChipsHtml(opt.objective, boardHasCeilings(activeSlateRows(board)))}</span>`),
    settingSubtitleHtml("Max share of lineups"),
    expRows,
    ruleRowsHtml(opt.rules, RULE_GROUPS.build),
  ].join("");
  const stacking = [
    settingRowHtml("Teammates", `${select("opt-stack-own", "Teammates to stack with the quarterback", upTo(OPT_STACK_OWN_MAX), opt.stackOwn)}${switchCheckboxHtml("opt-stack-own-more", opt.stackOwnOrMore, "or more", "exactly")}`),
    settingRowHtml("Opponents", `${select("opt-stack-opp", "Opponents to stack with the quarterback", upTo(OPT_STACK_OPP_MAX), opt.stackOpp)}${switchCheckboxHtml("opt-stack-opp-more", opt.stackOppOrMore, "or more", "exactly")}`),
    qbListHtml(qbRows, opt.qb, lockedList),
  ].join("");
  // 👁 2026-10-17: the open QBs' panels are full-width cards after the three groups (inside Stacks they grew to 822px).
  const qbPanels = qbPanelsHtml(qbRows, opt.qb, qbGlobals(), activeSlateRows(board), OPT_STACK_OWN_MAX, OPT_STACK_OPP_MAX, lockedList);
  // ChatGPT wish k, Adam 2026-10-17: with "starred QBs only" on, the line under it counts the QBs that qualify.
  const qbNotes = {};
  if (opt.rules.starredQbOnly !== false) {
    qbNotes.starredQbOnly = starredQbNote(starredQbQualifiers(activeSlateRows(board), starredQbPool(board)), locked.some((r) => upperOf(r.pos) === "QB"));
  }
  const pool = [
    ruleRowsHtml(opt.rules, RULE_GROUPS.pool, qbNotes),
    settingRowHtml("Max per team", `<select id="opt-max-team" class="opt-input opt-select" aria-label="Max per team">${options(MAX_TEAM_OPTIONS, opt.maxPerTeam, (v) => (v === "" ? "No limit" : v))}</select>`, "Not applied to the QB's team or his opponent"),
    avoidRow,
  ].join("");
  return `
    <div class="opt-panel opt-settings" id="opt-panel">
      ${optHeadHtml(info)}
      ${formError}
      <div class="opt-groups">
        ${settingGroupHtml("Pool", pool)}
        ${settingGroupHtml("Stacks", stacking)}
        ${settingGroupHtml("Build", build)}
        ${qbPanels}
      </div>
    </div>`;
}

/** The Optimizer band's head: the title with the GPP | Cash switch beside it (a green $ chip on the title in cash), the
 *  Must / lock line and a refused Build's sentence (cash mode job 3b, 2026-10-17). */
function optHeadHtml(infoHtml) {
  return `<div class="opt-settings-head">
        <h3 class="opt-title">Optimizer${opt.mode === "cash" ? ` ${cashChipHtml()}` : ""}${modeSwitchHtml(opt.mode)}</h3>
        ${infoHtml}
        ${opt.error ? `<span class="lineup-status-error opt-go-error">${escapeHtml(opt.error)}</span>` : ""}
      </div>`;
}

/** The Optimizer band in cash (cash mode job 3b): Pool (Max per team, Avoid game) and Build (Lineups to make, the fixed
 *  basis). No Stacks group, QB panels, caps row, Spread defenses, roster rules or minimum unique (Adam 2026-10-17): they are off in cash. */
function cashControlsHtml(rowById) {
  const board = store.get().board;
  const basis = cashBasisInfo(board);
  const games = activeSlateGames(board);
  const info = `<span class="opt-lockinfo">${cashHeadLine(lockedNames(rowById), wantRowsFor(slateKeyOf(board), rowById))}</span>`;
  const formError = opt.formError ? `<div class="lineup-status lineup-status-error opt-form-error">${escapeHtml(opt.formError)}</div>` : "";
  const teamOptions = MAX_TEAM_OPTIONS.map((v) => `<option value="${v}"${String(opt.cash.maxPerTeam) === v ? " selected" : ""}>${v === "" ? "No limit" : v}</option>`).join("");
  const pool = [
    settingRowHtml("Max per team", `<select id="opt-cash-max-team" class="opt-input opt-select" aria-label="Max per team">${teamOptions}</select>`, "Every team, the quarterback's included"),
    games.length ? settingChipsRowHtml("Avoid game", avoidChipsHtml(games, new Set(opt.cash.avoid))) : "",
  ].join("");
  const build = [
    settingRowHtml("Lineups to make", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_COUNT}" class="opt-input opt-input-num" id="opt-cash-count" value="${escapeHtml(opt.cash.count)}" aria-label="How many lineups"`), "The best first, then the next best"),
    basis.blocked ? settingRowHtml("Build by", "", basis.text, "opt-warn") : settingRowHtml("Build by", `<span class="cash-basis">${escapeHtml(basis.text)}</span>`),
  ].join("");
  return `
    <div class="opt-panel opt-settings" id="opt-panel">
      ${optHeadHtml(info)}
      ${formError}
      <div class="opt-groups opt-groups-cash">
        ${settingGroupHtml("Pool", pool)}
        ${settingGroupHtml("Build", build)}
      </div>
    </div>`;
}

/** Adam 2026-10-17: the Build button always in view (sticky footer at the tab's end). The summary sentence and Build sit
 *  in the last child of the panel (#lineup-panel), so position: sticky holds them to the bottom of the screen. */
function optimizerFooterHtml(board) {
  const busy = opt.generating || opt.saving || (opt.mode === "cash" && cashBasisInfo(board).blocked); // cash mode job 3b: no medians in TwoGun mode cannot build (CQ5)
  // 🔵 d842f0b: a refusal from Build must show where Build was pressed, which can be far below the settings head.
  const footerError = opt.formError ? `<div class="lineup-status lineup-status-error opt-form-error-footer">${escapeHtml(opt.formError)}</div>` : "";
  return `
    <div class="opt-footer">
      ${footerError}
      <span class="opt-summary">${escapeHtml(optSummaryText(board))}</span>
      <button type="button" id="opt-go-btn" class="lineup-build-btn opt-go opt-go-big"${busy ? " disabled" : ""}>${opt.generating ? "Making…" : "Build"}</button>
    </div>`;
}

/** The saved lineups of the slate on screen (D57 slate key, savedForSlate), of the mode on screen unless `mode` says another
 *  (cash mode job 3b: null = both, for names that must stay unique across modes). */
function savedOfActiveSlate(mode = opt.mode) {
  const board = store.get().board;
  const slateIds = new Set(activeSlateRows(board).map((r) => String(r.id)));
  return savedForSlate(state.savedLineups, slateKeyOf(board), slateIds, mode);
}

/** Which results tab shows (D74): Adam's pick this page load, else New when there is a batch (or one is being
 *  made), else Saved when this slate has saved lineups, else New. */
function activeResultsTab(savedHere) {
  if (opt.resultsTab === "new" || opt.resultsTab === "saved") return opt.resultsTab;
  if (opt.results || opt.generating || opt.error) return "new";
  return savedHere.length ? "saved" : "new";
}

/** Whether a new card counts as saved: its nine players equal a saved lineup's (`savedKeys` from savedSetKeys of
 *  this slate's saved lineups), so deleting that saved lineup turns the card back to Save. `lineup.saved` is set
 *  only when a save answer carried no saved list (saveGenerated). */
export function cardIsSaved(lineup, savedKeys, rowById) {
  return Boolean(lineup.saved) || savedKeys.has(lineupSetKey(lineup.ids ?? (lineup.players ?? []).map((p) => p.id), rowById));
}

let lastExposure = { exposure: {}, subtitle: "" }; // the exposure on screen, for the sort header's redraw

/** D74: the results are two tabs. New lineups: this batch's cards (Save turns into "Saved ✓"; players new since the
 *  card before are highlighted) and the exposure of the batch only. Saved lineups: this slate's saved cards and the
 *  exposure of those only. */
function optimizerResultsHtml(rowById) {
  const savedHere = savedOfActiveSlate();
  const tab = activeResultsTab(savedHere);
  const r = opt.results;
  const nNew = r ? r.lineups.length : 0;
  const tabBtn = (key, label, n) =>
    `<button type="button" role="tab" class="opt-tab${tab === key ? " active" : ""}" data-action="opt-tab" data-tab="${key}" aria-selected="${tab === key}">${label}${n ? ` <span class="opt-tab-n">${n}</span>` : ""}</button>`;
  const tabs = `<div class="opt-tabs" role="tablist" aria-label="Lineups">${tabBtn("new", "New lineups", nNew)}${tabBtn("saved", "Saved lineups", savedHere.length)}</div>`;
  const body = tab === "saved" ? savedLineupsSectionHtml(rowById, savedHere) : newLineupsTabHtml(rowById, savedHere);
  return `<div class="opt-results" id="opt-results">${tabs}<div class="opt-tab-panel" role="tabpanel">${body}</div></div>`;
}

function newLineupsTabHtml(rowById, savedHere) {
  const parts = [];
  const r = opt.results;
  // Adam 2026-10-11: only the lineups holding every chosen player show (cards keep their own numbers); the
  // exposure counts those only. Nothing is deleted or changed by it.
  const pick = pickOptions(rowById);
  const shown = filterLineups(r?.lineups ?? [], opt.mustHave, (l) => (l.players ?? []).map((p) => ({ ...p, identity: identityOf(p.id, rowById) })));
  parts.push(mustHaveBarHtml(shown.length, r?.lineups.length ?? 0));
  if (opt.error) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(opt.error)}</div>`);
  if (!r) {
    parts.push(`<div class="saved-lineups-empty">${opt.generating ? "Making lineups…" : "No new lineups. Press Build to make some."}</div>`);
    lastExposure = { exposure: {}, subtitle: "" };
    return parts.join("");
  }
  const n = r.lineups.length;
  const busy = opt.saving || opt.generating;
  const isCash = r.mode === "cash"; // Cash mode job 3b: a batch keeps the mode it was built in; "Saved ✓" looks among the saved lineups of that mode
  const savedKeys = savedSetKeys(isCash === (opt.mode === "cash") ? savedHere : savedOfActiveSlate(isCash ? "cash" : "gpp"), rowById);
  const savedFlags = r.lineups.map((l) => cardIsSaved(l, savedKeys, rowById));
  const nSaved = savedFlags.filter(Boolean).length;
  // Save all / Discard all act only on the lineups shown while the filter is on (Adam 2026-10-11).
  const filtered = opt.mustHave.length > 0;
  const nShown = shown.length;
  const allSaved = n > 0 && (filtered ? shown.every((e) => savedFlags[e.index]) : nSaved === n);
  const noneShown = filtered && nShown === 0;
  // While filtered, "Save K shown" counts only the shown lineups not yet saved (the same test as the card's Saved mark).
  const nShownUnsaved = shown.filter((e) => !savedFlags[e.index]).length;
  parts.push(
    n
      ? `<div class="opt-results-head">
           <span class="opt-sub">${isCash ? escapeHtml(builtInTextCash(n, r.basis, r.boardMode)) : `${n} lineup${n === 1 ? "" : "s"} from the last Build${r.builtIn ? ` (${escapeHtml(r.builtIn)})` : ""}`}${nSaved ? `, ${nSaved} saved` : ", not saved yet"}</span>
           <span class="opt-card-actions">
             <button type="button" class="saved-lineup-btn" data-action="opt-save-all"${busy || allSaved || noneShown ? " disabled" : ""}>${bulkLabel("Save", nShownUnsaved, filtered)}</button>
             <button type="button" class="saved-lineup-btn danger" data-action="opt-discard-all"${busy || noneShown ? " disabled" : ""}>${bulkLabel("Discard", nShown, filtered)}</button>
           </span>
         </div>`
      : `<div class="opt-sub">None left from the last Build.</div>`
  );
  if (opt.saveError) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(opt.saveError)}</div>`);
  if (isCash && opt.cashUndo) parts.push(`<div class="cash-undo">Made ${escapeHtml(opt.cashUndo.names.join(" and "))} Must and built again. <button type="button" class="lineup-row-btn" data-cash-undo${busy ? " disabled" : ""}>Undo</button></div>`);
  parts.push(optNotesHtml(r.notes));
  if (n && !shown.length) {
    parts.push(`<div class="saved-lineups-empty">${NO_MATCH_TEXT}</div>`);
    lastExposure = { exposure: {}, subtitle: "" };
  } else if (n) {
    // Bend numbers and marks describe the batch as made: hidden once a card is discarded.
    const whole = n === r.made;
    const players = shown.map((e) => (e.item.players ?? []).map((p) => ({ ...p, identity: identityOf(p.id, rowById) })));
    const k = shown.length;
    const subtitle = opt.mustHave.length ? `${k} of ${n} new lineup${n === 1 ? "" : "s"}, filtered` : `${n} new lineup${n === 1 ? "" : "s"}`;
    const marks = whole && !filtered && r.made >= r.marks.asked ? r.marks : null; // a short batch is not marked
    let exposure = exposureOfLineups(players);
    if (marks) {
      const held = new Set(players.flat().map((p) => p.identity));
      const playerOf = (id) => {
        const row = rowById.get(String(id));
        return row ? { name: row.name, pos: row.pos, team: row.team, opp: matchupText(row), own: row.own } : null;
      };
      exposure = zeroMinRows(exposure, marks, playerOf, (id) => held.has(identityOf(id, rowById)));
    }
    lastExposure = { exposure, subtitle, marks };
    // Adam 2026-10-17: the exposure tables above the cards, so they are high on the screen
    parts.push(optExposureHtml(lastExposure.exposure, lastExposure.subtitle, opt.expSortDir, pick, lastExposure.marks));
    // The new-player highlight compares a card with the previous card SHOWN.
    const fresh = newPlayerIds(shown.map((e) => e.item), rowById);
    const cardCash = (lineup) => (isCash ? { basis: r.basis, strip: cashStrip(lineup, r, rowById, busy) } : null);
    parts.push(`<div class="opt-cards">${shown.map((e, k) => optLineupCardHtml(e.item, e.index, busy, { saved: savedFlags[e.index], fresh: fresh[k], pick, rowById, cash: cardCash(e.item) })).join("")}</div>`);
    if (whole) parts.push(bendsLineHtml(r.bends, r.made));
  } else {
    lastExposure = { exposure: {}, subtitle: "" };
  }
  return parts.join("");
}

// ---- Actions ----

/** Cash 3b fix round 2, 2026-10-17: true only when a new batch was put in place; false on every other exit (cashMakeMust reads it). */
async function doGenerate() {
  if (opt.generating || opt.saving) return false;
  const board = store.get().board;
  const slate = activeSlate(board);
  const slateKey = slate ? slate.key : "main";
  const nameById = new Map((board?.rows ?? []).map((r) => [String(r.id), r.name]));
  // The per-player Max % boxes of this slate, for players still in its pool (D57).
  const slateRowIds = new Set(activeSlateRows(board).map((r) => String(r.id)));
  const playerMax = Object.fromEntries(Object.entries(playerMaxFor(slateKey)).filter(([id]) => slateRowIds.has(id)));
  const pickSlate = (map) => Object.fromEntries(Object.entries(map).filter(([id]) => slateRowIds.has(id)));
  const playerMin = pickSlate(playerMinFor(slateKey));
  const nameOf = (id) => nameById.get(id) ?? id;
  const rowOf = new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
  const cash = opt.mode === "cash"; // Cash mode job 3b, 2026-10-17: a cash build sends buildCashSettings and none of the GPP-only boxes
  const basis = cashBasisInfo(board);
  opt.formError = cash ? (basis.blocked ? basis.text : null) : exposureProblem(opt.maxExp) ?? playerMaxProblem(playerMax, nameOf) ?? minProblemFor(opt.count, playerMin, playerMax, state.excludes, nameOf);
  if (opt.formError) {
    commit();
    return false;
  }
  // The week and the slate on screen when Go was pressed: a response that arrives after either changed belongs to
  // something no longer shown and is dropped.
  const madeForWeek = seasonWeekKey(board);
  const madeForSlate = store.get().activeSlateKey ?? null;
  let locks = lockedIds(state.slots, state.locks);
  const slateNotes = [];
  let avoid = cash ? [...opt.cash.avoid] : [...opt.avoid];
  if (slate) {
    // D57: the server builds from the second slate's games only and refuses a lock outside them, so those locks are
    // left out of this request and said so, as the single Build does.
    const inSlate = new Set(activeSlateRows(board).map((r) => String(r.id)));
    const kept = locks.filter((id) => inSlate.has(id));
    const leftOut = locks.length - kept.length;
    locks = kept;
    if (leftOut > 0) {
      slateNotes.push(`${leftOut} locked player${leftOut === 1 ? " is" : "s are"} not in the ${slateDisplayName(slate)}'s games and ${leftOut === 1 ? "was" : "were"} left out of these lineups.`);
    }
  }
  const gameIds = new Set(activeSlateGames(board).map((g) => String(g.id)));
  avoid = avoid.filter((g) => gameIds.has(g));
  let form; // the GPP request's form; in cash only its objective is read (none: the head uses builtInTextCash)
  let sent;
  if (cash) {
    form = { objective: null };
    sent = { slate: slateKey, settings: buildCashSettings(opt.cash, { locks, excludes: [...state.excludes], avoidGames: avoid }) };
  } else {
    form = {
      count: opt.count,
      minUnique: opt.minUnique,
      maxExposure: opt.maxExp,
      rules: opt.rules,
      avoid,
      locks,
      excludes: [...state.excludes],
      objective: effectiveObjective(opt.objective, boardHasCeilings(activeSlateRows(board))),
      maxPerTeam: opt.maxPerTeam,
      stackOwn: opt.stackOwn,
      stackOwnOrMore: opt.stackOwnOrMore,
      stackOpp: opt.stackOpp,
      stackOppOrMore: opt.stackOppOrMore,
      playerMax,
      playerMin,
      qbStacks: qbStacksForRequest(board, slateNotes),
      spreadDst: opt.spreadDst,
    };
    sent = buildGeneratePayload(form, slateKey);
    // The pre-Go Min % checks read the request as built: only the locks that stay in this slate count (the route sees those alone).
    const rowAt = (id) => rowOf.get(String(id));
    const pool = {
      excludes: new Set(form.excludes.map(String)),
      avoid: new Set(avoid.map((g) => String(g).toUpperCase())),
      starredQbOnly: sent.settings.rules.starredQbOnly !== false,
      objective: sent.settings.objective,
    };
    opt.formError = playerMinPositionProblem(playerMin, {
      posOf: (id) => String(rowAt(id)?.pos ?? "").toUpperCase(),
      locked: new Set(locks),
      posMax: opt.maxExp,
      asked: sent.settings.count,
      keyOf: (id) => dkKeyOfRow(rowAt(id), id),
      outOf: (id) => !rowAt(id) || minRowOut(rowAt(id), id, pool),
      ...minLockSkips(rowAt, sent.settings),
    }, nameOf);
    if (opt.formError) {
      commit();
      return false;
    }
  }
  let built = false;
  opt.generating = true;
  opt.error = null;
  opt.saveError = null;
  opt.resultsTab = "new"; // D74: a Go shows the New lineups tab
  commit();
  try {
    const data = await postLineupGenerate(sent);
    if (seasonWeekKey(store.get().board) !== madeForWeek || (store.get().activeSlateKey ?? null) !== madeForSlate) {
      opt.generating = false;
      commit();
      return false;
    }
    if (!data || data.ok === false) {
      opt.error = data?.error?.code === "GENERATE_BUSY" ? data.error.message || OPT_BUSY_TEXT : data?.error?.message ?? "Could not make lineups.";
    } else {
      const lineups = (Array.isArray(data.lineups) ? data.lineups : []).map((l) => ({ ...l, uid: `n${++optSeq}` }));
      const notes = [...slateNotes, ...(Array.isArray(data.notes) ? data.notes : [])];
      if (!lineups.length && !notes.length) notes.push("No lineups could be made from these locks and settings.");
      // Each set is labelled with the mode and objective it was built in, so a set made before a mode flip says so
      // (package C review item 9: labelled, not cleared, so a flip never throws away lineups).
      // Only where the mode switch exists (board.mode): a board with no mode reads exactly as before, no label.
      const builtIn = board?.mode ? builtInText(board.mode.active, form.objective) : "";
      // The response's own exposure (saved plus new) is not shown: each tab computes its own (D74).
      const bends = Array.isArray(data.bends) ? data.bends : [];
      const marks = { asked: sent.settings.count, min: pctsOf(sent.settings.playerMinExposure), max: pctsOf(sent.settings.playerMaxExposure) };
      // ChatGPT wish g, Adam 2026-10-17: what a save from this batch records on each lineup (lineup-builds.js batchBuild).
      const build = { buildId: newBuildId(Date.now(), Math.random()), boardMode: boardModeOf(board), objective: form.objective };
      opt.results = { slateKey, lineups, notes, builtIn, bends, made: lineups.length, marks, ...build };
      // Cash mode job 3b: the batch keeps the mode and basis the answer names, and the limits its cards' swap search must respect.
      if (cash) {
        opt.results.mode = "cash";
        opt.results.basis = data.basis ?? null;
        opt.results.cash = { lockedIds: sent.settings.locks, excludedIds: sent.settings.excludes, maxPerTeam: sent.settings.maxPerTeam, avoidGames: sent.settings.avoidGames };
      }
      built = true;
    }
  } catch (e) {
    opt.error = `Could not reach the server: ${e.message}`;
  }
  opt.generating = false;
  commit();
  try {
    lastContainer?.querySelector("#opt-results")?.scrollIntoView({ block: "start", behavior: "smooth" });
  } catch (e) {
    // Scrolling is a convenience only.
  }
  return built;
}

/** Saves the given new lineups one after another through the existing save-lineup route (D57: with the active slate
 *  key). A saved card stays where it is and shows a disabled "Saved ✓" (Adam 2026-10-11), and it lands in the Saved
 *  tab; a card already saved, or matching a saved lineup, is skipped; the first failure stops the run and stays. */
async function saveGenerated(uids) {
  if (opt.saving || opt.generating || !opt.results) return;
  opt.saving = true;
  opt.saveError = null;
  commit();
  const results = opt.results;
  const slateKey = results.slateKey ?? "main"; // the slate these lineups were made for, not the one on screen now
  const rowById = new Map((store.get().board?.rows ?? []).map((r) => [String(r.id), r]));
  const mode = results.mode === "cash" ? "cash" : "gpp"; // Cash mode job 3b, 2026-10-17: a card saves in the mode it was built in
  for (const uid of uids) {
    const lineup = results.lineups.find((l) => l.uid === uid);
    if (!lineup || cardIsSaved(lineup, savedSetKeys(savedOfActiveSlate(mode), rowById), rowById)) continue;
    try {
      // The card's own name ("Lineup 2", "Cash 2") is kept as the saved name unless this slate already has it (Entries
      // picks lineups by name, so names stay unique per slate, across both modes).
      const taken = savedOfActiveSlate(null).map((l) => l.name);
      const stem = mode === "cash" ? "Cash" : "Lineup";
      const name = uniqueSavedName(`${stem} ${results.lineups.indexOf(lineup) + 1}`, taken, stem);
      const data = await postLineup({ name, slots: slotsForSave(lineup.players), slate: slateKey, ...(mode === "cash" ? { mode } : {}), build: batchBuild(results, lineup) }); // Cash 3b fix round, 2026-10-17: GPP sends no mode
      if (!data || data.ok === false) {
        opt.saveError = data?.error?.message ?? "Could not save the lineup.";
        break;
      }
      // The saved list decides "Saved ✓" (so a later Delete shows Save again); the card's own flag is only for a
      // save answer that carried no list to match against.
      if (Array.isArray(data.lineups)) state.savedLineups = data.lineups;
      else lineup.saved = true;
    } catch (e) {
      opt.saveError = `Could not reach the server: ${e.message}`;
      break;
    }
  }
  opt.saving = false;
  commit();
}

function discardGenerated(uid) {
  if (!opt.results) return;
  opt.results.lineups = opt.results.lineups.filter((l) => l.uid !== uid);
  commit();
}

/** The exposure header flips the one sort and redraws only the exposure section on screen (never the whole panel),
 *  then re-wires its headers. */
function wireExposureSort(container) {
  const redraw = () => {
    const section = container.querySelector(".opt-exposure");
    if (!section) return;
    const holder = document.createElement("div");
    holder.innerHTML = optExposureHtml(lastExposure.exposure, lastExposure.subtitle, opt.expSortDir, pickOptions(currentRowById()), lastExposure.marks ?? null);
    const fresh = holder.querySelector(".opt-exposure");
    if (!fresh) return;
    section.replaceWith(fresh);
    wireExposureSort(container);
    wirePickButtons(fresh); // only the new section; the rest keep their handlers
  };
  container.querySelectorAll(".opt-exposure [data-action='opt-exp-sort']").forEach((th) => {
    th.addEventListener("click", () => {
      opt.expSortDir = opt.expSortDir === "asc" ? "desc" : "asc";
      redraw();
    });
  });
}

function currentRowById() {
  return new Map((store.get().board?.rows ?? []).map((r) => [String(r.id), r]));
}

/** Adam 2026-10-11: a player's name (exposure row or lineup card, new or saved) adds him to the "only lineups with"
 *  list or takes him out; a chip's × takes him out; Clear empties it. Page-only; nothing is saved or deleted. */
function wirePickButtons(container) {
  container.querySelectorAll("[data-action='opt-pick']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = identityOf(btn.dataset.pickId, currentRowById());
      if (!opt.mustHave.includes(key)) opt.mustHaveNames[key] = btn.dataset.pickName ?? key;
      opt.mustHave = toggleMustHave(opt.mustHave, key);
      commit();
    });
  });
  container.querySelectorAll("[data-action='opt-pick-remove']").forEach((btn) => {
    btn.addEventListener("click", () => {
      opt.mustHave = toggleMustHave(opt.mustHave, btn.dataset.pickKey);
      commit();
    });
  });
  container.querySelector("[data-action='opt-pick-clear']")?.addEventListener("click", () => {
    clearMustHave();
    commit();
  });
}

function wireOptimizer(container) {
  // ChatGPT wish i: the footer summary follows the boxes that do not re-render the panel as they are typed in.
  const refreshSummary = () => {
    const el = container.querySelector(".opt-summary");
    if (el) el.textContent = optSummaryText(store.get().board);
  };
  const bind = (sel, key) => {
    const el = container.querySelector(sel);
    el?.addEventListener("input", () => {
      opt[key] = el.value;
      refreshSummary();
    });
  };
  bind("#opt-count", "count");
  bind("#opt-min-unique", "minUnique");
  // Cash mode job 3b, 2026-10-17: the mode switch, cash's own boxes (kept on every keystroke, as the Min % boxes are) and the swap buttons.
  container.querySelectorAll("[data-opt-mode]").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.optMode));
  });
  for (const [sel, key, event] of [["#opt-cash-count", "count", "input"],["#opt-cash-max-team", "maxPerTeam", "change"]]) {
    const el = container.querySelector(sel);
    el?.addEventListener(event, () => {
      opt.cash[key] = el.value;
      savePersisted();
      refreshSummary();
    });
  }
  container.querySelectorAll("[data-cash-swap]").forEach((btn) => {
    btn.addEventListener("click", () => cashMakeMust(btn.closest(".opt-card")?.dataset.uid, Number(btn.dataset.cashSwap)));
  });
  container.querySelector("[data-cash-undo]")?.addEventListener("click", () => cashUndo());
  container.querySelectorAll("[data-opt-exp]").forEach((el) => {
    el.addEventListener("input", () => {
      opt.maxExp[el.dataset.optExp] = el.value;
      refreshSummary();
      if (opt.formError) {
        opt.formError = null;
        container.querySelector(".opt-form-error")?.remove();
        container.querySelector(".opt-form-error-footer")?.remove(); // the footer copy goes with the head copy
      }
    });
  });
  // Max per team and the D73 stack: the value is kept in `opt`; nothing else on the panel depends on it,
  // so no re-render.
  const bindValue = (sel, key, read) => {
    const el = container.querySelector(sel);
    el?.addEventListener("change", () => {
      opt[key] = read(el);
      refreshSummary();
    });
  };
  bindValue("#opt-max-team", "maxPerTeam", (el) => el.value);
  bindValue("#opt-stack-own", "stackOwn", (el) => Number(el.value));
  bindValue("#opt-stack-opp", "stackOpp", (el) => Number(el.value));
  bindValue("#opt-stack-own-more", "stackOwnOrMore", (el) => el.checked);
  bindValue("#opt-stack-opp-more", "stackOppOrMore", (el) => el.checked);
  for (const id of ["own", "opp", "own-more", "opp-more"]) {
    container.querySelector(`#opt-stack-${id}`)?.addEventListener("change", () => opt.qb.open.size && commit());
  }
  wireExposureSort(container);
  wirePickButtons(container);
  container.querySelector("#opt-go-btn")?.addEventListener("click", () => doGenerate());
  // Projection or Ceiling, Adam's pick each time; a greyed Ceiling (no ceilings on this board) does nothing.
  container.querySelectorAll("[data-action='opt-objective']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-disabled") === "true" || opt.objective === btn.dataset.value) return;
      opt.objective = btn.dataset.value;
      commit();
    });
  });
  container.querySelectorAll("[data-action='opt-rule']").forEach((btn) => {
    btn.addEventListener("click", () => {
      opt.rules[btn.dataset.key] = !(opt.rules[btn.dataset.key] !== false);
      commit();
    });
  });
  container.querySelector("[data-action='opt-spread-dst']")?.addEventListener("click", () => {
    opt.spreadDst = !opt.spreadDst;
    commit();
  });
  const settingsEl = container.querySelector("#opt-panel");
  if (settingsEl) {
    wireQbStacks(settingsEl, { qbs: opt.qb, globals: qbGlobals, ownMax: OPT_STACK_OWN_MAX, oppMax: OPT_STACK_OPP_MAX, commit, save: savePersisted });
    // 🔵 2026-10-17: wireQbStacks saves a QB's own stack boxes without a re-render; this listener (added after its own,
    // so it runs after the edit) keeps the footer's "custom stacks on N QBs" current.
    settingsEl.addEventListener("change", refreshSummary);
  }
  container.querySelectorAll("[data-action='opt-avoid']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = btn.dataset.game;
      if (opt.mode === "cash") opt.cash.avoid = opt.cash.avoid.includes(g) ? opt.cash.avoid.filter((x) => x !== g) : [...opt.cash.avoid, g]; // Cash mode job 3b: cash's own list
      else if (opt.avoid.has(g)) opt.avoid.delete(g);
      else opt.avoid.add(g);
      commit();
    });
  });
  container.querySelectorAll("[data-action='opt-save']").forEach((btn) => {
    btn.addEventListener("click", () => saveGenerated([btn.dataset.uid]));
  });
  container.querySelectorAll("[data-action='opt-discard']").forEach((btn) => {
    btn.addEventListener("click", () => discardGenerated(btn.dataset.uid));
  });
  container.querySelector("[data-action='opt-save-all']")?.addEventListener("click", () => {
    saveGenerated(shownNewUids()); // only the shown lineups while filtered; saved cards are skipped inside
  });
  // D74: the New / Saved tabs; the pick is remembered for this page load.
  container.querySelectorAll("[data-action='opt-tab']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (opt.resultsTab === btn.dataset.tab) return;
      opt.resultsTab = btn.dataset.tab === "saved" ? "saved" : "new";
      commit();
    });
  });
  // The pool's Max % boxes: kept per slate as typed and saved to localStorage on every keystroke without a
  // re-render (focus stays in the box); a box that is not a percent turns red and blocks Go.
  for (const [field, selector, forSlate] of [["playerMax", "[data-player-max]", playerMaxFor], ["playerMin", "[data-player-min]", playerMinFor]]) {
    container.querySelectorAll(selector).forEach((el) => {
      el.addEventListener("input", () => {
        const key = slateKeyOf(store.get().board);
        const map = { ...forSlate(key) };
        if (el.value.trim() === "") delete map[el.dataset[field]];
        else map[el.dataset[field]] = el.value;
        opt[field] = { ...opt[field], [key]: map };
        el.classList.toggle("invalid", Number.isNaN(parsePct(el.value)));
        if (opt.formError) {
          opt.formError = null;
          container.querySelector(".opt-form-error")?.remove();
          container.querySelector(".opt-form-error-footer")?.remove(); // the footer copy goes with the head copy
        }
        savePersisted();
        refreshSummary(); // "caps on N players" follows the boxes
      });
    });
  }
  container.querySelector("[data-action='opt-discard-all']")?.addEventListener("click", () => {
    if (opt.mustHave.length && opt.results) {
      // Filtered: discard only the lineups shown; the hidden ones stay untouched (Adam 2026-10-11).
      const gone = new Set(shownNewUids());
      opt.results.lineups = opt.results.lineups.filter((l) => !gone.has(l.uid));
    } else {
      resetOptimizerResults();
    }
    commit();
  });
}

/** The uids of the new lineups on screen: all of them, or only those holding every chosen player. */
function shownNewUids() {
  const rowById = currentRowById();
  return bulkUids(opt.results?.lineups ?? [], opt.mustHave, (l) => (l.players ?? []).map((p) => ({ ...p, identity: identityOf(p.id, rowById) })));
}
