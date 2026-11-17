// Adam's edits to one source's number for one player (Sources page plan, 2026-10-18: "i want to be able to change
// specific data points also, just in case weird shit starts happening"). An edit replaces ONE source's figure for ONE
// player BEFORE the blend; Adam's typed overrides (RULES.md D28) replace the final number after it, and neither reset
// clears the other (D72). value null means "treat this source as not publishing him" (missing, never zero; D29).
// File: data/source-edits/<season>-w<NN>.json = { season, week, updatedAt, edits: { "<kind>/<sourceId>/<playerKey>":
// { value, was, name, team, pos, at, by } }, log: [{ at, action, kind, sourceId, playerKey, name, from, to, by }] }.
// This file is pure (no node: import) so the public site can run it in a browser (D71), as overrides/merge.js is;
// the disk I/O lives in edits.js, which re-exports everything here.
import { nameKey } from "../lib/names.js";
import { KNOWN_IDS } from "./selection-core.js";

export const EDIT_KINDS = Object.freeze(["projection", "ownership", "sdOwnFlex", "sdOwnCpt"]);
export const LOG_CAP = 500;
const OWNERSHIP_KINDS = new Set(["ownership", "sdOwnFlex", "sdOwnCpt"]);
const KIND_LABEL = { projection: "A projection", ownership: "Ownership", sdOwnFlex: "Showdown FLEX ownership", sdOwnCpt: "Showdown Captain ownership" };
const SOURCE_ID = /^[A-Za-z0-9._-]+$/;
const KEY_PART = /^[^/|\s]+$/;

/** An Error carrying `code`; shared with edits.js for its read and week errors. */
export function editsError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}
const invalid = (msg) => editsError("SOURCE_EDITS_INVALID", `${msg}, so nothing was saved.`);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v) => v === null || isNum(v);

/** The player part of an edit key: nameKey|TEAM|POS, or TEAM|DST for a defence (DST rows carry a nickname, keyed by team). null when the row lacks a part. */
export function playerKeyOf(row) {
  const team = String(row?.team ?? "").trim().toUpperCase();
  const pos = String(row?.pos ?? "").trim().toUpperCase();
  if (!team || !pos) return null;
  if (pos === "DST") return `${team}|DST`;
  const nk = nameKey(String(row?.name ?? ""));
  return nk ? `${nk}|${team}|${pos}` : null;
}

export const editKey = (kind, sourceId, playerKey) => `${kind}/${sourceId}/${playerKey}`;

/** "<kind>/<sourceId>/<playerKey>" -> { kind, sourceId, playerKey }, or null when the key is not that shape. */
export function parseEditKey(key) {
  const parts = String(key).split("/");
  if (parts.length !== 3) return null;
  const [kind, sourceId, playerKey] = parts;
  return validParts(kind, sourceId, playerKey) ? { kind, sourceId, playerKey } : null;
}

function validPlayerKey(pk) {
  if (typeof pk !== "string") return false;
  const p = pk.split("|");
  if (!p.every((s) => KEY_PART.test(s))) return false;
  return p.length === 3 ? p[2] !== "DST" : p.length === 2 && p[1] === "DST";
}
const validParts = (kind, sourceId, playerKey) => EDIT_KINDS.includes(kind) && typeof sourceId === "string" && SOURCE_ID.test(sourceId) && validPlayerKey(playerKey);

/** True when `sourceId` is a source of `kind`: a classic kind (projection, ownership) takes only selection-core's
 *  KNOWN_IDS for it; a Showdown kind takes any id, because the week's ownership-sources.json files decide those. */
const knownSource = (kind, sourceId) => !KNOWN_IDS[kind] || KNOWN_IDS[kind].includes(sourceId);

/** Value check for one kind: ownership 0..100, projection any finite number; null always allowed. Returns a message or null. */
function valueProblem(kind, value, field) {
  if (value === null) return null;
  if (!isNum(value)) return `${KIND_LABEL[kind]} ${field} must be a number or blank (got ${value === undefined ? "nothing" : typeof value === "string" ? JSON.stringify(value) : String(value)})`;
  if (OWNERSHIP_KINDS.has(kind) && (value < 0 || value > 100)) return `${KIND_LABEL[kind]} ${field} must be from 0 to 100 (got ${value})`;
  return null;
}

