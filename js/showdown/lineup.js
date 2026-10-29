// Showdown Lineup Builder tab (D39/D40, brief): one Captain slot and five FLEX (any position including
// kicker and defence, both teams required), salary remaining, an objective selector posting to
// POST /api/showdown/<key>/lineup/optimize, Save lineup and the saved-lineups list against
// /api/showdown/<key>/lineups (same request/response shapes as classic's lineup routes — see
// public/js/lineup.js, which this module mirrors in structure). The pool rows' lock / In / exclude buttons belong to
// the Showdown Optimizer (./optimizer.js, Adam 2026-10-19) and drive its Make only: the one-lineup Build always runs a
// fresh optimize with empty locks/excludes and replaces whatever is currently placed with the result (D70: Adam's ruling
// keeps Build unchanged). The Optimizer's band heads the left column, its Make row ends it, and its batch is drawn full
// width below both columns, above the swaps and the saved lineups.
import { escapeHtml, money, dec1 } from "../format.js";
import { postShowdownLineupOptimize, getShowdownLineups, postShowdownLineup, deleteShowdownLineup, putShowdownLineupName, putShowdownLineupTag } from "./api.js";
import { poolHtml, poolVisibleRows, paintPool, wirePool, wirePoolTabs, wirePickRows, setPoolControls } from "./pool.js"; // the one player pool, the Rankings table with both roles on each row (Adam 2026-10-26)
// The Showdown Optimizer (Adam 2026-10-19, sketch A): its band over the builder, its Make row under it, its batch full width below, its controls on the pool rows.
import { syncOptimizer, optimizerLive, optimizerBandHeadHtml, optimizerBandBoxesHtml, optimizerGoRowHtml, optimizerResultsBlockHtml, optimizerExcludes, optimizerSavedFilter, poolControls, wirePoolControls, wireOptimizer } from "./optimizer.js";
import { handBuild } from "../lineup-builds.js";
import { requestFailureText } from "./read-json.js";
import { controlsHtml as controlsMarkup } from "./lineup-look.js"; // the two-row controls (Adam 2026-10-18 9:09 PM)
import { slotsHtml as slotsMarkup, repaintSlots } from "./lineup-slots.js"; // the six slots' markup and figure repaint (Adam 2026-10-21 Q3 option A split)
export { slotPlayerHtml } from "./lineup-slots.js"; // tests import it from here
// The saved-lineups view lives in ./lineup-saved.js (state stays here); the two pure helpers keep their old exports from this module.
import { findRow, SALARY_CAP, FLEX_COUNT, savedProjHtml, savedLineupCardHtml as savedCardHtml, savedLineupsSectionHtml as savedSectionHtml, wireSavedCards, cardPutGuard } from "./lineup-saved.js";
import { onSitePage } from "../tabs.js"; // the public site marks the page is-site: its saved cards draw no letter select (it can only be refused there)
export { savedLineupSlotHtml, savedProjTotal } from "./lineup-saved.js";
import { syncSwaps, swapsPanelHtml, wireSwaps } from "./lineup-swaps.js"; // the uniqueness swaps, full width below both columns (Adam 2026-10-18)
import { showdownPerSpotText, shownTotal } from "../totals.js";
import { syncMeter, meterStripHtml, wireMeter, playerFigures } from "./lineup-meter.js"; // uniqueness / projection strip under the slots; every figure on the screen is the served board's (Adam 2026-10-20)
import { builtOnText } from "./figures-label.js"; // the board's sources in words (the retired Figures switch's place)
import { lineupReadHtml } from "./lineup-read.js"; // the "Lineup read" sentences under the meter (Adam 2026-10-29 5:10 PM: "just make it not suck")

// "Projection minus ownership" was removed and Leverage has no measure (Adam 2026-10-15, Lev measure to be
// redesigned); the server answers either name by building by projection with an objectiveNote.
const OBJECTIVES = [
  { value: "proj", label: "Projection" },
];

