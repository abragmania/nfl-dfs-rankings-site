// Published copy of the app: marks the page, shows when it was published, and swallows the clicks that would
// start an edit the site cannot keep (renaming a lineup), and swaps the TwoGun mode switch for the mode it was
// published in. Stars, notes and typed numbers work on the site (D71,
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

// The app redraws the tab buttons (it replaces the whole nav's contents) on every tab change, which would wipe a
// link added once; so each tab nav is watched and the link put back at its end whenever it is missing.
function addMatchupsTab(link) {
  document.querySelectorAll("nav.tabs").forEach((nav) => {
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
  } catch (e) {
    /* no meta file: the page still works, it just has no stamp */
  }
}

// TwoGun mode before P7 (spec review 2026-10-15, must-fix 11): the site carries the one board it was published with, so
// the header's Current / TwoGun switch (header.js renderModeBox) is taken out and the box says which mode was published.
export function publishedModeText(active) {
  return active === "twogun" ? "Published in TwoGun mode" : "Published in current mode";
}

// The app redraws the mode box on every board load, so the header is watched (as addMatchupsTab watches the tab rows)
// and the switch taken out each time.
function showPublishedMode() {
  document.querySelectorAll("#classic-header").forEach((header) => {
    const apply = () => {
      const box = header.querySelector("#tg-mode");
      if (!box) return;
      box.querySelector(".tg-mode-switch")?.remove();
      const text = publishedModeText(box.dataset.mode);
      const label = box.querySelector(".site-published-mode");
      if (label && label.textContent === text) return;
      label?.remove();
      const el = document.createElement("span");
      el.className = "site-published-mode";
      el.textContent = text;
      box.prepend(el);
    };
    apply();
    new MutationObserver(apply).observe(header, { childList: true, subtree: true });
  });
}

// Capture phase on the document so these run before the table's own delegated handlers.
const BLOCKED = "[data-action='lineup-rename-start'], [data-action='sd-rename-start']";
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
showPublishedMode();
