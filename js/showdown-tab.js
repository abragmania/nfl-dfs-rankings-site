// The Showdown tab on the classic page (ChatGPT wish t, Adam 2026-10-17): a second door to the Showdown boards beside
// the mode row. One chip per game (this week's main-slate games plus every loaded showdown), a loaded game opens its
// board, a game with none gets the upload empty state. Reachable before any main-slate upload (app.js renderDynamic).
import { escapeHtml } from "./format.js";
import { kickoffDateAndClock } from "./header.js";

// 👁 2026-10-17: with no game chips the "Pick a game below" sentence is left out.
const HINT_SHORT = "One game, six spots, one Captain at 1.5x.";
const HINT = `${HINT_SHORT} Pick a game below; a game with a DraftKings Showdown CSV loaded opens its board.`;
const NONE_LOADED_AT_ALL = "No showdown loaded yet. Upload a DraftKings Showdown CSV for the game you want.";
const NONE_LOADED_THIS_WEEK = "No showdown slate is loaded for this week yet. Pick a game above, then upload its DraftKings Showdown CSV.";
const READING_SENTENCE = "Reading the loaded showdowns…"; // 🔵 2026-10-17 (cold read is unknown)
const SITE_UPLOAD_SENTENCE = "Uploading a showdown CSV runs in the app."; // D71: the site keeps the control's place with a plain sentence
const READ_HERE_SENTENCE = "The file is read here and never sent anywhere else.";

// Panel-local: the missing game the user picked; lives in memory only.
let selectedGameId = null;

/** For tests: forgets the picked game so module state does not leak between tests (🔵 2026-10-17). */
export function resetShowdownTabSelection() {
  selectedGameId = null;
}

/** "ATL@GB" to "ATL @ GB"; an id with no "@" is shown as it is. */
function gameLabel(gameId) {
  const [away, home] = String(gameId).split("@");
  return home == null ? String(gameId) : `${away} @ ${home}`;
}

/**
 * One choice per game, the union of the main slate's games and the loaded showdowns, de-duplicated by AWAY@HOME and
 * ordered by kickoffEt. Each: { gameId, kickoffEt, key, sameGame } where key is the loaded showdown's key or null and
 * sameGame is true when a second showdown for the same game got its own tile (its label then carries the key).
 */
export function showdownGameChoices(games = [], showdowns = []) {
  const byId = new Map();
  const list = [];
  for (const g of Array.isArray(games) ? games : []) {
    const gameId = String(g?.id ?? `${g?.away}@${g?.home}`);
    if (byId.has(gameId)) continue;
    const choice = { gameId, kickoffEt: g?.kickoffEt ?? null, key: null, sameGame: false };
    byId.set(gameId, choice);
    list.push(choice);
  }
  for (const sd of Array.isArray(showdowns) ? showdowns : []) {
    if (!sd?.key) continue;
    const gameId = String(sd.gameId ?? sd.key);
    const have = byId.get(gameId);
    if (have && have.key == null) { // merge into the game's tile only while it has no key yet
      have.key = sd.key;
      if (have.kickoffEt == null) have.kickoffEt = sd.kickoffEt ?? null;
    } else { // 🔵 2026-10-17: a further showdown for the same game gets its own tile, never swallowed
      const choice = { gameId, kickoffEt: sd.kickoffEt ?? have?.kickoffEt ?? null, key: sd.key, sameGame: Boolean(have) };
      if (have) have.sameGame = true;
      else byId.set(gameId, choice);
      list.push(choice);
    }
  }
  return list.sort((a, b) => {
    if (a.kickoffEt == null || b.kickoffEt == null) return (a.kickoffEt == null) - (b.kickoffEt == null) || a.gameId.localeCompare(b.gameId) || String(a.key).localeCompare(String(b.key));
    return a.kickoffEt < b.kickoffEt ? -1 : a.kickoffEt > b.kickoffEt ? 1 : a.gameId.localeCompare(b.gameId) || String(a.key).localeCompare(String(b.key));
  });
}

