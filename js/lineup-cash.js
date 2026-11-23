// Cash mode's pure browser logic (PROJECT.md Part 4 "Cash mode"; cashmode-plan-2026-10-17.md with Adam's 2026-10-17 rulings:
// Must = the lock, Want = his cash pool, Fine = the default; Want and Fine retired Monday 11-23 item 4 for NBA's Lock, NO and Exclude). No DOM access; lineup.js (job 3b) wires it.
// lineup.js savePersisted writes playerMax, playerMin, mode, cash (the Want lists only, kept and ignored since 11-23), sort and the count-defaults version; the slots, locks, excludes, stack panels, Spread defenses, avoided games and Cash's
// lineup count and cap per team live per slate in the browser's one memory (memory.js, lineup-memory-sync.js). loadedId and saveName live in memory (swapModeStash keeps them).
import { escapeHtml, money, dec1 } from "./format.js";
import { shownTotal } from "./totals.js";
import { rowIsOut } from "./out.js";

const SALARY_CAP = 50000;
export const UNUSED_CAP_WARN = 400;
const SLOT_COUNT = 9;
const MAX_COUNT = 150;
const MAX_PER_TEAM = 8;

// Change together with CASH_DEFAULTS in server/lineup/cash.js (the browser cannot import it; tests/cash-ui.test.mjs compares).
// Adam 2026-10-17: cash has no minimum-unique rule, so no minUnique here, in the stored state or in the request.
export const CASH_DEFAULTS_BROWSER = Object.freeze({ count: "5", maxPerTeam: "" }); // optimizer standard D9: five lineups, as GPP

/** D9: the lineup count the defaults changed from, and the version of the count defaults a saved state carries; a saved state without the version
 *  that remembers the old count takes the new default once (cleanCashState's `fromVersion`), after which a count of 1 is the user's own. */
export const OLD_DEFAULT_COUNT = "1";
export const COUNT_DEFAULTS_VERSION = 5;
// Copies of server/lineup/cash.js NO_MEDIAN_SENTENCE and UNKNOWN_MODE_SENTENCE (code review of a9455a0, MUST 1): the Optimizer's
// Cash band shows the server's own refusal before Build is pressed. Change together; tests/cash-ui.test.mjs compares.
export const CASH_NO_MEDIAN_TEXT = "TwoGun is the only projection source in use, but this board carries no TwoGun medians, so a cash lineup cannot be built by median; use another projection source to build by projection.";
export const CASH_UNKNOWN_BASIS_TEXT = "The board was published without its Cash basis, so a cash lineup's basis cannot be picked.";

export function defaultCashState() {
  return { ...CASH_DEFAULTS_BROWSER, avoid: [], want: {} };
}

/** D9: a remembered lineup count of 1 from before the defaults changed takes the new default once: `count` as stored, `savedVersion` the count-defaults
 *  version the stored state carried (null for an older one that carried none). Anything else, and a count of 1 stored after the change, is the user's own. Pure. */
export function countAfterDefaultsChange(count, savedVersion) {
  return savedVersion !== COUNT_DEFAULTS_VERSION && String(count).trim() === OLD_DEFAULT_COUNT ? CASH_DEFAULTS_BROWSER.count : count;
}

