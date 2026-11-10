// The classic Cash tab's `Left out` panel (optimizer standard Part F, the Left out row; Adam 1:46 PM 2026-11-03: one to three men only, in the optimal lineups the engine builds and heavily owned), the Showdown's
// showdown/left-out-panel.js and its rule. The optimal lineups come from a quiet Cash build through the generate call (the public site's stand-in answers it in the browser): mode cash, ten lineups, the Cash tab's padlocks only (never the
// men held in the slots, lineup-left-out.js), its excludes, avoided games and Max per team. The ways in are ranked and priced on that build's own basis (its answer's `basis`: TwoGun's median in TwoGun mode, else the projection).
// It runs on the Cash tab only, again when the Cash tab's figures, padlocks, excludes, avoided games or Max per team change, after a pause, the latest asked winning and an older answer dropped; a Build of his always goes first
// (buildAfterQuiet, lineup-optimizer.js doGenerate). It is never a build on screen: it never touches the tab's results, notices, Lineups or saved lineups. The list (lineup-left-out.js leftOutReport) is worked out at each draw from the slots on screen,
// so a click in the lineup moves it at once without asking again.
import { escapeHtml, money, dec1, pct1 } from "./format.js";
import { store, activeSlate, activeSlateRows, activeSlateGames, isTwoGunMode } from "./state.js";
import { state, opt, LINEUP_SLOTS } from "./lineup.js";
import { buildCashSettings } from "./lineup-cash.js";
import { leftOutReport, wayInText, fieldText, salaryLeftOf } from "./lineup-left-out.js";
import { slateKeyOf } from "./lineup-optimizer.js";
import { postLineupGenerate } from "./api.js";
import { teamLogoHtml } from "./player-row.js";
import { teamVars } from "./look-row.js";

export const LEFT_OUT_COUNT = 10; // the quiet build's lineups: the optimal set the panel reads
const DELAY_MS = 600; // a run of padlock, exclude or typed-number clicks asks once
const BUSY_RETRY_MS = 1500; // a Build of his is running: ask again after it, never in its place
export const NOBODY_TEXT = "Nobody heavily owned is missing from your lineup.";

const lo = { key: null, sig: null, seq: 0, timer: null, status: null, lineups: null, basis: "proj", error: null, older: false };
let ask = (body) => postLineupGenerate(body);
let delayMs = DELAY_MS;
let inFlight = null; // the quiet request out now, which a Build waits for
let lastList = []; // the entries the panel last drew, which a Swap in button names by index
let host = null; // {container, commit, board} of the last draw: an answer repaints the panel there in place

/** Test hook: a stand-in for the generate call and the pause. */
export function setLeftOutRequest(fn, delay = DELAY_MS) {
  ask = fn;
  delayMs = delay;
}
/** Test hook: the panel's state. */
export const leftOutState = () => ({ ...lo, inFlight: Boolean(inFlight) });

const onCash = () => opt.mode === "cash";

/** The slate on screen's padlocks and avoided games only: a lock or an avoided game off the slate is left out of the request, as a Build leaves it out. */
function slateSettings(board) {
  const inSlate = new Set(activeSlateRows(board).map((r) => String(r.id)));
  const gameIds = new Set(activeSlateGames(board).map((g) => String(g.id)));
  return { locks: [...state.locks].filter((id) => inSlate.has(String(id))), excludes: [...state.excludes], avoidGames: opt.cash.avoid.filter((g) => gameIds.has(String(g))) };
}

/** The quiet build's body: the slate, the Cash tab's padlocks (never the men held in the slots), excludes, avoided games and Max per team, ten lineups. Pure of the page's other state. */
export function leftOutBody(board) {
  const { locks, excludes, avoidGames } = slateSettings(board);
  return { slate: slateKeyOf(board), settings: { ...buildCashSettings(opt.cash, { locks, excludes, avoidGames }), count: LEFT_OUT_COUNT } };
}

/** What the optimal lineups depend on: the slate, the Cash board's build time (a typed number restamps it) and the settings the body sends. */
function leftOutSig(key, board) {
  return JSON.stringify([key, board?.generatedAt ?? null, leftOutBody(board)]);
}

/** A Build is starting: the pending quiet ask is cancelled (asked again at the next draw) and one in flight is waited for. Resolves true when one was out, else false. */
async function settleQuietBuild() {
  if (lo.timer) {
    clearTimeout(lo.timer);
    lo.timer = null;
    lo.sig = null; // so the next draw asks again
  }
  const out = inFlight;
  if (!out) return false;
  await out.then(
    () => undefined,
    (e) => console.warn("Left out: the quiet build failed while a Build waited for it", e), // its own answer path says so on the panel
  );
  return true;
}

