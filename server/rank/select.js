// Source numbers -> edits -> ticks (D17, D37, D35) -> backup gaps -> typed numbers (D28); missing stays missing (D29); pure (D71).
//
// applySources(inputs, opts) -> the board for one contest type, from saved choices and edits (Sources page plan).
// opts: { slateKind: "classic" | "showdown", selection (source-selection.json, or its kinds), edits (edits-core.js
//   editsByRow Map), overrides (the week's D28 file), backup: { <kind>: selection-core.js backupIds(selection, kind) },
//   preset (presetOf(selection)), note (the selection's board note), agreeWithin (Showdown, R81) }.
// inputs.twogun, both contest types: { load (load.js loadTwoGun's result, snapshot left out), snapshot, joined
//   (join.js joinTwoGun; classic) }, or absent (read as failed). Classic reads his numbers through joined; Showdown
//   rows carry them in projBySource / ownFlexBySource / ownCptBySource under "twogun", counted only while he is usable.
// inputs, classic: server/rank/board.js's board with each row's blend outputs left out (proj, projBase, own, ownBase,
//   ownKind, ownAnchor, coverage, value, tags, override, starred, note), plus dkSlate ({ games }: the DraftKings
//   slate's games) and per row ownQuotes ({ <id>: { own, parts } }, each ownership source's quote) and flags holding
//   only the source flags (sourceFlagsOf), plus each row's projStatsBySource (project.js statsBySource), which applySources
//   re-blends into projStats with the same weights as the row's Proj (a row with none keeps the projStats it came with).
// inputs, Showdown: select-showdown.js.
import { blendProjections, blendStats, failedPositions, BLEND_FLAGS, projRecipe, filledText } from "./blend.js";
import { ownershipOf, ownershipRecipe } from "./ownership-summary.js";
import { remergeOverrides } from "./remerge.js";
import { EMPTY_OVERRIDES } from "../overrides/merge.js";
import { spreadForTeam } from "./games.js";
import { isSidelined, toNumber } from "./value-core.js";
import { withSelfCheck } from "./self-check.js";
import { rowIsInactive, rowHideKind } from "./sidelined.js";
import {
  TWOGUN_LABEL, gameLines, patchGame, tgOf, applyCall, statusChanged, espnStatusOf, hideStatusOf, currentSrc, addFlag,
  markTeammatesAndStale, unmatchedGames, twogunCards, recipesFor, summaryOf, twogunStatus, twogunNote, ageReason
} from "../twogun/overlay.js";
import { ANY, TWOGUN_ID, APPLIES_TO_CLASSIC, decide, ticksOnlyTwoGunProjection, backupIds } from "../sources/selection-core.js";
import { applyShowdownSources } from "./select-showdown.js";

const DERIVED_FLAGS = new Set(["injured", "lineDiffers", "salaryDiffers", "outAfterStamp", "statusChangedAfterStamp", "heldOut", "teammateOutAfterStamp", "twogunStale", "revived", "no FLEX row", "no Captain row"]);
const PRESET_ACTIVE = { twogun: "twogun", ours: "current" };
export const NOT_LOADED_NOTE = "TwoGun's board was not loaded for this slate.";

export const kindsOf = (selection) => selection?.kinds ?? selection ?? {};
const positive = (w) => (typeof w === "number" && Number.isFinite(w) && w > 0 ? w : null);

export function tickedWeights(kinds, kind, ids) {
  const out = {};
  for (const id of ids) {
    const e = decide(kinds, kind, id);
    if (e?.use === true && positive(e.weight) !== null) out[id] = e.weight;
  }
  return out;
}

/** The backup weights for `kind` under gaps "backup": `list` is backupIds' [{ id, weight }] taken as given, "*"
 *  standing for each of `ids` it does not name (never TwoGun, and never an id whose own stored entry has weight 0, as
 *  classic backupIds drops those; Stokastic's Captain figure is an ordinary source, D40 amended). null otherwise. */
