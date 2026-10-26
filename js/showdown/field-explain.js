// Showdown meter, the field model's words (RULES.md D82; the meter plan 2026-10-25 sections 8 and 12 step 5, Adam 2026-10-18
// "show the calculation"): the calculation sentence, the "about" rounding, the scale's two ends from the answer, and the
// "estimate" label with the basis it carries on hover. Pure and browser-safe, a separate file because lineup-meter.js is about
// 555 lines, under the 600-line ceiling. Every figure here comes from the server's answer (`parts`, `left`, `gap`, `scale`, `model`); nothing is a
// number typed in by hand except the two fall-back ends of the scale and the 10-copy line below which a figure is an estimate.
import { escapeHtml, money, dec1 } from "../format.js";

const COPIES_FLOOR = 0.01; // below this a figure reads "<0.01"

/** Two significant figures, thousands separated: 2.4 -> "2.4", 0.034 -> "0.034", 41234 -> "41,000". null/NaN -> null. */
export function sigFig2(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n.toLocaleString("en-US", { maximumSignificantDigits: 2 });
}

/** The headline figure: expected copies written plainly, two significant figures ("0.3", "4.1", "22", "59"), "<0.01" below 0.01.
 *  The one copy of this helper (lineup-meter.js re-exports it); the calculation sentence uses it so its last step equals the headline. */
export function copiesText(copies) {
  if (typeof copies !== "number" || !Number.isFinite(copies)) return null;
  if (copies < COPIES_FLOOR) return "<0.01";
  return sigFig2(copies);
}

/** Which way the calculation line is shown, for the first-draft render (Adam sees both): "A" a small grey line under the
 *  facts (and the same sentence on the headline's hover); "B" the sentence only on the headline's hover. The lead flips this
 *  one constant; meterHtml also takes `calc` ("A" | "B") in its view argument, which wins over it. */
export const CALC_DIRECTION = "A";

/** The scale's ends when an answer carries no anchors (a mismatched pair of files still draws): 1 copy at the unique end,
 *  100 at the chalky end, and the end labels then read as before (the words alone). */
export const FALLBACK_UNIQUE_END = 1;
export const FALLBACK_CHALKY_END = 100;

/** Every figure under this many copies is labelled an estimate (the plan, section 8; the held-out ratios behind it, worst at the
 *  rare end, are in data/showdown-field/curves.json under heldOut and reach the screen as the answer's model.bands). */
export const ESTIMATE_BELOW = 10;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * The expected copies in the "about" rounding, as the number only: under 1 reads "under 1"; 1 to 9.9 a whole number; 10 and
 * up one significant figure, thousands separated ("40", "300", "1,000"). null when `n` is not a finite number >= 0.
 */
export function aboutNumber(n) {
  if (!isNum(n) || n < 0) return null;
  if (n < 1) return "under 1";
  if (n < 10) return String(Math.round(n));
  let mag = 10 ** Math.floor(Math.log10(n));
  if (n / mag >= 10) mag *= 10;
  else if (n / mag < 1) mag /= 10;
  return (Math.round(n / mag) * mag).toLocaleString("en-US");
}

/** "about 40", "about 6", or "under 1" (the word "about" goes before every figure but the one that is under 1); null when unreadable. */
export function aboutCopies(n) {
  const s = aboutNumber(n);
  return s === null ? null : n < 1 ? s : `about ${s}`;
}

/** "about 40 copies", "about 1 copy", "under 1 copy": the figure in the "about" rounding with its noun; null when unreadable. */
export function aboutCopiesWords(n) {
  const s = aboutCopies(n);
  return s === null ? null : `${s} ${n < 1 || aboutNumber(n) === "1" ? "copy" : "copies"}`;
}

/**
 * Which "best" the gap is under: " the best" normally; " the slate's best (104.2, before your excludes)" when the slate's best
 * (the answer's fieldBestProj, no excludes) differs from the best the strip shows (bestProj, with Adam's excludes), so the two
 * figures never read as one. Either figure missing: " the best".
 */
export function bestWords(fieldBestProj, bestProj) {
  if (isNum(fieldBestProj) && isNum(bestProj) && Math.abs(fieldBestProj - bestProj) >= 0.005) return ` the slate's best (${dec1(fieldBestProj)}, before your excludes)`;
  return " the best";
}

/**
 * The calculation sentence from an answer's uniqueness (`u`): "Ownership alone says 0.3 copies. Counting $200 left: 1.1.
 * Counting 1.4 points under the best: 38." Salary left first, then the gap, as the model applies them; figures are the
 * headline's own two-figure text, so the last step equals the headline. The straight ownership product appears here and
 * nowhere else (never as a headline). `bestProj`: the best the strip shows (the answer's, with excludes), to word the gap's
 * "best" (bestWords). null when the answer lacks `parts`, `left` or `gap` (an older answer, or a lineup with no figures).
 */
