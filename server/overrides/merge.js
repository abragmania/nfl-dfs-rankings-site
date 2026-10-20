// Adam's per-week overrides (PROJECT.md D28), the part that needs no file: validating an overrides object,
// applying changes, the two resets and the merge onto board rows. Pure (no node modules, no file reads), so the
// public site can run it in the visitor's browser (DECISIONS.md D71). store.js keeps the disk I/O and re-exports
// everything here, so every existing caller is unchanged.

/** No typed numbers: the one frozen copy that select.js, select-showdown.js, overlay.js and mode.js fall back to. */
export const EMPTY_OVERRIDES = Object.freeze({
  proj: Object.freeze({}), own: Object.freeze({}), stars: Object.freeze([]), notes: Object.freeze({}),
  revive: Object.freeze([]), reviveTwoGun: Object.freeze([]), updatedAt: null
});

function invalid(field, detail) {
  const err = new Error(`OVERRIDES_INVALID: ${field}${detail ? ` ${detail}` : ""}`);
  err.code = "OVERRIDES_INVALID";
  throw err;
}

/** Throws OVERRIDES_INVALID (naming the field) unless obj holds a well-formed overrides shape. */
export function validateOverrides(obj) {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) invalid("overrides object", "must be an object");

  const proj = obj.proj ?? {};
  if (typeof proj !== "object" || Array.isArray(proj)) invalid("proj", "must be an object");
  for (const [id, v] of Object.entries(proj)) {
    if (typeof v !== "number" || !Number.isFinite(v)) invalid("proj", `value for "${id}" must be a finite number`);
  }

  const own = obj.own ?? {};
  if (typeof own !== "object" || Array.isArray(own)) invalid("own", "must be an object");
  for (const [id, v] of Object.entries(own)) {
    if (typeof v !== "number" || !Number.isFinite(v)) invalid("own", `value for "${id}" must be a finite number`);
    if (v < 0 || v > 100) invalid("own", `value for "${id}" must be within 0-100`);
  }

  const stars = obj.stars ?? [];
  if (!Array.isArray(stars)) invalid("stars", "must be an array");
  const seen = new Set();
  for (const id of stars) {
    if (typeof id !== "string" || id.length === 0) invalid("stars", "ids must be non-empty strings");
    if (seen.has(id)) invalid("stars", `duplicate id "${id}"`);
    seen.add(id);
  }

  // revive / reviveTwoGun: ids typed while the current board / only TwoGun's board listed them out.
  for (const key of ["revive", "reviveTwoGun"]) {
    const list = obj[key] ?? [];
    if (!Array.isArray(list)) invalid(key, "must be an array");
    const seenRevive = new Set();
    for (const id of list) {
      if (typeof id !== "string" || id.length === 0) invalid(key, "ids must be non-empty strings");
      if (seenRevive.has(id)) invalid(key, `duplicate id "${id}"`);
      seenRevive.add(id);
    }
  }

  const notes = obj.notes ?? {};
  if (typeof notes !== "object" || Array.isArray(notes)) invalid("notes", "must be an object");
  for (const [id, v] of Object.entries(notes)) {
    if (typeof v !== "string") invalid("notes", `value for "${id}" must be a string`);
    if (v.length >= 500) invalid("notes", `value for "${id}" must be under 500 characters`);
  }
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function badShape(message) {
  const err = new Error(`${message}, so nothing was saved.`);
  err.code = "OVERRIDES_INVALID";
  throw err;
}

/**
 * A7: checks a change request before anything is applied. Throws OVERRIDES_INVALID (a plain sentence) unless
 * `changes` is a plain object whose present sections have the change shape applyOverrideChanges reads: proj, own and
 * notes plain objects keyed by player id, stars a plain object of player id to true or false. An array section is
 * refused, never read as ids "0", "1", ... Then throws OVERRIDES_NOT_ON_SLATE (naming the ids) unless every player id
 * the write names - each key of those sections, plus `extraIds` (the per-player reset's id) - is on the loaded slate.
 * `slateIds`: the loaded slate's player ids (any iterable). A write for a player who is not on the slate (a sample
 * page's fixture id, a stale tab from an earlier upload) is refused, never stored.
 */
export function assertIdsOnSlate(changes, slateIds, extraIds = []) {
  if (!isPlainObject(changes)) badShape("A change to the overrides must be an object");
  const known = new Set([...(slateIds ?? [])].map(String));
  const named = new Set(extraIds.map(String));
  for (const field of ["proj", "own", "stars", "notes"]) {
    const section = changes[field];
    if (section === undefined) continue;
    if (!isPlainObject(section)) badShape(`"${field}" must be an object keyed by player id`);
    if (field === "stars") {
      for (const [id, v] of Object.entries(section)) {
        if (typeof v !== "boolean") badShape(`The star for player id "${id}" must be true or false`);
      }
    }
    for (const id of Object.keys(section)) named.add(id);
  }
  const unknown = [...named].filter((id) => !known.has(id));
  if (!unknown.length) return;
  const shown = unknown.slice(0, 5).map((id) => `"${id}"`).join(", ");
  const more = unknown.length > 5 ? ` and ${unknown.length - 5} more` : "";
  const err = new Error(
    `${unknown.length === 1 ? "Player id" : "Player ids"} ${shown}${more} ${unknown.length === 1 ? "is" : "are"} not on the loaded slate, so nothing was saved.`
  );
  err.code = "OVERRIDES_NOT_ON_SLATE";
  throw err;
}

