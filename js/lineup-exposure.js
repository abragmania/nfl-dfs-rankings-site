// The Optimizer's exposure table (optimizer standard A10, round 5): ONE table per optimizer over a set of lineups (lineup.js draws and re-draws it), sortable by every column, with a `Pos` filter
// (`Seat` in Showdown, whose men have a `CPT` and a `FLEX` column, counted apart and never summed). It replaces classic's five boxes, one per position, and Showdown's two tables. A man's
// name opens his player card (A7) and the small `Filter` button beside it is the only-lineups-with filter. The sort and the filter are the optimizer's page state (`opt.exp`, kept in the browser
// by memory.js, A9). Pure helpers first (tests/exposure-table.test.mjs), then the markup.
import { escapeHtml, pct1 } from "./format.js";
import { store } from "./state.js";
import { playerLineHtml, matchupPillHtml, posChipHtml } from "./player-row.js";
import { pickButtonHtml } from "./lineup-filter.js";

export const OPT_POSITIONS = ["QB", "RB", "WR", "TE", "DST"];
export const SEAT_FILTERS = ["CPT", "FLEX"];

let lookupBoard = null;
let lookup = new Map();
function liveRowFor(e) {
  const board = store.get().board;
  if (board !== lookupBoard) {
    lookupBoard = board;
    lookup = new Map((board?.rows ?? []).map((r) => [String(r.id), r]));
  }
  const row = e.id != null ? lookup.get(String(e.id)) : null;
  return row ? { ...e, ...row } : e;
}

/** A percent as a number of lineups of the batch, rounded up like the server's pctToLineups (0 is 0). */
export function exposureLimit(pct, asked) {
  if (!(pct > 0)) return 0;
  return Math.ceil((pct / 100) * asked - 1e-9);
}

/** A Min % as lineups, rounded down like the server's minLineups (PROJECT.md Part 4 Optimizer (Min % and soft rules, Adam 2026-10-17)); NaN, never
 *  0, when `asked` is no whole number of lineups, so a check sized by it fails closed (lineup.js MIN_COUNT_PROBLEM). */
export function minLimit(pct, asked) {
  if (!(pct > 0)) return 0;
  if (!Number.isInteger(asked) || asked < 1) return NaN;
  return Math.floor((pct / 100) * asked + 1e-9);
}

/** {kind: "under" | "over", title} for a new-batch row outside his Min % / Max %, else null; `marks` = {asked, min: {id: pct},
 *  max: {id: pct}} from the Go that made the batch (PROJECT.md Part 4 Optimizer (Min % and soft rules, Adam 2026-10-17)). */
export function exposureMark(row, marks, keyOf = null) {
  if (!marks || row?.id == null) return null;
  // keyOf (Showdown): a role-aware key, e.g. "cpt:<id>" / "flex:<id>", so one man as Captain and as FLEX are two marks; none = the id, as classic.
  const id = String(keyOf ? keyOf(row) : row.id);
  const count = row.count ?? 0;
  const min = marks.min?.[id] === undefined ? null : minLimit(marks.min[id], marks.asked);
  const max = marks.max?.[id] === undefined ? null : exposureLimit(marks.max[id], marks.asked);
  if (min !== null && count < min) return { kind: "under", title: `under his Min % (${count} of ${min})` };
  if (max !== null && count > max) return { kind: "over", title: `over his Max % (${count} of ${max})` };
  return null;
}

/** `exposure` plus a zero-count row for each player with a Min of a lineup or more who is in no lineup. `playerOf(id)` gives
 *  {name, pos, team, opp, own} or null; `inBatch(id)` says whether any lineup holds him (by his DraftKings identity). */
export function zeroMinRows(exposure, marks, playerOf, inBatch) {
  const out = Object.fromEntries(OPT_POSITIONS.map((p) => [p, [...(Array.isArray(exposure?.[p]) ? exposure[p] : [])]]));
  for (const [id, pct] of Object.entries(marks?.min ?? {})) {
    const p = playerOf(id);
    if (!(minLimit(pct, marks.asked) > 0) || !p || !out[p.pos] || inBatch(id)) continue;
    out[p.pos].push({ id: String(id), name: p.name, team: p.team ?? null, opp: p.opp ?? "", own: p.own ?? null, count: 0, pct: 0 });
  }
  return out;
}

