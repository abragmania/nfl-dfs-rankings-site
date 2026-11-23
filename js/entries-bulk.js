// The Entries screen's row selection and its two bulk fills, NBA's way (NBA lsw-maps.js rangeBetween and numberInOrder, copied and
// turned from spots to saved lineups; PROJECT.md Part 4 "Monday 11-23 complaints" item 7). Pure: the wire (entries-wire.js) holds the
// selection and the one-step undo. A bulk fill is a hand pick of every row it fills (D75: the planner never proposes over it), and a
// row whose contest already holds the lineup is skipped and named, never silently dropped (G62).
import { lineupBlockedFor, groupByContest, heldLineupKeys } from "./entries-plan.js";

/** The ids from `from` to `to` inclusive, in row order, whichever is first; just `to` when `from` is not a row (shift-click). */
export function rangeBetween(rowIds, from, to) {
  const a = rowIds.indexOf(from);
  const b = rowIds.indexOf(to);
  if (b < 0) return [];
  if (a < 0) return [to];
  return rowIds.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** The entry ids of one tab in the order the screen draws them (contest by contest, file order inside). `classes`: { contestId: cls }. */
export function screenOrder(entries, classes, cls) {
  return groupByContest(entries)
    .filter((g) => !cls || classes?.[g.contestId] === cls)
    .flatMap((g) => g.entries.map((e) => String(e.entryId)));
}

// Review finding 5 of 11-23: a selected row's own old pick and file cell never block the fill; this stands in for them while it runs
// (truthy, so heldLineupKeys passes the row's file cell over, and equal to no lineup id).
const WRITING = Object.freeze({ writing: true });

const SKIP_WHY = "that contest already has this lineup";

/**
 * Writes `pairs` [[entryId, lineup]] in order as hand picks. The selected rows' own old picks are blanked in the working copy first
 * (review finding 5 of 11-23), so numbering rows that hold L1, L2, L3 from L2 moves each along. A row whose contest already has the
 * lineup (another row picked here or before, or an untouched row holding it in the file) is skipped with its reason, and gets its old
 * pick back unless its contest now holds that lineup, by pick or file cell (restoreSkipped; then `cleared` is true and the row is empty). A skipped row left with no
 * pick keeps its file cell, so the fill runs again with that cell taken until no written lineup equals a kept cell (lead's order of
 * 11-23 to job E). Returns { assign, keep, done, skipped: [{ entryId, why, cleared }] }; the inputs are not changed.
 */
function writePairs(entries, assigned, keep, pairs, slateKey, fileContext, lineups = []) {
  const byId = new Map((entries ?? []).map((e) => [String(e.entryId), e]));
  const usable = pairs.map(([id, lineup]) => [byId.get(String(id)), lineup]).filter(([e, lineup]) => e && lineup);
  // A pick's lineup by id: the slate's saved lineups, then the ones being written; an id found in neither is checked by id alone.
  const known = new Map([...(lineups ?? []), ...usable.map(([, l]) => l)].map((l) => [l.id, l]));
  const lineupOf = (id) => (id == null || id === WRITING ? null : known.get(id) ?? { id });
  const pinned = new Set(); // selected rows that keep their file cell: skipped in every pass, their cell held
  for (let pass = 0; pass <= usable.length; pass++) {
    const r = writePass(entries, assigned, keep, usable, pinned, lineupOf, slateKey, fileContext);
    const keepsCell = r.skipped.map((s) => byId.get(s.entryId)).filter((e) => !r.assign[e.entryId] && heldLineupKeys([e], {}).size > 0);
    const fresh = keepsCell.filter((e) => !pinned.has(e.entryId));
    if (!fresh.length) return r;
    for (const e of fresh) pinned.add(e.entryId);
  }
  throw new Error("writePairs: the bulk fill did not settle"); // unreachable: each pass pins at least one more of the finite rows
}

/** One pass of writePairs: `pinned` rows are skipped up front and hold their file cell; the other selected rows are masked (WRITING). */
function writePass(entries, assigned, keep, usable, pinned, lineupOf, slateKey, fileContext) {
  const assign = { ...(assigned ?? {}) };
  const kept = new Set(Array.from(keep ?? [], String));
  const old = new Map();
  for (const [e] of usable) {
    if (old.has(e.entryId)) continue;
    old.set(e.entryId, assign[e.entryId]);
    if (pinned.has(e.entryId)) delete assign[e.entryId];
    else assign[e.entryId] = WRITING;
  }
  const done = [];
  const skipped = [];
  for (const [e, lineup] of usable) {
    if (pinned.has(e.entryId) || lineupBlockedFor(entries, assign, e, lineup, slateKey, fileContext)) {
      skipped.push({ entryId: String(e.entryId), why: SKIP_WHY, cleared: false });
      continue;
    }
    assign[e.entryId] = lineup.id;
    kept.add(String(e.entryId));
    done.push(String(e.entryId));
  }
  restoreSkipped(entries, assign, skipped, old, usable, lineupOf, slateKey, fileContext);
  return { assign, keep: kept.size ? kept : null, done, skipped };
}

/**
 * Review round 2 finding 2 of 11-23: a skipped row gets its old pick back only where lineupBlockedFor allows it, file cells included; a
 * row that cannot is cleared and marked. All old picks go back first, then any that clash are cleared; clearing a row bares its file
 * cell, so the rest are checked again until none changes.
 */
function restoreSkipped(entries, assign, skipped, old, usable, lineupOf, slateKey, fileContext) {
  const rowOf = (s) => usable.find(([x]) => String(x.entryId) === s.entryId)[0];
  const wasOf = (s) => lineupOf(old.get(rowOf(s).entryId));
  const restored = [];
  for (const s of skipped) {
    const was = wasOf(s);
    if (was) {
      assign[rowOf(s).entryId] = was.id;
      restored.push(s);
    } else delete assign[rowOf(s).entryId];
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const s of restored.filter((x) => !x.cleared)) {
      if (!lineupBlockedFor(entries, assign, rowOf(s), wasOf(s), slateKey, fileContext)) continue;
      delete assign[rowOf(s).entryId];
      s.cleared = true;
      changed = true;
    }
  }
}

