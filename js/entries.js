// The Entries tab (PROJECT.md Part 4 "Optimizer", step 5; DECISIONS.md D56, D57, D43, D75; its own tab since the rules repo's 2026-10-17 ruling),
// drawn as NBA's Entries screen (PROJECT.md Part 4 "Monday 11-23 complaints" item 7): a top bar with the figures and Download, three
// numbered steps (1 Upload file, 2 Entries → Lineups, 3 Download; entries-screen.js), and in step 2 the rows grouped by contest under
// a GPP and a Cash tab, each contest suggested that class's saved lineups 1..k (D75) with Confirm per tab, rows selectable for a bulk
// Fill or Number in order (entries-bulk.js), and every row's own picker. The picks are kept in localStorage per uploaded file name.
// The server (server/entries/routes.js) does every check; this file only shows the rows, keeps Adam's picks and says plainly what the
// server answered.
//   GET  /api/entries            { files: [{ file, slate, entries }] }  newest upload of each slate this week
//   POST /api/entries/upload     { csv }  ->  { file, slate, entries }
//   POST /api/entries/export     { file, assignments: [{ entryId, lineupId }] }  -> the CSV as a download
// The pure builders and helpers are exported for tests/entries-ui, entries-fill-ui and entries-tabs-ui.test.mjs; the module state and the wiring are in
// entries-wire.js (🔵 2026-10-18 split), which imports this file. The section re-renders itself on its own (never the whole
// Lineup Builder panel), so picking a lineup does not move the page.
import { escapeHtml } from "./format.js";
import {
  lineupUsedElsewhere, cellId, lineupFileKey, heldLineupKeys, lineupBlockedFor, contestKey, groupByContest, effectiveAssignments,
  classifyContest, rowHolds, ENTRIES_STORAGE_NS,
} from "./entries-plan.js";
import { lineupLabel } from "./lineup-tags.js";
import {
  lineupOptionLabel, assignedInContest, contestHeadHtml, handPick, reproposeFill, reopenLabel, clearContestFill, fillListsOf,
  fillModelOf, fillStripHtml, fillTopHtml, classProposals, tickClassContests, fillClassPreset, keepStorageKey, restoreKeep, confirmFill, keptOpenCount,
} from "./entries-fill.js";
import { decodeEntriesBytes } from "./dk-csv-kind.js";
import { barHtml, stepsNavHtml, stepStatus, uploadScreenHtml, exportScreenHtml, CLASSIC_ROSTER_COLUMNS, SHOWDOWN_ROSTER_COLUMNS } from "./entries-screen.js";
export { CLASSIC_ROSTER_COLUMNS, SHOWDOWN_ROSTER_COLUMNS };
// The assignment logic moved to entries-plan.js and the strip builders to entries-fill.js; re-exported so every existing
// importer still resolves.
export { lineupUsedElsewhere, cellId, lineupFileKey, heldLineupKeys, lineupBlockedFor, contestKey, groupByContest, effectiveAssignments, rowHolds };
export { lineupOptionLabel, assignedInContest, contestHeadHtml, handPick, reproposeFill, reopenLabel, clearContestFill, fillListsOf, fillModelOf, fillStripHtml, fillTopHtml, classProposals, tickClassContests, fillClassPreset, keepStorageKey, restoreKeep, confirmFill, keptOpenCount };
export { decodeEntriesBytes }; // moved to dk-csv-kind.js with the file-kind routing (Adam 2026-10-18)

// ---- Pure helpers ------------------------------------------------------------------------------------------------

/** The saved lineups that belong to one slate ("main" or a second slate's key). A lineup saved without a slate
 *  (everything before 2026-10-10) is a main-slate lineup. */
export function slateLineups(saved, slateKey) {
  return (Array.isArray(saved) ? saved : []).filter((l) => (l?.slate || "main") === (slateKey || "main"));
}

/** The classic lineups-for-file function: the saved lineups of the uploaded file's slate. */
export function fileSlateLineups(saved, f) {
  return slateLineups(saved, f?.slate?.key);
}

