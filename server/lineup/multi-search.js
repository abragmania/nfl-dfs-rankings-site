// The Optimizer engine's bound tables, uniqueness index, per-lineup lists and exact search (split from multi.js under R87, moved not edited; see multi.js for the search's description).
import { MAX_AT, CONFIGS } from "./soft.js"; // pure; Min % and soft rules
import { mustPlan, withReachable } from "./qb-stacks.js"; // pure; per-QB stack settings
import {
  POSITIONS, SLOT_COUNT, GROUP_ORDER, SCORE_SCALE, LAG_WEIGHTS, MAX_REBUILD_SALARY_STEPS, cmpId, ownStackActive, oppStackActive
} from "./multi-settings.js";

/** One bound table set per position mix the locks allow, on these per-position lists. */
function configTables(lists, st) {
  const knap = {};
  for (const pos of POSITIONS) knap[pos] = knapsack(lists[pos], MAX_AT[pos], st.S);
  // Rule-aware bounds (team, game and ownership at-least rules): for each tight rule r and weight L, the same tables on scores raised by L for a man in the rule's set. A completion that must
  // hold d more men of the set scores at most (the raised table) minus L * d, for any L >= 0, so each is an upper bound; searchOne takes the lowest of them and the plain one.
  const lagKnap = (st.lagRules ?? []).flatMap((r) => LAG_WEIGHTS.map((points) => {
    const weight = points * SCORE_SCALE;
    const raised = {};
    for (const pos of POSITIONS) raised[pos] = knapsack(lists[pos], MAX_AT[pos], st.S, (c) => c.score + weight * c.inRule[r]);
    return { r, weight, raised };
  }));
  const out = [];
  for (let ci = 0; ci < CONFIGS.length; ci++) {
    const cfg = CONFIGS[ci];
    if (!POSITIONS.every((p) => st.locksAt[p] <= cfg[p])) continue;
    const groups = GROUP_ORDER.map((pos) => ({ pos, need: cfg[pos] - st.locksAt[pos] })).filter((g) => g.need > 0);
    const lag = lagKnap.map(({ r, weight, raised }) => ({ r, weight, ...boundTables(groups, raised, st.S) }));
    out.push({ index: ci, groups, lag, ...boundTables(groups, knap, st.S) });
  }
  return out;
}

/** Spread defenses (pure): a defense with Max % room counts unless, under the defense rule, he faces a locked player or no
 *  usable QB can take him (QB faces him, or is his team's and needs an opponent) — rules-repo review 2026-10-17 finding 2. */
export function usableDsts(dsts, qbs, lockCands, rules, playerCapN, globalNeedOpp, candByKey) {
  const qbOk = qbs.filter((q) => playerCapN.get(q.key) !== 0);
  const needsOpp = (q) => (q.rule ? q.rule.needOpp > 0 || q.rule.withKeys.some((k) => candByKey.get(k)?.teamIx === q.oppIx) : globalNeedOpp > 0);
  return dsts.filter((d) => {
    if ((playerCapN.get(d.key) ?? Infinity) <= 0) return false;
    if (!rules.noDstVsOwnPlayers || d.oppIx < 0) return true;
    return !lockCands.some((c) => c.teamIx === d.oppIx) && qbOk.some((q) => q.teamIx !== d.oppIx && !(d.teamIx === q.teamIx && needsOpp(q)));
  });
}

/** Projection descending, then salary ascending, then id: the order every list is searched in. */
function cmpCand(a, b) {
  return b.score - a.score || a.salary - b.salary || cmpId(a.id, b.id);
}

/** best[k][s]: the highest total score of exactly k players from `list` costing at most s units (-Infinity when
 *  no k players fit). */
function knapsack(list, K, S, scoreOf = (c) => c.score) {
  const best = [];
  for (let k = 0; k <= K; k++) {
    const row = new Float64Array(S);
    row.fill(k === 0 ? 0 : -Infinity);
    best.push(row);
  }
  for (const c of list) {
    const w = c.sUnits;
    const score = scoreOf(c);
    for (let k = K; k >= 1; k--) {
      const cur = best[k];
      const prev = best[k - 1];
      for (let s = S - 1; s >= w; s--) {
        const v = prev[s - w] + score;
        if (v > cur[s]) cur[s] = v;
      }
    }
  }
  return best;
}

