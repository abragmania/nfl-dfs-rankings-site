// The Tracked DFS players page's view, pure (no DOM), so tests import it directly (Adam 2026-10-20: "make it something I can
// sort and click through that isn't ugly"). public/js/tracked-players.js draws what these functions return.
//
// Adam 2026-10-20 2:10 PM: "I do NOT care about contest results! have columns for top 100, the high stakes entries, and then the
// lower stakes / larger field one that I uploaded." The page is about the WAS@SF contests only: its rows are every username that
// entered one of the high-dollar games or the double-up, plus every RotoGrinders top-100 account (whether or not he entered); the
// DAL@GB entrants who are in neither drop out; a marked name is always a row too (blank rank and cells when he has none), so every
// mark can be seen and unmarked. Its columns are the mark, the name, the top-100 rank and one YES column per
// contest. Each row sits on "lists": the top 100, each contest it entered, and Adam's marks. The list chooser's rules use the marks
// as they were when the page loaded, so ticking a name never moves it out of the list being worked through; the Hide marked filter
// and the counts use the live marks. Crossover is the rule Adam worked from on 2026-10-19 (65 names): two or more of the top 100,
// the high-dollar games, the double-up and his marks.
// Adam 2026-10-21: no paging; the page draws every row of the chosen list (the largest is 1,517 names) inside a fixed-height scrolling box.

// The list chips, in order. High $ is either high-dollar game; the others read their column.
export const LIST_CHOICES = [
  { id: "all", label: "All" },
  { id: "top100", label: "Top 100" },
  { id: "highdollar", label: "Cash games" },
  { id: "doubleup", label: "Double-up" },
  { id: "crossover", label: "Crossover" },
];

// The default order is not one column: top-100 men first by rank, then YES in both high-dollar games, then in one, then YES in the
// double-up, then name. Any header click replaces it with that column alone. Adam 2:19 PM: "I just need a YES if they were in it;
// don't need any more details", so a contest column shows YES or blank and no entry counts are shown or sorted.
export const DEFAULT_SORT = { col: "default", dir: "desc" };

// The contests the page is about, in column order: the high-dollar games, then the double-up (contests of a kind keep lists.json's order).
const KIND_ORDER = { highDollar: 0, doubleUp: 1 };

const lower = (s) => String(s).trim().toLowerCase();

/** The page's contests in column order (the high-dollar games, then the double-up); any other kind, the DAL@GB GPP included, is left out. */
export function orderedContests(contests) {
  return contests
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.kind in KIND_ORDER)
    .sort((a, b) => KIND_ORDER[a.c.kind] - KIND_ORDER[b.c.kind] || a.i - b.i)
    .map(({ c }) => ({ ...c }));
}

/**
 * The table's columns: mark, name, top 100 (the RotoGrinders rank), then one YES column per contest (id = the contest's id, label
 * = its short name, a contest column opens YES first, the rank opens lowest first). On the public site, where marking runs
 * in the app, no Mark column. `counts` (columnCounts of the model; optional) puts the player count in the Top 100 and contest
 * headers, "Cash game · 46" (Adam 2026-10-21: "show total players in the header / top of column of each"); a contest's title
 * then carries its full label, its entries and its players.
 */
export function columnsFor(site, contests, counts = null) {
  const withCount = (label, id) => (counts && Number.isInteger(counts[id]) ? `${label} · ${counts[id].toLocaleString("en-US")}` : label);
  const cols = [
    { id: "mark", label: "Mark", dir: "desc" },
    { id: "name", label: "Name", dir: "asc" },
    { id: "top100", label: withCount("Top 100", "top100"), dir: "asc", title: "RotoGrinders overall rank (blank when not in the top 100)" },
    ...contests.map((c) => {
      const more = counts && Number.isInteger(counts[c.id]) && Number.isInteger(c.entries) ? `; ${c.entries.toLocaleString("en-US")} entries, ${counts[c.id].toLocaleString("en-US")} players` : "";
      return { id: c.id, label: withCount(c.short ?? c.id, c.id), dir: "desc", title: `${c.label}: YES when he entered it, blank when not${more}` };
    }),
  ];
  return site ? cols.filter((c) => c.id !== "mark") : cols;
}

/** The players per column, for the headers: { top100, [contest id]: distinct usernames that entered it } over every row of the model. */
export function columnCounts(model) {
  const counts = { top100: model.rows.filter((r) => r.top100).length };
  for (const c of model.contests) counts[c.id] = model.rows.filter((r) => r.contests[c.id]).length;
  return counts;
}

/**
 * { contests, rows, marked: Set(lowerName) } from GET /api/tracked-players' registry and lists. Rows are ordered by name
 * (case-insensitive), which is the order ties keep under every sort. A row: { key, name, contests, rgRank, rgName, top100,
 * onLoad: Set(listKey) } where contests holds only the page's contests and listKey is "top100", a contest id or "marked".
 */
