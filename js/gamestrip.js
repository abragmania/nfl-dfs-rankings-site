// Game strip (D26): one box per game, away @ home with both logos, kickoff time above the "@", the total (shown as
// "O/U 49.5" on the kickoff line), each team's implied total under its logo, a popularity bar with rank
// (only when the game has real ownership numbers to sum; otherwise neither is drawn), a "line unknown" marker, and either an indoor icon, "roof unknown" or temp/wind for outdoor games.
// Clicking a box filters the table to that game; clicking the active box again clears the filter.
//
// Defaults to a compact single-row strip (👁 visual-qa: at 1366x768 the full grid left only four table
// rows visible) with a toggle that expands it to the full detail grid; the choice is remembered in
// localStorage so it survives a reload.
import { escapeHtml, kickoffClockPart, logoFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";

const COLLAPSE_KEY = "dfs.gamestrip.collapsed";

export function getGamestripCollapsed() {
  try {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    return stored === null ? true : stored === "1"; // compact by default
  } catch {
    return true;
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

const BRIGHTNESS_FLOOR = 0.15; // the least-owned game stays legible

/**
 * How bright a game's popularity label is, 0..1: the game's summed ownership `value` measured from zero against
 * `max` (the largest value among the games shown, the same scale as the bar), lifted by a small floor so the
 * lowest game is never invisible. Continuous, so near-equal games look near-equal and a runaway leader stands
 * apart. Null when the game has no value; 0.5 (neutral) when fewer than two games have a value or max is 0.
 */
export function popularityBrightness(value, max, count = 2) {
  if (value == null || !Number.isFinite(value)) return null;
  if (count < 2 || !Number.isFinite(max) || max <= 0) return 0.5;
  return BRIGHTNESS_FLOOR + (1 - BRIGHTNESS_FLOOR) * Math.max(0, Math.min(1, value / max));
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

function popularityRankHtml(pop, range) {
  const t = popularityBrightness(pop.value, range.max, range.count);
  const style = t == null ? "" : ` style="--pop-t:${t.toFixed(3)}"`;
  return `<span class="game-popularity-rank"${style}>${escapeHtml(popularityLabel(pop))}</span>`;
}

function teamLogoHtml(abbr, impliedTotal, collapsed, lineMissing, spread = "") {
  const t = TEAM_BY_ABBR[abbr];
  const logo = logoFor(t);
  const name = t?.name ?? abbr;
  // A missing/unparsed line means there is no implied total to show at all — an em dash, muted, rather
  // than the ordinary "—" used for a merely-null total on an otherwise-known line.
  const implied = lineMissing ? "—" : impliedTotal == null ? "—" : impliedTotal.toFixed(1);
  // Styled inline rather than via a new stylesheet class (style.css is out of scope for this pass): the
  // em dash for a missing/unparsed line is muted the same grey used elsewhere for de-emphasised text.
  const impliedStyle = lineMissing ? ' style="color:var(--text-dim)"' : "";
  const logoSize = collapsed ? 20 : 36;
  // The "impl" caption is dropped in compact mode to keep the box short enough that all twelve fit in
  // one row at 1366 and 1920 without a scrollbar (👁 visual-qa); the tooltip on the number itself still
  // says "Implied team total" either way.
  const cap = collapsed ? "" : `<span class="game-team-implied-cap">impl</span>`;
  return `
    <div class="game-team">
      <img class="game-team-logo" src="${logo}" alt="${escapeHtml(name)}" width="${logoSize}" height="${logoSize}" />
      <span class="game-team-abbr">${escapeHtml(abbr)}${spread ? ` <span class="game-team-spread" title="Point spread (favourite)">${escapeHtml(spread)}</span>` : ""}</span>
      <span class="game-team-implied"${impliedStyle} title="Implied team total">${implied}</span>
      ${cap}
    </div>`;
}

function weatherHtml(game) {
  if (game.roof === "indoor") {
    return `<span class="game-weather" title="Indoor">🏟 indoor</span>`;
  }
  if (game.roof === "unknown") {
    return `<span class="game-weather" title="Roof status unknown; no forecast shown">roof unknown</span>`;
  }
  const w = game.weather;
  if (!w) return `<span class="game-weather">—</span>`;
  const parts = [];
  if (w.tempF != null) parts.push(`${w.tempF}°F`);
  if (w.windMph != null) parts.push(`${w.windMph} mph`);
  if (w.rainChance != null) parts.push(`${w.rainChance}% rain`);
  return `<span class="game-weather" title="Outdoor forecast">${escapeHtml(parts.join(" · ") || "—")}</span>`;
}

// Compact mode renders the rank whenever the game has one (👁 visual-qa), folded into the same line as kickoff/total rather
// than its own row so the box stays short enough that a single row of twelve never eats the vertical
// budget a short viewport needs for the table. The bar itself is included too but stays display:none
// under a width threshold (style.css) — a 1920-wide strip has room for a compact bar next to the rank,
// a 1366-wide one doesn't (👁 visual-qa third pass).
function popularityCompactHtml(game, maxValue, range) {
  const pop = game.popularity ?? {};
  if (pop.value == null || pop.rank == null) return ""; // no real ownership number in this game: no bar, no rank
  const pct = maxValue > 0 ? Math.max(4, Math.round((100 * (pop.value ?? 0)) / maxValue)) : 0;
  return `
    <div class="game-popularity-compact" title="Sum of the published ownership numbers for this game's offensive players (defenses excluded)">
      <div class="game-popularity-bar"><div class="game-popularity-fill" style="width:${pct}%"></div></div>
      ${popularityRankHtml(pop, range)}
    </div>`;
}

function popularityHtml(game, maxValue, range) {
  const pop = game.popularity ?? {};
  if (pop.value == null || pop.rank == null) return ""; // no real ownership number in this game: no bar, no rank
  const pct = maxValue > 0 ? Math.max(4, Math.round((100 * (pop.value ?? 0)) / maxValue)) : 0;
  return `
    <div class="game-popularity" title="Sum of the published ownership numbers for this game's offensive players (defenses excluded)">
      <div class="game-popularity-bar"><div class="game-popularity-fill" style="width:${pct}%"></div></div>
      ${popularityRankHtml(pop, range)}
    </div>`;
}

function gameBoxHtml(game, activeGameId, maxPopValue, collapsed, popRange) {
  const isActive = activeGameId === game.id;
  const lineUnknown = (game.flags ?? []).includes("lineUnknown");
  // A line that's unknown, failed to parse, or has no total at all is treated the same way: "line n/a"
  // in place of "O/U 0.0", never a bare 0.0 standing in for a missing line.
  const lineMissing = lineUnknown || game.lineParsed === false || game.total == null;
  const total = lineMissing ? "line n/a" : `O/U ${game.total.toFixed(1)}`;
  const gameIdAttr = escapeHtml(String(game.id));
  return `
    <button type="button" class="game-box${isActive ? " active" : ""}${collapsed ? " compact" : ""}" data-game-id="${gameIdAttr}">
      <div class="game-box-teams">
        ${teamLogoHtml(game.away, game.impliedTotal?.away, collapsed, lineMissing, spreadLabel(game, game.away))}
        <div class="game-mid">
          <span class="game-kickoff">${escapeHtml(kickoffClockPart(game.kickoffEt))}</span>
          <span class="game-at">@</span>
        </div>
        ${teamLogoHtml(game.home, game.impliedTotal?.home, collapsed, lineMissing, spreadLabel(game, game.home))}
      </div>
      <div class="game-box-meta">
        <span class="game-total${lineMissing ? " line-unknown" : ""}">${escapeHtml(total)}</span>
        ${collapsed ? popularityCompactHtml(game, maxPopValue, popRange) : ""}
      </div>
      ${collapsed ? "" : weatherHtml(game)}
      ${collapsed ? "" : popularityHtml(game, maxPopValue, popRange)}
    </button>`;
}

/** `collapsed`/`onToggleCollapse` control the compact-vs-full-detail layout (default compact). */
export function renderGameStrip(container, shownGames, activeGameId, onGameClick, { collapsed = true, onToggleCollapse } = {}) {
  // Rank and brightness are among the games actually shown, so a second slate's three games read #1-#3 (D57).
  const games = rankGames(shownGames);
  const maxPopValue = Math.max(0, ...games.map((g) => g.popularity?.value ?? 0));
  const toggleLabel = collapsed ? "Show game details ▾" : "Hide game details ▴";
  const popCount = games.filter((g) => g.popularity?.value != null && Number.isFinite(g.popularity.value)).length;
  const popRange = { max: maxPopValue, count: popCount };
  const boxesHtml = games.map((g) => gameBoxHtml(g, activeGameId, maxPopValue, collapsed, popRange)).join("");
  container.innerHTML = `
    <div class="gamestrip-toggle-row">
      <button type="button" id="gamestrip-toggle" class="gamestrip-toggle-btn">${toggleLabel}</button>
    </div>
    <div class="gamestrip-boxes${collapsed ? " collapsed" : ""}">${boxesHtml}</div>
  `;
  container.querySelectorAll(".game-box").forEach((el) => {
    el.addEventListener("click", () => onGameClick(el.dataset.gameId));
  });
  container.querySelector("#gamestrip-toggle").addEventListener("click", () => onToggleCollapse?.());
}
