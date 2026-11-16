// Count rules for the classic GPP Optimizer (Adam 11:24 AM to 1:03 PM 11-16, PROJECT.md Part 4 "Monday 11-16 orders" items 8 and 9; built the way NBA's
// settings panel does it: its Low-owned chips and its team and game limits). Each rule counts the men of one set in a lineup and asks for at least or at most N of them:
//   { kind: "team", team: "KC", op, n }            the men of one team (the defense is a man of his team)
//   { kind: "game", game: "KC@BUF", op, n }        the men of either team in one game
//   { kind: "own", side: "under"|"over", pct, op, n }   the men strictly under (or over) pct percent owned; a man with no ownership figure is in neither set (missing, never zero)
// op is "atLeast" or "atMost". All rules are hard and work together; every lineup must satisfy all of them. This is a different shape from lineup-rules.js (Showdown's
// IF/THEN rules over named player lists, at most 60 a list): a set here is a predicate over the pool, which can hold hundreds of men, so that module does not fit and is not copied.
// Pure and browser-safe: no imports, no I/O. The request check (generate-request.js), the engine (multi.js), the page (public/js/lineup-count-rules.js imports the chip text, the limits and
// validateCountRules from here, the app serving this file through server.js SHARED_SERVER_FILES and the site build copying it through tools/publish.mjs PAGE_MODULES_WITH_SERVER_IMPORTS)
// and the tests share this one copy.

export const MAX_OWN_RULES = 4; // NBA's four chips on one line
export const MAX_TEAM_GAME_RULES = 12;
export const LINEUP_SIZE = 9;
const OPS = Object.freeze(["atLeast", "atMost"]);
const SIDES = Object.freeze(["under", "over"]);
const FIELDS = Object.freeze({ team: ["kind", "team", "op", "n"], game: ["kind", "game", "op", "n"], own: ["kind", "side", "pct", "op", "n"] });

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const upper = (v) => (v === null || v === undefined ? "" : String(v).trim().toUpperCase());
const fail = (error) => ({ error });
const plural = (n, one, many) => (n === 1 ? one : many);
const joinAnd = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const pctText = (pct) => `${pct}%`;

/** True when the man (`{team, game, own}`) is in the rule's set. A man with no ownership figure is in no ownership set. */
export function inSet(rule, man) {
  if (rule.kind === "team") return upper(man.team) === rule.team;
  if (rule.kind === "game") return upper(man.game) === rule.game;
  const own = man.own;
  if (typeof own !== "number" || !Number.isFinite(own)) return false;
  return rule.side === "under" ? own < rule.pct : own > rule.pct;
}

/** The rule as a chip, as NBA draws it: "KC ≥ 2", "KC@BUF ≤ 3", "≥2 <5%", "≤1 >30%". */
export function ruleChip(rule) {
  const sign = rule.op === "atLeast" ? "≥" : "≤";
  if (rule.kind === "own") return `${sign}${rule.n} ${rule.side === "under" ? "<" : ">"}${pctText(rule.pct)}`;
  return `${rule.kind === "team" ? rule.team : rule.game} ${sign} ${rule.n}`;
}

/** The rule in words: "at least 2 players from KC", "at most 1 player over 30% owned". */
export function ruleWords(rule) {
  const amount = `${rule.op === "atLeast" ? "at least" : "at most"} ${rule.n} ${plural(rule.n, "player", "players")}`;
  if (rule.kind === "team") return `${amount} from ${rule.team}`;
  if (rule.kind === "game") return `${amount} from the ${rule.game.replace("@", " @ ")} game`;
  return `${amount} ${rule.side} ${pctText(rule.pct)} owned`;
}

/** Whose set the rule counts, for a shortfall sentence: "from KC", "under 5% owned". */
function setWords(rule) {
  if (rule.kind === "team") return `from ${rule.team}`;
  if (rule.kind === "game") return `from the ${rule.game.replace("@", " @ ")} game`;
  return `${rule.side} ${pctText(rule.pct)} owned`;
}

const keyOf = (r) => (r.kind === "own" ? `own|${r.side}|${r.pct}|${r.op}|${r.n}` : `${r.kind}|${r.kind === "team" ? r.team : r.game}|${r.op}`);

