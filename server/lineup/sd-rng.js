// Seeded random numbers for the simulated Showdown field (uniqueness plan S1, Adam 2026-10-18). Pure: no imports.
// sfc32 (Chris Doty-Humphrey's Small Fast Counting generator, 128-bit state), seeded from one 32-bit integer: the
// seed fills one state word, three fixed constants fill the others, and 15 outputs are thrown away before use so
// nearby seeds start apart. The same seed always gives the same sequence.

/** A deterministic generator: returns a function giving a float in [0, 1) (32 bits of resolution) on each call.
 *  `seed` must be a whole number from 0 to 4,294,967,295. */
export function makeRng(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error(`makeRng: seed must be a whole number from 0 to 4294967295, got ${seed}`);
  }
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed | 0;
  const next = () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}
