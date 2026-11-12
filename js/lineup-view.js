// The Optimizer tab's markup in the approved look (PROJECT.md Part 4 item 5): the pool column beside the Optimizer panel (settings on one row, the working lineup in slot-first rows, the totals, Build, Save, and on Cash the Left out list). It reads `state` and
// `opt` (owned by lineup.js) and draws HTML; the Lineups tab is look-lineups.js, the pool is lineup-pool.js. Wiring and actions stay in lineup.js, lineup-optimizer.js and look-lineups.js.
import { buildingHtml, goLabelHtml, buildingRowClass } from "./lineup-stop.js";
import { escapeHtml, money } from "./format.js";
import { store, activeSlateRows, activeSlateGames, isTwoGunMode } from "./state.js";
import { perSpotText } from "./totals.js";
import { contrarianRead, contrarianHtml, contrarianMan, readBasisFor, ownFor } from "./lineup-contrarian.js"; // Adam 2026-11-04: the GPP Stack / Rest / Own vs field read
import { OPT_POSITIONS } from "./lineup-exposure.js";
import { statusLineHtml, statusToneClass, TONE_WARN, TONE_NOTICE } from "./row-message.js";
import { paletteForRows } from "./team-palette.js";
import { settingRowHtml, settingChipsRowHtml, activeRulesSummary, switchButtonHtml, switchCheckboxHtml, numberBoxHtml, ruleOn, countNote } from "./lineup-settings.js";
import { listedQbs, qbStacksPayload, qbListHtml, qbPanelsHtml, defaultsApply, SPREAD_HINT } from "./lineup-qb-stacks.js";
import { cashHeadLine, boardHasMedians } from "./lineup-cash.js";
import { leftOutPanelHtml } from "./lineup-left-out-panel.js"; // Part F: the Cash tab's Left out panel, under Build
import { rightColumnHtml, poolMessageShown } from "./lineup-pool.js"; // the pool: the Optimizer's one player table (C9, C10, C17)
import { confirmHtml, anchorHtml, CLEAR_QUESTION, DELETE_QUESTION, REPLACE_QUESTION } from "./confirm-inline.js"; // B13, C11, A12: the confirms beside their buttons
import { lookMan, lookTotals, projText, ownText, NO_FIGURE } from "./look-adapter.js";
import { lookRowHtml, lookEmptyRowHtml, padlockHtml } from "./look-row.js";
import { lineupsScreenHtml } from "./look-lineups.js";
import { varianceRowHtml, variancePosSettings, varianceSummary, CLASSIC_VARIANCE_POSITIONS } from "./variance-pos.js"; // GPP variance per position (Adam 2026-11-11)
import {
  state, opt, LINEUP_SLOTS, SALARY_CAP, MAX_TEAM_OPTIONS, OPT_MAX_COUNT, OPT_MAX_UNIQUE, OPT_STACK_OWN_MAX, OPT_STACK_OPP_MAX, OPT_DEFAULT_UNIQUE,
  OPT_RULES, RULE_GROUPS, boardRowMap, effectiveObjective, qbGlobals, listedQbIds, lineupsCountNow,
} from "./lineup.js";
import {
  slateKeyOf, parsePct, parseWhole, requestCount, savedForSlate, playerMaxFor, playerMinFor, lockedIds, buildGenerateSettings, minRowOut, upperOf, cashBasisInfo, wantRowsFor, cashSummaryText, currentRowById,
} from "./lineup-optimizer.js";

export { savedLineupCardHtml, savedLineupSlotHtml, optLineupCardHtml, savedLineupPlayers, savedLineupFigures, shownSavedLineups, pickOptions, cardIsSaved, lineupTotalsOf, optNotesHtml, bendsLineHtml } from "./look-lineups.js";
export { DELETE_QUESTION, REPLACE_QUESTION };

// --------------------------------------------------------------------------------------------------------
// Render
// --------------------------------------------------------------------------------------------------------

