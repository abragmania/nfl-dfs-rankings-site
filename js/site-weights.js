// Source weights on the public site (D71): the board re-ranks in the browser from the baked board through the
// app's own pure modules (blend, ownership choice and recipe, remerge); a change is kept in this browser per season and week. The result
// is what server/rank/select.js applySources gives for the same ticks and weights (tests/site-weights-parity.test.mjs). Not redone
// here: a source off when the board was baked (nothing was fetched) and row.projStats (its stat lines are not kept).
import { blendProjections, failedPositions, BLEND_FLAGS, projRecipe, filledText } from "../server/rank/blend.js";
import { ownershipRecipe, ownershipOf } from "../server/rank/ownership-summary.js";
import { remergeOverrides } from "../server/rank/remerge.js";
import { isSidelined } from "../server/rank/sidelined.js";
import { TWOGUN_ID, ticksOnlyTwoGunProjection } from "../server/sources/selection-core.js";
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
  if (patch.enabled !== undefined) return { error: { code: "READ_ONLY", message: "Sources cannot be switched on or off on the site; give one a weight of 0 to untick it. An unticked source still fills in for players the ticked ones miss, as in the app." } };
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

const withoutTwogun = ({ [TWOGUN_ID]: _his, ...rest }) => rest;
const positiveWeight = (w) => (Number(w) > 0 ? Number(w) : 0);
const positives = (weights) => Object.fromEntries(Object.entries(weights).filter(([, w]) => w > 0)); // select.js tickedWeights / backupWeights keep only weights above 0
const labelOf = (s) => s.label ?? s.id;

/** What the board and the browser's weights say: the tunable sources, their published weights and the weights now, and TwoGun's two read-only cards.
 *  His cards cannot be changed on the site, but he is ticked or not as the board was baked (a published weight above 0), and his figures take part. */
function contextOf(board, weights) {
  const tunable = tunableSources(board);
  const published = new Map(tunable.map((s) => [s.id, Number(s.weight)]));
  const hisCard = (kind) => (board.sources ?? []).find((s) => s.id === TWOGUN_ID && s.kind === kind && s.readOnly === true);
  const proj = hisCard("projection");
  const own = hisCard("ownership");
  const his = {
    projCard: proj,
    projTicked: positiveWeight(proj?.weight) > 0,
    projW: proj && (proj.recordCount ?? 0) > 0 ? positiveWeight(proj.weight) : 0, // counts only while he returned players (select.js liveProj)
    ownW: positiveWeight(own?.weight),
    ownListed: Boolean(own) && board.rows.some((r) => r.ownBySource?.[TWOGUN_ID] != null)
  };
  const labels = { ...Object.fromEntries(tunable.map((s) => [s.id, labelOf(s)])), ...(proj || own ? { [TWOGUN_ID]: labelOf(proj ?? own) } : {}) };
  return {
    tunable, published, weights, his, labels, state: board.injuryReport?.state ?? "ok",
    now: (id) => (Object.hasOwn(weights, id) && published.has(id) ? weights[id] : published.get(id))
  };
}

// The weight a source has in the backups. A visitor weight above 0 is the source's stored weight (select.js backupWeights from selection-core.js
// backupIds); a 0 only unticks it, and it stays a backup at the weight the board was baked with, as the app's controls leave it.
const backupWith = (published, weights, baked) => (id) => (id !== TWOGUN_ID && published.has(id) && weights[id] > 0 ? weights[id] : Number(baked?.[id] ?? 0));

/** Proj: the ticked sources (TwoGun's number included, last, as select.js has them), then the backups the board was baked with.
 *  Blends are done only when a projection weight changed; otherwise Proj stays as baked. */
