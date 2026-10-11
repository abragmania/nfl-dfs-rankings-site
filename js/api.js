// Static replacement for public/js/api.js on the published site (copied over out/js/api.js by tools/publish.mjs).
// Exports EXACTLY the same names as the real file. Reads fetch the files baked at publish time by RELATIVE url (the
// site lives under a sub-path). The Optimizer works (DECISIONS.md D69): it runs in the visitor's browser on the
// published board, and lineups saved here are kept only in this browser (site-lineups.js), each marked as saved on
// this device; the app's own saved lineups stay read-only. Every other write rejects with one plain message.
// Nothing here touches the network or the page at import time.
import {
  pageStorage, readDeviceLineups, buildDeviceLineup, saveDeviceLineup, deleteDeviceLineup, sortedNewestFirst,
  STORAGE_UNAVAILABLE_MESSAGE,
} from "./site-lineups.js";

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

// The baked board and slate for the Optimizer and device saves, fetched once per page (the site never changes under
// a loaded page) and kept apart from what getBoard hands the app, which may adjust its copy.
const bakedCache = new Map();
function baked(url) {
  if (!bakedCache.has(url)) {
    const p = getJson(url);
    p.catch(() => bakedCache.delete(url)); // a failed fetch is tried again next time
    bakedCache.set(url, p);
  }
  return bakedCache.get(url);
}

function siteError(code, message) {
  return { ok: false, generatedAt: new Date().toISOString(), stale: [], error: { code, message } };
}

/** The published week, or null when the baked slate cannot say. */
async function publishedWeek() {
  const slate = await baked("baked/slate.json");
  if (!slate || slate.ok === false || slate.season == null || slate.week == null) return null;
  return { season: slate.season, week: slate.week };
}

/** The app's saved lineups (baked, read-only) plus this device's, newest first, as GET /api/lineups answers. */
async function lineupsWithDevice(appLineups) {
  const wk = await publishedWeek();
  const device = wk ? readDeviceLineups(pageStorage(), wk.season, wk.week) : [];
  return sortedNewestFirst([...(appLineups ?? []), ...device]);
}

async function appLineups() {
  const data = await baked("baked/lineups.json");
  return data && data.ok !== false && Array.isArray(data.lineups) ? data.lineups : [];
}

export async function getLineups() {
  const data = await getJson("baked/lineups.json");
  if (!data || data.ok === false) return data;
  return { ...data, lineups: await lineupsWithDevice(Array.isArray(data.lineups) ? data.lineups : []) };
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

// The Optimizer's work runs in a module worker (opt-worker.js) when the browser allows one, else on the page's thread.
let worker = null;
let workerBroken = false;
let workerSeq = 0;
const pending = new Map();

function optWorker() {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./opt-worker.js", import.meta.url), { type: "module" });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (event) => {
    const p = pending.get(event.data?.id);
    if (!p) return;
    pending.delete(event.data.id);
    p.resolve(event.data.response);
  };
  // The worker could not start, crashed, or could not read a message: every waiting request is run on the page
  // instead, and so is every later one.
  const broken = () => {
    workerBroken = true;
    try { worker?.terminate(); } catch { /* already gone */ }
    worker = null;
    for (const p of pending.values()) p.reject(new Error("worker failed"));
    pending.clear();
  };
  worker.onerror = broken;
  worker.onmessageerror = broken;
  return worker;
}

// Longest wait for the worker's answer. The search is bounded and takes well under a second on the real board; a
// worker that has not answered by then is stuck, so it is stopped (a fresh one starts next time) and the visitor is
// told plainly instead of the screen staying on "Making lineups".
const WORKER_TIMEOUT_MS = 20000;
class GenerateTimeout extends Error {}

const GENERATE_FAILED = () => siteError("LINEUP_GENERATE_FAILED", "Could not make lineups.");

