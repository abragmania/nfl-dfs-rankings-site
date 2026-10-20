// Showdown Lineup Builder: the uniqueness / projection meter strip under the six slots (Adam 2026-10-18: "being
// unique is more important than any projection optimization"). When Captain plus five FLEX are all placed it asks
// POST /api/showdown/<key>/lineup/meter once and shows, uniqueness first, the lineup's expected copies in the field on
// a log colour scale (with how many other entries most likely hold it beside), then the projection against the best possible one. A two-way switch, "TwoGun | Our sources", picks where the
// projections and ownership come from (default TwoGun, remembered in localStorage). Pure helpers are exported for
// tests; lineup.js only calls syncMeter (before a draw), meterStripHtml (inside the draw) and wireMeter (after it).
import { escapeHtml, dec1 } from "../format.js";
import { isSampleMode } from "../api.js";
import { readJson, requestFailureText, notJsonText, NOT_JSON } from "./read-json.js"; // the one JSON reader (🔵 866b0ce B4)
import { likelyCopies, likelyFactText } from "./likely-copies.js";

export { likelyCopies }; // the most-likely count and its usual range (likely-copies.js: a separate file, this one is past 600 lines)

const MINUS = "−";
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1); // a shared sentence placed after a colon
const DELAY_MS = 150; // double clicks and quick slot swaps collapse into one request
const MODE_KEY = "nfldfs-sd-meter-mode";
const MODES = [
  { value: "twogun", label: "TwoGun" },
  { value: "current", label: "Our sources" },
];
const SCALE_STOPS = [
  [0, [200, 50, 59]], // chalky: the app's chalk red
  [0.5, [224, 165, 38]], // amber
  [1, [47, 143, 91]], // unique: the app's value green
];
// The scale is the lineup's expected copies on a log axis, so 22 and 59 copies sit visibly apart. The ends are
// where the track stops telling lineups apart: at or below COPIES_UNIQUE_END the marker is at the unique end, at or
// above COPIES_CHALKY_END at the chalky end. Re-anchored (Adam 2026-10-20, "How is 0.72 / 100k lineups not more unique
// (visually)?"): the ends were 0.03 and 300, so the whole right third held 0.72 down to 0.03, differences that mean nothing in
// play. Half a copy or fewer is as unique as the bar needs to show, and 100 copies is fully chalky; the log axis is unchanged,
// two and a third decades. Positions toward Unique: 0.72 at 93%, 1 copy 87%, 3 copies 66%, 10 copies 43%, 25 copies 26% (Adam's
// "25 dupes is maybe the cutoff-ish" lands in the red-orange); 22 versus 59 copies still differ by 19% of the track.
const COPIES_UNIQUE_END = 0.5;
const COPIES_CHALKY_END = 100;
const COPIES_FLOOR = 0.01; // below this the headline figure reads "<0.01"

// ---------- pure helpers ----------

/** Two significant figures, thousands separated: 2.4 -> "2.4", 0.034 -> "0.034", 41234 -> "41,000". null/NaN -> null. */
export function sigFig2(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n.toLocaleString("en-US", { maximumSignificantDigits: 2 });
}

/** "1 in 41,000" from the server's oneIn (1/P); null when there is no finite figure (chance 0 means never alone). */
export function oneInText(oneIn) {
  const s = typeof oneIn === "number" && oneIn > 0 ? sigFig2(oneIn) : null;
  return s === null ? null : `1 in ${s}`;
}

/** The hover on the most-likely fact line: what it is computed from (likely-copies.js). */
export const LIKELY_BASIS = "From the expected copies, as a Poisson count: the most likely number of other entries with this exact lineup, and the range between its 10% and 90% points.";

/** The headline figure: expected copies written plainly, two significant figures ("0.3", "4.1", "22", "59"), "<0.01" below 0.01. */
export function copiesText(copies) {
  if (typeof copies !== "number" || !Number.isFinite(copies)) return null;
  if (copies < COPIES_FLOOR) return "<0.01";
  return sigFig2(copies);
}

