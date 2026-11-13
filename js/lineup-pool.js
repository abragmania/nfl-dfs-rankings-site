// The Optimizer's one player table, the pool (optimizer standard C9, C10, C17, round 5). It holds every control and every column the retired ranked list had: star, name (with
// TwoGun's status dot), Sal, Proj and Own (click to type, the small x puts the original back), Val, then the row controls (thumbs, Lock, Exclude, Min %, Max %; Cash: its chips), and after
// them the rest, offered through the Columns list: Pos, TwoGun's Med, Nuke, 3x% and 4x% (a TwoGun board only) and Tags. One text size on every row. No inner scroll box: the page scrolls, the
// head sticks under the filter bar (style.css), and the results sit directly below. The first part (the pick rules, the greying, the click's message) moved here from lineup-view.js unchanged.
// Typed numbers are wired by lineup-pool-edit.js; the writes are app.js's tableCallbacks (setPoolCallbacks).
import { escapeHtml, money, pct1, dec1 } from "./format.js";
import { CLASSIC_GPP_COLUMNS, CLASSIC_CASH_COLUMNS, CLASSIC_TG_KEYS, loadColumns, shownKeys } from "./columns.js"; // A17
import { store, matchesPosition, filterRows, sortRows, passesProjFloor, activeSlateRows, isTwoGunMode, DEFAULT_SORT } from "./state.js";
import { sortableHeadHtml } from "./tabs.js";
import { gradedCellHtml, rowIsOut, STATUS_INFO, TG_COLUMNS, tgCellHtml, tagsCellHtml, tagsCellTitle, markerHtml, twoGunMarkerTexts, projFlagMarkerHtml, opponentLabel } from "./table.js";
import { playerTagHtml, teamLogoHtml, showPos } from "./player-row.js";
import { rowsGradedForView } from "./grade.js";
import { adamTouched } from "./out.js"; // a man Adam marked In / Out or typed a projection on stays listed under the floor (his edit is never out of reach)
import { cardNameHtml } from "./lineup-card.js"; // cardNameHtml: the short name a phone shows (style.css, max-width 700px)
import { paletteForRows } from "./team-palette.js";
import { teamVars, LOCK_ICON, EXCLUDE_ICON } from "./look-row.js";
import { bumpControlHtml, bumpFigureOnlyHtml } from "./bump-control.js"; // since A1 the thumbs are their own column, disabled like the star when no write is wired
import { messageIsFor, rowMessageHtml, TONE_WARN } from "./row-message.js";
import { poolPicker } from "./lineup-pool-fit.js"; // A18, D3: what a click on each pool row may do, and why a row is greyed
import { typedFigureHtml, resetXHtml } from "./typed-proj.js"; // B12: the figure span and the x beside it that clears his typed numbers and bump (shared with the Showdown pool)
import { statusSwitchHtml } from "./status-switch.js"; // Adam 2026-11-12: In / Out / Auto on the status badge (app.js delegates the clicks)
import { crossedNoteHtml } from "./limit-cross.js"; // item 18: Min % above Max % is said under the Max box
import { refusalNoteHtml } from "./limit-box.js"; // item 7: a refused Min % / Max % text is drawn beside its row until the next press
import { state, opt, LINEUP_SLOTS, SALARY_CAP, dkIdentity } from "./lineup.js";
import { slateKeyOf, playerMaxFor, playerMinFor, parsePct, wantIdsFor } from "./lineup-optimizer.js";

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

let poolCallbacks = null; // app.js's tableCallbacks: the pool's star, typed numbers, bump and reset write the same overrides the retired Rankings list wrote (Adam 2026-10-17)

export function setPoolCallbacks(callbacks) {
  poolCallbacks = callbacks;
}

/** The pool's write callbacks (lineup-pool-edit.js reads them at the moment of each write). */
export const poolWriters = () => poolCallbacks;

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
  return `<tr><td class="lineup-pool-empty" colspan="${colspan}">${text} ${CLEAR_FILTERS_BUTTON}</td></tr>`;
}

/**
 * A filter changed from far down the page: when it shrank the pool until its head is above the window (the table ends above the sticky bars, the results below keeping the page tall), the page is scrolled
 * so the head sits under the filter bar, where the table is, instead of leaving him past it. A table still on screen is left alone; so is every other redraw (the caller asks only for a filter change).
 * `under`: the height of the sticky layers (the --filterbar-h of #lineup-panel).
 */
