// The source-selection rules (Sources page plan, "Shapes"), pure so the public site can import them: no node: module,
// no file read. server/sources/selection.js adds the disk store (data/config/source-selection.json) and re-exports this.
//
// One scope's selection (the store holds one for classic and one per Showdown game; selection.js, STORE_VERSION):
// { version: 1, updatedAt, kinds:{ projection: {gaps, sources}, ownership: {gaps, sources},
//   sdOwnFlex: {method, gaps, sources}, sdOwnCpt: {gaps, sources}, lines: {primary}, injuries: {twogunCalls},
//   extras: {twogun} }, log: [{at, change}] }   where sources = { <id>: { use: boolean, weight: number } }.
// A source's weight is kept while it is unticked; a ticked weight must be above 0 ("untick to leave out"), and a new
// weight must be WEIGHT_MIN to WEIGHT_MAX (a stored file may hold less than WEIGHT_MIN and still reads). "*" in a
// Showdown section means any Showdown file source not named there (Stokastic's Captain figure included, D40 amended).

export const SELECTION_VERSION = 1;
export const LOG_LIMIT = 100;
export const ANY = "*";
export const TWOGUN_ID = "twogun";
export const STOKASTIC_ID = "stokastic"; // the one copy; server/showdown/ownership-core.js re-exports it
export const SOURCE_KINDS = Object.freeze(["projection", "ownership", "sdOwnFlex", "sdOwnCpt"]);
export const KINDS = Object.freeze([...SOURCE_KINDS, "lines", "injuries", "extras"]);
export const GAPS = Object.freeze(["backup", "blank"]);
export const METHODS = Object.freeze(["d41", "weighted"]);
export const LINE_PRIMARIES = Object.freeze(["espn-scoreboard", TWOGUN_ID]);
const SHOWDOWN_KINDS = new Set(["sdOwnFlex", "sdOwnCpt"]);

/** The ids each classic section accepts (the registry's module ids, server/sources/index.js, plus TwoGun). The
 *  Showdown sections take the ids of the week's ownership-sources.json files, which change per game, so they have no
 *  fixed list: a caller that knows them passes them to validateSelection. */
export const KNOWN_IDS = Object.freeze({
  projection: Object.freeze(["sleeper", "fantasypros", "cbs", "espn", TWOGUN_ID]),
  ownership: Object.freeze(["footballguys", "rotowire", "findings", STOKASTIC_ID, "oneweekseason", TWOGUN_ID]),
  sdOwnFlex: null,
  sdOwnCpt: null
});

const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v); return Object.freeze(o); };

/** The pre-selection defaults of server/sources/index.js (each module's defaultEnabled and defaultWeight; D35, D37),
 *  used by migrateLegacy when sources.json is silent about a source. tests/source-selection.test.mjs checks them
 *  against the registry. */
export const LEGACY_DEFAULTS = deepFreeze({
  sleeper: { enabled: true, weight: 1 }, fantasypros: { enabled: true, weight: 1 }, cbs: { enabled: true, weight: 1 },
  espn: { enabled: true, weight: 1 }, findings: { enabled: true, weight: 1 }, stokastic: { enabled: true, weight: 0 },
  oneweekseason: { enabled: false, weight: 0 }, footballguys: { enabled: true, weight: 1 }, rotowire: { enabled: true, weight: 1 }
});

/** What the page and its refusals call each section. The one copy. */
export const KIND_LABELS = Object.freeze({ projection: "Projections", ownership: "Ownership", sdOwnFlex: "Showdown FLEX ownership",
  sdOwnCpt: "Showdown Captain ownership", lines: "Lines", injuries: "Injuries", extras: "TwoGun extras" });
/** What one scope's saved choices apply to (the board's mode.appliesTo and the page's head; Adam 2026-10-20, every game keeps its
 *  own choices): the classic scope covers the main slate and its second slates (D57), a Showdown scope its one game. The one copy. */
export const APPLIES_TO_CLASSIC = "classic slates";
export const APPLIES_TO_SHOWDOWN = "this Showdown game";
/** The store's own version (data/config/source-selection.json): { version: STORE_VERSION, classic: <selection> | null,
 *  showdown: { <showdownKey>: <selection> } }; each selection keeps SELECTION_VERSION. */
