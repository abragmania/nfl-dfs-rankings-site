// Builds the player-card answer from one DraftKings player and his club's two NFLDepthCharts files. Pure: the app's
// server (routes.js) and the public site's browser (site-src/api.js) run this same code, so the card cannot differ
// between them. Every figure comes from a named file; a missing one stays null (never 0) and the card says so.
import { positionGroup, resolvePlayer, notFound } from "./resolve.js";
import { ndcAbbr, teamFileUrl, gamelogUrl, playerPageUrl } from "./ndc-files.js";
import { dkGamePoints } from "./dk-actual.js";

// The stat-column family of the game log: a tight end reads like a receiver.
const FAMILY = Object.freeze({ QB: "QB", RB: "RB", WR: "WR_TE", TE: "WR_TE" });

/** The identity fields the card is built from: a slate or board row's id, name, team and position, nothing else. */
export function identityOf(row) {
  return { id: String(row.id), name: String(row.name ?? ""), team: String(row.team ?? ""), pos: String(row.pos ?? "") };
}

/** Answers that need no download: a defense, a position NFLDepthCharts has no page for, an unknown club. Else null. */
export function precheck(row) {
  if (String(row.pos ?? "").toUpperCase() === "DST") return notFound("DEFENSE");
  if (!positionGroup(row.pos)) return notFound("UNSUPPORTED_POSITION");
  if (!ndcAbbr(row.team)) return notFound("UNKNOWN_TEAM");
  return null;
}

// Headshots load from ESPN's image host only, over https (the one outside image host the card allows).
function safeHeadshot(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && u.hostname === "a.espncdn.com" ? u.href : null;
  } catch {
    return null;
  }
}

const numOrNull = (v) => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const strOrNull = (v) => (typeof v === "string" && v.trim() !== "" ? v : null);
const jerseyText = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : strOrNull(v));

// Their snap share is a 0-1 fraction on some files and a percent on others; shown as a whole percent.
// Copied from NFLDepthCharts public/js/panel.js snapSharePercent (read-only copy, D6 amended 2026-10-18).
function snapSharePercent(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Math.max(0, Math.min(100, Math.round(Number(v) <= 1 ? Number(v) * 100 : Number(v))));
}

function bioOf(b) {
  const bio = b && typeof b === "object" ? b : {};
  const d = bio.draft && typeof bio.draft === "object" ? bio.draft : null;
  return {
    heightIn: numOrNull(bio.height),
    weight: numOrNull(bio.weight),
    age: numOrNull(bio.age),
    college: strOrNull(bio.college),
    collegeNote: strOrNull(bio.collegeNote),
    exp: bio.exp === undefined || bio.exp === null ? null : String(bio.exp),
    draft: d && numOrNull(d.year) !== null ? { year: numOrNull(d.year), round: numOrNull(d.round), pick: numOrNull(d.pick) } : null,
  };
}

function ratingOf(r) {
  if (!r || typeof r !== "object" || numOrNull(r.current) === null) return null;
  return {
    current: numOrNull(r.current),
    posRank: numOrNull(r.posRank),
    posCount: numOrNull(r.posCount),
    maddenPos: strOrNull(r.maddenPos),
    iteration: strOrNull(r.iteration),
  };
}

/** One game-log entry in the shape the card prints. `dk` is null for a game with no usable box score. */
export function gameEntryOf(entry) {
  const e = entry && typeof entry === "object" ? entry : {}; // a null entry has no week and is dropped by gameLogOf
  const played = e.played !== false;
  const withTeam = strOrNull(e.withTeam);
  const raw = e.stats && typeof e.stats === "object" ? e.stats : null;
  // A game played for another club carries an empty stats object in this club's file: that is "not on file", not a 0.
  const usable = played && raw !== null && !(withTeam && Object.keys(raw).length === 0);
  return {
    week: numOrNull(e.week),
    opponent: strOrNull(e.opponent),
    away: Boolean(e.away),
    played,
    snapPct: numOrNull(e.snapPct),
    withTeam,
    stats: usable ? raw : null,
    dk: usable ? dkGamePoints(raw) : null,
  };
}

/** The game log block for one player: entries newest first, the family, and the totals row's figures. */
export function gameLogOf(gamelog, playerKey, family, snapShare) {
  const list = Array.isArray(gamelog.players[playerKey]) ? gamelog.players[playerKey] : [];
  const entries = list.map(gameEntryOf).filter((g) => g.week !== null).sort((a, b) => b.week - a.week);
  const played = entries.filter((g) => g.played);
  const withDk = played.filter((g) => g.dk !== null);
  return {
    season: gamelog.season,
    club: strOrNull(gamelog.team) ?? gamelog.abbr,
    family,
    entries,
    totals: {
      games: played.length,
      dkGames: withDk.length,
      dk: withDk.length ? withDk.reduce((sum, g) => sum + g.dk, 0) : null,
      snapPct: snapSharePercent(snapShare),
    },
  };
}

const fileMeta = (file, url) => ({ url, asOf: file.data.compiledAt, dataAsOf: strOrNull(file.data.dataAsOf), fetchedAt: file.fetchedAt, stale: Boolean(file.stale) });

/**
 * The card for one player. `row` = {id, name, team, pos}; `files` = {team: {data, fetchedAt, stale}, gamelog:
 * {data, fetchedAt, stale} | null, gamelogError: string | null}, the validated downloads of his club. Answers
 * {found:true, player, gameLog, gameLogMissing, source} or {found:false, reason, message, source}.
 */
export function buildCard(row, files) {
  const who = identityOf(row);
  const abbr = ndcAbbr(who.team);
  const early = precheck(who);
  if (early) return early;
  const source = { name: "NFLDepthCharts", teamFile: fileMeta(files.team, teamFileUrl(abbr)), gamelog: files.gamelog ? fileMeta(files.gamelog, gamelogUrl(abbr)) : null };
  const hit = resolvePlayer(who, files.team.data);
  if (!hit.found) return { ...hit, source };
  const p = hit.player;
  const family = FAMILY[positionGroup(who.pos)];
  const gameLog = files.gamelog ? gameLogOf(files.gamelog.data, p.playerKey, family, p.snapShare) : null;
  return {
    found: true,
    player: {
      id: who.id,
      name: who.name,
      team: who.team,
      pos: who.pos,
      ndcTeam: abbr,
      playerKey: p.playerKey,
      ndcName: p.name,
      number: jerseyText(p.number),
      position: strOrNull(p.position),
      headshot: safeHeadshot(p.headshot),
      bio: bioOf(p.bio),
      rating: ratingOf(p.rating),
      rosterDesignation: strOrNull(p.rosterDesignation),
      matchTier: hit.tier,
    },
    gameLog,
    gameLogMissing: gameLog ? null : (files.gamelogError ?? "The game-log file could not be read."),
    source: { ...source, link: playerPageUrl(abbr, p.playerKey) },
  };
}
