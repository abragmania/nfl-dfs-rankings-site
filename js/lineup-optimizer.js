// The Optimizer's logic (split out of lineup.js, Adam 2026-10-18, moved not edited): cash mode's Want/Must/swap pieces, the
// pure request and validation helpers (percent boxes, Min % checks, the generate payload, the saved-set keys), and the actions
// (Build, Save all, Discard, the Optimizer band's event wiring). `state`, `opt` and the page-level variables are owned by
// lineup.js; this file imports them and holds only its own swap-cache and build counter. Panel markup is in lineup-view.js.
import { store, FLEX_POS, activeSlate, activeSlateRows, activeSlateGames, slateDisplayName, isTwoGunMode } from "./state.js";
import { rowIsOut } from "./table.js"; // D43: the one copy of "vs DAL" / "@ DET"; the red OUT tag (Adam 2026-10-15)
import { newBuildId, batchBuild } from "./lineup-builds.js";
import { nextSort, LOOK_SORT_KEYS } from "./lineup-sort.js"; // Adam 2026-10-17: sort options; the `Own vs field` key is stored as "geo"
import { toggleMustHave } from "./lineup-filter.js";
import { OPT_POSITIONS, exposureLimit, minLimit, nextExpSort } from "./lineup-exposure.js"; // A10: the one exposure table
import { wireQbStacks } from "./lineup-qb-stacks.js";
import { postLineupGenerate, postLineup, getLineups, stopLineupGenerate, canStopLineupGenerate } from "./api.js";
import { saveOutcome, isAlreadySavedAnswer } from "./save-outcome.js"; // Save and Save all never refuse a lineup already saved (Adam 6:30 PM 11-09)
import { afterBuildingDelay, goSitsBelow, stopFailure } from "./lineup-stop.js";
import { createNoticeController } from "./build-notice.js"; // A15: `Building...`, `Build finished.` and a failure under the filter bar while the Build row is off screen
import { ruleOn, countBelowMin, syncCountNote, COUNT_MIN_SENTENCE, fullLineupText } from "./lineup-settings.js";
import { answerTone } from "./row-message.js";
import { wireLimitBox, flushOpenLimit, limitRefusals } from "./limit-box.js"; // A3: the Min % and Max % boxes
import { limitsCrossed } from "./limit-cross.js"; // item 18: the row says `Min is above Max`
import {
  boardHasMedians, buildCashSettings, poolReport, wantSwaps, swapDecisionHtml, excludedListHtml, lineupModeOf, CASH_NO_MEDIAN_TEXT, CASH_UNKNOWN_BASIS_TEXT,
} from "./lineup-cash.js";
import {
  state, opt, LINEUP_SLOTS, SALARY_CAP, OBJECTIVES, MAX_TEAM_OPTIONS, OPT_MAX_COUNT, OPT_MAX_UNIQUE, OPT_DEFAULT_COUNT, OPT_DEFAULT_UNIQUE,
  OPT_STACK_OWN_MAX, OPT_STACK_OPP_MAX, OPT_DEFAULT_STACK, OPT_BUSY_TEXT, OPT_RULES, builtInText, effectiveObjective, dkIdentity, commit, lockPool, unlockPool,
  savePersisted, seasonWeekKey, lastContainer, resetOptimizerResults, clearMustHave, qbStacksForRequest, qbGlobals, setMode, removeSlot,
} from "./lineup.js";
import { heldSplit, cardIsSaved, optSummaryText, stackDefaultsApply, STACK_INERT_TITLE, savedOfActiveSlate, openSetops } from "./lineup-view.js";
import { requestTab } from "./lineup-tabs.js"; // Part F: the GPP | Cash click's gate
import { variancePosSettings, variancePosProblem, CLASSIC_VARIANCE_POSITIONS } from "./variance-pos.js"; // GPP variance per position (Adam 2026-11-11)
import { buildAfterQuiet } from "./lineup-left-out-panel.js"; // Part F: a Build goes before the quiet Left out build

// ---- Cash mode job 3b, 2026-10-17 (PROJECT.md Part 4 "Cash mode"; the pure pieces are in lineup-cash.js) ----

export const wantIdsFor = (slateKey) => opt.cash.want[slateKey] ?? [];

function setWant(slateKey, id, on) {
  const rest = wantIdsFor(slateKey).filter((w) => w !== id);
  opt.cash.want = { ...opt.cash.want, [slateKey]: on ? [...rest, id] : rest };
}

/** Must is the lock (D70), Want is membership of the cash pool for the slate on screen, Fine is neither (it takes a placed
 *  player out of his slot as unlocking does). Must keeps a Want listing; Want and Fine on a Must player unlock him first. */
export function cashPick(id, pick) {
  opt.cashUndo = null; // Cash 3b fix round, 2026-10-17: a pick after Make them Must is never silently undone by Undo
  const slateKey = slateKeyOf(store.get().board);
  if (pick === "must") {
    if (!state.locks.has(id)) lockPool(id);
    return;
  }
  const wasMust = state.locks.has(id);
  if (wasMust) unlockPool(id);
  else if (pick === "fine") {
    // A man clicked into the lineup is held by the Build; Fine (neither in nor wanted) takes him out, so the chip never reads active with no effect (D3, round 3 fixes).
    // The chip reads a man in the lineup by his DraftKings identity (a twin row of the same player counts), so Fine does too.
    const rowById = currentRowById();
    const idn = rowById.get(id) ? dkIdentity(rowById.get(id)) : null;
    const at = state.slots.findIndex((s) => s && (String(s.id) === id || (idn !== null && rowById.get(String(s.id)) && dkIdentity(rowById.get(String(s.id))) === idn)));
    if (at >= 0) removeSlot(at);
  }
  // Want: a Must or Fine player becomes Want only, a Want player goes back to Fine. Fine: off the list.
  setWant(slateKey, id, pick === "want" && (wasMust || !wantIdsFor(slateKey).includes(id)));
}

/** What a cash build is made by: {basis "median" | "proj" | null, blocked, text, why (blocked only: the summary's words)}. The
 *  board's own Cash basis decides (board.mode.cashMode, server/rank/select.js modeOf; code review of a9455a0, MUST 1, so a custom
 *  board agrees with the server): "twogun" builds by TwoGun's median and cannot build with no medians (CQ5), "current" by
 *  projection, and a board naming neither is blocked with the server's own refusal (cash.js cashBasis). */
export function cashBasisInfo(board) {
  const cashMode = board?.mode?.cashMode;
  if (cashMode === "current") return { basis: "proj", blocked: false, text: "Projection" };
  if (cashMode !== "twogun") return { basis: null, blocked: true, text: CASH_UNKNOWN_BASIS_TEXT, why: "the board names no Cash basis" };
  if (!boardHasMedians(activeSlateRows(board))) return { basis: null, blocked: true, text: CASH_NO_MEDIAN_TEXT, why: "no TwoGun medians" };
  const when = board?.mode?.twogun?.boardUpdated;
  return { basis: "median", blocked: false, text: `TwoGun's median${when ? ` (board updated ${when})` : ""}` };
}

/** The Wants of the slate on screen that are not Must, as board rows. */
export function wantRowsFor(slateKey, rowById) {
  return wantIdsFor(slateKey).filter((id) => !state.locks.has(id)).map((id) => rowById.get(id)).filter(Boolean);
}

/** The footer sentence in cash: "2 cash lineups by TwoGun's median · 1 Lock · 2 Want · max 3 per team" (no minimum-unique clause: Adam 2026-10-17). */
export function cashSummaryText(board) {
  const s = buildCashSettings(opt.cash);
  const info = cashBasisInfo(board);
  const rowById = currentRowById();
  const by = info.blocked ? `no basis (${info.why})` : info.basis === "median" ? "TwoGun's median" : "projection";
  const held = heldSplit(rowById); // D3 (round 3 fixes): a clicked-in man counts as in the lineup, a padlock only as Lock; both are kept by the Build
  const parts = [`${s.count} cash lineup${s.count === 1 ? "" : "s"} by ${by}`, ...(held.inLineup.length ? [`${held.inLineup.length} in the lineup`] : []), `${held.padlocked.length} Lock`, `${wantRowsFor(slateKeyOf(board), rowById).length} Want`];
  if (s.maxPerTeam !== null) parts.push(`max ${s.maxPerTeam} per team`);
  return parts.join(" · ");
}

/** The Wants a cash batch is judged on: the slate's Want list without the players locked when it was built (a Must is in every lineup). */
const cashWantIds = (results) => wantIdsFor(results.slateKey ?? "main").filter((id) => !(results.cash?.lockedIds ?? []).includes(id));

