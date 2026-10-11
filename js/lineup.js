// Lineup Builder tab (PROJECT.md D21/D32, Part 4 Lineup Builder screen). Secondary tab, never the main
// page. Left column: the nine DraftKings classic slots (D1), a salary bar, totals, and the objective /
// max-per-team / stack-QB controls plus Build and Clear all. Right column: the same rows the Rankings
// tab is currently showing — same store, same filters, same sort — rendered read-only with per-row
// Lock, Exclude and Add-to-slot buttons.
//
// State (locks, excludes, the nine slots, and the option controls) lives in this module for the life of
// the page load, independent of the app-level store in state.js (this tab never edits Proj/Own, and
// nothing else on the page needs to know about a lock or an exclude). It is optionally mirrored to
// localStorage, wrapped in try/catch, so a reload doesn't lose an in-progress build; if storage is
// unavailable the tab still works, it just starts empty on the next load.
//
// A slot holds only `{id, slot}` — never a name/salary/proj/own snapshot — so every render reads those
// fields from whatever board.rows currently says for that id. That is what makes an override show up in
// a placed slot without this module doing anything, and it's why the persisted/build-result state is
// re-validated against the live board on every board load rather than trusted as-is (🔵 finding 1): an id
// with no row anymore (a stale localStorage entry, or last week's slate) is dropped instead of rendering
// stale data or throwing.
import { escapeHtml, money, dec1, textColourFor } from "./format.js";
import { store, filterRows, sortRows, passesProjFloor, FLEX_POS, activeSlate, activeSlateRows, activeSlateGames, slateDisplayName } from "./state.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { postLineupOptimize, postLineupGenerate, getLineups, postLineup, deleteLineup, putLineupName } from "./api.js";

const LINEUP_SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
const SALARY_CAP = 50000;
const OBJECTIVES = [
  { value: "proj", label: "Projection" },
  { value: "lev", label: "Leverage" },
  { value: "projMinusOwn", label: "Projection minus ownership" },
];
const MAX_TEAM_OPTIONS = ["", "1", "2", "3", "4"];
const STACK_QB_OPTIONS = [0, 1, 2];
const STORAGE_KEY = "nfldfs.lineupBuilder.v1";

// Mirrors table.js's status-badge/dimming rules exactly (🔵 finding 8: "as in the Rankings table") so the
// right column reads the same way the main table does. table.js doesn't export these (out of scope for
// this pass), so they're kept here as a small, deliberate duplicate rather than reached into.
const STATUS_INFO = {
  o: { label: "Out", cls: "status-out" },
  out: { label: "Out", cls: "status-out" },
  d: { label: "Doubtful", cls: "status-doubtful" },
  doubtful: { label: "Doubtful", cls: "status-doubtful" },
  q: { label: "Questionable", cls: "status-questionable" },
  questionable: { label: "Questionable", cls: "status-questionable" },
  ir: { label: "IR", cls: "status-ir" },
  suspended: { label: "Suspended", cls: "status-ir" },
};
const DIM_STATUS_TOKENS = new Set(["o", "out", "ir", "d", "doubtful"]);

const state = {
  slots: new Array(LINEUP_SLOTS.length).fill(null), // each: {id, slot} or null; row fields are read live
  locks: new Set(), // player ids (strings) that must appear in the next Build
  excludes: new Set(), // player ids (strings) that must never appear
  objective: "proj",
  maxFromTeam: "", // "" (no limit) or "1".."4", mirrors the <select> value
  stackQbWith: 0, // 0, 1 or 2
  lastResult: null, // {feasible, message, notes, salaryUsed, salaryLeft, totalProj, totalOwn, slotsSnapshot} or null
  building: false,
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

// D32: any list of players carries ownership as "(NN% own)", but only when the player has a real number
// (published, or typed in by Adam); a player without one prints nothing.
function ownParen(own) {
  return own == null ? "" : ` (${Math.round(own)}% own)`;
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
        objective: state.objective,
        maxFromTeam: state.maxFromTeam,
        stackQbWith: state.stackQbWith,
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
  // 🔵 finding 5: objective/maxFromTeam/stackQbWith are accepted only if they're in their option lists.
  if (typeof persisted.objective === "string" && OBJECTIVES.some((o) => o.value === persisted.objective)) {
    state.objective = persisted.objective;
  }
  if (typeof persisted.maxFromTeam === "string" && MAX_TEAM_OPTIONS.includes(persisted.maxFromTeam)) {
    state.maxFromTeam = persisted.maxFromTeam;
  }
  if (typeof persisted.stackQbWith === "number" && STACK_QB_OPTIONS.includes(persisted.stackQbWith)) {
    state.stackQbWith = persisted.stackQbWith;
  }
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
    opt.avoid.clear(); // avoid-game picks are games of that week
  }
  const rowById = new Map((board.rows ?? []).map((r) => [String(r.id), r]));
  for (const id of [...state.locks]) if (!rowById.has(id)) state.locks.delete(id);
  for (const id of [...state.excludes]) if (!rowById.has(id)) state.excludes.delete(id);
  state.slots = state.slots.map((s, i) => {
    if (!s) return null;
    if (!rowById.has(String(s.id))) return null; // no row on this board: drop it
    return { id: String(s.id), slot: LINEUP_SLOTS[i] }; // rebuilt fresh; nothing else is ever stored
  });
}

