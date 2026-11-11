// The Showdown Lineups tab (Adam 2026-11-05): where built lineups go, with Recently generated (the kept builds, lineups-store.js) and Saved (this game's saved lineups, the server's store through lineup.js).
// This file draws the tab into its own panel and wires the bar, the build headers and the built cards; the saved cards' wiring (rename, Load, Download, Delete) and the saved list stay lineup.js's (lineupsHands),
// so they work as they did. Markup: lineups-view.js. Live app and public site alike: nothing here needs the server but the saved lineups and a Save.
import { dkLineupCsv, dkCsvFileName, dkCsvStatus, downloadText } from "../dk-lineup-csv.js";
import { nextExpSort } from "../lineup-exposure.js";
import { toggleMustHave } from "../lineup-filter.js";
import { uniqueSavedName } from "../lineup.js";
import { postShowdownLineup } from "./api.js";
import { requestFailureText } from "./read-json.js";
import { boardIndex, pickChipName } from "./optimizer-state.js";
import { optimizerState } from "./optimizer.js";
import { saveExp } from "./view-memory.js";
import { lineupsHands, setLineupsRedraw } from "./lineup.js";
import { keptBuilds, keptNote, findKept, removeKeptBuild, discardKeptLineup, onKeptChange, savedKeySet, isSaved, saveBodyFor, SORT_KEYS } from "./lineups-store.js";
import { takeWantedView } from "./lineups-nav.js";
import { freshUi, controlBarHtml, bodyHtml, savedShown, shownRecentUids } from "./lineups-view.js";
import { nextSort } from "../lineup-sort.js"; // the one sort-click rule (classic's): the lit key reverses, another starts in its own direction
import { saveOutcome, isAlreadySavedAnswer } from "../save-outcome.js";

let ui = freshUi();
let uiKey = null; // the game the bar's choices belong to
let last = null; // {container, board, key}: what the last draw was given
let saving = false;
let textTimer = null; // the player box's pause before the lists redraw
export const TEXT_PAUSE_MS = 150;

const redraw = () => { if (last && !last.container.hidden) draw(); };
setLineupsRedraw(redraw); // a saved card's rename, delete or load in lineup.js redraws this tab too
onKeptChange(redraw); // a Build, Discard or Remove build redraws it when it is on screen

function viewData(hands) {
  const { board, key } = last;
  const index = boardIndex(board);
  const saved = hands.saved;
  return {
    board, ui, builds: keptBuilds(key), note: keptNote(key), saved, personOf: index.personOf,
    savedKeys: { cash: savedKeySet(saved.lineups, "cash", index.personOf), gpp: savedKeySet(saved.lineups, "gpp", index.personOf) },
    exp: optimizerState().exp, confirm: hands.confirm, busy: saving || hands.busy, cardOf: hands.cardOf, dk: hands.dk,
  };
}

function setMsg(text, tone = "warn") {
  ui.msg = text ? { text: String(text).replace(/\n+/g, " "), tone } : null;
}

/** Draws the whole tab: the bar, then the body. */
function draw() {
  const { container, board, key } = last;
  clearTimeout(textTimer); // a draw shows the typed text itself
  const box = container.querySelector("#sdl-text");
  const typing = box && typeof document !== "undefined" && document.activeElement === box ? { start: box.selectionStart, end: box.selectionEnd } : null; // the player box keeps the keyboard and its caret across the redraw
  const hands = lineupsHands(board, key);
  container.innerHTML = `${controlBarHtml(ui, keptBuilds(key), hands.saved.lineups.length)}<div id="sdl-body">${bodyHtml(viewData(hands))}</div>`;
  wireBar(container, hands);
  wireBody(container, hands);
  hands.focus(container); // an open confirm or rename box takes the keyboard, as it did on the Optimizer tab
  if (typing) {
    const next = container.querySelector("#sdl-text");
    next?.focus?.({ preventScroll: true });
    next?.setSelectionRange?.(typing.start, typing.end);
  }
}

/** Draws the body only (the player box keeps the keyboard while he types). */
function paintBody() {
  if (!last || last.container.hidden) return;
  const { container, board, key } = last;
  const hands = lineupsHands(board, key);
  const body = container.querySelector("#sdl-body");
  body.innerHTML = bodyHtml(viewData(hands));
  wireBody(container, hands); // the body's controls are the only ones its selectors find: the bar keeps its own listeners
}

