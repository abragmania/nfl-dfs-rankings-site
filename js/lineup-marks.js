// Classic lineup facts only (STACK, RUNBACK, MINI, PAIR tags and the QB's stack chip); nothing scores or filters by them.
import { escapeHtml } from "./format.js";

const STACK_POS = new Set(["RB", "WR", "TE"]); // a DST (or K) never takes a tag or counts in a stack
const NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven"];
const upper = (v) => String(v ?? "").trim().toUpperCase();

// Mini-stack: RB/WR/TE of both teams of a game that is not the QB's; Mini-pair: 2+ RB/WR/TE of one team outside the QB's game.
export function miniGroups(players) {
  const all = (players ?? []).filter(Boolean);
  const qbs = all.filter((p) => p.pos === "QB");
  const qbGames = new Set(qbs.map((p) => upper(p.gameId)).filter(Boolean));
  const qbTeams = new Set(qbs.map((p) => upper(p.team)));
  const byGame = new Map();
  const byTeam = new Map();
  const add = (m, k, p) => m.set(k, [...(m.get(k) ?? []), p]);
  for (const p of all) {
    const team = upper(p.team);
    const game = upper(p.gameId);
    if (!STACK_POS.has(p.pos) || !team) continue;
    if (game && !qbGames.has(game)) add(byGame, game, p);
    if (!qbTeams.has(team) && !(game && qbGames.has(game))) add(byTeam, team, p);
  }
  const stacks = [...byGame]
    .filter(([, list]) => new Set(list.map((p) => upper(p.team))).size >= 2)
    .map(([game, list]) => ({ game, label: game.split("@").join("–"), ids: list.map((p) => String(p.id)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const pairs = [...byTeam]
    .filter(([, list]) => list.length >= 2)
    .map(([team, list]) => ({ team, ids: list.map((p) => String(p.id)) }))
    .sort((a, b) => a.team.localeCompare(b.team));
  return { stacks, pairs };
}

function opponentOf(qb) {
  const team = upper(qb?.team);
  const [away = "", home = ""] = upper(qb?.gameId).split("@");
  return away === team ? home : home === team ? away : "";
}

export function lineupRoles(players) {
  const all = (players ?? []).filter(Boolean);
  const roles = new Map();
  const put = (id, tag) => roles.set(String(id), [...(roles.get(String(id)) ?? []), tag]);
  const qb = all.find((p) => p.pos === "QB");
  if (qb?.team) {
    const team = upper(qb.team);
    const opp = opponentOf(qb);
    const who = qb.name || "the QB";
    for (const p of all) {
      if (!STACK_POS.has(p.pos)) continue;
      if (upper(p.team) === team) put(p.id, { kind: "stack", word: "STACK", title: `Stack: on ${who}'s team (${team})` });
      else if (opp && upper(p.team) === opp && upper(p.gameId) === upper(qb.gameId)) put(p.id, { kind: "runback", word: "RUNBACK", title: `Run-back: from ${who}'s opponent (${opp}) in his game` });
    }
  }
  const { stacks, pairs } = miniGroups(all);
  stacks.forEach((s, k) => s.ids.forEach((id) => put(id, { kind: "mini", word: "MINI", hue: k % 3, title: `Mini-stack: ${s.label} game` })));
  for (const s of pairs) s.ids.forEach((id) => put(id, { kind: "pair", word: "PAIR", title: `Mini-pair: ${NUM_WORDS[s.ids.length] ?? s.ids.length} ${s.team} players without the ${s.team} QB` }));
  return roles;
}

export function roleTagsHtml(tags) {
  return (tags ?? []).map((t) => `<span class="role-tag role-${t.kind}${t.hue != null ? ` role-mini-${t.hue}` : ""}" title="${escapeHtml(t.title)}">${t.word}</span>`).join("");
}

export function stackLabel(players) {
  const all = (players ?? []).filter(Boolean);
  const qb = all.find((p) => p.pos === "QB");
  if (!qb || !qb.team) return null;
  const team = upper(qb.team);
  const opp = opponentOf(qb);
  const count = (t) => (t ? all.filter((p) => STACK_POS.has(p.pos) && upper(p.team) === t).length : 0);
  const mates = count(team);
  const back = count(opp);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const title = `${qb.name || "The QB"}'s stack: ${plural(mates, "RB/WR/TE teammate")} and ${plural(back, "bring-back")}${opp ? ` from ${opp}` : ""}. A DST never counts.`;
  return { text: `${team} ${mates}+${back}`, title };
}
