// The Optimizer tab's markup (split out of lineup.js, Adam 2026-10-18, moved not edited): the builder panel and its nine slots,
// the saved-lineup cards, the pool beside them, the new-lineup cards and the Optimizer band, results and footer. These functions
// read `state` and `opt` (owned by lineup.js) and draw HTML; they hold no state of their own beyond the two module variables
// below (poolCallbacks, lastExposure), which only this file assigns. Wiring and actions stay in lineup.js and lineup-optimizer.js.
import { escapeHtml, money, dec1 } from "./format.js";
import { store, matchesPosition, filterRows, sortRows, passesProjFloor, activeSlateRows, activeSlateGames, boardHasCeilings, isTwoGunMode } from "./state.js";
import { sortableHeadHtml } from "./tabs.js";
import { matchupText, gradedCellHtml, rowIsOut } from "./table.js"; // D43: the one copy of "vs DAL" / "@ DET"
import { playerLineHtml, showPos } from "./player-row.js";
import { bumpProjHtml, bumpCeilHtml } from "./bump-control.js"; // Adam 2026-10-22: ± bump on the pool's Proj cell, disabled like the star when no write is wired
import { shownTotal, lineupCeilTotal, perSpotText } from "./totals.js";
import { buildTypeText, groupByBuild } from "./lineup-builds.js";
import { lineupFigures, geoOwn, geoText, medianText, sortKeysFor, sortLineups, effectiveSort, sortRowHtml } from "./lineup-sort.js"; // Adam 2026-10-17: sort options; geo own = geometric mean of ownership, his multiplicative uniqueness
import { rowsGradedForView } from "./grade.js";
import { filterLineups, bulkLabel, filterBarHtml } from "./lineup-filter.js";
import { OPT_POSITIONS, optExposureHtml, zeroMinRows } from "./lineup-exposure.js";
import { cardPlayerRowHtml, cardDecor, teamColours, teamColourStyle } from "./lineup-card.js";
import { lineupRoles, roleTagsHtml } from "./lineup-marks.js";
import { paletteForRows } from "./team-palette.js";
import { settingRowHtml, settingGroupHtml, settingChipsRowHtml, settingSubtitleHtml, activeRulesSummary, switchButtonHtml, switchCheckboxHtml, numberBoxHtml } from "./lineup-settings.js";
import { listedQbs, qbStacksPayload, qbListHtml, qbPanelsHtml, defaultsApply, SPREAD_HINT } from "./lineup-qb-stacks.js";
import { slateLineups } from "./entries.js";
import { TAG_OPTIONS, numberLineups, lineupPrefix } from "./lineup-tags.js";
import {
  cashChipHtml, convictionChipsHtml, cashHeadLine, modeSwitchHtml, boardHasMedians,
  cashTotalsText, unusedCapText, cashBadgeHtml, builtInTextCash, scoreOfRow,
} from "./lineup-cash.js";
import {
  state, opt, LINEUP_SLOTS, SALARY_CAP, MAX_TEAM_OPTIONS, OPT_MAX_COUNT, OPT_MAX_UNIQUE, OPT_DEFAULT_UNIQUE, OPT_STACK_OWN_MAX, OPT_STACK_OPP_MAX,
  OPT_RULES, RULE_GROUPS, dkIdentity, lineupBusy, computeTotals, placeBySlotName, effectiveObjective, objectiveChipsHtml, boardRowMap, qbGlobals, listedQbIds,
} from "./lineup.js";
import {
  identityOf, slateKeyOf, playerMaxFor, playerMinFor, parsePct, parseWhole, requestCount, savedForSlate, savedSetKeys, lineupSetKey, exposureOfLineups,
  lockedIds, buildGenerateSettings, minRowOut, upperOf, cashBasisInfo, wantIdsFor, wantRowsFor, cashSummaryText, cashStrip, currentRowById,
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
  const overCap = totals.salaryUsed > SALARY_CAP;
  const fillPct = Math.max(0, Math.min(100, (totals.salaryUsed / SALARY_CAP) * 100));
  const perSpot = perSpotText(totals.salaryLeft, LINEUP_SLOTS.length - totals.filled); // Adam 2026-10-18: salary per remaining spot; null when full or over
  const salaryText =
    totals.salaryLeft < 0
      ? `${money(totals.salaryUsed)} used · ${money(-totals.salaryLeft)} over`
      : `${money(totals.salaryUsed)} used · ${money(totals.salaryLeft)} left${perSpot ? ` · ${perSpot}` : ""}`;
  // 🔵 finding 3: any placed player with a null own% makes the total unknown, not smaller.
  const ownText = totals.totalOwn == null ? "— (not every player has a published number)" : `${Math.round(totals.totalOwn)}% own`;

  // The Optimizer band is the first thing in this part of the tab (DECISIONS.md D70, Adam 2026-10-10: "move the optimizer stuff up"); the
  // lineup it builds from sits right under it, its results and the saved lineups below. The injury note and the unreadable-overrides
  // note are not drawn here: the ownership banner just above this part (#own-banner, app.js) carries both (Optimizer-first step 4).
  return `
    ${optimizerControlsHtml(rowById)}
    <div class="lineup-layout">
      <div class="lineup-left">
        ${controlsHtml()}
        <div class="lineup-slots">${slotsHtml(rowById, roles)}</div>
        <div class="salary-bar">
          <div class="salary-bar-track"><div class="salary-bar-fill${overCap ? " over" : ""}" style="width:${fillPct}%"></div></div>
          <span class="salary-bar-label${overCap ? " over" : ""}">${escapeHtml(salaryText)}</span>
        </div>
        <div class="lineup-totals">Total projection ${dec1(totals.totalProj)} &middot; Total ownership ${ownText}</div>
        ${buildStatusHtml()}
      </div>
      <div class="lineup-right">
        <h3 class="lineup-right-title">Player pool</h3>
        ${rightColumnHtml(activeSlateRows(board), rowById)}
      </div>
    </div>
    ${optimizerResultsHtml(rowById)}
    ${optimizerFooterHtml(board)}`;
}

