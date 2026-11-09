// Showdown Lineup Builder tab (D39/D40, brief): one Captain slot and five FLEX (any position including
// kicker and defence, both teams required), salary remaining, Save working lineup and the saved-lineups list against
// /api/showdown/<key>/lineups (same request/response shapes as classic's lineup routes — see
// public/js/lineup.js, which this module mirrors in structure). The pool rows' lock / In / exclude buttons belong to
// the Showdown Optimizer (./optimizer.js, Adam 2026-10-19) and drive its one Build (optimizer standard A13, round 3: the old one-lineup Build, which ignored
// locks and excludes and replaced the placed men, is folded into it). The Optimizer's band heads the left column, its Build row ends it, and its batch is
// drawn full width below both columns, above the swaps and the saved lineups.
import { escapeHtml } from "../format.js";
import { getShowdownLineups, postShowdownLineup, deleteShowdownLineup } from "./api.js";
import { poolHtml, poolVisibleRows, paintPool, wirePool, wirePoolTabs, setPoolControls, POOL_PICK_SKIP } from "./pool.js"; // the one player pool, the Rankings table with both roles on each row (Adam 2026-10-26)
import { wirePick, wirePickRows, SLOT_PICK_SKIP } from "../pick-rows.js"; // click-to-pick, the one wiring classic's Optimizer shares (D81)
// The Showdown Optimizer (Adam 2026-10-19, sketch A): its band over the builder, its Make row under it, its batch full width below, its controls on the pool rows.
import { syncOptimizer, optimizerState, optimizerLive, optimizerBandHeadHtml, optimizerBandBoxesHtml, optimizerGoRowHtml, optimizerResultsBlockHtml, optimizerExcludes, releaseAllLocks, releaseSeatLock, setOptimizerMode, poolControls, wirePoolControls, wireOptimizer, refreshBuildNotice, optimizerTabFor } from "./optimizer.js";
import { findKept } from "./lineups-store.js"; // the Lineups tab's kept builds: a built card's Load reads its lineup from here
import { openShowdownTabKey } from "./lineups-nav.js"; // a Load goes back to the Optimizer tab, where the working lineup is
import { lineupModeOf } from "../lineup-cash.js";
import { loadModeSwitch } from "./lineups-load-mode.js";
import { wirePoolEdits, takePoolEdit, restorePoolEdit } from "./pool-edit.js"; // B2, B3, C23: the star, the typed Proj and Own, the note's pencil
import { editCtxFor, rowErrorIn } from "./pool-edit-ctx.js"; // what those cells write through, and a row's red message
import { takeOpenLimit, restoreOpenLimit, limitRefusals, dropOlderLimitRefusals, noteLimitPress } from "../limit-box.js"; // A3: the pool's Min % and Max % boxes survive a redraw; a refused text is held
import { handBuild } from "../lineup-builds.js";
import { statusBlockHtml, messageRowShown as messageRowShownIn, BUILD_STATUS_ID } from "./lineup-status.js"; // A14: the status block and the click's message beside its pool row
import { requestFailureText } from "./read-json.js";
import { controlsHtml as controlsMarkup } from "./lineup-look.js"; // the two-row controls (Adam 2026-10-18 9:09 PM)
import { slotsHtml as slotsMarkup, repaintSlots } from "./lineup-slots.js"; // the six slots' markup and figure repaint (Adam 2026-10-21 Q3 option A split)
export { slotPlayerHtml } from "./lineup-slots.js"; // tests import it from here
// The saved-lineups view lives in ./lineup-saved.js (state stays here); the two pure helpers keep their old exports from this module.
import { lineupTotals, lineupTotalsHtml } from "../lineup-totals.js"; // A11
import { findRow, SALARY_CAP, FLEX_COUNT, savedLineupCardHtml as savedCardHtml, cardPutGuard } from "./lineup-saved.js";
import { onSitePage } from "../tabs.js"; // the public site marks the page is-site: its saved cards draw no letter select (it can only be refused there)
export { savedLineupSlotHtml, savedProjTotal } from "./lineup-saved.js";
import { syncSwaps, swapsPanelHtml, wireSwaps, seatsAfterSwap, holdSwapsHeight, setSwapsRefusal } from "./lineup-swaps.js"; // the uniqueness swaps, full width below both columns (Adam 2026-10-18); C22: a click on a swap makes it
import { showdownPerSpotText, shownTotal } from "../totals.js";
import { syncMeter, meterStripHtml, wireMeter, playerFigures, lineupFigureRow } from "./lineup-meter.js"; // uniqueness / projection strip under the slots; every figure on the screen is the served board's (Adam 2026-10-20)
import { lineupReadHtml } from "./lineup-read.js"; // the "Lineup read" sentences under the meter (Adam 2026-10-29 5:10 PM: "just make it not suck")
import { showBand } from "../show-band.js"; // A12, A15: a Load brings the whole band into view
import { focusOpenRename } from "../rename-focus.js"; // the rename box: focused and selected on open
import { saveView } from "./view-memory.js"; // A9: the pool's filters and sort, per game
import { loadTabSeats, showTabSeats, dropGoneFromTabs, saveTabSeats } from "./tab-seats.js"; // the GPP and Cash tabs' own lineups: the seats on screen are the tab on screen's
import { leftOutPanelHtml, syncLeftOut } from "./left-out-panel.js"; // Part F: the Cash tab's Left out panel, under the two columns (the sticky lineup band must fit the window)
import { onConfirmDismiss } from "../confirm-inline.js"; // B13, C11: Esc and a click outside close an open confirm
import { notDeletedText } from "../delete-words.js"; // A12: the one sentence a failed delete leaves, the classic Optimizer's words
import { wireStaleMessages } from "../stale-messages.js"; // item 17: a one-shot message goes at the next click on any control
import { wireSavedActions } from "./lineups-saved-wire.js"; // A12: Download DK CSV for the saved lineups ticked, rename, the letter, Delete and Load: the saved cards' wiring, on the Lineups tab
// The working lineup, its click rules, Lock/Unlock, Clear lineup and the saved-or-not question: ./seats.js (split out to keep this file under its cap).
import { state, setSeatBoard, reseatStoredLocks, pickPoolRow, lineupPicks, listPlacement, lockSeat, unlockSeat, clearCaptain, clearFlex, clearAll, clearAllHasContent, workingUnsaved, rowIdOf, lockedSeatPositions, swapLockRefusal } from "./seats.js";
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

