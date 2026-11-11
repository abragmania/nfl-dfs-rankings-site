// The Showdown builder's status block under the six slots (split out of lineup.js to keep it under its line cap): the message a
// pool-row click made and Save's messages. Every function takes lineup.js's `state` as a parameter; markup only.
// Standard A14 (2026-11-03): the click's message sits beside the clicked pool row (row-message.js); it is said here only when no row now shown
// carries it, and red is for a failure only.
import { statusLineHtml, TONE_WARN, TONE_NOTICE } from "../row-message.js";

export const BUILD_STATUS_ID = "sd-build-status"; // the block's id: a pool repaint (a filter) redraws it so the click's message is never lost or doubled

// Item 7 (Adam 2:59 PM 11-11, "i dont need boiler plate"): the "Both teams required: ..." line is gone; D39's rule is still enforced by the Build and the save checks.

/** { id, text, tone } when a pool row's click made state.addError, else null: what the pool draws beside that row. */
export function addMessageOf(state) {
  return state.addError && state.addErrorId != null ? { id: state.addErrorId, text: state.addError, tone: state.addTone ?? TONE_WARN } : null;
}

/** Whether a row of `rows` (the pool's rows now shown) carries the click's message, so it is not also said under the slots. */
export function messageRowShown(state, rows) {
  return Boolean(addMessageOf(state)) && (rows ?? []).some((r) => String(r.id) === String(state.addErrorId));
}

/** The block's inside; `addInRow`: a row of the pool on screen carries the click's message. */
export function statusBlockHtml(board, state, addInRow = false) {
  const parts = [];
  if (state.addError && !addInRow) parts.push(statusLineHtml(state.addError, state.addTone ?? TONE_WARN));
  if (state.saveError) parts.push(statusLineHtml(state.saveError, state.saveTone));
  else if (state.saveConfirm) parts.push(statusLineHtml(state.saveConfirm, TONE_NOTICE));
  return parts.join("");
}
