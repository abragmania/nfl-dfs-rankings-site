// The Showdown Optimizer's look (Adam 2026-10-18 9:09 PM: "does not use the team colors that we decided on"): the game's two-team palette that the six slots
// (lineup-slots.js, D81) and the saved rows (lineup-card.js teamColours / teamColourStyle, team-palette.js slatePalette) wear, and the controls laid out in
// two rows. Markup helpers only; lineup.js owns the lineup. No colour scale of its own: the palette is classic's, built for the two teams of the game on
// screen so they always read apart.
import { escapeHtml } from "../format.js";
import { slatePalette } from "../team-palette.js";
import { confirmHtml, anchorHtml, CLEAR_QUESTION } from "../confirm-inline.js"; // B13: Clear lineup asks `Clear the lineup?` beside itself, as classic's does

const palettes = new Map(); // "DAL,GB" to its palette (one entry per game viewed in this page's life, each a small palette of two teams, so it grows slowly and is not pruned)

/** The slate palette of this Showdown's teams (the board's rows and its game), slatePalette's own rules: rivals told apart, one fill per theme. */
export function showdownPalette(board) {
  const teams = new Set((board?.rows ?? []).map((r) => r?.team));
  teams.add(board?.game?.away);
  teams.add(board?.game?.home);
  const list = [...teams].filter((t) => typeof t === "string" && t).sort();
  const key = list.join(",");
  if (!palettes.has(key)) palettes.set(key, slatePalette(list));
  return palettes.get(key);
}

/** The working lineup's head, the classic's (`.luh`): which tab's lineup it is (GPP and Cash each have their own; none off the live app, `mode` null) and how many of the six seats are filled, then how many men are locked and Clear lineup
 *  (B13: asks `Clear the lineup?` beside itself, confirm-inline.js). */
export function lineupHeadHtml({ mode = null, filled, seats = 6, locked = 0, confirm = null }) {
  const word = mode === "cash" ? "Cash lineup" : mode === "gpp" ? "GPP lineup" : "Lineup";
  const clear = anchorHtml(`<button type="button" id="sd-lineup-clear-all-btn" class="clr">Clear lineup</button>`, confirm === "clear" ? confirmHtml(CLEAR_QUESTION, { data: "clear" }) : "", { align: "swap" });
  return `<div class="luh"><span>${word} · ${filled} of ${seats} seats filled</span><span class="luhr">${locked} locked${clear}</span></div><div class="wkh"><span>Slot</span><span class="wkhp">Player</span><span>Salary</span><span>Proj</span><span>Own</span><span></span></div>`;
}

/** Save as and `Save working lineup`, the classic's `.two` row (look.css `.act .two`); the Build button is in the Build row above it (optimizer standard A13), and no Objective choice is drawn while Projection is the only objective (A21). */
export function saveRowHtml({ saving, saveName, hasAnySlot }) {
  return `<div class="two"><label class="savebox">Save as<input type="text" id="sd-lineup-save-name" class="lineup-save-name-input" placeholder="Name (optional)" value="${escapeHtml(saveName)}" /></label><button type="button" id="sd-lineup-save-btn" class="ol lineup-build-btn"${!hasAnySlot || saving ? " disabled" : ""}>${saving ? "Saving…" : "Save working lineup"}</button></div>`;
}