/** R[g][k][s]: best score for k more players of group g plus all later groups within s units. suffix[g] is R[g][need]. */
function boundTables(groups, knap, S) {
  const G = groups.length;
  const suffix = new Array(G + 1);
  suffix[G] = new Float64Array(S).fill(0);
  const R = new Array(G);
  for (let g = G - 1; g >= 0; g--) {
    const { pos, need } = groups[g];
    R[g] = new Array(need + 1);
    const next = suffix[g + 1];
    for (let k = 1; k <= need; k++) {
      const own = knap[pos][k];
      const out = new Float64Array(S).fill(-Infinity);
      for (let s1 = 0; s1 < S; s1++) {
        const a = own[s1];
        if (a === -Infinity) continue;
        if (s1 > 0 && a === own[s1 - 1]) continue; // own is non-decreasing; a repeat adds nothing new
        for (let s = s1; s < S; s++) {
          const v = a + next[s - s1];
          if (v > out[s]) out[s] = v;
        }
      }
      R[g][k] = out;
    }
    suffix[g] = R[g][need];
  }
  return { R, suffix };
}

// --------------------------------------------------------------------------------------------------------
// Earlier lineups (saved plus batch): uniqueness index
// --------------------------------------------------------------------------------------------------------

function makePrevIndex(st, prevKeys, count) {
  const prev = { byKey: new Map(), size: 0, capacity: prevKeys.length + count, usedKeys: new Set() };
  for (const c of st.candByKey.values()) {
    prev.byKey.set(c.key, []);
    c.prevList = prev.byKey.get(c.key);
  }
  for (const keys of prevKeys) addPrev(prev, keys);
  return prev;
}

function addPrev(prev, keys) {
  const L = prev.size++;
  for (const k of keys) {
    if (!prev.byKey.has(k)) prev.byKey.set(k, []);
    prev.byKey.get(k).push(L);
    prev.usedKeys.add(k);
  }
}

// --------------------------------------------------------------------------------------------------------
// Per-lineup lists: exposure caps, then dominance trimming
// --------------------------------------------------------------------------------------------------------

/** Per-player Max % (D74, this batch only) as lineup counts by DK key; two rows of one man take the smaller cap. */
function playerCapsByKey(keyOfId, playerCap) {
  const out = new Map();
  for (const [id, { n }] of playerCap) {
    const key = keyOfId.get(id);
    if (key !== undefined) out.set(key, Math.min(n, out.get(key) ?? Infinity));
  }
  return out;
}

function availableLists(st, opts, counts, prev) {
  const out = { trimmed: 0, overCap: new Set() };
  const playerCapN = st.playerCapN;
  for (const pos of POSITIONS) {
    let capN = opts.capCount[pos];
    if (pos === "DST" && st.spreadCap !== null) capN = Math.min(capN ?? Infinity, st.spreadCap);
    let list = st.byPos[pos];
    // Adam 2026-10-18: a must teammate is exempt from his position's cap; at or over it he is listed in overCap, which
    // searchOne's canAdd opens only behind a quarterback whose rule names him. His own Max % below still holds.
    if (capN !== undefined) {
      list = list.filter((c) => {
        if ((counts.get(c.key) ?? 0) < capN) return true;
        if (pos === "DST" || !st.mustKeys.has(c.key)) return false; // Spread defenses' cap is not a Max % and stays
        out.overCap.add(c.key);
        return true;
      });
    }
    if (playerCapN.size) list = list.filter((c) => !playerCapN.has(c.key) || (counts.get(c.key) ?? 0) < playerCapN.get(c.key));
    if (!opts.noTrim) {
      const kept = trimPosition(list, pos, st, opts, prev);
      out.trimmed += list.length - kept.length;
      list = kept;
    }
    out[pos] = list;
  }
  return out;
}

