// Published, read-only copy of the app: marks the page, shows when it was published, and swallows the
// clicks that would start an edit. Injected into index.html by tools/publish.mjs. Hiding of the controls
// themselves is done in site.css.
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

// The header items the site adds, in order: the published stamp, then a "Matchups" link when the build
// carried the week's Matchups column (meta.matchups, set by tools/publish.mjs). Either may be absent.
export function siteHeaderItems(meta) {
  const items = [];
  const text = formatPublished(meta?.publishedAt);
  if (text) items.push({ tag: "span", className: "site-published", text });
  if (meta?.matchups === true) items.push({ tag: "a", className: "site-matchups-link", text: "Matchups", href: "matchups.html" });
  return items;
}

async function showPublished() {
  try {
    const res = await fetch("baked/meta.json");
    const meta = await res.json();
    const items = siteHeaderItems(meta);
    if (!items.length) return;
    document.querySelectorAll(".header-actions").forEach((box) => {
      const nodes = items.map((item) => {
        const el = document.createElement(item.tag);
        el.className = item.className;
        el.textContent = item.text;
        if (item.href) el.setAttribute("href", item.href);
        return el;
      });
      box.prepend(...nodes);
    });
  } catch (e) {
    /* no meta file: the page still works, it just has no stamp */
  }
}

// Capture phase on the document so these run before the table's own delegated handlers.
const BLOCKED =
  "[data-action='toggle-star'], [data-action='edit-note'], .reset-icon, .editable-cell, [data-action='lineup-rename-start'], [data-action='sd-rename-start']";
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
