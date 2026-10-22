// Adam 2026-10-22: ± bump. Every Optimizer pool row (classic and Showdown, Cash and GPP) carries a − and + pair: each press moves
// that player's projection and his other point projections by 5% on the server, presses stack (+ twice = +10%), − undoes the same
// way, from -10 to +10 steps. The browser sends only the new step count (PUT .../overrides {bump: {id: steps}}, 0 sent as null to
// remove it) and redraws from the board the server answers; the board row carries override.bump (absent when none), proj already
// bumped and projBase. This file is the one copy of the pair's and the projection cell's markup and of the click; each pool supplies
// the request.
import { escapeHtml, dec1 } from "./format.js";

export const BUMP_STEP_PCT = 5;
export const BUMP_MAX_STEPS = 10;
const MINUS = "−"; // a real minus sign, never a hyphen

/** The row's bump in steps: row.override.bump, 0 when it has none (the server sends no key then, never null). */
export function bumpStepsOf(row) {
  const n = Number(row?.override?.bump ?? 0);
  return Number.isInteger(n) ? n : 0;
}

/** The steps one press leaves: one up or down, kept within -10..10. */
export function nextBumpSteps(current, dir) {
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
const CPT_MULT = 1.5;

/**
 * The pair alone (no chip, 👁 2026-10-22: a chip widened the column). `enabled` false draws both buttons disabled (no write is
 * wired); a row with no projection draws them disabled too (nothing to move). `kind` "cpt" is the Showdown Captain list.
 */
export function bumpControlHtml(row, { enabled = true, kind = null } = {}) {
  const id = escapeHtml(String(row?.id ?? ""));
  const name = escapeHtml(row?.name ?? "this player");
  const steps = bumpStepsOf(row);
  const live = enabled && (kind === "cpt" ? row?.cptProj : row?.proj) != null;
  const off = (atLimit) => (!live || atLimit ? " disabled" : "");
  return `<span class="bump-ctl"><button type="button" class="bump-btn" data-action="bump-down" data-id="${id}" aria-label="Lower ${name}'s projection ${BUMP_STEP_PCT}%" title="${MINUS}${BUMP_STEP_PCT}%"${off(steps <= -BUMP_MAX_STEPS)}>${MINUS}</button><button type="button" class="bump-btn" data-action="bump-up" data-id="${id}" aria-label="Raise ${name}'s projection ${BUMP_STEP_PCT}%" title="+${BUMP_STEP_PCT}%"${off(steps >= BUMP_MAX_STEPS)}>+</button></span>`;
}

/**
 * A pool row's whole projection cell: the pair, then the figure (`figure`, the number the cell shows: classic row.proj, a Showdown
 * list's own figure) in a span of fixed width, so every figure ends at the cell's right edge under the Proj header and the column
 * keeps its width (👁 2026-10-22). A bumped figure wears the up or down tint (.bump-up / .bump-down) and its hover gives the base,
 * the bumped figure and the percent ("Base 20.0 → 22.0 (+10%)"); `kind` "cpt" reads the Captain figures, cptProj against 1.5x
 * projBase, as the Captain cell shows (🔵 2026-10-22). A row with no figure shows `none` alone: no pair, nothing to move.
 */
export function bumpProjHtml(row, figure, { enabled = true, kind = null, none = "no proj" } = {}) {
  if (figure == null || Number.isNaN(Number(figure))) return escapeHtml(none);
  const steps = bumpStepsOf(row);
  const isCpt = kind === "cpt";
  let attrs = `class="bump-fig"`;
  if (steps) {
    const base = row?.projBase == null ? null : isCpt ? Number(row.projBase) * CPT_MULT : row.projBase;
    const shown = isCpt ? row?.cptProj : row?.proj;
    const title = `Base ${dec1(base) ?? "—"} → ${dec1(shown) ?? "—"} (${bumpPctText(steps)})`;
    attrs = `class="bump-fig ${steps > 0 ? "bump-up" : "bump-down"}" title="${escapeHtml(title)}"`;
  }
  return `${bumpControlHtml(row, { enabled, kind })}<span ${attrs}>${dec1(figure)}</span>`;
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
