// Showdown Lineup Builder tab (D39/D40, brief): one Captain slot and five FLEX (any position including
// kicker and defence, both teams required), salary remaining, Save working lineup and the saved-lineups list against
// /api/showdown/<key>/lineups (same request/response shapes as classic's lineup routes — see
// public/js/lineup.js, which this module mirrors in structure). The pool rows' lock / In / exclude buttons belong to
// the Showdown Optimizer (./optimizer.js, Adam 2026-10-19) and drive its one Build (optimizer standard A13, round 3: the old one-lineup Build, which ignored
// locks and excludes and replaced the placed men, is folded into it). The Optimizer's band heads the left column, its Build row ends it, and its batch is
// drawn full width below both columns, above the swaps and the saved lineups.
import { escapeHtml } from "../format.js";
import { getShowdownLineups, postShowdownLineup, deleteShowdownLineup, putShowdownLineupName, putShowdownLineupTag } from "./api.js";
import { poolHtml, poolVisibleRows, paintPool, wirePool, wirePoolTabs, setPoolControls, POOL_PICK_SKIP } from "./pool.js"; // the one player pool, the Rankings table with both roles on each row (Adam 2026-10-26)
import { wirePick, wirePickRows, SLOT_PICK_SKIP } from "../pick-rows.js"; // click-to-pick, the one wiring classic's Optimizer shares (D81)
// The Showdown Optimizer (Adam 2026-10-19, sketch A): its band over the builder, its Make row under it, its batch full width below, its controls on the pool rows.
import { syncOptimizer, optimizerState, optimizerLive, optimizerBandHeadHtml, optimizerBandBoxesHtml, optimizerGoRowHtml, optimizerResultsBlockHtml, optimizerExcludes, releaseAllLocks, resultLineup, optimizerSavedFilter, poolControls, wirePoolControls, wireOptimizer, putShowdownOverrides } from "./optimizer.js";
import { rowIsOut } from "../table.js";
import { wirePoolEdits, takePoolEdit, restorePoolEdit, projPatch, ownPatch, starPatch, notePatch } from "./pool-edit.js"; // B2, B3, C23: the star, the typed Proj and Own, the note's pencil
import { takeOpenLimit, restoreOpenLimit, limitRefusals, dropOlderLimitRefusals, noteLimitPress } from "../limit-box.js"; // A3: the pool's Min % and Max % boxes survive a redraw; a refused text is held
import { handBuild } from "../lineup-builds.js";
import { filterLineups } from "../lineup-filter.js";
import { statusBlockHtml, messageRowShown as messageRowShownIn, BUILD_STATUS_ID } from "./lineup-status.js"; // A14: the status block and the click's message beside its pool row
import { requestFailureText } from "./read-json.js";
import { controlsHtml as controlsMarkup } from "./lineup-look.js"; // the two-row controls (Adam 2026-10-18 9:09 PM)
import { slotsHtml as slotsMarkup, repaintSlots } from "./lineup-slots.js"; // the six slots' markup and figure repaint (Adam 2026-10-21 Q3 option A split)
export { slotPlayerHtml } from "./lineup-slots.js"; // tests import it from here
// The saved-lineups view lives in ./lineup-saved.js (state stays here); the two pure helpers keep their old exports from this module.
import { lineupTotals, lineupTotalsHtml } from "../lineup-totals.js"; // A11
import { findRow, SALARY_CAP, FLEX_COUNT, savedTotalsHtml, savedSlotsHtml, savedLineupCardHtml as savedCardHtml, savedLineupsSectionHtml as savedSectionHtml, wireSavedCards, cardPutGuard } from "./lineup-saved.js";
import { onSitePage } from "../tabs.js"; // the public site marks the page is-site: its saved cards draw no letter select (it can only be refused there)
export { savedLineupSlotHtml, savedProjTotal } from "./lineup-saved.js";
import { syncSwaps, swapsPanelHtml, wireSwaps } from "./lineup-swaps.js"; // the uniqueness swaps, full width below both columns (Adam 2026-10-18)
import { showdownPerSpotText, shownTotal } from "../totals.js";
import { syncMeter, meterStripHtml, wireMeter, playerFigures, lineupFigureRow } from "./lineup-meter.js"; // uniqueness / projection strip under the slots; every figure on the screen is the served board's (Adam 2026-10-20)
import { lineupReadHtml } from "./lineup-read.js"; // the "Lineup read" sentences under the meter (Adam 2026-10-29 5:10 PM: "just make it not suck")
import { onConfirmDismiss } from "../confirm-inline.js"; // B13, C11: Esc and a click outside close an open confirm
import { notDeletedText } from "../delete-words.js"; // A12: the one sentence a failed delete leaves, the classic Optimizer's words
import { wireStaleMessages } from "../stale-messages.js"; // item 17: a one-shot message goes at the next click on any control
import { wireDkDownload } from "../dk-lineup-ui.js"; // A12: Download DK CSV for the saved lineups ticked
// The working lineup, its click rules, Lock/Unlock, Clear lineup and the saved-or-not question: ./seats.js (split out to keep this file under its cap).
import { state, setSeatBoard, reseatStoredLocks, pickPoolRow, lineupPicks, listPlacement, lockSeat, unlockSeat, clearCaptain, clearFlex, clearAll, clearAllHasContent, workingUnsaved, rowIdOf } from "./seats.js";
export { pickPoolRow, lineupPicks };

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

