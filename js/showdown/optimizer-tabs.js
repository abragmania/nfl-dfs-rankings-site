// What each Optimizer tab (GPP, Cash) keeps for itself besides its settings (optimizer-state.js) and its seats (tab-seats.js): the batch it built and the messages and filter that belong to
// that batch (optimizer standard Part F, Adam 5:12 PM 2026-11-04: separate tabs, so a build on one never touches the other). optimizer.js reads and writes these through `opt.results`,
// `opt.error` and the rest, which bindTabFields makes the on-screen tab's; a build that ends after a tab switch writes to the tab it was made for (optimizer.js doGenerate). Page-only, like the batch.

/** A tab with nothing built. */
export const newTab = () => ({
  results: null, // the batch on screen, see optimizer.js doGenerate
  doneNote: false, // a build has ended and its results are on screen: `Build finished.` and its link sit beside the Build button
  error: null, // the server's sentence for a refused or failed Make
  errorTone: "error", // "warn" for a build already running (a notice, not a failure), else "error"
  formError: null, // a box that is not a percent: blocks Make
  saveError: null,
  saveTone: "error", // "warn" when saveError is only "N saved, M already saved", else "error"
  mustHave: [], // the "only lineups with" keys, in the order chosen (D77); hides and never deletes
  mustHaveNames: {}, // key -> the chip's words
});

export const newTabs = () => ({ gpp: newTab(), cash: newTab() });

/** The tab a mode name means ("cash", anything else GPP). */
export const tabName = (mode) => (mode === "cash" ? "cash" : "gpp");

/** Makes each per-tab field a property of `opt` that reads and writes the tab on screen (`opt.tabs[opt.ks.mode]`). The classic Optimizer's differ only by where its mode is kept (`modeOf`) and one more field (`blank`). */
export function bindTabFields(opt, { modeOf = (o) => o.ks?.mode, blank = newTab } = {}) {
  for (const field of Object.keys(blank())) {
    Object.defineProperty(opt, field, {
      enumerable: true,
      configurable: true,
      get: () => opt.tabs[tabName(modeOf(opt))][field],
      set: (value) => { opt.tabs[tabName(modeOf(opt))][field] = value; },
    });
  }
}
