// The Optimizer engine's batch building, Min % and pair rules, and lineup output (split from multi.js under R87, moved not edited).
import { statusSetting, statusWordOf, TYPE_A_PROJECTION } from "../rank/sidelined.js"; // pure: the public site runs this engine in the browser (D69)
import { assignSlots } from "./dk-entries.js";
import { warn } from "../lib/log.js";
import { BUILD_CEILING_MS, stopSentence } from "./build-control.js"; // pure leaf: the one ten minute limit
import { countsTowardStack } from "./stack-rules.js"; // pure leaf; one copy of the stack predicate
import { ruleFromEntry, cappedMustNotes } from "./qb-stacks.js"; // pure; per-QB stack settings
import { listNames, slotsFull, lockedSlotWords, forcedSet } from "./soft.js"; // pure; Min % and soft rules
import { lineupFactors, varianceNote } from "./sd-variance.js"; // pure; GPP variance per position (PROJECT.md Part 4 item 5, Adam 2026-11-11)
import { rulesBroken, ruleWords } from "./count-rules.js"; // pure; team, game and ownership rules (items 8 and 9, Adam 2026-11-16)
import {
  POSITIONS, SLOT_COUNT, MAX_REBUILD_SALARY_STEPS, RULE_LABELS, num, round2, round1, cmpId, upper, rowPos, rowFlags, stackRuleOf, normaliseSettings, dkKeyOf
} from "./multi-settings.js";
import { prepareLineup } from "./multi-prepare.js";
import { configTables, cmpCand, makePrevIndex, addPrev, availableLists, searchOne, defenseBans } from "./multi-search.js";
import { bendLineup, countRulesWhy, mustCapCause } from "./multi-explain.js";

function emptyExposure() {
  const out = {};
  for (const pos of POSITIONS) out[pos] = [];
  return out;
}

/** A varied build's draws (sd-variance.js lineupFactors): every DraftKings player on the board (twin rows are one man) with his
 *  position, so a man's factor depends on neither the pool nor the rows' order; null when the build is not varied. */
function varianceDraws(st, opts) {
  if (!opts.variance) return null;
  const posOfKey = new Map();
  for (const [id, row] of st.byId) if (!posOfKey.has(st.keyOfId.get(id))) posOfKey.set(st.keyOfId.get(id), rowPos(row));
  return { keys: [...posOfKey.keys()], posOf: (key) => posOfKey.get(key), percents: opts.variance };
}

/**
 * The state a varied search runs on (GPP variance): every candidate a copy whose score is his real score times his factor (whole
 * millionths, as prepare() scores), each position's list re-sorted on those scores so the search's cut-offs and the trim hold,
 * and, past MAX_REBUILD_SALARY_STEPS, the bound tables rebuilt (searchOne rebuilds them below it). A copy keeps his salary,
 * projection, median and ids, so presentLineup's totals stay real; `prevList` is the same array, so the uniqueness index made
 * on `st` (makePrevIndex) still counts him. Make it after that index. Pure: `st` is left as it is.
 */
function variedState(st, factors) {
  const copies = new Map();
  const vary = (c) => {
    if (!copies.has(c)) copies.set(c, { ...c, score: Math.round(c.score * (factors.get(c.key) ?? 1)) });
    return copies.get(c);
  };
  const byPos = {};
  for (const pos of POSITIONS) byPos[pos] = st.byPos[pos].map(vary).sort(cmpCand);
  const out = { ...st, byPos, pool: st.pool.map(vary), lockCands: st.lockCands.map(vary), candByKey: new Map([...st.candByKey].map(([k, c]) => [k, vary(c)])) };
  if (st.S > MAX_REBUILD_SALARY_STEPS) out.configs = configTables(byPos, out);
  return out;
}

/** mustAboveCapNotes' items: each must teammate (not locked, not a defense) with a position cap, his lineups of this batch
 *  (`counts`, the same count the reported exposure uses) and the quarterback(s) he was Must for in lineups that held him. */
