// The Showdown Optimizer's settings (Adam 2026-10-19 10:31 PM, sketch A: one screen under the Showdown Optimizer tab with a
// GPP | Cash switch; PROJECT.md Part 4 "Showdown Optimizer port"): what Adam has set, kept per showdown key in localStorage,
// and the request body it makes for POST /api/showdown/<key>/lineup/generate. Pure apart from the storage it is handed: no
// DOM, no network. The classic twin is public/js/lineup.js (opt, buildGenerateSettings, savePersisted); this file keeps its
// rules: typed text is kept as typed, a blank Max % is no cap, a Min % of 0 is none, a box that is not a percent blocks Make.
//
// Per mode, as classic's stash keeps each mode's own build: GPP {count, minUnique, objective, maxPerTeam, locks, includes,
// excludes, cptMax, cptMin, flexMax, flexMin}; Cash {count, maxPerTeam, locks, includes, excludes}. A lock is a candidate id
// (the server's rule, server/showdown/generate-request.js): a man's Captain id locks him at Captain, his FLEX id at FLEX. An
// exclude by FLEX id takes the man out of every lineup; by Captain id only his Captain spot. An include (Adam 2026-10-19
// 10:27 PM) is a man's FLEX id: he must be in the lineup at Captain or FLEX and the optimizer picks the role.
import { parsePct, parseWhole } from "../lineup.js";

export const STORAGE_KEY = "nfldfs.sdOptimizer.v1";
export const MAX_COUNT = 150; // server/lineup/showdown-multi.js MAX_LINEUPS
export const MAX_UNIQUE = 6; // showdown-multi.js MAX_UNIQUE: six slots
export const TEAM_OPTIONS = ["3", "4", "5"]; // Adam 2026-10-18: Max per team 3, 4 or 5; 5 is DraftKings' own rule
export const DEFAULT_MAX_PER_TEAM = "5";
// Classic's defaults (lineup.js OPT_DEFAULT_COUNT, lineup-cash.js CASH_DEFAULTS_BROWSER): five GPP lineups, one cash lineup.
const DEFAULTS = Object.freeze({ gppCount: "5", cashCount: "1", minUnique: "1" });
export const OBJECTIVES = Object.freeze([
  { value: "proj", label: "Projection" },
  { value: "median", label: "Median" },
  { value: "ceil", label: "Ceiling" },
]);
export const MODES = Object.freeze(["gpp", "cash"]);
const CAP_FIELDS = Object.freeze(["cptMax", "cptMin", "flexMax", "flexMin"]);

/** A fresh mode state. */
export function defaultModeState(mode) {
  const base = { count: mode === "cash" ? DEFAULTS.cashCount : DEFAULTS.gppCount, maxPerTeam: DEFAULT_MAX_PER_TEAM, locks: [], includes: [], excludes: [] };
  return mode === "cash" ? base : { ...base, minUnique: DEFAULTS.minUnique, objective: "proj", cptMax: {}, cptMin: {}, flexMax: {}, flexMin: {} };
}

/** A fresh state for one showdown: GPP on screen, both modes at their defaults. */
export function defaultKeyState() {
  return { mode: "gpp", gpp: defaultModeState("gpp"), cash: defaultModeState("cash") };
}

const strList = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" || typeof x === "number").map(String))] : []);
const textOr = (v, fallback) => (typeof v === "string" ? v : fallback);

function cleanTextMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, text] of Object.entries(raw)) if (typeof text === "string" && text.trim() !== "") out[id] = text;
  return out;
}

/** One mode's state as storage gives it back: anything unreadable falls back to the default, never thrown. */
export function cleanModeState(raw, mode) {
  const d = defaultModeState(mode);
  if (!raw || typeof raw !== "object") return d;
  const out = {
    ...d,
    count: textOr(raw.count, d.count),
    maxPerTeam: TEAM_OPTIONS.includes(String(raw.maxPerTeam)) ? String(raw.maxPerTeam) : d.maxPerTeam,
    locks: strList(raw.locks),
    includes: strList(raw.includes),
    excludes: strList(raw.excludes),
  };
  if (mode === "gpp") {
    out.minUnique = textOr(raw.minUnique, d.minUnique);
    out.objective = OBJECTIVES.some((o) => o.value === raw.objective) ? raw.objective : "proj";
    for (const f of CAP_FIELDS) out[f] = cleanTextMap(raw[f]);
  }
  return out;
}

