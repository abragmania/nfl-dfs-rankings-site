// The classic Lineups tab in the approved look (PROJECT.md Part 4 item 5): a summary strip, the Recently generated | Saved switch with the player filter, sort and mode buttons, the exposure panel on the left and the lineup cards on the right. The drawing follows NBA's
// lineups-tab.js and lineups-list.js (NBA commit a39b37e); every figure is NFL's own (look-adapter.js), nothing computed crosses. The state of the screen (which of the two lists, the mode filter, the typed filter) is `ltState`, page-only; `opt` and `state` (lineup.js) own the batches and the saved list.
import { escapeHtml, money, dec1, pct1 } from "./format.js";
import { store } from "./state.js";
import { matchupText } from "./table.js"; // D43: the one copy of "vs DAL" / "@ DET"
import { reseatClassic, kickoffLookup } from "./classic-seat.js";
import { shownTotal } from "./totals.js";
import { buildTypeText } from "./lineup-builds.js";
import { lineupFigures, medianText, sortLineups, effectiveSort, nextSort, LOOK_SORT_KEYS, lookSortKeysFor } from "./lineup-sort.js";
import { contrarianRead, contrarianHtml, contrarianMan, readBasisFor, ownFor } from "./lineup-contrarian.js"; // Adam 2026-11-04: the GPP Stack / Rest / Own vs field read on a card
import { filterLineups, filterBarHtml, pickButtonHtml, applyCompare } from "./lineup-filter.js";
import { classicEntries, shownExposureEntries, cleanExpState, expColumns, exposureMark, zeroMinRows, OPT_POSITIONS } from "./lineup-exposure.js";
import { statusLineHtml, rowMessageHtml, TONE_WARN } from "./row-message.js";
import { requestTab } from "./lineup-tabs.js";
import { onSitePage } from "./tabs.js";
import { canDeleteSaved } from "./delete-words.js";
import { paletteForRows } from "./team-palette.js";
import { TAG_OPTIONS, numberLineups, lineupPrefix, byAge } from "./lineup-tags.js";
import { slateLineups } from "./entries.js";
import { cashMedianText, unusedCapText, scoreOfRow, builtInTextCash, lineupModeOf } from "./lineup-cash.js";
import { confirmHtml, anchorHtml, DELETE_QUESTION, REPLACE_QUESTION } from "./confirm-inline.js";
import { dkSelectHtml, dkStatusLinesHtml } from "./dk-lineup-ui.js";
import { dkLineupCsv, dkCsvFileName, dkCsvStatus, downloadText } from "./dk-lineup-csv.js";
import { lookMan, lookTotals, ownText, lookFieldDiff, NO_FIGURE } from "./look-adapter.js";
import { lookRowHtml, lookEmptyRowHtml } from "./look-row.js";
import { state, opt, LINEUP_SLOTS, SALARY_CAP, dkIdentity, lineupBusy, placeBySlotName, commit, setMode } from "./lineup.js";
import { identityOf, slateKeyOf, savedSetKeys, lineupSetKey, exposureOfLineups, cashStrip, slotsForSave, saveGeneratedUids, tabOfUid, removeBuild, currentRowById } from "./lineup-optimizer.js";
import { savedOfActiveSlate, boardMediansForSort } from "./lineup-view.js";

/** The screen's page state: the text typed in the player filter and, on a phone, whether the exposure table is open. The mode shown is the tab's own (`opt.mode`, D74: the board, the exposure and every download belong to one mode); which list shows is `opt.resultsTab`. */
export const ltState = { q: "", exposureOpen: false };

const PICK = (rowById) => ({ isChosen: (id) => opt.mustHave.includes(identityOf(id, rowById)) });
export const pickOptions = PICK;

// ---- the numbers on a card ----

/** A saved lineup's nine seats and live totals against the current board (a card's salary, proj and own move after a Refresh, not frozen at save time). A saved man no longer on the slate is `row: null`, `snap` his saved fields; he counts toward the salary only (🔵 finding: a $50,000 lineup never shows under cap because a man rolled off). */
function savedSeats(lineup, rowById) {
  const board = store.get().board;
  const seated = reseatClassic(lineup.slots ?? [], rowById, kickoffLookup(board), slateKeyOf(board), board?.slates); // drawn in the DraftKings seating, the latest kickoff in FLEX (D56, classic-seat.js)
  return placeBySlotName(seated.map((s) => ({ slot: s.slot, id: s.playerId }))).map((entry) => (entry ? { row: rowById.get(entry.id) ?? null, snap: (lineup.slots ?? []).find((s) => String(s.playerId) === entry.id) ?? null } : null));
}

const savedMen = (seats) => seats.filter(Boolean).map((e) => (e.row ? { salary: e.row.salary, proj: e.row.proj, own: e.row.own } : { salary: e.snap?.salary }));

/** Salary, projection and ownership totals of a generated lineup (the sum of the rows as shown); ownership is null unless every man has a number. */
export function lineupTotalsOf(lineup) {
  const players = lineup?.players ?? [];
  const salary = lineup?.salary ?? (players.length && players.every((p) => p.salary != null) ? players.reduce((s, p) => s + p.salary, 0) : null); // a man with no salary leaves it unknown, never counted as 0
  // ChatGPT wish d, Adam 2026-10-17: the projection total is the sum of the rows as shown (totals.js), not the engine's raw sum.
  const proj = shownTotal(players.map((p) => p.proj)) ?? lineup?.proj ?? null;
  const allOwn = players.length > 0 && players.every((p) => p.own != null);
  return { salary, proj, own: allOwn ? players.reduce((s, p) => s + p.own, 0) : null };
}

