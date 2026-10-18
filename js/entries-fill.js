// The Entries fill strip's pure builders (D75 as amended 2026-10-17; entries fill plan items 5, 6 and 7a): the lineup
// lists, the per-file fill model (planFill plus the proposals still valid), the strip's HTML and each contest's header.
// Split out of entries.js for size (🔵 2026-10-17); entries.js imports and re-exports every name here. Imports only
// format.js, entries-plan.js, lineup-tags.js and totals.js, never entries.js.
import { escapeHtml, money, dec1 } from "./format.js";
import { groupByContest, effectiveClasses, orderedFillLineups, planFill, validProposals, contestKey, lineupModeOf, rowHolds } from "./entries-plan.js";
import { numberLineups, lineupLabel, sortLineupsBy } from "./lineup-tags.js";
import { shownTotal } from "./totals.js";

/** "Name - 152.3 proj - $49,800": how one saved lineup reads in a picker. With `numbers` (numberLineups) the name part
 *  is the "1 · A · name" label (Adam 2026-10-17, plan item 7a). */
export function lineupOptionLabel(lineup, numbers = null) {
  const name = numbers ? lineupLabel(lineup, numbers) : String(lineup?.name ?? "").trim() || "Lineup";
  const proj = dec1(shownTotal((lineup?.slots ?? []).map((s) => s?.proj)) ?? lineup?.totalProj); // ChatGPT wish d, Adam 2026-10-17: the sum of the saved players' shown projections
  const cash = lineupModeOf(lineup) === "cash" ? "$ Cash · " : ""; // Cash mode job 3b, 2026-10-17: the one browser mode rule (lineup-cash.js, through entries-plan.js)
  return `${cash}${name} · ${proj == null ? "no proj" : `${proj} proj`} · ${money(lineup?.salaryUsed)}`;
}

/** How many of a contest's entries have a lineup picked in `assigned`. */
export function assignedInContest(group, assigned) {
  return (group?.entries ?? []).filter((e) => Boolean(assigned?.[e.entryId])).length;
}

/** One contest's header row: a "takes part" tick, name, fee, entry count, "14 assigned · 6 proposed · 0 open", the
 *  GPP | Cash toggle and the Clear button. `ctx` { cls, auto, ticked } adds the tick and the toggle (a dot marks a class
 *  that differs from the automatic call); `proposals` { entryId: lineupId } are the unconfirmed rows (D75, plan item 3/6).
 *  `folded` (Adam 2026-10-17): the fold button leads the line, ▸ when the contest's rows are hidden, ▾ when shown; it is
 *  drawn with no `ctx` too. */
export function contestHeadHtml(file, group, assigned, ctx = null, proposals = null, folded = false, plain = false) {
  const n = group.entries.length;
  const done = assignedInContest(group, assigned);
  const proposedN = group.entries.filter((e) => proposals?.[e.entryId] != null).length;
  const assignedN = group.entries.filter((e) => assigned?.[e.entryId] && proposals?.[e.entryId] == null).length;
  const status = `${assignedN} assigned · ${proposedN} proposed · ${n - assignedN - proposedN} open`;
  const f = escapeHtml(file);
  const c = escapeHtml(group.contestId);
  const chip = (cls, text) => `<button type="button" class="chip toggle-chip entries-class-chip${ctx?.cls === cls ? " active" : ""}" data-action="entries-class" data-file="${f}" data-contest="${c}" data-class="${cls}" aria-pressed="${ctx?.cls === cls}">${text}</button>`;
  const toggle = ctx
    ? `<span class="entries-class" role="group" aria-label="Contest type">${chip("gpp", "GPP")}${chip("cash", "Cash")}${ctx.cls !== ctx.auto ? `<span class="entries-class-dot" title="Changed from the automatic call (${ctx.auto === "cash" ? "Cash" : "GPP"})"></span>` : ""}</span>`
    : "";
  const tick = ctx
    ? `<input type="checkbox" class="entries-take" data-fill="contest" data-file="${f}" value="${c}"${ctx.ticked ? " checked" : ""} title="Tick: this contest takes part in the fill" aria-label="${escapeHtml(group.displayName)} takes part" />`
    : "";
  const fold = `<button type="button" class="entries-fold" data-action="entries-fold" data-file="${f}" data-contest="${c}" aria-expanded="${!folded}" title="${folded ? "Unfold" : "Fold"} this contest's rows">${folded ? "▸" : "▾"}</button>`;
  // Adam 2026-10-18: `plain` (no saved lineups for the slate) is the two-column header: name, fee and entry count only.
  return `
      <tr class="entries-contest-head">
        <td colspan="${plain ? 2 : 3}"><div class="entries-contest-line">
          ${fold}${tick}<span class="entries-contest-name">${escapeHtml(group.displayName)}</span>
          ${group.fee ? `<span class="entries-fee">${escapeHtml(group.fee)}</span>` : ""}
          <span class="entries-quiet">${n} entr${n === 1 ? "y" : "ies"}</span>
          ${plain ? "" : `<span class="entries-contest-status${assignedN + proposedN ? " some" : ""}">${status}</span>
          ${toggle}
          <button type="button" class="saved-lineup-btn entries-clear" data-action="entries-clear" data-file="${f}" data-contest="${c}"${done ? "" : " disabled"}>Clear</button>`}
        </div></td>
      </tr>`;
}

