// The Showdown Lineups section's kept builds (Adam 2026-11-09: new lineups never pile up): a Build that made lineups replaces the previous build of the same mode for that game, so one newest GPP build and one
// newest Cash build are kept, newest first; a GPP build never removes a Cash build, a build with no lineups removes nothing, and a list stored with more builds is cut to the newest per mode every time it is read.
// Saved lineups are a separate server-backed list and are never touched here. Kept in the browser, each game under its own key (nfldfs.sdBuilds.v1.<game>), never in the shared settings memory
// (../memory.js): 150 lineups a build could fill the browser's limit and stop every setting saving. What is stored is slim (only what the card, its meter strip and the exposure table read, with the
// field model every lineup repeats written once per build), builds of an older week go when a game is kept, and a write the browser refuses drops the oldest build and tries again. The app and the public site keep them the same way; nothing is written to the
// server (D71). Every read and write is wrapped: a blocked or damaged store gives an empty list and one sentence, never a throw. The pure rules come first (tests/showdown-lineups-store.test.mjs).
import { browserStorage, weekOfKey } from "../memory.js";
import { sdSetKey } from "./optimizer-state.js";
import { saveBody } from "./optimizer-requests.js";
import { lineupTotals } from "../lineup-totals.js";
import { lineupModeOf } from "../lineup-cash.js";
import { LOOK_SORT_KEYS, sortLineups } from "../lineup-sort.js";

export const KEEP_BUILDS = 1; // per mode
/** The Lineups tab's sorts, classic's own keys (lineup-sort.js LOOK_SORT_KEYS: Projection, Salary, Ownership, Newest, each with its first direction), so a second click reverses one exactly as classic's nextSort does (Adam yes 11:01 AM 11-10). */
export const SORT_KEYS = Object.freeze(LOOK_SORT_KEYS.filter((k) => ["proj", "salary", "own", "built"].includes(k.key)));
export const FIRST_SORT = Object.freeze({ key: "built", dir: "asc" }); // Newest: a build's own order, the saved list's most recent first
export const KEY_PREFIX = "nfldfs.sdBuilds.v1.";
export const NOTE_UNREADABLE = "The lineups kept for this game could not be read from this browser, so the list starts empty.";
export const NOTE_BLOCKED = "This browser is not keeping lineups, so the ones shown stay only until this page is closed.";
export const NOTE_NOT_WRITTEN = "These lineups could not be kept in this browser, so they stay only until this page is closed.";
export const NOTE_TRIMMED = "This browser's storage is full, so the oldest kept build was dropped to make room.";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const buildsKey = (game) => `${KEY_PREFIX}${game}`;

// ---------- the slim shape ----------

