// Showdown Rankings table (D39/D40), since 2026-10-26 the Optimizer's player pool (pool.js; the Rankings tab is retired). Visual target: the hosted sheet built by
// data/showdown/2026-w03-ATLGB/build-sheet.mjs — same dark palette and type as the rest of the app, same
// eleven columns (Lev and CPT Lev added 2026-09-30): Player (team chip, position, status pill), FLEX $, CPT $ (gold), Proj, CPT proj (gold),
// Val (one column — Captain value is identical to FLEX value since Captain price and points are both
// 1.5x), Own FLEX, Own CPT (gold), Notes. No inline editing here (unlike the classic table): the brief's
// column list for Showdown Rankings has no star or edit affordance, only display plus sort and filter.
import { escapeHtml, money, dec1, dec2 } from "../format.js";
import { rowIsOut } from "../table.js";
import { playerLineHtml, showPos } from "../player-row.js";
import { store } from "../state.js";

export function shownRows(rows) {
  return store.get().filters.showAllPlayers ? rows : rows.filter((row) => !rowIsOut(row));
}

export const SD_COLUMNS = [
  { key: "player", label: "Player" },
  { key: "salary", label: "FLEX $" },
  { key: "cptSalary", label: "CPT $", gold: true },
  { key: "proj", label: "Proj" },
  { key: "cptProj", label: "CPT proj", gold: true },
  { key: "value", label: "Val" },
  { key: "ownFlex", label: "Own FLEX" },
  { key: "ownCpt", label: "Own CPT", gold: true },
  { key: "levFlex", label: "Lev", title: "Lev: no measure yet (FLEX slot)" },
  { key: "levCpt", label: "CPT Lev", gold: true, title: "Lev: no measure yet (Captain slot)" },
  { key: "note", label: "Notes" },
];

// One colour per position (D41), same six tokens used by the position filter chips (public/style.css
// .sd-pos-<pos>) so the pill and the chip always match. Exported for lineup.js, which shows the same
// position pill in the Lineup Builder pool and slots (👁/brief: same colour everywhere it appears).
const POS_PILL_CLASS = { QB: "sd-pos-qb", RB: "sd-pos-rb", WR: "sd-pos-wr", TE: "sd-pos-te", K: "sd-pos-k", DST: "sd-pos-dst" };
export function posPillHtml(pos) {
  const label = pos ?? "";
  const cls = POS_PILL_CLASS[String(label).trim().toUpperCase()] ?? "";
  return `<span class="sd-pos${cls ? ` ${cls}` : ""}">${escapeHtml(label)}</span>`;
}

export const SD_POS_FILTER = "FLEX";
export const SD_PILL = false; // D80: a Showdown row has no home/away or totals, only a bare opponent code, so no pill
// The one Showdown player line (the pool, the Captain and FLEX lists, the slots and the saved rows all draw it). tag "main": the O, D, IR and Q badges as on classic Rankings (Adam 2026-10-18); a caller's own tag wins.
export const sdLine = (row, opts = {}) => playerLineHtml(row, { pos: showPos(SD_POS_FILTER), posHtml: posPillHtml, pill: SD_PILL, tag: "main", ...opts });
function playerCellHtml(row) {
  return `<div class="player-cell">${sdLine(row)}</div>`;
}

/** The Val cell's inside: `row.value` with its grade (row.valueGrade) as the grade's colour, a dash when there is none. */
export function gradedValueHtml(row) {
  if (row.value == null || Number.isNaN(row.value)) return "—";
  const cls = row.valueGrade ? ` grade-${row.valueGrade}` : "";
  return `<span class="grade-cell${cls}">${dec2(row.value)}</span>`;
}

// Lev (levFlex / levCpt): the columns stay but show no number until a measure exists (Adam 2026-10-15, Lev measure
// to be redesigned); the board sends null and the cell is empty with a hover note.
function levCellHtml() {
  return `<span title="Lev: no measure yet"></span>`;
}

