// The Tracked DFS players page (public/tracked-players.html; Adam 2026-10-20: "make it something I can sort and click through
// that isn't ugly"): one sortable table of DraftKings usernames: the RotoGrinders top-100 rank and YES for each WAS@SF contest entered
// from the standings Adam uploaded (2:10 PM: columns, not tags; contest results are not shown). Clicking a row, or Enter or Space on the
// keyboard row (arrow keys or j and k move it), marks or unmarks the name at once through POST /api/tracked-players/mark.
// What to show is worked out in tracked-players-view.js (pure, tested); this file only draws it and wires the controls.
// On the public site (D71) the page shows the same list read-only: tools/publish.mjs rewrites TRACKED_URL to the baked copy,
// which is how the page knows where it runs, and marking is left to the app.
import { escapeHtml, localStamp } from "./format.js";
import { sortArrowHtml } from "./table.js";
import { cameFromApp, backTarget } from "./showdown/salary-used.js";
import {
  PAGE_SIZE, LIST_CHOICES, DEFAULT_SORT, buildModel, listCounts, viewRows, page, nextSort, withMark, namesInContests,
  columnsFor, snapshotSummary, keyStep, stepKey, cursorAfter, limitToShow,
} from "./tracked-players-view.js";

const TRACKED_URL = "baked/tracked-players.json";
const SITE = TRACKED_URL.startsWith("baked/");
let cols = columnsFor(SITE, []); // the contests' columns join them once the lists load

const els = {
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
  showing: document.getElementById("tp-showing"),
  more: document.getElementById("tp-more"),
  foot: document.getElementById("tp-foot"),
  bar: document.getElementById("tp-bar"),
  keys: document.getElementById("tp-keys"),
};
const view = { list: "all", query: "", hideMarked: false, sort: { ...DEFAULT_SORT }, limit: PAGE_SIZE };
let model = null;
let counts = null;
let cursor = null; // the keyboard row's name key, or null until an arrow key or a click picks one
let shownKeys = []; // every row of the current list, in order (not just the loaded page): where the arrow keys step
let hasMore = false; // rows beyond the loaded page
let footObserver = null;
const saving = new Map(); // key -> the state being saved (true = marking)
let saves = Promise.resolve(); // marks are posted one at a time, in click order

const fmt = (n) => n.toLocaleString("en-US");

/** "Oct 19 23:08" from an ISO time, or null. */
function when(iso) {
  const s = localStamp(iso);
  return s ? `${s.monthDay} ${s.clock}` : null;
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}
function clearError() {
  els.error.hidden = true;
  els.error.textContent = "";
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
  const cls = `tp-row${marked ? " is-marked" : ""}${cursor === row.key ? " is-cursor" : ""}${pending !== undefined ? " is-saving" : ""}${SITE ? " is-read-only" : ""}`;
  const mark = SITE ? "" : `<td class="tp-mark"><input type="checkbox" tabindex="-1" aria-label="Mark ${escapeHtml(row.name)}"${marked ? " checked" : ""}></td>`;
  return (
    `<tr class="${cls}"${SITE ? "" : ` tabindex="0" aria-busy="${pending !== undefined}"`} data-key="${escapeHtml(row.key)}">` +
    mark +
    `<td class="tp-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}${pending !== undefined ? `<span class="tp-saving">saving…</span>` : ""}</td>` +
    rankCell(row) +
    model.contests.map((c) => yesCell(row, c)).join("") +
    `</tr>`
  );
}

