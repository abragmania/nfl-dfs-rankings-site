// The body of GET /api/source-selection (Sources page plan, 2026-10-18): the saved choices laid out section by section,
// with, for every source, when it was last pulled and what it says about itself, how many players it covers and whether
// it can be ticked. Pure: the route hands in the choices, the served board's source cards and TwoGun's load result.
//   { preset, appliesTo, writable, note, scope, scopeKind, defaulted, sections:[{ kind, title, method, methodFull?, recipe?, gaps, sources: [row] }], shownOnly: [...] }
//   (the main slate's body also carries boardNote, selection-routes.js: null, or why the board could not be built)
//   row = { id, label, labelFull? (the hover when the shown label is shortened), use, weight, canTick, whyNot, lastPulled, posted: {text, where} | null, coverage: {matched, total} | null,
//           status: "ok" | "cached" | "failed" | "not fetched" | "empty" (pulled, but no player on this slate; settleRow)
//                   | "unlisted" (a Showdown id ticked here that this game's ownership file does not list; unlistedRows)
//                   | "unknown" (the board could not be built, so nobody checked; unknownWhenFailed), note }
// lastPulled is the app's own fetch (or file) time; posted is the source's own stamp copied as it reads (TwoGun's Central-time stamps
// are served as Eastern, server/lib/et.js centralStampToEasternText; no other stamp is converted),
// and null where the source states none (the page prints "not stated"). A file time is "pulled", never "posted".
import { decide, presetOf, scopeKindOf, PRESETS, ANY, TWOGUN_ID, APPLIES_TO_CLASSIC, APPLIES_TO_SHOWDOWN } from "./selection-core.js";
import { twogunStatus, twogunNote } from "../twogun/overlay.js";
import { centralStampToEasternText } from "../lib/et.js";

const STATUS = Object.freeze({ ok: "ok", live: "ok", file: "ok", stale: "cached", failed: "failed" });
const METHOD = Object.freeze({
  projection: "Weighted average of the ticked sources; a player one source misses is averaged over the others. Kickers are scored from each source's stat lines (an outlier is left out first), then averaged by the same weights.",
  ownership: "Weighted average of the ticked sources' published numbers; a player none of them lists stays blank, never estimated.",
  sdOwnCpt: "Weighted average of every ticked source that lists a Captain number, Stokastic included. A source that lists too few of the main players is not used. Captain and FLEX are never combined.",
  lines: "One source is the main one for each game's line, total and spread; the other fills a game the main one has none for.",
  injuries: "ESPN's injury report decides who is out (Sleeper fills in when ESPN's is down). Tick TwoGun's calls to let his OUT and other calls replace a player's status.",
  extras: "Whether TwoGun's extra figures (median, nuke, 3x and 4x odds) are used."
});
// Every box keeps its method note to one line beside the gaps toggle (👁 round 2, V1; round 4, V2; round 5, V6: Showdown's full-width
// Projections box too, sdProjection); the whole sentence (METHOD, flexMethod) is the note's hover, sent as methodFull.
const METHOD_SHORT = Object.freeze({
  projection: "Weighted average of the ticked sources.",
  sdProjection: "Weighted average of the ticked sources; kickers from stat lines.",
  ownership: "Weighted average of the ticked sources' numbers.",
  sdOwnCpt: "Weighted average of every ticked source's Captain number."
});
// The classic Ownership box shows these sources' short names so its Posted column has the room for a full stamp (👁 round 5, V5); the
// source's own label is the name's hover (labelFull). The public site's page reads the browser's copy (public/js/source-labels.js);
// tests/site-source-labels.test.mjs compares the two.
export const SHORT_LABEL = Object.freeze({ footballguys: "Footballguys", rotowire: "RotoWire", twogun: "TwoGun" });
// `within` is the Showdown board's agreement limit in points; null when no board was built (the limit lives with the Showdown ownership
// module, which classic code never imports), and the sentences then say "close together" and "further apart" without a number.
const apart = (within) => (within == null ? ["close together", "further apart"] : [`less than ${within} points apart`, `${within} or more apart`]);
const flexMethod = (method, within) => (method === "weighted"
  ? "Weighted average of the ticked sources' FLEX numbers. A source that lists too few of the main players is not used. Captain and FLEX are never combined."
  : `If Stokastic and the other ticked sources are ${apart(within)[0]} their FLEX numbers are averaged; ${apart(within)[1]}, Stokastic stands. Without Stokastic, a weighted average. A source that lists too few of the main players is not used. Captain and FLEX are never combined.`);
