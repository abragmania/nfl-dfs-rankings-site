// The pool's Min % and Max % boxes (optimizer standard A3, round 3 fixes): typing changes nothing until the box closes. Enter saves; a click away
// saves; Esc puts the old text back; the hint `Enter saves, Esc cancels` sits under the open box; a text that is not a percent from 0 to 100 keeps the
// box open on Enter (with the sentence) and on a click away says `Not saved` and puts the old text back. The one exception to A3's "an emptied box
// cancels" (B10): an emptied box saves, and that removes the limit. A Build started while a box is open reads what is typed in it (flushOpenLimit),
// and a redraw of the panel carries the open box into the new one with its text and focus (takeOpenLimit / restoreOpenLimit), never as a click away.
// What is saved, and where, is the caller's: wireLimitBox gets `save(text)` ("" removes the limit) and `parse(text)` (NaN when it is not a percent).
export const LIMIT_HINT = "Enter saves, Esc cancels";
export const LIMIT_BAD = "Enter a percent from 0 to 100.";
export const LIMIT_NOT_SAVED = "Not saved";

/** What closing a limit box does. `how`: "enter", "away" or "escape"; `parse` as above. "save" (an emptied box too: it removes the limit),
 *  "cancel" (Esc, or a click away that changed nothing), "keep" (a bad text on Enter: stays open) or "notSaved" (a bad text on a click away). Pure. */
export function limitDecision(how, text, start, parse) {
  if (how === "escape") return "cancel";
  const t = String(text ?? "").trim();
  if (t !== "" && Number.isNaN(parse(t))) return how === "enter" ? "keep" : "notSaved";
  if (how === "away" && t === String(start ?? "").trim()) return "cancel";
  return "save";
}

let open = null; // {el, ctx, start, released, done}
const ctxOf = new WeakMap();

function cellOf(el) {
  return el.parentElement ?? el.parentNode ?? null;
}

function removeNotes(el) {
  const cell = cellOf(el);
  cell?.querySelectorAll?.(".limit-hint, .limit-bad").forEach((n) => n.remove());
}
// (a refusal's note is removed by removeNotes when the box opens again; the held refusal itself goes by the rules above)

function showHint(el, text, bad, doc) {
  removeNotes(el);
  const cell = cellOf(el);
  if (!cell || !doc) return;
  const hint = doc.createElement("span");
  hint.className = bad ? "limit-hint limit-bad cell-edit-error" : "limit-hint cell-edit-hint"; // the look of the Proj and Own boxes' hint and message
  hint.textContent = text;
  cell.appendChild(hint);
}

// A text the box refused (`Not saved`) is held here, not only drawn: a real click on Build blurs the box first (the refusal), then Build runs, and the redraw the
// refusal itself causes would wipe a drawn note. So the refusal stays in this registry, is drawn beside its row on every redraw (refusalNoteHtml), stops a Build
// (limitRefusals, doGenerate) and goes at the next press elsewhere, or when the box is fixed. `at` is the press it was made in: the click that follows that very press does not clear it.
const refusals = new Map(); // selector -> {sentence, at}
let presses = 0;

/** A mouse press began (the page's capture-phase mousedown): refusals made after this point belong to this press. */
export function noteLimitPress() {
  presses += 1;
}

/** The refusals still held, oldest first: [{selector, sentence}]. */
export function limitRefusals() {
  return [...refusals].map(([selector, r]) => ({ selector, sentence: r.sentence }));
}

/** Forgets the refusals made before the latest press (the click now arriving is a later one); removes their notes from `container`. */
export function dropOlderLimitRefusals(container) {
  for (const [selector, r] of [...refusals]) {
    if (r.at >= presses) continue;
    refusals.delete(selector);
    container?.querySelectorAll?.(".limit-refused")?.forEach?.((n) => { if (n.dataset?.limitFor === selector) n.remove(); });
  }
}

/** Test hook: forgets everything held. */
export function resetLimitRefusals() {
  refusals.clear();
  presses = 0;
}

