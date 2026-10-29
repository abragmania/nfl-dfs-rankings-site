// The Showdown Optimizer's player pool (Adam 2026-10-26 3:22 PM: "make the optimizer LOOK LIKE THE RANKINGS SCREEN and we don't want the
// rankings screen anymore"; 3:27 PM: integrate the Rankings format's good parts into the Optimizer; D81, the counterpart of classic's
// Optimizer-first step 4, a58538d). ONE table drawn with the retired Rankings tab's columns and cells (table.js: the figures next to the
// names, the hovers, the graded Val, the gold Captain columns and the note cell), with the Optimizer's per-man controls at the row's end.
// Since 4:45 PM 2026-10-29 it has a Captain tab and a FLEX tab (each draws its seat's figures), and a click on a row adds the man to the
// lineup or takes him out (no Add buttons). Under the head, a totals row adds every man's Own FLEX and Own CPT (Adam 3:28 PM), so a bias
// in the ownership figures shows.
// The filter bar above the builder (view.js) writes poolState.filters; poolVisibleRows is the ONE call the pool's body and the bar's
// count both read, so the two always agree. lineup.js owns the lineup and draws this pool in its panel; this file draws, sorts and wires.
import { escapeHtml, dec1 } from "../format.js";
import { rowIsOut } from "../table.js";
import { bumpCeilHtml, CPT_MULT } from "../bump-control.js";
import { shortName, cardNameHtml } from "../lineup-card.js"; // the cards' one name shortener (👁 V-N1: a tagged row's name; 👁 V1: every name on a phone)
import { sdColumns, showdownHeadCellsHtml, showdownRowHtml, shownRows, sdLine, gradedValueHtml } from "./table.js";
import { filterRows, sortRows, sortValue, defaultDirFor, joinWords } from "./board-shape.js";
import { playerFigures } from "./lineup-meter.js";
import { readingShortText, halfName, stampText } from "./figures-label.js";

// ---------- the filter bar's state and the one call ----------

export const DEFAULT_POOL_FILTERS = Object.freeze({ team: "both", pos: "All", minSalary: null, maxSalary: null, minProj: null });
const START_SORT = Object.freeze({ col: "proj", dir: "desc" }); // the Rankings tab's default: projection, highest first

/** The pool's filters (view.js's filter bar writes them), its sort (a header click) and its tab ("flex" or "cpt"; null until first read
 *  from the browser's storage), kept for the page view. */
export const poolState = { sort: { ...START_SORT }, filters: { ...DEFAULT_POOL_FILTERS }, tab: null };

/** Clear filters: every filter back to none (the sort stays, as the Rankings tab's Clear filters left it). */
export function resetPoolFilters() {
  poolState.filters = { ...DEFAULT_POOL_FILTERS };
}

/** Test hook: the start sort, no filters and the tab read afresh. */
export function resetPoolState() {
  poolState.sort = { ...START_SORT };
  poolState.tab = null;
  resetPoolFilters();
}

// The Optimizer's additions (optimizer.js poolControls): {live(), rows(all, shown), capHeads(kind), capCells(row, kind),
// button(row, kind, action) ("lock", "include" or "exclude"), rowClass(row), ceilColumn(board), projCell(row, proj, isCpt), readTab(), writeTab(tab)},
// each optional; none set (or not live) leaves the pool its own rows with no controls.
let controls = null;
export function setPoolControls(next) {
  controls = next && typeof next === "object" ? next : null;
}

// ---------- the Captain | FLEX tabs (Adam 4:45 PM 2026-10-29; D39, D81) ----------

/** The two lists of the pool, Captain and FLEX (Adam: "a CPTN list and a FLEX list ... separated with a tab thingy"). */
export const POOL_TABS = Object.freeze([Object.freeze({ key: "cpt", label: "Captain" }), Object.freeze({ key: "flex", label: "FLEX" })]);

