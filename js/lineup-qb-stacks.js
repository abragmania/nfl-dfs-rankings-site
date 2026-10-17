// Adam 2026-10-16: per-quarterback stack settings (Classic only); request shape settings.qbStacks (server/lineup/qb-stacks.js).
import { escapeHtml, money, dec1, textColourFor } from "./format.js";
import { TEAM_BY_ABBR } from "./teams-data.js";
import { matchupText, lineupOutTagHtml, rowIsOut } from "./table.js";
import { hasRealProjection } from "./state.js";

export const SKILL_POS = Object.freeze(["RB", "WR", "TE"]);
export const SPREAD_HINT = "No defense in more than about a fifth of the lineups";
export const QB_EMPTY_TEXT = "Star QBs to give each one his own stack settings.";
const upper = (v) => String(v ?? "").trim().toUpperCase();
const isChoice = (c) => c === "must" || c === "no";

export const newQbState = () => ({ entries: {}, open: new Set(), showAll: new Set() });

export function oppTeamOf(row) {
  const m = /^([A-Z0-9]+)@([A-Z0-9]+)$/i.exec(String(row?.gameId ?? ""));
  const team = upper(row?.team);
  if (m && team) {
    if (upper(m[1]) === team) return upper(m[2]);
    if (upper(m[2]) === team) return upper(m[1]);
  }
  const t = /([A-Za-z]{2,4})\s*$/.exec(String(row?.opp ?? ""));
  return t ? upper(t[1]) : "";
}

export function prefillFor(g) {
  const own = Number.isFinite(g?.stackOwn) ? g.stackOwn : 1;
  const opp = Number.isFinite(g?.stackOpp) ? g.stackOpp : 0;
  let bringBack = null;
  if (opp >= 1) bringBack = "yes";
  else if (g?.stackOppOrMore === false) bringBack = "no";
  return { min: own, max: g?.stackOwnOrMore === false ? own : null, bringBack };
}

// 2026-10-16 ruling: Yes = the global Opponents number and its "or more"/"exactly", never fewer than 1.
export function bringBackYesText(g) {
  const set = Number.isFinite(g?.stackOpp) ? g.stackOpp : 0;
  const n = Math.max(1, set);
  const words = g?.stackOppOrMore === false ? `exactly ${n} opponent${n === 1 ? "" : "s"}` : `${n} or more opponents`;
  return `Yes = ${words}${set >= 1 ? " (your Opponents setting)" : ""}`;
}

export function entryView(entries, qbId, g) {
  return entries[qbId] ?? { ...prefillFor(g), players: {} };
}

const isDefault = (e, p) => (e.min ?? 0) === (p.min ?? 0) && e.max === p.max && e.bringBack === p.bringBack && Object.keys(e.players).length === 0;

export function editEntry(entries, qbId, g, edit) {
  const cur = entryView(entries, qbId, g);
  const next = { min: cur.min, max: cur.max, bringBack: cur.bringBack, players: { ...cur.players } };
  if ("min" in edit) next.min = edit.min;
  if ("max" in edit) next.max = edit.max;
  if ("bringBack" in edit) next.bringBack = edit.bringBack === "yes" || edit.bringBack === "no" ? edit.bringBack : null;
  if ("player" in edit) {
    if (isChoice(edit.choice)) next.players[String(edit.player)] = edit.choice;
    else delete next.players[String(edit.player)];
  }
  if (isDefault(next, prefillFor(g))) delete entries[qbId];
  else entries[qbId] = next;
}

