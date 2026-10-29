// Lineup rules (Adam 2026-10-18, D81): "if player X is Captain, at most 1 of these players", "if the lineup has X it
// must include at least 1 of these". Rules are hard and never bend. Pure and browser-safe: no imports, no I/O.
// Seat-based so classic can adopt it (D81): a host passes its scopes (Showdown cpt/flex/any; classic any only).
// Shape: { id, on, if: null | {who, where, match:"any"|"all"}, then: {who, where, op:"atLeast"|"atMost"|"exactly", n} }.

export const MAX_RULES = 30;
export const MAX_LIST = 60;
export const MAX_PEOPLE = 60; // distinct players across all rules
export const MAX_RULES_CHARS = 100000; // the raw list as JSON; 30 full rules are about 45,000
const OPS = ["atLeast", "atMost", "exactly"];
const OP_WORD = { atLeast: "at least", atMost: "at most", exactly: "exactly" };
const SEAT_WORD = { cpt: "Captain", flex: "FLEX", any: "the lineup" };
const FIELDS = { rule: ["id", "on", "if", "then"], if: ["who", "where", "match"], then: ["who", "where", "op", "n"] };

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (error) => ({ error });
const unknownField = (obj, allowed) => Object.keys(obj).find((k) => !allowed.includes(k)) ?? null;
const within = (seatWhere, scope) => scope === "any" || scope === seatWhere;
const personOf = (x) => String(x !== null && typeof x === "object" ? x.personId : x);
const plural = (k, one, many) => (k === 1 ? one : many);

function seatCap(ctx, where) {
  const m = ctx.seatMax?.[where];
  return Number.isInteger(m) ? m : ctx.maxSeats;
}

