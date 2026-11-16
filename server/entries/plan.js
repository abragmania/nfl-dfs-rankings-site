// The pure part of the classic Entries routes (./routes.js), moved unchanged so the public site can run it in the visitor's
// browser (RULES.md D71: the site does everything the app does; tools/publish.mjs copies this file to out/server/ through
// site-src/site-entries.js): the week tag, the file stamp, the entries summary, the id-match ranking and the slate detection, the
// upload file's name, the checks on Adam's assignments (planExport) and the download's name. No file, no network and no clock:
// every input is passed in. Nothing here imports a node: module.
import { assignSlots, validateLineup, idOfCell, earliestKickoffMs } from "../lineup/dk-entries.js";
import { rowIsSidelined } from "../rank/value.js";
import { entriesInjuryProblem, isRevived, statusWordOf, flaggedWordOf } from "../rank/sidelined.js";
import { tabOfMode } from "../showdown/override-tabs.js"; // a saved lineup's tab is its mode's (optimizer standard Part F)

/** The share of an entries file's players its slate must hold; anything less is refused as no clear slate. */
export const MIN_MATCH_RATIO = 0.9;

export function weekTag(season, week) {
  return `${season}-w${String(week).padStart(2, "0")}`;
}

/** "YYYYMMDD-HHMMSS-mmm" (UTC) for file names: a sortable stamp, not a kickoff time. */
export function fileStamp(ms) {
  const iso = new Date(ms).toISOString(); // 2026-10-10T14:03:22.123Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}-${iso.slice(20, 23)}`;
}

/** One row per entry, as the browser shows it. `current`: the nine roster cells as written, or null when blank. */
export function entriesSummary(parsed) {
  return parsed.entries.map((e) => ({
    entryId: e.entryId,
    contestName: e.contestName,
    contestId: e.contestId,
    fee: e.entryFee,
    current: e.roster.every((c) => String(c).trim() === "") ? null : e.roster.slice()
  }));
}

/** The upload answer's "rows not read" line for an entries file (parseEntriesCsv's `notRead`, G62), or null when every
 *  row was read. Classic and Showdown uploads both carry it (the Entries tab shows it on the file's block). */
export function notReadText(parsed) {
  const list = parsed?.notRead ?? [];
  return list.length ? `${list.length} row${list.length === 1 ? "" : "s"} not read: ${list.map((r) => `line ${r.line} (${r.why})`).join("; ")}.` : null;
}

/**
 * Seeds `inContest` (contest id | sorted file ids -> who holds it) with each entry left as it is (not in `assigned`), so no
 * new lineup repeats one in the same contest. A blank row is skipped; a row whose cells do not all name players in the
 * file's list cannot be checked, and `warnings` says which (G62). The one copy: classic and Showdown export plans use it.
 */
export function seedLeftAsIs(parsed, assigned, inContest, warnings) {
  const unchecked = [];
  for (const e of parsed.entries) {
    if (assigned.has(e.entryId)) continue;
    const ids = e.roster.map(idOfCell);
    if (ids.some((id) => id === "" || !parsed.pool.has(id))) {
      if (ids.some((id) => id !== "")) unchecked.push(e.entryId);
      continue;
    }
    inContest.set(`${e.contestId.trim()}|${[...ids].sort().join(",")}`, `${e.entryId} (left as it is)`);
  }
  const n = unchecked.length;
  if (n) warnings.push(`${n} entr${n === 1 ? "y" : "ies"} left as ${n === 1 ? "it is holds" : "they are hold"} players not in the file's player list, so no new lineup was checked against ${n === 1 ? "it" : "them"} for a repeat in the same contest: ${unchecked.join(", ")}.`);
}

/**
 * The id-match ranking an entries file's player list is judged by: each candidate ({ ids: Set, ... }) scored by how
 * many of `fileIds` it holds, most first. Returns { best, total } for a clear winner, else { why, best, other, total }
 * where why is "none" (no candidate holds any), "tie" (two hold the same top count; `other` is the second) or "few"
 * (the winner holds under MIN_MATCH_RATIO of the file's players). Each scored candidate carries `matched`.
 */
export function rankIdMatch(fileIds, candidates) {
  const scored = candidates.map((c) => ({ ...c, matched: fileIds.filter((id) => c.ids.has(id)).length })).sort((a, b) => b.matched - a.matched);
  const best = scored[0];
  const total = fileIds.length;
  if (!best || best.matched === 0) return { why: "none", best, total };
  if (scored[1] && scored[1].matched === best.matched) return { why: "tie", best, other: scored[1], total };
  if (best.matched / total < MIN_MATCH_RATIO) return { why: "few", best, total };
  return { best, total };
}

/** The earliest kickoff of a slate's games: one copy, in ../lineup/dk-entries.js (pure), which the browser's Download DK CSV reads too. */
export { earliestKickoffMs };

