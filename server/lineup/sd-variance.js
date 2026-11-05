// The Showdown GPP Optimizer's variance (settings.variance, the typed percent; optimizer-parity row, NBA's shipped code): each
// lineup's search runs on varied figures, on top of minimum unique, while every number shown stays real. One factor per man per
// lineup, shared by his Captain and FLEX candidates, so the 1.5x stays exact. Seeded from a fixed constant plus the saved lineups'
// count plus the lineup index (sd-rng.js), never the clock, so a request on the same saved lineups is repeatable and a build after
// a save draws afresh. Pure and browser-safe (D71): the public site runs this copy.
import { makeRng } from "./sd-rng.js";

const VARIANCE_SEED = 0x56415249; // fixed, so one request always varies alike

/** Absent or 0 is off; anything but a number from 0 to 100 (decimals allowed) gets this sentence (the route's 400). */
export const VARIANCE_RANGE_SENTENCE = "Variance must be a percent from 0 to 100.";
/** Cash refuses it as it refuses the other GPP-only settings, in classic's words (cash.js CASH_NOTES). */
export const VARIANCE_CASH_SENTENCE = "Variance does not apply in cash mode.";

/** The refusal sentence for a settings.variance value, or null when it is absent or a percent from 0 to 100. */
export function varianceError(value) {
  if (value === undefined) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? null : VARIANCE_RANGE_SENTENCE;
}

/** The percent a value turns on: above 0 up to 100, else 0 (off), so the caller's off path is untouched. */
export function variancePercent(value) {
  return value !== undefined && varianceError(value) === null ? value : 0;
}

/** The build note on a varied batch, with the percent as typed. */
export const varianceNote = (percent) => `Variance ±${percent}%: each lineup was searched on varied projections; the numbers shown are the real ones.`;

/**
 * One lineup's factors: person id -> a uniform factor in 1 ± percent/100. Drawn over the ids in sorted order, so a man's factor
 * does not depend on the order of the rows. `index`: the saved lineups' count plus the lineup's index in this batch.
 */
export function lineupFactors(personIds, index, percent) {
  const rng = makeRng(VARIANCE_SEED + index);
  const spread = percent / 100;
  const factors = new Map();
  for (const id of [...personIds].map(String).sort()) factors.set(id, 1 - spread + 2 * spread * rng());
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
