// Rankings table: sticky header, 36px rows, hover highlight, no zebra. Every header sorts asc then desc
// with an arrow (default Value desc, set once at load — not from a click; star and every other numeric
// column default to descending on their own first click, see state.js's defaultDirFor). Proj and Own%
// are editable in place; an override shows a marker plus the base value on hover and a reset icon. Rows
// with a null projection show "no proj" and stay visible (D27). A player nobody published an ownership number
// for shows an em dash in Own% (still click-to-edit, D28); the app never estimates one. The Lev column is
// empty for everyone (Adam 2026-10-15, Lev measure to be redesigned).
//
// Event handling is delegated once onto the tbody element itself (wireDelegation), rather than
// re-attached to every cell on every render: that lets a single row (updateRow) or a single cell
// (restoreCell) be patched in place — on a blur/Escape cancel, or after a failed save — without
// rebuilding the whole tbody and losing whatever the next click was about to land on.
import { escapeHtml, money, dec1, dec2, logoFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { store } from "./state.js";
import { twoGunOutReason, rowIsOut, untagged, revivedStatusTitle } from "./out.js";

const BASE_COLUMNS = [
  { key: "star", label: "★" },
  { key: "player", label: "Player" },
  { key: "pos", label: "Pos" },
  { key: "team", label: "Team" },
  { key: "opp", label: "Opp" },
  { key: "salary", label: "Salary" },
  { key: "proj", label: "Proj" },
  { key: "own", label: "Own%" },
  // Adam 2026-10-17, DQ1 and Q2: Proj/$ is this column (projection per $1,000, value-core.js); the header reads "Proj/$", the key stays "value".
  { key: "value", label: "Proj/$", title: "Proj/$: projection per $1,000 of salary" },
  // Adam 2026-10-15, Lev measure to be redesigned: the column stays, every cell empty, the header says why and does
  // not sort (there is nothing to sort on).
  { key: "lev", label: "Lev", title: "Lev: no measure yet", sortable: false },
  { key: "tags", label: "Tags" },
  { key: "status", label: "Status" },
];
const NOTE_COLUMN = { key: "note", label: "Note" };
export const COLUMNS = BASE_COLUMNS;

// TwoGun mode only (D25 as amended 2026-10-15: his published figures used as he publishes them): six more Rankings
// columns after Lev, each read from row.tg and sortable (state.js sortValue). Current mode never shows them.
export const TG_COLUMNS = [
  { key: "tgMed", label: "Med", field: "median", title: "TwoGun's median, DraftKings points as he publishes them" },
  { key: "tgCeil", label: "Ceil", field: "ceil", title: "TwoGun's ceiling, DraftKings points as he publishes them" },
  // Adam 2026-10-17, DQ1: Ceil/$, his published ceilingPer1k (two decimals as he publishes it), graded like Ceil (D33).
  { key: "tgCeilPer1k", label: "Ceil/$", field: "ceilPer1k", title: "TwoGun's ceiling per $1,000 of salary, as he publishes it" },
  { key: "tgNuke", label: "Nuke", field: "nuke", title: "TwoGun's nuke (top-end) outcome, DraftKings points as he publishes them" },
  { key: "tgP3x", label: "3x%", field: "p3x", title: "TwoGun's chance (percent) of 3x salary value, as he publishes it" },
  { key: "tgP4x", label: "4x%", field: "p4x", title: "TwoGun's chance (percent) of 4x salary value, as he publishes it" },
];

// The columns of the Rankings head and body, in order: Lev, then the TwoGun columns when `twogun`, then Tags onward.
function columnsFor(hasNoteColumn, twogun) {
  const lev = BASE_COLUMNS.findIndex((c) => c.key === "lev");
  const cols = twogun ? [...BASE_COLUMNS.slice(0, lev + 1), ...TG_COLUMNS, ...BASE_COLUMNS.slice(lev + 1)] : BASE_COLUMNS;
  return hasNoteColumn ? [...cols, NOTE_COLUMN] : cols;
}

// Adam 2026-10-15 (TwoGun merge, adjustment 1): "put a red 'OUT' tag or something obvious so
// I can see it". A row ruled out after TwoGun's board stamp (flag "outAfterStamp") or one TwoGun calls OUT carries a
// red OUT tag beside the name on every main-slate list (Rankings, Favorites, Projections, Projected Ownership and the
// Optimizer); on Rankings and Favorites it sits after the logo, before the name, so it never clips (visual QA
// 2026-10-15). Such a row gets no Value grade either. The one copy of the test and the tag: tabs.js and lineup.js import these.
export { twoGunOutReason, rowIsOut };

export function outTagHtml(row) {
  const reason = twoGunOutReason(row);
  return reason ? `<span class="out-tag" title="${escapeHtml(reason)}">OUT</span>` : "";
}

/** R82: the red OUT tag on the Optimizer, keyed on rowIsOut (Out, Doubtful and IR all count). */
export function lineupOutTagHtml(row) {
  if (!rowIsOut(row)) return "";
  let title = twoGunOutReason(row);
  if (!title) {
    const raw = (row.status || row.injury?.status || "").trim();
    const word = raw ? (STATUS_INFO[raw.toLowerCase()]?.label ?? raw) : "out";
    const comment = (row.injury?.comment ?? "").trim();
    title = `Listed ${word} on the injury report${comment ? `. ${comment}` : "."}`;
  }
  return `<span class="out-tag" title="${escapeHtml(title)}">OUT</span>`;
}

// TwoGun-mode markers: the same small amber dot as the A1 marker, its sentences on hover. Nothing shows in current mode
// (rows there carry no tg or src). A figure TwoGun does not cover is the current sources' and says so (row.src).
function markerHtml(texts) {
  const list = texts.filter(Boolean);
  return list.length ? `<sup class="row-flag-marker tg-marker" title="${escapeHtml(list.join(" "))}">&#8226;</sup>` : "";
}

/** The hover sentences for one Rankings cell ("proj", "own", "salary", "ceilPer1k", "status") of a TwoGun-mode row. The game-line
 *  note sits with the status dot: the narrow Opp cell has no room for a dot beside "@ NYG". */
export function twoGunMarkerTexts(row, field) {
  const src = row?.src;
  if (!src && !row?.tg) return [];
  const flags = Array.isArray(row?.flags) ? row.flags : [];
  const tg = row?.tg ?? null;
  const texts = [];
  // Visual QA 2026-10-15: dots only for per-row facts (not projected by TwoGun, salary differs, status changed); the
  // board's staleness is the header's one pill, never a dot or a colour on each figure.
  const projFallback = Boolean(src?.proj && src.proj !== "twogun");
  const ownFallback = Boolean(src?.own && src.own !== "twogun");
  if (field === "proj") {
    if (projFallback) texts.push(`TwoGun does not project him; this is the current sources' blend${ownFallback ? ", and so is his Own%" : ""}.`);
  } else if (field === "own") {
    if (ownFallback && !projFallback) texts.push("TwoGun publishes no ownership for him; this is the current sources' Own%.");
  } else if (field === "salary") {
    if (flags.includes("salaryDiffers")) texts.push(`TwoGun lists ${money(tg?.salary)}; DraftKings' ${money(row.salary)} is used for Proj/$ and the Optimizer (D13).`);
  } else if (field === "ceilPer1k") {
    // Ceil/$ is TwoGun's own figure, computed on his salary, so a row whose salary differs names both salaries.
    if (flags.includes("salaryDiffers")) texts.push(`Ceil/$ is TwoGun's, on his salary ${money(tg?.salary)}; DraftKings lists ${money(row.salary)}.`);
  } else if (field === "status") {
    if (flags.includes("statusChangedAfterStamp")) {
      texts.push(`His status changed after TwoGun's board was made${tg?.official ? ` (TwoGun quoted ${tg.official})` : ""}${rowIsOut(row) ? "." : "; TwoGun's number is kept."}`);
      if (tg?.call) texts.push(`TwoGun's call: ${tg.call}${tg.tag ? ` [${tg.tag}]` : ""}${untagged(tg.callText) ? `: ${untagged(tg.callText)}` : "."}`);
    }
  }
  return texts;
}

// One decimal, as he publishes them (Ceil/$ shows two); the 3x% and 4x% headers carry the percent sign so the narrow cells never clip.
function tgCellHtml(row, col) {
  const v = row.tg?.[col.field];
  if (v == null || Number.isNaN(v)) return "—";
  const shown = (col.field === "ceil" || col.field === "ceilPer1k") && rowIsOut(row) ? 0 : v; // out = ceiling 0 (Adam), as the optimizer scores it; Ceil/$ follows its Ceil
  const text = col.field === "ceilPer1k" ? dec2(shown) : dec1(shown);
  const grade = row.tgGrade?.[col.field]; // Ceil, Ceil/$, Nuke and 4x% are graded like Value (grade.js, D33)
  return grade ? `<span class="grade-cell grade-${grade}">${text}</span>` : text;
}

// Injury-report status words (R82): each gets a badge; which rows dim is rowIsOut's (below).
// Exported so public/js/showdown/table.js and lineup.js can reuse these instead of keeping their own
// copies (🔵 review cleanup).
export const STATUS_INFO = {
  o: { label: "Out", short: "O", cls: "status-out" },
  out: { label: "Out", short: "O", cls: "status-out" },
  d: { label: "Doubtful", short: "D", cls: "status-doubtful" },
  doubtful: { label: "Doubtful", short: "D", cls: "status-doubtful" },
  q: { label: "Questionable", short: "Q", cls: "status-questionable" },
  questionable: { label: "Questionable", short: "Q", cls: "status-questionable" },
  ir: { label: "IR", short: "IR", cls: "status-ir" },
  suspended: { label: "Suspended", short: "SUSP", cls: "status-ir" },
  susp: { label: "Suspended", short: "SUSP", cls: "status-ir" },
  pup: { label: "PUP", short: "PUP", cls: "status-ir" },
  "injured reserve": { label: "IR", short: "IR", cls: "status-ir" },
  suspension: { label: "Suspended", short: "SUSP", cls: "status-ir" },
  "physically unable to perform": { label: "PUP", short: "PUP", cls: "status-ir" },
};

/** The status tag for player lists (never on a lineup): the short word, the full word and notes on hover. */
export function statusBadgeHtml(row, word = row?.status) {
  const raw = (word ?? "").trim();
  if (!raw) return "";
  const info = STATUS_INFO[raw.toLowerCase()];
  const why = untagged(row?.tg?.callText);
  const notes = [(row?.injury?.comment ?? "").trim(), why ? `TwoGun${row.tg.tag ? ` [${row.tg.tag}]` : ""}: ${why}` : ""].filter(Boolean).join(" ");
  const title = (head) => escapeHtml(notes ? `${head}. ${notes}` : head);
  const revived = revivedStatusTitle(row, info?.label ?? raw);
  if (revived) return `<span class="status-badge status-revived" title="${title(revived)}">${escapeHtml(info?.short ?? raw)}</span>`;
  if (info) return `<span class="status-badge ${info.cls}" title="${title(info.label)}">${escapeHtml(info.short)}</span>`;
  return `<span class="status-badge status-other" title="${title(raw)}">${escapeHtml(raw)}</span>`;
}

const PROJ_FLAG_LABELS = {
  thin: "Sources making up less than half the blend's weight cover this player; the projection is theirs alone.",
  avgPoints: "No projection source covers this player; using DraftKings' average points per game instead.",
  imputed: "No DST-specific projection; imputed from average points per game.",
  injured: "Flagged injured; may affect availability this week.",
  injuryUnknown: "No projection: no source covers this player and the injury report is missing, so his average does not stand in.",
};

// Every tag is a researched one (review Q1, Adam 2026-10-14: the computed chalk and value tags are gone); a
// researcher's "chalk" and "value" keep their colours.
function tagClass(tag) {
  if (tag === "chalk") return "tag-pill tag-chalk";
  if (tag === "value") return "tag-pill tag-value";
  return "tag-pill tag-other";
}

/** D43: the matchup as "vs DAL" (his team is at home) or "@ DET" (away), from the game key "AWAY@HOME"; the row's
 *  own opponent text when the game key does not place his team, and blank with neither. The one copy: the Rankings,
 *  Favorites, Projections and Projected Ownership tables and the Optimizer (lineup.js) all use it. */
export function matchupText(row) {
  const m = /^([A-Z0-9]+)@([A-Z0-9]+)$/i.exec(String(row?.gameId ?? ""));
  const team = String(row?.team ?? "").toUpperCase();
  if (m && team && m[2].toUpperCase() === team) return `vs ${m[1]}`;
  if (m && team && m[1].toUpperCase() === team) return `@ ${m[2]}`;
  return row?.opp ? String(row.opp) : "";
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
  const logo = logoFor(TEAM_BY_ABBR[row.team]);
  return `
    <div class="player-cell">
      <img class="player-logo" src="${logo}" alt="${escapeHtml(row.team)}" width="20" height="20" />
      ${outTagHtml(row)}
      <span class="player-name"${row.src ? ` title="${escapeHtml(row.name)}"` : ""}>${escapeHtml(row.name)}</span>
      <span class="note-slot" data-id="${idAttr(row)}">${noteIconHtml(row)}</span>
    </div>`;
}

/**
 * A1: one sentence per blended source that failed for this player's position this run ("sourceFailed:<id>" flags,
 * server/rank/board.js), named by its label: "CBS Sports failed for TE this run and has no cached copy, so Proj is
 * blended without it." `sources`: board.sources (the loaded board's by default); the id stands in for a source the
 * board does not list. Shared by the Rankings and Favorites Proj cell and the Projections tab's Coverage cell.
 */
export function sourceFailedTexts(row, sources = store.get().board?.sources) {
  const labelOf = (id) => (sources ?? []).find((s) => s && s.id === id)?.label ?? id;
  const pos = row?.pos ? String(row.pos) : "his position";
  return (row?.flags ?? [])
    .filter((f) => typeof f === "string" && f.startsWith("sourceFailed:"))
    .map((f) => `${labelOf(f.slice("sourceFailed:".length))} failed for ${pos} this run and has no cached copy, so Proj is blended without it.`);
}

/** A1: the Rankings flag marker (a small dot with the sentences on hover) for the sourceFailed flags alone, or "". */
export function sourceFailedMarkerHtml(row, sources) {
  const texts = sourceFailedTexts(row, sources);
  return texts.length ? `<sup class="row-flag-marker" title="${escapeHtml(texts.join(" "))}">&#8226;</sup>` : "";
}

function projFlagMarkerHtml(row) {
  const flags = row.flags ?? [];
  const present = ["thin", "avgPoints", "imputed", "injured", "injuryUnknown"].filter((f) => flags.includes(f) && !(f === "injured" && flags.includes("revived")));
  const failedText = sourceFailedTexts(row);
  if (!present.length && !failedText.length) return "";
  const title = [...present.map((f) => PROJ_FLAG_LABELS[f] ?? f), ...failedText].join(" ");
  return `<sup class="row-flag-marker" title="${escapeHtml(title)}">&#8226;</sup>`;
}

function editableInnerHtml(row, field, displayHtml, extraHtml = "") {
  const hasOverride = row.override && row.override[field] != null;
  const baseValue = field === "proj" ? row.projBase : row.ownBase;
  const baseDisplay = escapeHtml(baseValue == null ? "none" : dec1(baseValue));
  // A listed-out player resets to 0, not to the blend's projBase (R82: out = 0).
  const out = field === "proj" && (rowIsOut(row) || (row.flags ?? []).includes("revived"));
  const outLabel = escapeHtml(STATUS_INFO[String(row.status ?? "").trim().toLowerCase()]?.label || row.status || "injured");
  const backText = out ? `Back to 0 (listed ${outLabel})` : `Back to the original (${baseDisplay})`;
  // An edited number is coloured (no word beside it); the small x puts the original back.
  const valueAttrs = hasOverride ? ` class="cell-value is-override" title="Your number. ${out ? `Without it: 0 (listed ${outLabel})` : `Original: ${baseDisplay}`}"` : ` class="cell-value"`;
  const resetBtn = hasOverride
    ? `<button type="button" class="reset-icon" data-action="reset-${field}" data-id="${idAttr(row)}" title="${backText}" aria-label="${backText}">&times;</button>`
    : "";
  return `<span${valueAttrs}>${displayHtml}</span>${extraHtml}${resetBtn}`;
}

function projCellInner(row) {
  const display = row.proj == null ? "no proj" : dec1(row.proj);
  return editableInnerHtml(row, "proj", display, projFlagMarkerHtml(row) + markerHtml(twoGunMarkerTexts(row, "proj")));
}

// Own% shows the plain number, whether a named source published it or Adam typed it (D29). A typed number
// is drawn in the amber emphasis colour with a small x to put the original back (D28); a player with no number shows an em dash, which stays click-to-edit so an
// override can still be typed onto it. In TwoGun mode a figure he does not publish carries the hover dot (no letter, D54).
function ownCellInner(row) {
  const mark = markerHtml(twoGunMarkerTexts(row, "own"));
  if (row.own == null) return editableInnerHtml(row, "own", "—", mark);
  return editableInnerHtml(row, "own", `${dec1(row.own)}%`, mark);
}

function cellInnerHtml(row, field) {
  return field === "proj" ? projCellInner(row) : ownCellInner(row);
}

function editableCellHtml(row, field) {
  return `<div class="editable-cell" data-field="${field}" data-id="${idAttr(row)}">${cellInnerHtml(row, field)}</div>`;
}

export function gradedCellHtml(value, grade) {
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

/** The status tag(s) of one player-list row: the board status, then the injury report's word when it adds one. */
export function statusTagsHtml(row) {
  const key = (row.status ?? "").trim().toLowerCase();
  const injuryStatus = row.injury?.status;
  const same = injuryStatus && (injuryStatus.toLowerCase() === key || (STATUS_INFO[key] && STATUS_INFO[key].label === STATUS_INFO[injuryStatus.toLowerCase()]?.label));
  const injuryHtml = injuryStatus && !same ? statusBadgeHtml({ ...row, tg: key ? null : row.tg, injury: key ? { ...row.injury, comment: "" } : row.injury, flags: [] }, injuryStatus) : "";
  return `${statusBadgeHtml(row)}${injuryHtml}`;
}

/** Whether a row shows any status tag. */
export function rowHasStatus(row) {
  return Boolean((row?.status ?? "").trim() || (row?.injury?.status ?? "").trim());
}

// R82: one OUT mark per row; the red OUT tag replaces the status tags.
function statusCellHtml(row) {
  return `${outTagHtml(row) ? "" : statusTagsHtml(row)}${markerHtml(twoGunMarkerTexts(row, "status"))}`;
}

function noteCellHtml(row) {
  if (!row.note) return "";
  const preview = row.note.length > 28 ? `${row.note.slice(0, 28)}…` : row.note;
  return `<span class="note-preview" title="${escapeHtml(row.note)}">${escapeHtml(preview)}</span>`;
}

// TwoGun mode: the six TwoGun cells after Lev, plain (a stale board is the header pill's to say, visual QA 2026-10-15).
function tgCellsHtml(row) {
  return TG_COLUMNS.map((c) => {
    const tip = twoGunMarkerTexts(row, c.field).join(" ");
    return `<td class="tg-col"${tip ? ` title="${escapeHtml(tip)}"` : ""}>${tgCellHtml(row, c)}</td>`;
  }).join("");
}

function rowHtml(row, hasNoteColumn, twogun = false) {
  const dimmed = rowIsOut(row);
  return `
    <tr class="rank-row${dimmed ? " row-dimmed" : ""}" data-id="${idAttr(row)}">
      <td><button type="button" class="star-btn${row.starred ? " active" : ""}" data-action="toggle-star" data-id="${idAttr(row)}">${row.starred ? "★" : "☆"}</button></td>
      <td>${playerCellHtml(row)}</td>
      <td>${escapeHtml(row.pos)}</td>
      <td>${escapeHtml(row.team)}</td>
      <td>${escapeHtml(matchupText(row))}</td>
      <td>${money(row.salary)}${markerHtml(twoGunMarkerTexts(row, "salary"))}</td>
      <td>${editableCellHtml(row, "proj")}</td>
      <td>${editableCellHtml(row, "own")}</td>
      <td>${gradedCellHtml(row.value, row.valueGrade)}</td>
      <td></td>
      ${twogun ? tgCellsHtml(row) : ""}
      <td class="tags-cell" title="${escapeHtml(tagsCellTitle(row))}">${tagsCellHtml(row)}</td>
      <td class="status-cell">${statusCellHtml(row)}</td>
      ${hasNoteColumn ? `<td${row.note ? ` title="${escapeHtml(row.note)}"` : ""}>${noteCellHtml(row)}</td>` : ""}
    </tr>`;
}

// `opts.twogun`: the Rankings table in TwoGun mode adds the TG_COLUMNS and marks the <table> "tg-on" (style.css sizes
// its columns to stay inside D54's 1250px). Favorites passes nothing, so it never shows them.
export function renderTableHead(theadEl, sort, onSortClick, hasNoteColumn = false, opts = {}) {
  const twogun = Boolean(opts.twogun);
  const cols = columnsFor(hasNoteColumn, twogun);
  const cells = cols
    .map((c) => {
      const title = c.title ? ` title="${escapeHtml(c.title)}"` : "";
      // A column with nothing to sort on (Lev) has no data-col, so no click handler, and no sortable class.
      if (c.sortable === false) return `<th class="not-sortable"${title}>${escapeHtml(c.label)}</th>`;
      const arrow = sort.col === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
      const tgCls = c.field ? " tg-col" : "";
      return `<th data-col="${c.key}" class="sortable${sort.col === c.key ? " sorted" : ""}${tgCls}"${title}>${escapeHtml(c.label)}${arrow}</th>`;
    })
    .join("");
  theadEl.closest?.("table")?.classList.toggle("tg-on", twogun);
  theadEl.innerHTML = `<tr>${cells}</tr>`;
  theadEl.querySelectorAll("th[data-col]").forEach((th) => {
    th.addEventListener("click", () => onSortClick(th.dataset.col));
  });
}

// Module-level "what's on screen right now" so the one delegated tbody listener (wired once, see
// wireDelegation) always reads the current rows/callbacks without needing to be re-attached.
let currentRows = [];
let currentCallbacks = null;
let currentTwoGun = false; // whether the body on screen carries the TwoGun columns (updateRow redraws a row the same way)

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

// ChatGPT wish q, Adam 2026-10-17: shown under an open Proj or Own% editor (blur cancels too, as Esc does).
export const EDIT_HINT = "Enter saves · Esc cancels";

export function startEdit(cellEl, id, field, currentValue, onCommit) {
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
  const hintEl = document.createElement("div");
  hintEl.className = "cell-edit-hint";
  hintEl.textContent = EDIT_HINT;
  wrap.appendChild(input);
  wrap.appendChild(hintEl);
  wrap.appendChild(errorEl);
  cellEl.innerHTML = "";
  cellEl.appendChild(wrap);
  input.focus();
  input.select();

  let done = false;
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    hintEl.hidden = true; // the message takes the hint's place under the box
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

export function renderTableBody(tbodyEl, rows, callbacks, hasNoteColumn = false, opts = {}) {
  currentRows = rows;
  currentCallbacks = callbacks;
  currentTwoGun = Boolean(opts.twogun);
  tbodyEl.innerHTML = rows.map((r) => rowHtml(r, hasNoteColumn, currentTwoGun)).join("");
  wireDelegation(tbodyEl);
}

/** Re-renders exactly one row in place (a failed save must never leave an input open, but must also
 * never disturb any other row's scroll position, open editor or in-flight click). */
export function updateRow(tbodyEl, row, hasNoteColumn = false) {
  currentRows = currentRows.map((r) => (String(r.id) === String(row.id) ? row : r));
  const tr = tbodyEl.querySelector(`tr[data-id="${cssEscapeId(row.id)}"]`);
  if (tr) tr.outerHTML = rowHtml(row, hasNoteColumn, currentTwoGun);
}
