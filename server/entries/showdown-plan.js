// The pure part of the Showdown Entries routes (../showdown/entries-routes.js), moved unchanged so the public site runs it in the
// visitor's browser (RULES.md D71): the file names, the match of an entries file to a Showdown game, and the checks on Adam's
// assignments for one game (planShowdownExport). No file, no network and no clock: every input is passed in. Nothing here imports
// a node: module; tools/publish.mjs copies this file to out/server/ through site-src/site-entries.js.
import { showdownSlotsFor, validateShowdownEntry, overBothIds } from "../lineup/dk-showdown-entries.js";
import { rowIsSidelined } from "../rank/value.js";
import { entriesInjuryProblem, isRevived, statusWordOf, flaggedWordOf } from "../rank/sidelined.js";
import { tabOfMode } from "../showdown/override-tabs.js"; // a saved lineup's tab is its mode's (optimizer standard Part F)
import { rankIdMatch, seedLeftAsIs, earliestKickoffMs, isPlainObject, ASSIGNMENT_KEYS } from "./plan.js";

const KEY_WEEK_RE = /^(\d{4}-w\d{2})-([A-Z]{4,6})$/;

/** "<season>-w<NN>-showdown-<AWAYHOME>" for a key with a known week, else null. */
export function filePrefix(key) {
  const m = KEY_WEEK_RE.exec(String(key ?? ""));
  return m ? `${m[1]}-showdown-${m[2]}` : null;
}
export const AWAYHOME = (key) => KEY_WEEK_RE.exec(key)?.[2] ?? "";

export const uploadFileName = (key, stamp) => `${filePrefix(key)}-entries-${stamp}.csv`;
export const exportFileName = (key, stamp) => `${filePrefix(key)}-entries-upload-${stamp}.csv`;
/** The name the browser saves a game's written upload file under. */
export const downloadFileName = (key, stamp) => `DKEntries-showdown-${AWAYHOME(key)}-upload-${stamp}.csv`;

/** "ATL @ GB (2026 week 3)" from a game's slate. */
function gameLabel(slate) {
  const g = Array.isArray(slate?.games) ? slate.games[0] ?? {} : {};
  const week = Number.isInteger(slate?.week) ? `week ${slate.week}` : "week unknown";
  return `${g.away ?? "?"} @ ${g.home ?? "?"} (${slate?.season ?? "season unknown"} ${week})`;
}

/** A game as a match candidate: its key, label, slate and every id of its salary file (FLEX and Captain rows). */
function candidateOf(key, slate) {
  const ids = new Set((slate?.players ?? []).flatMap((p) => [p?.id, p?.cptId]).filter((id) => id !== null && id !== undefined && String(id).trim() !== "").map((id) => String(id).trim()));
  return { key, label: gameLabel(slate), slate, ids };
}

/**
 * Which Showdown game the entries file's player list belongs to: the game whose salary file holds the most of its ids,
 * by classic's rules (rankIdMatch: no game holds any, two hold the same top count, or the winner holds under 90 percent
 * are refused). Returns { error } or { key, label, slate, matched, total }.
 */
export function matchShowdownGame(pool, games) {
  const { why, best, other, total } = rankIdMatch([...pool.keys()], (games ?? []).map((g) => candidateOf(g.key, g.slate)));
  if (why === "none") return { error: `None of the ${total} players in this Showdown entries file is in a loaded Showdown game; upload that game's Showdown salary file first.` };
  if (why === "tie") return { error: `This Showdown entries file's players split evenly between ${best.label} and ${other.label} (${best.matched} each), so its game cannot be told.` };
  if (why === "few") return { error: `Only ${best.matched} of the ${total} players in this Showdown entries file are in ${best.label}; it does not match any loaded Showdown game closely enough.` };
  return { key: best.key, label: best.label, slate: best.slate, matched: best.matched, total };
}

export const gameSummary = (m) => (m && !m.error ? { key: m.key, label: m.label, matched: m.matched, total: m.total } : null);

/** The injury options validateShowdownEntry reads, keyed by both of each man's file ids (overBothIds), and the ids on the board. */
function injuryMaps(boardRows, slatePlayers) {
  const statusById = new Map();
  const sidelined = new Set();
  const revived = new Map();
  const flagged = new Map();
  for (const row of boardRows ?? []) {
    const id = String(row?.id);
    statusById.set(id, statusWordOf(row)); // Adam's own In reads no status, his Out "Out" (2026-11-12)
    if (flaggedWordOf(row)) flagged.set(id, flaggedWordOf(row)); // an outside feed's Out/IR/Doubtful/Inactive tag: a warning, never a refusal
    if (isRevived(row)) revived.set(id, row.override.proj);
    else if (rowIsSidelined(row)) sidelined.add(id);
  }
  return {
    onBoard: overBothIds(new Set(statusById.keys()), slatePlayers),
    options: { statusById: overBothIds(statusById, slatePlayers), sidelinedIds: overBothIds(sidelined, slatePlayers), revived: overBothIds(revived, slatePlayers), flagged: overBothIds(flagged, slatePlayers) }
  };
}

