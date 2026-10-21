// Showdown Lineup Builder: the uniqueness / projection meter strip under the six slots (Adam 2026-10-18: "being
// unique is more important than any projection optimization"). When Captain plus five FLEX are all placed it asks
// POST /api/showdown/<key>/lineup/meter once and shows, uniqueness first, the lineup's expected copies in the field on
// a log colour scale (with how many other entries most likely hold it beside), then the projection against the best possible one.
// Every figure is this game's served board's (Adam 2026-10-20 10:03 AM: "change sources to anything for any game, classic,
// cash, showdown, make it uniform across everything"): the old TwoGun | Our sources switch is gone, and the head line names the
// sources the board reads (./figures-label.js) with a link to the Sources page, where Adam picks them. Pure helpers are
// exported for tests; lineup.js only calls syncMeter (before a draw), meterStripHtml (inside the draw) and wireMeter (after it).
import { escapeHtml, dec1 } from "../format.js";
import { isSampleMode } from "../api.js";
import { onSitePage } from "../tabs.js"; // the one is-site check
import { readJson, requestFailureText, notJsonText, NOT_JSON } from "./read-json.js"; // the one JSON reader (🔵 866b0ce B4)
import { likelyCopies, likelyFactText } from "./likely-copies.js";
import { figuresLabelHtml, asOfText, halfName, twogunTicked } from "./figures-label.js";

export { likelyCopies }; // the most-likely count and its usual range (likely-copies.js: a separate file, this one is near 600 lines)

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

const MINUS = "−";
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1); // a shared sentence placed after a colon
const DELAY_MS = 150; // double clicks and quick slot swaps collapse into one request
const NO_PROJECTIONS = "No projections from this game's ticked sources yet";
const NO_OWNERSHIP = "No ownership from this game's ticked sources yet";
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

/**
 * "Projection 98.4 · best possible 112.6 · -14.2 (-12.6%)" (the sources are named on the head line and the source line).
 * Pieces the server did not send are left out; no projections posted from the ticked sources says so with no numbers, a
 * refused file shows the refusal; a lineup with an unprojected player says that.
 */
export function projectionLineText(d) {
  if (d?.projection && d.projection.posted === false) return d.projection.error ? String(d.projection.error) : NO_PROJECTIONS;
  if (!d || typeof d.proj !== "number" || !Number.isFinite(d.proj)) return "Projection unknown (a player has no projection)";
  const parts = [`Projection ${dec1(d.proj)}`];
  if (typeof d.bestProj === "number" && Number.isFinite(d.bestProj)) parts.push(`best possible ${dec1(d.bestProj)}`);
  const gap = gapText(d.gapPts, d.gapPct);
  if (gap) parts.push(gap);
  return parts.join(" · ");
}

/**
 * "Ownership: TwoGun, Oct 18, 2:30 PM" (or "Projections: ..."): the board's short name for the half's sources (figures-label.js
 * halfName) and the half's as-of, kept to one line (the full source goes in sourceTitle). A file's own time reads "saved <time>",
 * the board's build time "board built <time>"; an as-of that is not a date is shown as written without a trailing "(...)", a
 * missing one says so.
 */
export function sourceLineText(half, name, what = "Ownership") {
  const label = typeof name === "string" && name ? name : "this game's sources";
  return `${what}: ${label}, ${asOfText(half) ?? "as-of date missing"}`;
}

/** The hover text behind a source line: the server's full source name and as-of, as sent. */
export function sourceTitle(half) {
  const src = typeof half?.source === "string" && half.source.trim() ? half.source.trim() : "Source not named";
  return half?.asOf ? `${src}; as of ${half.asOf}` : src;
}