/** Fill: every selected row (in screen order) takes `lineup`, one per contest. `lineups`: every saved lineup of the file's slate, so a
 *  skipped row's old pick is checked by its players too (review round 2 finding 2 of 11-23). */
export function fillRows({ entries, assigned, keep, ids, lineup, slateKey = "main", fileContext = [], lineups = [] }) {
  return writePairs(entries, assigned, keep, (ids ?? []).map((id) => [id, lineup]), slateKey, fileContext, lineups);
}

/**
 * Number in order: the selected rows in screen order take consecutive lineups of `list` (the tab's lineups in number order) from
 * `startId`. { unknown } when the start is not in the list; { short, have } when too few lineups follow it, and nothing changes then.
 */
export function numberRows({ entries, assigned, keep, ids, list, startId, slateKey = "main", fileContext = [], lineups = [] }) {
  const order = (list ?? []).map((l) => String(l.id));
  const at = order.indexOf(String(startId));
  if (at < 0) return { unknown: String(startId) };
  const have = order.length - at;
  const rows = ids ?? [];
  if (rows.length > have) return { short: rows.length - have, have };
  return writePairs(entries, assigned, keep, rows.map((id, i) => [id, list[at + i]]), slateKey, fileContext, lineups);
}

/** The sentence after a bulk fill: what was written and what was skipped, each skipped row named by its contest's screen name
 *  (groupByContest displayName, review finding 6 of 11-23) and Entry ID, and a skipped row left empty said so (G62). */
export function bulkSentence(label, r, entries) {
  const nameOf = new Map(groupByContest(entries).flatMap((g) => g.entries.map((e) => [String(e.entryId), g.displayName])));
  const head = `${label}: ${r.done.length} ${r.done.length === 1 ? "row" : "rows"} set`;
  if (!r.skipped.length) return `${head}.`;
  const named = r.skipped.map((s) => `${nameOf.get(s.entryId) ?? "Contest"} ${s.entryId}${s.cleared ? " (now empty: its old lineup went to another row of the contest)" : ""}`).join("; ");
  return `${head}; ${r.skipped.length} skipped because ${r.skipped.length === 1 ? "its" : "their"} contest already has that lineup: ${named}.`;
}
