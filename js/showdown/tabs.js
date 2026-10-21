// Showdown tabs: Rankings and Optimizer, as classic keeps its own (Adam 2026-10-18). The header's Sources button opens ONE Sources page
// (public/js/sources-page.js, shared with classic: which sources, their weights, when each was pulled); under its Players heading a
// Projections | Ownership switch picks one of the two panels in this file (view.js draws them, with public/js/tabs.js SOURCE_TABS).
// Rankings is rendered by view.js/table.js; the Optimizer's real implementation lives in lineup.js (its key stays "lineup")
// and is re-exported at the bottom of this file, mirroring how public/js/tabs.js re-exports its own
// renderLineupPanel from public/js/lineup.js.
//
// Classic's Projections table (public/js/tabs.js renderProjectionsPanel) hard-codes `s.kind === "projection"` and a QB/RB/WR/TE/DST
// paste box a showdown never needs (it rosters kickers, so only a kicker paste makes sense), and keeps its paste result in a
// module-level variable shared with the classic page, so this file keeps its own single kicker paste box.
import { escapeHtml, dec1, localStamp } from "../format.js";
import { shownRows, ownTitleText, sdLine } from "./table.js";
import { showAllToggleHtml, wireShowAllButtons } from "../filterbar.js";
import { store, sortRows, defaultDirFor } from "../state.js";
import { sortableHeadHtml, unusedColumn, onSitePage } from "../tabs.js"; // the classic sortable header (also imported by lineup-lists.js) and its dimmed unused-source column
import { sourceIsTicked } from "../sources-page-html.js"; // the one tick predicate the Sources page and this table share
import { snapPanelMaxHeight } from "../lineup.js"; // the classic tables' sizing step, the copy the Optimizer lists already import (lineup-lists.js)

// Fits the table's scroll box to the room below its top edge, as app.js adjustScrollPanels does for classic's tables (the last whole row that
// fits), so the page does not scroll beside the box. Needed here because the Sources page reads its selection after the first draw and then
// redraws this table (view.js onSelection): the new box carries no height until something sizes it, and no resize event follows that redraw.
function fitScrollPanel(container) {
  if (typeof window === "undefined") return;
  const panel = container.querySelector?.(".scroll-panel");
  if (panel) snapPanelMaxHeight(panel, panel.getBoundingClientRect().top, 16);
}

export const SHOWDOWN_TABS = Object.freeze([
  Object.freeze({ key: "rankings", label: "Rankings" }),
  Object.freeze({ key: "lineup", label: "Optimizer" }),
  Object.freeze({ key: "entries", label: "Entries" }), // Showdown Entries plan 2026-10-20: Adam's private entries files, so the app only (visibleShowdownTabs)
]);

/** The tabs to draw: all of them in the app, all but Entries on the public site (as tabs.js visibleTabs does for classic). */
export function visibleShowdownTabs(onSite = onSitePage()) {
  return SHOWDOWN_TABS.filter((t) => !(onSite && t.key === "entries"));
}

export function renderShowdownTabs(container, activeTab, onTabClick) {
  container.innerHTML = visibleShowdownTabs().map(
    (t) => `<button type="button" class="tab-btn${t.key === activeTab ? " active" : ""}" data-tab="${t.key}">${escapeHtml(t.label)}</button>`
  ).join("");
  container.querySelectorAll(".tab-btn").forEach((el) => {
    el.addEventListener("click", () => onTabClick(el.dataset.tab));
  });
}

// Kept at module level, own name (not shared with classic's own paste-result variable, 🔵 review item 9),
// so it survives the board reload that follows a successful submit.
let sdPasteResultText = null;

// ---- The sortable table both panels draw (head and body rebuilt on a sort click; the wrapper keeps its height and scroll position) ----

const ownState = { sort: { col: "ownFlex", dir: "desc" } }; // survives the re-render a board refresh or "Show all players" causes
const projState = { sort: { col: "proj", dir: "desc" } };
// Player starts A to Z; every number column starts high to low (the classic pattern; state.js defaultDirFor serves the text columns).
const numberFirstDir = (numberCols) => (col) => (numberCols.has(col) ? "desc" : defaultDirFor(col));

