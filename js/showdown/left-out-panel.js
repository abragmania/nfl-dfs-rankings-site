// The Cash tab's `Left out` panel (optimizer standard Part F, the Left out row; Adam 1:46 PM 2026-11-03: one to three men only, in the optimal lineups the engine builds and heavily
// owned). Showdown only: its Captain and FLEX seats keep Showdown's own rules and prices, and nothing here reaches classic (Adam 2:16 PM 2026-11-05).
// The optimal lineups come from a quiet Cash build through the generate call (the public site's stand-in answers it in the browser): mode cash, ten lineups, the Cash tab's
// padlocks only (never the held seats, left-out.js), its excludes and Max per team; minimum unique is the Cash build's own 1 (the route refuses it on Cash, so none is sent).
// The ways in are ranked and priced on that build's own basis (its answer's `basis`: TwoGun's median in TwoGun mode, else the projection).
// It runs on the Cash tab only, again when the Cash tab's figures, padlocks, excludes or Max per team change, after a pause, the latest asked winning and an older answer dropped;
// a Build of his always goes first (optimizer.js setQuietBuildHook). It is never a build on screen: it never touches the tab's results, notices, Lineups or saved lineups. The list
// itself (left-out.js leftOutReport) is worked out at each draw from the seats on screen, so a click in the lineup moves it at once without asking again.
import { escapeHtml, money, dec1, pct1 } from "../format.js";
import { leftOutReport } from "./left-out.js";
import { state } from "./seats.js";
import { optimizerLive, optimizerState, postShowdownGenerate, setQuietBuildHook } from "./optimizer.js";
import { requestFailureText } from "./read-json.js";
import { posPillHtml } from "./table.js";
import { SALARY_CAP } from "./lineup-saved.js";

export const LEFT_OUT_COUNT = 10; // the quiet build's lineups: the optimal set the panel reads
const DELAY_MS = 600; // a run of padlock, exclude or typed-number clicks asks once
const BUSY_RETRY_MS = 1500; // a Build of his is running: ask again after it, never in its place
const MINUS = "−";
export const NOBODY_TEXT = "Nobody heavily owned is missing from your lineup.";

const lo = { key: null, sig: null, seq: 0, timer: null, status: null, lineups: null, basis: "proj", error: null, older: false };
let ask = (key, body) => postShowdownGenerate(key, body);
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

const onCash = () => optimizerLive() && optimizerState().ks?.mode === "cash";
const cashSettings = () => optimizerState().ks?.cash ?? { locks: [], excludes: [], maxPerTeam: "5" };

