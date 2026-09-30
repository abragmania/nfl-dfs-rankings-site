// Static, read-only replacement for public/js/api.js on the published site (copied over out/js/api.js by
// tools/publish.mjs). Exports EXACTLY the same names as the real file. Reads fetch the files baked at
// publish time by RELATIVE url (the site lives under a sub-path); every write rejects with one plain
// message. Nothing here touches the network or the page at import time.

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

export function isSampleMode() {
  return false;
}

export async function getBoard() {
  return getJson("baked/board.json");
}

export async function getSlate() {
  return getJson("baked/slate.json");
}

export async function getLineups() {
  return getJson("baked/lineups.json");
}

export function postRefresh() {
  return readOnly();
}

export function putOverrides() {
  return readOnly();
}

export function deleteAllOverrides() {
  return readOnly();
}

export function deleteOverride() {
  return readOnly();
}

export function postSources() {
  return readOnly();
}

export function postProjectionsPaste() {
  return readOnly();
}

export function uploadCsv() {
  return readOnly();
}

export function postLineupOptimize() {
  return readOnly();
}

export function postLineup() {
  return readOnly();
}

export function deleteLineup() {
  return readOnly();
}

export function putLineupName() {
  return readOnly();
}