export function parseBox(text, ownMax) {
  const t = String(text ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.max(0, Math.min(ownMax, Math.round(n))) : undefined;
}

export function listedQbs(rows, lockedIdList) {
  const locked = new Set((lockedIdList ?? []).map(String));
  return (rows ?? [])
    .filter((r) => upper(r.pos) === "QB" && (r.starred || locked.has(String(r.id))))
    .sort((a, b) => (b.proj ?? -1) - (a.proj ?? -1) || String(a.name).localeCompare(String(b.name)));
}

// Adam 2026-10-16: entries re-validate against the board like locks.
export function pruneEntries(entries, rowById) {
  let changed = false;
  for (const [qbId, e] of Object.entries(entries)) {
    const qb = rowById.get(qbId);
    if (!qb) {
      delete entries[qbId];
      changed = true;
      continue;
    }
    const teams = new Set([upper(qb.team), oppTeamOf(qb)]);
    for (const pid of Object.keys(e.players)) {
      const r = rowById.get(pid);
      if (!r || !SKILL_POS.includes(upper(r.pos)) || !teams.has(upper(r.team))) {
        delete e.players[pid];
        changed = true;
      }
    }
  }
  return changed;
}

export function cleanSavedEntries(raw, ownMax) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const bound = (v) => (Number.isInteger(v) && v >= 0 && v <= ownMax ? v : null);
  for (const [id, e] of Object.entries(raw)) {
    if (!e || typeof e !== "object") continue;
    const players = {};
    for (const [pid, c] of Object.entries(e.players ?? {})) if (isChoice(c)) players[String(pid)] = c;
    out[String(id)] = { min: bound(e.min), max: bound(e.max), bringBack: e.bringBack === "yes" || e.bringBack === "no" ? e.bringBack : null, players };
  }
  return out;
}

// A ruled-out QB who is not locked keeps his saved entry but sends none; a locked one stays in every lineup (multi.js).
const qbIsOut = (qb, lockedIdList) => rowIsOut(qb) && !(lockedIdList ?? []).map(String).includes(String(qb?.id));

export function qbStacksPayload(entries, rowById, listedIds, notes, lockedIdList) {
  const out = {};
  for (const [qbId, e] of Object.entries(entries ?? {})) {
    if (!listedIds.has(qbId) || qbIsOut(rowById.get(qbId), lockedIdList)) continue;
    const players = {};
    for (const [pid, choice] of Object.entries(e.players)) {
      const r = rowById.get(pid);
      if (!r) continue;
      if (!rowIsOut(r)) players[pid] = choice;
      else if (choice === "must") notes?.push(`${rowById.get(qbId)?.name ?? qbId}'s Must on ${r.name} was left out: ruled out.`);
    }
    out[qbId] = { teammatesMin: e.min ?? 0, teammatesMax: e.max, bringBack: e.bringBack, players };
  }
  return out;
}

export function summaryText(e) {
  const parts = [];
  const min = e.min ?? 0;
  if (e.max === null) parts.push(`${min}+`);
  else parts.push(e.max === min ? `${min}` : `${min}–${e.max}`);
  if (e.bringBack === "yes") parts.push("bring-back");
  if (e.bringBack === "no") parts.push("no bring-back");
  const marks = Object.values(e.players);
  const must = marks.filter((c) => c === "must").length;
  const no = marks.filter((c) => c === "no").length;
  if (must) parts.push(`${must} must`);
  if (no) parts.push(`${no} no`);
  return parts.join(" · ");
}

function teamChipHtml(team) {
  const t = TEAM_BY_ABBR[team];
  const primary = t?.colourPrimary ?? "#333333";
  return `<span class="team-chip-mini" style="background:${primary};color:${textColourFor(primary, t?.colourSecondary ?? "#ffffff")}">${escapeHtml(team)}</span>`;
}

const sumHtml = (qbId, e) => `<span class="qbs-sum" data-qb="${escapeHtml(qbId)}"${e ? "" : " hidden"}>${e ? escapeHtml(summaryText(e)) : ""}</span>`;

export function qbListHtml(qbRows, qbs, lockedIdList) {
  if (!qbRows.length) return `<div class="opt-set qbs-block"><div class="opt-set-hint qbs-empty">${QB_EMPTY_TEXT}</div></div>`;
  const rows = qbRows
    .map((qb) => {
      const id = escapeHtml(String(qb.id));
      const open = qbs.open.has(String(qb.id));
      if (qbIsOut(qb, lockedIdList)) return `<div class="qbs-item qbs-out"><div class="qbs-toggle qbs-dead"><span class="qbs-name" title="${escapeHtml(qb.name)}">${escapeHtml(qb.name)}</span>${lineupOutTagHtml(qb)}${teamChipHtml(upper(qb.team))}</div></div>`;
      return `<div class="qbs-item"><button type="button" class="qbs-toggle" data-qbs="toggle" data-qb="${id}" aria-expanded="${open ? "true" : "false"}"><span class="qbs-name" title="${escapeHtml(qb.name)}">${escapeHtml(qb.name)}</span>${lineupOutTagHtml(qb)}${teamChipHtml(upper(qb.team))}<span class="qbs-set">Set up ${open ? "▾" : "▸"}</span></button>${sumHtml(String(qb.id), qbs.entries[String(qb.id)])}</div>`;
    })
    .join("");
  return `<div class="opt-set qbs-block">${rows}</div>`;
}

