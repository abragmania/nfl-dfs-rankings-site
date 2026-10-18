// Static replacement for public/js/api.js on the published site (copied over out/js/api.js by tools/publish.mjs).
// Exports EXACTLY the same names as the real file. Reads fetch the files baked at publish time by RELATIVE url (the
// site lives under a sub-path). The Optimizer works (DECISIONS.md D69): it runs in the visitor's browser on the
// published board, and lineups saved here are kept only in this browser (site-lineups.js), each marked as saved on
// this device; the app's own saved lineups stay read-only. Stars, notes, typed numbers, the per-cell reset and Reset
// all work too (D71): the visitor's changes are kept in this browser (site-overrides.js) and merged over the baked
// board by the app's own remerge, and the board, the Optimizer and lineup saves all use the merged board. Every other
// write rejects with one plain message. Nothing here touches the network or the page at import time.
import {
  pageStorage, readDeviceLineups, buildDeviceLineup, saveDeviceLineup, deleteDeviceLineup, buildDevicePatch, updateDeviceLineup, weekKeys, sortedNewestFirst,
  STORAGE_UNAVAILABLE_MESSAGE,
} from "./site-lineups.js";
import { boardWithEdits, putEdits, resetPlayerEdits, resetAllEdits } from "./site-overrides.js";
import { boardWithWeights, readWeights, putWeights } from "./site-weights.js";

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

// The site has no sample mode (isSampleMode is always false); a caller that still asks for the refusal gets the
// site's read-only refusal.
export function sampleRefusal() {
  return readOnly();
}

// The header's Current | TwoGun switch: both boards are baked. The visitor's last choice is kept in this browser, else
// the mode the app was in when published (meta.defaultMode), else Current.
const MODE_KEY = "nfldfs-site-mode";
const BOARD_FILE = { current: "baked/board.json", twogun: "baked/board-twogun.json" };
let chosenMode = null;
async function activeMode() {
  if (chosenMode) return chosenMode;
  let mode = null;
  try {
    mode = pageStorage()?.getItem(MODE_KEY) ?? null;
  } catch { /* storage switched off: the published default shows */ }
  if (!Object.hasOwn(BOARD_FILE, mode)) {
    try {
      mode = (await baked("baked/meta.json"))?.defaultMode;
    } catch (e) {
      console.warn("site mode: baked/meta.json could not be read, so the Current board is shown", e);
    }
  }
  chosenMode = Object.hasOwn(BOARD_FILE, mode) ? mode : "current";
  return chosenMode;
}

// A fresh copy of the baked board (the app may adjust what it is handed) with this browser's override changes merged
// in, so a reload keeps them.
export async function getBoard() {
  return visitorBoard(await getJson(BOARD_FILE[await activeMode()]));
}

export async function getSlate() {
  return getJson("baked/slate.json");
}

// The baked board and slate for the Optimizer and device saves, fetched once per page and kept apart from what
// getBoard hands the app, which may adjust its copy. Adam can publish again while a page is open: a board fetched
// later whose slate (season, week, upload time) is not the cached slate's is refused with SITE_UPDATED (sameSlate),
// so the visitor's changes are never merged onto a slate the page did not load.
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

const builtRefusal = (built) => (built.code ? { ...siteError(built.code, built.error), duplicateOf: built.duplicateOf } : siteError("VALIDATION_ERROR", built.error));

/** The published week, or null when the baked slate cannot say. */
async function publishedWeek() {
  const pub = await publishedSlate();
  return pub ? { season: pub.season, week: pub.week } : null;
}

/** The baked board with this browser's override changes, for the Optimizer and device saves (D55: a star made here counts). */
async function bakedVisitorBoard() {
  return visitorBoard(await baked(BOARD_FILE[await activeMode()]));
}

/** The published week and the baked slate (its games, for the remerge), or null when the slate cannot say. */
async function publishedSlate() {
  const slate = await baked("baked/slate.json");
  if (!slate || slate.ok === false || slate.season == null || slate.week == null) return null;
  return { season: slate.season, week: slate.week, slate };
}

const SITE_UPDATED = () => siteError("SITE_UPDATED", "The site was updated; reload the page.");

/** Whether `board` was built from the cached baked slate (a publish since the page loaded makes them differ). */
function sameSlate(board, slate) {
  const b = board?.slate ?? {};
  return b.season === slate.season && b.week === slate.week && (b.uploadedAt ?? null) === (slate.uploadedAt ?? null);
}

/** `board` with this browser's override changes for the published week merged in (site-overrides.js). */
async function visitorBoard(board) {
  if (!board || board.ok === false || !Array.isArray(board.rows)) return board;
  let pub;
  try {
    pub = await publishedSlate();
  } catch (e) {
    console.warn("site overrides: the baked slate could not be read, so the published board is shown", e);
    return board;
  }
  if (!pub) return board;
  if (!sameSlate(board, pub.slate)) return SITE_UPDATED();
  return boardWithEdits(weightedBoard(board, pub), pub.slate, pageStorage(), pub.season, pub.week);
}

/** `board` re-ranked under this browser's source weights (site-weights.js); as it was when there are none or they cannot be applied. */
function weightedBoard(board, pub) {
  try {
    return boardWithWeights(board, pub.slate, readWeights(pageStorage(), pub.season, pub.week, board));
  } catch (e) {
    console.warn("site weights: saved weights not applied", e);
    return board;
  }
}

