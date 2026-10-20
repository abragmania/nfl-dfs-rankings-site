// The Showdown salary-used page (public/showdown-salary.html; Adam 2026-10-18): pick a slate or "All slates" and see,
// as horizontal bars, how many contest lineups spent exactly $50,000, $49,500 and under, and so on. The figures come
// from GET /api/showdown/salary-used (data/showdown/<key>/salary-used.json, aggregates only). On the public site
// tools/publish.mjs rewrites that one URL in this file to the baked copy, baked/showdown/salary-used.json (D71).
import { escapeHtml } from "../format.js";

const fmt = (n) => n.toLocaleString("en-US");
const pct = (count, total) => (total > 0 ? Math.round((count / total) * 1000) / 10 : 0);

const sameRows = (a, b) => a.rows.length === b.rows.length && a.rows.every((r, i) => r.label === b.rows[i].label);

/**
 * Adds every slate's cumulative counts row by row; percents are of the pooled lineups. Only slates whose row labels match
 * the first slate's, in the same order, are pooled; any other is left out and named in `excluded` (D29: a row a slate does
 * not have is never filled with 0).
 */
export function poolSlates(slates) {
  const first = slates[0];
  const pooled = first ? slates.filter((x) => sameRows(first, x)) : [];
  const excluded = first ? slates.filter((x) => !pooled.includes(x)) : [];
  const lineups = pooled.reduce((s, x) => s + x.lineups, 0);
  const rows = (first?.rows ?? []).map((r, i) => {
    const count = pooled.reduce((s, x) => s + x.rows[i].count, 0);
    return { label: r.label, kind: r.kind, maxSalary: r.maxSalary, count, percent: pct(count, lineups) };
  });
  const part = (x) => ({ key: x.key, game: x.game, date: x.date, contestId: x.contestId, lineups: x.lineups, pricesFromDraftKings: x.pricesFromDraftKings === true });
  return { slateCount: pooled.length, lineups, rows, parts: pooled.map(part), excluded: excluded.map(part) };
}

const slateName = (s) => `${s.game ?? s.key}${s.date ? ` ${s.date}` : ""}`;

/** One slate's bars: label, bar, count, percent. The widest bar is the largest count, so the shape reads at a glance. */
export function barsHtml(rows) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return rows
    .map(
      (r) =>
        `<div class="su-row${r.kind === "exact" || r.kind === "band" ? " su-exact" : ""}"><span class="su-label">${escapeHtml(r.label)}</span>` +
        `<span class="su-track"><span class="su-bar" style="width:${((r.count / max) * 100).toFixed(2)}%"></span></span>` +
        `<span class="su-count">${fmt(r.count)}</span><span class="su-pct">${r.percent.toFixed(1)}%</span></div>`
    )
    .join("");
}

export function slateHtml(s) {
  const skipped = s.skipped?.lineups ? ` &middot; ${fmt(s.skipped.lineups)} not counted` : "";
  return (
    `<p class="tab-note su-head"><strong>${escapeHtml(slateName(s))}</strong> &middot; ${fmt(s.lineups)} lineups counted${skipped}</p>` +
    barsHtml(s.rows) +
    `<p class="tab-note su-source">Source: ${escapeHtml(s.source ?? `DraftKings contest ${s.contestId}`)}${s.date ? `, ${escapeHtml(s.date)}` : ""}</p>`
  );
}

export function pooledHtml(p) {
  const parts = p.parts.map((x) => `${escapeHtml(slateName(x))} (contest ${escapeHtml(x.contestId)}, ${fmt(x.lineups)} lineups)`).join("; ");
  const left = p.excluded.length
    ? `<p class="tab-note su-source">Left out of the pool because its rows differ from the first slate's: ${p.excluded.map((x) => escapeHtml(slateName(x))).join("; ")}.</p>`
    : "";
  // A slate whose prices were not read from DraftKings' own salary file says so here, one sentence each (D13; Adam 2026-10-18:
  // BAL@ATL's are DraftKings' prices copied from Footballguys' page).
  const copied = p.parts.filter((x) => !x.pricesFromDraftKings);
  const copiedNote = copied.length
    ? `<p class="tab-note su-source">${copied.map((x) => `${escapeHtml(x.game ?? x.key)}'s prices are DraftKings prices copied from Footballguys' page, not DraftKings' own file (see that slate's source).`).join(" ")}</p>`
    : "";
  return (
    `<p class="tab-note su-head"><strong>All slates</strong> &middot; pools ${p.slateCount} slate${p.slateCount === 1 ? "" : "s"}, ${fmt(p.lineups)} lineups</p>` +
    barsHtml(p.rows) +
    `<p class="tab-note su-source">Source: DraftKings contest standings, pooled from ${parts}.</p>` +
    copiedNote +
    left
  );
}

