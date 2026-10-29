// The Showdown lineup's uniqueness swaps (Adam 2026-10-18, PROJECT.md Part 4): once six men are placed, "show the tradeoffs
// for uniqueness....like replace this guy with another guy and X more unique.....comes with projection tradeoff".
//   POST /api/showdown/<key>/lineup/swaps   body {cpt, flex[5], excludes?, field?} (the meter's body); writes nothing
// For each of the six seats, every legal single swap is measured on the meter's own maths (the fitted field model, RULES.md
// D82: ./field-figures.js swapMeasurer on the same field table, Z and field's best the meter caches once per board) and
// the served board's figures (this game's ticked
// sources, as the meter and Build use them, Adam 2026-10-20): same seat, Captain swaps on Captain figures and price, FLEX swaps on FLEX; $50,000 cap,
// both teams, one man one seat. Each seat keeps only the swaps on its Pareto frontier (no other swap for the seat is at least
// as unique and at least as high projected, one of the two strictly), ordered by points change, highest first (Adam
// 2026-10-18: near-0% bench men at -27 points filled every top three); its first few are `swaps`, the rest of the frontier
// is `more` (the panel's "show all"). The single best projection-gaining swap is listed beside them. A man with no ownership in the seat's slot is not offered (no copies figure,
// never 0, D29); a man the app would not roster (a projection of 0 or less, D45) is not offered; both are listed by name.
// Game script is only a tag on a swap (storyOf below), never a filter, a hide or a weight: every position stays in every seat.
import { refuseNonJsonPost } from "../lib/origin.js";
import { showdownCandidates, rosterable, CPT_MULTIPLIER } from "../lineup/showdown.js";
import { SHOWDOWN_CAP } from "../lineup/showdown-multi.js";
import { boardTwoGun } from "./lineup-rows.js"; // what this game's ticks say about TwoGun (the board path's wording); pure, so the site runs this file (D71)
import { refusalSentence } from "../lineup/sd-field-dp.js";
import { swapMeasurer, NO_BEST_SENTENCE } from "./field-figures.js"; // the field model's figures for a lineup, as the meter reads them

export const SWAPS_PER_SEAT = 3;
// No copies floor any more: the old ranking divided uniqueness gained by points lost, so a man posted at 0% (zero copies, an
// infinite ratio) needed the meter's 0.01-copies display floor to keep him from outranking every real trade. The frontier
// compares true expected copies and true points only, and orders by points, so a zero-copies man is simply the most unique.

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round2 = (n) => Math.round(n * 100) / 100;

// ---- Game script (tag only) -------------------------------------------------------------------------------------------

/**
 * The Captain's likely story, from plain logic (Adam 2026-10-18): { rule, partners, broken } or null when no rule applies.
 * "QB as captain ... means he's getting a lot of YARDS and TDs.....who benefits from those? well they better be in that
 * lineup! at least 1": a QB Captain's story needs one of his own pass catchers (WR or TE of his team) among the five FLEX.
 * The same logic the other way: a WR or TE Captain's story needs his own QB. Any other Captain (RB, K, DST: never rare, never
 * down-weighted) has no rule. `others` are the five FLEX men; broken means no partner is among them.
 */
export function storyOf(captain, others) {
  const mates = others.filter((m) => m.team === captain.team);
  if (captain.pos === "QB") {
    const partners = mates.filter((m) => m.pos === "WR" || m.pos === "TE");
    return { rule: "qb", partners, broken: partners.length === 0 };
  }
  if (captain.pos === "WR" || captain.pos === "TE") {
    const partners = mates.filter((m) => m.pos === "QB");
    return { rule: "receiver", partners, broken: partners.length === 0 };
  }
  return null;
}

/** The tag text for a swap that turns an intact story into a broken one; null otherwise (a lineup already broken is not "broken by" a swap). */
export function tagFor(storyBefore, storyAfter, captainAfter) {
  if (!storyAfter || !storyAfter.broken || (storyBefore && storyBefore.broken)) return null;
  return storyAfter.rule === "qb"
    ? "breaks the Captain's story (QB Captain with none of his receivers)"
    : `breaks the Captain's story (${captainAfter.pos} Captain without his QB)`;
}

// ---- The search (pure) ------------------------------------------------------------------------------------------------

/**
 * One seat's frontier, in display order (Adam 2026-10-18). `swaps` are one seat's measured swaps, each { copiesAfter (expected
 * copies after the swap: lower is more unique), projChange (points gained, negative when lost), in: { name } }. A swap is
 * dropped when another swap of the seat is at least as unique AND at least as high projected, one of the two strictly; two
 * swaps with identical figures both stay (neither beats the other). What is left is ordered by points change, highest first
 * (a swap that gains both points and uniqueness leads), then the more unique, then the man's name (stable and testable).
 * Pure: the input is not changed; [] for no swaps.
 */
