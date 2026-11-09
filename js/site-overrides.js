// Stars, notes and typed projection and ownership numbers on the public site (DECISIONS.md D71, D28, D72): kept only
// in the visitor's browser, one localStorage entry per season and week, never sent anywhere. tools/publish.mjs copies
// this file to out/js/site-overrides.js and the shared board maths it imports, unchanged, to out/server/.
//
// What is stored is the visitor's CHANGES, in the shape PUT /api/overrides takes (server/overrides/merge.js
// applyOverrideChanges): { proj: {id: number | null}, own: {id: number | null}, stars: {id: true | false},
// notes: {id: text | null}, bump: {id: steps | null} }, where null clears a number, note or bump (Adam 2026-10-22, the
// ± bump, 5% a step; a 0 is kept as null) and false un-stars, plus cleared: {proj: {id: n},
// own: {id: n}, bump: {id: steps}}, the published number or bump each null cleared. They are applied over Adam's published overrides (read back
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
import { applyOverrideChanges, validateOverrides, mergeOverridesIntoRows, assertShowdownWriteIds, BUMP_MAX_STEPS } from "../server/overrides/merge.js";
import { remergeOverrides } from "../server/rank/remerge.js";
import { sidelinedIdsOf, zeroOutRows, rowIsOut } from "../server/rank/sidelined.js";
import { valueOf } from "../server/rank/value-core.js";
import { lineupRows } from "../server/showdown/lineup-rows.js";
import { TWOGUN_ID } from "../server/sources/selection-core.js";
import { overrideHow } from "../server/overrides/how.js"; // the sentence the served Showdown board writes for a typed projection and a bump

export const STORAGE_PREFIX = "nfldfs-site-overrides:";
export const STORAGE_UNAVAILABLE_MESSAGE = "This browser is not letting the site keep your changes (storage is switched off or full), so nothing was saved.";

/** The storage key for one season and week. */
export function storageKey(season, week) {
  return `${STORAGE_PREFIX}${season}-w${String(week).padStart(2, "0")}`;
}

const NUMBER_FIELDS = ["proj", "own"];
const emptyEdits = () => ({ proj: {}, own: {}, stars: {}, notes: {}, bump: {}, cleared: { proj: {}, own: {}, bump: {} } });

function isEmpty(edits) {
  return ["proj", "own", "stars", "notes", "bump"].every((k) => Object.keys(edits[k]).length === 0);
}

// A bump is a number change too, so Reset all undoes it.
const hasTypedNumbers = (edits) => [...NUMBER_FIELDS, "bump"].some((f) => Object.keys(edits[f]).length > 0);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
const validProj = (v) => isFiniteNumber(v);
const validOwn = (v) => isFiniteNumber(v) && v >= 0 && v <= 100;
const validBump = (v) => Number.isInteger(v) && v !== 0 && Math.abs(v) <= BUMP_MAX_STEPS;