/** The tab's markup: the work area (the pool and the Optimizer panel) or, on the Lineups tab, the lineups screen. `#pool-top` (the sticky filter bar) is put into the empty slot after the draw (lineup.js). */
export function panelHtml() {
  const board = store.get().board;
  // rowById is an id lookup over the WHOLE board on purpose: the nine slots and the saved cards must still find a player not on the second slate on screen (D57).
  const rowById = new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
  paletteForRows(rowById, activeSlateRows(board)); // Team rows fix, 2026-10-17: the cards' palette is the active slate's teams, fixed here once per render
  const poolHtml = rightColumnHtml(activeSlateRows(board), rowById); // drawn first: it says whether the click's message sits in a pool row (A14)
  // Both tabs are in the one mount; app.js's lineups-only class shows one of them (look.css).
  return `
    <div class="work">
      <section class="pool"><div data-fbar-slot></div>${poolHtml}</section>
      <aside class="opt${openSetops.has("phone-panel") ? " phone-open" : ""}" id="opt-panel">
        ${phoneToggleHtml()}
        ${panelHeadHtml()}
        ${opt.mode === "cash" ? cashSettingsHtml(rowById, board) : gppSettingsHtml(rowById, board)}
        ${workingLineupHtml(rowById, board)}
        ${actionsHtml(board)}
        ${buildStatusHtml(poolMessageShown())}
        ${leftOutPanelHtml(board)}
      </aside>
    </div>
    ${lineupsScreenHtml(rowById)}`;
}

/** A phone's one line for the panel, closed by default so the player list comes first (look.css hides it on a wider screen): what is in the lineup, and that Build is inside. */
function phoneToggleHtml() {
  const open = openSetops.has("phone-panel");
  const filled = state.slots.filter(Boolean).length;
  return `<button type="button" class="opt-phone-toggle" data-setop="phone-panel" aria-expanded="${open}">${open ? "Close the Optimizer" : `Open the Optimizer · ${filled} of ${LINEUP_SLOTS.length} seats filled · Build here`}<span>${open ? "▾" : "▸"}</span></button>`;
}

/** The panel's title and the GPP | Cash switch (each tab keeps its own settings and lineup, Part F); a refused Build's sentence beside them. */
function panelHeadHtml() {
  const seg = [["gpp", "GPP", "Tournament lineups: this tab's own settings, lineup and lineups"], ["cash", "Cash", "Cash-game lineups: this tab's own settings, lineup and lineups"]]
    .map(([k, label, title]) => `<button type="button" role="tab" class="${opt.mode === k ? "on" : ""}" data-opt-mode="${k}" aria-selected="${opt.mode === k}" title="${escapeHtml(title)}">${label}</button>`).join("");
  return `<div class="oh"><h3>Optimizer</h3><div class="seg" role="tablist" aria-label="Lineup type">${seg}</div></div>${opt.error ? `<div class="hint2"><span class="${statusToneClass(opt.errorTone).trim()} opt-go-error">${escapeHtml(opt.error)}</span></div>` : ""}`;
}

// ---- the settings ----

export const openSetops = new Set(); // which of the panel's collapsed settings groups are open; page-only

const setopHtml = (key, label, summary, bodyHtml) => `<button type="button" class="setop" data-setop="${key}" aria-expanded="${openSetops.has(key)}">${escapeHtml(label)}<em>${escapeHtml(summary)}</em><span>${openSetops.has(key) ? "▾" : "▸"}</span></button><div class="setopb"${openSetops.has(key) ? "" : " hidden"}>${bodyHtml}</div>`;