let lastContainer = null;

export function renderLineupPanel(container) {
  lastContainer = container;
  hydrateFromStorage();
  validateAgainstBoard(store.get().board);
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

// Mirrors app.js's adjustScrollPanels() sizing for this panel's own .scroll-panel element. app.js is out
// of scope for this pass and doesn't export that function; it also only runs after the app-level
// renderDynamic, which this module's own re-renders (Build, Lock, Add, Clear — all via commit(), below)
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

/** True when `snapshot` (a lastResult.slotsSnapshot) still describes exactly what's in state.slots now,
 *  id-for-id and slot-for-slot — used to decide whether the last Build's own totals are still valid. */
function currentSlotsMatchSnapshot(snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length !== state.slots.length) return false;
  for (let i = 0; i < state.slots.length; i++) {
    const a = state.slots[i];
    const b = snapshot[i];
    if (!a && !b) continue;
    if (!a || !b) return false;
    if (String(a.id) !== String(b.id)) return false;
  }
  return true;
}

// 🔵 finding 3: when the last Build is feasible and still matches what's placed, its own salaryUsed /
// salaryLeft / totalProj / totalOwn are shown as-is (they're exactly what the server computed). Otherwise
// the totals are read live off the current board rows, and a null own on any placed player makes the
// total unknown rather than silently smaller.
function computeTotals(rowById) {
  const r = state.lastResult;
  if (r && r.feasible && currentSlotsMatchSnapshot(r.slotsSnapshot)) {
    return {
      salaryUsed: r.salaryUsed ?? 0,
      salaryLeft: r.salaryLeft ?? SALARY_CAP,
      totalProj: r.totalProj ?? 0,
      totalOwn: r.totalOwn ?? null,
    };
  }
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
  const sidelined = DIM_STATUS_TOKENS.has(statusKey) || (row.flags ?? []).includes("injured");
  if (sidelined) {
    const label = STATUS_INFO[statusKey]?.label ?? row.status;
    reasons.push(`is listed ${label} and may not play`);
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
  state.lastResult = null;
  state.addError = addWarning(row);
}

/** Places `entries` ({slot, id}, in any order) into a fresh LINEUP_SLOTS-shaped array, each by its own
 *  `slot` name into the next free slot of that name (🔵 finding 7) — not by its position in the input
 *  array, which need not line up with LINEUP_SLOTS' order. An entry whose slot name has no free slot left
 *  is skipped rather than thrown. Shared by a Build response, Load, and the saved-lineup cards' own
 *  roster-order reconstruction, so all three place a saved/optimized list the same way. */
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
// Build
// --------------------------------------------------------------------------------------------------------

async function doBuild() {
  if (state.building) return;
  state.building = true;
  state.addError = null;
  commit();

  const payload = {
    locks: [...state.locks],
    excludes: [...state.excludes],
    objective: state.objective,
    maxFromTeam: state.maxFromTeam === "" ? null : Number(state.maxFromTeam),
    stackQbWith: state.stackQbWith,
  };
  // A second slate on screen (D57): the server builds from that slate's games only. Locks are per player and
  // are kept for the main slate, so a lock on a player who is not in this slate's games is left out of this
  // request (the server would refuse it) and said so in the result's notes rather than dropped silently.
  const board = store.get().board;
  const slate = activeSlate(board);
  let slateNote = null;
  if (slate) {
    payload.slate = slate.key;
    const inSlate = new Set(activeSlateRows(board).map((r) => String(r.id)));
    const kept = payload.locks.filter((id) => inSlate.has(String(id)));
    const leftOut = payload.locks.length - kept.length;
    payload.locks = kept;
    if (leftOut > 0) {
      slateNote = `${leftOut} locked player${leftOut === 1 ? " is" : "s are"} not in the ${slateDisplayName(slate)}'s games and ${leftOut === 1 ? "was" : "were"} left out of this build.`;
    }
  }

  try {
    const data = await postLineupOptimize(payload);
    // `notes` may be absent on the running server (PROJECT.md Part 4) — always treat a missing notes
    // array as [].
    const notes = Array.isArray(data?.notes) ? [...data.notes] : [];
    if (slateNote) notes.push(slateNote);
    if (!data || data.ok === false) {
      state.lastResult = { feasible: false, message: data?.error?.message ?? "Could not build a lineup.", notes };
    } else if (data.feasible) {
      // 🔵 finding 7: each entry is placed by its own `slot` name into the next free slot of that name,
      // not by its position in the response array (which need not line up with LINEUP_SLOTS' order).
      const lineup = Array.isArray(data.lineup) ? data.lineup : [];
      const nextSlots = placeBySlotName(lineup);
      state.slots = nextSlots;
      state.lastResult = {
        feasible: true,
        message: data.message ?? "",
        notes,
        salaryUsed: data.salaryUsed,
        salaryLeft: data.salaryLeft,
        totalProj: data.totalProj,
        totalOwn: data.totalOwn,
        slotsSnapshot: nextSlots.map((s) => (s ? { ...s } : null)),
      };
    } else {
      state.lastResult = {
        feasible: false,
        message: data.message ?? "No legal lineup fits these locks, exclusions and the salary cap.",
        notes,
      };
    }
  } catch (e) {
    state.lastResult = { feasible: false, message: `Could not reach the server: ${e.message}`, notes: [] };
  }
  state.building = false;
  commit();
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
      markExposureStale(); // the saved set changed, so the Optimizer's exposure lists are no longer current
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
    if (data && data.ok !== false && Array.isArray(data.lineups)) {
      state.savedLineups = data.lineups;
      markExposureStale();
    }
  } catch (e) {
    // Best-effort: nothing destructive happened locally, the list just won't reflect the delete until reloaded.
  }
  commit();
}

