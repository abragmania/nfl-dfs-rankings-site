// How the Optimizer reaches the Lineups tab without importing the page controller (view.js registers the opener): the "N lineups built: open Lineups" button and a Load back to the Optimizer.
let opener = null;
let wantedView = null; // the Lineups tab's switch ("recent" or "saved") the next draw starts on

export function setTabOpener(fn) {
  opener = typeof fn === "function" ? fn : null;
}

/** Opens a Showdown tab by its key ("lineup", "lineups"); nothing when the page controller has not registered. */
export function openShowdownTabKey(tab) {
  opener?.(tab);
}

/** Opens Lineups on Recently generated. */
export function openLineupsRecent() {
  wantedView = "recent";
  openShowdownTabKey("lineups");
}

/** The view a button asked for, once. */
export function takeWantedView() {
  const v = wantedView;
  wantedView = null;
  return v;
}
