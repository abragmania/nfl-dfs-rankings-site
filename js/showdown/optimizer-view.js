// The Showdown Optimizer's markup (Adam 2026-10-19, sketch A: one screen under the Showdown Optimizer tab, GPP | Cash): the
// heading and the two settings boxes, the Make row, the generated cards with their meter strip, the Captain and FLEX exposure
// tables, and each pool row's Min % / Max % boxes and lock / In / exclude buttons. Markup only, from
// the classic Optimizer's own helpers and classes (public/js/lineup.js optimizerControlsHtml, cashControlsHtml,
// optimizerFooterHtml, newLineupsTabHtml, optLineupCardHtml, rightRowHtml); optimizer.js owns the state and the requests.
import { escapeHtml, dec1 } from "../format.js";
import { buildingHtml, goLabelHtml, buildingRowClass, BUILDING_LABEL } from "../lineup-stop.js";
import { statusLineHtml, statusToneClass } from "../row-message.js"; // A14: red only for an error
import { settingRowHtml, settingGroupHtml, numberBoxHtml, countNote } from "../lineup-settings.js";
import { cashChipHtml, cashMedianText, unusedCapText, builtInTextCash } from "../lineup-cash.js";
import { lineupTotals, lineupTotalsHtml } from "../lineup-totals.js"; // A11
import { doneNoteHtml } from "../build-notice.js"; // A15: `Build finished.` beside the Build button
import { cardPlayerRowHtml, teamColours } from "../lineup-card.js";
import { optExposureHtml, seatEntries } from "../lineup-exposure.js"; // A10: the one exposure table
import { optNotesHtml, bendsLineHtml } from "../lineup.js";
import { showdownPalette } from "./lineup-look.js";
import { posPillHtml } from "./table.js"; // 👁 2026-10-22: the exposure rows wear the lists' coloured position pill, not the grey classic chip
import { copiesText, gapText, scaleColour, noUniquenessText, sourceLineText } from "./lineup-meter.js";
import { likelyRangeText, likelyFactText } from "./likely-copies.js";
import { calcSentence, modelNote, isEstimate, estimateTitle, estimateLabelHtml } from "./field-explain.js"; // the field model's words (D82)
import { OBJECTIVES, TEAM_OPTIONS, MAX_COUNT, MAX_UNIQUE, effectiveObjective, boardHasTg, cashBasisText, varianceProblem, statusLineText, isLocked, isIncluded, excludeState, exposureTables, sdPlayersOf } from "./optimizer-state.js";
import { filterLineups, bulkLabel, filterBarHtml } from "../lineup-filter.js";
import { LOCK_SVG, rowIconButtonHtml } from "../row-controls.js"; // round 3: Lock, In and Exclude are the same small buttons in classic and Showdown
import { confirmHtml, anchorHtml, REPLACE_QUESTION } from "../confirm-inline.js"; // A13, C11: Load on a result card asks before replacing unsaved slots
import { crossedNoteHtml } from "../limit-cross.js"; // item 18
import { refusalNoteHtml } from "../limit-box.js"; // A3: a refused Min % / Max % text is drawn beside its box until the next press

// Classic's words (lineup-view.js NO_MATCH_TEXT) for a filter no lineup passes.
export const NO_MATCH_TEXT = "No lineups here have all of the chosen players."; // the saved section's too (optimizer.js optimizerSavedFilter)

// The pool's own position chips are gone (2026-10-26, as classic's step 4): the filter bar above the builder (view.js) filters the pool.
const OBJECTIVE_TITLE = { proj: "Build the lineups with the highest total projection", median: "Build the lineups with the highest total of TwoGun's medians" };
const OBJECTIVE_WORD = { proj: "projection", median: "median" };

// ---------- the heading and the settings ----------

/** Projection | Median. Drawn only on a board whose rows carry TwoGun's medians (bandBoxesHtml), where Median is a real second choice;
 *  the pressed one is effectiveObjective's. */
export function objectiveChipsHtml(picked, board) {
  const active = effectiveObjective(picked, board);
  return OBJECTIVES.map((o) => {
    const on = o.value === active;
    return `<button type="button" class="chip toggle-chip opt-chip${on ? " active" : ""}" data-sd-objective="${o.value}" aria-pressed="${on}" title="${escapeHtml(OBJECTIVE_TITLE[o.value])}">${escapeHtml(o.label)}</button>`;
  }).join("");
}

