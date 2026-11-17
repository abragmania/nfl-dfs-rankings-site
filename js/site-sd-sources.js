// Showdown source choices on the public site (RULES.md D71, Monday 11-09 orders item 6): a visitor ticks and weights a game's sources on its Sources page and the
// game's board is made again in the browser, exactly as the app makes it for the same choices. tools/publish.mjs bakes each game's engine inputs
// (GET /api/showdown/<key>/engine-inputs, server/showdown/engine-inputs.js) beside its board; this file reads them, keeps the visitor's choices for the game in this
// browser (one entry per game, never sent anywhere), changes them with the app's own rules (server/sources/selection-change.js applyChange, selection-core.js
// validateSelection), makes the board with servedFrom (server/showdown/serve-core.js, the code serveShowdownBoard runs) and lays out the Sources page body with
// showdownSelectionBody (server/sources/selection-view.js, the page's own). "Apply to every game" copies the choices over the published games the same way
// (selection-core.js withShownSections).
//
// A game whose inputs could not be baked has no choices to make: the page stays read-only with the sentence (engineProblem), never a re-blend from less.
// Storage can be missing, switched off or full: every access is guarded, a read that fails shows the published choices, a write that fails is a plain refusal.
import { decodeTagged } from "../server/showdown/tagged-json.js";
import { servedFrom } from "../server/showdown/serve-core.js";
import { EMPTY_OVERRIDES } from "../server/overrides/merge.js";
import { effectiveShowdownStatus } from "./site-overrides.js";
import { cashBoardNotes } from "../server/showdown/override-tabs.js";
import { boardTwoGun } from "../server/showdown/lineup-rows.js";
import { describeModes } from "../server/showdown/meter-answer.js";
import { applyChange } from "../server/sources/selection-change.js";
import { showdownSelectionBody, selectionHead } from "../server/sources/selection-view.js";
import { validateSelection, withShownSections, decide, KNOWN_IDS, SOURCE_KINDS, SELECTION_VERSION, ANY, TWOGUN_ID } from "../server/sources/selection-core.js";
import { STORAGE_UNAVAILABLE_MESSAGE } from "./site-lineups.js";

export const SD_SOURCES_PREFIX = "nfldfs-site-sd-sources:";
export const sdSourcesKey = (gameKey) => `${SD_SOURCES_PREFIX}${gameKey}`;
export const ENGINE_URL = (gameKey) => `baked/showdown/${encodeURIComponent(gameKey)}/engine-inputs.json`;
export const BOARD_URL = (gameKey) => `baked/showdown/${encodeURIComponent(gameKey)}/board.json`;
export const ENGINE_MISSING_SENTENCE = "This game's source choices are made in the app: the inputs its board is made from were not published with it, so what is shown is the board as published.";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// ---- the game's baked inputs ---------------------------------------------------------------------------------------------------

/** The decoded engine inputs of a baked file's JSON, or { problem } (a sentence) when the file says it could not be baked or is not what the engine needs. */
export function engineOf(raw) {
  if (isObject(raw) && raw.ok === false) return { problem: raw.error?.message ?? ENGINE_MISSING_SENTENCE };
  const data = decodeTagged(raw);
  const ok = isObject(data) && Array.isArray(data.base?.inputs?.rows) && isObject(data.choices?.selection) && isObject(data.choices.selection.kinds) && isObject(data.twogun)
    && isObject(data.slate) && isObject(data.overrides) && typeof data.choices.key === "string";
  return ok ? { payload: data } : { problem: ENGINE_MISSING_SENTENCE };
}

const engines = new Map(); // game key -> Promise<engineOf's answer>
/**
 * The game's engine inputs, read once per page: { payload } or { problem }. A file that is missing or cannot be read is kept as a problem for the page's life (a reload
 * tries again), so a game without inputs costs one request, not one per board. Inputs that no longer belong to the game's board (it was published again since they were
 * read: engineFresh) are dropped (forgetEngine) and read again with the next board.
 */
export function loadEngine(gameKey, getJson) {
  if (!engines.has(gameKey)) {
    const p = Promise.resolve().then(() => getJson(ENGINE_URL(gameKey))).then(engineOf, (e) => ({ problem: ENGINE_MISSING_SENTENCE, error: e?.message ?? String(e) }));
    engines.set(gameKey, p);
  }
  return engines.get(gameKey);
}