function copyEdits(edits) {
  return {
    proj: { ...edits.proj }, own: { ...edits.own }, stars: { ...edits.stars }, notes: { ...edits.notes }, bump: { ...edits.bump },
    cleared: { proj: { ...edits.cleared.proj }, own: { ...edits.cleared.own }, bump: { ...edits.cleared.bump } },
    ...(edits.revive ? { revive: { ...edits.revive } } : {}),
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
  for (const [id, v] of section(raw, "bump")) if (v === null || validBump(v)) out.bump[id] = v;
  // Whether each typed projection revived a man the baked board listed out, decided when it was typed (as the app decides at its write, never again on a read). Edits saved before this
  // record existed have none (`revive` absent), and are judged once, on the next write.
  if (isObject(raw.revive)) {
    out.revive = {};
    for (const [id, v] of section(raw, "revive")) if (typeof v === "boolean") out.revive[id] = v;
  }
  const cleared = isObject(raw.cleared) ? raw.cleared : {};
  for (const [id, v] of section(cleared, "proj")) if (validProj(v)) out.cleared.proj[id] = v;
  for (const [id, v] of section(cleared, "own")) if (validOwn(v)) out.cleared.own[id] = v;
  for (const [id, v] of section(cleared, "bump")) if (validBump(v)) out.cleared.bump[id] = v;
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
  // A cleared bump stands, as a cleared number does, only while Adam still publishes the bump the visitor cleared.
  for (const [id, v] of Object.entries(out.bump)) {
    if (v === null && (out.cleared.bump[id] === undefined || out.cleared.bump[id] !== published.bump[id])) delete out.bump[id];
  }
  for (const id of Object.keys(out.cleared.bump)) if (out.bump[id] !== null) delete out.cleared.bump[id];
  for (const id of Object.keys(out.revive ?? {})) if (!isFiniteNumber(out.proj[id])) delete out.revive[id]; // a revive stands with the typed number it came with
  return out;
}

// What differs between the main slate's overlay and a Showdown game's (round 4, item 7: the one copy of the storage, the change record and the checks serves both): where the
// changes are kept (`keyOf(season, week)`; a Showdown passes its game key as `week`), what the baked board already says Adam published (`published(board)`), and how a board is
// rebuilt from the baked one and the effective overrides (`remerge(board, slate, overrides)`). The main slate's is the default of every function below.
const CLASSIC = Object.freeze({ keyOf: (season, week) => storageKey(season, week), published: (board) => publishedOverrides(board), remerge: (board, slate, overrides) => remergeOverrides(board, slate, overrides) });

/** The visitor's saved changes for the week; empty when storage is unavailable, empty or unreadable. An adapter with `load` reads its own entries (the Showdown Cash tab's two). */
function readEdits(storage, season, week, published, adapter = CLASSIC) {
  if (!storage) return emptyEdits();
  try {
    const raw = adapter.load ? adapter.load(storage, season, week) : storage.getItem(adapter.keyOf(season, week));
    return raw ? reconcile(cleanEdits(JSON.parse(raw)), published) : emptyEdits();
  } catch {
    return emptyEdits(); // unreadable or not JSON: ignored, the published board shows
  }
}

/** Writes the week's changes. Returns true, or false when storage is unavailable or the browser refused. An adapter with `save` writes its own entries. */
function writeEdits(storage, season, week, edits, adapter = CLASSIC) {
  if (!storage) return false;
  try {
    if (adapter.save) {
      adapter.save(storage, season, week, edits);
      return true;
    }
    const key = adapter.keyOf(season, week);
    if (isEmpty(edits)) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(edits));
    return true;
  } catch {
    return false;
  }
}

