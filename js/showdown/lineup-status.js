// The Showdown builder's status block under the six slots (split out of lineup.js to keep it under its line cap): the both-teams line, the message a
// pool-row click made, Save's messages and the one-lineup Build's answer. Every function takes lineup.js's `state` as a parameter; markup only.
// Standard A14 (2026-11-03): the click's message sits beside the clicked pool row (row-message.js); it is said here only when no row now shown
// carries it, and red is for a failure only.
import { statusLineHtml, TONE_WARN, TONE_NOTICE } from "../row-message.js";
import { findRow } from "./lineup-saved.js";

export const BUILD_STATUS_ID = "sd-build-status"; // the block's id: a pool repaint (a filter) redraws it so the click's message is never lost or doubled

// D39: both teams required. Reports which of the game's two teams are (not yet) represented among the
// six placed players; blank/neutral until at least one player is placed.
export function bothTeamsText(board, { cpt, flex }) {
  const away = board?.game?.away;
  const home = board?.game?.home;
  if (!away || !home) return "";
  const ids = [cpt?.id, ...flex.map((s) => s?.id)].filter(Boolean);
  const teams = new Set(ids.map((id) => findRow(board, id)?.team).filter(Boolean));
  if (teams.size === 0) return `Both teams required: ${away} and ${home}.`;
  const missing = [away, home].filter((t) => !teams.has(t));
  if (missing.length === 0) return `Both teams required: satisfied (${away} and ${home} both in the lineup).`;
  return `Both teams required: ${missing.join(", ")} not in the lineup yet.`;
}

/** { id, text, tone } when a pool row's click made state.addError, else null: what the pool draws beside that row. */
export function addMessageOf(state) {
  return state.addError && state.addErrorId != null ? { id: state.addErrorId, text: state.addError, tone: TONE_WARN } : null;
}

/** Whether a row of `rows` (the pool's rows now shown) carries the click's message, so it is not also said under the slots. */
export function messageRowShown(state, rows) {
  return Boolean(addMessageOf(state)) && (rows ?? []).some((r) => String(r.id) === String(state.addErrorId));
}

/** The block's inside; `addInRow`: a row of the pool on screen carries the click's message. */
export function statusBlockHtml(board, state, addInRow = false) {
  const parts = [statusLineHtml(bothTeamsText(board, state), TONE_NOTICE)];
  if (state.addError && !addInRow) parts.push(statusLineHtml(state.addError, TONE_WARN));
  if (state.saveError) parts.push(statusLineHtml(state.saveError, state.saveTone));
  else if (state.saveConfirm) parts.push(statusLineHtml(state.saveConfirm, TONE_NOTICE));
  const r = state.lastResult;
  if (r) {
    if (!r.feasible) parts.push(statusLineHtml(r.message || "No legal lineup could be built.", r.tone ?? "error"));
    else parts.push(...[r.builtOn, r.message].filter(Boolean).map((t) => statusLineHtml(t, TONE_NOTICE)));
  }
  return parts.join("");
}