/** Where a lineup sits on the scale as a fraction, 0 (chalky end) .. 1 (unique end), log in expected copies; null if unreadable. */
function uniqueFraction(copies) {
  if (typeof copies !== "number" || !Number.isFinite(copies)) return null;
  const lo = Math.log10(COPIES_UNIQUE_END);
  const hi = Math.log10(COPIES_CHALKY_END);
  const c = Math.min(COPIES_CHALKY_END, Math.max(COPIES_UNIQUE_END, copies));
  return (hi - Math.log10(c)) / (hi - lo);
}

/** Marker position on the track, 0..100 (percent from the left, chalky left): log scale in expected copies, clamped at both ends. */
export function markerPosition(copies) {
  const f = uniqueFraction(copies);
  return f === null ? null : f * 100;
}

/** The scale's colour at this many expected copies as "rgb(r, g, b)": piecewise-linear red, amber, green along the same log track. */
export function scaleColour(copies) {
  const x = uniqueFraction(copies) ?? 0;
  let i = 1;
  while (i < SCALE_STOPS.length - 1 && x > SCALE_STOPS[i][0]) i += 1;
  const [x0, c0] = SCALE_STOPS[i - 1];
  const [x1, c1] = SCALE_STOPS[i];
  const t = (x - x0) / (x1 - x0);
  const ch = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

/** The CSS gradient the track paints; same stops as scaleColour so the marker's colour matches the track under it. */
export function scaleGradientCss() {
  const stops = SCALE_STOPS.map(([at, c]) => `rgb(${c[0]}, ${c[1]}, ${c[2]}) ${at * 100}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** "-14.2 (-12.6%)" with a real minus sign; null when the gap is missing. */
export function gapText(gapPts, gapPct) {
  if (typeof gapPts !== "number" || !Number.isFinite(gapPts)) return null;
  const sign = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");
  const pts = `${sign(gapPts)}${dec1(Math.abs(gapPts))}`;
  if (typeof gapPct !== "number" || !Number.isFinite(gapPct)) return pts;
  return `${pts} (${sign(gapPct)}${dec1(Math.abs(gapPct))}%)`;
}

/** The mode a server answer is for: its own `mode` when valid, else the one asked. */
function answerMode(d, asked) {
  return d && MODES.some((x) => x.value === d.mode) ? d.mode : asked;
}

/**
 * "Projection (TwoGun) 98.4 · best possible 112.6 · -14.2 (-12.6%)". In TwoGun mode the source is named on the figure
 * (the six slots follow the same switch, so they show TwoGun's figures too); in Our sources mode it is left off.
 * Pieces the server did not send are left out; a source with no projections posted says so with no numbers, a
 * refused file shows the refusal; a lineup with an unprojected player says that.
 */
export function projectionLineText(d, asked = "twogun") {
  if (d?.projection && d.projection.posted === false) {
    if (d.projection.error) return String(d.projection.error);
    return answerMode(d, asked) === "current" ? "No projections from our sources yet" : "TwoGun hasn't posted Showdown projections for this game yet";
  }
  if (!d || typeof d.proj !== "number" || !Number.isFinite(d.proj)) return "Projection unknown (a player has no projection)";
  const named = answerMode(d, asked) === "twogun" ? " (TwoGun)" : "";
  const parts = [`Projection${named} ${dec1(d.proj)}`];
  if (typeof d.bestProj === "number" && Number.isFinite(d.bestProj)) parts.push(`best possible ${dec1(d.bestProj)}`);
  const gap = gapText(d.gapPts, d.gapPct);
  if (gap) parts.push(gap);
  return parts.join(" · ");
}

const AS_OF_WORD = { "file time": "saved ", "board built": "board built ", fetched: "fetched " };

/**
 * "Ownership: TwoGun, Oct 18, 2:30 PM" (or "Projections: ..."): the mode's short name and the half's as-of, kept to one
 * line (the full source goes in sourceTitle). A file's own time reads "saved <time>", the board's build time "board
 * built <time>"; an as-of that is not a date is shown as written without a trailing "(...)", a missing one says so.
 */
export function sourceLineText(half, asked = "twogun", what = "Ownership") {
  const label = MODES.find((x) => x.value === asked)?.label ?? "TwoGun";
  const raw = half?.asOf;
  if (raw === null || raw === undefined || raw === "") return `${what}: ${label}, as-of date missing`;
  const d = new Date(raw);
  const when = Number.isNaN(d.getTime()) || typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(raw)
    ? String(raw).replace(/\s*\([^()]*\)\s*$/, "")
    : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${what}: ${label}, ${AS_OF_WORD[half.asOfFrom] ?? ""}${when}`;
}

/** The hover text behind a source line: the server's full source name and as-of, as sent. */
export function sourceTitle(half) {
  const src = typeof half?.source === "string" && half.source.trim() ? half.source.trim() : "Source not named";
  return half?.asOf ? `${src}; as of ${half.asOf}` : src;
}

/** The words that stand in for the scale when uniqueness cannot be measured, or null when it can. */
export function noUniquenessText(d, asked = "twogun") {
  const current = answerMode(d, asked) === "current";
  const own = d?.ownership;
  if (own && own.posted === false && own.error) return String(own.error);
  if (!own || own.posted === false) return current ? "No ownership from our sources yet" : "TwoGun hasn't posted Showdown ownership for this game yet";
  const names = Array.isArray(own.unposted) ? own.unposted.filter(Boolean) : [];
  if (names.length) return `No ${current ? "ownership from our sources" : "TwoGun ownership"} for ${names.join(", ")}, so uniqueness can't be measured for this lineup.`;
  const u = d.uniqueness;
  if (!u || typeof u.aloneChance !== "number" || !Number.isFinite(u.aloneChance) || copiesText(u.copies) === null) return "Uniqueness is not available for this lineup.";
  return null;
}

function findRow(board, id) {
  return (board?.rows ?? []).find((r) => String(r.id) === String(id));
}

/**
 * The meter request body {cpt, flex:[5], excludes, mode} from the placed ids (the panel's person ids): the Captain
 * goes as his Captain candidate id (row.cptId), each FLEX as row.id. Null until all six are placed and on the board.
 * `excludes`: the Optimizer's excludes for the mode on screen (optimizer.js optimizerExcludes; 🔵 866b0ce B1), so the
 * "best possible" this lineup is measured against is the one the batch cards are, and the two gaps agree; none by default.
 */
export function meterRequestBody(board, cpt, flex, mode = "twogun", excludes = []) {
  if (!cpt || !Array.isArray(flex) || flex.length !== 5 || !flex.every(Boolean)) return null;
  const cptRow = findRow(board, cpt.id);
  if (!cptRow || cptRow.cptId === null || cptRow.cptId === undefined) return null;
  const flexIds = [];
  for (const s of flex) {
    const row = findRow(board, s.id);
    if (!row) return null;
    flexIds.push(String(row.id));
  }
  return { cpt: String(cptRow.cptId), flex: flexIds, excludes: Array.isArray(excludes) ? excludes.map(String) : [], mode };
}

/**
 * True when GET .../modes ({modes: {<mode>: {projection: {posted, error}, ownership: {posted, error}}}}) says this mode
 * has neither half posted and neither file refused (a refusal is shown in the strip, not as "not posted"); anything
 * else labels nothing (the option itself is never hidden).
 */
export function modeHasNothing(info, mode) {
  const e = info?.modes?.[mode];
  const absent = (h) => Boolean(h) && typeof h === "object" && h.posted === false && !h.error;
  return absent(e?.projection) && absent(e?.ownership);
}

/** The remembered mode from a storage-like object; anything unreadable or unknown is the default, TwoGun. */
export function readStoredMode(getStorage) {
  try {
    const v = getStorage().getItem(MODE_KEY);
    return MODES.some((x) => x.value === v) ? v : "twogun";
  } catch (e) {
    return "twogun"; // storage blocked: the switch still works for this page view
  }
}

/** Saves the mode; false when storage is blocked (the choice then lasts for this page view only). */
export function writeStoredMode(getStorage, mode) {
  try {
    getStorage().setItem(MODE_KEY, mode);
    return true;
  } catch (e) {
    return false;
  }
}

const finiteOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The figures a slot shows for one board row: { proj, own } (own in percent). "Our sources" mode: the board row's own
 * figures, as before. TwoGun mode: TwoGun's from the modes answer's `players` map (Captain: his Captain projection,
 * 1.5x, and Captain ownership; FLEX: FLEX projection and ownership), the same numbers the meter measures with. A man
 * TwoGun has no number for, or a map not yet read, gives null: missing is missing, never zero and never the other
 * source's number (D29). A man not on TwoGun's board at all adds notOnBoard: true beside his 0% (Q8).
 */
export function figuresFor(row, isCpt, mode, players) {
  if (!row) return { proj: null, own: null };
  if (mode !== "twogun") return { proj: finiteOrNull(isCpt ? row.cptProj : row.proj), own: finiteOrNull(isCpt ? row.ownCpt : row.ownFlex) };
  const p = players?.[String(row.id)];
  const out = { proj: finiteOrNull(isCpt ? p?.cptProj : p?.proj), own: finiteOrNull(isCpt ? p?.ownCpt : p?.ownFlex) };
  if (p?.notOnBoard === true) out.notOnBoard = true;
  if (typeof p?.projNote === "string" && p.projNote) out.projNote = p.projNote; // a man listed Out counts as 0; this says what TwoGun projects
  if (out.own === null && typeof p?.missingReason === "string" && p.missingReason) out.missingReason = p.missingReason; // why his blank stays blank
  return out;
}

/** A server reason as a span: cut at a word to `max` characters with the full text on hover when it is long. */
export function reasonHtml(reason, max = 44) {
  const text = String(reason);
  const cut = text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
  return `<span class="sd-reason"${cut === text ? "" : ` title="${escapeHtml(text)}"`}>${escapeHtml(cut)}</span>`;
}

function switchHtml(mode, modesInfo) {
  const opts = MODES.map((o) => {
    const on = o.value === mode;
    const note = modeHasNothing(modesInfo, o.value) ? `<span class="sd-meter-opt-note">not posted yet</span>` : "";
    return `<span class="sd-meter-opt-wrap"><button type="button" class="sd-meter-opt${on ? " active" : ""}" data-meter-mode="${o.value}" aria-pressed="${on}">${escapeHtml(o.label)}</button>${note}</span>`;
  }).join("");
  return `<div class="sd-meter-switch" role="group" aria-label="Where projections and ownership come from"><span class="sd-meter-switch-label">Source</span>${opts}</div>`;
}

/** The words for a man TwoGun's board has no row for (Q8), shared by the meter's note and the swaps; the slots' own line (lineup.js) says the same. */
export const NOT_ON_BOARD_WORDS = "not on TwoGun's board, 0%";

/** "A Smith, B Jones: not on TwoGun's board, 0%" for the lineup men TwoGun's board has no row for (Q8); null when none or not TwoGun mode. */
export function notOnBoardText(d, asked = "twogun") {
  if (answerMode(d, asked) !== "twogun") return null;
  const names = Array.isArray(d?.ownership?.notOnBoard) ? d.ownership.notOnBoard.filter(Boolean) : [];
  return names.length ? `${names.join(", ")}: ${NOT_ON_BOARD_WORDS}` : null;
}

/** What the chosen source has not posted, from the modes answer (no lineup needed): the ownership line, then the projection line; "" when both are posted. */
function notPostedHtml(modesInfo, mode) {
  const e = modesInfo?.modes?.[mode];
  const d = { mode, ownership: e?.ownership, projection: e?.projection };
  const line = (half, text) => (half?.posted === false ? `<div class="${half.error ? "sd-meter-error" : "sd-meter-none"}">${escapeHtml(text())}</div>` : "");
  return line(d.ownership, () => noUniquenessText(d, mode)) + line(d.projection, () => projectionLineText(d, mode));
}

/**
 * The strip's html for one meter state ({status: "loading"|"error"|"ok", data, message}). `modesNote` is the one line
 * saying the TwoGun figures could not be read (shown even with no lineup measured); `notes` are the server's reasons
 * (TwoGun's list looks incomplete; why a placed man's ownership is blank), one plain line each; "" when nothing to show.
 * `showSwitch` (the app is live): with nothing measured yet the strip still draws the switch and, from the modes answer, the
 * line saying what the chosen source has not posted, so the source in use is always on screen (Adam 2026-10-18).
 */
export function meterHtml(m, mode = "twogun", modesInfo = null, modesNote = null, notes = [], showSwitch = false) {
  const note = (modesNote ? `<div class="sd-meter-error">${escapeHtml(modesNote)}</div>` : "") + notes.map((t) => `<div class="sd-meter-none">${reasonHtml(t, 120)}</div>`).join("");
  if (!m || !m.status) {
    if (showSwitch) return `<div class="sd-meter" aria-live="polite">${switchHtml(mode, modesInfo)}${note}${notPostedHtml(modesInfo, mode)}</div>`;
    return note ? `<div class="sd-meter" aria-live="polite">${note}</div>` : "";
  }
  const switchOnly = switchHtml(mode, modesInfo);
  const sw = switchOnly + note;
  if (m.status === "loading") return `<div class="sd-meter" aria-live="polite">${sw}<div class="sd-meter-none">Measuring uniqueness…</div></div>`;
  if (m.status === "error") return `<div class="sd-meter" aria-live="polite">${sw}<div class="sd-meter-error">${escapeHtml(m.message || "Could not measure this lineup.")}</div></div>`;
  const d = m.data;
  const shown = answerMode(d, mode);
  const srcLine = (half, what) => `<div class="sd-meter-src" title="${escapeHtml(sourceTitle(half))}">${escapeHtml(sourceLineText(half, shown, what))}</div>`;
  const offBoard = notOnBoardText(d, mode);
  const offBoardHtml = offBoard ? `<div class="sd-meter-none">${escapeHtml(offBoard)}</div>` : "";
  const none = noUniquenessText(d, mode);
  let uniq;
  if (none) {
    uniq = `<div class="${d?.ownership?.error ? "sd-meter-error" : "sd-meter-none"}">${escapeHtml(none)}</div>`;
  } else {
    const u = d.uniqueness;
    const likely = likelyFactText(u.copies);
    const field = typeof u.field === "number" && Number.isFinite(u.field) ? u.field.toLocaleString("en-US") : null;
    const copies = copiesText(u.copies);
    const oneIn = oneInText(u.oneIn);
    const colour = scaleColour(u.copies);
    uniq = `
      <div class="sd-meter-head">
        <span class="sd-meter-label">Expected copies in ${field !== null ? `a ${escapeHtml(field)}-lineup` : "the"} field</span>
        <span class="sd-meter-big" style="color:${colour}">${escapeHtml(copies)}</span>
        ${switchOnly}
      </div>
      <div class="sd-meter-scale" role="img" aria-label="Uniqueness scale in expected copies, chalky to unique">
        <div class="sd-meter-track" style="background:${scaleGradientCss()}">
          <span class="sd-meter-marker" style="left:${markerPosition(u.copies)}%;background:${colour}"></span>
        </div>
        <div class="sd-meter-ends"><span>Chalky</span><span>Unique</span></div>
      </div>
      <div class="sd-meter-facts">
        ${likely ? `<span title="${escapeHtml(LIKELY_BASIS)}">${escapeHtml(likely)}</span>` : ""}
        ${oneIn ? `<span><b>${escapeHtml(oneIn)}</b> entries plays this exact lineup</span>` : ""}
      </div>
      ${srcLine(d.ownership, "Ownership")}`;
  }
  const pr = d?.projection;
  return `
    <div class="sd-meter" aria-live="polite">
      ${none ? sw : note}
      ${uniq}
      ${offBoardHtml}
      <div class="sd-meter-proj${pr?.posted === false && pr.error ? " sd-meter-error" : ""}">${escapeHtml(projectionLineText(d, mode))}</div>
      ${pr?.posted ? srcLine(pr, "Projections") : ""}
    </div>`;
}

// ---------- the fetches, kept here (not in api.js: the public site's stand-in must export api.js's names exactly) ----------

/** POST /api/showdown/<key>/lineup/meter; resolves to the parsed answer, never throws for a server-side refusal. */
export async function postLineupMeter(key, body, fetchImpl = fetch) {
  const url = `/api/showdown/${encodeURIComponent(key)}/lineup/meter`;
  const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return readJson(res);
}

/** GET /api/showdown/<key>/modes: what each mode has posted. */
export async function getLineupModes(key, fetchImpl = fetch) {
  const url = `/api/showdown/${encodeURIComponent(key)}/modes`;
  return readJson(await fetchImpl(url));
}

// ---------- state and trigger ----------

const m = { sig: null, status: null, data: null, message: null, timer: null, modesDue: false }; // modesDue: the pending timer reads the modes too
let mode = null; // read from storage on first use
let modesInfo = null; // last good GET .../modes answer for modesKey: the "not posted yet" notes and each man's TwoGun figures
let modesKey = null; // the showdown modesInfo is for
let modesAsked = null; // what the last modes read was for (showdown and board build); null asks again
let modesError = null; // why the last read for modesKey failed, in plain words; null once a read succeeds
let modesSeq = 0; // numbers each modes read: only the latest read's answer or failure is taken
let figuresListener = null; // lineup.js's repaint of the six slots' figure lines
const browserStorage = () => window.localStorage;

function currentMode() {
  if (mode === null) mode = typeof window === "undefined" ? "twogun" : readStoredMode(browserStorage);
  return mode;
}

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
  // The published site has no server to ask; sample mode writes nothing and has no meter route either.
  if (typeof document !== "undefined" && document.documentElement.classList.contains("is-site")) return false;
  return !isSampleMode();
}

/** Switches the mode, remembers it, and drops the current answer so the next draw asks again. */
export function setMeterMode(next, storage = browserStorage) {
  if (!MODES.some((x) => x.value === next) || next === currentMode()) return false;
  mode = next;
  writeStoredMode(storage, next);
  reset();
  modesAsked = null; // a flip reads the modes (and so the slots' figures) afresh
  return true;
}

/** Test hook: the current meter state and mode. */
export function meterState() {
  return { sig: m.sig, status: m.status, data: m.data, message: m.message, mode: currentMode(), modesInfo, modesError };
}

/**
 * What a slot shows for this board row under the chosen mode (see figuresFor). Without a live meter (the published
 * site, sample mode, no showdown) the switch is not on the page, so the slots keep the board's own figures.
 */
export function playerFigures(row, isCpt) {
  const twogun = figuresMode() === "twogun";
  return figuresFor(row, isCpt, figuresMode(), twogun ? modesInfo?.modes?.twogun?.players : null);
}

/** The mode every number on the screen follows: the switch's, or "current" when there is no live switch (site, sample mode). */
export function figuresMode() {
  return Boolean(last?.enabled && last?.key) && currentMode() === "twogun" ? "twogun" : "current";
}

/** The one short label on a Build result saying whose projections it used (Q16). */
export function builtOnText(builtMode) {
  return builtMode === "twogun" ? "Built on TwoGun's projections" : "Built on our sources' projections";
}

/** lineup.js hands in the function that repaints the six slots' figure lines; the meter calls it whenever the mode or the modes answer changes. */
export function onFiguresChange(fn) {
  figuresListener = typeof fn === "function" ? fn : null;
}

/**
 * The one line shown in TwoGun mode when the last modes read failed (instead of six silent "no proj", or silently
 * keeping an earlier answer); null otherwise.
 */
function modesNoteText() {
  const live = Boolean(last?.enabled && last?.key);
  if (!live || currentMode() !== "twogun" || !modesError) return null;
  // A failed re-read keeps the earlier answer on the slots, so the line says that (never silently stale).
  return modesInfo ? `TwoGun figures could not be re-read: ${modesError.replace(/[.\s]+$/, "")}; the slots show the earlier read` : figuresProblemText(); // the first read failing is worded once, as the lists' header says it
}

/** "reading TwoGun's figures…" while the first modes read for this showdown is out (TwoGun mode), else null: the slots then say this, not "no proj". */
export function readingFiguresText() {
  const live = Boolean(last?.enabled && last?.key);
  return live && currentMode() === "twogun" && !modesInfo && !modesError ? "reading TwoGun's figures…" : null;
}

/**
 * Why every TwoGun figure is blank when the first modes read for this showdown failed (TwoGun mode, no earlier answer to
 * show), in plain words for the lists' header note and the hover on their blank cells; null otherwise (a failed re-read keeps
 * the earlier answer on screen and is told in the strip above the slots).
 */
export function figuresProblemText() {
  const live = Boolean(last?.enabled && last?.key);
  return live && currentMode() === "twogun" && !modesInfo && modesError ? `TwoGun's figures could not be read: ${modesError}` : null;
}

/**
 * Why TwoGun has no number for a whole half ("ownership" or "projection") of this showdown: the modes answer's own reason,
 * the same words the strip's not-posted line uses; null when that half is posted, or not in TwoGun mode, or not yet read.
 */
export function twogunNotPostedText(half) {
  const e = modesInfo?.modes?.twogun;
  if (!e || figuresMode() !== "twogun" || e[half]?.posted !== false) return null;
  const d = { mode: "twogun", ownership: e.ownership, projection: e.projection };
  return half === "ownership" ? noUniquenessText(d, "twogun") : projectionLineText(d, "twogun");
}

/** The server's reasons in TwoGun mode: TwoGun's list looks incomplete, and why each placed man's blank ownership stays blank. */
function reasonNotes() {
  if (!last?.enabled || !last?.key || currentMode() !== "twogun") return [];
  const notes = [];
  const incomplete = modesInfo?.modes?.twogun?.ownership?.incompleteReason;
  if (typeof incomplete === "string" && incomplete) notes.push(incomplete);
  for (const [s, isCpt] of [[last.cpt, true], ...(last.flex ?? []).map((f) => [f, false])]) {
    const row = s ? findRow(last.board, s.id) : null;
    const why = row ? playerFigures(row, isCpt).missingReason : null;
    if (why) notes.push(`${row.name}: ${why}`);
  }
  return notes;
}

/** The current strip html (call inside the panel draw, after syncMeter). */
export function meterStripHtml() {
  return meterHtml(m, currentMode(), modesInfo, modesNoteText(), reasonNotes(), Boolean(last?.enabled && last?.key));
}

let last = null; // the last syncMeter arguments, so a flip of the switch asks again without a panel draw

/**
 * Repaints the meter's own strip inside the panel and nothing else: the panel is never redrawn from here, so a lineup
 * name being typed and its cursor survive an answer landing. No strip on show: one that now has something to say
 * (the modes-failure line) is put where the panel draws it, right after the six slots.
 */
function repaint() {
  if (figuresListener) figuresListener(); // the slots' figures follow the mode; they exist with or without a strip
  repaintStrip();
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
  const active = typeof document !== "undefined" ? document.activeElement : null;
  const focused = active && el.contains?.(active) ? active.dataset?.meterMode : null;
  el.outerHTML = meterStripHtml();
  const fresh = host.querySelector(".sd-meter");
  if (!fresh) return;
  wireMeter(fresh);
  if (focused) fresh.querySelector(`[data-meter-mode="${focused}"]`)?.focus();
}

/** Wires the switch buttons inside `container`: a flip remembers the mode, asks again and repaints only the strip. */
export function wireMeter(container) {
  container.querySelectorAll("[data-meter-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!setMeterMode(btn.dataset.meterMode)) return;
      if (last) syncMeter(last);
      repaint();
    });
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
 * Called before every panel draw with the panel element (`container`). Incomplete lineup: the strip goes away.
 * Complete lineup whose ids, projections, ownership, board or mode differ from the one last asked about: strip shows
 * "measuring", one request goes out after a short pause, and an answer for a lineup that has since changed is
 * dropped. When an answer lands only the strip is repainted. `excludes`: the Optimizer's for the mode on screen, sent in the
 * body (so they are part of the signature: a changed exclude asks again); none by default (🔵 866b0ce B1). `readModes`
 * false (an exclude toggle) skips the modes re-read the new measurement would send, unless one still waiting is replaced.
 */
export function syncMeter({ board, key, cpt, flex, container = null, post = postLineupMeter, getModes = getLineupModes, delayMs = DELAY_MS, enabled = liveMeterAllowed(), excludes = [], readModes = true }) {
  last = { board, key, cpt, flex, container, post, getModes, delayMs, enabled, excludes };
  const asked = currentMode();
  const live = Boolean(enabled && key);
  if (live && key !== modesKey) {
    modesKey = key; // another showdown: the last one's figures, notes and failure are not this one's
    modesInfo = null;
    modesAsked = null;
    modesError = null;
  }
  // The modes answer (the "not posted yet" notes and the slots' TwoGun figures) is read as soon as a showdown is on
  // show, again for a rebuilt board, a mode flip or a new complete lineup. A failed read leaves the last answer in
  // place (the options are never hidden); with no answer yet for this showdown the strip says why (modesNoteText).
  const wantModes = live && modesAsked !== `${key}|${board?.generatedAt ?? ""}`;
  const askModes = () => {
    modesAsked = `${key}|${board?.generatedAt ?? ""}`;
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
        const tgPlayers = info.modes?.twogun?.players;
        if (!tgPlayers || typeof tgPlayers !== "object") return fail("the answer had no TwoGun figures.");
        modesInfo = info;
        modesError = null;
        repaint();
      })
      .catch((e) => fail(e?.code === NOT_JSON ? lowerFirst(notJsonText(e.status)) : `the server could not be reached (${e?.message ?? e}).`)); // it follows a colon, as the other reasons do
  };
  const body = live ? meterRequestBody(board, cpt, flex, asked, excludes) : null;
  if (!body) {
    if (m.sig !== null) reset();
    if (wantModes) askModes();
    return;
  }
  const sig = lineupSig(key, board, body, cpt, flex);
  if (sig === m.sig) {
    if (wantModes && !m.timer) askModes(); // a pending timer reads them anyway
    return;
  }
  const modesDue = readModes || wantModes || Boolean(m.timer && m.modesDue); // a read that is due, or a replaced wait's, still happens
  reset();
  m.sig = sig;
  m.modesDue = modesDue;
  m.status = "loading";
  m.timer = setTimeout(async () => {
    m.timer = null;
    // A new complete lineup reads the modes afresh too (a TwoGun file saved meanwhile), behind the same pause as the
    // POST, so quick swaps send one GET.
    if (modesDue) askModes();
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
    if (m.sig !== sig) return; // the lineup (or the mode) changed while this was out
    m.status = next.status;
    m.data = next.data ?? null;
    m.message = next.message ?? null;
    repaint();
  }, delayMs);
}
