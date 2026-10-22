// The Showdown game's Entries tab (Showdown Entries plan 2026-10-20, step 4; data/findings/showdown-entries-plan-2026-10-20.md 2(3)).
// The second instance of the shared Entries layer (entries-wire.js createEntriesWire): its own api functions, storage namespace, ids
// and empty-list sentence, the game's complete saved lineups from getShowdownLineups(key), and the Captain-aware file key
// (entries-plan.js showdownFileKeyOf) in place of classic's second-slates array. Classic's instance is never touched.
import { createEntriesWire } from "../entries-wire.js";
import { showdownFileKeyOf } from "../entries-plan.js";
import { currentSummary, cellName } from "../entries.js";
import { lineupLabel } from "../lineup-tags.js";
import { escapeHtml } from "../format.js";
import { getShowdownLineups, getShowdownEntries, postShowdownEntriesUpload, postShowdownEntriesExport } from "./api.js";
import { requestFailureText } from "./read-json.js";

export const SHOWDOWN_ENTRIES_NS = "nfldfs.sdentries";
/** No file yet for the game on screen; this tab's Optimizer button is "Make", so it names no Build step. */
export const SHOWDOWN_ENTRIES_EMPTY_TEXT = "No entries file uploaded yet for this game. Upload your DraftKings Showdown entries file with the button above, or from any Upload button.";
/** A file is loaded but the game has no saved lineup: this Optimizer's button is "Make". */
export const SHOWDOWN_ENTRIES_NO_LINEUPS_TEXT = "Save lineups in the Optimizer first (Make, then Save all); the entries fill themselves after that.";

// The game on screen and what the tab shows for it. `lineups` are that game's saved lineups (all of them, so the numbers are the game's own
// numberLineups; only the complete ones are proposed, entries-plan.js orderedFillLineups); `sig` is the last list drawn.
const current = { key: null, board: null, lineups: [], loaded: false, error: null, sig: "", inFlight: null };
let lastUpload = null; // the newest upload's answer, so the page can open the game the server matched

/** "In the file now" for a Showdown entry: cell 1 of the roster is the Captain (the file's CPT column), the other five FLEX.
 *  "Christian McCaffrey (CPT) + 5 more", hover "CPT Christian McCaffrey · FLEX Brock Purdy, …"; blank and unreadable rows read as classic's. */
export function showdownSummary(current) {
  const base = currentSummary(current);
  const cpt = Array.isArray(current) ? cellName(current[0]) : "";
  if (base.text === "Blank" || cpt === "") return base;
  const flex = current.slice(1).map(cellName).filter(Boolean);
  return { text: flex.length ? `${cpt} (CPT) + ${flex.length} more` : `${cpt} (CPT)`, title: `CPT ${cpt}${flex.length ? ` · FLEX ${flex.join(", ")}` : ""}` };
}

/** The saved Showdown lineup's Captain by his slot's name (the board's row when the slot carries none); "" when it has no Captain slot. */
function captainNameOf(lineup) {
  const slot = (Array.isArray(lineup?.slots) ? lineup.slots : []).find((s) => String(s?.slot ?? "").trim().toUpperCase() === "CPT");
  if (!slot) return "";
  const row = (current.board?.rows ?? []).find((r) => String(r.id) === String(slot.playerId) || (r.cptId != null && String(r.cptId) === String(slot.playerId)));
  return String(slot.name ?? row?.name ?? "").trim();
}

/** "1 · Lineup 1 · CPT McCaffrey": the lineup's label plus its Captain by last name (the picker is 459px wide and a full name does not fit).
 *  The same six men under another Captain are another lineup, so the Captain is part of the label everywhere a lineup is named. */
export function showdownLineupLabel(lineup, numbers) {
  const cpt = captainNameOf(lineup);
  const last = cpt.split(/\s+/).slice(1).join(" ") || cpt;
  return cpt ? `${lineupLabel(lineup, numbers)} · CPT ${last}` : lineupLabel(lineup, numbers);
}

