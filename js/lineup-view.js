// The Optimizer tab's markup (split out of lineup.js, Adam 2026-10-18, moved not edited): the builder panel and its nine slots,
// the saved-lineup cards, the pool beside them, the new-lineup cards and the Optimizer band, results and footer. These functions
// read `state` and `opt` (owned by lineup.js) and draw HTML; they hold no state of their own beyond the two module variables
// below (poolCallbacks, lastExposure), which only this file assigns. Wiring and actions stay in lineup.js and lineup-optimizer.js.
import { buildingHtml, goLabelHtml, buildingRowClass } from "./lineup-stop.js";
import { escapeHtml } from "./format.js";
import { lineupTotals, lineupTotalsHtml } from "./lineup-totals.js"; // A11: the one totals block
import { columnsButtonHtml } from "./columns.js"; // A17
import { store, activeSlateRows, activeSlateGames, isTwoGunMode } from "./state.js";
import { matchupText } from "./table.js"; // D43: the one copy of "vs DAL" / "@ DET"
import { shownTotal, perSpotText } from "./totals.js";
import { buildTypeText } from "./lineup-builds.js";
import { lineupFigures, medianText, sortKeysFor, sortLineups, effectiveSort, sortRowHtml } from "./lineup-sort.js"; // Adam 2026-10-17: sort options
import { contrarianRead, contrarianHtml, contrarianMan, readBasisFor, ownFor } from "./lineup-contrarian.js"; // Adam 2026-11-04: the GPP Stack / Rest / Own vs field read, on every GPP card
import { filterLineups, bulkLabel, filterBarHtml } from "./lineup-filter.js";
import { OPT_POSITIONS, optExposureHtml, zeroMinRows, classicEntries } from "./lineup-exposure.js"; // A10: the one exposure table
import { cardPlayerRowHtml, cardDecor, teamColours } from "./lineup-card.js";
import { lineupRoles, roleTagsHtml } from "./lineup-marks.js";
import { statusLineHtml, statusToneClass, rowMessageHtml, TONE_WARN, TONE_NOTICE } from "./row-message.js";
import { paletteForRows } from "./team-palette.js";
import { settingRowHtml, settingGroupHtml, settingChipsRowHtml, settingSubtitleHtml, activeRulesSummary, switchButtonHtml, switchCheckboxHtml, numberBoxHtml, ruleOn, countNote } from "./lineup-settings.js";
import { listedQbs, qbStacksPayload, qbListHtml, qbPanelsHtml, defaultsApply, SPREAD_HINT } from "./lineup-qb-stacks.js";
import { slateLineups } from "./entries.js";
import { TAG_OPTIONS, numberLineups, lineupPrefix, byAge } from "./lineup-tags.js";
import {
  cashChipHtml, cashHeadLine, modeSwitchHtml, boardHasMedians,
  cashMedianText, unusedCapText, modeBadgeHtml, builtInTextCash, scoreOfRow,
} from "./lineup-cash.js";
import { rightColumnHtml, poolMessageShown } from "./lineup-pool.js"; // the pool: the Optimizer's one player table (C9, C10, C17)
import { doneNoteHtml } from "./build-notice.js"; // A15: `Build finished.` and its link to the results
import { confirmHtml, anchorHtml, CLEAR_QUESTION, DELETE_QUESTION, REPLACE_QUESTION } from "./confirm-inline.js"; // B13, C11, A12: the confirms beside their buttons
import { dkSelectHtml, dkDownloadHtml } from "./dk-lineup-ui.js"; // A12: Download DK CSV for the saved lineups ticked
import {
  state, opt, LINEUP_SLOTS, SALARY_CAP, MAX_TEAM_OPTIONS, OPT_MAX_COUNT, OPT_MAX_UNIQUE, OPT_DEFAULT_UNIQUE, OPT_STACK_OWN_MAX, OPT_STACK_OPP_MAX,
  OPT_RULES, RULE_GROUPS, dkIdentity, lineupBusy, computeTotals, placeBySlotName, effectiveObjective, boardRowMap, qbGlobals, listedQbIds,
} from "./lineup.js";
import {
  identityOf, slateKeyOf, playerMaxFor, playerMinFor, parsePct, parseWhole, requestCount, savedForSlate, savedSetKeys, lineupSetKey, exposureOfLineups,
  lockedIds, buildGenerateSettings, minRowOut, upperOf, cashBasisInfo, wantRowsFor, cashSummaryText, cashStrip, currentRowById,
} from "./lineup-optimizer.js";

// --------------------------------------------------------------------------------------------------------
// Render
// --------------------------------------------------------------------------------------------------------

export function panelHtml() {
  const board = store.get().board;
  // rowById is an id lookup over the WHOLE board on purpose: the nine slots and the saved-lineup cards must
  // still find a player who is not in the second slate on screen (D57). The pool on the right is the list, and
  // it goes through activeSlateRows() like every other classic list.
  const rows = board?.rows ?? [];
  const rowById = new Map(rows.map((r) => [String(r.id), r]));
  paletteForRows(rowById, activeSlateRows(board)); // Team rows fix, 2026-10-17: the cards' palette is the active slate's teams, fixed here once per render
  const totals = computeTotals(rowById);
  const roles = lineupRoles(state.slots.map((s) => rowById.get(String(s?.id))));
  const perSpot = perSpotText(totals.salaryLeft, LINEUP_SLOTS.length - totals.filled); // Adam 2026-10-18: salary per remaining spot; null when full or over
  // A11: Salary used, Salary left, Proj and Own from the first man; a man with no figure (or off the slate) makes that figure a dash with its reason (lineup-totals.js).
  const men = state.slots.filter(Boolean).map((s) => { const r = rowById.get(String(s.id)); return r ? { salary: r.salary, proj: r.proj, own: r.own } : {}; });
  // Adam 2026-11-04: the GPP working lineup also reads Stack, Rest and Own vs field (a quiet dash with the reason until nine men are in); cash has none.
  const basis = readBasisFor(board);
  const readLine = opt.mode === "cash" ? "" : contrarianHtml(contrarianRead(state.slots.filter(Boolean).map((s) => { const r = rowById.get(String(s.id)); return contrarianMan(r, "a man not on this slate", ownFor(r, basis)); }), basis));
  const totalsBlock = lineupTotalsHtml(lineupTotals(men, { cap: SALARY_CAP, notLoaded: board ? null : "the board has not loaded" }), { cap: SALARY_CAP, extra: perSpot ? escapeHtml(perSpot) : "", line: readLine });

  // The Optimizer band is the first thing in this part of the tab (DECISIONS.md D70, Adam 2026-10-10: "move the optimizer stuff up"); the
  // lineup it builds from sits right under it, its results and the saved lineups below. The injury note and the unreadable-overrides
  // note are not drawn here: the ownership banner just above this part (#own-banner, app.js) carries both (Optimizer-first step 4).
  const poolHtml = rightColumnHtml(activeSlateRows(board), rowById); // drawn first: it says whether the click's message sits in a pool row (A14)
  return `
    ${optimizerControlsHtml(rowById)}
    <div class="lineup-layout">
      <div class="lineup-left">
        ${controlsHtml()}
        <div class="lineup-slots">${slotsHtml(rowById, roles)}</div>
        ${totalsBlock}
        ${buildStatusHtml(poolMessageShown())}
      </div>
      <div class="lineup-right">
        <div class="lineup-right-head"><h3 class="lineup-right-title">Player pool</h3>${columnsButtonHtml()}</div>
        ${poolHtml}
      </div>
    </div>
    ${optimizerResultsHtml(rowById)}`;
}

/** The Save controls (PROJECT.md Part 4 Lineups; optimizer standard A13, round 3): the working lineup's button is `Save working lineup`, on a loaded
 *  lineup too (it updates that one), with Copy beside it; the result cards keep their own Save and Discard. */
