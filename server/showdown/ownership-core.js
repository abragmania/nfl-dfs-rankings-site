// Showdown ownership consolidation (D41, D40), pure: agreeWithin is passed in from ownership.js (R81). Stokastic's Captain
// figure is an ordinary source (D40 as amended 2026-10-18); the sim is our estimate wherever its figure shows (D29 as
// amended); a source whose list is short of the main players is never used (R85, one implementation: this file).
import { STOKASTIC_ID } from "../sources/selection-core.js";
import { rowIsSidelined } from "../rank/sidelined.js";

export { STOKASTIC_ID };
export const SIM_ID = "sim";

export const MIN_MAIN_COVERAGE = 0.8; // R85: a source covering less than this share of the main players' projected points is not used (by head count when the basis is "heads")
// R85: how a source's share of the main players is measured. "points" (active) weighs each main player by his projection, so
// deep backups with tiny projections cannot throw out a real full list (Adam 2026-10-18: a source has full ownership or it
// does not); "heads" counts players and stays tested. COVERAGE_BASIS is the switch.
export const COVERAGE_BASIS = "points";
export const COVERAGE_BASES = Object.freeze(["heads", "points"]);
const POINTS_EPSILON = 1e-9; // a summed share of exactly 80% must not fall under it by float noise

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round2 = (n) => Math.round(n * 100) / 100;
// A share (0 to 1) as a percent rounded DOWN to two decimals (1e-6 absorbs float noise on an exact share), so a source just under the 80% line never reads "80%" beside "not used".
const floorPct2 = (share) => Math.floor(share * 10000 + 1e-6) / 100;
const pct = (n) => `${round2(n)}%`;
const hasId = (v) => v !== null && v !== undefined && v !== "";
const one = () => 1;

// D29 as amended: a figure's kind is "estimate" when any source behind it is the sim, else "published"; it is never called published then.
const isSim = (h) => h.src.id === SIM_ID;
const kindOf = (hits) => (hits.some(isSim) ? "estimate" : "published");
const wordOf = (hits) => (hits.every(isSim) ? "our estimate" : hits.some(isSim) ? "published, with our estimate" : "published");
const replacedWord = (kind) => (kind === "estimate" ? "our estimate" : "the published");

/** A source's name in a sentence. A label that already ends "(our estimate)" (the sim's) drops it: wordOf adds those words, so they are said once per figure. */
export const ownLabel = (src) => (src.id === STOKASTIC_ID ? "Stokastic" : String(src.label ?? src.id).replace(/\s*\(our estimate\)\s*$/, ""));

function weightedMean(hits, valueOf, weightOf) {
  let acc = 0;
  let wsum = 0;
  for (const h of hits) {
    const w = weightOf(h.src.id);
    acc += w * valueOf(h);
    wsum += w;
  }
  return acc / wsum;
}

// ---- R85 coverage: who the main players are and whether a source names enough of them ---------------------------------
// The definition of "main players" and of "enough" lives only in the functions below, so a ruling changes it in one place.

/** The main players of a slate: projection above 0 and not listed sidelined. */
export function mainPlayers(rows) {
  return (rows ?? []).filter((r) => isNum(r.proj) && r.proj > 0 && !rowIsSidelined(r));
}

/** By head count: { covered, share } = how many of `main` the source names and that over the number of main players (null with none). */
export function coverageByHeads(main, named) {
  const covered = main.filter((r) => named.has(r.id)).length;
  return { covered, share: main.length ? covered / main.length : null };
}

/** By projected points: { covered (heads, for the sentence), share } = the named main players' projections over all main players' (null with none). */
export function coverageByPoints(main, named) {
  const total = main.reduce((a, r) => a + r.proj, 0);
  const got = main.filter((r) => named.has(r.id));
  return { covered: got.length, share: total > 0 ? got.reduce((a, r) => a + r.proj, 0) / total : null };
}

const RULE_TEXT = {
  heads: `Main players are those projected above 0 points who are not listed out; a source is used when it names at least ${MIN_MAIN_COVERAGE * 100}% of them by head count.`,
  points: `Main players are those projected above 0 points who are not listed out; a source is used when the players it names hold at least ${MIN_MAIN_COVERAGE * 100}% of their total projected points.`
};

/**
 * The R85 coverage of the sources, as board data: { main, basis, rule, judged, bySource: { id: { covered, share, used } } }.
 * `namedBySource` is a Map source id -> Set of player ids the source gives a number for (only sources with rows).
 * With no main player nothing can be judged (judged false) and every source is used. `basis` is COVERAGE_BASIS unless a
 * caller passes the other ("heads" | "points"); an unknown basis throws.
 */
export function ownershipCoverage(rows, namedBySource, { basis = COVERAGE_BASIS, min = MIN_MAIN_COVERAGE } = {}) {
  if (!COVERAGE_BASES.includes(basis)) throw new Error(`ownership coverage: unknown basis ${JSON.stringify(basis)}`);
  const main = mainPlayers(rows);
  const measure = basis === "points" ? coverageByPoints : coverageByHeads;
  const judged = main.length > 0;
  const bySource = {};
  for (const [id, named] of namedBySource ?? []) {
    const m = measure(main, named);
    bySource[id] = { covered: m.covered, share: m.share, used: !judged || m.share >= min - (basis === "points" ? POINTS_EPSILON : 0) };
  }
  return { main: main.length, basis, rule: RULE_TEXT[basis], judged, bySource };
}