function wireSortHeads(container, state, dirFor, partsFor) {
  container.querySelectorAll("th[data-col]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      state.sort = state.sort.col === col ? { col, dir: state.sort.dir === "asc" ? "desc" : "asc" } : { col, dir: dirFor(col) };
      const next = partsFor(state.sort);
      container.querySelector(".source-value-table thead").innerHTML = next.head;
      container.querySelector(".source-value-table tbody").innerHTML = next.body;
      wireSortHeads(container, state, dirFor, partsFor);
    });
  });
}

// The shared Showdown player row (table.js sdLine, D80); the cell carries the id that opens his card.
const playerCellHtml = (r) => `<td data-card-id="${escapeHtml(String(r.id))}"><span class="player-cell">${sdLine(r)}</span></td>`;
// A figure cell; an unused source's column carries its dimming class (classic's, tabs.js UNUSED_COL).
const figureCellHtml = (c, v, title = "") => `<td${c.cls ? ` class="${escapeHtml(c.cls)}"` : ""}${title}>${v == null ? "—" : dec1(v)}</td>`;

/**
 * The one sentence under an all-dash table (👁 finding 12): the server's own note for each ticked source that has no figures (for
 * TwoGun, "TwoGun hasn't posted Showdown projections for this game yet."), once each; "" when any figure shows or no such note exists.
 * `selections` is a list of sources-page.js sectionSources lists ([{id, label, use, status, note}]), one per section the table draws from.
 */
export function allDashNote(allBlank, selections) {
  if (!allBlank) return "";
  const notes = selections.flat().filter((s) => s?.use && s.status !== "ok" && s.status !== "cached" && s.note).map((s) => s.note);
  return [...new Set(notes)].join(" ");
}

// ---- Projections table (as classic's): Player, the blended Proj, each ticked projection source's figure, then each unticked one, dimmed ----
// `selection`: the Sources page's sources for this slate, ticked or not (sources-page.js sectionSources), which win; null until the page has
// read them (or an empty list), then the board's own source list stands in.
function projectionColumns(sources, selection = null) {
  const list = selection?.length ? selection
    : sources.filter((s) => s.kind === "projection").map((s) => ({ id: s.id, label: s.label ?? s.id, use: sourceIsTicked(s) }));
  return [
    { key: "player", label: "Player" },
    { key: "proj", label: "Proj" },
    ...list.filter((s) => s.use).map((s) => ({ key: `src:${s.id}`, label: s.label ?? s.id })),
    ...list.filter((s) => !s.use).map((s) => unusedColumn(`src:${s.id}`, s.label ?? s.id)),
  ];
}

function projectionValueOf(r, col) {
  if (col === "player") return r.name ?? null;
  if (col === "proj") return r.proj ?? null;
  return r.sources?.[col.slice(4)] ?? null;
}

function projectionRowHtml(r, cols) {
  const cells = cols.slice(1).map((c) => figureCellHtml(c, projectionValueOf(r, c.key), c.key === "proj" && r.projHow ? ` title="${escapeHtml(r.projHow)}"` : ""));
  return `<tr>${playerCellHtml(r)}${cells.join("")}</tr>`;
}

/** The Projections table's thead and tbody HTML for a sort (pure). */
export function projectionTableParts(rows, sources, sort, selection = null) {
  const cols = projectionColumns(sources, selection);
  const sorted = sortRows(rows, sort.col, sort.dir, projectionValueOf);
  return { cols, head: sortableHeadHtml(cols, sort, true), body: sorted.map((r) => projectionRowHtml(r, cols)).join("") };
}

