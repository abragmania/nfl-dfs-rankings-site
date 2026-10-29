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
//
// The lineup meter, its swaps and the Showdown Optimizer (RULES.md D71: the site does everything the app does; D82: the
// field model) are the routes' own answers too: server/showdown/meter-answer.js meterAnswer, server/showdown/swaps.js
// swapsAnswer and server/showdown/generate-answer.js generateAnswer, run on the baked board with the field curves baked
// beside it (baked/showdown-field/curves.json, read by server/showdown/field-curves-core.js as the app reads its file).
import { optimizeShowdown } from "../server/lineup/showdown.js";
import { generateShowdownLineups } from "../server/lineup/showdown-multi.js";
import { lineupRows } from "../server/showdown/lineup-rows.js";
import { validateOptimizeBody, validateShowdownSlots, buildShowdownSnapshot, staleModeError, WEEK_UNKNOWN_MESSAGE } from "../server/showdown/lineup-checks.js";
import { meterAnswer, validateMeterBody, halvesOf, zFor } from "../server/showdown/meter-answer.js";
import { swapsAnswer } from "../server/showdown/swaps.js";
import { generateBodyCheck, generateAnswer, WEEK_UNKNOWN_SAVED_NOTE } from "../server/showdown/generate-answer.js";
import { curvesFromText, curvesMissingSentence, curvesUnreadableSentence } from "../server/showdown/field-curves-core.js";
import { envelope, errorBody } from "./site-generate.js";
import { createWorkerRunner } from "./site-worker.js";
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

/** The answer for a board that cannot be used: its own refusal when it carries one, else the routes' NO_SLATE. */
function noBoardAnswer(board) {
  return board && board.ok === false && board.error ? board : errorBody("NO_SLATE", "No showdown slate has been uploaded.");
}

// ---- The lineup meter, its swaps and the Showdown Optimizer (RULES.md D71, D82) ----------------------------------------

/** Where the field curves are baked (tools/publish.mjs SHOWDOWN_CURVES_FILE), relative to the page. */
export const BAKED_CURVES_URL = "baked/showdown-field/curves.json";

/**
 * The baked curves file's read, as the app's loadFieldCurves reads its own (server/showdown/field-curves.js): { curves } or
 * { error } with the same sentences. `status` and `text` are the fetch's; `failure` the reason a fetch threw (then no status).
 * A 404 is a missing file (D82: no curves, no copies; never a fall-back to the straight product).
 */
export function bakedCurvesRead({ status = null, text = "", failure = null } = {}) {
  if (failure !== null) return { error: curvesUnreadableSentence(failure) };
  if (status === 404) return { error: curvesMissingSentence() };
  if (!(status >= 200 && status < 300)) return { error: curvesUnreadableSentence(`status ${status}`) };
  return curvesFromText(text);
}

/** A route answer (meterAnswer, swapsAnswer, generateAnswer) as the route sends it: its body in the envelope, or the refusal. */
function routeBody(a, board) {
  if (a.log) console.error(a.log.message, a.log.extra);
  return a.ok ? envelope(a.result, { stale: board.stale ?? [] }) : errorBody(a.code, a.message);
}

/** POST .../lineup/meter on the baked board; `curvesRead` is bakedCurvesRead's answer. Returns the route's body. */
export function showdownMeterResponse(board, payload, curvesRead) {
  if (!usableBoard(board)) return noBoardAnswer(board);
  return routeBody(meterAnswer(board, payload, { loadCurves: () => curvesRead }), board);
}

/** POST .../lineup/swaps on the baked board, on the meter's halves and field table; `curvesRead` as the meter's. */
export function showdownSwapsResponse(board, payload, curvesRead) {
  if (!usableBoard(board)) return noBoardAnswer(board);
  return routeBody(swapsAnswer(board, payload, { loadCurves: () => curvesRead }, { validateMeterBody, halvesOf, zFor }), board);
}

/** The site's one note on every Generate answer that counted saved lineups: the app counts its own saved lineups, the site only
 *  this browser's (D69: lineups saved on the site are never merged with the app's), so the answer says which were counted. */
export const SITE_SAVED_NOTE = "Minimum-unique counted only the lineups saved in this browser; the app's saved lineups are not counted here.";

/** The route's own failure answer for a generate that could not run. */
export const SHOWDOWN_GENERATE_FAILED = () => errorBody("LINEUP_GENERATE_FAILED", "Could not make showdown lineups.");

/**
 * POST .../lineup/generate on the baked board: { board, body ({settings, field}), saved (this device's saved lineups of this
 * showdown, counted for minimum unique as the app counts its own; the app's saved lineups are not, D69), curvesRead (as the
 * meter's) }. The body is checked before anything else, as the route does; a made answer carries SITE_SAVED_NOTE among its
 * notes (which saved lineups were counted), and a board whose week is unknown counts no saved lineup and says so instead.
 * Returns the route's body. Runs in opt-worker.js (runShowdownGenerate) or on the page.
 */
export function showdownGenerateResponse({ board, body: rawBody, saved = [], curvesRead = null }) {
  const body = rawBody ?? {};
  if (!usableBoard(board)) return noBoardAnswer(board);
  const checked = generateBodyCheck(body);
  if (checked.error) return errorBody("VALIDATION_ERROR", checked.error);
  const week = board.slate?.week;
  return routeBody(generateAnswer({
    board, body, field: checked.field, generate: generateShowdownLineups,
    readSaved: () => (Number.isInteger(week) ? { saved: Array.isArray(saved) ? saved : [], note: SITE_SAVED_NOTE } : { saved: [], note: WEEK_UNKNOWN_SAVED_NOTE }),
    loadCurves: () => curvesRead ?? { error: curvesMissingSentence() }
  }), board);
}

// The longest wait for the worker's answer before it is called stuck (site-worker.js), as classic's: 150 lineups with their
// meters took under half a second on the week 8 CAR@GB board (measured 2026-10-29).
const SHOWDOWN_WORKER_TIMEOUT_MS = 20000;

/** showdownGenerateResponse off the page's thread (site-worker.js, opt-worker.js), else on it. */
export const runShowdownGenerate = createWorkerRunner({
  kind: "showdown", timeoutMs: SHOWDOWN_WORKER_TIMEOUT_MS, failed: SHOWDOWN_GENERATE_FAILED, label: "showdown generate: failed",
  onPage: (args) => showdownGenerateResponse(args)
});

/**
 * The optimise route's work on the baked board. `payload`: {objective, locks, excludes}; a retired objective builds
 * by projection with the route's objectiveNote (server/showdown/lineup-checks.js). Returns the route's body.
 */
export function showdownOptimizeResponse(board, payload) {
  if (!usableBoard(board)) return noBoardAnswer(board);
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
  if (!usableBoard(board)) return noBoardAnswer(board);
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
