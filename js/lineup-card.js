// Pieces of the Optimizer's lineup slots and new-lineup cards (lineup.js).
import { escapeHtml, money, dec1, pct1, textColourFor } from "./format.js";
import { fillForDark, fillForLight, solidRow, barColour, liftForDark } from "./team-palette.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { playerIdentityHtml, matchupPillHtml, bareOppHtml, teamLogoHtml } from "./player-row.js";
import { lineupRoles, roleTagsHtml, stackLabel } from "./lineup-marks.js";

const NAME_SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;

export function initials(name, pos, team) {
  if (pos === "DST") return String(team ?? name ?? "").toUpperCase().slice(0, 3);
  const parts = String(name ?? "").trim().split(/\s+/).filter((w) => w && !NAME_SUFFIX.test(w));
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function badgeHtml(name, pos, team) {
  const t = TEAM_BY_ABBR[team];
  const primary = t?.colourPrimary ?? "#333333";
  const text = initials(name, pos, team);
  return `<span class="player-badge${text.length > 2 ? " player-badge-3" : ""}" aria-hidden="true" style="background:${primary};color:${textColourFor(primary, t?.colourSecondary ?? "#ffffff")}">${escapeHtml(text)}</span>`;
}

export function shortName(name, pos) {
  const full = String(name ?? "").trim();
  const parts = full.split(/\s+/);
  if (pos === "DST" || parts.length < 2 || parts[0].endsWith(".")) return full;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

export function cardNameHtml(p) {
  const name = String(p.name ?? "");
  const short = shortName(name, p.pos);
  const inner = short === name ? null : `<span class="nm-full">${escapeHtml(name)}</span><span class="nm-short" aria-hidden="true">${escapeHtml(short)}</span>`;
  return inner ? `<span title="${escapeHtml(name)}">${inner}</span>` : escapeHtml(name);
}

// Team rows round 2, Adam 2026-10-17: a row's { colour, alt, fillLight, fillDark, rowLight, rowDark, barLight, barDark } from the slate palette (or the team's own colours),
// (only `colour` and `alt` reach the page, through teamColourStyle; the fill and bar fields are the palette's, pinned by tests/team-palette.test.mjs).
export function teamColours(palette, team) {
  const t = TEAM_BY_ABBR[team];
  const e = palette?.get(team);
  const colour = e?.colour ?? t?.colourPrimary ?? "#333333";
  const alt = (e ? e.alt : t?.colourSecondary) ?? colour;
  const fillDark = e?.fillDark ?? fillForDark(colour);
  const fillLight = e?.fillLight ?? fillForLight(colour);
  const rowLight = e?.rowLight ?? solidRow(fillLight, "light");
  const rowDark = e?.rowDark ?? solidRow(fillDark, "dark");
  return { colour, alt, fillDark, fillLight, rowLight, rowDark,
    barLight: e?.barLight ?? barColour(fillLight, alt, "light", rowLight.alpha), barDark: e?.barDark ?? barColour(fillDark, alt, "dark", rowDark.alpha) };
}
// The style that every row wearing a team's tint carries (A20): --tc the team's colour, --tc2 its alt, --tcd the colour the dark theme draws the stripe and tint in
// (team-palette.js liftForDark: lifted only where the colour would not read on the dark card). The solid-row variables of the retired flat fill are no longer emitted.
export function teamColourStyle({ colour, alt }) {
  return `--tc:${escapeHtml(colour)};--tc2:${escapeHtml(alt)};--tcd:${escapeHtml(liftForDark(colour))}`;
}
export { teamLogoHtml };

export function cardDecor(lineup, rowById, palette = null) {
  const rowOf = (p) => rowById?.get(String(p.id)) ?? null;
  const players = (lineup.players ?? []).map((p) => ({ id: String(p.id), name: p.name, pos: p.pos, team: p.team, gameId: rowOf(p)?.gameId }));
  const roles = lineupRoles(players);
  const stack = stackLabel(players);
  return {
    stack: stack ? `<span class="opt-card-stack" title="${escapeHtml(stack.title)}">${escapeHtml(stack.text)}</span>` : "",
    rowFor: (p) => (rowOf(p) ? { ...p, ...rowOf(p) } : p),
    rolesFor: () => "",
    nameTagsFor: (p) => roleTagsHtml(roles.get(String(p.id))), // STACK / PAIR on the name line, so line 2 keeps its room for the whole matchup pill (spread included)
    coloursFor: (team) => teamColours(palette, team), // Team rows, Adam 2026-10-17
  };
}

// D54: a card row is 50px. Optimizer-first step 5 (Adam 2026-10-18: the nine building slots "formatted the same way as the smaller ones ... just bigger"):
// `big` (the builder's slots, style.css .opt-p-big, 64px) adds the one class and draws the logo at 48px; without it the markup is exactly the card's.
// The big row's first line is about 176px (460px slot, less Clear and the figures), so a long name would be cut with an ellipsis while the card shows it in full. A container query cannot
// tell a long name from a short one (every slot has the same width), so the row itself is marked when the full name cannot fit: more than NAME_FIT letters, or NAME_FIT_TAGGED beside an OUT tag
// (the tag takes about 40px more). style.css .opt-p-short then shows the card's short name ("M. Valdes-Scantling"); a name that fits stays full. Measured in Chrome at 1920px over the 525 names of the
// 2026 week 6 board: no untagged name of 18 letters or fewer is cut and every one of 21 or more is; tagged, none of 11 or fewer is cut, 12 is cut for 6 of 90 and 14 for 40 of 68. The limits are the
// longest that are never cut, so a name that would be cut is always shown short (a few that would fit, mostly tagged ones, are shown short too).
export const NAME_FIT = 18;
export const NAME_FIT_TAGGED = 11;
// D81: a Showdown slot (opts.pos) adds the position chip (about 44px) to line 1 but its slot is wider (the left column, about 786px at 1920). Measured in Chrome over the 525 names of the 2026 week 6
// board with the chip placed, plus a 30, 45 and 60 letter control that must be cut: at 1920, 1600 and 1366px no name of up to 24 letters is cut, with the chip alone or with the chip and an OUT tag; at 1100px
// chip and OUT tag together cut names from 19 letters (1 of 5 at 19, all of 21), the chip alone none. So the two limits above already hold for a Showdown slot and need no chip term.
export function bigNameNeedsShort(name, tagged) {
  return String(name ?? "").trim().length > (tagged ? NAME_FIT_TAGGED : NAME_FIT);
}
// The ONE lineup row (optimizer standard A5, 2026-11-03): the builder's slots, the new cards and the saved cards all draw it: slot, team logo, name
// with his position and injury letter (the red OUT tag for a man ruled out), the matchup in small type under it, then `Sal`, `Proj` and `Own`, each
// labelled. A missing figure is a dash, never zero (the Showdown slots print the reason beside the matchup, decor.rolesFor).
export function cardPlayerRowHtml(p, slotName, decor, opts = null) {
  const big = opts?.big === true;
  const row = decor?.rowFor ? decor.rowFor(p) : p;
  const line1 = playerIdentityHtml(row, { logo: false, logoShown: Boolean(teamLogoHtml(p.team, "opt-p-logo", 38)), nameCls: "opt-p-name", nameHtml: cardNameHtml(p), chipPlain: true, tagCls: "opt-p-tags", pos: opts?.pos !== false, posHtml: opts?.posHtml }); // tag left to the shared default: OUT for a man ruled out, else his injury letter
  const nameTags = decor?.nameTagsFor ? decor.nameTagsFor(p) : ""; // the builder slot's STACK / PAIR tags sit on the name line, so line 2 keeps its room for the matchup pill
  const shorten = big && bigNameNeedsShort(p.name, line1.includes('class="opt-p-tags"') || nameTags !== "");
  const fig = (cls, label, value) => `<span class="opt-p-fig ${cls}"><i>${label}</i><b>${value}</b></span>`;
  return `
      <div class="opt-p${big ? " opt-p-big" : ""}${shorten ? " opt-p-short" : ""}${opts?.cls ? ` ${opts.cls}` : ""}" style="${teamColourStyle(decor ? decor.coloursFor(p.team) : teamColours(null, p.team))}"${p.id != null ? ` data-card-id="${escapeHtml(String(p.id))}"` : ""}>
        <span class="opt-p-slot">${escapeHtml(slotName)}</span>
        ${teamLogoHtml(p.team, "opt-p-logo", big ? 48 : 38) || badgeHtml(p.name, p.pos, p.team)}
        <span class="opt-p-body">
          <span class="opt-p-line1">${line1}${nameTags}</span>
          <span class="opt-p-line2">${opts?.bareOpp ? bareOppHtml(row) : matchupPillHtml(row)}${decor ? decor.rolesFor(p) : ""}</span>
        </span>
        <span class="opt-p-figs">${fig("opt-p-sal", "Sal", money(p.salary))}${fig("opt-p-proj", "Proj", p.proj == null ? "—" : dec1(p.proj))}${fig("opt-p-own", "Own", pct1(p.own) ?? "—")}</span>
      </div>`;
}