/** What makes one Entries tab (Showdown Entries plan 2026-10-20, step 3): its section and file-input ids, the sentence for
 *  no uploaded file, its storage namespace and its lineups-for-file function (saved, f) -> lineups. The classic tab's
 *  values; a second tab (the Showdown game's) passes its own in the section model and entries-wire.js createEntriesWire. */
export const ENTRIES_TAB_DEFAULTS = Object.freeze({
  sectionId: "entries-section",
  fileInputId: "entries-file",
  emptyText: "No entries file uploaded yet for this week.",
  noLineupsText: "Save lineups in the Optimizer first (Build, then Save all); the entries fill themselves after that.", // a file is loaded but no lineup is saved
  ns: ENTRIES_STORAGE_NS,
  lineupsFor: fileSlateLineups,
  numberOverFor: null, // (saved, f) -> the list the lineup numbers run over, when lineupsFor gives only the pickable part (the Showdown tab); classic numbers its own list
  summaryOf: currentSummary, // (entry.current) -> { text, title }: "In the file now" (the Showdown tab names the Captain)
  lineupLabelOf: lineupLabel, // (lineup, numbers) -> the lineup's name in the pickers and the lists (the Showdown tab adds the Captain)
  lockedTextFor: null, // (f) -> the sentence saying the file's slate has locked, or null: Download is then greyed with it (each tab passes its own reading of the board)
  rosterColumns: null, // the roster columns the Upload screen names (entries-screen.js); null says "then the roster columns" (the classic instance passes CLASSIC_ROSTER_COLUMNS)
});

