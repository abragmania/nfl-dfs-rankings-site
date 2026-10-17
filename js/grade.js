// D33: z-score bands v1..v5 (v1 z >= 1.5 best, v3 within 0.5 none, v5 z <= -1.5 worst) within position; FLEX pools RB/WR/TE.
// D42: only rows projected 3+ and not out are in the pool. D50: a group needs GRADE_MIN_GROUP numbers and an SD above 0.
import { rowIsOut } from "./out.js";

const GRADE_MIN_GROUP = 3;
const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);

/** D42: projected 3+ and not out. */
export function inGradePool(r) {
  return r.proj != null && r.proj >= 3 && !rowIsOut(r);
}

/** The band for one number; null with no SD. */
export function zGrade(value, mean, sd) {
  if (value == null || Number.isNaN(value) || !(sd > 0)) return null;
  const z = (value - mean) / sd;
  if (z >= 1.5) return "v1";
  if (z >= 0.5) return "v2";
  if (z > -0.5) return "v3";
  if (z > -1.5) return "v4";
  return "v5";
}

/** A Map from each item to its band; a group with fewer than `min` numbers grades nobody (D50). */
export function zGrades(items, valueOf, groupOf, min = GRADE_MIN_GROUP) {
  const groups = new Map();
  for (const item of items ?? []) {
    const v = valueOf(item);
    if (v == null || Number.isNaN(v)) continue;
    const g = groupOf(item);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([item, v]);
  }
  const out = new Map();
  for (const list of groups.values()) {
    if (list.length < min) continue;
    const mean = list.reduce((s, [, v]) => s + v, 0) / list.length;
    const sd = Math.sqrt(list.reduce((s, [, v]) => s + (v - mean) ** 2, 0) / list.length);
    for (const [item, v] of list) out.set(item, zGrade(v, mean, sd));
  }
  return out;
}

// D33: TwoGun's Ceil, Ceil/$ (Adam 2026-10-17, DQ1), Nuke and 4x% are graded too (row.tgGrade).
const TG_GRADED = { ceil: (r) => r.tg?.ceil, ceilPer1k: (r) => r.tg?.ceilPer1k, nuke: (r) => r.tg?.nuke, p4x: (r) => r.tg?.p4x };

/** Returns a new rows array with valueGrade ("v1".."v5" or null) on every row (and tgGrade with TwoGun figures). */
export function applyGrades(rows, posFilter = "All") {
  const list = rows ?? [];
  const pool = list.filter(inGradePool);
  const groupOf = posFilter === "FLEX" ? (r) => (FLEX_POSITIONS.has(r.pos) ? "FLEX" : r.pos) : (r) => r.pos;
  const value = zGrades(pool, (r) => r.value, groupOf);
  const tgPool = pool.filter((r) => r.tg);
  const tg = Object.fromEntries(Object.entries(TG_GRADED).map(([key, valueOf]) => [key, zGrades(tgPool, valueOf, groupOf)]));
  return list.map((r) => ({
    ...r,
    valueGrade: value.get(r) ?? null,
    ...(r.tg ? { tgGrade: Object.fromEntries(Object.keys(TG_GRADED).map((key) => [key, tg[key].get(r) ?? null])) } : {}),
  }));
}

/** D33: the FLEX filter re-grades the whole board with RB/WR/TE pooled; other filters keep the grades set at load. */
export function rowsGradedForView(rows, pos, boardRows = rows) {
  if (pos !== "FLEX") return rows;
  const graded = new Map(applyGrades(boardRows ?? [], "FLEX").map((r) => [r.id, r]));
  return (rows ?? []).map((r) => graded.get(r.id) ?? r);
}
