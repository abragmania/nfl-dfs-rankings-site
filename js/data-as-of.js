// "Data as of" (Adam 2:48 PM 11-11, PROJECT.md Part 4 item 5, item 7): where the board's provenance lives, at the top of the Sources page, classic and Showdown, app and
// site: the four stamps (Board, Injuries, Pulled, Lock) as a short table, then the Own coverage and the injury report's counts as terse lines (nothing dropped, G62). The
// main views carry at most one short line, and only when a feed is stale or missing ("Injuries: saved copy"). Pure: html and text builders only.
import { escapeHtml } from "./format.js";
import { boardStamps } from "./stamps.js";

/** Classic Own coverage in one line (D29: published DraftKings numbers or blank, never an estimate). `rows`: the slate on screen's rows. */
export function ownCoverageLine(rows) {
  const list = rows ?? [];
  const published = list.filter((r) => r.ownKind === "quoted").length;
  return published === 0 ? "Own: no published DraftKings numbers yet; blank until there are." : `Own: published DraftKings numbers for ${published} of ${list.length} players; the rest blank.`;
}

/** G65: the board's self-check failures (one plain line each), then its counts of what it set aside, for the Notes card at the foot of the Sources page (never the main view); [] when the board passes or carries none. */
export function selfCheckLines(board) {
  const failures = Array.isArray(board?.selfCheck?.failures) ? board.selfCheck.failures.map((f) => f?.line) : [];
  const notes = Array.isArray(board?.selfCheck?.notes) ? board.selfCheck.notes : [];
  return [...failures, ...notes].map((l) => String(l ?? "")).filter(Boolean);
}

// The injury note's stale sentences in a few words (lead 3:10 PM 11-11): the board's own wording is matched, and anything else is kept as written.
const SHORTER = [
  [/^ESPN injury report is a saved copy because the live fetch failed\b.*$/, "Injuries: saved copy (live fetch failed)."],
  [/^ESPN injury report unavailable: injury statuses are from a saved Sleeper copy\b.*$/, "Injuries: saved Sleeper copy (ESPN unavailable)."],
  [/^ESPN injury report unavailable: injury statuses are from Sleeper\b.*$/, "Injuries: from Sleeper (ESPN unavailable)."],
];

/** A note of several sentences as one line each (the board's injury note), so nothing reads as a paragraph; a stale sentence in a few words.
 *  A sentence ends at ". " before a capital, never after a word of one or two letters (an initial or abbreviation: "A. J. Brown", "Amon-Ra St. Brown", "Jr."). */
export function noteLines(text) {
  return String(text ?? "").split(/(?<!\b[A-Za-z]{1,2}\.)(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean)
    .map((s) => SHORTER.reduce((t, [re, short]) => (re.test(t) ? short : t), s));
}

/** "Nov 11 14:46 ET" as the app writes times elsewhere: "Nov 11, 2:46 PM ET". Any other text is kept. */
export function clock12(text) {
  return String(text ?? "").replace(/^([A-Z][a-z]{2} \d{1,2}) (\d{1,2}):(\d{2}) ET/, (m, day, h, mm) => `${day}, ${Number(h) % 12 || 12}:${mm} ${Number(h) < 12 ? "AM" : "PM"} ET`);
}

/** The Showdown header's old chips in one line: which sources serve a saved copy ("Saved copies: 8 (Sleeper, CBS, …)"); "" when none. */
export function savedCopiesLine(board) {
  const ids = Array.isArray(board?.stale) ? board.stale : [];
  if (!ids.length) return "";
  const label = (id) => (board.sources ?? []).find((s) => s?.id === id)?.label ?? id;
  return `Saved copies: ${ids.length} (${[...new Set(ids.map(label))].join(", ")}).`;
}

/** The block: the stamps as label | time rows (a stamp's hover keeps its long reading), then `lines` one per row. `games`: the slate on screen's games (classic). */
export function dataAsOfHtml(board, { games = null, lines = [] } = {}) {
  if (!board) return "";
  const stamps = boardStamps(board, { games });
  const rows = stamps.map((s) => `<tr${s.missing ? ` class="stamp-missing"` : ""} title="${escapeHtml(s.title)}"><th>${escapeHtml(s.label)}</th><td>${escapeHtml(clock12(s.text))}</td></tr>`).join("");
  const notes = lines.flatMap(noteLines).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  // Mock B (Adam 12:44 PM 11-12): two cards in the page's bottom row, the stamps and the notes (counts, coverage, injury lines).
  return `<section class="sp-asof" aria-label="Data as of"><div class="sp-ch"><h3 class="sp-asof-title">Data as of</h3></div><table class="sp-asof-stamps"><tbody>${rows}</tbody></table></section>${notes ? `<section class="sp-notes" aria-label="Notes"><div class="sp-ch"><h3 class="sp-asof-title">Notes</h3></div><ul class="sp-asof-notes">${notes}</ul></section>` : ""}`;
}

/** The main view's one short line: the injury report or the figures' pull when it is a saved copy or missing ("Injuries: saved copy"), else "". */
export function staleLineText(board, { games = null } = {}) {
  if (!board) return "";
  return boardStamps(board, { games })
    .filter((s) => (s.label === "Injuries" || s.label === "Pulled") && (s.missing || /saved copy/.test(s.text)))
    .map((s) => `${s.label}: ${s.missing ? "missing" : "saved copy"}`)
    .join(" · ");
}
