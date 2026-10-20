// Showdown Build and Save on the public site (DECISIONS.md D71, D39): POST /api/showdown/<key>/lineup/optimize and
// POST/GET/DELETE /api/showdown/<key>/lineups done in the visitor's browser on the published showdown board.
// tools/publish.mjs copies this file to out/js/site-showdown.js and the engine, unchanged, to out/server/ (the same
// relative paths as here). site-src/showdown-api.js (published as js/showdown/api.js) calls it.
//
// Lineups saved here live only in this browser (this device), one localStorage entry per showdown, never sent anywhere
// and never merged into the app's saved lineups (those stay baked and read-only). Browser storage can be missing,
// switched off or full, and reading it can throw: every access is guarded (site-lineups.js readKey/writeKey), a read
// that fails is "no device lineups", a write that fails is a plain refusal. `storage` is passed in (the page's
// localStorage, or a test double); null means unavailable.
//
// The checks and the saved snapshot are the routes' own (server/showdown/lineup-checks.js, server/lineups/validate.js),
// so the app and the site refuse with the same messages and save the same snapshot.
import { optimizeShowdown } from "../server/lineup/showdown.js";
import { lineupRows } from "../server/showdown/lineup-rows.js";
import { validateOptimizeBody, validateShowdownSlots, buildShowdownSnapshot, staleModeError, WEEK_UNKNOWN_MESSAGE } from "../server/showdown/lineup-checks.js";
import { envelope, errorBody } from "./site-generate.js";
import { validateLineupName } from "../server/lineups/validate.js";
import {
  pageStorage, readKey, writeKey, sortedNewestFirst, nextLineupName, makeDeviceId, DEVICE_ID_PREFIX, STORAGE_UNAVAILABLE_MESSAGE
} from "./site-lineups.js";

export const SHOWDOWN_STORAGE_PREFIX = "nfldfs-site-showdown-lineups:";
// Handed on so site-src/showdown-api.js, which is published one folder deeper, needs only one import to rewrite.
export { pageStorage };

/** The storage key for one showdown (its key looks like 2026-w03-ATLGB). */
export function showdownStorageKey(key) {
  return `${SHOWDOWN_STORAGE_PREFIX}${key}`;
}

// The route's response envelope (server.js envelope / errorBody): the one copy, in site-generate.js; handed on for
// site-src/showdown-api.js.
export { envelope, errorBody };

const WEEK_UNKNOWN = () => errorBody("VALIDATION_ERROR", WEEK_UNKNOWN_MESSAGE);

/** This device's saved lineups of the showdown `key`. Empty when storage is unavailable or unreadable. */
export function readShowdownDeviceLineups(storage, key) {
  return storage ? readKey(storage, showdownStorageKey(key)) : [];
}

/** The app's baked lineups plus this device's, newest first, as GET .../lineups answers. */
export function showdownLineupsResponse(baked, storage, key) {
  if (!baked || baked.ok === false) return baked;
  const app = Array.isArray(baked.lineups) ? baked.lineups : [];
  return { ...baked, lineups: sortedNewestFirst([...app, ...readShowdownDeviceLineups(storage, key)]) };
}

function usableBoard(board) {
  return Boolean(board) && board.ok !== false && Array.isArray(board.rows);
}

/**
 * The optimise route's work on the baked board. `payload`: {objective, locks, excludes}; a retired objective builds
 * by projection with the route's objectiveNote (server/showdown/lineup-checks.js). Returns the route's body.
 */
export function showdownOptimizeResponse(board, payload) {
  if (!usableBoard(board)) return board && board.ok === false && board.error ? board : errorBody("NO_SLATE", "No showdown slate has been uploaded.");
  const checked = validateOptimizeBody(payload);
  if (checked.error) return errorBody("VALIDATION_ERROR", checked.error);
  // As the route: an old page's mode, any value, is refused with the reload sentence; every Build reads the board.
  const stale = staleModeError(payload?.mode);
  if (stale) return errorBody("VALIDATION_ERROR", stale);
  try {
    // The app's Build rows (server/showdown/lineup-rows.js, one copy): a revive is set aside while TwoGun is the only projection source.
    const result = optimizeShowdown(lineupRows(board), { objective: checked.objective, locks: checked.locks, excludes: checked.excludes });
    return envelope({ ...result, objectiveNote: checked.objectiveNote }, { stale: board.stale ?? [] });
  } catch (e) {
    console.error("showdown optimize: failed", e);
    return errorBody("LINEUP_OPTIMIZE_FAILED", "Could not build a showdown lineup.");
  }
}

