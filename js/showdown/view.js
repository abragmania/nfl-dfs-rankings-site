// Showdown mode controller (D39/D40): owns the showdown-only DOM (header band, game line, tabs, four
// panels), fetches and normalizes the showdown board, and renders whichever tab is active. Mounted from
// app.js, which owns the mode row and the classic-vs-showdown visibility toggle (app.js reads/writes
// location.hash's "#sd=<key>" itself); this module reacts to whatever key it is told to show.
import { getShowdownBoard, postShowdownRefresh, postShowdownProjectionsPaste } from "./api.js";
import { renderPills, kickoffDateAndClock } from "../header.js";
import { escapeHtml, dec1 } from "../format.js";
import { TEAM_BY_ABBR } from "../teams-data.js";
import { applyGrades } from "../grade.js";
import { DIM_STATUS_TOKENS } from "../table.js";
import { renderShowdownTableHead, renderShowdownTableBody } from "./table.js";
import { renderShowdownTabs, renderShowdownProjectionsPanel, renderShowdownOwnershipPanel, renderShowdownLineupPanel } from "./tabs.js";

const state = {
  activeTab: "rankings",
  // Default sort is Proj descending, matching the hosted sheet (coordinator fix) — Val stays sortable by
  // clicking its header, same as any other column; a null projection always sorts last (sortRows below).
  sort: { col: "proj", dir: "desc" },
  filters: { team: "both", pos: "All", maxSalary: null, minProj: null },
  board: null, // the last successfully loaded board; never cleared just because a reload or a switch to
  // a different key is in flight (🔵 finding: the page must never blank a good board out from under Adam).
  boardKey: null, // the key `board` actually belongs to
  requestedKey: null, // the key currently asked for, even if its load hasn't resolved (or failed) yet —
  // Refresh reads this so it still works after a first load that failed and left `board` null.
  loading: false,
  error: null, // only shown when there is no good board to fall back to; a failure while a good board is
  // already on screen is reported in #sd-status instead (see loadBoard).
};

// Monotonic token plus the key it was issued for: every async board-affecting call (a fresh load, Refresh,
// a paste) takes a token before awaiting anything, and only applies its result if both the token and the
// key it was issued for are still current when it resolves — so a response for a showdown Adam has since
// navigated away from (or a second click before the first settled) is discarded rather than clobbering
// whatever is now on screen (🔵 findings: load token; never blank a good board).
let loadToken = 0;
function beginRequest(key) {
  state.requestedKey = key;
  return ++loadToken;
}
function isCurrent(token, key) {
  return token === loadToken && key === state.requestedKey;
}

export function showdownKeyFromHash() {
  const h = window.location.hash || "";
  const m = h.match(/^#sd=(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null; // a malformed percent-encoding must never throw out of a hashchange handler
  }
}

const els = {
  status: document.getElementById("sd-status"),
  tabs: document.getElementById("sd-tabs"),
  band: document.getElementById("sd-band"),
  pillsRow: document.getElementById("sd-pills-row"),
  refreshBtn: document.getElementById("sd-refresh-btn"),
  rankingsPanel: document.getElementById("sd-rankings-panel"),
  gameline: document.getElementById("sd-gameline"),
  filterbar: document.getElementById("sd-filterbar"),
  thead: document.getElementById("sd-thead"),
  tbody: document.getElementById("sd-tbody"),
  legend: document.getElementById("sd-legend"),
  projectionsPanel: document.getElementById("sd-projections-panel"),
  ownershipPanel: document.getElementById("sd-ownership-panel"),
  lineupPanel: document.getElementById("sd-lineup-panel"),
  emptyState: document.getElementById("sd-empty-state"),
};

// --------------------------------------------------------------------------------------------------------
// Normalize: real field names only (server/showdown/board.js rows and server/showdown/routes.js
// responses, per 🔵 review) — no more guessing at an id, no more re-deriving coverage.
// --------------------------------------------------------------------------------------------------------

