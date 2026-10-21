// The Showdown Optimizer (Adam 2026-10-19 10:31 PM: sketch A, "start making this go live"; PROJECT.md Part 4 "Showdown Optimizer
// port"): the classic Optimizer's GPP and Cash screen on a Showdown, under the Showdown Optimizer tab beside the one-lineup builder,
// which stays as it is. This file holds the page state (the settings per showdown key, the batch on screen, busy flags), the two
// requests (POST .../lineup/generate here; saves through ./api.js postShowdownLineup) and the wiring; optimizer-state.js has the
// pure settings and request rules, optimizer-view.js the markup. lineup.js calls syncOptimizer before each draw, puts the pieces
// in its panel and calls wireOptimizer after; lineup-lists.js asks listControls for each pool row's boxes and buttons.
// Live app only (as the meter): the published site and sample mode have no generate route, so nothing here is drawn there.
import { isSampleMode } from "../api.js";
import { store } from "../state.js";
import { parsePct, uniqueSavedName, duplicateSaveStatus } from "../lineup.js";
import { newBuildId, batchBuild } from "../lineup-builds.js";
import { toggleMustHave, bulkUids, filterBarHtml } from "../lineup-filter.js";
import { lineupModeOf } from "../lineup-cash.js";
import { postShowdownLineup, getShowdowns } from "./api.js";
import { resyncMeterExcludes } from "./lineup-meter.js";
import { halfName } from "./figures-label.js";
import { resyncSwapsExcludes } from "./lineup-swaps.js";
import { readJson, requestFailureText } from "./read-json.js"; // the one JSON reader (🔵 866b0ce B3, B4)
import * as S from "./optimizer-state.js";
import * as V from "./optimizer-view.js";

const browserStorage = () => window.localStorage;
const BUSY_TEXT = "Lineups are already being made; try again when that finishes.";

