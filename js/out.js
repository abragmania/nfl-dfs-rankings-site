import { rowIsOut as serverRowIsOut, statusSetting, twogunCallsOut, inNeedsNumber, TYPE_A_PROJECTION } from "../server/rank/sidelined.js";

export { twogunCallsOut, inNeedsNumber, TYPE_A_PROJECTION }; // the page reads the server's pure tests through this one module (it is the page module the site build rewrites)

// TwoGun's callText already starts with its own "[lean] " tag; the tag is printed once, so that prefix is dropped.
export const untagged =(text) => (text ? String(text).replace(/^\[[^\]]*\]\s*/, "") : "");

export function twoGunOutReason(row) {
  const flags = Array.isArray(row?.flags) ? row.flags : [];
  if (flags.includes("revived") || statusSetting(row) === "in") return null;
  const parts = [];
  if (flags.includes("outAfterStamp")) {
    parts.push("Ruled out after TwoGun's board was made (the injury report now lists him out). Projection 0.");
  }
  // His call counts only where it is in use (source order, step 3): tg is attached with his calls off too, and then it is no reason.
  if (row?.tg?.call === "OUT" && twogunCallsOut(row)) {
    const tag = row.tg.tag ? ` [${row.tg.tag}]` : "";
    const text = untagged(row.tg.callText);
    parts.push(`TwoGun calls him OUT${tag}${text ? `: ${text}` : "."}`);
  }
  return parts.length ? parts.join(" ") : null;
}

// The one out-test (Adam 2026-10-15, R82; 2026-11-12 the source order): the server's own rowIsOut (server/rank/sidelined.js), so the page, the
// grade, the row dimming, the Lineup Builder and the optimizer agree. His own In / Out decides first, a typed number revives, then the row's status.
export const rowIsOut = serverRowIsOut;

// The hover for a revived row's muted status (typed projection brought him back), else null.
export function revivedStatusTitle(row, label) {
  const flags = Array.isArray(row?.flags) ? row.flags : [];
  if (!flags.includes("revived")) return null;
  const typed = row.override?.proj ?? row.proj;
  return `Listed ${label || "out"}; back in because you typed ${typed == null ? "a projection" : (Math.round(Number(typed) * 10) / 10).toFixed(1)}`;
}
