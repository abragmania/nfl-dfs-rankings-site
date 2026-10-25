// The Showdown builder's six slots (one Captain, five FLEX). D81 counterpart of classic's step 5 (Adam 2026-10-18: the slots "formatted the same way as the
// smaller ones ... just bigger"): a filled slot is the shared card row at the big size (lineup-card.js cardPlayerRowHtml, the same call as classic's lineup-view.js
// slotPlayerHtml) in the game's team colours (lineup-look.js showdownPalette, the palette the saved rows wear). Every function takes the placed slots as
// { cpt, flex } ({id} or null each); lineup.js owns them.
import { escapeHtml } from "../format.js";
import { cardPlayerRowHtml, teamColours } from "../lineup-card.js";
import { showdownPalette } from "./lineup-look.js";
import { posPillHtml, SD_PILL } from "./table.js";
import { findRow } from "./lineup-saved.js";
import { playerFigures, reasonHtml, NOT_ON_BOARD_WORDS } from "./lineup-meter.js";

// The card row's line 2 carries what the old "$ · proj · own" line carried after the figures (D29: a missing figure reads missing, never zero): a man not on
// TwoGun's board reads "(not on TwoGun's board, 0%)" (Q8), a blank ownership its reason, a listed-Out projection TwoGun's own figure on hover.
export function notesHtml({ notOnBoard, missingReason, projNote }) {
  return (notOnBoard ? `<span>${escapeHtml(`(${NOT_ON_BOARD_WORDS})`)}</span>` : "")
    + (missingReason ? reasonHtml(missingReason) : "")
    + (projNote ? `<span title="${escapeHtml(projNote)}">note</span>` : "");
}

// The one big card row of a placed man: salary, projection and ownership are the board row's own (playerFigures, the Captain's included); a missing
// figure stays null so the row prints "—" / no parenthesis. D80: a Showdown row has no pill, so the matchup fields the pill reads are blanked.
export function slotPlayerHtml(row, isCpt, palette = null) {
  const figs = playerFigures(row, isCpt);
  const p = { ...row, salary: isCpt ? row.cptSalary : row.salary, proj: figs.proj, own: figs.notOnBoard ? null : figs.own };
  const decor = {
    rowFor: (r) => (SD_PILL ? r : { ...r, gameId: null, opp: null, impliedTotal: null, total: null, spread: null }), // D80: no pill while SD_PILL is off
    rolesFor: () => notesHtml(figs),
    coloursFor: (team) => teamColours(palette, team),
  };
  return cardPlayerRowHtml(p, isCpt ? "CPT" : "FLEX", decor, { big: true, pos: true, posHtml: posPillHtml }).trim(); // every slot is FLEX, so the row names his position, as the pool does
}

// Repaints only the placed slots' big rows (the Clear button is the row's sibling and survives; the panel is not redrawn, so a typed lineup name survives);
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

// One slot, classic's shapes (lineup-view.js slotsHtml): filled is the card row (it carries the slot name) and Clear; Empty and "Not on this board" keep the
// label and the same 64px (style.css .lineup-slot-big).
function slotHtml({ label, placed, row, palette, attrs, clearAttrs }) {
  const body = !placed
    ? `<span class="lineup-slot-player lineup-slot-empty">Empty</span>`
    : row
      ? slotPlayerHtml(row, label === "CPT", palette)
      : `<span class="lineup-slot-player lineup-slot-missing">Not on this board</span>`;
  return `
    <div class="lineup-slot lineup-slot-big${row ? " lineup-slot-card" : ""}${attrs.cls}"${attrs.data}>
      ${row ? "" : `<span class="lineup-slot-label">${label}</span>`}
      ${body}
      <button type="button" class="lineup-slot-clear" ${clearAttrs}${placed ? "" : " disabled"}>Clear</button>
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
