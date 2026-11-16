// The Entries tab on the public site (RULES.md D71: the site does everything the app does; D55, D56, D75): GET /api/entries, POST
// /api/entries/upload and POST /api/entries/export, and the three Showdown ones, done in the visitor's browser. tools/publish.mjs copies
// this file to out/js/site-entries.js and the checks it imports, unchanged, to out/server/ (the same relative paths as here).
//
// The visitor's DraftKings entries file is kept only in this browser, as text, one localStorage entry per slate (classic: the week's main
// slate and any second slate; Showdown: the game), never sent anywhere (D69). Browser storage can be missing, switched off or full: every
// access is guarded, a write that fails is a plain refusal, a read that fails is "no file". `storage` is passed in (the page's
// localStorage, or a test double); null means unavailable.
//
// The reading, the slate or game match, the checks on every assignment and the written file are the routes' own pure code
// (server/lineup/dk-entries.js, dk-showdown-entries.js, server/entries/plan.js, showdown-plan.js), so the app and the site read, refuse
// and write the same bytes. Download returns the uploaded text with only the assigned rows' player cells replaced (buildUpload's own
// byte-for-byte self-check runs). The lock is the earliest kickoff stored with the published slate (D13, D30); `nowMs` is the clock,
// read once by the caller for the after-lock refusal (D55). The lineups offered are the ones passed in: the app's baked lineups and
// this device's (the Lineups tab's own list).
import { parseEntriesCsv, buildUpload } from "../server/lineup/dk-entries.js";
import { parseShowdownEntriesCsv, buildShowdownUpload } from "../server/lineup/dk-showdown-entries.js";
import { detectSlate, planExport, entriesSummary, notReadText, fileStamp, weekTag, uploadFileName, downloadFileName, isPlainObject } from "../server/entries/plan.js";
import {
  matchShowdownGame, gameSummary, planShowdownExport, filePrefix, uploadFileName as showdownUploadFileName, downloadFileName as showdownDownloadFileName
} from "../server/entries/showdown-plan.js";
import { lineupRows } from "../server/showdown/lineup-rows.js";
import { WEEK_UNKNOWN_MESSAGE } from "../server/showdown/lineup-checks.js";
import { tabOfMode } from "../server/showdown/override-tabs.js";
import { validateLineupTag, applyLineupPatch, releaseLineupTag } from "../server/lineups/validate.js";
import { readKey, writeKey, appLetterHolder, letterTakenMessage } from "./site-lineups.js";

export const ENTRIES_STORAGE_PREFIX = "nfldfs-site-entries:";
export const ENTRIES_STORAGE_MESSAGE = "This browser is not letting the site keep your entries file (storage is switched off or full), so it was not loaded.";
const NOT_PLAIN_UTF8 = "The entries file is not plain UTF-8 text, so it cannot be returned byte for byte; export it from DraftKings again.";

// The route's response envelope (server.js envelope / errorBody, and refusal() in server/entries/files.js): the answer a page reads.
const answer = (body, stale = []) => ({ ok: true, generatedAt: new Date().toISOString(), stale, ...body });
function refuse(code, messages, extra = {}, stale = []) {
  const list = [].concat(messages);
  return { ok: false, generatedAt: new Date().toISOString(), stale, error: { code, message: list.join(" "), errors: list }, ...extra };
}

const classicKey = (season, week, slateKey) => `${ENTRIES_STORAGE_PREFIX}classic:${weekTag(season, week)}:${slateKey}`;
const showdownKey = (key) => `${ENTRIES_STORAGE_PREFIX}showdown:${key}`;

/** The stored upload at `key`: { record: { file, text } } | { record: null } (nothing there) | { unreadable: true } (there, but not readable). Never throws. */
function readStored(storage, key) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    return { unreadable: true };
  }
  if (raw === null || raw === undefined || raw === "") return { record: null };
  try {
    const rec = JSON.parse(raw);
    return typeof rec?.file === "string" && typeof rec?.text === "string" ? { record: { file: rec.file, text: rec.text } } : { unreadable: true };
  } catch {
    return { unreadable: true };
  }
}

/** Keeps `text` as the upload `file` at `key`. true, or false when the browser refused. */
function writeStored(storage, key, file, text) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ file, text }));
    return true;
  } catch {
    return false;
  }
}

/**
 * After an upload is kept: the entries files this browser holds for any week other than `tag` ("2026-w07") are removed, classic and Showdown alike (the room is shared with
 * the device lineups, the typed numbers and the weights, which would fail first when it ran out). Returns the sentence saying how many went, or null when none did (G62).
 */
