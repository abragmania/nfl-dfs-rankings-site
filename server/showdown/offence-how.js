// The Showdown projection sentence for one non-kicker row (D37, D39; TwoGun's number taken as published, D25 as
// amended). Pure (D71): server/showdown/board.js and server/rank/select-showdown.js share it.
import { listInWords } from "../rank/ownership-summary.js";
import { toNumber } from "../rank/value-core.js";
import { TWOGUN_ID } from "../sources/selection-core.js";

export const upper = (v) => (v === null || v === undefined || v === "" ? null : String(v).trim().toUpperCase());
export const fmt = (n) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "?");

/**
 * The classic blend recipe (server/rank/blend.js recipeText) ends with its own no-coverage sentence; that last sentence is
 * replaced by the Showdown rule (Adam 2026-11-02, "a missing figure shown as missing, never filled in"). Text without it is
 * returned as it is.
 */
export function showdownRecipe(text) {
  return String(text ?? "").replace(/ No coverage .*$/s, ' A player no ticked source covers has no projection: it is left blank, flagged "no projection" (0 when the injury report lists him out, on IR, doubtful or suspended); his DraftKings average per game never stands in.');
}

/**
 * p: the slate player; b: his blend entry (proj, flags); sources: { id: points } for every source with a number;
 * weights: the weights the blend used; flags: the row's flags so far; game: the game (implied totals);
 * reportStatus / injuryReport: his injury-report status and the report's state. opts (select-showdown.js only):
 * fromBackup, his number came from the "Our sources" backups; othersCover, a source outside `weights` lists him.
 */
export function offenceHow(p, b, sources, weights, labels, flags, game, reportStatus, injuryReport, { fromBackup = false, othersCover = false } = {}) {
  const ids = Object.keys(sources).filter((id) => id in weights);
  const parts = ids.map((id) => `${labels[id] ?? id} ${fmt(sources[id])}`);
  const allOne = ids.every((id) => Number(weights[id]) === 1);
  const recipe = allOne ? "" : ` weighted ${ids.map((id) => `${labels[id] ?? id} x${weights[id]}`).join(", ")},`;
  let text;
  if (!ids.length) {
    const none = othersCover ?`None of the ticked projection sources covers ${p.name}` : `No projection source covers ${p.name}`;
    // Showdown never stands a man in at his DraftKings average: no source covers him, so he has no projection (null, never 0).
    text = (b.flags || []).includes("sidelined")
      ? `${none}, and the injury report lists him as ${reportStatus}, so his average does not stand in.`
      : injuryReport === "missing"
        ? `${none}, and no injury report is available, so his average does not stand in.`
        : `${none}, so he has no projection; his DraftKings average does not stand in.`;
    return text;
  }
  const his = ids.includes(TWOGUN_ID);
  const converted = !his
    ? (ids.length === 1 ? "converted from its stat line with DraftKings scoring" : "each converted from its stat line with DraftKings scoring")
    : ids.length === 1 ? "his own DraftKings projection, used as he publishes it"
      : "each stat source converted from its stat line with DraftKings scoring and TwoGun's own DraftKings projection used as he publishes it";
  text = ids.length === 1
    ? `${parts[0]} is the only source covering ${p.name},${recipe} ${converted}.`
    : `Average of ${ids.length} sources (${listInWords(parts)}),${recipe} ${converted}, the same recipe as the classic board (D37).`;
  if (fromBackup) text += ` The ticked sources do not cover ${p.name}, so this comes from the "Our sources" backups.`;
  if (flags.includes("thin")) text += " Coverage is thin: fewer than half the sources list him.";
  if (upper(p.pos) === "DST" && flags.includes("dstPtsAllowedFromLine")) {
    const opp = p.opp ?? null;
    const imp = opp ? toNumber(game?.implied?.[opp]) : null;
    if (imp !== null) text += ` Points allowed come from ${opp}'s implied total of ${fmt(imp)}.`;
  }
  return text;
}
