// The classic page's filters and sort, remembered per slate (optimizer standard A9, round 5), moved out of app.js so it can be tested. The slate is the season, week and the main slate or a second slate
// (memory.js classicMemoryKey). When the slate on screen is not the one drawn last, its remembered filters and sort replace the page's (a team or game that is not on the slate goes, a sort on a column that is
// gone falls back to Proj, high to low; a slate with nothing remembered starts from the defaults); otherwise a change to either is written. The sync is subscribed to the store before the screen's own draw,
// so the screen draws what was remembered.
import { readMemory, updateMemory, slateEntry, classicMemoryKey, cleanClassicFilters, storableClassicFilters, cleanSort } from "./memory.js";

/** The columns a remembered sort may name: the pool's (lineup-pool.js), which every classic list sorts by. */
export const SORT_COLUMNS = ["star", "player", "pos", "salary", "proj", "own", "value", "tgMed", "tgNuke", "tgP3x", "tgP4x", "tags"];

/** The teams of a list of games, sorted. */
export function uniqueTeams(games) {
  const teams = new Set();
  for (const g of games ?? []) {
    if (g.away) teams.add(g.away);
    if (g.home) teams.add(g.home);
  }
  return [...teams].sort();
}

/**
 * Makes the sync the store calls on every change. `afterRestore(board)` redraws the filter bar from the restored filters; the rest are state.js's own (`store`, `activeSlate`, `activeSlateGames`,
 * `defaultFilters`, `sortForBoard`, `defaultSort`). Returns the function to subscribe, which also answers whether it restored a slate (for tests).
 */
export function createViewMemory({ store, activeSlate, activeSlateGames, defaultFilters, sortForBoard, defaultSort, afterRestore = () => {} }) {
  let memoryKey = null;
  let memoryJson = "";
  return function syncClassicMemory() {
    const { board } = store.get();
    if (!board) return false;
    const key = classicMemoryKey(board, activeSlate(board)?.key ?? "main");
    if (key !== memoryKey) {
      memoryKey = key;
      const entry = readMemory().classic?.slates?.[key] ?? {};
      const games = activeSlateGames(board);
      const filters = cleanClassicFilters(entry.filters, { teamsOn: new Set(uniqueTeams(games)), gameIds: new Set(games.map((g) => g.id)), defaults: defaultFilters() });
      const sort = sortForBoard(cleanSort(entry.sort, SORT_COLUMNS, defaultSort), board);
      memoryJson = JSON.stringify([storableClassicFilters(filters), sort]);
      store.set({ filters, sort }); // draws; this listener sees the same key again and finds nothing to do
      afterRestore(board);
      return true;
    }
    const { filters, sort } = store.get();
    const now = JSON.stringify([storableClassicFilters(filters), sort]);
    if (now === memoryJson) return false;
    memoryJson = now;
    updateMemory((m) => Object.assign(slateEntry(m, "classic", key), { filters: storableClassicFilters(filters), sort }));
    return false;
  };
}
