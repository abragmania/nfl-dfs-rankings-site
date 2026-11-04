// The typed-number box and the note box (optimizer standard A3, round 3; moved out of table.js in round 4 so the Showdown pool uses the same two editors, B3).
// A click away saves, Enter saves, Esc cancels; the hint `Enter saves, Esc cancels` is under every box; a bad number on a click away says `Not saved` and saves
// nothing, on Enter keeps the box open with the sentence; an emptied number box cancels; an emptied note removes the note. The boxes know nothing of the table they
// sit in: the caller passes what to do on a save and how to put the cell back (lineup-pool-edit.js for the classic pool, showdown/pool-edit.js for the Showdown pool).
// The one box that is open is kept here (openEditor) so a redraw of the table takes it out first and puts it back with its text and focus (takeOpenEditor), and
// the removal never reads as a click away.

// The hint under every open typed-number and note box (optimizer standard A3, round 3): Enter or a click away saves, Esc cancels.
export const EDIT_HINT = "Enter saves, Esc cancels";
export const NOT_SAVED_TEXT = "Not saved";

/** What a typed number is, for `field` ("proj" or "own"): {value} when it can be saved, {error: sentence} when it cannot, {empty: true} for a box with nothing in it. Pure. */
export function readTypedNumber(raw, field) {
  const text = String(raw ?? "").trim();
  if (text === "") return { empty: true };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return { error: "Enter a number." };
  if (field === "proj" && parsed < 0) return { error: "Projection must be 0 or greater." };
  if (field === "own" && (parsed < 0 || parsed > 100)) return { error: "Ownership must be between 0 and 100." };
  return { value: parsed };
}

/** What closing a typed-number or note box does (A3), given how it was closed and what it holds. `how`: "enter" (Enter pressed), "away" (a click
 *  elsewhere) or "escape". `read`: readTypedNumber's answer (for a note: {value: text} or {empty: true}); `start`: the text the box opened with.
 *  Returns "save", "cancel", "keep" (a bad number on Enter: the box stays open with the message) or "notSaved" (a bad number on a click away: the box
 *  closes, nothing is saved, and "Not saved" is said). A box closed with the text it opened with is a cancel on Enter or a click away alike (no write for a click in and out
 *  or an Enter on an untouched box, round 4 item 6). Pure. */
export function closeDecision(how, read, start) {
  if (how === "escape" || read.empty) return "cancel";
  if (read.error) return how === "enter" ? "keep" : "notSaved";
  if (String(read.value) === String(start)) return "cancel"; // the number the box opened with, on Enter or a click away: nothing changes (the box shows one decimal, a saved 20.24 must not become 20.2)
  return "save";
}

// The one typed-number or note box that is open (A3, round 3 fixes): a redraw of the table takes it out first and puts it
// back, text and focus kept, in the new cell, so replacing the old box never reads as a click away and never writes (a half-typed value saved by
// the removal's blur was the bug). `released` makes the old box's handlers do nothing.
let openEditor = null; // {kind: "field"|"note", id, field, input, wrap, start, released}

/** Focuses a box. One a redraw took out and put back (`carry`) keeps the page where it is (preventScroll): the redraw must not move what he is looking at; a box he just opened may scroll into view as before. */
export function focusBox(input, carry = null) {
  if (carry) input.focus({ preventScroll: true });
  else input.focus();
}

/** The open box, taken out of the redraw's way: {kind, id, field, text, start} to put back with the table's own reopen, or null when none is open (or it is outside `within`). */
export function takeOpenEditor(within) {
  const ed = openEditor;
  if (!ed) return null;
  if (within && !within.contains?.(ed.wrap)) return null;
  ed.released = true;
  openEditor = null;
  if (ed.wrap.isConnected === false) return null; // already gone from the page: nothing to put back
  return { kind: ed.kind, id: ed.id, field: ed.field, text: ed.input.value, start: ed.start };
}

export function startEdit(cellEl, id, field, currentValue, onCommit, carry = null) {
  const wrap = document.createElement("span");
  wrap.className = "cell-edit-wrap";
  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.1";
  input.className = "cell-edit-input";
  // Prefill rounded to one decimal (Adam, 2026-09-27): the board carries full precision, the box must not.
  input.value = currentValue == null ? "" : (typeof currentValue === "number" ? String(Math.round(currentValue * 10) / 10) : currentValue);
  const start = carry?.start ?? input.value;
  if (carry) input.value = carry.text; // a redraw took the box out: what he had typed comes back
  const errorEl = document.createElement("div");
  errorEl.className = "cell-edit-error";
  errorEl.hidden = true;
  const hintEl = document.createElement("div");
  hintEl.className = "cell-edit-hint";
  hintEl.textContent = EDIT_HINT;
  wrap.appendChild(input);
  wrap.appendChild(hintEl);
  wrap.appendChild(errorEl);
  cellEl.innerHTML = "";
  cellEl.appendChild(wrap);
  focusBox(input, carry); // a box put back by a redraw takes focus without moving the page
  if (!carry) input.select();
  const editor = { kind: "field", id, field, input, wrap, start, released: false };
  openEditor = editor;

  let done = false;
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    hintEl.hidden = true; // the message takes the hint's place under the box
  };
  const shut = () => {
    done = true;
    if (openEditor === editor) openEditor = null;
  };
  const cancel = () => {
    if (done) return;
    shut();
    onCommit(null);
  };
  // `how`: "enter", "away" (the box lost focus) or "escape" (closeDecision). A cancel reports (null) so the table puts the old value back.
  const close = (how) => {
    if (done || editor.released) return; // a released box was taken out by a redraw: its removal is not a click away and writes nothing
    const read = readTypedNumber(input.value, field);
    const decision = closeDecision(how, read, start);
    if (decision === "keep") {
      showError(read.error);
      input.focus();
    } else if (decision === "notSaved") {
      shut();
      onCommit(null, field, undefined, { notSaved: read.error });
    } else if (decision === "save") {
      shut();
      onCommit(id, field, read.value);
    } else {
      cancel();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") close("enter");
    if (e.key === "Escape") close("escape");
  });
  input.addEventListener("blur", () => {
    if (wrap.isConnected === false) { // removed from the page by something other than a redraw of this table: gone, nothing written
      editor.released = true;
      shut();
      return;
    }
    close("away");
  });
}

