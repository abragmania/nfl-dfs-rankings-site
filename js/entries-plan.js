// The pure logic of the Entries section's lineup-to-entry assignment: who holds what, what blocks a lineup in a contest
// (PROJECT.md Part 4 "Optimizer" Entries; RULES.md D56, D57, D75). Browser-loadable leaf module, imported by entries.js;
// its imports are the label leaf lineup-tags.js (one copy of the oldest-first order) and lineupModeOf from lineup-cash.js
// (the one browser copy; lineup-cash.js imports only format.js, totals.js and out.js, so there is no cycle).
import { byAge } from "./lineup-tags.js";
import { lineupModeOf } from "./lineup-cash.js";

export { lineupModeOf };

/** Per-contest use of lineups: true when `lineupId` is already picked by ANOTHER entry of the same contest. */
export function lineupUsedElsewhere(entries, assigned, entry, lineupId) {
  for (const e of entries ?? []) {
    if (e.entryId === entry.entryId) continue;
    if (contestKey(e) === contestKey(entry) && assigned?.[e.entryId] === lineupId) return true;
  }
  return false;
}

/** The DraftKings id at the end of a roster cell `Name (44312211)`; "" when there is none. */
export function cellId(cell) {
  const m = /\((\d+)\)\s*$/.exec(String(cell ?? ""));
  return m ? m[1] : "";
}

/** The ids the entries file uses for a saved lineup's nine players, sorted and joined: the main slate's ids are the
 *  board's own; a second slate's come through its `dkIds` map (board.slates). Null when the lineup is not nine
 *  players or any player has no id in that slate's file. Showdown Entries plan 2026-10-20 (step 3): `slates` may instead
 *  be a file-id context, a function fileKeyOf(lineup) giving the lineup's file ids or null (showdownFileKeyOf below); the
 *  key is then those ids sorted and joined, `slateKey` unused. An array keeps the classic path above unchanged. */
export function lineupFileKey(lineup, slateKey, slates) {
  if (typeof slates === "function") {
    const fileIds = slates(lineup);
    return Array.isArray(fileIds) && fileIds.length ? [...fileIds].map(String).sort().join(",") : null;
  }
  const slots = Array.isArray(lineup?.slots) ? lineup.slots : [];
  if (slots.length !== 9) return null;
  const map = !slateKey || slateKey === "main" ? null : ((slates ?? []).find((s) => s?.key === slateKey)?.dkIds ?? {});
  const ids = [];
  for (const s of slots) {
    const main = String(s?.playerId ?? "");
    const id = map ? (Object.prototype.hasOwnProperty.call(map, main) ? String(map[main]) : "") : main;
    if (!id) return null;
    ids.push(id);
  }
  return ids.sort().join(",");
}

/** Showdown Entries plan 2026-10-20 (step 3): the file-id context of one Showdown game, built from its board `rows`. The
 *  answer, fileKeyOf(lineup), gives a saved lineup's six DraftKings file ids, Captain first: the Captain slot's man by his
 *  CPT row's id (row.cptId), each FLEX slot's man by his FLEX row's id (row.id). A slot may name its man by either id (the
 *  batch save sends the Captain under his FLEX id; buildShowdownSnapshot reads both the same way, D13). Null when the
 *  lineup is not one Captain and five FLEX, a man is on no row or twice, or the Captain has no CPT row. */
