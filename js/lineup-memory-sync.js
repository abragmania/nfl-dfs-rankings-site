// The classic Optimizer's side of the browser's memory (memory.js, optimizer standard A9, round 5), moved out of lineup.js: what is written as the lineup and the settings change, and what is read back when the
// slate on screen changes. Everything remembered is per slate (the season, week and main or second slate: memory.js classicMemoryKey): the settings (lineups to make, the caps, the rules, Max per team, the
// default stack, the avoided games of GPP and of Cash, the exposure table's sort and filter) and, apart for GPP and for Cash, the working lineup (the nine slots, the locks and the excludes). A slate that
// has nothing remembered starts from the defaults, so a new week builds at once (C12) and a cap set last week is not this week's. A man who is gone or off the slate on screen is dropped and NAMED, never
// replaced; a loaded saved lineup, an open confirm and the Undo of Cash's Make them Must belong to the slate they were made on and go with it. Storage that is blocked or damaged only loses the convenience.
// This module reads and writes lineup.js's `state` and `opt` (lineup.js imports it back: the two are one cycle, used only at call time).
import { store, activeSlateRows, activeSlateGames } from "./state.js";
import { readMemory, updateMemory, slateEntry, classicMemoryKey, goneSentence, restoreClassicLineup, storableClassicLineup, setOnScreen } from "./memory.js";
import { settingsToStore, cleanSettings, avoidOnSlate } from "./lineup-memory.js";
import { COUNT_DEFAULTS_VERSION, CASH_DEFAULTS_BROWSER, countAfterDefaultsChange, cleanCashState } from "./lineup-cash.js";
import { cleanSavedEntries } from "./lineup-qb-stacks.js";
import { defaultExpState } from "./lineup-exposure.js";
import { ruleOn } from "./lineup-settings.js";
import { rowIsOut } from "./table.js";
import { slateKeyOf } from "./lineup-optimizer.js";
import { state, opt, LINEUP_SLOTS, OPT_RULES, OPT_DEFAULT_COUNT, OPT_DEFAULT_UNIQUE, OPT_DEFAULT_STACK, MAX_TEAM_OPTIONS, OPT_STACK_OWN_MAX, OPT_STACK_OPP_MAX, clearLoaded } from "./lineup.js";

let memoryKey = null; // the slate the working lineup and the settings on screen belong to (memory.js classicMemoryKey)
let legacyPending = null; // the lineups an older browser kept in lineup.js's own storage key, {gpp, cash}: waiting for the main slate (see migrateLegacyLineups)

/** The slate the memory is on now, or null before the first draw. */
export const currentMemoryKey = () => memoryKey;

/** The settings a slate with nothing remembered starts from (the page's own starting values). */
export function defaultSettings() {
  return {
    count: String(OPT_DEFAULT_COUNT),
    minUnique: String(OPT_DEFAULT_UNIQUE),
    maxExp: { QB: "", RB: "", WR: "", TE: "", DST: "" },
    rules: Object.fromEntries(OPT_RULES.map((r) => [r.key, ruleOn({}, r.key)])), // Starred QBs only starts off (C12); the others on
    maxPerTeam: "",
    ...OPT_DEFAULT_STACK,
    spreadDst: false,
    avoid: [],
    cashAvoid: [],
    cashCount: CASH_DEFAULTS_BROWSER.count,
    cashMaxPerTeam: CASH_DEFAULTS_BROWSER.maxPerTeam,
    qb: {},
    exp: defaultExpState("classic"),
  };
}

const limits = () => ({ ruleKeys: OPT_RULES.map((r) => r.key), teamOptions: MAX_TEAM_OPTIONS, stackOwnMax: OPT_STACK_OWN_MAX, stackOppMax: OPT_STACK_OPP_MAX, cleanQb: cleanSavedEntries });

/** The settings on screen, as stored. */
export const currentSettings = () => ({ ...settingsToStore(opt), countsV: COUNT_DEFAULTS_VERSION });

