// The Showdown Optimizer's markup (Adam 2026-10-19, sketch A: one screen under the Showdown Optimizer tab, GPP | Cash): the
// heading and the two settings boxes, the Make row, the generated cards with their meter strip, the Captain and FLEX exposure
// tables, the pool's position chips and each pool row's Min % / Max % boxes and lock / In / exclude buttons. Markup only, from
// the classic Optimizer's own helpers and classes (public/js/lineup.js optimizerControlsHtml, cashControlsHtml,
// optimizerFooterHtml, newLineupsTabHtml, optLineupCardHtml, rightRowHtml); optimizer.js owns the state and the requests.
import { escapeHtml, money, dec1 } from "../format.js";
import { settingRowHtml, settingGroupHtml, settingSubtitleHtml, numberBoxHtml } from "../lineup-settings.js";
import { modeSwitchHtml, cashChipHtml, cashTotalsText, unusedCapText, builtInTextCash } from "../lineup-cash.js";
import { cardPlayerRowHtml, teamColours } from "../lineup-card.js";
import { optExposureHtml } from "../lineup-exposure.js";
import { optNotesHtml, bendsLineHtml } from "../lineup.js";
import { showAllToggleHtml } from "../filterbar.js";
import { shownTotal } from "../totals.js";
import { showdownPalette } from "./lineup-look.js";
import { copiesText, gapText, scaleColour, noUniquenessText, sourceLineText } from "./lineup-meter.js";
import { likelyRangeText, likelyFactText } from "./likely-copies.js";
import { OBJECTIVES, TEAM_OPTIONS, MAX_COUNT, MAX_UNIQUE, effectiveObjective, boardHasTg, cashBasisText, statusLineText, isLocked, isIncluded, excludeState, exposureTables } from "./optimizer-state.js";

// The Showdown pool's position chips (D41): the six positions a Showdown board carries, K included and no FLEX chip, as the
// Rankings filter bar's (view.js SD_POSITION_CHIPS), in the classic pool's row with Show all players. Classic's Starred only is
// not drawn: Showdown players cannot be starred, so it could never work (lead's call on 🔵 866b0ce B9); it returns as
// "Favorites only" when they can be.
export const SD_POOL_POSITIONS = Object.freeze(["All", "QB", "RB", "WR", "TE", "K", "DST"]);
const NO_FIGURES_TITLE = { median: "Median needs TwoGun's medians, and this game's board has none (TwoGun is not ticked for its projections on the Sources page, or his file is not posted).", ceil: "Ceiling needs TwoGun's ceilings, and this game's board has none (TwoGun is not ticked for its projections on the Sources page, or his file is not posted)." };
const OBJECTIVE_TITLE = { proj: "Build the lineups with the highest total projection", median: "Build the lineups with the highest total of TwoGun's medians", ceil: "Build the lineups with the highest total of TwoGun's ceilings" };
const OBJECTIVE_WORD = { proj: "projection", median: "median", ceil: "ceiling" };
// The lock button's padlock, drawn in the text colour (the sketch's, approved 2026-10-19).
const LOCK_SVG = `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><rect x="3" y="7" width="10" height="8" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`;

// ---------- the heading and the settings ----------

/** Projection | Median | Ceiling (classic objectiveChipsHtml's shape): Median or Ceiling is greyed when no row of the served
 *  board carries that figure of TwoGun's (optimizer-state.js boardHasTg, as classic's boardHasCeilings), and the build is then by
 *  projection (effectiveObjective), with the reason on hover and one dim "(needs TwoGun's figures)" after the chips. */