let lineupsRedraw = null; // the Lineups tab's redraw (lineups-screen.js registers it): the saved cards live there, so a change to them redraws it too
export function setLineupsRedraw(fn) {
  lineupsRedraw = typeof fn === "function" ? fn : null;
}

function commit() {
  if (lastContainer) renderShowdownLineupPanel(lastContainer, lastBoard, lastKey);
  lineupsRedraw?.();
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
 * state), `boardMode` = the board's mode.cashMode ("twogun" or "current"; null records none), `mode` = the tab the lineup was built on: only "cash" is sent, as classic's hand save sends it (a GPP body keeps its old shape).
 */
export function handSaveBody(name, picked, boardMode, mode = "gpp") {
  const slots = [];
  if (picked.cpt) slots.push({ slot: "CPT", playerId: String(picked.cpt.id) });
  for (const s of picked.flex ?? []) if (s) slots.push({ slot: "FLEX", playerId: String(s.id) });
  return { name, slots, ...(mode === "cash" ? { mode: "cash" } : {}), build: handBuild(boardMode) };
}

async function doSaveLineup(key, name) {
  if (state.saving) return;
  const body = handSaveBody(name, state, lastBoard?.mode?.cashMode ?? null, optimizerState().ks?.mode);
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

const loadMode = loadModeSwitch((m) => { setOptimizerMode(m); const lost = showTabSeats(m); if (lost) state.addError = lost; }); // No or Esc on a Load's question puts the previous mode tab back (lineups-load-mode.js)

/** A Load (a saved card's, or a generated card's: A13): over slots that are not saved it asks `Replace your working lineup?` first (C11); `kind` "saved" or "result". */
function requestLoad(kind, id) {
  const found = kind === "result" ? findKept(lastKey, id) : null;
  const savedOne = kind === "saved" ? state.savedLineups.find((l) => l.id === id) : null;
  const target = found ? found.build.mode : savedOne ? lineupModeOf(savedOne) : null;
  loadMode.go(target, optimizerState().ks?.mode ?? "gpp"); // a Load goes to the working lineup of the lineup's own mode tab (Lineups tab, Adam 2026-11-05): that tab's seats come on screen first
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
  loadMode.done();
  const lineup = kind === "result" ? findKept(lastKey, id)?.lineup : state.savedLineups.find((l) => l.id === id);
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
  releaseAllLocks(); // the whole lineup is replaced: every lock of the tab on screen goes (the other tab's are its own)
  commit();
  openShowdownTabKey("lineup"); // the cards are on the Lineups tab: the Optimizer tab comes up so the working lineup is in view
  showBand(lastContainer, "sd-lineup-panel"); // the whole band under the sticky layers, and again after the meter has drawn (show-band.js)
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
  // The pool and the saved cards' rows and totals carry the same notes, so a card's rows and totals never disagree: the pool is repainted in place, and the saved cards (on the Lineups tab now) are redrawn with the same figures when it is on screen.
  paintPool(lastContainer, poolCtx(lastBoard));
  lineupsRedraw?.();
}

export const lineupReadOf = (board) => lineupReadHtml({ ...board, rows: (board?.rows ?? []).map(lineupFigureRow) }, state); // the rows as the lineup reads them (a revive TwoGun-only ignores reads 0)
/** Redraws the Lineup read in place when the modes answer lands (it reads the same figures as the slots): replaced, removed when empty, or added above the status block. */
function repaintLineupRead() {
  const holder = lastContainer.querySelector("#sd-read-holder"); // A15: the read sits under the two columns, not in the lineup band, which must fit the window
  if (holder) holder.innerHTML = lineupReadOf(lastBoard);
}

const slotsHtml = (board) => slotsMarkup(board, state); // the placed slots go in as parameters (lineup-slots.js)

function controlsHtml() {
  const hasAnySlot = Boolean(state.cpt) || state.flex.some(Boolean);
  return controlsMarkup({ saving: state.saving, saveName: state.saveName, hasAnySlot, confirm: state.confirm, mode: optimizerLive() ? optimizerState().ks.mode : null });
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
      saveView(); // A9: a filter, a sort or a column change is remembered for this game
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

/** A failed write for a pool row is said beside that row, in red (B12, B3); the star, the typed numbers and the pencil: pool-edit-ctx.js. */
const rowError = (id, text) => rowErrorIn(state, commit, id, text);
const editCtx = (board) => editCtxFor({ board, state, commit, boardWrite: () => boardWrite });

/** Redraws the pool alone, for the filter bar above the builder (view.js): a chip or a typed filter never redraws the builder. */
export function repaintShowdownPool() {
  if (lastContainer && lastBoard) paintPool(lastContainer, poolCtx(lastBoard));
}

// The saved card with the panel's rename box, delete prompt and PUT state (lineup-saved.js draws it); `numbers`: numberLineups of this game's saved lineups.
export function savedLineupCardHtml(lineup, board, figures = playerFigures, numbers = null) {
  return savedCardHtml(lineup, board, figures, { renamingId: state.renamingId, deleteConfirmId: state.deleteConfirmId, numbers, busy: cardPuts.busy.has(lineup.id), error: cardPuts.errors[lineup.id] ?? null, deleteError: state.deleteErrors[lineup.id] ?? null, editableTag: !onSitePage(), ticked: state.dkSelected.has(lineup.id), confirm: state.confirm });
}

// The saved cards are drawn on the Lineups tab now (lineups-screen.js); `lineupsHands` is what it reads and acts through, so their rename, Load, Download and Delete work as they did.
export function lineupsHands(board, key) {
  return {
    saved: { loaded: state.savedLoaded, error: state.savedError, lineups: state.savedLineups },
    setSaved: (list) => { state.savedLineups = list; },
    cardOf: (l, numbers) => savedLineupCardHtml(l, board, undefined, numbers),
    dk: { selected: state.dkSelected, status: state.dkStatus },
    confirm: state.confirm,
    busy: state.saving || optimizerState().generating,
    requestLoad: (uid) => requestLoad("result", uid),
    wireSaved: (root, shown) => wireLineupsSaved(root, board, key, shown),
    focus: (root) => { focusOpenConfirm(root); focusOpenRename(root, state.renamingId); },
  };
}

// `poolRows`: the pool's rows (pool.js poolVisibleRows), read once per draw so the filter bar's count is the same list.
function panelHtml(board, poolRows) {
  // The Optimizer (sketch A, Adam 2026-10-19): its band head, the Pool and Build boxes and the Build row (optimizer standard A15, round 5: no sticky Make row, so it ends the settings in the page's
  // flow, as classic's does) sit above the two columns, so the left column holds only the lineup: the controls, the six slots, the totals, the meter and the status line, which stick under the filter
  // bar as a band at 1760px and wider while the pool runs down the page beside them (style.css). The player pool is the right column (Adam 2026-10-26: the Rankings table as the pool, its filter
  // bar above the builder, view.js), then the batch, its cards four across (Adam 2026-10-19 11:17 PM: "generated lineups should go 4 across"). Off the live app the Optimizer's pieces are
  // empty, as before. Adam 2026-10-26 3:59 PM: "i like the list to the side of the optimizer not beneath": the pool is beside the lineup on the live app and the public site alike; under 1760px
  // of window it stacks under the lineup (style.css .sd-pool-col).
  return `
    ${optimizerBandHeadHtml(board)}
    ${optimizerBandBoxesHtml(board)}
    ${optimizerGoRowHtml(board)}
    <div class="lineup-layout sd-pool-layout">
      <div class="lineup-left${optimizerLive() ? " sd-opt-left" : ""}">
        ${controlsHtml()}
        <div class="lineup-slots">${slotsHtml(board)}</div>
        ${workingTotalsHtml(board)}
        ${meterStripHtml()}
        <div id="${BUILD_STATUS_ID}">${buildStatusHtml(board, messageRowShown(poolRows))}</div>
      </div>
      <div class="lineup-right sd-pool-col">${poolHtml(board, listPlacement(), poolRows)}</div>
    </div>
    ${leftOutPanelHtml(board)}<div id="sd-read-holder">${lineupReadOf(board)}</div>
    ${optimizerResultsBlockHtml(board, state.savedLineups, state.confirm)}
    ${swapsPanelHtml()}`;
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

/**
 * C22: a click on a swap makes it. The seat's man goes out and the swap's man goes in; the builder, the totals, the meter and the swaps follow, and
 * the swaps panel stays where it is: it keeps its height while its new answer is out and the page is scrolled back to put it under the pointer again. A swap that cannot be made here (the
 * lineup changed under the click, or the man is already in it) changes nothing; one that would take out a man who is locked in his seat is refused with the click rules' sentence beside the panel.
 */
function applySwap(swap, panelEl) {
  const next = seatsAfterSwap({ cpt: state.cpt, flex: state.flex }, swap);
  if (!next) return;
  // A swap is not a way round a lock: it says what the click rules say, beside the panel, and changes nothing (C22).
  const refusal = swapLockRefusal(findRow(lastBoard, next.outId), swap.seat);
  if (refusal) {
    setSwapsRefusal(refusal);
    return;
  }
  setSwapsRefusal("");
  const top = panelEl?.getBoundingClientRect?.().top;
  holdSwapsHeight(panelEl?.getBoundingClientRect?.().height);
  const gone = findRow(lastBoard, next.outId);
  state.cpt = next.cpt;
  state.flex = next.flex;
  releaseSeatLock(gone, swap.seat === "CPT" ? "cpt" : "flex");
  state.addError = null;
  state.addErrorId = null;
  commit();
  const after = lastContainer?.querySelector?.(".sd-swaps")?.getBoundingClientRect?.().top;
  if (typeof top === "number" && typeof after === "number" && typeof window !== "undefined") window.scrollBy(0, after - top);
}

function wire(container, board, key) {
  wireMeter(container);
  wireSwaps(container, { apply: applySwap });
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
  wireConfirms(container);
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
  focusOpenConfirm(container);
  wireOptimizer(optCtx(board, key));
}

/** The inline confirms' Yes and No under `container` (Clear lineup, a Load over unsaved slots): the Optimizer tab's and the Lineups tab's alike. */
function wireConfirms(container) {
  container.querySelectorAll("[data-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const which = btn.dataset.confirmFor ?? "";
      if (btn.dataset.confirm !== "yes") {
        state.confirm = null;
        loadMode.undo();
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
}

/** The saved cards' wiring and Download DK CSV, on the Lineups tab (lineups-screen.js; lineups-saved-wire.js): `shown()` is the saved lineups the tab shows after its filters. */
function wireLineupsSaved(root, board, key, shown) {
  wireConfirms(root);
  wireSavedActions(root, board, key, shown, { state, commit, putCard, doDeleteLineup, requestLoad });
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
    loadMode.undo();
    commit();
  });
}

let focusedConfirm = null; // the confirm that last took the keyboard, so a redraw while it stays open does not take it again
/** A confirm that has just opened takes the keyboard on its safe button (No); Yes and No are in the tab order right after the control. */
function focusOpenConfirm(container) {
  const key = state.confirm ?? (state.deleteConfirmId ? `delete:${state.deleteConfirmId}` : null);
  const safe = key && key !== focusedConfirm ? container.querySelector(state.confirm ? "[data-confirm='no']" : "[data-action='sd-delete-no']") : null; // the confirm may hang in the Lineups tab's box, not this one: only a box that has the button takes it
  safe?.focus?.();
  if (safe || !key) focusedConfirm = key;
}

let lastValidatedKey = null;
let lastSeatBoard = null; // the board the seats were last checked against (a new one for the same game checks them again)
let rememberedNote = ""; // the sentence naming the men a remembered lineup lost, from a game's first draw to its stale-message pass
let lastMessageScope = null; // "game|optimizer mode" the one-shot messages were made under

/** Item 17 (round 3 fixes): the messages a click leaves (`Saved "..."`, the DK status, a refused pool click) belong to the game and mode they
 *  were made in; a different game or mode starts clean. */
function dropStaleMessages(key) {
  const scope = `${key}|${optimizerState().ks?.mode ?? ""}`;
  if (lastMessageScope !== null && scope !== lastMessageScope) {
    state.dkStatus = "";
    state.saveConfirm = null;
    state.saveError = null; // the other tab's Save refusal and swap refusal are not this tab's
    setSwapsRefusal("");
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
    // A different showdown means a different player pool: the other game's ticked saved lineups and open rename/delete prompts must never carry over (🔵 review item 7). Its placed Captain/FLEX
    // are the game's own (A9): this game's remembered lineups (one for the GPP tab, one for Cash) come back, and the other game's were written as they changed, so a switch back finds them. A man who is gone from this board is dropped and named.
    loadTabSeats(key, board); // the tab on screen's seats are put in below, once its mode is known (showTabSeats)
    state.addError = null; // a refusal beside a row of the other game's pool is not this game's
    rememberedNote = ""; // what a remembered lineup lost is said once (set below, after the stale-message pass, which clears a game switch's messages)
    state.addErrorId = null;
    state.addTone = undefined;
    state.dkSelected.clear();
    state.dkStatus = "";
    state.deleteErrors = {};
    state.renamingId = null;
    state.deleteConfirmId = null;
    state.confirm = null;
    if (key) loadSavedLineups(key);
  } else if (board !== lastSeatBoard) {
    // The same game on a new board (a refresh, a re-upload): a man it no longer has (a new id, or he left the file) is taken out of both tabs' lineups and named from the memory, never blank (A9).
    rememberedNote = dropGoneFromTabs(key, board);
  }
  lastSeatBoard = board;
  syncOptimizer(key, board); // this showdown's Optimizer settings; another showdown's batch is dropped (first: the meter reads its excludes)
  rememberedNote = [rememberedNote, showTabSeats(optimizerState().ks?.mode === "cash" ? "cash" : "gpp")].filter(Boolean).join(" "); // the tab on screen's own seats (a tab switch swaps them here)
  dropStaleMessages(key);
  if (rememberedNote) state.addError = rememberedNote;
  rememberedNote = "";
  reseatStoredLocks(`${key}|${optimizerState().ks?.mode ?? ""}`); // stored locks get their seats (or are dropped, with a sentence) at a game's first draw and at a mode switch
  wireStaleMessages(container, {
    hasAny: () => Boolean(state.dkStatus || state.saveConfirm || state.addError || limitRefusals().length),
    clear: () => { state.dkStatus = ""; state.saveConfirm = null; state.addError = null; state.addErrorId = null; state.addTone = undefined; dropOlderLimitRefusals(container); }, // a refused Min % / Max % text made in this very press stays (limit-box.js)
    press: noteLimitPress,
    selector: ".dk-status, .row-msg-warn, .row-msg-notice, .lineup-status:not(.lineup-status-error):not(.lineup-status-warning)",
  });
  syncMeter({ board, key, cpt: state.cpt, flex: state.flex, container, excludes: optimizerExcludes(), onSources: openSources, onModes: repaintSlotFigures, tab: optimizerTabFor(key) }); // the meter (Part F: on the tab's own board) repaints only its own strip and the slots' notes; the on-screen mode's excludes, as a batch card's meter has them (🔵 866b0ce B1)
  syncSwaps({ board, key, cpt: state.cpt, flex: state.flex, container, excludes: optimizerExcludes(), locked: lockedSeatPositions(), tab: optimizerTabFor(key) }); // after the meter: the swaps exist while it has a complete live lineup; the meter's excludes, so no excluded man is offered
  syncLeftOut({ key, board, container, commit }); // Part F: the quiet Cash build behind Left out (Cash tab only); Swap in is wired on the mount
  const poolRows = poolVisibleRows(board);
  const openEdit = takePoolEdit(container); // a typed-number or note box, or a Min % / Max % box, that he is typing in survives the redraw with its text and focus (A3)
  const openLimit = takeOpenLimit();
  container.innerHTML = panelHtml(board, poolRows);
  wire(container, board, key);
  restorePoolEdit(container, openEdit, editCtx(board));
  restoreOpenLimit(container, openLimit);
  poolCount?.(poolRows.length, (board?.rows ?? []).length);
  afterDraw?.();
  saveTabSeats(key, board); // A9: each tab's lineup is remembered under its game as it changes (nothing is written when it did not)
  focusOpenRename(container, state.renamingId); // the rename box takes the keyboard when it opens, its name selected
  refreshBuildNotice(); // A15: the notice under the filter bar follows the build's state and where the Make row is
}