/** The Save controls (PROJECT.md Part 4 Lineups): Save and Copy when a saved lineup is loaded, else Save lineup. */
export function saveControlsHtml({ loaded, hasAnySlot, saving, saveName }) {
  const off = !hasAnySlot || saving ? " disabled" : "";
  const btn = (id, label, title = "") =>
    `<button type="button" id="${id}" class="lineup-build-btn"${title ? ` title="${title}"` : ""}${off}>${saving && id === "lineup-save-btn" ? "Saving…" : label}</button>`;
  return `
      <label class="lineup-control">${loaded ? "Name" : "Save as"}
        <input type="text" id="lineup-save-name" class="lineup-save-name-input" placeholder="Name (optional)" value="${escapeHtml(saveName)}" />
      </label>
      ${loaded ? `${btn("lineup-save-btn", "Save")}${btn("lineup-save-new-btn", "Copy", "Save as a new lineup and keep this one")}` : btn("lineup-save-btn", "Save lineup")}`;
}

function controlsHtml() {
  const hasAnySlot = state.slots.some(Boolean);
  const loaded = state.loadedId != null && state.savedLineups.some((l) => l.id === state.loadedId);
  return `
    <div class="lineup-controls">
      <button type="button" id="lineup-clear-all-btn" class="lineup-clear-all-btn">Clear all</button>${saveControlsHtml({ loaded, hasAnySlot, saving: state.saving, saveName: state.saveName })}
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
  const decor = { rowFor: (p) => p, rolesFor: () => roleTagsHtml(tags), coloursFor: (team) => teamColours(palette, team) };
  return cardPlayerRowHtml(row, slotName, decor, { big: true });
}

function buildStatusHtml() {
  const parts = [];
  if (state.addError) {
    parts.push(`<div class="lineup-status lineup-status-warning">${escapeHtml(state.addError)}</div>`);
  }
  if (state.saveError) {
    parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(state.saveError)}</div>`);
  } else if (state.saveConfirm) {
    parts.push(`<div class="lineup-status">${escapeHtml(state.saveConfirm)}</div>`);
  }
  return parts.join("");
}

// --------------------------------------------------------------------------------------------------------
// Saved lineups rendering
// --------------------------------------------------------------------------------------------------------

function formatSavedAt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
    return `<div class="saved-lineup-slot saved-lineup-slot-tc saved-lineup-slot-empty"><span class="saved-lineup-slot-pos">${escapeHtml(slotName)}</span><span class="saved-lineup-slot-empty-text">Empty</span></div>`;
  }
  const src = entry.row ?? entry.snap;
  if (!src) return "";
  const missingCls = entry.row ? "" : " saved-lineup-slot-missing";
  const noteHtml = entry.row ? "" : `<span class="saved-lineup-slot-note">not on slate</span>`;
  const pickId = entry.row?.id ?? entry.snap?.playerId;
  const nameHtml = escapeHtml(src.name ?? "");
  return `
    <div class="saved-lineup-slot saved-lineup-slot-tc${missingCls}" style="${teamColourStyle(teamColours(palette, src.team))}"${pickId != null ? ` data-card-id="${escapeHtml(String(pickId))}"` : ""}>
      <span class="saved-lineup-slot-pos">${escapeHtml(slotName)}</span>
      ${playerLineHtml(src, { nameCls: "saved-lineup-slot-name", nameHtml, chipPlain: true, tag: entry.row ? "out" : false })}
      <span class="saved-lineup-slot-salary">${money(src.salary)}</span>
      ${noteHtml}
    </div>`;
}

/** The ceiling total of a saved lineup's build record (ChatGPT wish g): "181.4 ceil" as it was when built; a dash when a
 *  player had no TwoGun ceiling or the players were changed by hand since; "" for a hand build or a current-mode batch. */