export function showdownFileKeyOf(rows) {
  const rowOf = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.id == null) continue;
    rowOf.set(String(r.id).trim(), r);
    if (r.cptId != null && String(r.cptId).trim() !== "") rowOf.set(String(r.cptId).trim(), r);
  }
  return (lineup) => {
    const slots = Array.isArray(lineup?.slots) ? lineup.slots : [];
    if (slots.length !== 6) return null;
    const cpt = [];
    const flex = [];
    const men = new Set();
    for (const s of slots) {
      const row = rowOf.get(String(s?.playerId ?? "").trim());
      if (!row || men.has(String(row.id))) return null;
      men.add(String(row.id));
      const slot = String(s?.slot ?? "").trim().toUpperCase();
      const cptId = row.cptId == null ? "" : String(row.cptId).trim();
      if (slot === "CPT" && cptId !== "") cpt.push(cptId);
      // A man with only a Captain row has id === cptId (server/showdown/parse.js person()); he has no FLEX row, as the server's
      // showdownSlotsFor refuses (🔵 step 3 review), so his lineup has no key and is never proposed.
      else if (slot === "FLEX" && !(cptId !== "" && String(row.id).trim() === cptId)) flex.push(String(row.id).trim());
      else return null;
    }
    return cpt.length === 1 && flex.length === 5 ? [...cpt, ...flex] : null;
  };
}

/** What the server will treat as already in each contest: the lineup sitting in every entry that is NOT being
 *  changed (not picked here, and not `exceptEntryId`, the row whose picker is being drawn, because picking it would
 *  free its own lineup). Keys are `${contestId}|${sorted file ids}`; a row with a blank or unreadable cell holds
 *  nothing. Mirrors planExport in server/entries/routes.js. */
export function heldLineupKeys(entries, assigned, exceptEntryId = null) {
  const held = new Set();
  for (const e of entries ?? []) {
    if (e.entryId === exceptEntryId || assigned?.[e.entryId]) continue;
    if (!Array.isArray(e.current)) continue;
    const ids = e.current.map(cellId);
    if (ids.length === 0 || ids.some((id) => id === "")) continue;
    held.add(`${String(e.contestId).trim()}|${[...ids].sort().join(",")}`);
  }
  return held;
}

/** True when `lineup` cannot go on `entry`: another picked row of the contest has it, or an untouched row of the
 *  contest already holds that exact lineup in the file. */
export function lineupBlockedFor(entries, assigned, entry, lineup, slateKey, slates) {
  if (lineupUsedElsewhere(entries, assigned, entry, lineup.id)) return true;
  const key = lineupFileKey(lineup, slateKey, slates);
  if (key === null) return false;
  return heldLineupKeys(entries, assigned, entry.entryId).has(`${String(entry.contestId).trim()}|${key}`);
}

/** The contest an entry belongs to, as the server keys it (trimmed Contest ID). */
export function contestKey(entry) {
  return String(entry?.contestId ?? "").trim();
}

/** The file's entries grouped by contest, contests in the order they first appear and entries in file order:
 *  [{ contestId, contestName, displayName, fee, entries }]. `displayName` is the name, plus the end of the Contest ID
 *  ("NFL $5 Double Up (#…4417)", the fewest of 4 to 6 digits that tell them apart, else the whole id) when two or
 *  more contests of the file share a name; it is what every header, checkbox and skip sentence shows. */
export function groupByContest(entries) {
  const groups = [];
  const byKey = new Map();
  for (const e of entries ?? []) {
    const k = contestKey(e);
    let g = byKey.get(k);
    if (!g) {
      const contestName = String(e?.contestName ?? "").trim() || `Contest ${k}`;
      g = { contestId: k, contestName, displayName: contestName, fee: String(e?.fee ?? "").trim(), entries: [] };
      byKey.set(k, g);
      groups.push(g);
    }
    g.entries.push(e);
  }
  const byName = new Map();
  for (const g of groups) byName.set(g.contestName, [...(byName.get(g.contestName) ?? []), g]);
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    let n = 4;
    while (n < 6 && new Set(same.map((g) => g.contestId.slice(-n))).size < same.length) n++;
    const distinct = new Set(same.map((g) => g.contestId.slice(-n))).size === same.length;
    for (const g of same) {
      const tail = distinct && g.contestId.length > n ? `…${g.contestId.slice(-n)}` : g.contestId;
      g.displayName = `${g.contestName} (#${tail})`;
    }
  }
  return groups;
}

// ---- The fill proposal (RULES.md D75 as amended 2026-10-17; PROJECT.md Part 4 Entries) -----------------------------