export function keepPoolHeadInView(underOverride = null) {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  const wrap = document.getElementById("lineup-pool");
  if (!wrap) return false;
  const under = underOverride ?? pooledStickyHeight();
  const rect = wrap.getBoundingClientRect();
  const head = wrap.querySelector("thead")?.getBoundingClientRect().height ?? 0;
  if (!(rect.top < under && rect.bottom < under + head + 8)) return false;
  window.scrollBy(0, rect.top - under);
  return true;
}
function pooledStickyHeight() {
  const panel = document.getElementById("lineup-panel");
  return parseFloat(panel?.style?.getPropertyValue?.("--filterbar-h")) || 0;
}

/** A9 (round 5): a remembered filter can leave the pool empty with the page looking broken, so an empty pool says so and offers the filter bar's own Clear filters (lineup.js wires the button to it). Showdown's words. */
export const NO_MATCH_TEXT = "No player matches these filters.";
const CLEAR_FILTERS_BUTTON = `<button type="button" class="link-btn" data-action="pool-clear-filters">Clear filters</button>`;
function poolNoMatchRowHtml(colspan) {
  return `<tr><td class="lineup-pool-empty" colspan="${colspan}">${NO_MATCH_TEXT} ${CLEAR_FILTERS_BUTTON}</td></tr>`;
}

/** A pool star click goes to app.js's star toggle; with none passed (Rankings never rendered) it says so. */
export function poolStarClick(id) {
  if (poolCallbacks?.onToggleStar) poolCallbacks.onToggleStar(id);
  else console.error("Pool star clicked but no star callback is wired (renderLineupPanel got none).");
}

let poolMessageDrawn = false; // set by the last rightColumnHtml: a pool row carries the click's message (A14), so the line under the slots stays empty

/** Whether the pool drawn last carries the click's message beside one of its rows (lineup-view.js panelHtml reads it after drawing the pool). */
export const poolMessageShown = () => poolMessageDrawn;

/** A18, D3: what each row's click may do (add, remove, or nothing with a reason), counted from the working lineup and the whole slate's men. The pool draws
 *  every row from it, and the Lock button asks it too (lineup.js lockPool): Lock is no way round the greying. */
export function poolPickerFor(rows, rowById) {
  const placed = placedIdentities(rowById);
  return poolPicker({
    rows, rowById, slotNames: LINEUP_SLOTS, slots: state.slots, locks: state.locks, excludes: state.excludes, cap: SALARY_CAP, identityOf: dkIdentity,
    base: (row) => classicPickAction(row, placed, state.excludes),
  });
}

/** The picker for the slate on screen (lockPool's). */
export function poolPickerNow(rowById) {
  return poolPickerFor(activeSlateRows(store.get().board), rowById);
}

// ---- the columns ----

/** The columns the pool can draw now: the TwoGun four only on a TwoGun board (a retired ranked list drew them the same way). */
export function poolAvailableKeys(defs, board = store.get().board) {
  return new Set(defs.map((c) => c.key).filter((k) => isTwoGunMode(board) || !CLASSIC_TG_KEYS.includes(k)));
}

/** The columns the pool is set up with: the classic GPP list or the Cash list, and the browser's place for Adam's own ticks and order (A17). */
export function poolColumnSetup(mode = opt.mode) {
  return mode === "cash" ? { defs: CLASSIC_CASH_COLUMNS, scope: "classic.cash" } : { defs: CLASSIC_GPP_COLUMNS, scope: "classic.gpp" };
}

/** The keys the pool draws now, in order: Adam's ticked columns (the name column always), those this board can show; the Pos column is left out of a one-position list, where every row says the same (as the retired ranked list left it out). */
export function poolColumnKeys(mode = opt.mode, board = store.get().board, listFilter = store.get().filters?.pos) {
  const { defs, scope } = poolColumnSetup(mode);
  return shownKeys(loadColumns(defs, scope), poolAvailableKeys(defs, board)).filter((k) => k !== "pos" || showPos(listFilter));
}

/** The sort the pool uses with `keys` drawn: the store's, or Proj high to low when its column is not drawn (it was unticked, or the board cannot show it), so the arrow is on a head that is there. */
export function poolSortFor(keys, sort, fallback = DEFAULT_SORT) {
  return keys.includes(sort?.col) ? sort : fallback;
}

