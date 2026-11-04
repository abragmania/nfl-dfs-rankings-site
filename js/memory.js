// The browser's memory of what Adam had set (optimizer standard A9, round 5): the key `nfldfs.memory.v1`, for both Optimizers, the app and the public site alike (same browser storage, so the site keeps its own
// copy). It holds, per slate (classic: the season and week plus the main slate or the second slate's key) and per game (Showdown: the game's key, which already carries the season and week):
//   the filters, the sort, the working lineup (classic: the nine slots and the locks and excludes, apart for GPP and for Cash; Showdown: the Captain and the five FLEX seats), the exposure table's sort and filter
//   and, for classic, the settings (how many lineups, minimum unique, the position caps, the rules, max per team, the stacks, the avoided games of GPP and of Cash).
// What stays in its own keys: classic's per-player Min % and Max % boxes, per-QB stacks, card-list sort, mode and Cash's Want lists (`nfldfs.lineupBuilder.v1`, lineup.js savePersisted); Showdown's settings, locks and
// Min / Max per game (`optimizer-state.js`); the Columns lists (`nfldfs.columns.*`) and the theme. An older browser's one global classic lineup is moved into `classic.legacy` here at hydrate (lineup-memory-sync.js).
// The rules that keep a remembered thing honest: storage that is blocked, full or damaged is only a lost convenience (the page still draws; a full quota drops the older weeks and tries once more, saying so in the
// console, updateMemory); a man who is gone, has a new id, or belongs to another week or slate is dropped with a sentence (cleanLineupIds says who), never thrown at and never stood in for; a lock the lineup does
// not contain is not brought back (GPP's locks are kept only for the men in the slots; Cash's Must may have no slot; Showdown's reseat refuses a lock for a man seated in the other seat, seats.js).
// Pure helpers first (tests/memory.test.mjs), then the storage.
export const MEMORY_KEY = "nfldfs.memory.v1";
const VERSION = 1;

