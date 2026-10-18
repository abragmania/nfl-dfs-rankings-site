// The Entries tab's state and wiring (🔵 2026-10-18: split from entries.js, which keeps the pure helpers and the HTML builders and never
// imports this file). lineup.js and app.js import from here; the endpoints are listed at the top of entries.js.
import { getEntries, postEntriesUpload, postEntriesExport } from "./api.js";
import {
  slateLineups, picksStorageKey, restorePicks, SORT_STORAGE_KEY, restoreSort, rangeTick, clearContest, buildExportPayload, exportResultOf,
  contestCount, refusalLines, entriesInnerHtml, entriesSectionHtml,
} from "./entries.js";
import { effectiveAssignments, groupByContest, classifyContest, classesStorageKey, restoreClasses } from "./entries-plan.js";
import {
  FILL_DEFAULT, handPick, reproposeFill, clearContestFill, fillModelOf, classProposals, tickClassContests, fillClassPreset, keepStorageKey,
  restoreKeep, confirmClassFill,
} from "./entries-fill.js";

// ---- State and wiring ----------------------------------------------------------------------------------------------

const ent = {
  weekKey: null,
  loaded: false,
  loadError: null,
  uploading: false,
  uploadError: null,
  files: [],
  assign: {}, // file name -> { entryId: lineupId }
  results: {}, // file name -> { errors, done, warnings, stale }
  fill: {}, // file name -> { lineupIds, contestIds, overwrite, dismissed, lastLineup, keep, prior } (null ids = all ticked; not stored)
  classes: {}, // file name -> { contestId: "cash"|"gpp" } Adam's overrides of the automatic call (stored per file)
  fold: {}, // file name -> Set of contest ids folded (rows hidden); memory only (Adam 2026-10-17)
  tab: {}, // file name -> "gpp" | "cash", the sub-tab shown (default GPP); memory only (Adam 2026-10-18)
  adjust: {}, // file name -> true while its Adjust fold is open; memory only (Adam 2026-10-18)
  sortBy: "number", // the lineup lists' Sort toggle, "number"|"letter" (stored)
  sortRead: false,
  busyFile: null,
  storageWarning: null, // set once when localStorage throws; kept across weeks (it is the browser, not the file)
};
let ctx = { getSaved: () => [], getSlates: () => [], container: null };
let loadSeq = 0; // only the newest file-list request may change the screen

function model() {
  return { ...ent, saved: ctx.getSaved(), slates: ctx.getSlates(), noWeek: ent.weekKey === null };
}

/** The section's HTML for the current state; lineup.js drops it under the saved lineups. */
export function renderEntriesSection(saved, slates, weekKey) {
  return entriesSectionHtml({ ...ent, saved, slates, noWeek: !weekKey });
}

function refresh() {
  const el = ctx.container?.querySelector("#entries-section");
  if (!el) return;
  // The lineup list scrolls on its own; a tick must not jump it back to the top.
  const scrolls = [...el.querySelectorAll(".entries-fill-scroll[data-file]")].map((d) => [d.dataset.file, d.dataset.list, d.scrollTop]);
  // Nor may it drop keyboard focus: the same lineup box (file + value) gets it back, so Space keeps working.
  const act = document.activeElement;
  const focused = act && el.contains(act) && act.matches("input[data-fill='lineup']") ? { file: act.dataset.file, value: act.value } : null;
  // 🔵 2026-10-17 (F5): the same goes for a fold button (file + contest), so Enter or Space can fold or unfold again.
  // Adam 2026-10-18: the tab and Adjust buttons keep focus the same way.
  const foldFocus = act && el.contains(act) && act.matches("button[data-action='entries-fold'], button[data-action='entries-tab'], button[data-action='entries-adjust']") ? { action: act.dataset.action, file: act.dataset.file, contest: act.dataset.contest, tab: act.dataset.tab } : null;
  el.innerHTML = entriesInnerHtml(model());
  for (const [file, list, top] of scrolls) {
    const d = [...el.querySelectorAll(".entries-fill-scroll[data-file]")].find((x) => x.dataset.file === file && x.dataset.list === list);
    if (d) d.scrollTop = top;
  }
  if (focused) {
    const box = [...el.querySelectorAll("input[data-fill='lineup']")].find((x) => x.dataset.file === focused.file && x.value === focused.value);
    box?.focus({ preventScroll: true });
  }
  if (foldFocus) {
    const btn = [...el.querySelectorAll(`button[data-action='${foldFocus.action}']`)].find((x) => x.dataset.file === foldFocus.file && x.dataset.contest === foldFocus.contest && x.dataset.tab === foldFocus.tab);
    btn?.focus({ preventScroll: true });
  }
  bind(el);
  rememberProposals();
}