const CLASSES = new Set(["cash", "gpp"]);

export function isCashLineup(lineup) {
  return lineupModeOf(lineup) === "cash";
}

/** D75: a contest is cash only by these whole words in its name (Adam 2026-10-18: head to heads, double ups, 50/50s; anything else is GPP). */
export function classifyContest(contestName) {
  return /\b(double[ -]up|50[/-]50|head[ -]to[ -]head|h2h)\b/i.test(String(contestName ?? "")) ? "cash" : "gpp";
}

function classFor(classes, contestId, contestName) {
  return CLASSES.has(classes?.[contestId]) ? classes[contestId] : classifyContest(contestName);
}

/** The localStorage namespace of the classic Entries tab; a second Entries tab passes its own (Showdown Entries plan step 3),
 *  so neither tab's pruning reaches the other's keys. Every storage key function takes it last, classic by default. */
export const ENTRIES_STORAGE_NS = "nfldfs.entries";

export function classesStorageKey(fileName, ns = ENTRIES_STORAGE_NS) {
  return `${ns}.classes.v1:${fileName}`;
}

/** D75: stored class overrides, only contests still in the file and only cash or gpp; unreadable gives {}. */
export function restoreClasses(raw, groups) {
  let obj;
  try {
    obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  for (const g of groups ?? []) {
    if (Object.prototype.hasOwnProperty.call(obj, g.contestId) && CLASSES.has(obj[g.contestId])) out[g.contestId] = obj[g.contestId];
  }
  return out;
}

/** D75: each contest's class, Adam's override else the call from its name. */
export function effectiveClasses(groups, overrides) {
  const out = {};
  for (const g of groups ?? []) out[g.contestId] = classFor(overrides, g.contestId, g.contestName);
  return out;
}

/** D75: complete lineups in the screen's `order` of ids when given (unlisted ones after), else oldest saved first.
 *  `slates` (Showdown Entries plan step 3): a file-id context function judges completeness instead; an array (or none)
 *  keeps the classic main-slate check. */
export function orderedFillLineups(lineups, order = null, slates = []) {
  const rank = Array.isArray(order) ? new Map(order.map((id, i) => [String(id), i])) : null;
  const r = (l) => rank.get(String(l.id)) ?? Infinity;
  const context = typeof slates === "function" ? slates : [];
  // 🔵 2026-10-17: complete = lineupFileKey on the main slate; the stable sort by the screen's order keeps byAge within a rank.
  const aged = byAge((Array.isArray(lineups) ? lineups : []).filter((l) => l && l.id != null && lineupFileKey(l, "main", context) !== null));
  const sorted = rank ? aged.sort((a, b) => (r(a) === r(b) ? 0 : r(a) < r(b) ? -1 : 1)) : aged;
  return { cash: sorted.filter(isCashLineup), gpp: sorted.filter((l) => !isCashLineup(l)) };
}

/** The entry's assigned lineup, only if it is still one of `lineups` (a deleted or other-slate lineup is dropped).
 *  Ids compare as strings. The one copy; entries.js re-exports it (plan item 7). */
export function effectiveAssignments(entries, lineups, assigned) {
  const ids = new Set((Array.isArray(lineups) ? lineups : []).filter((l) => l?.id != null).map((l) => String(l.id)));
  const out = {};
  for (const e of entries ?? []) {
    const id = assigned?.[e.entryId];
    if (id && ids.has(String(id))) out[e.entryId] = id;
  }
  return out;
}

/** What one entry row holds and shows (Adam 2026-10-18: "choose which lineup goes where without it getting overridden"; D75).
 *  The one decision. `pick`: the row's effective app pick or null; `kept`: the row is in the fill's keep set (a hand pick or
 *  "(leave as is)"); `proposedId`: the fill's pending proposal for the row or null. A row with a pick that is kept is a HAND PICK:
 *  it holds and shows its pick, a proposal for it is ignored (never shown, never confirmed), whatever Replace says.
 *  Returns { lineupId, state: "proposed"|"assigned"|"kept"|"none", hand }. */
export function rowHolds({ pick = null, kept = false, proposedId = null } = {}) {
  const hand = Boolean(pick) && Boolean(kept);
  if (!hand && proposedId != null && proposedId !== "") return { lineupId: proposedId, state: "proposed", hand: false };
  if (pick) return { lineupId: pick, state: "assigned", hand };
  return { lineupId: null, state: kept ? "kept" : "none", hand: false };
}

// D75: lineupBlockedFor, or a different saved lineup with the same nine players already in the contest.
function fillBlocked(entries, merged, entry, lineup, byId, slateKey, slates) {
  if (lineupBlockedFor(entries, merged, entry, lineup, slateKey, slates)) return true;
  const key = lineupFileKey(lineup, slateKey, slates);
  if (key === null) return false;
  const c = contestKey(entry);
  for (const e of entries) {
    if (e.entryId === entry.entryId || contestKey(e) !== c || !merged[e.entryId]) continue;
    const other = byId.get(String(merged[e.entryId]));
    if (other && other.id !== lineup.id && lineupFileKey(other, slateKey, slates) === key) return true;
  }
  return false;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** D75 fill (PROJECT.md Part 4 Entries). Adam 2026-10-18 (replaces the lead-lineup order): every contest of a class takes that
 *  class's lineups in the screen's number order, 1..k, one per entry top to bottom; a contest never holds one lineup twice.
 *  `keep`: entry ids never opened, even with Replace; a kept row with no pick holds its file lineup (🔵 2026-10-17).
 *  `prior`: the last proposal { entryId: lineupId }; a row of a multi-entry contest takes its prior lineup first when still a
 *  candidate and not blocked, so one hand change never reshuffles the untouched rows (👁 2026-10-17). */
export function planFill({ entries, lineups, assigned, classes, overwrite = false, keep = null, prior: priorIn = null, lineupIds = null, contestIds = null, order = null, slateKey = "main", slates = [] } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const all = (Array.isArray(lineups) ? lineups : []).filter((l) => l && l.id != null);
  const byId = new Map(all.map((l) => [String(l.id), l]));
  const usable = all.filter((l) => lineupFileKey(l, slateKey, slates) !== null);
  const tickL = lineupIds == null ? null : new Set(Array.from(lineupIds, String));
  const tickC = contestIds == null ? null : new Set(Array.from(contestIds, String));
  const saved = orderedFillLineups(usable, order, slates);
  const pool = orderedFillLineups(usable.filter((l) => !tickL || tickL.has(String(l.id))), order, slates);
  const groups = groupByContest(list).filter((g) => !tickC || tickC.has(g.contestId));
  const classOf = new Map(groups.map((g) => [g.contestId, classFor(classes, g.contestId, g.contestName)]));
  const picks = effectiveAssignments(list, all, assigned);
  const merged = { ...picks };
  const proposed = {};
  const counts = { cash: 0, gpp: 0 };
  const left = new Map();
  const kept = new Set(Array.from(keep ?? [], String));
  const open = (e) => !kept.has(String(e.entryId)) && (overwrite || !picks[e.entryId]);
  const take = (e, cls, l) => {
    if (merged[e.entryId] !== l.id) {
      proposed[e.entryId] = l.id;
      counts[cls]++;
    }
    merged[e.entryId] = l.id;
  };
  const place = (e, cls, candidates, usePrior) => {
    const was = usePrior ? priorIn?.[e.entryId] : null;
    const p = was == null ? -1 : candidates.findIndex((l) => String(l.id) === String(was));
    if (p >= 0 && !fillBlocked(list, merged, e, candidates[p], byId, slateKey, slates)) {
      take(e, cls, candidates[p]);
      return;
    }
    for (const l of candidates) {
      if (fillBlocked(list, merged, e, l, byId, slateKey, slates)) continue;
      take(e, cls, l);
      return;
    }
    left.set(contestKey(e), (left.get(contestKey(e)) ?? 0) + 1);
  };
  // Adam 2026-10-18: each contest starts again at its class's lineup 1 (a single-entry contest never uses `prior`, so it always gets lineup 1).
  for (const g of groups) {
    const cls = classOf.get(g.contestId);
    if (!pool[cls].length) continue;
    for (const e of g.entries) if (open(e)) place(e, cls, pool[cls], g.entries.length > 1);
  }
  const existing = orderedFillLineups(all, order, slates);
  return { proposed, notes: fillNotes(groups, classOf, existing, saved, pool, left), counts };
}

// D75: one note per ticked contest left short. 👁 2026-10-17: a note naming no contest shows once (contestId null); contests
// left short the same way share one line naming them all (contestId null); a note of one contest keeps its contestId.
function fillNotes(groups, classOf, existing, saved, pool, left) {
  const lines = new Map(); // note key -> { text } or { n, why, groups }, in first-seen order
  for (const g of groups) {
    const cls = classOf.get(g.contestId);
    const label = cls === "cash" ? "cash" : "GPP";
    if (!pool[cls].length) {
      const why = saved[cls].length ? "are ticked" : existing[cls].length ? "fit this slate's file" : "are saved";
      const text = `No ${label} lineups ${why}, so the ${label} entries are left as they are.`;
      if (!lines.has(text)) lines.set(text, { text, cls });
      continue;
    }
    const n = left.get(g.contestId) ?? 0;
    if (!n) continue;
    const m = pool[cls].length;
    const why = `${plural(m, `${label} lineup`, `${label} lineups`)} ${m === 1 ? "is" : "are"} ticked, and a contest never takes one twice.`;
    const key = `${n}|${why}`;
    if (!lines.has(key)) lines.set(key, { n, why, cls, groups: [] });
    lines.get(key).groups.push(g);
  }
  // 🔵 2026-10-18: each note carries its class (`cls`), so the GPP and Cash tabs filter on it, not on the text.
  return [...lines.values()].map(({ text, n, why, cls, groups: gs }) => {
    if (text) return { contestId: null, text, cls };
    const each = gs.length > 1 ? " each" : "";
    const count = n === 1 ? `1 entry${each} left as it is` : `${n} entries${each} left as they are`;
    if (gs.length === 1) return { contestId: gs[0].contestId, text: `${count}: ${why}`, cls };
    return { contestId: null, text: `${gs.length} contests (${gs.map((g) => g.displayName).join(", ")}): ${count}: ${why}`, cls };
  });
}

/** D75: the proposals still valid at render (row, saved lineup, its class, its file key, no twin in the contest).
 *  🔵 2026-10-17: `assigned` is ALL the picks and `merged` starts as them, so a dropped proposal keeps its old pick and later
 *  rows are judged as Confirm's { ...picks, ...proposals } writes them; `overwrite` opens picked rows, `keep` rows never. */
export function validProposals(proposed, entries, lineups, assigned, classes = null, slateKey = "main", slates = [], { overwrite = false, keep = null } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const byId = new Map((Array.isArray(lineups) ? lineups : []).filter((l) => l && l.id != null).map((l) => [String(l.id), l]));
  const picks = effectiveAssignments(list, lineups, assigned);
  const kept = new Set(Array.from(keep ?? [], String));
  const merged = { ...picks };
  const out = {};
  for (const e of list) {
    const id = proposed?.[e.entryId];
    if (typeof id !== "string" || id === "" || (picks[e.entryId] && !overwrite) || kept.has(String(e.entryId))) continue;
    const l = byId.get(id);
    if (!l || lineupModeOf(l) !== classFor(classes, contestKey(e), e.contestName)) continue;
    if (lineupFileKey(l, slateKey, slates) === null || fillBlocked(list, merged, e, l, byId, slateKey, slates)) continue;
    merged[e.entryId] = id;
    out[e.entryId] = id;
  }
  return out;
}