// The override writes (PUT /api/overrides, DELETE /api/overrides/:id, DELETE /api/overrides) on a fresh copy of the
// baked board. Answers as the routes do: the whole merged board, or {ok:false, error} (storage switched off, or a
// value the app would refuse), leaving the board and the saved changes as they were.
async function overrideWrite(change) {
  const [board, pub] = await Promise.all([getJson(BOARD_FILE[await activeMode()]), publishedSlate()]);
  if (!board || board.ok === false || !Array.isArray(board.rows) || !pub) {
    return board?.ok === false ? board : siteError("NO_SLATE", "No slate has been uploaded yet.");
  }
  if (!sameSlate(board, pub.slate)) return SITE_UPDATED();
  const result = change(pageStorage(), pub.season, pub.week, weightedBoard(board, pub), pub.slate);
  return result.error ? siteError(result.error.code, result.error.message) : result.board;
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

export async function getMode() {
  return { ok: true, mode: await activeMode() };
}

// POST /api/mode: answers the board in the new mode, as the route does; nothing leaves the browser. A board that cannot
// be read or merged leaves the mode as it was.
export async function postMode(mode) {
  if (!Object.hasOwn(BOARD_FILE, mode)) return siteError("VALIDATION_ERROR", "mode must be one of current, twogun");
  const board = await visitorBoard(await getJson(BOARD_FILE[mode]));
  if (!board || board.ok === false || !Array.isArray(board.rows)) return board?.ok === false ? board : siteError("NO_SLATE", "No slate has been uploaded yet.");
  chosenMode = mode;
  try {
    pageStorage()?.setItem(MODE_KEY, mode);
  } catch { /* storage switched off: the choice lasts until the page is closed */ }
  return board;
}

export function putOverrides(patch) {
  return overrideWrite((storage, season, week, board, slate) => putEdits(storage, season, week, board, slate, patch));
}

export function deleteAllOverrides() {
  return overrideWrite((storage, season, week, board, slate) => resetAllEdits(storage, season, week, board, slate));
}

export function deleteOverride(playerId) {
  return overrideWrite((storage, season, week, board, slate) => resetPlayerEdits(storage, season, week, board, slate, String(playerId)));
}

export async function postSources(patch) {
  const pub = await publishedSlate();
  const board = await getJson(BOARD_FILE[await activeMode()]);
  if (!pub || !board || board.ok === false || !Array.isArray(board.rows)) return board?.ok === false ? board : siteError("NO_SLATE", "No slate has been uploaded yet.");
  if (!sameSlate(board, pub.slate)) return SITE_UPDATED();
  const result = putWeights(pageStorage(), pub.season, pub.week, board, Array.isArray(patch) ? patch : [patch]);
  if (result.error) return siteError(result.error.code, result.error.message);
  return visitorBoard(board);
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
    const [board, slate, wk] = await Promise.all([bakedVisitorBoard(), baked("baked/slate.json"), publishedWeek()]);
    const saved = wk ? readDeviceLineups(pageStorage(), wk.season, wk.week) : [];
    return await runGenerate({ board, slate, body: payload, saved });
  } catch (e) {
    console.error("lineup generate: failed", e);
    return GENERATE_FAILED();
  }
}

// Body and answer as POST /api/lineups, but the lineup is kept in this browser only (site-lineups.js).
export async function postLineup(payload) {
  const [board, wk, app] = await Promise.all([bakedVisitorBoard(), publishedWeek(), appLineups()]);
  if (!board || board.ok === false || !wk) return board?.ok === false ? board : siteError("NO_SLATE", "No slate has been uploaded yet.");
  const storage = pageStorage();
  const others = [...app, ...readDeviceLineups(storage, wk.season, wk.week)];
  const built = buildDeviceLineup(payload, board, others);
  if (built.error) return builtRefusal(built);
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

// PUT /api/lineups/<id> for a device lineup (D69; PROJECT.md Part 4 Lineups); the app's own lineups are read-only.
export async function putLineup(id, payload) {
  const [board, wk, app] = await Promise.all([bakedVisitorBoard(), publishedWeek(), appLineups()]);
  if (!board || board.ok === false || !wk) return board?.ok === false ? board : siteError("NO_SLATE", "No slate has been uploaded yet.");
  const storage = pageStorage();
  const unavailable = () => siteError("DEVICE_STORAGE_UNAVAILABLE", "This browser is not letting the site change its saved lineups (storage is switched off).");
  if (!storage || !weekKeys(storage, wk.season, wk.week)) return unavailable(); // unlistable storage is not "no such lineup"
  const device = readDeviceLineups(storage, wk.season, wk.week);
  const existing = device.find((l) => l.id === id);
  if (!existing) {
    return app.some((l) => l.id === id)
      ? siteError("READ_ONLY", "App lineups cannot be changed here; Save lineup keeps a version on this device.")
      : siteError("NOT_FOUND", "No saved lineup with that id.");
  }
  const built = buildDevicePatch(payload, board, existing, [...app, ...device]);
  if (built.error) return builtRefusal(built);
  const result = updateDeviceLineup(storage, wk.season, wk.week, id, built.patch);
  if (result.status === "refused") return unavailable();
  if (result.status === "missing") return siteError("NOT_FOUND", "No saved lineup with that id.");
  return { ok: true, generatedAt: new Date().toISOString(), stale: [], lineup: result.entry, lineups: await lineupsWithDevice(app) };
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
