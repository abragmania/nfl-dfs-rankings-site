// The header's Pull now button (Adam 11-06, copied from NBA 179cfd9 and a26ec65, app half): one press runs the unattended cycle on the
// computer the app runs on (server/pullnow/route.js). Shows "Pulling..." and stays disabled while a run is going, whether the press
// started it or the scheduled cycle did. Beside it, NBA's freshness tag (NBA b430e7c board/pull-now.js freshnessOf; PROJECT.md Part 4 Monday 11-23
// item 3): green when current, amber or red when not, the reason its hover; the button's outline turns amber or red with it.
// On the public site the button keeps its place disabled with the sentence that it runs in the app (D71; site-src/api.js answers site: true).
import { getPullStatus, postPullNow } from "./api.js";
import { localStamp, escapeHtml } from "./format.js";
import { store } from "./state.js";

export const POLL_IDLE_MS = 30_000;
export const POLL_RUNNING_MS = 5_000;

// NBA's rule (freshnessOf): the age limits bite only from 2 hours before the slate's first kickoff on (NBA: first tip); 30 to 60 minutes is amber, over 60 red.
export const FRESH_WINDOW_MS = 2 * 3_600_000;
export const FRESH_AMBER_MS = 30 * 60_000;
export const FRESH_RED_MS = 60 * 60_000;
const FRESH_REASON_MAX = 60;

/** The earliest kickoff among `games` as an instant (the stored kickoffUtc, as stamps.js lockStamp reads it; D30), or null when none can be read. Pure. */
export function firstKickoffMsOf(games) {
  const t = (Array.isArray(games) ? games : []).map((g) => Date.parse(g?.kickoffUtc)).filter(Number.isFinite);
  return t.length ? Math.min(...t) : null;
}

