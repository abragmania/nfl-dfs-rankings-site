// Source weights on the public site (D71): the board re-ranks in the browser from the baked board through the
// app's own pure modules (blend, ownership recipe, remerge); a change is kept in this browser per season and week. Not redone
// here: a source off when the board was baked (nothing was fetched) and row.projStats (its stat lines are not kept).
import { blendProjections, failedPositions, BLEND_FLAGS } from "../server/rank/blend.js";
import { ownershipRecipe, blendOwnership } from "../server/rank/ownership-summary.js";
import { remergeOverrides } from "../server/rank/remerge.js";
import { publishedOverrides, STORAGE_UNAVAILABLE_MESSAGE } from "./site-overrides.js";

export const WEIGHTS_PREFIX = "nfldfs-site-weights:";
export const weightsKey = (season, week) => `${WEIGHTS_PREFIX}${season}-w${String(week).padStart(2, "0")}`;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const validWeight = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

export const tunableSources = (board) => (board?.sources ?? []).filter((s) => (s.kind === "projection" || s.kind === "ownership") && s.readOnly !== true);

function readStored(storage, season, week) {
  if (!storage) return {};
  try {
    const raw = JSON.parse(storage.getItem(weightsKey(season, week)) ?? "null");
    return isObject(raw) ? raw : {};
  } catch {
    return {}; // unreadable or not JSON: the published weights show
  }
}

export function readWeights(storage, season, week, board) {
  const published = new Map(tunableSources(board).map((s) => [s.id, Number(s.weight)]));
  const out = {};
  for (const [id, e] of Object.entries(readStored(storage, season, week))) {
    if (published.has(id) && isObject(e) && validWeight(e.weight) && e.was === published.get(id) && e.weight !== e.was) out[id] = e.weight;
  }
  return out;
}

function checkPatch(board, patch) {
  if (!isObject(patch)) return { error: { code: "VALIDATION_ERROR", message: "each source entry must be an object" } };
  const source = tunableSources(board).find((s) => s.id === patch.id);
  if (!source) return { error: { code: "VALIDATION_ERROR", message: `unknown source id ${JSON.stringify(patch.id)}` } };
  if (patch.enabled !== undefined) return { error: { code: "READ_ONLY", message: "Sources cannot be switched on or off on the site; give one a weight of 0 to leave it out." } };
  if (!validWeight(patch.weight)) return { error: { code: "VALIDATION_ERROR", message: `source ${patch.id}: weight must be a finite number >= 0` } };
  return { source };
}

export const putWeight = (storage, season, week, board, patch) => putWeights(storage, season, week, board, [patch]);

export function putWeights(storage, season, week, board, patches) {
  const checked = patches.map((p) => checkPatch(board, p));
  const bad = checked.find((c) => c.error);
  if (bad) return bad;
  if (!storage) return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  const stored = readStored(storage, season, week);
  patches.forEach((patch, i) => {
    const was = Number(checked[i].source.weight);
    if (patch.weight === was) delete stored[patch.id];
    else stored[patch.id] = { weight: patch.weight, was };
  });
  try {
    const key = weightsKey(season, week);
    if (Object.keys(stored).length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(stored));
  } catch {
    return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  }
  return { weights: readWeights(storage, season, week, board) };
}

// The row's quotes per ownership source, as the board has them. The baked anchor keeps each quote's own source and url but not
// which source it came from: parts pair with the counted sources in order only when every pair's number matches (D29); else
// each quote shows its card label and no link.
function quotesOf(row, ownWeight, published, labels) {
  const ids = Object.keys(row.ownBySource ?? {}).filter((id) => ownWeight.has(id));
  const counted = ids.filter((id) => Number(published.get(id)) !== 0);
  const baked = row.ownAnchor?.parts;
  const paired = Array.isArray(baked) && baked.length === counted.length && counted.every((id, i) => baked[i]?.own === row.ownBySource[id]);
  return Object.fromEntries(ids.map((id) => {
    const own = row.ownBySource[id];
    const at = paired ? counted.indexOf(id) : -1;
    return [id, { own, parts: [at >= 0 ? baked[at] : { own, source: labels[id] ?? id, url: null }] }];
  }));
}

const swapTail =(text, oldTail, newTail) => (typeof text === "string" && oldTail && text.endsWith(oldTail) ? text.slice(0, text.length - oldTail.length) + newTail : text);

export function boardWithWeights(board, slate, weights) {
  if (!board || board.ok === false || !Array.isArray(board.rows) || Object.keys(weights ?? {}).length === 0) return board;
  const tunable = tunableSources(board);
  const published = new Map(tunable.map((s) => [s.id, Number(s.weight)]));
  const now = (id) => (Object.hasOwn(weights, id) && published.has(id) ? weights[id] : published.get(id));
  const label = (s) => s.label ?? s.id;
  const labels = Object.fromEntries(tunable.map((s) => [s.id, label(s)]));
  const state = board.injuryReport?.state ?? "ok";

  const projLive = tunable.filter((s) => s.kind === "projection" && s.enabled !== false && (s.recordCount ?? 0) > 0);
  const pick = (weightOf) => Object.fromEntries(projLive.map((s) => [s.id, weightOf(s.id)]));
  const players = board.rows.map((r) => ({ id: r.id, pos: r.pos, avgPoints: r.avgPoints }));
  const blend = blendProjections(players, new Map(board.rows.map((r) => [r.id, r.projBySource])), pick(now),
    { labels, injuryStatus: new Map(board.rows.map((r) => [r.id, r.injury?.status ?? null])), injuryReport: state });
  const failedForPos = failedPositions(projLive, now);

  const ownLive = tunable.filter((s) => s.kind === "ownership" && s.enabled !== false);
  const ownWeight = new Map(ownLive.map((s) => [s.id, now(s.id)]));

  const rows = board.rows.map((row) => {
    const out = { ...row };
    if (row.src?.proj !== "twogun") {
      const b = blend.byPlayerId.get(row.id);
      const failed = (failedForPos.get(row.pos) ?? []).filter((id) => row.projBySource?.[id] == null).map((id) => `sourceFailed:${id}`);
      out.projBase = b.proj;
      out.coverage = b.coverage;
      out.flags = [...b.flags, ...(row.flags ?? []).filter((f) => !BLEND_FLAGS.has(f) && !f.startsWith("sourceFailed:")), ...failed];
    }
    if (row.src?.own !== "twogun") {
      const anchor = blendOwnership(quotesOf(row, ownWeight, published, labels), (id) => ownWeight.get(id));
      out.ownBase = anchor ? anchor.own : null;
      out.ownKind = anchor ? "quoted" : null;
      out.ownAnchor = anchor;
    }
    return out;
  });

  const recipes = { ...(board.recipes ?? {}) };
  recipes.projection = swapTail(recipes.projection, blendProjections([], new Map(), pick((id) => published.get(id)), { labels, injuryReport: state }).recipe, blend.recipe);
  const ownRecipe = (weightOf) => ownershipRecipe(ownLive.map((s) => ({ label: label(s), weight: weightOf(s.id) })));
  recipes.ownership = swapTail(recipes.ownership, ownRecipe((id) => published.get(id)), ownRecipe(now));
  // publishedWeight keeps the weight the board was published with beside the one this browser changed it to, so the Sources page can show
  // what was changed and put it back (public/js/sources-page-board.js).
  const sources = board.sources.map((s) => (published.has(s.id) && Object.hasOwn(weights, s.id) ? { ...s, weight: weights[s.id], publishedWeight: s.weight } : s));
  return remergeOverrides({ ...board, rows, recipes, sources }, slate, publishedOverrides(board));
}