function mustAboveCapItems(st, opts, counts, batchKeys) {
  const out = [];
  for (const key of st.mustKeys) {
    const cand = st.candByKey.get(key);
    const capN = cand ? opts.capCount[cand.pos] : undefined;
    const count = counts.get(key) ?? 0;
    if (!cand || cand.locked || cand.pos === "DST" || capN === undefined || count <= capN) continue;
    const qbs = new Set();
    for (const keys of batchKeys) {
      if (!keys.includes(key)) continue;
      const qb = keys.map((k) => st.candByKey.get(k)).find((c) => c && c.pos === "QB");
      if (qb && qb.rule && qb.rule.withKeys.includes(key)) qbs.add(qb.name);
    }
    if (!qbs.size) continue; // above the cap by a bend, not by a Must
    out.push({ name: cand.name, pos: cand.pos, count, capN, capLabel: opts.capLabel[cand.pos], withText: listNames([...qbs]) });
  }
  return out;
}

/** The lineups one at a time: soft.js forcedSet's Min % players locked into each, a lineup no setting allows bent. */
function buildBatch(c) {
  const { opts, st, counts, prev, prevKeys, notes } = c;
  const lineups = [];
  const bends = [];
  const bentKeys = new Set(); // closing-note reason: his latest drop was a bend (cleared when he is forced again)
  const bentOut = new Set(); // forcedSet's guard: dropped by any bend, never forced again once past saving (never cleared)
  const waits = new Map();
  const easedUntil = new Map(); // DK key -> last lineup index a bent-out Min player is left unforced
  const room = forcedRoom(st, opts, prevKeys);
  const forcedStates = new Map();
  const madeBefore = () => (lineups.length ? `The ${lineups.length} made before it are returned.` : "No lineups were made.");
  for (let n = 0; n < opts.count; n++) {
    const eased = new Set([...easedUntil].filter(([, last]) => last >= n).map(([key]) => key));
    const { ids: forced, waits: waited } = forcedSet(c.plan, counts, n, opts.count, room, eased, bentOut);
    for (const w of waited) waits.set(w.key, w.why);
    // PROJECT.md Part 4 Optimizer: forced again, his older drop reason gives way to a later one. `bentOut` (every key
    // any bend ever dropped) is never cleared: it is forcedSet's never-forced-again-past-saving guard, and clearing it
    // here let a bent, then re-forced, player cost the search time once more (round-ten review, 2026-10-17).
    for (const id of forced) bentKeys.delete(st.keyOfId.get(id));
    const lst = forced.length ? forcedState(c.rows, opts, st, forced, forcedStates) : st;
    const lprev = lst === st ? prev : lst.fatal ? null : makePrevIndex(lst, prevKeys, 1);
    // GPP variance: this lineup's own draws (saved lineups move them, so a build after a save is no near-clone); every search for it, a bend's trials too, runs on them.
    const factors = c.variance ? lineupFactors(c.variance.keys, c.existingCount + n, c.variance.percents, c.variance.posOf) : null;
    const vary = factors && ((s) => variedState(s, factors));
    const sst = vary && !lst.fatal ? vary(lst) : lst; // made after lprev, so its copies share the uniqueness index
    const avail = lst.fatal ? { trimmed: 0 } : availableLists(sst, opts, counts, lprev);
    const result = lst.fatal ? { best: null, nodes: 0 } : searchOne(sst, avail, lprev, opts, Infinity);
    if (opts.stats) {
      opts.stats.nodes = (opts.stats.nodes ?? 0) + result.nodes;
      opts.stats.trimmed = (opts.stats.trimmed ?? 0) + avail.trimmed;
    }
    // The deadline (the page-thread fallback only): the lineup in hand is not proven best, so it is dropped; the finished ones are returned.
    const endedByDeadline = () => notes.push(stopSentence("ceiling", lineups.length, opts.count, BUILD_CEILING_MS));
    if (result.timedOut) {
      endedByDeadline();
      break;
    }
    let players = result.best;
    let bent = null;
    if (!players) {
      const b = bendLineup(c, forced, lst, n, vary);
      if (b.timedOut) {
        endedByDeadline();
        break;
      }
      if (!b.players) {
        const rulesWhy = opts.countRules.length ? countRulesWhy(c) : null; // the team, game and ownership rules never bend, so they are named when they are why
        notes.push(rulesWhy ? `Lineup ${n + 1} of ${opts.count} could not be made: ${rulesWhy}. ${madeBefore()}` : `No single setting could be bent for lineup ${n + 1} of ${opts.count}: ${b.why}. ${madeBefore()}`);
        break;
      }
      // PROJECT.md Part 4 Optimizer, Min % and soft rules: a dropped Min waits two lineups unless out of slack.
      for (const id of b.dropped.filter((d) => !b.players.some((p) => p.key === st.keyOfId.get(d)))) {
        const key = st.keyOfId.get(id);
        bentOut.add(key);
        bentKeys.add(key);
        easedUntil.set(key, n + 2);
      }
      players = b.players;
      bent = b.label;
    }
    // Rules-repo review 2026-10-17 finding 3: a QB whose "must" player reached a cap is named once, judged on the settled lineup.
    if (st.perQb && st.locksAt.QB === 0) {
      const qbs = (lst.fatal ? availableLists(st, opts, counts, prev) : avail).QB.filter((q) => !players.some((p) => p.key === q.key));
      notes.push(...cappedMustNotes(qbs, (lst.fatal ? st : lst).candByKey, (m) => mustCapCause(m, counts, st, opts), c.mustNoted, c.variance ? null : n + 1)); // a varied batch is re-sorted: no made number
    }
    // Invariant: a made lineup keeps every team, game and ownership rule (count-rules.js, re-checked on `_recheckRules` in a test). A break is a bug: it is logged and said, the lineup is not served
    // and the ones made before it are returned, as every other failure path here ends.
    const countBroken = rulesBroken(opts.recheckRules ?? opts.countRules, players);
    if (countBroken.length) {
      const words = countBroken.map((b) => `"${ruleWords(b.rule)}"`).join(", ");
      warn("lineup: a made lineup broke a count rule", { lineup: n + 1, rules: words });
      notes.push(`Lineup ${n + 1} broke the rule ${words}; this is a bug, the ${n} made before it ${n === 1 ? "is" : "are"} returned.`);
      break;
    }
    const keys = players.map((p) => p.key);
    prevKeys.push(keys);
    addPrev(prev, keys);
    for (const k of keys) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      waits.delete(k); // placed after all, so an earlier clash note no longer holds
    }
    const lineup = presentLineup(st, players);
    if (bent !== null) {
      lineup.bent = bent;
      bends.push({ lineup: n + 1, label: bent });
    }
    lineups.push(lineup);
    if (c.variance && lineups.length === 1) notes.push(varianceNote(c.variance.percents)); // on a batch with a lineup in it, so a snapshot says it too
    c.snapshot?.(lineups, bends);
  }
  return { lineups, bends, bentKeys, waits };
}