// Cash mode job 3b, 2026-10-17: what lineup.js hydrate accepts from storage; anything else falls back to the defaults. `savedVersion`: see countAfterDefaultsChange.
export function cleanCashState(raw, savedVersion = COUNT_DEFAULTS_VERSION) {
  const base = defaultCashState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const text = (v, fallback) => (typeof v === "string" || typeof v === "number" ? String(v) : fallback);
  const want = {};
  if (raw.want && typeof raw.want === "object" && !Array.isArray(raw.want)) {
    for (const [slate, ids] of Object.entries(raw.want)) if (Array.isArray(ids)) want[slate] = [...new Set(ids.map(String))];
  }
  return { count: countAfterDefaultsChange(text(raw.count, base.count), savedVersion), maxPerTeam: text(raw.maxPerTeam, base.maxPerTeam), avoid: Array.isArray(raw.avoid) ? raw.avoid.map(String) : [], want };
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

export function cashChipHtml() {
  return `<span class="cash-chip" aria-hidden="true">$</span>`;
}

/** The GPP and Cash tabs of both Optimizers (optimizer standard Part F, Adam 5:12 PM 2026-11-04: separate tabs, each with its own settings, lineup and batch; style.css .sd-opt-tabs). The classic `.opt-tab` look; the buttons keep `data-opt-mode`, which each Optimizer's band wiring reads. */
export function modeTabsHtml(mode) {
  const active = mode === "cash" ? "cash" : "gpp";
  const tab = (value, inner, title) => `<button type="button" role="tab" class="opt-tab sd-opt-tab${active === value ? " active" : ""}" data-opt-mode="${value}" aria-selected="${active === value}" title="${escapeHtml(title)}">${inner}</button>`;
  return `<div class="opt-tabs sd-opt-tabs" role="tablist" aria-label="Lineup type">${tab("gpp", "GPP", "Tournament lineups: this tab's own settings, lineup and lineups")}${tab("cash", `${cashChipHtml()} Cash`, "Cash-game lineups: this tab's own settings, lineup and lineups")}</div>`;
}

/** The line over cash's settings: the men clicked into the lineup (held, no padlock), the padlocked (Lock) and the Wants (none since Monday 11-23 item 4: the caller passes none). A padlock counts only as Lock. */
export function cashHeadLine(mustRows, wantRows, inRows = []) {
  const names = (rs) => rs.map((r) => escapeHtml(r?.name ?? "")).join(", ");
  const parts = [];
  if (inRows?.length) parts.push(`${inRows.length} in the lineup: ${names(inRows)}`);
  if (mustRows?.length) parts.push(`${mustRows.length} Lock: ${names(mustRows)}`);
  if (wantRows?.length) parts.push(`${wantRows.length} Want: ${names(wantRows)}`);
  return parts.length ? parts.join(" · ") : "No Lock players"; // Monday 11-23 item 4: Want retired
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

/** The median total of a cash lineup built by median: "98.0 median", or "— median (a player has no TwoGun median)"; "" on any other basis (the card's totals block carries it after the four figures). */
export function cashMedianText(lineup, basis) {
  if (basis !== "median") return "";
  const meds = (lineup?.players ?? []).map((p) => p.median);
  const allMed = meds.length > 0 && meds.every((m) => finite(m) !== null);
  const sum = lineup?.median === null ? null : allMed ? shownTotal(meds) : finite(lineup?.median);
  return sum === null ? "— median (a player has no TwoGun median)" : `${dec1(sum)} median`;
}

export function unusedCapText(salary, cap = SALARY_CAP) {
  const left = finite(salary) === null ? 0 : cap - salary;
  return left > UNUSED_CAP_WARN ? `${money(left)} unused` : "";
}

export function cashBadgeHtml() {
  return `<span class="saved-lineup-badge saved-lineup-badge-cash">$ Cash</span>`;
}

/** The `GPP` mark (optimizer standard A12, round 3): every saved card says which kind it is, Cash or GPP. */
export function gppBadgeHtml() {
  return `<span class="saved-lineup-badge saved-lineup-badge-gpp">GPP</span>`;
}

/** The mark for a saved lineup: Cash for a cash lineup, GPP for every other (lineupModeOf's rule). */
export function modeBadgeHtml(lineup) {
  return lineupModeOf(lineup) === "cash" ? cashBadgeHtml() : gppBadgeHtml();
}

/** "1 lineup from the last Build (Cash, by TwoGun's median)": no mode clause, since the basis names itself and the header may show a
 *  custom mix (code review of c1f9890). The Showdown Optimizer's head reads it too (showdown/optimizer-view.js batchHeadText). */
export function builtInTextCash(count, basis) {
  const n = Number(count);
  return `${n} lineup${n === 1 ? "" : "s"} from the last Build (Cash, by ${basis === "median" ? "TwoGun's median" : "projection"})`;
}