/** One raw rule checked: { rule } (canonical) or { error }. `N` is its place in the list, for the sentence. */
function readRule(raw, N, ctx) {
  if (!isObj(raw)) return fail(`Rule ${N} is not a rule.`);
  const kind = raw.kind;
  if (!FIELDS[kind]) return fail(`Rule ${N} must be a team, game or ownership rule.`);
  const extra = Object.keys(raw).find((k) => !FIELDS[kind].includes(k));
  if (extra !== undefined) return fail(`Rule ${N} has an unknown field: ${extra}.`);
  if (!OPS.includes(raw.op)) return fail(`Rule ${N} must say at least or at most.`);
  const lo = raw.op === "atLeast" ? 1 : kind === "own" ? 1 : 0;
  const hi = raw.op === "atLeast" || kind === "own" ? LINEUP_SIZE : LINEUP_SIZE - 1;
  if (!Number.isInteger(raw.n) || raw.n < lo || raw.n > hi) return fail(`Rule ${N}'s count is a whole number from ${lo} to ${hi}.`);
  const base = { kind, op: raw.op, n: raw.n };
  if (kind === "own") {
    if (!SIDES.includes(raw.side)) return fail(`Rule ${N} must say under or over.`);
    if (typeof raw.pct !== "number" || !Number.isFinite(raw.pct) || raw.pct < 0 || raw.pct > 100) return fail(`Rule ${N}'s ownership line is a percentage from 0 to 100.`);
    return { rule: { kind, side: raw.side, pct: raw.pct, op: raw.op, n: raw.n } };
  }
  const subject = upper(raw[kind]);
  if (kind === "team" && !/^[A-Z0-9]{2,4}$/.test(subject)) return fail(`Rule ${N} names a team that is not a team code: ${String(raw.team)}.`);
  if (kind === "game" && !/^[A-Z0-9]{2,4}@[A-Z0-9]{2,4}$/.test(subject)) return fail(`Rule ${N} names a game that is not a game such as "DET@ARI": ${String(raw.game)}.`);
  const known = kind === "team" ? ctx.teams : ctx.games;
  if (known && !known.has(subject)) return fail(`Rule ${N} names ${kind === "team" ? "a team" : "a game"} that is not on this slate: ${subject}.`);
  return { rule: { ...base, [kind]: subject } };
}

/** The sets a rule's set sits inside: a team in its game, an under line below a higher one, an over line above a lower one. True when every man of `a` is also in `b`. */
function contained(a, b) {
  if (a.kind === "team" && b.kind === "team") return a.team === b.team;
  if (a.kind === "game" && b.kind === "game") return a.game === b.game;
  if (a.kind === "team" && b.kind === "game") return b.game.split("@").includes(a.team);
  if (a.kind === "own" && b.kind === "own" && a.side === b.side) return a.side === "under" ? a.pct <= b.pct : a.pct >= b.pct;
  return false;
}

/** True when no man can be in both sets: two teams, two games, a team and a game it is not in, an under line and an over line at or above it. */
function disjoint(a, b) {
  if (a.kind === "team" && b.kind === "team") return a.team !== b.team;
  if (a.kind === "game" && b.kind === "game") return a.game !== b.game;
  if (a.kind === "team" && b.kind === "game") return !b.game.split("@").includes(a.team);
  if (a.kind === "game" && b.kind === "team") return disjoint(b, a);
  if (a.kind === "own" && b.kind === "own" && a.side !== b.side) {
    const [under, over] = a.side === "under" ? [a, b] : [b, a];
    return over.pct >= under.pct;
  }
  return false;
}

/** The first group of at-least rules whose sets cannot overlap and that ask for more men between them than a lineup holds, or null. */
function overbooked(rules) {
  const least = rules.filter((r) => r.op === "atLeast");
  const walk = (from, chosen, sum) => {
    if (chosen.length > 1 && sum > LINEUP_SIZE) return chosen;
    for (let i = from; i < least.length; i++) {
      if (!chosen.every((c) => disjoint(c, least[i]))) continue;
      const found = walk(i + 1, [...chosen, least[i]], sum + least[i].n);
      if (found) return found;
    }
    return null;
  };
  return walk(0, [], 0);
}

/**
 * A sentence when the rules cannot all be met whatever the pool, else null: an at-least on a set that sits inside another set with a smaller at-most, or at-least rules over sets that
 * cannot overlap (two games, a team and a game it is not in, under 5% and over 5%) asking for more than the nine a lineup holds between them.
 */
export function contradiction(rules) {
  for (const a of rules) {
    for (const b of rules) {
      if (a.op === "atLeast" && b.op === "atMost" && a.n > b.n && contained(a, b)) return `"${ruleWords(a)}" and "${ruleWords(b)}" cannot both be met.`;
    }
  }
  const group = overbooked(rules);
  if (group) return `${joinAnd(group.map((r) => `"${ruleWords(r)}"`))} ask for ${group.reduce((s, r) => s + r.n, 0)} players between them from sets that cannot overlap, and a lineup has ${LINEUP_SIZE}.`;
  return null;
}

/**
 * Checks raw rules at the boundary. `ctx`: { teams, games } as Sets of upper-case codes to hold the rules to the slate (absent: the codes are only checked for shape).
 * Returns { rules } (canonical, in the order given) or { error } with one plain sentence. At most MAX_OWN_RULES ownership rules and MAX_TEAM_GAME_RULES team and game rules;
 * a duplicate is refused; a team or game takes one at-least and one at-most.
 */
