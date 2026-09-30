// Visual grading for the Value and Lev columns (Adam's addition): each row is placed into a quintile of
// its own position (rows with a number for that field only) and tagged with a grade class v1..v5 —
// v1 the top 20% (best), v3 the middle 40-60% (neutral), v5 the bottom 20% (worst). Own and Proj are
// never graded. Percentiles are computed once, over the whole position (not the currently filtered/
// visible rows), so filtering never changes a row's grade.
// D42: Value grades require projected points >= 3.0; rows under that floor get valueGrade null.

function gradeForPercentile(pct) {
  if (pct > 0.8) return "v1";
  if (pct > 0.6) return "v2";
  if (pct > 0.4) return "v3";
  if (pct > 0.2) return "v4";
  return "v5";
}

function percentileGrades(rows, field) {
  const byPos = new Map();
  for (const r of rows) {
    const v = r[field];
    if (v == null || Number.isNaN(v)) continue;
    if (!byPos.has(r.pos)) byPos.set(r.pos, []);
    byPos.get(r.pos).push(r);
  }
  const gradeById = new Map();
  for (const list of byPos.values()) {
    const sorted = [...list].sort((a, b) => a[field] - b[field]);
    const n = sorted.length;
    sorted.forEach((r, i) => {
      const pct = (i + 1) / n;
      gradeById.set(r.id, gradeForPercentile(pct));
    });
  }
  return gradeById;
}

/** Returns a new rows array with valueGrade/levGrade ("v1".."v5" or null) attached to every row. */
export function applyGrades(rows) {
  const list = rows ?? [];
  // D42: Value grades are computed only among rows with proj >= 3; rows below that floor get valueGrade null.
  const listForValue = list.filter((r) => r.proj != null && r.proj >= 3);
  const valueGrades = percentileGrades(listForValue, "value");
  const levGrades = percentileGrades(list, "lev");
  return list.map((r) => ({
    ...r,
    valueGrade: valueGrades.get(r.id) ?? null,
    levGrade: levGrades.get(r.id) ?? null,
  }));
}
