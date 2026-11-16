// The Optimizer's engine (PROJECT.md Part 4 "Optimizer"; DECISIONS.md D55 as amended 2026-10-10, D73, D74): N DraftKings
// classic lineups, one at a time, each the best lineup by projection (scoring: see objectiveScore) that keeps every rule Adam has switched on,
// every lock, the uniqueness he set against his saved lineups and every earlier lineup of the batch, and the
// per-position exposure caps as they stand at that moment (counted over this batch only, D74). It is a pure function over board rows: no network, no
// file writes, and no clock except the ten minute limit of the single-lineup search (bestClassicExact). The single-lineup builder (optimize.js) checks and shows one lineup; its classic search is here (bestClassicExact).
//
// Search: exact depth-first branch and bound, deterministic, no dependencies. A lineup is enumerated as one of the
// three position mixes the FLEX allows (3 RB, 4 WR or 2 TE), group by group (QB, RB, WR, TE, DST), each group a
// combination in projection order, so no lineup is visited twice. The bound for the unfilled part of a lineup is a
// per-position 0/1 knapsack (best projection for k players of a position within a salary budget), combined across
// the remaining positions; it ignores the team rules (cash's every-team cap included, cash mode job 1, 2026-10-17), so it
// is always an upper bound. Before each lineup, players
// that are dominated (dearer and lower projected than enough others that one of them can always replace them
// without breaking a rule) are trimmed; the safety argument is at trimPosition() and a test proves it.
//
// Lineups are ranked by total projection, then by lower salary, then by the sorted player ids, so ties are settled
// the same way on every machine. Projections are compared as integers (millionths of a point) so float rounding
// never decides anything.
//
// The file is split under R87 (moved, not edited): multi-settings.js (constants, helpers, settings), multi-search.js (bound tables, uniqueness
// index, per-lineup lists, searchOne), multi-prepare.js (the candidate pool), multi-explain.js (bends, quarterback pre-checks, why no lineup),
// multi-batch.js (the batch loop, Min % and pair rules, output). This file keeps the entry points and re-exports every name it exported before.
import { warn } from "../lib/log.js";
import { BUILD_CEILING_MS } from "./build-control.js"; // pure leaf: the one ten minute limit
import { mustAboveCapNotes } from "./qb-stacks.js"; // pure; per-QB stack settings
import { minPlan, percentNote, unmetMinNotes } from "./soft.js"; // pure; Min % and soft rules
import { cashEngineSettings } from "./cash.js"; // pure; entered only when settings.mode is "cash" (cash mode job 1, 2026-10-17)
import { byRealTotal } from "./sd-variance.js"; // pure; GPP variance per position (PROJECT.md Part 4 item 5, Adam 2026-11-11)
import { normaliseSettings, idsOfExisting } from "./multi-settings.js";
import { prepare } from "./multi-prepare.js";
import { makePrevIndex, availableLists, searchOne } from "./multi-search.js";
import { entryQbChecks } from "./multi-explain.js";
import { emptyExposure, varianceDraws, mustAboveCapItems, buildBatch, minEntries, exposureOf } from "./multi-batch.js";
export { RULE_KEYS, LEGACY_RULE_KEYS, OBJECTIVES, STACK_OWN_MAX, STACK_OPP_MAX, keptSidelinedNote, noSourceProjectionNote, dkKeyOf, pctToLineups, minLineups } from "./multi-settings.js";
export { minOutReason, pairBreak, lockedQbBlocks, qbEntryByKey, lockedQbBlocksRow } from "./multi-batch.js";
export { usableDsts } from "./multi-search.js";

// --------------------------------------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------------------------------------

