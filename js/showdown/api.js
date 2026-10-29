// Static replacement for public/js/showdown/api.js on the published site (copied over out/js/showdown/api.js by
// tools/publish.mjs). Exports EXACTLY the same names as the real file. Reads fetch the files baked at publish time by
// RELATIVE url. Showdown Build and Save work (DECISIONS.md D71): they run in the visitor's browser on the published
// showdown board (site-src/site-showdown.js), and a lineup saved here is kept only in this browser, marked as saved
// on this device; the app's own saved lineups stay read-only. Every other write rejects with one plain message.
// Nothing here touches the network or the page at import time.
//
// The import below is written beside this file so it resolves here; tools/publish.mjs (showdownShimText) rewrites it to
// climb one folder up in the published copy, which sits one folder deeper (out/js/showdown/).
//
// The lineup meter, its swaps, the modes answer and the Showdown Optimizer work too (RULES.md D71, D82): the meter, the swaps
// and Generate are the routes' own answers made in this browser on the baked board and the baked field curves
// (site-showdown.js); the modes answer is the app's own, baked at publish time beside the board (it names TwoGun's figure
// beside a man counted out, which only the app's files can say). supports(feature) tells the Showdown screen what runs here.
import {
  pageStorage, showdownLineupsResponse, showdownOptimizeResponse, saveShowdownLineup, deleteShowdownDeviceLineup, renameShowdownDeviceLineup, envelope, errorBody,
  showdownMeterResponse, showdownSwapsResponse, runShowdownGenerate, readShowdownDeviceLineups, bakedCurvesRead, BAKED_CURVES_URL, SHOWDOWN_GENERATE_FAILED,
} from "../site-showdown.js";

export const READ_ONLY_MESSAGE = "Read-only on the live site. Do this in the app on your computer.";

// What the Showdown screen can run on the site (the contract with public/js/showdown/api.js supports, which says true for
// each): everything but the ± bumps, which change the app's board through its overrides route (the site cannot rebuild a
// Showdown board, so they stay in the app; RULES.md D71).
const FEATURES = Object.freeze({ generate: true, optimize: true, swaps: true, modes: true, meter: true, lineups: true, overrides: false });

/** True when the site runs `feature` ("generate", "optimize", "swaps", "modes", "meter", "lineups", "overrides"). */
export function supports(feature) {
  return Object.hasOwn(FEATURES, feature) && FEATURES[feature] === true;
}

function readOnly() {
  return Promise.reject(new Error(READ_ONLY_MESSAGE));
}

async function getJson(url) {
  const res = await fetch(url);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`${url} did not return JSON (status ${res.status})`);
  }
  return data;
}

export function isShowdownSampleMode() {
  return false;
}

export async function getShowdowns() {
  return getJson("baked/showdown/index.json");
}

export async function getShowdownBoard(key) {
  return getJson(`baked/showdown/${encodeURIComponent(key)}/board.json`);
}

// The published lineups of the app plus the ones saved on this device, newest first, as GET .../lineups answers.
export async function getShowdownLineups(key) {
  return showdownLineupsResponse(await getJson(`baked/showdown/${encodeURIComponent(key)}/lineups.json`), pageStorage(), key);
}

export function postShowdownUpload() {
  return readOnly();
}

export function postShowdownRefresh() {
  return readOnly();
}

export function postShowdownProjectionsPaste() {
  return readOnly();
}

// A saved card's letter is changed in the app only: the site's saved lineups, its own device ones included, take no letter.
export function putShowdownLineupTag() {
  return readOnly();
}

// The Showdown Entries tab holds Adam's private entries files and is not on the site (showdown/tabs.js visibleShowdownTabs); all three refuse.
export function getShowdownEntries() {
  return readOnly();
}

export function postShowdownEntriesUpload() {
  return readOnly();
}

export function postShowdownEntriesExport() {
  return readOnly();
}

// Body and answer as POST /api/showdown/<key>/lineup/optimize. Never throws: there is no server on the site, so a
// failure is answered as the route's own LINEUP_OPTIMIZE_FAILED, never as an unreachable server.
export async function postShowdownLineupOptimize(key, payload) {
  try {
    const board = await getShowdownBoard(key);
    return showdownOptimizeResponse(board, payload);
  } catch (e) {
    console.error("showdown optimize: failed", e);
    return errorBody("LINEUP_OPTIMIZE_FAILED", "Could not build a showdown lineup.");
  }
}

// The board the meter, the swaps and Generate measure on: fetched once per showdown per page, so the field table built on it
// (server/showdown/meter-answer.js zFor, cached per board object) is built once and kept, never on every lineup change.
const fieldBoards = new Map();
function fieldBoard(key) {
  if (!fieldBoards.has(key)) {
    const p = getShowdownBoard(key);
    p.catch(() => fieldBoards.delete(key)); // a failed fetch is tried again next time
    fieldBoards.set(key, p);
  }
  return fieldBoards.get(key);
}

