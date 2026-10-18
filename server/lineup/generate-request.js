// The Optimizer's request checks and response shaping (PROJECT.md Part 4 "Optimizer"; DECISIONS.md D55, D69, D73), shared
// by POST /api/lineup/generate (server/server.js handleLineupGenerate) and the public site's copy of that route
// (site-src/site-generate.js, run in the visitor's browser). One copy, so the two answer message for message alike;
// tests/site-optimizer.test.mjs runs the same cases through both as a wiring check.
//
// Pure and browser-safe: no node modules, no network, no storage, no logging. tools/publish.mjs copies it, unchanged,
// to out/server/lineup/ beside the engine and privacy-scans it.
import {
  RULE_KEYS, LEGACY_RULE_KEYS, OBJECTIVES, STACK_OWN_MAX, STACK_OPP_MAX, ceilingOf, pctToLineups, minLineups, dkKeyOf, minOutReason, pairBreak,
  lockedQbBlocksRow, qbEntryByKey
} from "./multi.js";
import { retiredObjectiveNote } from "./optimize.js";
import { validateQbStacks } from "./qb-stacks.js";
import { slotsFull, lockedSlotWords, minSlotProblem } from "./soft.js";
import { medianOf, CASH_NOTES } from "./cash.js";
import { lineupModeOf } from "../lineups/validate.js";

// An older saved request may still carry the D55 rule keys D73 replaced; they are accepted (and must be booleans).
const GENERATE_RULE_KEYS = [...RULE_KEYS, ...LEGACY_RULE_KEYS];
const GENERATE_BODY_KEYS = new Set(["slate", "settings"]);
export const GENERATE_SETTING_KEYS = new Set([
  "count", "minUnique", "locks", "excludes", "catchers", "maxExposure", "rules", "maxPerTeam", "allowRbGames", "avoidGames",
  "objective", "stackOwn", "stackOwnOrMore", "stackOpp", "stackOppOrMore", "playerMaxExposure", "playerMinExposure", "qbStacks", "spreadDst", "mode"
]);
// Cash mode job 2b, 2026-10-17: what a cash request may not send, each with the engine's own sentence (cash.js CASH_NOTES).
const CASH_REFUSED = [
  { keys: ["objective"], error: CASH_NOTES.basis },
  { keys: ["stackOwn", "stackOwnOrMore", "stackOpp", "stackOppOrMore", "qbStacks"], error: CASH_NOTES.stacks },
  { keys: ["rules"], error: CASH_NOTES.rules },
  { keys: ["maxExposure", "playerMaxExposure", "playerMinExposure", "spreadDst"], error: CASH_NOTES.exposure },
  { keys: ["minUnique"], error: CASH_NOTES.unique } // Cash: no minimum unique, Adam 2026-10-17
];
// D73: the QB stack's two numbers, in Adam's words for the refusal sentence.
const GENERATE_STACK_NUMBERS = [
  { key: "stackOwn", max: STACK_OWN_MAX, words: "teammates to stack with the quarterback" },
  { key: "stackOpp", max: STACK_OPP_MAX, words: "opponents to stack with the quarterback" }
];
const GENERATE_POSITIONS = ["QB", "RB", "WR", "TE", "DST"];
const GENERATE_MAX_COUNT = 150;
const GENERATE_MAX_UNIQUE = 8;

export const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// Ids as strings or numbers; anything else is refused, so a typo'd body never quietly rosters or excludes a player.
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

// One maximum-exposure value: {pct: 0-100} (of the new lineups, rounded up, D74) or {count}; a bare number is refused
// (1 could mean 100% or one lineup). Null or omitted means no cap. Returns an error string or null.
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

/** One per-player percent setting (`name`): {pcts} keyed by trimmed id, {} for none given, or {error}. */
function playerPctsChecked(value, name, ctx) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) return { error: `${name} must be an object keyed by player id` };
  const pcts = {};
  for (const [rawId, entry] of Object.entries(value)) {
    const id = String(rawId).trim();
    if (!ctx.boardIds.has(id)) return { error: `${name} names a player who is not on the board: ${rawId}` };
    if (entry === null || entry === undefined) continue;
    const keys = isPlainObject(entry) ? Object.keys(entry) : [];
    if (keys.length !== 1 || keys[0] !== "pct") return { error: `${name} for ${ctx.nameOf(id)} must be {pct: 0-100}` };
    const n = entry.pct;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) return { error: `${name} for ${ctx.nameOf(id)} must be a percent from 0 to 100` };
    pcts[id] = { pct: n };
  }
  return { pcts };
}

