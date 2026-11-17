// Source-card notes and board notes reach the page and the public site, so they must never carry a local folder
// path (the publish privacy guard, tools/publish-guards.mjs, refuses a baked file that does). Write a plain
// sentence in the module; when a note has to carry a caught error's text, pass it through noLocalPaths() and
// send the full error to the log (server/lib/log.js).

// The start of a local path: a Windows drive letter and colon then a slash, a UNC share (two backslashes and a host), or a folder named
// users between two slashes (either kind). Caution: this also matches a URL with such a users folder in it (a page address for user 1
// would be rewritten to "1"); source notes carry no such URL today, and over-redacting is the safe direction.
const ROOT = String.raw`(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\|[\\/]users[\\/])`;
// A run of characters that cannot end a path word.
const T = String.raw`[^\s'"` + "`" + String.raw`<>|)\]]`;
// A path in quotes (Node quotes the paths in fs errors, and a folder name may hold spaces): up to the closing quote.
const QUOTED = new RegExp("(['\"`])" + ROOT + String.raw`(?:(?!\1).)*\1`, "gi");
// An unquoted path: its first word, then any following words that are part of it (they hold a separator, or are a
// lone dash as in "OneDrive - Personal"), so a folder name with spaces is taken whole.
const UNQUOTED = new RegExp(ROOT + T + String.raw`*(?:\s+(?:-+|` + T + String.raw`*[\\/]` + T + String.raw`*))*`, "gi");
// What the guard itself looks for, plus any backslash left over: anything left means the text is not safe to show.
const STILL_A_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]|[\\/]users[\\/]|\\/i;

const baseName = (p) => {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "a file";
};

/**
 * Returns `text` with every local folder path replaced by its file name alone (a path ending in a.json becomes
 * "a.json"; a quoted path keeps its quotes). If a path-looking remainder is still there afterwards the whole text is
 * replaced by `fallback`.
 */
export function noLocalPaths(text, fallback = "the error is in the server log") {
  const s = String(text ?? "");
  const out = s
    .replace(QUOTED, (m) => {
      const q = m[0];
      return q + baseName(m.slice(1, -1)) + q;
    })
    .replace(UNQUOTED, (m) => baseName(m));
  return STILL_A_PATH.test(out) ? fallback : out;
}

/** The text of a caught error (or any thrown value) with local paths removed. */
export function safeErrorText(e, fallback = "failed") {
  return noLocalPaths(e?.message ?? (e === undefined || e === null ? fallback : String(e)), fallback);
}

/**
 * Global rule G62 (nothing dropped silently): what a step could not use, counted by reason. `skipCounter()` gives
 * { counts, skip(reason) }; `droppedText(counts, what)` is the one sentence every source note uses for them,
 * "12 rows not used (8 no team, 4 no projected stats)", most common reason first, or null when nothing was left out.
 */
export function skipCounter() {
  const counts = {};
  return { counts, skip: (reason) => { counts[reason] = (counts[reason] ?? 0) + 1; } };
}

const SAVED_STAMP = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

/** G68: when a saved copy was made, from its OWN fetchedAt, for a source card or the injury note: "saved Thu 11/12 3:05 PM ET", or "saved copy of unknown age"
 *  when it carries no readable stamp (never the time of this run). Absolute only: a cached or baked note is read later, so a relative age would freeze. Pure. */
export function savedCopyText(fetchedAt) {
  const at = typeof fetchedAt === "string" ? Date.parse(fetchedAt) : NaN;
  if (!Number.isFinite(at)) return "saved copy of unknown age";
  return `saved ${SAVED_STAMP.format(new Date(at)).replace(/,/g, "")} ET`;
}

/** G68: the board note when a rebuild threw and the last good board of the same slate is served instead (the one copy, classic and Showdown). */
export function buildFailedNote(e, builtAt) {
  const when = typeof builtAt === "string" && builtAt ? ` built ${builtAt}` : "";
  return `The board could not be rebuilt just now (${safeErrorText(e, "the build failed")}); this is the last good board${when}. Refresh tries again.`;
}

/** A projection source's second records for players it already matched (server/rank/match.js duplicateRecords), as the
 *  card note's sentence, or null when there are none. `labels`: each record as the page names it. */
export function secondRecordsText(labels) {
  const n = (labels ?? []).length;
  return n ? `${n} second record${n === 1 ? "" : "s"} for a player already matched, not used: ${labels.join(", ")}` : null;
}

// The nouns `what` leads with, singular for a total of one ("1 entry not read"); "of N rows" keeps its plural.
const SINGULAR = Object.freeze({ entries: "entry", rows: "row", "row(s)": "row", records: "record", cells: "cell", games: "game", players: "player" });

export function droppedText(counts, what = "rows not used") {
  const parts = Object.entries(counts ?? {}).filter(([, n]) => Number(n) > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (!parts.length) return null;
  const total = parts.reduce((s, [, n]) => s + n, 0);
  const words = total === 1 && !/^of /.test(what) ? what.replace(/\b(entries|rows|row\(s\)|records|cells|games|players)(?=\s|$)/, (w) => SINGULAR[w]) : what;
  return `${total} ${words} (${parts.map(([why, n]) => `${n} ${why}`).join(", ")})`;
}
