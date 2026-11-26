// TwoGun mode on the classic board (merge plan package B, as corrected by the spec review of 2026-10-15).
//
// applyTwoGun() is a pure post-step over the CURRENT board: it never fetches, reads a file or the clock, and never
// writes into its input (the server caches the current board and serves both modes from it, so a flip needs no
// refetch). Pattern of server/rank/remerge.js: copy the rows, put TwoGun's figures in their base slots (projBase,
// ownBase), patch the game lines, then remergeOverrides() re-applies Adam's overrides (D28) and rebuilds value, tags,
// games and the ownership summary. Every nested object written is copied first (flags, projBySource, ownBySource,
// games, sources, stale, unmatched, recipes); row.injury is never written (ESPN keeps feeding Situations, Matchups).
//
// Rules carried here: D25 as amended (his published DraftKings points used exactly as published, a published 0
// kept); D13 (row.salary is always DraftKings'; his salary sits in row.tg.salary, flagged when different);
// D27 (his unmatched names listed under board.unmatched.bySource.twogun); D29 (his ownership is a published number;
// a player he lists none for keeps the current number or a blank); D30 as amended (the 36-hour stale banner,
// worked out from load.ageAtLockH, never from a clock read here); R82 (row.src.status is "twogun", "espn", "sleeper" or null); D40 (the recipes say where every figure came from); D52 (a player he projects loses the blend's "no projection" flags so he is not hidden or left out).
import { remergeOverrides } from "../rank/remerge.js";
import { spreadForTeam } from "../rank/games.js";
import { toNumber } from "../rank/value-core.js";
import { rowIsInactive, rowHideKind, isSidelined, uploadStampText } from "../rank/sidelined.js";
import { noLocalPaths } from "../lib/notes.js";
import { EMPTY_OVERRIDES } from "../overrides/merge.js";
import { TWOGUN_ID } from "../sources/selection-core.js";

export { TWOGUN_ID }; // the one copy lives in selection-core.js
export const TWOGUN_LABEL = "TwoGun";
// D30 as amended 2026-10-15: past 36 hours between his board stamp and the first DraftKings kickoff, every TwoGun
// figure carries the stale banner (basis: he updates Thursday and Sunday morning; the longest normal gap is ~34 h).
export const STALE_AFTER_H = 36;
// Adjustment 4 (Adam's yes, 2026-10-15): a game line is flagged when either team's implied total differs from
// ESPN's by 1.0 point or more (a half-point move shifts an implied total 0.25-0.5).
export const LINE_DIFF_MIN = 1.0;
// The blend's flags that would keep a player he projects out of the pool or hidden (multi.js noProjection, D52,
// blend.js "sidelined"); removed only where his projection is used.
const BLEND_FLAGS_CLEARED = new Set(["no projection", "thin", "sidelined"]);
// Adjustment 1: R82, the injury report's status after normStatus that means out today (sidelined.js SIDELINED, Doubtful included).
const OUT_NOW = new Set(["OUT", "INACTIVE", "IR", "DOUBTFUL", "SUSPENDED", "PUP", "NFI"]);
const INJURY_SOURCE_LABEL = { "ESPN injuries": "espn", Sleeper: "sleeper" }; // board.js row.injury.source -> row.src.status (R82)

const STATUS_WORDS = {
  Q: "QUESTIONABLE", QUESTIONABLE: "QUESTIONABLE", D: "DOUBTFUL", DOUBTFUL: "DOUBTFUL", O: "OUT", OUT: "OUT",
  INACTIVE: "INACTIVE", IR: "IR", "INJURED RESERVE": "IR", SUSP: "SUSPENDED", SUSPENDED: "SUSPENDED",
  SUSPENSION: "SUSPENDED", PUP: "PUP", "PHYSICALLY UNABLE TO PERFORM": "PUP", NFI: "NFI", "NON-FOOTBALL INJURY": "NFI",
  P: "PROBABLE", PROBABLE: "PROBABLE", "DAY-TO-DAY": "DAY-TO-DAY", ACTIVE: null, HEALTHY: null
};
/** One spelling per official status ("Q" and "Questionable" are the same); healthy or blank is null. */
export function normStatus(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().toUpperCase();
  if (!t) return null;
  return Object.prototype.hasOwnProperty.call(STATUS_WORDS, t) ? STATUS_WORDS[t] : t;
}

export const addFlag = (flags, f) => { if (!flags.includes(f)) flags.push(f); };
const removeFlags = (flags, test) => { for (let i = flags.length - 1; i >= 0; i--) if (test(flags[i])) flags.splice(i, 1); };