export const STORE_VERSION = 2;
/** The classic scope's name; every other scope is a Showdown key. */
export const CLASSIC_SCOPE = "classic";
/** The sections each kind of Sources page shows and edits (selection-view.js): what "apply to every game" carries. The
 *  projection section is the one both kinds share. */
export const SHOWN_KINDS = Object.freeze({
  classic: Object.freeze(["projection", "ownership", "lines", "injuries", "extras"]),
  showdown: Object.freeze(["projection", "sdOwnFlex", "sdOwnCpt"])
});
/** The refusal of a slate that is neither the main slate nor a Showdown key (/api/source-selection and /api/mode). The one copy. */
export const BAD_SLATE_MESSAGE = 'slate must be "main" or a Showdown key such as 2026-w06-SEADEN.';
export const scopeKindOf =(scope) => (scope === undefined || scope === null || scope === CLASSIC_SCOPE ? "classic" : "showdown");
/** WEIGHT_MIN (the smallest weight a change may set) and WEIGHT_MAX (the largest a source can carry): the server's copy.
 *  The browser's copy is public/js/weight-limits.js; tests/source-selection-fixes.test.mjs compares the two. */
export const WEIGHT_MIN = 0.25;
export const WEIGHT_MAX = 10;
const SOURCE_LABELS = Object.freeze({ sleeper: "Sleeper", fantasypros: "FantasyPros", cbs: "CBS", espn: "ESPN", twogun: "TwoGun",
  footballguys: "Footballguys", rotowire: "RotoWire", findings: "the Fantasy Footballers findings", stokastic: "Stokastic",
  oneweekseason: "One Week Season", "*": "any other Showdown file source", "espn-scoreboard": "the ESPN scoreboard" });
const sourceLabel = (id) => SOURCE_LABELS[id] ?? id;
export const PRESET_LABELS = Object.freeze({ twogun: "TwoGun only", ours: "Our sources" });

const on = (weight = 1) => ({ use: true, weight });
const off = (weight = 1) => ({ use: false, weight });

/** The two presets. "Our sources": the four projection sources at weight 1 (D37); Footballguys, RotoWire and the
 *  findings at 1, Stokastic off, One Week Season off (not fetched, D35); every Showdown file source on with the D41
 *  method, Stokastic included for Captain too (D40 amended 2026-10-18); ESPN lines; TwoGun calls and extras off. "TwoGun only": TwoGun ticked
 *  alone in every section it feeds, TwoGun lines, calls and extras on, and gaps "blank" in all four sections (Adam,
 *  2026-10-18); "Our sources" gaps "backup". Whether "blank" also drops the DraftKings-average stand-in is open for Adam. */
export const PRESETS = deepFreeze({
  ours: { projection: { gaps: "backup", sources: { sleeper: on(), fantasypros: on(), cbs: on(), espn: on(), twogun: off() } },
    ownership: { gaps: "backup", sources: { footballguys: on(), rotowire: on(), findings: on(), stokastic: off(), oneweekseason: off(), twogun: off() } },
    sdOwnFlex: { method: "d41", gaps: "backup", sources: { [ANY]: on(), twogun: off() } },
    sdOwnCpt: { gaps: "backup", sources: { [ANY]: on(), twogun: off() } },
    lines: { primary: "espn-scoreboard" }, injuries: { twogunCalls: false }, extras: { twogun: false } },
  twogun: { projection: { gaps: "blank", sources: { sleeper: off(), fantasypros: off(), cbs: off(), espn: off(), twogun: on() } },
    ownership: { gaps: "blank", sources: { footballguys: off(), rotowire: off(), findings: off(), stokastic: off(), oneweekseason: off(), twogun: on() } },
    sdOwnFlex: { method: "d41", gaps: "blank", sources: { [ANY]: off(), twogun: on() } },
    sdOwnCpt: { gaps: "blank", sources: { [ANY]: off(), twogun: on() } },
    lines: { primary: TWOGUN_ID }, injuries: { twogunCalls: true }, extras: { twogun: true } }
});

