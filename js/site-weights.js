// Source weights on the public site (D71): the board re-ranks in the browser from the baked board through the
// app's own pure modules (blend, ownership choice and recipe, remerge); a change is kept in this browser per season and week. The result
// is what server/rank/select.js applySources gives for the same ticks and weights (tests/site-weights-parity.test.mjs). Not redone
// here: a source off when the board was baked (nothing was fetched) and row.projStats (its stat lines are not kept): a re-blended man's catches and rush yards
// are set to missing, never left at the old sources' number, and the board's notes say so (siteNotes).
import { blendProjections, failedPositions, BLEND_FLAGS, projRecipe, filledText } from "../server/rank/blend.js";
import { dropsHisFigure, twogunPresetRecipes } from "../server/rank/select.js";
import { ownershipRecipe, ownershipOf } from "../server/rank/ownership-summary.js";
import { remergeOverrides } from "../server/rank/remerge.js";
import { isSidelined } from "../server/rank/sidelined.js";
import { toNumber } from "../server/rank/value-core.js";
import { espnStatusOf, statusChanged } from "../server/twogun/overlay.js";
import { TWOGUN_ID, PRESETS, ticksOnlyTwoGunProjection, presetOf, classicProjectionGaps } from "../server/sources/selection-core.js";
import { publishedOverrides, STORAGE_UNAVAILABLE_MESSAGE } from "./site-overrides.js";

export const WEIGHTS_PREFIX = "nfldfs-site-weights:";
export const weightsKey = (season, week) => `${WEIGHTS_PREFIX}${season}-w${String(week).padStart(2, "0")}`;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const validWeight = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

// TwoGun has a Projections card and an Ownership card under one id, so a stored weight is keyed by the card (weightKeyOf): "twogun" for his
// projections, "twogun:ownership" for his ownership. His cards carry readOnly in the baked board (the app's page ticks them through its own
// route); on the site they are as tunable as any other source (D71, Monday 11-09 orders item 6).
export const OWN_KEY = `${TWOGUN_ID}:ownership`;
export const weightKeyOf = (s) => (s.id === TWOGUN_ID && s.kind === "ownership" ? OWN_KEY : s.id);
const isHis = (s) => s.id === TWOGUN_ID;
export const tunableSources = (board) => (board?.sources ?? []).filter((s) => (s.kind === "projection" || s.kind === "ownership") && (s.readOnly !== true || isHis(s)));

/** The stored entries as { entries, unreadable }: unreadable (not JSON, or not an object) shows the published weights and is said (G62). */
function readStored(storage, season, week) {
  if (!storage) return { entries: {}, unreadable: false };
  try {
    const raw = JSON.parse(storage.getItem(weightsKey(season, week)) ?? "null");
    if (raw === null) return { entries: {}, unreadable: false };
    return isObject(raw) ? { entries: raw, unreadable: false } : { entries: {}, unreadable: true };
  } catch {
    return { entries: {}, unreadable: true };
  }
}

// An entry is { weight, was, kept? }: the visitor's weight against the weight the board was published with, and `kept`, the weight an unticked source keeps (the app keeps
// a source's weight while it is unticked, selection-change.js; the site records it so a tick back on, and the backups, use it).
const keptOf = (e) => (validWeight(e.kept) && e.kept > 0 ? e.kept : null);

/** The weights the visitor's saved changes make, `kept` weights, and what was set aside (G62): { weights, kept, setAside: { unreadable, dropped } }; an entry is used only while it was made against the published weight. */
export function readWeightsReport(storage, season, week, board) {
  const cards = new Map(tunableSources(board).map((s) => [weightKeyOf(s), s]));
  const { entries, unreadable } = readStored(storage, season, week);
  const weights = {};
  const kept = {};
  let dropped = 0;
  for (const [id, e] of Object.entries(entries)) {
    const card = cards.get(id);
    if (!card || !isObject(e) || !validWeight(e.weight) || e.was !== Number(card.weight)) { dropped += 1; continue; }
    const keptDiffers = keptOf(e) !== null && keptOf(e) !== (Number(card.storedWeight) > 0 ? Number(card.storedWeight) : null);
    if (e.weight === e.was && !keptDiffers) continue; // nothing changed: not a change to keep
    weights[id] = e.weight;
    if (keptOf(e) !== null) kept[id] = keptOf(e);
  }
  return { weights, kept, setAside: { unreadable, dropped } };
}