function wireBar(container, hands) {
  container.querySelectorAll("[data-sdl-view]").forEach((btn) => btn.addEventListener("click", () => {
    ui.view = btn.dataset.sdlView;
    ui.chosen = [];
    ui.names = {};
    ui.confirmRemove = null;
    setMsg("");
    draw();
  }));
  container.querySelectorAll("[data-sdl-sort]").forEach((btn) => btn.addEventListener("click", () => { ui.sort = nextSort(ui.sort, btn.dataset.sdlSort, SORT_KEYS); draw(); })); // a second click on the lit sort reverses it (classic's nextSort)
  container.querySelectorAll("[data-sdl-mode]").forEach((btn) => btn.addEventListener("click", () => { ui.mode = btn.dataset.sdlMode; draw(); }));
  container.querySelector("#sdl-text")?.addEventListener("input", (e) => { // the lists redraw once typing pauses (the same 150 ms as the filter bars), not on every key
    ui.text = e.target.value;
    clearTimeout(textTimer);
    textTimer = setTimeout(paintBody, TEXT_PAUSE_MS);
  });
}

function wireBody(body, hands) { // `body`: the tab's box (the body's controls are found by their own attributes)
  const { board, key } = last;
  body.querySelectorAll("[data-sd-opt-save]").forEach((btn) => btn.addEventListener("click", () => saveBuilt([btn.dataset.sdOptSave])));
  body.querySelector("[data-sdl-save-all]")?.addEventListener("click", () => saveBuilt(shownRecentUids(viewData(lineupsHands(board, key))))); // Save all unsaved: every shown card, the saved ones skipped and counted
  body.querySelectorAll("[data-sd-opt-load]").forEach((btn) => btn.addEventListener("click", () => hands.requestLoad(btn.dataset.sdOptLoad)));
  body.querySelectorAll("[data-sd-opt-discard]").forEach((btn) => btn.addEventListener("click", () => discardKeptLineup(key, btn.dataset.sdOptDiscard)));
  body.querySelectorAll("[data-sdl-exposure]").forEach((btn) => btn.addEventListener("click", () => { ui.exposureBuild = btn.dataset.sdlExposure; paintBody(); }));
  body.querySelectorAll("[data-sdl-download]").forEach((btn) => btn.addEventListener("click", () => downloadBuild(btn.dataset.sdlDownload)));
  body.querySelectorAll("[data-sdl-remove]").forEach((btn) => btn.addEventListener("click", () => { ui.confirmRemove = btn.dataset.sdlRemove; paintBody(); }));
  body.querySelectorAll("[data-sdl-remove-no]").forEach((btn) => btn.addEventListener("click", () => { ui.confirmRemove = null; paintBody(); }));
  body.querySelectorAll("[data-sdl-remove-yes]").forEach((btn) => btn.addEventListener("click", () => { ui.confirmRemove = null; removeKeptBuild(key, btn.dataset.sdlRemoveYes); }));
  // The exposure table: a header sorts it, a Seat chip filters it (one state with the Optimizer's, kept per game), a Filter button picks a man in a seat (D77).
  body.querySelectorAll("[data-action='opt-exp-sort']").forEach((th) => th.addEventListener("click", () => {
    const o = optimizerState();
    o.exp = nextExpSort(o.exp, th.dataset.col, "seats");
    saveExp(o.key, o.exp);
    paintBody();
  }));
  body.querySelectorAll("[data-action='opt-exp-filter']").forEach((chip) => chip.addEventListener("click", () => {
    const o = optimizerState();
    o.exp = { ...o.exp, filter: chip.dataset.filter };
    saveExp(o.key, o.exp);
    paintBody();
  }));
  body.querySelectorAll("[data-action='opt-pick']").forEach((btn) => btn.addEventListener("click", () => {
    const k = btn.dataset.pickId;
    if (!k) return;
    if (!ui.chosen.includes(k)) ui.names[k] = pickChipName(k, btn.dataset.pickName);
    ui.chosen = toggleMustHave(ui.chosen, k);
    paintBody();
  }));
  body.querySelectorAll("[data-action='opt-pick-remove']").forEach((btn) => btn.addEventListener("click", () => { ui.chosen = toggleMustHave(ui.chosen, btn.dataset.pickKey); paintBody(); }));
  body.querySelectorAll("[data-action='opt-pick-clear']").forEach((btn) => btn.addEventListener("click", () => { ui.chosen = []; paintBody(); }));
  hands.wireSaved(body, () => savedShown(hands.saved.lineups, ui, board));
}

