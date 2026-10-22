// Favorites helper: the starred rows of the loaded slate, in roster order. The Favorites tab is gone (Optimizer-first step 3);
// "Favorites only" is a filter on Rankings and the Optimizer pool (filterbar.js, state.js filterRows) and keeps the 3.0 projection
// floor like every other filter. This list is not floored: it counts every starred row, under-floor ones included. The chip carries
// that count, "★ Favorites only (3)" (Adam, 2026-10-21; D53).

const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, DST: 4 };
function posRank(pos) {
  return Object.prototype.hasOwnProperty.call(POS_ORDER, pos) ? POS_ORDER[pos] : Object.keys(POS_ORDER).length;
}

/** The starred rows only, in roster order (QB, RB, WR, TE, DST, any other position last), then salary high to
 * low, then projection high to low (no projection last), then name. Pure: does not touch the input array. */
export function favoriteRows(rows) {
  return (rows ?? [])
    .filter((r) => r && r.starred)
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const pa = posRank(a.row.pos);
      const pb = posRank(b.row.pos);
      if (pa !== pb) return pa - pb;
      const sa = Number.isFinite(a.row.salary) ? a.row.salary : -Infinity;
      const sb = Number.isFinite(b.row.salary) ? b.row.salary : -Infinity;
      if (sa !== sb) return sb - sa;
      const ja = a.row.proj;
      const jb = b.row.proj;
      const aNull = ja == null;
      const bNull = jb == null;
      if (aNull !== bNull) return aNull ? 1 : -1;
      if (!aNull && ja !== jb) return jb - ja;
      const byName = String(a.row.name ?? "").localeCompare(String(b.row.name ?? ""));
      return byName !== 0 ? byName : a.i - b.i;
    })
    .map((x) => x.row);
}
