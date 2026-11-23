// The Entries fill strip's pure builders (D75 as amended 2026-10-17; entries fill plan items 5, 6 and 7a): the lineup
// lists, the per-file fill model (planFill plus the proposals still valid), the strip's HTML and each contest's header.
// Split out of entries.js for size (🔵 2026-10-17); entries.js imports and re-exports every name here. Imports only
// format.js, entries-plan.js, lineup-tags.js and totals.js, never entries.js.
import { escapeHtml, money, dec1 } from "./format.js";
import { groupByContest, effectiveClasses, orderedFillLineups, planFill, validProposals, contestKey, lineupModeOf, rowHolds, ENTRIES_STORAGE_NS } from "./entries-plan.js";
import { numberLineups, lineupLabel, sortLineupsBy } from "./lineup-tags.js";
import { shownTotal } from "./totals.js";

/** "Name - 152.3 proj - $49,800": how one saved lineup reads in a picker. With `numbers` (numberLineups) the name part
 *  is the "1 · A · name" label (Adam 2026-10-17, plan item 7a). `nameOf(lineup, numbers)` (the Showdown tab adds the Captain) is that label;
 *  classic's is lineupLabel. */
export function lineupOptionLabel(lineup, numbers = null, nameOf = lineupLabel) {
  const name = numbers ? nameOf(lineup, numbers) : String(lineup?.name ?? "").trim() || "Lineup";
  const projs = (lineup?.slots ?? []).map((s) => s?.proj);
  const known = projs.filter((v) => typeof v === "number" && Number.isFinite(v)).length;
  const gap = known > 0 && known < projs.length; // G62: some slots shown and one without a projection makes the total missing, never a partial sum (no slot figure at all: the stored total, as before)
  const proj = gap ? null : dec1(shownTotal(projs) ?? lineup?.totalProj); // ChatGPT wish d, Adam 2026-10-17: the sum of the saved players' shown projections
  const cash = lineupModeOf(lineup) === "cash" ? "$ Cash · " : ""; // Cash mode job 3b, 2026-10-17: the one browser mode rule (lineup-cash.js, through entries-plan.js)
  return `${cash}${name} · ${proj == null ? "no proj" : `${proj} proj`} · ${money(lineup?.salaryUsed)}`;
}

/** How many of a contest's entries have a lineup picked in `assigned`. */
export function assignedInContest(group, assigned) {
  return (group?.entries ?? []).filter((e) => Boolean(assigned?.[e.entryId])).length;
}

/** One contest's header line in NBA's look (lsw-maps.js group head): the select-the-contest box, the fold button, name, fee, entry
 *  count and "14 set · 6 suggested · 0 without a lineup", the GPP | Cash toggle and the Clear button. `ctx` { cls, auto, ticked, sel,
 *  adjust } adds the box (`sel`: how many of its rows are selected), the toggle (a dot marks a class that differs from the automatic
 *  call) and, while the fill options are open (`adjust`), the "takes part" tick; `proposals` { entryId: lineupId } are the unconfirmed
 *  rows (D75). `folded` (Adam 2026-10-17): ▸ when the contest's rows are hidden, ▾ when shown; drawn with no `ctx` too. `plain` (no saved
 *  lineups, Adam 2026-10-18): name, fee and entry count only. */
