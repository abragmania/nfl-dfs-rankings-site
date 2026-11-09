// The Showdown builder's six slots (one Captain, five FLEX). D81 counterpart of classic's step 5 (Adam 2026-10-18: the slots "formatted the same way as the
// smaller ones ... just bigger"): a filled slot is the shared card row at the big size (lineup-card.js cardPlayerRowHtml, the same call as classic's lineup-view.js
// slotPlayerHtml) in the game's team colours (lineup-look.js showdownPalette, the palette the saved rows wear). Every function takes the placed slots as
// { cpt, flex } ({id} or null each); lineup.js owns them.
import { escapeHtml } from "../format.js";
import { cardPlayerRowHtml, teamColours } from "../lineup-card.js";
import { showdownPalette } from "./lineup-look.js";
import { posPillHtml } from "./table.js";
import { findRow } from "./lineup-saved.js";
import { playerFigures, reasonHtml, NOT_ON_BOARD_WORDS } from "./lineup-meter.js";
import { poolValueHtml, valuePer1k } from "./pool.js"; // the pool's Val, so the slot and the pool read one figure
import { gradedValueHtml } from "./table.js";

// The card row's line 2 carries what the old "$ · proj · own" line carried after the figures (D29: a missing figure reads missing, never zero): a man not on
// TwoGun's board reads "(not on TwoGun's board, 0%)" (Q8), a blank ownership its reason, a listed-Out projection TwoGun's own figure on hover.
export function notesHtml({ notOnBoard, missingReason, projNote }) {
  return (notOnBoard ? `<span>${escapeHtml(`(${NOT_ON_BOARD_WORDS})`)}</span>` : "")
    + (missingReason ? reasonHtml(missingReason) : "")
    + (projNote ? `<span title="${escapeHtml(projNote)}">note</span>` : "");
}

// The one big card row of a placed man: salary, projection and ownership are the board row's own (playerFigures, the Captain's included); a missing
// figure stays null so the row prints "—" / no parenthesis. D80: a Showdown row has no pill, so the matchup fields the pill reads are blanked.
/** His Val in his seat (the working lineup's row, as NBA's panel has it): his projection in that seat per $1,000 of his salary in that seat, as the pool's Val cell reads it (pool.js poolValue); the FLEX seat's wears the
 *  board's grade while the board's value and the shown one agree (poolValueHtml's rule), the Captain's has none (the board grades FLEX only); a dash when either figure is missing, never 0. */
export function slotValueHtml(row, isCpt, figs) {
  if (!isCpt) return poolValueHtml(row, () => figs);
  return gradedValueHtml({ value: valuePer1k(Number.isFinite(figs.proj) ? figs.proj : null, row.cptSalary), valueGrade: null });
}

export function slotPlayerHtml(row, isCpt, palette = null) {
  const figs = playerFigures(row, isCpt);
  const p = { ...row, salary: isCpt ? row.cptSalary : row.salary, proj: figs.proj, own: figs.notOnBoard ? null : figs.own };
  const decor = {
    rolesFor: () => notesHtml(figs),
    coloursFor: (team) => teamColours(palette, team),
  };
  const html = cardPlayerRowHtml(p, isCpt ? "CPT" : "FLEX", decor, { big: true, pos: true, posHtml: posPillHtml, bareOpp: true }).trim(); // D80 as amended: the bare opponent code on the small second line, no pill (the slot's .sd-cpt-slot gives the Captain's row its amber chip) // every slot is FLEX, so the row names his position, as the pool does
  return html.replace('<span class="opt-p-fig opt-p-own">', `<span class="opt-p-fig opt-p-val"><i>Val</i><b>${slotValueHtml(row, isCpt, figs)}</b></span><span class="opt-p-fig opt-p-own">`); // Sal, Proj, Val, Own across the row (the shared card row has no Val; the saved and result cards keep theirs)
}

// Repaints only the placed slots' big rows (the panel is not redrawn, so a typed lineup name survives);
// lineup.js's repaintSlotFigures calls it when the meter's modes answer (each man's notes) lands. An empty or missing slot has no row and is left alone.
export function repaintSlots(container, board, { cpt, flex }) {
  const palette = showdownPalette(board);
  const paint = (slotEl, placed, isCpt) => {
    const row = placed ? findRow(board, placed.id) : null;
    const el = slotEl?.querySelector?.(".opt-p");
    if (row && el) el.outerHTML = slotPlayerHtml(row, isCpt, palette);
  };
  paint(container.querySelector(".sd-cpt-slot"), cpt, true);
  container.querySelectorAll("[data-flex-index]").forEach((el) => paint(el, flex[Number(el.dataset.flexIndex)], false));
}

// One slot, classic's shapes (lineup-view.js slotsHtml) without its Clear button (D39, Adam 4:45 PM 2026-10-29: "I don't want the tiny ... clear
// buttons"): filled is the card row (it carries the slot name), and a click on a placed slot takes his man out (lineup.js wires `clearAttrs`);
// Empty and "Not on this board" keep the label and the same 64px (style.css .lineup-slot-big).
function slotHtml({ label, placed, row, palette, attrs, clearAttrs }) {
  const body = !placed
    ? `<span class="lineup-slot-player lineup-slot-empty">Empty</span>`
    : row
      ? slotPlayerHtml(row, label === "CPT", palette)
      : `<span class="lineup-slot-player lineup-slot-missing">Not on this board</span>`;
  const removable = placed ? ` ${clearAttrs} tabindex="0" title="Click to remove" aria-label="Click to remove"` : ""; // no button role: the card holds a name that opens his card
  return `
    <div class="lineup-slot lineup-slot-big${row ? " lineup-slot-card" : ""}${attrs.cls}${placed ? " sd-slot-removable" : ""}"${attrs.data}${removable}>
      ${row ? "" : `<span class="lineup-slot-label">${label}</span>`}
      ${body}
    </div>`;
}

export function slotsHtml(board, { cpt, flex }) {
  const palette = showdownPalette(board);
  const cptHtml = slotHtml({ label: "CPT", placed: cpt, row: cpt ? findRow(board, cpt.id) : null, palette, attrs: { cls: " sd-cpt-slot", data: "" }, clearAttrs: `data-action="clear-cpt"` });
  const flexHtml = flex
    .map((s, i) => slotHtml({ label: "FLEX", placed: s, row: s ? findRow(board, s.id) : null, palette, attrs: { cls: "", data: ` data-flex-index="${i}"` }, clearAttrs: `data-action="clear-flex" data-flex="${i}"` }))
    .join("");
  return cptHtml + flexHtml;
}