// The columns each tab draws, by SD_COLUMNS / SD_CEIL_COLUMNS key: FLEX the FLEX-seat figures, Captain the Captain-seat ones (one Val for both: the
// Captain's price and points are both 1.5x, so his value is the FLEX value, table.js).
const TAB_COLUMNS = Object.freeze({
  flex: new Set(["player", "salary", "proj", "tgCeil", "value", "ownFlex", "levFlex", "note"]),
  cpt: new Set(["player", "cptSalary", "cptProj", "tgCeilCpt", "value", "ownCpt", "levCpt", "note"]),
});
// A sort on one tab's column moves to the other tab's twin of it when the tab changes, so "highest projection first" survives the switch.
const TWIN_COLUMNS = Object.freeze({ salary: "cptSalary", proj: "cptProj", tgCeil: "tgCeilCpt", ownFlex: "ownCpt", levFlex: "levCpt" });
const twinOf = (col) => TWIN_COLUMNS[col] ?? Object.keys(TWIN_COLUMNS).find((k) => TWIN_COLUMNS[k] === col) ?? col;

/** The tab on screen: "flex" unless the browser remembered "cpt" (controls.readTab; the choice never goes to the server). */
export function poolTab() {
  if (poolState.tab !== "flex" && poolState.tab !== "cpt") poolState.tab = controls?.readTab?.() === "cpt" ? "cpt" : "flex";
  return poolState.tab;
}

/** Switches the tab, keeps it in the browser and moves the sort to the twin column; false when it was the tab already. */
export function setPoolTab(tab) {
  const next = tab === "cpt" ? "cpt" : "flex";
  if (next === poolTab()) return false;
  poolState.tab = next;
  poolState.sort = { ...poolState.sort, col: twinOf(poolState.sort.col) };
  controls?.writeTab?.(next);
  return true;
}

const startSortFor = (tab) => ({ ...START_SORT, col: tab === "cpt" ? "cptProj" : START_SORT.col });

// ---------- a click on a row (Adam 4:45 PM 2026-10-29: "if I click a player's row he goes into the lineup, if I click it again he's out") ----------

/** What a click on his row does on `tab`, from what lineup.js keeps placed ({ cptId, flexIds }): "add-flex" or "remove-flex" or, for the
 *  Captain, "move-to-flex" on the FLEX tab; "add-cpt" (a FLEX man moves up, another Captain is replaced) or "remove-cpt" on the Captain tab. Pure. */
export function poolPickAction(placement, id, tab) {
  const key = String(id);
  const isCaptain = String(placement?.cptId ?? "") === key;
  if (tab === "cpt") return isCaptain ? "remove-cpt" : "add-cpt";
  if (isCaptain) return "move-to-flex";
  return (placement?.flexIds ?? new Set()).has(key) ? "remove-flex" : "add-flex";
}

const PICK_TITLES = Object.freeze({
  "add-flex": "Click to add to FLEX",
  "remove-flex": "Click to remove",
  "move-to-flex": "Click to move to FLEX",
  "add-cpt": "Click to make Captain",
  "remove-cpt": "Click to remove as Captain",
});

/** A click inside one of these is that control's own (the ± bump, a Min / Max box, lock, In, exclude, the name's card popup) or the padding
 *  around it, not a pick (lineup.js passes it to the shared pick-rows.js wirePickRows). */
export const POOL_PICK_SKIP = "button, a, input, select, textarea, label, .player-name, .bump-ctl, .sd-pool-btn, .sd-pool-in, .lineup-min-cell, .lineup-max-cell";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A man's ceiling as the pool shows it: TwoGun's (row.tg.ceil), 0 for a man listed out (as the engine scores him, objective.js
 *  ceilingOf); null when the board has none for him. */
export function poolCeil(row) {
  const c = num(row?.tg?.ceil);
  return c === null ? null : rowIsOut(row) ? 0 : c;
}

/** His Captain ceiling as the CPT Ceil column shows it: 1.5x poolCeil (🔵 R1); null stays null. */
export function poolCeilCpt(row) {
  const c = poolCeil(row);
  return c === null ? null : c * CPT_MULT;
}

/** The browser's copy of server/rank/value-core.js valueOf (the browser cannot import server files; the pool's own test file holds the
 *  two identical): projection per $1,000 of salary, null when either is missing. */
export function valuePer1k(proj, salary) {
  if (proj === null || proj === undefined || proj === "") return null;
  const p = Number(proj);
  const s = Number(salary);
  if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0) return null;
  return p / (s / 1000);
}

