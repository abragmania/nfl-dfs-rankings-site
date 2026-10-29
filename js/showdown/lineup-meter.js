// Showdown Lineup Builder: the uniqueness / projection meter strip under the six slots (Adam 2026-10-18: "being
// unique is more important than any projection optimization"). When Captain plus five FLEX are all placed it asks
// POST /api/showdown/<key>/lineup/meter once and shows two verdicts (Adam 2026-10-29 5:08 PM: "is this a good lineup / is
// this a unique lineup, get down to the point of it"): Unique (from the expected copies) and Good (from the gap to the best
// possible), then the copies figure on a log colour scale. Every figure is this game's served board's (Adam 2026-10-20 10:03 AM:
// "change sources to anything for any game ... make it uniform across everything"); the sources and the calculation are on the
// panel's hover (meterHover), and the Sources page is the Showdown header's Sources button. Pure helpers are
// exported for tests; lineup.js only calls syncMeter (before a draw), meterStripHtml (inside the draw) and wireMeter (after it).
import { escapeHtml } from "../format.js";
import { isSampleMode } from "../api.js";
import { onSitePage } from "../tabs.js"; // the one is-site check
import { requestFailureText, notJsonText, NOT_JSON } from "./read-json.js"; // the one JSON reader's sentences (🔵 866b0ce B4)
import { postShowdownLineupMeter, getShowdownModes, supports } from "./api.js"; // the requests; on the public site its stand-in answers them in the browser (D71)
import { likelyCopies, POISSON_BASIS } from "./likely-copies.js";
import { twogunTicked } from "./figures-label.js";
import { sigFig2, copiesText, uniqueVerdict } from "./field-explain.js"; // the field model's words (D82) and the Unique verdict
import { projectionLineText, verdictHtml, uniqueSubHtml, goodHtml, scaleHtml, meterHover } from "./meter-face.js"; // the panel's face (split out at the 600-line ceiling)

export { likelyCopies }; // the most-likely count and its usual range (likely-copies.js)
// The face's public names, handed on so every importer of this file (optimizer-view.js, the tests) is unchanged.
export { markerPosition, scaleColour, scaleGradientCss, gapText, projectionLineText, sourceLineText, sourceTitle, toneColour, meterHover } from "./meter-face.js";

/** The retired Figures switch's remembered choice: cleared once at load, so no old pick lingers in the browser (the board's ticks decide now). */
export const RETIRED_MODE_KEY = "nfldfs-sd-meter-mode";
export function clearRetiredMode(getStorage) {
  try {
    getStorage()?.removeItem?.(RETIRED_MODE_KEY);
  } catch (e) {
    // Storage blocked or missing: there is nothing this page can clear, and nothing reads the key any more.
  }
}
if (typeof window !== "undefined") clearRetiredMode(() => window.localStorage);

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1); // a shared sentence placed after a colon
const DELAY_MS = 150; // double clicks and quick slot swaps collapse into one request
const NO_OWNERSHIP = "No ownership from this game's ticked sources yet";

export { sigFig2, copiesText }; // the headline's number words live in field-explain.js (the calculation sentence uses the same two)

// ---------- pure helpers ----------

/** "1 in 41,000" from the server's oneIn (1/P); null when there is no finite figure (chance 0 means never alone). */
export function oneInText(oneIn) {
  const s = typeof oneIn === "number" && oneIn > 0 ? sigFig2(oneIn) : null;
  return s === null ? null : `1 in ${s}`;
}

/** The hover on the most-likely fact line when the spread is Poisson: what it is computed from (likely-copies.js likelyBasisText has the wider spread's). */
export const LIKELY_BASIS = POISSON_BASIS;

/**
 * The words that stand in for the scale when uniqueness cannot be measured, or null when it can. A man with no ownership gives
 * uniqueness null plus ownership.unposted (as before); the field model (D82) also needs every man's projection and the curves,
 * and its blank answer { unposted, unprojected, reason } (no `w`, no copies) carries the server's sentence in `reason`.
 */