/** The browser's storage, or null: reading `window.localStorage` itself throws when storage is blocked, so it is read inside the try. */
export function browserStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (e) {
    return null; // blocked storage: what he sets holds for this page view only
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const strings = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" || typeof x === "number").map(String))] : []);

/** The stored text to a memory object: anything that is not one gives an empty memory. Pure. */
export function parseMemory(text) {
  try {
    const parsed = typeof text === "string" ? JSON.parse(text) : null;
    if (!isObject(parsed)) return emptyMemory();
    return { v: VERSION, classic: isObject(parsed.classic) ? parsed.classic : {}, showdown: isObject(parsed.showdown) ? parsed.showdown : {} };
  } catch (e) {
    return emptyMemory(); // damaged text is only a lost convenience
  }
}

export const emptyMemory = () => ({ v: VERSION, classic: {}, showdown: {} });

/** Reads the memory; never throws. `storage` is for tests; left out, the browser's is read inside the try. */
export function readMemory(storage = browserStorage()) {
  try {
    return parseMemory(storage?.getItem(MEMORY_KEY));
  } catch (e) {
    return emptyMemory(); // storage can throw (private browsing)
  }
}

/** The week a memory key belongs to as one number (season * 100 + week), or null when it names none ("2026-w8|main", "2026-w08-CARGB"; a Showdown key made before a week was known has "wXX"). */
export function weekOfKey(key) {
  const m = /^(\d{4})-w(\d{1,2})(?!\d)/.exec(String(key));
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}

const onScreen = { classic: null, showdown: null }; // the slate and the game on screen now: what a full quota never drops, whatever its week

/** Says which slate (`area` "classic") or game ("showdown") is on screen, so pruning never takes what he is looking at. */
export function setOnScreen(area, key) {
  if (area in onScreen) onScreen[area] = key ?? null;
}

/**
 * Drops everything remembered for a week older than the newest one in `memory`, in both Optimizers, except the slate and the game on screen (`protect`, by default what setOnScreen was told);
 * true when something went. Pure on the object it is given.
 */
export function pruneOldWeeks(memory, protect = [onScreen.classic, onScreen.showdown]) {
  const buckets = [memory.classic?.slates, memory.showdown?.games].filter(isObject);
  const kept = new Set(protect.filter((k) => k != null));
  const weeks = buckets.flatMap((b) => Object.keys(b).map(weekOfKey)).filter((w) => w !== null);
  if (!weeks.length) return false;
  const newest = Math.max(...weeks);
  let dropped = false;
  for (const bucket of buckets) {
    for (const key of Object.keys(bucket)) {
      const week = weekOfKey(key);
      if (week !== null && week < newest && !kept.has(key)) {
        delete bucket[key];
        dropped = true;
      }
    }
  }
  return dropped;
}

/**
 * Reads the memory, lets `mutate(memory)` change it, writes it back; true when it was written, false when it was not (the change then lasts for this page view). Storage that is blocked (null) is only
 * a lost convenience. A write the browser refuses (the quota is full) drops the older weeks and tries once more, and says so in the console either way; a change that throws writes nothing.
 */
export function updateMemory(mutate, storage = browserStorage()) { // a full quota never drops the slate and the game on screen (setOnScreen)
  if (!storage) return false;
  const memory = readMemory(storage);
  try {
    mutate(memory);
  } catch (e) {
    console.warn("The browser's memory was not changed: the change itself failed.", e);
    return false;
  }
  try {
    storage.setItem(MEMORY_KEY, JSON.stringify(memory));
    return true;
  } catch (first) {
    const pruned = pruneOldWeeks(memory);
    console.warn(pruned ? "The browser's storage refused the memory; older weeks were dropped and the write is tried again." : "The browser's storage refused the memory and there is no older week to drop.", first);
    if (!pruned) return false;
    try {
      storage.setItem(MEMORY_KEY, JSON.stringify(memory));
      return true;
    } catch (second) {
      console.warn("The browser's memory could not be written even after dropping the older weeks; what he set lasts for this page view.", second);
      return false;
    }
  }
}

/** The section of one slate or game, created when missing: `memory.classic.slates[key]` or `memory.showdown.games[key]`. */
export function slateEntry(memory, area, key) {
  const bucket = area === "showdown" ? "games" : "slates";
  const root = (memory[area] ??= {});
  const all = (root[bucket] = isObject(root[bucket]) ? root[bucket] : {});
  return (all[key] = isObject(all[key]) ? all[key] : {});
}

/** The slate a classic memory belongs to: the season and week of the board plus the slate on screen ("main", or the second slate's key). A new week is a new entry, so last week's is never brought back. */
export function classicMemoryKey(board, slateKey = "main") {
  return `${board?.slate?.season ?? ""}-w${board?.slate?.week ?? ""}|${slateKey || "main"}`;
}

// ---------- classic filters and sort ----------

const finiteOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A remembered classic filter set made safe for `board`'s slate: a team or game that is not on it goes, a bad value goes back to the default. Never throws. `teamsOn`: Set of team codes; `gameIds`: Set of game ids. */
export function cleanClassicFilters(raw, { teamsOn = null, gameIds = null, defaults }) {
  const out = { ...defaults };
  if (!isObject(raw)) return out;
  if (["All", "QB", "RB", "WR", "TE", "DST", "FLEX"].includes(raw.pos)) out.pos = raw.pos;
  out.teams = new Set(strings(raw.teams).filter((t) => !teamsOn || teamsOn.has(t)));
  out.salaryMin = finiteOrNull(raw.salaryMin);
  out.salaryMax = finiteOrNull(raw.salaryMax);
  out.search = typeof raw.search === "string" ? raw.search : "";
  out.starredOnly = raw.starredOnly === true;
  out.showAllPlayers = raw.showAllPlayers === true;
  out.gameId = typeof raw.gameId === "string" && (!gameIds || gameIds.has(raw.gameId)) ? raw.gameId : null;
  return out;
}

/** The classic filters as stored: the team set as a list. */
export const storableClassicFilters = (f) => ({ ...f, teams: [...(f?.teams ?? [])] });

/** A remembered sort made safe: the column must be one of `known`, the direction asc or desc; anything else gives `fallback`. A sort on a column that is gone can never break the table. */
export function cleanSort(raw, known, fallback) {
  if (!isObject(raw) || !known.includes(raw.col)) return { ...fallback };
  return { col: raw.col, dir: raw.dir === "asc" ? "asc" : "desc" };
}

// ---------- Showdown filters ----------

const SD_POS = ["All", "QB", "RB", "WR", "TE", "K", "DST"];

/** A remembered Showdown pool filter set made safe: `teams` are the game's two teams (and "both"). Never throws. */
export function cleanShowdownFilters(raw, { teams = null, defaults }) {
  const out = { ...defaults };
  if (!isObject(raw)) return out;
  out.team = raw.team === "both" || (typeof raw.team === "string" && (!teams || teams.includes(raw.team))) ? raw.team : defaults.team;
  out.pos = SD_POS.includes(raw.pos) ? raw.pos : defaults.pos;
  out.minSalary = finiteOrNull(raw.minSalary);
  out.maxSalary = finiteOrNull(raw.maxSalary);
  out.minProj = finiteOrNull(raw.minProj);
  out.search = typeof raw.search === "string" ? raw.search : "";
  out.starredOnly = raw.starredOnly === true;
  return out;
}

// ---------- the working lineup ----------

/**
 * A remembered lineup made safe against the men on the board. `entries`: [{id, name}|null] in seat order (anything else is empty); `has(id)`: whether the board still has a row with that id.
 * Returns {ids (the kept ids, null for an empty or gone seat), gone ([names of the men who are gone])}. Never throws; a man who is gone is reported by name and left out, never replaced.
 */
export function cleanLineupIds(entries, has) {
  const ids = [];
  const gone = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const id = isObject(e) && e.id != null ? String(e.id) : null;
    if (id === null) ids.push(null);
    else if (has(id)) ids.push(id);
    else {
      ids.push(null);
      gone.push(typeof e.name === "string" && e.name ? e.name : null); // an older memory has no names: the man is counted, not named
    }
  }
  return { ids, gone };
}