/** The Min % players as soft.js minPlan entries: the pool candidate with his caps as limits, or `out` with the reason. */
function minEntries(opts, st) {
  const lockedKeys = new Set(st.lockCands.map((c) => c.key));
  const out = [];
  for (const [id, { n, pct }] of opts.playerMin) {
    const key = st.keyOfId.get(id);
    if (key === undefined || lockedKeys.has(key)) continue;
    const row = st.byId.get(id);
    const base = { id, key, name: row.name ?? id, pct, asked: n };
    const cand = st.candByKey.get(key);
    const lockClash = cand && st.lockCands.map((l) => [l, pairRule(cand, l, opts)]).find(([, rule]) => rule);
    const why = !cand ? minOutReason(row, id, opts) ?? "he is not in the pool" : slotsFull(st.locksAt, cand.pos) ? lockedSlotWords(cand.pos)
      : lockClash ? `${lockClash[1]} keeps him apart from locked ${lockClash[0].name}` : lockedQbRefuses(cand, st, opts);
    if (why) {
      out.push({ ...base, out: why });
      continue;
    }
    const limits = [];
    const own = st.playerCapN.get(key);
    if (own !== undefined) limits.push({ n: own, why: `his Max % allows ${own} of ${opts.count} lineups` });
    if (opts.capCount[cand.pos] !== undefined) limits.push({ n: opts.capCount[cand.pos], why: `the ${cand.pos} maximum exposure is ${opts.capLabel[cand.pos]}` });
    if (cand.pos === "DST" && st.spreadCap !== null) limits.push({ n: st.spreadCap, why: `Spread defenses allow each defense ${st.spreadCap} of ${opts.count} lineups` });
    out.push({ ...base, id: cand.id, pos: cand.pos, salary: cand.salary, score: cand.score, cand, limits });
  }
  return out;
}

