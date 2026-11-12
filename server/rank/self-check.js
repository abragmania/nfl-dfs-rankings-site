// The board checks itself before Adam sees it (global rule G65). Pure: no node modules and only pure server files, so the public
// site runs the same check on its in-browser board (DECISIONS.md D71; tools/publish.mjs copies this file with the engine).
//
// selfCheck(board) reads a built board's rows (Showdown or classic) and returns { ok, failures, notes, rowsChecked }; each failure is
// { id, name, rule, line, figures }, `line` the plain-English sentence the foot of the board prints; `notes` are counts of what the
// check set aside without calling it a board failure (G62). Three checks:
//   1. hidden-by-lower-source: the source order is DraftKings' own status and the game-day inactives list may hide a man, TwoGun sets
//      the number, and an outside feed's tag (ESPN, the Sleeper backup) alone is only a flag. A man TwoGun projects who is hidden or
//      zeroed with an outside feed's tag as the only reason is a failure. Not failures: Adam's own Out (override.status), a status
//      in DraftKings' file (row.salaryStatus), a game-day inactive (status INACTIVE or the feed's comment says inactive; this is also
//      the only hide the 11-02 outAfterStamp rule may make), TwoGun's own OUT call, and a feed tag set aside by injury-ignore.json
//      (that record never reaches the row, so there is nothing to find). Adam's In removes the hide (rowIsOut).
//   2. projection-follows-inputs: a shown projection is the typed number, else the chosen source number (row.projBase), times the
//      +-5% bump steps, within rounding; a man listed out shows 0; with only TwoGun ticked a TwoGun-sourced number is his published one.
//   3. past-ceiling: a projection not typed by Adam is not above the row's ceiling (row.ceiling, or TwoGun's row.tg.ceil when his
//      number is the one shown). A ceiling of 0 is a blank. A man whose own published projection is above his own published ceiling
//      is the source disagreeing with itself: counted in notes, not a failure.
import { rowIsOut, statusSetting, isSidelined } from "./sidelined.js";
import { bumpFactor } from "../overrides/merge.js";

const TWOGUN = "twogun";
const TOLERANCE = 0.011; // displayed figures are rounded to hundredths
const FEED_LABEL = { "ESPN injuries": "ESPN", Sleeper: "Sleeper" };
const SRC_LABEL = { espn: "ESPN", sleeper: "Sleeper" };

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const fmt = (n) => String(Math.round(n * 100) / 100);
const differs = (a, b) => Math.abs(a - b) > TOLERANCE;

/** A game-day inactive: the feed's status says INACTIVE or its comment does (ESPN files them as Out with the comment "inactive"). */
function isGameDayInactive(row) {
  const words = [row.status, row.injury?.status];
  if (words.some((w) => String(w ?? "").trim().toUpperCase() === "INACTIVE")) return true;
  return /\binactive\b/i.test(String(row.injury?.comment ?? ""));
}

/** The label of the outside feed that holds the row's tag ("ESPN", "Sleeper", or a generic phrase). */
function feedLabel(row) {
  return FEED_LABEL[row.injury?.source] ?? SRC_LABEL[row.src?.status] ?? "an outside feed";
}

/** TwoGun's number for the man when his number is the one this board uses for him, else null. */
function twogunNumber(row) {
  const n = num(row.projBySource?.[TWOGUN]);
  if (n === null || n <= 0) return null;
  return row.src && typeof row.src === "object" && row.src.proj !== TWOGUN ? null : n;
}

/** A hide the source order allows: returns the reason, or null when only an outside feed's tag explains it. */
function legitHide(row) {
  if (statusSetting(row) === "out") return "Adam's Out";
  if (isSidelined(row.salaryStatus)) return "DraftKings' status";
  if (isGameDayInactive(row)) return "game-day inactive";
  if (row.tg?.call === "OUT") return "TwoGun's own out call";
  return null;
}

function hiddenByLowerSource(row) {
  if (!rowIsOut(row)) return null;
  const his = twogunNumber(row);
  if (his === null || legitHide(row) !== null) return null;
  const feed = feedLabel(row);
  const word = String(row.injury?.status ?? row.status ?? "out").trim() || "out";
  const late = Array.isArray(row.flags) && row.flags.includes("outAfterStamp") ? " (ruled out after his stamp, and not an inactive)" : "";
  return {
    rule: "hidden-by-lower-source",
    line: `Self-check: ${row.name} hidden only by ${feed}'s ${word} while TwoGun projects ${fmt(his)}${late}`,
    figures: { feed, status: word, twogun: his, shown: num(row.proj), outAfterStamp: late !== "" }
  };
}