const flexShort = (method, within) => (method === "weighted" ? "Weighted average of the ticked sources' FLEX numbers." : `Averaged if ${apart(within)[0]}, else Stokastic stands.`);

const isoOf = (ms) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null);
/** Adam reads this text: rule numbers belong in code comments, so a note that quotes one loses it (the sense stays). */
export function plain(s) {
  return String(s)
    .replace(/\s*\([DR]\d+[^)]*\)/g, "") // "(R85)", "(D60, Adam ...)"
    .replace(/\bR85\b(\s*\([^)]*\))?/g, "the full-list rule")
    .replace(/\s+(?:of|in|under|per|by)\s+D\d+\b/g, "")
    .replace(/\b[DR]\d+\b/g, "")
    .replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
}
const text = (v) => (typeof v === "string" && v.trim() ? plain(v) : null);
// A stamp is always {text, where}; `where` is null when the source's own place for it is not known. The source's own words, only
// trimmed: plain() is for this app's notes, and would strip a stamp's own "D2" or "(R1 ...)".
const posted = (value, where) => (typeof value === "string" && value.trim() ? { text: value.trim(), where: where ?? null } : null);
const statusOf = (card) => (card ? STATUS[card.status] ?? "not fetched" : "not fetched");
const defaultWeight = (kind, id) => PRESETS.ours[kind].sources[id]?.weight ?? PRESETS.ours[kind].sources["*"]?.weight ?? 1;

function pick(kinds, kind, id, label) {
  const e = decide(kinds, kind, id);
  const w = e?.weight;
  return { id, label, use: e?.use === true, weight: Number.isFinite(w) && w >= 0 ? w : defaultWeight(kind, id) };
}

const DISABLED = "Not fetched: this source is switched off in the source settings.";

/**
 * A projection or ownership row's status and coverage, made to agree (👁 finding 4, 2026-10-19), from the one set of facts the row
 * carries: a source with a pull time is never "not fetched" (it was pulled and gave no players: "empty"); a source that is ok or a
 * cached copy but covers no player on this slate is "empty" when it has a pull time and "not fetched" when it has none (nothing was
 * ever read for it); a source with no figures at all ("not fetched" or "failed") covers nobody, so its coverage is null ("none"),
 * never "0 of N". The page gives a share only to a source that covers at least one player.
 */
export function settleRow(row) {
  let status = row.status;
  const coversNobody = row.coverage != null && row.coverage.matched === 0;
  if (status === "not fetched" && row.lastPulled) status = "empty";
  if ((status === "ok" || status === "cached" || status === "empty") && (coversNobody || status === "empty")) status = row.lastPulled ? "empty" : "not fetched";
  const coverage = status === "not fetched" || status === "failed" ? null : row.coverage;
  return { ...row, status, coverage };
}

/** One classic registry source's row from its served board card (null card: not on the board yet). */
function cardRow(base, card, total, extra = {}) {
  const off = card?.enabled === false || card?.status === "disabled";
  // A source that ran and loaded nothing is not "ok": nothing was loaded for it (no file this week, or the page listed no one).
  const empty = !off && statusOf(card) === "ok" && card?.recordCount === 0;
  // Said only where the box can be ticked: a switched-off source's hover says why it cannot be (whyNot), never what ticking would do.
  const zero = !off && !base.use && base.weight === 0 ? "Its saved weight is 0, so its numbers are shown in its own column but never counted; ticking it gives it weight 1." : null;
  const note = [text(card?.note) ?? (empty ? "Nothing was loaded for this week (no file or no figures)." : null), zero].filter(Boolean).join(" ") || null;
  return settleRow({ ...base, canTick: !off, whyNot: off ? DISABLED : null, lastPulled: off ? null : text(card?.fetchedAt), posted: posted(card?.pageUpdated, extra.where),
    coverage: card && Number.isFinite(card.matched) && total > 0 ? { matched: card.matched, total } : null,
    status: off ? "not fetched" : empty ? "empty" : statusOf(card), note });
}

