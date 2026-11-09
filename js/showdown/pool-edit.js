// What a Showdown pool row can have typed into it (optimizer standard B2 and B3, round 4): a star, a typed Proj and a typed Own.
// The same box as classic's ranked list (../typed-edit.js: Enter saves, a click away saves, Esc cancels, the hint under the box, `Not saved` for a refused number), written
// to the game's own overrides file (PUT /api/showdown/<key>/overrides; the server keeps stars and typed Proj under the man's FLEX id).
//
// One typed projection per man, as the board keeps it: the FLEX figure. The Captain's projection is 1.5x it (DraftKings), so a number typed in the Captain list's CPT Proj
// cell is stored as that number over 1.5 under his FLEX id; the Captain cell then shows that number to the display's one decimal (the stored figure is not rounded, so the box
// opens on what was typed, projPrefill), and no second projection is ever kept. Ownership is per seat, as
// published ownership is: a number typed in the FLEX list's Own cell is his FLEX ownership (under his FLEX id), one typed in the Captain list's CPT Own cell his Captain
// ownership (under his Captain id); a man with no Captain row has no Captain ownership box. A ± bump scales a projection only, never ownership, so the Own box opens on the figure
// shown. Every Own figure stays a published number, a typed one or blank (D29).
// Markup and wiring only: showdown/optimizer.js poolControls supplies the cells to the pool and showdown/lineup.js the writes. The writes are the app's PUT, or on the public site
// this device's own copy (site-src/showdown-api.js, site-overrides.js): `canWrite` is true where supports("overrides") is.
import { escapeHtml } from "../format.js";
import { startEdit, takeOpenEditor, showNotSaved } from "../typed-edit.js";
import { CPT_MULT, BUMP_STEP_PCT, bumpStepsOf } from "../bump-control.js";
import { isSetAside } from "./lineup-meter.js";

const idOf = (row) => String(row?.id ?? "");
const attr = (v) => escapeHtml(String(v ?? ""));

/** Whether Adam has typed `field` ("proj" or "own") for this man at `seat` ("flex" or "cpt"): the Captain's projection follows the one typed projection, his ownership has its own. */
export function isTyped(row, field, seat) {
  const o = row?.override;
  if (!o) return false;
  if (field === "proj") return o.proj != null;
  return (seat === "cpt" ? o.ownCpt : o.own) != null;
}

/** Whether the Own cell of `seat` can take a typed number: the Captain seat needs a Captain row (his Captain id). */
export const ownTypable = (row, seat) => seat !== "cpt" || (row?.cptId != null && row.cptId !== "");

// ---------- the PUT bodies (pure) ----------

/** A typed projection: kept as the FLEX figure. Typed on the Captain list, the number over 1.5 (rounded to six places), so the Captain cell shows what was typed. */
export function projPatch(row, seat, value) {
  const flex = seat === "cpt" ? Math.round((value / CPT_MULT) * 1e6) / 1e6 : value;
  return { proj: { [idOf(row)]: flex } };
}

/** A typed ownership: FLEX under his FLEX id, Captain under his Captain id; null when he has no Captain id to keep it under. */
export function ownPatch(row, seat, value) {
  const id = seat === "cpt" ? row?.cptId : row?.id;
  return id == null || id === "" ? null : { own: { [String(id)]: value } };
}

export const starPatch = (row) => ({ stars: { [idOf(row)]: !row?.starred } });

/** The number a box opens with: the cell's figure without his ± bump (the server scales a typed number by the bump again, so opening the bumped figure and pressing Enter would bump it twice). */
export function prefillOf(row, shown) {
  if (shown == null || !Number.isFinite(shown)) return null;
  const steps = bumpStepsOf(row);
  return steps ? shown / (1 + (BUMP_STEP_PCT / 100) * steps) : shown;
}

/** What a Proj box opens on (round 4, item 5): the number he typed (times 1.5 on the Captain list) when there is one, even if the lineup reads him as 0 (a revive set aside under
 *  TwoGun only), so an Enter can never store that 0 over it; else the figure without his bump (prefillOf). */
export function projPrefill(row, seat, shown) {
  const typed = row?.override?.proj;
  if (typed != null && Number.isFinite(Number(typed))) return seat === "cpt" ? Number(typed) * CPT_MULT : Number(typed);
  return prefillOf(row, shown);
}

/** The sentence a typed number that is set aside carries on hover (item 5): the ruling is "TwoGun mode ignores a revive". */
export const SET_ASIDE_TEXT = "Your number is not used: he is listed out and TwoGun is the only projection source ticked, so he counts 0 in lineups.";

// ---------- the cells ----------

/** The Proj (FLEX list) or CPT Proj (Captain list) cell around `figureHtml` as an editor: click to type. Plain when nothing can be written (`canWrite` false). */
export function projEditHtml(row, isCpt, figureHtml, canWrite) {
  if (!canWrite) return figureHtml;
  const seat = isCpt ? "cpt" : "flex";
  const aside = isSetAside(row); // a typed revive the lineup does not use: not drawn as his number, and the hover says why
  return `<span class="editable-cell" data-sd-edit="proj" data-seat="${seat}" data-id="${attr(row.id)}"><span class="cell-value${isTyped(row, "proj", seat) && !aside ? " is-override" : ""}"${aside ? ` title="${attr(SET_ASIDE_TEXT)}"` : ""}>${figureHtml}</span></span>`;
}

