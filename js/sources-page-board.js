// The Sources page where there is no /api/source-selection: the public site and sample data (D71). The page is built from the board it
// already holds (selectionFromBoard). On the site a tick or a weight is kept in the visitor's browser and the board re-ranks there
// (site-src/api.js postSources -> site-weights.js, per season and week); nothing is sent to a server. A Showdown game's page on the site
// keeps its choices the same way (makeSiteShowdownApi -> site-src/site-sd-sources.js, per game) and shows this read-only board-built page only
// for a game whose inputs were not published. Also the names a source gave that
// matched nobody on the slate (D27), which the rows show as a small expander.
import { escapeHtml } from "./format.js";
import { activeSlateRows } from "./state.js";
import { slateTeamSet, unmatchedPartsHtml } from "./unmatched.js";
import { sourceIsTicked } from "./sources-page-html.js";
import { SHORT_LABEL } from "./source-labels.js";

export const SAMPLE_NOTE = "This is sample data, so the sources cannot be changed here.";
export const SHOWDOWN_SITE_NOTE = "This game's source choices are made in the app: its inputs were not published with it. This shows the sources the published board was built from.";
export const SITE_QUIET = "Changes re-rank the board in your browser from the data published with it. They are kept in this browser only.";
const OFF_WHY = "This source was switched off when the board was published, so nothing was pulled for it.";
const MODE_OF = { twogun: "twogun", ours: "current" };

// Board source status -> the page's: the board says live/file/ok for a good pull, stale for a kept copy (as server/sources/selection-view.js does).
const BOARD_STATUS = { ok: "ok", live: "ok", file: "ok", stale: "cached", failed: "failed" }; // anything else ("not run", "disabled", ...) reads "not fetched"

/** Whether a board source's weight, or the weight it keeps while unticked, was changed in this browser (site-weights.js boardWithWeights leaves the published ones beside them). */
export const isLocallyChanged = (s) => (s.publishedWeight != null && Number(s.publishedWeight) !== Number(s.weight))
  || (s.publishedStoredWeight != null && s.storedWeight != null && Number(s.publishedStoredWeight) !== Number(s.storedWeight));

function boardRow(s, total, edit) {
  const positive = [Number(s.weight), Number(s.publishedWeight ?? s.weight)].find((w) => Number.isFinite(w) && w > 0);
  const can = edit.on && s.enabled !== false;
  const whyNot = can ? null : !edit.on ? edit.note : OFF_WHY;
  // TwoGun's cards count as the app's page counts them (selection-view.js twogunRow): the men his board matched, or for ownership the men he lists a number for.
  const matched = s.id === "twogun" ? (s.kind === "ownership" ? s.recordCount : s.matched) : s.matchedCount;
  return {
    id: s.id, label: s.label ?? s.id, use: sourceIsTicked(s), weight: Number(s.storedWeight) > 0 ? Number(s.storedWeight) : positive ?? 1, // an unticked source shows the weight it keeps
    canTick: can, whyNot, lastPulled: s.fetchedAt ?? null,
    posted: s.pageUpdated ? { text: String(s.pageUpdated), where: null } : null,
    coverage: Number.isFinite(matched) && total > 0 ? { matched, total } : null,
    status: BOARD_STATUS[s.status] ?? "not fetched", note: s.note ?? "",
  };
}

// The classic Ownership box shows a source's short name with its own label as the hover (labelFull), as the app's page does (👁 round 5, V5).
const shortNamed = (kind, row) => (kind === "ownership" && SHORT_LABEL[row.id] && SHORT_LABEL[row.id] !== row.label ? { ...row, label: SHORT_LABEL[row.id], labelFull: row.label } : row);

const boardSection = (kind, title, method, list, total, edit) => ({ kind, title, method, gaps: null, sources: list.map((s) => shortNamed(kind, boardRow(s, total, edit))) });

