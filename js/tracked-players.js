// The Tracked DFS players page (public/tracked-players.html; Adam 2026-10-20: "make it something I can sort and click through
// that isn't ugly"): one sortable table of DraftKings usernames: the RotoGrinders top-100 rank and YES for each WAS@SF contest entered
// from the standings Adam uploaded (2:10 PM: columns, not tags; contest results are not shown). Clicking a row, or Enter or Space on the
// keyboard row (arrow keys or j and k move it), marks or unmarks the name at once through POST /api/tracked-players/mark.
// What to show is worked out in tracked-players-view.js (pure, tested); this file only draws it and wires the controls.
// On the public site (D71) the page shows the same list and takes the visitor's ticks, kept in this browser only (SITE_MARKS_KEY,
// laid over the baked registry): tools/publish.mjs rewrites TRACKED_URL to the baked copy, which is how the page knows where it runs.
// The app is unchanged.
import { escapeHtml, localStamp } from "./format.js";
import { sortArrowHtml } from "./table.js";
import { cameFromApp, backTarget } from "./showdown/salary-used.js";
import { makeFilterDebounce } from "./filter-debounce.js";
import {
  LIST_CHOICES, DEFAULT_SORT, buildModel, listCounts, viewRows, nextSort, withMark, namesInContests,
  columnsFor, columnCounts, snapshotSummary, keyStep, stepKey, cursorAfter,
} from "./tracked-players-view.js";

const TRACKED_URL = "baked/tracked-players.json";
const SITE = TRACKED_URL.startsWith("baked/");
let cols = columnsFor([]); // the contests' columns join them once the lists load

const els = typeof document === "undefined" ? {} : { // empty under node, where the tests import the pure parts below
  counts: document.getElementById("tp-counts"),
  search: document.getElementById("tp-search"),
  back: document.getElementById("tp-back"),
  error: document.getElementById("tp-error"),
  readOnly: document.getElementById("tp-readonly"),
  lists: document.getElementById("tp-lists"),
  hideMarked: document.getElementById("tp-hide-marked"),
  source: document.getElementById("tp-source"),
  thead: document.getElementById("tp-thead"),
  tbody: document.getElementById("tp-tbody"),
  box: document.getElementById("tp-box"),
  bar: document.getElementById("tp-bar"),
  keys: document.getElementById("tp-keys"),
  foot: document.getElementById("tp-foot"),
};
const typedSearch = makeFilterDebounce({ apply: (patch) => { view.query = patch.query; renderBody(); } }); // 150 ms, as the Optimizer's filter bar
const view = { list: "all", query: "", hideMarked: false, sort: { ...DEFAULT_SORT } };
let model = null;
let counts = null;
let cursor = null; // the keyboard row's name key, or null until an arrow key or a click picks one
let shownKeys = []; // every row of the current list, in order: where the arrow keys step
const saving = new Map(); // key -> the state being saved (true = marking)
let saves = Promise.resolve(); // marks are posted one at a time, in click order
// On the site (D71): the visitor's saved ticks lie over the baked registry. siteChanges: the saved ticks; bakedKeys: the baked marks
// an untouched name shows; siteUnread: how many saved entries could not be read (G62, -1 when the whole record could not).
let siteChanges = {};
let bakedKeys = new Set();
let siteUnread = 0;
let sourceData = null; // the loaded list data, for redrawing the source line

// The visitor's ticks on the site are kept in this browser only and never sent (D71). Storage can be missing, switched off or full,
// so every access is guarded; an entry that is not well formed is left out and counted, and a write the browser refuses changes nothing.
export const SITE_MARKS_KEY = "nfldfs-site-tracked-players";
export const SITE_REFUSED_MESSAGE = "This browser is not letting the site keep your ticks (storage is switched off or full), so nothing was saved.";
const lowerKey = (s) => String(s).trim().toLowerCase();
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** This browser's storage, or null when there is none (no window, switched off, or the access throws). */
export function siteStorage() {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch (e) {
    console.warn("tracked players: browser storage unavailable", e);
    return null;
  }
}

/** The visitor's saved ticks as { changes: {lower-case name: {on, name}}, unread }; unread counts the entries left out, -1 when the record cannot be read at all. */
export function readSiteMarks(storage) {
  if (!storage) return { changes: {}, unread: 0 };
  let parsed;
  try {
    const raw = storage.getItem(SITE_MARKS_KEY);
    if (!raw) return { changes: {}, unread: 0 };
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn("tracked players: saved ticks unreadable", e);
    return { changes: {}, unread: -1 };
  }
  if (!isObject(parsed)) return { changes: {}, unread: -1 };
  const changes = {};
  let unread = 0;
  for (const [key, v] of Object.entries(parsed)) {
    if (isObject(v) && typeof v.on === "boolean" && typeof v.name === "string" && v.name.trim() !== "" && lowerKey(v.name) === key) changes[key] = { on: v.on, name: v.name };
    else unread++;
  }
  return { changes, unread };
}