export function readWeights(storage, season, week, board) {
  return readWeightsReport(storage, season, week, board).weights;
}

/** The one line for what a read set aside, or null (G62): said at the Sources page foot, with the published weights showing for it. */
export function setAsideLine({ unreadable, dropped }) {
  if (unreadable) return "Your saved source changes for this week could not be read, so the published weights show.";
  if (dropped > 0) return `${dropped} of your saved source changes ${dropped === 1 ? "was" : "were"} made against an earlier publish, so the published weights show for ${dropped === 1 ? "it" : "them"}.`;
  return null;
}

// A patch names a source by id and, for TwoGun's two cards, by `kind` ("projection" | "ownership"); his id with no kind is refused as ambiguous.
function checkPatch(board, patch) {
  if (!isObject(patch)) return { error: { code: "VALIDATION_ERROR", message: "each source entry must be an object" } };
  const named = tunableSources(board).filter((s) => s.id === patch.id && (patch.kind === undefined || s.kind === patch.kind));
  if (named.length > 1) return { error: { code: "VALIDATION_ERROR", message: `source ${patch.id} has a projection and an ownership card; say which with kind` } };
  const source = named[0];
  if (!source) return { error: { code: "VALIDATION_ERROR", message: `unknown source id ${JSON.stringify(patch.id)}` } };
  if (patch.enabled !== undefined) return { error: { code: "READ_ONLY", message: "Sources cannot be switched on or off on the site; give one a weight of 0 to untick it. An unticked source still fills in for players the ticked ones miss, as in the app." } };
  if (!validWeight(patch.weight)) return { error: { code: "VALIDATION_ERROR", message: `source ${patch.id}: weight must be a finite number >= 0` } };
  if (patch.kept !== undefined && !(validWeight(patch.kept) && patch.kept > 0)) return { error: { code: "VALIDATION_ERROR", message: `source ${patch.id}: the weight kept while unticked must be a number above 0` } };
  return { source };
}

export const putWeight = (storage, season, week, board, patch) => putWeights(storage, season, week, board, [patch]);

/** "Back to the published weights": every saved change for the week removed, the kept weights of unticked sources with them. {} or { error }. */
export function clearStoredWeights(storage, season, week) {
  if (!storage) return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  try {
    storage.removeItem(weightsKey(season, week));
  } catch {
    return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  }
  return {};
}

