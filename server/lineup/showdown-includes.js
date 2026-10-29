// Includes in the Showdown Optimizer (Adam 2026-10-19: "You're forcing the lineup to include some player/def/K, but not
// specifying whether at Captain or FLEX; if I'm making a cash lineup I may know I want both QBs in, but not be sure who I
// want at Captain (if either); I just know I want them somewhere in the lineup"; PROJECT.md D39). An include names a man
// by his FLEX id or his Captain id (either names the person); he is in every lineup, at Captain or FLEX, the search
// choosing his role per lineup by the objective (showdown.js exactSearch includePeople). An include never bends: it joins
// the locks, the excludes, the cap and the DraftKings rules. An include of a man who is locked is just the lock.
// One copy of the checks and sentences for the request checks (server/showdown/generate-request.js, Build's route) and
// the engine (showdown-multi.js). Pure: the public site runs the engine in the browser (D69).
import { SHOWDOWN_SLOTS } from "./showdown.js";
import { listNames } from "./soft.js";

/** At most six men can be included: a lineup has six spots. */
export const MAX_INCLUDES = SHOWDOWN_SLOTS.length;
const MAX_FLEX = SHOWDOWN_SLOTS.length - 1; // five FLEX spots beside the one Captain

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/**
 * The included men of `ids` (FLEX ids or Captain ids) on a showdownBoard (showdown-multi.js, built with the request's
 * excludes), or {error} with a plain sentence. `opts`: { locks (candidate ids), maxPerTeam (default 5), count (lineups,
 * default 1), maxOf(role "CPT" or "FLEX", person id) -> {n, pct} or null (that role's Max %, n in lineups as the engine
 * counts it) }. Returns { people } (person ids in the order given, a locked man dropped: the lock already puts him in).
 * Refused: a man not on the board; more than six; a man with no unexcluded row (included and excluded) or no price; more
 * locked and included men than six spots; more of them from one team than Max per team; a man whose Captain and FLEX
 * room together (a Max %, another man's Captain lock, an excluded or unpriced row) cannot reach every lineup; and
 * several men who between them need more Captain spots, or more FLEX spots, than the lineups have (each is judged alone
 * first, then together). A blank id is refused as an id that is not on the board.
 */
