// Showdown Lineup Builder: the uniqueness swaps, a full-width section below the two columns (Adam 2026-10-18: "show the
// tradeoffs for uniqueness....like replace this guy with another guy and X more unique.....comes with projection tradeoff").
// When the meter has a complete lineup it asks POST /api/showdown/<key>/lineup/swaps once (same body as the meter's, so it
// follows the TwoGun / Our sources switch) and lists, in a grid of seat cards, the first three swaps of each seat's frontier
// (no other swap is both more unique and higher projected; highest projection first) with a "Show all N" button for the rest.
// Each swap is one line of aligned columns: the man in with his position and team chips, how many times more (or less)
// unique, the expected copies before and after, the points change, the salary change and chips (a game-script tag, a man not
// on TwoGun's board); the seat's best-projection swap is the last card. Nothing is hidden by a tag. Pure helpers are exported
// for tests; lineup.js calls syncSwaps (before a draw), swapsPanelHtml (inside the draw) and wireSwaps (after it).
import { escapeHtml, money, dec1 } from "../format.js";
import { sigFig2, copiesText, meterRequestBody, meterState, lineupSig, NOT_ON_BOARD_WORDS } from "./lineup-meter.js";
import { posPillHtml } from "./table.js";
import { teamChipHtml } from "../player-row.js"; // the coloured team chip the six slots and both lists wear

const MINUS = "−";
const DELAY_MS = 250; // after the meter's own pause, so a quick run of clicks asks once
const SUBTITLE_HOVER = "Each seat lists its trades that no other swap beats on both uniqueness and projection (a swap is dropped when another for the same seat is at least as unique and at least as high projected, one strictly), highest projection first.";

// ---------- pure helpers ----------

/**
 * "3.1× more unique", "1.4× less unique", "no copies expected" (zero copies); null when the swap has no ratio. A ratio under
 * 1.1 has two decimals ("1.03× more unique"), since every listed swap has strictly fewer copies and "same uniqueness" is
 * kept only for a ratio that rounds to 1.00.
 */
export function foldText(swap) {
  if (!swap) return null;
  if (swap.zeroCopies) return "no copies expected";
  const f = swap.fold;
  if (typeof f !== "number" || !Number.isFinite(f) || f <= 0) return null;
  const r = f >= 1 ? f : 1 / f;
  const word = f >= 1 ? "more" : "less";
  if (r < 1.1) {
    const t = r.toFixed(2);
    return t === "1.00" ? "same uniqueness" : `${t}× ${word} unique`;
  }
  return `${sigFig2(r)}× ${word} unique`;
}

/** "4.1 → 1.3 copies" from the server's unrounded copies, written as the meter writes them. */
export function copiesChangeText(swap) {
  const a = copiesText(swap?.copiesBefore);
  const b = copiesText(swap?.copiesAfter);
  return a === null || b === null ? null : `${a} → ${b} copies`;
}

/** "−2.4 pts" / "+1.2 pts" with a real minus sign; "0.0 pts" at zero (short, so the figures column stays one width); null when missing. */
export function projChangeText(pts) {
  if (typeof pts !== "number" || !Number.isFinite(pts)) return null;
  const abs = dec1(Math.abs(pts));
  if (abs === "0.0") return "0.0 pts";
  return `${pts < 0 ? MINUS : "+"}${abs} pts`;
}

/** "−$800" / "+$1,200" / "$0" (a zero change, so the column keeps one shape); null when missing. */
export function salaryChangeText(d) {
  if (typeof d !== "number" || !Number.isFinite(d)) return null;
  if (d === 0) return "$0";
  return `${d < 0 ? MINUS : "+"}${money(Math.abs(d))}`;
}

const slotLabel = (seat) => (seat === "CPT" ? "CPT" : "FLEX"); // the six slots' own labels

/** The lineup's own game-script line (information only), or null when no rule applies to its Captain. The names are in scriptTitle (hover). */
export function scriptText(script) {
  if (!script) return null;
  const n = Array.isArray(script.partners) ? script.partners.length : 0;
  if (script.rule === "qb") return script.broken || n === 0 ? "QB Captain with none of his receivers" : `QB Captain with ${n} of his receivers`;
  return script.broken ? "Receiver Captain without his QB" : "Receiver Captain with his QB";
}

