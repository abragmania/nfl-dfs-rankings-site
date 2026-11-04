// What a click on each classic pool row does while Adam hand-builds a lineup (optimizer standard A18 and D3, round 3). Built once per draw from the
// working lineup and the slate's men, then asked for every row: the answer is the pick the row is drawn with ("add" or "remove"), or null with the
// reason the row is greyed (shown on hover; the row still shows its figures and its name still opens his card). Greying updates on every draw because
// the panel is drawn again on every change. It only decides what a click may do: a Build never reads it.
//
// The order of reasons: he is in the lineup (an unlocked man stays clickable and the click takes him out; a locked man is greyed, unlock him first),
// he is excluded, he has no salary, no open seat can take his position, his salary is more than the salary left less the cheapest
// legal fill of the other open seats (lineup-fit.js; positions and salaries only).
import { classicFit, fillPool, fitReasonText, FLEX_POSITIONS } from "./lineup-fit.js";

/** True when a row has the two figures a click needs: a salary and a projection (ownership is never one). */
const hasFigures = (r) => Number.isFinite(r.salary) && r.proj != null;

/**
 * `rows`: the slate's board rows (the whole pool, not the filtered list); `rowById`: id -> row over the whole board; `slotNames`: LINEUP_SLOTS;
 * `slots`: the working lineup's slots ({id} or null each); `locks` and `excludes`: Sets of board ids; `cap`: the salary cap; `identityOf(row)`: the
 * DraftKings identity two board rows of one player share; `base(row)`: classicPickAction's first answer ("remove", "add" or null for an excluded man).
 * Returns pickOf(row) -> {action: "add" | "remove" | null, reason: string} (reason "" when the row is clickable).
 */
export function poolPicker({ rows, rowById, slotNames, slots, locks, excludes, cap, identityOf, base }) {
  const placedRows = slots.map((s) => (s ? rowById.get(String(s.id)) ?? null : null));
  const placedIds = new Set(placedRows.filter(Boolean).map(identityOf));
  const lockedPlaced = new Set(slots.filter((s) => s && locks.has(String(s.id))).map((s) => String(s.id)));
  const lockedIdentities = new Set(placedRows.filter((r) => r && lockedPlaced.has(String(r.id))).map(identityOf));
  const used = placedRows.reduce((sum, r) => sum + (r?.salary ?? 0), 0);
  const openSlots = slotNames.filter((_, i) => !slots[i]);
  // A pool-only lock (a man the Build holds who has no seat: an older saved state, or Make them Must when no seat was open) costs his salary and takes a seat like a placed man.
  const slotIds = new Set(slots.filter(Boolean).map((s) => String(s.id)));
  const heldOnly = [...locks].map(String).filter((id) => !slotIds.has(id)).map((id) => rowById.get(id)).filter((r) => r && !placedIds.has(identityOf(r)) && Number.isFinite(r.salary));
  const heldIdentities = new Set(heldOnly.map(identityOf));
  const seatsAfter = (men) => {
    const left = [...openSlots];
    for (const m of men) {
      let i = left.indexOf(m.pos);
      if (i < 0 && FLEX_POSITIONS.includes(m.pos)) i = left.indexOf("FLEX");
      if (i >= 0) left.splice(i, 1);
    }
    return left;
  };
  // The men who could fill an open seat: not in the lineup or held, not excluded, and not greyed for a missing figure (a man the pool greys is not counted as a way to fill a seat).
  const pool = fillPool(
    (rows ?? []).filter((r) => !placedIds.has(identityOf(r)) && !heldIdentities.has(identityOf(r)) && !excludes.has(String(r.id)) && hasFigures(r)).map((r) => ({ id: r.id, pos: r.pos, salary: r.salary })),
  );
  return function pickOf(row) {
    const action = base(row);
    const name = row.name ?? "He";
    if (action === "remove") {
      return lockedIdentities.has(identityOf(row))
        ? { action: null, reason: `${name} is locked into your lineup. Unlock him first, or click his slot.` }
        : { action: "remove", reason: "" };
    }
    if (action === null) return { action: null, reason: `${name} is excluded from every lineup. Take the exclude off to use him.` };
    // A18 (round 3 fixes): a missing figure greys a row. No salary: he cannot be costed against the cap. No projection (proj == null; an out man's 0 is a figure): he cannot be
    // weighed. Never ownership. Typing a projection for him (his Proj in the ranked list) brings him back.
    if (!Number.isFinite(row.salary)) return { action: null, reason: `${name} has no DraftKings salary, so he cannot be costed against the cap.` };
    if (row.proj == null) return { action: null, reason: `${name} has no projection, so he cannot be added. Type one in his Proj in the ranked list to bring him in.` };
    const others = heldOnly.filter((r) => identityOf(r) !== identityOf(row)); // the held men other than the one asking
    const salaryLeft = cap - used - others.reduce((s, r) => s + r.salary, 0);
    const fit = classicFit({ man: { id: row.id, pos: row.pos, salary: row.salary }, salaryLeft, openSlots: seatsAfter(others), pool });
    return fit.fits ? { action: "add", reason: "" } : { action: null, reason: fitReasonText(fit, row) };
  };
}
