// Matches one DraftKings player to one player on his club's NFLDepthCharts team file. Pure and fail closed: any doubt
// is "no card", never a stand-in, and the search never leaves his own club's file. Used by the app's server and the
// public site's browser (D6 amended 2026-10-18).
import { nameKey, lastKey, firstKey } from "../lib/names.js";

// Nicknames and the names they stand for, frozen. Tier B accepts a first-name difference only through this table or as a
// prefix of three or more letters (Chig / Chigoziem); anything else is unknown, never a guess.
const NICKNAMES = [
  ["mike", "michael", "mikey"], ["nick", "nicholas", "nicolas", "nico"], ["gabe", "gabriel"], ["matt", "matthew"], ["chris", "christopher"],
  ["joe", "joseph", "joey"], ["will", "william", "willie", "bill", "billy"], ["bob", "bobby", "rob", "robbie", "robert"], ["tom", "tommy", "thomas"],
  ["tony", "anthony"], ["dan", "danny", "daniel"], ["dave", "david"], ["jim", "jimmy", "james"], ["jake", "jacob"], ["josh", "joshua"],
  ["ben", "benny", "benjamin"], ["sam", "sammy", "samuel"], ["alex", "alexander"], ["andy", "drew", "andrew"], ["tim", "timothy"],
  ["zach", "zack", "zachary"], ["jon", "jonathan"], ["nate", "nathan", "nathaniel"], ["rick", "ricky", "richard"], ["ed", "eddie", "edward"],
  ["charlie", "chuck", "charles"], ["steve", "steven", "stephen"], ["ken", "kenny", "kenneth"], ["jeff", "jeffrey"], ["greg", "gregory"],
  ["pat", "patrick"], ["pete", "peter"], ["phil", "philip"], ["ray", "raymond"], ["ron", "ronnie", "ronald"], ["don", "donald"], ["larry", "lawrence"],
  ["jay", "jason"], ["cam", "cameron"], ["ty", "tyler"], ["trey", "tre"], ["dom", "dominic", "dominick"], ["cody", "codey"],
].map((g) => Object.freeze(g));
const NICKNAME_GROUP = new Map(NICKNAMES.flatMap((g, i) => g.map((n) => [n, i])));

/** Whether two first-name keys (names.js firstKey) can be the same man: equal, a prefix of 3+ letters, or one nickname group. */
export function firstNamesAgree(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  return NICKNAME_GROUP.has(a) && NICKNAME_GROUP.get(a) === NICKNAME_GROUP.get(b);
}

// DraftKings positions the card covers; a fullback or half-back is a running back. Their position text may carry
// two jobs ("RB/WR"); the first one is the player's group.
const GROUPS = Object.freeze({ QB: "QB", RB: "RB", HB: "RB", FB: "RB", WR: "WR", TE: "TE" });

/** QB, RB, WR or TE for a position text ("WR", "HB", "RB/WR"), or null for anything else (a defense, a kicker, a lineman). */
export function positionGroup(pos) {
  const first = String(pos ?? "").toUpperCase().split("/")[0].trim();
  return GROUPS[first] ?? null;
}

/** Every player on a team file, once each: the depth-chart slots, then the unlisted bands. */
export function teamPlayers(teamFile) {
  const out = [];
  const seen = new Set();
  const take = (p) => {
    if (!p || typeof p !== "object" || typeof p.name !== "string" || seen.has(p.playerKey)) return;
    seen.add(p.playerKey);
    out.push(p);
  };
  for (const unit of Object.values(teamFile?.units ?? {})) {
    for (const slot of Array.isArray(unit) ? unit : []) for (const p of slot?.players ?? []) take(p);
  }
  for (const unit of Object.values(teamFile?.unlisted ?? {})) {
    for (const band of Object.values(unit ?? {})) for (const p of Array.isArray(band) ? band : []) take(p);
  }
  return out;
}

export const NOT_FOUND_MESSAGES = Object.freeze({
  DEFENSE: "NFLDepthCharts has no player card for a defense.",
  UNSUPPORTED_POSITION: "NFLDepthCharts has no player card for this position.",
  UNKNOWN_TEAM: "This team is not one of the 32 clubs NFLDepthCharts publishes.",
  NO_MATCH: "NFLDepthCharts does not list a player by this name and position on this club's file.",
  AMBIGUOUS: "More than one player on this club's file could be him, so no card is shown rather than risk the wrong player.",
});

export const notFound = (reason) => ({ found: false, reason, message: NOT_FOUND_MESSAGES[reason] });

/**
 * Who is `{name, pos}` on `teamFile` (his own club's file)? Tier A: the same name key and the same position group.
 * Tier B: the same last name and group, exactly one such man on the file, and the first names agree as a nickname or a
 * prefix (Gabe and Gabriel; firstNamesAgree). Two candidates anywhere, or none, is no card. Returns {found:true, player, tier} or notFound(reason).
 */
export function resolvePlayer({ name, pos }, teamFile) {
  if (String(pos ?? "").toUpperCase() === "DST") return notFound("DEFENSE");
  const group = positionGroup(pos);
  if (!group) return notFound("UNSUPPORTED_POSITION");
  const pool = teamPlayers(teamFile).filter((p) => positionGroup(p.position) === group);
  const key = nameKey(String(name ?? ""));
  const exact = pool.filter((p) => nameKey(p.name) === key);
  if (exact.length === 1) return { found: true, player: exact[0], tier: "A" };
  if (exact.length > 1) return notFound("AMBIGUOUS");
  const last = lastKey(String(name ?? ""));
  const sameLast = last ? pool.filter((p) => lastKey(p.name) === last) : [];
  if (sameLast.length > 1) return notFound("AMBIGUOUS");
  if (sameLast.length === 1 && firstNamesAgree(firstKey(String(name ?? "")), firstKey(sameLast[0].name))) {
    return { found: true, player: sameLast[0], tier: "B" };
  }
  return notFound("NO_MATCH");
}