export function noUniquenessText(d) {
  const own = d?.ownership;
  if (own && own.posted === false && own.error) return String(own.error);
  if (!own || own.posted === false) return NO_OWNERSHIP;
  const names = Array.isArray(own.unposted) ? own.unposted.filter(Boolean) : [];
  if (names.length) return `No ownership from this game's ticked sources for ${names.join(", ")}, so uniqueness can't be measured for this lineup.`;
  const u = d.uniqueness;
  const measured = u && typeof u.aloneChance === "number" && Number.isFinite(u.aloneChance) && copiesText(u.copies) !== null;
  if (!measured && typeof u?.reason === "string" && u.reason.trim()) return u.reason.trim();
  if (!measured) return "Uniqueness is not available for this lineup.";
  return null;
}

function findRow(board, id) {
  return (board?.rows ?? []).find((r) => String(r.id) === String(id));
}

/**
 * The meter request body {cpt, flex:[5], excludes} from the placed ids (the panel's person ids): the Captain
 * goes as his Captain candidate id (row.cptId), each FLEX as row.id. Null until all six are placed and on the board.
 * `excludes`: the Optimizer's excludes for the mode on screen (optimizer.js optimizerExcludes; 🔵 866b0ce B1), so the
 * "best possible" this lineup is measured against is the one the batch cards are, and the two gaps agree; none by default.
 */
export function meterRequestBody(board, cpt, flex, excludes = []) {
  if (!cpt || !Array.isArray(flex) || flex.length !== 5 || !flex.every(Boolean)) return null;
  const cptRow = findRow(board, cpt.id);
  if (!cptRow || cptRow.cptId === null || cptRow.cptId === undefined) return null;
  const flexIds = [];
  for (const s of flex) {
    const row = findRow(board, s.id);
    if (!row) return null;
    flexIds.push(String(row.id));
  }
  return { cpt: String(cptRow.cptId), flex: flexIds, excludes: Array.isArray(excludes) ? excludes.map(String) : [] };
}

const finiteOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The figures a slot shows for one board row: { proj, own } (own in percent; Captain: cptProj and ownCpt, FLEX: proj and ownFlex),
 * this game's ticked sources' and Adam's typed numbers. `players` is the modes answer's board-path map (GET .../modes,
 * modes.current.players). Once it is in, the projection is its proj / cptProj: the server's own reading of the rows
 * (server/showdown/lineup-rows.js lineupRows, the rows the meter, swaps, Build, Generate and the saved snapshot count), so a typed
 * revive of a man listed Out under TwoGun only shows his 0 as they count him (Adam 2026-10-18); in every other case it equals the
 * row's, which stays the figure before the answer lands. Ownership is the row's. The map also adds what the row cannot say:
 * notOnBoard for a slot whose figure is TwoGun's 0% for a man his posted board has no row for (Q8), projNote (a man listed Out
 * counts as 0; what TwoGun projects) and missingReason (why a blank stays blank). Missing is missing: null, never zero (D29).
 * `rowProj` true keeps the row's projection while still taking the map's notes: the map was read for an older board (🔵 2026-10-22,
 * the ± bump: a bumped row's proj is newer than the answer's).
 */
export function figuresFor(row, isCpt, players = null, { rowProj = false } = {}) {
  if (!row) return { proj: null, own: null };
  const p = players?.[String(row.id)];
  const projKey = isCpt ? "cptProj" : "proj";
  const proj = !rowProj && p && Object.hasOwn(p, projKey) ? p[projKey] : row[projKey];
  const out = { proj: finiteOrNull(proj), own: finiteOrNull(isCpt ? row.ownCpt : row.ownFlex) };
  if ((isCpt ? p?.notOnBoardCpt : p?.notOnBoardFlex) === true) out.notOnBoard = true;
  if (typeof p?.projNote === "string" && p.projNote) out.projNote = p.projNote;
  if (out.own === null && typeof p?.missingReason === "string" && p.missingReason) out.missingReason = p.missingReason;
  return out;
}

