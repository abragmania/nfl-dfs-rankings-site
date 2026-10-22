// The Showdown Lineup tab's player lists (Adam 2026-10-18): a Captain list and a FLEX list, because a man's Captain salary,
// projection and ownership differ from his FLEX ones. They share one box under a Captain | FLEX toggle (the choice is remembered
// per viewer); both are always drawn and repainted, only one is shown. Each sorts by a click on any column header, built on the
// classic Optimizer's pool: the same header (tabs.js sortableHeadHtml: "sortable"/"sorted" classes and the arrow), the same sort
// (state.js sortRows: a blank always last, a tie keeps the board's order) and the same first-click directions (state.js
// defaultDirFor). The Player cell is the one shared Showdown row (table.js sdLine, D80). Every figure comes from `figures(row,
// isCpt)`, the Lineup tab's playerFigures (lineup-meter.js): the board row's own, so both lists read this game's ticked sources
// (Adam 2026-10-20); salary is the board's. This file only draws, sorts and wires the lists; lineup.js owns the lineup.
import { escapeHtml, money, dec1 } from "../format.js";
import { gradedCellHtml } from "../table.js";
import { sortRows, defaultDirFor } from "../state.js";
import { sortableHeadHtml } from "../tabs.js";
import { shownRows, sdLine, projTitleText, ownTitleText } from "./table.js";
import { playerFigures } from "./lineup-meter.js";
import { readingShortText } from "./figures-label.js";
import { snapPanelMaxHeight } from "../lineup.js";
import { shortName } from "../lineup-card.js"; // the cards' one name shortener (👁 V-N1: a tagged row's name)

export const LIST_KINDS = ["cpt", "flex"];
const TITLES = { cpt: "Captain", flex: "FLEX" };
const START_SORT = { col: "proj", dir: "desc" }; // Adam 2026-10-18: projection, highest first
const KIND_KEY = "nfldfs-sd-list-kind";

// One sort per list, kept for the page view (module state, like lineup.js's lineup).
const sorts = { cpt: { ...START_SORT }, flex: { ...START_SORT } };

// The Showdown Optimizer's additions to each row (optimizer.js listControls, Adam 2026-10-19): {headCells(kind), cells(row, kind),
// actions(row, kind), rowClass(row, kind), rows(all, shown), addLabel(), projCell(row, kind, proj) (the whole projection cell's
// inside for the list's own figure `proj`, Adam 2026-10-22: the ± bump)}, each optional (an answer of null or undefined keeps the
// list's own); none set leaves the lists exactly as they were.
let controls = null;
export function setListControls(next) {
  controls = next && typeof next === "object" ? next : null;
}

export function listSort(kind) {
  return sorts[kind];
}

/** Test hook: put both lists back to Proj, highest first (and the toggle to Captain, unremembered). */
export function resetListSorts() {
  sorts.cpt = { ...START_SORT };
  sorts.flex = { ...START_SORT };
  shownKind = null;
}

// ---------- which list is shown (remembered per viewer) ----------

const browserStorage = () => window.localStorage;
let shownKind = null; // read from storage on first use

/** The remembered list from a storage-like object; anything unreadable or unknown is the Captain list. */
export function readStoredKind(getStorage) {
  try {
    const v = getStorage().getItem(KIND_KEY);
    return LIST_KINDS.includes(v) ? v : "cpt";
  } catch (e) {
    return "cpt"; // storage blocked (or no window): the toggle still works for this page view
  }
}

export function shownListKind(getStorage = browserStorage) {
  if (shownKind === null) shownKind = readStoredKind(getStorage);
  return shownKind;
}

/** Shows one list and remembers it; false when it was not a list. */
export function setShownListKind(next, getStorage = browserStorage) {
  if (!LIST_KINDS.includes(next)) return false;
  shownKind = next;
  try {
    getStorage().setItem(KIND_KEY, next);
  } catch (e) {
    return true; // storage blocked: the choice lasts for this page view only
  }
  return true;
}

// ---------- columns, figures, sort ----------

/** The header cells of one list: the keys the classic pool sorts on (player, salary, proj, own, value). Team and position are in the Player cell. */
export function listColumns(kind) {
  const p = kind === "cpt" ? "CPT" : "FLEX";
  return [
    { key: "player", label: "Player" },
    { key: "salary", label: `${p} $`, cls: "sd-num" },
    { key: "proj", label: `${p} proj`, cls: "sd-num" },
    { key: "own", label: `${p} own`, cls: "sd-num" }, // Adam 2026-10-18: "CPT own" is Captain ownership alone (ownCpt), "FLEX own" FLEX ownership alone (ownFlex); never one in the other's column
    { key: "value", label: "Proj/$", cls: "sd-num" },
  ];
}