// The baked field curves, read as the app reads its file (site-showdown.js bakedCurvesRead); a good read is kept for the
// page, a failure is not (the next lineup tries again), as the app keeps its own.
let curvesKept = null;
async function fieldCurves() {
  if (curvesKept) return curvesKept;
  let read;
  try {
    const res = await fetch(BAKED_CURVES_URL);
    read = bakedCurvesRead({ status: res.status, text: res.ok ? await res.text() : "" });
  } catch (e) {
    read = bakedCurvesRead({ failure: e?.message ?? String(e) });
  }
  if (read.curves) curvesKept = read;
  return read;
}

// Body and answer as POST /api/showdown/<key>/lineup/meter ({cpt, flex, excludes?, field?}). Never throws: a failure is the
// route's own LINEUP_METER_FAILED.
export async function postShowdownLineupMeter(key, payload) {
  try {
    const [board, curves] = await Promise.all([fieldBoard(key), fieldCurves()]);
    return showdownMeterResponse(board, payload, curves);
  } catch (e) {
    console.error("showdown meter: failed", e);
    return errorBody("LINEUP_METER_FAILED", "Could not measure this lineup.");
  }
}

// Body and answer as POST /api/showdown/<key>/lineup/swaps (the meter's body). Never throws.
export async function postShowdownLineupSwaps(key, payload) {
  try {
    const [board, curves] = await Promise.all([fieldBoard(key), fieldCurves()]);
    return showdownSwapsResponse(board, payload, curves);
  } catch (e) {
    console.error("showdown swaps: failed", e);
    return errorBody("LINEUP_SWAPS_FAILED", "Could not work out the swaps for this lineup.");
  }
}

// GET /api/showdown/<key>/modes: the app's answer, baked beside the board. Never throws: a file that cannot be read is the
// route's own SHOWDOWN_MODES_FAILED, so the meter says the notes could not be read.
export async function getShowdownModes(key) {
  try {
    return await getJson(`baked/showdown/${encodeURIComponent(key)}/modes.json`);
  } catch (e) {
    console.error("showdown modes: failed", e);
    return errorBody("SHOWDOWN_MODES_FAILED", "Could not read what each mode has posted.");
  }
}

// Body and answer as POST /api/showdown/<key>/lineup/generate ({settings, field}); this device's saved lineups of the game
// count for minimum unique (D69). Runs off the page's thread when the browser allows. Never throws.
export async function postShowdownLineupGenerate(key, payload) {
  try {
    const [board, curvesRead] = await Promise.all([fieldBoard(key), fieldCurves()]);
    const saved = readShowdownDeviceLineups(pageStorage(), key);
    return await runShowdownGenerate({ board, body: payload, saved, curvesRead });
  } catch (e) {
    console.error("showdown generate: failed", e);
    return SHOWDOWN_GENERATE_FAILED();
  }
}

async function bakedLineups(key) {
  try {
    const data = await getJson(`baked/showdown/${encodeURIComponent(key)}/lineups.json`);
    return data && data.ok !== false && Array.isArray(data.lineups) ? data : { ok: true, lineups: [] };
  } catch {
    return { ok: true, lineups: [] };
  }
}

// Body and answer as POST /api/showdown/<key>/lineups, but the lineup is kept in this browser only.
export async function postShowdownLineup(key, payload) {
  try {
    const [board, app] = await Promise.all([getShowdownBoard(key), bakedLineups(key)]);
    const storage = pageStorage();
    const result = saveShowdownLineup(storage, key, board, payload, app.lineups);
    return result.ok === false ? result : { ...result, lineups: showdownLineupsResponse(app, storage, key).lineups };
  } catch (e) {
    console.error("showdown save: failed", e);
    return errorBody("SAVE_FAILED", "Could not save the lineup.");
  }
}

// Only a lineup saved on this device can be deleted; the app's saved lineups are read-only here.
export async function deleteShowdownLineup(key, id) {
  const app = await bakedLineups(key);
  const storage = pageStorage();
  const result = deleteShowdownDeviceLineup(storage, key, id);
  if (result === "refused") return errorBody("DEVICE_STORAGE_UNAVAILABLE", "This browser is not letting the site change its saved lineups (storage is switched off).");
  if (result === "missing") {
    return app.lineups.some((l) => l.id === id) ? errorBody("READ_ONLY", READ_ONLY_MESSAGE) : errorBody("NOT_FOUND", "No saved lineup with that id.");
  }
  return envelope({ lineups: showdownLineupsResponse(app, storage, key).lineups }, { stale: app.stale ?? [] });
}

export async function putShowdownLineupName(key, id, name) {
  const app = await bakedLineups(key);
  const result = renameShowdownDeviceLineup(pageStorage(), key, id, name, app.lineups);
  return result.error ? errorBody(result.error.code, result.error.message) : envelope({ lineups: result.lineups }, { stale: app.stale ?? [] });
}