/** Puts remembered settings (`raw`, whatever the memory held for the slate, or nothing) on screen over the defaults; the avoided games are the ones that are games of `board`'s slate on screen. */
export function applySettings(raw, board) {
  const s = cleanSettings(raw, defaultSettings(), limits());
  const gameIds = new Set(activeSlateGames(board).map((g) => String(g.id)));
  Object.assign(opt, {
    count: countAfterDefaultsChange(s.count, raw?.countsV ?? null),
    minUnique: s.minUnique,
    maxExp: s.maxExp,
    rules: s.rules,
    maxPerTeam: s.maxPerTeam,
    stackOwn: s.stackOwn,
    stackOwnOrMore: s.stackOwnOrMore,
    stackOpp: s.stackOpp,
    stackOppOrMore: s.stackOppOrMore,
    spreadDst: s.spreadDst,
    exp: s.exp,
  });
  opt.avoid = new Set(avoidOnSlate(s.avoid, gameIds));
  opt.cash.avoid = avoidOnSlate(s.cashAvoid, gameIds);
  opt.cash.count = countAfterDefaultsChange(s.cashCount, raw?.countsV ?? null); // Cash's count and Max per team are the slate's too (the Want lists stay per slate in their own key)
  opt.cash.maxPerTeam = s.cashMaxPerTeam;
  opt.qb.entries = s.qb; // and so are the per-QB stack panels: a QB on both slates does not carry main's panel to the afternoon
}

/** A man's name from the board (any slate) or, when the board no longer has him, from what was remembered before. */
function namer(board, remembered) {
  const rows = new Map((board?.rows ?? []).map((r) => [String(r.id), r.name ?? ""]));
  const before = new Map();
  for (const raw of Object.values(remembered?.lineups ?? {})) {
    for (const s of raw?.slots ?? []) if (s && s.id != null && s.name) before.set(String(s.id), s.name);
    for (const [id, name] of Object.entries(raw?.names ?? {})) if (name) before.set(String(id), name);
  }
  return (id) => rows.get(id) || before.get(id) || "";
}

/** Writes the settings and the working lineup of the mode on screen under the slate on screen. Never throws; blocked storage is only a lost convenience. Returns whether it was written (false: nothing to write
 *  under, storage blocked, or the browser refused it, so the memory may be behind what is on screen). */
export function saveClassicMemory() {
  const board = store.get().board;
  if (!board || memoryKey === null) return false;
  const key = memoryKey;
  const mode = opt.mode;
  return updateMemory((m) => {
    const entry = slateEntry(m, "classic", key);
    const nameOf = namer(board, entry);
    entry.lineups = { ...(entry.lineups ?? {}), [mode]: storableClassicLineup(state.slots, state.locks, state.excludes, nameOf) };
    entry.settings = currentSettings();
  });
}

/** The lineup a mode remembers for `board`'s slate on screen, put in `state`; the sentence naming who was dropped (gone from the board, or off this slate) and who is listed out. Returns the sentence. */
export function restoreModeLineup(board, entry, mode) {
  const rows = activeSlateRows(board);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const got = restoreClassicLineup(entry?.lineups?.[mode], (id) => byId.has(id), LINEUP_SLOTS.length, { slotlessLocks: mode === "cash" });
  state.slots = got.slots.map((id, i) => (id ? { id, slot: LINEUP_SLOTS[i] } : null));
  state.locks = new Set(got.locks);
  state.excludes = new Set(got.excludes);
  const out = [...new Set([...got.slots, ...got.locks])].filter((id) => id && rowIsOut(byId.get(id))).map((id) => byId.get(id).name);
  const outText = out.length ? `${out.join(", ")} ${out.length === 1 ? "is" : "are"} listed out but ${out.length === 1 ? "is" : "are"} still in your remembered lineup; Build holds ${out.length === 1 ? "him" : "them"} only as the rules already do.` : "";
  const unlocked = got.unlocked.map((n) => n ?? "a man");
  const unlockedText = unlocked.length ? `${unlocked.join(", ")} had a lock but no slot in your remembered lineup, so the lock was dropped.` : "";
  return [goneSentence(got.gone, "this slate"), unlockedText, outText].filter(Boolean).join(" ");
}

/**
 * The mode switch's lineup: the build the new mode remembered for this slate comes back (the same restore as a reload). Called by setMode after the outgoing mode's lineup was written; `wrote` says it was.
 * When the write was refused (the quota, blocked storage) the memory may be behind this page, so the page-only copy the switch just made (the stash) is used instead and nothing is read; the same when
 * nothing is remembered for the mode. Returns the restore's sentence ("" when the stash was used).
 */
export function restoreForMode(board, mode, wrote = true) {
  if (!wrote) return "";
  const entry = readMemory().classic?.slates?.[memoryKey];
  if (!entry?.lineups?.[mode]) return "";
  return restoreModeLineup(board, entry, mode);
}

