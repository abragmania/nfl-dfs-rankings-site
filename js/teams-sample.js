// Temporary (Adam 2026-10-18): remove when he has seen the colours.
// The "Teams (sample)" tab: one card row and one saved-lineup row for each of the 32 teams, in the colours the lineup
// cards would wear with all 32 teams on one slate. Sample names and no numbers (salary and projection print as dashes).
import { escapeHtml, money } from "./format.js";
import { TEAMS } from "./teams-data.js";
import { slatePalette } from "./team-palette.js";
import { cardPlayerRowHtml, teamColours, teamColourStyle, teamLogoHtml } from "./lineup-card.js";

const SAMPLE_POSITIONS = ["QB", "RB", "WR", "TE"];

export const TEAMS_SAMPLE_NOTE = "Temporary page: 32 sample rows, one per team, to check the team colour schemes. Sample values, no real data.";

/** The 32 sample players, one per team, alphabetical by abbr. No salary, projection or ownership. */
export function sampleTeamPlayers() {
  const abbrs = TEAMS.map((t) => t.abbr).sort();
  return abbrs.map((abbr, i) => {
    const t = TEAMS.find((x) => x.abbr === abbr);
    return {
      id: `sample-${abbr}`,
      name: `${t.name ?? t.nickname ?? abbr} sample`,
      pos: SAMPLE_POSITIONS[i % SAMPLE_POSITIONS.length],
      team: abbr,
      opp: `vs ${abbrs[(i + 1) % abbrs.length]}`,
      own: null,
      salary: null,
      proj: null,
    };
  });
}

export function teamsSampleHtml() {
  const players = sampleTeamPlayers();
  const palette = slatePalette(players.map((p) => p.team));
  const decor = {
    tagsFor: () => "",
    rolesFor: () => "",
    coloursFor: (team) => teamColours(palette, team),
  };
  const boxes = players.map((p) => {
    const cardRow = cardPlayerRowHtml(p, p.pos, false, null, decor);
    // Copies savedLineupSlotHtml's markup (lineup.js); this page is temporary (🔵 2026-10-18 series review).
    const savedRow = `
      <div class="saved-lineup-slot saved-lineup-slot-tc" style="${teamColourStyle(teamColours(palette, p.team))}">
        <span class="saved-lineup-slot-pos">${escapeHtml(p.pos)}</span>
        ${teamLogoHtml(p.team, "saved-lineup-slot-logo", 16) || `<span class="saved-lineup-slot-team">${escapeHtml(p.team)}</span>`}
        <span class="saved-lineup-slot-name">${escapeHtml(p.name)}</span>
        <span class="saved-lineup-slot-salary">${money(p.salary)}</span>
      </div>`;
    return `<div class="opt-card teams-sample-box"><div class="opt-card-players">${cardRow}</div><div class="saved-lineup-slots">${savedRow}</div></div>`;
  }).join("");
  return `<p class="tab-note">${escapeHtml(TEAMS_SAMPLE_NOTE)}</p><div class="teams-sample-grid">${boxes}</div>`;
}
