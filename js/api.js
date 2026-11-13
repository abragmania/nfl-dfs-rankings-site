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
import { boardWithEdits, putEdits, resetPlayerEdits, resetAllEdits, classicAdapter } from "./site-overrides.js";
import { findDuplicate } from "../server/lineups/duplicate.js";
import { lineupModeOf } from "../server/lineups/validate.js";
import { readTab, tabOfMode } from "../server/showdown/override-tabs.js"; // the app routes' tab reading, one copy (optimizer standard Part F)
import { buildCard, precheck, identityOf } from "../server/playercard/build.js";
import { ndcAbbr, teamFileUrl, gamelogUrl, teamFileProblem, gamelogProblem } from "../server/playercard/ndc-files.js";
import { boardWithWeights, readWeights, putWeights, weightsKey } from "./site-weights.js";
import { createWorkerRunner, endedSiteResult } from "./site-worker.js";

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
const BOARD_FILE_CASH = { current: "baked/board-cash.json", twogun: "baked/board-twogun-cash.json" }; // the Cash tab's own typed numbers, baked beside GPP's (optimizer standard Part F)
const boardFile = (mode, tab) => (tab === "cash" ? BOARD_FILE_CASH : BOARD_FILE)[mode];
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
// in, so a reload keeps them. `tab` "cash": the Cash tab's board and typed numbers; absent is GPP's (optimizer standard Part F).
export async function getBoard(tab) {
  const asked = readTab(tab);
  if (asked.error) return siteError("VALIDATION_ERROR", asked.error);
  return visitorBoard(await getJson(boardFile(await activeMode(), asked.tab)), asked.tab);
}

export async function getSlate() {
  return getJson("baked/slate.json");
}

// The player card (D6): the app's own builder, run in the browser on his baked row and his club's two NFLDepthCharts files.
const ndcFiles = new Map();
function ndcFile(url, problem, check) {
  if (!ndcFiles.has(url)) {
    const p = getJson(url).then((data) => {
      const bad = problem(data, check);
      if (bad) throw new Error(bad);
      return { data, fetchedAt: new Date().toISOString(), stale: false };
    });
    p.catch(() => ndcFiles.delete(url));
    ndcFiles.set(url, p);
  }
  return ndcFiles.get(url);
}

