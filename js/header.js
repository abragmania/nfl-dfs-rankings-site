// Header strip: title (static in index.html), slate line, upload flow (unchanged network shape),
// refresh, and the amber pill row: one pill per stale or failed source, plus collapsed CSV warnings. Board
// notes are never header pills; the few that exist are shown as a quiet line inside their own tab (tabs.js).
import { escapeHtml, clockPart, collapseWarnings, kickoffClockPart } from "./format.js";
import { uploadCsv } from "./api.js";
import { slateTileText } from "./state.js";

// Builds one amber pill per stale-or-failed source id. `sources` may be null/empty (right after an
// upload, before the board has loaded) in which case the id itself is shown as the label, per the
// 🔵 review requirement that pills must appear before the board reloads.
const FAILED_STATUSES = new Set(["failed", "error"]);

function sourcePillHtml(id, sources) {
  const source = (sources ?? []).find((s) => s.id === id);
  const label = source?.label ?? id;
  if (FAILED_STATUSES.has((source?.status ?? "").toLowerCase())) {
    return `<li class="pill pill-warning" title="${escapeHtml(label)} · failed">${escapeHtml(label)} · failed</li>`;
  }
  const time = source?.fetchedAt ? clockPart(source.fetchedAt) : "";
  const suffix = time ? `cached ${time}` : "cached";
  return `<li class="pill pill-warning" title="${escapeHtml(label)} · ${suffix}">${escapeHtml(label)} · ${suffix}</li>`;
}

function warningPillHtml(w) {
  const text = w.count > 1 ? `${w.code} ×${w.count}` : w.code;
  return `<li class="pill pill-warning" title="${escapeHtml(w.message)}">${escapeHtml(text)}</li>`;
}

// `staleIds`: array of source ids currently stale or failed. `sources`: board.sources array or null.
// `failedIds`: extra ids whose source status is "failed" but which may not be listed in staleIds. Every id
// is shown once however many lists name it. With nothing to show the row is hidden outright, so it takes no
// vertical space (its top margin included).
export function renderPills(container, { staleIds = [], sources = null, warnings = [] } = {}) {
  const failedIds = (sources ?? []).filter((s) => FAILED_STATUSES.has((s.status ?? "").toLowerCase())).map((s) => s.id);
  const ids = [...new Set([...(staleIds ?? []), ...failedIds])];
  const sourcePills = ids.map((id) => sourcePillHtml(id, sources)).join("");
  const warningPills = collapseWarnings(warnings).map(warningPillHtml).join("");
  const all = sourcePills + warningPills;
  container.innerHTML = all ? `<ul class="pills-list">${all}</ul>` : "";
  container.hidden = !all;
}

export function renderSlateLine(container, slate) {
  if (!slate) {
    container.textContent = "No slate loaded";
    return;
  }
  const games = Array.isArray(slate.games) ? slate.games.length : 0;
  const weekLabel = slate.week != null ? slate.week : "?";
  container.textContent = `${slate.season ?? "?"} · Week ${weekLabel} · ${games} game${games === 1 ? "" : "s"}`;
}

// The line shown after an upload that the server saved as a second slate (D57). Players the server could not
// match to the main slate, or whose salary differs, are counted here so they are never silent.
export function secondSlateSavedText(secondSlate) {
  const n = secondSlate?.games ?? 0;
  const label = String(secondSlate?.label ?? secondSlate?.key ?? "").trim();
  const name = /game/i.test(label) ? label : `${label} · ${n} game${n === 1 ? "" : "s"}`;
  const extras = [];
  const unmatched = secondSlate?.unmatched?.length ?? 0;
  const diffs = secondSlate?.salaryDiffs?.length ?? 0;
  if (unmatched) extras.push(`${unmatched} player${unmatched === 1 ? "" : "s"} could not be matched to the main slate`);
  if (diffs) extras.push(`${diffs} salar${diffs === 1 ? "y differs" : "ies differ"} from the main slate`);
  return `Saved as a second slate: ${name}. The main slate is unchanged.${extras.length ? ` ${extras.join("; ")}.` : ""}`;
}

// Wires the existing upload flow (unchanged network behaviour: raw CSV text to POST /api/slate/upload).
// `onUploaded(data)` fires with the raw response so the caller can reload the board and re-render pills
// with real source labels once it lands.
export function wireUpload({ csvInput, uploadInfo, statusEl, slateLine, pillsRow }, { onUploaded }) {
  csvInput.addEventListener("change", async () => {
    const file = csvInput.files?.[0];
    if (!file) return;
    statusEl.textContent = `Uploading ${file.name}...`;
    statusEl.className = "status";
    try {
      const text = await file.text();
      const data = await uploadCsv(text);
      if (data.ok && data.secondSlate) {
        // D57: the file was a second slate (its games are part of the loaded main slate's). The main slate, its
        // upload line and its pills are untouched; the caller reloads the board and switches to the new tile.
        statusEl.textContent = secondSlateSavedText(data.secondSlate);
        onUploaded?.(data);
      } else if (data.ok) {
        statusEl.textContent = `Uploaded ${file.name}.`;
        uploadInfo.textContent = `${data.savedAs ?? file.name} · uploaded ${clockPart(data.uploadedAt) || data.uploadedAt}`;
        renderSlateLine(slateLine, data);
        // Show pills for this response's own stale list immediately, before the board reloads;
        // board.sources isn't known yet so the id itself is the label (🔵 review requirement).
        renderPills(pillsRow, { staleIds: data.stale, sources: null, warnings: data.warnings });
        onUploaded?.(data);
      } else {
        statusEl.textContent = `Upload failed: ${data.error?.message ?? "unknown error"}`;
        statusEl.className = "status error";
      }
    } catch (e) {
      statusEl.textContent = `Upload failed: ${e.message}`;
      statusEl.className = "status error";
    } finally {
      csvInput.value = "";
    }
  });
}

