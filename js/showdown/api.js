// Static, read-only replacement for public/js/showdown/api.js on the published site (copied over
// out/js/showdown/api.js by tools/publish.mjs). Exports EXACTLY the same names as the real file. Reads
// fetch the files baked at publish time by RELATIVE url; every write rejects with one plain message.
// Nothing here touches the network or the page at import time.

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

export async function getShowdownLineups(key) {
  return getJson(`baked/showdown/${encodeURIComponent(key)}/lineups.json`);
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

export function postShowdownLineupOptimize() {
  return readOnly();
}

export function postShowdownLineup() {
  return readOnly();
}

export function deleteShowdownLineup() {
  return readOnly();
}

export function putShowdownLineupName() {
  return readOnly();
}