const wire = createEntriesWire({
  ns: SHOWDOWN_ENTRIES_NS,
  sectionId: "sd-entries-section",
  fileInputId: "sd-entries-file",
  emptyText: SHOWDOWN_ENTRIES_EMPTY_TEXT,
  noLineupsText: SHOWDOWN_ENTRIES_NO_LINEUPS_TEXT,
  // The pickers and the fill offer the complete lineups only (six resolvable file ids), the ones the server will not refuse on Download;
  // the numbers still run over all of the game's saved lineups (numberOverFor), so a lineup keeps the number the game gives it.
  lineupsFor: (saved) => {
    const fileIds = showdownFileKeyOf(current.board?.rows);
    return saved.filter((l) => fileIds(l) !== null);
  },
  numberOverFor: (saved) => saved, // the list is already this game's
  summaryOf: showdownSummary,
  lineupLabelOf: showdownLineupLabel,
  api: {
    list: () => getShowdownEntries(current.key),
    upload: async (csv) => {
      lastUpload = await postShowdownEntriesUpload(csv);
      return lastUpload;
    },
    exportFile: (payload) => postShowdownEntriesExport(current.key, payload),
  },
});

/** The header's routing for this tab's own Upload button (app-showdown.js setRouteDkFile). */
export const setShowdownEntriesUploadRouter = wire.setUploadRouter;

/** The Showdown entries file's text to the server; the tab's list reloads when the tab has been drawn. Answers { ok: true, entries,
 *  contests, key } (key: the game the server matched) or { ok: false, message }. */
export async function uploadShowdownEntries(text) {
  lastUpload = null;
  const r = await wire.uploadEntriesText(text);
  return r.ok ? { ...r, key: lastUpload?.key ?? null } : r;
}

/** Binds the wire to the game on screen: a new key resets its state and starts its list read, so an answer for a game left behind is
 *  ignored by the wire's own key check (🔵 step 4 review). `current.lineups` is empty until the lineup read lands; stored picks cope. */
function wireTo(container) {
  wire.wireEntries(container, { weekKey: current.key, getSaved: () => current.lineups, getFileContext: () => showdownFileKeyOf(current.board?.rows) });
}

function draw(container) {
  const fileIds = showdownFileKeyOf(current.board?.rows);
  const notice = current.error ? `<div class="lineup-status lineup-status-error">${escapeHtml(current.error)}</div>` : "";
  container.innerHTML = notice + wire.renderEntriesSection(current.lineups, fileIds, current.key);
  wireTo(container);
}

/** Test hook: the state of a fresh page (no game on screen, no upload router, nothing loaded). */
export function resetShowdownEntriesForTests() {
  Object.assign(current, { key: null, board: null, lineups: [], loaded: false, error: null, sig: "", inFlight: null });
  lastUpload = null;
  wire.setUploadRouter(null);
  wire.wireEntries({ querySelector: () => null }, { weekKey: null, getSaved: () => [] });
}

/** Reads the game's saved lineups; draws again only when the list differs from the one on screen. Never rejects. */
async function loadLineups(container, key) {
  if (current.inFlight === key) return;
  current.inFlight = key;
  let lineups = [];
  let error = null;
  try {
    const data = await getShowdownLineups(key);
    if (!data || data.ok === false) error = data?.error?.message ?? "Could not load the saved lineups.";
    else lineups = Array.isArray(data.lineups) ? data.lineups : [];
  } catch (e) {
    error = requestFailureText(e);
  }
  if (current.inFlight === key) current.inFlight = null;
  if (current.key !== key) return; // another game took over while the request was out
  const sig = JSON.stringify([lineups, error]);
  const first = !current.loaded;
  current.loaded = true;
  if (!first && sig === current.sig) return;
  current.sig = sig;
  current.lineups = lineups;
  current.error = error;
  draw(container);
}

/** The Entries tab of the Showdown game `key`, drawn into `container`. The saved lineups are read each time the tab is drawn (a lineup saved
 *  in the Optimizer shows when Adam returns); until the first read lands the tab says it is loading. */
export function renderShowdownEntriesPanel(container, board, key) {
  const newGame = current.key !== key;
  if (newGame) Object.assign(current, { key, lineups: [], loaded: false, error: null, sig: "" });
  current.board = board;
  if (newGame) wireTo(container); // the wire leaves the old game now (its section, if any, is replaced just below)
  // The placeholder is not the wire's section (no sd-entries-section id), so a list that lands before the lineups draws nothing here.
  if (current.loaded) draw(container);
  else container.innerHTML = `<div class="entries-section" id="sd-entries-loading"><div class="entries-empty">Loading the saved lineups…</div></div>`;
  loadLineups(container, key);
}