/** Why the pool keeps an unlocked row out, in plain words, or null when it does not (the route counts Mins by it). */
export function minOutReason(row, id, opts) {
  if (opts.excludes.has(id)) return "he is excluded";
  const pos = rowPos(row);
  const salary = num(row.salary);
  if (!pos || salary === null || salary < 0) return "he has no salary or position a classic lineup can use";
  const f = rowFlags(row, pos, opts);
  if (f.lateOut) return "he was ruled out after TwoGun's board was made";
  if (f.sidelined) return statusSetting(row) === "out" ? "you marked him Out" : `he is listed ${statusWordOf(row) ?? "injured"}`;
  if (f.noProjection) return f.needsNumber ? `he has no projection. ${TYPE_A_PROJECTION}` : "he has no projection";
  if (f.avoided) return "his game is set to avoid";
  if (f.unstarredQb) return "he is not starred";
  // No median branch: its two callers (minEntries, generate-request.js minPctError) never run with the median objective, since a Min % is refused in cash.
  return null;
}

/** The hard pair rule two players break together, in words, or null. a, b: {pos, team, opp, game, key, name, never
 *  (a QB's "no" keys)}; `rules` the D55 switches, `allowRbGames` a Set of games. One copy for the engine and the route. */
export function pairBreak(a, b, rules, allowRbGames) {
  if (a.pos === "RB" && b.pos === "RB") {
    if (rules.noSameTeamRbs && a.team && a.team === b.team) return `the rule "${RULE_LABELS.noSameTeamRbs}"`;
    if (rules.noSameGameRbs && a.game && a.game === b.game && !allowRbGames.has(a.game)) return `the rule "${RULE_LABELS.noSameGameRbs}"`;
  }
  const [d, o] = a.pos === "DST" ? [a, b] : [b, a];
  if (rules.noDstVsOwnPlayers && d.pos === "DST" && o.pos !== "DST" && d.opp && o.team === d.opp) return `the rule "${RULE_LABELS.noDstVsOwnPlayers}"`;
  for (const [q, p] of [[a, b], [b, a]]) if (q.pos === "QB" && q.never && q.never.has(p.key)) return `the "no" mark for ${q.name}`;
  return null;
}

const pairSide = (c) => ({ pos: c.pos, team: upper(c.team), opp: upper(c.opp), game: c.game, key: c.key, name: c.name, never: c.rule?.neverKeys });
const pairRule = (a, b, opts) => pairBreak(pairSide(a), pairSide(b), opts.rules, opts.allowRbGames);

/** Why the locked quarterback's stack (`rule`) or the per-team limit with the locks refuses `min` every lineup, or
 *  null. Sides: {pos, team, opp, name, stackOk}. One copy for the engine and the route. */
export function lockedQbBlocks(min, locks, rule, maxPerTeam) {
  const qb = locks.find((c) => c.pos === "QB");
  if (!qb || !min || min.pos === "QB") return null;
  const offense = locks.filter((c) => c.pos !== "QB" && c.pos !== "DST");
  if (min.pos !== "DST" && min.stackOk && min.team === qb.team && offense.filter((c) => c.stackOk && c.team === qb.team).length >= rule.capOwn) {
    return `locked ${qb.name}'s stack takes no more teammates`;
  }
  if (min.pos !== "DST" && qb.opp && min.team === qb.opp && offense.filter((c) => c.team === qb.opp).length >= rule.capOpp) {
    return `locked ${qb.name}'s stack takes no more players from the team he faces`;
  }
  const outside = min.team !== qb.team && min.team !== qb.opp;
  if (maxPerTeam !== null && outside && locks.filter((c) => c.team === min.team).length >= maxPerTeam) {
    return `the limit of ${maxPerTeam} per team is already filled by locked players from ${min.team}`;
  }
  return null;
}