/** An age as words: "just now", "3 min ago", "1 h 20 min ago" (NBA's ageWords). Pure. */
export function ageWords(ms) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h} h${r ? ` ${r} min` : ""} ago`;
}

const shortReason = (t) => { const x = String(t ?? "").replace(/\s+/g, " ").trim().replace(/\.+$/, ""); const c = x.charAt(0).toUpperCase() + x.slice(1); return c.length > FRESH_REASON_MAX ? `${c.slice(0, FRESH_REASON_MAX - 1).trimEnd()}…` : c; };

function stampOf(ms, withDay) {
  const t = localStamp(new Date(ms).toISOString());
  return t ? `${withDay ? `${t.monthDay} ` : ""}${t.clock}` : "an unknown time";
}

/**
 * The words for a status answer: { label, disabled, info, title, site, level }. level (NBA's freshness tag): "green" | "amber" | "red" for a known last pull,
 * "busy" while one runs, "unk" when the status or the last pull is unknown, "" on the site. Red: the last pull had problems, or it is over 60 min old from
 * 2 hours before the first kickoff on; amber: 30 to 60 min old in that window; green otherwise. clock: { nowMs, firstKickoffMs } (null: no age limit). Pure.
 */
export function pullView(status, { nowMs = Date.now(), firstKickoffMs = null } = {}) {
  if (status?.site) return { label: "Pull now", disabled: true, info: "", title: status.sentence ?? "Pulling runs in the app.", site: true, level: "" };
  if (status?.running) {
    const by = status.running.by === "cycle" ? "The scheduled update is running." : "A pull is running.";
    return { label: "Pulling…", disabled: true, info: "Pulling… don't press", title: by, site: false, level: "busy" };
  }
  const last = status?.last;
  const idle = { label: "Pull now", disabled: false, site: false };
  if (status?.skippedBusyMs && (!last || status.skippedBusyMs > last.atMs)) return { ...idle, info: "Press skipped: the scheduled update was running", title: "A press found the update cycle already running, so it did not start a second one.", level: "unk" };
  if (!last) return { ...idle, info: "Last pull unknown", title: status?.lastWhy ?? "Runs the TwoGun pulls, a refresh, the save and the site publish.", level: "unk" };
  const age = Math.max(0, nowMs - last.atMs), ageW = ageWords(age);
  const detail = `Last pull ${stampOf(last.atMs, true)} ET (${ageW}): ${last.result === "ok" ? "ok" : "problems"}`;
  const mk = (level, info, why) => ({ ...idle, info, title: [why, detail].filter(Boolean).join(". "), level });
  if (last.result !== "ok") return mk("red", `Pull had a problem: ${shortReason(last.reason ?? "no reason given")}`, last.reason ? `Pull had a problem: ${String(last.reason).replace(/\s+/g, " ").trim()}` : null);
  const inWindow = Number.isFinite(firstKickoffMs) && nowMs >= firstKickoffMs - FRESH_WINDOW_MS;
  if (inWindow && age > FRESH_RED_MS) return mk("red", `Stale: last pull ${ageW}`, "More than 60 minutes since the last pull, and the first kickoff is within 2 hours");
  if (inWindow && age >= FRESH_AMBER_MS) return mk("amber", `Pulled ${ageW}: press Pull now`, "30 to 60 minutes since the last pull, and the first kickoff is within 2 hours");
  return mk("green", `Up to date · pulled ${stampOf(last.atMs, age >= 24 * 3_600_000)} (${ageW})`, null);
}

/** The status shape for a press that failed or was refused: the reason on the hover, the button free again. Pure. */
export function pressFailedView(answer, error) {
  if (answer?.state === "busy") return pullView({ running: { by: answer.by } });
  if (error) return { label: "Pull now", disabled: false, info: "Pull unknown", title: `The request did not get an answer (${error.message}); whether the pull started is not known, check the status before pressing again.`, site: false, level: "unk" };
  const reason = answer?.reason ?? answer?.error?.message ?? "no reason given";
  return { label: "Pull now", disabled: false, info: `Pull ${answer?.state === "unknown" ? "unknown" : "problems"}`, title: reason, site: false, level: answer?.state === "unknown" ? "unk" : "red" };
}

/** The tag's markup beside the button: NBA's dot and words; "" with nothing to say. Pure. */
export function pullTagHtml(v) {
  return v.info ? `<i class="pndot"></i><span class="pntext">${escapeHtml(v.info)}</span>` : "";
}

/** Wires the button. els: { btn, infoEl }. api: { getStatus, post, now, firstKickoffMs } (the real ones unless a test injects). Returns { refresh, stop }. */
export function wirePullNow({ btn, infoEl }, { getStatus = getPullStatus, post = postPullNow, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now, firstKickoffMs = () => firstKickoffMsOf(store.get().board?.games) } = {}) {
  if (!btn) return { refresh: async () => {}, stop() {} };
  let timer = null, pressing = false, stopped = false;
  const paint = (v) => {
    btn.textContent = v.label;
    btn.disabled = v.disabled;
    btn.title = v.title;
    btn.classList.toggle("site-app-only", v.site);
    btn.classList.toggle("fa", v.level === "amber");
    btn.classList.toggle("fr", v.level === "red");
    if (infoEl) {
      infoEl.innerHTML = pullTagHtml(v);
      infoEl.title = v.title;
      for (const l of ["green", "amber", "red", "busy", "unk"]) infoEl.classList.toggle(`f${l}`, v.level === l);
      infoEl.classList.toggle("pn-tag", Boolean(v.info));
    }
  };
  const clock = () => ({ nowMs: now(), firstKickoffMs: firstKickoffMs() });
  const refresh = async () => {
    clearTimer(timer);
    let v;
    try { v = pullView(await getStatus(), clock()); } catch (e) { v = { label: "Pull now", disabled: pressing, info: "Pull status unknown", title: `The pull status could not be read (${e.message})`, site: false, level: "unk" }; }
    if (pressing) v = { ...v, label: "Pulling…", disabled: true, info: "Pulling… don't press", level: "busy" };
    paint(v);
    if (!stopped && !v.site) timer = setTimer(refresh, v.disabled ? POLL_RUNNING_MS : POLL_IDLE_MS);
  };
  btn.addEventListener("click", async () => {
    if (btn.disabled || pressing) return;
    pressing = true;
    paint({ label: "Pulling…", disabled: true, info: "Pulling… don't press", title: "A pull is running.", site: false, level: "busy" });
    let answer = null, error = null;
    try { answer = await post(); } catch (e) { error = e; } // never retried: an unclear end is "unknown" (the route says it)
    pressing = false;
    if (answer?.state === "busy") return paint(pressFailedView(answer));
    if (error || !answer?.ok) paint(pressFailedView(answer, error)); // an answer that never came is "unknown", not "problems"
    else await refresh();
  });
  refresh();
  return { refresh, stop() { stopped = true; clearTimer(timer); } };
}