/** The hover for the game-script line: the partners' names, or what a missing partner means; null when no rule applies. */
export function scriptTitle(script) {
  if (!script) return null;
  const names = Array.isArray(script.partners) ? script.partners.join(", ") : "";
  if (script.rule === "qb") return script.broken || !names ? "A QB Captain's story needs one of his own WR or TE in the lineup; none is placed" : `His receivers in the lineup: ${names}`;
  return script.broken ? "A WR or TE Captain's story needs his own QB in the lineup; he is not placed" : `His QB in the lineup: ${names}`;
}

/** A man as the panel shows him: position chip, name, team chip, and his injury status when he has one. */
function manHtml(m) {
  const state = m.status ? `<span class="sd-swaps-state">${escapeHtml(m.status)}</span>` : "";
  return `${posPillHtml(m.pos)}<b class="sd-swaps-name">${escapeHtml(m.name)}</b>${teamChipHtml(m.team)}${state}`;
}

/**
 * A man's ownership in words: "12% own", "(not on TwoGun's board, 0%)" for a man TwoGun's board has no row for (Q8: counted
 * at 0% and said so, in the slots' own words), "no ownership" when there is none (never a 0). `tail` follows the figure only.
 */
export function ownWords(m, tail = "") {
  if (m?.notOnBoard) return `(${NOT_ON_BOARD_WORDS})`;
  return typeof m?.ownPct === "number" && Number.isFinite(m.ownPct) ? `${m.ownPct}% own${tail}` : "no ownership";
}

/** A tag's chip text: the server's sentence without its bracketed reason and the Captain's name for it ("breaks story"); the whole sentence is the chip's hover. */
export function tagChipText(tag) {
  return String(tag).replace(/\s*\([^)]*\)\s*$/, "").replace(" the Captain's", "");
}

/**
 * One swap, one line of aligned columns (the seat card's grid gives each its width): the man in (→, position chip, name,
 * team chip), how many times more or less unique, the expected copies before and after, the points change, the salary
 * change, then chips: the Captain-story tag, and "not on TwoGun's board, 0%" for a man TwoGun's board has no row for (Q8).
 * The man out is the seat's head above; his figures are in the row's hover.
 */
function swapRowHtml(w) {
  const inn = w.in;
  const fold = foldText(w);
  const copies = copiesChangeText(w);
  const pts = projChangeText(w.projChange);
  const sal = salaryChangeText(w.salaryChange);
  const title = `${inn.name}: ${money(inn.salary)}, ${dec1(inn.proj)} proj, ${ownWords(inn, " in this seat")}; ${w.out.name}: ${money(w.out.salary)}, ${dec1(w.out.proj)} proj, ${ownWords(w.out)}`;
  const gain = typeof w.projChange === "number" && w.projChange >= 0.05 ? " sd-swaps-gain" : "";
  const chips = (w.tag ? `<span class="sd-swaps-tag" title="${escapeHtml(w.tag)}">${escapeHtml(tagChipText(w.tag))}</span>` : "")
    + (inn.notOnBoard ? `<span class="sd-swaps-tag sd-swaps-off" title="${escapeHtml(`${inn.name}: ${NOT_ON_BOARD_WORDS}`)}">${escapeHtml(NOT_ON_BOARD_WORDS)}</span>` : "");
  return `<div class="sd-swaps-row" title="${escapeHtml(title)}"><span class="sd-swaps-in"><span class="sd-swaps-arrow" aria-hidden="true">→</span>${manHtml(inn)}</span>`
    + `<span class="sd-swaps-fold">${fold ? escapeHtml(fold) : ""}</span>`
    + `<span class="sd-swaps-copies">${copies ? escapeHtml(copies) : ""}</span>`
    + `<span class="sd-swaps-pts${gain}">${pts ? escapeHtml(pts) : ""}</span>`
    + `<span class="sd-swaps-sal">${sal ? escapeHtml(sal) : ""}</span>`
    + `<span class="sd-swaps-tags">${chips}</span></div>`;
}

/** A seat's head: its slot (CPT in gold), the man being replaced with his chips, and his projection and ownership in this seat. */
function seatHeadHtml(s) {
  const m = s.man;
  const own = m.notOnBoard || typeof m.ownPct === "number" ? ownWords(m) : "";
  const proj = typeof m.proj === "number" ? `${dec1(m.proj)} proj` : "";
  const figs = [proj, own].filter(Boolean).join(" · ");
  const title = `${m.name}: ${money(m.salary)} in this seat${s.legal !== undefined ? `; ${s.legal} legal swaps for this seat` : ""}`;
  return `<div class="sd-swaps-seat-head" title="${escapeHtml(title)}"><span class="sd-swaps-slot${s.seat === "CPT" ? " sd-swaps-slot-cpt" : ""}">${slotLabel(s.seat)}</span>`
    + `<span class="sd-swaps-in">${manHtml(m)}</span><span class="sd-swaps-seat-figs">${escapeHtml(figs)}</span></div>`;
}

