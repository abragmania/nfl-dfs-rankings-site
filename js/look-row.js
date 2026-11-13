// The one lineup row of the copied NBA look (PROJECT.md Part 4 item 5, optimizer standard A5): slot box first, team logo, name, the muted matchup right after the name, the swap arrow where a screen has one, then salary, projection and ownership, and on the working lineup a padlock.
// Every lineup presentation in classic draws this row (the working lineup, the built cards, the saved cards). A missing figure is a dash with its reason, never zero. Markup only.
import { escapeHtml, money } from "./format.js";
import { teamLogoHtml, playerTagHtml } from "./player-row.js";
import { teamColours } from "./lineup-card.js";
import { liftForDark } from "./team-palette.js";
import { moneyText, projText, ownText, MISSING_WHY, NO_FIGURE } from "./look-adapter.js";

// The look's two row icons (the padlock on the working lineup and in the pool, the Exclude mark in the pool).
export const LOCK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
export const EXCLUDE_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M6.3 17.7 17.7 6.3"/></svg>`;

/** The look's team tint for `team` (--t1, --t2): the slate palette's colour, lifted on the dark page so a dark colour still reads; the light page takes it as it is. */
export function teamVars(team, palette = null) {
  const { colour, alt } = teamColours(palette, team);
  const dark = typeof document === "undefined" || document.documentElement?.dataset?.theme !== "light";
  return `--t1:${escapeHtml(dark ? liftForDark(colour) : colour)};--t2:${escapeHtml(alt)}`;
}

/** "Jahmyr Gibbs" to "J. Gibbs" (a row shows it only when the whole name does not fit, fitNames). */
export function shortName(name) {
  const t = String(name ?? "").trim().split(/\s+/);
  return t.length > 1 ? `${t[0][0]}. ${t.slice(1).join(" ")}` : String(name ?? "");
}

const fig = (cls, value, why) => `<span class="${cls}">${value === NO_FIGURE ? `<span class="miss" title="${escapeHtml(why)}">${NO_FIGURE}</span>` : escapeHtml(value)}</span>`;

/** The name cell: the name (opens his card, data-card-id on the row), the muted matchup, his status tag. */
function nameCell(man, note, noteHtml = "", showPos = false) {
  const matchup = man.matchup ? `<span class="slt" title="${escapeHtml(`${man.team ?? ""} ${man.matchup}`)}">${escapeHtml(man.matchup)}</span>` : "";
  const tag = playerTagHtml(man.tagRow);
  const pos = showPos && man.pos ? `<span class="pos">${escapeHtml(man.pos)}</span>` : ""; // where the slot box does not name the position (a Showdown's every FLEX seat)
  return `<div class="sn"><div class="sn1"><button type="button" class="pn player-name" data-short="${escapeHtml(shortName(man.name))}" title="Open ${escapeHtml(man.name)}'s card">${escapeHtml(man.name)}</button>${pos}${matchup}${tag ? `<span class="tagw">${tag}</span>` : ""}${noteHtml ? `<span class="slnote">${noteHtml}</span>` : note ? `<span class="slnote">${escapeHtml(note)}</span>` : ""}</div></div>`;
}

const logo = (team) => teamLogoHtml(team, "logo sm", 20) || `<span class="chipx sm">${escapeHtml(team ?? "")}</span>`; // a team with no logo keeps its abbreviation (D80)

/**
 * One row. `man`: look-adapter.js lookMan; `slot`: the roster slot's name; `kind`: "card" (a built or saved lineup) or "work" (the working lineup); `locked`: the padlock's green;
 * `palette`: the slate's team colours; `swap`: the swap button's markup (only where a screen has one); `ctl`: the padlock cell (working lineup only); `attrs`, `cls`: the row's own hooks and extra classes; `note`: a short word beside the name ("not on slate", "WANT");
 * `noteHtml`: the same place with markup already made (the Showdown's slot notes carry a hover), which wins over `note`; `showPos`: the man's position chip after his name.
 */
