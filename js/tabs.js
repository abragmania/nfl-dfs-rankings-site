// Tabs above the table: Rankings (rendered by table.js/gamestrip.js/filterbar.js, default),
// Optimizer (the main-slate tab, second after Rankings; DECISIONS.md D70; the Favorites tab is retired, RETIRED_TABS),
// Entries (right after the Optimizer, app only). Projections and Projected Ownership are not tabs here any more: the header's
// Sources link opens ONE Sources page (public/js/sources-page.js: which sources, their weights, when each was pulled), and the two
// per-player tables below it are this file's renderProjectionsPanel and renderOwnershipPanel, chosen by a Projections | Ownership
// switch on that page (Adam 2026-10-18; SOURCE_TABS keeps the two old tab keys, so "?tab=projections" and "?tab=ownership" still land there).
import { escapeHtml, dec1 } from "./format.js";
import { store, passesProjFloor, CLASSIC_PROJ_FLOOR, activeSlateRows, sortRows } from "./state.js";
import { showAllToggleHtml, wireShowAllButtons } from "./filterbar.js";
import { sourceFailedMarkerHtml, sortArrowHtml, sortArrowText } from "./table.js";
import { playerLineHtml } from "./player-row.js";
import { sourceIsTicked } from "./sources-page-html.js"; // the one tick predicate (the Sources page and the Showdown tables use it too)

// The classic projection floor (D52) as it applies to the two source tables: the same predicate and the same
// "Show all players" toggle as the Rankings table, nothing else from the filter bar. These tabs have no search
// box, so the Rankings search text is blanked here: a name typed on Rankings must not switch their floor off.
function floorRows(rows) {
  const filters = { ...store.get().filters, search: "" };
  return rows.filter((r) => passesProjFloor(r, filters));
}

// One line above a source table when the floor is hiding rows.
function floorNoteHtml(allRows, shownRows) {
  const hidden = allRows.length - shownRows.length;
  const showAll = Boolean(store.get().filters.showAllPlayers);
  if (hidden <= 0 && !showAll) return "";
  const text = hidden > 0
    ? `Showing ${shownRows.length} of ${allRows.length} players. ${hidden} ${hidden === 1 ? "is" : "are"} hidden: projected for ${CLASSIC_PROJ_FLOOR.toFixed(1)} points or fewer, or no projection.`
    : `Showing all ${allRows.length} players.`;
  return `<p class="tab-note">${escapeHtml(text)} ${showAllToggleHtml(showAll, `data-action="show-all"`)}</p>`;
}

const TABS = [
  { key: "rankings", label: "Rankings" },
  { key: "lineup", label: "Optimizer" }, // DECISIONS.md D70: "Optimizer" (was "Lineup Builder"), second tab
  { key: "showdown", label: "Showdown" }, // ChatGPT wish t, Adam 2026-10-17: a second door to the Showdown boards, in the app and on the site
  { key: "entries", label: "Entries" }, // rules repo 2026-10-17: Entries is its own tab (was a section under the Optimizer); app-only, see visibleTabs
  { key: "teams", label: "Teams (sample)" }, // Temporary (Adam 2026-10-18): remove when he has seen the colours
];

// Tab keys that are no longer drawn, and the tab each one opens instead (Adam 2026-10-18, Optimizer-first step 3: the Favorites
// tab goes and its old key opens the Optimizer). Step 4 adds "rankings" here the same way.
export const RETIRED_TABS = Object.freeze({ favorites: "lineup" });

// The Sources page's Players switch; its keys stay the old tab keys, so "?tab=projections" and "?tab=ownership" still land on the page.
export const SOURCE_TABS = Object.freeze([
  Object.freeze({ key: "projections", label: "Projections" }),
  Object.freeze({ key: "ownership", label: "Ownership" }),
]);
export const isSourcesTab = (key) => SOURCE_TABS.some((t) => t.key === key);