function presetOf(mode, changed) {
  if (mode == null) return null; // the board does not say: the page draws no preset control
  if (changed > 0) return "custom";
  return mode === "twogun" ? "twogun" : mode === "current" ? "ours" : "custom";
}

/**
 * The selection shape built from the board a page already holds. `opts.edit`: true on the public site's classic page, where ticks and weights
 * are kept in the browser; otherwise (a Showdown game whose inputs were not published, sample data) the page is read-only with `opts.note` saying why.
 * A kicker card is not a row. "posted" is the card's pageUpdated where it has one, else not stated.
 */
export function selectionFromBoard(board, showdown, opts = {}) {
  const edit = { on: Boolean(opts.edit) && !showdown, note: opts.note ?? (showdown ? SHOWDOWN_SITE_NOTE : SAMPLE_NOTE) };
  const total = (board?.rows ?? []).length;
  const sources = board?.sources ?? [];
  const sections = [boardSection("projection", "Projections", board?.recipes?.projection ?? "", sources.filter((s) => s.kind === "projection"), total, edit)];
  if (showdown) {
    const own = (board?.ownershipSources ?? []).map((s) => ({ ...s, matchedCount: (s.rows ?? []).length, status: s.status ?? ((s.rows ?? []).length ? "ok" : "not run") }));
    sections.push(boardSection("sdOwnFlex", "Ownership, FLEX", "", own, total, edit), boardSection("sdOwnCpt", "Ownership, Captain", "", own, total, edit));
  } else {
    sections.push(boardSection("ownership", "Ownership", board?.recipes?.ownership ?? "", sources.filter((s) => s.kind === "ownership"), total, edit));
  }
  const changed = edit.on ? sources.filter(isLocallyChanged).length : 0;
  return {
    preset: presetOf(board?.mode?.active, changed), appliesTo: "", writable: edit.on, note: edit.on ? "" : edit.note,
    quiet: edit.on ? SITE_QUIET : "", sections, shownOnly: [], siteLocal: { changed },
    // Each game keeps its own choices (Adam 2026-10-20): a Showdown page says so and keeps its "apply to every game" button. A page built
    // here is never editable for a Showdown game (edit.on is false), so the button is drawn disabled, and the page's note says why: on the
    // public site that this game's inputs were not published (D71), on sample data that nothing can be changed.
    scopeKind: showdown ? "showdown" : "classic",
  };
}

// ---------- saving on the site ----------

/**
 * The page's api (get/post) for the public site: a change becomes a weight kept in this browser. `fns`: { getBoard, postSources, postMode }
 * (public/js/api.js, which is site-src/api.js on the site). A tick off is a weight of 0 (unticked, still a backup at its stored weight, as in the app); a tick back
 * on gives the published weight, or 1 when that was 0. A preset puts every weight back and switches the board (Current | TwoGun).
 */
export function makeSiteApi(fns) {
  const must = (board) => {
    if (!board || board.ok === false || !Array.isArray(board.sources)) throw new Error(board?.error?.message ?? "The board could not be read.");
    return board;
  };
  const answer = (board) => selectionFromBoard(must(board), false, { edit: true });
  // Every saved change put back, the weights unticked sources keep with them (the board says it holds changes: siteStored).
  const putBack = async () => (must(await fns.getBoard()).siteStored ? must(await fns.postSources({ resetAll: true })) : null);
  const preset = async (key) => {
    const mode = MODE_OF[key];
    if (!mode) throw new Error("That preset is not one the site has.");
    const board = must((await putBack()) ?? (await fns.getBoard()));
    return board.mode?.active === mode ? board : must(await fns.postMode(mode));
  };
  const weightOf = (src, change) => {
    if (change.weight !== undefined) return change.weight;
    if (!change.use) return 0;
    // Ticking a source gives it the weight the choices keep for it; a kept 0 (or none known) gives 1, as the app does (selection-change.js).
    const stored = Number(src.storedWeight);
    if (stored > 0) return stored;
    const published = Number(src.publishedWeight ?? src.weight);
    return published > 0 ? published : 1;
  };
  return {
    get: async () => answer(await fns.getBoard()),
    post: async (_slate, change) => {
      if (change.reset) return answer((await putBack()) ?? (await fns.getBoard()));
      if (change.preset) return answer(await preset(change.preset));
      // TwoGun has a card in each of the two sections under one id, so the section the click came from picks the card.
      const src = must(await fns.getBoard()).sources.find((s) => s.id === change.sourceId && (change.kind === undefined || s.kind === change.kind));
      if (!src) throw new Error(`"${change.sourceId}" is not a source on the published board.`);
      return answer(await fns.postSources({ id: src.id, kind: src.kind, weight: weightOf(src, change) }));
    },
  };
}

