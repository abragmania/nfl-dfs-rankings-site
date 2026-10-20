// The Sources page (Adam 2026-10-18): ONE screen, used by classic and Showdown alike, where he ticks which sources feed each
// number, edits their weights, and sees when each was last pulled and posted. Markup is in sources-page-html.js; this file
// reads and saves the choices (GET and POST /api/source-selection) and keeps the page in step with the board.
//   - A tick, a preset, a gaps toggle saves at once; a weight saves 300 ms after the last keystroke, or at once on change, Enter
//     or leaving the box. Saves run one at a time. The page redraws from the server's answer, then the board repaints through
//     ctx.onChanged (a plain board read: nothing is re-downloaded from a source).
//   - A refused save puts the old value back and shows the server's own words under the row.
//   - The public site and sample data have no selection route: the page is built from the board it holds (sources-page-board.js). On the
//     site's classic page a tick or a weight is kept in the visitor's browser and the board re-ranks there (D71); everything else
//     there (a Showdown page, sample data, or the server saying writable:false) is read-only with every control disabled and no save.
import { escapeHtml } from "./format.js";
import { onSitePage } from "./tabs.js";
import { isSampleMode, getBoard, postSources, postMode } from "./api.js";
import { selectionHtml, playersHeadHtml, sharePercents, WEIGHT_MIN, WEIGHT_MAX } from "./sources-page-html.js";
import { selectionFromBoard, makeSiteApi, unmatchedRows } from "./sources-page-board.js";

export const DEBOUNCE_MS = 300;
export const SAVED_MS = 1600;
export { selectionHtml, playersHeadHtml, sharePercents, sourceIsTicked } from "./sources-page-html.js";
export { selectionFromBoard } from "./sources-page-board.js";

const SKELETON = `<div class="sources-page"><div class="sp-controls"></div><div class="sp-players-head"></div></div>`;
export const NOT_A_LIST = "The server answered, but not with a list of sources the page can read.";
const siteApi = makeSiteApi({ getBoard, postSources, postMode });

// ---------- the network ----------

function errorText(error) {
  if (typeof error === "string") return error;
  return error?.message ?? null;
}

const isSelection = (b) => Array.isArray(b?.sections) && b.sections.every((s) => Array.isArray(s?.sources));

async function parseResponse(res) {
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`The server answered ${res.status} with something that is not JSON.`);
  }
  if (!res.ok || body?.error) throw new Error(errorText(body?.error) ?? `The server answered ${res.status}.`);
  if (!isSelection(body)) throw new Error(NOT_A_LIST);
  return body;
}

