// The pool rows' Lock, Exclude and In buttons, one look in the classic and Showdown Optimizers (optimizer standard round 3, "row controls
// are one form"): a small square button with a padlock, a cross or the word In, 23px wide so a row is no wider than before, the head over the
// column carrying the word (Lock, Exclude, In). The button's state is aria-pressed and the `active` class (accent for Lock and In, red for
// Exclude); its hover says what a press does. Markup only; each Optimizer passes its own data attributes and does its own wiring.
import { escapeHtml } from "./format.js";

/** The padlock, drawn in the text colour (the sketch's, approved 2026-10-19). */
export const LOCK_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><rect x="3" y="7" width="10" height="8" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`;

const FACES = Object.freeze({
  lock: { inner: LOCK_SVG, cls: "" },
  exclude: { inner: "&times;", cls: "" },
  in: { inner: "In", cls: " sd-row-in" },
});

/**
 * One row-control button. `kind`: "lock", "exclude" or "in"; `on`: pressed; `title`: the hover and the label; `attrs`: the caller's data
 * attributes, already escaped (data-action="row-lock" data-id="..."); `disabled`: off (a man who cannot take the control).
 * A pressed Exclude is red, a pressed Lock or In the accent colour.
 */
export function rowIconButtonHtml({ kind, on = false, title, attrs = "", disabled = false }) {
  const face = FACES[kind] ?? FACES.lock;
  const danger = kind === "exclude" && on ? " danger" : "";
  const t = escapeHtml(title);
  return `<button type="button" class="lineup-row-btn sd-row-ico row-ico${face.cls}${danger}${on ? " active" : ""}" ${attrs} aria-pressed="${on}" title="${t}" aria-label="${t}"${disabled ? " disabled" : ""}>${face.inner}</button>`;
}