const state = {
  cpt: null, // {id} or null
  flex: new Array(FLEX_COUNT).fill(null), // each {id} or null
  objective: "proj",
  lastResult: null,
  building: false,
  addError: null,
  savedLineups: [],
  savedLoaded: false,
  savedError: null,
  saveName: "",
  saving: false,
  saveError: null,
  saveConfirm: null,
  renamingId: null,
  deleteConfirmId: null,
};

let lastContainer = null;
let lastBoard = null;
let lastKey = null;
let openSources = null; // view.js's opener of the Sources page, for the meter's figures label (kept across commit's redraws)
let boardWrite = null; // view.js's writer that applies the board a write answers (the ± bump, Adam 2026-10-22; kept across commit's redraws)
let poolCount = null; // view.js's writer of the filter bar's "N of M players" (the pool's rows, the one call; kept across commit's redraws)
let afterDraw = null; // view.js's step after each draw of this panel: the pool's Expand bar, its height and the sticky bar's (kept across commit's redraws)
let savedFetchInFlightKey = null;
const cardPuts = cardPutGuard(); // the saved cards' PUTs in flight and their refusals

setPoolControls(poolControls); // the pool rows' Min % / Max % boxes and lock / In / exclude buttons (live app only)

function loadSavedLineups(key) {
  if (savedFetchInFlightKey === key) return;
  savedFetchInFlightKey = key;
  getShowdownLineups(key)
    .then((data) => {
      if (!data || data.ok === false) {
        state.savedLineups = [];
        state.savedError = data?.error?.message ?? "Could not load saved lineups.";
      } else {
        state.savedLineups = Array.isArray(data?.lineups) ? data.lineups : [];
        state.savedError = null;
      }
      state.savedLoaded = true;
      commit();
    })
    .catch((e) => {
      state.savedLineups = [];
      state.savedError = requestFailureText(e);
      state.savedLoaded = true;
      commit();
    });
}

function commit() {
  if (lastContainer) renderShowdownLineupPanel(lastContainer, lastBoard, lastKey);
}

function isPlacedFlex(id) {
  return state.flex.some((s) => s && String(s.id) === String(id));
}

/**
 * Salary used, salary left and total projection of the placed players (`picked` = {cpt, flex}, the panel's state by
 * default; exported for the tests). The projection is the sum of the figures the slots show (`figures`, the meter's
 * playerFigures by default: the board row's own); salary is the board's too. Missing
 * is missing: a placed player who is no longer on the board makes both the salary and the projection unknown (null),
 * and one with no projection makes the projection unknown. The projection is shownTotal's (each slot rounded as it is
 * shown, then summed; Adam 2026-10-17), as the results cards, the cash totals and the saved card add it.
 */
export function computeTotals(board, picked = state, figures = playerFigures) {
  const entries = [];
  if (picked.cpt) entries.push({ id: picked.cpt.id, cpt: true });
  for (const s of picked.flex ?? []) if (s) entries.push({ id: s.id, cpt: false });
  let salaryUsed = 0;
  let projs = [];
  for (const { id, cpt } of entries) {
    const row = findRow(board, id);
    if (!row) {
      salaryUsed = null;
      projs = null;
      continue;
    }
    if (salaryUsed !== null) salaryUsed += (cpt ? row.cptSalary : row.salary) ?? 0;
    // Missing is missing: a placed player with no projection makes the total unknown, never a sum counting him as 0.
    const proj = figures(row, cpt).proj;
    projs = projs !== null && Number.isFinite(proj) ? [...projs, proj] : null;
  }
  const totalProj = projs === null ? null : projs.length ? shownTotal(projs) : 0;
  return { salaryUsed, salaryLeft: salaryUsed === null ? null : SALARY_CAP - salaryUsed, totalProj, filled: entries.length };
}