// Projections panel: the one paste box this mode ever needs — the FantasyPros kicker page, always {pos:"k", text} — classic's own
// QB/RB/WR/TE/DST paste box is never shown here since showdown reuses the classic projection blend as-is and only
// kickers are showdown's own paste; under it the sortable table. The sources behind the numbers are the Sources page above it.
export function renderShowdownProjectionsPanel(container, board, callbacks) {
  const rows = shownRows(board.rows ?? []);
  const sources = board.sources ?? [];
  const selection = callbacks.selection ?? null;
  if (!projectionColumns(sources, selection).some((c) => c.key === projState.sort.col)) projState.sort = { col: "proj", dir: "desc" }; // a source no longer listed
  const parts = projectionTableParts(rows, sources, projState.sort, selection);
  const dash = allDashNote(rows.length > 0 && rows.every((r) => r.proj == null), [selection ?? []]);
  container.innerHTML = `
    <details class="paste-box sd-kicker-paste">
      <summary>Paste the FantasyPros kicker page</summary>
      <textarea id="sd-kicker-paste-text" rows="8" placeholder="Paste the whole FantasyPros kicker page here"></textarea>
      <div class="paste-box-controls">
        <button type="button" id="sd-kicker-paste-submit">Submit</button>
      </div>
      <div id="sd-kicker-paste-result" class="paste-result">${sdPasteResultText ? escapeHtml(sdPasteResultText) : ""}</div>
    </details>
    <p class="tab-note">${showAllToggleHtml(store.get().filters.showAllPlayers, `data-action="show-all"`)} Blended from the projection sources ticked above. Hover a Proj figure for how it was made; every column sorts.</p>
    ${dash ? `<p class="tab-note sd-all-dash">${escapeHtml(dash)}</p>` : ""}
    <div class="tab-table-wrap scroll-panel">
      <table class="source-value-table sd-fit">
        <thead>${parts.head}</thead>
        <tbody>${parts.body}</tbody>
      </table>
    </div>
  `;
  wireShowAllButtons(container);
  fitScrollPanel(container);
  wireSortHeads(container, projState, numberFirstDir(new Set(parts.cols.slice(1).map((c) => c.key))), (sort) => projectionTableParts(rows, sources, sort, selection));

  container.querySelector("#sd-kicker-paste-submit")?.addEventListener("click", async () => {
    const text = container.querySelector("#sd-kicker-paste-text").value;
    const resultEl = container.querySelector("#sd-kicker-paste-result");
    sdPasteResultText = null;
    resultEl.textContent = "Submitting...";
    try {
      const data = await callbacks.onPaste({ pos: "k", text });
      if (data.ok) {
        const rowCount = Array.isArray(data.rows) ? data.rows.length : 0;
        // The paste route's response shape is {rows, dropped, board}; unmatched kicker names live at
        // board.unmatched.kickers["k:fantasypros"] (🔵 review item 3), not on the paste response itself.
        const unmatchedNames = data.board?.unmatched?.kickers?.["k:fantasypros"] ?? [];
        const unmatchedText = unmatchedNames.length ? `: ${unmatchedNames.join(", ")}` : "";
        sdPasteResultText = `Parsed ${rowCount} rows, dropped ${data.dropped ?? 0}, unmatched ${unmatchedNames.length}${unmatchedText}.`;
      } else {
        sdPasteResultText = `Paste failed: ${data.error?.message ?? "unknown error"}`;
      }
    } catch (e) {
      sdPasteResultText = `Paste failed: ${e.message}`;
    }
    // resultEl set via textContent, not innerHTML, so no HTML-escaping is needed for the unmatched names.
    const freshResultEl = container.querySelector("#sd-kicker-paste-result");
    if (freshResultEl) freshResultEl.textContent = sdPasteResultText;
  });
}

/** A source's notes as a list: the file's `notes` (array) and its `note` (string, which most ownership files use). */
export function sourceNoteList(s) {
  const list = Array.isArray(s?.notes) ? s.notes : [];
  const one = typeof s?.note === "string" ? [s.note] : [];
  return [...list, ...one].map((n) => String(n).trim()).filter(Boolean);
}

