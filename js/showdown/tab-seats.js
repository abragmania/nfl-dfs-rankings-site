// The GPP and Cash tabs each keep their own working lineup (optimizer standard Part F, Adam 5:12 PM 2026-11-04: building a cash lineup never touches the GPP settings and the other way round).
// seats.js `state.cpt` / `state.flex` stay the seats of the tab on screen, so every reader of the seats is unchanged; this module holds the seats of each tab, swaps them at a tab switch and
// remembers them per game (view-memory.js: GPP's in the entry's `lineup`, where the one shared lineup was kept before the tabs, Cash's in `lineupCash`). DOM-free.
import { state } from "./seats.js";
import { MODES } from "./optimizer-state.js";
import { restoreLineup, saveLineup, dropMenGoneFromBoard } from "./view-memory.js";
import { FLEX_COUNT } from "./lineup-saved.js";

const emptySeats = () => ({ cpt: null, flex: new Array(FLEX_COUNT).fill(null), note: "" });
const held = { gpp: emptySeats(), cash: emptySeats() }; // each tab's seats; the one on screen is state's, its copy here is stale until the next switch
let onTab = null; // the tab state.cpt and state.flex belong to; null until a game's first draw

/** A game is loaded: both tabs' remembered lineups come back (each checked against the board), nothing is on screen yet (showTabSeats puts the tab on screen next). */
export function loadTabSeats(key, board) {
  for (const mode of MODES) held[mode] = restoreLineup(key, board, FLEX_COUNT, mode);
  onTab = null;
  state.cpt = null;
  state.flex = new Array(FLEX_COUNT).fill(null);
}

/** Puts `mode`'s seats on screen, the tab left keeping its own; returns the sentence naming men a remembered lineup lost that has not been said yet ("" when none). */
export function showTabSeats(mode) {
  if (onTab === mode) return "";
  if (onTab !== null) held[onTab] = { cpt: state.cpt, flex: state.flex, note: "" };
  const next = held[mode];
  state.cpt = next.cpt;
  state.flex = next.flex;
  onTab = mode;
  held[mode] = { ...next, note: "" };
  return next.note;
}

/** A new board for the game on screen (a refresh, a re-upload): a man it no longer has is taken out of both tabs' lineups (view-memory.js dropMenGoneFromBoard). Returns the sentence naming who left the tab on
 *  screen ("" when none); the other tab's is kept and said when that tab is shown. */
export function dropGoneFromTabs(key, board) {
  let note = "";
  const mine = dropMenGoneFromBoard(key, board, state.cpt, state.flex);
  if (mine.note) {
    state.cpt = mine.cpt;
    state.flex = mine.flex;
    note = mine.note;
  }
  const other = onTab === "gpp" ? "cash" : "gpp";
  const kept = dropMenGoneFromBoard(key, board, held[other].cpt, held[other].flex);
  if (kept.note) held[other] = { cpt: kept.cpt, flex: kept.flex, note: [held[other].note, kept.note].filter(Boolean).join(" ") };
  return note;
}

/** Remembers both tabs' lineups under the game (each is written only when it changed). */
export function saveTabSeats(key, board) {
  if (onTab === null) return;
  saveLineup(key, board, state.cpt, state.flex, onTab);
  const other = onTab === "gpp" ? "cash" : "gpp";
  saveLineup(key, board, held[other].cpt, held[other].flex, other);
}

/** Test hook: the tab the seats on screen belong to. */
export const seatsTab = () => onTab;