function projectionPlan(board, { tunable, published, now, weights, his, labels, state }) {
  const live = tunable.filter((s) => s.kind === "projection" && s.enabled !== false && (s.recordCount ?? 0) > 0);
  const ids = [...live.map((s) => s.id), ...(his.projW > 0 ? [TWOGUN_ID] : [])];
  const pick = (weightOf) => positives(Object.fromEntries(ids.map((id) => [id, weightOf(id)])));
  const bakedBackup = isObject(board.mode?.backupWeights) ? board.mode.backupWeights : null;
  const backupOf = backupWith(published, weights, bakedBackup);
  const plan = {
    changed: live.some((s) => now(s.id) !== published.get(s.id)),
    ticked: pick((id) => (id === TWOGUN_ID ? his.projW : now(id))),
    backupW: bakedBackup ? pick(backupOf) : null,
    hisTicked: his.projW > 0
  };
  if (!plan.changed) return plan;
  // His OUT call keeps his figure out of the blend, Adam's In keeps it (select.js prepareRow).
  const blendIn = new Map(board.rows.map((r) => [r.id, r.tg?.call === "OUT" && r.override?.status !== "in" && r.projBySource && TWOGUN_ID in r.projBySource ? withoutTwogun(r.projBySource) : r.projBySource]));
  const players = board.rows.map((r) => ({ id: r.id, pos: r.pos }));
  // What the board builder left to hide a man (sidelined.js injuryRuling): DraftKings' own status, or the feed's word when it is a game-day inactive; a feed tag alone is a flag (injury.flagOnly) and counts for nothing.
  const injuryStatus = new Map(board.rows.map((r) => [r.id, isSidelined(r.salaryStatus) ? r.salaryStatus : r.injury?.flagOnly ? null : r.injury?.status ?? null]));
  const blendWith = (w) => blendProjections(players, blendIn, w, { labels, injuryStatus, injuryReport: state });
  plan.blend = blendWith(plan.ticked);
  plan.backup = plan.backupW && Object.keys(plan.backupW).length ? blendWith(plan.backupW) : null;
  plan.failedForPos = failedPositions(live, now);
  plan.failedForBackup = failedPositions(live, backupOf);
  return plan;
}

/** Own: the ticked ownership sources (TwoGun's quote included), then the ownership backups the board was baked with (ownership-summary.js ownershipOf,
 *  the one copy). Done only when an ownership weight changed; otherwise Own stays as baked. */
function ownershipPlan(board, { tunable, published, now, weights, his }) {
  const live = tunable.filter((s) => s.kind === "ownership" && s.enabled !== false);
  const ids = new Set([...live.map((s) => s.id), ...(his.ownListed ? [TWOGUN_ID] : [])]);
  const weightsOf = (weightOf) => positives(Object.fromEntries([...ids].map((id) => [id, positiveWeight(weightOf(id))])));
  const bakedBackup = isObject(board.mode?.backupOwnWeights) ? board.mode.backupOwnWeights : null;
  return {
    ids,
    changed: live.some((s) => now(s.id) !== published.get(s.id)),
    publishedOf: (id) => (id === TWOGUN_ID ? his.ownW : published.get(id)),
    ticked: weightsOf((id) => (id === TWOGUN_ID ? his.ownW : now(id))),
    backup: bakedBackup ? weightsOf(backupWith(published, weights, bakedBackup)) : null,
    ran: tunable.filter((s) => s.kind === "ownership" && s.status !== "not run" && s.status !== "disabled") // select.js ownRan
  };
}

// The sentences of the board's recipes, as select.js classicRecipes words them for the same weights.
const projectionText = (plan, { labels, state }, rows) => projRecipe(plan.ticked, labels, state) + (rows ? filledText(plan.ticked, plan.backupW, projRecipe(plan.backupW, labels, state)) : "");
function ownershipText(plan, { labels }, rows) {
  const recipe = (w) => ownershipRecipe([...plan.ran.map((s) => ({ label: labels[s.id], weight: w?.[s.id] ?? 0 })), ...(w && TWOGUN_ID in w ? [{ label: labels[TWOGUN_ID], weight: w[TWOGUN_ID] }] : [])]);
  return recipe(plan.ticked) + (rows ? filledText(plan.ticked, plan.backup, recipe(plan.backup)) : "");
}

// The row's quotes per ownership source, as the board has them (select.js ownQuotesOf: his OUT call keeps his quote out). The baked anchor
// keeps each quote's own source and url but not which source it came from: parts pair, in order, with the sources that made the baked Own
// (the row's srcUsed.own; on a board baked before that field, the sources published above 0) only when every pair's number matches (D29);
// else each quote shows its card label and no link.
function quotesOf(row, own, labels) {
  const out = row.tg?.call === "OUT" && row.override?.status !== "in"; // Adam's In keeps TwoGun's quote too (select.js)
  const ids = Object.keys(row.ownBySource ?? {}).filter((id) => own.ids.has(id) && !(out && id === TWOGUN_ID));
  const counted = Array.isArray(row.srcUsed?.own) ? row.srcUsed.own : ids.filter((id) => Number(own.publishedOf(id)) !== 0);
  const baked = row.ownAnchor?.parts;
  const paired = Array.isArray(baked) && baked.length === counted.length && counted.every((id, i) => baked[i]?.own === row.ownBySource[id]);
  return Object.fromEntries(ids.map((id) => {
    const quote = row.ownBySource[id];
    const at = paired ? counted.indexOf(id) : -1;
    return [id, { own: quote, parts: [at >= 0 ? baked[at] : { own: quote, source: labels[id] ?? id, url: null }] }];
  }));
}

