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
 *  players or any player has no id in that slate's file. */
export function lineupFileKey(lineup, slateKey, slates) {
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

/** D75: a contest is cash only by these whole words in its name; anything unclear is GPP. */
export function classifyContest(contestName) {
  return /\b(double[ -]up|50\/50|head[ -]to[ -]head|h2h)\b/i.test(String(contestName ?? "")) ? "cash" : "gpp";
}

function classFor(classes, contestId, contestName) {
  return CLASSES.has(classes?.[contestId]) ? classes[contestId] : classifyContest(contestName);
}

export function classesStorageKey(fileName) {
  return `nfldfs.entries.classes.v1:${fileName}`;
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

/** D75: complete lineups in the screen's `order` of ids when given (unlisted ones after), else oldest saved first. */
export function orderedFillLineups(lineups, order = null) {
  const rank = Array.isArray(order) ? new Map(order.map((id, i) => [String(id), i])) : null;
  const r = (l) => rank.get(String(l.id)) ?? Infinity;
  // 🔵 2026-10-17: complete = lineupFileKey on the main slate; the stable sort by the screen's order keeps byAge within a rank.
  const aged = byAge((Array.isArray(lineups) ? lineups : []).filter((l) => l && l.id != null && lineupFileKey(l, "main", []) !== null));
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

/** D75 fill (PROJECT.md Part 4 Entries): cash to cash contests wrapping, the lead first in GPP singles and last in the other GPP contests.
 *  `keep`: entry ids never opened, even with Replace; a kept row with no pick holds its file lineup (🔵 2026-10-17).
 *  `prior`: the last proposal { entryId: lineupId }; a row takes its prior lineup first when still a candidate and not
 *  blocked, so one hand change never reshuffles the untouched rows (👁 2026-10-17).
 *  `priorLead`: the lead id `prior` was made with (null = unknown); set and different from the lead used (rules repo 2026-10-17), the remembered GPP placements are ignored. */
export function planFill({ entries, lineups, assigned, classes, lead = null, overwrite = false, keep = null, prior: priorIn = null, priorLead = null, lineupIds = null, contestIds = null, order = null, slateKey = "main", slates = [] } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const all = (Array.isArray(lineups) ? lineups : []).filter((l) => l && l.id != null);
  const byId = new Map(all.map((l) => [String(l.id), l]));
  const usable = all.filter((l) => lineupFileKey(l, slateKey, slates) !== null);
  const tickL = lineupIds == null ? null : new Set(Array.from(lineupIds, String));
  const tickC = contestIds == null ? null : new Set(Array.from(contestIds, String));
  const saved = orderedFillLineups(usable, order);
  const pool = orderedFillLineups(usable.filter((l) => !tickL || tickL.has(String(l.id))), order);
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
  // Rules repo 2026-10-17: a changed lead drops the remembered GPP placements only; cash rows never hold the lead.
  const leadL = (lead != null && pool.gpp.find((l) => String(l.id) === String(lead))) || pool.gpp[0];
  const leadSame = !(priorLead != null && (!leadL || String(leadL.id) !== String(priorLead)));
  const place = (e, cls, candidates, start, usePrior = true) => {
    const was = usePrior ? priorIn?.[e.entryId] : null;
    const p = was == null ? -1 : candidates.findIndex((l) => String(l.id) === String(was));
    if (p >= 0 && !fillBlocked(list, merged, e, candidates[p], byId, slateKey, slates)) {
      take(e, cls, candidates[p]);
      return p;
    }
    for (let k = 0; k < candidates.length; k++) {
      const i = (start + k) % candidates.length;
      const l = candidates[i];
      if (fillBlocked(list, merged, e, l, byId, slateKey, slates)) continue;
      take(e, cls, l);
      return i;
    }
    left.set(contestKey(e), (left.get(contestKey(e)) ?? 0) + 1);
    return -1;
  };
  if (pool.cash.length) {
    let cursor = 0;
    for (const e of list) {
      if (classOf.get(contestKey(e)) !== "cash" || !open(e)) continue;
      const i = place(e, "cash", pool.cash, cursor);
      if (i >= 0) cursor = (i + 1) % pool.cash.length;
    }
  }
  const others = pool.gpp.filter((l) => l !== leadL);
  if (pool.gpp.length) {
    for (const g of groups) {
      if (classOf.get(g.contestId) !== "gpp") continue;
      const single = g.entries.length === 1;
      // 🔵 2026-10-17, D75: prior is never honoured in a single-entry contest, so the lead (which can change without the dropdown) always goes there.
      // Adam 2026-10-17: the lead also fills the multi-entry contests, last, so 20 GPP lineups fill a 20-entry contest.
      for (const e of g.entries) if (open(e)) place(e, "gpp", single ? [leadL, ...others] : [...others, leadL], 0, !single && leadSame);
    }
  }
  // D75: `lead` is the lineup actually used (null with no GPP lineup), so the screen can show it when Adam's pick did not hold.
  const existing = orderedFillLineups(all, order);
  return { proposed, notes: fillNotes(groups, classOf, existing, saved, pool, left), counts, lead: leadL?.id ?? null };
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
      if (!lines.has(text)) lines.set(text, { text });
      continue;
    }
    const n = left.get(g.contestId) ?? 0;
    if (!n) continue;
    const m = pool[cls].length;
    const why = `${plural(m, `${label} lineup`, `${label} lineups`)} ${m === 1 ? "is" : "are"} ticked, and a contest never takes one twice.`;
    const key = `${n}|${why}`;
    if (!lines.has(key)) lines.set(key, { n, why, groups: [] });
    lines.get(key).groups.push(g);
  }
  return [...lines.values()].map(({ text, n, why, groups: gs }) => {
    if (text) return { contestId: null, text };
    const each = gs.length > 1 ? " each" : "";
    const count = n === 1 ? `1 entry${each} left as it is` : `${n} entries${each} left as they are`;
    if (gs.length === 1) return { contestId: gs[0].contestId, text: `${count}: ${why}` };
    return { contestId: null, text: `${gs.length} contests (${gs.map((g) => g.displayName).join(", ")}): ${count}: ${why}` };
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