/** Writes the visitor's ticks (an empty set removes the entry). False when there is no storage or the browser refused the write. */
export function writeSiteMarks(storage, changes) {
  if (!storage) return false;
  try {
    if (Object.keys(changes).length === 0) storage.removeItem(SITE_MARKS_KEY);
    else storage.setItem(SITE_MARKS_KEY, JSON.stringify(changes));
    return true;
  } catch (e) {
    console.warn("tracked players: ticks not saved", e);
    return false;
  }
}

/** The ticks after the visitor sets `key` (shown as `name`) to `on`. An entry is kept only where the tick differs from the baked registry (`bakedKeys`), so Adam's later publishes show through. */
export function changeMark(changes, bakedKeys, key, name, on) {
  const next = { ...changes };
  if (on === bakedKeys.has(key)) delete next[key];
  else next[key] = { on, name };
  return next;
}

/**
 * One tick saved over what the browser holds now, not over this page's copy: another tab may have saved ticks since this page loaded,
 * and a write over the old copy would drop them. Returns { changes, saved, unread }: `saved` is false when the browser refused the
 * write (nothing changed, and `unread` is what it was); when saved, `unread` is 0, since the write replaces every unreadable entry (G62).
 */
export function saveTick(storage, bakedKeys, key, name, on) {
  const now = readSiteMarks(storage);
  const changes = changeMark(now.changes, bakedKeys, key, name, on);
  if (writeSiteMarks(storage, changes)) return { changes, saved: true, unread: 0 };
  return { changes: now.changes, saved: false, unread: now.unread };
}

/** The baked marked names with the visitor's ticks laid over: a tick on adds the name, a tick off removes it; a baked name keeps its own spelling. */
export function marksWith(bakedNames, changes) {
  const out = new Map(bakedNames.map((n) => [lowerKey(n), n]));
  for (const [key, { on, name }] of Object.entries(changes)) {
    if (on) {
      if (!out.has(key)) out.set(key, name);
    } else out.delete(key);
  }
  return [...out.values()];
}

const fmt = (n) => n.toLocaleString("en-US");

/** "Oct 19 23:08 ET" (Eastern) from an ISO time, or null. */
function when(iso) {
  const s = localStamp(iso);
  return s ? `${s.monthDay} ${s.clock} ET` : null;
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
  layout(); // the banner moves the box's top edge
}
function clearError() {
  els.error.hidden = true;
  els.error.textContent = "";
  layout();
}

function renderCounts() {
  els.counts.textContent = `${fmt(model.marked.size)} marked · ${fmt(namesInContests(model))} names across ${model.contests.length} contests`;
}

function renderLists() {
  els.lists.innerHTML = LIST_CHOICES.map(
    (l) =>
      `<button type="button" class="chip toggle-chip tp-list${view.list === l.id ? " active" : ""}" data-list="${l.id}" aria-pressed="${view.list === l.id}">` +
      `${escapeHtml(l.label)} <span class="tp-list-count">${fmt(counts[l.id])}</span></button>`
  ).join("");
}

function renderToggles() {
  els.hideMarked.classList.toggle("active", view.hideMarked);
  els.hideMarked.setAttribute("aria-pressed", String(view.hideMarked));
}

function renderHead() {
  els.thead.innerHTML = `<tr>${cols.map((c) => {
    const active = view.sort.col === c.id;
    const aria = active ? ` aria-sort="${view.sort.dir === "asc" ? "ascending" : "descending"}"` : "";
    const title = c.title ? ` title="${escapeHtml(c.title)}"` : "";
    const kind = c.id === "mark" || c.id === "name" || c.id === "top100" ? c.id : "yes";
    return `<th class="tp-col-${kind}${active ? " sorted" : ""}" data-col="${escapeHtml(c.id)}"${aria}${title}>${escapeHtml(c.label)}${sortArrowHtml(active, view.sort.dir, true)}</th>`;
  }).join("")}</tr>`;
}

/** The Top 100 cell: his RotoGrinders rank, blank when he is not in the top 100. */
function rankCell(row) {
  if (!row.rgRank) return `<td class="tp-num"></td>`;
  const listed = row.rgName && row.rgName.toLowerCase() !== row.key ? `, listed there as ${row.rgName}` : "";
  return `<td class="tp-num" title="${escapeHtml(`RotoGrinders overall rank${listed}`)}">${row.rgRank}</td>`;
}

