// Showdown Rankings table (D39/D40). Visual target: the hosted sheet built by
// data/showdown/2026-w03-ATLGB/build-sheet.mjs — same dark palette and type as the rest of the app, same
// nine columns: Player (team chip, position, status pill), FLEX $, CPT $ (gold), Proj, CPT proj (gold),
// Val (one column — Captain value is identical to FLEX value since Captain price and points are both
// 1.5x), Own FLEX, Own CPT (gold), Notes. No inline editing here (unlike the classic table): the brief's
// column list for Showdown Rankings has no star or edit affordance, only display plus sort and filter.
import { escapeHtml, money, dec1, dec2, textColourFor, logoFor } from "../format.js";
import { TEAM_BY_ABBR } from "../teams-data.js";
import { STATUS_INFO, DIM_STATUS_TOKENS } from "../table.js";

export const SD_COLUMNS = [
  { key: "player", label: "Player" },
  { key: "salary", label: "FLEX $" },
  { key: "cptSalary", label: "CPT $", gold: true },
  { key: "proj", label: "Proj" },
  { key: "cptProj", label: "CPT proj", gold: true },
  { key: "value", label: "Val" },
  { key: "ownFlex", label: "Own FLEX" },
  { key: "ownCpt", label: "Own CPT", gold: true },
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

function statusBadgeHtml(row) {
  const raw = (row.status ?? "").trim();
  const key = raw.toLowerCase();
  const info = STATUS_INFO[key];
  if (info) return `<span class="status-badge ${info.cls}">${escapeHtml(info.label)}</span>`;
  if (raw) return `<span class="status-badge status-other">${escapeHtml(raw)}</span>`;
  return "";
}

function playerCellHtml(row) {
  const t = TEAM_BY_ABBR[row.team];
  const logo = logoFor(t);
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  const textColour = textColourFor(primary, secondary);
  return `
    <div class="player-cell">
      <img class="player-logo" src="${logo}" alt="${escapeHtml(row.team ?? "")}" width="20" height="20" />
      <span class="player-name">${escapeHtml(row.name)}</span>
      <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(row.team ?? "")}</span>
      ${posPillHtml(row.pos)}
      ${statusBadgeHtml(row)}
    </div>`;
}

function gradedValueHtml(row) {
  if (row.value == null || Number.isNaN(row.value)) return "—";
  const cls = row.valueGrade ? ` grade-${row.valueGrade}` : "";
  return `<span class="grade-cell${cls}">${dec2(row.value)}</span>`;
}

// Ownership of every kind renders in the same font (Adam, 2026-09-27); the class only carries the hover text.
// FLEX and Captain ownership each carry their own kind (ownKindFlex/ownKindCpt), so this is called once
// per side with that side's own kind, not a single row-level flag (🔵 review item 4). Every Proj and Own
// cell carries a title explaining exactly how the number was made (brief); a genuinely empty row.ownHow
// falls back to a plain sentence instead of an empty tooltip (👁 visual-qa item E).
function ownCellHtml(value, kind, how, hasProj) {
  if (value == null) {
    const title = how || (hasProj ? "No ownership published for this player." : "No ownership published; no estimate without a projection.");
    return `<span title="${escapeHtml(title)}">—</span>`;
  }
  const cls = kind === "estimate" ? "sd-own-estimate" : "";
  return `<span class="${cls}" title="${escapeHtml(how ?? "")}">${dec1(value)}%</span>`;
}

function projCellHtml(value, row, extraTitlePrefix = "") {
  if (value == null) {
    const title = row.projHow || "No source projects this player.";
    return `<span title="${escapeHtml(title)}">no proj</span>`;
  }
  const title = `${extraTitlePrefix}${row.projHow || ""}`;
  return `<span title="${escapeHtml(title)}">${dec1(value)}</span>`;
}

function noteCellHtml(row) {
  if (!row.note) return "";
  const preview = row.note.length > 40 ? `${row.note.slice(0, 40)}…` : row.note;
  return `<span class="note-preview" title="${escapeHtml(row.note)}">${escapeHtml(preview)}</span>`;
}

function rowHtml(row) {
  const statusKey = (row.status ?? "").trim().toLowerCase();
  const dimmed = DIM_STATUS_TOKENS.has(statusKey);
  return `
    <tr class="rank-row${dimmed ? " row-dimmed" : ""}" data-id="${escapeHtml(String(row.id))}">
      <td>${playerCellHtml(row)}</td>
      <td>${money(row.salary)}</td>
      <td class="sd-cpt-col">${money(row.cptSalary)}</td>
      <td>${projCellHtml(row.proj, row)}</td>
      <td class="sd-cpt-col">${projCellHtml(row.cptProj, row, `Captain: 1.5x price, 1.5x points. `)}</td>
      <td>${gradedValueHtml(row)}</td>
      <td>${ownCellHtml(row.ownFlex, row.ownKindFlex, row.ownHow, row.proj != null)}</td>
      <td class="sd-cpt-col">${ownCellHtml(row.ownCpt, row.ownKindCpt, row.ownHow, row.proj != null)}</td>
      <td class="sd-notes-cell">${noteCellHtml(row)}</td>
    </tr>`;
}

export function renderShowdownTableHead(theadEl, sort, onSortClick) {
  const cells = SD_COLUMNS.map((c) => {
    const arrow = sort.col === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
    const cls = `sortable${sort.col === c.key ? " sorted" : ""}${c.gold ? " sd-cpt-col" : ""}`;
    return `<th data-col="${c.key}" class="${cls}">${escapeHtml(c.label)}${arrow}</th>`;
  }).join("");
  theadEl.innerHTML = `<tr>${cells}</tr>`;
  theadEl.querySelectorAll("th[data-col]").forEach((th) => {
    th.addEventListener("click", () => onSortClick(th.dataset.col));
  });
}

export function renderShowdownTableBody(tbodyEl, rows) {
  tbodyEl.innerHTML = rows.map(rowHtml).join("");
}
