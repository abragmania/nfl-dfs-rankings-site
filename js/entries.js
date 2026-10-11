// Entries section of the Lineup Builder tab (PROJECT.md Part 4 "Optimizer", step 5; DECISIONS.md D56, D57, D43, D75).
// Adam uploads his DraftKings entries export, picks a saved lineup for each entry he wants to change (every row
// starts blank), or ticks a set of lineups and the contests with that many entries and assigns them in one action
// (D75); rows are grouped by contest, and the picks are kept in localStorage per uploaded file name. He then
// downloads the upload file to put back on DraftKings. The server (server/entries/routes.js)
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

// ---- Contests and bulk assign (D75) --------------------------------------------------------------------------------
// D75: pick a set of saved lineups and a set of contests with exactly that many entries each, and assign them one
// lineup per entry in one action; single entries are still picked by hand. Bulk assign only fills the same
// { entryId: lineupId } map the per-entry pickers fill; the server's export checks are unchanged.

/** The contest an entry belongs to, as the server keys it (trimmed Contest ID). */
export function contestKey(entry) {
  return String(entry?.contestId ?? "").trim();
}

/** The file's entries grouped by contest, contests in the order they first appear and entries in file order:
 *  [{ contestId, contestName, displayName, fee, entries }]. `displayName` is the name, plus the end of the Contest ID
 *  ("NFL $5 Double Up (#…4417)", the fewest of 4 to 6 digits that tell them apart, else the whole id) when two or
 *  more contests of the file share a name; it is what every header, checkbox and skip sentence shows. */
export function groupByContest(entries) {
  const groups = [];
  const byKey = new Map();
  for (const e of entries ?? []) {
    const k = contestKey(e);
    let g = byKey.get(k);
    if (!g) {
      const contestName = String(e?.contestName ?? "").trim() || `Contest ${k}`;
      g = { contestId: k, contestName, displayName: contestName, fee: String(e?.fee ?? "").trim(), entries: [] };
      byKey.set(k, g);
      groups.push(g);
    }
    g.entries.push(e);
  }
  const byName = new Map();
  for (const g of groups) byName.set(g.contestName, [...(byName.get(g.contestName) ?? []), g]);
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    let n = 4;
    while (n < 6 && new Set(same.map((g) => g.contestId.slice(-n))).size < same.length) n++;
    const distinct = new Set(same.map((g) => g.contestId.slice(-n))).size === same.length;
    for (const g of same) {
      const tail = distinct && g.contestId.length > n ? `…${g.contestId.slice(-n)}` : g.contestId;
      g.displayName = `${g.contestName} (#${tail})`;
    }
  }
  return groups;
}

/** How many of a contest's entries have a lineup picked in `assigned`. */
export function assignedInContest(group, assigned) {
  return (group?.entries ?? []).filter((e) => Boolean(assigned?.[e.entryId])).length;
}

/** The contest ids that can take a set of `m` lineups: exactly `m` entries (D75). None when `m` is 0. */
export function eligibleContestIds(groups, m) {
  return new Set(m > 0 ? (groups ?? []).filter((g) => g.entries.length === m).map((g) => g.contestId) : []);
}

/** The ticked lineups that still exist, in the order the slate's lineups are listed (never the order ticked). */
export function orderedSelection(lineups, selectedIds) {
  const want = new Set((selectedIds ?? []).map(String));
  return (lineups ?? []).filter((l) => want.has(String(l.id)));
}

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

/** The ticked contests that can take the ticked lineups right now (a tick on a contest of another size is ignored). */
export function bulkTargets(groups, lineups, bulk) {
  const eligible = eligibleContestIds(groups, orderedSelection(lineups, bulk?.lineups).length);
  const ticked = new Set((bulk?.contests ?? []).map(String));
  return (groups ?? []).filter((g) => eligible.has(g.contestId) && ticked.has(g.contestId)).map((g) => g.contestId);
}

function lineupName(l) {
  return String(l?.name ?? "").trim() || "Lineup";
}