// A row's id and cptId are exactly what the CSV gave the board (🔵 finding: never invent one). A row with
// no Captain row in the CSV carries cptId null, same as the server.
function normalizeRow(r) {
  return {
    ...r,
    id: r.id,
    cptId: r.cptId ?? null,
    name: r.name,
    team: r.team,
    pos: r.pos,
    status: r.status ?? "",
    salary: r.salary ?? null,
    cptSalary: r.cptSalary ?? null,
    proj: r.proj ?? null,
    cptProj: r.cptProj ?? null,
    value: r.value ?? null,
    sources: r.sources ?? {},
    // coverage is already a 0-1 fraction on the real board (server/showdown/board.js); passed through
    // unchanged (🔵 finding — the old fraction-from-a-count conversion here was for a static data file
    // that no longer describes the live shape).
    coverage: r.coverage ?? null,
    projHow: r.projHow ?? "",
    ownFlex: r.ownFlex ?? null,
    ownCpt: r.ownCpt ?? null,
    // Real per-side kinds (🔵 finding): "published" | "estimate" | "override", independently for FLEX and
    // Captain — a player can be published at FLEX and an estimate at Captain, or vice versa.
    ownKindFlex: r.ownKindFlex ?? null,
    ownKindCpt: r.ownKindCpt ?? null,
    ownHow: r.ownHow ?? "",
    levFlex: r.levFlex ?? null,
    levCpt: r.levCpt ?? null,
    flags: r.flags ?? [],
    tags: r.tags ?? [],
    note: r.note ?? "",
  };
}

// Fallback-chain source normalization, the same idea as public/js/normalize.js's normalizeSource for the
// classic board: the real board's source cards (server/showdown/board.js) carry "records"/"matched" while
// the card renderer wants recordCount/matchedCount/unmatchedCount/weight/enabled/fetchedAt. Unmatched
// names live off the card, at board.unmatched.projections[id] for a projection card or
// board.unmatched.kickers[id] for a kicker card (id already "k:<sourceId>", 🔵 finding).
function normalizeSource(s, unmatched) {
  const recordCount = s.recordCount ?? s.records ?? 0;
  const matchedCount = s.matchedCount ?? s.matched ?? 0;
  const unmatchedNames = s.unmatchedNames ?? (s.kind === "kicker" ? unmatched?.kickers?.[s.id] : unmatched?.projections?.[s.id]) ?? [];
  return {
    ...s,
    weight: s.weight ?? null,
    enabled: s.enabled ?? true,
    recordCount,
    matchedCount,
    unmatchedCount: s.unmatchedCount ?? Math.max(0, recordCount - matchedCount),
    unmatchedNames,
    fetchedAt: s.fetchedAt ?? null,
  };
}

// Out/IR players get no value tint at all (👁 visual-qa: they stay in the list, dimmed, with their status
// pill, but a punt-priced bench player who is also ruled out must never read as a good or bad play).
// Doubtful/Questionable keep their tint — only Out and IR are excluded here, a narrower set than the row
// -dimming tokens (public/js/table.js's DIM_STATUS_TOKENS also dims Doubtful).
const NO_TINT_STATUS = new Set(["o", "out", "ir"]);

function normalizeBoard(raw) {
  if (!raw || !raw.ok) return raw;
  // Lev is graded by the same applyGrades quintile-within-position as Val (which reads a row's `lev`
  // field): one pass with lev = levFlex gives levGrade, one with lev = levCpt gives levCptGrade.
  const normalized = (raw.rows ?? []).map(normalizeRow);
  const flexGraded = applyGrades(normalized.map((r) => ({ ...r, lev: r.levFlex })));
  const cptGraded = applyGrades(normalized.map((r) => ({ ...r, lev: r.levCpt })));
  const rows = flexGraded.map((g, i) => {
    const { lev, ...r } = g;
    const graded = { ...r, levCptGrade: cptGraded[i].levGrade };
    const statusKey = (graded.status ?? "").trim().toLowerCase();
    return NO_TINT_STATUS.has(statusKey) ? { ...graded, valueGrade: null, levGrade: null, levCptGrade: null } : graded;
  });
  const sources = (raw.sources ?? []).map((s) => normalizeSource(s, raw.unmatched));
  return { ...raw, rows, sources };
}