export function objectiveChipsHtml(picked, board) {
  const active = effectiveObjective(picked, board);
  const offs = [];
  const chips = OBJECTIVES.map((o) => {
    const off = o.value !== "proj" && !boardHasTg(board, o.value);
    if (off) offs.push(NO_FIGURES_TITLE[o.value]);
    const on = o.value === active;
    const title = off ? NO_FIGURES_TITLE[o.value] : OBJECTIVE_TITLE[o.value];
    return `<button type="button" class="chip toggle-chip opt-chip${on ? " active" : ""}${off ? " is-disabled" : ""}" data-sd-objective="${o.value}" aria-pressed="${on}"${off ? ` aria-disabled="true"` : ""} title="${escapeHtml(title)}">${escapeHtml(o.label)}</button>`;
  }).join("");
  return offs.length ? `${chips}<span class="opt-sub" title="${escapeHtml(offs.join(" "))}">(needs TwoGun's figures)</span>` : chips;
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

/** The head: the heading row (the title, the green $ chip in cash, the GPP | Cash switch, a refused Make's sentence) and a blocked
 *  Make's sentence. Its own element, #sd-opt-head. */
export function bandHeadHtml(v) {
  const cash = v.mode === "cash";
  return `
    <div class="sd-opt-head" id="sd-opt-head">
      <div class="opt-settings-head">
        <h3 class="opt-title">Optimizer${cash ? ` ${cashChipHtml()}` : ""}${modeSwitchHtml(v.mode)}</h3>
        ${v.error ? `<span class="lineup-status-error opt-go-error">${escapeHtml(v.error)}</span>` : ""}
      </div>
      ${v.formError ? `<div class="lineup-status lineup-status-error opt-form-error">${escapeHtml(v.formError)}</div>` : ""}
    </div>`;
}

/** The Pool and Build boxes (the included / locked line in Build). Its own element, #sd-opt-panel. */
export function bandBoxesHtml(v) {
  const cash = v.mode === "cash";
  const status = statusLineText(v.ms, v.board);
  const pool = settingRowHtml("Max per team", teamSelectHtml(v.ms.maxPerTeam), "5 = DraftKings' rule: at most 5 men from one team");
  // The included / locked line is the count row's second hint, inside the Build box as classic's "1 starred QB qualifies" sits
  // in its row (👁 V7: above the boxes it pushed them down); optimizer.js refreshLines rewrites it in place.
  const lockLine = `<div class="opt-set-hint opt-lockinfo" id="sd-opt-lockinfo"${status ? "" : " hidden"}>${escapeHtml(status)}</div>`;
  const countRow = settingRowHtml(
    "Lineups to make",
    numberBoxHtml(`type="number" min="1" max="${MAX_COUNT}" class="opt-input opt-input-num" id="sd-opt-count" value="${escapeHtml(v.ms.count)}" aria-label="How many lineups"`),
    cash ? "The best first, then the next best" : "Around the pool's locks and includes"
  ).replace(/<\/div>$/, `${lockLine}</div>`);
  // Cash builds by the board's own reading (board.mode.cashMode): TwoGun's median while TwoGun is this game's only ticked projection source.
  const cashMode = v.board?.mode?.cashMode;
  const build = cash
    ? [countRow, settingRowHtml("Build by", `<span class="cash-basis">${escapeHtml(cashBasisText(cashMode))}</span>`, cashMode === "twogun" ? "Fixed in cash: TwoGun is this game's only projection source" : "Fixed in cash: TwoGun's median only when he is this game's only projection source")].join("")
    : [
        countRow,
        settingRowHtml("Min unique players", numberBoxHtml(`type="number" min="1" max="${MAX_UNIQUE}" class="opt-input opt-input-num" id="sd-opt-min-unique" value="${escapeHtml(v.ms.minUnique)}" aria-label="Minimum unique players between lineups"`), "Between any two lineups"),
        settingRowHtml("Build by", `<span class="opt-chips">${objectiveChipsHtml(v.ms.objective, v.board)}</span>`),
        settingSubtitleHtml("Max share of lineups"),
        `<div class="opt-set-hint">Each man's Min % and Max % are on the pool rows: the Captain list sets his Captain share, the FLEX list his FLEX share.</div>`,
      ].join("");
  return `
    <div class="opt-panel opt-settings sd-opt-panel" id="sd-opt-panel">
      <div class="opt-groups opt-groups-cash">
        ${settingGroupHtml("Pool", pool)}
        ${settingGroupHtml("Build", build)}
      </div>
    </div>`;
}

/** "Make 20 lineups" ("Making…" while out). */
export function goLabel(count, generating) {
  return generating ? "Making…" : `Make ${count} lineup${count === 1 ? "" : "s"}`;
}

/** The Make row (classic optimizerFooterHtml and its sticky footer, 👁 V3): the summary and the button, the last piece of the builder's column. */
export function goRowHtml({ summary, count, generating, busy, formError }) {
  return `
    <div class="opt-footer sd-opt-go">
      ${formError ? `<div class="lineup-status lineup-status-error opt-form-error-footer">${escapeHtml(formError)}</div>` : ""}
      <span class="opt-summary" id="sd-opt-summary">${escapeHtml(summary)}</span>
      <button type="button" id="sd-opt-go-btn" class="lineup-build-btn opt-go opt-go-big"${busy ? " disabled" : ""}>${escapeHtml(goLabel(count, generating))}</button>
    </div>`;
}

// ---------- the cards ----------

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A GPP card's totals: "$49,400 · 97.4 proj · 102% own", with the build's own total after proj on a median or ceiling build
 *  ("· 91.2 median"). Projection is the sum of the rows as shown (totals.js shownTotal); ownership is each slot's own Captain or
 *  FLEX figure summed (Adam 2026-10-18), a dash when any slot has none; the median / ceiling total is the server's. */
export function gppTotalsText(lineup, objective) {
  const slots = lineup?.slots ?? [];
  const parts = [money(lineup?.salary)];
  const projs = slots.map((s) => s.proj);
  parts.push(projs.length && projs.every((p) => finite(p) !== null) ? `${dec1(shownTotal(projs))} proj` : "— proj (a player has no projection)");
  if (objective === "median" || objective === "ceil") {
    const word = objective === "median" ? "median" : "ceil";
    parts.push(finite(lineup?.[objective]) === null ? `— ${word}` : `${dec1(lineup[objective])} ${word}`);
  }
  const owns = slots.map((s) => s.own);
  parts.push(owns.length && owns.every((o) => finite(o) !== null) ? `${Math.round(owns.reduce((a, b) => a + b, 0))}% own` : "— own");
  return parts.join(" · ");
}

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
  const field = finite(u.field) === null ? "" : ` title="Expected copies in a ${escapeHtml(u.field.toLocaleString("en-US"))}-lineup field"`;
  const likely = likelyRangeText(u.copies);
  const likelyPart = likely ? `<span title="${escapeHtml(likelyFactText(u.copies))}">${escapeHtml(likely)}</span>` : "";
  return `<div class="sd-card-meter"><span${field}><b style="color:${scaleColour(u.copies)}">${escapeHtml(copiesText(u.copies))}</b> copies</span>${likelyPart}${gapPart}${offPart}</div>`;
}