/** A server reason as a span: cut at a word to `max` characters with the full text on hover when it is long. */
export function reasonHtml(reason, max = 44) {
  const text = String(reason);
  const cut = text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
  return `<span class="sd-reason"${cut === text ? "" : ` title="${escapeHtml(text)}"`}>${escapeHtml(cut)}</span>`;
}

/** The words for a man TwoGun's board has no row for (Q8), shared by the meter's note and the swaps; the slots' line 2 (lineup-slots.js notesHtml) says the same. */
export const NOT_ON_BOARD_WORDS = "not on TwoGun's board, 0%";

/** "A Smith, B Jones: not on TwoGun's board, 0%" for the lineup men counted at TwoGun's 0% (Q8, only while TwoGun is ticked); null when none. */
export function notOnBoardText(d) {
  const names = Array.isArray(d?.ownership?.notOnBoard) ? d.ownership.notOnBoard.filter(Boolean) : [];
  return names.length ? `${names.join(", ")}: ${NOT_ON_BOARD_WORDS}` : null;
}

/** What the ticked sources have not posted, from the modes answer's board-path entry (no lineup needed): the ownership line, then the projection line. */
function notPostedHtml(modesInfo) {
  const e = modesInfo?.modes?.current;
  const d = { ownership: e?.ownership, projection: e?.projection };
  const line = (half, text) => (half?.posted === false ? `<div class="${half.error ? "sd-meter-error" : "sd-meter-none"}">${escapeHtml(text())}</div>` : "");
  return line(d.ownership, () => noUniquenessText(d)) + line(d.projection, () => projectionLineText(d));
}

/**
 * The strip's html for one meter state ({status: "loading"|"error"|"ok", data, message}). `v` = { modesInfo (GET .../modes),
 * modesNote (the one line saying the modes answer could not be read), notes (the server's reasons: TwoGun's list looks
 * incomplete, why a placed man's ownership is blank, one plain line each), live (the meter runs: with nothing measured yet the
 * strip says what the ticked sources have not posted) }. A measured lineup reads (Adam 2026-10-29 5:08 PM: "more 'is this a
 * good lineup / is this a unique lineup', get down to the point of it"): the Unique verdict with its small line, the Good
 * verdict with its figures, then the copies figure on its scale (./meter-face.js); the sources (each half's own source line,
 * as-of and refusal), the calculation and the model's note are on the panel's hover only (meterHover).
 */
export function meterHtml(m, v = {}) {
  const { modesInfo = null, modesNote = null, notes = [], live = false } = v;
  const note = (modesNote ? `<div class="sd-meter-error">${escapeHtml(modesNote)}</div>` : "") + notes.map((t) => `<div class="sd-meter-none">${reasonHtml(t, 120)}</div>`).join("");
  if (!m || !m.status) {
    const idle = live ? note + notPostedHtml(modesInfo) : note; // nothing to say draws no empty box
    return idle ? `<div class="sd-meter" aria-live="polite">${idle}</div>` : "";
  }
  if (m.status === "loading") return `<div class="sd-meter" aria-live="polite">${note}<div class="sd-meter-none">Measuring uniqueness…</div></div>`;
  if (m.status === "error") return `<div class="sd-meter" aria-live="polite">${note}<div class="sd-meter-error">${escapeHtml(m.message || "Could not measure this lineup.")}</div></div>`;
  const d = m.data;
  const offBoard = notOnBoardText(d);
  const none = noUniquenessText(d);
  const u = d?.uniqueness;
  const uniq = none
    ? `<div class="${d?.ownership?.error ? "sd-meter-error" : "sd-meter-none"}">${escapeHtml(none)}</div>`
    : `${verdictHtml(uniqueVerdict(u.copies), "unique")}${uniqueSubHtml(u)}`;
  const hover = meterHover(d);
  return `
    <div class="sd-meter" aria-live="polite"${hover ? ` title="${escapeHtml(hover)}"` : ""}>
      ${uniq}
      ${goodHtml(d)}
      ${none ? "" : scaleHtml(u)}
      ${offBoard ? `<div class="sd-meter-none">${escapeHtml(offBoard)}</div>` : ""}
      ${note}
    </div>`;
}