export function savedCeilHtml(build) {
  if (!build || build.kind !== "batch") return "";
  if (build.edited) return `<span title="The players were changed by hand after this build, so its ceiling total no longer applies">— ceil</span>`; // the "·" between totals groups is CSS (.saved-lineup-totals, 👁 2026-10-18)
  if (build.totalCeil === undefined) return "";
  if (build.totalCeil === null) return `<span title="A player in this lineup had no TwoGun ceiling">— ceil</span>`;
  return `<span title="TwoGun's ceilings summed, as built">${dec1(build.totalCeil)} ceil</span>`;
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
    isCash ? cashBadgeHtml() : "", // Cash mode job 3b
    state.lineupErrors[lineup.id] ? `<span class="saved-lineup-badge saved-lineup-badge-danger">${escapeHtml(state.lineupErrors[lineup.id])}</span>` : "",
    incomplete ? `<span class="saved-lineup-badge saved-lineup-badge-warning">Incomplete</span>` : "",
    overCap ? `<span class="saved-lineup-badge saved-lineup-badge-danger">Over cap</span>` : "",
  ].join("");

  // ChatGPT wish g, Adam 2026-10-17: the board mode and build type the lineup was made with, and its ceiling total as built.
  const buildText = buildTypeText(lineup.build);
  const buildBadge = buildText ? `<span class="saved-lineup-badge saved-lineup-badge-build" title="How this lineup was made">${escapeHtml(buildText)}</span>` : "";
  const ceilHtml = savedCeilHtml(lineup.build);
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

  const salaryLeft = SALARY_CAP - totals.salaryUsed;
  const salaryText = overCap
    ? `${money(totals.salaryUsed)} used &middot; ${money(-salaryLeft)} over`
    : `${money(totals.salaryUsed)} used &middot; ${money(salaryLeft)} left`;
  // Same rule as the builder panel above (🔵 finding 3 / D29): the app never estimates ownership, so a
  // total is only printed when every filled slot has a published number; otherwise it's an em dash. When all are
  // published the count is left out so the summary stays on one line (👁 visual-qa 2026-10-11).
  const ownText =
    totals.ownPublished === totals.filled
      ? `${Math.round(totals.totalOwn)}% own`
      : `— (${totals.ownPublished} of ${totals.filled} published)`;

  const deleteHtml = isConfirmingDelete
    ? `<span class="saved-lineup-confirm">Delete this lineup?
        <button type="button" class="saved-lineup-mini-btn danger" data-action="lineup-delete-yes" data-id="${escapeHtml(lineup.id)}">Yes</button>
        <button type="button" class="saved-lineup-mini-btn" data-action="lineup-delete-no">No</button>
      </span>`
    : `<button type="button" class="saved-lineup-btn danger" data-action="lineup-delete-start" data-id="${escapeHtml(lineup.id)}">Delete</button>`;

  return `
    <div class="saved-lineup-card">
      <div class="saved-lineup-card-head">
        ${prefix ? `<span class="saved-lineup-prefix">${escapeHtml(prefix)} &middot;</span>` : ""}${nameHtml}
        ${tagHtml}
        <span class="saved-lineup-time">${escapeHtml(formatSavedAt(lineup.savedAt))}</span>
        ${buildBadge}${badges}
      </div>
      <div class="saved-lineup-slots">${rowsHtml}</div>
      <div class="saved-lineup-totals">
        <span class="${overCap ? "saved-lineup-totals-over" : ""}">${salaryText}</span>
        <span>${dec1(totals.totalProj)} proj</span>${medianPart ? `<span>${medianPart}</span>` : ""}${ceilHtml}
        <span>${escapeHtml(ownText)}${isCash ? "" : ` &middot; ${geoText(savedLineupFigures(lineup, rowById).geo, "a player has no ownership figure or is no longer on the slate")}`}</span>
      </div>
      <div class="saved-lineup-actions">
        <button type="button" class="saved-lineup-btn" data-action="lineup-load" data-id="${escapeHtml(lineup.id)}">Load</button>
        ${deleteHtml}
      </div>
    </div>`;
}

/** The Saved tab's cards in "As built" order as ONE flat grid, no build sections or headers (Adam 2026-10-18: "i dont need them
 *  sectioned off", "consistent 4 across"): newest build first, cards in their order within a build, lineups saved before builds were recorded last.
 *  `cardHtml(lineup)` draws one card. */
