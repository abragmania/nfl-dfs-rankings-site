// Showdown lineup builder (PROJECT.md D39): one Captain (1.5x points at the Captain price) plus five FLEX of any
// position including K and DST, $50,000. A thin wrapper around the classic optimiser (server/lineup/optimize.js),
// which is used unchanged:
//   - every person on the showdown board becomes two candidates: a Captain (position "CPT", 1.5x projection,
//     Captain price, Captain ownership) and a FLEX (real position, FLEX price, FLEX ownership). Both carry the person's id as their DraftKings key, so the optimiser never rosters one man twice;
//   - slots are CPT plus FLEX x5, FLEX accepts QB/RB/WR/TE/K/DST;
//   - at most five from one team, so both teams appear (DraftKings requires it).
// Locks and excludes use candidate ids: a person's FLEX id (row.id) means his FLEX candidate for a lock, and a
// Captain id (row.cptId) means his Captain candidate. Excluding a FLEX id (row.id) removes the person entirely;
// excluding a Captain id removes only his Captain candidate. Rows flagged "no projection" are never auto-rostered
// (the classic optimiser's own rule, kept because the candidates carry the row's flags and override).
// The lineups maximise projection: the "lev" and "projMinusOwn" objectives are retired (Adam 2026-10-15, Lev
// measure to be redesigned; projection minus ownership removed), and a request naming one is built on projection
// with the classic optimiser's note (optimize.js retiredObjectiveNote).
import { optimizeLineup, retiredObjectiveNote } from "./optimize.js";
import { rowIsSidelined } from "../rank/sidelined.js"; // pure: the public site runs this in a browser (D71)

