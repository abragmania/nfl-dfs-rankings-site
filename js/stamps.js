// The four as-of stamps on the optimizer screen (optimizer standard B11, C26; NBA's `Board`, `Injuries`, `Pulled`, `Lock`), the same on classic and Showdown:
//   Board     when the served board was built (board.generatedAt).
//   Injuries  when the injury report the board uses was pulled (the fetchedAt of its source's card: ESPN's, or Sleeper's when ESPN's failed; board.injuryReport names which).
//   Pulled    the latest pull among the sources the figures read: in use (ticked, with weight, TwoGun through his posted stamp), not failed, holding records. A saved copy in use is said in the text.
//   Lock      the first kickoff of the slate or game on screen, as the salary file wrote it (D30: the stored kickoff, no time logic of our own).
// A stamp with no time reads `missing`, never a guess: every time here is one the board carries, read, or the earliest/latest of those it carries. Pure and browser-safe: text and
// html builders only, no DOM, no storage, no network.
import { escapeHtml, localStamp, MONTHS } from "./format.js";
import { whenShort, shortSortKey } from "./player-card-body.js"; // the one reading of a source's time (an ISO stamp or TwoGun's Eastern text) and its ordering
import { sourceIsTicked } from "./sources-page-html.js"; // the one tick predicate

export const MISSING = "missing";
const PULLED_KINDS = new Set(["projection", "kicker", "ownership"]);

/** "Nov 3 14:05 ET" for an ISO stamp (Eastern, format.js localStamp); null when absent or unreadable. */
export function stampWhen(iso) {
  const s = localStamp(iso);
  return s ? `${s.monthDay} ${s.clock} ET` : null;
}

/** A kickoff as the salary file wrote it, "2026-11-08T13:00:00-05:00" to "Nov 8 13:00 ET": the digits are sliced, never turned into a Date (D30). Null for anything else. */
export function kickoffStampText(kickoffEt) {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(typeof kickoffEt === "string" ? kickoffEt : "");
  const month = m ? MONTHS[Number(m[1]) - 1] : undefined;
  return m && month ? `${month} ${Number(m[2])} ${m[3]}:${m[4]} ET` : null;
}

const cards = (board) => (Array.isArray(board?.sources) ? board.sources.filter((s) => s && typeof s === "object") : []);

const FAILED = new Set(["failed", "error", "disabled", "not run"]); // a card in one of these states pulled nothing: its fetchedAt (a failed source still stamps "now") is no pull
const SAVED = new Set(["stale", "cached"]); // a saved copy: its time is the copy's, and the line says so

/** How many records a card holds (recordCount on the classic board, records on the Showdown's), or null when the card does not say. */
const recordsOf = (s) => {
  const n = s.recordCount ?? s.records;
  return n === null || n === undefined || !Number.isFinite(Number(n)) ? null : Number(n);
};

/** The injury report's pull time: the card of the source the board says it uses. {time, saved, title}; time null when the board has no report, its card failed or carries no time. */
function injuriesStamp(board) {
  const rep = board?.injuryReport;
  if (!rep || rep.state === "missing" || !rep.source) return { time: null, title: "The board has no injury report (ESPN's and the Sleeper backup both failed)." };
  const sleeper = rep.source === "Sleeper";
  const card = cards(board).find((s) => (sleeper ? s.id === "sleeper" && s.kind === "projection" : s.id === "espn-injuries"));
  if (card && FAILED.has(String(card.status ?? "").toLowerCase())) return { time: null, title: `${rep.source}'s pull failed, so it has no pull time.` };
  const time = stampWhen(card?.fetchedAt);
  const saved = rep.state === "stale" || SAVED.has(String(card?.status ?? "").toLowerCase());
  return { time, saved: Boolean(time) && saved, title: time ? `${rep.source}, pulled ${time}.${saved ? " This is a saved copy because the live fetch failed." : ""}` : `${rep.source}'s card carries no pull time.` };
}

/** The ids of the sources the board reads for its figures (Showdown: the ticked lists), or null when the board does not say (classic: each card's own tick is read). */
function tickedIds(board) {
  const t = board?.mode?.ticked;
  if (!t || typeof t !== "object") return null;
  return new Set(["projection", "ownership", "sdOwnFlex", "sdOwnCpt"].flatMap((k) => (Array.isArray(t[k]?.sources) ? t[k].sources : []).map((s) => s.id)));
}

/** Every pull behind the figures on screen: [{name, short, saved}], `short` in whenShort's form. Only a source in use counts (ticked, with weight), one that did not fail and holds
 *  records, with a time that reads as Eastern; TwoGun counts through the stamp his posted file carries. */