export function backupWeights(kinds, kind, list) {
  if (kinds?.[kind]?.gaps !== "backup" || !Array.isArray(list) || !list.length) return null;
  const entries = list.filter((e) => typeof e?.id === "string" && positive(e.weight) !== null);
  const named = new Set(entries.map((e) => e.id));
  const stored = kinds[kind].sources ?? {};
  const weightless = (x) => Object.hasOwn(stored, x) && positive(stored[x]?.weight) === null;
  return (ids) => {
    const out = {};
    for (const { id, weight } of entries) {
      const fills = id === ANY ? ids.filter((x) => !named.has(x) && x !== TWOGUN_ID && !weightless(x)) : ids.includes(id) ? [id] : [];
      for (const x of fills) out[x] = weight;
    }
    return out;
  };
}

export const editsOf = (edits, rowId, kind) => ((edits?.get?.(rowId) ?? []).filter((e) => e?.kind === kind && typeof e.sourceId === "string"));

export function applyEdits(numbers, list) {
  const values = { ...numbers };
  const edited = [];
  for (const e of list) {
    const from = toNumber(values[e.sourceId]);
    const to = e.value === null ? null : toNumber(e.value);
    if (to === null) delete values[e.sourceId];
    else values[e.sourceId] = to;
    edited.push({ sourceId: e.sourceId, from, to });
  }
  return { values, edited };
}

/** row.edited entries: `applied` is whether the edited source reached the number shown. */
export const editedList = (edited, used) => edited.map((e) => ({ ...e, applied: used.includes(e.sourceId) }));

export const sourceFlagsOf = (row) => (row.flags ?? []).filter((f) => !BLEND_FLAGS.has(f) && !DERIVED_FLAGS.has(f) && !String(f).startsWith("sourceFailed:"));

/** inputs.twogun as one shape for both contest types; absent is failed with NOT_LOADED_NOTE. `needJoin`: classic. */
export function twogunInput(tg, { needJoin = false } = {}) {
  if (!tg) return { present: false, load: { status: "failed", snapshot: null, note: NOT_LOADED_NOTE }, snapshot: null, joined: null, status: "failed", usable: false };
  const load = tg.load ?? null;
  const snapshot = tg.snapshot ?? null;
  const status = twogunStatus(load ? { ...load, snapshot } : { status: snapshot ? "ok" : "missing", snapshot, ageAtLockH: null });
  const usable = (status === "ok" || status === "stale") && Boolean(snapshot) && (!needJoin || Boolean(tg.joined));
  return { present: true, load, snapshot, joined: usable ? tg.joined ?? null : null, status: usable ? status : status === "missing" ? "missing" : "failed", usable };
}

/** `kinds`: the selection the board was built from. cashMode is the basis a Cash build reads (server/lineup/cash.js
 *  cashBasis), decided here so the app and the public site read one answer: TwoGun's median only when he is the only
 *  projection source ticked (Adam's Cash rule), else the projection. A caller that passes no `kinds` gets cashMode null, so
 *  cashBasis refuses the board instead of a quiet projection build (code review of a9455a0, note 4). `appliesTo`: what the
 *  board's choices cover, its own scope's wording (selection-core.js; each scope keeps its own choices, Adam 2026-10-20). */
export function modeOf(preset, load, status, summary, note = null, kinds, appliesTo = APPLIES_TO_CLASSIC) {
  const known = kinds !== null && typeof kinds === "object";
  return {
    active: PRESET_ACTIVE[preset] ?? "custom",
    preset: preset ?? null,
    cashMode: known ? (ticksOnlyTwoGunProjection(kinds) ? "twogun" : "current") : null,
    appliesTo,
    note,
    twogun: {
      status,
      file: load?.file ?? null,
      boardUpdated: load?.boardUpdated ?? null,
      ownershipUpdated: load?.ownershipUpdated ?? null,
      ageAtLockH: toNumber(load?.ageAtLockH),
      stale: status === "stale",
      covered: summary ? summary.covered : null,
      fallback: summary ? summary.fallback : null,
      note: summary ? summary.note : twogunNote(load, status)
    }
  };
}

// projRecipe and filledText live in blend.js (the public site words a re-blended board with them too); re-exported for the callers here.
export { projRecipe, filledText };

/** True when TwoGun feeds this board: ticked in one of `kinds`' sections, or (classic only: Showdown never applies
 *  lines or calls) switched on for lines or calls. */
export const ticksTwoGun = (kinds, sections, { classic = true } = {}) => sections.some((k) => decide(kinds, k, TWOGUN_ID)?.use === true) ||
  (classic && (kinds?.lines?.primary === TWOGUN_ID || kinds?.injuries?.twogunCalls === true));

