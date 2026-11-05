// The Showdown GPP and Cash tabs' own typed numbers (optimizer standard Part F: each tab has its own overrides). GPP keeps the
// game's one overrides file as it always was; Cash keeps its typed projections, typed ownership, ± bumps and revives in a file
// of its own (server/showdown/overrides-routes.js names it). Stars and notes are about a man, not a figure, so both tabs read
// the one copy in the GPP file and a star or a note typed on Cash is written there. Pure and browser-safe: the app's routes and
// the public site's stand-in (site-src/site-overrides.js, RULES.md D71) read the tab and split a change by the same rules.

/** The two tabs; a request with no tab is GPP. */
export const SHOWDOWN_TABS = Object.freeze(["gpp", "cash"]);
export const DEFAULT_TAB = "gpp";

/** The sections of a change that are the tab's own figures, and the ones both tabs share. */
export const TAB_SECTIONS = Object.freeze(["proj", "own", "bump"]);
export const SHARED_SECTIONS = Object.freeze(["stars", "notes"]);

/** { tab } for a request's tab (absent or null is GPP), or { error } with the plain sentence a 400 answers. */
export function readTab(raw) {
  if (raw === undefined || raw === null) return { tab: DEFAULT_TAB };
  if (SHOWDOWN_TABS.includes(raw)) return { tab: raw };
  return { error: `The tab must be gpp or cash; ${JSON.stringify(String(raw))} is neither, so nothing was read or saved.` };
}

/** The tab a lineup of `mode` is built and saved on: Cash for "cash", GPP for anything else (a lineup saved with no mode is GPP, lineups/validate.js lineupModeOf). */
export function tabOfMode(mode) {
  return mode === "cash" ? "cash" : DEFAULT_TAB;
}

/**
 * A change request split by where each part is kept: { own: the tab's figures (proj, own, bump), shared: stars and notes,
 * hasOwn, hasShared }, each section copied only when the request carries it. Pure; the request is not changed.
 */
export function splitTabChanges(changes) {
  const pick = (names) => Object.fromEntries(names.filter((n) => changes?.[n] !== undefined).map((n) => [n, changes[n]]));
  const own = pick(TAB_SECTIONS);
  const shared = pick(SHARED_SECTIONS);
  return { own, shared, hasOwn: Object.keys(own).length > 0, hasShared: Object.keys(shared).length > 0 };
}

// The board's notes when an overrides file cannot be read (missing is said, never silent). GPP_UNREADABLE_NOTE is server/showdown/board.js's build note, the one copy.
export const GPP_UNREADABLE_NOTE = "This game's overrides file could not be read, so typed numbers, stars and notes are off until it is fixed.";
const GPP_UNREADABLE_ON_CASH = "This game's overrides file could not be read, so stars and notes are off until it is fixed; the Cash tab's own typed numbers are still on.";
export const CASH_UNREADABLE_NOTE = "The Cash tab's typed numbers file could not be read, so Cash's typed numbers and bumps are off until it is fixed.";

/** A Cash board's notes: GPP's unreadable-file note says what it turns off on Cash (stars and notes only), and Cash's own unreadable file is said. Pure. */
export function cashBoardNotes(notes, cashUnreadable) {
  const out = (Array.isArray(notes) ? notes : []).map((n) => (n === GPP_UNREADABLE_NOTE ? GPP_UNREADABLE_ON_CASH : n));
  return cashUnreadable ? [...out, CASH_UNREADABLE_NOTE] : out;
}

/**
 * The overrides a Cash board is served with: Cash's own typed numbers, bumps and revives (`figures`, the Cash file's read) with
 * the shared stars and notes (`shared`, the GPP file's read); updatedAt is the Cash file's own stamp, so a GPP typed number (which
 * restamps the shared file) leaves the Cash board's stamp, and so its bytes, as they were. Either read may be null (unreadable):
 * its part is empty. Null when both are. Pure.
 */
export function tabOverrides(figures, shared) {
  if (!figures && !shared) return null;
  return {
    proj: { ...(figures?.proj ?? {}) },
    own: { ...(figures?.own ?? {}) },
    stars: [...(shared?.stars ?? [])],
    notes: { ...(shared?.notes ?? {}) },
    revive: [...(figures?.revive ?? [])],
    reviveTwoGun: [...(figures?.reviveTwoGun ?? [])],
    bump: { ...(figures?.bump ?? {}) },
    updatedAt: figures?.updatedAt ?? null
  };
}