export function savedGroupsHtml(lineups, cardHtml) {
  const ordered = groupByBuild(lineups).flatMap((g) => g.lineups);
  return `<div class="saved-lineups-list">${ordered.map(cardHtml).join("")}</div>`;
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
      body = (k >= 2 ? sortRowHtml("saved", keys, sort) : "") + cards;
      const subtitle = opt.mustHave.length ? `${k} of ${n} saved lineup${n === 1 ? "" : "s"}, filtered` : `${n} saved lineup${n === 1 ? "" : "s"}`;
      lastExposure = { exposure: exposureOfLineups(shown.map((e) => savedLineupPlayers(e.item, rowById))), subtitle };
      exposureHtml = optExposureHtml(lastExposure.exposure, lastExposure.subtitle, opt.expSortDir, pick);
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

/** A saved lineup's sort and geo figures, off the live board rows (Adam 2026-10-17): all null when it is not nine players or a
 *  player is no longer on the board, so it sorts last and shows "— geo" rather than a figure from the players that remain. */
export function savedLineupFigures(lineup, rowById) {
  const rows = (lineup.slots ?? []).map((s) => rowById.get(String(s.playerId)));
  if (rows.length !== LINEUP_SLOTS.length || rows.some((r) => !r)) return lineupFigures([]);
  return lineupFigures(rows.map((r) => ({ proj: r.proj, own: r.own, median: scoreOfRow(r, "median") })));
}

/** A new lineup's figures: a player's own `median` when the batch carries one (a cash median build), else the board row's. */
const newPlayerMedian = (p, rowById) => ("median" in p ? p.median : scoreOfRow(rowById?.get(String(p.id)), "median"));
function newLineupFigures(lineup, rowById) {
  return lineupFigures((lineup.players ?? []).map((p) => ({ proj: p.proj, own: p.own, median: newPlayerMedian(p, rowById) })));
}

/** Whether the board is in TwoGun mode and carries medians: the only case the Median sort is offered for a GPP list or a saved list. */
const boardMediansForSort = () => isTwoGunMode(store.get().board) && boardHasMedians(activeSlateRows(store.get().board));

/** The identity of every currently-placed player (🔵 finding 6), used both to make a click on an already-placed
 *  row take him out and to block adding the same DraftKings player twice under a different board id. */
function placedIdentities(rowById) {
  const set = new Set();
  for (const s of state.slots) {
    if (!s) continue;
    const row = rowById.get(String(s.id));
    if (row) set.add(dkIdentity(row));
  }
  return set;
}

let poolCallbacks = null; // app.js's tableCallbacks: the pool's star writes the same override as Rankings' (Adam 2026-10-17)

export function setPoolCallbacks(callbacks) {
  poolCallbacks = callbacks;
}

/** Starred only is on and nothing is listed: say whether no one is starred at this position or other filters hide them. */
function poolEmptyRowHtml(graded, pos, colspan) {
  const hidden = graded.filter((r) => r.starred && matchesPosition(r, pos)).length;
  // The week's overrides file could not be read (board.tabNotes.favorites): every star reads false, so the stars are unknown, never "none".
  const unreadable = (store.get().board?.tabNotes?.favorites ?? []).some(Boolean);
  const text = unreadable
    ? "Stars could not be read this week (see the note above)."
    : hidden > 0
    ? `${hidden} starred at this position ${hidden === 1 ? "is" : "are"} hidden by other filters (projection floor, teams, salary, game or search)`
    : pos === "All" ? "No starred players" : "No starred players at this position";
  return `<tr><td class="lineup-pool-empty" colspan="${colspan}">${text}</td></tr>`;
}

/** A pool star click goes to app.js's star toggle; with none passed (Rankings never rendered) it says so. */
export function poolStarClick(id) {
  if (poolCallbacks?.onToggleStar) poolCallbacks.onToggleStar(id);
  else console.error("Pool star clicked but no star callback is wired (renderLineupPanel got none).");
}

export function rightColumnHtml(rows, rowById) {
  const { filters, sort } = store.get();
  // The classic projection floor (D52) applies to this pool like every other classic list, with one exception:
  // a player already locked or excluded stays listed so his lock or exclude can still be undone here.
  // D33: Value colours as on Rankings, FLEX included.
  const graded = rowsGradedForView(rows, filters.pos, store.get().board?.rows ?? rows);
  const cash = opt.mode === "cash"; // Cash mode job 3b, 2026-10-17: one Cash column of Must | Want | Fine in place of Min % and Max %
  const wantSet = new Set(cash ? wantIdsFor(slateKeyOf(store.get().board)) : []);
  const filtered = filterRows(graded, { ...filters, showAllPlayers: true }).filter(
    (row) => passesProjFloor(row, filters) || state.locks.has(String(row.id)) || state.excludes.has(String(row.id)) || wantSet.has(String(row.id))
  );
  const sorted = sortRows(filtered, sort.col, sort.dir);
  const placed = placedIdentities(rowById);
  // Headers sort through the same store sort the Rankings table uses (sort.col / sort.dir; keys player,
  // salary, proj, own, value, star are the ones state.js sortRows reads); the shared sortableHeadHtml draws them.
  // Max % is a plain header, not sortable (Adam 2026-10-11); Adam 2026-10-17: it follows Value, a star column leads,
  // and Pos and Status are no longer columns (the position chip and the status tag sit in the Player cell).
  const tgOn = isTwoGunMode(store.get().board) && boardHasCeilings(activeSlateRows(store.get().board)); // Adam 2026-10-25: a Ceil column after Proj while this pool can build by ceiling (the Ceiling chip's own test), so the figure (and a bump's effect) is visible
  const headBefore = [
    { key: "star", label: "★", cls: "lineup-star-col" },
    { key: "player", label: "Player" },
    { key: "salary", label: "Sal" },
    { key: "proj", label: "Proj" },
    ...(tgOn ? [{ key: "tgCeil", label: "Ceil", headTitle: "TwoGun's ceiling, DraftKings points as he publishes them; a − / + bump scales it with the projection" }] : []),
    { key: "own", label: "Own%" },
    { key: "value", label: "Proj/$", title: "Proj/$: projection per $1,000 of salary" },
  ];
  const inner = (cols) => sortableHeadHtml(cols, sort).replace(/^<tr>|<\/tr>$/g, "");
  const maxHead = `<th class="lineup-max-head" title="Most of the new lineups this player may be in; blank = no cap">Max %</th>`;
  const minHead = `<th class="lineup-min-head" title="Fewest of the new lineups this player must be in; blank = none">Min %</th>`;
  const cashHead = `<th class="lineup-cash-head" title="Must puts a player in every lineup; Want puts him on your list, and each lineup shows whether he made it; Fine leaves him to the numbers">Cash</th>`;
  const headHtml = `<tr>${inner(headBefore)}${cash ? cashHead : minHead + maxHead}<th></th></tr>`;
  const slateKey = slateKeyOf(store.get().board);
  const maxMap = playerMaxFor(slateKey);
  const minMap = playerMinFor(slateKey);
  const bodyRows = sorted.map((row) => rightRowHtml(row, placed, showPos(filters.pos), maxMap, minMap, cash ? wantSet : null, tgOn)).join("");
  const emptyRow = sorted.length === 0 && filters.starredOnly ? poolEmptyRowHtml(graded, filters.pos, headBefore.length + (cash ? 2 : 3)) : "";
  return `
    <div class="lineup-rows-wrap scroll-panel">
      <table class="lineup-rows-table lineup-pool-table${tgOn ? " pool-ceil" : ""}">
        <thead>${headHtml}</thead>
        <tbody>${bodyRows}${emptyRow}</tbody>
      </table>
    </div>
    <div class="table-legend">&mdash; = nobody has published one</div>`;
}

// ---- click-to-pick on the pool rows (D81 counterpart of 336c1f5; Adam 5:00 PM 2026-10-29: Showdown's row clicks in classic, no Add button) ----

const POOL_PICK_TITLES = Object.freeze({ add: "Click to add to the lineup", remove: "Click to remove" });

/** A click inside one of these is that control's own (the star, his name's card, the ± bump, a Min % / Max % box, the Cash chips, Lock and
 *  Exclude) or the padding around it, never a pick (pick-rows.js wirePickRows; the Showdown pool's twin is pool.js POOL_PICK_SKIP). */
export const CLASSIC_POOL_PICK_SKIP = "button, a, input, select, textarea, label, .player-name, .bump-ctl, .lineup-star-col, .lineup-min-cell, .lineup-max-cell, .lineup-cash-cell, .lineup-row-actions";

/** What a click on his pool row does: "remove" when he is placed (by DraftKings identity, 🔵 finding 6), null when he is excluded (an
 *  excluded man cannot be picked; Exclude undoes it), else "add" (lineup.js pickPoolRow puts him in the first slot his position fills). Pure. */
export function classicPickAction(row, placedSet, excludes) {
  if (placedSet.has(dkIdentity(row))) return "remove";
  return excludes.has(String(row.id)) ? null : "add";
}

/** A pool row's pick attributes: the pick its click makes, a keyboard stop and its words as the hover and the label (no button role: the
 *  row holds buttons of its own); none for a row that cannot be picked. */
function poolPickAttrs(action) {
  return action ? ` data-pick="${action}" tabindex="0" title="${POOL_PICK_TITLES[action]}" aria-label="${POOL_PICK_TITLES[action]}"` : "";
}

function rightRowHtml(row, placedSet, posShown, maxMap = {}, minMap = {}, cashWant = null, tgOn = false) { // cashWant: a Set of Want ids in cash mode, else null; tgOn: TwoGun mode, which adds the Ceil cell
  const id = String(row.id);
  const maxText = maxMap[id] ?? "";
  const maxBad = Number.isNaN(parsePct(maxText));
  const minText = minMap[id] ?? "";
  const minBad = Number.isNaN(parsePct(minText));
  const locked = state.locks.has(id);
  const excluded = state.excludes.has(id);
  // 🔵 finding 6: "already placed" is a DraftKings-identity comparison, not a board-id comparison (classicPickAction).
  const pick = classicPickAction(row, placedSet, state.excludes);
  // 🔵 finding 8: same dimming rule as the Rankings table.
  const dimmed = rowIsOut(row);
  const rowClass = `${excluded ? " lineup-row-excluded" : locked ? " lineup-row-locked" : ""}${dimmed ? " row-dimmed" : ""}${pick ? " lineup-pool-pick" : ""}`;
  return `
    <tr class="lineup-row${rowClass}" data-id="${escapeHtml(id)}"${poolPickAttrs(pick)}>
      <td class="lineup-star-col"><button type="button" class="star-btn${row.starred ? " active" : ""}" data-action="toggle-star" data-id="${escapeHtml(id)}"${poolCallbacks?.onToggleStar ? "" : " disabled"}>${row.starred ? "★" : "☆"}</button></td>
      <td>
        <span class="player-cell">${playerLineHtml(row, { pos: posShown })}</span>
      </td>
      <td>${money(row.salary)}</td>
      <td>${bumpProjHtml(row, row.proj, { enabled: Boolean(poolCallbacks?.onBump) })}</td>
      ${tgOn ? `<td>${bumpCeilHtml(row, Number.isFinite(row.tg?.ceil) ? (rowIsOut(row) ? 0 : row.tg.ceil) : null, { out: rowIsOut(row) })}</td>` : ""}
      <td>${row.own == null ? "—" : `${dec1(row.own)}%`}</td>
      <td>${gradedCellHtml(row.value, row.valueGrade)}</td>
      ${cashWant
        ? `<td class="lineup-cash-cell">${convictionChipsHtml(row, { locked, wanted: cashWant.has(id), excluded })}</td>`
        : `<td class="lineup-min-cell"><input type="text" inputmode="decimal" maxlength="5" class="opt-input lineup-min-input${minBad ? " invalid" : ""}" data-player-min="${escapeHtml(id)}" value="${escapeHtml(minText)}" aria-label="Min % for ${escapeHtml(row.name ?? "")}" /></td>
      <td class="lineup-max-cell"><input type="text" inputmode="decimal" maxlength="5" class="opt-input lineup-max-input${maxBad ? " invalid" : ""}" data-player-max="${escapeHtml(id)}" value="${escapeHtml(maxText)}" aria-label="Max % for ${escapeHtml(row.name ?? "")}" /></td>`}
      <td class="lineup-row-actions">
        ${cashWant ? "" : `<button type="button" class="lineup-row-btn${locked ? " active" : ""}" data-action="row-lock" data-id="${escapeHtml(id)}"${excluded ? " disabled" : ""}>${locked ? "Locked" : "Lock"}</button>`}
        <button type="button" class="lineup-row-btn${excluded ? " active danger" : ""}" data-action="row-exclude" data-id="${escapeHtml(id)}">${excluded ? "Excluded" : "Exclude"}</button>
      </td>
    </tr>`;
}

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
    .map((r) => settingRowHtml(r.label, switchButtonHtml(rules?.[r.key] !== false, r.label, `data-action="opt-rule" data-key="${escapeHtml(r.key)}"`), notes?.[r.key]?.text ?? "", notes?.[r.key]?.warn ? "opt-warn" : ""))
    .join("");
}