/** Redraws the rows, the "showing X of Y" line and the More button; keeps keyboard focus on the row that had it. */
function renderBody() {
  if (!model) return; // typing in search or clicking Hide marked before the data loads, or after a failed load
  const focusedKey = document.activeElement?.closest?.("tr.tp-row")?.dataset.key ?? null;
  const all = viewRows(model, view);
  const prevKeys = shownKeys;
  shownKeys = all.map((r) => r.key);
  // The same name stays the keyboard row while it is listed, else the row that took its place; the rows drawn always reach it,
  // so Enter never marks a name that is not on screen.
  cursor = cursorAfter(shownKeys, cursor, prevKeys);
  view.limit = limitToShow(shownKeys, cursor, view.limit, PAGE_SIZE);
  const p = page(all, view.limit);
  hasMore = p.more;
  els.tbody.innerHTML = p.shown.length
    ? p.shown.map(rowHtml).join("")
    : `<tr class="tp-empty"><td colspan="${cols.length}">No names match.</td></tr>`;
  els.showing.textContent = `showing ${fmt(p.showing)} of ${fmt(p.total)}`;
  els.more.hidden = !p.more;
  els.more.textContent = `Show ${fmt(Math.min(PAGE_SIZE, p.total - p.showing))} more`;
  if (focusedKey !== null) els.tbody.querySelector(`tr[data-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
  // Observing again makes the observer report the footer's present state, so a footer still in view after a load loads the next page.
  if (footObserver) {
    footObserver.unobserve(els.foot);
    footObserver.observe(els.foot);
  }
}

/** Moves the keyboard row to `key` without redrawing: the old row loses its highlight, the new one gains it (and the focus, and the view if asked). */
function setCursor(key, reveal) {
  if (cursor !== null) els.tbody.querySelector(`tr[data-key="${CSS.escape(cursor)}"]`)?.classList.remove("is-cursor");
  cursor = key;
  const tr = key === null ? null : els.tbody.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
  tr?.classList.add("is-cursor");
  if (reveal && tr) {
    tr.focus({ preventScroll: true });
    tr.scrollIntoView({ block: "nearest" }); // the row's scroll-margin keeps it clear of the pinned bar and header
  }
}

/** Makes `key` the keyboard row and brings it into view, drawing more rows first when it lies past those drawn. */
function showRow(key) {
  view.limit = limitToShow(shownKeys, key, view.limit, PAGE_SIZE);
  if (els.tbody.querySelector(`tr[data-key="${CSS.escape(key)}"]`) === null) {
    cursor = key;
    renderBody();
  }
  setCursor(key, true);
}

/** Down/j and Up/k: steps the keyboard row. */
function moveCursor(delta) {
  const key = stepKey(shownKeys, cursor, delta);
  if (key !== null) showRow(key);
}

/** True when the keyboard row is drawn and on screen (below the pinned bar and header): the only time Enter or Space may mark it. */
function cursorOnScreen() {
  const tr = cursor === null ? null : els.tbody.querySelector(`tr[data-key="${CSS.escape(cursor)}"]`);
  if (!tr) return false;
  const r = tr.getBoundingClientRect();
  return r.bottom > els.thead.getBoundingClientRect().bottom && r.top < window.innerHeight;
}

/** Pins the table header just under the chip bar: publishes the bar's and the bar-plus-header heights as CSS variables. */
function measureStick() {
  const bar = els.bar.getBoundingClientRect().height;
  const head = els.thead.getBoundingClientRect().height;
  document.documentElement.style.setProperty("--tp-bar-h", `${bar}px`);
  document.documentElement.style.setProperty("--tp-stick-h", `${bar + head}px`);
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
  renderBody();
}

function toggle(key) {
  if (SITE || saving.has(key) || !model.rows.some((r) => r.key === key)) return;
  const on = !model.marked.has(key);
  saving.set(key, on);
  replaceRow(key);
  saves = saves.then(() => save(key, on)).catch((e) => {
    saving.delete(key);
    showError(`The mark could not be shown as saved (${e.message}); reload the page to see what was saved.`);
  });
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
  els.search.addEventListener("input", () => {
    view.query = els.search.value;
    view.limit = PAGE_SIZE;
    renderBody();
  });
  els.lists.addEventListener("click", (e) => {
    const b = e.target.closest("[data-list]");
    if (!b || b.dataset.list === view.list) return;
    view.list = b.dataset.list;
    view.limit = PAGE_SIZE;
    renderLists();
    renderToggles();
    renderBody();
  });
  els.hideMarked.addEventListener("click", () => { view.hideMarked = !view.hideMarked; view.limit = PAGE_SIZE; renderToggles(); renderBody(); });
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
  els.more.addEventListener("click", loadMore);
  wireKeys();
  wireScrollLoad();
}

function loadMore() {
  if (!hasMore) return;
  view.limit += PAGE_SIZE;
  renderBody();
}

/** Rows load as the footer scrolls into view; the Show more button stays as the fallback where there is no IntersectionObserver. */
function wireScrollLoad() {
  if (typeof IntersectionObserver === "undefined") return;
  footObserver = new IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting)) loadMore(); }, { rootMargin: "400px 0px" });
  footObserver.observe(els.foot);
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
      e.preventDefault(); // the arrow keys would scroll the page
      moveCursor(step);
    } else if ((e.key === "Enter" || e.key === " ") && cursor !== null && !SITE && !on("button, a")) {
      e.preventDefault(); // Space would scroll the page
      if (e.repeat) return; // a held key marks once, not on every finished save
      if (cursorOnScreen()) toggle(cursor);
      else showRow(cursor);
    }
  });
  measureStick();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(measureStick).observe(els.bar);
  window.addEventListener("resize", measureStick);
  if (SITE) els.keys.textContent = "↑ ↓ move";
}

/** The source line: each contest group's live-or-final state and time, and where the RG rank comes from (its page on hover). */
function renderSource(data) {
  const built = when(data.lists.builtAt);
  const rgSource = data.registry.rotogrindersSource;
  const rg = rgSource ? `<span class="tp-hint" title="${escapeHtml(rgSource)}">RG rank: RotoGrinders overall rankings</span>` : "RG rank: source not recorded";
  els.source.innerHTML =
    `<span class="tp-hint" title="${escapeHtml(`${data.listsFolder ?? "lists"}, built ${built ?? "at an unknown time"}`)}">DraftKings standings</span> &middot; ` +
    `${escapeHtml(snapshotSummary(model.contests, when))} &middot; ${rg}`;
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
  model = buildModel(data.registry, data.lists);
  counts = listCounts(model);
  cols = columnsFor(SITE, model.contests);
  renderSource(data);
  renderCounts();
  renderLists();
  renderToggles();
  renderHead();
  measureStick(); // the header row now has its height
  renderBody();
}

if (typeof document !== "undefined" && els.tbody) {
  const { wireThemeToggle } = await import("./header.js");
  wireThemeToggle(document.getElementById("theme-toggle-btn"));
  init();
}
