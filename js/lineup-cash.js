// Cash mode's pure browser logic (PROJECT.md Part 4 "Cash mode"; cashmode-plan-2026-10-17.md with Adam's 2026-10-17 rulings:
// Must = the lock, Want = his cash pool, Fine = the default). No DOM access; lineup.js (job 3b) wires it.
// lineup.js savePersisted writes slots, locks, excludes, playerMax, playerMin, qbStacks, spreadDst, mode, cash and stash;
// loadedId and saveName live in memory (swapModeStash keeps them). Cash 3b fix round, 2026-10-17: mode, cash and stash named.
import { escapeHtml, money, dec1 } from "./format.js";
import { shownTotal } from "./totals.js";
import { rowIsOut } from "./out.js";

const SALARY_CAP = 50000;
const MINUS = "−";
export const UNUSED_CAP_WARN = 400;
const SWAP_LIMIT_TEXT = "no swap fits under the cap";
const SLOT_COUNT = 9;
const MAX_COUNT = 150;
const MAX_PER_TEAM = 8;

// Change together with CASH_DEFAULTS in server/lineup/cash.js (the browser cannot import it; tests/cash-ui.test.mjs compares).
// Adam 2026-10-17: cash has no minimum-unique rule, so no minUnique here, in the stored state or in the request.
export const CASH_DEFAULTS_BROWSER = Object.freeze({ count: "1", maxPerTeam: "" });

export function defaultCashState() {
  return { ...CASH_DEFAULTS_BROWSER, avoid: [], want: {} };
}

// Cash mode job 3b, 2026-10-17: what lineup.js hydrate accepts from storage; anything else falls back to the defaults.
export function cleanCashState(raw) {
  const base = defaultCashState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const text = (v, fallback) => (typeof v === "string" || typeof v === "number" ? String(v) : fallback);
  const want = {};
  if (raw.want && typeof raw.want === "object" && !Array.isArray(raw.want)) {
    for (const [slate, ids] of Object.entries(raw.want)) if (Array.isArray(ids)) want[slate] = [...new Set(ids.map(String))];
  }
  return { count: text(raw.count, base.count), maxPerTeam: text(raw.maxPerTeam, base.maxPerTeam), avoid: Array.isArray(raw.avoid) ? raw.avoid.map(String) : [], want };
}

// D75: the one browser copy of the lineup-mode rule (entries-plan.js imports it); server/lineups/validate.js keeps the server's, a test checks they agree.
export function lineupModeOf(l) {
  return l && l.mode === "cash" ? "cash" : "gpp";
}

const emptyActive = () => ({ slots: new Array(SLOT_COUNT).fill(null), locks: [], excludes: [], loadedId: null, saveName: "" });

function copyActive(p) {
  const base = emptyActive();
  return {
    slots: Array.isArray(p?.slots) ? p.slots.map((s) => (s ? { ...s } : null)) : base.slots,
    locks: Array.isArray(p?.locks) ? [...p.locks] : base.locks,
    excludes: Array.isArray(p?.excludes) ? [...p.excludes] : base.excludes,
    loadedId: p?.loadedId ?? null,
    saveName: typeof p?.saveName === "string" ? p.saveName : "",
  };
}

// Each mode keeps its own build: the active state goes under stash[fromMode] and stash[toMode] (or empty) becomes active.
export function swapModeStash(persisted, fromMode, toMode) {
  const src = persisted && typeof persisted === "object" ? persisted : {};
  const stash = { ...(src.stash ?? {}) };
  stash[fromMode] = copyActive(src);
  const next = fromMode === toMode ? copyActive(src) : copyActive(stash[toMode] ?? emptyActive());
  return { ...src, ...next, mode: toMode, stash };
}

export function modeSwitchHtml(mode) {
  const active = mode === "cash" ? "cash" : "gpp";
  const btn = (value, inner, title) =>
    `<button type="button" class="tg-mode-btn${active === value ? " active" : ""}" data-opt-mode="${value}" aria-pressed="${active === value}" title="${escapeHtml(title)}">${inner}</button>`;
  return `<span class="tg-mode-switch opt-mode-switch" role="group" aria-label="Lineup type">${btn("gpp", "GPP", "Tournament lineups")}${btn("cash", `${cashChipHtml()} Cash`, "Cash-game lineups: the highest floor")}</span>`;
}

export function cashChipHtml() {
  return `<span class="cash-chip" aria-hidden="true">$</span>`;
}