/** Which table the header's Sources link opens: the one already showing, else the one last shown, else Projections. */
export function sourcesTabToOpen(current, last) {
  if (isSourcesTab(current)) return current;
  return isSourcesTab(last) ? last : SOURCE_TABS[0].key;
}

// Rules repo 2026-10-17: the public site marks the page `is-site` (tools/publish.mjs injectSite marks the html tag at publish time; site-src/site.js adds it too), the same signal filterbar.js reads;
// Entries holds Adam's private entries files (site.css hides .entries-section there), so the site gets no Entries tab.
export function onSitePage() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("is-site");
}

/** The tabs to draw: all of them in the app, all but Entries and the temporary Teams (sample) on the public site (🔵 2026-10-18 series review). */
export function visibleTabs(onSite = onSitePage()) {
  return TABS.filter((t) => !(onSite && (t.key === "entries" || t.key === "teams")));
}

/** The tab to show: the stored one when it is drawn, a retired key's replacement (RETIRED_TABS) when that is drawn, else Rankings
 *  (an Entries tab left over on the site; rules repo 2026-10-17). */
export function shownTab(activeTab, tabs = visibleTabs()) {
  const key = Object.prototype.hasOwnProperty.call(RETIRED_TABS, activeTab) ? RETIRED_TABS[activeTab] : activeTab;
  return tabs.some((t) => t.key === key) || isSourcesTab(key) ? key : "rankings";
}

export function renderTabs(container, activeTab, onTabClick) {
  container.innerHTML = visibleTabs().map((t) => {
    return `<button type="button" class="tab-btn${t.key === activeTab ? " active" : ""}" data-tab="${t.key}">${escapeHtml(t.label)}</button>`;
  }).join("");
  container.querySelectorAll(".tab-btn").forEach((el) => {
    el.addEventListener("click", () => onTabClick(el.dataset.tab));
  });
}

// The few board notes that exist (the scoring fallback, an unreadable overrides file) are shown as one quiet
// line inside the tab they belong to (board.tabNotes), never as header pills.
function tabNotesHtml(notes) {
  const list = (notes ?? []).filter(Boolean);
  return list.length ? `<p class="tab-note">${escapeHtml(list.join(" "))}</p>` : "";
}

const PASTE_POSITIONS = ["QB", "RB", "WR", "TE", "DST"];

// A successful (or failed) paste's result text, kept at module level so it survives the board reload
// that follows a successful submit (that reload calls renderProjectionsPanel again with a fresh
// container, which would otherwise wipe out the message the user just triggered). Cleared at the start
// of every new submit so a stale result never lingers under a fresh "Submitting...".
let lastPasteResultText = null;

// The Projections table's sort, kept here (separate from ownSort) so it survives the re-render that follows a board
// reload. Default Proj high to low. Column keys: player, proj, cov, or "src:<id>".
let projSort = { col: "proj", dir: "desc" };

// A projection source is in the blend when it is ticked (switched on and not at weight 0; a card with no weight is on); otherwise it is not used.
const isProjectionNotUsed = (s) => !sourceIsTicked(s);

// A source column that is not in the blend: dimmed by its class (style.css .sv-unused), never a "(not used)" word in the header
// (👁 finding 7); its hover says it. Shared with the Showdown tables (showdown/tabs.js), which dim an unticked source the same way.
export const UNUSED_COL = Object.freeze({ cls: "sv-unused", headTitle: "Not used: unticked on the Sources page, or at weight 0." });
export const unusedColumn = (key, label) => ({ key, label, ...UNUSED_COL });

// Projections table columns (Adam, 2026-10-10: like Projected Ownership): Player, Proj (the blend), the sources
// in the blend in config order, the sources not in the blend (dimmed), then Coverage. No Team column: the player line already shows
// the team (D80; Adam 2026-10-18 round 3, as Rankings did in round 1).
export function projectionColumns(sources, isNotUsed = isProjectionNotUsed) {
  return [
    { key: "player", label: "Player" },
    { key: "proj", label: "Proj" },
    ...sources.filter((s) => !isNotUsed(s)).map((s) => ({ key: `src:${s.id}`, label: s.label })),
    ...sources.filter(isNotUsed).map((s) => unusedColumn(`src:${s.id}`, s.label)),
    { key: "cov", label: "Coverage" },
  ];
}

