// The one copy of the saved-lineup label helpers (Adam 2026-10-17, entries fill plan item 7a): a computed number (1 =
// the oldest saved lineup of the slate) and Adam's own letter (the saved lineup's `tag`). Used by the Saved card
// (lineup.js) and the Entries fill strip (entries-fill.js, entries-plan.js). A pure leaf: no imports, no storage.

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** The letters Adam can give a lineup, in order: A to Z, then AA, AB ... ZZ (702). */
export const TAG_OPTIONS = [...LETTERS, ...LETTERS.flatMap((a) => LETTERS.map((b) => a + b))];

const RANK = new Map(TAG_OPTIONS.map((t, i) => [t, i]));

/** The position of a letter in TAG_OPTIONS; a lineup with no (or an unknown) letter ranks last (Infinity). */
export function tagRank(tag) {
  return RANK.has(tag) ? RANK.get(tag) : Infinity;
}

const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

function savedMs(l) {
  const ms = Date.parse(l?.savedAt ?? "");
  return Number.isFinite(ms) ? ms : Infinity;
}

/** Oldest savedAt first (unreadable last), ties by id, as a new array; the one copy, entries-plan.js uses it (🔵 2026-10-17). */
export function byAge(lineups) {
  return [...(Array.isArray(lineups) ? lineups : [])].sort((a, b) => savedMs(a) - savedMs(b) || byId(a, b));
}

/** Plan item 7a: id -> number over the given lineups (the slate's saved lineups). 1 is the OLDEST savedAt, ties by id.
 *  Computed on every call and never stored: a delete shifts the numbers, the letter is the stable handle. */
export function numberLineups(lineups) {
  const sorted = byAge((Array.isArray(lineups) ? lineups : []).filter((l) => l && l.id != null));
  return new Map(sorted.map((l, i) => [l.id, i + 1]));
}

/** "1 · A" (number, letter when set; "" when neither), shared by the Saved card and lineupLabel (🔵 2026-10-17). */
export function lineupPrefix(lineup, numbers) {
  const n = numbers?.get?.(lineup?.id);
  const tag = typeof lineup?.tag === "string" && lineup.tag !== "" ? lineup.tag : null;
  return [n, tag].filter((p) => p != null).join(" · ");
}

/** "1 · A · name": the number, then the letter when the lineup has one, then the name. Untagged: "1 · name". */
export function lineupLabel(lineup, numbers) {
  const name = String(lineup?.name ?? "").trim() || "Lineup";
  const prefix = lineupPrefix(lineup, numbers);
  return prefix ? `${prefix} · ${name}` : name;
}

/** The lineups in the order of the Sort toggle: by "number" ascending, or by "letter" (lettered first in letter order,
 *  then the untagged by number). Returns a new array. */
export function sortLineupsBy(lineups, by, numbers) {
  const num = (l) => numbers?.get?.(l.id) ?? Infinity;
  const rank = by === "letter" ? (l) => tagRank(l.tag) : () => 0;
  return [...(Array.isArray(lineups) ? lineups : [])].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    const na = num(a);
    const nb = num(b);
    if (na !== nb) return na < nb ? -1 : 1;
    return byId(a, b);
  });
}
