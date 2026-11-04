// Every board write and every board read of the classic page goes through one numbered flow (A3, round 3 fix batch items 2 and 9), so an answer that started earlier can never paint over
// a newer one: write-seq.js numbers each as it starts and hands out the right to paint. A write's answer that is not painted (a newer answer already was) is not left to stand as the
// last word: the board is read once more, numbered like any other, so the screen ends on what the server holds even if the two writes reached it in the other order. A write that
// failed paints nothing and takes nothing, so an older answer still lands. app.js builds one flow and hands it the page's own painter and failure message.
/**
 * `seq`: makeWriteSeq(); `getBoard()`: the board read; `paint(board, n)`: draws a board answer (the page's handleBoardLoaded); `fail(text, rowId)`: says a write failed.
 * Returns {runWrite(action, {rowId, label}), loadBoard({okOnly})}. runWrite answers the data of a good write, or null for a refused or lost one.
 */
export function makeBoardFlow({ seq, getBoard, paint, fail }) {
  const drawn = (p) => Promise.resolve(p).catch((e) => fail(`The board could not be drawn: ${e?.message ?? e}`, null));

  /** Reads the board and paints it unless a newer answer has been painted meanwhile. `okOnly`: a board that is not ok is returned, never painted (the last good one stays). */
  async function loadBoard({ okOnly = false } = {}) {
    const n = seq.start();
    const board = await getBoard();
    if ((!okOnly || board?.ok) && seq.take(n)) await paint(board, n);
    return board;
  }

  async function runWrite(action, { rowId, label = "the override" } = {}) {
    const mine = seq.start();
    try {
      const data = await action();
      if (!data || !data.ok) {
        fail(`Could not save ${label}: ${data?.error?.message ?? "unknown error"}`, rowId);
        return null;
      }
      if (seq.take(mine)) {
        drawn(paint(data, mine));
      } else {
        // An older answer: a newer one is on screen. The two may have reached the server in either order, so the board is read once more and that read is painted.
        drawn(loadBoard().catch((e) => fail(`The board could not be reread after ${label}: ${e?.message ?? e}`, null)));
      }
      return data;
    } catch (e) {
      fail(`Could not save ${label}: ${e.message}`, rowId);
      return null;
    }
  }

  return { runWrite, loadBoard };
}
