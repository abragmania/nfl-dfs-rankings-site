// The GPP and Cash tabs' own boards for the game on screen (optimizer standard Part F, Adam 1:08 PM 2026-11-05: GPP and Cash typed numbers are different). The server answers
// each tab's board on `?tab=` (server/showdown/override-tabs.js); this keeps both, so a tab switch shows the other's at once and reads nothing it already has. Each tab has its
// own numbered flow (write-seq.js, write-runner.js, the classic page's rule): an answer older than one already painted on that tab is not painted. An answer is kept for the
// tab it was asked for and painted only while that tab is on screen, so a late answer for the other tab never paints over the one shown. A star or a note is kept once for both
// tabs, so a write of one re-reads the other tab's board. DOM-free; view.js gives it the reads, the tab on screen and the painter.
import { makeWriteSeq } from "../write-seq.js";
import { makeBoardFlow } from "../write-runner.js";

export const BOARD_TABS = Object.freeze(["gpp", "cash"]);
export const otherTab = (tab) => (tab === "cash" ? "gpp" : "cash");
export const tabWord = (tab) => (tab === "cash" ? "Cash" : "GPP");

/**
 * deps = { read(key, tab): the board read (api.js getShowdownBoard), shape(raw): the board as the page keeps it (board-shape.js normalizeBoard), shownTab(): the tab on screen,
 * show(board, tab, key): paints the tab on screen's board, fail(text): says a write or read failed }.
 */
export function makeTabBoards({ read, shape = (b) => b, shownTab, show, fail }) {
  let key = null;
  let gen = 0; // one number per visit to a game: an answer asked on an earlier visit, even to the same game, is never kept
  let boards = { gpp: null, cash: null };
  let seqs = null;
  let flows = null;
  let drew = undefined; // what the last land()'s show() answered: a painter that waits (classic's, for the salary warnings) hands the flow its promise

  /** Keeps a board answer for `tab` of game `forKey` (asked in visit `asked`, the current one when absent); paints it when that tab is on screen. False (and nothing kept) for
   *  another game's answer or an earlier visit's. `n`, the flow's number, is handed to show() (absent for an answer taken by hand). */
  function land(forKey, tab, raw, asked = gen, n) {
    drew = undefined;
    if (asked !== gen || forKey !== key || (raw?.key && raw.key !== forKey)) return false;
    boards = { ...boards, [tab]: shape(raw) };
    if (tab === shownTab()) drew = show(boards[tab], tab, forKey, n);
    return true;
  }

  function start(k) {
    key = k;
    const g = ++gen;
    boards = { gpp: null, cash: null };
    seqs = { gpp: makeWriteSeq(), cash: makeWriteSeq() };
    flows = Object.fromEntries(BOARD_TABS.map((tab) => [tab, makeBoardFlow({ seq: seqs[tab], getBoard: () => read(k, tab), paint: (raw, n) => (land(k, tab, raw, g, n) ? drew : false), fail })]));
  }
  start(null);

  /** Reads `tab`'s board again; kept, and painted when on screen, unless a newer answer for it was painted meanwhile. Resolves to the answer. A failure is said, never thrown. */
  function reread(tab) {
    return flows[tab].loadBoard({ okOnly: true }).catch((e) => {
      fail(`The ${tabWord(tab)} tab's board could not be read: ${e?.message ?? e}`);
      return null;
    });
  }

  return {
    key: () => key,
    visit: () => gen, // the current visit's number (land's `asked`)
    /** Another game: both tabs' boards are dropped and answers for the last game are not kept. The same game keeps its boards. */
    setKey(k) {
      if (k !== key) start(k);
    },
    board: (tab) => boards[tab] ?? null,
    /** A read, a refresh or a paste for `tab` is starting: its number (take(tab, n) when it answers). */
    begin: (tab) => seqs[tab].start(),
    take: (tab, n) => seqs[tab].take(n),
    /** True while no newer answer for `tab` has been painted (write-seq.js current): the check a painter that waits makes again. */
    current: (tab, n) => seqs[tab].current(n),
    land,
    reread,
    /** A read of `tab`'s board through its flow, which paints it unless newer ones were painted meanwhile; unlike reread it throws, and `okOnly` false paints a refused answer (the page's failure line). */
    load: (tab, opts) => flows[tab].loadBoard(opts),
    /**
     * A write on `tab` (a typed number, a bump, a revive, a row reset, Reset all, a star, a note): `send(key, tab)` makes the request, which answers that tab's board.
     * `shared` (a star or a note, kept once for both tabs): the other tab's board is read again once the write is taken. `rowId`: said beside that row on a refusal (classic's fail).
     * Resolves to the answer, or null when it was not taken.
     */
    async write(tab, send, label, { shared = false, rowId } = {}) {
      const k = key;
      const g = gen;
      const data = await flows[tab].runWrite(() => send(k, tab), { label, rowId });
      if (data !== null && shared && g === gen) reread(otherTab(tab));
      return data;
    },
  };
}
