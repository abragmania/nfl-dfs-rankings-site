// The inside of the player card: pure functions from the answer of GET /api/player-card/<id> and the clicked list row to
// HTML. The initials fallback, the colour-scaled rating box, the height and draft text are adapted from NFLDepthCharts
// public/js/panel.js (initials, ratingTier, gradeBoxHtml, heightFromInches, draftLine, bioRowHtml), a read-only copy
// under D6 as amended 2026-10-18; the markup and class names are this app's own. Every figure here is either from
// this app's board row or from NFLDepthCharts, and the source line says which and as of when (router, Data rules).
import { escapeHtml, money, dec1, localStamp, textColourFor, logoFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { matchupText, statusTagsHtml, lineupOutTagHtml } from "./table.js";
import { gameLogTableHtml } from "./player-card-log.js";

const dash = "—";

function initialsOf(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Team-coloured initials in the headshot's place (no photo on file, or the photo did not load). */
export function initialsBadgeHtml(who) {
  const t = TEAM_BY_ABBR[who?.team];
  const primary = t?.colourPrimary ?? "#333333";
  const text = textColourFor(primary, t?.colourSecondary ?? "#ffffff");
  return `<span class="pc-shot pc-shot-initials" aria-hidden="true" style="background:${escapeHtml(primary)};color:${escapeHtml(text)}">${escapeHtml(initialsOf(who?.name))}</span>`;
}

function headshotHtml(who, headshot) {
  if (!headshot) return initialsBadgeHtml(who);
  return `<img class="pc-shot" src="${escapeHtml(headshot)}" alt="" width="72" height="72" loading="lazy" referrerpolicy="no-referrer" />`;
}

export function heightText(inches) {
  const n = Number(inches);
  return inches == null || !Number.isFinite(n) ? null : `${Math.floor(n / 12)}'${n % 12}"`;
}

export function draftText(draft) {
  if (!draft || draft.year == null) return null;
  const where = draft.round != null ? `R${draft.round}${draft.pick != null ? ` #${draft.pick}` : ""}` : draft.pick != null ? `#${draft.pick}` : "";
  return where ? `${draft.year} · ${where}` : String(draft.year);
}

export function bioLineHtml(bio) {
  if (!bio) return "";
  const college = bio.college ?? (bio.collegeNote === "international" ? "No college (international)" : null);
  const exp = bio.exp == null ? null : Number.isFinite(Number(bio.exp)) ? `${Number(bio.exp)} yr${Number(bio.exp) === 1 ? "" : "s"}` : String(bio.exp);
  const parts = [
    ["Height", heightText(bio.heightIn)],
    ["Weight", bio.weight != null ? `${bio.weight} lbs` : null],
    ["Age", bio.age != null ? `${bio.age} yo` : null],
    ["College", college],
    ["Experience", exp],
    ["Draft", draftText(bio.draft)],
  ];
  return `<div class="pc-bio">${parts.map(([label, v]) => `<span title="${label}">${v == null ? dash : escapeHtml(v)}</span>`).join("")}</div>`;
}

// The colour tiers of the rating box (their thresholds: 90, 80, 70, 60), on this app's existing grade colours.
export function ratingTier(v) {
  if (v == null) return "tier-flat";
  if (v >= 90) return "tier-elite";
  if (v >= 80) return "tier-strong";
  if (v >= 70) return "tier-avg";
  if (v >= 60) return "tier-weak";
  return "tier-flat";
}

/** The Madden rating box (D64): the number, the rank among his position, and which weekly update it is. */
export function ratingBoxHtml(rating) {
  if (!rating || rating.current == null) return "";
  const rank = rating.posRank && rating.posCount ? `#${rating.posRank} of ${rating.posCount} ${rating.maddenPos ?? ""}`.trim() : "";
  const week = /week-(\d+)/.exec(rating.iteration ?? "");
  return `<div class="pc-grade ${ratingTier(rating.current)}" title="Madden ratings, from NFLDepthCharts${week ? `, week ${week[1]} update` : ""}">
    <div class="pc-grade-num">${escapeHtml(rating.current)}</div>
    <div class="pc-grade-rank">${escapeHtml(rank)}</div>
    <div class="pc-grade-label">Madden rating</div>
  </div>`;
}

/** This week's figures from the clicked row (this app's board, as of `asOf`): salary, projection, ownership, with the injury tag. */
export function stripHtml(row, asOf = null) {
  if (!row) return "";
  const showdown = row.cptSalary !== undefined && row.ownFlex !== undefined;
  const own = showdown ? row.ownFlex : row.own;
  const tg = row.figuresFrom === "TwoGun";
  const src = tg ? "TwoGun" : "this app";
  const pre = tg ? "TwoGun " : "";
  const cell = (label, value, title = "") => `<div class="pc-fig"${title ? ` title="${escapeHtml(title)}"` : ""}><span class="pc-fig-label">${label}</span><span class="pc-fig-value">${value}</span></div>`;
  const figs = [
    cell(showdown ? "FLEX $" : "Salary", money(row.salary), "DraftKings salary file"),
    showdown ? cell("CPT $", money(row.cptSalary), "DraftKings salary file") : "",
    cell(tg ? "TwoGun proj" : "Proj", row.proj == null ? "no proj" : dec1(row.proj), tg ? (row.projNote || "TwoGun's projection, as the Lineup screen's switch shows it") : "This app's blended projection (the Projections tab lists its sources)"),
    cell(`${pre}${showdown ? "FLEX own" : "Own"}`, own == null ? dash : `${dec1(own)}%`, own == null ? `${tg ? "TwoGun has" : "No source has"} published ownership for him` : `Ownership as ${src} shows it`),
    showdown && row.ownCpt != null ? cell(`${pre}CPT own`, `${dec1(row.ownCpt)}%`, `Captain ownership as ${src} shows it`) : "",
  ].join("");
  const tag = lineupOutTagHtml(row) || statusTagsHtml(row);
  const status = tag ? `<div class="pc-fig pc-fig-tag" title="Injury tag from this app's own injury report"><span class="pc-fig-label">Status</span><span class="pc-fig-value">${tag}</span></div>` : "";
  return `<div class="pc-strip">${figs}${status}</div>
    <div class="pc-strip-source">${tg ? "Salary: this app's board" : "Salary, projection and ownership: this app's board"}, as of ${escapeHtml(stampText(asOf))}.${tg ? " Projection and ownership: TwoGun's, as the Lineup screen shows them." : ""}</div>`;
}

function stampText(iso) {
  const s = localStamp(iso);
  return s ? `${s.monthDay} ${s.clock}` : "an unknown time";
}

/** "Source: NFLDepthCharts team file as of ..., game log as of ..." with the stale marker and the link to his page there. */
export function sourceLineHtml(data, stale = []) {
  const s = data?.source;
  if (!s) return `<div class="pc-source">Source: NFLDepthCharts.</div>`;
  const staleMark = (flag) => (flag ? ` <span class="pc-stale" title="NFLDepthCharts could not be reached, so the last saved copy is shown">saved copy, not refreshed</span>` : "");
  const team = `team file as of ${escapeHtml(stampText(s.teamFile?.asOf))}${staleMark(s.teamFile?.stale)}`;
  const log = s.gamelog ? `, game log as of ${escapeHtml(stampText(s.gamelog.asOf))}${staleMark(s.gamelog.stale)}` : "";
  const link = s.link ? ` <a class="pc-link" href="${escapeHtml(s.link)}" target="_blank" rel="noopener noreferrer">His page there</a>` : "";
  return `<div class="pc-source">Source: NFLDepthCharts ${team}${log}.${link}</div>`;
}

function headHtml(who, row, data) {
  const player = data?.found ? data.player : null;
  const t = TEAM_BY_ABBR[who.team];
  const logo = logoFor(t);
  const number = player?.number ? `<span class="pc-num">#${escapeHtml(player.number)}</span>` : "";
  const matchup = row ? matchupText(row) : "";
  const tier = player?.matchTier === "B" ? `<span class="pc-tier" title="${escapeHtml(`NFLDepthCharts lists him as ${player.ndcName ?? "a similar name"}; matched on last name and a first-name nickname`)}">matched by last name</span>` : "";
  const subParts = [who.team ? `${logo ? `<img class="pc-logo" src="${escapeHtml(logo)}" alt="" width="18" height="18" />` : ""}${escapeHtml(who.team)}` : "", who.pos ? escapeHtml(who.pos) : "", matchup ? escapeHtml(matchup) : "", tier].filter(Boolean);
  return `<header class="pc-head">
    ${headshotHtml(who, player?.headshot ?? null)}
    <div class="pc-id">
      <h2 class="pc-name-title" id="pc-title">${escapeHtml(who.name)} ${number}</h2>
      <div class="pc-sub">${subParts.join('<span class="pc-dot">·</span>')}</div>
    </div>
    ${data?.found ? ratingBoxHtml(player.rating) : ""}
  </header>`;
}

/**
 * The whole card. `ctx` = { who: {id, name, team, pos}, row (the clicked list row or null), state: "loading" | "error" |
 * "ready", data (the route's answer), message (for "error"), asOf (the board's generatedAt) }.
 */
export function cardHtml(ctx) {
  const { who, row, state, data } = ctx;
  const head = headHtml(who, row, state === "ready" ? data : null);
  const strip = stripHtml(row, ctx.asOf ?? null);
  if (state === "loading") return `${head}${strip}<div class="pc-note" role="status">Loading his page from NFLDepthCharts…</div>`;
  if (state === "error") return `${head}${strip}<div class="pc-note pc-note-error" role="alert">${escapeHtml(ctx.message ?? "The player card could not be loaded.")}</div>`;
  if (!data.found) return `${head}${strip}<div class="pc-note">${escapeHtml(data.message ?? "No player card.")}</div>${data.source ? sourceLineHtml(data) : ""}`;
  const log = data.gameLog
    ? `<section class="pc-log"><h3 class="pc-log-title">${escapeHtml(data.gameLog.season)} game log <span class="pc-src">NFLDepthCharts</span></h3><div class="pc-log-wrap">${gameLogTableHtml(data.gameLog)}</div></section>`
    : `<div class="pc-note pc-note-error">${escapeHtml(data.gameLogMissing ?? "The game log is not available.")}</div>`;
  return `${head}${strip}${bioLineHtml(data.player.bio)}${log}${sourceLineHtml(data)}`;
}