export function readIncludes(ids, board, { locks = [], maxPerTeam = 5, count = 1, maxOf = () => null } = {}) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => id !== null && id !== undefined).map((id) => String(id).trim()))];
  const unknown = list.filter((id) => !board.personOf.has(id));
  if (unknown.length) return { error: `includes names a player who is not on the board: ${unknown.join(", ")}` };
  const people = [...new Set(list.map((id) => board.personOf.get(id)))];
  if (people.length > MAX_INCLUDES) return { error: `${people.length} players are included, but a lineup has only ${MAX_INCLUDES} spots.` };
  const nameOf = (p) => board.rowOfPerson.get(p)?.name ?? p;
  const rowsOf = (p) => board.candidates.filter((c) => c.personId === p);
  const usable = (p) => rowsOf(p).filter((c) => !board.excluded.has(c.id) && num(c.salary) !== null);
  for (const p of people) {
    if (!rowsOf(p).some((c) => !board.excluded.has(c.id))) return { error: `${nameOf(p)} is both included and excluded.` };
    if (!usable(p).length) return { error: `${nameOf(p)} is included but has no price in the salary file.` };
  }
  const lockCands = (Array.isArray(locks) ? locks : []).map(String).filter((id) => board.byCand.has(id)).map((id) => board.byCand.get(id));
  const lockedPeople = new Set(lockCands.map((c) => c.personId));
  const extra = people.filter((p) => !lockedPeople.has(p));
  if (!extra.length) return { people: [] };
  const spots = lockedPeople.size + extra.length;
  if (spots > MAX_INCLUDES) return { error: `${lockedPeople.size} locked and ${extra.length} included players need ${spots} spots, but a lineup has only ${MAX_INCLUDES}.` };
  // Max per team over the locked and included men together (the locks alone were checked first, lockedTeamBreak).
  const byTeam = new Map();
  for (const p of [...lockedPeople, ...extra]) {
    const team = board.rowOfPerson.get(p)?.team;
    const t = byTeam.get(team) ?? { n: 0, locked: false };
    byTeam.set(team, { n: t.n + 1, locked: t.locked || lockedPeople.has(p) });
  }
  const over = [...byTeam].find(([, t]) => t.n > maxPerTeam);
  if (over) return { error: `${over[1].n} of the ${over[1].locked ? "locked and included" : "included"} men are from ${over[0]} but Max per team is ${maxPerTeam}.` };
  // Room: an included man fills one of his two roles in every lineup, so his Captain and FLEX room must reach the count.
  const lockedCaptain = lockCands.find((c) => c.pos === "CPT") ?? null;
  const roomOf = new Map(); // person -> { CPT, FLEX }: the lineups each of his two roles can take
  for (const p of extra) {
    const mine = usable(p);
    const reasons = [];
    const rooms = { CPT: 0, FLEX: 0 };
    for (const role of ["CPT", "FLEX"]) {
      const word = role === "CPT" ? "Captain" : "FLEX";
      const cand = mine.find((c) => (c.pos === "CPT") === (role === "CPT"));
      if (role === "CPT" && lockedCaptain) {
        reasons.push(`${lockedCaptain.name} is locked as Captain`);
        continue;
      }
      if (!cand) {
        // A row of this role that exists but was excluded by its id is said so; no row at all (or no price) is "no spot".
        const excludedRow = rowsOf(p).some((c) => (c.pos === "CPT") === (role === "CPT") && board.excluded.has(c.id));
        reasons.push(excludedRow ? `his ${word} row is excluded` : `he has no ${word} spot`);
        continue;
      }
      const max = maxOf(role, p);
      if (max && max.n < count) reasons.push(`his ${word} Max % (${max.pct}) allows ${max.n}`);
      rooms[role] = max ? Math.min(max.n, count) : count;
    }
    const room = rooms.CPT + rooms.FLEX;
    if (room < count) {
      return { error: `Included ${nameOf(p)} must be in ${count === 1 ? "the lineup" : `all ${count} lineups`}, but he fits in ${room === 0 ? "none" : `only ${room}`}: ${listNames(reasons)}.` };
    }
    roomOf.set(p, rooms);
  }
  // Together: each man is in every lineup in exactly one role, so he needs at least count less his room in the other role
  // here; those needs, summed over the men, must fit the spots the lineups have in that role. A locked Captain takes every
  // Captain spot; the locked FLEX take theirs in every lineup.
  const lockedFlexN = lockCands.filter((c) => c.pos !== "CPT").length;
  const together = [
    { word: "Captain", room: "FLEX", otherWord: "FLEX", spots: lockedCaptain ? 0 : count, note: lockedCaptain ? ` (${lockedCaptain.name} is locked as Captain)` : "" },
    { word: "FLEX", room: "CPT", otherWord: "Captain", spots: (MAX_FLEX - lockedFlexN) * count, note: lockedFlexN ? " (the locked FLEX take the rest)" : "" }
  ];
  // `room` is the role whose room a man falls short in; the spots he then needs are in the other, named `word`.
  for (const { word, room, otherWord, spots, note } of together) {
    const needs = extra.map((p) => ({ p, n: Math.max(0, count - roomOf.get(p)[room]) })).filter((x) => x.n > 0);
    const total = needs.reduce((a, x) => a + x.n, 0);
    if (total > spots) {
      return { error: `Included ${listNames(needs.map((x) => nameOf(x.p)))} must each be in ${count === 1 ? "the lineup" : `all ${count} lineups`}, but their ${otherWord} room is short, so between them they need ${total} ${word} spots and ${count === 1 ? "the lineup has" : `${count} lineups have`} only ${spots}${note}.` };
    }
  }
  return { people: extra };
}

/** A build's can-roster test with the included men (`people`, a Set of person ids) let in at any priced row: an
 *  included man is kept because he is included, as a locked man is (the lineup rules' "who can sit", showdown-rules.js). */
export function withIncludes(canRoster, people) {
  if (!people || !people.size) return canRoster;
  return (c) => (people.has(c.personId) && num(c.salary) !== null) || canRoster(c);
}

/** One man's candidate id in a role on a showdownBoard ("CPT": his Captain id; "FLEX": his row id), or null when he has
 *  no row, or no Captain id for "CPT". */
function roleCandId(board, role, person) {
  const row = board.rowOfPerson.get(person);
  if (!row) return null;
  return role === "CPT" ? (row.cptId !== null && row.cptId !== undefined && String(row.cptId) !== "" ? String(row.cptId) : null) : String(row.id);
}

