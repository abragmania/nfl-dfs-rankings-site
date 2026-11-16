// The Optimizer engine's bends, quarterback pre-checks and the reasons a lineup could not be made (split from multi.js under R87, moved not edited).
import { rowIsOut } from "../rank/sidelined.js"; // pure: the public site runs this engine in the browser (D69)
import { stackTrials, setsTeammates, setsOpponents } from "./qb-stacks.js"; // pure; per-QB stack settings
import {
  listNames, lowestScoreFirst, trialOrder, chooseBend, bendLabel, bendTrials, diagnosisSentence
} from "./soft.js"; // pure; Min % and soft rules
import { objectiveScore } from "./objective.js"; // pure; cash mode job 1, 2026-10-17
import { explainRules } from "./count-rules.js"; // pure; team, game and ownership rules (items 8 and 9, Adam 2026-11-16)
import {
  RULE_KEYS, RULE_LABELS, stackWords, num, money, rowPos, dkKeyOf, normaliseSettings, ownStackActive, oppStackActive
} from "./multi-settings.js";
import { prepare, prepareLineup } from "./multi-prepare.js";
import { makePrevIndex, availableLists, searchOne } from "./multi-search.js";

/** Lineup n bent by soft.js chooseBend's trial; {why} when nothing bends, {timedOut} past the deadline (a trial's lineup then is not proven best, so none is chosen).
 *  `vary`: a varied build's variedState for this lineup's draws (each trial searches on them), else null. */
function bendLineup(c, forced, lst, n, vary = null) {
  const { opts } = c;
  const d = diagnose(c.rows, c.settings, c.slate, c.existingCount, c.prevKeys, opts, null, { forced, vary });
  if (d.timedOut) return { timedOut: true }; // a trial's lineup past the deadline is not proven best: never chosen
  const pick = chooseBend(d.trials);
  if (!pick) {
    const names = listNames(forced.map((id) => c.st.byId.get(id)?.name ?? id));
    const minUnchecked = d.trials.some((t) => t.kind === "minForce" && t.unchecked);
    const why = lst.fatal && minUnchecked ? `the Min % players for this lineup (${names}) cannot all be placed: ${lst.fatal.replace(/\.$/, "")}`
      : diagnosisSentence(d.trials, { n, existingCount: c.existingCount, perQb: opts.qbStacks.size > 0, capText: money(opts.cap) });
    return { why };
  }
  const dropped = pick.dropAll ? forced : pick.drop ? [pick.drop] : [];
  let label = bendLabel(pick, d.trials);
  if (pick.kind === "minForce") {
    // A Min man the bent search takes on his own is not bent in this lineup: only those absent are named, none means no bend.
    const absent = dropped.filter((id) => !pick.best.some((p) => p.key === c.st.keyOfId.get(id)));
    if (absent.length < dropped.length) {
      const names = absent.map((id) => c.st.byId.get(id)?.name ?? id);
      label = !absent.length ? null : names.length === 1 ? `the Min % on ${names[0]}` : `the Min % players ${listNames(names)}`;
    }
  }
  return { players: pick.best, label, dropped };
}

/** Why no lineup can be made when the team, game and ownership rules are the cause (count-rules.js explainRules), or null when they are not. Each probe searches the lineup
 *  again with only a subset of the rules and every other setting as it stands, on the same node allowance as the quarterback checks (opts.checkTotalLimit). */
function countRulesWhy(c, pin = null) {
  const { opts } = c;
  const base = c.settings && typeof c.settings === "object" ? c.settings : {};
  const ready = (rules) => {
    // `pin`: a quarterback locked for the check (entryQbChecks: why this man fits no lineup).
    const o2 = normaliseSettings({ ...base, ...(pin ? { locks: [...opts.locks, pin] } : {}), countRules: rules, count: opts.count }, c.slate, c.existingCount, []);
    o2.capCount = opts.capCount;
    return { o2, st2: prepare(c.rows, o2, []) };
  };
  const probe = (rules) => {
    const { o2, st2 } = ready(rules);
    if (st2.fatal) return false;
    const prev2 = makePrevIndex(st2, c.prevKeys, 1);
    const limit = Math.max(0, Math.min(opts.diagNodeLimit, opts.checkTotalLimit - opts.checkUsed));
    const r = searchOne(st2, availableLists(st2, o2, c.counts ?? new Map(), prev2), prev2, o2, limit);
    opts.checkUsed += r.nodes;
    return r.best ? true : r.aborted ? null : false;
  };
  const { st2 } = ready(opts.countRules);
  if (st2.fatal) return /^The rule /.test(st2.fatal) ? st2.fatal.replace(/^The rule /, "the rule ").replace(/\.$/, "") : null; // locked men already past an at-most: prepare's own sentence
  return explainRules(opts.countRules, { pool: st2.candByKey ? [...st2.candByKey.values()] : [], locked: st2.lockCands ?? [], probe });
}

