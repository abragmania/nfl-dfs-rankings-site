// The notice under the filter bar (optimizer standard A15, round 5, both Optimizers): there is no sticky Build button any more and the results sit directly below the player table, so what the Build row says
// while its button is off screen is said where he is looking. Three things, one place, the same words in both modes:
//   `Building...` with Stop, while a build runs (the working message and the Stop of lineup-stop.js, D15 and D18), shown only while the Build row is off screen;
//   `Build finished.` with a link to the results, when a build ends with its button off screen;
//   the build's failure, red (amber for a refusal), with a link to the Build row (D16), when a build fails with its button off screen.
// It is never drawn while the Build row is on screen (the row says it itself, beside its button), it goes when the row or the results come into view, when it is dismissed or its link is pressed, when the next
// build starts and when the slate changes. style.css makes it part of the sticky stack: it sits under the filter bar and the table head and the lineup band sit under it (--filterbar-h includes it).
// Pure helpers first (tests/build-notice.test.mjs), then the controller one Optimizer makes of them.
import { escapeHtml } from "./format.js";
import { BUILDING_LABEL, BUILDING_MESSAGE, STOP_LABEL, STOPPING_LABEL } from "./lineup-stop.js";

export const BUILD_FINISHED = "Build finished.";
export const SHOW_RESULTS = "Show results";
export const SHOW_BUILD_ROW = "Show Build row";

/** The words beside the Build button after a build: `Build finished.` and the link (the Optimizer wires `data-action` on its own redraw). */
export function doneNoteHtml(action) {
  return `<span class="opt-done" role="status">${BUILD_FINISHED} <button type="button" class="link-btn" data-action="${action}">${SHOW_RESULTS}</button></span>`;
}

/** Whether the Build button is off screen: a null rect (no button drawn), wholly above the filter bar's bottom edge, or wholly below the window. `rect` = {top, bottom} in window px. */
export function buttonOffScreen(rect, { barBottom = 0, viewportH }) {
  if (!rect) return true;
  return rect.bottom <= barBottom || rect.top >= viewportH;
}

/** Whether some of the results lie inside the window (below the filter bar): the notice has done its job once they do. */
export function resultsInView(rect, { barBottom = 0, viewportH }) {
  if (!rect) return false;
  return rect.top < viewportH * 0.85 && rect.bottom > barBottom;
}

/**
 * What the notice shows, or null. `building`: {canStop, stopping, stopError} while a build has run long enough to show its working message, else null; `latched`: what the last build left, {kind: "done"} or
 * {kind: "error", text, tone}, or null; `buildRowOff`: the Build button is off screen; `resultsVisible`: some of the results are in view. A running build is shown whenever the Build row is off screen; what a
 * finished one left only while it is, and `Build finished.` only until the results are in view.
 */
export function noticeView({ building = null, latched = null, buildRowOff, resultsVisible = false }) {
  if (building) return buildRowOff ? { kind: "building", canStop: Boolean(building.canStop), stopping: Boolean(building.stopping), stopError: building.stopError || "" } : null;
  if (!latched || !buildRowOff) return null;
  if (latched.kind === "done" && resultsVisible) return null;
  return latched;
}

/** The heights of the sticky stack under which the table head and the lineup band sit: `bar` the filter bar alone (the notice's own top), `total` the bar plus the notice while it shows. Zero where the bar is not sticky (a phone). Pure. */
export function stickyHeights({ sticky, barHeight, noticeShown, noticeHeight }) {
  const bar = sticky ? Math.ceil(barHeight || 0) : 0;
  const extra = sticky && noticeShown ? Math.ceil(noticeHeight || 0) : 0;
  return { bar, total: bar + extra };
}