// "published" | "estimate" | "override" | null, labelled plainly (🔵 review item 4: override reads "your override", not the
// internal token; a name a named source published reads "published", never "quoted"; the sim's figure reads
// "our estimate", D29 as amended); null is missing (D29).
function kindLabel(kind) {
  if (kind === "published") return "published";
  if (kind === "estimate") return "our estimate";
  if (kind === "override") return "your override";
  return "—";
}

// ---- Projected Ownership table (Adam 2026-10-18 9:13 PM: sortable, no per-row recipe column, no repeated sentence) ----
// Columns: Player (the shared player row, which shows his team), Own FLEX, Own CPT, and the two Kind columns only when the figures on the
// table are not all one kind (published / our estimate / your override); when every figure is one kind, the line above the table says so
// once (D29 as amended); then each source's FLEX and CPT figure (ownSourceColumns). Headers are the classic sortable ones (public/js/tabs.js
// sortableHeadHtml, state.js sortRows: a blank last either way). The method of a figure (D41) is its hover, and only where it says more
// than the cell does.

// The kinds present on any figure the table shows (a missing figure has none).
function ownKindsPresent(rows) {
  const kinds = new Set();
  for (const r of rows) {
    if (r.ownFlex != null && r.ownKindFlex) kinds.add(r.ownKindFlex);
    if (r.ownCpt != null && r.ownKindCpt) kinds.add(r.ownKindCpt);
  }
  return kinds;
}

// A source's name in a column header: its label without a trailing "(...)" ("TwoGun (Showdown ownership column)" reads "TwoGun").
const shortLabel = (label) => String(label).replace(/\s*\([^)]*\)\s*$/, "");

/**
 * The by-source columns after the blended figures (👁 finding 12, as classic's Ownership table shows each source): for each source, its
 * FLEX figure and its Captain figure (the board rows' ownFlexBySource / ownCptBySource), dimmed where that section does not tick it.
 * `flex` and `cpt` are the Sources page's two ownership sections (sources-page.js sectionSources); before the page has read them the
 * board's ownership sources stand in (used = the board's ownershipUsedIds), with any other source a row carries a figure for.
 */
export function ownSourceColumns(board, rows, flex = null, cpt = null) {
  let list;
  if (flex?.length || cpt?.length) {
    const byId = new Map();
    for (const [side, sel] of [["f", flex ?? []], ["c", cpt ?? []]]) {
      for (const s of sel) {
        const e = byId.get(s.id) ?? { id: s.id, label: s.label ?? s.id, f: null, c: null };
        e[side] = Boolean(s.use);
        byId.set(s.id, e);
      }
    }
    list = [...byId.values()];
  } else {
    const usedIds = Array.isArray(board?.ownershipUsedIds) ? board.ownershipUsedIds : null;
    list = (board?.ownershipSources ?? []).map((s) => {
      const used = usedIds ? usedIds.includes(s.id) : (s.rows ?? []).length > 0;
      return { id: s.id, label: s.label ?? s.id, f: used, c: used };
    });
    const seen = new Set(list.map((s) => s.id));
    for (const r of rows) for (const id of [...Object.keys(r.ownFlexBySource ?? {}), ...Object.keys(r.ownCptBySource ?? {})]) {
      if (!seen.has(id)) { seen.add(id); list.push({ id, label: id, f: false, c: false }); }
    }
  }
  const col = (key, label, used) => (used ? { key, label } : unusedColumn(key, label));
  return list.flatMap((s) => [
    ...(s.f === null ? [] : [col(`src:f:${s.id}`, `${shortLabel(s.label)} FLEX`, s.f)]),
    ...(s.c === null ? [] : [col(`src:c:${s.id}`, `${shortLabel(s.label)} CPT`, s.c)]),
  ]);
}

function ownershipColumns(withKinds, srcCols = []) {
  return [
    { key: "player", label: "Player" },
    { key: "ownFlex", label: "Own FLEX", cls: "sd-own-num" },
    ...(withKinds ? [{ key: "kindFlex", label: "Kind (FLEX)", cls: "sd-kind" }] : []),
    { key: "ownCpt", label: "Own CPT", cls: "sd-own-num" },
    ...(withKinds ? [{ key: "kindCpt", label: "Kind (CPT)", cls: "sd-kind" }] : []),
    ...srcCols,
  ];
}

