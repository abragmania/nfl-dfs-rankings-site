// The Showdown Optimizer's look (Adam 2026-10-18 9:09 PM: "does not use the team colors that we decided on"): the game's two-team palette that the six slots
// (lineup-slots.js, D81) and the saved rows (lineup-card.js teamColours / teamColourStyle, team-palette.js slatePalette) wear, and the controls laid out in
// two rows. Markup helpers only; lineup.js owns the lineup. No colour scale of its own: the palette is classic's, built for the two teams of the game on
// screen so they always read apart.
import { escapeHtml } from "../format.js";
import { slatePalette } from "../team-palette.js";

const palettes = new Map(); // "DAL,GB" to its palette (one entry per game viewed in this page's life, each a small palette of two teams, so it grows slowly and is not pruned)

/** The slate palette of this Showdown's teams (the board's rows and its game), slatePalette's own rules: rivals told apart, one fill per theme. */
export function showdownPalette(board) {
  const teams = new Set((board?.rows ?? []).map((r) => r?.team));
  teams.add(board?.game?.away);
  teams.add(board?.game?.home);
  const list = [...teams].filter((t) => typeof t === "string" && t).sort();
  const key = list.join(",");
  if (!palettes.has(key)) palettes.set(key, slatePalette(list));
  return palettes.get(key);
}

/** The controls: Objective, Build and Clear all on the first row, Save as and Save lineup on the second (each row the column's full width). */
export function controlsHtml({ objectives, objective, building, saving, saveName, hasAnySlot }) {
  const options = objectives.map((o) => `<option value="${o.value}"${objective === o.value ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
  return `
    <div class="lineup-controls sd-controls">
      <div class="sd-controls-row">
        <label class="lineup-control">Objective
          <select id="sd-lineup-objective">${options}</select>
        </label>
        <button type="button" id="sd-lineup-build-btn" class="lineup-build-btn"${building ? " disabled" : ""}>${building ? "Building…" : "Build"}</button>
        <button type="button" id="sd-lineup-clear-all-btn" class="lineup-clear-all-btn">Clear all</button>
      </div>
      <div class="sd-controls-row">
        <label class="lineup-control">Save as
          <input type="text" id="sd-lineup-save-name" class="lineup-save-name-input" placeholder="Name (optional)" value="${escapeHtml(saveName)}" />
        </label>
        <button type="button" id="sd-lineup-save-btn" class="lineup-build-btn"${!hasAnySlot || saving ? " disabled" : ""}>${saving ? "Saving…" : "Save lineup"}</button>
      </div>
    </div>`;
}