/** How many quarterbacks "starred QBs only" leaves in the pool (ChatGPT wish k, Adam 2026-10-17): the slate's QBs that are
 *  starred and not otherwise kept out (excluded, out, no projection, avoided game, no ceiling in a ceiling build), by the
 *  same test as the Min % checks (minRowOut). `pool` = {excludes (Set), avoid (Set), objective}. */
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
  const totals = lineupTotalsOf(lineup);
  const overCap = totals.salary > SALARY_CAP;
  const decor = cardDecor(lineup, rowById, paletteForRows(rowById)); // Team rows, Adam 2026-10-17: one palette per render (cached on rowById)
  // Cash mode job 3b, 2026-10-17: `cash` = {basis, strip: {html, wantIn}} on a card built in cash: "Cash N", the cash totals, the unused-cap chip, a WANT tag on the Wants that made it and the pool strip.
  if (cash) {
    // 👁 fix round, 2026-10-17: stacking is no cash goal (PROJECT.md Part 4, Cash mode), so a cash card draws no QB-stack chip and no STACK / RUNBACK / MINI / PAIR tags; WANT and the OUT tags stay.
    decor.stack = "";
    decor.rolesFor = (p) => (cash.strip.wantIn.has(String(p.id)) ? `<span class="role-tag role-want" title="On your Want list">WANT</span>` : "");
  }
  const rows = (lineup.players ?? []).map((p, i) => cardPlayerRowHtml(p, LINEUP_SLOTS[i] ?? p.pos ?? "", decor)).join("");
  const ownBody = totals.own == null ? "— own" : `${Math.round(totals.own)}% own`;
  const geoBody = geoText(geoOwn((lineup.players ?? []).map((p) => p.own))); // Adam 2026-10-17: geo own on the GPP card only
  // TwoGun mode: the lineup's total of TwoGun's ceilings, as the server summed it (absent in current mode; a dash
  // when a player has none, never a partial sum).
  const ceil = lineupCeilTotal(lineup); // ChatGPT wish d: the shown sum, totals.js
  const ceilBody = ceil === undefined ? "" : `${ceil == null ? `<span title="A player in this lineup has no TwoGun ceiling">—</span>` : dec1(ceil)} ceil`;
  // Adam 2026-10-18: the median total beside proj, off the sort's own figure; only on a TwoGun board with medians or a batch carrying them.
  const plist = lineup.players ?? [];
  const medianPart = !cash && (boardMediansForSort() || plist.some((p) => "median" in p)) ? medianText(newLineupFigures(lineup, rowById).median, plist.some((p) => newPlayerMedian(p, rowById) != null)) : "";
  const nw = (s) => (s ? ` <span class="opt-nowrap">${s}</span>` : ""); // with a median the line is long: breaks fall between figures, not inside one
  const gppTotals = medianPart // the "·" between no-wrap groups is CSS (.opt-nowrap::after, 👁 2026-10-18), so a wrapped line never starts with it; the salary span is the first group
    ? `${nw(`${dec1(totals.proj) ?? "—"} proj &middot; ${medianPart}`)}${nw(ceilBody)}${nw(`${ownBody} &middot; ${geoBody}`)}`
    : ` &middot; ${dec1(totals.proj) ?? "—"} proj${ceilBody ? ` &middot; ${ceilBody}` : ""} &middot; ${ownBody} &middot; ${geoBody}`;
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
      ${cash
        ? `<div class="opt-card-totals"><span class="${overCap ? "saved-lineup-totals-over" : ""}">${escapeHtml(cashTotalsText(lineup, cash.basis))}</span>${unusedCapText(totals.salary) ? ` <span class="cash-unused-chip" title="Salary left under the $50,000 cap">${escapeHtml(unusedCapText(totals.salary))}</span>` : ""}</div>${cash.strip.html}`
        : `<div class="opt-card-totals"><span class="${[overCap ? "saved-lineup-totals-over" : "", medianPart ? "opt-nowrap" : ""].filter(Boolean).join(" ")}">${money(totals.salary)}</span>${gppTotals}</div>`}
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

