// GPP variance per position in the browser (PROJECT.md Part 4 item 5, Adam 3:26 PM 2026-11-11), the one copy the classic and
// Showdown Optimizer panels share: the boxes as typed ({QB: "15", ...}, blank by default), what a GPP request sends
// (settings.variancePos, only the percents above 0), the sentence a box that is not a percent leaves (it blocks Build, as a bad
// Max % does), the summary's words, and the "Variance %" row. The positions and the one-line note are the engine's own
// (server/lineup/sd-variance.js, imported here, never copied: the live app serves that file and sd-rng.js, server.js SHARED_SERVER_FILES;
// the site build copies them to out/server/, tools/publish.mjs PAGE_MODULES_WITH_SERVER_IMPORTS). Pure apart from parsePct (no DOM, no storage).
import { escapeHtml } from "./format.js";
import { parsePct } from "./lineup-optimizer.js"; // the one percent-box reader (blank null, a number 0 to 100, else NaN)
import { CLASSIC_VARIANCE_POSITIONS, SHOWDOWN_VARIANCE_POSITIONS, varianceNote } from "../server/lineup/sd-variance.js";

export { CLASSIC_VARIANCE_POSITIONS, SHOWDOWN_VARIANCE_POSITIONS }; // the panels read them from here

/** Every box blank: no variance. */
export const blankVariancePos = (positions) => Object.fromEntries(positions.map((pos) => [pos, ""]));

/** The boxes as storage gives them back: each a string as typed, anything else blank. `legacy`: the older one-percent setting
 *  ({on, pct}, Showdown's switch before 2026-11-11), which fills every box with its percent while it was On, so it keeps working. */
export function cleanVariancePos(raw, positions, legacy = null) {
  const out = blankVariancePos(positions);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const pos of positions) if (typeof raw[pos] === "string") out[pos] = raw[pos];
    return out;
  }
  if (legacy && typeof legacy === "object" && legacy.on === true && typeof legacy.pct === "string") {
    const p = parsePct(legacy.pct);
    if (p !== null && p > 0) for (const pos of positions) out[pos] = legacy.pct.trim();
  }
  return out;
}

/** What a GPP request sends: {pos: percent} for each box holding a percent above 0, or null when none does (blank and 0 send nothing). */
export function variancePosSettings(boxes, positions) {
  const out = {};
  for (const pos of positions) {
    const p = parsePct(boxes?.[pos]);
    if (p !== null && !Number.isNaN(p) && p > 0) out[pos] = p;
  }
  return Object.keys(out).length ? out : null;
}

/** The positions whose box is not a percent from 0 to 100 (marked, and they block Build). */
export const badVariancePositions = (boxes, positions) => positions.filter((pos) => Number.isNaN(parsePct(boxes?.[pos])));

/** The sentence for the first box that is not a percent, or null. */
export function variancePosProblem(boxes, positions) {
  const bad = badVariancePositions(boxes, positions)[0];
  return bad ? `${bad} variance must be a percent from 0 to 100, or blank for none.` : null;
}

/** The build note's line (sd-variance.js varianceNote, "Variance QB 5 · WR 15") as one part of the settings summary beside Build,
 *  whose parts are joined by " · ": "variance QB 5, WR 15". `byPos`: variancePosSettings' answer (never null here). */
export const varianceSummary = (byPos) => varianceNote(byPos).replace(/^Variance/, "variance").split(" · ").join(", ");

/**
 * The "Variance %" row: one small box per position under its label, blank by default, no explanation in view (G64; the hover
 * names the rule). `attr`: the data attribute that carries the position ("data-opt-var" classic, "data-sd-var" Showdown); null
 * draws a stand-in with no live box (Showdown's Cash tab keeps the GPP row's room with it, invisible).
 */
export function varianceRowHtml(boxes, positions, attr) {
  const bad = new Set(badVariancePositions(boxes, positions));
  const live = (pos) => (attr ? `${attr}="${pos}"` : `tabindex="-1" disabled`);
  const cells = positions.map((pos) => `<label class="opt-var-cell"><span class="opt-var-pos">${pos}</span><input type="text" inputmode="decimal" maxlength="5" class="opt-input opt-var-input${bad.has(pos) ? " invalid" : ""}" ${live(pos)} value="${escapeHtml(boxes?.[pos] ?? "")}" aria-label="${pos} variance percent" /></label>`).join("");
  return `<div class="opt-var-row" title="Each lineup's search moves each man's projection by up to his position's percent; blank or 0 is none"><span class="opt-var-label">Variance %</span><span class="opt-var-boxes">${cells}</span></div>`;
}