/** A fresh selection holding the "Our sources" preset (what a machine with no selection file uses). */
export function defaultSelection() {
  return { version: SELECTION_VERSION, updatedAt: null, kinds: structuredClone(PRESETS.ours), log: [] };
}

/** The "TwoGun only" preset, his FLEX and Captain ownership included: what a Showdown game with no saved choices reads while both his
 *  files for it are posted (showdown-default.js). Read only; nothing is written until a save. */
export function defaultShowdownSelection() {
  return applyPreset("twogun", defaultSelection());
}

/** `target` (a selection) with the sections `fromKind`'s page shows (SHOWN_KINDS) copied from `from` where `toKind` has them too:
 *  the projection section always (every scope has it), the ownership and switch sections only between scopes of the same kind.
 *  The target keeps every other section, its updatedAt and its log. Pure; the caller validates and writes. */
export function withShownSections(target, from, fromKind, toKind) {
  const next = structuredClone(target);
  for (const k of SHOWN_KINDS[fromKind]) if (SHOWN_KINDS[toKind].includes(k)) next.kinds[k] = structuredClone(from.kinds[k]);
  return next;
}

export const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The refusal sentence for a weight, or null: a number from 0 to WEIGHT_MAX with at most two decimals. A weight of 0 is
 *  refused ("Untick a source to leave it out.") unless `allowZero` (an unticked source keeps whatever weight it had). A weight
 *  above 0 but under WEIGHT_MIN is refused unless `stored`: the change path (selection-change.js) holds a new weight to the
 *  page's own limit, while validateSelection (every write and every read of the file) passes `stored`, so a file already
 *  holding 0.1 stays readable and does not lock every save. The one copy of the rule. */
export function weightProblem(w, { allowZero = false, stored = false } = {}) {
  if (typeof w !== "number" || !Number.isFinite(w)) return "A weight must be a number.";
  if (w === 0) return allowZero ? null : "Untick a source to leave it out.";
  // A change is worded as the page words its limit; a read of the file only knows "above 0".
  const changeRange = `A weight must be from ${WEIGHT_MIN} to ${WEIGHT_MAX}; untick a source to leave it out.`;
  if (w < 0 || w > WEIGHT_MAX) return stored ? `A weight must be above 0 and at most ${WEIGHT_MAX}.` : changeRange;
  if (!stored && w < WEIGHT_MIN) return changeRange;
  if (Math.abs(w * 100 - Math.round(w * 100)) > 1e-9) return "A weight can have at most two decimals.";
  return null;
}

/** Every problem with `obj` as a selection, in plain English; [] when it is valid. `knownIds` ({kind: iterable of
 *  ids}) overrides KNOWN_IDS per section; a section with no list (the Showdown ones by default) takes any id. */