function tileHtml(choice, selected, unknown = false) {
  const when = kickoffDateAndClock(choice.kickoffEt);
  const loaded = choice.key != null;
  if (unknown) { // 🔵 2026-10-17 (cold read is unknown): loaded or not is not known yet, so a plain tile
    const plain = `${escapeHtml(gameLabel(choice.gameId))}${when ? ` · ${escapeHtml(when)}` : ""}`;
    return `<button type="button" class="sd-game-tile" data-game-id="${escapeHtml(choice.gameId)}">${plain}</button>`;
  }
  const keyLabel = choice.sameGame && loaded ? ` (${escapeHtml(choice.key)})` : ""; // two showdowns for one game: told apart by key
  const text = `${escapeHtml(gameLabel(choice.gameId))}${keyLabel}${when ? ` · ${escapeHtml(when)}` : ""}`;
  const mark = loaded ? ` <span class="sd-loaded-mark">· loaded</span>` : "";
  const cls = `sd-game-tile ${loaded ? "sd-game-loaded" : "sd-game-missing"}${selected ? " selected" : ""}`;
  const keyAttr = loaded ? ` data-sd-key="${escapeHtml(choice.key)}"` : "";
  return `<button type="button" class="${cls}" data-game-id="${escapeHtml(choice.gameId)}"${keyAttr}>${text}${mark}</button>`;
}

function uploadHtml(onSite) {
  if (onSite) return `<p class="tab-note sd-tab-site-note">${escapeHtml(SITE_UPLOAD_SENTENCE)}</p>`;
  return `<label class="upload-btn">Upload Showdown CSV<input type="file" id="sd-tab-csv-input" accept=".csv,text/csv" hidden></label>
    <p class="tab-note">${escapeHtml(READ_HERE_SENTENCE)}</p>`;
}

function emptyHtml(text, onSite) {
  return `<div class="empty-state sd-tab-empty"><p>${escapeHtml(text)}</p>${uploadHtml(onSite)}</div>`;
}

/**
 * The panel's HTML. model: { games, showdowns, listError, onSite }; listError is the message when the loaded-showdown list
 * could not be read (shown as unknown, never as "none loaded"; 🔵 2026-10-17), else null; selected: a gameId the user picked, or null.
 * listRead is false only before the first list read returns (the same unknown rule); absent or true draws as the list says.
 */
export function showdownTabHtml(model, selected = null) {
  const choices = showdownGameChoices(model?.games, model?.showdowns);
  const onSite = Boolean(model?.onSite);
  const reading = model?.listRead === false && !model?.listError; // 🔵 2026-10-17 (cold read is unknown)
  const picked = reading ? null : (choices.find((c) => c.gameId === selected && c.key == null) ?? null);
  const loadedCount = choices.filter((c) => c.key != null).length;
  let below = "";
  if (model?.listError) below = emptyHtml(`Could not read the loaded showdowns: ${model.listError}`, onSite);
  else if (reading) below = `<p class="tab-note">${escapeHtml(READING_SENTENCE)}</p>`;
  else if (choices.length === 0) below = emptyHtml(NONE_LOADED_AT_ALL, onSite);
  else if (picked) below = emptyHtml(`No showdown slate for ${gameLabel(picked.gameId)} yet. Upload its DraftKings Showdown CSV.`, onSite);
  else if (loadedCount === 0) below = emptyHtml(NONE_LOADED_THIS_WEEK, onSite);
  else below = `<p class="tab-note">${loadedCount} showdown${loadedCount === 1 ? "" : "s"} loaded; click one to open its board.</p>`;
  const tiles = choices.length
    ? `<div class="sd-game-tiles">${choices.map((c) => tileHtml(c, picked != null && c.gameId === picked.gameId, reading)).join("")}</div>`
    : "";
  return `<h3 class="opt-title">Showdown</h3>
    <p class="tab-note">${escapeHtml(choices.length ? HINT : HINT_SHORT)}</p>
    ${tiles}
    ${below}`;
}

/** Draws the panel and wires it. handlers: { onOpen(key), onUpload(file) }. A missing game's tile re-draws the panel. */
export function renderShowdownTab(container, model, handlers = {}) {
  container.innerHTML = showdownTabHtml(model, selectedGameId);
  container.querySelectorAll(".sd-game-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      if (tile.dataset.sdKey) {
        handlers.onOpen?.(tile.dataset.sdKey);
        return;
      }
      selectedGameId = tile.dataset.gameId;
      renderShowdownTab(container, model, handlers);
    });
  });
  const input = container.querySelector("#sd-tab-csv-input");
  input?.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) await handlers.onUpload?.(file);
  });
}
