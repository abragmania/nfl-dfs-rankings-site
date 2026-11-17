// Eastern-time helpers shared by server/slate/parse-salaries.js (kickoff strings from the DK CSV's ET
// clock times) and server/slate/week.js (picking the ESPN scoreboard date for a kickoff instant).
// US Eastern DST rule: second Sunday in March through the first Sunday in November (2 a.m. local
// transitions: on those two Sundays the clock hour decides, see easternOffsetHours). No
// libraries, per PROJECT.md.

function firstSundayOfMonth(year, monthIndex0) {
  const dow = new Date(Date.UTC(year, monthIndex0, 1)).getUTCDay(); // 0 = Sunday
  return 1 + ((7 - dow) % 7);
}

function secondSundayOfMonth(year, monthIndex0) {
  return firstSundayOfMonth(year, monthIndex0) + 7;
}

export function isEasternDst(year, monthIndex0, day) {
  if (monthIndex0 < 2 || monthIndex0 > 10) return false; // Jan, Feb, Dec
  if (monthIndex0 > 2 && monthIndex0 < 10) return true; // Apr-Oct
  if (monthIndex0 === 2) return day >= secondSundayOfMonth(year, 2); // March, second Sunday onward
  return day < firstSundayOfMonth(year, 10); // November, before the first Sunday
}

// Hours to ADD to Eastern clock time to reach UTC (4 during EDT, 5 during EST). With the clock hour given, the changeover
// Sunday is told apart too: both switches are at 2 a.m. local, so November's first Sunday is daylight time before 2 a.m. and
// March's second Sunday is daylight time from 2 a.m. (the 1-3 a.m. hour otherwise reads as its first, daylight time in
// November). Without the hour the whole changeover date follows the date rule (isEasternDst).
export function easternOffsetHours(year, monthIndex0, day, hour) {
  if (Number.isInteger(hour)) {
    if (monthIndex0 === 10 && day === firstSundayOfMonth(year, 10)) return hour < 2 ? 4 : 5;
    if (monthIndex0 === 2 && day === secondSundayOfMonth(year, 2)) return hour >= 2 ? 4 : 5;
  }
  return isEasternDst(year, monthIndex0, day) ? 4 : 5;
}

// The signed "-HH:00" offset string for an Eastern calendar date (and clock hour, when given), e.g. "-04:00" or "-05:00".
export function easternOffsetString(year, monthIndex0, day, hour) {
  return `-${String(easternOffsetHours(year, monthIndex0, day, hour)).padStart(2, "0")}:00`;
}

// Builds both kickoff strings from Eastern calendar/clock fields (1-based month, 24h hour).
// kickoffEt carries the offset, e.g. "2026-09-13T13:00:00-04:00"; kickoffUtc is the ISO UTC instant.
export function kickoffStrings(year, month1, day, hour, minute) {
  const monthIndex0 = month1 - 1;
  const offset = easternOffsetHours(year, monthIndex0, day, hour);
  const pad2 = (n) => String(n).padStart(2, "0");
  const kickoffUtc = new Date(Date.UTC(year, monthIndex0, day, hour + offset, minute)).toISOString();
  const kickoffEt = `${year}-${pad2(month1)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00${easternOffsetString(year, monthIndex0, day, hour)}`;
  return { kickoffUtc, kickoffEt };
}