/** The notice's markup for a view. */
export function noticeHtml(view) {
  const close = `<button type="button" class="link-btn" data-notice="close" aria-label="Dismiss">&times;</button>`;
  if (view.kind === "building") {
    const stop = view.canStop ? `<button type="button" class="link-btn build-notice-stop" data-notice="stop"${view.stopping ? " disabled" : ""}>${view.stopping ? STOPPING_LABEL : STOP_LABEL}</button>` : "";
    const error = view.stopError ? `<span class="build-notice-error" role="alert">${escapeHtml(view.stopError)}</span>` : "";
    return `<span>${BUILDING_LABEL}</span> <span class="build-notice-sub">${BUILDING_MESSAGE}</span> ${stop}${error}`;
  }
  if (view.kind === "error") return `<span class="build-notice-text" role="alert">${escapeHtml(view.text)}</span> <button type="button" class="link-btn" data-notice="jump">${SHOW_BUILD_ROW}</button> ${close}`;
  return `<span>${BUILD_FINISHED}</span> <button type="button" class="link-btn" data-notice="jump">${SHOW_RESULTS}</button> ${close}`;
}

/** The class the notice element carries for a view: its kind, and for a failure the tone (a refusal is amber, a failure red). */
export const noticeClass = (view) => `build-notice is-${view.kind}${view.kind === "error" ? (view.tone === "warn" ? " is-warn" : " is-failed") : ""}`;

const rectOf = (el) => {
  const r = el?.getBoundingClientRect?.();
  return r ? { top: r.top, bottom: r.bottom } : null;
};

/**
 * One Optimizer's notice. `noticeEl()`: the notice element (sticky under the filter bar); `barBottom()`: the filter bar's bottom edge in window px; `buildButton()` and `resultsEl()`: the Build button and the results,
 * looked up when needed (the panel is redrawn); `building()`: the Optimizer's running state for noticeView; `jumpResults()` and `jumpBuild()`: take him there; `stop()`: the same Stop the Build row's button does.
 * `refresh()` is called after every draw of the panel and on scroll; `finish({built, error, tone})` when a build ends; `reset()` when a build starts or the slate changes.
 */
export function createNoticeController({ noticeEl, barBottom, buildButton, resultsEl, building, jumpResults, jumpBuild, stop }) {
  let latched = null;
  let shown = "";
  let frame = 0;
  let listening = false;

  function measure() {
    const view = { barBottom: barBottom(), viewportH: window.innerHeight };
    return { buildRowOff: buttonOffScreen(rectOf(buildButton()), view), resultsVisible: resultsInView(rectOf(resultsEl()), view) };
  }

  function refresh() {
    const el = noticeEl();
    if (!el || typeof window === "undefined") return;
    const { buildRowOff, resultsVisible } = measure();
    if (latched && (!buildRowOff || (latched.kind === "done" && resultsVisible))) latched = null; // the Build row is on screen, or the results are: nothing left to say
    const view = noticeView({ building: building(), latched, buildRowOff, resultsVisible });
    const key = view ? JSON.stringify(view) : "";
    if (key === shown) return;
    shown = key;
    if (!view) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.className = noticeClass(view);
    el.innerHTML = noticeHtml(view);
    el.hidden = false;
    const wire = (name, fn) => el.querySelector(`[data-notice='${name}']`)?.addEventListener("click", fn);
    wire("jump", () => {
      const jump = latched?.kind === "error" ? jumpBuild : jumpResults;
      latched = null;
      refresh();
      jump();
    });
    wire("close", () => {
      latched = null;
      refresh();
    });
    wire("stop", () => stop());
    if (!listening) {
      listening = true;
      window.addEventListener("scroll", () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; refresh(); });
      }, { passive: true });
    }
  }

  return {
    refresh,
    /** A build ended: what it left is shown if its Build button is off screen. */
    finish({ built = false, error = "", tone = "error" } = {}) {
      latched = built ? { kind: "done" } : error ? { kind: "error", text: error, tone } : null;
      refresh();
    },
    /** A build started, or the slate changed: what the last build left goes. */
    reset() {
      latched = null;
      refresh();
    },
  };
}
