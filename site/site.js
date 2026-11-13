// Published copy of the app: marks the page, shows when it was published, and swallows the clicks that would
// start an edit the site cannot keep (renaming the app's lineups). The header's Current | TwoGun switch is the app's own
// (site-src/api.js). Stars, notes and typed numbers work on the site (D71,
// site-src/site-overrides.js). Injected into index.html by tools/publish.mjs. Hiding of the controls that stay
// app-only is done in site.css.
document.documentElement.classList.add("is-site");

// "Published Tue, Sep 29, 8:40 PM ET", always in Eastern time whatever the visitor's zone.
export function formatPublished(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `Published ${text} ET`;
}

// The header items the site adds: the published stamp, when the build carries one.
export function siteHeaderItems(meta) {
  const items = [];
  const text = formatPublished(meta?.publishedAt);
  if (text) items.push({ tag: "span", className: "site-published", text });
  return items;
}

// The link to the week's Matchups column, shown at the end of the tab row only when the build carried the
// column (meta.matchups, set by tools/publish.mjs); null otherwise (Adam, 2026-10-10).
export function matchupsTabLink(meta) {
  if (meta?.matchups !== true) return null;
  return { className: "site-matchups-tab", text: "Matchups →", href: "matchups.html" };
}

// G68: a part the publish left out (meta.leftOut: [{part, reason, kept}]) is named at the foot of the page, with whether the
// site still shows that part's last published copy (kept true), has none (false) or it is unknown (null). [] when nothing was left out.
export function siteFootNotes(meta) {
  if (!Array.isArray(meta?.leftOut)) return [];
  return meta.leftOut.filter((l) => l && typeof l.part === "string").map((l) => {
    const after = l.kept === true ? " The site still shows its last published copy." : l.kept === false ? " The site has no earlier copy of it." : "";
    return `${l.part} not updated in this publish: ${l.reason ?? "it did not pass its check"}.${after}`;
  });
}

// The app redraws the tab buttons (it replaces the whole nav's contents) on every tab change, which would wipe a
// link added once; so each tab nav is watched and the link put back at its end whenever it is missing.
function addMatchupsTab(link) {
  document.querySelectorAll("#tabs, #sd-tabs").forEach((nav) => {
    const ensure = () => {
      if (nav.querySelector(".site-matchups-tab")) return;
      const el = document.createElement("a");
      el.className = link.className;
      el.textContent = link.text;
      el.setAttribute("href", link.href);
      nav.append(el);
    };
    ensure();
    new MutationObserver(ensure).observe(nav, { childList: true });
  });
}

async function showPublished() {
  try {
    const res = await fetch("baked/meta.json");
    const meta = await res.json();
    const items = siteHeaderItems(meta);
    if (items.length) {
      document.querySelectorAll(".header-actions").forEach((box) => {
        const nodes = items.map((item) => {
          const el = document.createElement(item.tag);
          el.className = item.className;
          el.textContent = item.text;
          return el;
        });
        box.prepend(...nodes);
      });
    }
    const link = matchupsTabLink(meta);
    if (link) addMatchupsTab(link);
    for (const text of siteFootNotes(meta)) {
      const el = document.createElement("p");
      el.className = "site-foot-note";
      el.textContent = text;
      document.body.append(el);
    }
  } catch (e) {
    /* no meta file: the page still works, it just has no stamp */
  }
}

// D71: a control the site cannot run keeps its place, disabled, with a sentence that it runs in the app (the pattern of the Showdown
// upload note and the "apply to every game" button). Header chips carry the sentence as their hover; the paste boxes carry it as a
// note inside the box. Idempotent: the app redraws these panels, so the observer below marks them again.
export const UPLOAD_SENTENCE = "Uploading a DraftKings CSV runs in the app.";
export const SHOWDOWN_UPLOAD_SENTENCE = "Uploading a showdown CSV runs in the app.";
export const REFRESH_SENTENCE = "Refreshing the sources runs in the app.";
export const PASTE_SENTENCE = "Pasting a FantasyPros table runs in the app.";

function lockControl(el, sentence) {
  if (el.dataset?.appOnly === "1") return;
  el.dataset.appOnly = "1";
  el.title = sentence;
  el.setAttribute("aria-disabled", "true");
  el.classList.add("site-app-only");
  if (el.tagName === "BUTTON") el.disabled = true;
  el.querySelectorAll("input").forEach((input) => { input.disabled = true; });
}

export function markAppOnlyControls(root = document) {
  root.querySelectorAll(".header .upload-btn:not([data-app-only])").forEach((el) => lockControl(el, UPLOAD_SENTENCE));
  root.querySelectorAll(".mode-upload-tile:not([data-app-only])").forEach((el) => lockControl(el, SHOWDOWN_UPLOAD_SENTENCE));
  root.querySelectorAll("#refresh-btn:not([data-app-only]), #sd-refresh-btn:not([data-app-only])").forEach((el) => lockControl(el, REFRESH_SENTENCE));
  root.querySelectorAll(".paste-box:not([data-app-only])").forEach((box) => {
    box.dataset.appOnly = "1";
    box.querySelectorAll("select, button, textarea").forEach((c) => { c.disabled = true; });
    const note = document.createElement("p");
    note.className = "tab-note site-app-only-note";
    note.textContent = PASTE_SENTENCE;
    box.append(note);
  });
}

function watchAppOnlyControls() {
  if (!document.body || typeof MutationObserver === "undefined") return;
  markAppOnlyControls();
  new MutationObserver(() => markAppOnlyControls()).observe(document.body, { childList: true, subtree: true });
}

// Capture phase on the document so these run before the table's own delegated handlers.
const BLOCKED = "[data-action='lineup-rename-start']:not([data-id^='device-']), [data-action='sd-rename-start']:not([data-id^='device-'])";
document.addEventListener(
  "click",
  (e) => {
    if (e.target instanceof Element && e.target.closest(BLOCKED)) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true
);

showPublished();
watchAppOnlyControls();