/** The Variance control (GPP tab only; the showdown's one setting, optimizer-state.js): an Off | On switch and a typed percent from 0 to 100 (decimals allowed; blank or 0 sends nothing). The box starts blank and
 *  is off the keyboard while the switch is Off. `variance` = {on, pct}. */
export function varianceRowHtml(variance) {
  const on = variance?.on === true;
  const chip = (value, label) => `<button type="button" class="chip toggle-chip opt-chip${on === (value === "on") ? " active" : ""}" data-sd-variance="${value}" aria-pressed="${on === (value === "on")}">${label}</button>`;
  const bad = Boolean(varianceProblem(variance, "gpp")); // On over a box that is not a percent from 0 to 100: marked, and it blocks Build
  const box = numberBoxHtml(`type="text" inputmode="decimal" maxlength="6" class="opt-input opt-input-num${bad ? " invalid" : ""}" id="sd-opt-variance-pct" value="${escapeHtml(variance?.pct ?? "")}" aria-label="Variance percent"${on ? "" : " disabled"}`, "%");
  return settingRowHtml("Variance", `<span class="opt-chips sd-variance">${chip("off", "Off")}${chip("on", "On")}</span>${box}`, "Blank or 0 is off");
}

function teamSelectHtml(value) {
  const options = TEAM_OPTIONS.map((v) => `<option value="${v}"${String(value) === v ? " selected" : ""}>${v}</option>`).join("");
  return `<select id="sd-opt-max-team" class="opt-input opt-select" aria-label="Max per team">${options}</select>`;
}

/**
 * The Optimizer band in its two pieces (Adam 2026-10-20: "I can't see the main lineup that I'm building"): the head stays at the top
 * of the left column, the Pool and Build boxes sit under the build status line, just above the Make row, so the six slots and the
 * meter are the first thing on screen. bandHtml is the two together (the band's whole markup, in the old order).
 * `v` = {mode, ms, board, error, formError}.
 */
export function bandHtml(v) {
  return bandHeadHtml(v) + bandBoxesHtml(v);
}

/** The GPP and Cash tabs (optimizer standard Part F, Adam 5:12 PM 2026-11-04: separate tabs, each with its own settings, lineup and batch). The classic `.opt-tab` look; the buttons keep `data-opt-mode`, which wireBand reads. */
export function modeTabsHtml(mode) {
  const active = mode === "cash" ? "cash" : "gpp";
  const tab = (value, inner, title) => `<button type="button" role="tab" class="opt-tab sd-opt-tab${active === value ? " active" : ""}" data-opt-mode="${value}" aria-selected="${active === value}" title="${escapeHtml(title)}">${inner}</button>`;
  return `<div class="opt-tabs sd-opt-tabs" role="tablist" aria-label="Lineup type">${tab("gpp", "GPP", "Tournament lineups: this tab's own settings, lineup and lineups")}${tab("cash", `${cashChipHtml()} Cash`, "Cash-game lineups: this tab's own settings, lineup and lineups")}</div>`;
}

/** The head: one line with the tab pair at the top, the title beside it and a refused Make's sentence, then a blocked
 *  Make's sentence. Its own element, #sd-opt-head. */
export function bandHeadHtml(v) {
  return `
    <div class="sd-opt-head" id="sd-opt-head">
      <div class="opt-settings-head sd-opt-tabline">
        ${modeTabsHtml(v.mode)}
        <h3 class="opt-title">Settings</h3>
        ${v.error ? `<span class="${statusToneClass(v.errorTone ?? "error").trim()} opt-go-error">${escapeHtml(v.error)}</span>` : ""}
      </div>
      ${v.formError ? statusLineHtml(v.formError, "warn", "opt-form-error") : ""}
    </div>`;
}

/** A row of the other tab's Build box, drawn invisible in its place: the GPP and Cash settings bands are then the same height, so a tab switch moves nothing below them (A15). No controls, hidden from
 *  the keyboard and screen readers. */
const ghostRowHtml = (label, hint = "") => `<div class="opt-set sd-opt-ghost" aria-hidden="true"><div class="opt-set-main"><span class="opt-set-label">${escapeHtml(label)}</span><span class="opt-set-ctl"></span></div>${hint ? `<div class="opt-set-hint">${escapeHtml(hint)}</div>` : ""}</div>`;
const CAPS_HINT = "Each man's Min % and Max % are on the pool rows: on the FLEX list they set his FLEX share, on the Captain list his Captain share.";

