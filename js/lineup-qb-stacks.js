// RULES.md D73 (amended 2026-10-17): per-QB stack settings, entry { min, max, oppMin, oppMax, players }; null = blank = follow the global (server/lineup/qb-stacks.js).
import { escapeHtml, money, dec1 } from "./format.js";
import { rowIsOut } from "./table.js";
import { playerLineHtml, teamChipHtml } from "./player-row.js";
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

const NUMBER_FIELDS = Object.freeze(["min", "max", "oppMin", "oppMax"]);
const isNum = (v) => v !== null && v !== undefined;
const blankEntry = () => ({ min: null, max: null, oppMin: null, oppMax: null, players: {} });

export function entryView(entries, qbId) {
  return entries[qbId] ?? blankEntry();
}

const isDefault = (e) => NUMBER_FIELDS.every((k) => !isNum(e[k])) && Object.keys(e.players).length === 0;

export function editEntry(entries, qbId, edit) {
  const cur = entryView(entries, qbId);
  const next = { min: cur.min ?? null, max: cur.max ?? null, oppMin: cur.oppMin ?? null, oppMax: cur.oppMax ?? null, players: { ...cur.players } };
  for (const k of NUMBER_FIELDS) if (k in edit) next[k] = edit[k];
  if ("player" in edit) {
    if (isChoice(edit.choice)) next.players[String(edit.player)] = edit.choice;
    else delete next.players[String(edit.player)];
  }
  if (isDefault(next)) delete entries[qbId];
  else entries[qbId] = next;
}

const sideIsSet = (e, side) => (side === "own" ? isNum(e?.min) || isNum(e?.max) : isNum(e?.oppMin) || isNum(e?.oppMax));

/** Adam 2026-10-18 1:50 AM: do the Default stack rows still decide anything? True when at least one usable QB has no own
 *  number on a side (no entry, or both of that side's boxes blank, which follows the default, D73); false when every usable
 *  QB carries his own teammate and opponent numbers. No usable QB at all: true (nothing to claim, the rows look as usual).
 *  `entries` = only the ones the build sends (listed QBs, qbStacksPayload); a saved entry of an unstarred QB must not be passed (🔵 2026-10-18). */
export function defaultsApply(usableQbIds, entries) {
  const ids = [...(usableQbIds ?? [])].map(String);
  if (!ids.length) return true;
  return ids.some((id) => !sideIsSet(entries?.[id], "own") || !sideIsSet(entries?.[id], "opp"));
}

const sideWords =(n, orMore) => (orMore === false ? `exactly ${n}` : `${n} or more`);

/** RULES.md D73 (amended 2026-10-17): blank-box placeholders and hint; side "own"/"opp", set = the QB has his own number there. */
export function sideBlankView(g, side, set) {
  const n = Number.isFinite(g?.[side === "own" ? "stackOwn" : "stackOpp"]) ? g[side === "own" ? "stackOwn" : "stackOpp"] : side === "own" ? 1 : 0;
  const orMore = g?.[side === "own" ? "stackOwnOrMore" : "stackOppOrMore"] !== false;
  if (set) return { minPh: "0", maxPh: "any", hint: "Blank = 0 for the minimum, no limit for the maximum" };
  return { minPh: String(n), maxPh: orMore ? "any" : String(n), hint: `Blank = your ${side === "own" ? "Teammates" : "Opponents"} setting (${sideWords(n, orMore)})` };
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

export function cleanSavedEntries(raw, ownMax, oppMax) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const bound = (v, top) => (Number.isInteger(v) && v >= 0 && v <= top ? v : null);
  for (const [id, e] of Object.entries(raw)) {
    if (!e || typeof e !== "object") continue;
    const players = {};
    for (const [pid, c] of Object.entries(e.players ?? {})) if (isChoice(c)) players[String(pid)] = c;
    const clean = { min: bound(e.min, ownMax), max: bound(e.max, ownMax), oppMin: bound(e.oppMin, oppMax), oppMax: bound(e.oppMax, oppMax), players };
    // RULES.md D73 (amended 2026-10-17): old bringBack read once: yes = oppMin 1, no = oppMax 0.
    if (e.bringBack === "yes" && clean.oppMin === null) clean.oppMin = 1;
    else if (e.bringBack === "no" && clean.oppMax === null) clean.oppMax = 0;
    if (!isDefault(clean)) out[String(id)] = clean;
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
    if (isDefault({ ...e, players })) continue; // PROJECT.md Part 4 Optimizer: blank once pruned, the server drops it (qb-stacks.js isBlankEntry), so it is not sent
    out[qbId] = { teammatesMin: e.min ?? null, teammatesMax: e.max ?? null, opponentsMin: e.oppMin ?? null, opponentsMax: e.oppMax ?? null, players };
  }
  return out;
}