export function saveControlsHtml({ loaded, hasAnySlot, saving, saveName }) {
  const off = !hasAnySlot || saving ? " disabled" : "";
  const btn = (id, label, title = "") =>
    `<button type="button" id="${id}" class="lineup-build-btn"${title ? ` title="${title}"` : ""}${off}>${saving && id === "lineup-save-btn" ? "Saving…" : label}</button>`;
  return `
      <label class="lineup-control">${loaded ? "Name" : "Save as"}
        <input type="text" id="lineup-save-name" class="lineup-save-name-input" placeholder="Name (optional)" value="${escapeHtml(saveName)}" />
      </label>
      ${loaded ? `${btn("lineup-save-btn", "Save working lineup", "Save your changes to the loaded lineup")}${btn("lineup-save-new-btn", "Copy", "Save as a new lineup and keep this one")}` : btn("lineup-save-btn", "Save working lineup")}`;
}

/** B13 (round 3), B6 (round 4): Clear lineup asks `Clear the lineup?` beside itself before it empties the slots and their locks (the excludes stay); `confirm` is the open confirm's key. */
export { CLEAR_QUESTION }; // confirm-inline.js has the words, one copy for both Optimizers

function controlsHtml() {
  const hasAnySlot = state.slots.some(Boolean);
  const loaded = state.loadedId != null && state.savedLineups.some((l) => l.id === state.loadedId);
  return `
    <div class="lineup-controls">
      ${anchorHtml(`<button type="button" id="lineup-clear-all-btn" class="lineup-clear-all-btn">Clear lineup</button>`, state.confirm === "clear" ? confirmHtml(CLEAR_QUESTION, { data: "clear" }) : "", { align: "swap" })}${saveControlsHtml({ loaded, hasAnySlot, saving: state.saving, saveName: state.saveName })}
    </div>`;
}

const SLOT_REMOVE_TITLE = "Click to remove";

function slotsHtml(rowById, roles) {
  return LINEUP_SLOTS.map((slotName, i) => {
    const s = state.slots[i];
    const row = s ? rowById.get(String(s.id)) : null;
    // 🔵 finding 2: a slot whose id no longer has a row (should already have been dropped by
    // validateAgainstBoard, but this is the defensive last line) shows a visible marker instead of
    // guessing at stale name/salary/proj/own.
    // Optimizer-first step 5: a filled slot is the card row (the one the lineup cards draw), bigger; it carries the slot name, so the label column goes.
    // An Empty or missing slot keeps the label, and every classic slot is padded to the same 64px (style.css .lineup-slot-big) so the column does not jump.
    const bodyHtml = !s
      ? `<span class="lineup-slot-player lineup-slot-empty">Empty</span>`
      : row
        ? slotPlayerHtml(row, roles.get(String(row.id)), slotName, paletteForRows(rowById))
        : `<span class="lineup-slot-player lineup-slot-missing">Not on this slate</span>`;
    // D81 counterpart of 336c1f5 (Adam 5:00 PM 2026-10-29): no Clear button; a click (or Enter / Space) on a placed slot takes his man out
    // (lineup.js wires data-action="slot-remove"; his name keeps opening his card). No button role: the card holds that name.
    const removable = s ? ` data-action="slot-remove" data-slot="${i}" tabindex="0" title="${SLOT_REMOVE_TITLE}" aria-label="${SLOT_REMOVE_TITLE}"` : "";
    return `
      <div class="lineup-slot lineup-slot-big${row ? " lineup-slot-card" : ""}${s ? " lineup-slot-removable" : ""}" data-slot-index="${i}"${removable}>
        ${row ? "" : `<span class="lineup-slot-label">${escapeHtml(slotName)}</span>`}
        ${bodyHtml}
      </div>`;
  }).join("");
}

// `row` is the live board row for this slot's id (🔵 finding 2), never a cached copy: an override on
// Proj or Own shows up here automatically because this reads the same fields the Rankings table does.
// Optimizer-first step 5 (Adam 2026-10-18): the shared card row at the big size (lineup-card.js cardPlayerRowHtml, 48px team logo, the initials badge only for a team with no logo),
// wearing the slate palette's colours like the cards; `slotName` is its label, `palette` the slate's (paletteForRows).
export function slotPlayerHtml(row, tags = [], slotName = "", palette = null) {
  const decor = { rowFor: (p) => p, rolesFor: () => "", nameTagsFor: () => roleTagsHtml(tags), coloursFor: (team) => teamColours(palette, team) }; // the role tags go on the name line (lineup-card.js nameTags)
  return cardPlayerRowHtml(row, slotName, decor, { big: true });
}

// Standard A14: what a click on a pool row says (addError) is drawn beside that row; it comes back to this place under the slots only
// when no row of the pool on screen carries it (`addInRow`). Save's messages have no clicked row, so they stay here; red only for a failure.
function buildStatusHtml(addInRow = false) {
  const parts = [];
  if (state.memoryNote) parts.push(statusLineHtml(state.memoryNote, TONE_NOTICE)); // A9: a remembered lineup that lost men says who (neutral: nothing the app did wrong)
  if (state.addError && !addInRow) parts.push(statusLineHtml(state.addError, state.addTone ?? TONE_WARN));
  if (state.saveError) parts.push(statusLineHtml(state.saveError, state.saveTone));
  else if (state.saveConfirm) parts.push(statusLineHtml(state.saveConfirm, TONE_NOTICE));
  return parts.join("");
}

// --------------------------------------------------------------------------------------------------------
// Saved lineups rendering
// --------------------------------------------------------------------------------------------------------