/** The browser's copy of server/rank/value-core.js valueOf (the browser cannot import server files; tests/showdown-lineup-lists.test.mjs
 *  holds the two identical): projection per $1,000 of salary, null when either is missing. */
export function valuePer1k(proj, salary) {
  if (proj === null || proj === undefined || proj === "") return null;
  const p = Number(proj);
  const s = Number(salary);
  if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0) return null;
  return p / (s / 1000);
}

/**
 * One row's figures in one list: { salary, proj, own, value, projNote, notOnBoard, missingReason }. The Captain list reads the
 * Captain salary (cptSalary) and the Captain projection and ownership (figures(row, true)); the FLEX list the FLEX ones
 * (figures(row, false)). Nothing is computed here but Proj/$, from the list's own two figures.
 */
export function listFigures(row, kind, figures = playerFigures) {
  const isCpt = kind === "cpt";
  const f = figures(row, isCpt);
  const salary = isCpt ? row.cptSalary : row.salary;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { salary: num(salary), proj: num(f.proj), own: num(f.own), value: valuePer1k(num(f.proj), num(salary)), projNote: f.projNote ?? null, notOnBoard: f.notOnBoard === true, missingReason: f.missingReason ?? null };
}

const READERS = {
  player: (row) => row.name ?? null,
};

/** The rows of one list in sort order (a stable copy; a blank figure goes last either way). */
export function sortListRows(rows, kind, sort, figures = playerFigures) {
  const valueOf = (row, col) => (READERS[col] ? READERS[col](row) : listFigures(row, kind, figures)[col] ?? null);
  return sortRows(rows, sort.col, sort.dir, valueOf);
}

/** The sort a header click leaves: the same column flips its direction, another column starts in its natural one (as the classic pool's headers do). */
export function nextListSort(sort, col) {
  if (sort.col === col) return { col, dir: sort.dir === "asc" ? "desc" : "asc" };
  return { col, dir: defaultDirFor(col) };
}

// ---------- drawing ----------

/** The header line over the lists: the board's reading in a few words ("Figures: TwoGun only"); the full source lines are on the
 *  meter's label and the header pill. "" for a board with no figures (the dev sample). */
export function listsNoteText(board) {
  const reading = readingShortText(board, ", ");
  return reading ? `Figures: ${reading}` : "";
}

/** What is placed, for the rows' look and buttons: { cptId, flexIds } (strings). */
function isPlacedAnywhere(placement, id) {
  return String(placement.cptId ?? "") === id || (placement.flexIds ?? new Set()).has(id);
}

/** One row of one list. `grade` is the Proj/$ band (v1..v5) or null: the board row's own (view.js applyGrades, D33; the Captain's
 *  value equals his FLEX value, his Captain salary and projection being both 1.5x). */
export function listRowHtml(row, kind, placement, figures = playerFigures, grade = row.valueGrade ?? null) {
  const id = String(row.id);
  const isCpt = kind === "cpt";
  const f = listFigures(row, kind, figures);
  const placed = isPlacedAnywhere(placement, id);
  const isCaptain = String(placement.cptId ?? "") === id;
  const button = isCpt
    ? `<button type="button" class="lineup-row-btn${isCaptain ? " active" : ""}" data-action="add-cpt" data-id="${escapeHtml(id)}">${isCaptain ? "Captain" : controls?.addLabel?.() ?? "Add CPT"}</button>`
    : `<button type="button" class="lineup-row-btn" data-action="add-flex" data-id="${escapeHtml(id)}"${placed ? " disabled" : ""}>${controls?.addLabel?.() ?? "Add FLEX"}</button>`; // the Optimizer's rows say "Add" (the list's toggle names the slot) so its boxes fit
  // Hovers (D41): the board's projHow / ownHow, as the Showdown Rankings cells carry (a list reads only its own side of ownHow); a
  // man listed Out adds what TwoGun projects (projNote), a blank ownership gives the server's reason, a man TwoGun's board has no
  // row for says so (Q8). The notes come from the modes answer (lineup-meter.js figuresFor).
  const projBase = projTitleText(f.proj, row, isCpt ? "Captain: 1.5x price, 1.5x points. " : "");
  const projTitle = f.projNote ? `${projBase}${projBase && !/\s$/.test(projBase) ? " " : ""}${f.projNote}` : projBase;
  const ownTitle = f.notOnBoard ? "Not on TwoGun's board, 0%" : f.own == null && f.missingReason ? f.missingReason : ownTitleText(f.own, row.ownHow, isCpt ? "Captain" : "FLEX");
  const num = (title, text) => `<td class="sd-num"${title ? ` title="${escapeHtml(title)}"` : ""}>${text}</td>`;
  const figureCells = [num(projTitle, controls?.projCell?.(row, kind, f.proj) ?? (f.proj == null ? "no proj" : dec1(f.proj))), num(ownTitle, f.own == null ? "—" : `${dec1(f.own)}%`), `<td class="sd-num">${gradedCellHtml(f.value, grade)}</td>`];
  // The Optimizer's row look (excluded, locked) beside the builder's placed tint, each class once.
  const classes = [...new Set([placed ? "lineup-row-locked" : "", ...String(controls?.rowClass?.(row, kind) ?? "").trim().split(/\s+/)].filter(Boolean))];
  return `
    <tr class="lineup-row${classes.map((c) => ` ${c}`).join("")}" data-id="${escapeHtml(id)}">
      <td><span class="player-cell">${sdLine(row)}</span></td>
      <td class="sd-num">${f.salary == null ? "—" : money(f.salary)}</td>
      ${figureCells.join("")}${controls?.cells?.(row, kind) ?? ""}
      <td class="lineup-row-actions">${controls?.actions?.(row, kind) ?? ""}${button}</td>
    </tr>`;
}

