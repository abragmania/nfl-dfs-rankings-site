// Header strip: title (static in index.html), slate line, upload flow (unchanged network shape),
// refresh, and the amber pill row: one pill per stale or failed source, plus collapsed CSV warnings. Board
// notes are never header pills; the few that exist are shown as a quiet line inside their own tab (tabs.js).
import { escapeHtml, localStamp, collapseWarnings, kickoffClockPart } from "./format.js";
import { uploadCsv, isSampleMode } from "./api.js";
import { routeDkUpload } from "./dk-csv-kind.js";
import { slateTileText } from "./state.js";

// Builds one amber pill per stale-or-failed source id. `sources` may be null/empty (right after an
// upload, before the board has loaded) in which case the id itself is shown as the label, per the
// 🔵 review requirement that pills must appear before the board reloads.
const FAILED_STATUSES = new Set(["failed", "error"]);

const INJURY_SOURCE_ID = "espn-injuries";
function injuryPillSuffix(injuryReport) {
  if (!injuryReport?.state) return null;
  if (injuryReport.state === "missing") return "no report";
  if (injuryReport.source === "Sleeper") return injuryReport.state === "ok" ? "using Sleeper" : "using a saved Sleeper copy";
  return null;
}

function sourcePillHtml(id, sources, injuryReport = null) {
  const source = (sources ?? []).find((s) => s.id === id);
  const label = source?.label ?? id;
  const injurySuffix = id === INJURY_SOURCE_ID ? injuryPillSuffix(injuryReport) : null;
  if (injurySuffix) {
    return `<li class="pill pill-warning" title="${escapeHtml(label)} · ${injurySuffix}">${escapeHtml(label)} · ${injurySuffix}</li>`;
  }
  if (FAILED_STATUSES.has((source?.status ?? "").toLowerCase())) {
    return `<li class="pill pill-warning" title="${escapeHtml(label)} · failed">${escapeHtml(label)} · failed</li>`;
  }
  // A1: a source that came in for some positions and failed, with no cached copy, for others says which.
  const missing = Array.isArray(source?.missingPositions) ? source.missingPositions.filter(Boolean) : [];
  if (missing.length) {
    const text = `${label} · ${missing.join(", ")} failed`;
    return `<li class="pill pill-warning" title="${escapeHtml(`${text}; those players are blended without it`)}">${escapeHtml(text)}</li>`;
  }
  const time = localStamp(source?.fetchedAt)?.clock ?? ""; // Adam's local time, not the UTC clock in the stamp
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
export function renderPills(container, { staleIds = [], sources = null, warnings = [], injuryReport = null } = {}) {
  const failedIds = (sources ?? []).filter((s) => FAILED_STATUSES.has((s.status ?? "").toLowerCase())).map((s) => s.id);
  const ids = [...new Set([...(staleIds ?? []), ...failedIds])];
  const sourcePills = ids.map((id) => sourcePillHtml(id, sources, injuryReport)).join("");
  const collapsed = collapseWarnings(warnings);
  const warningPills = collapsed.map(warningPillHtml).join("");
  const all = sourcePills + warningPills;
  // Chips fold into one summary; open state is remembered in this browser.
  const open = Boolean(all) && (Boolean(container.querySelector(".pills-list")?.classList.contains("open")) || storedPillsOpen());
  const summary = all
    ? `<li class="pill pill-warning pills-summary"><button type="button" class="pills-toggle" aria-expanded="${open}">${escapeHtml(pillsSummaryText(ids, sources, collapsed.length, undefined, injuryReport))}</button></li>`
    : "";
  container.innerHTML = all ? `<ul class="pills-list collapsible${open ? " open" : ""}">${summary}${all}</ul>` : "";
  container.hidden = !all;
  container.querySelector(".pills-toggle")?.addEventListener("click", (ev) => {
    const open = container.querySelector(".pills-list").classList.toggle("open");
    ev.currentTarget.setAttribute("aria-expanded", String(open));
    storePillsOpen(open);
  });
}

const PILLS_OPEN_KEY = "nfldfs.pillsOpen";
function storedPillsOpen() {
  try {
    return globalThis.localStorage?.getItem(PILLS_OPEN_KEY) === "1";
  } catch (e) {
    return false; // storage blocked: the summary starts closed
  }
}
function storePillsOpen(open) {
  try {
    globalThis.localStorage?.setItem(PILLS_OPEN_KEY, open ? "1" : "0");
  } catch (e) {
    // storage blocked: not remembered
  }
}

/** The summary chip's text: "2 cached · 1 failed · 3 warnings" (empty states left out). */
export function pillsSummaryText(ids, sources, warningCount = 0, _now = Date.now(), injuryReport = null) {
  const list = ids ?? [];
  const of = (id) => (sources ?? []).find((s) => s.id === id);
  // A1: a source missing whole positions counts as failed here too, as its own pill says.
  const isFailed = (id) =>
    FAILED_STATUSES.has((of(id)?.status ?? "").toLowerCase()) || (of(id)?.missingPositions?.length ?? 0) > 0 ||
    (id === INJURY_SOURCE_ID && injuryPillSuffix(injuryReport) !== null);
  const cachedIds = list.filter((id) => !isFailed(id));
  const failed = list.length - cachedIds.length;
  const parts = [];
  if (cachedIds.length) parts.push(`${cachedIds.length} cached`);
  if (failed) parts.push(`${failed} failed`);
  if (warningCount) parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function renderSlateLine(container, slate) {
  if (!slate) {
    container.textContent = "No slate loaded";
    return;
  }
  const games = Array.isArray(slate.games) ? slate.games.length : 0;
  const weekLabel = slate.week != null ? slate.week : "?";
  const line = `${slate.season ?? "?"} · Week ${weekLabel} · ${games} game${games === 1 ? "" : "s"}`;
  // A7: ?sample=1 shows the frozen dev fixture board; the page says so, and api.js refuses every write.
  container.innerHTML = isSampleMode()
    ? `<span class="sample-tag" title="Sample data from the dev fixture board. Stars, notes, typed numbers and every other change are refused; nothing reaches the server.">SAMPLE DATA · nothing is saved</span> ${escapeHtml(line)}`
    : escapeHtml(line);
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

// TwoGun mode (merge plan 2026-10-15): a two-way switch, Current or TwoGun, after the slate line, and the board-stamp
// pill in #tg-pill under the title (rules repo 2026-10-18, so the header's top line fits at 1366). `mode` is board.mode {active, appliesTo, twogun: {status, boardUpdated, ageAtLockH, stale, covered,
// fallback, note}}; a board without it (an older server) shows nothing. The switch sets the saved source choices (a preset over
// every section), so what it covers is the board's own mode.appliesTo ("classic and Showdown"), worded from it and never
// written here: a mode without it draws no scope and no "Applies to". Mode "custom" (the saved ticks match neither preset)
// lights neither side of the switch and gets its own pill. One pill only: the board stamp when TwoGun's board
// is fresh; one amber stale pill instead when it is stale for any reason (D30 as amended: stamped after lock, over 36
// hours old at lock, its time unreadable, or an older file in use), its sentence in the hover; a missing or failed
// board says the current numbers are showing.
const appliesText = (scope) => (scope ? ` Applies to ${scope}.` : "");

function modePillHtml(cls, text, title) {
  return `<span class="pill ${cls}" title="${escapeHtml(title || text)}">${escapeHtml(text)}</span>`;
}

/** Why a TwoGun board is stale, as {text, sentence}, or null when it is fresh. Age is hours from his stamp to the
 *  first kickoff (server/lib/et.js, worked out on the server); nothing here reads a clock. */
export function staleTwoGun(tg) {
  const age = typeof tg?.ageAtLockH === "number" && Number.isFinite(tg.ageAtLockH) ? Math.round(tg.ageAtLockH * 10) / 10 : null;
  if (age !== null && age < 0) return { text: "TwoGun board stamped after lock", sentence: "TwoGun's board is stamped after the slate's first kickoff." };
  if (tg?.status !== "stale" && !tg?.stale) return null;
  if (age !== null && age > 36) return { text: `TwoGun board ${age} h old at lock`, sentence: `TwoGun's board was made ${age} hours before the first kickoff (over 36), so every TwoGun figure may be out of date.` };
  if (age === null) return { text: "TwoGun board time unknown", sentence: "TwoGun's board time could not be read, so it is treated as stale." };
  return { text: "Older TwoGun file in use", sentence: "An older TwoGun file is in use: the newest one could not be read." };
}

/** The mode box in two parts, { switchHtml, pillHtml }, or null for a board with no mode: the switch stays on the header's
 *  top line, the status pill goes in the row under the title beside the source pills (#tg-pill; Sources fix round 3). */
function modeParts(mode) {
  const active = mode?.active;
  if (active !== "current" && active !== "twogun" && active !== "custom") return null;
  const tg = mode.twogun ?? {};
  const scope = typeof mode.appliesTo === "string" ? mode.appliesTo.trim() : "";
  const btn = (value, label) =>
    `<button type="button" class="tg-mode-btn${active === value ? " active" : ""}" data-mode-set="${value}" aria-pressed="${active === value}">${label}</button>`;
  const applies = appliesText(scope);
  const withScope = (text) => (scope ? `${text} · ${scope}` : text);
  const switchHtml = `<span class="tg-mode-switch" role="group" aria-label="${escapeHtml(scope ? `Numbers for ${scope}` : "Numbers shown")}" title="${escapeHtml(`Whose numbers show: the current sources or TwoGun's.${applies}`)}">${btn("current", "Current")}${btn("twogun", "TwoGun")}</span>`;
  let pill;
  const stale = active === "twogun" && (tg.status === "ok" || tg.status === "stale") ? staleTwoGun(tg) : null;
  if (active === "custom") {
    pill = modePillHtml("pill-mode", withScope("Custom sources"), `Your own choice of sources: the ticks on the Sources page match neither the current sources nor TwoGun only.${applies}`);
  } else if (active === "current") {
    pill = modePillHtml("pill-mode", withScope("Current sources"), `The current sources' blended numbers.${applies}`);
  } else if (stale) {
    const stamp = tg.boardUpdated ? ` Board stamped ${tg.boardUpdated}.` : "";
    pill = modePillHtml("pill-warning", withScope(stale.text), `${stale.sentence}${stamp}${tg.note ? ` ${tg.note}` : ""}${applies}`);
  } else if (tg.status === "ok") {
    const counts = Number.isFinite(tg.covered) ? ` TwoGun covers ${tg.covered} players${Number.isFinite(tg.fallback) ? `; ${tg.fallback} show the current sources' figures, marked` : ""}.` : "";
    pill = modePillHtml("pill-mode", withScope(`TwoGun board ${tg.boardUpdated ?? "(time not given)"}`), `TwoGun's figures as he published them.${counts}${tg.note ? ` ${tg.note}` : ""}${applies}`);
  } else {
    pill = modePillHtml("pill-warning", "No TwoGun board · current numbers shown", `${tg.note || "TwoGun mode is on but no TwoGun board could be read, so the current sources show."}${applies}`);
  }
  return { switchHtml, pillHtml: pill };
}

export function modeBoxHtml(mode) {
  const parts = modeParts(mode);
  return parts ? `${parts.switchHtml}${parts.pillHtml}` : "";
}

/** Draws the mode box into `headerEl` (the classic header), creating it after #slate-line the first time.
 *  `onSwitch(mode)` runs on a click of the mode not showing; both buttons stay off until it settles. */
export function renderModeBox(headerEl, mode, { onSwitch } = {}) {
  if (!headerEl) return;
  const parts = modeParts(mode);
  // The pill goes to #tg-pill when the header has one; a header without it keeps the pill in the box, as before.
  const pillEl = headerEl.querySelector("#tg-pill");
  const html = parts ? (pillEl ? parts.switchHtml : `${parts.switchHtml}${parts.pillHtml}`) : "";
  if (pillEl) {
    pillEl.innerHTML = parts && parts.pillHtml ? parts.pillHtml : "";
    pillEl.hidden = !pillEl.innerHTML;
  }
  let box = headerEl.querySelector("#tg-mode");
  if (!box) {
    if (!html) return;
    box = document.createElement("div");
    box.id = "tg-mode";
    box.className = "tg-mode";
    const line = headerEl.querySelector("#slate-line");
    if (line) line.after(box);
    else headerEl.append(box);
  }
  box.innerHTML = html;
  box.hidden = !html;
  box.dataset.mode = mode?.active ?? "";
  box.querySelectorAll("[data-mode-set]").forEach((b) => {
    b.addEventListener("click", async () => {
      if (b.classList.contains("active") || b.disabled) return;
      const buttons = [...box.querySelectorAll("[data-mode-set]")];
      buttons.forEach((x) => (x.disabled = true));
      try {
        await onSwitch?.(b.dataset.modeSet);
      } finally {
        buttons.forEach((x) => (x.disabled = false));
      }
    });
  });
}

/** 🔵 2026-10-18: the upload status writer: #sd-status while a showdown is on screen (the classic #status is hidden then), else #status. */
export function uploadStatusSetter({ statusEl, sdStatusEl, showdownOn }) {
  let last = null; // this writer's own previous { node, text }; only that is blanked, never another notice
  return (text, isError) => {
    const sd = showdownOn() ? sdStatusEl() : null;
    const node = sd ?? statusEl;
    if (last && last.node !== node && last.node.textContent === last.text) last.node.textContent = "";
    node.textContent = text;
    node.className = isError ? "status error" : "status";
    last = { node, text };
  };
}

/** Entries-upload glue (app.js passes the real functions): on ok from a showdown screen the hash is cleared first, then the Entries tab shows. */
export function entriesUploadedHandler({ upload, showdownOn, clearHash, showEntriesTab }) {
  return async (text) => {
    const r = await upload(text);
    if (r.ok) {
      if (showdownOn()) clearHash();
      showEntriesTab();
    }
    return r;
  };
}

// Wires the upload flow (a salary file is still raw CSV text to POST /api/slate/upload).
// `onUploaded(data)` fires with the raw response so the caller can reload the board and re-render pills
// with real source labels once it lands.
// Adam 2026-10-18: one button for every DraftKings export; routeDkUpload (dk-csv-kind.js) tells the kind from the column
// headers. `onShowdownText(text)` ({ ok, message }) and `onEntriesText(text)` ({ ok, entries, contests } or { ok: false, message })
// come from app.js, as does `setStatus(text, isError)`, the one place a status line is written (🔵 2026-10-18: #sd-status while
// a showdown is on screen, else #status; see uploadStatusSetter). Returns { handleFile }, the same routing for the Entries and
// Showdown buttons; handleFile answers { ok, kind, message }.
export function wireUpload({ csvInput, uploadInfo, slateLine, pillsRow }, { onUploaded, onShowdownText, onEntriesText, setStatus }) {
  const fail = (kind, message) => {
    setStatus(`Upload failed: ${message}`, true);
    return { ok: false, kind, message };
  };
  const classic = async (file, text) => {
    const data = await uploadCsv(text);
    if (data.ok && data.secondSlate) {
      // D57: the file was a second slate (its games are part of the loaded main slate's). The main slate, its
      // upload line and its pills are untouched; the caller reloads the board and switches to the new tile.
      const message = secondSlateSavedText(data.secondSlate);
      setStatus(message, false);
      onUploaded?.(data);
      return { ok: true, kind: "classic", message };
    } else if (data.ok) {
      const message = `Uploaded ${file.name}.`;
      setStatus(message, false);
      uploadInfo.textContent = `${data.savedAs ?? file.name} · uploaded ${localStamp(data.uploadedAt)?.clock ?? data.uploadedAt}`;
      renderSlateLine(slateLine, data);
      // Show pills for this response's own stale list immediately, before the board reloads;
      // board.sources isn't known yet so the id itself is the label (🔵 review requirement).
      renderPills(pillsRow, { staleIds: data.stale, sources: null, warnings: data.warnings });
      onUploaded?.(data);
      return { ok: true, kind: "classic", message };
    }
    return fail("classic", data.error?.message ?? "unknown error");
  };
  const handleFile = async (file) => {
    setStatus(`Uploading ${file.name}...`, false);
    try {
      return await routeDkUpload(file, {
        classic: (text) => classic(file, text),
        showdown: async (text) => {
          const r = await onShowdownText?.(text);
          if (!r?.ok) {
            const message = r?.message ?? "Showdown upload failed: unknown error";
            setStatus(message, true);
            return { ok: false, kind: "showdown", message };
          }
          const message = `Uploaded showdown ${file.name}.`;
          setStatus(message, false);
          return { ok: true, kind: "showdown", message };
        },
        entries: async (text) => {
          const r = await onEntriesText?.(text);
          if (!r?.ok) return fail("entries", r?.message ?? "unknown error");
          const message = `Entries file loaded: ${r.entries} entr${r.entries === 1 ? "y" : "ies"} in ${r.contests} contest${r.contests === 1 ? "" : "s"} · see the Entries tab`;
          setStatus(message, false);
          return { ok: true, kind: "entries", message };
        },
        unknown: (firstLine) => fail("unknown", `This is not a DraftKings salary, showdown or entries export (first line: ${firstLine.slice(0, 80)})`),
      });
    } catch (e) {
      return fail(null, e.message);
    } finally {
      csvInput.value = "";
    }
  };
  csvInput.addEventListener("change", () => {
    const file = csvInput.files?.[0];
    if (file) handleFile(file);
  });
  return { handleFile };
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

// The header's Sources link (Adam 2026-10-18): opens the Sources view (tabs.js SOURCE_TABS); `active` marks it while that view shows.
export function paintSourcesLink(btn, active) {
  if (!btn) return;
  btn.classList.toggle("active", Boolean(active));
  if (active) btn.setAttribute("aria-current", "page");
  else btn.removeAttribute("aria-current");
}

export function wireSourcesLink(btn, { onOpen }) {
  btn?.addEventListener("click", () => onOpen());
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