export async function getPlayerCard(id, sd = null) {
  const board = await baked(sd ? `baked/showdown/${encodeURIComponent(sd)}/board.json` : "baked/board.json");
  const found = Array.isArray(board?.rows) ? board.rows.find((r) => String(r.id) === String(id) || (r.cptId != null && String(r.cptId) === String(id))) : null;
  if (!found) return siteError("UNKNOWN_PLAYER", "That player is not on the published slate.");
  const season = board.slate?.season;
  if (!Number.isInteger(season)) return siteError("NO_SLATE", "The published slate carries no season.");
  const row = identityOf(found);
  const done = (body) => ({ ok: true, generatedAt: new Date().toISOString(), stale: [], ...body });
  const early = precheck(row);
  if (early) return done({ ...early, source: null });
  const abbr = ndcAbbr(row.team);
  const [team, gamelog] = await Promise.allSettled([
    ndcFile(teamFileUrl(abbr), teamFileProblem, { abbr, season }),
    ndcFile(gamelogUrl(abbr), gamelogProblem, { abbr, season }),
  ]);
  // G68: a team file that cannot be read drops only its own part; with the game log also unreadable there is nothing to show.
  if (team.status === "rejected" && gamelog.status === "rejected") return siteError("SOURCE_UNAVAILABLE", `NFLDepthCharts' team file for ${abbr} could not be read: ${team.reason.message}`);
  return done(buildCard(row, {
    team: team.status === "fulfilled" ? team.value : null,
    teamError: team.status === "rejected" ? `NFLDepthCharts' team file for ${abbr} could not be read: ${team.reason.message}` : null,
    gamelog: gamelog.status === "fulfilled" ? gamelog.value : null,
    gamelogError: gamelog.status === "rejected" ? `NFLDepthCharts' game-log file for ${abbr} could not be read: ${gamelog.reason.message}` : null,
  }));
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

/** The baked board of `tab` with this browser's override changes, for the Optimizer and device saves (D55: a star made here counts). */
async function bakedVisitorBoard(tab = "gpp") {
  return visitorBoard(await baked(boardFile(await activeMode(), tab)), tab);
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

/** `board` with this browser's override changes for `tab` of the published week merged in (site-overrides.js). */
async function visitorBoard(board, tab = "gpp") {
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
  return boardWithEdits(weightedBoard(board, pub), pub.slate, pageStorage(), pub.season, pub.week, classicAdapter(tab));
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

// The override writes (PUT /api/overrides, DELETE /api/overrides/:id, DELETE /api/overrides, each with a `tab`) on a fresh copy of the
// baked board of that tab. Answers as the routes do: the whole merged board, or {ok:false, error} (storage switched off, or a
// value the app would refuse), leaving the board and the saved changes as they were.
async function overrideWrite(tab, change) {
  const asked = readTab(tab);
  if (asked.error) return siteError("VALIDATION_ERROR", asked.error);
  const [board, pub] = await Promise.all([getJson(boardFile(await activeMode(), asked.tab)), publishedSlate()]);
  if (!board || board.ok === false || !Array.isArray(board.rows) || !pub) {
    return board?.ok === false ? board : siteError("NO_SLATE", "No slate has been uploaded yet.");
  }
  if (!sameSlate(board, pub.slate)) return SITE_UPDATED();
  const result = change(pageStorage(), pub.season, pub.week, weightedBoard(board, pub), pub.slate, classicAdapter(asked.tab));
  return result.error ? siteError(result.error.code, result.error.message) : result.board;
}

/** The app's saved lineups (baked, read-only) plus this device's, newest first, as GET /api/lineups answers. A device lineup the app also holds (same men, mode and slate) is
 *  left out of the list, so Saved shows and counts one set once; the device's copy stays in its storage. */
async function lineupsWithDevice(appLineups) {
  const wk = await publishedWeek();
  const device = wk ? readDeviceLineups(pageStorage(), wk.season, wk.week) : [];
  const app = appLineups ?? [];
  return sortedNewestFirst([...app, ...device.filter((d) => !findDuplicate(d.slots, lineupModeOf(d), d.slate, app))]);
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

// Pull now (D71): the button keeps its place on the site, disabled, with this sentence; the cloud job and a working button come later.
const PULL_SENTENCE ="Pulling runs in the app.";

export function postPullNow() {
  return readOnly();
}

export async function getPullStatus() {
  return { ok: true, site: true, sentence: PULL_SENTENCE, running: null, last: null };
}

export async function getMode() {
  return { ok: true, mode: await activeMode() };
}

// The header's Current | TwoGun switch is a preset over every source choice, as in the app, so this browser's weights for the week go with it:
// after a weight change the board reads "custom" and a click on either side must land on that side's own board.
async function clearWeights() {
  try {
    const pub = await publishedSlate();
    if (pub) pageStorage()?.removeItem(weightsKey(pub.season, pub.week));
  } catch (e) {
    console.warn("site weights: the saved weights could not be cleared by the mode switch", e);
  }
}

// POST /api/mode: answers the board in the new mode, as the route does; nothing leaves the browser. A board that cannot
// be read or merged leaves the mode as it was.
export async function postMode(mode) {
  if (!Object.hasOwn(BOARD_FILE, mode)) return siteError("VALIDATION_ERROR", "mode must be one of current, twogun");
  const file = await getJson(BOARD_FILE[mode]);
  if (file && file.ok !== false && Array.isArray(file.rows)) await clearWeights();
  const board = await visitorBoard(file);
  if (!board || board.ok === false || !Array.isArray(board.rows)) return board?.ok === false ? board : siteError("NO_SLATE", "No slate has been uploaded yet.");
  chosenMode = mode;
  try {
    pageStorage()?.setItem(MODE_KEY, mode);
  } catch { /* storage switched off: the choice lasts until the page is closed */ }
  return board;
}

// Each takes the app's `tab` (absent: GPP); a star or a note is kept once for both tabs (site-overrides.js).
export function putOverrides(patch, tab) {
  return overrideWrite(tab, (storage, season, week, board, slate, adapter) => putEdits(storage, season, week, board, slate, patch, adapter));
}

export function deleteAllOverrides(tab) {
  return overrideWrite(tab, (storage, season, week, board, slate, adapter) => resetAllEdits(storage, season, week, board, slate, adapter));
}

export function deleteOverride(playerId, tab) {
  return overrideWrite(tab, (storage, season, week, board, slate, adapter) => resetPlayerEdits(storage, season, week, board, slate, String(playerId), adapter));
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

// The Optimizer's work runs in a module worker (opt-worker.js) when the browser allows one, else on the page's thread
// (site-worker.js, the one copy of the runner, which the Showdown Optimizer uses too).
const GENERATE_FAILED = () => siteError("LINEUP_GENERATE_FAILED", "Could not make lineups.");

const runGenerate = createWorkerRunner({
  kind: "classic", failed: GENERATE_FAILED, busy: () => siteError("GENERATE_BUSY", "Lineups are already being made; try again when that finishes."), // the route's own 409, so a Build waits out the quiet Left out build (lineup-left-out-panel.js)
  finish: async (args, partial, reason) => (await import("./site-generate.js")).generateResponse({ ...args, partial: endedSiteResult(partial, reason, args.body?.settings?.count ?? 1) }),
  onPage: async (args, deadline) => (await import("./site-generate.js")).generateResponse({ ...args, deadline }),
});

/** Ends the build in hand with the lineups finished so far (the Stop button). */
export function stopLineupGenerate() {
  return runGenerate.stop();
}

/** False on the page-thread fallback, where nothing can answer a click until the build is done. */
export const canStopLineupGenerate = () => runGenerate.canStop();

// Body and answer as POST /api/lineup/generate. Existing lineups (uniqueness and exposure) are this device's saved
// lineups of the week; the app's own saved lineups are never counted (D69). Never throws: there is no server on the
// site, so a failure is answered as the route's own LINEUP_GENERATE_FAILED, never as an unreachable server.
export async function postLineupGenerate(payload) {
  try {
    return await runGenerate(async () => {
      const [board, slate, wk] = await Promise.all([bakedVisitorBoard(tabOfMode(payload?.settings?.mode)), baked("baked/slate.json"), publishedWeek()]); // a Cash build on Cash's own typed numbers, as the route
      const saved = wk ? readDeviceLineups(pageStorage(), wk.season, wk.week) : [];
      return { board, slate, body: payload, saved };
    });
  } catch (e) {
    console.error("lineup generate: failed", e);
    return GENERATE_FAILED();
  }
}

// Body and answer as POST /api/lineups, but the lineup is kept in this browser only (site-lineups.js).
export async function postLineup(payload) {
  const [board, wk, app] = await Promise.all([bakedVisitorBoard(tabOfMode(payload?.mode)), publishedWeek(), appLineups()]); // saved on its own mode's tab, as the route
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
  const [wk, app] = await Promise.all([publishedWeek(), appLineups()]);
  const storage = pageStorage();
  const stored = wk ? readDeviceLineups(storage, wk.season, wk.week).find((l) => l.id === id) : null;
  const board = await bakedVisitorBoard(tabOfMode(stored?.mode)); // re-snapshotted on its own mode's board, as the route
  if (!board || board.ok === false || !wk) return board?.ok === false ? board : siteError("NO_SLATE", "No slate has been uploaded yet.");
  const unavailable = () => siteError("DEVICE_STORAGE_UNAVAILABLE", "This browser is not letting the site change its saved lineups (storage is switched off).");
  if (!storage || !weekKeys(storage, wk.season, wk.week)) return unavailable(); // unlistable storage is not "no such lineup"
  const device = readDeviceLineups(storage, wk.season, wk.week);
  const existing = device.find((l) => l.id === id);
  if (!existing) {
    return app.some((l) => l.id === id)
      ? siteError("READ_ONLY", "App lineups cannot be changed here; change a man and Save lineup keeps a version on this device.")
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