/**
 * Make up to `settings.count` lineups.
 *
 * @param {object}   args
 * @param {object[]} args.rows      board rows (server/rank/board.js); overrides already merged (D28)
 * @param {object}   [args.slate]   the slate; `cap` or `salaryCap` is used when present, else $50,000 (D1)
 * @param {object}   [args.settings]
 *   locks, excludes: player ids. count: 1-150 (default 1). minUnique: 1-9 (default 1).
 *   maxExposure: {QB, RB, WR, TE, DST}, each {pct} (percent of the lineups asked for, rounded up) or {count}; per
 *     player, over this batch only, never the saved lineups (D74); default none. Any other form is ignored with a note.
 *   playerMaxExposure: {id: {pct}}, one player's own cap, sized and counted the same way; a locked player with a
 *     cap under 100% is refused (no lineups, a note).
 *   playerMinExposure: {id: {pct}}, rounded DOWN (minLineups; under one lineup forces nothing, with a note);
 *     soft.js forcedSet puts him in the lineups his pace needs
 *     (PROJECT.md Part 4 Optimizer (Min % and soft rules, Adam 2026-10-17)). No effect on a locked player.
 *   rules: {starredQbOnly, noSameTeamRbs, noSameGameRbs, noDstVsOwnPlayers}, each boolean, all true by default.
 *     Older keys qbStack, oneOffensivePerOtherTeam and rbWithOwnQbOnlyIfCatcher are accepted (LEGACY_RULE_KEYS).
 *   stackOwn (0-4, default 1), stackOwnOrMore (default true), stackOpp (0-3, default 0), stackOppOrMore (default
 *     true): D73, the lineup's quarterback with exactly (or, ticked, at least) that many offensive teammates
 *     and offensive players of the team he faces; never the defense.
 *   spreadDst (default false, Adam 2026-10-16): no defense in more than max(20% of count, count / usable DSTs) lineups.
 *   qbStacks (D73 amended 2026-10-17): per-QB entries; a side with either number set replaces the global side (qb-stacks.js).
 *   objective: "proj" (default); the retired "lev" and "projMinusOwn" are built on projection with a note. Rows flagged
 *     "outAfterStamp" are left out of every build unless locked.
 *   allowRbGames, avoidGames: game keys as on the board (row.gameId, e.g. "DET@ARI").
 *   countRules (GPP only; count-rules.js): hard rules asking at least or at most N men from one team, one game, or strictly under or over a percent owned (a man with no
 *     figure is in neither); every lineup keeps all of them, none bends, and a lineup they make impossible is named in a note (countRulesWhy).
 *   maxPerTeam: most players (defense included) from one team, as optimize.js maxFromTeam; default none. D76: it
 *     never limits the lineup quarterback's team or the team he faces, only every other team.
 *   Every running back, receiver and tight end counts toward the stack (D55 as amended 2026-10-17); catchers is ignored.
 *   mode: "gpp" (default) or "cash" (cash.js cashEngineSettings patches the settings; the result gains mode and basis).
 *   variancePos: {QB, RB, WR, TE, DST}, each a percent from 0 to 100 (absent or 0 is none), or the older variance (one percent at
 *     every position, read only when variancePos is absent): GPP only (sd-variance.js). Each lineup's every search runs on scores
 *     times a factor per man in 1 ± his position's percent, drawn from the saved lineups' count plus the lineup's index; the
 *     lineups are served best real total first, every figure real, with the one-line varianceNote.
 * @param {string}   [args.boardMode] "twogun" or "current": the board's mode, which picks a cash build's basis (cash refuses any other)
 * @param {Function} [args.onLineup] called after each finished lineup with the answer so far ({lineups, exposure, notes, bends}), for a build
 *   the public site may end early (site-src/site-worker.js)
 * @param {Array}    [args.existing] Adam's saved lineups (arrays of ids, or objects with ids/lineup/players/slots);
 *   they count for minimum unique players only, never for the exposure caps (D74); in cash the route and the site pass
 *   none (existingForSlate) and the engine ignores any it is given (Cash 3b fix round, 2026-10-17)
 * @returns {{lineups: Array<{ids: string[], salary: number, proj: number|null, median?: number|null, bent?: string}>, exposure: object, notes: string[], bends: Array<{lineup: number, label: string}>, mode?: "cash", basis?: "median"|"proj"|null}}
 *   exposure is still reported over saved plus new lineups (the Optimizer tab computes its own per tab, D74).
 *   ids are in DraftKings slot order QB, RB, RB, WR, WR, WR, TE, FLEX, DST; proj is always the lineup's projection,
 *   whatever the objective. Never throws.
 *   Cash only (Cash 2b fix, 2026-10-17): median (TwoGun's medians summed) is present on a median build, null when any
 *   player lacks one, and that build's proj is null when any player's projection is missing; mode
 *   is "cash"; basis is the picked basis, also on a refusal inside the build, and null only when none could be picked.
 */
export function generateLineups(args) {
  const notes = [];
  try {
    const { rows, slate, existing, boardMode, onLineup, deadline } = args ?? {};
    // `deadline` (epoch ms): the page-thread fallback's ten minute limit; the settings carry it to every search, the bend trials and the checks.
    const settings = typeof deadline === "number" && args.settings && typeof args.settings === "object" ? { ...args.settings, _deadline: deadline } : args?.settings;
    return runMode(rows, slate, settings, existing, notes, boardMode, onLineup);
  } catch (e) {
    warn("lineup: generate failed", { error: e && e.message });
    notes.push("Could not make lineups: the engine hit an unexpected error; the detail is in the server log or the browser console."); // detail is in the log line above, never in the note
    const cash = args?.settings?.mode === "cash" ? { mode: "cash", basis: null } : {}; // Cash mode job 2b, 2026-10-17
    return { lineups: [], exposure: emptyExposure(), notes, bends: [], ...cash };
  }
}

