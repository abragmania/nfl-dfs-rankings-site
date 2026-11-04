// What a Showdown game remembers in the browser's one memory (../memory.js, optimizer standard A9, round 5): the pool's filters and sort and the working lineup (the Captain and the five FLEX seats), per game
// (the game's key already carries the season and week), so a switch to another game and back finds each game as he left it, and a reload brings it back. The Optimizer's settings per game are
// optimizer-state.js's, remembered since earlier rounds; the exposure table's sort and filter are saved by optimizer.js into the same memory. Storage that is blocked or damaged only loses the convenience.
import { readMemory, updateMemory, setOnScreen, slateEntry, cleanShowdownFilters, cleanSort, restoreShowdownLineup, storableShowdownLineup, goneSentence } from "../memory.js";
import { poolState, DEFAULT_POOL_FILTERS } from "./pool.js";
import { SD_COLUMNS } from "./table.js";
import { rowIsOut } from "../table.js";

const SORT_COLUMNS = SD_COLUMNS.map((c) => c.key);
const START_SORT = { col: "proj", dir: "desc" };

let viewKey = null; // the game whose filters and sort are on screen
let viewJson = ""; // what was last written for it

/** The pool's filters and sort of the game on screen as stored. */
const viewOf = () => ({ filters: poolState.filters, sort: poolState.sort });

/**
 * Called as a game is drawn: a game that is not the one drawn last gets its remembered filters and sort (a team that is not one of its two goes, a sort on a column that is gone falls back to Proj,
 * high to low); true when they were replaced, so the filter bar must be drawn again from them. For the game already on screen it does nothing.
 */
export function restoreView(key, board) {
  if (!key || key === viewKey) return false;
  viewKey = key;
  setOnScreen("showdown", key); // a full quota never drops the game on screen
  const entry = readMemory().showdown?.games?.[key] ?? {};
  const game = board?.game ?? {};
  poolState.filters = cleanShowdownFilters(entry.filters, { teams: [game.away, game.home].filter(Boolean), defaults: DEFAULT_POOL_FILTERS });
  poolState.sort = cleanSort(entry.sort, SORT_COLUMNS, START_SORT);
  viewJson = JSON.stringify(viewOf());
  return true;
}

/** Writes the pool's filters and sort under the game on screen when they changed since the last write. */
export function saveView() {
  if (!viewKey) return;
  const json = JSON.stringify(viewOf());
  if (json === viewJson) return;
  viewJson = json;
  const key = viewKey;
  const v = viewOf();
  updateMemory((m) => Object.assign(slateEntry(m, "showdown", key), { filters: v.filters, sort: v.sort }));
}

/**
 * The remembered lineup of `key` against the men on `board`: {cpt: {id}|null, flex: [{id}|null x flexCount], note} where `note` says who is gone (a man who left the board, changed id or belongs to another
 * week is dropped and named, never replaced). An empty lineup when nothing is remembered.
 */
export function restoreLineup(key, board, flexCount = 5) {
  setOnScreen("showdown", key);
  const entry = readMemory().showdown?.games?.[key];
  const rowIds = new Set((board?.rows ?? []).map((r) => String(r.id)));
  // A board with no rows is not loaded (yet): nobody can be judged gone from it, so the remembered men stay seated and the next board with rows is checked against them (dropMenGoneFromBoard).
  const loaded = rowIds.size > 0;
  const got = restoreShowdownLineup(entry?.lineup, (id) => !loaded || rowIds.has(id), flexCount);
  const byId = new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
  const out = [got.cpt, ...got.flex].filter((id) => id && byId.has(id) && rowIsOut(byId.get(id))).map((id) => byId.get(id).name);
  const outText = out.length ? `${out.join(", ")} ${out.length === 1 ? "is" : "are"} listed out but ${out.length === 1 ? "is" : "are"} still in your remembered lineup; Build holds ${out.length === 1 ? "him" : "them"} only as the rules already do.` : "";
  return { cpt: got.cpt ? { id: got.cpt } : null, flex: got.flex.map((id) => (id ? { id } : null)), note: [goneSentence(got.gone, "this game"), outText].filter(Boolean).join(" ") };
}

/** The names stored beside the men of `key`'s remembered lineup (id to name). */
export function rememberedNames(key) {
  const lineup = readMemory().showdown?.games?.[key]?.lineup;
  const out = new Map();
  for (const s of [lineup?.cpt, ...(Array.isArray(lineup?.flex) ? lineup.flex : [])]) if (s && s.id != null && s.name) out.set(String(s.id), s.name);
  return out;
}

/**
 * A new board for the game already on screen (a refresh, a re-upload) is checked against the seats: a man the board no longer has (a new id, or he left the file) is taken out, and the sentence names him from the
 * memory's names, never blank. Returns {cpt, flex, note}; a board with no rows (not loaded) changes nothing.
 */
export function dropMenGoneFromBoard(key, board, cpt, flex) {
  const rows = board?.rows ?? [];
  if (!rows.length) return { cpt, flex, note: "" };
  const has = new Set(rows.map((r) => String(r.id)));
  const names = rememberedNames(key);
  const lost = [];
  const keep = (s) => {
    if (!s) return null;
    if (has.has(String(s.id))) return s;
    lost.push(names.get(String(s.id)) || null);
    return null;
  };
  const nextCpt = keep(cpt);
  const nextFlex = (flex ?? []).map(keep);
  return { cpt: nextCpt, flex: nextFlex, note: goneSentence(lost, "this game") };
}

const lineupJson = new Map(); // game key -> what was last written, so a draw with nothing changed writes nothing

/** Writes the working lineup under its game when it changed since the last write. */
export function saveLineup(key, board, cpt, flex) {
  if (!key || !board) return;
  if (!(board.rows ?? []).length) return; // a board with no rows (not loaded) must not overwrite what the game remembers with an empty lineup
  setOnScreen("showdown", key);
  const names = new Map((board.rows ?? []).map((r) => [String(r.id), r.name ?? ""]));
  const before = rememberedNames(key); // a man the board does not have (for now) keeps the name he was stored with, so a later sentence can still name him
  const stored = storableShowdownLineup(cpt, flex, (id) => names.get(id) || before.get(id) || "");
  const json = JSON.stringify(stored);
  if (lineupJson.get(key) === json) return;
  lineupJson.set(key, json);
  updateMemory((m) => { slateEntry(m, "showdown", key).lineup = stored; });
}

/** The exposure table's remembered sort and filter for `key` (raw, for lineup-exposure.js cleanExpState to make safe). */
export const rememberedExp = (key) => readMemory().showdown?.games?.[key]?.exp ?? null;

/** Writes the exposure table's sort and filter under its game. */
export function saveExp(key, exp) {
  if (!key) return;
  updateMemory((m) => { slateEntry(m, "showdown", key).exp = { ...exp }; });
}
