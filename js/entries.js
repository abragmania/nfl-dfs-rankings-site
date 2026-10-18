// The Entries tab (PROJECT.md Part 4 "Optimizer", step 5; DECISIONS.md D56, D57, D43, D75; its own tab since the rules repo's 2026-10-17 ruling).
// Adam uploads his DraftKings entries export, picks a saved lineup for each entry he wants to change (every row
// starts blank), or lets the fill strip propose lineups for the rows and confirms them in one click (D75, entries
// fill plan 2026-10-17); rows are grouped by contest, and the picks are kept in localStorage per uploaded file name.
// He then downloads the upload file to put back on DraftKings. The server (server/entries/routes.js)
// does every check; this file only shows the rows, keeps Adam's picks and says plainly what the server answered.
//   GET  /api/entries            { files: [{ file, slate, entries }] }  newest upload of each slate this week
//   POST /api/entries/upload     { csv }  ->  { file, slate, entries }
//   POST /api/entries/export     { file, assignments: [{ entryId, lineupId }] }  -> the CSV as a download
// The pure builders and helpers are exported for tests/entries-ui, entries-fill-ui and entries-tabs-ui.test.mjs; the module state and the wiring are in
// entries-wire.js (🔵 2026-10-18 split), which imports this file. The section re-renders itself on its own (never the whole
// Lineup Builder panel), so picking a lineup does not move the page.
import { escapeHtml } from "./format.js";
import {
  lineupUsedElsewhere, cellId, lineupFileKey, heldLineupKeys, lineupBlockedFor, contestKey, groupByContest, effectiveAssignments,
  classifyContest,
} from "./entries-plan.js";
import { lineupLabel } from "./lineup-tags.js";
import {
  lineupOptionLabel, assignedInContest, contestHeadHtml, handPick, reproposeFill, reopenLabel, clearContestFill, fillListsOf,
  fillModelOf, fillStripHtml, fillTopHtml, classProposals, tickClassContests, fillClassPreset, keepStorageKey, restoreKeep, confirmFill, keptOpenCount,
} from "./entries-fill.js";
import { decodeEntriesBytes } from "./dk-csv-kind.js";
// The assignment logic moved to entries-plan.js and the strip builders to entries-fill.js; re-exported so every existing
// importer still resolves.
export { lineupUsedElsewhere, cellId, lineupFileKey, heldLineupKeys, lineupBlockedFor, contestKey, groupByContest, effectiveAssignments };
export { lineupOptionLabel, assignedInContest, contestHeadHtml, handPick, reproposeFill, reopenLabel, clearContestFill, fillListsOf, fillModelOf, fillStripHtml, fillTopHtml, classProposals, tickClassContests, fillClassPreset, keepStorageKey, restoreKeep, confirmFill, keptOpenCount };
export { decodeEntriesBytes }; // moved to dk-csv-kind.js with the file-kind routing (Adam 2026-10-18)