export function convictionChipsHtml(row, { locked = false, wanted = false, excluded = false } = {}) {
  const id = escapeHtml(String(row?.id ?? ""));
  const active = locked ? "must" : wanted ? "want" : "fine";
  const part = (key, label) =>
    `<button type="button" class="cash-pick-btn${active === key ? " active" : ""}" data-cash-pick="${key}" data-id="${id}" aria-pressed="${active === key}"${excluded ? " disabled" : ""}>${label}</button>`;
  return `<span class="cash-pick${excluded ? " is-disabled" : ""}" role="group" aria-label="Conviction for ${escapeHtml(row?.name ?? "")}">${part("must", "Must")}${part("want", "Want")}${part("fine", "Fine")}</span>`;
}

export function cashHeadLine(mustRows, wantRows) {
  const names = (rs) => rs.map((r) => escapeHtml(r?.name ?? "")).join(", ");
  const parts = [];
  if (mustRows?.length) parts.push(`${mustRows.length} Must: ${names(mustRows)}`);
  if (wantRows?.length) parts.push(`${wantRows.length} Want: ${names(wantRows)}`);
  return parts.length ? parts.join(" · ") : "No Must or Want players";
}

function parseWhole(text, min, max, fallback) {
  const t = String(text ?? "").trim();
  if (t === "") return fallback;
  const n = Number(t);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function buildCashSettings(state, { locks = [], excludes = [], avoidGames = [] } = {}) {
  return {
    mode: "cash",
    count: parseWhole(state?.count, 1, MAX_COUNT, Number(CASH_DEFAULTS_BROWSER.count)),
    maxPerTeam: parseWhole(state?.maxPerTeam, 1, MAX_PER_TEAM, null),
    locks: [...locks].map(String),
    excludes: [...excludes].map(String),
    avoidGames: [...avoidGames],
  };
}

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function boardHasMedians(rows) {
  return (rows ?? []).some((r) => finite(r?.tg?.median) !== null);
}

/** One row's score under the basis: tg.median for "median" (0 for an out row, as the engine's cash.js medianOf scores him), proj for "proj"; null when it has none. */
export function scoreOfRow(row, basis) {
  if (basis !== "median") return finite(row?.proj);
  const median = finite(row?.tg?.median);
  return median !== null && rowIsOut(row) ? 0 : median;
}

const rowFrom = (rowsById, id) => (rowsById instanceof Map ? rowsById.get(String(id)) : rowsById?.[String(id)]);
const lineupIds = (lineup) => ((lineup?.players ?? []).length ? lineup.players.map((p) => String(p.id)) : (lineup?.ids ?? []).map(String));
const bySalaryDesc = (a, b) => (b.salary ?? 0) - (a.salary ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? "")) || String(a.id).localeCompare(String(b.id));

export function poolReport(lineup, wantIds, rowsById) {
  const inLineup = new Set(lineupIds(lineup));
  const seen = new Set();
  const report = { inLineup: [], excluded: [] };
  for (const raw of wantIds ?? []) {
    const id = String(raw);
    if (seen.has(id)) continue;
    seen.add(id);
    const row = rowFrom(rowsById, id);
    if (!row) continue;
    (inLineup.has(id) ? report.inLineup : report.excluded).push(row);
  }
  report.inLineup.sort(bySalaryDesc);
  report.excluded.sort(bySalaryDesc);
  return report;
}