/** The Pool and Build boxes (the included / locked line in Build). Its own element, #sd-opt-panel. */
export function bandBoxesHtml(v) {
  const cash = v.mode === "cash";
  const status = statusLineText(v.ms, v.board, v.seated ?? []);
  const pool = settingRowHtml("Max per team", teamSelectHtml(v.ms.maxPerTeam), "5 = DraftKings' rule: at most 5 men from one team");
  // The included / locked line sits at the foot of the Build box, one line: a long list is cut with an ellipsis and its full text is the hover (A15: adding a man never moves the page). optimizer.js refreshLines rewrites it in place.
  // A15 (round 5): the line keeps its height when it is empty (class is-empty hides its text, not its room), so the first man in does not move the pool and everything under the boxes by a line.
  const lockLine = `<div class="opt-set-hint opt-lockinfo${status ? "" : " is-empty"}" id="sd-opt-lockinfo" title="${escapeHtml(status)}">${escapeHtml(status)}</div>`;
  const countRow = settingRowHtml(
    "Lineups to make",
    numberBoxHtml(`type="number" min="1" max="${MAX_COUNT}" class="opt-input opt-input-num" id="sd-opt-count" value="${escapeHtml(v.ms.count)}" aria-label="How many lineups"`, countNote(v.ms.count), "opt-unit-note"),
    cash ? "The best first, then the next best" : "Around the pool's locks and includes"
  );
  // Cash builds by the board's own reading (board.mode.cashMode): TwoGun's median while TwoGun is this game's only ticked projection source.
  const cashMode = v.board?.mode?.cashMode;
  // A13 (round 3): no Build by line while Projection is the only way a build is made (Cash on a board where TwoGun is not the only source); the median basis still says so.
  // The Build box's rows run two across on a wide window (style.css), and each tab draws the other's rows invisible in their places, so both tabs' bands are the same height.
  const hasMedians = boardHasTg(v.board, "median");
  const build = cash
    ? [
        countRow,
        ghostRowHtml("Min unique players", "Between any two lineups"),
        ...(cashMode === "twogun" ? [settingRowHtml("Build by", `<span class="cash-basis">${escapeHtml(cashBasisText(cashMode))}</span>`, "Fixed in cash: TwoGun is this game's only projection source")] : hasMedians ? [ghostRowHtml("Build by")] : []),
        ghostRowHtml("Variance", "Blank or 0 is off"),
        `<div class="opt-set-hint sd-opt-ghost sd-opt-caps">${CAPS_HINT}</div>`,
        lockLine,
      ].join("")
    : [
        countRow,
        settingRowHtml("Min unique players", numberBoxHtml(`type="number" min="1" max="${MAX_UNIQUE}" class="opt-input opt-input-num" id="sd-opt-min-unique" value="${escapeHtml(v.ms.minUnique)}" aria-label="Minimum unique players between lineups"`), "Between any two lineups"),
        // No Build by control while Projection is the only objective (optimizer standard A13, A21): it shows only on a board whose rows carry TwoGun's medians, where Median is the second.
        ...(hasMedians ? [settingRowHtml("Build by", `<span class="opt-chips">${objectiveChipsHtml(v.ms.objective, v.board)}</span>`)] : []),
        varianceRowHtml(v.variance),
        `<div class="opt-set-hint sd-opt-caps">${CAPS_HINT}</div>`,
        lockLine,
      ].join("");
  return `
    <div class="opt-panel opt-settings sd-opt-panel" id="sd-opt-panel">
      <div class="opt-groups opt-groups-cash">
        ${settingGroupHtml("Pool", pool)}
        ${settingGroupHtml("Build", build, "", "sd-opt-build")}
      </div>
    </div>`;
}

/** The one Build button's words (optimizer standard A13, round 3: Showdown's top Build folded into this one): "Build", "Building..." while out (D15);
 *  the count is in the summary beside it, as classic's. */
export function goLabel(generating) {
  return generating ? BUILDING_LABEL : "Build";
}

/** The Build row (classic optimizerFooterHtml, 👁 V3): the summary and the button, under the settings boxes; not sticky since A15 (round 5). `done`: a build has ended and its
 *  batch is on screen, so `Build finished.` and the link to it sit beside the button. */
