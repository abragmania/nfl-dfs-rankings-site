// PROJECT.md Part 4 Optimizer (Min % and soft rules, Adam 2026-10-17). Pure and browser-safe (D69).

/** The most players of each position a classic lineup can hold (FLEX included). */
export const MAX_AT = Object.freeze({ QB: 1, RB: 3, WR: 4, TE: 2, DST: 1 });
/** The three position mixes the FLEX allows. Every legal lineup is exactly one of them. */
export const CONFIGS = Object.freeze([
  Object.freeze({ QB: 1, RB: 3, WR: 3, TE: 1, DST: 1 }),
  Object.freeze({ QB: 1, RB: 2, WR: 4, TE: 1, DST: 1 }),
  Object.freeze({ QB: 1, RB: 2, WR: 3, TE: 2, DST: 1 })
]);

// Least change first; locks, excludes, the cap and the step limits never bend.
export const BEND_ORDER = Object.freeze([
  "minForce", "playerMax", "posMax", "spreadDst", "minUnique", "qbStackEntry", "qbStackGlobal", "maxPerTeam", "rule", "starredQbOut", "avoidGames"
]);
export const RULE_BEND_ORDER = Object.freeze(["noSameTeamRbs", "noSameGameRbs", "noDstVsOwnPlayers", "starredQbOnly"]);

const POS = Object.freeze(["QB", "RB", "WR", "TE", "DST"]);
const FLEX = Object.freeze(["RB", "WR", "TE"]);
const cmpId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fits = (at) => CONFIGS.some((cfg) => POS.every((p) => (at[p] ?? 0) <= cfg[p]));

export function listNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The pace from behind, shifted by `phase` (0 to below 1 − n / count) so players at the same Min fall due in different
 *  lineups; the mustAppear loop test proves none under 100% is due in lineup 1, all are due by the last, none lags. */
export function mustAppear(countSoFar, index, n, count, phase = 0) {
  return countSoFar < Math.floor(((index + 1) * n) / count + phase);
}

export function slotsFull(locksAt, pos) {
  return !fits({ ...locksAt, [pos]: (locksAt[pos] ?? 0) + 1 });
}

export function lockedSlotWords(pos) {
  return `the ${pos} slot${pos === "QB" || pos === "DST" ? " is" : "s are"} locked`;
}

/** One entry per DK key (the larger Min wins, then the smaller id), n lowered to the tightest of its `limits`. */
export function minPlan(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const tight = (e.limits ?? []).reduce((t, l) => (l.n < t.n ? l : t), { n: e.asked, why: null });
    const p = { ...e, n: tight.n, why: tight.why };
    const had = byKey.get(e.key);
    if (!had || p.asked > had.asked || (p.asked === had.asked && cmpId(p.id, had.id) < 0)) byKey.set(e.key, p);
  }
  return [...byKey.values()].sort((a, b) => cmpId(a.id, b.id));
}

/** The least the locks, `chosen` and the cheapest fill of the slots left can cost (null: no mix fits, or none leaves
 *  open the places `reserve` keeps for the quarterback's stack, each side alone and both together: [{n, at: positions}]). */
export function fillCost(chosen, room, reserve = []) {
  const at = { ...room.locksAt };
  for (const p of chosen) at[p.pos] = (at[p.pos] ?? 0) + 1;
  const taken = new Set(chosen.map((p) => p.key));
  let best = null;
  for (const cfg of CONFIGS) {
    if (!POS.every((p) => (at[p] ?? 0) <= cfg[p])) continue;
    const open = (ps) => [...new Set(ps)].reduce((s, p) => s + cfg[p] - (at[p] ?? 0), 0);
    if (reserve.some((r) => open(r.at) < r.n) || open(reserve.flatMap((r) => r.at)) < reserve.reduce((s, r) => s + r.n, 0)) continue;
    let cost = room.lockSalary + chosen.reduce((s, p) => s + p.salary, 0);
    let filled = true;
    for (const pos of POS) {
      let need = cfg[pos] - (at[pos] ?? 0);
      for (const c of room.cheapest[pos] ?? []) {
        if (need === 0) break;
        if (taken.has(c.key)) continue;
        cost += c.salary;
        need--;
      }
      if (need > 0) filled = false;
    }
    if (filled && (best === null || cost < best)) best = cost;
  }
  return best;
}

