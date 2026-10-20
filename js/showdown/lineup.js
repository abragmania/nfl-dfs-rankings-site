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
import { matchupPillHtml } from "../player-row.js";
import { postShowdownLineupOptimize, getShowdownLineups, postShowdownLineup, deleteShowdownLineup, putShowdownLineupName } from "./api.js";
import { sdLine, SD_PILL } from "./table.js";
import { listsHtml, paintLists, wireLists, setListControls } from "./lineup-lists.js"; // the Captain list and the FLEX list, each sortable (Adam 2026-10-18)
// The Showdown Optimizer (Adam 2026-10-19, sketch A): its band over the builder, its Make row under it, its batch full width below, its controls on the pool rows.
import { syncOptimizer, optimizerLive, optimizerBandHeadHtml, optimizerBandBoxesHtml, optimizerGoRowHtml, optimizerResultsBlockHtml, optimizerExcludes, poolChipsRowHtml, listControls, wirePoolControls, wireOptimizer } from "./optimizer.js";
import { handBuild } from "../lineup-builds.js";
import { requestFailureText } from "./read-json.js";
import { lineupModeOf, cashBadgeHtml } from "../lineup-cash.js";
import { showdownPalette, slotLook, slotLogoHtml, controlsHtml as controlsMarkup } from "./lineup-look.js"; // the classic team rows on the slots and saved rows, the two-row controls (Adam 2026-10-18 9:09 PM)
import { teamColours, teamColourStyle } from "../lineup-card.js";
import { syncSwaps, swapsPanelHtml, wireSwaps } from "./lineup-swaps.js"; // the uniqueness swaps, full width below both columns (Adam 2026-10-18)
import { showAllToggleHtml, wireShowAllButtons } from "../filterbar.js";
import { store } from "../state.js";
import { showdownPerSpotText, shownTotal } from "../totals.js";
import { syncMeter, meterStripHtml, wireMeter, playerFigures, reasonHtml } from "./lineup-meter.js"; // uniqueness / projection strip under the slots; every figure on the screen is the served board's (Adam 2026-10-20)
import { builtOnText } from "./figures-label.js"; // the board's sources in words (the retired Figures switch's place)

const SALARY_CAP = 50000;
const FLEX_COUNT = 5;
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
let savedFetchInFlightKey = null;

setListControls(listControls); // the pool rows' Min % / Max % boxes and lock / In / exclude buttons (live app only)

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