/** Puts a saved lineup's players back into the builder's slots, replacing whatever is there, via the same
 *  placeBySlotName() a Build response uses — so an off-slate player (dropped by validateAgainstBoard on
 *  the next render) and totals/locks behave exactly as they do after any other slot change. */
function doLoadLineup(id) {
  const lineup = state.savedLineups.find((l) => l.id === id);
  if (!lineup) return;
  state.slots = placeBySlotName((lineup.slots ?? []).map((s) => ({ slot: s.slot, id: s.playerId })));
  state.lastResult = null;
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
  const overCap = totals.salaryUsed > SALARY_CAP;
  const fillPct = Math.max(0, Math.min(100, (totals.salaryUsed / SALARY_CAP) * 100));
  const salaryText =
    totals.salaryLeft < 0 ? `${money(totals.salaryUsed)} used · ${money(-totals.salaryLeft)} over` : `${money(totals.salaryUsed)} used · ${money(totals.salaryLeft)} left`;
  // 🔵 finding 3: any placed player with a null own% makes the total unknown, not smaller.
  const ownText = totals.totalOwn == null ? "— (not every player has a published number)" : `${Math.round(totals.totalOwn)}% own`;

  return `
    <div class="lineup-layout">
      <div class="lineup-left">
        ${controlsHtml()}
        <div class="lineup-slots">${slotsHtml(rowById)}</div>
        <div class="salary-bar">
          <div class="salary-bar-track"><div class="salary-bar-fill${overCap ? " over" : ""}" style="width:${fillPct}%"></div></div>
          <span class="salary-bar-label${overCap ? " over" : ""}">${escapeHtml(salaryText)}</span>
        </div>
        <div class="lineup-totals">Total projection ${dec1(totals.totalProj)} &middot; Total ownership ${ownText}</div>
        ${buildStatusHtml()}
      </div>
      <div class="lineup-right">
        <h3 class="lineup-right-title">Rankings (current filters, read-only)</h3>
        ${rightColumnHtml(activeSlateRows(board), rowById)}
      </div>
    </div>
    ${optimizerControlsHtml(rowById)}
    ${optimizerResultsHtml(rowById)}
    ${savedLineupsSectionHtml(rowById)}`;
}

function controlsHtml() {
  const objectiveOptions = OBJECTIVES.map(
    (o) => `<option value="${o.value}"${state.objective === o.value ? " selected" : ""}>${escapeHtml(o.label)}</option>`
  ).join("");
  const maxTeamOptions = MAX_TEAM_OPTIONS
    .map((v) => `<option value="${v}"${state.maxFromTeam === v ? " selected" : ""}>${v === "" ? "No limit" : v}</option>`)
    .join("");
  const stackOptions = STACK_QB_OPTIONS
    .map((n) => `<option value="${n}"${state.stackQbWith === n ? " selected" : ""}>${n}</option>`)
    .join("");
  const hasAnySlot = state.slots.some(Boolean);
  return `
    <div class="lineup-controls">
      <label class="lineup-control">Objective
        <select id="lineup-objective">${objectiveOptions}</select>
      </label>
      <label class="lineup-control">Max per team
        <select id="lineup-max-team">${maxTeamOptions}</select>
      </label>
      <label class="lineup-control">Stack QB with
        <select id="lineup-stack-qb">${stackOptions}</select>
      </label>
      <button type="button" id="lineup-build-btn" class="lineup-build-btn"${state.building ? " disabled" : ""}>${state.building ? "Building…" : "Build"}</button>
      <button type="button" id="lineup-clear-all-btn" class="lineup-clear-all-btn">Clear all</button>
      <label class="lineup-control">Save as
        <input type="text" id="lineup-save-name" class="lineup-save-name-input" placeholder="Name (optional)" value="${escapeHtml(state.saveName)}" />
      </label>
      <button type="button" id="lineup-save-btn" class="lineup-build-btn"${!hasAnySlot || state.saving ? " disabled" : ""}>${state.saving ? "Saving…" : "Save lineup"}</button>
    </div>`;
}