function clearOtherWeeks(storage, tag) {
  const old = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (typeof k !== "string") continue;
      const m = k.startsWith(ENTRIES_STORAGE_PREFIX) ? /^(?:classic|showdown):(\d{4}-w\d{2})[:-]/.exec(k.slice(ENTRIES_STORAGE_PREFIX.length)) : null;
      if (m && m[1] !== tag) old.push(k);
    }
  } catch {
    return null;
  }
  let removed = 0;
  for (const k of old) {
    try {
      storage.removeItem(k);
      removed += 1;
    } catch { /* kept; not counted */ }
  }
  return removed ? `Removed ${removed} entries file${removed === 1 ? "" : "s"} kept from earlier weeks, to leave room in this browser.` : null;
}

/** This week's classic storage keys (every slate): main first, then by slate key as the app lists them; null when storage cannot be listed. */
function classicKeys(storage, season, week) {
  const prefix = `${ENTRIES_STORAGE_PREFIX}classic:${weekTag(season, week)}:`;
  const found = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (typeof k === "string" && k.startsWith(prefix)) found.push({ key: k, slateKey: k.slice(prefix.length) });
    }
  } catch {
    return null;
  }
  return found.sort((a, b) => (a.slateKey === "main" ? -1 : b.slateKey === "main" ? 1 : a.slateKey < b.slateKey ? -1 : 1));
}

const slateSummary = (slate) => (slate && !slate.error ? { key: slate.key, label: slate.label, matched: slate.matched, total: slate.total } : null);
const unreadableEntry = (file) => ({ file, slate: null, entries: [], error: "The entries file kept in this browser could not be read; upload it again." });
const hasText = (v) => typeof v === "string" && v.trim() !== "";
// A file whose text holds U+FFFD was not plain UTF-8 when the browser read it, so it could not come back byte for byte (the app's stored-upload read says the same).
const notPlainUtf8 = (text) => text.includes("�");

/** The published slate as the app's loaded slate: the baked board's rows are its players (id, kickoffUtc, name) and baked slate.json carries its games (id, kickoffUtc). */
export function classicFullOf(board, slate) {
  return { season: slate?.season ?? null, week: slate?.week ?? null, players: Array.isArray(board?.rows) ? board.rows : [], games: Array.isArray(slate?.games) ? slate.games : [] };
}

/** True when a saved lineup is Cash, which the export checks on the Cash board's typed numbers (optimizer standard Part F). */
export const hasCashLineup = (lineups) => (lineups ?? []).some((l) => tabOfMode(l?.mode) === "cash");

// ---- Classic ---------------------------------------------------------------------------------------------------------

/** GET /api/entries: the upload kept in this browser for each slate of the week. `full`: classicFullOf; `secondSlates`: the board's slates (dkIds, gameIds). */
export function listClassicEntries({ storage, full, secondSlates = [] }) {
  if (!Number.isInteger(full?.week)) return refuse("NO_WEEK", "The published slate's week is not known, so its entries files cannot be named.");
  if (!storage) return answer({ files: [] });
  const keys = classicKeys(storage, full.season, full.week);
  if (keys === null) return refuse("DEVICE_STORAGE_UNAVAILABLE", ENTRIES_STORAGE_MESSAGE);
  const files = keys.map(({ key }) => {
    const read = readStored(storage, key);
    if (read.unreadable) return unreadableEntry(key.slice(ENTRIES_STORAGE_PREFIX.length));
    if (!read.record) return null;
    const { file, text } = read.record;
    if (notPlainUtf8(text)) return { file, slate: null, entries: [], error: NOT_PLAIN_UTF8 };
    let parsed;
    try {
      parsed = parseEntriesCsv(text);
    } catch (e) {
      return { file, slate: null, entries: [], error: `The entries file ${file} could not be read: ${e.message}` };
    }
    return { file, slate: slateSummary(detectSlate(parsed.pool, full, secondSlates)), entries: entriesSummary(parsed), notRead: notReadText(parsed) };
  }).filter(Boolean);
  return answer({ files });
}

