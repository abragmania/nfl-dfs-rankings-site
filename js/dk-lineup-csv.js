// `Download DK CSV` (optimizer standard A12, round 3): the saved lineups Adam ticks on the Optimizer screen, as a DraftKings lineup file he can
// upload, built in the browser so the public site makes it too (no server, no contest file; the Entries tab stays for filling a contest's own file).
// One header row of the seat names, then one row per lineup, each cell `Name (DraftKingsId)` as DraftKings writes its own entries file. Classic: QB, RB, RB, WR,
// WR, WR, TE, FLEX, DST. Showdown: CPT, FLEX x5, the Captain's cell carrying his Captain id.
// Money: the file is uploaded to DraftKings, so a lineup Entries would refuse is never written, and this runs Entries' own checks (round 3 fix batch): the pure rules in
// server/lineup/dk-entries.js, dk-showdown-entries.js and server/rank/sidelined.js are imported here, not copied (the live app serves those three files; the site build
// copies them to out/server/, tools/publish.mjs PAGE_MODULES_WITH_SERVER_IMPORTS). The same refusals: no injury report (or one the board does not describe), the slate past
// its first kickoff, a man off the board, no id in that slate's file, a wrong shape, over the cap on the file's own prices, one game or one team, a sidelined man. The same
// slot order (assignSlots: the latest-kickoff spare goes to FLEX). The same warnings are written as notes. Every man is read from the live board, never from the saved record.
// Pure apart from downloadText.
import { showdownFileKeyOf } from "./entries-plan.js";
import { classicFilePool, kickoffLookup } from "./classic-seat.js";
import { assignSlots, validateLineup, earliestKickoffMs } from "../server/lineup/dk-entries.js";
import { validateShowdownEntry } from "../server/lineup/dk-showdown-entries.js";
import { entriesInjuryProblem, rowIsSidelined, isRevived } from "../server/rank/sidelined.js";