/** Drops what was read for the game, so the next loadEngine reads the file again. */
export function forgetEngine(gameKey) {
  engines.delete(gameKey);
}

/** Tests: forget what was read. */
export function forgetEngines() {
  engines.clear();
}

/** G62: said at the Sources page foot when the board for the visitor's choices could not be made in this browser and the published board shows. */
export const NOT_APPLIED_SENTENCE = "Your source choices could not be applied in this browser, so the published figures show.";

/** The sentence for inputs read before a newer publish (the page's own SITE_UPDATED line). */
export const SITE_UPDATED_SENTENCE = "The site was updated; reload the page.";

/**
 * Whether the engine inputs and the board belong to one publish: the route carries the figures key of the GPP and Cash boards it was read beside (engine-inputs.js), which
 * the baked board of that tab carries too. Inputs without the keys (baked before they existed) are taken as belonging.
 */
export function engineFresh(payload, bakedBoard, tab = "gpp") {
  const keys = payload?.figuresKeys;
  if (!isObject(keys) || !(tab in keys)) return true;
  return (keys[tab] ?? null) === (bakedBoard?.figures?.key ?? null);
}

/** `board` with one more line for the foot of the Sources page (board.siteNotes, public/js/sources-page.js). */
const withSiteNote = (board, line) => ({ ...board, siteNotes: [...(board.siteNotes ?? []), line] });

// ---- the visitor's choices for a game ------------------------------------------------------------------------------------------

/** A short stable text of a value (the keys in order), to compare two selections. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

function hashOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** What the visitor's change was made against: Adam's saved choices for the game (choices.key moves with every save of his). */
export const basisOf = (payload) => hashOf(payload.choices.key);

/** The choices as published: the effective selection the baked board was made from. */
export const publishedSelection = (payload) => payload.choices.selection;

/** The visitor's saved choices for the game, as { selection, at } when they were made against these published choices and are valid, else null. Never throws. */
export function readVisitor(storage, gameKey, payload) {
  if (!storage) return null;
  try {
    const raw = JSON.parse(storage.getItem(sdSourcesKey(gameKey)) ?? "null");
    if (!isObject(raw) || raw.basis !== basisOf(payload) || !isObject(raw.selection) || typeof raw.at !== "string") return null;
    if (validateSelection(raw.selection, knownIdsFor(raw.selection)).length > 0) return null;
    return { selection: raw.selection, at: raw.at };
  } catch {
    return null; // unreadable or not JSON: the published choices show
  }
}

/** validateSelection's knownIds: a stored id of a classic section stays known, as selection.js withStoredIds does. */
function knownIdsFor(selection) {
  const out = {};
  for (const k of SOURCE_KINDS) {
    if (!KNOWN_IDS[k]) continue;
    out[k] = [...KNOWN_IDS[k], ...Object.keys(selection.kinds?.[k]?.sources ?? {})];
  }
  return out;
}

/**
 * Why a choice kept in this browser for the game is not in force, as the one line for the Sources page foot (G62), or null when none is kept or it is in force: made
 * against choices Adam has since replaced, or not readable (not JSON, not a valid selection).
 */
export function setAsideLine(storage, gameKey, payload) {
  let text;
  try {
    text = storage?.getItem(sdSourcesKey(gameKey)) ?? null;
  } catch {
    return null;
  }
  if (text === null || readVisitor(storage, gameKey, payload)) return null;
  let earlier = false;
  try {
    earlier = JSON.parse(text)?.basis !== undefined && JSON.parse(text).basis !== basisOf(payload);
  } catch {
    earlier = false;
  }
  return earlier ? "Your saved choices for this game were made against an earlier publish, so the published choices show." : "Your saved choices for this game could not be read, so the published choices show.";
}

/** The choices now in force for the game: the visitor's, else the published. { selection, own: whether the visitor's }. */
export function selectionNow(storage, gameKey, payload) {
  const v = readVisitor(storage, gameKey, payload);
  return v ? { selection: v.selection, own: true, at: v.at } : { selection: publishedSelection(payload), own: false, at: null };
}