/** A DraftKings roster cell `Name (44312211)` as the plain name. */
export function cellName(cell) {
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

/** The localStorage key of one uploaded file's picks (a newer upload has a new name, so it starts blank). `ns`: the tab's
 *  storage namespace (entries-plan.js ENTRIES_STORAGE_NS for classic). */
export function picksStorageKey(fileName, ns = ENTRIES_STORAGE_NS) {
  return `${ns}.picks.v1:${fileName}`;
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

/** The lineup lists' Sort choice is remembered in localStorage (Adam 2026-10-17, plan item 7a), one key per namespace. */
export function sortStorageKey(ns = ENTRIES_STORAGE_NS) {
  return `${ns}.sort.v1`;
}
export const SORT_STORAGE_KEY = sortStorageKey();

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
function pickerHtml(file, entry, lineups, assigned, entries, slateKey, fileContext, extra = null, nameOf = lineupLabel) {
  if (!lineups.length) return `<select class="spsel entries-pick" disabled aria-label="Lineup for entry ${escapeHtml(entry.entryId)}"><option>No saved lineups</option></select>`;
  const cur = rowHolds({ pick: assigned?.[entry.entryId], kept: extra?.kept, proposedId: extra?.proposedId }).lineupId ?? ""; // Adam 2026-10-18: a hand pick is never shown under a proposal
  // 🔵 2026-10-17: a lineup proposed for another row of the contest is marked (still selectable), so no silent reshuffle.
  const c = contestKey(entry);
  const elsewhere = new Set(
    (entries ?? []).filter((e) => e.entryId !== entry.entryId && contestKey(e) === c && extra?.proposals?.[e.entryId] != null).map((e) => String(extra.proposals[e.entryId]))
  );
  const opts = lineups
    .map((l) => {
      const taken = l.id !== cur && lineupBlockedFor(entries, assigned, entry, l, slateKey, fileContext);
      const mark = taken ? " (already in this contest)" : l.id !== cur && elsewhere.has(String(l.id)) ? " (proposed for another entry)" : "";
      return `<option value="${escapeHtml(l.id)}"${l.id === cur ? " selected" : ""}${taken ? " disabled" : ""}>${escapeHtml(lineupOptionLabel(l, extra?.numbers, nameOf))}${mark}</option>`;
    })
    .join("");
  return `<select class="spsel entries-pick${cur ? "" : " un"}" data-file="${escapeHtml(file)}" data-entry="${escapeHtml(entry.entryId)}" aria-label="Lineup for entry ${escapeHtml(entry.entryId)}"><option value=""${cur ? "" : " selected"}>${LEAVE_TEXT}</option>${opts}</select>`;
}

/** The picker's first choice: the row keeps what DraftKings has (Adam picks it to leave a row out of the fill, D75 "kept"). */
export const LEAVE_TEXT = "Leave as in the file";

/** `labels` (the Showdown tab; classic passes none): { summaryOf(current) -> { text, title } for "In the file now", lineupLabelOf(lineup, numbers) for
 *  the lineup's name in the picker and the held tag }, ENTRIES_TAB_DEFAULTS' classic functions when absent. */
export function entryRowHtml(file, entry, lineups, assigned, entries, slateKey = "main", fileContext = [], extra = null, labels = null) {
  const sum = (labels?.summaryOf ?? currentSummary)(entry.current);
  const nameOf = labels?.lineupLabelOf ?? lineupLabel;
  const picked = assigned?.[entry.entryId];
  const holds = rowHolds({ pick: picked, kept: extra?.kept, proposedId: extra?.proposedId });
  const proposed = holds.state === "proposed";
  const set = Boolean(picked);
  const held = lineups.find((l) => l.id === picked);
  const heldLabel = held ? nameOf(held, extra?.numbers) : "";
  // 👁 2026-10-17: the tag cell is a fixed width and says only the state; the picker beside it shows the lineup.
  // NBA's row notes (lsw-maps.js entryRow): amber for a suggestion waiting, red for a row with no lineup, muted for the rest.
  const tag = proposed
    ? `<span class="entries-tag entries-tag-proposed noteA" title="Not written until you confirm the suggestions">suggested</span>`
    : set
      ? `<span class="entries-tag entries-tag-assigned noteG" title="${escapeHtml(heldLabel)}">${holds.hand ? "set by you" : "confirmed"}</span>`
      : extra?.kept
        ? `<span class="entries-tag entries-tag-kept muted" title="${escapeHtml(`Left as DraftKings has it; "${extra.reopen}" opens it again`)}">left as in the file</span>`
        : `<span class="entries-tag noteR">No lineup assigned</span>`;
  const none = !proposed && !set && !extra?.kept;
  const sel = Boolean(extra?.sel);
  const id = escapeHtml(entry.entryId);
  const place = extra?.k ? `Entry ${extra.k} of ${extra.n}` : "Entry";
  // Adam 2026-10-18: with no saved lineups the row shows the entry and what it holds now, no picker.
  if (!lineups.length) {
    return `
      <div class="er plain entries-row" data-entry="${id}"><span></span><span class="cn">${place}</span><span class="fe">${escapeHtml(entry.fee ?? "")}</span><span class="id entries-id">${id}</span><span class="entries-now${sum.text === "Blank" ? " blank" : ""}"${sum.title ? ` title="${escapeHtml(sum.title)}"` : ""}>${escapeHtml(sum.text)}</span></div>`;
  }
  return `
      <div class="er entries-row${set ? " assigned" : ""}${proposed ? " proposed" : ""}${none ? " nolu" : ""}${sel ? " sel" : ""}" data-entry="${id}">
        <span class="cb${sel ? " on" : ""}" data-action="entries-pick-row" data-file="${escapeHtml(file)}" data-entry="${id}" role="checkbox" aria-checked="${sel}" tabindex="0" title="Select this row (Shift-click selects a run)"></span>
        <span class="cn">${place}</span><span class="fe">${escapeHtml(entry.fee ?? "")}</span><span class="id entries-id">${id}</span>
        <span class="entries-now${sum.text === "Blank" ? " blank" : ""}"${sum.title ? ` title="${escapeHtml(sum.title)}"` : ""}>${escapeHtml(sum.text)}</span>
        ${pickerHtml(file, entry, lineups, assigned, entries, slateKey, fileContext, extra, nameOf)}${tag}
      </div>`;
}

/** The status lines under a file's Download button: the server's refusal (plainly), then its quiet notes. */
export function resultHtml(result) {
  if (!result) return "";
  const parts = [];
  if (result.errors?.length) {
    parts.push(...result.errors.map((m) => `<div class="msg err lineup-status-error entries-error">${escapeHtml(m)}</div>`));
  }
  if (result.done) parts.push(`<div class="msg ok entries-quiet">${escapeHtml(result.done)}</div>`);
  for (const w of result.warnings ?? []) parts.push(`<div class="msg warn entries-quiet">${escapeHtml(w)}</div>`);
  if (result.stale?.length) parts.push(`<div class="msg warn entries-quiet">Served from a saved copy: ${escapeHtml(result.stale.join(", "))}.</div>`);
  return parts.join("");
}

// The fill strip, the contest headers and the fill model are in entries-fill.js (🔵 2026-10-17, size split).

/** Step 2's rows for the groups given: the column heads, then each contest's header and its rows (NBA's .er grid). `s`: the step's
 *  shared values (see stepTwoHtml). */
function rowsHtml(groups, s) {
  const { f, m, eff, entries, slateKey, fileContext, view, labels } = s;
  const lineups = m ? m.sorted : []; // the pickers list lineups in the Sort order
  const ticked = m && (m.fill.contestIds == null ? null : new Set(m.fill.contestIds.map(String)));
  const sel = view?.sel ?? new Set();
  const head = `<div class="er hd${m ? "" : " plain"}"><span></span><span>Entry</span><span class="fe">Fee</span><span>Entry ID</span><span>In the file now</span>${m ? "<span>Lineup</span><span>Note</span>" : ""}</div>`;
  const groupOf = (g) => {
    const ctx = m && { cls: m.classes[g.contestId], auto: classifyContest(g.contestName), ticked: ticked === null || ticked.has(g.contestId), sel: g.entries.filter((e) => sel.has(String(e.entryId))).length, adjust: Boolean(view?.adjust) };
    // 🔵 2026-10-17: the kept tag's title names the control that reopens it (reopenLabel).
    const extraOf = (e, i) => ({ k: i + 1, n: g.entries.length, sel: sel.has(String(e.entryId)), ...(m ? { proposedId: m.proposals[e.entryId], numbers: m.numbers, proposals: m.proposals, kept: m.kept.has(String(e.entryId)), reopen: reopenLabel(m.fill, m.keptOpen), dismissed: m.fill.dismissed } : {}) });
    const folded = Boolean(view?.fold?.has(g.contestId));
    const body = folded ? "" : g.entries.map((e, i) => entryRowHtml(f.file, e, lineups, eff, entries, slateKey, fileContext, extraOf(e, i), labels)).join("");
    return `<div class="entries-contest-group${folded ? " folded" : ""}">${contestHeadHtml(f.file, g, eff, ctx, m?.proposals, folded, !m)}${body}</div>`;
  };
  return `<div class="entries-table">${head}${groups.map(groupOf).join("")}</div>`;
}

/** Step 2's selection bar (NBA's .bulk): select all, select the rows with no lineup, one lineup of the tab's class, Fill and Number in
 *  order, Reset entries; the one-step undo under it. */
function selectBarHtml(s, tab, mine) {
  const { f, m, view } = s;
  const file = escapeHtml(f.file);
  const sel = view?.sel ?? new Set();
  const ids = mine.flatMap((g) => g.entries.map((e) => String(e.entryId)));
  const nSel = ids.filter((id) => sel.has(id)).length;
  const all = ids.length > 0 && nSel === ids.length;
  const empty = mine.flatMap((g) => g.entries).filter((e) => rowHolds({ pick: s.eff[e.entryId], kept: m.kept.has(String(e.entryId)), proposedId: m.proposals[e.entryId] }).state === "none").length;
  const list = m[tab] ?? [];
  const pick = list.some((l) => String(l.id) === String(view?.bulkLineup)) ? String(view.bulkLineup) : String(list[0]?.id ?? "");
  const opts = list.map((l) => `<option value="${escapeHtml(l.id)}"${String(l.id) === pick ? " selected" : ""}>${escapeHtml(lineupOptionLabel(l, m.numbers, m.lineupLabelOf ?? lineupLabel))}</option>`).join("");
  const none = nSel && list.length ? "" : " disabled";
  const undo = view?.undo ? `<div class="fillnote"><span>${escapeHtml(view.undo)}</span><button type="button" class="ol" data-action="entries-undo" data-file="${file}">Undo</button></div>` : "";
  return `<div class="bulk entries-select">
<span class="cb${all ? " on" : nSel ? " part" : ""}" data-action="entries-pick-all" data-file="${file}" role="checkbox" aria-checked="${all}" tabindex="0" title="Select every row of this tab"></span><span class="muted">${nSel} selected</span>
<button type="button" class="ol" data-action="entries-select-empty" data-file="${file}"${empty ? "" : " disabled"}>Select rows with no lineup (${empty})</button><span class="grow"></span>
<span class="lab">${tab === "cash" ? "Cash" : "GPP"} lineup</span><select class="spsel entries-bulk-lineup" data-file="${file}" title="The lineup Fill gives the selected rows, and where Number in order starts"${list.length ? "" : " disabled"}>${opts || "<option>No complete lineups</option>"}</select>
<button type="button" class="go" data-action="entries-bulk-fill" data-file="${file}" title="Gives every selected row this lineup, one per contest; a row whose contest already has it is skipped and named"${none}>Fill</button>
<button type="button" class="ol" data-action="entries-bulk-number" data-file="${file}" title="Gives the selected rows consecutive lineups in the order listed, from the lineup picked"${none}>Number in order</button>
<button type="button" class="ol red" data-action="entries-reset" data-file="${file}" title="Takes every lineup off every row of this file, both tabs, and opens every row to suggestions again. It asks first.">Reset entries</button>
</div>${undo}`;
}

/** Step 2 (NBA's "Step 1 · Give each DraftKings entry a spot", turned to lineups). `s`: { f, m, eff, entries, slateKey, fileContext,
 *  view, labels }; `m` null when the slate has no saved lineup (the rows are listed plain, Adam 2026-10-18). */
function stepTwoHtml(s) {
  const { f, m, view } = s;
  const file = escapeHtml(f.file);
  const intro = `<div class="mh"><span class="t">Give each DraftKings entry a lineup</span><span class="muted">Each contest is suggested your saved lineups 1, 2, 3 in number order, one per entry; Cash contests take your Cash lineups.</span><span class="grow"></span><span class="muted">${s.entries.length} entr${s.entries.length === 1 ? "y" : "ies"} in ${contestCount(s.entries)} contest${contestCount(s.entries) === 1 ? "" : "s"}</span></div>`;
  if (!m) {
    return `<section class="mapcol">${intro}<div class="rs entries-empty">${escapeHtml(view?.noLineupsText ?? ENTRIES_TAB_DEFAULTS.noLineupsText)}</div>${rowsHtml(groupByContest(s.entries), s)}</section>`;
  }
  const tab = view?.tab === "cash" ? "cash" : "gpp";
  const inClass = (cls) => m.groups.filter((g) => m.classes[g.contestId] === cls);
  const countOf = (cls) => inClass(cls).reduce((n, g) => n + g.entries.length, 0);
  const tabBtn = (cls, text) => `<button type="button" role="tab" class="${tab === cls ? "on" : ""}" data-action="entries-tab" data-file="${file}" data-tab="${cls}" aria-selected="${tab === cls}">${text} <span class="opt-tab-n">${countOf(cls)}</span></button>`;
  const mine = inClass(tab);
  const open = Boolean(view?.adjust);
  const adjust = `<div class="entries-adjust"><button type="button" class="lnk" data-action="entries-adjust" data-file="${file}" aria-expanded="${open}">${open ? "▾" : "▸"} Suggestion options: which lineups and contests, Replace, Sort</button>${open ? fillStripHtml(f.file, m, tab) : ""}</div>`;
  const empty = `<div class="rs dim entries-empty">No ${tab === "cash" ? "Cash" : "GPP"} contests in this file. A contest's GPP | Cash buttons, in the other tab, move it here.</div>`;
  const unset = mine.flatMap((g) => g.entries).filter((e) => rowHolds({ pick: s.eff[e.entryId], kept: m.kept.has(String(e.entryId)), proposedId: m.proposals[e.entryId] }).state === "none").length;
  const red = unset ? `<div class="newbar red"><b>${unset}</b> ${unset === 1 ? "entry has" : "entries have"} no lineup. ${unset === 1 ? "It is" : "They are"} written back exactly as in your file; give ${unset === 1 ? "it" : "them"} a lineup above or leave ${unset === 1 ? "it" : "them"} as DraftKings has ${unset === 1 ? "it" : "them"}.</div>` : "";
  return `<section class="mapcol">${intro}
<div class="subtabs entries-tabs" role="tablist">${tabBtn("gpp", "GPP")}${tabBtn("cash", "Cash")}</div>
<div class="entries-tab-panel" data-tab="${tab}">${fillTopHtml(f.file, m, tab)}${selectBarHtml(s, tab, mine)}${adjust}${mine.length ? rowsHtml(mine, s) : empty}${red}</div></section>`;
}

/** One uploaded file's view: NBA's top bar, the three steps and the screen on show (`view.screen`: "entries", the default, "export" or
 *  "upload" with `view.uploadBody`). `view`: { fill, classes, sortBy, fold, tab, adjust, sel, undo, bulkLineup, files, lineupsFor,
 *  noLineupsText, numberOverFor, summaryOf, lineupLabelOf, lockedTextFor } (see fillModelOf; `fold`, a Set of contest ids folded away,
 *  Adam 2026-10-17; `tab` "gpp" or "cash" and `adjust`, the options fold, Adam 2026-10-18; `sel`, the selected entry ids). `fileContext`:
 *  the second-slates array, or a Showdown file-id context function (entries-plan.js showdownFileKeyOf). */
export function fileBlockHtml(f, saved, assigned, result, busy, fileContext = [], view = null) {
  const entries = f.entries ?? [];
  const slateKey = f.slate?.key ?? null;
  const label = f.slate?.label ?? "Unknown slate";
  const lineups = slateKey ? (view?.lineupsFor ?? ENTRIES_TAB_DEFAULTS.lineupsFor)(saved, f) : [];
  const eff = effectiveAssignments(entries, lineups, assigned);
  const n = Object.keys(eff).length;
  const nContests = contestCount(entries);
  const notRead = f.notRead ? `<div class="msg warn entries-not-read" role="note">${escapeHtml(f.notRead)}</div>` : "";
  const numberOver = view?.numberOverFor && slateKey ? view.numberOverFor(saved, f) : null; // Showdown: numbers over all the game's lineups, the pickers list the complete ones
  const labels = { summaryOf: view?.summaryOf, lineupLabelOf: view?.lineupLabelOf }; // each absent one is classic's (entryRowHtml)
  const m = slateKey && !f.error && lineups.length ? fillModelOf(entries, slateKey, lineups, eff, fileContext, numberOver ? { ...view, numberOver } : view) : null;
  const waiting = m ? Object.keys(m.proposals).length : 0;
  const locked = slateKey ? view?.lockedTextFor?.(f) ?? null : null; // once the slate has locked, Download is greyed and says why (walkthrough friction, PROJECT.md Part 4 item 5)
  const dlTitle = locked ?? (n === 0 ? "Give at least one entry a lineup first; nothing is written until a row has one" : "Writes your entries file with every confirmed lineup, GPP and Cash");
  const classOf = (e) => (m ? m.classes[contestKey(e)] : classifyContest(e.contestName));
  const gpp = entries.filter((e) => classOf(e) !== "cash").length;
  const bar = barHtml({ f, label, entries: entries.length, contests: nContests, gpp, cash: entries.length - gpp, n, waiting, locked, busy, dlTitle, files: view?.files });
  const screen = view?.screen === "export" || view?.screen === "upload" ? view.screen : "entries";
  const nav = stepsNavHtml(screen, stepStatus({ file: f.file, entries: entries.length, contests: nContests, n, waiting, locked, downloaded: result?.name ?? null, noLineups: !m }));
  let body;
  if (screen === "upload") body = view?.uploadBody ?? "";
  else if (f.error || !slateKey) body = `<div class="msg err lineup-status-error">${escapeHtml(f.error ?? "This file's slate could not be told; upload it again.")}</div>`;
  else if (screen === "export") body = exportScreenHtml({ f, entries, eff, lineups, numbers: m?.numbers ?? null, waiting, locked, busy, dlTitle, resultHtml: resultHtml(result), summaryOf: view?.summaryOf ?? currentSummary, nameOf: view?.lineupLabelOf ?? lineupLabel, classOf });
  else body = `${resultHtml(result)}${stepTwoHtml({ f, m, eff, entries, slateKey, fileContext, view, labels })}`;
  return `
    <div class="entries-file" data-file="${escapeHtml(f.file)}">${bar}${nav}${notRead}${body}</div>`;
}

/** The whole section's inside. `m`: { loaded, loadError, uploading, uploadError, files, assign, results, busyFile, fill, classes, sortBy,
 *  saved, fileContext, noWeek, storageWarning, screen, active, sel, undo, bulkLineup, msg, isSite }, plus the tab's own fileInputId,
 *  emptyText, rosterColumns and lineupsFor (each ENTRIES_TAB_DEFAULTS' value when absent). With no file the Upload screen shows; with
 *  no week loaded there is nothing to upload against, so only a plain line shows. */
export function entriesInnerHtml(m) {
  // 🔵 2026-10-17: blocked browser storage is said once, quietly, at the top (never a silent catch).
  const storage = m.storageWarning ? `<div class="msg warn entries-quiet">${escapeHtml(m.storageWarning)}</div>` : "";
  if (m.noWeek) return `${storage}<div class="rs dim entries-empty">No week is loaded yet. Upload the week's salary file first, then the entries file.</div>`;
  const input = `<input type="file" id="${escapeHtml(m.fileInputId ?? ENTRIES_TAB_DEFAULTS.fileInputId)}" accept=".csv,text/csv" hidden />`;
  const upErr = m.uploadError ? `<div class="msg err lineup-status-error entries-error">${escapeHtml(m.uploadError)}</div>` : "";
  const note = m.msg ? `<div class="msg ${m.msg.kind === "ok" ? "ok" : "warn"}">${escapeHtml(m.msg.text)}<button type="button" data-action="entries-dismiss" aria-label="Dismiss">✕</button></div>` : "";
  let body;
  if (!m.loaded) body = `<div class="rs dim entries-empty">Loading…</div>`;
  else if (m.loadError) body = `<div class="msg err lineup-status-error">${escapeHtml(m.loadError)}</div>`;
  else {
    const files = m.files ?? [];
    const upload = uploadScreenHtml({ ...m, emptyText: m.emptyText ?? ENTRIES_TAB_DEFAULTS.emptyText, rosterColumns: m.rosterColumns ?? ENTRIES_TAB_DEFAULTS.rosterColumns });
    const f = files.find((x) => x.file === m.active) ?? files[0];
    body = !f
      ? upload
      : fileBlockHtml(f, m.saved, m.assign?.[f.file], m.results?.[f.file], m.busyFile === f.file, m.fileContext, {
        fill: m.fill?.[f.file], classes: m.classes?.[f.file], sortBy: m.sortBy, fold: m.fold?.[f.file], tab: m.tab?.[f.file], adjust: m.adjust?.[f.file],
        sel: m.sel?.[f.file], undo: m.undo?.[f.file]?.text ?? null, bulkLineup: m.bulkLineup?.[f.file], screen: m.screen, uploadBody: upload,
        files: files.map((x) => ({ file: x.file, label: x.slate?.label ?? "Unknown slate" })),
        lineupsFor: m.lineupsFor, noLineupsText: m.noLineupsText, numberOverFor: m.numberOverFor, summaryOf: m.summaryOf, lineupLabelOf: m.lineupLabelOf, lockedTextFor: m.lockedTextFor,
      });
  }
  return `${storage}${upErr}${note}<div class="entries-screen${m.uploading ? " busy" : ""}" data-drop-zone>${body}</div>${input}`;
}

/** The section with its id (`m.sectionId`, classic "entries-section" when absent); `ent` scopes NBA's look (public/entries.css). */
export function entriesSectionHtml(m) {
  return `<div class="entries-section ent" id="${escapeHtml(m.sectionId ?? ENTRIES_TAB_DEFAULTS.sectionId)}">${entriesInnerHtml(m)}</div>`;
}