/** His Val as the pool shows it (🔵 R5): the FLEX projection the Proj cell shows per $1,000 of his FLEX salary. */
export function poolValue(row, figures = playerFigures) {
  return valuePer1k(num(figures(row, false).proj), row?.salary);
}

/** The Val cell: poolValue, wearing the board's grade (D33) only while the board's value and the shown one agree (a modes answer's
 *  projection can differ from the row's, and then the board's grade no longer describes the figure). */
export function poolValueHtml(row, figures = playerFigures) {
  const v = poolValue(row, figures);
  const board = num(row?.value);
  const agree = v !== null && board !== null && Math.abs(board - v) < 1e-6;
  return gradedValueHtml({ value: v, valueGrade: agree ? row.valueGrade ?? null : null });
}

/** The value a column sorts by: the figure its cell shows (figures(row, isCpt), the slots' own) for Proj, CPT proj, Own FLEX, Own CPT
 *  and Val, the ceilings for Ceil and CPT Ceil, the board row's for the rest (board-shape.js sortValue). */
export function poolSortValue(row, col, figures = playerFigures) {
  if (col === "proj") return num(figures(row, false).proj);
  if (col === "cptProj") return num(figures(row, true).proj);
  if (col === "ownFlex") return num(figures(row, false).own);
  if (col === "ownCpt") return num(figures(row, true).own);
  if (col === "value") return poolValue(row, figures);
  if (col === "tgCeil") return poolCeil(row);
  if (col === "tgCeilCpt") return poolCeilCpt(row);
  return sortValue(row, col);
}

/** The sort a header click leaves (the Rankings tab's onSortClick): the same column flips, another starts in its natural direction. */
export function nextPoolSort(sort, col) {
  return sort.col === col ? { col, dir: sort.dir === "asc" ? "desc" : "asc" } : { col, dir: defaultDirFor(col) };
}

/** The sort the pool draws with for `board`: a sort left on a column the tab does not draw (Ceil once the board no longer carries a
 *  ceiling or the app is not live, or the other tab's column) goes back to the tab's start sort, and the kept sort with it, so the next
 *  click starts from there (the old lists' rule). */
export function poolSort(board) {
  if (!poolColumns(board).some((c) => c.key === poolState.sort.col)) poolState.sort = startSortFor(poolTab());
  return poolState.sort;
}

/**
 * THE rows the pool shows, in order, and so the filter bar's count: the board's rows (Out men hidden unless Show all players), plus on the
 * live app any man locked, included or excluded (so he can be undone, classic's rule), through the filter bar's filters (team, position,
 * FLEX salary range, Min FLEX pts on the FLEX projection the Proj cell shows; board-shape.js filterRows), sorted by the pool's sort on the
 * figures the cells show.
 */
export function poolVisibleRows(board, { filters = poolState.filters, sort = poolSort(board), figures = playerFigures } = {}) {
  const all = board?.rows ?? [];
  const shown = shownRows(all);
  const base = controls?.rows ? controls.rows(all, shown) : shown;
  return sortRows(filterRows(base, filters, board?.game, (r) => num(figures(r, false).proj)), sort.col, sort.dir, (r, c) => poolSortValue(r, c, figures));
}

/** The filter bar's count: "49 of 55 players". */
export function poolCountText(shown, total) {
  return `${shown} of ${total} player${total === 1 ? "" : "s"}`;
}

// ---------- the ownership totals (Adam 2026-10-26 3:28 PM) ----------

/** The seats a lineup has: five FLEX and one Captain, so the field's FLEX ownership adds to 500% and its Captain ownership to 100%. */
export const OWN_EXPECTED = Object.freeze({ flex: 500, cpt: 100 });

/** "+12.4 over", "−8.0 under" (a real minus sign), or "on the mark" when the difference rounds to 0.0. */
export function ownDiffText(diff) {
  const r = Math.round(diff * 10) / 10;
  if (r === 0) return "on the mark";
  return r > 0 ? `+${r.toFixed(1)} over` : `−${(-r).toFixed(1)} under`;
}

/**
 * The totals row's figures over `rows` (the whole board, never the filtered rows): for FLEX and Captain the sum of every man's figure
 * (row.ownFlex / row.ownCpt, the figures every Showdown screen shows), how many men have none (missing, left out of the sum, never 0),
 * the expected sum, the difference and its words. A side where every man is blank has no sum (null) and no difference. Pure.
 */
