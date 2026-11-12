// The Optimizer's settings panel pieces (lineup.js optimizerControlsHtml): pure markup, titled groups of label-and-control rows.
import { escapeHtml } from "./format.js";

// `hintCls`: an extra class on the hint line (ChatGPT wish k, Adam 2026-10-17: "opt-warn" colours the starred-QB count at 0).
// `titleOnly` (item 7, G64): the hint is the row's hover, never a visible line.
export function settingRowHtml(label, controlHtml, hint = "", hintCls = "", { titleOnly = false } = {}) {
  if (titleOnly) return `<div class="opt-set"${hint ? ` title="${escapeHtml(hint)}"` : ""}><div class="opt-set-main"><span class="opt-set-label">${escapeHtml(label)}</span><span class="opt-set-ctl">${controlHtml}</span></div></div>`;
  return `<div class="opt-set"><div class="opt-set-main"><span class="opt-set-label">${escapeHtml(label)}</span><span class="opt-set-ctl">${controlHtml}</span></div>${hint ? `<div class="opt-set-hint${hintCls ? ` ${hintCls}` : ""}">${escapeHtml(hint)}</div>` : ""}</div>`;
}

export function settingGroupHtml(title, rowsHtml, note = "", cls = "") {
  return `<section class="opt-group${cls ? ` ${cls}` : ""}"><h4 class="opt-group-title">${escapeHtml(title)}</h4>${note ? `<div class="opt-set-hint opt-group-note">${escapeHtml(note)}</div>` : ""}${rowsHtml}</section>`;
}

// ChatGPT wish i, Adam 2026-10-17: a row whose control (the avoid-game chips) sits under its label, and a muted sub-block title inside a group.
export function settingChipsRowHtml(label, chipsHtml) {
  return `<div class="opt-set"><span class="opt-set-label">${escapeHtml(label)}</span><div class="opt-chips opt-set-chips">${chipsHtml}</div></div>`;
}

export function settingSubtitleHtml(title) {
  return `<div class="opt-subtitle">${escapeHtml(title)}</div>`;
}