export function frontierOrder(swaps) {
  const beats = (b, a) => b.copiesAfter <= a.copiesAfter && b.projChange >= a.projChange && (b.copiesAfter < a.copiesAfter || b.projChange > a.projChange);
  return swaps
    .filter((a) => !swaps.some((b) => b !== a && beats(b, a)))
    .sort((a, b) => b.projChange - a.projChange || a.copiesAfter - b.copiesAfter || a.in.name.localeCompare(b.in.name));
}

// ownPct is null for a man with no ownership, never 0 (D29); notOnBoard is set only for a man TwoGun's board has no row for, whose 0% is Q8's, not a posted figure.
const manOut = (m) => ({
  id: m.id, name: m.name, pos: m.pos, team: m.team, status: m.status ?? null, salary: m.salary,
  proj: m.proj === null ? null : round2(m.proj), ownPct: isNum(m.own) ? round2(m.own * 100) : null,
  ...(m.notOnBoard ? { notOnBoard: true } : {})
});

/**
 * Every legal single swap of a complete lineup. A man is { id (person id), name, team, pos, salary, proj, own (fraction),
 * rosterable? } in the figures of the seat's view: `cpt` and `cptMen` carry Captain price, 1.5x projection and Captain
 * ownership, `flex` and `flexMen` the FLEX ones. `measure(men)` (six men, the Captain first) gives { copies, left (salary
 * left, dollars), gapPts (projection minus the field's best, negative when under) }: the meter's own figures for that
 * lineup (./field-figures.js swapMeasurer); cap is the meter's. Returns { before ({ copies, proj, salary, script, left,
 * gapPts }), seats (six, in order; each with its frontier: `swaps` the first `perSeat`, `more` the rest, `frontier` their
 * count, `moreUnique` the count of all swaps with fewer expected copies), bestProjection, skipped: {noCaptainOwnership,
 * noFlexOwnership, notRosterable} (names; a man can be in both ownership lists, his Captain and FLEX ownership being
 * separate), legal, ms }. Each swap row carries both sides' salary left and gap (leftBefore, leftAfter, gapPtsBefore,
 * gapPtsAfter) beside its copies.
 */
export function findSwaps({ cpt, flex, cptMen, flexMen, measure, cap = SHOWDOWN_CAP, perSeat = SWAPS_PER_SEAT }) {
  const started = performance.now();
  const six = [cpt, ...flex];
  const inLineup = new Set(six.map((m) => m.id));
  const salary = six.reduce((a, m) => a + m.salary, 0);
  const proj = six.reduce((a, m) => a + m.proj, 0);
  const before = measure(six);
  const copiesBefore = before.copies;
  const storyBefore = storyOf(cpt, flex);
  const skipped = { noCaptainOwnership: new Map(), noFlexOwnership: new Map(), notRosterable: new Map() };
  let legal = 0;
  const all = [];
  const seats = six.map((outMan, s) => {
    const measured = [];
    for (const man of s === 0 ? cptMen : flexMen) {
      if (inLineup.has(man.id) || !isNum(man.salary)) continue;
      if (man.rosterable === false || !(man.proj > 0)) { skipped.notRosterable.set(man.id, man.name); continue; }
      if (man.own === null || man.own === undefined) { (s === 0 ? skipped.noCaptainOwnership : skipped.noFlexOwnership).set(man.id, man.name); continue; }
      const salaryAfter = salary - outMan.salary + man.salary;
      if (salaryAfter > cap) continue;
      const men = six.map((m, i) => (i === s ? man : m));
      if (new Set(men.map((m) => m.team)).size < 2) continue;
      legal++;
      const after = measure(men);
      const copiesAfter = after.copies;
      const projChange = man.proj - outMan.proj;
      const swap = {
        seat: s === 0 ? "CPT" : "FLEX", slot: s === 0 ? null : s - 1,
        out: manOut(outMan), in: manOut(man),
        copiesBefore, copiesAfter,
        leftBefore: before.left, leftAfter: after.left, gapPtsBefore: before.gapPts, gapPtsAfter: after.gapPts,
        fold: copiesAfter === 0 || copiesBefore === 0 ? null : copiesBefore / copiesAfter, // before / after: above 1 is more unique
        zeroCopies: copiesAfter === 0,
        projChange: round2(projChange), projAfter: round2(proj + projChange),
        salaryChange: salaryAfter - salary, salaryAfter,
        tag: tagFor(storyBefore, storyOf(men[0], men.slice(1)), men[0])
      };
      measured.push(swap);
      all.push(swap);
    }
    const moreUnique = measured.filter((x) => x.copiesAfter < copiesBefore); // fewer expected copies than now
    const frontier = frontierOrder(moreUnique);
    return {
      seat: s === 0 ? "CPT" : "FLEX", slot: s === 0 ? null : s - 1, man: manOut(outMan), legal: measured.length,
      moreUnique: moreUnique.length, frontier: frontier.length, swaps: frontier.slice(0, perSeat), more: frontier.slice(perSeat)
    };
  });
  const bestProjection = all.filter((x) => x.projChange > 0).sort((a, b) => b.projChange - a.projChange || a.copiesAfter - b.copiesAfter || a.in.name.localeCompare(b.in.name))[0] ?? null;
  const script = storyBefore ? { rule: storyBefore.rule, broken: storyBefore.broken, partners: storyBefore.partners.map((m) => m.name) } : null;
  return {
    before: { copies: copiesBefore, proj: round2(proj), salary, script, left: before.left, gapPts: before.gapPts },
    seats, bestProjection,
    skipped: { noCaptainOwnership: [...skipped.noCaptainOwnership.values()], noFlexOwnership: [...skipped.noFlexOwnership.values()], notRosterable: [...skipped.notRosterable.values()] },
    legal, ms: round2(performance.now() - started)
  };
}