// Cash 3b fix round, 2026-10-17: the swap search costs about 0.9 s per hard Want over 150 cards, so each card's decisions are kept
// per batch (a WeakMap on the results object: a new batch starts clean) and searched again only when the Want list or the board changes.
const swapCache = new WeakMap();
export const swapScanHook = { onScan: null }; // tests only (tests/cash-wiring.test.mjs): counts the searches through wantSwaps' onScan

/** wantSwaps for one cash card, under the limits the batch was built with (results.cash). */
function cardSwapDecisions(lineup, results) {
  const board = store.get().board;
  const wantIds = cashWantIds(results);
  const key = [...wantIds].sort().join("|");
  if (!swapCache.has(results)) swapCache.set(results, new Map());
  const perCard = swapCache.get(results);
  const hit = perCard.get(lineup.uid);
  if (hit && hit.key === key && hit.board === board) return hit.decisions;
  const c = results.cash ?? {};
  const decisions = wantSwaps(lineup, wantIds, activeSlateRows(board), {
    basis: results.basis ?? "proj", cap: SALARY_CAP, excludedIds: c.excludedIds ?? [], lockedIds: c.lockedIds ?? [], maxPerTeam: c.maxPerTeam ?? null, avoidGames: c.avoidGames ?? [], onScan: swapScanHook.onScan,
  });
  perCard.set(lineup.uid, { key, board, decisions });
  return decisions;
}

/** A cash card's pool strip: the Wants left out and the cheapest swap for each (excludedListHtml, swapDecisionHtml), and the ids of the Wants that are in.
 *  Cash 3b fix round, 2026-10-17: the swap button is drawn only in cash mode, and disabled while `busy`. */
export function cashStrip(lineup, results, rowById, busy = false) {
  const wantIds = cashWantIds(results);
  if (!wantIds.length) return { html: "", wantIn: new Set() };
  const report = poolReport(lineup, wantIds, rowById);
  const decisions = cardSwapDecisions(lineup, results);
  const look = { button: opt.mode === "cash", disabled: busy };
  return { html: `<div class="cash-strip">${excludedListHtml(report)}${decisions.map((d, i) => swapDecisionHtml(d, i, look)).join("")}</div>`, wantIn: new Set(report.inLineup.map((r) => String(r.id))) };
}

// Cash 3b fix round, 2026-10-17: Make them Must and Undo act only in cash mode and never while a build or a save runs.
const cashSwapIdle = () => opt.mode === "cash" && !opt.generating && !opt.saving;

// Cash 3b fix round 2, 2026-10-17: the slots and locks as a copy, and whether the builder still holds a copy exactly.
const buildSnapshot = () => ({ slots: state.slots.map((s) => (s ? { ...s } : null)), locks: [...state.locks] });
const sameBuild = (b) => b.slots.length === state.slots.length && b.slots.every((s, i) => (s?.id ?? null) === (state.slots[i]?.id ?? null))
  && b.locks.length === state.locks.size && b.locks.every((id) => state.locks.has(id));

/** "Make them Must and rebuild": locks the Want(s) of one swap decision (never the partner), builds again, and offers Undo only
 *  when that build put a new batch in place (Cash 3b fix round 2, 2026-10-17); a build that did not run puts the locks and slots
 *  back, so the old batch stays with the form's or the server's sentence as the only message. */
async function cashMakeMust(uid, index) {
  if (!cashSwapIdle()) return;
  const board = store.get().board;
  if (cashBasisInfo(board).blocked) return;
  const r = opt.results;
  const lineup = r?.lineups.find((l) => l.uid === uid);
  if (!lineup || r.mode !== "cash") return;
  const d = cardSwapDecisions(lineup, r)[index];
  if (!d || d.kind === "none") return;
  const wants = new Set(cashWantIds(r));
  const picked = d.in.filter((x) => wants.has(String(x.id)));
  const before = buildSnapshot();
  opt.cashUndo = null;
  for (const x of picked) {
    const id = String(x.id);
    lockPool(id);
    // No open slot for him: a pool-only lock still counts as Must, since the server assigns slots itself; the Must chip instead
    // refuses with no open slot (D70). The two paths differ on purpose (Cash 3b fix round, 2026-10-17).
    if (!state.locks.has(id) && state.addError) {
      state.locks.add(id);
      state.addError = null;
    }
  }
  const after = buildSnapshot();
  const built = await doGenerate();
  // A later edit during the build wins: nothing is put back over it and no Undo is offered for it. Layout round 2, 2026-10-17:
  // a new board (a star in the pool) gates only the Undo offer, so a refused build still puts the locks back; the restore
  // also clears lockPool's "added anyway" note for a player no longer in a slot.
  if (!sameBuild(after)) return;
  if (!built) {
    state.slots = before.slots;
    state.locks = new Set(before.locks);
    state.addError = null;
  } else if (store.get().board === board) opt.cashUndo = { ...before, after, names: picked.map((x) => x.name) };
  commit();
}

/** Puts back the build before the last Make them Must and builds again; refused (the snapshot dropped, no rebuild) unless the
 *  slots and locks are still exactly what Make them Must left (Cash 3b fix round 2, 2026-10-17). */
function cashUndo() {
  if (!cashSwapIdle()) return;
  const u = opt.cashUndo;
  if (!u) return;
  opt.cashUndo = null;
  if (!sameBuild(u.after)) {
    commit();
    return;
  }
  state.slots = u.slots;
  state.locks = new Set(u.locks);
  state.addError = null;
  doGenerate();
}

// ---- Pure helpers (exported for tests/optimizer-ui.test.mjs) ----

/** A whole number from a text box, clamped to [min, max]; anything that is not a number gives `fallback`. */
export function parseWhole(text, min, max, fallback) {
  const t = String(text ?? "").trim();
  if (t === "") return fallback;
  const n = Number(t);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** A percent box: blank is "no cap" (null); a number from 0 to 100 (a trailing % sign is allowed) is that number;
 *  anything else (words, a negative, over 100) is NaN, which blocks Go (exposureProblem) and is never clamped. */
export function parsePct(text) {
  const t = String(text ?? "").trim().replace(/%$/, "").trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return NaN;
  return n;
}

/** The first maximum-exposure box that is neither blank nor a number from 0 to 100, as a plain sentence naming
 *  the position, else null. */
export function exposureProblem(maxExp) {
  for (const pos of OPT_POSITIONS) {
    if (Number.isNaN(parsePct(maxExp?.[pos]))) {
      return `${pos} maximum exposure must be a percent from 0 to 100, or blank for no cap.`;
    }
  }
  return null;
}

/** D74: exposure by position over one set of lineups, computed here so each results tab shows its own set. Each
 *  lineup is a list of players {id, name, pos, team, opp, own, identity?}; a player counts once per lineup, keyed by
 *  his DraftKings identity when given. Rows carry optExposureHtml's fields {id, name, team, opp, own, count, pct},
 *  pct of this set's lineups to one decimal. */
export function exposureOfLineups(lineups) {
  const out = Object.fromEntries(OPT_POSITIONS.map((p) => [p, []]));
  const list = (lineups ?? []).filter((l) => Array.isArray(l) && l.length);
  if (!list.length) return out;
  const byKey = new Map();
  for (const players of list) {
    const seen = new Set();
    for (const p of players) {
      if (!p || p.id == null) continue;
      const key = String(p.identity ?? p.id);
      if (seen.has(key)) continue;
      seen.add(key);
      const hit = byKey.get(key);
      if (hit) hit.count++;
      else byKey.set(key, { pos: p.pos, row: { id: String(p.id), name: p.name ?? String(p.id), team: p.team ?? null, opp: p.opp ?? "", own: p.own ?? null }, count: 1 });
    }
  }
  for (const { pos, row, count } of byKey.values()) {
    if (out[pos]) out[pos].push({ ...row, count, pct: Math.round((count / list.length) * 1000) / 10 });
  }
  return out;
}

/** A board id's DraftKings identity (dkIdentity), or the id itself when the board has no row for it. */
export function identityOf(id, rowById) {
  const row = rowById?.get(String(id));
  return row ? dkIdentity(row) : String(id);
}

/** One lineup as a set: its players' DraftKings identities, sorted, so the same nine players match in any slot order. */
export function lineupSetKey(ids, rowById) {
  return [...new Set((ids ?? []).map((id) => identityOf(id, rowById)))].sort().join("|");
}

/** The set keys of saved lineups (their slots' player ids): a new card whose key is here shows "Saved ✓". */
export function savedSetKeys(savedLineups, rowById) {
  return new Set((savedLineups ?? []).map((l) => lineupSetKey((l.slots ?? []).map((s) => s.playerId), rowById)));
}

/** The saved lineups of the slate on screen: those saved with its key; one saved with no slate counts on the main
 *  slate always and on a second slate when every player is in its games. This is the server's existingForSlate rule
 *  (server/lineup/generate-request.js), repeated because the browser app cannot import server files. With a `mode` (cash
 *  mode job 3b, 2026-10-17) only lineups of that mode count, a missing mode reading as GPP, as the server's mode filter does. */
export function savedForSlate(saved, slateKey, slateIds, mode = null) {
  const key = slateKey || "main";
  return (Array.isArray(saved) ? saved : [])
    .filter((l) => Array.isArray(l?.slots) && l.slots.length > 0)
    .filter((l) => mode === null || lineupModeOf(l) === mode)
    .filter((l) => (typeof l.slate === "string" && l.slate !== "" ? l.slate === key : key === "main" || l.slots.every((s) => slateIds.has(String(s.playerId)))));
}

/** A saved name that is unique on this slate: `wanted` when no name in `taken` equals it, else the lowest free
 *  "Lineup N" (N from 1). Names compare exactly, as the server's own "Lineup N" numbering does. */
export function uniqueSavedName(wanted, taken, stem = "Lineup") {
  const used = new Set((taken ?? []).map(String));
  if (!used.has(wanted)) return wanted;
  let n = 1;
  while (used.has(`${stem} ${n}`)) n++;
  return `${stem} ${n}`;
}

/** The board mode a lineup is built in, for its saved build record: "twogun", "custom" (the Sources page ticks match neither) or
 *  "current" (Our sources), null where the board has no mode switch (P23). A record saved earlier with "current" for a custom board
 *  still reads: "current" stays a valid word everywhere it is read. */
export function boardModeOf(board) {
  if (!board?.mode) return null;
  if (isTwoGunMode(board)) return "twogun";
  return board.mode.active === "custom" ? "custom" : "current";
}

/** The active slate's key: "main", or the second slate's key (D57). */
export function slateKeyOf(board) {
  return activeSlate(board)?.key ?? "main";
}

/** The pool's Max % boxes for one slate, {id: text}. */
export function playerMaxFor(slateKey) {
  return opt.playerMax[slateKey] ?? {};
}

/** The pool's Min % boxes for one slate, {id: text}. */
export function playerMinFor(slateKey) {
  return opt.playerMin[slateKey] ?? {};
}

/** Persisted Max % / Min % boxes, kept only as {slateKey: {id: text}} with string text; anything else is dropped. */
export function cleanPlayerMax(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [slate, map] of Object.entries(raw)) {
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    const kept = {};
    for (const [id, text] of Object.entries(map)) if (typeof text === "string" && text.trim() !== "") kept[id] = text;
    out[slate] = kept;
  }
  return out;
}