// ---------- a Showdown game's page on the site ----------

/**
 * The page's api (get/post/applyAll) for a Showdown game on the public site (D71): the choices are kept in the visitor's browser and the game's board is made again there
 * (site-src/site-sd-sources.js, reached through the site's postSources with { showdown: <game key>, op }). `fns`: { postSources }. Each call answers the page body the app's
 * route would, or throws the app's own sentence. `probe(slate)` says whether the game's inputs were published: { ok: true } or { problem } (the sentence the read-only page shows).
 */
export function makeSiteShowdownApi(fns) {
  const body = async (patch) => {
    const r = await fns.postSources(patch);
    if (!r || r.ok === false || !r.body) throw new Error(r?.error?.message ?? "The source choices could not be read on this device.");
    // As the classic page on the site: the line that changes are kept in this browser only, and (with the visitor's own choices showing) the count and the one button that puts them back.
    return { ...r.body, quiet: SITE_QUIET, siteLocal: { changed: r.body.siteLocal?.changed ?? 0 } };
  };
  return {
    get: (slate) => body({ showdown: slate, op: "read" }),
    post: (slate, change) => body({ showdown: slate, op: "change", change }),
    applyAll: (slate) => body({ showdown: slate, op: "apply-all" }),
    probe: async (slate) => {
      const r = await fns.postSources({ showdown: slate, op: "probe" });
      return r && r.ok !== false ? { ok: true } : { problem: r?.error?.message ?? SHOWDOWN_SITE_NOTE };
    },
  };
}

// ---------- the names no player matched (D27) ----------

function slateOf(ctx) {
  const board = ctx.board;
  const gameTeams = ctx.showdown ? [board?.game?.away, board?.game?.home].filter(Boolean) : [];
  if (gameTeams.length === 2) return { teams: slateTeamSet(gameTeams.map((team) => ({ team }))), rows: board.rows ?? [] };
  const rows = ctx.showdown ? board?.rows ?? [] : activeSlateRows(board);
  return { teams: slateTeamSet(rows), rows };
}

/**
 * Row key ("projection/sleeper") -> the expander HTML for the names that source gave and no player matched: those that could be on the slate
 * in the open list, the rest behind a closed list with its count (D27 as amended 2026-10-10). A source with none gets no entry. A kicker
 * card "k:<id>" adds its names to the row of the projection source <id>.
 */
export function unmatchedRows(ctx, data) {
  const out = new Map();
  const cards = ctx.board?.sources ?? [];
  const { teams, rows } = slateOf(ctx);
  for (const sec of data?.sections ?? []) {
    if (sec.kind !== "projection" && sec.kind !== "ownership") continue;
    for (const s of sec.sources) {
      const own = cards.find((c) => c.id === s.id && c.kind === sec.kind);
      const kick = sec.kind === "projection" ? cards.find((c) => c.kind === "kicker" && c.id === `k:${s.id}`) : null;
      const names = [...(own?.unmatchedNames ?? []), ...(kick?.unmatchedNames ?? [])];
      const parts = unmatchedPartsHtml(names, teams, rows, escapeHtml);
      if (parts.listHtml || parts.offSlateHtml) out.set(`${sec.kind}/${s.id}`, `${parts.listHtml}${parts.offSlateHtml}`);
    }
  }
  return out;
}
