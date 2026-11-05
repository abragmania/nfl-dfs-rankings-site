// What the Showdown pool's star, typed Proj and Own cells and note pencil need (pool-edit.js wirePoolEdits), and the two messages a pool row can carry beside itself:
// moved out of lineup.js (round 5, to keep that file under its cap) unchanged in behaviour. The panel's state, its redraw and view.js's board writer come in as arguments,
// because lineup.js owns them and reassigns the writer when the view is drawn.
import { rowIsOut } from "../table.js";
import { putShowdownOverrides } from "./optimizer.js";
import { projPatch, ownPatch, starPatch, notePatch } from "./pool-edit.js"; // B2, B3, C23
import { playerFigures } from "./lineup-meter.js";
import { findRow } from "./lineup-saved.js";

export const SET_ASIDE_NOTICE = "He is listed out and TwoGun is the only projection source ticked, so your number does not bring him back: he counts 0 in lineups.";

/** A failed write for a pool row is said beside that row, in red (B12, B3). */
export function rowErrorIn(state, commit, id, text) {
  state.addErrorId = String(id);
  state.addError = text;
  state.addTone = "error";
  commit();
}

/** A short notice beside a pool row, amber (a refusal's tone, not an error): the write was taken, and this is what it did not do. */
export function rowNoticeIn(state, commit, id, text) {
  state.addErrorId = String(id);
  state.addError = text;
  state.addTone = undefined;
  commit();
}

/** What the star, the typed Proj and Own cells and the pencil need: the writes go through view.js's board writer (`boardWrite()` gives the current one, or null), which applies the answered board and
 *  says a refusal in the status line; each answers whether the server took it. */
export function editCtxFor({ board, state, commit, boardWrite }) {
  const rowError = (id, text) => rowErrorIn(state, commit, id, text);
  const write = (patch, label) => {
    const writer = boardWrite();
    return patch && writer ? writer((key) => putShowdownOverrides(key, patch), label) : Promise.resolve(false);
  };
  return {
    rowOf: (id) => findRow(board, id),
    figureOf: (row, field, isCpt) => {
      const f = playerFigures(row, isCpt);
      return field === "proj" ? f.proj : f.own;
    },
    save: async (row, field, seat, value) => {
      const taken = await write(field === "proj" ? projPatch(row, seat, value) : ownPatch(row, seat, value), "the typed number");
      // Item 5: while TwoGun is the only projection source ticked, a typed number does not bring a man listed out back (the standing ruling); say so beside his row at the write.
      if (taken && field === "proj" && value > 0 && rowIsOut(row) && board?.mode?.cashMode === "twogun") rowNoticeIn(state, commit, row.id, SET_ASIDE_NOTICE);
      return taken;
    },
    saveNote: (row, text) => write(notePatch(row, text), "the note"),
    toggleStar: (row) => write(starPatch(row), "the star"),
    rowError,
  };
}
