// The Optimizer's request checks and response shaping (PROJECT.md Part 4 "Optimizer"; DECISIONS.md D55, D69, D73), shared
// by POST /api/lineup/generate (server/server.js handleLineupGenerate) and the public site's copy of that route
// (site-src/site-generate.js, run in the visitor's browser). One copy, so the two answer message for message alike;
// tests/site-optimizer.test.mjs runs the same cases through both as a wiring check.
//
// Pure and browser-safe: no node modules, no network, no storage, no logging. tools/publish.mjs copies it, unchanged,
// to out/server/lineup/ beside the engine and privacy-scans it.
import { RULE_KEYS, LEGACY_RULE_KEYS, OBJECTIVES, STACK_OWN_MAX, STACK_OPP_MAX, ceilingOf } from "./multi.js";
import { retiredObjectiveNote } from "./optimize.js";
import { validateQbStacks } from "./qb-stacks.js";

// An older saved request may still carry the D55 rule keys D73 replaced; they are accepted (and must be booleans).
const GENERATE_RULE_KEYS = [...RULE_KEYS, ...LEGACY_RULE_KEYS];
const GENERATE_BODY_KEYS = new Set(["slate", "settings"]);
const GENERATE_SETTING_KEYS = new Set([
  "count", "minUnique", "locks", "excludes", "catchers", "maxExposure", "rules", "maxPerTeam", "allowRbGames", "avoidGames",
  "objective", "stackOwn", "stackOwnOrMore", "stackOpp", "stackOppOrMore", "playerMaxExposure", "qbStacks", "spreadDst"
]);
// D73: the QB stack's two numbers, in Adam's words for the refusal sentence.
const GENERATE_STACK_NUMBERS = [
  { key: "stackOwn", max: STACK_OWN_MAX, words: "teammates to stack with the quarterback" },
  { key: "stackOpp", max: STACK_OPP_MAX, words: "opponents to stack with the quarterback" }
];
const GENERATE_POSITIONS = ["QB", "RB", "WR", "TE", "DST"];
const GENERATE_MAX_COUNT = 150;
const GENERATE_MAX_UNIQUE = 8;

export const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// locks/excludes may arrive as ids (string or number); anything else is a validation error rather than a
// silent drop so a typo'd body never quietly rosters or excludes the wrong player.
export function validateIdArray(value, name) {
  if (value === undefined || value === null) return { ids: [] };
  if (!Array.isArray(value)) return { error: `${name} must be an array of player ids` };
  for (const item of value) {
    if (typeof item !== "string" && typeof item !== "number") {
      return { error: `${name} must contain only player id strings or numbers` };
    }
  }
  return { ids: value };
}

// One maximum-exposure value, always explicit: {pct: 0-100} (a share of the new lineups asked for, rounded up; saved
// lineups never count, D74) or {count: whole number} (a lineup count). A bare number is refused, since 1 could mean
// 100% or one lineup. Null or omitted means no cap. Returns an error string or null.
export function exposureValueError(pos, value) {
  if (value === null || value === undefined) return null;
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length !== 1 || (keys[0] !== "pct" && keys[0] !== "count")) return `maxExposure.${pos} must be {pct} or {count}`;
    const n = value[keys[0]];
    if (keys[0] === "pct" && (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100)) return `maxExposure.${pos}.pct must be a number from 0 to 100`;
    if (keys[0] === "count" && (!Number.isInteger(n) || n < 0)) return `maxExposure.${pos}.count must be a whole number of 0 or more`;
    return null;
  }
  return `maxExposure.${pos} must be {pct: 0-100} or {count: whole number}`;
}

/**
 * Validates the Optimizer's settings against the board. `ctx`: boardIds (every id on the board), slateIds (the
 * ids the chosen slate offers), gameIds (the chosen slate's games), slateName (null for the main slate).
 * Returns {error} with a plain sentence, or {settings} ready for generateLineups (ids as strings).
 */
