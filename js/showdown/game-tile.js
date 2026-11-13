// The Showdown's one game tile (the classic game strip's tile, Adam 2026-11-13 10:11 AM): kickoff and total, the two teams with logo, spread and implied total (gamestrip.js sideHtml, the one copy),
// the SHOWDOWN tag, and the date and weather under them. Every figure is the board's own (payload.game, never re-derived); a missing line reads a dash, never zero. Pure markup.
import { escapeHtml, kickoffClockPart, dec1 } from "../format.js";
import { sideHtml, spreadLabel, tierOf, weatherText } from "../gamestrip.js";
import { kickoffDateAndClock } from "../header.js";

/** The tile for `game` (board.game: away, home, kickoffEt, total, spread, favorite, implied {team: n}, weather); "" without one. */
export function gameTileHtml(game) {
  if (!game) return "";
  const lineMissing = game.total == null;
  const tiers = [game.implied?.[game.away], game.implied?.[game.home]].filter((v) => v != null && Number.isFinite(v)).sort((a, b) => b - a);
  const side = (abbr) => sideHtml(abbr, game.implied?.[abbr] ?? null, lineMissing, spreadLabel(game, abbr), tiers);
  const clock = kickoffClockPart(game.kickoffEt).replace(/ [AP]M$/, "");
  const total = lineMissing ? `<span class="tot line-unknown">line n/a</span>` : `<span class="tot">O/U<b class="${tierOf(game.total / 2, tiers.length ? tiers : [game.total / 2])}" style="--tc:var(--am)">${escapeHtml(dec1(game.total))}</b></span>`;
  const date = kickoffDateAndClock(game.kickoffEt).split(" ")[0] ?? "";
  const wx = weatherText(game);
  return `<div class="games sd-games"><div class="game game-box sel sd-game" id="sd-game-tile"><div class="gh">${clock ? `<span class="tip">${escapeHtml(clock)}</span>` : ""}${total}<span class="sd-game-tag">SHOWDOWN</span></div>${side(game.away)}${side(game.home)}<div class="gh gh2"><span class="pop">${escapeHtml(date)}</span><span class="wx">${escapeHtml(wx)}</span></div></div></div>`;
}