export function calcSentence(u, bestProj = null) {
  const parts = u?.parts;
  if (!parts || ![parts.ownershipOnly, parts.withLeft, parts.withGap].every(isNum)) return null;
  if (!isNum(u.left?.dollars) || !isNum(u.gap?.belowPts)) return null;
  const alone = copiesText(parts.ownershipOnly);
  const below = u.gap.belowPts;
  const best = bestWords(u.fieldBestProj, bestProj);
  const gapWords = below < 0 ? `${dec1(-below)} points over${best}` : `${dec1(below)} points under${best}`;
  return `Ownership alone says ${alone === "1" ? "1 copy" : `${alone} copies`}. Counting ${money(u.left.dollars)} left: ${copiesText(parts.withLeft)}. Counting ${gapWords}: ${copiesText(parts.withGap)}.`;
}

/**
 * The scale's two ends in expected copies from the answer's `scale` ({uniqueEnd, chalkyEnd}): { unique, chalky, fallback }.
 * Both must be finite, above 0 and in order, else the fall-back 1 and 100 are used and `fallback` is true.
 */
export function scaleAnchors(scale) {
  const u = scale?.uniqueEnd;
  const c = scale?.chalkyEnd;
  if (isNum(u) && isNum(c) && u > 0 && c > u) return { unique: u, chalky: c, fallback: false };
  return { unique: FALLBACK_UNIQUE_END, chalky: FALLBACK_CHALKY_END, fallback: true };
}

/**
 * The small notes under the scale's two words, from the answer's anchors: { unique: "about 2 copies" | "under 1 copy",
 * chalky: "100 or more" }; null when the answer carried no anchors (the ends then read as before, "Chalky" and "Unique").
 */
export function scaleEndNotes(scale) {
  const a = scaleAnchors(scale);
  if (a.fallback) return null;
  const unique = a.unique < 1 ? "under 1 copy" : `${aboutCopies(a.unique)} copies`;
  const chalky = a.chalky < 1 ? null : `${aboutNumber(a.chalky)} or more`;
  return chalky === null ? null : { unique, chalky };
}

// ---------- the estimate label ----------

/** A band label as the curves file writes it ("under 0.1", "0.1 to 1", "1 to 10", "10 to 100", "100 or more") as { from, to }; null if unreadable. */
function bandRange(label) {
  const s = String(label ?? "").trim().toLowerCase();
  let m = /^under\s+([\d.]+)$/.exec(s);
  if (m) return { from: 0, to: Number(m[1]) };
  m = /^([\d.]+)\s+to\s+([\d.]+)$/.exec(s);
  if (m) return { from: Number(m[1]), to: Number(m[2]) };
  m = /^([\d.]+)\s+or\s+more$/.exec(s);
  if (m) return { from: Number(m[1]), to: Infinity };
  return null;
}

/**
 * The calibration band that holds `copies` across the answer's held-out entries (uniqueness.model.bands: one entry per held-out
 * night, [{ train, test, bands: [{ band, share, ratio, judged }] }]): { band (its label; two labels joined with " or " when the
 * nights place the figure in different bands), ratios (those entries' ratios for it, only the judged ones) }, or null when no
 * judged entry has a band holding the figure.
 * The bands are counted in each night's own field ((entries - 1) x P, 73,000 to 87,000 entries) while the screen's copies are
 * `field` x P, so with `field` (the answer's, uniqueness.field) and `nights` (model.nights: { key, entries }, matched to the
 * entry's `test` key) the figure is scaled to each night's field first: copies x (entries - 1) / field. A held-out night
 * the answer does not list with its entries cannot be scaled and is left out. Without `field` or `nights` the figure is read as it is.
 */
export function bandFor(heldOut, copies, field = null, nights = null) {
  if (!Array.isArray(heldOut) || !isNum(copies)) return null;
  const scaling = isNum(field) && field > 0 && Array.isArray(nights);
  const labels = [];
  const ratios = [];
  for (const entry of heldOut) {
    let here = copies;
    if (scaling) {
      const entries = nights.find((n) => n?.key === entry?.test)?.entries;
      if (!isNum(entries)) continue;
      here = (copies * (entries - 1)) / field;
    }
    for (const b of Array.isArray(entry?.bands) ? entry.bands : []) {
      const r = bandRange(b?.band);
      if (!r || !Number.isFinite(r.from) || !(here >= r.from && here < r.to)) continue;
      if (b.judged === true && isNum(b.ratio) && b.ratio > 0) {
        if (!labels.includes(b.band)) labels.push(b.band);
        ratios.push(b.ratio);
      }
    }
  }
  return ratios.length ? { band: labels.join(" or "), ratios } : null;
}