export function ownTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const side = (key, expected) => {
    let sum = 0;
    let missing = 0;
    for (const r of list) {
      const v = num(r?.[key]);
      if (v === null) missing++;
      else sum += v;
    }
    if (list.length === 0 || missing === list.length) return { sum: null, expected, missing, diff: null, diffText: "" };
    const diff = sum - expected;
    return { sum, expected, missing, diff, diffText: ownDiffText(diff) };
  };
  return { players: list.length, flex: side("ownFlex", OWN_EXPECTED.flex), cpt: side("ownCpt", OWN_EXPECTED.cpt) };
}

/** The totals row's label: "Own total, all 55 players · 3 blank" (each side's count when they differ; "none blank" when none is). */
export function ownTotalsLabel(t) {
  const b = " blank"; // a no-break space: "1 blank" never splits across lines (👁 V5)
  const blanks = t.flex.missing === t.cpt.missing
    ? (t.flex.missing ? `${t.flex.missing}${b}` : `none${b}`)
    : `FLEX ${t.flex.missing}${b}, CPT ${t.cpt.missing}${b}`;
  return `Own total, all ${t.players} player${t.players === 1 ? "" : "s"} · ${blanks}`;
}

function ownTotalCellHtml(s, role, seats, gold) {
  if (s.sum === null) return `<th class="sd-own-total${gold ? " sd-cpt-col" : ""}" title="No man on the board has a ${role} ownership figure.">—</th>`;
  const title = `Every man's ${role} ownership on the board adds to ${dec1(s.sum)}%; ${seats} make ${s.expected}%, so it is ${s.diffText}.${s.missing ? ` ${s.missing} with no ${role} figure are left out of the sum.` : ""}`;
  const cls = s.diff > 0.05 ? " is-over" : s.diff < -0.05 ? " is-under" : "";
  return `<th class="sd-own-total${gold ? " sd-cpt-col" : ""}" title="${escapeHtml(title)}">${dec1(s.sum)}%<span class="sd-own-diff${cls}">${escapeHtml(s.diffText)}</span></th>`;
}

/** The totals row under the head: the label in the Player column, the two sums under Own FLEX and Own CPT, the rest blank. */
export function ownTotalsRowHtml(t, cols, tailCount = 0) {
  const cells = cols.map((c) => {
    if (c.key === "player") return `<th class="sd-own-total-label">${escapeHtml(ownTotalsLabel(t))}</th>`;
    if (c.key === "ownFlex") return ownTotalCellHtml(t.flex, "FLEX", "five FLEX seats", false);
    if (c.key === "ownCpt") return ownTotalCellHtml(t.cpt, "Captain", "one Captain seat", true);
    return "<th></th>";
  }).join("");
  return `<tr class="sd-own-total-row">${cells}${tailCount ? `<th colspan="${tailCount}"></th>` : ""}</tr>`;
}

// ---------- the markup ----------

const live = () => controls?.live?.() === true;
const withCeil = (board) => controls?.ceilColumn?.(board) === true;

/** The pool's columns on `tab`: the Rankings tab's columns of that seat (TAB_COLUMNS), with Ceil while the Optimizer says the board
 *  carries TwoGun's ceilings. */
export function poolColumns(board, tab = poolTab()) {
  return sdColumns(withCeil(board)).filter((c) => TAB_COLUMNS[tab].has(c.key));
}

const thCount = (html) => (html.match(/<th\b/g) ?? []).length;

/** One role's control group in the head (2026-10-26, Phase B item 2): a spanning head ("FLEX", or "Captain" in gold) over its sub-heads,
 *  Min % and Max % (GPP, live app) and Lock and Excl (live app), in the order of the row's cells (tailCellsHtml); none off the live app. */
function groupHeads(kind) {
  const cpt = kind === "cpt";
  const role = cpt ? "Captain" : "FLEX";
  const g = cpt ? " sd-cpt-col" : "";
  const buttons = live()
    ? `<th class="sd-pool-sub${g}" title="Lock him at ${role} in every lineup">Lock</th><th class="sd-pool-sub${g}" title="${cpt ? "Exclude him as Captain; he can still be FLEX" : "Exclude him from every lineup"}">Excl</th>`
    : "";
  const subs = `${controls?.capHeads?.(kind) ?? ""}${buttons}`;
  return { top: subs ? `<th class="sd-pool-group${g}" colspan="${thCount(subs)}">${role}</th>` : "", subs };
}