/** The first per-player Max % box that is neither blank nor a percent from 0 to 100, as a sentence naming the
 *  player (`nameOf(id)`), else null; it blocks Go like exposureProblem. */
export function playerMaxProblem(map, nameOf = (id) => id) {
  for (const [id, text] of Object.entries(map ?? {})) {
    if (Number.isNaN(parsePct(text))) return `${nameOf(id)}'s Max % must be a percent from 0 to 100, or blank for no cap.`;
  }
  return null;
}

const MIN_COUNT_PROBLEM = "The number of lineups must be a whole number before the Min % boxes can be checked.";
/** The first Min % box (`minMap`, {id: text}) that blocks Go, as a sentence naming the player, else null: not a percent
 *  from 0 to 100; more of the `asked` lineups (minLimit) than that player's Max % in `maxMap` allows (exposureLimit); or on
 *  an excluded player (`excluded`, a Set of ids); never for a Min under one lineup. The server refuses the same (PROJECT.md Part 4 Optimizer). */
export function playerMinProblem(minMap, maxMap, excluded, nameOf, asked) {
  for (const [id, text] of Object.entries(minMap ?? {})) {
    const min = parsePct(text);
    if (min === null) continue;
    if (Number.isNaN(min)) return `${nameOf(id)}'s Min % must be a percent from 0 to 100, or blank for none.`;
    if (Number.isNaN(minLimit(min, asked))) return MIN_COUNT_PROBLEM;
    if (!(minLimit(min, asked) > 0)) continue;
    const max = parsePct(maxMap?.[id]);
    if (max !== null && !Number.isNaN(max) && minLimit(min, asked) > exposureLimit(max, asked)) return `${nameOf(id)}'s Min % (${min}) is above his Max % (${max}).`;
    if (excluded.has(String(id))) return `${nameOf(id)} is excluded and has a Min %.`;
  }
  return null;
}

// The three position mixes the FLEX allows: a copy of CONFIGS in server/lineup/soft.js (the browser cannot import it).
const LINEUP_MIXES = [
  { QB: 1, RB: 3, WR: 3, TE: 1, DST: 1 },
  { QB: 1, RB: 2, WR: 4, TE: 1, DST: 1 },
  { QB: 1, RB: 2, WR: 3, TE: 2, DST: 1 },
];

/** soft.js slotsFull / lockedSlotWords: whether one more `pos` player fits no mix beside the locks (`locksAt`, {pos: n}). */
export function minSlotsFull(locksAt, pos) {
  const at = { ...locksAt, [pos]: (locksAt[pos] ?? 0) + 1 };
  return !LINEUP_MIXES.some((mix) => OPT_POSITIONS.every((p) => (at[p] ?? 0) <= mix[p]));
}

export function minSlotWords(pos) {
  return `the ${pos} slot${pos === "QB" || pos === "DST" ? " is" : "s are"} locked`;
}

/** A board row's DraftKings key, as the server's dkKeyOf: "dk:<dkId>", else "id:<id>". */
export function dkKeyOfRow(row, id) {
  const raw = row?.dkId == null ? "" : String(row.dkId).trim();
  return raw ? `dk:${raw}` : `id:${id}`;
}

const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null); // multi.js num: a numeric string is not a number
export const upperOf = (v) => (v === null || v === undefined ? "" : String(v).trim().toUpperCase());

/** Whether the pool drops this unlocked row, mirroring multi.js minOutReason for what the browser can see. `pool` =
 *  {excludes (Set), avoid (Set of game ids), starredQbOnly}. */
export function minRowOut(row, id, pool) {
  if (pool.excludes.has(String(id))) return true;
  const raw = upperOf(row?.pos);
  const listed = (Array.isArray(row?.rosterPositions) ? row.rosterPositions : []).map(upperOf).filter((p) => p && p !== "FLEX");
  const pos = OPT_POSITIONS.includes(raw) ? raw : listed.find((p) => OPT_POSITIONS.includes(p)) ?? null;
  const salary = numOrNull(row?.salary);
  if (!pos || salary === null || salary < 0) return true;
  const flags = Array.isArray(row.flags) ? row.flags : [];
  if (flags.includes("outAfterStamp") && !flags.includes("revived") && row.override?.status !== "in") return true; // Adam's own In clears it (2026-11-12)
  if (rowIsOut(row)) return true;
  const overridden = numOrNull(row.override?.proj) !== null;
  if (numOrNull(row.proj) === null || (!overridden && flags.includes("no projection"))) return true;
  const game = upperOf(row.gameId);
  if (game && pool.avoid.has(game)) return true;
  return Boolean(pool.starredQbOnly && pos === "QB" && !row.starred);
}

/** multi.js pairBreak as a yes/no. a, b: {pos, team, opp, game, key, never (a QB's "no" keys)}; `rules` the D55 switches.
 *  The browser sends no allowRbGames, so a same-game RB pair always clashes under noSameGameRbs. */
export function pairClash(a, b, rules) {
  if (a.pos === "RB" && b.pos === "RB") {
    if (rules.noSameTeamRbs && a.team && a.team === b.team) return true;
    if (rules.noSameGameRbs && a.game && a.game === b.game) return true;
  }
  const [d, o] = a.pos === "DST" ? [a, b] : [b, a];
  if (rules.noDstVsOwnPlayers && d.pos === "DST" && o.pos !== "DST" && d.opp && o.team === d.opp) return true;
  return [[a, b], [b, a]].some(([q, p]) => q.pos === "QB" && q.never?.has(p.key));
}

/** multi.js lockedQbRefuses: whether the first locked QB's stack caps (`rule` = {capOwn, capOpp}, Infinity for none) or
 *  the per-team limit filled by locks keep `cand` out of every lineup. Sides: {pos, team, opp, stackOk}. */