// --------------------------------------------------------------------------------------------------------
// Filter / sort
// --------------------------------------------------------------------------------------------------------

const DESC_FIRST = new Set(["salary", "cptSalary", "proj", "cptProj", "value", "ownFlex", "ownCpt", "levFlex", "levCpt"]);
function defaultDirFor(col) {
  return DESC_FIRST.has(col) ? "desc" : "asc";
}

function sortValue(row, col) {
  switch (col) {
    case "player":
      return row.name ?? null;
    case "salary":
      return row.salary ?? null;
    case "cptSalary":
      return row.cptSalary ?? null;
    case "proj":
      return row.proj ?? null;
    case "cptProj":
      return row.cptProj ?? null;
    case "value":
      return row.value ?? null;
    case "ownFlex":
      return row.ownFlex ?? null;
    case "ownCpt":
      return row.ownCpt ?? null;
    case "levFlex":
      return row.levFlex ?? null;
    case "levCpt":
      return row.levCpt ?? null;
    case "note":
      return row.note && row.note.trim() ? row.note : null;
    default:
      return null;
  }
}

// Same null-sorts-last rule as public/js/state.js's sortRows, so a blank Own% or CPT $ always drops to
// the bottom of the table regardless of sort direction.
function sortRows(rows, col, dir) {
  const withIndex = rows.map((row, i) => ({ row, i }));
  withIndex.sort((a, b) => {
    const va = sortValue(a.row, col);
    const vb = sortValue(b.row, col);
    const aNull = va == null || va === "";
    const bNull = vb == null || vb === "";
    if (aNull && bNull) return a.i - b.i;
    if (aNull) return 1;
    if (bNull) return -1;
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    if (cmp === 0) return a.i - b.i;
    return dir === "asc" ? cmp : -cmp;
  });
  return withIndex.map((x) => x.row);
}

// Position chips, same six positions the showdown board actually carries (server/showdown/board.js rows:
// QB/RB/WR/TE/K/DST — no FLEX chip here, unlike the classic filter bar, since a showdown pool has no FLEX
// position of its own to combine RB/WR/TE into). Colours match the sd-pos-<pos> pill classes (style.css).
const SD_POSITION_CHIPS = ["All", "QB", "RB", "WR", "TE", "K", "DST"];

function filterRows(rows, filters, game) {
  return rows.filter((row) => {
    if (filters.team === "away" && row.team !== game?.away) return false;
    if (filters.team === "home" && row.team !== game?.home) return false;
    if (filters.pos !== "All" && (row.pos ?? "").trim().toUpperCase() !== filters.pos) return false;
    if (filters.maxSalary != null && (row.salary ?? Infinity) > filters.maxSalary) return false;
    // "Min FLEX pts" always compares against the FLEX projection (row.proj), never cptProj, even though
    // the row also carries a Captain projection (Adam, confirmed) — a player with no projection at all
    // is treated as below any floor, same as the salary filter treats a missing salary as above any cap.
    if (filters.minProj != null && (row.proj ?? -Infinity) < filters.minProj) return false;
    return true;
  });
}

function computeVisibleRows() {
  const rows = state.board?.rows ?? [];
  const filtered = filterRows(rows, state.filters, state.board?.game);
  return sortRows(filtered, state.sort.col, state.sort.dir);
}

// --------------------------------------------------------------------------------------------------------
// Render
// --------------------------------------------------------------------------------------------------------

function teamFullName(abbr) {
  return TEAM_BY_ABBR[abbr]?.name ?? abbr ?? "";
}

function renderBand() {
  const g = state.board?.game ?? {};
  const away = teamFullName(g.away);
  const home = teamFullName(g.home);
  const when = kickoffDateAndClock(g.kickoffEt);
  els.band.innerHTML = `<span class="sd-band-text">SHOWDOWN &middot; ${escapeHtml(away)} at ${escapeHtml(home)}${when ? ` &middot; ${escapeHtml(when)} ET` : ""}</span>`;
}