/** Adam's published overrides, read back off the baked board's rows (mergeOverridesIntoRows put every one there). */
export function publishedOverrides(board) {
  const out = { proj: {}, own: {}, stars: [], notes: {}, revive: [], bump: {}, updatedAt: null };
  for (const row of board?.rows ?? []) {
    if (!row || row.id == null) continue;
    const id = String(row.id);
    if (row.override?.proj != null) out.proj[id] = row.override.proj;
    if (row.override?.bump != null) out.bump[id] = row.override.bump; // Adam 2026-10-22: his ± bump survives a visitor's edit
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
function recordChanges(edits, changes, published, sidelined = null) {
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
  // Whether a typed projection revives a man the baked board lists out is decided here, at the write, as the app decides it (merge.js applyOverrideChanges, routes.js), and kept: a later
  // baked board that lists him differently does not bring him back or put him out. `sidelined`: the baked board's listed-out ids (null for a write that types no projection).
  if (sidelined) {
    next.revive = { ...(edits.revive ?? {}) };
    for (const [id, v] of Object.entries(changes?.proj ?? {})) {
      if (typeof v === "number" && v > 0) next.revive[id] = sidelined.has(id);
      else delete next.revive[id];
    }
    if (!edits.revive) { // edits saved before the record existed: judged once, now
      for (const [id, v] of Object.entries(next.proj)) if (isFiniteNumber(v) && v > 0 && !(id in next.revive)) next.revive[id] = sidelined.has(id);
    }
  }
  for (const [id, v] of Object.entries(changes?.stars ?? {})) next.stars[id] = Boolean(v); // truthy stars, as the app
  for (const [id, v] of Object.entries(changes?.notes ?? {})) next.notes[id] = v;
  // The ± bump: the new total of steps, as the app takes it; null or 0 clears Adam's published bump (kept as null, the
  // cleared bump recorded) or drops the visitor's own when Adam has none.
  for (const [id, v] of Object.entries(changes?.bump ?? {})) {
    delete next.cleared.bump[id];
    if (v !== null && v !== 0) next.bump[id] = v;
    else if (published.bump[id] !== undefined) {
      next.bump[id] = null;
      next.cleared.bump[id] = published.bump[id];
    } else delete next.bump[id];
  }
  return next;
}

/** Adam's published overrides with the visitor's changes applied (the `cleared` record is not part of them). */
function effective(published, edits, board) {
  const { cleared: _cleared, revive, ...changes } = edits;
  if (!revive) return applyOverrideChanges(published, changes, sidelinedIdsOf(board?.rows)); // saved before the revive record existed: judged on the baked board, as it was
  const out = applyOverrideChanges(published, changes, null); // a read never judges a revive again: the record made at the write is used
  for (const [id, v] of Object.entries(revive)) if (v === true && out.proj[id] !== undefined && !out.revive.includes(id)) out.revive.push(id);
  return out;
}

/** The baked board with Adam's published overrides plus `edits` merged by the app's remerge, flagged for Reset all. */
function remerged(board, slate, published, edits, adapter = CLASSIC) {
  const merged = adapter.remerge(board, slate, effective(published, edits, board));
  return { ...merged, siteTypedNumbers: hasTypedNumbers(edits) };
}

/**
 * The board the visitor sees: the baked board with this browser's saved changes for the week merged in, or the baked
 * board itself when there are none (or when they cannot be merged, which leaves the published board on screen).
 */
export function boardWithEdits(board, slate, storage, season, week, adapter = CLASSIC) {
  if (!board || board.ok === false || !Array.isArray(board.rows)) return board;
  const published = adapter.published(board);
  const edits = readEdits(storage, season, week, published, adapter);
  if (isEmpty(edits)) return { ...board, siteTypedNumbers: false };
  try {
    validateOverrides(effective(published, edits, board));
    return remerged(board, slate, published, edits, adapter);
  } catch (e) {
    console.warn("site overrides: saved changes not applied", e);
    return { ...board, siteTypedNumbers: false };
  }
}

// One write: the next changes from the current ones, checked as the app's write checks them (validateOverrides on
// the merged overrides), saved, and the board merged with them. Returns {board} or {error: {code, message}}.
function write(storage, season, week, board, slate, nextFrom, adapter = CLASSIC) {
  if (!storage) return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  const published = adapter.published(board);
  const next = nextFrom(readEdits(storage, season, week, published, adapter), published);
  try {
    validateOverrides(effective(published, next, board));
  } catch (e) {
    return { error: { code: e.code ?? "OVERRIDES_INVALID", message: e.message } };
  }
  // Merged before saving, so a board that cannot be merged never leaves changes behind in the browser.
  const merged = remerged(board, slate, published, next, adapter);
  if (!writeEdits(storage, season, week, next, adapter)) return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  return { board: merged };
}

/** PUT /api/overrides: `changes` is the route's body ({proj?, own?, stars?, notes?}). */
export function putEdits(storage, season, week, board, slate, changes, adapter = CLASSIC) {
  return write(storage, season, week, board, slate, (edits, published) => recordChanges(edits, isObject(changes) ? changes : {}, published, sidelinedIdsOf(board?.rows)), adapter);
}

/** DELETE /api/overrides/:id: each of the player's two numbers as the cell's reset x, and his bump cleared as the app's
 *  reset clears it; star and note stay (D72). */
export function resetPlayerEdits(storage, season, week, board, slate, id, adapter = CLASSIC) {
  return write(storage, season, week, board, slate, (edits, published) => recordChanges(edits, { proj: { [id]: null }, own: { [id]: null }, bump: { [id]: null } }, published), adapter);
}

/**
 * DELETE /api/overrides ("Reset all overrides"): every number the visitor typed or cleared goes, which puts back
 * Adam's published numbers; the visitor's stars and notes stay (D72).
 */
export function resetAllEdits(storage, season, week, board, slate, adapter = CLASSIC) {
  return write(storage, season, week, board, slate, (edits) => ({ ...emptyEdits(), stars: { ...edits.stars }, notes: { ...edits.notes } }), adapter);
}

// ---------------------------------------------------------------------------------------------------------------------
// A Showdown game's overlay (round 4 fix batch, item 7; D71: the site does everything the app does). The baked Showdown board cannot be rebuilt in the browser, so the visitor's changes
// are laid over the baked rows: Adam's published overrides are read back off the rows (as the main slate's are), the visitor's changes are recorded and checked by the same
// code above, the two are applied by the shared merge (server/overrides/merge.js), and the rows' figures follow as the server's served board makes them (proj, the Captain's 1.5x,
// value, the revive rule, ownership per seat). One copy per game, in this browser only, never sent anywhere.
//
// Not redone here, and said so on the board (deviceNote): R85, the check that each ownership source covers enough of the main players, runs on the server over the
// players' projections; a typed projection can change who counts as a main player, but the browser holds no source files to run it again, so ownership stays as published
// (a typed ownership number still shows). And the visitor cannot clear a typed ownership Adam published: the figure under it is not on the baked board.
// ---------------------------------------------------------------------------------------------------------------------

export const SHOWDOWN_STORAGE_PREFIX = "nfldfs-site-showdown-overrides:";
export const SHOWDOWN_DEVICE_NOTE = "Your typed projections and ± adjustments on this device do not re-check whether each ownership source covers enough of the main players (R85); ownership is as published, plus any number you typed.";
const CPT_MULT = 1.5;

/** Adam's published overrides on a Showdown board: the main slate's reading plus his typed Captain ownership, kept under the Captain id (row.override.ownCpt). */
export function showdownPublishedOverrides(board) {
  const out = publishedOverrides(board);
  for (const row of board?.rows ?? []) {
    if (row?.cptId != null && row.override?.ownCpt != null) out.own[String(row.cptId)] = row.override.ownCpt;
  }
  return out;
}

const pctText = (n) => `${Math.round(n * 100) / 100}%`;
const replacedWord = (kind) => (kind === "estimate" ? "our estimate" : "the published");

/** `how` with one side's sentence ("FLEX: ..." or "Captain: ...") replaced; the other side's and the shared notes stay. */
function withSide(how, side, sentence) {
  const marker = `${side}: `;
  const pieces = String(how ?? "").split(/\s+(?=(?:FLEX|Captain): )/).filter(Boolean);
  const kept = pieces.filter((p) => !p.startsWith(marker));
  return (side === "FLEX" ? [sentence, ...kept] : [...kept, sentence]).join(" ");
}

/** The baked Showdown `board` with the effective overrides laid over its rows. Pure; the baked board is not changed. */
export function remergeShowdown(board, overrides) {
  const bakedHow = new Map(board.rows.map((r) => [r.id, overrideHow(r)]));
  const typedOwn = overrides?.own ?? {};
  const merged = zeroOutRows(mergeOverridesIntoRows(board.rows.map((r) => ({ ...r, proj: r.projBase })), overrides));
  const rows = merged.map((m, i) => {
    const baked = board.rows[i];
    const { own: _own, ownBase: _ownBase, ...r } = m;
    const strip = bakedHow.get(baked.id);
    const baseHow = strip && String(baked.projHow ?? "").endsWith(` ${strip}`) ? String(baked.projHow).slice(0, -(strip.length + 1)) : String(baked.projHow ?? "");
    const how = overrideHow(r);
    r.projHow = how ? `${baseHow} ${how}` : baseHow;
    r.cptProj = typeof r.proj === "number" ? r.proj * CPT_MULT : null;
    r.value = valueOf(r.proj, r.salary);
    const flexTyped = Object.hasOwn(typedOwn, baked.id) ? typedOwn[baked.id] : null;
    const cptTyped = baked.cptId != null && Object.hasOwn(typedOwn, baked.cptId) ? typedOwn[baked.cptId] : null;
    r.override = { ...r.override, own: flexTyped, ownCpt: cptTyped };
    let how2 = baked.ownHow ?? "";
    r.ownFlex = baked.ownFlex;
    r.ownCpt = baked.ownCpt;
    r.ownKindFlex = baked.ownKindFlex;
    r.ownKindCpt = baked.ownKindCpt;
    // A number typed at a seat replaces the figure; a seat with none typed keeps the baked figure (Adam's own typed number included, which stays under a visitor's clear).
    if (flexTyped !== null && flexTyped !== (baked.override?.own ?? null)) { // Adam's own typed number is already in the baked figure and its sentence
      how2 = withSide(how2, "FLEX", `FLEX: Your override ${pctText(flexTyped)}${baked.ownFlex == null || baked.ownKindFlex === "override" ? "" : ` replaces ${replacedWord(baked.ownKindFlex)} ${pctText(baked.ownFlex)}`}.`);
      r.ownFlex = flexTyped;
      r.ownKindFlex = "override";
    }
    if (cptTyped !== null && cptTyped !== (baked.override?.ownCpt ?? null)) {
      how2 = withSide(how2, "Captain", `Captain: Your override ${pctText(cptTyped)}${baked.ownCpt == null || baked.ownKindCpt === "override" ? "" : ` replaces ${replacedWord(baked.ownKindCpt)} ${pctText(baked.ownCpt)}`}.`);
      r.ownCpt = cptTyped;
      r.ownKindCpt = "override";
    }
    const kinds = [r.ownKindFlex, r.ownKindCpt].filter(Boolean);
    r.ownKind = kinds.length === 0 ? null : kinds.includes("override") ? "override" : kinds.includes("estimate") ? "estimate" : "published";
    // A seat with a typed number reads "current", never TwoGun's alone, as the server's ownershipStep sets it, so the modes answer does not say of it that he is not on TwoGun's board (item 3).
    if (flexTyped !== null || cptTyped !== null) r.src = { ...(baked.src ?? {}), ...(flexTyped !== null ? { ownFlex: "current" } : {}), ...(cptTyped !== null ? { ownCpt: "current" } : {}) };
    r.ownHow = how2;
    return r;
  });
  // Only men and Captain ids that are on this baked board count: an edit kept for a man a later bake dropped, or for an id the bake renumbered, moves no figure here (round 4, item 13).
  const onBoard = new Set(board.rows.flatMap((r) => [r.id, r.cptId]).filter((id) => id != null).map(String));
  const publishedAll = showdownPublishedOverrides(board);
  const keep = (m) => Object.entries(m ?? {}).filter(([id]) => onBoard.has(id)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const moved = (field) => JSON.stringify(keep(overrides?.[field])) !== JSON.stringify(keep(publishedAll[field]));
  const typedProj = moved("proj") || moved("bump"); // a projection or a bump the visitor typed, or cleared from Adam's: either moves the main players' points R85 reads
  const removed = rows.filter(rowIsOut).map((r) => ({ id: r.id, name: r.name, team: r.team, pos: r.pos, status: r.status }));
  const sameFigures = figuresText(overrides, onBoard) === figuresText(publishedAll, onBoard);
  return {
    ...board,
    rows,
    removed,
    notes: hiddenNoteWith(board.notes, board.removed, removed),
    // The baked key stays while the figures are the published ones (a star, a note, or a clean board); it moves with a number that differs from them, so a batch made before it is refused after.
    figures: board.figures && !sameFigures ? { ...board.figures, key: `${board.figures.key ?? ""}~${figuresText(overrides, onBoard)}` } : board.figures,
    ...(typedProj ? { deviceNote: SHOWDOWN_DEVICE_NOTE } : {}),
  };
}

// The Hidden note the board's builder writes (server/showdown/board.js, rank/select-showdown.js) over the men listed out; one wording, kept in step with them by tests/showdown-board.test.mjs.
const HIDDEN_NOTE = "Hidden on the showdown lists";
const hiddenText = (removed) => `${HIDDEN_NOTE} as out or not expected to play (D45; Show all players shows them): ${removed.map((r) => `${r.name} (${r.team} ${r.pos}, ${r.status})`).join(", ")}.`;

/** `notes` with the Hidden note written again over `now`, the men now listed out, when that is not the baked list (`was`): a man a typed projection revived leaves it, and the note goes when nobody is out. */
function hiddenNoteWith(notes, was, now) {
  const list = Array.isArray(notes) ? notes : [];
  const ids = (l) => (l ?? []).map((r) => String(r.id)).sort().join(",");
  if (ids(was) === ids(now)) return list;
  const at = list.findIndex((n) => String(n).startsWith(HIDDEN_NOTE));
  if (!now.length) return at < 0 ? list : list.filter((_n, i) => i !== at);
  if (at < 0) return [...list, hiddenText(now)];
  return list.map((n, i) => (i === at ? hiddenText(now) : n));
}

/** A short stable text of what moves a figure (typed Proj and Own, bumps, revives) for the ids on the board, so a batch made before an edit is refused after it, as the server's figures key does. */
function figuresText(o, onBoard) {
  const entries = (m) => Object.entries(m ?? {}).filter(([id]) => onBoard.has(id)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const text = JSON.stringify([entries(o?.proj), entries(o?.own), entries(o?.bump), [...(o?.revive ?? [])].filter((id) => onBoard.has(id)).sort()]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16);
}

const SHOWDOWN = Object.freeze({ keyOf: (_season, gameKey) => `${SHOWDOWN_STORAGE_PREFIX}${gameKey}`, published: showdownPublishedOverrides, remerge: (board, _slate, overrides) => remergeShowdown(board, overrides) });

// The Cash tab (optimizer standard Part F, as the app's routes keep it: server/showdown/overrides-routes.js): its typed numbers, bumps and revives are an entry of their own, and its
// stars and notes are the GPP entry's, so a star or a note typed on either tab shows on both and a number typed on one never moves the other. The baked board it lays them over is the
// app's Cash board (board-cash.json), which carries Adam's Cash numbers and the shared stars and notes.
export const SHOWDOWN_CASH_STORAGE_PREFIX = "nfldfs-site-showdown-cash-overrides:";
export const CLASSIC_CASH_STORAGE_PREFIX = "nfldfs-site-cash-overrides:"; // the main slate's Cash tab, per week as its GPP entry
const SHARED_FIELDS = ["stars", "notes"];

/** One entry's object, or null when there is none or it is not well formed (ignored, as readEdits ignores it). */
function entryObject(storage, name) {
  const raw = storage.getItem(name);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return isObject(v) ? v : null;
  } catch {
    return null; // not JSON: no changes, as readEdits reads it
  }
}

/** The Cash tab's adapter over `base` (the main slate's or a Showdown game's): `cashKeyOf(season, week)` names Cash's entry, `base.keyOf` the GPP entry. */
function withCashTab(base, cashKeyOf) {
  return Object.freeze({
    ...base,
    // Cash's own entry with the GPP entry's stars and notes, as one record the shared code reads.
    load: (storage, season, week) => {
      const own = entryObject(storage, cashKeyOf(season, week));
      const shared = entryObject(storage, base.keyOf(season, week));
      if (!own && !shared) return null;
      const figures = Object.fromEntries(Object.entries(own ?? {}).filter(([k]) => !SHARED_FIELDS.includes(k)));
      return JSON.stringify({ ...figures, stars: shared?.stars, notes: shared?.notes });
    },
    // The numbers to Cash's entry, the stars and notes to GPP's (its numbers untouched); the two move together or not at all.
    save: (storage, season, week, edits) => {
      const { stars, notes, ...figures } = edits;
      const own = cashKeyOf(season, week);
      const was = storage.getItem(own);
      if (["proj", "own", "bump"].some((f) => Object.keys(figures[f]).length > 0)) storage.setItem(own, JSON.stringify(figures));
      else storage.removeItem(own);
      try {
        const gppKey = base.keyOf(season, week);
        const next = { ...(entryObject(storage, gppKey) ?? {}), stars, notes };
        if (isEmpty(cleanEdits(next))) storage.removeItem(gppKey);
        else storage.setItem(gppKey, JSON.stringify(next));
      } catch (e) {
        if (was === null) storage.removeItem(own);
        else storage.setItem(own, was);
        throw e;
      }
    },
  });
}

const SHOWDOWN_CASH = withCashTab(SHOWDOWN, (_season, gameKey) => `${SHOWDOWN_CASH_STORAGE_PREFIX}${gameKey}`);
const showdownAdapter = (tab) => (tab === "cash" ? SHOWDOWN_CASH : SHOWDOWN);

// The main slate's Cash tab (optimizer standard Part F): its own week's entry, the baked Cash board under it, stars and notes kept in the GPP entry as above. The second slates read the main board's rows, so they read these too.
const CLASSIC_CASH = withCashTab(CLASSIC, (season, week) => `${CLASSIC_CASH_STORAGE_PREFIX}${season}-w${String(week).padStart(2, "0")}`);

/** The adapter a main-slate write or read of `tab` goes through ("cash", or GPP's for anything else). */
export const classicAdapter = (tab) => (tab === "cash" ? CLASSIC_CASH : CLASSIC);

/** The Showdown board the visitor sees: the baked one with this browser's changes for the game `key` laid over it (the baked board itself when there are none). `tab` "cash": the Cash tab's
 *  changes over the baked Cash board; anything else is GPP's. */
export function showdownBoardWithEdits(board, storage, key, tab) {
  return boardWithEdits(board, null, storage, null, key, showdownAdapter(tab));
}

/**
 * The baked modes answer with this browser's typed numbers in it. The pool and the lineup read each man's figures from the modes answer's `current` reading once it is in, and the baked
 * file was written without the visitor's numbers, so a man whose figures differ on `edited` (the board with the edits laid over) from the `baked` board is read again as the server reads
 * him (meter-answer.js playerFigures over lineupRows, so a typed revive TwoGun-only mode ignores reads 0 here as Build counts it): his projection and the Captain's 1.5x, his two ownership
 * figures, the Q8 "not on TwoGun's board" flag of a seat that now has a typed number (it reads "current", not TwoGun's alone), the TwoGun-projects note only while he is still out, and no
 * missing reason once both seats have a figure. Pure; every other entry, note and mode is as baked. An answer that is not a modes answer is returned as it is.
 */
export function modesWithEdits(modes, baked, edited) {
  const players = modes?.modes?.current?.players;
  if (!players || !Array.isArray(baked?.rows) || !Array.isArray(edited?.rows)) return modes;
  const was = new Map(lineupRows(baked).map((r) => [String(r.id), r]));
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const next = { ...players };
  for (const r of lineupRows(edited)) {
    const id = String(r.id);
    const b = was.get(id);
    const p = players[id];
    if (!b || !p) continue;
    const moved = ["proj", "cptProj", "ownFlex", "ownCpt"].some((k) => r[k] !== b[k]) || r.src?.ownFlex !== b.src?.ownFlex || r.src?.ownCpt !== b.src?.ownCpt || rowIsOut(r) !== rowIsOut(b);
    if (!moved) continue;
    const proj = num(r.proj);
    const flexOff = Boolean(p.notOnBoardFlex) && r.src?.ownFlex === TWOGUN_ID;
    const cptOff = Boolean(p.notOnBoardCpt) && r.src?.ownCpt === TWOGUN_ID;
    const entry = { ...p, proj, cptProj: proj === null ? null : proj * CPT_MULT, ownFlex: num(r.ownFlex), ownCpt: num(r.ownCpt), notOnBoardFlex: flexOff, notOnBoardCpt: cptOff, notOnBoard: flexOff && cptOff };
    if (!rowIsOut(r)) entry.projNote = null; // the server's answer for a man who is not out
    if (entry.ownFlex !== null && entry.ownCpt !== null) entry.missingReason = null;
    next[id] = entry;
  }
  return { ...modes, modes: { ...modes.modes, current: { ...modes.modes.current, players: next } } };
}

/** PUT /api/showdown/<key>/overrides on the site: {board} or {error: {code, message}}. `board`: the baked board of `tab` ("cash" or GPP's when absent). */
export function putShowdownEdits(storage, key, board, changes, tab) {
  // The route's own id checks (merge.js assertShowdownWriteIds): a man or Captain id that is not on this game, and a star, note, typed projection or bump under a Captain id, are refused and nothing is kept.
  try {
    assertShowdownWriteIds(changes, (board?.rows ?? []).map((r) => ({ id: r.id, cptId: r.cptId })));
  } catch (e) {
    return { error: { code: e.code ?? "OVERRIDES_INVALID", message: e.message } };
  }
  return putEdits(storage, null, key, board, null, changes, showdownAdapter(tab));
}

/** DELETE /api/showdown/<key>/overrides on the site (Reset all overrides): the tab's numbers and bumps go; the other tab's, and the stars and notes, stay. */
export function resetAllShowdownEdits(storage, key, board, tab) {
  return resetAllEdits(storage, null, key, board, null, showdownAdapter(tab));
}