export function validateSelection(obj, knownIds = {}) {
  const problems = [];
  if (!isObj(obj)) return ["The source choices are not a settings object."];
  if (obj.version !== SELECTION_VERSION) problems.push(`The source choices have version ${JSON.stringify(obj.version)}; this app reads version ${SELECTION_VERSION}.`);
  if (obj.updatedAt !== undefined && obj.updatedAt !== null && typeof obj.updatedAt !== "string") problems.push("The last-changed time is not a date.");
  if (obj.log !== undefined && (!Array.isArray(obj.log) || obj.log.some((e) => !isObj(e) || typeof e.at !== "string" || typeof e.change !== "string"))) {
    problems.push("The change log is not a list of dated changes.");
  }
  if (!isObj(obj.kinds)) return [...problems, "The source choices have no sections."];
  for (const k of Object.keys(obj.kinds)) if (!KINDS.includes(k)) problems.push(`"${k}" is not a section this app knows.`);
  for (const k of KINDS) {
    const sec = obj.kinds[k];
    const label = KIND_LABELS[k];
    if (!isObj(sec)) { problems.push(`The ${label} section is missing.`); continue; }
    if (k === "lines" && !LINE_PRIMARIES.includes(sec.primary)) problems.push(`${label}: the main source must be the ESPN scoreboard or TwoGun, not ${JSON.stringify(sec.primary)}.`);
    if (k === "injuries" && typeof sec.twogunCalls !== "boolean") problems.push(`${label}: the TwoGun calls tick must be on or off.`);
    if (k === "extras" && typeof sec.twogun !== "boolean") problems.push(`${label}: the TwoGun extras tick must be on or off.`);
    if (!SOURCE_KINDS.includes(k)) continue;
    if (!GAPS.includes(sec.gaps)) problems.push(`${label}: missing players must be filled from the backup sources or left blank, not ${JSON.stringify(sec.gaps)}.`);
    if (k === "sdOwnFlex" && !METHODS.includes(sec.method)) problems.push(`${label}: the method must be the Stokastic rule or a weighted average, not ${JSON.stringify(sec.method)}.`);
    if (!isObj(sec.sources)) { problems.push(`${label}: the source list is missing.`); continue; }
    const list = has(knownIds ?? {}, k) ? knownIds[k] : KNOWN_IDS[k];
    const known = list ? new Set(list) : null;
    for (const [id, e] of Object.entries(sec.sources)) {
      if (id === ANY && !SHOWDOWN_KINDS.has(k)) { problems.push(`${label}: "*" (any other source) is only for the Showdown sections.`); continue; }
      if (id !== ANY && (!id.trim() || (known && !known.has(id)))) { problems.push(`${label}: "${id}" is not a source this app knows.`); continue; }
      const name = sourceLabel(id);
      if (!isObj(e) || typeof e.use !== "boolean") { problems.push(`${label}: ${name} needs a tick that is on or off.`); continue; }
      if (typeof e.weight !== "number" || !Number.isFinite(e.weight)) problems.push(`${label}: ${name} has a weight that is not a number.`);
      else if (e.weight < 0) problems.push(`${label}: ${name} has a weight below 0.`);
      else if (e.use && e.weight <= 0) problems.push(`${label}: ${name} is ticked with weight 0; untick it to leave it out.`);
      else {
        // Above WEIGHT_MAX or more than two decimals: refused on every write path, and a hand-edited file reads as unreadable.
        const bad = weightProblem(e.weight, { allowZero: true, stored: true });
        if (bad) problems.push(`${label}: ${name}: ${bad}`);
      }
    }
    // A classic section with nothing ticked and no backups would leave every player blank.
    if ((k === "projection" || k === "ownership") && sec.gaps === "blank" && !Object.values(sec.sources).some((e) => isObj(e) && e.use === true)) {
      // The Sources page's own words: its "Players these sources miss" toggle reads "fill from Our sources" | "leave blank".
      problems.push(`${label}: Tick at least one source, or set "Players these sources miss" to "fill from Our sources".`);
    }
  }
  return problems;
}

/** The entry deciding `id` in section `kind` of `kinds`: its own, else "*" (a Showdown file source, so never TwoGun),
 *  else none (unticked). The one copy; server/rank/select.js uses it. */
export function decide(kinds, kind, id) {
  const sources = kinds?.[kind]?.sources ?? {};
  if (has(sources, id)) return sources[id];
  if (id !== ANY && id !== TWOGUN_ID && has(sources, ANY)) return sources[ANY];
  return null;
}

function sameChoices(a, b) {
  for (const k of SOURCE_KINDS) {
    const ids = new Set([...Object.keys(a[k]?.sources ?? {}), ...Object.keys(b[k]?.sources ?? {})]);
    for (const id of ids) {
      const x = decide(a, k, id);
      const y = decide(b, k, id);
      const ux = Boolean(x?.use);
      if (ux !== Boolean(y?.use)) return false;
      if (ux && x.weight !== y.weight) return false;
    }
  }
  return a.sdOwnFlex?.method === b.sdOwnFlex?.method && a.lines?.primary === b.lines?.primary &&
    a.injuries?.twogunCalls === b.injuries?.twogunCalls && a.extras?.twogun === b.extras?.twogun;
}

