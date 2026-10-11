// Lineups saved on the public site (DECISIONS.md D69): kept only in the visitor's browser (this device), one
// localStorage entry per season, week and slate, never sent anywhere and never merged into the app's saved lineups
// (those stay baked and read-only). tools/publish.mjs copies this file to out/js/site-lineups.js.
//
// Browser storage can be missing, switched off or full, and reading it can throw: every access is guarded, a read
// that fails is "no device lineups", a write that fails is a plain refusal. `storage` is passed in (the page's
// localStorage, or a test double); null means unavailable.
//
// Saving follows POST /api/lineups (server/server.js handleLineupsPost, lineups/store.js buildLineupEntry): the
// route's own slot, name and slate checks and snapshot builder (server/lineups/validate.js, copied beside the engine)
// run on the published board, "Lineup N" for a blank name. A device lineup's id starts with "device-" and it carries
// device: true; site.css marks it "saved on this device" and gives it a Delete button by that id.
import { validateLineupSlots, validateLineupName, findLineupSlate, buildLineupSnapshot } from "../server/lineups/validate.js";

export const STORAGE_PREFIX = "nfldfs-site-lineups:";
export const DEVICE_ID_PREFIX = "device-";
export const STORAGE_UNAVAILABLE_MESSAGE = "This browser is not letting the site keep lineups (storage is switched off or full), so nothing was saved.";

/** The page's localStorage, or null when the browser refuses it (reading the property itself can throw). */
export function pageStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function weekPart(season, week) {
  return `${season}-w${String(week).padStart(2, "0")}`;
}

/** The storage key for one season, week and slate ("main" or a second slate's key). */
export function storageKey(season, week, slateKey) {
  return `${STORAGE_PREFIX}${weekPart(season, week)}:${slateKey || "main"}`;
}

export function readKey(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.lineups) ? parsed.lineups.filter((l) => l && typeof l.id === "string") : [];
  } catch {
    return [];
  }
}

/** Every device lineup of the week, all slates. Empty when storage is unavailable or unreadable. */
export function readDeviceLineups(storage, season, week) {
  if (!storage) return [];
  const prefix = `${STORAGE_PREFIX}${weekPart(season, week)}:`;
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (typeof k === "string" && k.startsWith(prefix)) keys.push(k);
    }
  } catch {
    return [];
  }
  return keys.flatMap((k) => readKey(storage, k));
}

/** Writes one slate's list. Returns true, or false when the browser refused. */
export function writeKey(storage, key, lineups) {
  if (!storage) return false;
  try {
    if (lineups.length) storage.setItem(key, JSON.stringify({ lineups }));
    else storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Newest first by savedAt (lineups/store.js sortedNewestFirst). */
export function sortedNewestFirst(lineups) {
  return [...lineups].sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
}

// lineups/store.js nextLineupName
export function nextLineupName(lineups) {
  const used = new Set(lineups.map((l) => l.name));
  let n = 1;
  while (used.has(`Lineup ${n}`)) n++;
  return `Lineup ${n}`;
}

export function makeDeviceId(existing) {
  const ids = new Set(existing.map((l) => l.id));
  for (;;) {
    const bytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(bytes);
    const id = DEVICE_ID_PREFIX + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!ids.has(id)) return id;
  }
}

/**
 * Builds a device lineup from a POST /api/lineups body against the published board. `others`: every lineup the
 * visitor sees this week (baked and device), for the "Lineup N" name. Returns {error} or {entry, slateKey}.
 */
export function buildDeviceLineup(body, board, others = []) {
  body = body ?? {};
  const slotsResult = validateLineupSlots(body.slots);
  if (slotsResult.error) return { error: slotsResult.error };
  const nameResult = validateLineupName(body.name);
  if (nameResult.error) return { error: nameResult.error };
  const slateFound = findLineupSlate(body.slate, Array.isArray(board?.slates) ? board.slates : []);
  if (slateFound.error) return { error: slateFound.error };
  const { lineupSlate, lineupSecondSlate } = slateFound;
  const rowById = new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
  const snapshot = buildLineupSnapshot(slotsResult.slots, rowById, lineupSecondSlate);
  if (snapshot.error) return { error: snapshot.error };
  const trimmed = (nameResult.name ?? "").trim();
  const entry = {
    id: makeDeviceId(others),
    name: trimmed === "" ? nextLineupName(others) : trimmed,
    savedAt: new Date().toISOString(),
    slots: snapshot.slots,
    salaryUsed: snapshot.salaryUsed,
    totalProj: snapshot.totalProj,
    device: true,
  };
  if (typeof lineupSlate === "string" && lineupSlate !== "") entry.slate = lineupSlate;
  return { entry, slateKey: typeof lineupSlate === "string" && lineupSlate !== "" ? lineupSlate : "main" };
}

/** Adds `entry` to its slate's list. Returns true, or false when storage is unavailable or refused the write. */
export function saveDeviceLineup(storage, season, week, slateKey, entry) {
  if (!storage) return false;
  const key = storageKey(season, week, slateKey);
  return writeKey(storage, key, [entry, ...readKey(storage, key)]);
}

/**
 * Removes the device lineup `id` of the week. Returns "deleted", "missing" (no device lineup with that id, which
 * includes every baked app lineup) or "refused" (storage unavailable or the write failed).
 */
export function deleteDeviceLineup(storage, season, week, id) {
  if (!storage) return "refused";
  if (typeof id !== "string" || !id.startsWith(DEVICE_ID_PREFIX)) return "missing";
  const prefix = `${STORAGE_PREFIX}${weekPart(season, week)}:`;
  let keys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (typeof k === "string" && k.startsWith(prefix)) keys.push(k);
    }
  } catch {
    return "refused";
  }
  for (const key of keys) {
    const list = readKey(storage, key);
    if (list.some((l) => l.id === id)) return writeKey(storage, key, list.filter((l) => l.id !== id)) ? "deleted" : "refused";
  }
  return "missing";
}
