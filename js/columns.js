// The player table's Columns list (optimizer standard A17, 2026-11-03): a `Columns` button opens a list of every column with a tick box
// and a drag handle; Adam ticks and orders them himself. Remembered per sport and mode in the browser (classic GPP, classic Cash,
// Showdown GPP, Showdown Cash: `scope`), `Reset columns` restores the standard's order, the name column cannot be unticked, and no
// ceiling column is offered (A21). The state helpers are pure (tests/columns.test.mjs); columnsControl wires the button and its list.
// One copy for the classic pool (lineup-view.js) and the Showdown pool (showdown/pool.js).
import { escapeHtml } from "./format.js";

/** Classic GPP, in the standard's order (A1): star, name, Sal, Proj, Own, Val, then the row controls, thumbs, lock, exclude, Min %, Max %, then the rest: the columns the retired ranked list had
 *  (C9, C10, C17): Pos (the name cell already carries the position chip, so it starts off), TwoGun's Med, Nuke, 3x% and 4x% (drawn only on a TwoGun board, on by default), Tags (on by default: the tags he researched stay on screen). */
export const CLASSIC_GPP_COLUMNS = Object.freeze([
  { key: "star", label: "Star" },
  { key: "player", label: "Player", required: true },
  { key: "salary", label: "Sal" },
  { key: "proj", label: "Proj" },
  { key: "own", label: "Own" },
  { key: "value", label: "Val" },
  { key: "thumbs", label: "Thumbs" },
  { key: "lock", label: "Lock" },
  { key: "exclude", label: "Exclude" },
  { key: "min_pct", label: "Min %" },
  { key: "max_pct", label: "Max %" },
  { key: "pos", label: "Pos", off: true },
  { key: "tgMed", label: "Med" },
  { key: "tgNuke", label: "Nuke" },
  { key: "tgP3x", label: "3x%" },
  { key: "tgP4x", label: "4x%" },
  { key: "tags", label: "Tags" }, // on by default: the tags he researched stay on screen, as the retired ranked list showed them
]);

/** The TwoGun columns of the classic pool: on a TwoGun board only (lineup-pool.js poolAvailableKeys). */
export const CLASSIC_TG_KEYS = Object.freeze(["tgMed", "tgNuke", "tgP3x", "tgP4x"]);

/** Classic Cash: the Cash chips (Lock, Want, Fine) are one column in place of Lock, Min % and Max %. */
export const CLASSIC_CASH_COLUMNS = Object.freeze(CLASSIC_GPP_COLUMNS.filter((c) => !["lock", "min_pct", "max_pct"].includes(c.key)).flatMap((c) => (c.key === "thumbs" ? [c, { key: "cash", label: "Cash" }] : [c])));

/** Showdown: the same standard order (star first, B2); In sits beside Lock (D4, where a seat choice exists), Captain holds the Captain's lock and exclude on the FLEX list (C21). */
export const SHOWDOWN_COLUMNS = Object.freeze([
  { key: "star", label: "Star" },
  { key: "player", label: "Player", required: true },
  { key: "salary", label: "Sal" },
  { key: "proj", label: "Proj" },
  { key: "own", label: "Own" },
  { key: "value", label: "Val" },
  { key: "thumbs", label: "Thumbs" },
  { key: "in", label: "In" },
  { key: "lock", label: "Lock" },
  { key: "exclude", label: "Exclude" },
  { key: "min_pct", label: "Min %" },
  { key: "max_pct", label: "Max %" },
  { key: "cpt_min_pct", label: "CPT Min %", off: true }, // C21: the Captain list's Min % and Max % boxes, reachable from the FLEX row (the same limits); off until Adam ticks them
  { key: "cpt_max_pct", label: "CPT Max %", off: true },
  { key: "captain", label: "Captain lock and exclude" },
]);

const keysOf = (defs) => defs.map((c) => c.key);
const byKey = (defs) => new Map(defs.map((c) => [c.key, c]));

/** The standard's order with every column ticked, except those a list marks `off` (offered, not shown until ticked). */
export const defaultColumns = (defs) => ({ order: keysOf(defs), hidden: defs.filter((c) => c.off).map((c) => c.key) });

/** A remembered state made safe: a column that no longer exists and a repeat are dropped, a column it does not know yet goes back after its
 *  standard neighbour, a required column is never hidden; anything that is not a state gives the standard's. */
