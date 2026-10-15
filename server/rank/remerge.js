// Overrides-only recompute: PROJECT.md's /api/overrides routes must change the merge step alone and never
// refetch a source. Everything upstream of the merge (projBase/ownBase, the game context, the findings tags) is
// reconstructed from the LAST board built rather than re-run, so an override edit costs nothing more than a JSON
// write plus a handful of in-memory array passes.
// Pure (no node modules, no file reads), so the public site can run the same remerge in the visitor's browser
// (DECISIONS.md D71).
import { mergeOverridesIntoRows } from "../overrides/merge.js";
import { computeValue } from "./value-core.js";
import { computeTags } from "./tags-core.js";
import { buildGames } from "./games.js";
import { summariseOwnership } from "./ownership-summary.js";

export function reconstructBaseRows(rows) {
  return rows.map((r) => ({ ...r, proj: r.projBase, own: r.ownBase }));
}

// Rebuilt from row.findingsTags, the UNFILTERED researched tags board.js keeps on every row, so a label that
// computeTags dropped on the base numbers (D42 value under 3.0) returns when an
// override no longer contradicts it. A board built before that key existed falls back to the surviving row.tags.
export function reconstructFindingsTags(rows) {
  const map = new Map();
  for (const r of rows) {
    const findingsTags = r.findingsTags ?? (r.tags ?? []).filter((t) => t.kind === "findings");
    if (findingsTags.length) map.set(r.id, findingsTags);
  }
  return map;
}

export function reconstructGamesById(games) {
  const map = new Map();
  for (const g of games ?? []) {
    map.set(g.gameId, {
      total: g.total,
      spread: g.spread,
      favorite: g.favorite,
      implied: g.implied,
      lineParsed: g.lineParsed,
      lineReason: g.lineReason,
      indoor: g.indoor,
      venue: g.venue,
      weather: g.weather,
      flags: g.flags
    });
  }
  return map;
}

/**
 * The previous board with `overrides` merged in again: value, tags, games and the ownership summary rebuilt.
 * previousBoard - the last /api/board shape built for this slate.
 * full          - the loaded slate (its games array, D13).
 * overrides     - the week's overrides object (proj, own, stars, notes).
 * (No rank settings any more: the file is retired, Adam 2026-10-15, Lev measure to be redesigned.)
 */
export function remergeOverrides(previousBoard, full, overrides) {
  const baseRows = reconstructBaseRows(previousBoard.rows);
  const rows = mergeOverridesIntoRows(baseRows, overrides);
  // No lev on the rows: Adam 2026-10-15, Lev measure to be redesigned.
  const valued = computeValue(rows);
  for (const row of rows) row.value = valued.get(row.id)?.value ?? null;
  const findingsTags = reconstructFindingsTags(previousBoard.rows);
  const tagsById = computeTags(rows, { findingsTags });
  for (const row of rows) row.tags = tagsById.get(row.id) ?? [];
  const gamesById = reconstructGamesById(previousBoard.games);
  const games = buildGames(full, rows, { gamesById });
  // An override can change a player's ownership, so the slate's ownership summary has to be rebuilt from the
  // merged rows with the same loop the board uses; leaving the previous board's summary in place would show
  // Adam counts that no longer match the numbers on the screen.
  const ownership = summariseOwnership(rows);
  // Every caller gets here straight after reading AND writing the overrides file successfully, so an "overrides
  // unreadable" note carried on the previous board no longer describes anything. board.js files that note under
  // tabNotes.ownership and tabNotes.favorites and repeats it in notes; every copy is dropped, and every other note
  // (the scoring fallback, the source settings note that board.js files under both source tabs) is kept. A board
  // from before tabNotes.favorites existed filed the overrides note under ownership alone, never under projections.
  const prevTabNotes = previousBoard.tabNotes ?? {};
  const onProjections = new Set(prevTabNotes.projections ?? []);
  const staleOverrideNotes = new Set([
    ...(prevTabNotes.favorites ?? []),
    ...(prevTabNotes.ownership ?? []).filter((n) => !onProjections.has(n))
  ]);
  const notes = (previousBoard.notes ?? []).filter((n) => !staleOverrideNotes.has(n));
  const tabNotes = {
    projections: [...(prevTabNotes.projections ?? [])],
    ownership: (prevTabNotes.ownership ?? []).filter((n) => !staleOverrideNotes.has(n)),
    favorites: []
  };
  return { ...previousBoard, generatedAt: new Date().toISOString(), rows, games, ownership, notes, tabNotes };
}