function slotsHtml(rowById) {
  return LINEUP_SLOTS.map((slotName, i) => {
    const s = state.slots[i];
    const row = s ? rowById.get(String(s.id)) : null;
    const locked = s ? state.locks.has(String(s.id)) : false;
    // 🔵 finding 2: a slot whose id no longer has a row (should already have been dropped by
    // validateAgainstBoard, but this is the defensive last line) shows a visible marker instead of
    // guessing at stale name/salary/proj/own.
    const bodyHtml = !s
      ? `<span class="lineup-slot-player lineup-slot-empty">Empty</span>`
      : row
        ? slotPlayerHtml(row)
        : `<span class="lineup-slot-player lineup-slot-missing">Not on this slate</span>`;
    return `
      <div class="lineup-slot" data-slot-index="${i}">
        <span class="lineup-slot-label">${escapeHtml(slotName)}</span>
        ${bodyHtml}
        <button type="button" class="lineup-slot-lock${locked ? " active" : ""}" data-action="slot-lock" data-slot="${i}"${s ? "" : " disabled"}>${locked ? "Locked" : "Lock"}</button>
        <button type="button" class="lineup-slot-clear" data-action="slot-clear" data-slot="${i}"${s ? "" : " disabled"}>Clear</button>
      </div>`;
  }).join("");
}

// `row` is the live board row for this slot's id (🔵 finding 2), never a cached copy: an override on
// Proj or Own shows up here automatically because this reads the same fields the Rankings table does.
function slotPlayerHtml(row) {
  const t = TEAM_BY_ABBR[row.team];
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  const textColour = textColourFor(primary, secondary);
  const projText = row.proj == null ? "no proj" : dec1(row.proj);
  return `
    <span class="lineup-slot-player lineup-slot-player-2">
      <span class="lineup-slot-top">
        <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(row.team ?? "")}</span>
        <span class="lineup-slot-name">${escapeHtml(row.name)}</span>
        <span class="lineup-slot-matchup">${escapeHtml(matchupOf(row))}</span>
      </span>
      <span class="lineup-slot-detail">${money(row.salary)} &middot; ${projText} proj${escapeHtml(ownParen(row.own))}</span>
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
  const r = state.lastResult;
  if (r) {
    if (!r.feasible) {
      parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(r.message || "No legal lineup could be built.")}</div>`);
    } else if (r.message) {
      parts.push(`<div class="lineup-status">${escapeHtml(r.message)}</div>`);
    }
    for (const n of r.notes ?? []) {
      parts.push(`<div class="lineup-note">${escapeHtml(n)}</div>`);
    }
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

function savedLineupSlotHtml(slotName, entry) {
  if (!entry) {
    return `<div class="saved-lineup-slot saved-lineup-slot-empty"><span class="saved-lineup-slot-pos">${escapeHtml(slotName)}</span><span class="saved-lineup-slot-empty-text">Empty</span></div>`;
  }
  const src = entry.row ?? entry.snap;
  if (!src) return "";
  const missingCls = entry.row ? "" : " saved-lineup-slot-missing";
  const noteHtml = entry.row ? "" : `<span class="saved-lineup-slot-note">not on slate</span>`;
  return `
    <div class="saved-lineup-slot${missingCls}">
      <span class="saved-lineup-slot-pos">${escapeHtml(slotName)}</span>
      <span class="saved-lineup-slot-name">${escapeHtml(src.name ?? "")}</span>
      <span class="saved-lineup-slot-team">${escapeHtml(src.team ?? "")}</span>
      <span class="saved-lineup-slot-salary">${money(src.salary)}</span>
      ${noteHtml}
    </div>`;
}