function formatSavedAt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`;
}

/** Re-derives a saved lineup's nine roster slots and live totals against `rowById` (the CURRENT board),
 *  so a card's salary/proj/own move after a Refresh instead of freezing at save time. A saved player no
 *  longer on the slate is reported (`row: null`, `snap` carries his saved-time fields) but contributes
 *  nothing to the live totals — there is no live number to add. */
function computeLiveTotals(lineup, rowById) {
  const placed = placeBySlotName((lineup.slots ?? []).map((s) => ({ slot: s.slot, id: s.playerId })));
  let filled = 0;
  let salaryUsed = 0;
  const projs = [];
  let totalOwn = 0;
  let ownPublished = 0;
  const slotEntries = placed.map((entry) => {
    if (!entry) return null;
    filled++;
    const snap = (lineup.slots ?? []).find((s) => String(s.playerId) === entry.id) ?? null;
    const row = rowById.get(entry.id) ?? null;
    if (row) {
      salaryUsed += row.salary ?? 0;
      projs.push(row.proj);
      if (row.own != null) {
        totalOwn += row.own;
        ownPublished++;
      }
    } else if (snap) {
      // 🔵 finding: a player no longer on the slate still costs what he cost at save time, so a $50,000
      // lineup doesn't show as under cap and lose its "over cap" badge just because he rolled off the
      // board. His projection and ownership stay out of the totals — there's no live number for those.
      salaryUsed += snap.salary ?? 0;
    }
    return { row, snap };
  });
  return { slotEntries, filled, salaryUsed, totalProj: shownTotal(projs) ?? 0, totalOwn, ownPublished }; // ChatGPT wish d: the shown sum (totals.js)
}

/** `palette`: the slate's team colours (paletteForRows on the active slate's rows), so a Saved row wears the same colours as the
 *  new-lineup card's. The name opens the player card (Adam 2026-10-18). */
export function savedLineupSlotHtml(slotName, entry, palette = null) {
  if (!entry) {
    return `<div class="opt-p opt-p-empty"><span class="opt-p-slot">${escapeHtml(slotName)}</span><span class="opt-p-empty-text">Empty</span></div>`;
  }
  const src = entry.row ?? entry.snap;
  if (!src) return "";
  // A5: the saved row is the same card row as a slot and a new card (lineup-card.js); a man no longer on the slate keeps his saved figures and says so.
  const p = { id: entry.row?.id ?? entry.snap?.playerId, name: src.name ?? "", pos: src.pos, team: src.team, salary: src.salary, proj: src.proj ?? null, own: src.own ?? null };
  const decor = {
    rowFor: (x) => (entry.row ? { ...x, ...entry.row } : x),
    rolesFor: () => (entry.row ? "" : `<span class="opt-p-note">not on slate</span>`),
    coloursFor: (team) => teamColours(palette, team),
  };
  return cardPlayerRowHtml(p, slotName, decor, { cls: entry.row ? "" : "opt-p-missing" }).trim();
}

export function savedLineupCardHtml(lineup, rowById, numbers = null) {
  const totals = computeLiveTotals(lineup, rowById);
  const isCash = lineup.mode === "cash";
  const prefix = lineupPrefix(lineup, numbers);
  const busy = lineupBusy.has(lineup.id) ? " disabled" : ""; // a card PUT is in flight (putLineupGuarded)
  const tagOptions = `<option value=""${lineup.tag ? "" : " selected"}>no letter</option>${TAG_OPTIONS.map((t) => `<option value="${t}"${t === lineup.tag ? " selected" : ""}>${t}</option>`).join("")}`;
  const tagHtml = `<select class="saved-lineup-tag" data-action="lineup-tag" data-id="${escapeHtml(lineup.id)}" aria-label="Letter for ${escapeHtml(lineup.name)}"${busy}>${tagOptions}</select>`; // Adam 2026-10-17: a lineup's mode is fixed at save, no crossover, so the card has no mode button
  const overCap = totals.salaryUsed > SALARY_CAP;
  const incomplete = totals.filled < LINEUP_SLOTS.length;
  const isRenaming = state.renamingId === lineup.id;
  const isConfirmingDelete = state.deleteConfirmId === lineup.id;

  const badges = [
    state.loadedId === lineup.id ? `<span class="saved-lineup-badge saved-lineup-badge-loaded">Loaded</span>` : "",
    modeBadgeHtml(lineup), // A12 (round 3): every card says Cash or GPP
    state.lineupErrors[lineup.id] ? `<span class="saved-lineup-badge saved-lineup-badge-danger">${escapeHtml(state.lineupErrors[lineup.id])}</span>` : "",
    incomplete ? `<span class="saved-lineup-badge saved-lineup-badge-warning">Incomplete</span>` : "",
    overCap ? `<span class="saved-lineup-badge saved-lineup-badge-danger">Over cap</span>` : "",
  ].join("");

  // ChatGPT wish g, Adam 2026-10-17: the board mode and build type the lineup was made with.
  const buildText = buildTypeText(lineup.build);
  const buildBadge = buildText ? `<span class="saved-lineup-badge saved-lineup-badge-build" title="How this lineup was made">${escapeHtml(buildText)}</span>` : "";
  // Adam 2026-10-18: the median total beside proj, the figure the Median sort uses; only on a TwoGun board with medians.
  const medianPart = boardMediansForSort() ? medianText(savedLineupFigures(lineup, rowById).median, (lineup.slots ?? []).some((s) => scoreOfRow(rowById.get(String(s.playerId)), "median") != null), "a player has no TwoGun median or is no longer on the slate") : "";

  const nameHtml = isRenaming
    ? `<span class="saved-lineup-rename">
        <input type="text" class="saved-lineup-rename-input" data-rename-input value="${escapeHtml(lineup.name)}" />
        <button type="button" class="saved-lineup-mini-btn" data-action="lineup-rename-save" data-id="${escapeHtml(lineup.id)}"${busy}>Save</button>
        <button type="button" class="saved-lineup-mini-btn" data-action="lineup-rename-cancel">Cancel</button>
      </span>`
    : `<button type="button" class="saved-lineup-name-btn" data-action="lineup-rename-start" data-id="${escapeHtml(lineup.id)}" title="Click to rename">${escapeHtml(lineup.name)}</button>`;

  const palette = paletteForRows(rowById); // Team rows round 2, Adam 2026-10-17: the Saved rows wear the new-lineup rows' colours
  const rowsHtml = totals.slotEntries.map((entry, i) => savedLineupSlotHtml(LINEUP_SLOTS[i], entry, palette)).join("");

  // A11: the same four figures as the builder (lineup-totals.js); the app never estimates ownership (D29), so a man with none makes Own a dash. A man no longer on the slate costs his saved salary only.
  const men = totals.slotEntries.filter(Boolean).map((e) => (e.row ? { salary: e.row.salary, proj: e.row.proj, own: e.row.own } : { salary: e.snap?.salary }));
  const readLine = isCash ? "" : contrarianHtml(savedRead(lineup, rowById)); // demo 2026-11-04: GPP only
  const totalsBlock = lineupTotalsHtml(lineupTotals(men, { cap: SALARY_CAP }), { cap: SALARY_CAP, extra: medianPart, line: readLine });

  // A12/B13 (round 3): the delete asks `Delete this saved lineup?`; a Load over an unsaved working lineup asks `Replace your working lineup?` (C11).
  const deleteHtml = isConfirmingDelete
    ? `<span class="saved-lineup-confirm">${DELETE_QUESTION}
        <button type="button" class="saved-lineup-mini-btn danger" data-action="lineup-delete-yes" data-id="${escapeHtml(lineup.id)}">Yes</button>
        <button type="button" class="saved-lineup-mini-btn" data-action="lineup-delete-no">No</button>
      </span>`
    : `<button type="button" class="saved-lineup-btn danger" data-action="lineup-delete-start" data-id="${escapeHtml(lineup.id)}">Delete</button>`;
  const loadConfirm = state.confirm === `load:${lineup.id}` ? confirmHtml(REPLACE_QUESTION, { data: `load:${lineup.id}` }) : "";

  return `
    <div class="saved-lineup-card" data-lineup-id="${escapeHtml(lineup.id)}">
      <div class="saved-lineup-card-head">
        ${dkSelectHtml(lineup.id, state.dkSelected.has(lineup.id))}${prefix ? `<span class="saved-lineup-prefix">${escapeHtml(prefix)} &middot;</span>` : ""}${nameHtml}
        ${tagHtml}
        <span class="saved-lineup-time">${escapeHtml(formatSavedAt(lineup.savedAt))}</span>
        ${buildBadge}${badges}
      </div>
      <div class="saved-lineup-slots">${rowsHtml}</div>
      ${totalsBlock}
      <div class="saved-lineup-actions">
        ${anchorHtml(`<button type="button" class="saved-lineup-btn" data-action="lineup-load" data-id="${escapeHtml(lineup.id)}">Load</button>`, loadConfirm, { align: "left" })}
        ${deleteHtml}${state.deleteErrors[lineup.id] ? rowMessageHtml(state.deleteErrors[lineup.id], "error") : ""}
      </div>
    </div>`;
}

export { DELETE_QUESTION, REPLACE_QUESTION };

/** The Saved tab's cards in "As built" order as ONE flat grid, no build sections or headers (Adam 2026-10-18: "i dont need them
 *  sectioned off", "consistent 4 across"): lineup number order, oldest saved first, 1, 2, 3 ... (round 5: the same order in both Optimizers; byAge is the one that numbers them).
 *  `cardHtml(lineup)` draws one card. */
export function savedGroupsHtml(lineups, cardHtml) {
  return `<div class="saved-lineups-list">${byAge(lineups).map(cardHtml).join("")}</div>`;
}

/** The Saved lineups tab (D74): this slate's saved cards (Load, rename, Delete as before; on the site the D69
 *  device- ids work the same way). Order: the exposure tables over the shown saved lineups, then this slate's saved cards
 *  (Adam 2026-10-17: exposure above the cards). */
function savedLineupsSectionHtml(rowById, savedHere) {
  let body;
  let exposureHtml = "";
  let shownCount = 0;
  lastExposure = { exposure: {}, subtitle: "" };
  if (!state.savedLoaded) {
    // A distinct class from saved-lineups-empty (below): a QA screenshot script waits for the real
    // empty/loaded state and must never mistake "still loading" for "confirmed empty".
    body = `<div class="saved-lineups-loading">Loading…</div>`;
  } else if (state.savedError) {
    // 🔵 finding: a failed GET (e.g. LINEUPS_UNREADABLE) must say so, not render as a false "no saved
    // lineups yet" — that would read as "you have none" when the real answer is "couldn't check".
    body = `<div class="saved-lineups-empty saved-lineups-error">${escapeHtml(state.savedError)}</div>`;
  } else if (savedHere.length === 0) {
    body = `<div class="saved-lineups-empty">No saved ${opt.mode === "cash" ? "cash " : ""}lineups for this slate yet.</div>`;
  } else {
    // Adam 2026-10-11: only the saved lineups holding every chosen player show, and the exposure counts those only.
    const pick = pickOptions(rowById);
    const n = savedHere.length;
    // Plan 7a: computed, never stored; over the same list the Entries screen numbers (slateLineups), so "3" is one lineup on both (🔵 2026-10-17).
    const numbers = numberLineups(slateLineups(state.savedLineups, slateKeyOf(store.get().board)));
    const shown = filterLineups(savedHere, opt.mustHave, (l) => savedLineupPlayers(l, rowById));
    const k = shown.length;
    shownCount = k;
    if (k === 0) {
      body = `<div class="saved-lineups-empty">${NO_MATCH_TEXT}</div>`;
    } else {
      // Adam 2026-10-17: a sort row above the cards; As built is one flat list in build order, any other key is one flat sorted list
      const items = shown.map((e) => e.item);
      const keys = sortKeysFor(opt.mode, boardMediansForSort());
      const sort = effectiveSort(opt.sort.saved, keys);
      const cardOf = (l) => savedLineupCardHtml(l, rowById, numbers);
      const cards = sort.key === "built"
        ? savedGroupsHtml(items, cardOf)
        : `<div class="saved-lineups-list">${sortLineups(items, sort.key, sort.dir, (l) => savedLineupFigures(l, rowById)).map(cardOf).join("")}</div>`;
      const ticked = items.filter((l) => state.dkSelected.has(l.id)).length; // A12: Download DK CSV acts on the ticked cards that are shown
      body = dkDownloadHtml({ count: ticked, total: k, status: state.dkStatus }) + (k >= 2 ? sortRowHtml("saved", keys, sort) : "") + cards;
      const subtitle = opt.mustHave.length ? `${k} of ${n} saved lineup${n === 1 ? "" : "s"}, filtered` : `${n} saved lineup${n === 1 ? "" : "s"}`;
      lastExposure = { exposure: exposureOfLineups(shown.map((e) => savedLineupPlayers(e.item, rowById))), subtitle };
      exposureHtml = optExposureHtml(classicEntries(lastExposure.exposure), opt.exp, "classic", pick, null, { subtitle: lastExposure.subtitle });
    }
  }
  // Adam 2026-10-17: the exposure tables above the cards, so they are high on the screen
  return `
    <div class="saved-lineups" id="saved-lineups">
      ${mustHaveBarHtml(shownCount, savedHere.length)}
      ${exposureHtml}
      ${body}
      ${state.savedLoaded && !state.savedError ? otherModeSavedHtml() : ""}
    </div>`;
}

/** Cash mode job 3b, 2026-10-17: the quiet line for this slate's saved lineups of the mode not on screen. */
function otherModeSavedHtml() {
  const other = opt.mode === "cash" ? "gpp" : "cash";
  const n = savedOfActiveSlate(other).length;
  const word = other === "cash" ? "Cash" : "GPP";
  return n ? `<div class="saved-lineups-other">${n} ${word} lineup${n === 1 ? "" : "s"} saved; switch to ${word} to see ${n === 1 ? "it" : "them"}</div>` : "";
}

const NO_MATCH_TEXT = "No lineups here have all of the chosen players.";

/** The saved lineups on screen (this slate's, minus those the "only lineups with" list hides): what Download DK CSV acts on. */
export function shownSavedLineups(rowById) {
  return filterLineups(savedOfActiveSlate(), opt.mustHave, (l) => savedLineupPlayers(l, rowById)).map((e) => e.item);
}

/** The click-to-filter hooks the card and exposure builders take: `isChosen(boardId)` says whether that player is in
 *  the "only lineups with" list (matched by DraftKings identity, as exposure counts him). */
export function pickOptions(rowById) {
  return { isChosen: (id) => opt.mustHave.includes(identityOf(id, rowById)) };
}

/** The "Only lineups with:" bar for the tab on screen, empty when nobody is chosen. */
function mustHaveBarHtml(shown, total) {
  const chips = opt.mustHave.map((key) => ({ key, name: opt.mustHaveNames[key] ?? key }));
  return filterBarHtml(chips, shown, total);
}

/** A saved lineup's players for the exposure tables: the live board row when there is one (matchup D43, own% D32),
 *  else the saved snapshot. */
export function savedLineupPlayers(lineup, rowById) {
  return (lineup.slots ?? []).map((s) => {
    const id = String(s.playerId);
    const row = rowById.get(id);
    return row
      ? { id, name: row.name, pos: row.pos, team: row.team, opp: matchupText(row), own: row.own ?? null, identity: dkIdentity(row) }
      : { id, name: s.name, pos: s.pos, team: s.team, opp: "", own: s.own ?? null, identity: id };
  });
}

/** A saved lineup's three readings (lineup-contrarian.js) off the live board rows; a man no longer on the board is named in the dash's hover. */
function savedRead(lineup, rowById, basis = readBasisFor(store.get().board)) {
  return contrarianRead((lineup.slots ?? []).map((s) => { const r = rowById.get(String(s.playerId)); return contrarianMan(r, s.name ?? "a man", ownFor(r, basis)); }), basis);
}

/** A saved lineup's sort figures, off the live board rows (Adam 2026-10-17): all null when it is not nine players or a
 *  player is no longer on the board, so it sorts last and shows an `Own vs field` dash rather than a figure from the players that remain. */
export function savedLineupFigures(lineup, rowById) {
  const rows = (lineup.slots ?? []).map((s) => rowById.get(String(s.playerId)));
  if (rows.length !== LINEUP_SLOTS.length || rows.some((r) => !r)) return lineupFigures([]);
  return lineupFigures(rows.map((r) => ({ proj: r.proj, own: r.own, median: scoreOfRow(r, "median") })), savedRead(lineup, rowById));
}

/** A new lineup's three readings: each man's Own from the batch (as his card shows it), his position, team and opponent from the live board row when there is one. */
function newRead(lineup, rowById, basis = readBasisFor(store.get().board)) {
  return contrarianRead((lineup.players ?? []).map((p) => {
    const row = rowById?.get(String(p.id));
    // A man with no row on the board is named as gone from it (the dash's reason); his position and team are the batch's, his opponent and, on actual, his figure are the row's.
    return contrarianMan(row ? { name: p.name, pos: p.pos, team: p.team, opp: row.opp } : null, p.name, basis.kind === "actual" ? ownFor(row, basis) : p.own);
  }), basis);
}

/** A new lineup's figures: a player's own `median` when the batch carries one (a cash median build), else the board row's. */
const newPlayerMedian = (p, rowById) => ("median" in p ? p.median : scoreOfRow(rowById?.get(String(p.id)), "median"));
function newLineupFigures(lineup, rowById) {
  return lineupFigures((lineup.players ?? []).map((p) => ({ proj: p.proj, own: p.own, median: newPlayerMedian(p, rowById) })), newRead(lineup, rowById));
}

/** Whether the board is in TwoGun mode and carries medians: the only case the Median sort is offered for a GPP list or a saved list. */
const boardMediansForSort = () => isTwoGunMode(store.get().board) && boardHasMedians(activeSlateRows(store.get().board));

// The pool (the Optimizer's one player table, C9 and C10 of the optimizer standard) is lineup-pool.js's; every name this file exported for it is still exported from here.
export { setPoolCallbacks, poolStarClick, poolPickerFor, poolPickerNow, rightColumnHtml, CLASSIC_POOL_PICK_SKIP, classicPickAction, poolColumnSetup, poolColumnKeys } from "./lineup-pool.js";

/** Salary, projection and ownership totals of a generated lineup; ownership is null unless every player has a number. */
export function lineupTotalsOf(lineup) {
  const players = lineup?.players ?? [];
  const salary = lineup?.salary ?? players.reduce((s, p) => s + (p.salary ?? 0), 0);
  // ChatGPT wish d, Adam 2026-10-17: the projection total is the sum of the rows as shown (totals.js), not the engine's raw sum.
  const proj = shownTotal(players.map((p) => p.proj)) ?? lineup?.proj ?? null;
  const allOwn = players.length > 0 && players.every((p) => p.own != null);
  return { salary, proj, own: allOwn ? players.reduce((s, p) => s + p.own, 0) : null };
}

/** `notes` (optional): {ruleKey: {text, warn}}, a line under that rule's row (ChatGPT wish k: the starred-QB count). */
export function ruleRowsHtml(rules, keys = OPT_RULES.map((r) => r.key), notes = {}) {
  return OPT_RULES.filter((r) => keys.includes(r.key))
    .map((r) => settingRowHtml(r.label, switchButtonHtml(ruleOn(rules, r.key), r.label, `data-action="opt-rule" data-key="${escapeHtml(r.key)}"`), notes?.[r.key]?.text ?? "", notes?.[r.key]?.warn ? "opt-warn" : ""))
    .join("");
}

/** How many quarterbacks "starred QBs only" leaves in the pool (ChatGPT wish k, Adam 2026-10-17): the slate's QBs that are
 *  starred and not otherwise kept out (excluded, out, no projection, avoided game), by the
 *  same test as the Min % checks (minRowOut). `pool` = {excludes (Set), avoid (Set)}. */
export function starredQbQualifiers(rows, pool) {
  return (rows ?? []).filter((r) => upperOf(r?.pos) === "QB" && !minRowOut(r, r.id, { ...pool, starredQbOnly: true })).length;
}

/** Adam 2026-10-18 1:50 AM: the ids of the QBs a build can pick, for "do the Default stack rows still apply". A locked QB is
 *  the only usable one; otherwise every slate QB the same minRowOut test leaves in the pool, with "starred QBs only" as the rule is set.
 *  Per-lineup bends are ignored here: a bent lineup names its bend on its card (D73), so the grey state need not track them (🔵 2026-10-18). */
export function usableQbIds(rows, pool, starredOnly, lockedIdList) {
  const locked = new Set((lockedIdList ?? []).map(String));
  const qbs = (rows ?? []).filter((r) => upperOf(r?.pos) === "QB");
  const lockedQbs = qbs.filter((r) => locked.has(String(r.id)));
  if (lockedQbs.length) return lockedQbs.map((r) => String(r.id));
  return qbs.filter((r) => !minRowOut(r, r.id, { ...pool, starredQbOnly: Boolean(starredOnly) })).map((r) => String(r.id));
}

/** The line under the "starred QBs only" rule: "3 starred QBs qualify". At 0 it warns (nothing can be built) unless a QB is
 *  locked, which the build uses instead. */
export function starredQbNote(count, lockedQb) {
  const words = `${count} starred QB${count === 1 ? "" : "s"} ${count === 1 ? "qualifies" : "qualify"}`;
  if (count > 0) return { text: words, warn: false };
  return lockedQb ? { text: `${words}; the locked QB is used`, warn: false } : { text: `${words}: star one or lock one`, warn: true };
}

export function avoidChipsHtml(games, avoid) {
  return (games ?? [])
    .map((g) => {
      const id = String(g.id ?? g);
      const on = avoid?.has(id);
      return `<button type="button" class="chip opt-chip opt-avoid-chip${on ? " active" : ""}" data-action="opt-avoid" data-game="${escapeHtml(id)}" aria-pressed="${on ? "true" : "false"}">${escapeHtml(id.replace("@", " @ "))}</button>`;
    })
    .join("");
}

/** One "new lineup" card: the nine players in DK slot order (name, matchup D43, salary, projection, own% D32),
 *  the totals, and Save / Discard. `busy` disables both while a save is in flight. `saved`: the card is saved, or
 *  its nine players equal a saved lineup's, so Save shows a disabled "Saved ✓" (Adam 2026-10-11). Each name opens the
 *  player card (Adam 2026-10-18). */
export function optLineupCardHtml(lineup, index, busy, { saved = false, rowById = null, cash = null } = {}) {
  const decor = cardDecor(lineup, rowById, paletteForRows(rowById)); // Team rows, Adam 2026-10-17: one palette per render (cached on rowById)
  // Cash mode job 3b, 2026-10-17: `cash` = {basis, strip: {html, wantIn}} on a card built in cash: "Cash N", the cash totals, the unused-cap chip, a WANT tag on the Wants that made it and the pool strip.
  if (cash) {
    // 👁 fix round, 2026-10-17: stacking is no cash goal (PROJECT.md Part 4, Cash mode), so a cash card draws no QB-stack chip and no STACK / RUNBACK / MINI / PAIR tags; WANT and the OUT tags stay.
    decor.stack = "";
    decor.nameTagsFor = (p) => (cash.strip.wantIn.has(String(p.id)) ? `<span class="role-tag role-want" title="On your Want list">WANT</span>` : ""); // on the name line too, so the matchup pill keeps its spread
  }
  const rows = (lineup.players ?? []).map((p, i) => cardPlayerRowHtml(p, LINEUP_SLOTS[i] ?? p.pos ?? "", decor)).join("");
  const readLine = cash ? "" : contrarianHtml(newRead(lineup, rowById)); // demo 2026-11-04: the three readings on the GPP card only
  // Adam 2026-10-18: the median total beside proj, off the sort's own figure; only on a TwoGun board with medians or a batch carrying them.
  const plist = lineup.players ?? [];
  const medianPart = !cash && (boardMediansForSort() || plist.some((p) => "median" in p)) ? medianText(newLineupFigures(lineup, rowById).median, plist.some((p) => newPlayerMedian(p, rowById) != null)) : "";
  // A11, A19: the card's totals under its last slot are the builder's four figures (lineup-totals.js); the median and unused-cap figures follow on a line of their own, then a GPP card's own-vs-field readings.
  // One salary on a card: the block's Salary used (the sum of the shown rows) is also what the unused-cap chip reads, never the lineup's own `salary` field.
  const figures = lineupTotals(plist.map((p) => ({ salary: p.salary, proj: p.proj, own: p.own })), { cap: SALARY_CAP });
  const unusedText = cash ? unusedCapText(figures.used) : "";
  const unused = unusedText ? `<span class="cash-unused-chip" title="Salary left under the $50,000 cap">${escapeHtml(unusedText)}</span>` : "";
  const extra = cash ? [cashMedianText(lineup, cash.basis), unused].filter(Boolean).join(" &middot; ") : medianPart;
  const totalsBlock = lineupTotalsHtml(figures, { cap: SALARY_CAP, extra, line: readLine });
  const uid = escapeHtml(lineup.uid ?? "");
  const saveBtn = saved
    ? `<button type="button" class="saved-lineup-btn opt-saved-btn" disabled>Saved ✓</button>`
    : `<button type="button" class="saved-lineup-btn" data-action="opt-save" data-uid="${uid}"${busy ? " disabled" : ""}>Save</button>`;
  return `
    <div class="opt-card${saved ? " opt-card-saved" : ""}" data-uid="${uid}">
      <div class="opt-card-head">
        <span class="opt-card-title">${cash ? "Cash" : "Lineup"} ${index + 1}</span>${decor.stack}
        <span class="opt-card-actions">
          ${saveBtn}
          <button type="button" class="saved-lineup-btn danger" data-action="opt-discard" data-uid="${uid}"${busy ? " disabled" : ""}>Discard</button>
        </span>
      </div>
      <div class="opt-card-players">${rows}</div>
      ${totalsBlock}${cash ? cash.strip.html : ""}
    </div>`;
}

export function optNotesHtml(notes) {
  return (notes ?? []).map((n) => `<div class="opt-note">${escapeHtml(n)}</div>`).join("");
}

/** The quiet line under a batch for the response's `bends` ([{lineup (1-based), label}]), lineups sharing a label
 *  grouped ("lineups 2, 3 and 7–9: <label>", a run of three or more as a range); "" when none or missing. */
export function bendsLineHtml(bends, made) {
  const list = (Array.isArray(bends) ? bends : []).filter((b) => b && Number.isFinite(b.lineup) && b.label);
  if (!list.length) return "";
  const n = new Set(list.map((b) => b.lineup)).size;
  const groups = new Map();
  for (const b of list) groups.set(b.label, [...(groups.get(b.label) ?? []), b.lineup]);
  const body = [...groups].map(([label, nums]) => {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      if (j - i >= 2) parts.push(`${sorted[i]}–${sorted[j]}`);
      else for (let k = i; k <= j; k++) parts.push(String(sorted[k]));
      i = j + 1;
    }
    const who = sorted.length === 1 ? `lineup ${parts[0]}` : `lineups ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`}`;
    return `${who}: ${label}`;
  }).join("; ");
  return `<div class="opt-bends">${n} of ${made} lineup${made === 1 ? "" : "s"} ${n === 1 ? "bends" : "bend"} a setting: ${escapeHtml(body)}.</div>`;
}

