// The Showdown Optimizer's player pool (Adam 2026-10-26 3:22 PM: "make the optimizer LOOK LIKE THE RANKINGS SCREEN and we don't want the
// rankings screen anymore"; 3:27 PM: integrate the Rankings format's good parts into the Optimizer; D81, the counterpart of classic's
// Optimizer-first step 4, a58538d). ONE table drawn with the retired Rankings tab's columns and cells (table.js: the figures next to the
// names, the hovers, the graded Val, the gold Captain columns and the note cell), with the Optimizer's per-man controls and the builder's
// Add FLEX / Add CPT at the row's end, so the old Captain | FLEX toggle and its two lists are gone: each row carries both roles. Under
// the head, a totals row adds every man's Own FLEX and Own CPT (Adam 3:28 PM), so a bias in the ownership figures shows.
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

/** The pool's filters (view.js's filter bar writes them) and its sort (a header click), kept for the page view. */
export const poolState = { sort: { ...START_SORT }, filters: { ...DEFAULT_POOL_FILTERS } };

/** Clear filters: every filter back to none (the sort stays, as the Rankings tab's Clear filters left it). */
export function resetPoolFilters() {
  poolState.filters = { ...DEFAULT_POOL_FILTERS };
}

/** Test hook: the start sort and no filters. */
export function resetPoolState() {
  poolState.sort = { ...START_SORT };
  resetPoolFilters();
}

// The Optimizer's additions (optimizer.js poolControls): {live(), rows(all, shown), capHeads(kind), capCells(row, kind),
// button(row, kind, action) ("lock", "include" or "exclude"), rowClass(row), ceilColumn(board), projCell(row, proj)}, each optional; none set (or not live)
// leaves the pool its own rows with the two Add buttons.
let controls = null;
export function setPoolControls(next) {
  controls = next && typeof next === "object" ? next : null;
}

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

/** The sort the pool draws with for `board`: a sort left on Ceil goes back to the start sort once the column is gone (the board no longer
 *  carries a ceiling, or the app is not live), and the kept sort with it, so the next click starts from there (the old lists' rule). */
