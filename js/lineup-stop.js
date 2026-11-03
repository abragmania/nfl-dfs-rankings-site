// A build that has run a second: the working message and, where it can be stopped, the Stop button, as one group left of the Build or Make button, whose
// busy label sits over its idle one so it keeps its width. Classic's footer and Showdown's Make row (Adam 2026-11-02). A shorter build shows
// none of it, so nothing on screen moves, and a second click on the button cannot land on a Stop.
import { escapeHtml } from "./format.js";

export const BUILDING_SHOW_MS = 1000;

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
export function goLabelHtml({ showing, idle, busy }) {
  if (!showing) return escapeHtml(idle);
  return `<span class="opt-go-hold">${escapeHtml(idle)}</span><span class="opt-go-now">${escapeHtml(busy)}</span>`;
}

/** The group left of the button while `showing`; `stopId`: the Stop button's id. */
export function buildingHtml({ showing, canStop, stopId }) {
  if (!showing) return "";
  const stop = canStop ? `<button type="button" id="${stopId}" class="lineup-build-btn opt-go opt-go-big opt-stop" title="Stop and keep the lineups finished so far">Stop</button>` : "";
  return `<span class="opt-building"><span class="lineup-status">Finding the best lineups</span>${stop}</span>`;
}
