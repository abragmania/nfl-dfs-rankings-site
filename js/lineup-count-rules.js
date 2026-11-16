// The classic GPP Optimizer's team, game and ownership rules, the screen side (PROJECT.md Part 4 "Monday 11-16 orders" items 8 and 9; NBA's Low-owned control and team limits, pinned
// commit a39b37e, server/board/settings-panel.js lowOwnedHtml, addLowRule and lowRuleOk): a line of chips with × to remove each, a "+ rule" button and a small form with Add and Cancel.
// The rule logic itself (what counts, the limits, the contradictions, why a lineup is impossible) is server/lineup/count-rules.js, run by the Build's request check and the engine on the
// app and on the site alike; this file imports the chip text, the limits and validateCountRules from it (served to the page through server.js SHARED_SERVER_FILES and copied to the site through
// tools/publish.mjs PAGE_MODULES_WITH_SERVER_IMPORTS, as variance-pos.js does for sd-variance.js) and only reads the typed boxes into a rule, refuses what it can see at once, and draws.
// Rules are kept in the browser per slate with the other GPP settings (lineup-memory.js), GPP only. Pure apart from the console warning in cleanStoredRules; the wiring takes its page state as arguments.
import { escapeHtml } from "./format.js";
import { ruleChip, ruleWords, MAX_OWN_RULES, MAX_TEAM_GAME_RULES, LINEUP_SIZE, validateCountRules } from "../server/lineup/count-rules.js";

/** The open form and what was typed in it, page-only: a redraw (which any click makes) puts the typed boxes back. */
export const crUi = { open: null, msg: "", own: { op: "atLeast", count: "", side: "under", pct: "" }, tg: { subject: "", min: "", max: "" } };

const upper = (v) => String(v ?? "").trim().toUpperCase();
const whole = (t) => { const s = String(t ?? "").replace(/,/g, "").trim(); return /^\d+$/.test(s) ? Number(s) : NaN; };
const decimal = (t) => { const s = String(t ?? "").replace(/,/g, "").trim(); return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; };
const isOwn = (r) => r.kind === "own";

/**
 * A remembered rule list read back: { rules, dropped }, each stored rule held to the server's own check (validateCountRules) together with the ones kept before it, so a malformed, repeated,
 * contradicting or over-the-limit rule is left out. `dropped` counts them, {own, other}, for the closed lines to say ("n remembered rules could not be read"), with a console warning (like NBA's readLowRules).
 */
export function cleanStoredRules(raw) {
  const none = { own: 0, other: 0 };
  if (raw === undefined || raw === null) return { rules: [], dropped: none };
  if (!Array.isArray(raw)) { console.warn("nfldfs: the remembered team, game and ownership rules are not a list; ignored"); return { rules: [], dropped: { own: 0, other: 1 } }; }
  let rules = [];
  const dropped = { ...none };
  for (const r of raw) {
    const checked = validateCountRules([...rules, r]);
    if (checked.error) dropped[r?.kind === "own" ? "own" : "other"]++;
    else rules = checked.rules;
  }
  if (dropped.own + dropped.other) console.warn(`nfldfs: ${dropped.own + dropped.other} remembered team, game or ownership rule(s) could not be read (malformed, repeated, contradicting or over the limit); left out`);
  return { rules, dropped };
}

/** The slate on screen as the form offers it: `teams` (sorted codes) and `games` (ids such as "KC@BUF"). */
export function slateParts(rows, games) {
  return { teams: [...new Set((rows ?? []).map((r) => upper(r.team)).filter(Boolean))].sort(), games: (games ?? []).map((g) => upper(g?.id ?? g)).filter(Boolean) };
}

/** The rules a Build sends and the ones it cannot (a team or game that is not on this slate): `live` goes in the request, `off` is said on the page with a ×. */
export function splitLive(rules, parts) {
  const teams = new Set(parts.teams), games = new Set(parts.games);
  const live = [], off = [];
  for (const r of rules) (isOwn(r) || (r.kind === "team" ? teams.has(r.team) : games.has(r.game)) ? live : off).push(r);
  return { live, off };
}

/** Adds a rule to a list: { rules } with it added, or { msg } with the server's own reason (validateCountRules: a duplicate, the limits, rules that cannot both be met). */
export function addRule(rules, rule) {
  const checked = validateCountRules([...rules, rule]);
  return checked.error ? { msg: checked.error } : { rules: checked.rules };
}

