// The Showdown Optimizer's answer (POST /api/showdown/<key>/lineup/generate, PROJECT.md D39, D81), the one copy the app's
// route (./optimizer-routes.js) and the public site (site-src/site-showdown.js; RULES.md D71: the site does everything the
// app does) both run on a served board: the settings checks (./generate-request.js), the engine handed in (the route's
// lazily loaded ../lineup/showdown-multi.js generateShowdownLineups, the same function the site imports), the response
// shaping and the uniqueness meter on every GPP lineup (./meter-answer.js measureBatch, RULES.md D82). Pure and
// browser-safe: the saved lineups and the field curves come in through the caller's readSaved and loadCurves, nothing is
// logged here (a failure carries `log` for the caller), and tools/publish.mjs copies this file unchanged to out/server/.
import { generateBodyError, validateShowdownGenerateSettings, enrichShowdownResult } from "./generate-request.js";
import { lineupRows } from "./lineup-rows.js"; // the board path's rows (D71)
import { measureBatch, checkMeterField } from "./meter-answer.js"; // the lineup meter's maths (Adam 2026-10-18)
import { refusalSentence } from "../lineup/sd-field-dp.js";

/** A Cash answer's one note: the uniqueness meter measures GPP lineups only (Adam 2026-10-18). */
export const CASH_METER_NOTE = "The uniqueness meter is for GPP lineups; Cash lineups show projection only.";

/** The note when this showdown's week is unknown, so there is no saved-lineups file to count for minimum unique. */
export const WEEK_UNKNOWN_SAVED_NOTE = "This showdown's week is not known, so its saved lineups were not counted for minimum unique.";

/**
 * Whose wording and Cash basis a Build or Generate on `board` uses (the engine's boardMode, showdown-pool.js keptNotes and
 * cash.js cashBasis): board.mode.cashMode (Adam 2026-10-20: "twogun" while TwoGun is the only ticked projection source,
 * else "current"), "current" for a board with no mode. Pure.
 */
export function noteModeOf(board) {
  return board?.mode?.cashMode ?? "current";
}

/**
 * The checks a generate body gets before the engine or the board is touched, in the route's order: its shape
 * (generateBodyError), then the meter's field size by the meter's own check (one copy). { field } or { error } (a 400).
 */
export function generateBodyCheck(body) {
  const bodyError = generateBodyError(body);
  if (bodyError) return { error: bodyError };
  return checkMeterField(body.field);
}

/**
 * The uniqueness meter on every GPP lineup, measured as POST .../lineup/meter measures one (./meter-answer.js measureBatch)
 * on the served board the lineups were built on: { lineups, meter }. Cash shows projection only (Adam 2026-10-18), so each
 * meter is null and one note (pushed on `extraNotes`) says why. A meter that cannot measure is { failed: true, log } with
 * `reason` the plain sentence when the field curves file is missing or refused (RULES.md D82: never a fall-back to the
 * straight product) or the field model refuses the board (../lineup/sd-field-dp.js refusalSentence).
 */
function attachMeter({ board, enriched, settings, field, extraNotes, loadCurves }) {
  if (settings.mode === "cash") {
    if (enriched.lineups.length) extraNotes.push(CASH_METER_NOTE); // a cash build that made nothing has no lineups to explain
    return { lineups: enriched.lineups.map((l) => ({ ...l, meter: null })), meter: null };
  }
  const loaded = loadCurves();
  if (loaded.error) return { failed: true, reason: loaded.error, log: { message: "showdown generate: the field curves could not be loaded", extra: { error: loaded.error } } };
  try {
    const batch = measureBatch(board, enriched.lineups, { excludes: settings.excludes, field, curves: loaded.curves });
    return { lineups: enriched.lineups.map((l, i) => ({ ...l, meter: batch.results[i] })), meter: batch.meter };
  } catch (e) {
    const reason = refusalSentence(e); // a field-model refusal's plain sentence; a bug keeps the generic text
    const log = { message: "showdown generate: the uniqueness meter failed", extra: { error: e.message, stack: e.stack } };
    return reason ? { failed: true, reason, log } : { failed: true, log };
  }
}

