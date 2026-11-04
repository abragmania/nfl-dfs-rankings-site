// The Showdown Lineup Builder's saved-lineups view: the saved card (number, letter, slots, totals), the section around the
// cards (with the "only lineups with" filter and its exposure tables on the live app, D77), the card buttons' wiring and the
// one-PUT-per-card guard. The panel's state stays in ./lineup.js, which hands what this reads in as arguments.
import { escapeHtml, dec1 } from "../format.js";
import { TAG_OPTIONS, numberLineups, lineupPrefix, byAge } from "../lineup-tags.js"; // the one copy of the number / letter helpers
import { filterLineups } from "../lineup-filter.js";
import { wireRenameEnter } from "../rename-focus.js"; // C27: Enter in the rename box saves
import { requestFailureText } from "./read-json.js";
import { posPillHtml } from "./table.js";
import { modeBadgeHtml } from "../lineup-cash.js";
import { dkSelectHtml, dkDownloadHtml } from "../dk-lineup-ui.js"; // A12 (round 3): Download DK CSV for the saved lineups ticked
import { confirmHtml, anchorHtml, REPLACE_QUESTION, DELETE_QUESTION } from "../confirm-inline.js"; // C11: the replace question beside Load
import { rowMessageHtml } from "../row-message.js"; // A12: a failed delete, one red sentence on the Load and Delete row
import { showdownPalette } from "./lineup-look.js";
import { teamColours, cardPlayerRowHtml } from "../lineup-card.js";
import { lineupTotals, lineupTotalsHtml } from "../lineup-totals.js"; // A11
import { notesHtml } from "./lineup-slots.js"; // the card row's line 2 words (a cycle with lineup-slots.js: both only call each other's functions)
import { shownTotal } from "../totals.js";
import { playerFigures } from "./lineup-meter.js";

export const SALARY_CAP = 50000;
export const FLEX_COUNT = 5;

export function findRow(board, id) {
  return (board?.rows ?? []).find((r) => String(r.id) === String(id));
}

