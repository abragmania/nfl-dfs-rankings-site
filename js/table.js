// Rankings table: sticky header, 36px rows, hover highlight, no zebra. Every header sorts asc then desc
// with an arrow (default Value desc, set once at load — not from a click; star and every other numeric
// column default to descending on their own first click, see state.js's defaultDirFor). Proj and Own%
// are editable in place; an override shows a marker plus the base value on hover and a reset icon. Rows
// with a null projection show "no proj" and stay visible (D27). A player nobody published an ownership number
// for shows an em dash in Own% (still click-to-edit, D28) and a blank Lev; the app never estimates one.
//
// Event handling is delegated once onto the tbody element itself (wireDelegation), rather than
// re-attached to every cell on every render: that lets a single row (updateRow) or a single cell
// (restoreCell) be patched in place — on a blur/Escape cancel, or after a failed save — without
// rebuilding the whole tbody and losing whatever the next click was about to land on.
import { escapeHtml, money, dec1, dec2, textColourFor, logoFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";

const BASE_COLUMNS = [
  { key: "star", label: "★" },
  { key: "player", label: "Player" },
  { key: "pos", label: "Pos" },
  { key: "team", label: "Team" },
  { key: "opp", label: "Opp" },
  { key: "salary", label: "Salary" },
  { key: "proj", label: "Proj" },
  { key: "own", label: "Own%" },
  { key: "value", label: "Value" },
  { key: "lev", label: "Lev" },
  { key: "tags", label: "Tags" },
  { key: "status", label: "Status" },
];
const NOTE_COLUMN = { key: "note", label: "Note" };
export const COLUMNS = BASE_COLUMNS;

// DK status tokens (D11/D32 context): O/OUT/IR/D/DOUBTFUL dim the row; Q/QUESTIONABLE and SUSPENDED get
// a badge but stay at full opacity.
// Exported so public/js/showdown/table.js and lineup.js can reuse these instead of keeping their own
// copies (🔵 review cleanup).
export const STATUS_INFO = {
  o: { label: "Out", cls: "status-out" },
  out: { label: "Out", cls: "status-out" },
  d: { label: "Doubtful", cls: "status-doubtful" },
  doubtful: { label: "Doubtful", cls: "status-doubtful" },
  q: { label: "Questionable", cls: "status-questionable" },
  questionable: { label: "Questionable", cls: "status-questionable" },
  ir: { label: "IR", cls: "status-ir" },
  suspended: { label: "Suspended", cls: "status-ir" },
};
export const DIM_STATUS_TOKENS = new Set(["o", "out", "ir", "d", "doubtful"]);

const PROJ_FLAG_LABELS = {
  thin: "Thin coverage: fewer than half the enabled sources cover this player, so the projection is shrunk toward a baseline.",
  avgPoints: "No projection source covers this player; using DraftKings' average points per game instead.",
  imputed: "No DST-specific projection; imputed from average points per game.",
  injured: "Flagged injured; may affect availability this week.",
};

function tagClass(tag) {
  if (tag === "chalk") return "tag-pill tag-chalk";
  if (tag === "value") return "tag-pill tag-value";
  return "tag-pill tag-other";
}

function idAttr(row) {
  return escapeHtml(String(row.id));
}

function noteIconHtml(row) {
  const has = Boolean(row.note);
  const title = has ? row.note : "Add a note";
  return `<button type="button" class="note-icon${has ? " has-note" : ""}" data-action="edit-note" data-id="${idAttr(row)}" title="${escapeHtml(title)}">&#9998;</button>`;
}

function playerCellHtml(row) {
  const t = TEAM_BY_ABBR[row.team];
  const logo = logoFor(t);
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  const textColour = textColourFor(primary, secondary);
  return `
    <div class="player-cell">
      <img class="player-logo" src="${logo}" alt="${escapeHtml(row.team)}" width="20" height="20" />
      <span class="player-name">${escapeHtml(row.name)}</span>
      <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(row.team)}</span>
      <span class="note-slot" data-id="${idAttr(row)}">${noteIconHtml(row)}</span>
    </div>`;
}

function projFlagMarkerHtml(row) {
  const present = ["thin", "avgPoints", "imputed", "injured"].filter((f) => (row.flags ?? []).includes(f));
  if (!present.length) return "";
  const title = present.map((f) => PROJ_FLAG_LABELS[f] ?? f).join(" ");
  return `<sup class="row-flag-marker" title="${escapeHtml(title)}">&#8226;</sup>`;
}

function editableInnerHtml(row, field, displayHtml, extraHtml = "") {
  const hasOverride = row.override && row.override[field] != null;
  const baseValue = field === "proj" ? row.projBase : row.ownBase;
  const baseDisplay = baseValue == null ? (field === "proj" ? "no proj" : "no own") : dec1(baseValue);
  const marker = hasOverride
    ? `<span class="override-marker" title="Base: ${escapeHtml(String(baseDisplay))}">edited</span>
       <button type="button" class="reset-icon" data-action="reset-${field}" data-id="${idAttr(row)}" title="Reset to base value">&#8630;</button>`
    : "";
  return `<span class="cell-value">${displayHtml}</span>${extraHtml}${marker}`;
}

function projCellInner(row) {
  const display = row.proj == null ? "no proj" : dec1(row.proj);
  return editableInnerHtml(row, "proj", display, projFlagMarkerHtml(row));
}

// Own% shows the plain number (D32). A number is either published by a named source (a small "q" superscript
// with the detail on hover) or typed in by Adam (the "edited" marker); anybody else is blank and shows an em
// dash, which stays click-to-edit so an override can still be typed onto it (D28).
function ownCellInner(row) {
  if (row.own == null) return editableInnerHtml(row, "own", "—");
  const sup = row.ownKind === "quoted" && row.override?.own == null
    ? `<sup class="own-kind own-kind-quoted" title="Published by a named source">q</sup>`
    : "";
  return editableInnerHtml(row, "own", `${dec1(row.own)}%`, sup);
}

function cellInnerHtml(row, field) {
  return field === "proj" ? projCellInner(row) : ownCellInner(row);
}

function editableCellHtml(row, field) {
  return `<div class="editable-cell" data-field="${field}" data-id="${idAttr(row)}">${cellInnerHtml(row, field)}</div>`;
}

function gradedCellHtml(value, grade) {
  if (value == null || Number.isNaN(value)) return "—";
  const cls = grade ? ` grade-${grade}` : "";
  return `<span class="grade-cell${cls}">${dec2(value)}</span>`;
}

function tagsCellHtml(row) {
  if (!row.tags || !row.tags.length) return "";
  return row.tags
    .map((t) => {
      const reason = t.reason ?? "";
      // No character cap here (👁 visual-qa third pass): the Tags cell's own nowrap/ellipsis (.tag-reason,
      // style.css) already trims to whatever width the column actually has, so a fixed 55-char cut was
      // sometimes shorter than the room available and other times still overflowing. The full reason is
      // still the hover title on the pill itself, on the reason span, and on the cell as a whole (👁
      // visual-qa fourth pass) since the ellipsis can land mid-word with no other way to read the rest.
      const pill = `<span class="${tagClass(t.tag)}" title="${escapeHtml(reason)} — ${escapeHtml(t.source ?? "")}">${escapeHtml(t.tag)}</span>`;
      const reasonHtml = reason ? `<span class="tag-reason" title="${escapeHtml(reason)}">${escapeHtml(reason)}</span>` : "";
      return `<span class="tag-item">${pill}${reasonHtml}</span>`;
    })
    .join(" ");
}

// Full, untrimmed reason text for every tag in the cell, used as the tags-cell <td> title so hovering
// anywhere in the cell (not just the pill or reason span) reveals what the ellipsis cut off (👁 visual-qa
// fourth pass).
function tagsCellTitle(row) {
  if (!row.tags || !row.tags.length) return "";
  return row.tags
    .map((t) => (t.reason ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

function statusCellHtml(row) {
  const raw = (row.status ?? "").trim();
  const key = raw.toLowerCase();
  const info = STATUS_INFO[key];
  const badge = info
    ? `<span class="status-badge ${info.cls}">${escapeHtml(info.label)}</span>`
    : raw
      ? `<span class="status-badge status-other">${escapeHtml(raw)}</span>`
      : "";
  const injuryStatus = row.injury?.status;
  const injuryHtml =
    injuryStatus && injuryStatus.toLowerCase() !== key
      ? `<span class="status-injury-note" title="${escapeHtml(injuryStatus)}">${escapeHtml(injuryStatus)}</span>`
      : "";
  return `${badge}${injuryHtml}`;
}

function noteCellHtml(row) {
  if (!row.note) return "";
  const preview = row.note.length > 28 ? `${row.note.slice(0, 28)}…` : row.note;
  return `<span class="note-preview" title="${escapeHtml(row.note)}">${escapeHtml(preview)}</span>`;
}

function rowHtml(row, hasNoteColumn) {
  const statusKey = (row.status ?? "").trim().toLowerCase();
  const dimmed = DIM_STATUS_TOKENS.has(statusKey) || (row.flags ?? []).includes("injured");
  return `
    <tr class="rank-row${dimmed ? " row-dimmed" : ""}" data-id="${idAttr(row)}">
      <td><button type="button" class="star-btn${row.starred ? " active" : ""}" data-action="toggle-star" data-id="${idAttr(row)}">${row.starred ? "★" : "☆"}</button></td>
      <td>${playerCellHtml(row)}</td>
      <td>${escapeHtml(row.pos)}</td>
      <td>${escapeHtml(row.team)}</td>
      <td>${escapeHtml(row.opp ?? "")}</td>
      <td>${money(row.salary)}</td>
      <td>${editableCellHtml(row, "proj")}</td>
      <td>${editableCellHtml(row, "own")}</td>
      <td>${gradedCellHtml(row.value, row.valueGrade)}</td>
      <td>${gradedCellHtml(row.lev, row.levGrade)}</td>
      <td class="tags-cell" title="${escapeHtml(tagsCellTitle(row))}">${tagsCellHtml(row)}</td>
      <td class="status-cell">${statusCellHtml(row)}</td>
      ${hasNoteColumn ? `<td>${noteCellHtml(row)}</td>` : ""}
    </tr>`;
}

export function renderTableHead(theadEl, sort, onSortClick, hasNoteColumn = false) {
  const cols = hasNoteColumn ? [...BASE_COLUMNS, NOTE_COLUMN] : BASE_COLUMNS;
  const cells = cols
    .map((c) => {
      const arrow = sort.col === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
      return `<th data-col="${c.key}" class="sortable${sort.col === c.key ? " sorted" : ""}">${escapeHtml(c.label)}${arrow}</th>`;
    })
    .join("");
  theadEl.innerHTML = `<tr>${cells}</tr>`;
  theadEl.querySelectorAll("th[data-col]").forEach((th) => {
    th.addEventListener("click", () => onSortClick(th.dataset.col));
  });
}

// Module-level "what's on screen right now" so the one delegated tbody listener (wired once, see
// wireDelegation) always reads the current rows/callbacks without needing to be re-attached.
let currentRows = [];
let currentCallbacks = null;

function cssEscapeId(id) {
  const s = String(id);
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}

function findCurrentRow(id) {
  return currentRows.find((r) => String(r.id) === String(id));
}

/** Restores one cell (proj or own) to its non-editing display — used by Escape/blur/empty-Enter cancel
 * so the rest of the table is left completely untouched (finding: no full tbody re-render on cancel). */
function restoreCell(cellEl, id, field) {
  const row = findCurrentRow(id);
  if (!row) return;
  cellEl.innerHTML = cellInnerHtml(row, field);
}

function startEdit(cellEl, id, field, currentValue, onCommit) {
  const wrap = document.createElement("span");
  wrap.className = "cell-edit-wrap";
  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.1";
  input.className = "cell-edit-input";
  // Prefill rounded to one decimal (Adam, 2026-09-27): the board carries full precision, the box must not.
  input.value = currentValue == null ? "" : (typeof currentValue === "number" ? String(Math.round(currentValue * 10) / 10) : currentValue);
  const errorEl = document.createElement("div");
  errorEl.className = "cell-edit-error";
  errorEl.hidden = true;
  wrap.appendChild(input);
  wrap.appendChild(errorEl);
  cellEl.innerHTML = "";
  cellEl.appendChild(wrap);
  input.focus();
  input.select();

  let done = false;
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  };
  const cancel = () => {
    if (done) return;
    done = true;
    onCommit(null);
  };
  const commit = () => {
    if (done) return;
    const raw = input.value.trim();
    if (raw === "") {
      cancel(); // empty input on Enter = cancel, not delete; the explicit reset icon sends null
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      showError("Enter a number.");
      input.focus();
      return;
    }
    if (field === "proj" && parsed < 0) {
      showError("Projection must be 0 or greater.");
      input.focus();
      return;
    }
    if (field === "own" && (parsed < 0 || parsed > 100)) {
      showError("Ownership must be between 0 and 100.");
      input.focus();
      return;
    }
    done = true;
    onCommit(id, field, parsed);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") cancel();
  });
  input.addEventListener("blur", () => {
    if (!done) cancel();
  });
}

function startNoteEdit(iconEl) {
  const id = iconEl.dataset.id;
  const row = findCurrentRow(id);
  const slot = iconEl.closest(".note-slot");
  if (!row || !slot || slot.querySelector("input")) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "note-edit-input";
  input.maxLength = 300;
  input.value = row.note ?? "";
  slot.innerHTML = "";
  slot.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) {
      const text = input.value.trim();
      currentCallbacks?.onEditNote?.(id, text === "" ? null : text);
    } else {
      slot.innerHTML = noteIconHtml(row);
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(false));
}

function wireDelegation(tbodyEl) {
  if (tbodyEl.dataset.wired === "1") return;
  tbodyEl.dataset.wired = "1";
  tbodyEl.addEventListener("click", (e) => {
    const starBtn = e.target.closest("[data-action='toggle-star']");
    if (starBtn) {
      currentCallbacks?.onToggleStar?.(starBtn.dataset.id);
      return;
    }
    const resetBtn = e.target.closest(".reset-icon");
    if (resetBtn) {
      const field = resetBtn.dataset.action === "reset-own" ? "own" : "proj";
      currentCallbacks?.onResetField?.(resetBtn.dataset.id, field);
      return;
    }
    const noteIcon = e.target.closest("[data-action='edit-note']");
    if (noteIcon) {
      startNoteEdit(noteIcon);
      return;
    }
    const cellEl = e.target.closest(".editable-cell");
    if (cellEl) {
      if (cellEl.querySelector("input")) return; // already editing
      const { id, field } = cellEl.dataset;
      const row = findCurrentRow(id);
      if (!row) return;
      const current = field === "proj" ? row.proj : row.own;
      startEdit(cellEl, id, field, current, (idOrNull, maybeField, maybeValue) => {
        if (idOrNull == null) {
          restoreCell(cellEl, id, field);
          return;
        }
        currentCallbacks?.onEditValue?.(idOrNull, maybeField, maybeValue);
      });
    }
  });
}

export function renderTableBody(tbodyEl, rows, callbacks, hasNoteColumn = false) {
  currentRows = rows;
  currentCallbacks = callbacks;
  tbodyEl.innerHTML = rows.map((r) => rowHtml(r, hasNoteColumn)).join("");
  wireDelegation(tbodyEl);
}

/** Re-renders exactly one row in place (a failed save must never leave an input open, but must also
 * never disturb any other row's scroll position, open editor or in-flight click). */
export function updateRow(tbodyEl, row, hasNoteColumn = false) {
  currentRows = currentRows.map((r) => (String(r.id) === String(row.id) ? row : r));
  const tr = tbodyEl.querySelector(`tr[data-id="${cssEscapeId(row.id)}"]`);
  if (tr) tr.outerHTML = rowHtml(row, hasNoteColumn);
}
