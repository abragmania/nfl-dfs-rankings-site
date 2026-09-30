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
import { store, filterRows, sortRows, FLEX_POS } from "./state.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { postLineupOptimize, getLineups, postLineup, deleteLineup, putLineupName } from "./api.js";

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

  try {
    const data = await postLineupOptimize(payload);
    // `notes` may be absent on the running server (PROJECT.md Part 4) — always treat a missing notes
    // array as [].
    const notes = Array.isArray(data?.notes) ? data.notes : [];
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
        ${rightColumnHtml(rows, rowById)}
      </div>
    </div>
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
    <span class="lineup-slot-player">
      <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(row.team ?? "")}</span>
      <span class="lineup-slot-name">${escapeHtml(row.name)}</span>
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
  const filtered = filterRows(rows, filters);
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
    <div class="table-legend">q = ownership published by a named source &middot; &mdash; = nobody has published one</div>`;
}

// Mirrors table.js's ownCellInner marker (🔵 finding 8): a small "q" superscript on a number a named source
// published. A number Adam typed in carries no letter, and a player with no number shows an em dash.
function ownMarkerHtml(row) {
  if (row.own == null || row.ownKind !== "quoted" || row.override?.own != null) return "";
  return `<sup class="own-kind own-kind-quoted" title="Published by a named source">q</sup>`;
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
      <td>${row.own == null ? "—" : `${dec1(row.own)}%${ownMarkerHtml(row)}`}</td>
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
}