export function buildModel(registry, lists) {
  const contests = orderedContests(lists.contests);
  const ids = new Set(contests.map((c) => c.id));
  const top = new Map(registry.rotogrindersTop100.map((p) => [lower(p.dk), p]));
  const marked = new Set(registry.adam.map(lower));
  const byKey = new Map();
  const add = (name, contestsOf = {}, rgRank = null, isMarked = false) => {
    const key = lower(name);
    if (byKey.has(key) || key === "") return;
    const t = top.get(key);
    const mine = Object.fromEntries(Object.entries(contestsOf).filter(([id]) => ids.has(id)));
    const top100 = Boolean(t) || rgRank !== null;
    if (!top100 && !isMarked && Object.keys(mine).length === 0) return; // in none of the page's contests, not in the top 100 and not marked
    byKey.set(key, { key, name: String(name).trim(), contests: mine, rgRank: rgRank ?? t?.rank ?? null, rgName: t?.rgName ?? null, top100 });
  };
  for (const p of lists.players) add(p.name, p.contests ?? {}, Number.isInteger(p.rgRank) ? p.rgRank : null);
  for (const p of registry.rotogrindersTop100) add(p.dk);
  for (const n of registry.adam) add(n, {}, null, true); // a marked name is always a row, so every mark can be seen and unmarked here
  const rows = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const r of rows) {
    r.onLoad = new Set(Object.keys(r.contests));
    if (r.top100) r.onLoad.add("top100");
    if (marked.has(r.key)) r.onLoad.add("marked");
  }
  return { contests, rows, marked };
}

const idsOfKind = (contests, kind) => contests.filter((c) => c.kind === kind).map((c) => c.id);

/** True when the row belongs on list `list` (by the marks at page load). */
export function onList(row, list, contests) {
  const has = (ids) => ids.some((id) => row.contests[id]);
  if (list === "crossover") return row.onLoad.size >= 2;
  if (list === "top100") return row.top100;
  if (list === "highdollar") return has(idsOfKind(contests, "highDollar"));
  if (list === "doubleup") return has(idsOfKind(contests, "doubleUp"));
  return true;
}