/** TwoGun's row from his served card, or from the loader's result when the board shows no card for him. */
function twogunRow(base, card, load, total, stampKey, where) {
  if (card) return { ...base, canTick: true, whyNot: null, lastPulled: text(card.fetchedAt), posted: posted(card.pageUpdated, where),
    // His ownership card counts the players his board lists a number for (recordCount); "matched" there is how many rows use it.
    coverage: Number.isFinite(card.kind === "ownership" ? card.recordCount : card.matched) && total > 0 ? { matched: card.kind === "ownership" ? card.recordCount : card.matched, total } : null,
    status: statusOf(card), note: text(card.note) };
  const status = load ? twogunStatus({ ...load, snapshot: load.status === "ok" || load.status === "stale" ? {} : null }) : "missing";
  return { ...base, canTick: true, whyNot: null, lastPulled: isoOf(load?.mtimeMs), posted: posted(load?.[stampKey], where), coverage: null,
    status: STATUS[status] ?? "not fetched", note: load ? text(twogunNote(load, status)) : null };
}

const MAIN_IDS = Object.freeze({ projection: Object.freeze(["sleeper", "fantasypros", "cbs", "espn"]), ownership: Object.freeze(["footballguys", "rotowire", "findings", "stokastic", "oneweekseason"]) });
const WHERE = Object.freeze({ sleeper: "Sleeper's projection batch stamp (last_modified)", footballguys: "Footballguys page text (Last updated)", oneweekseason: "One Week Season page text (Ownership updated)" });

function classicSection(kind, title, c) {
  const sec = c.kinds[kind];
  const cards = c.cards.filter((x) => x.kind === kind);
  const labelOf = (id) => cards.find((x) => x.id === id)?.label ?? c.registryLabels[id] ?? id;
  const named = (id, full = labelOf(id)) => (SHORT_LABEL[id] && SHORT_LABEL[id] !== full ? { label: SHORT_LABEL[id], labelFull: full } : {});
  const rows = MAIN_IDS[kind].map((id) => cardRow({ ...pick(c.kinds, kind, id, labelOf(id)), ...named(id) }, cards.find((x) => x.id === id) ?? c.registry.find((x) => x.id === id), c.total, { where: WHERE[id] }));
  const stamp = kind === "projection" ? "boardUpdated" : "ownershipUpdated";
  const where = kind === "projection" ? "TwoGun's board stamp" : "TwoGun's ownership stamp";
  const his = kind === "ownership" ? "TwoGun (Milly Maker field)" : "TwoGun";
  rows.push(settleRow(twogunRow({ ...pick(c.kinds, kind, TWOGUN_ID, his), ...named(TWOGUN_ID, his) }, cards.find((x) => x.id === TWOGUN_ID), c.twogunLoad, c.total, stamp, where)));
  // recipe: the served board's own sentence on how this section's numbers were made (board.recipes), the one the public site's page
  // shows (D71, D40); null with no board.
  return { kind, title, method: METHOD_SHORT[kind] ?? METHOD[kind], methodFull: METHOD_SHORT[kind] ? METHOD[kind] : null, recipe: text(c.recipes?.[kind]), gaps: sec.gaps, sources: rows };
}

const switchRow = (id, label, use, extra) => ({ id, label, use, weight: 1, canTick: true, whyNot: null, lastPulled: null, posted: null, coverage: null, status: "ok", note: null, ...extra });

function contextSections(c) {
  const espn = c.cards.find((x) => x.id === "espn-scoreboard");
  const inj = c.cards.find((x) => x.id === "espn-injuries");
  const his = twogunRow({ id: TWOGUN_ID, label: "TwoGun", use: false, weight: 1 }, null, c.twogunLoad, c.total, "boardUpdated", "TwoGun's board stamp");
  const hisRow = (use, label) => ({ ...his, label, use });
  return [
    { kind: "lines", title: "Lines", method: METHOD.lines, gaps: null, sources: [
      switchRow("espn-scoreboard", "ESPN scoreboard", c.kinds.lines.primary === "espn-scoreboard", { lastPulled: text(espn?.fetchedAt), status: statusOf(espn), note: text(espn?.note) }),
      hisRow(c.kinds.lines.primary === TWOGUN_ID, "TwoGun's game lines")] },
    { kind: "injuries", title: "Injuries", method: METHOD.injuries, gaps: null, sources: [
      switchRow("espn-injuries", "ESPN injury report", true, { canTick: false, whyNot: "Always used; Sleeper's report fills in when ESPN's is down.", lastPulled: text(inj?.fetchedAt), status: statusOf(inj), note: text(inj?.note) }),
      hisRow(c.kinds.injuries.twogunCalls, "TwoGun's calls")] },
    { kind: "extras", title: "TwoGun extras", method: METHOD.extras, gaps: null, sources: [hisRow(c.kinds.extras.twogun, "TwoGun's extra figures")] }
  ];
}