/** The free places per position of each mix the locks allow. */
function freeMixes(locksAt) {
  return CONFIGS.filter((cfg) => POS.every((p) => (locksAt[p] ?? 0) <= cfg[p])).map((cfg) => POS.map((p) => cfg[p] - (locksAt[p] ?? 0)));
}

/** How far the Min players' remaining needs ({pos: [lineups each still needs]}, each capped at `left`) exceed what
 *  `left` lineups hold beside the locks; 0 when they fit. Under any locks a position's free places differ by at most
 *  one between the allowed mixes, so with capped needs only the totals matter: each position against its base places,
 *  and the FLEX positions' excess over base against the FLEX places the mixes give. `fixed`: one of the lineups is
 *  already held to that mix (its free places by position). */
export function slotShortfall(needsByPos, left, locksAt, fixed = null) {
  const total = (pos) => (needsByPos[pos] ?? []).reduce((s, n) => s + Math.min(Math.max(n, 0), left), 0);
  const mixes = freeMixes(locksAt);
  if (!mixes.length) return POS.reduce((s, p) => s + total(p), 0);
  const free = left - (fixed ? 1 : 0);
  const base = POS.map((_, i) => Math.min(...mixes.map((m) => m[i])));
  const top = POS.map((_, i) => Math.max(...mixes.map((m) => m[i])));
  const flexPlaces = Math.max(...mixes.map((m) => m.reduce((s, f, i) => s + f - base[i], 0)));
  let gap = 0;
  let over = 0;
  POS.forEach((pos, i) => {
    const extra = Math.max(0, total(pos) - free * base[i] - (fixed ? fixed[i] : 0));
    const room = free * (top[i] - base[i]);
    gap += Math.max(0, extra - room);
    over += Math.min(extra, room);
  });
  return gap + Math.max(0, over - free * flexPlaces);
}

/** Lineup `index`'s forced Min players: those behind pace or out of slack, the members of a clashing pair or of a
 *  one-per-lineup class (room.classes) that can no longer take turns, neediest first, then, least slack first, whoever
 *  the rest of the batch could not otherwise hold (slotShortfall), and last a player already past saving where room is
 *  left. Each only while fillCost fits under the cap, he breaks no pair rule (room.clash) with one already chosen, and
 *  holding him in this lineup leaves the batch no shorter of places; else he waits. `eased` keys (just bent out) are
 *  forced only once out of slack; `bentOut` keys are never forced again once past saving. room.stackNeed(set): the
 *  places the set's quarterback (locked or forced) still needs for his stack, kept open (fillCost); `why`: what empties a side,
 *  `side`: "own" or "opp". */
