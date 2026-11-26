// Showdown (D39): FLEX and Captain never combined, Stokastic's Captain an ordinary source (D40 amended), a source listing
// under 80% of the main players never used (R85), kickers D41 then weighted.
// inputs: server/showdown/board.js's board minus rows and removed, plus ownershipUsable (false when the ownership
//   file could not be used) and rows [{ id, cptId, name, team, opp, pos, status, injury?, salary, cptSalary,
//   avgPointsPerGame, avgPoints, flags (source flags only), projBySource ({ <id>: points }; a kicker's holds TwoGun's
//   alone), kickerRecords (kickers: { <id>: kickers.js record }), ownFlexBySource, ownCptBySource }]; inputs.twogun
//   and opts as select.js says. Kicker records are scored (kickers-core.js scoreKickers) over the ticked sources only.
import { blendProjections } from "./blend.js";
import { mergeOverridesIntoRows, EMPTY_OVERRIDES } from "../overrides/merge.js";
import { overrideHow } from "../overrides/how.js";
import { zeroOutRows, rowIsOut, isSidelined, statusWordOf, rowHideKind } from "./sidelined.js";
import { valueOf, toNumber } from "./value-core.js";
import { combineKickerPoints, scoreKickers } from "../sources/projections/kickers-core.js";
import { flexOwnership, captainOwnership, ownershipEntry, ownLabel, judgeCoverage } from "../showdown/ownership-core.js";
import { upper, fmt, offenceHow, showdownRecipe } from "../showdown/offence-how.js";
import { TWOGUN_LABEL, currentSrc, normStatus, ruledOutHeldWords } from "../twogun/overlay.js";
import { TWOGUN_ID, APPLIES_TO_SHOWDOWN, ANY, decide, ticksOnlyTwoGunProjection } from "../sources/selection-core.js";
import {
  kindsOf, tickedWeights, backupWeights, editsOf, applyEdits, editedList, sourceFlagsOf, modeOf,
  twogunInput, projRecipe, filledText, ticksTwoGun, staleWith, dropsHisFigure
} from "./select.js";

const sumOf = (ids, w) => ids.reduce((s, id) => s + (w[id] ?? 0), 0);
const isK = (r) => upper(r.pos) === "K";
const hasRecords = (r) => Object.keys(r.kickerRecords ?? {}).length > 0;
// The sentence offence-how.js adds for a number that came from the backups (kept in step with it, one wording).
const backupSentence = (name) => ` The ticked sources do not cover ${name}, so this comes from the "Our sources" backups.`;

// overrideHow (the sentence for a typed projection and a ± bump) lives in ../overrides/how.js, so the public site's Showdown overlay shares it without this whole engine.
export { overrideHow };

