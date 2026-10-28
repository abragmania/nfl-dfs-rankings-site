// The game-log table of the player card. The column families, the stat reader, the totals row and the trade
// separator are adapted from NFLDepthCharts public/js/panel.js (GAMELOG_FAMILIES and col(), gameLogTotalsRowHtml,
// gameLogTableHtml), a read-only copy under D6 as amended 2026-10-18. Differences: the rows come already built by
// server/playercard/build.js (so DraftKings points arrive as `dk`, not computed here), a game with no box score is a
// dash rather than a row of zeros, and only the three DraftKings families exist.
import { escapeHtml } from "./format.js";

const dash = "—";
const col = (c) => (s) => s[c] ?? 0; // the log keeps only non-zero numbers, so a stat missing from a played game's line is a real 0

export const DK_HEADING = "DK pts";
export const DK_TITLE = "DraftKings points from his box score: offense only, so no return or two-point scoring";
export const GAMELOG_FAMILIES = {
  QB: [["CMP", col("completions")], ["ATT", col("attempts")], ["YDS", col("passing_yards")], ["TD", col("passing_tds")], ["INT", col("passing_interceptions")],
    ["CAR", col("carries")], ["R YDS", col("rushing_yards")], ["R TD", col("rushing_tds")], ["FL", col("fumbles_lost_total")]],
  RB: [["ATT", col("carries")], ["YDS", col("rushing_yards")],
    ["AVG", (s) => (s.carries ? (Math.round(((s.rushing_yards ?? 0) / s.carries) * 10) / 10).toFixed(1) : dash)],
    ["TD", col("rushing_tds")], ["TGT", col("targets")], ["REC", col("receptions")], ["REC YDS", col("receiving_yards")], ["REC TD", col("receiving_tds")], ["FL", col("fumbles_lost_total")]],
  WR_TE: [["TGT", col("targets")], ["REC", col("receptions")], ["YDS", col("receiving_yards")], ["TD", col("receiving_tds")],
    ["CAR", col("carries")], ["R YDS", col("rushing_yards")], ["R TD", col("rushing_tds")], ["FL", col("fumbles_lost_total")]],
};

const one = (n) => Number(n).toFixed(1);

function totalsRowHtml(cols, log) {
  const played = log.entries.filter((g) => g.played);
  if (!played.length) return "";
  const sum = {};
  for (const g of played) {
    for (const [k, v] of Object.entries(g.stats ?? {})) sum[k] = (sum[k] ?? 0) + (Number(v) || 0);
  }
  const t = log.totals;
  const cells = cols.map(([, get]) => `<td>${escapeHtml(get(sum))}</td>`).join("");
  const snap = t.snapPct == null ? dash : `${t.snapPct}`;
  const dk = t.dk == null ? dash : one(t.dk);
  const short = t.dkGames < t.games;
  const partial = short ? ` title="${escapeHtml(`Counts the ${t.dkGames} of his ${t.games} games that have a box score on file`)}"` : "";
  return `<tfoot><tr class="pc-log-total"><td>Total</td><td${partial}>${short ? `${t.dkGames} of ${t.games}` : t.games} G</td><td title="Season snap share, NFLDepthCharts team file">${snap}</td>${cells}<td class="pc-log-dk"${partial}>${dk}</td></tr></tfoot>`;
}

/** The table for `log` (data.gameLog of the player-card answer); a sentence when he has no games on file. */
export function gameLogTableHtml(log) {
  const cols = GAMELOG_FAMILIES[log?.family];
  if (!cols) return `<div class="pc-empty">No game log for this position.</div>`;
  if (!log.entries.length) return `<div class="pc-empty">No ${escapeHtml(log.season)} regular-season games on file for him yet.</div>`;
  const head = `<th>Wk</th><th>Opp</th><th title="Share of his team's snaps in the game">Snap %</th>${cols.map(([h]) => `<th>${escapeHtml(h)}</th>`).join("")}<th class="pc-log-dk" title="${escapeHtml(DK_TITLE)}">${DK_HEADING}</th>`;
  const clubOf = (g) => g.withTeam ?? log.club;
  const body = log.entries.map((g, i) => {
    const newer = i > 0 ? clubOf(log.entries[i - 1]) : null;
    const move = newer && clubOf(g) && newer !== clubOf(g)
      ? `<tr class="pc-log-trade"><td colspan="${4 + cols.length}">Traded from ${escapeHtml(clubOf(g))} to ${escapeHtml(newer)}</td></tr>` : "";
    const opp = g.opponent ? `${g.away ? "@ " : "vs "}${g.opponent}` : dash;
    const lead = `<td>${escapeHtml(g.week)}</td><td>${escapeHtml(opp)}</td>`;
    if (!g.played) return `${move}<tr class="pc-log-dnp">${lead}<td colspan="${2 + cols.length}">did not play</td></tr>`;
    const snap = `<td>${g.snapPct == null ? dash : escapeHtml(g.snapPct)}</td>`;
    const cells = cols.map(([, get]) => `<td>${g.stats ? escapeHtml(get(g.stats)) : dash}</td>`).join("");
    return `${move}<tr>${lead}${snap}${cells}<td class="pc-log-dk">${g.dk == null ? dash : one(g.dk)}</td></tr>`;
  }).join("");
  const wide = cols.length >= 8 ? " pc-log-wide" : "";
  return `<table class="pc-log-table${wide}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${totalsRowHtml(cols, log)}</table>`;
}