// ---- Rendering inside the panel ----

export function lockedNames(rowById) {
  return lockedIds(state.slots, state.locks)
    .map((id) => rowById.get(id))
    .filter(Boolean);
}

/** D3 (round 3 fixes): the men a Build holds, said as they are: clicked into the lineup (held, no padlock) and padlocked. A padlock counts only as locked, a clicked-in
 *  man only as in the lineup, so the two counts add up to what the Build keeps. */
export function heldSplit(rowById) {
  const held = lockedNames(rowById);
  const isPadlocked = (r) => state.locks.has(String(r.id));
  return { inLineup: held.filter((r) => !isPadlocked(r)), padlocked: held.filter(isPadlocked) };
}

/** The pool the starred-QB count is taken over (ChatGPT wish k): excluded and avoided QBs fall out. */
function starredQbPool() {
  return { excludes: state.excludes, avoid: new Set([...opt.avoid].map((g) => String(g).toUpperCase())) };
}

export const STACK_INERT_TITLE = "Every QB in play has his own numbers, so these do not apply";
// 🔵 2026-10-18: only the entries the build sends count (listed QBs, as qbStacksPayload); an unstarred QB keeps his saved entry but is built under the defaults.
export const stackDefaultsApply = (board) => {
  const rows = activeSlateRows(board);
  const listed = listedQbIds(rows);
  const sent = Object.fromEntries(Object.entries(opt.qb.entries).filter(([id]) => listed.has(id)));
  return defaultsApply(usableQbIds(rows, starredQbPool(), ruleOn(opt.rules, "starredQbOnly"), lockedIds(state.slots, state.locks)), sent);
};