/** The board note when R85 could not be judged (no main player, so every source with rows is used as listed), else null. */
export function coverageNote(coverage) {
  if (!coverage || coverage.judged || !Object.keys(coverage.bySource ?? {}).length) return null;
  return "Ownership coverage could not be judged (R85): no player has a projection above 0, so every source with rows is used as listed.";
}

/** R85, the one wording of a set-aside source (c = its coverage.bySource entry). */
export function setAsideSentence(label, c, coverage) {
  return coverage.basis === "points"
    ? `${label} lists ${c.covered} of ${coverage.main} main players, only ${floorPct2(c.share)}% of their projected points, so it is not used (R85).`
    : `${label} lists only ${c.covered} of ${coverage.main} main players, so it is not used (R85).`;
}

/**
 * R85 over any rows: `namedBySource` as ownershipCoverage takes it, `labelOf(id)` the source's name for the sentence.
 * Returns { coverage, notUsed: Map(source id -> sentence) for each source set aside }.
 */
export function judgeCoverage(rows, namedBySource, labelOf, { basis } = {}) {
  const coverage = ownershipCoverage(rows, namedBySource, { basis });
  const notUsed = new Map();
  for (const [id, c] of Object.entries(coverage.bySource)) if (!c.used) notUsed.set(id, setAsideSentence(labelOf(id), c, coverage));
  return { coverage, notUsed };
}

// ---- the figures ---------------------------------------------------------------------------------------------------------

export function flexOwnership(hits, { agreeWithin, method = "d41", weightOf = one } = {}) {
  const published = (hits ?? []).filter((h) => isNum(h.rec?.flexOwn));
  if (!published.length) return null;
  const words = (list) => list.map((h) => `${ownLabel(h.src)} ${pct(h.rec.flexOwn)}`).join(" and ");
  if (method === "weighted") {
    const kind = kindOf(published);
    if (published.length === 1) return { value: published[0].rec.flexOwn, kind, how: `FLEX: ${words(published)} (${wordOf(published)}).` };
    return { value: round2(weightedMean(published, (h) => h.rec.flexOwn, weightOf)), kind, how: `FLEX: weighted average of ${words(published)} (${wordOf(published)}).` };
  }
  if (!isNum(agreeWithin)) throw new Error("flexOwnership: agreeWithin is required for the D41 method (R81)");
  const st = published.find((h) => h.src.id === STOKASTIC_ID) ?? null;
  const others = published.filter((h) => h.src.id !== STOKASTIC_ID);
  const otherVal = others.length ? weightedMean(others, (h) => h.rec.flexOwn, weightOf) : null;
  if (st && otherVal !== null) {
    const stFlex = st.rec.flexOwn;
    const d = Math.abs(stFlex - otherVal);
    // These two sentences carry no wordOf, so each sim figure there is marked itself (D29 as amended).
    const marked = others.map((h) => `${ownLabel(h.src)} ${pct(h.rec.flexOwn)}${isSim(h) ? " (our estimate)" : ""}`).join(" and ");
    if (d < agreeWithin) {
      return { value: round2((stFlex + otherVal) / 2), kind: kindOf(others), how: `FLEX: average of Stokastic ${pct(stFlex)} and ${marked} (they agree within ${agreeWithin} points).` };
    }
    return { value: stFlex, kind: "published", how: `FLEX: Stokastic ${pct(stFlex)} (${marked}; the two disagree by ${round2(d)} points, and Stokastic's contest simulation is the better-founded number).` };
  }
  if (st) return { value: st.rec.flexOwn, kind: "published", how: `FLEX: Stokastic ${pct(st.rec.flexOwn)} (published).` };
  return others.length === 1
    ? { value: others[0].rec.flexOwn, kind: kindOf(others), how: `FLEX: ${words(others)} (${wordOf(others)}).` }
    : { value: round2(otherVal), kind: kindOf(others), how: `FLEX: average of ${words(others)} (${wordOf(others)}).` };
}

export function captainOwnership(hits, { weightOf = one } = {}) {
  const field = (hits ?? []).filter((h) => isNum(h.rec?.cptOwn));
  if (!field.length) return null;
  const words = field.map((h) => `${ownLabel(h.src)} ${pct(h.rec.cptOwn)}`).join(" and ");
  const kind = kindOf(field);
  return field.length === 1
    ? { value: field[0].rec.cptOwn, kind, how: `Captain: ${words} (${wordOf(field)}).` }
    : { value: round2(weightedMean(field, (h) => h.rec.cptOwn, weightOf)), kind, how: `Captain: average of ${words} (${wordOf(field)}).` };
}