/** Each file's proposal as just drawn becomes the next plan's `prior`, so a hand pick or "(leave as is)" leaves the
 *  untouched rows' proposals where they were (👁 2026-10-17). Discard's empty proposal is not remembered. */
function rememberProposals() {
  for (const f of ent.files) {
    const now = fillNow(f.file);
    if (!now || now.model.fill.dismissed) continue;
    const s = (ent.fill[f.file] ??= { ...FILL_DEFAULT });
    s.prior = now.model.proposals;
  }
}

/** Storage threw (private browsing, quota, disabled): the section says so once (🔵 2026-10-17). */
function storageBlocked() {
  ent.storageWarning = "Picks and settings cannot be saved in this browser (storage is blocked), so they last for this page load only.";
}

/** Picks are kept in localStorage per uploaded file name so they survive a reload (D75). */
function readStoredPicks(f) {
  let raw = null;
  try {
    raw = window.localStorage.getItem(picksStorageKey(f.file));
  } catch {
    storageBlocked();
    return {};
  }
  if (raw === null) return {};
  const saved = ctx.getSaved();
  // Before the saved lineups have loaded the list is empty: keep every id; effectiveAssignments drops a stale one.
  const lineups = Array.isArray(saved) && saved.length && f.slate?.key ? slateLineups(saved, f.slate.key) : null;
  return restorePicks(raw, f.entries, lineups);
}

function storePicks(fileName) {
  const f = ent.files.find((x) => x.file === fileName);
  if (!f?.slate) return;
  const eff = effectiveAssignments(f.entries, slateLineups(ctx.getSaved(), f.slate.key), ent.assign[fileName]);
  try {
    if (Object.keys(eff).length) window.localStorage.setItem(picksStorageKey(fileName), JSON.stringify(eff));
    else window.localStorage.removeItem(picksStorageKey(fileName));
  } catch {
    storageBlocked();
  }
}

/** 🔵 2026-10-17 (F1): the rows Adam set to "(leave as is)" or picked by hand survive a reload, per file name like the
 *  picks. Null when nothing usable is stored (or storage is blocked). */
function readStoredKeep(f) {
  let raw = null;
  try {
    raw = window.localStorage.getItem(keepStorageKey(f.file));
  } catch {
    storageBlocked();
    return null;
  }
  return raw === null ? null : restoreKeep(raw, f.entries);
}

function storeKeep(fileName) {
  const keep = ent.fill[fileName]?.keep;
  try {
    if (keep && keep.size) window.localStorage.setItem(keepStorageKey(fileName), JSON.stringify([...keep].map(String)));
    else window.localStorage.removeItem(keepStorageKey(fileName));
  } catch {
    storageBlocked();
  }
}

/** Adam's contest class overrides, kept per file name like the picks (plan item 3). */
function readStoredClasses(f) {
  let raw = null;
  try {
    raw = window.localStorage.getItem(classesStorageKey(f.file));
  } catch {
    storageBlocked();
    return {};
  }
  return raw === null ? {} : restoreClasses(raw, groupByContest(f.entries));
}

function storeClasses(fileName) {
  const c = ent.classes[fileName] ?? {};
  try {
    if (Object.keys(c).length) window.localStorage.setItem(classesStorageKey(fileName), JSON.stringify(c));
    else window.localStorage.removeItem(classesStorageKey(fileName));
  } catch {
    storageBlocked();
  }
}

function storeSort() {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, ent.sortBy);
  } catch {
    storageBlocked();
  }
}