/** Why a contest cannot take `chosen` (one per entry, in order) given the trial picks, or null when it can: a lineup
 *  blocked for its entry (lineupBlockedFor), or two lineups with the same nine players (the server refuses a
 *  contest holding the same lineup twice). */
function contestBlockReason(entries, trial, group, chosen, slateKey, slates) {
  const seen = new Map();
  for (let i = 0; i < group.entries.length; i++) {
    const e = group.entries[i];
    const l = chosen[i];
    if (lineupBlockedFor(entries, trial, e, l, slateKey, slates)) {
      return `${group.displayName} was skipped: ${lineupName(l)} is already in that contest.`;
    }
    const key = lineupFileKey(l, slateKey, slates);
    if (key === null) return `${group.displayName} was skipped: ${lineupName(l)} is not a complete lineup for this slate.`;
    const prev = seen.get(key);
    if (prev) return `${group.displayName} was skipped: ${lineupName(prev)} and ${lineupName(l)} have the same nine players, and a contest never takes the same lineup twice.`;
    seen.set(key, l);
  }
  return null;
}

/** Bulk assign (D75): every entry of each contest in `contestIds` gets one of the ticked lineups, in the order the
 *  lineups are listed and the entries sit in the file. Picks in other contests are kept; picks in a filled contest
 *  are replaced. A contest whose entry count is not the number of lineups, or that cannot take the set (see
 *  contestBlockReason), is left exactly as it was and named in `skipped` with one plain sentence.
 *  Returns { assigned, filled: [contestId], skipped: [{ contestId, reason }] }. */
