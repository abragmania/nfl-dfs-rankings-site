// The Showdown board's pure shaping, moved verbatim out of view.js (the 600-line cap, 2026-10-22): the
// normalize step a loaded board goes through, the Rankings table's sort and filter, and two small words helpers for the header band
// and the legend. Nothing here reads view.js's state; view.js passes what each function needs and owns the request tokens and the DOM.
import { TEAM_BY_ABBR } from "../teams-data.js";
import { applyGrades } from "../grade.js";

// --------------------------------------------------------------------------------------------------------
// Normalize: real field names only (server/showdown/board.js rows and server/showdown/routes.js
// responses, per 🔵 review) — no more guessing at an id, no more re-deriving coverage.
// --------------------------------------------------------------------------------------------------------

// A row's id and cptId are exactly what the CSV gave the board (🔵 finding: never invent one). A row with
// no Captain row in the CSV carries cptId null, same as the server.
function normalizeRow(r) {
  return {
    ...r,
    id: r.id,
    cptId: r.cptId ?? null,
    name: r.name,
    team: r.team,
    pos: r.pos,
    status: r.status ?? "",
    salary: r.salary ?? null,
    cptSalary: r.cptSalary ?? null,
    proj: r.proj ?? null,
    cptProj: r.cptProj ?? null,
    value: r.value ?? null,
    sources: r.sources ?? {},
    // coverage is already a 0-1 fraction on the real board (server/showdown/board.js); passed through
    // unchanged (🔵 finding — the old fraction-from-a-count conversion here was for a static data file
    // that no longer describes the live shape).
    coverage: r.coverage ?? null,
    projHow: r.projHow ?? "",
    ownFlex: r.ownFlex ?? null,
    ownCpt: r.ownCpt ?? null,
    // Real per-side kinds (🔵 finding): "published" | "estimate" (the sim, D29 as amended) | "override" | null (missing, D29), independently for FLEX
    // and Captain — a player can be published at FLEX and missing at Captain, or vice versa.
    ownKindFlex: r.ownKindFlex ?? null,
    ownKindCpt: r.ownKindCpt ?? null,
    ownHow: r.ownHow ?? "",
    // No Lev measure yet (Adam 2026-10-15, Lev measure to be redesigned): always null, whatever an older board sent.
    levFlex: null,
    levCpt: null,
    flags: r.flags ?? [],
    tags: r.tags ?? [],
    note: r.note ?? "",
  };
}

// Fallback-chain source normalization, the same idea as public/js/normalize.js's normalizeSource for the
// classic board: the real board's source cards (server/showdown/board.js) carry "records"/"matched" while
// the card renderer wants recordCount/matchedCount/unmatchedCount/weight/enabled/fetchedAt. Unmatched
// names live off the card, at board.unmatched.projections[id] for a projection card or
// board.unmatched.kickers[id] for a kicker card (id already "k:<sourceId>", 🔵 finding).
function normalizeSource(s, unmatched) {
  const recordCount = s.recordCount ?? s.records ?? 0;
  const matchedCount = s.matchedCount ?? s.matched ?? 0;
  const unmatchedNames = s.unmatchedNames ?? (s.kind === "kicker" ? unmatched?.kickers?.[s.id] : unmatched?.projections?.[s.id]) ?? [];
  return {
    ...s,
    weight: s.weight ?? null,
    enabled: s.enabled ?? true,
    recordCount,
    matchedCount,
    unmatchedCount: s.unmatchedCount ?? Math.max(0, recordCount - matchedCount),
    unmatchedNames,
    fetchedAt: s.fetchedAt ?? null,
  };
}

export function normalizeBoard(raw) {
  if (!raw || !raw.ok) return raw;
  // Val is graded by applyGrades' z-bands within position (D33); applyGrades leaves out rows (rowIsOut) ungraded, the same
  // rows the table dims. Lev has no measure and is never graded (Adam 2026-10-15, Lev measure to be redesigned).
  const normalized = (raw.rows ?? []).map(normalizeRow);
  const rows = applyGrades(normalized.map((r) => ({ ...r, lev: null }))).map((g) => {
    const { lev, ...r } = g;
    return { ...r, levGrade: null, levCptGrade: null };
  });
  const sources = (raw.sources ?? []).map((s) => normalizeSource(s, raw.unmatched));
  return { ...raw, rows, sources };
}

