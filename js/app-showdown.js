// The mode row, the Showdown list and upload, and applyMode (moved out of public/app.js unchanged; app.js calls configureShowdown first).
import { store, slateKeyFromHashString } from "./state.js";
import { renderModeRow } from "./header.js";
import { getShowdowns, postShowdownUpload } from "./showdown/api.js";
import { renderShowdownView, showdownKeyFromHash, forceReloadShowdown, showUploadPills, openShowdownTab } from "./showdown/view.js";
import { uploadShowdownEntries, setShowdownEntriesUploadRouter } from "./showdown/entries.js";
import { renderShowdownTab } from "./showdown-tab.js";
import { shownTab, onSitePage } from "./tabs.js";
import { syncExpandUi } from "./expand.js";

// What the moved code used to close over in app.js: the element map and three app.js functions.
let el;
let renderFilterBarNow;
let renderDynamic;
let renderSlateChrome;

export function configureShowdown(ctx) {
  ({ el, renderFilterBarNow, renderDynamic, renderSlateChrome } = ctx);
}

// ---------------------------------------------------------------------------------------------------
// Mode row (Showdown, D39/D40): a tile per loaded showdown plus "Main slate" and "Upload Showdown CSV",
// always visible above the classic game strip. app.js owns location.hash's "#sd=<key>" and the
// classic-vs-showdown visibility toggle; public/js/showdown/view.js owns everything drawn inside the
// showdown header/main once a key is active.
// ---------------------------------------------------------------------------------------------------
let showdownList = [];
let showdownListError = null; // 🔵 2026-10-17: a failed list read is "unknown" (the message), never an empty list shown as "none loaded"
let showdownListRead = false; // 🔵 2026-10-17 (cold read is unknown): false until the first list read returns, so the tab says "reading", not "none loaded"

function mainSlateLabel() {
  const games = store.get().board?.slate?.games?.length;
  return games != null ? `Main slate · ${games} game${games === 1 ? "" : "s"}` : "Main slate";
}

// The showdown buttons take any DraftKings export (Adam 2026-10-18): the file goes through the header's routing, which
// calls uploadShowdownText below for a showdown file. Set when wireUpload runs.
let routeDkFile = null;
export function setRouteDkFile(fn) {
  routeDkFile = fn;
  setShowdownEntriesUploadRouter(fn); // the Showdown Entries tab's own Upload button takes any DraftKings export too (its instance has its own router)
}
async function uploadShowdownCsv(file) {
  await routeDkFile?.(file);
}

// The one showdown-CSV upload, used by the mode row's tile and the Showdown tab's button (ChatGPT wish t, Adam 2026-10-17).
// Answers { ok: true } when the showdown was saved, else { ok: false, message }; the header's handleFile writes the status line
// (setUploadStatus, 🔵 2026-10-18: one copy of the rule that puts it where Adam is looking).
export async function uploadShowdownText(text) {
  try {
    const data = await postShowdownUpload(text);
    if (data?.ok) {
      await loadShowdownList();
      // The upload's own stale list is shown immediately, before any reload/navigation lands (same as
      // the classic header's wireUpload) — but only when the showdown just uploaded is the one already
      // on screen; otherwise the tile/hash switch below is about to load it fresh anyway.
      if (data.key === showdownKeyFromHash()) {
        showUploadPills(data.stale ?? []);
        await forceReloadShowdown(data.key);
      } else {
        window.location.hash = `sd=${encodeURIComponent(data.key)}`;
      }
      return { ok: true };
    }
    return { ok: false, message: `Showdown upload failed: ${data?.error?.message ?? "unknown error"}` };
  } catch (e) {
    return { ok: false, message: `Showdown upload failed: ${e.message}` };
  }
}

