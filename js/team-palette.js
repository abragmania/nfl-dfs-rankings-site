// One colour per team for the lineup card rows, picked so no two teams on the slate look alike (Team rows, Adam
// 2026-10-18: every team keeps its real primary; close colours are told apart by lightness, never a hue shift; only a primary on the page background may take its secondary). Pure and browser-safe.
import { TEAM_BY_ABBR } from "./teams-data.js";
import { contrastRatio } from "./format.js";

// Two colours clash when their CIELAB distance (CIE76 delta E) is under this: below it a reader cannot tell two rows apart.
// One distance for the clash test and the nudge (Adam 2026-10-18: "give each team its own color scheme and they all look
// different enough"): a team already 15 apart keeps its real colour, so KC #e31837 / SF #aa0000 (21.5) both stay as they are.
export const CLASH_DELTA_E = 15;

// A secondary this close to the page (white or the light and dark backgrounds, delta E) would vanish; 5 keeps black.
export const BACKGROUND_DELTA_E = 5;
export const PAGE_COLOURS = ["#ffffff", "#f4f5f7", "#0e1116", "#151a22"]; // style.css --bg and --bg-elevated, light then dark (a test pins them)

const HEX = /^#[0-9a-f]{6}$/i;
const linear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const cube = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);

/** "#rrggbb" to CIELAB [L, a, b] (sRGB, D65). */
export function toLab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(linear);
  const fx = cube((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const fy = cube(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const fz = cube((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 delta E between two "#rrggbb" colours. */
export function deltaE(a, b) {
  const [x, y] = [toLab(a), toLab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export function coloursClash(a, b) {
  return deltaE(a, b) < CLASH_DELTA_E;
}

const nearPage = (c) => PAGE_COLOURS.some((p) => deltaE(c, p) < BACKGROUND_DELTA_E);

// Team rows round 2, Adam 2026-10-17 ("even if you have to fudge the colors a bit"): the nudge ladder, fixed so a render never differs.
const L_STEPS = [4, -4, 8, -8, 12, -12, 16, -16, 20, -20, 24, -24, 28, -28]; // lighter first, then darker, smallest shift first
export const NUDGE_DELTA_E = CLASH_DELTA_E; // a nudged colour must clear every placed colour by the clash distance; one value so they never drift apart
const hueGap = (x, y) => { const d = Math.abs((Math.atan2(x[2], x[1]) - Math.atan2(y[2], y[1])) * 180 / Math.PI) % 360; return d > 180 ? 360 - d : d; };
const fromLinear = (c) => { const v = Math.min(1, Math.max(0, c)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
const uncube = (f) => (f ** 3 > 216 / 24389 ? f ** 3 : (116 * f - 16) / (24389 / 27));

const linearRgb = (L, a, b) => {
  const fy = (L + 16) / 116;
  const [x, y, z] = [0.95047 * uncube(fy + a / 500), uncube(fy), 1.08883 * uncube(fy - b / 200)];
  return [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
};

/** CIELAB [L, a, b] to the nearest "#rrggbb" (sRGB, D65, clipped to the gamut). */
export function fromLab([L, a, b]) {
  return `#${linearRgb(L, a, b).map((c) => Math.round(fromLinear(c) * 255).toString(16).padStart(2, "0")).join("")}`;
}

// The card colour of each theme, dark then light: style.css's --bg-elevated (a test pins them). 🔵 2026-10-18 series review: the wash and its text colours are gone.
export const WASH_THEMES = [{ card: "#151a22" }, { card: "#ffffff" }];
const channel = (hex, i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);

const DARK_L = 30; // below this CIELAB lightness a colour is dark: the nudge only lightens it
/** The colour at lightness L2 with a and b shrunk together (hue held) until it fits the sRGB gamut. */
const inGamut = (L2, a, b) => {
  let k = 1;
  while (k > 0 && linearRgb(L2, a * k, b * k).some((v) => v < -1e-3 || v > 1 + 1e-3)) k = Math.max(0, k - 0.01);
  return fromLab([L2, a * k, b * k]);
};

// The dark row's fill shows the team's real colours (Adam 2026-10-18, round-5 render: Dallas, Indianapolis, Houston, the Giants, the Patriots read grey).
// 👁 2026-10-18 round 6: a band, not just a floor, so every dark row takes white text (Titans #6F89A7 was the one light tile); light rows get a floor so a black stays charcoal.
export const FILL_MIN_L = 28;
export const FILL_MAX_L = 42;
export const LIGHT_FILL_MIN_L = 30;
/** `hex` with L clamped to [FILL_MIN_L, FILL_MAX_L] at fixed hue (chroma shrunk by inGamut, never shifted); unchanged inside the band. */
export function fillForDark(hex) {
  const [L, a, b] = toLab(hex);
  return L >= FILL_MIN_L && L <= FILL_MAX_L ? hex : inGamut(Math.min(FILL_MAX_L, Math.max(FILL_MIN_L, L)), a, b);
}
/** The light theme's fill: `hex` with L raised to LIGHT_FILL_MIN_L at fixed hue; unchanged at L 30 or more. */
export function fillForLight(hex) {
  const [L, a, b] = toLab(hex);
  return L >= LIGHT_FILL_MIN_L ? hex : inGamut(LIGHT_FILL_MIN_L, a, b);
}

// Solid rows (Adam 2026-10-18, then "not fully opaque"; flat, one colour per row, after the round-5 render): ROW_FILL is the one fill opacity per theme in %
// (style.css :root --row-fill-a, a test pins it).
export const ROW_FILL = { light: 85, dark: 60 };
// 👁 2026-10-18 round 6: the name and the second line are one colour. 🔵 2026-10-18 series review: `chip` is the role-tag base, darker under white text and lighter under near-black text, so the tag text never loses contrast.
export const ROW_TEXTS = [{ text: "#f4f5f7", onDark: true, chip: "rgba(0, 0, 0, 0.22)" }, { text: "#0e1116", onDark: false, chip: "rgba(255, 255, 255, 0.35)" }];
/** The row's text colour for the one flat fill `fill`: whichever of ROW_TEXTS holds 4.5:1 on the fill blended over
 *  the card at ROW_FILL; else the opacity loses 5 points at a time until one does (`alpha`, a number, then differs from ROW_FILL). */
export function solidRow(fill, theme) {
  const card = [0, 1, 2].map((i) => channel(WASH_THEMES[theme === "dark" ? 0 : 1].card, i));
  const rgbFill = [0, 1, 2].map((i) => channel(fill, i));
  for (let alpha = ROW_FILL[theme]; alpha >= 0; alpha -= 5) {
    const bg = rgbFill.map((v, c) => card[c] + (v - card[c]) * alpha / 100);
    const ok = ROW_TEXTS.map((m) => ({ m, ratio: contrastRatio([0, 1, 2].map((i) => channel(m.text, i)), bg) }));
    const best = ok.filter((x) => x.ratio >= 4.55).sort((x, y) => y.ratio - x.ratio)[0]; // 4.5 plus a hair for the browser's rounding
    if (best) return { alpha, text: best.m.text, onDark: best.m.onDark, chip: best.m.chip };
  }
  return { alpha: 0, text: ROW_TEXTS[0].text, onDark: true, chip: ROW_TEXTS[0].chip };
}

const BAR_NEUTRAL = "#c8cdd3"; // 👁 2026-10-18 round 6: the bar's fallback on dark; on light it is the fill 30 L deeper (the fill itself at full strength reads only 1.5:1 on its own 85% blend)
// 🔵 2026-10-18 series review: the other neutrals, tried in order only when a clashing team's bar must differ from one already placed (#f4f5f7 is 14.6 from
// #c8cdd3, so white follows it, then greys 15 L apart: a slate can hold six near-identical navies, each needing a bar of its own).
const greys = (...Ls) => Ls.map((L) => fromLab([L, 0, 0]));
const BAR_OTHERS = { dark: ["#f4f5f7", "#ffffff", ...greys(68, 53, 38)], light: ["#0e1116", ...greys(22, 37, 52, 67)] };
/** The row's left bar: `secondary` when it holds 1.8:1 against the fill blended over the card (at `alpha`, default ROW_FILL) and 1.5:1 against the card;
 *  else a light neutral on dark, the fill deepened by 30 L at its own hue on light. `avoid` (the bars of the placed teams this fill clashes with): the first of
 *  secondary, that fallback, then BAR_OTHERS that is CLASH_DELTA_E from all of them, else the one farthest from the nearest. */
export function barColour(fill, secondary, theme, alpha = ROW_FILL[theme], avoid = []) {
  const card = WASH_THEMES[theme === "dark" ? 0 : 1].card;
  const blended = [0, 1, 2].map((i) => channel(card, i) + (channel(fill, i) - channel(card, i)) * alpha / 100);
  const shows = (c) => contrastRatio(c, blended) >= 1.8 && contrastRatio(c, card) >= 1.5;
  const [L, a, b] = toLab(fill);
  const fallback = theme === "dark" ? BAR_NEUTRAL : inGamut(Math.max(0, L - 30), a, b);
  const list = [...(secondary && shows(secondary) ? [secondary] : []), fallback, ...BAR_OTHERS[theme].filter(shows)];
  const gap = (c) => Math.min(...avoid.map((x) => deltaE(c, x)));
  return list.find((c) => gap(c) >= CLASH_DELTA_E) ?? list.reduce((best, c) => (gap(c) > gap(best) ? c : best));
}

/** The smallest lightness-only nudge of `hex` that sits NUDGE_DELTA_E from every colour in `taken`, farther from them than `hex`
 *  itself is (a nudge never moves toward the team it clashed with), and off the page, or null. A step that leaves the sRGB gamut
 *  has a and b shrunk together (same ratio, so the hue holds) until it fits, rather than clipping a channel and drifting the hue. */
export function nudgeColour(hex, taken) {
  const [L, a, b] = toLab(hex);
  const nearest = (c) => Math.min(...taken.map((t) => deltaE(c, t))); // Infinity when nothing is placed
  const start = nearest(hex);
  for (const dl of L < DARK_L ? L_STEPS.filter((s) => s > 0) : L_STEPS) { // a dark colour is only ever lightened, in BOTH themes (👁 2026-10-18: a darker navy vanished on dark; the light palette moved too: NYG, WAS)
    const L2 = Math.min(100, Math.max(0, L + dl));
    const c = inGamut(L2, a, b);
    const d = nearest(c);
    const hueHeld = Math.hypot(a, b) <= 5 || hueGap(toLab(c), [L, a, b]) <= 2; // 8-bit rounding at low L can swing the hue; such a step is skipped
    if (c !== hex && !nearPage(c) && hueHeld && d >= NUDGE_DELTA_E && (d > start || !taken.length)) return c;
  }
  return null;
}

/** Abbr to { colour, alt, clash?, fudged?, original? } for the teams on a slate. Teams are placed in alphabetical
 *  order, so the input order never matters: the first keeps its primary; a later team that clashes with a placed
 *  colour, or whose primary sits on the page background, has its primary nudged in lightness (nudgeColour, `fudged: true`,
 *  the colour it was in `original`). If no nudge fits, the primary stays and `clash` names the team it clashes with; only a
 *  primary on the page takes its secondary (primary as `alt`, in `original`). A team with no usable colours gets no entry.
 *  fillLight / fillDark, rowLight / rowDark, barLight / barDark and clashLight / clashDark are set by paintTheme from the TRUE primary and secondary. */
export function slatePalette(teamAbbrs, teamsByAbbr = TEAM_BY_ABBR) {
  const out = new Map();
  const truth = new Map();
  const placed = [];
  for (const abbr of [...new Set(teamAbbrs)].filter((a) => typeof a === "string").sort()) {
    const t = teamsByAbbr[abbr];
    const primary = t?.colourPrimary;
    if (!HEX.test(primary ?? "")) continue;
    const secondary = HEX.test(t.colourSecondary ?? "") ? t.colourSecondary : null;
    const hit = placed.find((p) => coloursClash(primary, p.colour));
    const entry = { colour: primary, alt: secondary };
    const onPage = nearPage(primary);
    if (hit || onPage) {
      const nudged = nudgeColour(primary, placed.map((p) => p.colour));
      if (nudged) Object.assign(entry, { colour: nudged, fudged: true, original: primary });
      else if (onPage && secondary && !nearPage(secondary)) {
        Object.assign(entry, { colour: secondary, alt: primary, fudged: true, original: primary });
        const hit2 = placed.find((p) => coloursClash(secondary, p.colour)); // the secondary can clash too: say so
        if (hit2) entry.clash = hit2.abbr;
      } else if (hit) entry.clash = hit.abbr;
    }
    out.set(abbr, entry);
    truth.set(abbr, { primary, secondary });
    placed.push({ abbr, colour: entry.colour });
  }
  paintTheme(out, "dark", truth);
  paintTheme(out, "light", truth);
  return out;
}

// 🔵 2026-10-18 series review: the fills a theme paints are separated where they are painted. Each team's TRUE primary is clamped into the
// theme's band first (dark L 28-42, light L 30 and up), then teams in alphabetical order nudge inside that band until 15 apart from every
// placed fill: lightness steps (both ways), then chroma steps at fixed hue, within the gamut. No fit keeps the clamped colour, `clashLight` /
// `clashDark` names the nearest placed team, and barColour gives this team a bar 15 from the bars of the teams it clashes with.
const FILL_BANDS = { dark: [FILL_MIN_L, FILL_MAX_L], light: [LIGHT_FILL_MIN_L, 100] };
const CHROMA_STEPS = [0.85, 1.15, 0.7, 1.3, 0.55, 1.45, 0.4, 1.6];
function fillCandidates(start, truth, theme) {
  const [lo, hi] = FILL_BANDS[theme];
  const [L, a, b] = toLab(start);
  const t = toLab(truth);
  const held = (c) => { const x = toLab(c); return Math.hypot(t[1], t[2]) <= 5 || Math.hypot(x[1], x[2]) <= 5 || hueGap(x, t) <= 2; }; // 8-bit rounding at low chroma can swing the hue
  const found = L_STEPS.map((dl) => L + dl).filter((L2) => L2 >= lo && L2 <= hi).map((L2) => inGamut(L2, a, b));
  for (const k of CHROMA_STEPS) if (linearRgb(L, a * k, b * k).every((v) => v >= -1e-3 && v <= 1 + 1e-3)) found.push(fromLab([L, a * k, b * k]));
  return found.filter((c) => c !== start && held(c));
}
function paintTheme(out, theme, truth) {
  const K = theme === "dark" ? "Dark" : "Light";
  const placed = [];
  for (const [abbr, e] of out) {
    const { primary, secondary } = truth.get(abbr);
    const start = theme === "dark" ? fillForDark(primary) : fillForLight(primary);
    const nearest = (c) => Math.min(...placed.map((p) => deltaE(c, p.fill))); // Infinity when nothing is placed
    const fill = nearest(start) >= CLASH_DELTA_E ? start : fillCandidates(start, primary, theme).find((c) => nearest(c) >= CLASH_DELTA_E) ?? start;
    const hits = placed.filter((p) => deltaE(fill, p.fill) < CLASH_DELTA_E);
    const row = solidRow(fill, theme);
    const bar = barColour(fill, secondary ?? primary, theme, row.alpha, hits.map((p) => p.bar));
    Object.assign(e, { [`fill${K}`]: fill, [`row${K}`]: row, [`bar${K}`]: bar });
    if (hits.length) e[`clash${K}`] = hits.reduce((n, p) => (deltaE(fill, p.fill) < deltaE(fill, n.fill) ? p : n)).abbr;
    placed.push({ abbr, fill, bar });
  }
}

const byRows = new WeakMap();
/** The palette for a board's id to row Map, built once per Map (so once per render) by the first call. Team rows fix, 2026-10-17:
 *  `slateRows` (the active slate's rows, activeSlateRows) are the teams it is built from, "for that slate"; without them, every row
 *  of the Map. A team off the slate has no entry and wears its own colours (lineup-card.js teamColours). */
export function paletteForRows(rowById, slateRows = null) {
  if (!rowById) return new Map();
  if (!byRows.has(rowById)) byRows.set(rowById, slatePalette([...(slateRows ?? rowById.values())].map((r) => r?.team)));
  return byRows.get(rowById);
}