/** The "Total projection ... · N of 6 slots filled" line's contents. */
function totalsLineHtml(totals) {
  return `Total projection ${totals.totalProj === null ? "unknown (a player has no projection)" : dec1(totals.totalProj)} &middot; ${totals.filled} of 6 slots filled`;
}

// D39: both teams required. Reports which of the game's two teams are (not yet) represented among the
// six placed players; blank/neutral until at least one player is placed.
function bothTeamsText(board) {
  const away = board?.game?.away;
  const home = board?.game?.home;
  if (!away || !home) return "";
  const ids = [state.cpt?.id, ...state.flex.map((s) => s?.id)].filter(Boolean);
  const teams = new Set(ids.map((id) => findRow(board, id)?.team).filter(Boolean));
  if (teams.size === 0) return `Both teams required: ${away} and ${home}.`;
  const missing = [away, home].filter((t) => !teams.has(t));
  if (missing.length === 0) return `Both teams required: satisfied (${away} and ${home} both in the lineup).`;
  return `Both teams required: ${missing.join(", ")} not in the lineup yet.`;
}

function addCaptain(row) {
  if (!row) return;
  if (row.cptSalary == null) {
    state.addError = `${row.name} has no showdown Captain salary.`;
    return;
  }
  if (state.cpt && String(state.cpt.id) === String(row.id)) {
    state.addError = `${row.name} is already the Captain.`;
    return;
  }
  state.cpt = { id: String(row.id) };
  state.flex = state.flex.map((s) => (s && String(s.id) === String(row.id) ? null : s));
  state.lastResult = null;
  state.addError = null;
}

function addFlex(row) {
  if (!row) return;
  if (row.salary == null) {
    state.addError = `${row.name} has no showdown FLEX salary.`;
    return;
  }
  if (state.cpt && String(state.cpt.id) === String(row.id)) {
    state.addError = `${row.name} is already the Captain.`;
    return;
  }
  if (isPlacedFlex(row.id)) {
    state.addError = `${row.name} is already in a FLEX slot.`;
    return;
  }
  const idx = state.flex.findIndex((s) => !s);
  if (idx === -1) {
    state.addError = "All five FLEX slots are full.";
    return;
  }
  state.flex[idx] = { id: String(row.id) };
  state.lastResult = null;
  state.addError = null;
}

/**
 * A click on a pool row (pool.js poolPickAction names `action`; Adam 4:45 PM 2026-10-29): the same add and clear rules the Add and Clear
 * buttons ran. A Captain moved to FLEX goes back to Captain when FLEX refuses him (full, or no FLEX salary), with the refusal shown.
 */
export function pickPoolRow(row, action) {
  if (!row) return;
  if (action === "remove-flex") {
    const idx = state.flex.findIndex((s) => s && String(s.id) === String(row.id));
    if (idx !== -1) clearFlex(idx);
  } else if (action === "remove-cpt") {
    clearCaptain();
  } else if (action === "add-cpt") {
    addCaptain(row);
  } else if (action === "move-to-flex") {
    const was = { cpt: state.cpt, lastResult: state.lastResult };
    clearCaptain();
    addFlex(row);
    if (state.addError) Object.assign(state, was);
  } else {
    addFlex(row);
  }
}

/** Test hook: who is placed now, {cpt, flex, addError} (copies). */
export function lineupPicks() {
  return { cpt: state.cpt ? { ...state.cpt } : null, flex: state.flex.map((s) => (s ? { ...s } : null)), addError: state.addError };
}

function clearCaptain() {
  state.cpt = null;
  state.lastResult = null;
  state.addError = null;
}

function clearFlex(idx) {
  state.flex[idx] = null;
  state.lastResult = null;
  state.addError = null;
}

function clearAll() {
  state.cpt = null;
  state.flex = new Array(FLEX_COUNT).fill(null);
  state.lastResult = null;
  state.addError = null;
}

