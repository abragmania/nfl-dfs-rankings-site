// Stars, notes and typed projection and ownership numbers on the public site (DECISIONS.md D71, D28, D72): kept only
// in the visitor's browser, one localStorage entry per season and week, never sent anywhere. tools/publish.mjs copies
// this file to out/js/site-overrides.js and the shared board maths it imports, unchanged, to out/server/.
//
// What is stored is the visitor's CHANGES, in the shape PUT /api/overrides takes (server/overrides/merge.js
// applyOverrideChanges): { proj: {id: number | null}, own: {id: number | null}, stars: {id: true | false},
// notes: {id: text | null} }, where null clears a number or note and false un-stars, plus cleared: {proj: {id: n},
// own: {id: n}}, the published number each null cleared. They are applied over Adam's published overrides (read back
// off the baked board's rows, which carry every one of them), so a visitor can change or clear what Adam typed or
// starred, and Adam's later publishes of the same week still show through wherever the visitor has not touched a
// player. A cleared number whose published value has since changed is dropped on reading, so Adam's revision shows.
// The result is merged by the app's own remerge (server/rank/remerge.js), so the board answers as the app's override
// routes do. Stars are per week and second slates read the main board's rows, so
// stars carry across slates as in the app (D53, D57).
//
// The cell's reset x (a null for one number): a number the visitor typed goes first, which shows Adam's number again
// where he has one; with no number of the visitor's left, Adam's number is cleared, which shows the base. Reset all
// drops every typed number and clear, which puts back the published numbers; stars and notes stay (D72). Every board
// returned carries siteTypedNumbers (whether the visitor has any number change), which enables Reset all (app.js).
//
// Browser storage can be missing, switched off or full, and reading it can throw: every access is guarded (as in
// site-lineups.js). Saved data that is not well formed is ignored entry by entry; a write the browser refuses is a
// plain refusal and the board is left as it was. `storage` is passed in (the page's localStorage or a test double);
// null means unavailable. Pure apart from that: no network, no page.
import { applyOverrideChanges, validateOverrides } from "../server/overrides/merge.js";
import { remergeOverrides } from "../server/rank/remerge.js";
import { sidelinedIdsOf } from "../server/rank/sidelined.js";

export const STORAGE_PREFIX = "nfldfs-site-overrides:";
export const STORAGE_UNAVAILABLE_MESSAGE = "This browser is not letting the site keep your changes (storage is switched off or full), so nothing was saved.";

/** The storage key for one season and week. */
export function storageKey(season, week) {
  return `${STORAGE_PREFIX}${season}-w${String(week).padStart(2, "0")}`;
}

const NUMBER_FIELDS = ["proj", "own"];
const emptyEdits = () => ({ proj: {}, own: {}, stars: {}, notes: {}, cleared: { proj: {}, own: {} } });

function isEmpty(edits) {
  return ["proj", "own", "stars", "notes"].every((k) => Object.keys(edits[k]).length === 0);
}

const hasTypedNumbers = (edits) => NUMBER_FIELDS.some((f) => Object.keys(edits[f]).length > 0);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
const validProj = (v) => isFiniteNumber(v);
const validOwn = (v) => isFiniteNumber(v) && v >= 0 && v <= 100;

function copyEdits(edits) {
  return {
    proj: { ...edits.proj }, own: { ...edits.own }, stars: { ...edits.stars }, notes: { ...edits.notes },
    cleared: { proj: { ...edits.cleared.proj }, own: { ...edits.cleared.own } },
  };
}

// Only entries a write could have stored survive (the checks validateOverrides makes on the merged result).
function cleanEdits(raw) {
  const out = emptyEdits();
  if (!isObject(raw)) return out;
  const section = (obj, name) => (isObject(obj?.[name]) ? Object.entries(obj[name]) : []);
  for (const [id, v] of section(raw, "proj")) if (v === null || validProj(v)) out.proj[id] = v;
  for (const [id, v] of section(raw, "own")) if (v === null || validOwn(v)) out.own[id] = v;
  for (const [id, v] of section(raw, "stars")) if (typeof v === "boolean" && id !== "") out.stars[id] = v;
  for (const [id, v] of section(raw, "notes")) if (v === null || (typeof v === "string" && v.length < 500)) out.notes[id] = v;
  const cleared = isObject(raw.cleared) ? raw.cleared : {};
  for (const [id, v] of section(cleared, "proj")) if (validProj(v)) out.cleared.proj[id] = v;
  for (const [id, v] of section(cleared, "own")) if (validOwn(v)) out.cleared.own[id] = v;
  return out;
}

/**
 * A clear stands only while the published number is the one the visitor cleared: when Adam has since changed or
 * removed it (or the clear recorded none), the clear is dropped so his current number shows.
 */
function reconcile(edits, published) {
  const out = copyEdits(edits);
  for (const f of NUMBER_FIELDS) {
    for (const [id, v] of Object.entries(out[f])) {
      if (v !== null) continue;
      const was = out.cleared[f][id];
      if (was === undefined || published[f][id] === undefined || was !== published[f][id]) delete out[f][id];
    }
    for (const id of Object.keys(out.cleared[f])) if (out[f][id] !== null) delete out.cleared[f][id];
  }
  return out;
}