/** Per-QB entries: each unlocked entry QB is tried alone first; one who fits no lineup gets a note; returns the keys noted. */
function entryQbChecks(rows, settings, slate, existingCount, prevKeys, opts, st, notes) {
  const reported = new Set();
  if (!st.perQb || st.lockCands.some((c) => c.pos === "QB") || opts.capCount.QB === 0) return reported;
  const base = settings && typeof settings === "object" ? settings : {};
  for (const qb of st.byPos.QB) {
    if (!qb.rule || st.qbNoted.has(qb.key) || st.playerCapN.get(qb.key) === 0) continue;
    const scratch = [];
    const o2 = normaliseSettings({ ...base, locks: [...opts.locks, qb.id], count: opts.count }, slate, existingCount, scratch);
    o2.capCount = opts.capCount;
    const st2 = prepare(rows, o2, scratch);
    if (st2.fatal && /^The rule /.test(st2.fatal)) { // he alone is past a team, game or ownership at-most: the rule is why, said (G62)
      notes.push(`${qb.name} cannot be in any lineup: ${st2.fatal.replace(/^The rule /, "the rule ").replace(/\.$/, "")}.`);
      reported.add(qb.key);
      continue;
    }
    if (st2.fatal) continue; // he and the locks do not fit together (salary or slots): not his stack settings, as for any quarterback
    const lim = Math.max(0, Math.min(opts.diagNodeLimit, opts.checkTotalLimit - opts.checkUsed)); // one total for every check and diagnosis: they never eat the build
    if (lim === 0) {
      notes.push(uncheckedQbNote(qb.name));
      reported.add(qb.key);
      continue;
    }
    const prev2 = makePrevIndex(st2, prevKeys, 1);
    const r = searchOne(st2, availableLists(st2, o2, new Map(), prev2), prev2, o2, lim);
    opts.checkUsed += r.nodes;
    if (opts.stats) opts.stats.checkNodes = (opts.stats.checkNodes ?? 0) + r.nodes;
    if (r.timedOut) break; // past the deadline the build itself ends at its first search; no more checks and no note
    if (r.best) continue;
    reported.add(qb.key);
    if (r.aborted) {
      notes.push(uncheckedQbNote(qb.name)); // never a silent drop — rules-repo review 2026-10-17 finding 3
      continue;
    }
    const d = diagnose(rows, settings, slate, existingCount, prevKeys, opts, qb.id);
    if (d.timedOut) { reported.delete(qb.key); break; } // past the deadline: no note from a diagnosis that did not finish
    // A team, game or ownership rule can be what keeps him out (his stack needs two KC teammates and "KC ≤ 1"): when no setting bends to let him in, the rules are asked with him locked.
    const rulesWhy = opts.countRules.length ? countRulesWhy({ opts, settings, slate, rows, existingCount, prevKeys }, qb.id) : null;
    const stackWhy = `${qb.name} cannot be in any lineup with his stack settings: ${diagnosisSentence(d.trials, { n: 0, existingCount, perQb: opts.qbStacks.size > 0, capText: money(opts.cap) })}.`;
    if (!rulesWhy) notes.push(stackWhy);
    else if (d.trials.some((t) => t.found)) notes.push(`${stackWhy} The team, game or ownership rules are also why: ${rulesWhy}.`); // both are causes: relaxing either lets him in
    else notes.push(`${qb.name} cannot be in any lineup: ${rulesWhy}.`);
  }
  return reported;
}

/** An entry quarterback whose solo pre-check ran too long to finish (its own limit or the checks' total; it only writes this note and never changes a lineup). */
function uncheckedQbNote(name) {
  return `${name}'s stack settings could not be checked (the check ran too long to finish); if he is in no lineup, they may be why.`;
}

/** The cap a "must" player has reached for this lineup, or null: his own Max % only. His position's Max % no longer
 *  counts (Adam 2026-10-18: a must teammate is exempt from it; mustAboveCapNotes says so). A DST keeps the old check. */