/** The tail of the head after Notes: In (live app, spanning both head rows), then the tab's own control group. */
function tailHeads(tab) {
  const inHead = live() ? `<th class="sd-pool-in-head" rowspan="2" title="In: in every lineup at Captain or FLEX, the optimizer picks the role">In</th>` : "";
  const group = groupHeads(tab);
  return { top: `${inHead}${group.top}`, subs: group.subs, count: (inHead ? 1 : 0) + thCount(group.subs) };
}

/** The head: the sortable Rankings heads (spanning both rows) and the tab's control group over its sub-heads (one row when there are
 *  none), then the ownership totals row (over the whole board). */
export function poolHeadHtml(board, sort = poolSort(board), tab = poolTab()) {
  const cols = poolColumns(board, tab);
  const tail = tailHeads(tab);
  const two = tail.count > 0;
  const subRow = two ? `<tr class="sd-pool-subhead">${tail.subs}</tr>` : "";
  return `<tr>${showdownHeadCellsHtml(sort, cols, { rowspan: two ? 2 : 1 })}${tail.top}</tr>${subRow}${ownTotalsRowHtml(ownTotals(board?.rows ?? []), cols, tail.count)}`;
}

/** Whether he sits in the seat `tab` lists (the Captain on the Captain tab, a FLEX man on the FLEX tab); lineup.js keeps the placement
 *  as { cptId, flexIds } (strings). */
function placedOnTab(placement, id, tab) {
  return tab === "cpt" ? String(placement?.cptId ?? "") === id : (placement?.flexIds ?? new Set()).has(id);
}

/** The cells after Notes for one row, under the head's group: In, then the tab's role: the Min % / Max % boxes, the lock and the exclude,
 *  each in its own cell. */
function tailCellsHtml(row, tab) {
  const btn = (action) => `<td class="sd-pool-btn">${controls?.button?.(row, tab, action) ?? ""}</td>`;
  const group = `${controls?.capCells?.(row, tab) ?? ""}${live() ? btn("lock") + btn("exclude") : ""}`;
  return `${live() ? `<td class="sd-pool-in">${controls?.button?.(row, "flex", "include") ?? ""}</td>` : ""}${group}`;
}

/** A row's click attributes (D39): the pick its click makes, a keyboard stop and its words as the hover and the label (no button role:
 *  the row holds buttons of its own). */
function pickAttrsHtml(placement, row, tab) {
  const action = poolPickAction(placement, String(row.id), tab);
  return ` data-pick="${action}" tabindex="0" title="${PICK_TITLES[action]}" aria-label="${PICK_TITLES[action]}"`;
}

/** The body rows (`rows`: poolVisibleRows), each the Rankings row with the slots' figures, the ± bump, the Ceil cell and the tab's tail;
 *  a click on a row picks or drops him (poolPickAction). */
export function poolBodyHtml(board, rows, placement, figures = playerFigures, tab = poolTab()) {
  const cols = poolColumns(board, tab);
  if (!rows.length) {
    const span = cols.length + tailHeads(tab).count;
    return `<tr class="sd-pool-empty-row"><td class="sd-pool-empty" colspan="${span}">No player matches these filters.</td></tr>`;
  }
  const hooks = {
    figures,
    projCell: controls?.projCell ? (row, proj, isCpt) => controls.projCell(row, proj, isCpt) : null,
    // The Player cell names him in full and, for a phone, the cards' short name too (style.css shows one; 👁 V1: no name cut mid-word).
    playerCell: (row) => `<div class="player-cell">${sdLine(row, { nameHtml: cardNameHtml(row) })}</div>`,
    ceilCell: (row, isCpt) => bumpCeilHtml(row, isCpt ? poolCeilCpt(row) : poolCeil(row), { kind: isCpt ? "cpt" : null, out: rowIsOut(row) }),
    valueCell: (row) => poolValueHtml(row, figures),
    // A man placed in this tab's seat has his row tinted (the builder's), beside the Optimizer's own look (excluded, locked), each class once.
    rowClass: (row) => [...new Set([placedOnTab(placement, String(row.id), tab) ? "lineup-row-locked" : "", "sd-pool-pick", ...String(controls?.rowClass?.(row) ?? "").trim().split(/\s+/)].filter(Boolean))].join(" "),
    rowAttrs: (row) => pickAttrsHtml(placement, row, tab),
    tail: (row) => tailCellsHtml(row, tab),
  };
  return rows.map((r) => showdownRowHtml(r, hooks, cols)).join("");
}

