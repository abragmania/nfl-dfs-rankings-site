// Who is not expected to play. Pure (no node modules), so the Optimizer's engine (server/lineup/multi.js and
// dk-entries.js) can also run in a browser on the public site (DECISIONS.md D69; tools/publish.mjs copies the engine).
// value.js re-exports both functions, so every other caller is unchanged.

// Not expected to play (R82). "Questionable" is deliberately absent.
const SIDELINED = new Set([
  "OUT", "O", "INACTIVE", "IR", "INJURED RESERVE", "DOUBTFUL", "D",
  "SUSPENDED", "SUSPENSION", "PUP", "PHYSICALLY UNABLE TO PERFORM", "NFI", "NON-FOOTBALL INJURY"
]);

/** True when a status string means the player is not expected to play. Null or blank is never sidelined. */
export function isSidelined(status) {
  if (status === null || status === undefined) return false;
  return SIDELINED.has(String(status).trim().toUpperCase());
}

export function injuryReportState(card) {
  if (!card) return "missing";
  const status = String(card.status ?? "").trim().toLowerCase();
  const hasRecords = Number(card.recordCount) > 0;
  if (!hasRecords) return "missing";
  if (status === "stale") return "stale";
  if (status === "live" || status === "ok") return "ok";
  return "missing";
}

/** R82: which source a board uses. */
export function pickInjuryReport(espnState, sleeperState) {
  if (espnState === "ok") return { state: "ok", source: "ESPN injuries" };
  if (sleeperState === "ok") return { state: "ok", source: "Sleeper" };
  if (espnState === "stale") return { state: "stale", source: "ESPN injuries" };
  if (sleeperState === "stale") return { state: "stale", source: "Sleeper" };
  return { state: "missing", source: null };
}

export function injuryReportNote({ state, source }) {
  if (state === "missing") return "ESPN injury report and the Sleeper backup unavailable: injury status unknown, so no one is shown as healthy.";
  if (source === "Sleeper") {
    return state === "ok"
      ? "ESPN injury report unavailable: injury statuses are from Sleeper."
      : "ESPN injury report unavailable: injury statuses are from a saved Sleeper copy and may be out of date.";
  }
  return state === "stale" ? "ESPN injury report is a saved copy because the live fetch failed: injury statuses may be out of date." : null;
}

export function entriesInjuryProblem(report) {
  const state = report?.state;
  if (state === "ok") return null;
  if (state === "stale") {
    const from = report.source === "Sleeper" ? "Sleeper" : "ESPN";
    return { warning: `Injury status comes from a saved ${from} copy because the live fetch failed, so a player ruled out since then would not show as sidelined.` };
  }
  if (state === "missing") {
    return { error: "Injury status could not be checked: no injury report is available (ESPN's and the Sleeper backup both failed), so nobody can be confirmed healthy." };
  }
  return { error: "Injury status could not be checked: the board does not say whether it has an injury report." };
}

/** Adam's own In / Out for this man (overrides.status, Adam 2026-11-12: "mark players in and out"), read off the merged row: "in", "out" or null (Auto). */
export function statusSetting(row) {
  const s = row?.override?.status;
  return s === "in" || s === "out" ? s : null;
}

/** True when the sources list him out, on IR or doubtful (the injury report's status or the board's injured flag), Adam's own setting aside. */
export function listedSidelined(row) {
  return isSidelined(row?.status) || Boolean(row?.flags?.includes?.("injured"));
}

/** True when a board row is out: Adam's In / Out when he set one, else the sources' word (listedSidelined). */
export function rowIsSidelined(row) {
  const set = statusSetting(row);
  if (set) return set === "out";
  return listedSidelined(row);
}

/** The status word a row is read with: none for a man Adam marked in, "Out" for one he marked out, else the sources' word. Entries' injury checks and the Hidden notes read it. */
export function statusWordOf(row) {
  const set = statusSetting(row);
  if (set === "in") return null;
  if (set === "out") return "Out";
  return row?.status ?? null;
}

// A projection above 0 that Adam typed on a man the sources list out puts him back in, in every mode (Adam 2026-10-16; 2026-11-12: a typed number always wins).
// His own Out wins over it; his own In needs no revive.
export function isRevived(row) {
  const typed = row?.override?.proj;
  return statusSetting(row) === null && listedSidelined(row) && row?.override?.revive === true && typeof typed === "number" && Number.isFinite(typed) && typed > 0;
}

export function sidelinedIdsOf(rows) {
  return new Set((rows ?? []).filter((row) => rowIsSidelined(row)).map((row) => String(row.id)));
}

export function rowIsOut(row) {
  return rowIsSidelined(row) && !isRevived(row);
}

// Adam 2026-10-15: out = 0 projection and ceiling.
export function zeroOutRows(rows) {
  return rows.map((row) => {
    const had = Array.isArray(row.flags) && row.flags.includes("revived");
    const base = had ? { ...row, flags: row.flags.filter((f) => f !== "revived") } : row;
    if (!rowIsSidelined(base)) return base;
    if (isRevived(base)) return { ...base, flags: [...(base.flags ?? []), "revived"] };
    const zeroed = { ...base, proj: 0 };
    if (Object.prototype.hasOwnProperty.call(base, "ceiling")) zeroed.ceiling = 0;
    return zeroed;
  });
}