/** The Own / CPT Own cell around `text` as an editor; a typed number wears the amber emphasis (D54). A man with no Captain row has no editor on the Captain list. */
export function ownEditHtml(row, isCpt, text, canWrite) {
  const seat = isCpt ? "cpt" : "flex";
  if (!canWrite || !ownTypable(row, seat)) return text;
  return `<span class="editable-cell" data-sd-edit="own" data-seat="${seat}" data-id="${attr(row.id)}"><span class="cell-value${isTyped(row, "own", seat) ? " is-override" : ""}">${text}</span></span>`;
}

/** The star cell's button; on the site a published star shows as a star and nothing else (no write path), an unstarred man shows nothing. */
export function starHtml(row, canWrite) {
  const on = Boolean(row?.starred);
  if (!canWrite) return on ? `<span class="star-btn active star-static" title="Starred">★</span>` : "";
  return `<button type="button" class="star-btn${on ? " active" : ""}" title="${on ? "Starred" : "Star"}" aria-pressed="${on}" data-action="toggle-star" data-id="${attr(row.id)}">${on ? "★" : "☆"}</button>`;
}

// ---------- the boxes ----------

let lastOpen = null; // {id, field, seat} of the number box that is open, so a redraw can put it back in the same cell

function cssId(id) {
  const s = String(id);
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}

/**
 * ctx = { rowOf(id), figureOf(row, field, isCpt) (the cell's figure), save(row, field, seat, value) -> Promise<boolean>,
 * toggleStar(row) -> Promise<boolean>, rowError(id, text) }. A save that was refused or lost is said beside the man's row, in red (the board write says why above).
 */
function beginNumber(cell, ctx, carry = null) {
  if (cell.querySelector?.("input")) return;
  const { sdEdit: field, seat, id } = cell.dataset;
  const row = ctx.rowOf(id);
  if (!row) return;
  cell.querySelectorAll?.(".cell-not-saved").forEach((note) => note.remove()); // a `Not saved` still showing (it stays 4 seconds) is not part of the figure that comes back
  const original = cell.innerHTML;
  lastOpen = { id, field, seat };
  const shown = ctx.figureOf(row, field, seat === "cpt");
  startEdit(cell, id, field, field === "proj" ? projPrefill(row, seat, shown) : shown, (savedId, f, value, info) => { // a bump scales a projection only, never ownership (merge.js), so Own opens on what is shown
    lastOpen = null;
    cell.innerHTML = original; // the old figure shows while the write is out; the answered board redraws the cell
    if (savedId == null) {
      if (info?.notSaved) showNotSaved(cell, info.notSaved); // a refused number on a click away: nothing saved, and it says so (A3)
      return;
    }
    cell.classList?.add(PENDING); // item 15: the figure looks pending until the answer redraws it; a refusal puts it back
    Promise.resolve(ctx.save(row, field, seat, value)).then((taken) => {
      if (!taken) {
        cell.classList?.remove(PENDING);
        ctx.rowError?.(row.id, "The number was not saved. The message above says why.");
      }
    });
  }, carry);
}

const PENDING = "is-pending"; // style.css: a dimmed, slowly pulsing figure or star while its write is out

/** Wires the stars and the number cells under `root` (called after every draw of the pool's rows). */
export function wirePoolEdits(root, ctx) {
  root.querySelectorAll("[data-action='toggle-star']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = ctx.rowOf(btn.dataset.id);
      if (!row || btn.disabled) return;
      btn.disabled = true; // one write at a time per star; the answered board draws it again
      btn.classList?.add(PENDING);
      Promise.resolve(ctx.toggleStar(row)).then((taken) => {
        if (!taken) {
          btn.disabled = false;
          btn.classList?.remove(PENDING);
          ctx.rowError?.(row.id, "The star was not saved. The message above says why.");
        }
      });
    });
  });
  root.querySelectorAll("[data-sd-edit]").forEach((cell) => cell.addEventListener("click", () => beginNumber(cell, ctx)));
}

/** Before the pool's rows are redrawn: the open box, taken out (its removal is not a click away) and described for restorePoolEdit; null when none is open in `within`. */
export function takePoolEdit(within) {
  const carry = takeOpenEditor(within);
  return carry ? { ...carry, seat: carry.kind === "field" ? lastOpen?.seat : undefined } : null;
}

/** After the redraw: the box goes back in the new cell with its text and focus. A man no longer listed (a filter hid him) drops it with no write. */
export function restorePoolEdit(root, carry, ctx) {
  if (!carry) return;
  const cell = root.querySelector?.(`[data-sd-edit="${carry.field}"][data-seat="${carry.seat}"][data-id="${cssId(carry.id)}"]`);
  if (cell) beginNumber(cell, ctx, carry);
}
