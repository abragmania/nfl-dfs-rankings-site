// The Showdown builder's six slots (one Captain, five FLEX), in the classic working lineup's rows (look-row.js lookRowHtml / lookEmptyRowHtml, 2026-11-13: one row design on both screens):
// slot box, team logo, name, the muted matchup, then salary, projection and ownership. Every function takes the placed slots as { cpt, flex } ({id} or null each); lineup.js owns them.
import { escapeHtml } from "../format.js";
import { lookMan } from "../look-adapter.js";
import { lookRowHtml, lookEmptyRowHtml } from "../look-row.js";
import { showdownPalette } from "./lineup-look.js";
import { findRow } from "./lineup-saved.js";
import { playerFigures, reasonHtml, NOT_ON_BOARD_WORDS } from "./lineup-meter.js";

// A slot's note (beside his name) carries what the old "$ · proj · own" line carried after the figures (D29: a missing figure reads missing, never zero): a man not on
// TwoGun's board reads "(not on TwoGun's board, 0%)" (Q8), a blank ownership its reason, a listed-Out projection TwoGun's own figure on hover.
export function notesHtml({ notOnBoard, missingReason, projNote }) {
  return (notOnBoard ? `<span>${escapeHtml(`(${NOT_ON_BOARD_WORDS})`)}</span>` : "")
    + (missingReason ? reasonHtml(missingReason) : "")
    + (projNote ? `<span title="${escapeHtml(projNote)}">note</span>` : "");
}

/** The board row with its game's key when it has none, so the row can name the man's opponent (a Showdown row is one game's; the slot reads `v WAS` / `@NYG`). */
export function rowWithGame(row, game) {
  if (!row || row.gameId || !game?.away || !game?.home) return row;
  return { ...row, gameId: `${game.away}@${game.home}` };
}

const REMOVE_TITLE = "Click to remove";
const REMOVE = `tabindex="0" title="${REMOVE_TITLE}" aria-label="${REMOVE_TITLE}"`;

/** One filled slot's row: salary, projection and ownership are the board row's own (playerFigures, the Captain's included); a missing figure stays null so the row prints a dash, never 0. `attrs`: the row's own hooks (data-action, the seat). */
export function slotPlayerHtml(row, isCpt, palette = null, attrs = "", game = null) {
  const figs = playerFigures(row, isCpt);
  const p = { ...row, salary: isCpt ? row.cptSalary : row.salary, proj: figs.proj, own: figs.notOnBoard ? null : figs.own };
  const live = rowWithGame(row, game);
  return lookRowHtml(lookMan(p, live), { slot: isCpt ? "CPT" : "FLEX", kind: "work", palette, attrs, cls: `sd-slot${isCpt ? " sd-cpt-slot" : ""}`, noteHtml: notesHtml(figs), showPos: true }); // every Showdown seat is CPT or FLEX, so the row names his position
}

/** Repaints only the placed slots' rows (the panel is not redrawn, so a typed lineup name survives); lineup.js's repaintSlotFigures calls it when the meter's modes answer (each man's notes) lands.
 *  The slot's own element keeps its click wiring: only what is inside it is replaced. An empty or missing slot has no row and is left alone. */
export function repaintSlots(container, board, { cpt, flex }) {
  const palette = showdownPalette(board);
  const paint = (slotEl, placed, isCpt) => {
    const row = placed ? findRow(board, placed.id) : null;
    if (!row || !slotEl) return;
    const html = slotPlayerHtml(row, isCpt, palette, "", board?.game);
    slotEl.innerHTML = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</div>")); // the row's inside: its own element, with the click wiring, stays
  };
  paint(container.querySelector(".sd-cpt-slot"), cpt, true);
  container.querySelectorAll("[data-flex-index]").forEach((el) => paint(el, flex[Number(el.dataset.flexIndex)], false));
}

// One slot in the classic rows: filled is the row (a click on it takes his man out; lineup.js wires `clearAttrs`); Empty and "Not on this board" keep the seat's box and the same height.
function slotHtml({ label, placed, row, palette, cls, data, clearAttrs, game }) {
  const hint = `click a player in the ${label === "CPT" ? "Captain" : "FLEX"} list`; // an empty seat says how to fill it (walkthrough friction, PROJECT.md Part 4 item 5)
  const attrs = `${data}${placed ? ` ${clearAttrs} ${REMOVE}` : ""}`.trim();
  if (!placed) return lookEmptyRowHtml(label, "Empty", { attrs, hint, cls });
  if (!row) return lookEmptyRowHtml(label, "Not on this board", { attrs, cls });
  return slotPlayerHtml(row, label === "CPT", palette, attrs, game);
}

export function slotsHtml(board, { cpt, flex }) {
  const palette = showdownPalette(board);
  const game = board?.game ?? null;
  const cptHtml = slotHtml({ label: "CPT", placed: cpt, row: cpt ? findRow(board, cpt.id) : null, palette, cls: "sd-cpt-slot sd-slot", data: "", clearAttrs: `data-action="clear-cpt"`, game });
  const flexHtml = flex
    .map((s, i) => slotHtml({ label: "FLEX", placed: s, row: s ? findRow(board, s.id) : null, palette, cls: "sd-slot", data: `data-flex-index="${i}"`, clearAttrs: `data-action="clear-flex" data-flex="${i}"`, game }))
    .join("");
  return cptHtml + flexHtml;
}