/** A Build is starting: the pending quiet ask is cancelled (asked again at the next draw) and one in flight is waited for. Resolves true when one was out, else false. */
export async function settleQuietBuild() {
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
setQuietBuildHook(settleQuietBuild);

/** The quiet build's body: the Cash tab's padlocks (never the seated men), excludes and Max per team, ten lineups. Pure. */
export function leftOutBody(ms) {
  const team = Number(ms?.maxPerTeam);
  return { settings: { mode: "cash", count: LEFT_OUT_COUNT, locks: [...(ms?.locks ?? [])], excludes: [...(ms?.excludes ?? [])], maxPerTeam: [3, 4, 5].includes(team) ? team : 5 } };
}

/** What the optimal lineups depend on: the game, the Cash board's figures (its figures key, else its build time) and the settings the body sends. Pure. */
export function leftOutSig(key, board, ms) {
  return JSON.stringify([key, board?.figures?.key ?? null, board?.generatedAt ?? null, leftOutBody(ms).settings]);
}

/** "−1.2 proj" / "+0.4 median" with a real minus sign, named by the Cash build's basis. Pure. */
function changeText(n, basis) {
  const word = basis === "median" ? "median" : "proj";
  const abs = dec1(Math.abs(n));
  return abs === "0.0" ? `0.0 ${word}` : `${n < 0 ? MINUS : "+"}${abs} ${word}`;
}

/** Salary left once `seats` ({cpt, flex}) are the lineup, the Captain at his Captain price; null when a seated man is not on the board. Pure. */
export function salaryLeftOf(rows, seats) {
  const rowOf = new Map((rows ?? []).map((r) => [String(r.id), r]));
  let used = 0;
  for (const [seat, cpt] of [[seats?.cpt, true], ...(seats?.flex ?? []).map((s) => [s, false])]) {
    if (!seat) continue;
    const row = rowOf.get(String(seat.id));
    const price = row ? (cpt ? row.cptSalary : row.salary) : null;
    if (typeof price !== "number" || !Number.isFinite(price)) return null;
    used += price;
  }
  return SALARY_CAP - used;
}

const seatOf = (m) => `${m.name} (${m.seat})`;

/** The cheapest legal way in for the man `id`, written plainly (text, not markup): "Swap out Jakobi Meyers (FLEX): −1.2 proj, $400 left", the change on the build's basis. Pure. */
export function wayInText(wayIn, left, id) {
  const him = wayIn.in.find((m) => String(m.id) === String(id)) ?? wayIn.in[0];
  const asCpt = him?.seat === "CPT" ? " (him as CPT)" : "";
  const tail = `${changeText(wayIn.change ?? wayIn.projChange, wayIn.basis)}, ${left === null ? "salary left unknown" : `${money(left)} left`}`;
  if (wayIn.kind === "add") return `Add him at ${him?.seat ?? "FLEX"}: ${tail}`;
  if (wayIn.kind === "one-for-one") return `Swap out ${seatOf(wayIn.out[0])}${asCpt}: ${tail}`;
  const second = wayIn.in.find((m) => m !== him);
  return `Swap out ${wayIn.out.map(seatOf).join(" and ")}${asCpt}${second ? `, ${seatOf(second)} in too` : ""}: ${tail}`;
}

/** The field sentence: his FLEX and Captain ownership added, or, with one seat's not posted, the posted one as a floor that names the seat missing. Pure. */
export function fieldText(e) {
  if (!e.missingOwn) return `${pct1(e.fieldOwn)} of the field has him; you do not`;
  const seat = e.missingOwn === "CPT" ? "Captain" : "FLEX";
  return `At least ${pct1(e.fieldOwn)} of the field has him (${seat} ownership not posted); you do not`;
}

/** One man's row: the field sentence, his Own, Proj and Sal at the seat the way in gives him, the way in and Swap in (none, with the reason, when there is no way). */
function rowHtml(e, i, rows) {
  const seat = e.wayIn?.in.find((m) => String(m.id) === String(e.id))?.seat ?? "FLEX";
  const cpt = seat === "CPT";
  const fig = (label, text) => `<span class="sd-lo-fig"><i>${cpt ? "CPT " : ""}${label}</i><b>${text ?? "—"}</b></span>`;
  const figs = fig("Own", pct1(cpt ? e.ownCpt : e.ownFlex)) + fig("Proj", dec1(cpt ? e.cptProj : e.proj)) + fig("Sal", money(cpt ? e.cptSalary : e.salary));
  const wayText = e.wayIn ? escapeHtml(wayInText(e.wayIn, salaryLeftOf(rows, e.wayIn.seats), e.id)) : "";
  const way = e.wayIn
    ? `<span class="sd-lo-way" title="${wayText}">${wayText}</span><button type="button" class="link-btn sd-lo-swap" data-left-out-swap="${i}">Swap in</button>`
    : `<span class="sd-lo-way sd-lo-noway" title="${escapeHtml(e.reason ?? "")}">${escapeHtml(e.reason ?? "")}</span>`;
  const field = fieldText(e);
  const parts = `FLEX ${pct1(e.ownFlex) ?? "not posted"} plus CPT ${pct1(e.ownCpt) ?? "not posted"}`;
  return `<li class="sd-lo-row" data-card-id="${escapeHtml(e.id)}">
      <div class="sd-lo-line">${posPillHtml(e.pos)}<b class="sd-lo-name player-name">${escapeHtml(e.name)}</b><span class="sd-lo-field" title="${escapeHtml(`${field} (${parts})`)}">${escapeHtml(field)}</span><span class="sd-lo-figs">${figs}</span></div>
      <div class="sd-lo-line sd-lo-line2">${way}</div>
    </li>`;
}

/** The panel's body for a view {status, error, older, lineups, entries, unjudged, rows}. Pure. */
export function leftOutHtml(v) {
  const quiet = (text, cls = "") => `<div class="sd-lo-quiet${cls}">${escapeHtml(text)}</div>`;
  let body;
  if (v.lineups === null) body = v.status === "error" ? quiet(`Could not work out who is left out: ${v.error}`, " sd-lo-error") : quiet("Finding the optimal Cash lineups...");
  else {
    const note = v.status === "error" ? quiet(`Could not re-read the optimal Cash lineups: ${v.error} The list is from the earlier read.`, " sd-lo-error") : "";
    const unjudged = v.unjudged ?? [];
    const notJudged = unjudged.length ? quiet(`Not judged, their ownership is not posted: ${unjudged.join(", ")}.`) : "";
    let list;
    if (!v.lineups.length) list = quiet("No optimal Cash lineup could be made with these padlocks and excludes, so nobody is listed.");
    else if (v.entries.length) list = `<ol class="sd-lo-list${v.older ? " is-older" : ""}">${v.entries.map((e, i) => rowHtml(e, i, v.rows)).join("")}</ol>`;
    else list = unjudged.length ? "" : quiet(NOBODY_TEXT); // "nobody" only when every optimal man off the lineup could be judged
    body = note + list + notJudged;
  }
  const sub = v.status === "loading" && v.lineups !== null ? `<span class="sd-lo-sub">updating...</span>` : v.older ? `<span class="sd-lo-sub">older</span>` : "";
  return `<section class="sd-left-out" id="sd-left-out" aria-live="polite"><div class="sd-lo-head"><span class="sd-lo-title">Left out</span>${sub}</div>${body}</section>`;
}

/** The panel for the Cash tab on screen ("" on GPP and off the live app): the last optimal lineups read against the seats on screen. */
export function leftOutPanelHtml(board) {
  if (!onCash()) return "";
  const ms = cashSettings();
  const rows = board?.rows ?? [];
  const report = lo.lineups?.length
    ? leftOutReport({ rows, seats: state, lockedIds: ms.locks, excludedIds: ms.excludes, optimalLineups: lo.lineups, maxPerTeam: ms.maxPerTeam, basis: lo.basis })
    : { entries: [], unjudged: [] };
  lastList = report.entries;
  return leftOutHtml({ status: lo.status, error: lo.error, older: lo.older, lineups: lo.lineups, entries: report.entries, unjudged: report.unjudged, rows });
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
  if (optimizerState().generating) return schedule(BUSY_RETRY_MS); // his own Build first
  const seq = ++lo.seq;
  const { key, sig } = lo;
  let data;
  const request = Promise.resolve().then(() => ask(key, leftOutBody(cashSettings())));
  inFlight = request;
  try {
    data = await request;
  } catch (e) {
    data = { ok: false, error: { message: requestFailureText(e) } };
  } finally {
    if (inFlight === request) inFlight = null;
  }
  if (seq !== lo.seq || key !== lo.key || sig !== lo.sig) return; // a newer ask, another game or other settings: this answer is dropped (that ask has its own)
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
 * Before each draw of the Optimizer (lineup.js): on the Cash tab, asks for the optimal lineups again when the game, the Cash board's figures or the Cash settings changed.
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
  if (!onCash() || !key) return;
  const sig = leftOutSig(key, board, cashSettings());
  if (sig === lo.sig) return;
  lo.sig = sig;
  lo.status = "loading";
  schedule();
}

/** Swap in number `i` of the list on screen: the way in's seats become the Cash tab's working lineup (the men out are never locked, left-out.js), drawn again through `commit`. */
export function swapIn(i, commit = host?.commit) {
  const e = lastList[Number(i)];
  if (!e?.wayIn || !onCash()) return false;
  state.cpt = e.wayIn.seats.cpt ? { id: String(e.wayIn.seats.cpt.id) } : null;
  state.flex = e.wayIn.seats.flex.map((s) => (s ? { id: String(s.id) } : null));
  state.addError = null;
  state.addErrorId = null;
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
