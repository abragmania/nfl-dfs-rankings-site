// The Showdown Optimizer (Adam 2026-10-19 10:31 PM: sketch A, "start making this go live"; PROJECT.md Part 4 "Showdown Optimizer
// port"): the classic Optimizer's GPP and Cash screen on a Showdown, under the Showdown Optimizer tab beside the one-lineup builder,
// which stays as it is. This file holds the page state (the settings per showdown key, the batch on screen, busy flags), the two
// requests (POST .../lineup/generate here; saves through ./api.js postShowdownLineup) and the wiring; optimizer-state.js has the
// pure settings and request rules, optimizer-view.js the markup. lineup.js calls syncOptimizer before each draw, puts the pieces
// in its panel and calls wireOptimizer after; the player pool (pool.js) asks poolControls for each row's boxes and buttons.
// Live app only (as the meter): the published site and sample mode have no generate route, so nothing here is drawn there.
import { isSampleMode } from "../api.js";
import { bumpControlHtml, bumpFigureOnlyHtml, wireBumpButtons, bumpPatch } from "../bump-control.js"; // Adam 2026-10-22: ± bump on the pool rows' projection (its own column since A1)
import { rowResetHtml, rowResetPatch } from "../row-reset.js"; // B12 (round 3): the row's reset
import { limitsCrossed } from "../limit-cross.js"; // item 18
import { wireLimitBox, flushOpenLimit, limitRefusals } from "../limit-box.js"; // A3 (round 4): the pool's Min % and Max % boxes save when they close, as classic's do
import { projEditHtml, ownEditHtml, isTyped, starHtml, noteSlotHtml } from "./pool-edit.js"; // B2, B3, C23: the star, the typed Proj and Own, the note's pencil
import { onSitePage } from "../tabs.js"; // the one is-site check
import { parsePct, uniqueSavedName, duplicateSaveStatus } from "../lineup.js";
import { countBelowMin, syncCountNote, COUNT_MIN_SENTENCE, fullLineupText } from "../lineup-settings.js";
import { toggleMustHave, bulkUids, filterBarHtml } from "../lineup-filter.js";
import { postShowdownLineup, getShowdowns, supports, stopShowdownLineupGenerate, canStopShowdownLineupGenerate } from "./api.js"; // supports: D71, what the public site implements
import { afterBuildingDelay, goSitsBelow, stopFailure } from "../lineup-stop.js";
import { answerTone } from "../row-message.js";
import { resyncMeterExcludes } from "./lineup-meter.js";
import { resyncSwapsExcludes } from "./lineup-swaps.js";
import { requestFailureText } from "./read-json.js"; // the one JSON reader (🔵 866b0ce B3, B4)
import { postShowdownGenerate, putShowdownOverrides, deleteShowdownOverrides, resultsFromAnswer, savedKeysOf, saveBody } from "./optimizer-requests.js"; // the requests and plain shapes, moved out in round 4
import * as S from "./optimizer-state.js";
import * as V from "./optimizer-view.js";

const browserStorage = () => window.localStorage;
const BUSY_TEXT = "Lineups are already being made; try again when that finishes.";

const opt = {
  key: null, // the showdown these settings and this batch belong to
  ks: S.defaultKeyState(), // {mode, gpp, cash} for opt.key, mirrored to localStorage on every change
  generating: false,
  buildingShown: false, // the build has run a second, so the screen says so (lineup-stop.js)
  buildingBelow: false, // the Make button sits on its own line under the summary, so the build keeps that layout
  stopping: false, // Stop was pressed and the build is ending: the button reads "Stopping..." (lineup-stop.js)
  stopError: "", // the sentence under Stop when the server did not hear it (optimizer standard D18)
  saving: false,
  error: null, // the server's sentence for a refused or failed Make
  errorTone: "error", // "warn" for a build already running (a notice, not a failure), else "error" (row-message.js)
  formError: null, // a box that is not a percent: blocks Make
  saveError: null,
  saveTone: "error", // "warn" when saveError is only "N saved, M already saved", else "error"
  results: null, // the batch on screen, see doGenerate
  expSortDir: "desc",
  mustHave: [], // the "only lineups with" keys, in the order chosen ("cpt:<person>" / "flex:<person>", D77); page-only, hides and never deletes
  mustHaveNames: {}, // key -> the chip's words
};
let seq = 0;
let storage = browserStorage;
let listShowdowns = () => getShowdowns(); // GET /api/showdown, the loaded showdowns (B11)

/** Test hook: the page state, a storage stand-in and a stand-in for the loaded-showdowns read. */
export function optimizerState() {
  return opt;
}
export function setOptimizerStorage(getStorage, list = null) {
  storage = getStorage;
  if (list) listShowdowns = list;
}