// The Projections table under the Sources page's Players heading: the paste box, the floor note and the sortable table. Which
// sources feed it and their weights are the Sources page above (sources-page.js), not cards here.
export function renderProjectionsPanel(container, board, callbacks) {
  const sources = (board.sources ?? []).filter((s) => s.kind === "projection");
  const pasteOptions = PASTE_POSITIONS.map((p) => `<option value="${p}">${p}</option>`).join("");

  container.innerHTML = `
    ${tabNotesHtml(board.tabNotes?.projections)}
    <details class="paste-box">
      <summary>Paste a FantasyPros table</summary>
      <div class="paste-box-controls">
        <select id="paste-position">${pasteOptions}</select>
        <button type="button" id="paste-submit">Submit</button>
      </div>
      <textarea id="paste-text" rows="8" placeholder="Paste the whole FantasyPros page for this position here"></textarea>
      <div id="paste-result" class="paste-result">${lastPasteResultText ? escapeHtml(lastPasteResultText) : ""}</div>
    </details>
    ${floorNoteHtml(activeSlateRows(board), floorRows(activeSlateRows(board)))}
    <div class="tab-table-group"><div class="tab-table-wrap scroll-panel"><table class="source-value-table sv-classic"><thead></thead><tbody></tbody></table></div></div>
  `;

  wireShowAllButtons(container);

  // The player table sorts like the Projected Ownership table (Adam, 2026-10-10): the wrapper and <table> are
  // rendered once above; a header click rebuilds only thead and tbody.
  const cols = projectionColumns(sources, isProjectionNotUsed);
  const valueOf = (r, col) => {
    if (col === "player") return r.name ?? null;
    if (col === "proj") return r.proj ?? null;
    if (col === "cov") return r.coverage ?? null;
    return r.projBySource?.[col.slice(4)] ?? null;
  };
  // A sort left over from a source that is no longer a column falls back to Proj high to low.
  if (!cols.some((c) => c.key === projSort.col)) projSort = { col: "proj", dir: "desc" };

  const theadEl = container.querySelector(".source-value-table thead");
  const tbodyEl = container.querySelector(".source-value-table tbody");
  const shownRows = floorRows(activeSlateRows(board));
  const draw = () => {
    theadEl.innerHTML = sortableHeadHtml(cols, projSort, true);
    // A1: a player blended without a source that failed for his position says so beside his coverage.
    tbodyEl.innerHTML = sortableBodyHtml(shownRows, cols, projSort, valueOf, (r) => sourceFailedMarkerHtml(r, board.sources));
    theadEl.querySelectorAll("th[data-col]").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        projSort = projSort.col === col
          ? { col, dir: projSort.dir === "asc" ? "desc" : "asc" }
          : { col, dir: sortDefaultDir(col) };
        draw();
      });
    });
  };
  draw();

  container.querySelector("#paste-submit").addEventListener("click", async () => {
    const pos = container.querySelector("#paste-position").value;
    const text = container.querySelector("#paste-text").value;
    const resultEl = container.querySelector("#paste-result");
    lastPasteResultText = null;
    resultEl.textContent = "Submitting...";
    try {
      const data = await callbacks.onPaste({ pos, text });
      if (data.ok) {
        const rowCount = Array.isArray(data.rows) ? data.rows.length : 0;
        lastPasteResultText = `Parsed ${rowCount} rows, dropped ${data.dropped ?? 0}, unmatched ${(data.unmatched ?? []).length}.`;
      } else {
        lastPasteResultText = `Paste failed: ${data.error?.message ?? "unknown error"}`;
      }
    } catch (e) {
      lastPasteResultText = `Paste failed: ${e.message}`;
    }
    // A successful paste triggers a board reload (callbacks.onPaste in app.js), which re-renders this
    // whole panel with a fresh container before this await resolves; the original resultEl reference can
    // already be detached from the document by then, so it's re-queried here rather than reused.
    const freshResultEl = container.querySelector("#paste-result");
    if (freshResultEl) freshResultEl.textContent = lastPasteResultText;
  });
}