// ---------- the requests: ./api.js's, which the public site's stand-in answers in the browser (RULES.md D71) ----------

/** POST /api/showdown/<key>/lineup/meter; resolves to the parsed answer, never throws for a server-side refusal. */
export async function postLineupMeter(key, body, fetchImpl = fetch) {
  return postShowdownLineupMeter(key, body, fetchImpl);
}

/** GET /api/showdown/<key>/modes: what the ticked sources have posted, and each man's notes. */
export async function getLineupModes(key, fetchImpl = fetch) {
  return getShowdownModes(key, fetchImpl);
}

// ---------- state and trigger ----------

const m = { sig: null, status: null, data: null, message: null, timer: null, modesDue: false }; // modesDue: the pending timer reads the modes too
let modesInfo = null; // last good GET .../modes answer for modesKey: the "not posted yet" lines and each man's notes
let modesKey = null; // the showdown modesInfo is for
let modesAsked = null; // what the last modes read was for (showdown and board.figures.key); null asks again
let modesReadFor = null; // what modesInfo was read for (as modesAsked); its projections count only while it is the board's on screen
let modesError = null; // why the last read for modesKey failed, in plain words; null once a read succeeds
let modesSeq = 0; // numbers each modes read: only the latest read's answer or failure is taken

function reset() {
  if (m.timer) clearTimeout(m.timer);
  m.timer = null;
  m.sig = null;
  m.status = null;
  m.data = null;
  m.message = null;
}

function liveMeterAllowed() {
  if (typeof window === "undefined") return false;
  // The published site measures in the browser when its stand-in for ./api.js runs the meter (RULES.md D71); sample mode
  // writes nothing and has no meter route.
  if (onSitePage()) return supports("meter");
  return !isSampleMode();
}

const isLive = () => Boolean(last?.enabled && last?.key);

/** Test hook: the current meter state. */
export function meterState() {
  return { sig: m.sig, status: m.status, data: m.data, message: m.message, modesInfo, modesError };
}

/** What a slot shows for this board row (see figuresFor); with the meter off (sample mode, or a site that does not run it) there is no modes answer, so no notes.
 *  An answer read for another figures key than the board's on screen (a ± bump, a typed number or a Sources save since, its re-read not
 *  yet in or failed) gives its notes but not its projections: the row's are newer (🔵 2026-10-22). */
export function playerFigures(row, isCpt) {
  if (!isLive()) return figuresFor(row, isCpt, null);
  return figuresFor(row, isCpt, modesInfo?.modes?.current?.players, { rowProj: modesReadFor !== modesAskedOf(last.key, last.board) });
}

/** What a modes read is for: the showdown and its board's figures key (board-view.js figuresKeyOf). */
const modesAskedOf = (key, board) => `${key}|${board?.figures?.key ?? ""}`;

/** The one line shown when the last modes read failed (instead of silently missing notes, or silently keeping an earlier answer); null otherwise. */
function modesNoteText() {
  if (!isLive() || !modesError) return null;
  const why = modesError.replace(/[.\s]+$/, "");
  // A failed re-read keeps the earlier answer's notes on the slots, so the line says that (never silently stale).
  return modesInfo ? `This game's player notes could not be re-read: ${why}; the slots show the earlier read` : `This game's player notes (why a figure is blank, who is not on TwoGun's board) could not be read: ${why}`;
}

/** The server's reasons: TwoGun's list looks incomplete (while he is a ticked ownership source), and why each placed man's blank ownership stays blank. */
function reasonNotes() {
  if (!isLive()) return [];
  const notes = [];
  const board = last.board;
  const incomplete = modesInfo?.modes?.current?.ownership?.incompleteReason ?? (twogunTicked(board, "ownership") ? modesInfo?.modes?.twogun?.ownership?.incompleteReason : null);
  if (typeof incomplete === "string" && incomplete) notes.push(incomplete);
  for (const [s, isCpt] of [[last.cpt, true], ...(last.flex ?? []).map((f) => [f, false])]) {
    const row = s ? findRow(board, s.id) : null;
    const why = row ? playerFigures(row, isCpt).missingReason : null;
    if (why) notes.push(`${row.name}: ${why}`);
  }
  return notes;
}