export function goRowHtml({ summary, generating: showing, busy, formError, canStop = false, below = false, stopping = false, stopError = "", done = false }) {
  return `
    <div class="opt-footer sd-opt-go${buildingRowClass({ showing, below })}">
      ${formError ? statusLineHtml(formError, "warn", "opt-form-error-footer") : ""}
      <span class="opt-summary" id="sd-opt-summary">${escapeHtml(summary)}</span>
      ${buildingHtml({ showing, canStop, stopId: "sd-opt-stop-btn", stopping, stopError })}
      ${done && !showing ? doneNoteHtml("sd-opt-show-results") : ""}
      <button type="button" id="sd-opt-go-btn" class="lineup-build-btn opt-go opt-go-big"${busy ? " disabled" : ""}>${goLabelHtml({ showing, idle: goLabel(false), busy: goLabel(true) })}</button>
    </div>`;
}

// ---------- the cards ----------

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A GPP card's meter strip, from the lineup's own meter as the server measured it (nothing computed here): expected copies in
 *  the field (in the meter's colour), how many other entries most likely hold it ("likely 0 to 2"), and the gap to the best possible projection. */
export function cardMeterHtml(meter) {
  if (!meter || typeof meter !== "object") return "";
  const none = noUniquenessText(meter);
  const gap = gapText(meter.gapPts, meter.gapPct);
  const gapPart = gap ? `<span>${escapeHtml(gap)} vs best</span>` : "";
  // 🔵 866b0ce B5: a man TwoGun's board has no row for counts 0% (Q8) and his card row reads "(0% own)", so the strip names him.
  const off = offBoardText(meter);
  const offPart = off ? `<span class="sd-card-offboard">${escapeHtml(off)}</span>` : "";
  if (none) return `<div class="sd-card-meter"><span>${escapeHtml(none)}</span>${gapPart}${offPart}</div>`;
  const u = meter.uniqueness;
  // The hover is the field line and, from the field model (D82), the calculation sentence; an estimate label rides the figure when it is one.
  const head = finite(u.field) === null ? "" : `Expected copies in a ${u.field.toLocaleString("en-US")}-lineup field`;
  const rest = [calcSentence(u, meter.bestProj), modelNote(u.model)].filter(Boolean).join(" ");
  const hover = head && rest ? `${head}. ${rest}` : head || rest;
  const field = hover ? ` title="${escapeHtml(hover)}"` : "";
  const est = isEstimate(u.copies) ? estimateLabelHtml(estimateTitle(u.copies, u.model, u.field)) : "";
  const likely = likelyRangeText(u.copies, u.spread);
  const likelyPart = likely ? `<span title="${escapeHtml(likelyFactText(u.copies, u.spread))}">${escapeHtml(likely)}</span>` : "";
  return `<div class="sd-card-meter"><span${field}><b style="color:${scaleColour(u.copies, u.scale)}">${escapeHtml(copiesText(u.copies))}</b> copies${est}</span>${likelyPart}${gapPart}${offPart}</div>`;
}

/** "not on TwoGun's board: A Smith, B Jones" from the lineup's own meter (the server names them only while TwoGun is ticked), else null. */
export function offBoardText(meter) {
  const names = Array.isArray(meter?.ownership?.notOnBoard) ? meter.ownership.notOnBoard.filter((n) => typeof n === "string" && n) : [];
  return names.length ? `not on TwoGun's board: ${names.join(", ")}` : null;
}

/** The board row behind a slot, with the game's key so the row can name the man's opponent (the card shows the bare code, D80 as amended). */
function rowForSlot(board, personId) {
  const row = (board?.rows ?? []).find((r) => String(r.id) === String(personId));
  const g = board?.game;
  if (!row) return null;
  return row.gameId || !g?.away || !g?.home ? row : { ...row, gameId: `${g.away}@${g.home}` };
}

/**
 * One generated card (classic optLineupCardHtml): "Lineup N" or "Cash N", Save (a disabled "Saved ✓" once saved) and Discard, the
 * Captain row first then the five FLEX, each row the classic card row with the price and points of its spot as the server sent
 * them (the Captain's 1.5x), the totals, and on GPP the meter strip. `o` = {cash, basis, objective, busy, saved, board}.
 */
export function cardHtml(lineup, index, o) {
  const palette = showdownPalette(o.board);
  const decor = {
    rowFor: (p) => { const row = rowForSlot(o.board, p.id); return row ? { ...row, ...p, gameId: row.gameId } : p; },
    rolesFor: () => "",
    coloursFor: (team) => teamColours(palette, team),
  };
  const slots = lineup.slots ?? [];
  // A5: the one card row, with the man's real position (the slot's own `pos` can be the seat); A11: the one totals block under the last slot, the batch's own extras after it.
  const rows = slots.map((s) => cardPlayerRowHtml({ id: String(s.personId ?? s.playerId), name: s.name, pos: s.realPos ?? rowForSlot(o.board, s.personId ?? s.playerId)?.pos ?? s.pos, team: s.team, salary: s.salary, proj: s.proj, own: s.own }, s.slot, decor, { posHtml: posPillHtml, bareOpp: true, cls: s.slot === "CPT" ? "sd-cpt-slot" : "" })).join(""); // the slots' and saved cards' one form: the bare opponent code, the amber CPT chip
  const uid = escapeHtml(lineup.uid ?? "");
  const saveBtn = o.saved
    ? `<button type="button" class="saved-lineup-btn opt-saved-btn" disabled>Saved ✓</button>`
    : `<button type="button" class="saved-lineup-btn" data-sd-opt-save="${uid}"${o.busy ? " disabled" : ""}>Save</button>`;
  // One salary on a card: the block's Salary used (the sum of the six rows) is also what the unused-cap chip reads, never the lineup's own `salary` field.
  const figures = lineupTotals(slots.map((s) => ({ salary: s.salary, proj: s.proj, own: s.own })), { cap: 50000 });
  const unusedText = o.cash ? unusedCapText(figures.used) : "";
  const unused = unusedText ? `<span class="cash-unused-chip" title="Salary left under the $50,000 cap">${escapeHtml(unusedText)}</span>` : "";
  const median = o.cash ? cashMedianText({ ...lineup, players: slots }, o.basis) : o.objective === "median" ? (finite(lineup?.median) === null ? "— median" : `${dec1(lineup.median)} median`) : "";
  const totals = lineupTotalsHtml(figures, { cap: 50000, extra: [escapeHtml(median), unused].filter(Boolean).join(" &middot; ") });
  return `
    <div class="opt-card${o.saved ? " opt-card-saved" : ""}" data-uid="${uid}">
      <div class="opt-card-head">
        <span class="opt-card-title">${o.cash ? "Cash" : "Lineup"} ${index + 1}</span>
        <span class="opt-card-actions">
          ${saveBtn}
          ${anchorHtml(`<button type="button" class="saved-lineup-btn" data-sd-opt-load="${uid}"${o.busy ? " disabled" : ""} title="Put this lineup in the builder's seats">Load</button>`, o.confirm === `load:result:${lineup.uid}` ? confirmHtml(REPLACE_QUESTION, { data: `load:result:${lineup.uid}` }) : "", { align: "right" })}
          <button type="button" class="saved-lineup-btn danger" data-sd-opt-discard="${uid}"${o.busy ? " disabled" : ""}>Discard</button>
        </span>
      </div>
      <div class="opt-card-players">${rows}</div>
      ${totals}
      ${o.cash ? "" : cardMeterHtml(lineup.meter)}
    </div>`;
}

// ---------- the batch ----------

/** The words a batch is labelled with (classic builtInText / builtInTextCash): "20 lineups from the last Build (TwoGun's projections, by
 *  median)" when TwoGun is the game's only projection source (boardMode "twogun"; its ownership may come from other files), else
 *  "this game's sources". */
export function batchHeadText(r, n) {
  if (r.mode === "cash") return builtInTextCash(n, r.basis);
  return `${n} lineup${n === 1 ? "" : "s"} from the last Build (${r.boardMode === "twogun" ? "TwoGun's projections" : "this game's sources"}, by ${OBJECTIVE_WORD[r.objective] ?? "projection"})`;
}

/** The source and as-of of the batch's figures (every figure carries its source): "Projections: TwoGun, Oct 19, 6:07 PM ·
 *  Ownership: TwoGun, ...": the meter's halves on GPP (which carry the as-of's kind), else the answer's projection and ownership
 *  (board.figures), else the board's own build time; each half named as the board names it at Make (r.names, figures-label.js halfName). */
export function provenanceText(r) {
  const named = (h) => Boolean(h && (h.source || h.asOf));
  const board = r.boardBuiltAt ? { asOf: r.boardBuiltAt, asOfFrom: "board built" } : null;
  const proj = [r.meter?.projection?.posted ? r.meter.projection : null, r.projection, board].find(named);
  const own = [r.meter?.ownership?.posted ? r.meter.ownership : null, r.ownership?.status === "posted" || (r.ownership && !("status" in r.ownership)) ? r.ownership : null, board].find(named);
  return [proj ? sourceLineText(proj, r.names?.projection, "Projections") : null, own ? sourceLineText(own, r.names?.ownership, "Ownership") : null].filter(Boolean).join(" · ");
}

/** The full source names behind the provenance line, for its hover. */
export function provenanceTitle(r) {
  const names = [r.meter?.projection?.source ?? r.projection?.source, r.meter?.ownership?.source ?? r.ownership?.source].filter((s) => typeof s === "string" && s.trim());
  return [...new Set(names)].join("; ");
}

/** The one exposure table of the cards on screen (A10, lineup-exposure.js optExposureHtml, kind "seats"): a man is one row with a `CPT` column and a `FLEX` column, counted apart and never summed, and a `Seat`
 *  filter. Each seat's figure carries its role-aware key ("cpt:<person>", "flex:<person>"): the key of its Min / Max mark and, when `pick` is given (D77), of the Filter button that filters by him in that
 *  seat. `pick` = {isChosen(key)}. `expState`: {col, dir, filter}. `of`: the number of lineups in the batch when only some are shown (the filter is on), for the subtitle; null otherwise. `noun`: "new" for
 *  the batch, "saved" for the saved lineups (lineup-saved.js), the word before "lineup" in that subtitle. */
export function exposureHtml(lineups, board, expState, marks, pick = null, of = null, noun = "new") {
  const entries = seatEntries(exposureTables(lineups), (person) => rowForSlot(board, person));
  const n = lineups.length;
  const lead = of === null ? `${n} ${noun} lineup${n === 1 ? "" : "s"}` : `${n} of ${of} ${noun} lineup${of === 1 ? "" : "s"}, filtered`;
  return optExposureHtml(entries, expState, "seats", pick, marks, {
    title: "Exposure",
    subtitle: `${lead}; Captain and FLEX counted apart, never summed`,
    posHtml: posPillHtml, // Adam 2026-10-22: the lists' coloured position pill
  });
}

/** The exposure section for a batch under the "only lineups with" filter (D77): the tables recount over the lineups shown, the names
 *  are pick buttons, and the batch's Min / Max marks are left off while the filter hides lineups (classic's rule, they describe
 *  the batch as made). `mustHave` = the chosen role-aware keys. */
export function exposureSectionHtml(r, board, expState, mustHave) {
  const chosen = mustHave ?? [];
  const filtered = chosen.length > 0;
  const shown = filterLineups(r.lineups, chosen, sdPlayersOf).map((e) => e.item);
  const whole = r.lineups.length === r.made;
  const marks = whole && !filtered && r.made >= r.marks.asked ? r.marks : null; // a short, trimmed or filtered batch is not marked
  return exposureHtml(shown, board, expState, marks, { isChosen: (key) => chosen.includes(String(key)) }, filtered ? r.lineups.length : null);
}

/**
 * The results under the Make row: the batch head with Save all / Discard all, the figures' source line, a save refusal, the
 * server's notes as classic shows them, the two exposure tables, the cards, then the bent line. `v` = {results, generating,
 * error, saveError, busy, savedFlags (one per lineup), board, exp (the exposure table's {col, dir, filter}), mustHave (the chosen role-aware keys, D77), mustHaveNames}.
 * While the filter is on only the lineups holding every chosen man show (cards keep their own numbers), the exposure tables count
 * those only, and Save all / Discard all act on them only (classic lineup-view.js newLineupsTabHtml).
 */
export function resultsHtml(v) {
  const r = v.results;
  if (!r) return ""; // while a build shows its message beside Stop (standard D15) the results area is empty: the words show once
  const n = r.lineups.length;
  const parts = [];
  const mustHave = v.mustHave ?? [];
  const filtered = mustHave.length > 0;
  const shown = filterLineups(r.lineups, mustHave, sdPlayersOf);
  const nShown = shown.length;
  const nSaved = v.savedFlags.filter(Boolean).length;
  const allSaved = n > 0 && (filtered ? shown.every((e) => v.savedFlags[e.index]) : nSaved === n);
  const noneShown = filtered && nShown === 0;
  const nShownUnsaved = shown.filter((e) => !v.savedFlags[e.index]).length;
  parts.push(filterBarHtml(mustHave.map((key) => ({ key, name: v.mustHaveNames?.[key] ?? key })), nShown, n));
  parts.push(n
    ? `<div class="opt-results-head">
         <span class="opt-sub">${escapeHtml(batchHeadText(r, n))}${nSaved ? `, ${nSaved} saved` : ", not saved yet"}</span>
         <span class="opt-card-actions">
           <button type="button" class="saved-lineup-btn" data-sd-opt-save-all${v.busy || allSaved || noneShown ? " disabled" : ""}>${bulkLabel("Save", nShownUnsaved, filtered)}</button>
           <button type="button" class="saved-lineup-btn danger" data-sd-opt-discard-all${v.busy || noneShown ? " disabled" : ""}>${bulkLabel("Discard", nShown, filtered)}</button>
         </span>
       </div>`
    : `<div class="opt-sub">${r.made ? "None left from the last Build." : "No lineups were made."}</div>`);
  const prov = provenanceText(r);
  const provTitle = provenanceTitle(r);
  if (prov) parts.push(`<div class="opt-note"${provTitle ? ` title="${escapeHtml(provTitle)}"` : ""}>${escapeHtml(prov)}</div>`);
  if (v.saveError) parts.push(statusLineHtml(v.saveError, v.saveTone ?? "error"));
  parts.push(optNotesHtml(r.notes));
  if (n && !nShown) {
    parts.push(`<div class="saved-lineups-empty">${NO_MATCH_TEXT}</div>`);
  } else if (n) {
    const cash = r.mode === "cash";
    const whole = n === r.made;
    // Adam 2026-10-17 (classic newLineupsTabHtml): the exposure tables above the cards, so they are high on the screen.
    parts.push(exposureSectionHtml(r, v.board, v.exp, mustHave));
    parts.push(`<div class="opt-cards">${shown.map((e) => cardHtml(e.item, e.item.index, { cash, basis: r.basis, objective: r.objective, busy: v.busy, saved: v.savedFlags[e.index], board: v.board, confirm: v.confirm ?? null })).join("")}</div>`);
    if (whole) parts.push(bendsLineHtml(r.bends, r.made));
  }
  return `<div class="opt-results sd-opt-results" id="sd-opt-results">${parts.join("")}</div>`;
}

/**
 * What the Optimizer screen shows where the batch's cards were (Adam 2026-11-05: the cards are on the Lineups tab now; a Build does not move him): one button, `N lineups built: open Lineups`, N the lineups in the
 * newest kept build of this tab's mode; and for a build that made nothing its sentence and the server's notes, since nothing was kept to open. `v` = {results (the tab's last answer), built (N, 0 for none)}.
 */
export function openLineupsHtml(v) {
  const r = v.results;
  const parts = [];
  if (r && r.lineups.length === 0) {
    parts.push(`<div class="opt-sub">No lineups were made.</div>`);
    const prov = provenanceText(r);
    if (prov) parts.push(`<div class="opt-note">${escapeHtml(prov)}</div>`);
    parts.push(optNotesHtml(r.notes));
  }
  if (v.built > 0) parts.push(`<div><button type="button" class="saved-lineup-btn sd-open-lineups" data-action="sd-open-lineups">${v.built} lineup${v.built === 1 ? "" : "s"} built: open Lineups</button></div>`);
  return parts.length ? `<div class="opt-results sd-opt-results" id="sd-opt-results">${parts.join("")}</div>` : "";
}

// ---------- the pool ----------

/** The pool rows a list shows: the rows the lists show today (`shown`: Out men hidden unless Show all players), plus any man locked,
 *  included or excluded (so he can be undone, classic rightColumnHtml's rule), at the chosen position, in board order. */
export function poolRows(all, shown, ms, pos) {
  const marked = new Set([...ms.includes, ...ms.locks, ...ms.excludes]);
  const keep = new Set((shown ?? []).map((r) => String(r.id)));
  return (all ?? []).filter((r) => (keep.has(String(r.id)) || marked.has(String(r.id)) || (r.cptId != null && marked.has(String(r.cptId)))) && (pos === "All" || String(r.pos ?? "").trim().toUpperCase() === pos));
}

/** The selector that finds one Min % / Max % box again in a redrawn pool (limit-box.js keeps a box's text and its refusal by it). */
export const capSelector = (field, id) => `[data-sd-cap="${field}"][data-id="${id}"]`;

/** One row's Min % or Max % box in GPP (`which` "min" or "max"; classic rightRowHtml's cell), for the list's role; "" in Cash. A text the box refused (A3, limit-box.js) shows `Not saved` beside it. */
export function poolCapCell(row, kind, which, ms, mode, parsePct) {
  if (mode !== "gpp") return "";
  const id = String(row.id);
  const cls = which === "min" ? "lineup-min" : "lineup-max";
  const field = `${kind === "cpt" ? "cpt" : "flex"}${which === "min" ? "Min" : "Max"}`;
  const text = ms[field]?.[id] ?? "";
  const bad = Number.isNaN(parsePct(text));
  const seat = kind === "cpt" ? "cpt" : "flex";
  const crossed = which === "max" ? crossedNoteHtml(ms[`${seat}Min`]?.[id] ?? "", text, parsePct) : ""; // item 18: the sentence sits under the Max box
  return `<td class="${cls}-cell"><input type="text" inputmode="decimal" maxlength="5" class="opt-input ${cls}-input${bad ? " invalid" : ""}" data-sd-cap="${field}" data-id="${escapeHtml(id)}" value="${escapeHtml(text)}" aria-label="${kind === "cpt" ? "Captain" : "FLEX"} ${which === "min" ? "Min %" : "Max %"} for ${escapeHtml(row.name ?? "")}" />${refusalNoteHtml(capSelector(field, id))}${crossed}</td>`;
}

/** The padlock beside a locked man's name (C20: a locked row keeps the tint a seated row has and gets this icon): it names its seat, in the hover (`Locked at Captain`,
 *  `Locked at FLEX`, or both) and, when he is locked as Captain, with a small `CPT` beside the padlock (C21); "" when he is not locked. */
export function poolLockIconHtml(row, ms) {
  const cpt = isLocked(ms, row, "cpt");
  const at = [cpt ? "Captain" : "", isLocked(ms, row, "flex") ? "FLEX" : ""].filter(Boolean);
  if (!at.length) return "";
  return `<span class="sd-lock-ico" title="Locked at ${at.join(" and ")} in every lineup" aria-label="Locked at ${at.join(" and ")}">${LOCK_SVG}${cpt ? `<span class="sd-lock-seat">CPT</span>` : ""}</span>`;
}

/** One row's lock, In or exclude button for a role (`action` "lock", "include" or "exclude"), alone: the one pool (2026-10-26) draws In
 *  once and each role's lock and exclude in that role's own cells. */
export function poolButtonHtml(row, kind, action, ms) {
  const id = escapeHtml(String(row.id));
  const role = kind === "cpt" ? "Captain" : "FLEX";
  const ex = excludeState(ms, row, kind);
  const noCpt = kind === "cpt" && row.cptId == null;
  const attrs = `data-sd-opt="${action}" data-kind="${kind}" data-id="${id}"`;
  if (action === "lock") {
    const locked = isLocked(ms, row, kind);
    return rowIconButtonHtml({ kind: "lock", on: locked, title: locked ? `Locked at ${role} in every lineup` : `Lock at ${role} in every lineup`, attrs, disabled: ex.whole || noCpt });
  }
  if (action === "include") {
    const inc = isIncluded(ms, row);
    return rowIconButtonHtml({ kind: "in", on: inc, title: inc ? "Included: in every lineup at Captain or FLEX, the optimizer picks the role" : "Include: in every lineup at Captain or FLEX, the optimizer picks the role", attrs, disabled: ex.whole });
  }
  const exTitle = kind === "cpt" ? (ex.whole ? "Excluded from every lineup (the FLEX exclude)" : ex.on ? "Excluded as Captain; he can still be FLEX" : "Exclude as Captain; he can still be FLEX") : ex.on ? "Excluded from every lineup" : "Exclude from every lineup";
  return rowIconButtonHtml({ kind: "exclude", on: ex.on, title: exTitle, attrs, disabled: (kind === "cpt" && ex.whole) || noCpt });
}

/** The row's look: excluded (dimmed). A lock is not a tint (C20): it is the padlock icon beside the name (poolLockIconHtml). */
export function poolRowClass(row, kind, ms) {
  return excludeState(ms, row, kind).on ? " lineup-row-excluded" : "";
}