// The Projected Ownership table's sort, kept here so it survives the re-render that follows a board reload or a
// floor toggle. Default Own% high to low, as on Rankings. Column keys: player, own, cov, or "src:<id>".
let ownSort = { col: "own", dir: "desc" };

// Player starts A to Z; every number column starts high to low (the Rankings pattern, state.js). No Opp or Team column (Adam 2026-10-18 Q1, round 3).
export function sortDefaultDir(col) {
  return col === "player" ? "asc" : "desc";
}

// Projected Ownership table (Adam, 2026-10-10: Own% close to the left, every column sortable). Columns: Player,
// Own% (the blend), the sources that feed the blend in config order, the sources not in the blend
// (weight 0 or switched off; dimmed, UNUSED_COL), then Quoted coverage. Header clicks reuse the Rankings pattern
// (sortable/sorted classes, ▲/▼ arrow, blanks last either way via state.js sortRows). The scroll wrapper and
// <table> are rendered once by renderOwnershipPanel; only the thead and tbody are rebuilt on a sort click, so
// the wrapper keeps the height app.js's adjustScrollPanels gave it and its scroll position.
function ownershipColumns(sources, isNotUsed) {
  return [
    { key: "player", label: "Player" },
    { key: "own", label: "Own%" },
    ...sources.filter((s) => !isNotUsed(s)).map((s) => ({ key: `src:${s.id}`, label: s.label })),
    ...sources.filter(isNotUsed).map((s) => unusedColumn(`src:${s.id}`, s.label)),
    { key: "cov", label: "Quoted coverage" },
  ];
}

// `reserveArrow`: the Projections and Projected Ownership tables draw the (hidden) arrow span on every header so a sort click moves no column (D80);
// the Optimizer pool keeps plain text. Both take the arrow from table.js, the one copy.
export function sortableHeadHtml(cols, sort, reserveArrow = false) {
  const head = cols
    .map((c) => {
      const active = sort.col === c.key;
      const arrow = reserveArrow ? sortArrowHtml(active, sort.dir, true) : active ? sortArrowText(sort.dir) : "";
      const extra = c.cls ? ` ${escapeHtml(c.cls)}` : ""; // a column's own class (the Optimizer pool's lineup-star-col)
      const hover = c.headTitle ? ` title="${escapeHtml(c.headTitle)}"` : ""; // an unused source column says why it is dimmed (UNUSED_COL)
      return `<th data-col="${escapeHtml(c.key)}" class="sortable${sort.col === c.key ? " sorted" : ""}${extra}"${hover}>${escapeHtml(c.label)}${arrow}</th>`;
    })
    .join("");
  return `<tr>${head}</tr>`;
}

