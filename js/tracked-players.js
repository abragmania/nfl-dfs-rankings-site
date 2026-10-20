// The Tracked DFS players page (public/tracked-players.html; Adam 2026-10-20: "make it something I can sort and click through
// that isn't ugly"): one sortable table of DraftKings usernames from the contest standings Adam uploaded, the RotoGrinders top 100
// and his marks. Clicking a row (or Enter or Space on it) marks or unmarks the name at once through POST /api/tracked-players/mark.
// What to show is worked out in tracked-players-view.js (pure, tested); this file only draws it and wires the controls.
// On the public site (D71) the page shows the same list read-only: tools/publish.mjs rewrites TRACKED_URL to the baked copy,
// which is how the page knows where it runs, and marking is left to the app.
import { escapeHtml, localStamp } from "./format.js";
import { sortArrowHtml } from "./table.js";
import { cameFromApp, backTarget } from "./showdown/salary-used.js";
import {
  PAGE_SIZE, LIST_CHOICES, DEFAULT_SORT, buildModel, listCounts, listLabels, viewRows, page, badgesFor, entriesOf, statsOver,
  shownContestIds, nextSort, withMark, namesInContests, shareText, multiPossible, columnsFor, snapshotText, snapshotSummary,
} from "./tracked-players-view.js";

const TRACKED_URL = "baked/tracked-players.json";
const SITE = TRACKED_URL.startsWith("baked/");
const COLS = columnsFor(SITE);
const HEADER_TITLES = {
  best: "The best placing as a share of its contest's field (top 1% = in the first hundredth); sorted by that share",
  rg: "RotoGrinders overall rank",
};

const els = {
  counts: document.getElementById("tp-counts"),
  search: document.getElementById("tp-search"),
  back: document.getElementById("tp-back"),
  error: document.getElementById("tp-error"),
  readOnly: document.getElementById("tp-readonly"),
  lists: document.getElementById("tp-lists"),
  hideMarked: document.getElementById("tp-hide-marked"),
  multi: document.getElementById("tp-multi"),
  source: document.getElementById("tp-source"),
  thead: document.getElementById("tp-thead"),
  tbody: document.getElementById("tp-tbody"),
  showing: document.getElementById("tp-showing"),
  more: document.getElementById("tp-more"),
};

const view = { list: "crossover", query: "", hideMarked: false, multiOnly: false, sort: { ...DEFAULT_SORT }, limit: PAGE_SIZE };
let model = null;
let counts = null;
let labels = null;
let multiOk = null; // list id -> whether anyone on it has 2+ entries in its contests
const saving = new Map(); // key -> the state being saved (true = marking)
let saves = Promise.resolve(); // marks are posted one at a time, in click order

const fmt = (n) => n.toLocaleString("en-US");

/** "Oct 19 23:08" from an ISO time, or null. */
function when(iso) {
  const s = localStamp(iso);
  return s ? `${s.monthDay} ${s.clock}` : null;
}

/** "final" or the live snapshot's wording (tracked-players-view.js snapshotText) for a contest or a best placing. */
const stateText = (live, at) => snapshotText(live, at, when);

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
      `${escapeHtml(labels[l.id])} <span class="tp-list-count">${fmt(counts[l.id])}</span></button>`
  ).join("");
}

function renderToggles() {
  const possible = multiOk[view.list];
  els.multi.disabled = !possible;
  els.multi.title = possible ? "2 or more entries in one contest (on a contest's own list, in that contest)" : "single-entry contest";
  for (const [btn, on] of [[els.hideMarked, view.hideMarked], [els.multi, view.multiOnly && possible]]) {
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  }
}

function renderHead() {
  els.thead.innerHTML = `<tr>${COLS.map((c) => {
    const active = view.sort.col === c.id;
    const aria = active ? ` aria-sort="${view.sort.dir === "asc" ? "ascending" : "descending"}"` : "";
    const title = HEADER_TITLES[c.id] ? ` title="${escapeHtml(HEADER_TITLES[c.id])}"` : "";
    return `<th class="tp-col-${c.id}${active ? " sorted" : ""}" data-col="${c.id}"${aria}${title}>${escapeHtml(c.label)}${sortArrowHtml(active, view.sort.dir, true)}</th>`;
  }).join("")}</tr>`;
}

