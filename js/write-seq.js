// The order of writes whose answers repaint the board (A3, round 3 fixes): each write is numbered as it starts; the answer of an older write is not
// painted once a newer one's has been taken, so a slow first answer never puts the screen back over a newer board. One counter per page.
export function makeWriteSeq() {
  let started = 0;
  let taken = 0;
  return {
    /** The number of a write that is starting now. */
    start: () => ++started,
    /** True (and the answer is taken) when write `n`'s answer is not older than one already taken. */
    take(n) {
      if (n < taken) return false;
      taken = n;
      return true;
    },
    /** True while no newer write's answer has been taken: the check a painter makes again after it waited. */
    current: (n) => n >= taken,
  };
}
