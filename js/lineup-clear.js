// `Clear lineup` on the classic Optimizer (optimizer standard B6, round 4; it was `Clear all`). It empties the slots and the locks that hold men in them, and nothing else: the excludes
// stay (they are pool settings, not part of the lineup, and it used to wipe them with no word), as do the settings, the stars, the saved lineups and, in Cash, the Wants. The Cash Undo goes
// (it restores a build that is no longer on the slots).
// The question `Clear the lineup?` is asked only when there is a man or a lock to lose.
// Pure: the panel (lineup.js) applies it; the Showdown's twin is showdown/seats.js clearAll.

/** Whether Clear lineup would lose something: a man in a slot or a lock. Excludes and (Cash) Wants never count: they are not cleared. */
export function clearLineupHasContent({ slots = [], locks = new Set() } = {}) {
  return slots.some(Boolean) || (locks?.size ?? 0) > 0;
}

/** The lineup after Clear lineup: `slotCount` empty slots and no locks. */
export function clearedLineup(slotCount) {
  return { slots: new Array(slotCount).fill(null), locks: new Set() };
}
