// The Tracked DFS players page's view, pure (no DOM), so tests import it directly (Adam 2026-10-20: "make it something I can
// sort and click through that isn't ugly"). public/js/tracked-players.js draws what these functions return.
//
// The page's rows are every username in lists.json (the contest entrants, from tools/tracked_lists.mjs) plus every name in the
// registry (the RotoGrinders top 100 and Adam's marks) that entered none of the contests. Each row sits on "lists": the top 100,
// each contest it entered, and Adam's marks. The list chooser's rules use the marks as they were when the page loaded, so ticking
// a name never moves it out of the list being worked through; its Marked badge, the Hide marked filter and the counts use the
// live marks. Crossover is the rule Adam worked from on 2026-10-19 (65 names): two or more of the top 100, the high-dollar
// games, the double-up and his marks; the GPP (DAL@GB) does not count toward it (code review, 2026-10-20).

export const PAGE_SIZE = 300;

// The Double-up and DAL@GB pills are labelled from lists.json's contests (listLabels), so a new week's contests name themselves.
export const LIST_CHOICES = [
  { id: "crossover", label: "Crossover" },
  { id: "doubleup", label: "Double-up", kind: "doubleUp" },
  { id: "dalgb", label: "DAL@GB", kind: "gpp" },
  { id: "all", label: "All" },
];

/** Each pill's label: { crossover, doubleup, dalgb, all }; a contest list takes the short label of its contest kind's first contest. */
export function listLabels(contests) {
  return Object.fromEntries(LIST_CHOICES.map((l) => [l.id, (l.kind && contests.find((c) => c.kind === l.kind)?.short) || l.label]));
}

// Each column's sort, its first-click direction (lower is better for the ranks, so they open ascending) and its header.
export const COLUMNS = [
  { id: "mark", label: "Mark", dir: "desc" },
  { id: "name", label: "Name", dir: "asc" },
  { id: "on", label: "On", dir: "desc" },
  { id: "entries", label: "Entries", dir: "desc" },
  { id: "best", label: "Best rank", dir: "asc" },
  { id: "avg", label: "Avg points", dir: "desc" },
  { id: "rg", label: "RG rank", dir: "asc" },
];
export const DEFAULT_SORT = { col: "entries", dir: "desc" };

// Badge order: Top 100, the high-dollar games, the double-up, the GPP, then Marked (contests of a kind keep lists.json's order).
const KIND_ORDER = { highDollar: 0, doubleUp: 1, gpp: 2 };

const lower = (s) => String(s).trim().toLowerCase();

/** The contests in badge order, each with its badge slot (1..n, which colour style.css gives it). */
export function orderedContests(contests) {
  return contests
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (KIND_ORDER[a.c.kind] ?? 9) - (KIND_ORDER[b.c.kind] ?? 9) || a.i - b.i)
    .map(({ c }, slot) => ({ ...c, slot: slot + 1 }));
}

/**
 * { contests, rows, marked: Set(lowerName) } from GET /api/tracked-players' registry and lists. Rows are ordered by name
 * (case-insensitive), which is the order ties keep under every sort. A row: { key, name, contests, rgRank, rgName, top100,
 * onLoad: Set(listKey) } where listKey is "top100", a contest id or "marked".
 */
export function buildModel(registry, lists) {
  const contests = orderedContests(lists.contests);
  const top = new Map(registry.rotogrindersTop100.map((p) => [lower(p.dk), p]));
  const marked = new Set(registry.adam.map(lower));
  const byKey = new Map();
  const add = (name, contestsOf = {}, rgRank = null) => {
    const key = lower(name);
    if (byKey.has(key) || key === "") return;
    const t = top.get(key);
    byKey.set(key, { key, name: String(name).trim(), contests: contestsOf, rgRank: rgRank ?? t?.rank ?? null, rgName: t?.rgName ?? null, top100: Boolean(t) || rgRank !== null });
  };
  for (const p of lists.players) add(p.name, p.contests ?? {}, Number.isInteger(p.rgRank) ? p.rgRank : null);
  for (const p of registry.rotogrindersTop100) add(p.dk);
  for (const n of registry.adam) add(n);
  for (const n of registry.players) add(n);
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
  if (list === "crossover") {
    const gpp = idsOfKind(contests, "gpp");
    return [...row.onLoad].filter((k) => !gpp.includes(k)).length >= 2;
  }
  if (list === "doubleup") return has(idsOfKind(contests, "doubleUp")) && !has(idsOfKind(contests, "highDollar"));
  if (list === "dalgb") return has(idsOfKind(contests, "gpp")) && row.onLoad.size === 1;
  return true;
}

/** Each list's row count, for the pills: { crossover, doubleup, dalgb, all }. */
export function listCounts(model) {
  return Object.fromEntries(LIST_CHOICES.map((l) => [l.id, model.rows.filter((r) => onList(r, l.id, model.contests)).length]));
}

/** The contest ids a list is about (its Best rank, Avg points and Multi-entry filter use them): the double-up's or the GPP's, else every contest. */
export function shownContestIds(list, contests) {
  if (list === "doubleup") return idsOfKind(contests, "doubleUp");
  if (list === "dalgb") return idsOfKind(contests, "gpp");
  return contests.map((c) => c.id);
}

/** Entries summed over every contest the row entered (the Entries column), and the per-contest split for its hover. */
export function entriesOf(row, contests) {
  const split = contests.filter((c) => row.contests[c.id]).map((c) => ({ id: c.id, label: c.label, entries: row.contests[c.id].entries }));
  return { total: split.reduce((s, x) => s + x.entries, 0), split };
}