// `covMark(row)`: optional extra HTML after the Coverage number (the Projections tab's A1 marker).
export function sortableBodyHtml(rows, cols, sort, valueOf, covMark = () => "") {
  return sortRows(rows, sort.col, sort.dir, valueOf)
    .map((r) => {
      const cells = cols
        .map((c) => {
          const v = valueOf(r, c.key);
          // D80: the shared row; "main" keeps the red OUT tag (Adam 2026-10-15). The cell carries data-card-id so the name opens his card (2026-10-18).
          // Adam 2026-10-18 Q10: the full matchup pill shows here too (the shared row's default).
          if (c.key === "player") return `<td data-card-id="${escapeHtml(String(r.id))}"><span class="player-cell">${playerLineHtml(r, { tag: "main" })}</span></td>`;
          if (c.key === "cov") return `<td>${v == null ? "—" : `${Math.round(v * 100)}%`}${covMark(r)}</td>`;
          return `<td${c.cls ? ` class="${escapeHtml(c.cls)}"` : ""}>${v == null ? "—" : dec1(v)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
}

export function renderOwnershipPanel(container, board, callbacks) {
  const sources = (board.sources ?? []).filter((s) => s.kind === "ownership");

  // Coverage here must describe ownership coverage, not the projection blend's coverage field that
  // board rows also carry. Same definition as the projection blend (server/rank/blend.js): the covering
  // sources' weight as a share of the total weight of the sources that count, where a source counts when it is
  // switched on, its weight is above 0 and it produced records. A source kept at weight 0 is shown in its own
  // column but never counts here (D35). A player none of the counting sources published a number for, or a
  // table with no counting source at all, has no coverage to report, so the cell is an em dash.
  const isKeptOnly = (s) => !sourceIsTicked(s);
  const usedSources = sources.filter((s) => !isKeptOnly(s) && Number(s.weight) > 0 && Number(s.recordCount) > 0);
  const usedWeight = usedSources.reduce((sum, s) => sum + Number(s.weight), 0);
  const coverageFn = (r) => {
    if (!usedSources.length || !(usedWeight > 0)) return null;
    const covering = usedSources.reduce((sum, s) => sum + (r.ownBySource?.[s.id] != null ? Number(s.weight) : 0), 0);
    return covering === 0 ? null : covering / usedWeight;
  };

  const rows = activeSlateRows(board); // the whole board, or the active second slate's players (D57)
  const published = rows.filter((r) => r.ownKind === "quoted").length;
  const blank = rows.filter((r) => r.own == null).length;

  container.innerHTML = `
    <p class="tab-note">${published} of ${rows.length} players have a published DraftKings ownership number; ${blank} are blank.</p>
    ${tabNotesHtml(board.tabNotes?.ownership)}
    ${floorNoteHtml(rows, floorRows(rows))}
    <div class="tab-table-group"><div class="tab-table-wrap scroll-panel"><table class="source-value-table sv-classic"><thead></thead><tbody></tbody></table></div></div>
  `;

  wireShowAllButtons(container);

  const cols = ownershipColumns(sources, isKeptOnly);
  const valueOf = (r, col) => {
    if (col === "player") return r.name ?? null;
    if (col === "own") return r.own ?? null;
    if (col === "cov") return coverageFn(r);
    return r.ownBySource?.[col.slice(4)] ?? null;
  };
  // A sort left over from a source that is no longer a column (a different week's sources) falls back to Own% high to low.
  if (!cols.some((c) => c.key === ownSort.col)) ownSort = { col: "own", dir: "desc" };

  const theadEl = container.querySelector(".source-value-table thead");
  const tbodyEl = container.querySelector(".source-value-table tbody");
  const shownRows = floorRows(rows);
  const draw = () => {
    theadEl.innerHTML = sortableHeadHtml(cols, ownSort, true);
    tbodyEl.innerHTML = sortableBodyHtml(shownRows, cols, ownSort, valueOf);
    theadEl.querySelectorAll("th[data-col]").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        ownSort = ownSort.col === col
          ? { col, dir: ownSort.dir === "asc" ? "desc" : "asc" }
          : { col, dir: sortDefaultDir(col) };
        draw();
      });
    });
  };
  draw();
}

// The Optimizer tab's real implementation lives in lineup.js (its own state: locks, excludes, the
// nine slots and the option controls); re-exported here so app.js's existing
// `import { renderLineupPanel } from "./tabs.js"` keeps working unchanged. The Entries tab (rules repo 2026-10-17) is
// drawn by lineup.js too, because it reads the same saved lineups.
export { renderLineupPanel, renderEntriesPanel } from "./lineup.js";