/** The official status he quoted on his player record ("Questionable — called PLAYING: ..."), or null. */
function quotedOnRecord(text) {
  const m = typeof text === "string" ? /^\s*([A-Za-z][A-Za-z -]*?)\s+—\s+called\b/.exec(text) : null;
  return m ? m[1] : null;
}

/** row.tg, the frozen contract shape, from his player record and/or his injury call. */
export function tgOf(player, call) {
  const callKind = call?.call === "PLAY" || call?.call === "OUT" ? call.call
    : player?.status === "PLAY" || player?.status === "OUT" ? player.status : null;
  const tg = {
    salary: toNumber(player?.salary),
    median: toNumber(player?.median),
    ceil: toNumber(player?.ceiling),
    nuke: toNumber(player?.nuke),
    p3x: toNumber(player?.p3x),
    p4x: toNumber(player?.p4x),
    ceilPer1k: toNumber(player?.ceilingPer1k),
    ownMilly: toNumber(player?.ownMilly),
    ownSmall: toNumber(player?.ownSmall),
    call: callKind,
    tag: call?.tag ?? null,
    callText: call?.text ?? player?.injury ?? null,
    official: call?.official ?? quotedOnRecord(player?.injury) ?? null,
    outAfterStamp: false,
    heldOut: null // the sentence for a man he quoted Out, called PLAY, and the feed still holds out (applyCall)
  };
  // G68: his ownership board's spelling of a man joined to the classic list as a close match; present only then, so the shape is unchanged for every other man.
  if (typeof player?.ownClose === "string" && player.ownClose) tg.ownClose = player.ownClose;
  return tg;
}

/** His line per slate game id, with ESPN's kept beside it and the 1.0-point check (adjustment 4). */
export function gameLines(currentGames, hisGames, slate) {
  const slateIdOf = new Map((slate?.games ?? []).map((g) => [`${g.away}@${g.home}`, g.id]));
  const currentById = new Map((currentGames ?? []).map((g) => [g.gameId, g]));
  const out = new Map();
  for (const hg of hisGames ?? []) {
    const id = slateIdOf.get(`${hg?.away}@${hg?.home}`);
    const total = toNumber(hg?.total);
    if (!id || total === null) continue; // no game of his here, or no line from him: ESPN's stays
    const favorite = hg.favorite ?? null;
    if (favorite && favorite !== hg.away && favorite !== hg.home) continue;
    const spreadRaw = toNumber(hg.spread); // null stays null: a total with no spread is not a pick'em (G62)
    const spreadAbs = Math.abs(spreadRaw ?? 0);
    const implied = { [hg.away]: toNumber(hg.implied?.[hg.away]), [hg.home]: toNumber(hg.implied?.[hg.home]) };
    const cur = currentById.get(id) ?? null;
    const espnImplied = { [hg.away]: toNumber(cur?.implied?.[hg.away]), [hg.home]: toNumber(cur?.implied?.[hg.home]) };
    const hasEspn = toNumber(cur?.total) !== null || espnImplied[hg.away] !== null || espnImplied[hg.home] !== null;
    const differs = [hg.away, hg.home].some((t) => implied[t] !== null && espnImplied[t] !== null && Math.abs(implied[t] - espnImplied[t]) >= LINE_DIFF_MIN - 1e-9);
    out.set(id, {
      total, favorite, spread: spreadRaw === null ? null : favorite && spreadAbs ? -spreadAbs : 0, implied, differs,
      espn: hasEspn ? { spread: toNumber(cur.spread), total: toNumber(cur.total), favorite: cur.favorite ?? null, implied: espnImplied } : null
    });
  }
  return out;
}

export function patchGame(game, line) {
  if (!line) return game;
  const flags = (game.flags ?? []).filter((f) => f !== "noLine" && f !== "lineUnknown");
  if (line.differs) flags.push("lineDiffers");
  return {
    ...game, total: line.total, spread: line.spread, favorite: line.favorite, implied: { ...line.implied },
    impliedAway: line.implied[game.away] ?? null, impliedHome: line.implied[game.home] ?? null,
    lineParsed: true, lineReason: line.favorite ? "line" : line.spread === null ? "noSpread" : "even", flags
  };
}

