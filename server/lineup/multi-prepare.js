// The Optimizer engine's candidate pool and bound-table preparation (split from multi.js under R87, moved not edited).
import { statusSetting, statusWordOf } from "../rank/sidelined.js"; // pure: the public site runs this engine in the browser (D69)
import { countsTowardStack } from "./stack-rules.js"; // pure leaf; one copy of the stack predicate
import { qbStackPrepare } from "./qb-stacks.js"; // pure; per-QB stack settings
import { MAX_AT, CONFIGS, listNames } from "./soft.js"; // pure; Min % and soft rules
import { objectiveScore, ceilingNotes, keptOutNote, keptOutReason, FIGURE_BUILDS } from "./objective.js"; // pure; cash mode job 1, 2026-10-17
import { medianOf } from "./cash.js"; // pure; entered only when settings.mode is "cash" (cash mode job 1, 2026-10-17)
import { membership, poolShortfalls } from "./count-rules.js"; // pure; team, game and ownership rules (items 8 and 9, Adam 2026-11-16)
import {
  POSITIONS, SLOT_COUNT, SCORE_SCALE, LAG_RULES, MAX_UNITS, RULE_LABELS, num, upper, money, gcd, rowPos, anyStarredQb, rowFlags, stackRuleOf,
  REVIVED_OUT_WORDS, oppStackActive, dkKeyOf, keptSidelinedNote, noSourceProjectionNote, pctToLineups
} from "./multi-settings.js";
import { configTables, usableDsts, cmpCand, playerCapsByKey } from "./multi-search.js";

/** prepare() for one lineup: `forced` Min players are locks for it alone; the spread-defense cap stays the batch's. */
function prepareLineup(rows, o, forced, spreadCap, notes) {
  if (!forced.length) return prepare(rows, o, notes);
  const st = prepare(rows, { ...o, locks: [...o.locks, ...forced], forced: new Set(forced) }, notes);
  st.spreadCap = spreadCap;
  return st;
}

// --------------------------------------------------------------------------------------------------------
// Pool
// --------------------------------------------------------------------------------------------------------

/**
 * Builds the candidate pool and the bound tables. Returns { fatal } with a sentence when the locks themselves are
 * impossible (unknown, clashing with an exclude, unpriceable, too many at a position, over the cap).
 */