/** A11: the working lineup's `Salary used`, `Salary left`, `Proj` and `Own` under the last slot, from the first man (lineup-totals.js): empty reads $0, the full cap and dashes;
 *  a board that has not loaded reads dashes with the reason; a placed man no longer on the board makes every figure that needs him a dash. Salary per open spot follows (Adam 2026-10-18). */
export function workingTotalsHtml(board, picked = state, figures = playerFigures) {
  const entries = [];
  if (picked.cpt) entries.push({ id: picked.cpt.id, cpt: true });
  for (const s of picked.flex ?? []) if (s) entries.push({ id: s.id, cpt: false });
  const men = entries.map(({ id, cpt }) => {
    const row = findRow(board, id);
    if (!row) return {};
    const f = figures(row, cpt);
    return { salary: cpt ? row.cptSalary : row.salary, proj: f.proj, own: f.notOnBoard ? null : f.own };
  });
  const notLoaded = (board?.rows ?? []).length ? null : "the board has not loaded";
  const t = computeTotals(board, picked, figures);
  const perSpot = t.salaryLeft === null ? null : showdownPerSpotText(t.salaryLeft, !picked.cpt, FLEX_COUNT - (picked.flex ?? []).filter(Boolean).length);
  return lineupTotalsHtml(lineupTotals(men, { cap: SALARY_CAP, notLoaded }), { cap: SALARY_CAP, attrs: " data-working-totals", extra: perSpot ? escapeHtml(perSpot) : "" });
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
    state.saveTone = "warn";
    state.saveConfirm = null;
    commit();
    return;
  }
  state.saving = true;
  state.saveError = null;
  state.saveTone = "error";
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

/** A12 (round 3): a delete that did not happen says so on the card, in red, until the next try (it was swallowed before). */
async function doDeleteLineup(key, id) {
  state.deleteConfirmId = null;
  delete state.deleteErrors[id];
  commit();
  try {
    const data = await deleteShowdownLineup(key, id);
    if (data && data.ok !== false && Array.isArray(data.lineups)) state.savedLineups = data.lineups;
    else state.deleteErrors[id] = notDeletedText({ data });
  } catch (e) {
    console.warn("Delete: the request did not come back", e);
    state.deleteErrors[id] = notDeletedText({ error: e });
  }
  commit();
}

/** A Load (a saved card's, or a generated card's: A13): over slots that are not saved it asks `Replace your working lineup?` first (C11); `kind` "saved" or "result". */
function requestLoad(kind, id) {
  if (workingUnsaved()) {
    state.confirm = `load:${kind}:${id}`;
    commit();
    return;
  }
  doLoadLineup(kind, id);
}

/** Puts a saved or generated lineup in the slots (a Load) and brings the slots into view (A12, round 3: a card can be far below them). The old men's locks go with them. */
function doLoadLineup(kind, id) {
  state.confirm = null;
  const lineup = kind === "result" ? resultLineup(id) : state.savedLineups.find((l) => l.id === id);
  if (!lineup) {
    commit();
    return;
  }
  const personOf = (s) => rowIdOf(s.personId ?? s.playerId);
  const cptSlot = (lineup.slots ?? []).find((s) => String(s.slot ?? "").toUpperCase() === "CPT");
  const flexSlots = (lineup.slots ?? []).filter((s) => s !== cptSlot);
  state.cpt = cptSlot ? { id: personOf(cptSlot) } : null;
  state.flex = new Array(FLEX_COUNT).fill(null).map((_, i) => (flexSlots[i] ? { id: personOf(flexSlots[i]) } : null));
  state.addError = null;
  releaseAllLocks(); // the whole lineup is replaced: every lock of this game goes, in both modes
  commit();
  try {
    lastContainer?.querySelector?.(".lineup-slots")?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  } catch (e) {
    console.warn("Load: the slots could not be scrolled into view", e); // a convenience only; the lineup is loaded either way
  }
}