/** His call against today's official status (the injury report's, R82): OUT, PLAY, or ruled out after his stamp (adjustment 1). */
/** "TwoGun quoted Out and still called PLAY; ESPN's note of Tue 4:21 PM rules him out for this game." (the one copy, classic row.tg.heldOut and the Showdown projHow). */
export function ruledOutHeldWords(quoted, entryDate) {
  const when = uploadStampText(entryDate);
  return `TwoGun quoted ${quoted ?? "Out"} and still called PLAY; ESPN's note${when ? ` of ${when}` : ""} rules him out for this game.`;
}

/** The same for a game-day inactive: "TwoGun quoted Out and still called PLAY; ESPN's game-day inactives list him, so he stays out." */
export function inactiveHeldWords(quoted) {
  return `TwoGun quoted ${quoted ?? "Out"} and still called PLAY; ESPN's game-day inactives list him, so he stays out.`;
}

export function applyCall(r, src, { tg, projected, espn, inactive = false, ruledOut = false }) {
  // Source order (rank/sidelined.js): `espn` is the feed's word only for a game-day inactive (hideStatusOf), else null, because an outside
  // feed's tag alone is a flag and hides no one (step 4). DraftKings' Status column is never read
  // (Adam 12:13 AM 11-26: only salaries come from the DraftKings upload; injuries come from injury sources).
  const outNow = OUT_NOW.has(normStatus(espn));
  if (tg.call === "OUT") {
    r.status = "OUT";
    addFlag(r.flags, "injured");
    src.status = "twogun";
    return;
  }
  // He quoted this very status and still called PLAY: his call stands (Adam 2026-11-02), by the PLAY branch below. A different or
  // unquoted status means it changed after his stamp, so the injury report governs.
  const callsPastIt = !inactive && tg.call === "PLAY" && normStatus(tg.official) === normStatus(espn);
  if ((tg.call === "PLAY" || projected) && outNow && !callsPastIt) {
    // The injured flag makes remergeOverrides zero his projection (R82); a status he already quoted changed nothing after his stamp.
    addFlag(r.flags, "injured");
    if (normStatus(tg.official) !== normStatus(espn)) {
      tg.outAfterStamp = true;
      addFlag(r.flags, "outAfterStamp");
    } else if ((ruledOut || inactive) && tg.call === "PLAY") {
      // he quoted this very word and still called PLAY: the row says why the feed still holds him out (a weekday note, or today's inactives list)
      tg.heldOut = ruledOut ? ruledOutHeldWords(tg.official, r.injury?.date) : inactiveHeldWords(tg.official);
      addFlag(r.flags, "heldOut");
    }
    return;
  }
  if (tg.call === "PLAY") {
    // In TwoGun mode his call replaces whatever status the current board carries (board.js injuries step).
    r.status = null;
    removeFlags(r.flags, (f) => f === "injured");
    src.status = "twogun";
  }
}

/**
 * Adjustment 2: a status that changed after his stamp. R82: the injury report today vs his quote (tg.official). Skipped when he made
 * a call but his quote is unknown. No call and no quote means healthy at his stamp.
 * Never a change: a blank injury-report status today, or an OUT call where today's status is an out status (OUT_NOW).
 */
export function statusChanged(tg, { espn }) {
  const t = normStatus(espn);
  if (t === null) return false;
  if (tg.call === "OUT" && OUT_NOW.has(t)) return false;
  const quoteKnown = !tg.call || (tg.official !== null && tg.official !== undefined);
  return quoteKnown && t !== normStatus(tg.official);
}

/** The injury report's status on a current-board row (ESPN's, or Sleeper's when ESPN's failed; board.js keeps it in row.injury), or null. */
export const espnStatusOf = (row) => (Object.hasOwn(INJURY_SOURCE_LABEL, row.injury?.source) ? (row.injury.status ?? null) : null);

/** The word that hides a man on a row the board builder has ruled (sidelined.js injuryRuling leaves a status only for a game-day inactive or a note ruling
 *  him out of this game; an outside feed's tag alone is a flag and leaves none), else null. For applyCall. */
export const hideStatusOf = (row) => (isSidelined(row.status) ? row.status : null);

/** row.src for a figure set that is all current: the status is the injury report's where it has a word that counts (R82; a flag-only tag is no status source), else null. */
export function currentSrc(row) {
  return { proj: "current", own: "current", salary: "dk", status: espnStatusOf(row) && !row.injury.flagOnly ? INJURY_SOURCE_LABEL[row.injury.source] : null, line: "espn" };
}

