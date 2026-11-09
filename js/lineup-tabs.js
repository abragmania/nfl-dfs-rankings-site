// The classic Optimizer's GPP and Cash tabs (optimizer standard Part F, Adam 5:12 PM 2026-11-04; the Showdown's showdown/optimizer-tabs.js, the pattern): what each tab keeps for itself besides its
// lineup, locks and excludes (memory.js per slate and mode) and its settings: the batch it built, the messages and filter that belong to that batch and which of New or Saved it shows. lineup.js makes these fields of
// `opt` properties that read and write the tab on screen (`opt.tabs[opt.mode]`); a build that ends after a tab switch writes to the tab it was made for (lineup-optimizer.js doGenerate). Page-only, like the batch.
import { newTab, bindTabFields } from "./showdown/optimizer-tabs.js";

/** One tab with nothing built: the Showdown's fields (the batch, its messages and filter) and which of New or Saved it shows (D74). */
export function newClassicTab() {
  return { ...newTab(), resultsTab: null };
}

/** Both tabs, each with nothing built. */
export function newClassicTabs() {
  return { gpp: newClassicTab(), cash: newClassicTab() };
}

/** Makes each per-tab field a property of `opt` that reads and writes the tab on screen. */
export function bindClassicTabFields(opt) {
  bindTabFields(opt, { modeOf: (o) => o.mode, blank: newClassicTab });
}

/** Every tab's built lineups and their messages go (a new week or another slate; D57: new lineups belong to the slate they were made for). */
export function clearTabBuilds(opt) {
  for (const tab of Object.values(opt.tabs)) Object.assign(tab, { results: null, doneNote: false, error: null, saveError: null });
}

/** Every tab's "only lineups with" filter goes (a new week or another slate). */
export function clearTabFilters(opt) {
  for (const tab of Object.values(opt.tabs)) Object.assign(tab, { mustHave: [], mustHaveNames: {} });
}

// app.js's gate on a GPP | Cash click (as the Showdown's setTabSwitchGate): it switches at once when the tab's board is already kept, else reads it first and says so if it cannot.
let tabSwitchGate = null;
/** `fn(next, apply)`: `apply()` makes the switch (lineup.js setMode). */
export function setTabSwitchGate(fn) {
  tabSwitchGate = typeof fn === "function" ? fn : null;
}

/** A GPP | Cash click: through the gate when the page has one (the board comes on screen with it), else straight away (a page or test with no boards). */
export function requestTab(next, apply) {
  if (tabSwitchGate) tabSwitchGate(next, apply);
  else apply();
}