const urlFor = (slate, route = "") => `/api/source-selection${route}?slate=${encodeURIComponent(slate)}`;
const postJson = async (url, body) => parseResponse(await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
export const defaultApi = {
  get: async (slate) => parseResponse(await fetch(urlFor(slate))),
  post: async (slate, change) => postJson(urlFor(slate), change),
  // Copies this slate's shown choices to the main slate and every loaded game (server/sources/selection-routes.js handleApplyAll); answers this slate's body.
  applyAll: async (slate) => postJson(urlFor(slate, "/apply-all"), {}),
};
/** The window event after "apply to every game" saved: the main slate's board the browser holds is out of date, and app.js reloads it.
 *  showdown/view.js needs no listener: it holds only the game on screen, which this page repaints itself (ctx.onChanged), and it loads
 *  any other game afresh when that game is opened (renderShowdownView reloads when the key changes). */
export const APPLIED_ALL_EVENT = "nfldfs:sources-applied-all";
const APPLY_ALL_IN_APP = "Applying to every game runs in the app.";

// ---------- the page ----------

const pages = new WeakMap();
const known = new Map(); // slate -> the last selection drawn for it, which the player tables below the page read (tickedSourceIds)

/**
 * The sources ticked in one section of the last selection the page drew for `slate`, as [{id, label}] in the page's order, or null
 * when no selection has been drawn for it yet (the player tables then fall back to the board's own source list).
 */
export function tickedSourceIds(slate, kind) {
  const sec = known.get(slate)?.sections.find((s) => s.kind === kind);
  return sec ? sec.sources.filter((s) => s.use).map((s) => ({ id: s.id, label: s.label })) : null;
}

/**
 * Every source in one section of the last selection drawn for `slate`, ticked or not, as [{id, label, use, status, note}] in the page's
 * order, or null before one is drawn. The Showdown player tables read it to dim an unticked source's column and to say why a table
 * is all dashes (the server's own note for the ticked source).
 */
export function sectionSources(slate, kind) {
  const sec = known.get(slate)?.sections.find((s) => s.kind === kind);
  return sec ? sec.sources.map((s) => ({ id: s.id, label: s.label, use: s.use, status: s.status, note: s.note ?? null })) : null;
}

function pageOf(container) {
  if (!pages.has(container)) {
    pages.set(container, { data: null, key: null, slate: null, loadError: null, fetchingKey: null, hold: false, local: false, errors: new Map(), drafts: new Map(), timers: new Map(), savedKey: null, savedTimer: null, chain: Promise.resolve(), saveSeq: 0, lastSent: new Map(), openRecipes: new Set() });
  }
  return pages.get(container);
}

// The page builds its selection from the board (no selection route) on the public site and on sample data, or when the caller says so.
const fromBoard = (ctx) => Boolean(ctx.readOnly) || onSitePage() || (typeof window !== "undefined" && isSampleMode());
const isReadOnly = (st) => Boolean(st.ctx.readOnly) || st.data?.writable === false;
const keyOf = (ctx) => `${ctx.slate}|${ctx.board?.generatedAt ?? ""}`;
const rowKeyOf = (el) => `${el.dataset.kind}/${el.dataset.id}`;
// A value inside a quoted attribute selector: CSS.escape where the browser has it, else the same backslash escapes.
const cssEsc = (v) => (typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(String(v)) : String(v).replace(/[^\w-]/g, (c) => `\\${c}`));

function rememberFocus() {
  const a = typeof document !== "undefined" ? document.activeElement : null;
  return a?.dataset?.sp ? { sp: a.dataset.sp, kind: a.dataset.kind, id: a.dataset.id } : null;
}

function restoreFocus(st, f) {
  if (!f || typeof st.controlsEl.querySelector !== "function") return;
  const el = st.controlsEl.querySelector(`[data-sp="${cssEsc(f.sp)}"][data-kind="${cssEsc(f.kind)}"][data-id="${cssEsc(f.id)}"]`);
  if (el && !el.disabled) el.focus({ preventScroll: true });
}

function viewOf(st) {
  return { ro: isReadOnly(st), errors: st.errors, drafts: st.drafts, savedKey: st.savedKey, unmatched: unmatchedRows(st.ctx, st.data), openRecipes: st.openRecipes };
}

function pageHtml(st) {
  if (st.data) {
    // A failed re-read while the last read is still on screen says so (otherwise the page would look current).
    const stale = st.loadError ? `<p class="sp-note sp-warn">Could not re-read the source settings: ${escapeHtml(st.loadError)}; showing the last read.</p>` : "";
    return `${stale}${selectionHtml(st.data, viewOf(st))}`;
  }
  if (st.loadError) return `<p class="sp-note sp-warn">Could not read the source settings: ${escapeHtml(st.loadError)}. Nothing is assumed; the board keeps using what it had.</p>`;
  return `<p class="sp-note">Reading the source settings…</p>`;
}

function draw(st) {
  const focus = rememberFocus();
  if (st.data) known.set(st.ctx.slate, st.data);
  st.controlsEl.innerHTML = pageHtml(st);
  restoreFocus(st, focus);
  // The page's height just changed, and the player table below it is sized from its top edge (app.js adjustScrollPanels listens for resize).
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("resize"));
}

// ---------- saving ----------

function markSaved(st, rowKey) {
  st.savedKey = rowKey;
  clearTimeout(st.savedTimer);
  st.savedTimer = setTimeout(() => { st.savedKey = null; }, SAVED_MS);
  st.savedTimer?.unref?.(); // a test process is not kept waiting for the check mark to fade
}