/** One row in TwoGun mode: a copy, never the input (spec review 5). */
function patchRow(row, entry, { line }) {
  const r = { ...row, flags: [...(row.flags ?? [])], projBySource: { ...(row.projBySource ?? {}) }, ownBySource: { ...(row.ownBySource ?? {}) } };
  const espn = espnStatusOf(row);
  const src = currentSrc(row);
  if (line) {
    r.spread = spreadForTeam(line, row.team);
    r.total = line.total;
    r.impliedTotal = line.implied[row.team] ?? null;
    src.line = "twogun";
    if (line.differs) addFlag(r.flags, "lineDiffers");
  }
  const player = entry?.player ?? null;
  const call = entry?.call ?? null;
  if (!player && !call) {
    r.tg = null;
    r.src = src;
    return r;
  }
  const tg = tgOf(player, call);
  const proj = toNumber(player?.projection);
  if (proj !== null) r.projBySource[TWOGUN_ID] = proj;
  if (tg.ownMilly !== null) r.ownBySource[TWOGUN_ID] = tg.ownMilly;
  if (proj !== null && tg.call !== "OUT") {
    r.projBase = proj; // a published 0 is kept (D25 as amended)
    src.proj = "twogun";
    removeFlags(r.flags, (f) => BLEND_FLAGS_CLEARED.has(f) || f.startsWith("sourceFailed:"));
  }
  if (tg.ownMilly !== null && tg.call !== "OUT") {
    r.ownBase = tg.ownMilly;
    r.ownKind = "quoted";
    r.ownAnchor = { own: tg.ownMilly, source: TWOGUN_LABEL, url: null, parts: [{ own: tg.ownMilly, source: TWOGUN_LABEL, url: null }] };
    src.own = "twogun";
  }
  if (tg.salary !== null && tg.salary !== toNumber(row.salary)) addFlag(r.flags, "salaryDiffers");
  applyCall(r, src, { tg, projected: proj !== null, espn: hideStatusOf(row), inactive: rowIsInactive(row), ruledOut: rowHideKind(row) === "ruled-out" });
  if (!tg.outAfterStamp && statusChanged(tg, { espn })) addFlag(r.flags, "statusChangedAfterStamp");
  r.tg = tg;
  r.src = src;
  return r;
}

/** Adjustment 1, teammates: flagged, never re-projected; only rows carrying his projection. Adjustment 3: stale. */
export function markTeammatesAndStale(rows, stale) {
  const outTeams = new Set(rows.filter((r) => r.tg?.outAfterStamp).map((r) => r.team));
  for (const r of rows) {
    if (outTeams.has(r.team) && !r.tg?.outAfterStamp && r.src.proj === "twogun") addFlag(r.flags, "teammateOutAfterStamp");
    if (stale && Object.values(r.src).includes("twogun")) addFlag(r.flags, "twogunStale");
  }
}

/**
 * "ok", "stale", "missing" or "failed", from the loader's result (server/twogun/load.js contract). Stale (adjustment 3,
 * D30 as amended) when: the loader served an older snapshot because the newest failed (its own "stale"); his board
 * time could not be read (ageAtLockH null: never taken as fresh); he stamped it after the first kickoff (negative);
 * or it is more than 36 hours older than the first kickoff.
 */
export function twogunStatus(load) {
  if (!load || load.status === "missing") return load ? "missing" : "failed";
  if ((load.status !== "ok" && load.status !== "stale") || !load.snapshot) return "failed";
  return load.status === "stale" || ageReason(load) ? "stale" : "ok";
}

/** Why his board's age makes it stale, as a plain sentence, or null when the age is known and within 36 hours. */
export function ageReason(load) {
  const age = toNumber(load?.ageAtLockH);
  if (age === null) return "TwoGun's board time could not be read, so every TwoGun figure is marked stale.";
  if (age < 0) return `TwoGun's board is stamped after lock (${Math.abs(age)} hours after the first kickoff), so every TwoGun figure is marked stale.`;
  if (age > STALE_AFTER_H) return `TwoGun's board is ${age} hours older than the first kickoff (over ${STALE_AFTER_H}), so every TwoGun figure is marked stale.`;
  return null;
}

/**
 * board.mode.twogun.note and the card note: the loader's note (no folder paths; when the loader itself served an
 * older snapshot as "stale", its note says why) plus why his board's age makes it stale, if it does.
 */