// Four small boxes above the Rankings table (👁 visual-qa: like the hosted sheet's Total/Line/implied
// boxes), built from payload.game — never re-derived, just the numbers the board already computed.
function renderGameLine() {
  if (!els.gameline) return;
  const g = state.board?.game;
  if (!g) {
    els.gameline.innerHTML = "";
    return;
  }
  const total = g.total != null ? dec1(g.total) : "—";
  const line = g.favorite && g.spread != null ? `${g.favorite} -${dec1(Math.abs(g.spread))}` : "—";
  const awayImplied = g.implied?.[g.away] != null ? dec1(g.implied[g.away]) : "—";
  const homeImplied = g.implied?.[g.home] != null ? dec1(g.implied[g.home]) : "—";
  els.gameline.innerHTML = `
    <div class="sd-gameline-box"><span class="sd-gameline-label">Total</span><span class="sd-gameline-value">${escapeHtml(total)}</span></div>
    <div class="sd-gameline-box"><span class="sd-gameline-label">Line</span><span class="sd-gameline-value">${escapeHtml(line)}</span></div>
    <div class="sd-gameline-box"><span class="sd-gameline-label">${escapeHtml(g.away ?? "Away")} implied</span><span class="sd-gameline-value">${escapeHtml(awayImplied)}</span></div>
    <div class="sd-gameline-box"><span class="sd-gameline-label">${escapeHtml(g.home ?? "Home")} implied</span><span class="sd-gameline-value">${escapeHtml(homeImplied)}</span></div>`;
}

