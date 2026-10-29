// Showdown meter: how unique a lineup will most likely be, in plain counts (Adam 2026-10-20: "I don't care about the % chance
// nobody else has it, I just want to know how unique it will most likely be"). Pure and browser-safe; a separate file because
// lineup-meter.js is about 555 lines, under the 600-line ceiling. lineup-meter.js re-exports likelyCopies; optimizer-view.js uses likelyRangeText.

// The largest mean read: the server accepts a field up to 10,000,000 (server/showdown/uniqueness-routes.js MAX_FIELD) and
// copies = field x p can never exceed the field, so no real board reaches more. A larger mean is null at once rather than a loop of
// 1e8 or more terms (at 2^53 the counter would stop moving and hang the tab). The app itself sends no field; the default is 100,000.
const MAX_MEAN = 10000000;

// The most terms the Poisson sum may run for a mean: the 90% point of a Poisson sits within a few standard deviations of the mean,
// so mean + 10 standard deviations + 50 is never reached by a normal run and only guards the loop.
const maxTerms = (mean) => Math.ceil(mean + 10 * Math.sqrt(mean) + 50);

/**
 * The most likely number of OTHER entries holding this exact lineup, and the range it usually falls in, from the server's expected
 * copies: { mostLikely, low, high }, or null when `copies` is not a finite number >= 0, is above MAX_MEAN (10,000,000), or the sum
 * runs past maxTerms.
 * The number of other entries holding this exact lineup is taken as Poisson with mean = copies (the same large-field
 * approximation the server's alone chance rests on, server/lineup/sd-uniqueness.js: alone chance = (1-p)^(N-1) ~ e^-copies).
 * The count of OTHER entries has mean copies x (field - 1) / field, which differs from copies by at most copies / field (the lineup's
 * own p) and moves a shown number only when the mean sits on a boundary, so copies is used as the mean; the app sends no field.
 * mostLikely is the Poisson mode, floor(copies + 1e-9) (for a whole-number mean m, m-1 and m are equally likely and m is shown, so a
 * mean that is whole up to rounding error reads as m, which keeps the headline figure and the sentence agreeing).
 * low is the smallest k whose cumulative probability is at least 0.10 and high the smallest k whose cumulative probability
 * is at least 0.90, both by direct summation of the Poisson terms p(k) = e^-copies * copies^k / k!, kept in log form
 * (log p(k) = log p(k-1) + log(copies) - log(k)) so a large mean cannot underflow its first term.
 */
export function likelyCopies(copies) {
  if (typeof copies !== "number" || !Number.isFinite(copies) || copies < 0 || copies > MAX_MEAN) return null;
  const mostLikely = Math.floor(copies + 1e-9);
  if (copies === 0) return { mostLikely: 0, low: 0, high: 0 };
  const logMean = Math.log(copies);
  let logTerm = -copies; // log p(0)
  let cumulative = 0;
  let low = null;
  const terms = maxTerms(copies);
  for (let k = 0; k < terms; k++) {
    if (k > 0) logTerm += logMean - Math.log(k);
    cumulative += Math.exp(logTerm);
    if (low === null && cumulative >= 0.1) low = k;
    if (cumulative >= 0.9) return { mostLikely, low, high: k };
  }
  return null;
}

// ---------- the wider spread (RULES.md D82; the meter plan 2026-10-25 section 7, check 6) ----------
// Real fields are clumpier than random draws, so on the held-out nights the Poisson 10% to 90% range held the real count far
// less often than its nominal 80%. When the answer's `spread` is { kind: "negative-binomial", size }, the "usually a to b" words
// use a negative binomial with the same mean (variance = mean + mean^2 / size, the fit tool's definition). It widens those
// words only: the headline copies figure is the model's mean, and the "most likely" count stays the Poisson mode of that mean
// (a negative binomial of size under 1 peaks at 0 for every mean, which would read "most likely no other entry" for a chalky lineup).

/** The most terms a negative-binomial sum may run (a mean of 100,000 at size 0.3 needs about 2 million): past it the range is null rather than a hung tab. */
const NB_MAX_TERMS = 5000000;

/**
 * The negative binomial's 10% and 90% points (the smallest k reaching each, as likelyCopies reads the Poisson's) for a mean and a
 * size above 0: { low, high }; null past NB_MAX_TERMS (a caller that cannot go without the range throws on null). The one home of
 * this function: the fit tool (server/lineup/sd-field-curves-fit.js) imports it from here.
 */