/** A Build's request, after the quiet Left out build has ended: `post()` is the generate call; a quiet build that still held the place is waited out once more and the answer is asked again, so a Build never meets "Lineups are already being made" from it. */
export async function buildAfterQuiet(post) {
  const waited = await settleQuietBuild();
  let data = await post();
  if (data?.error?.code === "GENERATE_BUSY" && (waited || (await settleQuietBuild()))) data = await post();
  return data;
}

/** One man's row (the approved look: the slot-first row, the position in the slot box): logo, name, the field sentence (with its hover), his Sal, Proj and Own, Swap in, the way in on a line under it (none, with the reason, when there is no way). */
function rowHtml(e, i, rows, secondSlate) {
  const wayText = e.wayIn ? wayInText(e.wayIn, salaryLeftOf(rows, e.wayIn.seats), e.id) : "";
  const field = fieldText(e, secondSlate);
  const swapBtn = e.wayIn ? `<button type="button" class="xf" style="grid-column:7" data-left-out-swap="${i}">Swap in</button>` : "";
  const way = e.wayIn ? `<div class="way" title="${escapeHtml(wayText)}">${escapeHtml(wayText)}</div>` : `<div class="way lo-noway" title="${escapeHtml(e.reason ?? "")}">${escapeHtml(e.reason ?? "")}</div>`;
  const fig = (cls, label, text) => `<span class="${cls}"><i>${label}</i>${text ?? "—"}</span>`;
  return `<div class="crow noctl" data-card-id="${escapeHtml(e.id)}" style="${teamVars(e.team)}"><span class="sl">${escapeHtml(e.pos ?? "")}</span>${teamLogoHtml(e.team, "logo sm", 20)}<div class="sn"><div class="sn1"><button type="button" class="pn player-name">${escapeHtml(e.name)}</button></div><small title="${escapeHtml(`${field} (in ${e.inOptimal} of the ${e.optimalTotal} optimal lineups)`)}">${escapeHtml(field)}</small></div>${fig("ss", "Sal", money(e.salary))}${fig("sp", "Proj", dec1(e.proj))}${fig("so", "Own", pct1(e.fieldOwn))}${swapBtn}</div>${way}`;
}

/** The panel's body for a view {status, error, older, lineups, entries, unjudged, rows, secondSlate}. Pure. */
export function leftOutHtml(v) {
  const quiet = (text, cls = "") => `<div class="lonote${cls}">${escapeHtml(text)}</div>`;
  let body;
  if (v.lineups === null) body = v.status === "error" ? quiet(`Could not work out who is left out: ${v.error}`, " lo-err") : quiet("Finding the optimal Cash lineups...");
  else {
    const note = v.status === "error" ? quiet(`Could not re-read the optimal Cash lineups: ${v.error} The list is from the earlier read.`, " lo-err") : "";
    const unjudged = v.unjudged ?? [];
    const notJudged = unjudged.length ? quiet(`Not judged, ownership is not posted for ${unjudged.length} ${unjudged.length === 1 ? "man" : "men"} in the optimal lineups.`) : ""; // a count: before ownership posts this would be the whole optimal set
    let list;
    if (!v.lineups.length) list = quiet("No optimal Cash lineup could be made with these padlocks and excludes, so nobody is listed.");
    else if (v.entries.length) list = `<div class="lo${v.older ? " is-older" : ""}">${v.entries.map((e, i) => rowHtml(e, i, v.rows, v.secondSlate)).join("")}</div>`;
    else list = unjudged.length ? "" : quiet(NOBODY_TEXT); // "nobody" only when every optimal man off the lineup could be judged
    body = note + list + notJudged;
  }
  const sub = v.status === "loading" && v.lineups !== null ? `<span class="lo-sub">updating...</span>` : v.older ? `<span class="lo-sub">older</span>` : "";
  return `<section class="lobox" id="sd-left-out" aria-live="polite"><div class="sec">Left out${sub}</div>${v.lineups?.length ? `<div class="lonote">Heavily owned men in the optimal Cash lineups who are not in yours.</div>` : ""}${body}</section>`;
}