/** Cash mode job 1, 2026-10-17: GPP (mode "gpp" or absent) runs as it always did and never enters cash.js; cash runs on
 *  cashEngineSettings' patched settings everywhere and adds mode and basis; any other mode makes nothing. */
function runMode(rows, slate, settings, existing, notes, boardMode, onLineup) {
  const mode = settings && typeof settings === "object" ? settings.mode : undefined;
  if (mode === undefined || mode === null || mode === "gpp") {
    // Cash mode job 2b, 2026-10-17: only cashEngineSettings may set the internal cash keys, never a GPP caller.
    const { _cash, capAllTeams, ...gpp } = settings && typeof settings === "object" ? settings : {};
    return run(rows, slate, settings && typeof settings === "object" ? gpp : settings, existing, notes, onLineup);
  }
  if (mode !== "cash") {
    notes.push("mode must be cash or gpp");
    return { lineups: [], exposure: emptyExposure(), notes, bends: [] };
  }
  const c = cashEngineSettings(settings, rows, boardMode);
  if (c.fatal) {
    notes.push(c.fatal);
    return { lineups: [], exposure: emptyExposure(), notes, bends: [], mode: "cash", basis: null };
  }
  notes.push(...c.notes);
  // Cash 3b fix round, 2026-10-17: saves never count in cash (Adam: no minimum unique), so the engine drops them itself.
  const cashSnapshot = onLineup && ((partial) => onLineup({ ...partial, mode: "cash", basis: c.settings.objective }));
  return { ...run(rows, slate, c.settings, [], notes, cashSnapshot), mode: "cash", basis: c.settings.objective };
}

function run(rows, slate, settings, existing, notes, onLineup) {
  if (!Array.isArray(rows) || rows.length === 0) {
    notes.push("No player rows were supplied, so there is nothing to build lineups from.");
    return { lineups: [], exposure: emptyExposure(), notes, bends: [] };
  }
  const existingList = Array.isArray(existing) ? existing.map(idsOfExisting).filter((ids) => ids.length) : [];
  const opts = normaliseSettings(settings, slate, existingList.length, notes);
  if (opts.fatal) {
    notes.push(opts.fatal);
    return { lineups: [], exposure: emptyExposure(), notes, bends: [] };
  }

  const st = prepare(rows, opts, notes);
  if (st.fatal) {
    notes.push(st.fatal);
    return { lineups: [], exposure: exposureOf(st, existingList.map((ids) => ids.map((id) => st.keyOfId.get(id) ?? `id:${id}`)), opts), notes, bends: [] };
  }
  // A locked player is in every lineup, so a Max % allowing fewer than the count is refused, never broken (D74).
  const lockedCapped = opts.locks.filter((id) => opts.playerCap.has(id) && opts.playerCap.get(id).n < opts.count);
  if (lockedCapped.length) {
    for (const id of lockedCapped) {
      const name = st.byId.get(id)?.name ?? id;
      const { n, pct } = opts.playerCap.get(id);
      notes.push(`Locked ${name} is capped at ${n} of ${opts.count} lineups (${pct}%); unlock him or raise his Max %.`);
    }
    return { lineups: [], exposure: emptyExposure(), notes, bends: [] };
  }

  // Saved lineups, as DK keys (two board rows of one man count as one player).
  const prevKeys = existingList.map((ids) => ids.map((id) => st.keyOfId.get(id) ?? `id:${id}`));
  const unknown = new Set();
  for (const ids of existingList) for (const id of ids) if (!st.keyOfId.has(id)) unknown.add(id);
  if (unknown.size) {
    notes.push(`${unknown.size} player${unknown.size === 1 ? "" : "s"} in the saved lineups ${unknown.size === 1 ? "is" : "are"} not on this board; they still count for uniqueness but not for exposure by position.`);
  }

  const prev = makePrevIndex(st, prevKeys, opts.count);
  // D74: the caps count this batch only, so the counts start empty; saved lineups are in `prev` for uniqueness alone.
  const counts = new Map();

  // Locks above a position's exposure cap: the lock wins (every lineup must hold him), and Adam is told.
  for (const c of st.lockCands) {
    const capN = opts.capCount[c.pos];
    if (capN !== undefined && opts.count > capN) {
      notes.push(`${c.name} is locked, so he is in every new lineup even though that takes him past the ${c.pos} maximum exposure (${opts.capLabel[c.pos]}).`);
    }
  }

  const mustNoted = entryQbChecks(rows, settings, slate, existingList.length, prevKeys, opts, st, notes);

  if (opts.stats) opts.stats.exactSalaryUnits = st.exact;
  // D74: a Min under one lineup forces nothing; one note per player on the board (twin rows are one man), and none when
  // another row of his DraftKings key has a Min that reaches a lineup (it forces him).
  const forcedKeys = new Set([...opts.playerMin.keys()].filter((id) => st.byId.has(id)).map((id) => st.keyOfId.get(id)));
  const underKeys = new Set(forcedKeys);
  for (const [id, { pct }] of opts.minUnderOne) {
    if (!st.byId.has(id) || underKeys.has(st.keyOfId.get(id))) continue;
    underKeys.add(st.keyOfId.get(id));
    notes.push(`${st.byId.get(id).name ?? id}'s Min % of ${pct} is under one lineup of ${opts.count}, so it forces nothing.`);
  }
  const plan = minPlan(minEntries(opts, st));
  const named = (map) => [...map].map(([id, { pct }]) => ({ name: st.byId.get(id)?.name ?? id, pct }));
  const shortNote = (made) => percentNote(opts.capPct, named(opts.playerCap), named(opts.playerMin), opts.count, made);
  // The answer's order: made order, or best real total first on a varied batch (sd-variance.js byRealTotal; GPP builds by projection).
  const shown = (lineups, bends) => (opts.variance ? byRealTotal(lineups, bends, [], "proj") : { lineups: [...lineups], bends: [...bends] });
  // A build ended early (site-src/site-worker.js, server/lib/app-build.js) is short of the lineups its percents were sized for, and says so.
  const snapshot = onLineup && ((lineups, bends) => {
    const short = lineups.length < opts.count ? shortNote(lineups.length) : null;
    const now = shown(lineups, bends);
    onLineup({ lineups: now.lineups, exposure: exposureOf(st, prevKeys, opts), notes: short ? [...notes, short] : [...notes], bends: now.bends });
  });
  const b = buildBatch({ rows, settings, slate, existingCount: existingList.length, prevKeys, prev, counts, opts, st, plan, notes, mustNoted, snapshot, variance: varianceDraws(st, opts) });
  notes.push(...unmetMinNotes(plan, counts, { complete: b.lineups.length === opts.count, bentKeys: b.bentKeys, waits: b.waits }));
  notes.push(...mustAboveCapNotes(mustAboveCapItems(st, opts, counts, prevKeys.slice(existingList.length)), b.lineups.length));
  const short = shortNote(b.lineups.length);
  if (short) notes.push(short);
  const answer = shown(b.lineups, b.bends);
  return { lineups: answer.lineups, exposure: exposureOf(st, prevKeys, opts), notes, bends: answer.bends };
}

