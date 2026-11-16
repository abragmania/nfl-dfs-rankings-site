// Classic seating of a COMPLETE lineup (Adam 2026-11-09): the latest-kickoff spare goes to FLEX, as the DraftKings download writes it
// (the Download CSV's own function, server/lineup/dk-entries.js assignSlots, called here, never a second copy), on the file ids and prices of the slate on screen (D56, D57).
// Pure; no DOM, no state. A lineup that is not nine men, has a man off the board, with no id in that slate's file, with no salary or no kickoff for a man's game is returned
// as it came (never guessed at): a partly filled working lineup is never moved while the user is seating men, and a stored record is re-seated when drawn, never rewritten.
import { assignSlots } from "../server/lineup/dk-entries.js";
import { classicFileIds } from "./entries-plan.js";

const NINE = 9;

/** gameId -> kickoff (ISO) from the board's games (the DraftKings file's own times, D13); a function `(gameId) => string | null`. */
export function kickoffLookup(board) {
  const kickoffs = new Map((board?.slate?.games ?? []).map((g) => [String(g.id), g.kickoffUtc ?? null]));
  return (gameId) => kickoffs.get(String(gameId)) ?? null;
}

/**
 * The file's view of a classic lineup, the one copy the DK CSV and reseatClassic both read: `rows` are the slots' board rows, in the slots' order; `slateKey` and `slates`
 * (board.slates) choose the file. Answers {ids, pool, kickoffById}: the file ids in the slots' order, id -> man at the slate's own price (the board's where the slate kept none),
 * id -> kickoff. Null when a man has no id in that slate's file (classicFileIds). A salary is left as the board has it, so a missing one stays missing for the caller to refuse.
 */
export function classicFilePool(slots, rows, slateKey, slates, kickoffOf) {
  const ids = classicFileIds(slots, slateKey, slates);
  if (!ids) return null;
  const record = slateKey && slateKey !== "main" ? (slates ?? []).find((s) => s?.key === slateKey) ?? null : null;
  const pool = new Map();
  const kickoffById = new Map();
  rows.forEach((row, i) => {
    const own = record?.prices ? record.prices[String(row.id)] : undefined;
    pool.set(ids[i], { name: row.name, pos: row.pos, team: row.team, salary: Number.isFinite(own) ? own : row.salary, gameInfo: row.gameId });
    kickoffById.set(ids[i], kickoffOf(row.gameId));
  });
  return { ids, pool, kickoffById };
}

/**
 * `slots`: [{slot, playerId, ...}] (saved record or save payload). `rowById`: the board's rows by id. `kickoffOf`: kickoffLookup(board). `slateKey` and `slates`: the slate on
 * screen (slateKeyOf(board), board.slates); none given is the main slate.
 * Returns the same entries re-seated in the DraftKings order (QB, RB, RB, WR, WR, WR, TE, FLEX, DST) with each entry's `slot` set to its new seat;
 * or `slots` itself when the lineup cannot be re-seated.
 */
export function reseatClassic(slots, rowById, kickoffOf, slateKey = "main", slates = []) {
  if (!Array.isArray(slots) || slots.length !== NINE) return slots;
  const rows = slots.map((entry) => rowById?.get?.(String(entry?.playerId ?? "")));
  if (rows.some((row) => !row)) return slots;
  const made = classicFilePool(slots, rows, slateKey, slates, kickoffOf);
  if (!made || new Set(made.ids).size !== NINE) return slots;
  if ([...made.pool.values()].some((man) => !Number.isFinite(man.salary))) return slots; // a missing salary is not $0: the Download CSV refuses him and names why
  const entryOf = new Map(made.ids.map((id, i) => [id, slots[i]]));
  let order;
  try {
    order = assignSlots(made.ids, made.pool, made.kickoffById);
  } catch {
    return slots; // a lineup DraftKings could not seat (positions, no kickoff) stays as stored; Download CSV names why
  }
  const seats = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"];
  return order.map((id, i) => ({ ...entryOf.get(id), slot: seats[i] }));
}