function ownershipValueOf(r, col) {
  if (col === "player") return r.name ?? null;
  if (col === "ownFlex") return r.ownFlex ?? null;
  if (col === "ownCpt") return r.ownCpt ?? null;
  if (col === "kindFlex") return r.ownKindFlex ? kindLabel(r.ownKindFlex) : null;
  if (col === "kindCpt") return r.ownKindCpt ? kindLabel(r.ownKindCpt) : null;
  if (col.startsWith("src:f:")) return r.ownFlexBySource?.[col.slice(6)] ?? null;
  if (col.startsWith("src:c:")) return r.ownCptBySource?.[col.slice(6)] ?? null;
  return null;
}

// What a source did, said only when the single "FLEX: Name 12.3% (published)." sentence would just restate the cell, and only when
// exactly one ownership source is in use: with two or more, that sentence is the only thing saying which source the figure came
// from (D40).
const RESTATES_THE_CELL = /^(?:FLEX|Captain): [^%]*? \d+(?:\.\d+)?% \((?:our estimate|published)\)\.$/;
// Adam's own typed number restates the cell whatever the sources; the "replaces ..." form does not.
const RESTATES_THE_OVERRIDE = /^(?:FLEX|Captain): Adam's override \d+(?:\.\d+)?%\.$/;
const SIM_SOURCE_ID = "sim"; // server/showdown/ownership.js SIM_ID; the client cannot import the server module

/**
 * What the hover needs from the board, once per draw: how many ownership sources are in use, and the sim source's own note (for
 * the hover of a 0 it gave). usedCount is the board's ownershipUsedIds, else the sources that have rows.
 */
export function ownTitleContext(board) {
  const sources = board?.ownershipSources ?? [];
  const usedIds = board?.ownershipUsedIds;
  const usedCount = Array.isArray(usedIds) ? usedIds.length : sources.filter((s) => (s.rows ?? []).length).length;
  const sim = sources.find((s) => s?.id === SIM_SOURCE_ID);
  return { usedCount, simNote: sim ? sourceNoteList(sim).join(" ") : "" };
}

/**
 * The hover of one figure cell, or "" when it would only repeat the cell (D41: the method is on hover, but a sentence that just
 * restates the number adds nothing). `side` is "FLEX" or "Captain"; `how` is the board's ownHow. A blank cell always says why.
 * A 0 from the sim says what a sim 0 can mean in the sim source's own note (ctx.simNote, the board does not mark an out or
 * outside-the-pool player), else points to its row on the Sources page; no wording of its own is typed here. ctx is
 * ownTitleContext(board); without ctx the single-source sentence is kept.
 */
export function ownFigureTitle(value, how, side, kind, ctx = {}) {
  const text = ownTitleText(value, how, side);
  if (value == null) return text;
  const zero = value === 0 && kind === "estimate" ? (ctx.simNote ? `The sim gave 0. ${ctx.simNote}` : "The sim gave 0; its row on the Sources page says why.") : "";
  const t = text.trim();
  const restated = RESTATES_THE_OVERRIDE.test(t) || (ctx.usedCount === 1 && RESTATES_THE_CELL.test(t));
  return [restated ? "" : t, zero].filter(Boolean).join(" ");
}

// No % sign, as classic's ownership figures (👁 finding 12); the column header says what the number is.
function ownFigureCellHtml(value, how, side, kind, ctx) {
  const title = ownFigureTitle(value, how, side, kind, ctx);
  return `<td class="sd-own-num"${title ? ` title="${escapeHtml(title)}"` : ""}>${value == null ? "—" : dec1(value)}</td>`;
}

