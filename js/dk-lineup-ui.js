// The Download DK CSV controls of the saved lineups (optimizer standard A12, round 3), one markup and one wiring for the classic and Showdown
// Optimizers: a tick box on every saved card, and over the cards a Download DK CSV button with how many are ticked, Select all and Clear
// selection, and the sentence a download leaves (how many lineups were written and which were left out and why). The file itself is
// dk-lineup-csv.js, built in the browser, so the public site makes it too. The ticks are the page's (a Set of saved lineup ids); each
// Optimizer owns its Set and redraws its panel after a change.
import { escapeHtml } from "./format.js";
import { dkLineupCsv, dkCsvFileName, dkCsvStatus, downloadText } from "./dk-lineup-csv.js";

/** The tick box on a saved card's head. */
export function dkSelectHtml(id, checked) {
  return `<label class="dk-pick" title="Tick to put this lineup in the DK CSV"><input type="checkbox" data-dk-pick="${escapeHtml(String(id))}"${checked ? " checked" : ""} aria-label="Put this lineup in the DK CSV" /></label>`;
}

/** The bar over the saved cards. `count`: how many are ticked; `total`: how many saved lineups are shown; `status`: the last download's sentence. */
export function dkDownloadHtml({ count, total, status = "" }) {
  return `<div class="dk-download">
      <button type="button" class="saved-lineup-btn" data-action="dk-download"${count ? "" : " disabled"} title="${count ? "Download the ticked lineups as a DraftKings lineup file" : "Tick the saved lineups to put in the file"}">Download DK CSV</button>
      ${status ? `<span class="dk-status" role="status">${dkStatusLinesHtml(status)}</span>` : ""}
      <span class="dk-count">${count} of ${total} ticked</span>
      <button type="button" class="link-btn" data-action="dk-select-all"${count === total ? " disabled" : ""}>Select all</button>
      <button type="button" class="link-btn" data-action="dk-select-none"${count ? "" : " disabled"}>Clear selection</button>
    </div>`;
}

/** The status, one line each (what was written, then the `Left out:` line in the error colour). */
export function dkStatusLinesHtml(status) {
  return String(status).split("\n").filter(Boolean).map((line) => `<span class="dk-status-line${/^Left out:|^Nothing was downloaded|^Tick at least/.test(line) ? " dk-status-bad" : /^Check:/.test(line) ? " dk-status-note" : ""}">${escapeHtml(line)}</span>`).join("");
}

/** The ticked ids that are still among the shown saved lineups, in the cards' order. Pure. */
export function tickedLineups(selected, lineups) {
  return (lineups ?? []).filter((l) => selected.has(l.id));
}

/**
 * Wires the ticks and the three buttons under `container`. `ctx` = {selected (Set of ids), shown() (the saved lineups on screen, in order),
 * kind ("classic" or "showdown"), board() (the live board), slateKey() (classic: the slate on screen), slateLabel(), setStatus(text), redraw()}. A download with nothing ticked says so and writes nothing;
 * a file nothing could be written to says why and downloads nothing.
 */
export function wireDkDownload(container, ctx) {
  container.querySelectorAll("[data-dk-pick]").forEach((box) => {
    box.addEventListener("change", () => {
      if (box.checked) ctx.selected.add(box.dataset.dkPick);
      else ctx.selected.delete(box.dataset.dkPick);
      ctx.redraw();
    });
  });
  container.querySelector("[data-action='dk-select-all']")?.addEventListener("click", () => {
    for (const l of ctx.shown()) ctx.selected.add(l.id);
    ctx.redraw();
  });
  container.querySelector("[data-action='dk-select-none']")?.addEventListener("click", () => {
    ctx.selected.clear();
    ctx.redraw();
  });
  container.querySelector("[data-action='dk-download']")?.addEventListener("click", () => {
    const picked = tickedLineups(ctx.selected, ctx.shown());
    if (!picked.length) {
      ctx.setStatus("Tick at least one saved lineup first.");
      ctx.redraw();
      return;
    }
    const made = dkLineupCsv({ kind: ctx.kind, lineups: picked, board: ctx.board(), slateKey: ctx.slateKey?.() }); // no default: a call that names no slate is refused by dkLineupCsv, never written as the main slate's ids
    if (made.text) downloadText(dkCsvFileName(ctx.slateLabel()), made.text);
    ctx.setStatus(made.text ? dkCsvStatus(made) : `Nothing was downloaded.\n${dkCsvStatus(made)}`);
    ctx.redraw();
  });
}