let epoch = 0;
/** Moves with every save of a game's choices in this page, so a board kept by the meter or the Optimizer can be read again. */
export const sourcesEpoch = () => epoch;

/** Saves `selection` as the visitor's for the game: { ok } or { error }. Equal to the published choices (and the game not on a default) it removes the entry. */
function saveVisitor(storage, gameKey, payload, selection, now) {
  if (!storage) return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  const same = stable(selection.kinds) === stable(publishedSelection(payload).kinds);
  try {
    // A game still on its default keeps a choice made (even an unchanged one) as its own, as the app's save does (selection-routes.js).
    if (same && !payload.choices.defaulted) storage.removeItem(sdSourcesKey(gameKey));
    else storage.setItem(sdSourcesKey(gameKey), JSON.stringify({ basis: basisOf(payload), at: now, selection }));
  } catch {
    return { error: { code: "DEVICE_STORAGE_UNAVAILABLE", message: STORAGE_UNAVAILABLE_MESSAGE } };
  }
  epoch += 1;
  return { ok: true };
}

// ---- the board for the choices -------------------------------------------------------------------------------------------------

const laterOf = (a, b) => (b && (!a || b > a) ? b : a);

/**
 * The game's board for `selection` on `tab` ("gpp" | "cash"), made as the app makes it (serveShowdownBoard's work, servedFrom), from the baked inputs and the overrides Adam
 * published. `bakedBoard` is the board as published for that tab: its stamp and figures key are the ones this board moves from.
 */
export function boardFor(payload, selection, tab, bakedBoard, { at = null, status = null } = {}) {
  const cash = tab === "cash";
  const choices = { ...payload.choices, selection };
  const base = { generatedAt: payload.base.generatedAt, inputs: payload.base.inputs };
  // `status`: the In / Out in force (Adam's published with this browser's, site-overrides.js effectiveShowdownStatus), so a man TwoGun lists out whom the visitor marks In is made as the app makes him.
  const published = (cash ? payload.overrides.cash : payload.overrides.gpp) ?? undefined;
  const overrides = status ? { ...EMPTY_OVERRIDES, ...(published ?? {}), status } : published;
  const served = servedFrom({ key: payload.key, slate: payload.slate, base, choices, edits: payload.edits, tw: payload.twogun, overrides }, {
    agreeWithin: payload.agreeWithin,
    generatedAtOf: () => laterOf(bakedBoard?.generatedAt ?? payload.base.generatedAt, at),
    figuresKey: () => `${bakedBoard?.figures?.key ?? ""}~src${hashOf(stable(selection.kinds))}` // moves with the ticks, so a batch made before a change is refused after it
  });
  return cash ? { ...served, notes: cashBoardNotes(served.notes, payload.overrides.cashUnreadable) } : served;
}

/**
 * The board the page shows for the game on `tab`: `bakedBoard` itself while the visitor has made no choice of their own, else the board for their choices. A baked board
 * that is not usable, or a game with no engine inputs, is returned as it is.
 */
export function visitorBoard({ storage, gameKey, tab, bakedBoard, engine }) {
  if (!bakedBoard || bakedBoard.ok === false || !Array.isArray(bakedBoard.rows) || !engine?.payload) return bakedBoard;
  if (!engineFresh(engine.payload, bakedBoard, tab)) {
    // The inputs were read beside an older board than this one: the published board shows with the line, and the inputs are read again next time.
    forgetEngine(gameKey);
    return withSiteNote(bakedBoard, SITE_UPDATED_SENTENCE);
  }
  const now = selectionNow(storage, gameKey, engine.payload);
  const status = effectiveShowdownStatus(bakedBoard, storage, gameKey, tab);
  if (!now.own && !statusMovesHim(bakedBoard, status)) {
    const why = setAsideLine(storage, gameKey, engine.payload);
    return why ? withSiteNote(bakedBoard, why) : bakedBoard;
  }
  const board = boardFor(engine.payload, now.selection, tab, bakedBoard, { at: now.at, status });
  const why = now.own ? null : setAsideLine(storage, gameKey, engine.payload);
  return why ? withSiteNote(board, why) : board;
}

/**
 * Whether the visitor's In / Out changes a man TwoGun lists out (src.status "twogun") from what the board was published with: Adam's In keeps his figure through that word
 * while it is above 0 (select.js dropsHisFigure), so the board is made again even with no source choice of the visitor's own. `status`: effectiveShowdownStatus.
 */