function applyFiles(data) {
  ent.files = Array.isArray(data?.files) ? data.files : [];
  // Picks belong to a file by name; a newer upload of the slate starts blank.
  const names = new Set(ent.files.map((f) => f.file));
  for (const k of Object.keys(ent.assign)) if (!names.has(k)) delete ent.assign[k];
  for (const k of Object.keys(ent.results)) if (!names.has(k)) delete ent.results[k];
  for (const k of Object.keys(ent.fill)) if (!names.has(k)) delete ent.fill[k];
  for (const k of Object.keys(ent.classes)) if (!names.has(k)) delete ent.classes[k];
  for (const k of Object.keys(ent.fold)) if (!names.has(k)) delete ent.fold[k];
  for (const k of Object.keys(ent.tab)) if (!names.has(k)) delete ent.tab[k];
  for (const k of Object.keys(ent.adjust)) if (!names.has(k)) delete ent.adjust[k];
  for (const f of ent.files) if (!ent.assign[f.file]) ent.assign[f.file] = readStoredPicks(f);
  for (const f of ent.files) if (!ent.classes[f.file]) ent.classes[f.file] = readStoredClasses(f);
  // 🔵 2026-10-17 (F1): the file's fill may already exist (ticks), so only its `keep` is filled, and only when it has none.
  for (const f of ent.files) {
    if (ent.fill[f.file]?.keep) continue;
    const kept = readStoredKeep(f);
    if (kept?.size) (ent.fill[f.file] ??= { ...FILL_DEFAULT }).keep = kept;
  }
  if (ent.files.length) pruneStoredPicks(names);
}

/** After a successful load that listed at least one file: drop the stored picks, class overrides and kept rows of every
 *  file not in the list (an older upload or another week; only the newest upload of a slate can be exported). An empty
 *  list prunes nothing. */
function pruneStoredPicks(names) {
  const prefixes = [picksStorageKey(""), classesStorageKey(""), keepStorageKey("")];
  try {
    const ls = window.localStorage;
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      const prefix = k === null ? undefined : prefixes.find((p) => k.startsWith(p));
      if (prefix !== undefined && !names.has(k.slice(prefix.length))) ls.removeItem(k);
    }
  } catch {
    storageBlocked(); // nothing to prune
  }
}

/** The picks of one file changed (a picker, a confirmed fill or Clear): store them and drop the old export answer. */
function picksChanged(fileName) {
  storePicks(fileName);
  storeKeep(fileName); // 🔵 2026-10-17 (F1): a hand pick, Clear or Confirm may have changed the kept rows too
  delete ent.results[fileName]; // the old answer was about different picks
  refresh();
}

/** The file's entries, this slate's saved lineups and the fill model as it would render now (null with no lineups). */
function fillNow(fileName) {
  const f = ent.files.find((x) => x.file === fileName);
  if (!f?.slate) return null;
  const lineups = slateLineups(ctx.getSaved(), f.slate.key);
  if (!lineups.length) return null;
  const eff = effectiveAssignments(f.entries, lineups, ent.assign[fileName]);
  return { f, lineups, model: fillModelOf(f.entries, f.slate.key, lineups, eff, ctx.getSlates(), { fill: ent.fill[fileName], classes: ent.classes[fileName], sortBy: ent.sortBy }) };
}

/** Any change to the ticks, a class or Replace clears "Discard" so the proposal comes back (spec C),
 *  and drops `prior` so the plan starts afresh (👁 2026-10-17; Discard and Confirm come through here too). */
function fillOf(fileName) {
  const s = (ent.fill[fileName] ??= { ...FILL_DEFAULT });
  s.dismissed = false;
  s.prior = null;
  return s;
}

/** Confirm N (D75, plan item 6): write the proposals into the picks. Replace is one-shot, so it goes off again, and the
 *  rows Adam kept stay kept (Adam 2026-10-17: "(leave as is)" is left alone until he reopens it). `cls` (Adam 2026-10-18):
 *  a GPP or Cash tab's Confirm writes only that class's proposals; the other tab's stay proposed, and Replace stays on for
 *  it until that tab has no proposals left (🔵 round 2: the Confirm that clears the last ones turns Replace off). */
function doConfirmFill(fileName, cls = null) {
  const now = fillNow(fileName);
  const mine = now && classProposals(now.model, cls);
  if (!mine || !Object.keys(mine).length) return;
  // 🔵 2026-10-17 (F2): the state change is the pure confirmClassFill (confirmClassFill: Replace and prior kept while the other tab has proposals, else off and afresh; `keep` as it is).
  const next = confirmClassFill(ent.assign[fileName], ent.fill[fileName], now.model, cls);
  ent.assign[fileName] = next.assign;
  ent.fill[fileName] = next.fill;
  picksChanged(fileName);
}