// The server assigns slots itself (no RULES.md entry; Cash 3b fix round 2, 2026-10-17), so a nine is legal exactly when it has one QB, one DST, at least 2 RB, 3 WR and 1 TE (the spare sits in FLEX).
function legalPositions(poss) {
  const n = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
  for (const p of poss) if (p in n) n[p] += 1;
  return poss.length === SLOT_COUNT && n.QB === 1 && n.DST === 1 && n.RB >= 2 && n.WR >= 3 && n.TE >= 1;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const upper = (v) => String(v ?? "").toUpperCase();
const idKey = (list) => list.map((x) => String(x.id)).sort().join("|");
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// The one tie-break for equal scores (here and in the final order): the signed salary change, then an id key last.
const tieKey = (d) => `${idKey(d.in)}/${idKey(d.out)}`;
const tieBreak = (a, b) => (a.salaryDelta ?? 0) - (b.salaryDelta ?? 0) || byText(tieKey(a), tieKey(b));

/** The cheapest ways to bring the Want players who are not in this lineup in. basis is "median" or "proj". A decision is
 *  {kind: "1for1"|"2for2"|"none", out: [lineup players with .score], in: [board rows], salaryDelta, scoreDelta, basis}, with both
 *  deltas as in minus out (a sacrifice is negative); ordered cheapest sacrifice first. A Want with no 1-for-1 gets the best 2-for-2
 *  with ANY other board player not in the lineup, not excluded, not out and scored. A swap is refused when it moves a lockedIds
 *  (Must) player, breaks the cap, leaves a team over maxPerTeam (every team) or brings in a player from an avoidGames game.
 *  onScan(wantId), for tests only, is called once per search of the board for one Want. */
export function wantSwaps(lineup, wantIds, rows, { basis = "proj", cap = SALARY_CAP, excludedIds = [], lockedIds = [], maxPerTeam = null, avoidGames = [], onScan = null } = {}) {
  const board = rows ?? [];
  const byId = new Map(board.map((r) => [String(r.id), r]));
  const excluded = new Set((excludedIds ?? []).map(String));
  const locked = new Set((lockedIds ?? []).map(String));
  const avoided = new Set((avoidGames ?? []).map(upper));
  const teamCap = parseWhole(maxPerTeam, 1, MAX_PER_TEAM, null); // Cash fix round 2, 2026-10-17: the state's text "3" caps like 3, as buildCashSettings sends it
  const players = (lineup?.players ?? []).map((p) => {
    const row = byId.get(String(p.id));
    const own = finite(basis === "median" ? p.median : p.proj);
    return { ...p, score: own ?? scoreOfRow(row, basis), salary: finite(p.salary) ?? finite(row?.salary), team: upper(p.team ?? row?.team) };
  });
  if (players.length !== SLOT_COUNT || players.some((p) => p.salary === null)) return [];
  const total = players.reduce((s, p) => s + p.salary, 0);
  const inIds = new Set(players.map((p) => String(p.id)));
  const wants = [];
  const seen = new Set();
  for (const raw of wantIds ?? []) {
    const id = String(raw);
    const row = byId.get(id);
    if (seen.has(id) || !row || inIds.has(id) || excluded.has(id)) continue;
    seen.add(id);
    wants.push(row);
  }
  const whyNot = (r, ignoreAvoid = false) => {
    if (rowIsOut(r)) return "he is out";
    if (finite(r.salary) === null) return "no salary on the board";
    if (!ignoreAvoid && r.gameId && avoided.has(upper(r.gameId))) return "he is in an avoided game";
    if (scoreOfRow(r, basis) === null) return basis === "median" ? "no TwoGun median for him" : "no projection for him";
    return null;
  };
  const ready = wants.filter((w) => whyNot(w) === null);
  const partners = board.filter((r) => !inIds.has(String(r.id)) && !excluded.has(String(r.id)) && whyNot(r) === null);
  const partnersAnyGame = board.filter((r) => !inIds.has(String(r.id)) && !excluded.has(String(r.id)) && whyNot(r, true) === null);
  const decisions = [];
  const none = (w, reason) => decisions.push({ kind: "none", out: [], in: [w], salaryDelta: null, scoreDelta: null, basis, reason });
  for (const w of wants) if (whyNot(w) !== null) none(w, whyNot(w));

  const best = (rowsIn, { ignoreLocks = false, ignoreTeam = false, tags = null } = {}) => {
    const add = [...rowsIn].sort((a, b) => byText(String(a.id), String(b.id))); // the card lists them in id order, never the Want list's
    let pick = null;
    const addSal = add.reduce((s, r) => s + r.salary, 0);
    const addScore = add.reduce((s, r) => s + scoreOfRow(r, basis), 0);
    const addAvoided = add.some((r) => r.gameId && avoided.has(upper(r.gameId)));
    const consider = (outs) => {
      if (tags?.done || outs.some((p) => p.score === null)) return;
      const movesMust = outs.some((p) => locked.has(String(p.id)));
      if (movesMust && !ignoreLocks) return;
      const salaryDelta = addSal - outs.reduce((s, p) => s + p.salary, 0);
      if (total + salaryDelta > cap) return;
      const rest = players.filter((p) => !outs.includes(p));
      if (!legalPositions(rest.map((p) => p.pos).concat(add.map((r) => r.pos)))) return;
      let overTeam = false;
      if (teamCap !== null && (!ignoreTeam || tags)) {
        const counts = new Map();
        for (const team of rest.map((p) => p.team).concat(add.map((r) => upper(r.team)))) if (team) counts.set(team, (counts.get(team) ?? 0) + 1);
        overTeam = [...counts.values()].some((n) => n > teamCap);
        if (overTeam && !ignoreTeam) return;
      }
      if (tags) { // Cash fix round 4, 2026-10-17: the reason search tags each fit with the limits it breaks (1 team, 2 avoided game, 4 Must)
        tags.least = Math.min(tags.least, (overTeam ? 1 : 0) | (addAvoided ? 2 : 0) | (movesMust ? 4 : 0));
        tags.done = tags.least === tags.goal;
        return;
      }
      const cost = round6(outs.reduce((s, p) => s + p.score, 0) - addScore);
      const key = idKey(outs);
      if (!pick || cost < pick.cost || (cost === pick.cost && (salaryDelta < pick.salaryDelta || (salaryDelta === pick.salaryDelta && key < pick.key)))) pick = { outs, cost, salaryDelta, key };
    };
    if (add.length === 1) for (const p of players) consider([p]);
    else for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) consider([players[i], players[j]]);
    return pick && { kind: add.length === 1 ? "1for1" : "2for2", out: pick.outs, in: add, salaryDelta: pick.salaryDelta, scoreDelta: 0 - pick.cost, basis };
  };
  const bestFor = (w, opts = {}) => {
    onScan?.(String(w.id));
    const one = best([w], opts);
    if (one) return one;
    // Cash fix round 2, 2026-10-17: skip a partner no out pair can make room for or whose best case cannot beat the pick so far (same pick as the full search).
    const outs = players.filter((p) => p.score !== null && (opts.ignoreLocks || !locked.has(String(p.id))));
    if (outs.length < 2) return null;
    const sal = outs.map((p) => p.salary).sort((a, b) => b - a);
    const low = outs.map((p) => p.score).sort((a, b) => a - b);
    const room = cap - total + sal[0] + sal[1];
    const upside = scoreOfRow(w, basis) - low[0] - low[1];
    let two = null;
    for (const x of opts.ignoreAvoid ? partnersAnyGame : partners) {
      if (opts.tags?.done) break;
      if (String(x.id) === String(w.id) || w.salary + x.salary > room) continue;
      if (two && upside + scoreOfRow(x, basis) + 1e-6 < two.scoreDelta) continue;
      const d = best([w, x], opts);
      if (d && (!two || d.scoreDelta > two.scoreDelta || (d.scoreDelta === two.scoreDelta && tieBreak(d, two) < 0))) two = d;
    }
    return two;
  };
  // Cash fix round 2, 2026-10-17: name the limit that stops the swap; the cap sentence only when nothing but the cap is left.
  // Cash fix round 3, 2026-10-17: every limit the swap needs is named.
  // Cash fix round 4, 2026-10-17: one all-relaxed search after the base one; the least tag in the order team, avoided, both, Must, Must and team,
  // Must and avoided, all three (round 3's order) picks the sentence, so the worst case is two scans.
  const whyNoSwap = (w) => {
    const set = (teamCap !== null ? 1 : 0) | (avoided.size > 0 ? 2 : 0) | (locked.size > 0 ? 4 : 0);
    if (set === 0) return SWAP_LIMIT_TEXT; // nothing to relax, and the base search already failed
    const tags = { least: 8, goal: set & -set, done: false };
    bestFor(w, { ignoreTeam: true, ignoreAvoid: true, ignoreLocks: true, tags });
    if (tags.least === 8) return SWAP_LIMIT_TEXT;
    const parts = [tags.least & 4 && "moving a Must player", tags.least & 1 && `going over ${teamCap} players from one team`, tags.least & 2 && "bringing in a player from an avoided game"].filter(Boolean);
    return `${SWAP_LIMIT_TEXT} without ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}`;
  };

  for (const w of ready) {
    const d = bestFor(w);
    if (d) decisions.push(d);
    else none(w, whyNoSwap(w));
  }
  for (let i = 0; i < ready.length; i++) for (let j = i + 1; j < ready.length; j++) {
    const d = best([ready[i], ready[j]]);
    if (d) decisions.push(d);
  }
  const unique = [...new Map(decisions.map((d) => [`${d.kind}:${idKey(d.in)}`, d])).values()];
  const rank = (d) => (d.kind === "none" ? 1 : 0);
  return unique.sort((a, b) => rank(a) - rank(b) || (b.scoreDelta ?? 0) - (a.scoreDelta ?? 0) || (a.kind === "1for1" ? 0 : 1) - (b.kind === "1for1" ? 0 : 1) || tieBreak(a, b));
}