export function applyShowdownSources(inputs, opts = {}) {
  const c = showdownPlan(inputs, opts);
  const baseRows = c.rowsIn.map((p) => baseRow(c, p));
  const overrides = opts.overrides ?? EMPTY_OVERRIDES;
  const merged = zeroOutRows(mergeOverridesIntoRows(baseRows, overrides));
  for (const r of merged) {
    const how = overrideHow(r);
    if (how) r.projHow = `${r.projHow} ${how}`;
    r.proj = toNumber(r.proj);
    r.cptProj = r.proj === null ? null : r.proj * 1.5;
    r.value = valueOf(r.proj, r.salary);
  }
  // Layer order: the sources' numbers, then Adam's edits, then the blend. R85 judges the edited numbers.
  const edited = new Map(merged.map((r) => [r.id, applyOwnEdits(c, r)]));
  const judged = judgeOwnership(c, merged);
  c.partial = judged.notUsed;
  for (const r of merged) ownershipStep(c, r, overrides?.own ?? {}, edited.get(r.id));
  // D45 hiding; no Lev measure (Adam 2026-10-15).
  const rows = merged.map((r) => ({ ...r, levFlex: null, levCpt: null, tags: [] }));
  const removed = rows.filter(rowIsOut).map((r) => ({ id: r.id, name: r.name, team: r.team, pos: r.pos, status: statusWordOf(r) })); // Adam's own Out reads "Out" (2026-11-12)
  const notes = [...(inputs.notes ?? [])];
  if (c.ownershipUsable) notes.push(...c.partial.values());
  if (removed.length) {
    notes.push(`Hidden on the showdown lists as out or not expected to play (D45; Show all players shows them): ${removed.map((r) => `${r.name} (${r.team} ${r.pos}, ${r.status})`).join(", ")}.`);
  }
  const { twogun: _tg, ownershipUsable: _usable, ...boardIn } = inputs;
  const projection = showdownRecipe(projRecipe(c.projP, c.labels, c.report.state)) + (c.nonK.length ? filledText(c.projP, c.projB, showdownRecipe(projRecipe(c.projB, c.labels, c.report.state))) : "");
  return {
    ...boardIn,
    stale: staleWith(inputs.stale, ticksTwoGun(c.kinds, ["projection", "sdOwnFlex", "sdOwnCpt"], { classic: false }), c.tg.status),
    rows,
    removed,
    notes,
    ...("ownershipCoverage" in inputs ? ownershipCoverageOut(c, judged) : {}),
    recipes: { ...(inputs.recipes ?? {}), projection },
    // This game's own choices, plus the ticked list the Lineup tab's board path names its figures by (tickedSources).
    mode: { ...modeOf(opts.preset, c.tg.load, c.tg.status, null, opts.note ?? null, c.kinds, APPLIES_TO_SHOWDOWN), ticked: tickedSources(c.kinds, tickedIds(c, inputs), (kind, id) => tickedLabel(c, kind, id)) }
  };
}

/** The sections the Showdown Lineup tab reads (Projections, FLEX ownership, Captain ownership). */
export const LINEUP_KINDS = Object.freeze(["projection", "sdOwnFlex", "sdOwnCpt"]);
const positiveWeight = (w) => typeof w === "number" && Number.isFinite(w) && w > 0;

/**
 * board.mode.ticked (Adam 2026-10-20 10:03 AM: "change sources to anything for any game ... make it uniform across
 * everything"): per section of LINEUP_KINDS, { sources: [{ id, label, weight }] (each ticked source with a weight above
 * 0, in `ids` order; "*" stands for every listed id the section does not name, as decide reads it, and is listed itself,
 * as "*", only when it is ticked and stands for none of them), gaps ("backup", "blank" or null) }. `ids`: per section,
 * every source id this game could read; `labelOf(kind, id)` its name. Pure.
 */
export function tickedSources(kinds, ids, labelOf) {
  const out = {};
  for (const kind of LINEUP_KINDS) {
    const sources = [];
    const named = kinds?.[kind]?.sources ?? {};
    let viaAny = false;
    for (const id of ids?.[kind] ?? []) {
      const e = decide(kinds, kind, id);
      if (e?.use === true && positiveWeight(e.weight)) {
        sources.push({ id, label: labelOf(kind, id), weight: e.weight });
        if (!Object.hasOwn(named, id)) viaAny = true;
      }
    }
    const any = named[ANY];
    if (!viaAny && any?.use === true && positiveWeight(any.weight)) sources.push({ id: ANY, label: labelOf(kind, ANY), weight: any.weight });
    out[kind] = { sources, gaps: kinds?.[kind]?.gaps ?? null };
  }
  return out;
}

/** Every source id each Lineup section could read on this game: the ones the choices name ("*" left out), then the
 *  projection and kicker cards, or the week's ownership files, then TwoGun; each once. */
function tickedIds(c, inputs) {
  const named = (kind) => Object.keys(c.kinds?.[kind]?.sources ?? {}).filter((id) => id !== ANY);
  const once = (list) => [...new Set(list)];
  const ownFiles = (inputs.ownershipSources ?? []).map((s) => s.id);
  return {
    projection: once([...named("projection"), ...Object.keys(c.labels).filter((id) => id !== TWOGUN_ID), ...c.liveK.filter((id) => id !== TWOGUN_ID), TWOGUN_ID]),
    sdOwnFlex: once([...named("sdOwnFlex"), ...ownFiles, TWOGUN_ID]),
    sdOwnCpt: once([...named("sdOwnCpt"), ...ownFiles, TWOGUN_ID])
  };
}

