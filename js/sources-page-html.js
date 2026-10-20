// The Sources page's markup (Adam 2026-10-18): pure functions from the server's selection (GET /api/source-selection) to HTML,
// no DOM and no network, so tests/sources-page.test.mjs can read every sentence. The page itself, its events and its saves are
// in sources-page.js. One page for classic and Showdown alike.
import { escapeHtml as esc, localStamp } from "./format.js";
import { SOURCE_TABS } from "./tabs.js";
import { WEIGHT_MIN, WEIGHT_MAX } from "./weight-limits.js"; // the browser's copy; the server's is in selection-core.js, compared by a test

export { WEIGHT_MIN, WEIGHT_MAX };
export const WEIGHT_STEP = 0.25;
const REBUILD_LINE = "Changes rebuild the board from the data already pulled; nothing is re-downloaded.";
/** The header's quiet line: the body's own appliesTo in front ("Applies to classic slates." or "Applies to this Showdown game."), dropped when the body sends none (the public site). */
export const quietLine = (appliesTo) => (typeof appliesTo === "string" && appliesTo.trim() ? `Applies to ${appliesTo.trim()}. ${REBUILD_LINE}` : REBUILD_LINE);
export const PRESETS = Object.freeze([
  Object.freeze({ key: "twogun", label: "TwoGun only" }),
  Object.freeze({ key: "ours", label: "Our sources" }),
]);
// A source's status as the server names it, then the pill's class and words (and a hover for a row that carries no note of its own):
// cached copy reads "stale".
export const UNKNOWN_STATUS_TITLE = "The board could not be built just now, so nobody checked this source.";
const STATUS_PILL = Object.freeze({
  ok: ["ok", "ok"],
  cached: ["stale", "stale"],
  failed: ["failed", "failed"],
  "not fetched": ["none", "not fetched"],
  empty: ["none", "no players"], // pulled, but no player on this slate (server/sources/selection-view.js settleRow)
  unlisted: ["none", "not on this game's list"], // ticked here, but this game's ownership file has no such source (selection-view.js unlistedRows)
  unknown: ["none", "unknown", UNKNOWN_STATUS_TITLE], // the board could not be built (selection-view.js unknownWhenFailed)
});
const SLIM_KINDS = new Set(["lines", "injuries", "extras"]);
// Every section's header cells after the tick's, in the order rowHtml draws them; the first is the section's own title (👁 finding 1:
// the title sits in the header row instead of a line of its own).
const HEAD_CELLS = ["Weight", "Share", "Last pulled", "Posted", "Coverage", "Status"];
// One set of column widths for every choice table (style.css .sp-table: table-layout fixed), so tables side by side or stacked line up
// column for column (👁 finding 6); the name column takes what is left.
const COLGROUP = `<colgroup><col class="sp-w-tick"><col class="sp-w-name"><col class="sp-w-weight"><col class="sp-w-share"><col class="sp-w-pulled"><col class="sp-w-posted"><col class="sp-w-cov"><col class="sp-w-status"></colgroup>`;

/** "Oct 18 17:05" in the browser's local time (format.js localStamp, no date maths here), or null when the stamp is unreadable. */
export function stampText(ts) {
  const s = localStamp(ts);
  return s ? `${s.monthDay} ${s.clock}` : null;
}

/**
 * Whether a source counts toward the numbers: switched on and not at weight 0. A source that states no weight (a Showdown board's
 * cards may carry none) is on. The one copy; showdown/tabs.js reads it for the Projections table's columns.
 */
export const sourceIsTicked = (s) => s.enabled !== false && !(s.weight != null && Number(s.weight) <= 0);