const TG_BY_KEY = new Map(TG_COLUMNS.map((c) => [c.key, c]));
const LEGEND = "coloured number = your own (&times; puts the original back) &middot; &mdash; = nobody has published one";

/** The sortable heads of the columns that sort, by Columns key (state.js sortRows reads these keys); every other column's head is plain text. */
function sortableHeads() {
  return {
    star: { key: "star", label: "★", cls: "ctl k-star", headTitle: "Star" },
    player: { key: "player", label: "Player", cls: "pl" },
    salary: { key: "salary", label: "Sal", cls: "num k-sal" },
    proj: { key: "proj", label: "Proj", cls: "num k-proj" },
    own: { key: "own", label: "Own", cls: "num k-own" },
    value: { key: "value", label: "Val", cls: "num k-val", headTitle: "Val: projection per $1,000 of salary" },
    pos: { key: "pos", label: "Pos", cls: "num k-pos" },
    ...Object.fromEntries(TG_COLUMNS.map((c) => [c.key, { key: c.key, label: c.label, cls: "num k-tg tg-col", headTitle: c.title }])),
    tags: { key: "tags", label: "Tags", cls: "k-tags tags-cell" },
  };
}

const PLAIN_HEADS = {
  thumbs: `<th class="bmp k-thumbs" title="Thumbs: raise or lower his projection 5% a press">Thumbs</th>`, // the Columns list's words (A1, A17)
  lock: `<th class="ctl k-lock" title="Lock puts a player in the lineup">Lock</th>`,
  exclude: `<th class="ctl k-excl" title="Exclude keeps a player out of every lineup">Exclude</th>`,
  min_pct: `<th class="lim k-lim" title="Fewest of the new lineups this player must be in; blank = none">Min %</th>`,
  max_pct: `<th class="lim k-lim" title="Most of the new lineups this player may be in; blank = no cap">Max %</th>`,
  cash: `<th class="cs k-cash" title="Lock puts a player in every lineup; Want puts him on your list, and each lineup shows whether he made it; Fine leaves him to the numbers">Cash</th>`,
};

/** The pool's head row for `keys`, sorted by `sort`. */
export function poolHeadHtml(keys, sort) {
  const sortable = sortableHeads();
  return `<tr>${keys.map((k) => (sortable[k] ? sortableHeadHtml([sortable[k]], sort).replace(/^<tr>|<\/tr>$/g, "") : PLAIN_HEADS[k] ?? "")).join("")}</tr>`;
}

// The Locked and Excluded chips of the filter bar: the table shows only those men (and stars, salary filters and the floor no longer apply to them, as a pick is never hidden by a filter). Page-only.
let poolOnly = null;
export const poolOnlyView = () => poolOnly;
export function setPoolOnly(next) { poolOnly = next === "locked" || next === "excluded" ? next : null; }