/** The pool the starred-QB count is taken over (ChatGPT wish k): excluded, avoided and ceiling-less QBs fall out. */
function starredQbPool(board) {
  return { excludes: state.excludes, avoid: new Set([...opt.avoid].map((g) => String(g).toUpperCase())), objective: effectiveObjective(opt.objective, boardHasCeilings(activeSlateRows(board))) };
}

export const STACK_INERT_TITLE = "Every QB in play has his own numbers, so these do not apply";
// 🔵 2026-10-18: only the entries the build sends count (listed QBs, as qbStacksPayload); an unstarred QB keeps his saved entry but is built under the defaults.
export const stackDefaultsApply = (board) => {
  const rows = activeSlateRows(board);
  const listed = listedQbIds(rows);
  const sent = Object.fromEntries(Object.entries(opt.qb.entries).filter(([id]) => listed.has(id)));
  return defaultsApply(usableQbIds(rows, starredQbPool(board), opt.rules.starredQbOnly !== false, lockedIds(state.slots, state.locks)), sent);
};

/** ChatGPT wish i, Adam 2026-10-17: the footer's one-line summary of the settings in effect, from the same `opt` the
 *  controls edit; count and unique as the request parses them, the objective as the build will use it. */
export function optSummaryText(board) {
  if (opt.mode === "cash") return cashSummaryText(board); // Cash mode job 3b
  const rows = activeSlateRows(board);
  const lockedQb = lockedNames(currentRowById()).some((r) => upperOf(r.pos) === "QB");
  const qualifiers = opt.rules.starredQbOnly !== false ? starredQbQualifiers(rows, starredQbPool(board)) : null;
  const qbOwnCount = Object.keys(qbStacksPayload(opt.qb.entries, boardRowMap(board), listedQbIds(rows), null, lockedIds(state.slots, state.locks))).length;
  // 🔵 2026-10-17: the percents parsed by parsePct as buildGenerateSettings does (a blank or invalid box is null), and the
  // players with a Max % or Min % box counted from the request's own maps, for the players still in this slate's pool.
  const maxExp = Object.fromEntries(OPT_POSITIONS.map((pos) => { const p = parsePct(opt.maxExp[pos]); return [pos, Number.isNaN(p) ? null : p]; }));
  const slateKey = slateKeyOf(board);
  const poolIds = new Set(rows.map((r) => String(r.id)));
  const inPool = (map) => Object.fromEntries(Object.entries(map).filter(([id]) => poolIds.has(id)));
  const caps = buildGenerateSettings({ playerMax: inPool(playerMaxFor(slateKey)), playerMin: inPool(playerMinFor(slateKey)) });
  const playerCapCount = new Set([...Object.keys(caps.playerMaxExposure ?? {}), ...Object.keys(caps.playerMinExposure ?? {})]).size;
  const shown = { ...opt, maxExp, count: requestCount(opt.count), minUnique: parseWhole(opt.minUnique, 1, OPT_MAX_UNIQUE, OPT_DEFAULT_UNIQUE), objective: effectiveObjective(opt.objective, boardHasCeilings(rows)) };
  return activeRulesSummary(shown, { games: activeSlateGames(board), starredQbCount: qualifiers === 0 && lockedQb ? null : qualifiers, qbOwnCount, playerCapCount });
}

