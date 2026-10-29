// The Showdown field curves' checks and sentences (RULES.md D82), pure: ./field-curves.js reads data/showdown-field/curves.json
// from the data folder and the public site reads the copy baked beside its boards (RULES.md D71), and both turn the text
// into { curves } or { error } here, so the app and the site refuse the same file with the same sentence. No node: module,
// no file; tools/publish.mjs copies this file, unchanged, to out/server/showdown/ by walking the site's imports.
import { validateCurves } from "../lineup/sd-field-model.js";

/** The file's name as a sentence shows it (the data folder is data/ on Adam's machine). */
export const CURVES_FILE_SHOWN = "data/showdown-field/curves.json";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isText = (v) => typeof v === "string" && v.trim() !== "";
const CANNOT = "so uniqueness can't be measured";

/**
 * What the meter's answer reads beyond validateCurves, checked here so a file without it is refused rather than shown
 * blank: a fit date; each provenance night's key and counted entries (a whole number above 0: the fitted field sizes);
 * the held-out swaps, each naming its test night and carrying its calibration bands ({ band, share, ratio (a number, or
 * null for an empty band), judged }), the basis of the screen's estimate labels (the lead's applied default, Q3). Returns
 * one plain sentence, or null. Pure.
 */
export function fieldCurvesError(curves) {
  const v = validateCurves(curves);
  if (v.error) return v.error;
  if (!isText(curves.fitDate)) return "The field curves carry no fit date.";
  const bad = curves.provenance.findIndex((p) => !isText(p.key) || !Number.isInteger(p.entriesCounted) || p.entriesCounted < 1);
  if (bad >= 0) return `The field curves' night ${bad + 1} has no contest key or no whole number of counted entries.`;
  const swaps = curves.heldOut?.swaps;
  if (!Array.isArray(swaps) || swaps.length === 0) return "The field curves carry no held-out results (the band ratios the screen's estimate labels rest on).";
  for (const [i, s] of swaps.entries()) {
    const okBand = (b) => b && isText(b.band) && isNum(b.share) && (b.ratio === null || isNum(b.ratio)) && typeof b.judged === "boolean";
    if (!s || !isText(s.test) || !Array.isArray(s.bands) || s.bands.length === 0 || !s.bands.every(okBand)) {
      return `The field curves' held-out result ${i + 1} has no test night or no complete band table.`;
    }
  }
  return null;
}

/** The sentence for a curves file that is not there. */
export function curvesMissingSentence() {
  return `The Showdown field curves file ${CURVES_FILE_SHOWN} is missing, ${CANNOT}.`;
}

/** The sentence for a curves file that is there but could not be read; `why` is the reader's own words. */
export function curvesUnreadableSentence(why) {
  return `The Showdown field curves file ${CURVES_FILE_SHOWN} could not be read (${why}), ${CANNOT}.`;
}

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

/** The curves file's text as { curves } (parsed, checked and frozen: one object shared by every answer) or { error } with
 *  one plain sentence naming the file. */
export function curvesFromText(text) {
  let curves;
  try {
    curves = JSON.parse(text);
  } catch (e) {
    return { error: `The Showdown field curves file ${CURVES_FILE_SHOWN} is not valid JSON (${e.message}), ${CANNOT}.` };
  }
  const bad = fieldCurvesError(curves);
  if (bad) return { error: `The Showdown field curves file ${CURVES_FILE_SHOWN} is refused (${bad.replace(/\.$/, "")}), ${CANNOT}.` };
  return { curves: deepFreeze(curves) };
}
