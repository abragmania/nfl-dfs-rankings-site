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
    showAllPlayers: false, // off = the projection floor below applies
    gameId: null,
  };
}

// Adam's "ONLY show players with a projection of greater than 3 points (in classic)" rule (PROJECT.md D52).
// Strictly greater: a 3.0 projection is hidden. Distinct from the value-tint floor in grade.js (D42, "under 3
// gets no tint"), which is a colouring rule and stays as it is.
export const CLASSIC_PROJ_FLOOR = 3;

// The one predicate behind every classic player list (Rankings table, Projections tab, Projected Ownership
// tab, Lineup Builder pool). `row.proj` is the final projection (a typed-in override included); a player with
// no projection is hidden too. Skipped when "Show all players" is on, and while the search box has text so
// that typing a name always finds the player.
export function passesProjFloor(row, filters) {
  if (filters?.showAllPlayers) return true;
  if (filters?.search && filters.search.trim()) return true;
  return row.proj != null && row.proj > CLASSIC_PROJ_FLOOR;
}

class Store {
  constructor() {
    this.state = {
      board: null,
      loadError: null,
      activeTab: "rankings",
      activeSlateKey: null, // key of the second slate on screen (D57), null = the main slate
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

// ---------------------------------------------------------------------------------------------------------
// Second slates (PROJECT.md D57: an afternoon-only DraftKings slate lives beside the main slate, never over
// it). The board carries `slates: [{ key, label, gameIds, players, uploadedAt, dkIds }]`; a board from before
// that field existed (or the public site's older baked copy) has none, which is the same as an empty list.
// Every classic list reads its rows through activeSlateRows(), so "which players are on screen" is decided in
// this one place. `key` defaults to the store's activeSlateKey; tests pass it explicitly.
// ---------------------------------------------------------------------------------------------------------

/** The second-slate record on screen, or null for the main slate (no key, an unknown key, or no `slates`). */
export function activeSlate(board, key = store.get().activeSlateKey) {
  if (!key || !board || !Array.isArray(board.slates)) return null;
  return board.slates.find((s) => s && s.key === key && Array.isArray(s.gameIds)) ?? null;
}

/** The rows every classic list shows: the whole board on the main slate, or only the rows whose game is in the
 *  active second slate. Never mutates the board. */
export function activeSlateRows(board, key = store.get().activeSlateKey) {
  const rows = board?.rows ?? [];
  const slate = activeSlate(board, key);
  if (!slate) return rows;
  const games = new Set(slate.gameIds);
  return rows.filter((r) => games.has(r.gameId));
}

/** The games the game strip and the team chips show: all of them, or only the active second slate's. */
export function activeSlateGames(board, key = store.get().activeSlateKey) {
  const games = board?.slate?.games ?? [];
  const slate = activeSlate(board, key);
  if (!slate || !Array.isArray(games)) return games;
  const ids = new Set(slate.gameIds);
  return games.filter((g) => ids.has(g.id));
}

/** "Afternoon slate" for the label "Afternoon"; a label that already ends in "slate" ("3-game slate") is kept. */
export function slateDisplayName(slate) {
  const label = String(slate?.label ?? slate?.key ?? "").trim();
  return /slate$/i.test(label) ? label : `${label} slate`;
}

/** The mode-row tile's words: "Afternoon · 4 games" (a label that already counts its games is shown alone). */
export function slateTileText(slate) {
  const label = String(slate?.label ?? slate?.key ?? "").trim();
  const n = Array.isArray(slate?.gameIds) ? slate.gameIds.length : 0;
  return /game/i.test(label) ? label : `${label} · ${n} game${n === 1 ? "" : "s"}`;
}

/** The second-slate key in a location.hash string ("#slate=afternoon"), or null. Never throws. */
export function slateKeyFromHashString(hash) {
  const m = /^#slate=(.+)$/.exec(hash || "");
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null; // a malformed percent-encoding must never throw out of a hashchange handler
  }
}

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
    if (!passesProjFloor(row, filters)) return false;
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
