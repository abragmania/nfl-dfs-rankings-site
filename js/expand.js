// Expand / Minimize for the player tables (Adam, 2026-10-10: "make it so I can expand the list to take up my whole
// view and then minimize that after"). Rankings, Favorites, Projections and Projected Ownership each get a small
// bar above their scroll panel holding an "Expand" button. Expanding turns that panel (and its bar) into a
// full-screen overlay; minimizing puts it back where it was, scroll position kept.
//
// The panel element itself is reused (only classes change), so its sorting, stars and click-to-edit cells keep
// working while expanded. The top of the file is pure state helpers (tests/expand.test.mjs); the DOM part below
// only runs when app.js calls initExpand().

export const EXPAND_TARGETS = [
  { panelId: "rankings-panel", title: "Rankings" },
  { panelId: "favorites-panel", title: "Favorites" },
  { panelId: "projections-panel", title: "Projections" },
  { panelId: "ownership-panel", title: "Projected Ownership" },
];

/** Only one table is expanded at a time: toggling the open one closes it, toggling another switches to it. */
export function toggleExpanded(current, key) {
  return current === key ? null : key;
}

/** The expanded key survives a re-render only while its panel is still on screen; otherwise it closes. */
export function resolveExpandedKey(current, visibleKeys) {
  return current != null && visibleKeys.includes(current) ? current : null;
}

/** Button text for the two states. */
export function expandButtonLabel(isExpanded) {
  return isExpanded ? "✕ Minimize" : "⤢ Expand";
}

/** Escape minimizes, but only while something is expanded and not when the keystroke belongs to a text box
 * (Escape there cancels an edit). `e` = { key, targetTag }. */
export function shouldMinimizeOnKey(e, expandedKey) {
  if (expandedKey == null || e?.key !== "Escape") return false;
  return !["INPUT", "TEXTAREA", "SELECT"].includes(String(e.targetTag ?? "").toUpperCase());
}

/** The least height (px) a player table should get: 70% of the window's height on a phone (max-width 700px),
 * 0 anywhere wider. One shared helper so app.js and lineup.js size their tables the same way. */
export function phoneMinHeight(win = window) {
  return win.matchMedia("(max-width: 700px)").matches ? Math.round(win.innerHeight * 0.7) : 0;
}

/** The Optimizer pool's least height (px): the slot column's height or 60% of the window; 0 for any other panel, and for the
 * Showdown Captain | FLEX list box (inside .sd-list), which must end on screen (public/js/showdown/lineup-lists.js sizes it). */
export function panelMinHeight(panelEl, top, win = window) {
  if (!panelEl?.classList?.contains("lineup-rows-wrap")) return 0;
  if (panelEl.parentElement?.classList?.contains("sd-list")) return 0; // the list box is the direct child of .sd-list
  const left = panelEl.closest(".lineup-layout")?.querySelector(".lineup-left");
  const slotColumn = left ? left.getBoundingClientRect().bottom - top : 0;
  return Math.round(Math.max(win.innerHeight * 0.6, slotColumn));
}

// ---------- DOM part ----------

let expandedKey = null;
let placeholder = null;
let onLayout = () => {};
let wired = false;
// The expanded table's last scroll position, kept so a render that rebuilds its element (Projections and
// Ownership rebuild the whole panel) can hand it to the new element.
let savedScroll = null;

function panelFor(def) {
  const root = document.getElementById(def.panelId);
  return root ? root.querySelector(".scroll-panel") : null;
}

function buildBar(def) {
  const bar = document.createElement("div");
  bar.className = "expand-bar";
  bar.dataset.key = def.panelId;
  const title = document.createElement("span");
  title.className = "expand-title";
  title.textContent = def.title;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "expand-btn";
  btn.setAttribute("aria-expanded", "false");
  btn.textContent = expandButtonLabel(false);
  bar.append(title, btn);
  return bar;
}

function setBarState(bar, isExpanded) {
  bar.classList.toggle("is-expanded", isExpanded);
  const btn = bar.querySelector(".expand-btn");
  btn.textContent = expandButtonLabel(isExpanded);
  btn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
}