// FLEX and Captain each carry their own kind (ownKindFlex/ownKindCpt): a player can be published at one side and missing at the
// other, so each cell is labelled from its own kind, not a single row-level flag (🔵 review item 4).
function ownershipRowHtml(r, withKinds, ctx, srcCols = []) {
  return `<tr>
    ${playerCellHtml(r)}
    ${ownFigureCellHtml(r.ownFlex, r.ownHow, "FLEX", r.ownKindFlex, ctx)}
    ${withKinds ? `<td class="sd-kind">${escapeHtml(kindLabel(r.ownKindFlex))}</td>` : ""}
    ${ownFigureCellHtml(r.ownCpt, r.ownHow, "Captain", r.ownKindCpt, ctx)}
    ${withKinds ? `<td class="sd-kind">${escapeHtml(kindLabel(r.ownKindCpt))}</td>` : ""}
    ${srcCols.map((c) => figureCellHtml(c, ownershipValueOf(r, c.key))).join("")}
  </tr>`;
}

/**
 * The table's thead and tbody HTML for a sort (pure; the click handler and the first draw both use it). `ctx` is ownTitleContext(board);
 * `srcCols` the by-source columns (ownSourceColumns).
 */
export function ownershipTableParts(rows, sort, withKinds, ctx = {}, srcCols = []) {
  const cols = ownershipColumns(withKinds, srcCols);
  const sorted = sortRows(rows, sort.col, sort.dir, ownershipValueOf);
  return { cols, head: sortableHeadHtml(cols, sort, true), body: sorted.map((r) => ownershipRowHtml(r, withKinds, ctx, srcCols)).join("") };
}

/**
 * The one line above the table that says what every figure is: the sources in use and their kind, once, plus when the board was
 * built (the figures' as-of). Said only when every figure is one kind; with a mix the Kind columns carry it. `rows` are the rows the
 * table shows: only a source that gave a figure of that kind on one of them is named (the sim for "our estimate", never for
 * "published", D29), and an override names none (it is Adam's typed numbers, not a source).
 */
export function ownershipBasisText(board, kinds, rows = [], selections = []) {
  const stamp = localStamp(board.generatedAt);
  const asOf = stamp ? `Figures from the board built ${stamp.monthDay} ${stamp.clock}.` : "Figures: as-of time not recorded.";
  if (kinds.size !== 1) return asOf;
  const [kind] = kinds;
  const tail = `for every FLEX and Captain figure below. ${asOf}`;
  if (kind === "override") return `Your typed numbers, ${tail}`;
  const usedIds = Array.isArray(board.ownershipUsedIds) ? board.ownershipUsedIds : null;
  const used = (board.ownershipSources ?? []).filter((s) => (s.rows ?? []).length && (!usedIds || usedIds.includes(s.id)));
  // A ticked source the board's file list does not carry (TwoGun's column is not an ownership file) is named from the Sources page's own
  // record of it (its label without a trailing "(...)"), so a table made only of his figures still names him.
  const onPage = new Map();
  for (const s of selections.flat()) if (s?.use && !used.some((u) => u.id === s.id) && !onPage.has(s.id)) onPage.set(s.id, { id: s.id, label: shortLabel(s.label ?? s.id) });
  // The server's own label for a source (ownership.js label()): Stokastic by name, the rest without a trailing "(our estimate)"; it is what a row's ownHow says.
  const nameOf = (s) => (s.id === "stokastic" ? "Stokastic" : String(s.label ?? s.id).replace(/\s*\(our estimate\)\s*$/, ""));
  const gave = (s) => rows.some((r) => [["FLEX", r.ownFlex, r.ownKindFlex], ["Captain", r.ownCpt, r.ownKindCpt]].some(([side, value, k]) =>
    value != null && k === kind && (kind === "estimate") === (s.id === SIM_SOURCE_ID) && ownTitleText(value, r.ownHow, side).includes(nameOf(s))));
  const names = [...used, ...onPage.values()].filter(gave).map(nameOf).join(" and ");
  const word = kindLabel(kind);
  return `${names ? `${names} — ${word}` : `${word[0].toUpperCase()}${word.slice(1)}`}, ${tail}`;
}

