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
import { store, filterRows, sortRows, passesProjFloor, FLEX_POS, defaultDirFor, activeSlate, activeSlateRows, activeSlateGames, slateDisplayName, boardHasCeilings } from "./state.js";
import { sortableHeadHtml } from "./tabs.js";
import { matchupText, lineupOutTagHtml, statusTagsHtml, rowHasStatus, gradedCellHtml, rowIsOut, twoGunOutReason, STATUS_INFO } from "./table.js"; // D43: the one copy of "vs DAL" / "@ DET"; the red OUT tag (Adam 2026-10-15)
import { rowsGradedForView } from "./grade.js";
import { posChipsHtml, showAllToggleHtml, wireShowAllButtons } from "./filterbar.js";
import { filterLineups, bulkUids, bulkLabel, toggleMustHave, pickButtonHtml, filterBarHtml } from "./lineup-filter.js";
import { OPT_POSITIONS, optExposureHtml, sortExposure } from "./lineup-exposure.js";
import { cardPlayerRowHtml, cardDecor, badgeHtml, ownParen } from "./lineup-card.js";
import { lineupRoles, roleTagsHtml } from "./lineup-marks.js";
import { poolSearchChipHtml, wirePoolSearchChip } from "./lineup-search.js";
import { settingRowHtml, settingGroupHtml, switchButtonHtml, switchCheckboxHtml, numberBoxHtml } from "./lineup-settings.js";
import { newQbState, listedQbs, pruneEntries, cleanSavedEntries, qbStacksPayload, qbListHtml, qbPanelsHtml, wireQbStacks, SPREAD_HINT } from "./lineup-qb-stacks.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { postLineupGenerate, getLineups, postLineup, deleteLineup, putLineupName } from "./api.js";
import { renderEntriesSection, wireEntries } from "./entries.js";
import { phoneMinHeight, panelMinHeight } from "./expand.js";

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

export { optExposureHtml, sortExposure }; // lineup-exposure.js
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
  saving: false,
  saveError: null,
  saveConfirm: null, // a short "Saved ..." message shown once after a successful save
  renamingId: null, // id of the saved lineup currently showing its inline rename box, or null
  deleteConfirmId: null, // id of the saved lineup currently showing its inline "Delete this lineup?" prompt, or null
};

let savedFetchInFlightKey = null; // the season-week key a GET is currently in flight for, else null

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
    })
    .catch((e) => {
      state.savedLineups = [];
      state.savedError = `Could not reach the server: ${e.message}`;
      state.savedLoaded = true;
      commit();
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
        qbStacks: opt.qb.entries,
        spreadDst: opt.spreadDst,
      })
    );
  } catch (e) {
    // localStorage unavailable (private mode, quota, disabled) — state just won't survive a reload.
  }
}

let hydrated = false;

/** Reads localStorage exactly once per page load. Everything it accepts is still subject to
 *  validateAgainstBoard() once a board exists (🔵 finding 1), so a stale slate never survives here. */
function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  const persisted = loadPersisted();
  if (!persisted) return;
  if (Array.isArray(persisted.slots) && persisted.slots.length === LINEUP_SLOTS.length) {
    state.slots = persisted.slots.map((s, i) => (s && s.id != null ? { id: String(s.id), slot: LINEUP_SLOTS[i] } : null));
  }
  if (Array.isArray(persisted.locks)) state.locks = new Set(persisted.locks.map(String));
  if (Array.isArray(persisted.excludes)) state.excludes = new Set(persisted.excludes.map(String));
  opt.playerMax = cleanPlayerMax(persisted.playerMax);
  opt.qb.entries = cleanSavedEntries(persisted.qbStacks, OPT_STACK_OWN_MAX);
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
  const savedKey = seasonWeekKey(board);
  if (savedKey !== lastSavedKey) {
    lastSavedKey = savedKey;
    state.savedLoaded = false;
    state.savedLineups = [];
    state.savedError = null;
    loadSavedLineups(savedKey);
    resetOptimizerResults(); // new lineups belong to the week they were made for
    clearMustHave(); // the players he filtered by belong to that week too
    opt.avoid.clear(); // avoid-game picks are games of that week
  }
  const rowById = new Map((board.rows ?? []).map((r) => [String(r.id), r]));
  for (const id of [...state.locks]) if (!rowById.has(id)) state.locks.delete(id);
  for (const id of [...state.excludes]) if (!rowById.has(id)) state.excludes.delete(id);
  for (const map of Object.values(opt.playerMax)) for (const id of Object.keys(map)) if (!rowById.has(id)) delete map[id];
  state.slots = state.slots.map((s, i) => {
    if (!s) return null;
    if (!rowById.has(String(s.id))) return null; // no row on this board: drop it
    return { id: String(s.id), slot: LINEUP_SLOTS[i] }; // rebuilt fresh; nothing else is ever stored
  });
}

let lastContainer = null;