export function lockStackRefuses(cand, locks, rule, maxPerTeam) {
  const qb = locks.find((c) => c.pos === "QB");
  if (!qb || cand.pos === "QB") return false;
  const offense = locks.filter((c) => c.pos !== "QB" && c.pos !== "DST");
  if (cand.pos !== "DST" && cand.stackOk && cand.team === qb.team && offense.filter((c) => c.stackOk && c.team === qb.team).length >= rule.capOwn) return true;
  if (cand.pos !== "DST" && qb.opp && cand.team === qb.opp && offense.filter((c) => c.team === qb.opp).length >= rule.capOpp) return true;
  const outside = cand.team !== qb.team && cand.team !== qb.opp;
  return maxPerTeam !== null && outside && locks.filter((c) => c.team === cand.team).length >= maxPerTeam;
}

/** The pair-rule and locked-QB-stack skips of the route, for the request `settings` (buildGenerateSettings' output):
 *  {clashOf(id), stackOutOf(id)}; locks and stack entries by DraftKings key, the last entry winning, as the route (D73).
 *  `rowOf(id)` gives a board row; every back, receiver and tight end counts toward the stack (D55 as amended 2026-10-17). */
export function minLockSkips(rowOf, settings) {
  const rules = settings.rules ?? {};
  const keyOf = (id) => dkKeyOfRow(rowOf(id), id);
  const entryOf = (id) => Object.entries(settings.qbStacks ?? {}).filter(([qid]) => keyOf(qid) === keyOf(id)).map(([, e]) => e).pop();
  const never = (id) => new Set(Object.entries(entryOf(id)?.players ?? {}).filter(([, c]) => c === "no").map(([pid]) => keyOf(pid)));
  const side = (id) => {
    const r = rowOf(id) ?? {};
    const pos = upperOf(r.pos);
    return { pos, team: upperOf(r.team), opp: upperOf(r.opp), game: upperOf(r.gameId), key: dkKeyOfRow(r, id), never: never(id), stackOk: pos === "RB" || pos === "WR" || pos === "TE" }; // mirrors countsTowardStack in server/lineup/stack-rules.js
  };
  const locks = [...new Map((settings.locks ?? []).filter((id) => rowOf(id)).map((id) => [keyOf(id), id])).values()].map((id) => ({ id, ...side(id) }));
  const qb = locks.find((c) => c.pos === "QB");
  const stack = qb ? entryOf(qb.id) : undefined;
  const set = (a, b) => typeof a === "number" || typeof b === "number";
  const ownOn = !(settings.stackOwn === 0 && settings.stackOwnOrMore);
  const oppOn = !(settings.stackOpp === 0 && settings.stackOppOrMore);
  const rule = {
    capOwn: stack && set(stack.teammatesMin, stack.teammatesMax) ? stack.teammatesMax ?? Infinity : ownOn && !settings.stackOwnOrMore ? settings.stackOwn : Infinity,
    capOpp: stack && set(stack.opponentsMin, stack.opponentsMax) ? stack.opponentsMax ?? Infinity : oppOn && !settings.stackOppOrMore ? settings.stackOpp : Infinity,
  };
  return {
    clashOf: (id) => locks.some((l) => pairClash(side(id), l, rules)),
    stackOutOf: (id) => lockStackRefuses(side(id), locks, rule, settings.maxPerTeam ?? null),
  };
}

/** The first Min % of a lineup or more (minLimit) the position makes impossible, as a sentence, else null: the locks leave no
 *  place for him (minSlotsFull), or the Min needs more lineups than the position's maximum exposure (exposureLimit) allows.
 *  `ctx` = {posOf(id), locked (Set of the ids locked in this slate), posMax ({pos: text}), asked, keyOf(id) (his
 *  DraftKings key, default the id), outOf(id) (the pool drops him), clashOf(id) (a lock keeps him out under a pair
 *  rule), stackOutOf(id) (a locked QB's stack or the per-team limit does), all default false}; like the route, those
 *  rows and a locked player's twin row are skipped, the last two after the slot check and before the cap check. */
export function playerMinPositionProblem(minMap, ctx, nameOf = (id) => id) {
  const keyOf = ctx.keyOf ?? ((id) => `id:${id}`);
  const locksAt = Object.fromEntries(OPT_POSITIONS.map((p) => [p, [...ctx.locked].filter((id) => ctx.posOf(id) === p).length]));
  const lockedKeys = new Set([...ctx.locked].map(keyOf));
  for (const [id, text] of Object.entries(minMap ?? {})) {
    const min = parsePct(text);
    const pos = ctx.posOf(id);
    if (Number.isNaN(minLimit(min, ctx.asked))) return MIN_COUNT_PROBLEM;
    if (!(minLimit(min, ctx.asked) > 0) || !(pos in locksAt) || lockedKeys.has(keyOf(id)) || ctx.outOf?.(id)) continue;
    if (minSlotsFull(locksAt, pos)) return `${nameOf(id)} has a Min % but ${minSlotWords(pos)}`;
    if (ctx.clashOf?.(id) || ctx.stackOutOf?.(id)) continue;
    const cap = parsePct(ctx.posMax?.[pos]);
    if (cap !== null && !Number.isNaN(cap) && minLimit(min, ctx.asked) > exposureLimit(cap, ctx.asked)) {
      return `${nameOf(id)}'s Min % (${min}) is above the ${pos} maximum exposure (${cap})`;
    }
  }
  return null;
}

/** The locked player ids: every filled slot, then any pool Lock not already placed. Strings, no repeats. */
export function lockedIds(slots, locks) {
  const out = [];
  const seen = new Set();
  for (const s of slots ?? []) {
    if (s && s.id != null && !seen.has(String(s.id))) {
      seen.add(String(s.id));
      out.push(String(s.id));
    }
  }
  for (const id of locks ?? []) {
    if (!seen.has(String(id))) {
      seen.add(String(id));
      out.push(String(id));
    }
  }
  return out;
}

/** The lineup count the request sends for the count box's text (blank is 5, "200" is 150): the Min % checks size by it. */
export function requestCount(text) {
  return parseWhole(text, 1, OPT_MAX_COUNT, OPT_DEFAULT_COUNT);
}

/** The Min % problem Go shows for the count box's raw text: sized by requestCount, never by the text (PROJECT.md Part 4 Min % and soft rules, D74). */
export function minProblemFor(countText, minMap, maxMap, excluded, nameOf) {
  return playerMinProblem(minMap, maxMap, excluded, nameOf, requestCount(countText));
}

/** The `settings` object for POST /api/lineup/generate. maxExposure carries only {pct: N} for boxes that have a
 *  number (a blank box is left out, never sent as 0); every rule and both D73 stack numbers and ticks are sent
 *  explicitly; maxPerTeam only when a limit is picked. */
export function buildGenerateSettings(form) {
  const maxExposure = {};
  for (const pos of OPT_POSITIONS) {
    const pct = parsePct(form.maxExposure?.[pos]);
    if (pct !== null && !Number.isNaN(pct)) maxExposure[pos] = { pct };
  }
  const rules = {};
  for (const r of OPT_RULES) rules[r.key] = ruleOn(form.rules, r.key);
  const settings = {
    count: requestCount(form.count),
    minUnique: parseWhole(form.minUnique, 1, OPT_MAX_UNIQUE, OPT_DEFAULT_UNIQUE),
    locks: (form.locks ?? []).map(String),
    excludes: (form.excludes ?? []).map(String),
    maxExposure,
    rules,
    avoidGames: [...(form.avoid ?? [])],
    objective: OBJECTIVES.some((o) => o.value === form.objective) ? form.objective : "proj",
    stackOwn: parseWhole(form.stackOwn, 0, OPT_STACK_OWN_MAX, OPT_DEFAULT_STACK.stackOwn),
    stackOwnOrMore: form.stackOwnOrMore === undefined ? OPT_DEFAULT_STACK.stackOwnOrMore : Boolean(form.stackOwnOrMore),
    stackOpp: parseWhole(form.stackOpp, 0, OPT_STACK_OPP_MAX, OPT_DEFAULT_STACK.stackOpp),
    stackOppOrMore: form.stackOppOrMore === undefined ? OPT_DEFAULT_STACK.stackOppOrMore : Boolean(form.stackOppOrMore),
  };
  if (MAX_TEAM_OPTIONS.includes(String(form.maxPerTeam ?? "")) && String(form.maxPerTeam ?? "") !== "") {
    settings.maxPerTeam = Number(form.maxPerTeam);
  }
  // Per-player Max % (Adam 2026-10-11): only boxes holding a percent, as {id: {pct}}; sent only when there is one.
  const playerMaxExposure = {};
  for (const [id, text] of Object.entries(form.playerMax ?? {})) {
    const pct = parsePct(text);
    if (pct !== null && !Number.isNaN(pct)) playerMaxExposure[String(id)] = { pct };
  }
  if (Object.keys(playerMaxExposure).length) settings.playerMaxExposure = playerMaxExposure;
  const playerMinExposure = {};
  for (const [id, text] of Object.entries(form.playerMin ?? {})) {
    const pct = parsePct(text);
    if (pct > 0) playerMinExposure[String(id)] = { pct }; // a Min of 0 is blank; null and NaN fail the test
  }
  if (Object.keys(playerMinExposure).length) settings.playerMinExposure = playerMinExposure;
  if (form.qbStacks && Object.keys(form.qbStacks).length) settings.qbStacks = form.qbStacks;
  if (form.spreadDst === true) settings.spreadDst = true;
  // GPP variance per position (Adam 2026-11-11): only the boxes holding a percent above 0, sent only when there is one.
  const variancePos = variancePosSettings(form.variancePos, CLASSIC_VARIANCE_POSITIONS);
  if (variancePos) settings.variancePos = variancePos;
  return settings;
}