/** A ticked source's name: a projection card's label (TwoGun's own), else an ownership file's (ownLabel), else its id;
 *  "*" (ticked, standing for no file this game has) reads as what it stands for. */
const tickedLabel = (c, kind, id) => (id === ANY ? "any Showdown ownership file" : kind === "projection" ? c.labels[id] ?? id : ownLabel(ownSrc(c, id)));

function showdownPlan(inputs, opts) {
  const kinds = kindsOf(opts.selection);
  const tg = twogunInput(inputs.twogun);
  // Who is out follows the source order (rank/sidelined.js): the board builder already left a row's status to a game-day inactive or a
  // note ruling him out of this game (never DraftKings' Status column: Adam 12:13 AM 11-26, only salaries come from the DraftKings upload;
  // injuries come from injury sources); an outside feed's tag alone is a flag (row.injury.flagOnly) and hides no one. On a board that ticks
  // TwoGun: his CSV marks a man "(assumed playing)" (load.playingIds: { board id: the status he quoted }), and a game-day inactive stays out with "outAfterStamp" (he projected the man before the inactives came, as
  // classic does, twogun/overlay.js applyCall). A man his CSV lists out with no call (load.listedOutIds) is out by his word, his
  // number notwithstanding (step 3), unless Adam marked him In. A lock still forces; row.injury keeps the feed's record.
  const ticked = tg.usable && TWOGUN_ID in tickedWeights(kinds, "projection", [TWOGUN_ID]);
  const hisCall = ticked ? new Map(Object.entries(tg.load?.playingIds ?? {})) : new Map();
  const hisOut = ticked ? new Map(Object.entries(tg.load?.listedOutIds ?? {})) : new Map();
  const hisNumber = (r) => toNumber(applyEdits(r.projBySource ?? {}, editsOf(opts.edits, r.id, "projection")).values[TWOGUN_ID]) !== null;
  const movedAfterStamp = new Map(); // row id -> the status he quoted, for men he called playing who are game-day inactives
  const calledOut = new Map(); // row id -> the out word his CSV lists
  // His numbers count only while his board is usable (one twogun shape, select.js).
  const rowsIn = (inputs.rows ?? []).map((r) => (tg.usable ? r : withoutTwoGun(r))).map((r) => {
    const id = String(r.id);
    if (!isSidelined(r.status) && hisOut.has(id)) { calledOut.set(r.id, hisOut.get(id)); return { ...r, status: hisOut.get(id) }; }
    if (!hisCall.has(id) || !isSidelined(r.status) || !hisNumber(r)) return r;
    movedAfterStamp.set(r.id, hisCall.get(id));
    return r;
  });
  const report = inputs.injuryReport ?? { state: "missing", source: null };
  const cards = inputs.sources ?? [];
  const labels = { ...Object.fromEntries(cards.filter((c) => c.kind === "projection").map((c) => [c.id, c.label ?? c.id])), [TWOGUN_ID]: TWOGUN_LABEL };
  const hasTwoGun = (pred) => rowsIn.some((r) => pred(r) && toNumber(r.projBySource?.[TWOGUN_ID]) !== null);
  const liveProj = cards.filter((c) => c.kind === "projection" && (c.records ?? 0) > 0).map((c) => c.id);
  if (hasTwoGun((r) => !isK(r))) liveProj.push(TWOGUN_ID);
  const liveK = cards.filter((c) => c.kind === "kicker" && (c.records ?? 0) > 0).map((c) => c.sourceId);
  if (hasTwoGun(isK)) liveK.push(TWOGUN_ID);
  const backupOf = (kind) => backupWeights(kinds, kind, opts.backup?.[kind]);
  const nonK = rowsIn.filter((r) => !isK(r));
  const projEdits = new Map(nonK.map((r) => [r.id, applyEdits(r.projBySource ?? {}, editsOf(opts.edits, r.id, "projection"))]));
  const statusMap = new Map(rowsIn.map((r) => [r.id, r.status ?? null]));
  // A man no ticked (or backup) source covers has no projection (blend.js); noStandIn only picks the sentence for the TwoGun-only
  // case (Adam 2026-10-18 evening).
  const noStandIn = ticksOnlyTwoGunProjection(kinds);
  // D45: with Adam's In a man TwoGun's CSV lists out counts TwoGun's figure only above 0; a 0 there is the out, not a projection, so the other sources fill him.
  const markedIn = (r) => opts.overrides?.status?.[r.id] === "in";
  const zeroOutIn = (r) => hisOut.has(String(r.id)) && markedIn(r) && dropsHisFigure({ call: "OUT", markedIn: true, hisProj: projEdits.get(r.id).values[TWOGUN_ID] }); // the one In-with-a-figure rule (select.js dropsHisFigure)
  const blendValues = (r) => {
    const values = projEdits.get(r.id).values;
    if (!zeroOutIn(r)) return values;
    const { [TWOGUN_ID]: _his, ...others } = values;
    return others;
  };
  const blendWith = (w) => (w && Object.keys(w).length
    ? blendProjections(nonK, new Map(nonK.map((r) => [r.id, blendValues(r)])), w, { labels, injuryStatus: statusMap, injuryReport: report.state })
    : null);
  const projP = tickedWeights(kinds, "projection", liveProj);
  const projB = backupOf("projection")?.(liveProj) ?? null;
  return {
    kinds, tg, rowsIn, calledOut, movedAfterStamp, nonK, report, kickersUnchecked: report.source !== "ESPN injuries", noStandIn, labels, liveK, projP, projB, projEdits,
    kP: tickedWeights(kinds, "projection", liveK), kB: backupOf("projection")?.(liveK) ?? null, backupOf, game: inputs.game ?? null,
    primary: blendWith(projP) ?? blendProjections(nonK, new Map(), {}, { labels, injuryStatus: statusMap, injuryReport: report.state }),
    backup: blendWith(projB), edits: opts.edits, agreeWithin: opts.agreeWithin,
    ownLabels: new Map((inputs.ownershipSources ?? []).map((s) => [s.id, s])), ownershipUsable: inputs.ownershipUsable !== false
  };
}