export function statusMovesHim(bakedBoard, status) {
  return (bakedBoard?.rows ?? []).some((r) => r.src?.status === TWOGUN_ID && (status?.[r.id] === "in") !== (r.override?.status === "in"));
}

/** Whether the board for `tab` has to be made again from the game's inputs even though the visitor ticked nothing: their In / Out moves a man TwoGun lists out. Reads storage only. */
export function statusNeedsEngine({ storage, gameKey, tab, bakedBoard }) {
  try {
    return statusMovesHim(bakedBoard, effectiveShowdownStatus(bakedBoard, storage, gameKey, tab));
  } catch {
    return false;
  }
}

/** Whether the visitor has made a choice of their own for the game (so its board is not the published one). Reads only storage. */
export function hasVisitorChoice(storage, gameKey) {
  try {
    return Boolean(storage) && storage.getItem(sdSourcesKey(gameKey)) !== null;
  } catch {
    return false;
  }
}

/**
 * GET .../modes for the visitor's choices: the app's answer (describeModes on the board and TwoGun's projections file, only while he is a ticked projection source)
 * over `board`, the game's GPP board for the choices; the published answer while the visitor has made no choice of their own.
 */
export function modesFor({ storage, gameKey, engine, board, bakedModes, forced = false }) {
  if (!engine?.payload || !(forced || readVisitor(storage, gameKey, engine.payload))) return bakedModes; // `forced`: the visitor's In / Out moves a man TwoGun lists out (statusNeedsEngine)
  const tp = boardTwoGun(board).proj ? engine.payload.twogun.tp ?? null : null;
  return { ...bakedModes, modes: describeModes(board, { tp }), stale: board.stale ?? [] };
}

// ---- the Sources page body and its changes --------------------------------------------------------------------------------------

/** The Sources page body for the game under `selection` (selection-view.js showdownSelectionBody, the page the app draws). */
export function pageBodyFor(payload, selection, own, bakedBoard, at) {
  const board = boardFor(payload, selection, "gpp", bakedBoard, { at });
  const c = {
    kinds: selection.kinds, cards: board.sources ?? [], sources: board.ownershipSources ?? [], coverage: board.ownershipCoverage ?? null, total: (board.rows ?? []).length,
    tp: payload.twogun.tp ?? null, tg: payload.twogun.tg ?? null, twogunNote: payload.twogun.note ?? null, ownershipSavedAt: payload.ownershipSavedAt ?? null,
    uploadedAt: payload.slate.uploadedAt ?? null, agreeWithin: payload.agreeWithin, season: payload.slate.season ?? null
  };
  const head = selectionHead({ scope: payload.key, selection, writable: payload.choices.writable !== false, note: payload.choices.note ?? null, defaulted: own ? false : payload.choices.defaulted });
  // siteLocal.changed: how many of the visitor's own choices differ from the published ones (the page says so and offers the one button that puts them back).
  return { ...showdownSelectionBody(c, head), siteLocal: { changed: own ? changedCount(selection, publishedSelection(payload)) : 0 } };
}

/** How many choices differ between two selections: each source whose tick or ticked weight differs, each section whose gaps differ, and the FLEX method. */
export function changedCount(selection, published) {
  let n = 0;
  for (const k of SOURCE_KINDS) {
    const a = selection.kinds?.[k];
    const b = published.kinds?.[k];
    if ((a?.gaps ?? null) !== (b?.gaps ?? null)) n += 1;
    if (k === "sdOwnFlex" && (a?.method ?? null) !== (b?.method ?? null)) n += 1;
    for (const id of new Set([...Object.keys(a?.sources ?? {}), ...Object.keys(b?.sources ?? {})])) {
      const x = decide(selection.kinds, k, id);
      const y = decide(published.kinds, k, id);
      if (Boolean(x?.use) !== Boolean(y?.use) || (x?.use && x.weight !== y?.weight)) n += 1;
    }
  }
  return n;
}

const refusal = (code, message) => ({ error: { code, message } });