/** `notUsed`: R85 sentences (setAsideSentence) for the set-aside sources that listed this player, added to the explanation. */
export function ownershipEntry(row, { flex = null, cpt = null, typed = null, notUsed = [] } = {}) {
  const e = { ownFlex: null, ownCpt: null, ownKindFlex: null, ownKindCpt: null, how: [] };
  if (isNum(row.salary) && flex) {
    e.ownFlex = flex.value;
    e.ownKindFlex = flex.kind ?? "published";
    e.how.push(flex.how);
  }
  if (hasId(row.cptId) && cpt) {
    e.ownCpt = cpt.value;
    e.ownKindCpt = cpt.kind ?? "published";
    e.how.push(cpt.how);
  }
  const typedFlex = typed && isNum(typed.flex) ? typed.flex : null;
  const typedCpt = typed && isNum(typed.cpt) ? typed.cpt : null;
  if (typedFlex !== null) {
    const was = e.ownFlex;
    e.how = e.how.filter((h) => !h.startsWith("FLEX:"));
    e.how.unshift(`FLEX: Adam's override ${pct(typedFlex)}${was === null ? "" : ` replaces ${replacedWord(e.ownKindFlex)} ${pct(was)}`}.`);
    e.ownFlex = typedFlex;
    e.ownKindFlex = "override";
  }
  if (typedCpt !== null) {
    const was = e.ownCpt;
    e.how = e.how.filter((h) => !h.startsWith("Captain:"));
    e.how.push(`Captain: Adam's override ${pct(typedCpt)}${was === null ? "" : ` replaces ${replacedWord(e.ownKindCpt)} ${pct(was)}`}.`);
    e.ownCpt = typedCpt;
    e.ownKindCpt = "override";
  }
  // D29: a side nobody published and Adam did not type stays null (missing), never estimated.
  const how = [...e.how];
  // A row carrying an R85 note is one a set-aside source did list: "no source in use", not "no source has published".
  const nobody = notUsed.length ? "no source in use has a number" : "no source has published a number yet";
  if (isNum(row.salary) && e.ownFlex === null) how.push(`FLEX: ${nobody}, so it is shown as missing.`);
  if (hasId(row.cptId) && e.ownCpt === null) how.push(`Captain: ${nobody}, so it is shown as missing.`);
  how.push(...notUsed);
  const kinds = [e.ownKindFlex, e.ownKindCpt].filter(Boolean);
  return {
    ownFlex: e.ownFlex,
    ownCpt: e.ownCpt,
    // One word for the row: "override" when Adam typed either number, else "estimate" when either figure involves the
    // sim (D29 as amended: our estimate, never called published), else "published", else null.
    ownKind: kinds.length === 0 ? null : kinds.includes("override") ? "override" : kinds.includes("estimate") ? "estimate" : "published",
    ownKindFlex: e.ownKindFlex,
    ownKindCpt: e.ownKindCpt,
    ownHow: how.length ? how.join(" ") : `No ownership for ${row.name}: no source has published one.`
  };
}

/**
 * Consolidates matched hits onto rows (the legacy file path, ownership.js): `hitsById` is Map row id -> [{ src, rec }].
 * R85 runs here first: a source short of the main players is dropped from every row's hits and its sentence added to the
 * rows that source listed. Returns { byId, coverage, usedSourceIds } (usedSourceIds: the sources with rows that were not set aside).
 */
export function consolidateMatched(rows, hitsById, { typed, agreeWithin, sources = [], coverageBasis } = {}) {
  const list = rows ?? [];
  const named = new Map(); // source id -> ids of the players it gives a number for (sources with rows only)
  for (const src of sources) {
    if (!(src.rows ?? []).length) continue;
    named.set(src.id, new Set([...hitsById].filter(([, hits]) => hits.some((h) => h.src === src && (isNum(h.rec.flexOwn) || isNum(h.rec.cptOwn)))).map(([id]) => id)));
  }
  const byIdSrc = new Map(sources.map((s) => [s.id, s]));
  const { coverage, notUsed } = judgeCoverage(list, named, (id) => ownLabel(byIdSrc.get(id)), { basis: coverageBasis });
  const kept = new Map();
  const noteFor = new Map(); // player id -> sentences
  for (const [id, hits] of hitsById) {
    kept.set(id, hits.filter((h) => !notUsed.has(h.src.id)));
    for (const h of hits) if (notUsed.has(h.src.id)) noteFor.set(id, [...new Set([...(noteFor.get(id) ?? []), h.src.id])]);
  }
  const byId = new Map();
  for (const r of list) {
    const hits = kept.get(r.id) ?? [];
    const notes = (noteFor.get(r.id) ?? []).map((sid) => notUsed.get(sid));
    byId.set(r.id, ownershipEntry(r, { flex: flexOwnership(hits, { agreeWithin }), cpt: captainOwnership(hits), typed: typed?.get?.(r.id) ?? null, notUsed: notes }));
  }
  const usedSourceIds = sources.filter((s) => (s.rows ?? []).length && !notUsed.has(s.id)).map((s) => s.id);
  return { byId, coverage, usedSourceIds };
}