const ratioNumber = (r) => (r >= 10 ? String(Math.round(r)) : r.toFixed(1));

/** "3.8x" or "3.8x to 4.5x" from a band's `ratios` (one per held-out night); null when it carries none. */
export function bandRatioText(band) {
  const list = (Array.isArray(band?.ratios) ? band.ratios : []).filter((r) => isNum(r) && r > 0);
  if (!list.length) return null;
  const lo = ratioNumber(Math.min(...list));
  const hi = ratioNumber(Math.max(...list));
  return lo === hi ? `${lo}x` : `${lo}x to ${hi}x`;
}

/** The basis for one figure: "on past nights lineups predicted at 1 to 10 copies really ran about 3.8x to 4.5x this"; null when the answer's judged bands have none for it. */
export function bandBasis(copies, model, field = null) {
  const band = bandFor(model?.bands, copies, field, model?.nights);
  const ratio = band ? bandRatioText(band) : null;
  return ratio ? `on past nights lineups predicted at ${band.band} copies really ran about ${ratio} this` : null;
}

/** Whether a figure of `copies` carries the estimate label: under 10 copies. (The answer's own estimate flag, model.estimate,
 *  is true whenever the field entered is not one of the fitted sizes, which the app's 100,000 never is: it goes to the hover
 *  as modelNote, not onto every figure.) */
export function isEstimate(copies) {
  return isNum(copies) && copies < ESTIMATE_BELOW;
}

const sentence = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The model's own one sentence (model.estimateNote: what was fitted, and why the answer is an estimate when it is), or null. */
export function modelNote(model) {
  return typeof model?.estimateNote === "string" && model.estimateNote.trim() ? sentence(model.estimateNote.trim()) : null;
}

/**
 * The hover behind an estimate label for one figure: the basis from the answer's bands (read in each held-out night's own
 * field, `field` being the answer's), then the model's own sentence when the answer says it is an estimate (model.estimate),
 * else a plain line saying the answer carried no past-night ratio for this range. Never a number typed in by hand.
 */
export function estimateTitle(copies, model, field = null) {
  const bits = [];
  const basis = bandBasis(copies, model, field);
  if (basis) bits.push(sentence(capital(basis)));
  if (model?.estimate === true && modelNote(model)) bits.push(modelNote(model));
  if (!bits.length) bits.push(`Under ${ESTIMATE_BELOW} copies is an estimate: this answer carried no past-night ratio for this range.`);
  return bits.join(" ");
}

/**
 * The hover behind a swap row's one estimate label, which follows the fold: it names the fold and both copies figures, then
 * the basis for the figure before and the figure after (each only when it has one), then the model's sentence when the
 * answer says it is an estimate; else the plain line.
 */
export function swapEstimateTitle(before, after, model, field = null) {
  const bits = [];
  const b = aboutCopiesWords(before);
  const a = aboutCopiesWords(after);
  if (b !== null && a !== null) bits.push(`The fold compares the lineup's ${b} now with ${a} after the swap; both are estimates.`);
  for (const [word, n] of [["before", before], ["after", after]]) {
    const basis = bandBasis(n, model, field);
    if (basis) bits.push(`${capital(word)}, ${aboutCopiesWords(n)}: ${basis}.`);
  }
  if (model?.estimate === true && modelNote(model)) bits.push(modelNote(model));
  if (!bits.length || (bits.length === 1 && b !== null && a !== null)) bits.push(`Figures under ${ESTIMATE_BELOW} copies are the least certain, and this answer carried no past-night ratio for them.`);
  return bits.join(" ");
}

/**
 * What the swaps panel needs from the placed lineup's own meter answer `d` (the swaps answer has none of it): the model (bands,
 * nights, estimate note), the field its copies are counted in, and the two bests (the slate's, and the one the strip shows with
 * Adam's excludes); null when the answer has no measured uniqueness.
 */
export function answerBasis(d) {
  const u = d?.uniqueness;
  if (!u || typeof u !== "object" || !u.model) return null;
  return { model: u.model, field: isNum(u.field) ? u.field : null, fieldBestProj: isNum(u.fieldBestProj) ? u.fieldBestProj : null, bestProj: isNum(d.bestProj) ? d.bestProj : null };
}

/** The small "estimate" label with its hover (styled .sd-est). */
export function estimateLabelHtml(title) {
  return `<span class="sd-est" title="${escapeHtml(title)}">estimate</span>`;
}
