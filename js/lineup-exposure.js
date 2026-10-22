// The Optimizer's exposure tables: one per position, over a set of lineups (lineup.js draws and re-draws them).
import { escapeHtml } from "./format.js";
import { store } from "./state.js";
import { playerLineHtml, matchupPillHtml } from "./player-row.js";
import { pickButtonHtml } from "./lineup-filter.js";

export const OPT_POSITIONS = ["QB", "RB", "WR", "TE", "DST"];

let lookupBoard = null;
let lookup = new Map();
function liveRowFor(e) {
  const board = store.get().board;
  if (board !== lookupBoard) {
    lookupBoard = board;
    lookup = new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
  }
  const row = e.id != null ? lookup.get(String(e.id)) : null;
  return row ? { ...e, ...row } : e;
}

export function sortExposure(list, dir) {
  const sign = dir === "asc" ? 1 : -1;
  return [...(list ?? [])].sort(
    (a, b) => sign * ((a.count ?? 0) - (b.count ?? 0) || (a.pct ?? 0) - (b.pct ?? 0)) || String(a.name ?? "").localeCompare(String(b.name ?? ""))
  );
}

/** A percent as a number of lineups of the batch, rounded up like the server's pctToLineups (0 is 0). */
export function exposureLimit(pct, asked) {
  if (!(pct > 0)) return 0;
  return Math.ceil((pct / 100) * asked - 1e-9);
}

/** A Min % as lineups, rounded down like the server's minLineups (PROJECT.md Part 4 Optimizer, Adam 2026-10-17); NaN, never
 *  0, when `asked` is no whole number of lineups, so a check sized by it fails closed (lineup.js MIN_COUNT_PROBLEM). */
export function minLimit(pct, asked) {
  if (!(pct > 0)) return 0;
  if (!Number.isInteger(asked) || asked < 1) return NaN;
  return Math.floor((pct / 100) * asked + 1e-9);
}

/** {kind: "under" | "over", title} for a new-batch row outside his Min % / Max %, else null; `marks` = {asked, min: {id: pct},
 *  max: {id: pct}} from the Go that made the batch (PROJECT.md Part 4 Optimizer (Min % and soft rules, Adam 2026-10-17)). */
export function exposureMark(row, marks, keyOf = null) {
  if (!marks || row?.id == null) return null;
  // keyOf (Showdown): a role-aware key, e.g. "cpt:<id>" / "flex:<id>", so one man as Captain and as FLEX are two marks; none = the id, as classic.
  const id = String(keyOf ? keyOf(row) : row.id);
  const count = row.count ?? 0;
  const min = marks.min?.[id] === undefined ? null : minLimit(marks.min[id], marks.asked);
  const max = marks.max?.[id] === undefined ? null : exposureLimit(marks.max[id], marks.asked);
  if (min !== null && count < min) return { kind: "under", title: `under his Min % (${count} of ${min})` };
  if (max !== null && count > max) return { kind: "over", title: `over his Max % (${count} of ${max})` };
  return null;
}

/** `exposure` plus a zero-count row for each player with a Min of a lineup or more who is in no lineup. `playerOf(id)` gives
 *  {name, pos, team, opp, own} or null; `inBatch(id)` says whether any lineup holds him (by his DraftKings identity). */
export function zeroMinRows(exposure, marks, playerOf, inBatch) {
  const out = Object.fromEntries(OPT_POSITIONS.map((p) => [p, [...(Array.isArray(exposure?.[p]) ? exposure[p] : [])]]));
  for (const [id, pct] of Object.entries(marks?.min ?? {})) {
    const p = playerOf(id);
    if (!(minLimit(pct, marks.asked) > 0) || !p || !out[p.pos] || inBatch(id)) continue;
    out[p.pos].push({ id: String(id), name: p.name, team: p.team ?? null, opp: p.opp ?? "", own: p.own ?? null, count: 0, pct: 0 });
  }
  return out;
}

// D55: exposure by position, columns Exposure, Player (the D80 shared cell, so no Team column), Matchup (the pill), Own% (D32); D74: over the new batch or the saved lineups.
// `custom` (Showdown, optional): {title, groups: [{title, rows, keyOf}], rowOpts} replaces the position boxes and the heading; each group is its own table, never summed with another.
// `custom.rowOpts` (optional) holds presentation options only (chip, pos), spread under the fixed ones (pick button, no pill, the OUT rule) so it can never override them (Showdown: {chip: false, pos: true}, Adam 2026-10-22); classic passes none.
export function optExposureHtml(exposure, subtitle = "", sortDir = "desc", pick = null, marks = null, custom = null) {
  const dir = sortDir === "asc" ? "asc" : "desc";
  const arrow = dir === "asc" ? " ▲" : " ▼";
  const head = `<tr><th class="sortable sorted opt-exp-pct" data-action="opt-exp-sort" aria-sort="${dir === "asc" ? "ascending" : "descending"}">Exposure${arrow}</th><th>Player</th><th class="opt-exp-opp">Matchup</th><th class="opt-exp-own">Own%</th></tr>`;
  const groups = custom?.groups ?? OPT_POSITIONS.map((pos) => ({ title: pos, rows: exposure?.[pos] }));
  const boxes = groups.map(({ title: pos, rows, keyOf }) => {
    const list = Array.isArray(rows) ? rows : [];
    const body = list.length
      ? `<table class="opt-exp-table"><thead>${head}</thead><tbody>${sortExposure(list, dir)
          .map((e) => {
            const mark = exposureMark(e, marks, keyOf);
            const live = liveRowFor(e);
            const nameHtml = pick && e.id != null ? pickButtonHtml({ id: e.id, name: e.name ?? "", chosen: pick.isChosen(e.id) }) : undefined;
            return `
          <tr class="opt-exp-row${mark ? " exp-off" : ""}"${mark ? ` title="${escapeHtml(mark.title)}"` : ""}>
            <td class="opt-exp-pct">${escapeHtml(String(Math.round(e.pct ?? 0)))}% <span class="opt-exp-count">(${escapeHtml(String(e.count ?? 0))})</span></td>
            <td class="opt-exp-name"><span class="player-cell">${playerLineHtml(live, { ...(custom?.rowOpts ?? {}), nameHtml, pill: false, tag: "out" })}</span></td>
            <td class="opt-exp-opp">${matchupPillHtml(live)}</td>
            <td class="opt-exp-own">${e.own == null ? "" : `${escapeHtml(String(Math.round(e.own)))}%`}</td>
          </tr>`;
          })
          .join("")}</tbody></table>`
      : `<div class="opt-exp-empty">None</div>`;
    return `<div class="opt-exp-box"><div class="opt-exp-title">${escapeHtml(pos)}</div><div class="opt-exp-list">${body}</div></div>`;
  }).join("");
  const sub = subtitle ? ` <span class="opt-sub">${escapeHtml(String(subtitle))}</span>` : "";
  return `
    <div class="opt-exposure">
      <h3 class="opt-title">${escapeHtml(custom?.title ?? "Exposure by position")}${sub}</h3>
      <div class="opt-exp-grid">${boxes}</div>
    </div>`;
}