/** The pool's markup for `rows` (the slate on screen's rows) and `rowById` (the whole board's, for the placed men). `opts.keys`: the columns to draw instead of Adam's own ticks (the tests draw every column through the real row). */
export function rightColumnHtml(rows, rowById, opts = {}) {
  poolMessageDrawn = false;
  const { filters, sort } = store.get();
  // The classic projection floor (D52) applies to this pool like every other classic list, with one exception:
  // a player already locked, excluded or clicked into the lineup stays listed so his lock, exclude or place can still be undone here.
  // D33: Value colours as on Rankings, FLEX included.
  const graded = rowsGradedForView(rows, filters.pos, store.get().board?.rows ?? rows);
  const cash = opt.mode === "cash"; // Cash mode job 3b, 2026-10-17: one Cash column of Must | Want | Fine in place of Min % and Max %
  const wantSet = new Set(cash ? wantIdsFor(slateKeyOf(store.get().board)) : []);
  const slotIds = new Set(state.slots.filter(Boolean).map((s) => String(s.id))); // D3 (round 3 fixes): a man clicked into the lineup stays listed under the floor too, so his click can undo it
  const filtered = filterRows(graded, { ...filters, showAllPlayers: true }).filter(
    (row) => passesProjFloor(row, filters) || adamTouched(row) || state.locks.has(String(row.id)) || state.excludes.has(String(row.id)) || wantSet.has(String(row.id)) || slotIds.has(String(row.id))
  );
  // The columns are Adam's own ticks and order (A17, columns.js), the standard's order until he changes it (A1): star, Player, Sal, Proj, Own, Val,
  // then the row controls, thumbs, Lock, Exclude, Min % and Max % (Cash: its chips in place of Lock, Min % and Max %), then the rest. Headers sort through the
  // store's one sort (sort.col / sort.dir; state.js sortRows reads the keys); a sort on a column that is not drawn (it was unticked) falls back to Proj, high to low, with its arrow.
  const keys = opts.keys ?? poolColumnKeys();
  const sortNow = poolSortFor(keys, sort);
  const shownRows = poolOnly === "locked"
    ? graded.filter((row) => state.locks.has(String(row.id)))
    : poolOnly === "excluded"
      ? graded.filter((row) => state.excludes.has(String(row.id)))
      : filtered;
  const sorted = sortRows(shownRows, sortNow.col, sortNow.dir);
  const placed = placedIdentities(rowById);
  const pickOf = poolPickerFor(rows, rowById);
  const slateKey = slateKeyOf(store.get().board);
  const maxMap = playerMaxFor(slateKey);
  const minMap = playerMinFor(slateKey);
  const palette = paletteForRows(rowById);
  const bodyRows = sorted.map((row) => rightRowHtml(row, pickOf(row), placed, showPos(filters.pos) && !keys.includes("pos"), maxMap, minMap, cash ? wantSet : null, keys, palette)).join("");
  const emptyRow = sorted.length > 0 ? "" : poolOnly ? poolNoMatchRowHtml(keys.length) : filters.starredOnly ? poolEmptyRowHtml(graded, filters.pos, keys.length) : rows.length ? poolNoMatchRowHtml(keys.length) : "";
  return `
    <div class="tbl" id="lineup-pool">
      <table class="lineup-pool-table">
        <thead id="thead">${poolHeadHtml(keys, sortNow)}</thead>
        <tbody id="tbody">${bodyRows}${emptyRow}</tbody>
      </table>
    </div>
    <div class="table-legend">${LEGEND}</div>`;
}

// ---- click-to-pick on the pool rows (D81 counterpart of 336c1f5; Adam 5:00 PM 2026-10-29: Showdown's row clicks in classic, no Add button) ----

const POOL_PICK_TITLES = Object.freeze({ add: "Click to add to the lineup", remove: "Click to remove" });

/** A click inside one of these is that control's own (the star, his name's card, the typed Proj and Own, the ± bump, a Min % / Max % box, the Cash chips, Lock and
 *  Exclude) or the padding around it, never a pick (pick-rows.js wirePickRows; the Showdown pool's twin is pool.js POOL_PICK_SKIP). */
export const CLASSIC_POOL_PICK_SKIP = "button, a, input, select, textarea, label, .player-name, .bump-ctl, .ctl, .bmp, .lim, .cs, .editable-cell";

/** What a click on his pool row does: "remove" when he is placed (by DraftKings identity, 🔵 finding 6), null when he is excluded (an
 *  excluded man cannot be picked; Exclude undoes it), else "add" (lineup.js pickPoolRow puts him in the first slot his position fills). Pure. */
export function classicPickAction(row, placedSet, excludes) {
  if (placedSet.has(dkIdentity(row))) return "remove";
  return excludes.has(String(row.id)) ? null : "add";
}

/** A pool row's pick attributes: the pick its click makes, a keyboard stop and its words as the hover and the label (no button role: the
 *  row holds buttons of its own). A row that cannot be picked has no pick and no keyboard stop; its reason is the hover (A18). */
function poolPickAttrs(action, reason = "") {
  if (action) return ` data-pick="${action}" tabindex="0" title="${POOL_PICK_TITLES[action]}" aria-label="${POOL_PICK_TITLES[action]}"`;
  return reason ? ` title="${escapeHtml(reason)}" aria-disabled="true"` : "";
}

/** The click's message beside row `id` (A14), "" for every other row; marks the pool as carrying it. */
function poolRowMessageHtml(id) {
  if (!messageIsFor({ id: state.addErrorId, text: state.addError }, id)) return "";
  poolMessageDrawn = true;
  return rowMessageHtml(state.addError, state.addTone ?? TONE_WARN);
}

// ---- the Proj and Own cells (typed numbers: lineup-pool-edit.js) ----

// The typed-number cell's figure span, hover and reset x are typed-proj.js's, one copy for the classic and the Showdown pool.