const weightOf = (s, draft) => {
  const n = draft === undefined ? Number(s.weight) : Number(draft);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Whether a source gave figures for at least one player on this slate: not "not fetched", "failed", "empty" or "unknown" (the board
 * could not be built, so no source was looked at), and not a coverage of 0.
 * The server makes status and coverage agree (selection-view.js settleRow); a coverage the page cannot know (no slate rows) is not 0.
 */
const NO_FIGURES = new Set(["not fetched", "failed", "empty", "unknown", "unlisted"]);
const coversSomeone = (s) => !NO_FIGURES.has(s.status) && !(s.coverage != null && Number(s.coverage.matched) === 0);

/**
 * Each ticked source's whole-number share of the section's ticked weights ("40%"), as a Map id -> percent. A source that is not
 * ticked, whose weight is not above 0, or that covers no player on this slate has no share and is not counted in anyone else's
 * (👁 finding 4: a ticked source covering nobody contributes nothing). `drafts` maps id -> a weight still being typed.
 */
export function sharePercents(sources, drafts = new Map()) {
  const live = sources.filter((s) => s.use && coversSomeone(s) && weightOf(s, drafts.get(s.id)) > 0);
  const total = live.reduce((sum, s) => sum + weightOf(s, drafts.get(s.id)), 0);
  return new Map(live.map((s) => [s.id, Math.round((weightOf(s, drafts.get(s.id)) / total) * 100)]));
}

export function pillHtml(status, note) {
  const [cls, words, fallbackTitle] = STATUS_PILL[status] ?? ["none", String(status ?? "unknown")];
  const title = note || fallbackTitle;
  return `<span class="sp-pill sp-pill-${cls}"${title ? ` title="${esc(title)}"` : ""}>${esc(words)}</span>`;
}

const muted = (text) => `<span class="sp-muted">${esc(text)}</span>`;
const pulledHtml = (ts) => (stampText(ts) ? esc(stampText(ts)) : muted("never"));
// The source's own stamp as it reads, up to its first " (": a stamp that explains itself in brackets ("Mon, Oct 19, 6:07 PM CT (the
// Ceiling Board's UPDATED stamp ...)", 👁 round 2, V2) shows the stamp and keeps the brackets for the hover, which carries all of it and
// where it was read from. A plain string cut, no time read (D30); the stamp stays on one line (style.css td.sp-c-posted).
export function postedShown(text) {
  const s = String(text);
  const cut = s.indexOf(" (");
  return cut > 0 ? s.slice(0, cut) : s;
}
const postedHtml = (p) => (p?.text ? `<span class="sp-posted-text" title="${esc(p.where ? `${p.text} (${p.where})` : p.text)}">${esc(postedShown(p.text))}</span>` : muted("not stated"));
const coverageHtml = (c) => (c ? `${esc(c.matched)} of ${esc(c.total)}` : muted("none"));
// Why a box cannot be ticked, the server's words as sent (👁 finding 9); on the cell too, since a disabled box gets no hover of its own in every browser.
const whyNotTitle = (s) => (!s.canTick && s.whyNot ? ` title="${esc(s.whyNot)}"` : "");

function tickHtml(kind, s, ro) {
  const disabled = ro || !s.canTick;
  return `<input type="checkbox" class="sp-tick-box" data-sp="use" data-kind="${esc(kind)}" data-id="${esc(s.id)}"${s.use ? " checked" : ""}${disabled ? " disabled" : ""}${whyNotTitle(s)} aria-label="Use ${esc(s.label)}" />`;
}

function weightCellHtml(kind, s, view) {
  const draft = view.drafts.get(`${kind}/${s.id}`);
  const disabled = view.ro || !s.canTick;
  const shown = draft === undefined ? s.weight : draft;
  return `<input type="number" class="sp-weight-input" data-sp="weight" data-kind="${esc(kind)}" data-id="${esc(s.id)}" step="${WEIGHT_STEP}" min="${WEIGHT_MIN}" max="${WEIGHT_MAX}" value="${esc(shown)}"${disabled ? " disabled" : ""} aria-label="Weight of ${esc(s.label)}" />`;
}

function rowHtml(kind, s, share, view) {
  const key = `${kind}/${s.id}`;
  const cls = ["sp-row", s.use ? "" : "is-off", view.savedKey === key ? "is-saved" : ""].filter(Boolean).join(" ");
  // A long name wraps to a second line (style.css); its hover is the whole name, or why it cannot be ticked.
  const nameTitle = whyNotTitle(s) || ` title="${esc(s.labelFull ?? s.label)}"`;
  const row = `<tr class="${cls}" data-kind="${esc(kind)}" data-id="${esc(s.id)}">
    <td class="sp-c-tick"${whyNotTitle(s)}>${tickHtml(kind, s, view.ro)}</td>
    <td class="sp-c-name"${nameTitle}>${esc(s.label)}</td>
    <td class="sp-c-weight">${weightCellHtml(kind, s, view)}</td>
    <td class="sp-c-share"><span class="sp-share" data-share="${esc(kind)}/${esc(s.id)}">${share == null ? "" : `${share}%`}</span></td>
    <td class="sp-c-pulled">${pulledHtml(s.lastPulled)}</td>
    <td class="sp-c-posted">${postedHtml(s.posted)}</td>
    <td class="sp-c-cov">${coverageHtml(s.coverage)}</td>
    <td class="sp-c-status">${pillHtml(s.status, s.note)}<span class="sp-saved" aria-hidden="true">&#10003;</span></td>
  </tr>`;
  const err = view.errors.get(key);
  const um = view.unmatched?.get(key); // sources-page.js: the names this source gave that no player on the slate matched (D27), already escaped
  return `${row}${err ? `<tr class="sp-err-row"><td></td><td colspan="7" class="sp-err" role="alert">${esc(err)}</td></tr>` : ""}${um ? `<tr class="sp-um-row"><td></td><td colspan="7">${um}</td></tr>` : ""}`;
}

/** The two-way "Players these sources miss" toggle; `gaps` is "backup" or "blank". */
export function gapsHtml(kind, gaps, view) {
  const btn = (value, label) => `<button type="button" class="sp-seg-btn${gaps === value ? " active" : ""}" data-sp="gaps" data-kind="${esc(kind)}" data-gaps="${value}"${view.ro ? " disabled" : ""} aria-pressed="${gaps === value}">${label}</button>`;
  const err = view.errors.get(`gaps:${kind}`);
  return `<div class="sp-gaps"><span class="sp-gaps-label">Players these sources miss:</span><span class="sp-seg">${btn("backup", "fill from Our sources")}${btn("blank", "leave blank")}</span>${err ? `<span class="sp-err" role="alert">${esc(err)}</span>` : ""}</div>`;
}

/**
 * The foot's method note. The short note fits one line; a longer one wraps (the gaps toggle follows it); its hover is the whole sentence (`methodFull`
 * when the server sends a short note, 👁 round 2, V1). With the board's own recipe (`recipe`, the sentence the public site's page shows,
 * D71 and D40) the note is the summary of a closed disclosure that opens onto the recipe, so the recipe is on the page without
 * taking rows from the player table below. `open`: the disclosure was open before this redraw (sources-page.js keeps it open across saves).
 */
export function methodHtml(sec, open = false) {
  if (!sec.method) return "";
  const title = esc(sec.methodFull || sec.method);
  if (!sec.recipe) return `<p class="sp-method" title="${title}">${esc(sec.method)}</p>`;
  return `<details class="sp-method sp-recipe-box" data-recipe="${esc(sec.kind)}"${open ? " open" : ""}><summary title="${title}">${esc(sec.method)}</summary><p class="sp-recipe">${esc(sec.recipe)}</p></details>`;
}

/** One section's box: the table (its title in the header row), then the method note and the gaps toggle on one line. "" for a section with no sources (👁 finding 2). */
export function sectionHtml(sec, view) {
  if (!sec.sources?.length) return "";
  const shares = sharePercents(sec.sources, new Map([...view.drafts].filter(([k]) => k.startsWith(`${sec.kind}/`)).map(([k, v]) => [k.slice(sec.kind.length + 1), v])));
  const head = `<th></th><th class="sp-th-title"><h2 class="sp-h">${esc(sec.title)}</h2></th>${HEAD_CELLS.map((h) => `<th>${esc(h)}</th>`).join("")}`;
  const rows = sec.sources.map((s) => rowHtml(sec.kind, s, shares.get(s.id), view)).join("");
  const method = methodHtml(sec, Boolean(view.openRecipes?.has(sec.kind)));
  const gaps = sec.gaps ? gapsHtml(sec.kind, sec.gaps, view) : "";
  // The floated gaps toggle follows an inline method note (it sits at the end of the note's last line). A note with the recipe behind it
  // is a block, so the toggle goes first there and the note's summary runs beside it on the same line (👁 round 2, V1).
  const boxed = Boolean(sec.method && sec.recipe);
  return `<section class="sp-panel" data-kind="${esc(sec.kind)}">
    <table class="sp-table">${COLGROUP}<thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
    ${method || gaps ? `<div class="sp-foot">${boxed ? `${gaps}${method}` : `${method}${gaps}`}</div>` : ""}
  </section>`;
}

/** The header line: title, the preset segmented control (Custom lit and not clickable when the ticks match neither) and the quiet line. */
export function headerHtml(data, view) {
  const btn = (p) => `<button type="button" class="sp-seg-btn${data.preset === p.key ? " active" : ""}" data-sp="preset" data-preset="${p.key}"${view.ro ? " disabled" : ""} aria-pressed="${data.preset === p.key}">${esc(p.label)}</button>`;
  const custom = data.preset === "custom" ? `<button type="button" class="sp-seg-btn active" disabled aria-pressed="true" title="The ticks below match neither preset.">Custom</button>` : "";
  const err = view.errors.get("preset");
  // A page that cannot tell which preset is in force (no `preset` in its data) draws no preset control rather than a wrong one.
  const presets = data.preset == null ? "" : `<span class="sp-seg" role="group" aria-label="Preset">${PRESETS.map(btn).join("")}${custom}</span>`;
  // A Showdown game with no choices saved reads its default (server/sources/showdown-default.js): data.defaulted { preset, why }.
  const defaulted = defaultedPillHtml(data.defaulted);
  return `<div class="sp-head"><h1 class="sp-title">Sources</h1>${presets}${defaulted}<span class="sp-quiet">${esc(data.quiet ?? quietLine(data.appliesTo))}</span>${err ? `<span class="sp-err" role="alert">${esc(err)}</span>` : ""}</div>`;
}

/** The pill's words for a game reading its default: "default (TwoGun only)" or "default (Our sources)". */
export const defaultedPillText = (preset) => `default (${PRESETS.find((p) => p.key === preset)?.label ?? "Our sources"})`;

/** "" unless the game reads its default; the hover is the server's reason ("TwoGun only: his file for this game is posted"). */
export function defaultedPillHtml(defaulted) {
  if (!defaulted || typeof defaulted !== "object") return "";
  const why = typeof defaulted.why === "string" && defaulted.why ? ` ${defaulted.why}.` : "";
  const title = `No source choices are saved for this game yet.${why} Any change here saves this game's own choices.`;
  return `<span class="sp-pill sp-pill-none" title="${esc(title)}">${esc(defaultedPillText(defaulted.preset))}</span>`;
}
/** The Showdown page's line under the title (Adam 2026-10-20: every game keeps its own choices) and its one button. */
export const SCOPE_LINE = "This game's sources. The main slate and the other games keep their own.";
export const APPLY_ALL_LABEL = "Apply to the main slate and every game";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const listed = (keys) => (keys.length < 3 ? keys.join(" and ") : `${keys.slice(0, -1).join(", ")} and ${keys.at(-1)}`);

/**
 * The one line after "apply to every game" (the answer's `applied`, server/sources/selection-routes.js handleApplyAll): how many games
 * it reached, the ones it left out and why, and any ticked ownership source a game's own list does not carry. null without `applied`.
 */
export function appliedLineText(applied) {
  if (!applied || !Array.isArray(applied.scopes)) return null;
  const games = applied.scopes.filter((s) => s !== "classic").length;
  const parts = [`Applied to the main slate and ${plural(games, "game")}`];
  const by = (why) => (applied.skipped ?? []).filter((s) => s.why === why).map((s) => s.key);
  const out = [["played", by("played")], ["could not be read", by("unreadable")]].filter(([, keys]) => keys.length).map(([why, keys]) => `${listed(keys)} (${why})`);
  if (out.length) parts.push(`not to ${out.join(" or ")}`);
  const lacking = (applied.lacking ?? []).map((l) => `${l.scope} lists no ${listed(l.ids)}`);
  return `${parts.join("; ")}.${lacking.length ? ` Not on a game's own list, so shown there to untick: ${lacking.join("; ")}.` : ""}`;
}

/** The scope line and the "apply to every game" button, on a Showdown game's page only (data.scopeKind "showdown"); "" elsewhere. */
export function scopeLineHtml(data, view) {
  if (data.scopeKind !== "showdown") return "";
  const applied = appliedLineText(data.applied);
  const err = view.errors.get("apply-all");
  return `<p class="sp-note">${esc(SCOPE_LINE)} <span class="sp-seg"><button type="button" class="sp-seg-btn" data-sp="apply-all"${view.ro ? " disabled" : ""} title="Copies this game's Projections, FLEX and Captain choices to every other loaded game, and its Projections choices to the main slate.">${esc(APPLY_ALL_LABEL)}</button></span>${err ? ` <span class="sp-err" role="alert">${esc(err)}</span>` : ""}</p>${applied ? `<p class="sp-note">${esc(applied)}</p>` : ""}`;
}

/** The public site's line about weights kept in this browser, with the one button that puts every one of them back. */
export function localNoteHtml(changed, view) {
  if (!changed) return "";
  const err = view.errors.get("local");
  return `<p class="sp-note sp-local">Your changes to ${esc(changed)} ${changed === 1 ? "source" : "sources"} are kept in this browser only. <span class="sp-seg"><button type="button" class="sp-seg-btn" data-sp="local-reset"${view.ro ? " disabled" : ""}>Back to the published weights</button></span>${err ? ` <span class="sp-err" role="alert">${esc(err)}</span>` : ""}</p>`;
}

// One slim item: Lines is a two-way pick of the primary source; Injuries and TwoGun extras are On | Off for each of their sources. The row
// stays on one line at 1920 (👁 finding 1): an item with one source shows no source name beside its title (the title says it, the name is
// the toggle's hover); Lines' pick needs no "primary" word, the item's hover (the server's method sentence) says what it picks.
function slimToggleHtml(kind, s, view, named = true) {
  const disabled = view.ro || !s.canTick;
  const title = !s.canTick && s.whyNot ? ` title="${esc(s.whyNot)}"` : named ? "" : ` title="${esc(s.label)}"`;
  const b = (on, label) => `<button type="button" class="sp-seg-btn${s.use === on ? " active" : ""}" data-sp="toggle" data-kind="${esc(kind)}" data-id="${esc(s.id)}" data-use="${on}"${disabled ? " disabled" : ""} aria-pressed="${s.use === on}">${label}</button>`;
  return `<span class="sp-slim-src"${title}>${named ? `<span class="sp-slim-name">${esc(s.label)}</span>` : ""}<span class="sp-seg">${b(true, "On")}${b(false, "Off")}</span></span>`;
}

function slimPickHtml(kind, sources, view) {
  const b = (s) => `<button type="button" class="sp-seg-btn${s.use ? " active" : ""}" data-sp="toggle" data-kind="${esc(kind)}" data-id="${esc(s.id)}" data-use="true"${view.ro || !s.canTick ? " disabled" : ""}${!s.canTick && s.whyNot ? ` title="${esc(s.whyNot)}"` : ""} aria-pressed="${s.use}">${esc(s.label)}</button>`;
  return `<span class="sp-slim-src"><span class="sp-seg">${sources.map(b).join("")}</span></span>`;
}

// The stamp and status of the item's lead source sit right after that source's own control (👁 finding 10: the injury report's stamp
// beside the injury report's toggle, not beside TwoGun's calls). Lines' lead is the primary in use; the others' is their first source.
function slimItemHtml(sec, view) {
  const lead = (sec.kind === "lines" ? sec.sources.find((s) => s.use) : null) ?? sec.sources[0];
  const meta = lead ? `<span class="sp-slim-meta">${pulledHtml(lead.lastPulled)} ${pillHtml(lead.status, lead.note)}</span>` : "";
  const controls = sec.kind === "lines"
    ? `${slimPickHtml(sec.kind, sec.sources, view)}${meta}`
    : sec.sources.map((s) => `${slimToggleHtml(sec.kind, s, view, sec.sources.length > 1)}${s === lead ? meta : ""}`).join("");
  const errs = sec.sources.map((s) => view.errors.get(`${sec.kind}/${s.id}`)).filter(Boolean);
  return `<div class="sp-slim-item" data-kind="${esc(sec.kind)}" title="${esc(sec.method ?? "")}"><span class="sp-slim-title">${esc(sec.title)}</span>${controls}${errs.map((e) => `<span class="sp-err" role="alert">${esc(e)}</span>`).join("")}</div>`;
}

export function shownOnlyHtml(list) {
  if (!list?.length) return "";
  const items = list.map((s) => `<span class="sp-shown-item" title="${esc(s.note ?? "")}"><span class="sp-slim-name">${esc(s.label)}</span>${pulledHtml(s.lastPulled)} ${pillHtml(s.status, s.note)}</span>`).join("");
  return `<div class="sp-shown"><span class="sp-slim-title">Shown, not chosen</span>${items}</div>`;
}

/** The whole controls area for one selection. `view`: { ro, errors: Map, drafts: Map, savedKey, openRecipes?: Set of section kinds whose recipe is open }. */
export function selectionHtml(data, view) {
  const note = data.writable === false && data.note ? `<p class="sp-note">${esc(data.note)}</p>` : "";
  // The server read (or saved) the choices but could not build the board: said once, over a page without pull times or coverage.
  const boardNote = data.boardNote ? `<p class="sp-note sp-warn">${esc(data.boardNote)}</p>` : "";
  // A section with no sources draws nothing at all (👁 finding 2), so it never leaves an empty box or column.
  const full = data.sections.filter((s) => !SLIM_KINDS.has(s.kind) && s.sources?.length);
  const slim = data.sections.filter((s) => SLIM_KINDS.has(s.kind) && s.sources?.length);
  const col = (secs) => `<div class="sp-col">${secs.map((s) => sectionHtml(s, view)).join("")}</div>`;
  // Classic: Projections | Ownership side by side. Showdown (👁 finding 1): Projections across the full width, then Ownership FLEX |
  // Ownership Captain side by side, so the two ownership boxes are not stacked beside a shorter Projections box.
  const showdown = full.some((s) => s.kind === "sdOwnFlex" || s.kind === "sdOwnCpt");
  const [first, ...rest] = full;
  const boxes = !first ? ""
    : showdown && first.kind === "projection"
      ? `<div class="sp-wide">${sectionHtml(first, view)}</div>${rest.length ? `<div class="sp-cols">${rest.map((s) => col([s])).join("")}</div>` : ""}`
      : `<div class="sp-cols">${col([first])}${rest.length ? col(rest) : ""}</div>`;
  return `${headerHtml(data, view)}${scopeLineHtml(data, view)}${note}${boardNote}${localNoteHtml(data.siteLocal?.changed, view)}
    ${boxes}
    ${slim.length ? `<div class="sp-slim">${slim.map((s) => slimItemHtml(s, view)).join("")}</div>` : ""}
    ${shownOnlyHtml(data.shownOnly)}`;
}

/** The "Players" heading and its Projections | Ownership switch; `activeKey` is the tab key showing ("projections" or "ownership"). */
export function playersHeadHtml(activeKey) {
  const btns = SOURCE_TABS.map((t) => `<button type="button" class="sp-seg-btn${t.key === activeKey ? " active" : ""}" data-players="${t.key}" data-tab="${t.key}" aria-pressed="${t.key === activeKey}">${esc(t.label)}</button>`).join("");
  return `<h2 class="sp-h">Players</h2><span class="sp-seg" role="group" aria-label="Players table">${btns}</span>`;
}
