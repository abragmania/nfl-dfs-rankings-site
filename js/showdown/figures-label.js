// The Showdown Lineup tab's figures label and the Showdown header's sources pill (Adam 2026-10-20 10:03 AM: "change sources to
// anything for any game, classic, cash, showdown, make it uniform across everything"). The retired Figures switch (TwoGun | Our
// sources) is replaced by one line naming the sources this game's board reads, from board.mode.ticked (the ticked sources per
// section, server/rank/select-showdown.js tickedSources) and board.figures (the server's source lines and stamps,
// server/showdown/board-view.js boardFigures), with a link to the Sources page, where Adam picks the sources. Pure: text and html
// builders only, no DOM, no storage, no network; view.js puts the pill in #sd-figures-pill, and the meter's hover reads
// figureLine (the label left the meter's face on 2026-10-29). A board with no figures (the dev sample, public/dev/showdown-sample.json) gets no label and no pill.
import { escapeHtml } from "../format.js";

const TWOGUN_ID = "twogun";
const LINEUP_KINDS = ["projection", "sdOwnFlex", "sdOwnCpt"]; // select-showdown.js LINEUP_KINDS
const NO_FIGURES = " (no figures for this game)"; // board-view.js namesText's own words after a ticked source this game has nothing from
const MAX_NAMED = 2; // on the head-line label only, a half with more sources than this reads "N sources" so the line never wraps (every name on the hover); the source lines name them all (D40)
const AS_OF_WORD = { "file time": "saved ", "board built": "board built ", fetched: "fetched " };

const isDateText = (raw) => typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw) && !Number.isNaN(new Date(raw).getTime());
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An as-of as the page writes it: a date as "Oct 18, 2:30 PM", anything else as written without a trailing "(...)"; null when missing. */
export function whenText(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (isDateText(raw)) return new Date(raw).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return String(raw).replace(/\s*\([^()]*\)\s*$/, "");
}

/** A half's as-of with what the time is ("saved <time>" for a file's own time, "board built <time>", "fetched <time>"); null when missing. */
export function asOfText(half) {
  const when = whenText(half?.asOf);
  return when === null ? null : `${AS_OF_WORD[half.asOfFrom] ?? ""}${when}`;
}

const tickedList = (board, kind) => (Array.isArray(board?.mode?.ticked?.[kind]?.sources) ? board.mode.ticked[kind].sources : []);
const sameList = (a, b) => a.length === b.length && a.every((s, i) => s.id === b[i].id && s.weight === b[i].weight);
const hasFigures = (board) => Boolean(board?.figures && board?.mode?.ticked);

/**
 * Whether board.figures' source line for `half` ("projection" or "ownership") says this ticked source has no figures for this
 * game: its name (and weight, when the line shows weights) right before " (no figures for this game)", after one of the line's
 * own separators, so one source's name inside another's is never taken for it.
 */
function saysNone(board, half, s) {
  const text = board?.figures?.[half]?.source;
  if (typeof text !== "string" || !text.includes(NO_FIGURES)) return false;
  const name = `${reEscape(s.label)}(?: \\(weight ${reEscape(s.weight)}\\))?`;
  return new RegExp(`(?:^|: |, | and |FLEX |Captain )${name}${reEscape(NO_FIGURES)}`).test(text);
}

/** "TwoGun", "Sleeper, ESPN", "Sleeper (2), ESPN (1)" (weights only when they differ); `short` (the head-line label) reads "4 sources" past MAX_NAMED. */
function namesText(list, short) {
  if (short && list.length > MAX_NAMED) return `${list.length} sources`;
  const same = list.every((s) => s.weight === list[0].weight);
  return list.map((s) => (same ? s.label : `${s.label} (${s.weight})`)).join(", ");
}

/** One ticked list as a line names it: { text, missing } (missing: the ticked sources with no figures for this game, when some others have figures). */
function listText(board, half, list, short) {
  if (!list.length) return { text: "none ticked", missing: 0 };
  const live = list.filter((s) => !saysNone(board, half, s));
  return live.length ? { text: namesText(live, short), missing: list.length - live.length } : { text: "none for this game", missing: 0 };
}

/** One half's sources on this board by name ("TwoGun", "Sleeper app, FantasyPros, CBS Sports, ESPN fantasy"; ownership "FLEX A; CPT B"
 *  when the two slots tick different lists), every name in full (D40), as the meter's source lines, a batch's source line and the
 *  Build line give it; null for a board with no figures. */
export function halfName(board, half) {
  return hasFigures(board) ? halfParts(board, half, false).text : null;
}

function halfParts(board, half, short = true) {
  if (half === "projection") return listText(board, half, tickedList(board, "projection"), short);
  const flex = tickedList(board, "sdOwnFlex");
  const cpt = tickedList(board, "sdOwnCpt");
  if (sameList(flex, cpt)) return listText(board, half, flex, short);
  const f = listText(board, half, flex, short);
  const c = listText(board, half, cpt, short);
  return { text: `FLEX ${f.text}; CPT ${c.text}`, missing: f.missing + c.missing };
}