/** The head row of one list (the classic pool's header markup), with the Optimizer's Min % / Max % heads when it adds them. */
export function listHeadHtml(kind, sort = sorts[kind]) {
  return sortableHeadHtml(listColumns(kind), sort).replace(/<\/tr>$/, `${controls?.headCells?.(kind) ?? ""}<th></th></tr>`); // the last, plain cell is the buttons' column
}

/** The body rows of one list in its sort order; `rows` are the board's rows (Out players are left out unless Show all players is on;
 *  the Optimizer's position chip and its locked / included / excluded men through controls.rows). */
export function listBodyHtml(board, kind, placement, sort = sorts[kind], figures = playerFigures) {
  const all = board?.rows ?? [];
  const shown = shownRows(all);
  const rows = sortListRows(controls?.rows ? controls.rows(all, shown) : shown, kind, sort, figures);
  return rows.map((r) => listRowHtml(r, kind, placement, figures)).join("");
}

function listHtml(board, kind, placement, shown) {
  const sub = kind === "cpt" ? "Captain salary (1.5x), projection and ownership" : "FLEX salary, projection and ownership";
  return `
    <div class="sd-list" data-kind="${kind}"${shown ? "" : " hidden"}>
      <div class="sd-list-sub">${escapeHtml(sub)}</div>
      <div class="lineup-rows-wrap scroll-panel">
        <table class="lineup-rows-table sd-list-table">
          <thead>${listHeadHtml(kind)}</thead>
          <tbody>${listBodyHtml(board, kind, placement)}</tbody>
        </table>
      </div>
    </div>`;
}

/** The Captain | FLEX toggle, the source note and both lists (only the chosen one shown); style.css .sd-lists-bar, .sd-list.
 *  `chipsHtml`: a row drawn between the toggle and the lists (the Optimizer's position chips), none by default; none adds not even
 *  a blank line, so the markup is byte-for-byte the pre-Optimizer lists' (🔵 866b0ce B12). */
export function listsHtml(board, placement, chipsHtml = "") {
  const shown = shownListKind();
  const toggle = LIST_KINDS.map((k) => `<button type="button" class="sd-meter-opt${k === shown ? " active" : ""}" data-list-kind="${k}" aria-pressed="${k === shown}">${TITLES[k]}</button>`).join("");
  return `
    <div class="sd-lists-wrap">
      <div class="sd-lists-bar">
        <div class="sd-kind-switch" role="group" aria-label="Which player list">${toggle}</div>
        <span class="sd-lists-note">${escapeHtml(listsNoteText(board))}</span>
      </div>${chipsHtml}
      ${LIST_KINDS.map((k) => listHtml(board, k, placement, k === shown)).join("")}
    </div>`;
}

// ---------- wiring ----------

/**
 * Wires one drawn list: a click on a header sorts that list, a click on a row (not on its button or the name, which
 * opens the player card) calls ctx.onPick(kind, id). ctx = { board, placement(), figures?, onPick(kind, id), onRepaint?(listEl) }.
 */