/** True on the live app, and on the published site once it implements the generate route (D71, Adam 4:48 PM 2026-10-29: anything on the local site is on the public site); sample mode has none. */
export function optimizerLive() {
  if (typeof window === "undefined") return false;
  if (onSitePage()) return supports("generate");
  return !isSampleMode();
}

const modeState = () => opt.ks[opt.ks.mode];

/** The excludes of the mode on screen (candidate ids, as the generate body sends them), for the builder's meter (🔵 866b0ce B1:
 *  its gap to best is then measured as a batch card's is); none off the live app, where no exclude can be set. */
export function optimizerExcludes() {
  return optimizerLive() ? [...modeState().excludes] : [];
}

/** The locks of the mode on screen as the builder's seats see them (A18, D3): {cpt: Set of person ids locked as Captain, flex: Set locked in FLEX}. Empty off the live app. */
export function optimizerLocks(board) {
  const out = { cpt: new Set(), flex: new Set() };
  if (!optimizerLive()) return out;
  const { candOf } = S.boardIndex(board);
  for (const id of modeState().locks) {
    const c = candOf.get(id);
    if (c) (c.role === "CPT" ? out.cpt : out.flex).add(c.person);
  }
  return out;
}

/** The man left a seat (his slot was clicked, Unlock): his lock in that seat goes with him, in both modes (the seats are one set; a lock left in the other mode would come back on
 *  with nobody in the seat), as classic's removeSlot drops it. */
export function releaseSeatLock(row, kind) {
  if (!optimizerLive() || !row) return;
  const id = kind === "cpt" ? (row.cptId == null ? null : String(row.cptId)) : String(row.id);
  if (id === null) return;
  let next = opt.ks;
  for (const mode of S.MODES) if (next[mode].locks.includes(id)) next = { ...next, [mode]: { ...next[mode], locks: next[mode].locks.filter((x) => x !== id) } };
  if (next !== opt.ks) {
    opt.ks = next;
    persist();
  }
}

/** Clear all and Load replace the whole lineup: every lock of this game goes, in both modes (none is left pointing at a seat that is not his any more). */
export function releaseAllLocks() {
  if (!optimizerLive()) return;
  if (!S.MODES.some((mode) => opt.ks[mode].locks.length)) return;
  opt.ks = { ...opt.ks, gpp: { ...opt.ks.gpp, locks: [] }, cash: { ...opt.ks.cash, locks: [] } };
  persist();
}

// The men in the builder's seats, as candidate ids (the Captain by his Captain id): seats.js registers the reader, so the Optimizer can hold them in a Build and say so (item 11)
// without importing the builder.
let seatedSource = () => [];
export function setSeatedSource(fn) {
  seatedSource = typeof fn === "function" ? fn : () => [];
}
const seatedNow = (board) => (optimizerLive() ? seatedSource(board) : []);

function persist() {
  if (opt.key) S.writeKeyState(storage, opt.key, opt.ks);
}

function setModeState(next) {
  opt.ks = { ...opt.ks, [opt.ks.mode]: next };
  persist();
}

/** Empties the "only lineups with" list: a new batch, another showdown or the Clear button (classic lineup.js clearMustHave). */
function clearMustHave() {
  opt.mustHave = [];
  opt.mustHaveNames = {};
}

/** The uids of the lineups on screen: all of them, or only those holding every chosen man (classic shownNewUids); Save all and
 *  Discard all act on these only. */
function shownUids() {
  return bulkUids(opt.results?.lineups ?? [], opt.mustHave, S.sdPlayersOf);
}

/** Before each draw: another showdown loads its own settings and drops the last one's batch; ids gone from the board are dropped. */
export function syncOptimizer(key, board) {
  if (key !== opt.key) {
    opt.key = key;
    opt.ks = key ? S.readKeyState(storage, key) : S.defaultKeyState();
    opt.results = null;
    clearMustHave();
    opt.error = null;
    opt.formError = null;
    opt.saveError = null;
  }
  if ((board?.rows ?? []).length) opt.ks = { ...opt.ks, gpp: S.pruneToBoard(opt.ks.gpp, board, "gpp"), cash: S.pruneToBoard(opt.ks.cash, board, "cash") };
  if (!prunedStorage && key && key !== pruneFailedFor && optimizerLive()) {
    prunedStorage = true;
    pruneGoneShowdowns(key).catch((e) => {
      prunedStorage = false; // the list could not be read: storage stays as it is and the next showdown switch tries again
      pruneFailedFor = key;
      if (typeof console !== "undefined") console.warn("Showdown Optimizer: the loaded showdowns could not be read to tidy saved settings", e);
    });
  }
}