async function loadFiles(key) {
  const mine = ++loadSeq;
  try {
    const data = await getEntries();
    if (ent.weekKey !== key || mine !== loadSeq) return;
    if (!data || data.ok === false) {
      ent.loadError = data?.error?.message ?? "Could not load the entries files.";
    } else {
      ent.loadError = null;
      applyFiles(data);
    }
  } catch (e) {
    if (ent.weekKey !== key || mine !== loadSeq) return;
    ent.loadError = `Could not reach the server: ${e.message}`;
  }
  ent.loaded = true;
  refresh();
}

/** The entries file's text to the server (Adam 2026-10-18: the one copy, used by every upload button through the routing in
 *  dk-csv-kind.js). Answers { ok: true, entries, contests } or { ok: false, message }; on success the section reloads the
 *  server's own list (the newest file of each slate) when this tab has been drawn, else the tab loads it when first shown. */
export async function uploadEntriesText(text) {
  const key = ent.weekKey;
  let data;
  try {
    data = await postEntriesUpload(text);
  } catch (e) {
    return { ok: false, message: `Could not reach the server: ${e.message}` };
  }
  if (!data || data.ok === false) return { ok: false, message: refusalLines(data).join(" ") };
  if (key !== null && ent.weekKey === key) await loadFiles(key);
  return { ok: true, entries: data.entries?.length ?? 0, contests: contestCount(data.entries) };
}

let uploadRouter = null; // app.js sets it to the header's routing, so this tab's button takes any DraftKings export too
export function setUploadRouter(fn) {
  uploadRouter = fn;
}