const sameText = (a, b) => a.replace(/[,\s]+/g, " ").trim().toLowerCase() === b.replace(/[,\s]+/g, " ").trim().toLowerCase();

/**
 * The label's stamp from board.figures' own as-of per half (the server already picks each half's oldest, board-view.js boardFigures).
 * Both halves written as dates: the older one. Otherwise (TwoGun's stamps are plain text such as "Mon Oct 19 6:07 PM CT") the two
 * cannot be ordered, so both are shown, "proj <time> · own <time>", never one guessed as the older (review of 83ee117); the same text
 * twice (commas and spaces aside) is shown once. Null when neither half has one.
 */
export function stampText(fig) {
  const p = fig?.projection?.asOf;
  const o = fig?.ownership?.asOf;
  const has = (v) => v !== null && v !== undefined && v !== "";
  if (!has(p) || !has(o)) return has(p) ? whenText(p) : has(o) ? whenText(o) : null;
  if (isDateText(p) && isDateText(o)) return whenText(Date.parse(p) <= Date.parse(o) ? p : o);
  const a = whenText(p);
  const b = whenText(o);
  return sameText(a, b) ? a : `proj ${a} · own ${b}`;
}

/**
 * The head-line label's words: "Proj and own: TwoGun · Mon, Oct 19, 6:07 PM CT", or "Proj: 4 sources · Own: LineupHQ · Oct 15,
 * 8:00 AM"; null for a board with no figures. Kept short so the head line never wraps (visual check of 83ee117): a ticked source
 * with no figures for this game is named on the hover and the source lines, not here.
 */
export function figuresLabelText(board) {
  if (!hasFigures(board)) return null;
  const proj = halfParts(board, "projection");
  const own = halfParts(board, "ownership");
  const names = proj.text === own.text ? `Proj and own: ${proj.text}` : `Proj: ${proj.text} · Own: ${own.text}`;
  return [names, stampText(board.figures)].filter(Boolean).join(" · ");
}

/** One half's source line in full, as the server words it (a ticked source with no figures for this game named in it), with its
 *  as-of and any refusal: `h` is board.figures' half or a meter answer's half ({ source, asOf, asOfFrom, error }); `what` names
 *  the half when it carries no source ("Projections" or "Ownership"). The one copy behind figuresTitle and the meter's hover. */
export function figureLine(h, what) {
  if (!h) return `${what}: not named`;
  const src = typeof h.source === "string" && h.source.trim() ? h.source.trim() : `${what}: source not named`;
  const when = asOfText(h);
  return `${src}${when ? `; as of ${when}` : ""}${h.error ? `. ${h.error}` : ""}`;
}

/** The hover behind the pill: board.figures' projection and ownership source lines in full, each with its as-of, and any refusal. */
export function figuresTitle(board) {
  if (!hasFigures(board)) return "";
  return [figureLine(board.figures.projection, "Projections"), figureLine(board.figures.ownership, "Ownership")].join("\n");
}

/**
 * The board's reading in a few words, for the header pill (`sep` ": ") and the lists' note (`sep` ", "): "TwoGun only" when TwoGun
 * is the only source ticked for all three sections, else the preset's name ("Our sources", or "Custom sources" for ticks of Adam's
 * own) and the projection sources ("4 projection sources", "Sleeper projections"); null for a board with no figures.
 */
export function readingShortText(board, sep = ": ") {
  if (!hasFigures(board)) return null;
  const lists = LINEUP_KINDS.map((k) => tickedList(board, k));
  if (lists.every((l) => l.length === 1 && l[0].id === TWOGUN_ID)) return "TwoGun only";
  const active = board.mode.active;
  const head = active === "current" ? "Our sources" : active === "twogun" ? "TwoGun" : "Custom sources";
  const p = lists[0];
  return `${head}${sep}${p.length === 1 ? `${p[0].label} projections` : p.length ? `${p.length} projection sources` : "no projection source"}`;
}

/** The header pill as a button that opens the Sources page (data-sd-open-sources), drawn with the classic header's pill
 *  (`pillHtml(cls, text, title)`, header.js modePillHtml); "" for a board with no figures. */
export function figuresPillHtml(board, pillHtml) {
  const text = readingShortText(board);
  if (text === null) return "";
  const title = `${figuresTitle(board)}\nClick to open the Sources page.`;
  return `<button type="button" class="sd-figures-pill" data-sd-open-sources aria-label="${escapeHtml(`Sources: ${text}`)}">${pillHtml("pill-mode", text, title)}</button>`;
}

/** The short line on a Build result saying whose projections it used. */
export function builtOnText(board) {
  const name = halfName(board, "projection");
  return name === null ? "Built on the board's projections" : `Built on this game's projections: ${name}`;
}

/** Whether TwoGun is a ticked source for this half ("projection" or "ownership", either slot) on this board. */
export function twogunTicked(board, half) {
  const kinds = half === "projection" ? ["projection"] : ["sdOwnFlex", "sdOwnCpt"];
  return kinds.some((k) => tickedList(board, k).some((s) => s.id === TWOGUN_ID));
}