// D40: the legend names its actual sources instead of a hard-coded sentence, read straight off the board
// payload so it always matches whatever sources actually fed this week's numbers.
function joinWords(list) {
  const words = list.filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function renderLegend() {
  if (!els.legend) return;
  const sources = state.board?.sources ?? [];
  const projLabels = joinWords(sources.filter((s) => s.kind === "projection").map((s) => s.label));
  const hasKickerCard = sources.some((s) => s.kind === "kicker");
  const ownLabels = joinWords((state.board?.ownershipSources ?? []).map((s) => s.label));
  const projText = projLabels ? `Proj from ${projLabels}${hasKickerCard ? " (kickers as consolidated)" : ""}` : "";
  const ownText = ownLabels ? `Own from ${ownLabels}, estimates for the rest` : "";
  const sourceSentence = [projText, ownText].filter(Boolean).join("; ");
  const legendText = [
    sourceSentence,
    "published and estimated ownership look the same; hover any Proj or Own cell for exactly how that number was made and, for Own, whether it was published or estimated",
  ]
    .filter(Boolean)
    .join(" · ");
  els.legend.textContent = legendText;
}

function renderEmpty() {
  els.emptyState.hidden = false;
  els.rankingsPanel.hidden = true;
  els.projectionsPanel.hidden = true;
  els.ownershipPanel.hidden = true;
  els.lineupPanel.hidden = true;
  els.band.innerHTML = "";
  els.emptyState.textContent = state.loading ? "Loading the showdown board…" : state.error ?? "Could not load this showdown.";
}

function onSortClick(col) {
  if (state.sort.col === col) state.sort = { col, dir: state.sort.dir === "asc" ? "desc" : "asc" };
  else state.sort = { col, dir: defaultDirFor(col) };
  renderRankingsTable();
}

function renderRankingsTable() {
  const visible = computeVisibleRows();
  renderShowdownTableHead(els.thead, state.sort, onSortClick);
  renderShowdownTableBody(els.tbody, visible);
  const countEl = els.filterbar.querySelector("#sd-filter-count");
  if (countEl) countEl.textContent = `${visible.length} of ${(state.board?.rows ?? []).length} players`;
}

function renderFilterBar() {
  const g = state.board?.game ?? {};
  const posChipsHtml = SD_POSITION_CHIPS.map(
    (pos) => `<button type="button" class="chip pos-chip sd-pos-chip${pos === state.filters.pos ? " active" : ""}" data-pos-filter="${pos}" data-pos="${pos}">${pos}</button>`
  ).join("");
  els.filterbar.innerHTML = `
    <div class="filter-row">
      <div class="chip-group">
        <button type="button" class="chip pos-chip${state.filters.team === "both" ? " active" : ""}" data-team-filter="both">Both</button>
        <button type="button" class="chip pos-chip${state.filters.team === "away" ? " active" : ""}" data-team-filter="away">${escapeHtml(g.away ?? "Away")}</button>
        <button type="button" class="chip pos-chip${state.filters.team === "home" ? " active" : ""}" data-team-filter="home">${escapeHtml(g.home ?? "Home")}</button>
      </div>
      <div class="chip-group" id="sd-pos-chips">${posChipsHtml}</div>
      <div class="filter-salary">
        <label>Max FLEX salary <input id="sd-max-salary" type="number" step="200" placeholder="any" value="${state.filters.maxSalary ?? ""}" /></label>
        <label>Min FLEX pts <input id="sd-min-proj" type="number" step="1" placeholder="any" value="${state.filters.minProj ?? ""}" /></label>
      </div>
      <span id="sd-filter-count" class="filter-count"></span>
      <button type="button" id="sd-clear-filters-btn" class="link-btn">Clear filters</button>
    </div>`;
  els.filterbar.querySelectorAll("[data-team-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filters.team = btn.dataset.teamFilter;
      renderFilterBar();
      renderRankingsTable();
    });
  });
  els.filterbar.querySelectorAll("[data-pos-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filters.pos = btn.dataset.posFilter;
      renderFilterBar();
      renderRankingsTable();
    });
  });
  // Same as classic's "Clear filters": a deliberate click, so a full rebuild of the bar is fine.
  els.filterbar.querySelector("#sd-clear-filters-btn")?.addEventListener("click", () => {
    state.filters = { team: "both", pos: "All", maxSalary: null, minProj: null };
    renderFilterBar();
    renderRankingsTable();
  });
  // Patches the table only (not the whole filter bar) on every keystroke, same reasoning as the classic
  // filter bar's salary inputs (public/js/filterbar.js): rebuilding the input itself would steal focus.
  const maxInput = els.filterbar.querySelector("#sd-max-salary");
  maxInput?.addEventListener("input", () => {
    state.filters.maxSalary = maxInput.value === "" ? null : Number(maxInput.value);
    renderRankingsTable();
  });
  const minProjInput = els.filterbar.querySelector("#sd-min-proj");
  minProjInput?.addEventListener("input", () => {
    state.filters.minProj = minProjInput.value === "" ? null : Number(minProjInput.value);
    renderRankingsTable();
  });
}

// Applies an already-fetched, already-ok board response as the new current board, gated by the same
// token/key check as a plain load (🔵 findings: use the board that refresh/paste already return instead
// of a second GET; discard a response for a key that's no longer current).
function applyBoardResponse(raw, key, token) {
  if (!isCurrent(token, key)) return false;
  state.board = normalizeBoard(raw);
  state.boardKey = key;
  state.error = null;
  state.loading = false;
  render();
  return true;
}

async function loadBoard(key) {
  const token = beginRequest(key);
  // A good board for a DIFFERENT key is not shown while the new one loads (there is nothing honest to
  // show), but a good board for THIS SAME key (a Refresh, or navigating back to a key already loaded) is
  // never cleared just because a reload started (🔵 finding: never blank a good board).
  if (state.boardKey !== key) {
    state.board = null;
    state.error = null;
  }
  state.loading = true;
  render();
  try {
    const raw = await getShowdownBoard(key);
    if (!isCurrent(token, key)) return;
    if (!raw || !raw.ok) {
      state.loading = false;
      // A good board already on screen (same key, a prior success) stays up; the failure is reported in
      // the status line rather than blanking the page.
      if (state.board && state.boardKey === key) {
        els.status.textContent = `Could not reload: ${raw?.error?.message ?? "unknown error"}`;
        els.status.className = "status error";
        render();
      } else {
        state.error = raw?.error?.message ?? "Could not load this showdown.";
        render();
      }
      return;
    }
    applyBoardResponse(raw, key, token);
  } catch (e) {
    if (!isCurrent(token, key)) return;
    state.loading = false;
    if (state.board && state.boardKey === key) {
      els.status.textContent = `Could not reload: ${e.message}`;
      els.status.className = "status error";
      render();
    } else {
      state.error = e.message;
      render();
    }
  }
}

