// Entries section of the Lineup Builder tab (PROJECT.md Part 4 "Optimizer", step 5; DECISIONS.md D56, D57, D43, D75).
// Adam uploads his DraftKings entries export, picks a saved lineup for each entry he wants to change (every row
// starts blank), or lets the fill strip propose lineups for the rows and confirms them in one click (D75, entries
// fill plan 2026-10-17); rows are grouped by contest, and the picks are kept in localStorage per uploaded file name.
// He then downloads the upload file to put back on DraftKings. The server (server/entries/routes.js)
// does every check; this file only shows the rows, keeps Adam's picks and says plainly what the server answered.
//   GET  /api/entries            { files: [{ file, slate, entries }] }  newest upload of each slate this week
//   POST /api/entries/upload     { csv }  ->  { file, slate, entries }
//   POST /api/entries/export     { file, assignments: [{ entryId, lineupId }] }  -> the CSV as a download
// The pure builders and helpers are exported for tests/entries-ui.test.mjs; the module state and the wiring are at
// the bottom. The section re-renders itself on its own (never the whole Lineup Builder panel), so picking a
// lineup does not move the page.
import { escapeHtml } from "./format.js";
import { getEntries, postEntriesUpload, postEntriesExport } from "./api.js";
import {
  lineupUsedElsewhere, cellId, lineupFileKey, heldLineupKeys, lineupBlockedFor, contestKey, groupByContest, effectiveAssignments,
  classifyContest, classesStorageKey, restoreClasses,
} from "./entries-plan.js";
import { lineupLabel } from "./lineup-tags.js";
import {
  lineupOptionLabel, assignedInContest, contestHeadHtml, FILL_DEFAULT, handPick, reproposeFill, reopenLabel, clearContestFill, fillListsOf,
  fillModelOf, fillStripHtml, fillClassPreset, keepStorageKey, restoreKeep, confirmFill, keptOpenCount,
} from "./entries-fill.js";
// The assignment logic moved to entries-plan.js and the strip builders to entries-fill.js; re-exported so every existing
// importer still resolves.
export { lineupUsedElsewhere, cellId, lineupFileKey, heldLineupKeys, lineupBlockedFor, contestKey, groupByContest, effectiveAssignments };
export { lineupOptionLabel, assignedInContest, contestHeadHtml, handPick, reproposeFill, reopenLabel, clearContestFill, fillListsOf, fillModelOf, fillStripHtml, fillClassPreset, keepStorageKey, restoreKeep, confirmFill, keptOpenCount };

// ---- Pure helpers ------------------------------------------------------------------------------------------------

/** The text of an uploaded file, decoded as UTF-8 with the byte order mark KEPT (a leading U+FEFF), so the server
 *  stores and writes back exactly the bytes DraftKings gave. Invalid UTF-8 throws rather than being patched. */
export function decodeEntriesBytes(buffer) {
  return new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(buffer);
}

/** The saved lineups that belong to one slate ("main" or a second slate's key). A lineup saved without a slate
 *  (everything before 2026-10-10) is a main-slate lineup. */
export function slateLineups(saved, slateKey) {
  return (Array.isArray(saved) ? saved : []).filter((l) => (l?.slate || "main") === (slateKey || "main"));
}

/** A DraftKings roster cell `Name (44312211)` as the plain name. */
function cellName(cell) {
  return String(cell ?? "").replace(/\s*\(\d+\)\s*$/, "").trim();
}

/** What an entry holds in the file right now: { text, title }. `current` is null (blank) or the nine cells. */
export function currentSummary(current) {
  if (!Array.isArray(current) || current.every((c) => String(c ?? "").trim() === "")) return { text: "Blank", title: "" };
  const names = current.map(cellName).filter(Boolean);
  const first = names[0] ?? "";
  const text = names.length > 1 ? `${first} + ${names.length - 1} more` : first;
  return { text, title: names.join(", ") };
}