// Every Own cell carries a title explaining exactly how the number was made (brief); a missing number is a dash
// (D29) whose title says no source has published one; a genuinely empty row.ownHow falls back to a plain sentence
// instead of an empty tooltip (👁 visual-qa item E).
// The hover text of an Own / Proj cell on our sources' figures (also read by the Optimizer's pool rows, below).
// The server's ownHow holds a "FLEX: ..." sentence and a "Captain: ..." sentence (and notes that belong to both). A list that
// shows one side passes it as `side` and reads only that side's sentence and the shared notes (Adam 2026-10-18). The text is cut
// at the "FLEX: " / "Captain: " markers, never at sentence ends, so a name like "A.J. Brown" cannot misfile a piece of it; inside
// the other side's piece only its own first sentence (ending at a period after a non-capital, before a space) is dropped.
function ownSideText(how, side) {
  if (!how || !side) return how;
  const other = side === "FLEX" ? "Captain: " : "FLEX: ";
  return String(how).split(/\s+(?=(?:FLEX|Captain): )/).map((piece) => {
    if (!piece.startsWith(other)) return piece;
    const end = piece.search(/[^A-Z\s.]\.(?=\s|$)/);
    return end === -1 ? "" : piece.slice(end + 2).trim(); // the shared notes written after that side's sentence stay
  }).filter(Boolean).join(" ");
}
export function ownTitleText(value, how, side = null) {
  const text = ownSideText(how, side) ?? "";
  return value == null ? text || "No source has published ownership for this player yet." : text;
}
export function projTitleText(value, row, extraTitlePrefix = "") {
  const how = row.projHow || "";
  return value == null ? how || "No source projects this player." : `${extraTitlePrefix}${how}`;
}

function ownCellHtml(value, how) {
  return `<span title="${escapeHtml(ownTitleText(value, how))}">${value == null ? "—" : `${dec1(value)}%`}</span>`;
}

function projCellHtml(value, row, extraTitlePrefix = "") {
  return `<span title="${escapeHtml(projTitleText(value, row, extraTitlePrefix))}">${value == null ? "no proj" : dec1(value)}</span>`;
}

function noteCellHtml(row) {
  if (!row.note) return "";
  const preview = row.note.length > 40 ? `${row.note.slice(0, 40)}…` : row.note;
  return `<span class="note-preview" title="${escapeHtml(row.note)}">${escapeHtml(preview)}</span>`;
}

// ---------- the Optimizer's player pool (Adam 2026-10-26 3:22 PM: the Optimizer looks like the retired Rankings tab, D81) ----------
// The pool (pool.js) draws these same columns and cells through `hooks`, which add what the Optimizer needs: the figures the slots
// show (`figures(row, isCpt)`: lineup-meter.js playerFigures, the board row's own plus the modes answer's notes), the Player cell
// (`playerCell(row)`), the ± bump in the Proj cell or, on the Captain tab, the CPT proj cell (`projCell(row, proj, isCpt)`), the Ceil and CPT Ceil cells (`ceilCell(row, isCpt)`, when the
// columns carry SD_CEIL_COLUMNS), the Val cell (`valueCell(row)`), a class on the row (`rowClass(row)`) and the cells after Notes
// (`tail(row)`), and the row's own attributes (`rowAttrs(row)`: the pool's click, keyboard stop and title). Without hooks a row is drawn as the retired Rankings tab drew it.

/** TwoGun's ceiling columns (the Optimizer's pool only, while the board carries his ceilings; Adam 2026-10-25, D81): his ceiling and, gold,
 *  his Captain ceiling (1.5x), as the retired Captain list showed it (🔵 R1 2026-10-26: every feature kept). */
export const SD_CEIL_COLUMNS = Object.freeze([
  Object.freeze({ key: "tgCeil", label: "Ceil", title: "TwoGun's ceiling, DraftKings points as he publishes them; a − / + bump scales it with the projection" }),
  Object.freeze({ key: "tgCeilCpt", label: "CPT Ceil", gold: true, title: "TwoGun's ceiling as Captain: 1.5x his ceiling; a − / + bump scales it with the projection" }),
]);

/** The table's columns: SD_COLUMNS, with the two Ceil columns after CPT proj when `withCeil`. */
export function sdColumns(withCeil = false) {
  if (!withCeil) return SD_COLUMNS;
  const at = SD_COLUMNS.findIndex((c) => c.key === "cptProj") + 1;
  return [...SD_COLUMNS.slice(0, at), ...SD_CEIL_COLUMNS, ...SD_COLUMNS.slice(at)];
}

/** The head row's cells (sortable, the sorted one marked with its arrow, the Captain columns gold), without the <tr>. `rowspan`: the
 *  rows each cell spans (the pool's head has a second row of sub-heads under its control groups). */
