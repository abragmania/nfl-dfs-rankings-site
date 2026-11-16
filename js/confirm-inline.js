// The one confirm both Optimizers use (optimizer standard round 3: B13, A6, A12, C11): the question and a Yes and a No float right under the
// control that asked, in the page, so Adam sees what he is confirming and the screen can be shot with it open. The box is positioned (style.css
// .confirm-anchor), so it never grows the bar or the row it sits in and never shifts the page. Two ways to draw it: confirmHtml, markup a panel puts in
// its own template (inside anchorHtml's wrapper) while its state says a confirm is open (the panel redraws, so the state survives), and askInline, for a
// control outside any redrawn panel (the filter bar's Reset all overrides): it opens the same box after the control. Yes and No are real buttons, in the
// tab order right after the control, and the safe one (No) takes the focus. Esc and a click anywhere outside the box close every kind of confirm alike
// (onConfirmDismiss: one pair of page listeners serves them all, and each ask removes the last one's). The question's words are the standard's, passed in.
import { escapeHtml } from "./format.js";

// The standard's words, one copy for the classic and Showdown Optimizers (B13, C11, A12).
export const CLEAR_QUESTION = "Clear the lineup?";
export const REPLACE_QUESTION = "Replace your working lineup?";
export const DELETE_QUESTION = "Delete this saved lineup?";

/** The confirm's markup. `data` is added as data-confirm-for so a panel can tell which confirm a button belongs to. */
export function confirmHtml(question, { data = "", yes = "Yes", no = "No" } = {}) {
  const forAttr = data ? ` data-confirm-for="${escapeHtml(data)}"` : ""; // on the buttons too, so a click handler needs no lookup of the box around it
  return `<span class="inline-confirm" role="alertdialog" aria-label="${escapeHtml(question)}"${forAttr}><span class="inline-confirm-text">${escapeHtml(question)}</span><button type="button" class="saved-lineup-mini-btn danger" data-confirm="yes"${forAttr}>${escapeHtml(yes)}</button><button type="button" class="saved-lineup-mini-btn" data-confirm="no"${forAttr}>${escapeHtml(no)}</button></span>`;
}

/** A control and the confirm that may hang under it, in the wrapper the box is positioned against. `buttonHtml`: the control; `boxHtml`: confirmHtml's or "". */
export function anchorHtml(buttonHtml, boxHtml = "", { align = "right" } = {}) {
  return `<span class="confirm-anchor confirm-${align}">${buttonHtml}${boxHtml}</span>`;
}

const INSIDE = ".inline-confirm, .saved-lineup-confirm";
const pages = new Map(); // doc -> {fns: Set, onKey, onAway}

/**
 * Registers `dismiss()` to run when Esc is pressed or the page is clicked outside every open confirm box (the box's own buttons are inside). One pair of
 * page listeners per page serves all registrations and goes when the last one does. Returns the function that unregisters. `doc` is the page (a test passes a stand-in).
 */
export function onConfirmDismiss(dismiss, doc = document) {
  if (typeof doc?.addEventListener !== "function") return () => {}; // a test's stand-in page has none
  let page = pages.get(doc);
  if (!page) {
    page = { fns: new Set() };
    page.onKey = (ev) => {
      if (ev.key === "Escape") for (const fn of [...page.fns]) fn();
    };
    page.onAway = (ev) => {
      if (ev.target?.closest?.(INSIDE)) return;
      for (const fn of [...page.fns]) fn();
    };
    doc.addEventListener("keydown", page.onKey, true);
    doc.addEventListener("click", page.onAway, true); // on the click, not the press: a panel that redraws on the press would swallow the click that follows
    pages.set(doc, page);
  }
  page.fns.add(dismiss);
  return () => {
    page.fns.delete(dismiss);
    if (page.fns.size === 0 && pages.get(doc) === page) {
      doc.removeEventListener("keydown", page.onKey, true);
      doc.removeEventListener("click", page.onAway, true);
      pages.delete(doc);
    }
  };
}

/** Puts the keyboard on the open confirm's safe button (No), so Tab and Enter work from the box at once. A page without a box does nothing. */
export function focusConfirm(root) {
  root?.querySelector?.("[data-confirm='no']")?.focus?.();
}

let openAsk = null; // the confirm askInline has open: {close}

/**
 * Opens the confirm under `anchor`; `onYes()` runs on Yes. The anchor sits in a .confirm-anchor wrapper (made here when its markup has none), so the box
 * floats against it. A second ask, on any anchor, closes the first with its listeners. Closes on No, Esc or a click outside. Returns the function that
 * closes it. `doc` is the page (a test passes a stand-in). `align`: "right" (the box ends at the control's right edge) or "left".
 */
export function askInline(anchor, question, onYes, { doc = document, yes, no, align = "right" } = {}) {
  openAsk?.close();
  const holder = doc.createElement("span");
  holder.innerHTML = confirmHtml(question, { yes, no });
  const box = holder.firstElementChild ?? holder.children?.[0];
  let wrap = anchor.parentNode;
  if (!wrap?.classList?.contains?.("confirm-anchor")) {
    const made = doc.createElement("span");
    made.className = `confirm-anchor confirm-${align}`;
    anchor.parentNode?.insertBefore?.(made, anchor);
    made.appendChild(anchor);
    wrap = made;
  }
  wrap.appendChild(box);
  let stop = () => {};
  const mine = {
    close: () => {
      box.remove();
      stop();
      if (openAsk === mine) openAsk = null;
    },
  };
  stop = onConfirmDismiss(mine.close, doc);
  openAsk = mine;
  box.querySelector("[data-confirm='yes']")?.addEventListener("click", () => {
    mine.close();
    onYes();
  });
  box.querySelector("[data-confirm='no']")?.addEventListener("click", mine.close);
  focusConfirm(box);
  return mine.close;
}