/** True when the page before this one was the app's front page: same origin, and the folder this page sits in (or its index.html), so history can go back to it. Works under a sub-path such as the public site's. */
export function cameFromApp(referrer, origin, pagePath = "/showdown-salary.html") {
  try {
    const u = new URL(referrer);
    const dir = pagePath.slice(0, pagePath.lastIndexOf("/") + 1);
    return u.origin === origin && (u.pathname === dir || u.pathname === `${dir}index.html`);
  } catch {
    return false; // no referrer, or not a URL
  }
}

/** A Showdown key, as server/showdown/parse.js reads one (2026-w06-SEADEN); the browser cannot import the server's copy. */
export const SHOWDOWN_KEY_RE =/^\d{4}-w(\d{2}|XX)-[A-Z]{2,3}[A-Z]{2,3}$/;

/** Where "Back to the app" goes without history: that Showdown view when ?from=<key> is a valid key, else the app's front page. Relative, so it works on localhost and under the public site's sub-path. */
export function backTarget(search) {
  const from = new URLSearchParams(search).get("from");
  return from && SHOWDOWN_KEY_RE.test(from) ? `./#sd=${encodeURIComponent(from)}` : "./";
}

/** "Back to the app" returns by history when the page before was the app, else to the Showdown view named in ?from=, else the front page. */
function wireBack(button) {
  if (!button) return;
  button.addEventListener("click", () => {
    if (cameFromApp(document.referrer, window.location.origin, window.location.pathname) && window.history.length > 1) window.history.back();
    else window.location.assign(backTarget(window.location.search));
  });
}

async function init() {
  wireBack(document.getElementById("su-back"));
  const picker = document.getElementById("su-picker");
  const view = document.getElementById("su-view");
  let data;
  try {
    const res = await fetch("baked/showdown/salary-used.json");
    data = await res.json();
    if (!data?.ok) throw new Error(data?.error?.message ?? `status ${res.status}`);
  } catch (e) {
    view.innerHTML = `<p class="tab-note">The salary-used figures could not be loaded (${escapeHtml(e.message)}).</p>`;
    return;
  }
  const slates = data.slates ?? [];
  if (!slates.length) {
    view.innerHTML = `<p class="tab-note">No slate has salary-used figures yet (run tools/contest_salary_used.mjs for a contest).</p>`;
    return;
  }
  const choices = [...slates.map((s) => ({ id: s.key, label: slateName(s), html: () => slateHtml(s) })), { id: "all", label: "All slates", html: () => pooledHtml(poolSlates(slates)) }];
  const show = (id) => {
    const c = choices.find((x) => x.id === id) ?? choices[0];
    picker.querySelectorAll(".chip").forEach((b) => b.classList.toggle("active", b.dataset.id === c.id));
    view.innerHTML = c.html();
  };
  picker.innerHTML = choices.map((c) => `<button type="button" class="chip toggle-chip" data-id="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`).join("");
  picker.addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (b) show(b.dataset.id);
  });
  show(choices[0].id);
  if (data.unreadable) picker.insertAdjacentHTML("afterend", `<p class="tab-note">${data.unreadable} salary-used file(s) could not be read and are left out.</p>`);
}

if (typeof document !== "undefined" && document.getElementById("su-view")) {
  const { wireThemeToggle } = await import("../header.js");
  wireThemeToggle(document.getElementById("theme-toggle-btn"));
  init();
}
