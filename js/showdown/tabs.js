// Showdown tabs: Rankings and Optimizer, as classic keeps its own (Adam 2026-10-18). Projections and Projected Ownership are
// the two sub-tabs of the Sources view the header's Sources button opens (view.js, with public/js/tabs.js SOURCE_TABS).
// Rankings is rendered by view.js/table.js; the Optimizer's real implementation lives in lineup.js (its key stays "lineup")
// and is re-exported at the bottom of this file, mirroring how public/js/tabs.js re-exports its own
// renderLineupPanel from public/js/lineup.js.
//
// The Projections tab used to call classic's renderProjectionsPanel unchanged (public/js/tabs.js), but
// that function hard-codes `s.kind === "projection"` (so a "kicker" card, id "k:<sourceId>", never showed
// per 🔵 review item 9), renders a QB/RB/WR/TE/DST paste box classic never needs here (showdown never
// rosters kickers on the classic board but always does here, so only a kicker paste makes sense), and
// keeps its paste result in a module-level variable shared with the classic page. None of that is
// reachable from outside public/js/tabs.js (sourceCardHtml and its paste-result variable are not
// exported), so this file now builds its own small source-card grid and its own single kicker paste box
// instead of reusing the classic one.
import { escapeHtml, dec1, localStamp } from "../format.js";
import { unmatchedPartsHtml, slateTeamSet } from "../unmatched.js";
import { shownRows, ownTitleText } from "./table.js";
import { showAllToggleHtml, wireShowAllButtons } from "../filterbar.js";
import { store, sortRows, defaultDirFor } from "../state.js";
import { sortableHeadHtml } from "../tabs.js"; // the classic sortable header (also imported by lineup-lists.js)

export const SHOWDOWN_TABS = Object.freeze([
  Object.freeze({ key: "rankings", label: "Rankings" }),
  Object.freeze({ key: "lineup", label: "Optimizer" }),
]);
const TABS = SHOWDOWN_TABS;

export function renderShowdownTabs(container, activeTab, onTabClick) {
  container.innerHTML = TABS.map(
    (t) => `<button type="button" class="tab-btn${t.key === activeTab ? " active" : ""}" data-tab="${t.key}">${escapeHtml(t.label)}</button>`
  ).join("");
  container.querySelectorAll(".tab-btn").forEach((el) => {
    el.addEventListener("click", () => onTabClick(el.dataset.tab));
  });
}

// A showdown source card, projection or kicker alike: label, status, weight (kicker cards carry none),
// fetched time, row/matched/unmatched counts, and the unmatched names view.js's normalizeSource already
// mapped on from board.unmatched.projections[id]/kickers[id] (🔵 review item 3). There is no
// /api/showdown/<key>/sources route to write a weight or enabled change back to, so both inputs are
// rendered disabled with a plain note saying so (🔵 review item 9) rather than looking live.
// `slateTeams`/`slateRows`: the showdown game's two teams and its rows. Unmatched names on other teams are
// counted and kept behind a closed disclosure (Adam, 2026-10-10); see ../unmatched.js for the split and guards.
function sourceCardHtml(source, slateTeams, slateRows) {
  const idAttr = escapeHtml(String(source.id));
  const { onSlate, listHtml: unmatchedHtml, offSlateHtml: offSlateNote } = unmatchedPartsHtml(source.unmatchedNames, slateTeams, slateRows, escapeHtml);
  // With no names to split (an older response), the server's own count stands.
  const unmatchedShown = source.unmatchedNames?.length ? onSlate.length : (source.unmatchedCount ?? 0);
  const weightHtml = source.weight != null
    ? `<label>Weight <input type="number" class="source-weight-input" value="${escapeHtml(String(source.weight))}" disabled /></label>`
    : `<span>no weight (kicker consolidation, D39)</span>`;
  return `
    <div class="source-card" data-source-id="${idAttr}">
      <div class="source-card-head">
        <span class="source-label">${escapeHtml(source.label ?? source.id)}${source.kind === "kicker" ? ' <span class="tag-pill tag-other">kicker</span>' : ""}</span>
        <label class="source-enabled">
          <input type="checkbox" disabled ${source.enabled ? "checked" : ""} />
          Enabled
        </label>
      </div>
      <div class="source-card-row">
        ${weightHtml}
        <span class="source-status source-status-${escapeHtml(source.status ?? "")}">${escapeHtml(source.status ?? "unknown")}</span>
      </div>
      <div class="source-card-row muted"><span>display only &mdash; no live weight/enable route for showdown sources yet</span></div>
      <div class="source-card-row muted">
        <span>Fetched ${localStamp(source.fetchedAt)?.clock ?? "never"}</span>
        <span>${source.recordCount ?? 0} rows &middot; ${source.matchedCount ?? 0} matched &middot; ${unmatchedShown} unmatched on this slate</span>
      </div>
      ${unmatchedHtml}
      ${offSlateNote}
    </div>`;
}