/** One contest's cell: YES when he entered it (Adam 2026-10-20 2:19 PM: no counts), blank when he did not. */
function yesCell(row, contest) {
  return `<td class="tp-yes">${row.contests[contest.id] ? "YES" : ""}</td>`;
}

function rowHtml(row) {
  const pending = saving.get(row.key);
  const marked = pending ?? model.marked.has(row.key);
  const cls = `tp-row${marked ? " is-marked" : ""}${cursor === row.key ? " is-cursor" : ""}${pending !== undefined ? " is-saving" : ""}`;
  const mark = `<td class="tp-mark"><input type="checkbox" tabindex="-1" aria-label="Mark ${escapeHtml(row.name)}"${marked ? " checked" : ""}></td>`;
  return (
    `<tr class="${cls}" tabindex="0" aria-busy="${pending !== undefined}" data-key="${escapeHtml(row.key)}">` +
    mark +
    `<td class="tp-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}${pending !== undefined ? `<span class="tp-saving">saving…</span>` : ""}</td>` +
    rankCell(row) +
    model.contests.map((c) => yesCell(row, c)).join("") +
    `</tr>`
  );
}

/** Redraws every row of the chosen list (no paging; the box scrolls); keeps keyboard focus on the row that had it. */
function renderBody() {
  if (!model) return; // typing in search or clicking Hide marked before the data loads, or after a failed load
  const focusedKey = document.activeElement?.closest?.("tr.tp-row")?.dataset.key ?? null;
  const all = viewRows(model, view);
  const prevKeys = shownKeys;
  shownKeys = all.map((r) => r.key);
  // The same name stays the keyboard row while it is listed, else the row that took its place; every row is drawn,
  // so Enter never marks a name that is not in the table.
  cursor = cursorAfter(shownKeys, cursor, prevKeys);
  els.tbody.innerHTML = all.length
    ? all.map(rowHtml).join("")
    : `<tr class="tp-empty"><td colspan="${cols.length}">No names match.</td></tr>`;
  if (focusedKey !== null) els.tbody.querySelector(`tr[data-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
}

/** Moves the keyboard row to `key` without redrawing: the old row loses its highlight, the new one gains it (and the focus, and the view if asked). */
function setCursor(key, reveal) {
  if (cursor !== null) els.tbody.querySelector(`tr[data-key="${CSS.escape(cursor)}"]`)?.classList.remove("is-cursor");
  cursor = key;
  const tr = key === null ? null : els.tbody.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
  tr?.classList.add("is-cursor");
  if (reveal && tr) {
    tr.focus({ preventScroll: true });
    tr.scrollIntoView({ block: "nearest" }); // scrolls the table box (the page does not scroll); the row's scroll-margin keeps it clear of the pinned header
  }
}

/** Makes `key` the keyboard row and brings it into view inside the box. */
function showRow(key) {
  setCursor(key, true);
}

/** Down/j and Up/k: steps the keyboard row. */
function moveCursor(delta) {
  const key = stepKey(shownKeys, cursor, delta);
  if (key !== null) showRow(key);
}

/** True when the keyboard row is drawn and visible in the box (below the pinned header): the only time Enter or Space may mark it. */
function cursorOnScreen() {
  const tr = cursor === null ? null : els.tbody.querySelector(`tr[data-key="${CSS.escape(cursor)}"]`);
  if (!tr) return false;
  const r = tr.getBoundingClientRect();
  // Bounded by the window too: at the 420px floor the box can run past the window's edge.
  return r.bottom > Math.max(els.thead.getBoundingClientRect().bottom, 0) && r.top < Math.min(els.box.getBoundingClientRect().bottom, window.innerHeight);
}

/**
 * Sizes the table box (Adam 2026-10-21): the room from its top edge to the window's bottom edge less the page's bottom padding and the foot's height (G64)
 * (420px at least), cut down to whole rows (RULES.md D21: header height + n drawn rows + the box's border allowance, the largest n
 * that fits), so the page never scrolls and no row is cut at the bottom. A fixed height, not a max-height, so a short list leaves
 * the box full. Measured from the box's place in the document, so it holds whatever the page's scroll. scroll-panels.js's
 * snapPanelMaxHeight is not exported, sets a max-height from the rows drawn and reads the Optimizer's own floors, so it is not reused.
 * Also publishes the header row's height as --tp-stick-h, which a row scrolled into view clears.
 */
function layout() {
  const pad = parseFloat(getComputedStyle(document.querySelector("main")).paddingBottom) || 0;
  const top = els.box.getBoundingClientRect().top + window.scrollY;
  const foot = els.foot ? els.foot.offsetHeight : 0; // the notes under the box (G64) take their room from the window too
  const room = Math.max(420, Math.floor(window.innerHeight - top - pad - foot));
  const head = els.thead.getBoundingClientRect().height;
  const rowH = els.tbody.querySelector("tr")?.getBoundingClientRect().height ?? 0; // every row is one line of the same height
  const allowance = els.box.offsetHeight - els.box.clientHeight; // the box's border (and a sideways scrollbar, if any)
  const fit = rowH > 0 ? Math.floor((room - allowance - head) / rowH) : 0;
  els.box.style.height = `${fit > 0 ? Math.ceil(head + fit * rowH + allowance) : room}px`;
  document.documentElement.style.setProperty("--tp-stick-h", `${els.thead.getBoundingClientRect().height}px`);
}

function replaceRow(key) {
  const tr = els.tbody.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
  const row = model.rows.find((r) => r.key === key);
  if (!tr || !row) return;
  const hadFocus = tr === document.activeElement;
  tr.outerHTML = rowHtml(row);
  if (hadFocus) els.tbody.querySelector(`tr[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

async function postMark(name, on) {
  let res;
  try {
    res = await fetch("/api/tracked-players/mark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, on }) });
  } catch (e) {
    return { ok: false, message: `The app did not answer, so the mark was not saved (${e.message}).` };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null; // a reply that is not JSON is reported by status below
  }
  if (!res.ok || !body?.ok) return { ok: false, message: body?.error?.message ?? `The mark was not saved (the app answered ${res.status}).` };
  return { ok: true };
}

/** Posts one mark and applies only that name's new state (code review: a reply to an earlier click never undoes a later one). */
async function save(key, on) {
  const row = model.rows.find((r) => r.key === key);
  const result = await postMark(row.name, on);
  saving.delete(key);
  if (result.ok) {
    clearError();
    model.marked = withMark(model.marked, key, on);
    renderCounts();
  } else {
    showError(result.message);
  }
  // Redrawing all 1,517 rows measured 66-101 ms in headless Chrome, so one name's row is replaced instead, unless the mark can move
  // or hide it (Hide marked on, or the table sorted by the Mark column), which needs the full redraw.
  if (view.hideMarked || view.sort.col === "mark") renderBody();
  else replaceRow(key);
}

function toggle(key) {
  if (saving.has(key) || !model.rows.some((r) => r.key === key)) return;
  if (SITE) {
    siteToggle(key);
    return;
  }
  const on = !model.marked.has(key);
  saving.set(key, on);
  replaceRow(key);
  saves = saves.then(() => save(key, on)).catch((e) => {
    saving.delete(key);
    showError(`The mark could not be shown as saved (${e.message}); reload the page to see what was saved.`);
  });
}

/** On the site: one tick saved in this browser, then the row redrawn as save() does; a tick the browser cannot keep is refused and the row stays as it was. */
function siteToggle(key) {
  const row = model.rows.find((r) => r.key === key);
  const on = !model.marked.has(key);
  const result = saveTick(siteStorage(), bakedKeys, key, row.name, on);
  if (!result.saved) {
    showError(SITE_REFUSED_MESSAGE);
    return;
  }
  siteChanges = result.changes;
  const noteWas = siteUnread;
  siteUnread = result.unread;
  clearError();
  model.marked = withMark(model.marked, key, on);
  renderCounts();
  if (noteWas !== siteUnread) renderSource(sourceData); // the unread note goes once the write has cleared it
  if (view.hideMarked || view.sort.col === "mark") renderBody();
  else replaceRow(key);
}

/** On the site: reads the visitor's saved ticks and the baked marks they lie over, before the model is built. */
function loadSiteMarks(bakedNames) {
  const saved = readSiteMarks(siteStorage());
  siteChanges = saved.changes;
  siteUnread = saved.unread;
  bakedKeys = new Set(bakedNames.map(lowerKey));
}

/** The source line's note on saved ticks that could not be read (G62), or "" when all were read. */
function siteUnreadText() {
  if (!SITE || siteUnread === 0) return "";
  if (siteUnread < 0) return "Your saved ticks in this browser could not be read, so none are applied; the next tick replaces them.";
  const one = siteUnread === 1;
  return `${siteUnread} saved tick${one ? "" : "s"} in this browser could not be read and ${one ? "is" : "are"} left out; the next tick removes ${one ? "it" : "them"}.`;
}

function wireBack() {
  els.back.setAttribute("href", backTarget(window.location.search));
  els.back.addEventListener("click", (e) => {
    if (cameFromApp(document.referrer, window.location.origin, window.location.pathname) && window.history.length > 1) {
      e.preventDefault();
      window.history.back();
    }
  });
}

function wire() {
  wireBack();
  els.search.addEventListener("input", () => typedSearch.schedule("search", { query: els.search.value })); // the redraw waits for a pause in typing
  els.lists.addEventListener("click", (e) => {
    const b = e.target.closest("[data-list]");
    if (!b || b.dataset.list === view.list) return;
    view.list = b.dataset.list;
    renderLists();
    renderToggles();
    renderBody();
  });
  els.hideMarked.addEventListener("click", () => { view.hideMarked = !view.hideMarked; renderToggles(); renderBody(); });
  els.thead.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-col]");
    if (!th) return;
    view.sort = nextSort(view.sort, th.dataset.col, cols);
    renderHead();
    renderBody();
  });
  els.tbody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr.tp-row");
    if (!tr) return;
    setCursor(tr.dataset.key, false);
    toggle(tr.dataset.key);
  });
  els.tbody.addEventListener("focusin", (e) => { // Tab onto a row makes it the keyboard row
    const tr = e.target.closest("tr.tp-row");
    if (tr && tr.dataset.key !== cursor) setCursor(tr.dataset.key, false);
  });
  wireKeys();
}