// Mode row (Showdown, D39/D40): sits above the classic game strip, one tile per loaded showdown plus the
// "Main slate" tile and an "Upload Showdown CSV" tile. `mainLabel` is built by the caller (app.js already
// knows the classic slate's game count); `showdowns` is GET /api/showdown's list; `activeKey` is the
// current "#sd=<key>" hash value or null while the main slate is showing. Only the date's own digits from
// kickoffEt are sliced out for the tile (never a computed weekday, D30 — no builder derives date logic
// beyond the one helper in server/lib/et.js); the clock part reuses format.js's existing kickoffClockPart.
export function kickoffDateAndClock(kickoffEt) {
  if (typeof kickoffEt !== "string") return "";
  const m = kickoffEt.match(/^\d{4}-(\d{2})-(\d{2})T/);
  const datePart = m ? `${Number(m[1])}/${Number(m[2])}` : "";
  const clock = kickoffClockPart(kickoffEt);
  return [datePart, clock].filter(Boolean).join(" ");
}

// Second slates (D57): `slates` is the board's list (a missing list is empty), one tile each right after the
// main-slate tile, "Afternoon · 4 games"; `activeSlateKey` is the one on screen (null = the main slate) and
// `onSelectSlate(key)` is its click. They stay in the classic app; only the showdown tiles leave it.
export function renderModeRow(container, { mainLabel, showdowns = [], activeKey = null, onSelectMain, onSelectShowdown, onUploadShowdownCsv, slates = [], activeSlateKey = null, onSelectSlate } = {}) {
  const slateList = Array.isArray(slates) ? slates : [];
  const slateOnScreen = activeKey == null ? slateList.find((s) => s && s.key === activeSlateKey) ?? null : null;
  const mainActive = activeKey == null && !slateOnScreen;
  const slateTilesHtml = slateList
    .map((s) => `<button type="button" class="mode-tile${s === slateOnScreen ? " active" : ""}" data-slate-key="${escapeHtml(s.key)}">${escapeHtml(slateTileText(s))}</button>`)
    .join("");
  const showdownTilesHtml = showdowns
    .map((sd) => {
      const active = sd.key === activeKey;
      const gameLabel = sd.gameId ?? sd.key;
      const when = kickoffDateAndClock(sd.kickoffEt);
      const text = `Showdown &middot; ${escapeHtml(gameLabel)}${when ? ` &middot; ${escapeHtml(when)}` : ""}`;
      return `<button type="button" class="mode-tile${active ? " active" : ""}" data-sd-key="${escapeHtml(sd.key)}">${text}</button>`;
    })
    .join("");
  container.innerHTML = `
    <div class="mode-row-inner">
      <button type="button" class="mode-tile${mainActive ? " active" : ""}" data-mode="main">${escapeHtml(mainLabel ?? "Main slate")}</button>
      ${slateTilesHtml}
      ${showdownTilesHtml}
      <label class="mode-tile mode-upload-tile">
        Upload Showdown CSV
        <input type="file" id="sd-csv-input" accept=".csv,text/csv" hidden />
      </label>
    </div>`;
  container.querySelector('[data-mode="main"]')?.addEventListener("click", () => onSelectMain?.());
  container.querySelectorAll("[data-slate-key]").forEach((el) => {
    el.addEventListener("click", () => onSelectSlate?.(el.dataset.slateKey));
  });
  container.querySelectorAll("[data-sd-key]").forEach((el) => {
    el.addEventListener("click", () => onSelectShowdown?.(el.dataset.sdKey));
  });
  const fileInput = container.querySelector("#sd-csv-input");
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) await onUploadShowdownCsv?.(file);
  });
}

// Dark/Light toggle (header): the theme itself is a single attribute on <html data-theme="...">,
// set before first paint by index.html's inline bootstrap script so there is no light-then-dark
// flash; this just keeps the button's own glyph in sync and flips the attribute plus the saved
// choice on click. Wrapped in try/catch since localStorage can throw (private browsing, disabled
// storage) — the toggle still works for the current page load either way.
const THEME_STORAGE_KEY = "nfldfs-theme";

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function paintThemeToggle(btn) {
  const theme = currentTheme();
  // Shows the mode a click switches TO (moon = "go dark" while light is active, sun = "go light"
  // while dark is active), same convention as most dark-mode toggles.
  btn.textContent = theme === "dark" ? "☀" : "☽";
  btn.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

export function wireThemeToggle(btn) {
  if (!btn) return;
  paintThemeToggle(btn);
  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (e) {
      /* localStorage unavailable — the toggle still works for this page load */
    }
    paintThemeToggle(btn);
  });
}

export function wireRefresh({ refreshBtn, statusEl }, { onRefresh }) {
  refreshBtn.addEventListener("click", async () => {
    statusEl.textContent = "Refreshing sources...";
    statusEl.className = "status";
    try {
      await onRefresh();
      statusEl.textContent = "Refreshed.";
      statusEl.className = "status";
    } catch (e) {
      statusEl.textContent = `Could not refresh: ${e.message}`;
      statusEl.className = "status error";
    }
  });
}