function mustCapCause(c, counts, st, opts) {
  const used = counts.get(c.key) ?? 0;
  const own = st.playerCapN.get(c.key);
  if (own !== undefined && used >= own) {
    const pct = opts.playerCap.get(c.id)?.pct;
    return `his Max %${pct === undefined ? "" : ` of ${pct}%`} (${own} of ${opts.count} lineups)`;
  }
  const capN = opts.capCount[c.pos];
  return c.pos === "DST" && capN !== undefined && used >= capN ? `the ${c.pos} maximum exposure (${opts.capLabel[c.pos]})` : null;
}

// --------------------------------------------------------------------------------------------------------
// Why a lineup could not be made
// --------------------------------------------------------------------------------------------------------

/** The plain cause when no starred quarterback is in the pool (Adam 2026-10-16): { text, plainly }, plainly = all out or excluded; else null. */
function starredQbCause(rows, opts) {
  const pool = prepare(rows, opts, []).candByKey;
  const seen = new Set();
  const starred = rows.filter((r) => r && typeof r === "object" && r.id !== null && r.id !== undefined && r.starred && rowPos(r) === "QB" && !seen.has(dkKeyOf(r, String(r.id))) && seen.add(dkKeyOf(r, String(r.id))));
  if (!pool || !starred.length || starred.some((r) => pool.has(dkKeyOf(r, String(r.id))))) return null;
  const plainly = starred.every((r) => opts.excludes.has(String(r.id)) || rowIsOut(r));
  const why = `every starred quarterback is ${plainly ? "ruled out or excluded" : "ruled out, excluded or not in the pool"}`;
  const names = listNames(starred.map((r) => r.name ?? r.id));
  return { plainly, why, names, text: `${why} (${names}); star another or turn off "Starred QBs only"` };
}

