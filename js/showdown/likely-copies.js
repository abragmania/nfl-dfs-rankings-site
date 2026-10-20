// Showdown meter: how unique a lineup will most likely be, in plain counts (Adam 2026-10-20: "I don't care about the % chance
// nobody else has it, I just want to know how unique it will most likely be"). Pure and browser-safe; a separate file because
// lineup-meter.js is past 600 lines. lineup-meter.js re-exports likelyCopies; optimizer-view.js uses likelyRangeText.

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

const count = (n) => n.toLocaleString("en-US");

/** "0 to 2" (the range the count usually falls in), or just "0" when the range is a single number. */
function rangeWords(l) {
  return l.low === l.high ? count(l.low) : `${count(l.low)} to ${count(l.high)}`;
}

/** "likely 0 to 2" for a generated card's strip; null when copies cannot be read. */
export function likelyRangeText(copies) {
  const l = likelyCopies(copies);
  return l ? `likely ${rangeWords(l)}` : null;
}

/** The meter's fact line: "Most likely 3 other entries have this exact lineup (usually 1 to 6)", "Most likely no other entry has
 *  this exact lineup (usually 0 to 2)", "Most likely 1 other entry has this exact lineup (usually 0 to 2)"; null when unreadable.
 *  The bracket is left off when the range is one number (a lineup nobody else is expected to hold). */
export function likelyFactText(copies) {
  const l = likelyCopies(copies);
  if (!l) return null;
  const head = l.mostLikely === 0 ? "Most likely no other entry has this exact lineup"
    : l.mostLikely === 1 ? "Most likely 1 other entry has this exact lineup"
      : `Most likely ${count(l.mostLikely)} other entries have this exact lineup`;
  return l.low === l.high ? head : `${head} (usually ${rangeWords(l)})`;
}
