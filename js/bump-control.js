// Adam 2026-10-22: ± bump. Every Optimizer pool row (classic and Showdown, Cash and GPP) carries a thumbs-up and thumbs-down pair
// (Adam 12:45 PM: one filled thumb per step, green up, red down): each press moves that player's projection and his other point
// projections by 5% on the server, presses stack (up twice = +10%) from -10 to +10 steps, and the opposite thumb clears the
// adjustment to 0 (Adam 3:20 PM). The browser sends only the new step count (PUT .../overrides {bump: {id: steps}}, 0 sent as null
// to remove it) and redraws from the board the server answers; the board row carries override.bump (absent when none), proj already
// bumped and projBase. This file is the one copy of the pair's and the projection cell's markup and of the click; each pool supplies
// the request.
import { escapeHtml, dec1 } from "./format.js";

export const BUMP_STEP_PCT = 5;
export const BUMP_MAX_STEPS = 10;
const MINUS = "−"; // a real minus sign, never a hyphen
const THUMB_PATH = "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"; // Material thumb_up, 24x24
const THUMB_SVG = `<svg class="thumb" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${THUMB_PATH}"/></svg>`;

/** The row's bump in steps: row.override.bump, 0 when it has none (the server sends no key then, never null). */
export function bumpStepsOf(row) {
  const n = Number(row?.override?.bump ?? 0);
  return Number.isInteger(n) ? n : 0;
}

/** The steps one press leaves: one more in the same direction; the opposite thumb clears the adjustment to 0 (Adam 2026-10-22 3:20 PM), kept within -10..10. */
export function nextBumpSteps(current, dir) {
  if ((current > 0 && dir < 0) || (current < 0 && dir > 0)) return 0;
  return Math.max(-BUMP_MAX_STEPS, Math.min(BUMP_MAX_STEPS, current + (dir > 0 ? 1 : -1)));
}

/** "+10%", "−5%" (U+2212); "" at 0. */
export function bumpPctText(steps) {
  if (!steps) return "";
  return `${steps > 0 ? "+" : MINUS}${Math.abs(steps) * BUMP_STEP_PCT}%`;
}

/** The PUT body of one press, for either pool: 0 steps is sent as null, which removes the bump. */
export function bumpPatch(id, steps) {
  return { bump: { [String(id)]: steps || null } };
}

/** The Captain's projection is 1.5x the man's (DraftKings Showdown), so the Captain list's hover reads his Captain figures (bumpProjHtml). */
export const CPT_MULT = 1.5;

/**
 * The thumbs inside one button: `count` filled thumbs when that side is on, otherwise one outline thumb. Several thumbs fan out
 * like a hand, `fan` px apart (6px for two or three, then 12px shared among the gaps: 4px at four, 3px at five, 1.33px at ten), so
 * the thumbs never span more than 23px (27px with the button's padding and border; the .bump-ctl slot holds that, so nothing shifts).
 */
function thumbsHtml(count) {
  const n = Math.max(1, count);
  const fan = n <= 1 ? 0 : n <= 3 ? 6 : (12 / (n - 1));
  return { svgs: THUMB_SVG.repeat(n), style: n <= 1 ? "" : ` style="--fan:${Math.floor(fan * 100) / 100}px"` };
}

/**
 * The pair alone (no chip, 👁 2026-10-22: a chip widened the column): a thumbs-down and a thumbs-up button, each showing one
 * filled thumb per step on its side (green up, red down) and one outline thumb when its side is off. `enabled` false draws both
 * buttons disabled (no write is wired); a row with no projection draws them disabled too (nothing to move). `kind` "cpt" is the
 * Showdown Captain list. `title` (plain text) replaces both buttons' hover, for a pair that cannot run (the public site's disabled pair, D71);
 * null keeps each button's own words.
 */