// A Showdown entries file from any upload button (Showdown Entries plan 2026-10-20, step 4): the server matches it to a loaded game; the
// Showdown Entries instance posts it and reloads its list when that tab has been drawn, then the page shows that game's Entries tab
// (the hash first, so a game not on screen loads, with the tab already chosen). Answers as uploadEntriesText does: { ok, entries, contests } or { ok: false, message }.
export async function uploadShowdownEntriesText(text) {
  const r = await uploadShowdownEntries(text);
  if (!r.ok) return r;
  if (!r.key) return { ok: false, message: "The server saved the file but did not say which game it belongs to; open the game's Entries tab." };
  if (r.key !== showdownKeyFromHash()) window.location.hash = `sd=${encodeURIComponent(r.key)}`;
  openShowdownTab("entries");
  return r;
}

export function renderModeRowNow() {
  renderModeRow(el.modeRow, {
    mainLabel: mainSlateLabel(),
    showdowns: showdownList,
    activeKey: showdownKeyFromHash(),
    slates: store.get().board?.slates ?? [],
    activeSlateKey: store.get().activeSlateKey,
    onSelectMain: () => {
      window.location.hash = "";
    },
    onSelectSlate: (key) => {
      window.location.hash = `slate=${encodeURIComponent(key)}`;
    },
    onSelectShowdown: (key) => {
      window.location.hash = `sd=${encodeURIComponent(key)}`;
    },
    onUploadShowdownCsv: uploadShowdownCsv,
  });
}

// The Showdown tab (ChatGPT wish t, Adam 2026-10-17): its games are the whole week's main-slate games (none before an upload,
// whichever slate is on screen; 🔵 2026-10-17) plus the loaded showdowns.
export function renderShowdownTabNow() {
  renderShowdownTab(el.showdownPanel, { games: store.get().board?.slate?.games ?? [], showdowns: showdownList, listError: showdownListError, listRead: showdownListRead, onSite: onSitePage() }, {
    onOpen: (key) => {
      window.location.hash = `sd=${encodeURIComponent(key)}`;
    },
    onUpload: uploadShowdownCsv,
  });
}

export async function loadShowdownList() {
  try {
    const data = await getShowdowns();
    if (data?.ok) {
      showdownList = data.showdowns ?? [];
      showdownListError = null;
    } else {
      showdownList = [];
      showdownListError = data?.error?.message || "the server did not return the list"; // an empty message falls back too (🔵 low)
    }
  } catch (e) {
    showdownList = [];
    showdownListError = e?.message || "the server did not return the list"; // a thrown value with no message is still unknown, never "none loaded" (🔵 low)
  }
  showdownListRead = true; // 🔵 2026-10-17 (cold read is unknown): the first read has returned, by success or failure
  renderModeRowNow();
  if (shownTab(store.get().activeTab) === "showdown") renderShowdownTabNow(); // the list arrives after the first draw
}

// Switches the whole page between the classic slate and a showdown, driven entirely by location.hash so
// the mode survives a reload and is one click away from the mode row at any time.
export function applyMode() {
  const key = showdownKeyFromHash();
  const isShowdown = Boolean(key);
  el.classicHeader.hidden = isShowdown;
  el.classicMain.hidden = isShowdown;
  el.showdownHeader.hidden = !isShowdown;
  el.showdownMain.hidden = !isShowdown;
  // Second slates (D57): "#slate=<key>" keeps the classic app on screen and picks which slate's players it
  // lists; any other hash (none, or a showdown's) is the main slate. A team or game filter names main-slate
  // games, so both are cleared on a switch rather than left hiding every player of the new slate.
  const slateKey = isShowdown ? null : slateKeyFromHashString(window.location.hash);
  if (slateKey !== store.get().activeSlateKey) {
    store.set({ activeSlateKey: slateKey, filters: { ...store.get().filters, teams: new Set(), gameId: null } });
    const board = store.get().board;
    if (board) {
      renderFilterBarNow(board);
      renderDynamic();
    }
  }
  renderSlateChrome();
  renderModeRowNow();
  if (isShowdown) renderShowdownView(key);
  syncExpandUi(); // a showdown hides the classic page: a table expanded there must close, never leave the page locked
}