// ---------- the table: columns, sort, filter (pure) ----------

const posRank = (pos) => {
  const i = OPT_POSITIONS.indexOf(String(pos ?? "").toUpperCase());
  return i === -1 ? OPT_POSITIONS.length : i;
};
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The columns of the one table, by kind: "classic" (Exposure, Player, Pos, Matchup, Own) or "seats" (Showdown: CPT, FLEX, Player, Pos, Own, CPT Own). `sort(e)` is the value a column sorts by (null sorts last
 * whichever way), `dir` the direction its first click takes. An entry is {id, name, pos, team, opp, own, count, pct} (classic) or {id, name, pos, team, own, ownCpt, cpt: {count, pct, key} | null,
 * flex: {...} | null} (seats).
 */
export function expColumns(kind) {
  if (kind === "seats") {
    return [
      { key: "cpt", label: "CPT", dir: "desc", gold: true, sort: (e) => num(e.cpt?.pct), then: (e) => num(e.flex?.pct) },
      { key: "flex", label: "FLEX", dir: "desc", sort: (e) => num(e.flex?.pct), then: (e) => num(e.cpt?.pct) },
      { key: "player", label: "Player", dir: "asc", sort: (e) => String(e.name ?? "") },
      { key: "pos", label: "Pos", dir: "asc", sort: (e) => posRank(e.pos) },
      { key: "own", label: "Own", dir: "desc", sort: (e) => num(e.own) },
      { key: "ownCpt", label: "CPT Own", dir: "desc", gold: true, sort: (e) => num(e.ownCpt) },
    ];
  }
  return [
    { key: "pct", label: "Exposure", dir: "desc", sort: (e) => num(e.pct), then: (e) => num(e.count) },
    { key: "player", label: "Player", dir: "asc", sort: (e) => String(e.name ?? "") },
    { key: "pos", label: "Pos", dir: "asc", sort: (e) => posRank(e.pos) },
    { key: "opp", label: "Matchup", dir: "asc", sort: (e) => (e.opp ? String(e.opp) : null) },
    { key: "own", label: "Own", dir: "desc", sort: (e) => num(e.own) },
  ];
}

/** The sort and filter the table starts with (and Clear returns it to): highest exposure first, every position or seat. */
export const defaultExpState = (kind) => ({ col: kind === "seats" ? "flex" : "pct", dir: "desc", filter: "All" });

/** A remembered or half-made state made safe: a column that is not one of `kind`'s, a bad direction or a filter that is not offered goes back to the default; never throws. */
export function cleanExpState(raw, kind) {
  const d = defaultExpState(kind);
  const cols = expColumns(kind);
  const known = cols.some((c) => c.key === raw?.col);
  const col = known ? raw.col : d.col;
  const dir = known && (raw.dir === "asc" || raw.dir === "desc") ? raw.dir : cols.find((c) => c.key === col).dir; // a direction left over from a column that is gone is not kept
  const options = kind === "seats" ? SEAT_FILTERS : OPT_POSITIONS;
  return { col, dir, filter: options.includes(raw?.filter) ? raw.filter : "All" };
}

/** The state a header click leaves: the same column flips its direction, another starts in its own first direction. */
export function nextExpSort(state, col, kind) {
  if (state.col === col) return { ...state, dir: state.dir === "asc" ? "desc" : "asc" };
  return { ...state, col, dir: expColumns(kind).find((c) => c.key === col)?.dir ?? "desc" };
}

/** The entries the filter keeps: a position (classic) or a seat (Showdown: the men who sit in it in some lineup). */
export function filterExposure(entries, filter, kind) {
  if (filter === "All" || !filter) return entries;
  if (kind === "seats") return entries.filter((e) => (filter === "CPT" ? e.cpt : e.flex));
  return entries.filter((e) => String(e.pos ?? "").toUpperCase() === filter);
}