// --------------------------------------------------------------------------------------------------------
// Render
// --------------------------------------------------------------------------------------------------------

// Repaints only the six slots' figure lines and the total projection line under them (the panel is not redrawn, so a
// typed lineup name survives); the meter calls it when its modes answer (each man's notes) lands.
function repaintSlotFigures() {
  if (!lastContainer || !lastBoard) return;
  repaintSlots(lastContainer, lastBoard, state);
  const totalsEl = lastContainer.querySelector("[data-working-totals]");
  if (totalsEl) totalsEl.outerHTML = workingTotalsHtml(lastBoard);
  repaintLineupRead(); // the Lineup read reads the same figures (a revive the lineup ignores), so it is redrawn with them
  // The pool and the saved cards' rows and totals carry the same notes, repainted in place together, so a card's rows and totals never disagree.
  paintPool(lastContainer, poolCtx(lastBoard));
  lastContainer.querySelectorAll(".saved-lineup-slots[data-lineup-id]").forEach((el) => {
    const lineup = state.savedLineups.find((l) => l.id === el.dataset.lineupId);
    if (lineup) el.innerHTML = savedSlotsHtml(lineup, lastBoard);
  });
  lastContainer.querySelectorAll("[data-lineup-totals][data-lineup-id]").forEach((el) => {
    const lineup = state.savedLineups.find((l) => l.id === el.dataset.lineupId);
    if (lineup) el.outerHTML = savedTotalsHtml(lineup, lastBoard);
  });
}

export const lineupReadOf = (board) => lineupReadHtml({ ...board, rows: (board?.rows ?? []).map(lineupFigureRow) }, state); // the rows as the lineup reads them (a revive TwoGun-only ignores reads 0)
/** Redraws the Lineup read in place when the modes answer lands (it reads the same figures as the slots): replaced, removed when empty, or added above the status block. */
function repaintLineupRead() {
  const html = lineupReadOf(lastBoard);
  const el = lastContainer.querySelector(".sd-read");
  if (el) el.outerHTML = html;
  else if (html) lastContainer.querySelector(`#${BUILD_STATUS_ID}`)?.insertAdjacentHTML?.("beforebegin", html);
}

const slotsHtml = (board) => slotsMarkup(board, state); // the placed slots go in as parameters (lineup-slots.js)

function controlsHtml() {
  const hasAnySlot = Boolean(state.cpt) || state.flex.some(Boolean);
  return controlsMarkup({ saving: state.saving, saveName: state.saveName, hasAnySlot, confirm: state.confirm });
}

// The status block under the slots and the click's message beside its pool row (standard A14): lineup-status.js.
const buildStatusHtml = (board, addInRow = false) => statusBlockHtml(board, state, addInRow);
const messageRowShown = (rows) => messageRowShownIn(state, rows);

/** Redraws only the status block, after the pool repainted with `rows` (a filter change can hide the row the message sits beside). */
function repaintBuildStatus(board, rows) {
  const el = lastContainer?.querySelector?.(`#${BUILD_STATUS_ID}`);
  if (el) el.innerHTML = buildStatusHtml(board, messageRowShown(rows));
}

function poolCtx(board) {
  return {
    board,
    placement: listPlacement,
    repaint: () => paintPool(lastContainer, poolCtx(board)), // a header click: only the pool's head and body
    onRepaint: (poolEl, rows) => { // a repainted pool's buttons are new; and the click's message follows the rows now shown (a filter can hide its row)
      wireRowButtons(poolEl, board);
      repaintBuildStatus(board, rows);
    },
    onCount: (shown, total) => poolCount?.(shown, total),
    // A3: a typed-number or note box, and a Min % / Max % box, that is open when the rows are redrawn goes back into the new ones with its text and focus; the removal never reads as a click away.
    takeEdit: (poolEl) => ({ edit: takePoolEdit(poolEl), limit: takeOpenLimit() }),
    restoreEdit: (poolEl, carry) => {
      if (!carry) return;
      restorePoolEdit(poolEl, carry.edit, editCtx(board));
      restoreOpenLimit(poolEl, carry.limit);
    },
  };
}