function shownOnly(c) {
  const card = (id) => c.cards.find((x) => x.id === id);
  const row = (id, label, k, note) => ({ id, label, lastPulled: text(k?.fetchedAt), posted: null, status: statusOf(k), note: text(k?.note) ?? note ?? null });
  return [
    { id: "salary", label: "DraftKings salary file", lastPulled: text(c.uploadedAt), posted: null, status: c.uploadedAt ? "ok" : "not fetched", note: "The truth for players, prices, games and kickoff times; shown here, not chosen." },
    row("nws", "Weather (National Weather Service)", card("nws")),
    row("espn-scoreboard", "Schedule (ESPN scoreboard)", card("espn-scoreboard"))
  ];
}

/**
 * With c.boardFailed (the board could not be built, so no source was looked at) every row's status is "unknown", never a "not fetched"
 * nobody checked; a source switched off in the settings keeps its "not fetched" (that is known), and the salary file's row keeps its own
 * status when its upload time is known (the route reads it before building the board), since that needs no board.
 */
function unknownWhenFailed(c, body) {
  if (!c.boardFailed) return body;
  const known = (row) => row.whyNot === DISABLED || (row.id === "salary" && Boolean(c.uploadedAt));
  const settle = (row) => (known(row) ? row : { ...row, status: "unknown" });
  return { ...body, sections: body.sections.map((s) => ({ ...s, sources: s.sources.map(settle) })), shownOnly: body.shownOnly.map(settle) };
}

/** The GET body for the main slate. c: { kinds, cards (the served board's sources), registry (listSources), registryLabels, total, twogunLoad, uploadedAt, recipes (board.recipes, or null), boardFailed? }. */
export function mainSelectionBody(c, head) {
  return unknownWhenFailed(c, { ...head, sections: [classicSection("projection", "Projections", c), classicSection("ownership", "Ownership", c), ...contextSections(c)], shownOnly: shownOnly(c) });
}

// ---- Showdown ------------------------------------------------------------------------------------------------------------

export const UNLISTED_NOTE = "Not on this game's list: its ownership file has no figures from this source, so it gives nothing here. Untick it to clear it.";

/** A ticked id this game's ownership file does not list (copied in by "apply to every game", Adam 2026-10-20): a row with status
 *  "unlisted" so it can be unticked. None when the board failed (no list was read, so nothing is known to be missing). */
function unlistedRows(c, kind) {
  if (c.boardFailed) return [];
  const listed = new Set(c.sources.map((s) => s.id));
  return Object.entries(c.kinds[kind]?.sources ?? {})
    .filter(([id, e]) => id !== ANY && id !== TWOGUN_ID && e?.use === true && !listed.has(id))
    .map(([id]) => ({ ...pick(c.kinds, kind, id, id), canTick: true, whyNot: null, lastPulled: null, posted: null, coverage: null, status: "unlisted", note: UNLISTED_NOTE }));
}

function sdFileRow(c, kind, src) {
  const cov = c.coverage?.bySource?.[src.id];
  const n = (src.rows ?? []).length;
  const setAside = cov && !cov.used;
  const none = n ? null : "This page was read but lists no player figures for this game.";
  const note = [text(src.note), none, setAside ? `Not used: lists ${cov.covered} of ${c.coverage.main} main players.` : null].filter(Boolean).join(" ") || null;
  const main = c.coverage?.main ?? 0;
  // The file carries no machine stamp per source, so "pulled" is when the file holding it was saved; a posted time is the entry's own and none states one.
  return settleRow({ ...pick(c.kinds, kind, src.id, text(src.label) ?? src.id), canTick: true, whyNot: null, lastPulled: c.ownershipSavedAt ?? null, posted: null,
    coverage: cov && main > 0 ? { matched: cov.covered, total: main } : main > 0 ? { matched: 0, total: main } : null, status: n ? "ok" : "not fetched", note });
}