/** The entries in the order of `state` (a blank always last, whichever way; ties by the column's second figure, then by name), a new array. */
export function sortExposureEntries(entries, state, kind) {
  const col = expColumns(kind).find((c) => c.key === state.col) ?? expColumns(kind)[0];
  const sign = state.dir === "asc" ? 1 : -1;
  const value = (e) => col.sort(e);
  const nameOf = (e) => String(e.name ?? "");
  return [...entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const va = value(a.e);
      const vb = value(b.e);
      if (va === null && vb === null) return nameOf(a.e).localeCompare(nameOf(b.e)) || a.i - b.i;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      if (cmp !== 0) return sign * cmp;
      if (col.then) {
        const ta = col.then(a.e) ?? -1;
        const tb = col.then(b.e) ?? -1;
        if (ta !== tb) return sign * (ta - tb);
      }
      return nameOf(a.e).localeCompare(nameOf(b.e)) || a.i - b.i;
    })
    .map((x) => x.e);
}

/** Classic's entries: the per-position lists of exposureOfLineups, one flat list, each carrying his position. */
export function classicEntries(exposure) {
  return OPT_POSITIONS.flatMap((pos) => (Array.isArray(exposure?.[pos]) ? exposure[pos] : []).map((e) => ({ ...e, pos })));
}

/** Showdown's entries: one per man, with his CPT and FLEX figures (from exposureTables' two lists {person, name, count, pct, own}; `rowOf(person)` gives his board row for position and team). */
export function seatEntries(tables, rowOf = () => null) {
  const byPerson = new Map();
  const at = (e, seat) => {
    // Ownership is the board row's published figure (FLEX and Captain), whichever seat he is in in the lineups, unless the lineups' own figure (e.own) says better: a man in only one seat still has both.
    const row = rowOf(e.person) ?? {};
    const hit = byPerson.get(e.person) ?? { ...row, id: e.person, name: e.name, own: row.ownFlex ?? null, ownCpt: row.ownCpt ?? null, cpt: null, flex: null };
    hit.name = e.name ?? hit.name;
    hit[seat === "cpt" ? "cpt" : "flex"] = { count: e.count, pct: e.pct, key: `${seat}:${e.person}` };
    if (e.own != null) hit[seat === "cpt" ? "ownCpt" : "own"] = e.own;
    byPerson.set(e.person, hit);
  };
  for (const e of tables?.cpt ?? []) at(e, "cpt");
  for (const e of tables?.flex ?? []) at(e, "flex");
  return [...byPerson.values()];
}

// ---------- the markup ----------

const pctText = (pct, count) => `${escapeHtml(String(Math.round(pct ?? 0)))}% <span class="opt-exp-count">(${escapeHtml(String(count ?? 0))})</span>`;

/**
 * The one exposure table. `entries`: classicEntries(...) or seatEntries(...) (`kind` "classic" or "seats"); `state`: {col, dir, filter}; `pick` = {isChosen(key)} gives each man a Filter button (the
 * key is his id, or his role-aware key in Showdown); `marks`: the batch's Min / Max marks (exposureMark; none for saved lineups or a filtered batch); `opts` = {title, subtitle, posHtml (Showdown's
 * coloured position pill), hideCols (column keys left out: Showdown's lists carry no matchup)}.
 */
