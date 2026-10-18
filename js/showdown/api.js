// Static replacement for public/js/showdown/api.js on the published site (copied over out/js/showdown/api.js by
// tools/publish.mjs). Exports EXACTLY the same names as the real file. Reads fetch the files baked at publish time by
// RELATIVE url. Showdown Build and Save work (DECISIONS.md D71): they run in the visitor's browser on the published
// showdown board (site-src/site-showdown.js), and a lineup saved here is kept only in this browser, marked as saved
// on this device; the app's own saved lineups stay read-only. Every other write rejects with one plain message.
// Nothing here touches the network or the page at import time.
//
// The import below is written beside this file so it resolves here; tools/publish.mjs (showdownShimText) rewrites it to
// climb one folder up in the published copy, which sits one folder deeper (out/js/showdown/).
import {
  pageStorage, showdownLineupsResponse, showdownOptimizeResponse, saveShowdownLineup, deleteShowdownDeviceLineup, renameShowdownDeviceLineup, envelope, errorBody,
} from "../site-showdown.js";

export const READ_ONLY_MESSAGE = "Read-only on the live site. Do this in the app on your computer.";

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