/** An ownership rule typed in the form (NBA's addLowRule, widened): { op, count, side, pct } as the boxes hold them. */
export function ownRuleFromForm(rules, form) {
  const n = whole(form.count), pct = decimal(form.pct);
  if (!Number.isInteger(n) || n < 1 || n > LINEUP_SIZE) return { msg: `The count is a whole number from 1 to ${LINEUP_SIZE}.` };
  if (!Number.isFinite(pct) || pct > 100) return { msg: "The ownership line is a percentage from 0 to 100." };
  return addRule(rules, { kind: "own", side: form.side === "over" ? "over" : "under", pct, op: form.op === "atMost" ? "atMost" : "atLeast", n });
}

/** A team or game rule typed in the form: { subject (a team code or a game id), min, max } as typed; a blank box is no bound, and at least one is needed. */
export function teamGameFromForm(rules, form, parts) {
  const subject = upper(form.subject);
  const kind = subject.includes("@") ? "game" : "team";
  if (!(kind === "game" ? parts.games : parts.teams).includes(subject)) return { msg: "Pick a team or a game." };
  const min = String(form.min ?? "").trim() === "" ? null : whole(form.min);
  const max = String(form.max ?? "").trim() === "" ? null : whole(form.max);
  if (min === null && max === null) return { msg: "Type a minimum, a maximum or both." };
  if (min !== null && (!Number.isInteger(min) || min < 1 || min > LINEUP_SIZE)) return { msg: `The minimum is a whole number from 1 to ${LINEUP_SIZE}.` };
  if (max !== null && (!Number.isInteger(max) || max < 0 || max > LINEUP_SIZE - 1)) return { msg: `The maximum is a whole number from 0 to ${LINEUP_SIZE - 1}.` };
  let next = rules;
  for (const [op, n] of [["atLeast", min], ["atMost", max]]) {
    if (n === null) continue;
    const added = addRule(next, { kind, [kind]: subject, op, n });
    if (added.msg) return added;
    next = added.rules;
  }
  return { rules: next };
}

/**
 * The settings row's closed line: the chips' text in order ("KC ≥ 2 · KC@BUF ≤ 3"), "none", how many are off this slate, and how many remembered rules could not be read (`dropped`:
 * {own, other} from cleanStoredRules; the ownership line says its own, the team and game line the rest).
 */
export function summaryText(rules, parts, own, dropped = { own: 0, other: 0 }) {
  const mine = rules.filter((r) => isOwn(r) === own);
  const off = own ? 0 : splitLive(mine, parts).off.length;
  const unread = own ? dropped.own : dropped.other;
  const notes = [off ? `${off} off this slate` : "", unread ? `${unread} remembered ${unread === 1 ? "rule" : "rules"} could not be read` : ""].filter(Boolean);
  return `${mine.length ? mine.map(ruleChip).join(" · ") : "none"}${notes.length ? ` (${notes.join("; ")})` : ""}`;
}

/** The sentence for the Build's hover summary (lineup-settings.js activeRulesSummary): the rules this Build sends, "" for none. */
export function requestText(live) {
  return live.length ? `rules ${live.map(ruleChip).join(", ")}` : "";
}

const chipsHtml = (rules, parts, own) => rules.map((r, i) => ({ r, i })).filter(({ r }) => isOwn(r) === own).map(({ r, i }) => {
  const off = !own && splitLive([r], parts).off.length > 0;
  const title = off ? `${ruleWords(r)}: that ${r.kind} is not on this slate, so this rule is not used. Remove it with the ×.` : ruleWords(r);
  return `<span class="ovc${off ? " cr-off" : ""}" title="${escapeHtml(title)}">${escapeHtml(ruleChip(r))}<button type="button" data-cr-op="del" data-cr-i="${i}" title="Remove ${escapeHtml(ruleWords(r))}">×</button></span>`;
}).join("");

