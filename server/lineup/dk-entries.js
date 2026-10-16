// DraftKings entries file (the "DKEntries.csv" Adam exports from his contest entries, edits and uploads back).
// Pure functions only: no file and no network access. tools/dk_entries.mjs is the command line wrapper.
//
// The file's layout: a header `Entry ID,Contest Name,Contest ID,Entry Fee,QB,RB,RB,WR,WR,WR,TE,FLEX,DST,,Instructions`,
// then one row per contest entry (first cell all digits) carrying nine roster cells written `Name (DraftKingsId)`.
// To the right of those rows (after one blank column) and on the rows below sit DraftKings' instructions and the
// slate's player list. The writer here replaces ONLY the nine roster cells of each entry row; every other cell and
// every other line is carried over as the exact original text, so entry ids (10-digit strings) are never parsed
// as numbers or reformatted.
import { isSidelined } from "../rank/sidelined.js"; // pure: the public site runs the Optimizer's engine in the browser (D69)

/** DraftKings classic roster columns, in the file's column order. */
export const DK_CLASSIC_SLOTS = Object.freeze(["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"]);

const ROSTER_START = 4; // first roster column (zero-based)
const ROSTER_END = 13; // one past the last roster column; the blank column and the right-hand block start here
const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
const POSITION_MINIMUMS = Object.freeze({ QB: 1, RB: 2, WR: 3, TE: 1, DST: 1 });
const BOM = "﻿";

/**
 * Splits CSV text into records. Each record keeps its raw text, its line ending, its decoded cells and the raw
 * text of each cell (so a cell can be written back byte for byte). Handles quoted fields, doubled quotes, commas
 * and line breaks inside quotes. A quote only opens a quoted field when it is the field's first character.
 */
function parseCsvRecords(text) {
  const records = [];
  const n = text.length;
  let i = 0;
  const atDelimiter = () => text[i] === "," || text[i] === "\n" || text[i] === "\r";
  while (i < n) {
    const recordStart = i;
    const cells = [];
    const rawCells = [];
    for (;;) {
      const cellStart = i;
      let value;
      if (text[i] === '"') {
        value = "";
        i++;
        while (i < n) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              value += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            value += text[i];
            i++;
          }
        }
        while (i < n && !atDelimiter()) {
          value += text[i];
          i++;
        }
      } else {
        while (i < n && !atDelimiter()) i++;
        value = text.slice(cellStart, i);
      }
      cells.push(value);
      rawCells.push(text.slice(cellStart, i));
      if (i < n && text[i] === ",") {
        i++;
        continue;
      }
      break;
    }
    const raw = text.slice(recordStart, i);
    let eol = "";
    if (i < n) {
      eol = text[i] === "\r" && text[i + 1] === "\n" ? "\r\n" : text[i];
      i += eol.length;
    }
    records.push({ raw, eol, cells, rawCells });
  }
  return records;
}