export function twogunNote(load, status) {
  const parts = [load?.note ? noLocalPaths(load.note) : null, status === "stale" ? ageReason(load) : null].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** His games that are not on the DraftKings slate (D27: listed, never dropped silently). */
export function unmatchedGames(hisGames, slate) {
  const onSlate = new Set((slate?.games ?? []).map((g) => `${g.away}@${g.home}`));
  return (hisGames ?? []).filter((hg) => hg && !onSlate.has(`${hg.away}@${hg.home}`))
    .map((hg) => `${hg.game ?? `${hg.away}@${hg.home}`}, a game not on the DraftKings slate`);
}

/**
 * The loaded DraftKings slate's games with no game in his snapshot and not already named by the snapshot itself (meta.uncoveredGames). Adam 11-25 night: a
 * snapshot whose games differ from the loaded slate's (a Thanksgiving copy after the swap to Sunday's file, or the reverse) is never hidden; it is joined
 * man by man as always, and these games, which keep the current figures, are named on his cards (G62).
 */
export function slateGamesWithoutHim(hisGames, slate, alreadyNamed = []) {
  const his = new Set((hisGames ?? []).map((hg) => `${hg?.away}@${hg?.home}`));
  return (slate?.games ?? []).map((g) => `${g.away}@${g.home}`).filter((k) => !his.has(k) && !alreadyNamed.includes(k));
}

/** His two read-only source cards (Projections and Projected Ownership tabs); weight above 0 so neither says "(not used)". */
export function twogunCards(load, status, joined, rows, players) {
  const card = {
    id: TWOGUN_ID, label: TWOGUN_LABEL, weight: 1, enabled: true, readOnly: true,
    status: status === "ok" ? "file" : status === "stale" ? "stale" : "failed",
    fetchedAt: toNumber(load?.mtimeMs) !== null ? new Date(load.mtimeMs).toISOString() : null,
    // G62: the snapshot's own warnings (load.js warningsNote) after the loader's note, on both of his cards.
    note: [twogunNote(load, status), load?.warningsNote].filter(Boolean).join(" ") || null,
    missingPositions: [],
    unmatched: joined ? joined.unmatched.length : null
  };
  return [
    { ...card, kind: "projection", pageUpdated: load?.boardUpdated ?? null, recordCount: players.length,
      matched: joined ? joined.matchedPlayers : null },
    { ...card, kind: "ownership", note: [card.note, load?.ownershipNote].filter(Boolean).join(" ") || null, pageUpdated: load?.ownershipUpdated ?? null,
      recordCount: players.filter((p) => toNumber(p?.ownMilly) !== null).length,
      matched: rows.filter((r) => r.src?.own === "twogun").length }
  ];
}

export function recipesFor(board, status, summary, load) {
  const recipes = { ...(board.recipes ?? {}) };
  if (status === "missing" || status === "failed") {
    const why = load?.note ? ` (${noLocalPaths(load.note)})` : "";
    recipes.projection = `TwoGun mode is on, but TwoGun's board could not be used${why}; every projection below is the current blend. ${recipes.projection ?? ""}`.trim();
    recipes.ownership = `TwoGun mode is on, but TwoGun's board could not be used; every ownership number below is the current one. ${recipes.ownership ?? ""}`.trim();
    return recipes;
  }
  const staleText = status === "stale"
    ? ` ${ageReason(load) ?? "An older TwoGun snapshot is served because the newest could not be used, so every TwoGun figure is marked stale."}`
    : "";
  recipes.projection = `TwoGun mode: Proj is TwoGun's own DraftKings projection for the ${summary.covered} players he projects (board updated ${load?.boardUpdated ?? "at an unknown time"}), used exactly as he publishes it; his game lines replace ESPN's where he has one.${staleText} The other ${summary.fallback} players keep the current projection: ${recipes.projection ?? ""}`.trim();
  recipes.ownership = `TwoGun mode: Own% is TwoGun's projected ownership for a Milly Maker-size field for the ${summary.ownCovered} players he lists one for (ownership updated ${load?.ownershipUpdated ?? "at an unknown time"}); every other player keeps the current number: ${recipes.ownership ?? ""}`.trim();
  return recipes;
}

export function summaryOf(rows, status, load) {
  const covered = rows.filter((r) => r.src?.proj === "twogun").length;
  return {
    status, file: load?.file ?? null, boardUpdated: load?.boardUpdated ?? null, ownershipUpdated: load?.ownershipUpdated ?? null,
    ageAtLockH: toNumber(load?.ageAtLockH), stale: status === "stale", covered, fallback: rows.length - covered,
    ownCovered: rows.filter((r) => r.src?.own === "twogun").length,
    note: twogunNote(load, status)
  };
}

/** The board's stale list plus "twogun" (copied, never written in place). */
const staleWithTwoGun = (board) => [...new Set([...(board.stale ?? []), TWOGUN_ID])];

/** TwoGun mode with no usable snapshot: the current board, every row labelled current, marked stale (never a blank). */
function unavailableBoard(currentBoard, load, status) {
  const rows = (currentBoard.rows ?? []).map((row) => ({ ...row, tg: null, src: currentSrc(row) }));
  const summary = summaryOf(rows, status, load);
  const board = {
    ...currentBoard, rows, stale: staleWithTwoGun(currentBoard),
    sources: [...twogunCards(load, status, null, rows, []), ...(currentBoard.sources ?? [])],
    recipes: recipesFor(currentBoard, status, summary, load)
  };
  return { board, summary };
}

/**
 * currentBoard - the cached current-mode board (never written).
 * snapshot     - TwoGun's classic snapshot (load.snapshot), or null.
 * joined       - joinTwoGun(snapshot, slate) (server/twogun/join.js): { byDkId, unmatched, players, matchedPlayers, ... }.
 * overrides    - the week's overrides (proj, own, stars, notes), merged back on top of his figures (D28).
 * slate        - the loaded DraftKings slate (its games; R82).
 * load         - the loader's result (status, file, mtimeMs, boardUpdated, ownershipUpdated, ageAtLockH, note).
 * Returns { board, summary }: the TwoGun-mode board and the facts board.mode.twogun is built from.
 */
export function applyTwoGun(currentBoard, snapshot, joined, overrides, { slate, load } = {}) {
  const status = twogunStatus(load ? { ...load, snapshot } : { status: snapshot ? "ok" : "missing", snapshot, ageAtLockH: null });
  if (status === "missing" || status === "failed" || !joined) {
    return unavailableBoard(currentBoard, load, status === "missing" ? "missing" : "failed");
  }
  const lines = gameLines(currentBoard.games, snapshot.games, slate);
  const patched = (currentBoard.rows ?? []).map((row) =>
    patchRow(row, row.dkId === null || row.dkId === undefined ? null : joined.byDkId.get(String(row.dkId)), {
      line: lines.get(row.gameId) ?? null
    }));
  markTeammatesAndStale(patched, status === "stale");
  const games = (currentBoard.games ?? []).map((g) => patchGame(g, lines.get(g.gameId)));
  const typed = overrides ?? EMPTY_OVERRIDES;
  // TwoGun mode honours both revive lists; current mode only the first.
  const honoured = { ...typed, revive: [...(typed.revive ?? []), ...(typed.reviveTwoGun ?? [])] };
  const merged = remergeOverrides({ ...currentBoard, rows: patched, games }, slate ?? { games: [] }, honoured);
  // remergeOverrides drops an "overrides unreadable" note and stamps its own clock: both are put back (spec review 6b).
  for (const g of merged.games) {
    const line = lines.get(g.gameId);
    if (line) g.espnLine = line.espn; // two sources disagree: keep both (router Data rules)
  }
  const summary = summaryOf(merged.rows, status, load);
  const without = slateGamesWithoutHim(snapshot.games, slate, Array.isArray(snapshot.meta?.uncoveredGames) ? snapshot.meta.uncoveredGames : []);
  const cardLoad = without.length
    ? { ...load, warningsNote: [load?.warningsNote, `TwoGun's copy has no figures for ${without.join(", ")} on the loaded slate; those games keep the current figures.`].filter(Boolean).join(" ") }
    : load;
  const board = {
    ...merged,
    generatedAt: currentBoard.generatedAt,
    notes: [...(currentBoard.notes ?? [])],
    tabNotes: Object.fromEntries(Object.entries(currentBoard.tabNotes ?? {}).map(([k, v]) => [k, [...(v ?? [])]])),
    stale: status === "stale" ? staleWithTwoGun(currentBoard) : [...(currentBoard.stale ?? [])],
    sources: [...twogunCards(cardLoad, status, joined, merged.rows, snapshot.players ?? []), ...(currentBoard.sources ?? [])],
    unmatched: {
      ...(currentBoard.unmatched ?? {}),
      bySource: { ...(currentBoard.unmatched?.bySource ?? {}), [TWOGUN_ID]: [...joined.unmatched, ...unmatchedGames(snapshot.games, slate)] }
    },
    recipes: recipesFor(currentBoard, status, summary, load)
  };
  return { board, summary };
}