function withoutTwoGun(r) {
  const drop = (o) => (o && TWOGUN_ID in o ? Object.fromEntries(Object.entries(o).filter(([id]) => id !== TWOGUN_ID)) : o);
  return { ...r, projBySource: drop(r.projBySource), ownFlexBySource: drop(r.ownFlexBySource), ownCptBySource: drop(r.ownCptBySource) };
}

function baseRow(c, p) {
  const src = currentSrc(p);
  const out = isK(p) ? kickerRow(c, p) : offenceRow(c, p);
  if (out.used.includes(TWOGUN_ID)) src.proj = TWOGUN_ID;
  const calledOutWord = c.calledOut.get(p.id); // the out word TwoGun's CSV lists for him, or undefined
  if (calledOutWord !== undefined) src.status = TWOGUN_ID;
  const flags = out.flags;
  if (p.salary === null || p.salary === undefined) flags.push("no FLEX row");
  if (p.cptId === null || p.cptId === undefined) flags.push("no Captain row");
  if (isSidelined(p.status) && !flags.includes("injured")) flags.push("injured");
  const quoted = c.movedAfterStamp.get(p.id); // what he quoted, for a man the report moved to another out status after his stamp
  const heldOut = quoted !== undefined && rowHideKind(p) === "ruled-out" && normStatus(quoted) === normStatus(p.status); // he quoted this very word and still called PLAY: nothing moved after his stamp
  if (c.movedAfterStamp.has(p.id) && !heldOut) flags.push("outAfterStamp");
  const projHow = calledOutWord !== undefined ? `${out.projHow} TwoGun's board lists ${p.name} ${calledOutWord}, so he is out.`
    : heldOut ? `${out.projHow} ${ruledOutHeldWords(quoted, p.injury?.date)} He stays out.`
      : quoted !== undefined ? `${out.projHow} TwoGun listed ${p.name} as playing${quoted ? ` (he quoted ${quoted})` : ""}, but the injury report now has him ${p.status} ${rowHideKind(p) === "ruled-out" ? "as ruled out for this game" : "as a game-day inactive"}, so he stays out.`
      : out.projHow;
  const { kickerRecords: _records, ...row } = p;
  return {
    ...row, ...(out.kicker ?? {}), proj: out.value, sources: { ...out.values }, projBySource: { ...out.values }, coverage: out.coverage,
    projHow, own: null, flags, src,
    srcUsed: { proj: [...out.used] }, // the ids that made THIS man's Proj (ownershipStep adds ownFlex and ownCpt): the player card names these only (optimizer standard A8)
    edited: { proj: editedList(out.edited, out.used), own: [], ownFlex: [], ownCpt: [] }
  };
}