/** The season-week the Entries section loads for, or null when no board or week is loaded yet. */
function entriesWeekKey(board) {
  return board?.slate?.season != null && board?.slate?.week != null ? seasonWeekKey(board) : null;
}

export function renderLineupPanel(container) {
  lastContainer = container;
  hydrateFromStorage();
  validateAgainstBoard(store.get().board);
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
function snapPanelMaxHeight(panelEl, top, reserve) {
  // Same phone minimum as app.js's copy (70% of the window's height at max-width 700px, via expand.js).
  const phoneMin = Math.max(phoneMinHeight(), panelMinHeight(panelEl, top)); // the Optimizer pool's floor too (expand.js)
  const available = Math.max(window.innerHeight - top - reserve, phoneMin);
  const rows = panelEl.querySelectorAll("tbody tr");
  const borderAllowance = panelEl.offsetHeight - panelEl.clientHeight;
  if (rows.length === 0) {
    panelEl.style.maxHeight = phoneMin
      ? `${Math.max(Math.round(window.innerHeight - top - reserve), phoneMin)}px`
      : `calc(100vh - ${Math.round(top)}px - ${Math.round(reserve)}px)`;
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
  let totalProj = 0;
  let totalOwn = 0;
  let ownUnknown = false;
  for (const s of state.slots) {
    if (!s) continue;
    const row = rowById.get(String(s.id));
    if (!row) continue; // not on this slate; validateAgainstBoard drops these on the next board load
    salaryUsed += row.salary ?? 0;
    totalProj += row.proj ?? 0;
    if (row.own == null) ownUnknown = true;
    else totalOwn += row.own;
  }
  return { salaryUsed, salaryLeft: SALARY_CAP - salaryUsed, totalProj, totalOwn: ownUnknown ? null : totalOwn };
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

/** Saves whatever is currently placed. The server looks each player up on the current board itself and
 *  fills the rest of the snapshot, so only {slot, playerId} is sent per filled slot. An incomplete or
 *  over-cap lineup is allowed and saved as-is; only a wholly empty one is refused (client-side, before a
 *  request is even made, since the server would reject it too). */
async function doSaveLineup(name) {
  if (state.saving) return;
  const slotsPayload = state.slots
    .map((s, i) => (s ? { slot: LINEUP_SLOTS[i], playerId: String(s.id) } : null))
    .filter(Boolean);
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
  try {
    const data = await postLineup({ name, slots: slotsPayload });
    if (!data || data.ok === false) {
      state.saveError = data?.error?.message ?? "Could not save the lineup.";
    } else {
      state.savedLineups = Array.isArray(data.lineups) ? data.lineups : state.savedLineups;
      state.saveName = "";
      state.saveConfirm = `Saved "${data.lineup?.name ?? ""}".`;
    }
  } catch (e) {
    state.saveError = `Could not reach the server: ${e.message}`;
  }
  state.saving = false;
  commit();
}

async function doRenameLineup(id, name) {
  state.renamingId = null;
  commit();
  try {
    const data = await putLineupName(id, name);
    if (data && data.ok !== false && Array.isArray(data.lineups)) state.savedLineups = data.lineups;
  } catch (e) {
    // Best-effort: nothing destructive happened, the list just won't reflect the rename until reloaded.
  }
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
  state.addError = null;
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
    ${renderEntriesSection(state.savedLineups, board?.slates ?? [], entriesWeekKey(board))}`;
}

function controlsHtml() {
  const hasAnySlot = state.slots.some(Boolean);
  return `
    <div class="lineup-controls">
      <button type="button" id="lineup-clear-all-btn" class="lineup-clear-all-btn">Clear all</button>
      <label class="lineup-control">Save as
        <input type="text" id="lineup-save-name" class="lineup-save-name-input" placeholder="Name (optional)" value="${escapeHtml(state.saveName)}" />
      </label>
      <button type="button" id="lineup-save-btn" class="lineup-build-btn"${!hasAnySlot || state.saving ? " disabled" : ""}>${state.saving ? "Saving…" : "Save lineup"}</button>
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
        <span class="lineup-slot-detail">${money(row.salary)} &middot; ${projText} proj${escapeHtml(ownParen(row.own))}${roleTagsHtml(tags)}</span>
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
  let totalProj = 0;
  let totalOwn = 0;
  let ownPublished = 0;
  const slotEntries = placed.map((entry) => {
    if (!entry) return null;
    filled++;
    const snap = (lineup.slots ?? []).find((s) => String(s.playerId) === entry.id) ?? null;
    const row = rowById.get(entry.id) ?? null;
    if (row) {
      salaryUsed += row.salary ?? 0;
      totalProj += row.proj ?? 0;
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
  return { slotEntries, filled, salaryUsed, totalProj, totalOwn, ownPublished };
}

/** `pick` ({isChosen(id)}, see pickOptions) turns the player's name into the "only lineups with" button. */
function savedLineupSlotHtml(slotName, entry, pick = null) {
  if (!entry) {
    return `<div class="saved-lineup-slot saved-lineup-slot-empty"><span class="saved-lineup-slot-pos">${escapeHtml(slotName)}</span><span class="saved-lineup-slot-empty-text">Empty</span></div>`;
  }
  const src = entry.row ?? entry.snap;
  if (!src) return "";
  const missingCls = entry.row ? "" : " saved-lineup-slot-missing";
  const noteHtml = entry.row ? "" : `<span class="saved-lineup-slot-note">not on slate</span>`;
  const pickId = entry.row?.id ?? entry.snap?.playerId;
  const nameHtml = pick && pickId != null ? pickButtonHtml({ id: pickId, name: src.name ?? "", chosen: pick.isChosen(pickId) }) : escapeHtml(src.name ?? "");
  return `
    <div class="saved-lineup-slot${missingCls}">
      <span class="saved-lineup-slot-pos">${escapeHtml(slotName)}</span>
      <span class="saved-lineup-slot-name">${nameHtml}</span>${entry.row ? lineupOutTagHtml(entry.row) : ""}
      <span class="saved-lineup-slot-team">${escapeHtml(src.team ?? "")}</span>
      <span class="saved-lineup-slot-salary">${money(src.salary)}</span>
      ${noteHtml}
    </div>`;
}

function savedLineupCardHtml(lineup, rowById, pick = null) {
  const totals = computeLiveTotals(lineup, rowById);
  const overCap = totals.salaryUsed > SALARY_CAP;
  const incomplete = totals.filled < LINEUP_SLOTS.length;
  const isRenaming = state.renamingId === lineup.id;
  const isConfirmingDelete = state.deleteConfirmId === lineup.id;

  const badges = [
    incomplete ? `<span class="saved-lineup-badge saved-lineup-badge-warning">Incomplete</span>` : "",
    overCap ? `<span class="saved-lineup-badge saved-lineup-badge-danger">Over cap</span>` : "",
  ].join("");

  const nameHtml = isRenaming
    ? `<span class="saved-lineup-rename">
        <input type="text" class="saved-lineup-rename-input" data-rename-input value="${escapeHtml(lineup.name)}" />
        <button type="button" class="saved-lineup-mini-btn" data-action="lineup-rename-save" data-id="${escapeHtml(lineup.id)}">Save</button>
        <button type="button" class="saved-lineup-mini-btn" data-action="lineup-rename-cancel">Cancel</button>
      </span>`
    : `<button type="button" class="saved-lineup-name-btn" data-action="lineup-rename-start" data-id="${escapeHtml(lineup.id)}" title="Click to rename">${escapeHtml(lineup.name)}</button>`;

  const rowsHtml = totals.slotEntries.map((entry, i) => savedLineupSlotHtml(LINEUP_SLOTS[i], entry, pick)).join("");

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
        ${nameHtml}
        <span class="saved-lineup-time">${escapeHtml(formatSavedAt(lineup.savedAt))}</span>
        ${badges}
      </div>
      <div class="saved-lineup-slots">${rowsHtml}</div>
      <div class="saved-lineup-totals">
        <span class="${overCap ? "saved-lineup-totals-over" : ""}">${salaryText}</span>
        <span>&middot; ${dec1(totals.totalProj)} proj</span>
        <span>&middot; ${escapeHtml(ownText)}</span>
      </div>
      <div class="saved-lineup-actions">
        <button type="button" class="saved-lineup-btn" data-action="lineup-load" data-id="${escapeHtml(lineup.id)}">Load</button>
        ${deleteHtml}
      </div>
    </div>`;
}

/** The Saved lineups tab (D74): this slate's saved cards (Load, rename, Delete as before; on the site the D69
 *  device- ids work the same way), then the exposure tables over those saved lineups only. */
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
    body = `<div class="saved-lineups-empty">No saved lineups for this slate yet.</div>`;
  } else {
    // Adam 2026-10-11: only the saved lineups holding every chosen player show, and the exposure counts those only.
    const pick = pickOptions(rowById);
    const n = savedHere.length;
    const shown = filterLineups(savedHere, opt.mustHave, (l) => savedLineupPlayers(l, rowById));
    const k = shown.length;
    shownCount = k;
    if (k === 0) {
      body = `<div class="saved-lineups-empty">${NO_MATCH_TEXT}</div>`;
    } else {
      body = `<div class="saved-lineups-list">${shown.map((e) => savedLineupCardHtml(e.item, rowById, pick)).join("")}</div>`;
      const subtitle = opt.mustHave.length ? `${k} of ${n} saved lineup${n === 1 ? "" : "s"}, filtered` : `${n} saved lineup${n === 1 ? "" : "s"}`;
      lastExposure = { exposure: exposureOfLineups(shown.map((e) => savedLineupPlayers(e.item, rowById))), subtitle };
      exposureHtml = optExposureHtml(lastExposure.exposure, lastExposure.subtitle, opt.expSortDir, pick);
    }
  }
  return `
    <div class="saved-lineups" id="saved-lineups">
      ${mustHaveBarHtml(shownCount, savedHere.length)}
      ${body}
      ${exposureHtml}
    </div>`;
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
  const { pos, showAllPlayers } = store.get().filters;
  return `<div class="chip-group lineup-pos-chips">${posChipsHtml(pos, `data-action="pool-pos"`)}${showAllToggleHtml(showAllPlayers, `data-action="show-all"`)}</div>`;
}

export function rightColumnHtml(rows, rowById) {
  const { filters, sort } = store.get();
  // The classic projection floor (D52) applies to this pool like every other classic list, with one exception:
  // a player already locked or excluded stays listed so his lock or exclude can still be undone here.
  // D33: Value colours as on Rankings, FLEX included.
  const graded = rowsGradedForView(rows, filters.pos, store.get().board?.rows ?? rows);
  const filtered = filterRows(graded, { ...filters, showAllPlayers: true }).filter(
    (row) => passesProjFloor(row, filters) || state.locks.has(String(row.id)) || state.excludes.has(String(row.id))
  );
  const sorted = sortRows(filtered, sort.col, sort.dir);
  const placed = placedIdentities(rowById);
  // The Status column is usually empty; when nothing in the current pool carries a status it's dropped
  // entirely so the auto-layout table hands that width to Player instead of holding a blank labelled
  // column open (👁 visual-qa fourth pass).
  const hasStatus = sorted.some(rowHasStatus);
  // Headers sort through the same store sort the Rankings table uses (sort.col / sort.dir; keys player, pos,
  // salary, proj, own, status are the ones state.js sortRows reads); the shared sortableHeadHtml draws them.
  // Max % (Adam 2026-10-11: "a max % field per player ... between own % and value") is a plain header, not sortable.
  const headBefore = [
    { key: "player", label: "Player" },
    { key: "pos", label: "Pos" },
    { key: "salary", label: "Salary" },
    { key: "proj", label: "Proj" },
    { key: "own", label: "Own%" },
  ];
  const headAfter = [{ key: "value", label: "Value" }, ...(hasStatus ? [{ key: "status", label: "Status" }] : [])];
  const inner = (cols) => sortableHeadHtml(cols, sort).replace(/^<tr>|<\/tr>$/g, "");
  const maxHead = `<th class="lineup-max-head" title="Most of the new lineups this player may be in; blank = no cap">Max %</th>`;
  const headHtml = `<tr>${inner(headBefore)}${maxHead}${inner(headAfter)}<th></th></tr>`;
  const maxMap = playerMaxFor(slateKeyOf(store.get().board));
  const bodyRows = sorted.map((row) => rightRowHtml(row, placed, hasStatus, maxMap)).join("");
  return `
    <div class="lineup-rows-wrap scroll-panel">
      <table class="lineup-rows-table">
        <thead>${headHtml}</thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <div class="table-legend">&mdash; = nobody has published one</div>`;
}

function rightRowHtml(row, placedSet, hasStatus, maxMap = {}) {
  const id = String(row.id);
  const maxText = maxMap[id] ?? "";
  const maxBad = Number.isNaN(parsePct(maxText));
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
  return `
    <tr class="lineup-row${rowClass}" data-id="${escapeHtml(id)}">
      <td>
        <span class="player-cell">
          <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(row.team ?? "")}</span>
          <span class="player-name">${escapeHtml(row.name)}</span>${lineupOutTagHtml(row)}
        </span>
      </td>
      <td>${escapeHtml(row.pos ?? "")}</td>
      <td>${money(row.salary)}</td>
      <td>${row.proj == null ? "no proj" : dec1(row.proj)}</td>
      <td>${row.own == null ? "—" : `${dec1(row.own)}%`}</td>
      <td class="lineup-max-cell"><input type="text" inputmode="decimal" maxlength="5" class="opt-input lineup-max-input${maxBad ? " invalid" : ""}" data-player-max="${escapeHtml(id)}" value="${escapeHtml(maxText)}" aria-label="Max % for ${escapeHtml(row.name ?? "")}" /></td>
      <td>${gradedCellHtml(row.value, row.valueGrade)}</td>
      ${hasStatus ? `<td class="status-cell">${lineupOutTagHtml(row) ? "" : statusTagsHtml(row)}</td>` : ""}
      <td class="lineup-row-actions">
        <button type="button" class="lineup-row-btn${locked ? " active" : ""}" data-action="row-lock" data-id="${escapeHtml(id)}"${excluded ? " disabled" : ""}>${locked ? "Locked" : "Lock"}</button>
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
      commit();
    });
  });

  container.querySelectorAll("[data-action='row-lock']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      // DECISIONS.md D70: pool Lock = in the base lineup, unlock = out of it. Unlock clears his slot too (a pool-only
      // lock from older saved state has no slot and just loses the lock). Lock places him like Add does (which also
      // adds the lock); already placed (under this id, or the same DraftKings player under another id): lock that
      // placed copy. Excluded or refused: nothing locks, and addPlayer's state.addError sentence shows.
      if (state.locks.has(id)) {
        state.locks.delete(id);
        for (let i = 0; i < state.slots.length; i++) {
          if (state.slots[i] && String(state.slots[i].id) === id) state.slots[i] = null;
        }
        state.addError = null;
      } else if (!state.excludes.has(id)) {
        const rowById = new Map((store.get().board?.rows ?? []).map((r) => [String(r.id), r]));
        const row = rowById.get(id);
        if (row) {
          state.addError = null;
          const identity = dkIdentity(row);
          const placedSlot = state.slots.find((s) => {
            const placedRow = s ? rowById.get(String(s.id)) : null;
            return placedRow && dkIdentity(placedRow) === identity;
          });
          if (placedSlot) state.locks.add(String(placedSlot.id));
          else addPlayer(row, rowById);
        }
      }
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
      addPlayer(row, rowById);
      commit();
    });
  });

  // Save lineup: the name box is read here, at click time, rather than tracked in state on every
  // keystroke — that would re-render the whole panel on every character and steal the input's focus.
  container.querySelector("#lineup-save-btn")?.addEventListener("click", () => {
    const nameInput = container.querySelector("#lineup-save-name");
    doSaveLineup(nameInput ? nameInput.value : "");
  });

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
  wireEntries(container, {
    weekKey: entriesWeekKey(store.get().board),
    getSaved: () => state.savedLineups,
    getSlates: () => store.get().board?.slates ?? [],
  });
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