export function bumpControlHtml(row, { enabled = true, kind = null, title = null } = {}) {
  const id = escapeHtml(String(row?.id ?? ""));
  const name = escapeHtml(row?.name ?? "this player");
  const steps = bumpStepsOf(row);
  const live = enabled && (kind === "cpt" ? row?.cptProj : row?.proj) != null;
  const off = (atLimit) => (!live || atLimit ? " disabled" : "");
  const side = (count) => {
    const t = thumbsHtml(count);
    return { cls: count > 0 ? " is-on" : "", count: Math.max(1, count), style: t.style, svgs: t.svgs };
  };
  const down = side(steps < 0 ? -steps : 0);
  const up = side(steps > 0 ? steps : 0);
  // The thumb opposite the active side clears the adjustment (Adam 2026-10-22 3:20 PM): its title and label say so.
  const clearTitle = `Clear the ${bumpPctText(steps)} adjustment`;
  const clearLabel = `Clear ${name}'s adjustment`;
  const downTitle = steps > 0 ? clearTitle : `${MINUS}${BUMP_STEP_PCT}% a press${steps < 0 ? ` · now ${bumpPctText(steps)}` : ""}`;
  const upTitle = steps < 0 ? clearTitle : `+${BUMP_STEP_PCT}% a press${steps > 0 ? ` · now ${bumpPctText(steps)}` : ""}`;
  const downLabel = steps > 0 ? clearLabel : `Lower ${name}'s projection ${BUMP_STEP_PCT}%`;
  const upLabel = steps < 0 ? clearLabel : `Raise ${name}'s projection ${BUMP_STEP_PCT}%`;
  return `<span class="bump-ctl"><button type="button" class="bump-btn${down.cls}" data-action="bump-down" data-id="${id}" data-count="${down.count}"${down.style} aria-label="${downLabel}" title="${title == null ? downTitle : escapeHtml(title)}"${off(steps <= -BUMP_MAX_STEPS)}>${down.svgs}</button><button type="button" class="bump-btn${up.cls}" data-action="bump-up" data-id="${id}" data-count="${up.count}"${up.style} aria-label="${upLabel}" title="${title == null ? upTitle : escapeHtml(title)}"${off(steps >= BUMP_MAX_STEPS)}>${up.svgs}</button></span>`;
}

/**
 * A pool row's whole projection cell: the pair, then the figure (`figure`, the number the cell shows: classic row.proj, a Showdown
 * list's own figure) in a span of fixed width, so every figure ends at the cell's right edge under the Proj header and the column
 * keeps its width (👁 2026-10-22). A bumped figure wears the up or down tint (.bump-up / .bump-down) and its hover gives the base,
 * the bumped figure and the percent ("Base 20.0 → 22.0 (+10%)"); `kind` "cpt" reads the Captain figures, cptProj against 1.5x
 * projBase, as the Captain cell shows (🔵 2026-10-22). A row with no figure shows `none` alone: no pair, nothing to move.
 */
export function bumpProjHtml(row, figure, { enabled = true, kind = null, none = "no proj", title = null } = {}) {
  if (figure == null || Number.isNaN(Number(figure))) return escapeHtml(none);
  const isCpt = kind === "cpt";
  const base = row?.projBase == null ? null : isCpt ? Number(row.projBase) * CPT_MULT : row.projBase;
  const shown = isCpt ? row?.cptProj : row?.proj;
  return `${bumpControlHtml(row, { enabled, kind, title })}${bumpFigureHtml(row, dec1(figure), base, shown)}`;
}

/** The one copy of the bump tint: a figure's span, plain at 0 steps, else .bump-up / .bump-down with the hover "Base 20.0 → 22.0 (+10%)"
 *  (`base`, `shown`: the numbers the hover names; a missing base reads "—"). Both the Proj cell and the Ceil cell use it. */