/**
 * What an older browser kept in lineup.js's own storage key and now belongs to the slate: its one global lineup of the mode on screen and the other mode's in `stash`, and the settings that key held for every
 * slate at once (Spread defenses, Cash's avoided games, Cash's count and Max per team, the per-QB stack panels). Written once into the memory under `legacy` ({lineups, settings}), so a page opened on a second
 * slate first does not lose the main slate's: the first main slate drawn takes them (syncLineupMemory). `persisted` is that key's parsed object; nothing happens when there is nothing to carry.
 */
export function migrateLegacyLineups(persisted) {
  if (!persisted || typeof persisted !== "object") return;
  const mode = persisted.mode === "cash" ? "cash" : "gpp";
  const other = mode === "cash" ? "gpp" : "cash";
  const pack = (src) => (Array.isArray(src?.slots) && src.slots.some(Boolean) ? { slots: src.slots.map((s) => (s && s.id != null ? { id: String(s.id), name: "" } : null)), locks: Array.isArray(src.locks) ? src.locks.map(String) : [], excludes: Array.isArray(src.excludes) ? src.excludes.map(String) : [] } : null);
  const lineups = {};
  const active = pack(persisted);
  const stashed = pack(persisted.stash?.[other]);
  if (active) lineups[mode] = active;
  if (stashed) lineups[other] = stashed;
  const cash = cleanCashState(persisted.cash, persisted.countsV ?? null);
  const settings = {};
  if (persisted.spreadDst === true) settings.spreadDst = true;
  if (cash.avoid.length) settings.cashAvoid = cash.avoid;
  if (cash.count !== CASH_DEFAULTS_BROWSER.count) settings.cashCount = cash.count;
  if (cash.maxPerTeam !== CASH_DEFAULTS_BROWSER.maxPerTeam) settings.cashMaxPerTeam = cash.maxPerTeam;
  const qb = cleanSavedEntries(persisted.qbStacks, OPT_STACK_OWN_MAX, OPT_STACK_OPP_MAX);
  if (Object.keys(qb).length) settings.qb = qb;
  const legacy = {};
  if (Object.keys(lineups).length) legacy.lineups = lineups;
  if (Object.keys(settings).length) legacy.settings = { ...settings, countsV: COUNT_DEFAULTS_VERSION }; // the count above is already read through the count-defaults change
  if (!Object.keys(legacy).length) return;
  legacyPending = legacy;
  updateMemory((m) => { m.classic.legacy ??= legacy; });
}

/** The legacy lineups and settings still waiting (the memory's, else this page's own copy), or null. */
function legacyData() {
  return readMemory().classic?.legacy ?? legacyPending;
}

/**
 * The slate on screen is not the one drawn last: its remembered settings and lineup replace the page's (or the defaults, for a slate with nothing remembered). A loaded saved lineup and its name, an open
 * confirm, the Undo of Make them Must and the page-only copy of the other mode's build belong to the slate they were made on and are dropped, so Save never writes one slate's men over another's saved
 * lineup. The first main slate drawn takes the lineups an older browser kept. Returns whether it changed the slate.
 */
export function syncLineupMemory(board) {
  if (!board) return false;
  const key = classicMemoryKey(board, slateKeyOf(board));
  if (key === memoryKey) return false;
  memoryKey = key;
  setOnScreen("classic", key); // a full quota never drops the slate he is on
  let entry = readMemory().classic?.slates?.[key];
  const legacy = slateKeyOf(board) === "main" && !entry?.lineups && !entry?.settings ? legacyData() : null;
  if (legacy) entry = { ...(entry ?? {}), ...(legacy.lineups ? { lineups: legacy.lineups } : {}), ...(legacy.settings ? { settings: legacy.settings } : {}) };
  applySettings(entry?.settings, board);
  state.memoryNote = restoreModeLineup(board, entry, opt.mode);
  clearLoaded();
  state.confirm = null;
  opt.cashUndo = null;
  opt.stash = {};
  if (legacy) {
    legacyPending = null;
    updateMemory((m) => {
      const taken = slateEntry(m, "classic", key);
      if (legacy.lineups) taken.lineups = legacy.lineups;
      if (legacy.settings) taken.settings = legacy.settings;
      delete m.classic.legacy;
    });
  }
  return true;
}

/** Names the men a new board for the same slate (a re-upload, a refresh) took away: the sentence, "" when nobody. `before` is the board they were on; the memory's names fill what it no longer has. */
export function droppedMenSentence(ids, before) {
  if (!ids.length) return "";
  const entry = memoryKey ? readMemory().classic?.slates?.[memoryKey] : null;
  const nameOf = namer(before, entry);
  return goneSentence(ids.map((id) => nameOf(id) || null), "this board");
}