/** The five D55 rules, in the server's rule keys (server/lineup/multi.js RULE_KEYS), with Adam's chip words. The QB
 *  stack is the band's "Stack QB with" controls instead (D73). */
export const OPT_RULES = [
  { key: "starredQbOnly", label: "starred QBs only" },
  { key: "rbWithOwnQbOnlyIfCatcher", label: "RB with QB: catchers only" },
  { key: "noSameTeamRbs", label: "no same-team RBs" },
  { key: "noSameGameRbs", label: "no same-game RBs" },
  { key: "noDstVsOwnPlayers", label: "no DST vs own players" },
];

export const RULES_STACKING = ["rbWithOwnQbOnlyIfCatcher"];
export const RULES_ROSTER = ["starredQbOnly", "noSameTeamRbs", "noSameGameRbs", "noDstVsOwnPlayers"];

const opt = {
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
 *  (server/lineup/generate-request.js), repeated because the browser app cannot import server files. */
export function savedForSlate(saved, slateKey, slateIds) {
  const key = slateKey || "main";
  return (Array.isArray(saved) ? saved : [])
    .filter((l) => Array.isArray(l?.slots) && l.slots.length > 0)
    .filter((l) => (typeof l.slate === "string" && l.slate !== "" ? l.slate === key : key === "main" || l.slots.every((s) => slateIds.has(String(s.playerId)))));
}

/** A saved name that is unique on this slate: `wanted` when no name in `taken` equals it, else the lowest free
 *  "Lineup N" (N from 1). Names compare exactly, as the server's own "Lineup N" numbering does. */
export function uniqueSavedName(wanted, taken) {
  const used = new Set((taken ?? []).map(String));
  if (!used.has(wanted)) return wanted;
  let n = 1;
  while (used.has(`Lineup ${n}`)) n++;
  return `Lineup ${n}`;
}

/** The active slate's key: "main", or the second slate's key (D57). */
function slateKeyOf(board) {
  return activeSlate(board)?.key ?? "main";
}

/** The pool's Max % boxes for one slate, {id: text}. */
function playerMaxFor(slateKey) {
  return opt.playerMax[slateKey] ?? {};
}

/** Persisted Max % boxes, kept only as {slateKey: {id: text}} with string text; anything else is dropped. */
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
    count: parseWhole(form.count, 1, OPT_MAX_COUNT, OPT_DEFAULT_COUNT),
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
  if (form.qbStacks && Object.keys(form.qbStacks).length) settings.qbStacks = form.qbStacks;
  if (form.spreadDst === true) settings.spreadDst = true;
  return settings;
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
  const proj = lineup?.proj ?? players.reduce((s, p) => s + (p.proj ?? 0), 0);
  const allOwn = players.length > 0 && players.every((p) => p.own != null);
  return { salary, proj, own: allOwn ? players.reduce((s, p) => s + p.own, 0) : null };
}

