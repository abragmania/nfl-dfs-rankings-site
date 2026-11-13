// Who is not expected to play. Pure (no node modules), so the Optimizer's engine (server/lineup/multi.js and
// dk-entries.js) can also run in a browser on the public site (DECISIONS.md D69; tools/publish.mjs copies the engine).
// value.js re-exports both functions, so every other caller is unchanged.

// Not expected to play (R82). "Questionable" is deliberately absent.
const SIDELINED = new Set([
  "OUT", "O", "INACTIVE", "IR", "INJURED RESERVE", "DOUBTFUL", "D",
  "SUSPENDED", "SUSP", "SUSPENSION", "PUP", "PHYSICALLY UNABLE TO PERFORM", "NFI", "NON-FOOTBALL INJURY"
]);

/** True when a status string means the player is not expected to play. Null or blank is never sidelined. */
export function isSidelined(status) {
  if (status === null || status === undefined) return false;
  return SIDELINED.has(String(status).trim().toUpperCase());
}

export function injuryReportState(card) {
  if (!card) return "missing";
  const status = String(card.status ?? "").trim().toLowerCase();
  const hasRecords = Number(card.recordCount) > 0;
  if (!hasRecords) return "missing";
  if (status === "stale") return "stale";
  if (status === "live" || status === "ok") return "ok";
  return "missing";
}

/** R82, G68: the injury report is judged per feed. `source` is the lead feed (ESPN while its live or saved entries exist, else Sleeper) and `state` that feed's own
 *  state; `parts` keeps both feeds' states, because ESPN's saved entries stand until ESPN is read again and Sleeper fills only the men ESPN has no word on
 *  (the board does the per-man merge). `ages`: { espn, sleeper } age sentences of a saved copy, carried for the note. */
export function pickInjuryReport(espnState, sleeperState, ages = {}) {
  const parts = { espn: espnState ?? "missing", sleeper: sleeperState ?? "missing" };
  const ageFor = (which) => (typeof ages?.[which] === "string" && ages[which] ? { [`${which}Age`]: ages[which] } : {});
  if (espnState === "ok") return { state: "ok", source: "ESPN injuries", parts, ...(sleeperState === "stale" ? ageFor("sleeper") : {}) };
  if (espnState === "stale") return { state: "stale", source: "ESPN injuries", parts, ...ageFor("espn"), ...ageFor("sleeper") };
  if (sleeperState === "ok") return { state: "ok", source: "Sleeper", parts };
  if (sleeperState === "stale") return { state: "stale", source: "Sleeper", parts, ...ageFor("sleeper") };
  return { state: "missing", source: null, parts };
}

// The source order (step 4): Sleeper's entries carry no date, so no game-day inactive can be read from them and its tags hide no one.
const SLEEPER_FLAG_NOTE = " Game-day inactives cannot be read; Sleeper's tags are flags only.";

export function injuryReportNote({ state, source, parts = null, espnAge = null, sleeperAge = null }) {
  if (state === "missing") return "ESPN injury report and the Sleeper backup unavailable: injury status unknown, so no one is shown as healthy.";
  if (source === "Sleeper") {
    return (state === "ok"
      ? "ESPN injury report unavailable: injury statuses are from Sleeper."
      : `ESPN injury report unavailable: injury statuses are from a saved Sleeper copy${sleeperAge ? ` (${sleeperAge})` : ""} and may be out of date.`) + SLEEPER_FLAG_NOTE;
  }
  // G68: ESPN's saved entries stand (with when they were saved) until ESPN is read again; Sleeper's part is named on its own, a saved Sleeper copy even beside a live ESPN.
  const sleeper = parts?.sleeper === "ok" ? "Sleeper fills only the men ESPN has no word on" : parts?.sleeper === "stale" ? `Sleeper fills only the men ESPN has no word on (from a saved Sleeper copy${sleeperAge ? `, ${sleeperAge}` : ""})` : null;
  if (state !== "stale") return parts?.sleeper === "stale" ? `${sleeper}; its tags are flags only.` : null;
  const espn = `ESPN injury report is a saved copy${espnAge ? ` (${espnAge})` : ""} because the live fetch failed: injury statuses may be out of date.`;
  return sleeper ? `${espn} ${sleeper}; its tags are flags only.` : espn;
}