function savedLineupCardHtml(lineup, rowById) {
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

  const rowsHtml = totals.slotEntries.map((entry, i) => savedLineupSlotHtml(LINEUP_SLOTS[i], entry)).join("");

  const salaryLeft = SALARY_CAP - totals.salaryUsed;
  const salaryText = overCap
    ? `${money(totals.salaryUsed)} used &middot; ${money(-salaryLeft)} over`
    : `${money(totals.salaryUsed)} used &middot; ${money(salaryLeft)} left`;
  // Same rule as the builder panel above (🔵 finding 3 / D29): the app never estimates ownership, so a
  // total is only printed when every filled slot has a published number; otherwise it's an em dash.
  const ownText =
    totals.ownPublished === totals.filled
      ? `${Math.round(totals.totalOwn)}% own (${totals.ownPublished} of ${totals.filled} published)`
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

function savedLineupsSectionHtml(rowById) {
  let body;
  if (!state.savedLoaded) {
    // A distinct class from saved-lineups-empty (below): a QA screenshot script waits for the real
    // empty/loaded state and must never mistake "still loading" for "confirmed empty".
    body = `<div class="saved-lineups-loading">Loading…</div>`;
  } else if (state.savedError) {
    // 🔵 finding: a failed GET (e.g. LINEUPS_UNREADABLE) must say so, not render as a false "no saved
    // lineups yet" — that would read as "you have none" when the real answer is "couldn't check".
    body = `<div class="saved-lineups-empty saved-lineups-error">${escapeHtml(state.savedError)}</div>`;
  } else if (state.savedLineups.length === 0) {
    body = `<div class="saved-lineups-empty">No saved lineups yet.</div>`;
  } else {
    body = `<div class="saved-lineups-list">${state.savedLineups.map((l) => savedLineupCardHtml(l, rowById)).join("")}</div>`;
  }
  return `
    <div class="saved-lineups" id="saved-lineups">
      <h3 class="saved-lineups-title">Saved lineups</h3>
      ${body}
    </div>`;
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

function rightColumnHtml(rows, rowById) {
  const { filters, sort } = store.get();
  // The classic projection floor (D52) applies to this pool like every other classic list, with one exception:
  // a player already locked or excluded stays listed so his lock or exclude can still be undone here.
  const filtered = filterRows(rows, { ...filters, showAllPlayers: true }).filter(
    (row) => passesProjFloor(row, filters) || state.locks.has(String(row.id)) || state.excludes.has(String(row.id))
  );
  const sorted = sortRows(filtered, sort.col, sort.dir);
  const placed = placedIdentities(rowById);
  // The Status column is usually empty; when nothing in the current pool carries a status it's dropped
  // entirely so the auto-layout table hands that width to Player instead of holding a blank labelled
  // column open (👁 visual-qa fourth pass).
  const hasStatus = sorted.some((row) => (row.status ?? "").trim());
  const statusHeadHtml = hasStatus ? "<th>Status</th>" : "";
  const bodyRows = sorted.map((row) => rightRowHtml(row, placed, hasStatus)).join("");
  return `
    <div class="lineup-rows-wrap scroll-panel">
      <table class="lineup-rows-table">
        <thead><tr><th>Player</th><th>Pos</th><th>Salary</th><th>Proj</th><th>Own%</th>${statusHeadHtml}<th></th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <div class="table-legend">&mdash; = nobody has published one</div>`;
}

// Mirrors table.js's statusCellHtml badge (🔵 finding 8).
function statusBadgeHtml(row) {
  const raw = (row.status ?? "").trim();
  const key = raw.toLowerCase();
  const info = STATUS_INFO[key];
  if (info) return `<span class="status-badge ${info.cls}">${escapeHtml(info.label)}</span>`;
  if (raw) return `<span class="status-badge status-other">${escapeHtml(raw)}</span>`;
  return "";
}

function rightRowHtml(row, placedSet, hasStatus) {
  const id = String(row.id);
  const t = TEAM_BY_ABBR[row.team];
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  const textColour = textColourFor(primary, secondary);
  const locked = state.locks.has(id);
  const excluded = state.excludes.has(id);
  // 🔵 finding 6: "already placed" is a DraftKings-identity comparison, not a board-id comparison.
  const placed = placedSet.has(dkIdentity(row));
  // 🔵 finding 8: same dimming rule as the Rankings table.
  const statusKey = (row.status ?? "").trim().toLowerCase();
  const dimmed = DIM_STATUS_TOKENS.has(statusKey) || (row.flags ?? []).includes("injured");
  const rowClass = `${excluded ? " lineup-row-excluded" : locked ? " lineup-row-locked" : ""}${dimmed ? " row-dimmed" : ""}`;
  return `
    <tr class="lineup-row${rowClass}" data-id="${escapeHtml(id)}">
      <td>
        <span class="player-cell">
          <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(row.team ?? "")}</span>
          <span class="player-name">${escapeHtml(row.name)}</span>
        </span>
      </td>
      <td>${escapeHtml(row.pos ?? "")}</td>
      <td>${money(row.salary)}</td>
      <td>${row.proj == null ? "no proj" : dec1(row.proj)}</td>
      <td>${row.own == null ? "—" : `${dec1(row.own)}%`}</td>
      ${hasStatus ? `<td class="status-cell">${statusBadgeHtml(row)}</td>` : ""}
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
  const objSel = container.querySelector("#lineup-objective");
  objSel?.addEventListener("change", () => {
    state.objective = objSel.value;
    state.lastResult = null;
    commit();
  });
  const maxSel = container.querySelector("#lineup-max-team");
  maxSel?.addEventListener("change", () => {
    state.maxFromTeam = maxSel.value;
    state.lastResult = null;
    commit();
  });
  const stackSel = container.querySelector("#lineup-stack-qb");
  stackSel?.addEventListener("change", () => {
    state.stackQbWith = Number(stackSel.value);
    state.lastResult = null;
    commit();
  });

  container.querySelector("#lineup-build-btn")?.addEventListener("click", () => doBuild());

  container.querySelector("#lineup-clear-all-btn")?.addEventListener("click", () => {
    state.slots = new Array(LINEUP_SLOTS.length).fill(null);
    state.locks = new Set();
    state.excludes = new Set();
    state.lastResult = null;
    state.addError = null;
    commit();
  });

  container.querySelectorAll("[data-action='slot-lock']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = state.slots[Number(btn.dataset.slot)];
      if (!p) return;
      if (state.locks.has(p.id)) state.locks.delete(p.id);
      else state.locks.add(p.id);
      state.lastResult = null;
      commit();
    });
  });
  container.querySelectorAll("[data-action='slot-clear']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.slot);
      const p = state.slots[i];
      if (!p) return;
      state.locks.delete(p.id);
      state.slots[i] = null;
      state.lastResult = null;
      state.addError = null;
      commit();
    });
  });

  container.querySelectorAll("[data-action='row-lock']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (state.locks.has(id)) state.locks.delete(id);
      else state.locks.add(id);
      state.lastResult = null;
      commit();
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
      state.lastResult = null;
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
}

// --------------------------------------------------------------------------------------------------------
// Optimizer (PROJECT.md Part 4 "Optimizer"; DECISIONS.md D55 as amended 2026-10-10, D43, D32, D57).
// "Make N more lineups from these locks": the slots Adam has filled (plus any pool Lock) are the locks, the D55
// rules are toggle chips (all on), and the per-position maximum exposure boxes are his own (blank = no cap).
// POST /api/lineup/generate returns lineups that are NOT saved; each card is saved through the existing
// save-lineup route or discarded. The form's values live in `opt` (typed text is kept as typed), so the whole
// panel can re-render without losing a box; nothing here is written to localStorage.
// --------------------------------------------------------------------------------------------------------

const OPT_POSITIONS = ["QB", "RB", "WR", "TE", "DST"];
const OPT_MAX_COUNT = 150;
const OPT_MAX_UNIQUE = 8;
const OPT_DEFAULT_COUNT = 5;
const OPT_DEFAULT_UNIQUE = 1;
const OPT_BUSY_TEXT = "Another set of lineups is still being made. Try again in a moment.";

/** The seven D55 rules, in the server's rule keys (server/lineup/multi.js RULE_KEYS), with Adam's chip words. */
export const OPT_RULES = [
  { key: "starredQbOnly", label: "starred QBs only" },
  { key: "qbStack", label: "QB stack" },
  { key: "rbWithOwnQbOnlyIfCatcher", label: "RB with own QB only if pass catcher" },
  { key: "oneOffensivePerOtherTeam", label: "one per other team" },
  { key: "noSameTeamRbs", label: "no same-team RBs" },
  { key: "noSameGameRbs", label: "no same-game RBs" },
  { key: "noDstVsOwnPlayers", label: "no DST vs own players" },
];

const opt = {
  count: String(OPT_DEFAULT_COUNT),
  minUnique: String(OPT_DEFAULT_UNIQUE),
  maxExp: { QB: "", RB: "", WR: "", TE: "", DST: "" }, // percent text as typed; blank = no cap
  rules: Object.fromEntries(OPT_RULES.map((r) => [r.key, true])),
  avoid: new Set(), // game ids such as "DET@ARI"
  generating: false,
  saving: false,
  error: null, // the server's sentence for a refused or failed request
  saveError: null,
  formError: null, // a sentence naming a maximum-exposure box that is not a percent; blocks Go
  results: null, // {slateKey, lineups: [{uid, ids, salary, proj, players}], exposure, notes, exposureStale} or null
};
let optSeq = 0;

function resetOptimizerResults() {
  opt.results = null;
  opt.error = null;
  opt.saveError = null;
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

/** D43: "vs DAL" at home, "@ DET" away, from the board's "AWAY@HOME" game id; the board's own opponent text when
 *  the game id cannot tell. */
export function matchupOf(row) {
  const [away, home] = String(row?.gameId ?? "").split("@");
  if (away && home && row.team === home) return `vs ${away}`;
  if (away && home && row.team === away) return `@ ${home}`;
  return row?.opp ? String(row.opp) : "";
}

/** The saved lineups or the board changed under the lists, so the exposure counts are no longer current. */
function markExposureStale() {
  if (opt.results) opt.results.exposureStale = true;
}

let lastOptSlateKey;
/** New lineups belong to the slate they were made for (D57): switching the active slate clears them. */
function syncOptimizerSlate() {
  const key = store.get().activeSlateKey ?? null;
  if (key !== lastOptSlateKey) {
    if (lastOptSlateKey !== undefined) resetOptimizerResults();
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
 *  number (a blank box is left out, never sent as 0); every rule is sent explicitly. */
export function buildGenerateSettings(form) {
  const maxExposure = {};
  for (const pos of OPT_POSITIONS) {
    const pct = parsePct(form.maxExposure?.[pos]);
    if (pct !== null && !Number.isNaN(pct)) maxExposure[pos] = { pct };
  }
  const rules = {};
  for (const r of OPT_RULES) rules[r.key] = form.rules?.[r.key] !== false;
  return {
    count: parseWhole(form.count, 1, OPT_MAX_COUNT, OPT_DEFAULT_COUNT),
    minUnique: parseWhole(form.minUnique, 1, OPT_MAX_UNIQUE, OPT_DEFAULT_UNIQUE),
    locks: (form.locks ?? []).map(String),
    excludes: (form.excludes ?? []).map(String),
    maxExposure,
    rules,
    avoidGames: [...(form.avoid ?? [])],
  };
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

export function ruleChipsHtml(rules) {
  return OPT_RULES.map(
    (r) =>
      `<button type="button" class="chip toggle-chip opt-chip${rules?.[r.key] !== false ? " active" : ""}" data-action="opt-rule" data-key="${escapeHtml(r.key)}" aria-pressed="${rules?.[r.key] !== false}">${escapeHtml(r.label)}</button>`
  ).join("");
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

function optPlayerRowHtml(p, slotName) {
  const t = TEAM_BY_ABBR[p.team];
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  const textColour = textColourFor(primary, secondary);
  const projText = p.proj == null ? "—" : dec1(p.proj);
  return `
      <div class="opt-p">
        <span class="opt-p-slot">${escapeHtml(slotName)}</span>
        <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(p.team ?? "")}</span>
        <span class="opt-p-name">${escapeHtml(p.name ?? "")}</span>
        <span class="opt-p-opp">${escapeHtml(p.opp ?? "")}</span>
        <span class="opt-p-sal">${money(p.salary)}</span>
        <span class="opt-p-proj">${projText}</span>
        <span class="opt-p-own">${escapeHtml(ownParen(p.own))}</span>
      </div>`;
}

/** One "new lineup" card: the nine players in DK slot order (name, matchup D43, salary, projection, own% D32),
 *  the totals, and Save / Discard. `busy` disables both while a save is in flight. */
export function optLineupCardHtml(lineup, index, busy) {
  const totals = lineupTotalsOf(lineup);
  const overCap = totals.salary > SALARY_CAP;
  const rows = (lineup.players ?? []).map((p, i) => optPlayerRowHtml(p, LINEUP_SLOTS[i] ?? p.pos ?? "")).join("");
  const ownText = totals.own == null ? "" : ` &middot; ${Math.round(totals.own)}% own`;
  const uid = escapeHtml(lineup.uid ?? "");
  return `
    <div class="opt-card" data-uid="${uid}">
      <div class="opt-card-head">
        <span class="opt-card-title">Lineup ${index + 1}</span>
        <span class="opt-card-actions">
          <button type="button" class="saved-lineup-btn" data-action="opt-save" data-uid="${uid}"${busy ? " disabled" : ""}>Save</button>
          <button type="button" class="saved-lineup-btn danger" data-action="opt-discard" data-uid="${uid}"${busy ? " disabled" : ""}>Discard</button>
        </span>
      </div>
      <div class="opt-card-players">${rows}</div>
      <div class="opt-card-totals"><span class="${overCap ? "saved-lineup-totals-over" : ""}">${money(totals.salary)}</span> &middot; ${dec1(totals.proj) ?? "—"} proj${ownText}</div>
    </div>`;
}

function teamBadgeHtml(team) {
  const t = TEAM_BY_ABBR[team];
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  return `<span class="team-chip-mini" style="background:${primary};color:${textColourFor(primary, secondary)}">${escapeHtml(team ?? "")}</span>`;
}

/** Exposure by position, one list per position (D55). Each row is name + matchup (D43) + own% (D32) and how many
 *  lineups (saved plus new) hold him. `exposure` is {QB: [{name, team, opp, own, count, pct}], ...}. */
export function optExposureHtml(exposure, stale) {
  const boxes = OPT_POSITIONS.map((pos) => {
    const list = Array.isArray(exposure?.[pos]) ? exposure[pos] : [];
    const rows = list.length
      ? list
          .map(
            (e) => `
          <div class="opt-exp-row">
            ${teamBadgeHtml(e.team)}
            <span class="opt-exp-name">${escapeHtml(e.name ?? "")}</span>
            <span class="opt-exp-opp">${escapeHtml(e.opp ?? "")}</span>
            <span class="opt-exp-own">${escapeHtml(ownParen(e.own))}</span>
            <span class="opt-exp-pct">${escapeHtml(String(Math.round(e.pct ?? 0)))}% <span class="opt-exp-count">(${escapeHtml(String(e.count ?? 0))})</span></span>
          </div>`
          )
          .join("")
      : `<div class="opt-exp-empty">None</div>`;
    return `<div class="opt-exp-box"><div class="opt-exp-title">${escapeHtml(pos)}</div><div class="opt-exp-list">${rows}</div></div>`;
  }).join("");
  const staleNote = stale ? `<span class="opt-sub">out of date: the lineups changed since the last Go</span>` : "";
  return `
    <div class="opt-exposure">
      <h3 class="opt-title">Exposure by position <span class="opt-sub">saved plus new lineups</span> ${staleNote}</h3>
      <div class="opt-exp-grid">${boxes}</div>
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
  const expInputs = OPT_POSITIONS.map(
    (pos) => `
        <label class="opt-exp-input">${pos}
          <input type="text" inputmode="decimal" class="opt-input opt-input-pct" data-opt-exp="${pos}" value="${escapeHtml(opt.maxExp[pos])}" placeholder="%" aria-label="${pos} maximum exposure percent" />
        </label>`
  ).join("");
  const avoidBlock = games.length
    ? `<div class="opt-block"><span class="opt-block-label">Avoid game</span><div class="opt-chips">${avoidChipsHtml(games, opt.avoid)}</div></div>`
    : "";
  const formError = opt.formError ? `<div class="lineup-status lineup-status-error opt-form-error">${escapeHtml(opt.formError)}</div>` : "";
  const busy = opt.generating || opt.saving;
  return `
    <div class="opt-panel" id="opt-panel">
      <h3 class="opt-title">Optimizer</h3>
      <div class="opt-row">
        <span class="opt-inline">Make
          <input type="number" min="1" max="${OPT_MAX_COUNT}" class="opt-input opt-input-num" id="opt-count" value="${escapeHtml(opt.count)}" aria-label="How many lineups" />
          more lineups from these locks</span>
        <span class="opt-inline">Min unique players
          <input type="number" min="1" max="${OPT_MAX_UNIQUE}" class="opt-input opt-input-num" id="opt-min-unique" value="${escapeHtml(opt.minUnique)}" aria-label="Minimum unique players between lineups" />
        </span>
        <span class="opt-inline opt-inline-exp"><span class="opt-block-label">Max exposure <span class="opt-sub">blank = no cap</span></span>${expInputs}</span>
        <button type="button" id="opt-go-btn" class="lineup-build-btn opt-go"${busy ? " disabled" : ""}>${opt.generating ? "Making…" : "Go"}</button>
        ${info}
      </div>
      ${formError}
      <div class="opt-row opt-row-chips">
        <div class="opt-block"><span class="opt-block-label">Rules</span><div class="opt-chips">${ruleChipsHtml(opt.rules)}</div></div>
        ${avoidBlock}
      </div>
    </div>`;
}

function optimizerResultsHtml(rowById) {
  if (opt.generating && !opt.results) return `<div class="opt-results" id="opt-results"><div class="opt-sub">Making lineups…</div></div>`;
  if (!opt.error && !opt.results) return "";
  const parts = [];
  if (opt.error) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(opt.error)}</div>`);
  const r = opt.results;
  if (r) {
    const n = r.lineups.length;
    const busy = opt.saving || opt.generating;
    const head = n
      ? `<div class="opt-results-head">
           <h3 class="opt-title">New lineups (not saved) <span class="opt-sub">${n} lineup${n === 1 ? "" : "s"}</span></h3>
           <span class="opt-card-actions">
             <button type="button" class="saved-lineup-btn" data-action="opt-save-all"${busy ? " disabled" : ""}>Save all</button>
             <button type="button" class="saved-lineup-btn danger" data-action="opt-discard-all"${busy ? " disabled" : ""}>Discard all</button>
           </span>
         </div>`
      : `<h3 class="opt-title">New lineups (not saved) <span class="opt-sub">none left</span></h3>`;
    parts.push(head);
    if (opt.saveError) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(opt.saveError)}</div>`);
    parts.push(optNotesHtml(r.notes));
    if (n) parts.push(`<div class="opt-cards">${r.lineups.map((l, i) => optLineupCardHtml(l, i, busy)).join("")}</div>`);
    parts.push(optExposureHtml(r.exposure, r.exposureStale));
  }
  return `<div class="opt-results" id="opt-results">${parts.join("")}</div>`;
}

