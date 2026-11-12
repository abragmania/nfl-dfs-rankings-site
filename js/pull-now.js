// The header's Pull now button (Adam 11-06, copied from NBA 179cfd9 and a26ec65, app half): one press runs the unattended cycle on the
// computer the app runs on (server/pullnow/route.js). Shows "Pulling..." and stays disabled while a run is going, whether the press
// started it or the scheduled cycle did, then the last pull's time (Eastern) and result beside the button; the reason is its hover.
// On the public site the button keeps its place disabled with the sentence that it runs in the app (D71; site-src/api.js answers site: true).
import { getPullStatus, postPullNow } from "./api.js";
import { localStamp } from "./format.js";

export const POLL_IDLE_MS = 30_000;
export const POLL_RUNNING_MS = 5_000;

/** The words for a status answer: { label, disabled, info, title, site }. Pure. */
export function pullView(status) {
  if (status?.site) return { label: "Pull now", disabled: true, info: "", title: status.sentence ?? "Pulling runs in the app.", site: true };
  if (status?.running) {
    const by = status.running.by === "cycle" ? "The scheduled update is running." : "A pull is running.";
    return { label: "Pulling…", disabled: true, info: "", title: by, site: false };
  }
  const last = status?.last;
  const idle = { label: "Pull now", disabled: false, site: false };
  if (status?.skippedBusyMs && (!last || status.skippedBusyMs > last.atMs)) return { ...idle, info: "Press skipped: the scheduled update was running", title: "A press found the update cycle already running, so it did not start a second one." };
  if (!last) return { ...idle, info: "", title: status?.lastWhy ?? "Runs the TwoGun pulls, a refresh, the save and the site publish." };
  const t = localStamp(new Date(last.atMs).toISOString());
  const when = t ? `${t.monthDay} ${t.clock} ET` : "time unknown";
  return { ...idle, info: `Last pull ${when}: ${last.result === "ok" ? "ok" : "problems"}`, title: last.reason ?? "The last pull finished without problems." };
}

/** The status shape for a press that failed or was refused: the reason on the hover, the button free again. Pure. */
export function pressFailedView(answer, error) {
  if (answer?.state === "busy") return pullView({ running: { by: answer.by } });
  if (error) return { label: "Pull now", disabled: false, info: "Pull unknown", title: `The request did not get an answer (${error.message}); whether the pull started is not known, check the status before pressing again.`, site: false };
  const reason = answer?.reason ?? answer?.error?.message ?? "no reason given";
  return { label: "Pull now", disabled: false, info: `Pull ${answer?.state === "unknown" ? "unknown" : "problems"}`, title: reason, site: false };
}

/** Wires the button. els: { btn, infoEl }. api: { getStatus, post } (the real ones unless a test injects). Returns { refresh, stop }. */
export function wirePullNow({ btn, infoEl }, { getStatus = getPullStatus, post = postPullNow, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!btn) return { refresh: async () => {}, stop() {} };
  let timer = null, pressing = false, stopped = false;
  const paint = (v) => {
    btn.textContent = v.label;
    btn.disabled = v.disabled;
    btn.title = v.title;
    btn.classList.toggle("site-app-only", v.site);
    if (infoEl) { infoEl.textContent = v.info; infoEl.title = v.title; }
  };
  const refresh = async () => {
    clearTimer(timer);
    let v;
    try { v = pullView(await getStatus()); } catch (e) { v = { label: "Pull now", disabled: pressing, info: "Pull status unknown", title: `The pull status could not be read (${e.message})`, site: false }; }
    if (pressing) v = { ...v, label: "Pulling…", disabled: true };
    paint(v);
    if (!stopped && !v.site) timer = setTimer(refresh, v.disabled ? POLL_RUNNING_MS : POLL_IDLE_MS);
  };
  btn.addEventListener("click", async () => {
    if (btn.disabled || pressing) return;
    pressing = true;
    paint({ label: "Pulling…", disabled: true, info: "", title: "A pull is running.", site: false });
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