// Eastern calendar date (YYYYMMDD) for a UTC kickoff instant, used to pick the ESPN
// scoreboard?dates=YYYYMMDD to fetch. The offset is exact to the hour on the changeover Sundays
// (easternOffsetAtUtcMs: 2 a.m. EST = 07:00 UTC in March, 2 a.m. EDT = 06:00 UTC in November).
export function easternDateStamp(kickoffUtc) {
  const d = new Date(kickoffUtc);
  const offset = easternOffsetAtUtcMs(d.getTime());
  const et = new Date(d.getTime() - offset * 3600 * 1000);
  const y = et.getUTCFullYear();
  const m = String(et.getUTCMonth() + 1).padStart(2, "0");
  const day = String(et.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// RULES.md D30 (amended 2026-10-15): the one extra time helper, used only for TwoGun's board age at the slate's
// first kickoff (the stale banner past 36 hours). His board stamps and kickoffs are Central time, written
// "Thu, Oct 15, 8:32 AM CT" (his ownership board drops the commas: "Thu Oct 15 8:32 AM CT"; both are read). The
// text carries no year: January and February belong to season + 1, every other month to the season. Central clock
// time is Eastern minus one hour on the same DST dates (on the changeover Sunday the hour decides, centralIsDst below);
// the weekday is not checked. Returns the hours from `fromStamp` to `toStamp` (negative when the stamp is after the
// kickoff), or null when either text is not in that shape or the season is not a whole number.
const MONTH_INDEX = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const CENTRAL_STAMP = /^[A-Z][a-z]{2},? ([A-Z][a-z]{2}) (\d{1,2}),? (\d{1,2}):(\d{2}) (AM|PM) CT$/;

function centralStampUtcMs(text, season) {
  const m = CENTRAL_STAMP.exec(String(text ?? "").trim());
  if (!m || !Object.hasOwn(MONTH_INDEX, m[1])) return null;
  const monthIndex0 = MONTH_INDEX[m[1]];
  const day = Number(m[2]), hour12 = Number(m[3]), minute = Number(m[4]);
  if (day < 1 || day > 31 || hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const year = monthIndex0 <= 1 ? season + 1 : season;
  const hour = (hour12 % 12) + (m[5] === "PM" ? 12 : 0);
  return centralClockUtcMs(year, monthIndex0, day, hour, minute);
}

// Whether a Central wall-clock time is daylight time. Central is Eastern minus one hour on the same DST dates, but both zones
// switch at 2 a.m. local, so on the changeover Sunday itself the hour decides: November's first Sunday is still daylight time
// before 2 a.m. (12:30 AM CT on Nov 1 2026 is UTC-5), March's second Sunday is still standard time before 2 a.m. The 1-3 a.m.
// hour is otherwise not told apart (the first, daylight reading is taken).
function centralIsDst(year, monthIndex0, day, hour) {
  if (monthIndex0 === 10 && day === firstSundayOfMonth(year, 10)) return hour < 2;
  if (monthIndex0 === 2 && day === secondSundayOfMonth(year, 2)) return hour >= 2;
  return isEasternDst(year, monthIndex0, day);
}

// Central wall-clock fields to a UTC instant (hours to add: 5 in daylight time, 6 in standard time).
function centralClockUtcMs(year, monthIndex0, day, hour, minute) {
  const centralToUtc = centralIsDst(year, monthIndex0, day, hour) ? 5 : 6;
  return Date.UTC(year, monthIndex0, day, hour + centralToUtc, minute);
}

// The stamps TwoGun's Showdown files actually carry (the meta file's boardUpdated, the ownership header's "As of"), each
// followed by CT and possibly trailing text: "Mon, Nov 2, 8:09 AM CT", "Mon Oct 26 2026 6:08 PM CT (...)",
// "MON OCT 19 6:08 PM CT (...)", "THU OCT 15 · 8:39 AM CT", "2026-10-29 6:07 PM CT (...)", "2026-10-18 14:17 CT (...)".
// A year written in the text wins over the season rule (January and February of season + 1); a stamp with no year needs
// the season. Only CT is read (an ET or other zone is not guessed at). Returns the UTC instant or null.
const NAMED_STAMP = /^(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})\s+(\d{1,2}),?(?:\s+(\d{4}))?\s*(?:[,·]\s*)?(\d{1,2}):(\d{2})\s*(AM|PM)?\s+CT\b/i;
const ISO_STAMP = /^(\d{4})-(\d{2})-(\d{2})[ T]\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s+CT\b/i;

// { ms, tail } of a stamp's leading CT time: its UTC instant and the text after the "CT" (the stamp's own trailing note); null when unreadable.
function readShowdownStamp(text, season) {
  const s = String(text ?? "").trim();
  let year, monthIndex0, day, hourText, minute, meridiem, matched;
  const iso = ISO_STAMP.exec(s);
  if (iso) {
    matched = iso[0];
    year = Number(iso[1]); monthIndex0 = Number(iso[2]) - 1; day = Number(iso[3]); hourText = iso[4]; minute = Number(iso[5]); meridiem = iso[6];
  } else {
    const m = NAMED_STAMP.exec(s);
    const name = m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
    if (!m || !Object.hasOwn(MONTH_INDEX, name)) return null;
    matched = m[0];
    monthIndex0 = MONTH_INDEX[name]; day = Number(m[2]); hourText = m[4]; minute = Number(m[5]); meridiem = m[6];
    if (m[3]) year = Number(m[3]);
    else if (Number.isInteger(season)) year = monthIndex0 <= 1 ? season + 1 : season;
    else return null;
  }
  let hour = Number(hourText);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0);
  } else if (hour > 23) return null;
  if (monthIndex0 < 0 || monthIndex0 > 11 || day < 1 || day > 31 || minute > 59) return null;
  return { ms: centralClockUtcMs(year, monthIndex0, day, hour, minute), tail: s.slice(matched.length) };
}

