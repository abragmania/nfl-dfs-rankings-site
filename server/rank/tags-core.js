// Player tags, the part that needs no file: computeTags and its helpers. Pure (no node modules, no file reads), so
// the public site can run it in the visitor's browser (DECISIONS.md D71). tags.js keeps matchFindingsTags (it reads
// the name aliases through match.js) and re-exports everything here, so every existing caller is unchanged.
//
// Two origins, never mixed for one player:
//   1. The weekly findings file (PROJECT.md D19, D9): a researched tag with its reason, outlet and link. These
//      win - a human's reason beats a threshold - with two exceptions Adam ruled on: a researcher's "chalk" label
//      is dropped when the player has a real ownership number under the chalk line, and a researcher's "value"
//      label is dropped when the player's projection is under 3.0 DraftKings points (PROJECT.md D42: a player
//      projected under 3.0 never shows a value tag, whoever wrote it). A number beats a label.
//   2. Computed tags, for players the research did not mention: "chalk" and "value", each carrying a reason that
//      states the numbers it fired on, sourced as "computed".
// PROJECT.md D36 (Adam's ruling): the app does not identify sleeper plays at all. Nothing computes one, and a
// findings-file tag of "sleeper play" is ignored as if it were not in the file: it is never shown and it never
// stops the player earning a computed tag. An older findings file that carries such tags still loads.
// PROJECT.md D11: "Sleeper" on its own is the fantasy platform, whose label everywhere in this app is
// "Sleeper app"; it has nothing to do with the ignored tag.
import { toNumber, DEFAULT_RANK_CONFIG } from "./value-core.js";

/** The findings tag the app ignores (D36). Kept as a name so the one place that drops it says what it drops. */
export const SLEEPER_PLAY = "sleeper play";

/** D42: the projection floor under which no value tag shows, researched or computed. */
export const VALUE_MIN_PROJ = 3;

/**
 * Lower-cases and trims a tag, with hyphens, underscores and runs of spaces read as one space. Findings files have
 * spelled the ignored tag "sleeper", "sleeper play" and "sleeper plays"; "sleeper-play" and "sleepers" count too.
 */
export function normaliseTag(tag) {
  const t = String(tag ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!t) return "";
  if (/^sleepers?( plays?)?$/.test(t)) return SLEEPER_PLAY;
  return t;
}

/**
 * Linear-interpolated percentile (p between 0 and 1) of a numeric list. Returns null for an empty list.
 * Non-numbers are dropped by toNumber() first: a null must never arrive here as the 0 that Number(null) makes
 * of it, or a slate full of unprojected players drags every percentile down.
 */
export function percentile(values, p) {
  const list = (values ?? []).map(toNumber).filter((v) => v !== null).sort((a, b) => a - b);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const idx = p * (list.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return list[lo] + (list[hi] - list[lo]) * (idx - lo);
}

const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n) => `${n >= 10 ? n.toFixed(0) : n.toFixed(1)}%`;

/**
 * Tags for every row.
 * rows        - board rows carrying { id, pos, salary, own, override, proj, value, status, flags }.
 * findingsTags - Map player id -> [tag objects] from matchFindingsTags().
 * config      - { chalkMinOwn, valueMinPtsPerK } (server/rank/value.js loadRankConfig()).
 * Returns Map id -> tag array (empty array when the player has none).
 */
export function computeTags(rows, { findingsTags = new Map(), config = {} } = {}) {
  const chalkMinOwn = toNumber(config.chalkMinOwn) ?? DEFAULT_RANK_CONFIG.chalkMinOwn;
  const valueMinPtsPerK = toNumber(config.valueMinPtsPerK) ?? DEFAULT_RANK_CONFIG.valueMinPtsPerK;
  const list = rows ?? [];

  const salariesByPos = new Map();
  for (const r of list) {
    const salary = toNumber(r.salary);
    if (salary === null) continue;
    if (!salariesByPos.has(r.pos)) salariesByPos.set(r.pos, []);
    salariesByPos.get(r.pos).push(salary);
  }
  const medianSalary = new Map();
  for (const [pos, salaries] of salariesByPos) medianSalary.set(pos, percentile(salaries, 0.5));

  const out = new Map();
  for (const row of list) {
    // A findings "sleeper play" tag is ignored outright (D36), as if the file never carried it.
    // Findings tags win, with two exceptions (Adam's rulings): a researcher's "chalk" label is dropped when the
    // player has a real ownership number (published, or Adam's override) under chalkMinOwn - 6.6% owned is not
    // chalk whoever called it that - and a researcher's "value" label is dropped when the player's projection
    // is under 3.0 DraftKings points (D42: a player projected under 3.0 is a punt and never shows a value tag,
    // whoever wrote it). With no ownership number, or no projection, nothing contradicts the label, so it
    // stays. Every other findings tag is kept whatever the numbers say. A player whose only findings tag was
    // dropped is then treated like any untagged player, so he can still earn a computed tag on the numbers.
    const found = findingsTags.get?.(row.id) ?? findingsTags[row.id];
    const ownForLabel = toNumber(row.own);
    const projForLabel = toNumber(row.proj);
    const kept = (found ?? []).filter((t) => {
      const name = normaliseTag(t.tag);
      if (name === SLEEPER_PLAY) return false;
      if (name === "chalk" && ownForLabel !== null && ownForLabel < chalkMinOwn) return false;
      if (name === "value" && projForLabel !== null && projForLabel < VALUE_MIN_PROJ) return false;
      return true;
    });
    if (kept.length) {
      out.set(row.id, kept.map((t) => ({ ...t })));
      continue;
    }
    // toNumber, never Number(): a null ownership or a null value must not become 0 and fire a tag (D27 - a
    // player nobody projects is blank, not the worst player on the slate).
    const tags = [];
    const own = toNumber(row.own);
    const proj = toNumber(row.proj);
    const value = toNumber(row.value);
    const salary = toNumber(row.salary);
    // An ownership number on a row is either published by a named source or typed in by Adam (D28); the board
    // carries no other kind, and a row with neither has own null, so "chalk" cannot fire.
    const overridden = toNumber(row.override?.own) !== null;
    const ownWord = overridden ? "Overridden" : "Quoted";
    const valueWord = value !== null ? `${value.toFixed(1)} pts per $1k` : "no projection";

    if (own !== null && own >= chalkMinOwn) {
      tags.push({
        tag: "chalk",
        reason: `${ownWord} ${pct(own)} owned, at or above the ${chalkMinOwn}% chalk line${value !== null ? `, ${valueWord}` : ""}.`,
        source: "computed",
        url: null,
        kind: "computed"
      });
    }
    const median = medianSalary.get(row.pos);
    // D42: Value tag requires proj >= 3.0; a player projected under 3.0 is a punt and never gets a value signal.
    if (value !== null && proj !== null && proj >= VALUE_MIN_PROJ && value >= valueMinPtsPerK && salary !== null && median !== null && median !== undefined && salary <= median) {
      tags.push({
        tag: "value",
        reason: `${valueWord} at ${money(salary)}, at or below the ${row.pos} median salary of ${money(median)}.`,
        source: "computed",
        url: null,
        kind: "computed"
      });
    }
    out.set(row.id, tags);
  }
  return out;
}