/** The sentence a remembered lineup that lost men says: who is gone and why. "" when nobody is. A man with no name on record (null) is counted. */
export function goneSentence(gone, where = "this board") {
  if (!gone.length) return "";
  const named = gone.filter(Boolean);
  const unnamed = gone.length - named.length;
  if (!named.length) return `${unnamed} ${unnamed === 1 ? "man" : "men"} in your remembered lineup ${unnamed === 1 ? "is" : "are"} not on ${where}, so ${unnamed === 1 ? "he was" : "they were"} taken out.`;
  const names = named.length <= 3 ? named.join(", ") : `${named.slice(0, 3).join(", ")} and ${named.length - 3} more`;
  const extra = unnamed ? ` and ${unnamed} more` : "";
  return `${names}${extra} ${gone.length === 1 ? "was" : "were"} in your remembered lineup but ${gone.length === 1 ? "is" : "are"} not on ${where}, so ${gone.length === 1 ? "he was" : "they were"} taken out.`;
}

/**
 * Classic's remembered lineup: the nine slots (id and name), the locks and the excludes. In GPP a lock is kept only for a man who is in a slot (a lock is how a man is held in the lineup, D70); in Cash a Must can
 * be a man with no slot (`slotlessLocks`, lineup-optimizer.js cashMakeMust does it on purpose), so his lock is kept too. An exclude is never kept for a man who is in a slot or locked: the two can never contradict
 * each other. `has(id)`: whether the board (the slate on screen) still has the man. Returns {slots: [id|null x n], locks: [ids], excludes: [ids], gone: [names, null where none was stored]}; a man who is gone
 * is named from `raw.names` (id to name) as well as from his slot's own name.
 */