/** Throws SOURCE_EDITS_INVALID unless obj is a whole, well-formed edits file for (season, week). */
export function validateEdits(obj, season, week) {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) throw invalid("The source edits are not an object");
  if (obj.season !== undefined && obj.season !== season) throw invalid(`The source edits are for season ${obj.season}, not ${season}`);
  if (obj.week !== undefined && obj.week !== week) throw invalid(`The source edits are for week ${obj.week}, not ${week}`);
  const edits = obj.edits ?? {};
  if (typeof edits !== "object" || edits === null || Array.isArray(edits)) throw invalid("The source edits list is not an object");
  for (const [key, e] of Object.entries(edits)) {
    const k = parseEditKey(key);
    if (!k) throw invalid(`Source edit "${key}" is not kind/source/player`);
    if (typeof e !== "object" || e === null || Array.isArray(e)) throw invalid(`Source edit "${key}" is not an object`);
    const problem = valueProblem(k.kind, e.value, "value") ?? (numOrNull(e.was) ? null : `Source edit "${key}" has no source number (was)`);
    if (problem) throw invalid(problem);
    for (const f of ["name", "team", "pos"]) if (typeof e[f] !== "string") throw invalid(`Source edit "${key}" has no ${f}`);
  }
  if (obj.log !== undefined && !(Array.isArray(obj.log) && obj.log.every((l) => typeof l === "object" && l !== null && !Array.isArray(l)))) {
    throw invalid("The source edits log is not a list of entries");
  }
}

function requireNow(nowIso) {
  if (typeof nowIso !== "string" || Number.isNaN(Date.parse(nowIso))) throw invalid(`The time of the change is not a date (got ${JSON.stringify(nowIso)})`);
}
const withLog = (cur, entries) => [...(cur.log ?? []), ...entries].slice(-LOG_CAP);

/**
 * Sets one source's number for one player. change = { kind, sourceId, playerKey, value, was, name, team, pos }:
 * value a finite number (ownership kinds 0..100) or null ("this source does not publish him"); was the number the
 * source publishes now (or null); playerKey must be playerKeyOf({name, team, pos}); a projection or ownership
 * sourceId must be one selection-core.js KNOWN_IDS lists for that kind. Returns a new object; refuses
 * with SOURCE_EDITS_INVALID and a plain sentence otherwise.
 */
export function applyEditChange(cur, change, nowIso) {
  requireNow(nowIso);
  const { kind, sourceId, playerKey, value, was, name, team, pos } = change ?? {};
  if (!EDIT_KINDS.includes(kind)) throw invalid(`"${kind}" is not a kind of number that can be edited (${EDIT_KINDS.join(", ")})`);
  if (typeof sourceId !== "string" || !SOURCE_ID.test(sourceId)) throw invalid(`"${sourceId}" is not a source id`);
  if (!knownSource(kind, sourceId)) throw invalid(`"${sourceId}" is not one of the ${kind} sources this app knows (${KNOWN_IDS[kind].join(", ")})`);
  if (typeof name !== "string" || typeof team !== "string" || typeof pos !== "string") throw invalid("The player's name, team and position are all needed");
  if (!validPlayerKey(playerKey) || playerKeyOf({ name, team, pos }) !== playerKey) throw invalid(`"${playerKey}" is not the player key of ${name} (${team} ${pos})`);
  const problem = valueProblem(kind, value, "edit") ?? valueProblem(kind, was, "source number");
  if (problem) throw invalid(problem);
  const key = editKey(kind, sourceId, playerKey);
  const prior = cur?.edits?.[key];
  const entry = { at: nowIso, action: "set", kind, sourceId, playerKey, name, from: prior ? prior.value : was, to: value, by: "app" };
  return {
    ...cur,
    updatedAt: nowIso,
    edits: { ...(cur?.edits ?? {}), [key]: { value, was, name, team, pos, at: nowIso, by: "app" } },
    log: withLog(cur ?? {}, [entry])
  };
}

/**
 * Removes edits: { kind, sourceId, playerKey } all given = one ("reset"); playerKey given = that player's edits,
 * narrowed by kind or sourceId when given ("resetPlayer"); no playerKey = every edit, narrowed likewise ("resetAll").
 * Each removed edit gets one log entry (from = the edited value, to = the source number it replaced). Nothing
 * matching returns an unchanged copy with no log entry. Typed overrides (D28) live elsewhere and are never touched.
 */
export function resetEdits(cur, filter = {}, nowIso) {
  requireNow(nowIso);
  const { kind, sourceId, playerKey } = filter ?? {};
  if (kind !== undefined && !EDIT_KINDS.includes(kind)) throw invalid(`"${kind}" is not a kind of number that can be edited`);
  if (sourceId !== undefined && !(typeof sourceId === "string" && SOURCE_ID.test(sourceId))) throw invalid(`"${sourceId}" is not a source id`);
  if (playerKey !== undefined && !validPlayerKey(playerKey)) throw invalid(`"${playerKey}" is not a player key`);
  const action = playerKey === undefined ? "resetAll" : kind !== undefined && sourceId !== undefined ? "reset" : "resetPlayer";
  const kept = {};
  const entries = [];
  for (const [key, e] of Object.entries(cur?.edits ?? {})) {
    const k = parseEditKey(key);
    const hit = k && (kind === undefined || k.kind === kind) && (sourceId === undefined || k.sourceId === sourceId) && (playerKey === undefined || k.playerKey === playerKey);
    if (!hit) { kept[key] = e; continue; }
    entries.push({ at: nowIso, action, kind: k.kind, sourceId: k.sourceId, playerKey: k.playerKey, name: e.name ?? null, from: e.value, to: e.was, by: "app" });
  }
  if (entries.length === 0) return { ...cur, edits: { ...(cur?.edits ?? {}) }, log: [...(cur?.log ?? [])] };
  return { ...cur, updatedAt: nowIso, edits: kept, log: withLog(cur ?? {}, entries) };
}

