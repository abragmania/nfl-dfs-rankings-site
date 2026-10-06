// Favorites tab: every starred player on the loaded slate, drawn with the Rankings table's own head, row
// and cell rendering (table.js) so the look, the star, click-to-edit Proj/Own% and the note pencil all come
// along unchanged. It ignores the Rankings filters and the classic projection floor (a starred player always
// shows, even with a projection of 3 or less or none). The star and edit clicks go through the same
// callbacks as Rankings, so un-starring here saves through the same overrides API and the row leaves at once.
import { renderTableHead, renderTableBody } from "./table.js";

export const FAVORITES_NOTE_TEXT = "Starred players for this week's slate. Stars are saved with the week.";
// Two parts so the public site can hide the second (stars cannot be clicked there).
export const FAVORITES_EMPTY_LEAD = "No favorites yet.";
export const FAVORITES_EMPTY_HINT = "Click the star next to a player on the Rankings tab to add him here.";
export const FAVORITES_EMPTY_TEXT = `${FAVORITES_EMPTY_LEAD} ${FAVORITES_EMPTY_HINT}`;

const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, DST: 4 };
function posRank(pos) {
  return Object.prototype.hasOwnProperty.call(POS_ORDER, pos) ? POS_ORDER[pos] : Object.keys(POS_ORDER).length;
}

/** The starred rows only, in roster order (QB, RB, WR, TE, DST, any other position last), then salary high to
 * low, then projection high to low (no projection last), then name. Pure: does not touch the input array. */
export function favoriteRows(rows) {
  return (rows ?? [])
    .filter((r) => r && r.starred)
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const pa = posRank(a.row.pos);
      const pb = posRank(b.row.pos);
      if (pa !== pb) return pa - pb;
      const sa = Number.isFinite(a.row.salary) ? a.row.salary : -Infinity;
      const sb = Number.isFinite(b.row.salary) ? b.row.salary : -Infinity;
      if (sa !== sb) return sb - sa;
      const ja = a.row.proj;
      const jb = b.row.proj;
      const aNull = ja == null;
      const bNull = jb == null;
      if (aNull !== bNull) return aNull ? 1 : -1;
      if (!aNull && ja !== jb) return jb - ja;
      const byName = String(a.row.name ?? "").localeCompare(String(b.row.name ?? ""));
      return byName !== 0 ? byName : a.i - b.i;
    })
    .map((x) => x.row);
}

/** "Favorites (3)", or plain "Favorites" with none. */
export function favoritesTabLabel(count) {
  return count > 0 ? `Favorites (${count})` : "Favorites";
}

/** Draws the panel's contents. `els` = { note, empty, wrap, thead, tbody } (the elements in
 * index.html's #favorites-panel); `rows` = the whole board's rows. */
export function renderFavoritesPanel(els, rows, callbacks, hasNoteColumn) {
  const favs = favoriteRows(rows);
  const none = favs.length === 0;
  els.note.hidden = none;
  els.empty.hidden = !none;
  els.empty.innerHTML = `<span>${FAVORITES_EMPTY_LEAD}</span> <span class="favorites-empty-hint">${FAVORITES_EMPTY_HINT}</span>`;
  els.wrap.hidden = none;
  if (none) {
    els.thead.innerHTML = "";
    renderTableBody(els.tbody, [], callbacks, hasNoteColumn);
    return;
  }
  // No sorting in this first version: no column is marked sorted and a header click does nothing.
  renderTableHead(els.thead, { col: null, dir: "asc" }, () => {}, hasNoteColumn);
  renderTableBody(els.tbody, favs, callbacks, hasNoteColumn);
}