function segHtml(attrs, options, current) {
  const btns = options
    .map(([value, label]) => `<button type="button" class="qbs-seg-btn qbs-${value}${current === value ? " on" : ""}" ${attrs} data-value="${value}" aria-pressed="${current === value ? "true" : "false"}">${label}</button>`)
    .join("");
  return `<span class="qbs-seg" role="group">${btns}</span>`;
}

const PLAYER_CHOICES = [["must", "Must"], ["avail", "Avail"], ["no", "No"]];

function outControlHtml(choice) {
  const btns = PLAYER_CHOICES.map(([value, label]) => `<button type="button" class="qbs-seg-btn qbs-${value}${choice === value ? " on" : ""}" disabled tabindex="-1">${label}</button>`).join("");
  return isChoice(choice) ? `<span class="qbs-seg qbs-ro" title="Ruled out: left out of the lineups">${btns}</span>` : `<span class="qbs-seg qbs-ph" aria-hidden="true">${btns}</span>`;
}

const projected = (r) => hasRealProjection(r) && Number(r.proj) > 0;

// D45/D52 (2026-10-16): projection above 0 shows, a marked player always, the rest behind "Show all".
export function panelPlayers(rows, team, e, showAll) {
  const all = (rows ?? [])
    .filter((r) => SKILL_POS.includes(upper(r.pos)) && upper(r.team) === team)
    .sort((a, b) => (b.proj ?? -1) - (a.proj ?? -1) || String(a.name).localeCompare(String(b.name)));
  const shown = showAll ? all : all.filter((r) => projected(r) || isChoice(e.players[String(r.id)]));
  return { all, shown, hidden: all.filter((r) => !projected(r) && !isChoice(e.players[String(r.id)])).length };
}

function playerColumnHtml(title, team, list, e, qbId) {
  const html = list.shown
    .map((r) => {
      const out = rowIsOut(r);
      const choice = e.players[String(r.id)] ?? "avail";
      const control = out ? outControlHtml(choice) : segHtml(`data-qbs="pl" data-qb="${qbId}" data-pid="${escapeHtml(String(r.id))}"`, PLAYER_CHOICES, choice);
      return `<div class="qbs-pl${out ? " qbs-out" : ""}"><span class="qbs-pos">${escapeHtml(upper(r.pos))}</span><span class="qbs-pname" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>${lineupOutTagHtml(r)}<span class="qbs-sal">${money(r.salary)}</span><span class="qbs-proj">${dec1(r.proj) ?? "—"}</span>${control}</div>`;
    })
    .join("");
  const empty = list.all.length ? "None with a projection." : "None on the board.";
  return `<div class="qbs-col"><div class="qbs-col-title">${teamChipHtml(team)}<span>${escapeHtml(title)}</span></div>${html || `<div class="opt-set-hint">${empty}</div>`}</div>`;
}