/** The export request body: only the rows Adam assigned, in file order. Null when none is assigned. */
export function buildExportPayload(file, entries, lineups, assigned) {
  const eff = effectiveAssignments(entries, lineups, assigned);
  const assignments = (entries ?? []).filter((e) => eff[e.entryId]).map((e) => ({ entryId: e.entryId, lineupId: eff[e.entryId] }));
  return assignments.length ? { file, assignments } : null;
}

/** Distinct contests in a file's entries. */
export function contestCount(entries) {
  return new Set((entries ?? []).map((e) => e.contestId)).size;
}

// ---- Contests and the fill strip (D75 as amended 2026-10-17) -------------------------------------------------------
// D75: the fill strip proposes a lineup per entry (planFill in entries-plan.js) and Adam confirms; it only fills the
// same { entryId: lineupId } map the per-entry pickers fill, and the server's export checks are unchanged. The older
// tick-by-entry-count panel is retired; the strip is the one set of controls (entries fill plan item 5).

/** Shift-click range ticking: every listed lineup from `lastId` to `clickedId` (both included) is set to `checked`;
 *  with no usable `lastId` only the clicked one changes. Returns the ticked ids in listed order (gone ids dropped). */
export function rangeTick(lineups, selectedIds, lastId, clickedId, checked) {
  const order = (lineups ?? []).map((l) => String(l.id));
  const sel = new Set((selectedIds ?? []).map(String));
  const to = order.indexOf(String(clickedId));
  if (to >= 0) {
    const from = lastId == null ? -1 : order.indexOf(String(lastId));
    const lo = from < 0 ? to : Math.min(from, to);
    const hi = from < 0 ? to : Math.max(from, to);
    for (let i = lo; i <= hi; i++) {
      if (checked) sel.add(order[i]);
      else sel.delete(order[i]);
    }
  }
  return order.filter((id) => sel.has(id));
}

/** The picks with every entry of one contest cleared; other contests untouched. */
export function clearContest(entries, assigned, contestId) {
  const out = { ...(assigned ?? {}) };
  for (const e of entries ?? []) if (contestKey(e) === String(contestId)) delete out[e.entryId];
  return out;
}

/** The localStorage key of one uploaded file's picks (a newer upload has a new name, so it starts blank). */
export function picksStorageKey(fileName) {
  return `nfldfs.entries.picks.v1:${fileName}`;
}

/** Picks read back from storage: only entries still in the file, only lineup ids still saved for the slate (when
 *  `lineups` is known; null keeps any id, and effectiveAssignments drops a stale one at render and export), and
 *  never the same lineup twice in one contest. Unreadable text gives {}. */
export function restorePicks(raw, entries, lineups = null) {
  let obj;
  try {
    obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const ids = Array.isArray(lineups) ? new Set(lineups.map((l) => l.id)) : null;
  const used = new Set();
  const out = {};
  for (const e of entries ?? []) {
    if (!Object.prototype.hasOwnProperty.call(obj, e.entryId)) continue;
    const id = obj[e.entryId];
    if (typeof id !== "string" || id === "" || (ids && !ids.has(id))) continue;
    const k = `${contestKey(e)}|${id}`;
    if (used.has(k)) continue;
    used.add(k);
    out[e.entryId] = id;
  }
  return out;
}

/** The lineup lists' Sort choice is remembered in localStorage (Adam 2026-10-17, plan item 7a). */
export const SORT_STORAGE_KEY = "nfldfs.entries.sort.v1";

/** "letter" or "number" from stored text; anything else is "number". */
export function restoreSort(raw) {
  return raw === "letter" ? "letter" : "number";
}

/** `attachment; filename="DKEntries-upload-<stamp>.csv"` as the file name, else a fallback. */
export function filenameFromDisposition(disposition, fallback = "DKEntries-upload.csv") {
  const m = /filename="([^"]+)"/.exec(String(disposition ?? ""));
  return m ? m[1] : fallback;
}