/** The words that stand in for the scale when uniqueness cannot be measured, or null when it can. */
export function noUniquenessText(d) {
  const own = d?.ownership;
  if (own && own.posted === false && own.error) return String(own.error);
  if (!own || own.posted === false) return NO_OWNERSHIP;
  const names = Array.isArray(own.unposted) ? own.unposted.filter(Boolean) : [];
  if (names.length) return `No ownership from this game's ticked sources for ${names.join(", ")}, so uniqueness can't be measured for this lineup.`;
  const u = d.uniqueness;
  if (!u || typeof u.aloneChance !== "number" || !Number.isFinite(u.aloneChance) || copiesText(u.copies) === null) return "Uniqueness is not available for this lineup.";
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
 */
export function figuresFor(row, isCpt, players = null) {
  if (!row) return { proj: null, own: null };
  const p = players?.[String(row.id)];
  const projKey = isCpt ? "cptProj" : "proj";
  const proj = p && Object.hasOwn(p, projKey) ? p[projKey] : row[projKey];
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

/** The words for a man TwoGun's board has no row for (Q8), shared by the meter's note and the swaps; the slots' own line (lineup.js) says the same. */
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

/** The meter's head line: "Expected copies in a 100,000-lineup field", the figure in the scale's colour, and the figures label. */
function headHtml(u, label) {
  const field = typeof u.field === "number" && Number.isFinite(u.field) ? u.field.toLocaleString("en-US") : null;
  return `
      <div class="sd-meter-head">
        <span class="sd-meter-label">Expected copies in ${field !== null ? `a ${escapeHtml(field)}-lineup` : "the"} field</span>
        <span class="sd-meter-big" style="color:${scaleColour(u.copies)}">${escapeHtml(copiesText(u.copies))}</span>
        ${label}
      </div>`;
}

/** The scale, the fact lines and the ownership source line of a measured lineup. */
function uniquenessHtml(u, label, srcLine, own) {
  const likely = likelyFactText(u.copies);
  const oneIn = oneInText(u.oneIn);
  const colour = scaleColour(u.copies);
  return `${headHtml(u, label)}
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
      ${srcLine(own, "Ownership")}`;
}

/**
 * The strip's html for one meter state ({status: "loading"|"error"|"ok", data, message}). `v` = { label (figures-label.js
 * figuresLabelHtml: the board's sources and the Sources link), modesInfo (GET .../modes), modesNote (the one line saying the
 * modes answer could not be read), notes (the server's reasons: TwoGun's list looks incomplete, why a placed man's ownership is
 * blank, one plain line each), live (the app is live: with nothing measured yet the strip still shows the label and what the
 * ticked sources have not posted, so the sources in use are always on screen, Adam 2026-10-18), names ({ projection, ownership }:
 * figures-label.js halfName, for the source lines) }. The label rides the head line when uniqueness is measured, else its own line.
 */
export function meterHtml(m, v = {}) {
  const { label = "", modesInfo = null, modesNote = null, notes = [], live = false, names = {} } = v;
  const note = (modesNote ? `<div class="sd-meter-error">${escapeHtml(modesNote)}</div>` : "") + notes.map((t) => `<div class="sd-meter-none">${reasonHtml(t, 120)}</div>`).join("");
  const top = (label ? `<div class="sd-meter-figures-line">${label}</div>` : "") + note;
  if (!m || !m.status) {
    const idle = live ? top + notPostedHtml(modesInfo) : note; // a board with no figures and nothing to say draws no empty box
    return idle ? `<div class="sd-meter" aria-live="polite">${idle}</div>` : "";
  }
  if (m.status === "loading") return `<div class="sd-meter" aria-live="polite">${top}<div class="sd-meter-none">Measuring uniqueness…</div></div>`;
  if (m.status === "error") return `<div class="sd-meter" aria-live="polite">${top}<div class="sd-meter-error">${escapeHtml(m.message || "Could not measure this lineup.")}</div></div>`;
  const d = m.data;
  const srcLine = (half, what) => `<div class="sd-meter-src" title="${escapeHtml(sourceTitle(half))}">${escapeHtml(sourceLineText(half, what === "Ownership" ? names.ownership : names.projection, what))}</div>`;
  const offBoard = notOnBoardText(d);
  const none = noUniquenessText(d);
  const uniq = none ? `<div class="${d?.ownership?.error ? "sd-meter-error" : "sd-meter-none"}">${escapeHtml(none)}</div>` : uniquenessHtml(d.uniqueness, label, srcLine, d.ownership);
  const pr = d?.projection;
  return `
    <div class="sd-meter" aria-live="polite">
      ${none ? top : note}
      ${uniq}
      ${offBoard ? `<div class="sd-meter-none">${escapeHtml(offBoard)}</div>` : ""}
      <div class="sd-meter-proj${pr?.posted === false && pr.error ? " sd-meter-error" : ""}">${escapeHtml(projectionLineText(d))}</div>
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

/** GET /api/showdown/<key>/modes: what the ticked sources have posted, and each man's notes. */
export async function getLineupModes(key, fetchImpl = fetch) {
  const url = `/api/showdown/${encodeURIComponent(key)}/modes`;
  return readJson(await fetchImpl(url));
}

// ---------- state and trigger ----------

const m = { sig: null, status: null, data: null, message: null, timer: null, modesDue: false }; // modesDue: the pending timer reads the modes too
let modesInfo = null; // last good GET .../modes answer for modesKey: the "not posted yet" lines and each man's notes
let modesKey = null; // the showdown modesInfo is for
let modesAsked = null; // what the last modes read was for (showdown and board.figures.key); null asks again
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
  // The published site has no server to ask; sample mode writes nothing and has no meter route either.
  if (onSitePage()) return false;
  return !isSampleMode();
}

const isLive = () => Boolean(last?.enabled && last?.key);

/** Test hook: the current meter state. */
export function meterState() {
  return { sig: m.sig, status: m.status, data: m.data, message: m.message, modesInfo, modesError };
}

/** What a slot shows for this board row (see figuresFor); off the live app (the site, sample mode) there is no modes answer, so no notes. */
export function playerFigures(row, isCpt) {
  return figuresFor(row, isCpt, isLive() ? modesInfo?.modes?.current?.players : null);
}

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
  const board = last?.board ?? null;
  const names = { projection: halfName(board, "projection"), ownership: halfName(board, "ownership") };
  return meterHtml(m, { label: figuresLabelHtml(board), modesInfo, modesNote: modesNoteText(), notes: reasonNotes(), live: isLive(), names });
}

let last = null; // the last syncMeter arguments, so an answer landing repaints without a panel draw

/**
 * Repaints the meter's own strip inside the panel and the slots' figure lines (lineup.js's onModes: the notes from the modes
 * answer), nothing else: the panel is never redrawn from here, so a lineup name being typed and its cursor survive an answer
 * landing. No strip on show: one that now has something to say is put where the panel draws it, right after the six slots.
 */
function repaint() {
  last?.onModes?.();
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
    modesAsked = null;
    modesError = null;
  }
  // Read as soon as a showdown is on show, again whenever its figures key moves (a Sources save, a typed number, TwoGun's files:
  // board-view.js figuresKeyOf), and for a new complete lineup.
  const asked = `${key}|${board?.figures?.key ?? ""}`;
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
