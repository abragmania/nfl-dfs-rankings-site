// The player card popup (D6 amended 2026-10-18): a click on a player's NAME on any list opens his card, built from
// NFLDepthCharts' published files by GET /api/player-card/<id>. One delegated click handler on the document, so the
// lists need no wiring of their own and survive every re-render. The exposure tables keep the name as the "only
// lineups with" button (Adam, 2026-10-18), so they are not hooked here.
//
// The controller (createPlayerCardController) is DOM-free: it takes a `view` and the data calls as arguments, so
// tests/player-card-ui.test.mjs drives it with stand-ins. initPlayerCard builds the real dialog and wires the page.
import { getPlayerCard } from "./api.js";
import { cardHtml, initialsBadgeHtml } from "./player-card-body.js";

// What counts as a player's name: the Player cell of the Rankings, Favorites, Showdown and Optimizer-pool rows
// (.player-name, inside a <tr data-id>), the other lists' names (each inside an element carrying data-card-id), and
// Showdown's Projections and Ownership name cells (.pc-name; classic's use the shared .player-name).
export const NAME_SELECTOR = ".player-name, .pc-name, .lineup-slot-name, .saved-lineup-slot-name, .opt-p-name, .qbs-pname, .qbs-head-name, .cash-swap-name";
const INTERACTIVE = "button, a, input, select, textarea";

/** {id, name} of the player whose name `el` is (or sits inside), or null when it is not a name or has no id. */
export function cardTargetOf(el) {
  const hit = el?.closest?.(NAME_SELECTOR);
  if (!hit) return null;
  const inner = el.closest(INTERACTIVE);
  if (inner && hit.contains(inner)) return null; // a button or link inside a name keeps its own job
  const holder = hit.closest("[data-card-id]");
  const id = holder ? holder.dataset.cardId : hit.closest("tr[data-id]")?.dataset?.id;
  if (id == null || id === "") return null;
  const full = hit.querySelector?.(".nm-full");
  return { id: String(id), name: String((full ?? hit).textContent ?? "").trim() };
}

/**
 * Makes every name under `root` (or `root` itself) a keyboard stop that Enter opens: tabindex 0 and a button role (not on a
 * table cell, whose role stays). Run on the page at start and on everything a list draws afterwards. Returns how many it marked.
 */
export function markNames(root) {
  const els = [...(root.querySelectorAll?.(NAME_SELECTOR) ?? [])];
  if (root.matches?.(NAME_SELECTOR)) els.push(root);
  let n = 0;
  for (const el of els) {
    if (!cardTargetOf(el)) continue;
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-haspopup", "dialog");
    if (el.tagName?.toLowerCase() !== "td") el.setAttribute("role", "button");
    n++;
  }
  return n;
}

/**
 * The card's behaviour apart from the page. `getCard(id, sd)` answers the route's body; `findRow(id, sd)` is the list
 * row on screen (or null); `sdKey()` is the open showdown's key or null; `boardAsOf(sd)` is when that board was built;
 * `view` = { show(html, who), hide(), isShown() }.
 */
export function createPlayerCardController({ getCard = getPlayerCard, findRow, sdKey = () => null, boardAsOf = () => null, view }) {
  let seq = 0;
  async function open(target) {
    const mine = ++seq;
    const sd = sdKey() || null;
    const row = findRow(target.id, sd) ?? null;
    const asOf = boardAsOf(sd) ?? null;
    const who = { id: target.id, name: row?.name ?? target.name, team: row?.team ?? "", pos: row?.pos ?? "" };
    view.show(cardHtml({ who, row, asOf, state: "loading" }), who);
    let html;
    try {
      const data = await getCard(target.id, sd);
      html = data && data.ok !== false
        ? cardHtml({ who, row, asOf, state: "ready", data })
        : cardHtml({ who, row, asOf, state: "error", message: data?.error?.message ?? "The player card could not be loaded." });
    } catch (e) {
      html = cardHtml({ who, row, asOf, state: "error", message: `Could not reach the app: ${e.message}` });
    }
    if (mine === seq && view.isShown()) view.show(html, who); // an answer for a card that was closed or replaced is dropped
  }
  return {
    /** True when Enter or Space was pressed on a focused name (and the card is opening). */
    handleKey(event) {
      if (event?.key !== "Enter" && event?.key !== " ") return false;
      return this.handleClick(event);
    },
    /** True when the click was on a player's name (and the card is opening). */
    handleClick(event) {
      const target = cardTargetOf(event?.target);
      if (!target) return false;
      open(target).catch((e) => console.error("player card: could not draw the card", e));
      return true;
    },
    close() {
      seq++;
      view.hide();
    },
  };
}