/**
 * POST .../lineups on the baked board: the route's slot, name and snapshot checks, then the lineup is kept in this
 * browser. `bakedLineups`: the app's baked lineups (counted for "Lineup N" and shown with this device's).
 */
export function saveShowdownLineup(storage, key, board, payload, bakedLineups = []) {
  if (!usableBoard(board)) return board && board.ok === false && board.error ? board : errorBody("NO_SLATE", "No showdown slate has been uploaded.");
  if (!Number.isInteger(board.slate?.week)) return WEEK_UNKNOWN();
  const body = payload ?? {};
  const slotsResult = validateShowdownSlots(body.slots);
  if (slotsResult.error) return errorBody("VALIDATION_ERROR", slotsResult.error);
  const nameResult = validateLineupName(body.name);
  if (nameResult.error) return errorBody("VALIDATION_ERROR", nameResult.error);
  const snapshot = buildShowdownSnapshot(slotsResult.slots, lineupRows(board)); // the app's save rows (lineups-routes.js, D71)
  if (snapshot.error) return errorBody("VALIDATION_ERROR", snapshot.error);
  const device = readShowdownDeviceLineups(storage, key);
  const others = [...bakedLineups, ...device];
  const trimmed = (nameResult.name ?? "").trim();
  const entry = {
    id: makeDeviceId(others),
    name: trimmed === "" ? nextLineupName(others) : trimmed,
    savedAt: new Date().toISOString(),
    slots: snapshot.slots,
    salaryUsed: snapshot.salaryUsed,
    totalProj: snapshot.totalProj,
    device: true,
  };
  if (!storage || !writeKey(storage, showdownStorageKey(key), [entry, ...device])) {
    return errorBody("DEVICE_STORAGE_UNAVAILABLE", STORAGE_UNAVAILABLE_MESSAGE);
  }
  return envelope({ lineup: entry, lineups: sortedNewestFirst([...bakedLineups, entry, ...device]) });
}

/** PUT .../lineups/<id> with a name, on this device's lineups only: {lineups} after the change, or {error: {code, message}}. */
export function renameShowdownDeviceLineup(storage, key, id, name, bakedLineups = []) {
  const nameResult = validateLineupName(name);
  if (nameResult.error) return { error: { code: "VALIDATION_ERROR", message: nameResult.error } };
  const list = storage ? readShowdownDeviceLineups(storage, key) : [];
  if (!list.some((l) => l.id === id)) {
    return { error: bakedLineups.some((l) => l.id === id) ? { code: "READ_ONLY", message: "App lineups cannot be changed here." } : { code: "NOT_FOUND", message: "No saved lineup with that id." } };
  }
  const trimmed = (nameResult.name ?? "").trim();
  const next = trimmed === "" ? nextLineupName([...bakedLineups, ...list.filter((l) => l.id !== id)]) : trimmed;
  if (!writeKey(storage, showdownStorageKey(key), list.map((l) => (l.id === id ? { ...l, name: next } : l)))) {
    return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  }
  return { lineups: sortedNewestFirst([...bakedLineups, ...readShowdownDeviceLineups(storage, key)]) };
}

/**
 * Removes the device lineup `id` of the showdown `key`. Returns "deleted", "missing" (no device lineup with that id,
 * which includes every baked app lineup) or "refused" (storage unavailable or the write failed).
 */
export function deleteShowdownDeviceLineup(storage, key, id) {
  if (!storage) return "refused";
  if (typeof id !== "string" || !id.startsWith(DEVICE_ID_PREFIX)) return "missing";
  const list = readShowdownDeviceLineups(storage, key);
  if (!list.some((l) => l.id === id)) return "missing";
  return writeKey(storage, showdownStorageKey(key), list.filter((l) => l.id !== id)) ? "deleted" : "refused";
}
