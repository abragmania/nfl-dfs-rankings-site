// Field uniqueness of one Showdown lineup by ownership alone (Adam 2026-10-18, the lineup meter's first model). Pure: no
// imports, no files. Since RULES.md D82 the meter's copies come from the fitted field model (./sd-field-model.js: this
// ownership product times a fitted salary-left factor and projection-gap factor, read from data/showdown-field/curves.json);
// this file stays as the exact straight-product reference ("ownership alone", the first step of the meter's calculation
// line) and the test oracle the field table is checked against.
// Adam's rulings, all binding:
//   - straight multiplicative maths: a lineup's weight w = Captain ownership of its Captain x the product of the FLEX
//     ownership of its five FLEX, as fractions. Captain and FLEX are separate positions and never combined ("for the
//     CPT you have to use projected CPT ownership for that player and not flex ownership");
//   - the field is about 100,000 lineups for GPP;
//   - no salary, underdog or Captain rules of thumb, and no outside figures (superseded for fitted curves by RULES.md D82,
//     Adam 2026-10-25: a curve fitted on real DraftKings fields by the fit tool is not a rule of thumb).
// The field's chance of building a lineup is P = w / Z, where Z sums w over every legal Showdown lineup the ownership
// covers. Z is exact: for each Captain, a dynamic programme over salary counts every five-man FLEX set (the Captain
// himself left out) that fits under the cap, minus the sets drawn wholly from the Captain's own team (DraftKings'
// one rule here: at least one player from each team). A man with no number in a slot (unposted) is left out of Z in
// that slot; a lineup holding him gets no figures (missing is missing, never zero). A man posted at 0% weighs 0.

export const DEFAULT_FIELD = 100000;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** The sum, over every set of five of `flex` costing at most `budget` units, of the product of their weights. */
function fiveSetSum(flex, budget) {
  if (budget < 0) return 0;
  const W = budget + 1;
  const f = new Float64Array(6 * W); // f[k * W + s]: sets of k men costing exactly s units
  f[0] = 1;
  for (const m of flex) {
    if (m.units > budget || m.own === 0) continue;
    for (let k = 4; k >= 0; k--) {
      const src = k * W;
      const dst = src + W + m.units;
      for (let s = budget - m.units; s >= 0; s--) {
        const v = f[src + s];
        if (v !== 0) f[dst + s] += v * m.own;
      }
    }
  }
  let sum = 0;
  for (let s = 5 * W; s < 6 * W; s++) sum += f[s];
  return sum;
}

/**
 * Z over a pool. `pool` is the board's candidates: { personId, team, slot: "CPT" | "FLEX", salary, own } where own is
 * a fraction (0..1) or null (unposted: left out of Z). Salaries are whole dollars; the unit is their greatest common
 * divisor over the FLEX men ($100 on a DraftKings slate). Returns { Z, ms, captains, unit }.
 */
export function normalizationZ(pool, { cap }) {
  const started = performance.now();
  if (!isNum(cap) || cap <= 0) throw new Error("normalizationZ: cap must be a positive number");
  const flexAll = [];
  const captains = [];
  for (const c of pool) {
    if (c.own === null || c.own === undefined) continue;
    if (!isNum(c.own) || c.own < 0 || c.own > 1) throw new Error(`normalizationZ: ownership of ${c.personId} (${c.slot}) is not a fraction from 0 to 1`);
    if (!Number.isInteger(c.salary) || c.salary <= 0) throw new Error(`normalizationZ: salary of ${c.personId} (${c.slot}) is not a whole number of dollars above 0`);
    (c.slot === "CPT" ? captains : flexAll).push(c);
  }
  const unit = flexAll.reduce((g, c) => gcd(g, c.salary), 0) || 100;
  const flex = flexAll.map((c) => ({ personId: c.personId, team: c.team, units: c.salary / unit, own: c.own }));
  let Z = 0;
  let counted = 0;
  for (const capt of captains) {
    if (capt.own === 0 || capt.salary > cap) continue;
    const budget = Math.floor((cap - capt.salary) / unit);
    const others = flex.filter((m) => m.personId !== capt.personId);
    const all = fiveSetSum(others, budget);
    const ownTeam = fiveSetSum(others.filter((m) => m.team === capt.team), budget);
    Z += capt.own * (all - ownTeam);
    counted++;
  }
  return { Z, ms: performance.now() - started, captains: counted, unit };
}

const isOwn = (v) => isNum(v) && v >= 0 && v <= 1;

/**
 * One lineup's uniqueness. `lineup` is { cpt: { name, own }, flex: [five { name, own }] } with own a fraction or null.
 * Any null -> { unposted: [names] } and no figures. Otherwise { w, Z, p, copies, aloneChance, oneIn, field } with
 * copies = N.w/Z (the expected number of the field's N lineups that are this one), aloneChance = (1-P)^(N-1) (the
 * chance no other entry has it; 1 in a field of one) and oneIn = 1/P (null when P is 0: a man posted at 0% makes the
 * lineup weigh 0). P is at most 1 and nothing is ever NaN: a bad input throws.
 */
export function lineupUniqueness(lineup, Z, { field = DEFAULT_FIELD } = {}) {
  const men = [lineup.cpt, ...lineup.flex];
  const unposted = men.filter((m) => m.own === null || m.own === undefined).map((m) => m.name);
  if (unposted.length) return { unposted };
  if (!Number.isInteger(field) || field < 1) throw new Error("lineupUniqueness: field must be a whole number of lineups, 1 or more");
  const bad = men.find((m) => !isOwn(m.own));
  if (bad) throw new Error(`lineupUniqueness: ownership of ${bad.name} is not a fraction from 0 to 1`);
  const w = men.reduce((a, m) => a * m.own, 1);
  if (!isNum(Z) || Z < 0) throw new Error("lineupUniqueness: Z must be a finite number, 0 or more");
  if (w > 0 && Z === 0) throw new Error("lineupUniqueness: the lineup has weight but Z is 0, so it was not counted in Z");
  if (w > 0 && w / Z > 1 + 1e-9) throw new Error("lineupUniqueness: the lineup weighs more than Z, so it was not counted in Z");
  const p = w === 0 ? 0 : Math.min(1, w / Z); // a rounding crumb above 1 is 1
  return {
    w,
    Z,
    p,
    copies: field * p,
    aloneChance: p === 0 || field === 1 ? 1 : Math.exp((field - 1) * Math.log1p(-p)),
    oneIn: p === 0 ? null : 1 / p,
    field
  };
}
