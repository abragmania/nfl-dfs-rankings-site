// Small display-only helpers shared by every renderer. No date/time computation lives here beyond
// slicing the clock characters straight out of a string (D30): we never construct a Date, never
// convert timezones, never validate — we just print the characters the server or the CSV gave us.

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function money(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function dec1(n) {
  return n == null || Number.isNaN(n) ? null : Number(n).toFixed(1);
}

export function dec2(n) {
  return n == null || Number.isNaN(n) ? null : Number(n).toFixed(2);
}

// Pulls the "HH:MM" clock characters out of an ISO timestamp string (e.g. fetchedAt) by slicing,
// never by constructing a Date object. "2026-09-13T02:32:00.000Z" -> "02:32".
export function clockPart(isoString) {
  if (typeof isoString !== "string") return "";
  const m = isoString.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "";
}

// Pulls the kickoff clock substring straight out of the kickoffEt string and renders a 12-hour label,
// e.g. the ISO+offset form "2026-09-13T13:00:00-04:00" -> "1:00 PM" (13:00 -> "1:00 PM", 16:25 -> "4:25
// PM"). This is plain string/integer arithmetic on the hour digits pulled out of the string — never a
// Date object, never timezone math (D30). Every kickoff on the slate is Eastern already, so no "ET"
// conversion is needed. The older CSV-derived "09/13/2026 01:00PM ET" form is also recognised (kept for
// any already-cached data) and passed through as-is since it is already a 12-hour label.
export function kickoffClockPart(kickoffEt) {
  if (typeof kickoffEt !== "string") return "";
  const iso = kickoffEt.match(/T(\d{2}):(\d{2})/);
  if (iso) {
    const hour24 = Number(iso[1]);
    const minute = iso[2];
    const ampm = hour24 >= 12 ? "PM" : "AM";
    let hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;
    return `${hour12}:${minute} ${ampm}`;
  }
  const ampmMatch = kickoffEt.match(/\d{1,2}:\d{2}\s*[AP]M\s*ET/i);
  if (ampmMatch) return ampmMatch[0];
  return kickoffEt;
}

// Relative luminance (WCAG) used only to pick the more legible of two fixed text colours (white vs
// a team's secondary colour) against a team's primary colour background.
function luminance(hex) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hexA, hexB) {
  const la = luminance(hexA) + 0.05;
  const lb = luminance(hexB) + 0.05;
  return la > lb ? la / lb : lb / la;
}

// Picks white or the team's own secondary colour, whichever contrasts better against the primary.
export function textColourFor(colourPrimary, colourSecondary) {
  const whiteRatio = contrastRatio(colourPrimary, "#ffffff");
  const secondaryRatio = contrastRatio(colourPrimary, colourSecondary);
  return secondaryRatio > whiteRatio ? colourSecondary : "#ffffff";
}

// Picks the logo variant for the resolved colour scheme: teams-data.js carries a `logoDark` path for
// every team (drawn for a dark background), which the light-background `logo` disappears against for
// dark-marked teams like NYJ/PHI/CAR (👁 visual-qa). Checked at render time via matchMedia rather than
// stored anywhere, so it always reflects whatever the browser/OS currently resolves.
export function logoFor(team) {
  if (!team) return "";
  // The app theme (data-theme on <html>, dark by default since 2026-09-27) wins over the OS preference.
  const themeAttr = typeof document !== "undefined" ? document.documentElement?.dataset?.theme : undefined;
  const isDark = themeAttr ? themeAttr === "dark" : (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return (isDark && team.logoDark) || team.logo || "";
}

// Groups a warnings array ({code, message}) by code so a repeated warning (e.g. one per CSV row)
// shows as a single pill with a count instead of one pill per row.
export function collapseWarnings(warnings) {
  const byCode = new Map();
  for (const w of warnings ?? []) {
    const code = w?.code ?? "WARNING";
    if (!byCode.has(code)) byCode.set(code, { code, message: w?.message ?? code, count: 0 });
    byCode.get(code).count += 1;
  }
  return [...byCode.values()];
}
