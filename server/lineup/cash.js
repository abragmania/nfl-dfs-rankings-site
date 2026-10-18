// Cash mode in the Optimizer's engine (cash mode job 1, 2026-10-17; PROJECT.md Part 4 "Cash mode"; Adam's CQ1-CQ5): the
// server picks the basis (TwoGun's median in TwoGun mode, the projection in current mode, never the ceiling), adds no
// points of any kind, and turns off every stack, the four D55 roster rules, the exposure settings and minimum unique
// players (Adam 2026-10-17; Cash 3b fix round names it as CASH_NOTES does); a per-team cap covers
// every team, the quarterback's included (D76 off). multi.js enters this file only in cash. Pure and browser-safe (D69).
import { rowIsOut } from "../rank/sidelined.js";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The browser keeps a copy (public/js/lineup-cash.js) that a test compares with this one. */
export const CASH_DEFAULTS = Object.freeze({ count: 1, minUnique: 1, maxPerTeam: null });

export const NO_MEDIAN_SENTENCE = "TwoGun mode is on but this board carries no TwoGun medians, so a cash lineup cannot be built by median; switch the header to current mode to build by projection.";
// Cash 2b fix, 2026-10-17: promises no remedy (a reload cannot add a mode to a board baked without one); still a refusal.
export const UNKNOWN_MODE_SENTENCE = "The board was published without its mode, so a cash lineup's basis cannot be picked.";

export const CASH_NOTES = Object.freeze({
  stacks: "Stack settings do not apply in cash mode.",
  rules: "Roster rules do not apply in cash mode.",
  exposure: "Exposure settings do not apply in cash mode.",
  unique: "Minimum unique players does not apply in cash mode.", // Cash: no minimum unique, Adam 2026-10-17
  basis: "In cash mode the server picks the basis: TwoGun's median in TwoGun mode, else the projection."
});

const STACK_KEYS = Object.freeze(["stackOwn", "stackOwnOrMore", "stackOpp", "stackOppOrMore", "qbStacks"]);
const RULE_SETTING_KEYS = Object.freeze(["rules", "allowRbGames"]);
const EXPOSURE_KEYS = Object.freeze(["maxExposure", "playerMaxExposure", "playerMinExposure", "spreadDst"]);
const RULES_OFF = Object.freeze({ starredQbOnly: false, noSameTeamRbs: false, noSameGameRbs: false, noDstVsOwnPlayers: false });

/** 0 for an out row that has a median, exactly as objective.js ceilingOf treats the ceiling. */
export function medianOf(row) {
  const median = num(row && row.tg && row.tg.median);
  return median !== null && rowIsOut(row) ? 0 : median;
}

/** Adam CQ4, CQ5: TwoGun mode with no median on any row is refused, never built by projection. */
export function cashBasis(rows, boardMode) {
  if (boardMode === "current") return { basis: "proj" };
  if (boardMode !== "twogun") return { fatal: UNKNOWN_MODE_SENTENCE }; // Cash mode job 2b, 2026-10-17: never a silent projection build
  return Array.isArray(rows) && rows.some((row) => medianOf(row) !== null) ? { basis: "median" } : { fatal: NO_MEDIAN_SENTENCE };
}

/** Sent: not absent, null, or an empty object or list. */
function carried(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.values(value).some((v) => v !== undefined);
  return true;
}

/** `_cash` marks the patched settings: normaliseSettings accepts the internal "median" objective only from here. Each
 *  note appears once, only when the request carried that setting. */
export function cashEngineSettings(settings, rows, boardMode) {
  const s = settings && typeof settings === "object" ? settings : {};
  const basis = cashBasis(rows, boardMode);
  if (basis.fatal) return { settings: null, notes: [], fatal: basis.fatal };
  const notes = [];
  const given = (keys) => keys.some((k) => carried(s[k]));
  const legacyStack = s.rules && typeof s.rules === "object" && carried(s.rules.qbStack);
  const ruleKeys = s.rules && typeof s.rules === "object" ? Object.keys(s.rules).filter((k) => k !== "qbStack" && s.rules[k] !== undefined) : [];
  if (given(STACK_KEYS) || legacyStack) notes.push(CASH_NOTES.stacks);
  if (ruleKeys.length || carried(s.allowRbGames)) notes.push(CASH_NOTES.rules);
  if (given(EXPOSURE_KEYS)) notes.push(CASH_NOTES.exposure);
  if (s.minUnique !== undefined && s.minUnique !== null) notes.push(CASH_NOTES.unique);
  if (s.objective !== undefined && s.objective !== null) notes.push(CASH_NOTES.basis);
  const out = { ...s };
  for (const k of [...STACK_KEYS, ...RULE_SETTING_KEYS, ...EXPOSURE_KEYS]) delete out[k];
  Object.assign(out, {
    count: s.count ?? CASH_DEFAULTS.count,
    minUnique: CASH_DEFAULTS.minUnique, // Cash: no minimum unique, Adam 2026-10-17: the X best, only distinct from each other
    maxPerTeam: s.maxPerTeam ?? CASH_DEFAULTS.maxPerTeam,
    objective: basis.basis,
    stackOwn: 0,
    stackOwnOrMore: true,
    stackOpp: 0,
    stackOppOrMore: true,
    rules: { ...RULES_OFF },
    capAllTeams: true,
    _cash: true
  });
  return { settings: out, notes, fatal: null };
}
