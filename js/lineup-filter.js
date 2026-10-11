// The Optimizer results' "only lineups with" filter (Adam 2026-10-11: "narrow it down to only lineups that have (I
// choose a player) ... then I can pick another ... so it'll show me only lineups w/ both"; "this should work with new
// or saved, on either screen"). Pure helpers only; public/js/lineup.js holds the state and does the wiring. A player is
// matched by his DraftKings identity (`identity`, else his id), so a saved lineup and a new lineup holding the same man
// both match. A lineup must hold EVERY chosen player (AND).
import { escapeHtml } from "./format.js";

/** The key a player is matched on: his DraftKings identity when given, else his id. */
export function playerKey(p) {
  return p?.identity != null ? String(p.identity) : p?.id != null ? String(p.id) : "";
}

/** Whether a lineup (its players {id, identity?}) holds every key in `ids`. No keys chosen means every lineup passes. */
export function lineupHasAll(players, ids) {
  const want = (ids ?? []).map(String);
  if (!want.length) return true;
  const have = new Set((players ?? []).map(playerKey));
  return want.every((k) => have.has(k));
}

/** The lineups holding every chosen player, each as {item, index}: the lineup and its place in `list`, so cards keep
 *  their original number. `playersOf(item)` gives a lineup's players {id, identity?} (the lineup itself by default). */
export function filterLineups(list, ids, playersOf = (l) => l) {
  const out = [];
  (list ?? []).forEach((item, index) => {
    if (lineupHasAll(playersOf(item), ids)) out.push({ item, index });
  });
  return out;
}

/** The uids of the lineups a bulk action (Save all / Discard all) acts on: only those holding every chosen player
 *  (Adam 2026-10-11: saving 20 when he sees 3 is a trap); hidden lineups are never touched. Every lineup when no
 *  player is chosen. */
export function bulkUids(list, ids, playersOf = (l) => l) {
  return filterLineups(list, ids, playersOf).map((e) => e.item.uid);
}

/** A bulk button's words: "Save all" unfiltered, "Save 3 shown" while the filter is on. */
export function bulkLabel(verb, shownCount, filtered) {
  return filtered ? `${verb} ${Number(shownCount) || 0} shown` : `${verb} all`;
}

/** The chosen keys with `id` added at the end, or taken out when already there (a new array; the order is the order
 *  he chose them). */
export function toggleMustHave(ids, id) {
  const key = String(id);
  const list = (ids ?? []).map(String);
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

/** A player's name as a real button that adds him to (or takes him out of) the filter. `id` is the board id the click
 *  handler resolves to an identity; `chosen` flips the title. `cls` is the class the plain name cell carried. */
export function pickButtonHtml({ id, name, chosen = false, cls = "" }) {
  const label = String(name ?? "");
  const title = chosen ? `Stop filtering by ${label}` : `Show only lineups with ${label}`;
  return `<button type="button" class="opt-pick${cls ? ` ${escapeHtml(cls)}` : ""}${chosen ? " opt-pick-on" : ""}" data-action="opt-pick" data-pick-id="${escapeHtml(id)}" data-pick-name="${escapeHtml(label)}" aria-pressed="${chosen ? "true" : "false"}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
}

/** The filter bar: "Only lineups with:", a chip per chosen player (× takes him out), Clear, and "showing K of N".
 *  `chips` is [{key, name}] in the order chosen; nothing chosen gives an empty string (the bar is hidden). */
export function filterBarHtml(chips, shown, total) {
  if (!chips?.length) return "";
  const chipHtml = chips
    .map(
      (c) =>
        `<button type="button" class="chip opt-chip active opt-must-chip" data-action="opt-pick-remove" data-pick-key="${escapeHtml(c.key)}" title="Stop filtering by ${escapeHtml(c.name)}" aria-label="Stop filtering by ${escapeHtml(c.name)}">${escapeHtml(c.name)} ×</button>`
    )
    .join("");
  return `<div class="opt-must-bar" role="group" aria-label="Only lineups with"><span class="opt-must-label">Only lineups with:</span>${chipHtml}<button type="button" class="saved-lineup-btn" data-action="opt-pick-clear">Clear</button><span class="opt-sub opt-must-count">showing ${Number(shown) || 0} of ${Number(total) || 0}</span></div>`;
}