/** The refusal for inputs that belong to an older publish than the board (engineFresh); the inputs are dropped so the next read takes the new ones. null when they belong. */
function staleRefusal(gameKey, payload, bakedBoard) {
  if (engineFresh(payload, bakedBoard, "gpp")) return null;
  forgetEngine(gameKey);
  return refusal("SITE_UPDATED", SITE_UPDATED_SENTENCE);
}

/** GET .../source-selection?slate=<game> for the visitor: the body, or { error }. */
export function readBody({ storage, gameKey, engine, bakedBoard }) {
  if (!engine?.payload) return refusal("ENGINE_INPUTS_MISSING", engine?.problem ?? ENGINE_MISSING_SENTENCE);
  const stale = staleRefusal(gameKey, engine.payload, bakedBoard);
  if (stale) return stale;
  const now = selectionNow(storage, gameKey, engine.payload);
  return { body: pageBodyFor(engine.payload, now.selection, now.own, bakedBoard, now.at) };
}

/** "Back to the published weights" for the game: the visitor's entry removed. { body } or { error }. */
function resetBody({ storage, gameKey, payload, bakedBoard }) {
  if (!storage) return refusal("DEVICE_STORAGE_UNAVAILABLE", STORAGE_UNAVAILABLE_MESSAGE);
  try {
    storage.removeItem(sdSourcesKey(gameKey));
  } catch {
    return refusal("DEVICE_STORAGE_UNAVAILABLE", STORAGE_UNAVAILABLE_MESSAGE);
  }
  epoch += 1;
  return { body: pageBodyFor(payload, publishedSelection(payload), false, bakedBoard, null) };
}

/**
 * POST .../source-selection?slate=<game> for the visitor: one change (a preset, a tick, a weight, the gaps, the FLEX method), made with the app's own applyChange and
 * checked with its validateSelection, kept in this browser. { body } on success, { error } with the app's own sentence on a refusal; nothing is kept on a refusal.
 */
export function changeBody({ storage, gameKey, engine, bakedBoard, change, nowIso = new Date().toISOString() }) {
  if (!engine?.payload) return refusal("ENGINE_INPUTS_MISSING", engine?.problem ?? ENGINE_MISSING_SENTENCE);
  const { payload } = engine;
  const stale = staleRefusal(gameKey, payload, bakedBoard);
  if (stale) return stale;
  if (payload.choices.writable === false) return refusal("SELECTION_UNREADABLE", payload.choices.note ?? "This game's source choices cannot be changed.");
  if (change && change.reset === true) return resetBody({ storage, gameKey, payload, bakedBoard });
  const now = selectionNow(storage, gameKey, payload);
  const showdownIds = (payload.base.inputs.ownershipSources ?? []).map((s) => s.id);
  const changed = applyChange(now.selection, change, { showdownIds, listUnread: false, showdown: true });
  if (changed.error) return refusal("VALIDATION_ERROR", changed.error);
  const next = { ...changed.selection, version: SELECTION_VERSION };
  const problems = validateSelection(next, knownIdsFor(next));
  if (problems.length) return refusal("SELECTION_INVALID", problems.join(" "));
  const saved = saveVisitor(storage, gameKey, payload, next, nowIso);
  if (saved.error) return saved;
  const after = selectionNow(storage, gameKey, payload);
  return { body: pageBodyFor(payload, after.own ? after.selection : next, after.own, bakedBoard, after.at) };
}

/** The ids `sel` ticks in the Showdown ownership sections that the game's own ownership files do not list ("*" and TwoGun are every game's); selection-routes.js lackingIds. */
function lackingIds(payload, sel) {
  const listed = (payload.base.inputs.ownershipSources ?? []).map((s) => s.id);
  const ticked = ["sdOwnFlex", "sdOwnCpt"].flatMap((k) => Object.entries(sel.kinds[k]?.sources ?? {}).filter(([, e]) => e?.use === true).map(([id]) => id));
  return [...new Set(ticked)].filter((id) => id !== ANY && id !== TWOGUN_ID && !listed.includes(id));
}

/**
 * "Apply to every game" from the game on screen (selection-routes.js applyAllEntries, in the browser): the sections its page shows are copied onto every other published
 * game whose inputs could be read and belong to the board published with them, each kept in this browser. `mainStep(projection)` (async, from site-src/api.js) carries the
 * projection section to the main slate last and answers { error } | { changed, notes }; it is part of the one apply: a refusal anywhere puts every game back as it was
 * (or names the games it could not put back), so the answer is true. { body (this game's page body with `applied`: scopes, written, skipped, lacking, mainNotes) } or { error }.
 */
