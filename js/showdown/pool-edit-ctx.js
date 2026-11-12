// What the Showdown pool's star, typed Proj and Own cells need (pool-edit.js wirePoolEdits), and the two messages a pool row can carry beside itself:
// moved out of lineup.js (round 5, to keep that file under its cap) unchanged in behaviour. The panel's state, its redraw and view.js's board writer come in as arguments,
// because lineup.js owns them and reassigns the writer when the view is drawn.
import { putShowdownOverrides } from "./optimizer.js";
import { projPatch, ownPatch, starPatch } from "./pool-edit.js"; // B2, B3
import { statusPatch } from "../status-switch.js"; // Adam 2026-11-12: In / Out / Auto
import { playerFigures } from "./lineup-meter.js";
import { findRow } from "./lineup-saved.js";

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

/** What the star, the typed Proj and Own cells need: the writes go through view.js's board writer (`boardWrite()` gives the current one, or null), which applies the answered board and
 *  says a refusal in the status line; each answers whether the server took it. */
export function editCtxFor({ board, state, commit, boardWrite }) {
  const rowError = (id, text) => rowErrorIn(state, commit, id, text);
  // Part F: the write goes to the tab on screen (view.js passes it as `tab`); a star is kept once for both tabs (`shared`), so the other tab's board is read again.
  const write = (patch, label, shared = false) => {
    const writer = boardWrite();
    return patch && writer ? writer((key, tab) => putShowdownOverrides(key, patch, undefined, tab), label, { shared }) : Promise.resolve(false);
  };
  return {
    rowOf: (id) => findRow(board, id),
    figureOf: (row, field, isCpt) => {
      const f = playerFigures(row, isCpt);
      return field === "proj" ? f.proj : f.own;
    },
    save: (row, field, seat, value) => write(field === "proj" ? projPatch(row, seat, value) : ownPatch(row, seat, value), "the typed number"), // a typed number always wins (Adam 2026-11-12)
    toggleStar: (row) => write(starPatch(row), "the star", true),
    setStatus: (row, next) => write(statusPatch(row.id, next), "the In / Out setting", true), // kept once for both tabs, as a star
    rowError,
  };
}