/** {id: {pct}} from the settings as {id: pct}; {} for none (the exposure table's Min / Max marks). */
function pctsOf(map) {
  return Object.fromEntries(Object.entries(map ?? {}).map(([id, v]) => [id, v.pct]));
}

/** The whole request body: the active slate key (D57: "main" or the second slate's key) plus the settings. */
export function buildGeneratePayload(form, slateKey) {
  return { slate: slateKey || "main", settings: buildGenerateSettings(form) };
}

/** [{slot, playerId}] for POST /api/lineups. The server returns the nine players already in DraftKings slot order,
 *  so a full lineup maps by position in the list; a short or odd one is placed by position name, spare RB/WR/TE
 *  into FLEX. */
export function slotsForSave(players) {
  const list = players ?? [];
  if (list.length === LINEUP_SLOTS.length) return list.map((p, i) => ({ slot: LINEUP_SLOTS[i], playerId: String(p.id) }));
  const out = [];
  const used = new Array(LINEUP_SLOTS.length).fill(false);
  const place = (p, name) => {
    const i = LINEUP_SLOTS.findIndex((s, k) => s === name && !used[k]);
    if (i === -1) return false;
    used[i] = true;
    out.push({ slot: name, playerId: String(p.id) });
    return true;
  };
  for (const p of list) if (!place(p, p.pos) && FLEX_POS.has(p.pos)) place(p, "FLEX");
  return out;
}

// ---- Actions ----

let optSeq = 0;

/** Cash 3b fix round 2, 2026-10-17: true only when a new batch was put in place; false on every other exit (cashMakeMust reads it). */
async function doGenerate() {
  if (opt.generating || opt.saving) return false;
  flushOpenLimit(); // a Min % or Max % box still open is read as a click away reads it, before the request is made (A3)
  const refused = limitRefusals(); // a text a box refused (this press's blur included) is not silently built around: the Build stops and names him (item 7)
  if (refused.length) {
    opt.formError = refused[0].sentence;
    commit();
    buildNotice.finish({ error: opt.formError, tone: "warn" });
    return false;
  }
  const padlockedIds = [...state.locks]; // C6: the men padlocked, apart from those only clicked in
  const board = store.get().board;
  const slate = activeSlate(board);
  const slateKey = slate ? slate.key : "main";
  const nameById = new Map((board?.rows ?? []).map((r) => [String(r.id), r.name]));
  // The per-player Max % boxes of this slate, for players still in its pool (D57).
  const slateRowIds = new Set(activeSlateRows(board).map((r) => String(r.id)));
  const playerMax = Object.fromEntries(Object.entries(playerMaxFor(slateKey)).filter(([id]) => slateRowIds.has(id)));
  const pickSlate = (map) => Object.fromEntries(Object.entries(map).filter(([id]) => slateRowIds.has(id)));
  const playerMin = pickSlate(playerMinFor(slateKey));
  const nameOf = (id) => nameById.get(id) ?? id;
  const rowOf = new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
  const cash = opt.mode === "cash"; // Cash mode job 3b, 2026-10-17: a cash build sends buildCashSettings and none of the GPP-only boxes
  const basis = cashBasisInfo(board);
  const countText = cash ? opt.cash.count : opt.count;
  const heldAll = lockedIds(state.slots, state.locks).length >= LINEUP_SLOTS.length; // every seat held: nothing to build around (item 11)
  opt.formError = countBelowMin(countText) ? COUNT_MIN_SENTENCE : heldAll ? fullLineupText(LINEUP_SLOTS.length) : cash ? (basis.blocked ? basis.text : null) : exposureProblem(opt.maxExp) ?? variancePosProblem(opt.variancePos, CLASSIC_VARIANCE_POSITIONS) ?? playerMaxProblem(playerMax, nameOf) ?? minProblemFor(opt.count, playerMin, playerMax, state.excludes, nameOf);
  if (opt.formError) {
    commit();
    buildNotice.finish({ error: opt.formError, tone: "warn" }); // a refusal says so where he pressed, even from far down (Make them Must, Undo and a blank count box reach here too)
    return false;
  }
  // The week and the slate on screen when Go was pressed: a response that arrives after either changed belongs to
  // something no longer shown and is dropped.
  const madeForWeek = seasonWeekKey(board);
  const madeForSlate = store.get().activeSlateKey ?? null;
  let locks = lockedIds(state.slots, state.locks);
  const slateNotes = [];
  let avoid = cash ? [...opt.cash.avoid] : [...opt.avoid];
  if (slate) {
    // D57: the server builds from the second slate's games only and refuses a lock outside them, so those locks are
    // left out of this request and said so, as the single Build does.
    const inSlate = new Set(activeSlateRows(board).map((r) => String(r.id)));
    const kept = locks.filter((id) => inSlate.has(id));
    const leftOut = locks.length - kept.length;
    locks = kept;
    if (leftOut > 0) {
      slateNotes.push(`${leftOut} locked player${leftOut === 1 ? " is" : "s are"} not in the ${slateDisplayName(slate)}'s games and ${leftOut === 1 ? "was" : "were"} left out of these lineups.`);
    }
  }
  const gameIds = new Set(activeSlateGames(board).map((g) => String(g.id)));
  avoid = avoid.filter((g) => gameIds.has(g));
  let form; // the GPP request's form; in cash only its objective is read (none: the head uses builtInTextCash)
  let sent;
  if (cash) {
    form = { objective: null };
    sent = { slate: slateKey, settings: buildCashSettings(opt.cash, { locks, excludes: [...state.excludes], avoidGames: avoid }) };
  } else {
    form = {
      count: opt.count,
      minUnique: opt.minUnique,
      maxExposure: opt.maxExp,
      rules: opt.rules,
      avoid,
      locks,
      excludes: [...state.excludes],
      objective: effectiveObjective(opt.objective),
      maxPerTeam: opt.maxPerTeam,
      stackOwn: opt.stackOwn,
      stackOwnOrMore: opt.stackOwnOrMore,
      stackOpp: opt.stackOpp,
      stackOppOrMore: opt.stackOppOrMore,
      playerMax,
      playerMin,
      qbStacks: qbStacksForRequest(board, slateNotes),
      spreadDst: opt.spreadDst,
      variancePos: opt.variancePos,
    };
    sent = buildGeneratePayload(form, slateKey);
    // The pre-Go Min % checks read the request as built: only the locks that stay in this slate count (the route sees those alone).
    const rowAt = (id) => rowOf.get(String(id));
    const pool = {
      excludes: new Set(form.excludes.map(String)),
      avoid: new Set(avoid.map((g) => String(g).toUpperCase())),
      starredQbOnly: sent.settings.rules.starredQbOnly === true, // buildGenerateSettings always sends every rule explicitly
    };
    opt.formError = playerMinPositionProblem(playerMin, {
      posOf: (id) => String(rowAt(id)?.pos ?? "").toUpperCase(),
      locked: new Set(locks),
      posMax: opt.maxExp,
      asked: sent.settings.count,
      keyOf: (id) => dkKeyOfRow(rowAt(id), id),
      outOf: (id) => !rowAt(id) || minRowOut(rowAt(id), id, pool),
      ...minLockSkips(rowAt, sent.settings),
    }, nameOf);
    if (opt.formError) {
      commit();
      buildNotice.finish({ error: opt.formError, tone: "warn" });
      return false;
    }
  }
  let built = false;
  const tab = opt.tabs[opt.mode]; // Part F: a build that ends after a tab switch writes to the tab it was made on
  opt.generating = true;
  opt.stopping = false;
  opt.stopError = "";
  opt.canStop = canStopLineupGenerate();
  tab.error = null;
  tab.saveError = null;
  tab.doneNote = false;
  buildNotice.reset(); // the last build's notice goes when the next one starts
  tab.resultsTab = "new"; // D74: a Go shows the New lineups tab
  commit();
  const cancelShow = afterBuildingDelay(() => {
    if (!opt.generating) return;
    opt.buildingBelow = goSitsBelow(lastContainer?.querySelector("#opt-go-btn"), lastContainer?.querySelector(".opt-summary"));
    opt.buildingShown = true;
    commit();
  });
  try {
    const data = await buildAfterQuiet(() => postLineupGenerate(sent)); // the quiet Left out build ends first (its next ask waits for this Build)
    if (seasonWeekKey(store.get().board) !== madeForWeek || (store.get().activeSlateKey ?? null) !== madeForSlate) {
      opt.generating = false;
      commit();
      return false;
    }
    if (!data || data.ok === false) {
      const busy = data?.error?.code === "GENERATE_BUSY";
      tab.error = busy ? data.error.message || OPT_BUSY_TEXT : data?.error?.message ?? "Could not make lineups.";
      tab.errorTone = answerTone(data?.error?.code); // a refusal (bad settings, a build already running) is amber; a build that failed outright is red
    } else {
      const lineups = (Array.isArray(data.lineups) ? data.lineups : []).map((l) => ({ ...l, uid: `n${++optSeq}` }));
      const notes = [...slateNotes, ...(Array.isArray(data.notes) ? data.notes : [])];
      if (!lineups.length && !notes.length) notes.push("No lineups could be made from these locks and settings.");
      // Each set is labelled with the mode and objective it was built in, so a set made before a mode flip says so
      // (package C review item 9: labelled, not cleared, so a flip never throws away lineups).
      // Only where the mode switch exists (board.mode): a board with no mode reads exactly as before, no label.
      const builtIn = board?.mode ? builtInText(board.mode.active) : "";
      // The response's own exposure (saved plus new) is not shown: each tab computes its own (D74).
      const bends = Array.isArray(data.bends) ? data.bends : [];
      const marks = { asked: sent.settings.count, min: pctsOf(sent.settings.playerMinExposure), max: pctsOf(sent.settings.playerMaxExposure) };
      // ChatGPT wish g, Adam 2026-10-17: what a save from this batch records on each lineup (lineup-builds.js batchBuild). A cash
      // batch records the board's Cash basis (board.mode.cashMode, the one the server built by; code review of a9455a0, MUST 1), so
      // its saved records name the basis used; GPP keeps the header's mode.
      const build = { buildId: newBuildId(Date.now(), Math.random()), boardMode: cash ? board.mode.cashMode : boardModeOf(board), objective: form.objective };
      tab.results = { slateKey, lineups, notes, builtIn, bends, made: lineups.length, marks, builtAt: new Date().toISOString(), lockedIds: sent.settings.locks ?? [], padlockedIds, ...build };
      // Cash mode job 3b: the batch keeps the mode and basis the answer names, and the limits its cards' swap search must respect.
      if (cash) {
        tab.results.mode = "cash";
        tab.results.basis = data.basis ?? null;
        tab.results.cash = { lockedIds: sent.settings.locks, excludedIds: sent.settings.excludes, maxPerTeam: sent.settings.maxPerTeam, avoidGames: sent.settings.avoidGames };
      }
      built = true;
    }
  } catch (e) {
    tab.error = `Could not reach the server: ${e.message}`;
    tab.errorTone = "error";
  } finally {
    cancelShow();
    opt.buildingShown = false;
  }
  opt.generating = false;
  opt.stopping = false;
  opt.stopError = "";
  // A15: the page does not move by itself (the results are far below the pool). The Build button's own row says `Build finished.` with a link; with the button off screen the notice under the
  // filter bar says it (or the failure) where he is looking (build-notice.js).
  tab.doneNote = built;
  commit();
  buildNotice.finish({ built, error: tab.error ?? "", tone: tab.errorTone === "warn" ? "warn" : "error" });
  return built;
}