export function showdownHeadCellsHtml(sort, cols = SD_COLUMNS, { rowspan = 1 } = {}) {
  const span = rowspan > 1 ? ` rowspan="${rowspan}"` : "";
  return cols.map((c) => {
    const arrow = sort.col === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""; // a no-break space: the pool's heads wrap at their spaces, never before the arrow
    const cls = `sortable${sort.col === c.key ? " sorted" : ""}${c.gold ? " sd-cpt-col" : ""}`;
    const titleAttr = c.title ? ` title="${escapeHtml(c.title)}"` : "";
    return `<th data-col="${c.key}" class="${cls}"${span}${titleAttr}>${escapeHtml(c.label)}${arrow}</th>`;
  }).join("");
}

// A pool figure's hover (the retired Captain | FLEX lists' rule, D41): the board's projHow (a Captain's with its 1.5x line) plus what TwoGun
// projects for a man listed Out (projNote); for ownership that side's own sentence of ownHow, the server's reason for a blank, or that
// TwoGun's board has no row for him (Q8).
function hookedProjHtml(row, isCpt, h) {
  const f = h.figures(row, isCpt);
  const base = projTitleText(f.proj, row, isCpt ? "Captain: 1.5x price, 1.5x points. " : "");
  const title = f.projNote ? `${base}${base && !/\s$/.test(base) ? " " : ""}${f.projNote}` : base;
  const inner = (h.projCell ? h.projCell(row, f.proj, isCpt) : null) ??(f.proj == null ? "no proj" : dec1(f.proj));
  return `<span title="${escapeHtml(title)}">${inner}</span>`;
}

function hookedOwnHtml(row, isCpt, h) {
  const f = h.figures(row, isCpt);
  const title = f.notOnBoard ? "Not on TwoGun's board, 0%" : f.own == null && f.missingReason ? f.missingReason : ownTitleText(f.own, row.ownHow, isCpt ? "Captain" : "FLEX");
  return `<span title="${escapeHtml(title)}">${f.own == null ? "—" : `${dec1(f.own)}%`}</span>`;
}

function cellHtml(row, key, h) {
  const hooked = typeof h.figures === "function";
  switch (key) {
    case "player": return `<td>${h.playerCell ? h.playerCell(row) : playerCellHtml(row)}</td>`;
    case "salary": return `<td>${money(row.salary)}</td>`;
    case "cptSalary": return `<td class="sd-cpt-col">${money(row.cptSalary)}</td>`;
    case "proj": return `<td>${hooked ? hookedProjHtml(row, false, h) : projCellHtml(row.proj, row)}</td>`;
    case "cptProj": return `<td class="sd-cpt-col">${hooked ? hookedProjHtml(row, true, h) : projCellHtml(row.cptProj, row, `Captain: 1.5x price, 1.5x points. `)}</td>`;
    case "tgCeil": return `<td>${h.ceilCell ? h.ceilCell(row, false) : "—"}</td>`;
    case "tgCeilCpt": return `<td class="sd-cpt-col">${h.ceilCell ? h.ceilCell(row, true) : "—"}</td>`;
    case "value": return `<td>${h.valueCell ? h.valueCell(row) : gradedValueHtml(row)}</td>`;
    case "ownFlex": return `<td>${hooked ? hookedOwnHtml(row, false, h) : ownCellHtml(row.ownFlex, row.ownHow)}</td>`;
    case "ownCpt": return `<td class="sd-cpt-col">${hooked ? hookedOwnHtml(row, true, h) : ownCellHtml(row.ownCpt, row.ownHow)}</td>`;
    case "levFlex": return `<td>${levCellHtml()}</td>`;
    case "levCpt": return `<td class="sd-cpt-col">${levCellHtml()}</td>`;
    case "note": return `<td class="sd-notes-cell">${noteCellHtml(row)}</td>`;
    default: return "<td></td>";
  }
}

/** One row of the table: the columns `cols` (SD_COLUMNS by default) and the pool's `hooks` (above; none draws the Rankings row). */
export function showdownRowHtml(row, hooks = {}, cols = SD_COLUMNS) {
  const dimmed = rowIsOut(row);
  const extra = String(hooks.rowClass?.(row) ?? "").trim();
  return `
    <tr class="rank-row${dimmed ? " row-dimmed" : ""}${extra ? ` ${extra}` : ""}" data-id="${escapeHtml(String(row.id))}"${hooks.rowAttrs?.(row) ?? ""}>
      ${cols.map((c) => cellHtml(row, c.key, hooks)).join("\n      ")}${hooks.tail?.(row) ?? ""}
    </tr>`;
}
