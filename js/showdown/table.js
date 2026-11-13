// Showdown Rankings table (D39/D40), since 2026-10-26 the Optimizer's player pool (pool.js; the Rankings tab is retired). Since 2026-11-13 its rows and cells are the classic pool's (lineup-pool.js rightRowHtml:
// td.ctl, td.pl with .who / .l1 / .l2, td.num.sal, td.num.proj, td.num.bar.own, td.num.bar.val, td.bmp, td.lim), so the one look sheet (public/look/) draws both pools. Same columns as before
// (no Lev, standard A2): Player, Sal, CPT Sal, Proj, CPT Proj, Own, CPT Own, Val (one column: Captain value is identical to FLEX value since Captain price and points are both 1.5x);
// words per optimizer standard D1, 2026-11-03. The pool's cells carry the star and the typed Proj and Own editors through `hooks` (B2, B3; showdown/pool-edit.js).
import { escapeHtml, money, dec1, dec2, pct1 } from "../format.js";
import { rowIsOut, opponentLabel, outTagHtml, statusTagsHtml } from "../table.js";
import { adamTouched } from "../out.js"; // the pool keeps a man Adam marked In / Out or typed a projection on listed, so his edit is never out of reach
import { playerLineHtml, showPos, teamLogoHtml } from "../player-row.js";
import { cardNameHtml } from "../lineup-card.js";
import { sdShowAll } from "./show-all.js";
import { rowWithGame } from "./lineup-slots.js";

/** The rows a Showdown list shows: every man with the Showdown's own `Show all players` on (C24: not classic's switch), else without the men listed out (D45). */
export function shownRows(rows, showAll = sdShowAll(), { keepTouched = false } = {}) {
  return showAll ? rows : rows.filter((row) => !rowIsOut(row) || (keepTouched && adamTouched(row)));
}

// The standard's order (A1: Player, Sal, Proj, Own, Val); the Lev and CPT Lev columns are gone (A2, 2026-11-03).
export const SD_COLUMNS = [
  { key: "player", label: "Player" },
  { key: "salary", label: "Sal" }, // optimizer standard D1: the FLEX figures are the plain words, the Captain seat's wear CPT
  { key: "cptSalary", label: "CPT Sal", gold: true },
  { key: "proj", label: "Proj" },
  { key: "cptProj", label: "CPT Proj", gold: true },
  { key: "ownFlex", label: "Own" },
  { key: "ownCpt", label: "CPT Own", gold: true },
  { key: "value", label: "Val" },
];

// One colour per position (D41), same six tokens used by the position filter chips (public/style.css
// .sd-pos-<pos>) so the pill and the chip always match. Exported for the exposure tables, the swaps and the cards, which show the same
// position pill (👁/brief: same colour everywhere it appears).
const POS_PILL_CLASS = { QB: "sd-pos-qb", RB: "sd-pos-rb", WR: "sd-pos-wr", TE: "sd-pos-te", K: "sd-pos-k", DST: "sd-pos-dst" };
export function posPillHtml(pos) {
  const label = pos ?? "";
  const cls = POS_PILL_CLASS[String(label).trim().toUpperCase()] ?? "";
  return `<span class="sd-pos${cls ? ` ${cls}` : ""}">${escapeHtml(label)}</span>`;
}

export const SD_POS_FILTER = "FLEX";
export const SD_PILL = false; // D80: a Showdown row has no home/away or totals, only a bare opponent code, so no pill
// The one Showdown player line (the Sources page's tables, the saved rows). tag "main": the O, D, IR and Q badges as on classic Rankings (Adam 2026-10-18); a caller's own tag wins.
export const sdLine = (row, opts = {}) => playerLineHtml(row, { pos: showPos(SD_POS_FILTER), posHtml: posPillHtml, pill: SD_PILL, tag: "main", ...opts });

/** The Val cell's inside: `row.value` with its grade (row.valueGrade) as the grade's colour, a dash when there is none. */
export function gradedValueHtml(row) {
  if (row.value == null || Number.isNaN(row.value)) return "—";
  const cls = row.valueGrade ? ` grade-${row.valueGrade}` : "";
  return `<span class="grade-cell${cls}">${dec2(row.value)}</span>`;
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
  return `<span title="${escapeHtml(ownTitleText(value, how))}">${pct1(value) ?? "—"}</span>`;
}

function projCellHtml(value, row, extraTitlePrefix = "") {
  return `<span title="${escapeHtml(projTitleText(value, row, extraTitlePrefix))}">${value == null ? "no proj" : dec1(value)}</span>`;
}

// ---------- the Optimizer's player pool (Adam 2026-10-26 3:22 PM: the Optimizer looks like the retired Rankings tab, D81) ----------
// The pool (pool.js) draws these same columns and cells through `hooks`, which add what the Optimizer needs: the figures the slots
// show (`figures(row, isCpt)`: lineup-meter.js playerFigures, the board row's own plus the modes answer's notes), the Player cell
// (`playerCell(row)`), the bumped figure in the Proj cell or, on the Captain tab, the CPT proj cell (`projCell(row, proj, isCpt)`), the Val cell (`valueCell(row)`), a class on the row (`rowClass(row)`) and the row controls' cells
// (`ctlCell(row, key)`), and the row's own attributes (`rowAttrs(row)`: the pool's click, keyboard stop and title). Without hooks a row is drawn as the retired Rankings tab drew it.

/** The Player cell's inside, the classic pool's (lineup-pool.js): logo, name with his In / Out switch (`tagWrap(tag)` draws the switch's place; null keeps the tag) and position on the first line, team and opponent on the second.
 *  `extra`: what follows the position on the first line (the seat tag and padlock); `why`: the few words of a greyed row's reason after the matchup. */