export async function applyAllBody({ storage, gameKey, engine, bakedBoard, gameKeys, getJson, mainStep = async () => ({ changed: false, notes: [] }), nowIso = new Date().toISOString() }) {
  if (!engine?.payload) return refusal("ENGINE_INPUTS_MISSING", engine?.problem ?? ENGINE_MISSING_SENTENCE);
  const stale = staleRefusal(gameKey, engine.payload, bakedBoard);
  if (stale) return stale;
  if (!gameKeys.includes(gameKey)) return refusal("NOT_FOUND", `No Showdown game ${gameKey} is published, so nothing was applied.`);
  const from = selectionNow(storage, gameKey, engine.payload);
  const view = { ...from.selection, kinds: structuredClone(from.selection.kinds) };
  const written = [];
  const skipped = [];
  const lacking = [];
  const plan = [];
  for (const key of gameKeys.filter((k) => k !== gameKey)) {
    const other = await loadEngine(key, getJson);
    // A game whose inputs are missing, whose choices cannot be written, or whose inputs belong to another publish than its board is left as it was and named.
    let fresh = Boolean(other.payload);
    if (fresh) {
      try {
        fresh = engineFresh(other.payload, await getJson(BOARD_URL(key)), "gpp");
      } catch {
        fresh = false;
      }
      if (!fresh) forgetEngine(key);
    }
    if (!fresh || other.payload.choices.writable === false) {
      skipped.push({ key, why: "unreadable" });
      continue;
    }
    const target = selectionNow(storage, key, other.payload);
    const next = withShownSections(target.selection, view, "showdown", "showdown");
    const problems = validateSelection(next, knownIdsFor(next));
    if (problems.length) return refusal("SELECTION_INVALID", `The ${key} game: ${problems.join(" ")}`);
    plan.push({ key, payload: other.payload, next, changed: stable(next.kinds) !== stable(target.selection.kinds) });
    const ids = lackingIds(other.payload, next);
    if (ids.length) lacking.push({ scope: key, ids });
  }
  // Every game is checked before any is kept, as the app's one atomic write is: a refusal after the first save puts every game back as it was before this apply.
  const keys = [gameKey, ...plan.map((p) => p.key)];
  const before = new Map(keys.map((k) => [k, rawOf(storage, k)]));
  const undo = (error) => {
    const failed = [];
    for (const [k, raw] of before) {
      try {
        if (raw === undefined) throw new Error("not read");
        if (raw === null) storage.removeItem(sdSourcesKey(k));
        else storage.setItem(sdSourcesKey(k), raw);
      } catch {
        failed.push(k);
      }
    }
    epoch += 1;
    return refusal(error.code, failed.length ? `${error.message} These games could not be put back as they were and kept the copied choices: ${failed.join(", ")}.` : `${error.message} Every game was put back as it was.`);
  };
  const own = saveVisitor(storage, gameKey, engine.payload, from.selection, nowIso);
  if (own.error) return undo(own.error);
  for (const p of plan) {
    const saved = saveVisitor(storage, p.key, p.payload, p.next, nowIso);
    if (saved.error) return undo(saved.error);
    if (p.changed) written.push(p.key);
  }
  const main = await mainStep(view.kinds.projection);
  if (main.error) return undo(main.error);
  const after = selectionNow(storage, gameKey, engine.payload);
  const body = pageBodyFor(engine.payload, after.selection, after.own, bakedBoard, after.at);
  // "classic" is listed only when the main slate took something; what it could not take is named (mainNotes).
  const scopes = [...(main.changed ? ["classic"] : []), gameKey, ...plan.map((p) => p.key)];
  return { body: { ...body, applied: { scopes, written, skipped, lacking, mainNotes: main.notes ?? [] } } };
}

/** The raw text kept for a game, null when none, undefined when it cannot be read (so it cannot be put back). */
function rawOf(storage, gameKey) {
  try {
    return storage ? storage.getItem(sdSourcesKey(gameKey)) : undefined;
  } catch {
    return undefined;
  }
}