/** "twogun" | "ours" | null: the preset `sel` matches on its ticks, ticked weights, FLEX method, line source, TwoGun
 *  calls and extras, and on the gaps each preset writes in all four sections: "blank" for "twogun" (TwoGun ticked with
 *  backup gaps is a custom choice) and "backup" for "ours" (Our sources' ticks with one section on "leave blank" is a
 *  custom choice, so the Our sources button is not lit while a click on it would still change something). Unticked
 *  weights, updatedAt and the log are not compared. */
export function presetOf(sel) {
  if (!isObj(sel?.kinds)) return null;
  const gapsOf = (name) => SOURCE_KINDS.every((k) => sel.kinds[k]?.gaps === PRESETS[name][k].gaps);
  for (const name of ["twogun", "ours"]) if (sameChoices(PRESETS[name], sel.kinds) && gapsOf(name)) return name;
  return null;
}

/** `sel` with preset `name` applied (a new object): the preset's ticks, ticked weights, method and switches, with
 *  every stored weight of a source the preset leaves unticked kept. Each preset writes the gaps it means, whatever was stored:
 *  "twogun" "blank" and "ours" "backup" (a stored "blank" left by TwoGun only used to survive "Our sources", so the page showed
 *  "leave blank" under the preset that fills). A source `sel` names
 *  that the preset does not follows the preset's "*" entry if it has one (else it is unticked).
 *  updatedAt and the log are carried over. */
export function applyPreset(name, sel) {
  const preset = PRESETS[name];
  if (!preset) throw Object.assign(new Error(`unknown preset ${JSON.stringify(name)}`), { code: "SELECTION_INVALID" });
  const kinds = structuredClone(preset);
  for (const k of SOURCE_KINDS) {
    const stored = isObj(sel?.kinds?.[k]?.sources) ? sel.kinds[k].sources : {};
    const ids = new Set([...Object.keys(kinds[k].sources), ...Object.keys(stored)]);
    for (const id of ids) {
      const chosen = decide(preset, k, id);
      const keep = stored[id];
      const keptWeight = isObj(keep) && Number.isFinite(keep.weight) && keep.weight >= 0 ? keep.weight : null;
      if (chosen?.use) kinds[k].sources[id] = { use: true, weight: chosen.weight };
      else kinds[k].sources[id] = { use: false, weight: keptWeight ?? chosen?.weight ?? 1 };
    }
  }
  return { version: SELECTION_VERSION, updatedAt: sel?.updatedAt ?? null, kinds, log: Array.isArray(sel?.log) ? [...sel.log] : [] };
}

/** The log line when a save on a Showdown game still reading its default changes nothing: written anyway, so the game keeps that
 *  choice as its own instead of following a default that flips when TwoGun's files land (`defaulted`: { preset }). */
export const keptDefaultLine = (defaulted) => `Kept the ${PRESET_LABELS[defaulted?.preset] ?? PRESET_LABELS.ours} default as this game's own choice.`;

/** The log line for a selection made by migrateLegacy. */
export const MIGRATION_CHANGE = "Made from the earlier source weights (sources.json) and the TwoGun or current mode switch (mode.json).";

/** A selection reproducing the pre-selection choices: sources.json's enabled and weight for each projection and
 *  ownership source (used = enabled with a weight above 0; the weight is kept either way), and mode.json's mode
 *  ("twogun" -> the TwoGun preset over those weights, anything else -> those choices as "Our sources"). */
export function migrateLegacy(sourcesJson, modeJson) {
  const cfg = isObj(sourcesJson) ? sourcesJson : {};
  const sel = defaultSelection();
  for (const k of ["projection", "ownership"]) {
    for (const id of Object.keys(sel.kinds[k].sources)) {
      const def = LEGACY_DEFAULTS[id];
      if (!def) continue; // TwoGun: not in sources.json; the preset decides it
      const c = isObj(cfg[id]) ? cfg[id] : {};
      const enabled = c.enabled === undefined ? def.enabled : Boolean(c.enabled);
      const n = Number(c.weight);
      const weight = c.weight !== undefined && Number.isFinite(n) && n >= 0 ? n : def.weight;
      sel.kinds[k].sources[id] = { use: enabled && weight > 0, weight };
    }
  }
  return modeJson?.mode === "twogun" ? applyPreset("twogun", sel) : sel;
}

