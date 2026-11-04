// The Showdown screen's own `Show all players` switch (optimizer standard C24, round 4): it used to be classic's switch (store.filters.showAllPlayers), so turning it on
// for a Showdown turned it on for the main slate too. Now the Showdown pool, its filter bar and its two Sources tables read this one flag, and classic's is untouched.
// Off = the men ESPN (or the backup) lists out, inactive, on IR, doubtful, suspended or on PUP/NFI are hidden (D45). Page-lifetime state, like the pool's other filters.
let on = false;
const listeners = [];

/** Whether the Showdown screen shows every man, the listed-out ones too. */
export const sdShowAll = () => on;

/** Turns it on or off; every registered listener runs when the value changes. */
export function setSdShowAll(next) {
  const value = Boolean(next);
  if (value === on) return;
  on = value;
  for (const fn of listeners) fn(on);
}

/** The switch as wireShowAllButtons (filterbar.js) takes it. */
export const sdShowAllFlag = Object.freeze({ get: sdShowAll, set: setSdShowAll });

/** `fn(on)` runs after each change (view.js draws the Showdown screen again). */
export function onSdShowAllChange(fn) {
  if (typeof fn === "function") listeners.push(fn);
}
