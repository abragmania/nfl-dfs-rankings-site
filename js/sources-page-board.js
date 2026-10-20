// The Sources page where there is no /api/source-selection: the public site and sample data (D71). The page is built from the board it
// already holds (selectionFromBoard). On the site a tick or a weight is kept in the visitor's browser and the board re-ranks there
// (site-src/api.js postSources -> site-weights.js, per season and week); nothing is sent to a server. Also the names a source gave that
// matched nobody on the slate (D27), which the rows show as a small expander.
import { escapeHtml } from "./format.js";
import { activeSlateRows } from "./state.js";
import { slateTeamSet, unmatchedPartsHtml } from "./unmatched.js";
import { sourceIsTicked } from "./sources-page-html.js";
import { SHORT_LABEL } from "./source-labels.js";

export const SAMPLE_NOTE = "This is sample data, so the sources cannot be changed here.";
export const SHOWDOWN_SITE_NOTE = "Showdown source choices are made in the app. This shows the sources the published board was built from.";
export const SITE_QUIET = "Changes re-rank the board in your browser from the data published with it. They are kept in this browser only.";
const TWOGUN_WHY = "In TwoGun mode his figures are used as he publishes them; pick Our sources above to change these.";
const OFF_WHY = "This source was switched off when the board was published, so nothing was pulled for it.";
const MODE_OF = { twogun: "twogun", ours: "current" };

// Board source status -> the page's: the board says live/file/ok for a good pull, stale for a kept copy (as server/sources/selection-view.js does).
const BOARD_STATUS = { ok: "ok", live: "ok", file: "ok", stale: "cached", failed: "failed" }; // anything else ("not run", "disabled", ...) reads "not fetched"

/** Whether a board source's weight was changed in this browser (site-weights.js boardWithWeights leaves the published one beside it). */
export const isLocallyChanged = (s) => s.publishedWeight != null && Number(s.publishedWeight) !== Number(s.weight);

function boardRow(s, total, edit) {
  const positive = [Number(s.weight), Number(s.publishedWeight ?? s.weight)].find((w) => Number.isFinite(w) && w > 0);
  const can = edit.on && s.readOnly !== true && s.enabled !== false;
  const whyNot = can ? null : !edit.on ? edit.note : s.readOnly === true ? TWOGUN_WHY : OFF_WHY;
  return {
    id: s.id, label: s.label ?? s.id, use: sourceIsTicked(s), weight: positive ?? 1,
    canTick: can, whyNot, lastPulled: s.fetchedAt ?? null,
    posted: s.pageUpdated ? { text: String(s.pageUpdated), where: null } : null,
    coverage: Number.isFinite(s.matchedCount) && total > 0 ? { matched: s.matchedCount, total } : null,
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
 * are kept in the browser; otherwise (a Showdown board on the site, sample data) the page is read-only with `opts.note` saying why.
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
    // public site that Showdown choices are made in the app (D71), on sample data that nothing can be changed.
    scopeKind: showdown ? "showdown" : "classic",
  };
}

// ---------- saving on the site ----------

/**
 * The page's api (get/post) for the public site: a change becomes a weight kept in this browser. `fns`: { getBoard, postSources, postMode }
 * (public/js/api.js, which is site-src/api.js on the site). A tick off is a weight of 0 (the site's way of leaving a source out); a tick back
 * on gives the published weight, or 1 when that was 0. A preset puts every weight back and switches the board (Current | TwoGun).
 */
export function makeSiteApi(fns) {
  const must = (board) => {
    if (!board || board.ok === false || !Array.isArray(board.sources)) throw new Error(board?.error?.message ?? "The board could not be read.");
    return board;
  };
  const answer = (board) => selectionFromBoard(must(board), false, { edit: true });
  const putBack = async () => {
    const patches = must(await fns.getBoard()).sources.filter(isLocallyChanged).map((s) => ({ id: s.id, weight: Number(s.publishedWeight) }));
    return patches.length ? must(await fns.postSources(patches)) : null;
  };
  const preset = async (key) => {
    const mode = MODE_OF[key];
    if (!mode) throw new Error("That preset is not one the site has.");
    const board = must((await putBack()) ?? (await fns.getBoard()));
    return board.mode?.active === mode ? board : must(await fns.postMode(mode));
  };
  const weightOf = (src, change) => {
    if (change.weight !== undefined) return change.weight;
    if (!change.use) return 0;
    const published = Number(src.publishedWeight ?? src.weight);
    return published > 0 ? published : 1;
  };
  return {
    get: async () => answer(await fns.getBoard()),
    post: async (_slate, change) => {
      if (change.reset) return answer((await putBack()) ?? (await fns.getBoard()));
      if (change.preset) return answer(await preset(change.preset));
      const src = must(await fns.getBoard()).sources.find((s) => s.id === change.sourceId);
      if (!src) throw new Error(`"${change.sourceId}" is not a source on the published board.`);
      return answer(await fns.postSources({ id: src.id, weight: weightOf(src, change) }));
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
