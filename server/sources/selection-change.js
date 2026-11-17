// One change to the saved source choices, from the Sources page's POST body (Sources page plan, 2026-10-18). Pure: it
// takes the stored choices and the body and returns the new choices or a plain-English refusal; the caller validates the
// whole result (validateSelection) and writes it.
//   {preset: "twogun" | "ours"}            the whole selection becomes that preset (stored weights of unticked sources stay)
//   {kind, sourceId, use: true | false}    tick or untick one source (lines: make it the main line source)
//   {kind, sourceId, weight: number}       a ticked or unticked source's weight, WEIGHT_MIN (0.25) up to WEIGHT_MAX (10), two decimals
//   {kind, gaps: "backup" | "blank"}       what happens to a player the ticked sources miss
//   {kind: "sdOwnFlex", method: "d41" | "weighted"}   how Showdown FLEX ownership is combined
import { applyPreset, classicProjectionGaps, decide, weightProblem, KNOWN_IDS, KINDS, SOURCE_KINDS, GAPS, METHODS, PRESETS, PRESET_LABELS, KIND_LABELS as KIND_NAMES, TWOGUN_ID, LINE_PRIMARIES } from "./selection-core.js";

const fail = (error) => ({ error });
const SHOWDOWN_ONLY = new Set(["sdOwnFlex", "sdOwnCpt"]);

function sourceProblem(kind, sourceId, showdownIds, listUnread) {
  if (typeof sourceId !== "string" || !sourceId.trim()) return "Say which source (sourceId).";
  if (KNOWN_IDS[kind]) return KNOWN_IDS[kind].includes(sourceId) ? null : `"${sourceId}" is not a source this app knows for ${KIND_NAMES[kind]}.`;
  if (sourceId === TWOGUN_ID) return null;
  if (listUnread) return "This game's ownership list could not be read just now, so of its ownership rows only TwoGun's can be changed.";
  if ((showdownIds ?? null) === null || showdownIds.includes(sourceId)) return null;
  return `"${sourceId}" is not a source on this game's ownership list.`;
}

function setSource(sel, kind, sourceId, patch) {
  const next = structuredClone(sel);
  const base = decide(sel.kinds, kind, sourceId) ?? { use: false, weight: PRESETS.ours[kind].sources[sourceId]?.weight ?? 1 };
  next.kinds[kind].sources[sourceId] = { ...base, ...patch };
  return { selection: next };
}

function setSwitch(sel, kind, sourceId, use) {
  const next = structuredClone(sel);
  if (kind === "lines") {
    if (!LINE_PRIMARIES.includes(sourceId)) return fail(`"${sourceId}" is not a line source; pick the ESPN scoreboard or TwoGun.`);
    next.kinds.lines.primary = use ? sourceId : LINE_PRIMARIES.find((id) => id !== sourceId);
  } else if (sourceId !== TWOGUN_ID) {
    return fail(kind === "injuries" ? "ESPN's injury report is always used (Sleeper fills in when it is down); only TwoGun's calls can be switched." : `"${sourceId}" is not a TwoGun extra.`);
  } else if (kind === "injuries") next.kinds.injuries.twogunCalls = use;
  else next.kinds.extras.twogun = use;
  return { selection: next };
}

function changeSource(sel, body, showdownIds, listUnread) {
  const { kind, sourceId } = body;
  if ("use" in body && "weight" in body) return fail("Send the tick and the weight as two changes.");
  const sw = !SOURCE_KINDS.includes(kind);
  if ("weight" in body && sw) return fail(`${KIND_NAMES[kind]} has no weights.`);
  // A source already stored in the section can always be unticked, even one this game's ownership list does not carry (copied in by
  // "apply to every game", shown on the page as "not on this game's list").
  const unticking = !KNOWN_IDS[kind] && body.use === false && Object.hasOwn(sel.kinds?.[kind]?.sources ?? {}, sourceId);
  const bad = sw || unticking ? null : sourceProblem(kind, sourceId, showdownIds, listUnread);
  if (bad) return fail(bad);
  if ("use" in body) {
    if (typeof body.use !== "boolean") return fail("use must be true or false.");
    if (sw) return setSwitch(sel, kind, sourceId, body.use);
    // Ticking a source whose saved weight is 0 gives it the preset's weight (1), as a ticked source cannot weigh 0. A saved
    // weight above 0 but under WEIGHT_MIN is kept as it is: only a new weight is held to the floor, a stored one still reads.
    const w = decide(sel.kinds, kind, sourceId)?.weight;
    return setSource(sel, kind, sourceId, { use: body.use, ...(body.use && !(w > 0) ? { weight: 1 } : {}) });
  }
  const problem = weightProblem(body.weight);
  return problem ? fail(problem) : setSource(sel, kind, sourceId, { weight: body.weight });
}

/**
 * Applies one change body to the stored choices. Returns { selection } (a new object; not yet validated as a whole) or
 * { error } in plain English. `showdownIds` is the list of ownership source ids on the Showdown being edited (null: not checked);
 * `listUnread` is true when that list could not be read (its board failed), so only TwoGun's Showdown rows can be changed.
 * `showdown` is true when the change comes from a Showdown's page: the Showdown ownership sections are changed from there only.
 */
export function applyChange(stored, body, { showdownIds = null, listUnread = false, showdown = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Send the change as an object.");
  if ("preset" in body) {
    if (Object.keys(body).length !== 1) return fail("A preset change takes only the preset.");
    return Object.hasOwn(PRESETS, body.preset) ? { selection: applyPreset(body.preset, stored, showdown ? "showdown" : "classic") } : fail(`The preset must be "twogun" (${PRESET_LABELS.twogun}) or "ours" (${PRESET_LABELS.ours}).`);
  }
  // The page draws what the board reads, so a classic change starts from that view, never from a "blank" the file still holds (Adam 2026-11-02).
  const current = showdown ? stored : { ...stored, kinds: classicProjectionGaps(stored.kinds) };
  const { kind } = body;
  if (!["gaps", "method", "use", "weight"].some((k) => k in body)) return fail("Say what to change: a preset, a source's use or weight, the gaps or the method.");
  if (!KINDS.includes(kind)) return fail(`"${kind}" is not a section on this page.`);
  if (SHOWDOWN_ONLY.has(kind) && !showdown) return fail(`${KIND_NAMES[kind]} is changed from a Showdown game's Sources page, not from the main slate's.`);
  if ("gaps" in body) {
    if (!SOURCE_KINDS.includes(kind)) return fail(`${KIND_NAMES[kind]} has no missing-player choice.`);
    if (!GAPS.includes(body.gaps)) return fail('gaps must be "backup" or "blank".');
    // Adam 2026-11-02: the classic board reads this as "backup" anyway (classicProjectionGaps), so a click must not say it was saved.
    if (!showdown && kind === "projection" && body.gaps === "blank" && decide(current.kinds, "projection", TWOGUN_ID)?.use === true) {
      return fail("With TwoGun ticked on the main slate, a player he does not project is always filled from Our sources.");
    }
    const next = structuredClone(current);
    next.kinds[kind].gaps = body.gaps;
    return { selection: next };
  }
  if ("method" in body) {
    if (kind !== "sdOwnFlex") return fail("Only Showdown FLEX ownership has a method.");
    if (!METHODS.includes(body.method)) return fail('method must be "d41" or "weighted".');
    const next = structuredClone(current);
    next.kinds.sdOwnFlex.method = body.method;
    return { selection: next };
  }
  return changeSource(current, body, showdownIds, listUnread);
}