const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? "" : "s"}`;

// The D55 rules that start off: Starred QBs only is off by default so a fresh week builds at once (optimizer standard C12, 2026-11-03).
// A rule with no value is on unless it is named here; one place decides, the box, the request, the summary and the notes all ask it.
export const RULES_OFF_BY_DEFAULT = Object.freeze(["starredQbOnly"]);

/** Whether rule `key` is on in `rules` ({key: bool}); a rule not set takes its default. */
export function ruleOn(rules, key) {
  const v = rules?.[key];
  return v === undefined ? !RULES_OFF_BY_DEFAULT.includes(key) : v !== false;
}

/** ChatGPT wish i, Adam 2026-10-17: one sentence of the settings in effect, built from the same fields the controls show.
 *  `opt` carries the count and unique as numbers, `maxExp` as parsed percents (a number 0 to 100, or null for a blank or
 *  invalid box; lineup.js parsePct, one parser for the sentence and the request) and the objective as the build will
 *  use it; `games`: the slate's games (avoided ones outside it are not named); `starredQbCount`: how many starred QBs
 *  qualify (0 is named); `qbOwnCount`: starred QBs with custom stacks; `playerCapCount`: players with a Max % or Min % box set. */
export function activeRulesSummary(opt, { games = [], starredQbCount = null, qbOwnCount = 0, playerCapCount = 0 } = {}) {
  // 🔵 2026-10-17: with one lineup there are no two to differ, so the unique part is dropped.
  const parts = [`${plural(opt.count, "lineup")} by projection${Number(opt.count) === 1 ? "" : `, ${plural(opt.minUnique, "unique player")} between any two`}`];
  const rules = opt.rules ?? {};
  if (ruleOn(rules, "starredQbOnly")) parts.push(starredQbCount === 0 ? "starred QBs only (none qualify)" : "starred QBs only");
  // "0 ... or more" sets nothing and is left out; "exactly 0" is a rule and stays.
  const side = (n, orMore, noun) => (orMore !== false && Number(n) === 0 ? "" : `${orMore === false ? "exactly " : ""}${plural(n, noun)}${orMore === false ? "" : " or more"}`);
  const stack = [side(opt.stackOwn, opt.stackOwnOrMore, "teammate"), side(opt.stackOpp, opt.stackOppOrMore, "opponent")].filter(Boolean);
  if (stack.length) parts.push(`QB + ${stack.join(", ")}`);
  if (qbOwnCount > 0) parts.push(`custom stacks on ${plural(qbOwnCount, "QB")}`);
  if (ruleOn(rules, "noSameTeamRbs")) parts.push("no same-team RBs");
  if (ruleOn(rules, "noSameGameRbs")) parts.push("no same-game RBs");
  if (ruleOn(rules, "noDstVsOwnPlayers")) parts.push("no DST vs own players");
  if (String(opt.maxPerTeam ?? "") !== "") parts.push(`max ${opt.maxPerTeam} per team`);
  // The positions as lineup-exposure.js OPT_POSITIONS, not imported to keep this file pure.
  const caps = ["QB", "RB", "WR", "TE", "DST"].map((pos) => [pos, opt.maxExp?.[pos]]).filter(([, n]) => typeof n === "number" && Number.isFinite(n));
  if (caps.length) parts.push(`caps ${caps.map(([pos, n]) => `${pos} ${n}%`).join(", ")}`);
  if (playerCapCount > 0) parts.push(`caps on ${plural(playerCapCount, "player")}`);
  if (opt.spreadDst) parts.push("spread defenses");
  if (opt.varianceText) parts.push(opt.varianceText); // "variance QB 5, WR 15": the Variance % boxes as the request sends them (lineup-view.js optSummaryText)
  const onSlate = new Set((games ?? []).map((g) => String(g?.id ?? g)));
  const avoided = [...(opt.avoid ?? [])].map(String).filter((g) => onSlate.has(g)); // only games on this slate, as doGenerate sends
  if (avoided.length) parts.push(`avoiding ${avoided.map((g) => g.replace("@", " @ ")).join(", ")}`);
  return parts.join(" · ");
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

// Lineups to make (round 3 fix batch item 18): a count below 1 is said, not quietly made into 1. One copy for the classic and Showdown Optimizers.
export const COUNT_MIN_NOTE = "Minimum 1";
export const COUNT_MIN_SENTENCE = "Lineups to make must be at least 1. Type 1 or more.";

/** A Build with every seat held (item 11, both Optimizers): a plain sentence, not the server's refusal of locks that fill the lineup. `seats`: 9 (classic) or 6 (Showdown). */
export function fullLineupText(seats) {
  return `Your lineup is full: all ${seats === 9 ? "nine" : "six"} seats are held, so there is nothing to build around. Save it from the slots, or take someone out to build around the rest.`;
}

/** True when the count box holds a number below 1 (a 0 or a negative). A blank box (the default) or words are not "below"; they keep their old reading. */
export function countBelowMin(text) {
  const t = String(text ?? "").trim();
  return t !== "" && Number.isFinite(Number(t)) && Number(t) < 1;
}

/** The note beside the count box: `Minimum 1` while the typed count is below 1, else `Maximum <max>` (or nothing when the box has no maximum note). */
export function countNote(text, max = null) {
  return countBelowMin(text) ? COUNT_MIN_NOTE : max === null ? "" : `Maximum ${max}`;
}

/** Brings the note beside the count box in line with what is typed in it, without a redraw (the box keeps its focus). */
export function syncCountNote(input, max = null) {
  const box = input?.closest?.(".opt-numbox") ?? input?.parentNode;
  if (!box?.querySelector) return;
  const text = countNote(input.value, max);
  let note = box.querySelector(".opt-unit");
  if (!text) {
    note?.remove();
    return;
  }
  if (!note && typeof document !== "undefined") {
    note = document.createElement("span");
    note.className = "opt-unit opt-unit-note";
    box.appendChild(note);
  }
  if (note) note.textContent = text;
}

/** `unitCls`: an extra class on the note beside the box ("opt-unit-note" for the "Maximum 150" notes, which share one width so the boxes line up). */
export function numberBoxHtml(attrs, unit = "", unitCls = "") {
  return `<span class="opt-numbox"><input ${attrs} />${unit ? `<span class="opt-unit${unitCls ? ` ${unitCls}` : ""}">${escapeHtml(unit)}</span>` : ""}</span>`;
}
