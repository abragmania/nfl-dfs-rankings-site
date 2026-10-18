// The one player row (RULES.md D80): every list that names a player draws him with these functions and never builds its own cell.
import { escapeHtml, textColourFor, logoFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { matchupText, outTagHtml, lineupOutTagHtml, statusTagsHtml } from "./table.js";

const SINGLE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "DST", "K"]);

export function showPos(listFilter) {
  if (Array.isArray(listFilter)) return new Set(listFilter.map((p) => String(p ?? "").trim().toUpperCase()).filter(Boolean)).size !== 1;
  return !SINGLE_POSITIONS.has(String(listFilter ?? "").trim().toUpperCase());
}

export function teamLogoHtml(team, cls, size) {
  const src = logoFor(TEAM_BY_ABBR[team]);
  if (!src) return "";
  return `<img class="${cls}" src="${escapeHtml(src)}" alt="${escapeHtml(team)}" title="${escapeHtml(team)}" width="${size}" height="${size}" />`;
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
 * sits right after the name), then the position chip when `opts.pos` (a list sets it from showPos). Options: logo false, nameCls, nameHtml, titled, chipPlain, posHtml, tagCls, and `tag`: false for none,
 * "out" for the red OUT alone (lineups), "main" for TwoGun's OUT rule plus the status badges (main-slate lists), else R82's OUT or the badges.
 */
export function playerIdentityHtml(row, opts = {}) {
  const r = row ?? {};
  const logo = opts.logo === false ? "" : teamLogoHtml(r.team, "player-logo", 20);
  const name = `<span class="player-name${opts.nameCls ? ` ${opts.nameCls}` : ""}"${opts.titled ? ` title="${escapeHtml(r.name ?? "")}"` : ""}>${opts.nameHtml ?? escapeHtml(r.name ?? "")}</span>`;
  const chip = teamChipHtml(r.team, { plain: opts.chipPlain });
  const tagInner = opts.tag === false ? "" : opts.tag === "out" ? lineupOutTagHtml(r) : opts.tag === "main" ? outTagHtml(r) || statusTagsHtml(r) : playerTagHtml(r);
  const tag = tagInner && opts.tagCls ? `<span class="${opts.tagCls}">${tagInner}</span>` : tagInner;
  const pos = opts.pos ? posChipHtml(r.pos, opts.posHtml) : "";
  return `${logo}${name}${tag}${chip}${pos}`; // Adam 2026-10-18 Q3: the tag's place is this one line, right after the name
}

export function num1(n) {
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : null;
}

export function matchupPillText(row) {
  const opp = matchupText(row);
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

export function playerLineHtml(row, opts = {}) {
  return `${playerIdentityHtml(row, opts)}${opts.pill === false ? "" : matchupPillHtml(opts.pillRow ?? row)}`;
}
