// The Showdown Optimizer's player pool (Adam 2026-10-26 3:22 PM: "make the optimizer LOOK LIKE THE RANKINGS SCREEN and we don't want the
// rankings screen anymore"; 3:27 PM: integrate the Rankings format's good parts into the Optimizer; D81, the counterpart of classic's
// Optimizer-first step 4, a58538d). ONE table drawn with the retired Rankings tab's columns and cells (table.js: the figures next to the
// names, the hovers, the graded Val, and the gold Captain columns), with the Optimizer's per-man controls at the row's end.
// Since 4:45 PM 2026-10-29 it has a Captain tab and a FLEX tab (each draws its seat's figures), and a click on a row adds the man to the
// lineup or takes him out (no Add buttons). Under the head, a totals row adds every man's Own FLEX and Own CPT (Adam 3:28 PM), so a bias
// in the ownership figures shows.
// The filter bar above the builder (view.js) writes poolState.filters; poolVisibleRows is the ONE call the pool's body and the bar's
// count both read, so the two always agree. lineup.js owns the lineup and draws this pool in its panel; this file draws, sorts and wires.
import { escapeHtml, pct1 } from "../format.js";
import { rowMessageHtml, messageIsFor } from "../row-message.js";
import { shortName, cardNameHtml, teamColours, teamColourStyle } from "../lineup-card.js"; // the cards' one name shortener (👁 V-N1: a tagged row's name; 👁 V1: every name on a phone)
import { showdownPalette } from "./lineup-look.js";
import { SHOWDOWN_COLUMNS, loadColumns, shownKeys, columnsButtonHtml, wireColumns } from "../columns.js"; // A17
import { SD_COLUMNS, showdownHeadCellsHtml, showdownRowHtml, shownRows, sdLine, gradedValueHtml } from "./table.js";
import { filterRows, sortRows, sortValue, defaultDirFor, joinWords } from "./board-shape.js";
import { playerFigures } from "./lineup-meter.js";
import { readingShortText, halfName, stampText } from "./figures-label.js";

// ---------- the filter bar's state and the one call ----------

export const DEFAULT_POOL_FILTERS = Object.freeze({ team: "both", pos: "All", minSalary: null, maxSalary: null, minProj: null, search: "", starredOnly: false });
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

// The Optimizer's additions (optimizer.js poolControls): {live(), mode(), available(tab), rows(all, shown), capCell(row, kind, which) (Min % or Max %),
// button(row, kind, action) ("lock", "include" or "exclude"), lockIcon(row), thumbs(row, isCpt), rowClass(row, tab), projCell(row, proj, isCpt), ownCell(row, own, isCpt, text),
// starCell(row), readTab(), writeTab(tab)}, each optional; none set (or not live) leaves the pool its own rows with no controls.
let controls = null;
export function setPoolControls(next) {
  controls = next && typeof next === "object" ? next : null;
}

// ---------- the Captain | FLEX tabs (Adam 4:45 PM 2026-10-29; D39, D81) ----------

/** The two lists of the pool, Captain and FLEX (Adam: "a CPTN list and a FLEX list ... separated with a tab thingy"). */
export const POOL_TABS = Object.freeze([Object.freeze({ key: "cpt", label: "Captain" }), Object.freeze({ key: "flex", label: "FLEX" })]);

// The figure each tab draws for the Columns list's Sal, Proj and Own, by SD_COLUMNS key: FLEX the FLEX-seat figures, Captain the Captain-seat ones
// (one Val for both: the Captain's price and points are both 1.5x, so his value is the FLEX value, table.js).
const TAB_FIGURES = Object.freeze({
  flex: Object.freeze({ salary: "salary", proj: "proj", own: "ownFlex" }),
  cpt: Object.freeze({ salary: "cptSalary", proj: "cptProj", own: "ownCpt" }),
});
// A sort on one tab's column moves to the other tab's twin of it when the tab changes, so "highest projection first" survives the switch.
const TWIN_COLUMNS = Object.freeze({ salary: "cptSalary", proj: "cptProj", ownFlex: "ownCpt" });
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