// `keep`: a Set of entry ids the planner never opens (Adam's hand picks and "(leave as is)" rows); null = none (🔵 2026-10-17).
// `prior`: the last proposal shown { entryId: lineupId }, planFill's first choice per row; null = none (👁 2026-10-17).
// Frozen: callers spread it (🔵 2026-10-17). Adam 2026-10-18: the lead lineup (`lead`, `priorLead`) is gone with the lead-lineup order.
export const FILL_DEFAULT = Object.freeze({ lineupIds: null, contestIds: null, overwrite: false, dismissed: false, lastLineup: null, keep: null, prior: null });

/** A hand pick in a row's picker (🔵 2026-10-17): the row's pick is set, or cleared by "(leave as is)", and the row joins
 *  `keep`, so the planner never proposes over it until Re-propose or Clear (Confirm leaves `keep` alone, Adam 2026-10-17).
 *  Returns new { assign, keep }. */
export function handPick(assign, keep, entryId, lineupId) {
  const next = { ...(assign ?? {}) };
  if (lineupId) next[entryId] = lineupId;
  else delete next[entryId];
  return { assign: next, keep: new Set([...(keep ?? []), String(entryId)]) };
}

/** Re-propose: the proposal comes back in full and "(leave as is)" rows are planned afresh (🔵 2026-10-17; Discard leaves
 *  `keep` as it is). Adam 2026-10-18: a hand pick is final, so a kept row that has an effective pick in `assign` (the caller passes effectiveAssignments, so a deleted lineup's id is no pick) stays kept; without `assign`
 *  every kept row reopens. */
export function reproposeFill(s, assign = null) {
  const hand = [...(s?.keep ?? [])].filter((id) => Boolean(assign?.[id]));
  return { ...FILL_DEFAULT, ...(s ?? {}), keep: hand.length ? new Set(hand) : null, dismissed: false, prior: null };
}

/** 🔵 2026-10-17 (F1): the localStorage key of one uploaded file's kept rows, beside its picks (a newer upload starts open). */
export function keepStorageKey(fileName) {
  return `nfldfs.entries.keep.v1:${fileName}`;
}

/** 🔵 2026-10-17 (F1): kept entry ids read back from storage: a JSON array, pruned to ids still in the file. Returns a Set
 *  (possibly empty), or null when the text is missing, unreadable or not an array. */