export function wireList(listEl, ctx) {
  const kind = listEl.dataset?.kind;
  if (!LIST_KINDS.includes(kind)) return;
  listEl.querySelectorAll("th[data-col]").forEach((th) => {
    th.addEventListener("click", () => {
      sorts[kind] = nextListSort(sorts[kind], th.dataset.col);
      paintList(listEl, ctx); // only this list's head and body are redrawn: the scroll box and the other list stay
    });
  });
  // 👁 V-N1: each name's hover carries it whole; a row with an injury tag shows the cards' short name ("D. Samuel Sr.",
  // lineup-card.js shortName), so the ellipsis (style.css .sd-list-table) is the last resort, not the first.
  const rowOf = (id) => (ctx.board?.rows ?? []).find((r) => String(r.id) === String(id));
  listEl.querySelectorAll("tr[data-id]").forEach((tr) => {
    const n = tr.querySelector(".player-name");
    if (!n) return;
    const full = n.title || n.textContent;
    n.title = full;
    if (tr.querySelector(".out-tag, .status-badge")) n.textContent = shortName(full, rowOf(tr.dataset.id)?.pos);
  });
  listEl.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e?.target?.closest?.("button, input, .player-name, .bump-ctl")) return; // the Optimizer's Min % / Max % boxes and the ± pair (a disabled end too) take their own clicks
      ctx.onPick(kind, tr.dataset.id);
    });
  });
}

/** Redraws one list's head and body in place (a sort click, or the modes answer's notes landing), wires them and lets lineup.js wire the row buttons. */
export function paintList(listEl, ctx) {
  const kind = listEl.dataset?.kind;
  const head = listEl.querySelector("thead");
  const body = listEl.querySelector("tbody");
  if (!LIST_KINDS.includes(kind) || !head || !body) return;
  head.innerHTML = listHeadHtml(kind);
  body.innerHTML = listBodyHtml(ctx.board, kind, ctx.placement(), sorts[kind], ctx.figures ?? playerFigures);
  wireList(listEl, ctx);
  ctx.onRepaint?.(listEl);
  sizeShownList(listEl.parentElement); // a redraw can change the rows (a Show all players flip, a sort), so the shown box is fitted again
}

/** Redraws both lists (the hidden one too) and the source note in place. */
export function paintLists(container, ctx) {
  container.querySelectorAll(".sd-list").forEach((el) => paintList(el, ctx));
  const note = container.querySelector?.(".sd-lists-note");
  if (note) note.textContent = listsNoteText(ctx.board);
}

/** The toggle's click: shows that list, hides the other and marks the button, without redrawing the panel. */
function selectKind(container, kind) {
  if (!setShownListKind(kind)) return;
  container.querySelectorAll(".sd-list").forEach((el) => { el.hidden = el.dataset.kind !== kind; });
  container.querySelectorAll("[data-list-kind]").forEach((btn) => {
    const on = btn.dataset.listKind === kind;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  sizeShownList(container); // the list just shown was hidden when the page last sized its box
}

// ---------- the box's height ----------

let sizedContainer = null; // the lists' container as last wired, for the window-resize refit
let resizeWired = false;

/**
 * Fits the SHOWN list's scroll box to the room below its real top edge (the classic Optimizer's snapPanelMaxHeight, lineup.js:
 * the last whole row that fits; expand.js panelMinHeight gives this box no slot-column floor), so the box ends on screen and the page
 * does not also scroll. The hidden list is skipped (it reads no height). The window bottom's reserve is the classic pool's
 * 16 px plus the page's own bottom padding. The box is scrolled to its top while it is measured, so rows far down are
 * measured where they sit, then put back.
 */
export function sizeShownList(container) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const panel = container?.querySelector?.(".sd-list:not([hidden]) .scroll-panel");
  if (!panel) return;
  const main = container.closest?.("main");
  const pad = main ? Number.parseFloat(window.getComputedStyle(main).paddingBottom) || 0 : 0;
  const scrolled = panel.scrollTop;
  panel.scrollTop = 0;
  snapPanelMaxHeight(panel, panel.getBoundingClientRect().top, 16 + pad);
  panel.scrollTop = scrolled;
}

/** Wires both lists and the toggle as drawn by listsHtml, and fits the shown box (also on every window resize). */
export function wireLists(container, ctx) {
  container.querySelectorAll(".sd-list").forEach((el) => wireList(el, ctx));
  container.querySelectorAll("[data-list-kind]").forEach((btn) => btn.addEventListener("click", () => selectKind(container, btn.dataset.listKind)));
  sizedContainer = container;
  if (!resizeWired && typeof window !== "undefined" && window.addEventListener) {
    resizeWired = true;
    window.addEventListener("resize", () => sizeShownList(sizedContainer)); // after app.js's own resize pass (registered first), so this fit stands
  }
  sizeShownList(container);
}