async function doUpload(file) {
  if (ent.uploading || !file) return;
  ent.uploading = true;
  ent.uploadError = null;
  refresh();
  try {
    if (!uploadRouter) throw new Error("The upload is not connected to the page.");
    const r = await uploadRouter(file); // the header's status line says what happened too
    if (!r?.ok) ent.uploadError = r?.message ?? "The upload failed.";
  } catch (e) {
    ent.uploadError = e.message;
  }
  ent.uploading = false;
  refresh();
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function doDownload(fileName) {
  if (ent.busyFile) return;
  const f = ent.files.find((x) => x.file === fileName);
  if (!f?.slate) return;
  const payload = buildExportPayload(fileName, f.entries, slateLineups(ctx.getSaved(), f.slate.key), ent.assign[fileName]);
  if (!payload) return;
  const key = ent.weekKey;
  ent.busyFile = fileName;
  delete ent.results[fileName];
  refresh();
  let result;
  try {
    const res = await postEntriesExport(payload);
    result = exportResultOf(res, payload.assignments.length);
    if (result.name) saveBlob(res.blob, result.name);
  } catch (e) {
    result = { errors: [`Could not reach the server: ${e.message}`] };
  }
  if (ent.weekKey !== key) return;
  ent.busyFile = null;
  ent.results[fileName] = result;
  refresh();
}

/** The fill strip's controls (D75 as amended 2026-10-17). The ticks live in ent.fill[file] (null = all ticked); any change
 *  clears "Discard" (fillOf) and the next render recomputes the proposal. Split in two for size (🔵 2026-10-17). */
function bindFill(el) {
  const on = (sel, type, fn) => el.querySelectorAll(sel).forEach((node) => node.addEventListener(type, (ev) => fn(node, ev)));
  bindFillTicks(on);
  bindFillActions(on);
}

/** The lineup and contest ticks and their All / None buttons. */
function bindFillTicks(on) {
  // Lineup boxes listen to click (it carries shiftKey; a keyboard Space fires it too): shift-click ticks or unticks the
  // run from the last clicked lineup to this one, inside that list (Cash Lineups or GPP lineups).
  on("input[data-fill='lineup']", "click", (box, ev) => {
    const file = box.dataset.file;
    const now = fillNow(file);
    if (!now) return;
    const s = fillOf(file);
    const list = now.model[box.dataset.list] ?? [];
    const inList = new Set(list.map((l) => String(l.id)));
    const all = (s.lineupIds ?? now.lineups.map((l) => l.id)).map(String);
    const within = rangeTick(list, all.filter((id) => inList.has(id)), ev.shiftKey ? s.lastLineup : null, box.value, box.checked);
    s.lineupIds = [...all.filter((id) => !inList.has(id)), ...within];
    s.lastLineup = box.value;
    refresh();
  });
  on("[data-action='entries-fill-lineups']", "click", (btn) => {
    const file = btn.dataset.file;
    const now = fillNow(file);
    if (!now) return;
    const s = fillOf(file);
    const ids = (now.model[btn.dataset.which] ?? []).map((l) => String(l.id));
    const rest = (s.lineupIds ?? now.lineups.map((l) => l.id)).map(String).filter((id) => !ids.includes(id));
    s.lineupIds = btn.dataset.set === "all" ? [...rest, ...ids] : rest;
    refresh();
  });
  on("input[data-fill='contest']", "change", (box) => {
    const file = box.dataset.file;
    const now = fillNow(file);
    if (!now) return;
    const s = fillOf(file);
    const rest = (s.contestIds ?? now.model.groups.map((g) => g.contestId)).filter((id) => id !== box.value);
    s.contestIds = box.checked ? [...rest, box.value] : rest;
    refresh();
  });
  on("[data-action='entries-fill-contests']", "click", (btn) => {
    const file = btn.dataset.file;
    const now = fillNow(file);
    if (!now) return;
    const s = fillOf(file);
    const set = btn.dataset.set;
    // Adam 2026-10-18: inside a GPP or Cash tab All / None change that tab's contests only (data-class), the other tab keeps its ticks.
    if (btn.dataset.class && (set === "all" || set === "none")) s.contestIds = tickClassContests(s.contestIds, now.model, btn.dataset.class, set === "all");
    else s.contestIds = set === "all" ? null : set === "none" ? [] : now.model.groups.filter((g) => now.model.classes[g.contestId] === set).map((g) => g.contestId);
    refresh();
  });
}

/** The class chips, Replace, Sort, Confirm, Discard and Re-propose. */
function bindFillActions(on) {
  on("[data-action='entries-class']", "click", (btn) => {
    const file = btn.dataset.file;
    const f = ent.files.find((x) => x.file === file);
    const g = groupByContest(f?.entries).find((x) => x.contestId === btn.dataset.contest);
    if (!g) return;
    const o = (ent.classes[file] ??= {});
    if (btn.dataset.class === classifyContest(g.contestName)) delete o[g.contestId]; // back to the automatic call
    else o[g.contestId] = btn.dataset.class;
    storeClasses(file);
    fillOf(file);
    refresh();
  });
  on("input[data-fill='overwrite']", "change", (box) => {
    fillOf(box.dataset.file).overwrite = box.checked;
    refresh();
  });
  on("[data-action='entries-sort']", "click", (btn) => {
    ent.sortBy = btn.dataset.sort === "letter" ? "letter" : "number";
    storeSort();
    refresh();
  });
  // Adam 2026-10-17: Fill cash / Fill GPP tick one class, propose it; Confirm then writes only that class.
  on("[data-action='entries-fill-class']", "click", (btn) => {
    const file = btn.dataset.file;
    const now = fillNow(file);
    if (!now) return;
    ent.fill[file] = fillClassPreset(ent.fill[file], now.model, btn.dataset.class, true); // scoped: the other tab's ticks stay (Adam 2026-10-18)
    refresh();
  });
  on("[data-action='entries-fill-confirm']", "click", (btn) => doConfirmFill(btn.dataset.file, btn.dataset.class || null));
  on("[data-action='entries-fill-discard']", "click", (btn) => {
    fillOf(btn.dataset.file).dismissed = true;
    refresh();
  });
  on("[data-action='entries-fill-repropose']", "click", (btn) => {
    ent.fill[btn.dataset.file] = reproposeFill(ent.fill[btn.dataset.file]); // the kept rows open again
    storeKeep(btn.dataset.file); // 🔵 2026-10-17 (F1): keep is null now, so the stored key goes
    refresh();
  });
}

/** Folding a contest's rows (Adam 2026-10-17): memory only, works with or without saved lineups. */
function bindFold(el) {
  el.querySelectorAll("[data-action='entries-fold']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const set = (ent.fold[btn.dataset.file] ??= new Set());
      if (!set.delete(btn.dataset.contest)) set.add(btn.dataset.contest);
      refresh();
    });
  });
  el.querySelectorAll("[data-action='entries-fold-all']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = ent.files.find((x) => x.file === btn.dataset.file);
      if (!f) return;
      // Adam 2026-10-18: in a GPP or Cash tab (data-class) only that tab's contests fold or unfold.
      const cls = btn.dataset.class;
      const classes = cls ? fillNow(f.file)?.model.classes : null;
      const ids = groupByContest(f.entries).map((g) => g.contestId).filter((id) => !cls || classes?.[id] === cls);
      const rest = [...(ent.fold[f.file] ?? [])].filter((id) => !ids.includes(id));
      ent.fold[f.file] = new Set(btn.dataset.set === "fold" ? [...rest, ...ids] : rest);
      refresh();
    });
  });
  el.querySelectorAll("[data-action='entries-tab']").forEach((btn) => {
    btn.addEventListener("click", () => {
      ent.tab[btn.dataset.file] = btn.dataset.tab === "cash" ? "cash" : "gpp";
      refresh();
    });
  });
  el.querySelectorAll("[data-action='entries-adjust']").forEach((btn) => {
    btn.addEventListener("click", () => {
      ent.adjust[btn.dataset.file] = !ent.adjust[btn.dataset.file];
      refresh();
    });
  });
}