/** Writes one cell with standard CSV quoting, only when the cell needs it. */
function quoteCell(value) {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The DraftKings id in a roster cell: `Name (44312211)` or a bare `44312211`. Blank when there is none. */
export function idOfCell(cell) {
  const s = String(cell ?? "").trim();
  const m = /\((\d+)\)$/.exec(s);
  if (m) return m[1];
  return /^\d+$/.test(s) ? s : "";
}

/** The game a player is in, from the file's Game Info cell (`LAC@SEA 10/04/2026 04:25PM ET` -> `LAC@SEA`). */
function gameOf(gameInfo) {
  const m = /^([A-Za-z0-9]+@[A-Za-z0-9]+)\b/.exec(String(gameInfo ?? "").trim());
  return m ? m[1].toUpperCase() : null;
}

function compareIds(a, b) {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function lookup(mapOrObject, id) {
  if (!mapOrObject) return undefined;
  if (typeof mapOrObject.get === "function") return mapOrObject.get(id);
  return mapOrObject[id];
}

function inSet(setOrArray, id) {
  if (!setOrArray) return false;
  if (typeof setOrArray.has === "function") return setOrArray.has(id);
  return Array.isArray(setOrArray) && setOrArray.includes(id);
}

function describe(pool, id) {
  const p = pool.get(id);
  return p ? `${p.name} (${id})` : `id ${id}`;
}

/**
 * Parses a DraftKings entries file.
 * Returns { header, lines, entries, pool } as documented at the top of this file, plus what the writer needs to
 * reproduce the file exactly: `bom` (true when the text began with one), `eols` (each line's own ending) and
 * `rawCells` (each line's cells as the exact original text).
 */
export function parseEntriesCsv(text) {
  if (typeof text !== "string") throw new Error("The entries file text must be a string.");
  const bom = text.startsWith(BOM);
  const body = bom ? text.slice(1) : text;
  const records = parseCsvRecords(body);
  if (records.length === 0) throw new Error("The entries file is empty.");
  for (let i = 0; i < records.length; i++) {
    if (records[i].rawCells.join(",") !== records[i].raw) {
      throw new Error(`Line ${i + 1} of the entries file could not be split into cells cleanly.`);
    }
  }

  const header = records[0].cells;
  const headerSlots = header.slice(ROSTER_START, ROSTER_END).map(c => c.trim().toUpperCase());
  if (header[0]?.trim() !== "Entry ID" || headerSlots.join(",") !== DK_CLASSIC_SLOTS.join(",")) {
    throw new Error(
      "This is not a DraftKings classic entries file: the first line must start with Entry ID and carry the roster columns QB, RB, RB, WR, WR, WR, TE, FLEX, DST."
    );
  }

  const entries = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i].cells;
    if (!/^\d+$/.test(cells[0].trim())) continue;
    if (cells.length < ROSTER_END) {
      throw new Error(`Line ${i + 1} looks like an entry (${cells[0]}) but has fewer than ${ROSTER_END} cells.`);
    }
    entries.push({
      lineIndex: i,
      entryId: cells[0],
      contestName: cells[1],
      contestId: cells[2],
      entryFee: cells[3],
      roster: cells.slice(ROSTER_START, ROSTER_END),
      rest: cells.slice(ROSTER_END)
    });
  }

  // The player list: find its header (a "Position" cell directly followed by "Name + ID"), then read the rows below.
  const pool = new Map();
  let listLine = -1;
  let listCol = -1;
  for (let i = 0; i < records.length && listLine < 0; i++) {
    const cells = records[i].cells;
    for (let j = ROSTER_END; j + 1 < cells.length; j++) {
      if (cells[j].trim() === "Position" && cells[j + 1].trim() === "Name + ID") {
        listLine = i;
        listCol = j;
        break;
      }
    }
  }
  if (listLine >= 0) {
    const names = records[listLine].cells.slice(listCol).map(c => c.trim());
    const col = name => {
      const k = names.indexOf(name);
      if (k < 0) throw new Error(`The player list in the entries file has no "${name}" column.`);
      return listCol + k;
    };
    const cPos = col("Position");
    const cNameId = col("Name + ID");
    const cName = col("Name");
    const cId = col("ID");
    const cRosterPos = col("Roster Position");
    const cSalary = col("Salary");
    const cGame = col("Game Info");
    const cTeam = col("TeamAbbrev");
    for (let i = listLine + 1; i < records.length; i++) {
      const cells = records[i].cells;
      const id = (cells[cId] ?? "").trim();
      if (!/^\d+$/.test(id)) continue;
      const nameId = cells[cNameId] ?? "";
      if (idOfCell(nameId) !== id) {
        throw new Error(`Line ${i + 1} of the entries file: the Name + ID cell "${nameId}" does not carry the ID ${id}.`);
      }
      const salary = Number((cells[cSalary] ?? "").trim());
      if (!Number.isFinite(salary) || (cells[cSalary] ?? "").trim() === "") {
        throw new Error(`Line ${i + 1} of the entries file: the salary "${cells[cSalary]}" for ${nameId} is not a number.`);
      }
      if (pool.has(id)) continue;
      pool.set(id, {
        nameId,
        name: cells[cName] ?? "",
        id,
        pos: (cells[cPos] ?? "").trim().toUpperCase(),
        rosterPos: (cells[cRosterPos] ?? "").trim(),
        salary,
        gameInfo: cells[cGame] ?? "",
        team: (cells[cTeam] ?? "").trim()
      });
    }
  }

  return {
    header,
    lines: records.map(r => r.raw),
    entries,
    pool,
    bom,
    eols: records.map(r => r.eol),
    rawCells: records.map(r => r.rawCells)
  };
}

/**
 * The distinct lineups currently sitting in the entry rows, in order of first appearance, each with the entry
 * rows that hold it. Two rows hold the same lineup when their nine cells carry the same ids in the same slots.
 */