/** G68, D45: Sleeper's sidelined word on a man ESPN holds a record on, when it differs from ESPN's word, as row.injury.otherFeed ({ source: "Sleeper", status });
 *  else null. Both words are kept: ESPN's stands on the row, Sleeper's is a flag only and never hides. Pure. */
export function otherFeedOf(espnWord, sleeperWord) {
  const s = typeof sleeperWord === "string" ? sleeperWord.trim() : "";
  if (!s || !isSidelined(s)) return null;
  if (String(espnWord ?? "").trim().toUpperCase() === s.toUpperCase()) return null;
  return { source: "Sleeper", status: s };
}

/** G68: the injury note's line naming each man the two feeds disagree on, e.g. "Sleeper disagrees: Jared Goff Out (ESPN saved copy: Questionable)."; null when none.
 *  `conflicts`: [{ name, sleeper, espn }] (espn null when ESPN's record carries no word); `espnStale`: ESPN's part is its saved copy. Pure. */
export function feedConflictNote(conflicts, espnStale) {
  if (!conflicts?.length) return null;
  const feed = espnStale ? "ESPN saved copy" : "ESPN";
  return `Sleeper disagrees: ${conflicts.map((c) => `${c.name} ${c.sleeper} (${feed}: ${c.espn ?? "no designation"})`).join(", ")}. Sleeper's word is a flag only; ESPN's stands.`;
}

export function entriesInjuryProblem(report) {
  const state = report?.state;
  if (state === "ok" && report.source === "Sleeper") {
    return { warning: "Injury status comes from Sleeper, whose tags are flags only (it dates no game-day inactive), so a man ruled out would not show as sidelined; check the lineup's players before you submit." };
  }
  if (state === "ok") return null;
  if (state === "stale") {
    const from = report.source === "Sleeper" ? "Sleeper" : "ESPN";
    return { warning: `Injury status comes from a saved ${from} copy because the live fetch failed, so a player ruled out since then would not show as sidelined.${from === "Sleeper" ? " Its tags are flags only." : ""}` };
  }
  if (state === "missing") {
    return { error: "Injury status could not be checked: no injury report is available (ESPN's and the Sleeper backup both failed), so nobody can be confirmed healthy." };
  }
  return { error: "Injury status could not be checked: the board does not say whether it has an injury report." };
}