/** ChatGPT wish i, Adam 2026-10-17: the footer's one-line summary of the settings in effect, from the same `opt` the
 *  controls edit; count and unique as the request parses them, the objective as the build will use it. */
export function optSummaryText(board) {
  if (opt.mode === "cash") return cashSummaryText(board); // Cash mode job 3b
  const rows = activeSlateRows(board);
  const lockedQb = lockedNames(currentRowById()).some((r) => upperOf(r.pos) === "QB");
  const qualifiers = ruleOn(opt.rules, "starredQbOnly") ? starredQbQualifiers(rows, starredQbPool()) : null;
  const qbOwnCount = Object.keys(qbStacksPayload(opt.qb.entries, boardRowMap(board), listedQbIds(rows), null, lockedIds(state.slots, state.locks))).length;
  // 🔵 2026-10-17: the percents parsed by parsePct as buildGenerateSettings does (a blank or invalid box is null), and the
  // players with a Max % or Min % box counted from the request's own maps, for the players still in this slate's pool.
  const maxExp = Object.fromEntries(OPT_POSITIONS.map((pos) => { const p = parsePct(opt.maxExp[pos]); return [pos, Number.isNaN(p) ? null : p]; }));
  const slateKey = slateKeyOf(board);
  const poolIds = new Set(rows.map((r) => String(r.id)));
  const inPool = (map) => Object.fromEntries(Object.entries(map).filter(([id]) => poolIds.has(id)));
  const caps = buildGenerateSettings({ playerMax: inPool(playerMaxFor(slateKey)), playerMin: inPool(playerMinFor(slateKey)) });
  const playerCapCount = new Set([...Object.keys(caps.playerMaxExposure ?? {}), ...Object.keys(caps.playerMinExposure ?? {})]).size;
  const shown = { ...opt, maxExp, count: requestCount(opt.count), minUnique: parseWhole(opt.minUnique, 1, OPT_MAX_UNIQUE, OPT_DEFAULT_UNIQUE), objective: effectiveObjective(opt.objective) };
  return activeRulesSummary(shown, { games: activeSlateGames(board), starredQbCount: qualifiers === 0 && lockedQb ? null : qualifiers, qbOwnCount, playerCapCount });
}