const newRead = (lineup, rowById, basis = readBasisFor(store.get().board)) =>
  contrarianRead((lineup.players ?? []).map((p) => {
    const row = rowById?.get(String(p.id));
    return contrarianMan(row ? { name: p.name, pos: p.pos, team: p.team, opp: row.opp } : null, p.name, basis.kind === "actual" ? ownFor(row, basis) : p.own);
  }), basis);

const newPlayerMedian = (p, rowById) => ("median" in p ? p.median : scoreOfRow(rowById?.get(String(p.id)), "median"));

/** A new lineup's sort figures: a player's own `median` when the batch carries one (a cash median build), else the board row's; `salary` for the Salary sort. */
function newFigures(lineup, rowById) {
  const f = lineupFigures((lineup.players ?? []).map((p) => ({ proj: p.proj, own: p.own, median: newPlayerMedian(p, rowById) })), newRead(lineup, rowById));
  return { ...f, salary: lineupTotalsOf(lineup).salary };
}

function savedRead(lineup, rowById, basis = readBasisFor(store.get().board)) {
  return contrarianRead((lineup.slots ?? []).map((s) => { const r = rowById.get(String(s.playerId)); return contrarianMan(r, s.name ?? "a man", ownFor(r, basis)); }), basis);
}

/** A saved lineup's sort figures, off the live board rows (Adam 2026-10-17): all null when it is not nine players or a player is no longer on the board, so it sorts last and shows a dash rather than a figure from the players that remain. */
export function savedLineupFigures(lineup, rowById) {
  const rows = (lineup.slots ?? []).map((s) => rowById.get(String(s.playerId)));
  if (rows.length !== LINEUP_SLOTS.length || rows.some((r) => !r)) return { ...lineupFigures([]), salary: lookTotals(savedMen(savedSeats(lineup, rowById))).used };
  return { ...lineupFigures(rows.map((r) => ({ proj: r.proj, own: r.own, median: scoreOfRow(r, "median") })), savedRead(lineup, rowById)), salary: rows.every((r) => r.salary != null) ? rows.reduce((t, r) => t + r.salary, 0) : null };
}

const dashSpan = (why) => `<span class="miss" title="${escapeHtml(why)}">${NO_FIGURE}</span>`;

/** The card's one totals line (the approved look): Salary, Left, Proj, the median words when there are any (`extra`), Own; a figure a man lacks is a dash (A11). */
function capShortHtml(t, extra = "", why = "a man in this lineup has no figure or is no longer on this slate") {
  const over = t.left !== null && t.left < 0;
  return `<div class="cap"><div class="capbar${over ? " over" : ""}"><i style="width:${t.fillPct}%"></i></div><div class="capt"><span>Salary <b>${t.used === null ? dashSpan(why) : money(t.used)}</b></span><span${over ? ` class="overcap"` : ""}>Left <b>${t.left === null ? dashSpan(why) : over ? `−${money(-t.left)}` : money(t.left)}</b></span><span>Proj <b>${t.proj === null ? dashSpan(why) : dec1(t.proj)}</b></span>${extra ? `<span class="lt-med">${extra}</span>` : ""}<span>Own <b>${t.own === null ? dashSpan(why) : pct1(t.own)}</b></span></div></div>`;
}

const AUTO_NAME = /^(lineup|cash)\s*\d+$/i;

/** One clear name on a Saved card: "Lineup 3 · B" for the name the app gave it (its number is the Entries number), else his own name after the number and letter. */
function cardTitleParts(lineup, numbers) {
  const prefix = lineupPrefix(lineup, numbers);
  if (AUTO_NAME.test(String(lineup.name ?? "").trim()) && numbers?.get?.(lineup.id) != null) return { prefix: "", name: `Lineup ${prefix}` };
  return { prefix, name: lineup.name };
}

// ---- the cards ----

/** A saved card's seat row (Adam's slot-first row): live figures when he is on the board, his saved figures and a note when he is not. */
export function savedLineupSlotHtml(slotName, entry, palette = null) {
  if (!entry) return lookEmptyRowHtml(slotName, "Empty", { kind: "card" });
  const src = entry.row ?? entry.snap;
  if (!src) return "";
  const man = lookMan({ id: entry.row?.id ?? entry.snap?.playerId, name: src.name ?? "", pos: src.pos, team: src.team, salary: src.salary, proj: src.proj ?? null, own: src.own ?? null }, entry.row);
  return lookRowHtml(man, { slot: slotName, kind: "card", palette, note: entry.row ? "" : "not on slate", cls: entry.row ? "" : "stale" });
}

const ltBtn = (cls, inner, attrs = "") => `<button type="button" class="sm${cls ? ` ${cls}` : ""}"${attrs ? ` ${attrs}` : ""}>${inner}</button>`;

