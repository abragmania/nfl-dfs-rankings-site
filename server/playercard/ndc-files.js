// The two published NFLDepthCharts files the player card reads (D6, amended 2026-10-18): where they live, which club
// code they use, and the boundary check that refuses a file whose shape changed. Pure: the app's server and the
// public site's browser both import this. Nothing is ever written to NFLDepthCharts.
export const NDC_SITE = "https://abragmania.github.io/nfl-depth-charts-site/";
export const NDC_API = `${NDC_SITE}api`;

// Their file names use the nflverse club codes: the same 32 as DraftKings except the Rams (DraftKings LAR, theirs LA).
// tests/playercard-resolve.test.mjs compares this table with data/static/teams.json.
const NDC_OF_DK = Object.freeze({ LAR: "LA" });
const NDC_CODES = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]);

/** The club code NFLDepthCharts uses for a DraftKings team code, or null when it is not one of the 32 clubs. */
export function ndcAbbr(dkAbbr) {
  const up = String(dkAbbr ?? "").trim().toUpperCase();
  const code = NDC_OF_DK[up] ?? up;
  return NDC_CODES.has(code) ? code : null;
}

export const teamFileUrl = (abbr) => `${NDC_API}/team/${abbr}.json`;
export const gamelogUrl = (abbr) => `${NDC_API}/gamelog/${abbr}.json`;
/** Their page for one player (their route is #/team/<ABBR>/player/<playerKey>). */
export const playerPageUrl = (abbr, playerKey) => `${NDC_SITE}#/team/${abbr}/player/${encodeURIComponent(playerKey)}`;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Why a downloaded team file cannot be trusted, as a sentence, or null when it is fine. `season` is this app's own season (D4). */
export function teamFileProblem(data, { abbr, season }) {
  if (!isObj(data)) return "the team file is not a JSON object";
  if (data.abbr !== abbr) return `the team file is for ${data.abbr ?? "no club"}, not ${abbr}`;
  if (data.season !== season) return `the team file is for season ${data.season ?? "unknown"}, not ${season}`;
  if (!isObj(data.units) || !Array.isArray(data.units.OFF) || !Array.isArray(data.units.DEF)) return "the team file has no OFF and DEF depth-chart units";
  const bad = (p) => !isObj(p) || ["playerKey", "name", "position"].some((k) => typeof p[k] !== "string" || p[k].trim() === "");
  for (const unit of ["OFF", "DEF"]) {
    for (const slot of data.units[unit]) {
      if (!isObj(slot) || !Array.isArray(slot.players)) return `a ${unit} slot in the team file has no players list`;
      if (slot.players.some(bad)) return `a player in a ${unit} slot of the team file has no playerKey, name or position`;
    }
  }
  if (data.unlisted !== undefined && !isObj(data.unlisted)) return "the team file's unlisted block is not an object";
  for (const unit of Object.values(data.unlisted ?? {})) {
    if (!isObj(unit)) return "an unlisted unit in the team file is not an object";
    for (const band of Object.values(unit)) {
      if (!Array.isArray(band)) return "an unlisted band in the team file is not a list";
      if (band.some(bad)) return "an unlisted player in the team file has no playerKey, name or position";
    }
  }
  if (typeof data.compiledAt !== "string") return "the team file carries no compiledAt time";
  return null;
}

// The box-score keys the card reads. An offensive-looking key outside this list means the file was renamed under us, and a
// renamed stat would score as 0, so the file is refused (def_* and any other key pass; the card never reads them).
export const KNOWN_STAT_KEYS = Object.freeze([
  "completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions", "carries", "rushing_yards", "rushing_tds",
  "targets", "receptions", "receiving_yards", "receiving_tds", "fumbles_lost_total",
]);
const OFFENSIVE_KEY = /^(?:(?:passing|rushing|receiving|fumbles)_.*|receptions|targets|carries|completions|attempts)$/;

function entryProblem(e, who) {
  if (!isObj(e)) return `a game-log entry for ${who} is not an object`;
  if (!Number.isInteger(e.week)) return `a game-log entry for ${who} has no whole-number week`;
  if (e.stats === null || e.stats === undefined) return null;
  if (!isObj(e.stats)) return `the stats of week ${e.week} for ${who} are not an object`;
  for (const [k, v] of Object.entries(e.stats)) {
    if (typeof v !== "number" || !Number.isFinite(v)) return `the stat ${k} of week ${e.week} for ${who} is not a number`;
    if (OFFENSIVE_KEY.test(k) && !KNOWN_STAT_KEYS.includes(k)) return `the game log has a stat (${k}) this app does not know`;
  }
  return null;
}

/** Why a downloaded game-log file cannot be trusted, as a sentence, or null when it is fine. */
export function gamelogProblem(data, { abbr, season }) {
  if (!isObj(data)) return "the game-log file is not a JSON object";
  if (data.abbr !== abbr) return `the game-log file is for ${data.abbr ?? "no club"}, not ${abbr}`;
  if (data.season !== season) return `the game-log file is for season ${data.season ?? "unknown"}, not ${season}`;
  if (!isObj(data.players)) return "the game-log file has no players block";
  for (const [key, entries] of Object.entries(data.players)) {
    if (!Array.isArray(entries)) return `the game-log entries for ${key} are not a list`;
    for (const e of entries) {
      const why = entryProblem(e, key);
      if (why) return why;
    }
  }
  if (typeof data.compiledAt !== "string") return "the game-log file carries no compiledAt time";
  return null;
}