/** The stale list with "twogun" added when he feeds the board and is not fresh (D30 as amended; absent counts). */
export const staleWith = (stale, feeds, status) => (feeds && status !== "ok" ? [...new Set([...(stale ?? []), TWOGUN_ID])] : [...(stale ?? [])]);

export function applySources(inputs, options = {}) {
  if (options.slateKind === "showdown") return withSelfCheck(applyShowdownSources(inputs, options));
  if (options.slateKind !== "classic") throw new Error(`applySources: slateKind must be "classic" or "showdown", not ${JSON.stringify(options.slateKind)}`);
  return withSelfCheck(applyClassic(inputs, options)); // G65: the board checks itself (self-check.js)
}

function applyClassic(inputs, opts) {
  const c = classicPlan(inputs, opts);
  const rows = c.prepared.map((x) => classicRow(c, x));
  return finishClassic(c, inputs, opts, rows);
}

/** Everything the rows need: the ticked and backup weights, the edited numbers, both blends and the lines used. */
function classicPlan(inputs, opts) {
  const kinds = kindsOf(opts.selection);
  const rowsIn = inputs.rows ?? [];
  const state = inputs.injuryReport?.state ?? "ok";
  const tg = twogunInput(inputs.twogun, { needJoin: true });
  const cards = (inputs.sources ?? []).filter((c) => c.id !== TWOGUN_ID);
  const projCards = cards.filter((c) => c.kind === "projection");
  const labels = { ...Object.fromEntries(cards.map((c) => [c.id, c.label ?? c.id])), [TWOGUN_ID]: TWOGUN_LABEL };
  const liveProj = projCards.filter((c) => (c.recordCount ?? 0) > 0).map((c) => c.id);
  if (tg.usable && (tg.snapshot.players ?? []).length) liveProj.push(TWOGUN_ID);
  const failCards = [...projCards, { id: TWOGUN_ID, missingPositions: [] }];
  const plan = (weights) => (weights ? { weights, failed: failedPositions(failCards.filter((c) => c.id in weights), (id) => weights[id]) } : null);
  const projP = plan(tickedWeights(kinds, "projection", liveProj));
  const projB = plan(backupWeights(kinds, "projection", opts.backup?.projection)?.(liveProj) ?? null);
  const prepared = rowsIn.map((row) => prepareRow(row, tg, opts.edits, labels, adamIn(opts.overrides, row)));
  const status = new Map(rowsIn.map((r) => [r.id, r.status ?? null]));
  const blendOf = (p) => (p && Object.keys(p.weights).length
    ? blendProjections(rowsIn, new Map(prepared.map((x) => [x.row.id, x.blendIn])), p.weights, { labels, injuryStatus: status, injuryReport: state })
    : null);
  const primary = blendOf(projP) ?? blendProjections(rowsIn, new Map(), {}, { labels, injuryStatus: status, injuryReport: state });
  const ownRan = cards.filter((c) => c.kind === "ownership" && c.status !== "not run" && c.status !== "disabled");
  const ownIds = [...new Set([...ownRan.map((c) => c.id), ...prepared.flatMap((x) => Object.keys(x.own.quotes))])];
  const dkSlate = inputs.dkSlate ?? { games: [] };
  const lines = tg.usable ? gameLines(inputs.games, tg.snapshot.games, dkSlate) : new Map();
  const espnTotal = new Map((inputs.games ?? []).map((g) => [g.gameId, toNumber(g.total)]));
  const linesUsed = new Map([...lines].filter(([id]) => kinds.lines?.primary === TWOGUN_ID || espnTotal.get(id) === null || espnTotal.get(id) === undefined));
  return {
    kinds, rowsIn, state, tg, cards, labels, liveProj, projP, projB, prepared, primary, backup: blendOf(projB), dkSlate, linesUsed,
    callsOn: tg.usable && kinds.injuries?.twogunCalls === true, preset: opts.preset ?? null, ownRan,
    ownP: tickedWeights(kinds, "ownership", ownIds), ownB: backupWeights(kinds, "ownership", opts.backup?.ownership)?.(ownIds) ?? null,
    // What would fill a man whatever the gaps say (as if "backup"), for the public site: its visitor can untick TwoGun or change the gaps rule, and the fill then follows (site-src/site-weights.js).
    projBAny: plan(anyBackup(kinds, "projection", liveProj)), ownBAny: anyBackup(kinds, "ownership", ownIds)
  };
}

