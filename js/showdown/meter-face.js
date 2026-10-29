// The Showdown lineup meter's face (Adam 2026-10-29 5:08 PM: "more 'is this a good lineup / is this a unique lineup', get down
// to the point of it"; "not boilerplate garbage and random text and sourcing"): the scale and its colours, the two verdict lines
// with their small lines, the copies figure, and the panel's one hover (the sources with their as-of and refusals, the
// calculation sentence, the model's note). Pure html and text builders, no DOM, no network; lineup-meter.js assembles them in
// meterHtml and hands the public names on. Its own file because lineup-meter.js reached the 600-line ceiling.
import { escapeHtml, dec1 } from "../format.js";
import { asOfText, figureLine } from "./figures-label.js";
import { likelyFactText, likelyBasisText, usuallyText } from "./likely-copies.js";
import { copiesText, scaleAnchors, scaleEndNotes, calcSentence, modelNote, isEstimate, estimateTitle, estimateLabelHtml, uniqueVerdict, goodVerdict, aloneText } from "./field-explain.js"; // the field model's words (D82) and the verdicts

const MINUS = "−";
const NO_PROJECTIONS = "No projections from this game's ticked sources yet";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const SCALE_STOPS = [
  [0, [200, 50, 59]], // chalky: the app's chalk red
  [0.5, [224, 165, 38]], // amber
  [1, [47, 143, 91]], // unique: the app's value green
];
// The scale is the lineup's expected copies on a log axis, so 22 and 59 copies sit visibly apart. Its two ends are where the
// track stops telling lineups apart: at or below the unique end the marker is at the unique end, at or above the chalky end at
// the chalky end. Since the field model (RULES.md D82) the ends come from the answer's `scale` (uniqueEnd, chalkyEnd: the
// entry-weighted 10th and 90th percentiles of the fitted model's own copies over the fit nights' entries, field-explain.js
// scaleAnchors); an answer with no anchors falls back to 1 and 100 copies and its end labels read as plain words, as before.

/** Where a lineup sits on the scale as a fraction, 0 (chalky end) .. 1 (unique end), log in expected copies between the answer's anchors; null if unreadable. */
function uniqueFraction(copies, scale = null) {
  if (typeof copies !== "number" || !Number.isFinite(copies)) return null;
  const { unique, chalky } = scaleAnchors(scale);
  const lo = Math.log10(unique);
  const hi = Math.log10(chalky);
  const c = Math.min(chalky, Math.max(unique, copies));
  return (hi - Math.log10(c)) / (hi - lo);
}

/** Marker position on the track, 0..100 (percent from the left, chalky left): log scale in expected copies, clamped at both ends.
 *  `scale`: the answer's { uniqueEnd, chalkyEnd } (uniqueness.scale); none falls back to 1 and 100 copies. */
export function markerPosition(copies, scale = null) {
  const f = uniqueFraction(copies, scale);
  return f === null ? null : f * 100;
}