/** The sources that fill a player the ticked sources miss when the section's gaps are "backup": each id the "Our
 *  sources" preset ticks for `kind` (may be "*"), as [{ id, weight }] in preset order, weighted by the selection's
 *  stored weight for that id (its "*" entry for "*"), or the preset's weight when the selection does not name it; an
 *  id stored at weight 0 is left out. [] when `sel` leaves gaps blank or the kind has no sources. */
export function backupIds(sel, kind) {
  if (!SOURCE_KINDS.includes(kind)) return [];
  const sec = sel?.kinds?.[kind];
  if (sec?.gaps === "blank") return [];
  const stored = isObj(sec?.sources) ? sec.sources : {};
  const out = [];
  for (const [id, e] of Object.entries(PRESETS.ours[kind].sources)) {
    if (!e.use) continue;
    const s = has(stored, id) ? stored[id] : null;
    const weight = isObj(s) && Number.isFinite(s.weight) && s.weight >= 0 ? s.weight : e.weight;
    if (weight > 0) out.push({ id, weight });
  }
  return out;
}

/** True when the selection ticks TwoGun and no other projection source (Adam's Cash rule: his median counts only when
 *  he is the only projection source). `sel` is a selection or its kinds; pass the board's effective view so an id the
 *  app no longer knows reads as unticked. */
export function ticksOnlyTwoGunProjection(sel) {
  const sources = (sel?.kinds ?? sel)?.projection?.sources;
  if (!isObj(sources)) return false;
  const ticked = Object.entries(sources).filter(([, e]) => isObj(e) && e.use === true).map(([id]) => id);
  return ticked.length === 1 && ticked[0] === TWOGUN_ID;
}

/** One plain-English line for what changed from `before` to `after` ("" when no choice changed): the preset's name
 *  when several choices moved onto a preset at once, else each changed choice. */
export function describeChange(before, after) {
  const bits = [];
  const b = before?.kinds ?? {};
  const a = after?.kinds ?? {};
  for (const k of SOURCE_KINDS) {
    const label = KIND_LABELS[k];
    if (b[k]?.gaps !== a[k]?.gaps) bits.push(`${label}: missing players now ${a[k]?.gaps === "blank" ? "left blank" : "filled from the backup sources"}`);
    if (k === "sdOwnFlex" && b[k]?.method !== a[k]?.method) bits.push(`${label}: method now ${a[k]?.method === "d41" ? "the Stokastic rule" : "a weighted average"}`);
    const ids = new Set([...Object.keys(b[k]?.sources ?? {}), ...Object.keys(a[k]?.sources ?? {})]);
    for (const id of ids) {
      const x = decide(b, k, id);
      const y = decide(a, k, id);
      if (Boolean(x?.use) !== Boolean(y?.use)) bits.push(`${label}: ${sourceLabel(id)} ${y?.use ? "ticked" : "unticked"}`);
      if (y && x?.weight !== y.weight) bits.push(`${label}: ${sourceLabel(id)} weight ${x?.weight ?? "none"} to ${y.weight}`);
    }
  }
  if (b.lines?.primary !== a.lines?.primary) bits.push(`Lines now from ${sourceLabel(a.lines?.primary)}`);
  if (b.injuries?.twogunCalls !== a.injuries?.twogunCalls) bits.push(`TwoGun injury calls ${a.injuries?.twogunCalls ? "on" : "off"}`);
  if (b.extras?.twogun !== a.extras?.twogun) bits.push(`TwoGun extras ${a.extras?.twogun ? "on" : "off"}`);
  if (!bits.length) return "";
  const p = presetOf(after);
  const onto = p && p !== presetOf(before);
  if (onto && bits.length > 1) return `Chose the "${PRESET_LABELS[p]}" preset.`;
  if (onto) return `${bits[0]} (now the "${PRESET_LABELS[p]}" preset).`;
  const shown = bits.slice(0, 8).join("; ");
  return `${shown}${bits.length > 8 ? `; and ${bits.length - 8} more` : ""}.`;
}
