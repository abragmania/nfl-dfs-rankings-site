// The Showdown builder's seats (split out of ./lineup.js in the round 3 fix batch to keep that file under its cap): the working lineup (`state`: the
// Captain, the five FLEX seats and the messages a click leaves), the rules for a click on a pool row (add, remove, the Captain swap of C19), the Lock that
// seats a man and the Unlock that takes him out (D3), Clear all, and the question "is the working lineup saved" (C11). DOM-free apart from the Optimizer's
// lock reads. lineup.js owns the panel and hands this the board it is drawing (setSeatBoard).
import { poolPickAction } from "./pool.js";
import { poolControls, optimizerLocks, releaseSeatLock, releaseAllLocks, setSeatedSource } from "./optimizer.js";
import { seatPicker, placeCaptain, oldCaptainCanFlex, removedCaptainText } from "./seat-picker.js"; // A18, C19: what a click on a pool row may do, and the Captain rule
import { addMessageOf } from "./lineup-status.js";
import { findRow, SALARY_CAP, FLEX_COUNT } from "./lineup-saved.js";

export const state = {
  cpt: null, // {id} or null
  flex: new Array(FLEX_COUNT).fill(null), // each {id} or null
  addError: null,
  addErrorId: null, // the pool row whose click made addError (row-message.js)
  addTone: undefined, // how addError is drawn: undefined is amber (a refusal); "error" for a write that failed (rowError)
  dkSelected: new Set(), // saved lineup ids ticked for Download DK CSV (dk-lineup-ui.js); page-only
  dkStatus: "", // the sentence the last Download DK CSV left under its button
  confirm: null, // the inline confirm that is open (confirm-inline.js): "clear" (Clear all) or "load:saved:<id>" / "load:result:<uid>" (Load over unsaved slots, C11)
  deleteErrors: {}, // saved lineup id -> why its delete did not happen (A12), shown on the card until the next try
  savedLineups: [],
  savedLoaded: false,
  savedError: null,
  saveName: "",
  saving: false,
  saveError: null,
  saveTone: "error", // "warn" for the nothing-to-save refusal, "error" for a failure (row-message.js)
  saveConfirm: null,
  renamingId: null,
  deleteConfirmId: null,
};

let boardRef = null; // the board the panel is drawing (lineup.js sets it on every draw)
export function setSeatBoard(board) {
  boardRef = board;
}

export function isPlacedFlex(id) {
  return state.flex.some((s) => s && String(s.id) === String(id));
}

/** Whether `id` holds a lock in `kind` ("cpt" or "flex") in the mode on screen. */
function lockedAt(kind, id) {
  return boardRef ? optimizerLocks(boardRef)[kind].has(String(id)) : false;
}
const isLockedFlex = (id) => lockedAt("flex", id);

function addCaptain(row, board = boardRef) {
  if (!row) return;
  state.addErrorId = String(row.id); // a refusal is drawn beside his row (row-message.js, standard A14)
  state.addTone = undefined;
  if (row.cptSalary == null) {
    state.addError = `${row.name} has no showdown Captain salary.`;
    return;
  }
  if (state.cpt && String(state.cpt.id) === String(row.id)) {
    state.addError = `${row.name} is already the Captain.`;
    return;
  }
  // C19 (round 3): the old Captain goes to the first empty FLEX seat (or takes the seat the new Captain leaves); with none free, or with no FLEX salary or an exclude
  // from FLEX, he is out and it says why.
  const oldId = state.cpt ? String(state.cpt.id) : null;
  const oldRow = oldId ? findRow(board, oldId) : null;
  if (oldId && lockedAt("cpt", oldId)) {
    state.addError = `The Captain seat is locked on ${oldRow?.name ?? "your Captain"}. Unlock him first.`; // a locked Captain is not moved by another man's click (D3)
    return;
  }
  if (isLockedFlex(row.id)) {
    state.addError = `${row.name} is locked into your lineup in a FLEX seat. Unlock him first, or click his slot.`;
    return;
  }
  const next = placeCaptain(state.cpt, state.flex, row.id, { canFlex: () => oldCaptainCanFlex(oldRow, (r, tab) => poolControls.excluded(r, tab)) });
  state.cpt = next.cpt;
  state.flex = next.flex;
  state.addError = next.removed ? removedCaptainText(oldRow?.name ?? "the old Captain", next.removedWhy) : null;
}