/** POST /api/entries/upload { csv }: reads the file, tells its slate, keeps the text in this browser (the newest of a slate replaces the older). */
export function uploadClassicEntries({ storage, csv, full, secondSlates = [], nowMs }) {
  if (!Number.isInteger(full?.week)) return refuse("NO_WEEK", "The published slate's week is not known, so its entries files cannot be named.");
  if (typeof csv !== "string" || csv.trim() === "") return refuse("VALIDATION_ERROR", "csv must be the text of the DraftKings entries export.");
  if (notPlainUtf8(csv)) return refuse("BAD_ENTRIES_FILE", NOT_PLAIN_UTF8);
  let parsed;
  try {
    parsed = parseEntriesCsv(csv);
  } catch (e) {
    return refuse("BAD_ENTRIES_FILE", e.message);
  }
  if (parsed.entries.length === 0) return refuse("BAD_ENTRIES_FILE", "The entries file has no entry rows.");
  if (parsed.pool.size === 0) return refuse("BAD_ENTRIES_FILE", "The entries file has no player list, so its slate cannot be told.");
  const slate = detectSlate(parsed.pool, full, secondSlates);
  if (slate.error) return refuse("WRONG_SLATE", slate.error);
  const file = uploadFileName(full.season, full.week, slate.key, fileStamp(nowMs));
  if (!writeStored(storage, classicKey(full.season, full.week, slate.key), file, csv)) return refuse("DEVICE_STORAGE_UNAVAILABLE", ENTRIES_STORAGE_MESSAGE);
  const note = clearOtherWeeks(storage, weekTag(full.season, full.week));
  return answer({ file, slate: slateSummary(slate), entries: entriesSummary(parsed), notRead: notReadText(parsed), ...(note ? { note } : {}) });
}

const EXPORT_BODY_KEYS = new Set(["file", "assignments"]);

/** The payload checks both exports make first (the routes' own sentences). Returns a refusal or null. */
function payloadRefusal(b) {
  if (!isPlainObject(b)) return refuse("VALIDATION_ERROR", "The request body must be an object { file, assignments }.");
  const unknown = Object.keys(b).find((k) => !EXPORT_BODY_KEYS.has(k));
  if (unknown !== undefined) return refuse("VALIDATION_ERROR", `Unknown field ${JSON.stringify(unknown)}; send { file, assignments }.`);
  if (!hasText(b.file)) return refuse("VALIDATION_ERROR", "file must name the uploaded entries file (as the entries list shows it).");
  return null;
}

/** The written file as a browser download: { ok, blob, disposition, warnings, stale } (public/js/api.js postEntriesExport's own success shape). */
function download(text, name, warnings, stale) {
  return {
    ok: true,
    blob: new Blob([text], { type: "text/csv; charset=utf-8" }),
    disposition: `attachment; filename="${name}"`,
    warnings: encodeURIComponent(JSON.stringify(warnings)),
    stale: encodeURIComponent(JSON.stringify(stale))
  };
}

const noFileSentence = (file) => `There is no uploaded entries file ${file} in this browser; reload the entries and try again.`;

/**
 * POST /api/entries/export { file, assignments }. `lineups`: the app's baked lineups and this device's; `board`: the published board with this
 * visitor's changes (rows, injuryReport, stale); `cashBoard`: the Cash tab's, needed when hasCashLineup(lineups). Returns the download or the route's refusal.
 */
export function exportClassicEntries({ storage, payload, full, secondSlates = [], lineups, board, cashBoard = null, nowMs }) {
  const bad = payloadRefusal(payload);
  if (bad) return bad;
  if (!Number.isInteger(full?.week)) return refuse("NO_WEEK", "The published slate's week is not known, so its entries files cannot be named.");
  const keys = storage ? classicKeys(storage, full.season, full.week) : [];
  if (keys === null) return refuse("DEVICE_STORAGE_UNAVAILABLE", ENTRIES_STORAGE_MESSAGE);
  let found = null;
  for (const k of keys) {
    const read = readStored(storage, k.key);
    if (read.record?.file === payload.file) found = { ...read.record, slateKey: k.slateKey };
  }
  if (!found) return refuse("NO_ENTRIES", noFileSentence(payload.file));
  if (notPlainUtf8(found.text)) return refuse("ENTRIES_UNREADABLE", NOT_PLAIN_UTF8);
  let parsed;
  try {
    parsed = parseEntriesCsv(found.text);
  } catch (e) {
    return refuse("ENTRIES_UNREADABLE", `The entries file ${found.file} could not be read: ${e.message}`);
  }
  const slate = detectSlate(parsed.pool, full, secondSlates);
  if (slate.error) return refuse("WRONG_SLATE", slate.error);
  if (slate.key !== found.slateKey) {
    return refuse("WRONG_SLATE", `${found.file} was uploaded for the ${found.slateKey} slate but its players now match the ${slate.label}; upload it again.`);
  }
  const stale = Array.isArray(board?.stale) ? board.stale : [];
  const plan = planExport({
    parsed, full, slate, savedLineups: lineups, boardRows: board?.rows, cashBoardRows: cashBoard?.rows ?? null, injuryReport: board?.injuryReport, assignments: payload.assignments, nowMs
  });
  if (plan.locked) return refuse("LOCKED", plan.error, {}, stale);
  if (plan.errors.length) return refuse("EXPORT_REFUSED", plan.errors, { warnings: plan.warnings }, stale);
  let text;
  try {
    text = buildUpload(parsed, null, null, { byEntry: plan.byEntry }); // runs its own byte-for-byte self-check
  } catch (e) {
    return refuse("UPLOAD_CHECK_FAILED", e.message, {}, stale);
  }
  return download(text, downloadFileName(fileStamp(nowMs)), plan.warnings, stale);
}