/** The server's two JSON-in-a-header lists (URL-encoded): the warnings and the stale sources. Bad text gives []. */
export function parseListHeader(value) {
  if (!value) return [];
  try {
    const list = JSON.parse(decodeURIComponent(value));
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

/** A refusal answer as plain lines: each of the server's own errors if it listed them, else its message. */
export function refusalLines(data) {
  const list = data?.error?.errors;
  if (Array.isArray(list) && list.length) return list.map(String);
  return [data?.error?.message ?? "The server refused this request."];
}

/** What to show after an export answer: a download (its file name, the server's warnings and stale sources) or a
 *  refusal (the server's own lines, and the warnings and stale sources it still sent). */
export function exportResultOf(res, count) {
  if (res?.ok === true && res.blob) {
    const name = filenameFromDisposition(res.disposition);
    return {
      name,
      done: `Downloaded ${name} with ${count} entr${count === 1 ? "y" : "ies"} changed. Upload it to DraftKings yourself.`,
      warnings: parseListHeader(res.warnings),
      stale: parseListHeader(res.stale),
    };
  }
  return {
    errors: refusalLines(res),
    warnings: Array.isArray(res?.warnings) ? res.warnings.map(String) : [],
    stale: Array.isArray(res?.stale) ? res.stale.map(String) : [],
  };
}

// ---- HTML builders (pure) ----------------------------------------------------------------------------------------

// `extra` (from fileBlockHtml): { proposedId, numbers, proposals, kept }. A proposed lineup shows pre-selected in the picker
// until Adam confirms it or picks by hand (D75 as amended 2026-10-17, entries fill plan item 6).
function pickerHtml(file, entry, lineups, assigned, entries, slateKey, slates, extra = null) {
  if (!lineups.length) return `<select class="entries-pick" disabled aria-label="Lineup for entry ${escapeHtml(entry.entryId)}"><option>No saved lineups</option></select>`;
  const cur = extra?.proposedId ?? assigned?.[entry.entryId] ?? "";
  // 🔵 2026-10-17: a lineup proposed for another row of the contest is marked (still selectable), so no silent reshuffle.
  const c = contestKey(entry);
  const elsewhere = new Set(
    (entries ?? []).filter((e) => e.entryId !== entry.entryId && contestKey(e) === c && extra?.proposals?.[e.entryId] != null).map((e) => String(extra.proposals[e.entryId]))
  );
  const opts = lineups
    .map((l) => {
      const taken = l.id !== cur && lineupBlockedFor(entries, assigned, entry, l, slateKey, slates);
      const mark = taken ? " (already in this contest)" : l.id !== cur && elsewhere.has(String(l.id)) ? " (proposed for another entry)" : "";
      return `<option value="${escapeHtml(l.id)}"${l.id === cur ? " selected" : ""}${taken ? " disabled" : ""}>${escapeHtml(lineupOptionLabel(l, extra?.numbers))}${mark}</option>`;
    })
    .join("");
  return `<select class="entries-pick" data-file="${escapeHtml(file)}" data-entry="${escapeHtml(entry.entryId)}" aria-label="Lineup for entry ${escapeHtml(entry.entryId)}"><option value=""${cur ? "" : " selected"}>(leave as is)</option>${opts}</select>`;
}

export function entryRowHtml(file, entry, lineups, assigned, entries, slateKey = "main", slates = [], extra = null) {
  const sum = currentSummary(entry.current);
  const proposed = extra?.proposedId != null;
  const picked = assigned?.[entry.entryId];
  const set = Boolean(picked);
  const held = lineups.find((l) => l.id === picked);
  const heldLabel = held ? lineupLabel(held, extra?.numbers) : "";
  // 👁 2026-10-17: the tag cell is a fixed width and says only the state; the picker beside it shows the lineup.
  const tag = proposed
    ? `<span class="entries-tag entries-tag-proposed">proposed</span>`
    : set
      ? `<span class="entries-tag entries-tag-assigned" title="${escapeHtml(heldLabel)}">assigned</span>`
      : extra?.kept
        ? `<span class="entries-tag entries-tag-kept" title="${escapeHtml(`Left as DraftKings has it; "${extra.reopen}" opens it again`)}">left as is</span>`
        : `<span class="entries-tag"></span>`;
  return `
      <tr class="entries-row${set ? " assigned" : ""}${proposed ? " proposed" : ""}">
        <td class="entries-id">${escapeHtml(entry.entryId)}</td>
        <td class="entries-now${sum.text === "Blank" ? " blank" : ""}"${sum.title ? ` title="${escapeHtml(sum.title)}"` : ""}>${escapeHtml(sum.text)}</td>
        <td class="entries-pick-cell"><div class="entries-pick-wrap">${pickerHtml(file, entry, lineups, assigned, entries, slateKey, slates, extra)}${tag}</div></td>
      </tr>`;
}

/** The status lines under a file's Download button: the server's refusal (plainly), then its quiet notes. */
export function resultHtml(result) {
  if (!result) return "";
  const parts = [];
  if (result.errors?.length) {
    parts.push(...result.errors.map((m) => `<div class="lineup-status lineup-status-error entries-error">${escapeHtml(m)}</div>`));
  }
  if (result.done) parts.push(`<div class="entries-quiet">${escapeHtml(result.done)}</div>`);
  for (const w of result.warnings ?? []) parts.push(`<div class="entries-quiet">${escapeHtml(w)}</div>`);
  if (result.stale?.length) parts.push(`<div class="entries-quiet">Served from a saved copy: ${escapeHtml(result.stale.join(", "))}.</div>`);
  return parts.join("");
}

// The fill strip, the contest headers and the fill model are in entries-fill.js (🔵 2026-10-17, size split).

/** One uploaded file's block. `view`: { fill, classes, sortBy, fold } (the fill strip's ticks, the contest class overrides,
 *  the Sort choice; see fillModelOf; and `fold`, a Set of contest ids whose rows are folded away, Adam 2026-10-17). */
export function fileBlockHtml(f, saved, assigned, result, busy, slates = [], view = null) {
  const entries = f.entries ?? [];
  const slateKey = f.slate?.key ?? null;
  const label = f.slate?.label ?? "Unknown slate";
  const lineups = slateKey ? slateLineups(saved, slateKey) : [];
  const eff = effectiveAssignments(entries, lineups, assigned);
  const n = Object.keys(eff).length;
  const nContests = contestCount(entries);
  const head = `<div class="entries-file-head">
        <span class="entries-slate">${escapeHtml(label)}</span>
        <span class="entries-file-name">${escapeHtml(f.file)}</span>
        <span class="entries-count">${entries.length} entr${entries.length === 1 ? "y" : "ies"} in ${nContests} contest${nContests === 1 ? "" : "s"}</span>
      </div>`;
  if (f.error || !slateKey) {
    return `<div class="entries-file">${head}<div class="lineup-status lineup-status-error">${escapeHtml(f.error ?? "This file's slate could not be told; upload it again.")}</div></div>`;
  }
  const note = lineups.length
    ? ""
    : `<div class="entries-empty">No saved lineups for the ${escapeHtml(label)} yet. Save some above, then pick them here.</div>`;
  const groups = groupByContest(entries);
  const m = lineups.length ? fillModelOf(entries, slateKey, lineups, eff, slates, view) : null;
  const ticked = m && (m.fill.contestIds == null ? null : new Set(m.fill.contestIds.map(String)));
  const rows = m ? m.sorted : lineups; // the pickers list lineups in the Sort order
  const bodies = groups
    .map((g) => {
      const ctx = m && { cls: m.classes[g.contestId], auto: classifyContest(g.contestName), ticked: ticked === null || ticked.has(g.contestId) };
      // 🔵 2026-10-17: the kept tag's title names the control the strip shows (reopenLabel).
      const extraOf = (e) => (m ? { proposedId: m.proposals[e.entryId], numbers: m.numbers, proposals: m.proposals, kept: m.kept.has(String(e.entryId)), reopen: reopenLabel(m.fill, m.keptOpen), dismissed: m.fill.dismissed } : null);
      const folded = Boolean(view?.fold?.has(g.contestId));
      const body = folded ? "" : g.entries.map((e) => entryRowHtml(f.file, e, rows, eff, entries, slateKey, slates, extraOf(e))).join("");
      return `<tbody class="entries-contest-group${folded ? " folded" : ""}">${contestHeadHtml(f.file, g, eff, ctx, m?.proposals, folded)}${body}</tbody>`;
    })
    .join("");
  return `
    <div class="entries-file" data-file="${escapeHtml(f.file)}">
      ${head}
      ${note}
      ${m ? fillStripHtml(f.file, m) : ""}
      <table class="entries-table">
        <thead><tr><th>Entry</th><th>In the file now</th><th>Lineup</th></tr></thead>
        ${bodies}
      </table>
      <div class="entries-download-row">
        <button type="button" class="lineup-build-btn" data-action="entries-download" data-file="${escapeHtml(f.file)}"${n === 0 || busy ? " disabled" : ""}>${busy ? "Preparing…" : "Download upload file"}</button>
        <span class="entries-quiet">${n === 0 ? "Pick a lineup for at least one entry. Entries left as is stay as they are." : `${n} of ${entries.length} entries will change.`}</span>
      </div>
      ${resultHtml(result)}
    </div>`;
}

/** The whole section's inside. `m`: { loaded, loadError, uploading, uploadError, files, assign, results, busyFile,
 *  fill, classes, sortBy, saved, slates, noWeek, storageWarning }. With no week loaded there is nothing to upload against,
 *  so only a plain line shows. */
export function entriesInnerHtml(m) {
  // 🔵 2026-10-17: blocked browser storage is said once, quietly, at the top (never a silent catch).
  const storage = m.storageWarning ? `<div class="entries-quiet">${escapeHtml(m.storageWarning)}</div>` : "";
  if (m.noWeek) {
    return `
      <h3 class="entries-title">Entries</h3>${storage}
      <div class="entries-empty">No week is loaded yet. Upload the week's salary file first, then the entries file.</div>`;
  }
  let body;
  if (!m.loaded) body = `<div class="entries-empty">Loading…</div>`;
  else if (m.loadError) body = `<div class="lineup-status lineup-status-error">${escapeHtml(m.loadError)}</div>`;
  else if (!m.files?.length) body = `<div class="entries-empty">No entries file uploaded yet for this week.</div>`;
  else body = m.files.map((f) => fileBlockHtml(f, m.saved, m.assign?.[f.file], m.results?.[f.file], m.busyFile === f.file, m.slates, { fill: m.fill?.[f.file], classes: m.classes?.[f.file], sortBy: m.sortBy, fold: m.fold?.[f.file] })).join("");
  const upErr = m.uploadError ? `<div class="lineup-status lineup-status-error entries-error">${escapeHtml(m.uploadError)}</div>` : "";
  return `
      <h3 class="entries-title">Entries <span class="opt-sub">the strip proposes saved lineups for the entries, you confirm or pick one entry at a time, then download the file to upload to DraftKings</span></h3>${storage}
      <div class="entries-upload-row">
        <button type="button" class="saved-lineup-btn" data-action="entries-upload"${m.uploading ? " disabled" : ""}>${m.uploading ? "Uploading…" : "Upload DraftKings entries file"}</button>
        <input type="file" id="entries-file" accept=".csv,text/csv" hidden />
      </div>
      ${upErr}
      ${body}`;
}

export function entriesSectionHtml(m) {
  return `<div class="entries-section" id="entries-section">${entriesInnerHtml(m)}</div>`;
}

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
  fill: {}, // file name -> { lineupIds, contestIds, lead, overwrite, dismissed, lastLineup, keep, prior } (null ids = all ticked; not stored)
  classes: {}, // file name -> { contestId: "cash"|"gpp" } Adam's overrides of the automatic call (stored per file)
  fold: {}, // file name -> Set of contest ids folded (rows hidden); memory only (Adam 2026-10-17)
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
  const foldFocus = act && el.contains(act) && act.matches("button[data-action='entries-fold']") ? { file: act.dataset.file, contest: act.dataset.contest } : null;
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
    const btn = [...el.querySelectorAll("button[data-action='entries-fold']")].find((x) => x.dataset.file === foldFocus.file && x.dataset.contest === foldFocus.contest);
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
    (ent.fill[f.file] ??= { ...FILL_DEFAULT }).prior = now.model.proposals;
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

/** Any change to the ticks, a class, the lead, Replace or the Sort clears "Discard" so the proposal comes back (spec C),
 *  and drops `prior` so the plan starts afresh (👁 2026-10-17; Discard and Confirm come through here too). */
function fillOf(fileName) {
  const s = (ent.fill[fileName] ??= { ...FILL_DEFAULT });
  s.dismissed = false;
  s.prior = null;
  return s;
}

/** Confirm N (D75, plan item 6): write the proposals into the picks. Replace is one-shot, so it goes off again, and the
 *  rows Adam kept stay kept (Adam 2026-10-17: "(leave as is)" is left alone until he reopens it). */
function doConfirmFill(fileName) {
  const now = fillNow(fileName);
  if (!now || !Object.keys(now.model.proposals).length) return;
  // 🔵 2026-10-17 (F2): the state change is the pure confirmFill (Replace off, `keep` as it is, plan afresh).
  const next = confirmFill(ent.assign[fileName], ent.fill[fileName], now.model.proposals);
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

async function doUpload(file) {
  if (ent.uploading || !file) return;
  const key = ent.weekKey;
  ent.uploading = true;
  ent.uploadError = null;
  refresh();
  try {
    let bytes;
    let text;
    try {
      bytes = await file.arrayBuffer();
    } catch (e) {
      ent.uploadError = `Could not read that file: ${e.message}`;
    }
    if (bytes !== undefined) {
      try {
        text = decodeEntriesBytes(bytes);
      } catch (e) {
        ent.uploadError = "That file is not plain UTF-8 text, so it was not uploaded. Use the entries file exactly as DraftKings exported it.";
      }
    }
    if (text !== undefined) {
      const data = await postEntriesUpload(text);
      if (ent.weekKey === key) {
        if (!data || data.ok === false) {
          ent.uploadError = refusalLines(data).join(" ");
        } else {
          await loadFiles(key); // the server's own list is the one truth: the newest file of each slate
        }
      }
    }
  } catch (e) {
    ent.uploadError = `Could not reach the server: ${e.message}`;
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
    s.contestIds = set === "all" ? null : set === "none" ? [] : now.model.groups.filter((g) => now.model.classes[g.contestId] === set).map((g) => g.contestId);
    refresh();
  });
}

/** The class chips, lead, Replace, Sort, Confirm, Discard and Re-propose. */
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
  on("[data-action='entries-fill-lead']", "change", (sel) => {
    fillOf(sel.dataset.file).lead = sel.value || null;
    refresh();
  });
  on("input[data-fill='overwrite']", "change", (box) => {
    fillOf(box.dataset.file).overwrite = box.checked;
    refresh();
  });
  on("[data-action='entries-sort']", "click", (btn) => {
    ent.sortBy = btn.dataset.sort === "letter" ? "letter" : "number";
    storeSort();
    for (const k of Object.keys(ent.fill)) Object.assign(ent.fill[k], { dismissed: false, prior: null }); // the order changed: plan afresh
    refresh();
  });
  // Adam 2026-10-17: Fill cash / Fill GPP tick one class, propose it; Confirm then writes only that class.
  on("[data-action='entries-fill-class']", "click", (btn) => {
    const file = btn.dataset.file;
    const now = fillNow(file);
    if (!now) return;
    ent.fill[file] = fillClassPreset(ent.fill[file], now.model, btn.dataset.class);
    refresh();
  });
  on("[data-action='entries-fill-confirm']", "click", (btn) => doConfirmFill(btn.dataset.file));
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
      ent.fold[f.file] = new Set(btn.dataset.set === "fold" ? groupByContest(f.entries).map((g) => g.contestId) : []);
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
    ent.busyFile = null;
    refresh();
    if (weekKey !== null) loadFiles(weekKey);
  }
}