/** The current strip html (call inside the panel draw, after syncMeter). */
export function meterStripHtml() {
  return meterHtml(m, { modesInfo, modesNote: modesNoteText(), notes: reasonNotes(), live: isLive() });
}

let last = null; // the last syncMeter arguments, so an answer landing repaints without a panel draw

/**
 * Repaints the meter's own strip inside the panel and the slots' figure lines (lineup.js's onModes: the notes from the modes
 * answer), nothing else: the panel is never redrawn from here, so a lineup name being typed and its cursor survive an answer
 * landing. No strip on show: one that now has something to say is put where the panel draws it, right after the six slots.
 * Then every function registered with onMeterAnswer runs: the swaps panel reads the meter's model (the bands behind its estimate
 * labels) when it draws, and the swaps answer can land first, so it redraws itself when the meter's lands.
 */
function repaint() {
  last?.onModes?.();
  repaintStrip();
  for (const fn of answerListeners) fn();
}

const answerListeners = [];

/** Registers `fn` to run at the end of every meter repaint (an answer, a failure or a modes read landing); lineup-swaps.js uses it. */
export function onMeterAnswer(fn) {
  if (typeof fn === "function" && !answerListeners.includes(fn)) answerListeners.push(fn);
}

/** The strip alone (repaint's second half): an exclude toggle re-asks without touching the slots or the lists. */
function repaintStrip() {
  const host = last?.container;
  const el = host?.querySelector?.(".sd-meter");
  if (!el) {
    const html = meterStripHtml();
    const slots = html ? host?.querySelector?.(".lineup-slots") : null;
    if (!slots?.insertAdjacentHTML) return;
    slots.insertAdjacentHTML("afterend", html);
    const added = host.querySelector(".sd-meter");
    if (added) wireMeter(added);
    return;
  }
  el.outerHTML = meterStripHtml();
  const fresh = host.querySelector(".sd-meter");
  if (fresh) wireMeter(fresh);
}

/** Wires the figures label's Sources link inside `container`: it opens the Sources page, as the Showdown header's Sources button does. */
export function wireMeter(container) {
  container.querySelectorAll(".sd-figures-link").forEach((btn) => {
    btn.addEventListener("click", () => last?.onSources?.());
  });
}

/**
 * The Optimizer's excludes changed (a pool row's exclude, 🔵 866b0ce B1): the meter asks again with them, as the last draw's
 * lineup, and only its strip is repainted (the panel is not redrawn, so focus and scroll stay). Nothing before a first draw.
 */
export function resyncMeterExcludes(excludes) {
  if (!last) return;
  syncMeter({ ...last, excludes, readModes: false }); // only the excludes changed: the modes answer is the same, so it is not read again
  repaintStrip();
}

/**
 * What a measurement of this lineup depends on: the showdown, the board build, the request body and the six placed men's
 * projection and ownership as the board row shows them (a typed number can change those without a new build time). The
 * meter and the swaps panel both ask with this one signature over the same body (the Optimizer's excludes included), so
 * they re-ask together.
 */
export function lineupSig(key, board, body, cpt, flex) {
  const six = [findRow(board, cpt.id), ...flex.map((s) => findRow(board, s.id))];
  const figures = six.map((r, i) => [i === 0 ? r?.cptProj : r?.proj, r?.ownCpt ?? null, r?.ownFlex ?? null]);
  return JSON.stringify([key, board?.generatedAt ?? null, body, figures]);
}

/**
 * Reads GET .../modes for `key` (the "not posted yet" lines and each man's notes), as of `asked` (the showdown and its board's
 * figures key). A failed read leaves the last answer in place; with no answer yet for this showdown the strip says why.
 */
