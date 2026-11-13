// Adam 2026-11-12: "I want the ability to mark players in and out". His own In / Out / Auto per man, kept in the overrides
// (server/overrides/merge.js `status`, one copy for the GPP and Cash tabs, as a star), drawn where the status badge sits on the
// classic and Showdown pools (a click cycles it) and as a short "Player status" table on the Sources page (sources-page.js).
// Auto is the sources' word; In clears every out reading (no badge, not hidden, not zeroed); Out hides him and counts him 0.
// Markup, the cycle and the write's wiring only; the writes are the callers' (app.js, showdown/pool-edit-ctx.js, the Sources page).
import { escapeHtml } from "./format.js";
import { rowIsOut, STATUS_INFO } from "./table.js";
import { untagged, twogunCallsOut, inNeedsNumber, TYPE_A_PROJECTION } from "./out.js";

const attr = (v) => escapeHtml(String(v ?? ""));

/** His own setting off the merged row: "in", "out" or null (Auto). */
export function statusSettingOf(row) {
  const s = row?.override?.status;
  return s === "in" || s === "out" ? s : null;
}

/** The row as the sources read him, his own setting taken off. */
const asListed = (row) => (statusSettingOf(row) ? { ...row, override: { ...row.override, status: undefined } } : row);

/** Whether the sources (and a typed number, which always wins) leave him out, his own setting aside. */
export const listedOut = (row) => rowIsOut(asListed(row));

/** The next setting a click on the badge gives: the first click flips what the board does with him (a man listed out goes In, anyone else Out), the second the other way, the third back to Auto. */
export function nextStatus(row) {
  const now = statusSettingOf(row);
  const first = listedOut(row) ? "in" : "out";
  if (now === null) return first;
  if (now === first) return first === "in" ? "out" : "in";
  return null;
}

/** A PUT body for his setting: null is Auto (the entry goes). */
export const statusPatch = (id, next) => ({ status: { [String(id)]: next === "in" || next === "out" ? next : null } });

/** The sources' word for him, in a few words ("Out", "Questionable", "TwoGun: OUT", "Ruled out after TwoGun's board"), or "" when no source lists him. */
export function sourceStatusWord(row) {
  const words = [];
  const add = (w) => { if (w && !words.includes(w)) words.push(w); };
  const label = (raw) => {
    const s = String(raw ?? "").trim();
    return s ? STATUS_INFO[s.toLowerCase()]?.label ?? s : "";
  };
  add(label(row?.status));
  // An outside feed's word that is not what the board carries is only a flag (source order, step 4); it is said so.
  const feed = label(row?.injury?.status);
  add(feed && feed !== label(row?.status) ? `${feed} (${row.injury.source ?? "feed"}, flag only)` : feed);
  if (twogunCallsOut(row) && row?.tg?.call === "OUT") add("TwoGun: OUT");
  if ((row?.flags ?? []).includes("outAfterStamp")) add("Ruled out after TwoGun's board");
  if (!words.length && (row?.flags ?? []).includes("injured")) add("Injured");
  return words.join(" · ");
}

const WORD = { in: "In", out: "Out" };

/** The hover of the badge switch: what he is now and what a click does. */
function switchTitle(row, next) {
  const now = statusSettingOf(row);
  const said = sourceStatusWord(row);
  const why = untagged(row?.injury?.comment ?? "").replace(/[.\s]+$/, ""); // the sentence's own period is added below
  const head = now ? `You marked him ${WORD[now]}${said ? ` (sources: ${said})` : ""}.` : said ? `Listed ${said}${why ? `. ${why}` : ""}. Auto: the sources decide.` : "Auto: no source lists him.";
  const click = next === null ? "Click: back to Auto." : `Click: mark him ${WORD[next]}.`;
  return `${head}${inNeedsNumber(row) ? ` ${TYPE_A_PROJECTION}.` : ""} ${click}`; // In with no number from any source (his In on a TwoGun-OUT man with no figure)
}

/** His own setting as a small pill (IN green, OUT red); "" for Auto. */
export function settingPillHtml(row) {
  const now = statusSettingOf(row);
  return now ? `<span class="st-pill st-pill-${now}">${now === "in" ? "IN" : "OUT"}</span>` : "";
}

/**
 * The status badge as a switch, for a pool row: Auto shows `autoTagHtml` (the sources' badge or OUT tag, as before) or, with none, a faint
 * mark that shows on the row's hover; In and Out show his own pill. A click cycles it (nextStatus). `canWrite` false: the badge or pill only, no button.
 */
export function statusSwitchHtml(row, autoTagHtml = "", { canWrite = true } = {}) {
  const now = statusSettingOf(row);
  const inner = now ? settingPillHtml(row) : autoTagHtml || (canWrite ? `<span class="st-ghost" aria-hidden="true">&#9675;</span>` : "");
  if (!canWrite) return inner;
  const next = nextStatus(row);
  const title = switchTitle(row, next);
  return `<button type="button" class="st-sw st-sw-${now ?? "auto"}" data-action="player-status" data-id="${attr(row?.id)}" data-next="${next ?? "auto"}" title="${attr(title)}" aria-label="${attr(`In or out for ${row?.name ?? "this player"}. ${title}`)}">${inner}</button>`;
}