export function validateGenerateSettings(raw, ctx) {
  if (raw === undefined || raw === null) raw = {};
  if (!isPlainObject(raw)) return { error: "settings must be an object" };
  for (const key of Object.keys(raw)) {
    if (!GENERATE_SETTING_KEYS.has(key)) return { error: `Unknown setting ${JSON.stringify(key)}.` };
  }
  const out = {};
  if (raw.count !== undefined && raw.count !== null) {
    if (!Number.isInteger(raw.count) || raw.count < 1 || raw.count > GENERATE_MAX_COUNT) {
      return { error: `count must be a whole number from 1 to ${GENERATE_MAX_COUNT}` };
    }
    out.count = raw.count;
  }
  if (raw.minUnique !== undefined && raw.minUnique !== null) {
    if (!Number.isInteger(raw.minUnique) || raw.minUnique < 1 || raw.minUnique > GENERATE_MAX_UNIQUE) {
      return { error: `minUnique must be a whole number from 1 to ${GENERATE_MAX_UNIQUE}` };
    }
    out.minUnique = raw.minUnique;
  }
  for (const name of ["locks", "excludes", "catchers"]) {
    const result = validateIdArray(raw[name], name);
    if (result.error) return { error: result.error };
    const ids = [...new Set(result.ids.map(String))];
    const unknown = ids.filter((id) => !ctx.boardIds.has(id));
    if (unknown.length) return { error: `${name} names a player who is not on the board: ${unknown.join(", ")}` };
    out[name] = ids;
  }
  if (ctx.slateName) {
    const outside = out.locks.filter((id) => !ctx.slateIds.has(id));
    if (outside.length) {
      const names = outside.map((id) => ctx.nameOf(id)).join(", ");
      return { error: `${names} ${outside.length === 1 ? "is" : "are"} locked but not in the ${ctx.slateName}'s games. Unlock ${outside.length === 1 ? "him" : "them"} or build on the main slate.` };
    }
  }
  if (raw.maxExposure !== undefined && raw.maxExposure !== null) {
    if (!isPlainObject(raw.maxExposure)) return { error: "maxExposure must be an object keyed by position" };
    for (const [pos, value] of Object.entries(raw.maxExposure)) {
      if (!GENERATE_POSITIONS.includes(pos)) return { error: `Unknown setting ${JSON.stringify(`maxExposure.${pos}`)}; positions are ${GENERATE_POSITIONS.join(", ")}.` };
      const err = exposureValueError(pos, value);
      if (err) return { error: err };
    }
    out.maxExposure = raw.maxExposure;
  }
  // Per-player Max % (Adam 2026-10-11): {"<playerId>": {pct: 0-100}}; null means no cap and is dropped.
  if (raw.playerMaxExposure !== undefined && raw.playerMaxExposure !== null) {
    if (!isPlainObject(raw.playerMaxExposure)) return { error: "playerMaxExposure must be an object keyed by player id" };
    const caps = {};
    for (const [rawId, value] of Object.entries(raw.playerMaxExposure)) {
      const id = String(rawId).trim();
      if (!ctx.boardIds.has(id)) return { error: `playerMaxExposure names a player who is not on the board: ${rawId}` };
      if (value === null || value === undefined) continue;
      const keys = isPlainObject(value) ? Object.keys(value) : [];
      if (keys.length !== 1 || keys[0] !== "pct") return { error: `playerMaxExposure for ${ctx.nameOf(id)} must be {pct: 0-100}` };
      const n = value.pct;
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) return { error: `playerMaxExposure for ${ctx.nameOf(id)} must be a percent from 0 to 100` };
      caps[id] = { pct: n };
    }
    out.playerMaxExposure = caps;
  }
  if (raw.rules !== undefined && raw.rules !== null) {
    if (!isPlainObject(raw.rules)) return { error: "rules must be an object of on/off switches" };
    for (const [key, value] of Object.entries(raw.rules)) {
      if (!GENERATE_RULE_KEYS.includes(key)) return { error: `Unknown setting ${JSON.stringify(`rules.${key}`)}.` };
      if (typeof value !== "boolean") return { error: `rules.${key} must be true or false` };
    }
    out.rules = raw.rules;
  }
  if (raw.maxPerTeam !== undefined && raw.maxPerTeam !== null) {
    if (!Number.isInteger(raw.maxPerTeam) || raw.maxPerTeam < 1 || raw.maxPerTeam > 8) {
      return { error: "maxPerTeam must be a whole number from 1 to 8" };
    }
    out.maxPerTeam = raw.maxPerTeam;
  }
  if (raw.objective !== undefined && raw.objective !== null) {
    // Follows multi.js OBJECTIVES ("proj", "ceil": Adam picks projection or TwoGun's ceiling each time; the engine
    // refuses a ceiling build on a board with no ceilings). A retired objective ("lev", "projMinusOwn": Adam
    // 2026-10-15) passes through; multi.js builds it on projection with a note, so a saved setting never fails.
    if (!OBJECTIVES.includes(raw.objective) && retiredObjectiveNote(raw.objective) === null) return { error: `objective must be one of ${OBJECTIVES.join(", ")}` };
    out.objective = raw.objective;
  }
  for (const { key, max, words } of GENERATE_STACK_NUMBERS) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (!Number.isInteger(value) || value < 0 || value > max) {
      return { error: `${key} (the number of ${words}) must be a whole number from 0 to ${max}` };
    }
    out[key] = value;
  }
  for (const key of ["stackOwnOrMore", "stackOppOrMore"]) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "boolean") return { error: `${key} must be true or false` };
    out[key] = value;
  }
  // Spread defenses (Adam 2026-10-16): classic only; a locked defense can't be spread.
  if (raw.spreadDst !== undefined && raw.spreadDst !== null) {
    if (typeof raw.spreadDst !== "boolean") return { error: "spreadDst must be true or false" };
    if (raw.spreadDst && ctx.rowOf && out.locks.some((id) => String(ctx.rowOf(id)?.pos ?? "").toUpperCase() === "DST")) {
      return { error: "A locked defense can't be spread; unlock it or turn off Spread defenses." };
    }
    if (raw.spreadDst) out.spreadDst = true;
  }
  const qbChecked = validateQbStacks(raw.qbStacks, ctx, STACK_OWN_MAX, { locks: out.locks, excludes: out.excludes });
  if (qbChecked.error) return { error: qbChecked.error };
  if (Object.keys(qbChecked.qbStacks).length) out.qbStacks = qbChecked.qbStacks;
  for (const name of ["allowRbGames", "avoidGames"]) {
    const value = raw[name];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value) || value.some((g) => typeof g !== "string")) return { error: `${name} must be an array of games such as "DET@ARI"` };
    const games = [...new Set(value.map((g) => g.trim().toUpperCase()))];
    const unknown = games.filter((g) => !ctx.gameIds.has(g));
    if (unknown.length) return { error: `${name} names a game that is not on this slate: ${unknown.join(", ")}` };
    out[name] = games;
  }
  return { settings: out };
}

