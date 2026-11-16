// The working lineup's totals (moved unchanged out of ./lineup.js to keep that file under its cap, PROJECT.md Watch "SPLITS"; lineup.js re-exports both).
import { lookTotals } from "../look-adapter.js";
import { lookCapHtml } from "../look-row.js"; // the classic working lineup's totals line, the one copy (2026-11-13)
import { findRow, SALARY_CAP, FLEX_COUNT } from "./lineup-saved.js";
import { showdownPerSpotText, shownTotal } from "../totals.js";
import { playerFigures } from "./lineup-meter.js";
import { state } from "./seats.js";

/**
 * Salary used, salary left and total projection of the placed players (`picked` = {cpt, flex}, the panel's state by
 * default; exported for the tests). The projection is the sum of the figures the slots show (`figures`, the meter's
 * playerFigures by default: the board row's own); salary is the board's too. Missing
 * is missing: a placed player who is no longer on the board makes both the salary and the projection unknown (null),
 * and one with no projection makes the projection unknown. The projection is shownTotal's (each slot rounded as it is
 * shown, then summed; Adam 2026-10-17), as the results cards, the cash totals and the saved card add it.
 */
export function computeTotals(board, picked = state, figures = playerFigures) {
  const entries = [];
  if (picked.cpt) entries.push({ id: picked.cpt.id, cpt: true });
  for (const s of picked.flex ?? []) if (s) entries.push({ id: s.id, cpt: false });
  let salaryUsed = 0;
  let projs = [];
  for (const { id, cpt } of entries) {
    const row = findRow(board, id);
    if (!row) {
      salaryUsed = null;
      projs = null;
      continue;
    }
    if (salaryUsed !== null) salaryUsed += (cpt ? row.cptSalary : row.salary) ?? 0;
    // Missing is missing: a placed player with no projection makes the total unknown, never a sum counting him as 0.
    const proj = figures(row, cpt).proj;
    projs = projs !== null && Number.isFinite(proj) ? [...projs, proj] : null;
  }
  const totalProj = projs === null ? null : projs.length ? shownTotal(projs) : 0;
  return { salaryUsed, salaryLeft: salaryUsed === null ? null : SALARY_CAP - salaryUsed, totalProj, filled: entries.length };
}

/** A11: the working lineup's `Salary used`, `Salary left`, `Proj`, `Own`, `Value` and `Per open slot` under the last slot, from the first man (look-row.js lookCapHtml, the classic's line): empty reads $0, the full cap and dashes;
 *  a board that has not loaded reads dashes with the reason; a placed man no longer on the board makes every figure that needs him a dash. Salary per open spot follows (Adam 2026-10-18), the Captain's 1.5x counted. */
export function workingTotalsHtml(board, picked = state, figures = playerFigures) {
  const entries = [];
  if (picked.cpt) entries.push({ id: picked.cpt.id, cpt: true });
  for (const s of picked.flex ?? []) if (s) entries.push({ id: s.id, cpt: false });
  const men = entries.map(({ id, cpt }) => {
    const row = findRow(board, id);
    if (!row) return {};
    const f = figures(row, cpt);
    return { salary: cpt ? row.cptSalary : row.salary, proj: f.proj, own: f.notOnBoard ? null : f.own };
  });
  const notLoaded = (board?.rows ?? []).length ? null : "the board has not loaded";
  const t = notLoaded ? { used: null, left: null, proj: null, own: null, value: null, over: false, fillPct: 0 } : lookTotals(men, { cap: SALARY_CAP, seats: FLEX_COUNT + 1 });
  const why = notLoaded ?? (entries.length ? "a man in this lineup has no figure or is no longer on this board" : "no man in this lineup yet");
  const left = computeTotals(board, picked, figures).salaryLeft;
  const perSpot = left === null ? null : showdownPerSpotText(left, !picked.cpt, FLEX_COUNT - (picked.flex ?? []).filter(Boolean).length);
  return lookCapHtml(t, { cap: SALARY_CAP, why, perOpen: perSpot, perOpenTitle: perSpot ?? "", attrs: "data-working-totals" });
}