function prepare(rows, opts, notes) {
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object" || row.id === null || row.id === undefined) continue;
    const id = String(row.id);
    if (!byId.has(id)) byId.set(id, row);
  }
  const keyOfId = new Map();
  for (const [id, row] of byId) keyOfId.set(id, dkKeyOf(row, id));
  const st = { keyOfId, byId, fatal: null, cap: opts.cap, rules: opts.rules, maxPerTeam: opts.maxPerTeam, minUnique: opts.minUnique };
  st.capAllTeams = opts.capAllTeams;
  st.medianBuild = opts.objective === "median";
  const figureWord = Object.hasOwn(FIGURE_BUILDS, opts.objective) ? FIGURE_BUILDS[opts.objective] : null;

  const lockSet = new Set(opts.locks);
  const forcedIds = opts.forced ?? new Set();
  const held = forcedIds.size ? "locked and Min %" : "locked";
  const heldAre = forcedIds.size ? "locked or held by a Min %" : "locked";
  const clash = opts.locks.filter((id) => opts.excludes.has(id));
  if (clash.length) {
    st.fatal = `${listNames(clash.map((id) => byId.get(id)?.name ?? id))} ${clash.length > 1 ? "are" : "is"} both locked and excluded.`;
    return st;
  }
  const missing = opts.locks.filter((id) => !byId.has(id));
  if (missing.length) {
    st.fatal = `Locked player${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not on this slate.`;
    return st;
  }
  if (opts.locks.length > SLOT_COUNT) {
    st.fatal = `${opts.locks.length} players are ${heldAre} but a lineup has only nine slots.`;
    return st;
  }

  const teamIx = new Map();
  const gameIx = new Map();
  const ix = (map, key) => {
    if (!map.has(key)) map.set(key, map.size);
    return map.get(key);
  };

  // D55 "only starred quarterbacks": lineups start with a starred QB or a locked one. With the rule on, no QB
  // starred and none locked, nothing is built and Adam is told to star or lock one (no diagnosis trials).
  if (opts.rules.starredQbOnly && !anyStarredQb(rows) && !opts.locks.some((id) => rowPos(byId.get(id)) === "QB")) {
    st.fatal = `Star at least one quarterback (or lock one) first: the rule "${RULE_LABELS.starredQbOnly}" is on.`;
    return st;
  }

  const byKey = new Map();
  let noCeilingLeftOut = 0; // median build: players kept out only for having no TwoGun median
  let typedIgnored = 0; // median build: pool players whose typed projection does not move it
  const revivedLeftOut = new Map(); // name -> reason; median build: listed-out players brought back by a typed projection, kept out unless locked
  const keptOut = {}; // G62: unlocked players left out for any other reason, counted for the Optimizer note (keptOutNote)
  const keepOut = (why) => { keptOut[why] = (keptOut[why] ?? 0) + 1; };
  for (const [id, row] of byId) {
    if (opts.excludes.has(id)) continue;
    const locked = lockSet.has(id);
    const name = row.name ?? id;
    const pos = rowPos(row);
    if (!pos) {
      if (locked) {
        st.fatal = `Locked ${name} has no position a classic lineup can use.`;
        return st;
      }
      keepOut("no position a classic lineup can use");
      continue;
    }
    const salary = num(row.salary);
    if (salary === null || salary < 0) {
      if (locked) {
        st.fatal = `Locked ${name} has no salary in the DraftKings CSV, so he cannot be costed against the cap.`;
        return st;
      }
      keepOut("no salary");
      continue;
    }
    const flagsOf = rowFlags(row, pos, opts);
    const { proj, overridden, projMissing, noProjection, sidelined, game, avoided, unstarredQb, noCeiling, revivedOut, lateOut } = flagsOf;
    const otherwiseOut = noProjection || sidelined || avoided || unstarredQb || lateOut;
    if (!locked && (otherwiseOut || noCeiling || revivedOut)) {
      if (revivedOut && !otherwiseOut) revivedLeftOut.set(name, revivedOut);
      else if (noCeiling && !otherwiseOut) noCeilingLeftOut++;
      else keepOut(keptOutReason(flagsOf));
      continue;
    }
    if (locked) {
      // A late-out row also carries "injured", so the late-out note is checked first.
      if (lateOut) notes.push(`Locked ${name} was ruled out after TwoGun's board was made; he is kept because he is locked.`);
      else if (sidelined) notes.push(keptSidelinedNote(name, statusWordOf(row), "Locked", statusSetting(row) === "out"));
      if (noProjection) notes.push(noSourceProjectionNote(name));
      if (noCeiling) notes.push(`Locked ${name} has no TwoGun ${figureWord} and counts as 0 in this ${figureWord} build.`);
      if (avoided) notes.push(`Locked ${name} plays in ${game}, a game set to avoid; he is kept because he is locked.`);
      if (unstarredQb) notes.push(`Locked ${name} is not starred; he is used because he is locked.`);
    }
    if (figureWord && overridden) typedIgnored++;

    const cand = {
      id,
      key: keyOfId.get(id),
      name,
      pos,
      team: row.team ?? null,
      opp: row.opp ?? null,
      game,
      teamIx: ix(teamIx, upper(row.team) || `?${id}`),
      oppIx: row.opp ? ix(teamIx, upper(row.opp)) : -1,
      gameIx: ix(gameIx, game ?? `?${id}`),
      salary,
      proj: proj ?? 0,
      median: st.medianBuild ? medianOf(row) : null,
      projMissing,
      own: num(row.own),
      score: Math.round(objectiveScore(row, proj ?? 0, opts.objective) * SCORE_SCALE),
      stackOk: countsTowardStack(pos),
      locked,
      kickoff: row.kickoffUtc ?? null,
      prevList: null,
      sUnits: 0
    };
    // Two rows of one DraftKings player: keep the locked one, else the better one.
    const twin = byKey.get(cand.key);
    if (twin) {
      if (twin.locked && cand.locked) {
        st.fatal = `${twin.name} and ${cand.name} are the same DraftKings player, so both cannot be locked.`;
        return st;
      }
      const better = cand.locked || (!twin.locked && cmpCand(cand, twin) < 0);
      if (!better) continue;
    }
    byKey.set(cand.key, cand);
  }
  const keptOutLine = keptOutNote(keptOut);
  if (keptOutLine) notes.push(keptOutLine);
  if (figureWord) ceilingNotes(noCeilingLeftOut, typedIgnored, notes, figureWord, [...byKey.values()].filter((c) => byId.get(c.id)?.override?.bump).length);
  for (const [name, reason] of revivedLeftOut) notes.push(`${name} ${REVIVED_OUT_WORDS[reason](figureWord).replace(/^he /, "")}; include him by locking him.`);

  const all = [...byKey.values()];
  st.teamCount = teamIx.size;
  st.gameCount = gameIx.size;
  st.allowRbGame = new Uint8Array(gameIx.size);
  for (const [g, i] of gameIx) if (opts.allowRbGames.has(g)) st.allowRbGame[i] = 1;
  st.candByKey = byKey;

  const lockCands = opts.locks.map((id) => all.find((c) => c.id === id)).filter(Boolean);
  if (lockCands.length !== opts.locks.length) {
    // The other row of a locked man's twin pair was locked instead; resolved above, so this cannot happen.
    st.fatal = "A locked player could not be placed in the pool.";
    return st;
  }
  st.lockCands = lockCands;
  // Team, game and ownership rules: each man's membership flags (0 or 1 per rule) for searchOne's counts, and his signature, which trimPosition keeps equal between a man and his dominators.
  st.countRules = opts.countRules;
  if (opts.countRules.length) {
    for (const c of all) {
      c.inRule = membership(opts.countRules, c);
      c.crSig = c.inRule.join("");
    }
    st.lagRules = opts.countRules.map((r, i) => ({ i, n: r.op === "atLeast" ? r.n : 0 })).filter((x) => x.n >= 3).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, LAG_RULES).map((x) => x.i);
    const lockedPast = poolShortfalls(opts.countRules.filter((r) => r.op === "atMost"), [], lockCands, "can be used", forcedIds.size ? "locked or Min %" : "locked");
    if (lockedPast.length) {
      st.fatal = `The rule ${lockedPast[0]}.`;
      return st;
    }
    // Ownership rules count only men with a figure: say how many have none (G62), once per build (prepare's own notes, not a probe's scratch list).
    const unfigured = all.filter((c) => c.own === null).length;
    if (unfigured > 0 && opts.countRules.some((r) => r.kind === "own")) {
      notes.push(`Ownership rules: ${unfigured} of ${all.length} players have no ownership figure and count as neither under nor over.`);
    }
  }
  const locksAt = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
  for (const c of lockCands) locksAt[c.pos]++;
  st.locksAt = locksAt;
  for (const pos of POSITIONS) {
    if (locksAt[pos] > MAX_AT[pos]) {
      st.fatal = `${locksAt[pos]} ${pos}s are ${heldAre} but a lineup holds at most ${MAX_AT[pos]}.`;
      return st;
    }
  }
  if (locksAt.RB + locksAt.WR + locksAt.TE > 7 || !CONFIGS.some((cfg) => POSITIONS.every((p) => locksAt[p] <= cfg[p]))) {
    st.fatal = `The ${held} running backs, receivers and tight ends (${locksAt.RB} RB, ${locksAt.WR} WR, ${locksAt.TE} TE) do not fit the RB, RB, WR, WR, WR, TE and FLEX slots.`;
    return st;
  }
  const lockSalary = lockCands.reduce((s, c) => s + c.salary, 0);
  if (lockSalary > opts.cap) {
    st.fatal = `The ${held} players cost ${money(lockSalary)}, which is already over the ${money(opts.cap)} cap.`;
    return st;
  }
  st.lockSalary = lockSalary;

  // D73 stack, resolved once: exactly N (O) unless "or more" (global rule, D73 amended 2026-10-17).
  st.global = stackRuleOf(opts);
  const qs = qbStackPrepare(opts.qbStacks, {
    byId, keyOfId, candByKey: byKey, lockCands, rules: opts.rules, ruleLabel: (key) => RULE_LABELS[key], allowRbGame: st.allowRbGame,
    global: st.global
  });
  if (qs.fatal) {
    st.fatal = qs.fatal;
    return st;
  }
  notes.push(...qs.notes);
  for (const c of all) if (c.pos === "QB") c.rule = qs.rules.get(c.key) ?? null;
  st.perQb = qs.rules.size > 0;
  st.protectedKeys = qs.protectedKeys;
  st.qbNoted = qs.noted;
  // Adam 2026-10-18: a player he forces is exempt from his position's Max % cap. A lock already is (not in the pool); so is
  // a "must" teammate of the quarterback in that lineup: every quarterback's musts, or just the locked one's. canAdd lets
  // an over-cap must player in only behind a quarterback whose rule names him (availableLists marks those in overCap).
  st.mustKeys = new Set();
  const lockedQbCand = lockCands.find((c) => c.pos === "QB");
  for (const c of all) {
    if (c.pos === "QB" && c.rule && (!lockedQbCand || lockedQbCand.key === c.key)) for (const k of c.rule.withKeys) st.mustKeys.add(k);
  }

  st.pool = all.filter((c) => !c.locked);
  const byPos = {};
  for (const pos of POSITIONS) byPos[pos] = st.pool.filter((c) => c.pos === pos).sort(cmpCand);
  st.byPos = byPos;
  st.playerCapN = playerCapsByKey(keyOfId, opts.playerCap);

  // Teams that could be the quarterback's, and the teams he could face: the locked QB's, or every QB's in the pool.
  const lockedQb = lockCands.find((c) => c.pos === "QB");
  const qbs = lockedQb ? [lockedQb] : byPos.QB;
  st.qbTeams = new Set(qbs.map((c) => c.teamIx));
  st.qbOppTeams = new Set(qbs.map((c) => c.oppIx).filter((i) => i >= 0));
  const entryQbs = qbs.filter((c) => c.rule);
  st.entryOwnTeams = new Set(entryQbs.map((c) => c.teamIx));
  st.entryOppTeams = new Set(entryQbs.filter((c) => c.rule.oppBinds && c.oppIx >= 0).map((c) => c.oppIx));

  // Spread defenses: cap = max(ceil(20% of count), ceil(count / usable DSTs)), folded into the DST exposure cap.
  st.spreadCap = null;
  if (opts.spreadDst) {
    if (lockCands.some((c) => c.pos === "DST" && !forcedIds.has(c.id))) {
      st.fatal = "A locked defense can't be spread; unlock it or turn off Spread defenses.";
      return st;
    }
    const live = qbs.filter((q) => !st.qbNoted.has(q.key));
    const room = usableDsts(byPos.DST, live, lockCands, opts.rules, st.playerCapN, oppStackActive(opts) ? opts.stackOpp : 0, byKey).map((d) => st.playerCapN.get(d.key) ?? Infinity);
    let share = 1;
    while (share < opts.count && room.reduce((t, n) => t + Math.min(n, share), 0) < opts.count) share++;
    const spread = Math.max(pctToLineups(20, opts.count), room.length ? share : 0);
    st.spreadCap = Math.min(spread, opts.capCount.DST ?? Infinity);
    notes.push(`Spread defenses: no defense in more than ${st.spreadCap} of ${opts.count} lineups.`);
  }

  // Salary units for the knapsack bound: the common divisor of every salary and the cap when that is fine enough,
  // otherwise a coarse unit with costs rounded down and budgets rounded up (still an upper bound).
  const ints = Number.isInteger(opts.cap) && all.every((c) => Number.isInteger(c.salary));
  let unit = 0;
  if (ints) {
    unit = opts.cap;
    for (const c of all) unit = gcd(unit, c.salary);
  }
  if (ints && unit > 0 && opts.cap / unit <= MAX_UNITS) {
    st.exact = true;
    st.unit = unit;
  } else {
    st.exact = false;
    st.unit = opts.cap / MAX_UNITS;
  }
  st.S = Math.floor(opts.cap / st.unit + 1e-9) + 1;
  for (const c of all) c.sUnits = st.exact ? c.salary / st.unit : Math.max(0, Math.floor(c.salary / st.unit - 1e-9));
  st.units = st.exact ? (rem) => rem / st.unit : (rem) => Math.min(st.S - 1, Math.floor(rem / st.unit + 1e-9));

  st.configs = configTables(byPos, st);
  return st;
}

export { prepare, prepareLineup };