let prunedStorage = false; // the stored settings are tidied once per page view (🔵 866b0ce B11)
let pruneFailedFor = null; // the showdown whose tidy read failed: no retry on its redraws, only after a switch

/**
 * Drops the stored settings of showdowns no longer loaded (🔵 866b0ce B11: nfldfs.sdOptimizer.v1 kept every key forever). The
 * loaded list is GET /api/showdown's; an answer that is refused, unreadable or empty is "unknown", so nothing is dropped (a cold
 * read is never "none loaded"); the showdown on screen is always kept. Resolves to the keys dropped. `list` is a test stand-in.
 */
export async function pruneGoneShowdowns(currentKey, list = listShowdowns) {
  const data = await list();
  const keys = data && data.ok !== false && Array.isArray(data.showdowns) ? data.showdowns.map((s) => s?.key).filter((k) => typeof k === "string" && k) : [];
  if (!keys.length) return [];
  return S.dropStoredKeysExcept(storage, [...keys, currentKey].filter(Boolean));
}

// ---------- the request ----------
// The generate and overrides requests, the batch kept from an answer and the saved-lineup helpers are optimizer-requests.js's (moved there in round 4); every name is still exported from here.
export { postShowdownGenerate, putShowdownOverrides, deleteShowdownOverrides, resultsFromAnswer, savedKeysOf, saveBody };

async function doGenerate(ctx) {
  if (opt.generating || opt.saving) return;
  flushOpenLimit(); // a Min % or Max % box still open is read as a click away reads it, before the request is made (A3)
  const refused = limitRefusals().filter((r) => r.selector.startsWith("[data-sd-cap")); // a text a box refused (this press's blur included) is not silently built around: the Build stops and names him
  if (refused.length) {
    opt.formError = refused[0].sentence;
    return ctx.commit();
  }
  const mode = opt.ks.mode;
  const seated = seatedNow(ctx.board); // the men in the seats are held as classic holds its slots (item 11)
  const held = S.heldCandidates(modeState(), seated);
  opt.formError = countBelowMin(modeState().count) ? COUNT_MIN_SENTENCE : held.length >= 6 ? fullLineupText(6) : S.capProblem(modeState(), mode, ctx.board); // item 18: a count below 1 is said, not made into 1
  if (opt.formError) return ctx.commit();
  const sent = S.buildGenerateBody(modeState(), mode, ctx.board, seated); // no boardMode: the server builds on this game's served board
  const madeFor = opt.key;
  opt.generating = true;
  opt.stopping = false;
  opt.stopError = "";
  opt.error = null;
  opt.saveError = null;
  ctx.commit();
  const cancelShow = afterBuildingDelay(() => {
    if (!opt.generating) return;
    opt.buildingBelow = goSitsBelow(ctx.container?.querySelector("#sd-opt-go-btn"), ctx.container?.querySelector("#sd-opt-summary"));
    opt.buildingShown = true;
    ctx.commit();
  });
  let stale = false;
  try {
    const data = await (ctx.post ?? postShowdownGenerate)(madeFor, sent);
    // Another showdown on screen now: nothing of this answer is kept, but the screen is still redrawn below so its Make button
    // is live again and "Finding the best lineups" goes (🔵 866b0ce B2).
    stale = opt.key !== madeFor;
    if (!stale && (!data || data.ok === false || data.error)) {
      const busy = data?.error?.code === "GENERATE_BUSY";
      opt.error = busy ? data.error.message || BUSY_TEXT : data?.error?.message ?? "Could not make lineups.";
      opt.errorTone = answerTone(data?.error?.code); // a refusal (bad settings, a build already running) is amber; a build that failed outright is red
    } else if (!stale) {
      opt.results = resultsFromAnswer(data, sent, seq, ctx.board ?? null);
      clearMustHave(); // a new batch starts unfiltered (D77)
      seq += opt.results.lineups.length;
    }
  } catch (e) {
    stale = opt.key !== madeFor;
    if (!stale) {
      opt.error = requestFailureText(e); // a non-JSON answer reads "The server's answer could not be read (status N)." (B3)
      opt.errorTone = "error";
    }
  } finally {
    cancelShow();
    opt.generating = false;
    opt.stopping = false;
    opt.stopError = "";
    opt.buildingShown = false;
  }
  ctx.commit();
  if (stale) return;
  try {
    ctx.container?.querySelector?.("#sd-opt-results")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  } catch (e) {
    // Scrolling is a convenience only.
  }
}

// ---------- saves ----------