function figurePulls(board) {
  const ids = tickedIds(board);
  const kept = Array.isArray(board?.ownershipUsedIds) ? new Set(board.ownershipUsedIds) : null;
  const pulls = [];
  for (const s of cards(board)) {
    if (!PULLED_KINDS.has(s.kind)) continue;
    const id = s.kind === "kicker" ? s.sourceId ?? s.id : s.id;
    if (ids ? !ids.has(id) : !sourceIsTicked(s)) continue;
    const status = String(s.status ?? "").toLowerCase();
    if (FAILED.has(status) || recordsOf(s) === 0) continue;
    const short = whenShort(s.fetchedAt);
    if (short) pulls.push({ name: s.label ?? s.id, short, saved: SAVED.has(status) });
  }
  for (const s of Array.isArray(board?.ownershipSources) ? board.ownershipSources : []) {
    if ((ids && !ids.has(s.id)) || (kept && !kept.has(s.id)) || !(s.rows ?? []).length) continue;
    const short = whenShort(s.fetchedAt);
    if (short) pulls.push({ name: s.label ?? s.id, short, saved: false });
  }
  const hisHalves = [];
  if (ids?.has("twogun")) for (const half of ["projection", "ownership"]) { const st = board?.figures?.stamps?.[half]?.twogun; if (st && st.asOfFrom !== "board built") hisHalves.push(st.asOf); }
  else if (!ids && board?.mode?.active === "twogun") hisHalves.push(board.mode?.twogun?.boardUpdated, board.mode?.twogun?.ownershipUpdated);
  for (const raw of hisHalves) {
    const short = whenShort(raw);
    if (short) pulls.push({ name: "TwoGun", short, saved: (board?.stale ?? []).includes("twogun") }); // his files are old, as board.stale says, so a saved copy is in use
  }
  return pulls;
}

/** The latest pull among the sources the figures read, and the oldest beside it for the hover; a saved copy in use is said in the text. */
function pulledStamp(board) {
  const pulls = figurePulls(board).sort((a, b) => shortSortKey(a.short) - shortSortKey(b.short));
  if (!pulls.length) return { time: null, title: "No source in use carries a real pull time (a failed pull is not one)." };
  const newest = pulls.at(-1);
  const oldest = pulls[0];
  const savedNames = [...new Set(pulls.filter((p) => p.saved).map((p) => p.name))];
  return {
    time: newest.short,
    saved: savedNames.length > 0,
    title: `Latest pull: ${newest.name}. Oldest: ${oldest.name}, ${oldest.short}.${savedNames.length ? ` A saved copy is in use: ${savedNames.join(", ")}.` : ""}`,
  };
}

/** The first kickoff of the slate on screen as written. Showdown: board.game.kickoffEt. Classic: the earliest stored kickoffUtc among `games` (the games of the slate on
 *  screen, state.js activeSlateGames; board.games when none are passed), shown by that game's kickoffEt. Null when none is readable. */
function lockStamp(board, games = null) {
  if (!games && board?.game && typeof board.game === "object") {
    const time = kickoffStampText(board.game.kickoffEt);
    return { time, title: time ? "The game's kickoff, from the DraftKings salary file." : "The salary file carries no kickoff for this game." };
  }
  let first = null;
  for (const g of Array.isArray(games) ? games : Array.isArray(board?.games) ? board.games : []) {
    const t = Date.parse(g?.kickoffUtc);
    if (Number.isFinite(t) && kickoffStampText(g?.kickoffEt) && (first === null || t < first.t)) first = { t, et: g.kickoffEt, id: g.id ?? g.gameId };
  }
  const time = first ? kickoffStampText(first.et) : null;
  return { time, title: time ? `The first kickoff on this slate (${first.id}), from the DraftKings salary file.` : "The salary file carries no kickoff times for this slate." };
}

/** The four stamps for `board`, in order: [{label, text, missing, title}]. `opts.games`: the games of the slate on screen (classic: the main slate's or a second slate's). */
export function boardStamps(board, opts = {}) {
  const built = stampWhen(board?.generatedAt);
  const boardStamp = { time: built, title: built ? "When this board was built." : "The board carries no build time." };
  const parts = [["Board", boardStamp], ["Injuries", injuriesStamp(board)], ["Pulled", pulledStamp(board)], ["Lock", lockStamp(board, opts.games ?? null)]];
  return parts.map(([label, p]) => ({ label, text: p.time === null ? MISSING : `${p.time}${p.saved ? " (saved copy)" : ""}`, missing: p.time === null, title: p.title }));
}

/** The stamps as one line of small type; `sourcesLink` adds the Sources link (C26: the figures label's opener, class sd-figures-link, wired by showdown/lineup-meter.js wireMeter and view.js). */
export function stampsLineHtml(stamps, { sourcesLink = false, cls = "" } = {}) {
  const items = stamps.map((s) => `<span class="stamp${s.missing ? " stamp-missing" : ""}" title="${escapeHtml(s.title)}"><i>${escapeHtml(s.label)}</i> ${escapeHtml(s.text)}</span>`).join("");
  const link = sourcesLink ? `<button type="button" class="link-btn sd-figures-link" title="Open the Sources page: which sources feed these figures, their weights, and when each was pulled">Sources</button>` : "";
  return `<div class="stamps-line${cls ? ` ${escapeHtml(cls)}` : ""}" role="group" aria-label="As-of times">${items}${link}</div>`;
}