const filterBarBottom = () => (typeof document === "undefined" ? 0 : document.getElementById?.("filterbar")?.getBoundingClientRect?.().bottom ?? 0);

/** The classic Optimizer's notice under the filter bar (build-notice.js): its Build button, its results and the Stop it shares with the Build row. */
const buildNotice = createNoticeController({
  noticeEl: () => (typeof document === "undefined" ? null : document.getElementById?.("build-notice") ?? null),
  barBottom: filterBarBottom,
  buildButton: () => lastContainer?.querySelector("#opt-go-btn"),
  resultsEl: () => lastContainer?.querySelector("#lineups"),
  building: () => (opt.generating && opt.buildingShown ? { canStop: opt.canStop, stopping: opt.stopping, stopError: opt.stopError } : null),
  jumpResults: () => jumpToResults(),
  jumpBuild: () => jumpToBuildRow(),
  stop: () => doStop(),
});


/** After every draw of the panel: the notice follows the state and where the Build row is (called by lineup.js renderLineupPanel); and what the last build left goes when the slate changes (resetOptimizerResults). */
export const refreshBuildNotice = () => buildNotice.refresh();
export const resetBuildNotice = () => buildNotice.reset();

/** Takes him to the Build row below the sticky bars (the failure notice's link, D16). */
export function jumpToBuildRow() {
  try {
    if (store.get().activeTab === "lineups") store.set({ activeTab: "lineup" }); // the Build row is on the Optimizer tab

    lastContainer?.querySelector(".act")?.scrollIntoView({ block: "center", behavior: "smooth" });
  } catch (e) {
    console.warn("Show Build row: the row could not be scrolled into view", e); // a convenience only; the row is on the page either way
  }
}

/** Stop (D15, D18): the Build row's button and the notice's do the same thing. */
async function doStop() {
  if (opt.stopping) return;
  opt.stopping = true; // the button reads "Stopping..." until the build's own answer ends it (D15)
  opt.stopError = "";
  commit();
  let failure = "";
  try {
    failure = stopFailure({ data: await stopLineupGenerate() });
  } catch (e) {
    console.error("lineup generate: the Stop was not heard", e); // the build runs on to its answer
    failure = stopFailure({ thrown: true });
  }
  if (failure && opt.generating) {
    opt.stopping = false; // Stop is pressable again; the line under it says why (D18)
    opt.stopError = failure;
    commit();
  }
}

/** Opens the Lineups tab, where the results are (the notice's link, and the link beside the Build button). */
export function jumpToResults() {
  store.set({ activeTab: "lineups" });
}

/** The tab (gpp, cash) whose batch holds card `uid`: the Lineups screen shows both tabs' builds. */
export function tabOfUid(uid) {
  for (const key of Object.keys(opt.tabs)) if (opt.tabs[key].results?.lineups.some((l) => l.uid === uid)) return key;
  return opt.mode;
}

/** Removes the shown lineups of a build from the Lineups screen, `uids` exactly (saved lineups stay); nothing left of it, the build goes. */
export function removeBuild(tabKey, uids) {
  const tab = opt.tabs[tabKey];
  if (!tab?.results) return;
  const gone = new Set(uids);
  tab.results.lineups = tab.results.lineups.filter((l) => !gone.has(l.uid));
  if (!tab.results.lineups.length) tab.results = null;
  tab.doneNote = false;
  commit();
}

/** Saves the given new lineups through the existing save-lineup route (D57: with the active slate key), for `saveGenerated` and the Lineups screen's Save all unsaved. */
export const saveGeneratedUids = (uids) => saveGenerated(uids);

/** Saves the given new lineups one after another through the existing save-lineup route (D57: with the active slate
 *  key). A saved card stays where it is and shows a disabled "Saved ✓" (Adam 2026-10-11), and it lands in the Saved
 *  tab; a card already saved, or matching a saved lineup, is skipped; the first failure stops the run and stays. */
