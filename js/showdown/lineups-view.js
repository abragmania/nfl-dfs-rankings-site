// The Showdown Lineups tab's markup (Adam 2026-11-05, copied from the NBA optimizer's Lineups screen): the control bar, then Recently generated (every kept build, newest first, each under its
// header) or Saved (this game's saved lineups), each with the exposure table in a narrow column on the left and the cards on the right. What the cards and the exposure table show is the
// Showdown's own, drawn by optimizer-view.js (cardHtml, exposureHtml) and lineup-saved.js (the saved card): only where they sit is new. Markup only; lineups-screen.js keeps the state and the wiring.
import { escapeHtml } from "../format.js";
import { cardHtml, exposureHtml, provenanceText, provenanceTitle, NO_MATCH_TEXT } from "./optimizer-view.js";
import { optNotesHtml, bendsLineHtml } from "../lineup.js";
import { boardIndex, sdPlayersOf } from "./optimizer-state.js";
import { filterLineups, filterBarHtml } from "../lineup-filter.js";
import { dkDownloadHtml } from "../dk-lineup-ui.js";
import { numberLineups } from "../lineup-tags.js";
import { lineupModeOf } from "../lineup-cash.js";
import { lineupTotals } from "../lineup-totals.js";
import { statusLineHtml } from "../row-message.js";
import { playerFigures } from "./lineup-meter.js";
import { findRow } from "./lineup-saved.js";
import { SORTS, sortItems, matchesText, modeMatches, slotFigures, headerText, isSaved, countLineups } from "./lineups-store.js";

export const EMPTY_RECENT = "No lineups generated yet on this game. Build from the Optimizer tab.";
export const EMPTY_SAVED = "No saved lineups for this game yet.";
export const NO_FILTER_MATCH = "No lineups here match the filter.";
export const REMOVE_QUESTION = (n) => `Remove this build of ${n} lineups from Recently generated? Saved lineups stay.`;

const SORT_LABEL = { proj: "Projection", salary: "Salary", own: "Ownership", newest: "Newest" };
const SORT_TITLE = { proj: "Most projected points first", salary: "Most salary used first", own: "Lowest total ownership first", newest: "Newest first (a build's own order; saved lineups, the most recently saved first)" };
const MODES = ["All", "Cash", "GPP"];
const OBJECTIVE_WORD = { proj: "projection", median: "median" };

/** The state a fresh Lineups screen starts with (per game). */
export const freshUi = () => ({ view: null, sort: "newest", mode: "All", text: "", chosen: [], names: {}, confirmRemove: null, exposureBuild: null, msg: null });

const seg = (items, on, attr, titleOf = () => "") => items.map((v) => `<button type="button" class="sdl-btn${on === v ? " active" : ""}" ${attr}="${v}" title="${escapeHtml(titleOf(v))}">${escapeHtml(SORT_LABEL[v] ?? v)}</button>`).join("");

/** The view on screen: the one asked for, else Recently generated when any build is kept, else Saved. */
export const viewOf = (ui, builds) => (ui.view === "recent" || ui.view === "saved" ? ui.view : builds.length ? "recent" : "saved");

/** The bar: the two views with their counts, the player filter box, Sort and Mode (no Cards | Compare switch: Compare waits). */
export function controlBarHtml(ui, builds, savedCount) {
  const view = viewOf(ui, builds);
  return `
    <div class="sdl-bar" id="sdl-bar">
      <span class="sdl-views"><button type="button" class="sdl-btn${view === "recent" ? " active" : ""}" data-sdl-view="recent">Recently generated <b>${countLineups(builds)}</b></button><button type="button" class="sdl-btn${view === "saved" ? " active" : ""}" data-sdl-view="saved">Saved <b>${savedCount}</b></button></span>
      <input type="text" class="sdl-filter" id="sdl-text" placeholder="Filter by player..." value="${escapeHtml(ui.text)}" aria-label="Filter by player" autocomplete="off" />
      <span class="sdl-group"><span class="sdl-label">Sort</span>${seg(SORTS, ui.sort, "data-sdl-sort", (v) => SORT_TITLE[v])}</span>
      <span class="sdl-group"><span class="sdl-label">Mode</span>${seg(MODES, ui.mode, "data-sdl-mode")}</span>
    </div>`;
}

const chipsOf = (ui) => ui.chosen.map((key) => ({ key, name: ui.names[key] ?? key }));
const pickOf = (ui) => ({ isChosen: (key) => ui.chosen.includes(String(key)) });