/**
 * Checks Adam's assignments for one Showdown game and turns them into buildShowdownUpload's byEntry map. Pure.
 *   parsed        parseShowdownEntriesCsv() of the entries file
 *   slate         the game's saved Showdown slate (players with id and cptId; games[0].kickoffUtc, the lock)
 *   label         the game's label for the sentences
 *   savedLineups  this game's saved lineups (data/showdown/<key>/lineups)
 *   boardRows     lineupRows(board) of the served board (status, the injured flag, a revive)
 *   cashBoardRows the same of the Cash tab's served board, whose revives a Cash lineup is checked by (optimizer standard Part F: each
 *                 tab has its own typed numbers); absent, every lineup is checked on boardRows
 *   injuryReport  the board's { state, source } (R82): "missing" or absent is an error, "stale" a warning
 *   assignments   the request's [{ entryId, lineupId }]
 *   nowMs         the clock, read once for the after-lock refusal (D55 amendment)
 * Returns { locked: true, error } once the game has kicked off, else { errors, warnings, byEntry }.
 */
export function planShowdownExport({ parsed, slate, label, savedLineups, boardRows, cashBoardRows = null, injuryReport, assignments, nowMs }) {
  const lockMs = earliestKickoffMs({ games: (slate?.games ?? []).slice(0, 1) }, null); // the one game's kickoff (D30: no new date logic)
  if (lockMs === null) return { locked: true, error: "The kickoff of this Showdown game could not be read from its salary file, so the upload file is not written." };
  if (nowMs >= lockMs) return { locked: true, error: `The ${label} Showdown has locked (its game has kicked off); DraftKings would refuse these lineups, so no upload file is written.` };

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
  const players = slate?.players ?? [];
  const entryById = new Map(parsed.entries.map((e) => [e.entryId, e]));
  const lineupById = new Map((savedLineups ?? []).map((l) => [l?.id, l]));
  const { onBoard, options } = injuryMaps(boardRows, players);
  const cashOptions = cashBoardRows ? injuryMaps(cashBoardRows, players).options : options;
  const seenEntries = new Set();
  const inContest = new Map(); // contest id | sorted file ids -> who holds it

  // Entries left as they are keep their current lineup in their contest (plan.js seedLeftAsIs; a row it cannot check is a warning).
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
    const tag = `Entry ${entryId} (${lineup.name ?? lineup.id})`;
    const resolved = showdownSlotsFor(lineup, players); // a Captain saved by his FLEX id or his Captain id; six file ids, Captain first
    if (resolved.error) return errors.push(`${tag}: ${resolved.error}`);
    const missing = resolved.ids.filter((id) => !pool.has(id));
    if (missing.length) {
      // Each named from the slate as "Name (id)", the id being the file id (his Captain row's for the Captain).
      const nameOf = (id) => players.find((p) => [p?.id, p?.cptId].some((x) => x !== null && x !== undefined && String(x).trim() === id))?.name;
      const named = missing.map((id) => (nameOf(id) ? `${nameOf(id)} (${id})` : `id ${id}`));
      return errors.push(`${tag}: ${named.join(", ")} ${missing.length === 1 ? "is" : "are"} not in this entries file's player list (${label}); the lineup belongs to another game.`);
    }
    const offBoard = resolved.ids.filter((id) => !onBoard.has(id)).map((id) => pool.get(id).name);
    if (offBoard.length) return errors.push(`${tag}: ${offBoard.join(", ")} ${offBoard.length === 1 ? "is" : "are"} not on the board, so the injury status cannot be checked.`);

    const verdict = validateShowdownEntry(resolved.ids, pool, tabOfMode(lineup.mode) === "cash" ? cashOptions : options); // the file's own prices; a lineup's revives are its own tab's
    for (const e of verdict.errors) errors.push(`${tag}: ${e}`);
    for (const w of verdict.warnings) warnings.push(`${tag}: ${w}`);
    if (verdict.errors.length) return undefined;

    const key = `${entry.contestId.trim()}|${[...resolved.ids].sort().join(",")}`;
    if (inContest.has(key)) {
      return errors.push(`${tag} is the same lineup as entry ${inContest.get(key)} in the same contest (${entry.contestName}); a contest never gets the same lineup twice.`);
    }
    inContest.set(key, entryId);
    byEntry.set(entryId, resolved.ids);
    return undefined;
  });
  return { errors, warnings, byEntry };
}
