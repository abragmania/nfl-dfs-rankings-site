// The ONE typed-number cell look, used by the classic pool and the Showdown pool alike (Adam 2026-11-13: the projection edit box and chip look and behave the same in both):
// the figure with the typed look and its hover ("Your number. Original: 14.0" / "Without it: 0 (you marked him Out)") and the small x that puts the original back with its words.
// Markup only; the box itself is typed-edit.js, the chip status-switch.js, the unused-number strike bump-control.js.
import { escapeHtml, dec1 } from "./format.js";
import { rowIsOut, STATUS_INFO } from "./table.js";
import { rowResetHtml } from "./row-reset.js";

/** Why an out man counts 0, in a few words: his own Out (2026-11-12), else the word he is listed with. */
export function outWhy(row) {
  if (row.override?.status === "out") return "you marked him Out";
  return `listed ${STATUS_INFO[String(row.status ?? "").trim().toLowerCase()]?.label || row.status || "injured"}`;
}

const isOutProj = (row, field) => field === "proj" && (rowIsOut(row) || (row.flags ?? []).includes("revived"));

/** What a Proj or Own reset puts back, in words: a listed-out man goes back to 0 (R82: out = 0), the rest to the blend's or the published number. */
export function backWords(row, field) {
  const base = field === "proj" ? row.projBase : row.ownBase;
  return isOutProj(row, field) ? `Back to 0 (${outWhy(row)})` : `Back to the original (${base == null ? "none" : dec1(base)})`;
}

/** The hover on a typed number: his own number, and what it replaces. */
export function typedTitle(row, field) {
  const base = field === "proj" ? row.projBase : row.ownBase;
  return `Your number. ${isOutProj(row, field) ? `Without it: 0 (${escapeHtml(outWhy(row))})` : `Original: ${base == null ? "none" : escapeHtml(dec1(base))}`}`;
}

/** The figure span of a Proj or Own cell: typed ones coloured and titled. `typed`: whether this seat's number is his own (default: the row's typed number for `field`). */
export function typedFigureHtml(row, field, figureHtml, typed = row.override?.[field] != null, { hover = true } = {}) {
  return `<span class="cell-value${typed ? " is-override" : ""}"${typed && hover ? ` title="${typedTitle(row, field)}"` : ""}>${figureHtml}</span>`; // hover false: a Showdown Own figure (the board keeps no ownBase to name)
}

/** The small x after a figure, with the words of what it puts back; "" when the man has nothing to clear. `canReset` false: no write is wired. */
export function resetXHtml(row, field, { canReset = true } = {}) {
  return rowResetHtml(row, { disabled: !canReset, title: `${backWords(row, field)}. Clears his typed numbers and bump.` }); // B12: the x clears his typed numbers and bump
}