export function ruleRowsHtml(rules, keys = OPT_RULES.map((r) => r.key)) {
  return OPT_RULES.filter((r) => keys.includes(r.key))
    .map((r) => settingRowHtml(r.label, switchButtonHtml(rules?.[r.key] !== false, r.label, `data-action="opt-rule" data-key="${escapeHtml(r.key)}"`)))
    .join("");
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
export function optLineupCardHtml(lineup, index, busy, { saved = false, fresh = null, pick = null, rowById = null } = {}) {
  const totals = lineupTotalsOf(lineup);
  const overCap = totals.salary > SALARY_CAP;
  const decor = cardDecor(lineup, rowById);
  const rows = (lineup.players ?? []).map((p, i) => cardPlayerRowHtml(p, LINEUP_SLOTS[i] ?? p.pos ?? "", Boolean(fresh?.has(String(p.id))), pick, decor)).join("");
  const ownText = totals.own == null ? "" : ` &middot; ${Math.round(totals.own)}% own`;
  // TwoGun mode: the lineup's total of TwoGun's ceilings, as the server summed it (absent in current mode; a dash
  // when a player has none, never a partial sum).
  const ceilText = lineup.ceil === undefined ? "" : ` &middot; ${lineup.ceil == null ? `<span title="A player in this lineup has no TwoGun ceiling">—</span>` : dec1(lineup.ceil)} ceil`;
  const uid = escapeHtml(lineup.uid ?? "");
  const saveBtn = saved
    ? `<button type="button" class="saved-lineup-btn opt-saved-btn" disabled>Saved ✓</button>`
    : `<button type="button" class="saved-lineup-btn" data-action="opt-save" data-uid="${uid}"${busy ? " disabled" : ""}>Save</button>`;
  return `
    <div class="opt-card${saved ? " opt-card-saved" : ""}" data-uid="${uid}">
      <div class="opt-card-head">
        <span class="opt-card-title">Lineup ${index + 1}</span>${decor.stack}
        <span class="opt-card-actions">
          ${saveBtn}
          <button type="button" class="saved-lineup-btn danger" data-action="opt-discard" data-uid="${uid}"${busy ? " disabled" : ""}>Discard</button>
        </span>
      </div>
      <div class="opt-card-players">${rows}</div>
      <div class="opt-card-totals"><span class="${overCap ? "saved-lineup-totals-over" : ""}">${money(totals.salary)}</span> &middot; ${dec1(totals.proj) ?? "—"} proj${ceilText}${ownText}</div>
    </div>`;
}

export function optNotesHtml(notes) {
  return (notes ?? []).map((n) => `<div class="opt-note">${escapeHtml(n)}</div>`).join("");
}

// ---- Rendering inside the panel ----

function lockedNames(rowById) {
  return lockedIds(state.slots, state.locks)
    .map((id) => rowById.get(id))
    .filter(Boolean);
}

function optimizerControlsHtml(rowById) {
  const board = store.get().board;
  const locked = lockedNames(rowById);
  const games = activeSlateGames(board);
  const info = locked.length
    ? `<span class="opt-lockinfo">${locked.length} locked: ${escapeHtml(locked.map((r) => r.name).join(", "))}</span>`
    : `<span class="opt-warn">Nothing locked: these will be plain optimal lineups, rarely right for tournaments.</span>`;
  const expRows = OPT_POSITIONS.map((pos) =>
    settingRowHtml(pos, numberBoxHtml(`type="text" inputmode="decimal" class="opt-input opt-input-pct" data-opt-exp="${pos}" value="${escapeHtml(opt.maxExp[pos])}" placeholder="no cap" aria-label="${pos} maximum exposure percent"`, "%"))
  ).join("") + settingRowHtml("Spread defenses", switchButtonHtml(opt.spreadDst, "Spread defenses", `data-action="opt-spread-dst"`), SPREAD_HINT);
  const lockedList = lockedIds(state.slots, state.locks);
  const qbRows = listedQbs(activeSlateRows(board), lockedList);
  const avoidGroup = games.length ? settingGroupHtml("Avoid game", `<div class="opt-chips">${avoidChipsHtml(games, opt.avoid)}</div>`, "", "opt-group-wide") : "";
  const formError = opt.formError ? `<div class="lineup-status lineup-status-error opt-form-error">${escapeHtml(opt.formError)}</div>` : "";
  const busy = opt.generating || opt.saving;
  const options = (values, current, label = (v) => String(v)) =>
    values.map((v) => `<option value="${escapeHtml(String(v))}"${String(current) === String(v) ? " selected" : ""}>${escapeHtml(label(v))}</option>`).join("");
  const upTo = (max) => Array.from({ length: max + 1 }, (_, i) => i);
  const select = (id, label, values, current, text) => `<select id="${id}" class="opt-input opt-select-n" aria-label="${label}">${options(values, current, text)}</select>`;
  const build = [
    settingRowHtml("Lineups to make", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_COUNT}" class="opt-input opt-input-num" id="opt-count" value="${escapeHtml(opt.count)}" aria-label="How many lineups"`), "From the slots you have locked"),
    settingRowHtml("Min unique players", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_UNIQUE}" class="opt-input opt-input-num" id="opt-min-unique" value="${escapeHtml(opt.minUnique)}" aria-label="Minimum unique players between lineups"`), "Between any two lineups"),
    settingRowHtml("Build by", `<span class="opt-chips">${objectiveChipsHtml(opt.objective, boardHasCeilings(activeSlateRows(board)))}</span>`),
  ].join("");
  const stacking = [
    settingRowHtml("Teammates", `${select("opt-stack-own", "Teammates to stack with the quarterback", upTo(OPT_STACK_OWN_MAX), opt.stackOwn)}${switchCheckboxHtml("opt-stack-own-more", opt.stackOwnOrMore, "or more", "exactly")}`),
    settingRowHtml("Opponents", `${select("opt-stack-opp", "Opponents to stack with the quarterback", upTo(OPT_STACK_OPP_MAX), opt.stackOpp)}${switchCheckboxHtml("opt-stack-opp-more", opt.stackOppOrMore, "or more", "exactly")}`),
    ruleRowsHtml(opt.rules, RULES_STACKING),
    qbListHtml(qbRows, opt.qb, lockedList),
  ].join("");
  const roster = [
    ruleRowsHtml(opt.rules, RULES_ROSTER),
    settingRowHtml("Max per team", `<select id="opt-max-team" class="opt-input opt-select" aria-label="Max per team">${options(MAX_TEAM_OPTIONS, opt.maxPerTeam, (v) => (v === "" ? "No limit" : v))}</select>`, "Not applied to the QB's team or his opponent"),
  ].join("");
  return `
    <div class="opt-panel opt-settings" id="opt-panel">
      <div class="opt-settings-head">
        <h3 class="opt-title">Optimizer</h3>
        ${info}
        ${opt.error ? `<span class="lineup-status-error opt-go-error">${escapeHtml(opt.error)}</span>` : ""}
        <button type="button" id="opt-go-btn" class="lineup-build-btn opt-go"${busy ? " disabled" : ""}>${opt.generating ? "Making…" : "Go"}</button>
      </div>
      ${formError}
      <div class="opt-groups">
        ${settingGroupHtml("Build", build)}
        ${settingGroupHtml("Stacking with the QB", stacking)}
        ${settingGroupHtml("Exposure", expRows, "Max share of lineups; blank = no cap")}
        ${settingGroupHtml("Roster rules", roster)}
        ${qbPanelsHtml(qbRows, opt.qb, qbGlobals(), activeSlateRows(board), OPT_STACK_OWN_MAX, lockedList)}
        ${avoidGroup}
      </div>
    </div>`;
}

/** The saved lineups of the slate on screen (D57 slate key, savedForSlate). */
function savedOfActiveSlate() {
  const board = store.get().board;
  const slateIds = new Set(activeSlateRows(board).map((r) => String(r.id)));
  return savedForSlate(state.savedLineups, slateKeyOf(board), slateIds);
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
    parts.push(`<div class="saved-lineups-empty">${opt.generating ? "Making lineups…" : "No new lineups. Press Go to make some."}</div>`);
    lastExposure = { exposure: {}, subtitle: "" };
    return parts.join("");
  }
  const n = r.lineups.length;
  const busy = opt.saving || opt.generating;
  const savedKeys = savedSetKeys(savedHere, rowById);
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
           <span class="opt-sub">${n} lineup${n === 1 ? "" : "s"} from the last Go${r.builtIn ? ` (${escapeHtml(r.builtIn)})` : ""}${nSaved ? `, ${nSaved} saved` : ", not saved yet"}</span>
           <span class="opt-card-actions">
             <button type="button" class="saved-lineup-btn" data-action="opt-save-all"${busy || allSaved || noneShown ? " disabled" : ""}>${bulkLabel("Save", nShownUnsaved, filtered)}</button>
             <button type="button" class="saved-lineup-btn danger" data-action="opt-discard-all"${busy || noneShown ? " disabled" : ""}>${bulkLabel("Discard", nShown, filtered)}</button>
           </span>
         </div>`
      : `<div class="opt-sub">None left from the last Go.</div>`
  );
  if (opt.saveError) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(opt.saveError)}</div>`);
  parts.push(optNotesHtml(r.notes));
  if (n && !shown.length) {
    parts.push(`<div class="saved-lineups-empty">${NO_MATCH_TEXT}</div>`);
    lastExposure = { exposure: {}, subtitle: "" };
  } else if (n) {
    // The new-player highlight compares a card with the previous card SHOWN.
    const fresh = newPlayerIds(shown.map((e) => e.item), rowById);
    parts.push(`<div class="opt-cards">${shown.map((e, k) => optLineupCardHtml(e.item, e.index, busy, { saved: savedFlags[e.index], fresh: fresh[k], pick, rowById })).join("")}</div>`);
    const players = shown.map((e) => (e.item.players ?? []).map((p) => ({ ...p, identity: identityOf(p.id, rowById) })));
    const k = shown.length;
    const subtitle = opt.mustHave.length ? `${k} of ${n} new lineup${n === 1 ? "" : "s"}, filtered` : `${n} new lineup${n === 1 ? "" : "s"}`;
    lastExposure = { exposure: exposureOfLineups(players), subtitle };
    parts.push(optExposureHtml(lastExposure.exposure, lastExposure.subtitle, opt.expSortDir, pick));
  } else {
    lastExposure = { exposure: {}, subtitle: "" };
  }
  return parts.join("");
}