async function saveCards(uids, ctx) {
  if (opt.saving || opt.generating || !opt.results) return;
  const results = opt.results;
  const key = opt.key;
  opt.saving = true;
  opt.saveError = null;
  ctx.commit();
  const skipped = [];
  let savedCount = 0;
  for (const uid of uids) {
    const lineup = results.lineups.find((l) => l.uid === uid);
    if (!lineup || savedKeysOf(ctx.getSaved(), results.mode, ctx.board).has(S.sdSetKey(lineup.slots, S.boardIndex(ctx.board).personOf))) continue;
    const stem = results.mode === "cash" ? "Cash" : "Lineup";
    const cardName = `${stem} ${lineup.index + 1}`;
    try {
      // The card's own name is kept unless this showdown already has it (names stay unique, as classic keeps them per slate).
      const data = await (ctx.save ?? postShowdownLineup)(key, saveBody(lineup, results, uniqueSavedName(cardName, ctx.getSaved().map((l) => l.name), stem)));
      if (opt.key !== key) break;
      if (data?.error?.code === "DUPLICATE_LINEUP") {
        skipped.push({ name: cardName, message: data.error.message });
        continue;
      }
      if (!data || data.ok === false) {
        opt.saveError = data?.error?.message ?? "Could not save the lineup.";
        break;
      }
      if (Array.isArray(data.lineups)) ctx.setSaved(data.lineups);
      savedCount++;
    } catch (e) {
      opt.saveError = requestFailureText(e);
      break;
    }
  }
  opt.saveTone = "error";
  if (skipped.length) {
    const status = duplicateSaveStatus(uids.length, savedCount, skipped);
    if (!opt.saveError) opt.saveTone = "warn"; // only "already saved": a notice, amber; a real failure alongside keeps it red
    opt.saveError = opt.saveError ? `${status}. ${opt.saveError}` : status;
  }
  opt.saving = false;
  ctx.commit();
}

// ---------- the pieces lineup.js draws ----------

const showing = () => opt.generating && opt.buildingShown; // a build under a second shows nothing (lineup-stop.js); doGenerate itself refuses a second click
const busy = () => opt.generating || opt.saving;

const bandView = (board) => ({ mode: opt.ks.mode, ms: modeState(), board, error: opt.error, errorTone: opt.errorTone, formError: opt.formError, seated: seatedNow(board) });

/** The Optimizer band's head (title, GPP | Cash switch, refusal sentences), at the top of the left column; "" off the live app. */
export function optimizerBandHeadHtml(board) {
  if (!optimizerLive()) return "";
  return V.bandHeadHtml(bandView(board));
}

/** The Optimizer band's Pool and Build boxes, under the build status line and above the Make row (Adam 2026-10-20: the six slots
 *  and the meter come first); "" off the live app. */
export function optimizerBandBoxesHtml(board) {
  if (!optimizerLive()) return "";
  return V.bandBoxesHtml(bandView(board));
}

/** The whole band, head then boxes (the pieces' old order); lineup.js draws the two apart. */
export function optimizerBandHtml(board) {
  return optimizerBandHeadHtml(board) + optimizerBandBoxesHtml(board);
}

/** The Make row (the summary and Make N lineups), the last piece of the builder's column, sticky as classic's footer; "" off the live app.
 *  `board`: the served board (its reading names the cash basis, its rows whether Median can be built). */
export function optimizerGoRowHtml(board) {
  if (!optimizerLive()) return "";
  return V.goRowHtml({ summary: S.summaryText(modeState(), opt.ks.mode, board), generating: showing(), busy: showing() || opt.saving, formError: opt.formError, canStop: canStopShowdownLineupGenerate(), below: opt.buildingBelow, stopping: opt.stopping, stopError: opt.stopError });
}

/** The batch (its head, source line, exposure tables and cards), drawn full width below both columns (Adam 2026-10-19 11:17 PM:
 *  "generated lineups should go 4 across"); "" off the live app. */
export function optimizerResultsBlockHtml(board, saved, confirm = null) {
  if (!optimizerLive()) return "";
  const r = opt.results;
  const keys = r ? savedKeysOf(saved, r.mode, board) : new Set();
  const { personOf } = S.boardIndex(board);
  const savedFlags = r ? r.lineups.map((l) => keys.has(S.sdSetKey(l.slots, personOf))) : [];
  return V.resultsHtml({ results: r, generating: showing(), saveError: opt.saveError, saveTone: opt.saveTone, busy: busy(), savedFlags, board, expSortDir: opt.expSortDir, mustHave: opt.mustHave, mustHaveNames: opt.mustHaveNames, confirm });
}

/** The generated lineup `uid` of the batch on screen (a result card's Load), or null. */
export function resultLineup(uid) {
  return opt.results?.lineups.find((l) => l.uid === uid) ?? null;
}

