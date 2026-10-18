// Tabs above the table: Rankings (rendered by table.js/gamestrip.js/filterbar.js, default),
// Favorites (starred players, favorites.js), Projections, Projected Ownership, Optimizer (the main-slate tab, second after Rankings; DECISIONS.md D70),
// Entries (right after the Optimizer, app only).
import { escapeHtml, dec1, localStamp } from "./format.js";
import { store, passesProjFloor, CLASSIC_PROJ_FLOOR, activeSlateRows, sortRows } from "./state.js";
import { favoritesTabLabel } from "./favorites.js";
import { showAllToggleHtml, wireShowAllButtons } from "./filterbar.js";
import { unmatchedPartsHtml, slateTeamSet } from "./unmatched.js";
import { matchupText, sourceFailedMarkerHtml, outTagHtml } from "./table.js";

// TwoGun's card (merge plan 2026-10-15) is read-only: his figures are used as he publishes them (D25 as amended) and
// POST /api/sources does not know his id, so the card has no Enabled box and no weight box.
const READ_ONLY_SOURCE_IDS = new Set(["twogun"]);

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
  { key: "favorites", label: "Favorites" },
  { key: "projections", label: "Projections" },
  { key: "ownership", label: "Projected Ownership" },
];

// Rules repo 2026-10-17: the public site marks the page `is-site` (tools/publish.mjs injectSite marks the html tag at publish time; site-src/site.js adds it too), the same signal filterbar.js reads;
// Entries holds Adam's private entries files (site.css hides .entries-section there), so the site gets no Entries tab.
export function onSitePage() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("is-site");
}

/** The tabs to draw: all of them in the app, all but Entries on the public site. */
export function visibleTabs(onSite = onSitePage()) {
  return TABS.filter((t) => !(onSite && t.key === "entries"));
}

/** The tab to show: the stored one when it is drawn, else Rankings (an Entries tab left over on the site; rules repo 2026-10-17). */
export function shownTab(activeTab, tabs = visibleTabs()) {
  return tabs.some((t) => t.key === activeTab) ? activeTab : "rankings";
}

// `favoritesCount`: how many starred players are on the slate; the Favorites tab shows it as "Favorites (3)".
export function renderTabs(container, activeTab, onTabClick, favoritesCount = 0) {
  container.innerHTML = visibleTabs().map((t) => {
    const label = t.key === "favorites" ? favoritesTabLabel(favoritesCount) : t.label;
    return `<button type="button" class="tab-btn${t.key === activeTab ? " active" : ""}" data-tab="${t.key}">${escapeHtml(label)}</button>`;
  }).join("");
  container.querySelectorAll(".tab-btn").forEach((el) => {
    el.addEventListener("click", () => onTabClick(el.dataset.tab));
  });
}

// `slateTeams`/`slateRows`: the team codes and rows of the loaded slate. Unmatched names on other teams are
// counted and kept behind a closed disclosure, not listed in the open (Adam, 2026-10-10); see unmatched.js for
// the split and its guards (unrecognised team codes, names matching a slate player, an empty slate).
function sourceCardHtml(source, slateTeams, slateRows) {
  const idAttr = escapeHtml(String(source.id));
  // 👁 visual-qa: long "not on the DK slate" lists collapse behind a disclosure instead of always
  // being shown in full; the label text is already the display name (server/rank/board.js's
  // recordLabel), so it's shown as-is.
  const { onSlate, listHtml: unmatchedHtml, offSlateHtml: offSlateNote } = unmatchedPartsHtml(source.unmatchedNames, slateTeams, slateRows, escapeHtml);
  // With no names to split (an older response), the server's own count stands.
  const unmatchedShown = source.unmatchedNames?.length ? onSlate.length : (source.unmatchedCount ?? 0);
  // Ownership tables only: the page's own "updated" text as the site wrote it, and, for a source kept at
  // weight 0, the plain statement that its numbers are stored and shown but never part of Own% (D35).
  const pageUpdatedHtml = source.pageUpdated
    ? `<div class="source-card-row muted"><span>Page updated ${escapeHtml(String(source.pageUpdated))}</span></div>`
    : "";
  const keptOnlyHtml = source.kind === "ownership" && Number(source.weight) === 0
    ? `<div class="source-card-row muted"><span>kept for comparison, not used in Own%</span></div>`
    : "";
  const readOnly = source.readOnly === true || READ_ONLY_SOURCE_IDS.has(String(source.id));
  const enabledHtml = readOnly
    ? `<span class="source-readonly" title="TwoGun's published figures are used as he publishes them in TwoGun mode; switch modes in the header.">read-only</span>`
    : `<label class="source-enabled">
          <input type="checkbox" data-action="source-enabled" data-id="${idAttr}" ${source.enabled ? "checked" : ""} />
          Enabled
        </label>`;
  const weightHtml = readOnly
    ? `<span>Weight ${escapeHtml(String(source.weight ?? "—"))}</span>`
    : `<label>Weight <input type="number" step="0.1" min="0" class="source-weight-input" data-action="source-weight" data-id="${idAttr}" value="${source.weight}" /></label>`;
  return `
    <div class="source-card" data-source-id="${idAttr}">
      <div class="source-card-head">
        <span class="source-label">${escapeHtml(source.label)}</span>
        ${enabledHtml}
      </div>
      <div class="source-card-row">
        ${weightHtml}
        <span class="source-status source-status-${escapeHtml(source.status ?? "")}">${escapeHtml(source.status ?? "unknown")}</span>
      </div>
      <div class="source-weight-error" data-id="${idAttr}" hidden></div>
      <div class="source-card-row muted">
        <span>Fetched ${localStamp(source.fetchedAt)?.clock ?? "never"}</span>
        <span>${source.recordCount ?? 0} rows · ${source.matchedCount ?? 0} matched · ${unmatchedShown} unmatched on this slate</span>
      </div>
      ${pageUpdatedHtml}
      ${keptOnlyHtml}
      ${unmatchedHtml}
      ${offSlateNote}
    </div>`;
}