export function contestHeadHtml(file, group, assigned, ctx = null, proposals = null, folded = false, plain = false) {
  const n = group.entries.length;
  const done = assignedInContest(group, assigned);
  const proposedN = group.entries.filter((e) => proposals?.[e.entryId] != null).length;
  const assignedN = group.entries.filter((e) => assigned?.[e.entryId] && proposals?.[e.entryId] == null).length;
  const open = n - assignedN - proposedN;
  const status = `${assignedN} set · ${proposedN} suggested · <b class="${open ? "red" : ""}">${open} without a lineup</b>`;
  const f = escapeHtml(file);
  const c = escapeHtml(group.contestId);
  const chip = (cls, text) => `<button type="button" class="fc entries-class-chip${ctx?.cls === cls ? " on" : ""}" data-action="entries-class" data-file="${f}" data-contest="${c}" data-class="${cls}" aria-pressed="${ctx?.cls === cls}" title="Treat this contest as ${cls === "cash" ? "Cash: it takes your Cash lineups" : "GPP: it takes your GPP lineups"}">${text}</button>`;
  const toggle = ctx
    ? `<span class="entries-class" role="group" aria-label="Contest type">${chip("gpp", "GPP")}${chip("cash", "Cash")}${ctx.cls !== ctx.auto ? `<span class="entries-class-dot" title="Changed from the automatic call (${ctx.auto === "cash" ? "Cash" : "GPP"})"></span>` : ""}</span>`
    : "";
  const tick = ctx?.adjust
    ? `<label class="entries-take-l" title="Ticked: the suggestions cover this contest"><input type="checkbox" class="entries-take" data-fill="contest" data-file="${f}" value="${c}"${ctx.ticked ? " checked" : ""} aria-label="${escapeHtml(group.displayName)} takes part" /> in suggestions</label>`
    : "";
  const k = ctx?.sel ?? 0;
  const box = ctx
    ? `<span class="cb${k === n ? " on" : k ? " part" : ""}" data-action="entries-pick-group" data-file="${f}" data-contest="${c}" role="checkbox" aria-checked="${k === n}" tabindex="0" title="Select this whole contest"></span>`
    : `<span></span>`;
  const fold = `<button type="button" class="entries-fold" data-action="entries-fold" data-file="${f}" data-contest="${c}" aria-expanded="${!folded}" title="${folded ? "Unfold" : "Fold"} this contest's rows">${folded ? "▸" : "▾"}</button>`;
  return `
      <div class="er gh entries-contest-head${!plain && open === 0 ? " done" : ""}">${box}
        <span class="gn">${fold}<span class="entries-contest-name">${escapeHtml(group.displayName)}</span>${group.fee ? `<span class="entries-fee">${escapeHtml(group.fee)}</span>` : ""}<span class="muted gc2">${n} entr${n === 1 ? "y" : "ies"}</span></span>
        ${plain ? "" : `<span class="muted gc2 entries-contest-status">${status}</span>${tick}${toggle}
        <button type="button" class="ol sm entries-clear" data-action="entries-clear" data-file="${f}" data-contest="${c}" title="Takes every lineup off this contest's rows, so they are suggested again"${done ? "" : " disabled"}>Clear</button>`}
      </div>`;
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
export function keepStorageKey(fileName, ns = ENTRIES_STORAGE_NS) {
  return `${ns}.keep.v1:${fileName}`;
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

/** The control that opens kept rows again (🔵 2026-10-17): "Suggest again" after Clear suggestions, else "Reopen N kept rows" while
 *  any row is kept; "" when neither. The kept tag's title names the same control. */
export function reopenLabel(fill, keptN) {
  if (fill?.dismissed) return "Suggest again";
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
 *  complete ones split { cash, gpp } (Adam 2026-10-17, plan items 5 and 7a). `fileContext`: the second-slates array, or a
 *  Showdown file-id context function, handed on to orderedFillLineups (Showdown Entries plan step 3). `numberOver` (the Showdown
 *  tab): the list the numbers run over when `lineups` is only the pickable part of it, so a lineup keeps the number the game's
 *  saved lineups give it; absent, the numbers run over `lineups` as in classic. */
export function fillListsOf(lineups, sortBy, fileContext = [], numberOver = null) {
  const by = sortBy === "letter" ? "letter" : "number";
  const numbers = numberLineups(numberOver ?? lineups);
  const sorted = sortLineupsBy(lineups, by, numbers);
  const order = sorted.map((l) => l.id);
  return { by, numbers, sorted, order, ...orderedFillLineups(lineups, order, fileContext) };
}

/** Everything the strip and the rows show for one file, recomputed on every render and held in memory only (plan item 6):
 *  the ticked state, the contest classes, planFill's answer and its proposals that are still valid. `eff` is every
 *  effective pick of the file. `view`: { fill, classes, sortBy, numberOver (optional, see fillListsOf) }. `fileContext`: the
 *  second-slates array, or a Showdown file-id context function (entries-plan.js showdownFileKeyOf), passed on to every file-key check. */
export function fillModelOf(entries, slateKey, lineups, eff, fileContext, view) {
  const fill = { ...FILL_DEFAULT, ...(view?.fill ?? {}) };
  const numberOver = view?.numberOver ?? null;
  const lists = fillListsOf(lineups, view?.sortBy, fileContext, numberOver);
  const groups = groupByContest(entries);
  const classes = effectiveClasses(groups, view?.classes);
  // 🔵 2026-10-18: the fill follows the Saved tab's number order whatever the Sort toggle shows (it orders the lists and pickers only).
  const planOrder = (lists.by === "number" ? lists : fillListsOf(lineups, "number", fileContext, numberOver)).order;
  const plan = planFill({ entries, lineups, assigned: eff, classes, overwrite: fill.overwrite, keep: fill.keep, prior: fill.prior, lineupIds: fill.lineupIds, contestIds: fill.contestIds, order: planOrder, slateKey, fileContext });
  // 🔵 2026-10-17: validProposals sees every pick, Replace and the kept rows, as planFill did and as Confirm will write.
  const valid = validProposals(plan.proposed, entries, lineups, eff, classes, slateKey, fileContext, { overwrite: fill.overwrite, keep: fill.keep });
  const kept = new Set(Array.from(fill.keep ?? [], String));
  // 🔵 2026-10-17 (F3): `keptOpen` is the count the Reopen button shows: kept rows with no effective pick (a hand pick never counts, D75, Adam 2026-10-18).
  // Adam 2026-10-18: rowHolds is the one decision; a proposal for a hand-picked row is dropped here too, so neither the picker nor Confirm can use it.
  const shown = Object.fromEntries(Object.entries(valid).filter(([id, lid]) => rowHolds({ pick: eff?.[id], kept: kept.has(String(id)), proposedId: lid }).state === "proposed"));
  // `lineupLabelOf` (view, the Showdown tab's Captain label) rides on the model for the lineup lists; classic's model has no such key.
  return { fill, ...lists, lineups, groups, classes, plan, kept, keptOpen: keptOpenCount(kept, entries, eff), proposals: fill.dismissed ? {} : shown, ...(view?.lineupLabelOf ? { lineupLabelOf: view.lineupLabelOf } : {}) };
}

function fillListHtml(file, title, which, list, m, empty) {
  const f = escapeHtml(file);
  const ticked = m.fill.lineupIds == null ? null : new Set(m.fill.lineupIds.map(String));
  const on = (l) => ticked === null || ticked.has(String(l.id));
  const nameOf = m.lineupLabelOf ?? lineupLabel;
  const boxes = list
    .map((l) => `<label class="entries-check"><input type="checkbox" data-fill="lineup" data-list="${which}" data-file="${f}" value="${escapeHtml(l.id)}"${on(l) ? " checked" : ""} /><span title="${escapeHtml(lineupOptionLabel(l, m.numbers, nameOf))}">${escapeHtml(nameOf(l, m.numbers))}</span></label>`)
    .join("");
  const btn = (set, text) => `<button type="button" class="ol sm" data-action="entries-fill-lineups" data-file="${f}" data-which="${which}" data-set="${set}">${text}</button>`;
  return `
        <div class="entries-fill-col">
          <div class="entries-fill-head">
            <span class="entries-fill-title">${title}</span>${btn("all", "All")}${btn("none", "None")}
            <span class="muted">${list.filter(on).length} of ${list.length} used</span>
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

/** The suggestion bar at the top of a file's GPP or Cash tab (Adam 2026-10-18; NBA's "Use suggested spots" line, lsw-maps.js): Confirm
 *  suggestions (n) writes only that class's proposals (every proposal with `cls` null), Clear suggestions drops both tabs' (Discard),
 *  Suggest again or Reopen N kept rows opens them again, and the planner's notes for that class sit under it. */
export function fillTopHtml(file, m, cls = null) {
  const f = escapeHtml(file);
  const mine = classProposals(m, cls);
  const nProp = Object.keys(mine).length;
  const classOfEntry = new Map(m.groups.flatMap((g) => g.entries.map((e) => [e.entryId, m.classes[g.contestId]])));
  const nCash = Object.keys(mine).filter((id) => classOfEntry.get(id) === "cash").length;
  const nameOf = new Map(m.groups.map((g) => [g.contestId, g.displayName]));
  // 👁 2026-10-17: a note names its contest only when it is about one; grouped and general notes carry contestId null.
  const noteText = (n) => (n.contestId != null && nameOf.has(n.contestId) ? `${nameOf.get(n.contestId)}: ${n.text}` : n.text);
  const notes = m.fill.dismissed ? "" : m.plan.notes.filter((n) => !cls || n.cls === cls).map((n) => `<div class="rs">${escapeHtml(noteText(n))}</div>`).join("");
  const nAll = Object.keys(m.proposals).length;
  const reopen = reopenLabel(m.fill, m.keptOpen);
  const reopenBtn = reopen ? `<button type="button" class="ol" data-action="entries-fill-repropose" data-file="${f}" title="Rows you left as they are get suggestions again; rows you set by hand stay">${reopen}</button>` : "";
  const what = cls === "cash" ? "Cash" : cls === "gpp" ? "GPP" : "";
  const summary = nProp
    ? cls ? `${nProp} ${what} ${nProp === 1 ? "entry has" : "entries have"} a suggested lineup, not written until you confirm` : `${nProp} suggested (${nCash} cash, ${nProp - nCash} GPP)`
    : `No ${what ? `${what} ` : ""}suggestions waiting.`;
  const go = m.fill.dismissed
    ? `<span class="muted">Suggestions cleared; the rows stay as they are.</span>${reopenBtn}`
    : `<button type="button" class="${nProp ? "go" : "ol"}" data-action="entries-fill-confirm" data-file="${f}"${cls ? ` data-class="${cls}"` : ""} title="Writes the suggested lineups into these rows; the other tab's suggestions wait for their own Confirm"${nProp ? "" : " disabled"}>Confirm suggestions (${nProp})</button>
          <button type="button" class="ol" data-action="entries-fill-discard" data-file="${f}" title="Clears the suggestions of both the GPP and the Cash tab; rows already set stay"${nAll ? "" : " disabled"}>Clear suggestions</button>${reopenBtn}
          <span class="muted">${summary}</span>`;
  return `<div class="bulk entries-fill-go">${go}</div>${notes ? `<div class="entries-fill-notes">${notes}</div>` : ""}`;
}

/** The fill options under a file's "Suggestion options" fold (D75 as amended 2026-10-17, entries fill plan items 5 and 6): the lineup
 *  lists with All / None and the Sort toggle, the contest buttons, the Replace tick and Fill GPP / Fill cash. `cls` (Adam 2026-10-18): a
 *  GPP or Cash tab shows only that class's list, buttons and contests; null shows both. Confirm, Clear suggestions and Suggest again are
 *  in fillTopHtml. `m` is fillModelOf's answer. */
export function fillStripHtml(file, m, cls = null) {
  const f = escapeHtml(file);
  const { fill } = m;
  const sortChip = (by, text) => `<button type="button" class="fc${m.by === by ? " on" : ""}" data-action="entries-sort" data-sort="${by}" aria-pressed="${m.by === by}">${text}</button>`;
  const scope = cls ? ` data-class="${cls}"` : "";
  const cBtn = (set, text) => `<button type="button" class="ol sm" data-action="entries-fill-contests" data-file="${f}" data-set="${set}"${scope}>${text}</button>`;
  const foldBtn = (set, text) => `<button type="button" class="ol sm" data-action="entries-fold-all" data-file="${f}" data-set="${set}"${scope}>${text}</button>`;
  const shown = cls ? m.groups.filter((g) => m.classes[g.contestId] === cls) : m.groups;
  const tickedC = fill.contestIds == null ? shown.length : shown.filter((g) => fill.contestIds.map(String).includes(g.contestId)).length;
  // Adam 2026-10-17: Fill cash / Fill GPP tick one whole class and propose it; disabled with no complete lineup of the class.
  const classBtn = (cls, text) => {
    const label = cls === "cash" ? "Cash" : "GPP";
    const noLineups = m[cls].length === 0;
    // 🔵 2026-10-17 (F4): also disabled with no contest of the class in the file (it would only wipe the contest ticks).
    const noContests = !m.groups.some((g) => m.classes[g.contestId] === cls);
    const none = noLineups || noContests;
    const title = noLineups ? `No ${label} lineups saved` : noContests ? `No ${cls === "cash" ? "cash" : "GPP"} contests in this file` : `Use every ${label} lineup and every ${cls === "cash" ? "cash" : "GPP"} contest, then suggest; Confirm writes it`;
    return `<button type="button" class="ol entries-fill-class" data-action="entries-fill-class" data-file="${f}" data-class="${cls}" title="${title}"${none ? " disabled" : ""}>${text}</button>`;
  };
  const classBtns = cls ? classBtn(cls, cls === "cash" ? "Suggest all cash" : "Suggest all GPP") : `${classBtn("cash", "Suggest all cash")}${classBtn("gpp", "Suggest all GPP")}`;
  const lists = [
    cls !== "gpp" ? fillListHtml(file, "Cash lineups", "cash", m.cash, m, "No Cash lineups. Save a lineup in Cash mode and it shows here.") : "",
    cls !== "cash" ? fillListHtml(file, "GPP lineups", "gpp", m.gpp, m, "No GPP lineups saved.") : ""
  ].join("");
  const classChoice = cls ? "" : `${cBtn("cash", "All cash")}${cBtn("gpp", "All GPP")}`;
  return `
      <div class="entries-fill">
        <div class="entries-fill-bar"><span class="entries-fill-title">Lineups the suggestions use</span><span class="entries-fill-sort"><span class="muted">Sort:</span>${sortChip("number", "1 2 3")}${sortChip("letter", "A B C")}</span><span class="grow"></span>${classBtns}</div>
        <div class="entries-fill-lists">
          ${lists}
        </div>
        <div class="entries-fill-bar"><span class="entries-fill-title">Contests</span>${cBtn("all", "All")}${cBtn("none", "None")}${classChoice}${foldBtn("fold", "Fold all")}${foldBtn("unfold", "Unfold all")}<span class="muted">${tickedC} of ${shown.length} in the suggestions</span></div>
        <div class="entries-fill-bar">
          <label class="entries-check"><input type="checkbox" data-fill="overwrite" data-file="${f}"${fill.overwrite ? " checked" : ""} /><span>Replace rows already assigned</span></label>
          <span class="muted">A replaced row keeps its own pick when the suggestion would hand it the same lineup. Lineups go in number order, 1 to the number of entries, one per entry.</span>
        </div>
      </div>`;
}