const optionsHtml = (list, current, text = (v) => v) => list.map(([v, label]) => `<option value="${escapeHtml(v)}"${v === current ? " selected" : ""}>${escapeHtml(label ?? text(v))}</option>`).join("");
const box = (field, value, mode = "numeric") => `<input data-cr="${field}" inputmode="${mode}" autocomplete="off" placeholder="—" value="${escapeHtml(value)}" />`;
const addBtns = (add) => `<button type="button" class="ol sm" data-cr-op="${add}">Add</button><button type="button" class="ol sm" data-cr-op="cancel">Cancel</button><span class="ovmsg">${escapeHtml(crUi.msg)}</span>`;

/** The Ownership rules line (NBA's Low-owned line, widened to at least or at most, under or over): chips, "+ rule", and the form when open. */
export function ownBodyHtml(rules) {
  const mine = rules.filter(isOwn);
  const full = mine.length >= MAX_OWN_RULES;
  const f = crUi.own;
  const form = crUi.open === "own"
    ? `<div class="ovf cr-form"><select data-cr="op" aria-label="At least or at most">${optionsHtml([["atLeast", "at least"], ["atMost", "at most"]], f.op)}</select>${box("count", f.count)}<span>players</span><select data-cr="side" aria-label="Under or over">${optionsHtml([["under", "under"], ["over", "over"]], f.side)}</select>${box("pct", f.pct, "decimal")}<span>% owned</span>${addBtns("own-add")}</div>`
    : "";
  const add = `<button type="button" class="ov" data-cr-op="own-open"${full ? ` disabled title="At most ${MAX_OWN_RULES} ownership rules"` : ""}>+ rule</button>`;
  return `<div class="teams cr-line"><span class="tl">Ownership:</span><span class="ovs">${chipsHtml(rules, null, true) || "<span>none</span>"}</span>${add}</div>${form}`;
}

/** The Teams and games line (NBA's team limits with a game as an option beside the teams): chips, "+ rule", and the form when open. */
export function teamGameBodyHtml(rules, parts) {
  const f = crUi.tg;
  const subjects = [...parts.teams.map((t) => [t, t]), ...parts.games.map((g) => [g, `${g.replace("@", " @ ")} (either team)`])];
  const form = crUi.open === "tg"
    ? `<div class="ovf cr-form"><select data-cr="subject" aria-label="Team or game"><option value="">Pick…</option>${optionsHtml(subjects, upper(f.subject))}</select><span>min</span>${box("min", f.min)}<span>max</span>${box("max", f.max)}${addBtns("tg-add")}</div>`
    : "";
  return `<div class="teams cr-line"><span class="tl">Teams and games:</span><span class="ovs">${chipsHtml(rules, parts, false) || "<span>none</span>"}</span><button type="button" class="ov" data-cr-op="tg-open">+ rule</button></div>${form}`;
}

const FORM_OF = { "own-add": "own", "tg-add": "tg" };

/**
 * The clicks of both lines, once on the panel: `ctx` = { get() the rules, set(rules) puts them on screen and keeps them, parts() the slate's teams and games, commit() redraws }.
 * Typing keeps the boxes in crUi without a redraw (input and change events); Add reads them, refuses with a sentence under the line or adds and closes the form; × removes; Cancel closes and forgets what was typed.
 */
export function wireCountRules(root, ctx) {
  const close = () => { crUi.open = null; crUi.msg = ""; crUi.own = { op: "atLeast", count: "", side: "under", pct: "" }; crUi.tg = { subject: "", min: "", max: "" }; };
  root.querySelectorAll("[data-cr]").forEach((el) => {
    const keep = () => { crUi[crUi.open === "own" ? "own" : "tg"][el.dataset.cr] = el.value; };
    el.addEventListener("input", keep);
    el.addEventListener("change", keep);
  });
  root.querySelectorAll("[data-cr-op]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const op = btn.dataset.crOp;
      if (op === "own-open" || op === "tg-open") { close(); crUi.open = op === "own-open" ? "own" : "tg"; }
      else if (op === "cancel") close();
      else if (op === "del") ctx.set(ctx.get().filter((_, i) => i !== Number(btn.dataset.crI)));
      else if (FORM_OF[op]) {
        const form = crUi[FORM_OF[op]];
        const made = op === "own-add" ? ownRuleFromForm(ctx.get(), form) : teamGameFromForm(ctx.get(), form, ctx.parts());
        if (made.msg) crUi.msg = made.msg;
        else { ctx.set(made.rules); close(); }
      }
      ctx.commit();
    });
  });
}