/** The backup weights of `kind` as if its gaps were "backup": { id: weight } or null; the weights a source keeps while unticked (backupIds). */
function anyBackup(kinds, kind, ids) {
  if (!kinds?.[kind]) return null;
  const asBackup = { ...kinds, [kind]: { ...kinds[kind], gaps: "backup" } };
  return backupWeights(asBackup, kind, backupIds({ kinds: asBackup }, kind))?.(ids) ?? null;
}

/**
 * Whether TwoGun's own OUT call keeps his figure out of a man's blend (D25 as amended, D45): it does, unless Adam marked the man In AND his figure is above 0 (a 0 on his
 * own OUT call is the OUT, not a projection, so the other sources fill him). The one copy; the public site's re-blend uses it too (site-src/site-weights.js).
 */
export const dropsHisFigure = ({ call, markedIn, hisProj }) => call === "OUT" && !(markedIn && (toNumber(hisProj) ?? 0) > 0);

/** Adam's own In on this man (overrides.status, 2026-11-12): his word beats TwoGun's OUT call (source order, step 1), so his last figure is kept (D25 as amended). */
const adamIn = (overrides, row) => overrides?.status?.[row.id] === "in";

/** One row's source numbers after Adam's edits, with TwoGun's figures from the join. `markedIn`: Adam's In. */
function prepareRow(row, tg, edits, labels, markedIn = false) {
  const entry = tg.joined && row.dkId !== null && row.dkId !== undefined ? tg.joined.byDkId.get(String(row.dkId)) ?? null : null;
  const t = entry && (entry.player || entry.call) ? tgOf(entry.player ?? null, entry.call ?? null) : null;
  const hisProj = toNumber(entry?.player?.projection);
  const nums = { ...(row.projBySource ?? {}) };
  delete nums[TWOGUN_ID];
  if (hisProj !== null) nums[TWOGUN_ID] = hisProj;
  const proj = applyEdits(nums, editsOf(edits, row.id, "projection"));
  // D25 as amended: his OUT call keeps his figures out of the number (overlay.js patchRow), unless Adam marked him In: then his last figure stays, else the backups fill him.
  const blendIn = { ...proj.values };
  // D45: with Adam's In his figure counts only above 0 (dropsHisFigure).
  if (dropsHisFigure({ call: t?.call, markedIn, hisProj: blendIn[TWOGUN_ID] })) delete blendIn[TWOGUN_ID];
  return { row, t, hisProj, proj, blendIn, markedIn, own: ownQuotesOf(row, t, labels, editsOf(edits, row.id, "ownership")) };
}