function bumpFigureHtml(row, text, base, shown) {
  const steps = bumpStepsOf(row);
  let attrs = `class="bump-fig"`;
  if (steps) {
    const title = `Base ${dec1(base) ?? "—"} → ${dec1(shown) ?? "—"} (${bumpPctText(steps)})`;
    attrs = `class="bump-fig ${steps > 0 ? "bump-up" : "bump-down"}" title="${escapeHtml(title)}"`;
  }
  return `<span ${attrs}>${text}</span>`;
}

/**
 * A pool row's Ceil cell (Adam 2026-10-25: a ceiling build needs the ceiling visible): `figure` is the number shown, one decimal (the
 * caller has already made an out man's 0 and the Captain list's 1.5x); "—" when there is none. A bumped row wears the same tint and hover
 * as the Proj cell, the base being TwoGun's pre-bump ceiling (row.tg.bumpBase.ceil, merge.js bumpFigures; x1.5 for `kind` "cpt").
 * `out`: the figure is 0 because the man is out, not because of a bump, so it is drawn plain (no tint, no hover).
 */
export function bumpCeilHtml(row, figure, { kind = null, out = false } = {}) {
  if (figure == null || Number.isNaN(Number(figure))) return "—";
  if (out) return `<span class="bump-fig">${dec1(figure)}</span>`;
  const base = row?.tg?.bumpBase?.ceil == null ? null : Number(row.tg.bumpBase.ceil) * (kind === "cpt" ? CPT_MULT : 1);
  return bumpFigureHtml(row, dec1(figure), base, figure);
}

const inFlight = new Set(); // the ids whose bump request is out: a press for one of them is ignored until it is answered

/** Test hook: the ids whose request is out. */
export function bumpsInFlight() {
  return new Set(inFlight);
}

/**
 * One press: the new steps from the row as the board holds it, sent through `onBump(id, steps)` (a promise of the pool's write: a
 * truthy answer when the server took it, which redraws from the answered board; falsy when it was refused, which shows the
 * sentence). The pair is disabled from the press on; it is put back, as the row's limits have it, only after a refusal or a
 * failure. After a success it stays disabled until the redraw replaces it (🔵 2026-10-22: classic redraws after the answer, so an
 * early re-enable let a second press read the old steps and send them again).
 */
export async function bumpPress(btn, { rowOf, onBump }) {
  if (btn.disabled) return; // a click that lands on a disabled button's thumb must not re-send the old steps
  const id = String(btn.dataset.id);
  if (inFlight.has(id)) return;
  const row = rowOf(id);
  if (!row || typeof onBump !== "function") return;
  const current = bumpStepsOf(row);
  const steps = nextBumpSteps(current, btn.dataset.action === "bump-up" ? 1 : -1);
  if (steps === current) return;
  const buttons = [...(btn.closest?.(".bump-ctl")?.querySelectorAll?.(".bump-btn") ?? [btn])];
  for (const b of buttons) b.disabled = true;
  inFlight.add(id);
  let taken = false;
  try {
    taken = Boolean(await onBump(id, steps));
  } catch (e) {
    console.error("The projection bump could not be sent:", e); // the pool's write shows its own sentence; this only keeps the pair usable
  } finally {
    inFlight.delete(id);
    if (!taken) for (const b of buttons) b.disabled = b.dataset.action === "bump-up" ? current >= BUMP_MAX_STEPS : current <= -BUMP_MAX_STEPS;
  }
}

/** Wires every pair drawn under `root` (a list whose rows are redrawn with their own new buttons). */
export function wireBumpButtons(root, opts) {
  root.querySelectorAll(".bump-ctl .bump-btn").forEach((btn) => btn.addEventListener("click", () => bumpPress(btn, opts)));
}

/** One click listener on a mount whose inside is redrawn by innerHTML (the classic Optimizer's): set once, it serves every redraw. */
export function delegateBumpClicks(root, opts) {
  root?.addEventListener?.("click", (e) => {
    const btn = e.target?.closest?.(".bump-ctl .bump-btn");
    if (btn && !btn.disabled) bumpPress(btn, opts);
  });
}
