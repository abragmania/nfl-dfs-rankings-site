// The GPP Optimizers' variance, classic and Showdown (optimizer-parity row, NBA's shipped code; per position, Adam 3:26 PM
// 2026-11-11, PROJECT.md Part 4 item 5): each lineup's search runs on varied figures, on top of minimum unique, while every number
// shown stays real. settings.variancePos = {QB, RB, WR, TE, DST (and K on Showdown)}, each a percent from 0 to 100 or absent; the
// older settings.variance (one percent) applies to every position when variancePos is absent. One factor per man per lineup,
// uniform in 1 ± his DraftKings position's percent, shared by his Captain and FLEX candidates, so the 1.5x stays exact. Seeded from
// a fixed constant plus the saved lineups' count plus the lineup index (sd-rng.js), never the clock, so a request on the same
// saved lineups is repeatable and a build after a save draws afresh. Pure and browser-safe (D71): the public site runs this copy.
import { makeRng } from "./sd-rng.js";

const VARIANCE_SEED = 0x56415249; // fixed, so one request always varies alike

/** The positions a classic and a Showdown variance may name, in the order a note lists them. */
export const CLASSIC_VARIANCE_POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "DST"]);
export const SHOWDOWN_VARIANCE_POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "DST", "K"]);

/** Absent or 0 is off; anything but a number from 0 to 100 (decimals allowed) gets this sentence (the route's 400). */
export const VARIANCE_RANGE_SENTENCE = "Variance must be a percent from 0 to 100.";
/** Cash refuses it as it refuses the other GPP-only settings, in classic's words (cash.js CASH_NOTES). */
export const VARIANCE_CASH_SENTENCE = "Variance does not apply in cash mode.";
/** A request carrying both the single percent and the percents by position (the route's 400). */
export const VARIANCE_BOTH_SENTENCE = "Variance must be one percent or percents by position, not both.";
const VARIANCE_POS_SHAPE_SENTENCE = "Variance by position must be an object of percents by position.";

const isPct = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const listWords = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list.join(""));

/** The refusal sentence for a settings.variance value, or null when it is absent or a percent from 0 to 100. */
export function varianceError(value) {
  if (value === undefined) return null;
  return isPct(value) ? null : VARIANCE_RANGE_SENTENCE;
}

/** The percent a value turns on: above 0 up to 100, else 0 (off), so the caller's off path is untouched. */
export function variancePercent(value) {
  return value !== undefined && varianceError(value) === null ? value : 0;
}

/** The refusal sentence for a settings.variancePos value against `positions`, or null when it is absent or every entry is a percent from 0 to 100 at a listed position. */
export function variancePosError(value, positions) {
  if (value === undefined) return null;
  if (!isPlainObject(value)) return VARIANCE_POS_SHAPE_SENTENCE;
  for (const [pos, pct] of Object.entries(value)) {
    if (!positions.includes(pos)) return `Variance has no ${pos} position; it takes ${listWords(positions)}.`;
    if (!isPct(pct)) return `${pos} variance must be a percent from 0 to 100.`;
  }
  return null;
}

/** The route's one check of a request's variance (classic and Showdown): the sentence that refuses it, or null. */
export function varianceRequestError(raw, positions) {
  const single = varianceError(raw?.variance);
  if (single) return single;
  const byPos = variancePosError(raw?.variancePos, positions);
  if (byPos) return byPos;
  return raw?.variance !== undefined && raw?.variancePos !== undefined ? VARIANCE_BOTH_SENTENCE : null;
}

/**
 * The percents a build varies by, {pos: pct} holding only the positions above 0, or null when none is (off: the caller's
 * unvaried path, byte for byte). variancePos when it is given (its unusable entries left out), else the single variance at
 * every position. Pure.
 */