function optimizerControlsHtml(rowById) {
  if (opt.mode === "cash") return cashControlsHtml(rowById); // Cash mode job 3b
  const board = store.get().board;
  const locked = lockedNames(rowById);
  const games = activeSlateGames(board);
  const info = locked.length
    ? `<span class="opt-lockinfo">${locked.length} locked: ${escapeHtml(locked.map((r) => r.name).join(", "))}</span>`
    : ""; // Adam 2026-10-18 (Q8): no amber rules line when nothing is locked
  // 🔵 2026-10-17 (👁 render): the five position caps are one row of five small boxes, not five rows.
  const expRows = `<div class="opt-cap-row">${OPT_POSITIONS.map((pos) =>
    `<label class="opt-cap"><span class="opt-cap-pos">${pos}</span>${numberBoxHtml(`type="text" inputmode="decimal" class="opt-input opt-input-pct" data-opt-exp="${pos}" value="${escapeHtml(opt.maxExp[pos])}" placeholder="no cap" aria-label="${pos} maximum exposure percent"`, "%")}</label>`
  ).join("")}</div>` + settingRowHtml("Spread defenses", switchButtonHtml(opt.spreadDst, "Spread defenses", `data-action="opt-spread-dst"`), SPREAD_HINT);
  const lockedList = lockedIds(state.slots, state.locks);
  const qbRows = listedQbs(activeSlateRows(board), lockedList);
  const avoidRow = games.length ? settingChipsRowHtml("Avoid game", avoidChipsHtml(games, opt.avoid)) : "";
  const formError = opt.formError ? `<div class="lineup-status lineup-status-error opt-form-error">${escapeHtml(opt.formError)}</div>` : "";
  const options = (values, current, label = (v) => String(v)) =>
    values.map((v) => `<option value="${escapeHtml(String(v))}"${String(current) === String(v) ? " selected" : ""}>${escapeHtml(label(v))}</option>`).join("");
  const upTo = (max) => Array.from({ length: max + 1 }, (_, i) => i);
  const select = (id, label, values, current, text) => `<select id="${id}" class="opt-input opt-select-n" aria-label="${label}">${options(values, current, text)}</select>`;
  // ChatGPT wish i, Adam 2026-10-17: three groups, Pool (who may be used), Stacks, Build; the exposure caps are a sub-block of Build.
  const build = [
    settingRowHtml("Lineups to make", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_COUNT}" class="opt-input opt-input-num" id="opt-count" value="${escapeHtml(opt.count)}" aria-label="How many lineups"`), "From the slots you have locked"),
    settingRowHtml("Min unique players", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_UNIQUE}" class="opt-input opt-input-num" id="opt-min-unique" value="${escapeHtml(opt.minUnique)}" aria-label="Minimum unique players between lineups"`), "Between any two lineups"),
    settingRowHtml("Build by", `<span class="opt-chips">${objectiveChipsHtml(opt.objective, boardHasCeilings(activeSlateRows(board)))}</span>`),
    settingSubtitleHtml("Max share of lineups"),
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
  // ChatGPT wish k, Adam 2026-10-17: with "starred QBs only" on, the line under it counts the QBs that qualify.
  const qbNotes = {};
  if (opt.rules.starredQbOnly !== false) {
    qbNotes.starredQbOnly = starredQbNote(starredQbQualifiers(activeSlateRows(board), starredQbPool(board)), locked.some((r) => upperOf(r.pos) === "QB"));
  }
  const pool = [
    ruleRowsHtml(opt.rules, RULE_GROUPS.pool, qbNotes),
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
    </div>`;
}

/** The Optimizer band's head: the title with the GPP | Cash switch beside it (a green $ chip on the title in cash), the
 *  Must / lock line and a refused Build's sentence (cash mode job 3b, 2026-10-17). */
function optHeadHtml(infoHtml) {
  return `<div class="opt-settings-head">
        <h3 class="opt-title">Optimizer${opt.mode === "cash" ? ` ${cashChipHtml()}` : ""}${modeSwitchHtml(opt.mode)}</h3>
        ${infoHtml}
        ${opt.error ? `<span class="lineup-status-error opt-go-error">${escapeHtml(opt.error)}</span>` : ""}
      </div>`;
}

/** The Optimizer band in cash (cash mode job 3b): Pool (Max per team, Avoid game) and Build (Lineups to make, the fixed
 *  basis). No Stacks group, QB panels, caps row, Spread defenses, roster rules or minimum unique (Adam 2026-10-17): they are off in cash. */
function cashControlsHtml(rowById) {
  const board = store.get().board;
  const basis = cashBasisInfo(board);
  const games = activeSlateGames(board);
  const info = `<span class="opt-lockinfo">${cashHeadLine(lockedNames(rowById), wantRowsFor(slateKeyOf(board), rowById))}</span>`;
  const formError = opt.formError ? `<div class="lineup-status lineup-status-error opt-form-error">${escapeHtml(opt.formError)}</div>` : "";
  const teamOptions = MAX_TEAM_OPTIONS.map((v) => `<option value="${v}"${String(opt.cash.maxPerTeam) === v ? " selected" : ""}>${v === "" ? "No limit" : v}</option>`).join("");
  const pool = [
    settingRowHtml("Max per team", `<select id="opt-cash-max-team" class="opt-input opt-select" aria-label="Max per team">${teamOptions}</select>`, "Every team, the quarterback's included"),
    games.length ? settingChipsRowHtml("Avoid game", avoidChipsHtml(games, new Set(opt.cash.avoid))) : "",
  ].join("");
  const build = [
    settingRowHtml("Lineups to make", numberBoxHtml(`type="number" min="1" max="${OPT_MAX_COUNT}" class="opt-input opt-input-num" id="opt-cash-count" value="${escapeHtml(opt.cash.count)}" aria-label="How many lineups"`), "The best first, then the next best"),
    basis.blocked ? settingRowHtml("Build by", "", basis.text, "opt-warn") : settingRowHtml("Build by", `<span class="cash-basis">${escapeHtml(basis.text)}</span>`),
  ].join("");
  return `
    <div class="opt-panel opt-settings" id="opt-panel">
      ${optHeadHtml(info)}
      ${formError}
      <div class="opt-groups opt-groups-cash">
        ${settingGroupHtml("Pool", pool)}
        ${settingGroupHtml("Build", build)}
      </div>
    </div>`;
}

/** Adam 2026-10-17: the Build button always in view (sticky footer at the tab's end). The summary sentence and Build are the last
 *  thing panelHtml draws; style.css orders them after the ranked list in #lineup-panel's column (Optimizer-first step 4), so
 *  position: sticky holds them to the bottom of the screen over the whole tab, and lineup.js watchFooter hides them while neither the
 *  builder nor its results are in view. */
function optimizerFooterHtml(board) {
  const busy = opt.generating || opt.saving || (opt.mode === "cash" && cashBasisInfo(board).blocked); // cash: Build is disabled whenever cashBasisInfo blocks (no Cash basis, or no medians on a TwoGun basis)
  // 🔵 d842f0b: a refusal from Build must show where Build was pressed, which can be far below the settings head.
  const footerError = opt.formError ? `<div class="lineup-status lineup-status-error opt-form-error-footer">${escapeHtml(opt.formError)}</div>` : "";
  return `
    <div class="opt-footer">
      ${footerError}
      <span class="opt-summary">${escapeHtml(optSummaryText(board))}</span>
      <button type="button" id="opt-go-btn" class="lineup-build-btn opt-go opt-go-big"${busy ? " disabled" : ""}>${opt.generating ? "Making…" : "Build"}</button>
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
  if (opt.error) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(opt.error)}</div>`);
  if (!r) {
    parts.push(`<div class="saved-lineups-empty">${opt.generating ? "Making lineups…" : "No new lineups. Press Build to make some."}</div>`);
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
  if (opt.saveError) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(opt.saveError)}</div>`);
  if (isCash && opt.cashUndo) parts.push(`<div class="cash-undo">Made ${escapeHtml(opt.cashUndo.names.join(" and "))} Must and built again. <button type="button" class="lineup-row-btn" data-cash-undo${busy ? " disabled" : ""}>Undo</button></div>`);
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
    parts.push(optExposureHtml(lastExposure.exposure, lastExposure.subtitle, opt.expSortDir, pick, lastExposure.marks));
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