/**
 * The Saved half of the "only lineups with" filter (D77, Adam 2026-10-11: "this should work with new or saved"): what the saved section
 * (lineup-saved.js savedLineupsSectionHtml) needs to filter its cards by opt.mustHave, to draw the Captain and FLEX exposure tables over
 * the cards shown (no Min / Max marks, they belong to a batch) and the chips bar with Clear (the batch's own bar can be far above). null off the
 * live app, where the section is drawn without any of it. A saved slot may carry a man's FLEX id or his Captain id, so each is read as
 * his person id (boardIndex), and his ownership is the board's current figure for the role, the snapshot's when he left the board.
 */
export function optimizerSavedFilter(board) {
  if (!optimizerLive()) return null;
  const { personOf, rowOf } = S.boardIndex(board);
  const viewOf = (l) => ({
    slots: (l?.slots ?? []).map((s) => {
      const personId = personOf.get(String(s.playerId)) ?? String(s.playerId);
      const row = rowOf.get(personId);
      const cpt = String(s.slot ?? "").toUpperCase() === "CPT";
      return { slot: s.slot, personId, name: row?.name ?? s.name, own: row ? (cpt ? row.ownCpt : row.ownFlex) ?? null : s.own ?? null };
    }),
  });
  const chosen = opt.mustHave;
  return {
    mustHave: chosen,
    playersOf: (l) => S.sdPlayersOf(viewOf(l)),
    exposureHtml: (shown, of) => V.exposureHtml(shown.map(viewOf), board, opt.expSortDir, null, { isChosen: (key) => chosen.includes(String(key)) }, of, "saved"),
    barHtml: (shown, total) => filterBarHtml(chosen.map((key) => ({ key, name: opt.mustHaveNames[key] ?? key })), shown, total), // the batch's bar again: it can be screens above
    noMatchText: V.NO_MATCH_TEXT,
  };
}

const SITE_BUMP_TITLE = "The ± bump runs in the app";

/** The ± pair in the pool's thumbs column (`isCpt`: the Captain list's): live in the app; on the public site, where the PUT has no
 *  stand-in (supports("overrides") is false), the pair keeps its place disabled with a plain sentence (D71, as classic's lineup-view.js
 *  draws it with no bump writer); "" off the live screen (sample mode). */
export function poolThumbsHtml(row, isCpt, canSave = supports("overrides")) {
  if (!optimizerLive()) return "";
  const kind = isCpt ? "cpt" : null;
  return canSave ? bumpControlHtml(row, { kind }) : bumpControlHtml(row, { enabled: false, kind, title: SITE_BUMP_TITLE });
}

/** The projection figure of a pool row with the bump's tint and hover (the thumbs have their own column, A1), as the typed-Proj editor (B3: click to type; the Captain list's
 *  CPT Proj stores the number over 1.5 under his FLEX id, pool-edit.js); null off the live screen, where the pool draws its own figure. */
export function poolBumpHtml(row, proj, isCpt) {
  if (!optimizerLive()) return null;
  // B12 (round 3): the row's reset x beside the figure, for a man who has a typed number or a bump; the public site cannot write overrides, so it has no editor and no x there (D71).
  const canWrite = supports("overrides");
  return `${projEditHtml(row, isCpt, bumpFigureOnlyHtml(row, proj, { kind: isCpt ? "cpt" : null }), canWrite)}${canWrite ? rowResetHtml(row) : ""}`;
}

/** The Own / CPT Own figure of a pool row as the typed-Own editor (B3), with the row's reset x beside a typed one; null off the live screen. */
export function poolOwnHtml(row, own, isCpt, text) {
  if (!optimizerLive()) return null;
  const canWrite = supports("overrides");
  return `${ownEditHtml(row, isCpt, text, canWrite)}${canWrite && isTyped(row, "own", isCpt ? "cpt" : "flex") ? rowResetHtml(row) : ""}`;
}

/**
 * What the one player pool (pool.js setPoolControls; Adam 2026-10-26, the Rankings table as the pool) asks for each row: the rows it
 * lists, the Min % / Max % heads and boxes of each role, each role's lock and exclude and the In button, the row's look
 * and the projection cell's ± bump. Off the live app every answer is the pool's own (its rows, nothing added).
 */