/** Captain and FLEX seat counts; a host with no Captain seat (classic) has only FLEX-like seats. */
function seatCounts(ctx) {
  const cpt = Number.isInteger(ctx.seatMax?.cpt) ? ctx.seatMax.cpt : 0;
  const flex = Number.isInteger(ctx.seatMax?.flex) ? ctx.seatMax.flex : seatCap(ctx, "any") - cpt;
  return { cpt, flex };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

function readList(raw, N, part, ctx) {
  const label = `Rule ${N}'s ${part} list`;
  if (!Array.isArray(raw) || raw.length === 0) return fail(`${label} is empty.`);
  if (raw.length > MAX_LIST) return fail(`${label} has ${raw.length} players; at most ${MAX_LIST} are allowed.`);
  const who = [];
  for (const id of raw) {
    const usable = typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
    const person = usable ? ctx.resolvePerson(String(id)) : null;
    if (person === null || person === undefined || person === "") {
      return fail(`Rule ${N} names a player who is not on the board: ${String(id)}.`);
    }
    if (!who.includes(String(person))) who.push(String(person));
  }
  return { who };
}

function readSeat(raw, N, part, ctx) {
  if (raw === undefined || raw === null) return fail(`Rule ${N}'s ${part} needs a seat: ${ctx.scopes.join(", ")}.`);
  if (!ctx.scopes.includes(raw)) return fail(`Rule ${N} uses a seat this slate does not allow: ${String(raw)}.`);
  return { where: raw };
}

function readIf(raw, N, ctx) {
  if (raw === null || raw === undefined) return { cond: null };
  if (!isObj(raw)) return fail(`Rule ${N}'s IF must be a condition or empty.`);
  const extra = unknownField(raw, FIELDS.if);
  if (extra !== null) return fail(`Rule ${N}'s IF has an unknown field: ${extra}.`);
  const list = readList(raw.who, N, "IF", ctx);
  if (list.error) return list;
  const seat = readSeat(raw.where, N, "IF", ctx);
  if (seat.error) return seat;
  const match = raw.match ?? "any";
  if (match !== "any" && match !== "all") return fail(`Rule ${N}'s IF must match any or all of its players.`);
  return { cond: { who: list.who, where: seat.where, match } };
}

function readThen(raw, N, ctx) {
  if (raw === null || raw === undefined) return fail(`Rule ${N} has no THEN part.`);
  if (!isObj(raw)) return fail(`Rule ${N}'s THEN must be a count of players.`);
  const extra = unknownField(raw, FIELDS.then);
  if (extra !== null) return fail(`Rule ${N}'s THEN has an unknown field: ${extra}.`);
  const list = readList(raw.who, N, "THEN", ctx);
  if (list.error) return list;
  const seat = readSeat(raw.where, N, "THEN", ctx);
  if (seat.error) return seat;
  const { op, n } = raw;
  if (!OPS.includes(op)) return fail(`Rule ${N}'s THEN must say at least, at most or exactly.`);
  const cap = seatCap(ctx, seat.where);
  if (!Number.isInteger(n) || n < 0 || n > cap) {
    return fail(`Rule ${N}'s number must be a whole number from 0 to ${cap} for ${SEAT_WORD[seat.where]}: ${String(n)}.`);
  }
  if (op !== "atMost" && n > list.who.length) {
    const size = list.who.length;
    return fail(`Rule ${N} asks for ${OP_WORD[op]} ${n} of a list of ${size} ${plural(size, "player", "players")}.`);
  }
  return { then: { who: list.who, where: seat.where, op, n } };
}

function readRule(raw, N, ctx) {
  if (!isObj(raw)) return fail(`Rule ${N} is not a rule.`);
  const extra = unknownField(raw, FIELDS.rule);
  if (extra !== null) return fail(`Rule ${N} has an unknown field: ${extra}.`);
  const id = raw.id ?? String(N);
  if (typeof id !== "string" && !(typeof id === "number" && Number.isFinite(id))) {
    return fail(`Rule ${N}'s id must be text or a number.`);
  }
  const on = raw.on ?? true;
  if (typeof on !== "boolean") return fail(`Rule ${N}'s on must be true or false.`);
  const cond = readIf(raw.if, N, ctx);
  if (cond.error) return cond;
  const then = readThen(raw.then, N, ctx);
  if (then.error) return then;
  const clash = cond.cond ? then.then.who.find((p) => cond.cond.who.includes(p)) : undefined;
  if (clash !== undefined) {
    const name = ctx.nameOf ? ctx.nameOf(clash) : clash;
    return fail(`Rule ${N}'s THEN list includes ${name}, who is in its IF; remove him from the list.`);
  }
  return { rule: { id: String(id), on, if: cond.cond, then: then.then } };
}

/**
 * Checks raw rules at the boundary. ctx = { resolvePerson(id) -> personId|null, scopes, maxSeats, seatMax, nameOf? }.
 * Returns { rules, error }: the rules with ids resolved to person ids (deduplicated), or rules null and one sentence.
 */
export function validateLineupRules(raw, ctx) {
  if (raw === null || raw === undefined) return { rules: [], error: null };
  if (!Array.isArray(raw)) return { rules: null, error: "Lineup rules must be a list." };
  if (raw.length > MAX_RULES) {
    return { rules: null, error: `At most ${MAX_RULES} lineup rules are allowed; this list has ${raw.length}.` };
  }
  let chars;
  try {
    chars = JSON.stringify(raw).length;
  } catch (e) {
    return { rules: null, error: `The lineup rules could not be read: ${e && e.message ? e.message : "not plain data"}.` };
  }
  if (chars > MAX_RULES_CHARS) {
    return { rules: null, error: `The lineup rules are too large to read (${chars.toLocaleString("en-US")} characters; at most ${MAX_RULES_CHARS.toLocaleString("en-US")}).` };
  }
  const rules = [];
  const people = new Set();
  for (let i = 0; i < raw.length; i++) {
    const r = readRule(raw[i], i + 1, ctx);
    if (r.error) return { rules: null, error: r.error };
    rules.push(r.rule);
    for (const p of [...(r.rule.if?.who ?? []), ...r.rule.then.who]) people.add(p);
  }
  if (people.size > MAX_PEOPLE) {
    return { rules: null, error: `The lineup rules name ${people.size} different players; at most ${MAX_PEOPLE} are allowed.` };
  }
  return { rules, error: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Plain-English sentences
// ---------------------------------------------------------------------------------------------------------------

const nameList = (who, nameOf) => who.map((p) => (nameOf ? nameOf(p) : p)).join(", ");

function ifPhrase(cond, nameOf) {
  const one = cond.who.length === 1;
  const seat = cond.where === "cpt" ? "Captain" : `in ${SEAT_WORD[cond.where]}`;
  if (one) return `If ${nameList(cond.who, nameOf)} is ${seat}`;
  if (cond.match === "all") return `If all of ${nameList(cond.who, nameOf)} are ${seat}`;
  return `If any of ${nameList(cond.who, nameOf)} is ${seat}`;
}

function thenPhrase(then, nameOf) {
  const names = nameList(then.who, nameOf);
  const seatIs = then.where === "cpt" ? "Captain" : `in ${SEAT_WORD[then.where]}`;
  const suffix = then.where === "cpt" ? " as Captain" : then.where === "flex" ? " in FLEX" : "";
  const single = then.who.length === 1;
  if (then.n === 0 && then.op !== "atLeast") return single ? `${names} may not be ${seatIs}` : `none of ${names}${suffix}`;
  if (single && then.n === 1 && then.op !== "atMost") return `${names} must be ${seatIs}`;
  return `${OP_WORD[then.op]} ${then.n} of ${names}${suffix}`;
}

/** One plain-English sentence for a validated rule; nameOf(personId) gives the display name. */
export function ruleSentence(rule, nameOf) {
  const then = thenPhrase(rule.then, nameOf);
  if (rule.if) return `${ifPhrase(rule.if, nameOf)}, ${then}.`;
  return `${then.charAt(0).toUpperCase()}${then.slice(1)}.`;
}

const quote = (rule, nameOf) => ruleSentence(rule, nameOf).replace(/\.$/, "");

// ---------------------------------------------------------------------------------------------------------------
// Static contradictions: problems visible before any search
// ---------------------------------------------------------------------------------------------------------------

/** Can `a` IF men in ifScope and `n` THEN men in thenScope (different people) all be seated at once? */
function fits(a, ifScope, n, thenScope, seats) {
  for (let x = 0; x <= Math.min(a, seats.cpt); x++) {
    for (let y = 0; y <= Math.min(n, seats.cpt); y++) {
      if ((ifScope === "cpt" && x !== a) || (ifScope === "flex" && x !== 0)) continue;
      if ((thenScope === "cpt" && y !== n) || (thenScope === "flex" && y !== 0)) continue;
      if (x + y <= seats.cpt && a - x + (n - y) <= seats.flex) return true;
    }
  }
  return false;
}

function selfImpossible(rule, N, ctx, nameOf) {
  const { then } = rule;
  if (then.op === "atMost" || then.n === 0) return null;
  const seats = seatCounts(ctx);
  const a = rule.if ? (rule.if.match === "all" ? rule.if.who.length : 1) : 0;
  const ifScope = rule.if ? rule.if.where : "any";
  if (!fits(a, ifScope, 0, "any", seats)) return null; // its IF can never hold, so it never applies
  if (fits(a, ifScope, then.n, then.where, seats)) return null;
  const why = rule.if ? "once its IF holds, the lineup has no seats left for it" : "the lineup has too few seats for it";
  return `Rule ${N} (${quote(rule, nameOf)}) can never be met: ${why}.`;
}

const ifKey = (cond) =>
  cond ? `${cond.where}|${cond.who.length === 1 ? "any" : cond.match}|${[...cond.who].sort().join(",")}` : "-";

/** p needs at least a of its list, q allows at most b of its list: they clash when a > b + |p∖q| (review of R1). */
function pairClash(p, q) {
  if (p.then.op === "atMost" || q.then.op === "atLeast") return false;
  if (q.then.where !== "any" && q.then.where !== p.then.where) return false;
  const outside = p.then.who.filter((x) => !q.then.who.includes(x)).length;
  return p.then.n > q.then.n + outside;
}

function pairSentences(live, nameOf) {
  const out = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const [A, B] = [live[i], live[j]];
      if (ifKey(A.rule.if) !== ifKey(B.rule.if)) continue;
      const pair = pairClash(A.rule, B.rule) ? [A, B] : pairClash(B.rule, A.rule) ? [B, A] : null;
      if (!pair) continue;
      const [p, q] = pair;
      out.push(`Rule ${p.N} and Rule ${q.N} cannot both hold: Rule ${p.N} needs ${thenPhrase(p.rule.then, nameOf)}, ` +
        `but Rule ${q.N} allows ${thenPhrase(q.rule.then, nameOf)}.`);
    }
  }
  return out;
}

function lockSentences(live, ctx, nameOf) {
  const lockedAt = new Map((ctx.locks ?? []).map((l) => [String(l.personId), l.where]));
  if (lockedAt.size === 0) return [];
  const seats = seatCounts(ctx);
  const used = { cpt: 0, flex: 0 };
  for (const where of lockedAt.values()) used[where === "cpt" ? "cpt" : "flex"]++;
  const free = { cpt: seats.cpt - used.cpt, flex: seats.flex - used.flex };
  free.any = free.cpt + free.flex;
  const seatedIn = (who, scope) => who.filter((p) => lockedAt.has(p) && within(lockedAt.get(p), scope));
  const out = [];
  for (const { rule, N } of live) {
    const { then } = rule;
    if (rule.if) {
      const hit = seatedIn(rule.if.who, rule.if.where).length;
      if (rule.if.match === "all" ? hit < rule.if.who.length : hit < 1) continue;
    }
    const locked = seatedIn(then.who, then.where);
    if (then.op !== "atLeast" && locked.length > then.n) {
      out.push(`The locks break Rule ${N} (${quote(rule, nameOf)}): ${nameList(locked, nameOf)} ` +
        `${plural(locked.length, "is", "are")} locked.`);
    } else if (then.op !== "atMost") {
      const open = then.who.filter((p) => !lockedAt.has(p)).length;
      const best = locked.length + Math.min(open, Math.max(0, free[then.where]));
      if (best < then.n) {
        out.push(`The locks make Rule ${N} (${quote(rule, nameOf)}) impossible: at most ${best} of its players ` +
          `can still be ${then.where === "cpt" ? "Captain" : `in ${SEAT_WORD[then.where]}`}.`);
      }
    }
  }
  return out;
}

function unavailableSentences(live, ctx, nameOf) {
  const out = [];
  const gone = ctx.unavailable ?? new Set();
  for (const { rule, N } of live) {
    const { then } = rule;
    if (then.op === "atMost" || gone.size === 0) continue;
    if (rule.if) {
      const left = rule.if.who.filter((p) => !gone.has(p)).length;
      if (rule.if.match === "all" ? left < rule.if.who.length : left === 0) continue; // its IF can never hold
    }
    const missing = then.who.filter((p) => gone.has(p));
    const left = then.who.length - missing.length;
    if (left >= then.n) continue;
    out.push(`Rule ${N} (${quote(rule, nameOf)}) cannot be met while ${nameList(missing, nameOf)} ` +
      `${plural(missing.length, "is", "are")} unavailable: only ${left} of its players ${plural(left, "is", "are")} left.`);
  }
  return out;
}

/** DraftKings needs a player from each team: unconditional at-most-0 rules must not shut a whole team out. */
function teamSentences(live, ctx) {
  if (ctx.teams === undefined || ctx.teams === null) return [];
  // Teams without teamOf and people would skip the check silently; a check whose input is missing fails instead.
  if (!Array.isArray(ctx.teams) || typeof ctx.teamOf !== "function" || !Array.isArray(ctx.people)) {
    throw new Error("The one-from-each-team check was given teams without teamOf and people.");
  }
  if (ctx.teams.length === 0) return [];
  const gone = ctx.unavailable ?? new Set();
  const bans = { any: new Map(), cpt: new Map(), flex: new Map() }; // personId -> rule numbers
  for (const { rule, N } of live) {
    if (rule.if || rule.then.n !== 0 || rule.then.op === "atLeast") continue;
    for (const p of rule.then.who) bans[rule.then.where].set(p, [...(bans[rule.then.where].get(p) ?? []), N]);
  }
  const banners = (p) =>
    bans.any.has(p) ? bans.any.get(p) : bans.cpt.has(p) && bans.flex.has(p) ? [...bans.cpt.get(p), ...bans.flex.get(p)] : null;
  const out = [];
  for (const team of ctx.teams) {
    const men = ctx.people.map(String).filter((p) => ctx.teamOf(p) === team && !gone.has(p));
    if (men.length === 0 || !men.every((p) => banners(p))) continue;
    const nums = [...new Set(men.flatMap(banners))].sort((a, b) => a - b);
    const who = nums.length === 1 ? `Rule ${nums[0]} keeps` : `Rules ${nums.slice(0, -1).join(", ")} and ${nums.at(-1)} together keep`;
    out.push(`${who} every available ${team} player out of the lineup, but a lineup needs a player from each team.`);
  }
  return out;
}

/**
 * Plain sentences for rule problems visible before any search. ctx is the validation ctx plus
 * { locks:[{personId, where}], unavailable:Set, teamOf(personId), teams, people:[personId], nameOf }.
 * The one-from-each-team check runs only when teams, teamOf and people are given (classic passes no teams).
 */
export function staticContradictions(rules, ctx) {
  const nameOf = ctx.nameOf;
  const live = rules.map((rule, i) => ({ rule, N: i + 1 })).filter(({ rule }) => rule.on !== false);
  // A rule whose IF can never fire is warned (ruleWarnings), never refused (review of R2).
  const checker = seatChecker(ctx);
  const firing = live.filter(({ rule }) => !rule.if || neverFiresWhy(rule, checker, nameOf) === null);
  const out = [];
  for (const { rule, N } of firing) {
    const s = selfImpossible(rule, N, ctx, nameOf);
    if (s) out.push(s);
  }
  out.push(...pairSentences(firing, nameOf), ...lockSentences(firing, ctx, nameOf), ...unavailableSentences(firing, ctx, nameOf));
  out.push(...onceFiredSentences(firing, ctx, checker, nameOf), ...teamSentences(live, ctx));
  return out;
}

const seatPhrase = (where) => (where === "cpt" ? "Captain" : `in ${SEAT_WORD[where]}`);

/** A conditional rule the locks do not fire yet: once its IF holds, can its THEN still be met in the seats the locks
 *  leave and that its men can take? If not, it would silently keep its IF men out (review of R2). A rule with no IF
 *  gets the same count of men who can take its seat, when lockSentences and unavailableSentences said nothing. */
function onceFiredSentences(firing, ctx, checker, nameOf) {
  const { canSit, lockedAt, free } = checker;
  const gone = ctx.unavailable ?? new Set();
  const lockedIn = (who, scope) => who.filter((p) => lockedAt.has(p) && within(lockedAt.get(p), scope));
  const out = [];
  for (const { rule, N } of firing) {
    if (selfImpossible(rule, N, ctx, nameOf) !== null) continue;
    const { then } = rule;
    if (!rule.if) {
      const locked = lockedIn(then.who, then.where).length;
      const unlocked = then.who.filter((p) => !lockedAt.has(p));
      if (then.op === "atMost" || locked >= then.n) continue;
      if (lockedAt.size && locked + Math.min(unlocked.length, Math.max(0, free[then.where])) < then.n) continue; // lockSentences
      if (then.who.filter((p) => !gone.has(p)).length < then.n) continue; // unavailableSentences
      const can = locked + unlocked.filter((p) => canSit(p, then.where)).length;
      if (can < then.n) out.push(`Rule ${N} (${quote(rule, nameOf)}) cannot be met: only ${can} of its players can be ${seatPhrase(then.where)}.`);
      continue;
    }
    const fired = lockedIn(rule.if.who, rule.if.where).length;
    if (rule.if.match === "all" ? fired === rule.if.who.length : fired >= 1) continue; // lockSentences
    const locked = lockedIn(then.who, then.where);
    let why = null;
    if (then.op !== "atLeast" && locked.length > then.n) {
      why = `the locked ${nameList(locked, nameOf)} ${plural(locked.length, "is", "are")} too many for it`;
    } else if (then.op !== "atMost" && then.n > locked.length && then.who.filter((p) => !gone.has(p)).length >= then.n) {
      const need = then.n - locked.length;
      const a = rule.if.match === "all" ? rule.if.who.filter((p) => !lockedAt.has(p)).length : 1;
      const open = then.who.filter((p) => !lockedAt.has(p) && canSit(p, then.where)).length;
      if (open < need) why = `only ${locked.length + open} of its players can be ${seatPhrase(then.where)}`;
      else if (!fits(a, rule.if.where, need, then.where, free)) why = "the lineup has no seats left for it";
    }
    if (why) out.push(`Rule ${N} (${quote(rule, nameOf)}) can never be met: once its IF holds, ${why}.`);
  }
  return out;
}

/** Can person p sit in `scope` at all, given what is unavailable, what is locked and which seats the locks leave? */
function seatChecker(ctx) {
  const gone = ctx.unavailable ?? new Set();
  const cannot = ctx.cannotSit ?? {};
  const lockedAt = new Map((ctx.locks ?? []).map((l) => [String(l.personId), l.where === "cpt" ? "cpt" : "flex"]));
  const seats = seatCounts(ctx);
  const free = { cpt: seats.cpt, flex: seats.flex };
  for (const where of lockedAt.values()) free[where]--;
  free.any = free.cpt + free.flex;
  const blocked = (p, w) => Boolean(cannot[w]?.has(p)) || free[w] <= 0;
  const canSit = (p, scope) => {
    if (gone.has(p)) return false;
    if (lockedAt.has(p)) return within(lockedAt.get(p), scope);
    return scope === "any" ? !(blocked(p, "cpt") && blocked(p, "flex")) : !blocked(p, scope);
  };
  return { canSit, lockedAt, free };
}

/** Warnings, never refusals (review of R1): "Rule N never applies" when its IF can never hold. staticContradictions'
 *  ctx, plus an optional cannotSit {cpt, flex} of person Sets for one seat. */
export function ruleWarnings(rules, ctx) {
  const nameOf = ctx.nameOf;
  const checker = seatChecker(ctx);
  const out = [];
  rules.forEach((rule, i) => {
    if (rule.on === false || !rule.if) return;
    const why = neverFiresWhy(rule, checker, nameOf);
    if (why) out.push(`Rule ${i + 1} never applies (${quote(rule, nameOf)}): ${why}.`);
  });
  return out;
}

/** Why a conditional rule's IF can never hold (seatChecker's answer), or null when it can. */
function neverFiresWhy(rule, { canSit, lockedAt, free }, nameOf) {
  const { who, where, match } = rule.if;
  const seatIs = seatPhrase(where);
  const cant = who.filter((p) => !canSit(p, where));
  const open = who.filter((p) => !lockedAt.has(p)).length;
  if (match !== "all" || who.length === 1) {
    if (cant.length < who.length) return null;
    return cant.length === 1 ? `${nameOf ? nameOf(cant[0]) : cant[0]} cannot be ${seatIs}` : `none of ${nameList(cant, nameOf)} can be ${seatIs}`;
  }
  if (cant.length) return `${nameList(cant, nameOf)} cannot be ${seatIs}`;
  if (open > free[where]) return `${who.length} players cannot all be ${seatIs} at once`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------------------------

/**
 * The independent from-scratch check (plain loops, nothing shared with the tracker): seats = [{personId, where}].
 * Returns one sentence per broken rule; an empty list means the lineup keeps every rule.
 */
export function rulesBroken(seats, rules, nameOf) {
  const out = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (rule.on === false) continue;
    if (rule.if) {
      let hit = 0;
      for (const s of seats) {
        if (rule.if.who.includes(String(s.personId)) && (rule.if.where === "any" || rule.if.where === s.where)) hit++;
      }
      if (rule.if.match === "all" ? hit !== rule.if.who.length : hit === 0) continue;
    }
    const got = [];
    for (const s of seats) {
      if (rule.then.who.includes(String(s.personId)) && (rule.then.where === "any" || rule.then.where === s.where)) {
        got.push(String(s.personId));
      }
    }
    const k = got.length;
    const { op, n } = rule.then;
    const ok = op === "atLeast" ? k >= n : op === "atMost" ? k <= n : op === "exactly" ? k === n : false;
    if (!ok) out.push(`Rule ${i + 1} (${quote(rule, nameOf)}): this lineup has ${k}${k ? ` (${nameList(got, nameOf)})` : ""}.`);
  }
  return out;
}

/**
 * Incremental counts for a branch-and-bound search. add/remove a seat {personId, where}. A rule is armed when its
 * IF holds (any: one IF man seated; all: every one). Along one branch IF counts only grow, so arming is one-way and
 * every cut below is sound. aheadCount(ruleIdx) -> {ifAhead, thenAhead} counts the men still ahead in the list.
 */
export function createRuleTracker(rules) {
  const live = [];
  const ifCount = new Int32Array(rules.length);
  const thenCount = new Int32Array(rules.length);
  const hits = new Map(); // personId -> [{ r, isIf, scope }]
  const note = (p, hit) => hits.set(p, [...(hits.get(p) ?? []), hit]);
  rules.forEach((rule, r) => {
    if (rule.on === false) return;
    live.push(r);
    if (rule.if) for (const p of rule.if.who) note(p, { r, isIf: true, scope: rule.if.where });
    for (const p of rule.then.who) note(p, { r, isIf: false, scope: rule.then.where });
  });
  const step = (seat, d) => {
    for (const h of hits.get(String(seat.personId)) ?? []) {
      if (within(seat.where, h.scope)) (h.isIf ? ifCount : thenCount)[h.r] += d;
    }
  };
  const armed = (r) => {
    const cond = rules[r].if;
    if (!cond) return true;
    return cond.match === "all" ? ifCount[r] === cond.who.length : ifCount[r] >= 1;
  };
  return {
    add: (seat) => step(seat, 1),
    remove: (seat) => step(seat, -1),
    violated() {
      return live.some((r) => rules[r].then.op !== "atLeast" && armed(r) && thenCount[r] > rules[r].then.n);
    },
    // An unarmed rule never cuts: its IF may never fire (dormant), and if it can it may still be met.
    // Valid only once the Captain is seated: aheadCount counts FLEX men ahead, so a Captain THEN could still be met.
    canStillMeet(slotsLeft, aheadCount) {
      for (const r of live) {
        const { op, n } = rules[r].then;
        if (op === "atMost" || thenCount[r] >= n || !armed(r)) continue;
        if (thenCount[r] + Math.min(slotsLeft, aheadCount(r).thenAhead) < n) return false;
      }
      return true;
    },
    leafOk() {
      for (const r of live) {
        if (!armed(r)) continue;
        const { op, n } = rules[r].then;
        const k = thenCount[r];
        if (op === "atLeast" ? k < n : op === "atMost" ? k > n : k !== n) return false;
      }
      return true;
    }
  };
}

/**
 * For a candidate list whose men would all sit in `where`: per rule, ifAhead[i] and thenAhead[i] count the IF and
 * THEN men at index i or later (arrays of length list.length + 1). List items are person ids or {personId}.
 * The list must be every candidate the search may still take, in its order; a filtered list undercounts and cuts wrongly.
 */
export function suffixCounts(list, rules, where) {
  const len = list.length;
  const people = list.map(personOf);
  return rules.map((rule) => {
    const ifAhead = new Int32Array(len + 1);
    const thenAhead = new Int32Array(len + 1);
    const ifSet = rule.if && within(where, rule.if.where) ? new Set(rule.if.who) : null;
    const thenSet = within(where, rule.then.where) ? new Set(rule.then.who) : null;
    for (let i = len - 1; i >= 0; i--) {
      ifAhead[i] = ifAhead[i + 1] + (ifSet?.has(people[i]) ? 1 : 0);
      thenAhead[i] = thenAhead[i + 1] + (thenSet?.has(people[i]) ? 1 : 0);
    }
    return { ifAhead, thenAhead };
  });
}
