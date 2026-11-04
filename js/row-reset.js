// The row reset on the Optimizer pools (optimizer standard B12, round 3): a small x beside a man's projection that clears his typed numbers and his
// ± bump together. It shows only for a man who has one (a typed projection, a typed ownership or a bump), so most rows carry nothing. The classic
// pool sends DELETE /api/overrides/<id>; the Showdown pool sends the same clearing as a PUT (rowResetPatch), since a Showdown man's typed numbers sit
// under his FLEX id and his Captain id. Markup, the pure patch and one delegated click; each Optimizer does its own write.
import { escapeHtml } from "./format.js";
import { bumpStepsOf } from "./bump-control.js";

/** Whether `row` has anything for the reset to clear: a typed projection, a typed ownership or a bump. */
export function hasRowOverride(row) {
  const o = row?.override;
  return Boolean(o && (o.proj != null || o.own != null)) || bumpStepsOf(row) !== 0;
}

export const ROW_RESET_TITLE = "Clear his typed numbers and bump";

/** The x, or "" when the man has nothing to clear. `disabled`: no write is wired (the public site's Showdown, sample mode). */
export function rowResetHtml(row, { disabled = false } = {}) {
  if (!hasRowOverride(row)) return "";
  const name = escapeHtml(row?.name ?? "this player");
  return `<button type="button" class="reset-icon row-reset" data-action="row-reset" data-id="${escapeHtml(String(row.id))}" title="${ROW_RESET_TITLE}" aria-label="Clear ${name}'s typed numbers and bump"${disabled ? " disabled" : ""}>&times;</button>`;
}

/** The PUT body that clears one Showdown man: his typed projection, his typed ownership (under his FLEX id and his Captain id) and his bump. */
export function rowResetPatch(row) {
  const ids = [row.id, row.cptId].filter((x) => x != null && x !== "").map(String);
  return {
    proj: { [String(row.id)]: null },
    own: Object.fromEntries(ids.map((id) => [id, null])),
    bump: { [String(row.id)]: null },
  };
}

/** One click listener on a mount whose inside is redrawn: a press on a row's x calls onReset(id). */
export function delegateRowReset(root, { onReset }) {
  root?.addEventListener?.("click", (e) => {
    const btn = e.target?.closest?.("[data-action='row-reset']");
    if (btn && !btn.disabled) onReset(btn.dataset.id, btn);
  });
}