export function forcedSet(plan, counts, index, count, room, eased = new Set(), bentOut = new Set()) {
  const left = count - index;
  const open = [];
  for (const p of plan) {
    const had = counts.get(p.key) ?? 0;
    if (!p.out && had < p.n) open.push({ p, had, need: p.n - had, slack: left - (p.n - had) });
  }
  if (!open.length) return { ids: [], waits: [] };
  const may = (o) => (!eased.has(o.p.key) || o.slack <= 0) && !(o.slack < 0 && bentOut.has(o.p.key));
  const mixes = freeMixes(room.locksAt);
  const allNeeds = {};
  for (const o of open) (allNeeds[o.p.pos] ??= []).push(o.need);
  const holding = (set) => {
    const at = POS.map((pos) => set.filter((q) => q.pos === pos).length);
    const usable = mixes.filter((m) => m.every((f, i) => at[i] <= f));
    return usable.length ? Math.min(...usable.map((m) => slotShortfall(allNeeds, left, room.locksAt, m))) : Infinity;
  };
  const keepsRoom = (p) => holding([...chosen, p]) <= holding(chosen);
  open.sort((a, b) => a.slack - b.slack || a.p.score - b.p.score || cmpId(a.p.id, b.p.id));
  const live = open.filter((o) => o.slack >= 0);
  const chosen = [];
  const waits = [];
  const wait = (p, why) => {
    if (!waits.some((w) => w.key === p.key)) waits.push({ key: p.key, why });
  };
  const fits = (p) => {
    if (chosen.includes(p)) return false;
    const set = [...chosen, p];
    const reserve = room.stackNeed ? room.stackNeed(set) : [];
    const cost = fillCost(set, room, reserve);
    const plain = cost === null && reserve.length ? fillCost(set, room) : cost;
    if (plain !== null && plain > room.cap) {
      wait(p, "the salary cap left no room for him beside the locks and the other Min % players");
      return false;
    }
    if (cost === null) {
      if (plain === null) return false; // PROJECT.md Part 4 Optimizer: no reserve held him out (plain is only computed beside one)
      // PROJECT.md Part 4 Optimizer: an empty pool, the other Min players or the locks, whichever left his stack no place.
      const mine = p.pos === "QB" ? room.stackNeed([p]) : [];
      const empty = mine.find((r) => !r.at.length && !r.why);
      const own = empty ? `no running back, receiver or tight end of ${empty.side === "opp" ? "the team he faces" : "his team"} is left in the pool`
        : fillCost([p], room, mine) !== null ? "his own stack needed places the other Min % players had already taken" : "the locks left no room for the stack his settings need";
      wait(p, reserve.find((r) => r.why)?.why ?? (p.pos === "QB" ? own : "the stack places a locked or forced quarterback still needs left no room for him"));
      return false;
    }
    if (room.tooAlike && room.tooAlike(set.map((q) => q.key))) {
      wait(p, "holding him would have repeated an earlier lineup");
      return false;
    }
    const hit = room.clash ? chosen.map((q) => [q, room.clash(p, q)]).find(([, rule]) => rule) : null;
    if (hit) wait(p, `${hit[1]} kept him apart from ${hit[0].name}`);
    return !hit;
  };
  // Players who can never share a lineup must take turns: once together they need every lineup left, all of them are
  // due (live is neediest first, and the clash check lets only one in).
  const turnDue = new Set();
  for (let i = 0; room.clash && i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const [a, b] = [live[i], live[j]];
      if (left - (a.need + b.need) <= 0 && room.clash(a.p, b.p)) turnDue.add(a).add(b);
    }
  }
  const classes = new Map();
  for (const o of live) for (const c of room.classes ? room.classes(o.p) : []) classes.set(c, [...(classes.get(c) ?? []), o]);
  for (const members of classes.values()) {
    if (members.length > 1 && members.reduce((s, o) => s + o.need, 0) >= left) for (const o of members) turnDue.add(o);
  }
  // Each player's pace is shifted by his place among the Min players (by DK key), so equal Mins fall due apart.
  const byKey = [...plan].sort((a, b) => cmpId(a.key, b.key));
  const phase = (p) => (byKey.indexOf(p) / plan.length) * (1 - p.n / count);
  for (const o of live) {
    const behind = mustAppear(o.had, index, o.p.n, count, phase(o.p));
    if (may(o) && (o.slack === 0 || turnDue.has(o) || behind) && fits(o.p) && keepsRoom(o.p)) chosen.push(o.p);
  }
  const after = (extra) => {
    const needs = {};
    for (const o of open) (needs[o.p.pos] ??= []).push(o.need - (chosen.includes(o.p) || o.p === extra ? 1 : 0));
    return slotShortfall(needs, left - 1, room.locksAt);
  };
  for (let gap = after(null); gap > 0; gap = after(null)) {
    const next = live.find((o) => may(o) && !chosen.includes(o.p) && after(o.p) < gap && fits(o.p) && keepsRoom(o.p));
    if (!next) break;
    chosen.push(next.p);
  }
  const gap = after(null);
  for (const o of open) if (o.slack < 0 && may(o) && !chosen.includes(o.p) && after(o.p) <= gap && fits(o.p) && keepsRoom(o.p)) chosen.push(o.p);
  return { ids: chosen.map((p) => p.id), waits: waits.filter((w) => !chosen.some((p) => p.key === w.key)) };
}

export function lowestScoreFirst(ids, scoreOf) {
  const score = (id) => (typeof scoreOf(id) === "number" && Number.isFinite(scoreOf(id)) ? scoreOf(id) : 0);
  return [...ids].sort((a, b) => score(a) - score(b) || cmpId(a, b));
}

export function bendRank(trial) {
  const k = BEND_ORDER.indexOf(trial && trial.kind);
  if (k < 0) return Infinity;
  if (trial.kind !== "rule") return k * 10;
  const r = RULE_BEND_ORDER.indexOf(trial.rule);
  return r < 0 ? Infinity : k * 10 + r;
}

