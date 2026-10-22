// The Showdown builder's six slots (one Captain, five FLEX), moved out of ./lineup.js unchanged (file cap, Adam 2026-10-21 Q3 option A).
// lineup.js owns the placed slots; every function here takes them as { cpt, flex } ({id} or null each) and reads no module state.
import { escapeHtml, money, dec1 } from "../format.js";
import { matchupPillHtml } from "../player-row.js";
import { sdLine, SD_PILL } from "./table.js";
import { slotLook, slotLogoHtml } from "./lineup-look.js";
import { findRow } from "./lineup-saved.js";
import { playerFigures, reasonHtml } from "./lineup-meter.js";

function ownParen(own) {
  return own == null ? "" : ` (${Math.round(own)}% own)`;
}

// The slot's "$ · proj · (own)" line: the board row's projection and ownership (playerFigures) and salary. A missing figure
// reads "no proj" / no "% own", never zero (D29); a man not on TwoGun's board reads "(not on TwoGun's board, 0%)" (Q8).
function slotDetailHtml(row, isCpt) {
  const salary = isCpt ? row.cptSalary : row.salary;
  const { proj, own, notOnBoard, missingReason, projNote } = playerFigures(row, isCpt);
  const projText = proj == null ? "no proj" : `${dec1(proj)} proj`;
  const projHtml = projNote ? `<span title="${escapeHtml(projNote)}">${projText}</span>` : projText; // listed Out: TwoGun's own figure on hover
  const ownText = notOnBoard ? " (not on TwoGun's board, 0%)" : ownParen(own);
  return `${money(salary)} &middot; ${projHtml}${escapeHtml(ownText)}${missingReason ? ` &middot; ${reasonHtml(missingReason)}` : ""}`;
}

// Repaints only the six slots' figure lines (the panel is not redrawn, so a typed lineup name survives); lineup.js's
// repaintSlotFigures calls it when the meter's modes answer (each man's notes) lands.
export function repaintSlots(container, board, { cpt, flex }) {
  const paint = (slotEl, placed, isCpt) => {
    const row = placed ? findRow(board, placed.id) : null;
    const el = slotEl?.querySelector?.(".lineup-slot-detail");
    if (row && el) el.innerHTML = slotDetailHtml(row, isCpt);
  };
  paint(container.querySelector(".sd-cpt-slot"), cpt, true);
  container.querySelectorAll("[data-flex-index]").forEach((el) => paint(el, flex[Number(el.dataset.flexIndex)], false));
}

export function slotPlayerHtml(row, isCpt) {
  return `
    <span class="lineup-slot-player lineup-slot-player-2" data-card-id="${escapeHtml(String(row.id))}">
      ${slotLogoHtml(row)}
      <span class="lineup-slot-body">
        <span class="lineup-slot-top">${sdLine(row, { nameCls: "lineup-slot-name", pill: false, tag: "out", logo: false })}</span>
        ${SD_PILL ? matchupPillHtml(row) : ""}
        <span class="lineup-slot-detail">${slotDetailHtml(row, isCpt)}</span>
      </span>
    </span>`;
}

export function slotsHtml(board, { cpt, flex }) {
  const cptRow = cpt ? findRow(board, cpt.id) : null;
  const cptBody = !cpt
    ? `<span class="lineup-slot-player lineup-slot-empty">Empty</span>`
    : cptRow
      ? slotPlayerHtml(cptRow, true)
      : `<span class="lineup-slot-player lineup-slot-missing">Not on this board</span>`;
  const cptLook = slotLook(cptRow);
  const cptHtml = `
    <div class="lineup-slot lineup-slot-tall sd-cpt-slot${cptLook.cls}"${cptLook.attr}>
      <span class="lineup-slot-label">CPT</span>
      ${cptBody}
      <button type="button" class="lineup-slot-clear" data-action="clear-cpt"${cpt ? "" : " disabled"}>Clear</button>
    </div>`;
  const flexHtml = flex
    .map((s, i) => {
      const row = s ? findRow(board, s.id) : null;
      const body = !s
        ? `<span class="lineup-slot-player lineup-slot-empty">Empty</span>`
        : row
          ? slotPlayerHtml(row, false)
          : `<span class="lineup-slot-player lineup-slot-missing">Not on this board</span>`;
      const look = slotLook(row);
      return `
        <div class="lineup-slot lineup-slot-tall${look.cls}"${look.attr} data-flex-index="${i}">
          <span class="lineup-slot-label">FLEX</span>
          ${body}
          <button type="button" class="lineup-slot-clear" data-action="clear-flex" data-flex="${i}"${s ? "" : " disabled"}>Clear</button>
        </div>`;
    })
    .join("");
  return cptHtml + flexHtml;
}