async function doBuild(key) {
  if (state.building) return;
  state.building = true;
  state.addError = null;
  commit();
  try {
    const data = await postShowdownLineupOptimize(key, { objective: state.objective, locks: [], excludes: [] }); // no mode: the server builds on the served board, the figures on screen
    if (!data || data.ok === false) {
      state.lastResult = { feasible: false, message: data?.error?.message ?? "Could not build a lineup." };
    } else if (data.feasible) {
      const lineup = Array.isArray(data.lineup) ? data.lineup : [];
      const cptEntry = lineup.find((e) => String(e.slot ?? "").toUpperCase() === "CPT" || String(e.slot ?? "").toUpperCase() === "CAPTAIN");
      const flexEntries = lineup.filter((e) => e !== cptEntry).slice(0, FLEX_COUNT);
      // The optimiser's Captain entry has id = row.cptId (server/lineup/showdown.js's showdownCandidates:
      // the Captain candidate's own id IS the Captain id), which findRow below can never match since board
      // rows are keyed by the FLEX/person id. personId is the same person id findRow needs, on both the
      // Captain and FLEX entries (🔵 review item 1) — that's what makes the Captain's salary/points count
      // in the totals and the both-teams line instead of silently resolving to nothing.
      const personIdOf = (e) => String(e.personId ?? e.playerId ?? e.id);
      state.cpt = cptEntry ? { id: personIdOf(cptEntry) } : null;
      state.flex = new Array(FLEX_COUNT).fill(null).map((_, i) => (flexEntries[i] ? { id: personIdOf(flexEntries[i]) } : null));
      const message = [data.objectiveNote, data.message].filter(Boolean).join(" ");
      state.lastResult = { feasible: true, message, builtOn: builtOnText(lastBoard), salaryUsed: data.salaryUsed, totalProj: data.totalProj };
    } else {
      const message = [data.objectiveNote, data.message ?? "No legal lineup fits the salary cap and both-teams rule."].filter(Boolean).join(" ");
      state.lastResult = { feasible: false, message };
    }
  } catch (e) {
    state.lastResult = { feasible: false, message: requestFailureText(e) };
  }
  state.building = false;
  commit();
}

/**
 * The POST .../lineups body for the lineup built by hand: {name, slots, build}. build is classic's hand record with the board's
 * reading (lineup-builds.js handBuild; board.mode.cashMode, as classic's cash hand save records it), because the server learns
 * whose figures to snapshot from build.boardMode (🔵 re-check of the saved routes, V8). Pure; `picked` = {cpt, flex} (the panel's
 * state), `boardMode` = the board's mode.cashMode ("twogun" or "current"; null records none).
 */
export function handSaveBody(name, picked, boardMode) {
  const slots = [];
  if (picked.cpt) slots.push({ slot: "CPT", playerId: String(picked.cpt.id) });
  for (const s of picked.flex ?? []) if (s) slots.push({ slot: "FLEX", playerId: String(s.id) });
  return { name, slots, build: handBuild(boardMode) };
}

async function doSaveLineup(key, name) {
  if (state.saving) return;
  const body = handSaveBody(name, state, lastBoard?.mode?.cashMode ?? null);
  const slotsPayload = body.slots;
  if (slotsPayload.length === 0) {
    state.saveError = "Add at least one player to the lineup before saving.";
    state.saveConfirm = null;
    commit();
    return;
  }
  state.saving = true;
  state.saveError = null;
  state.saveConfirm = null;
  state.saveName = name;
  commit();
  try {
    const data = await postShowdownLineup(key, body);
    if (!data || data.ok === false) {
      state.saveError = data?.error?.message ?? "Could not save the lineup.";
    } else {
      state.savedLineups = Array.isArray(data.lineups) ? data.lineups : state.savedLineups;
      state.saveName = "";
      state.saveConfirm = `Saved "${data.lineup?.name ?? ""}".`;
    }
  } catch (e) {
    state.saveError = requestFailureText(e);
  }
  state.saving = false;
  commit();
}

