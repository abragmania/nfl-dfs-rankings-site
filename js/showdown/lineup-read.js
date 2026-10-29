// The Showdown Optimizer's "Lineup read" (Adam 5:08 to 5:10 PM EDT 2026-10-29, on the lineup meter: "we're trying to figure out if
// lineups are unique, make sense for game script, etc. can't you say more or show more"; "just make it not suck"): short plain
// sentences under the meter strip that read the six-man lineup from the served board's own figures. Each sentence is a deduction
// from the roster and the game line; a sentence whose figure is missing is left out (missing is missing, never zero, RULES D29).
// No source names, stamps or calculation text on its face. Pure and browser-safe: no DOM, no fetch; lineup.js draws it.
// The served board's shape (server/showdown/board.js): rows carry id, name, team, pos, salary (FLEX), cptSalary, ownFlex, ownCpt
// (percent or null) and src; board.game carries away, home, favorite, spread, total and implied { <team>: points };
// board.figures.twogun.notOnBoardIds names the men TwoGun's board has no row for (server/showdown/board-view.js).
import { escapeHtml, money, dec1 } from "../format.js";
import { findRow, SALARY_CAP } from "./lineup-saved.js";
import { joinWords } from "./board-shape.js";

const SKILL = new Set(["QB", "RB", "WR", "TE"]);
const CATCHERS = new Set(["WR", "TE"]);
const COUNT_WORDS = ["none", "one", "two", "three", "four", "five", "six"];
const TWOGUN_ID = "twogun"; // server/sources/selection-core.js TWOGUN_ID: a row's src figure that is TwoGun's

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v) => `${dec1(v)}%`; // as the pool's Own cells write it (table.js ownCellHtml)
const lineFigure = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)); // 3.5, 25, 46.5
const bold = (text) => `<b>${escapeHtml(text)}</b>`;
const esc = escapeHtml;
const NOT_READ = "A placed man is no longer on the board, so the lineup is not read.";

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th", 11 -> "11th", 21 -> "21st". */
export function ordinal(n) {
  const t = n % 100;
  const suffix = t >= 11 && t <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * Whether `row`'s `slot` ("CPT" or "FLEX") figure is TwoGun's 0 only because his board has no row for the man: on the board's
 * notOnBoardIds and that slot's figure is TwoGun's (row.src), as server/showdown/meter-answer.js:163 isNotOnBoard reads it.
 * Such a figure is not posted ownership, so the read treats it as missing.
 */
export function offBoard(board, row, slot) {
  const off = board?.figures?.twogun?.notOnBoardIds;
  if (!Array.isArray(off) || !off.map(String).includes(String(row?.id))) return false;
  return row?.src?.[slot === "CPT" ? "ownCpt" : "ownFlex"] === TWOGUN_ID;
}

/** The slot's posted ownership: Captain ownCpt, FLEX ownFlex; null when missing or TwoGun's not-on-board 0. */
function ownOf(board, row, cpt) {
  const slot = cpt ? "CPT" : "FLEX";
  return offBoard(board, row, slot) ? null : num(cpt ? row.ownCpt : row.ownFlex);
}

/** How many men the panel's picks ({ cpt: {id} or null, flex: [{id} or null] }, lineup.js state) place. */
export function pickedCount(picks) {
  return (picks?.cpt ? 1 : 0) + (picks?.flex ?? []).filter(Boolean).length;
}

/** The six seats, Captain first, as { row, cpt }; null unless every placed man is on the board. Call with six placed. */
function seatsOf(board, picks) {
  const ids = [[picks.cpt.id, true], ...picks.flex.filter(Boolean).map((s) => [s.id, false])];
  const seats = ids.map(([id, cpt]) => ({ row: findRow(board, id), cpt }));
  return seats.every((s) => s.row) ? seats : null;
}

/** The game's other team for `team` (board.game's away and home); null when the board does not name both. */
function otherTeam(board, team) {
  const g = board?.game ?? {};
  if (!g.away || !g.home) return null;
  return team === g.away ? g.home : team === g.home ? g.away : null;
}

/** Line 1: where the Captain ranks among the board's captain ownership. */
function captainLine(board, { row }) {
  const name = `Captain ${row.name}`;
  const own = ownOf(board, row, true);
  if (own === null) return `${bold(name)}: no captain ownership posted for him.`;
  const rank = 1 + (board.rows ?? []).filter((r) => num(r.ownCpt) !== null && r.ownCpt > own).length;
  const flex = ownOf(board, row, false);
  const label = rank <= 3 ? ": a popular captain" : rank >= 8 ? ": a captain few are on" : "";
  return `${bold(name)} is the ${ordinal(rank)} most-picked captain on the board (${pct(own)} of captains)${flex !== null ? `, and ${pct(flex)} have him at FLEX` : ""}${label}.`;
}

/** The book's sentence for the lineup's heavier side (`heavy`; null for three and three); "" when the board has no line. */
function bookSentence(board, heavy) {
  const g = board?.game ?? {};
  const fav = g.favorite;
  const spread = num(g.spread);
  const total = num(g.total);
  const totalText = total !== null ? `, total ${lineFigure(total)}` : "";
  if (!fav && spread === 0) return ` The book has it a pick'em${totalText}.`; // server/lib/odds.js: a parsed pick'em is no favourite, spread 0
  if (!fav || spread === null) return "";
  const by = lineFigure(Math.abs(spread));
  if (heavy === null) return ` The book has ${esc(fav)} by ${by}${totalText}.`;
  const dog = otherTeam(board, fav);
  const favPts = num(g.implied?.[fav]);
  const dogPts = dog ? num(g.implied?.[dog]) : null;
  const implied = favPts !== null && dogPts !== null ? `${esc(fav)} ${lineFigure(favPts)}, ${esc(dog)} ${lineFigure(dogPts)} implied` : null;
  if (heavy === fav) return ` The book agrees: ${esc(fav)} by ${by}${implied ? `, ${implied}` : ""}.`;
  if (dog && heavy === dog) return ` That is against the book: ${esc(fav)} is favoured by ${by}${implied ? ` (${implied})` : ""}, so this needs ${esc(dog)} to keep up or lead.`;
  return "";
}

/** Line 2: the game script the team split needs, then the book's view of it. */
function sideLine(board, seats) {
  const counts = new Map();
  for (const { row } of seats) counts.set(row.team, (counts.get(row.team) ?? 0) + 1);
  const [heavy, most] = [...counts].sort((a, b) => b[1] - a[1])[0];
  const light = otherTeam(board, heavy) ?? [...counts.keys()].find((t) => t !== heavy) ?? null;
  let text;
  if (most === 6) text = `${bold(`All six from ${heavy}`)}: this needs a ${esc(heavy)} blowout.`;
  else if (light === null) return null;
  else if (most === 5) text = `${bold(`Five ${heavy}, one ${light}`)}: a ${esc(heavy)}-dominated game where ${esc(light)} gets little going.`;
  else if (most === 4) text = `${bold(`Four ${heavy}, two ${light}`)}: leans ${esc(heavy)}.`;
  else text = `${bold("Three and three")}: a back-and-forth game where both sides score.`;
  return text + bookSentence(board, most === 3 ? null : heavy);
}

/** One quarterback's stack: his own pass catchers (a running back counts only when no WR or TE of his side is in) and the bring-back. */
function qbStack(rows, qb) {
  const mates = rows.filter((r) => r !== qb && r.team === qb.team);
  const receivers = mates.filter((r) => CATCHERS.has(r.pos));
  const catchers = receivers.length ? receivers : mates.filter((r) => r.pos === "RB");
  const bringBack = rows.filter((r) => r.team !== qb.team && CATCHERS.has(r.pos)).map((r) => esc(r.name));
  const back = bringBack.length ? ` from the other side (${joinWords(bringBack)})` : "";
  if (catchers.length === 0) return `${bold(qb.name)} with none of his receivers: his points come alone${back ? `, with a bring-back${back}` : ""}.`;
  const names = joinWords(catchers.map((r) => esc(r.name)));
  return `${bold(qb.name)} with ${COUNT_WORDS[catchers.length]} of his own pass catchers (${names}): a passing-game stack${back ? ` and a bring-back${back}` : ""}.`;
}

/** Line 3: the quarterback stack. */
function stackLine(seats) {
  const rows = seats.map((s) => s.row);
  const qbs = rows.filter((r) => r.pos === "QB");
  if (qbs.length === 0) {
    const catchers = rows.filter((r) => CATCHERS.has(r.pos)).map((r) => esc(r.name));
    if (!catchers.length) return `${bold("No quarterback")}: a bet on rushing, defense and kicking rather than passing yards.`;
    return `${bold("No quarterback")}: ${joinWords(catchers)} ${catchers.length === 1 ? "catches" : "catch"} passes from a quarterback you did not pay for.`;
  }
  if (qbs.length === 1) return qbStack(rows, qbs[0]);
  const teams = new Set(qbs.map((r) => r.team));
  if (teams.size > 1) return `${bold("Both quarterbacks")}: a shootout build.`;
  // Two of one side's quarterbacks: the stack is read on the starter, the one DraftKings prices higher as Captain.
  const starter = [...qbs].sort((a, b) => (num(b.cptSalary) ?? -Infinity) - (num(a.cptSalary) ?? -Infinity))[0];
  return `${bold(`Two ${qbs[0].team} quarterbacks`)}. ${qbStack(rows, starter)}`;
}

/** Line 4: the defense and the kicker, or the lack of both. */
function defenseLine(board, seats) {
  const parts = [];
  for (const { row, cpt } of seats) {
    if (row.pos !== "DST") continue;
    const other = otherTeam(board, row.team);
    const name = bold(`${row.team} defense${cpt ? " as Captain" : ""}`);
    if (other === null) {
      parts.push(`${name}: a bet on the other side being held down.`);
      continue;
    }
    const against = seats.filter((s) => s.row.team === other && SKILL.has(s.row.pos)).length >= 3;
    parts.push(`${name}: a bet on ${esc(other)} being held down${against ? `, which pulls against your ${esc(other)} pieces` : ""}.`);
  }
  for (const { row, cpt } of seats) {
    if (row.pos === "K") parts.push(`${bold(`${row.name}${cpt ? " as Captain," : ""}`)} kicking: points from drives that stall near the goal line.`);
  }
  return parts.length ? parts.join(" ") : `${bold("No defense or kicker")}: every slot is chasing touchdowns.`;
}

/** Line 5: the chalkiest and rarest pieces by their slot's ownership (Captain by ownCpt, FLEX by ownFlex). */
function piecesLine(board, seats) {
  const pieces = seats.map(({ row, cpt }) => ({ plain: row.name, name: `${row.name}${cpt ? " (Captain)" : ""}`, own: ownOf(board, row, cpt) }));
  const known = pieces.filter((p) => p.own !== null).sort((a, b) => b.own - a.own);
  const missing = pieces.filter((p) => p.own === null).map((p) => esc(p.name));
  const fig = (p) => `${esc(p.name)} ${pct(p.own)}`;
  const parts = [];
  if (known.length) {
    const topCount = Math.min(2, Math.ceil(known.length / 2)); // never the same man in both lists
    const top = known.slice(0, topCount);
    const rarest = known.slice(topCount).slice(-2).reverse(); // rarest first
    let text = `${bold(top.length > 1 ? "Chalkiest pieces" : "Chalkiest piece")}: ${top.map(fig).join(", ")}`;
    if (top[0].own >= 50) text += ` — the field is on ${esc(top[0].plain)} too`;
    text += ".";
    if (rarest.length) {
      text += ` Rarest: ${rarest.map(fig).join(", ")}`;
      if (rarest[0].own < 5) text += ` — ${esc(rarest[0].plain)} is where this lineup separates`;
      text += ".";
    }
    parts.push(text);
  }
  if (missing.length) parts.push(`${known.length ? "No" : bold("No")} ownership posted for ${joinWords(missing)}.`);
  return parts.join(" ");
}

/** Line 6: the salary left under the $50,000 cap, the priciest man and the cheapest; null when a price is missing. */
function salaryLine(seats) {
  const priced = seats.map(({ row, cpt }) => ({ name: `${row.name}${cpt ? " (Captain)" : ""}`, price: num(cpt ? row.cptSalary : row.salary) }));
  if (priced.some((p) => p.price === null)) return null;
  const left = SALARY_CAP - priced.reduce((sum, p) => sum + p.price, 0);
  let head;
  if (left === 0) head = `${bold(`Spends the full ${money(SALARY_CAP)}`)}.`;
  else if (left < 0) head = `${bold(`${money(-left)} over`)} the ${money(SALARY_CAP)} cap.`;
  else if (left < 1000) head = `${bold(`${money(left)} left`)}: spends almost all of it.`;
  else head = `${bold(`${money(left)} left unspent`)}: that makes it rarer, and usually costs projection.`;
  const byPrice = [...priced].sort((a, b) => b.price - a.price);
  const top = byPrice[0];
  const low = byPrice[byPrice.length - 1];
  return `${head} Priciest ${esc(top.name)} ${money(top.price)}, cheapest ${esc(low.name)} ${money(low.price)}.`;
}

/**
 * The lineup read's lines, [{ kind, html }] in the order captain, side, stack, defense, pieces, salary; a line whose figures are
 * missing is left out. `picks` is the panel's state shape, { cpt: {id} or null, flex: [{id} or null] }. Empty unless six men are
 * placed and every one is on the board.
 */
export function lineupRead(board, picks) {
  if (pickedCount(picks) !== 6) return [];
  const seats = seatsOf(board, picks);
  if (!seats) return [];
  const lines = [
    ["captain", captainLine(board, seats[0])],
    ["side", sideLine(board, seats)],
    ["stack", stackLine(seats)],
    ["defense", defenseLine(board, seats)],
    ["pieces", piecesLine(board, seats)],
    ["salary", salaryLine(seats)],
  ];
  return lines.filter(([, html]) => html).map(([kind, html]) => ({ kind, html }));
}

/** The panel's markup: "" with nobody picked, one grey line with one to five men or a placed man off the board, the lines with six. */
export function lineupReadHtml(board, picks) {
  const count = pickedCount(picks);
  if (count === 0) return "";
  const panel = (inner) => `<div class="sd-read"><div class="sd-read-head">Lineup read</div>${inner}</div>`;
  const grey = (words) => panel(`<div class="sd-read-none">${escapeHtml(words)}</div>`);
  if (count < 6) return grey("Pick six men to read the lineup");
  const lines = lineupRead(board, picks);
  if (!lines.length) return grey(NOT_READ);
  return panel(`<ul class="sd-read-lines">${lines.map((l) => `<li class="sd-read-line sd-read-${l.kind}">${l.html}</li>`).join("")}</ul>`);
}