function offenceRow(c, p) {
  const proj = c.projEdits.get(p.id);
  const pb = c.primary.byPlayerId.get(p.id);
  const fromBackup = Boolean(c.backup) && pb.blend === null;
  const b = fromBackup ? c.backup.byPlayerId.get(p.id) : pb;
  const w = fromBackup ? c.projB : c.projP;
  const flags = [...b.flags];
  for (const f of sourceFlagsOf(p)) if (!flags.includes(f)) flags.push(f);
  const othersCover = Object.keys(proj.values).some((id) => !(id in w));
  // With TwoGun the only ticked projection source the true reason is given (a man TwoGun leaves out).
  const standInWithheld = c.noStandIn && !fromBackup && b.proj === null && !b.flags.includes("sidelined") && c.report.state !== "missing";
  const projHow = standInWithheld ? noStandInSentence(p.name) : offenceHow(p, b, proj.values, w, c.labels, flags, c.game, p.status ?? null, c.report.state, { fromBackup, othersCover });
  return { value: b.proj, coverage: b.coverage, used: b.sources, flags, projHow, values: proj.values, edited: proj.edited };
}

/** Why a man TwoGun does not project has no projection while TwoGun is the only ticked projection source. */
const noStandInSentence = (name) => `TwoGun has no projection for ${name}, and TwoGun is the only projection source ticked, so no DraftKings average stands in; he has no projection.`;

/** A kicker (D41): his records scored over the ticked sources only (else the backups), then combined. The per-source
 *  columns borrow a missing split from the sources the projection used, so a column agrees with the number. */
function kickerRow(c, p) {
  const edits = editsOf(c.edits, p.id, "projection");
  const his = toNumber(p.projBySource?.[TWOGUN_ID]);
  const records = (ids) => ids.filter((id) => id !== TWOGUN_ID);
  const scoreWith = (ids, lendFrom = ids) => {
    const s = hasRecords(p) ? scoreKickers(p.kickerRecords, records(ids), records(lendFrom)) : { scored: [], split: null };
    const points = Object.fromEntries((s.scored ?? []).filter((x) => Number.isFinite(x?.points)).map((x) => [x.id, x.points]));
    if (his !== null && ids.includes(TWOGUN_ID)) points[TWOGUN_ID] = his;
    return { ...applyEdits(points, edits), scored: s.scored ?? [], split: s.split ?? null };
  };
  for (const [w, fromBackups] of [[c.kP, false], [c.kB, true]]) {
    if (!w || !Object.keys(w).length) continue;
    const s = scoreWith(Object.keys(w));
    const out = combineKickerPoints(Object.entries(s.values).map(([id, points]) => ({ id, points })), { weights: w, split: s.split });
    if (!Number.isFinite(out.proj)) continue;
    const used = out.used.map((u) => u.id);
    const total = sumOf(c.liveK.filter((id) => id in w), w);
    const coverage = total > 0 ? sumOf(used, w) / total : 0;
    const columns = scoreWith(c.liveK, Object.keys(w));
    return { value: out.proj, coverage, used, flags: coverage < 0.5 ? ["thin"] : [], projHow: out.how + (fromBackups ? backupSentence(p.name) : ""),
      values: columns.values, edited: columns.edited, kicker: { kickerScored: s.scored, kickerSplit: s.split } };
  }
  const columns = scoreWith(c.liveK);
  return { ...kickerStandIn(c, p, Object.keys(columns.values).length > 0), coverage: 0, used: [], values: columns.values,
    edited: columns.edited, kicker: { kickerScored: columns.scored, kickerSplit: columns.split } };
}