// ---- One board (the meter's halves, injected so this file never imports the meter's route file) ------------------------

const halfOf = (h) => ({ posted: h.posted, source: h.source, asOf: h.asOf, asOfFrom: h.asOfFrom, error: h.error });

/**
 * Both views of every man on the board: { cptMen, flexMen } in the figures of `rows` (the halves' lineupRows), ownership as a fraction or
 * null. `isNotOnBoard(row, slot)` is the ownership half's: a man counted at Q8's 0% in that seat's slot carries notOnBoard
 * (Captain and FLEX apart). `projOf(row)` is the projection half's FLEX figure (the Captain's at CPT_MULTIPLIER of it), so a
 * man reads here exactly as the meter reads him (on the board path a DraftKings-average stand-in counts at his average, as Build sums him).
 */
function menFromRows(rows, isNotOnBoard, projOf) {
  const out = { cptMen: [], flexMen: [] };
  for (const row of rows) {
    const p = projOf(row);
    for (const c of showdownCandidates(row)) {
      const isCpt = c.pos === "CPT";
      const man = {
        id: c.personId, cptId: String(row.cptId ?? ""), name: c.name, team: c.team, pos: c.realPos, status: c.status ?? null,
        salary: c.salary, proj: p === null ? null : isCpt ? p * CPT_MULTIPLIER : p, flexProj: p, // flexProj: the field model's input (it applies the multiplier)
        own: c.own === null ? null : c.own / 100, rosterable: rosterable(c),
        notOnBoard: Boolean(isNotOnBoard(row, isCpt ? "CPT" : "FLEX"))
      };
      (c.pos === "CPT" ? out.cptMen : out.flexMen).push(man);
    }
  }
  return out;
}

/**
 * The swaps for one checked lineup (validateMeterBody's result) on one board, in the served board's figures. `m` is the
 * meter's own functions { halvesOf, zFor } so the figures, the field table and its cache are the meter's; `curves` the
 * checked field curves (./field-curves.js). A source with nothing posted, a lineup man with no ownership or no projection,
 * or a board whose best lineup cannot be worked out, answers { available: false, message } and no swap (missing is
 * missing, D29). A figure TwoGun alone is ticked for is worded as TwoGun's (board-view.js boardTwoGun, Adam 2026-10-20),
 * every other as our sources'.
 */