/** What a click on his row does on `tab`, from what lineup.js keeps placed ({ cptId, flexIds }): "add-flex" or "remove-flex" on the FLEX tab, "add-cpt"
 *  (another Captain is replaced and goes to FLEX, C19; a FLEX man's Captain row swaps him with the Captain) or "remove-cpt" on the Captain tab; null for the
 *  Captain on the FLEX tab, whose row is greyed (A18, round 3). Pure. */
export function poolPickAction(placement, id, tab) {
  const key = String(id);
  const isCaptain = String(placement?.cptId ?? "") === key;
  const isFlex = (placement?.flexIds ?? new Set()).has(key);
  if (tab === "cpt") return isCaptain ? "remove-cpt" : "add-cpt";
  if (isCaptain) return null;
  return isFlex ? "remove-flex" : "add-flex";
}

const PICK_TITLES = Object.freeze({
  "add-flex": "Click to add to FLEX",
  "remove-flex": "Click to remove",
  "add-cpt": "Click to make Captain",
  "remove-cpt": "Click to remove as Captain",
});

/** A click inside one of these is that control's own (the ± bump, a Min / Max box, lock, In, exclude, the name's card popup) or the padding
 *  around it, not a pick (lineup.js passes it to the shared pick-rows.js wirePickRows). */
export const POOL_PICK_SKIP = "button, a, input, select, textarea, label, .player-name, .bump-ctl, .lineup-thumbs-cell, .sd-pool-btn, .sd-pool-in, .lineup-min-cell, .lineup-max-cell, .lineup-star-col, [data-sd-edit]";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

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
 *  and Val, the board row's for the rest (board-shape.js sortValue). */
export function poolSortValue(row, col, figures = playerFigures) {
  if (col === "proj") return num(figures(row, false).proj);
  if (col === "cptProj") return num(figures(row, true).proj);
  if (col === "ownFlex") return num(figures(row, false).own);
  if (col === "ownCpt") return num(figures(row, true).own);
  if (col === "value") return poolValue(row, figures);
  return sortValue(row, col);
}

/** The sort a header click leaves (the Rankings tab's onSortClick): the same column flips, another starts in its natural direction. */
export function nextPoolSort(sort, col) {
  return sort.col === col ? { col, dir: sort.dir === "asc" ? "desc" : "asc" } : { col, dir: defaultDirFor(col) };
}

/** The sort the pool draws with for `board`: a sort left on a column the tab does not draw (the other tab's column, or a column
 *  that no longer exists) goes back to the tab's start sort, and the kept sort with it, so the next
 *  click starts from there (the old lists' rule). */
export function poolSort(board) {
  if (!poolColumns(board).some((c) => c.key === poolState.sort.col)) poolState.sort = startSortFor(poolTab());
  return poolState.sort;
}

/**
 * THE rows the pool shows, in order, and so the filter bar's count: the board's rows (Out men hidden unless the Showdown's Show all players is on, or a name is
 * being searched: typing a name always finds the man), plus on the live app any man locked, included or excluded (so he can be undone, classic's rule), through the
 * filter bar's filters (team, position, search, Starred only, and the salary range and `Min Proj` on the figures of the list on screen: the Captain list's price and
 * Captain projection, C24; board-shape.js filterRows), sorted by the pool's sort on the figures the cells show.
 */
