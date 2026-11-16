// A Load brings the lineup band into view (optimizer standard A12 and A15, round 5, both Optimizers): the band is the left column of the screen, its Clear lineup and Save row, the slots, the totals and (Showdown)
// the meter, which at 1760px and wider sticks under the filter bar while the pool runs beside it, and sits in the page above that. It is brought in whole, the Captain or the first slot and the Clear lineup and
// Save row included, under the sticky layers (the --filterbar-h of the panel), without the smooth scroll a redraw can interrupt; and once more a moment later, after the meter (which draws on its own answer) has
// changed the band's height. A band already wholly in the window is left where it is.
export const BAND_RECHECK_MS = 700;
let recheckMs = BAND_RECHECK_MS;
/** For tests: how long after a Load the band is checked once more. */
export const setBandRecheckMs = (ms) => { recheckMs = ms; };

/** How far the band's top must move to sit just under the sticky layers, or 0 when the whole band is already in the window. Pure: `rect` = {top, bottom}, `under` the sticky layers' height, `viewportH` the window's. */
export function bandScrollBy(rect, under, viewportH, gap = 8) {
  if (!rect) return 0;
  if (rect.top >= under && rect.bottom <= viewportH) return 0;
  return Math.round(rect.top - under - gap);
}

function underOf(panelEl) {
  return parseFloat(panelEl?.style?.getPropertyValue?.("--filterbar-h")) || 0;
}

function bring(container, panelEl) {
  const band = container?.querySelector?.(".lineup-left, .sd-opt"); // the Showdown's panel (.sd-opt) is the band since 2026-11-13
  if (!band || typeof window === "undefined") return;
  const by = bandScrollBy(band.getBoundingClientRect(), underOf(panelEl), window.innerHeight);
  if (by) window.scrollBy({ top: by, behavior: "instant" });
}

/** Brings the band in `container` into view now and once more after the meter has drawn. `panelId`: the panel whose --filterbar-h is the sticky layers' height. Never throws: a scroll is a convenience. */
export function showBand(container, panelId, { setTimer = setTimeout } = {}) {
  try {
    const panelEl = typeof document === "undefined" ? null : document.getElementById(panelId);
    bring(container, panelEl);
    const timer = setTimer(() => {
      try {
        bring(container, panelEl);
      } catch (e) {
        console.warn("Load: the band could not be scrolled into view", e);
      }
    }, recheckMs);
    timer?.unref?.(); // a convenience never keeps a process alive
  } catch (e) {
    console.warn("Load: the band could not be scrolled into view", e);
  }
}