export function trialOrder(trials) {
  return trials.map((t, i) => [bendRank(t), i]).sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0])).map(([, i]) => i);
}

export function chooseBend(trials) {
  let best = null;
  let bestRank = Infinity;
  for (const t of Array.isArray(trials) ? trials : []) {
    if (!t || !t.found || t.unchecked) continue;
    const r = bendRank(t);
    if (r < bestRank) {
      best = t;
      bestRank = r;
    }
  }
  return best;
}

/** The bent lineup's label: the starred-quarterback cause is named when diagnosisSentence would name it. */
export function bendLabel(pick, trials) {
  const plain = pick.cause && (pick.cause.plainly || trials.filter((t) => t.found).length === 1);
  return plain ? `${pick.label} (${pick.cause.why}: ${pick.cause.names})` : pick.label;
}

/** The diagnosis's own lineup unless its run aborted; then the re-search's (`again`), which in the same fixed search
 *  order never ends worse when its limit is at least the trial's. */
export function settleBend(pick, again) {
  if (!pick.aborted || !again) return { players: pick.best, aborted: Boolean(pick.aborted) };
  if (again.best && again.limit >= pick.limit) return { players: again.best, aborted: Boolean(again.aborted) };
  return { players: pick.best, aborted: true };
}

export function bendTrials(s) {
  const trials = s.forced.map(({ id, name }) => ({ label: `the Min % on ${name}`, kind: "minForce", patch: {}, drop: id }));
  if (s.forced.length > 1) trials.push({ label: `the Min % players ${listNames(s.forced.map((f) => f.name))}`, kind: "minForce", patch: {}, dropAll: true });
  for (const r of s.rules) {
    const t = { label: `the rule "${r.label}"`, kind: r.cause ? "starredQbOut" : "rule", rule: r.key, patch: { rules: { ...s.baseRules, [r.key]: false } } };
    if (r.cause) t.cause = r.cause;
    trials.push(t);
  }
  for (const g of s.stacks) trials.push({ ...g, kind: "qbStackGlobal" });
  if (s.minUnique > 1) trials.push({ label: `minimum unique players (${s.minUnique})`, kind: "minUnique", patch: { minUnique: 1 } });
  // Adam 2026-10-18: each position cap is tried alone, so a bend relaxes only the one that blocks and never clears every
  // cap. s.posCaps: [{pos, label}], s.givenMax: the request's maxExposure.
  for (const { pos, label } of Array.isArray(s.posCaps) ? s.posCaps : []) {
    const rest = Object.fromEntries(Object.entries(s.givenMax ?? {}).filter(([k]) => k !== pos));
    trials.push({ label: `the ${pos} maximum exposure (${label})`, kind: "posMax", patch: { maxExposure: rest } });
  }
  if (s.spreadDst) trials.push({ label: "Spread defenses", kind: "spreadDst", patch: { spreadDst: false } });
  if (s.blocking.length > 6) {
    trials.push({ label: "the players' Max % settings", kind: "playerMax", patch: { playerMaxExposure: {} } });
  } else {
    for (const b of s.blocking) {
      const rest = Object.fromEntries(Object.entries(s.givenCaps).filter(([k]) => String(k).trim() !== b.id));
      trials.push({ label: `the Max % of ${b.pct}% on ${b.name}`, kind: "playerMax", patch: { playerMaxExposure: rest } });
    }
  }
  for (const e of s.entryTrials) trials.push({ ...e, kind: "qbStackEntry" });
  // Cash mode job 1, 2026-10-17: in cash (capAllTeams) the cap covers every team, so the label drops the D76 words.
  if (s.maxPerTeam !== null) trials.push({ label: `the limit of ${s.maxPerTeam} per team${s.capAllTeams ? "" : " (outside the quarterback's game)"}`, kind: "maxPerTeam", patch: { maxPerTeam: null } });
  if (s.avoidGames) trials.push({ label: "the games to avoid", kind: "avoidGames", patch: { avoidGames: [] } });
  if (s.locks) trials.push({ label: "the locks", kind: "locks", patch: { locks: s.pin ? [s.pin] : [] } });
  return trials;
}

