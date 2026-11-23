// The Entries screen's own controls, NBA's way (NBA lsw-main.js onClick: go, pick, pickGroup, pickAll, selectUnmapped, fill,
// numberInOrder, undoFill, resetEntries, dismissMsg and the drop; PROJECT.md Part 4 "Monday 11-23 complaints" item 7). Split from
// entries-wire.js for size; createEntriesWire hands in its state and its own functions, so one tab's controls never reach another's.
import { FILL_DEFAULT } from "./entries-fill.js";
import { effectiveAssignments, rowHolds } from "./entries-plan.js";
import { rangeBetween, screenOrder, fillRows, numberRows, bulkSentence } from "./entries-bulk.js";

/** `d`: { ent, fillNow(file), fileOf(file), refresh(), picksChanged(file), doUpload(file), getFileContext() }. Returns { bindSelect, bindScreen }. */
export function createScreenBindings(d) {
  const { ent } = d;

  /** The tab's rows in drawn order and their class model: { f, now, tab, order } or null. */
  function tabRows(fileName) {
    const now = d.fillNow(fileName);
    if (!now) return null;
    const tab = ent.tab[fileName] === "cash" ? "cash" : "gpp";
    return { f: now.f, now, tab, order: screenOrder(now.f.entries, now.model.classes, tab) };
  }

  /** Step 2's boxes (NBA pick, pickGroup, pickAll, selectUnmapped): Shift-click selects the run from the last row clicked. */
  function bindSelect(el) {
    const on = (action, fn) => el.querySelectorAll(`[data-action='${action}']`).forEach((node) => node.addEventListener("click", (ev) => fn(node, ev)));
    const setOf = (file) => (ent.sel[file] ??= new Set());
    on("entries-pick-row", (box, ev) => {
      const { file, entry } = box.dataset;
      const t = tabRows(file);
      const sel = setOf(file);
      if (ev.shiftKey && t && ent.lastSel[file] != null) for (const id of rangeBetween(t.order, ent.lastSel[file], entry)) sel.add(id);
      else if (!sel.delete(entry)) sel.add(entry);
      ent.lastSel[file] = entry;
      d.refresh();
    });
    on("entries-pick-group", (box) => {
      const f = d.fileOf(box.dataset.file);
      const ids = (f?.entries ?? []).filter((e) => String(e.contestId).trim() === box.dataset.contest).map((e) => String(e.entryId));
      const sel = setOf(box.dataset.file);
      const all = ids.every((id) => sel.has(id));
      for (const id of ids) all ? sel.delete(id) : sel.add(id);
      d.refresh();
    });
    on("entries-pick-all", (box) => {
      const t = tabRows(box.dataset.file);
      if (!t) return;
      const sel = setOf(box.dataset.file);
      const all = t.order.every((id) => sel.has(id));
      ent.sel[box.dataset.file] = all ? new Set() : new Set(t.order);
      d.refresh();
    });
    on("entries-select-empty", (btn) => {
      const t = tabRows(btn.dataset.file);
      if (!t) return;
      const m = t.now.model;
      const eff = effectiveAssignments(t.f.entries, t.now.lineups, ent.assign[btn.dataset.file]);
      ent.sel[btn.dataset.file] = new Set(t.order.filter((id) => rowHolds({ pick: eff[id], kept: m.kept.has(id), proposedId: m.proposals[id] }).state === "none"));
      d.refresh();
    });
    // The boxes are role=checkbox spans with a tab stop: Space and Enter press them like a click.
    el.querySelectorAll("[role=checkbox][data-action]").forEach((box) => box.addEventListener("keydown", (ev) => {
      if (ev.key !== " " && ev.key !== "Enter") return;
      ev.preventDefault();
      box.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: ev.shiftKey }));
    }));
  }

  /** Fill and Number in order (entries-bulk.js): hand picks for the selected rows; the one-step undo keeps what was there. */
  function doBulk(fileName, kind) {
    const t = tabRows(fileName);
    if (!t) return;
    const list = t.now.model[t.tab] ?? [];
    const chosen = ent.bulkLineup[fileName];
    const startId = chosen != null && list.some((l) => String(l.id) === String(chosen)) ? String(chosen) : String(list[0]?.id ?? "");
    const ids = t.order.filter((id) => ent.sel[fileName]?.has(id));
    if (!ids.length || !startId) return;
    const s = (ent.fill[fileName] ??= { ...FILL_DEFAULT });
    const base = { entries: t.f.entries, assigned: ent.assign[fileName], keep: s.keep, ids, slateKey: t.f.slate.key, fileContext: d.getFileContext(), lineups: t.now.lineups };
    const lineup = list.find((l) => String(l.id) === startId);
    const r = kind === "number" ? numberRows({ ...base, list, startId }) : fillRows({ ...base, lineup });
    if (r.unknown || r.short) {
      ent.msg = { kind: "warn", text: r.short ? `There ${r.short === 1 ? "is 1 lineup" : `are ${r.short} lineups`} too few: ${ids.length} rows from that lineup need ${ids.length} lineups and only ${r.have} follow it. Nothing was changed.` : "Pick a lineup from the list first." };
      return d.refresh();
    }
    const label = kind === "number" ? `Numbered ${ids.length} rows in order` : `Filled ${ids.length} rows with one lineup`;
    const undo = { assign: { ...(ent.assign[fileName] ?? {}) }, keep: s.keep ? new Set(s.keep) : null, text: bulkSentence(label, r, t.f.entries) };
    ent.assign[fileName] = r.assign;
    s.keep = r.keep;
    ent.sel[fileName] = new Set();
    ent.msg = r.skipped.length ? { kind: "warn", text: undo.text } : null; // G62: a skipped row is named where Adam looks
    d.picksChanged(fileName); // drops any older undo (review finding 3 of 11-23), so this fill's is set after it
    ent.undo[fileName] = undo;
    d.refresh();
  }

  /** Undo puts back the picks and kept rows from before the last bulk fill; Reset entries clears the file after asking. */
  function bindUndoReset(on) {
    on("entries-undo", (btn) => {
      const file = btn.dataset.file;
      const u = ent.undo[file];
      if (!u) return;
      ent.assign[file] = u.assign;
      (ent.fill[file] ??= { ...FILL_DEFAULT }).keep = u.keep;
      delete ent.undo[file];
      ent.msg = { kind: "ok", text: "Undone: every row has the lineup it had before." };
      d.picksChanged(file);
    });
    on("entries-reset", (btn) => {
      const file = btn.dataset.file;
      // Review finding 7 of 11-23: no confirm box to ask with means no reset, said where Adam looks.
      if (typeof window === "undefined" || typeof window.confirm !== "function") {
        ent.msg = { kind: "warn", text: "Reset entries needs the browser's confirm box, which is not available here, so nothing was cleared." };
        return d.refresh();
      }
      if (!window.confirm("Take every lineup off every row of this file, GPP and Cash, and open every row to suggestions again? This has no Undo.")) return;
      ent.assign[file] = {};
      ent.fill[file] = { ...FILL_DEFAULT };
      delete ent.undo[file];
      delete ent.sel[file];
      ent.msg = { kind: "ok", text: "Reset: no row has a lineup now; the suggestions are back." };
      d.picksChanged(file);
    });
  }

  /** The steps, the file chooser, the bulk fills, Undo, Reset entries, the message's ✕ and a file dropped on the screen. */
  function bindScreen(el) {
    const on = (action, fn) => el.querySelectorAll(`[data-action='${action}']`).forEach((node) => node.addEventListener("click", () => fn(node)));
    on("entries-go", (btn) => {
      ent.screen = ["upload", "entries", "export"].includes(btn.dataset.screen) ? btn.dataset.screen : "entries";
      d.refresh();
    });
    on("entries-open-file", (btn) => {
      ent.active = btn.dataset.file;
      ent.screen = "entries";
      d.refresh();
    });
    on("entries-bulk-fill", (btn) => doBulk(btn.dataset.file, "fill"));
    on("entries-bulk-number", (btn) => doBulk(btn.dataset.file, "number"));
    el.querySelectorAll("select.entries-bulk-lineup").forEach((sel) => sel.addEventListener("change", () => {
      ent.bulkLineup[sel.dataset.file] = sel.value;
    }));
    bindUndoReset(on);
    on("entries-dismiss", () => {
      ent.msg = null;
      d.refresh();
    });
    const zone = el.querySelector("[data-drop-zone]");
    if (!zone) return;
    zone.addEventListener("dragover", (ev) => {
      if (!ev.dataTransfer?.types?.includes("Files")) return;
      ev.preventDefault();
      zone.querySelector("[data-drop]")?.classList.add("over");
    });
    zone.addEventListener("dragleave", () => zone.querySelector("[data-drop]")?.classList.remove("over"));
    zone.addEventListener("drop", (ev) => {
      const file = ev.dataTransfer?.files?.[0];
      if (!file) return;
      ev.preventDefault();
      d.doUpload(file);
    });
  }

  return { bindSelect, bindScreen };
}