/** One Saved card: the name and its rename pencil, Load, Download and Delete, the mode tag, the letter and when it was saved, then the nine rows and the totals line. */
export function savedLineupCardHtml(lineup, rowById, numbers = null) {
  const seats = savedSeats(lineup, rowById);
  const id = escapeHtml(lineup.id);
  const busy = lineupBusy.has(lineup.id) ? " disabled" : ""; // a card PUT is in flight (lineup.js putLineupGuarded)
  const tagOptions = `<option value=""${lineup.tag ? "" : " selected"}>none</option>${TAG_OPTIONS.map((t) => `<option value="${t}"${t === lineup.tag ? " selected" : ""}>${t}</option>`).join("")}`;
  const isRenaming = state.renamingId === lineup.id;
  const t = lookTotals(savedMen(seats), { cap: SALARY_CAP });
  const incomplete = seats.filter(Boolean).length < LINEUP_SLOTS.length;
  const title = cardTitleParts(lineup, numbers);
  const name = isRenaming
    ? `<input type="text" class="lt-name saved-lineup-rename-input" data-rename-input value="${escapeHtml(lineup.name)}" />${ltBtn("", "Save", `data-action="lineup-rename-save" data-id="${id}"${busy}`)}${ltBtn("", "Cancel", `data-action="lineup-rename-cancel"`)}`
    : `<span${title.name !== lineup.name ? ` title="${escapeHtml(lineup.name)}"` : ""}>${escapeHtml(title.name)}</span><button type="button" class="rn" data-action="lineup-rename-start" data-id="${id}" title="Rename this lineup" aria-label="Rename this lineup">✎</button>`;
  const loadConfirm = state.confirm === `load:${lineup.id}` ? confirmHtml(REPLACE_QUESTION, { data: `load:${lineup.id}` }) : "";
  const deleting = !canDeleteSaved(lineup.id, onSitePage()) ? "" // the site's read-only app lineups have no Delete
    : state.deleteConfirmId === lineup.id
      ? `<span class="lt-confirm">${DELETE_QUESTION} ${ltBtn("x", "Yes", `data-action="lineup-delete-yes" data-id="${id}"`)}${ltBtn("", "No", `data-action="lineup-delete-no"`)}</span>`
      : ltBtn("x", "Delete", `data-action="lineup-delete-start" data-id="${id}"`);
  const prefix = title.prefix;
  const median = boardMediansForSort() ? medianText(savedLineupFigures(lineup, rowById).median, (lineup.slots ?? []).some((s) => scoreOfRow(rowById.get(String(s.playerId)), "median") != null), "a player has no TwoGun median or is no longer on the slate") : "";
  const readLine = lineup.mode === "cash" ? "" : contrarianHtml(savedRead(lineup, rowById)); // GPP only (demo 2026-11-04)
  const palette = paletteForRows(rowById);
  const badges = [
    state.justSaved?.has(lineup.id) ? `<span class="lt-badge new" title="Saved by your last Save or Save all">Just saved</span>` : "",
    state.loadedId === lineup.id ? `<span class="lt-badge">Loaded</span>` : "",
    state.lineupErrors[lineup.id] ? `<span class="lt-badge bad">${escapeHtml(state.lineupErrors[lineup.id])}</span>` : "",
    incomplete ? `<span class="lt-badge warn">Incomplete</span>` : "",
    t.left !== null && t.left < 0 ? `<span class="lt-badge bad">Over cap</span>` : "",
  ].join("");
  const buildText = buildTypeText(lineup.build);
  return `<div class="lc svc${state.justSaved?.has(lineup.id) ? " just" : ""}" data-lineup-id="${id}">
    <div class="lch"><span class="lt-title">${dkSelectHtml(lineup.id, state.dkSelected.has(lineup.id))}${prefix ? `<span class="lt-pre">${escapeHtml(prefix)}</span>` : ""}${name}</span>
      <span class="lcb">${anchorHtml(ltBtn("", "Load", `data-action="lineup-load" data-id="${id}" title="Make it the working lineup"`), loadConfirm, { align: "left" })}${ltBtn("", "Download", `data-lt-dl-card="${id}" title="Download this lineup for DraftKings"`)}${deleting}</span></div>
    <div class="lt-at"><span class="md${lineupModeOf(lineup) === "cash" ? " cash" : ""}">${lineupModeOf(lineup) === "cash" ? "Cash" : "GPP"}</span><label class="lt-tagl" title="A letter that follows this lineup onto the Entries tab">Entries letter<select class="saved-lineup-tag lt-tag" data-action="lineup-tag" data-id="${id}" aria-label="Letter for ${escapeHtml(lineup.name)}"${busy}>${tagOptions}</select></label><span class="lt-time">Saved ${escapeHtml(formatSavedAt(lineup.savedAt))}</span>${buildText ? `<span class="lt-badge" title="How this lineup was made">${escapeHtml(buildText)}</span>` : ""}${badges}</div>
    ${seats.map((entry, i) => savedLineupSlotHtml(LINEUP_SLOTS[i], entry, palette)).join("")}
    ${capShortHtml(t, median)}
    ${readLine ? `<div class="lt-read">${readLine}</div>` : ""}
    ${state.deleteErrors[lineup.id] ? rowMessageHtml(state.deleteErrors[lineup.id], "error") : ""}
  </div>`;
}