function rangeText(min, max) {
  if (!isNum(min) && !isNum(max)) return null;
  const lo = min ?? 0;
  if (!isNum(max)) return `${lo}+`;
  return max === lo ? `${lo}` : `${lo}–${max}`;
}

export function summaryText(e) {
  const parts = [];
  const mates = rangeText(e.min, e.max);
  if (mates) parts.push(`${mates} mates`);
  const opps = rangeText(e.oppMin, e.oppMax);
  if (opps) parts.push(`opp ${opps}`);
  const marks = Object.values(e.players);
  const must = marks.filter((c) => c === "must").length;
  const no = marks.filter((c) => c === "no").length;
  if (must) parts.push(`${must} must`);
  if (no) parts.push(`${no} no`);
  return parts.join(" · ");
}

const sumHtml = (qbId, e) => `<span class="qbs-sum" data-qb="${escapeHtml(qbId)}"${e ? "" : " hidden"}>${e ? escapeHtml(summaryText(e)) : ""}</span>`;

export function qbListHtml(qbRows, qbs, lockedIdList) {
  if (!qbRows.length) return `<div class="opt-set qbs-block"><div class="opt-set-hint qbs-empty">${QB_EMPTY_TEXT}</div></div>`;
  const rows = qbRows
    .map((qb) => {
      const id = escapeHtml(String(qb.id));
      const open = qbs.open.has(String(qb.id));
      if (qbIsOut(qb, lockedIdList)) return `<div class="qbs-item qbs-out"><div class="qbs-toggle qbs-dead">${playerLineHtml(qb, { nameCls: "qbs-name", titled: true, tag: "out" })}</div></div>`;
      return `<div class="qbs-item"><button type="button" class="qbs-toggle" data-qbs="toggle" data-qb="${id}" aria-expanded="${open ? "true" : "false"}">${playerLineHtml(qb, { nameCls: "qbs-name", titled: true, tag: "out" })}<span class="qbs-set">Set up ${open ? "▾" : "▸"}</span></button>${sumHtml(String(qb.id), qbs.entries[String(qb.id)])}</div>`;
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
      return `<div class="qbs-pl${out ? " qbs-out" : ""}" data-card-id="${escapeHtml(String(r.id))}"><span class="qbs-pos">${escapeHtml(upper(r.pos))}</span>${playerLineHtml(r, { nameCls: "qbs-pname", titled: true, pill: false, tag: "out" })}<span class="qbs-sal">${money(r.salary)}</span><span class="qbs-proj">${dec1(r.proj) ?? "—"}</span>${control}</div>`;
    })
    .join("");
  const empty = list.all.length ? "None with a projection." : "None on the board.";
  return `<div class="qbs-col"><div class="qbs-col-title">${teamChipHtml(team)}<span>${escapeHtml(title)}</span></div>${html || `<div class="opt-set-hint">${empty}</div>`}</div>`;
}

const BOXES = Object.freeze({
  min: { field: "min", top: "ownMax" },
  max: { field: "max", top: "ownMax" },
  omin: { field: "oppMin", top: "oppMax" },
  omax: { field: "oppMax", top: "oppMax" }
});