// --------------------------------------------------------------------------------------------------------
// Filter / sort
// --------------------------------------------------------------------------------------------------------

const DESC_FIRST = new Set(["salary", "cptSalary", "proj", "cptProj", "tgCeil", "tgCeilCpt", "value", "ownFlex", "ownCpt", "levFlex", "levCpt"]);
export function defaultDirFor(col) {
  return DESC_FIRST.has(col) ? "desc" : "asc";
}

/** A column's sort value from the board row (the Optimizer's pool passes its own reader for the figures it shows, pool.js). */
export function sortValue(row, col) {
  switch (col) {
    case "player":
      return row.name ?? null;
    case "salary":
      return row.salary ?? null;
    case "cptSalary":
      return row.cptSalary ?? null;
    case "proj":
      return row.proj ?? null;
    case "cptProj":
      return row.cptProj ?? null;
    case "value":
      return row.value ?? null;
    case "ownFlex":
      return row.ownFlex ?? null;
    case "ownCpt":
      return row.ownCpt ?? null;
    case "levFlex":
      return row.levFlex ?? null;
    case "levCpt":
      return row.levCpt ?? null;
    case "note":
      return row.note && row.note.trim() ? row.note : null;
    default:
      return null;
  }
}

// Same null-sorts-last rule as public/js/state.js's sortRows, so a blank Own% or CPT $ always drops to
// the bottom of the table regardless of sort direction. `valueOf(row, col)`: the value read, sortValue by default.
export function sortRows(rows, col, dir, valueOf = sortValue) {
  const withIndex = rows.map((row, i) => ({ row, i }));
  withIndex.sort((a, b) => {
    const va = valueOf(a.row, col);
    const vb = valueOf(b.row, col);
    const aNull = va == null || va === "";
    const bNull = vb == null || vb === "";
    if (aNull && bNull) return a.i - b.i;
    if (aNull) return 1;
    if (bNull) return -1;
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    if (cmp === 0) return a.i - b.i;
    return dir === "asc" ? cmp : -cmp;
  });
  return withIndex.map((x) => x.row);
}

// `projOf(row)`: the FLEX projection Min FLEX pts compares, the row's own by default (the Optimizer's pool passes the figure its Proj cell shows).
export function filterRows(rows, filters, game, projOf = (row) => row.proj) {
  return rows.filter((row) => {
    if (filters.team === "away" && row.team !== game?.away) return false;
    if (filters.team === "home" && row.team !== game?.home) return false;
    if (filters.pos !== "All" && (row.pos ?? "").trim().toUpperCase() !== filters.pos) return false;
    // Min FLEX salary (Adam 2026-10-26 3:26 PM: min first, then max, as classic's salary range): a missing salary is below any floor.
    if (filters.minSalary != null && (row.salary ?? -Infinity) < filters.minSalary) return false;
    if (filters.maxSalary != null && (row.salary ?? Infinity) > filters.maxSalary) return false;
    // "Min FLEX pts" always compares against the FLEX projection (row.proj), never cptProj, even though
    // the row also carries a Captain projection (Adam, confirmed) — a player with no projection at all
    // is treated as below any floor, same as the salary filter treats a missing salary as above any cap.
    if (filters.minProj != null && (projOf(row) ?? -Infinity) < filters.minProj) return false;
    return true;
  });
}

// --------------------------------------------------------------------------------------------------------
// Words for the header band and the legend (view.js renderBand, renderLegend)
// --------------------------------------------------------------------------------------------------------

export function teamFullName(abbr) {
  return TEAM_BY_ABBR[abbr]?.name ?? abbr ?? "";
}

export function joinWords(list) {
  const words = list.filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