function classicRow(c, { row, t, hisProj, proj, blendIn, own, markedIn }) {
  const pb = c.primary.byPlayerId.get(row.id);
  // His OUT call while he is ticked is his word on this man, not a gap: the backups never fill him (Adam's order, 2026-11-02: backups are for men TwoGun lacks). Adam's In is the exception.
  const calledOut = t?.call === "OUT" && !markedIn && TWOGUN_ID in (c.projP?.weights ?? {});
  const fromBackup = Boolean(c.backup) && pb.blend === null && !calledOut;
  const b = fromBackup ? c.backup.byPlayerId.get(row.id) : pb;
  const failed = ((fromBackup ? c.projB : c.projP)?.failed.get(row.pos) ?? []).filter((id) => blendIn[id] === null || blendIn[id] === undefined);
  const flags = [...b.flags, ...sourceFlagsOf(row), ...failed.map((id) => `sourceFailed:${id}`)];
  if (isSidelined(row.status) && !flags.includes("injured")) flags.push("injured");
  const hisNumber = b.sources.includes(TWOGUN_ID);
  const { projStatsBySource, ...served } = row; // an input only, never on the served row
  // Coverage is that of the blend the number came from: his own number reads 100%, a backup-filled man the backups' share.
  const r = { ...served, flags, projBySource: proj.values, ownBySource: own.numbers, proj: b.proj, projBase: b.proj, coverage: b.coverage };
  const stats = projStatsOf(row, projStatsBySource, fromBackup ? c.projB : c.projP);
  if (stats !== undefined) r.projStats = stats;
  const src = currentSrc(row);
  const line = c.linesUsed.get(row.gameId) ?? null;
  if (line) {
    r.spread = spreadForTeam(line, row.team);
    r.total = line.total;
    r.impliedTotal = line.implied[row.team] ?? null;
    src.line = TWOGUN_ID;
    if (line.differs) addFlag(r.flags, "lineDiffers");
  }
  if (hisNumber) src.proj = TWOGUN_ID;
  const { anchor, used: ownUsed } = ownershipOf(own.countable(t?.call === "OUT" && !markedIn), c.ownP, c.ownB); // Adam's In keeps TwoGun's ownership too
  r.own = anchor ? anchor.own : null;
  r.ownBase = r.own;
  r.ownKind = anchor ? "quoted" : null;
  r.ownAnchor = anchor;
  if (ownUsed.includes(TWOGUN_ID)) src.own = TWOGUN_ID;
  // The ids that made THIS man's Proj and Own (projBySource / ownBySource hold every source's number, ticked or not): the player card names only these (optimizer standard A8).
  r.srcUsed = { proj: [...b.sources], own: [...ownUsed] };
  if (t) {
    const used = c.callsOn || src.proj === TWOGUN_ID || src.own === TWOGUN_ID;
    const espn = espnStatusOf(row);
    if (used && t.salary !== null && t.salary !== toNumber(row.salary)) addFlag(r.flags, "salaryDiffers");
    // Source order: only a game-day inactive's or a ruled-out note's word may hide him (hideStatusOf); DraftKings' Status column is never read (Adam 12:13 AM 11-26).
    if (c.callsOn) applyCall(r, src, { tg: t, projected: hisProj !== null, espn: hideStatusOf(row), inactive: rowIsInactive(row), ruledOut: rowHideKind(row) === "ruled-out" });
    if (used && !t.outAfterStamp && statusChanged(t, { espn })) addFlag(r.flags, "statusChangedAfterStamp");
  }
  r.tg = t;
  r.src = src;
  r.edited = { proj: editedList(proj.edited, b.sources), own: editedList(own.edited, ownUsed), ownFlex: [], ownCpt: [] };
  return r;
}

/** Projected catches and rush yards (row.projStats): blended with the weights Proj used for this row (the ticked sources, or the
 *  backups when none of them covers him), so a weight change moves them with Proj. A defence or kicker, or an input row that
 *  carries no per-source stat lines, keeps the projStats it came with. `plan` is { weights, failed } or null. */
function projStatsOf(row, statsBySource, plan) {
  if (!statsBySource || row.pos === "DST" || row.pos === "K") return row.projStats;
  return blendStats(statsBySource, plan?.weights ?? {}); // blendStats' default keys are rec and rushYd, project.js PROJ_STAT_KEYS (which this pure module cannot import)
}

