// Showdown GPP lineup rules (Adam 2026-10-18, D81): hard, never bent, above Max %, Min % and minimum unique. Joins the
// pure lineup-rules.js to the board, exactSearch's ruleGate, the engine and the request checks. Pure.
import { validateLineupRules, staticContradictions, ruleWarnings, ruleSentence, rulesBroken, createRuleTracker, suffixCounts } from "./lineup-rules.js";
import { rosterable, SHOWDOWN_SLOTS } from "./showdown.js";

const SCOPES = Object.freeze(["cpt", "flex", "any"]);
const SEAT_MAX = Object.freeze({ cpt: 1, flex: SHOWDOWN_SLOTS.length - 1, any: SHOWDOWN_SLOTS.length });
const seatOf = (c) => (c.pos === "CPT" ? "cpt" : "flex");

/** The rule module's ctx for a showdownBoard and its locks: a seat is unavailable when it is not in the engine's pool.
 *  `canRoster` (candidate -> boolean) is the build's own test (showdown-pool.js rosterTest: a median or ceiling build
 *  rosters by its own figure, D81; showdown-includes.js withIncludes lets an included man in); absent, the projection
 *  build's rosterable. */
export function showdownRuleContext(board, lockIds = [], canRoster = rosterable) {
  const locks = new Set(lockIds);
  const usable = { cpt: new Set(), flex: new Set() };
  for (const c of board.candidates) {
    if (!board.excluded.has(c.id) && (locks.has(c.id) || canRoster(c))) usable[seatOf(c)].add(c.personId);
  }
  const people = [...board.rowOfPerson.keys()];
  const cannotSit = { cpt: new Set(people.filter((p) => !usable.cpt.has(p))), flex: new Set(people.filter((p) => !usable.flex.has(p))) };
  return {
    resolvePerson: (id) => board.personOf.get(String(id)) ?? null,
    scopes: SCOPES,
    maxSeats: SHOWDOWN_SLOTS.length,
    seatMax: SEAT_MAX,
    nameOf: (p) => board.rowOfPerson.get(p)?.name ?? p,
    locks: [...locks].filter((id) => board.byCand.has(id)).map((id) => ({ personId: board.byCand.get(id).personId, where: seatOf(board.byCand.get(id)) })),
    unavailable: new Set(people.filter((p) => cannotSit.cpt.has(p) && cannotSit.flex.has(p))),
    cannotSit,
    teams: board.teams,
    teamOf: (p) => board.rowOfPerson.get(p)?.team ?? null,
    people
  };
}

/** Validated rules (person ids), or {error} with every contradiction; `active` false runs the engine as with no rules.
 *  `canRoster` is the build's own can-roster test, passed to showdownRuleContext (D81). */
export function readShowdownRules(raw, board, lockIds, canRoster = rosterable) {
  const ctx = showdownRuleContext(board, lockIds, canRoster);
  const v = validateLineupRules(raw, ctx);
  if (v.error) return { error: v.error };
  const clash = staticContradictions(v.rules, ctx);
  if (clash.length) return { error: clash.join(" ") };
  return { rules: v.rules, active: v.rules.some((r) => r.on !== false), warnings: ruleWarnings(v.rules, ctx), nameOf: ctx.nameOf };
}

/** exactSearch's ruleGate: a fresh tracker per Captain; `flex` must be his whole FLEX list in search order. */
export function searchGate(rules) {
  return (capt, lockedFlex, flex) => {
    const tracker = createRuleTracker(rules);
    tracker.add({ personId: capt.personId, where: "cpt" });
    for (const c of lockedFlex) tracker.add({ personId: c.personId, where: "flex" });
    const ahead = suffixCounts(flex, rules, "flex");
    let at = 0;
    const aheadCount = (r) => ({ ifAhead: ahead[r].ifAhead[at], thenAhead: ahead[r].thenAhead[at] });
    return {
      open(start, left) {
        at = start;
        return !tracker.violated() && tracker.canStillMeet(left, aheadCount);
      },
      leaf: () => tracker.leafOk(),
      add: (c) => tracker.add({ personId: c.personId, where: "flex" }),
      remove: (c) => tracker.remove({ personId: c.personId, where: "flex" })
    };
  };
}

/** The independent re-check (rulesBroken): a made lineup that breaks a rule is a bug, so it throws (engine: failed). */
export function assertKeepsRules(lineup, number, rules, nameOf) {
  const seats = lineup.slots.map((s) => ({ personId: s.personId, where: s.slot === "CPT" ? "cpt" : "flex" }));
  const broken = rulesBroken(seats, rules, nameOf);
  if (broken.length) throw new Error(`lineup ${number} broke a lineup rule (${broken.map((b) => b.replace(/\.$/, "")).join("; ")})`);
}

/** The note when the rules leave fewer lineups than asked, naming every rule that is on. */
export function rulesShortNote({ made, count, saved, cap, rules, nameOf }) {
  const list = rules.map((rule, i) => ({ rule, N: i + 1 })).filter(({ rule }) => rule.on !== false)
    .map(({ rule, N }) => `Rule ${N}: ${ruleSentence(rule, nameOf)}`).join(" ");
  const limits = `with the locks, the excludes and the $${cap.toLocaleString("en-US")} cap`;
  if (made === 0 && !saved) return `No lineup keeps every lineup rule ${limits}, so no lineups were made. ${list}`;
  const word = (n) => `${n} lineup${n === 1 ? "" : "s"}`;
  return `The lineup rules allow only ${word(made)}${saved ? " besides the saved ones" : ""} ${limits}; ` +
    `${made} of the ${count} asked for ${made === 1 ? "was" : "were"} made. ${list}`;
}