/** A failed write for a pool row is said beside that row, in red (B12, B3). */
function rowError(id, text) {
  state.addErrorId = String(id);
  state.addError = text;
  state.addTone = "error";
  commit();
}

const SET_ASIDE_NOTICE = "He is listed out and TwoGun is the only projection source ticked, so your number does not bring him back: he counts 0 in lineups.";

/** A short notice beside a pool row, amber (a refusal's tone, not an error): the write was taken, and this is what it did not do. */
function rowNotice(id, text) {
  state.addErrorId = String(id);
  state.addError = text;
  state.addTone = undefined;
  commit();
}

/** What the star, the typed Proj and Own cells and the pencil need (pool-edit.js wirePoolEdits): the writes go through view.js's board writer, which applies the answered board and says
 *  a refusal in the status line; each answers whether the server took it. */
function editCtx(board) {
  const write = (patch, label) => (patch && boardWrite ? boardWrite((key) => putShowdownOverrides(key, patch), label) : Promise.resolve(false));
  return {
    rowOf: (id) => findRow(board, id),
    figureOf: (row, field, isCpt) => {
      const f = playerFigures(row, isCpt);
      return field === "proj" ? f.proj : f.own;
    },
    save: async (row, field, seat, value) => {
      const taken = await write(field === "proj" ? projPatch(row, seat, value) : ownPatch(row, seat, value), "the typed number");
      // Item 5: while TwoGun is the only projection source ticked, a typed number does not bring a man listed out back (the standing ruling); say so beside his row at the write.
      if (taken && field === "proj" && value > 0 && rowIsOut(row) && board?.mode?.cashMode === "twogun") rowNotice(row.id, SET_ASIDE_NOTICE);
      return taken;
    },
    saveNote: (row, text) => write(notePatch(row, text), "the note"),
    toggleStar: (row) => write(starPatch(row), "the star"),
    rowError,
  };
}

/** Redraws the pool alone, for the filter bar above the builder (view.js): a chip or a typed filter never redraws the builder. */
export function repaintShowdownPool() {
  if (lastContainer && lastBoard) paintPool(lastContainer, poolCtx(lastBoard));
}

// The saved card with the panel's rename box, delete prompt and PUT state (lineup-saved.js draws it); `numbers`: numberLineups of this game's saved lineups.
export function savedLineupCardHtml(lineup, board, figures = playerFigures, numbers = null) {
  return savedCardHtml(lineup, board, figures, { renamingId: state.renamingId, deleteConfirmId: state.deleteConfirmId, numbers, busy: cardPuts.busy.has(lineup.id), error: cardPuts.errors[lineup.id] ?? null, deleteError: state.deleteErrors[lineup.id] ?? null, editableTag: !onSitePage(), ticked: state.dkSelected.has(lineup.id), confirm: state.confirm });
}

// The Optimizer's "only lineups with" list filters these cards too, live app only (D77; optimizer.js optimizerSavedFilter).
function savedLineupsSectionHtml(board) {
  return savedSectionHtml(board, { loaded: state.savedLoaded, error: state.savedError, lineups: state.savedLineups }, (l, numbers) => savedLineupCardHtml(l, board, undefined, numbers), optimizerSavedFilter(board), { selected: state.dkSelected, status: state.dkStatus });
}

/** The saved lineups on screen (A12): all of them, or only those the "only lineups with" list keeps; what Download DK CSV acts on. */
function shownSavedLineups(board) {
  const f = optimizerSavedFilter(board);
  return f && f.mustHave.length ? filterLineups(state.savedLineups, f.mustHave, f.playersOf).map((e) => e.item) : state.savedLineups;
}

// `poolRows`: the pool's rows (pool.js poolVisibleRows), read once per draw so the filter bar's count is the same list.
function panelHtml(board, poolRows) {
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
        ${workingTotalsHtml(board)}
        ${meterStripHtml()}
        ${lineupReadOf(board)}
        <div id="${BUILD_STATUS_ID}">${buildStatusHtml(board, messageRowShown(poolRows))}</div>
        ${optimizerBandBoxesHtml(board)}
        ${optimizerGoRowHtml(board)}
      </div>
      <div class="lineup-right sd-pool-col">${poolHtml(board, listPlacement(), poolRows)}</div>
    </div>
    ${optimizerResultsBlockHtml(board, state.savedLineups, state.confirm)}
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
    onLock: (row, kind, on) => (on ? lockSeat(row, kind) : unlockSeat(row, kind)), // D3: Lock seats the man; Unlock takes him out
    loadResult: (uid) => requestLoad("result", uid), // A13: a generated card into the builder's seats
    boardWrite: (send, label) => (boardWrite ? boardWrite(send, label) : console.error("A Showdown board write was asked for, but view.js passed no board writer.")), // the ± bump (Adam 2026-10-22)
    rowError, // B12: a failed write for a pool row is said beside that row, in red
  };
}