/**
 * Down/j and Up/k move the keyboard row from anywhere but a text field, so they work right after a chip is picked; Enter and Space
 * mark it (the click's save path), but not on a button or link, where they press that control, and not while held down. A mark is
 * made only when the keyboard row is on screen; if it is not, the key brings it into view and marks nothing.
 */
function wireKeys() {
  document.addEventListener("keydown", (e) => {
    const on = (selector) => e.target.closest?.(selector);
    if (e.ctrlKey || e.metaKey || e.altKey || on("input, textarea, select, [contenteditable]")) return;
    const step = keyStep(e.key);
    if (step !== 0) {
      e.preventDefault(); // the arrow keys would scroll the box
      moveCursor(step);
    } else if ((e.key === "Enter" || e.key === " ") && cursor !== null && !on("button, a")) {
      e.preventDefault(); // Space would scroll the box
      if (e.repeat) return; // a held key marks once, not on every finished save
      if (cursorOnScreen()) toggle(cursor);
      else showRow(cursor);
    }
  });
  layout();
  if (typeof ResizeObserver !== "undefined") { // the chips wrapping moves the box's top edge; the foot's lines wrapping moves its bottom
    const observer = new ResizeObserver(layout);
    observer.observe(els.bar);
    if (els.foot) observer.observe(els.foot);
  }
  window.addEventListener("resize", layout);
}