/** What was left out and why, in one line (the names are on hover); "" when nothing was. */
function skippedHtml(skipped) {
  const parts = [];
  const add = (list, text) => {
    if (Array.isArray(list) && list.length) parts.push(`<span title="${escapeHtml(list.join(", "))}">${list.length} ${text}</span>`);
  };
  add(skipped?.noCaptainOwnership, "with no Captain ownership"); // a man's Captain and FLEX ownership are separate figures (D29), listed apart
  add(skipped?.noFlexOwnership, "with no FLEX ownership");
  add(skipped?.notRosterable, "projected 0 or not at all");
  return parts.length ? `<div class="sd-swaps-line">Not offered: ${parts.join(", ")}</div>` : "";
}

/**
 * The panel's inner html for one answer of the swaps route (`d`), or the words saying why there are no swaps. `open` is the
 * set of seat positions (0 to 5) whose whole frontier is shown; any other seat shows its first few and a "Show all N" button.
 */
export function swapsBodyHtml(d, { open = new Set() } = {}) {
  if (d.available === false) return `<div class="sd-meter-none">${escapeHtml(d.message || "Swaps are not available for this lineup.")}</div>`;
  const seats = (d.seats ?? []).map((s, i) => {
    const more = Array.isArray(s.more) ? s.more : [];
    const expanded = open.has(i);
    const shown = expanded ? [...s.swaps, ...more] : s.swaps;
    const rows = s.swaps.length
      ? shown.map((w) => swapRowHtml(w)).join("")
      : `<div class="sd-meter-none sd-swaps-empty">${s.legal === 0 ? "No legal swap for this seat." : "No legal swap here makes the lineup more unique."}</div>`;
    const toggle = more.length
      ? `<button type="button" class="sd-swaps-more" data-swaps-toggle="${i}" aria-expanded="${expanded}">${expanded ? `Show top ${s.swaps.length}` : `Show all ${s.swaps.length + more.length}`}</button>`
      : "";
    return `<div class="sd-swaps-seat">${seatHeadHtml(s)}${rows}${toggle}</div>`;
  }).join("");
  const b = d.bestProjection;
  const best = b
    ? `<div class="sd-swaps-seat"><div class="sd-swaps-seat-head"><b class="sd-swaps-best">Most projection gained</b><span class="sd-swaps-seat-figs">replaces ${slotLabel(b.seat)} ${escapeHtml(b.out.name)}</span></div>${swapRowHtml(b)}</div>`
    : `<div class="sd-swaps-seat"><div class="sd-meter-none sd-swaps-empty">No single swap raises this lineup's projection.</div></div>`;
  const script = scriptText(d.before?.script);
  const scriptHover = scriptTitle(d.before?.script);
  return `${script ? `<div class="sd-swaps-line"${scriptHover ? ` title="${escapeHtml(scriptHover)}"` : ""}>Game script: ${escapeHtml(script)}</div>` : ""}<div class="sd-swaps-grid">${seats}${best}</div>${skippedHtml(d.skipped)}`;
}

/** The whole panel for one state ({status: "loading"|"error"|"ok", data, message}); "" when no state (no complete lineup). */
export function swapsHtml(st, opts = {}) {
  if (!st || !st.status) return "";
  const head = `<div class="sd-swaps-title" title="${escapeHtml(SUBTITLE_HOVER)}"><b>Swaps</b> <span class="sd-swaps-sub">Best trades per seat, highest projection first</span></div>`;
  let body;
  if (st.status === "loading") body = `<div class="sd-meter-none">Working out swaps…</div>`;
  else if (st.status === "error") body = `<div class="sd-meter-error">${escapeHtml(st.message || "Could not work out the swaps.")}</div>`;
  else body = swapsBodyHtml(st.data, { open: opts.open ?? st.open ?? new Set() });
  return `<div class="sd-swaps" aria-live="polite">${head}${body}</div>`; // not .sd-meter: the meter's repaint looks that class up, and the box look is shared in the stylesheet
}

/** The request body: the meter's, for the same lineup and mode. Null until all six are placed and on the board. */
export function swapsRequestBody(board, cpt, flex, mode = "twogun") {
  return meterRequestBody(board, cpt, flex, mode);
}