export const poolControls = {
  live: () => optimizerLive(),
  mode: () => opt.ks.mode, // GPP or Cash: the Columns list is remembered per mode (A17)
  // The Columns keys the pool can draw beyond its figures (columns.js SHOWDOWN_COLUMNS): none off the live app; Min % and Max % in GPP; the Captain's own lock and exclude on the FLEX list (C21).
  available: (tab) => (optimizerLive() ? ["star", "thumbs", "in", "lock", "exclude", ...(opt.ks.mode === "gpp" ? ["min_pct", "max_pct", ...(tab === "flex" ? ["cpt_min_pct", "cpt_max_pct"] : [])] : []), ...(tab === "flex" ? ["captain"] : [])] : []),
  rows: (all, shown) => (optimizerLive() ? V.poolRows(all, shown, modeState(), "All") : shown), // locked, included and excluded men stay listed so they can be undone; the filter bar's position chip applies after (pool.js)
  capCell: (row, kind, which) => (optimizerLive() ? V.poolCapCell(row, kind, which, modeState(), opt.ks.mode, parsePct) : ""),
  button: (row, kind, action) => (optimizerLive() ? V.poolButtonHtml(row, kind, action, modeState()) : ""), // "lock", "include" (In: the same for both roles) or "exclude"
  // Excluded from every lineup dims the row (a Captain-only exclude leaves the row as it is: he can still be FLEX); a lock is the icon beside the name, not a tint (C20).
  rowClass: (row, tab) => (optimizerLive() ? V.poolRowClass(row, tab === "cpt" ? "cpt" : "flex", modeState()) : ""), // C21: a man excluded as Captain dims on the Captain list as a FLEX-excluded man does on FLEX
  lockIcon: (row) => (optimizerLive() ? V.poolLockIconHtml(row, modeState()) : ""),
  excluded: (row, tab) => optimizerLive() && S.excludeState(modeState(), row, tab === "cpt" ? "cpt" : "flex").on, // A18: an excluded man's row on that list is greyed (seat-picker.js)
  thumbs: (row, isCpt = false) => poolThumbsHtml(row, isCpt), // the ± pair (Adam 2026-10-22), in its own column; one pair per man moves both his figures
  projCell: (row, proj, isCpt = false) => poolBumpHtml(row, proj, isCpt), // the Proj figure (FLEX tab) or the CPT proj figure (Captain tab) with the bump's tint
  ownCell: (row, own, isCpt = false, text = "") => poolOwnHtml(row, own, isCpt, text), // B3: the Own figure as the typed-Own editor
  canType: () => optimizerLive() && supports("overrides"), // B3: a projection can be typed here (the app), so the greyed row's reason can offer it (seat-picker.js)
  starCell: (row) => (optimizerLive() ? starHtml(row, supports("overrides")) : ""), // B2: the star; on the site a published star shows, read only
  noteSlot: (row) => (optimizerLive() ? noteSlotHtml(row, supports("overrides")) : ""), // C23: the pencil in the name cell
  readTab: () => S.readPoolTab(storage), // the pool's Captain | FLEX tab, kept in the browser on the site too (D71)
  writeTab: (tab) => S.writePoolTab(storage, tab),
};

// ---------- wiring ----------

/** Puts the summary (which names the count) and the included / locked line back after a box changed, without a redraw (focus stays). */
function refreshLines(container, board) {
  const summary = container.querySelector("#sd-opt-summary");
  if (summary) summary.textContent = S.summaryText(modeState(), opt.ks.mode, board);
  const info = container.querySelector("#sd-opt-lockinfo");
  if (info) {
    const text = S.statusLineText(modeState(), board, seatedNow(board));
    info.textContent = text;
    info.hidden = !text;
  }
}

function clearFormError(container) {
  if (!opt.formError) return;
  opt.formError = null;
  container.querySelector(".sd-opt-head .opt-form-error")?.remove();
  container.querySelector(".sd-opt-go .opt-form-error-footer")?.remove();
}

/**
 * Wires the pool's row controls (called as the pool is drawn or repainted). `ctx` = {container, board, repaintPool(),
 * boardWrite(send, label)}: a lock, In or exclude click changes this mode's settings, saves them and repaints the pool and the lines
 * in place; a ± press (Adam 2026-10-22) sends the new steps through ctx.boardWrite, view.js's applier of an answered board.
 */