async function repaintBoard(st, rowKey) {
  try {
    await st.ctx.onChanged?.();
  } catch (e) {
    st.errors.set(rowKey, `Saved, but the board could not be refreshed: ${e.message}`);
    draw(st);
  }
}

// A typed weight is dropped once its save is answered, but only if the box still holds what was sent and no timer is waiting to send more:
// keystrokes made while the save was in flight stay (a ".5" typed after "1" was sent must not be wiped by the answer for "1").
function settleDraft(st, rowKey, change) {
  const draft = st.drafts.get(rowKey);
  if (draft !== undefined && change.weight !== undefined && Number(draft) === change.weight && !st.timers.has(rowKey)) st.drafts.delete(rowKey);
}

// The slate the answer belongs to is not the one on screen any more: its answer is dropped, and the page's own slate is read again.
function discardAnswer(st) {
  if (st.local || (st.data && st.slate === st.ctx.slate)) return;
  st.fetchingKey = null;
  load(st, keyOf(st.ctx));
}

async function doSave(st, change, rowKey, slate, send = (s, c) => st.api.post(s, c)) {
  if (isReadOnly(st)) return;
  const showing = st.ctx.slate === slate; // a save made on a slate that is no longer showing must not disturb the read of the one that is
  if (showing) {
    st.errors.delete(rowKey);
    st.saveSeq += 1; // a read of the selection that started before this save must not overwrite its answer (load)
  }
  st.hold = showing; // the board repaint that follows must not trigger a second read of the selection just saved
  try {
    let next;
    try {
      next = await send(slate, change);
    } catch (e) {
      if (st.ctx.slate !== slate) return discardAnswer(st); // another slate's refusal is not shown on this one
      st.errors.set(rowKey, e.message);
      settleDraft(st, rowKey, change);
      draw(st); // the old value goes back
      return;
    }
    if (st.ctx.slate !== slate) return discardAnswer(st);
    st.data = next;
    st.loadError = null;
    st.errors.clear(); // a save that worked leaves no refusal standing on any row
    settleDraft(st, rowKey, change);
    markSaved(st, rowKey);
    draw(st);
    await repaintBoard(st, rowKey);
    st.key = keyOf(st.ctx);
  } finally {
    st.hold = false;
    st.lastSent.delete(rowKey);
  }
}

function failSave(st, rowKey, e) {
  st.errors.set(rowKey, `Could not save: ${e?.message ?? e}`);
  st.drafts.delete(rowKey);
  draw(st);
}

/** Saves one change, after any save already running, to the slate showing now. Resolves when this save and the board repaint are done; never rejects.
 *  `send(slate, change)` is the request (default: POST /api/source-selection). */
export function saveChange(st, change, rowKey, send) {
  const slate = st.ctx.slate;
  // The first catch only keeps one save's failure (already reported under its row) from stopping the saves queued behind it.
  st.chain = st.chain.catch(() => undefined).then(() => doSave(st, change, rowKey, slate, send)).catch((e) => failSave(st, rowKey, e));
  return st.chain;
}

/** "Apply to the main slate and every game" (Adam 2026-10-20): queued like a save; the page redraws from the answer (this slate's
 *  choices), this board repaints, and the window hears that every other board it holds is out of date. */
export function applyAll(st) {
  if (typeof st.api.applyAll !== "function") {
    st.errors.set("apply-all", APPLY_ALL_IN_APP);
    draw(st);
    return Promise.resolve();
  }
  return saveChange(st, {}, "apply-all", async (slate) => {
    const next = await st.api.applyAll(slate);
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent(APPLIED_ALL_EVENT, { detail: { slate } }));
    return next;
  });
}

function sourceOf(st, kind, id) {
  return st.data?.sections.find((s) => s.kind === kind)?.sources.find((s) => s.id === id) ?? null;
}

function clearTimer(st, rowKey) {
  clearTimeout(st.timers.get(rowKey));
  st.timers.delete(rowKey);
}

// The server's own rule for a weight (server/sources/selection-core.js weightProblem), in the page's words; null when it is fine.
function weightProblem(typed, weight) {
  if (typed === "" || !Number.isFinite(weight) || weight < WEIGHT_MIN || weight > WEIGHT_MAX) return `A weight is a number from ${WEIGHT_MIN} to ${WEIGHT_MAX}.`;
  if (Math.abs(weight * 100 - Math.round(weight * 100)) > 1e-9) return "A weight can have at most two decimals.";
  return null;
}

