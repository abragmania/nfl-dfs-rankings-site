// The Optimizer on the public site (DECISIONS.md D69): POST /api/lineup/generate (server/server.js
// handleLineupGenerate) done in the visitor's browser on the published board. tools/publish.mjs copies this file to
// out/js/site-generate.js and the engine, unchanged, to out/server/lineup/ (the same relative path as here), with a
// console logger in place of server/lib/log.js. Pure: no network, no storage, no page; it runs on the page or in
// out/js/opt-worker.js.
//
// The validation, the slate's existing-lineup filter, fpCatches and the response enrichment are a PORT of the route
// and must stay identical to it, message for message; tests/site-optimizer.test.mjs runs the same cases through both.
// A change to the route's validation is made here too.
import { generateLineups, RULE_KEYS as GENERATE_RULE_KEYS } from "../server/lineup/multi.js";

const GENERATE_BODY_KEYS = new Set(["slate", "settings"]);
const GENERATE_SETTING_KEYS = new Set([
  "count", "minUnique", "locks", "excludes", "catchers", "maxExposure", "rules", "maxPerTeam", "allowRbGames", "avoidGames"
]);
const GENERATE_POSITIONS = ["QB", "RB", "WR", "TE", "DST"];
const GENERATE_MAX_COUNT = 150;
const GENERATE_MAX_UNIQUE = 8;

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** The route's response envelope (server.js envelope / errorBody). */
export function envelope(body, { ok = true, stale = [] } = {}) {
  return { ok, generatedAt: new Date().toISOString(), stale, ...body };
}
export function errorBody(code, message, stale = []) {
  return envelope({ error: { code, message } }, { ok: false, stale });
}

// server.js validateIdArray
function validateIdArray(value, name) {
  if (value === undefined || value === null) return { ids: [] };
  if (!Array.isArray(value)) return { error: `${name} must be an array of player ids` };
  for (const item of value) {
    if (typeof item !== "string" && typeof item !== "number") {
      return { error: `${name} must contain only player id strings or numbers` };
    }
  }
  return { ids: value };
}

// server.js exposureValueError
function exposureValueError(pos, value) {
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

// server.js validateGenerateSettings
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

// D43 (server.js matchupString, public/js/lineup.js matchupOf): "vs DAL" at home, "@ DET" away, from the board's
// "AWAY@HOME" game id; the bare opponent when it cannot tell.
export function matchupString(row) {
  const [away, home] = String(row.gameId ?? "").split("@");
  if (away && home && row.team === home) return `vs ${away}`;
  if (away && home && row.team === away) return `@ ${home}`;
  return row.opp ? String(row.opp) : "";
}

/**
 * The route's work on baked data. `board`: the baked /api/board body (rows, slates, stale). `slate`: the baked
 * /api/slate body; the engine reads only a salary cap from it, and neither it nor the route's full slate carries
 * one, so both use DraftKings' $50,000 (D1). `body`: the request {slate, settings}. `saved`: this device's saved
 * lineups of the week (every slate); the route's own filter picks the chosen slate's. Returns the route's body.
 */
export function generateResponse({ board, slate, body: rawBody, saved }) {
  if (!board || board.ok === false || !Array.isArray(board.rows)) {
    return board && board.ok === false && board.error ? board : errorBody("NO_SLATE", "No slate has been uploaded yet.");
  }
  const body = rawBody ?? {};
  if (!isPlainObject(body)) return errorBody("VALIDATION_ERROR", "The request body must be an object.");
  for (const key of Object.keys(body)) {
    if (!GENERATE_BODY_KEYS.has(key)) return errorBody("VALIDATION_ERROR", `Unknown field ${JSON.stringify(key)}; send {slate, settings}.`);
  }
  const secondSlates = Array.isArray(board.slates) ? board.slates : [];
  let secondSlate = null;
  if (body.slate !== undefined && body.slate !== null && body.slate !== "main") {
    secondSlate = typeof body.slate === "string" ? secondSlates.find((s) => s.key === body.slate) ?? null : null;
    if (!secondSlate) {
      return errorBody("VALIDATION_ERROR", `There is no second slate called ${JSON.stringify(body.slate)} for the loaded week.`);
    }
  }

  const slateGames = secondSlate ? new Set(secondSlate.gameIds) : null;
  const rows = slateGames ? board.rows.filter((r) => slateGames.has(r.gameId)) : board.rows;
  const rowById = new Map(board.rows.map((r) => [String(r.id), r]));
  const slateIds = new Set(rows.map((r) => String(r.id)));
  const slateName = secondSlate ? (/slate$/i.test(secondSlate.label) ? secondSlate.label : `${secondSlate.label} slate`) : null;
  const checked = validateGenerateSettings(body.settings, {
    boardIds: new Set(rowById.keys()),
    slateIds,
    gameIds: new Set(rows.map((r) => String(r.gameId ?? "").toUpperCase()).filter(Boolean)),
    slateName,
    nameOf: (id) => rowById.get(id)?.name ?? id
  });
  if (checked.error) return errorBody("VALIDATION_ERROR", checked.error);

  // The route's filter: lineups saved with this slate's key; an untagged one counts on the main slate always and on
  // a second slate when every player is in its games.
  const slateKey = secondSlate ? secondSlate.key : "main";
  const existing = (Array.isArray(saved) ? saved : [])
    .filter((l) => Array.isArray(l?.slots) && l.slots.length > 0)
    .filter((l) => (typeof l.slate === "string" && l.slate !== ""
      ? l.slate === slateKey
      : !secondSlate || l.slots.every((s) => slateIds.has(String(s.playerId)))));

  const fpCatches = {};
  for (const r of rows) if (typeof r.fpRec === "number" && Number.isFinite(r.fpRec)) fpCatches[String(r.id)] = r.fpRec;

  const stale = Array.isArray(board.stale) ? board.stale : [];
  try {
    const result = generateLineups({ rows, slate, settings: { ...checked.settings, fpCatches }, existing });
    const lineups = result.lineups.map((l) => ({
      ids: l.ids,
      salary: l.salary,
      proj: l.proj,
      players: l.ids.map((id) => {
        const r = rowById.get(String(id)) ?? {};
        return { id, name: r.name ?? id, pos: r.pos ?? null, team: r.team ?? null, opp: matchupString(r), salary: r.salary ?? null, proj: r.proj ?? null, own: r.own ?? null };
      })
    }));
    const exposure = {};
    for (const [pos, list] of Object.entries(result.exposure ?? {})) {
      exposure[pos] = (list ?? []).map((e) => {
        const r = rowById.get(String(e.id)) ?? {};
        return { ...e, team: r.team ?? null, opp: matchupString(r), salary: r.salary ?? null, own: r.own ?? null };
      });
    }
    return envelope({ lineups, exposure, notes: result.notes }, { stale });
  } catch (e) {
    console.error("lineup generate: failed", e);
    return errorBody("LINEUP_GENERATE_FAILED", "Could not make lineups.");
  }
}
