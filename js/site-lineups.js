// Lineups saved on the public site (DECISIONS.md D69): kept only in the visitor's browser (this device), one
// localStorage entry per season, week and slate, never sent anywhere and never merged into the app's saved lineups
// (those stay baked and read-only). tools/publish.mjs copies this file to out/js/site-lineups.js.
//
// Browser storage can be missing, switched off or full, and reading it can throw: every access is guarded, a read
// that fails is "no device lineups", a write that fails is a plain refusal. `storage` is passed in (the page's
// localStorage, or a test double); null means unavailable.
//
// Saving follows POST /api/lineups (server/server.js handleLineupsPost, lineups/store.js buildLineupEntry): the
// route's own slot, name, mode, tag and slate checks and snapshot builder (server/lineups/validate.js, copied beside the engine)
// run on the published board, "Lineup N" for a blank name. A device lineup's id starts with "device-" and it carries
// device: true; site.css marks it "saved on this device" and gives it a Delete button by that id.
// A letter tag is unique among this device's lineups of the slate (releaseLineupTag, PROJECT.md Part 4 Entries, Adam
// 2026-10-17); the baked app lineups are read-only here (D69, D71), so their letters are never cleared.
import {
  validateLineupSlots, validateLineupName, validateLineupMode, validateLineupTag, validateLineupBuild, buildAfterSlotEdit, slotsPlayersDiffer, releaseLineupTag, findLineupSlate, buildLineupSnapshot,
} from "../server/lineups/validate.js";

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

/** The week's storage keys, all slates; null when storage cannot be listed. */
export function weekKeys(storage, season, week) {
  const prefix = `${STORAGE_PREFIX}${weekPart(season, week)}:`;
  const keys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (typeof k === "string" && k.startsWith(prefix)) keys.push(k);
    }
  } catch {
    return null;
  }
  return keys;
}

/** Every device lineup of the week, all slates. Empty when storage is unavailable or unreadable. */
export function readDeviceLineups(storage, season, week) {
  if (!storage) return [];
  const keys = weekKeys(storage, season, week);
  return keys ? keys.flatMap((k) => readKey(storage, k)) : [];
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
  const modeResult = validateLineupMode(body.mode);
  if (modeResult.error) return { error: modeResult.error };
  const tagResult = validateLineupTag(body.tag);
  if (tagResult.error) return { error: tagResult.error };
  const buildResult = validateLineupBuild(body.build); // ChatGPT wish g, Adam 2026-10-17
  if (buildResult.error) return { error: buildResult.error };
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
  if (modeResult.mode !== undefined) entry.mode = modeResult.mode;
  if (typeof tagResult.tag === "string") entry.tag = tagResult.tag;
  if (buildResult.build) entry.build = buildResult.build;
  return { entry, slateKey: typeof lineupSlate === "string" && lineupSlate !== "" ? lineupSlate : "main" };
}

/** The patch a PUT /api/lineups/<id> body asks of device lineup `existing`, refusing what handleLineupUpdate refuses
 *  (PROJECT.md Part 4 Lineups). `others`: every lineup the visitor sees, for a blank name. {error} or {patch}. */
export function buildDevicePatch(body, board, existing, others = []) {
  body = body ?? {};
  const hasSlots = body.slots !== undefined;
  const hasSlate = body.slate !== undefined && body.slate !== null;
  // Adam 2026-10-17: a lineup's mode is fixed at save, no crossover; only a new lineup sets it.
  if (body.mode !== undefined) return { error: "mode is set when a lineup is saved; cash lineups stay cash and GPP lineups stay GPP" };
  if (body.name === undefined && !hasSlots && !hasSlate && body.tag === undefined) return { error: "nothing to change" };
  const slotsResult = hasSlots ? validateLineupSlots(body.slots) : {};
  if (slotsResult.error) return { error: slotsResult.error };
  const nameResult = validateLineupName(body.name);
  if (nameResult.error) return { error: nameResult.error };
  const tagResult = validateLineupTag(body.tag);
  if (tagResult.error) return { error: tagResult.error };
  const slates = Array.isArray(board?.slates) ? board.slates : [];
  const slateFound = findLineupSlate(body.slate, slates);
  if (slateFound.error) return { error: slateFound.error };
  const rowById = new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
  const patch = {};
  if (nameResult.name !== undefined) {
    const trimmed = nameResult.name.trim();
    patch.name = trimmed === "" ? nextLineupName(others.filter((l) => l.id !== existing.id)) : trimmed;
  }
  if (slotsResult.slots) {
    const check = hasSlate ? slateFound : findLineupSlate(existing.slate, slates);
    if (check.error) return { error: `This lineup was saved to the ${existing.slate} slate, which is not loaded this week; send a slate to move it.` };
    const snapshot = buildLineupSnapshot(slotsResult.slots, rowById, check.lineupSecondSlate);
    if (snapshot.error) return { error: snapshot.error };
    Object.assign(patch, { slots: snapshot.slots, salaryUsed: snapshot.salaryUsed, totalProj: snapshot.totalProj });
  } else if (slateFound.lineupSecondSlate) {
    const stored = (Array.isArray(existing.slots) ? existing.slots : []).map((s) => ({ slot: s.slot, playerId: String(s.playerId) }));
    const check = buildLineupSnapshot(stored, rowById, slateFound.lineupSecondSlate);
    if (check.error) return { error: check.error };
  }
  if (typeof slateFound.lineupSlate === "string" && slateFound.lineupSlate !== "") patch.slate = slateFound.lineupSlate;
  if (tagResult.tag !== undefined) patch.tag = tagResult.tag; // null clears the letter
  return { patch };
}