/** The visitor's saved changes for the week; empty when storage is unavailable, empty or unreadable. */
function readEdits(storage, season, week, published) {
  if (!storage) return emptyEdits();
  try {
    const raw = storage.getItem(storageKey(season, week));
    return raw ? reconcile(cleanEdits(JSON.parse(raw)), published) : emptyEdits();
  } catch {
    return emptyEdits(); // unreadable or not JSON: ignored, the published board shows
  }
}

/** Writes the week's changes. Returns true, or false when storage is unavailable or the browser refused. */
function writeEdits(storage, season, week, edits) {
  if (!storage) return false;
  try {
    const key = storageKey(season, week);
    if (isEmpty(edits)) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(edits));
    return true;
  } catch {
    return false;
  }
}

/** Adam's published overrides, read back off the baked board's rows (mergeOverridesIntoRows put every one there). */
export function publishedOverrides(board) {
  const out = { proj: {}, own: {}, stars: [], notes: {}, revive: [], updatedAt: null };
  for (const row of board?.rows ?? []) {
    if (!row || row.id == null) continue;
    const id = String(row.id);
    if (row.override?.proj != null) out.proj[id] = row.override.proj;
    if (row.override?.revive === true) out.revive.push(id);
    if (row.override?.own != null) out.own[id] = row.override.own;
    if (row.starred === true && !out.stars.includes(id)) out.stars.push(id);
    if (row.note != null) out.notes[id] = row.note;
  }
  return out;
}

/**
 * `edits` with a PUT /api/overrides body's changes recorded, values as sent (validated on the merged result). A null
 * number is the cell's reset x: the visitor's own number goes first; with none, Adam's number is cleared and recorded.
 */
function recordChanges(edits, changes, published) {
  const next = copyEdits(edits);
  for (const f of NUMBER_FIELDS) {
    for (const [id, v] of Object.entries(changes?.[f] ?? {})) {
      delete next.cleared[f][id];
      if (v !== null) next[f][id] = v;
      else if (next[f][id] !== undefined && next[f][id] !== null) delete next[f][id]; // back to Adam's number, or the base
      else if (published[f][id] !== undefined) {
        next[f][id] = null; // clears Adam's number: the base shows
        next.cleared[f][id] = published[f][id];
      } else delete next[f][id];
    }
  }
  for (const [id, v] of Object.entries(changes?.stars ?? {})) next.stars[id] = Boolean(v); // truthy stars, as the app
  for (const [id, v] of Object.entries(changes?.notes ?? {})) next.notes[id] = v;
  return next;
}

/** Adam's published overrides with the visitor's changes applied (the `cleared` record is not part of them). */
function effective(published, edits, board) {
  const { cleared: _cleared, ...changes } = edits;
  return applyOverrideChanges(published, changes, sidelinedIdsOf(board?.rows));
}

/** The baked board with Adam's published overrides plus `edits` merged by the app's remerge, flagged for Reset all. */
function remerged(board, slate, published, edits) {
  const merged = remergeOverrides(board, slate, effective(published, edits, board));
  return { ...merged, siteTypedNumbers: hasTypedNumbers(edits) };
}

/**
 * The board the visitor sees: the baked board with this browser's saved changes for the week merged in, or the baked
 * board itself when there are none (or when they cannot be merged, which leaves the published board on screen).
 */
export function boardWithEdits(board, slate, storage, season, week) {
  if (!board || board.ok === false || !Array.isArray(board.rows)) return board;
  const published = publishedOverrides(board);
  const edits = readEdits(storage, season, week, published);
  if (isEmpty(edits)) return { ...board, siteTypedNumbers: false };
  try {
    validateOverrides(effective(published, edits, board));
    return remerged(board, slate, published, edits);
  } catch (e) {
    console.warn("site overrides: saved changes not applied", e);
    return { ...board, siteTypedNumbers: false };
  }
}

// One write: the next changes from the current ones, checked as the app's write checks them (validateOverrides on
// the merged overrides), saved, and the board merged with them. Returns {board} or {error: {code, message}}.
function write(storage, season, week, board, slate, nextFrom) {
  if (!storage) return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  const published = publishedOverrides(board);
  const next = nextFrom(readEdits(storage, season, week, published), published);
  try {
    validateOverrides(effective(published, next, board));
  } catch (e) {
    return { error: { code: e.code ?? "OVERRIDES_INVALID", message: e.message } };
  }
  // Merged before saving, so a board that cannot be merged never leaves changes behind in the browser.
  const merged = remerged(board, slate, published, next);
  if (!writeEdits(storage, season, week, next)) return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  return { board: merged };
}

/** PUT /api/overrides: `changes` is the route's body ({proj?, own?, stars?, notes?}). */
export function putEdits(storage, season, week, board, slate, changes) {
  return write(storage, season, week, board, slate, (edits, published) => recordChanges(edits, isObject(changes) ? changes : {}, published));
}

/** DELETE /api/overrides/:id: each of the player's two numbers as the cell's reset x; star and note stay (D72). */
export function resetPlayerEdits(storage, season, week, board, slate, id) {
  return write(storage, season, week, board, slate, (edits, published) => recordChanges(edits, { proj: { [id]: null }, own: { [id]: null } }, published));
}

/**
 * DELETE /api/overrides ("Reset all overrides"): every number the visitor typed or cleared goes, which puts back
 * Adam's published numbers; the visitor's stars and notes stay (D72).
 */
export function resetAllEdits(storage, season, week, board, slate) {
  return write(storage, season, week, board, slate, (edits) => ({ ...emptyEdits(), stars: { ...edits.stars }, notes: { ...edits.notes } }));
}
