// Game strip (D26) in the approved look (PROJECT.md Part 4 item 5): one tile per game on one row: kickoff and total, the two teams with logo, spread and implied total, then the popularity bar with
// its rank (only when the game has real ownership numbers to sum) and the weather. Clicking a tile filters the table to that game; clicking the active tile again clears it. Every figure is the board's;
// a line that is missing reads "line n/a" and its implied totals a dash, never 0. A toggle hides the bottom line of each tile; the choice is remembered in this browser.
import { escapeHtml, kickoffClockPart, logoFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";

const COLLAPSE_KEY = "dfs.gamestrip.collapsed";

export function getGamestripCollapsed() {
  try {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    return stored === null ? false : stored === "1"; // full tiles by default (the approved look)
  } catch {
    return false;
  }
}

export function setGamestripCollapsed(collapsed) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  } catch {
    /* localStorage unavailable (private mode etc.) — the toggle still works for this page load */
  }
}

/**
 * The spread label shown beside a team code: "-3" / "-2.5" beside the favourite only, "PK" beside both teams of
 * a pick'em (a parsed line with no favourite), and "" when the line is unknown or the team is the underdog.
 * Board games carry `spread` (the favourite's number, negative) and `favorite` (a team code or null).
 */
export function spreadLabel(game, abbr) {
  if (!game || game.lineParsed === false || (game.flags ?? []).includes("lineUnknown")) return "";
  if (game.spread == null) return "";
  if (!game.favorite) return game.spread === 0 ? "(PK)" : "";
  if (game.favorite !== abbr) return "";
  const n = Math.abs(Number(game.spread));
  return Number.isFinite(n) && n > 0 ? `(-${n})` : "";
}

/**
 * Re-ranks the games shown by popularity.value, highest first, so a subset (a second slate, D57) is numbered #1..#n
 * among itself. Equal sums share a rank and the next one skips (1, 2, 2, 4). A game with no value keeps rank null.
 * Returns copies in the same order; the input is untouched.
 */
export function rankGames(games) {
  const valued = games.map((g) => g.popularity?.value).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => b - a);
  return games.map((g) => {
    const v = g.popularity?.value;
    const has = v != null && Number.isFinite(v);
    return { ...g, popularity: { ...g.popularity, rank: has ? valued.indexOf(v) + 1 : null } };
  });
}

/** The rank label: "#1 (245%)", the game's summed offensive ownership rounded to a whole percent. */
export function popularityLabel(pop) {
  return `#${pop.rank ?? "?"} (${Math.round(pop.value)}%)`;
}

/** The tier a figure wears (NBA's t-top, t-lit, t-soft): the highest implied total of the games shown, the top six, the rest. Rank among the board's own implied totals; "t-soft" when there is no number. Pure. */
export function tierOf(value, sortedDesc) {
  if (value == null || !sortedDesc.length) return "t-soft";
  if (value >= sortedDesc[0]) return "t-top";
  return value >= sortedDesc[Math.min(5, sortedDesc.length - 1)] ? "t-lit" : "t-soft";
}

function weatherText(game) {
  if (game.roof === "indoor") return "indoor";
  if (game.roof === "unknown") return "roof unknown";
  const w = game.weather;
  if (!w) return "";
  const parts = [];
  if (w.tempF != null) parts.push(`${w.tempF}°F`);
  if (w.windMph != null) parts.push(`${w.windMph} mph`);
  if (w.rainChance != null) parts.push(`${w.rainChance}% rain`);
  return parts.join(" · ");
}

function sideHtml(abbr, implied, lineMissing, spread, tiers) {
  const t = TEAM_BY_ABBR[abbr];
  const logo = logoFor(t);
  const text = lineMissing || implied == null ? "—" : implied.toFixed(1);
  return `<div class="side" style="--t1:${escapeHtml(t?.colourPrimary ?? "#555")};--t2:${escapeHtml(t?.colourSecondary ?? "#555")}">${logo ? `<img class="logo lg" src="${logo}" alt="${escapeHtml(t?.name ?? abbr)}" />` : `<span class="logo lg"></span>`}<span class="code">${escapeHtml(abbr)}</span><span class="spr" title="Point spread (favourite)">${escapeHtml(spread)}</span><span class="ip ${lineMissing || implied == null ? "t-soft" : tierOf(implied, tiers)}" style="--tc:var(--gr)" title="Implied team total">${text}</span></div>`;
}

const POP_TITLE = "Sum of the published ownership numbers for this game's offensive players (defenses excluded)";

function gameBoxHtml(game, activeGameId, maxPopValue, collapsed, tiers) {
  // A line that's unknown, failed to parse, or has no total at all is treated the same way: "line n/a", never a bare 0.0 standing in for a missing line.
  const lineMissing = (game.flags ?? []).includes("lineUnknown") || game.lineParsed === false || game.total == null;
  const pop = game.popularity ?? {};
  const hasPop = pop.value != null && pop.rank != null;
  const pct = hasPop && maxPopValue > 0 ? Math.max(4, Math.round((100 * pop.value) / maxPopValue)) : 0;
  const total = lineMissing ? `<span class="tot line-unknown">line n/a</span>` : `<span class="tot">O/U<b class="${tierOf(game.total / 2, tiers)}" style="--tc:var(--am)">${escapeHtml(game.total.toFixed(1))}</b></span>`;
  const bottom = collapsed
    ? ""
    : `${hasPop ? `<span class="popbar" title="${POP_TITLE}"><i style="width:${pct}%"></i></span>` : ""}<div class="gh gh2">${hasPop ? `<span class="pop" title="${POP_TITLE}">${escapeHtml(popularityLabel(pop))}</span>` : `<span class="pop"></span>`}<span class="wx">${escapeHtml(weatherText(game))}</span></div>`;
  return `<button type="button" class="game game-box${activeGameId === game.id ? " sel" : ""}" data-game-id="${escapeHtml(String(game.id))}"><div class="gh"><span class="tip">${escapeHtml(kickoffClockPart(game.kickoffEt).replace(/ PM$/, ""))}</span>${total}</div>${sideHtml(game.away, game.impliedTotal?.away, lineMissing, spreadLabel(game, game.away), tiers)}${sideHtml(game.home, game.impliedTotal?.home, lineMissing, spreadLabel(game, game.home), tiers)}${bottom}</button>`;
}

/** `collapsed`, `onToggleCollapse`: the bottom line of each tile on or off; the toggle's words say which. */
export function renderGameStrip(container, shownGames, activeGameId, onGameClick, { collapsed = false, onToggleCollapse } = {}) {
  const games = rankGames(shownGames); // rank among the games actually shown, so a second slate's three games read #1-#3 (D57)
  const maxPopValue = Math.max(0, ...games.map((g) => g.popularity?.value ?? 0));
  const tiers = games.flatMap((g) => [g.impliedTotal?.away, g.impliedTotal?.home]).filter((v) => v != null).sort((a, b) => b - a);
  const boxes = games.map((g) => gameBoxHtml(g, activeGameId, maxPopValue, collapsed, tiers)).join("");
  container.innerHTML = `<div class="games">${boxes}</div><button type="button" id="gamestrip-toggle" class="gs-toggle">${collapsed ? "Show game details" : "Hide game details"}</button>`;
  container.querySelectorAll(".game-box").forEach((el) => {
    el.addEventListener("click", () => onGameClick(el.dataset.gameId));
  });
  container.querySelector("#gamestrip-toggle").addEventListener("click", () => onToggleCollapse?.());
}