const fail = (status, code, message, log = null) => ({ ok: false, status, code, message, ...(log ? { log } : {}) });

/**
 * The generate answer on a served board, after generateBodyCheck passed: { ok: true, result } (the 200 body before its
 * envelope) or { ok: false, status, code, message, log? }. `body`: the request ({settings, field}); `field`: generateBodyCheck's.
 * `readSaved()`: this showdown's saved lineups for minimum unique, { saved, note? } (`note`: WEEK_UNKNOWN_SAVED_NOTE when the
 * week is unknown) or { error } (the store's, a 500). `loadCurves()`: { curves } or { error }, asked only for a GPP build.
 * `generate`: the engine (../lineup/showdown-multi.js generateShowdownLineups).
 */
export function generateAnswer({ board, body, field, readSaved, loadCurves, generate }) {
  // Whose wording and Cash basis the engine reads: the board's own reading (noteModeOf).
  const boardMode = noteModeOf(board);
  // Every figure carries its source and as-of date: the answer names this game's ticked sources (board.figures), null for a
  // board without them. The figures key (board-view.js figuresKeyOf) comes back with a save, so a save after the sources
  // changed is refused (lineups-routes.js).
  const projection = board.figures?.projection ?? null;
  const ownership = board.figures?.ownership ?? null;
  const figuresKey = board.figures?.key ?? null;
  const rows = lineupRows(board);
  const checked = validateShowdownGenerateSettings(body.settings, rows);
  if (checked.error) return fail(400, "VALIDATION_ERROR", checked.error);
  // Saved lineups of this showdown count for minimum unique only; with the week unknown there is no file to read.
  const extraNotes = [];
  const savedRead = readSaved();
  if (savedRead.error) return fail(500, savedRead.error.code ?? "LINEUPS_UNREADABLE", savedRead.error.message);
  if (savedRead.note) extraNotes.push(savedRead.note);
  try {
    const result = generate({ rows, settings: checked.settings, existing: savedRead.saved, boardMode });
    // An engine crash is a 500 with its note, never a 200 with zero lineups (code review of 5500554, 2026-10-18).
    if (result.failed) {
      return fail(500, "LINEUP_GENERATE_FAILED", result.notes[result.notes.length - 1] ?? "Could not make showdown lineups.", { message: "showdown generate: the engine failed", extra: { notes: result.notes } });
    }
    // The hard rules were re-proved on every lineup inside the engine; an illegal one is never served (Adam 2026-10-18).
    if (result.problems?.length) {
      return fail(500, "SHOWDOWN_ILLEGAL_LINEUP", `Lineup ${result.problems[0].lineup} broke a showdown rule (${result.problems[0].problems.join("; ")}), so nothing was served.`,
        { message: "showdown generate: an illegal lineup was made", extra: { problems: result.problems } });
    }
    const enriched = enrichShowdownResult(result, rows);
    const metered = attachMeter({ board, enriched, settings: checked.settings, field, extraNotes, loadCurves });
    if (metered.failed) {
      const why = metered.reason ? `: ${metered.reason}` : "; the log has the detail.";
      return fail(500, "LINEUP_METER_FAILED", `The lineups were made but the uniqueness meter could not measure them, so nothing was served${why}`, metered.log);
    }
    const { lineups, meter } = metered;
    return { ok: true, result: { ...enriched, lineups, notes: [...enriched.notes, ...extraNotes], boardMode, projection, ownership, figuresKey, meter } };
  } catch (e) {
    return fail(500, "LINEUP_GENERATE_FAILED", "Could not make showdown lineups.", { message: "showdown generate: failed", extra: { error: e.message, stack: e.stack } });
  }
}
