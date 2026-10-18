// One row per game for the game strip above the main table (PROJECT.md D26): kickoff, the total, each team's
// implied total, and a popularity gauge - the sum of the ownership numbers of that game's slate players (defenses
// excluded), with a rank. Only real numbers count: one a named source published, or one Adam typed in as an override (D28). A
// game with no such number has a null sum and a null rank, never a zero, and when no player on the slate has
// one every game's popularity is null. It is a proxy for how heavily a game will be stacked.
//
// No date, kickoff or time-zone arithmetic happens here (D30): the slate's own kickoffEt/kickoffUtc strings are
// passed through untouched and games are grouped by gameId alone.
import { toNumber } from "./value-core.js"; // pure: the public site runs the board maths in a browser (D71)

/**
 * The spread from one team's point of view: negative when that team is favoured, positive when it is the
 * underdog, 0 on a pick'em. The context record carries the favourite's (negative) spread plus which team that
 * is, so the sign has to be chosen per row rather than copied. The board and the TwoGun overlay share this one.
 */
export function spreadForTeam(game, team) {
  const spread = toNumber(game?.spread);
  if (spread === null) return null;
  const favorite = game?.favorite ?? null;
  if (!favorite) return spread; // pick'em: the odds helper reports 0 with no favourite
  if (favorite === team) return -Math.abs(spread);
  return Math.abs(spread);
}

/**
 * slate     - the parsed slate (its `games` array is the list of games, D13).
 * rows      - board rows carrying { gameId, own }.
 * gamesById - Map gameId -> context game record (server/sources/context/index.js loadContext()).
 * Returns the games in slate order, each with every key present.
 */
export function buildGames(slate, rows, { gamesById = new Map() } = {}) {
  const ownByGame = new Map();
  for (const row of rows ?? []) {
    // toNumber, never Number(): a blank ownership is null, and Number(null) is 0, which would hand a game with
    // no ownership number at all a sum of 0 and a place in the ranking.
    const own = toNumber(row.own);
    if (!row.gameId || own === null) continue;
    // Defenses are left out (Adam, 2026-10-10): the gauge measures how heavily the game's offensive players are
    // owned, and a DST's percentage would only inflate it.
    if (row.pos === "DST") continue;
    ownByGame.set(row.gameId, (ownByGame.get(row.gameId) ?? 0) + own);
  }

  const games = (slate?.games ?? []).map((g) => {
    const ctx = gamesById?.get?.(g.id) ?? null;
    const implied = ctx?.implied ?? {};
    const impliedAway = toNumber(implied[g.away]);
    const impliedHome = toNumber(implied[g.home]);
    // loadContext() seeds a row for every slate game and carries its own flags (e.g. "noLine"); those are kept
    // and "lineUnknown" is added whenever the line could not be read or produced no implied totals.
    const flags = [...(ctx?.flags ?? [])];
    if (!ctx) flags.push("noContext");
    const lineUnknown =
      !ctx ||
      ctx.lineParsed === false ||
      ctx.lineReason === "favoriteNotInGame" ||
      impliedAway === null ||
      impliedHome === null;
    if (lineUnknown && !flags.includes("lineUnknown")) flags.push("lineUnknown");
    const ownSum = ownByGame.has(g.id) ? ownByGame.get(g.id) : null;
    return {
      gameId: g.id,
      away: g.away,
      home: g.home,
      kickoffEt: g.kickoffEt ?? null,
      kickoffUtc: g.kickoffUtc ?? null,
      total: toNumber(ctx?.total),
      spread: toNumber(ctx?.spread),
      favorite: ctx?.favorite ?? null,
      implied: { [g.away]: impliedAway, [g.home]: impliedHome },
      impliedAway,
      impliedHome,
      lineParsed: ctx?.lineParsed ?? null,
      lineReason: ctx?.lineReason ?? null,
      // The stadium file's roof flag (carried on the weather record) is the one to trust; ESPN's own venue flag
      // (`espnIndoor`) is the fallback.
      indoor: ctx?.indoor ?? ctx?.weather?.indoor ?? ctx?.espnIndoor ?? null,
      venue: ctx?.venue ?? null,
      weather: ctx?.weather ?? null,
      popularity: { ownSum, rank: null },
      flags
    };
  });

  const ranked = games.filter((g) => g.popularity.ownSum !== null).sort((a, b) => b.popularity.ownSum - a.popularity.ownSum);
  // Equal sums share a rank and the next one skips (1, 2, 2, 4); sums within 1e-9 count as equal so float noise
  // never splits a tie.
  ranked.forEach((game, i) => {
    const prev = ranked[i - 1];
    game.popularity.rank = prev && Math.abs(prev.popularity.ownSum - game.popularity.ownSum) < 1e-9 ? prev.popularity.rank : i + 1;
  });
  return games;
}