// `container`: the whole panel, or the pool's element when only the pool was repainted.
function wireRowButtons(container, board) {
  wirePoolControls(container, optCtx(board, lastKey));
  wirePoolEdits(container, editCtx(board)); // B2, B3, C23: the star, the typed Proj and Own, the pencil
  wirePickRows(container, POOL_PICK_SKIP, (id, action) => { // a click on a pool row (D39): the man goes in or out, and the panel is redrawn
    pickPoolRow(findRow(board, id), action, board);
    commit();
  });
}

function wire(container, board, key) {
  wireMeter(container);
  wireSwaps(container);
  wireConfirmDismiss();
  // B13, B6: Clear lineup asks `Clear the lineup?` beside itself when it would lose a man, as classic's does (confirm-inline.js); with nothing in the seats it just clears. It empties the seats and their locks only.
  container.querySelector("#sd-lineup-clear-all-btn")?.addEventListener("click", () => {
    if (!clearAllHasContent()) {
      clearAll();
      commit();
      return;
    }
    state.confirm = "clear";
    commit();
  });
  container.querySelectorAll("[data-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const which = btn.dataset.confirmFor ?? "";
      if (btn.dataset.confirm !== "yes") {
        state.confirm = null;
        commit();
      } else if (which === "clear") {
        clearAll();
        commit();
      } else if (which.startsWith("load:")) {
        const [, kind, ...rest] = which.split(":");
        doLoadLineup(kind, rest.join(":"));
      }
    });
  });
  // A click (or Enter / Space) on a filled slot card takes his man out (D39, Adam 4:45 PM 2026-10-29: no Clear buttons); his name keeps opening his card.
  const onSlot = (el, remove) => wirePick(el, SLOT_PICK_SKIP, () => { remove(); commit(); });
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
  // C27: Enter in the name box saves, as the Save working lineup button does (with nothing in the seats it says so, the button's own refusal).
  const saveName = container.querySelector("#sd-lineup-save-name");
  saveName?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSaveLineup(key, saveName.value);
  });
  wireDkDownload(container, {
    selected: state.dkSelected,
    shown: () => shownSavedLineups(board),
    kind: "showdown",
    board: () => board,
    slateLabel: () => key ?? "",
    setStatus: (text) => { state.dkStatus = text; },
    redraw: commit,
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
      delete state.deleteErrors[id]; // a new try clears the last delete's failure sentence (A12)
      commit();
    },
    deleteNo: () => {
      state.deleteConfirmId = null;
      commit();
    },
    deleteYes: (id) => doDeleteLineup(key, id),
    load: (id) => requestLoad("saved", id),
  });
  focusOpenConfirm(container);
  wireOptimizer(optCtx(board, key));
}

/** Esc and a click outside close every open confirm alike: Clear all, Load over unsaved slots and a saved card's Delete (confirm-inline.js onConfirmDismiss). */
let dismissWired = false;
function wireConfirmDismiss() {
  if (dismissWired || typeof document === "undefined" || typeof document.addEventListener !== "function") return; // a test's stand-in page has none
  dismissWired = true;
  onConfirmDismiss(() => {
    if (!state.confirm && !state.deleteConfirmId) return;
    state.confirm = null;
    state.deleteConfirmId = null;
    commit();
  });
}

let focusedConfirm = null; // the confirm that last took the keyboard, so a redraw while it stays open does not take it again
/** A confirm that has just opened takes the keyboard on its safe button (No); Yes and No are in the tab order right after the control. */
function focusOpenConfirm(container) {
  const key = state.confirm ?? (state.deleteConfirmId ? `delete:${state.deleteConfirmId}` : null);
  if (key && key !== focusedConfirm) container.querySelector(state.confirm ? "[data-confirm='no']" : "[data-action='sd-delete-no']")?.focus?.();
  focusedConfirm = key;
}