/** No ticked kicker source projects him (and no backup does): he has no projection, null, never his DraftKings average
 *  (Adam 2026-11-02: "a missing figure shown as missing, never filled in"). While TwoGun is the only ticked projection
 *  source with no backups to fill him, the sentence names that (Adam 2026-10-18 evening: "no stand-in"). */
function kickerStandIn(c, p, othersCover) {
  const flags = ["no projection"];
  if (c.kickersUnchecked) flags.push("injuryUnknown");
  if (c.noStandIn && !(c.kB && Object.keys(c.kB).length)) return { value: null, flags, projHow: noStandInSentence(p.name) };
  const none = othersCover ? `None of the ticked kicker sources projects ${p.name}` : `No kicker source projected ${p.name}`;
  const unknown = c.kickersUnchecked ? `, and his injury status is unknown (${c.report.state === "missing" ? "no injury report is available" : "Sleeper's report lists no kickers"})` : "";
  return { value: null, flags, projHow: `${none}${unknown}, so he has no projection; his DraftKings average does not stand in.` };
}

const ownSrc = (c, id) => c.ownLabels.get(id) ?? { id, label: id === TWOGUN_ID ? TWOGUN_LABEL : id };

/** R85 (ownership-core.js, the one implementation): the coverage of every source that has a number on the slate, and
 *  Map(source id -> its "lists N of M main players, only X% of their projected points" sentence) for each one set aside. */
function judgeOwnership(c, merged) {
  const named = new Map([...c.ownLabels].filter(([, s]) => (s.rows ?? []).length).map(([id]) => [id, new Set()]));
  for (const r of merged) {
    for (const o of [r.ownFlexBySource, r.ownCptBySource]) {
      for (const [id, v] of Object.entries(o ?? {})) {
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        if (!named.has(id)) named.set(id, new Set());
        named.get(id).add(r.id);
      }
    }
  }
  return judgeCoverage(merged, named, (id) => ownLabel(ownSrc(c, id)));
}

/** The board's R85 data (ownershipCoverage, ownershipUsedIds) for the file sources only; TwoGun is judged but is not a file source.
 *  Null / [] when the ownership file could not be used, as the file path leaves them. */
function ownershipCoverageOut(c, judged) {
  if (!c.ownershipUsable) return { ownershipCoverage: null, ownershipUsedIds: [] };
  const bySource = Object.fromEntries(Object.entries(judged.coverage.bySource).filter(([id]) => c.ownLabels.has(id)));
  const used = [...c.ownLabels].filter(([id, s]) => (s.rows ?? []).length && !judged.notUsed.has(id)).map(([id]) => id);
  return { ownershipCoverage: { ...judged.coverage, bySource }, ownershipUsedIds: used };
}

/** Adam's edits to one merged row's FLEX and Captain source numbers, applied in place to its per-source columns before R85
 *  judges coverage. Returns { fx, cp }, each applyEdits' { values, edited }. */