async function saveGenerated(uids) {
  if (opt.saving || opt.generating || !uids.length) return;
  const tabKey = tabOfUid(uids[0]);
  const tab = opt.tabs[tabKey];
  const results = tab?.results;
  if (!results) return;
  opt.saving = true;
  tab.saveError = null;
  state.justSaved = new Set(); // Saved marks what this run saves (walkthrough friction, PROJECT.md Part 4 item 5)
  commit();
  const slateKey = results.slateKey ?? "main"; // the slate these lineups were made for, not the one on screen now
  const rowById = new Map((store.get().board?.rows ?? []).map((r) => [String(r.id), r]));
  const mode = results.mode === "cash" ? "cash" : "gpp"; // Cash mode job 3b, 2026-10-17: a card saves in the mode it was built in
  const stem = mode === "cash" ? "Cash" : "Lineup";
  const cardNameOf = (lineup) => `${stem} ${results.lineups.indexOf(lineup) + 1}`;
  const skipped = [];
  const failed = [];
  let savedCount = 0;
  const answeredSaved = []; // cards the server answered "already saved": the list is read again after the run
  let stopped = null; // the reason the run stopped: every card after it is listed as not saved with it (G62)
  for (const uid of uids) {
    const lineup = results.lineups.find((l) => l.uid === uid);
    if (!lineup) { failed.push({ name: "a lineup", reason: "it is no longer on the list" }); continue; }
    // Already saved is checked before a stop, so a saved card is never listed as "Not saved": never sent again, never refused (Adam 6:30 PM 11-09)
    if (cardIsSaved(lineup, savedSetKeys(savedOfActiveSlate(mode), rowById), rowById)) { skipped.push(cardNameOf(lineup)); continue; }
    if (stopped) { failed.push({ name: cardNameOf(lineup), reason: stopped }); continue; }
    try {
      // The card's own name ("Lineup 2", "Cash 2") is kept as the saved name unless this slate already has it (Entries
      // picks lineups by name, so names stay unique per slate, across both modes).
      const taken = savedOfActiveSlate(null).map((l) => l.name);
      const cardName = cardNameOf(lineup);
      const name = uniqueSavedName(cardName, taken, stem);
      const data = await postLineup({ name, slots: slotsForSave(lineup.players), slate: slateKey, ...(mode === "cash" ? { mode } : {}), build: batchBuild(results) }); // Cash 3b fix round, 2026-10-17: GPP sends no mode
      if (isAlreadySavedAnswer(data)) { // saved elsewhere since this list was read: the list is read again after the run
        answeredSaved.push(lineup);
        skipped.push(cardName);
        continue;
      }
      if (!data || data.ok === false) {
        stopped = data?.error?.message ?? "Could not save the lineup.";
        failed.push({ name: cardName, reason: stopped });
        continue;
      }
      // The saved list decides "Saved ✓" (so a later Delete shows Save again); the card's own flag is only for a
      // save answer that carried no list to match against.
      if (Array.isArray(data.lineups)) state.savedLineups = data.lineups;
      else lineup.saved = true;
      if (data.lineup?.id) state.justSaved.add(data.lineup.id);
      savedCount++;
    } catch (e) {
      stopped = `Could not reach the server: ${e.message}`;
      failed.push({ name: cardNameOf(lineup), reason: stopped });
    }
  }
  if (answeredSaved.length) {
    // Saved ✓ follows the saved list (so a later Delete shows Save again); the card's own flag only when the list, read again or not
    // (a failed read keeps the old one), still cannot show its twin. As Showdown's knownSaved (showdown/lineups-screen.js).
    await rereadSavedLineups();
    const keys = savedSetKeys(savedOfActiveSlate(mode), rowById);
    for (const lineup of answeredSaved) if (!cardIsSaved(lineup, keys, rowById)) lineup.saved = true;
  }
  const said = saveOutcome({ asked: uids.length, saved: savedCount, skipped, failed });
  tab.saveError = said.text || null;
  tab.saveTone = said.tone;
  opt.saving = false;
  commit();
}

/** The saved list read again after a save found a lineup already saved that this page's list did not hold (saved from another tab or device): the Saved tab then shows it. A failed read keeps the list and says so in the console only; the card already reads Saved ✓. */
export async function rereadSavedLineups() {
  try {
    const fresh = await getLineups();
    if (fresh && fresh.ok !== false && Array.isArray(fresh.lineups)) state.savedLineups = fresh.lineups;
    else console.warn("Saved lineups: the list could not be read again after an already-saved answer", fresh?.error?.message ?? "");
  } catch (e) {
    console.warn("Saved lineups: the list could not be read again after an already-saved answer", e);
  }
}

function discardGenerated(uid) {
  const tab = opt.tabs[tabOfUid(uid)];
  if (!tab?.results) return;
  tab.results.lineups = tab.results.lineups.filter((l) => l.uid !== uid);
  commit();
}

/** A10: a header of the exposure panel sorts it (the same column flips, another starts in its own direction) and a `Pos` chip filters it. The sort and the filter are kept in the browser; the whole panel redraws (commit), so the numbers stay with the cards. */
function wireExposureSort(container) {
  container.querySelectorAll("[data-action='opt-exp-sort']").forEach((th) => {
    th.addEventListener("click", () => {
      opt.exp = nextExpSort(opt.exp, th.dataset.col, "classic");
      savePersisted();
      commit();
    });
  });
  container.querySelectorAll("[data-action='opt-exp-filter']").forEach((btn) => {
    btn.addEventListener("click", () => {
      opt.exp = { ...opt.exp, filter: btn.dataset.filter };
      savePersisted();
      commit();
    });
  });
}

export function currentRowById() {
  return new Map((store.get().board?.rows ?? []).map((r) => [String(r.id), r]));
}

/** Adam 2026-10-11: a player's name in the exposure tables adds him to the "only lineups with" list or takes him out
 *  (everywhere else the name opens his card, 2026-10-18); a chip's × takes him out; Clear empties it. Page-only. */
function wirePickButtons(container) {
  container.querySelectorAll("[data-action='opt-pick']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = identityOf(btn.dataset.pickId, currentRowById());
      if (!opt.mustHave.includes(key)) opt.mustHaveNames[key] = btn.dataset.pickName ?? key;
      opt.mustHave = toggleMustHave(opt.mustHave, key);
      commit();
    });
  });
  container.querySelectorAll("[data-action='opt-pick-remove']").forEach((btn) => {
    btn.addEventListener("click", () => {
      opt.mustHave = toggleMustHave(opt.mustHave, btn.dataset.pickKey);
      commit();
    });
  });
  container.querySelector("[data-action='opt-pick-clear']")?.addEventListener("click", () => {
    clearMustHave();
    commit();
  });
}