function formatSavedAt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`;
}

/** One Recently generated card: the nine rows (batch figures for Proj, Own and Salary, the board's matchup), the totals line, Save and Discard. `saved`: the card is saved, or its men equal a saved lineup's, so Save shows `Saved ✓`. `cash` = {basis, strip: {html, wantIn}} on a card built in cash. `tab`: the tab (gpp, cash) the card's batch belongs to. `locked`: ids of the men the batch padlocked (C6: a man only clicked into the lineup is not locked). */
export function optLineupCardHtml(lineup, index, busy, { saved = false, rowById = null, cash = null, tab = "gpp", locked = new Set() } = {}) {
  const palette = paletteForRows(rowById);
  const rows = (lineup.players ?? []).map((p, i) => {
    const live = rowById?.get(String(p.id)) ?? null;
    const man = lookMan(live ? { ...p, id: p.id } : p, live);
    const want = cash?.strip.wantIn.has(String(p.id));
    return lookRowHtml(man, { slot: LINEUP_SLOTS[i] ?? p.pos ?? "", kind: "card", locked: locked.has(String(p.id)), palette, note: want ? "WANT" : "" });
  }).join("");
  const t = lookTotals((lineup.players ?? []).map((p) => ({ salary: p.salary, proj: p.proj, own: p.own })), { cap: SALARY_CAP });
  const unused = cash ? unusedCapText(t.used) : "";
  const medianPart = !cash && (boardMediansForSort() || (lineup.players ?? []).some((p) => "median" in p)) ? medianText(newFigures(lineup, rowById).median, (lineup.players ?? []).some((p) => newPlayerMedian(p, rowById) != null)) : "";
  const extra = [cash ? cashMedianText(lineup, cash.basis) : medianPart, unused ? `<span class="lt-badge">${escapeHtml(unused)}</span>` : ""].filter(Boolean).join(" · ");
  const readLine = cash ? "" : contrarianHtml(newRead(lineup, rowById));
  const uid = escapeHtml(lineup.uid ?? "");
  const saveBtn = saved ? `<button type="button" class="sm on" disabled>Saved ✓</button>` : ltBtn("", "Save", `data-action="opt-save" data-uid="${uid}"${busy ? " disabled" : ""}`);
  return `<div class="lc${saved ? " savedc" : ""}" data-uid="${uid}" data-tab="${tab}">
    <div class="lch"><span>Lineup ${index + 1}</span><span class="lcb">${saveBtn}${ltBtn("x", "Discard", `data-action="opt-discard" data-uid="${uid}" title="Take this lineup off the list"${busy ? " disabled" : ""}`)}</span></div>
    ${rows}
    ${capShortHtml(t, extra)}
    ${readLine ? `<div class="lt-read">${readLine}</div>` : ""}
    ${cash ? cash.strip.html : ""}
  </div>`;
}

export function optNotesHtml(notes) {
  return (notes ?? []).map((n) => `<div class="opt-note">${escapeHtml(n)}</div>`).join(""); // the Showdown Optimizer draws them too
}

/** The quiet line under a batch for the response's `bends` ([{lineup (1-based), label}]), lineups sharing a label grouped ("lineups 2, 3 and 7–9: <label>"); "" when none or missing. */
export function bendsLineHtml(bends, made) {
  const list = (Array.isArray(bends) ? bends : []).filter((b) => b && Number.isFinite(b.lineup) && b.label);
  if (!list.length) return "";
  const n = new Set(list.map((b) => b.lineup)).size;
  const groups = new Map();
  for (const b of list) groups.set(b.label, [...(groups.get(b.label) ?? []), b.lineup]);
  const body = [...groups].map(([label, nums]) => {
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
      if (j - i >= 2) parts.push(`${sorted[i]}–${sorted[j]}`);
      else for (let k = i; k <= j; k++) parts.push(String(sorted[k]));
      i = j + 1;
    }
    const who = sorted.length === 1 ? `lineup ${parts[0]}` : `lineups ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`}`;
    return `${who}: ${label}`;
  }).join("; ");
  return `<div class="opt-bends">${n} of ${made} lineup${made === 1 ? "" : "s"} ${n === 1 ? "bends" : "bend"} a setting: ${escapeHtml(body)}.</div>`;
}

/** Whether a new card counts as saved: its men equal a saved lineup's (D74), so deleting that saved lineup turns the card back to Save. `lineup.saved` is set only when a save answer carried no saved list (saveGenerated). */
export function cardIsSaved(lineup, savedKeys, rowById) {
  return Boolean(lineup.saved) || savedKeys.has(lineupSetKey(lineup.ids ?? (lineup.players ?? []).map((p) => p.id), rowById));
}

// ---- what shows ----

const nameMatches = (players, q) => players.some((p) => String(p.name ?? "").toLowerCase().includes(q));

/** The batch of the Recently generated list: [{tab, r, shown: [{item, index}]}] for the tab on screen (D74: one mode at a time), filtered by the typed player filter and the only-lineups-with filter (D77). */
export function shownBatches(rowById) {
  const tab = opt.mode;
  const r = opt.tabs[tab]?.results;
  if (!r) return [];
  const q = ltState.q.trim().toLowerCase();
  const shown = filterLineups(r.lineups ?? [], opt.mustHave, (l) => (l.players ?? []).map((p) => ({ ...p, identity: identityOf(p.id, rowById) }))).filter((e) => !q || nameMatches(e.item.players ?? [], q));
  return [{ tab, r, shown }];
}

/** The saved lineups the Saved list shows: this slate's of the tab on screen, filtered by the typed player filter and the only-lineups-with filter. */
function shownSaved(rowById) {
  const q = ltState.q.trim().toLowerCase();
  return filterLineups(savedOfActiveSlate(opt.mode), opt.mustHave, (l) => savedLineupPlayers(l, rowById)).filter((e) => !q || nameMatches(savedLineupPlayers(e.item, rowById), q)).map((e) => e.item);
}

/** A saved lineup's players for the exposure table: the live board row when there is one (matchup D43, own% D32), else the saved snapshot. */
export function savedLineupPlayers(lineup, rowById) {
  return (lineup.slots ?? []).map((s) => {
    const id = String(s.playerId);
    const row = rowById.get(id);
    return row ? { id, name: row.name, pos: row.pos, team: row.team, opp: matchupText(row), own: row.own ?? null, identity: dkIdentity(row) } : { id, name: s.name, pos: s.pos, team: s.team, opp: "", own: s.own ?? null, identity: id };
  });
}

/** The saved lineups on screen (for the DraftKings download): the list above, in its shown order. */
export function shownSavedLineups(rowById) {
  return shownSaved(rowById);
}

function activeResultsTab(savedHere) {
  if (opt.resultsTab === "new" || opt.resultsTab === "saved") return opt.resultsTab;
  if (opt.results || opt.generating || opt.error) return "new";
  return savedHere.length ? "saved" : "new";
}

// ---- the exposure panel ----

