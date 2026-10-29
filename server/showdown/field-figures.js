// The Showdown meter's field-model figures (the Showdown meter plan 2026-10-25, sections 3, 4, 6, 8 and 12 step 4; RULES.md
// D82): a lineup's copies are the board's ownership product times the fitted salary-left and projection-gap factors, over
// the same weight summed across every legal lineup (../lineup/sd-field-model.js on the board's field table,
// ../lineup/sd-field-dp.js), read at exactly the points the fit tool (tools/sd_field_fit.mjs) reads them: the same pool,
// the same seat ownership (seatOwnership), the same best (bestLegalProjection, no excludes) and the same lineupFigures.
// This file turns those figures into the meter answer's `uniqueness` (section 8: the old names copies, aloneChance, oneIn,
// field, zMs, zCached kept; parts, left, gap, model, scale and spread added) and into the swaps' measuring function. Pure:
// the table and its Z come in from the meter's per-board cache (./meter-answer.js zFor), the curves from
// ./field-curves.js; no files.
import { lineupFigures, seatOwnership, seatExponents } from "../lineup/sd-field-model.js";
import { boardTwoGun } from "./lineup-rows.js"; // what this game's ticks say about TwoGun (the basis of the estimate label); pure, so the site runs this file (D71)

const round2 = (n) => Math.round(n * 100) / 100;
const count = (n) => n.toLocaleString("en-US");
const pctFraction = (pct) => (pct === null ? null : pct / 100);

/** The plain sentences of a blank answer (section 8, "No figure, and why"). */
export const NO_CURVES_SENTENCE = "The field curves were not given, so uniqueness was not measured.";
export const NO_PROJECTIONS_SENTENCE = "No projections are posted from this game's ticked sources, so uniqueness can't be measured (the field model needs the projection gap).";
export const NO_BEST_SENTENCE = "The best possible lineup could not be worked out from this game's projections, so uniqueness can't be measured (the field model needs the projection gap).";
export const noProjectionSentence = (names) => `No projection from this game's ticked sources for ${names.join(", ")}, so uniqueness can't be measured for this lineup (the field model needs the projection gap).`;

/**
 * The field table's pool (../lineup/sd-field-dp.js fieldTable): the ownership half's candidates (own a fraction or null,
 * each slot its own) with each seat's ownership raised to its seat's exponent (`exponents`: seatExponents(curves),
 * { captain, flex }) and each man's FLEX projection from the projection half (null when he has none: he is then left out
 * of the table, plan section 6). `rows`: lineupRows(board), the rows both halves were built from.
 */
export function fieldPool(rows, own, proj, exponents) {
  const projById = new Map(rows.map((r) => [String(r.id), proj.projOf(r)]));
  return own.pool.map((c) => ({
    personId: String(c.personId), team: c.team, slot: c.slot, salary: c.salary,
    own: seatOwnership(c.own, c.slot === "CPT" ? exponents.captain : exponents.flex), proj: projById.has(String(c.personId)) ? projById.get(String(c.personId)) : null
  }));
}

/** One seat for lineupFigures from a board row: his posted ownership in that seat (raised to that seat's exponent), FLEX projection and price. */
function seatOf(row, slot, own, proj, exponent) {
  return {
    personId: String(row.id), name: row.name, own: seatOwnership(pctFraction(own.ownOf(row, slot)), exponent),
    proj: proj.projOf(row), salary: slot === "CPT" ? row.cptSalary : row.salary
  };
}

/** A blank answer: no figures, the names, and the one sentence why. Test for figures with "w" in the answer. */
const blank = (unposted, unprojected, reason) => ({ unposted, unprojected, reason });

/**
 * The model's facts for one board, curves and field (section 8): { model, scale, spread }. model: the fit date and clock,
 * the nights fitted (key, game, date, counted entries), fieldsFitted (those sizes), projectionBasis and ownershipBasis
 * ("twogun" while TwoGun alone is ticked for that half, else "other"), estimate (true when the field entered is outside
 * the fitted sizes, the board's projections or ownership are not TwoGun's alone, or the fitted nights did not all use
 * TwoGun's figures) with estimateNote (the one sentence, either way), and bands (the held-out calibration bands per
 * held-out night, the basis on which the screen labels figures under 10 copies and every swap fold as an estimate, the
 * lead's applied default, Q3), and ownershipExponents ({ captain, flex }, seatExponents: each seat's ownership is raised
 * to its own before the product). scale: the curves' two anchors in copies (and the field they are counted in). spread:
 * poisson, or negative-binomial with its size (it widens only the "usually a to b" words, never the headline).
 */