/** "not on TwoGun's board: A Smith, B Jones" from the lineup's own meter (the server names them only while TwoGun is ticked), else null. */
export function offBoardText(meter) {
  const names = Array.isArray(meter?.ownership?.notOnBoard) ? meter.ownership.notOnBoard.filter((n) => typeof n === "string" && n) : [];
  return names.length ? `not on TwoGun's board: ${names.join(", ")}` : null;
}

/** The board row behind a slot, with the game's key so the row says vs or @ (as the player card's showdownRowById does). */
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
  const rows = slots.map((s) => cardPlayerRowHtml({ id: String(s.personId ?? s.playerId), name: s.name, pos: s.pos, team: s.team, salary: s.salary, proj: s.proj, own: s.own }, s.slot, decor)).join("");
  const uid = escapeHtml(lineup.uid ?? "");
  const saveBtn = o.saved
    ? `<button type="button" class="saved-lineup-btn opt-saved-btn" disabled>Saved ✓</button>`
    : `<button type="button" class="saved-lineup-btn" data-sd-opt-save="${uid}"${o.busy ? " disabled" : ""}>Save</button>`;
  const overCap = finite(lineup.salary) !== null && lineup.salary > 50000;
  const totals = o.cash
    ? `<span class="${overCap ? "saved-lineup-totals-over" : ""}">${escapeHtml(cashTotalsText({ ...lineup, players: slots }, o.basis))}</span>${unusedCapText(lineup.salary) ? ` <span class="cash-unused-chip" title="Salary left under the $50,000 cap">${escapeHtml(unusedCapText(lineup.salary))}</span>` : ""}`
    : `<span class="${overCap ? "saved-lineup-totals-over" : ""}">${escapeHtml(gppTotalsText(lineup, o.objective))}</span>`;
  return `
    <div class="opt-card${o.saved ? " opt-card-saved" : ""}" data-uid="${uid}">
      <div class="opt-card-head">
        <span class="opt-card-title">${o.cash ? "Cash" : "Lineup"} ${index + 1}</span>
        <span class="opt-card-actions">
          ${saveBtn}
          <button type="button" class="saved-lineup-btn danger" data-sd-opt-discard="${uid}"${o.busy ? " disabled" : ""}>Discard</button>
        </span>
      </div>
      <div class="opt-card-players">${rows}</div>
      <div class="opt-card-totals">${totals}</div>
      ${o.cash ? "" : cardMeterHtml(lineup.meter)}
    </div>`;
}

// ---------- the batch ----------

/** The words a batch is labelled with (classic builtInText / builtInTextCash): "20 lineups from the last Make (TwoGun only, by median)";
 *  a board reading other sources says "this game's sources". */