export function poolVisibleRows(board, { filters = poolState.filters, sort = poolSort(board), figures = playerFigures, tab = poolTab() } = {}) {
  const all = board?.rows ?? [];
  const searching = String(filters.search ?? "").trim() !== "";
  const shown = searching ? all : shownRows(all);
  const base = controls?.rows ? controls.rows(all, shown) : shown;
  const isCpt = tab === "cpt";
  return sortRows(filterRows(base, filters, board?.game, (r) => num(figures(r, isCpt).proj), (r) => num(isCpt ? r.cptSalary : r.salary)), sort.col, sort.dir, (r, c) => poolSortValue(r, c, figures));
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

/** The totals as one line for the Sources page's Data as of (item 7: the row is gone from the pool): "Own total, all 48 players · none blank: FLEX 500.0% (on the mark), CPT 100.0% (on the mark)". */
export function ownTotalsLine(rows) {
  const t = ownTotals(rows);
  const side = (name, s) => (s.sum === null ? `${name} none` : `${name} ${pct1(s.sum)} (${s.diffText})`);
  return `${ownTotalsLabel(t).replace(/ /g, " ")}: ${side("FLEX", t.flex)}, ${side("CPT", t.cpt)}`;
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
  const title = `Every man's ${role} ownership on the board adds to ${pct1(s.sum)}; ${seats} make ${s.expected}%, so it is ${s.diffText}.${s.missing ? ` ${s.missing} with no ${role} figure are left out of the sum.` : ""}`;
  const cls = s.diff > 0.05 ? " is-over" : s.diff < -0.05 ? " is-under" : "";
  return `<th class="sd-own-total${gold ? " sd-cpt-col" : ""}" title="${escapeHtml(title)}">${pct1(s.sum)}<span class="sd-own-diff${cls}">${escapeHtml(s.diffText)}</span></th>`;
}

/** The totals row under the head: the label in the Player column, the two sums under Own FLEX and Own CPT, the rest blank. */
export function ownTotalsRowHtml(t, cols) {
  const cells = cols.map((c) => {
    if (c.key === "player") return `<th class="sd-own-total-label">${escapeHtml(ownTotalsLabel(t))}</th>`;
    if (c.key === "ownFlex") return ownTotalCellHtml(t.flex, "FLEX", "five FLEX seats", false);
    if (c.key === "ownCpt") return ownTotalCellHtml(t.cpt, "Captain", "one Captain seat", true);
    if (c.key === "star") return `<th class="lineup-star-col"></th>`; // the star column's blank, sticky like the head's
    return "<th></th>";
  }).join("");
  return `<tr class="sd-own-total-row">${cells}${FILL_HEAD}</tr>`;
}

/** The pool's last column (style.css .sd-fill): empty, it takes the width the other columns leave, so the columns pack beside the names, the head band reaches the panel's edge and the panel is one width on both lists. */
const FILL_HEAD = `<th class="sd-fill"></th>`;

// ---------- the markup ----------

const live = () => controls?.live?.() === true;

// ---------- the columns: Adam's own ticks and order (A17, columns.js), the standard's order until he changes it (A1) ----------

/** The row controls, as head cells: thumbs, In (where a seat choice exists, D4), Lock, Exclude, Min %, Max %, and on the FLEX list the Captain's own lock and exclude (C21). */
const CONTROL_COLUMNS = Object.freeze({
  star: { key: "star", ctl: true, label: "★", title: "Star: mark a man; Starred only shows the men starred" },
  thumbs: { key: "thumbs", ctl: true, label: "Thumbs", title: "Thumbs: raise or lower his projection 5% a press" },
  in: { key: "in", ctl: true, label: "In", title: "In: in every lineup at Captain or FLEX, the optimizer picks the role" },
  lock: { key: "lock", ctl: true, label: "Lock", title: "Lock him in the seat of this list in every lineup" },
  exclude: { key: "exclude", ctl: true, label: "Exclude", title: "Exclude him from every lineup (on the Captain list, as Captain only)" },
  min_pct: { key: "min_pct", ctl: true, label: "Min %", title: "Fewest of the new lineups he must be in, in this list's seat; blank = none" },
  max_pct: { key: "max_pct", ctl: true, label: "Max %", title: "Most of the new lineups he may be in, in this list's seat; blank = no cap" },
  cpt_min_pct: { key: "cpt_min_pct", ctl: true, label: "CPT Min %", gold: true, title: "Fewest of the new lineups he must be in as Captain; blank = none (the Captain list's Min % box, the same limit)" },
  cpt_max_pct: { key: "cpt_max_pct", ctl: true, label: "CPT Max %", gold: true, title: "Most of the new lineups he may be in as Captain; blank = no cap (the Captain list's Max % box, the same limit)" },
  captain: { key: "captain", ctl: true, label: "CPT", gold: true, title: "Captain: lock him at Captain, or exclude him as Captain, from the FLEX list" },
});
const SD_BY_KEY = new Map(SD_COLUMNS.map((c) => [c.key, c]));
const FIGURE_KEYS = new Set(["salary", "proj", "own"]);

/** The Columns list's keys the pool can draw now: the figures always, the row controls on the live app, Min % and Max % in GPP, the Captain pair on the FLEX list. */
export function poolAvailableKeys(tab = poolTab()) {
  return new Set(["player", "salary", "proj", "own", "value", ...(controls?.available?.(tab) ?? [])]);
}

/** The column set and the browser's place for Adam's choice: per mode (GPP, Cash) of this showdown screen. */
export function poolColumnSetup() {
  return { defs: SHOWDOWN_COLUMNS, scope: `showdown.${controls?.mode?.() === "cash" ? "cash" : "gpp"}` };
}

/** The pool's columns on `tab`, in Adam's order: the Rankings columns of that seat (the Captain list's the CPT ones) and the row controls. */
export function poolColumns(board, tab = poolTab()) {
  const { defs, scope } = poolColumnSetup();
  return shownKeys(loadColumns(defs, scope), poolAvailableKeys(tab)).map((k) => (FIGURE_KEYS.has(k) ? SD_BY_KEY.get(TAB_FIGURES[tab][k]) : SD_BY_KEY.get(k) ?? CONTROL_COLUMNS[k]));
}

/** The head: the sortable Rankings heads, plain heads for the controls, then the ownership totals row (over the whole board). */
export function poolHeadHtml(board, sort = poolSort(board), tab = poolTab()) {
  const cols = poolColumns(board, tab);
  const cells = cols.map((c) => (c.ctl
    ? `<th class="sd-pool-ctl sd-pool-ctl-${c.key}${c.key === "star" ? " lineup-star-col" : ""}${c.gold ? " sd-cpt-col" : ""}${c.key === "min_pct" || c.key === "cpt_min_pct" ? " lineup-min-head" : c.key === "max_pct" || c.key === "cpt_max_pct" ? " lineup-max-head" : ""}" title="${escapeHtml(c.title)}">${escapeHtml(c.label)}</th>`
    : showdownHeadCellsHtml(sort, [c]))).join("");
  return `<tr>${cells}${FILL_HEAD}</tr>`; // item 7 (G64, lead 3:10 PM 11-11): the Own totals row is the Sources page's Data as of line now (ownTotalsLine)
}

/** Where he sits in the lineup, whichever list is on screen: "cpt", "flex" or null (lineup.js keeps the placement as { cptId, flexIds }, strings). C21: both lists mark the whole lineup. */
export function placedSeat(placement, id) {
  const key = String(id);
  if (String(placement?.cptId ?? "") === key) return "cpt";
  return (placement?.flexIds ?? new Set()).has(key) ? "flex" : null;
}

/** The seat tag in the name cell: `CPT` (gold) or `FLEX` for a man in the lineup, "" for one who is not. */
export function seatTagHtml(seat) {
  if (!seat) return "";
  return `<span class="sd-seat${seat === "cpt" ? " sd-seat-cpt" : ""}" title="${seat === "cpt" ? "In your lineup as Captain" : "In your lineup at FLEX"}">${seat === "cpt" ? "CPT" : "FLEX"}</span>`;
}

/** One control cell of a row, by Columns key, for the list on screen (`tab`). */
function controlCellHtml(row, key, tab) {
  const btn = (kind, action) => controls?.button?.(row, kind, action) ?? "";
  switch (key) {
    case "thumbs": return `<td class="lineup-thumbs-cell">${controls?.thumbs?.(row, tab === "cpt") ?? ""}</td>`;
    case "in": return `<td class="sd-pool-in">${btn("flex", "include")}</td>`;
    case "lock":
    case "exclude": return `<td class="sd-pool-btn">${btn(tab, key)}</td>`;
    case "min_pct":
    case "max_pct": return controls?.capCell?.(row, tab, key === "min_pct" ? "min" : "max") ?? "<td></td>";
    case "cpt_min_pct": // C21: the Captain list's own boxes (the same limits), on the FLEX list
    case "cpt_max_pct": return controls?.capCell?.(row, "cpt", key === "cpt_min_pct" ? "min" : "max") ?? "<td></td>";
    case "captain": return `<td class="sd-pool-btn sd-pool-capt sd-cpt-col">${btn("cpt", "lock")}${btn("cpt", "exclude")}</td>`;
    default: return "<td></td>";
  }
}

/** What a click on a row does and why not (A18): lineup.js passes `placement.pickOf(row, tab, base)` (seat-picker.js: the fit and the other seat's greying);
 *  without it the click is poolPickAction's and a row greyed for the other seat says why. Returns {action, reason}. */
function pickOf(placement, row, tab) {
  const base = poolPickAction(placement, String(row.id), tab);
  if (placement?.pickOf) return placement.pickOf(row, tab, base);
  return { action: base, reason: base ? "" : "He is already in your lineup in the other seat. Take him out there first." };
}

/** A row's click attributes (D39): the pick its click makes, a keyboard stop and its words as the hover and the label (no button role:
 *  the row holds buttons of its own). A row that cannot be clicked has no pick and no keyboard stop; its reason is the hover and it is greyed. */
function pickAttrsHtml({ action, reason }) {
  if (action) return ` data-pick="${action}" tabindex="0" title="${PICK_TITLES[action]}" aria-label="${PICK_TITLES[action]}"`;
  return reason ? ` title="${escapeHtml(reason)}" aria-disabled="true"` : "";
}

/** What an empty pool says: with Starred only on, whether nobody is starred or the starred are hidden by the other filters (classic's words, lineup-view.js poolEmptyRowHtml; item 20), else the plain sentence. Pure. */
export function emptyPoolText(board, filters = poolState.filters) {
  if (!filters?.starredOnly) return "No player matches these filters.";
  const hidden = (board?.rows ?? []).filter((r) => r?.starred).length;
  return hidden > 0
    ? `${hidden} starred ${hidden === 1 ? "is" : "are"} hidden by other filters (Show all players is off, team, position, salary, Min Proj or search)`
    : "No starred players";
}

/** The body rows (`rows`: poolVisibleRows), each the Rankings row with the slots' figures and the row controls, in Adam's column order;
 *  a click on a row picks or drops him (poolPickAction). `palette`: the game's team colours (the light tint and stripe of A20). */
export function poolBodyHtml(board, rows, placement, figures = playerFigures, tab = poolTab(), palette = showdownPalette(board)) {
  const cols = poolColumns(board, tab);
  if (!rows.length) {
    return `<tr class="sd-pool-empty-row"><td class="sd-pool-empty" colspan="${cols.length + 1}">${escapeHtml(emptyPoolText(board, poolState.filters))}</td></tr>`;
  }
  const picks = new Map(rows.map((r) => [String(r.id), pickOf(placement, r, tab)]));
  const hooks = {
    figures,
    projCell: controls?.projCell ? (row, proj, isCpt) => controls.projCell(row, proj, isCpt) : null,
    ownCell: controls?.ownCell ? (row, own, isCpt, text) => controls.ownCell(row, own, isCpt, text) : null, // B3: the typed-Own editor
    starCell: controls?.starCell ? (row) => controls.starCell(row) : null, // B2
    // The Player cell names him in full and, for a phone, the cards' short name too (style.css shows one; 👁 V1: no name cut mid-word); then the seat tag of a man in
    // the lineup on either list (C21), a lock icon for a man locked in either seat (C20). A click's refusal (placement.message, lineup.js) is drawn under the name of the
    // row that was clicked (row-message.js, standard A14).
    playerCell: (row) => { // a greyed row says why under his name in a few words (seat-picker.js `short`), the sentence on hover, as classic's pool does
      const p = picks.get(String(row.id));
      const why = !p.action && p.short ? `<span class="sd-blk-why">${escapeHtml(p.short)}</span>` : "";
      return `<div class="player-cell">${sdLine(row, { nameHtml: cardNameHtml(row) })}<span class="sd-seat-slot">${seatTagHtml(placedSeat(placement, row.id))}${controls?.lockIcon?.(row) ?? ""}</span></div>${why}${messageIsFor(placement?.message, row.id) ? rowMessageHtml(placement.message.text, placement.message.tone) : ""}`;
    },
    valueCell: (row) => poolValueHtml(row, figures),
    // A man seated in the lineup, on either list, has his row tinted (the builder's), kept apart from a lock (the icon, C20), beside the Optimizer's own look (excluded), each class once.
    // A row that cannot be clicked is greyed instead of a pick row (A18); the lookup is made once per row and shared by the class and the attributes.
    rowClass: (row) => [...new Set([placedSeat(placement, row.id) ? "sd-row-seated" : "", picks.get(String(row.id)).action ? "sd-pool-pick" : "sd-row-greyed", ...String(controls?.rowClass?.(row, tab) ?? "").trim().split(/\s+/)].filter(Boolean))].join(" "),
    rowAttrs: (row) => {
      const c = teamColours(palette, row.team);
      return `${pickAttrsHtml(picks.get(String(row.id)))} style="${teamColourStyle(c)}"`;
    },
    ctlCell: (row, key) => controlCellHtml(row, key, tab),
    fillCell: true, // the empty last column (FILL_HEAD)
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

/** The whole pool: heading and figures words, the table (no scroll box since A15: the page scrolls and the head sticks under the filter bar), the legend.
 *  `rows`: poolVisibleRows(board), computed once by the caller so the filter bar's count reads the same list. */
export function poolHtml(board, placement, rows) {
  return `
    <section id="sd-pool" class="sd-pool">
      <div class="sd-pool-head">
        <h3 class="lineup-right-title">Player pool</h3>
        ${poolTabsHtml()}
        ${columnsButtonHtml()}${"" /* item 7: "Figures: TwoGun only" is the Sources page's Data as of line */}
      </div>
      <div class="sd-pool-wrap">
        <table id="sd-table" class="sd-pool-table">
          <thead id="sd-thead">${poolHeadHtml(board)}</thead>
          <tbody id="sd-tbody">${poolBodyHtml(board, rows, placement)}</tbody>
        </table>
      </div>
      <div id="sd-legend" class="table-legend">${escapeHtml(poolLegendText(board))}</div>
      ${board?.deviceNote ? `<div class="table-legend sd-device-note" role="note">${escapeHtml(board.deviceNote)}</div>` : ""}
      ${board?.siteEditsNote ? `<div class="table-legend sd-device-note" role="note">${escapeHtml(board.siteEditsNote)}</div>` : ""}
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
  wireColumns(poolEl, { ...poolColumnSetup(), onChange: () => ctx.repaint() }); // A17: the Columns button beside the tabs; a tick or a move repaints the head and body
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
 * place. ctx = { board, placement(), repaint(), onRepaint?(poolEl, rows), onCount?(shown, total), takeEdit?(poolEl), restoreEdit?(poolEl, carry) }: a
 * typed-number box that is open is taken out before the body is replaced and put back in the new one with its text and focus (A3), never read as a click away.
 * Returns the rows shown, or null when no pool is drawn.
 */
export function paintPool(container, ctx) {
  const pool = container?.querySelector?.("#sd-pool");
  const head = pool?.querySelector?.("thead");
  const body = pool?.querySelector?.("tbody");
  if (!pool || !head || !body) return null;
  const rows = poolVisibleRows(ctx.board);
  const openEdit = ctx.takeEdit?.(pool) ?? null;
  head.innerHTML = poolHeadHtml(ctx.board);
  body.innerHTML = poolBodyHtml(ctx.board, rows, ctx.placement());
  wirePool(pool, ctx);
  ctx.onRepaint?.(pool, rows);
  ctx.restoreEdit?.(pool, openEdit);
  ctx.onCount?.(rows.length, (ctx.board?.rows ?? []).length);
  return rows;
}