export const ASSIGNMENT_KEYS = new Set(["entryId", "lineupId"]);

/** data/entries/<season>-w<NN>-<slate key>-entries-<stamp>.csv: an uploaded export, exactly as received. */
export function uploadFileName(season, week, slateKey, stamp) {
  return `${weekTag(season, week)}-${slateKey}-entries-${stamp}.csv`;
}

/** The name the browser saves the written upload file under. */
export function downloadFileName(stamp) {
  return `DKEntries-upload-${stamp}.csv`;
}

/**
 * Which loaded slate the entries file's player list belongs to (D57): the main slate (its own DraftKings ids) or a
 * second slate (that file's ids, reached through its dkIds map). The slate holding the most of the file's ids wins.
 * Returns { error } when no slate holds any, when two slates hold the same top count, or when the winner holds
 * under MIN_MATCH_RATIO of the file's players; otherwise { key, label, gameIds (null for main), matched, total,
 * fileIdOf } where fileIdOf(mainRowId) is the id the entries file uses for that board player (undefined if none).
 */
export function detectSlate(pool, full, secondSlates = []) {
  const fileIds = [...pool.keys()];
  const candidates = [];
  const mainIds = new Set((full?.players ?? []).map((p) => String(p.id)));
  candidates.push({ key: "main", label: "Main slate", gameIds: null, ids: mainIds, fileIdOf: (id) => (mainIds.has(String(id)) ? String(id) : undefined) });
  for (const s of secondSlates ?? []) {
    const map = s?.dkIds ?? {};
    candidates.push({
      key: s.key,
      label: s.label,
      gameIds: Array.isArray(s.gameIds) ? [...s.gameIds] : [],
      ids: new Set(Object.values(map).map(String)),
      fileIdOf: (id) => (Object.prototype.hasOwnProperty.call(map, String(id)) ? String(map[String(id)]) : undefined)
    });
  }
  const { why, best, other, total } = rankIdMatch(fileIds, candidates);
  if (why === "none") {
    return { error: `None of the ${total} players in this entries file is on the loaded week's main slate or its second slates; load that slate's salary file first.` };
  }
  if (why === "tie") {
    return { error: `This entries file's players split evenly between the ${best.label} and the ${other.label} (${best.matched} each), so its slate cannot be told.` };
  }
  if (why === "few") {
    return { error: `Only ${best.matched} of the ${total} players in this entries file are on the ${best.label}; it does not match any loaded slate closely enough.` };
  }
  return { key: best.key, label: best.label, gameIds: best.gameIds, matched: best.matched, total, fileIdOf: best.fileIdOf };
}

export function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Checks Adam's assignments and turns them into buildUpload's byEntry map. Pure: every input is passed in.
 *   parsed        parseEntriesCsv() of the entries file
 *   full          the loaded main slate (players with id and kickoffUtc, games with kickoffUtc)
 *   slate         detectSlate() of that file
 *   savedLineups  the week's saved lineups (server/lineups/store.js)
 *   boardRows     the current board's rows (status and the injured flag, D27 / rowIsSidelined)
 *   injuryReport  the board's { state, source } (R82): "missing" or absent is an error (nothing can be checked), "stale" a warning
 *   assignments   the request's [{ entryId, lineupId }]
 *   nowMs         the clock, read once for the after-lock refusal (D55 amendment)
 * Returns { locked: true, error } when past the earliest kickoff, else { errors, warnings, byEntry }.
 */
