// Splits a source's unmatched names into those worth Adam's attention and those that simply are not playing.
// A source projects all 32 teams, so on a slate of a few games most of its "unmatched" names are players on
// teams that are not in the loaded slate; those are counted and tucked behind a closed disclosure rather than
// listed in the open (Adam, 2026-10-10).
//
// The server labels an unmatched record "Name (TEAM)" (server/rank/board.js recordLabel), or just "Name" when
// the source gave no team. A name is "on the slate" (shown in the open) when:
//   - its team is on the slate; or
//   - its team is missing or not a code this page recognises (e.g. a source writing JAC for JAX, or a name
//     that ends in "(III)"), so a spelling difference can never hide a real miss; or
//   - its name part is exactly the name of a player in the slate's rows (trimmed, case-insensitive), whatever
//     team the label says, so a traded or newly signed slate player stays visible; or
//   - the slate has no teams at all (nothing to compare against), so nothing is hidden.
import { TEAM_BY_ABBR } from "./teams-data.js";

/** The team code at the end of a label ("Name (BUF)", "X (QB) (BUF)", "name (buf)"), upper-cased, or null. */
export function labelTeam(label) {
  const m = /\(([A-Za-z]{2,4})\)\s*$/.exec(String(label ?? ""));
  return m ? m[1].toUpperCase() : null;
}

/** The text before the last " (" of a label, trimmed and lower-cased; the whole label when it has none. */
export function labelName(label) {
  const s = String(label ?? "");
  const i = s.lastIndexOf(" (");
  return (i >= 0 ? s.slice(0, i) : s).trim().toLowerCase();
}

/**
 * `slateTeams`: a Set (or array) of team codes on the loaded slate. `slateRows`: the rows of that slate, used
 * only for the name guard (optional). Returns { onSlate: [...], offSlate: [...] }.
 */
export function splitUnmatched(names, slateTeams, slateRows = null) {
  const slate = slateTeams instanceof Set ? slateTeams : new Set(slateTeams ?? []);
  const slateNames = new Set((slateRows ?? []).map((r) => String(r?.name ?? "").trim().toLowerCase()).filter(Boolean));
  const onSlate = [];
  const offSlate = [];
  for (const label of names ?? []) {
    const team = labelTeam(label);
    const known = team != null && TEAM_BY_ABBR[team] != null;
    if (slate.size === 0 || !known || slate.has(TEAM_BY_ABBR[team].abbr) || slateNames.has(labelName(label))) onSlate.push(label);
    else offSlate.push(label);
  }
  return { onSlate, offSlate };
}

/** The team codes of the rows a tab is showing (the board rows for the active slate). */
export function slateTeamSet(rows) {
  const set = new Set();
  for (const r of rows ?? []) {
    if (!r?.team) continue;
    const code = String(r.team).toUpperCase();
    set.add(TEAM_BY_ABBR[code]?.abbr ?? code); // DK's alias and the canonical code count as one team
  }
  return set;
}

/** The card's shared markup pieces: the open list of on-slate names and the closed disclosure for the rest. */
export function unmatchedPartsHtml(names, slateTeams, slateRows, escapeHtml) {
  const { onSlate, offSlate } = splitUnmatched(names, slateTeams, slateRows);
  const listHtml = onSlate.length
    ? `<details class="source-unmatched"><summary>${onSlate.length} unmatched</summary>${onSlate.map(escapeHtml).join(", ")}</details>`
    : "";
  const offSlateHtml = offSlate.length
    ? `<details class="source-unmatched source-unmatched-off muted"><summary>${offSlate.length} on teams not playing</summary>${offSlate.map(escapeHtml).join(", ")}</details>`
    : "";
  return { onSlate, offSlate, listHtml, offSlateHtml };
}
