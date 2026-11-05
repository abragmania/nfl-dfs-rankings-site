// The saved cards' wiring on the Lineups tab (moved out of lineup.js, which keeps the state and hands this what it acts through): Download DK CSV for the ticked lineups, rename, the letter, Delete and Load.
// Wired exactly as they were under the Optimizer tab, where the saved cards used to be drawn.
import { wireDkDownload } from "../dk-lineup-ui.js"; // A12: Download DK CSV for the saved lineups ticked
import { wireSavedCards } from "./lineup-saved.js";
import { putShowdownLineupName, putShowdownLineupTag } from "./api.js";

/** `shown()` the saved lineups the tab shows (what Download DK CSV acts on); `d` = {state (seats.js), commit(), putCard(key, id, send), doDeleteLineup(key, id), requestLoad(kind, id)}. */
export function wireSavedActions(root, board, key, shown, d) {
  const { state, commit } = d;
  wireDkDownload(root, {
    selected: state.dkSelected,
    shown,
    kind: "showdown",
    board: () => board,
    slateLabel: () => key ?? "",
    setStatus: (text) => { state.dkStatus = text; },
    redraw: commit,
  });
  wireSavedCards(root, {
    renameStart: (id) => {
      state.renamingId = id;
      state.deleteConfirmId = null;
      commit();
    },
    renameCancel: () => {
      state.renamingId = null;
      commit();
    },
    renameSave: (id, name) => { state.renamingId = null; d.putCard(key, id, () => putShowdownLineupName(key, id, name)); },
    tag: (id, tag) => d.putCard(key, id, () => putShowdownLineupTag(key, id, tag)),
    deleteStart: (id) => {
      state.deleteConfirmId = id;
      state.renamingId = null;
      delete state.deleteErrors[id]; // a new try clears the last delete's failure sentence (A12)
      commit();
    },
    deleteNo: () => {
      state.deleteConfirmId = null;
      commit();
    },
    deleteYes: (id) => d.doDeleteLineup(key, id),
    load: (id) => d.requestLoad("saved", id),
  });
}
