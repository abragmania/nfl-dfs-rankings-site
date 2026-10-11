// Adam's per-week overrides (PROJECT.md D28), the part that needs no file: validating an overrides object,
// applying changes, the two resets and the merge onto board rows. Pure (no node modules, no file reads), so the
// public site can run it in the visitor's browser (DECISIONS.md D71). store.js keeps the disk I/O and re-exports
// everything here, so every existing caller is unchanged.

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

  const notes = obj.notes ?? {};
  if (typeof notes !== "object" || Array.isArray(notes)) invalid("notes", "must be an object");
  for (const [id, v] of Object.entries(notes)) {
    if (typeof v !== "string") invalid("notes", `value for "${id}" must be a string`);
    if (v.length >= 500) invalid("notes", `value for "${id}" must be under 500 characters`);
  }
}

/**
 * Pure function: applies `changes` ({ proj?, own?, stars?, notes? }, each keyed by player id) onto
 * `current`, returning a new overrides object without mutating the input. A null value for proj/own/
 * notes removes that id's override; stars takes true (add) or false (remove).
 */
export function applyOverrideChanges(current, changes = {}) {
  const next = {
    proj: { ...current.proj },
    own: { ...current.own },
    stars: [...current.stars],
    notes: { ...current.notes },
    updatedAt: current.updatedAt
  };

  for (const [id, v] of Object.entries(changes.proj ?? {})) {
    if (v === null) delete next.proj[id];
    else next.proj[id] = v;
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
  return { proj: {}, own: {}, stars: [...(current.stars ?? [])], notes: { ...(current.notes ?? {}) }, updatedAt: current.updatedAt };
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

  return rows.map((row) => {
    const hasProj = Object.prototype.hasOwnProperty.call(proj, row.id);
    const hasOwn = Object.prototype.hasOwnProperty.call(own, row.id);
    return {
      ...row,
      projBase: row.proj,
      ownBase: row.own,
      proj: hasProj ? proj[row.id] : row.proj,
      own: hasOwn ? own[row.id] : row.own,
      override: { proj: hasProj ? proj[row.id] : null, own: hasOwn ? own[row.id] : null },
      starred: stars.has(row.id),
      note: Object.prototype.hasOwnProperty.call(notes, row.id) ? notes[row.id] : null
    };
  });
}
