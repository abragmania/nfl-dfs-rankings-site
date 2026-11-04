// A build that has run a second: the working message and, where it can be stopped, the Stop button, as one group left of the Build or Make button, whose
// busy label sits over its idle one so it keeps its width. Classic's footer and Showdown's Make row (Adam 2026-11-02). A shorter build shows
// none of it, so nothing on screen moves, and a second click on the button cannot land on a Stop.
// The words are optimizer standard D15 and D18 (2026-11-03): after a second the button reads "Building...", the message "Finding the best
// lineups" (no "(N of M)": neither NFL build reports progress), the button "Stop", then "Stopping..." once it is pressed; a Stop the server
// did not hear shows "Could not reach the server to stop. The build is still running." under it.
import { escapeHtml } from "./format.js";

export const BUILDING_SHOW_MS = 1000;
export const BUILDING_LABEL = "Building...";
export const BUILDING_MESSAGE = "Finding the best lineups";
export const STOP_LABEL = "Stop";
export const STOPPING_LABEL = "Stopping...";
export const STOP_FAILED_TEXT = "Could not reach the server to stop. The build is still running.";
export const STOP_REFUSED_TEXT = "The server refused the stop. The build is still running."; // the stop was answered with ok: false

/** The sentence for a Stop that did not take, or "" when it did: `thrown` (the request failed) or an answer saying ok: false. Pure. */
export function stopFailure({ thrown = false, data = null } = {}) {
  if (thrown) return STOP_FAILED_TEXT;
  return data?.ok === false ? STOP_REFUSED_TEXT : "";
}

/** Calls `show` once a build has run BUILDING_SHOW_MS; returns the function that cancels it. Timers are a test's to replace. */
export function afterBuildingDelay(show, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const timer = setTimer(show, BUILDING_SHOW_MS);
  return () => clearTimer(timer);
}

/** True when the idle row has the button on a line of its own under a long summary: a build then keeps that layout, its group beside the button. */
export function goSitsBelow(goButton, summary) {
  if (!goButton || !summary) return false;
  return goButton.getBoundingClientRect().top >= summary.getBoundingClientRect().bottom - 1;
}

/** The row's class while `showing`: one line, the summary giving up the room, or the button's own line under the summary. */
export function buildingRowClass({ showing, below }) {
  if (!showing) return "";
  return below ? " is-building-below" : " is-building";
}

/** The button's label: its idle words, or while `showing` its busy words over them, hidden, so its width does not change. */
export function goLabelHtml({ showing, idle, busy = BUILDING_LABEL }) {
  if (!showing) return escapeHtml(idle);
  return `<span class="opt-go-hold">${escapeHtml(idle)}</span><span class="opt-go-now">${escapeHtml(busy)}</span>`;
}

/** The group left of the button while `showing`; `stopId`: the Stop button's id; `stopping`: Stop was pressed and the build is ending
 *  (the button reads "Stopping..." and is off); `stopError`: the sentence for a Stop the server did not hear, under the button. */
export function buildingHtml({ showing, canStop, stopId, stopping = false, stopError = "" }) {
  if (!showing) return "";
  const button = canStop
    ? `<button type="button" id="${stopId}" class="lineup-build-btn opt-go opt-go-big opt-stop" title="Stop and keep the lineups finished so far"${stopping ? " disabled" : ""}>${stopping ? STOPPING_LABEL : STOP_LABEL}</button>`
    : "";
  // The line is a sibling of the group, not inside it: style.css gives it a full-width line of its own under the whole build row, so the message
  // is never cut and Stop stays level with Building....
  const error = stopError ? `<span class="lineup-status lineup-status-error opt-stop-error" role="alert">${escapeHtml(stopError)}</span>` : "";
  return `<span class="opt-building"><span class="lineup-status">${BUILDING_MESSAGE}</span>${button}</span>${error}`;
}