const editMapOf = (edits) => (edits && typeof edits.edits === "object" && edits.edits !== null ? edits.edits : edits ?? {});

/** playerKey -> [{ id, dkId }] over the given board rows (classic or Showdown; one row per person). */
function rowsByKey(rows) {
  const byKey = new Map();
  for (const r of rows ?? []) {
    const pk = playerKeyOf(r);
    if (pk === null) continue;
    if (!byKey.has(pk)) byKey.set(pk, []);
    byKey.get(pk).push({ id: r.id, dkId: r.dkId });
  }
  return byKey;
}

/** True when every row sharing a key is the same DraftKings player: one row, or rows all carrying the same non-empty
 *  dkId (the salary file listing one ID twice, parse-salaries.js DUPLICATE_ID rows such as X and X#2). */
function onePlayer(list) {
  if (list.length === 1) return true;
  const first = list[0].dkId;
  return first !== null && first !== undefined && String(first) !== "" && list.every((r) => String(r.dkId) === String(first));
}

/**
 * Map rowId -> [{ kind, sourceId, value, was }]. Accepts the file object or its edits map. A player key that matches
 * two or more rows applies to all of them when they share one dkId (the same DraftKings player listed twice), and to
 * none of them when their dkIds differ or are missing; each such key is listed on the returned Map's `collisions`
 * property as { playerKey, rowIds, keys } so the caller can show it (the edits stay in the file).
 */
export function editsByRow(edits, rows) {
  const byKey = rowsByKey(rows);
  const out = new Map();
  const collisions = new Map();
  for (const [key, e] of Object.entries(editMapOf(edits))) {
    const k = parseEditKey(key);
    const list = k ? byKey.get(k.playerKey) : undefined;
    if (!list) continue;
    if (!onePlayer(list)) {
      if (!collisions.has(k.playerKey)) collisions.set(k.playerKey, { playerKey: k.playerKey, rowIds: list.map((r) => r.id), keys: [] });
      collisions.get(k.playerKey).keys.push(key);
      continue;
    }
    for (const { id } of list) {
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ kind: k.kind, sourceId: k.sourceId, value: e.value, was: e.was });
    }
  }
  out.collisions = [...collisions.values()];
  return out;
}

/** applySources' edits option: Map rowId -> that row's edits (editsByRow), or undefined with none. The one copy; choices.js re-exports it. */
export function editsMapFor(editsFile, rows) {
  return editsFile ? editsByRow(editsFile, rows) : undefined;
}

export const ORPHAN_NO_PLAYER = "no player on the board";
export const ORPHAN_UNKNOWN_SOURCE = "a source this app does not know for that kind";

/**
 * Edits the board cannot use, as [{ key, kind, sourceId, playerKey, ...edit, reason }]: reason ORPHAN_NO_PLAYER when
 * the player matches no row (or the key is not kind/source/player), else ORPHAN_UNKNOWN_SOURCE when a projection or
 * ownership edit names a source outside KNOWN_IDS. Never dropped from the file.
 */
export function orphanEdits(edits, rows) {
  const byKey = rowsByKey(rows);
  const out = [];
  for (const [key, e] of Object.entries(editMapOf(edits))) {
    const k = parseEditKey(key);
    const reason = !k || !byKey.has(k.playerKey) ? ORPHAN_NO_PLAYER : !knownSource(k.kind, k.sourceId) ? ORPHAN_UNKNOWN_SOURCE : null;
    if (!reason) continue;
    out.push({ key, ...(k ?? { kind: null, sourceId: null, playerKey: null }), ...e, reason });
  }
  return out;
}

/** True when the source now publishes a different number than the one the edit replaced (`was`); blank counts as a number here. */
export function moved(edit, currentSourceValue) {
  const was = isNum(edit?.was) ? edit.was : null;
  const now = isNum(currentSourceValue) ? currentSourceValue : null;
  if (was === null || now === null) return was !== now;
  return Math.abs(was - now) > 1e-9;
}
