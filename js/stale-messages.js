// Stale messages (optimizer standard A14 follow-up, round 3 fix batch item 17): the one-shot sentences a click leaves (`Saved "..."`, the Download DK CSV status, a
// pool click's `FLEX is full; ...` or refusal) go at the next click on any control, not only at a slot, mode or game change. One capture-phase click listener per panel
// container runs BEFORE the clicked control's own handler, so the click that makes a new message is never the click that removes it. The classic and Showdown panels
// pass what to clear; the page's matching nodes go at once too (a click that does not redraw would otherwise leave them on screen).
const wired = new WeakSet();

/** `hasAny()`: whether any such message is held; `clear()`: forgets them in the panel's state; `selector`: the nodes that show them, removed from the page now. */
export function wireStaleMessages(container, { hasAny, clear, selector, press = null }) {
  if (!container || typeof container.addEventListener !== "function" || wired.has(container)) return;
  wired.add(container);
  if (press) container.addEventListener("mousedown", press, true); // a press begins before its blur and its click: messages made by that blur belong to it (limit-box.js)
  container.addEventListener("click", () => {
    if (!hasAny()) return;
    clear();
    container.querySelectorAll?.(selector)?.forEach?.((node) => node.remove());
  }, true);
}