export function poolSort(board) {
  if ((poolState.sort.col === "tgCeil" || poolState.sort.col === "tgCeilCpt") && controls?.ceilColumn?.(board) !== true) poolState.sort = { ...START_SORT };
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

/** The pool's columns: the Rankings tab's, with Ceil while the Optimizer says the board carries TwoGun's ceilings. */
export function poolColumns(board) {
  return sdColumns(withCeil(board));
}

const thCount = (html) => (html.match(/<th\b/g) ?? []).length;

/** One role's control group in the head (2026-10-26, Phase B item 2): a spanning head ("FLEX", or "Captain" in gold) over its sub-heads,
 *  Min % and Max % (GPP, live app), Lock and Excl (live app) and Add, in the order of the row's cells (tailCellsHtml). */
function groupHeads(kind) {
  const cpt = kind === "cpt";
  const role = cpt ? "Captain" : "FLEX";
  const g = cpt ? " sd-cpt-col" : "";
  const buttons = live()
    ? `<th class="sd-pool-sub${g}" title="Lock him at ${role} in every lineup">Lock</th><th class="sd-pool-sub${g}" title="${cpt ? "Exclude him as Captain; he can still be FLEX" : "Exclude him from every lineup"}">Excl</th>`
    : "";
  const subs = `${controls?.capHeads?.(kind) ?? ""}${buttons}<th class="sd-pool-sub${g}" title="Put him in ${cpt ? "the Captain slot" : "the next open FLEX slot"}">Add</th>`;
  return { top: `<th class="sd-pool-group${g}" colspan="${thCount(subs)}">${role}</th>`, subs };
}

/** The tail of the head after Notes: In (live app, spanning both head rows), then the FLEX group and the Captain group. */
function tailHeads() {
  const inHead = live() ? `<th class="sd-pool-in-head" rowspan="2" title="In: in every lineup at Captain or FLEX, the optimizer picks the role">In</th>` : "";
  const flex = groupHeads("flex");
  const cpt = groupHeads("cpt");
  return { top: `${inHead}${flex.top}${cpt.top}`, subs: `${flex.subs}${cpt.subs}`, count: (inHead ? 1 : 0) + thCount(flex.subs) + thCount(cpt.subs) };
}

/** The head: the sortable Rankings heads (spanning both rows) and the control groups over their sub-heads, then the ownership totals
 *  row (over the whole board). */
export function poolHeadHtml(board, sort = poolSort(board)) {
  const cols = poolColumns(board);
  const tail = tailHeads();
  return `<tr>${showdownHeadCellsHtml(sort, cols, { rowspan: 2 })}${tail.top}</tr><tr class="sd-pool-subhead">${tail.subs}</tr>${ownTotalsRowHtml(ownTotals(board?.rows ?? []), cols, tail.count)}`;
}

/** What is placed, as lineup.js keeps it: { cptId, flexIds } (strings). */
function placedOf(placement, id) {
  const isCaptain = String(placement?.cptId ?? "") === id;
  return { isCaptain, placed: isCaptain || (placement?.flexIds ?? new Set()).has(id) };
}

/** The cells after Notes for one row, under the head's groups: In, then for FLEX and then Captain the Min % / Max % boxes, the lock,
 *  the exclude and the Add button, each in its own cell. */
function tailCellsHtml(row, placement) {
  const id = String(row.id);
  const { isCaptain, placed } = placedOf(placement, id);
  const addFlex = `<button type="button" class="lineup-row-btn sd-add-btn" data-action="add-flex" data-id="${escapeHtml(id)}"${placed ? " disabled" : ""}>Add FLEX</button>`;
  const addCpt = `<button type="button" class="lineup-row-btn sd-add-btn${isCaptain ? " active" : ""}" data-action="add-cpt" data-id="${escapeHtml(id)}">${isCaptain ? "Captain" : "Add CPT"}</button>`;
  const btn = (kind, action) => `<td class="sd-pool-btn">${controls?.button?.(row, kind, action) ?? ""}</td>`;
  const group = (kind, add) => `${controls?.capCells?.(row, kind) ?? ""}${live() ? btn(kind, "lock") + btn(kind, "exclude") : ""}<td class="sd-pool-add">${add}</td>`;
  return `${live() ? `<td class="sd-pool-in">${controls?.button?.(row, "flex", "include") ?? ""}</td>` : ""}${group("flex", addFlex)}${group("cpt", addCpt)}`;
}

/** The body rows (`rows`: poolVisibleRows), each the Rankings row with the slots' figures, the ± bump, the Ceil cell and the tail. */
export function poolBodyHtml(board, rows, placement, figures = playerFigures) {
  const cols = poolColumns(board);
  if (!rows.length) {
    const span = cols.length + tailHeads().count;
    return `<tr class="sd-pool-empty-row"><td class="sd-pool-empty" colspan="${span}">No player matches these filters.</td></tr>`;
  }
  const hooks = {
    figures,
    projCell: controls?.projCell ? (row, proj) => controls.projCell(row, proj) : null,
    // The Player cell names him in full and, for a phone, the cards' short name too (style.css shows one; 👁 V1: no name cut mid-word).
    playerCell: (row) => `<div class="player-cell">${sdLine(row, { nameHtml: cardNameHtml(row) })}</div>`,
    ceilCell: (row, isCpt) => bumpCeilHtml(row, isCpt ? poolCeilCpt(row) : poolCeil(row), { kind: isCpt ? "cpt" : null, out: rowIsOut(row) }),
    valueCell: (row) => poolValueHtml(row, figures),
    // A placed man's row is tinted (the builder's), beside the Optimizer's own look (excluded, locked), each class once.
    rowClass: (row) => [...new Set([placedOf(placement, String(row.id)).placed ? "lineup-row-locked" : "", ...String(controls?.rowClass?.(row) ?? "").trim().split(/\s+/)].filter(Boolean))].join(" "),
    tail: (row) => tailCellsHtml(row, placement),
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

/** The whole pool: heading and figures words, the table in its scroll panel (sized by scroll-panels.js, Expand by expand.js), the legend.
 *  `rows`: poolVisibleRows(board), computed once by the caller so the filter bar's count reads the same list. */
export function poolHtml(board, placement, rows) {
  return `
    <section id="sd-pool" class="sd-pool">
      <div class="sd-pool-head">
        <h3 class="lineup-right-title">Player pool</h3>
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
 * name carries its whole self on hover, a tagged row showing the cards' short name. ctx = { board, repaint() }. The row buttons are
 * lineup.js's to wire (its Add actions and the Optimizer's controls).
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