function wireSourceCards(container, onSourceChange) {
  container.querySelectorAll("[data-action='source-enabled']").forEach((el) => {
    el.addEventListener("change", () => onSourceChange(el.dataset.id, { enabled: el.checked }));
  });
  container.querySelectorAll("[data-action='source-weight']").forEach((el) => {
    el.addEventListener("change", () => {
      const errorEl = container.querySelector(`.source-weight-error[data-id="${CSS.escape(el.dataset.id)}"]`);
      const raw = el.value.trim();
      const parsed = Number(raw);
      if (raw === "" || !Number.isFinite(parsed) || parsed < 0) {
        el.value = el.defaultValue; // restore the last-known-good weight rather than silently sending 0
        if (errorEl) {
          errorEl.textContent = "Enter a weight of 0 or greater.";
          errorEl.hidden = false;
        }
        return;
      }
      if (errorEl) errorEl.hidden = true;
      onSourceChange(el.dataset.id, { weight: parsed });
    });
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
// reload. Default Proj high to low. Column keys: player, team, proj, cov, or "src:<id>".
let projSort = { col: "proj", dir: "desc" };

// A projection source is in the blend when it is switched on and its weight is above 0; otherwise it is "(not used)".
const isProjectionNotUsed = (s) => Number(s.weight) <= 0 || s.enabled === false;

// Projections table columns (Adam, 2026-10-10: like Projected Ownership): Player, Team, Proj (the blend), the sources
// in the blend in config order, the sources not in the blend, then Coverage.
export function projectionColumns(sources, isNotUsed = isProjectionNotUsed) {
  return [
    { key: "player", label: "Player" },
    { key: "team", label: "Team" },
    { key: "opp", label: "Opp", cls: "opp-col" }, // D43: "vs DAL" / "@ DET", left-aligned (style.css .opp-col)
    { key: "proj", label: "Proj" },
    ...sources.filter((s) => !isNotUsed(s)).map((s) => ({ key: `src:${s.id}`, label: s.label })),
    ...sources.filter(isNotUsed).map((s) => ({ key: `src:${s.id}`, label: `${s.label} (not used)` })),
    { key: "cov", label: "Coverage" },
  ];
}

export function renderProjectionsPanel(container, board, callbacks) {
  const sources = (board.sources ?? []).filter((s) => s.kind === "projection");
  const slateRows = activeSlateRows(board);
  const slateTeams = slateTeamSet(slateRows);
  const cards = sources.map((s) => sourceCardHtml(s, slateTeams, slateRows)).join("");
  const pasteOptions = PASTE_POSITIONS.map((p) => `<option value="${p}">${p}</option>`).join("");

  container.innerHTML = `
    <div class="tab-recipe">${escapeHtml(board.recipes?.projection ?? "")}</div>
    ${tabNotesHtml(board.tabNotes?.projections)}
    <div class="source-card-grid">${cards}</div>
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
    <div class="tab-table-wrap scroll-panel"><table class="source-value-table"><thead></thead><tbody></tbody></table></div>
  `;

  wireSourceCards(container, callbacks.onSourceChange);
  wireShowAllButtons(container);

  // The player table sorts like the Projected Ownership table (Adam, 2026-10-10): the wrapper and <table> are
  // rendered once above; a header click rebuilds only thead and tbody.
  const cols = projectionColumns(sources, isProjectionNotUsed);
  const valueOf = (r, col) => {
    if (col === "player") return r.name ?? null;
    if (col === "team") return r.team ?? null;
    if (col === "opp") return matchupText(r) || null;
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
    theadEl.innerHTML = sortableHeadHtml(cols, projSort);
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
// floor toggle. Default Own% high to low, as on Rankings. Column keys: player, team, own, cov, or "src:<id>".
let ownSort = { col: "own", dir: "desc" };

// Player, Team and Opp start A to Z; every number column starts high to low (the Rankings pattern, state.js).
export function sortDefaultDir(col) {
  return col === "player" || col === "team" || col === "opp" ? "asc" : "desc";
}

// Projected Ownership table (Adam, 2026-10-10: Own% close to the left, every column sortable). Columns: Player,
// Team, Own% (the blend), the sources that feed the blend in config order, the sources not in the blend
// ("(not used)": weight 0 or switched off), then Quoted coverage. Header clicks reuse the Rankings pattern
// (sortable/sorted classes, ▲/▼ arrow, blanks last either way via state.js sortRows). The scroll wrapper and
// <table> are rendered once by renderOwnershipPanel; only the thead and tbody are rebuilt on a sort click, so
// the wrapper keeps the height app.js's adjustScrollPanels gave it and its scroll position.
function ownershipColumns(sources, isNotUsed) {
  return [
    { key: "player", label: "Player" },
    { key: "team", label: "Team" },
    { key: "opp", label: "Opp", cls: "opp-col" }, // D43: "vs DAL" / "@ DET", left-aligned (style.css .opp-col)
    { key: "own", label: "Own%" },
    ...sources.filter((s) => !isNotUsed(s)).map((s) => ({ key: `src:${s.id}`, label: s.label })),
    ...sources.filter(isNotUsed).map((s) => ({ key: `src:${s.id}`, label: `${s.label} (not used)` })),
    { key: "cov", label: "Quoted coverage" },
  ];
}

export function sortableHeadHtml(cols, sort) {
  const head = cols
    .map((c) => {
      const arrow = sort.col === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
      const extra = c.cls ? ` ${escapeHtml(c.cls)}` : ""; // a column's own class (the Opp column's opp-col)
      return `<th data-col="${escapeHtml(c.key)}" class="sortable${sort.col === c.key ? " sorted" : ""}${extra}">${escapeHtml(c.label)}${arrow}</th>`;
    })
    .join("");
  return `<tr>${head}</tr>`;
}

// `covMark(row)`: optional extra HTML after the Coverage number (the Projections tab's A1 marker).
function sortableBodyHtml(rows, cols, sort, valueOf, covMark = () => "") {
  return sortRows(rows, sort.col, sort.dir, valueOf)
    .map((r) => {
      const cells = cols
        .map((c) => {
          const v = valueOf(r, c.key);
          if (c.key === "opp") return `<td class="opp-col">${escapeHtml(v ?? "")}</td>`; // D43, left-aligned (style.css)
          // The red OUT tag (Adam 2026-10-15, TwoGun merge adjustment 1) beside the name, as on Rankings.
          if (c.key === "player") return `<td>${escapeHtml(v ?? "")}${outTagHtml(r)}</td>`;
          if (c.key === "team") return `<td>${escapeHtml(v ?? "")}</td>`;
          if (c.key === "cov") return `<td>${v == null ? "—" : `${Math.round(v * 100)}%`}${covMark(r)}</td>`;
          return `<td>${v == null ? "—" : dec1(v)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
}

export function renderOwnershipPanel(container, board, callbacks) {
  const sources = (board.sources ?? []).filter((s) => s.kind === "ownership");
  const slateRows = activeSlateRows(board);
  const slateTeams = slateTeamSet(slateRows);
  const cards = sources.map((s) => sourceCardHtml(s, slateTeams, slateRows)).join("");

  // Coverage here must describe ownership coverage, not the projection blend's coverage field that
  // board rows also carry. Same definition as the projection blend (server/rank/blend.js): the covering
  // sources' weight as a share of the total weight of the sources that count, where a source counts when it is
  // switched on, its weight is above 0 and it produced records. A source kept at weight 0 is shown in its own
  // column but never counts here (D35). A player none of the counting sources published a number for, or a
  // table with no counting source at all, has no coverage to report, so the cell is an em dash.
  const isKeptOnly = (s) => Number(s.weight) === 0 || s.enabled === false;
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

  // The server's recipe is already plain English, so it is shown as it stands.
  container.innerHTML = `
    <div class="tab-recipe">${escapeHtml(board.recipes?.ownership ?? "")}</div>
    <p class="tab-note">${published} of ${rows.length} players have a published DraftKings ownership number; ${blank} are blank.</p>
    ${tabNotesHtml(board.tabNotes?.ownership)}
    <div class="source-card-grid">${cards}</div>
    ${floorNoteHtml(rows, floorRows(rows))}
    <div class="tab-table-wrap scroll-panel"><table class="source-value-table"><thead></thead><tbody></tbody></table></div>
  `;

  wireSourceCards(container, callbacks.onSourceChange);
  wireShowAllButtons(container);

  const cols = ownershipColumns(sources, isKeptOnly);
  const valueOf = (r, col) => {
    if (col === "player") return r.name ?? null;
    if (col === "team") return r.team ?? null;
    if (col === "opp") return matchupText(r) || null;
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
    theadEl.innerHTML = sortableHeadHtml(cols, ownSort);
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