/** The exposure panel (A10): every column sorts (the state is opt.exp, `opt-exp-sort`, lineup-optimizer.js), a Pos filter, each man's share of the shown lineups, his count, position, matchup (D43) and Own, the You-vs-field bar and Diff (share minus Own, a dash when Own is unpublished), and his Filter button. */
export function exposureHtml(entries, label, marks, pick) {
  const st = cleanExpState(opt.exp, "classic");
  const shown = shownExposureEntries(entries, st, "classic", pick ? (id) => pick.isChosen(id) : null);
  const heads = expColumns("classic").filter((c) => c.key !== "opp").map((c) => { // Matchup is shown beside the name (D43), not as its own column
    const active = st.col === c.key;
    return `<th class="sortable${active ? " sorted" : ""}${c.key === "pct" || c.key === "own" ? ` ex-${c.key === "pct" ? "pct" : "own"}` : ""}" data-action="opt-exp-sort" data-col="${c.key}" aria-sort="${active ? (st.dir === "asc" ? "ascending" : "descending") : "none"}">${escapeHtml(c.label === "Matchup" ? "Opp" : c.label)}${active ? (st.dir === "asc" ? " ▲" : " ▼") : ""}</th>`;
  });
  const dash = (why) => dashSpan(why);
  const rows = shown.map((e) => {
    const mark = exposureMark(e, marks, null);
    const hasOwn = typeof e.own === "number" && Number.isFinite(e.own);
    const diff = lookFieldDiff(e.pct, e.own);
    return `<tr class="${mark ? "exp-off" : ""}">
      <td class="ex-pct"${mark ? ` title="${escapeHtml(mark.title)}"` : ""}>${(e.pct ?? 0).toFixed(1)}% <span class="ex-n">(${e.count ?? 0})</span></td>
      <td class="ex-name"${e.id != null ? ` data-card-id="${escapeHtml(String(e.id))}"` : ""}><span class="pn player-name">${escapeHtml(e.name ?? "")}</span>${e.opp ? `<span class="slt ex-opp">${escapeHtml(opponentWords(e.opp))}</span>` : ""}</td>
      <td>${escapeHtml(e.pos ?? "")}</td>
      <td class="ex-own">${hasOwn ? escapeHtml(ownText(e.own)) : dash("no published ownership")}</td>
      ${hasOwn ? `<td class="ex-bar"><span class="xb"><i style="width:${Math.min(100, Math.max(0, e.pct ?? 0)).toFixed(1)}%"></i><u style="left:${Math.min(100, Math.max(0, e.own)).toFixed(1)}%"></u></span></td><td class="ex-diff">${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)}</td>` : `<td class="ex-bar">${dash("no published ownership")}</td><td class="ex-own">${dash("no published ownership")}</td>`}
      <td class="ex-f">${pickButtonHtml({ id: e.id, name: e.name ?? "", chosen: pick?.isChosen(e.id), cls: "xf", innerHtml: "Filter" })}</td>
    </tr>`;
  }).join("");
  const posButtons = ["All", ...OPT_POSITIONS].map((p) => `<button type="button" class="xf${st.filter === p ? " on" : ""}" data-action="opt-exp-filter" data-filter="${p}" aria-pressed="${st.filter === p}">${p}</button>`).join("");
  return `<div class="lt-ex opt-exposure"><div class="lt-exh">Exposure · ${escapeHtml(label)}</div><div class="exl"><div class="expos"><span>Pos</span>${posButtons}</div>${shown.length ? `<table class="ext"><thead><tr>${heads.join("")}<th class="ex-bar" title="Bar: his share of these lineups. Tick: his projected ownership.">You vs field</th><th class="ex-diff" title="Exposure minus Own">Diff</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="lt-empty">None</div>`}</div></div>`;
}

/** A phone's plain switch for the exposure table: the cards come first, the table behind this (look.css hides it on a wider screen, where the table always shows). */
const exposureToggleHtml = () => `<button type="button" class="lt-extog" data-action="lt-exposure-toggle" aria-expanded="${ltState.exposureOpen}">${ltState.exposureOpen ? "Hide exposure" : "Show exposure"}</button>`;

/** What the Own vs field bar on a GPP card means, once per screen in plain words (the words themselves: lineup-contrarian.js). */
// Item 7 (G64, Adam 2:49 PM 11-11): one line under the cards, never a paragraph above them.
const READ_LEGEND = `<div class="lt-legend">Own vs field: Super unique to Super chalky; the tick is a typical lineup. Stack = your QB and teammates, Rest = everyone else.</div>`;

const opponentWords = (opp) => {
  const m = /^(vs|@)\s*(.+)$/i.exec(String(opp).trim());
  return m ? (m[1] === "@" ? `@${m[2]}` : `v ${m[2]}`) : String(opp);
};

// ---- the summary strip ----

