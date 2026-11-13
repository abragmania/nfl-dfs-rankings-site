// The sentence a served Showdown row carries for Adam's typed projection and his ± bump (moved verbatim out of server/rank/select-showdown.js in round 4, item 7, so the public site's
// Showdown overlay writes the same sentence without importing the whole selection engine, whose TwoGun overlay holds the publish guard's own path patterns). Pure and browser-safe.
import { BUMP_PCT } from "./merge.js";
import { rowIsOut, statusSetting } from "../rank/sidelined.js";
import { toNumber } from "../rank/value-core.js";
import { fmt } from "../showdown/offence-how.js";

/**
 * The sentences for Adam's typed projection and his ± bump on a merged row (Adam 2026-10-22: "Adam's +10% adjustment:
 * 21.7 → 23.9", from the typed number or projBase to proj), "" when he has neither. A typed number plus a bump names both;
 * an out man projecting 0 (D45) gets no adjustment sentence, as his bump moves nothing.
 */
export function overrideHow(r) {
  const typed = r.override?.proj;
  const hasTyped = typed !== null && typed !== undefined;
  const out = rowIsOut(r); // zeroed: the override sentence keeps naming the 0 he projects, as it always has
  const base = toNumber(r.projBase); // null when no source projected him: "replaces no projection", never "the base 0"
  const parts = hasTyped ? [`Adam's override ${fmt(Number(out ? r.proj : typed))} replaces ${base === null ? "no projection" : `the base ${fmt(base)}`}.`] : [];
  // His own Out beats a typed number: say he is marked Out, not that an override of 0 replaces the base.
  if (hasTyped && statusSetting(r) === "out") parts[0] = `You marked him Out, so he projects 0; the typed ${fmt(Number(typed))} is not used.`;
  const steps = r.override?.bump;
  const from = Number(hasTyped ? typed : r.projBase);
  if (Number.isInteger(steps) && steps !== 0 && Number.isFinite(from) && typeof r.proj === "number" && !out) {
    parts.push(`Adam's ${steps > 0 ? "+" : ""}${BUMP_PCT * steps}% adjustment: ${fmt(from)} → ${fmt(r.proj)}.`);
  }
  return parts.join(" ");
}