/** Saves the weight typed in `input` if it is a valid new weight; otherwise puts the old one back with a plain reason. */
export function flushWeight(st, input) {
  const rowKey = rowKeyOf(input);
  clearTimer(st, rowKey);
  const typed = String(input.value).trim();
  const weight = Number(typed);
  const src = sourceOf(st, input.dataset.kind, input.dataset.id);
  if (!src) return Promise.resolve();
  const problem = weightProblem(typed, weight);
  if (problem) {
    st.errors.set(rowKey, problem);
    st.drafts.delete(rowKey);
    draw(st);
    return Promise.resolve();
  }
  if (weight === Number(src.weight)) {
    // Back to the saved weight: nothing to send, and a refusal still shown under the row no longer applies (👁 finding 3).
    st.drafts.delete(rowKey);
    if (st.errors.delete(rowKey)) draw(st);
    return Promise.resolve();
  }
  if (st.lastSent.get(rowKey) === weight) return st.chain; // Enter, then the change event it causes: one save
  st.lastSent.set(rowKey, weight);
  return saveChange(st, { kind: input.dataset.kind, sourceId: input.dataset.id, weight }, rowKey);
}

// The live shares ("40%") follow what is typed, before anything is saved.
function updateShares(st, kind) {
  const sec = st.data?.sections.find((s) => s.kind === kind);
  if (!sec || typeof st.controlsEl.querySelector !== "function") return;
  const drafts = new Map([...st.drafts].filter(([k]) => k.startsWith(`${kind}/`)).map(([k, v]) => [k.slice(kind.length + 1), v]));
  const shares = sharePercents(sec.sources, drafts);
  for (const s of sec.sources) {
    const el = st.controlsEl.querySelector(`[data-share="${cssEsc(`${kind}/${s.id}`)}"]`);
    if (el) el.textContent = shares.has(s.id) ? `${shares.get(s.id)}%` : "";
  }
}

function onWeightInput(st, input) {
  const rowKey = rowKeyOf(input);
  const { kind, id } = input.dataset;
  st.drafts.set(rowKey, input.value);
  updateShares(st, kind);
  clearTimer(st, rowKey);
  // The box can be redrawn (and replaced) before the timer fires, so the timer reads the draft the page keeps, not this element.
  st.timers.set(rowKey, setTimeout(() => {
    st.timers.delete(rowKey);
    if (st.drafts.has(rowKey)) flushWeight(st, { dataset: { sp: "weight", kind, id }, value: st.drafts.get(rowKey) });
  }, DEBOUNCE_MS));
}

// A click or a change that says what the page already holds saves nothing.
function matchesData(st, d) {
  if (d.sp === "preset") return st.data?.preset === d.preset;
  if (d.sp === "gaps") return st.data?.sections.find((s) => s.kind === d.kind)?.gaps === d.gaps;
  if (d.sp === "toggle") return sourceOf(st, d.kind, d.id)?.use === (d.use === "true");
  return false;
}

function onClick(st, target) {
  const btn = target?.closest?.("button[data-sp]");
  if (!btn || btn.disabled || isReadOnly(st) || matchesData(st, btn.dataset)) return;
  const d = btn.dataset;
  if (d.sp === "preset") saveChange(st, { preset: d.preset }, "preset");
  else if (d.sp === "gaps") saveChange(st, { kind: d.kind, gaps: d.gaps }, `gaps:${d.kind}`);
  else if (d.sp === "toggle") saveChange(st, { kind: d.kind, sourceId: d.id, use: d.use === "true" }, rowKeyOf(btn));
  else if (d.sp === "local-reset") saveChange(st, { reset: true }, "local");
  else if (d.sp === "apply-all") applyAll(st);
}