// ---- Actions ----

async function doGenerate() {
  if (opt.generating || opt.saving) return;
  const board = store.get().board;
  const slate = activeSlate(board);
  const slateKey = slate ? slate.key : "main";
  const nameById = new Map((board?.rows ?? []).map((r) => [String(r.id), r.name]));
  // The per-player Max % boxes of this slate, for players still in its pool (D57).
  const slateRowIds = new Set(activeSlateRows(board).map((r) => String(r.id)));
  const playerMax = Object.fromEntries(Object.entries(playerMaxFor(slateKey)).filter(([id]) => slateRowIds.has(id)));
  opt.formError = exposureProblem(opt.maxExp) ?? playerMaxProblem(playerMax, (id) => nameById.get(id) ?? id);
  if (opt.formError) {
    commit();
    return;
  }
  // The week and the slate on screen when Go was pressed: a response that arrives after either changed belongs to
  // something no longer shown and is dropped.
  const madeForWeek = seasonWeekKey(board);
  const madeForSlate = store.get().activeSlateKey ?? null;
  let locks = lockedIds(state.slots, state.locks);
  const slateNotes = [];
  let avoid = [...opt.avoid];
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
  const form = {
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
    qbStacks: qbStacksForRequest(board, slateNotes),
    spreadDst: opt.spreadDst,
  };
  opt.generating = true;
  opt.error = null;
  opt.saveError = null;
  opt.resultsTab = "new"; // D74: a Go shows the New lineups tab
  commit();
  try {
    const data = await postLineupGenerate(buildGeneratePayload(form, slateKey));
    if (seasonWeekKey(store.get().board) !== madeForWeek || (store.get().activeSlateKey ?? null) !== madeForSlate) {
      opt.generating = false;
      commit();
      return;
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
      opt.results = { slateKey, lineups, notes, builtIn };
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
  for (const uid of uids) {
    const lineup = results.lineups.find((l) => l.uid === uid);
    if (!lineup || cardIsSaved(lineup, savedSetKeys(savedOfActiveSlate(), rowById), rowById)) continue;
    try {
      // The card's own name ("Lineup 2") is kept as the saved name unless this slate already has it (Entries picks
      // lineups by name, so names stay unique per slate).
      const taken = savedOfActiveSlate().map((l) => l.name);
      const name = uniqueSavedName(`Lineup ${results.lineups.indexOf(lineup) + 1}`, taken);
      const data = await postLineup({ name, slots: slotsForSave(lineup.players), slate: slateKey });
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
    holder.innerHTML = optExposureHtml(lastExposure.exposure, lastExposure.subtitle, opt.expSortDir, pickOptions(currentRowById()));
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
  const bind = (sel, key) => {
    const el = container.querySelector(sel);
    el?.addEventListener("input", () => {
      opt[key] = el.value;
    });
  };
  bind("#opt-count", "count");
  bind("#opt-min-unique", "minUnique");
  container.querySelectorAll("[data-opt-exp]").forEach((el) => {
    el.addEventListener("input", () => {
      opt.maxExp[el.dataset.optExp] = el.value;
      if (opt.formError) {
        opt.formError = null;
        container.querySelector(".opt-form-error")?.remove();
      }
    });
  });
  // Max per team and the D73 stack: the value is kept in `opt`; nothing else on the panel depends on it,
  // so no re-render.
  const bindValue = (sel, key, read) => {
    const el = container.querySelector(sel);
    el?.addEventListener("change", () => {
      opt[key] = read(el);
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
  if (settingsEl) wireQbStacks(settingsEl, { qbs: opt.qb, globals: qbGlobals, ownMax: OPT_STACK_OWN_MAX, commit, save: savePersisted });
  container.querySelectorAll("[data-action='opt-avoid']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = btn.dataset.game;
      if (opt.avoid.has(g)) opt.avoid.delete(g);
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
  container.querySelectorAll("[data-player-max]").forEach((el) => {
    el.addEventListener("input", () => {
      const key = slateKeyOf(store.get().board);
      const map = { ...playerMaxFor(key) };
      if (el.value.trim() === "") delete map[el.dataset.playerMax];
      else map[el.dataset.playerMax] = el.value;
      opt.playerMax = { ...opt.playerMax, [key]: map };
      el.classList.toggle("invalid", Number.isNaN(parsePct(el.value)));
      if (opt.formError) {
        opt.formError = null;
        container.querySelector(".opt-form-error")?.remove();
      }
      savePersisted();
    });
  });
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
