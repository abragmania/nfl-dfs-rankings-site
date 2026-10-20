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
// (the classic optimiser's own rule, kept because the candidates carry the row's flags and override), nor is a
// projection of 0 or less; injury status never filters (rosterable below).
// The lineups maximise projection: the "lev" and "projMinusOwn" objectives are retired (Adam 2026-10-15, Lev
// measure to be redesigned; projection minus ownership removed), and a request naming one is built on projection
// with the classic optimiser's note (optimize.js retiredObjectiveNote).
import { optimizeLineup, retiredObjectiveNote, failure } from "./optimize.js";
import { objectiveScore, figureOf, FIGURE_BUILDS } from "./objective.js"; // pure; the classic Optimizer's ceiling and median scoring
import { rowIsOut } from "../rank/sidelined.js"; // pure
import { listNames } from "./soft.js"; // pure; "A, B and C"

export const SHOWDOWN_SLOTS = Object.freeze(["CPT", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX"]);
export const SHOWDOWN_FLEX = Object.freeze(["QB", "RB", "WR", "TE", "K", "DST"]);
export const SHOWDOWN_MAX_FROM_TEAM = 5;
export const CPT_MULTIPLIER = 1.5;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const hasId = (v) => v !== null && v !== undefined && String(v) !== "";

/** The sentence when no lineup can hold every included man (`names`; Adam 2026-10-19, showdown-includes.js), without its
 *  capital or full stop: the Optimizer's engine (showdown-multi.js) and Build (optimizeShowdown below) say it alike. */
export function noIncludeFitSentence(names, cap, { rules = false } = {}) {
  return `no lineup holds every included man (${listNames(names)}) under the locks, the excludes, Max per team, the $${cap.toLocaleString("en-US")} cap and the DraftKings rules${rules ? " and the lineup rules" : ""}`;
}

/** An includes-failure answer: the optimiser's infeasible shape with its totals missing, never 0 (D29; the same as Build's
 *  no-rows answer in server/showdown/optimizer-routes.js). */
const noTotals = (failed) => ({ ...failed, totalProj: null, totalOwn: null });

/** The included people (`included`, a Set of person ids) no entry of `lineup` carries: empty when the lineup holds them all.
 *  optimizeShowdown checks it before serving a lineup built with includes. Pure. */
export function includedMissing(lineup, included) {
  const seated = new Set((lineup ?? []).map((e) => e.personId));
  return [...(included ?? [])].filter((p) => !seated.has(p));
}

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
  const revive = row.override?.revive === true;
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
      override: { proj: overrideProj === null ? null : overrideProj * CPT_MULTIPLIER, revive },
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
    override: { proj: overrideProj, revive },
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

/** May the showdown search auto-roster this candidate? A projection above 0, not flagged "no projection" unless a
 *  typed projection overrides it, and a price. One copy: showdown-multi.js imports it.
 *  Adam 2026-10-18 and D45: status never filters; a projection of 0 or less, or none, is never auto-rostered (the
 *  board sets an Out, Doubtful or IR man's projection to 0 until Adam types one above 0). A lock still puts him in. */
export function rosterable(c) {
  const overridden = num(c.override?.proj) !== null;
  if (!(num(c.proj) > 0)) return false;
  if (!overridden && (c.flags ?? []).includes("no projection")) return false;
  if (num(c.salary) === null) return false;
  return true;
}

/** The score one candidate adds in a build (the classic objectiveScore, objective.js): his projection, or for "ceil" or
 *  "median" the TwoGun figure on his board `row`, the Captain's at 1.5x of whichever (D39). A figure build counts a
 *  locked man with no figure as 0, never an estimate (classic's rule). "proj" is scoreOf, so its output is unchanged. */
export function scoreFor(c, row, objective = "proj") {
  if (!Object.hasOwn(FIGURE_BUILDS, objective)) return scoreOf(c);
  return objectiveScore(row, 0, objective) * (c.pos === "CPT" ? CPT_MULTIPLIER : 1);
}

/** Why the search may not auto-roster this candidate in this build: null when it may, "figure" when only his missing
 *  TwoGun ceiling or median keeps him out (classic counts these in its note), else "other". "proj" is rosterable().
 *  Ceiling: rosterable() and a ceiling; median: priced, not out, a median, whatever his projection (classic
 *  rowFlags: medianOf alone decides); a revived man whom TwoGun calls OUT stays out of either (classic revivedOut). */
export function rosterReason(c, row, objective = "proj") {
  if (!Object.hasOwn(FIGURE_BUILDS, objective)) return rosterable(c) ? null : "other";
  if (num(c.salary) === null || (objective === "ceil" ? !rosterable(c) : rowIsOut(row))) return "other";
  if (figureOf(row, objective) === null) return "figure";
  return (c.flags ?? []).includes("revived") && row?.tg?.call === "OUT" ? "other" : null;
}

/** cheapest[i][k] for k = 0..5: the sum of the k lowest salaries among flex[i..] (Infinity when fewer than k are
 *  left), the least k more men can cost. One backward pass keeping the five lowest seen, O(5n). */
export function cheapestTable(flex) {
  const cheapest = new Array(flex.length + 1);
  cheapest[flex.length] = [0, ...Array(5).fill(Infinity)];
  const low = []; // the five lowest salaries among flex[i..], ascending
  for (let i = flex.length - 1; i >= 0; i--) {
    const s = flex[i].salary;
    if (low.length < 5) low.push(s);
    else if (s < low[4]) low[4] = s;
    for (let j = low.length - 1; j > 0 && low[j] < low[j - 1]; j--) [low[j], low[j - 1]] = [low[j - 1], low[j]];
    const row = [0];
    for (let k = 0; k < 5; k++) row.push(k < low.length ? row[k] + low[k] : Infinity);
    cheapest[i] = row;
  }
  return cheapest;
}

/**
 * The best Captain plus five FLEX by exhaustive branch-and-bound. `pool` holds only candidates that may be rostered
 * (not excluded; rosterable or locked), each with a numeric `score`. Captains are tried best first; for each, the
 * FLEX candidates are taken in score order and a branch is cut when even the best remaining scores cannot beat the
 * best lineup found so far, or when the salary is already over the cap. Returns the six candidates (Captain first)
 * or null when no legal lineup exists. `floor` is a score already achieved (the classic run's), used to prune.
 * Optional, for the showdown Optimizer (server/lineup/showdown-multi.js, Adam 2026-10-18); left out, the search and its
 * result are exactly what optimizeShowdown always had:
 *   overlap  { priors: Set<string>[], max, keyOf(candidate) } - a lineup may share at most `max` keys with each prior;
 *   maxSteps a step budget (one step per search node); stats, when given, gets { steps, aborted }. When the budget runs
 *            out the best lineup found so far is returned (or null), and stats.aborted says it was not proven best;
 *   ruleGate (capt, lockedFlex, flex) -> {open(start, left), leaf(), add(c), remove(c)}: hard lineup rules (D81,
 *            showdown-rules.js searchGate), cutting every branch that breaks one or can no longer meet one.
 *   includePeople  Set of person ids every lineup must hold at Captain or FLEX (Adam 2026-10-19, showdown-includes.js):
 *            under each Captain, every included man who is not that Captain is held as a FLEX, so the role each one
 *            gets is the one the best lineup gives him. Empty or absent, the search is exactly as before.
 * Forced men are `lockIds`. A branch whose cheapest possible completion already breaks the cap is cut (sound, so the
 * lineup found never changes).
 */
export function exactSearch(pool, { lockIds, cap, maxFromTeam, floor, overlap = null, maxSteps = Infinity, stats = null, ruleGate = null, includePeople = null }) {
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

  // Prior-lineup overlap (minimum unique): per key, the priors holding it; over[i] counts what the lineup in hand
  // shares with prior i, and `violations` how many priors it shares more than `max` with.
  const priorsWith = new Map();
  const over = overlap ? new Int32Array(overlap.priors.length) : null;
  let violations = 0;
  if (overlap) {
    overlap.priors.forEach((keys, i) => {
      for (const k of keys) priorsWith.set(k, [...(priorsWith.get(k) ?? []), i]);
    });
  }
  const shift = (c, d) => {
    if (!overlap) return;
    for (const i of priorsWith.get(overlap.keyOf(c)) ?? []) {
      const before = over[i];
      over[i] += d;
      if (d > 0 && before === overlap.max) violations++;
      if (d < 0 && before === overlap.max + 1) violations--;
    }
  };

  let best = null;
  let bestScore = Number.isFinite(floor) ? floor - 1e-9 : -Infinity;
  let steps = 0;
  let aborted = false;
  // Includes: each included man's FLEX candidate in the pool (a man with none can only be the Captain).
  const included = includePeople && includePeople.size ? includePeople : null;
  const flexOf = new Map();
  if (included) for (const c of pool) if (c.pos !== "CPT" && included.has(c.personId) && !flexOf.has(c.personId)) flexOf.set(c.personId, c);
  for (const c of lockedFlex) shift(c, 1);
  for (const capt of captains) {
    if (aborted) break;
    if (lockedFlex.some((c) => c.personId === capt.personId)) continue;
    // The FLEX this Captain's lineups must hold: the locked FLEX, plus every included man who is not this Captain and
    // not already locked (his FLEX candidate is held for this Captain only). With no includes these are the locked FLEX.
    let held = lockedFlex;
    let flexOpen = flexAll;
    if (included) {
      const owed = [...included].filter((p) => p !== capt.personId && !lockedPeople.has(p));
      const men = owed.map((p) => flexOf.get(p));
      if (men.some((c) => !c)) continue;
      held = [...lockedFlex, ...men.sort(byScore)];
      const owedSet = new Set(owed);
      flexOpen = flexAll.filter((c) => !owedSet.has(c.personId));
    }
    const needHere = 5 - held.length;
    if (needHere < 0) continue;
    const baseSalary = capt.salary + held.reduce((a, c) => a + c.salary, 0);
    if (baseSalary > cap) continue;
    const baseScore = capt.score + held.reduce((a, c) => a + c.score, 0);
    const teams = new Map();
    for (const c of [capt, ...held]) teams.set(c.team, (teams.get(c.team) ?? 0) + 1);
    if ([...teams.values()].some((n) => n > maxFromTeam)) continue;
    const flex = flexOpen.filter((c) => c.personId !== capt.personId);
    if (flex.length < needHere) continue;
    // Upper bound for this Captain: the best `needHere` remaining scores.
    const top = flex.slice(0, needHere).reduce((a, c) => a + c.score, 0);
    if (baseScore + top <= bestScore + 1e-9) continue;
    const cheapest = cheapestTable(flex);
    if (baseSalary + cheapest[0][needHere] > cap) continue;
    const gate = ruleGate ? ruleGate(capt, held, flex) : null;

    const heldExtra = held.slice(lockedFlex.length); // the included men held for this Captain (none without includes)
    for (const c of heldExtra) shift(c, 1);
    shift(capt, 1);
    const pick = [];
    const dfs = (start, score, salary) => {
      if (aborted) return;
      if (++steps > maxSteps) {
        aborted = true;
        return;
      }
      const left = needHere - pick.length;
      if (gate && !gate.open(start, left)) return;
      if (left === 0) {
        if (violations === 0 && score > bestScore + 1e-9 && (!gate || gate.leaf())) {
          bestScore = score;
          best = [capt, ...held, ...pick];
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
        if (salary + c.salary + cheapest[i + 1][left - 1] > cap) continue;
        const n = teams.get(c.team) ?? 0;
        if (n >= maxFromTeam) continue;
        teams.set(c.team, n + 1);
        pick.push(c);
        shift(c, 1);
        gate?.add(c);
        if (violations === 0) dfs(i + 1, score + c.score, salary + c.salary);
        gate?.remove(c);
        shift(c, -1);
        pick.pop();
        teams.set(c.team, n);
        if (aborted) return;
      }
    };
    if (violations === 0) dfs(0, baseScore, baseSalary);
    shift(capt, -1);
    for (const c of heldExtra) shift(c, -1);
  }
  if (stats) {
    stats.steps = steps;
    stats.aborted = aborted;
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
export function optimizeShowdown(rows, { objective = "proj", locks, excludes, cap = 50000, maxPerTeam: maxPerTeamGiven, includes } = {}) {
  const maxPerTeam = maxPerTeamGiven ?? SHOWDOWN_MAX_FROM_TEAM; // null (not only undefined) means DraftKings' five
  const list = Array.isArray(rows) ? rows : [];
  const excludeIds = new Set(idList(excludes));
  const lockIds = idList(locks);
  const includeIds = idList(includes);
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
  const lockSet = new Set(lockIds);
  // Includes (Adam 2026-10-19; the route refuses a bad set first with showdown-includes.js readIncludes): the persons
  // named by FLEX or Captain id, a locked man dropped (the lock already puts him in). An id not on the board builds nothing.
  const included = new Set();
  const namesOf = (people) => [...people].map((p) => list.find((r) => r && String(r.id) === p)?.name ?? p);
  if (includeIds.length) {
    const personOf = new Map();
    for (const row of list) {
      if (!row || !hasId(row.id)) continue;
      personOf.set(String(row.id), String(row.id));
      if (hasId(row.cptId)) personOf.set(String(row.cptId), String(row.id));
    }
    const offBoard = includeIds.filter((id) => !personOf.has(id));
    if (offBoard.length) return { ...noTotals(failure(`includes names a player who is not on the board: ${offBoard.join(", ")}`, cap)), captain: null };
    const lockedPersons = new Set(lockIds.map((id) => byCandId.get(id)?.personId).filter(hasId));
    for (const id of includeIds) if (!lockedPersons.has(personOf.get(id))) included.add(personOf.get(id));
  }
  // The classic run must not auto-roster a man the exact search refuses (rosterable: a projection of 0 or less, Adam
  // 2026-10-18 and D45), or its lineup would stand whenever the exact search cannot beat it. Unlocked only, so no
  // lock is ever also an exclude; these are left out of `excluded`, which holds Adam's own excludes. An included man
  // is not among them, so the classic check of the exact lineup below may hold him.
  const classicExcludes = [...allExcludes];
  for (const c of candidates) if (!lockSet.has(c.id) && !rosterable(c) && !excluded.has(c.id) && !included.has(c.personId)) classicExcludes.push(c.id);

  // The asked objective goes to the classic optimiser as asked, so a retired one gets its note there and is built
  // on projection.
  const options = {
    excludes: classicExcludes,
    objective,
    cap,
    slots: [...SHOWDOWN_SLOTS],
    flexPositions: [...SHOWDOWN_FLEX],
    maxFromTeam: maxPerTeam,
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
    // An included man's priced rows are in the pool whatever his projection, as a lock is (Adam 2026-10-19).
    const pool = candidates
      .filter((c) => !excluded.has(c.id) && (locked.has(c.id) || rosterable(c) || (included.has(c.personId) && num(c.salary) !== null)))
      .map((c) => ({ ...c, salary: num(c.salary) ?? 0, score: scoreOf(c) }));
    // The classic run knows no includes, so its score is no floor when there are any.
    const plainScore = plain.feasible && !included.size ? plain.lineup.reduce((a, e) => a + scoreOf(byCandId.get(String(e.id))), 0) : -Infinity;
    const best = exactSearch(pool, { lockIds, cap, maxFromTeam: maxPerTeam, floor: plainScore, includePeople: included.size ? included : null });
    if (best) {
      const exact = optimizeLineup(candidates, { ...options, locks: best.map((c) => c.id) });
      // With includes the exact run locks all six, so its notes would call the included men locked: the classic run's stand.
      if (exact.feasible) result = { ...exact, notes: plain.feasible ? plain.notes : included.size ? plain.notes ?? [] : exact.notes };
    }
    // The classic lineup never stands in for one that holds the includes: none was found, so none is built.
    if (included.size && result === plain) {
      const sentence = noIncludeFitSentence(namesOf(included), cap);
      result = noTotals(failure(`${sentence[0].toUpperCase()}${sentence.slice(1)}.`, cap));
    }
  }

  const lineup = (result.lineup ?? []).map((entry) => {
    const c = byCandId.get(String(entry.id));
    return { ...entry, personId: c?.personId ?? String(entry.id), realPos: c?.realPos ?? entry.pos };
  });
  // A lineup built with includes is served only if it holds every included man; a failure with a sentence, never a throw.
  if (included.size && result.feasible) {
    const missing = includedMissing(lineup, included);
    if (missing.length) {
      const sentence = `Could not build a lineup that holds ${listNames(namesOf(missing))}, who ${missing.length > 1 ? "are" : "is"} included, so no lineup was made.`;
      return { ...noTotals(failure(sentence, cap)), captain: null };
    }
  }
  return { ...result, lineup, captain: lineup.find((e) => e.slot === "CPT") ?? null, salaryUsed: result.salaryUsed };
}