/** Check 2. Returns a failure, "unchecked" (the row carries no source number to hold the shown one against), or null. */
function projectionFollows(row, board) {
  const shown = num(row.proj);
  if (rowIsOut(row)) {
    if (shown === 0) return null;
    return { rule: "projection-follows-inputs", line: `Self-check: ${row.name} is listed out but shows ${shown === null ? "no projection" : fmt(shown)}, not 0`, figures: { shown } };
  }
  const typed = num(row.override?.proj);
  if (typed === null && !("projBase" in row)) return shown === null ? null : "unchecked";
  const base = typed ?? num(row.projBase);
  const steps = num(row.override?.bump) ?? 0;
  const expected = base === null ? null : base * bumpFactor(steps);
  const what = typed !== null ? "his typed number" : "the source number";
  const bumpText = steps ? ` with a ${steps > 0 ? "+" : ""}${steps} bump` : "";
  if (expected === null && shown === null) return null;
  if (expected === null || shown === null || differs(shown, expected)) {
    return {
      rule: "projection-follows-inputs",
      line: `Self-check: ${row.name} shows ${shown === null ? "no projection" : fmt(shown)} but ${what}${expected === null ? " is missing" : bumpText ? ` ${fmt(base)}${bumpText} is ${fmt(expected)}` : ` is ${fmt(expected)}`}`,
      figures: { shown, base, steps, expected }
    };
  }
  // With only TwoGun ticked for projections, a number that came from him is his published one (edits are already in projBySource).
  const his = num(row.projBySource?.[TWOGUN]);
  if (typed === null && board?.mode?.cashMode === TWOGUN && row.src?.proj === TWOGUN && his !== null && differs(base, his)) {
    return {
      rule: "projection-follows-inputs",
      line: `Self-check: ${row.name} has ${fmt(base)} from TwoGun but his own number is ${fmt(his)}`,
      figures: { shown, base, twogun: his }
    };
  }
  return null;
}

function pastCeiling(row) {
  const shown = num(row.proj);
  if (shown === null || num(row.override?.proj) !== null) return null; // Adam's typed number is his own, not a source's
  // A ceiling of 0 or less is a source's blank for a man it gives no range (TwoGun files 0 for his scrubs), so it is missing, not a limit.
  const ceilings = [["the ceiling", num(row.ceiling)], [row.src?.proj === TWOGUN ? "TwoGun's own ceiling" : null, num(row.tg?.ceil)]];
  for (const [label, ceil] of ceilings) {
    if (label && ceil !== null && ceil > 0 && shown > ceil + TOLERANCE) {
      // His file puts a man's ceiling below his own projection: the source disagrees with itself, the board shows his number as published (counted in notes, not a board failure).
      const hisRaw = num(row.projBySource?.[TWOGUN]);
      const hisCeil = num(row.tg?.bumpBase?.ceil) ?? ceil;
      if (label === "TwoGun's own ceiling" && hisRaw !== null && hisRaw > hisCeil + TOLERANCE) return "source-inconsistent";
      return { rule: "past-ceiling", line: `Self-check: ${row.name} shows ${fmt(shown)}, past ${label} ${fmt(ceil)}`, figures: { shown, ceiling: ceil } };
    }
  }
  return null;
}

/** The self-check of a built board. Pure; the board is not changed. Returns { ok, failures: [{ id, name, rule, line, figures }], rowsChecked }. */
export function selfCheck(board) {
  const rows = Array.isArray(board?.rows) ? board.rows : [];
  const failures = [];
  const unchecked = [];
  let inconsistent = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const found = [hiddenByLowerSource(row)];
    const follows = projectionFollows(row, board);
    if (follows === "unchecked") unchecked.push(row.name);
    else found.push(follows);
    const ceiling = pastCeiling(row);
    if (ceiling === "source-inconsistent") inconsistent++;
    else found.push(ceiling);
    for (const f of found) if (f) failures.push({ id: row.id, name: row.name, ...f });
  }
  const notes = inconsistent ? [`Self-check: TwoGun's own file puts the ceiling below the projection for ${inconsistent} player${inconsistent === 1 ? "" : "s"}; the board shows his projection as published`] : [];
  // Nothing is dropped silently (G62): rows with a shown projection and no source number to hold it against are counted.
  if (unchecked.length) {
    failures.push({ id: null, name: null, rule: "unchecked", line: `Self-check: ${unchecked.length} player${unchecked.length === 1 ? "" : "s"} could not be checked (the row carries no source number for the projection)`, figures: { count: unchecked.length } });
  }
  return { ok: failures.length === 0, failures, notes, rowsChecked: rows.length - unchecked.length };
}

/** The board with its self-check attached as board.selfCheck (a new object). */
export function withSelfCheck(board) {
  return board && typeof board === "object" && Array.isArray(board.rows) ? { ...board, selfCheck: selfCheck(board) } : board;
}