export function cleanColumns(defs, saved) {
  if (!saved || typeof saved !== "object" || !Array.isArray(saved.order)) return defaultColumns(defs);
  const map = byKey(defs);
  const order = [...new Set(saved.order)].filter((k) => typeof k === "string" && map.has(k));
  const added = [];
  keysOf(defs).forEach((k, i) => {
    if (order.includes(k)) return;
    const prev = i === 0 ? -1 : order.indexOf(keysOf(defs)[i - 1]);
    order.splice(prev + 1, 0, k);
    if (map.get(k).off) added.push(k); // a column the list gained since it was remembered comes back in its default state: an `off` one stays off
  });
  const hidden = Array.isArray(saved.hidden) ? [...new Set(saved.hidden)].filter((k) => map.has(k) && !map.get(k).required) : [];
  return { order, hidden: [...new Set([...hidden, ...added])] };
}

/** The stored text to a state; missing or unreadable text gives the standard's (a damaged remembered choice is only a lost convenience). */
export function parseColumns(defs, text) {
  if (typeof text !== "string") return defaultColumns(defs);
  try {
    return cleanColumns(defs, JSON.parse(text));
  } catch {
    return defaultColumns(defs);
  }
}

/** The keys the table draws, in order: ticked ones, and only those `available` (a Set, when given) at this moment. */
export const shownKeys = (st, available = null) => st.order.filter((k) => !st.hidden.includes(k) && (!available || available.has(k)));

/** The Columns list's entries, in order; only those `available` (a Set, when given) at this moment are offered: a column the board cannot show is not listed, and a tick remembered for it stays harmless in the state. */
export const listedColumns = (defs, st, available = null) => {
  const map = byKey(defs);
  return st.order.filter((k) => !available || available.has(k)).map((k) => ({ ...map.get(k), on: !st.hidden.includes(k) }));
};

/** Ticks or unticks a column; a required one stays on. */
export function toggleColumn(defs, st, key) {
  const c = byKey(defs).get(key);
  if (!c || c.required) return st;
  return { ...st, hidden: st.hidden.includes(key) ? st.hidden.filter((k) => k !== key) : [...st.hidden, key] };
}

/** Moves `key` to the place of `over`: below it when dragged down, above it when dragged up. */
export function moveColumn(st, key, over) {
  const from = st.order.indexOf(key);
  const to = st.order.indexOf(over);
  if (from < 0 || to < 0 || from === to) return st;
  const order = [...st.order];
  order.splice(from, 1);
  order.splice(to, 0, key);
  return { ...st, order };
}

/** Which edge of the row under a drag the dropped column lands on: "bottom" dragging down, "top" dragging up, null over itself. */
export function dropEdge(st, key, over) {
  const from = st.order.indexOf(key);
  const to = st.order.indexOf(over);
  return from < 0 || to < 0 || from === to ? null : from < to ? "bottom" : "top";
}

/** The list's markup: a row per column (drag handle, tick box; the name column's box is disabled), then Reset columns. */
export function columnsListHtml(defs, st, available = null) {
  const rows = listedColumns(defs, st, available).map((c) => `<li class="colrow" data-col="${escapeHtml(c.key)}"><span class="hnd" draggable="true" tabindex="0" role="button" data-col-handle="${escapeHtml(c.key)}" title="Drag to move ${escapeHtml(c.label)}; the up and down arrow keys move it too" aria-label="Move ${escapeHtml(c.label)}">⠿</span>`
    + `<label><input type="checkbox" data-col-tick="${escapeHtml(c.key)}"${c.on ? " checked" : ""}${c.required ? ` disabled title="The name column stays on"` : ""}> ${escapeHtml(c.label)}</label></li>`).join("");
  return `<ul class="collist">${rows}</ul><button type="button" class="colreset" data-col-reset>Reset columns</button>`;
}

/** The button and its (closed) list, for the table's heading. */
export function columnsButtonHtml() {
  return `<span class="colsw"><button type="button" class="chip columns-btn" data-columns-btn aria-expanded="false" aria-haspopup="true">Columns</button><div class="colpop" data-columns-pop hidden></div></span>`;
}

const storeKey = (scope) => `nfldfs.columns.${scope}`;

/** The browser's storage, or null: reading `window.localStorage` itself throws when storage is blocked, so it is read inside the try. */
function browserStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // blocked storage: the choice holds for this page view only
  }
}

/** Reads the remembered state for `scope` (the browser's storage; none or unreadable gives the standard's). `storage` is for tests; left out, the browser's is read inside the try. */
export function loadColumns(defs, scope, storage) {
  try {
    return parseColumns(defs, (storage === undefined ? browserStorage() : storage)?.getItem(storeKey(scope)));
  } catch {
    return defaultColumns(defs); // storage can throw (private browsing)
  }
}

