// The board's ownership summary and the ownership recipe in words. Pure (no node modules, no file reads), so the
// public site can run them in the visitor's browser (DECISIONS.md D71). board.js re-exports both, so every
// existing caller is unchanged.
import { toNumber } from "./value-core.js";

/** "a", "a and b", "a, b and c". The one copy; server/showdown/board.js imports it too. */
export const listInWords = (names) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * The ownership recipe in words, shown on the Projected Ownership tab and returned by /api/ownership. It is built
 * from the ownership sources that actually ran ({label, weight} each), so it always names the sources whose
 * numbers reach Own% (weight above 0, D35: One Week Season) and the ones that are only kept (weight 0).
 */
export function ownershipRecipe(sources = []) {
  const label = (s) => s.label ?? s.id;
  const used = sources.filter((s) => Number(s.weight) !== 0).map(label);
  const kept = sources.filter((s) => Number(s.weight) === 0).map(label);
  const lines = [];
  if (used.length === 1) {
    lines.push(`Own% is the number ${used[0]} published for the DraftKings main slate; numbers for any other site or slate are never used.`);
  } else if (used.length > 1) {
    lines.push(`Own% is the average, by source weight, of the numbers ${listInWords(used)} published for the DraftKings main slate; numbers for any other site or slate are never used.`);
  } else {
    lines.push("No source of DraftKings main slate ownership has a weight above 0, so no published number reaches Own%; numbers for any other site or slate are never used.");
  }
  if (kept.length) {
    lines.push(`${listInWords(kept)} ${kept.length === 1 ? "is" : "are"} downloaded, stored and shown in ${kept.length === 1 ? "its" : "their"} own column, but never averaged into Own% (weight 0).`);
  }
  lines.push("A number Adam types into the Own% cell replaces the published one for that player.");
  lines.push("A player with no published number is left blank: the app never estimates ownership, so game popularity exists only where a real number does.");
  return lines.join(" ");
}

// A published ownership number is a percentage; anything outside 0-100 is not one.
const MAX_OWN = 100;

/**
 * One player's Own% anchor: the weighted mean of the sources' published numbers. `quotesBySource`: { sourceId: { own,
 * parts: [{own, source, url}] } } for the sources that quote him; `weightOf(id)`: that source's weight. A weight of
 * exactly 0 means "kept for comparison, not blended" (D35): its number stays in its own column and never reaches Own%.
 * A negative mean is no quote at all, and the top is held at 100. Returns { own, source, url, parts } or null.
 */
export function blendOwnership(quotesBySource, weightOf) {
  let acc = 0;
  let wsum = 0;
  const parts = [];
  for (const [sourceId, quote] of Object.entries(quotesBySource ?? {})) {
    const w = Number(weightOf(sourceId));
    if (w === 0) continue;
    const weight = Number.isFinite(w) && w > 0 ? w : 1;
    acc += weight * quote.own;
    wsum += weight;
    parts.push(...quote.parts);
  }
  if (!(wsum > 0 && acc / wsum >= 0)) return null;
  return {
    own: Math.min(acc / wsum, MAX_OWN),
    source: [...new Set(parts.map((p) => p.source).filter(Boolean))].join(", "),
    url: parts.find((p) => p.url)?.url ?? null,
    parts
  };
}

/**
 * The board's ownership summary from the FINAL rows: quoted is how many players a named source published a
 * number for, overridden is how many carry a number Adam typed (D28; a player can be both), and blank is how
 * many have no ownership number at all. The override remerge (server/rank/remerge.js) rebuilds it with this same
 * function after an override changes a player's ownership, so the two can never drift apart.
 */
export function summariseOwnership(rows) {
  const summary = { quoted: 0, overridden: 0, blank: 0 };
  for (const row of rows ?? []) {
    if (row.ownKind === "quoted") summary.quoted += 1;
    if (toNumber(row.override?.own) !== null) summary.overridden += 1;
    if (toNumber(row.own) === null) summary.blank += 1;
  }
  return summary;
}