export const SHOWDOWN_SLOTS = Object.freeze(["CPT", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX"]);
export const SHOWDOWN_FLEX = Object.freeze(["QB", "RB", "WR", "TE", "K", "DST"]);
export const SHOWDOWN_MAX_FROM_TEAM = 5;
export const CPT_MULTIPLIER = 1.5;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const hasId = (v) => v !== null && v !== undefined && String(v) !== "";

function idList(value) {
  if (value === null || value === undefined) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((x) => (x && typeof x === "object" ? x.id : x)).filter(hasId).map(String);
}

/**
 * The two candidate rows for one showdown board row. Exported for the tests.
 * Captain: id = cptId, pos "CPT", proj x1.5, salary = cptSalary (read from the CSV, never computed), own = ownCpt.
 * FLEX: id = row id, real position, salary, own = ownFlex. Both: dkId = person id.
 * A Captain row with no FLEX partner (its id is its own Captain id) or a row with no FLEX price has no FLEX
 * candidate at all: there is nothing DraftKings would let him be rostered as in a FLEX slot.
 */
export function showdownCandidates(row) {
  const out = [];
  const person = String(row.id);
  const proj = num(row.proj);
  const overrideProj = num(row.override?.proj);
  const common = {
    dkId: person,
    name: row.name,
    team: row.team,
    opp: row.opp ?? null,
    status: row.status ?? null,
    flags: Array.isArray(row.flags) ? row.flags : []
  };
  if (hasId(row.cptId)) {
    out.push({
      ...common,
      id: String(row.cptId),
      pos: "CPT",
      rosterPositions: ["CPT"],
      salary: num(row.cptSalary),
      proj: proj === null ? null : proj * CPT_MULTIPLIER,
      own: num(row.ownCpt),
      override: { proj: overrideProj === null ? null : overrideProj * CPT_MULTIPLIER },
      personId: person,
      realPos: row.pos
    });
  }
  const hasFlex = num(row.salary) !== null && !(hasId(row.cptId) && String(row.cptId) === person);
  if (!hasFlex) return out;
  out.push({
    ...common,
    id: person,
    pos: row.pos,
    rosterPositions: [row.pos],
    salary: num(row.salary),
    proj,
    own: num(row.ownFlex),
    override: { proj: overrideProj },
    personId: person,
    realPos: row.pos
  });
  return out;
}

/** The classic optimiser's objective score for one candidate (server/lineup/optimize.js scoreOf): his projection,
 *  used only to compare the per-Captain results with each other. */
function scoreOf(c) {
  return num(c.proj) ?? 0;
}

/** Would the classic optimiser auto-roster this candidate? (Its own filter, repeated because a Captain is locked
 *  in below, and a locked candidate skips that filter.) */
function rosterable(c) {
  const overridden = num(c.override?.proj) !== null;
  if (num(c.proj) === null) return false;
  if (!overridden && c.flags.includes("no projection")) return false;
  if (rowIsSidelined(c)) return false;
  if (num(c.salary) === null) return false;
  return true;
}

/**
 * The best Captain plus five FLEX by exhaustive branch-and-bound. `pool` holds only candidates that may be rostered
 * (not excluded; rosterable or locked), each with a numeric `score`. Captains are tried best first; for each, the
 * FLEX candidates are taken in score order and a branch is cut when even the best remaining scores cannot beat the
 * best lineup found so far, or when the salary is already over the cap. Returns the six candidates (Captain first)
 * or null when no legal lineup exists. `floor` is a score already achieved (the classic run's), used to prune.
 */
function exactSearch(pool, { lockIds, cap, maxFromTeam, floor }) {
  const locks = new Set(lockIds);
  // Every lock must be rosterable, and at most one of them can be the Captain.
  if (![...locks].every((id) => pool.some((c) => c.id === id))) return null;
  if (pool.filter((c) => c.pos === "CPT" && locks.has(c.id)).length > 1) return null;
  const lockedCaptain = pool.find((c) => c.pos === "CPT" && locks.has(c.id)) ?? null;
  const lockedFlex = pool.filter((c) => c.pos !== "CPT" && locks.has(c.id));
  const lockedPeople = new Set(lockedFlex.map((c) => c.personId));
  const byScore = (a, b) => b.score - a.score || a.salary - b.salary || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const captains = (lockedCaptain ? [lockedCaptain] : pool.filter((c) => c.pos === "CPT" && !lockedPeople.has(c.personId))).sort(byScore);
  const flexAll = pool.filter((c) => c.pos !== "CPT" && !locks.has(c.id)).sort(byScore);
  const need = 5 - lockedFlex.length;
  if (need < 0) return null;

  let best = null;
  let bestScore = Number.isFinite(floor) ? floor - 1e-9 : -Infinity;
  for (const capt of captains) {
    if (lockedFlex.some((c) => c.personId === capt.personId)) continue;
    const baseSalary = capt.salary + lockedFlex.reduce((a, c) => a + c.salary, 0);
    if (baseSalary > cap) continue;
    const baseScore = capt.score + lockedFlex.reduce((a, c) => a + c.score, 0);
    const teams = new Map();
    for (const c of [capt, ...lockedFlex]) teams.set(c.team, (teams.get(c.team) ?? 0) + 1);
    if ([...teams.values()].some((n) => n > maxFromTeam)) continue;
    const flex = flexAll.filter((c) => c.personId !== capt.personId);
    if (flex.length < need) continue;
    // Upper bound for this Captain: the best `need` remaining scores.
    const top = flex.slice(0, need).reduce((a, c) => a + c.score, 0);
    if (baseScore + top <= bestScore + 1e-9) continue;

    const pick = [];
    const dfs = (start, score, salary) => {
      const left = need - pick.length;
      if (left === 0) {
        if (score > bestScore + 1e-9) {
          bestScore = score;
          best = [capt, ...lockedFlex, ...pick];
        }
        return;
      }
      for (let i = start; i <= flex.length - left; i++) {
        // Scores fall with i, so the best this branch can reach is this candidate plus the next left-1.
        let bound = score;
        for (let j = i; j < i + left; j++) bound += flex[j].score;
        if (bound <= bestScore + 1e-9) return;
        const c = flex[i];
        if (salary + c.salary > cap) continue;
        const n = teams.get(c.team) ?? 0;
        if (n >= maxFromTeam) continue;
        teams.set(c.team, n + 1);
        pick.push(c);
        dfs(i + 1, score + c.score, salary + c.salary);
        pick.pop();
        teams.set(c.team, n);
      }
    };
    dfs(0, baseScore, baseSalary);
  }
  return best;
}

/**
 * Builds the best showdown lineup. Returns the classic optimiser's shape ({ lineup, salaryUsed, salaryLeft,
 * totalProj, totalOwn, feasible, message, notes }) with each lineup entry also carrying personId and realPos, plus
 * `captain` (the Captain entry, or null when infeasible). salaryUsed is the Captain price plus the five FLEX prices.
 *
 * The classic optimiser (unchanged) runs first: it validates the request (unknown objective, clashing or missing
 * locks, a locked player with no price) and gives a good lineup. Its greedy-plus-swaps search is not exact, though,
 * and it cannot move a man from FLEX to Captain, so an exact branch-and-bound over every Captain and every five FLEX
 * (exactSearch above) then finds the provably best lineup. That lineup is handed back to the classic optimiser with
 * all six locked, so the result is checked for legality and presented exactly as classic presents a lineup.
 */
export function optimizeShowdown(rows, { objective = "proj", locks, excludes, cap = 50000 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const excludeIds = new Set(idList(excludes));
  const lockIds = idList(locks);
  // Excluding a person's FLEX id excludes the person: his Captain candidate goes too.
  const personExcluded = new Set(list.filter((r) => excludeIds.has(String(r.id))).map((r) => String(r.id)));
  const candidates = [];
  const byCandId = new Map();
  for (const row of list) {
    if (!row || !hasId(row.id)) continue;
    for (const c of showdownCandidates(row)) {
      candidates.push(c);
      byCandId.set(c.id, c);
    }
  }
  const allExcludes = [...excludeIds];
  for (const c of candidates) if (personExcluded.has(c.personId) && !allExcludes.includes(c.id)) allExcludes.push(c.id);
  const excluded = new Set(allExcludes);

  // The asked objective goes to the classic optimiser as asked, so a retired one gets its note there and is built
  // on projection.
  const options = {
    excludes: allExcludes,
    objective,
    cap,
    slots: [...SHOWDOWN_SLOTS],
    flexPositions: [...SHOWDOWN_FLEX],
    maxFromTeam: SHOWDOWN_MAX_FROM_TEAM,
    stackQbWith: 0
  };

  const plain = optimizeLineup(candidates, { ...options, locks: lockIds });
  let result = plain;
  // A request the classic optimiser refused outright (bad objective, clashing or unknown locks, a lock with no price)
  // stays refused; the exact search runs only on a request it could make sense of.
  const knownObjective = objective === "proj" || retiredObjectiveNote(objective) !== null;
  const validRequest = plain.feasible || (typeof objective === "string" && knownObjective
    && lockIds.every((id) => byCandId.has(id) && !excluded.has(id) && num(byCandId.get(id).salary) !== null)
    && Number.isFinite(cap) && cap > 0);
  if (validRequest) {
    const locked = new Set(lockIds);
    const pool = candidates
      .filter((c) => !excluded.has(c.id) && (locked.has(c.id) || rosterable(c)))
      .map((c) => ({ ...c, salary: num(c.salary) ?? 0, score: scoreOf(c) }));
    const plainScore = plain.feasible ? plain.lineup.reduce((a, e) => a + scoreOf(byCandId.get(String(e.id))), 0) : -Infinity;
    const best = exactSearch(pool, { lockIds, cap, maxFromTeam: SHOWDOWN_MAX_FROM_TEAM, floor: plainScore });
    if (best) {
      const exact = optimizeLineup(candidates, { ...options, locks: best.map((c) => c.id) });
      if (exact.feasible) result = { ...exact, notes: plain.feasible ? plain.notes : exact.notes };
    }
  }

  const lineup = (result.lineup ?? []).map((entry) => {
    const c = byCandId.get(String(entry.id));
    return { ...entry, personId: c?.personId ?? String(entry.id), realPos: c?.realPos ?? entry.pos };
  });
  return { ...result, lineup, captain: lineup.find((e) => e.slot === "CPT") ?? null, salaryUsed: result.salaryUsed };
}