function applyOwnEdits(c, r) {
  const fx = applyEdits(r.ownFlexBySource ?? {}, editsOf(c.edits, r.id, "sdOwnFlex"));
  const cp = applyEdits(r.ownCptBySource ?? {}, editsOf(c.edits, r.id, "sdOwnCpt"));
  r.ownFlexBySource = fx.values;
  r.ownCptBySource = cp.values;
  return { fx, cp };
}

/** FLEX and Captain ownership for one merged row: the edited numbers (applyOwnEdits' result, last argument), then the ticked sources, else the
 *  backups (D41, D40, D28); a source under 80% of the main players is recorded but never used (R85). */
function ownershipStep(c, r, ownOverrides, { fx, cp }) {
  const typedOwn = (id) => (id !== null && id !== undefined && Object.hasOwn(ownOverrides, id) ? toNumber(ownOverrides[id]) : null);
  const t = { flex: typedOwn(r.id), cpt: typedOwn(r.cptId) };
  r.override = { ...r.override, own: t.flex, ownCpt: t.cpt };
  const side = (values, key, kind, fn) => {
    const hits = Object.entries(values).filter(([id]) => !c.partial.has(id)).map(([id, v]) => ({ src: ownSrc(c, id), rec: { [key]: v } }));
    const ids = hits.map((h) => h.src.id);
    for (const w of [tickedWeights(c.kinds, kind, ids), c.backupOf(kind)?.(ids)]) {
      if (!w) continue;
      const out = fn(hits.filter((h) => h.src.id in w), (id) => w[id]);
      if (out) return { out, used: hits.filter((h) => h.src.id in w).map((h) => h.src.id) };
    }
    return { out: null, used: [] };
  };
  const method = c.kinds.sdOwnFlex?.method ?? "d41";
  const flex = side(fx.values, "flexOwn", "sdOwnFlex", (hits, weightOf) => flexOwnership(hits, { agreeWithin: c.agreeWithin, method, weightOf }));
  const cpt = side(cp.values, "cptOwn", "sdOwnCpt", (hits, weightOf) => captainOwnership(hits, { weightOf }));
  if (!c.ownershipUsable) {
    Object.assign(r, { ownFlex: null, ownCpt: null, ownKind: null, ownKindFlex: null, ownKindCpt: null, ownHow: null });
    if (t.flex !== null || t.cpt !== null) {
      const how = [];
      if (t.flex !== null) { r.ownFlex = t.flex; r.ownKindFlex = "override"; how.push(`FLEX: Adam's override ${fmt(t.flex)}%.`); }
      if (t.cpt !== null) { r.ownCpt = t.cpt; r.ownKindCpt = "override"; how.push(`Captain: Adam's override ${fmt(t.cpt)}%.`); }
      r.ownKind = "override";
      r.ownHow = how.join(" ");
    }
  } else {
    const notUsed = [...c.partial].filter(([id]) => id in fx.values || id in cp.values).map(([, text]) => text);
    Object.assign(r, ownershipEntry(r, { flex: flex.out, cpt: cpt.out, typed: t, notUsed }));
  }
  r.srcUsed = { ...r.srcUsed, ownFlex: c.ownershipUsable ? [...flex.used] : [], ownCpt: c.ownershipUsable ? [...cpt.used] : [] };
  if (flex.used.includes(TWOGUN_ID) || cpt.used.includes(TWOGUN_ID)) r.src.own = TWOGUN_ID;
  // Per slot, Captain and FLEX apart: "twogun" only where that slot's figure is TwoGun's alone (not a blend, not Adam's
  // typed number), so Q8's "not on TwoGun's board, counted at 0%" is said only of a slot it is true of (uniqueness-routes.js).
  const his = (side, typed) => (c.ownershipUsable && typed === null && side.used.length === 1 && side.used[0] === TWOGUN_ID ? TWOGUN_ID : "current");
  r.src.ownFlex = his(flex, t.flex);
  r.src.ownCpt = his(cpt, t.cpt);
  r.edited.ownFlex = editedList(fx.edited, flex.used);
  r.edited.ownCpt = editedList(cp.edited, cpt.used);
  delete r.own;
  delete r.ownBase;
}