function showdownStampUtcMs(text, season) {
  return readShowdownStamp(text, season)?.ms ?? null;
}

// Hours to subtract from a UTC instant for Eastern clock time: 4 in daylight time (from 2 a.m. EST, 07:00 UTC, on March's second
// Sunday), 5 in standard time (from 2 a.m. EDT, 06:00 UTC, on November's first Sunday); exact to the hour, unlike the date rule above.
function easternOffsetAtUtcMs(ms) {
  const year = new Date(ms).getUTCFullYear();
  const start = Date.UTC(year, 2, secondSundayOfMonth(year, 2), 7);
  const end = Date.UTC(year, 10, firstSundayOfMonth(year, 10), 6);
  return ms >= start && ms < end ? 4 : 5;
}

/** The Eastern clock of a UTC instant in milliseconds, for file names: "20261108-110507". Exact to the hour on the changeover Sundays. */
export function easternTimeStamp(ms) {
  const et = new Date(ms - easternOffsetAtUtcMs(ms) * 3600000).toISOString(); // its UTC fields now read as Eastern
  return `${et.slice(0, 10).replace(/-/g, "")}-${et.slice(11, 19).replace(/:/g, "")}`;
}

/** A UTC instant as its Eastern ISO time with the offset ("2026-10-11T20:20:00-04:00"), exact to the hour on the changeover Sundays. */
export function easternIsoOfUtcMs(ms) {
  const offset = easternOffsetAtUtcMs(ms);
  return `${new Date(ms - offset * 3600000).toISOString().slice(0, 19)}-${String(offset).padStart(2, "0")}:00`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = Object.keys(MONTH_INDEX);
const BARE_CT_TIME = /(\d{1,2}):(\d{2})(?:\s*(AM|PM))?\s+CT\b/gi;

// A bare Central clock time in a stamp's trailing note ("his last before the 7:15 PM CT kickoff") as Eastern: one hour later, the date
// not carried (a note's time past midnight reads as the clock, not the next day).
function bareCtTimesToEt(note) {
  return note.replace(BARE_CT_TIME, (all, h, min, meridiem) => {
    const hour = Number(h);
    if (meridiem) {
      if (hour < 1 || hour > 12) return all;
      const next = ((hour % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0) + 1) % 24;
      return `${next % 12 === 0 ? 12 : next % 12}:${min} ${next >= 12 ? "PM" : "AM"} ET`;
    }
    return hour > 22 ? all : `${hour + 1}:${min} ET`;
  });
}

/**
 * TwoGun's Central-time stamp as Eastern text, in the style the stamps already read, kept short: "Mon, Nov 2, 8:09 AM CT" ->
 * "Mon, Nov 2, 9:09 AM ET". Every shape showdownStampUtcMs reads ("Mon Oct 26 2026 6:08 PM CT (...)", "MON OCT 19 6:08 PM CT",
 * "2026-10-29 6:07 PM CT", "2026-10-18 14:17 CT"); the year is dropped, the weekday is the Eastern date's own (it can differ from
 * the Central one across midnight), a trailing note is kept with its own bare Central times moved to Eastern. A stamp with no year
 * needs the season. Returns the original text when it cannot be read (not a CT stamp, already Eastern, or no season). Display only:
 * the age math reads the Central text (centralStampToKickoffHours, centralHoursBetween); this is never parsed back.
 */
export function centralStampToEasternText(text, season) {
  if (typeof text !== "string") return text;
  const read = readShowdownStamp(text, season);
  if (!read) return text;
  const et = new Date(read.ms - easternOffsetAtUtcMs(read.ms) * 3600000);
  const h = et.getUTCHours();
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(et.getUTCMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
  const stamp = `${DAY_NAMES[et.getUTCDay()]}, ${MONTH_NAMES[et.getUTCMonth()]} ${et.getUTCDate()}, ${clock}`;
  return read.tail ? `${stamp}${bareCtTimesToEt(read.tail)}` : stamp;
}

// The same age for a Showdown game, whose kickoff is the DraftKings Game Info time already kept as `kickoffEt`
// (kickoffStrings above: an ISO time with its Eastern offset, "2026-11-02T20:15:00-05:00"). Hours from the Central
// board stamp (any shape showdownStampUtcMs reads) to that kickoff, negative when the stamp is after it; null when either is
// unreadable (a stamp with no year also needs a whole-number season).
export function centralStampToKickoffHours(stampText, kickoffEt, season) {
  const from = showdownStampUtcMs(stampText, season);
  const to = typeof kickoffEt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(kickoffEt) ? Date.parse(kickoffEt) : NaN;
  if (from === null || !Number.isFinite(to)) return null;
  return (to - from) / 3600000;
}

export function centralHoursBetween(fromStamp, toStamp, season) {
  if (!Number.isInteger(season)) return null;
  const from = centralStampUtcMs(fromStamp, season);
  const to = centralStampUtcMs(toStamp, season);
  if (from === null || to === null) return null;
  return (to - from) / 3600000;
}

export const ZONED_INSTANT =/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * RULES.md D30: an ISO instant carrying its zone, as TwoGun's database writes them, as the Central stamp his snapshots carry:
 * "2026-11-01T17:00:00Z" -> "Sun, Nov 1, 12:00 PM CT". Central is UTC-5 from 2 a.m. CST (08:00 UTC) on March's second Sunday and UTC-6 from
 * 2 a.m. CDT (07:00 UTC) on November's first. Returns null for anything else, an instant with no zone included (its time could not be told).
 */
export function instantToCentralStamp(instant) {
  const ms = typeof instant === "string" && ZONED_INSTANT.test(instant) ? Date.parse(instant) : NaN;
  if (!Number.isFinite(ms)) return null;
  const year = new Date(ms).getUTCFullYear();
  const daylight = ms >= Date.UTC(year, 2, secondSundayOfMonth(year, 2), 8) && ms < Date.UTC(year, 10, firstSundayOfMonth(year, 10), 7);
  const ct = new Date(ms - (daylight ? 5 : 6) * 3600000);
  const h = ct.getUTCHours();
  return `${DAY_NAMES[ct.getUTCDay()]}, ${MONTH_NAMES[ct.getUTCMonth()]} ${ct.getUTCDate()}, ${h % 12 === 0 ? 12 : h % 12}:${String(ct.getUTCMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} CT`;
}