// ---- Actions ----

async function doGenerate() {
  if (opt.generating || opt.saving) return;
  opt.formError = exposureProblem(opt.maxExp);
  if (opt.formError) {
    commit();
    return;
  }
  const board = store.get().board;
  const slate = activeSlate(board);
  const slateKey = slate ? slate.key : "main";
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
  };
  opt.generating = true;
  opt.error = null;
  opt.saveError = null;
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
      opt.results = { slateKey, lineups, exposure: data.exposure ?? {}, notes, exposureStale: false };
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
 *  key). A saved card leaves the new list and lands in the saved list; the first failure stops the run and stays. */
async function saveGenerated(uids) {
  if (opt.saving || opt.generating || !opt.results) return;
  opt.saving = true;
  opt.saveError = null;
  commit();
  const results = opt.results;
  const slateKey = results.slateKey ?? "main"; // the slate these lineups were made for, not the one on screen now
  for (const uid of uids) {
    const lineup = results.lineups.find((l) => l.uid === uid);
    if (!lineup) continue;
    try {
      const data = await postLineup({ name: "", slots: slotsForSave(lineup.players), slate: slateKey });
      if (!data || data.ok === false) {
        opt.saveError = data?.error?.message ?? "Could not save the lineup.";
        break;
      }
      if (Array.isArray(data.lineups)) state.savedLineups = data.lineups;
      results.lineups = results.lineups.filter((l) => l.uid !== uid);
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
  opt.results.exposureStale = true;
  commit();
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
  container.querySelector("#opt-go-btn")?.addEventListener("click", () => doGenerate());
  container.querySelectorAll("[data-action='opt-rule']").forEach((btn) => {
    btn.addEventListener("click", () => {
      opt.rules[btn.dataset.key] = !(opt.rules[btn.dataset.key] !== false);
      commit();
    });
  });
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
    saveGenerated((opt.results?.lineups ?? []).map((l) => l.uid));
  });
  container.querySelector("[data-action='opt-discard-all']")?.addEventListener("click", () => {
    resetOptimizerResults();
    commit();
  });
}