const stackSide = (c) => ({ pos: c.pos, team: upper(c.team), opp: upper(c.opp), name: c.name, stackOk: c.stackOk });
function lockedQbRefuses(cand, st, opts) {
  const qb = st.lockCands.find((c) => c.pos === "QB");
  return qb ? lockedQbBlocks(stackSide(cand), st.lockCands.map(stackSide), qb.rule ?? st.global, opts.maxPerTeam) : null;
}

/** RULES.md D73: a quarterback's stack entry (`entries`: [id, entry] pairs) saved under any row of his DraftKings key; of
 *  several, the last in the order the map holds them, as qbStackPrepare keeps it (whole-number ids come first in ascending order, so the
 *  higher id wins among them; any other id keeps the order it was sent in). */
export function qbEntryByKey(entries, keyOf, qbId) {
  return [...entries].filter(([id]) => keyOf(id) === keyOf(qbId)).map(([, e]) => e).pop();
}

/** lockedQbBlocks from board rows and a request's checked settings, as the engine reads them (the route skips such a
 *  Min in its slot count). */
export function lockedQbBlocksRow(settings, rowOf, minId) {
  const opts = normaliseSettings(settings, null, 0, []);
  const side = (id) => {
    const row = rowOf(id);
    const pos = row ? rowPos(row) : null;
    return pos ? { pos, team: upper(row.team), opp: upper(row.opp), name: row.name ?? id, stackOk: countsTowardStack(pos) } : null;
  };
  // By DraftKings key, as the engine reads them: twin locked rows are one man (qbEntryByKey for the stack entry).
  const keyOf = (id) => dkKeyOf(rowOf(id) ?? {}, id);
  const locks = [...new Map(opts.locks.map((id) => [keyOf(id), id])).values()];
  const qbId = locks.find((id) => side(id)?.pos === "QB");
  if (qbId === undefined) return null;
  const entry = qbEntryByKey(opts.qbStacks, keyOf, qbId);
  const rule = entry ? ruleFromEntry(entry, new Map(), stackRuleOf(opts)) : stackRuleOf(opts);
  return lockedQbBlocks(side(minId), locks.map(side).filter(Boolean), rule, opts.maxPerTeam);
}

function forcedRoom(st, opts, prevKeys) {
  const lockKeys = st.lockCands.map((c) => c.key);
  // Locks plus forced players sharing more than 9 - minUnique with an earlier lineup (saved or batch) can never pass.
  const tooAlike = (keys) => {
    if (lockKeys.length + keys.length <= SLOT_COUNT - opts.minUnique) return false;
    const alike = prevKeys.some((prev) => [...lockKeys, ...keys].filter((k) => prev.includes(k)).length > SLOT_COUNT - opts.minUnique);
    if (alike && opts.stats) opts.stats.repeatsHeld = (opts.stats.repeatsHeld ?? 0) + 1;
    return alike;
  };
  // D73: the places a locked or forced quarterback still needs for his stack beyond those already held, at the
  // positions where the pool has a teammate (or opponent) who would count and a held defense does not ban.
  const stackNeed = (set) => {
    const held = [...st.lockCands, ...set.map((p) => p.cand)];
    const qb = held.find((c) => c.pos === "QB");
    if (!qb) return [];
    const rule = qb.rule ?? st.global;
    const offense = held.filter((c) => c.pos !== "QB" && c.pos !== "DST");
    const dstOpp = held.find((c) => c.pos === "DST")?.oppIx ?? -1;
    const reach = (counts, ban) => POSITIONS.filter(countsTowardStack).filter((pos) => st.byPos[pos].some((c) => countsFor(c, counts) && !held.includes(c) && !(ban && defenseBans(opts.rules, dstOpp, c))));
    const side = (counts) => {
      const at = reach(counts, true);
      const why = !at.length && reach(counts, false).length ? `the defense rule bans every player of the team the held defense faces, and the quarterback's stack needs ${counts === "own" ? "a teammate" : "an opponent"} from it` : undefined;
      return { side: counts, n: Math.max(0, (counts === "own" ? rule.needOwn : rule.needOpp) - offense.filter((c) => countsFor(c, counts)).length), at, why };
    };
    const countsFor = (c, counts) => (counts === "own" ? c.stackOk && c.teamIx === qb.teamIx : qb.oppIx >= 0 && c.teamIx === qb.oppIx);
    return [side("own"), side("opp")].filter((r) => r.n > 0);
  };
  const cheapest = {};
  for (const pos of POSITIONS) cheapest[pos] = st.byPos[pos].map((c) => ({ key: c.key, salary: c.salary })).sort((a, b) => a.salary - b.salary);
  // The two back rules make one-per-lineup classes (one team; one game unless allowed).
  const classes = (p) => (p.pos !== "RB" ? [] : [
    opts.rules.noSameTeamRbs && upper(p.cand.team) ? `team:${upper(p.cand.team)}` : null,
    opts.rules.noSameGameRbs && p.cand.game && !opts.allowRbGames.has(p.cand.game) ? `game:${p.cand.game}` : null
  ].filter(Boolean));
  return { locksAt: st.locksAt, lockSalary: st.lockSalary, cap: opts.cap, cheapest, clash: (p, q) => pairRule(p.cand, q.cand, opts), classes, tooAlike, stackNeed };
}

