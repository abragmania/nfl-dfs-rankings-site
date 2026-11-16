// Is this GPP lineup unique enough? (Adam 2026-11-04.) Plain arithmetic on the nine men's Own, set against what the slate's own Own figures say the field holds.
// No field model. Three readings:
//   STACK: the QB, his same-team WR and TE, and the opponent's men except its DST (a runback); the same-team RB is not in it. Figure = geometric mean of
//          their Own (a figure under 0.1 counts as 0.1) divided by qbAvg = sum over the slate's QBs of own * own / 100. No catcher and no runback: `Stack: none`.
//   REST:  the other men (all nine when there is no stack): mean Own divided by the slate's average man = (sum over all men of own * own / 100) / 9.
//   TOTAL: the nine men's Own total against that field total (the same sum); on the hover only.
// Own is the board's projected Own before lock; once the week has an accepted actual-ownership file (board.actualOwnership, rows' actualOwn, server/rank/actual-own.js)
// on the main slate, the read uses actualOwn on all nine men and the field figures from actualOwn (standard D20); the Own column itself never changes. A man with no
// figure on the basis in use, in any of the nine, is `Own not in yet`: no verdict, no marker, never a floor or a mix of the two bases; fewer than nine men or a man
// off the slate is a dash with the reason.
// A reading's position is the log of its multiple against its field midpoint, clamped at the ends, -1 (unique end) .. +1 (chalky end); the main position is the mean of
// the Stack and Rest positions weighted by the men in each (Stack n, Rest 9 - n; Rest alone with no stack). The face (contrarianHtml) is quiet: the verdict word and a thin
// bar with two small ones; every figure is on the hovers. Pure apart from readBasisFor's board lookup; the app and the public site share it.
import { escapeHtml, dec1 } from "./format.js";
import { activeSlate, activeSlateRows } from "./state.js";

export const LINEUP_MEN = 9;
export const OWN_FLOOR = 0.1;

// Words on the hovers. Stack bands, as multiples of qbAvg: under LOW `Low`, LOW up to HIGH `Middle`, HIGH and up `Chalky`. Source: stack research over weeks 6 to 8
// of 2026 (scratchpad stack-research/results.md section 3: 1.0x and 2.0x split the stacked field about a third, a half and a sixth to a third).
export const STACK_CUTS = Object.freeze({ low: 1.0, high: 2.0 });
// REST and TOTAL bands, as multiples of the slate's average man / field total: under LOW `Contrarian`, LOW up to HIGH `Middle`, HIGH and up `Chalky`. Source: the mean
// over the three contests of the copies-weighted p25 and p75 of each multiple, pre-game Own, entries with Own on all nine men, in data/classic-field/2026-w06-196653900.json,
// 2026-w07-196905290.json and 2026-w08-197176675.json (scratchpad stack-research/cuts.js, 2026-11-04): REST p25 0.759 / 0.815 / 0.885 and p75 1.214 / 1.251 / 1.282;
// TOTAL p25 0.759 / 0.838 / 0.889 and p75 1.125 / 1.185 / 1.200.
export const REST_CUTS = Object.freeze({ low: 0.819, high: 1.249 });
export const TOTAL_CUTS = Object.freeze({ low: 0.829, high: 1.170 });

// The scales: `mid` is the field's p50 of the reading's multiple (the centre tick), `low` and `high` its p10 and p90 (the ends), each the mean over the three contests of
// the copies-weighted percentile, entries with Own on all nine men (STACK over stacked entries; REST over all entries), same digests (scratchpad stack-research/scale.js,
// 2026-11-04): STACK p10 0.552 / 0.604 / 0.585, p50 1.325 / 1.376 / 1.380, p90 2.545 / 3.327 / 2.152; REST p10 0.598 / 0.622 / 0.721, p50 0.979 / 1.036 / 1.081, p90 1.423 / 1.440 / 1.464.
export const STACK_SCALE = Object.freeze({ low: 0.580, mid: 1.360, high: 2.675 });
export const REST_SCALE = Object.freeze({ low: 0.647, mid: 1.032, high: 1.442 });
// The main bar's `Right at the middle`: a position within this much of the tick, on the -1 (Super unique) .. +1 (Super chalky) axis.
export const MIDDLE_BAND = 0.10;

