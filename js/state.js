// Central, framework-free store: one mutable state object, a tiny pub/sub so every renderer can
// react to a change without the callers having to know who else cares, and the pure filter/sort
// helpers the table and game strip both need.

const POSITION_CHIPS = ["All", "QB", "RB", "WR", "TE", "DST", "FLEX"];
const FLEX_POS = new Set(["RB", "WR", "TE"]);

// Star and every numeric column default to descending on the first click of a new column; text columns
// (player, pos, team, opp, tags, status) default ascending. Value is the table's own default sort, set once
// at load rather than from a click: Lev exists only for players with a real ownership number, which is
// usually a small part of the slate, so it cannot order the whole board.
const DESC_FIRST_COLUMNS = new Set(["star", "salary", "proj", "own", "value", "lev"]);
export function defaultDirFor(col) {
  return DESC_FIRST_COLUMNS.has(col) ? "desc" : "asc";
}

// Shared with the "Clear filters" control so it resets to exactly what a fresh load starts with.
export function defaultFilters() {
  return {
    pos: "All",
    teams: new Set(),
    salaryMin: null,
    salaryMax: null,
    search: "",
    starredOnly: false,
    gameId: null,
  };
}

class Store {
  constructor() {
    this.state = {
      board: null,
      loadError: null,
      activeTab: "rankings",
      filters: defaultFilters(),
      sort: { col: "value", dir: "desc" },
      staleFromUpload: null, // {stale:[...], uploadedAt, fileName} shown before the board (re)loads
    };
    this.listeners = [];
  }
  get() {
    return this.state;
  }
  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }
  setFilters(patch) {
    this.state = { ...this.state, filters: { ...this.state.filters, ...patch } };
    this.emit();
  }
  setSort(patch) {
    this.state = { ...this.state, sort: { ...this.state.sort, ...patch } };
    this.emit();
  }
  subscribe(fn) {
    this.listeners.push(fn);
  }
  emit() {
    for (const fn of this.listeners) fn(this.state);
  }
}

export const store = new Store();
export { POSITION_CHIPS, FLEX_POS };

export function matchesPosition(row, pos) {
  if (pos === "All") return true;
  if (pos === "FLEX") return FLEX_POS.has(row.pos);
  return row.pos === pos;
}

export function filterRows(rows, filters) {
  return rows.filter((row) => {
    if (!matchesPosition(row, filters.pos)) return false;
    if (filters.teams.size > 0 && !filters.teams.has(row.team)) return false;
    if (filters.salaryMin != null && row.salary < filters.salaryMin) return false;
    if (filters.salaryMax != null && row.salary > filters.salaryMax) return false;
    if (filters.starredOnly && !row.starred) return false;
    if (filters.gameId && row.gameId !== filters.gameId) return false;
    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      if (!row.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function sortValue(row, col) {
  switch (col) {
    case "star":
      return row.starred ? 1 : 0;
    case "player":
      return row.name ?? null;
    case "pos":
      return row.pos ?? null;
    case "team":
      return row.team ?? null;
    case "opp":
      return row.opp ?? null;
    case "salary":
      return row.salary ?? null;
    case "proj":
      return row.proj ?? null;
    case "own":
      return row.own ?? null;
    case "value":
      return row.value ?? null;
    case "lev":
      return row.lev ?? null;
    case "tags":
      return row.tags && row.tags.length ? row.tags.map((t) => t.tag).join(",") : null;
    case "status":
      return row.status && row.status.trim() ? row.status : null;
    default:
      return null;
  }
}

// Null values always sort to the bottom regardless of direction; only non-null values flip with dir. That is
// what keeps a blank Own% and a blank Lev under every real number whichever way the column is sorted.
export function sortRows(rows, col, dir) {
  const withIndex = rows.map((row, i) => ({ row, i }));
  withIndex.sort((a, b) => {
    const va = sortValue(a.row, col);
    const vb = sortValue(b.row, col);
    const aNull = va == null || va === "";
    const bNull = vb == null || vb === "";
    if (aNull && bNull) return a.i - b.i;
    if (aNull) return 1;
    if (bNull) return -1;
    let cmp;
    if (typeof va === "string") cmp = va.localeCompare(vb);
    else cmp = va - vb;
    if (cmp === 0) return a.i - b.i;
    return dir === "asc" ? cmp : -cmp;
  });
  return withIndex.map((x) => x.row);
}