// A saved card's one PUT, rename or letter (cardPutGuard): the answer's list replaces ours; a refusal shows on the card and the redraw resets the select.
async function putCard(key, id, send) {
  const gameAtStart = lastKey;
  await cardPuts.run(id, send, { redraw: commit, still: () => lastKey === gameAtStart, apply: (list) => { state.savedLineups = list; } }).catch((e) => cardPuts.fail(id, e)); // a throw past the guard shows on the card too
  commit();
}

async function doDeleteLineup(key, id) {
  state.deleteConfirmId = null;
  commit();
  try {
    const data = await deleteShowdownLineup(key, id);
    if (data && data.ok !== false && Array.isArray(data.lineups)) state.savedLineups = data.lineups;
  } catch (e) {
    // Best-effort.
  }
  commit();
}

function doLoadLineup(id) {
  const lineup = state.savedLineups.find((l) => l.id === id);
  if (!lineup) return;
  const cptSlot = (lineup.slots ?? []).find((s) => String(s.slot ?? "").toUpperCase() === "CPT");
  const flexSlots = (lineup.slots ?? []).filter((s) => s !== cptSlot);
  state.cpt = cptSlot ? { id: String(cptSlot.playerId) } : null;
  state.flex = new Array(FLEX_COUNT).fill(null).map((_, i) => (flexSlots[i] ? { id: String(flexSlots[i].playerId) } : null));
  state.lastResult = null;
  state.addError = null;
  commit();
}

// --------------------------------------------------------------------------------------------------------
// Render
// --------------------------------------------------------------------------------------------------------

// Repaints only the six slots' figure lines and the total projection line under them (the panel is not redrawn, so a
// typed lineup name survives); the meter calls it when its modes answer (each man's notes) lands.
function repaintSlotFigures() {
  if (!lastContainer || !lastBoard) return;
  repaintSlots(lastContainer, lastBoard, state);
  const totalsEl = lastContainer.querySelector(".lineup-totals");
  if (totalsEl) totalsEl.innerHTML = totalsLineHtml(computeTotals(lastBoard));
  // The pool and the saved cards' projection totals carry the same notes, repainted in place.
  paintPool(lastContainer, poolCtx(lastBoard));
  lastContainer.querySelectorAll(".saved-lineup-proj").forEach((el) => {
    const lineup = state.savedLineups.find((l) => l.id === el.dataset.lineupId);
    if (lineup) el.innerHTML = savedProjHtml(lineup, lastBoard);
  });
}

const slotsHtml = (board) => slotsMarkup(board, state); // the placed slots go in as parameters (lineup-slots.js)

function controlsHtml() {
  const hasAnySlot = Boolean(state.cpt) || state.flex.some(Boolean);
  return controlsMarkup({ objectives: OBJECTIVES, objective: state.objective, building: state.building, saving: state.saving, saveName: state.saveName, hasAnySlot });
}

function buildStatusHtml(board) {
  const parts = [`<div class="lineup-status">${escapeHtml(bothTeamsText(board))}</div>`];
  if (state.addError) parts.push(`<div class="lineup-status lineup-status-warning">${escapeHtml(state.addError)}</div>`);
  if (state.saveError) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(state.saveError)}</div>`);
  else if (state.saveConfirm) parts.push(`<div class="lineup-status">${escapeHtml(state.saveConfirm)}</div>`);
  const r = state.lastResult;
  if (r) {
    if (!r.feasible) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(r.message || "No legal lineup could be built.")}</div>`);
    else parts.push(...[r.builtOn, r.message].filter(Boolean).map((t) => `<div class="lineup-status">${escapeHtml(t)}</div>`));
  }
  return parts.join("");
}