// ---- Pure helpers ------------------------------------------------------------------------------------------------

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
  // Adam 2026-10-18: with no saved lineups the row shows the entry and what it holds now, no picker.
  return `
      <tr class="entries-row${set ? " assigned" : ""}${proposed ? " proposed" : ""}">
        <td class="entries-id">${escapeHtml(entry.entryId)}</td>
        <td class="entries-now${sum.text === "Blank" ? " blank" : ""}"${sum.title ? ` title="${escapeHtml(sum.title)}"` : ""}>${escapeHtml(sum.text)}</td>
        ${lineups.length ? `<td class="entries-pick-cell"><div class="entries-pick-wrap">${pickerHtml(file, entry, lineups, assigned, entries, slateKey, slates, extra)}${tag}</div></td>` : ""}
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

/** One uploaded file's block. `view`: { fill, classes, sortBy, fold, tab, adjust } (the fill strip's ticks, the contest class
 *  overrides, the Sort choice; see fillModelOf; `fold`, a Set of contest ids whose rows are folded away, Adam 2026-10-17;
 *  `tab` "gpp" (default) or "cash" and `adjust`, whether the Adjust fold is open, Adam 2026-10-18). */
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
  const m = lineups.length ? fillModelOf(entries, slateKey, lineups, eff, slates, view) : null;
  const ticked = m && (m.fill.contestIds == null ? null : new Set(m.fill.contestIds.map(String)));
  const rows = m ? m.sorted : lineups; // the pickers list lineups in the Sort order
  // Adam 2026-10-18: a contest's rows are drawn under its own tab (GPP or Cash) when lineups exist, all of them, plain, when none do.
  const tbodyOf = (g) => {
    const ctx = m && { cls: m.classes[g.contestId], auto: classifyContest(g.contestName), ticked: ticked === null || ticked.has(g.contestId) };
    // 🔵 2026-10-17: the kept tag's title names the control the strip shows (reopenLabel).
    const extraOf = (e) => (m ? { proposedId: m.proposals[e.entryId], numbers: m.numbers, proposals: m.proposals, kept: m.kept.has(String(e.entryId)), reopen: reopenLabel(m.fill, m.keptOpen), dismissed: m.fill.dismissed } : null);
    const folded = Boolean(view?.fold?.has(g.contestId));
    const body = folded ? "" : g.entries.map((e) => entryRowHtml(f.file, e, rows, eff, entries, slateKey, slates, extraOf(e))).join("");
    return `<tbody class="entries-contest-group${folded ? " folded" : ""}">${contestHeadHtml(f.file, g, eff, ctx, m?.proposals, folded, !m)}${body}</tbody>`;
  };
  const tableOf = (groups, plain) => `
      <table class="entries-table">
        <thead><tr><th>Entry</th><th>In the file now</th>${plain ? "" : "<th>Lineup</th>"}</tr></thead>
        ${groups.map(tbodyOf).join("")}
      </table>`;
  if (!m) {
    return `
    <div class="entries-file" data-file="${escapeHtml(f.file)}">
      ${head}
      <div class="entries-empty">Save lineups in the Optimizer first (Build, then Save all); the entries fill themselves after that.</div>
      ${tableOf(groupByContest(entries), true)}
    </div>`;
  }
  const tab = view?.tab === "cash" ? "cash" : "gpp";
  const inClass = (cls) => m.groups.filter((g) => m.classes[g.contestId] === cls);
  const countOf = (cls) => inClass(cls).reduce((s, g) => s + g.entries.length, 0);
  const tabBtn = (cls, text) => `<button type="button" role="tab" class="opt-tab${tab === cls ? " active" : ""}" data-action="entries-tab" data-file="${escapeHtml(f.file)}" data-tab="${cls}" aria-selected="${tab === cls}">${text} <span class="opt-tab-n">${countOf(cls)}</span></button>`;
  const open = Boolean(view?.adjust);
  const mine = inClass(tab);
  const tabName = tab === "cash" ? "Cash" : "GPP";
  const adjust = `<div class="entries-adjust"><button type="button" class="saved-lineup-btn" data-action="entries-adjust" data-file="${escapeHtml(f.file)}" aria-expanded="${open}">${open ? "▾" : "▸"} Adjust</button>${open ? fillStripHtml(f.file, m, tab) : ""}</div>`;
  // 🔵 2026-10-18: proposals of both tabs still waiting for Confirm are said under Download.
  const waiting = Object.keys(m.proposals).length;
  const waitingText = waiting ? ` ${waiting} ${waiting === 1 ? "proposal is" : "proposals are"} not confirmed.` : "";
  return `
    <div class="entries-file" data-file="${escapeHtml(f.file)}">
      ${head}
      <div class="entries-download-row">
        <button type="button" class="lineup-build-btn" data-action="entries-download" data-file="${escapeHtml(f.file)}" title="${n === 0 ? "Confirm at least one lineup first; nothing is written until a row is confirmed" : "Writes your entries file with every confirmed lineup, GPP and Cash"}"${n === 0 || busy ? " disabled" : ""}>${busy ? "Preparing…" : "Download for DraftKings"}</button>
        <span class="entries-quiet">${n === 0 ? "Confirm a lineup for at least one entry. Entries left as is stay as they are." : `${n} of ${entries.length} entries will change.`}${waitingText}</span>
      </div>
      ${resultHtml(result)}
      <div class="opt-tabs entries-tabs" role="tablist">${tabBtn("gpp", "GPP")}${tabBtn("cash", "Cash")}</div>
      <div class="entries-tab-panel" data-tab="${tab}">
        ${fillTopHtml(f.file, m, tab)}
        ${adjust}
        ${mine.length ? tableOf(mine, false) : `<div class="entries-empty">No ${tabName} contests in this file. A contest's GPP | Cash buttons, in the other tab, move it here.</div>`}
      </div>
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
  else body = m.files.map((f) => fileBlockHtml(f, m.saved, m.assign?.[f.file], m.results?.[f.file], m.busyFile === f.file, m.slates, { fill: m.fill?.[f.file], classes: m.classes?.[f.file], sortBy: m.sortBy, fold: m.fold?.[f.file], tab: m.tab?.[f.file], adjust: m.adjust?.[f.file] })).join("");
  const upErr = m.uploadError ? `<div class="lineup-status lineup-status-error entries-error">${escapeHtml(m.uploadError)}</div>` : "";
  return `
      <h3 class="entries-title">Entries <span class="opt-sub">saved lineups are proposed for the entries, you confirm, then download the file to upload to DraftKings</span></h3>${storage}
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