const signedMoney = (n) => `${n < 0 ? MINUS : n > 0 ? "+" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const signedScore = (n) => {
  const v = Math.round(n * 10) / 10;
  return `${v < 0 ? MINUS : v > 0 ? "+" : ""}${Math.abs(v).toFixed(1)}`;
};
const scoreWord = (basis) => (basis === "median" ? "median" : "proj");

/** One swap decision's markup. Cash 3b fix round, 2026-10-17: `button` false leaves the "Make them Must" button off (a cash
 *  card shown in GPP); `disabled` greys it while a build or a save runs. */
export function swapDecisionHtml(decision, index = 0, { button = true, disabled = false } = {}) {
  const side = (title, list, scoreFor) =>
    `<div class="cash-swap-side"><div class="cash-swap-title">${title}</div><ul class="cash-swap-list">${list
      .map((p) => {
        const score = scoreFor(p);
        const figure = score === null ? "—" : `${dec1(score)} ${scoreWord(decision.basis)}`;
        // 👁 fix round, 2026-10-17: each player is a fixed two-line block, the name and position over the price and the figure.
        // Layout round 2, 2026-10-17: the title carries all of it, since a narrow side can cut either line with an ellipsis.
        return `<li class="cash-swap-player" title="${escapeHtml(`${p.name ?? ""} ${p.pos ?? ""} · ${money(p.salary)} · ${figure}`)}"${p.id != null ? ` data-card-id="${escapeHtml(String(p.id))}"` : ""}><span class="cash-swap-line1"><span class="cash-swap-name">${escapeHtml(p.name ?? "")}</span> <span class="pos-mini">${escapeHtml(p.pos ?? "")}</span></span> <span class="cash-swap-line2"><span class="cash-swap-salary">${money(p.salary)}</span> · <span class="cash-swap-score">${figure}</span></span></li>`;
      })
      .join("")}</ul></div>`;
  if (decision.kind === "none") {
    const w = decision.in?.[0] ?? {};
    return `<div class="cash-swap cash-swap-none">${escapeHtml(w.name ?? "")} cannot be fitted: ${escapeHtml(decision.reason ?? SWAP_LIMIT_TEXT)}.</div>`;
  }
  const middle = `${signedMoney(decision.salaryDelta)} · ${signedScore(decision.scoreDelta)} ${scoreWord(decision.basis)}`;
  return `<div class="cash-swap cash-swap-${decision.kind}">${side("Out", decision.out, (p) => finite(p.score))}<div class="cash-swap-mid">${escapeHtml(middle)}</div>${side("In", decision.in, (r) => scoreOfRow(r, decision.basis))}${button ? `<button type="button" class="lineup-row-btn cash-swap-btn" data-cash-swap="${Number(index)}"${disabled ? " disabled" : ""}>Make them Must and rebuild</button>` : ""}</div>`;
}

export function excludedListHtml(report) {
  if (!report?.excluded?.length) return report?.inLineup?.length ? `<div class="cash-excluded">Every Want is in this lineup</div>` : "";
  return `<div class="cash-excluded">Not in this lineup: ${report.excluded.map((r) => escapeHtml(r.name ?? "")).join(", ")}</div>`;
}

/** "$49,600 · 118.4 median · 121.2 proj · 34% own"; the median part only on a median build; a dash and the reason when any player lacks a figure. */
export function cashTotalsText(lineup, basis) {
  const players = lineup?.players ?? [];
  const parts = [money(lineup?.salary)];
  if (basis === "median") {
    const meds = players.map((p) => p.median);
    const allMed = meds.length > 0 && meds.every((m) => finite(m) !== null);
    const sum = lineup?.median === null ? null : allMed ? shownTotal(meds) : finite(lineup?.median);
    parts.push(sum === null ? "— median (a player has no TwoGun median)" : `${dec1(sum)} median`);
  }
  const projs = players.map((p) => p.proj);
  const allProj = projs.length > 0 && projs.every((v) => finite(v) !== null);
  const proj = projs.length === 0 ? finite(lineup?.proj) : allProj ? shownTotal(projs) : null;
  parts.push(proj === null ? (projs.length === 0 ? "— proj" : "— proj (a player has no projection)") : `${dec1(proj)} proj`);
  const allOwn = players.length > 0 && players.every((p) => finite(p.own) !== null);
  const own = allOwn ? players.reduce((s, p) => s + p.own, 0) : finite(lineup?.own);
  parts.push(own === null ? "— own" : `${Math.round(own)}% own`);
  return parts.join(" · ");
}

export function unusedCapText(salary, cap = SALARY_CAP) {
  const left = finite(salary) === null ? 0 : cap - salary;
  return left > UNUSED_CAP_WARN ? `${money(left)} unused` : "";
}

export function cashBadgeHtml() {
  return `<span class="saved-lineup-badge saved-lineup-badge-cash">$ Cash</span>`;
}

export function builtInTextCash(count, basis, boardMode) {
  const n = Number(count);
  return `${n} lineup${n === 1 ? "" : "s"} from the last Build (Cash, ${boardMode === "twogun" ? "TwoGun" : "current"} mode, by ${basis === "median" ? "TwoGun's median" : "projection"})`;
}
