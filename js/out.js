// TwoGun's callText already starts with its own "[lean] " tag; the tag is printed once, so that prefix is dropped.
export const untagged =(text) => (text ? String(text).replace(/^\[[^\]]*\]\s*/, "") : "");

export function twoGunOutReason(row) {
  const flags = Array.isArray(row?.flags) ? row.flags : [];
  if (flags.includes("revived")) return null;
  const parts = [];
  if (flags.includes("outAfterStamp")) {
    parts.push("Ruled out after TwoGun's board was made (the injury report now lists him out). Projection 0.");
  }
  if (row?.tg?.call === "OUT") {
    const tag = row.tg.tag ? ` [${row.tg.tag}]` : "";
    const text = untagged(row.tg.callText);
    parts.push(`TwoGun calls him OUT${tag}${text ? `: ${text}` : "."}`);
  }
  return parts.length ? parts.join(" ") : null;
}

// The one out-test (Adam 2026-10-15, R82): the grade, the row dimming and the Lineup Builder all use it.
// A "revived" row (his typed number, 2026-10-16) is never out, whatever TwoGun says.
export function rowIsOut(row) {
  const flags = Array.isArray(row?.flags) ? row.flags : [];
  return Boolean(twoGunOutReason(row)) || (flags.includes("injured") && !flags.includes("revived"));
}

// The hover for a revived row's muted status (typed projection brought him back), else null.
export function revivedStatusTitle(row, label) {
  const flags = Array.isArray(row?.flags) ? row.flags : [];
  if (!flags.includes("revived")) return null;
  const typed = row.override?.proj ?? row.proj;
  return `Listed ${label || "out"}; back in because you typed ${typed == null ? "a projection" : (Math.round(Number(typed) * 10) / 10).toFixed(1)}`;
}