/** What the filter bar's Starred QBs only chip shows (ChatGPT wish k, Adam 2026-10-17: with the rule on, a line counts the QBs that qualify):
 *  {hidden (cash builds have no such rule), on, note: {text, warn}}; the note is null while the rule is off. */
export function starredQbChipView(board) {
  const on = ruleOn(opt.rules, "starredQbOnly");
  const lockedQb = lockedNames(currentRowById()).some((r) => upperOf(r.pos) === "QB");
  return { hidden: opt.mode === "cash", on, note: on ? starredQbNote(starredQbQualifiers(activeSlateRows(board), starredQbPool()), lockedQb) : null };
}

function optimizerControlsHtml(rowById) {
  if (opt.mode === "cash") return cashControlsHtml(rowById); // Cash mode job 3b
  const board = store.get().board;
  const { inLineup, padlocked } = heldSplit(rowById);
  const games = activeSlateGames(board);
  const heldNames = (rs) => escapeHtml(rs.map((r) => r.name).join(", "));
  const heldParts = [inLineup.length ? `${inLineup.length} in the lineup: ${heldNames(inLineup)}` : "", padlocked.length ? `${padlocked.length} locked: ${heldNames(padlocked)}` : ""].filter(Boolean);
  const info = heldParts.length ? `<span class="opt-lockinfo">${heldParts.join(" &middot; ")}</span>` : ""; // Adam 2026-10-18 (Q8): no amber rules line when nothing is held
  // 🔵 2026-10-17 (👁 render): the five position caps are one row of five small boxes, not five rows.
  const expRows = `<div class="opt-cap-row">${OPT_POSITIONS.map((pos) =>
    `<label class="opt-cap"><span class="opt-cap-pos">${pos}</span>${numberBoxHtml(`type="text" inputmode="decimal" class="opt-input opt-input-pct" data-opt-exp="${pos}" value="${escapeHtml(opt.maxExp[pos])}" placeholder="no cap" aria-label="${pos} maximum exposure percent"`, "%")}</label>`
  ).join("")}</div>` + settingRowHtml("Spread defenses", switchButtonHtml(opt.spreadDst, "Spread defenses", `data-action="opt-spread-dst"`), SPREAD_HINT);
  const lockedList = lockedIds(state.slots, state.locks);
  const qbRows = listedQbs(activeSlateRows(board), lockedList);
  const avoidRow = games.length ? settingChipsRowHtml("Avoid game", avoidChipsHtml(games, opt.avoid)) : "";
  const formError = opt.formError ? statusLineHtml(opt.formError, TONE_WARN, "opt-form-error") : ""; // a refusal (a bad box, a blocked basis): amber, never red (standard A14)
  const options = (values, current, label = (v) => String(v)) =>
    values.map((v) => `<option value="${escapeHtml(String(v))}"${String(current) === String(v) ? " selected" : ""}>${escapeHtml(label(v))}</option>`).join("");
  const upTo = (max) => Array.from({ length: max + 1 }, (_, i) => i);
  const select = (id, label, values, current, text) => `<select id="${id}" class="opt-input opt-select-n" aria-label="${label}">${options(values, current, text)}</select>`;
  // ChatGPT wish i, Adam 2026-10-17: three groups, Pool (who may be used), Stacks, Build; the exposure caps are a sub-block of Build.
  const build = [
    settingRowHtml("Lineups to make", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_COUNT}" class="opt-input opt-input-num" id="opt-count" value="${escapeHtml(opt.count)}" aria-label="How many lineups"`, countNote(opt.count, OPT_MAX_COUNT), "opt-unit-note"), "Each keeps the men in your slots, locked or not"),
    settingRowHtml("Min unique players", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_UNIQUE}" class="opt-input opt-input-num" id="opt-min-unique" value="${escapeHtml(opt.minUnique)}" aria-label="Minimum unique players between lineups"`, `Maximum ${OPT_MAX_UNIQUE}`, "opt-unit-note"), "Between any two lineups"),
    settingSubtitleHtml("Max %"),
    expRows,
    ruleRowsHtml(opt.rules, RULE_GROUPS.build),
  ].join("");
  // Adam 2026-10-18 1:35 AM ("does this override them or what?"), then no explanatory sentence: the structure says it, group "Default stack", then the sub-heading "Per-QB overrides" over the QB list (D73).
  // Adam 2026-10-18 1:50 AM: when every QB in play has his own numbers the two rows are greyed (still editable), with a tooltip saying why.
  const defaultsLive = stackDefaultsApply(board);
  const stacking = [
    `<div class="opt-stack-rows${defaultsLive ? "" : " opt-row-inert"}"${defaultsLive ? "" : ` title="${STACK_INERT_TITLE}" aria-label="${STACK_INERT_TITLE}"`}>`,
    settingRowHtml("Teammates", `${select("opt-stack-own", "Teammates to stack with the quarterback", upTo(OPT_STACK_OWN_MAX), opt.stackOwn)}${switchCheckboxHtml("opt-stack-own-more", opt.stackOwnOrMore, "or more", "exactly")}`),
    settingRowHtml("Opponents", `${select("opt-stack-opp", "Opponents to stack with the quarterback", upTo(OPT_STACK_OPP_MAX), opt.stackOpp)}${switchCheckboxHtml("opt-stack-opp-more", opt.stackOppOrMore, "or more", "exactly")}`),
    `</div>`,
    settingSubtitleHtml("Per-QB overrides"),
    qbListHtml(qbRows, opt.qb, lockedList),
  ].join("");
  // 👁 2026-10-17: the open QBs' panels are full-width cards after the three groups (inside Stacks they grew to 822px).
  const qbPanels = qbPanelsHtml(qbRows, opt.qb, qbGlobals(), activeSlateRows(board), OPT_STACK_OWN_MAX, OPT_STACK_OPP_MAX, lockedList);
  // Starred QBs only is a chip in the filter bar since standard C12 (starredQbChipView below); the Pool group keeps Max per team and Avoid game.
  const pool = [
    settingRowHtml("Max per team", `<select id="opt-max-team" class="opt-input opt-select" aria-label="Max per team">${options(MAX_TEAM_OPTIONS, opt.maxPerTeam, (v) => (v === "" ? "No limit" : v))}</select>`, "Not applied to the QB's team or his opponent"),
    avoidRow,
  ].join("");
  return `
    <div class="opt-panel opt-settings" id="opt-panel">
      ${optHeadHtml(info)}
      ${formError}
      <div class="opt-groups">
        ${settingGroupHtml("Pool", pool)}
        ${settingGroupHtml("Default stack", stacking)}
        ${settingGroupHtml("Build", build)}
        ${qbPanels}
      </div>
      ${optimizerFooterHtml(board)}
    </div>`;
}