export function resolveVariance(settings, positions) {
  const s = isPlainObject(settings) ? settings : {};
  const out = {};
  if (s.variancePos !== undefined) {
    if (isPlainObject(s.variancePos)) for (const pos of positions) if (isPct(s.variancePos[pos]) && s.variancePos[pos] > 0) out[pos] = s.variancePos[pos];
  } else {
    const pct = variancePercent(s.variance);
    if (pct > 0) for (const pos of positions) out[pos] = pct;
  }
  return Object.keys(out).length ? out : null;
}

/** What an engine handed a variance the route would refuse says (the route refuses it first): each sentence and what was done instead (G62: nothing ignored silently). */
export function varianceIgnoredNotes(settings, positions) {
  const s = isPlainObject(settings) ? settings : {};
  const out = [];
  if (s.variancePos === undefined) {
    if (varianceError(s.variance)) out.push(`${varianceError(s.variance)} It was ignored.`);
    return out;
  }
  if (s.variance !== undefined) out.push(`${VARIANCE_BOTH_SENTENCE} The percents by position were used.`);
  if (!isPlainObject(s.variancePos)) out.push(`${VARIANCE_POS_SHAPE_SENTENCE} It was ignored.`);
  else for (const [pos, pct] of Object.entries(s.variancePos)) if (!positions.includes(pos) || !isPct(pct)) out.push(`${variancePosError({ [pos]: pct }, positions)} It was ignored.`);
  return out;
}

/** The build note on a varied batch, one short line with each percent as typed: "Variance QB 5 · WR 15 · TE 15". `byPos`: resolveVariance's answer. */
export const varianceNote = (byPos) => `Variance ${SHOWDOWN_VARIANCE_POSITIONS.filter((pos) => byPos[pos] > 0).map((pos) => `${pos} ${byPos[pos]}`).join(" · ")}`;

/**
 * One lineup's factors: person id -> a uniform factor in 1 ± his position's percent/100. Drawn over the ids in sorted order, one
 * draw per man whatever his percent, so a man's factor depends neither on the order of the rows nor on the other positions'
 * percents; a man at a position with no percent keeps exactly 1. `index`: the saved lineups' count plus the lineup's index in
 * this batch. `percents`: one number for every man (the single variance), or {pos: pct} with `posOf(id)` naming his position.
 */
export function lineupFactors(personIds, index, percents, posOf = () => null) {
  const rng = makeRng(VARIANCE_SEED + index);
  const spreadOf = typeof percents === "number" ? () => percents / 100 : (id) => (percents[posOf(id)] ?? 0) / 100;
  const factors = new Map();
  for (const id of [...personIds].map(String).sort()) {
    const spread = spreadOf(id);
    factors.set(id, 1 - spread + 2 * spread * rng());
  }
  return factors;
}

/** The candidates a search sees: each one's score times his man's factor, his salary, projection and ids untouched. */
export function variedPool(list, factors) {
  return list.map((c) => ({ ...c, score: c.score * factors.get(c.personId) }));
}

/** The real pool candidates behind a varied search's lineup (`best`, or null when it found none), by candidate id. */
export function realMen(best, poolById) {
  return best ? best.map((c) => poolById.get(c.id)) : best;
}

/**
 * A varied batch's answer order: best real total first (`objective`'s own total, the projection or the median), a tie in search
 * order. Lineups are made in varied order, so without this the batch would read in no order. bends and problems name a lineup by
 * its place, so they are renumbered with it. New arrays; the inputs are left as they are. Pure.
 */
export function byRealTotal(lineups, bends, problems, objective) {
  const total = (l) => l[objective] ?? -Infinity;
  const order = lineups.map((l, i) => i).sort((a, b) => total(lineups[b]) - total(lineups[a]) || a - b);
  const placeOf = new Map(order.map((from, to) => [from + 1, to + 1]));
  const renumber = (list) => list.map((e) => ({ ...e, lineup: placeOf.get(e.lineup) })).sort((a, b) => a.lineup - b.lineup);
  return { lineups: order.map((i) => lineups[i]), bends: renumber(bends), problems: renumber(problems) };
}