const SEAT_FIELDS = ["slot", "playerId", "personId", "name", "pos", "team", "salary", "proj", "own", "realPos", "median"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

/** The part of a lineup's meter the card reads (cardMeterHtml, noUniquenessText, offBoardText): its projection and gap to the best, the uniqueness block and the ownership half's flags. */
export function slimMeter(m) {
  if (!isObject(m)) return null;
  const own = isObject(m.ownership) ? pick(m.ownership, ["posted", "error", "unposted", "notOnBoard"]) : undefined;
  return { ...pick(m, ["proj", "bestProj", "gapPts", "gapPct", "uniqueness"]), ...(own ? { ownership: own } : {}) };
}

/** One lineup as kept: its seats with the figures the card shows, the median and the bent flag when the answer has them, the uid and the place in its build, the slim meter. */
export function slimLineup(l) {
  return { uid: l.uid, index: l.index, ...pick(l, ["median", "bent"]), slots: (l.slots ?? []).map((s) => pick(s, SEAT_FIELDS)), meter: slimMeter(l.meter) };
}

/** A build as kept: what resultsFromAnswer made, the lineups slim, and the projection and ownership source halves once for the build (the source line reads them), not once per lineup. */
export function slimBuild(b) {
  const halves = isObject(b.meter) ? pick(b.meter, ["projection", "ownership"]) : null;
  return { ...pick(b, ["id", "at", "mode", "basis", "boardMode", "objective", "figuresKey", "projection", "ownership", "names", "boardBuiltAt", "notes", "bends", "made", "marks", "buildId"]), meter: halves, lineups: (b.lineups ?? []).map(slimLineup) };
}

/**
 * A build as written to the browser: the field model every lineup's uniqueness block repeats (the fit dates and nights: about 3.5 KB each, the same for every lineup of a build) is written once on the build,
 * and the lineups it was taken out of carry a flag. A lineup whose model differs keeps its own.
 */
export function toStored(b) {
  const shared = b.lineups.map((l) => l.meter?.uniqueness?.model).find((m) => m !== undefined);
  if (shared === undefined) return b;
  const same = JSON.stringify(shared);
  const lineups = b.lineups.map((l) => {
    const u = l.meter?.uniqueness;
    if (!u || u.model === undefined || JSON.stringify(u.model) !== same) return l;
    const { model, ...rest } = u;
    return { ...l, meter: { ...l.meter, uniqueness: { ...rest, modelShared: true } } };
  });
  return { ...b, model: shared, lineups };
}

/** The build as the page uses it: the shared model put back into the lineups that were flagged (toStored's inverse). */
export function fromStored(b) {
  if (!isObject(b)) return b;
  const { model, ...rest } = b;
  const lineups = b.lineups.map((l) => {
    const u = l?.meter?.uniqueness;
    if (!isObject(u) || u.modelShared !== true) return l;
    const { modelShared, ...kept } = u;
    return { ...l, meter: { ...l.meter, uniqueness: model === undefined ? kept : { ...kept, model } } };
  });
  return { ...rest, lineups };
}

const seatOk = (s) => isObject(s) && typeof s.slot === "string" && (typeof s.playerId === "string" || typeof s.playerId === "number");
const lineupOk = (l) => isObject(l) && typeof l.uid === "string" && Array.isArray(l.slots) && l.slots.length > 0 && l.slots.every(seatOk);
const buildOk = (b) => isObject(b) && typeof b.id === "string" && b.id !== "" && (b.mode === "cash" || b.mode === "gpp") && Array.isArray(b.lineups);

/** A stored list made safe, with whether anything was dropped: only builds with an id, a mode and lineups whose every seat is an object with a string slot and a playerId; a damaged lineup or build goes. Never throws. */
export function cleanBuildsReport(raw) {
  if (!Array.isArray(raw)) return { list: [], dropped: true };
  const list = [];
  let dropped = false;
  for (const b of raw) {
    if (!buildOk(b)) { dropped = true; continue; }
    const lineups = b.lineups.filter(lineupOk);
    if (lineups.length !== b.lineups.length) dropped = true;
    if (lineups.length) list.push({ ...b, lineups });
  }
  return { list: capPerMode(list), dropped };
}

export const cleanBuilds = (raw) => cleanBuildsReport(raw).list;

// ---------- pure rules ----------

/** The list with at most KEEP_BUILDS of each mode, the newest first (a list is newest first). */
export function capPerMode(list) {
  const seen = { cash: 0, gpp: 0 };
  return list.filter((b) => ++seen[b.mode] <= KEEP_BUILDS);
}

/** The kept record of one finished build (optimizer-requests.js resultsFromAnswer's answer): slim, the lineups frozen as the answer made them, each with an id of its own that stays unique across builds and reloads. */
export function makeBuild(results, nowMs = Date.now()) {
  const id = typeof results.buildId === "string" && results.buildId ? results.buildId : `b${Math.floor(nowMs).toString(36)}`;
  const lineups = (results.lineups ?? []).map((l, i) => ({ ...l, uid: `${id}.${i + 1}`, index: i }));
  return slimBuild({ ...results, id, at: new Date(nowMs).toISOString(), lineups, made: lineups.length });
}

/** The list with a new build first and the older build of ITS mode dropped (a GPP build never removes a Cash build); a build with no lineups adds nothing (the same list comes back). */
export function addBuild(list, build) {
  if (!build || !Array.isArray(build.lineups) || build.lineups.length === 0) return list;
  return capPerMode([build, ...list.filter((b) => b.id !== build.id)]);
}

export const removeBuild = (list, id) => list.filter((b) => b.id !== id);

/** The list without one card; a build left with no lineups goes too. */
export function discardLineup(list, uid) {
  return list.map((b) => (b.lineups.some((l) => l.uid === uid) ? { ...b, lineups: b.lineups.filter((l) => l.uid !== uid) } : b)).filter((b) => b.lineups.length > 0);
}

export const countLineups = (list) => list.reduce((n, b) => n + b.lineups.length, 0);

/** The newest build of a mode ("gpp" or "cash"), or null. */
export const newestOf = (list, mode) => list.find((b) => b.mode === mode) ?? null;

/** The list without its oldest build (by the time it was kept), or the same list when it has none or one. */
export function dropOldest(list) {
  if (list.length <= 1) return list;
  const oldest = list.reduce((a, b) => (String(b.at) < String(a.at) ? b : a));
  return list.filter((b) => b !== oldest);
}

/** A kept lineup and its build by the lineup's uid, or null. */
export function findLineup(list, uid) {
  for (const b of list) {
    const lineup = b.lineups.find((l) => l.uid === uid);
    if (lineup) return { build: b, lineup };
  }
  return null;
}

/** The figures a card shows, from the slots it carries: {used, proj, own}, each null when any man lacks it (lineup-totals.js, the card's own sums). */
export function slotFigures(slots) {
  const t = lineupTotals((slots ?? []).map((s) => ({ salary: s?.salary, proj: s?.proj, own: s?.own })));
  return { used: t.used, proj: t.proj, own: t.own };
}

/**
 * `items` in the order of `sort` ({key, dir}, nextSort's state): by projection, salary used or total ownership in `dir`, a missing total always last; "built" (Newest) keeps the order given
 * (a build's own order, or the saved list's most recent first). `figuresOf(item)` gives {used, proj, own}. Stable; a new array (lineup-sort.js sortLineups, the one sorter).
 */
export function sortItems(items, sort, figuresOf) {
  return sortLineups(items, sort?.key, sort?.dir, (item) => { const f = figuresOf(item); return { proj: f.proj, salary: f.used, own: f.own }; }, SORT_KEYS);
}

/** Whether any name matches the typed text (any man's name, case ignored); no text matches everything. */
export function matchesText(names, text) {
  const t = String(text ?? "").trim().toLowerCase();
  return !t || (names ?? []).some((n) => String(n ?? "").toLowerCase().includes(t));
}

/** The Mode switch: "All" passes every lineup, "Cash" or "GPP" only that mode. */
export const modeMatches = (mode, filter) => filter === "All" || (filter === "Cash" ? "cash" : "gpp") === mode;

/** The saved lineups' men as one set key each (Captain apart from the FLEX set); `personOf` is optimizer-state.js boardIndex's map. */
export const savedKeySet = (saved, mode, personOf) => new Set((saved ?? []).filter((l) => lineupModeOf(l) === mode).map((l) => sdSetKey(l.slots, personOf)));

/** Whether a built card's men, in the same seats, are already saved in its build's mode (its Saved ✓). */
export const isSaved = (lineup, keys, personOf) => keys.has(sdSetKey(lineup.slots, personOf));

/** The POST .../lineups body for a card: the build's own mode, never the tab on screen. */
export const saveBodyFor = (build, lineup, name) => saveBody(lineup, build, name);

/** "9:18 PM" in Eastern time from an ISO stamp; "" when it cannot be read. */
export function etClock(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
}

/** A build's header words: "Cash, 4 lineups, 9:18 PM ET". */
export function headerText(build) {
  const n = build.lineups.length;
  const clock = etClock(build.at);
  return `${build.mode === "cash" ? "Cash" : "GPP"}, ${n} lineup${n === 1 ? "" : "s"}${clock ? `, ${clock} ET` : ""}`;
}

// ---------- the storage ----------

const kept = new Map(); // game key -> {list, note}
const listeners = new Set();
let storageOf = browserStorage; // a test swaps it

/** Test hook: the storage the module reads and writes, and a clean slate. */
export function setLineupsStorage(getStorage) {
  storageOf = getStorage;
  kept.clear();
}

/** The one reading of a game's kept builds from the browser: {list, note}; never throws. */
export function readKept(key, storage = storageOf()) {
  if (!storage) return { list: [], note: NOTE_BLOCKED };
  try {
    const text = storage.getItem(buildsKey(key));
    if (text === null || text === undefined) return { list: [], note: "" };
    const { list, dropped } = cleanBuildsReport(JSON.parse(text));
    return { list: list.map(fromStored), note: dropped ? NOTE_UNREADABLE : "" };
  } catch (e) {
    console.warn("Showdown Lineups: the kept lineups could not be read", e);
    return { list: [], note: NOTE_UNREADABLE };
  }
}

const entryOf = (key) => {
  if (!kept.has(key)) kept.set(key, readKept(key));
  return kept.get(key);
};

/** The game's kept builds, newest first. */
export const keptBuilds = (key) => (key ? entryOf(key).list : []);
/** The sentence a blocked, damaged or full store leaves, or "". */
export const keptNote = (key) => (key ? entryOf(key).note : "");
export const keptCount = (key) => countLineups(keptBuilds(key));

export function onKeptChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Drops the kept builds of games of an older week than `key`'s (a new week's slate has no use for last week's builds, and they would only fill the browser). */
function pruneOlderWeeks(storage, key) {
  const week = weekOfKey(key);
  if (week === null || typeof storage.key !== "function" || typeof storage.length !== "number") return;
  const old = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (typeof k !== "string" || !k.startsWith(KEY_PREFIX)) continue;
    const w = weekOfKey(k.slice(KEY_PREFIX.length));
    if (w !== null && w < week) old.push(k);
  }
  for (const k of old) storage.removeItem(k);
}