/**
 * Save on a built card, and Save all unsaved (the shown cards not yet saved): each in its build's own mode, not the tab on screen. A card already saved is skipped, never sent
 * again and never refused (Adam 6:30 PM 11-09), and reads Saved ✓ (matched against the saved list, the server's answer; one answered "already saved" makes the list be read again).
 * The run says what it saved, what it skipped and what it could not save (save-outcome.js); a single card says nothing unless it failed. Saved marks what this run saved.
 */
async function saveBuilt(uids) {
  if (saving || !last || !uids.length) return;
  const { board, key } = last;
  const index = boardIndex(board);
  saving = true;
  try {
    setMsg("");
    paintBody();
    const skipped = [];
    const failed = [];
    const justSaved = [];
    const answeredSaved = [];
    let saved = 0;
    let stopped = null; // the reason the run stopped: every card after it is listed as not saved with it (G62)
    for (const uid of uids) {
      if (last?.key !== key) break; // another game on screen now: nothing of this run is shown there
      const found = findKept(key, uid);
      if (!found) { failed.push({ name: "a lineup", reason: "it is no longer on the list" }); continue; }
      const { build, lineup } = found;
      const stem = build.mode === "cash" ? "Cash" : "Lineup";
      const cardName = `${stem} ${lineup.index + 1}`;
      const hands = lineupsHands(board, key); // read each time: the list grows as the run saves
      // Already saved is checked before a stop, so a saved card is never listed as "Not saved".
      if (isSaved(lineup, savedKeySet(hands.saved.lineups, build.mode, index.personOf), index.personOf) || ui.knownSaved.has(uid)) { skipped.push(cardName); continue; }
      if (stopped) { failed.push({ name: cardName, reason: stopped }); continue; }
      try {
        const name = uniqueSavedName(cardName, hands.saved.lineups.map((l) => l.name), stem);
        const data = await postShowdownLineup(key, saveBodyFor(build, lineup, name));
        if (last?.key !== key) break;
        if (isAlreadySavedAnswer(data)) { skipped.push(cardName); answeredSaved.push({ uid, build, lineup }); continue; }
        if (!data || data.ok === false) { stopped = data?.error?.message ?? "Could not save the lineup."; failed.push({ name: cardName, reason: stopped }); continue; }
        if (Array.isArray(data.lineups)) hands.setSaved(data.lineups);
        if (data.lineup?.id) justSaved.push(data.lineup.id);
        saved++;
      } catch (e) {
        stopped = requestFailureText(e);
        failed.push({ name: cardName, reason: stopped });
      }
    }
    if (last?.key === key) {
      const hands = lineupsHands(board, key);
      if (answeredSaved.length) { // saved from another tab or device since this list was read: read it again; a card it still cannot show reads Saved ✓ all the same
        await hands.reread();
        const now = lineupsHands(board, key).saved.lineups;
        for (const a of answeredSaved) if (!isSaved(a.lineup, savedKeySet(now, a.build.mode, index.personOf), index.personOf)) ui.knownSaved.add(a.uid);
      }
      hands.markJustSaved(justSaved);
      const said = saveOutcome({ asked: uids.length, saved, skipped, failed });
      setMsg(said.text, said.tone);
    }
  } finally {
    saving = false; // a throw anywhere in the run never leaves Save stuck off
    redraw();
  }
}

/** Download (n) on a build header: that build's lineups as a DraftKings file (the same file the saved lineups' Download DK CSV writes). */
function downloadBuild(id) {
  const { board, key } = last;
  const build = keptBuilds(key).find((b) => b.id === id);
  if (!build) return;
  const stem = build.mode === "cash" ? "Cash" : "Lineup";
  const made = dkLineupCsv({ kind: "showdown", lineups: build.lineups.map((l) => ({ ...l, name: `${stem} ${l.index + 1}` })), board, slateKey: key });
  if (made.text) downloadText(dkCsvFileName(`${key}-${build.mode}`), made.text);
  setMsg(made.text ? dkCsvStatus(made) : `Nothing was downloaded. ${dkCsvStatus(made)}`, made.text && !made.skipped.length ? "notice" : "warn");
  paintBody();
}

/** view.js calls this each time the Lineups tab is on screen. */
export function renderShowdownLineupsPanel(container, board, key) {
  last = { container, board, key };
  if (key !== uiKey) {
    uiKey = key;
    ui = freshUi();
  }
  const wanted = takeWantedView(); // the Optimizer's "N lineups built: open Lineups" asks for Recently generated
  if (wanted) {
    ui.view = wanted;
    ui.chosen = [];
    ui.names = {};
    ui.text = "";
    setMsg("");
  }
  draw();
}

/** Test hook: the bar's state. */
export const lineupsUi = () => ui;