function forcedState(rows, opts, st, forced, cache) {
  const sig = forced.join("\n");
  if (!cache.has(sig)) cache.set(sig, prepareLineup(rows, opts, forced, st.spreadCap, []));
  return cache.get(sig);
}

// --------------------------------------------------------------------------------------------------------
// Output
// --------------------------------------------------------------------------------------------------------

/** Nine players in DraftKings slot order through dk-entries.js assignSlots (the spare RB, WR or TE with the
 *  latest kickoff goes to FLEX, D56), plus totals. */
function presentLineup(st, players) {
  const pool = new Map();
  const kickoff = new Map();
  for (const c of players) {
    pool.set(c.id, { name: c.name, pos: c.pos, salary: c.salary, gameInfo: c.game ?? "" });
    const t = c.kickoff ? Date.parse(c.kickoff) : NaN;
    kickoff.set(c.id, Number.isFinite(t) ? t : 0);
  }
  let ids;
  try {
    ids = assignSlots(players.map((c) => c.id), pool, kickoff);
  } catch (e) {
    warn("lineup: slot order failed", { error: e && e.message });
    const order = { QB: 0, RB: 1, WR: 2, TE: 3, DST: 5 };
    ids = [...players].sort((a, b) => order[a.pos] - order[b.pos] || b.salary - a.salary).map((c) => c.id);
  }
  const salary = players.reduce((s, c) => s + c.salary, 0);
  const proj = players.reduce((s, c) => s + c.proj, 0);
  // Cash 2b fix, 2026-10-17: a median build's proj is null when any player's projection is missing.
  const out = { ids, salary, proj: st.medianBuild && players.some((c) => c.projMissing) ? null : round2(proj) };
  // A median build's medians summed; null, never a partial sum, when any player lacks one.
  if (st.medianBuild) out.median = players.every((c) => c.median !== null) ? round2(players.reduce((s, c) => s + c.median, 0)) : null;
  return out;
}

/** Per position, every player in the saved plus new lineups: {id, name, count, pct}, most-used first. */
function exposureOf(st, prevKeys, opts) {
  const out = emptyExposure();
  const total = prevKeys.length;
  if (!total) return out;
  const counts = new Map();
  for (const keys of prevKeys) for (const k of new Set(keys)) counts.set(k, (counts.get(k) ?? 0) + 1);
  const rowByKey = new Map();
  if (st.byId) for (const [id, row] of st.byId) if (!rowByKey.has(st.keyOfId.get(id))) rowByKey.set(st.keyOfId.get(id), { id, row });
  for (const [key, count] of counts) {
    const cand = st.candByKey ? st.candByKey.get(key) : null;
    const hit = cand ? { id: cand.id, row: st.byId.get(cand.id) } : rowByKey.get(key);
    if (!hit) continue;
    const pos = rowPos(hit.row);
    if (!pos) continue;
    out[pos].push({ id: hit.id, name: hit.row.name ?? hit.id, count, pct: round1((count / total) * 100) });
  }
  for (const pos of POSITIONS) out[pos].sort((a, b) => b.count - a.count || cmpId(a.name, b.name));
  return out;
}

export { emptyExposure, varianceDraws, mustAboveCapItems, buildBatch, minEntries, exposureOf };