/** The Optimizer band's head: the title with the GPP | Cash switch beside it (a green $ chip on the title in cash), the
 *  Must / lock line and a refused Build's sentence (cash mode job 3b, 2026-10-17). */
function optHeadHtml(infoHtml) {
  return `<div class="opt-settings-head">
        <h3 class="opt-title">Settings${opt.mode === "cash" ? ` ${cashChipHtml()}` : ""}${modeSwitchHtml(opt.mode)}</h3>
        ${infoHtml}
        ${opt.error ? `<span class="${statusToneClass(opt.errorTone).trim()} opt-go-error">${escapeHtml(opt.error)}</span>` : ""}
      </div>`;
}

/** The Optimizer band in cash (cash mode job 3b): Pool (Max per team, Avoid game) and Build (Lineups to make, the fixed
 *  basis). No Stacks group, QB panels, caps row, Spread defenses, roster rules or minimum unique (Adam 2026-10-17): they are off in cash. */
function cashControlsHtml(rowById) {
  const board = store.get().board;
  const basis = cashBasisInfo(board);
  const games = activeSlateGames(board);
  const held = heldSplit(rowById);
  const info = `<span class="opt-lockinfo">${cashHeadLine(held.padlocked, wantRowsFor(slateKeyOf(board), rowById), held.inLineup)}</span>`;
  const formError = opt.formError ? statusLineHtml(opt.formError, TONE_WARN, "opt-form-error") : "";
  const teamOptions = MAX_TEAM_OPTIONS.map((v) => `<option value="${v}"${String(opt.cash.maxPerTeam) === v ? " selected" : ""}>${v === "" ? "No limit" : v}</option>`).join("");
  const pool = [
    settingRowHtml("Max per team", `<select id="opt-cash-max-team" class="opt-input opt-select" aria-label="Max per team">${teamOptions}</select>`, "Every team, the quarterback's included"),
    games.length ? settingChipsRowHtml("Avoid game", avoidChipsHtml(games, new Set(opt.cash.avoid))) : "",
  ].join("");
  const build = [
    settingRowHtml("Lineups to make", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_COUNT}" class="opt-input opt-input-num" id="opt-cash-count" value="${escapeHtml(opt.cash.count)}" aria-label="How many lineups"`, countNote(opt.cash.count, OPT_MAX_COUNT), "opt-unit-note"), "The best first, then the next best"),
    // A13 (round 3): no Build by line while Projection is the only way a build is made; it shows when the basis is TwoGun's median or the build is blocked (the reason).
    basis.blocked ? settingRowHtml("Build by", "", basis.text, "opt-warn") : basis.basis === "proj" ? "" : settingRowHtml("Build by", `<span class="cash-basis">${escapeHtml(basis.text)}</span>`),
  ].join("");
  return `
    <div class="opt-panel opt-settings" id="opt-panel">
      ${optHeadHtml(info)}
      ${formError}
      <div class="opt-groups opt-groups-cash">
        ${settingGroupHtml("Pool", pool)}
        ${settingGroupHtml("Build", build)}
      </div>
      ${optimizerFooterHtml(board)}
    </div>`;
}

/** The Build row: the summary sentence of the settings in effect, the building message with Stop, and the Build button. Since A15 (round 5) it is no sticky footer: it ends the settings panel
 *  (both variants draw it), in the page's flow. When a build ends, `Build finished.` and a link to the results sit beside the button (opt.doneNote), and build-notice.js says it under the filter
 *  bar when the button is off screen. */
function optimizerFooterHtml(board) {
  const showing = opt.generating && opt.buildingShown; // a build under a second shows nothing (lineup-stop.js); doGenerate itself refuses a second click
  const busy = showing || opt.saving || (opt.mode === "cash" && cashBasisInfo(board).blocked); // cash: Build is disabled whenever cashBasisInfo blocks (no Cash basis, or no medians on a TwoGun basis)
  // 🔵 d842f0b: a refusal from Build must show where Build was pressed, which can be far below the settings head.
  const footerError = opt.formError ? statusLineHtml(opt.formError, TONE_WARN, "opt-form-error-footer") : "";
  return `
    <div class="opt-footer${buildingRowClass({ showing, below: opt.buildingBelow })}">
      ${footerError}
      <span class="opt-summary">${escapeHtml(optSummaryText(board))}</span>
      ${buildingHtml({ showing, canStop: opt.canStop, stopId: "opt-stop-btn", stopping: opt.stopping, stopError: opt.stopError })}
      ${opt.doneNote && !opt.generating && opt.results ? doneNoteHtml("opt-show-results") : ""}
      <button type="button" id="opt-go-btn" class="lineup-build-btn opt-go opt-go-big"${busy ? " disabled" : ""}>${goLabelHtml({ showing, idle: "Build" })}</button>
    </div>`;
}

/** The saved lineups of the slate on screen (D57 slate key, savedForSlate), of the mode on screen unless `mode` says another
 *  (cash mode job 3b: null = both, for names that must stay unique across modes). */
export function savedOfActiveSlate(mode = opt.mode) {
  const board = store.get().board;
  const slateIds = new Set(activeSlateRows(board).map((r) => String(r.id)));
  return savedForSlate(state.savedLineups, slateKeyOf(board), slateIds, mode);
}

/** Which results tab shows (D74): Adam's pick this page load, else New when there is a batch (or one is being
 *  made), else Saved when this slate has saved lineups, else New. */
