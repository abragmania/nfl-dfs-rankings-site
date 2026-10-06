// Adapts whatever /api/board returns onto the canonical shape the renderers are built against
// (PROJECT.md Part 4). This always runs — it never sniffs the overall shape of `raw` and decides to
// skip itself — so the dev fixture (public/dev/board-sample.json) and the live server's response are
// normalized by exactly the same code path. Every per-field mapping falls back through the possible
// source key names, which keeps the function idempotent: running it twice (or handing it something
// that already went through it once) produces the same result, since each fallback chain checks for
// its own already-normalized value first.
//
// No date/time parsing happens here (D30): kickoffEt/kickoffUtc strings are passed through untouched.

function mapRoof(g) {
  if (g.roof === "indoor" || g.roof === "outdoor" || g.roof === "unknown") return g.roof;
  if (g.indoor === true) return "indoor";
  if (g.indoor === false) return "outdoor";
  return "unknown";
}

function normalizeGame(g) {
  const away = g.away;
  const home = g.home;
  return {
    ...g,
    id: g.id ?? g.gameId,
    away,
    home,
    kickoffEt: g.kickoffEt ?? null,
    kickoffUtc: g.kickoffUtc ?? null,
    venue: g.venue ?? null,
    lineParsed: g.lineParsed ?? null,
    lineReason: g.lineReason ?? null,
    total: g.total ?? null,
    spread: g.spread ?? null,
    favorite: g.favorite ?? null,
    impliedTotal: {
      away: g.impliedTotal?.away ?? g.impliedAway ?? g.implied?.[away] ?? null,
      home: g.impliedTotal?.home ?? g.impliedHome ?? g.implied?.[home] ?? null,
    },
    roof: mapRoof(g),
    weather: g.weather
      ? { tempF: g.weather.tempF ?? null, windMph: g.weather.windMph ?? null, rainChance: g.weather.rainChance ?? g.weather.precipPct ?? null }
      : null,
    flags: g.flags ?? [],
    // Null, never 0, when no player in the game has a real ownership number: the strip then hides the bar.
    popularity: { rank: g.popularity?.rank ?? null, value: g.popularity?.ownSum ?? g.popularity?.value ?? null },
  };
}

function normalizeSource(s, unmatchedBySource) {
  return {
    ...s,
    matchedCount: s.matchedCount ?? s.matched ?? null,
    unmatchedCount: s.unmatchedCount ?? s.unmatched ?? null,
    unmatchedNames: s.unmatchedNames ?? unmatchedBySource?.[s.id] ?? [],
  };
}

export function normalizeBoard(raw) {
  if (!raw || !raw.ok) return raw;

  const unmatchedBySource = raw.unmatched?.bySource ?? {};
  // The live server's slate.games is a plain count (the actual per-game array lives at the top level,
  // board.games); the dev fixture instead nests the array straight under slate.games. Prefer an array
  // wherever one is found so both shapes normalize onto the same slate.games array of game objects.
  const rawGames = Array.isArray(raw.slate?.games) ? raw.slate.games : raw.games ?? [];
  return {
    ...raw,
    slate: { ...raw.slate, games: rawGames.map(normalizeGame) },
    sources: (raw.sources ?? []).map((s) => normalizeSource(s, unmatchedBySource)),
    // Board responses do not carry warnings (only GET /api/slate does); app.js fills this in after a
    // separate slate call. Default to whatever the caller already attached (or empty) so this function
    // stays idempotent if warnings are already present.
    warnings: raw.warnings ?? [],
  };
}
