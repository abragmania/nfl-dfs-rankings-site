// The limits of a source's weight on the Sources page (Sources page plan, 2026-10-18): the browser's copy. The page's weight box and its
// check (sources-page-html.js, sources-page.js) read these.
// The browser cannot import server files; server/sources/selection-core.js holds the server's copy and tests/source-selection-fixes.test.mjs compares them.
// Plain constants only: no import, no DOM, no Node module.

/** The smallest weight a change may set (the page's step); a stored file may hold less and stays readable. */
export const WEIGHT_MIN = 0.25;
/** The largest weight a source can carry. */
export const WEIGHT_MAX = 10;