export function modelFacts(curves, { board, field }) {
  const two = boardTwoGun(board);
  const nights = curves.provenance.map((p) => ({ key: p.key, game: p.game ?? null, date: p.date ?? null, entries: p.entriesCounted }));
  const sizes = nights.map((n) => n.entries);
  const lo = Math.min(...sizes);
  const hi = Math.max(...sizes);
  const fittedOnTwoGun = curves.provenance.every((p) => /TwoGun/.test(String(p.projection?.source ?? "")) && /TwoGun/.test(String(p.ownership?.source ?? "")));
  const reasons = [];
  if (field < lo || field > hi) reasons.push(`the field of ${count(field)} is outside the fitted sizes, so copies are scaled in proportion`);
  if (!fittedOnTwoGun) reasons.push("the fitted nights did not all use TwoGun's projections and ownership");
  else {
    if (!two.projOnly) reasons.push("this board's projections are not TwoGun's alone");
    if (!two.ownOnly) reasons.push("this board's ownership is not TwoGun's alone");
  }
  const sizesText = lo === hi ? `${count(lo)} entries` : `${count(lo)} to ${count(hi)} entries`;
  const basis = `Fitted on ${nights.length} ${nights.length === 1 ? "night" : "nights"} of ${sizesText}${fittedOnTwoGun ? " with TwoGun's projections and ownership" : ""}`;
  const estimateNote = reasons.length ? `An estimate: ${basis}; ${reasons.join("; ")}.` : `${basis}, as this board and field are.`;
  const spread = curves.spread.kind === "negative-binomial" ? { kind: "negative-binomial", size: curves.spread.size } : { kind: "poisson" };
  return {
    model: {
      fitDate: curves.fitDate, fitClock: curves.fitClock ?? null, nights, fieldsFitted: sizes,
      projectionBasis: two.projOnly ? "twogun" : "other", ownershipBasis: two.ownOnly ? "twogun" : "other",
      estimate: reasons.length > 0, estimateNote,
      bands: curves.heldOut.swaps.map((s) => ({ train: s.train ?? null, test: s.test, bands: s.bands.map((b) => ({ band: b.band, share: b.share, ratio: b.ratio, judged: b.judged })) })),
      ownershipExponents: seatExponents(curves)
    },
    scale: { uniqueEnd: curves.scale.uniqueEnd, chalkyEnd: curves.scale.chalkyEnd, field: Number.isInteger(curves.scale.field) ? curves.scale.field : null },
    spread
  };
}

/**
 * The meter answer's `uniqueness` for one checked lineup (validateMeterBody's cpt and flex board rows) on one board, or a
 * blank { unposted, unprojected, reason }. The caller has already answered null for a lineup holding a man with no
 * ownership in his seat (unchanged, section 8). `fieldFor()`: the board's field from the meter's cache, { table, z, best,
 * ms, cached } (best null when the field's best lineup cannot be worked out). Measured: lineupFigures's { w, Z, p, copies,
 * aloneChance, oneIn, field } plus zMs and zCached (the cold table time and whether it came from the cache), parts
 * (ownershipOnly, withLeft, withGap: expected copies by ownership alone, then also counting salary left, then also the
 * gap; withGap is copies), left { dollars, factor }, gap { belowPts, belowPct (two decimals; how far under the FIELD's
 * best, positive when under), factor }, fieldBestProj (that best, two decimals; the displayed best may differ by Adam's
 * excludes), and modelFacts's model, scale and spread.
 */
export function fieldUniqueness({ board, own, proj, curves, field, cpt, flex, fieldFor }) {
  if (!curves) return blank([], [], NO_CURVES_SENTENCE);
  const ex = seatExponents(curves);
  const lineup = { cpt: seatOf(cpt, "CPT", own, proj, ex.captain), flex: flex.map((r) => seatOf(r, "FLEX", own, proj, ex.flex)) };
  const men = [lineup.cpt, ...lineup.flex];
  if (!proj.posted) return blank([], men.map((m) => m.name), NO_PROJECTIONS_SENTENCE);
  const unprojected = men.filter((m) => m.proj === null).map((m) => m.name);
  if (unprojected.length) return blank([], unprojected, noProjectionSentence(unprojected));
  const f = fieldFor();
  if (f.best === null) return blank([], [], NO_BEST_SENTENCE);
  const u = lineupFigures(lineup, { table: f.table, curves, best: f.best, field, z: f.z });
  if (!("w" in u)) return blank(u.unposted, u.unprojected, u.unprojected.length ? noProjectionSentence(u.unprojected) : "A player has no ownership in his seat, so uniqueness can't be measured for this lineup.");
  return {
    w: u.w, Z: u.Z, p: u.p, copies: u.copies, aloneChance: u.aloneChance, oneIn: u.oneIn, field: u.field,
    zMs: round2(f.ms), zCached: f.cached,
    parts: u.parts, left: u.left,
    gap: { belowPts: round2(u.gap.belowPts), belowPct: u.gap.belowPct === null ? null : round2(u.gap.belowPct), factor: u.gap.factor },
    fieldBestProj: round2(f.best),
    ...modelFacts(curves, { board, field: u.field })
  };
}

/**
 * The swaps' measuring function (./swaps.js findSwaps) on one board's field: men -> { copies, left (dollars), gapPts
 * (projection minus the field's best, two decimals, negative when under it: the meter's sign) }. Each man is { id
 * (person id), name, own (his posted fraction in that seat, or null), flexProj (his FLEX projection), salary (in that
 * seat) }, the Captain first (raised to the Captain exponent; the other five to the FLEX one). The figures are
 * lineupFigures's, so a swap reads exactly as the meter reads that lineup. A man with no figure throws: findSwaps offers
 * only men with a posted ownership and a projection above 0.
 */
export function swapMeasurer({ table, z, best, curves, field }) {
  const ex = seatExponents(curves);
  const seat = (m, b) => ({ personId: String(m.id), name: m.name, own: seatOwnership(m.own, b), proj: m.flexProj, salary: m.salary });
  return (men) => {
    const u = lineupFigures({ cpt: seat(men[0], ex.captain), flex: men.slice(1).map((m) => seat(m, ex.flex)) }, { table, curves, best, field, z });
    if (!("w" in u)) throw new Error(`swapMeasurer: ${[...u.unposted, ...u.unprojected].join(", ")} has no figure, so the lineup cannot be measured.`);
    return { copies: u.copies, left: u.left.dollars, gapPts: round2(-u.gap.belowPts) };
  };
}