const range = (values, fmt) => {
  const list = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!list.length) return NO_FIGURE;
  const lo = Math.min(...list), hi = Math.max(...list);
  return fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo)} to ${fmt(hi)}`;
};

function summaryHtml(lineupsFigures, extraCells) {
  const avgOwn = lineupsFigures.filter((f) => f.own !== null);
  const cells = [
    ["Lineups", String(lineupsFigures.length)],
    ["Projection", range(lineupsFigures.map((f) => f.proj), (v) => dec1(v))],
    ["Salary", range(lineupsFigures.map((f) => f.salary), (v) => money(v))],
    ["Avg lineup ownership", avgOwn.length === lineupsFigures.length && avgOwn.length ? `${Math.round(avgOwn.reduce((t, f) => t + f.own, 0) / avgOwn.length)}%` : NO_FIGURE],
    ...extraCells,
  ];
  return `<div class="lt-sum">${cells.map(([l, v]) => `<div><small>${l}</small><b>${escapeHtml(v)}</b></div>`).join("")}</div>`;
}

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET" : NO_FIGURE);

// ---- the screen ----

/** The Lineups tab's whole markup. */
export function lineupsScreenHtml(rowById) {
  const savedHere = savedOfActiveSlate(null);
  const view = activeResultsTab(savedHere);
  const batches = shownBatches(rowById);
  const nBuilt = batches.reduce((t, b) => t + b.shown.length, 0);
  const builtHere = opt.results?.lineups?.length ?? 0;
  const savedOfMode = savedHere.filter((l) => lineupModeOf(l) === opt.mode);
  const hasMedianKey = view === "new" ? batches.some((b) => (b.r.mode === "cash" ? b.r.basis === "median" : boardMediansForSort())) : boardMediansForSort(); // A Cash median build brings its own medians, whatever the board has
  const bar = (nb, ns) => {
    const tabs = `<span class="lt-tabs" role="tablist" aria-label="Lineups">${[["new", "Recently generated", nb], ["saved", "Saved", ns]].map(([k, t, n]) => `<button type="button" role="tab" class="${view === k ? "on" : ""}" data-action="opt-tab" data-tab="${k}" aria-selected="${view === k}">${t}${n ? ` <b>${n}</b>` : ""}</button>`).join("")}</span>`;
    const keys = lookSortKeysFor(hasMedianKey, opt.mode !== "cash"); // Own vs field is a GPP reading
    const current = effectiveSort(view === "new" ? opt.sort.new : opt.sort.saved, keys);
    const label = (k) => (k.key === "built" && view === "saved" ? "Number" : k.label); // the Saved list's first order is lineup number (byAge), the numbers Entries shows
    const sortBtns = keys.map((k) => `<button type="button" class="${k.key === current.key ? "on" : ""}" data-action="opt-sort" data-tab="${view}" data-key="${k.key}" aria-pressed="${k.key === current.key}" title="${escapeHtml(k.key === "built" && view === "saved" ? "Lineup number order, the numbers Entries shows" : k.title)}">${escapeHtml(label(k))}${k.key === current.key && k.key !== "built" ? (current.dir === "asc" ? " ▲" : " ▼") : ""}</button>`).join("");
    const count = (m) => (opt.tabs[m]?.results?.lineups?.length ?? 0) + savedHere.filter((l) => lineupModeOf(l) === m).length;
    const modeBtns = [["gpp", "GPP"], ["cash", "Cash"]].map(([k, l]) => `<button type="button" class="${opt.mode === k ? "on" : ""}" data-lt-mode="${k}" aria-pressed="${opt.mode === k}" title="Show the ${l} lineups, on the ${l} board">${l}${count(k) ? ` <b>${count(k)}</b>` : ""}</button>`).join("");
    return `<div class="lt-bar">${tabs}<input class="search lt-q" id="lt-query" placeholder="Filter by player..." autocomplete="off" value="${escapeHtml(ltState.q)}" /><span class="lt-sort"><em>Sort</em>${sortBtns}</span><span class="lt-sort"><em>Mode</em>${modeBtns}</span></div>`;
  };
  const savedShown = shownSaved(rowById);
  const pick = PICK(rowById);
  const mustBar = filterBarHtml(opt.mustHave.map((key) => ({ key, name: opt.mustHaveNames[key] ?? key })), view === "new" ? nBuilt : savedShown.length, view === "new" ? builtHere : savedOfMode.length, ltState.compare === true);
  let top, body;
  if (view === "saved") {
    ({ top, body } = savedViewHtml(savedOfMode, savedShown, rowById, pick));
  } else {
    ({ top, body } = newViewHtml(batches, rowById, pick, nBuilt));
  }
  return `<section class="opt lineups" id="lineups" data-lineups-view="${view}">
    <div data-notice-slot></div>
    ${top}
    ${bar(builtHere, savedOfMode.length)}
    ${mustBar}
    ${opt.error ? statusLineHtml(opt.error, opt.errorTone) : ""}
    ${opt.formError ? statusLineHtml(opt.formError, TONE_WARN) : ""}
    ${body}
  </section>`;
}

const modeWord = () => (opt.mode === "cash" ? "Cash" : "GPP");
/** C9 and A3: where the screen's numbers come from, said where they are read. */
const figuresCell = (saved) => (saved ? ["Figures", `Live, ${modeWord()} board`] : ["Figures", `As built, ${modeWord()}`]);

function savedViewHtml(savedHere, shown, rowById, pick) {
  const filtered = ltState.q.trim() || opt.mustHave.length;
  const n = savedHere.length;
  if (!state.savedLoaded) return { top: `<div class="lt-top"></div>`, body: `<div class="lt-empty saved-lineups-loading">Loading…</div>` };
  if (state.savedError) return { top: `<div class="lt-top"></div>`, body: `<div class="lt-empty saved-lineups-empty saved-lineups-error">${escapeHtml(state.savedError)}</div>` };
  if (!n) return { top: `<div class="lt-top"></div>`, body: `<div class="lt-empty saved-lineups-empty">No saved lineups for this slate yet.</div>` };
  const figures = shown.map((l) => savedLineupFigures(l, rowById));
  const dates = shown.map((l) => new Date(l.savedAt)).filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a - b);
  const fmtDay = (d) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
  const numbers = numberLineups(slateLineups(state.savedLineups, slateKeyOf(store.get().board)));
  const keys = lookSortKeysFor(boardMediansForSort(), opt.mode !== "cash");
  const sort = effectiveSort(opt.sort.saved, keys);
  const cardOf = (l) => savedLineupCardHtml(l, rowById, numbers);
  const ordered = sort.key === "built" ? byAge(shown) : sortLineups(shown, sort.key, sort.dir, (l) => savedLineupFigures(l, rowById), LOOK_SORT_KEYS);
  const cards = ordered.map(cardOf).join("");
  const ticked = shown.filter((l) => state.dkSelected.has(l.id)).length;
  const dlCount = ticked || shown.length;
  const exposure = exposureOfLineups(shown.map((l) => savedLineupPlayers(l, rowById)));
  const label = `saved · ${filtered ? `${shown.length} of ${n}` : `${n}`} lineup${n === 1 ? "" : "s"}`;
  return {
    top: `<div class="lt-top">${summaryHtml(figures, [["Saved", dates.length ? `${fmtDay(dates[0])} to ${fmtDay(dates[dates.length - 1])}`.replace(/^(.*) to \1$/, "$1") : NO_FIGURE], figuresCell(true)])}<span class="lt-btns">${ticked ? `<span class="lt-ticked">${ticked} of ${shown.length} ticked <button type="button" class="link-btn" data-action="dk-select-none">Clear selection</button></span>` : ""}${state.dkStatus ? `<span class="dk-status" role="status">${dkStatusLinesHtml(state.dkStatus)}</span>` : ""}<button type="button" class="ol lt-dl" data-lt-dl="saved"${dlCount ? "" : " disabled"}>Download CSV for DraftKings (${dlCount})</button></span></div>`,
    body: `<div class="lt-body${ltState.exposureOpen ? " exopen" : ""}">${exposureHtml(classicEntries(exposure), label, null, pick)}${exposureToggleHtml()}<div class="lt-cards" id="saved-lineups">${shown.length ? cards : `<div class="lt-empty saved-lineups-empty">No lineups here have all of the chosen players.</div>`}${opt.mode === "cash" ? "" : READ_LEGEND}</div></div>`,
  };
}

function newViewHtml(batches, rowById, pick, nBuilt) {
  const busy = opt.saving || opt.generating;
  const savedAll = savedOfActiveSlate(null);
  if (!batches.length) { // no build, or none of the mode the Mode buttons show
    const words = opt.generating && opt.buildingShown ? "" : "No new lineups. Press Build to make some.";
    return { top: `<div class="lt-top"></div>`, body: `<div class="lt-empty saved-lineups-empty">${words}</div>` };
  }
  const q = ltState.q.trim();
  const figures = [];
  const groups = [];
  const allShown = [];
  let unsaved = 0;
  const mustFiltered = opt.mustHave.length > 0 || q !== "";
  for (const b of batches) {
    const { tab, r, shown } = b;
    const isCash = r.mode === "cash";
    const savedKeys = savedSetKeys(savedAll.filter((l) => lineupModeOf(l) === (isCash ? "cash" : "gpp")), rowById);
    const whole = r.lineups.length === r.made;
    const savedFlags = r.lineups.map((l) => cardIsSaved(l, savedKeys, rowById));
    const nShownUnsaved = shown.filter((e) => !savedFlags[e.index]).length;
    unsaved += nShownUnsaved;
    allShown.push(...shown.map((e) => (e.item.players ?? []).map((p) => ({ ...p, identity: identityOf(p.id, rowById) }))));
    for (const e of shown) figures.push(newFigures(e.item, rowById));
    const keys = lookSortKeysFor(isCash ? r.basis === "median" : boardMediansForSort(), !isCash);
    const sort = effectiveSort(opt.sort.new, keys);
    const ordered = sortLineups(shown, sort.key, sort.dir, (e) => newFigures(e.item, rowById), LOOK_SORT_KEYS);
    const cash = (lineup) => (isCash ? { basis: r.basis, strip: cashStrip(lineup, r, rowById, busy) } : null);
    const heldIds = (r.lockedIds ?? r.cash?.lockedIds ?? []).map(String);
    const locked = new Set((r.padlockedIds ?? []).map(String)); // C6: Locked means the padlock, on the build line, the card and the builder alike; a man only clicked in is "In the lineup"
    const names = (ids) => ids.map((id) => rowById.get(String(id))?.name).filter(Boolean).join(", ");
    const held = names([...locked]);
    const inLineup = names(heldIds.filter((id) => !locked.has(id)));
    const when = r.builtAt ? clock(r.builtAt) : "";
    const countText = `${r.lineups.length} lineup${r.lineups.length === 1 ? "" : "s"}`;
    const headText = `${isCash ? "Cash" : "GPP"}, ${countText}${when ? `, ${when}` : ""}`;
    const noteBits = [isCash ? builtInTextCash(r.lineups.length, r.basis) : r.builtIn ? `built in ${r.builtIn}` : ""].filter(Boolean);
    groups.push(`<div class="lt-bh"><b>${escapeHtml(headText)}</b>${held ? `<span class="lt-bn">Locked: ${escapeHtml(held)}</span>` : ""}${inLineup ? `<span class="lt-bn">In the lineup: ${escapeHtml(inLineup)}</span>` : ""}${noteBits.length ? `<span class="lt-bn lt-bq">${escapeHtml(noteBits.join(" · "))}</span>` : ""}<button type="button" class="sm lt-bdl" data-lt-dl="build:${tab}" title="Download only this build's lineups for DraftKings">Download (${shown.length})</button><button type="button" class="sm x" data-action="lt-remove-build" data-tab="${tab}" title="Remove this build (saved lineups stay)">Remove build</button></div>
      ${opt.tabs[tab].saveError ? `<div class="lt-bnote">${statusLineHtml(opt.tabs[tab].saveError, opt.tabs[tab].saveTone)}</div>` : ""}
      ${isCash && opt.cashUndo ? `<div class="lt-bnote cash-undo">Locked ${escapeHtml(opt.cashUndo.names.join(" and "))} and built again. <button type="button" class="link-btn" data-cash-undo${busy ? " disabled" : ""}>Undo</button></div>` : ""}
      ${optNotesHtml(r.notes)}
      ${r.lineups.length ? (ordered.length ? ordered.map((e) => optLineupCardHtml(e.item, e.index, busy, { saved: savedFlags[e.index], rowById, cash: cash(e.item), tab, locked })).join("") : `<div class="lt-bnote lt-empty saved-lineups-empty">No lineups here have all of the chosen players.</div>`) : `<div class="lt-bnote lt-empty">None left from this Build.</div>`}
      ${whole ? bendsLineHtml(r.bends, r.made) : ""}`);
  }
  const single = batches.length === 1 ? batches[0] : null;
  const wholeSingle = single && single.r.lineups.length === single.r.made && !mustFiltered;
  const marks = wholeSingle && single.r.marks && single.r.made >= single.r.marks.asked ? single.r.marks : null;
  let exposure = exposureOfLineups(allShown);
  if (marks) {
    const held = new Set(allShown.flat().map((p) => p.identity));
    const playerOf = (id) => {
      const row = rowById.get(String(id));
      return row ? { name: row.name, pos: row.pos, team: row.team, opp: matchupText(row), own: row.own } : null;
    };
    exposure = zeroMinRows(exposure, marks, playerOf, (id) => held.has(identityOf(id, rowById)));
  }
  const buildCount = batches.length;
  const label = `recently generated · ${nBuilt} lineup${nBuilt === 1 ? "" : "s"}`;
  const latest = batches.map((b) => b.r.builtAt).filter(Boolean).sort().pop();
  return {
    top: `<div class="lt-top">${summaryHtml(figures, [["Builds", String(buildCount)], figuresCell(false), ["Latest", latest ? clock(latest) : NO_FIGURE]])}<span class="lt-btns">${state.dkStatus ? `<span class="dk-status" role="status">${dkStatusLinesHtml(state.dkStatus)}</span>` : ""}${unsaved ? `<button type="button" class="ol lt-dl" data-action="lt-save-all"${busy ? " disabled" : ""}>Save all unsaved (${unsaved})</button>` : ""}<button type="button" class="ol lt-dl" data-lt-dl="new"${nBuilt ? "" : " disabled"}>Download CSV for DraftKings (${nBuilt})</button></span></div>`,
    body: `<div class="lt-body${ltState.exposureOpen ? " exopen" : ""}">${exposureHtml(classicEntries(exposure), label, marks, pick)}${exposureToggleHtml()}<div class="lt-cards">${groups.join("")}${opt.mode === "cash" ? "" : READ_LEGEND}</div></div>`,
  };
}

// ---- the wiring ----

/** One lineup list as the DraftKings file writer takes it: a new batch's lineups become {name, slots}. */
const batchAsFile = (r, lineups) => lineups.map((l) => ({ name: `Lineup ${r.lineups.indexOf(l) + 1}`, slots: slotsForSave(l.players) }));

function downloadLineups(lineups) {
  const board = store.get().board;
  const slateKey = slateKeyOf(board);
  const made = dkLineupCsv({ kind: "classic", lineups, board, slateKey }); // the file writer seats each lineup by D56 and refuses what DraftKings would
  if (made.text) downloadText(dkCsvFileName(slateKey), made.text);
  state.dkStatus = made.text ? dkCsvStatus(made) : `Nothing was downloaded.\n${dkCsvStatus(made)}`;
  commit();
}

/** The Lineups screen's own controls (the GPP | Cash switch, the typed filter, Save all unsaved, Remove build, the Download buttons); the cards' Save, Discard, Load, Delete and the exposure's Filter buttons are wired with the Optimizer (lineup-optimizer.js, lineup.js). */
export function wireLineupsScreen(container) {
  const rowById = currentRowById();
  applyCompare(container, ltState.compare === true, opt.mustHave, (el) => identityOf(el.dataset.cardId, rowById)); // Compare: the held men's rows grey (page state, off on reload)
  container.querySelector("[data-action='opt-compare']")?.addEventListener("click", () => { ltState.compare = ltState.compare !== true; commit(); });
  container.querySelectorAll("[data-lt-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (opt.saving || state.saving || opt.mode === btn.dataset.ltMode) return;
      const view = opt.resultsTab; // the list on screen (Saved or Recently generated) stays as the mode changes
      requestTab(btn.dataset.ltMode, () => { setMode(btn.dataset.ltMode); if (view) { opt.resultsTab = view; commit(); } }); // the same gate as the Optimizer's GPP | Cash: the tab's own board comes on screen with it
    });
  });
  const q = container.querySelector("#lt-query");
  if (q) {
    q.addEventListener("input", () => { ltState.q = q.value; ltState.caret = q.selectionStart ?? q.value.length; commit(); }); // A redraw replaces the box, and the blur that comes with it must not end the typing
    if (ltState.caret != null) { q.focus(); q.setSelectionRange?.(ltState.caret, ltState.caret); ltState.caret = null; }
  }
  container.querySelector("[data-action='lt-exposure-toggle']")?.addEventListener("click", () => { ltState.exposureOpen = !ltState.exposureOpen; commit(); });
  container.querySelector("[data-action='lt-save-all']")?.addEventListener("click", async () => {
    for (const b of shownBatches(rowById)) {
      if (b.shown.length) await saveGeneratedUids(b.shown.map((e) => e.item.uid));
    }
  });
  container.querySelectorAll("[data-action='lt-remove-build']").forEach((btn) => btn.addEventListener("click", () => {
    const b = shownBatches(rowById).find((x) => x.tab === btn.dataset.tab);
    if (b) removeBuild(btn.dataset.tab, b.shown.map((e) => e.item.uid));
  }));
  container.querySelectorAll("[data-lt-dl]").forEach((btn) => btn.addEventListener("click", () => {
    const what = btn.dataset.ltDl;
    if (what === "saved") {
      const shown = shownSaved(rowById);
      const ticked = shown.filter((l) => state.dkSelected.has(l.id));
      return downloadLineups(ticked.length ? ticked : shown);
    }
    const batches = shownBatches(rowById).filter((b) => what === "new" || what === `build:${b.tab}`);
    downloadLineups(batches.flatMap((b) => batchAsFile(b.r, b.shown.map((e) => e.item))));
  }));
  container.querySelectorAll("[data-lt-dl-card]").forEach((btn) => btn.addEventListener("click", () => {
    const lineup = state.savedLineups.find((l) => l.id === btn.dataset.ltDlCard);
    if (lineup) downloadLineups([lineup]);
  }));
}
