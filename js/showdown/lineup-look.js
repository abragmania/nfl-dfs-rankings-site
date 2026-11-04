// The Showdown Optimizer's look (Adam 2026-10-18 9:09 PM: "does not use the team colors that we decided on"): the game's two-team palette that the six slots
// (lineup-slots.js, D81) and the saved rows (lineup-card.js teamColours / teamColourStyle, team-palette.js slatePalette) wear, and the controls laid out in
// two rows. Markup helpers only; lineup.js owns the lineup. No colour scale of its own: the palette is classic's, built for the two teams of the game on
// screen so they always read apart.
import { escapeHtml } from "../format.js";
import { slatePalette } from "../team-palette.js";
import { confirmHtml, anchorHtml, CLEAR_QUESTION } from "../confirm-inline.js"; // B13: Clear lineup asks `Clear the lineup?` beside itself, as classic's does

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

/** The working lineup's controls: Clear lineup on the first row, Save as and `Save working lineup` on the second (each row the column's full width). The
 *  one Build is in the Optimizer's Build row under the slots (optimizer standard A13, round 3: Showdown's top Build folded into it), and no Objective
 *  choice is drawn while Projection is the only objective (A21). */
export function controlsHtml({ saving, saveName, hasAnySlot, confirm = null }) {
  return `
    <div class="lineup-controls sd-controls">
      <div class="sd-controls-row">
        ${anchorHtml(`<button type="button" id="sd-lineup-clear-all-btn" class="lineup-clear-all-btn">Clear lineup</button>`, confirm === "clear" ? confirmHtml(CLEAR_QUESTION, { data: "clear" }) : "", { align: "swap" })}
      </div>
      <div class="sd-controls-row">
        <label class="lineup-control">Save as
          <input type="text" id="sd-lineup-save-name" class="lineup-save-name-input" placeholder="Name (optional)" value="${escapeHtml(saveName)}" />
        </label>
        <button type="button" id="sd-lineup-save-btn" class="lineup-build-btn"${!hasAnySlot || saving ? " disabled" : ""}>${saving ? "Saving…" : "Save working lineup"}</button>
      </div>
    </div>`;
}