/** The words beside the heading: the board's reading in a few words ("Figures: TwoGun only"); "" for a board with no figures. */
export function poolNoteText(board) {
  const reading = readingShortText(board, ", ");
  return reading ? `Figures: ${reading}` : "";
}

const HOVER_WORDS = "hover any Proj or Own cell for exactly how that number was made";

// One half's words in the legend (🔵 R2): figures-label.js halfName's "none ticked" and "none for this game" become clauses of their own
// ("no ownership source ticked"), never "own from none ticked"; `what` names the half ("projection", "ownership", "FLEX ownership").
function halfClause(what, text) {
  if (text === "none ticked") return `no ${what} source ticked`;
  if (text === "none for this game") return `no ${what} figures for this game`;
  return `${what === "projection" ? "proj" : what === "ownership" ? "own" : what} from ${text}`;
}

/** The legend's sentence for the two halves (halfName's words): "Proj and own from TwoGun" when they name the same sources, else the
 *  projection clause and the ownership clause, a FLEX / Captain split read as one clause ("FLEX ownership from A and Captain ownership from B"). */
export function figuresSentence(proj, own) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  if (proj === own && !/^none /.test(proj)) return `Proj and own from ${proj}`;
  const split = /^FLEX (.+); CPT (.+)$/.exec(own);
  const ownClause = split ? `${halfClause("FLEX ownership", split[1])} and ${halfClause("Captain ownership", split[2])}` : halfClause("ownership", own);
  return `${cap(halfClause("projection", proj))}; ${ownClause}`;
}

/**
 * The line under the table (moved from the retired Rankings tab, D40): the sources that fed the numbers, read off the board, never a
 * fixed sentence. A board that names its reading (board.figures and board.mode.ticked, the figures label's facts: figures-label.js
 * halfName and stampText) is named from them with their as-of, so a TwoGun board reads "Proj and own from TwoGun" (Phase B item 1: the
 * old sentence said no source had published ownership while the pool showed his figures). A board without them (an older one, the dev
 * sample) keeps the old sentence: R85, only the sources in board.ownershipUsedIds fed the numbers (a set-aside source is not named); an
 * older board without the list names them all.
 */
export function poolLegendText(board) {
  const proj = halfName(board, "projection");
  const own = halfName(board, "ownership");
  if (proj !== null && own !== null) {
    const stamp = stampText(board.figures);
    return `${figuresSentence(proj, own)}${stamp ? ` (as of ${stamp})` : ""}. A dash means no figure · ${HOVER_WORDS}`;
  }
  const sources = board?.sources ?? [];
  const projLabels = joinWords(sources.filter((s) => s.kind === "projection").map((s) => s.label));
  const hasKickerCard = sources.some((s) => s.kind === "kicker");
  const ownSources = board?.ownershipSources ?? [];
  const usedIds = board?.ownershipUsedIds;
  const usedOwn = Array.isArray(usedIds) ? ownSources.filter((s) => usedIds.includes(s.id)) : ownSources;
  const ownLabels = joinWords(usedOwn.map((s) => s.label));
  const projText = projLabels ? `Proj from ${projLabels}${hasKickerCard ? " (kickers as consolidated)" : ""}` : "";
  const ownText = ownLabels
    ? `Own from ${ownLabels}; a dash where nobody has published one`
    : ownSources.some((s) => (s.rows ?? []).length) ? "Own: no source in use names enough of the main players" : "Own: no source has published showdown ownership yet";
  const sourceSentence = [projText, ownText].filter(Boolean).join("; ");
  return [sourceSentence, HOVER_WORDS].filter(Boolean).join(" · ");
}

/** The Captain | FLEX switch beside the heading: the Sources page's Players switch (sources-page-html.js playersHeadHtml, the .sp-seg
 *  rules), the tab on screen marked active. */
