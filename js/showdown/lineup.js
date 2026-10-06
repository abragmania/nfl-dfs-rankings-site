// Showdown Lineup Builder tab (D39/D40, brief): one Captain slot and five FLEX (any position including
// kicker and defence, both teams required), salary remaining, an objective selector posting to
// POST /api/showdown/<key>/lineup/optimize, Save lineup and the saved-lineups list against
// /api/showdown/<key>/lineups (same request/response shapes as classic's lineup routes — see
// public/js/lineup.js, which this module mirrors in structure but keeps leaner: no per-row lock/exclude
// UI, since the brief's Lineup Builder description for Showdown does not ask for one — Build always runs
// a fresh optimize with empty locks/excludes and replaces whatever is currently placed with the result).
import { escapeHtml, money, dec1, textColourFor } from "../format.js";
import { TEAM_BY_ABBR } from "../teams-data.js";
import { STATUS_INFO } from "../table.js";
import { postShowdownLineupOptimize, getShowdownLineups, postShowdownLineup, deleteShowdownLineup, putShowdownLineupName } from "./api.js";
import { posPillHtml } from "./table.js";

const SALARY_CAP = 50000;
const FLEX_COUNT = 5;
const OBJECTIVES = [
  { value: "proj", label: "Projection" },
  { value: "lev", label: "Leverage" },
  { value: "projMinusOwn", label: "Projection minus ownership" },
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
let savedFetchInFlightKey = null;

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
      state.savedError = `Could not reach the server: ${e.message}`;
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

function computeTotals(board) {
  const entries = [];
  if (state.cpt) entries.push({ id: state.cpt.id, cpt: true });
  for (const s of state.flex) if (s) entries.push({ id: s.id, cpt: false });
  let salaryUsed = 0;
  let totalProj = 0;
  for (const { id, cpt } of entries) {
    const row = findRow(board, id);
    if (!row) continue;
    salaryUsed += (cpt ? row.cptSalary : row.salary) ?? 0;
    totalProj += (cpt ? row.cptProj : row.proj) ?? 0;
  }
  return { salaryUsed, salaryLeft: SALARY_CAP - salaryUsed, totalProj, filled: entries.length };
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
    const data = await postShowdownLineupOptimize(key, { objective: state.objective, locks: [], excludes: [] });
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
      state.lastResult = { feasible: true, message: data.message ?? "", salaryUsed: data.salaryUsed, totalProj: data.totalProj };
    } else {
      state.lastResult = { feasible: false, message: data.message ?? "No legal lineup fits the salary cap and both-teams rule." };
    }
  } catch (e) {
    state.lastResult = { feasible: false, message: `Could not reach the server: ${e.message}` };
  }
  state.building = false;
  commit();
}