/**
 * The one line above an ownership table that has no figure at all while no ownership source is ticked on either side (👁 finding 6): the
 * counts are the board's own, in the shape of classic's "204 of 525 players have a published DraftKings ownership number". "" when any
 * source is ticked (its own note, allDashNote, says why) or the page has not read the selection yet (`flex`/`cpt` null). `rows` are the rows
 * the table shows; `allCount` is the board's whole player count, so when players ruled out are hidden the sentence says its count is of the
 * players shown, not of the board the Sources page's Coverage column counts (👁 round 2, V3: "0 of 53" beside "31 of 60").
 */
export function noTickedOwnershipNote(rows, flex, cpt, allCount = rows.length) {
  if (!rows.length || (!Array.isArray(flex) && !Array.isArray(cpt))) return "";
  if ([...(flex ?? []), ...(cpt ?? [])].some((s) => s?.use)) return "";
  const withFlex = rows.filter((r) => r.ownFlex != null).length;
  const withCpt = rows.filter((r) => r.ownCpt != null).length;
  if (withFlex || withCpt) return "";
  const hidden = allCount - rows.length;
  const who = hidden > 0 ? `the ${rows.length} players shown` : `${rows.length} players`;
  const why = hidden > 0 ? ` (${hidden} ruled out ${hidden === 1 ? "is" : "are"} hidden)` : "";
  return `${withFlex} of ${who} have a FLEX ownership number and ${withCpt} of ${rows.length} a Captain number${why}: no ticked ownership source covers this slate.`;
}

// Ownership panel: a table of each player's consolidated number per side (the sources behind it are the Sources page above). Only
// the table's head and body are redrawn on a sort click, so the wrapper keeps its height and scroll position. `opts`: { flex, cpt }, the
// Sources page's two ownership sections (sources-page.js sectionSources), for the by-source columns and the all-dash sentence.
export function renderShowdownOwnershipPanel(container, board, opts = {}) {
  const rows = shownRows(board.rows ?? []);
  const kinds = ownKindsPresent(rows);
  const withKinds = kinds.size > 1;
  const srcCols = ownSourceColumns(board, rows, opts.flex, opts.cpt);
  if (!ownershipColumns(withKinds, srcCols).some((c) => c.key === ownState.sort.col)) ownState.sort = { col: "ownFlex", dir: "desc" }; // a Kind or source sort left over
  const ctx = ownTitleContext(board);
  const parts = ownershipTableParts(rows, ownState.sort, withKinds, ctx, srcCols);
  const dash = allDashNote(rows.length > 0 && rows.every((r) => r.ownFlex == null && r.ownCpt == null), [opts.flex ?? [], opts.cpt ?? []])
    || noTickedOwnershipNote(rows, opts.flex ?? null, opts.cpt ?? null, (board.rows ?? []).length);
  const dirFor = numberFirstDir(new Set(["ownFlex", "ownCpt", ...srcCols.map((c) => c.key)])); // a figure starts high to low (classic's Own% does)
  container.innerHTML = `
    <p class="tab-note">${showAllToggleHtml(store.get().filters.showAllPlayers, `data-action="show-all"`)} Blended from the ownership sources ticked above. Hover a figure when it says more than the number.</p>
    <p class="tab-note sd-own-basis">${escapeHtml(ownershipBasisText(board, kinds, rows, [opts.flex ?? [], opts.cpt ?? []]))}</p>
    ${dash ? `<p class="tab-note sd-all-dash">${escapeHtml(dash)}</p>` : ""}
    <div class="tab-table-wrap scroll-panel">
      <table class="source-value-table sd-fit">
        <thead>${parts.head}</thead>
        <tbody>${parts.body}</tbody>
      </table>
    </div>`;
  wireShowAllButtons(container);
  fitScrollPanel(container);
  wireSortHeads(container, ownState, dirFor, (sort) => ownershipTableParts(rows, sort, withKinds, ctx, srcCols));
}

export { renderShowdownLineupPanel } from "./lineup.js";
export { renderShowdownEntriesPanel } from "./entries.js";
