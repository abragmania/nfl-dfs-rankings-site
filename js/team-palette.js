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

/** The team colour a step richer, for the row wash's left end: CIELAB lightness down 8, chroma up 12% (so it reads deep, not pastel). */
export function deepen(hex) {
  const [L, a, b] = toLab(hex);
  return fromLab([Math.max(0, L - 8), a * 1.12, b * 1.12]);
}

// The wash's three stops (deep, colour, alt at 34%, 18%, 10% of full strength) sit over the card; every text colour a row carries (the
// muted grey, and the accent blue of a chosen name and the stack tag, which starts lower) must stay 4.5:1 or better on every stop in
// both themes, so a colour that would break that gets the whole wash scaled down (--tcs). Team rows fix, 2026-10-17: all of them listed.
// The values are style.css's --bg-elevated, --text-muted and --accent-text (a test pins them).
const WASH_STOPS = [0.34, 0.18, 0.1];
export const WASH_THEMES = [{ card: "#151a22", text: ["#a3abb8", "#6b9bec"] }, { card: "#ffffff", text: ["#565d68", "#2f5cd6"] }];
const channel = (hex, i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
/** The largest wash scale (1 down to 0 in steps of 0.05) that keeps every text colour at 4.5:1 or better on the row in both themes. */
export function washScale(deep, colour, alt) {
  const rgbOf = (h) => [0, 1, 2].map((i) => channel(h, i));
  for (let i = 20; i > 0; i--) {
    const k = i / 20;
    const ok = WASH_THEMES.every((t) => [deep, colour, alt ?? colour].every((h, s) => {
      const bg = rgbOf(t.card).map((v, c) => v + (rgbOf(h)[c] - v) * WASH_STOPS[s] * k);
      return t.text.every((x) => contrastRatio(rgbOf(x), bg) >= 4.55); // 4.5 plus a hair for the browser's rounding
    }));
    if (ok) return k;
  }
  return 0;
}

/** The smallest lightness-only nudge of `hex` that sits NUDGE_DELTA_E from every colour in `taken`, farther from them than `hex`
 *  itself is (a nudge never moves toward the team it clashed with), and off the page, or null. A step that leaves the sRGB gamut
 *  has a and b shrunk together (same ratio, so the hue holds) until it fits, rather than clipping a channel and drifting the hue. */
export function nudgeColour(hex, taken) {
  const [L, a, b] = toLab(hex);
  const nearest = (c) => Math.min(...taken.map((t) => deltaE(c, t))); // Infinity when nothing is placed
  const start = nearest(hex);
  for (const dl of L_STEPS) {
    const L2 = Math.min(100, Math.max(0, L + dl));
    let k = 1;
    while (k > 0 && linearRgb(L2, a * k, b * k).some((v) => v < -1e-3 || v > 1 + 1e-3)) k = Math.max(0, k - 0.01);
    const c = fromLab([L2, a * k, b * k]);
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
 *  primary on the page takes its secondary (primary as `alt`, in `original`). A team with no usable colours gets no entry. */
export function slatePalette(teamAbbrs, teamsByAbbr = TEAM_BY_ABBR) {
  const out = new Map();
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
    entry.deep = deepen(entry.colour);
    entry.wash = washScale(entry.deep, entry.colour, entry.alt);
    out.set(abbr, entry);
    placed.push({ abbr, colour: entry.colour });
  }
  return out;
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
