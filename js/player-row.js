// The one player row (RULES.md D80): every list that names a player draws him with these functions and never builds its own cell.
import { escapeHtml, textColourFor, logoFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { opponentLabel, outTagHtml, lineupOutTagHtml, statusTagsHtml } from "./table.js";

const SINGLE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "DST", "K"]);

export function showPos(listFilter) {
  if (Array.isArray(listFilter)) return new Set(listFilter.map((p) => String(p ?? "").trim().toUpperCase()).filter(Boolean)).size !== 1;
  return !SINGLE_POSITIONS.has(String(listFilter ?? "").trim().toUpperCase());
}

// A logo whose dark-background art (logoDark) is extreme in tone carries logo-tone-light or logo-tone-dark, so the CSS lifts it (a light mark on a lineup card's plate, a dark one on a dark pool row);
// the class is set only when logoFor picked that logoDark art (the light theme draws the other file, which reads on a light row as it is).
export function logoToneClass(t, src) {
  return t && t.logoTone && src && src === t.logoDark && t.logoDark !== t.logo ? ` logo-tone-${t.logoTone}` : "";
}

export function teamLogoHtml(team, cls, size) {
  const t = TEAM_BY_ABBR[team];
  const src = logoFor(t);
  if (!src) return "";
  return `<img class="${cls}${logoToneClass(t, src)}" src="${escapeHtml(src)}" alt="${escapeHtml(team)}" title="${escapeHtml(team)}" width="${size}" height="${size}" />`;
}

export function teamChipHtml(team, { plain = false } = {}) {
  const abbr = String(team ?? "").trim();
  if (!abbr) return "";
  if (plain) return `<span class="team-chip-mini team-chip-plain">${escapeHtml(abbr)}</span>`;
  const t = TEAM_BY_ABBR[abbr];
  const primary = t?.colourPrimary ?? "#333333";
  return `<span class="team-chip-mini" style="background:${primary};color:${textColourFor(primary, t?.colourSecondary ?? "#ffffff")}">${escapeHtml(abbr)}</span>`;
}

export function posChipHtml(pos, posHtml = null) {
  const label = String(pos ?? "").trim();
  if (!label) return "";
  return posHtml ? posHtml(label) : `<span class="pos-mini">${escapeHtml(label)}</span>`;
}

export function playerTagHtml(row) {
  return lineupOutTagHtml(row) || statusTagsHtml(row);
}

/**
 * One player's identity, in the one order: logo, name (always class player-name), status tag, team abbreviation (Adam 2026-10-18 Q3: the tag
 * sits right after the name), then the position chip when `opts.pos` (a list sets it from showPos). The team abbreviation is drawn only when the row has no logo
 * (D80 as amended 2026-10-25, Adam 7:12 PM: "we have the logo ... so I can see people's names"; `chip` is accepted and ignored). Options: logo false (this builder draws no logo), logoShown (the caller draws the team logo itself, as the lineup cards do, so no chip), chip (accepted, inert: no logo draws the chip, a logo never does), nameCls, nameHtml, titled, chipPlain, posHtml, tagCls, and `tag`: false for none,
 * "out" for the red OUT alone (lineups), "main" for TwoGun's OUT rule plus the status badges (main-slate lists), else R82's OUT or the badges; `tagWrap(tagHtml)` draws the tag's place itself (null keeps it).
 */
export function playerIdentityHtml(row, opts = {}) {
  const r = row ?? {};
  const logo = opts.logo === false ? "" : teamLogoHtml(r.team, "player-logo", 20);
  const name = `<span class="player-name${opts.nameCls ? ` ${opts.nameCls}` : ""}"${opts.titled ? ` title="${escapeHtml(r.name ?? "")}"` : ""}>${opts.nameHtml ?? escapeHtml(r.name ?? "")}</span>`;
  const chip = logo || opts.logoShown ? "" : teamChipHtml(r.team, { plain: opts.chipPlain }); // D80, Adam 2026-10-25 7:12 PM: "we have the logo ... so I can see people's names"; only a row with no logo draws the chip
  const tagDrawn = opts.tag === false ? "" : opts.tag === "out" ? lineupOutTagHtml(r) : opts.tag === "main" ? outTagHtml(r) || statusTagsHtml(r) : playerTagHtml(r);
  const tagInner = typeof opts.tagWrap === "function" ? opts.tagWrap(tagDrawn) ?? tagDrawn : tagDrawn; // a pool wraps the tag in its In / Out switch (status-switch.js, Adam 2026-11-12)
  const tag = tagInner && opts.tagCls ? `<span class="${opts.tagCls}">${tagInner}</span>` : tagInner;
  const pos = opts.pos ? posChipHtml(r.pos, opts.posHtml) : "";
  return `${logo}${name}${tag}${chip}${pos}`; // Adam 2026-10-18 Q3: the tag's place is this one line, right after the name
}

export function num1(n) {
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : null;
}

export function matchupPillText(row) {
  const opp = opponentLabel(row);
  const team = num1(row?.impliedTotal);
  const game = num1(row?.total);
  const nums = [];
  if (team !== null && game !== null) nums.push(`${team}tm / ${game}tot`);
  if (Number.isFinite(row?.spread)) nums.push(row.spread < 0 ? num1(row.spread) : row.spread > 0 ? `+${num1(row.spread)}` : "pk");
  return [opp, nums.join(" / ")].filter(Boolean).join(" · ");
}

export function matchupPillHtml(row) {
  const text = matchupPillText(row);
  return text ? `<span class="meta-pill">${escapeHtml(text)}</span>` : "";
}

/**
 * The pool rows' matchup (the Player cell's `.l2`, classic and Showdown; Adam 10:01 AM 11-15 and 1:21 PM 11-16, PROJECT.md Part 4 Monday 11-16 item 7): the opponent as its own narrow column
 * in the Player cell (look.css lays `.l1` and `.l2` side by side from 901px up, so every row's matchup starts at one left edge; under the name on a narrow screen). `opp` is opponentLabel's
 * text ("v KC", "@LV", or "").
 */
export function poolMatchupHtml(row, opp) {
  return opp ? `<span class="mu">${escapeHtml(String(opp))}</span>` : "";
}

/** A greyed row's few words (seat-picker `short`, plain text) on a line of their own under the name and matchup. */
export function poolWhyHtml(whyText) {
  return whyText ? `<div class="l3"><span class="blk-why">${escapeHtml(String(whyText))}</span></div>` : "";
}

/** The position chip of a pool row: one class per position (`pos-qb`, `pos-rb`, `pos-wr`, `pos-te`, `pos-dst`, `pos-k`) so look.css can colour each its own. */
export function poolPosHtml(pos) {
  const label = String(pos ?? "").trim();
  if (!label) return "";
  const key = label.toLowerCase().replace(/[^a-z]/g, "");
  return `<span class="pos${key ? ` pos-${key}` : ""}">${escapeHtml(label)}</span>`;
}

/** The team abbreviation chip for a pool row whose team has no logo (the logo already names the team; D80); "" otherwise. */
export function poolNoLogoTeamHtml(row) {
  return logoFor(TEAM_BY_ABBR[row?.team]) ? "" : teamChipHtml(row?.team);
}

export function playerLineHtml(row, opts = {}) {
  return `${playerIdentityHtml(row, opts)}${opts.pill === false ? "" : matchupPillHtml(opts.pillRow ?? row)}`;
}