export function groupPlaceholders(entries) {
  const byKey = new Map();
  const groups = [];
  for (const entry of entries) {
    const ids = entry.roster.map(idOfCell);
    const key = ids.join(",");
    let group = byKey.get(key);
    if (!group) {
      group = { key, ids, roster: entry.roster.slice(), entries: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

/**
 * Structural problems of nine ids laid out in slot order: wrong count, ids not in the file's player list, a
 * repeated player, wrong position counts, a player in a slot his position cannot fill. Returns plain sentences.
 */
function structureErrors(slots, pool) {
  const errors = [];
  if (!Array.isArray(slots) || slots.length !== DK_CLASSIC_SLOTS.length) {
    errors.push(`The lineup has ${Array.isArray(slots) ? slots.length : 0} players; a DraftKings classic lineup needs exactly nine.`);
    if (!Array.isArray(slots)) return errors;
  }
  const seen = new Set();
  const repeated = new Set();
  for (const id of slots) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  for (const id of repeated) errors.push(`${describe(pool, id)} is in the lineup more than once.`);
  const unknown = [...seen].filter(id => !pool.has(id));
  for (const id of unknown) errors.push(`The id ${id} is not in the entries file's player list.`);
  if (unknown.length > 0) return errors;

  const counts = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
  const strange = [];
  for (const id of seen) {
    const pos = pool.get(id).pos;
    if (pos in counts) counts[pos]++;
    else strange.push(`${describe(pool, id)} has the position "${pos}", which a classic lineup cannot use.`);
  }
  errors.push(...strange);
  const countsOk =
    counts.QB === 1 && counts.DST === 1 && counts.RB >= 2 && counts.WR >= 3 && counts.TE >= 1 &&
    counts.QB + counts.RB + counts.WR + counts.TE + counts.DST === DK_CLASSIC_SLOTS.length;
  if (!countsOk && repeated.size === 0 && slots.length === DK_CLASSIC_SLOTS.length) {
    errors.push(
      `The position counts are wrong: ${counts.QB} QB, ${counts.RB} RB, ${counts.WR} WR, ${counts.TE} TE, ${counts.DST} DST (a classic lineup needs exactly one QB and one DST, at least two RB, three WR and one TE, nine players in all).`
    );
  }
  if (slots.length === DK_CLASSIC_SLOTS.length) {
    slots.forEach((id, i) => {
      const slot = DK_CLASSIC_SLOTS[i];
      const pos = pool.get(id).pos;
      const fits = slot === "FLEX" ? FLEX_POSITIONS.has(pos) : pos === slot;
      if (!fits) errors.push(`${describe(pool, id)} is a ${pos} and cannot go in the ${slot} slot.`);
    });
  }
  return errors;
}

/**
 * Places nine players into the DraftKings classic slots, in the file's column order
 * (QB, RB, RB, WR, WR, WR, TE, FLEX, DST), and returns the nine ids in that order.
 * Positions come from the entries file's player list (`pool`), never guessed. The one spare RB, WR or TE goes
 * to FLEX: of the players at the position that has a spare, the one with the LATEST kickoff (so a late swap
 * stays possible), ties broken by lower salary, then by id. RB and WR slots are ordered by salary, high to low.
 * `kickoffById` is a Map or object of id -> kickoff time (an ISO string, a Date or a number of milliseconds).
 * Throws an Error with a plain sentence when the nine players cannot make a legal lineup.
 */
export function assignSlots(playerIds, pool, kickoffById) {
  if (!Array.isArray(playerIds) || playerIds.length !== DK_CLASSIC_SLOTS.length) {
    throw new Error(`The lineup has ${Array.isArray(playerIds) ? playerIds.length : 0} players; a DraftKings classic lineup needs exactly nine.`);
  }
  const ids = playerIds.map(id => String(id).trim());
  const seen = new Set();
  for (const id of ids) {
    if (!pool.has(id)) throw new Error(`The id ${id} is not in the entries file's player list.`);
    if (seen.has(id)) throw new Error(`${describe(pool, id)} is in the lineup more than once.`);
    seen.add(id);
  }
  const byPos = { QB: [], RB: [], WR: [], TE: [], DST: [] };
  for (const id of ids) {
    const pos = pool.get(id).pos;
    if (!(pos in byPos)) throw new Error(`${describe(pool, id)} has the position "${pos}", which a classic lineup cannot use.`);
    byPos[pos].push(id);
  }
  const countsOk =
    byPos.QB.length === 1 && byPos.DST.length === 1 && byPos.RB.length >= 2 && byPos.WR.length >= 3 && byPos.TE.length >= 1;
  if (!countsOk) {
    throw new Error(
      `The position counts are wrong: ${byPos.QB.length} QB, ${byPos.RB.length} RB, ${byPos.WR.length} WR, ${byPos.TE.length} TE, ${byPos.DST.length} DST (a classic lineup needs exactly one QB and one DST, at least two RB, three WR and one TE, nine players in all).`
    );
  }

  // Nine players with one QB, one DST and the minimums met leave exactly one spare, at exactly one position.
  const sparePos = ["RB", "WR", "TE"].find(pos => byPos[pos].length > POSITION_MINIMUMS[pos]);
  const kickoffOf = id => {
    const v = lookup(kickoffById, id);
    const t = typeof v === "number" ? v : v instanceof Date ? v.getTime() : Date.parse(v);
    if (!Number.isFinite(t)) throw new Error(`There is no kickoff time for ${describe(pool, id)}, so the FLEX slot cannot be chosen.`);
    return t;
  };
  const salaryOf = id => pool.get(id).salary;
  const candidates = byPos[sparePos].map(id => ({ id, kickoff: kickoffOf(id) }));
  candidates.sort((a, b) => b.kickoff - a.kickoff || salaryOf(a.id) - salaryOf(b.id) || compareIds(a.id, b.id));
  const flex = candidates[0].id;

  const bySalaryDesc = (a, b) => salaryOf(b) - salaryOf(a) || compareIds(a, b);
  const rest = pos => byPos[pos].filter(id => id !== flex).sort(bySalaryDesc);
  const slots = [byPos.QB[0], ...rest("RB"), ...rest("WR"), ...rest("TE"), flex, byPos.DST[0]];
  const problems = structureErrors(slots, pool);
  if (problems.length > 0) throw new Error(problems.join(" "));
  return slots;
}

/**
 * Checks nine ids laid out in slot order against DraftKings' classic rules and the injury statuses passed in.
 * Options: `statusById` (Map or object of id -> status string), `sidelinedIds` (Set or array of ids the board
 * flags as injured), `salaryCap` (default 50000).
 * Returns { errors, warnings, salary, games }; every error and warning is one plain sentence.
 */
export function validateLineup(slots, pool, { statusById, sidelinedIds, revived, salaryCap = 50000 } = {}) {
  const errors = structureErrors(slots, pool);
  const warnings = [];
  const ids = Array.isArray(slots) ? [...new Set(slots)] : [];
  const known = ids.filter(id => pool.has(id));
  const complete = errors.length === 0;

  const salary = known.reduce((sum, id) => sum + pool.get(id).salary, 0);
  if (complete && salary > salaryCap) {
    errors.push(`The salary is $${salary.toLocaleString("en-US")}, over the $${salaryCap.toLocaleString("en-US")} cap.`);
  } else if (complete && salary < 49000) {
    warnings.push(`The salary is $${salary.toLocaleString("en-US")}, which leaves $${(salaryCap - salary).toLocaleString("en-US")} unspent.`);
  }

  const games = new Set();
  let gameUnknown = false;
  for (const id of known) {
    const game = gameOf(pool.get(id).gameInfo);
    if (game) games.add(game);
    else gameUnknown = true;
  }
  if (known.length > 0) {
    if (gameUnknown) {
      warnings.push("The two-games rule could not be checked because a player's Game Info in the entries file names no game.");
    } else if (games.size < 2) {
      errors.push(`Every player is from one game (${[...games][0]}); DraftKings needs players from at least two different games.`);
    }
  }

  for (const id of known) {
    const status = lookup(statusById, id);
    const statusText = status === null || status === undefined ? "" : String(status).trim();
    const typed = lookup(revived, id);
    if (typed !== undefined && typed !== null) {
      warnings.push(`${describe(pool, id)} is listed ${statusText || "injured"}; kept because you typed ${typed} after he was ruled out.`);
      continue;
    }
    if (isSidelined(statusText) || inSet(sidelinedIds, id)) {
      errors.push(`${describe(pool, id)} is sidelined${statusText ? ` (status ${statusText})` : " (flagged injured on the board)"}.`);
    } else if (["Q", "QUESTIONABLE"].includes(statusText.toUpperCase())) {
      warnings.push(`${describe(pool, id)} is listed questionable.`);
    }
  }

  return { errors, warnings, salary, games: [...games] };
}

/**
 * Builds the file to upload: the ORIGINAL file, line for line, with only the nine roster cells of each entry
 * row replaced. `groups` is groupPlaceholders(parsed.entries); `lineups` holds one lineup per group in the same
 * order (lineup i replaces group i), each an array of nine ids in slot order (or an object with `slots`).
 * Roster cells are written as the player list's exact "Name + ID" text. Every other cell and line is the
 * original text, the line endings are the input's, and a BOM is kept when the input had one.
 * Throws when the lineup count is wrong, a lineup is not a legal classic layout, two lineups hold the same nine
 * players, or the finished text fails the re-parse checks.
 *
 * Option `byEntry` (the Optimizer's per-entry assignment, PROJECT.md Part 4 "Optimizer"): a Map or object of
 * entry id -> nine ids in slot order (or an object with `slots`). Pass `groups` and `lineups` as null with it.
 * Each named entry row gets its own lineup; every entry row not named keeps its original text untouched. The same
 * nine players may go into different contests but never twice into one contest (same Contest ID), counting the
 * lineup an untouched entry row of that contest already holds. Without the
 * option the function behaves exactly as before.
 */
export function buildUpload(parsed, groups, lineups, { byEntry } = {}) {
  const { pool } = parsed;
  // slotsOfLine: entry row line index -> the nine ids it takes. Rows not in it are written as their original text.
  const slotsOfLine = new Map();
  if (byEntry !== undefined && byEntry !== null) {
    if (groups != null || lineups != null) throw new Error("buildUpload takes either placeholder groups and lineups or byEntry, not both.");
    const pairs = typeof byEntry.entries === "function" && !Array.isArray(byEntry) ? [...byEntry.entries()] : Object.entries(byEntry);
    if (pairs.length === 0) throw new Error("No entry was given a lineup, so there is nothing to write.");
    const entryById = new Map();
    for (const entry of parsed.entries) {
      if (entryById.has(entry.entryId)) throw new Error(`Entry ${entry.entryId} appears on more than one line of the entries file.`);
      entryById.set(entry.entryId, entry);
    }
    const seenInContest = new Map(); // contest id + sorted ids -> entry id
    // Entry rows not given a lineup keep theirs: seed them so no new lineup repeats one in the same contest. A blank
    // row, or one whose nine cells do not all name players in the file's list, is skipped.
    const assigned = new Set(pairs.map(([id]) => String(id).trim()));
    for (const entry of parsed.entries) {
      if (assigned.has(entry.entryId)) continue;
      const ids = entry.roster.map(idOfCell);
      if (ids.some(id => id === "" || !pool.has(id))) continue;
      seenInContest.set(`${entry.contestId.trim()}|${ids.slice().sort(compareIds).join(",")}`, `${entry.entryId} (not given a new lineup)`);
    }
    for (const [rawEntryId, lineup] of pairs) {
      const entryId = String(rawEntryId).trim();
      const entry = entryById.get(entryId);
      if (!entry) throw new Error(`Entry ${entryId} is not in the entries file.`);
      const raw = Array.isArray(lineup) ? lineup : lineup?.slots;
      if (!Array.isArray(raw)) throw new Error(`The lineup for entry ${entryId} is not a list of nine player ids.`);
      const slots = raw.map(id => String(id).trim());
      const problems = structureErrors(slots, pool);
      if (problems.length > 0) throw new Error(`Entry ${entryId}: ${problems.join(" ")}`);
      const key = `${entry.contestId.trim()}|${slots.slice().sort(compareIds).join(",")}`;
      if (seenInContest.has(key)) {
        throw new Error(`Entry ${entryId} has the same nine players as entry ${seenInContest.get(key)} in the same contest (${entry.contestName}); a contest never gets the same lineup twice.`);
      }
      seenInContest.set(key, entryId);
      slotsOfLine.set(entry.lineIndex, slots);
    }
  } else {
    if (!Array.isArray(groups) || !Array.isArray(lineups)) throw new Error("buildUpload needs the placeholder groups and the new lineups.");
    if (lineups.length !== groups.length) {
      throw new Error(`The entries file holds ${groups.length} different placeholder lineups but ${lineups.length} new lineups were given; the two counts must match.`);
    }
    const slotsList = lineups.map((lineup, i) => {
      const raw = Array.isArray(lineup) ? lineup : lineup?.slots;
      if (!Array.isArray(raw)) throw new Error(`Lineup ${i + 1} is not a list of nine player ids.`);
      const slots = raw.map(id => String(id).trim());
      const problems = structureErrors(slots, pool);
      if (problems.length > 0) throw new Error(`Lineup ${i + 1}: ${problems.join(" ")}`);
      return slots;
    });
    const seenSets = new Map();
    slotsList.forEach((slots, i) => {
      const key = slots.slice().sort(compareIds).join(",");
      if (seenSets.has(key)) throw new Error(`Lineup ${i + 1} has the same nine players as lineup ${seenSets.get(key) + 1}; every lineup must be different.`);
      seenSets.set(key, i);
    });

    // Which lineup each entry row takes. Every entry row must belong to exactly one group.
    groups.forEach((group, g) => {
      for (const entry of group.entries) {
        if (slotsOfLine.has(entry.lineIndex)) throw new Error(`Entry ${entry.entryId} is in more than one placeholder group.`);
        slotsOfLine.set(entry.lineIndex, slotsList[g]);
      }
    });
    for (const entry of parsed.entries) {
      if (!slotsOfLine.has(entry.lineIndex)) throw new Error(`Entry ${entry.entryId} is in no placeholder group.`);
    }
    if (slotsOfLine.size !== parsed.entries.length) throw new Error("The placeholder groups do not match the entry rows of this file.");
  }

  const outLines = parsed.lines.map((line, i) => {
    if (!slotsOfLine.has(i)) return line;
    const rawCells = parsed.rawCells[i];
    const roster = slotsOfLine.get(i).map(id => quoteCell(pool.get(id).nameId));
    return [...rawCells.slice(0, ROSTER_START), ...roster, ...rawCells.slice(ROSTER_END)].join(",");
  });
  const text = (parsed.bom ? BOM : "") + outLines.map((line, i) => line + parsed.eols[i]).join("");

  // Re-parse what was built and prove it is the original file with only the roster cells changed.
  const fail = why => {
    throw new Error(`The upload file failed its own check and was not produced: ${why}`);
  };
  const check = parseEntriesCsv(text);
  if (check.bom !== parsed.bom) fail("the byte order mark changed.");
  if (check.lines.length !== parsed.lines.length) fail(`it has ${check.lines.length} lines, the original has ${parsed.lines.length}.`);
  if (check.entries.length !== parsed.entries.length) fail(`it has ${check.entries.length} entry rows, the original has ${parsed.entries.length}.`);
  for (let i = 0; i < parsed.lines.length; i++) {
    if (check.eols[i] !== parsed.eols[i]) fail(`the line ending of line ${i + 1} changed.`);
    if (!slotsOfLine.has(i) && check.lines[i] !== parsed.lines[i]) {
      fail(byEntry != null && parsed.entries.some(e => e.lineIndex === i) ? `line ${i + 1} is an entry row with no lineup given but changed.` : `line ${i + 1} is not an entry row but changed.`);
    }
  }
  parsed.entries.forEach((before, k) => {
    const after = check.entries[k];
    const line = before.lineIndex;
    if (after.lineIndex !== line || after.entryId !== before.entryId) fail(`entry ${before.entryId} moved or changed its id.`);
    if (parsed.rawCells[line][0] !== check.rawCells[line][0]) fail(`the entry id text on line ${line + 1} changed.`);
    if (after.contestName !== before.contestName || after.contestId !== before.contestId || after.entryFee !== before.entryFee) {
      fail(`the contest cells of entry ${before.entryId} changed.`);
    }
    const rawBefore = parsed.rawCells[line];
    const rawAfter = check.rawCells[line];
    if (rawAfter.length !== rawBefore.length) fail(`line ${line + 1} has a different number of cells.`);
    for (let c = 0; c < rawBefore.length; c++) {
      if ((c < ROSTER_START || c >= ROSTER_END) && rawAfter[c] !== rawBefore[c]) fail(`cell ${c + 1} of line ${line + 1} is not a roster cell but changed.`);
    }
    const want = slotsOfLine.get(line);
    if (!want) return; // an entry row with no lineup given (byEntry only): its whole line was checked unchanged above
    after.roster.forEach((cell, s) => {
      if (idOfCell(cell) !== want[s] || cell !== pool.get(want[s]).nameId) {
        fail(`the ${DK_CLASSIC_SLOTS[s]} cell of entry ${before.entryId} does not hold the assigned player.`);
      }
    });
  });
  if (check.pool.size !== parsed.pool.size) fail("the player list changed.");
  return text;
}