export function wirePoolControls(listEl, ctx) {
  if (!optimizerLive()) return;
  const rowOf = (id) => (ctx.board?.rows ?? []).find((r) => String(r.id) === String(id));
  wireBumpButtons(listEl, { rowOf, onBump: (id, steps) => ctx.boardWrite?.((key) => putShowdownOverrides(key, bumpPatch(id, steps)), "the projection bump") }); // true once taken, false when refused
  listEl.querySelectorAll("[data-action='row-reset']").forEach((btn) => { // B12: clears his typed numbers and bump; a refusal is said beside his row, in red
    btn.addEventListener("click", async () => {
      const row = rowOf(btn.dataset.id);
      if (!row || btn.disabled) return;
      btn.disabled = true;
      const taken = await ctx.boardWrite?.((key) => putShowdownOverrides(key, rowResetPatch(row)), "the reset");
      if (!taken) ctx.rowError?.(row.id, "The reset was not saved. The message above says why.");
    });
  });
  listEl.querySelectorAll("[data-sd-opt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = rowOf(btn.dataset.id);
      if (!row) return;
      const ms = modeState();
      const kind = btn.dataset.kind === "cpt" ? "cpt" : "flex";
      const next = btn.dataset.sdOpt === "lock" ? S.toggleLock(ms, row, kind, ctx.board) : btn.dataset.sdOpt === "include" ? S.toggleInclude(ms, row) : S.toggleExclude(ms, row, kind);
      if (next === ms) return;
      if (btn.dataset.sdOpt === "lock" && ctx.onLock) {
        // D3 (round 3 fixes): Lock seats him in that seat by the click's rules; a man who cannot sit is not locked, and the message is beside his row. Unlock takes him out.
        const taken = ctx.onLock(row, kind, !S.isLocked(ms, row, kind));
        if (taken) setModeState(next);
        ctx.commit();
        return;
      }
      setModeState(next);
      ctx.repaintPool();
      refreshLines(ctx.container, ctx.board);
      if (next.excludes !== ms.excludes) {
        resyncMeterExcludes(optimizerExcludes()); // the builder's meter re-measures against the same best as the batch (B1)
        resyncSwapsExcludes(optimizerExcludes()); // after the meter: an excluded man is no longer offered as a swap
      }
    });
  });
  // The Min % and Max % boxes (A3, round 4; limit-box.js, the box classic's pool uses): typing changes nothing until the box closes. Enter or a click away saves (an emptied box
  // removes the limit, B10), Esc puts the old text back, the hint sits under the open box, and a text that is not a percent keeps the box open on Enter and says `Not saved` on a
  // click away. A Build started while one is open reads it (doGenerate), and a redraw carries the open box into the new one (lineup.js).
  listEl.querySelectorAll("[data-sd-cap]").forEach((el) => {
    const field = el.dataset.sdCap;
    const id = el.dataset.id;
    const seat = field.startsWith("cpt") ? "cpt" : "flex";
    const crossedNow = () => limitsCrossed(modeState()[`${seat}Min`]?.[id] ?? "", modeState()[`${seat}Max`]?.[id] ?? "", parsePct);
    let wasCrossed = crossedNow();
    wireLimitBox(el, {
      selector: V.capSelector(field, id),
      // The sentence a refused text leaves (held, drawn beside the box, and stopping a Build): it names the man, the box and the old limit that stays.
      refusalText: (typed) => `${rowOf(id)?.name ?? "A player"}'s ${field.endsWith("Min") ? "Min %" : "Max %"} (${field.startsWith("cpt") ? "Captain" : "FLEX"}) was not saved: "${String(typed).trim()}" is not a percent from 0 to 100, so his old limit stays. Fix the box or clear it.`,
      doc: typeof document === "undefined" ? null : document,
      parse: parsePct,
      save: (text) => {
        const ms = modeState();
        wasCrossed = crossedNow();
        const map = { ...(ms[field] ?? {}) };
        if (text === "") delete map[id];
        else map[id] = text;
        setModeState({ ...ms, [field]: map });
      },
      afterSave: () => {
        clearFormError(ctx.container);
        refreshLines(ctx.container, ctx.board);
        if (crossedNow() !== wasCrossed) ctx.repaintPool?.(); // item 18: the row's `Min is above Max` appears or goes (an open box is carried through the repaint)
      },
    });
  });
}

function wireBand(root, ctx) {
  root.querySelectorAll("[data-opt-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.optMode === "cash" ? "cash" : "gpp";
      if (next === opt.ks.mode) return;
      opt.ks = { ...opt.ks, mode: next };
      opt.formError = null;
      persist();
      ctx.commit();
    });
  });
  for (const [sel, field] of [["#sd-opt-count", "count"], ["#sd-opt-min-unique", "minUnique"]]) {
    const el = root.querySelector(sel);
    el?.addEventListener("input", () => {
      setModeState({ ...modeState(), [field]: el.value });
      if (field === "count") {
        syncCountNote(el); // `Minimum 1` beside the box while it is below 1
        if (opt.formError === COUNT_MIN_SENTENCE && !countBelowMin(el.value)) clearFormError(ctx.container);
      }
      refreshLines(ctx.container, ctx.board);
    });
  }
  const team = root.querySelector("#sd-opt-max-team");
  team?.addEventListener("change", () => {
    setModeState({ ...modeState(), maxPerTeam: team.value });
    refreshLines(ctx.container, ctx.board);
  });
  root.querySelectorAll("[data-sd-objective]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modeState().objective === btn.dataset.sdObjective) return;
      setModeState({ ...modeState(), objective: btn.dataset.sdObjective });
      ctx.commit();
    });
  });
}

/** The exposure header's sort, on the batch's tables and the saved section's: one direction (opt.expSortDir, classic's) shared by both
 *  table sets, so a click redraws the panel and both show the new order and arrow. */