function bind(el) {
  el.querySelector("[data-action='entries-upload']")?.addEventListener("click", () => el.querySelector("#entries-file")?.click());
  el.querySelector("#entries-file")?.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = ""; // the same file can be chosen again
    doUpload(file);
  });
  el.querySelectorAll("select.entries-pick[data-entry]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const file = sel.dataset.file;
      const s = (ent.fill[file] ??= { ...FILL_DEFAULT }); // Discard stays as it was
      const next = handPick(ent.assign[file], s.keep, sel.dataset.entry, sel.value);
      ent.assign[file] = next.assign;
      s.keep = next.keep; // 🔵 2026-10-17: the planner never proposes over a hand pick or "(leave as is)", Replace or not
      picksChanged(file); // a hand pick commits this row at once; the proposal is recomputed around it
    });
  });
  bindFill(el);
  bindFold(el);
  el.querySelectorAll("[data-action='entries-clear']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const file = btn.dataset.file;
      const f = ent.files.find((x) => x.file === file);
      if (!f) return;
      ent.assign[file] = clearContest(f.entries, ent.assign[file], btn.dataset.contest);
      if (ent.fill[file]) ent.fill[file] = clearContestFill(ent.fill[file], f.entries, btn.dataset.contest); // its kept rows reopen
      picksChanged(file);
    });
  });
  el.querySelectorAll("[data-action='entries-download']").forEach((btn) => {
    btn.addEventListener("click", () => doDownload(btn.dataset.file));
  });
}

/** Called by lineup.js after every render of the panel: binds the section and loads the week's files once. */
export function wireEntries(container, { weekKey, getSaved, getSlates }) {
  ctx = { container, getSaved, getSlates: getSlates ?? (() => []) };
  let redraw = false;
  if (!ent.sortRead) {
    ent.sortRead = true;
    try {
      ent.sortBy = restoreSort(window.localStorage.getItem(SORT_STORAGE_KEY));
    } catch {
      storageBlocked();
      redraw = true; // the section was drawn before the warning existed
    }
  }
  const el = container.querySelector("#entries-section");
  if (el && redraw) refresh();
  else if (el) {
    bind(el);
    rememberProposals(); // lineup.js drew this proposal
  }
  if (ent.weekKey !== weekKey) {
    // A new week (a new salary upload, no page reload): last week's files and picks are not shown.
    ent.weekKey = weekKey;
    ent.loaded = false;
    ent.loadError = null;
    ent.uploadError = null;
    ent.files = [];
    ent.assign = {};
    ent.results = {};
    ent.fill = {};
    ent.classes = {};
    ent.fold = {};
    ent.tab = {};
    ent.adjust = {};
    ent.busyFile = null;
    refresh();
    if (weekKey !== null) loadFiles(weekKey);
  }
}
