// The Optimizer's settings panel pieces (lineup.js optimizerControlsHtml): pure markup, titled groups of label-and-control rows.
import { escapeHtml } from "./format.js";

// `hintCls`: an extra class on the hint line (ChatGPT wish k, Adam 2026-10-17: "opt-warn" colours the starred-QB count at 0).
export function settingRowHtml(label, controlHtml, hint = "", hintCls = "") {
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

/** ChatGPT wish i, Adam 2026-10-17: one sentence of the settings in effect, built from the same fields the controls show.
 *  `opt` carries the count and unique as numbers, `maxExp` as parsed percents (a number 0 to 100, or null for a blank or
 *  invalid box; lineup.js parsePct, one parser for the sentence and the request) and the objective as the build will
 *  use it; `games`: the slate's games (avoided ones outside it are not named); `starredQbCount`: how many starred QBs
 *  qualify (0 is named); `qbOwnCount`: starred QBs with custom stacks; `playerCapCount`: players with a Max % or Min % box set. */
export function activeRulesSummary(opt, { games = [], starredQbCount = null, qbOwnCount = 0, playerCapCount = 0 } = {}) {
  // 🔵 2026-10-17: with one lineup there are no two to differ, so the unique part is dropped.
  const parts = [`${plural(opt.count, "lineup")} by ${opt.objective === "ceil" ? "ceiling" : "projection"}${Number(opt.count) === 1 ? "" : `, ${plural(opt.minUnique, "unique player")} between any two`}`];
  const rules = opt.rules ?? {};
  if (rules.starredQbOnly !== false) parts.push(starredQbCount === 0 ? "starred QBs only (none qualify)" : "starred QBs only");
  // "0 ... or more" sets nothing and is left out; "exactly 0" is a rule and stays.
  const side = (n, orMore, noun) => (orMore !== false && Number(n) === 0 ? "" : `${orMore === false ? "exactly " : ""}${plural(n, noun)}${orMore === false ? "" : " or more"}`);
  const stack = [side(opt.stackOwn, opt.stackOwnOrMore, "teammate"), side(opt.stackOpp, opt.stackOppOrMore, "opponent")].filter(Boolean);
  if (stack.length) parts.push(`QB + ${stack.join(", ")}`);
  if (qbOwnCount > 0) parts.push(`custom stacks on ${plural(qbOwnCount, "QB")}`);
  if (rules.noSameTeamRbs !== false) parts.push("no same-team RBs");
  if (rules.noSameGameRbs !== false) parts.push("no same-game RBs");
  if (rules.noDstVsOwnPlayers !== false) parts.push("no DST vs own players");
  if (String(opt.maxPerTeam ?? "") !== "") parts.push(`max ${opt.maxPerTeam} per team`);
  // The positions as lineup-exposure.js OPT_POSITIONS, not imported to keep this file pure.
  const caps = ["QB", "RB", "WR", "TE", "DST"].map((pos) => [pos, opt.maxExp?.[pos]]).filter(([, n]) => typeof n === "number" && Number.isFinite(n));
  if (caps.length) parts.push(`caps ${caps.map(([pos, n]) => `${pos} ${n}%`).join(", ")}`);
  if (playerCapCount > 0) parts.push(`caps on ${plural(playerCapCount, "player")}`);
  if (opt.spreadDst) parts.push("spread defenses");
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

export function numberBoxHtml(attrs, unit = "") {
  return `<span class="opt-numbox"><input ${attrs} />${unit ? `<span class="opt-unit">${escapeHtml(unit)}</span>` : ""}</span>`;
}