export function lookRowHtml(man, { slot, kind = "card", locked = false, palette = null, swap = "", ctl = "", attrs = "", cls = "", note = "", noteHtml = "", showPos = false }) {
  const figures = `${swap}${fig("ss", moneyText(man.salary), MISSING_WHY.salary)}${fig("sp", projText(man.proj), MISSING_WHY.proj)}${fig("so", ownText(man.own), MISSING_WHY.own)}${ctl}`;
  const cardId = man.id != null ? ` data-card-id="${escapeHtml(man.id)}"` : "";
  const classes = kind === "work" ? `crow wkr tm${locked ? " locked" : " hand"}${cls ? ` ${cls}` : ""}` : `crow lead tm lr${locked ? " locked" : ""}${swap ? " hasswap" : ""}${cls ? ` ${cls}` : ""}`;
  return `<div class="${classes}"${cardId} style="${teamVars(man.team, palette)}"${attrs ? ` ${attrs}` : ""}><span class="sl" title="Roster slot ${escapeHtml(slot)}">${escapeHtml(slot)}</span>${logo(man.team)}${nameCell(man, note, noteHtml, showPos)}${figures}</div>`;
}

/** An open slot: the slot box and the word (`Empty`, `Not on this slate`), and `hint` after it when given (how to fill it). `kind` as lookRowHtml. */
export function lookEmptyRowHtml(slot, word = "Empty", { kind = "work", attrs = "", hint = "", cls = "" } = {}) {
  return `<div class="crow ${kind === "work" ? "wkr" : "lead lr"} empty${cls ? ` ${cls}` : ""}"${attrs ? ` ${attrs}` : ""}><span class="sl">${escapeHtml(slot)}</span><div class="sn"><b>${escapeHtml(word)}</b>${hint ? `<span class="eh"> · ${escapeHtml(hint)}</span>` : ""}</div></div>`;
}

/**
 * The working lineup's totals line (the approved look, one copy for the classic and the Showdown panel): the cap bar, then Salary used (of the cap), Salary left, Proj, Own, Per open slot and Value at card-footer size.
 * `t`: look-adapter.js lookTotals' figures ({used, left, proj, own, value, over, fillPct}; a figure a man lacks is null and draws a dash with `why`, never 0); `cap`: DraftKings' cap;
 * `perOpen`: the words for Per open slot (null draws none), `perOpenTitle` its hover; `attrs`: the block's own hooks.
 */
export function lookCapHtml(t, { cap = 50000, why = "", perOpen = null, perOpenTitle = "", attrs = "" } = {}) {
  const dash = () => `<span class="miss" title="${escapeHtml(why)}">${NO_FIGURE}</span>`;
  const money0 = (v) => (v === null ? dash() : money(v));
  const left = t.over ? `<span class="overcap">Salary left <b>−${money(-t.left)}</b></span>` : `<span>Salary left <b>${money0(t.left)}</b></span>`;
  return `<div class="cap"${attrs ? ` ${attrs}` : ""}><div class="capbar${t.over ? " over" : ""}"><i style="width:${t.fillPct}%"></i></div><div class="capt"><span>Salary used <b>${money0(t.used)}</b><em class="of">of ${money(cap)}</em></span>${left}<span>Proj <b>${t.proj === null ? dash() : escapeHtml(projText(t.proj))}</b></span><span>Own <b>${t.own === null ? dash() : escapeHtml(ownText(t.own))}</b></span>${perOpen ? `<span class="perop" title="${escapeHtml(perOpenTitle)}">Per open slot <b>${escapeHtml(perOpen)}</b></span>` : ""}<span class="tval" title="Projection per $1,000 of salary used">Value <b>${t.value === null ? dash() : t.value.toFixed(2)}</b></span></div></div>`;
}

/** The working lineup's padlock: green while locked (a click unlocks, D70), else a plain padlock (a click locks him in). Lineup.js wires data-action="row-lock" as the pool's. */
export function padlockHtml(id, locked) {
  const title = locked ? "Locked. Click to unlock" : "Lock him";
  return `<button type="button" class="${locked ? "lkd" : "lkb"}" data-action="row-lock" data-id="${escapeHtml(id)}" title="${title}" aria-label="${title}" aria-pressed="${locked}">${LOCK_ICON}</button>`;
}

/** Brings long names down to their short form where the whole name does not fit its row (NBA's own fitNames). */
export function fitNames(root = typeof document !== "undefined" ? document : null) {
  root?.querySelectorAll?.(".crow .pn[data-short]").forEach((b) => {
    if (b.scrollWidth > b.clientWidth + 1) b.textContent = b.dataset.short;
  });
}