const selectHtml = (id, label, values, current, text = (v) => String(v)) => `<select id="${id}" class="opt-input" aria-label="${escapeHtml(label)}">${values.map((v) => `<option value="${escapeHtml(String(v))}"${String(current) === String(v) ? " selected" : ""}>${escapeHtml(text(v))}</option>`).join("")}</select>`;
const upTo = (max) => Array.from({ length: max + 1 }, (_, i) => i);
const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? "" : "s"}`;

/** "QB + 1 teammate or more · 0 opponents or more", the Stack group's closed line (D73: an unticked number is exact). */
export function stackSummary(o = opt) {
  const side = (n, more, word) => `${plural(n, word)}${more === false ? " exactly" : " or more"}`;
  return `QB + ${side(o.stackOwn, o.stackOwnOrMore, "teammate")} · ${side(o.stackOpp, o.stackOppOrMore, "opponent")}`;
}

function capsSummary(board, lockedList) {
  const caps = OPT_POSITIONS.map((pos) => [pos, parsePct(opt.maxExp[pos])]).filter(([, n]) => typeof n === "number" && Number.isFinite(n)).map(([pos, n]) => `${pos} ${n}%`);
  const custom = Object.keys(qbStacksPayload(opt.qb.entries, boardRowMap(board), listedQbIds(activeSlateRows(board)), null, lockedList)).length;
  const avoided = activeSlateGames(board).filter((g) => opt.avoid.has(String(g.id ?? g))).length;
  const parts = [...caps, opt.spreadDst ? "spread defenses" : "", avoided ? `${avoided} avoided` : "", custom ? `${plural(custom, "custom QB stack")}` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "none";
}

const heldLineHtml = (html) => `<div class="hint2 opt-lockinfo" id="opt-lockinfo" title="${html}">${html}</div>`;
const heldNames = (rs) => escapeHtml(rs.map((r) => r.name).join(", "));

function gppSettingsHtml(rowById, board) {
  const games = activeSlateGames(board);
  const { inLineup, padlocked } = heldSplit(rowById);
  const heldParts = [inLineup.length ? `${inLineup.length} in the lineup: ${heldNames(inLineup)}` : "", padlocked.length ? `${padlocked.length} locked: ${heldNames(padlocked)}` : ""].filter(Boolean);
  const lockedList = lockedIds(state.slots, state.locks);
  const countInput = numberBoxHtml(`type="number" min="1" max="${OPT_MAX_COUNT}" id="opt-count" value="${escapeHtml(opt.count)}" aria-label="How many lineups"`, countNote(opt.count, OPT_MAX_COUNT), "opt-unit-note");
  const uniqueInput = numberBoxHtml(`type="number" min="1" max="${OPT_MAX_UNIQUE}" id="opt-min-unique" value="${escapeHtml(opt.minUnique)}" aria-label="Minimum unique players between lineups"`, `Maximum ${OPT_MAX_UNIQUE}`, "opt-unit-note");
  const teamSelect = selectHtml("opt-max-team", "Max per team", MAX_TEAM_OPTIONS, opt.maxPerTeam, (v) => (v === "" ? "No limit" : v));
  const row1 = `<div class="set4">
      <label title="Each keeps the men in your slots, locked or not">Lineups to make${countInput}</label>
      <label title="Between any two lineups, maximum ${OPT_MAX_UNIQUE}">Min unique players${uniqueInput}</label>
      <label title="Not applied to the QB's team or his opponent">Max per team${teamSelect}</label>
      <label title="The lineups are built by projection">Objective<input value="Projection" readonly tabindex="-1" /></label>
    </div>`;
  const defaultsLive = stackDefaultsApply(board);
  const stackBody = `<div class="opt-stack-rows${defaultsLive ? "" : " opt-row-inert"}"${defaultsLive ? "" : ` title="${STACK_INERT_TITLE}" aria-label="${STACK_INERT_TITLE}"`}>${settingRowHtml("Teammates", `${selectHtml("opt-stack-own", "Teammates to stack with the quarterback", upTo(OPT_STACK_OWN_MAX), opt.stackOwn)}${switchCheckboxHtml("opt-stack-own-more", opt.stackOwnOrMore, "or more", "exactly")}`)}${settingRowHtml("Opponents", `${selectHtml("opt-stack-opp", "Opponents to stack with the quarterback", upTo(OPT_STACK_OPP_MAX), opt.stackOpp)}${switchCheckboxHtml("opt-stack-opp-more", opt.stackOppOrMore, "or more", "exactly")}`)}</div>`;
  const ruleRows = ruleRowsHtml(opt.rules, RULE_GROUPS.build);
  const capRow = `<div class="opt-subtitle">Max %</div><div class="opt-cap-row">${OPT_POSITIONS.map((pos) => `<label class="opt-cap"><span class="opt-cap-pos">${pos}</span>${numberBoxHtml(`type="text" inputmode="decimal" class="opt-input opt-input-pct" data-opt-exp="${pos}" value="${escapeHtml(opt.maxExp[pos])}" placeholder="no cap" aria-label="${pos} maximum exposure percent"`, "%")}</label>`).join("")}</div>`;
  const spreadRow = settingRowHtml("Spread defenses", switchButtonHtml(opt.spreadDst, "Spread defenses", `data-action="opt-spread-dst"`), SPREAD_HINT);
  const avoidRow = games.length ? settingChipsRowHtml("Avoid game", avoidChipsHtml(games, opt.avoid)) : "";
  const qbRows = listedQbs(activeSlateRows(board), lockedList);
  const qbBody = `${qbListHtml(qbRows, opt.qb, lockedList)}${qbPanelsHtml(qbRows, opt.qb, qbGlobals(), activeSlateRows(board), OPT_STACK_OWN_MAX, OPT_STACK_OPP_MAX, lockedList)}`;
  // GPP variance per position (Adam 2026-11-11): one compact row under the four boxes, blank by default; a box that is not a percent is marked and blocks Build.
  const varianceRow = `<div class="opt-var-line">${varianceRowHtml(opt.variancePos, CLASSIC_VARIANCE_POSITIONS, "data-opt-var")}</div>`;
  return `${row1}
    ${varianceRow}
    ${setopHtml("stack", "Stack", stackSummary(), stackBody)}
    ${setopHtml("rules", "Rules", activeRuleNames(), ruleRows)}
    ${setopHtml("caps", "Position caps, spread defenses, avoid games, custom QB stacks", capsSummary(board, lockedList), `${capRow}${spreadRow}${avoidRow}<div class="opt-subtitle">Per-QB overrides</div>${qbBody}`)}
    ${heldLineHtml(heldParts.join(" · "))}`;
}

const activeRuleNames = () => OPT_RULES.filter((r) => RULE_GROUPS.build.includes(r.key) && ruleOn(opt.rules, r.key)).map((r) => r.label).join(" · ") || "none on";

// Walkthrough friction (PROJECT.md Part 4 item 5): Cash says what its pool chips do, and that a median build does not read typed projections (it reads TwoGun's median, which the thumbs scale).
// G64 (2:49 PM 11-11): short labels in place, never a paragraph.
const CASH_KEY_HTML = "<b>Lock</b> every lineup · <b>Want</b> your list · <b>Fine</b> the numbers";
export const CASH_TYPED_WORDS = "Median build: typed projections not used, thumbs are.";

function cashSettingsHtml(rowById, board) {
  const basis = cashBasisInfo(board);
  const games = activeSlateGames(board);
  const held = heldSplit(rowById);
  const teamSelect = selectHtml("opt-cash-max-team", "Max per team", MAX_TEAM_OPTIONS, opt.cash.maxPerTeam, (v) => (v === "" ? "No limit" : v));
  const avoidBody = games.length ? settingChipsRowHtml("Avoid game", avoidChipsHtml(games, new Set(opt.cash.avoid))) : "";
  const avoided = games.filter((g) => opt.cash.avoid.includes(String(g.id ?? g))).length;
  return `<div class="cntrow"><label title="The best first, then the next best">Lineups to make${numberBoxHtml(`type="number" min="1" max="${OPT_MAX_COUNT}" id="opt-cash-count" value="${escapeHtml(opt.cash.count)}" aria-label="How many lineups"`, countNote(opt.cash.count, OPT_MAX_COUNT), "opt-unit-note")}</label></div>
    <div class="set2">${setopHtml("cash-team", "Max per team", opt.cash.maxPerTeam === "" ? "no limit" : opt.cash.maxPerTeam, settingRowHtml("Max per team", teamSelect, "Every team, the quarterback's included"))}${setopHtml("cash-avoid", "Avoid games", avoided ? `${avoided} avoided` : "none", avoidBody)}</div>
    ${basis.blocked ? `<div class="hint2 opt-warn">${escapeHtml(basis.text)}</div>` : basis.basis === "proj" ? "" : `<div class="hint2">Build by <span class="cash-basis">${escapeHtml(basis.text)}</span></div><div class="hint2 cash-typed">${CASH_TYPED_WORDS}</div>`}
    <div class="hint2 cash-key" aria-label="What Lock, Want and Fine do">${CASH_KEY_HTML}</div>
    ${heldLineHtml(cashHeadLine(held.padlocked, wantRowsFor(slateKeyOf(board), rowById), held.inLineup))}`;
}

// ---- the working lineup ----

const SLOT_REMOVE_TITLE = "Click to remove";
const SEAT_WHO = Object.freeze({ QB: "a QB", RB: "an RB", WR: "a WR", TE: "a TE", FLEX: "an RB, WR or TE", DST: "a defense" });
/** How to fill an empty seat, said in the seat (walkthrough friction, PROJECT.md Part 4 item 5). */
export const emptySeatHint = (slotName) => `click ${SEAT_WHO[slotName] ?? "a player"} in the list`;

function workRowHtml(slotName, i, rowById, palette) {
  const s = state.slots[i];
  const remove = `data-action="slot-remove" data-slot="${i}" tabindex="0" title="${SLOT_REMOVE_TITLE}" aria-label="${SLOT_REMOVE_TITLE}"`;
  if (!s) return lookEmptyRowHtml(slotName, "Empty", { attrs: `data-slot-index="${i}"`, hint: emptySeatHint(slotName) });
  const row = rowById.get(String(s.id)); // 🔵 finding 2: a slot whose id no longer has a row shows a marker instead of guessing at stale figures
  if (!row) return lookEmptyRowHtml(slotName, "Not on this slate", { attrs: `data-slot-index="${i}" ${remove}` });
  const locked = state.locks.has(String(row.id));
  return lookRowHtml(lookMan(row, row), { slot: slotName, kind: "work", locked, palette, ctl: padlockHtml(row.id, locked), attrs: `data-slot-index="${i}" ${remove}` });
}

/** The one working-lineup row of `row` in `slotName` (the name lineup.js and the tests know it by). */
export function slotPlayerHtml(row, _tags = [], slotName = "", palette = null) {
  return lookRowHtml(lookMan(row, row), { slot: slotName, kind: "work", locked: state.locks.has(String(row.id)), palette, ctl: padlockHtml(row.id, state.locks.has(String(row.id))) });
}

function workingLineupHtml(rowById, board) {
  const palette = paletteForRows(rowById);
  const men = state.slots.filter(Boolean).map((s) => { const r = rowById.get(String(s.id)); return r ? { salary: r.salary, proj: r.proj, own: r.own } : {}; });
  const filled = state.slots.filter(Boolean).length;
  const locked = state.slots.filter((s) => s && state.locks.has(String(s.id))).length;
  const clear = anchorHtml(`<button type="button" id="lineup-clear-all-btn" class="clr">Clear lineup</button>`, state.confirm === "clear" ? confirmHtml(CLEAR_QUESTION, { data: "clear" }) : "", { align: "swap" });
  const rows = LINEUP_SLOTS.map((name, i) => workRowHtml(name, i, rowById, palette)).join("");
  return `<div class="lu wk">
      <div class="luh"><span>${opt.mode === "cash" ? "Cash" : "GPP"} lineup · ${filled} of ${LINEUP_SLOTS.length} seats filled</span><span class="luhr">${locked} locked${clear}</span></div>
      <div class="wkh"><span>Slot</span><span class="wkhp">Player</span><span>Salary</span><span>Proj</span><span>Own</span><span></span></div>
      ${rows}
      ${totalsHtml(men, board, filled)}
    </div>`;
}

/** The working lineup's one totals line (the approved look): Salary left, Per open slot, Salary used, Proj, Value, Own at card-footer size; a figure a man lacks is a dash, never zero. Then the GPP own-vs-field read. */
function totalsHtml(men, board, filled) {
  const t = board ? lookTotals(men, { cap: SALARY_CAP, seats: LINEUP_SLOTS.length }) : { used: null, left: null, proj: null, own: null, value: null, perOpen: null, over: false, fillPct: 0 };
  const dash = (why) => `<span class="miss" title="${escapeHtml(why)}">${NO_FIGURE}</span>`;
  const why = board ? (filled ? "a man in this lineup has no figure or is no longer on this slate" : "no man in this lineup yet") : "the board has not loaded";
  const money0 = (v) => (v === null ? dash(why) : money(v));
  const left = t.over ? `<span class="overcap">Salary left <b>−${money(-t.left)}</b></span>` : `<span>Salary left <b>${money0(t.left)}</b></span>`;
  const basis = readBasisFor(board);
  const read = opt.mode === "cash" ? null : contrarianRead(state.slots.filter(Boolean).map((s) => { const r = store.get().board?.rows?.find((x) => String(x.id) === String(s.id)); return contrarianMan(r, "a man not on this slate", ownFor(r, basis)); }), basis);
  const readLine = read?.ok ? contrarianHtml(read) : ""; // C2: nothing until the lineup can be read (all nine men in); item 7 (G64): its explaining sentence is gone, the bar's own ends say it
  const perOpenText = perSpotText(t.left, LINEUP_SLOTS.length - filled) ?? ""; // Adam 2026-10-18: salary per remaining spot; "" when full or over
  return `<div class="cap"><div class="capbar${t.over ? " over" : ""}"><i style="width:${t.fillPct}%"></i></div><div class="capt"><span>Salary used <b>${money0(t.used)}</b><em class="of">of ${money(SALARY_CAP)}</em></span>${left}<span>Proj <b>${t.proj === null ? dash(why) : escapeHtml(projText(t.proj))}</b></span><span>Own <b>${t.own === null ? dash(why) : escapeHtml(ownText(t.own))}</b></span>${t.perOpen !== null ? `<span class="perop" title="${escapeHtml(perOpenText)}">Per open slot <b>${money(t.perOpen)}</b></span>` : ""}<span class="tval" title="Projection per $1,000 of salary used">Value <b>${t.value === null ? dash(why) : t.value.toFixed(2)}</b></span></div></div>${readLine ? `<div class="lt-read">${readLine}</div>` : ""}`;
}

// ---- Build, Save, the open-Lineups link ----

/** The working lineup's name box and Save (Copy when a saved lineup is loaded). Optimizer standard A13: a loaded lineup updates in place. */
export function saveControlsHtml({ loaded, hasAnySlot, saving, saveName }) {
  const off = !hasAnySlot || saving ? " disabled" : "";
  const btn = (id, label, title = "") => `<button type="button" id="${id}" class="ol lineup-build-btn"${title ? ` title="${title}"` : ""}${off}>${saving && id === "lineup-save-btn" ? "Saving…" : label}</button>`;
  return `<label class="savebox">${loaded ? "Name" : "Save as"}<input type="text" id="lineup-save-name" class="lineup-save-name-input" placeholder="Name (optional)" value="${escapeHtml(saveName)}" /></label>${loaded ? `${btn("lineup-save-btn", "Save lineup", "Save your changes to the loaded lineup")}${btn("lineup-save-new-btn", "Copy", "Save as a new lineup and keep this one")}` : btn("lineup-save-btn", "Save lineup")}`;
}

function actionsHtml(board) {
  const showing = opt.generating && opt.buildingShown; // a build under a second shows nothing (lineup-stop.js)
  const busy = showing || opt.saving || (opt.mode === "cash" && cashBasisInfo(board).blocked);
  const cash = opt.mode === "cash";
  const count = requestCount(cash ? opt.cash.count : opt.count);
  const goWords = `Build ${count} ${cash ? "Cash" : "GPP"} lineup${count === 1 ? "" : "s"}`;
  const loaded = state.loadedId != null && state.savedLineups.some((l) => l.id === state.loadedId);
  const n = lineupsCountNow();
  const built = opt.results?.lineups.length ?? 0;
  const justBuilt = Boolean(opt.doneNote && !opt.generating && opt.results); // C1: one control after a Build, under the button pressed
  const formError = opt.formError ? statusLineHtml(opt.formError, TONE_WARN, "opt-form-error opt-form-error-footer") : ""; // 🔵 d842f0b: a refusal from Build shows where Build was pressed
  return `<div class="act">
      ${formError}
      <div class="gorun${buildingRowClass({ showing, below: opt.buildingBelow })}">
        <span class="gomsg opt-summary" title="${escapeHtml(optSummaryText(board))}"></span>${"" /* item 7 (G64, lead 3:10 PM 11-11): the summary repeated the Stack and Rules rows above; it is the hover only */}
        ${buildingHtml({ showing, canStop: opt.canStop, stopId: "opt-stop-btn", stopping: opt.stopping, stopError: opt.stopError })}
        <button type="button" id="opt-go-btn" class="go opt-go"${busy ? " disabled" : ""}>${goLabelHtml({ showing, idle: goWords })}</button>
      </div>
      ${justBuilt ? `<button type="button" class="seelu" data-action="opt-open-lineups">Build finished: see your${built ? ` ${built}` : ""} ${cash ? "Cash" : "GPP"} lineup${built === 1 ? "" : "s"}</button>` : ""}
      <div class="two">${saveControlsHtml({ loaded, hasAnySlot: state.slots.some(Boolean), saving: state.saving, saveName: state.saveName })}${justBuilt ? "" : `<button type="button" class="ol" data-action="opt-open-lineups">${n ? `${n} lineup${n === 1 ? "" : "s"} built: open Lineups` : "Open Lineups"}</button>`}</div>
    </div>`;
}

// Standard A14: what a click on a pool row says (addError) is drawn beside that row; it comes here only when no row of the pool on screen carries it (`addInRow`). Save's messages have no clicked row, so they stay here; red only for a failure.
function buildStatusHtml(addInRow = false) {
  const parts = [];
  if (state.memoryNote) parts.push(statusLineHtml(state.memoryNote, TONE_NOTICE)); // A9: a remembered lineup that lost men says who (neutral: nothing the app did wrong)
  if (state.addError && !addInRow) parts.push(statusLineHtml(state.addError, state.addTone ?? TONE_WARN));
  if (state.saveError) parts.push(statusLineHtml(state.saveError, state.saveTone));
  else if (state.saveConfirm) parts.push(statusLineHtml(state.saveConfirm, TONE_NOTICE));
  return parts.length ? `<div class="act-status">${parts.join("")}</div>` : "";
}

// --------------------------------------------------------------------------------------------------------
// The panel's small pieces and the settings text (kept here: lineup.js and the tests import them)
// --------------------------------------------------------------------------------------------------------

/** `notes` (optional): {ruleKey: {text, warn}}, a line under that rule's row (ChatGPT wish k: the starred-QB count). */
export function ruleRowsHtml(rules, keys = OPT_RULES.map((r) => r.key), notes = {}) {
  return OPT_RULES.filter((r) => keys.includes(r.key))
    .map((r) => settingRowHtml(r.label, switchButtonHtml(ruleOn(rules, r.key), r.label, `data-action="opt-rule" data-key="${escapeHtml(r.key)}"`), notes?.[r.key]?.text ?? "", notes?.[r.key]?.warn ? "opt-warn" : ""))
    .join("");
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

/** How many quarterbacks "starred QBs only" leaves in the pool (ChatGPT wish k, Adam 2026-10-17): the slate's QBs that are starred and not otherwise kept out (excluded, out, no projection, avoided game), by the same test as the Min % checks (minRowOut). `pool` = {excludes (Set), avoid (Set)}. */
export function starredQbQualifiers(rows, pool) {
  return (rows ?? []).filter((r) => upperOf(r?.pos) === "QB" && !minRowOut(r, r.id, { ...pool, starredQbOnly: true })).length;
}

/** Adam 2026-10-18 1:50 AM: the ids of the QBs a build can pick, for "do the Default stack rows still apply". A locked QB is the only usable one; otherwise every slate QB the same minRowOut test leaves in the pool, with "starred QBs only" as the rule is set. Per-lineup bends are ignored here: a bent lineup names its bend on its card (D73), so the grey state need not track them (🔵 2026-10-18). */
export function usableQbIds(rows, pool, starredOnly, lockedIdList) {
  const locked = new Set((lockedIdList ?? []).map(String));
  const qbs = (rows ?? []).filter((r) => upperOf(r?.pos) === "QB");
  const lockedQbs = qbs.filter((r) => locked.has(String(r.id)));
  if (lockedQbs.length) return lockedQbs.map((r) => String(r.id));
  return qbs.filter((r) => !minRowOut(r, r.id, { ...pool, starredQbOnly: Boolean(starredOnly) })).map((r) => String(r.id));
}

/** The line under the "starred QBs only" rule: "3 starred QBs qualify". At 0 it warns (nothing can be built) unless a QB is locked, which the build uses instead. */
export function starredQbNote(count, lockedQb) {
  const words = `${count} starred QB${count === 1 ? "" : "s"} ${count === 1 ? "qualifies" : "qualify"}`;
  if (count > 0) return { text: words, warn: false };
  return lockedQb ? { text: `${words}; the locked QB is used`, warn: false } : { text: `${words}: star one or lock one`, warn: true };
}

export function lockedNames(rowById) {
  return lockedIds(state.slots, state.locks).map((id) => rowById.get(id)).filter(Boolean);
}

/** D3 (round 3 fixes): the men a Build holds, said as they are: clicked into the lineup (held, no padlock) and padlocked. A padlock counts only as locked, a clicked-in man only as in the lineup, so the two counts add up to what the Build keeps. */
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

/** ChatGPT wish i, Adam 2026-10-17: the one-line summary of the settings in effect, beside Build, from the same `opt` the controls edit; count and unique as the request parses them, the objective as the build will use it. */
export function optSummaryText(board) {
  if (opt.mode === "cash") return cashSummaryText(board); // Cash mode job 3b
  const rows = activeSlateRows(board);
  const lockedQb = lockedNames(currentRowById()).some((r) => upperOf(r.pos) === "QB");
  const qualifiers = ruleOn(opt.rules, "starredQbOnly") ? starredQbQualifiers(rows, starredQbPool()) : null;
  const qbOwnCount = Object.keys(qbStacksPayload(opt.qb.entries, boardRowMap(board), listedQbIds(rows), null, lockedIds(state.slots, state.locks))).length;
  // 🔵 2026-10-17: the percents parsed by parsePct as buildGenerateSettings does (a blank or invalid box is null), and the players with a Max % or Min % box counted from the request's own maps, for the players still in this slate's pool.
  const maxExp = Object.fromEntries(OPT_POSITIONS.map((pos) => { const p = parsePct(opt.maxExp[pos]); return [pos, Number.isNaN(p) ? null : p]; }));
  const slateKey = slateKeyOf(board);
  const poolIds = new Set(rows.map((r) => String(r.id)));
  const inPool = (map) => Object.fromEntries(Object.entries(map).filter(([id]) => poolIds.has(id)));
  const caps = buildGenerateSettings({ playerMax: inPool(playerMaxFor(slateKey)), playerMin: inPool(playerMinFor(slateKey)) });
  const playerCapCount = new Set([...Object.keys(caps.playerMaxExposure ?? {}), ...Object.keys(caps.playerMinExposure ?? {})]).size;
  const variance = variancePosSettings(opt.variancePos, CLASSIC_VARIANCE_POSITIONS); // as buildGenerateSettings sends it
  const shown = { ...opt, maxExp, count: requestCount(opt.count), minUnique: parseWhole(opt.minUnique, 1, OPT_MAX_UNIQUE, OPT_DEFAULT_UNIQUE), objective: effectiveObjective(opt.objective), varianceText: variance ? varianceSummary(variance) : "" };
  return activeRulesSummary(shown, { games: activeSlateGames(board), starredQbCount: qualifiers === 0 && lockedQb ? null : qualifiers, qbOwnCount, playerCapCount });
}

/** What the filter bar's Starred QBs only chip shows (ChatGPT wish k, Adam 2026-10-17: with the rule on, a line counts the QBs that qualify): {hidden (cash builds have no such rule), on, note: {text, warn}}; the note is null while the rule is off. */
export function starredQbChipView(board) {
  const on = ruleOn(opt.rules, "starredQbOnly");
  const lockedQb = lockedNames(currentRowById()).some((r) => upperOf(r.pos) === "QB");
  return { hidden: opt.mode === "cash", on, note: on ? starredQbNote(starredQbQualifiers(activeSlateRows(board), starredQbPool()), lockedQb) : null };
}

/** The saved lineups of the slate on screen (D57 slate key, savedForSlate), of the mode on screen unless `mode` says another (cash mode job 3b: null = both, for names that must stay unique across modes). */
export function savedOfActiveSlate(mode = opt.mode) {
  const board = store.get().board;
  const slateIds = new Set(activeSlateRows(board).map((r) => String(r.id)));
  return savedForSlate(state.savedLineups, slateKeyOf(board), slateIds, mode);
}

/** Whether the board is in TwoGun mode and carries medians: the only case the Median sort is offered for a GPP list or a saved list. */
export const boardMediansForSort = () => isTwoGunMode(store.get().board) && boardHasMedians(activeSlateRows(store.get().board));

// The pool (the Optimizer's one player table, C9 and C10 of the optimizer standard) is lineup-pool.js's; every name this file exported for it is still exported from here.
export { setPoolCallbacks, poolStarClick, poolPickerFor, poolPickerNow, rightColumnHtml, CLASSIC_POOL_PICK_SKIP, classicPickAction, poolColumnSetup, poolColumnKeys } from "./lineup-pool.js";