export function diagnosisSentence(trials, { n, existingCount, perQb, capText }) {
  const found = trials.filter((t) => t.found).map((t) => t.label);
  const unchecked = trials.filter((t) => t.unchecked).map((t) => t.label);
  const uncheckedText = unchecked.length ? `; these could not be checked in time: ${unchecked.join("; ")}` : "";
  const starred = trials.find((t) => t.found && t.cause);
  if (starred && (starred.cause.plainly || found.length === 1)) return starred.cause.text; // another fix beside the rule keeps the usual sentence
  if (found.length) {
    return `no lineup keeps every setting; relaxing ${found.length === 1 ? "this one alone" : "any one of these alone"} would allow one: ${found.join("; ")}${uncheckedText}`;
  }
  if (unchecked.length) return `no lineup keeps every setting; no single setting was found to be the cause${uncheckedText}`;
  return `no lineup keeps every setting, and no single setting is the cause (the rules together, ${perQb ? "the per-quarterback stack settings, " : ""}the locks${n > 0 || existingCount > 0 ? ", the earlier lineups" : ""} and the ${capText} cap leave nothing legal)`;
}

export function percentNote(posPct, maxes, mins, asked, made) {
  if (made >= asked) return null;
  const players = [...maxes.map((p) => `${p.name} ${p.pct}%`), ...mins.map((p) => `${p.name} Min ${p.pct}%`)];
  const shown = players.length > 5 ? [...players.slice(0, 5), `${players.length - 5} more players`] : players;
  const all = [...Object.entries(posPct).map(([pos, p]) => `${pos} ${p}%`), ...shown];
  return all.length ? `The percentage caps (${all.join(", ")}) were sized for the ${asked} lineups asked for, not the ${made} made.` : null;
}

/** One closing note per Min % player short of his Min: a pool reason (`out`) always, the rest after a full batch. */
export function unmetMinNotes(plan, counts, { complete, bentKeys, waits }) {
  const out = [];
  for (const p of plan) {
    if ((counts.get(p.key) ?? 0) >= p.asked) continue;
    if (p.out) out.push(`${p.name}'s Min % was not met: ${p.out}.`);
    else if (!complete) continue;
    else if (p.why) out.push(`${p.name}'s Min % of ${p.pct} was not met: ${p.why}.`);
    else if (bentKeys.has(p.key)) out.push(`${p.name}'s Min % of ${p.pct} was not met: it was bent where a lineup could not hold him.`);
    else if (waits.has(p.key)) out.push(`${p.name}'s Min % of ${p.pct} was not met: ${waits.get(p.key)}.`);
    else out.push(`${p.name}'s Min % of ${p.pct} was not met: the locks, the salary cap and the other Min % players left no room for him.`);
  }
  return out;
}

/** A refusal when the Min players ({pos: [lineups each needs]}) cannot fit `count` lineups beside the locks: one
 *  position, the FLEX positions that carry Mins together, then the exact slotShortfall. */
export function minSlotProblem(needsByPos, locksAt, count) {
  const mixes = freeMixes(locksAt);
  const total = (pos) => (needsByPos[pos] ?? []).reduce((s, n) => s + n, 0);
  const places = (group) => count * Math.max(0, ...mixes.map((m) => group.reduce((s, p) => s + m[POS.indexOf(p)], 0)));
  for (const pos of POS) {
    if (total(pos) > places([pos])) return `The Min % settings at ${pos} need ${total(pos)} lineup slots but only ${places([pos])} fit`;
  }
  const flex = FLEX.filter((p) => total(p) > 0);
  const subsets = [[0, 1], [0, 2], [1, 2], [0, 1, 2]].map((ix) => ix.map((i) => flex[i])).filter((g) => g.every(Boolean));
  for (const group of subsets.reverse()) {
    const need = group.reduce((s, p) => s + total(p), 0);
    if (need > places(group)) return `The Min % settings at ${listNames(group)} (sharing the FLEX) need ${need} lineup slots but only ${places(group)} fit`;
  }
  const withMins = POS.filter((p) => total(p) > 0);
  if (slotShortfall(needsByPos, count, locksAt) > 0) return `The Min % settings at ${listNames(withMins)} cannot all fit in ${count} lineups beside the locks`;
  return null;
}
