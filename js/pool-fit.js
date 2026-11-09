// Fits the classic pool's name column to the room (Round 5, last batch item 1). With the default columns the name cell is one line (logo, name, position, injury letter) and the matchup a second; with every column
// ticked and long tags or notes the table can come out wider than its panel. The name is then the only thing that gives: its line is capped (style.css reads --lp-name-max) and the name ends in an ellipsis
// (its full name is the hover), never a second line. Nothing else moves, and with room to spare nothing is capped.

/** Smallest the name line is ever capped to: the logo, a short name and the position beside it. */
export const NAME_CAP_FLOOR = 110;

/** The cap in px for the name line, or null for none: `tableWidth` is what the table is, `panelWidth` what it must fit, `nameCellWidth` the name column's width (padding included) and `pad` its cell padding.
 *  Pure. A table that fits is not capped; one that does not gives up exactly what it overflows by, to the floor. */
export function poolNameCap(tableWidth, panelWidth, nameCellWidth, pad = 8) {
  const over = tableWidth - panelWidth;
  if (![over, nameCellWidth, pad].every(Number.isFinite) || !(panelWidth > 0) || over <= 0.5) return null;
  return Math.max(NAME_CAP_FLOOR, Math.floor(nameCellWidth - pad - over));
}

/** The phone width the CSS uses (style.css max-width 700px): there the table is wider than the screen by design, so a cap would only squeeze the name. */
export const PHONE_MAX_WIDTH = 700;
export function isPhoneWidth(win = typeof window !== "undefined" ? window : null) {
  return Boolean(win?.matchMedia?.(`(max-width: ${PHONE_MAX_WIDTH}px)`)?.matches);
}

/** Measures the pool in `root` with no cap and sets (or clears) the table's --lp-name-max; at phone width it only clears it. Safe with no pool on screen or a hidden one. */
export function fitPoolNames(root = typeof document !== "undefined" ? document : null, phone = isPhoneWidth()) {
  const table = root?.querySelector?.(".lineup-pool-table");
  const wrap = table?.parentElement;
  if (!table || !wrap) return;
  table.style.removeProperty("--lp-name-max");
  if (phone) return;
  const panelWidth = wrap.clientWidth;
  const nameCell = table.querySelector("td.lp-name");
  if (!panelWidth || !nameCell) return;
  const cap = poolNameCap(table.getBoundingClientRect().width, panelWidth, nameCell.getBoundingClientRect().width);
  if (cap !== null) table.style.setProperty("--lp-name-max", `${cap}px`);
}

let wired = false;
/** Refits on a window resize (once). */
export function wirePoolFit() {
  if (wired || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  wired = true;
  window.addEventListener("resize", () => fitPoolNames());
}