function render() {
  renderShowdownTabs(els.tabs, state.activeTab, (tab) => {
    state.activeTab = tab;
    render();
  });
  if (!state.board) {
    renderEmpty();
    return;
  }
  els.emptyState.hidden = true;
  els.rankingsPanel.hidden = state.activeTab !== "rankings";
  els.projectionsPanel.hidden = state.activeTab !== "projections";
  els.ownershipPanel.hidden = state.activeTab !== "ownership";
  els.lineupPanel.hidden = state.activeTab !== "lineup";

  // The gold band and stale/failed source pills show on all four tabs (brief).
  renderBand();
  renderPills(els.pillsRow, { staleIds: state.board.stale ?? [], sources: state.board.sources ?? null, warnings: [] });

  if (state.activeTab === "rankings") {
    renderGameLine();
    renderFilterBar();
    renderRankingsTable();
    renderLegend();
  } else if (state.activeTab === "projections") {
    renderShowdownProjectionsPanel(els.projectionsPanel, state.board, {
      onPaste: async (payload) => {
        const key = state.boardKey;
        const token = beginRequest(key);
        const result = await postShowdownProjectionsPaste(key, payload);
        if (result?.ok && result.board) applyBoardResponse(result.board, key, token);
        return result;
      },
    });
  } else if (state.activeTab === "ownership") {
    renderShowdownOwnershipPanel(els.ownershipPanel, state.board);
  } else if (state.activeTab === "lineup") {
    renderShowdownLineupPanel(els.lineupPanel, state.board, state.boardKey);
  }
}

els.refreshBtn?.addEventListener("click", async () => {
  const key = state.boardKey ?? state.requestedKey;
  if (!key) return;
  const token = beginRequest(key);
  els.status.textContent = "Refreshing sources...";
  els.status.className = "status";
  try {
    const r = await postShowdownRefresh(key);
    if (!isCurrent(token, key)) return;
    if (!r || r.ok === false) throw new Error(r?.error?.message ?? "unknown error");
    applyBoardResponse(r, key, token);
    els.status.textContent = "Refreshed.";
  } catch (e) {
    if (!isCurrent(token, key)) return;
    els.status.textContent = `Could not refresh: ${e.message}`;
    els.status.className = "status error";
  }
});

// Called by app.js whenever the mode row or a hash change points at a given showdown key. Reloads the
// board only when the key actually changed (a tab click or sort re-renders through render() directly,
// above, without refetching) — but a key that's already the requested one (e.g. the same tile clicked
// twice) does not re-fetch either.
export async function renderShowdownView(key) {
  if (!key) return;
  if (state.requestedKey !== key) {
    await loadBoard(key);
  } else if (state.board) {
    render();
  }
}

// Exported for app.js (🔵 finding): after a successful CSV upload of the showdown already on screen, the
// board is stale (new salaries, maybe a new week) and must be reloaded even though the hash didn't change.
export async function forceReloadShowdown(key) {
  if (!key) return;
  await loadBoard(key);
}

// Exported for app.js's upload flow (🔵 finding): the upload response's own stale list is shown
// immediately, the same way the classic header's wireUpload shows pills before the board reload lands.
export function showUploadPills(staleIds) {
  renderPills(els.pillsRow, { staleIds: staleIds ?? [], sources: state.board?.sources ?? null, warnings: [] });
}