// D43 (public/js/lineup.js matchupOf): "vs DAL" at home, "@ DET" away, from the board's "AWAY@HOME" game id; the
// bare opponent when it cannot tell.
export function matchupString(row) {
  const [away, home] = String(row.gameId ?? "").split("@");
  if (away && home && row.team === home) return `vs ${away}`;
  if (away && home && row.team === away) return `@ ${home}`;
  return row.opp ? String(row.opp) : "";
}

/** The request body's shape: an object of {slate, settings} only. Returns an error sentence or null. */
export function generateBodyError(body) {
  if (!isPlainObject(body)) return "The request body must be an object.";
  for (const key of Object.keys(body)) {
    if (!GENERATE_BODY_KEYS.has(key)) return `Unknown field ${JSON.stringify(key)}; send {slate, settings}.`;
  }
  return null;
}

/**
 * `slate`: "main" or absent for the main slate, else the key of one of the loaded week's second slates (D57),
 * looked up in `secondSlates`. Returns {secondSlate} (null for the main slate) or {error}.
 */
export function findGenerateSlate(slate, secondSlates) {
  let secondSlate = null;
  if (slate !== undefined && slate !== null && slate !== "main") {
    secondSlate = typeof slate === "string" ? secondSlates.find((s) => s.key === slate) ?? null : null;
    if (!secondSlate) {
      return { error: `There is no second slate called ${JSON.stringify(slate)} for the loaded week.` };
    }
  }
  return { secondSlate };
}