let lastValidatedKey = null;
let lastMessageScope = null; // "game|optimizer mode" the one-shot messages were made under

/** Item 17 (round 3 fixes): the messages a click leaves (`Saved "..."`, the DK status, a refused pool click) belong to the game and mode they
 *  were made in; a different game or mode starts clean. */
function dropStaleMessages(key) {
  const scope = `${key}|${optimizerState().ks?.mode ?? ""}`;
  if (lastMessageScope !== null && scope !== lastMessageScope) {
    state.dkStatus = "";
    state.saveConfirm = null;
    state.addError = null;
    state.addErrorId = null;
    state.addTone = undefined;
  }
  lastMessageScope = scope;
}

// `onOpenSources`: what the meter's figures label's Sources link does (view.js: the Showdown header's Sources button's opener).
// `onBoardWrite(send, label)`: view.js's runner of a write that answers this game's board, which it applies as a refresh's (the ± bump).
// `onPoolCount(shown, total)`: view.js's writer of the filter bar's count. `onDrawn()`: view.js's step after each draw (the pool's Expand
// bar and height, the sticky bar's height). `container` is the Optimizer tab's mount (#sd-lineup-mount): the game line and the filter bar
// sit outside it, so a redraw here never replaces a box Adam is typing in.
export function renderShowdownLineupPanel(container, board, key, { onOpenSources = openSources, onBoardWrite = boardWrite, onPoolCount = poolCount, onDrawn = afterDraw } = {}) {
  lastContainer = container;
  lastBoard = board;
  setSeatBoard(board);
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
    // Captain/FLEX, ticked saved lineups and open rename/delete prompts must never carry over (🔵 review item 7).
    state.cpt = null;
    state.flex = new Array(FLEX_COUNT).fill(null);
    state.addError = null; // a refusal beside a row of the other game's pool is not this game's
    state.addErrorId = null;
    state.addTone = undefined;
    state.dkSelected.clear();
    state.dkStatus = "";
    state.deleteErrors = {};
    state.renamingId = null;
    state.deleteConfirmId = null;
    state.confirm = null;
    if (key) loadSavedLineups(key);
  }
  syncOptimizer(key, board); // this showdown's Optimizer settings; another showdown's batch is dropped (first: the meter reads its excludes)
  dropStaleMessages(key);
  reseatStoredLocks(`${key}|${optimizerState().ks?.mode ?? ""}`); // stored locks get their seats (or are dropped, with a sentence) at a game's first draw and at a mode switch
  wireStaleMessages(container, {
    hasAny: () => Boolean(state.dkStatus || state.saveConfirm || state.addError || limitRefusals().length),
    clear: () => { state.dkStatus = ""; state.saveConfirm = null; state.addError = null; state.addErrorId = null; state.addTone = undefined; dropOlderLimitRefusals(container); }, // a refused Min % / Max % text made in this very press stays (limit-box.js)
    press: noteLimitPress,
    selector: ".dk-status, .row-msg-warn, .row-msg-notice, .lineup-status:not(.lineup-status-error):not(.lineup-status-warning)",
  });
  syncMeter({ board, key, cpt: state.cpt, flex: state.flex, container, excludes: optimizerExcludes(), onSources: openSources, onModes: repaintSlotFigures }); // the meter repaints only its own strip and the slots' notes; the on-screen mode's excludes, as a batch card's meter has them (🔵 866b0ce B1)
  syncSwaps({ board, key, cpt: state.cpt, flex: state.flex, container, excludes: optimizerExcludes() }); // after the meter: the swaps exist while it has a complete live lineup; the meter's excludes, so no excluded man is offered
  const poolRows = poolVisibleRows(board);
  const poolScroll = container.querySelector?.("#sd-pool .scroll-panel")?.scrollTop ?? 0; // an Add click redraws the panel: the pool keeps its place
  const openEdit = takePoolEdit(container); // a typed-number or note box, or a Min % / Max % box, that he is typing in survives the redraw with its text and focus (A3)
  const openLimit = takeOpenLimit();
  container.innerHTML = panelHtml(board, poolRows);
  wire(container, board, key);
  restorePoolEdit(container, openEdit, editCtx(board));
  restoreOpenLimit(container, openLimit);
  poolCount?.(poolRows.length, (board?.rows ?? []).length);
  afterDraw?.();
  const poolPanel = poolScroll ? container.querySelector?.("#sd-pool .scroll-panel") : null;
  if (poolPanel) poolPanel.scrollTop = poolScroll;
}