function addFlex(row) {
  if (!row) return;
  state.addErrorId = String(row.id);
  state.addTone = undefined;
  if (row.salary == null) {
    state.addError = `${row.name} has no showdown FLEX salary.`;
    return;
  }
  if (state.cpt && String(state.cpt.id) === String(row.id)) {
    state.addError = `${row.name} is already the Captain.`;
    return;
  }
  if (isPlacedFlex(row.id)) {
    state.addError = `${row.name} is already in a FLEX slot.`;
    return;
  }
  const idx = state.flex.findIndex((s) => !s);
  if (idx === -1) {
    state.addError = "All five FLEX slots are full.";
    return;
  }
  state.flex[idx] = { id: String(row.id) };
  state.addError = null;
}

/**
 * A click on a pool row (pool.js poolPickAction names `action`; Adam 4:45 PM 2026-10-29): the same add and clear rules the Add and Clear
 * buttons ran. The Captain is greyed on the FLEX list (A18); a FLEX man's Captain row swaps him with the Captain (C19) unless a seat is locked.
 */
export function pickPoolRow(row, action, board = boardRef) {
  if (!row) return;
  if (action === "remove-flex") {
    const idx = state.flex.findIndex((s) => s && String(s.id) === String(row.id));
    if (idx !== -1) clearFlex(idx);
  } else if (action === "remove-cpt") {
    clearCaptain();
  } else if (action === "add-cpt") {
    addCaptain(row, board);
  } else if (action === "add-flex") {
    addFlex(row);
  }
}

/** Test hook: who is placed now, {cpt, flex, addError, addErrorId} (copies). */
export function lineupPicks() {
  return { cpt: state.cpt ? { ...state.cpt } : null, flex: state.flex.map((s) => (s ? { ...s } : null)), addError: state.addError, addErrorId: state.addErrorId };
}

// What the pool needs from the lineup: who is placed (a placed man's row is tinted on the tab where he sits), what each click may do and why a row is greyed (A18,
// seat-picker.js), and the click's message; a click on a row runs pickPoolRow, where the add and clear rules stay.
export function listPlacement() {
  const pickOf = boardRef ? seatPicker({ board: boardRef, cap: SALARY_CAP, placed: { cpt: state.cpt, flex: state.flex }, excluded: (row, tab) => poolControls.excluded(row, tab), locks: optimizerLocks(boardRef) }) : null;
  return { cptId: state.cpt ? String(state.cpt.id) : null, flexIds: new Set(state.flex.filter(Boolean).map((s) => String(s.id))), message: addMessageOf(state), ...(pickOf ? { pickOf } : {}) };
}

/**
 * A pool Lock on `row`'s list (`kind` "cpt" or "flex") seats him in that seat by the same rules and refusals as a click (D3; classic's lockPool): a man already
 * there is just locked; one who cannot sit is refused with the greying's own sentence beside his row and nothing locks. Returns whether he may be locked.
 */
export function lockSeat(row, kind) {
  const id = String(row.id);
  state.addErrorId = id;
  state.addTone = undefined;
  const seatedHere = kind === "cpt" ? Boolean(state.cpt) && String(state.cpt.id) === id : isPlacedFlex(id);
  if (seatedHere) {
    state.addError = null;
    return true;
  }
  const placement = listPlacement();
  const base = poolPickAction(placement, id, kind);
  const pick = placement.pickOf ? placement.pickOf(row, kind, base) : { action: base, reason: "" };
  if (!pick.action) {
    state.addError = pick.reason || `${row.name} cannot be seated.`;
    return false;
  }
  pickPoolRow(row, pick.action, boardRef);
  return true;
}

/** A pool Unlock takes his lock off and the man out of the seat (classic's unlockPool: a lock is how he is held in the lineup). */
export function unlockSeat(row, kind) {
  const id = String(row.id);
  if (kind === "cpt" && state.cpt && String(state.cpt.id) === id) state.cpt = null;
  else if (kind === "flex") {
    const idx = state.flex.findIndex((s) => s && String(s.id) === id);
    if (idx !== -1) state.flex[idx] = null;
  }
  releaseSeatLock(row, kind); // in the other mode too: the seat is empty now
  state.addError = null;
  return true;
}