export function optExposureHtml(entries, state, kind, pick = null, marks = null, opts = {}) {
  const st = cleanExpState(state, kind);
  const cols = expColumns(kind).filter((c) => !(opts.hideCols ?? []).includes(c.key));
  const shown = sortExposureEntries(filterExposure(entries ?? [], st.filter, kind), st, kind);
  const head = cols
    .map((c) => {
      const active = st.col === c.key;
      const arrow = active ? (st.dir === "asc" ? " ▲" : " ▼") : "";
      return `<th class="sortable${active ? " sorted" : ""} opt-exp-${c.key}${c.gold ? " sd-cpt-col" : ""}" data-action="opt-exp-sort" data-col="${c.key}" aria-sort="${active ? (st.dir === "asc" ? "ascending" : "descending") : "none"}">${escapeHtml(c.label)}${arrow}</th>`;
    })
    .join("");
  const filterBtn = (key, name) => (pick && key != null ? pickButtonHtml({ id: key, name, chosen: pick.isChosen(key), cls: "opt-filter-btn", innerHtml: "Filter" }) : "");
  const cell = {
    pct: (e) => {
      const mark = exposureMark(e, marks, null);
      return `<td class="opt-exp-pct"${mark ? ` title="${escapeHtml(mark.title)}"` : ""}>${pctText(e.pct, e.count)}</td>`;
    },
    cpt: (e) => seatCell(e, "cpt"),
    flex: (e) => seatCell(e, "flex"),
    player: (e) => {
      const live = kind === "classic" ? liveRowFor(e) : e; // a Showdown entry already carries the game's board row (seatEntries); the classic board's rows are another list
      const cardId = e.cardId ?? e.id;
      return `<td class="opt-exp-name"${cardId != null ? ` data-card-id="${escapeHtml(String(cardId))}"` : ""}><span class="player-cell">${playerLineHtml(live, { nameHtml: undefined, pill: false, tag: "out" })}${kind === "classic" ? filterBtn(e.id, e.name ?? "") : ""}</span></td>`;
    },
    pos: (e) => `<td class="opt-exp-pos">${posChipHtml(e.pos, opts.posHtml ?? null)}</td>`,
    opp: (e) => `<td class="opt-exp-opp">${matchupPillHtml(liveRowFor(e))}</td>`,
    own: (e) => `<td class="opt-exp-own">${escapeHtml(pct1(e.own) ?? "—")}</td>`,
    ownCpt: (e) => `<td class="opt-exp-own sd-cpt-col">${escapeHtml(pct1(e.ownCpt) ?? "—")}</td>`,
  };
  // A seat's cell: his exposure there, a Min / Max mark on it, and that seat's Filter button; a dash where he never sits.
  function seatCell(e, seat) {
    const s = e[seat];
    if (!s) return `<td class="opt-exp-pct opt-exp-none${seat === "cpt" ? " sd-cpt-col" : ""}">—</td>`;
    const mark = exposureMark({ id: s.key, count: s.count }, marks, null);
    return `<td class="opt-exp-pct${seat === "cpt" ? " sd-cpt-col" : ""}${mark ? " exp-off" : ""}"${mark ? ` title="${escapeHtml(mark.title)}"` : ""}>${pctText(s.pct, s.count)}${filterBtn(s.key, `${e.name ?? ""} (${seat === "cpt" ? "CPT" : "FLEX"})`)}</td>`;
  }
  const body = shown.length
    ? `<table class="opt-exp-table"><thead><tr>${head}</tr></thead><tbody>${shown
        .map((e) => {
          const mark = kind === "classic" ? exposureMark(e, marks, null) : null;
          return `<tr class="opt-exp-row${mark ? " exp-off" : ""}">${cols.map((c) => cell[c.key](e)).join("")}</tr>`;
        })
        .join("")}</tbody></table>`
    : `<div class="opt-exp-empty">None</div>`;
  const options = kind === "seats" ? SEAT_FILTERS : OPT_POSITIONS;
  const chip = (value) => `<button type="button" class="chip pos-chip opt-exp-chip${st.filter === value ? " active" : ""}" data-action="opt-exp-filter" data-filter="${value}" aria-pressed="${st.filter === value}">${value}</button>`;
  const filter = `<span class="opt-exp-filter" role="group" aria-label="${kind === "seats" ? "Seat" : "Pos"} filter"><span class="opt-exp-filter-label">${kind === "seats" ? "Seat" : "Pos"}</span>${["All", ...options].map(chip).join("")}</span>`;
  const sub = opts.subtitle ? ` <span class="opt-sub">${escapeHtml(String(opts.subtitle))}</span>` : "";
  return `
    <div class="opt-exposure">
      <div class="opt-exp-head"><h3 class="opt-title">${escapeHtml(opts.title ?? "Exposure")}${sub}</h3>${filter}</div>
      <div class="opt-exp-box">${body}</div>
    </div>`;
}