function applyExpanded(panel, bar) {
  const carried = savedScroll && savedScroll.key === bar.dataset.key ? savedScroll : null;
  const top = carried ? carried.top : panel.scrollTop;
  const left = carried ? carried.left : panel.scrollLeft;
  // Holds the table's place in the page so nothing below it jumps while it is full-screen.
  placeholder?.remove();
  placeholder = document.createElement("div");
  placeholder.className = "expand-placeholder";
  placeholder.style.height = `${Math.max(0, panel.getBoundingClientRect().bottom - bar.getBoundingClientRect().top)}px`;
  bar.before(placeholder);
  setBarState(bar, true);
  panel.classList.add("is-expanded");
  document.body.classList.add("table-expanded");
  panel.scrollTop = top;
  panel.scrollLeft = left;
  bar.querySelector(".expand-btn")?.focus({ preventScroll: true });
}

function collapse(panel, bar) {
  const top = panel.scrollTop;
  const left = panel.scrollLeft;
  panel.classList.remove("is-expanded");
  if (bar) setBarState(bar, false);
  panel.scrollTop = top;
  panel.scrollLeft = left;
}

/** Call after every render: makes sure each player table has its bar, drops a stale expanded state, and
 * re-applies the expanded look to a table the render rebuilt. */
export function syncExpandUi() {
  const visibleKeys = [];
  const found = [];
  for (const def of EXPAND_TARGETS) {
    const panel = panelFor(def);
    if (!panel) continue;
    let bar = panel.previousElementSibling;
    if (!bar?.classList?.contains("expand-bar")) {
      bar = buildBar(def);
      panel.before(bar);
    }
    bar.hidden = panel.hidden;
    const visible = !panel.closest("[hidden]");
    if (visible) visibleKeys.push(def.panelId);
    found.push({ def, panel, bar, visible });
  }
  expandedKey = resolveExpandedKey(expandedKey, visibleKeys);
  let anyExpanded = false;
  for (const { def, panel, bar } of found) {
    const shouldBeOpen = def.panelId === expandedKey;
    const isOpen = panel.classList.contains("is-expanded");
    if (shouldBeOpen) {
      anyExpanded = true;
      if (!isOpen) applyExpanded(panel, bar);
    } else if (isOpen || bar.classList.contains("is-expanded")) {
      collapse(panel, bar);
    }
  }
  if (!anyExpanded) {
    placeholder?.remove();
    placeholder = null;
    savedScroll = null;
    document.body.classList.remove("table-expanded");
  }
}

function setExpanded(key) {
  const before = expandedKey;
  expandedKey = key;
  syncExpandUi();
  if (before !== expandedKey) {
    onLayout();
  }
}

/** Wires the one click handler and the Escape key. `opts.onLayout` runs after a table opens or closes (app.js
 * passes adjustScrollPanels so the minimized table is sized for its place in the page again). */
export function initExpand(opts = {}) {
  if (wired) return;
  wired = true;
  if (typeof opts.onLayout === "function") onLayout = opts.onLayout;
  document.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.(".expand-btn");
    if (!btn) return;
    const key = btn.closest(".expand-bar")?.dataset.key;
    if (key) setExpanded(toggleExpanded(expandedKey, key));
  });
  // scroll events do not bubble, so this listens in the capture phase.
  document.addEventListener(
    "scroll",
    (ev) => {
      const t = ev.target;
      if (t?.classList?.contains?.("is-expanded")) {
        savedScroll = { key: t.closest(".panel")?.id, top: t.scrollTop, left: t.scrollLeft };
      }
    },
    true,
  );
  // A hash change switches slate or mode (a showdown hides the whole classic page): never leave the lock on.
  window.addEventListener("hashchange", () => setExpanded(null));
  document.addEventListener("keydown", (ev) => {
    if (shouldMinimizeOnKey({ key: ev.key, targetTag: ev.target?.tagName }, expandedKey)) setExpanded(null);
  });
}