function bestCell(best) {
  if (!best) return `<td class="tp-num tp-missing">&mdash;</td>`;
  const title = `Best placing: #${fmt(best.rank)} of ${fmt(best.of)} entries in ${best.label} (${stateText(best.live, best.snapshotAt)})`;
  return `<td class="tp-num" title="${escapeHtml(title)}">${shareText(best.frac)}<span class="tp-of"> #${fmt(best.rank)} / ${fmt(best.of)}</span></td>`;
}

function rowHtml(row) {
  const pending = saving.get(row.key);
  const marked = pending ?? model.marked.has(row.key);
  const badges = badgesFor(row, model.contests, model.marked); // the Marked badge changes once the save is confirmed
  const ent = entriesOf(row, model.contests);
  const stats = statsOver(row, shownContestIds(view.list, model.contests), model.contests);
  const split = ent.split.map((x) => `${x.label}: ${fmt(x.entries)}`).join("\n");
  const rg = row.rgRank ? `<td class="tp-num" title="RotoGrinders overall rank${row.rgName && row.rgName.toLowerCase() !== row.key ? `, listed there as ${escapeHtml(row.rgName)}` : ""}">${row.rgRank}</td>` : `<td class="tp-num tp-missing">&mdash;</td>`;
  const cls = `tp-row${marked ? " is-marked" : ""}${pending !== undefined ? " is-saving" : ""}${SITE ? " is-read-only" : ""}`;
  const mark = SITE ? "" : `<td class="tp-mark"><input type="checkbox" tabindex="-1" aria-label="Mark ${escapeHtml(row.name)}"${marked ? " checked" : ""}></td>`;
  return (
    `<tr class="${cls}"${SITE ? "" : ` tabindex="0" aria-busy="${pending !== undefined}"`} data-key="${escapeHtml(row.key)}">` +
    mark +
    `<td class="tp-name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td>` +
    `<td class="tp-on">${badges.map((b) => `<span class="tp-badge tp-badge-${b.slot}" title="${escapeHtml(b.title)}">${escapeHtml(b.short)}</span>`).join("")}${pending !== undefined ? `<span class="tp-saving">saving…</span>` : ""}</td>` +
    `<td class="tp-num"${split ? ` title="${escapeHtml(split)}"` : ""}>${ent.total ? fmt(ent.total) : `<span class="tp-missing" title="In none of these contests">0</span>`}</td>` +
    bestCell(stats.best) +
    `<td class="tp-num">${stats.avg === null ? `<span class="tp-missing">&mdash;</span>` : stats.avg.toFixed(1)}</td>` +
    rg +
    `</tr>`
  );
}

/** Redraws the rows, the "showing X of Y" line and the More button; keeps keyboard focus on the row that had it. */
function renderBody() {
  const focusedKey = document.activeElement?.closest?.("tr.tp-row")?.dataset.key ?? null;
  const p = page(viewRows(model, { ...view, multiOnly: view.multiOnly && multiOk[view.list] }), view.limit);
  els.tbody.innerHTML = p.shown.length
    ? p.shown.map(rowHtml).join("")
    : `<tr class="tp-empty"><td colspan="${COLS.length}">No names match.</td></tr>`;
  els.showing.textContent = `showing ${fmt(p.showing)} of ${fmt(p.total)}`;
  els.more.hidden = !p.more;
  els.more.textContent = `Show ${fmt(Math.min(PAGE_SIZE, p.total - p.showing))} more`;
  if (focusedKey !== null) els.tbody.querySelector(`tr[data-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
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
  els.multi.addEventListener("click", () => { view.multiOnly = !view.multiOnly; view.limit = PAGE_SIZE; renderToggles(); renderBody(); });
  els.thead.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-col]");
    if (!th) return;
    view.sort = nextSort(view.sort, th.dataset.col);
    renderHead();
    renderBody();
  });
  els.tbody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr.tp-row");
    if (tr) toggle(tr.dataset.key);
  });
  els.tbody.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tr = e.target.closest("tr.tp-row");
    if (!tr || e.target !== tr || SITE) return;
    e.preventDefault(); // Space would scroll the page
    toggle(tr.dataset.key);
  });
  els.more.addEventListener("click", () => { view.limit += PAGE_SIZE; renderBody(); });
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
  labels = listLabels(model.contests);
  multiOk = Object.fromEntries(LIST_CHOICES.map((l) => [l.id, multiPossible(model, l.id)]));
  renderSource(data);
  renderCounts();
  renderLists();
  renderToggles();
  renderHead();
  renderBody();
}

if (typeof document !== "undefined" && els.tbody) {
  const { wireThemeToggle } = await import("./header.js");
  wireThemeToggle(document.getElementById("theme-toggle-btn"));
  init();
}