/**
 * Pure function: applies `changes` ({ proj?, own?, stars?, notes? }, each keyed by player id) onto
 * `current`, returning a new overrides object without mutating the input. A null value for proj/own/
 * notes removes that id's override; stars takes true (add) or false (remove).
 */
export function applyOverrideChanges(current, changes = {}, sidelinedIds = null, sidelinedTwoGunIds = null) {
  const next = {
    proj: { ...current.proj },
    own: { ...current.own },
    stars: [...current.stars],
    notes: { ...current.notes },
    revive: [...(current.revive ?? [])],
    reviveTwoGun: [...(current.reviveTwoGun ?? [])],
    updatedAt: current.updatedAt
  };

  for (const [id, v] of Object.entries(changes.proj ?? {})) {
    next.revive = next.revive.filter((r) => r !== id);
    next.reviveTwoGun = next.reviveTwoGun.filter((r) => r !== id);
    if (v === null) delete next.proj[id];
    else {
      next.proj[id] = v;
      // Out on the current board: revive (both modes); out only on TwoGun's board: reviveTwoGun (TwoGun mode only).
      if (v > 0 && sidelinedIds && sidelinedIds.has(id)) next.revive.push(id);
      else if (v > 0 && sidelinedTwoGunIds && sidelinedTwoGunIds.has(id)) next.reviveTwoGun.push(id);
    }
  }
  for (const [id, v] of Object.entries(changes.own ?? {})) {
    if (v === null) delete next.own[id];
    else next.own[id] = v;
  }
  for (const [id, v] of Object.entries(changes.stars ?? {})) {
    const has = next.stars.includes(id);
    if (v && !has) next.stars.push(id);
    else if (!v && has) next.stars = next.stars.filter((s) => s !== id);
  }
  for (const [id, v] of Object.entries(changes.notes ?? {})) {
    if (v === null) delete next.notes[id];
    else next.notes[id] = v;
  }

  return next;
}

/**
 * Pure function: removes one player's typed projection and ownership numbers. His star and note stay
 * (DECISIONS.md D72); stars and notes are copied, never shared with the input.
 */
export function resetPlayer(current, id) {
  const next = {
    proj: { ...current.proj },
    own: { ...current.own },
    stars: [...(current.stars ?? [])],
    notes: { ...(current.notes ?? {}) },
    revive: (current.revive ?? []).filter((r) => r !== id),
    reviveTwoGun: (current.reviveTwoGun ?? []).filter((r) => r !== id),
    updatedAt: current.updatedAt
  };
  delete next.proj[id];
  delete next.own[id];
  return next;
}

/**
 * Pure function: clears every typed projection and ownership number for the week (one button, PROJECT.md D28).
 * Stars and notes stay (DECISIONS.md D72): Adam's stars outlive a reset of the numbers.
 */
export function resetAll(current) {
  return { proj: {}, own: {}, stars: [...(current.stars ?? [])], notes: { ...(current.notes ?? {}) }, revive: [], reviveTwoGun: [], updatedAt: current.updatedAt };
}

/**
 * Merges overrides onto board rows without adding or dropping any row (PROJECT.md D27). Each returned
 * row keeps its original fields plus projBase, ownBase (the pre-override values), proj/own replaced by
 * the override when present, override: {proj, own} (null when not overridden), starred and note.
 */
export function mergeOverridesIntoRows(rows, overrides) {
  const proj = overrides?.proj ?? {};
  const own = overrides?.own ?? {};
  const stars = new Set(overrides?.stars ?? []);
  const notes = overrides?.notes ?? {};
  const revive = new Set(overrides?.revive ?? []);

  return rows.map((row) => {
    const hasProj = Object.prototype.hasOwnProperty.call(proj, row.id);
    const hasOwn = Object.prototype.hasOwnProperty.call(own, row.id);
    const marked = hasProj && revive.has(row.id);
    return {
      ...row,
      projBase: row.proj,
      ownBase: row.own,
      proj: hasProj ? proj[row.id] : row.proj,
      own: hasOwn ? own[row.id] : row.own,
      override: { proj: hasProj ? proj[row.id] : null, own: hasOwn ? own[row.id] : null, ...(marked ? { revive: true } : {}) },
      starred: stars.has(row.id),
      note: Object.prototype.hasOwnProperty.call(notes, row.id) ? notes[row.id] : null
    };
  });
}