/** A saved lineup as the "only lineups with" filter and the exposure table read it: his live board row's name and ownership for the seat, the snapshot's when he left the board. */
function savedView(lineup, index) {
  return {
    slots: (lineup?.slots ?? []).map((s) => {
      const personId = index.personOf.get(String(s.playerId)) ?? String(s.playerId);
      const row = index.rowOf.get(personId);
      const cpt = String(s.slot ?? "").toUpperCase() === "CPT";
      return { slot: s.slot, personId, name: row?.name ?? s.name, own: row ? (cpt ? row.ownCpt : row.ownFlex) ?? null : s.own ?? null };
    }),
  };
}

/** A saved lineup's {used, proj, own} from the live board, as its card's totals block reads them. */
function savedFigures(lineup, board) {
  const men = (lineup.slots ?? []).map((s) => {
    const row = findRow(board, s.playerId);
    if (!row) return { salary: s.salary };
    const cpt = String(s.slot ?? "").toUpperCase() === "CPT";
    const f = playerFigures(row, cpt);
    return { salary: cpt ? row.cptSalary : row.salary, proj: f.proj, own: f.notOnBoard ? null : f.own };
  });
  const t = lineupTotals(men);
  return { used: t.used, proj: t.proj, own: t.own };
}

/** The saved lineups, most recently saved first (a lineup with no readable time after those that have one, the later in the list first). */
export function recentFirst(list) {
  const ms = (l) => { const t = Date.parse(l?.savedAt ?? ""); return Number.isFinite(t) ? t : -Infinity; };
  return list.map((l, i) => ({ l, i })).sort((a, b) => ms(b.l) - ms(a.l) || b.i - a.i).map((x) => x.l);
}

function buildInfoHtml(b) {
  const basis = b.mode === "cash" ? `Built by ${b.basis === "median" ? "TwoGun's median" : "projection"}` : `Built from ${b.boardMode === "twogun" ? "TwoGun's projections" : "this game's sources"}, by ${OBJECTIVE_WORD[b.objective] ?? "projection"}`;
  const prov = provenanceText(b);
  const title = provenanceTitle(b);
  return `<div class="opt-note sdl-build-note"${title ? ` title="${escapeHtml(title)}"` : ""}>${escapeHtml([basis, prov].filter(Boolean).join(" · "))}</div>${optNotesHtml(b.notes)}`;
}

function buildHeadHtml(b, ui, exposureOn) {
  const n = b.lineups.length;
  const expBtn = `<button type="button" class="sdl-mini sdl-exp-btn${exposureOn ? " active" : ""}" data-sdl-exposure="${escapeHtml(b.id)}" aria-pressed="${exposureOn}" title="Show this build's exposure in the column on the left">Exposure</button>`;
  const remove = ui.confirmRemove === b.id
    ? `<span class="sdl-remove-ask" role="alertdialog" aria-label="${escapeHtml(REMOVE_QUESTION(n))}"><span>${escapeHtml(REMOVE_QUESTION(n))}</span><button type="button" class="sdl-mini danger" data-sdl-remove-yes="${escapeHtml(b.id)}">Remove</button><button type="button" class="sdl-mini" data-sdl-remove-no>Cancel</button></span>`
    : `<button type="button" class="sdl-mini danger" data-sdl-remove="${escapeHtml(b.id)}">Remove build</button>`;
  return `<div class="sdl-build-head"><span class="sdl-build-title">${escapeHtml(headerText(b))}</span>${expBtn}<button type="button" class="sdl-mini" data-sdl-download="${escapeHtml(b.id)}" title="Download this build's lineups as a DraftKings lineup file">Download (${n})</button>${remove}</div>`;
}

/**
 * Recently generated. `v` = {board, builds, ui, savedKeys ({cash, gpp}: Sets of set keys), personOf, exp, confirm, busy}. Builds stay newest first whatever the sort; the sort, Mode, the player box and the chosen men
 * only decide which lineups of each build show and in what order inside it.
 */
