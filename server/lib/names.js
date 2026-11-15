// Player-name matching keys, copied once from NFLDepthCharts server/refresh/clubparse.js (2026-09-13).
// nameKey("Marvin Mims Jr.") -> "marvinmims"; lastKey("Marvin Mims Jr.") -> "mims". Accents and punctuation are
// stripped and generational suffixes dropped so the same player matches across salary files and projections.
export const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

// The one table of a man whose sources spell his name differently: the folded name (lower case, single spaces, no
// punctuation or suffix) a source writes -> DraftKings' spelling, which is the target (Adam 2026-11-02: TwoGun's board
// calls Hollywood Brown "Marquise Brown"). nameKey here and normalizeName in server/twogun/normalize.js both read it.
const NAME_ALIASES = new Map([["marquise brown", "hollywood brown"]]);

/** A folded name ("marquise brown") in DraftKings' spelling ("hollywood brown"); any other name comes back unchanged. */
export function aliasedName(folded) {
  return NAME_ALIASES.get(folded) ?? folded;
}

export function nameKey(name) {
  const toks = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter(Boolean);
  while (toks.length > 1 && SUFFIX.has(toks[toks.length - 1])) toks.pop();
  return aliasedName(toks.join(" ")).replace(/ /g, "");
}
export function lastKey(name) {
  const toks = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter(Boolean);
  while (toks.length > 1 && SUFFIX.has(toks[toks.length - 1])) toks.pop();
  return toks[toks.length - 1] ?? "";
}
export function firstKey(name) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter(Boolean)[0] ?? "";
}