function saveColumns(scope, st, storage) {
  try {
    if (st === null) storage?.removeItem(storeKey(scope));
    else storage?.setItem(storeKey(scope), JSON.stringify(st));
  } catch {
    // Storage unavailable: the choice holds for this page view only.
  }
}

const openScopes = new Set(); // a redraw of the panel keeps an open list open

/**
 * Wires the Columns button and list under `root` (called after each draw). `defs`, `scope`: the column set and its remembered place;
 * `onChange(state)` redraws the table. Dragging moves a column on the drop only (a redraw during a drag would end it); the up and down
 * arrow keys move the focused handle too. Returns nothing; the state is read again from storage by the next draw's loadColumns.
 */
export function wireColumns(root, { defs, scope, onChange, storage = browserStorage(), available = null }) {
  const btn = root.querySelector?.("[data-columns-btn]");
  const pop = root.querySelector?.("[data-columns-pop]");
  if (!btn || !pop || typeof document === "undefined" || typeof document.addEventListener !== "function" || typeof btn.closest !== "function") return; // no page behind it (a test's stand-in container)
  let st = loadColumns(defs, scope, storage);
  let dragging = null;
  const draw = () => { pop.innerHTML = columnsListHtml(defs, st, available?.() ?? null); }; // `available()`: the columns the board can show now (classic: no TwoGun columns on a board with no TwoGun figures)
  const open = () => { draw(); pop.hidden = false; btn.setAttribute("aria-expanded", "true"); openScopes.add(scope); };
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); openScopes.delete(scope); };
  const set = (next, saved = next) => {
    st = next;
    saveColumns(scope, saved, storage);
    draw();
    onChange(st);
  };
  if (openScopes.has(scope)) open();
  btn.addEventListener("click", () => (pop.hidden ? open() : close()));
  const outside = (e) => {
    if (!btn.isConnected) return document.removeEventListener("click", outside); // the draw that made this button has been replaced
    if (e.target?.isConnected === false) return; // a click on something its own handler already replaced (Reset columns redraws the list) is not a click outside
    if (!pop.hidden && !e.composedPath().includes(btn.closest(".colsw"))) close();
  };
  document.addEventListener("click", outside);
  pop.addEventListener("change", (e) => {
    const k = e.target.dataset?.colTick;
    if (k) set(toggleColumn(defs, st, k));
  });
  pop.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-col-reset]")) set(defaultColumns(defs), null);
  });
  const clearOver = () => pop.querySelectorAll(".colrow.over").forEach((r) => r.classList.remove("over", "down"));
  pop.addEventListener("dragstart", (e) => {
    const k = e.target.dataset?.colHandle;
    if (!k) return e.preventDefault();
    dragging = k;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", k);
  });
  pop.addEventListener("dragover", (e) => {
    const row = e.target.closest?.(".colrow");
    if (!dragging || !row) return;
    e.preventDefault();
    clearOver();
    const edge = dropEdge(st, dragging, row.dataset.col);
    if (edge) row.classList.add("over", ...(edge === "bottom" ? ["down"] : []));
  });
  pop.addEventListener("drop", (e) => {
    const row = e.target.closest?.(".colrow");
    if (!dragging || !row) return;
    e.preventDefault();
    const k = dragging;
    dragging = null;
    clearOver();
    set(moveColumn(st, k, row.dataset.col));
  });
  pop.addEventListener("dragend", () => { dragging = null; clearOver(); });
  pop.addEventListener("keydown", (e) => {
    const k = e.target.dataset?.colHandle;
    if (!k || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const avail = available?.() ?? null;
    const list = avail ? st.order.filter((x) => avail.has(x)) : st.order; // the neighbour is the one he sees
    const next = list[list.indexOf(k) + (e.key === "ArrowUp" ? -1 : 1)];
    if (next) {
      set(moveColumn(st, k, next));
      // The redraw may have replaced this whole panel (classic's), so `pop` can be the detached old list: the handle is found again in the document.
      const handle = (typeof document.querySelector === "function" ? document.querySelector(`[data-columns-pop]:not([hidden]) [data-col-handle="${k}"]`) : null) ?? pop.querySelector(`[data-col-handle="${k}"]`);
      handle?.focus({ preventScroll: true });
    }
  });
  btn.closest(".colsw")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) { e.stopPropagation(); close(); btn.focus(); }
  });
}
