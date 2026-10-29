// The showdown Optimizer's search pool (PROJECT.md D39, D45, D81): who of a showdownBoard (showdown-multi.js) one build
// may roster, each scored by the build's objective, and the notes that say who was kept or left out and why. Moved out of
// showdown-multi.js unchanged when that file reached the ~600-line ceiling (2026-10-19). Pure: the public site runs the
// engine in the browser (D69).
import { rosterReason, scoreFor } from "./showdown.js";
import { keptSidelinedNote, noSourceProjectionNote } from "./multi.js"; // the classic Optimizer's own sentences for a man kept because he is locked
import { ceilingNotes, FIGURE_BUILDS } from "./objective.js";
import { rowIsOut } from "../rank/sidelined.js"; // pure: the public site runs this engine in the browser (D69)

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Why a candidate is not in the pool (showdown.js rosterable), in a few words for a note. */
export function outReason(c, row, objective) {
  if (rosterReason(c, row, objective) === "figure") return `he has no TwoGun ${FIGURE_BUILDS[objective]}`;
  if (!(num(c.proj) > 0) || (num(c.override?.proj) === null && (c.flags ?? []).includes("no projection"))) return "he has no projection above 0";
  return "he has no price in the salary file";
}

/** The build's own can-roster test over a showdownBoard (showdown.js rosterReason): the engine's pool, its lineup check
 *  and the lineup rules' "who can sit" (showdown-rules.js) all judge by it, here and in the request checks (D81). */
export function rosterTest(board, objective) {
  return (c) => rosterReason(c, board.rowOfPerson.get(c.personId), objective) === null;
}

/** D81: a locked (or, with `word` "Included", an included) man with no TwoGun projection in a TwoGun projection build,
 *  said alike by Generate and Build. */
export const noTwoGunProjectionNote = (name, word = "Locked") => `${word} ${name} has no TwoGun projection and counts as 0 in this build.`;

// Classic's projMissing (multi.js rowFlags): no projection, or only the board's "no projection" stand-in with no typed one.
const noOwnProjection = (row) => num(row?.proj) === null || (num(row?.override?.proj) === null && (Array.isArray(row?.flags) ? row.flags : []).includes("no projection"));

/**
 * What a man kept in the pool only because he is locked or included is told, one copy for both (Adam 2026-10-19: the
 * included man gets the locked man's sentences). `word`: "Locked" or "Included". `c`: his candidate, `row` his board
 * row, `why` his rosterReason in this build (null, "figure" or "other"). In order: D45, classic's sentence (multi.js)
 * word for word with the role word (multi.js keptSidelinedNote), a man the board lists out is kept and counts as 0; D81,
 * in a TwoGun projection build, no TwoGun projection; D81, Our sources, classic's no-projection sentence (multi.js
 * noSourceProjectionNote) by his FLEX figure; in a ceiling or median build, no TwoGun figure counts as 0, never an estimate.
 */
export function keptNotes(word, c, row, { why = null, objective = "proj", boardMode } = {}) {
  const out = [];
  const figure = Object.hasOwn(FIGURE_BUILDS, objective) ? FIGURE_BUILDS[objective] : null;
  if (rowIsOut(row)) out.push(keptSidelinedNote(c.name, row.status, word));
  if (objective === "proj" && boardMode === "twogun" && num(c.proj) === null) out.push(noTwoGunProjectionNote(c.name, word));
  if (objective === "proj" && boardMode !== "twogun" && noOwnProjection(row)) out.push(noSourceProjectionNote(c.name, num(row.proj), word));
  if (why === "figure") out.push(`${word} ${c.name} has no TwoGun ${figure} and counts as 0 in this ${figure} build.`);
  return out;
}

/** Build's note for each locked man the board lists out (`lockIds`, candidate ids; keptNotes' first sentence, the one
 *  Generate gives): Build had none. The classic optimiser already says a locked man has no projection. One note per man. */
export function lockedOutBuildNotes(board, lockIds) {
  const out = [];
  const seen = new Set();
  for (const id of lockIds ?? []) {
    const c = board.byCand.get(String(id));
    if (!c || seen.has(c.personId)) continue;
    seen.add(c.personId);
    const row = board.rowOfPerson.get(c.personId);
    if (rowIsOut(row)) out.push(keptSidelinedNote(c.name, row.status));
  }
  return out;
}

/** Build's notes for its included men (`people`, person ids) on a showdownBoard of the rows it built on: keptNotes with
 *  "Included", once per man, on the projection build Build always is. `boardMode` "twogun" or "current". */
export function includedBuildNotes(board, people, boardMode) {
  const out = [];
  for (const p of people ?? []) {
    const c = board.candidates.find((x) => x.personId === p && x.pos !== "CPT") ?? board.candidates.find((x) => x.personId === p);
    if (c) out.push(...keptNotes("Included", c, board.rowOfPerson.get(p), { objective: "proj", boardMode }));
  }
  return out;
}

/** The search pool of one build: every unexcluded candidate that may be rostered in it (showdown.js rosterReason), is
 *  locked, or is a priced row of an included man (`includeSet`, person ids; showdown-includes.js), each scored by the
 *  objective (showdown.js scoreFor). Notes as the classic ceiling build's (objective.js ceilingNotes): who was left out
 *  for want of a figure, that typed projections do not move it, and every man kept only because he is locked or included
 *  (keptNotes: once per locked row, once per included man). */
export function buildPool(board, lockSet, objective, notes, boardMode, includeSet = new Set()) {
  const word = Object.hasOwn(FIGURE_BUILDS, objective) ? FIGURE_BUILDS[objective] : null;
  const lockedPeople = new Set([...lockSet].map((id) => board.byCand.get(id).personId));
  const pool = [];
  const noFigure = new Set();
  const typed = new Set();
  const told = new Set(); // included men already given their notes
  for (const c of board.candidates) {
    if (board.excluded.has(c.id)) continue;
    const row = board.rowOfPerson.get(c.personId);
    const why = rosterReason(c, row, objective);
    const included = includeSet.has(c.personId) && num(c.salary) !== null;
    if (why !== null && !lockSet.has(c.id) && !included) {
      if (why === "figure" && !lockedPeople.has(c.personId) && !includeSet.has(c.personId)) noFigure.add(c.personId);
      continue;
    }
    if (lockSet.has(c.id)) notes.push(...keptNotes("Locked", c, row, { why, objective, boardMode }));
    else if (included && !told.has(c.personId)) {
      told.add(c.personId);
      notes.push(...keptNotes("Included", c, row, { why, objective, boardMode }));
    }
    if (word && num(row.override?.proj) !== null) typed.add(c.personId);
    pool.push({ ...c, salary: num(c.salary) ?? 0, score: scoreFor(c, row, objective) });
  }
  if (word) ceilingNotes(noFigure.size, typed.size, notes, word, new Set(pool.filter((c) => board.rowOfPerson.get(c.personId)?.override?.bump).map((c) => c.personId)).size);
  return pool;
}