/**
 * The chosen slate's players and the checked settings. `boardRows`: every board row; `secondSlate`: from
 * findGenerateSlate. Returns {error} or {rows (the slate's rows), rowById (every board row by id), slateIds, settings}.
 */
export function prepareGenerate(boardRows, secondSlate, rawSettings) {
  const slateGames = secondSlate ? new Set(secondSlate.gameIds) : null;
  const rows = slateGames ? boardRows.filter((r) => slateGames.has(r.gameId)) : boardRows;
  const rowById = new Map(boardRows.map((r) => [String(r.id), r]));
  const slateIds = new Set(rows.map((r) => String(r.id)));
  const slateName = secondSlate ? (/slate$/i.test(secondSlate.label) ? secondSlate.label : `${secondSlate.label} slate`) : null;
  const checked = validateGenerateSettings(rawSettings, {
    boardIds: new Set(rowById.keys()),
    slateIds,
    gameIds: new Set(rows.map((r) => String(r.gameId ?? "").toUpperCase()).filter(Boolean)),
    slateName,
    nameOf: (id) => rowById.get(id)?.name ?? id,
    rowOf: (id) => rowById.get(id),
    slateRows: rows
  });
  if (checked.error) return { error: checked.error };
  return { rows, rowById, slateIds, settings: checked.settings };
}

// Saved lineups of this week that belong to this slate: those saved with this slate's key. A lineup saved with
// no slate (before the field existed, or by a caller that sent none) falls back to membership: a second slate
// counts it when every player is in its games; the main slate counts it always.
export function existingForSlate(saved, secondSlate, slateIds) {
  const slateKey = secondSlate ? secondSlate.key : "main";
  return (Array.isArray(saved) ? saved : [])
    .filter((l) => Array.isArray(l?.slots) && l.slots.length > 0)
    .filter((l) => (typeof l.slate === "string" && l.slate !== ""
      ? l.slate === slateKey
      : !secondSlate || l.slots.every((s) => slateIds.has(String(s.playerId)))));
}

/** FantasyPros' own projected catches per player (board row fpRec), for the D55 pass-catcher test. */
export function fpCatchesFor(rows) {
  const fpCatches = {};
  for (const r of rows) if (typeof r.fpRec === "number" && Number.isFinite(r.fpRec)) fpCatches[String(r.id)] = r.fpRec;
  return fpCatches;
}

/**
 * The response body's {lineups, exposure, notes} from generateLineups' result. Lineup players and exposure rows
 * carry the matchup (D43), salary and own% (D32) beside the engine's own fields. On a TwoGun-mode board a lineup
 * also carries `ceil` (TwoGun's ceilings summed, null when any player lacks one) and so does every one of its players
 * (null for a player TwoGun does not cover); a current-mode answer has neither field, so it is exactly what it was.
 */
export function enrichGenerateResult(result, rowById) {
  const lineups = result.lineups.map((l) => ({
    ids: l.ids,
    salary: l.salary,
    proj: l.proj,
    ...(l.ceil !== undefined ? { ceil: l.ceil } : {}),
    players: l.ids.map((id) => {
      const r = rowById.get(String(id)) ?? {};
      const player = { id, name: r.name ?? id, pos: r.pos ?? null, team: r.team ?? null, opp: matchupString(r), salary: r.salary ?? null, proj: r.proj ?? null, own: r.own ?? null };
      if (l.ceil !== undefined) player.ceil = ceilingOf(r); // the engine's figure: 0 for an out player
      return player;
    })
  }));
  const exposure = {};
  for (const [pos, list] of Object.entries(result.exposure ?? {})) {
    exposure[pos] = (list ?? []).map((e) => {
      const r = rowById.get(String(e.id)) ?? {};
      return { ...e, team: r.team ?? null, opp: matchupString(r), salary: r.salary ?? null, own: r.own ?? null };
    });
  }
  return { lineups, exposure, notes: result.notes };
}