/**
 * Best rank and average points over the contests `ids`. The best is the entry placed highest as a share of its field (rank / field
 * entries), so a rank in the 71-entry game and one in the 78,431-entry GPP compare fairly; within one contest that is the plain
 * rank. Average points is the entries-weighted mean. null where the row entered none of them.
 */
export function statsOver(row, ids, contests) {
  const byId = new Map(contests.map((c) => [c.id, c]));
  let best = null;
  let entries = 0;
  let points = 0;
  for (const id of ids) {
    const s = row.contests[id];
    if (!s) continue;
    const c = byId.get(id);
    const frac = s.best / c.entries;
    if (best === null || frac < best.frac) best = { rank: s.best, of: c.entries, frac, label: c.label, live: c.liveSnapshot === true, snapshotAt: c.snapshotAt ?? null };
    entries += s.entries;
    points += s.avgPoints * s.entries;
  }
  return { best, avg: entries ? points / entries : null };
}

/**
 * A placing as the share of the field it beat into, "top 2.4%", the Best rank column's main figure (its sort is the same share).
 * Rounded UP at the shown precision (whole numbers from 10%, tenths from 1%, hundredths below), so the sentence stays true:
 * #3 of 78,431 (0.0038%) reads "top 0.01%", never "top 0%".
 */
export function shareText(frac) {
  const pct = frac * 100;
  const step = pct >= 10 ? 1 : pct >= 1 ? 0.1 : 0.01;
  const up = Math.ceil(Math.round((pct / step) * 1e6) / 1e6) * step; // the inner round drops float noise such as 2.4000000001
  return `top ${up.toFixed(step === 1 ? 0 : step === 0.1 ? 1 : 2)}%`;
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

/** The source line's contest part: contests grouped by snapshotText, "High $ 675, Double-up: live snapshot ...; DAL@GB: final". */
export function snapshotSummary(contests, timeText = () => null) {
  const groups = new Map();
  for (const c of contests) {
    const text = snapshotText(c.liveSnapshot === true, c.snapshotAt, timeText);
    groups.set(text, [...(groups.get(text) ?? []), c.short]);
  }
  return [...groups].map(([text, shorts]) => `${shorts.join(", ")}: ${text}`).join("; ");
}

/** False when nobody on the list has 2 or more entries in the list's contests (a single-entry contest), so the Multi-entry filter is off there. */
export function multiPossible(model, list) {
  const ids = shownContestIds(list, model.contests);
  return model.rows.some((r) => onList(r, list, model.contests) && isMultiEntry(r, ids));
}

/** The badges a row shows, in order: [{ key, short, title, slot }] (slot 0 = Top 100, 1..n = the contests, "marked"). */
export function badgesFor(row, contests, marked) {
  const out = [];
  if (row.top100) out.push({ key: "top100", short: "Top 100", title: row.rgRank ? `RotoGrinders top 100, #${row.rgRank}` : "RotoGrinders top 100", slot: 0 });
  for (const c of contests) if (row.contests[c.id]) out.push({ key: c.id, short: c.short ?? c.id, title: c.label, slot: c.slot });
  if (marked.has(row.key)) out.push({ key: "marked", short: "Marked", title: "Marked by you", slot: "marked" });
  return out;
}

/** Every value a row sorts by on list `list`; null sorts last in both directions. */
export function sortValues(row, list, model) {
  const s = statsOver(row, shownContestIds(list, model.contests), model.contests);
  return {
    mark: model.marked.has(row.key) ? 1 : 0,
    name: row.key,
    on: badgesFor(row, model.contests, model.marked).length,
    entries: entriesOf(row, model.contests).total,
    best: s.best ? s.best.frac : null,
    avg: s.avg,
    rg: row.rgRank,
  };
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

/** The next sort after a header click: the same column flips, a new one opens in its own first direction. */
export function nextSort(sort, col) {
  if (sort.col === col) return { col, dir: sort.dir === "asc" ? "desc" : "asc" };
  return { col, dir: COLUMNS.find((c) => c.id === col)?.dir ?? "desc" };
}

/** True when the row has 2 or more entries in one of the contests `ids`. */
export function isMultiEntry(row, ids) {
  return ids.some((id) => (row.contests[id]?.entries ?? 0) >= 2);
}

/**
 * The rows the table shows: on the chosen list, matching the search (substring, case-insensitive), without marked names when
 * hideMarked, only multi-entry names when multiOnly, sorted. view: { list, query, hideMarked, multiOnly, sort: { col, dir } }.
 */
export function viewRows(model, view) {
  const q = lower(view.query ?? "");
  const ids = shownContestIds(view.list, model.contests);
  const rows = model.rows.filter(
    (r) =>
      onList(r, view.list, model.contests) &&
      (q === "" || r.key.includes(q)) &&
      !(view.hideMarked && model.marked.has(r.key)) &&
      !(view.multiOnly && !isMultiEntry(r, ids))
  );
  const sort = view.sort ?? DEFAULT_SORT;
  const values = new Map(rows.map((r) => [r, sortValues(r, view.list, model)]));
  return sortRows(rows, sort.col, sort.dir, (r) => values.get(r));
}

/** The first `limit` rows and the "showing X of Y" figures: { shown, showing, total, more }. */
export function page(rows, limit = PAGE_SIZE) {
  const shown = rows.slice(0, Math.max(0, limit));
  return { shown, showing: shown.length, total: rows.length, more: rows.length > shown.length };
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

/** The table's columns: every column in the app; on the public site, where marking runs in the app, no Mark column. */
export function columnsFor(site) {
  return site ? COLUMNS.filter((c) => c.id !== "mark") : COLUMNS;
}

/** Names with at least one contest entry: the "M names across N contests" count. */
export function namesInContests(model) {
  return model.rows.filter((r) => Object.keys(r.contests).length > 0).length;
}