export function planExport({ parsed, full, slate, savedLineups, boardRows, cashBoardRows = null, injuryReport, assignments, nowMs }) {
  const lockMs = earliestKickoffMs(full, slate);
  if (lockMs === null) return { locked: true, error: "The earliest kickoff of this slate could not be read from the salary file, so the upload file is not written." };
  if (nowMs >= lockMs) {
    const name = /slate$/i.test(slate.label) ? slate.label : `${slate.label} slate`;
    return { locked: true, error: `The ${name} has locked (its first game has kicked off); DraftKings would refuse these lineups, so no upload file is written.` };
  }

  const errors = [];
  const warnings = [];
  const byEntry = new Map();
  const injuryProblem = entriesInjuryProblem(injuryReport);
  if (injuryProblem?.error) return { errors: [injuryProblem.error], warnings, byEntry };
  if (injuryProblem?.warning) warnings.push(injuryProblem.warning);
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return { errors: ["assignments must be a non-empty list of { entryId, lineupId }."], warnings, byEntry };
  }
  const { pool } = parsed;
  const entryById = new Map(parsed.entries.map((e) => [e.entryId, e]));
  const lineupById = new Map((savedLineups ?? []).map((l) => [l?.id, l]));
  const playerById = new Map((full?.players ?? []).map((p) => [String(p.id), p]));
  const rowById = new Map((boardRows ?? []).map((r) => [String(r.id), r]));
  const cashRowById = cashBoardRows ? new Map(cashBoardRows.map((r) => [String(r.id), r])) : rowById; // a Cash lineup's revives are the Cash tab's own typed numbers (optimizer standard Part F)
  const seenEntries = new Set();
  const inContest = new Map(); // contest id | sorted file ids -> who holds it

  // Entries left as they are keep their current lineup in their contest: seed them first (seedLeftAsIs above).
  const assigned = new Set(assignments.filter((a) => isPlainObject(a) && typeof a.entryId === "string").map((a) => a.entryId.trim()));
  seedLeftAsIs(parsed, assigned, inContest, warnings);

  assignments.forEach((a, i) => {
    const n = i + 1;
    if (!isPlainObject(a)) return errors.push(`Assignment ${n} is not an object of { entryId, lineupId }.`);
    const unknown = Object.keys(a).find((k) => !ASSIGNMENT_KEYS.has(k));
    if (unknown !== undefined) return errors.push(`Assignment ${n} has the unknown field ${JSON.stringify(unknown)}; send { entryId, lineupId }.`);
    if (typeof a.entryId !== "string" || a.entryId.trim() === "") return errors.push(`Assignment ${n}: entryId must be the entry id as text.`);
    if (typeof a.lineupId !== "string" || a.lineupId.trim() === "") return errors.push(`Assignment ${n}: lineupId must be a saved lineup's id.`);
    const entryId = a.entryId.trim();
    const entry = entryById.get(entryId);
    if (!entry) return errors.push(`Entry ${entryId} is not in the uploaded entries file.`);
    if (seenEntries.has(entryId)) return errors.push(`Entry ${entryId} is given a lineup more than once.`);
    seenEntries.add(entryId);
    const lineup = lineupById.get(a.lineupId.trim());
    if (!lineup) return errors.push(`Entry ${entryId}: there is no saved lineup with the id ${a.lineupId.trim()}; only saved lineups can be uploaded.`);
    const label = `Entry ${entryId} (${lineup.name ?? lineup.id})`;
    const mainIds = (Array.isArray(lineup.slots) ? lineup.slots : []).map((s) => String(s?.playerId ?? ""));
    if (mainIds.length !== 9) return errors.push(`${label}: the saved lineup has ${mainIds.length} players; a DraftKings classic lineup needs exactly nine.`);

    // Wrong slate: every player must be in the entries file's own player list.
    const fileIds = [];
    const missing = [];
    for (const id of mainIds) {
      const fileId = slate.fileIdOf(id);
      if (fileId === undefined || !pool.has(fileId)) missing.push(playerById.get(id)?.name ?? id);
      else fileIds.push(fileId);
    }
    if (missing.length) {
      return errors.push(`${label}: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not in this entries file's player list (${slate.label}); the lineup belongs to another slate.`);
    }

    const kickoffById = new Map();
    const statusById = new Map();
    const sidelinedIds = new Set();
    const revived = new Map();
    const flagged = new Map();
    const offBoard = [];
    mainIds.forEach((id, k) => {
      kickoffById.set(fileIds[k], playerById.get(id)?.kickoffUtc ?? null);
      const row = (tabOfMode(lineup.mode) === "cash" ? cashRowById : rowById).get(id);
      if (!row) return offBoard.push(playerById.get(id)?.name ?? id);
      statusById.set(fileIds[k], statusWordOf(row)); // Adam's own In reads no status, his Out "Out" (2026-11-12)
      if (flaggedWordOf(row)) flagged.set(fileIds[k], flaggedWordOf(row)); // an outside feed's Out/IR/Doubtful/Inactive tag: a warning, never a refusal
      if (isRevived(row)) revived.set(fileIds[k], row.override.proj);
      else if (rowIsSidelined(row)) sidelinedIds.add(fileIds[k]);
    });
    if (offBoard.length) return errors.push(`${label}: ${offBoard.join(", ")} ${offBoard.length === 1 ? "is" : "are"} not on the board, so the injury status cannot be checked.`);

    let slots;
    try {
      slots = assignSlots(fileIds, pool, kickoffById); // the latest-kickoff spare goes to FLEX (D56)
    } catch (e) {
      return errors.push(`${label}: ${e.message}`);
    }
    const verdict = validateLineup(slots, pool, { statusById, sidelinedIds, revived, flagged }); // the file's own prices
    for (const e of verdict.errors) errors.push(`${label}: ${e}`);
    for (const w of verdict.warnings) warnings.push(`${label}: ${w}`);
    if (verdict.errors.length) return undefined;

    const key = `${entry.contestId.trim()}|${[...fileIds].sort().join(",")}`;
    if (inContest.has(key)) {
      return errors.push(`${label} is the same lineup as entry ${inContest.get(key)} in the same contest (${entry.contestName}); a contest never gets the same lineup twice.`);
    }
    inContest.set(key, entryId);
    byEntry.set(entryId, slots);
    return undefined;
  });
  return { errors, warnings, byEntry };
}