/**
 * The one best classic lineup by projection among `rows`, for the single Build (optimize.js exactClassic, Adam 2026-11-02): this
 * engine's search with no roster rule, every team capped (no D76 exemption, as Build's Max per team has always been) and "stackQbWith or
 * more" teammates. `rows`: only men the caller may roster, the locks among them. Returns { ids }, ids null when no lineup
 * exists, or { fatal } with this engine's sentence. The search has no step limit: what it returns is proven best. `deadline` (epoch ms,
 * default now plus the ten minute BUILD_CEILING_MS) ends it unfinished, read on the clock every 4,096 nodes: { ids: null, timedOut: true }.
 * `oneGameOk`: lift DraftKings' two-games rule, only to say that rule is what left no lineup.
 */
export function bestClassicExact(rows, { locks, cap, maxPerTeam, stackQbWith, oneGameOk = false, deadline = Date.now() + BUILD_CEILING_MS }) {
  const notes = [];
  const opts = normaliseSettings({
    count: 1, minUnique: 1, locks, cap, maxPerTeam, objective: "proj", stackOpp: 0, stackOppOrMore: true, stackOwn: 0, stackOwnOrMore: true,
    rules: { starredQbOnly: false, noSameTeamRbs: false, noSameGameRbs: false, noDstVsOwnPlayers: false }, capAllTeams: true, _cash: true
  }, null, 0, notes);
  opts.stackOwn = stackQbWith; // Build's own count: Make N's request limit (STACK_OWN_MAX) has never applied to it
  opts.deadline = deadline;
  const st = prepare(rows, opts, notes);
  if (st.fatal) return { fatal: st.fatal };
  st.oneGameOk = oneGameOk;
  const prev = makePrevIndex(st, [], 1);
  const r = searchOne(st, availableLists(st, opts, new Map(), prev), prev, opts, Infinity);
  if (r.timedOut) return { ids: null, timedOut: true }; // not proven best: never served
  return { ids: r.best ? r.best.map((c) => c.id) : null };
}