export function batchHeadText(r, n) {
  if (r.mode === "cash") return builtInTextCash(n, r.basis).replace("from the last Build", "from the last Make");
  return `${n} lineup${n === 1 ? "" : "s"} from the last Make (${r.boardMode === "twogun" ? "TwoGun only" : "this game's sources"}, by ${OBJECTIVE_WORD[r.objective] ?? "projection"})`;
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

/** The Captain and FLEX exposure tables of the cards on screen, side by side and never summed (lineup-exposure.js optExposureHtml's
 *  Showdown groups, role-aware keys for the Min / Max marks). */
export function exposureHtml(lineups, board, sortDir, marks) {
  const t = exposureTables(lineups);
  const rowsOf = (list) => list.map((e) => ({ ...(rowForSlot(board, e.person) ?? {}), id: e.person, name: e.name, count: e.count, pct: e.pct, own: e.own }));
  const n = lineups.length;
  const subtitle = `${n} new lineup${n === 1 ? "" : "s"}; Captain and FLEX counted apart, never summed`;
  return optExposureHtml(null, subtitle, sortDir, null, marks, {
    title: "Exposure",
    groups: [
      { title: "Captain exposure", rows: rowsOf(t.cpt), keyOf: (r) => `cpt:${r.id}` },
      { title: "FLEX exposure", rows: rowsOf(t.flex), keyOf: (r) => `flex:${r.id}` },
    ],
  });
}

/**
 * The results under the Make row: the batch head with Save all / Discard all, the figures' source line, a save refusal, the
 * server's notes as classic shows them, the two exposure tables, the cards, then the bent line. `v` = {results, generating,
 * error, saveError, busy, savedFlags (one per lineup), board, expSortDir}.
 */
export function resultsHtml(v) {
  const r = v.results;
  if (!r) return v.generating ? `<div class="opt-results sd-opt-results" id="sd-opt-results"><div class="saved-lineups-empty">Making lineups…</div></div>` : "";
  const n = r.lineups.length;
  const parts = [];
  const nSaved = v.savedFlags.filter(Boolean).length;
  parts.push(n
    ? `<div class="opt-results-head">
         <span class="opt-sub">${escapeHtml(batchHeadText(r, n))}${nSaved ? `, ${nSaved} saved` : ", not saved yet"}</span>
         <span class="opt-card-actions">
           <button type="button" class="saved-lineup-btn" data-sd-opt-save-all${v.busy || nSaved === n ? " disabled" : ""}>Save all</button>
           <button type="button" class="saved-lineup-btn danger" data-sd-opt-discard-all${v.busy ? " disabled" : ""}>Discard all</button>
         </span>
       </div>`
    : `<div class="opt-sub">${r.made ? "None left from the last Make." : "No lineups were made."}</div>`);
  const prov = provenanceText(r);
  const provTitle = provenanceTitle(r);
  if (prov) parts.push(`<div class="opt-note"${provTitle ? ` title="${escapeHtml(provTitle)}"` : ""}>${escapeHtml(prov)}</div>`);
  if (v.saveError) parts.push(`<div class="lineup-status lineup-status-error">${escapeHtml(v.saveError)}</div>`);
  parts.push(optNotesHtml(r.notes));
  if (n) {
    const cash = r.mode === "cash";
    const whole = n === r.made;
    const marks = whole && r.made >= r.marks.asked ? r.marks : null; // a short or trimmed batch is not marked (classic's rule)
    // Adam 2026-10-17 (classic newLineupsTabHtml): the exposure tables above the cards, so they are high on the screen.
    parts.push(exposureHtml(r.lineups, v.board, v.expSortDir, marks));
    parts.push(`<div class="opt-cards">${r.lineups.map((l, i) => cardHtml(l, l.index, { cash, basis: r.basis, objective: r.objective, busy: v.busy, saved: v.savedFlags[i], board: v.board })).join("")}</div>`);
    if (whole) parts.push(bendsLineHtml(r.bends, r.made));
  }
  return `<div class="opt-results sd-opt-results" id="sd-opt-results">${parts.join("")}</div>`;
}

// ---------- the pool ----------

/** The position chips row (classic poolPosChipsHtml): All, QB, RB, WR, TE, K, DST, Show all players. */
export function poolChipsHtml(pos, showAll) {
  const chips = SD_POOL_POSITIONS.map((p) => `<button type="button" class="chip pos-chip sd-pos-chip${p === pos ? " active" : ""}" data-sd-pool-pos="${p}" data-pos="${p}">${p}</button>`).join("");
  return `<div class="chip-group lineup-pos-chips">${chips}${showAllToggleHtml(showAll, `data-action="show-all"`)}</div>`;
}

/** The pool rows a list shows: the rows the lists show today (`shown`: Out men hidden unless Show all players), plus any man locked,
 *  included or excluded (so he can be undone, classic rightColumnHtml's rule), at the chosen position, in board order. */
export function poolRows(all, shown, ms, pos) {
  const marked = new Set([...ms.includes, ...ms.locks, ...ms.excludes]);
  const keep = new Set((shown ?? []).map((r) => String(r.id)));
  return (all ?? []).filter((r) => (keep.has(String(r.id)) || marked.has(String(r.id)) || (r.cptId != null && marked.has(String(r.cptId)))) && (pos === "All" || String(r.pos ?? "").trim().toUpperCase() === pos));
}

/** The extra head cells of one list in GPP: Min % and Max % for that role (Cash has none). Both lists head them "Min %" and
 *  "Max %" (👁 V1: "CPT Min %" pushed the Captain table past its box); the toggle and the list's caption name the role, the hover too. */
export function poolHeadCells(kind, mode) {
  if (mode !== "gpp") return "";
  const role = kind === "cpt" ? "Captain" : "FLEX";
  return `<th class="lineup-min-head" title="Fewest of the new lineups he must be in at ${role}; blank = none">Min %</th><th class="lineup-max-head" title="Most of the new lineups he may be in at ${role}; blank = no cap">Max %</th>`;
}

/** One row's Min % and Max % boxes in GPP (classic rightRowHtml's cells), for the list's role. */
export function poolCapCells(row, kind, ms, mode, parsePct) {
  if (mode !== "gpp") return "";
  const id = String(row.id);
  const cell = (field, cls, word) => {
    const text = ms[field]?.[id] ?? "";
    const bad = Number.isNaN(parsePct(text));
    return `<td class="${cls}-cell"><input type="text" inputmode="decimal" maxlength="5" class="opt-input ${cls}-input${bad ? " invalid" : ""}" data-sd-cap="${field}" data-id="${escapeHtml(id)}" value="${escapeHtml(text)}" aria-label="${kind === "cpt" ? "Captain" : "FLEX"} ${word} for ${escapeHtml(row.name ?? "")}" /></td>`;
  };
  return kind === "cpt" ? cell("cptMin", "lineup-min", "Min %") + cell("cptMax", "lineup-max", "Max %") : cell("flexMin", "lineup-min", "Min %") + cell("flexMax", "lineup-max", "Max %");
}

/** One row's lock, In and exclude buttons (Adam 2026-10-19: In sits between lock and exclude). */
export function poolActionButtons(row, kind, ms) {
  const id = escapeHtml(String(row.id));
  const role = kind === "cpt" ? "Captain" : "FLEX";
  const locked = isLocked(ms, row, kind);
  const inc = isIncluded(ms, row);
  const ex = excludeState(ms, row, kind);
  const noCpt = kind === "cpt" && row.cptId == null;
  const btn = (action, on, extraCls, title, inner, disabled) =>
    `<button type="button" class="lineup-row-btn sd-row-ico${extraCls}${on ? " active" : ""}" data-sd-opt="${action}" data-kind="${kind}" data-id="${id}" aria-pressed="${on}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"${disabled ? " disabled" : ""}>${inner}</button>`;
  const lockTitle = locked ? `Locked at ${role} in every lineup` : `Lock at ${role} in every lineup`;
  const inTitle = inc ? "Included: in every lineup at Captain or FLEX, the optimizer picks the role" : "Include: in every lineup at Captain or FLEX, the optimizer picks the role";
  const exTitle = kind === "cpt" ? (ex.whole ? "Excluded from every lineup (the FLEX list's exclude)" : ex.on ? "Excluded as Captain; he can still be FLEX" : "Exclude as Captain; he can still be FLEX") : ex.on ? "Excluded from every lineup" : "Exclude from every lineup";
  return btn("lock", locked, "", lockTitle, LOCK_SVG, ex.whole || noCpt)
    + btn("include", inc, " sd-row-in", inTitle, "In", ex.whole)
    + btn("exclude", ex.on, ex.on ? " danger" : "", exTitle, "&times;", (kind === "cpt" && ex.whole) || noCpt);
}

/** The row's look: excluded (dimmed) over locked (tinted). */
export function poolRowClass(row, kind, ms) {
  if (excludeState(ms, row, kind).on) return " lineup-row-excluded";
  return isLocked(ms, row, kind) ? " lineup-row-locked" : "";
}