export function wireOptimizer(container) {
  // ChatGPT wish i: the footer summary follows the boxes that do not re-render the panel as they are typed in.
  const refreshSummary = () => {
    const el = container.querySelector(".opt-summary");
    if (el) el.title = optSummaryText(store.get().board); // item 7: the hover only, no visible text
  };
  // Item 18: `Minimum 1` beside a count box while it is below 1, and the refusal a Build made of it goes once the box is fixed.
  const countTyped = (el) => {
    syncCountNote(el, OPT_MAX_COUNT);
    if (opt.formError === COUNT_MIN_SENTENCE && !countBelowMin(el.value)) {
      opt.formError = null;
      container.querySelector(".opt-form-error")?.remove();
      container.querySelector(".opt-form-error-footer")?.remove();
    }
  };
  const bind = (sel, key) => {
    const el = container.querySelector(sel);
    el?.addEventListener("input", () => {
      opt[key] = el.value;
      if (sel === "#opt-count") countTyped(el);
      savePersisted(); // A9: the settings are remembered as typed
      refreshSummary();
    });
  };
  bind("#opt-count", "count");
  bind("#opt-min-unique", "minUnique");
  // Cash mode job 3b, 2026-10-17: the mode switch, cash's own boxes (kept on every keystroke, as the Min % boxes are) and the swap buttons.
  container.querySelectorAll("[data-opt-mode]").forEach((btn) => {
    btn.addEventListener("click", () => { if (!opt.saving && !state.saving) requestTab(btn.dataset.optMode, () => setMode(btn.dataset.optMode)); }); // Part F: through app.js's gate, so the tab's own board comes on screen with it; not while a Save (a card's or the working lineup's) is out, whose answer belongs to the tab it started on
  });
  for (const [sel, key, event] of [["#opt-cash-count", "count", "input"],["#opt-cash-max-team", "maxPerTeam", "change"]]) {
    const el = container.querySelector(sel);
    el?.addEventListener(event, () => {
      opt.cash[key] = el.value;
      if (sel === "#opt-cash-count") countTyped(el);
      savePersisted();
      refreshSummary();
    });
  }
  container.querySelectorAll("[data-cash-swap]").forEach((btn) => {
    btn.addEventListener("click", () => cashMakeMust(btn.closest("[data-uid]")?.dataset.uid, Number(btn.dataset.cashSwap)));
  });
  container.querySelector("[data-cash-undo]")?.addEventListener("click", () => cashUndo());
  container.querySelectorAll("[data-opt-exp]").forEach((el) => {
    el.addEventListener("input", () => {
      opt.maxExp[el.dataset.optExp] = el.value;
      savePersisted(); // A9
      refreshSummary();
      if (opt.formError) {
        opt.formError = null;
        container.querySelector(".opt-form-error")?.remove();
        container.querySelector(".opt-form-error-footer")?.remove(); // the footer copy goes with the head copy
      }
    });
  });
  // The Variance % boxes (GPP only): kept as typed, no re-render; a box that is not a percent is marked. A refusal the boxes made follows
  // them: it names the box still wrong, or goes once every box reads.
  container.querySelectorAll("[data-opt-var]").forEach((el) => {
    el.addEventListener("input", () => {
      const before = variancePosProblem(opt.variancePos, CLASSIC_VARIANCE_POSITIONS);
      opt.variancePos = { ...opt.variancePos, [el.dataset.optVar]: el.value };
      savePersisted(); // A9
      refreshSummary();
      el.classList.toggle("invalid", Number.isNaN(parsePct(el.value)));
      if (before && opt.formError === before) {
        const now = variancePosProblem(opt.variancePos, CLASSIC_VARIANCE_POSITIONS);
        opt.formError = now;
        for (const shown of container.querySelectorAll(".opt-form-error")) {
          if (now) shown.textContent = now;
          else shown.remove(); // the footer copy (.opt-form-error-footer, the same element) goes with it
        }
      }
    });
  });
  // Max per team and the D73 stack: the value is kept in `opt`; nothing else on the panel depends on it,
  // so no re-render.
  const bindValue = (sel, key, read) => {
    const el = container.querySelector(sel);
    el?.addEventListener("change", () => {
      opt[key] = read(el);
      savePersisted(); // A9
      refreshSummary();
    });
  };
  bindValue("#opt-max-team", "maxPerTeam", (el) => el.value);
  bindValue("#opt-stack-own", "stackOwn", (el) => Number(el.value));
  bindValue("#opt-stack-opp", "stackOpp", (el) => Number(el.value));
  bindValue("#opt-stack-own-more", "stackOwnOrMore", (el) => el.checked);
  bindValue("#opt-stack-opp-more", "stackOppOrMore", (el) => el.checked);
  for (const id of ["own", "opp", "own-more", "opp-more"]) {
    container.querySelector(`#opt-stack-${id}`)?.addEventListener("change", () => opt.qb.open.size && commit());
  }
  wireExposureSort(container);
  wirePickButtons(container);
  container.querySelector("#opt-go-btn")?.addEventListener("click", () => doGenerate());
  container.querySelector("#opt-stop-btn")?.addEventListener("click", () => doStop());
  container.querySelectorAll("[data-action='opt-rule']").forEach((btn) => {
    btn.addEventListener("click", () => {
      opt.rules[btn.dataset.key] = !ruleOn(opt.rules, btn.dataset.key);
      commit();
    });
  });
  container.querySelector("[data-action='opt-spread-dst']")?.addEventListener("click", () => {
    opt.spreadDst = !opt.spreadDst;
    commit();
  });
  const settingsEl = container.querySelector("#opt-panel");
  if (settingsEl) {
    wireQbStacks(settingsEl, { qbs: opt.qb, globals: qbGlobals, ownMax: OPT_STACK_OWN_MAX, oppMax: OPT_STACK_OPP_MAX, commit, save: savePersisted });
    // 🔵 2026-10-17: wireQbStacks saves a QB's own stack boxes without a re-render; this listener (added after its own,
    // so it runs after the edit) keeps the footer's "custom stacks on N QBs" current.
    settingsEl.addEventListener("change", () => {
      refreshSummary();
      // Adam 2026-10-18 1:50 AM: a QB's own boxes change whether the Default stack rows still apply, with no re-render.
      const rowsEl = settingsEl.querySelector(".opt-stack-rows");
      if (!rowsEl) return;
      const live = stackDefaultsApply(store.get().board);
      rowsEl.classList.toggle("opt-row-inert", !live);
      for (const attr of ["title", "aria-label"]) {
        if (live) rowsEl.removeAttribute(attr);
        else rowsEl.setAttribute(attr, STACK_INERT_TITLE);
      }
    });
  }
  container.querySelectorAll("[data-action='opt-avoid']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const g = btn.dataset.game;
      if (opt.mode === "cash") opt.cash.avoid = opt.cash.avoid.includes(g) ? opt.cash.avoid.filter((x) => x !== g) : [...opt.cash.avoid, g]; // Cash mode job 3b: cash's own list
      else if (opt.avoid.has(g)) opt.avoid.delete(g);
      else opt.avoid.add(g);
      commit();
    });
  });
  container.querySelectorAll("[data-action='opt-save']").forEach((btn) => {
    btn.addEventListener("click", () => saveGenerated([btn.dataset.uid]));
  });
  container.querySelectorAll("[data-action='opt-discard']").forEach((btn) => {
    btn.addEventListener("click", () => discardGenerated(btn.dataset.uid));
  });
  // D74: the New / Saved tabs; the pick is remembered for this page load.
  container.querySelectorAll("[data-action='opt-tab']").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (opt.resultsTab === btn.dataset.tab) return;
      opt.resultsTab = btn.dataset.tab === "saved" ? "saved" : "new";
      commit();
    });
  });
  container.querySelectorAll("[data-action='opt-sort']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab === "saved" ? "saved" : "new";
      opt.sort = { ...opt.sort, [tab]: nextSort(opt.sort[tab], btn.dataset.key, LOOK_SORT_KEYS) };
      commit();
    });
  });
  // The panel's collapsed settings groups (Stack, Rules, caps and QB stacks, Cash's Max per team and Avoid games): open or close one and redraw.
  container.querySelectorAll("[data-setop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.setop;
      if (openSetops.has(key)) openSetops.delete(key);
      else openSetops.add(key);
      commit();
    });
  });
  container.querySelectorAll("[data-action='opt-open-lineups']").forEach((btn) => btn.addEventListener("click", () => { opt.doneNote = false; store.set({ activeTab: "lineups" }); }));
  // The pool's Min % and Max % boxes (A3, round 3 fixes; limit-box.js): kept per slate and saved to localStorage when the box closes (Enter or a click
  // away; Esc puts the old text back; an emptied box removes the limit). Typing alone changes nothing; a Build started while one is open reads it (doGenerate).
  for (const [field, attr, forSlate] of [["playerMax", "data-player-max", playerMaxFor], ["playerMin", "data-player-min", playerMinFor]]) {
    container.querySelectorAll(`[${attr}]`).forEach((el) => {
      const id = el.getAttribute?.(attr) ?? el.dataset[field];
      const crossedNow = () => limitsCrossed(playerMinFor(slateKeyOf(store.get().board))[id] ?? "", playerMaxFor(slateKeyOf(store.get().board))[id] ?? "", parsePct);
      let wasCrossed = crossedNow();
      wireLimitBox(el, {
        selector: `[${attr}="${id}"]`,
        // The sentence a refused text leaves (held, drawn beside his row, and stopping a Build): it names the man and the old limit that stays.
        refusalText: (typed) => `${currentRowById().get(String(id))?.name ?? "A player"}'s ${field === "playerMax" ? "Max %" : "Min %"} was not saved: "${String(typed).trim()}" is not a percent from 0 to 100, so his old limit stays. Fix the box or clear it.`,
        doc: typeof document === "undefined" ? null : document,
        parse: parsePct,
        save: (text) => {
          const key = slateKeyOf(store.get().board);
          wasCrossed = crossedNow();
          const map = { ...forSlate(key) };
          if (text === "") delete map[id];
          else map[id] = text;
          opt[field] = { ...opt[field], [key]: map };
          savePersisted();
        },
        afterSave: () => {
          if (crossedNow() !== wasCrossed) commit(); // item 18: the row's `Min is above Max` appears or goes (an open box is carried through the redraw)
          if (opt.formError) {
            opt.formError = null;
            container.querySelector(".opt-form-error")?.remove();
            container.querySelector(".opt-form-error-footer")?.remove(); // the footer copy goes with the head copy
          }
          refreshSummary(); // "caps on N players" follows the boxes
        },
      });
    });
  }
}