// What the pool needs from the lineup: who is placed (a placed man's row is tinted on the tab where he sits); a click on a row runs
// pickPoolRow (poolCtx's pick), where the add and clear rules stay.
function listPlacement() {
  return { cptId: state.cpt ? String(state.cpt.id) : null, flexIds: new Set(state.flex.filter(Boolean).map((s) => String(s.id))) };
}

function poolCtx(board) {
  return {
    board,
    placement: listPlacement,
    repaint: () => paintPool(lastContainer, poolCtx(board)), // a header click: only the pool's head and body
    onRepaint: (poolEl) => wireRowButtons(poolEl, board), // a repainted pool's buttons are new
    onCount: (shown, total) => poolCount?.(shown, total),
  };
}

/** Redraws the pool alone, for the filter bar above the builder (view.js): a chip or a typed filter never redraws the builder. */
export function repaintShowdownPool() {
  if (lastContainer && lastBoard) paintPool(lastContainer, poolCtx(lastBoard));
}

// The saved card with the panel's rename box, delete prompt and PUT state (lineup-saved.js draws it); `numbers`: numberLineups of this game's saved lineups.
export function savedLineupCardHtml(lineup, board, figures = playerFigures, numbers = null) {
  return savedCardHtml(lineup, board, figures, { renamingId: state.renamingId, deleteConfirmId: state.deleteConfirmId, numbers, busy: cardPuts.busy.has(lineup.id), error: cardPuts.errors[lineup.id] ?? null, editableTag: !onSitePage() });
}

// The Optimizer's "only lineups with" list filters these cards too, live app only (D77; optimizer.js optimizerSavedFilter).
function savedLineupsSectionHtml(board) {
  return savedSectionHtml(board, { loaded: state.savedLoaded, error: state.savedError, lineups: state.savedLineups }, (l, numbers) => savedLineupCardHtml(l, board, undefined, numbers), optimizerSavedFilter(board));
}

// `poolRows`: the pool's rows (pool.js poolVisibleRows), read once per draw so the filter bar's count is the same list.
function panelHtml(board, poolRows) {
  const totals = computeTotals(board);
  const salaryKnown = totals.salaryUsed !== null;
  const overCap = salaryKnown && totals.salaryUsed > SALARY_CAP;
  const fillPct = salaryKnown ? Math.max(0, Math.min(100, (totals.salaryUsed / SALARY_CAP) * 100)) : 0;
  // Adam 2026-10-18: salary per open spot, the Captain's 1.5x weighed in (totals.js); null when full or over.
  const perSpot = salaryKnown ? showdownPerSpotText(totals.salaryLeft, !state.cpt, FLEX_COUNT - state.flex.filter(Boolean).length) : null;
  const salaryText = !salaryKnown
    ? "Salary unknown: a placed player is no longer on the board"
    : totals.salaryLeft < 0
      ? `${money(totals.salaryUsed)} used · ${money(-totals.salaryLeft)} over`
      : `${money(totals.salaryUsed)} used · ${money(totals.salaryLeft)} left${perSpot ? ` · ${perSpot}` : ""}`;
  // The Optimizer (sketch A, Adam 2026-10-19): its band head over the builder (the left column, wider then, .sd-opt-left), whose
  // Make row (sticky, as classic's footer) ends it; the Pool and Build boxes come after the six slots and the meter (Adam 2026-10-20:
  // "I can't see the main lineup that I'm building"). The player pool sits beside it (below; Adam 2026-10-26: the Rankings table as
  // the pool, its filter bar above the builder, view.js), then the batch, its cards four
  // across (Adam 2026-10-19 11:17 PM: "generated lineups should go 4 across"). Off the live app the Optimizer's pieces are empty, as before.
  // Adam 2026-10-26 3:59 PM: "i like the list to the side of the optimizer not beneath": the player pool is the right column, beside the
  // builder, on the live app and the public site alike; both columns start under the band's head (the Objective row and the pool's
  // heading level). Below 1100px of window the pool wraps under the builder (style.css .sd-pool-col).
  return `
    ${optimizerBandHeadHtml(board)}
    <div class="lineup-layout sd-pool-layout">
      <div class="lineup-left${optimizerLive() ? " sd-opt-left" : ""}">
        ${controlsHtml()}
        <div class="lineup-slots">${slotsHtml(board)}</div>
        ${meterStripHtml()}
        ${lineupReadHtml(board, state)}
        <div class="salary-bar">
          <div class="salary-bar-track"><div class="salary-bar-fill${overCap ? " over" : ""}" style="width:${fillPct}%"></div></div>
          <span class="salary-bar-label${overCap ? " over" : ""}">${escapeHtml(salaryText)}</span>
        </div>
        <div class="lineup-totals">${totalsLineHtml(totals)}</div>
        ${buildStatusHtml(board)}
        ${optimizerBandBoxesHtml(board)}
        ${optimizerGoRowHtml(board)}
      </div>
      <div class="lineup-right sd-pool-col">${poolHtml(board, listPlacement(), poolRows)}</div>
    </div>
    ${optimizerResultsBlockHtml(board, state.savedLineups)}
    ${swapsPanelHtml()}
    ${savedLineupsSectionHtml(board)}`;
}