// ---- Showdown --------------------------------------------------------------------------------------------------------

/** A published Showdown game's slate as the app's saved slate: the baked board's rows are its players (id, cptId) and board.game its one game (kickoffUtc, the lock). */
export function showdownSlateOf(board) {
  const g = board?.game ?? {};
  return {
    season: board?.slate?.season ?? null,
    week: board?.slate?.week ?? null,
    players: Array.isArray(board?.rows) ? board.rows : [],
    games: [{ id: g.gameId ?? null, away: g.away ?? null, home: g.home ?? null, kickoffEt: g.kickoffEt ?? null, kickoffUtc: g.kickoffUtc ?? null }]
  };
}

const weekUnknown = (slate, key) => (!Number.isInteger(slate?.week) || !filePrefix(key) ? refuse("VALIDATION_ERROR", WEEK_UNKNOWN_MESSAGE) : null);

/** GET /api/showdown/<key>/entries: the upload kept in this browser for the game (a list of one, or none). */
export function listShowdownEntries({ storage, key, slate }) {
  const unknown = weekUnknown(slate, key);
  if (unknown) return unknown;
  if (!storage) return answer({ files: [] });
  const read = readStored(storage, showdownKey(key));
  if (read.unreadable) return answer({ files: [unreadableEntry(`showdown:${key}`)] });
  if (!read.record) return answer({ files: [] });
  const { file, text } = read.record;
  if (notPlainUtf8(text)) return answer({ files: [{ file, slate: null, entries: [], error: NOT_PLAIN_UTF8 }] });
  let parsed;
  try {
    parsed = parseShowdownEntriesCsv(text);
  } catch (e) {
    return answer({ files: [{ file, slate: null, entries: [], error: `The entries file ${file} could not be read: ${e.message}` }] });
  }
  const game = matchShowdownGame(parsed.pool, [{ key, slate }]);
  return answer({ files: [{ file, slate: gameSummary(game), entries: entriesSummary(parsed), notRead: notReadText(parsed) }] });
}

/**
 * POST /api/showdown/entries/upload { csv }: the file's ids (FLEX and Captain) are matched against every published Showdown game; the text is kept in
 * this browser for the game it belongs to. `games`: [{ key, slate }] (showdownSlateOf of each readable baked board); `unread`: the keys of published games whose board
 * could not be read, named in a refusal so a game that could not be checked is never mistaken for one that does not match (G62).
 */
export function uploadShowdownEntries({ storage, csv, games, unread = [], nowMs }) {
  if (typeof csv !== "string" || csv.trim() === "") return refuse("VALIDATION_ERROR", "csv must be the text of the DraftKings Showdown entries export.");
  if (notPlainUtf8(csv)) return refuse("BAD_ENTRIES_FILE", NOT_PLAIN_UTF8);
  let parsed;
  try {
    parsed = parseShowdownEntriesCsv(csv);
  } catch (e) {
    return refuse("BAD_ENTRIES_FILE", e.message);
  }
  if (parsed.entries.length === 0) return refuse("BAD_ENTRIES_FILE", "The entries file has no entry rows.");
  if (parsed.pool.size === 0) return refuse("BAD_ENTRIES_FILE", "The entries file has no player list, so its game cannot be told.");
  const game = matchShowdownGame(parsed.pool, games);
  if (game.error) {
    const note = unread.length ? ` ${unread.length === 1 ? "One published game" : `${unread.length} published games`} could not be read (${unread.join(", ")}), so ${unread.length === 1 ? "it was" : "they were"} not checked.` : "";
    return refuse("WRONG_SLATE", `${game.error}${note}`);
  }
  if (!Number.isInteger(game.slate.week) || !filePrefix(game.key)) return refuse("VALIDATION_ERROR", WEEK_UNKNOWN_MESSAGE);
  const file = showdownUploadFileName(game.key, fileStamp(nowMs));
  if (!writeStored(storage, showdownKey(game.key), file, csv)) return refuse("DEVICE_STORAGE_UNAVAILABLE", ENTRIES_STORAGE_MESSAGE);
  const note = clearOtherWeeks(storage, game.key.slice(0, 8)); // the key's own "2026-w03" (filePrefix has checked its shape)
  return answer({ file, key: game.key, slate: gameSummary(game), entries: entriesSummary(parsed), notRead: notReadText(parsed), ...(note ? { note } : {}) });
}

