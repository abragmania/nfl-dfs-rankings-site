// Short messages on the optimizers (optimizer standard A14, 2026-11-03): a message that answers a click on a player's row or a slot sits
// beside that row or slot; one with no clicked row sits where it always sat. Red is for errors only (a lost connection, a build or save that
// failed outright): a notice or a refusal (a slot that is full, a lineup with nobody in it, a bad Max % box, a blocked Cash basis, the server
// refusing the settings or a build already running) is amber or plain, never red. The classic and Showdown optimizers both draw their messages here.
import { escapeHtml } from "./format.js";

export const TONE_ERROR = "error";
export const TONE_WARN = "warn";
export const TONE_NOTICE = "notice";

/** The error codes of an answer that is the server refusing a request (its settings, a build already running, nothing ready yet): the
 *  sentence says what to change, so it is amber. Any other code (a build that failed, an unreadable file) and a lost connection are errors. */
export const REFUSAL_CODES = Object.freeze(["VALIDATION_ERROR", "GENERATE_BUSY", "NOT_READY", "BAD_REQUEST"]);

/** The tone for a failed answer with error code `code`: amber for a refusal, red for a failure. */
export function answerTone(code) {
  return REFUSAL_CODES.includes(code) ? TONE_WARN : TONE_ERROR;
}

/** The tone a message is drawn in: anything but "error" or "notice" is amber, so a typo can never turn a notice red. */
export function toneOf(tone) {
  return tone === TONE_ERROR || tone === TONE_NOTICE ? tone : TONE_WARN;
}

/** The extra class a status line takes for `tone` (style.css .lineup-status-error is red, .lineup-status-warning amber); "" for a plain notice. */
export function statusToneClass(tone) {
  const t = toneOf(tone);
  return t === TONE_ERROR ? " lineup-status-error" : t === TONE_WARN ? " lineup-status-warning" : "";
}

/** A status line in the place messages have always had (under the slots, the head, the results). */
export function statusLineHtml(text, tone = TONE_NOTICE, extraClass = "") {
  return `<div class="lineup-status${statusToneClass(tone)}${extraClass ? ` ${extraClass}` : ""}">${escapeHtml(text)}</div>`;
}

/** The message beside a clicked row: a short line under the name in the row's Player cell, in `tone`. "" for no text. */
export function rowMessageHtml(text, tone = TONE_WARN) {
  if (!text) return "";
  return `<span class="row-msg row-msg-${toneOf(tone)}" role="status">${escapeHtml(text)}</span>`;
}

/** Whether a message names row `id` (a click on that row made it); ids compare as text. */
export function messageIsFor(message, id) {
  return Boolean(message && message.text && message.id != null && String(message.id) === String(id));
}
