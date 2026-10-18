// Pieces of the Optimizer's lineup slots and new-lineup cards (lineup.js).
import { escapeHtml, money, dec1, textColourFor, logoFor } from "./format.js";
import { fillForDark, fillForLight, solidRow, barColour, ROW_FILL } from "./team-palette.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { lineupOutTagHtml } from "./table.js";
import { pickButtonHtml } from "./lineup-filter.js";
import { lineupRoles, roleTagsHtml, stackLabel } from "./lineup-marks.js";

// D32: any list of players carries ownership as "(NN% own)", but only when the player has a real number.
export function ownParen(own) {
  return own == null ? "" : ` (${Math.round(own)}% own)`;
}

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

export function cardNameHtml(p, pick) {
  const name = String(p.name ?? "");
  const short = shortName(name, p.pos);
  const inner = short === name ? null : `<span class="nm-full">${escapeHtml(name)}</span><span class="nm-short" aria-hidden="true">${escapeHtml(short)}</span>`;
  if (pick && p.id != null) return pickButtonHtml({ id: p.id, name, chosen: pick.isChosen(p.id), innerHtml: inner });
  return inner ? `<span title="${escapeHtml(name)}">${inner}</span>` : escapeHtml(name);
}

// Team rows round 2, Adam 2026-10-17: a row's { colour, alt, fillLight, fillDark, rowLight, rowDark, barLight, barDark } from the slate palette (or the team's own colours),
// and the style that sets --tc / --tc2 (the fallbacks), the two fills --tclp / --tcfp (style.css .opt-p; the dark one is L 28 to 42, Adam 2026-10-18 round-5 render) and the bars --tcbl / --tcbd.
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
// Solid rows (Adam 2026-10-18): per theme (l / d) the row text and the role-tag chip; --tca / --tcb only where the fill opacity was pulled down.
// 👁 2026-10-18 round 6: --tclp the light fill, --tcbl / --tcbd the left bar per theme. 🔵 2026-10-18 series review: the unread variables are no longer emitted.
export function teamColourStyle({ colour, alt, fillDark, fillLight, rowLight, rowDark, barLight, barDark }) {
  const tcfp = fillDark ?? fillForDark(colour);
  const tclp = fillLight ?? fillForLight(colour);
  const L = rowLight ?? solidRow(tclp, "light");
  const D = rowDark ?? solidRow(tcfp, "dark");
  const pulled = (row, theme, p) => (row.alpha === ROW_FILL[theme] ? "" : `;--tc${p}:${row.alpha}%`);
  const theme = (row, s) => `;--tct${s}:${row.text};--tcchip${s}:${row.chip}`;
  const tcbl = barLight ?? barColour(tclp, alt, "light", L.alpha);
  const tcbd = barDark ?? barColour(tcfp, alt, "dark", D.alpha);
  return `--tc:${escapeHtml(colour)};--tc2:${escapeHtml(alt)};--tcfp:${escapeHtml(tcfp)};--tclp:${escapeHtml(tclp)};--tcbd:${escapeHtml(tcbd)};--tcbl:${escapeHtml(tcbl)}`
    + theme(L, "l") + pulled(L, "light", "a") + theme(D, "d") + pulled(D, "dark", "b");
}
// Team rows round 3, Adam 2026-10-17: the team logo (theme variant) at `size` px, with the abbr as its alt; "" for a team with no logo,
// so the caller keeps its badge (card row) or its abbr text (Saved row).
export function teamLogoHtml(team, cls, size) {
  const src = logoFor(TEAM_BY_ABBR[team]);
  if (!src) return "";
  return `<img class="${cls}" src="${escapeHtml(src)}" alt="${escapeHtml(team)}" title="${escapeHtml(team)}" width="${size}" height="${size}" />`;
}

export function cardDecor(lineup, rowById, palette = null) {
  const rowOf = (p) => rowById?.get(String(p.id)) ?? null;
  const players = (lineup.players ?? []).map((p) => ({ id: String(p.id), name: p.name, pos: p.pos, team: p.team, gameId: rowOf(p)?.gameId }));
  const roles = lineupRoles(players);
  const stack = stackLabel(players);
  return {
    stack: stack ? `<span class="opt-card-stack" title="${escapeHtml(stack.title)}">${escapeHtml(stack.text)}</span>` : "",
    tagsFor: (p) => {
      const out = rowOf(p) ? lineupOutTagHtml(rowOf(p)) : "";
      return out ? `<span class="opt-p-tags">${out}</span>` : "";
    },
    rolesFor: (p) => roleTagsHtml(roles.get(String(p.id))),
    coloursFor: (team) => teamColours(palette, team), // Team rows, Adam 2026-10-17
  };
}

// D54: a card row is 50px.
export function cardPlayerRowHtml(p, slotName, isNew, pick, decor) {
  const dot = isNew ? `<span class="opt-p-dot" role="img" aria-label="new" title="Not in the lineup before"></span>` : `<span class="opt-p-dot"></span>`;
  return `
      <div class="opt-p${isNew ? " opt-p-new" : ""}" style="${teamColourStyle(decor ? decor.coloursFor(p.team) : teamColours(null, p.team))}">
        ${dot}
        <span class="opt-p-slot">${escapeHtml(slotName)}</span>
        ${teamLogoHtml(p.team, "opt-p-logo", 38) || badgeHtml(p.name, p.pos, p.team)}
        <span class="opt-p-body">
          <span class="opt-p-line1"><span class="opt-p-name">${cardNameHtml(p, pick)}</span>${decor ? decor.tagsFor(p) : ""}</span>
          <span class="opt-p-line2"><span class="opt-p-opp">${escapeHtml(p.opp ?? "")}</span><span class="opt-p-own">${escapeHtml(ownParen(p.own).trim())}</span>${decor ? decor.rolesFor(p) : ""}</span>
        </span>
        <span class="opt-p-nums"><span class="opt-p-sal">${money(p.salary)}</span><span class="opt-p-proj">${p.proj == null ? "—" : dec1(p.proj)}</span></span>
      </div>`;
}