export function putWeights(storage, season, week, board, patches) {
  const checked = patches.map((p) => checkPatch(board, p));
  const bad = checked.find((c) => c.error);
  if (bad) return bad;
  if (!storage) return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  const stored = readStored(storage, season, week).entries;
  patches.forEach((patch, i) => {
    const source = checked[i].source;
    const was = Number(source.weight);
    const key = weightKeyOf(source);
    const before = isObject(stored[key]) && stored[key].was === was ? stored[key] : null;
    const published = Number(source.storedWeight) > 0 ? Number(source.storedWeight) : null;
    // The weight an unticked source keeps: the one given, else the last weight it had here, else the one it was published with.
    const kept = patch.weight > 0 ? null : patch.kept ?? (before && before.weight > 0 ? before.weight : null) ?? (before ? keptOf(before) : null) ?? published;
    if (patch.weight === was && (kept === null || kept === published)) delete stored[key];
    else stored[key] = { weight: patch.weight, was, ...(kept !== null && kept !== published ? { kept } : {}) };
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
const sameIds = (a, b) => a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
const positiveWeight = (w) => (Number(w) > 0 ? Number(w) : 0);
const positives = (weights) => Object.fromEntries(Object.entries(weights).filter(([, w]) => w > 0)); // select.js tickedWeights / backupWeights keep only weights above 0
const labelOf = (s) => s.label ?? s.id;

/** What the board and the browser's weights say: the other tunable sources, every card's published weight (by weightKeyOf) and the weights now, and TwoGun's two cards.
 *  He is ticked or not as the board was baked (a published weight above 0) until the visitor ticks or weights him, and his figures take part either way:
 *  every baked row carries his projection and ownership beside the others' (projBySource, ownBySource). */
function contextOf(board, weights, kept = {}, status = null) {
  const all = tunableSources(board);
  const tunable = all.filter((s) => !isHis(s));
  const published = new Map(all.map((s) => [weightKeyOf(s), Number(s.weight)]));
  const now = (key) => (Object.hasOwn(weights, key) && published.has(key) ? weights[key] : published.get(key));
  const hisCard = (kind) => all.find((s) => isHis(s) && s.kind === kind);
  const proj = hisCard("projection");
  const own = hisCard("ownership");
  const projWith = (w) => (proj && (proj.recordCount ?? 0) > 0 ? positiveWeight(w) : 0); // counts only while he returned players (select.js liveProj)
  const ownWith = (w) => (own ? positiveWeight(w) : 0);
  const his = {
    projCard: proj,
    ownCard: own,
    projTicked: positiveWeight(now(TWOGUN_ID)) > 0, // the tick itself (select.js twogunUsed, ticksOnlyTwoGunProjection), whether or not he returned players
    projTickedPub: positiveWeight(published.get(TWOGUN_ID)) > 0,
    ownTicked: positiveWeight(now(OWN_KEY)) > 0,
    projW: projWith(now(TWOGUN_ID)),
    projWPub: projWith(published.get(TWOGUN_ID)),
    ownW: ownWith(now(OWN_KEY)),
    ownWPub: ownWith(published.get(OWN_KEY)),
    ownListed: Boolean(own) && board.rows.some((r) => r.ownBySource?.[TWOGUN_ID] != null)
  };
  const labels = { ...Object.fromEntries(tunable.map((s) => [s.id, labelOf(s)])), ...(proj || own ? { [TWOGUN_ID]: labelOf(proj ?? own) } : {}) };
  // In / Out as it stands now (Adam's published, with this browser's over it): `status` ({ id: "in" | "out" }) when the caller read it, else what the rows carry. A man marked In keeps
  // TwoGun's figure through his own OUT call (select.js dropsHisFigure), so the re-blend reads this, not only the published word.
  const markedIn = (row) => (status ? status[row.id] : row.override?.status) === "in";
  const statusMoved = Boolean(status) && board.rows.some((r) => r.tg?.call === "OUT" && markedIn(r) !== (r.override?.status === "in"));
  return { tunable, published, weights, kept, his, labels, state: board.injuryReport?.state ?? "ok", now, markedIn, statusMoved };
}

// The weight a source has in the backups, of `kind`: only the sources the "Our sources" preset ticks for that kind are backups (selection-core.js backupIds), whatever the
// choices tick; any other source has none. A visitor weight above 0 is the source's stored weight; a 0 only unticks it, and it stays a backup at the weight it kept (the visitor's
// last, else the one the board was baked with), as the app's controls leave it.
const isBackup = (kind, id) => PRESETS.ours[kind]?.sources?.[id]?.use === true;
const backupWith = (kind, published, weights, kept, baked) => (id) => {
  if (id === TWOGUN_ID || !isBackup(kind, id)) return 0;
  if (!published.has(id)) return Number(baked?.[id] ?? 0);
  if (weights[id] > 0) return weights[id];
  return kept[id] > 0 ? kept[id] : Number(baked?.[id] ?? 0);
};

// The fill rule for a man no ticked source covers, as the app reads the stored gaps (mode.gaps): "backup" fills; "blank" fills too once TwoGun is ticked for
// projections (selection-core.js classicProjectionGaps), never for ownership. A board baked before mode.gaps existed fills when it baked any backup.
const fillsProjection = (mode, his) => (typeof mode?.gaps?.projection === "string" ? mode.gaps.projection === "backup" || (mode.gaps.projection === "blank" && his.projTicked) : isObject(mode?.backupWeights));
const fillsOwnership = (mode) => (typeof mode?.gaps?.ownership === "string" ? mode.gaps.ownership === "backup" : isObject(mode?.backupOwnWeights));
const anyBackupOf = (mode, any, old) => (isObject(mode?.[any]) ? mode[any] : isObject(mode?.[old]) ? mode[old] : null);

/** Proj: the ticked sources (TwoGun's number included, last, as select.js has them), then the backups the board was baked with.
 *  Blends are done only when a projection weight changed; otherwise Proj stays as baked. */
function projectionPlan(board, { tunable, published, now, weights, kept, his, labels, state, markedIn, statusMoved }) {
  const live = tunable.filter((s) => s.kind === "projection" && s.enabled !== false && (s.recordCount ?? 0) > 0);
  const ids = [...live.map((s) => s.id), ...(his.projW > 0 ? [TWOGUN_ID] : [])];
  const pick = (weightOf) => positives(Object.fromEntries(ids.map((id) => [id, weightOf(id)])));
  const bakedBackup = fillsProjection(board.mode, his) ? anyBackupOf(board.mode, "backupAnyWeights", "backupWeights") : null;
  const backupOf = backupWith("projection", published, weights, kept, bakedBackup);
  // weightsMoved: a weight or tick differs from the published one; a kept weight (what an unticked source keeps) or a visitor's In on a man TwoGun calls OUT moves the figures too.
  const weightsMoved = live.some((s) => now(s.id) !== published.get(s.id)) || his.projW !== his.projWPub || his.projTicked !== his.projTickedPub;
  const plan = {
    weightsMoved,
    changed: weightsMoved || live.some((s) => kept[s.id] > 0) || statusMoved, // a kept weight is stored only when it differs from the published one
    ticked: pick((id) => (id === TWOGUN_ID ? his.projW : now(id))),
    backupW: bakedBackup ? pick(backupOf) : null,
    hisTicked: his.projW > 0
  };
  if (!plan.changed) return plan;
  // His OUT call keeps his figure out of the blend; Adam's In keeps it while it is above 0 (select.js dropsHisFigure, the one rule).
  const blendIn = new Map(board.rows.map((r) => [r.id, r.projBySource && TWOGUN_ID in r.projBySource && dropsHisFigure({ call: r.tg?.call, markedIn: markedIn(r), hisProj: r.projBySource[TWOGUN_ID] }) ? withoutTwogun(r.projBySource) : r.projBySource]));
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
function ownershipPlan(board, { tunable, published, now, weights, kept, his, markedIn, statusMoved }) {
  const live = tunable.filter((s) => s.kind === "ownership" && s.enabled !== false);
  const ids = new Set([...live.map((s) => s.id), ...(his.ownListed ? [TWOGUN_ID] : [])]);
  const weightsOf = (weightOf) => positives(Object.fromEntries([...ids].map((id) => [id, positiveWeight(weightOf(id))])));
  const bakedBackup = fillsOwnership(board.mode) ? anyBackupOf(board.mode, "backupAnyOwnWeights", "backupOwnWeights") : null;
  const weightsMoved = live.some((s) => now(s.id) !== published.get(s.id)) || his.ownW !== his.ownWPub;
  return {
    ids,
    markedIn,
    weightsMoved,
    changed: weightsMoved || live.some((s) => kept[s.id] > 0) || statusMoved,
    publishedOf: (id) => (id === TWOGUN_ID ? his.ownWPub : published.get(id)),
    ticked: weightsOf((id) => (id === TWOGUN_ID ? his.ownW : now(id))),
    backup: bakedBackup ? weightsOf(backupWith("ownership", published, weights, kept, bakedBackup)) : null,
    ran: tunable.filter((s) => s.kind === "ownership" && s.status !== "not run" && s.status !== "disabled") // select.js ownRan
  };
}

// The sentences of the board's recipes, as select.js classicRecipes words them for the same weights.
const projectionText = (plan, { labels, state }, rows) => projRecipe(plan.ticked, labels, state) + (rows ? filledText(plan.ticked, plan.backupW, projRecipe(plan.backupW, labels, state)) : "");
function ownershipText(plan, { labels }, rows) {
  const recipe = (w) => ownershipRecipe([...plan.ran.map((s) => ({ label: labels[s.id], weight: w?.[s.id] ?? 0 })), ...(w && TWOGUN_ID in w ? [{ label: labels[TWOGUN_ID], weight: w[TWOGUN_ID] }] : [])]);
  return recipe(plan.ticked) + (rows ? filledText(plan.ticked, plan.backup, recipe(plan.backup)) : "");
}

// The row's quotes per ownership source, as the board has them (select.js ownQuotesOf: his OUT call keeps his quote out). The row's own ownQuotes
// hold each file source's quote with its link; where a row has none for a source (a board baked before they were kept, or TwoGun's quote), the baked anchor
// keeps each quote's own source and url but not which source it came from: parts pair, in order, with the sources that made the baked Own
// (the row's srcUsed.own; on a board baked before that field, the sources published above 0) only when every pair's number matches (D29);
// else each quote shows its card label and no link.
function quotesOf(row, own, labels) {
  const out = row.tg?.call === "OUT" && !own.markedIn(row); // Adam's In keeps TwoGun's quote too (select.js)
  const ids = Object.keys(row.ownBySource ?? {}).filter((id) => own.ids.has(id) && !(out && id === TWOGUN_ID));
  const counted = Array.isArray(row.srcUsed?.own) ? row.srcUsed.own : ids.filter((id) => Number(own.publishedOf(id)) !== 0);
  const baked = row.ownAnchor?.parts;
  const paired = Array.isArray(baked) && baked.length === counted.length && counted.every((id, i) => baked[i]?.own === row.ownBySource[id]);
  return Object.fromEntries(ids.map((id) => {
    const quote = row.ownBySource[id];
    // The row carries each source's own quote with its link (row.ownQuotes, board.js) except for a number a source edit changed (the quote then names its card, as select.js ownQuotesOf does).
    const kept = id !== TWOGUN_ID && row.ownQuotes?.[id]?.own === quote ? row.ownQuotes[id] : null;
    if (kept) return [id, kept];
    const at = paired ? counted.indexOf(id) : -1;
    return [id, { own: quote, parts: [at >= 0 ? baked[at] : { own: quote, source: labels[id] ?? id, url: null }] }];
  }));
}

/** One row re-blended (select.js classicRow): Proj when a projection weight changed, Own when an ownership weight changed, and the ids that made them. */
function rowWith(row, proj, own, labels, markedIn) {
  const out = { ...row };
  // The ids that made Proj and Own. A figure this browser did not re-blend keeps what the board recorded; a board baked before the field
  // existed has none, and stays "not recorded" (null), never "recorded as empty".
  const used = { proj: row.srcUsed?.proj ?? null, own: row.srcUsed?.own ?? null };
  if (proj.changed) {
    const ticked = proj.blend.byPlayerId.get(row.id);
    // His OUT call while he is ticked is no gap: the backups never fill him.
    const fromBackup = Boolean(proj.backup) && ticked.blend === null && !(proj.hisTicked && row.tg?.call === "OUT" && !markedIn(row));
    const b = fromBackup ? proj.backup.byPlayerId.get(row.id) : ticked;
    const failed = ((fromBackup ? proj.failedForBackup : proj.failedForPos).get(row.pos) ?? []).filter((id) => row.projBySource?.[id] == null).map((id) => `sourceFailed:${id}`);
    out.projBase = b.proj;
    out.coverage = b.coverage;
    out.flags = [...b.flags, ...(row.flags ?? []).filter((f) => !BLEND_FLAGS.has(f) && !f.startsWith("sourceFailed:")), ...failed];
    used.proj = [...b.sources]; // the ids that made the re-blended Proj: the player card names these only
    // The stat lines behind catches and rush yards are not kept on the board, so they cannot be re-blended here: a man whose Proj is now made from other sources or comes out
    // another number has none (missing, never the old sources' number under new weights); a man whose Proj is the same number from the same sources keeps his. A defence or a
    // kicker keeps what he came with, as select.js projStatsOf does.
    const sameProj = Array.isArray(row.srcUsed?.proj) && sameIds(b.sources, row.srcUsed.proj) && b.proj === row.projBase;
    if (row.projStats && row.pos !== "DST" && row.pos !== "K" && !sameProj) out.projStats = null;
    if (row.src) out.src = { ...out.src, proj: used.proj.includes(TWOGUN_ID) ? TWOGUN_ID : "current" }; // where Proj came from (select.js classicRow)
  }
  if (own.changed) {
    const { anchor, used: ownUsed } = ownershipOf(quotesOf(row, own, labels), own.ticked, own.backup);
    out.ownBase = anchor ? anchor.own : null;
    out.ownKind = anchor ? "quoted" : null;
    out.ownAnchor = anchor;
    used.own = ownUsed;
    if (row.src) out.src = { ...out.src, own: ownUsed.includes(TWOGUN_ID) ? TWOGUN_ID : "current" };
  }
  if (proj.changed || own.changed) out.srcUsed = used;
  return out;
}

// The flags that follow TwoGun being used on a man (select.js classicRow: salaryDiffers and statusChangedAfterStamp while his number or his calls count;
// overlay.js markTeammatesAndStale: teammateOutAfterStamp and twogunStale), worked out again from each row's src once a tick moved it. They need only what the baked row
// carries (row.tg, row.src, the injury report's word) and the two facts the board records about his use (mode.twogunCalls, mode.twogun.stale).
const HIS_FLAGS = new Set(["salaryDiffers", "statusChangedAfterStamp", "teammateOutAfterStamp", "twogunStale"]);
function hisFlagsOf(rows, mode) {
  const calls = mode?.twogunCalls === true;
  const stale = mode?.twogun?.stale === true;
  const outTeams = new Set(rows.filter((r) => r.tg?.outAfterStamp).map((r) => r.team));
  return rows.map((r) => {
    if (!r.src) return r;
    const flags = (r.flags ?? []).filter((f) => !HIS_FLAGS.has(f));
    const t = r.tg;
    if (t && (calls || r.src.proj === TWOGUN_ID || r.src.own === TWOGUN_ID)) {
      if (t.salary !== null && t.salary !== toNumber(r.salary)) flags.push("salaryDiffers");
      if (!t.outAfterStamp && statusChanged(t, { espn: espnStatusOf(r) })) flags.push("statusChangedAfterStamp");
    }
    if (outTeams.has(r.team) && !t?.outAfterStamp && r.src.proj === TWOGUN_ID) flags.push("teammateOutAfterStamp");
    if (stale && Object.values(r.src).includes(TWOGUN_ID)) flags.push("twogunStale");
    return { ...r, flags };
  });
}

/** What a tick or a weight of TwoGun's changes beyond the rows (select.js finishClassic): how many men carry his number (mode.twogun.covered / fallback, left null
 *  while neither of his cards is ticked), how many carry his ownership (his ownership card's `matched`), and the stale list, which names him while he feeds the board and is not fresh. */
function hisBoardPieces(board, { his }) {
  const rows = board.rows;
  const used = his.projTicked || his.ownTicked;
  const covered = rows.filter((r) => r.src?.proj === TWOGUN_ID).length;
  const ownCovered = rows.filter((r) => r.src?.own === TWOGUN_ID).length;
  const mode = board.mode?.twogun
    ? { ...board.mode, twogun: { ...board.mode.twogun, covered: used ? covered : null, fallback: used ? rows.length - covered : null } }
    : board.mode;
  const sources = board.sources.map((s) => (isHis(s) && s.kind === "ownership" ? { ...s, matched: ownCovered } : s));
  // `twogunBesides` is the board's own fact: his lines or calls feed it even with neither card ticked. A board baked before the field existed keeps its stale list.
  let stale = board.stale;
  if (typeof board.mode?.twogunBesides === "boolean" && board.mode.twogun) {
    const feeds = used || board.mode.twogunBesides;
    const others = (board.stale ?? []).filter((id) => id !== TWOGUN_ID);
    stale = feeds && board.mode.twogun?.status !== "ok" ? [...others, TWOGUN_ID] : others;
  }
  return { ...board, mode, sources, ...(stale ? { stale } : {}) };
}

/**
 * The choices as they stand under the visitor's ticks, read as the board view reads them (selection.js effectiveOf, selection-core.js classicProjectionGaps): the choices the
 * board was baked from (mode.choices) with each source card's tick and weight replaced by the visitor's. null for a board baked before mode.choices existed.
 */
function choicesNow(board, { kept, now, published }) {
  const base = board.mode?.choices;
  if (!isObject(base?.projection?.sources) || !isObject(base?.ownership?.sources)) return null;
  const kinds = structuredClone(base);
  for (const card of tunableSources(board)) {
    const key = weightKeyOf(card);
    const sources = kinds[card.kind]?.sources;
    if (!sources || !published.has(key)) continue;
    const w = now(key);
    const there = sources[card.id];
    const stored = w > 0 ? w : kept[key] ?? (Number(card.storedWeight) >= 0 ? Number(card.storedWeight) : there?.weight ?? 1);
    if (w > 0 || there) sources[card.id] = { use: w > 0, weight: stored };
  }
  return classicProjectionGaps(kinds);
}

const PRESET_ACTIVE = { twogun: "twogun", ours: "current" };

/**
 * The mode block after a weight moved: the ticks may or may not land on a preset (selection-core.js presetOf, the app's own test), so the app says which, or custom; cashMode
 * follows the ticks (select.js modeOf). A board baked before mode.choices existed says custom.
 */
function modeWith(board, ctx) {
  const { tunable, published, now, his } = ctx;
  if (!board.mode || [...published].every(([key, w]) => now(key) === w)) return board.mode;
  const kinds = choicesNow(board, ctx);
  if (kinds) {
    const preset = presetOf({ kinds }, "classic");
    return { ...board.mode, active: PRESET_ACTIVE[preset] ?? "custom", preset, cashMode: ticksOnlyTwoGunProjection(kinds) ? "twogun" : "current" };
  }
  const sources = Object.fromEntries([...tunable.filter((s) => s.kind === "projection").map((s) => [s.id, { use: now(s.id) > 0 }]), [TWOGUN_ID, { use: his.projTicked }]]);
  return { ...board.mode, active: "custom", preset: null, cashMode: ticksOnlyTwoGunProjection({ projection: { sources } }) ? "twogun" : "current" };
}

/** The projection-stats line (G62): said once on a board whose men had catches and rush yards that a projection change set to missing. */
export const PROJ_STATS_LINE = "Catches and rush yards are not re-worked in your browser, so they show as missing for the men whose projection your source weights changed.";

/**
 * `board` re-ranked under the visitor's `weights` ({ weight key: weight }) and `kept` ({ weight key: the weight an unticked source keeps }), as readWeightsReport gives them.
 * `status` ({ id: "in" | "out" }, site-overrides.js effectiveStatus): the In / Out now in force (Adam's published with this browser's). A man TwoGun calls OUT whom the visitor
 * marked In (or took the In from) is re-blended even with no weight changed, as the app blends him (select.js dropsHisFigure).
 */
export function boardWithWeights(board, slate, weights, kept = {}, status = null) {
  if (!board || board.ok === false || !Array.isArray(board.rows)) return board;
  const ctx = contextOf(board, weights ?? {}, kept ?? {}, status);
  const hasWeights = Object.keys(weights ?? {}).length > 0;
  if (!hasWeights && !ctx.statusMoved) return board;
  const proj = projectionPlan(board, ctx);
  const own = ownershipPlan(board, ctx);
  let rows = board.rows.map((row) => rowWith(row, proj, own, ctx.labels, ctx.markedIn));
  if ((proj.changed || own.changed) && (ctx.his.projCard || ctx.his.ownCard)) rows = hisFlagsOf(rows, board.mode);
  const mode = modeWith(board, ctx);
  // The sentences: when the preset the board is labelled with changes (to custom, to "Our sources", or onto "TwoGun only"), both are worded as that preset's (select.js classicRecipes);
  // a kind whose weights moved is worded again; a kept weight alone changes the wording of a custom board and leaves a preset's as baked.
  const bakedPreset = board.mode?.preset ?? null;
  const presetChanged = mode !== board.mode && (mode?.preset ?? null) !== bakedPreset;
  const recipes = { ...(board.recipes ?? {}) };
  if (mode !== board.mode && mode?.preset === "twogun" && isObject(board.mode?.twogun)) {
    const twogun = board.mode.twogun;
    Object.assign(recipes, twogunPresetRecipes({ labels: ctx.labels, state: ctx.state, kinds: choicesNow(board, ctx), projB: proj.backupW ? { weights: proj.backupW } : null, ownB: own.backup, ownRan: own.ran,
      tg: { usable: twogun.status === "ok" || twogun.status === "stale", status: twogun.status, load: twogun } }, recipes, rows));
  } else {
    const rewrite = (plan) => plan.weightsMoved || presetChanged || (plan.changed && !bakedPreset);
    if (rewrite(proj)) recipes.projection = projectionText(proj, ctx, rows.length > 0);
    if (rewrite(own)) recipes.ownership = ownershipText(own, ctx, rows.length > 0);
  }
  // publishedWeight keeps the weight the board was published with beside the one this browser changed it to, so the Sources page can show
  // what was changed and put it back (public/js/sources-page-board.js).
  // storedWeight is the weight the source keeps while unticked (the app's stored weight): the visitor's last, else the published one.
  const sources = board.sources.map((s) => {
    const key = ctx.published.has(weightKeyOf(s)) && tunableSources({ sources: [s] }).length ? weightKeyOf(s) : null;
    if (key === null || !Object.hasOwn(weights ?? {}, key)) return s;
    const stored = weights[key] > 0 ? weights[key] : kept[key] ?? s.storedWeight;
    // publishedStoredWeight: the weight the card kept as published, beside the visitor's, so a change to the kept weight alone counts as a change (isLocallyChanged).
    return { ...s, weight: weights[key], ...("use" in s ? { use: weights[key] > 0 } : {}), ...(stored !== undefined ? { storedWeight: stored } : {}), ...(s.storedWeight !== undefined ? { publishedStoredWeight: s.storedWeight } : {}), publishedWeight: s.weight };
  });
  // The men whose catches and rush yards were set to missing: the board's one line says so only when there are any (G62).
  const cleared = rows.filter((r, i) => r.projStats === null && board.rows[i].projStats).length;
  const siteNotes = [...(board.siteNotes ?? []), ...(cleared > 0 ? [PROJ_STATS_LINE] : [])];
  // siteStored: the visitor has changes saved for the week (the Sources page offers to put them all back, whether or not they moved a figure).
  const merged = remergeOverrides({ ...board, rows, recipes, sources, ...(hasWeights ? { siteStored: true } : {}), ...(siteNotes.length ? { siteNotes } : {}), ...(mode ? { mode } : {}) }, slate, publishedOverrides(board));
  return ctx.his.projCard || ctx.his.ownCard ? hisBoardPieces(merged, ctx) : merged;
}