// ---- Who is out: the source order (Adam 2026-11-12; PROJECT.md D45 as amended) ----
// 1. Adam's own In / Out. 2. DraftKings' own Status column (row.salaryStatus) and the game-day inactives may hide a man.
// 3. TwoGun sets the number; his OUT call counts where his numbers are in use. 4. An outside feed's tag alone (ESPN, the Sleeper
// backup) is only a flag: row.injury.flagOnly, never a status, a zero or a hide. 5. The 11-02 outAfterStamp path hides only what rowIsInactive says: a game-day inactive or a weekday
// "ruled out" (isRuledOutForGame, newer than DraftKings' file).
// No imports: the browser loads this file as it is.
const ESPN_FEED = "ESPN injuries";
const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** The Eastern calendar day ("2026-11-12") of an ISO instant, or null when it does not read. The NFL's game day (the DraftKings kickoff is the source). */
export function etDay(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(ET_DAY.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** A game-day inactive (the one copy; hide decision and self-check): an ESPN Out (or Inactive) whose comment says inactive and whose entry
 *  is dated within INACTIVE_WINDOW_MS before the DraftKings kickoff. An old "was inactive for Week 9" note, a Sleeper tag, an entry
 *  with no date and one posted days before or after the game are not. Pure. */
export function isGameDayInactive({ source = null, status = null, comment = null, commentLong = null, date = null, kickoffUtc = null } = {}) {
  if (source !== ESPN_FEED) return false;
  const word = String(status ?? "").trim().toUpperCase();
  if (word !== "OUT" && word !== "INACTIVE") return false;
  // ESPN's short comment and its long one are both read: either may carry the word.
  const text = `${comment ?? ""} ${commentLong ?? ""}`;
  if (word !== "INACTIVE" && (!/\binactive\b/i.test(text) || OLD_INACTIVE.test(text))) return false;
  // The entry must be posted in the window before this game's kickoff: ESPN posts the inactives about 90 minutes before (the real WAS@NYG ones were 71 to 88).
  const entry = typeof date === "string" ? Date.parse(date) : NaN;
  const kickoff = typeof kickoffUtc === "string" ? Date.parse(kickoffUtc) : NaN;
  if (!Number.isFinite(entry) || !Number.isFinite(kickoff)) return false;
  return entry <= kickoff && kickoff - entry <= INACTIVE_WINDOW_MS;
}

/** How long before kickoff an ESPN inactive entry may be dated and still count (the real ones were 71 to 88 minutes before). */
export const INACTIVE_WINDOW_MS = 3 * 60 * 60 * 1000;
// "was inactive", "were inactive", "inactive for Week 9 / last week": a note about a past game, not tonight's list.
const OLD_INACTIVE = /\b(?:was|were|had been|been)\s+(?:a\s+)?(?:healthy\s+)?inactive\b|\binactive\s+(?:for|in|during|against|vs\.?)\s+(?:week\s*\d+|last\s+week|the\s+(?:previous|last)\b)/i;

/** How long before this game's kickoff a weekday "ruled out" entry may be dated (D45: the entry must also follow the team's previous game). */
export const RULED_OUT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A game is over this long after its kickoff: an entry inside it is about that game, never the next (conservative, 4 hours). */
const GAME_LENGTH_MS = 4 * 60 * 60 * 1000;
// The weekday "ruled out" REQUIRES forward wording that names this game (D45), and refuses anything else: a negation or hedge, a past tense, an in-game exit, the rest of a game, a result, another week or weekday.
const PRACTICE = /\b(?:practice|walkthrough|workouts?|OTAs?|camp)\b/i; // "ruled out for practice" is no game
// DraftKings' team code -> nickname, frozen (the opponent is named in a note by either, case-sensitively: "NO" the code is never the word "no").
const NICKNAMES = Object.freeze({
  ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers", CHI: "Bears", CIN: "Bengals", CLE: "Browns", DAL: "Cowboys", DEN: "Broncos", DET: "Lions", GB: "Packers",
  HOU: "Texans", IND: "Colts", JAX: "Jaguars", JAC: "Jaguars", KC: "Chiefs", LAC: "Chargers", LAR: "Rams", LV: "Raiders", MIA: "Dolphins", MIN: "Vikings", NE: "Patriots", NO: "Saints",
  NYG: "Giants", NYJ: "Jets", PHI: "Eagles", PIT: "Steelers", SEA: "Seahawks", SF: "49ers", TB: "Buccaneers", TEN: "Titans", WAS: "Commanders"
});
const HEDGE = /\bnot\b|n't\b|\bnever\b|\bcould\b|\bmay\b|\bmight\b|\blikely\b|\bexpected\s+to\s+be\b/i; // within three words before "ruled"
const PAST_AUX = /\b(?:was|were|had|being)\b|'d\b/i; // within three words before "ruled"
const IN_GAME = /\bcarted\b|\bexited\b|\bhelped\s+off\b|\bleft\s+(?:the|Sunday|Monday|Thursday)\b|\brest\s+of\b|\bremainder\b|\breturn(?:s|ed|ing)?\b/i;
const RESULT = /\b(?:loss|win|defeat|victory)\b/i;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ET_WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" });

/** ESPN's short and long comment as one text: joined with ". " when the short one has no closing punctuation, so a sentence never runs into the next (the one copy; decision and row read it). */
export function joinComments(comment, commentLong) {
  const a = String(comment ?? "").trim();
  const b = String(commentLong ?? "").trim();
  if (!a || !b) return a || b;
  return /[.!?]["')\]]*$/.test(a) ? `${a} ${b}` : `${a}. ${b}`;
}

/** The injury object a board row carries for an ESPN record (the one builder: the hide decision reads the same object the row ends up with). `comment` is the short note (else the long one);
 *  `longComment` rides along only when both exist and differ. */
export function espnInjuryOf(rec, feedStatus) {
  return {
    status: feedStatus,
    comment: rec.shortComment ?? rec.longComment ?? null,
    source: ESPN_FEED,
    date: rec.date ?? null,
    ...(rec.shortComment && rec.longComment && rec.longComment !== rec.shortComment ? { longComment: rec.longComment } : {})
  };
}

/** The sentence of `text` that says "ruled out", or null. */
function ruledOutSentence(text) {
  return String(text ?? "").split(/(?<=[.!?])\s+(?=[A-Z])/).find((s) => /\bruled\s+out\b/i.test(s)) ?? null;
}

const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Whether the sentence is about THIS man (his last name, `lastName`, a lastKey): within the five words before "ruled", or in the words right after "ruled out" (before its "for"); and no other
 *  "Name (injury)" sits between his name and "ruled". Without a last name, never. */
function aboutHim(before, after, lastName) {
  const key = plain(lastName).replace(/[^a-z0-9]/g, "");
  if (!key) return false;
  const word = new RegExp(`\\b${key}\\b`);
  const forAt = after.search(/\bfor\b/i);
  const straightAfter = (forAt < 0 ? after : after.slice(0, forAt)).trim().split(/\s+/).slice(0, 2).join(" "); // "ruled out Yankoff", "ruled out Colson Yankoff": his name is the object, not a later one in a list
  if (word.test(plain(straightAfter))) return true;
  const lastFive = before.trim().split(/\s+/).slice(-5).join(" ");
  const p = plain(lastFive);
  const hit = word.exec(p);
  if (!hit) return false;
  const between = p.slice(hit.index + key.length).replace(/^\s*\([^)]*\)/, ""); // his own "(injury)" may follow his name; any other parenthesis is another man's
  return !/[()]/.test(between);
}

/** The wording half of the weekday "ruled out": the feed's comment says, going forward ("ruled out ... for <game>"), that THIS man (`lastName`, a lastKey) is ruled out AND the clause after "for" names
 *  this game (this game's weekday, "this week", "tonight", "Week <slate week>", or the opponent's nickname or uppercase code, case-sensitively). Only that clause is read for the game, and it may not be
 *  practice, a walkthrough, workouts, OTAs or camp. Refused: a negation or hedge or a past aux within three words before "ruled", an in-game exit, "rest of / remainder / return", a result, a
 *  "Week N" that is not `week`, a weekday that is not the kickoff's. Pure. */
export function ruledOutWording({ comment = null, commentLong = null, kickoffUtc = null, week = null, opp = null, lastName = null } = {}) {
  const sentence = ruledOutSentence(joinComments(comment, commentLong));
  if (!sentence || IN_GAME.test(sentence) || RESULT.test(sentence)) return false;
  const at = /\bruled\s+out\b/i.exec(sentence);
  const before = sentence.slice(0, at.index);
  const after = sentence.slice(at.index + at[0].length);
  const forHit = /^[^.!?]{0,80}?\bfor\b/i.exec(after); // forward wording: "ruled out ... for"
  if (!forHit || !aboutHim(before, after, lastName)) return false;
  const lead = before.trim().split(/\s+/).slice(-3).join(" ");
  if (HEDGE.test(lead) || PAST_AUX.test(lead)) return false;
  const clause = after.slice(forHit[0].length).split(/[,;:–—]/)[0]; // the game: up to the first comma ("..., coach Y said Friday" is the announcement, not the game)
  if (PRACTICE.test(clause)) return false;
  const kickoff = typeof kickoffUtc === "string" ? Date.parse(kickoffUtc) : NaN;
  const weeks = [...clause.matchAll(/\bweek\s*(\d+)\b/gi)].map((m) => Number(m[1]));
  if (weeks.some((n) => n !== week)) return false;
  const gameDay = Number.isFinite(kickoff) ? ET_WEEKDAY.format(new Date(kickoff)).toLowerCase() : null;
  const named = WEEKDAYS.filter((d) => new RegExp(`\\b${d}\\b`, "i").test(clause));
  if (named.some((d) => d !== gameDay)) return false;
  const code = String(opp ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const nick = NICKNAMES[code];
  const namesOpp = Boolean(code) && (new RegExp(`\\b${code}\\b`).test(clause) || (nick ? new RegExp(`\\b${nick}\\b`).test(clause) : false));
  return named.length > 0 || weeks.length > 0 || /\bthis\s+week\b|\btonight\b/i.test(clause) || namesOpp;
}

/** A weekday "ruled out" (D45): an ESPN Out whose comment passes ruledOutWording, dated after the team's previous game (previousGameUtc, from the DraftKings salary files, plus the game's
 *  length), within RULED_OUT_WINDOW_MS before this game's DraftKings kickoff, and AFTER the salary file's upload (`uploadedAt`: a newer DraftKings file beats an older ESPN note, so the note is
 *  then a flag showing both words). No date, no upload time, an unknown previous game (not guessed) and a Sleeper tag are not. Pure. */
export function isRuledOutForGame({ source = null, status = null, comment = null, commentLong = null, date = null, kickoffUtc = null, previousGameUtc = null, week = null, opp = null, uploadedAt = null, lastName = null } = {}) {
  if (source !== ESPN_FEED || String(status ?? "").trim().toUpperCase() !== "OUT") return false;
  if (!ruledOutWording({ comment, commentLong, kickoffUtc, week, opp, lastName })) return false;
  const entry = typeof date === "string" ? Date.parse(date) : NaN;
  const kickoff = typeof kickoffUtc === "string" ? Date.parse(kickoffUtc) : NaN;
  const previous = typeof previousGameUtc === "string" ? Date.parse(previousGameUtc) : NaN;
  const upload = typeof uploadedAt === "string" ? Date.parse(uploadedAt) : NaN;
  if (!Number.isFinite(entry) || !Number.isFinite(kickoff) || !Number.isFinite(previous) || !Number.isFinite(upload)) return false;
  return entry <= kickoff && kickoff - entry <= RULED_OUT_WINDOW_MS && entry > previous + GAME_LENGTH_MS && entry > upload;
}

/** What a feed entry may hide a man by (the one copy): "inactive" (isGameDayInactive), "ruled-out" (isRuledOutForGame) or null. */
export function feedHideKind(entry) {
  if (isGameDayInactive(entry)) return "inactive";
  return isRuledOutForGame(entry) ? "ruled-out" : null;
}

/** feedHideKind off a board row (row.injury with its date, the row's DraftKings kickoff and the team's previous game, row.prevGameUtc). Hide decision and self-check read this. */
export function rowIsInactive(row) {
  return rowHideKind(row) !== null;
}

/** "inactive", "ruled-out" or null: which feed rule hides this row (for the words a hide is said in). */
export function rowHideKind(row) {
  const i = row?.injury;
  return i ? feedHideKind({ source: i.source, status: i.status, comment: i.comment, commentLong: i.longComment, date: i.date, kickoffUtc: row.kickoffUtc, previousGameUtc: row.prevGameUtc ?? null, week: row.slateWeek ?? null, opp: row.opp ?? null, uploadedAt: row.slateUploadedAt ?? null, lastName: row.ruleName ?? null }) : null;
}

/** The outside feed's Out, IR, Doubtful or Inactive word on a man it does not hide (a flag only, injury.flagOnly) and whom nothing else rules out, else null.
 *  The Entries exports warn on it, never refuse (source order, step 4). */
export function flaggedWordOf(row) {
  const word = row?.injury?.flagOnly ? String(row.injury.status ?? "").trim() : "";
  return word && isSidelined(word) && !rowIsOut(row) ? word : null;
}

const UPLOAD_STAMP = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });

/** "Tue 11:02 AM" (Eastern) from an ISO instant, or null. */
export function uploadStampText(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(UPLOAD_STAMP.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()}`;
}

/**
 * The foot-of-board sentence (G62) naming every man an outside feed lists Out, IR, Doubtful or Inactive whom nothing hides (a flag only), by feed word, with when
 * DraftKings' statuses were uploaded: a man ruled out after the upload is hidden only if a re-upload brings DraftKings' word. Null when there is none. Pure.
 * Example: "Flag only (feed says Out; DraftKings' file of Tue 11:02 AM lists nothing): Colson Yankoff, Lucas Patrick. Re-upload the salary file to refresh DraftKings' statuses."
 */
export function flagOnlyNote(rows, uploadedAt) {
  const byWord = new Map();
  for (const r of rows ?? []) {
    const word = flaggedWordOf(r);
    if (!word) continue;
    if (!byWord.has(word)) byWord.set(word, []);
    byWord.get(word).push(r);
  }
  if (!byWord.size) return null;
  const stamp = uploadStampText(uploadedAt);
  const file = stamp ? `DraftKings' file of ${stamp}` : "DraftKings' file (upload time unknown)";
  const parts = [...byWord].map(([word, list]) => `Flag only (feed says ${word}; ${file} ${list.some((r) => r.salaryStatus) ? "lists no out status" : "lists nothing"}): ${list.map((r) => r.name).join(", ")}.`);
  // G62: a weekday "ruled out" that could not be taken stays a flag, and the true reason is said (no previous game on file, or DraftKings' newer file lists nothing: both words shown).
  const reasons = new Map();
  for (const r of [...byWord.values()].flat()) {
    const why = ruledOutUnconfirmed(r, uploadedAt);
    if (!why) continue;
    if (!reasons.has(why)) reasons.set(why, []);
    reasons.get(why).push(r.name);
  }
  for (const [why, names] of reasons) parts.push(`Ruled out in the feed but only a flag, ${why}: ${names.join(", ")}.`);
  return `${parts.join(" ")} Re-upload the salary file to refresh DraftKings' statuses.`;
}

/** Why a feed note that says, going forward, that the man is ruled out for this game could not hide him (the words of the foot note), else null: the team's previous game could not be found
 *  (row.prevGameWhy: none on file, or older than the lookback), or DraftKings' salary file (`uploadedAt`) is newer than the note and lists nothing. */
export function ruledOutUnconfirmed(row, uploadedAt = null) {
  const i = row?.injury;
  if (!i || i.source !== ESPN_FEED || String(i.status ?? "").trim().toUpperCase() !== "OUT") return null;
  if (!ruledOutWording({ comment: i.comment, commentLong: i.longComment, kickoffUtc: row.kickoffUtc, week: row.slateWeek ?? null, opp: row.opp ?? null, lastName: row.ruleName ?? null })) return null;
  if (!row.prevGameUtc) return `since ${row.prevGameWhy ?? "the team's previous game is not in the salary files on hand"}`;
  const entry = Date.parse(i.date ?? ""), upload = Date.parse(row.slateUploadedAt ?? uploadedAt ?? "");
  if (!Number.isFinite(entry)) return "since the note carries no date";
  if (!Number.isFinite(upload)) return "since the salary file's upload time is unknown";
  return entry <= upload ? `since DraftKings' newer salary file lists nothing for him (the note is older than the upload)` : null;
}

/** A DraftKings Status word the app reads: a sidelined one ("out"), Questionable ("q"), else "unknown" (counted and noted, never a status), blank null. */
export function salaryWordKind(word) {
  const w = String(word ?? "").trim();
  if (!w) return null;
  if (isSidelined(w)) return "out";
  return /^(q|questionable)$/i.test(w) ? "q" : "unknown";
}

/** What the sources let hide a man (steps 2 and 4): the DraftKings Status column when it lists him out, else the feed's word only
 *  for a game-day inactive. `flagOnly`: the feed has a word that hides no one. Returns { status, by: "salary" | "inactive" | null, flagOnly }. */
export function injuryRuling({ salaryStatus = null, feedStatus = null, inactive = false, ruledOut = false } = {}) {
  const dk = salaryWordKind(salaryStatus) && salaryWordKind(salaryStatus) !== "unknown" ? String(salaryStatus).trim() : null; // an unknown word is never turned into a status (counted and noted by the board)
  const word = typeof feedStatus === "string" && feedStatus.trim() ? feedStatus : null;
  if (isSidelined(dk)) return { status: dk, by: "salary", flagOnly: word !== null };
  if (word && inactive && isSidelined(word)) return { status: word, by: "inactive", flagOnly: false };
  if (word && ruledOut && isSidelined(word)) return { status: word, by: "ruled-out", flagOnly: false }; // a weekday "ruled out" (isRuledOutForGame)
  // DraftKings' word that hides no one (its "Q") is still its status, shown as one; the feed's word then is a flag.
  if (dk) return { status: dk, by: "salary", flagOnly: word !== null };
  return { status: null, by: null, flagOnly: word !== null };
}

/** Whether TwoGun's OUT is in use on this row (step 3): his word set the status and src.status says so (classic: select.js applyCall, only while his calls are
 *  ticked; Showdown: his CSV lists him out). Served Showdown rows carry no tg.call, so the test is the status itself. A tg attached with his calls off is not. */
export function twogunCallsOut(row) {
  return row?.src?.status === "twogun" && isSidelined(row?.status);
}

/** The words for a man Adam marked In who has no number from any source and none typed (his In on a TwoGun-OUT man with no last figure and no backup number). */
export const TYPE_A_PROJECTION = "Type a projection to play him";

/** True when Adam marked him In but the board has no number for him: the switch's hover and the optimizer's skip reason say TYPE_A_PROJECTION. Pure. */
export function inNeedsNumber(row) {
  if (row?.override?.status !== "in") return false;
  const typed = row.override.proj;
  if (typeof typed === "number" && Number.isFinite(typed)) return false;
  return !(typeof row.proj === "number" && Number.isFinite(row.proj)) || Boolean(row.flags?.includes?.("no projection"));
}

/** Adam's own In / Out for this man (overrides.status, Adam 2026-11-12: "mark players in and out"), read off the merged row: "in", "out" or null (Auto). */
export function statusSetting(row) {
  const s = row?.override?.status;
  return s === "in" || s === "out" ? s : null;
}

/** True when the sources list him out, on IR or doubtful (the injury report's status or the board's injured flag), Adam's own setting aside. */
export function listedSidelined(row) {
  return isSidelined(row?.status) || Boolean(row?.flags?.includes?.("injured"));
}

/** True when a board row is out: Adam's In / Out when he set one, else the sources' word (listedSidelined). */
export function rowIsSidelined(row) {
  const set = statusSetting(row);
  if (set) return set === "out";
  return listedSidelined(row);
}

/** The status word a row is read with: none for a man Adam marked in, "Out" for one he marked out, else the sources' word. Entries' injury checks and the Hidden notes read it. */
export function statusWordOf(row) {
  const set = statusSetting(row);
  if (set === "in") return null;
  if (set === "out") return "Out";
  return row?.status ?? null;
}

// A projection above 0 that Adam typed on a man the sources list out puts him back in, in every mode (Adam 2026-10-16; 2026-11-12: a typed number always wins).
// His own Out wins over it; his own In needs no revive.
export function isRevived(row) {
  const typed = row?.override?.proj;
  return statusSetting(row) === null && listedSidelined(row) && row?.override?.revive === true && typeof typed === "number" && Number.isFinite(typed) && typed > 0;
}

/** The projection Adam typed on a man he has marked Out (D45: his Out beats a typed number): kept and shown, not used (the row counts 0). Null when he has no Out on him or typed nothing. */
export function unusedTypedProj(row) {
  const typed = row?.override?.proj;
  return statusSetting(row) === "out" && typeof typed === "number" && Number.isFinite(typed) ? typed : null;
}

/** The projection an out man (zeroed) would have without the Out, bump removed, for a box that opens on him: his typed number, else TwoGun's figure when the board counts his number for him (or there is
 *  no blend), else the blend (projBase) when above 0; null (a blank box) when none. Pure. */
export function projWithoutOut(row) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const typed = num(row?.override?.proj);
  if (typed !== null) return typed;
  const his = num(row?.projBySource?.twogun);
  const base = num(row?.projBase);
  const usesHis = row?.src?.proj === "twogun" || (row?.srcUsed?.proj ?? []).includes("twogun"); // his number is the one the board counts for him (not merely on file)
  if (his !== null && his > 0 && (usesHis || !(base !== null && base > 0))) return his;
  return base !== null && base > 0 ? base : null; // a zero blend is no number to open on: blank
}

/** True when Adam has marked the man In or Out or typed a projection on him: the pools keep him listed (dimmed when out) so his edit is never out of reach. */
export function adamTouched(row) {
  const typed = row?.override?.proj;
  return statusSetting(row) !== null || (typeof typed === "number" && Number.isFinite(typed));
}

export function sidelinedIdsOf(rows) {
  return new Set((rows ?? []).filter((row) => rowIsSidelined(row)).map((row) => String(row.id)));
}

export function rowIsOut(row) {
  return rowIsSidelined(row) && !isRevived(row);
}

// Adam 2026-10-15: out = 0 projection and ceiling.
export function zeroOutRows(rows) {
  return rows.map((row) => {
    const had = Array.isArray(row.flags) && row.flags.includes("revived");
    const base = had ? { ...row, flags: row.flags.filter((f) => f !== "revived") } : row;
    if (!rowIsSidelined(base)) return base;
    if (isRevived(base)) return { ...base, flags: [...(base.flags ?? []), "revived"] };
    const zeroed = { ...base, proj: 0 };
    if (Object.prototype.hasOwnProperty.call(base, "ceiling")) zeroed.ceiling = 0;
    return zeroed;
  });
}