// Kept at module level, own name (not shared with classic's own paste-result variable, 🔵 review item 9),
// so it survives the board reload that follows a successful submit.
let sdPasteResultText = null;

// Projections tab: source cards for every projection AND kicker card (🔵 review item 9), plus the one
// paste box this mode ever needs — the FantasyPros kicker page, always {pos:"k", text} — classic's own
// QB/RB/WR/TE/DST paste box is never shown here since showdown reuses the classic projection blend as-is
// (D39) and only kickers are showdown's own paste.
export function renderShowdownProjectionsPanel(container, board, callbacks) {
  const sources = (board.sources ?? []).filter((s) => s.kind === "projection" || s.kind === "kicker");
  // The game's own two teams; the rows' teams only if the board carries no game.
  const gameTeams = [board.game?.away, board.game?.home].filter(Boolean);
  const slateTeams = gameTeams.length === 2 ? slateTeamSet(gameTeams.map((team) => ({ team }))) : slateTeamSet(board.rows);
  const cards = sources.map((s) => sourceCardHtml(s, slateTeams, board.rows)).join("");
  container.innerHTML = `
    <div class="tab-recipe">${escapeHtml(board.recipes?.projection ?? "")}</div>
    <div class="source-card-grid">${cards}</div>
    <details class="paste-box sd-kicker-paste">
      <summary>Paste the FantasyPros kicker page</summary>
      <textarea id="sd-kicker-paste-text" rows="8" placeholder="Paste the whole FantasyPros kicker page here"></textarea>
      <div class="paste-box-controls">
        <button type="button" id="sd-kicker-paste-submit">Submit</button>
      </div>
      <div id="sd-kicker-paste-result" class="paste-result">${sdPasteResultText ? escapeHtml(sdPasteResultText) : ""}</div>
    </details>
  `;

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

/**
 * R85: for a source the board set aside, "not used (R85): lists N of M main players" (the counts and the rule are the
 * board's ownershipCoverage); null for a source in use, a source with no rows, or a board that does not say who was used.
 */
export function setAsideText(s, board) {
  const usedIds = board?.ownershipUsedIds;
  if (!Array.isArray(usedIds) || usedIds.includes(s?.id) || !(Array.isArray(s?.rows) && s.rows.length)) return null;
  const cov = board.ownershipCoverage;
  const mine = cov?.bySource?.[s.id];
  if (!mine || !Number.isFinite(cov.main)) return "not used (R85)";
  // Rounded DOWN to one decimal (the 1e-9 absorbs float noise on an exact share): a source just under 80% must never read "80%" beside "not used".
  const points = cov.basis === "points" && Number.isFinite(mine.share) ? `, ${Math.floor(mine.share * 1000 + 1e-9) / 10}% of their projected points` : "";
  return `not used (R85): lists ${mine.covered} of ${cov.main} main players${points}`;
}

/** A source's notes as a list: the file's `notes` (array) and its `note` (string, which most ownership files use). */
export function sourceNoteList(s) {
  const list = Array.isArray(s?.notes) ? s.notes : [];
  const one = typeof s?.note === "string" ? [s.note] : [];
  return [...list, ...one].map((n) => String(n).trim()).filter(Boolean);
}

function ownershipSourceCardHtml(s, board) {
  const rowCount = Array.isArray(s.rows) ? s.rows.length : 0;
  const noteLines = sourceNoteList(s).map(escapeHtml).join("<br>");
  const aside = setAsideText(s, board);
  const asideTitle = board?.ownershipCoverage?.rule ? ` title="${escapeHtml(board.ownershipCoverage.rule)}"` : "";
  return `
    <div class="source-card">
      <div class="source-card-head"><span class="source-label">${escapeHtml(s.label ?? s.id ?? "")}</span></div>
      ${s.kind ? `<div class="source-card-row muted"><span>${escapeHtml(s.kind)}</span></div>` : ""}
      <div class="source-card-row muted"><span>${rowCount} row${rowCount === 1 ? "" : "s"}</span>${s.url ? `<span title="${escapeHtml(s.url)}">link</span>` : ""}</div>
      ${aside ? `<div class="source-card-row muted"><span${asideTitle}>${escapeHtml(aside)}</span></div>` : ""}
      ${noteLines ? `<div class="source-card-row muted"><span>${noteLines}</span></div>` : ""}
    </div>`;
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
// Columns: Player, Team, Own FLEX, Own CPT, and the two Kind columns only when the figures on the table are not all one kind
// (published / our estimate / your override); when every figure is one kind, the line above the table says so once (D29 as amended).
// Headers are the classic sortable ones (public/js/tabs.js sortableHeadHtml, state.js sortRows: a blank last either way). The method
// of a figure (D41) is its hover, and only where it says more than the cell does.

// The table's sort, kept here so it survives the re-render a board refresh or "Show all players" causes. Own FLEX, high to low, first.
let sdOwnSort = { col: "ownFlex", dir: "desc" };
const OWN_FIGURE_COLS = new Set(["ownFlex", "ownCpt"]);
// A figure starts high to low (classic's Own% does); the text columns start A to Z through state.js defaultDirFor.
const ownDefaultDir = (col) => (OWN_FIGURE_COLS.has(col) ? "desc" : defaultDirFor(col));

// The kinds present on any figure the table shows (a missing figure has none).
function ownKindsPresent(rows) {
  const kinds = new Set();
  for (const r of rows) {
    if (r.ownFlex != null && r.ownKindFlex) kinds.add(r.ownKindFlex);
    if (r.ownCpt != null && r.ownKindCpt) kinds.add(r.ownKindCpt);
  }
  return kinds;
}

function ownershipColumns(withKinds) {
  return [
    { key: "player", label: "Player" },
    { key: "team", label: "Team" },
    { key: "ownFlex", label: "Own FLEX", cls: "sd-own-num" },
    ...(withKinds ? [{ key: "kindFlex", label: "Kind (FLEX)" }] : []),
    { key: "ownCpt", label: "Own CPT", cls: "sd-own-num" },
    ...(withKinds ? [{ key: "kindCpt", label: "Kind (CPT)" }] : []),
  ];
}

function ownershipValueOf(r, col) {
  if (col === "player") return r.name ?? null;
  if (col === "team") return r.team ?? null;
  if (col === "ownFlex") return r.ownFlex ?? null;
  if (col === "ownCpt") return r.ownCpt ?? null;
  if (col === "kindFlex") return r.ownKindFlex ? kindLabel(r.ownKindFlex) : null;
  if (col === "kindCpt") return r.ownKindCpt ? kindLabel(r.ownKindCpt) : null;
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
 * What the hover needs from the board, once per draw: how many ownership sources are in use, and the sim source's own note and
 * label (for the hover of a 0 it gave). usedCount is the board's ownershipUsedIds, else the sources that have rows.
 */
export function ownTitleContext(board) {
  const sources = board?.ownershipSources ?? [];
  const usedIds = board?.ownershipUsedIds;
  const usedCount = Array.isArray(usedIds) ? usedIds.length : sources.filter((s) => (s.rows ?? []).length).length;
  const sim = sources.find((s) => s?.id === SIM_SOURCE_ID);
  return { usedCount, simNote: sim ? sourceNoteList(sim).join(" ") : "", simLabel: sim ? String(sim.label ?? sim.id).replace(/\s*\(our estimate\)\s*$/, "") : "Sim own" };
}

/**
 * The hover of one figure cell, or "" when it would only repeat the cell (D41: the method is on hover, but a sentence that just
 * restates the number adds nothing). `side` is "FLEX" or "Captain"; `how` is the board's ownHow. A blank cell always says why.
 * A 0 from the sim says what a sim 0 can mean in the sim source's own note (ctx.simNote, the board does not mark an out or
 * outside-the-pool player), else points to its card. ctx is ownTitleContext(board); without ctx the single-source sentence is kept.
 */
export function ownFigureTitle(value, how, side, kind, ctx = {}) {
  const text = ownTitleText(value, how, side);
  if (value == null) return text;
  const zero = value === 0 && kind === "estimate" ? (ctx.simNote ? `The sim gave 0. ${ctx.simNote}` : `The sim gave 0; see the ${ctx.simLabel ?? "Sim own"} card.`) : "";
  const t = text.trim();
  const restated = RESTATES_THE_OVERRIDE.test(t) || (ctx.usedCount === 1 && RESTATES_THE_CELL.test(t));
  return [restated ? "" : t, zero].filter(Boolean).join(" ");
}

function ownFigureCellHtml(value, how, side, kind, ctx) {
  const title = ownFigureTitle(value, how, side, kind, ctx);
  return `<td class="sd-own-num"${title ? ` title="${escapeHtml(title)}"` : ""}>${value == null ? "—" : `${dec1(value)}%`}</td>`;
}

// FLEX and Captain each carry their own kind (ownKindFlex/ownKindCpt): a player can be published at one side and missing at the
// other, so each cell is labelled from its own kind, not a single row-level flag (🔵 review item 4).
function ownershipRowHtml(r, withKinds, ctx) {
  return `<tr>
    <td class="pc-name" data-card-id="${escapeHtml(String(r.id))}">${escapeHtml(r.name)}</td>
    <td>${escapeHtml(r.team ?? "")}</td>
    ${ownFigureCellHtml(r.ownFlex, r.ownHow, "FLEX", r.ownKindFlex, ctx)}
    ${withKinds ? `<td>${escapeHtml(kindLabel(r.ownKindFlex))}</td>` : ""}
    ${ownFigureCellHtml(r.ownCpt, r.ownHow, "Captain", r.ownKindCpt, ctx)}
    ${withKinds ? `<td>${escapeHtml(kindLabel(r.ownKindCpt))}</td>` : ""}
  </tr>`;
}

/** The table's thead and tbody HTML for a sort (pure; the click handler and the first draw both use it). `ctx` is ownTitleContext(board). */
export function ownershipTableParts(rows, sort, withKinds, ctx = {}) {
  const cols = ownershipColumns(withKinds);
  const sorted = sortRows(rows, sort.col, sort.dir, ownershipValueOf);
  return { cols, head: sortableHeadHtml(cols, sort, true), body: sorted.map((r) => ownershipRowHtml(r, withKinds, ctx)).join("") };
}

/**
 * The one line above the table that says what every figure is: the sources in use and their kind, once, plus when the board was
 * built (the figures' as-of). Said only when every figure is one kind; with a mix the Kind columns carry it. `rows` are the rows the
 * table shows: only a source that gave a figure of that kind on one of them is named (the sim for "our estimate", never for
 * "published", D29), and an override names none (it is Adam's typed numbers, not a source).
 */
export function ownershipBasisText(board, kinds, rows = []) {
  const stamp = localStamp(board.generatedAt);
  const asOf = stamp ? `Figures from the board built ${stamp.monthDay} ${stamp.clock}.` : "Figures: as-of time not recorded.";
  if (kinds.size !== 1) return asOf;
  const [kind] = kinds;
  const tail = `for every FLEX and Captain figure below (D29). ${asOf}`;
  if (kind === "override") return `Your typed numbers, ${tail}`;
  const usedIds = Array.isArray(board.ownershipUsedIds) ? board.ownershipUsedIds : null;
  const used = (board.ownershipSources ?? []).filter((s) => (s.rows ?? []).length && (!usedIds || usedIds.includes(s.id)));
  // The server's own label for a source (ownership.js label()): Stokastic by name, the rest without a trailing "(our estimate)"; it is what a row's ownHow says.
  const nameOf = (s) => (s.id === "stokastic" ? "Stokastic" : String(s.label ?? s.id).replace(/\s*\(our estimate\)\s*$/, ""));
  const gave = (s) => rows.some((r) => [["FLEX", r.ownFlex, r.ownKindFlex], ["Captain", r.ownCpt, r.ownKindCpt]].some(([side, value, k]) =>
    value != null && k === kind && (kind === "estimate") === (s.id === SIM_SOURCE_ID) && ownTitleText(value, r.ownHow, side).includes(nameOf(s))));
  const names = used.filter(gave).map(nameOf).join(" and ");
  return `${names ? `${names} — ` : ""}${kindLabel(kind)}, ${tail}`;
}

// Projected Ownership tab (brief): a table of each player's consolidated number per side (the sources behind it are the cards
// above). Only the table's head and body are redrawn on a sort click, so the wrapper keeps its height and scroll position.
export function renderShowdownOwnershipPanel(container, board) {
  const sources = board.ownershipSources ?? [];
  const cards = sources.map((s) => ownershipSourceCardHtml(s, board)).join("");
  const rows = shownRows(board.rows ?? []);
  const kinds = ownKindsPresent(rows);
  const withKinds = kinds.size > 1;
  if (!ownershipColumns(withKinds).some((c) => c.key === sdOwnSort.col)) sdOwnSort = { col: "ownFlex", dir: "desc" }; // a Kind sort left over from a mixed table
  const ctx = ownTitleContext(board);
  const parts = ownershipTableParts(rows, sdOwnSort, withKinds, ctx);
  container.innerHTML = `
    <p class="tab-note">${showAllToggleHtml(store.get().filters.showAllPlayers, `data-action="show-all"`)} Own FLEX/CPT is consolidated from the sources below that are in use (D40); a source marked "not used (R85)" covers too little of the main players' projected points and is left out. A player nobody published a number for shows a dash until a source publishes one. A number Adam typed in shows as "your override". Hover a figure for how it was made when that is more than the number itself; every column sorts.</p>
    <p class="tab-note sd-own-basis">${escapeHtml(ownershipBasisText(board, kinds, rows))}</p>
    <div class="source-card-grid">${cards}</div>
    <div class="tab-table-wrap scroll-panel">
      <table class="source-value-table">
        <thead>${parts.head}</thead>
        <tbody>${parts.body}</tbody>
      </table>
    </div>`;
  wireShowAllButtons(container);
  const wireHeads = () => {
    container.querySelectorAll("th[data-col]").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        sdOwnSort = sdOwnSort.col === col ? { col, dir: sdOwnSort.dir === "asc" ? "desc" : "asc" } : { col, dir: ownDefaultDir(col) };
        const next = ownershipTableParts(rows, sdOwnSort, withKinds, ctx);
        container.querySelector(".source-value-table thead").innerHTML = next.head;
        container.querySelector(".source-value-table tbody").innerHTML = next.body;
        wireHeads();
      });
    });
  };
  wireHeads();
}

export { renderShowdownLineupPanel } from "./lineup.js";