export function bulkAssign({ entries, lineups, assigned, lineupIds, contestIds, slateKey = "main", slates = [] }) {
  const chosen = orderedSelection(lineups, lineupIds);
  const want = new Set((contestIds ?? []).map(String));
  let out = effectiveAssignments(entries, lineups, assigned);
  const filled = [];
  const skipped = [];
  for (const g of groupByContest(entries)) {
    if (!want.has(g.contestId)) continue;
    if (chosen.length === 0 || g.entries.length !== chosen.length) {
      skipped.push({ contestId: g.contestId, reason: `${g.displayName} was skipped: it has ${g.entries.length} entr${g.entries.length === 1 ? "y" : "ies"} and ${chosen.length} lineup${chosen.length === 1 ? " is" : "s are"} ticked.` });
      continue;
    }
    const trial = { ...out };
    g.entries.forEach((e, i) => {
      trial[e.entryId] = chosen[i].id;
    });
    const reason = contestBlockReason(entries, trial, g, chosen, slateKey, slates);
    if (reason) {
      skipped.push({ contestId: g.contestId, reason });
      continue;
    }
    out = trial;
    filled.push(g.contestId);
  }
  return { assigned: out, filled, skipped };
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

/** One contest's header row: name, fee, entry count, how many are assigned, and its Clear button. */
export function contestHeadHtml(file, group, assigned) {
  const n = group.entries.length;
  const done = assignedInContest(group, assigned);
  const status = n === 1 ? (done ? "assigned" : "not assigned") : `${done} of ${n} assigned`;
  return `
      <tr class="entries-contest-head">
        <td colspan="3"><div class="entries-contest-line">
          <span class="entries-contest-name">${escapeHtml(group.displayName)}</span>
          ${group.fee ? `<span class="entries-fee">${escapeHtml(group.fee)}</span>` : ""}
          <span class="entries-quiet">${n} entr${n === 1 ? "y" : "ies"}</span>
          <span class="entries-contest-status${done ? " some" : ""}">${status}</span>
          <button type="button" class="saved-lineup-btn entries-clear" data-action="entries-clear" data-file="${escapeHtml(file)}" data-contest="${escapeHtml(group.contestId)}"${done ? "" : " disabled"}>Clear</button>
        </div></td>
      </tr>`;
}

/** The bulk assign panel (D75) at the top of a file's block. `bulk`: { lineups: [id], contests: [id], notes }. */
export function bulkPanelHtml(file, groups, lineups, bulk) {
  if (!lineups.length) return "";
  const chosen = orderedSelection(lineups, bulk?.lineups);
  const m = chosen.length;
  const picked = new Set(chosen.map((l) => l.id));
  const eligible = eligibleContestIds(groups, m);
  const ticked = new Set((bulk?.contests ?? []).map(String));
  const targets = bulkTargets(groups, lineups, bulk).length;
  const f = escapeHtml(file);
  const lineupBoxes = lineups
    .map((l) => `<label class="entries-check"><input type="checkbox" data-bulk="lineup" data-file="${f}" value="${escapeHtml(l.id)}"${picked.has(l.id) ? " checked" : ""} /><span>${escapeHtml(lineupOptionLabel(l))}</span></label>`)
    .join("");
  const contestBoxes = groups
    .map((g) => {
      const n = g.entries.length;
      const ok = eligible.has(g.contestId);
      return `<label class="entries-check${ok ? "" : " off"}"><input type="checkbox" data-bulk="contest" data-file="${f}" value="${escapeHtml(g.contestId)}"${ok && ticked.has(g.contestId) ? " checked" : ""}${ok ? "" : " disabled"} /><span>${escapeHtml(g.displayName)}</span><span class="entries-quiet">${ok ? "" : "has "}${n} entr${n === 1 ? "y" : "ies"}</span></label>`;
    })
    .join("");
  const hint = m === 0 ? "Tick the lineups first; contests with that many entries can then be ticked." : targets === 0 ? `Tick contests with ${m} entr${m === 1 ? "y" : "ies"}.` : "";
  const notes = (bulk?.notes ?? []).map((n) => `<div class="${n.skip ? "entries-bulk-skip" : "entries-quiet"}">${escapeHtml(n.text)}</div>`).join("");
  return `
      <div class="entries-bulk">
        <div class="entries-bulk-col">
          <div class="entries-bulk-head">
            <span class="entries-bulk-title">Lineups</span>
            <button type="button" class="saved-lineup-btn" data-action="entries-bulk-all" data-file="${f}">All</button>
            <button type="button" class="saved-lineup-btn" data-action="entries-bulk-none" data-file="${f}">None</button>
            <span class="entries-quiet">${m} selected</span>
          </div>
          <div class="entries-bulk-scroll" data-file="${f}" title="Shift-click to tick or untick a run of lineups"><div class="entries-bulk-list entries-bulk-lineups">${lineupBoxes}</div></div>
        </div>
        <div class="entries-bulk-col">
          <div class="entries-bulk-head"><span class="entries-bulk-title">Contests</span></div>
          <div class="entries-bulk-list">${contestBoxes}</div>
        </div>
        <div class="entries-bulk-go">
          <button type="button" class="lineup-build-btn" data-action="entries-bulk-assign" data-file="${f}"${targets ? "" : " disabled"}>Assign to ${targets} contest${targets === 1 ? "" : "s"}</button>
          ${hint ? `<span class="entries-quiet">${escapeHtml(hint)}</span>` : ""}
        </div>
        ${notes ? `<div class="entries-bulk-notes">${notes}</div>` : ""}
      </div>`;
}

export function fileBlockHtml(f, saved, assigned, result, busy, slates = [], bulk = null) {
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
  const bodies = groups
    .map((g) => `<tbody class="entries-contest-group">${contestHeadHtml(f.file, g, eff)}${g.entries.map((e) => entryRowHtml(f.file, e, lineups, eff, entries, slateKey, slates)).join("")}</tbody>`)
    .join("");
  return `
    <div class="entries-file" data-file="${escapeHtml(f.file)}">
      ${head}
      ${note}
      ${bulkPanelHtml(f.file, groups, lineups, bulk)}
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
 *  bulk, saved, slates, noWeek }. With no week loaded there is nothing to upload against, so only a plain line shows. */
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
  else body = m.files.map((f) => fileBlockHtml(f, m.saved, m.assign?.[f.file], m.results?.[f.file], m.busyFile === f.file, m.slates, m.bulk?.[f.file])).join("");
  const upErr = m.uploadError ? `<div class="lineup-status lineup-status-error entries-error">${escapeHtml(m.uploadError)}</div>` : "";
  return `
      <h3 class="entries-title">Entries <span class="opt-sub">assign saved lineups to whole contests or one entry at a time, then download the file to upload to DraftKings</span></h3>
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
  bulk: {}, // file name -> { lineups: [lineupId], contests: [contestId], notes: [{ text, skip }] } (D75; not stored)
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
  // The lineup list scrolls on its own; a tick must not jump it back to the top.
  const scrolls = [...el.querySelectorAll(".entries-bulk-scroll[data-file]")].map((d) => [d.dataset.file, d.scrollTop]);
  // Nor may it drop keyboard focus: the same lineup box (file + value) gets it back, so Space keeps working.
  const act = document.activeElement;
  const focused = act && el.contains(act) && act.matches("input[data-bulk='lineup']") ? { file: act.dataset.file, value: act.value } : null;
  el.innerHTML = entriesInnerHtml(model());
  for (const [file, top] of scrolls) {
    const d = [...el.querySelectorAll(".entries-bulk-scroll[data-file]")].find((x) => x.dataset.file === file);
    if (d) d.scrollTop = top;
  }
  if (focused) {
    const box = [...el.querySelectorAll("input[data-bulk='lineup']")].find((x) => x.dataset.file === focused.file && x.value === focused.value);
    box?.focus({ preventScroll: true });
  }
  bind(el);
}

/** Picks are kept in localStorage per uploaded file name so they survive a reload (D75). Storage can throw (private
 *  browsing, quota, disabled); then picks just last for this page load. */
function readStoredPicks(f) {
  let raw = null;
  try {
    raw = window.localStorage.getItem(picksStorageKey(f.file));
  } catch {
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
    // Storage unavailable: the picks still hold for this page load.
  }
}

function applyFiles(data) {
  ent.files = Array.isArray(data?.files) ? data.files : [];
  // Picks belong to a file by name; a newer upload of the slate starts blank.
  const names = new Set(ent.files.map((f) => f.file));
  for (const k of Object.keys(ent.assign)) if (!names.has(k)) delete ent.assign[k];
  for (const k of Object.keys(ent.results)) if (!names.has(k)) delete ent.results[k];
  for (const k of Object.keys(ent.bulk)) if (!names.has(k)) delete ent.bulk[k];
  for (const f of ent.files) if (!ent.assign[f.file]) ent.assign[f.file] = readStoredPicks(f);
  if (ent.files.length) pruneStoredPicks(names);
}

/** After a successful load that listed at least one file: drop the stored picks of every file not in the list (an
 *  older upload or another week; only the newest upload of a slate can be exported). An empty list prunes nothing. */
function pruneStoredPicks(names) {
  const prefix = picksStorageKey("");
  try {
    const ls = window.localStorage;
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (k !== null && k.startsWith(prefix) && !names.has(k.slice(prefix.length))) ls.removeItem(k);
    }
  } catch {
    // Storage unavailable: nothing to prune.
  }
}