export function restoreClassicLineup(raw, has, slotCount = 9, { slotlessLocks = false } = {}) {
  const entries = Array.isArray(raw?.slots) ? raw.slots.slice(0, slotCount) : [];
  while (entries.length < slotCount) entries.push(null);
  const names = isObject(raw?.names) ? raw.names : {};
  const cleaned = cleanLineupIds(entries.map((e) => (isObject(e) && e.id != null && !e.name && names[String(e.id)] ? { ...e, name: names[String(e.id)] } : e)), has);
  const inSlots = new Set(cleaned.ids.filter(Boolean));
  const gone = [...cleaned.gone];
  const slotted = new Set(entries.filter((e) => isObject(e) && e.id != null).map((e) => String(e.id)));
  const nameOfLock = (id) => (typeof names[id] === "string" && names[id] ? names[id] : null);
  const locks = [];
  const unlocked = [];
  for (const id of strings(raw?.locks)) {
    if (!slotlessLocks && !inSlots.has(id)) {
      // A lock the lineup does not contain is not brought back; it is said: a man who left the board is counted among those the lineup lost, one still on it is named as unlocked.
      if (slotted.has(id)) continue; // his slot was gone from the board, named above
      if (has(id)) unlocked.push(nameOfLock(id));
      else gone.push(nameOfLock(id));
      continue;
    }
    if (has(id)) locks.push(id);
    else if (!slotted.has(id)) gone.push(nameOfLock(id)); // a slotless Must who left the board is named once; a slotted one was named above
  }
  const held = new Set(locks);
  const excludes = strings(raw?.excludes).filter((id) => has(id) && !inSlots.has(id) && !held.has(id));
  return { slots: cleaned.ids, locks, excludes, gone, unlocked };
}

/** What classic stores of its lineup: each slot as {id, name} (the name only so a man who is gone can be named), the locks and the excludes, and a name for each locked man (a Must can have no slot). */
export function storableClassicLineup(slots, locks, excludes, nameOf = () => "") {
  const lockIds = [...(locks ?? [])].map(String);
  return {
    slots: (slots ?? []).map((s) => (s && s.id != null ? { id: String(s.id), name: nameOf(String(s.id)) } : null)),
    locks: lockIds,
    excludes: [...(excludes ?? [])].map(String),
    names: Object.fromEntries(lockIds.map((id) => [id, nameOf(id)])),
  };
}

/** Showdown's remembered lineup: the Captain and the five FLEX seats, by the man's board id. Returns {cpt: id|null, flex: [id|null x 5], gone}. */
export function restoreShowdownLineup(raw, has, flexCount = 5) {
  const cptCleaned = cleanLineupIds(isObject(raw?.cpt) ? [raw.cpt] : [null], has);
  const flexEntries = Array.isArray(raw?.flex) ? raw.flex.slice(0, flexCount) : [];
  while (flexEntries.length < flexCount) flexEntries.push(null);
  const flexCleaned = cleanLineupIds(flexEntries, has);
  const seen = new Set();
  const once = (id) => (id !== null && !seen.has(id) && seen.add(id) ? id : null); // a man sits in one seat only
  const cpt = once(cptCleaned.ids[0]);
  const flex = flexCleaned.ids.map(once);
  return { cpt, flex, gone: [...cptCleaned.gone, ...flexCleaned.gone] };
}

/** What Showdown stores of its lineup: {cpt: {id, name}|null, flex: [{id, name}|null x 5]}. */
export function storableShowdownLineup(cpt, flex, nameOf = () => "") {
  const one = (s) => (s && s.id != null ? { id: String(s.id), name: nameOf(String(s.id)) } : null);
  return { cpt: one(cpt), flex: (flex ?? []).map(one) };
}