export function playerWhoHtml(row, { nameHtml = cardNameHtml(row), tagWrap, extra = "", why = "", game = null } = {}) {
  const tag = outTagHtml(row) || statusTagsHtml(row);
  const tagInner = typeof tagWrap === "function" ? tagWrap(tag) ?? tag : tag;
  const opp = opponentLabel(rowWithGame(row, game)); // `game`: the board's game, so the second line reads `WAS · @NYG` / `NYG · v WAS` as classic's does (the one helper, opponentLabel)
  return `<div class="who">${teamLogoHtml(row.team, "logo", 24)}<div class="whot"><div class="l1"><span class="name player-name" title="${escapeHtml(row.name ?? "")}">${nameHtml}</span>${tagInner}${row.pos ? `<span class="pos">${escapeHtml(row.pos)}</span>` : ""}${extra}</div><div class="l2">${escapeHtml(row.team ?? "")}${opp ? ` · ${escapeHtml(opp)}` : ""}${why}</div></div></div>`;
}

// A pool figure's hover (the retired Captain | FLEX lists' rule, D41): the board's projHow (a Captain's with its 1.5x line) plus what TwoGun
// projects for a man listed Out (projNote); for ownership that side's own sentence of ownHow, the server's reason for a blank, or that
// TwoGun's board has no row for him (Q8).
function hookedProjHtml(row, isCpt, h) {
  const f = h.figures(row, isCpt);
  const base = projTitleText(f.proj, row, isCpt ? "Captain: 1.5x price, 1.5x points. " : "");
  const title = f.projNote ? `${base}${base && !/\s$/.test(base) ? " " : ""}${f.projNote}` : base;
  const inner = (h.projCell ? h.projCell(row, f.proj, isCpt) : null) ?? (f.proj == null ? "no proj" : dec1(f.proj));
  return `<span title="${escapeHtml(title)}">${inner}</span>`;
}

function hookedOwnHtml(row, isCpt, h) {
  const f = h.figures(row, isCpt);
  const title = f.notOnBoard ? "Not on TwoGun's board, 0%" : f.own == null && f.missingReason ? f.missingReason : ownTitleText(f.own, row.ownHow, isCpt ? "Captain" : "FLEX");
  const text = pct1(f.own) ?? "—";
  const inner = (h.ownCell ? h.ownCell(row, f.own, isCpt, text) : null) ?? text; // B3: the pool wraps it as the typed-Own editor (pool-edit.js)
  return `<span title="${escapeHtml(title)}">${inner}</span>`;
}

/** The Own cell: the classic cell (the figure under a small bar, scaled as classic's: 30% fills it); a missing figure has no bar. */
function ownBarCellHtml(valueNum, innerHtml) {
  const n = typeof valueNum === "number" && Number.isFinite(valueNum) ? valueNum : null;
  const bar = n === null ? `<span class="b off"></span>` : `<span class="b"><i style="width:${Math.min(100, (n / 30) * 100).toFixed(0)}%"></i></span>`;
  return `<td class="num bar own">${bar}<span class="v">${innerHtml}</span></td>`;
}

function cellHtml(row, key, h) {
  const hooked = typeof h.figures === "function";
  switch (key) {
    case "star": return `<td class="ctl">${h.starCell ? h.starCell(row) : ""}</td>`; // B2: the pool's star button
    case "player": return `<td class="pl">${h.playerCell ? h.playerCell(row) : playerWhoHtml(row)}</td>`;
    case "salary": return `<td class="num sal">${money(row.salary)}</td>`;
    case "cptSalary": return `<td class="num sal">${money(row.cptSalary)}</td>`;
    case "proj": return `<td class="num proj">${hooked ? hookedProjHtml(row, false, h) : projCellHtml(row.proj, row)}</td>`;
    case "cptProj": return `<td class="num proj">${hooked ? hookedProjHtml(row, true, h) : projCellHtml(row.cptProj, row, `Captain: 1.5x price, 1.5x points. `)}</td>`;
    case "value": return `<td class="num bar val"><span class="v">${h.valueCell ? h.valueCell(row) : gradedValueHtml(row)}</span></td>`;
    case "ownFlex": return hooked ? ownBarCellHtml(h.figures(row, false).own, hookedOwnHtml(row, false, h)) : ownBarCellHtml(row.ownFlex, ownCellHtml(row.ownFlex, row.ownHow));
    case "ownCpt": return hooked ? ownBarCellHtml(h.figures(row, true).own, hookedOwnHtml(row, true, h)) : ownBarCellHtml(row.ownCpt, ownCellHtml(row.ownCpt, row.ownHow));
    default: return h.ctlCell ? h.ctlCell(row, key) : "<td></td>"; // the pool's row controls (pool.js controlCellHtml)
  }
}

/** One row of the table: the columns `cols` (SD_COLUMNS by default) and the pool's `hooks` (above; none draws the Rankings row). The row is the classic pool's: `team` (the tint and stripe), `row-dimmed` for a listed-out man. */
export function showdownRowHtml(row, hooks = {}, cols = SD_COLUMNS) {
  const dimmed = rowIsOut(row);
  const extra = String(hooks.rowClass?.(row) ?? "").trim();
  return `
    <tr class="team${dimmed ? " row-dimmed" : ""}${extra ? ` ${extra}` : ""}" data-id="${escapeHtml(String(row.id))}"${hooks.rowAttrs?.(row) ?? ""}>
      ${cols.map((c) => cellHtml(row, c.key, hooks)).join("\n      ")}
    </tr>`;
}
