// The weighted projection blend (PROJECT.md Part 4 "Blend and missing data").
//
//   blended = sum(w_i * x_i) / sum(w_i) over the enabled sources that actually cover the player, so the weights
//   renormalise per player; coverage = covering weight / total enabled weight.
//   coverage >= 0.5            -> the blend as it stands.
//   0 < coverage < 0.5         -> the blend as it stands, flagged "thin" (never shrunk toward a salary baseline:
//                                 sources skip the players who will not play, so missing coverage is not "unknown").
//   coverage = 0               -> the CSV's AvgPointsPerGame, flagged "no projection"; when that is null or 0 the
//                                 projection stays null, never 0 (D27: the player still appears on the board).
//   A status only ever blocks that stand-in: a player at least one source projects keeps his blend whatever any
//   status says.
import { isSidelined } from "./value-core.js"; // pure: the public site runs the board maths in a browser (D71)

const isNum = (v) => Number.isFinite(v);

/** The flags blendProjections and the board's failed-position check put on a row (the site re-blends under new weights). */
export const BLEND_FLAGS = new Set(["no projection", "avgPoints", "thin", "sidelined", "injuryUnknown"]);

/** Position -> ids of the sources (each {id, missingPositions}) with weight above 0 that returned nothing for that position. */
export function failedPositions(sources, weightOf) {
  const out = new Map();
  for (const s of sources ?? []) {
    if (!(Number(weightOf(s.id)) > 0)) continue;
    for (const pos of Array.isArray(s.missingPositions) ? s.missingPositions : []) {
      if (!out.has(pos)) out.set(pos, []);
      out.get(pos).push(s.id);
    }
  }
  return out;
}

function getEntry(source, id) {
  if (!source) return null;
  if (typeof source.get === "function") return source.get(id) ?? null;
  return source[id] ?? null;
}

function weightEntries(weights) {
  const pairs = weights instanceof Map ? [...weights] : Object.entries(weights ?? {});
  return pairs
    .map(([id, w]) => [id, Number(w?.weight ?? w)])
    .filter(([, w]) => Number.isFinite(w) && w > 0);
}

/**
 * Blends per-source DraftKings points into one projection per player.
 *
 * players      - the slate players (each needs id, pos, salary, avgPoints).
 * projBySource - Map (or object) player id -> { sourceId: points }.
 * weights      - { sourceId: weight } (or a Map, or { sourceId: {weight} }) for the sources that count toward
 *                coverage. Pass only the sources that actually produced records: a dead source left in here would
 *                make the whole slate look thin.
 * options.labels - { sourceId: label } for the recipe line.
 * options.injuryStatus - Map (or object) player id -> the injury report's status for that player (R82). It alone
 *                decides whether an uncovered player is sidelined.
 * options.injuryReport - "ok" (default), "stale" or "missing" (injuryReportState). "missing": no stand-in, flag "injuryUnknown".
 *
 * Returns { byPlayerId, recipe, totalWeight } where byPlayerId maps id -> { proj, blend, coverage, flags, sources }
 * (blend is the covering sources' weighted mean, null when nothing covered the player).
 */
export function blendProjections(players, projBySource, weights, { labels = {}, injuryStatus = null, injuryReport = "ok" } = {}) {
  const enabled = weightEntries(weights);
  const totalWeight = enabled.reduce((s, [, w]) => s + w, 0);

  const rows = (players ?? []).map((player) => {
    const bySource = getEntry(projBySource, player.id) ?? {};
    const used = [];
    let wsum = 0;
    let acc = 0;
    for (const [id, w] of enabled) {
      // A null or empty value is a source with nothing to say, not a 0 (Number(null) and Number("") are 0), so it
      // must not count as covering; the same guard as blendStats below.
      const raw = bySource[id];
      if (raw === null || raw === undefined || raw === "") continue;
      const v = Number(raw);
      if (!isNum(v)) continue;
      used.push(id);
      wsum += w;
      acc += w * v;
    }
    const coverage = totalWeight > 0 ? wsum / totalWeight : 0;
    const blend = wsum > 0 ? acc / wsum : null;
    return { player, blend, coverage, sources: used };
  });

  const byPlayerId = new Map();

  for (const row of rows) {
    const { player, blend, coverage, sources } = row;
    const flags = [];
    let proj = null;

    if (coverage <= 0 || blend === null) {
      flags.push("no projection");
      if (isSidelined(getEntry(injuryStatus, player.id))) {
        flags.push("sidelined");
      } else if (injuryReport === "missing") {
        flags.push("injuryUnknown");
      } else {
        const avg = Number(player.avgPoints);
        proj = isNum(avg) && avg > 0 ? avg : null;
        if (proj !== null) flags.push("avgPoints");
      }
    } else if (coverage < 0.5) {
      // Thin coverage is flagged, never inflated. The earlier rule shrank a thin blend toward a points-vs-salary
      // line, which assumed a source that skips a player simply lacks an opinion. In practice sources skip the
      // players who will not play: on 2026 week 2 a backup QB whose only projection was 0.3 points became 7.3
      // and thirty backups cleared the 6-point display line. The covering sources' own number stands.
      flags.push("thin");
      proj = blend;
    } else {
      proj = blend;
    }

    byPlayerId.set(player.id, { proj, blend, coverage, flags, sources });
  }

  return { byPlayerId, recipe: recipeText(enabled, labels, injuryReport), totalWeight };
}

/**
 * Blends one player's per-source projected stats (server/rank/project.js statsBySource: { sourceId: { rec, rushYd } })
 * into one weighted mean per stat, with the same weights as the Proj blend (only sources with weight above 0 count)
 * renormalised over the sources that publish that stat. A stat no source publishes is null, never 0.
 */
export function blendStats(statsBySource, weights, keys = ["rec", "rushYd"]) {
  const enabled = weightEntries(weights);
  const out = {};
  for (const key of keys) {
    let wsum = 0;
    let acc = 0;
    for (const [id, w] of enabled) {
      const raw = statsBySource?.[id]?.[key];
      if (raw === null || raw === undefined || raw === "") continue;
      const v = Number(raw);
      if (!isNum(v)) continue;
      wsum += w;
      acc += w * v;
    }
    out[key] = wsum > 0 ? acc / wsum : null;
  }
  return out;
}

/**
 * The plain-English recipe line the Projections tab shows (PROJECT.md Part 4 "Screens").
 */
export function recipeText(enabled, labels = {}, injuryReport = "ok") {
  const listedBy = "the injury report lists";
  const noCoverage = injuryReport === "missing"
    ? 'No coverage leaves the projection blank, flagged "no projection": the injury report is missing, so nobody can be confirmed healthy and the DraftKings average per game does not stand in.'
    : `No coverage falls back to the DraftKings average points per game, flagged "no projection", unless ${listedBy} the player as out, on IR, doubtful or suspended, in which case the projection is 0; with no average it stays blank rather than zero.`;
  const parts = enabled.map(([id, w]) => `${labels[id] ?? id} x${w}`);
  return [
    parts.length
      ? `Blended projection = weighted mean of ${parts.join(", ")}, DraftKings points converted from each source's own stat lines.`
      : "Blended projection: no projection source is enabled and returning data.",
    "Weights renormalise over the sources that cover each player; coverage is the covering weight as a share of the total enabled weight.",
    'Coverage under 50% keeps the number from the sources that do cover the player and is flagged "thin"; it is never pulled toward a typical score for the salary.',
    noCoverage
  ].join(" ");
}
