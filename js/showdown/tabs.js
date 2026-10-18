// Showdown tabs: the same four as classic (Rankings, Projections, Projected Ownership, Lineup Builder).
// Rankings is rendered by view.js/table.js; Lineup Builder's real implementation lives in lineup.js and
// is re-exported at the bottom of this file, mirroring how public/js/tabs.js re-exports its own
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
import { shownRows } from "./table.js";
import { showAllToggleHtml, wireShowAllButtons } from "../filterbar.js";
import { store } from "../state.js";

const TABS = [
  { key: "rankings", label: "Rankings" },
  { key: "projections", label: "Projections" },
  { key: "ownership", label: "Projected Ownership" },
  { key: "lineup", label: "Lineup Builder" },
];

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

function ownershipSourceCardHtml(s) {
  const rowCount = Array.isArray(s.rows) ? s.rows.length : 0;
  const noteLines = Array.isArray(s.notes) ? s.notes.map(escapeHtml).join("<br>") : "";
  return `
    <div class="source-card">
      <div class="source-card-head"><span class="source-label">${escapeHtml(s.label ?? s.id ?? "")}</span></div>
      ${s.kind ? `<div class="source-card-row muted"><span>${escapeHtml(s.kind)}</span></div>` : ""}
      <div class="source-card-row muted"><span>${rowCount} row${rowCount === 1 ? "" : "s"}</span>${s.url ? `<span title="${escapeHtml(s.url)}">link</span>` : ""}</div>
      ${noteLines ? `<div class="source-card-row muted"><span>${noteLines}</span></div>` : ""}
    </div>`;
}

// "published" | "override" | null, labelled plainly (🔵 review item 4: override reads "your override", not the
// internal token; a name a named source published reads "published", never "quoted"); null is missing (D29).
function kindLabel(kind) {
  if (kind === "published") return "published";
  if (kind === "override") return "your override";
  return "—";
}

// FLEX and Captain each carry their own kind (ownKindFlex/ownKindCpt) — a player can be published at one
// side and missing at the other, so each cell is labelled from its own kind, not a single row-level flag
// (🔵 review item 4).
function ownershipRowHtml(r) {
  return `<tr>
    <td class="pc-name" data-card-id="${escapeHtml(String(r.id))}">${escapeHtml(r.name)}</td>
    <td>${escapeHtml(r.team ?? "")}</td>
    <td>${r.ownFlex == null ? "—" : `${dec1(r.ownFlex)}%`}</td>
    <td>${escapeHtml(kindLabel(r.ownKindFlex))}</td>
    <td>${r.ownCpt == null ? "—" : `${dec1(r.ownCpt)}%`}</td>
    <td>${escapeHtml(kindLabel(r.ownKindCpt))}</td>
    <td class="sd-recipe-cell" title="${escapeHtml(r.ownHow ?? "")}">${escapeHtml(r.ownHow ?? "")}</td>
  </tr>`;
}

// Projected Ownership tab (brief): a table of each player's published sources (board.ownershipSources),
// the consolidated number per side, published vs override vs missing, and the recipe text (row.ownHow).
export function renderShowdownOwnershipPanel(container, board) {
  const sources = board.ownershipSources ?? [];
  const cards = sources.map(ownershipSourceCardHtml).join("");
  const rows = shownRows(board.rows ?? []).map(ownershipRowHtml).join("");
  container.innerHTML = `
    <p class="tab-note">${showAllToggleHtml(store.get().filters.showAllPlayers, `data-action="show-all"`)} Own FLEX/CPT is consolidated from the published sources below (D40). A player nobody published a number for shows a dash until a source publishes one. A number Adam typed in shows as "your override". Hover the Recipe column, or any Own cell on the Rankings tab, for exactly how each number was made.</p>
    <div class="source-card-grid">${cards}</div>
    <div class="tab-table-wrap scroll-panel">
      <table class="source-value-table">
        <thead><tr><th>Player</th><th>Team</th><th>Own FLEX</th><th>Kind (FLEX)</th><th>Own CPT</th><th>Kind (CPT)</th><th>Recipe</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  wireShowAllButtons(container);
}

export { renderShowdownLineupPanel } from "./lineup.js";