/** Each list's row count, for the chips: { all, top100, highdollar, doubleup, crossover }. */
export function listCounts(model) {
  return Object.fromEntries(LIST_CHOICES.map((l) => [l.id, model.rows.filter((r) => onList(r, l.id, model.contests)).length]));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * How a contest's figures were read: "final" when no entry had time remaining; else a live snapshot, with its time only as
 * recorded in contests.json (never a file's modified time): a date alone reads "live snapshot during the game, Oct 19 (time not
 * recorded)"; a full time is drawn by `timeText(iso)` (the page's local clock), "live snapshot, Oct 19 22:45"; none at all reads
 * "live snapshot (time not recorded)". A date alone is read from its digits, not through Date, which would shift it a day west of UTC.
 */
export function snapshotText(live, at, timeText = () => null) {
  if (!live) return "final";
  const day = typeof at === "string" ? DATE_ONLY.exec(at) : null;
  if (day) return `live snapshot during the game, ${MONTHS[Number(day[2]) - 1]} ${Number(day[3])} (time not recorded)`;
  const t = at ? timeText(at) : null;
  return t ? `live snapshot, ${t}` : "live snapshot (time not recorded)";
}

/**
 * The source line's contest part: contests grouped by snapshotText, each distinct short name once, pluralised ("s") when it covers
 * more than one contest, and with each contest's player count when `counts` (columnCounts) is given:
 * "Cash games (46, 88), $5 Double-up (1,379): live snapshot ...; DAL@GB: final" (Adam 2026-10-21).
 */
export function snapshotSummary(contests, timeText = () => null, counts = null) {
  const groups = new Map();
  for (const c of contests) {
    const text = snapshotText(c.liveSnapshot === true, c.snapshotAt, timeText);
    const byShort = groups.get(text) ?? new Map();
    byShort.set(c.short, [...(byShort.get(c.short) ?? []), c]);
    groups.set(text, byShort);
  }
  const part = (short, of) => {
    const name = of.length > 1 ? `${short}s` : short;
    const figures = counts ? of.map((c) => counts[c.id]).filter(Number.isInteger).map((n) => n.toLocaleString("en-US")) : [];
    return figures.length > 0 ? `${name} (${figures.join(", ")})` : name;
  };
  return [...groups].map(([text, byShort]) => `${[...byShort].map(([short, of]) => part(short, of)).join(", ")}: ${text}`).join("; ");
}

/** Every value a row sorts by: the mark, the name, the RG rank and, per contest, 1 for YES (null for none, so YES rows come first either way); null sorts last in both directions. */
export function sortValues(row, model) {
  const values = { mark: model.marked.has(row.key) ? 1 : 0, name: row.key, top100: row.rgRank };
  for (const c of model.contests) values[c.id] = row.contests[c.id] ? 1 : null;
  return values;
}

/** Sorts rows by `col` and `dir` ("asc" or "desc"). Ties keep the input order in both directions; a missing value goes last either way. */
export function sortRows(rows, col, dir, valueOf) {
  const sign = dir === "asc" ? 1 : -1;
  const keyed = rows.map((row, i) => ({ row, i, v: valueOf(row)[col] }));
  keyed.sort((a, b) => {
    if (a.v === null && b.v === null) return a.i - b.i;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    const d = typeof a.v === "string" ? a.v.localeCompare(b.v) : a.v - b.v;
    return d !== 0 ? sign * d : a.i - b.i;
  });
  return keyed.map((k) => k.row);
}

/** The default order: top-100 men by rank, then YES in both high-dollar games, then in one, then YES in the double-up, then name. */
export function defaultSortRows(rows, contests) {
  const yesIn = (row, ids) => ids.filter((id) => row.contests[id]).length;
  const hd = idsOfKind(contests, "highDollar");
  const du = idsOfKind(contests, "doubleUp");
  const keyed = rows.map((row, i) => ({ row, i, rg: row.rgRank, hd: yesIn(row, hd), du: yesIn(row, du) }));
  keyed.sort((a, b) => (a.rg === null) - (b.rg === null) || (a.rg ?? 0) - (b.rg ?? 0) || b.hd - a.hd || b.du - a.du || a.i - b.i); // rows come in name order
  return keyed.map((k) => k.row);
}

/** The next sort after a header click: the same column flips, a new one opens in its own first direction (from the `columns` list). */
export function nextSort(sort, col, columns) {
  if (sort.col === col) return { col, dir: sort.dir === "asc" ? "desc" : "asc" };
  return { col, dir: columns.find((c) => c.id === col)?.dir ?? "desc" };
}

/**
 * The rows the table shows: on the chosen list, matching the search (substring, case-insensitive), without marked names when
 * hideMarked, sorted. view: { list, query, hideMarked, sort: { col, dir } }.
 */
export function viewRows(model, view) {
  const q = lower(view.query ?? "");
  const rows = model.rows.filter(
    (r) => onList(r, view.list, model.contests) && (q === "" || r.key.includes(q)) && !(view.hideMarked && model.marked.has(r.key))
  );
  const sort = view.sort ?? DEFAULT_SORT;
  if (sort.col === DEFAULT_SORT.col) return defaultSortRows(rows, model.contests);
  const values = new Map(rows.map((r) => [r, sortValues(r, model)]));
  return sortRows(rows, sort.col, sort.dir, (r) => values.get(r));
}

/** The live marks as lower-case keys, from a registry's `adam` list. */
export function markedFrom(adam) {
  return new Set(adam.map(lower));
}

/** The live marks after one confirmed save: only `key` changes, so a reply to an earlier click never undoes a later one. */
export function withMark(marked, key, on) {
  const next = new Set(marked);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

/** Names with at least one entry in the page's contests: the "M names across N contests" count. */
export function namesInContests(model) {
  return model.rows.filter((r) => Object.keys(r.contests).length > 0).length;
}

/** The row-focus step a key asks for: +1 for Down and j, -1 for Up and k, else 0. */
export function keyStep(key) {
  if (key === "ArrowDown" || key === "j") return 1;
  if (key === "ArrowUp" || key === "k") return -1;
  return 0;
}

/** The index after moving `delta` rows from `index` (-1 = no row focused yet) among `count` rows: stops at the first and last, lands on the first row when none was focused, -1 when there are no rows. */
export function stepIndex(index, count, delta) {
  if (count <= 0) return -1;
  if (index < 0) return 0;
  return Math.min(count - 1, Math.max(0, index + delta));
}

/** The name key to focus after moving `delta` rows from `key` in the ordered `keys` (null when there are none). */
export function stepKey(keys, key, delta) {
  const i = stepIndex(key === null ? -1 : keys.indexOf(key), keys.length, delta);
  return i < 0 ? null : keys[i];
}

/**
 * Which row keeps the keyboard focus after a sort, filter, search or list change (or a mark that hides its row): the same name while
 * it is still listed; else the row that took its place (the same index in the old list `prevKeys`, held to the last row), so
 * Enter never marks a name that is off screen; the first row when the old list did not hold it. None stays none, and an empty list gives none.
 */
export function cursorAfter(keys, key, prevKeys = []) {
  if (key === null) return null;
  if (keys.includes(key)) return key;
  const at = prevKeys.indexOf(key);
  return keys[at < 0 ? 0 : Math.min(at, keys.length - 1)] ?? null;
}
