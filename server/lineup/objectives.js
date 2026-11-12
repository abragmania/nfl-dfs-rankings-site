// The engine's objective names, in a leaf of their own: the request and saved-lineup checks need only the names, and
// must not pull the whole classic engine (multi.js) into the public showdown page. Pure, no import.
// multi.js re-exports it, so existing importers of multi.js keep working.
export const OBJECTIVES = Object.freeze(["proj"]);