// ---- the page ------------------------------------------------------------------------------------------------------
function buildView() {
  const backdrop = document.createElement("div");
  backdrop.className = "pc-backdrop";
  backdrop.id = "player-card";
  backdrop.hidden = true;
  backdrop.innerHTML = `<div class="pc-dialog" role="dialog" aria-modal="true" aria-labelledby="pc-title" tabindex="-1">
    <button type="button" class="pc-close" aria-label="Close player card" title="Close (Esc)">&times;</button>
    <div class="pc-content"></div>
  </div>`;
  document.body.appendChild(backdrop);
  const dialog = backdrop.querySelector(".pc-dialog");
  const content = backdrop.querySelector(".pc-content");
  const closeBtn = backdrop.querySelector(".pc-close");
  let whoNow = null;
  let returnTo = null; // the name that opened the card, and its player id for when a list redraw has replaced the element
  let returnId = null;
  // A photo that does not load becomes the initials badge (error does not bubble, so it is caught on the way down).
  content.addEventListener("error", (e) => {
    if (e.target?.matches?.("img.pc-shot")) {
      const holder = document.createElement("span");
      holder.innerHTML = initialsBadgeHtml(whoNow);
      e.target.replaceWith(holder.firstElementChild);
    }
  }, true);
  return {
    backdrop, dialog, closeBtn,
    show(html, who) {
      whoNow = who;
      const wasShown = !backdrop.hidden;
      if (!wasShown) {
        returnTo = document.activeElement;
        returnId = who?.id ?? null;
      }
      content.innerHTML = html;
      backdrop.hidden = false;
      document.body.classList.add("pc-open");
      if (!wasShown) closeBtn.focus({ preventScroll: true });
    },
    hide() {
      backdrop.hidden = true;
      content.innerHTML = "";
      document.body.classList.remove("pc-open");
      const back = returnTo && returnTo !== document.body && document.contains(returnTo)
        ? returnTo
        : [...document.querySelectorAll(NAME_SELECTOR)].find((el) => cardTargetOf(el)?.id === returnId);
      back?.focus({ preventScroll: true });
      returnTo = null;
      returnId = null;
    },
    isShown: () => !backdrop.hidden,
  };
}

let wired = false;

/** Builds the dialog once and wires the page: the delegated name click, the backdrop and × to close, Esc, and Tab kept inside. */
export function initPlayerCard({ findRow, sdKey, boardAsOf }) {
  if (wired) return;
  wired = true;
  const view = buildView();
  const controller = createPlayerCardController({ findRow, sdKey, boardAsOf, view });
  // Names are keyboard stops: marked now, and again on whatever a list draws later (innerHTML redraws add new nodes).
  markNames(document.body);
  new MutationObserver((records) => {
    for (const r of records) for (const node of r.addedNodes) if (node.nodeType === 1) markNames(node);
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("keydown", (e) => {
    if (!view.isShown() && controller.handleKey(e)) e.preventDefault();
  });
  document.addEventListener("click", (e) => {
    if (view.dialog.contains(e.target)) return;
    controller.handleClick(e);
  });
  view.backdrop.addEventListener("click", (e) => {
    if (e.target === view.backdrop) controller.close();
  });
  view.closeBtn.addEventListener("click", () => controller.close());
  // Capture phase, and stopped: expand.js listens for Escape on the document too and must not also minimize a table.
  document.addEventListener("keydown", (e) => {
    if (!view.isShown()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      controller.close();
    } else if (e.key === "Tab") {
      const stops = [...view.dialog.querySelectorAll("button, a[href]")];
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && (document.activeElement === first || !view.dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);
}