/** Writes the list under the game's key; a refused write drops the oldest build and tries again, down to the newest alone. Returns {list: what was written (or the list when nothing could be), note}. */
function writeList(storage, key, list) {
  if (!storage) return { list, note: NOTE_BLOCKED };
  try {
    pruneOlderWeeks(storage, key);
  } catch (e) {
    console.warn("Showdown Lineups: the kept lineups of older weeks could not be tidied", e);
  }
  let work = list;
  for (;;) {
    try {
      storage.setItem(buildsKey(key), JSON.stringify(work.map(toStored)));
      return { list: work, note: work.length < list.length ? NOTE_TRIMMED : "" };
    } catch (e) {
      console.warn("Showdown Lineups: the browser refused the kept lineups", e);
      const next = dropOldest(work);
      if (next === work) return { list, note: NOTE_NOT_WRITTEN };
      work = next;
    }
  }
}

function commitList(key, list) {
  const entry = entryOf(key);
  const out = writeList(storageOf(), key, list);
  entry.list = out.list;
  entry.note = out.note;
  for (const fn of [...listeners]) fn(key);
}

/** Keeps a finished build (resultsFromAnswer's answer) at the front; one with no lineups keeps nothing. Returns the kept record or null. */
export function keepBuild(key, results, nowMs = Date.now()) {
  if (!key || !results || !(results.lineups ?? []).length) return null;
  const build = makeBuild(results, nowMs);
  commitList(key, addBuild(keptBuilds(key), build));
  return build;
}
export const removeKeptBuild = (key, id) => commitList(key, removeBuild(keptBuilds(key), id));
export const discardKeptLineup = (key, uid) => commitList(key, discardLineup(keptBuilds(key), uid));
export const findKept = (key, uid) => findLineup(keptBuilds(key), uid);
export const newestKept = (key, mode) => newestOf(keptBuilds(key), mode);

/** Re-reads the game's builds from the browser (a test's hook; the page reads each game once). */
export function forgetKept(key) {
  kept.delete(key);
}