/** The note drawn beside a box whose text was refused, for the markup of the redrawn row; "" when none is held for `selector`. */
export function refusalNoteHtml(selector) {
  const r = refusals.get(selector);
  if (!r) return "";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<span class="limit-hint limit-bad cell-edit-error cell-not-saved limit-refused" data-limit-for="${esc(selector)}" role="status" title="${esc(r.sentence)}">${LIMIT_NOT_SAVED}</span>`;
}

function showNotSaved(el, ctx, text) {
  const sentence = ctx.refusalText?.(text) ?? `${LIMIT_NOT_SAVED}: ${LIMIT_BAD}`;
  refusals.set(ctx.selector, { sentence, at: presses });
  const cell = cellOf(el);
  if (!cell || !ctx.doc) return;
  const note = ctx.doc.createElement("span");
  note.className = "limit-hint limit-bad cell-edit-error cell-not-saved limit-refused";
  note.dataset.limitFor = ctx.selector;
  note.title = sentence;
  note.textContent = LIMIT_NOT_SAVED;
  cell.appendChild(note);
}

function beginOpen(el, ctx, start) {
  if (open && open.el === el && !open.done) return;
  open = { el, ctx, start: start ?? el.value, released: false, done: false };
  refusals.delete(ctx.selector); // he is at the box again: the earlier refusal is his to mend now
  showHint(el, LIMIT_HINT, false, ctx.doc);
}

function close(el, how) {
  const ed = open;
  if (!ed || ed.el !== el || ed.done || ed.released) return null;
  const ctx = ed.ctx;
  const decision = limitDecision(how, el.value, ed.start, ctx.parse);
  if (decision === "keep") {
    el.classList.add?.("invalid");
    showHint(el, LIMIT_BAD, true, ctx.doc);
    return decision;
  }
  ed.done = true;
  open = null;
  removeNotes(el);
  el.classList.remove?.("invalid");
  if (decision === "save") {
    const text = el.value.trim();
    el.value = text;
    refusals.delete(ctx.selector); // a good text mends an earlier refusal
    ctx.save(text);
    ctx.afterSave?.();
  } else {
    const typed = el.value;
    el.value = ed.start;
    if (decision === "notSaved") showNotSaved(el, ctx, typed);
  }
  return decision;
}

/** Wires one box. `ctx` = {save(text), parse(text), afterSave(), selector (finds this box again in a redrawn panel), doc, setTimer}. */
export function wireLimitBox(el, ctx) {
  ctxOf.set(el, ctx);
  el.addEventListener("focus", () => beginOpen(el, ctx));
  el.addEventListener("input", () => el.classList.toggle?.("invalid", Number.isNaN(ctx.parse(el.value))));
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    const decision = close(el, e.key === "Enter" ? "enter" : "escape");
    if (decision && decision !== "keep") el.blur?.();
  });
  el.addEventListener("blur", () => {
    if (el.isConnected === false) { // removed by something other than a redraw of the panel: gone, nothing written
      if (open && open.el === el) open = null;
      return;
    }
    close(el, "away"); // nothing when the box is not the open one (Enter or Esc already closed it)
  });
}

/** A Build is starting: the box that is open is read as a click away would read it (its text is saved, or a bad text is not and says so). */
export function flushOpenLimit() {
  if (open && !open.done && !open.released) close(open.el, "away");
}

/** The panel is about to be redrawn: the open box is taken out (its removal will not read as a click away) and what to put back is returned, or null. */
export function takeOpenLimit() {
  const ed = open;
  if (!ed || ed.done || ed.released) return null;
  ed.released = true;
  open = null;
  return { selector: ed.ctx.selector, text: ed.el.value, start: ed.start };
}

/** Puts a taken box back in the redrawn `container`: its text, focus and the hint. A box that is gone from the new panel is dropped with no write. */
export function restoreOpenLimit(container, carry) {
  if (!carry) return;
  const el = container.querySelector(carry.selector);
  const ctx = el ? ctxOf.get(el) : null;
  if (!el || !ctx) return;
  beginOpen(el, ctx, carry.start);
  el.value = carry.text;
  el.focus?.();
}
