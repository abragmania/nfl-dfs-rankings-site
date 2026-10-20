// Sort options for the New and Saved lineups lists, and "geo own", the GPP uniqueness figure (Adam 2026-10-17: sort by
// proj, own% and median; "is there a multiplicative method ... 2% owned Player A + 18% owned player B is more unique than
// 11% owned player C and 9% owned player D"). Pure; lineup.js imports it and holds the state. Nothing here reads the server.
import { shownTotal } from "./totals.js";
import { escapeHtml, dec1 } from "./format.js";

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Geometric mean of the ownership percentages; null if the list is empty or any is missing. A value below 0.1 counts as
 *  0.1 (the published resolution), so one 0.0% player does not zero the product. */
export function geoOwn(owns) {
  if (!Array.isArray(owns) || owns.length === 0) return null;
  let logs = 0;
  for (const o of owns) {
    const v = finite(o);
    if (v === null) return null;
    logs += Math.log(Math.max(v, 0.1));
  }
  return Math.exp(logs / owns.length);
}

/** A lineup's sort figures {proj, own, median, geo} from its players; each is null when any player lacks it, never a partial sum. */
export function lineupFigures(players) {
  const list = players ?? [];
  const every = (key) => list.length > 0 && list.every((p) => finite(p?.[key]) !== null);
  return {
    proj: every("proj") ? shownTotal(list.map((p) => p.proj)) : null,
    own: every("own") ? list.reduce((s, p) => s + p.own, 0) : null,
    median: every("median") ? shownTotal(list.map((p) => p.median)) : null,
    geo: geoOwn(list.map((p) => p?.own)),
  };
}

/** The sort keys in drawn order with their starting direction (own and geo lowest first); "built" keeps the incoming order. */
export const SORT_KEYS = [
  { key: "built", label: "As built", dir: "asc", title: "The order the lineups were made or saved" },
  { key: "proj", label: "Proj", dir: "desc", title: "Projected total" },
  { key: "own", label: "Own%", dir: "asc", title: "Total ownership of the nine players; lowest first is the least-owned lineup" },
  { key: "median", label: "Median", dir: "desc", title: "TwoGun's median total" },
  { key: "geo", label: "Geo own", dir: "asc", title: "Geometric mean of the nine ownerships; lowest first is the most unique lineup" },
];

/** The keys offered: cash gets As built, Proj, Own% and (when `hasMedian`) Median; GPP the same plus Geo own. */
export function sortKeysFor(mode, hasMedian) {
  return SORT_KEYS.filter((k) => (k.key === "median" ? Boolean(hasMedian) : k.key === "geo" ? mode !== "cash" : true));
}

/** A stable copy of `items` ordered by figure `key`; `figuresOf(item)` gives the figures. A null figure goes last either way. */
export function sortLineups(items, key, dir, figuresOf, keys = SORT_KEYS) {
  const list = [...(items ?? [])];
  if (key === "built" || !keys.some((k) => k.key === key)) return list;
  const sign = dir === "desc" ? -1 : 1;
  const decorated = list.map((item, at) => ({ item, at, v: finite(figuresOf(item)?.[key]) }));
  decorated.sort((a, b) => (a.v === null) - (b.v === null) || (a.v === null ? 0 : sign * (a.v - b.v)) || a.at - b.at);
  return decorated.map((d) => d.item);
}

/** The state a click leaves: the active key flips its direction, another key starts in its own natural direction. */
export function nextSort(current, key, keys = SORT_KEYS) {
  const k = keys.find((s) => s.key === key);
  if (!k) return current;
  if (key === "built") return { key, dir: "asc" };
  if (current?.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: k.dir };
}

// `keys` (Showdown, optional): the caller's own sort keys, with their own titles (the nine-player titles above are classic's); default SORT_KEYS.
const cleanOne = (raw, keys) => {
  const k = keys.find((s) => s.key === raw?.key);
  return k ? { key: k.key, dir: raw.dir === "asc" || raw.dir === "desc" ? raw.dir : k.dir } : { key: "built", dir: "asc" };
};

/** The persisted `{new, saved}` sort state as storage gives it back; anything unreadable is "As built". */
export function cleanSortState(raw, keys = SORT_KEYS) {
  return { new: cleanOne(raw?.new, keys), saved: cleanOne(raw?.saved, keys) };
}

/** The sort in force for the keys on offer: the chosen one, or As built when it is not on offer here (Geo own in cash,
 *  Median on a board with none). */
export function effectiveSort(current, keys) {
  return keys.some((k) => k.key === current?.key) ? current : { key: "built", dir: "asc" };
}

/** The "Sort:" line above the cards; `tab` ("new" or "saved") is carried on each button for the click handler. */
export function sortRowHtml(tab, keys, current) {
  const buttons = keys.map((k) => {
    const on = k.key === current.key;
    const arrow = on && k.key !== "built" ? (current.dir === "asc" ? " ▲" : " ▼") : "";
    return `<button type="button" class="opt-sort-btn${on ? " active" : ""}" data-action="opt-sort" data-tab="${tab}" data-key="${k.key}" aria-pressed="${on}" title="${escapeHtml(k.title)}">${escapeHtml(k.label)}${arrow}</button>`;
  });
  return `<div class="opt-sort" role="group" aria-label="Sort lineups"><span class="opt-sort-label">Sort:</span>${buttons.join("")}</div>`;
}

/** A card's median text off the sort's own figure (Adam 2026-10-18: sum the median like the projection, print it, sort by it): "118.4 median";
 *  "— median" with a title when a player lacks one (`anyMedian` true); "" when no player has one. */
export function medianText(median, anyMedian, missingTitle = "a player has no TwoGun median") {
  if (finite(median) !== null) return `${dec1(median)} median`;
  return anyMedian ? `<span title="${escapeHtml(missingTitle)}">— median</span>` : "";
}

/** A GPP card's geo text: "9.9% geo", or "— geo" with `missingTitle` on hover when there is no figure. */
export function geoText(geo, missingTitle = "a player has no ownership figure") {
  return finite(geo) === null
    ? `<span title="${escapeHtml(missingTitle)}">— geo</span>`
    : `<span title="geometric mean of the nine ownerships (lower is more unique)">${dec1(geo)}% geo</span>`;
}