export function restoreKeep(raw, entries) {
  let arr;
  try {
    arr = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const inFile = new Set((entries ?? []).map((e) => String(e.entryId)));
  return new Set(arr.filter((id) => typeof id === "string" || typeof id === "number").map(String).filter((id) => inFile.has(id)));
}

/** 🔵 2026-10-17 (F2): Confirm's whole state change. The proposals join the picks; Replace is one-shot so it goes off; the
 *  proposal is no longer discarded and the plan starts afresh (`prior` null); `keep` is left as it is (Adam 2026-10-17: only
 *  Re-propose, a hand pick or Clear changes it). `scoped` (🔵 2026-10-18, one tab's Confirm): Replace and `prior` stay as they were,
 *  so the other tab's rows are not replanned. Returns new { assign, fill }. */
export function confirmFill(assign, fill, proposals, scoped = false) {
  return {
    assign: { ...(assign ?? {}), ...(proposals ?? {}) },
    fill: { ...FILL_DEFAULT, ...(fill ?? {}), ...(scoped ? {} : { overwrite: false, prior: null }), dismissed: false },
  };
}

/** 🔵 2026-10-17 (F3): how many kept rows "Reopen" would visibly change: kept rows of the file with no effective pick.
 *  Adam 2026-10-18: a hand-picked kept row is final, so it never counts, Replace or not. */
export function keptOpenCount(kept, entries, eff) {
  const inFile = new Set((entries ?? []).map((e) => String(e.entryId)));
  return [...(kept ?? [])].filter((id) => inFile.has(String(id)) && !eff?.[id]).length;
}

/** The control that opens kept rows again (🔵 2026-10-17): "Re-propose" after Discard, else "Reopen N kept rows" while
 *  any row is kept; "" when neither. The kept tag's title names the same control. */
export function reopenLabel(fill, keptN) {
  if (fill?.dismissed) return "Re-propose";
  return keptN > 0 ? `Reopen ${keptN} kept row${keptN === 1 ? "" : "s"}` : "";
}

/** Clear on a contest's header (🔵 2026-10-17): the contest's rows leave `keep`, so the fill may propose for them again.
 *  Returns the new fill state; other contests' kept rows stay. */
export function clearContestFill(fill, entries, contestId) {
  const s = { ...FILL_DEFAULT, ...(fill ?? {}) };
  if (!s.keep) return s;
  const gone = new Set((entries ?? []).filter((e) => contestKey(e) === String(contestId)).map((e) => String(e.entryId)));
  const keep = [...s.keep].filter((id) => !gone.has(String(id)));
  return { ...s, keep: keep.length ? new Set(keep) : null };
}

/** Fill cash / Fill GPP (Adam 2026-10-17): every lineup of the class ticked, the other class's lineup ticks as they were
 *  (null stays null: all ticked already), only that class's contests ticked, the proposal back (dismissed off, prior
 *  dropped). `keep`, `overwrite` and `lastLineup` stay: a "(leave as is)" row stays until Re-propose or a hand
 *  pick. `model` is fillModelOf's answer; returns a new fill state. `scoped` (Adam 2026-10-18, the GPP and Cash tabs): the
 *  other class's contest ticks stay as they were, so a click in one tab never changes the other tab's proposal. */
export function fillClassPreset(fill, model, cls, scoped = false) {
  const s = { ...FILL_DEFAULT, ...(fill ?? {}) };
  const mine = (model?.[cls] ?? []).map((l) => String(l.id));
  const lineupIds = s.lineupIds == null ? null : [...s.lineupIds.map(String).filter((id) => !mine.includes(id)), ...mine];
  const groups = model?.groups ?? [];
  const mineC = groups.filter((g) => model.classes?.[g.contestId] === cls).map((g) => g.contestId);
  const others = scoped ? (s.contestIds ?? groups.map((g) => g.contestId)).map(String).filter((id) => model.classes?.[id] !== cls) : [];
  return { ...s, lineupIds, contestIds: [...others, ...mineC], dismissed: false, prior: null };
}

/** All / None on the contest ticks of one class only (Adam 2026-10-18, the GPP and Cash tabs): the other class keeps its ticks.
 *  Returns the new `contestIds` (an array of contest ids). */
export function tickClassContests(contestIds, model, cls, on) {
  const groups = model?.groups ?? [];
  const current = (contestIds ?? groups.map((g) => g.contestId)).map(String);
  const others = current.filter((id) => model.classes?.[id] !== cls);
  const mine = groups.filter((g) => model.classes?.[g.contestId] === cls).map((g) => g.contestId);
  return on ? [...others, ...mine] : others;
}

/** The slate's saved lineups for the Sort choice: their numbers, the sorted list, the ids in that order and the
 *  complete ones split { cash, gpp } (Adam 2026-10-17, plan items 5 and 7a). */
export function fillListsOf(lineups, sortBy) {
  const by = sortBy === "letter" ? "letter" : "number";
  const numbers = numberLineups(lineups);
  const sorted = sortLineupsBy(lineups, by, numbers);
  const order = sorted.map((l) => l.id);
  return { by, numbers, sorted, order, ...orderedFillLineups(lineups, order) };
}

/** Everything the strip and the rows show for one file, recomputed on every render and held in memory only (plan item 6):
 *  the ticked state, the contest classes, planFill's answer and its proposals that are still valid. `eff` is every
 *  effective pick of the file. `view`: { fill, classes, sortBy }. */
export function fillModelOf(entries, slateKey, lineups, eff, slates, view) {
  const fill = { ...FILL_DEFAULT, ...(view?.fill ?? {}) };
  const lists = fillListsOf(lineups, view?.sortBy);
  const groups = groupByContest(entries);
  const classes = effectiveClasses(groups, view?.classes);
  // 🔵 2026-10-18: the fill follows the Saved tab's number order whatever the Sort toggle shows (it orders the lists and pickers only).
  const planOrder = (lists.by === "number" ? lists : fillListsOf(lineups, "number")).order;
  const plan = planFill({ entries, lineups, assigned: eff, classes, overwrite: fill.overwrite, keep: fill.keep, prior: fill.prior, lineupIds: fill.lineupIds, contestIds: fill.contestIds, order: planOrder, slateKey, slates });
  // 🔵 2026-10-17: validProposals sees every pick, Replace and the kept rows, as planFill did and as Confirm will write.
  const valid = validProposals(plan.proposed, entries, lineups, eff, classes, slateKey, slates, { overwrite: fill.overwrite, keep: fill.keep });
  const kept = new Set(Array.from(fill.keep ?? [], String));
  // 🔵 2026-10-17 (F3): `keptOpen` is the count the Reopen button shows: kept rows with no effective pick (a hand pick never counts, D75, Adam 2026-10-18).
  // Adam 2026-10-18: rowHolds is the one decision; a proposal for a hand-picked row is dropped here too, so neither the picker nor Confirm can use it.
  const shown = Object.fromEntries(Object.entries(valid).filter(([id, lid]) => rowHolds({ pick: eff?.[id], kept: kept.has(String(id)), proposedId: lid }).state === "proposed"));
  return { fill, ...lists, lineups, groups, classes, plan, kept, keptOpen: keptOpenCount(kept, entries, eff), proposals: fill.dismissed ? {} : shown };
}

function fillListHtml(file, title, which, list, m, empty) {
  const f = escapeHtml(file);
  const ticked = m.fill.lineupIds == null ? null : new Set(m.fill.lineupIds.map(String));
  const on = (l) => ticked === null || ticked.has(String(l.id));
  const boxes = list
    .map((l) => `<label class="entries-check"><input type="checkbox" data-fill="lineup" data-list="${which}" data-file="${f}" value="${escapeHtml(l.id)}"${on(l) ? " checked" : ""} /><span title="${escapeHtml(lineupOptionLabel(l, m.numbers))}">${escapeHtml(lineupLabel(l, m.numbers))}</span></label>`)
    .join("");
  const btn = (set, text) => `<button type="button" class="saved-lineup-btn" data-action="entries-fill-lineups" data-file="${f}" data-which="${which}" data-set="${set}">${text}</button>`;
  return `
        <div class="entries-fill-col">
          <div class="entries-fill-head">
            <span class="entries-fill-title">${title}</span>${btn("all", "All")}${btn("none", "None")}
            <span class="entries-quiet">${list.filter(on).length} of ${list.length}</span>
          </div>
          <div class="entries-fill-scroll" data-file="${f}" data-list="${which}" title="Shift-click to tick or untick a run of lineups">${list.length ? `<div class="entries-fill-list">${boxes}</div>` : `<div class="entries-quiet">${escapeHtml(empty)}</div>`}</div>
        </div>`;
}

/** The proposals of one class: { entryId: lineupId } cut to the entries of contests in that class (all of them with `cls` null). */
export function classProposals(m, cls = null) {
  if (!cls) return m.proposals;
  const classOfEntry = new Map(m.groups.flatMap((g) => g.entries.map((e) => [e.entryId, m.classes[g.contestId]])));
  return Object.fromEntries(Object.entries(m.proposals).filter(([id]) => classOfEntry.get(id) === cls));
}

/** A tab's Confirm (🔵 2026-10-18 round 2): confirmFill for that class's proposals. Scoped while the other class still has
 *  proposals (Replace and `prior` stay for it); the Confirm that clears the last ones is unscoped, so Replace goes off. */
export function confirmClassFill(assign, fill, m, cls) {
  const other = cls === "gpp" ? "cash" : "gpp";
  return confirmFill(assign, fill, classProposals(m, cls), Boolean(cls) && Object.keys(classProposals(m, other)).length > 0);
}

/** Confirm and the proposal's summary, shown at the top of a file's GPP or Cash tab (Adam 2026-10-18): the Confirm N
 *  button (only that class's proposals; every proposal with `cls` null), the count, and the planner's notes for that class. */
export function fillTopHtml(file, m, cls = null) {
  const f = escapeHtml(file);
  const mine = classProposals(m, cls);
  const nProp = Object.keys(mine).length;
  const classOfEntry = new Map(m.groups.flatMap((g) => g.entries.map((e) => [e.entryId, m.classes[g.contestId]])));
  const nCash = Object.keys(mine).filter((id) => classOfEntry.get(id) === "cash").length;
  const nameOf = new Map(m.groups.map((g) => [g.contestId, g.displayName]));
  // 👁 2026-10-17: a note names its contest only when it is about one; grouped and general notes carry contestId null.
  const noteText = (n) => (n.contestId != null && nameOf.has(n.contestId) ? `${nameOf.get(n.contestId)}: ${n.text}` : n.text);
  const notes = m.fill.dismissed ? "" : m.plan.notes.filter((n) => !cls || n.cls === cls).map((n) => `<div class="entries-quiet">${escapeHtml(noteText(n))}</div>`).join("");
  const summary = nProp ? (cls ? `${nProp} proposed` : `${nProp} proposed (${nCash} cash, ${nProp - nCash} GPP)`) : "Nothing to propose.";
  const go = m.fill.dismissed
    ? `<span class="entries-quiet">Proposal discarded; the rows stay as they are. Re-propose is under Adjust.</span>`
    : `<button type="button" class="lineup-build-btn" data-action="entries-fill-confirm" data-file="${f}"${cls ? ` data-class="${cls}"` : ""}${nProp ? "" : " disabled"}>Confirm ${nProp}</button>
          <span class="entries-quiet">${summary}</span>`;
  return `<div class="entries-fill-go">${go}</div>${notes ? `<div class="entries-fill-notes">${notes}</div>` : ""}`;
}

/** The fill controls under a file's Adjust fold (D75 as amended 2026-10-17, entries fill plan items 5 and 6): the lineup
 *  lists with All / None and the Sort toggle, the contest buttons, the Replace tick and the Fill / Discard / Re-propose
 *  buttons. `cls` (Adam 2026-10-18): a GPP or Cash tab shows only that class's list, buttons and contests; null shows both.
 *  Confirm and the notes are in fillTopHtml. `m` is fillModelOf's answer. */
export function fillStripHtml(file, m, cls = null) {
  const f = escapeHtml(file);
  const { fill } = m;
  const sortChip = (by, text) => `<button type="button" class="chip toggle-chip${m.by === by ? " active" : ""}" data-action="entries-sort" data-sort="${by}" aria-pressed="${m.by === by}">${text}</button>`;
  const scope = cls ? ` data-class="${cls}"` : "";
  const cBtn = (set, text) => `<button type="button" class="saved-lineup-btn" data-action="entries-fill-contests" data-file="${f}" data-set="${set}"${scope}>${text}</button>`;
  const foldBtn = (set, text) => `<button type="button" class="saved-lineup-btn" data-action="entries-fold-all" data-file="${f}" data-set="${set}"${scope}>${text}</button>`;
  const shown = cls ? m.groups.filter((g) => m.classes[g.contestId] === cls) : m.groups;
  const tickedC = fill.contestIds == null ? shown.length : shown.filter((g) => fill.contestIds.map(String).includes(g.contestId)).length;
  const nProp = Object.keys(m.proposals).length;
  const reopen = reopenLabel(fill, m.keptOpen);
  // Adam 2026-10-17: Fill cash / Fill GPP tick one whole class and propose it; disabled with no complete lineup of the class.
  const classBtn = (cls, text) => {
    const label = cls === "cash" ? "Cash" : "GPP";
    const noLineups = m[cls].length === 0;
    // 🔵 2026-10-17 (F4): also disabled with no contest of the class in the file (it would only wipe the contest ticks).
    const noContests = !m.groups.some((g) => m.classes[g.contestId] === cls);
    const none = noLineups || noContests;
    const title = noLineups ? `No ${label} lineups saved` : noContests ? `No ${cls === "cash" ? "cash" : "GPP"} contests in this file` : `Tick every ${label} lineup and every ${cls === "cash" ? "cash" : "GPP"} contest, then propose; Confirm writes it`;
    return `<button type="button" class="saved-lineup-btn entries-fill-class" data-action="entries-fill-class" data-file="${f}" data-class="${cls}" title="${title}"${none ? " disabled" : ""}>${text}</button>`;
  };
  const classBtns = cls ? classBtn(cls, cls === "cash" ? "Fill cash" : "Fill GPP") : `${classBtn("cash", "Fill cash")}${classBtn("gpp", "Fill GPP")}`;
  // Discard is the file's (both tabs' proposals go); Re-propose brings them back.
  const go = fill.dismissed
    ? `${classBtns}<button type="button" class="lineup-build-btn" data-action="entries-fill-repropose" data-file="${f}">${reopen}</button><span class="entries-quiet">Proposal discarded; the rows stay as they are.</span>`
    : `${classBtns}<button type="button" class="saved-lineup-btn" data-action="entries-fill-discard" data-file="${f}" title="Discards the proposals of both the GPP and the Cash tab"${nProp ? "" : " disabled"}>Discard</button>
          ${reopen ? `<button type="button" class="saved-lineup-btn" data-action="entries-fill-repropose" data-file="${f}">${reopen}</button>` : ""}`;
  const lists = [
    cls !== "gpp" ? fillListHtml(file, "Cash Lineups", "cash", m.cash, m, "No Cash lineups. Save a lineup in Cash mode and it shows here.") : "",
    cls !== "cash" ? fillListHtml(file, "GPP lineups", "gpp", m.gpp, m, "No GPP lineups saved.") : ""
  ].join("");
  const classChoice = cls ? "" : `${cBtn("cash", "All cash")}${cBtn("gpp", "All GPP")}`;
  return `
      <div class="entries-fill">
        <div class="entries-fill-bar"><span class="entries-fill-title">Fill from saved lineups</span><span class="entries-fill-sort"><span class="entries-quiet">Sort:</span>${sortChip("number", "1 2 3")}${sortChip("letter", "A B C")}</span></div>
        <div class="entries-fill-lists">
          ${lists}
        </div>
        <div class="entries-fill-bar"><span class="entries-fill-title">Contests</span>${cBtn("all", "All")}${cBtn("none", "None")}${classChoice}${foldBtn("fold", "Fold all")}${foldBtn("unfold", "Unfold all")}<span class="entries-quiet">${tickedC} of ${shown.length} take part</span></div>
        <div class="entries-fill-bar">
          <label class="entries-check"><input type="checkbox" data-fill="overwrite" data-file="${f}"${fill.overwrite ? " checked" : ""} /><span>Replace rows already assigned</span></label>
        </div>
        <div class="entries-quiet">A replaced row keeps its own pick when the fill would hand it the same lineup.</div>
        <div class="entries-quiet">Lineups go in number order, 1 to the number of entries, one per entry.</div>
        <div class="entries-fill-go">${go}</div>
      </div>`;
}
