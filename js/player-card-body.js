// The inside of the player card: pure functions from the answer of GET /api/player-card/<id> and the clicked list row to
// HTML. The initials fallback, the colour-scaled rating box, the height and draft text are adapted from NFLDepthCharts
// public/js/panel.js (initials, ratingTier, gradeBoxHtml, heightFromInches, draftLine, bioRowHtml), a read-only copy
// under D6 as amended 2026-10-18; the markup and class names are this app's own. Every figure here is either from
// this app's board row or from NFLDepthCharts, and the source line says which and as of when (router, Data rules).
import { escapeHtml, money, dec1, pct1, localStamp, textColourFor, logoFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { matchupText, statusTagsHtml, lineupOutTagHtml } from "./table.js";
import { gameLogTableHtml } from "./player-card-log.js";
import { bumpStepsOf, bumpPctText } from "./bump-control.js";

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

function stampText(iso) {
  const s = localStamp(iso);
  return s ? `${s.monthDay} ${s.clock} ET` : "an unknown time";
}

const labelOf = (board, id, kind) => (board?.sources ?? []).find((s) => s && s.id === id && s.kind === kind)?.label ?? id;
const fetchedOf = (board, id, kind) => (board?.sources ?? []).find((s) => s && s.id === id && s.kind === kind)?.fetchedAt ?? null;
const sayList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "");

/**
 * One time style on the card, Eastern, "Nov 1 11:52 ET" (format.js localStamp for an ISO stamp; TwoGun's own text "Sun, Nov 1, 11:52 AM ET" is
 * re-read into the same form). null when the stamp is missing or unreadable: the card then says `as-of missing`, never a time the source did not have.
 */
export function whenShort(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const s = localStamp(raw);
    return s ? `${s.monthDay} ${s.clock} ET` : null;
  }
  // The text must say Eastern: "8:03 PM CT" is not an ET time, and reading it as one would print a time the source never had.
  const m = /(?:^|,\s*)([A-Z][a-z]{2}) (\d{1,2}),? (\d{1,2}):(\d{2})\s*(AM|PM)\s*ET\b/.exec(raw);
  if (!m) return null;
  const hour = (Number(m[3]) % 12) + (m[5] === "PM" ? 12 : 0);
  return `${m[1]} ${Number(m[2])} ${String(hour).padStart(2, "0")}:${m[4]} ET`;
}

