// Sizes every ".scroll-panel" table to the room left below it (moved out of public/app.js unchanged; a leaf module that imports nothing from app.js).
import { phoneMinHeight, panelMinHeight } from "./expand.js";

// Whole-row snapping by geometry rather than by one row's height (👁 visual-qa fourth/fifth pass): finds
// the last tbody row whose bottom edge actually fits within the available height and snaps the panel's
// max-height to that row's bottom, so a row that renders taller/shorter than another (wrapped text,
// badges, etc.) never leaves a partial row peeking out at the bottom. `panelEl.offsetHeight -
// panelEl.clientHeight` is added back on as the panel's own border/scrollbar allowance. Falls back to the
// previous head+available calc() only when the panel has no tbody rows yet (e.g. an empty table).
//
// This exact function also lives in public/js/lineup.js as resizeLineupScrollPanels's per-panel sizing
// step. It isn't imported from here because app.js is the page's entry module (never imported by anyone
// else) while lineup.js is imported by tabs.js which app.js itself imports — importing app.js back into
// lineup.js would make that a circular module dependency. Duplicated on purpose; keep both in sync.
function snapPanelMaxHeight(panelEl, top, reserve) {
  // Layout round 2, 2026-10-17: a panel in a hidden tab reads every rect as 0 and would be sized to 0px: leave it alone.
  if (panelEl.getClientRects().length === 0) return;
  // Layout round 2, 2026-10-17: the room is measured from the panel's place in the document (docTop), not its place
  // in the window, so a page scrolled past the panel's top (a negative `top`) sizes it exactly as an unscrolled page
  // does; nothing is stored, so nothing goes stale (same as lineup.js).
  const docTop = top + window.scrollY;
  // On a phone (max-width 700px) the table gets at least 70% of the window's height, however much of the page
  // sits above it (Adam, 2026-10-10: the list showed about three rows); the page scrolls to reach it. Wider
  // windows size exactly as before. window.innerHeight is the dynamic viewport height (what dvh measures).
  const phoneMin = Math.max(phoneMinHeight(), panelMinHeight(panelEl, top)); // the Optimizer pool's floor too (expand.js)
  const available = Math.max(window.innerHeight - docTop - reserve, phoneMin);
  const rows = panelEl.querySelectorAll("tbody tr");
  const borderAllowance = panelEl.offsetHeight - panelEl.clientHeight;
  if (rows.length === 0) {
    panelEl.style.maxHeight = phoneMin
      ? `${Math.max(Math.round(window.innerHeight - docTop - reserve), phoneMin)}px`
      : `calc(100vh - ${Math.round(docTop)}px - ${Math.round(reserve)}px)`;
    return;
  }
  let lastFitBottom = null;
  rows.forEach((row) => {
    const bottomOffset = row.getBoundingClientRect().bottom + window.scrollY - docTop; // the row's bottom below the panel's top
    if (bottomOffset <= available) lastFitBottom = bottomOffset;
  });
  if (lastFitBottom == null) {
    // Not even one body row fits: show through the header only rather than clip a partial row.
    const theadEl = panelEl.querySelector("thead");
    lastFitBottom = theadEl ? theadEl.getBoundingClientRect().bottom + window.scrollY - docTop : 0;
  }
  panelEl.style.maxHeight = `${Math.floor(lastFitBottom + borderAllowance)}px`;
}

// Keeps the table's own scroll area sized to whatever room is actually left below it, instead of a
// fixed CSS height that only fit one particular window size (👁 visual-qa: at 1366x768 a fixed height
// left just four rows visible). Every ".scroll-panel" (the rankings table plus the Projections/
// Ownership tabs' tables) gets the same treatment.
export function adjustScrollPanels() {
  document.querySelectorAll(".scroll-panel").forEach((panelEl) => {
    const top = panelEl.getBoundingClientRect().top;
    // Optimizer-first step 4: the ranked list under the builder is not sized to the room below it (that is the whole page) but
    // to 60% of the window, 420px at least, snapped to whole rows: the reserve is chosen so the room snapPanelMaxHeight sees is that height.
    // The Showdown Optimizer's player pool under its builder (#sd-pool, 2026-10-26, D81) is sized the same way.
    if (panelEl.closest("#ranked-list") || panelEl.closest("#sd-pool")) {
      const target = Math.max(420, window.innerHeight * 0.6);
      snapPanelMaxHeight(panelEl, top, window.innerHeight - (top + window.scrollY) - target);
      return;
    }
    // The rankings table's legend line sits right below .table-wrap; if its height isn't reserved here
    // the table claims that room too, slicing the legend and forcing a second page-level scrollbar (👁
    // visual-qa). Every other .scroll-panel has nothing below it, so this only adds for that one.
    let reserve = 16;
    const legend = panelEl.parentElement?.querySelector(".table-legend");
    if (legend) reserve += legend.getBoundingClientRect().height + 8;
    // The sticky Build footer covers the window bottom, so the pool must end above it (🔵 d842f0b); lineup.js keeps the same line.
    reserve += document.querySelector("#lineup-panel .opt-footer")?.getBoundingClientRect().height ?? 0;
    snapPanelMaxHeight(panelEl, top, reserve);
  });
}