function sdTwoGunRow(c, kind) {
  const f = kind === "projection" ? c.tp : c.tg;
  const stamp = kind === "projection" ? "TwoGun's projections file (meta)" : "TwoGun's ownership file header";
  const ok = Boolean(f?.posted);
  const matched = f?.byId?.size ?? 0;
  // The projections file's asOf is its meta file's own stamp or, with no meta file, the CSV's file time; only the former is "posted".
  const stated = ok && (kind !== "projection" || f.asOfFrom === "meta");
  // The ownership row shows "TwoGun" (the long name wrapped to two lines in a half-width box); labelFull is its hover.
  const base = pick(c.kinds, kind, TWOGUN_ID, "TwoGun");
  // No file and a note (c.twogunNote): his files were not read (the board failed) or could not be read, so "hasn't posted" would be untrue.
  const unread = !f && text(c.twogunNote);
  return settleRow({ ...base, ...(kind === "projection" ? {} : { labelFull: "TwoGun (Showdown ownership column)" }), canTick: true, whyNot: null, lastPulled: isoOf(f?.mtimeMs),
    posted: stated ? posted(centralStampToEasternText(f.asOf, c.season), stamp) : null, coverage: ok && c.total > 0 ? { matched, total: c.total } : null,
    status: ok ? "ok" : f?.status === "invalid" || unread ? "failed" : "not fetched",
    note: unread || (text(f?.error) ?? text(f?.incompleteReason) ?? (ok ? (kind === "projection" ? twogunUnmatchedNote(f.unmatched) : null) : `TwoGun hasn't posted Showdown ${kind === "projection" ? "projections" : "ownership"} for this game yet.`)) });
}

/** The sentence for the men in TwoGun's projections file that were left off or not placed (a blank-ID row with no single match, an ID not on this board), or null when none. */
export function twogunUnmatchedNote(unmatched) {
  const list = (unmatched ?? []).filter((u) => typeof u === "string" && u);
  return list.length ? `Not used from TwoGun's projections file: ${list.join("; ")}.` : null;
}

function sdProjection(c) {
  const cards = c.cards.filter((x) => x.kind === "projection");
  const rows = MAIN_IDS.projection.map((id) => cardRow(pick(c.kinds, "projection", id, cards.find((x) => x.id === id)?.label ?? id), cards.find((x) => x.id === id), c.total, { where: WHERE[id] }));
  return { kind: "projection", title: "Projections", method: METHOD_SHORT.sdProjection, methodFull: METHOD.projection, gaps: c.kinds.projection.gaps,
    sources: [...rows, sdTwoGunRow(c, "projection")] };
}

/** The GET body for one Showdown. c: { kinds, cards (the served board's sources), sources (its ownership files' sources), coverage, total, tp, tg,
 *  twogunNote (why his files were not read, or null), ownershipSavedAt, uploadedAt, agreeWithin, season (for his year-less stamps), boardFailed? }. */
export function showdownSelectionBody(c, head) {
  const own = (kind, title, method, methodFull) => ({ kind, title, method, methodFull, gaps: c.kinds[kind].gaps,
    sources: [...c.sources.map((s) => sdFileRow(c, kind, s)), ...unlistedRows(c, kind), sdTwoGunRow(c, kind)] });
  const { method } = c.kinds.sdOwnFlex;
  return unknownWhenFailed(c, { ...head, sections: [sdProjection(c), own("sdOwnFlex", "Ownership, FLEX", flexShort(method, c.agreeWithin), flexMethod(method, c.agreeWithin)),
    own("sdOwnCpt", "Ownership, Captain", METHOD_SHORT.sdOwnCpt, METHOD.sdOwnCpt)], shownOnly: shownOnly(c) });
}

/** The part of the body every slate shares. `scope` is the scope these choices are ("classic" or the game's key) and `scopeKind`
 *  its kind ("classic" | "showdown"), so the page says whose choices it edits; `defaulted` is { preset, why } while a Showdown game has
 *  none saved and reads its default (showdown-default.js), else false. */
export function selectionHead(choices) {
  const scopeKind = scopeKindOf(choices.scope);
  const preset = presetOf(choices.selection, scopeKind);
  return { preset: preset ?? "custom", appliesTo: scopeKind === "showdown" ? APPLIES_TO_SHOWDOWN : APPLIES_TO_CLASSIC, writable: choices.writable, note: choices.note,
    scope: choices.scope ?? "classic", scopeKind, defaulted: choices.defaulted ? { preset: choices.defaulted.preset, why: choices.defaulted.why } : false };
}
