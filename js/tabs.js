// Tabs above the table: Rankings (rendered by table.js/gamestrip.js/filterbar.js, default),
// Projections, Projected Ownership, Lineup Builder.
import { escapeHtml, dec1, clockPart } from "./format.js";

const TABS = [
  { key: "rankings", label: "Rankings" },
  { key: "projections", label: "Projections" },
  { key: "ownership", label: "Projected Ownership" },
  { key: "lineup", label: "Lineup Builder" },
];

export function renderTabs(container, activeTab, onTabClick) {
  container.innerHTML = TABS.map(
    (t) => `<button type="button" class="tab-btn${t.key === activeTab ? " active" : ""}" data-tab="${t.key}">${escapeHtml(t.label)}</button>`
  ).join("");
  container.querySelectorAll(".tab-btn").forEach((el) => {
    el.addEventListener("click", () => onTabClick(el.dataset.tab));
  });
}

function sourceCardHtml(source) {
  const idAttr = escapeHtml(String(source.id));
  // 👁 visual-qa: long "not on the DK slate" lists collapse behind a disclosure instead of always
  // being shown in full; the label text is already the display name (server/rank/board.js's
  // recordLabel), so it's shown as-is.
  const unmatchedHtml = source.unmatchedNames?.length
    ? `<details class="source-unmatched"><summary>${source.unmatchedNames.length} unmatched</summary>${source.unmatchedNames.map(escapeHtml).join(", ")}</details>`
    : "";
  // Ownership tables only: the page's own "updated" text as the site wrote it, and, for a source kept at
  // weight 0, the plain statement that its numbers are stored and shown but never part of Own% (D35).
  const pageUpdatedHtml = source.pageUpdated
    ? `<div class="source-card-row muted"><span>Page updated ${escapeHtml(String(source.pageUpdated))}</span></div>`
    : "";
  const keptOnlyHtml = source.kind === "ownership" && Number(source.weight) === 0
    ? `<div class="source-card-row muted"><span>kept for comparison, not used in Own%</span></div>`
    : "";
  return `
    <div class="source-card" data-source-id="${idAttr}">
      <div class="source-card-head">
        <span class="source-label">${escapeHtml(source.label)}</span>
        <label class="source-enabled">
          <input type="checkbox" data-action="source-enabled" data-id="${idAttr}" ${source.enabled ? "checked" : ""} />
          Enabled
        </label>
      </div>
      <div class="source-card-row">
        <label>Weight <input type="number" step="0.1" min="0" class="source-weight-input" data-action="source-weight" data-id="${idAttr}" value="${source.weight}" /></label>
        <span class="source-status source-status-${escapeHtml(source.status ?? "")}">${escapeHtml(source.status ?? "unknown")}</span>
      </div>
      <div class="source-weight-error" data-id="${idAttr}" hidden></div>
      <div class="source-card-row muted">
        <span>Fetched ${source.fetchedAt ? clockPart(source.fetchedAt) : "never"}</span>
        <span>${source.recordCount ?? 0} rows · ${source.matchedCount ?? 0} matched · ${source.unmatchedCount ?? 0} unmatched</span>
      </div>
      ${pageUpdatedHtml}
      ${keptOnlyHtml}
      ${unmatchedHtml}
    </div>`;
}

// `coverageFn`: overrides the plain r.coverage read (the Ownership tab needs its own coverage, since board
// rows only carry the projection blend's coverage — see renderOwnershipPanel).
// `headerSuffixFn`: optional words added after a source's column header (the Ownership tab marks a source kept
// at weight 0 as "(not used)"); the Projections tab passes none, so its headers are the plain labels.
function sourceValueTableHtml(rows, sources, { valueField, bySourceField, coverageFn, coverageHeader = "Coverage", headerSuffixFn = null } = {}) {
  const head = `<tr><th>Player</th><th>Team</th>${sources.map((s) => `<th>${escapeHtml(s.label + (headerSuffixFn ? headerSuffixFn(s) : ""))}</th>`).join("")}<th>Blended</th><th>${escapeHtml(coverageHeader)}</th></tr>`;
  const body = rows
    .map((r) => {
      const cells = sources
        .map((s) => {
          const v = r[bySourceField]?.[s.id];
          return `<td>${v == null ? "—" : dec1(v)}</td>`;
        })
        .join("");
      const blended = r[valueField];
      const coverage = coverageFn ? coverageFn(r) : r.coverage;
      const coverageCell = coverage == null ? "—" : `${Math.round(coverage * 100)}%`;
      return `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.team)}</td>${cells}<td>${blended == null ? "—" : dec1(blended)}</td><td>${coverageCell}</td></tr>`;
    })
    .join("");
  return `<div class="tab-table-wrap scroll-panel"><table class="source-value-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
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

export function renderProjectionsPanel(container, board, callbacks) {
  const sources = (board.sources ?? []).filter((s) => s.kind === "projection");
  const cards = sources.map(sourceCardHtml).join("");
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
    ${sourceValueTableHtml(board.rows ?? [], sources, { valueField: "proj", bySourceField: "projBySource" })}
  `;

  wireSourceCards(container, callbacks.onSourceChange);

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

export function renderOwnershipPanel(container, board, callbacks) {
  const sources = (board.sources ?? []).filter((s) => s.kind === "ownership");
  const cards = sources.map(sourceCardHtml).join("");

  // Coverage here must describe ownership coverage, not the projection blend's coverage field that
  // board rows also carry: it is the share of the ownership sources that COUNT towards Own% (weight above
  // 0) that published a number for the row. A source kept at weight 0 is shown in its own column but never
  // counts here (D35). A player none of the counting sources published a number for, or a table with no
  // counting source at all, has no coverage to report, so the cell is an em dash.
  const isKeptOnly = (s) => Number(s.weight) === 0;
  const usedSources = sources.filter((s) => !isKeptOnly(s));
  const coverageFn = (r) => {
    if (!usedSources.length) return null;
    const covered = usedSources.filter((s) => r.ownBySource?.[s.id] != null).length;
    return covered === 0 ? null : covered / usedSources.length;
  };

  const rows = board.rows ?? [];
  const published = rows.filter((r) => r.ownKind === "quoted").length;
  const blank = rows.filter((r) => r.own == null).length;

  // The server's recipe is already plain English, so it is shown as it stands.
  container.innerHTML = `
    <div class="tab-recipe">${escapeHtml(board.recipes?.ownership ?? "")}</div>
    <p class="tab-note">${published} of ${rows.length} players have a published DraftKings ownership number; ${blank} are blank.</p>
    ${tabNotesHtml(board.tabNotes?.ownership)}
    <div class="source-card-grid">${cards}</div>
    ${sourceValueTableHtml(rows, sources, {
      valueField: "own",
      bySourceField: "ownBySource",
      coverageFn,
      coverageHeader: "Quoted coverage",
      headerSuffixFn: (s) => (isKeptOnly(s) ? " (not used)" : ""),
    })}
  `;

  wireSourceCards(container, callbacks.onSourceChange);
}

// The Lineup Builder tab's real implementation lives in lineup.js (its own state: locks, excludes, the
// nine slots and the option controls); re-exported here so app.js's existing
// `import { renderLineupPanel } from "./tabs.js"` keeps working unchanged.
export { renderLineupPanel } from "./lineup.js";