/**
 * Drops the players at one position that can never be in the best lineup. Player p is dropped when it has
 * "dominators": players q of the same position, not locked, still available, in no earlier lineup, with
 * salary(q) <= salary(p) and projection(q) >= projection(p), strictly better on one of them or tied on both with
 * a smaller id. For any legal lineup M holding p,
 * M - p + q is cheaper or equal, projects at least as much and ranks strictly ahead of M; it is legal whenever
 * q is not already in M and q's team is not blocked by a team rule. So p can go once, for every possible M, at
 * least one dominator survives both:
 *   - at most need - 1 dominators are in M already (need = the most non-locked players of this position a
 *     lineup can hold);
 *   - the team rules block at most `b` whole teams: the quarterback's team and the team he faces while a D73 stack
 *     count binds (1 each, since a player from either changes the counts), the other backs' teams (2) and games
 *     (4 teams), the defense's opponent (1), teams at the per-team cap (8 / cap), and the one game the rest of M
 *     might sit in (2). For a defense: the teams of M's
 *     eight offensive players (8), the game (2), the per-team cap. D76: the per-team cap never blocks the
 *     quarterback's team or the team he faces, so it blocks only other teams, each holding `cap` of M's eight
 *     others; 8 / cap still bounds them, and a replacement from an exempt team is fine for the cap (any stack
 *     effect is already counted above). Cash mode job 1, 2026-10-17: with capAllTeams every team is capped, the
 *     quarterback's included; a team at the cap still holds `cap` of M's eight others, so 8 / cap stays a valid
 *     bound, and with the stacks and roster rules off the stack and rule terms (and the stack-counted guard) drop to 0.
 *   A dominator from p's OWN team keeps every team rule and both stack counts exactly as they were (every back,
 *   receiver and tight end counts alike, D55 as amended 2026-10-17), so `need` same-team dominators are always
 *   enough. Cross-team dominators are not used for a quarterback (his team decides the stack) or for a player who
 *   may count toward the stack (taking him out would change the count). A dominator in an
 *   earlier lineup could make M - p + q a repeat, so only unused players count. The test file checks that
 *   trimming never changes the answer.
 *   Per-QB entries (qb-stacks.js): marked players and entry QBs are never dropped or used as replacements; their teams are guarded as stack teams.
 */
function trimPosition(list, pos, st, opts, prev) {
  if (list.length <= 1) return list;
  const rules = opts.rules;
  const countRules = st.countRules?.length > 0;
  const need = Math.max(1, MAX_AT[pos] - st.locksAt[pos]);
  const perTeamCap = opts.maxPerTeam ? Math.floor(8 / opts.maxPerTeam) : 0;
  const globalOwn = ownStackActive(opts);
  const globalOpp = oppStackActive(opts);
  const ownActive = globalOwn || st.entryOwnTeams.size > 0;
  const oppActive = globalOpp || st.entryOppTeams.size > 0;
  let b;
  if (pos === "QB") b = Infinity;
  else if (pos === "DST") b = (rules.noDstVsOwnPlayers ? 8 : 0) + 2 + perTeamCap;
  else {
    // D73: a replacement from the quarterback's team or the team he faces could change the stack counts.
    b = (ownActive ? 1 : 0) + (oppActive ? 1 : 0) + (rules.noDstVsOwnPlayers ? 1 : 0) + 2 + perTeamCap;
    if (pos === "RB") {
      b += (rules.noSameTeamRbs ? 2 : 0) + (rules.noSameGameRbs ? 4 : 0);
    }
  }
  const fixed = (c) => st.protectedKeys.has(c.key) || (pos === "QB" && c.rule);
  const usable = list.filter((q) => !prev.usedKeys.has(q.key) && !fixed(q));
  const kept = [];
  for (const p of list) {
    if (fixed(p)) {
      kept.push(p);
      continue;
    }
    const entryOwn = st.entryOwnTeams.has(p.teamIx);
    let sameTeam = 0;
    let total = 0;
    const byTeam = new Map();
    for (const q of usable) {
      if (q === p) continue;
      // D76: a quarterback's game decides which teams the per-team cap skips, so his dominator must face the same team.
      if (pos === "QB" && q.oppIx !== p.oppIx) continue;
      if (q.salary > p.salary || q.score < p.score) continue;
      if (q.salary === p.salary && q.score === p.score && cmpId(q.id, p.id) >= 0) continue;
      if (countRules && q.crSig !== p.crSig) continue; // a swap must leave every team, game and ownership count as it was
      total++;
      if (q.teamIx === p.teamIx) sameTeam++;
      byTeam.set(q.teamIx, (byTeam.get(q.teamIx) ?? 0) + 1);
    }
    if (sameTeam >= need) continue; // same-team replacement: always safe
    // A player who may count toward the stack (a back, receiver or tight end of a possible quarterback's team, or any offensive
    // player of a team a possible quarterback faces) is only ever replaced from his own team.
    const stackCounted = (p.stackOk && ((globalOwn && st.qbTeams.has(p.teamIx)) || entryOwn))
      || (globalOpp && st.qbOppTeams.has(p.teamIx)) || st.entryOppTeams.has(p.teamIx);
    if (b !== Infinity && !stackCounted && total >= need) {
      const counts = [...byTeam.values()].sort((x, y) => y - x);
      let blocked = 0;
      for (let i = 0; i < Math.min(b, counts.length); i++) blocked += counts[i];
      if (total - blocked >= need) continue;
    }
    kept.push(p);
  }
  return kept;
}