/**
 * One switch or segment press: the button is held (dimmed, disabled) while `write(id, next)` is out (next "in", "out" or null for Auto);
 * a refusal (the write resolves false or null, or throws) gives the button back and calls onRefused(id). The answered board redraws it.
 */
export function statusSwitchClick(btn, write, onRefused = () => {}) {
  if (!btn || btn.disabled) return Promise.resolve(false);
  const id = btn.dataset.id;
  const raw = btn.dataset.next;
  const next = raw === "in" || raw === "out" ? raw : null;
  btn.disabled = true;
  btn.classList?.add("is-pending");
  const giveBack = () => {
    btn.disabled = false;
    btn.classList?.remove("is-pending");
    onRefused(id);
    return false;
  };
  return Promise.resolve()
    .then(() => write(id, next))
    .then((taken) => (taken === false || taken === null || taken === undefined ? giveBack() : true))
    .catch((e) => {
      console.error("The In / Out setting could not be written:", e);
      return giveBack();
    });
}

/** One listener on `root` for every switch and segment under it (the classic pool's mount, the Sources page's table). */
export function delegateStatusClicks(root, write, onRefused) {
  root?.addEventListener?.("click", (e) => {
    const btn = e.target?.closest?.("[data-action='player-status']");
    if (btn) statusSwitchClick(btn, write, onRefused);
  });
}

// ---------- the Sources page's "Player status" table ----------

const RANK = { out: 0, ir: 0, suspended: 0, doubtful: 1, questionable: 2 };
/** Sort weight: his own settings first, then Out and IR, Doubtful, Questionable, then the rest. */
function weightOf(row) {
  if (statusSettingOf(row)) return -1;
  if (listedOut(row)) return 0;
  const label = String(STATUS_INFO[String(row?.status ?? row?.injury?.status ?? "").trim().toLowerCase()]?.label ?? "").toLowerCase();
  return RANK[label] ?? 3;
}

/** The men the table lists: every man a source marks out, doubtful, questionable or IR (any status word, a TwoGun OUT call, an out flag), plus every man Adam set. One row per man (a Showdown board's row is the man). */
export function playerStatusRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows ?? []) {
    if (!r || r.id == null || seen.has(String(r.id))) continue;
    if (!statusSettingOf(r) && !sourceStatusWord(r)) continue;
    seen.add(String(r.id));
    out.push(r);
  }
  return out.sort((a, b) => weightOf(a) - weightOf(b) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

/** Auto | In | Out as a segmented control (the Sources page's own look), the active one his setting. Plain text when nothing can be written. */
export function statusSegHtml(row, canWrite = true) {
  const now = statusSettingOf(row);
  const opts = [["auto", "Auto"], ["in", "In"], ["out", "Out"]];
  if (!canWrite) return escapeHtml(now ? WORD[now] : "Auto");
  return `<span class="sp-seg st-seg" role="group" aria-label="${attr(`In or out for ${row?.name ?? "this player"}`)}">${opts.map(([v, label]) => {
    const active = (now ?? "auto") === v;
    return `<button type="button" class="sp-seg-btn${active ? " active" : ""}" data-action="player-status" data-id="${attr(row.id)}" data-next="${v}" aria-pressed="${active}"${active ? " disabled" : ""}>${label}</button>`;
  }).join("")}</span>`;
}

/** The "Player status" card: Player, what the sources say, his setting (the switch) and what the board does with him. `canWrite` false: read only. */
export function playerStatusTableHtml(rows, { canWrite = true } = {}) {
  const list = playerStatusRows(rows);
  const mine = list.filter((r) => statusSettingOf(r)).length;
  const head = `<div class="sp-ch"><h3 class="sp-h">Player status</h3><div class="sp-ch-r">${list.length} listed${mine ? `, ${mine} set by you` : ""}</div></div>`;
  if (!list.length) return `<div class="sp-panel sp-status">${head}<p class="sp-note st-none">No source lists anyone out, doubtful, questionable or on IR, and you have set no one.</p></div>`;
  const body = list.map((r) => {
    const counts = rowIsOut(r) ? `<span class="st-counts st-counts-out">Out</span>` : `<span class="st-counts st-counts-in">In</span>`;
    const who = `${escapeHtml(r.name ?? "")} <span class="sp-quiet">${escapeHtml([r.team, r.pos].filter(Boolean).join(" "))}</span>`;
    return `<tr data-id="${attr(r.id)}"><td class="st-c-name">${who}</td><td class="st-c-src">${escapeHtml(sourceStatusWord(r) || "—")}</td><td class="st-c-set">${statusSegHtml(r, canWrite)}</td><td class="st-c-counts">${counts}</td></tr>`;
  }).join("");
  return `<div class="sp-panel sp-status">${head}<div class="st-scroll"><table class="st-table"><thead><tr><th>Player</th><th>Sources say</th><th>Yours</th><th>Counts as</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