/** readIncludes' maxOf over the engine's Max % map (showdown-multi.js, candidate id -> {n, pct}): a role's {n, pct} for
 *  one man, or null when he has none. */
export const roleMax = (board, maxes) => (role, person) => {
  const id = roleCandId(board, role, person);
  return (id !== null && maxes.get(id)) || null;
};

/**
 * The engine's look-ahead for the included men (code review of 7bafd38). The engine makes one lineup at a time, so
 * before each one it recounts each included man's Captain and FLEX room over the `left` lineups still to make (his
 * Max % in lineups, less this batch's lineups so far; none for a row outside the pool). A man needs the Captain in at
 * least `left` less his FLEX room of them; when those needs add up to every Captain spot left, this lineup's Captain
 * must be one of the men who need it, so every other Captain row is left out of its solve. Without this a lineup could
 * spend the Captain spot, or an included man's FLEX cap, that a later lineup needed, and a Max % that need not bend
 * would bend. A man whose FLEX need is every lineup left has no Captain room, and the Max % already takes his Captain
 * row out of the search (showdown-multi.js capped), so he needs nothing here. `people`: the included person ids;
 * `pool`/`poolIds`: the build's search pool; `maxes`: candidate id -> {n}; `counts`: candidate id -> lineups so far.
 * Returns the Captain candidate ids to leave out: empty with no includes, a Captain locked, or nothing pressing. Pure.
 */
export function captainSteer({ people, board, pool, poolIds, maxes, counts, left, captainLocked }) {
  if (!people.size || captainLocked) return new Set();
  const room = (role, p) => {
    const id = roleCandId(board, role, p);
    if (id === null || !poolIds.has(id) || (board.byCand.get(id)?.pos === "CPT") !== (role === "CPT")) return 0;
    const max = maxes.get(id);
    return max ? Math.max(0, Math.min(left, max.n - (counts.get(id) ?? 0))) : left;
  };
  const needy = [...people].filter((p) => room("FLEX", p) < left);
  if (needy.reduce((a, p) => a + left - room("FLEX", p), 0) < left) return new Set();
  return new Set(pool.filter((c) => c.pos === "CPT" && !needy.includes(c.personId)).map((c) => c.id));
}

/** The words a steered bend's label gains, so a bend made for the look-ahead reads apart from a plain one. */
export const STEERED_BEND_WORDS = "to keep the included men's Captain spots for later lineups";

/** One lineup's solve with the look-ahead (captainSteer) and the bends: the steered solve, then every bend steered, then
 *  the plain solve, then every bend plain, so the look-ahead is given up only after its own bends fail. A steered bend may
 *  bend this lineup so that a later lineup need not bend or fail; its label says so (STEERED_BEND_WORDS). The steered pass
 *  only ever ends with a lineup: a steered solve or bend that stops at a step limit, or finds nothing, falls through to the
 *  plain pass (with the budget gone, the plain solve stops at once and the step-limit note follows). With no steer: the
 *  plain solve, then its bends. `solve`: the engine's solve({forced, steer}); `bend(steer)`: the engine's bends
 *  (BEND_ORDER) under that steer, {result, bent, dropped} when one let a lineup through or the search stopped, else null.
 *  Returns {result, bent, dropped}; result.best is null when nothing was found. */
export function solveSteered(solve, forced, steer, bend = () => null) {
  let last = null;
  for (const st of steer.size ? [steer, new Set()] : [new Set()]) {
    const steered = st.size > 0;
    last = solve({ forced, steer: st });
    if (last.best || (last.aborted && !steered)) return { result: last, bent: null, dropped: [] };
    if (last.aborted) continue; // a steered solve that stopped at its step limit: the plain pass, as before the steered bends
    const bentResult = bend(st);
    if (bentResult && !steered) return bentResult;
    if (bentResult?.result?.best) return { ...bentResult, bent: `${bentResult.bent} ${STEERED_BEND_WORDS}` };
  }
  return { result: last, bent: null, dropped: [] };
}

// The sentence when no lineup can hold every included man lives beside Build's search (showdown.js), which cannot import
// this file without a cycle; the engine takes it from here.
export { noIncludeFitSentence } from "./showdown.js";