export function negBinRange(mean, size) {
  if (mean === 0) return { low: 0, high: 0 };
  const q = mean / (mean + size);
  let term = Math.exp(size * Math.log(size / (size + mean))); // P(0)
  const sd = Math.sqrt(mean + (mean * mean) / size);
  const terms = Math.ceil(mean + 10 * sd + 50);
  if (terms > NB_MAX_TERMS) return null;
  let cumulative = 0;
  let low = null;
  for (let k = 0; k < terms; k++) {
    if (k > 0) term *= ((k - 1 + size) / k) * q;
    cumulative += term;
    if (low === null && cumulative >= 0.1) low = k;
    if (cumulative >= 0.9) return { low, high: k };
  }
  return null;
}

/** Whether a spread setting asks for the negative binomial: { kind: "negative-binomial", size } with a finite size above 0. */
const isWider = (spread) => spread?.kind === "negative-binomial" && typeof spread.size === "number" && Number.isFinite(spread.size) && spread.size > 0;

/**
 * likelyCopies with the answer's spread (Poisson when `spread` is missing, "poisson" or unreadable): { mostLikely, low, high },
 * mostLikely always the Poisson mode of the mean, low and high the spread's 10% and 90% points widened to hold it.
 */
export function likelyCopiesSpread(copies, spread = null) {
  const base = likelyCopies(copies);
  if (!base || !isWider(spread) || copies === 0) return base;
  const wide = negBinRange(copies, spread.size);
  if (!wide) return base;
  return { mostLikely: base.mostLikely, low: Math.min(wide.low, base.mostLikely), high: Math.max(wide.high, base.mostLikely) };
}

/** The hover on the most-likely fact line: what it is computed from. Poisson unless the answer carries a wider spread. */
export function likelyBasisText(spread = null) {
  return isWider(spread)
    ? "From the expected copies: the most likely number of other entries with this exact lineup is read as a Poisson count, and the range is the 10% and 90% points of a wider spread fitted on past nights, because real fields repeat a lineup in clumps."
    : POISSON_BASIS;
}

/** The Poisson hover text (lineup-meter.js re-exports it as LIKELY_BASIS). */
export const POISSON_BASIS = "From the expected copies, as a Poisson count: the most likely number of other entries with this exact lineup, and the range between its 10% and 90% points.";

const count = (n) => n.toLocaleString("en-US");

/** "0 to 2" (the range the count usually falls in), or just "0" when the range is a single number. */
function rangeWords(l) {
  return l.low === l.high ? count(l.low) : `${count(l.low)} to ${count(l.high)}`;
}

/** "likely 0 to 2" for a generated card's strip; null when copies cannot be read. `spread`: the answer's (uniqueness.spread). */
export function likelyRangeText(copies, spread = null) {
  const l = likelyCopiesSpread(copies, spread);
  return l ? `likely ${rangeWords(l)}` : null;
}

/** The meter's small line under a Unique verdict, whose own sentence already says nobody else most likely has it: only the
 *  usual range, "Usually 0 to 2 other entries" ("Usually no other entry" when the range is 0 alone); null when unreadable. */
export function usuallyText(copies, spread = null) {
  const l = likelyCopiesSpread(copies, spread);
  if (!l) return null;
  if (l.high === 0) return "Usually no other entry";
  return `Usually ${rangeWords(l)} other ${l.low === l.high && l.low === 1 ? "entry" : "entries"}`;
}

/** The meter's fact line: "Most likely 3 other entries have this exact lineup (usually 1 to 6)", "Most likely no other entry has
 *  this exact lineup (usually 0 to 2)", "Most likely 1 other entry has this exact lineup (usually 0 to 2)"; null when unreadable.
 *  The bracket is left off when the range is one number (a lineup nobody else is expected to hold). `spread`: the answer's (uniqueness.spread). */
export function likelyFactText(copies, spread = null) {
  const l = likelyCopiesSpread(copies, spread);
  if (!l) return null;
  const head = l.mostLikely === 0 ? "Most likely no other entry has this exact lineup"
    : l.mostLikely === 1 ? "Most likely 1 other entry has this exact lineup"
      : `Most likely ${count(l.mostLikely)} other entries have this exact lineup`;
  return l.low === l.high ? head : `${head} (usually ${rangeWords(l)})`;
}