export const CLASSIC_SEATS = Object.freeze(["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"]);
export const SHOWDOWN_SEATS = Object.freeze(["CPT", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX"]);

/** A CSV cell, quoted only when it needs it (a comma, a quote or a line break). */
export function csvCell(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One cell of the file: `Name (id)`. */
export function dkCell(name, id) {
  return csvCell(`${name} (${id})`);
}

/**
 * The seat each saved slot fills, in the file's seat order: a slot is matched to the first still-unused seat of its own name, so a
 * lineup saved in any slot order is written in the file's. null when a seat is left empty.
 */
export function seatOrder(slots, seats) {
  const left = [...(slots ?? [])];
  const out = [];
  for (const seat of seats) {
    const i = left.findIndex((s) => String(s?.slot ?? "").trim().toUpperCase() === seat);
    if (i < 0) return null;
    out.push(left[i]);
    left.splice(i, 1);
  }
  return left.length === 0 ? out : null;
}

const hasText = (v) => v !== null && v !== undefined && String(v).trim() !== "";

/** What Entries does with one man's board row, keyed by his file id(s): his status, the sidelined set, the typed-projection revive. Entries' own reads (sidelined.js). */
function injuryOptions(men) {
  const statusById = new Map();
  const sidelinedIds = new Set();
  const revived = new Map();
  for (const { row, ids } of men) {
    for (const id of ids) {
      statusById.set(id, row.status ?? null);
      if (isRevived(row)) revived.set(id, row.override.proj);
      else if (rowIsSidelined(row)) sidelinedIds.add(id);
    }
  }
  return { statusById, sidelinedIds, revived };
}

const lockName = (label) => (/slate$/i.test(label) ? label : `${label} slate`);

// ---- classic ----

function classicCells(lineup, ctx) {
  const slots = Array.isArray(lineup?.slots) ? lineup.slots : [];
  if (slots.length !== CLASSIC_SEATS.length) return { why: `it does not fill all ${CLASSIC_SEATS.length} seats` };
  const rows = slots.map((s) => ctx.rowById.get(String(s.playerId)));
  const off = slots.filter((s, i) => !rows[i]).map((s) => `${s.name ?? s.playerId} is not on the board`);
  if (off.length) return { why: off.join("; ") };
  const made = classicFilePool(slots, rows, ctx.slateKey, ctx.slates, ctx.kickoffOf); // the one copy the screen's seating reads too (classic-seat.js)
  if (!made) {
    const map = ctx.record?.dkIds ?? {};
    const lacking = rows.filter((r) => !Object.prototype.hasOwnProperty.call(map, String(r.id))).map((r) => `${r.name} has no id in this slate's DraftKings file`);
    return { why: lacking.length ? lacking.join("; ") : "its DraftKings ids could not be read" };
  }
  const { ids, pool, kickoffById } = made;
  const noSalary = rows.filter((r) => !Number.isFinite(pool.get(ids[rows.indexOf(r)]).salary)).map((r) => `${r.name} has no salary on the board`);
  if (noSalary.length) return { why: noSalary.join("; ") };
  let ordered;
  try {
    ordered = assignSlots(ids, pool, kickoffById); // the latest-kickoff spare goes to FLEX (D56)
  } catch (e) {
    return { why: e.message };
  }
  const verdict = validateLineup(ordered, pool, injuryOptions(rows.map((row, i) => ({ row, ids: [ids[i]] }))));
  if (verdict.errors.length) return { why: verdict.errors.join(" ") };
  return { cells: ordered.map((id) => dkCell(pool.get(id).name, id)), warnings: verdict.warnings };
}

// ---- Showdown ----

function showdownCells(lineup, ctx) {
  const ordered = seatOrder(lineup?.slots, SHOWDOWN_SEATS);
  if (!ordered) return { why: `it does not fill all ${SHOWDOWN_SEATS.length} seats` };
  const rows = ordered.map((s) => ctx.rowByAnyId.get(String(s.playerId).trim()));
  const off = ordered.filter((s, i) => !rows[i]).map((s) => `${s.name ?? s.playerId} is not on the board`);
  if (off.length) return { why: off.join("; ") };
  const why = [];
  rows.forEach((row, i) => {
    const first = rows.findIndex((r) => String(r.id) === String(row.id));
    if (first !== i) why.push(first === 0 ? `${row.name} is at both Captain and FLEX` : `${row.name} is in the lineup more than once`);
    const cptId = hasText(row.cptId) ? String(row.cptId).trim() : "";
    if (i === 0 && !cptId) why.push(`${row.name} has no Captain id on the board`);
    if (i > 0 && cptId && cptId === String(row.id).trim()) why.push(`${row.name} can only be Captain; he has no FLEX id`);
  });
  const lacking = rows.filter((r, i) => !Number.isFinite(i === 0 ? r.cptSalary : r.salary)).map((r) => `${r.name} has no salary on the board`);
  why.push(...lacking);
  if (why.length) return { why: why.join("; ") };
  const ids = ctx.fileKeyOf(lineup);
  if (!ids) return { why: "its DraftKings ids could not be read" };
  const pool = new Map();
  rows.forEach((row, i) => {
    pool.set(ids[i], { name: row.name, pos: row.pos, team: row.team, salary: i === 0 ? row.cptSalary : row.salary, rosterPos: i === 0 ? "CPT" : "FLEX" });
  });
  const men = rows.map((row) => ({ row, ids: [String(row.id).trim(), ...(hasText(row.cptId) ? [String(row.cptId).trim()] : [])] }));
  const verdict = validateShowdownEntry(ids, pool, injuryOptions(men));
  if (verdict.errors.length) return { why: verdict.errors.join(" ") };
  return { cells: ids.map((id) => dkCell(pool.get(id).name, id)), warnings: verdict.warnings };
}

/** The whole file refused before any lineup is looked at: Entries' own gates (the injury report, the lock). Returns a sentence, or null when the file may be written. */
function gate({ showdown, board, record, slateKey, nowMs }) {
  const problem = entriesInjuryProblem(board?.injuryReport);
  if (problem?.error) return { error: problem.error };
  if (showdown) {
    const g = board?.game ?? {};
    const lockMs = earliestKickoffMs({ games: [{ id: g.gameId, kickoffUtc: g.kickoffUtc }] }, null);
    if (lockMs === null) return { error: "The kickoff of this Showdown game could not be read from its salary file, so no file is written." };
    if (nowMs >= lockMs) return { error: `The ${g.away ?? "?"}@${g.home ?? "?"} Showdown has locked (its game has kicked off); DraftKings would refuse these lineups, so no file is written.` };
    return { warning: problem?.warning ?? null };
  }
  if (!hasText(slateKey)) return { error: "The slate on screen is not known, so the file's DraftKings ids cannot be chosen; nothing is written." };
  if (slateKey !== "main" && !record) return { error: `The slate on screen (${slateKey}) is not on this board, so its DraftKings ids are not known; nothing is written.` };
  const games = board?.slate?.games ?? [];
  const lockMs = earliestKickoffMs({ games }, record ? { gameIds: record.gameIds } : null);
  if (lockMs === null) return { error: "The earliest kickoff of this slate could not be read from the salary file, so no file is written." };
  if (nowMs >= lockMs) return { error: `The ${lockName(record ? record.label : "Main slate")} has locked (its first game has kicked off); DraftKings would refuse these lineups, so no file is written.` };
  return { warning: problem?.warning ?? null };
}

/**
 * The file for `lineups` (saved lineups: {name, slots: [{slot, playerId, name}]}). `kind`: "classic" or "showdown". `board` is the live board
 * ({rows, slates, slate.games, injuryReport, game}); `slateKey` the classic slate on screen ("main" or a second slate's key; none given refuses the file). `nowMs` the clock.
 * Answers {text, written, skipped: [{name, why}], notes: [sentence]}; text is "" when nothing could be written. Lines end with CRLF, as DraftKings' own files do.
 */
export function dkLineupCsv({ kind, lineups, board, slateKey, nowMs = Date.now() }) {
  const showdown = kind === "showdown";
  const seats = showdown ? SHOWDOWN_SEATS : CLASSIC_SEATS;
  const boardRows = Array.isArray(board?.rows) ? board.rows : [];
  const slates = board?.slates ?? [];
  const record = !showdown && hasText(slateKey) && slateKey !== "main" ? slates.find((s) => s?.key === slateKey) ?? null : null;
  const ctx = { slateKey, slates, record };
  const skipped = [];
  const notes = [];
  const refuseAll = (why) => ({ text: "", written: 0, skipped: (lineups ?? []).map((l) => ({ name: l?.name ?? "A lineup", why })), notes });
  const gated = gate({ showdown, board, record, slateKey, nowMs });
  if (gated.error) return refuseAll(gated.error);
  if (gated.warning) notes.push(gated.warning);
  if (showdown) {
    ctx.fileKeyOf = showdownFileKeyOf(boardRows);
    ctx.rowByAnyId = new Map();
    for (const r of boardRows) {
      if (r?.id == null) continue;
      ctx.rowByAnyId.set(String(r.id).trim(), r);
      if (hasText(r.cptId)) ctx.rowByAnyId.set(String(r.cptId).trim(), r);
    }
  } else {
    ctx.rowById = new Map(boardRows.filter((r) => r?.id != null).map((r) => [String(r.id), r]));
    ctx.kickoffOf = kickoffLookup(board);
    if (record && !record.prices) notes.push(`The salary check used the main slate's prices: ${record.label ?? record.key} was loaded before its own prices were kept, so upload its salary file again for the exact check.`);
  }
  const lines = [];
  for (const lineup of lineups ?? []) {
    const label = lineup?.name ?? "A lineup";
    const made = showdown ? showdownCells(lineup, ctx) : classicCells(lineup, ctx);
    if (made.why) {
      skipped.push({ name: label, why: made.why });
      continue;
    }
    lines.push(made.cells.join(","));
    for (const w of made.warnings ?? []) notes.push(`${label}: ${w}`);
  }
  if (!lines.length) return { text: "", written: 0, skipped, notes };
  return { text: `${[seats.join(","), ...lines].join("\r\n")}\r\n`, written: lines.length, skipped, notes };
}

/** The download's name: DK-lineups-<slate>.csv, the slate label made safe for a file name. */
export function dkCsvFileName(slateLabel) {
  const safe = String(slateLabel ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `DK-lineups${safe ? `-${safe}` : ""}.csv`;
}

/** The sentences beside the button after a download: how many were written (only those), a `Left out:` line naming each lineup left out and why, and a `Check:` line with Entries' warnings. */
export function dkCsvStatus({ written, skipped, notes = [] }) {
  const parts = [];
  if (written) parts.push(`${written} lineup${written === 1 ? "" : "s"} written to the DK CSV.`);
  if (skipped.length) {
    const reasons = new Set(skipped.map((s) => s.why));
    // One reason for every lineup (the file was refused whole): said once.
    parts.push(reasons.size === 1 && skipped.length > 1 ? `Left out: all ${skipped.length} lineups (${[...reasons][0]}).` : `Left out: ${skipped.map((s) => `${s.name} (${s.why})`).join("; ")}.`);
  }
  if (notes.length) parts.push(`Check: ${notes.join(" ")}`);
  return parts.join("\n");
}

/** Hands `text` to the browser as a file download. The one DOM piece here. The object URL is released a moment later: revoking it in the same turn as the click can cancel the download in some browsers. */
export function downloadText(filename, text, doc = document, urlApi = URL, later = setTimeout) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = urlApi.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  later(() => urlApi.revokeObjectURL(url), 4000);
}
