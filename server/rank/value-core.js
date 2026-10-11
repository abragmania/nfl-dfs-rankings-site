// Raw value and ownership-adjusted value (PROJECT.md Part 4 "Value and leverage").
//   value = blended DraftKings points / (salary / 1000)  - blank when there is no projection, never 0.
//   lev   = z(value) - lambda * z(own%), both z-scores taken WITHIN THE PLAYER'S POSITION over the players that
//           have both numbers. Positions price and own differently (a $4,000 WR and a $4,000 QB are not the same
//           kind of bet), so a slate-wide z-score just ranks the cheap positions first; the position z-score is
//           what makes the leverage list mix positions. A position with fewer than LEV_MIN_PER_POS such players
//           has too little to take a mean and a spread from, so lev is blank for that whole position. There is
//           no slate-wide fallback: ownership is only what named sources published, so a thin position is a
//           real case (three quoted QBs, say), and a slate-wide scale would make every one of them look
//           leveraged simply because of how his position is priced.
// lambda comes from data/config/rank.json (0 = chalk-friendly cash, 1 = contrarian tournaments), read by
// value.js loadRankConfig and passed in.
//
// Pure (no node modules, no file reads), so the public site can run it in the visitor's browser (DECISIONS.md D71).
// value.js keeps the config loader and re-exports everything here, so every existing caller is unchanged.

export const DEFAULT_RANK_CONFIG = Object.freeze({
  lambda: 0.5,
  // Ownership penalty the lineup builder's "projMinusOwn" objective subtracts per point of projected ownership
  // (server/lineup/optimize.js): score = proj - ownPenaltyK * own%.
  ownPenaltyK: 0.15,
  chalkMinOwn: 20,
  valueMinPtsPerK: 3.0
});

/** Fewest players with both a value and a real ownership number a position needs before it gets lev at all. */
export const LEV_MIN_PER_POS = 5;

// isSidelined / rowIsSidelined live in sidelined.js (pure, so the Optimizer's engine also runs in a browser, D69)
// and are re-exported here for every existing caller.
import { isSidelined, rowIsSidelined } from "./sidelined.js";
export { isSidelined, rowIsSidelined };

/**
 * A finite number, or null. The one guard every caller in the ranking layer must use before a comparison:
 * Number(null) is 0 and Number.isFinite(0) is true, so casting first turns "no ownership" into "0% owned" and
 * "no projection" into "0 points", both of which then take part in averages, percentiles and leverage.
 */
export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Points per $1,000 of salary, or null when either number is missing (D27: blank, never 0). */
export function valueOf(proj, salary) {
  // Number(null) is 0, so a missing projection has to be rejected before the cast: a blank projection must stay
  // blank, never become a value of 0 (D27).
  if (proj === null || proj === undefined || proj === "") return null;
  const p = Number(proj);
  const s = Number(salary);
  if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0) return null;
  return p / (s / 1000);
}

/** Mean and standard deviation (population) of a list of numbers. */
export function meanSd(values) {
  const n = values.length;
  if (!n) return { mean: 0, sd: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, sd: Math.sqrt(variance) };
}

/**
 * Adds value and lev to a set of rows.
 * rows    - objects carrying { id, pos, proj, own, salary }.
 * config  - { lambda } (value.js loadRankConfig()).
 * Returns Map id -> { value, lev }: value is null without a projection, lev is null unless the player has both a
 * value and an ownership number and is expected to play (a null projection, a null ownership and an out, IR or
 * doubtful player never take part in either z-score; an out player keeps his projection and value). The
 * z-scores are taken within the player's position; in a position with fewer than LEV_MIN_PER_POS qualifying
 * players lev is null for everybody (never a slate-wide z-score). A position where value or ownership has no
 * spread gives every z-score 0, so lev is 0 rather than infinite.
 */
export function computeValue(rows, config = DEFAULT_RANK_CONFIG) {
  const lambda = toNumber(config?.lambda) ?? DEFAULT_RANK_CONFIG.lambda;
  const list = rows ?? [];
  const values = new Map();
  for (const row of list) values.set(row.id, valueOf(row.proj, row.salary));

  // Only rows carrying BOTH numbers define the scales; everything else is left out rather than counted as 0.
  // Players who are out, on IR or doubtful are left out too: they cannot be played, so they must neither carry a
  // leverage score nor drag the position's mean and spread around.
  const both = list.filter((r) => values.get(r.id) !== null && toNumber(r.own) !== null && !rowIsSidelined(r));
  const statsFor = (group) => ({
    value: meanSd(group.map((r) => values.get(r.id))),
    own: meanSd(group.map((r) => toNumber(r.own)))
  });

  const byPos = new Map();
  for (const r of both) {
    const pos = r.pos ?? null;
    if (!byPos.has(pos)) byPos.set(pos, []);
    byPos.get(pos).push(r);
  }
  const statsByPos = new Map();
  for (const [pos, group] of byPos) {
    if (group.length < LEV_MIN_PER_POS) continue; // too thin to trust a mean and a spread: no lev for this position
    statsByPos.set(pos, statsFor(group));
  }

  const out = new Map();
  for (const row of list) {
    const value = values.get(row.id);
    const own = toNumber(row.own);
    let lev = null;
    const stats = statsByPos.get(row.pos ?? null) ?? null;
    if (stats !== null && value !== null && own !== null && !rowIsSidelined(row)) {
      const zv = stats.value.sd > 0 ? (value - stats.value.mean) / stats.value.sd : 0;
      const zo = stats.own.sd > 0 ? (own - stats.own.mean) / stats.own.sd : 0;
      lev = zv - lambda * zo;
    }
    out.set(row.id, { value, lev });
  }
  return out;
}
