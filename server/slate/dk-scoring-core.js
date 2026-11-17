// The pure part of DraftKings scoring (no node: module, no file read), so the public site can score kickers in the
// visitor's browser (D71). server/slate/dk-scoring.js adds the offence and DST tables and the config file, and
// re-exports everything here, so every existing import is unchanged.

export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Parse one cell out of a scraped or pasted table into a number, or null when it carries no number.
 * Empty strings, "-", "--", "N/A", "DNP" and any other non-numeric text return null, so a missing value stays
 * missing instead of being scored as a real zero. Thousands separators are accepted ("1,204" -> 1204), as are
 * numbers already parsed by JSON. Use num() for arithmetic on a value that is genuinely allowed to default to 0.
 */
export function parseCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  if (/^(-+|n\/?a|dnp|--|—|–)$/i.test(s)) return null;
  const cleaned = s.replace(/,/g, "");
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** DraftKings kicker scoring (showdown only, PROJECT.md D39: classic never rosters a kicker). Points per made
 * field goal by distance plus one per made extra point; DraftKings charges nothing for a miss. Frozen. */
export const DK_KICKER_SCORING = Object.freeze({ fg0_39: 3, fg40_49: 4, fg50: 5, xp: 1 });

/**
 * Kicker points for one projected stat line { fg0_39, fg40_49, fg50, xp }: made field goals under 40 yards,
 * 40-49 yards and 50+ yards, and made extra points. Anything missing or non-numeric counts as 0.
 * Returns { points, parts } with one part per bucket.
 */
export function kickerPoints(stat = {}) {
  const src = stat || {};
  const S = DK_KICKER_SCORING;
  const parts = {
    fg0_39: num(src.fg0_39) * S.fg0_39,
    fg40_49: num(src.fg40_49) * S.fg40_49,
    fg50: num(src.fg50) * S.fg50,
    xp: num(src.xp) * S.xp
  };
  const points = parts.fg0_39 + parts.fg40_49 + parts.fg50 + parts.xp;
  return { points, parts };
}

/**
 * Splits a total of made field goals into the three DraftKings distance buckets by `split`
 * { under40, from40to49, from50 }. The split is normalised by its own sum, so the three buckets always add back
 * to `fgTotal` exactly; a split whose parts are not all finite and non-negative, or that sums to zero, throws
 * rather than inventing a distribution. Returns { fg0_39, fg40_49, fg50 }.
 */
export function splitFieldGoals(fgTotal, split = {}) {
  const total = num(fgTotal);
  const s = split || {};
  const parts = [s.under40, s.from40to49, s.from50].map((v) => Number(v));
  if (parts.some((v) => !Number.isFinite(v) || v < 0)) {
    throw new Error(`splitFieldGoals: split parts must be numbers of at least 0, got ${JSON.stringify(split)}`);
  }
  const sum = parts[0] + parts[1] + parts[2];
  if (!(sum > 0)) throw new Error(`splitFieldGoals: split sums to ${sum}, expected 1`);
  return {
    fg0_39: (total * parts[0]) / sum,
    fg40_49: (total * parts[1]) / sum,
    fg50: (total * parts[2]) / sum
  };
}