/** The scale's colour at this many expected copies as "rgb(r, g, b)": piecewise-linear red, amber, green along the same log track. */
export function scaleColour(copies, scale = null) {
  const x = uniqueFraction(copies, scale) ?? 0;
  let i = 1;
  while (i < SCALE_STOPS.length - 1 && x > SCALE_STOPS[i][0]) i += 1;
  const [x0, c0] = SCALE_STOPS[i - 1];
  const [x1, c1] = SCALE_STOPS[i];
  const t = (x - x0) / (x1 - x0);
  const ch = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

/** The CSS gradient the track paints; same stops as scaleColour so the marker's colour matches the track under it. */
export function scaleGradientCss() {
  const stops = SCALE_STOPS.map(([at, c]) => `rgb(${c[0]}, ${c[1]}, ${c[2]}) ${at * 100}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** "-14.2 (-12.6%)" with a real minus sign; null when the gap is missing. */
export function gapText(gapPts, gapPct) {
  if (typeof gapPts !== "number" || !Number.isFinite(gapPts)) return null;
  const sign = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");
  const pts = `${sign(gapPts)}${dec1(Math.abs(gapPts))}`;
  if (typeof gapPct !== "number" || !Number.isFinite(gapPct)) return pts;
  return `${pts} (${sign(gapPct)}${dec1(Math.abs(gapPct))}%)`;
}

/**
 * "Projection 98.4 · best possible 112.6 · -14.2 (-12.6%)" (a batch card's line and the meter's plain sentence when there is no
 * verdict). Pieces the server did not send are left out; no projections posted from the ticked sources says so with no numbers,
 * a refused file shows the refusal; a lineup with an unprojected player says that.
 */
export function projectionLineText(d) {
  if (d?.projection && d.projection.posted === false) return d.projection.error ? String(d.projection.error) : NO_PROJECTIONS;
  if (!d || typeof d.proj !== "number" || !Number.isFinite(d.proj)) return "Projection unknown (a player has no projection)";
  const parts = [`Projection ${dec1(d.proj)}`];
  if (typeof d.bestProj === "number" && Number.isFinite(d.bestProj)) parts.push(`best possible ${dec1(d.bestProj)}`);
  const gap = gapText(d.gapPts, d.gapPct);
  if (gap) parts.push(gap);
  return parts.join(" · ");
}

/**
 * "Ownership: TwoGun, Oct 18, 2:30 PM" (or "Projections: ..."): the board's short name for the half's sources (figures-label.js
 * halfName) and the half's as-of, kept to one line (a batch card's source line). A file's own time reads "saved <time>", the
 * board's build time "board built <time>"; an as-of that is not a date is shown as written without a trailing "(...)", a missing
 * one says so.
 */
export function sourceLineText(half, name, what = "Ownership") {
  const label = typeof name === "string" && name ? name : "this game's sources";
  return `${what}: ${label}, ${asOfText(half) ?? "as-of date missing"}`;
}

/** One half's full hover line from the answer's own half: its source as the server words it, its as-of and any refusal
 *  (figures-label.js figureLine, the old label hover's shape). `what` names the half when it carries no source. */
export function sourceTitle(half, what = "Ownership") {
  return figureLine(half, what);
}

/**
 * The panel's one hover: each half's source line (sourceTitle: a ticked source with no figures for this game and each half's
 * refusal shown as the server words them), the calculation sentence and the model's own note. Everything the panel's face no
 * longer prints (Adam 2026-10-29: off the face; the Sources page stays on the Showdown header's button).
 */
export function meterHover(d) {
  const u = d?.uniqueness;
  const lines = [];
  if (d?.projection) lines.push(sourceTitle(d.projection, "Projections"));
  if (d?.ownership) lines.push(sourceTitle(d.ownership, "Ownership"));
  const calc = u ? calcSentence(u, d.bestProj) : null;
  if (calc) lines.push(calc);
  const note = u ? modelNote(u.model) : null;
  if (note) lines.push(note);
  return lines.join("\n");
}

// The verdicts' colours, from the scale's own palette (SCALE_STOPS): green, the green-amber midpoint, amber and red.
const mix = (a, b) => a.map((v, k) => Math.round((v + b[k]) / 2));
const TONES = { green: SCALE_STOPS[2][1], yellowgreen: mix(SCALE_STOPS[1][1], SCALE_STOPS[2][1]), amber: SCALE_STOPS[1][1], red: SCALE_STOPS[0][1] };
/** A tone's colour as "rgb(r, g, b)" ("green", "yellowgreen", "amber", "red"); null for none. */
export function toneColour(tone) {
  const c = TONES[tone];
  return c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : null;
}

/** One verdict line (field-explain.js uniqueVerdict / goodVerdict): the coloured word, then its one sentence. */
export function verdictHtml(v, kind) {
  if (!v) return "";
  const colour = toneColour(v.tone);
  const word = v.word ? `<span class="sd-verdict-word"${colour ? ` style="color:${colour}"` : ""}>${escapeHtml(v.word)}:</span> ` : "";
  return `<div class="sd-verdict sd-verdict-${kind}">${word}${escapeHtml(v.text)}</div>`;
}

/** The "estimate" label for a figure under 10 copies (its basis on hover), or "". */
const estimateHtml = (u) => (isEstimate(u.copies) ? estimateLabelHtml(estimateTitle(u.copies, u.model, u.field)) : "");

/**
 * The small line under the Unique verdict: how many other entries usually hold it (its basis on hover; under a Unique verdict
 * only the range, its sentence having said nobody else most likely has it), the chance a win is not shared, and the "estimate"
 * label when the copies behind both are under 10 (D82).
 */
export function uniqueSubHtml(u) {
  const unique = uniqueVerdict(u.copies)?.word === "Unique";
  const likely = unique ? usuallyText(u.copies, u.spread) : likelyFactText(u.copies, u.spread);
  const alone = aloneText(u.aloneChance);
  if (!likely && !alone) return "";
  const likelyHtml = likely ? `<span title="${escapeHtml(likelyBasisText(u.spread))}">${escapeHtml(likely)}</span>` : "";
  return `<div class="sd-verdict-sub">${likelyHtml}${likely && alone ? " · " : ""}${alone ? `<span>${escapeHtml(alone)}</span>` : ""}${estimateHtml(u)}</div>`;
}

/**
 * The meter's figure line: "Expected copies in a 100,000-lineup field", the figure in the scale's colour and an "estimate" label
 * when the figure is under 10 copies (its basis on the label's hover).
 */
function headHtml(u) {
  const field = typeof u.field === "number" && Number.isFinite(u.field) ? u.field.toLocaleString("en-US") : null;
  return `
      <div class="sd-meter-head">
        <span class="sd-meter-label">Expected copies in ${field !== null ? `a ${escapeHtml(field)}-lineup` : "the"} field</span>
        <span class="sd-meter-big" style="color:${scaleColour(u.copies, u.scale)}">${escapeHtml(copiesText(u.copies))}</span>${estimateHtml(u)}
      </div>`;
}

/** The scale's two end words, each with its small note from the answer's anchors (none: the words alone, as before). */
function scaleEndsHtml(scale) {
  const notes = scaleEndNotes(scale);
  const end = (word, note) => `<span>${word}${note ? `<span class="sd-meter-end-note">${escapeHtml(note)}</span>` : ""}</span>`;
  return `<div class="sd-meter-ends">${end("Chalky", notes?.chalky)}${end("Unique", notes?.unique)}</div>`;
}

/** The scale under the verdicts: the figure line, the coloured track with the lineup's marker, and the two ends. */
export function scaleHtml(u) {
  return `${headHtml(u)}
      <div class="sd-meter-scale" role="img" aria-label="Uniqueness scale in expected copies, chalky to unique">
        <div class="sd-meter-track" style="background:${scaleGradientCss()}">
          <span class="sd-meter-marker" style="left:${markerPosition(u.copies, u.scale)}%;background:${scaleColour(u.copies, u.scale)}"></span>
        </div>
        ${scaleEndsHtml(u.scale)}
      </div>`;
}

/**
 * The projection's lines: the Good verdict when the answer has a projection (field-explain.js goodVerdict) with the best possible
 * lineup's figure on a small line under it ("Best possible lineup 97.1"), so a Strong verdict still shows a number; else the plain
 * sentence (not posted, a man unprojected). The lineup's own total is not repeated here: the builder's totals line shows it as
 * Adam ruled on 2026-10-17 (each slot's shown figure rounded, then summed), and the answer's unrounded sum could differ by 0.1.
 */
export function goodHtml(d) {
  const pr = d?.projection;
  const v = pr?.posted === false ? null : goodVerdict(d ?? {});
  if (v) return `${verdictHtml(v, "good")}${v.word && isNum(d.bestProj) ? `<div class="sd-verdict-sub">Best possible lineup ${escapeHtml(dec1(d.bestProj))}</div>` : ""}`;
  return `<div class="sd-meter-proj${pr?.posted === false && pr.error ? " sd-meter-error" : ""}">${escapeHtml(projectionLineText(d))}</div>`;
}