/** A Min % that can never be met (PROJECT.md Part 4 Optimizer (Min % and soft rules, Adam 2026-10-17)), or null. */
function minPctError(out, ctx) {
  const count = out.count ?? 1;
  const mins = Object.entries(out.playerMinExposure ?? {}).filter(([, { pct }]) => minLineups(pct, count) > 0); // under one lineup: a note, never a refusal
  for (const [id, { pct }] of mins) {
    const max = out.playerMaxExposure?.[id]?.pct;
    if (max !== undefined && minLineups(pct, count) > pctToLineups(max, count)) return `${ctx.nameOf(id)}'s Min % (${pct}) is above his Max % (${max})`;
    if (out.excludes.includes(id)) return `${ctx.nameOf(id)} is excluded and has a Min %`;
  }
  const outside = ctx.slateName ? mins.filter(([id]) => !ctx.slateIds.has(id)).map(([id]) => ctx.nameOf(id)) : [];
  if (outside.length) {
    const one = outside.length === 1;
    return `${outside.join(", ")} ${one ? "has" : "have"} a Min % but ${one ? "is" : "are"} not in the ${ctx.slateName}'s games. Clear ${one ? "his" : "their"} Min % or build on the main slate.`;
  }
  if (!ctx.rowOf) return null;
  const posOf = (id) => String(ctx.rowOf(id)?.pos ?? "").toUpperCase();
  const locksAt = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
  for (const id of out.locks) if (posOf(id) in locksAt) locksAt[posOf(id)]++;
  const lockedKeys = new Set(out.locks.map((id) => dkKeyOf(ctx.rowOf(id) ?? {}, id)));
  // Rows the pool drops, or the locks keep out (a pair rule, the locked QB's stack, the per-team limit), take no slot:
  // the engine builds without them and says so. Twin rows of one man are counted once.
  const rules = Object.fromEntries(RULE_KEYS.map((k) => [k, out.rules?.[k] ?? true]));
  const pool = { excludes: new Set(out.excludes), avoidGames: new Set(out.avoidGames ?? []), rules, objective: out.objective };
  const keyOf = (id) => dkKeyOf(ctx.rowOf(id) ?? {}, id);
  const never = (id) => new Set(Object.entries(qbEntryByKey(Object.entries(out.qbStacks ?? {}), keyOf, id)?.players ?? {}).filter(([, c]) => c === "no").map(([pid]) => keyOf(pid)));
  const side = (id) => {
    const r = ctx.rowOf(id);
    return { pos: posOf(id), team: String(r.team ?? "").toUpperCase(), opp: String(r.opp ?? "").toUpperCase(), game: String(r.gameId ?? "").toUpperCase(), key: dkKeyOf(r, id), name: ctx.nameOf(id), never: never(id) };
  };
  const allowRb = new Set(out.allowRbGames ?? []);
  const lockClash = (id) => out.locks.some((l) => ctx.rowOf(l) && pairBreak(side(id), side(l), rules, allowRb));
  const byKey = new Map();
  for (const [id, { pct }] of mins) {
    const row = ctx.rowOf(id);
    const pos = posOf(id);
    const key = dkKeyOf(row ?? {}, id);
    if (!row || lockedKeys.has(key) || !(pos in locksAt) || minOutReason(row, id, pool)) continue;
    if (slotsFull(locksAt, pos)) return `${ctx.nameOf(id)} has a Min % but ${lockedSlotWords(pos)}`;
    if (lockClash(id) || lockedQbBlocksRow(out, ctx.rowOf, id)) continue;
    const n = minLineups(pct, count);
    const cap = out.maxExposure?.[pos];
    const capN = !cap ? null : cap.pct !== undefined ? pctToLineups(cap.pct, count) : cap.count;
    if (capN !== null && n > capN) return `${ctx.nameOf(id)}'s Min % (${pct}) is above the ${pos} maximum exposure (${cap.pct !== undefined ? cap.pct : `${cap.count} lineups`})`;
    byKey.set(key, { pos, n: Math.max(n, byKey.get(key)?.n ?? 0) });
  }
  const needs = {};
  for (const { pos, n } of byKey.values()) (needs[pos] ??= []).push(n);
  return minSlotProblem(needs, locksAt, count);
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
  const mode = raw.mode === undefined || raw.mode === null ? "gpp" : raw.mode;
  if (mode !== "gpp" && mode !== "cash") return { error: "mode must be cash or gpp" };
  if (mode === "cash") {
    const refused = CASH_REFUSED.find(({ keys }) => keys.some((k) => raw[k] !== undefined && raw[k] !== null));
    if (refused) return { error: refused.error };
  }
  const out = { mode };
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
  // "catchers" is accepted from an older saved request and ignored: every back counts toward the stack (D55 as amended 2026-10-17).
  for (const name of ["locks", "excludes"]) {
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
  // Per-player Max % (Adam 2026-10-11) and Min %: {"<playerId>": {pct: 0-100}}; null means none and is dropped.
  for (const name of ["playerMaxExposure", "playerMinExposure"]) {
    const checked = playerPctsChecked(raw[name], name, ctx);
    if (checked.error) return { error: checked.error };
    if (checked.pcts) out[name] = checked.pcts;
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
    // Follows multi.js OBJECTIVES; a retired objective ("lev", "projMinusOwn") passes through and multi.js builds it
    // on projection with a note, so a saved setting never fails.
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
  const qbChecked = validateQbStacks(raw.qbStacks, ctx, STACK_OWN_MAX, STACK_OPP_MAX, { locks: out.locks, excludes: out.excludes });
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
  const minError = minPctError(out, ctx);
  if (minError) return { error: minError };
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
// counts it when every player is in its games; the main slate counts it always. A cash batch counts no saved lineups
// (Cash 3b fix round, 2026-10-17).
export function existingForSlate(saved, secondSlate, slateIds, mode = "gpp") {
  if (mode === "cash") return []; // Cash: no minimum unique, Adam 2026-10-17: a cash batch is the X best, saves never count
  const slateKey = secondSlate ? secondSlate.key : "main";
  return (Array.isArray(saved) ? saved : [])
    .filter((l) => Array.isArray(l?.slots) && l.slots.length > 0)
    .filter((l) => lineupModeOf(l) === mode) // Cash mode job 2b, 2026-10-17: a GPP batch counts only GPP lineups (no mode reads as GPP)
    .filter((l) => (typeof l.slate === "string" && l.slate !== ""
      ? l.slate === slateKey
      : !secondSlate || l.slots.every((s) => slateIds.has(String(s.playerId)))));
}

/**
 * The response body's {lineups, exposure, notes, bends} from generateLineups' result. Lineup players and exposure rows
 * carry the matchup (D43), salary and own% (D32) beside the engine's own fields. On a TwoGun-mode board a lineup
 * also carries `ceil` (TwoGun's ceilings summed, null when any player lacks one) and so does every one of its players
 * (null for a player TwoGun does not cover); a current-mode answer has neither field, so it is exactly what it was.
 * Cash only (Cash 2b fix, 2026-10-17): the body adds `mode` ("cash") and `basis` ("median" or "proj", the basis the
 * server picked, also on a refusal inside the build; null only when no basis could be picked); on a median build each
 * lineup adds `median` (TwoGun's medians summed, null when any player lacks one) and each player his own `median`, and
 * the lineup's `proj` is null when any player's projection is missing or only a stand-in. A GPP body has none of these.
 */
export function enrichGenerateResult(result, rowById) {
  const lineups = result.lineups.map((l) => ({
    ids: l.ids,
    salary: l.salary,
    proj: l.proj,
    ...(l.ceil !== undefined ? { ceil: l.ceil } : {}),
    ...(l.median !== undefined ? { median: l.median } : {}),
    ...(l.bent !== undefined ? { bent: l.bent } : {}),
    players: l.ids.map((id) => {
      const r = rowById.get(String(id)) ?? {};
      const player = { id, name: r.name ?? id, pos: r.pos ?? null, team: r.team ?? null, opp: matchupString(r), salary: r.salary ?? null, proj: r.proj ?? null, own: r.own ?? null };
      if (l.ceil !== undefined) player.ceil = ceilingOf(r); // the engine's figure: 0 for an out player
      if (l.median !== undefined) player.median = medianOf(r);
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
  // Cash mode job 2b, 2026-10-17: mode and basis only when the engine set them (cash), so a GPP answer is unchanged.
  const cash = { ...(result.mode !== undefined ? { mode: result.mode } : {}), ...(result.basis !== undefined ? { basis: result.basis } : {}) };
  return { lineups, exposure, notes: result.notes, bends: result.bends, ...cash };
}