function findRow(board, id) {
  return (board?.rows ?? []).find((r) => String(r.id) === String(id));
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

async function doRenameLineup(key, id, name) {
  state.renamingId = null;
  commit();
  try {
    const data = await putShowdownLineupName(key, id, name);
    if (data && data.ok !== false && Array.isArray(data.lineups)) state.savedLineups = data.lineups;
  } catch (e) {
    // Best-effort: nothing destructive happened, the list just won't reflect the rename until reloaded.
  }
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

function ownParen(own) {
  return own == null ? "" : ` (${Math.round(own)}% own)`;
}

// The slot's "$ · proj · (own)" line: the board row's projection and ownership (playerFigures) and salary. A missing figure
// reads "no proj" / no "% own", never zero (D29); a man not on TwoGun's board reads "(not on TwoGun's board, 0%)" (Q8).
function slotDetailHtml(row, isCpt) {
  const salary = isCpt ? row.cptSalary : row.salary;
  const { proj, own, notOnBoard, missingReason, projNote } = playerFigures(row, isCpt);
  const projText = proj == null ? "no proj" : `${dec1(proj)} proj`;
  const projHtml = projNote ? `<span title="${escapeHtml(projNote)}">${projText}</span>` : projText; // listed Out: TwoGun's own figure on hover
  const ownText = notOnBoard ? " (not on TwoGun's board, 0%)" : ownParen(own);
  return `${money(salary)} &middot; ${projHtml}${escapeHtml(ownText)}${missingReason ? ` &middot; ${reasonHtml(missingReason)}` : ""}`;
}

// Repaints only the six slots' figure lines and the total projection line under them (the panel is not redrawn, so a
// typed lineup name survives); the meter calls it when its modes answer (each man's notes) lands.
function repaintSlotFigures() {
  if (!lastContainer || !lastBoard) return;
  const paint = (slotEl, placed, isCpt) => {
    const row = placed ? findRow(lastBoard, placed.id) : null;
    const el = slotEl?.querySelector?.(".lineup-slot-detail");
    if (row && el) el.innerHTML = slotDetailHtml(row, isCpt);
  };
  paint(lastContainer.querySelector(".sd-cpt-slot"), state.cpt, true);
  lastContainer.querySelectorAll("[data-flex-index]").forEach((el) => paint(el, state.flex[Number(el.dataset.flexIndex)], false));
  const totalsEl = lastContainer.querySelector(".lineup-totals");
  if (totalsEl) totalsEl.innerHTML = totalsLineHtml(computeTotals(lastBoard));
  // Both player lists (Captain and FLEX) and the saved cards' projection totals carry the same notes, repainted in place.
  paintLists(lastContainer, listCtx(lastBoard));
  lastContainer.querySelectorAll(".saved-lineup-proj").forEach((el) => {
    const lineup = state.savedLineups.find((l) => l.id === el.dataset.lineupId);
    if (lineup) el.innerHTML = savedProjHtml(lineup, lastBoard);
  });
}

export function slotPlayerHtml(row, isCpt) {
  return `
    <span class="lineup-slot-player lineup-slot-player-2" data-card-id="${escapeHtml(String(row.id))}">
      ${slotLogoHtml(row)}
      <span class="lineup-slot-body">
        <span class="lineup-slot-top">${sdLine(row, { nameCls: "lineup-slot-name", pill: false, tag: "out", logo: false })}</span>
        ${SD_PILL ? matchupPillHtml(row) : ""}
        <span class="lineup-slot-detail">${slotDetailHtml(row, isCpt)}</span>
      </span>
    </span>`;
}

function slotsHtml(board) {
  const cptRow = state.cpt ? findRow(board, state.cpt.id) : null;
  const cptBody = !state.cpt
    ? `<span class="lineup-slot-player lineup-slot-empty">Empty</span>`
    : cptRow
      ? slotPlayerHtml(cptRow, true)
      : `<span class="lineup-slot-player lineup-slot-missing">Not on this board</span>`;
  const cptLook = slotLook(cptRow);
  const cptHtml = `
    <div class="lineup-slot lineup-slot-tall sd-cpt-slot${cptLook.cls}"${cptLook.attr}>
      <span class="lineup-slot-label">CPT</span>
      ${cptBody}
      <button type="button" class="lineup-slot-clear" data-action="clear-cpt"${state.cpt ? "" : " disabled"}>Clear</button>
    </div>`;
  const flexHtml = state.flex
    .map((s, i) => {
      const row = s ? findRow(board, s.id) : null;
      const body = !s
        ? `<span class="lineup-slot-player lineup-slot-empty">Empty</span>`
        : row
          ? slotPlayerHtml(row, false)
          : `<span class="lineup-slot-player lineup-slot-missing">Not on this board</span>`;
      const look = slotLook(row);
      return `
        <div class="lineup-slot lineup-slot-tall${look.cls}"${look.attr} data-flex-index="${i}">
          <span class="lineup-slot-label">FLEX</span>
          ${body}
          <button type="button" class="lineup-slot-clear" data-action="clear-flex" data-flex="${i}"${s ? "" : " disabled"}>Clear</button>
        </div>`;
    })
    .join("");
  return cptHtml + flexHtml;
}

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

// What the two player lists need from the lineup: who is placed (a placed man's row is tinted in both lists, and his Add FLEX
// is disabled) and what a click does. A row click is the Add button's click (the Captain list's puts him in the Captain
// slot, the FLEX list's in the next open FLEX slot); the rules stay in addCaptain and addFlex.
function listPlacement() {
  return { cptId: state.cpt ? String(state.cpt.id) : null, flexIds: new Set(state.flex.filter(Boolean).map((s) => String(s.id))) };
}

function listCtx(board) {
  return {
    board,
    placement: listPlacement,
    onPick: (kind, id) => {
      if (kind === "cpt") addCaptain(findRow(board, id));
      else addFlex(findRow(board, id));
      commit();
    },
    onRepaint: (listEl) => wireRowButtons(listEl, board), // a repainted list's buttons are new
  };
}

function formatSavedAt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// `palette`: the Showdown's team colours (lineup-look.js showdownPalette), so a saved row wears the slots' colours as classic's saved rows wear the cards'.
export function savedLineupSlotHtml(entry, palette = null) {
  if (!entry) return "";
  const { slot, row, snap } = entry;
  const src = row ?? snap;
  const cptCls = slot === "CPT" ? " sd-saved-cpt" : "";
  if (!src) return `<div class="saved-lineup-slot saved-lineup-slot-tc saved-lineup-slot-empty${cptCls}"><span class="saved-lineup-slot-pos">${escapeHtml(slot)}</span><span class="saved-lineup-slot-empty-text">Empty</span></div>`;
  const missingCls = row ? "" : " saved-lineup-slot-missing";
  const noteHtml = row ? "" : `<span class="saved-lineup-slot-note">not on board</span>`;
  return `
    <div class="saved-lineup-slot saved-lineup-slot-tc${missingCls}${cptCls}" style="${teamColourStyle(teamColours(palette, src.team))}" data-card-id="${escapeHtml(String(row?.id ?? snap?.playerId ?? ""))}">
      <span class="saved-lineup-slot-pos">${escapeHtml(slot)}</span>
      ${sdLine(src, { nameCls: "saved-lineup-slot-name", tag: row ? "out" : false, chipPlain: true })}
      <span class="saved-lineup-slot-salary">${money(slot === "CPT" ? row?.cptSalary ?? snap?.salary : row?.salary ?? snap?.salary)}</span>
      ${noteHtml}
    </div>`;
}

// The saved card's projection total (the board row's figures, `figures` = playerFigures by default): null when
// a man is off the board or has no figure. The salary total is the board's too. The total is the sum of the six
// figures each rounded to one decimal as a card row prints them (totals.js shownTotal, ChatGPT wish d, Adam 2026-10-17), as a
// generated card's total is (optimizer-view.js gppTotalsText): 👁 V4 found this card summing the unrounded figures, so the
// same six men read 105.0 here and 105.1 on their results card.
export function savedProjTotal(lineup, board, figures = playerFigures) {
  const projs = [];
  for (const s of lineup.slots ?? []) {
    const row = findRow(board, s.playerId);
    const proj = row ? figures(row, String(s.slot ?? "").toUpperCase() === "CPT").proj : null;
    if (!Number.isFinite(proj)) return null;
    projs.push(proj);
  }
  return projs.length ? shownTotal(projs) : 0; // no slots at all: 0, as before
}

function savedProjHtml(lineup, board, figures = playerFigures) {
  const total = savedProjTotal(lineup, board, figures);
  return total === null ? "proj unknown (a player has no projection)" : `${dec1(total)} proj`; // the "·" before it is CSS (.saved-lineup-totals), as on classic's card
}

export function savedLineupCardHtml(lineup, board, figures = playerFigures) {
  const entries = (lineup.slots ?? []).map((s) => ({ slot: s.slot, row: findRow(board, s.playerId), snap: s }));
  let salaryUsed = 0;
  for (const e of entries) {
    const row = e.row;
    if (!row) {
      // The snapshot's own "salary" field is already the right one for its slot (CPT or FLEX) — routes.js
      // resolves that at save time (~line 559); there is no separate snap.cptSalary (🔵 review item 11).
      salaryUsed += e.snap.salary ?? 0;
      continue;
    }
    salaryUsed += (e.slot === "CPT" ? row.cptSalary : row.salary) ?? 0;
  }
  const overCap = salaryUsed > SALARY_CAP;
  const incomplete = entries.length < FLEX_COUNT + 1;
  const isRenaming = state.renamingId === lineup.id;
  const isConfirmingDelete = state.deleteConfirmId === lineup.id;
  const badges = [
    lineupModeOf(lineup) === "cash" ? cashBadgeHtml() : "", // a lineup saved from a Cash batch says so, as classic's Saved card does
    incomplete ? `<span class="saved-lineup-badge saved-lineup-badge-warning">Incomplete</span>` : "",
    overCap ? `<span class="saved-lineup-badge saved-lineup-badge-danger">Over cap</span>` : "",
  ].join("");
  const nameHtml = isRenaming
    ? `<span class="saved-lineup-rename">
        <input type="text" class="saved-lineup-rename-input" data-rename-input value="${escapeHtml(lineup.name)}" />
        <button type="button" class="saved-lineup-mini-btn" data-action="sd-rename-save" data-id="${escapeHtml(lineup.id)}">Save</button>
        <button type="button" class="saved-lineup-mini-btn" data-action="sd-rename-cancel">Cancel</button>
      </span>`
    : `<button type="button" class="saved-lineup-name-btn" data-action="sd-rename-start" data-id="${escapeHtml(lineup.id)}" title="Click to rename">${escapeHtml(lineup.name)}</button>`;
  const palette = showdownPalette(board);
  const rowsHtml = entries.map((e) => savedLineupSlotHtml(e, palette)).join("");
  const salaryLeft = SALARY_CAP - salaryUsed;
  const salaryText = overCap ? `${money(salaryUsed)} used &middot; ${money(-salaryLeft)} over` : `${money(salaryUsed)} used &middot; ${money(salaryLeft)} left`;
  const deleteHtml = isConfirmingDelete
    ? `<span class="saved-lineup-confirm">Delete this lineup?
        <button type="button" class="saved-lineup-mini-btn danger" data-action="sd-delete-yes" data-id="${escapeHtml(lineup.id)}">Yes</button>
        <button type="button" class="saved-lineup-mini-btn" data-action="sd-delete-no">No</button>
      </span>`
    : `<button type="button" class="saved-lineup-btn danger" data-action="sd-delete-start" data-id="${escapeHtml(lineup.id)}">Delete</button>`;
  return `
    <div class="saved-lineup-card">
      <div class="saved-lineup-card-head">
        ${nameHtml}
        <span class="saved-lineup-time">${escapeHtml(formatSavedAt(lineup.savedAt))}</span>
        ${badges}
      </div>
      <div class="saved-lineup-slots">${rowsHtml}</div>
      <div class="saved-lineup-totals">
        <span class="${overCap ? "saved-lineup-totals-over" : ""}">${salaryText}</span>
        <span class="saved-lineup-proj" data-lineup-id="${escapeHtml(lineup.id)}">${savedProjHtml(lineup, board, figures)}</span>
      </div>
      <div class="saved-lineup-actions">
        <button type="button" class="saved-lineup-btn" data-action="sd-load" data-id="${escapeHtml(lineup.id)}">Load</button>
        ${deleteHtml}
      </div>
    </div>`;
}

function savedLineupsSectionHtml(board) {
  let body;
  if (!state.savedLoaded) {
    body = `<div class="saved-lineups-loading">Loading…</div>`;
  } else if (state.savedError) {
    body = `<div class="saved-lineups-empty saved-lineups-error">${escapeHtml(state.savedError)}</div>`;
  } else if (state.savedLineups.length === 0) {
    body = `<div class="saved-lineups-empty">No saved lineups yet.</div>`;
  } else {
    body = `<div class="saved-lineups-list">${state.savedLineups.map((l) => savedLineupCardHtml(l, board)).join("")}</div>`;
  }
  return `
    <div class="saved-lineups" id="sd-saved-lineups">
      <h3 class="saved-lineups-title">Saved lineups</h3>
      ${body}
    </div>`;
}

function panelHtml(board) {
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
  // The Optimizer (sketch A, Adam 2026-10-19): its band head heads the left column (wider then, .sd-opt-left), the builder sits under
  // it unchanged, then the Pool and Build boxes (Adam 2026-10-20: "I can't see the main lineup that I'm building", so the six slots
  // and the meter come before the boxes) and the Make row (sticky, as classic's footer) ends it; the batch is full width below both columns, its cards four
  // across (Adam 2026-10-19 11:17 PM: "generated lineups should go 4 across"). Off the live app the pieces are empty, as before.
  return `
    <div class="lineup-layout">
      <div class="lineup-left${optimizerLive() ? " sd-opt-left" : ""}">
        ${optimizerBandHeadHtml(board)}
        ${controlsHtml()}
        <div class="lineup-slots">${slotsHtml(board)}</div>
        ${meterStripHtml()}
        <div class="salary-bar">
          <div class="salary-bar-track"><div class="salary-bar-fill${overCap ? " over" : ""}" style="width:${fillPct}%"></div></div>
          <span class="salary-bar-label${overCap ? " over" : ""}">${escapeHtml(salaryText)}</span>
        </div>
        <div class="lineup-totals">${totalsLineHtml(totals)}</div>
        ${buildStatusHtml(board)}
        ${optimizerBandBoxesHtml(board)}
        ${optimizerGoRowHtml(board)}
      </div>
      <div class="lineup-right">
        <h3 class="lineup-right-title">Showdown players (click a column to sort)</h3>
        ${optimizerLive() ? "" : `<div class="chip-group lineup-pos-chips">${showAllToggleHtml(store.get().filters.showAllPlayers, `data-action="show-all"`)}</div>`}
        ${listsHtml(board, listPlacement(), poolChipsRowHtml())}
      </div>
    </div>
    ${optimizerResultsBlockHtml(board, state.savedLineups)}
    ${swapsPanelHtml()}
    ${savedLineupsSectionHtml(board)}`;
}

// The Optimizer's hands into this panel: the redraw, the saved list (its Saved ✓ marks and its saves), and a repaint of both pool lists in place.
function optCtx(board, key) {
  return {
    container: lastContainer,
    board,
    key,
    commit,
    getSaved: () => state.savedLineups,
    setSaved: (list) => { state.savedLineups = list; },
    repaintPool: () => { if (lastContainer) paintLists(lastContainer, listCtx(board)); },
  };
}

// `container`: the whole panel, or one list's element when only that list was repainted.
function wireRowButtons(container, board) {
  wirePoolControls(container, optCtx(board, lastKey));
  container.querySelectorAll("[data-action='add-cpt']").forEach((btn) => {
    btn.addEventListener("click", () => {
      addCaptain(findRow(board, btn.dataset.id));
      commit();
    });
  });
  container.querySelectorAll("[data-action='add-flex']").forEach((btn) => {
    btn.addEventListener("click", () => {
      addFlex(findRow(board, btn.dataset.id));
      commit();
    });
  });
}

function wire(container, board, key) {
  wireShowAllButtons(container);
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
  container.querySelector("[data-action='clear-cpt']")?.addEventListener("click", () => {
    clearCaptain();
    commit();
  });
  container.querySelectorAll("[data-action='clear-flex']").forEach((btn) => {
    btn.addEventListener("click", () => {
      clearFlex(Number(btn.dataset.flex));
      commit();
    });
  });
  wireRowButtons(container, board);
  wireLists(container, listCtx(board));
  container.querySelector("#sd-lineup-save-btn")?.addEventListener("click", () => {
    const nameInput = container.querySelector("#sd-lineup-save-name");
    doSaveLineup(key, nameInput ? nameInput.value : "");
  });
  container.querySelectorAll("[data-action='sd-rename-start']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.renamingId = btn.dataset.id;
      state.deleteConfirmId = null;
      commit();
    });
  });
  container.querySelectorAll("[data-action='sd-rename-cancel']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.renamingId = null;
      commit();
    });
  });
  container.querySelectorAll("[data-action='sd-rename-save']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = container.querySelector("[data-rename-input]");
      doRenameLineup(key, btn.dataset.id, input ? input.value : "");
    });
  });
  container.querySelectorAll("[data-action='sd-delete-start']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.deleteConfirmId = btn.dataset.id;
      state.renamingId = null;
      commit();
    });
  });
  container.querySelectorAll("[data-action='sd-delete-no']").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.deleteConfirmId = null;
      commit();
    });
  });
  container.querySelectorAll("[data-action='sd-delete-yes']").forEach((btn) => {
    btn.addEventListener("click", () => doDeleteLineup(key, btn.dataset.id));
  });
  container.querySelectorAll("[data-action='sd-load']").forEach((btn) => {
    btn.addEventListener("click", () => doLoadLineup(btn.dataset.id));
  });
  wireOptimizer(optCtx(board, key));
}

let lastValidatedKey = null;

// `onOpenSources`: what the meter's figures label's Sources link does (view.js: the Showdown header's Sources button's opener).
export function renderShowdownLineupPanel(container, board, key, { onOpenSources = openSources } = {}) {
  lastContainer = container;
  lastBoard = board;
  lastKey = key;
  openSources = onOpenSources;
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
  container.innerHTML = panelHtml(board);
  wire(container, board, key);
}