/** The source line: each contest group's live-or-final state and time, and where the RG rank comes from (its page on hover). */
function renderSource(data) {
  const built = when(data.lists.builtAt);
  const unread = siteUnreadText();
  const rgSource = data.registry.rotogrindersSource;
  const rg = rgSource ? `<span class="tp-hint" title="${escapeHtml(rgSource)}">RG rank: RotoGrinders overall rankings</span>` : "RG rank: source not recorded";
  els.source.innerHTML =
    `<span class="tp-hint" title="${escapeHtml(`${data.listsFolder ?? "lists"}, built ${built ?? "at an unknown time"}`)}">DraftKings standings</span> &middot; ` +
    `${escapeHtml(snapshotSummary(model.contests, when, columnCounts(model)))} &middot; ${rg}${unread ? ` &middot; ${escapeHtml(unread)}` : ""}`;
}

async function init() {
  wire();
  els.readOnly.hidden = !SITE;
  let data;
  try {
    const res = await fetch(TRACKED_URL);
    data = await res.json();
    if (!data?.ok) throw new Error(data?.error?.message ?? `the app answered ${res.status}`);
  } catch (e) {
    els.counts.textContent = "Not loaded";
    showError(`The tracked players could not be loaded: ${e.message}`);
    return;
  }
  let registry = data.registry;
  if (SITE) {
    loadSiteMarks(data.registry.adam);
    registry = { ...data.registry, adam: marksWith(data.registry.adam, siteChanges) };
  }
  model = buildModel(registry, data.lists);
  counts = listCounts(model);
  cols = columnsFor(model.contests, columnCounts(model));
  sourceData = data;
  renderSource(data);
  renderCounts();
  renderLists();
  renderToggles();
  renderHead();
  renderBody();
  layout(); // the header row now has its height
}

if (typeof document !== "undefined" && els.tbody) {
  const { wireThemeToggle } = await import("./header.js");
  wireThemeToggle(document.getElementById("theme-toggle-btn"));
  init();
}