/** The "Not saved" note beside a cell whose number was refused on a click away; it goes by itself after a few seconds. `reason` is the hover. */
export const NOT_SAVED_MS = 4000;
let heldNotSaved = null; // {id, field, reason, until}: the `Not saved` showing now, so a redraw of the table (a click on a row) does not take it away early (A3, round 5)

export function showNotSaved(cellEl, reason, doc = document, setTimer = setTimeout, mark = null, now = Date.now) {
  appendNotSaved(cellEl, reason, NOT_SAVED_MS, doc, setTimer);
  if (mark) heldNotSaved = { id: String(mark.id), field: mark.field, reason, until: now() + NOT_SAVED_MS };
}

function appendNotSaved(cellEl, reason, ms, doc = document, setTimer = setTimeout) {
  const el = doc.createElement("span");
  el.className = "cell-edit-error cell-not-saved";
  el.textContent = NOT_SAVED_TEXT;
  if (reason) el.title = reason;
  cellEl.appendChild(el);
  setTimer(() => el.remove(), ms);
}

/** After a redraw of the table: a `Not saved` that was still showing is put back on its cell for the time it had left. `cellFor(id, field)` finds the redrawn cell (null when it is gone, a filter hid the man). Returns whether it was. */
export function carryNotSaved(cellFor, doc = globalThis.document, setTimer = setTimeout, now = Date.now) {
  const held = heldNotSaved;
  if (!held) return false;
  const left = held.until - now();
  if (left <= 0) {
    heldNotSaved = null;
    return false;
  }
  const cell = cellFor(held.id, held.field);
  if (!cell || cell.querySelector?.(".cell-not-saved") || cell.querySelector?.("input")) return false;
  appendNotSaved(cell, held.reason, left, doc, setTimer);
  return true;
}

/** Forgets the `Not saved` on hold (a new box opened on the cell, or a number was saved). */
export function dropHeldNotSaved() {
  heldNotSaved = null;
}

/** Whether closing a note box writes (A3): Enter saves, a click away saves only a changed note, Esc never; an emptied note is saved as a removal, but a box that
 *  was empty and still is has nothing to write. `text` and `start` are trimmed. Pure. */
export function noteSaves(how, text, start) {
  if (how === "escape") return false;
  if (text === "" && start === "") return false;
  return how === "enter" ? true : text !== start;
}

/**
 * Opens the note box in `slot` (the element that held the pencil). `note`: the text it opens with; `restoreHtml`: what goes back in the slot when nothing is saved
 * (the pencil); `onSave(text)`: called with the trimmed text, or null for an emptied note (which removes it); `onRestore()`: called after the pencil is put back, so a table that wires
 * each pencil itself can wire the new one. `carry`: the box a redraw took out.
 */
export function startNoteBox(slot, { id, note, restoreHtml, onSave, onRestore = null, carry = null }) {
  const wrap = document.createElement("span");
  wrap.className = "cell-edit-wrap note-edit-wrap";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "note-edit-input";
  input.maxLength = 300;
  input.value = note ?? "";
  const start = carry?.start ?? input.value.trim();
  if (carry) input.value = carry.text; // a redraw took the box out: what he had typed comes back
  const hintEl = document.createElement("div");
  hintEl.className = "cell-edit-hint";
  hintEl.textContent = EDIT_HINT;
  wrap.appendChild(input);
  wrap.appendChild(hintEl);
  slot.innerHTML = "";
  slot.appendChild(wrap);
  focusBox(input, carry);
  if (!carry) input.select();
  const editor = { kind: "note", id, field: "note", input, wrap, start, released: false };
  openEditor = editor;

  let done = false;
  // An emptied note removes the note (null); a click away that changes nothing, and Esc, put the icon back with no write.
  const finish = (how) => {
    if (done || editor.released) return; // a released box was taken out by a redraw: its removal writes nothing
    done = true;
    if (openEditor === editor) openEditor = null;
    const text = input.value.trim();
    const save = noteSaves(how, text, start);
    if (save) onSave(text === "" ? null : text);
    else {
      slot.innerHTML = restoreHtml;
      onRestore?.(); // the pencil is a new node: its owner wires it again (round 4, item 12)
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish("enter");
    if (e.key === "Escape") finish("escape");
  });
  input.addEventListener("blur", () => {
    if (wrap.isConnected === false) { // removed from the page by something other than a redraw of this table: gone, nothing written
      editor.released = true;
      done = true;
      if (openEditor === editor) openEditor = null;
      return;
    }
    finish("away");
  });
}