/**
 * POST /api/showdown/<key>/entries/export { file, assignments }. `slate`: showdownSlateOf(board); `lineups`: the game's baked and device lineups; `board`: the published
 * board with this visitor's changes (rows, injuryReport, stale); `cashBoard`: the Cash tab's, needed when hasCashLineup(lineups).
 */
export function exportShowdownEntries({ storage, key, payload, slate, lineups, board, cashBoard = null, nowMs }) {
  const bad = payloadRefusal(payload);
  if (bad) return bad;
  const unknown = weekUnknown(slate, key);
  if (unknown) return unknown;
  const read = storage ? readStored(storage, showdownKey(key)) : { record: null };
  if (!read.record || read.record.file !== payload.file) return refuse("NO_ENTRIES", noFileSentence(payload.file));
  const { file, text } = read.record;
  if (notPlainUtf8(text)) return refuse("ENTRIES_UNREADABLE", NOT_PLAIN_UTF8);
  let parsed;
  try {
    parsed = parseShowdownEntriesCsv(text);
  } catch (e) {
    return refuse("ENTRIES_UNREADABLE", `The entries file ${file} could not be read: ${e.message}`);
  }
  const game = matchShowdownGame(parsed.pool, [{ key, slate }]);
  if (game.error) return refuse("WRONG_SLATE", game.error);
  const stale = Array.isArray(board?.stale) ? board.stale : [];
  const plan = planShowdownExport({
    parsed, slate, label: game.label, savedLineups: lineups, boardRows: lineupRows(board), cashBoardRows: cashBoard ? lineupRows(cashBoard) : null, injuryReport: board?.injuryReport, assignments: payload.assignments, nowMs
  });
  if (plan.locked) return refuse("LOCKED", plan.error, {}, stale);
  if (plan.errors.length) return refuse("EXPORT_REFUSED", plan.errors, { warnings: plan.warnings }, stale);
  let built;
  try {
    built = buildShowdownUpload(parsed, plan.byEntry); // runs classic's byte-for-byte self-check
  } catch (e) {
    return refuse("UPLOAD_CHECK_FAILED", e.message, {}, stale);
  }
  return download(built, showdownDownloadFileName(key, fileStamp(nowMs)), plan.warnings, stale);
}

// ---- The saved-lineup letter on this device ------------------------------------------------------------------------------

/**
 * PUT /api/showdown/<key>/lineups/<id> { tag } for a lineup saved on this device: the letter is set (null clears it) and any other device lineup of the game
 * holding it loses it, as the route moves a letter (releaseLineupTag). The app's baked lineups are read-only here and keep their letters, so a letter one of them holds is refused
 * with a sentence naming it (`appLineups`: the game's baked lineups).
 * `listKey`: the device list's storage key (site-showdown.js showdownStorageKey). Returns { status: "updated", entry } | { status: "missing" } | { status: "refused" } | { error }.
 */
export function tagShowdownDeviceLineup(storage, listKey, id, tag, appLineups = []) {
  const checked = validateLineupTag(tag);
  if (checked.error) return { error: checked.error };
  if (!storage) return { status: "refused" };
  const list = readKey(storage, listKey);
  const idx = list.findIndex((l) => l.id === id);
  if (idx === -1) return { status: "missing" };
  const taken = appLetterHolder(checked.tag, "main", appLineups);
  if (taken) return { error: letterTakenMessage(checked.tag, taken) };
  const entry = applyLineupPatch(list[idx], { tag: checked.tag });
  const next = [...list];
  next[idx] = entry;
  return writeKey(storage, listKey, releaseLineupTag(next, id)) ? { status: "updated", entry } : { status: "refused" };
}