/** Adam's overrides on top (D28), then the board-level pieces: recipes, cards, stale list, unmatched, mode. */
function finishClassic(c, inputs, opts, rows) {
  const { tg, kinds, linesUsed } = c;
  if (tg.present) markTeammatesAndStale(rows, tg.status === "stale");
  const games = (inputs.games ?? []).map((g) => patchGame(g, linesUsed.get(g.gameId)));
  const typed = opts.overrides ?? EMPTY_OVERRIDES;
  const honoured = c.callsOn ? { ...typed, revive: [...(typed.revive ?? []), ...(typed.reviveTwoGun ?? [])] } : typed;
  const { twogun: _tg, dkSlate: _slate, ...boardIn } = inputs;
  const merged = remergeOverrides({ ...boardIn, rows, games }, c.dkSlate, honoured, inputs.generatedAt);
  for (const g of merged.games) if (linesUsed.has(g.gameId)) g.espnLine = linesUsed.get(g.gameId).espn;
  const twogunUsed = ["projection", "ownership"].some((k) => decide(kinds, k, TWOGUN_ID)?.use === true);
  const summary = tg.present && twogunUsed ? summaryOf(merged.rows, tg.status, tg.load) : null;
  const feeds = ticksTwoGun(kinds, ["projection", "ownership"]) || linesUsed.size > 0;
  const weightCard = (card) => {
    const e = decide(kinds, card.kind, card.id);
    const use = e?.use === true && positive(e.weight) !== null;
    // storedWeight: the weight the choices keep for the source whether or not it is ticked (weight is 0 while unticked), so the public site ticks it back on at that weight (selection-change.js).
    return { ...card, use, weight: use ? e.weight : 0, storedWeight: Number.isFinite(e?.weight) && e.weight >= 0 ? e.weight : null };
  };
  const tgCards = tg.present || feeds ? twogunCards(tg.load, tg.status, tg.joined, merged.rows, tg.usable ? tg.snapshot.players ?? [] : []).map(weightCard) : [];
  return {
    ...merged,
    generatedAt: inputs.generatedAt,
    notes: [...(inputs.notes ?? [])],
    tabNotes: Object.fromEntries(Object.entries(inputs.tabNotes ?? {}).map(([k, v]) => [k, [...(v ?? [])]])),
    stale: staleWith(inputs.stale, feeds, tg.status),
    sources: [...tgCards, ...c.cards.map((card) => (card.kind === "projection" || card.kind === "ownership" ? weightCard(card) : card))],
    unmatched: tg.joined
      ? { ...(inputs.unmatched ?? {}), bySource: { ...(inputs.unmatched?.bySource ?? {}), [TWOGUN_ID]: [...tg.joined.unmatched, ...unmatchedGames(tg.snapshot.games, c.dkSlate)] } }
      : inputs.unmatched,
    recipes: classicRecipes(c, inputs, opts, merged, summary),
    // backupWeights / backupOwnWeights: what fills a man no ticked source covers (Proj / Own), baked so the public site's weights re-blend fills him as classicRow does (site-weights.js).
    // twogunCalls / twogunBesides: whether his injury calls apply, and whether he feeds the board with neither card ticked (his lines or calls), so the site's
    // tick of a TwoGun card works out his flags and the stale list as this function does (site-src/site-weights.js).
    // backupAnyWeights / backupAnyOwnWeights / gaps: the same fill whatever the gaps say, and the gaps as the choices store them (opts.storedGaps, else the ones used), so the site's
    // visitor can untick TwoGun or flip a source and the fill and the "blank reads as backup once TwoGun is ticked" rule follow (selection-core.js classicProjectionGaps).
    mode: { ...modeOf(opts.preset, tg.load, tg.status, summary, opts.note ?? null, kinds), backupWeights: c.projB?.weights ?? null, backupOwnWeights: c.ownB ?? null,
      backupAnyWeights: c.projBAny?.weights ?? null, backupAnyOwnWeights: c.ownBAny ?? null,
      // choices: the choices the board was made from, as stored (the gaps as stored, not as read), so the site can rebuild them under a visitor's ticks and name the preset they land on (presetOf).
      choices: { ...kinds, projection: { ...kinds.projection, gaps: opts.storedGaps?.projection ?? kinds.projection?.gaps }, ownership: { ...kinds.ownership, gaps: opts.storedGaps?.ownership ?? kinds.ownership?.gaps } },
      gaps: { projection: opts.storedGaps?.projection ?? kinds.projection?.gaps ?? null, ownership: opts.storedGaps?.ownership ?? kinds.ownership?.gaps ?? null },
      twogunCalls: c.callsOn, twogunBesides: ticksTwoGun(kinds, []) || linesUsed.size > 0 }
  };
}

function classicRecipes(c, inputs, opts, merged, summary) {
  const { labels, state, projP, projB, ownP, ownB } = c;
  const ownRecipe = ownRecipeOf(c);
  if (opts.preset !== "twogun") {
    return { ...(inputs.recipes ?? {}),
      projection: projRecipe(projP?.weights, labels, state) + (c.rowsIn.length ? filledText(projP?.weights, projB?.weights, projRecipe(projB?.weights, labels, state)) : ""),
      ownership: ownRecipe(ownP) + (c.rowsIn.length ? filledText(ownP, ownB, ownRecipe(ownB)) : "") };
  }
  return twogunPresetRecipes(c, inputs.recipes, merged.rows, summary);
}

/** The ownership sentence's one builder: each ownership card that ran with its weight in `w`, then TwoGun's quote when he is in it. */
const ownRecipeOf = (c) => (w) => ownershipRecipe([...c.ownRan.map((card) => ({ label: c.labels[card.id], weight: w?.[card.id] ?? 0 })),
  ...(w && TWOGUN_ID in w ? [{ label: TWOGUN_LABEL, weight: w[TWOGUN_ID] }] : [])]);