/** The picks of one file changed (a picker, bulk assign or Clear): store them and drop the old export answer. */
function picksChanged(fileName) {
  storePicks(fileName);
  delete ent.results[fileName]; // the old answer was about different picks
  refresh();
}

function doBulkAssign(fileName) {
  const f = ent.files.find((x) => x.file === fileName);
  if (!f?.slate) return;
  const lineups = slateLineups(ctx.getSaved(), f.slate.key);
  const bulk = (ent.bulk[fileName] ??= { lineups: [], contests: [], notes: [] });
  const groups = groupByContest(f.entries);
  const targets = bulkTargets(groups, lineups, bulk);
  if (!targets.length) return;
  const res = bulkAssign({
    entries: f.entries, lineups, assigned: ent.assign[fileName], lineupIds: bulk.lineups, contestIds: targets,
    slateKey: f.slate.key, slates: ctx.getSlates(),
  });
  ent.assign[fileName] = res.assigned;
  const m = orderedSelection(lineups, bulk.lineups).length;
  const notes = [];
  if (res.filled.length) {
    notes.push({ text: `Assigned ${m} lineup${m === 1 ? "" : "s"} to each of ${res.filled.length} contest${res.filled.length === 1 ? "" : "s"}.`, skip: false });
  }
  for (const s of res.skipped) notes.push({ text: s.reason, skip: true });
  bulk.notes = notes;
  if (res.filled.length) bulk.contests = []; // done: a second click must not quietly refill them
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
      if (ent.bulk[file]) ent.bulk[file].notes = []; // the last bulk note no longer describes the picks
      picksChanged(file);
    });
  });
  // Bulk assign (D75). The ticks live in ent.bulk[file]; a re-render redraws them from there.
  const bulkOf = (file) => (ent.bulk[file] ??= { lineups: [], contests: [], notes: [] });
  // The lineup ticks changed: a ticked contest that no longer has that many entries is unticked, so it cannot
  // come back as a target later without Adam ticking it again.
  const dropStaleContestTicks = (file, b) => {
    const f = ent.files.find((x) => x.file === file);
    const lineups = f?.slate ? slateLineups(ctx.getSaved(), f.slate.key) : [];
    const eligible = eligibleContestIds(groupByContest(f?.entries), orderedSelection(lineups, b.lineups).length);
    b.contests = b.contests.filter((c) => eligible.has(c));
  };
  // Lineup boxes listen to click (it carries shiftKey; a keyboard Space fires it too): shift-click ticks or unticks
  // the run from the last clicked lineup to this one.
  el.querySelectorAll("input[data-bulk='lineup']").forEach((box) => {
    box.addEventListener("click", (ev) => {
      const file = box.dataset.file;
      const f = ent.files.find((x) => x.file === file);
      const b = bulkOf(file);
      const lineups = f?.slate ? slateLineups(ctx.getSaved(), f.slate.key) : [];
      b.lineups = rangeTick(lineups, b.lineups, ev.shiftKey ? b.lastLineup : null, box.value, box.checked);
      b.lastLineup = box.value;
      dropStaleContestTicks(file, b);
      b.notes = [];
      refresh();
    });
  });
  el.querySelectorAll("input[data-bulk='contest']").forEach((box) => {
    box.addEventListener("change", () => {
      const b = bulkOf(box.dataset.file);
      b.contests = b.contests.filter((v) => v !== box.value);
      if (box.checked) b.contests.push(box.value);
      b.notes = [];
      refresh();
    });
  });
  el.querySelectorAll("[data-action='entries-bulk-all'], [data-action='entries-bulk-none']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const file = btn.dataset.file;
      const f = ent.files.find((x) => x.file === file);
      const b = bulkOf(file);
      b.lineups = btn.dataset.action === "entries-bulk-all" && f?.slate ? slateLineups(ctx.getSaved(), f.slate.key).map((l) => l.id) : [];
      dropStaleContestTicks(file, b);
      b.notes = [];
      refresh();
    });
  });
  el.querySelectorAll("[data-action='entries-bulk-assign']").forEach((btn) => {
    btn.addEventListener("click", () => doBulkAssign(btn.dataset.file));
  });
  el.querySelectorAll("[data-action='entries-clear']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const file = btn.dataset.file;
      const f = ent.files.find((x) => x.file === file);
      if (!f) return;
      ent.assign[file] = clearContest(f.entries, ent.assign[file], btn.dataset.contest);
      if (ent.bulk[file]) ent.bulk[file].notes = []; // the last bulk note no longer describes the picks
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
    ent.bulk = {};
    ent.busyFile = null;
    refresh();
    if (weekKey !== null) loadFiles(weekKey);
  }
}