export function qbPanelsHtml(qbRows, qbs, g, rows, ownMax, lockedIdList) {
  return qbRows
    .filter((qb) => qbs.open.has(String(qb.id)) && !qbIsOut(qb, lockedIdList))
    .map((qb) => {
      const idRaw = String(qb.id);
      const id = escapeHtml(idRaw);
      const e = entryView(qbs.entries, idRaw, g);
      const team = upper(qb.team);
      const opp = oppTeamOf(qb);
      const showAll = qbs.showAll.has(idRaw);
      const own = panelPlayers(rows, team, e, showAll);
      const their = panelPlayers(rows, opp, e, showAll);
      const nHidden = own.hidden + their.hidden;
      const more = nHidden ? `<button type="button" class="qbs-link qbs-more" data-qbs="all" data-qb="${id}" aria-pressed="${showAll}">${showAll ? "Show fewer" : `Show all (${nHidden})`}</button>` : "";
      const box =(which, value) => `<span class="opt-numbox"><input type="number" min="0" max="${ownMax}" class="opt-input opt-input-num qbs-num" data-qbs="${which}" data-qb="${id}" value="${value ?? ""}" placeholder="${which === "min" ? "0" : "any"}" aria-label="${which === "min" ? "Minimum" : "Maximum"} teammates for ${escapeHtml(qb.name)}" /></span>`;
      return `<section class="opt-group opt-group-wide qbs-panel" data-qb="${id}">
        <div class="qbs-head"><span class="qbs-head-name">${escapeHtml(qb.name)}</span>${teamChipHtml(team)}<span class="qbs-vs">${escapeHtml(matchupText(qb))}</span>${sumHtml(idRaw, qbs.entries[idRaw])}<span class="qbs-grow"></span>${more}<button type="button" class="qbs-link qbs-reset" data-qbs="reset" data-qb="${id}"${qbs.entries[idRaw] ? "" : " hidden"}>Reset</button><button type="button" class="qbs-link qbs-close" data-qbs="toggle" data-qb="${id}">Close ▾</button></div>
        <div class="qbs-opts">
          <span class="qbs-opt"><span class="opt-set-label">Teammates</span>${box("min", e.min)}<span class="opt-unit">to</span>${box("max", e.max)}</span>
          <span class="qbs-opt qbs-opt-bb"><span class="qbs-opt"><span class="opt-set-label">Bring-back</span>${segHtml(`data-qbs="bb" data-qb="${id}"`, [["yes", "Yes"], ["no", "No"], ["either", "Either"]], e.bringBack ?? "either")}</span><span class="opt-set-hint qbs-bb-hint">${escapeHtml(bringBackYesText(g))}</span></span>
        </div>
        <div class="qbs-cols">${playerColumnHtml(`${team} (his team)`, team, own, e, id)}${playerColumnHtml(`${opp} (bring-back)`, opp, their, e, id)}</div>
      </section>`;
    })
    .join("");
}

export function wireQbStacks(root, ctx) {
  const refresh = (qbId) => {
    const e = ctx.qbs.entries[qbId];
    root.querySelectorAll(`.qbs-sum[data-qb="${qbId}"]`).forEach((el) => {
      el.textContent = e ? summaryText(e) : "";
      el.hidden = !e;
    });
    root.querySelectorAll(`.qbs-reset[data-qb="${qbId}"]`).forEach((el) => {
      el.hidden = !e;
    });
  };
  root.addEventListener("click", (ev) => {
    const el = ev.target.closest?.("[data-qbs]");
    if (!el) return;
    const qbId = el.dataset.qb;
    const kind = el.dataset.qbs;
    if (kind === "toggle") {
      if (ctx.qbs.open.has(qbId)) ctx.qbs.open.delete(qbId);
      else ctx.qbs.open.add(qbId);
      ctx.commit();
    } else if (kind === "all") {
      if (ctx.qbs.showAll.has(qbId)) ctx.qbs.showAll.delete(qbId);
      else ctx.qbs.showAll.add(qbId);
      ctx.commit();
    } else if (kind === "reset") {
      delete ctx.qbs.entries[qbId];
      ctx.commit();
    } else if (kind === "bb") {
      editEntry(ctx.qbs.entries, qbId, ctx.globals(), { bringBack: el.dataset.value });
      ctx.commit();
    } else if (kind === "pl") {
      editEntry(ctx.qbs.entries, qbId, ctx.globals(), { player: el.dataset.pid, choice: el.dataset.value });
      ctx.commit();
    }
  });
  root.addEventListener("change", (ev) => {
    const el = ev.target;
    const kind = el?.dataset?.qbs;
    if (kind !== "min" && kind !== "max") return;
    const n = el.validity?.badInput ? undefined : parseBox(el.value, ctx.ownMax);
    if (n === undefined) {
      el.value = entryView(ctx.qbs.entries, el.dataset.qb, ctx.globals())[kind] ?? "";
      return;
    }
    el.value = n ?? "";
    editEntry(ctx.qbs.entries, el.dataset.qb, ctx.globals(), { [kind]: n });
    ctx.save();
    refresh(el.dataset.qb);
  });
}