const opt = {
  key: null, // the showdown these settings and this batch belong to
  ks: S.defaultKeyState(), // {mode, gpp, cash} for opt.key, mirrored to localStorage on every change
  pos: "All", // the pool's position chip, for this page view
  generating: false,
  saving: false,
  error: null, // the server's sentence for a refused or failed Make
  formError: null, // a box that is not a percent: blocks Make
  saveError: null,
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

/** True on the live app only: the published site and sample mode have no generate route (lineup-meter.js's own rule). */
export function optimizerLive() {
  if (typeof window === "undefined") return false;
  if (typeof document !== "undefined" && document.documentElement?.classList?.contains("is-site")) return false;
  return !isSampleMode();
}

const modeState = () => opt.ks[opt.ks.mode];

/** The excludes of the mode on screen (candidate ids, as the generate body sends them), for the builder's meter (🔵 866b0ce B1:
 *  its gap to best is then measured as a batch card's is); none off the live app, where no exclude can be set. */
export function optimizerExcludes() {
  return optimizerLive() ? [...modeState().excludes] : [];
}

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
    opt.pos = "All";
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

/** POST /api/showdown/<key>/lineup/generate (kept here, not in api.js: the public site's stand-in must export api.js's names exactly). */
export async function postShowdownGenerate(key, body, fetchImpl = fetch) {
  const url = `/api/showdown/${encodeURIComponent(key)}/lineup/generate`;
  const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return readJson(res);
}

/** The batch kept from a generate answer: the lineups in the server's order (each with a page id and its number), and what it was
 *  made with. Pure; `seqStart` numbers the page ids; `board` is the served board it was made on: its build time is the as-of of a
 *  batch whose answer names none, its reading (board.mode.cashMode) the build record's boardMode when the answer names none (as
 *  classic records it), and its short source names label the batch's source line (figures-label.js halfName). */
export function resultsFromAnswer(data, sent, seqStart = 0, board = null) {
  const lineups = (Array.isArray(data.lineups) ? data.lineups : []).map((l, i) => ({ ...l, uid: `s${seqStart + i + 1}`, index: i }));
  const notes = Array.isArray(data.notes) ? [...data.notes] : [];
  if (!lineups.length && !notes.length) notes.push("No lineups could be made from these locks and settings.");
  const cash = sent.settings.mode === "cash";
  return {
    mode: cash ? "cash" : "gpp",
    basis: cash ? data.basis ?? null : null,
    boardMode: data.boardMode === "twogun" || data.boardMode === "current" ? data.boardMode : board?.mode?.cashMode ?? null,
    objective: cash ? null : sent.settings.objective,
    projection: data.projection ?? null,
    ownership: data.ownership ?? null,
    figuresKey: typeof data.figuresKey === "string" && data.figuresKey !== "" ? data.figuresKey : null, // the served board's key, sent back with each save
    meter: data.meter ?? null,
    boardBuiltAt: board?.generatedAt ?? null,
    names: { projection: halfName(board, "projection"), ownership: halfName(board, "ownership") },
    lineups,
    notes,
    bends: Array.isArray(data.bends) ? data.bends : [],
    made: lineups.length,
    marks: S.exposureMarks(sent.settings),
    buildId: newBuildId(Date.now(), Math.random()), // one id per Make, shared by every lineup saved from it (lineup-builds.js)
  };
}

async function doGenerate(ctx) {
  if (opt.generating || opt.saving) return;
  const mode = opt.ks.mode;
  opt.formError = S.capProblem(modeState(), mode, ctx.board);
  if (opt.formError) return ctx.commit();
  const sent = S.buildGenerateBody(modeState(), mode, ctx.board); // no boardMode: the server builds on this game's served board
  const madeFor = opt.key;
  opt.generating = true;
  opt.error = null;
  opt.saveError = null;
  ctx.commit();
  let stale = false;
  try {
    const data = await (ctx.post ?? postShowdownGenerate)(madeFor, sent);
    // Another showdown on screen now: nothing of this answer is kept, but the screen is still redrawn below so its Make button
    // is live again and "Making lineups…" goes (🔵 866b0ce B2).
    stale = opt.key !== madeFor;
    if (!stale && (!data || data.ok === false || data.error)) opt.error = data?.error?.code === "GENERATE_BUSY" ? data.error.message || BUSY_TEXT : data?.error?.message ?? "Could not make lineups.";
    else if (!stale) {
      opt.results = resultsFromAnswer(data, sent, seq, ctx.board ?? null);
      clearMustHave(); // a new batch starts unfiltered (D77)
      seq += opt.results.lineups.length;
    }
  } catch (e) {
    stale = opt.key !== madeFor;
    if (!stale) opt.error = requestFailureText(e); // a non-JSON answer reads "The server's answer could not be read (status N)." (B3)
  } finally {
    opt.generating = false;
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

/** The saved lineups of one mode as Captain-aware set keys (a card matching one shows "Saved ✓"). */
export function savedKeysOf(saved, mode, board) {
  const { personOf } = S.boardIndex(board);
  return new Set((saved ?? []).filter((l) => lineupModeOf(l) === mode).map((l) => S.sdSetKey(l.slots, personOf)));
}

/** The POST .../lineups body for one card: its name, its six men by person id (as the builder saves them, so the saved card
 *  finds every row), its mode and the build record (classic saveGenerated: lineup-builds.js batchBuild, plus the answer's
 *  figures key, so the server refuses a save after this game's sources changed; the server stamps its own projection line,
 *  so the page sends none). Pure. */
export function saveBody(lineup, results, name) {
  const slots = (lineup.slots ?? []).map((s) => ({ slot: s.slot, playerId: String(s.personId ?? s.playerId) }));
  const build = batchBuild({ buildId: results.buildId, boardMode: results.boardMode, objective: results.objective }, { ceil: lineup.ceil, players: [] });
  if (typeof results.figuresKey === "string" && results.figuresKey !== "") build.figuresKey = results.figuresKey;
  return { name, slots, mode: results.mode, build };
}

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
  if (skipped.length) {
    const status = duplicateSaveStatus(uids.length, savedCount, skipped);
    opt.saveError = opt.saveError ? `${status}. ${opt.saveError}` : status;
  }
  opt.saving = false;
  ctx.commit();
}

// ---------- the pieces lineup.js draws ----------

const busy = () => opt.generating || opt.saving;

const bandView = (board) => ({ mode: opt.ks.mode, ms: modeState(), board, error: opt.error, formError: opt.formError });

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
 *  `board`: the served board (its reading names the cash basis, its rows whether Median and Ceiling can be built). */
export function optimizerGoRowHtml(board) {
  if (!optimizerLive()) return "";
  return V.goRowHtml({ summary: S.summaryText(modeState(), opt.ks.mode, board), count: S.requestCount(modeState().count, opt.ks.mode), generating: opt.generating, busy: busy(), formError: opt.formError });
}

/** The batch (its head, source line, exposure tables and cards), drawn full width below both columns (Adam 2026-10-19 11:17 PM:
 *  "generated lineups should go 4 across"); "" off the live app. */
export function optimizerResultsBlockHtml(board, saved) {
  if (!optimizerLive()) return "";
  const r = opt.results;
  const keys = r ? savedKeysOf(saved, r.mode, board) : new Set();
  const { personOf } = S.boardIndex(board);
  const savedFlags = r ? r.lineups.map((l) => keys.has(S.sdSetKey(l.slots, personOf))) : [];
  return V.resultsHtml({ results: r, generating: opt.generating, saveError: opt.saveError, busy: busy(), savedFlags, board, expSortDir: opt.expSortDir, mustHave: opt.mustHave, mustHaveNames: opt.mustHaveNames });
}

/**
 * The Saved half of the "only lineups with" filter (D77, Adam 2026-10-11: "this should work with new or saved"): what the saved section
 * (lineup-saved.js savedLineupsSectionHtml) needs to filter its cards by opt.mustHave, to draw the Captain and FLEX exposure tables over
 * the cards shown (no Min / Max marks, they belong to a batch) and, when no batch is on screen to carry it, the chips bar. null off the
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
    barHtml: (shown, total) => (opt.results ? "" : filterBarHtml(chosen.map((key) => ({ key, name: opt.mustHaveNames[key] ?? key })), shown, total)),
    noMatchText: V.NO_MATCH_TEXT,
  };
}

/** The pool's position chips row on the live app (drawn between the Captain | FLEX toggle and the lists, as the sketch has it); "" elsewhere. */
export function poolChipsRowHtml() {
  return optimizerLive() ? V.poolChipsHtml(opt.pos, store.get().filters.showAllPlayers) : "";
}

/** What lineup-lists.js asks for each list (see setListControls there); every answer is the list's own when not live. */
export const listControls = {
  headCells: (kind) => (optimizerLive() ? V.poolHeadCells(kind, opt.ks.mode) : ""),
  cells: (row, kind) => (optimizerLive() ? V.poolCapCells(row, kind, modeState(), opt.ks.mode, parsePct) : ""),
  actions: (row, kind) => (optimizerLive() ? V.poolActionButtons(row, kind, modeState()) : ""),
  rowClass: (row, kind) => (optimizerLive() ? V.poolRowClass(row, kind, modeState()) : ""),
  rows: (all, shown) => (optimizerLive() ? V.poolRows(all, shown, modeState(), opt.pos) : shown),
  addLabel: () => (optimizerLive() ? "Add" : null),
};

// ---------- wiring ----------

/** Puts the summary, the Make label and the included / locked line back after a box changed, without a redraw (focus stays). */
function refreshLines(container, board) {
  const summary = container.querySelector("#sd-opt-summary");
  if (summary) summary.textContent = S.summaryText(modeState(), opt.ks.mode, board);
  const go = container.querySelector("#sd-opt-go-btn");
  if (go && !opt.generating) go.textContent = V.goLabel(S.requestCount(modeState().count, opt.ks.mode), false);
  const info = container.querySelector("#sd-opt-lockinfo");
  if (info) {
    const text = S.statusLineText(modeState(), board);
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
 * Wires one drawn list's row controls (called for each list as it is drawn or repainted). `ctx` = {container, board, repaintPool()}:
 * a lock, In or exclude click changes this mode's settings, saves them and repaints both lists and the lines in place.
 */
export function wirePoolControls(listEl, ctx) {
  if (!optimizerLive()) return;
  const rowOf = (id) => (ctx.board?.rows ?? []).find((r) => String(r.id) === String(id));
  listEl.querySelectorAll("[data-sd-opt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = rowOf(btn.dataset.id);
      if (!row) return;
      const ms = modeState();
      const kind = btn.dataset.kind === "cpt" ? "cpt" : "flex";
      const next = btn.dataset.sdOpt === "lock" ? S.toggleLock(ms, row, kind, ctx.board) : btn.dataset.sdOpt === "include" ? S.toggleInclude(ms, row) : S.toggleExclude(ms, row, kind);
      if (next === ms) return;
      setModeState(next);
      ctx.repaintPool();
      refreshLines(ctx.container, ctx.board);
      if (next.excludes !== ms.excludes) {
        resyncMeterExcludes(optimizerExcludes()); // the builder's meter re-measures against the same best as the batch (B1)
        resyncSwapsExcludes(optimizerExcludes()); // after the meter: an excluded man is no longer offered as a swap
      }
    });
  });
  listEl.querySelectorAll("[data-sd-cap]").forEach((el) => {
    el.addEventListener("input", () => {
      const field = el.dataset.sdCap;
      const ms = modeState();
      const map = { ...(ms[field] ?? {}) };
      if (el.value.trim() === "") delete map[el.dataset.id];
      else map[el.dataset.id] = el.value;
      setModeState({ ...ms, [field]: map });
      el.classList.toggle("invalid", Number.isNaN(parsePct(el.value)));
      clearFormError(ctx.container);
      refreshLines(ctx.container, ctx.board);
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
      if (btn.getAttribute("aria-disabled") === "true" || modeState().objective === btn.dataset.sdObjective) return;
      setModeState({ ...modeState(), objective: btn.dataset.sdObjective });
      ctx.commit();
    });
  });
}

/** The exposure header's sort: redraws only the exposure section (classic wireExposureSort). */
function wireExposureSort(container, ctx) {
  container.querySelectorAll(".sd-opt-results .opt-exposure [data-action='opt-exp-sort']").forEach((th) => {
    th.addEventListener("click", () => {
      opt.expSortDir = opt.expSortDir === "asc" ? "desc" : "asc";
      const section = container.querySelector(".sd-opt-results .opt-exposure");
      const r = opt.results;
      if (!section || !r) return;
      section.outerHTML = V.exposureSectionHtml(r, ctx.board, opt.expSortDir, opt.mustHave);
      const fresh = container.querySelector(".sd-opt-results .opt-exposure");
      if (fresh) wirePickButtons(fresh, ctx); // the section's name buttons were redrawn with it
      wireExposureSort(container, ctx);
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
  root.querySelector("[data-action='opt-pick-clear']")?.addEventListener("click", () => {
    clearMustHave();
    ctx.commit();
  });
}

/**
 * Wires the band, the pool chips, the Make row and the batch. `ctx` = {container, board, key, commit(), getSaved(), setSaved(list),
 * repaintPool(), and for tests post(key, body) / save(key, body) in place of the two requests}.
 */
export function wireOptimizer(ctx) {
  if (!optimizerLive()) return;
  const c = ctx.container;
  for (const id of ["#sd-opt-head", "#sd-opt-panel"]) {
    const piece = c.querySelector(id);
    if (piece) wireBand(piece, ctx);
  }
  c.querySelectorAll("[data-sd-pool-pos]").forEach((btn) => {
    btn.addEventListener("click", () => {
      opt.pos = btn.dataset.sdPoolPos;
      c.querySelectorAll("[data-sd-pool-pos]").forEach((b) => b.classList.toggle("active", b.dataset.sdPoolPos === opt.pos));
      ctx.repaintPool();
    });
  });
  c.querySelector("#sd-opt-go-btn")?.addEventListener("click", () => doGenerate(ctx));
  c.querySelectorAll("[data-sd-opt-save]").forEach((btn) => btn.addEventListener("click", () => saveCards([btn.dataset.sdOptSave], ctx)));
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
  c.querySelectorAll("#sd-saved-lineups [data-action='opt-exp-sort']").forEach((th) => {
    th.addEventListener("click", () => {
      opt.expSortDir = opt.expSortDir === "asc" ? "desc" : "asc"; // the one direction both screens' tables share (classic's)
      ctx.commit();
    });
  });
}

/** Test hook: run Make / Save with a context of stand-ins. */
export const testHooks = { doGenerate, saveCards };