/** The panel for the Cash tab on screen ("" on GPP): the last optimal lineups read against the slots on screen. */
export function leftOutPanelHtml(board) {
  if (!onCash()) return "";
  const rows = activeSlateRows(board);
  const report = lo.lineups?.length
    ? leftOutReport({ rows, seats: state.slots, lockedIds: [...state.locks], excludedIds: [...state.excludes], avoidGames: slateSettings(board).avoidGames, optimalLineups: lo.lineups, maxPerTeam: opt.cash.maxPerTeam, basis: lo.basis, twoGun: isTwoGunMode(board) })
    : { entries: [], unjudged: [] };
  lastList = report.entries;
  return leftOutHtml({ status: lo.status, error: lo.error, older: lo.older, lineups: lo.lineups, entries: report.entries, unjudged: report.unjudged, rows, secondSlate: Boolean(activeSlate(board)) });
}

function repaint() {
  const el = host?.container?.querySelector?.("#sd-left-out");
  if (el && host.board) el.outerHTML = leftOutPanelHtml(host.board);
}

function schedule(wait = delayMs) {
  if (lo.timer) clearTimeout(lo.timer);
  lo.timer = setTimeout(run, wait);
}

async function run() {
  lo.timer = null;
  if (!onCash() || !lo.key) {
    lo.sig = null; // not asked: the next draw on the Cash tab asks again, so the panel never stays on "Finding..."
    return;
  }
  if (opt.generating) return schedule(BUSY_RETRY_MS); // his own Build first
  const seq = ++lo.seq;
  const { key, sig } = lo;
  let data;
  const request = Promise.resolve().then(() => ask(leftOutBody(store.get().board)));
  inFlight = request;
  try {
    data = await request;
  } catch (e) {
    data = { ok: false, error: { message: e?.message ?? String(e) } };
  } finally {
    if (inFlight === request) inFlight = null;
  }
  if (seq !== lo.seq || key !== lo.key || sig !== lo.sig) return; // a newer ask, another slate or other settings: this answer is dropped (that ask has its own)
  if (data?.error?.code === "GENERATE_BUSY") return schedule(BUSY_RETRY_MS);
  if (!data || data.ok === false || data.error || !Array.isArray(data.lineups)) {
    lo.status = "error";
    lo.error = data?.error?.message ?? "the server's answer had no lineups.";
    lo.older = lo.lineups !== null;
  } else {
    lo.lineups = data.lineups;
    lo.basis = data.basis === "median" ? "median" : "proj"; // the Cash build's own basis, which ranks the ways in
    lo.status = "ok";
    lo.error = null;
    lo.older = false;
  }
  repaint();
}

/**
 * Before each draw of the Optimizer (lineup.js renderLineupPanel): on the Cash tab, asks for the optimal lineups again when the slate, the Cash board's figures or the Cash settings changed.
 * `container` (the panel's mount, kept across its redraws) and `commit` (its redraw): an answer repaints the panel in place there, and Swap in is wired on it once.
 */
export function syncLeftOut({ key, board, container = null, commit = () => {} }) {
  host = { container, commit, board };
  wireLeftOut(container);
  if (key !== lo.key) {
    if (lo.timer) clearTimeout(lo.timer);
    Object.assign(lo, { key, sig: null, timer: null, status: null, lineups: null, basis: "proj", error: null, older: false });
    lo.seq++;
  }
  if (!onCash() || !key || !board) return;
  const sig = leftOutSig(key, board);
  if (sig === lo.sig) return;
  lo.sig = sig;
  lo.status = "loading";
  schedule();
}

/** Swap in number `i` of the list on screen: the way in's seats become the Cash tab's working lineup (the men out are never locked, lineup-left-out.js), drawn again through `commit`. */
export function swapIn(i, commit = host?.commit) {
  const e = lastList[Number(i)];
  if (!e?.wayIn || !onCash()) return false;
  state.slots = e.wayIn.seats.map((s, index) => (s ? { id: String(s.id), slot: LINEUP_SLOTS[index] } : null));
  state.addError = null;
  opt.cashUndo = null;
  commit?.();
  return true;
}

const wiredHosts = new WeakSet();
/** One click listener on the mount (its inside is redrawn): a press on Swap in applies that man's way in. */
function wireLeftOut(container) {
  if (!container || typeof container.addEventListener !== "function" || wiredHosts.has(container)) return;
  wiredHosts.add(container);
  container.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("[data-left-out-swap]");
    if (btn) swapIn(btn.dataset.leftOutSwap);
  });
}