// The men in the seats as the Optimizer's candidate ids (the Captain by his Captain id): a Build holds them as classic holds its slots, and the Settings line says so (item 11).
setSeatedSource((board) => {
  const out = [];
  const cptRow = state.cpt ? findRow(board ?? boardRef, state.cpt.id) : null;
  if (cptRow && cptRow.cptId != null && String(cptRow.cptId) !== "") out.push(String(cptRow.cptId));
  for (const s of state.flex) if (s) out.push(String(s.id));
  return out;
});

let reconciledScope = null;
/**
 * Locks persist (browser storage, per game and mode); the seats do not. At the first draw of a game and at every mode switch (`scope` names the pair) each stored lock is put in its seat by
 * the same rules as a click, the Captain's first; one that cannot sit is dropped, and a sentence says who and why. After this a lock always has his seat (a slot click, Unlock, Clear all
 * and Load remove the locks they leave behind), so a Build never forces a man the lineup does not show, and a lock never comes back on with an empty seat.
 */
export function reseatStoredLocks(scope) {
  if (scope === reconciledScope) return;
  reconciledScope = scope;
  if (!boardRef) return;
  const held = optimizerLocks(boardRef);
  const stored = [...[...held.cpt].map((id) => [id, "cpt"]), ...[...held.flex].map((id) => [id, "flex"])];
  const told = [];
  for (const [id, kind] of stored) {
    const row = findRow(boardRef, id);
    if (!row) continue;
    const seatedHere = kind === "cpt" ? Boolean(state.cpt) && String(state.cpt.id) === String(id) : isPlacedFlex(id);
    if (seatedHere) continue;
    const placement = listPlacement();
    const pick = placement.pickOf ? placement.pickOf(row, kind, poolPickAction(placement, String(id), kind)) : { action: null, reason: "" };
    if (pick.action) pickPoolRow(row, pick.action, boardRef);
    else {
      releaseSeatLock(row, kind);
      told.push(`${row.name} was unlocked: ${pick.reason || "he cannot take that seat"}`);
    }
  }
  if (told.length) {
    state.addError = told.join(" ");
    state.addErrorId = null;
    state.addTone = undefined;
  }
}

// A man leaving a seat takes his lock in that seat with him, in both modes (classic's removeSlot). A lock stored with no seat is dealt with by reseatStoredLocks, not left to point at an empty seat.
export function clearCaptain() {
  const gone = state.cpt ? findRow(boardRef, state.cpt.id) : null;
  state.cpt = null;
  state.addError = null;
  releaseSeatLock(gone, "cpt");
}

export function clearFlex(idx) {
  const gone = state.flex[idx] ? findRow(boardRef, state.flex[idx].id) : null;
  state.flex[idx] = null;
  state.addError = null;
  releaseSeatLock(gone, "flex");
}

export function clearAll() {
  state.confirm = null;
  state.cpt = null;
  state.flex = new Array(FLEX_COUNT).fill(null);
  state.addError = null;
  releaseAllLocks(); // every lock of this game, both modes: none is left to come back on with an empty seat
}

/** Whether Clear all would lose something (B13): a man in any seat. */
export const clearAllHasContent = () => Boolean(state.cpt) || state.flex.some(Boolean);

/** A saved or generated slot may name a man by either of his ids; the builder keeps his FLEX id. */
export function rowIdOf(playerId) {
  const key = String(playerId);
  const row = (boardRef?.rows ?? []).find((r) => String(r.id) === key || (r.cptId != null && String(r.cptId) === key));
  return row ? String(row.id) : key;
}

/** The working lineup is not any saved lineup of this game (C11): Load over it would lose it. A Captain-aware comparison: the same Captain and the same five FLEX men. */
export function workingUnsaved() {
  if (!clearAllHasContent()) return false;
  const key = (cpt, flex) => `${cpt ?? ""}|${[...flex].filter(Boolean).sort().join(",")}`;
  const mine = key(state.cpt ? String(state.cpt.id) : null, state.flex.filter(Boolean).map((s) => String(s.id)));
  return !state.savedLineups.some((l) => {
    const cpt = (l.slots ?? []).find((s) => String(s.slot ?? "").toUpperCase() === "CPT");
    const flex = (l.slots ?? []).filter((s) => s !== cpt).map((s) => String(rowIdOf(s.playerId)));
    return key(cpt ? String(rowIdOf(cpt.playerId)) : null, flex) === mine;
  });
}