function readModes(key, asked, getModes) {
  modesAsked = asked;
  const seq = ++modesSeq;
  const current = () => seq === modesSeq && last?.key === key; // an older read never overwrites a newer one
  const fail = (reason) => {
    if (!current()) return;
    modesError = reason;
    repaint();
  };
  Promise.resolve()
    .then(() => getModes(key))
    .then((info) => {
      if (!current()) return;
      if (!info || typeof info !== "object") return fail("the server's answer could not be read.");
      if (info.error) return fail(info.error.message || "the server refused the request.");
      const players = info.modes?.current?.players;
      if (!players || typeof players !== "object") return fail("the answer had no per-player figures.");
      modesInfo = info;
      modesReadFor = asked;
      modesError = null;
      repaint();
    })
    .catch((e) => fail(e?.code === NOT_JSON ? lowerFirst(notJsonText(e.status)) : `the server could not be reached (${e?.message ?? e}).`)); // it follows a colon, as the other reasons do
}

/**
 * Called before every panel draw with the panel element (`container`). Incomplete lineup: the strip goes away.
 * Complete lineup whose ids, projections, ownership or board differ from the one last asked about: strip shows
 * "measuring", one request goes out after a short pause, and an answer for a lineup that has since changed is
 * dropped. When an answer lands only the strip is repainted. `excludes`: the Optimizer's for the mode on screen, sent in the
 * body (so they are part of the signature: a changed exclude asks again); none by default (🔵 866b0ce B1). `readModes`
 * false (an exclude toggle) skips the modes re-read the new measurement would send, unless one still waiting is replaced.
 * `onSources`: what the label's Sources link does (view.js opens the Sources page); `onModes`: lineup.js's repaint of the
 * slots' figure lines when the modes answer lands.
 */
export function syncMeter({ board, key, cpt, flex, container = null, post = postLineupMeter, getModes = getLineupModes, delayMs = DELAY_MS, enabled = liveMeterAllowed(), excludes = [], readModes: wantRead = true, onSources = null, onModes = null }) {
  last = { board, key, cpt, flex, container, post, getModes, delayMs, enabled, excludes, onSources, onModes };
  const live = Boolean(enabled && key);
  if (live && key !== modesKey) {
    modesKey = key; // another showdown: the last one's notes and failure are not this one's
    modesInfo = null;
    modesReadFor = null;
    modesAsked = null;
    modesError = null;
  }
  // Read as soon as a showdown is on show, again whenever its figures key moves (a Sources save, a typed number, TwoGun's files:
  // board-view.js figuresKeyOf), and for a new complete lineup.
  const asked = modesAskedOf(key, board);
  const wantModes = live && modesAsked !== asked;
  const body = live ? meterRequestBody(board, cpt, flex, excludes) : null;
  if (!body) {
    if (m.sig !== null) reset();
    if (wantModes) readModes(key, asked, getModes);
    return;
  }
  const sig = lineupSig(key, board, body, cpt, flex);
  if (sig === m.sig) {
    if (wantModes && !m.timer) readModes(key, asked, getModes); // a pending timer reads them anyway
    return;
  }
  const modesDue = wantRead || wantModes || Boolean(m.timer && m.modesDue); // a read that is due, or a replaced wait's, still happens
  reset();
  m.sig = sig;
  m.modesDue = modesDue;
  m.status = "loading";
  m.timer = setTimeout(async () => {
    m.timer = null;
    // A new complete lineup reads the modes afresh too (a TwoGun file saved meanwhile), behind the same pause as the
    // POST, so quick swaps send one GET.
    if (modesDue) readModes(key, asked, getModes);
    let next;
    try {
      const data = await post(key, body);
      if (!data || typeof data !== "object") next = { status: "error", message: "The server's answer could not be read." };
      else if (data.error) next = { status: "error", message: data.error.message || "Could not measure this lineup." };
      else if (!data.ownership || typeof data.ownership !== "object") next = { status: "error", message: "The server's answer was missing its ownership section." };
      else next = { status: "ok", data };
    } catch (e) {
      next = { status: "error", message: requestFailureText(e) };
    }
    if (m.sig !== sig) return; // the lineup changed while this was out
    m.status = next.status;
    m.data = next.data ?? null;
    m.message = next.message ?? null;
    repaint();
  }, delayMs);
}