// The Optimizer's hands into this panel: the redraw, the saved list (its Saved ✓ marks and its saves), and a repaint of the pool in place.
function optCtx(board, key) {
  return {
    container: lastContainer,
    board,
    key,
    commit,
    getSaved: () => state.savedLineups,
    setSaved: (list) => { state.savedLineups = list; },
    repaintPool: () => { if (lastContainer) paintPool(lastContainer, poolCtx(board)); },
    boardWrite: (send, label) => (boardWrite ? boardWrite(send, label) : console.error("A Showdown board write was asked for, but view.js passed no board writer.")), // the ± bump (Adam 2026-10-22)
  };
}

// `container`: the whole panel, or the pool's element when only the pool was repainted.
function wireRowButtons(container, board) {
  wirePoolControls(container, optCtx(board, lastKey));
  wirePickRows(container, (id, action) => { // a click on a pool row (D39): the man goes in or out, and the panel is redrawn
    pickPoolRow(findRow(board, id), action);
    commit();
  });
}

function wire(container, board, key) {
  wireMeter(container);
  wireSwaps(container);
  container.querySelector("#sd-lineup-objective")?.addEventListener("change", (e) => {
    state.objective = e.target.value;
    state.lastResult = null;
    commit();
  });
  container.querySelector("#sd-lineup-build-btn")?.addEventListener("click", () => doBuild(key));
  container.querySelector("#sd-lineup-clear-all-btn")?.addEventListener("click", () => {
    clearAll();
    commit();
  });
  // A click (or Enter / Space) on a filled slot card takes his man out (D39, Adam 4:45 PM 2026-10-29: no Clear buttons).
  const onSlot = (el, remove) => {
    el.addEventListener("click", (ev) => { // his name keeps opening his card
      if (ev?.target?.closest?.("button, a, input, .opt-p-name")) return;
      remove();
      commit();
    });
    el.addEventListener("keydown", (ev) => {
      if ((ev.key === "Enter" || ev.key === " ") && ev.target === el) { ev.preventDefault?.(); remove(); commit(); }
    });
  };
  const cptSlot = container.querySelector("[data-action='clear-cpt']");
  if (cptSlot) onSlot(cptSlot, clearCaptain);
  container.querySelectorAll("[data-action='clear-flex']").forEach((el) => onSlot(el, () => clearFlex(Number(el.dataset.flex))));
  wireRowButtons(container, board);
  const pool = container.querySelector("#sd-pool");
  if (pool) {
    wirePool(pool, poolCtx(board));
    wirePoolTabs(pool, poolCtx(board));
  }
  container.querySelector("#sd-lineup-save-btn")?.addEventListener("click", () => {
    const nameInput = container.querySelector("#sd-lineup-save-name");
    doSaveLineup(key, nameInput ? nameInput.value : "");
  });
  wireSavedCards(container, {
    renameStart: (id) => {
      state.renamingId = id;
      state.deleteConfirmId = null;
      commit();
    },
    renameCancel: () => {
      state.renamingId = null;
      commit();
    },
    renameSave: (id, name) => { state.renamingId = null; putCard(key, id, () => putShowdownLineupName(key, id, name)); },
    tag: (id, tag) => putCard(key, id, () => putShowdownLineupTag(key, id, tag)),
    deleteStart: (id) => {
      state.deleteConfirmId = id;
      state.renamingId = null;
      commit();
    },
    deleteNo: () => {
      state.deleteConfirmId = null;
      commit();
    },
    deleteYes: (id) => doDeleteLineup(key, id),
    load: (id) => doLoadLineup(id),
  });
  wireOptimizer(optCtx(board, key));
}