function recentBodyHtml(v) {
  const { board, builds, ui } = v;
  if (!builds.length) return `<div class="saved-lineups-empty sdl-empty">${EMPTY_RECENT}</div>`;
  const shown = [];
  let beforePick = 0;
  for (const b of builds.filter((x) => modeMatches(x.mode, ui.mode))) {
    const typed = b.lineups.filter((l) => matchesText(l.slots.map((s) => s.name), ui.text));
    beforePick += typed.length;
    const items = filterLineups(typed, ui.chosen, sdPlayersOf).map((e) => e.item);
    if (items.length) shown.push({ build: b, items: sortItems(items, ui.sort, (l) => slotFigures(l.slots)) });
  }
  const all = shown.flatMap((s) => s.items);
  if (!all.length) return `${filterBarHtml(chipsOf(ui), 0, beforePick)}<div class="saved-lineups-empty sdl-empty">${ui.chosen.length ? NO_MATCH_TEXT : NO_FILTER_MATCH}</div>`;
  // The exposure column is one build's, as Showdown has it (that build's Min / Max marks, its Captain and FLEX counted apart): the one picked with a header's Exposure button, else the newest on screen after the Mode filter.
  const of = shown.find((s) => s.build.id === ui.exposureBuild) ?? shown[0];
  const whole = of.items.length === of.build.lineups.length && of.build.lineups.length === of.build.made && of.build.made >= (of.build.marks?.asked ?? Infinity);
  const exposure = `<div class="sdl-exp-title">${escapeHtml(headerText(of.build))}</div>${exposureHtml(of.items, board, v.exp, whole ? of.build.marks : null, pickOf(ui), ui.chosen.length ? beforePick : null, "built")}`;
  const blocks = shown.map(({ build: b, items }) => {
    const cash = b.mode === "cash";
    const cards = items.map((l) => cardHtml(l, l.index, { cash, basis: b.basis, objective: b.objective, busy: v.busy, saved: isSaved(l, v.savedKeys[b.mode], v.personOf), board, confirm: v.confirm ?? null })).join("");
    const bends = items.length === b.lineups.length && b.lineups.length === b.made ? bendsLineHtml(b.bends, b.made) : "";
    return `<section class="sdl-build" data-build="${escapeHtml(b.id)}">${buildHeadHtml(b, ui, b.id === of.build.id)}${buildInfoHtml(b)}<div class="opt-cards sdl-cards">${cards}</div>${bends}</section>`;
  }).join("");
  return `${filterBarHtml(chipsOf(ui), all.length, beforePick)}<div class="sdl-grid"><aside class="sdl-exposure">${exposure}</aside><div class="sdl-main">${blocks}</div></div>`;
}

/** Saved: `v` adds {saved: {loaded, error, lineups}, cardOf(lineup, numbers), dk: {selected, status}}. Most recently saved first; the saved cards draw the live board as they do everywhere. */
function savedBodyHtml(v) {
  const { board, ui, saved } = v;
  if (!saved.loaded) return `<div class="saved-lineups-loading">Loading…</div>`;
  if (saved.error) return `<div class="saved-lineups-empty saved-lineups-error">${escapeHtml(saved.error)}</div>`;
  if (!saved.lineups.length) return `<div class="saved-lineups-empty sdl-empty">${EMPTY_SAVED}</div>`;
  const index = boardIndex(board);
  const nameOf = (l) => savedView(l, index).slots.map((s) => s.name);
  const typed = recentFirst(saved.lineups).filter((l) => modeMatches(lineupModeOf(l), ui.mode) && matchesText(nameOf(l), ui.text));
  const picked = filterLineups(typed, ui.chosen, (l) => sdPlayersOf(savedView(l, index))).map((e) => e.item);
  if (!picked.length) return `${filterBarHtml(chipsOf(ui), 0, typed.length)}<div class="saved-lineups-empty sdl-empty">${ui.chosen.length ? NO_MATCH_TEXT : NO_FILTER_MATCH}</div>`;
  const shown = sortItems(picked, ui.sort, (l) => savedFigures(l, board));
  const numbers = numberLineups(saved.lineups);
  const exposure = exposureHtml(shown.map((l) => savedView(l, index)), board, v.exp, null, pickOf(ui), ui.chosen.length ? typed.length : null, "saved");
  const dk = dkDownloadHtml({ count: shown.filter((l) => v.dk.selected.has(l.id)).length, total: shown.length, status: v.dk.status });
  return `${filterBarHtml(chipsOf(ui), shown.length, typed.length)}<div class="sdl-grid"><aside class="sdl-exposure">${exposure}</aside><div class="sdl-main" id="sd-saved-lineups">${dk}<div class="saved-lineups-list sdl-cards">${shown.map((l) => v.cardOf(l, numbers)).join("")}</div></div></div>`;
}

/** The lineups the Saved view shows after the player box, Mode, the chosen men and the sort (what its Download DK CSV acts on). */
export function savedShown(saved, ui, board) {
  const index = boardIndex(board);
  const typed = recentFirst(saved).filter((l) => modeMatches(lineupModeOf(l), ui.mode) && matchesText(savedView(l, index).slots.map((s) => s.name), ui.text));
  const picked = filterLineups(typed, ui.chosen, (l) => sdPlayersOf(savedView(l, index))).map((e) => e.item);
  return sortItems(picked, ui.sort, (l) => savedFigures(l, board));
}

/** The body under the bar: the sentences (a store note, a save's answer), the chosen men's chips, then the view. */
export function bodyHtml(v) {
  const view = viewOf(v.ui, v.builds);
  const notes = [v.note ? statusLineHtml(v.note, "warn") : "", v.ui.msg ? statusLineHtml(v.ui.msg.text, v.ui.msg.tone ?? "warn") : ""].join("");
  return `${notes}${view === "recent" ? recentBodyHtml(v) : savedBodyHtml(v)}`;
}