/** A showdown's state as storage gives it back. */
export function cleanKeyState(raw) {
  if (!raw || typeof raw !== "object") return defaultKeyState();
  return { mode: raw.mode === "cash" ? "cash" : "gpp", gpp: cleanModeState(raw.gpp, "gpp"), cash: cleanModeState(raw.cash, "cash") };
}

/** Every showdown's saved state, {key: state}; {} when storage is empty, blocked or unreadable. */
export function readAll(getStorage) {
  try {
    const raw = getStorage().getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {}; // storage blocked or unreadable: the settings last for this page view only
  }
}

/** One showdown's state from storage. */
export function readKeyState(getStorage, key) {
  return cleanKeyState(readAll(getStorage)[key]);
}

/** Saves one showdown's state beside the others; false when storage is blocked (the settings then last for this page view). */
export function writeKeyState(getStorage, key, keyState) {
  try {
    const all = readAll(getStorage);
    all[key] = keyState;
    getStorage().setItem(STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch (e) {
    return false;
  }
}

/** Drops every stored showdown whose key is not in `keepKeys` (🔵 866b0ce B11); resolves the dropped keys. Blocked or unreadable
 *  storage drops nothing. The caller decides what is loaded; an empty `keepKeys` drops nothing (never "none loaded"). */
export function dropStoredKeysExcept(getStorage, keepKeys) {
  const keep = new Set((keepKeys ?? []).map(String));
  if (!keep.size) return [];
  try {
    const all = readAll(getStorage);
    const gone = Object.keys(all).filter((k) => !keep.has(k));
    if (!gone.length) return [];
    for (const k of gone) delete all[k];
    getStorage().setItem(STORAGE_KEY, JSON.stringify(all));
    return gone;
  } catch (e) {
    return []; // storage blocked: nothing can be tidied this page view, and nothing is lost
  }
}

// ---------- the board's ids ----------

/** Lookups over the board rows: person id for a FLEX id or a Captain id, and each candidate id's {person, role}. */
export function boardIndex(board) {
  const personOf = new Map();
  const candOf = new Map();
  const rowOf = new Map();
  for (const r of board?.rows ?? []) {
    if (!r || r.id == null) continue;
    const person = String(r.id);
    rowOf.set(person, r);
    personOf.set(person, person);
    candOf.set(person, { person, role: "FLEX" });
    if (r.cptId != null && String(r.cptId) !== "") {
      personOf.set(String(r.cptId), person);
      candOf.set(String(r.cptId), { person, role: "CPT" });
    }
  }
  return { personOf, candOf, rowOf };
}

/** The mode state with every id the board no longer has dropped (classic validateAgainstBoard's rule: a stale id never survives). */
export function pruneToBoard(ms, board, mode) {
  const { candOf, rowOf } = boardIndex(board);
  if (!rowOf.size) return ms;
  const out = { ...ms, locks: ms.locks.filter((id) => candOf.has(id)), excludes: ms.excludes.filter((id) => candOf.has(id)), includes: ms.includes.filter((id) => rowOf.has(id)) };
  if (mode === "gpp") for (const f of CAP_FIELDS) out[f] = Object.fromEntries(Object.entries(ms[f] ?? {}).filter(([id]) => rowOf.has(id)));
  return out;
}

// ---------- the pool rows' lock / In / exclude ----------

const cptIdOf = (row) => (row?.cptId == null ? null : String(row.cptId));
const candIdOf = (row, kind) => (kind === "cpt" ? cptIdOf(row) : String(row.id));

/** Whether this list's row is locked in its own role (the Captain list's lock is his Captain id, the FLEX list's his FLEX id). */
export function isLocked(ms, row, kind) {
  const id = candIdOf(row, kind);
  return id !== null && ms.locks.includes(id);
}

export function isIncluded(ms, row) {
  return ms.includes.includes(String(row.id));
}

/** {on, whole}: whether this list's row is excluded, and whether the man is out of every lineup (excluded by his FLEX id). */
export function excludeState(ms, row, kind) {
  const whole = ms.excludes.includes(String(row.id));
  const cpt = cptIdOf(row);
  return { on: whole || (kind === "cpt" && cpt !== null && ms.excludes.includes(cpt)), whole };
}

/** Lock or unlock this list's row in its role. A lineup has one Captain, so a new Captain lock replaces the last; a man fills one
 *  spot, so his lock in the other role goes. A man out of every lineup cannot be locked (the button is off); his Captain exclude goes with a Captain lock. */
export function toggleLock(ms, row, kind, board) {
  const id = candIdOf(row, kind);
  if (id === null || excludeState(ms, row, kind).whole) return ms;
  if (ms.locks.includes(id)) return { ...ms, locks: ms.locks.filter((x) => x !== id) };
  const { candOf } = boardIndex(board); // a Captain id is told from a FLEX id by the board, never by its shape
  const other = kind === "cpt" ? String(row.id) : cptIdOf(row);
  let locks = ms.locks.filter((x) => x !== other);
  if (kind === "cpt") locks = locks.filter((x) => candOf.get(x)?.role !== "CPT");
  const cpt = cptIdOf(row);
  return { ...ms, locks: [...locks, id], excludes: kind === "cpt" ? ms.excludes.filter((x) => x !== cpt) : ms.excludes };
}

/** Include or drop him (any role); a man out of every lineup cannot be included. */
export function toggleInclude(ms, row) {
  const id = String(row.id);
  if (ms.includes.includes(id)) return { ...ms, includes: ms.includes.filter((x) => x !== id) };
  if (excludeState(ms, row, "flex").whole) return ms;
  return { ...ms, includes: [...ms.includes, id] };
}

/** Exclude or restore this list's row. The FLEX list's exclude takes the man out of every lineup (his locks and his include go);
 *  the Captain list's only his Captain spot (his Captain lock goes). With the man out of every lineup the Captain list's button is off. */
export function toggleExclude(ms, row, kind) {
  const id = String(row.id);
  const cpt = cptIdOf(row);
  if (kind === "cpt") {
    if (cpt === null || ms.excludes.includes(id)) return ms;
    if (ms.excludes.includes(cpt)) return { ...ms, excludes: ms.excludes.filter((x) => x !== cpt) };
    return { ...ms, excludes: [...ms.excludes, cpt], locks: ms.locks.filter((x) => x !== cpt) };
  }
  if (ms.excludes.includes(id)) return { ...ms, excludes: ms.excludes.filter((x) => x !== id) };
  return { ...ms, excludes: [...ms.excludes.filter((x) => x !== cpt), id], locks: ms.locks.filter((x) => x !== id && x !== cpt), includes: ms.includes.filter((x) => x !== id) };
}

/** The line under the heading: "2 included: Jayden Daniels, Brock Purdy · 1 locked: George Kittle" (a Captain lock reads
 *  "Brock Purdy (CPT)"); "" when nobody is included or locked. */
export function statusLineText(ms, board) {
  const { candOf, rowOf } = boardIndex(board);
  const nameOf = (person) => rowOf.get(person)?.name ?? person;
  const parts = [];
  const inc = ms.includes.filter((id) => rowOf.has(id));
  if (inc.length) parts.push(`${inc.length} included: ${inc.map(nameOf).join(", ")}`);
  const locks = ms.locks.filter((id) => candOf.has(id)).map((id) => { const c = candOf.get(id); return `${nameOf(c.person)}${c.role === "CPT" ? " (CPT)" : ""}`; });
  if (locks.length) parts.push(`${locks.length} locked: ${locks.join(", ")}`);
  return parts.join(" · ");
}

// ---------- the request ----------

/** The objective a GPP build uses: Adam's pick, except Median and Ceiling, which need TwoGun's figures (TwoGun mode): in Our
 *  sources they are greyed and the build is by projection (classic effectiveObjective's rule). */
export function effectiveObjective(picked, boardMode) {
  if (picked === "median" || picked === "ceil") return boardMode === "twogun" ? picked : "proj";
  return "proj";
}

/** {id: {pct}} for the boxes holding a percent; `positiveOnly` (the Min % boxes) leaves out a 0, as classic does. */
function pctsOf(map, positiveOnly) {
  const out = {};
  for (const [id, text] of Object.entries(map ?? {})) {
    const pct = parsePct(text);
    if (pct === null || Number.isNaN(pct) || (positiveOnly && !(pct > 0))) continue;
    out[String(id)] = { pct };
  }
  return out;
}

const CAP_KEYS = Object.freeze([
  { field: "cptMax", key: "captainMaxExposure", role: "Captain", word: "Max %", none: "no cap", positiveOnly: false },
  { field: "cptMin", key: "captainMinExposure", role: "Captain", word: "Min %", none: "none", positiveOnly: true },
  { field: "flexMax", key: "flexMaxExposure", role: "FLEX", word: "Max %", none: "no cap", positiveOnly: false },
  { field: "flexMin", key: "flexMinExposure", role: "FLEX", word: "Min %", none: "none", positiveOnly: true },
]);

/** The first Max % or Min % box that is neither blank nor a percent from 0 to 100, as classic's sentence (lineup.js
 *  playerMaxProblem) naming the man and the role, else null; it blocks Make, as in classic. Cash has no boxes. */
export function capProblem(ms, mode, board) {
  if (mode !== "gpp") return null;
  const { rowOf } = boardIndex(board);
  for (const c of CAP_KEYS) {
    for (const [id, text] of Object.entries(ms[c.field] ?? {})) {
      if (Number.isNaN(parsePct(text))) return `${rowOf.get(id)?.name ?? id}'s ${c.role} ${c.word} must be a percent from 0 to 100, or blank for ${c.none}.`;
    }
  }
  return null;
}

/** The lineup count sent for the count box's text: blank is the mode's default, past 150 is 150. */
export function requestCount(text, mode) {
  return parseWhole(text, 1, MAX_COUNT, Number(mode === "cash" ? DEFAULTS.cashCount : DEFAULTS.gppCount));
}

/** settings for the generate route. GPP: count, minUnique, locks, excludes, objective, maxPerTeam, mode and the four Max % / Min %
 *  maps, each always sent ({} when no box holds a percent, as the spec's body has them; 🔵 866b0ce B6). Cash: count, locks,
 *  excludes, maxPerTeam and mode only (the server refuses the GPP-only settings in
 *  cash with classic's sentences). includes only when someone is included (the engine's key is new, so an empty list is never
 *  sent; the server's sentence is shown when it refuses it). */
export function buildSettings(ms, mode, boardMode) {
  const cash = mode === "cash";
  const settings = {
    count: requestCount(ms.count, mode),
    locks: [...ms.locks],
    excludes: [...ms.excludes],
    maxPerTeam: Number(TEAM_OPTIONS.includes(String(ms.maxPerTeam)) ? ms.maxPerTeam : DEFAULT_MAX_PER_TEAM),
    mode: cash ? "cash" : "gpp",
  };
  if (!cash) {
    settings.minUnique = parseWhole(ms.minUnique, 1, MAX_UNIQUE, Number(DEFAULTS.minUnique));
    settings.objective = effectiveObjective(ms.objective, boardMode);
    for (const c of CAP_KEYS) settings[c.key] = pctsOf(ms[c.field], c.positiveOnly);
  }
  if (ms.includes.length) settings.includes = [...ms.includes];
  return settings;
}

/** The whole body: {settings, boardMode}; boardMode is the Figures switch's ("twogun" or "current"). */
export function buildGenerateBody(ms, mode, boardMode) {
  return { settings: buildSettings(ms, mode, boardMode), boardMode: boardMode === "twogun" ? "twogun" : "current" };
}

const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? "" : "s"}`;
const OBJECTIVE_WORD = { proj: "projection", median: "median", ceil: "ceiling" };

/** The basis a cash build is made by, as the server picks it (server/lineup/cash.js cashBasis): TwoGun's median in TwoGun mode, else the projection. */
export function cashBasisText(boardMode) {
  return boardMode === "twogun" ? "TwoGun's median" : "Projection";
}

/** The one-line summary beside Make (classic optSummaryText): "20 lineups by projection, 2 unique players between any two · max 4
 *  per team · caps on 3 players"; cash "1 lineup by TwoGun's median · max 5 per team". */
export function summaryText(ms, mode, boardMode) {
  const s = buildSettings(ms, mode, boardMode);
  if (mode === "cash") return `${plural(s.count, "lineup")} by ${cashBasisText(boardMode).replace(/^Projection$/, "projection")} · max ${s.maxPerTeam} per team`;
  const parts = [`${plural(s.count, "lineup")} by ${OBJECTIVE_WORD[s.objective]}${s.count === 1 ? "" : `, ${plural(s.minUnique, "unique player")} between any two`}`];
  parts.push(`max ${s.maxPerTeam} per team`);
  const capped = new Set(CAP_KEYS.flatMap((c) => Object.keys(s[c.key] ?? {})));
  if (capped.size) parts.push(`caps on ${plural(capped.size, "player")}`);
  return parts.join(" · ");
}

// ---------- the answer ----------

/** A lineup's Captain-aware set key from its slots ([{slot, playerId}], ids of either role): the same six men under another
 *  Captain are another lineup (server/showdown/lineup-checks.js showdownLineupKey). */
export function sdSetKey(slots, personOf) {
  const person = (id) => personOf?.get(String(id)) ?? String(id);
  const cpt = (slots ?? []).filter((s) => String(s?.slot ?? "").toUpperCase() === "CPT").map((s) => person(s.playerId));
  const flex = (slots ?? []).filter((s) => String(s?.slot ?? "").toUpperCase() !== "CPT").map((s) => person(s.playerId)).sort();
  return `${cpt.join(",")}|${flex.join(",")}`;
}

/** The Captain table and the FLEX table over a set of lineups (the cards on screen), never summed: each man's count and percent
 *  (one decimal, as the server's) in that role, his ownership in that role as the lineups carry it. Rows {person, name, count, pct, own}. */
export function exposureTables(lineups) {
  const list = (lineups ?? []).filter((l) => Array.isArray(l?.slots) && l.slots.length);
  const tables = { cpt: new Map(), flex: new Map() };
  for (const l of list) {
    for (const s of l.slots) {
      const role = s.slot === "CPT" ? "cpt" : "flex";
      const person = String(s.personId ?? s.playerId);
      const hit = tables[role].get(person);
      if (hit) hit.count++;
      else tables[role].set(person, { person, name: s.name ?? person, count: 1, own: s.own ?? null });
    }
  }
  const pct = (n) => (list.length ? Math.round((n / list.length) * 1000) / 10 : 0);
  const rows = (m) => [...m.values()].map((r) => ({ ...r, pct: pct(r.count) }));
  return { cpt: rows(tables.cpt), flex: rows(tables.flex) };
}

/** The Min / Max marks of a batch in role-aware keys ("cpt:<id>", "flex:<id>"), from the settings it was made with (lineup-exposure.js exposureMark). */
export function exposureMarks(settings) {
  const marks = { asked: settings?.count ?? 0, min: {}, max: {} };
  const put = (map, role, into) => { for (const [id, v] of Object.entries(map ?? {})) into[`${role}:${id}`] = v.pct; };
  put(settings?.captainMinExposure, "cpt", marks.min);
  put(settings?.flexMinExposure, "flex", marks.min);
  put(settings?.captainMaxExposure, "cpt", marks.max);
  put(settings?.flexMaxExposure, "flex", marks.max);
  return marks;
}
