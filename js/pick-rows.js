// Click-to-pick, the one wiring both Optimizers use (D39, D81; Adam 4:45 PM 2026-10-29 for Showdown: "if I click a player's row he goes
// into the lineup, if I click it again he's out of the lineup ... I don't want the tiny add/clear buttons"; 5:00 PM: the same in classic).
// A pool row or a filled slot card is clicked, or Enter / Space pressed on it while it has the focus, to put its man in or take him out;
// a click inside one of its own controls, the padding around them or his name (which opens the player card) is that control's, never a
// pick. Each caller passes its own skip selectors (they name its own class names) and draws its own markup (data-pick, tabindex, title,
// aria-label); what a pick does stays with the caller (Showdown's pool.js poolPickAction, classic's lineup.js pickPoolRow).

/** A filled slot card's own targets: his name opens his card; a button, link or box inside keeps its own job. */
export const SLOT_PICK_SKIP = "button, a, input, .opt-p-name";

/** Wires one clickable element: a click outside `skip` (a click with no target is a pick), or Enter / Space with the element itself as the
 *  target (a key pressed in a child box is the box's; the page does not scroll), calls act(). */
export function wirePick(el, skip, act) {
  el.addEventListener("click", (ev) => {
    if (!ev?.target?.closest?.(skip)) act();
  });
  el.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target === el) {
      ev.preventDefault?.();
      act();
    }
  });
}

/** Wires every row under `root` that carries data-pick: a pick calls pick(id, action) with the row's data-id and data-pick (the action
 *  the caller drew for it). */
export function wirePickRows(root, skip, pick) {
  root.querySelectorAll("[data-pick]").forEach((tr) => wirePick(tr, skip, () => pick(tr.dataset.id, tr.dataset.pick)));
}