// --------------------------------------------------------------------------------------------------------
// Search
// --------------------------------------------------------------------------------------------------------

const defenseBans = (rules, dstOpp, c) => rules.noDstVsOwnPlayers && dstOpp >= 0 && c.teamIx === dstOpp;

function searchOne(st, avail, prev, opts, nodeLimit) {
  const rules = st.rules;
  const T = Math.max(1, st.teamCount);
  const G = Math.max(1, st.gameCount);
  const teamN = new Int16Array(T);
  const offN = new Int16Array(T);
  const rbTeamN = new Int16Array(T);
  const rbGameN = new Int16Array(G);
  const gameN = new Int16Array(G);
  const overlap = new Int16Array(Math.max(1, prev.capacity));
  const maxShare = SLOT_COUNT - st.minUnique;
  const maxPerTeam = st.maxPerTeam;
  const capAllTeams = st.capAllTeams === true;
  const allowRbGame = st.allowRbGame;
  // Team, game and ownership rules (count-rules.js): crN[r] = placed men in rule r's set. An at-most is refused in canAdd; an at-least is pruned
  // by countReachable and checked at the leaf, so every lineup served keeps every rule.
  const CR = st.countRules ?? [];
  const crN = new Int16Array(CR.length);
  const crLeast = CR.map((r, i) => (r.op === "atLeast" ? i : -1)).filter((i) => i >= 0);
  const placed = [];
  let games = 0;
  let qbTeam = -1;
  let qbOpp = -1;
  let dstOpp = -1;
  let mates = 0; // D73: offensive teammates of the quarterback (every back counts, D55 as amended 2026-10-17)
  let opps = 0; // D73: offensive players of the team the quarterback faces
  let nodes = 0;
  let aborted = false;
  let timedOut = false;
  const deadline = opts.deadline ?? Infinity; // epoch ms; only bestClassicExact sets one (the single Build's ten minute limit)

  // D73 stack: the global rule prepare() resolved once (st.global).
  const global = st.global;
  let rule = global;
  let must = null; // mustPlan of the placed quarterback's "must" players, set with his rule in setMates

  let bestScore = -Infinity;
  let bestSalary = Infinity;
  let best = null;

  function canAdd(c) {
    if (c.inRule) for (let r = 0; r < CR.length; r++) if (c.inRule[r] === 1 && CR[r].op === "atMost" && crN[r] >= CR[r].n) return false;
    // D76: Max per team skips the quarterback's team and the team he faces. Before he is placed (only locks: the QB
    // group is searched first) a team is not refused, since it may turn out to be his game; his own placement
    // below then checks every placed team outside his game, so the limit holds whatever the order.
    // Cash mode job 1, 2026-10-17: with capAllTeams every team is capped, the quarterback's and his opponent's included.
    if (maxPerTeam !== null && (capAllTeams || (c.pos !== "QB" && qbTeam !== -1 && c.teamIx !== qbTeam && c.teamIx !== qbOpp)) && teamN[c.teamIx] >= maxPerTeam) return false;
    if (c.pos !== "QB" && qbTeam !== -1 && rule.neverKeys.has(c.key)) return false;
    // A must player past his position's cap (availableLists) is in only the lineups of a quarterback whose rule names him.
    if (avail.overCap.has(c.key) && !(qbTeam !== -1 && rule.withKeys.includes(c.key))) return false;
    if (c.pos === "DST") {
      if (dstOpp !== -1) return false;
      if (rules.noDstVsOwnPlayers && c.oppIx >= 0 && offN[c.oppIx] > 0) return false;
    } else if (c.pos === "QB") {
      if (qbTeam !== -1) return false;
      let m = 0;
      let o = 0;
      const r = c.rule ?? global;
      for (const p of placed) {
        if (maxPerTeam !== null && p.teamIx !== c.teamIx && p.teamIx !== c.oppIx && teamN[p.teamIx] > maxPerTeam) return false;
        if (r.neverKeys.has(p.key)) return false;
        if (p.pos === "DST") {
          if (rules.noDstVsOwnPlayers && p.oppIx === c.teamIx) return false;
          continue;
        }
        if (p.stackOk && p.teamIx === c.teamIx) m++;
        if (c.oppIx >= 0 && p.teamIx === c.oppIx) o++;
      }
      if (m > r.capOwn || o > r.capOpp) return false;
    } else {
      if (qbTeam !== -1) {
        if (c.stackOk && c.teamIx === qbTeam && mates >= rule.capOwn) return false;
        if (c.teamIx === qbOpp && opps >= rule.capOpp) return false;
      }
      if (defenseBans(rules, dstOpp, c)) return false;
      if (c.pos === "RB") {
        if (rules.noSameTeamRbs && rbTeamN[c.teamIx] > 0) return false;
        if (rules.noSameGameRbs && rbGameN[c.gameIx] > 0 && !allowRbGame[c.gameIx]) return false;
      }
    }
    const pl = c.prevList;
    for (let i = 0; i < pl.length; i++) if (overlap[pl[i]] >= maxShare) return false;
    return true;
  }

  function add(c) {
    placed.push(c);
    if (c.inRule) for (let r = 0; r < CR.length; r++) crN[r] += c.inRule[r];
    teamN[c.teamIx]++;
    if (gameN[c.gameIx]++ === 0) games++;
    if (c.pos === "DST") dstOpp = c.oppIx;
    else {
      offN[c.teamIx]++;
      if (c.pos === "QB") {
        qbTeam = c.teamIx;
        qbOpp = c.oppIx;
        rule = c.rule ?? global;
        mates = 0;
        opps = 0;
        for (const p of placed) {
          if (p === c || p.pos === "DST") continue;
          if (p.stackOk && p.teamIx === qbTeam) mates++;
          if (qbOpp >= 0 && p.teamIx === qbOpp) opps++;
        }
      } else {
        if (c.pos === "RB") {
          rbTeamN[c.teamIx]++;
          rbGameN[c.gameIx]++;
        }
        if (c.teamIx === qbTeam && c.stackOk) mates++;
        if (qbOpp >= 0 && c.teamIx === qbOpp) opps++;
      }
    }
    const pl = c.prevList;
    for (let i = 0; i < pl.length; i++) overlap[pl[i]]++;
  }

  function remove(c) {
    placed.pop();
    if (c.inRule) for (let r = 0; r < CR.length; r++) crN[r] -= c.inRule[r];
    teamN[c.teamIx]--;
    if (--gameN[c.gameIx] === 0) games--;
    if (c.pos === "DST") dstOpp = -1;
    else {
      offN[c.teamIx]--;
      if (c.pos === "QB") {
        qbTeam = -1;
        qbOpp = -1;
        rule = global;
        mates = 0;
        opps = 0;
      } else {
        if (c.pos === "RB") {
          rbTeamN[c.teamIx]--;
          rbGameN[c.gameIx]--;
        }
        if (c.teamIx === qbTeam && c.stackOk) mates--;
        if (qbOpp >= 0 && c.teamIx === qbOpp) opps--;
      }
    }
    const pl = c.prevList;
    for (let i = 0; i < pl.length; i++) overlap[pl[i]]--;
  }

  // Locks first, quarterback before the rest so every later check knows his team.
  const locks = [...st.lockCands].sort((a, b) => (a.pos === "QB" ? 0 : 1) - (b.pos === "QB" ? 0 : 1));
  for (const c of locks) {
    if (!canAdd(c)) return { best: null, nodes, aborted, lockClash: true };
    add(c);
  }
  const lockScore = st.lockCands.reduce((s, c) => s + c.score, 0);
  const rem0 = st.cap - st.lockSalary;

  // Order the position mixes by their root bound, so the best mix sets a strong incumbent first. The bounds are read from this lineup's
  // own lists: the caps and the trim have taken players out, so tables on them are lower and still upper bounds. (Above MAX_REBUILD_SALARY_STEPS the prepare()
  // tables stand, still upper bounds: a table that fine costs more than it saves.)
  const configs = (st.S <= MAX_REBUILD_SALARY_STEPS ? configTables(avail, st) : st.configs)
    .map((cfg) => ({ cfg, root: cfg.suffix[0][st.units(rem0)] }))
    .filter((x) => x.root > -Infinity)
    .sort((a, b) => b.root - a.root || a.cfg.index - b.cfg.index)
    .map((x) => x.cfg);

  for (const cfg of configs) {
    const groups = cfg.groups;
    const lists = groups.map((g) => avail[g.pos]);
    const R = cfg.R;
    const suffix = cfg.suffix;
    const cfgLag = cfg.lag ?? [];
    // D73 pruning: for the quarterback in place, mateSuf[h][j] / oppSuf[h][j] count the players of group h from
    // index j on who would count as a teammate / an opponent, so a branch that cannot reach N and O is cut.
    const mateSuf = lists.map((list) => new Int32Array(list.length + 1));
    const oppSuf = lists.map((list) => new Int32Array(list.length + 1));
    const stackBinds = st.perQb || global.needOwn > 0 || global.needOpp > 0;
    const idxOf = st.perQb ? lists.map((list) => new Map(list.map((c, i) => [c.key, i]))) : null;
    const mustCnt = new Int32Array(groups.length);
    // At-least rules: crSuf[q][h][j] counts the men of group h from index j on who are in the q-th at-least rule's set.
    const crSuf = crLeast.map((r) => lists.map((list) => {
      const out = new Int32Array(list.length + 1);
      for (let j = list.length - 1; j >= 0; j--) out[j] = out[j + 1] + list[j].inRule[r];
      return out;
    }));
    /** False when the slots left (kRem in group gi from `start`, then every later group) cannot reach an at-least rule's count. */
    const countReachable = (gi, kRem, start) => {
      for (let q = 0; q < crLeast.length; q++) {
        const want = CR[crLeast[q]].n - crN[crLeast[q]];
        if (want <= 0) continue;
        let can = 0;
        for (let h = gi; h < groups.length && can < want; h++) can += Math.min(h === gi ? kRem : groups[h].need, crSuf[q][h][h === gi ? start : 0]);
        if (can < want) return false;
      }
      return true;
    };
    const setMates = () => {
      if (!stackBinds) return;
      for (let h = 0; h < groups.length; h++) {
        const list = lists[h];
        const ms = mateSuf[h];
        const os = oppSuf[h];
        ms[list.length] = 0;
        os[list.length] = 0;
        for (let j = list.length - 1; j >= 0; j--) {
          const c = list[j];
          // A placed defense bans the team it faces (D55), so those players can never count toward the stack.
          const off = c.pos !== "DST" && c.pos !== "QB" && !defenseBans(rules, dstOpp, c);
          ms[j] = ms[j + 1] + (off && c.stackOk && c.teamIx === qbTeam ? 1 : 0);
          os[j] = os[j + 1] + (off && qbOpp >= 0 && c.teamIx === qbOpp ? 1 : 0);
        }
      }
      if (rule.withKeys.length) must = mustPlan(rule.withKeys, placed, groups, idxOf, st.candByKey);
    };
    if (qbTeam !== -1) setMates();
    /** False when the slots left (kRem in group gi from `start`, then every later group) cannot hold the
     *  teammates and opponents still needed. */
    const stackReachable = (gi, kRem, start) => {
      if (rule.withKeys.length && !withReachable(must, placed, groups, gi, kRem, start, mustCnt, canAdd)) return false;
      const wantOwn = rule.needOwn - mates;
      const wantOpp = rule.needOpp - opps;
      if (wantOwn <= 0 && wantOpp <= 0) return true;
      let canOwn = 0;
      let canOpp = 0;
      let canBoth = 0;
      for (let h = gi; h < groups.length; h++) {
        const from = h === gi ? start : 0;
        const k = h === gi ? kRem : groups[h].need;
        const m = mateSuf[h][from];
        const o = oppSuf[h][from];
        canOwn += Math.min(k, m);
        canOpp += Math.min(k, o);
        canBoth += Math.min(k, m + o);
      }
      return canOwn >= wantOwn && canOpp >= wantOpp && canBoth >= Math.max(0, wantOwn) + Math.max(0, wantOpp);
    };

    const leaf = (score, rem) => {
      if (games < 2 && !st.oneGameOk) return;
      if (mates < rule.needOwn || mates > rule.capOwn || opps < rule.needOpp || opps > rule.capOpp) return;
      if (rule.withKeys.length && !rule.withKeys.every((k) => placed.some((p) => p.key === k))) return;
      for (const r of crLeast) if (crN[r] < CR[r].n) return;
      const salary = st.cap - rem;
      if (score > bestScore || (score === bestScore && (salary < bestSalary || (salary === bestSalary && keyLess(placed, best))))) {
        bestScore = score;
        bestSalary = salary;
        best = placed.slice();
      }
    };

    const dfs = (gi, kRem, start, rem, score) => {
      if (nodes >= nodeLimit) {
        aborted = true; // only a quarterback pre-check's limit or a test's reaches this; the lineups' searches pass Infinity
        return;
      }
      if ((nodes & 4095) === 0 && Date.now() >= deadline) { // the clock is read every 4,096 nodes, never a step count
        aborted = true;
        timedOut = true;
        return;
      }
      nodes++;
      if (gi === groups.length) {
        leaf(score, rem);
        return;
      }
      if (stackBinds && qbTeam !== -1 && !stackReachable(gi, kRem, start)) return;
      if (crLeast.length && !countReachable(gi, kRem, start)) return;
      const list = lists[gi];
      const last = kRem === 1;
      const nextTable = last ? suffix[gi + 1] : R[gi][kRem - 1];
      let maxNext = nextTable[st.units(rem)];
      // Rule-aware bound: what is left must still bring `want` more men of the rule's set, and at least want - 1 of them after the man picked here (the weakest case, so it holds for every pick).
      for (let q = 0; q < cfgLag.length; q++) {
        const l = cfgLag[q];
        const want = CR[l.r].n - crN[l.r];
        if (want <= 0) continue;
        const b = (last ? l.suffix[gi + 1] : l.R[gi][kRem - 1])[st.units(rem)] - l.weight * Math.max(0, want - 1);
        if (b < maxNext) maxNext = b;
      }
      const isQbGroup = groups[gi].pos === "QB";
      const end = list.length - (kRem - 1);
      for (let j = start; j < end; j++) {
        const c = list[j];
        const s2 = score + c.score;
        // Projection-ordered: once this player cannot reach the incumbent, nobody further down can. A bound of
        // -Infinity means nothing completes the lineup within the budget at all.
        if (maxNext === -Infinity || s2 + maxNext < bestScore) break;
        if (c.salary > rem) continue;
        const r2 = rem - c.salary;
        let lim = nextTable[st.units(r2)];
        for (let q = 0; q < cfgLag.length; q++) {
          const l = cfgLag[q];
          const want = CR[l.r].n - crN[l.r];
          if (want <= 0) continue;
          const b = (last ? l.suffix[gi + 1] : l.R[gi][kRem - 1])[st.units(r2)] - l.weight * Math.max(0, want - c.inRule[l.r]);
          if (b < lim) lim = b;
        }
        if (lim === -Infinity || s2 + lim < bestScore) continue;
        if (!canAdd(c)) continue;
        add(c);
        if (isQbGroup) setMates();
        if (last) dfs(gi + 1, gi + 1 < groups.length ? groups[gi + 1].need : 0, 0, r2, s2);
        else dfs(gi, kRem - 1, j + 1, r2, s2);
        remove(c);
        if (aborted) return;
      }
    };

    dfs(0, groups.length ? groups[0].need : 0, 0, rem0, lockScore);
    if (aborted) break;
  }
  return { best, nodes, aborted, timedOut };
}

/** True when the sorted ids of `a` come before those of `b` (the last tie-break). */
function keyLess(a, b) {
  if (!b) return true;
  const x = a.map((c) => c.id).sort(cmpId);
  const y = b.map((c) => c.id).sort(cmpId);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = cmpId(x[i], y[i]);
    if (d) return d < 0;
  }
  return x.length < y.length;
}

export { configTables, cmpCand, playerCapsByKey, makePrevIndex, addPrev, availableLists, searchOne, defenseBans };