export function poolTabsHtml(active = poolTab()) {
  const btns = POOL_TABS.map((t) => `<button type="button" class="sp-seg-btn${t.key === active ? " active" : ""}" data-pool-tab="${t.key}" aria-pressed="${t.key === active}">${t.label}</button>`).join("");
  return `<span class="sp-seg sd-pool-tabs" role="group" aria-label="Player pool list">${btns}</span>`;
}

/** The whole pool: heading and figures words, the table in its scroll panel (sized by scroll-panels.js, Expand by expand.js), the legend.
 *  `rows`: poolVisibleRows(board), computed once by the caller so the filter bar's count reads the same list. */
export function poolHtml(board, placement, rows) {
  return `
    <section id="sd-pool" class="sd-pool">
      <div class="sd-pool-head">
        <h3 class="lineup-right-title">Player pool</h3>
        ${poolTabsHtml()}
        <span class="sd-pool-note">${escapeHtml(poolNoteText(board))}</span>
      </div>
      <div class="table-wrap scroll-panel">
        <table id="sd-table" class="sd-pool-table">
          <thead id="sd-thead">${poolHeadHtml(board)}</thead>
          <tbody id="sd-tbody">${poolBodyHtml(board, rows, placement)}</tbody>
        </table>
      </div>
      <div id="sd-legend" class="table-legend">${escapeHtml(poolLegendText(board))}</div>
    </section>`;
}

// ---------- wiring ----------

/**
 * Wires the drawn pool (`poolEl`, #sd-pool): a header click sorts it (only its head and body are redrawn, through ctx.repaint), and each
 * name carries its whole self on hover, a tagged row showing the cards' short name. ctx = { board, repaint() }. The rows' click
 * (pick-rows.js wirePickRows, with POOL_PICK_SKIP) and the Optimizer's row controls are lineup.js's to wire.
 */
export function wirePool(poolEl, ctx) {
  poolEl.querySelectorAll("th[data-col]").forEach((th) => {
    th.addEventListener("click", () => {
      poolState.sort = nextPoolSort(poolState.sort, th.dataset.col);
      ctx.repaint();
    });
  });
  const rowOf = (id) => (ctx.board?.rows ?? []).find((r) => String(r.id) === String(id));
  poolEl.querySelectorAll("tr[data-id]").forEach((tr) => {
    const n = tr.querySelector?.(".player-name");
    if (!n) return;
    const full = rowOf(tr.dataset.id)?.name ?? (n.title || n.textContent); // the row's name: the cell holds both the full and the short name
    n.title = full;
    if (tr.querySelector(".out-tag, .status-badge")) n.textContent = shortName(full, rowOf(tr.dataset.id)?.pos);
  });
}

/** Wires the Captain | FLEX switch once per full draw (it lives outside the head and body a repaint replaces): a click picks the tab,
 *  marks the buttons and repaints the pool (ctx.repaint). */
export function wirePoolTabs(poolEl, ctx) {
  const buttons = [...poolEl.querySelectorAll("[data-pool-tab]")];
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!setPoolTab(btn.dataset.poolTab)) return;
      buttons.forEach((b) => {
        const on = b.dataset.poolTab === poolTab();
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      ctx.repaint();
    });
  });
}

/**
 * Redraws the pool's head and body in place (a filter, a sort, a lock or the modes answer's notes), keeping its scroll box and its
 * place. ctx = { board, placement(), repaint(), onRepaint?(poolEl), onCount?(shown, total) }. Returns the rows shown, or null when no
 * pool is drawn.
 */
export function paintPool(container, ctx) {
  const pool = container?.querySelector?.("#sd-pool");
  const head = pool?.querySelector?.("thead");
  const body = pool?.querySelector?.("tbody");
  if (!pool || !head || !body) return null;
  const rows = poolVisibleRows(ctx.board);
  head.innerHTML = poolHeadHtml(ctx.board);
  body.innerHTML = poolBodyHtml(ctx.board, rows, ctx.placement());
  const note = pool.querySelector(".sd-pool-note");
  if (note) note.textContent = poolNoteText(ctx.board);
  wirePool(pool, ctx);
  ctx.onRepaint?.(pool);
  ctx.onCount?.(rows.length, (ctx.board?.rows ?? []).length);
  return rows;
}