/** One row re-blended (select.js classicRow): Proj when a projection weight changed, Own when an ownership weight changed, and the ids that made them. */
function rowWith(row, proj, own, labels) {
  const out = { ...row };
  // The ids that made Proj and Own. A figure this browser did not re-blend keeps what the board recorded; a board baked before the field
  // existed has none, and stays "not recorded" (null), never "recorded as empty".
  const used = { proj: row.srcUsed?.proj ?? null, own: row.srcUsed?.own ?? null };
  if (proj.changed) {
    const ticked = proj.blend.byPlayerId.get(row.id);
    // His OUT call while he is ticked is no gap: the backups never fill him.
    const fromBackup = Boolean(proj.backup) && ticked.blend === null && !(proj.hisTicked && row.tg?.call === "OUT" && row.override?.status !== "in");
    const b = fromBackup ? proj.backup.byPlayerId.get(row.id) : ticked;
    const failed = ((fromBackup ? proj.failedForBackup : proj.failedForPos).get(row.pos) ?? []).filter((id) => row.projBySource?.[id] == null).map((id) => `sourceFailed:${id}`);
    out.projBase = b.proj;
    out.coverage = b.coverage;
    out.flags = [...b.flags, ...(row.flags ?? []).filter((f) => !BLEND_FLAGS.has(f) && !f.startsWith("sourceFailed:")), ...failed];
    used.proj = [...b.sources]; // the ids that made the re-blended Proj: the player card names these only
  }
  if (own.changed) {
    const { anchor, used: ownUsed } = ownershipOf(quotesOf(row, own, labels), own.ticked, own.backup);
    out.ownBase = anchor ? anchor.own : null;
    out.ownKind = anchor ? "quoted" : null;
    out.ownAnchor = anchor;
    used.own = ownUsed;
  }
  if (proj.changed || own.changed) out.srcUsed = used;
  return out;
}

/** The mode block after a weight moved: the ticks no longer match a preset, so the app would say custom; cashMode follows the ticks (select.js modeOf). */
function modeWith(board, { tunable, now, his }) {
  if (!board.mode || !tunable.some((s) => now(s.id) !== Number(s.weight))) return board.mode;
  const sources = Object.fromEntries([...tunable.filter((s) => s.kind === "projection").map((s) => [s.id, { use: now(s.id) > 0 }]), [TWOGUN_ID, { use: his.projTicked }]]);
  return { ...board.mode, active: "custom", preset: null, cashMode: ticksOnlyTwoGunProjection({ projection: { sources } }) ? "twogun" : "current" };
}

export function boardWithWeights(board, slate, weights) {
  if (!board || board.ok === false || !Array.isArray(board.rows) || Object.keys(weights ?? {}).length === 0) return board;
  const ctx = contextOf(board, weights);
  const proj = projectionPlan(board, ctx);
  const own = ownershipPlan(board, ctx);
  const rows = board.rows.map((row) => rowWith(row, proj, own, ctx.labels));
  const recipes = { ...(board.recipes ?? {}) };
  if (proj.changed) recipes.projection = projectionText(proj, ctx, rows.length > 0);
  if (own.changed) recipes.ownership = ownershipText(own, ctx, rows.length > 0);
  // publishedWeight keeps the weight the board was published with beside the one this browser changed it to, so the Sources page can show
  // what was changed and put it back (public/js/sources-page-board.js).
  const sources = board.sources.map((s) => (ctx.published.has(s.id) && Object.hasOwn(weights, s.id) ? { ...s, weight: weights[s.id], publishedWeight: s.weight } : s));
  const mode = modeWith(board, ctx);
  return remergeOverrides({ ...board, rows, recipes, sources, ...(mode ? { mode } : {}) }, slate, publishedOverrides(board));
}