function onChange(st, target) {
  const sp = target?.dataset?.sp;
  if (isReadOnly(st) || target.disabled) return;
  if (sp === "use") {
    const use = Boolean(target.checked);
    if (sourceOf(st, target.dataset.kind, target.dataset.id)?.use !== use) saveChange(st, { kind: target.dataset.kind, sourceId: target.dataset.id, use }, rowKeyOf(target));
  } else if (sp === "weight") flushWeight(st, target);
}

function wire(st) {
  const el = st.controlsEl;
  el.addEventListener("click", (e) => onClick(st, e.target));
  el.addEventListener("change", (e) => onChange(st, e.target));
  el.addEventListener("input", (e) => { if (e.target?.dataset?.sp === "weight" && !isReadOnly(st)) onWeightInput(st, e.target); });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target?.dataset?.sp === "weight" && !isReadOnly(st)) flushWeight(st, e.target); });
  el.addEventListener("focusout", (e) => { if (e.target?.dataset?.sp === "weight" && st.timers.has(rowKeyOf(e.target))) flushWeight(st, e.target); });
  // A section's recipe opening or closing (sources-page-html.js methodHtml): kept across redraws, and the player table below is re-sized
  // from its new top edge. "toggle" does not bubble, so it is caught on the way down.
  el.addEventListener("toggle", (e) => {
    const kind = e.target?.dataset?.recipe;
    if (!kind) return;
    if (e.target.open) st.openRecipes.add(kind);
    else st.openRecipes.delete(kind);
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("resize"));
  }, true);
  st.headEl.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-players]");
    if (btn) st.ctx.onPlayersTab?.(btn.dataset.players);
  });
}

// ---------- drawing and reading ----------

function mount(st, container) {
  const controlsEl = container.querySelector?.(".sp-controls");
  if (controlsEl && controlsEl === st.controlsEl) return;
  container.innerHTML = SKELETON;
  st.controlsEl = container.querySelector(".sp-controls");
  st.headEl = container.querySelector(".sp-players-head");
  wire(st);
}

async function load(st, key) {
  st.fetchingKey = key;
  const seq = st.saveSeq;
  try {
    const data = await st.api.get(st.ctx.slate);
    if (st.fetchingKey !== key) return;
    if (st.saveSeq !== seq) { // a save ran meanwhile; its answer is newer than this read
      st.fetchingKey = null;
      return;
    }
    Object.assign(st, { data, key, slate: st.ctx.slate, loadError: null });
  } catch (e) {
    if (st.fetchingKey !== key) return;
    st.loadError = e.message;
  }
  st.fetchingKey = null;
  draw(st);
  if (st.data && !st.loadError) st.ctx.onSelection?.(); // the player tables below read the ticks just arrived
}

/** The page's selection from the board it was handed (no selection route): the site's classic page is editable in the browser, the rest read-only. */
function drawFromBoard(st, ctx) {
  const edit = onSitePage() && !ctx.readOnly;
  st.local = true;
  st.api = ctx.api ?? siteApi;
  st.data = selectionFromBoard(ctx.board, ctx.showdown, { edit, note: ctx.readOnly ? "The sources cannot be changed from here." : undefined });
  st.slate = ctx.slate;
  draw(st);
}

/**
 * Draws the Sources page into `container` (classic: #sources-panel; Showdown: #sd-sources-panel).
 * ctx: { board, slate: "main" | a Showdown key, showdown: boolean, activeKey: "projections" | "ownership",
 *        onPlayersTab(key), onChanged(): Promise (the board repaint after a save), onSelection() (a read of the selection arrived), api?, readOnly? }
 */
export function renderSourcesPage(container, ctx) {
  const st = pageOf(container);
  st.ctx = ctx;
  mount(st, container);
  st.headEl.innerHTML = playersHeadHtml(ctx.activeKey);
  if (fromBoard(ctx)) {
    drawFromBoard(st, ctx);
    return;
  }
  st.local = false;
  st.api = ctx.api ?? defaultApi;
  if (st.slate !== null && st.slate !== ctx.slate) Object.assign(st, { data: null, key: null, loadError: null }); // another slate's choices (or failed read) are never shown
  const key = keyOf(ctx);
  if (st.data && (st.key === key || st.hold)) {
    draw(st);
    return;
  }
  draw(st);
  if (st.fetchingKey !== key) load(st, key);
}