function wireExposureSort(container, ctx) {
  container.querySelectorAll(".sd-opt-results .opt-exposure [data-action='opt-exp-sort'], #sd-saved-lineups .opt-exposure [data-action='opt-exp-sort']").forEach((th) => {
    th.addEventListener("click", () => {
      opt.expSortDir = opt.expSortDir === "asc" ? "desc" : "asc";
      ctx.commit();
    });
  });
}

/** Adam 2026-10-11 (D77): a man's name in an exposure table adds him to the "only lineups with" list or takes him out; the key is
 *  role-aware, so the Captain table's row means him as Captain and the FLEX table's him at FLEX. A chip's × takes one out; Clear
 *  empties the list. Page-only; redraws through ctx.commit(). `root` = the element whose buttons to wire. */
function wirePickButtons(root, ctx) {
  root.querySelectorAll("[data-action='opt-pick']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.pickId;
      if (!key) return;
      if (!opt.mustHave.includes(key)) opt.mustHaveNames[key] = S.pickChipName(key, btn.dataset.pickName);
      opt.mustHave = toggleMustHave(opt.mustHave, key);
      ctx.commit();
    });
  });
  root.querySelectorAll("[data-action='opt-pick-remove']").forEach((btn) => {
    btn.addEventListener("click", () => {
      opt.mustHave = toggleMustHave(opt.mustHave, btn.dataset.pickKey);
      ctx.commit();
    });
  });
  root.querySelectorAll("[data-action='opt-pick-clear']").forEach((btn) => { // the batch's bar and the saved section's
    btn.addEventListener("click", () => {
      clearMustHave();
      ctx.commit();
    });
  });
}

/**
 * Wires the band, the Make row and the batch. `ctx` = {container, board, key, commit(), getSaved(), setSaved(list),
 * repaintPool(), and for tests post(key, body) / save(key, body) / stop() in place of the three requests}.
 */
export function wireOptimizer(ctx) {
  if (!optimizerLive()) return;
  const c = ctx.container;
  for (const id of ["#sd-opt-head", "#sd-opt-panel"]) {
    const piece = c.querySelector(id);
    if (piece) wireBand(piece, ctx);
  }
  c.querySelector("#sd-opt-go-btn")?.addEventListener("click", () => doGenerate(ctx));
  c.querySelector("#sd-opt-stop-btn")?.addEventListener("click", async () => {
    if (opt.stopping) return;
    opt.stopping = true; // the button reads "Stopping..." until the build's own answer ends it (D15)
    opt.stopError = "";
    ctx.commit();
    let failure = "";
    try {
      failure = stopFailure({ data: await (ctx.stop ?? stopShowdownLineupGenerate)() });
    } catch (e) {
      console.error("showdown generate: the Stop was not heard", e); // the build runs on to its answer
      failure = stopFailure({ thrown: true });
    }
    if (failure && opt.generating) {
      opt.stopping = false; // Stop is pressable again; the line under it says why (D18)
      opt.stopError = failure;
      ctx.commit();
    }
  });
  c.querySelectorAll("[data-sd-opt-save]").forEach((btn) => btn.addEventListener("click", () => saveCards([btn.dataset.sdOptSave], ctx)));
  c.querySelectorAll("[data-sd-opt-load]").forEach((btn) => btn.addEventListener("click", () => ctx.loadResult?.(btn.dataset.sdOptLoad))); // A13: the card's six men into the builder's seats (lineup.js)
  c.querySelector("[data-sd-opt-save-all]")?.addEventListener("click", () => saveCards(shownUids(), ctx)); // the shown lineups only while filtered (D77)
  c.querySelectorAll("[data-sd-opt-discard]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!opt.results) return;
      opt.results = { ...opt.results, lineups: opt.results.lineups.filter((l) => l.uid !== btn.dataset.sdOptDiscard) };
      ctx.commit();
    });
  });
  c.querySelector("[data-sd-opt-discard-all]")?.addEventListener("click", () => {
    if (opt.mustHave.length && opt.results) {
      // Filtered: discard only the lineups shown; the hidden ones stay untouched (Adam 2026-10-11, classic's rule).
      const gone = new Set(shownUids());
      opt.results = { ...opt.results, lineups: opt.results.lineups.filter((l) => !gone.has(l.uid)) };
    } else {
      opt.results = null;
      opt.saveError = null;
    }
    ctx.commit();
  });
  wirePickButtons(c, ctx); // the whole panel: the batch's tables and chips bar and the saved section's (D77)
  wireExposureSort(c, ctx);
}

/** Test hook: run Make / Save with a context of stand-ins. */
export const testHooks = { doGenerate, saveCards };