export function measureSwaps(board, checked, m, { cap = SHOWDOWN_CAP, curves } = {}) {
  if (!curves) throw new Error("measureSwaps: the field curves were not given.");
  const { cpt, flex, excludes, field } = checked;
  const { rows, own, proj } = m.halvesOf(board);
  const head = { mode: "current", field, projection: halfOf(proj), ownership: halfOf(own) }; // the one path's name, as the meter answers (uniqueness-routes.js BOARD_PATH)
  const none = (message) => ({ ...head, available: false, message });
  const two = boardTwoGun(board);
  const ours = { own: !two.ownOnly, proj: !two.projOnly };
  if (!own.posted) return none(own.error ?? (ours.own ? "No ownership from our sources yet" : "TwoGun hasn't posted Showdown ownership for this game yet"));
  if (!proj.posted) return none(proj.error ?? (ours.proj ? "No projections from our sources yet" : "TwoGun hasn't posted Showdown projections for this game yet"));
  const { cptMen, flexMen } = menFromRows(rows, own.isNotOnBoard, proj.projOf);
  const seatMan = (men, id) => men.find((x) => x.id === String(id));
  const cptMan = seatMan(cptMen, cpt.id);
  const flexLineup = flex.map((r) => seatMan(flexMen, r.id));
  if (!cptMan || flexLineup.some((x) => !x)) return none("A placed man has no price in his seat on this board.");
  const lineup = [cptMan, ...flexLineup];
  const noOwn = lineup.filter((x) => x.own === null).map((x) => x.name);
  if (noOwn.length) return none(`No ${ours.own ? "ownership from our sources" : "TwoGun ownership"} for ${noOwn.join(", ")}, so swaps can't be measured for this lineup.`);
  const noProj = lineup.filter((x) => !isNum(x.proj)).map((x) => x.name);
  if (noProj.length) return none(`No ${ours.proj ? "projection from our sources" : "TwoGun projection"} for ${noProj.join(", ")}, so swaps can't be measured for this lineup.`);
  // Adam's excludes are never offered as a swap-in (a man already placed stays placed); the Captain id removes only his Captain seat.
  const skip = new Set(excludes);
  const offered = (men, isCpt) => men.filter((x) => !skip.has(x.id) && !(isCpt && skip.has(x.cptId)));
  const f = m.zFor(board, own, proj, curves, cap);
  if (f.best === null) return none(NO_BEST_SENTENCE);
  const measure = swapMeasurer({ table: f.table, z: f.z, best: f.best, curves, field });
  const result = findSwaps({ cpt: cptMan, flex: flexLineup, cptMen: offered(cptMen, true), flexMen: offered(flexMen, false), measure, cap });
  return { ...head, available: true, ...result, zMs: round2(f.ms), zCached: f.cached };
}

/**
 * The swaps route's answer for a request body on a served board, the one copy the route and the public site (RULES.md D71)
 * both run: { ok: true, result } (the 200 body before its envelope) or { ok: false, status, code, message, log? } (`log`:
 * { message, extra } for the caller's error log). `loadCurves()` gives { curves } or { error } (./field-curves.js
 * loadFieldCurves on the app, the baked file on the site); it is asked only once the body passes, as the route always has.
 * `m` is the meter's functions (validateMeterBody, halvesOf, zFor). Pure apart from what `loadCurves` does.
 */
export function swapsAnswer(board, body, { loadCurves }, m) {
  const checked = m.validateMeterBody(body, board.rows ?? []);
  if (checked.error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: checked.error };
  // RULES.md D82: no curves, no copies; the plain sentence names the file, never a fall-back to the straight product.
  const loaded = loadCurves();
  if (loaded.error) return { ok: false, status: 500, code: "LINEUP_SWAPS_FAILED", message: loaded.error, log: { message: "showdown swaps: the field curves could not be loaded", extra: { error: loaded.error } } };
  try {
    return { ok: true, result: measureSwaps(board, checked, m, { curves: loaded.curves }) };
  } catch (e) {
    const why = refusalSentence(e); // a field-model refusal's plain sentence; a bug keeps the generic text
    return {
      ok: false, status: 500, code: "LINEUP_SWAPS_FAILED", message: why ? `Could not work out the swaps for this lineup: ${why}` : "Could not work out the swaps for this lineup.",
      log: { message: "showdown swaps: failed", extra: { error: e.message, stack: e.stack } }
    };
  }
}

/** POST .../lineup/swaps. `h` is routes.js's helpers, `m` the meter's functions (see measureSwaps) plus validateMeterBody and loadFieldCurves. */
export async function handleSwaps(req, res, deps, key, slate, h, m) {
  const { sendJson, errorBody } = deps;
  const refused = refuseNonJsonPost(req.headers, "Send the lineup as application/json."); // origin and content type, as the meter does
  if (refused) return sendJson(res, refused.status, errorBody(refused.code, refused.message));
  const parsed = await deps.readJsonBodyOrRespond(req, res);
  if (!parsed.ok) return;
  let board;
  try {
    board = await h.getBoardCached(deps, key, slate);
  } catch (e) {
    return h.sendBoardError(deps, res, e, "swaps", "Could not build the showdown board.");
  }
  const a = swapsAnswer(board, parsed.body, { loadCurves: () => m.loadFieldCurves(deps.DATA_DIR) }, m);
  if (a.log) deps.logError(a.log.message, { key, ...a.log.extra });
  if (!a.ok) return sendJson(res, a.status, errorBody(a.code, a.message));
  sendJson(res, 200, deps.envelope(a.result, { stale: board.stale ?? [] }));
}