export function validateCountRules(raw, ctx = {}) {
  if (raw === undefined || raw === null) return { rules: [] };
  if (!Array.isArray(raw)) return fail("countRules must be a list of rules.");
  if (raw.length > MAX_OWN_RULES + MAX_TEAM_GAME_RULES) return fail(`At most ${MAX_OWN_RULES + MAX_TEAM_GAME_RULES} team, game and ownership rules work together; this list has ${raw.length}.`);
  const rules = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const read = readRule(raw[i], i + 1, ctx);
    if (read.error) return read;
    const key = keyOf(read.rule);
    if (seen.has(key)) return fail(read.rule.kind === "own" ? `The rule ${ruleChip(read.rule)} is already on.` : `${read.rule.kind === "team" ? read.rule.team : read.rule.game} already has ${read.rule.op === "atLeast" ? "a minimum" : "a maximum"}; remove it first.`);
    seen.add(key);
    rules.push(read.rule);
  }
  const own = rules.filter((r) => r.kind === "own").length;
  if (own > MAX_OWN_RULES) return fail(`At most ${MAX_OWN_RULES} ownership rules work together; this list has ${own}.`);
  if (rules.length - own > MAX_TEAM_GAME_RULES) return fail(`At most ${MAX_TEAM_GAME_RULES} team and game rules work together; this list has ${rules.length - own}.`);
  const clash = contradiction(rules);
  if (clash) return fail(clash);
  return { rules };
}

/** The men of the rule's set that a lineup holds: `men` is the nine as {team, game, own}. */
export const countIn = (rule, men) => men.reduce((n, m) => n + (inSet(rule, m) ? 1 : 0), 0);

/** The rules a made lineup breaks, each with how many men it has in the rule's set (the independent re-check, and the tests'). */
export function rulesBroken(rules, men) {
  return rules.map((rule) => ({ rule, have: countIn(rule, men) }))
    .filter(({ rule, have }) => (rule.op === "atLeast" ? have < rule.n : have > rule.n));
}

/** Each man's membership flags (0 or 1 per rule), for the engine to count with. */
export const membership = (rules, man) => rules.map((r) => (inSet(r, man) ? 1 : 0));

/**
 * Sentences for rules no pool can meet: an at-least with fewer usable men in its set than it asks for, or an at-most the locked men already pass. `pool`: the men that may be
 * rostered, as {team, game, own} (the locked ones included); `locked`: the locked men; `where`: the words after the count ("can be used", or "are on this slate" for the request's check). An ownership
 * rule that falls short also says how many men have no figure, since those are never counted; `heldWord`: what the held men are called ("locked", or "locked or Min %" when a Min % holds
 * some). Empty when every rule has room.
 */
export function poolShortfalls(rules, pool, locked = [], where = "can be used", heldWord = "locked") {
  const out = [];
  const unfigured = pool.filter((m) => typeof m.own !== "number" || !Number.isFinite(m.own)).length;
  for (const rule of rules) {
    if (rule.op === "atLeast") {
      const have = countIn(rule, pool);
      const missing = rule.kind === "own" && unfigured > 0 ? ` (${unfigured} ${plural(unfigured, "has", "have")} no ownership figure, so ${plural(unfigured, "he is", "they are")} not counted)` : "";
      if (have < rule.n) out.push(`"${ruleWords(rule)}" cannot be met: only ${have} ${plural(have, "player", "players")} ${setWords(rule)} ${where}${missing}`);
    } else {
      const held = countIn(rule, locked);
      if (held > rule.n) out.push(`"${ruleWords(rule)}" cannot be met: ${held} ${heldWord} ${plural(held, "player is", "players are")} already ${setWords(rule)}`);
    }
  }
  return out;
}

/**
 * Why no lineup can be made, in plain words, or null when the rules are not the cause. `probe(subset)` answers whether a lineup exists with only that subset of the rules (true, false,
 * or null when the check ran out of room); it runs every other setting as the failed lineup had it. Tries the pool first, then each rule left out alone, then all of them left out.
 */
export function explainRules(rules, { pool, locked, probe }) {
  if (!rules.length) return null;
  const short = poolShortfalls(rules, pool, locked);
  if (short.length) return joinAnd(short);
  const alone = rules.filter((r) => probe(rules.filter((x) => x !== r)) === true);
  const quote = (list) => joinAnd(list.map((r) => `"${ruleWords(r)}"`));
  if (alone.length === 1) return `the rule ${quote(alone)} cannot be met with your other settings`;
  if (alone.length > 1) return `the rules ${quote(alone)} cannot be met with your other settings (dropping either lets a lineup through)`;
  if (rules.length > 1 && probe([]) === true) return `the rules ${quote(rules)} cannot all be met together with your other settings`;
  return null;
}