/** The oldest of the stamps as one time, or null when any of them is unknown (a figure is only as dated as its least dated source). ISO stamps sort; TwoGun's text is read the same way. */
function oldestShort(shorts) {
  if (!shorts.length || shorts.some((s) => s === null)) return null;
  // Compared on the printed month, day and clock, in season order (September first): the stamps of one week never span a year.
  const MONTHS = ["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];
  const key = (s) => { const [m, d, hm] = s.split(" "); return MONTHS.indexOf(m) * 1e6 + Number(d) * 1e4 + Number(hm.replace(":", "")); };
  return [...shorts].sort((a, b) => key(a) - key(b))[0];
}
const asOf = (when, word = "as of") => (when ? `${word} ${when}` : "as-of missing");

/** A source's stamp ({ asOf, asOfFrom } or null) as the one time style: null (as-of missing) for no stamp, an unreadable one, or the board's own build time, which no source ever had. */
const stampWhen = (s) => (s && s.asOfFrom !== "board built" ? whenShort(s.asOf) : null);

/**
 * The words after a figure's name for ONE figure: `ids` are the sources that made it (row.srcUsed: select.js classicRow, select-showdown.js), null for a board that did not record them.
 * `nameOf(id)` and `stampOf(id)` ({ asOf, asOfFrom } or null) say who and when for each; `own` words TwoGun's stamp "updated" (ownership) rather than "board updated".
 * Any source with no stamp makes the whole figure `as-of missing`.
 */
function figureLineOf(what, ids, { nameOf, stampOf, own = false }) {
  if (ids === null) return `${what}: sources not recorded on this board`;
  if (ids.length === 0) return `${what}: no source`;
  const stamps = ids.map(stampOf);
  const whens = stamps.map(stampWhen);
  const fileTime = (s) => s?.asOfFrom === "file time";
  if (ids.length === 1 && ids[0] === "twogun") return `${what}: TwoGun, ${asOf(whens[0], fileTime(stamps[0]) ? "file saved" : own ? "updated" : "board updated")}`;
  if (ids.length === 1) return `${what}: ${nameOf(ids[0])}, ${asOf(whens[0], fileTime(stamps[0]) ? "file saved" : "as of")}`;
  return `${what}: a blend of ${sayList(ids.map(nameOf))}, ${asOf(oldestShort(whens))}`;
}

/** A classic row's line: names from board.sources, stamps from each card's pull and TwoGun's own posted times (board.mode.twogun). */
function classicFigureLine(what, ids, board, kind) {
  const twogun = board?.mode?.twogun;
  return figureLineOf(what, ids, {
    own: kind === "ownership",
    nameOf: (id) => (id === "twogun" ? "TwoGun" : labelOf(board, id, kind)),
    stampOf: (id) => ({ asOf: id === "twogun" ? (kind === "ownership" ? twogun?.ownershipUpdated : twogun?.boardUpdated) : fetchedOf(board, id, kind), asOfFrom: null }),
  });
}

/** A Showdown man's line: projection names from the cards (a kicker's from his kicker card), ownership names from the week's ownership files, each source's stamp from board.figures.stamps (board-view.js boardFigures). */
function showdownFigureLine(what, ids, board, half) {
  const own = half === "ownership";
  const projCard = (id) => (board?.sources ?? []).find((s) => s && s.kind === "projection" && s.id === id) ?? (board?.sources ?? []).find((s) => s && s.kind === "kicker" && s.sourceId === id);
  const file = (id) => (board?.ownershipSources ?? []).find((s) => s && s.id === id);
  return figureLineOf(what, ids, {
    own,
    nameOf: (id) => (id === "twogun" ? "TwoGun" : String((own ? file(id)?.label : projCard(id)?.label) ?? id).replace(/\s*\(our estimate\)\s*$/, "")),
    stampOf: (id) => board?.figures?.stamps?.[half]?.[id] ?? null,
  });
}

/** `Projection: set to 0: listed out by <the injury source>` for a man the board zeroed (listed out) whose figure was not 0 before: no source gave him 0 (sidelined.js zeroOutRows). A published 0 (before === 0) is not this. null otherwise. */
function zeroedLine(row) {
  const before = row?.override?.proj ?? row?.projBase;
  if (!(row?.proj === 0 && before !== 0)) return null;
  const by = row.injury?.source ?? (row.src?.status === "twogun" ? "TwoGun" : null);
  return `Projection: set to 0: listed out${by ? ` by ${by}` : ""}`;
}

/**
 * Where the clicked row's Proj and Own really come from (optimizer standard A8): a classic row names only the sources that made THIS figure
 * (row.srcUsed, set by select.js classicRow and the site's re-blend; projBySource and ownBySource hold every source's number, ticked or not, and are never read); a
 * figure that is missing reads `no source`; a bump and a typed number are named; a man the board zeroed reads `set to 0: listed out by <the injury source>`. A Showdown row does
 * the same from row.srcUsed { proj, ownFlex, ownCpt } (select-showdown.js), each source dated by board.figures.stamps. Any unknown stamp, a time that is not Eastern, or the
 * board's own build time reads `as-of missing`. Returns { sal, proj, own } as plain text, one short line each (a Showdown row also ownCpt).
 */
export function figureSources(row, board) {
  const showdown = row?.cptSalary !== undefined && row?.ownFlex !== undefined;
  const sal = `Salary: the DraftKings salary file, ${asOf(whenShort(board?.slate?.uploadedAt), "uploaded")}.`;
  const bump = bumpStepsOf(row);
  // What follows a figure's line: a typed number replaces the sources' (named), and a bump scales whichever figure is shown, but only a figure that exists (a bump on a man with no Proj moves nothing).
  const typed = (v) => (v != null ? " Your typed number replaces it." : "");
  const bumped = typeof row?.proj === "number" && bump ? ` Bumped ${bumpPctText(bump)}.` : "";
  const used = row?.srcUsed ?? null;
  const zeroed = zeroedLine(row);
  // A man the board zeroed (listed out) is not credited to the sources that gave him a number: nothing said 0 but the injury report, and a bump or a typed number moved nothing.
  const projWith = (line) => (zeroed ? `${zeroed}.` : `${row?.proj == null && row?.override?.proj == null ? "Projection: no source" : line()}.${typed(row?.override?.proj)}${bumped}`);
  if (showdown) {
    const ownWith = (value, typedValue, ids) => `${value == null && typedValue == null ? "Ownership: no source" : showdownFigureLine("Ownership", ids, board, "ownership")}.${typed(typedValue)}`;
    return {
      sal,
      proj: projWith(() => showdownFigureLine("Projection", used ? used.proj ?? null : null, board, "projection")),
      own: ownWith(row.ownFlex, row.override?.own, used ? used.ownFlex ?? null : null),
      ownCpt: ownWith(row.ownCpt, row.override?.ownCpt, used ? used.ownCpt ?? null : null),
    };
  }
  const own = row?.own == null && row?.override?.own == null ? "Ownership: no source" : classicFigureLine("Ownership", used ? used.own ?? null : null, board, "ownership");
  return { sal, proj: projWith(() => classicFigureLine("Projection", used ? used.proj ?? null : null, board, "projection")), own: `${own}.${typed(row?.override?.own)}` };
}

/** This week's figures from the clicked row: Sal, Proj and Own (a Showdown row also CPT Sal, CPT Proj and CPT Own) with the injury tag, and under them each figure's real source and as-of (figureSources). */
export function stripHtml(row, asOf = null, board = null) {
  if (!row) return "";
  const showdown = row.cptSalary !== undefined && row.ownFlex !== undefined;
  const own = showdown ? row.ownFlex : row.own;
  const src = figureSources(row, board); // asOf (the board's build time) is no longer a stand-in for a source's own time
  const cell = (label, value, title = "") => `<div class="pc-fig"${title ? ` title="${escapeHtml(title)}"` : ""}><span class="pc-fig-label">${label}</span><span class="pc-fig-value">${value}</span></div>`;
  const figs = [
    cell("Sal", money(row.salary), src.sal), // optimizer standard D1: Sal, Proj, Own; the Captain seat's wear CPT
    showdown ? cell("CPT Sal", money(row.cptSalary), src.sal) : "",
    cell("Proj", row.proj == null ? "no proj" : dec1(row.proj), row.projNote || src.proj),
    showdown ? cell("CPT Proj", row.cptProj == null ? "no proj" : dec1(row.cptProj), `Captain: 1.5x his projection. ${src.proj}`) : "",
    cell("Own", pct1(own) ?? dash, own == null ? "No source has published ownership for him" : src.own),
    showdown && row.ownCpt != null ? cell("CPT Own", pct1(row.ownCpt), `Captain ownership. ${src.ownCpt}`) : "",
  ].join("");
  // A Showdown man whose Captain ownership is shown and says something else than his FLEX ownership gets both, named; otherwise one Ownership line.
  const cptShown = showdown && row.ownCpt != null && src.ownCpt !== src.own;
  const lines = cptShown ? [src.sal, src.proj, src.own.replace(/^Ownership/, "FLEX ownership"), src.ownCpt.replace(/^Ownership/, "Captain ownership")] : [src.sal, src.proj, src.own];
  const tag = lineOutTagOrStatus(row);
  const status = tag ? `<div class="pc-fig pc-fig-tag" title="${escapeHtml(`Injury status from ${row.injury?.source ?? (row.src?.status === "twogun" ? "TwoGun" : "a source the board does not name")}`)}"><span class="pc-fig-label">Status</span><span class="pc-fig-value">${tag}</span></div>` : "";
  return `<div class="pc-strip">${figs}${status}</div>
    <div class="pc-strip-source">${lines.filter(Boolean).map(escapeHtml).join("<br>")}</div>`;
}

const lineOutTagOrStatus = (row) => lineupOutTagHtml(row) || statusTagsHtml(row);

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
  const strip = stripHtml(row, ctx.asOf ?? null, ctx.board ?? null);
  if (state === "loading") return `${head}${strip}<div class="pc-note" role="status">Loading his page from NFLDepthCharts…</div>`;
  if (state === "error") return `${head}${strip}<div class="pc-note pc-note-error" role="alert">${escapeHtml(ctx.message ?? "The player card could not be loaded.")}</div>`;
  if (!data.found) return `${head}${strip}<div class="pc-note">${escapeHtml(data.message ?? "No player card.")}</div>${data.source ? sourceLineHtml(data) : ""}`;
  const log = data.gameLog
    ? `<section class="pc-log"><h3 class="pc-log-title">${escapeHtml(data.gameLog.season)} game log <span class="pc-src">NFLDepthCharts</span></h3><div class="pc-log-wrap">${gameLogTableHtml(data.gameLog)}</div></section>`
    : `<div class="pc-note pc-note-error">${escapeHtml(data.gameLogMissing ?? "The game log is not available.")}</div>`;
  return `${head}${strip}${bioLineHtml(data.player.bio)}${log}${sourceLineHtml(data)}`;
}
