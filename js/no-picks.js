// The NO list on the classic Optimizer's player list (PROJECT.md Part 4 Monday 11-23 item 4; NBA b430e7c board/no-picks.js, Adam's NO of 11-19):
// a NO button between Lock and Exclude, the row kept in view with a pink tint and a NO tag, and a red chip over the list naming the open mode's
// NO men (each with its own ✕, and clear all). NO is "build without him" for the open mode only (GPP and Cash keep their own lists); it never
// touches his exclude, projection or exposures. A build sends the list (noForRequest) and the engine applies NBA's rule (server/lineup/no-list.js).
// Kept in this browser per mode, week and slate, as the classic picks are. The markup helpers are pure and tested in node.
import { escapeHtml } from "./format.js";
import { noteUnreadable, clearUnreadable } from "./storage-damage.js";

export const NO_STORAGE_KEY = "nfldfs.noPicks.v1";
const MODES = ["gpp", "cash"];
const modeOk = (m) => (m === "cash" ? "cash" : "gpp");
const modeWord = (m) => (modeOk(m) === "cash" ? "Cash" : "GPP");

let lists = null; // { gpp: { listKey: [ids] }, cash: { ... } }, read once from storage

/** A stored value made safe: two maps of list key to id lists; anything else is null (unreadable). Pure. */
export function cleanNoLists(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out = { gpp: {}, cash: {} };
  for (const m of MODES) {
    const src = v[m] ?? {};
    if (!src || typeof src !== "object" || Array.isArray(src)) return null;
    for (const [k, ids] of Object.entries(src)) if (Array.isArray(ids)) out[m][k] = [...new Set(ids.map(String))];
  }
  return out;
}

function read() {
  if (lists) return lists;
  lists = { gpp: {}, cash: {} };
  try {
    const raw = globalThis.localStorage?.getItem(NO_STORAGE_KEY);
    if (raw) {
      const clean = cleanNoLists(JSON.parse(raw));
      if (clean) lists = clean;
      else noteUnreadable("NO lists", NO_STORAGE_KEY, "empty lists");
    }
  } catch (e) {
    if (e instanceof SyntaxError) noteUnreadable("NO lists", NO_STORAGE_KEY, "empty lists"); // bad JSON; blocked storage is not damage
  }
  return lists;
}

function save() {
  try {
    globalThis.localStorage?.setItem(NO_STORAGE_KEY, JSON.stringify(lists));
    clearUnreadable(NO_STORAGE_KEY);
  } catch {
    // storage unavailable: the lists hold for this page only
  }
}

/** The list's key: the board's season and week and the slate on screen ("main" or a second slate's key), so a new week starts empty. Pure. */
export const noListKey = (board, slateKey) => `${board?.slate?.season ?? ""}-${board?.slate?.week ?? ""}|${slateKey ?? "main"}`;

/** Every id on the open mode's list for `key`, on the board or not. */
export const noIds = (mode, key) => [...(read()[modeOk(mode)][key] ?? [])];

/** The list with `id` added, or taken out when it is on it. A new array. Pure. */
export const toggleNo = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

function setList(mode, key, ids) {
  const m = modeOk(mode), all = read();
  all[m] = { ...all[m], [key]: ids };
  if (!ids.length) delete all[m][key];
  save();
}
export const toggleNoIn = (mode, key, id) => setList(mode, key, toggleNo(noIds(mode, key), String(id)));
export const dropNoIn = (mode, key, id) => setList(mode, key, noIds(mode, key).filter((x) => x !== String(id)));
export const clearNoIn = (mode, key) => setList(mode, key, []);

/** Splits a list by the board: { on: ids on it, gone: ids it no longer has }. `has(id)`: whether the board has the row. Pure. */
export function splitByBoard(ids, has) {
  return { on: ids.filter((id) => has(id)), gone: ids.filter((id) => !has(id)) };
}

/** The ids a build of `mode` sends as `no`: the list's men on the board (the server refuses any other id). */
export function noForRequest(mode, board, slateKey) {
  const ids = new Set((board?.rows ?? []).map((r) => String(r.id)));
  return splitByBoard(noIds(mode, noListKey(board, slateKey)), (id) => ids.has(id)).on;
}

/** The row's NO button (between Lock and Exclude). Pure. */
export function noCellHtml(row, on) {
  const id = escapeHtml(String(row?.id ?? "")), name = escapeHtml(row?.name ?? "");
  const title = on ? `Clear NO: builds may use ${name} again` : `NO: build lineups without ${name} (his exclude, projection and exposures stay as they are)`;
  return `<td class="ctl"><button type="button" class="nob${on ? " on" : ""}" data-no="${id}" aria-pressed="${on}" title="${title}" aria-label="${title}">NO</button></td>`;
}

/** The small tag by a NO man's name. Pure. */
export const noTagHtml = (on) => (on ? `<span class="notag" title="On the NO list: builds in this mode leave him out">NO</span>` : "");

/**
 * The red chip over the list: "🚫 NO · GPP", each NO man with his own ✕, and clear all; the men the board no longer has are counted with why (G62).
 * "" with nobody on NO. nameOf(id): his name. Pure.
 */
export function noChipHtml({ mode, ids, gone = [], nameOf }) {
  if (!ids.length && !gone.length) return "";
  const men = ids.map((id) => `<span class="nonm">${escapeHtml(nameOf(id))}<button type="button" class="nox" data-nox="${escapeHtml(id)}" title="Clear NO on ${escapeHtml(nameOf(id))}" aria-label="Clear NO on ${escapeHtml(nameOf(id))}">✕</button></span>`).join("");
  const goneWords = gone.length ? `<span class="nogone" title="Their ids are not on this board, so builds cannot use them anyway">${gone.length} no longer on this board, ignored</span>` : "";
  return `<div class="nobar"><span class="nochip" role="group" aria-label="NO list, ${modeWord(mode)}" title="Builds in ${modeWord(mode)} leave these men out, unless locked (or a stack Lock with his quarterback in play), or held to his Min % share. Their excludes, projections and exposures are untouched."><span class="nolbl">🚫 NO · ${modeWord(mode)}</span>${men}${goneWords}<button type="button" class="noclr" data-noclear>clear all</button></span></div>`;
}

/** Wires the NO buttons, the chip's ✕ and clear all under `container`. ctx: { mode(), key(), commit() }. */
export function wireNoPicks(container, { mode, key, commit }) {
  container.querySelectorAll("[data-no]").forEach((btn) => btn.addEventListener("click", () => { toggleNoIn(mode(), key(), btn.dataset.no); commit(); }));
  container.querySelectorAll("[data-nox]").forEach((btn) => btn.addEventListener("click", () => { dropNoIn(mode(), key(), btn.dataset.nox); commit(); }));
  container.querySelectorAll("[data-noclear]").forEach((btn) => btn.addEventListener("click", () => { clearNoIn(mode(), key()); commit(); }));
}

/** For tests: forget the lists read from storage. */
export function resetNoForTests() {
  lists = null;
}
