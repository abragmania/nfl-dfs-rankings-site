// Entries section of the Lineup Builder tab (PROJECT.md Part 4 "Optimizer", step 5; DECISIONS.md D56, D57, D43).
// Adam uploads his DraftKings entries export, picks a saved lineup for each entry he wants to change (every row
// starts blank), and downloads the upload file to put back on DraftKings. The server (server/entries/routes.js)
// does every check; this file only shows the rows, keeps Adam's picks and says plainly what the server answered.
//   GET  /api/entries            { files: [{ file, slate, entries }] }  newest upload of each slate this week
//   POST /api/entries/upload     { csv }  ->  { file, slate, entries }
//   POST /api/entries/export     { file, assignments: [{ entryId, lineupId }] }  -> the CSV as a download
// The pure builders and helpers are exported for tests/entries-ui.test.mjs; the module state and the wiring are at
// the bottom. The section re-renders itself on its own (never the whole Lineup Builder panel), so picking a
// lineup does not move the page.
import { escapeHtml, money, dec1 } from "./format.js";
import { getEntries, postEntriesUpload, postEntriesExport } from "./api.js";

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

/** "Name - 152.3 proj - $49,800": how one saved lineup reads in a picker. */
export function lineupOptionLabel(lineup) {
  const name = String(lineup?.name ?? "").trim() || "Lineup";
  const proj = dec1(lineup?.totalProj);
  return `${name} · ${proj == null ? "no proj" : `${proj} proj`} · ${money(lineup?.salaryUsed)}`;
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

/** The entry's assigned lineup, only if it is still one of `lineups` (a deleted or other-slate lineup is dropped). */
export function effectiveAssignments(entries, lineups, assigned) {
  const ids = new Set((lineups ?? []).map((l) => l.id));
  const out = {};
  for (const e of entries ?? []) {
    const id = assigned?.[e.entryId];
    if (id && ids.has(id)) out[e.entryId] = id;
  }
  return out;
}

/** Per-contest use of lineups: true when `lineupId` is already picked by ANOTHER entry of the same contest. */
export function lineupUsedElsewhere(entries, assigned, entry, lineupId) {
  for (const e of entries ?? []) {
    if (e.entryId === entry.entryId) continue;
    if (e.contestId === entry.contestId && assigned?.[e.entryId] === lineupId) return true;
  }
  return false;
}

/** The DraftKings id at the end of a roster cell `Name (44312211)`; "" when there is none. */
export function cellId(cell) {
  const m = /\((\d+)\)\s*$/.exec(String(cell ?? ""));
  return m ? m[1] : "";
}

/** The ids the entries file uses for a saved lineup's nine players, sorted and joined: the main slate's ids are the
 *  board's own; a second slate's come through its `dkIds` map (board.slates). Null when the lineup is not nine
 *  players or any player has no id in that slate's file. */
export function lineupFileKey(lineup, slateKey, slates) {
  const slots = Array.isArray(lineup?.slots) ? lineup.slots : [];
  if (slots.length !== 9) return null;
  const map = !slateKey || slateKey === "main" ? null : ((slates ?? []).find((s) => s?.key === slateKey)?.dkIds ?? {});
  const ids = [];
  for (const s of slots) {
    const main = String(s?.playerId ?? "");
    const id = map ? (Object.prototype.hasOwnProperty.call(map, main) ? String(map[main]) : "") : main;
    if (!id) return null;
    ids.push(id);
  }
  return ids.sort().join(",");
}

/** What the server will treat as already in each contest: the lineup sitting in every entry that is NOT being
 *  changed (not picked here, and not `exceptEntryId`, the row whose picker is being drawn, because picking it would
 *  free its own lineup). Keys are `${contestId}|${sorted file ids}`; a row with a blank or unreadable cell holds
 *  nothing. Mirrors planExport in server/entries/routes.js. */
export function heldLineupKeys(entries, assigned, exceptEntryId = null) {
  const held = new Set();
  for (const e of entries ?? []) {
    if (e.entryId === exceptEntryId || assigned?.[e.entryId]) continue;
    if (!Array.isArray(e.current)) continue;
    const ids = e.current.map(cellId);
    if (ids.length === 0 || ids.some((id) => id === "")) continue;
    held.add(`${String(e.contestId).trim()}|${[...ids].sort().join(",")}`);
  }
  return held;
}

/** True when `lineup` cannot go on `entry`: another picked row of the contest has it, or an untouched row of the
 *  contest already holds that exact lineup in the file. */
export function lineupBlockedFor(entries, assigned, entry, lineup, slateKey, slates) {
  if (lineupUsedElsewhere(entries, assigned, entry, lineup.id)) return true;
  const key = lineupFileKey(lineup, slateKey, slates);
  if (key === null) return false;
  return heldLineupKeys(entries, assigned, entry.entryId).has(`${String(entry.contestId).trim()}|${key}`);
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

function pickerHtml(file, entry, lineups, assigned, entries, slateKey, slates) {
  if (!lineups.length) return `<select class="entries-pick" disabled aria-label="Lineup for entry ${escapeHtml(entry.entryId)}"><option>No saved lineups</option></select>`;
  const cur = assigned?.[entry.entryId] ?? "";
  const opts = lineups
    .map((l) => {
      const taken = l.id !== cur && lineupBlockedFor(entries, assigned, entry, l, slateKey, slates);
      return `<option value="${escapeHtml(l.id)}"${l.id === cur ? " selected" : ""}${taken ? " disabled" : ""}>${escapeHtml(lineupOptionLabel(l))}${taken ? " (already in this contest)" : ""}</option>`;
    })
    .join("");
  return `<select class="entries-pick" data-file="${escapeHtml(file)}" data-entry="${escapeHtml(entry.entryId)}" aria-label="Lineup for entry ${escapeHtml(entry.entryId)}"><option value=""${cur ? "" : " selected"}>(leave as is)</option>${opts}</select>`;
}

export function entryRowHtml(file, entry, lineups, assigned, entries, slateKey = "main", slates = []) {
  const sum = currentSummary(entry.current);
  const set = Boolean(assigned?.[entry.entryId]);
  return `
      <tr class="entries-row${set ? " assigned" : ""}">
        <td class="entries-contest">${escapeHtml(entry.contestName)}</td>
        <td class="entries-fee">${escapeHtml(entry.fee)}</td>
        <td class="entries-id">${escapeHtml(entry.entryId)}</td>
        <td class="entries-now${sum.text === "Blank" ? " blank" : ""}"${sum.title ? ` title="${escapeHtml(sum.title)}"` : ""}>${escapeHtml(sum.text)}</td>
        <td class="entries-pick-cell">${pickerHtml(file, entry, lineups, assigned, entries, slateKey, slates)}</td>
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

export function fileBlockHtml(f, saved, assigned, result, busy, slates = []) {
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
  const rows = entries.map((e) => entryRowHtml(f.file, e, lineups, eff, entries, slateKey, slates)).join("");
  return `
    <div class="entries-file" data-file="${escapeHtml(f.file)}">
      ${head}
      ${note}
      <table class="entries-table">
        <thead><tr><th>Contest</th><th>Fee</th><th>Entry</th><th>In the file now</th><th>Lineup</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="entries-download-row">
        <button type="button" class="lineup-build-btn" data-action="entries-download" data-file="${escapeHtml(f.file)}"${n === 0 || busy ? " disabled" : ""}>${busy ? "Preparing…" : "Download upload file"}</button>
        <span class="entries-quiet">${n === 0 ? "Pick a lineup for at least one entry. Entries left as is stay as they are." : `${n} of ${entries.length} entries will change.`}</span>
      </div>
      ${resultHtml(result)}
    </div>`;
}

/** The whole section's inside. `m`: { loaded, loadError, uploading, uploadError, files, assign, results, busyFile,
 *  saved, slates, noWeek }. With no week loaded there is nothing to upload against, so only a plain line shows. */
export function entriesInnerHtml(m) {
  if (m.noWeek) {
    return `
      <h3 class="entries-title">Entries</h3>
      <div class="entries-empty">No week is loaded yet. Upload the week's salary file first, then the entries file.</div>`;
  }
  let body;
  if (!m.loaded) body = `<div class="entries-empty">Loading…</div>`;
  else if (m.loadError) body = `<div class="lineup-status lineup-status-error">${escapeHtml(m.loadError)}</div>`;
  else if (!m.files?.length) body = `<div class="entries-empty">No entries file uploaded yet for this week.</div>`;
  else body = m.files.map((f) => fileBlockHtml(f, m.saved, m.assign?.[f.file], m.results?.[f.file], m.busyFile === f.file, m.slates)).join("");
  const upErr = m.uploadError ? `<div class="lineup-status lineup-status-error entries-error">${escapeHtml(m.uploadError)}</div>` : "";
  return `
      <h3 class="entries-title">Entries <span class="opt-sub">pick a saved lineup for each entry, then download the file to upload to DraftKings</span></h3>
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
  busyFile: null,
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
  el.innerHTML = entriesInnerHtml(model());
  bind(el);
}

function applyFiles(data) {
  ent.files = Array.isArray(data?.files) ? data.files : [];
  // Picks belong to a file by name; a newer upload of the slate starts blank.
  const names = new Set(ent.files.map((f) => f.file));
  for (const k of Object.keys(ent.assign)) if (!names.has(k)) delete ent.assign[k];
  for (const k of Object.keys(ent.results)) if (!names.has(k)) delete ent.results[k];
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
      const map = (ent.assign[file] ??= {});
      if (sel.value) map[sel.dataset.entry] = sel.value;
      else delete map[sel.dataset.entry];
      delete ent.results[file]; // the old answer was about different picks
      refresh();
    });
  });
  el.querySelectorAll("[data-action='entries-download']").forEach((btn) => {
    btn.addEventListener("click", () => doDownload(btn.dataset.file));
  });
}

/** Called by lineup.js after every render of the panel: binds the section and loads the week's files once. */
export function wireEntries(container, { weekKey, getSaved, getSlates }) {
  ctx = { container, getSaved, getSlates: getSlates ?? (() => []) };
  const el = container.querySelector("#entries-section");
  if (el) bind(el);
  if (ent.weekKey !== weekKey) {
    // A new week (a new salary upload, no page reload): last week's files and picks are not shown.
    ent.weekKey = weekKey;
    ent.loaded = false;
    ent.loadError = null;
    ent.uploadError = null;
    ent.files = [];
    ent.assign = {};
    ent.results = {};
    ent.busyFile = null;
    refresh();
    if (weekKey !== null) loadFiles(weekKey);
  }
}
