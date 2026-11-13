// What a classic pool row can have typed into it (optimizer standard A3, C9, C10, C17): a typed Proj and a typed Own. The box is typed-edit.js's, the same one the
// Showdown pool uses: Enter saves, a click away saves, Esc cancels, the hint `Enter saves, Esc cancels` sits under the box, `Not saved` says a refused number, an emptied number box cancels. The pool is redrawn by innerHTML, so one delegated click listener on its mount serves every redraw, and a box that is open when a redraw comes is taken out first and put back with its
// text and focus (takePoolEdit, restorePoolEdit): its removal is never read as a click away. The writes are app.js's (lineup-pool.js poolWriters: onEditValue).
import { startEdit, takeOpenEditor, showNotSaved, carryNotSaved, dropHeldNotSaved } from "./typed-edit.js";
import { bumpStepsOf, BUMP_STEP_PCT } from "./bump-control.js";
import { rowIsOut, projWithoutOut } from "./out.js";
import { poolWriters, projCellInner, ownCellInner } from "./lineup-pool.js";

function cssId(id) {
  const s = String(id);
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}

/** What a Proj box opens on: the number he typed when there is one, else the figure shown without his bump (the server scales a typed number by the bump again, so opening the bumped figure and pressing Enter would bump it twice). */
export function projPrefill(row) {
  const typed = row?.override?.proj;
  if (typed != null && Number.isFinite(Number(typed))) return Number(typed);
  if (rowIsOut(row)) return projWithoutOut(row); // an out man's figure is 0: the box opens on what he would have without the Out (TwoGun's or the blend, bump removed), never 0
  if (row?.proj == null || !Number.isFinite(Number(row.proj))) return null;
  const steps = bumpStepsOf(row);
  return steps ? Number(row.proj) / (1 + (BUMP_STEP_PCT / 100) * steps) : Number(row.proj);
}

const innerFor = (row, field) => (field === "proj" ? projCellInner(row, { canReset: Boolean(poolWriters()?.onBump) }) : ownCellInner(row, { canReset: Boolean(poolWriters()?.onBump) }));

/** Opens the number box on a Proj or Own cell and wires what closing it does: the cell's own restore, and the write. `carry`: the box a redraw took out. */
function beginNumber(cell, ctx, carry = null) {
  if (cell.querySelector?.("input") || !poolWriters()?.onEditValue) return;
  const { field, id } = cell.dataset;
  const row = ctx.rowOf(id);
  if (!row) return;
  cell.querySelectorAll?.(".cell-not-saved").forEach((note) => note.remove()); // a `Not saved` still showing is not part of the figure that comes back
  startEdit(cell, id, field, field === "proj" ? projPrefill(row) : row.own, (savedId, f, value, info) => {
    if (savedId == null) {
      cell.innerHTML = innerFor(row, field);
      if (info?.notSaved) showNotSaved(cell, info.notSaved, undefined, undefined, { id, field }); // a refused number on a click away: nothing saved, and it says so (A3); a redraw keeps it for its time
      return;
    }
    dropHeldNotSaved();
    cell.innerHTML = innerFor(row, field); // the old figure shows while the write is out; the answered board redraws the cell
    poolWriters()?.onEditValue?.(savedId, f, value);
  }, carry);
}

const wired = new WeakSet();

/** One click listener on the pool's mount (set once, it serves every redraw): a click on a Proj or Own figure opens its box. `ctx.rowOf(id)`: the live board row. */
export function wirePoolEdits(root, ctx) {
  if (!root?.addEventListener || wired.has(root)) return;
  wired.add(root);
  root.addEventListener("click", (e) => {
    if (e.target?.closest?.("button")) return; // the small x (and every other button) is its own control
    const cell = e.target?.closest?.(".editable-cell");
    if (cell && root.contains(cell)) beginNumber(cell, ctx);
  });
}

/** Before the pool is redrawn: the open box, taken out of the redraw's way (null when none is open in `within`). */
export function takePoolEdit(within) {
  return takeOpenEditor(within);
}

/** After the redraw: the box goes back in the new cell with its text and focus; a man no longer listed (a filter hid him) drops it with no write. */
export function restorePoolEdit(root, carry, ctx) {
  carryNotSaved((id, field) => root.querySelector?.(`.editable-cell[data-id="${cssId(id)}"][data-field="${field}"]`)); // a `Not saved` still showing survives the redraw a click on a row makes
  if (!carry) return;
  const cell = root.querySelector?.(`.editable-cell[data-id="${cssId(carry.id)}"][data-field="${carry.field}"]`);
  if (cell) beginNumber(cell, ctx, carry);
}
