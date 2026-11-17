// D41: score each source's stat line with DraftKings kicker scoring (borrowing a split for a source without one), then
// median, 25% outlier drop, and the weighted mean of the rest. Pure (D71): the Showdown selection scores kickers here.
import { listInWords as listJoin } from "../../rank/ownership-summary.js";
import { TWOGUN_ID } from "../selection-core.js";
import { TWOGUN_LABEL } from "../../twogun/overlay.js";
import { parseCell, kickerPoints, splitFieldGoals } from "../../slate/dk-scoring-core.js";

export const KICKER_SOURCE_LABELS = Object.freeze({
  sleeper: "Sleeper app",
  espn: "ESPN",
  cbs: "CBS Sports",
  fantasypros: "FantasyPros"
});

/** The field-goal distance split used when no source with a split covers a kicker (league-wide rough shares). */
export const LEAGUE_DEFAULT_SPLIT = Object.freeze({ under40: 0.55, from40to49: 0.3, from50: 0.15 });

/** A source more than this fraction away from the median is dropped from the average. */
const OUTLIER_FRACTION = 0.25;

const n0 = (v) => parseCell(v) ?? 0;
const r2 = (v) =>(Math.round(v * 100) / 100).toFixed(2);
const pct = (v) => `${Math.round(v * 100)}%`;
const labelOf = (id) => KICKER_SOURCE_LABELS[id] ?? (id === TWOGUN_ID ? TWOGUN_LABEL : id);

/** A record's own split (each bucket's share of its made field goals), or null when it has none to give. */
function ownSplit(rec) {
  if (!rec?.hasSplit) return null;
  const a = n0(rec.stat?.fg0_39);
  const b = n0(rec.stat?.fg40_49);
  const c = n0(rec.stat?.fg50);
  const sum = a + b + c;
  if (!(sum > 0)) return null;
  return { under40: a / sum, from40to49: b / sum, from50: c / sum };
}

// D41: a source without a distance split borrows the mean split of those with one (LEAGUE_DEFAULT_SPLIT if none).
// `ids` (the ticked kicker sources), when given, is the only sources scored, and the only ones lent from unless
// `lendFrom` names others, so an unticked source never shapes another's split (Sources page plan). A caller scoring
// extra display columns passes the ids its projection used as `lendFrom`, so the columns share that projection's split.
export function scoreKickers(perSource, ids = null, lendFrom = ids) {
  const all = (Array.isArray(perSource)
    ? perSource.map((e) => ({ id: e?.id, record: e?.record }))
    : Object.entries(perSource ?? {}).map(([id, record]) => ({ id, record }))
  ).filter((e) => e.id && e.record && typeof e.record === "object");
  const within = (list) => { const keep = list ? new Set(list) : null; return all.filter((e) => !keep || keep.has(e.id)); };
  const entries = within(ids);

  const splitters = within(lendFrom).map((e) => ({ id: e.id, split: ownSplit(e.record) })).filter((e) => e.split);
  const split = splitters.length
    ? {
        under40: splitters.reduce((s, e) => s + e.split.under40, 0) / splitters.length,
        from40to49: splitters.reduce((s, e) => s + e.split.from40to49, 0) / splitters.length,
        from50: splitters.reduce((s, e) => s + e.split.from50, 0) / splitters.length
      }
    : { ...LEAGUE_DEFAULT_SPLIT };

  const borrowed = [];
  const scored = entries.map(({ id, record }) => {
    let stat = record.stat ?? {};
    if (!ownSplit(record)) {
      const fgTotal = n0(record.fgTotal);
      stat = { ...splitFieldGoals(fgTotal, split), xp: n0(stat.xp) };
      borrowed.push({ id, fgTotal });
    }
    return { id, points: kickerPoints(stat).points };
  });
  return { scored, split: { borrowed, splitters, split } };
}

function median(values) {
  const v = [...values].sort((x, y) => x - y);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function combineKickerPoints(scored, { weights = null, split = null } = {}) {
  const weightOf = (id) => (weights ? Number(weights[id]) : 1);
  const entries = (scored ?? []).filter((s) => s && s.id && Number.isFinite(s.points) && weightOf(s.id) > 0).map(({ id, points }) => ({ id, points }));
  if (!entries.length) return { proj: null, how: "No kicker source projects this player.", used: [], dropped: [] };

  const med = median(entries.map((s) => s.points));
  const isOut = (p) => med > 0 && Math.abs(p - med) > OUTLIER_FRACTION * med;
  let used = entries.filter((s) => !isOut(s.points));
  let dropped = entries.filter((s) => isOut(s.points)).map((s) => ({
    ...s,
    why: `${pct(Math.abs(s.points - med) / med)} ${s.points > med ? "above" : "below"} the median ${r2(med)}, more than 25% off`
  }));
  let allKept = false;
  if (!used.length) {
    used = entries;
    dropped = [];
    allKept = true;
  }
  let acc = 0;
  let wsum = 0;
  for (const e of used) {
    acc += weightOf(e.id) * e.points;
    wsum += weightOf(e.id);
  }
  const proj = acc / wsum;
  const equal = used.every((e) => weightOf(e.id) === weightOf(used[0].id));

  const sentences = [];
  const usedText = listJoin(used.map((s) => `${labelOf(s.id)} ${r2(s.points)}`));
  const weightText = equal ? "" : ` (weighted ${listJoin(used.map((s) => `${labelOf(s.id)} x${weightOf(s.id)}`))})`;
  sentences.push(
    used.length === 1
      ? `Kicker projection ${r2(proj)} from ${usedText} alone.`
      : `Kicker projection ${r2(proj)} is the ${equal ? "" : "weighted "}average of ${usedText}${weightText}.`
  );
  if (dropped.length) {
    sentences.push(`Left out as more than 25% off the median of ${r2(med)}: ${listJoin(dropped.map((d) => `${labelOf(d.id)} ${r2(d.points)}`))}.`);
  }
  if (allKept) sentences.push(`Every source is more than 25% off the median of ${r2(med)}, so none was left out.`);
  const counted = new Set(entries.map((e) => e.id));
  const borrowed = (split?.borrowed ?? []).filter((b) => counted.has(b.id));
  if (borrowed.length && split?.split) {
    const splitters = split.splitters ?? [];
    const from = splitters.length
      ? `the average split of ${listJoin(splitters.map((s) => labelOf(s.id)))} for this kicker`
      : "a league-wide default split, since no source gave distances for this kicker";
    const sp = split.split;
    sentences.push(
      `${listJoin(borrowed.map((b) => labelOf(b.id)))} ${borrowed.length === 1 ? "gives" : "give"} only total field goals, split ${pct(sp.under40)} under 40 yards, ${pct(sp.from40to49)} 40-49 and ${pct(sp.from50)} 50+ using ${from}.`
    );
  }
  sentences.push("DraftKings scoring: 3 per field goal under 40 yards, 4 for 40-49, 5 for 50+, 1 per extra point.");

  return { proj, how: sentences.join(" "), used: used.map(({ id, points }) => ({ id, points })), dropped };
}