/** The inside of the Proj cell: the figure (typed ones coloured, the bump's tint on a bumped one), the flag and TwoGun dots, and the small x that puts the original back. */
export function projCellInner(row, { canReset = true } = {}) {
  const figure = row.proj == null ? "no proj" : bumpFigureOnlyHtml(row, row.proj);
  return `${typedFigureHtml(row, "proj", figure)}${projFlagMarkerHtml(row)}${markerHtml(twoGunMarkerTexts(row, "proj"))}${resetXHtml(row, "proj", { canReset })}`;
}

/** The inside of the Own cell: the published or typed figure (a typed one coloured, with the x), a dash for none (D29: the app never estimates one). */
export function ownCellInner(row, { canReset = true } = {}) {
  const typed = row.override?.own != null;
  return `${typedFigureHtml(row, "own", pct1(row.own) ?? "—")}${markerHtml(twoGunMarkerTexts(row, "own"))}${typed ? resetXHtml(row, "own", { canReset }) : ""}`;
}

/** Whether a typed or bumped row can be reset (the app's write is wired). */
const canWrite = () => Boolean(poolCallbacks?.onBump);

const idAttr = (id) => escapeHtml(String(id));
function rightRowHtml(row, picked, placedSet, posShown, maxMap = {}, minMap = {}, cashWant = null, keys = poolColumnKeys(), palette = null) { // cashWant: a Set of Want ids in cash mode, else null; picked: poolPicker's {action, reason}
  const id = String(row.id);
  const maxText = maxMap[id] ?? "";
  const maxBad = Number.isNaN(parsePct(maxText));
  const minText = minMap[id] ?? "";
  const minBad = Number.isNaN(parsePct(minText));
  const locked = state.locks.has(id);
  const excluded = state.excludes.has(id);
  // 🔵 finding 6: "already placed" is a DraftKings-identity comparison, not a board-id comparison (classicPickAction); A18: poolPicker also greys a row that cannot go in.
  const pick = picked.action;
  const inLineup = placedSet.has(dkIdentity(row));
  // 🔵 finding 8: same dimming rule as the Rankings table.
  const dimmed = rowIsOut(row);
  const greyed = !pick && !excluded; // an excluded row keeps its own look; every other row that cannot be clicked is greyed (A18)
  const rowClass = `team${excluded ? " excl" : locked ? " locked" : ""}${inLineup && !locked ? " inl" : ""}${dimmed ? " row-dimmed" : ""}${pick ? " pk" : ""}${greyed && !locked ? " blk" : ""}`;
  const name = escapeHtml(row.name ?? "");
  const noWrite = !canWrite();
  const ownNum = typeof row.own === "number" && Number.isFinite(row.own) ? row.own : null;
  const ownBar = ownNum === null ? `<span class="b off"></span>` : `<span class="b"><i style="width:${Math.min(100, (ownNum / 30) * 100).toFixed(0)}%"></i></span>`;
  // The name cell (A1): logo, name, position and injury letter on the first line, team and matchup (D43) on the second, the click's message under them. The TwoGun dot follows the name for a status that changed after his board was made.
  const cells = {
    star: () => `<td class="ctl"><button type="button" class="fav${row.starred ? " on" : ""}" title="${row.starred ? "Starred" : "Star"}" data-action="toggle-star" data-id="${idAttr(id)}"${poolCallbacks?.onToggleStar ? "" : " disabled"}>${row.starred ? "★" : "☆"}</button></td>`,
    player: () => `<td class="pl"><div class="who">${teamLogoHtml(row.team, "logo", 24)}<div class="whot"><div class="l1"><span class="name player-name" title="${name}">${cardNameHtml(row)}</span>${statusSwitchHtml(row, playerTagHtml(row), { canWrite: Boolean(poolCallbacks?.onStatus) })}${posShown && row.pos ? `<span class="pos">${escapeHtml(row.pos)}</span>` : ""}${markerHtml(twoGunMarkerTexts(row, "status"))}</div><div class="l2">${escapeHtml(row.team ?? "")}${opponentLabel(row) ? ` · ${escapeHtml(opponentLabel(row))}` : ""}${greyed && picked.short ? ` · <span class="blk-why">${escapeHtml(picked.short)}</span>` : ""}</div></div></div>${poolRowMessageHtml(id)}</td>`, // a greyed row says why under his name (walkthrough friction), the full sentence on hover
    salary: () => `<td class="num sal">${money(row.salary)}${markerHtml(twoGunMarkerTexts(row, "salary"))}</td>`,
    proj: () => `<td class="num proj"><div class="editable-cell" data-field="proj" data-id="${idAttr(id)}">${projCellInner(row, { canReset: !noWrite })}</div></td>`,
    own: () => `<td class="num bar own">${ownBar}<span class="v"><div class="editable-cell" data-field="own" data-id="${idAttr(id)}">${ownCellInner(row, { canReset: !noWrite })}</div></span></td>`,
    value: () => `<td class="num bar val"><span class="v">${gradedCellHtml(row.value, row.valueGrade)}</span></td>`,
    thumbs: () => `<td class="bmp">${bumpControlHtml(row, { enabled: Boolean(poolCallbacks?.onBump) })}</td>`,
    cash: () => `<td class="cs">${cashChipsHtml(row, { locked, wanted: Boolean(cashWant?.has(id)), excluded, inLineup })}</td>`,
    lock: () => `<td class="ctl"><button type="button" class="lk${locked ? " on" : ""}" data-action="row-lock" data-id="${idAttr(id)}" aria-pressed="${locked}" title="${locked ? "Locked in every lineup. Click to unlock" : "Lock him into your lineup and every build"}"${excluded ? " disabled" : ""}>${LOCK_ICON}</button></td>`,
    exclude: () => `<td class="ctl"><button type="button" class="ex${excluded ? " on" : ""}" data-action="row-exclude" data-id="${idAttr(id)}" aria-pressed="${excluded}" title="${excluded ? "Excluded from every lineup. Click to include again" : "Exclude from every lineup"}">${EXCLUDE_ICON}</button></td>`,
    min_pct: () => `<td class="lim"><input type="text" inputmode="decimal" maxlength="5" class="limb lineup-min-input${minBad ? " invalid" : ""}" data-player-min="${idAttr(id)}" value="${escapeHtml(minText)}" aria-label="Min % for ${name}" />${refusalNoteHtml(`[data-player-min="${id}"]`)}</td>`,
    max_pct: () => `<td class="lim"><input type="text" inputmode="decimal" maxlength="5" class="limb lineup-max-input${maxBad ? " invalid" : ""}" data-player-max="${idAttr(id)}" value="${escapeHtml(maxText)}" aria-label="Max % for ${name}" />${refusalNoteHtml(`[data-player-max="${id}"]`)}${crossedNoteHtml(minText, maxText, parsePct)}</td>`,
    pos: () => `<td class="num k-pos">${escapeHtml(row.pos ?? "")}</td>`,
    tags: () => `<td class="k-tags tags-cell" title="${escapeHtml(tagsCellTitle(row))}">${tagsCellHtml(row)}</td>`,
  };
  for (const key of CLASSIC_TG_KEYS) {
    cells[key] = () => {
      const col = TG_BY_KEY.get(key);
      const tip = twoGunMarkerTexts(row, col.field).join(" ");
      return `<td class="num tg-col"${tip ? ` title="${escapeHtml(tip)}"` : ""}>${tgCellHtml(row, col)}</td>`;
    };
  }
  return `
    <tr class="${rowClass}" data-id="${idAttr(id)}"${poolPickAttrs(pick, picked.reason)} style="${teamVars(row.team, palette)}">
      ${keys.map((k) => cells[k]?.() ?? "").join("")}
    </tr>`;
}

/** The Cash chips on a pool row (Lock, Want, Fine: the approved look's small tabs, lineup-cash.js's words): `data-cash-pick` is wired by lineup.js. A man clicked into the lineup with no padlock has no chip on (he is held, so "Fine" would be false; a click on Fine takes him out). */
function cashChipsHtml(row, { locked = false, wanted = false, excluded = false, inLineup = false } = {}) {
  const id = idAttr(row.id);
  const active = locked ? "must" : wanted ? "want" : inLineup ? null : "fine";
  const part = (key, label) => `<button type="button" class="${active === key ? (key === "fine" ? "on fine" : "on") : ""}" data-cash-pick="${key}" data-id="${id}" aria-pressed="${active === key}"${key === "fine" && inLineup && !locked ? ` title="Take him out of your lineup"` : ""}${excluded ? " disabled" : ""}>${label}</button>`;
  return `<span class="tabs${excluded ? " is-disabled" : ""}" role="group" aria-label="Conviction for ${escapeHtml(row?.name ?? "")}">${part("must", "Lock")}${part("want", "Want")}${part("fine", "Fine")}</span>`;
}
