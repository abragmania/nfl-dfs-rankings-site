// The Optimizer's exposure tables: one per position, over a set of lineups (lineup.js draws and re-draws them).
import { escapeHtml, textColourFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { store } from "./state.js";
import { lineupOutTagHtml } from "./table.js";
import { pickButtonHtml } from "./lineup-filter.js";

export const OPT_POSITIONS = ["QB", "RB", "WR", "TE", "DST"];

let lookupBoard = null;
let lookup = new Map();
function outTagForId(id) {
  const board = store.get().board;
  if (board !== lookupBoard) {
    lookupBoard = board;
    lookup = new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
  }
  const row = lookup.get(String(id));
  return row ? lineupOutTagHtml(row) : "";
}

function teamBadgeHtml(team) {
  const t = TEAM_BY_ABBR[team];
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  return `<span class="team-chip-mini" style="background:${primary};color:${textColourFor(primary, secondary)}">${escapeHtml(team ?? "")}</span>`;
}

export function sortExposure(list, dir) {
  const sign = dir === "asc" ? 1 : -1;
  return [...(list ?? [])].sort(
    (a, b) => sign * ((a.count ?? 0) - (b.count ?? 0) || (a.pct ?? 0) - (b.pct ?? 0)) || String(a.name ?? "").localeCompare(String(b.name ?? ""))
  );
}

// D55: exposure by position, columns Exposure, Player, Team, Matchup (D43), Own% (D32); D74: over the new batch or the saved lineups.
export function optExposureHtml(exposure, subtitle = "", sortDir = "desc", pick = null) {
  const dir = sortDir === "asc" ? "asc" : "desc";
  const arrow = dir === "asc" ? " ▲" : " ▼";
  const head = `<tr><th class="sortable sorted opt-exp-pct" data-action="opt-exp-sort" aria-sort="${dir === "asc" ? "ascending" : "descending"}">Exposure${arrow}</th><th>Player</th><th>Team</th><th>Matchup</th><th class="opt-exp-own">Own%</th></tr>`;
  const boxes = OPT_POSITIONS.map((pos) => {
    const list = Array.isArray(exposure?.[pos]) ? exposure[pos] : [];
    const body = list.length
      ? `<table class="opt-exp-table"><thead>${head}</thead><tbody>${sortExposure(list, dir)
          .map(
            (e) => `
          <tr class="opt-exp-row">
            <td class="opt-exp-pct">${escapeHtml(String(Math.round(e.pct ?? 0)))}% <span class="opt-exp-count">(${escapeHtml(String(e.count ?? 0))})</span></td>
            <td class="opt-exp-name">${pick && e.id != null ? pickButtonHtml({ id: e.id, name: e.name ?? "", chosen: pick.isChosen(e.id) }) : escapeHtml(e.name ?? "")}${e.id != null ? outTagForId(e.id) : ""}</td>
            <td class="opt-exp-team">${teamBadgeHtml(e.team)}</td>
            <td class="opt-exp-opp">${escapeHtml(e.opp ?? "")}</td>
            <td class="opt-exp-own">${e.own == null ? "" : `${escapeHtml(String(Math.round(e.own)))}%`}</td>
          </tr>`
          )
          .join("")}</tbody></table>`
      : `<div class="opt-exp-empty">None</div>`;
    return `<div class="opt-exp-box"><div class="opt-exp-title">${escapeHtml(pos)}</div><div class="opt-exp-list">${body}</div></div>`;
  }).join("");
  const sub = subtitle ? ` <span class="opt-sub">${escapeHtml(String(subtitle))}</span>` : "";
  return `
    <div class="opt-exposure">
      <h3 class="opt-title">Exposure by position${sub}</h3>
      <div class="opt-exp-grid">${boxes}</div>
    </div>`;
}
