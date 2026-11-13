// The pool rows' Lock, Exclude and In buttons, the classic pool's own look since 2026-11-13 (look-row.js LOCK_ICON and EXCLUDE_ICON, the classes `lk` and `ex` the look sheet styles, `on` when pressed): a small square
// button with a padlock, the circle-slash or the word In, the head over the column carrying the word (Lock, Exclude, In). The button's state is aria-pressed and the `on` class (green for Lock and
// Exclude's red, amber for In); its hover says what a press does. Markup only; each Optimizer passes its own data attributes and does its own wiring.
import { escapeHtml } from "./format.js";
import { LOCK_ICON, EXCLUDE_ICON } from "./look-row.js";

/** The padlock, drawn in the text colour (the sketch's, approved 2026-10-19): the small one beside a locked man's name. */
export const LOCK_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><rect x="3" y="7" width="10" height="8" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`;

const FACES = Object.freeze({
  lock: { inner: LOCK_ICON, cls: " lk" },
  exclude: { inner: EXCLUDE_ICON, cls: " ex" },
  in: { inner: "In", cls: " sd-row-in" },
});

/**
 * One row-control button. `kind`: "lock", "exclude" or "in"; `on`: pressed; `title`: the hover and the label; `attrs`: the caller's data
 * attributes, already escaped (data-action="row-lock" data-id="..."); `disabled`: off (a man who cannot take the control).
 */
export function rowIconButtonHtml({ kind, on = false, title, attrs = "", disabled = false }) {
  const face = FACES[kind] ?? FACES.lock;
  const t = escapeHtml(title);
  return `<button type="button" class="row-ico${face.cls}${on ? " on" : ""}" ${attrs} aria-pressed="${on}" title="${t}" aria-label="${t}"${disabled ? " disabled" : ""}>${face.inner}</button>`;
}