function formatSavedAt(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`;
}

// `palette`: the Showdown's team colours (lineup-look.js showdownPalette), so a saved row wears the slots' colours as classic's saved rows wear the cards'.
export function savedLineupSlotHtml(entry, palette = null, figures = playerFigures) {
  if (!entry) return "";
  const { slot, row, snap } = entry;
  const src = row ?? snap;
  if (!src) return `<div class="opt-p opt-p-empty${slot === "CPT" ? " sd-cpt-slot" : ""}"><span class="opt-p-slot">${escapeHtml(slot)}</span><span class="opt-p-empty-text">Empty</span></div>`;
  // A5: the same card row as the builder's slots and the new cards (lineup-card.js), with the man's own seat figures (the Captain's 1.5x); a man no longer on the board keeps his saved ones.
  const isCpt = slot === "CPT";
  const figs = row ? figures(row, isCpt) : null;
  const p = row
    ? { ...row, salary: isCpt ? row.cptSalary : row.salary, proj: figs.proj, own: figs.notOnBoard ? null : figs.own }
    : { id: snap?.playerId, name: snap?.name, pos: snap?.pos, team: snap?.team, salary: snap?.salary, proj: snap?.proj ?? null, own: snap?.own ?? null };
  const decor = {
    rolesFor: () => (row ? notesHtml(figs) : `<span class="opt-p-note">not on board</span>`),
    coloursFor: (team) => teamColours(palette, team),
  };
  return cardPlayerRowHtml(p, slot, decor, { posHtml: posPillHtml, bareOpp: true, cls: `${isCpt ? "sd-cpt-slot" : ""}${row ? "" : " opt-p-missing"}`.trim() }).trim();
}

// The saved card's projection total (the board row's figures, `figures` = playerFigures by default): null when
// a man is off the board or has no figure. The salary total is the board's too. The total is the sum of the six
// figures each rounded to one decimal as a card row prints them (totals.js shownTotal, ChatGPT wish d, Adam 2026-10-17), as a
// generated card's total is (lineup-totals.js, through optimizer-view.js cardHtml): 👁 V4 found this card summing the unrounded figures, so the
// same six men read 105.0 here and 105.1 on their results card.
export function savedProjTotal(lineup, board, figures = playerFigures) {
  const projs = [];
  for (const s of lineup.slots ?? []) {
    const row = findRow(board, s.playerId);
    const proj = row ? figures(row, String(s.slot ?? "").toUpperCase() === "CPT").proj : null;
    if (!Number.isFinite(proj)) return null;
    projs.push(proj);
  }
  return projs.length ? shownTotal(projs) : 0; // no slots at all: 0, as before
}

/** A11: the builder's four figures under a saved card's last slot (lineup-totals.js); a man no longer on the board costs his saved salary and has no live projection or ownership.
 *  Carries the lineup's id so lineup.js can repaint it when the modes answer's notes land. */
export function savedTotalsHtml(lineup, board, figures = playerFigures) {
  const men = (lineup.slots ?? []).map((s) => {
    const row = findRow(board, s.playerId);
    if (!row) return { salary: s.salary };
    const cpt = String(s.slot ?? "").toUpperCase() === "CPT";
    const f = figures(row, cpt);
    return { salary: cpt ? row.cptSalary : row.salary, proj: f.proj, own: f.notOnBoard ? null : f.own };
  });
  return lineupTotalsHtml(lineupTotals(men, { cap: SALARY_CAP }), { cap: SALARY_CAP, attrs: ` data-lineup-id="${escapeHtml(lineup.id)}"` });
}

/** A saved card's rows (A5), one per slot; lineup.js repaints them in place with the totals when the modes answer's notes land, so a card's rows and totals never disagree. */
export function savedSlotsHtml(lineup, board, figures = playerFigures) {
  const palette = showdownPalette(board);
  return (lineup.slots ?? []).map((s) => savedLineupSlotHtml({ slot: s.slot, row: findRow(board, s.playerId), snap: s }, palette, figures)).join("");
}

// `ui`: { renamingId, deleteConfirmId, numbers, busy, error } — the panel's open rename box and delete prompt (lineup.js's state; both
// null draws neither), `numbers` = numberLineups over ALL of this game's saved lineups (the Entries tab's numbers; null draws no
// number), `busy` = a PUT for this card is in flight (its letter and rename Save are disabled), `error` = the server's sentence for
// this card's refused change (a badge on the card, as classic's lineupErrors badge); `editableTag` = false leaves the letter select out
// (the public site, where a letter can only be refused; the prefix still shows the letter), default true.
export function savedLineupCardHtml(lineup, board, figures = playerFigures, ui = {}) {
  const { renamingId = null, deleteConfirmId = null, numbers = null, busy = false, error = null, editableTag = true, ticked = false, confirm = null, deleteError = null } = ui; // confirm: the open confirm's key (C11: `load:saved:<id>` asks before replacing unsaved slots)
  const busyAttr = busy ? " disabled" : "";
  const prefix = lineupPrefix(lineup, numbers);
  const tagOptions = `<option value=""${lineup.tag ? "" : " selected"}>no letter</option>${TAG_OPTIONS.map((t) => `<option value="${t}"${t === lineup.tag ? " selected" : ""}>${t}</option>`).join("")}`;
  const tagHtml = editableTag ? `<select class="saved-lineup-tag" data-action="sd-lineup-tag" data-id="${escapeHtml(lineup.id)}" aria-label="Letter for ${escapeHtml(lineup.name)}"${busyAttr}>${tagOptions}</select>` : "";
  const entries = (lineup.slots ?? []).map((s) => ({ slot: s.slot, row: findRow(board, s.playerId), snap: s }));
  let salaryUsed = 0;
  for (const e of entries) {
    const row = e.row;
    if (!row) {
      // The snapshot's own "salary" field is already the right one for its slot (CPT or FLEX) — routes.js
      // resolves that at save time (~line 559); there is no separate snap.cptSalary (🔵 review item 11).
      salaryUsed += e.snap.salary ?? 0;
      continue;
    }
    salaryUsed += (e.slot === "CPT" ? row.cptSalary : row.salary) ?? 0;
  }
  const overCap = salaryUsed > SALARY_CAP;
  const incomplete = entries.length < FLEX_COUNT + 1;
  const isRenaming = renamingId === lineup.id;
  const isConfirmingDelete = deleteConfirmId === lineup.id;
  const badges = [
    modeBadgeHtml(lineup), // A12 (round 3): every card says Cash or GPP, as classic's Saved card does
    error ? `<span class="saved-lineup-badge saved-lineup-badge-danger">${escapeHtml(error)}</span>` : "",
    incomplete ? `<span class="saved-lineup-badge saved-lineup-badge-warning">Incomplete</span>` : "",
    overCap ? `<span class="saved-lineup-badge saved-lineup-badge-danger">Over cap</span>` : "",
  ].join("");
  const nameHtml = isRenaming
    ? `<span class="saved-lineup-rename">
        <input type="text" class="saved-lineup-rename-input" data-rename-input value="${escapeHtml(lineup.name)}" />
        <button type="button" class="saved-lineup-mini-btn" data-action="sd-rename-save" data-id="${escapeHtml(lineup.id)}"${busyAttr}>Save</button>
        <button type="button" class="saved-lineup-mini-btn" data-action="sd-rename-cancel">Cancel</button>
      </span>`
    : `<button type="button" class="saved-lineup-name-btn" data-action="sd-rename-start" data-id="${escapeHtml(lineup.id)}" title="Click to rename">${escapeHtml(lineup.name)}</button>`;
  const rowsHtml = savedSlotsHtml(lineup, board, figures);
  const totalsBlock = savedTotalsHtml(lineup, board, figures);
  const deleteHtml = isConfirmingDelete
    ? `<span class="saved-lineup-confirm">${DELETE_QUESTION}
        <button type="button" class="saved-lineup-mini-btn danger" data-action="sd-delete-yes" data-id="${escapeHtml(lineup.id)}">Yes</button>
        <button type="button" class="saved-lineup-mini-btn" data-action="sd-delete-no">No</button>
      </span>`
    : `<button type="button" class="saved-lineup-btn danger" data-action="sd-delete-start" data-id="${escapeHtml(lineup.id)}">Delete</button>`;
  return `
    <div class="saved-lineup-card">
      <div class="saved-lineup-card-head">
        ${dkSelectHtml(lineup.id, ticked)}${prefix ? `<span class="saved-lineup-prefix">${escapeHtml(prefix)} &middot;</span>` : ""}${nameHtml}
        ${tagHtml}
        <span class="saved-lineup-time">${escapeHtml(formatSavedAt(lineup.savedAt))}</span>
        ${badges}
      </div>
      <div class="saved-lineup-slots" data-lineup-id="${escapeHtml(lineup.id)}">${rowsHtml}</div>
      ${totalsBlock}
      <div class="saved-lineup-actions">
        ${anchorHtml(`<button type="button" class="saved-lineup-btn" data-action="sd-load" data-id="${escapeHtml(lineup.id)}">Load</button>`, confirm === `load:saved:${lineup.id}` ? confirmHtml(REPLACE_QUESTION, { data: `load:saved:${lineup.id}` }) : "", { align: "left" })}
        ${deleteHtml}${deleteError ? rowMessageHtml(deleteError, "error") : ""}
      </div>
    </div>`;
}

// `saved`: { loaded, error, lineups } (lineup.js's state); `cardOf(lineup, numbers)`: one card's html, `numbers` = numberLineups over all
// of this game's saved lineups, so a card's number is the Entries tab's number for the same lineup even while the filter hides others.
// `dk` (A12, round 3): { selected (Set of ticked saved lineup ids), status } draws the Download DK CSV bar over the cards; null draws none.
// `filter` (the live app only, null elsewhere: the section is then drawn without it): the Optimizer's "only lineups with" list (D77),
// { mustHave (the chosen role-aware keys), playersOf(lineup) (a saved lineup's men as lineup-filter.js reads them), exposureHtml(shown, of)
// (the Captain and FLEX tables over the shown saved lineups; `of` = all of them while the filter hides some, else null), barHtml(shown, total)
// (the chips bar with Clear, drawn whenever the filter is on, so it is in view of the cards even under a long batch), noMatchText }. The filter only hides; nothing saved is changed.
export function savedLineupsSectionHtml(board, saved, cardOf, filter = null, dk = null) {
  let body;
  let titleCount = "";
  if (!saved.loaded) {
    body = `<div class="saved-lineups-loading">Loading…</div>`;
  } else if (saved.error) {
    body = `<div class="saved-lineups-empty saved-lineups-error">${escapeHtml(saved.error)}</div>`;
  } else if (saved.lineups.length === 0) {
    body = `<div class="saved-lineups-empty">No saved lineups yet.</div>`;
  } else {
    const numbers = numberLineups(saved.lineups);
    const n = saved.lineups.length;
    const filtered = Boolean(filter) && filter.mustHave.length > 0;
    const shown = filtered ? filterLineups(saved.lineups, filter.mustHave, filter.playersOf).map((e) => e.item) : saved.lineups;
    const k = shown.length;
    if (filtered) titleCount = ` <span class="opt-sub">${k} of ${n} saved lineup${n === 1 ? "" : "s"}, filtered</span>`;
    body = [
      filtered ? filter.barHtml(k, n) : "",
      filter && k ? filter.exposureHtml(shown, filtered ? n : null) : "",
      dk && k ? dkDownloadHtml({ count: shown.filter((l) => dk.selected.has(l.id)).length, total: k, status: dk.status }) : "", // A12: Download DK CSV over the cards
      k ? `<div class="saved-lineups-list">${byAge(shown).map((l) => cardOf(l, numbers)).join("")}</div>` : `<div class="saved-lineups-empty">${escapeHtml(filter.noMatchText)}</div>`, // lineup number order, oldest first: the order classic's As built shows too
    ].join("");
  }
  return `
    <div class="saved-lineups" id="sd-saved-lineups">
      <h3 class="saved-lineups-title">Saved lineups${titleCount}</h3>
      ${body}
    </div>`;
}

/**
 * One PUT in flight per saved card (port of classic's putLineupGuarded, lineup.js; 🔵/👁 2026-10-17): the card is busy (its letter and
 * rename Save disabled) until the answer, only the newest answer per card counts, and a refusal stays on the card until its next good
 * PUT. `run(id, send, { redraw, still, apply })`: `send()` makes the request, `still()` says the game on screen is still the one it
 * was sent for, `apply(lineups)` shows the server's list; true when the change held and its list was shown. `busy` (a Set of ids) and
 * `errors` (id -> sentence) are read by the card.
 */
export function cardPutGuard() {
  const busy = new Set();
  const errors = {};
  const seq = new Map(); // id -> the number of its newest PUT
  let last = 0;
  let applied = 0; // the newest PUT whose list is shown; an older answer never replaces it
  async function run(id, send, { redraw, still, apply }) {
    const mine = ++last;
    seq.set(id, mine);
    busy.add(id);
    redraw();
    let data = null;
    let failure = null;
    try {
      data = await send();
    } catch (e) {
      failure = requestFailureText(e);
    } finally {
      if (seq.get(id) === mine) busy.delete(id);
    }
    if (seq.get(id) !== mine || !still()) return false;
    if (!failure && data && data.ok !== false && Array.isArray(data.lineups)) {
      delete errors[id];
      if (mine < applied) return false;
      applied = mine;
      apply(data.lineups);
      return true;
    }
    errors[id] = failure ?? data?.error?.message ?? "Could not save that change.";
    return false;
  }
  // Anything thrown past run's own request catch (a redraw or apply that threw): the card's sentence, not busy, never only the console.
  function fail(id, e) {
    busy.delete(id);
    errors[id] = requestFailureText(e);
  }
  return { busy, errors, run, fail };
}

// The saved cards' buttons and letter selects. `actions`: { renameStart(id), renameCancel(), renameSave(id, name), deleteStart(id), deleteNo(), deleteYes(id), load(id), tag(id, letter | null) }.
export function wireSavedCards(container, actions) {
  container.querySelectorAll("[data-action='sd-lineup-tag']").forEach((sel) => {
    sel.addEventListener("change", () => actions.tag(sel.dataset.id, sel.value || null));
  });
  container.querySelectorAll("[data-action='sd-rename-start']").forEach((btn) => {
    btn.addEventListener("click", () => actions.renameStart(btn.dataset.id));
  });
  container.querySelectorAll("[data-action='sd-rename-cancel']").forEach((btn) => {
    btn.addEventListener("click", () => actions.renameCancel());
  });
  container.querySelectorAll("[data-action='sd-rename-save']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = container.querySelector("[data-rename-input]");
      actions.renameSave(btn.dataset.id, input ? input.value : "");
    });
  });
  wireRenameEnter(container, "[data-action='sd-rename-save']", (id, text) => actions.renameSave(id, text)); // C27: Enter saves the new name, as the Save button does
  container.querySelectorAll("[data-action='sd-delete-start']").forEach((btn) => {
    btn.addEventListener("click", () => actions.deleteStart(btn.dataset.id));
  });
  container.querySelectorAll("[data-action='sd-delete-no']").forEach((btn) => {
    btn.addEventListener("click", () => actions.deleteNo());
  });
  container.querySelectorAll("[data-action='sd-delete-yes']").forEach((btn) => {
    btn.addEventListener("click", () => actions.deleteYes(btn.dataset.id));
  });
  container.querySelectorAll("[data-action='sd-load']").forEach((btn) => {
    btn.addEventListener("click", () => actions.load(btn.dataset.id));
  });
}
