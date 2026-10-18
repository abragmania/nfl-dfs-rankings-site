// A lineup's total as the page shows it (ChatGPT wish d, Adam 2026-10-17): every player's number is rounded to one
// decimal exactly as dec1 prints it, those rounded numbers are summed, and the sum is the total, so the total never
// disagrees with the rows beside it. Pure; lineup.js, lineup-card.js and entries-fill.js import it.
import { money } from "./format.js";

/** The sum of `values` after each is rounded to one decimal as format.js dec1 prints it (toFixed(1)); anything that is
 *  not a finite number is not shown on a row and adds nothing. null when no value is a number. Summed in whole tenths,
 *  so 0.1 + 0.2 style float drift never reaches the page. */
export function shownTotal(values) {
  let tenths = 0;
  let any = false;
  for (const v of values ?? []) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    tenths += Math.round(Number(v.toFixed(1)) * 10);
    any = true;
  }
  return any ? tenths / 10 : null;
}

// Salary left per open slot under the hand-built lineup (Adam 2026-10-18). Uses format.js money, which has no imports.
/** "$4,200 per spot": the salary left shared over the open slots, whole dollars rounded down so the figure never
 *  exceeds what fits. null when no slot is open, the salary left is not a finite number, or the cap is already passed. */
export function perSpotText(salaryLeft, openSlots) {
  if (!usableSalaryLeft(salaryLeft)) return null;
  if (typeof openSlots !== "number" || !Number.isFinite(openSlots) || openSlots <= 0) return null;
  return `${money(Math.floor(salaryLeft / openSlots))} per spot`;
}

// The one guard both per-spot texts share: a salary left that is a finite number and not already over the cap.
function usableSalaryLeft(salaryLeft) {
  return typeof salaryLeft === "number" && Number.isFinite(salaryLeft) && salaryLeft >= 0;
}

/** The Showdown lineup's salary per open spot (Adam 2026-10-18). A DraftKings Captain costs 1.5x his FLEX price, so an
 *  open Captain spot weighs 1.5 against each open FLEX spot: FLEX share = salaryLeft / (flexOpen + 1.5 per open Captain),
 *  Captain share = 1.5 x that, both whole dollars rounded down. Worked in half-units (2 per FLEX, 3 for the Captain) so
 *  the division is between whole numbers and a floor never lands a dollar short. "$X per FLEX · $Y CPT" with both open,
 *  "$Y CPT" with only the Captain, "$X per spot" with only FLEX; null when nothing is open or the salary left is unusable. */
export function showdownPerSpotText(salaryLeft, cptOpen, flexOpen) {
  if (!usableSalaryLeft(salaryLeft)) return null;
  const flexN = typeof flexOpen === "number" && Number.isFinite(flexOpen) && flexOpen > 0 ? flexOpen : 0;
  const cptN = cptOpen ? 1 : 0;
  const halfUnits = 2 * flexN + 3 * cptN;
  if (halfUnits === 0) return null;
  const flexShare = money(Math.floor((2 * salaryLeft) / halfUnits));
  const cptShare = money(Math.floor((3 * salaryLeft) / halfUnits));
  if (cptN && flexN) return `${flexShare} per FLEX · ${cptShare} CPT`;
  return cptN ? `${cptShare} CPT` : `${flexShare} per spot`;
}

/** A generated lineup's ceiling total (TwoGun mode): the shown sum of its players' ceilings, or the engine's `lineup.ceil`
 *  when the players carry none. undefined in current mode (the lineup has no `ceil`); null when the engine says a player has none. */
export function lineupCeilTotal(lineup) {
  if (lineup?.ceil === undefined) return undefined;
  if (lineup.ceil === null) return null;
  const players = lineup.players ?? [];
  const ceils = players.map((p) => p.ceil);
  return players.length > 0 && ceils.every((c) => typeof c === "number" && Number.isFinite(c)) ? shownTotal(ceils) : lineup.ceil;
}