/** Edits device lineup `id` in place as store.js updateLineup does (PROJECT.md Part 4 Lineups); a slate naming another
 *  list moves it. {status: "updated", entry} | "missing" (not a device lineup) | "refused" (no storage, write failed). */
export function updateDeviceLineup(storage, season, week, id, patch) {
  if (!storage) return { status: "refused" };
  if (typeof id !== "string" || !id.startsWith(DEVICE_ID_PREFIX)) return { status: "missing" };
  const keys = weekKeys(storage, season, week);
  if (!keys) return { status: "refused" };
  for (const key of keys) {
    const list = readKey(storage, key);
    const idx = list.findIndex((l) => l.id === id);
    if (idx === -1) continue;
    const { name, slots, salaryUsed, totalProj, slate, tag } = patch ?? {};
    const entry = { ...list[idx] };
    if (name !== undefined) entry.name = name;
    if (slots !== undefined) {
      entry.slots = slots;
      if (entry.build && slotsPlayersDiffer(list[idx].slots, slots)) entry.build = buildAfterSlotEdit(entry.build); // as store.js updateLineup (ChatGPT wish g)
    }
    if (salaryUsed !== undefined) entry.salaryUsed = salaryUsed;
    if (totalProj !== undefined) entry.totalProj = totalProj;
    if (typeof slate === "string" && slate !== "") entry.slate = slate;
    if (tag === null) delete entry.tag;
    else if (typeof tag === "string" && tag !== "") entry.tag = tag;
    if ([name, slots, salaryUsed, totalProj, slate, tag].some((v) => v !== undefined)) entry.updatedAt = new Date().toISOString();
    const destKey = typeof entry.slate === "string" && entry.slate !== "" ? storageKey(season, week, entry.slate) : key;
    if (destKey === key) {
      const next = [...list];
      next[idx] = entry;
      return writeKey(storage, key, releaseLineupTag(next, id)) ? { status: "updated", entry } : { status: "refused" };
    }
    const destBefore = readKey(storage, destKey); // 🔵 2026-10-17: captured so the undo restores the holder's letter
    if (!writeKey(storage, destKey, releaseLineupTag([entry, ...destBefore], id))) return { status: "refused" };
    if (writeKey(storage, key, list.filter((l) => l.id !== id))) return { status: "updated", entry };
    writeKey(storage, destKey, destBefore); // undo the copy
    return { status: "refused" };
  }
  return { status: "missing" };
}

/** Adds `entry` to its slate's list (its letter, if any, leaves any other device lineup there in the same write).
 *  Returns true, or false when storage is unavailable or refused the write. */
export function saveDeviceLineup(storage, season, week, slateKey, entry) {
  if (!storage) return false;
  const key = storageKey(season, week, slateKey);
  return writeKey(storage, key, releaseLineupTag([entry, ...readKey(storage, key)], entry.id));
}

/**
 * Removes the device lineup `id` of the week. Returns "deleted", "missing" (no device lineup with that id, which
 * includes every baked app lineup) or "refused" (storage unavailable or the write failed).
 */
export function deleteDeviceLineup(storage, season, week, id) {
  if (!storage) return "refused";
  if (typeof id !== "string" || !id.startsWith(DEVICE_ID_PREFIX)) return "missing";
  const keys = weekKeys(storage, season, week);
  if (!keys) return "refused";
  for (const key of keys) {
    const list = readKey(storage, key);
    if (list.some((l) => l.id === id)) return writeKey(storage, key, list.filter((l) => l.id !== id)) ? "deleted" : "refused";
  }
  return "missing";
}