async function runGenerate(args) {
  const w = optWorker();
  if (w) {
    try {
      return await new Promise((resolve, reject) => {
        const id = ++workerSeq;
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          try { w.terminate(); } catch { /* already gone */ }
          if (worker === w) worker = null;
          for (const p of pending.values()) p.reject(new GenerateTimeout());
          pending.clear();
          reject(new GenerateTimeout());
        }, WORKER_TIMEOUT_MS);
        const done = (fn) => (value) => { clearTimeout(timer); fn(value); };
        pending.set(id, { resolve: done(resolve), reject: done(reject) });
        w.postMessage({ id, args });
      });
    } catch (e) {
      if (e instanceof GenerateTimeout) return GENERATE_FAILED();
      /* the worker failed: fall through to the page's thread */
    }
  }
  try {
    const { generateResponse } = await import("./site-generate.js");
    return generateResponse(args);
  } catch (e) {
    console.error("lineup generate: failed", e);
    return GENERATE_FAILED();
  }
}

// Body and answer as POST /api/lineup/generate. Existing lineups (uniqueness and exposure) are this device's saved
// lineups of the week; the app's own saved lineups are never counted (D69). Never throws: there is no server on the
// site, so a failure is answered as the route's own LINEUP_GENERATE_FAILED, never as an unreachable server.
export async function postLineupGenerate(payload) {
  try {
    const [board, slate, wk] = await Promise.all([baked("baked/board.json"), baked("baked/slate.json"), publishedWeek()]);
    const saved = wk ? readDeviceLineups(pageStorage(), wk.season, wk.week) : [];
    return await runGenerate({ board, slate, body: payload, saved });
  } catch (e) {
    console.error("lineup generate: failed", e);
    return GENERATE_FAILED();
  }
}

// Body and answer as POST /api/lineups, but the lineup is kept in this browser only (site-lineups.js).
export async function postLineup(payload) {
  const [board, wk, app] = await Promise.all([baked("baked/board.json"), publishedWeek(), appLineups()]);
  if (!board || board.ok === false || !wk) return board?.ok === false ? board : siteError("NO_SLATE", "No slate has been uploaded yet.");
  const storage = pageStorage();
  const others = [...app, ...readDeviceLineups(storage, wk.season, wk.week)];
  const built = buildDeviceLineup(payload, board, others);
  if (built.error) return siteError("VALIDATION_ERROR", built.error);
  if (!saveDeviceLineup(storage, wk.season, wk.week, built.slateKey, built.entry)) {
    return siteError("DEVICE_STORAGE_UNAVAILABLE", STORAGE_UNAVAILABLE_MESSAGE);
  }
  return { ok: true, generatedAt: new Date().toISOString(), stale: [], lineup: built.entry, lineups: await lineupsWithDevice(app) };
}

// Only a lineup saved on this device can be deleted; the app's saved lineups are read-only here.
export async function deleteLineup(id) {
  const [wk, app] = await Promise.all([publishedWeek(), appLineups()]);
  if (!wk) return siteError("NO_SLATE", "No slate has been uploaded yet.");
  const result = deleteDeviceLineup(pageStorage(), wk.season, wk.week, id);
  if (result === "refused") return siteError("DEVICE_STORAGE_UNAVAILABLE", "This browser is not letting the site change its saved lineups (storage is switched off).");
  if (result === "missing") {
    return app.some((l) => l.id === id) ? siteError("READ_ONLY", READ_ONLY_MESSAGE) : siteError("NOT_FOUND", "No saved lineup with that id.");
  }
  return { ok: true, generatedAt: new Date().toISOString(), stale: [], lineups: await lineupsWithDevice(app) };
}

export function putLineupName() {
  return readOnly();
}

// Entries are Adam's private DraftKings files: the site has none, and its Entries section is hidden by site.css.
export function getEntries() {
  return readOnly();
}

export function postEntriesUpload() {
  return readOnly();
}

export function postEntriesExport() {
  return readOnly();
}