async function doSaveLineup(key, name) {
  if (state.saving) return;
  const slotsPayload = [];
  if (state.cpt) slotsPayload.push({ slot: "CPT", playerId: String(state.cpt.id) });
  state.flex.forEach((s) => {
    if (s) slotsPayload.push({ slot: "FLEX", playerId: String(s.id) });
  });
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
    const data = await postShowdownLineup(key, { name, slots: slotsPayload });
    if (!data || data.ok === false) {
      state.saveError = data?.error?.message ?? "Could not save the lineup.";
    } else {
      state.savedLineups = Array.isArray(data.lineups) ? data.lineups : state.savedLineups;
      state.saveName = "";
      state.saveConfirm = `Saved "${data.lineup?.name ?? ""}".`;
    }
  } catch (e) {
    state.saveError = `Could not reach the server: ${e.message}`;
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

function slotPlayerHtml(row, isCpt) {
  const t = TEAM_BY_ABBR[row.team];
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  const textColour = textColourFor(primary, secondary);
  const salary = isCpt ? row.cptSalary : row.salary;
  const proj = isCpt ? row.cptProj : row.proj;
  const own = isCpt ? row.ownCpt : row.ownFlex;
  const projText = proj == null ? "no proj" : dec1(proj);
  return `
    <span class="lineup-slot-player">
      <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(row.team ?? "")}</span>
      ${posPillHtml(row.pos)}
      <span class="lineup-slot-name">${escapeHtml(row.name)}</span>
      <span class="lineup-slot-detail">${money(salary)} &middot; ${projText} proj${escapeHtml(ownParen(own))}</span>
    </span>`;
}

function slotsHtml(board) {
  const cptRow = state.cpt ? findRow(board, state.cpt.id) : null;
  const cptBody = !state.cpt
    ? `<span class="lineup-slot-player lineup-slot-empty">Empty</span>`
    : cptRow
      ? slotPlayerHtml(cptRow, true)
      : `<span class="lineup-slot-player lineup-slot-missing">Not on this board</span>`;
  const cptHtml = `
    <div class="lineup-slot sd-cpt-slot">
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
      return `
        <div class="lineup-slot" data-flex-index="${i}">
          <span class="lineup-slot-label">FLEX</span>
          ${body}
          <button type="button" class="lineup-slot-clear" data-action="clear-flex" data-flex="${i}"${s ? "" : " disabled"}>Clear</button>
        </div>`;
    })
    .join("");
  return cptHtml + flexHtml;
}

function controlsHtml() {
  const objectiveOptions = OBJECTIVES.map(
    (o) => `<option value="${o.value}"${state.objective === o.value ? " selected" : ""}>${escapeHtml(o.label)}</option>`
  ).join("");
  const hasAnySlot = Boolean(state.cpt) || state.flex.some(Boolean);
  return `
    <div class="lineup-controls">
      <label class="lineup-control">Objective
        <select id="sd-lineup-objective">${objectiveOptions}</select>
      </label>
      <button type="button" id="sd-lineup-build-btn" class="lineup-build-btn"${state.building ? " disabled" : ""}>${state.building ? "Building…" : "Build"}</button>
      <button type="button" id="sd-lineup-clear-all-btn" class="lineup-clear-all-btn">Clear all</button>
      <label class="lineup-control">Save as
        <input type="text" id="sd-lineup-save-name" class="lineup-save-name-input" placeholder="Name (optional)" value="${escapeHtml(state.saveName)}" />
      </label>
      <button type="button" id="sd-lineup-save-btn" class="lineup-build-btn"${!hasAnySlot || state.saving ? " disabled" : ""}>${state.saving ? "Saving…" : "Save lineup"}</button>
    </div>`;
}

function buildStatusHtml(board) {
  const parts = [`<div class="lineup-status">${escapeHtml(bothTeamsText(board))}</div>`];
  if (state.addError) parts.push(`<div class="lineup-status lineup-status-warning">${escapeHtml(state.addError)}</div>`);
  if (state.saveError) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(state.saveError)}</div>`);
  else if (state.saveConfirm) parts.push(`<div class="lineup-status">${escapeHtml(state.saveConfirm)}</div>`);
  const r = state.lastResult;
  if (r) {
    if (!r.feasible) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(r.message || "No legal lineup could be built.")}</div>`);
    else if (r.message) parts.push(`<div class="lineup-status">${escapeHtml(r.message)}</div>`);
  }
  return parts.join("");
}

function placedIdSet() {
  const set = new Set();
  if (state.cpt) set.add(String(state.cpt.id));
  for (const s of state.flex) if (s) set.add(String(s.id));
  return set;
}

// Status pill for Out/IR (and Doubtful/Questionable) players, same badge as the Rankings table (👁
// visual-qa item I); ownParen (D32) prints published or estimated ownership, blank when there is none.
function statusPillHtml(row) {
  const raw = (row.status ?? "").trim();
  const info = STATUS_INFO[raw.toLowerCase()];
  if (info) return `<span class="status-badge ${info.cls}">${escapeHtml(info.label)}</span>`;
  if (raw) return `<span class="status-badge status-other">${escapeHtml(raw)}</span>`;
  return "";
}

function rightRowHtml(row, placed) {
  const t = TEAM_BY_ABBR[row.team];
  const primary = t?.colourPrimary ?? "#333333";
  const secondary = t?.colourSecondary ?? "#ffffff";
  const textColour = textColourFor(primary, secondary);
  const isPlaced = placed.has(String(row.id));
  const isCpt = state.cpt && String(state.cpt.id) === String(row.id);
  return `
    <tr class="lineup-row${isPlaced ? " lineup-row-locked" : ""}" data-id="${escapeHtml(String(row.id))}">
      <td>
        <span class="player-cell">
          <span class="team-chip-mini" style="background:${primary};color:${textColour}">${escapeHtml(row.team ?? "")}</span>
          <span class="player-name">${escapeHtml(row.name)}</span>
          ${posPillHtml(row.pos)}
          ${statusPillHtml(row)}
        </span>
      </td>
      <td>${money(row.salary)}</td>
      <td>${money(row.cptSalary)}</td>
      <td>${row.proj == null ? "no proj" : dec1(row.proj)}</td>
      <td>${row.ownFlex == null ? "—" : `${dec1(row.ownFlex)}%`}</td>
      <td class="lineup-row-actions">
        <button type="button" class="lineup-row-btn${isCpt ? " active" : ""}" data-action="add-cpt" data-id="${escapeHtml(String(row.id))}">${isCpt ? "Captain" : "Add CPT"}</button>
        <button type="button" class="lineup-row-btn" data-action="add-flex" data-id="${escapeHtml(String(row.id))}"${isPlaced ? " disabled" : ""}>Add FLEX</button>
      </td>
    </tr>`;
}

function rightColumnHtml(board) {
  // Default sort is Proj descending, matching the Rankings tab (coordinator fix); a null projection
  // always sorts last. Every player stays in the list regardless of projection or status (Adam: never
  // hide or filter a player who has any row on the board — this is a sort order, not a filter).
  const rows = [...(board?.rows ?? [])].sort((a, b) => (b.proj ?? -Infinity) - (a.proj ?? -Infinity));
  const placed = placedIdSet();
  const bodyRows = rows.map((r) => rightRowHtml(r, placed)).join("");
  return `
    <div class="lineup-rows-wrap scroll-panel">
      <table class="lineup-rows-table">
        <thead><tr><th>Player</th><th>FLEX $</th><th>CPT $</th><th>Proj</th><th>Own FLEX</th><th></th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

function formatSavedAt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function savedLineupSlotHtml(entry) {
  if (!entry) return "";
  const { slot, row, snap } = entry;
  const src = row ?? snap;
  if (!src) return `<div class="saved-lineup-slot saved-lineup-slot-empty"><span class="saved-lineup-slot-pos">${escapeHtml(slot)}</span><span class="saved-lineup-slot-empty-text">Empty</span></div>`;
  const missingCls = row ? "" : " saved-lineup-slot-missing";
  const noteHtml = row ? "" : `<span class="saved-lineup-slot-note">not on board</span>`;
  return `
    <div class="saved-lineup-slot${missingCls}">
      <span class="saved-lineup-slot-pos">${escapeHtml(slot)}</span>
      <span class="saved-lineup-slot-name">${escapeHtml(src.name ?? "")}</span>
      <span class="saved-lineup-slot-team">${escapeHtml(src.team ?? "")}</span>
      <span class="saved-lineup-slot-salary">${money(slot === "CPT" ? row?.cptSalary ?? snap?.salary : row?.salary ?? snap?.salary)}</span>
      ${noteHtml}
    </div>`;
}

function savedLineupCardHtml(lineup, board) {
  const entries = (lineup.slots ?? []).map((s) => ({ slot: s.slot, row: findRow(board, s.playerId), snap: s }));
  let salaryUsed = 0;
  let totalProj = 0;
  for (const e of entries) {
    const row = e.row;
    if (!row) {
      // The snapshot's own "salary" field is already the right one for its slot (CPT or FLEX) — routes.js
      // resolves that at save time (~line 559); there is no separate snap.cptSalary (🔵 review item 11).
      salaryUsed += e.snap.salary ?? 0;
      continue;
    }
    salaryUsed += (e.slot === "CPT" ? row.cptSalary : row.salary) ?? 0;
    totalProj += (e.slot === "CPT" ? row.cptProj : row.proj) ?? 0;
  }
  const overCap = salaryUsed > SALARY_CAP;
  const incomplete = entries.length < FLEX_COUNT + 1;
  const isRenaming = state.renamingId === lineup.id;
  const isConfirmingDelete = state.deleteConfirmId === lineup.id;
  const badges = [
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
  const rowsHtml = entries.map(savedLineupSlotHtml).join("");
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
        <span>&middot; ${dec1(totalProj)} proj</span>
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
  const overCap = totals.salaryUsed > SALARY_CAP;
  const fillPct = Math.max(0, Math.min(100, (totals.salaryUsed / SALARY_CAP) * 100));
  const salaryText =
    totals.salaryLeft < 0 ? `${money(totals.salaryUsed)} used · ${money(-totals.salaryLeft)} over` : `${money(totals.salaryUsed)} used · ${money(totals.salaryLeft)} left`;
  return `
    <div class="lineup-layout">
      <div class="lineup-left">
        ${controlsHtml()}
        <div class="lineup-slots">${slotsHtml(board)}</div>
        <div class="salary-bar">
          <div class="salary-bar-track"><div class="salary-bar-fill${overCap ? " over" : ""}" style="width:${fillPct}%"></div></div>
          <span class="salary-bar-label${overCap ? " over" : ""}">${escapeHtml(salaryText)}</span>
        </div>
        <div class="lineup-totals">Total projection ${dec1(totals.totalProj)} &middot; ${totals.filled} of 6 slots filled</div>
        ${buildStatusHtml(board)}
      </div>
      <div class="lineup-right">
        <h3 class="lineup-right-title">Showdown players (sorted by Proj)</h3>
        ${rightColumnHtml(board)}
      </div>
    </div>
    ${savedLineupsSectionHtml(board)}`;
}

function wire(container, board, key) {
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
}

let lastValidatedKey = null;

export function renderShowdownLineupPanel(container, board, key) {
  lastContainer = container;
  lastBoard = board;
  lastKey = key;
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
  container.innerHTML = panelHtml(board);
  wire(container, board, key);
}