export function qbPanelsHtml(qbRows, qbs, g, rows, ownMax, oppMax, lockedIdList) {
  return qbRows
    .filter((qb) => qbs.open.has(String(qb.id)) && !qbIsOut(qb, lockedIdList))
    .map((qb) => {
      const idRaw = String(qb.id);
      const id = escapeHtml(idRaw);
      const e = entryView(qbs.entries, idRaw);
      const team = upper(qb.team);
      const opp = oppTeamOf(qb);
      const showAll = qbs.showAll.has(idRaw);
      const own = panelPlayers(rows, team, e, showAll);
      const their = panelPlayers(rows, opp, e, showAll);
      const nHidden = own.hidden + their.hidden;
      const more = nHidden ? `<button type="button" class="qbs-link qbs-more" data-qbs="all" data-qb="${id}" aria-pressed="${showAll}">${showAll ? "Show fewer" : `Show all (${nHidden})`}</button>` : "";
      const sideHtml = (side, title, minKey, maxKey, top) => {
        const [minField, maxField] = [BOXES[minKey].field, BOXES[maxKey].field];
        const view = sideBlankView(g, side, sideIsSet(e, side));
        const noun = side === "own" ? "teammates" : "opponents";
        const box = (which, value, placeholder, word) => `<span class="opt-numbox"><input type="number" min="0" max="${top}" class="opt-input opt-input-num qbs-num" data-qbs="${which}" data-qb="${id}" value="${value ?? ""}" placeholder="${placeholder}" aria-label="${word} ${noun} for ${escapeHtml(qb.name)}" /></span>`;
        return `<span class="qbs-opt qbs-opt-side"><span class="qbs-opt"><span class="opt-set-label">${title}</span>${box(minKey, e[minField], view.minPh, "Minimum")}<span class="opt-unit">to</span>${box(maxKey, e[maxField], view.maxPh, "Maximum")}</span><span class="opt-set-hint qbs-side-hint" data-qb="${id}" data-side="${side}">${escapeHtml(view.hint)}</span></span>`;
      };
      return `<section class="opt-group opt-group-wide qbs-panel" data-qb="${id}">
        <div class="qbs-head" data-card-id="${id}">${playerLineHtml(qb, { nameCls: "qbs-head-name", tag: "out" })}${sumHtml(idRaw, qbs.entries[idRaw])}<span class="qbs-grow"></span>${more}<button type="button" class="qbs-link qbs-reset" data-qbs="reset" data-qb="${id}"${qbs.entries[idRaw] ? "" : " hidden"}>Reset</button><button type="button" class="qbs-link qbs-close" data-qbs="toggle" data-qb="${id}">Close ▾</button></div>
        <div class="qbs-opts">
          ${sideHtml("own", "Teammates", "min", "max", ownMax)}
          ${sideHtml("opp", "Opponents", "omin", "omax", oppMax)}
        </div>
        <div class="qbs-cols">${playerColumnHtml(`${team} (his team)`, team, own, e, id)}${playerColumnHtml(`${opp} (the team he faces)`, opp, their, e, id)}</div>
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
    for (const side of ["own", "opp"]) {
      const view = sideBlankView(ctx.globals(), side, sideIsSet(e, side));
      const [minKind, maxKind] = side === "own" ? ["min", "max"] : ["omin", "omax"];
      root.querySelectorAll(`[data-qbs="${minKind}"][data-qb="${qbId}"]`).forEach((el) => {
        el.placeholder = view.minPh;
      });
      root.querySelectorAll(`[data-qbs="${maxKind}"][data-qb="${qbId}"]`).forEach((el) => {
        el.placeholder = view.maxPh;
      });
      root.querySelectorAll(`.qbs-side-hint[data-qb="${qbId}"][data-side="${side}"]`).forEach((el) => {
        el.textContent = view.hint;
      });
    }
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
    } else if (kind === "pl") {
      editEntry(ctx.qbs.entries, qbId, { player: el.dataset.pid, choice: el.dataset.value });
      ctx.commit();
    }
  });
  root.addEventListener("change", (ev) => {
    const el = ev.target;
    const box = BOXES[el?.dataset?.qbs];
    if (!box) return;
    const n = el.validity?.badInput ? undefined : parseBox(el.value, ctx[box.top]);
    if (n === undefined) {
      el.value = entryView(ctx.qbs.entries, el.dataset.qb)[box.field] ?? "";
      return;
    }
    el.value = n ?? "";
    editEntry(ctx.qbs.entries, el.dataset.qb, { [box.field]: n });
    ctx.save();
    refresh(el.dataset.qb);
  });
}