/**
 * The two sentences of a board under the "TwoGun only" preset (his numbers, then the backups or the plain statement that nothing fills a gap). Exported so the public site words a
 * board whose ticks land on that preset the same way (site-src/site-weights.js). `c`: { labels, state, kinds, projB: { weights } | null, ownB (weights | null), ownRan (the ownership
 * cards that ran), tg: { usable, status, load } }; `rows`: the board's rows, for his counts when `summary` is not given.
 */
export function twogunPresetRecipes(c, baseRecipes, rows, summary = null) {
  const { labels, state, projB, ownB } = c;
  const ownRecipe = ownRecipeOf(c);
  const s = summary ?? summaryOf(rows, c.tg.status, c.tg.load);
  const out = recipesFor({ recipes: { ...(baseRecipes ?? {}), projection: projRecipe(projB?.weights, labels, state), ownership: ownRecipe(ownB) } }, c.tg.status, s, c.tg.load);
  const fills = (b) => Boolean(b) && Object.keys(b).length > 0;
  if (!fills(projB?.weights)) out.projection = blankProjection(c, s);
  if (!fills(ownB)) out.ownership = blankOwnership(c, s);
  return out;
}

/** "TwoGun only" with nothing to fill his gaps (gaps "blank", or no backup returning data): said as it is (A6). */
function blankProjection(c, s) {
  const why = c.kinds.projection?.gaps === "blank" ? "the source choices leave missing players blank" : "no backup source is returning data";
  const rule = c.state === "missing"
    ? 'each is left blank, flagged "no projection" (the injury report is missing).'
    : 'each is left blank, flagged "no projection" (0 when the injury report lists him out, on IR, doubtful or suspended).';
  if (!c.tg.usable) return `TwoGun only is chosen, but TwoGun's board could not be used, and ${why}, so no player is filled from other sources: ${rule}`;
  const stale = c.tg.status === "stale" ? ` ${ageReason(c.tg.load) ?? "An older TwoGun snapshot is served because the newest could not be used, so every TwoGun figure is marked stale."}` : "";
  return `TwoGun only: Proj is TwoGun's own DraftKings projection for the ${s.covered} players he projects (board updated ${c.tg.load?.boardUpdated ?? "at an unknown time"}), used exactly as he publishes it.${stale} The other ${s.fallback} players are not filled from other sources (${why}), so ${rule}`;
}

function blankOwnership(c, s) {
  const why = c.kinds.ownership?.gaps === "blank" ? "the source choices leave missing players blank" : "no backup source is returning data";
  if (!c.tg.usable) return `TwoGun only is chosen, but TwoGun's board could not be used, and ${why}, so Own% is blank for every player: the app never estimates ownership.`;
  return `TwoGun only: Own% is TwoGun's projected ownership for a Milly Maker-size field for the ${s.ownCovered} players he lists one for (ownership updated ${c.tg.load?.ownershipUpdated ?? "at an unknown time"}); ${why}, so every other player's Own% is blank: the app never estimates ownership.`;
}

function ownQuotesOf(row, t, labels, edits) {
  const quotes = {};
  for (const [id, own] of Object.entries(row.ownBySource ?? {})) {
    if (id === TWOGUN_ID) continue;
    quotes[id] = row.ownQuotes?.[id] ?? { own, parts: [{ own, source: labels[id] ?? id, url: null }] };
  }
  if (t && t.ownMilly !== null) quotes[TWOGUN_ID] = { own: t.ownMilly, parts: [{ own: t.ownMilly, source: TWOGUN_LABEL, url: null }] };
  const numbers = Object.fromEntries(Object.entries(quotes).map(([id, q]) => [id, q.own]));
  const { values, edited } = applyEdits(numbers, edits);
  for (const e of edited) {
    if (e.to === null) delete quotes[e.sourceId];
    else quotes[e.sourceId] = { own: e.to, parts: [{ own: e.to, source: labels[e.sourceId] ?? e.sourceId, url: null }] };
  }
  return {
    quotes,
    numbers: values,
    edited,
    countable: (calledOut) => Object.fromEntries(Object.entries(quotes).filter(([id]) => !(calledOut && id === TWOGUN_ID)))
  };
}