/** Re-runs the failed lineup with one setting relaxed at a time; in soft mode least change first, to the first found. */
function diagnose(rows, settings, slate, existingCount, prevKeys, opts, pin = null, soft = null) {
  const given = settings && typeof settings === "object" ? settings : {};
  const base = pin ? { ...given, locks: [...opts.locks, pin] } : given;
  const rowOf = new Map(rows.filter((r) => r && typeof r === "object").map((r) => [String(r.id), r]));
  const nameOf = (id) => rowOf.get(id)?.name ?? id;
  const focusId = pin ?? opts.locks.find((id) => rowOf.has(id) && rowPos(rowOf.get(id)) === "QB") ?? null;
  const focusKey = focusId === null ? null : dkKeyOf(rowOf.get(focusId), focusId);
  // D73: of a quarterback's twin rows holding entries only the last is in effect (qbEntryByKey), so only that one is relaxed or kept.
  const effective = new Map();
  for (const [id, e] of opts.qbStacks) {
    const key = rowOf.has(id) ? dkKeyOf(rowOf.get(id), id) : `id:${id}`;
    effective.delete(key);
    effective.set(key, [id, e]);
  }
  const live = new Map(effective.values());
  const entries = focusKey === null ? live
    : new Map([...live].filter(([id]) => rowOf.has(id) && dkKeyOf(rowOf.get(id), id) === focusKey));
  // D73 (amended 2026-10-17): a side the focused QB sets ignores the global, so relaxing the global does not help him.
  const focusSets = (sets) => focusKey !== null && [...entries.values()].some(sets);
  const forced = soft ? soft.forced : [];
  const lockedQb = opts.locks.some((id) => rowPos(rowOf.get(id) ?? {}) === "QB");
  // D74: caps count only this batch's lineups (prevKeys holds the saved ones first, then the batch so far).
  const batchCounts = new Map();
  for (const keys of prevKeys.slice(existingCount)) for (const k of keys) batchCounts.set(k, (batchCounts.get(k) ?? 0) + 1);
  const others = Object.fromEntries([...live].filter(([id]) => !entries.has(id)));
  const trials = bendTrials({
    forced: lowestScoreFirst(forced, (id) => objectiveScore(rowOf.get(id), num(rowOf.get(id)?.proj) ?? 0, opts.objective)).map((id) => ({ id, name: nameOf(id) })),
    rules: RULE_KEYS.filter((key) => opts.rules[key]).map((key) => ({
      key, label: RULE_LABELS[key], cause: key === "starredQbOnly" && !pin && !lockedQb ? starredQbCause(rows, opts) : null
    })),
    baseRules: base.rules || {},
    stacks: [
      ...(ownStackActive(opts) && !focusSets(setsTeammates) ? [{ label: `stacking the quarterback with ${stackWords(opts.stackOwn, opts.stackOwnOrMore, "teammate", "teammates")}`, patch: { stackOwn: 0, stackOwnOrMore: true } }] : []),
      ...(oppStackActive(opts) && !focusSets(setsOpponents) ? [{ label: `stacking the quarterback with ${stackWords(opts.stackOpp, opts.stackOppOrMore, "player", "players")} from the team he faces`, patch: { stackOpp: 0, stackOppOrMore: true } }] : [])
    ],
    minUnique: opts.minUnique,
    posCaps: Object.keys(opts.capCount).map((pos) => ({ pos, label: opts.capLabel[pos] })),
    givenMax: base.maxExposure && typeof base.maxExposure === "object" ? base.maxExposure : {},
    spreadDst: opts.spreadDst,
    // Per-player Max %: only a player already at his cap can be what blocks.
    blocking: [...opts.playerCap].filter(([id, { n }]) => rowOf.has(id) && (batchCounts.get(dkKeyOf(rowOf.get(id), id)) ?? 0) >= n).map(([id, { pct }]) => ({ id, name: nameOf(id), pct })),
    givenCaps: base.playerMaxExposure && typeof base.playerMaxExposure === "object" ? base.playerMaxExposure : {},
    entryTrials: stackTrials(entries, nameOf).map((t) => ({ label: t.label, patch: { qbStacks: { ...others, ...t.patch.qbStacks } } })),
    maxPerTeam: opts.maxPerTeam,
    capAllTeams: opts.capAllTeams,
    avoidGames: opts.avoidGames.size > 0,
    locks: opts.locks.length > 0,
    pin
  });

  const run = (t, limit) => {
    const scratch = [];
    const o2 = normaliseSettings({ ...base, ...t.patch, count: opts.count }, slate, existingCount, scratch);
    // Exposure caps were sized for the whole request; keep the same counts so only the patched setting differs.
    if (!("maxExposure" in t.patch)) {
      o2.capCount = opts.capCount;
    }
    const keep = t.dropAll ? [] : forced.filter((id) => id !== t.drop);
    const spreadCap = keep.length && o2.spreadDst ? prepare(rows, o2, []).spreadCap ?? null : null;
    const st2 = prepareLineup(rows, o2, keep, spreadCap, scratch);
    if (st2.fatal) return { best: null, nodes: 0, aborted: false };
    const prev2 = makePrevIndex(st2, prevKeys, 1);
    const sst2 = soft?.vary ? soft.vary(st2) : st2; // a varied lineup's bend trials search on its draws (made after prev2, sharing its index)
    const avail = availableLists(sst2, o2, batchCounts, prev2);
    return searchOne(sst2, avail, prev2, o2, limit);
  };
  // A bend's trials have no limit (a test's `_bendNodeLimit` aside); a quarterback check's diagnosis, which only writes a note, has its
  // own and draws on the checks' one total (opts.checkTotalLimit), so it can never eat the build. Past the deadline the trials stop.
  let nodes = 0;
  let timedOut = false;
  for (const i of soft ? trialOrder(trials) : trials.keys()) {
    const t = trials[i];
    const limit = soft ? opts.bendNodeLimit : Math.max(0, Math.min(opts.diagNodeLimit, opts.checkTotalLimit - opts.checkUsed));
    const r = run(t, limit);
    nodes += r.nodes;
    if (!soft) opts.checkUsed += r.nodes;
    if (r.timedOut) {
      timedOut = true;
      break;
    }
    if (opts.stats) {
      opts.stats.trialsRun = (opts.stats.trialsRun ?? 0) + 1;
      const key = soft ? "bendNodes" : "diagNodes"; // PROJECT.md Part 4 Optimizer: a bend's diagnosis steps are counted in stats.bendNodes, the quarterback checks' in stats.diagNodes
      opts.stats[key] = (opts.stats[key] ?? 0) + r.nodes;
    }
    Object.assign(t, { found: Boolean(r.best), unchecked: !r.best && r.aborted, aborted: r.aborted, best: r.best, limit });
    // The starred-quarterback cause is worded only when nothing else would allow the lineup, so that case runs on.
    if (soft && chooseBend([t]) && !(t.cause && !t.cause.plainly)) break;
  }
  return { trials, nodes, run, timedOut };
}

export { bendLineup, countRulesWhy, entryQbChecks, mustCapCause };
