// The Optimizer's settings panel pieces (lineup.js optimizerControlsHtml): pure markup, titled groups of label-and-control rows.
import { escapeHtml } from "./format.js";

export function settingRowHtml(label, controlHtml, hint = "") {
  return `<div class="opt-set"><div class="opt-set-main"><span class="opt-set-label">${escapeHtml(label)}</span><span class="opt-set-ctl">${controlHtml}</span></div>${hint ? `<div class="opt-set-hint">${escapeHtml(hint)}</div>` : ""}</div>`;
}

export function settingGroupHtml(title, rowsHtml, note = "", cls = "") {
  return `<section class="opt-group${cls ? ` ${cls}` : ""}"><h4 class="opt-group-title">${escapeHtml(title)}</h4>${note ? `<div class="opt-set-hint opt-group-note">${escapeHtml(note)}</div>` : ""}${rowsHtml}</section>`;
}

export function switchButtonHtml(on, label, attrs) {
  return `<button type="button" class="opt-toggle opt-toggle-btn" role="switch" aria-checked="${on ? "true" : "false"}" aria-label="${escapeHtml(label)}" ${attrs}><span class="opt-switch${on ? " on" : ""}"></span></button>`;
}

export function switchCheckboxHtml(id, on, words, offWords = "") {
  const text = offWords
    ? `<span class="opt-toggle-words"><span class="opt-toggle-text opt-text-on">${escapeHtml(words)}</span><span class="opt-toggle-text opt-text-off">${escapeHtml(offWords)}</span></span>`
    : `<span class="opt-toggle-text">${escapeHtml(words)}</span>`;
  return `<label class="opt-toggle"><input type="checkbox" id="${escapeHtml(id)}"${on ? " checked" : ""} /><span class="opt-switch" aria-hidden="true"></span>${text}</label>`;
}

export function numberBoxHtml(attrs, unit = "") {
  return `<span class="opt-numbox"><input ${attrs} />${unit ? `<span class="opt-unit">${escapeHtml(unit)}</span>` : ""}</span>`;
}