export const BASIS_SENTENCE = "Three past contests set these bands; they show where this sits.";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const floored = (v) => Math.max(v, OWN_FLOOR);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Position on a scale, -1 (the unique end) .. 0 (the field's midpoint) .. +1 (the chalky end): the log of `multiple` against `scale.mid`, in proportion to the log distance
 *  of the end on that side, clamped at the ends. */
export function scalePosition(multiple, scale) {
  const x = Math.log(multiple / scale.mid);
  if (x < 0) return -Math.min(1, x / Math.log(scale.low / scale.mid));
  return Math.min(1, x / Math.log(scale.high / scale.mid));
}

/** The headline word for the main position: `Unique enough`, `Right at the middle` or `Not unique enough`. */
export function headlineWord(position) {
  return position <= -MIDDLE_BAND ? "Unique enough" : position >= MIDDLE_BAND ? "Not unique enough" : "Right at the middle";
}

/** The slate's averages from its rows, each man's figure read from `field` ("own" or "actualOwn"): { qbAvg, fieldTotal (sum of own^2/100 over all men with a figure), perMan (fieldTotal / 9) };
 *  null when no man has a figure or no QB does. */
export function slateAverages(rows, field = "own") {
  let fieldTotal = 0;
  let qbAvg = 0;
  let any = false;
  let anyQb = false;
  for (const r of rows ?? []) {
    const own = num(r?.[field]);
    if (own === null) continue;
    any = true;
    const sq = (own * own) / 100;
    fieldTotal += sq;
    if (r.pos === "QB") { qbAvg += sq; anyQb = true; }
  }
  return any && anyQb && qbAvg > 0 ? { qbAvg, fieldTotal, perMan: fieldTotal / LINEUP_MEN } : null;
}

const basisCache = new WeakMap(); // board -> Map(active slate key -> basis)
/**
 * Which Own the readings use on this board, and the slate's averages from it: { kind: "actual" | "projected", contest ({contestId, contest, entries} or null), avgs, note }.
 * Actual only with an accepted contest file on the board AND the main slate on screen; a second slate stays projected (the file is the main slate's) and says so.
 * Kept per board and slate so each card does not re-sum the slate.
 */
export function readBasisFor(board) {
  if (!board) return { kind: "projected", contest: null, avgs: null, note: "" };
  const key = activeSlate(board)?.key ?? "main";
  let byKey = basisCache.get(board);
  if (!byKey) basisCache.set(board, (byKey = new Map()));
  if (!byKey.has(key)) {
    const rows = activeSlateRows(board);
    const filed = board.actualOwnership ?? null;
    const actual = Boolean(filed) && key === "main";
    byKey.set(key, {
      kind: actual ? "actual" : "projected",
      contest: actual ? filed : null,
      avgs: slateAverages(rows, actual ? "actualOwn" : "own"),
      note: filed && !actual ? "Contest results are filed, but they are for the main slate, so this slate's read stays projected." : "",
    });
  }
  return byKey.get(key);
}

/** A board row's Own on the basis in use (null when it has none, or no row); `basis` from readBasisFor. */
export const ownFor = (row, basis) => (row ? num(basis?.kind === "actual" ? row.actualOwn : row.own) : null);

/** One man for the read from a board row (or null for a man no longer on the board, named by `fallbackName`). `own` is his figure on the basis in use (ownFor). */
export function contrarianMan(row, fallbackName = "a man", own = row?.own) {
  return row
    ? { name: row.name ?? fallbackName, pos: row.pos ?? null, team: row.team ?? null, opp: row.opp ?? null, own: num(own) }
    : { name: fallbackName, pos: null, team: null, opp: null, own: null, gone: true };
}

const stackWord = (m) => (m < STACK_CUTS.low ? "Low" : m < STACK_CUTS.high ? "Middle" : "Chalky");
const bandWord = (m, cuts) => (m < cuts.low ? "Contrarian" : m >= cuts.high ? "Chalky" : "Middle");

/** The stack men of a nine (QB first), or { why } when a stack cannot be told. A stack with no catcher and no runback is `men: [qb]` with `none: true`. */
function stackOf(men) {
  const qbs = men.filter((m) => m.pos === "QB");
  if (qbs.length !== 1) return { why: qbs.length ? "the lineup has more than one quarterback" : "the lineup has no quarterback" };
  const qb = qbs[0];
  if (!qb.team || !qb.opp) return { why: `${qb.name}'s opponent is not known` };
  const catchers = men.filter((m) => m !== qb && m.team === qb.team && (m.pos === "WR" || m.pos === "TE"));
  const runback = men.filter((m) => m.team === qb.opp && m.pos !== "DST");
  return { qb, catchers, runback, men: [qb, ...catchers, ...runback], none: catchers.length + runback.length === 0 };
}

/**
 * The numbers of the three readings for nine men ({name, pos, team, opp, own}, every own a number) against `avgs` (slateAverages), no words and no hovers. Returns
 * { why } when a stack cannot be told, else { stack: {none, men, gm, multiple, position}, rest: {men, mean, multiple, position}, total: {own, field, multiple}, position }.
 * The main position weights Stack and Rest by their men (Stack n, Rest 9 - n); with no stack it is Rest's alone. The scoring script over the three digests calls this.
 */
export function readNumbers(nine, avgs) {
  const s = stackOf(nine);
  if (s.why) return { why: s.why };
  let stack = { none: true, men: [s.qb], gm: null, multiple: null, position: null };
  if (!s.none) {
    const gm = Math.exp(mean(s.men.map((m) => Math.log(floored(m.own)))));
    const multiple = gm / avgs.qbAvg;
    stack = { none: false, men: s.men, gm, multiple, position: scalePosition(multiple, STACK_SCALE) };
  }
  const restMen = stack.none ? nine : nine.filter((m) => !stack.men.includes(m));
  const restMean = mean(restMen.map((m) => m.own));
  const restMultiple = restMean / avgs.perMan;
  const rest = { men: restMen, mean: restMean, multiple: restMultiple, position: scalePosition(restMultiple, REST_SCALE) };
  const totalOwn = nine.reduce((t, m) => t + m.own, 0);
  const total = { own: totalOwn, field: avgs.fieldTotal, multiple: totalOwn / avgs.fieldTotal };
  const position = stack.none ? rest.position : (stack.men.length * stack.position + restMen.length * rest.position) / LINEUP_MEN;
  return { stack, rest, total, position };
}

const quiet = (why, notIn = false) => ({ ok: false, notIn, value: null, why, title: why });

/**
 * The readings for `men` ([{name, pos, team, opp, own, gone?}]) against `basis` (readBasisFor). Returns { ok: false, notIn, why, title } for a dash (`notIn`: a man has no Own on
 * the basis in use, or the slate has none yet), else { ok: true, stack, rest, total (each with its word), position (the main position), headline, value (the position: the sort
 * figure), title, stackTitle, restTitle }.
 */
export function contrarianRead(men, basis) {
  const nine = Array.isArray(men) ? men : [];
  if (nine.length !== LINEUP_MEN) return quiet(nine.length === 0 ? "No man in this lineup yet; the readings need all nine." : `Needs all nine men; this lineup has ${nine.length}.`);
  const gone = nine.filter((m) => m.gone);
  if (gone.length) return quiet(`${gone.map((m) => `${m.name} is no longer on this slate`).join("; ")}, so there is no reading.`);
  const actual = basis?.kind === "actual";
  const lacking = nine.filter((m) => num(m?.own) === null);
  if (lacking.length) {
    const who = lacking.map((m) => (actual ? `${m.name} is not in the results of ${basis.contest.contest}` : `${m.name} has no Own yet`)).join("; ");
    return quiet(`Own not in yet: ${who}. There is no reading until all nine men have one; it is never a partial figure.`, true);
  }
  if (!basis?.avgs) return quiet("Own not in yet: the slate has no Own figures to set this lineup against.", true);
  const n = readNumbers(nine, basis.avgs);
  if (n.why) return quiet(`${n.why[0].toUpperCase()}${n.why.slice(1)}, so there is no reading.`);
  const stack = n.stack.none ? { ...n.stack, word: null } : { ...n.stack, word: stackWord(n.stack.multiple) };
  const rest = { ...n.rest, word: bandWord(n.rest.multiple, REST_CUTS) };
  const total = { ...n.total, word: bandWord(n.total.multiple, TOTAL_CUTS) };
  const read = { ok: true, stack, rest, total, position: n.position, headline: headlineWord(n.position), value: n.position };
  read.title = titleOf(read, basis);
  read.stackTitle = stackTitle(read, basis);
  read.restTitle = restTitle(read, basis);
  return read;
}

const pct = (v) => `${dec1(v)}%`;
const basisLine = (basis) => (basis.kind === "actual"
  ? `Actual Own from ${basis.contest.contest}${basis.contest.entries > 0 ? ` (${basis.contest.entries.toLocaleString("en-US")} entries)` : ""}.`
  : `Projected Own.${basis.note ? ` ${basis.note}` : ""}`);

function stackTitle({ stack }, basis) {
  const avgs = basis.avgs;
  if (stack.none) return `Stack: none. ${stack.men[0].name} has no same-team WR or TE and no man from his opponent (not its defense), so the main bar is Rest alone.`;
  const qb = stack.men[0];
  const role = (m) => (m === qb ? "QB" : m.team === qb.team ? m.pos : `${m.pos}, runback`);
  const floor = stack.men.some((m) => m.own < OWN_FLOOR) ? " A figure under 0.1% counts as 0.1%." : "";
  return `Stack: ${stack.men.map((m) => `${m.name} (${role(m)})`).join(", ")}. Their geometric mean Own ${pct(stack.gm)} is ${stack.multiple.toFixed(2)}x the slate's average QB Own of ${avgs.qbAvg.toFixed(2)} (${stack.word}; the field's midpoint is ${STACK_SCALE.mid.toFixed(2)}x).${floor}\n${basisLine(basis)} ${BASIS_SENTENCE}`;
}

function restTitle({ rest, stack }, basis) {
  return `Rest: ${rest.men.map((m) => m.name).join(", ")}${stack.none ? " (no stack, so all nine)" : ""}. Their mean Own ${pct(rest.mean)} is ${rest.multiple.toFixed(2)}x the slate's average man of ${basis.avgs.perMan.toFixed(2)} (${rest.word}; the field's midpoint is ${REST_SCALE.mid.toFixed(2)}x).\n${basisLine(basis)} ${BASIS_SENTENCE}`;
}

/** The main hover: the verdict, how it is made, the three readings' figures and the basis, kept short. */
function titleOf(read, basis) {
  const { stack, rest, total } = read;
  const how = stack.none
    ? "No stack, so Rest alone."
    : `Stack and Rest weighted by their men (${stack.men.length} and ${rest.men.length}).`;
  const readings = [stack.none ? "Stack: none" : `Stack ${stack.multiple.toFixed(2)}x (${stack.word})`, `Rest ${rest.multiple.toFixed(2)}x (${rest.word})`].join(", ");
  return `${read.headline}. ${how} Left is Super unique, right is Super chalky.\n${readings}.\nOwn ${pct(total.own)} against the field's ${basis.avgs.fieldTotal.toFixed(1)}% (${total.multiple.toFixed(2)}x, ${total.word}).\n${basisLine(basis)} ${BASIS_SENTENCE}\nHover the Stack and Rest bars for the men.`;
}

// ---- the picture: quiet ----
const fraction = (position) => 0.5 + position / 2;
const trackHtml = (position, cls = "") => `<span class="cv-track${cls}"><i class="cv-tick"></i><i class="cv-marker" style="left:${(fraction(position) * 100).toFixed(1)}%"></i></span>`;

/**
 * The read as it sits on a card, two short quiet lines: a thin bar from a faint `Super unique` to a faint `Super chalky` with a centre tick and a marker; then the verdict
 * word in plain small text with the Stack and Rest bars beside it (`Stack: none` with no stack). Every figure is on the hovers. `Own not in yet` (a quiet line, no bar) when a
 * man has no Own on the basis in use, or `Own vs field —` with the reason for any other dash.
 */
export function contrarianHtml(read) {
  if (!read?.ok) return `<span class="cv-dash" title="${escapeHtml(read?.title ?? "")}">${read?.notIn ? "Own not in yet" : "Own vs field —"}</span>`;
  const stackBit = read.stack.none
    ? `<span class="cv-mini cv-none" title="${escapeHtml(read.stackTitle)}">Stack: none</span>`
    : `<span class="cv-mini" title="${escapeHtml(read.stackTitle)}"><span class="cv-label">Stack</span>${trackHtml(read.stack.position, " cv-small")}</span>`;
  return `<div class="cv" title="${escapeHtml(read.title)}">
    <div class="cv-bar"><span class="cv-end">Super unique</span>${trackHtml(read.position)}<span class="cv-end">Super chalky</span></div>
    <div class="cv-foot"><span class="cv-word">${read.headline}</span>${stackBit}<span class="cv-mini" title="${escapeHtml(read.restTitle)}"><span class="cv-label">Rest</span>${trackHtml(read.rest.position, " cv-small")}</span></div>
  </div>`;
}