let lastValidatedKey = null;

// `onOpenSources`: what the meter's figures label's Sources link does (view.js: the Showdown header's Sources button's opener).
// `onBoardWrite(send, label)`: view.js's runner of a write that answers this game's board, which it applies as a refresh's (the ± bump).
// `onPoolCount(shown, total)`: view.js's writer of the filter bar's count. `onDrawn()`: view.js's step after each draw (the pool's Expand
// bar and height, the sticky bar's height). `container` is the Optimizer tab's mount (#sd-lineup-mount): the game line and the filter bar
// sit outside it, so a redraw here never replaces a box Adam is typing in.
export function renderShowdownLineupPanel(container, board, key, { onOpenSources = openSources, onBoardWrite = boardWrite, onPoolCount = poolCount, onDrawn = afterDraw } = {}) {
  lastContainer = container;
  lastBoard = board;
  lastKey = key;
  openSources = onOpenSources;
  boardWrite = onBoardWrite;
  poolCount = onPoolCount;
  afterDraw = onDrawn;
  if (key !== lastValidatedKey) {
    lastValidatedKey = key;
    state.savedLoaded = false;
    state.savedLineups = [];
    state.savedError = null;
    // A different showdown means a different player pool: last week's (or the other game's) placed
    // Captain/FLEX, build result and open rename/delete prompts must never carry over (🔵 review item 7).
    state.cpt = null;
    state.flex = new Array(FLEX_COUNT).fill(null);
    state.lastResult = null;
    state.renamingId = null;
    state.deleteConfirmId = null;
    if (key) loadSavedLineups(key);
  }
  syncOptimizer(key, board); // this showdown's Optimizer settings; another showdown's batch is dropped (first: the meter reads its excludes)
  syncMeter({ board, key, cpt: state.cpt, flex: state.flex, container, excludes: optimizerExcludes(), onSources: openSources, onModes: repaintSlotFigures }); // the meter repaints only its own strip and the slots' notes; the on-screen mode's excludes, as a batch card's meter has them (🔵 866b0ce B1)
  syncSwaps({ board, key, cpt: state.cpt, flex: state.flex, container, excludes: optimizerExcludes() }); // after the meter: the swaps exist while it has a complete live lineup; the meter's excludes, so no excluded man is offered
  const poolRows = poolVisibleRows(board);
  const poolScroll = container.querySelector?.("#sd-pool .scroll-panel")?.scrollTop ?? 0; // an Add click redraws the panel: the pool keeps its place
  container.innerHTML = panelHtml(board, poolRows);
  wire(container, board, key);
  poolCount?.(poolRows.length, (board?.rows ?? []).length);
  afterDraw?.();
  const poolPanel = poolScroll ? container.querySelector?.("#sd-pool .scroll-panel") : null;
  if (poolPanel) poolPanel.scrollTop = poolScroll;
}
