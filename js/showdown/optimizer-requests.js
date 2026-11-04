// The Showdown Optimizer's requests and the plain shapes around them (moved out of optimizer.js in round 4 to keep that file under its cap; moved, not edited, except the
// overrides PUT's refusal sentence, which now covers the star, a typed number and a note as well as the bump): the generate and overrides requests, the batch kept from an
// answer, and the saved-lineup helpers. optimizer.js re-exports every name, so every caller is unchanged.
import { newBuildId, batchBuild } from "../lineup-builds.js";
import { lineupModeOf } from "../lineup-cash.js";
import { postShowdownLineupGenerate, putShowdownOverrides, deleteShowdownOverrides } from "./api.js";
import { halfName } from "./figures-label.js";
import * as S from "./optimizer-state.js";

// ---------- the request ----------

/** POST /api/showdown/<key>/lineup/generate, through api.js (D71: the public site's stand-in answers it in the browser and ignores fetchImpl). */
export async function postShowdownGenerate(key, body, fetchImpl = fetch) {
  return postShowdownLineupGenerate(key, body, fetchImpl);
}

// The overrides requests (PUT and DELETE .../overrides) are api.js's since round 4 (item 7), so the public site's stand-in can answer them in the browser; re-exported for the callers here.
export { putShowdownOverrides, deleteShowdownOverrides };

/** The batch kept from a generate answer: the lineups in the server's order (each with a page id and its number), and what it was
 *  made with. Pure; `seqStart` numbers the page ids; `board` is the served board it was made on: its build time is the as-of of a
 *  batch whose answer names none, its reading (board.mode.cashMode) the build record's boardMode when the answer names none (as
 *  classic records it), and its short source names label the batch's source line (figures-label.js halfName). */
export function resultsFromAnswer(data, sent, seqStart = 0, board = null) {
  const lineups = (Array.isArray(data.lineups) ? data.lineups : []).map((l, i) => ({ ...l, uid: `s${seqStart + i + 1}`, index: i }));
  const notes = Array.isArray(data.notes) ? [...data.notes] : [];
  if (!lineups.length && !notes.length) notes.push("No lineups could be made from these locks and settings.");
  const cash = sent.settings.mode === "cash";
  return {
    mode: cash ? "cash" : "gpp",
    basis: cash ? data.basis ?? null : null,
    boardMode: data.boardMode === "twogun" || data.boardMode === "current" ? data.boardMode : board?.mode?.cashMode ?? null,
    objective: cash ? null : sent.settings.objective,
    projection: data.projection ?? null,
    ownership: data.ownership ?? null,
    figuresKey: typeof data.figuresKey === "string" && data.figuresKey !== "" ? data.figuresKey : null, // the served board's key, sent back with each save
    meter: data.meter ?? null,
    boardBuiltAt: board?.generatedAt ?? null,
    names: { projection: halfName(board, "projection"), ownership: halfName(board, "ownership") },
    lineups,
    notes,
    bends: Array.isArray(data.bends) ? data.bends : [],
    made: lineups.length,
    marks: S.exposureMarks(sent.settings),
    buildId: newBuildId(Date.now(), Math.random()), // one id per Make, shared by every lineup saved from it (lineup-builds.js)
  };
}

// ---------- saves ----------

/** The saved lineups of one mode as Captain-aware set keys (a card matching one shows "Saved ✓"). */
export function savedKeysOf(saved, mode, board) {
  const { personOf } = S.boardIndex(board);
  return new Set((saved ?? []).filter((l) => lineupModeOf(l) === mode).map((l) => S.sdSetKey(l.slots, personOf)));
}

/** The POST .../lineups body for one card: its name, its six men by person id (as the builder saves them, so the saved card
 *  finds every row), its mode and the build record (classic saveGenerated: lineup-builds.js batchBuild, plus the answer's
 *  figures key, so the server refuses a save after this game's sources changed; the server stamps its own projection line,
 *  so the page sends none). Pure. */
export function saveBody(lineup, results, name) {
  const slots = (lineup.slots ?? []).map((s) => ({ slot: s.slot, playerId: String(s.personId ?? s.playerId) }));
  const build = batchBuild({ buildId: results.buildId, boardMode: results.boardMode, objective: results.objective });
  if (typeof results.figuresKey === "string" && results.figuresKey !== "") build.figuresKey = results.figuresKey;
  return { name, slots, mode: results.mode, build };
}