function activeResultsTab(savedHere) {
  if (opt.resultsTab === "new" || opt.resultsTab === "saved") return opt.resultsTab;
  if (opt.results || opt.generating || opt.error) return "new";
  return savedHere.length ? "saved" : "new";
}

/** Whether a new card counts as saved: its nine players equal a saved lineup's (`savedKeys` from savedSetKeys of
 *  this slate's saved lineups), so deleting that saved lineup turns the card back to Save. `lineup.saved` is set
 *  only when a save answer carried no saved list (saveGenerated). */
export function cardIsSaved(lineup, savedKeys, rowById) {
  return Boolean(lineup.saved) || savedKeys.has(lineupSetKey(lineup.ids ?? (lineup.players ?? []).map((p) => p.id), rowById));
}

export let lastExposure = { exposure: {}, subtitle: "" }; // the exposure on screen, for the sort header's redraw

/** D74: the results are two tabs. New lineups: this batch's cards (Save turns into "Saved ✓"; players new since the
 *  card before are highlighted) and the exposure of the batch only. Saved lineups: this slate's saved cards and the
 *  exposure of those only. */
function optimizerResultsHtml(rowById) {
  const savedHere = savedOfActiveSlate();
  const tab = activeResultsTab(savedHere);
  const r = opt.results;
  const nNew = r ? r.lineups.length : 0;
  const tabBtn = (key, label, n) =>
    `<button type="button" role="tab" class="opt-tab${tab === key ? " active" : ""}" data-action="opt-tab" data-tab="${key}" aria-selected="${tab === key}">${label}${n ? ` <span class="opt-tab-n">${n}</span>` : ""}</button>`;
  const tabs = `<div class="opt-tabs" role="tablist" aria-label="Lineups">${tabBtn("new", "New lineups", nNew)}${tabBtn("saved", "Saved lineups", savedHere.length)}</div>`;
  const body = tab === "saved" ? savedLineupsSectionHtml(rowById, savedHere) : newLineupsTabHtml(rowById, savedHere);
  return `<div class="opt-results" id="opt-results">${tabs}<div class="opt-tab-panel" role="tabpanel">${body}</div></div>`;
}

function newLineupsTabHtml(rowById, savedHere) {
  const parts = [];
  const r = opt.results;
  // Adam 2026-10-11: only the lineups holding every chosen player show (cards keep their own numbers); the
  // exposure counts those only. Nothing is deleted or changed by it.
  const pick = pickOptions(rowById);
  const shown = filterLineups(r?.lineups ?? [], opt.mustHave, (l) => (l.players ?? []).map((p) => ({ ...p, identity: identityOf(p.id, rowById) })));
  parts.push(mustHaveBarHtml(shown.length, r?.lineups.length ?? 0));
  if (opt.error) parts.push(statusLineHtml(opt.error, opt.errorTone));
  if (!r) {
    // While the build's message shows beside Stop (BUILDING_MESSAGE, standard D15) the placeholder is empty: the words show once.
    if (!(opt.generating && opt.buildingShown)) parts.push(`<div class="saved-lineups-empty">No new lineups. Press Build to make some.</div>`);
    lastExposure = { exposure: {}, subtitle: "" };
    return parts.join("");
  }
  const n = r.lineups.length;
  const busy = opt.saving || opt.generating;
  const isCash = r.mode === "cash"; // Cash mode job 3b: a batch keeps the mode it was built in; "Saved ✓" looks among the saved lineups of that mode
  const savedKeys = savedSetKeys(isCash === (opt.mode === "cash") ? savedHere : savedOfActiveSlate(isCash ? "cash" : "gpp"), rowById);
  const savedFlags = r.lineups.map((l) => cardIsSaved(l, savedKeys, rowById));
  const nSaved = savedFlags.filter(Boolean).length;
  // Save all / Discard all act only on the lineups shown while the filter is on (Adam 2026-10-11).
  const filtered = opt.mustHave.length > 0;
  const nShown = shown.length;
  const allSaved = n > 0 && (filtered ? shown.every((e) => savedFlags[e.index]) : nSaved === n);
  const noneShown = filtered && nShown === 0;
  // While filtered, "Save K shown" counts only the shown lineups not yet saved (the same test as the card's Saved mark).
  const nShownUnsaved = shown.filter((e) => !savedFlags[e.index]).length;
  parts.push(
    n
      ? `<div class="opt-results-head">
           <span class="opt-sub">${isCash ? escapeHtml(builtInTextCash(n, r.basis)) : `${n} lineup${n === 1 ? "" : "s"} from the last Build${r.builtIn ? ` (${escapeHtml(r.builtIn)})` : ""}`}${nSaved ? `, ${nSaved} saved` : ", not saved yet"}</span>
           <span class="opt-card-actions">
             <button type="button" class="saved-lineup-btn" data-action="opt-save-all"${busy || allSaved || noneShown ? " disabled" : ""}>${bulkLabel("Save", nShownUnsaved, filtered)}</button>
             <button type="button" class="saved-lineup-btn danger" data-action="opt-discard-all"${busy || noneShown ? " disabled" : ""}>${bulkLabel("Discard", nShown, filtered)}</button>
           </span>
         </div>`
      : `<div class="opt-sub">None left from the last Build.</div>`
  );
  if (opt.saveError) parts.push(statusLineHtml(opt.saveError, opt.saveTone));
  if (isCash && opt.cashUndo) parts.push(`<div class="cash-undo">Locked ${escapeHtml(opt.cashUndo.names.join(" and "))} and built again. <button type="button" class="lineup-row-btn" data-cash-undo${busy ? " disabled" : ""}>Undo</button></div>`);
  parts.push(optNotesHtml(r.notes));
  if (n && !shown.length) {
    parts.push(`<div class="saved-lineups-empty">${NO_MATCH_TEXT}</div>`);
    lastExposure = { exposure: {}, subtitle: "" };
  } else if (n) {
    // Bend numbers and marks describe the batch as made: hidden once a card is discarded.
    const whole = n === r.made;
    const players = shown.map((e) => (e.item.players ?? []).map((p) => ({ ...p, identity: identityOf(p.id, rowById) })));
    const k = shown.length;
    const subtitle = opt.mustHave.length ? `${k} of ${n} new lineup${n === 1 ? "" : "s"}, filtered` : `${n} new lineup${n === 1 ? "" : "s"}`;
    const marks = whole && !filtered && r.made >= r.marks.asked ? r.marks : null; // a short batch is not marked
    let exposure = exposureOfLineups(players);
    if (marks) {
      const held = new Set(players.flat().map((p) => p.identity));
      const playerOf = (id) => {
        const row = rowById.get(String(id));
        return row ? { name: row.name, pos: row.pos, team: row.team, opp: matchupText(row), own: row.own } : null;
      };
      exposure = zeroMinRows(exposure, marks, playerOf, (id) => held.has(identityOf(id, rowById)));
    }
    lastExposure = { exposure, subtitle, marks };
    // Adam 2026-10-17: the exposure tables above the cards, so they are high on the screen
    parts.push(optExposureHtml(classicEntries(lastExposure.exposure), opt.exp, "classic", pick, lastExposure.marks, { subtitle: lastExposure.subtitle }));
    // Adam 2026-10-17: the sort orders the shown cards (they keep their own numbers)
    const keys = sortKeysFor(isCash ? "cash" : "gpp", isCash ? r.basis === "median" : boardMediansForSort());
    const sort = effectiveSort(opt.sort.new, keys);
    const ordered = sortLineups(shown, sort.key, sort.dir, (e) => newLineupFigures(e.item, rowById));
    if (ordered.length >= 2) parts.push(sortRowHtml("new", keys, sort));
    const cardCash = (lineup) => (isCash ? { basis: r.basis, strip: cashStrip(lineup, r, rowById, busy) } : null);
    parts.push(`<div class="opt-cards">${ordered.map((e) => optLineupCardHtml(e.item, e.index, busy, { saved: savedFlags[e.index], rowById, cash: cardCash(e.item) })).join("")}</div>`);
    if (whole) parts.push(bendsLineHtml(r.bends, r.made));
  } else {
    lastExposure = { exposure: {}, subtitle: "" };
  }
  return parts.join("");
}