// ---------- the fetch, kept here beside the panel (api.js's names are the public site's stand-in contract) ----------

/** POST /api/showdown/<key>/lineup/swaps; resolves to the parsed answer, never throws for a server-side refusal. */
export async function postLineupSwaps(key, body, fetchImpl = fetch) {
  const url = `/api/showdown/${encodeURIComponent(key)}/lineup/swaps`;
  const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`${url} did not return JSON (status ${res.status})`);
  }
}

// ---------- state and trigger ----------

const st = { sig: null, status: null, data: null, message: null, timer: null, open: new Set() }; // open: the seats (0 to 5) showing their whole frontier
let last = null; // the last syncSwaps arguments, so a flip of the meter's switch asks again without a panel draw
const wired = new WeakSet();

function reset() {
  if (st.timer) clearTimeout(st.timer);
  st.timer = null;
  st.sig = null;
  st.status = null;
  st.data = null;
  st.message = null;
  st.open = new Set(); // another lineup or mode: every seat starts at its first three
}

/** Test hook: the current state. */
export function swapsState() {
  return { sig: st.sig, status: st.status, data: st.data, message: st.message, open: [...st.open] };
}

/** The panel's current html (call inside the panel draw, right after the meter strip and after syncSwaps). */
export function swapsPanelHtml() {
  return swapsHtml(st, { open: st.open });
}

/** Repaints the swaps panel alone: the six slots, the meter strip and a typed lineup name are not touched. */
function repaint() {
  const el = last?.container?.querySelector?.(".sd-swaps");
  if (el) el.outerHTML = swapsPanelHtml();
}

/**
 * Called before every panel draw (after syncMeter). The swaps follow the meter: they exist only while it has a complete
 * live lineup (`enabled`, which is false on the published site and in sample mode, where the meter itself is off). A lineup,
 * board or mode that differs from the one last asked about shows "working out" and sends one request after a short pause;
 * an answer for a lineup that has since changed is dropped.
 */
export function syncSwaps({ board, key, cpt, flex, container = null, post = postLineupSwaps, delayMs = DELAY_MS, enabled = meterState().sig !== null, mode = meterState().mode }) {
  last = { board, key, cpt, flex, container, post, delayMs, enabled, mode };
  const body = enabled && key ? swapsRequestBody(board, cpt, flex, mode) : null;
  if (!body) {
    if (st.sig !== null || st.status !== null) reset();
    return;
  }
  const sig = lineupSig(key, board, body, cpt, flex); // the meter's own signature: a typed number that changes a placed man's figures re-asks both
  if (sig === st.sig) return;
  reset();
  st.sig = sig;
  st.status = "loading";
  st.timer = setTimeout(async () => {
    st.timer = null;
    let next;
    try {
      const data = await post(key, body);
      if (!data || typeof data !== "object") next = { status: "error", message: "The server's answer could not be read." };
      else if (data.error) next = { status: "error", message: data.error.message || "Could not work out the swaps." };
      else next = { status: "ok", data };
    } catch (e) {
      next = { status: "error", message: `Could not reach the server: ${e.message}` };
    }
    if (st.sig !== sig) return; // the lineup (or the mode) changed while this was out
    st.status = next.status;
    st.data = next.data ?? null;
    st.message = next.message ?? null;
    repaint();
  }, delayMs);
}

/**
 * After a panel draw: a click on a seat's "Show all N" / "Show top 3" button opens or closes that seat's whole frontier (the
 * panel alone is repainted); a click on the meter's TwoGun / Our sources switch (its own handler runs first and repaints only
 * its strip) asks the swaps again for the new mode. One listener per panel element, however often the panel is redrawn.
 */
export function wireSwaps(container) {
  if (!container?.addEventListener || wired.has(container)) return;
  wired.add(container);
  container.addEventListener("click", (e) => {
    const toggle = e.target?.closest?.("[data-swaps-toggle]");
    if (toggle && last) {
      const seat = Number(toggle.dataset?.swapsToggle);
      if (Number.isInteger(seat)) {
        if (st.open.has(seat)) st.open.delete(seat);
        else st.open.add(seat);
        repaint();
      }
      return;
    }
    if (!last || !e.target?.closest?.("[data-meter-mode]")) return;
    syncSwaps({ ...last, mode: meterState().mode, enabled: meterState().sig !== null });
    repaint();
  });
}
