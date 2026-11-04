// What the classic Optimizer remembers in the browser's one memory (memory.js, optimizer standard A9, round 5), per slate (the season, week and the main slate or a second slate): its settings (how many lineups,
// minimum unique, the position caps, the four rules, max per team, the default stack, Spread defenses, the avoided games of GPP and of Cash, Cash's count and max per team, the per-QB stack panels,
// the exposure table's sort and filter). The pure cleaners are here
// (tests/lineup-memory.test.mjs); lineup-memory-sync.js reads and writes through them. A remembered setting that is not valid reads as the default, never as an error.
import { cleanExpState, OPT_POSITIONS } from "./lineup-exposure.js";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, fallback) => (typeof v === "string" ? v : fallback);
const intWithin = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);

/** The settings as stored: only what a person set by hand, as typed (a box keeps its text). `opt` is lineup.js's page state. */
export function settingsToStore(opt) {
  return {
    count: opt.count,
    minUnique: opt.minUnique,
    maxExp: { ...opt.maxExp },
    rules: { ...opt.rules },
    maxPerTeam: opt.maxPerTeam,
    stackOwn: opt.stackOwn,
    stackOwnOrMore: opt.stackOwnOrMore,
    stackOpp: opt.stackOpp,
    stackOppOrMore: opt.stackOppOrMore,
    spreadDst: opt.spreadDst === true,
    avoid: [...opt.avoid],
    cashAvoid: [...(opt.cash?.avoid ?? [])],
    cashCount: opt.cash?.count,
    cashMaxPerTeam: opt.cash?.maxPerTeam,
    qb: opt.qb?.entries ? JSON.parse(JSON.stringify(opt.qb.entries)) : {}, // the per-QB stack panels, per slate as Min % and Max % are
    exp: { ...opt.exp },
  };
}

/**
 * Remembered settings made safe, over `defaults` (the page's own starting values): a field that is missing or not the right kind keeps its default, never throws.
 * `ruleKeys`: the rule names that exist; `teamOptions`: the Max per team values offered; `stackOwnMax`, `stackOppMax`: the largest teammate and opponent counts offered.
 */
export function cleanSettings(raw, defaults, { ruleKeys, teamOptions, stackOwnMax, stackOppMax, cleanQb = (v) => (isObject(v) ? v : {}) }) {
  const out = { ...defaults, maxExp: { ...defaults.maxExp }, rules: { ...defaults.rules }, avoid: [...defaults.avoid], cashAvoid: [...(defaults.cashAvoid ?? [])], exp: { ...defaults.exp }, qb: {} };
  if (!isObject(raw)) return out;
  out.count = text(raw.count, out.count);
  out.minUnique = text(raw.minUnique, out.minUnique);
  if (isObject(raw.maxExp)) for (const pos of OPT_POSITIONS) out.maxExp[pos] = text(raw.maxExp[pos], out.maxExp[pos]);
  if (isObject(raw.rules)) for (const key of ruleKeys) if (typeof raw.rules[key] === "boolean") out.rules[key] = raw.rules[key];
  out.maxPerTeam = teamOptions.includes(raw.maxPerTeam) ? raw.maxPerTeam : out.maxPerTeam;
  out.stackOwn = intWithin(raw.stackOwn, 0, stackOwnMax, out.stackOwn);
  out.stackOpp = intWithin(raw.stackOpp, 0, stackOppMax, out.stackOpp);
  if (typeof raw.stackOwnOrMore === "boolean") out.stackOwnOrMore = raw.stackOwnOrMore;
  if (typeof raw.stackOppOrMore === "boolean") out.stackOppOrMore = raw.stackOppOrMore;
  if (typeof raw.spreadDst === "boolean") out.spreadDst = raw.spreadDst;
  const games = (list, fallback) => (Array.isArray(list) ? [...new Set(list.filter((g) => typeof g === "string"))] : fallback);
  out.avoid = games(raw.avoid, out.avoid);
  out.cashAvoid = games(raw.cashAvoid, out.cashAvoid ?? []);
  if (typeof raw.cashCount === "string" || typeof raw.cashCount === "number") out.cashCount = String(raw.cashCount);
  out.cashMaxPerTeam = teamOptions.includes(raw.cashMaxPerTeam) ? raw.cashMaxPerTeam : out.cashMaxPerTeam;
  out.qb = cleanQb(raw.qb, stackOwnMax, stackOppMax);
  out.exp = cleanExpState(raw.exp, "classic");
  return out;
}

/** The games a remembered avoid list keeps for the slate on screen: a game that is not one of its games (another week's, or the other slate's) goes. */
export const avoidOnSlate = (avoid, gameIds) => (avoid ?? []).filter((g) => gameIds.has(String(g)));
