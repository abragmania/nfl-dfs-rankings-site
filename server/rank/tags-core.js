// Player tags, the part that needs no file: computeTags and its helpers. Pure (no node modules, no file reads), so
// the public site can run it in the visitor's browser (DECISIONS.md D71). tags.js keeps matchFindingsTags (it reads
// the name aliases through match.js) and re-exports everything here, so every existing caller is unchanged.
//
// Every tag comes from the weekly findings file (PROJECT.md D19, D9): a researched tag with its reason, outlet and
// link. Review Q1 (Adam, 2026-10-14: a label driven by a cutoff with no stated basis comes off): the app computes
// no tag of its own any more - the computed "chalk" (20% owned) and "value" (3.0 points per $1k at or under the
// position's median salary) tags are gone, and so is the chalk line that used to drop a researcher's "chalk" label.
// One rule Adam stated stays: PROJECT.md D42, a researcher's "value" label is dropped when the player's projection
// is under 3.0 DraftKings points (a player projected under 3.0 never shows a value tag, whoever wrote it).
// PROJECT.md D36 (Adam's ruling): the app does not identify sleeper plays at all. A findings-file tag of "sleeper
// play" is ignored as if it were not in the file and is never shown. An older findings file that carries such tags
// still loads.
// PROJECT.md D11: "Sleeper" on its own is the fantasy platform, whose label everywhere in this app is
// "Sleeper app"; it has nothing to do with the ignored tag.
import { toNumber, hasRealProjection } from "./value-core.js";

/** The findings tag the app ignores (D36). Kept as a name so the one place that drops it says what it drops. */
export const SLEEPER_PLAY = "sleeper play";

/** D42: the projection floor under which no value tag shows. */
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
 * Tags for every row: the researched tags, less the ones the rules above drop.
 * rows        - board rows carrying { id, proj, override, flags }.
 * findingsTags - Map player id -> [tag objects] from matchFindingsTags().
 * Returns Map id -> tag array (empty array when the player has none).
 */
export function computeTags(rows, { findingsTags = new Map() } = {}) {
  const out = new Map();
  for (const row of rows ?? []) {
    const found = findingsTags.get?.(row.id) ?? findingsTags[row.id];
    // D52: a stand-in projection (DraftKings' average for a player no source projects) is no projection, so it
    // neither drops nor supports a researched value label; with no projection nothing contradicts the label (D42).
    const projForLabel = hasRealProjection(row) ? toNumber(row.proj) : null;
    const kept = (found ?? []).filter((t) => {
      const name = normaliseTag(t.tag);
      if (name === SLEEPER_PLAY) return false;
      if (name === "value" && projForLabel !== null && projForLabel < VALUE_MIN_PROJ) return false;
      return true;
    });
    out.set(row.id, kept.map((t) => ({ ...t })));
  }
  return out;
}
