// The player-list cells every classic table shares: the status badges and the red OUT tag, TwoGun's markers and Med, Nuke, 3x% and 4x% cells, the Tags cell, the graded number, the
// matchup text and the sort arrow. The ranked list that used to draw them (renderTableHead, renderTableBody, the click-to-type wiring) is retired: the Optimizer's pool
// (lineup-pool.js, optimizer standard C9, C10, C17, round 5) draws these cells and lineup-pool-edit.js wires the typed boxes. Rows with a null projection show "no proj" and stay visible
// (D27); a player nobody published an ownership number for shows an em dash in Own (still click-to-type, D28); the app never estimates one. There is no Lev column (A2).
import { escapeHtml, money, dec1, dec2 } from "./format.js";
import { store } from "./state.js";
import { twoGunOutReason, rowIsOut, untagged, revivedStatusTitle } from "./out.js";

// TwoGun mode only (D25 as amended 2026-10-15: his published figures used as he publishes them): four more columns after Val, each read from row.tg and sortable (state.js sortValue). Current
// mode never shows them. The Ceil and Ceil/$ columns were removed (optimizer standard A21, 2026-11-03).
export const TG_COLUMNS = [
  { key: "tgMed", label: "Med", field: "median", title: "TwoGun's median, DraftKings points as he publishes them" },
  { key: "tgNuke", label: "Nuke", field: "nuke", title: "TwoGun's nuke (top-end) outcome, DraftKings points as he publishes them" },
  { key: "tgP3x", label: "3x%", field: "p3x", title: "TwoGun's chance (percent) of 3x salary value, as he publishes it" },
  { key: "tgP4x", label: "4x%", field: "p4x", title: "TwoGun's chance (percent) of 4x salary value, as he publishes it" },
];

// Adam 2026-10-15 (TwoGun merge, adjustment 1): "put a red 'OUT' tag or something obvious so I can see it". A row ruled out after TwoGun's board stamp (flag "outAfterStamp") or one TwoGun
// calls OUT carries a red OUT tag beside the name (drawn by player-row.js since D80). Such a row gets no Value grade either. The one copy of the test and the tag.
export { twoGunOutReason, rowIsOut };

export function outTagHtml(row) {
  const reason = twoGunOutReason(row);
  return reason ? `<span class="out-tag" title="${escapeHtml(reason)}">OUT</span>` : "";
}

/** R82: the red OUT tag on the Optimizer, keyed on rowIsOut (Out, Doubtful and IR all count). */
export function lineupOutTagHtml(row) {
  if (!rowIsOut(row)) return "";
  let title = twoGunOutReason(row);
  if (!title) {
    const raw = (row.status || row.injury?.status || "").trim();
    const word = raw ? (STATUS_INFO[raw.toLowerCase()]?.label ?? raw) : "out";
    const comment = (row.injury?.comment ?? "").trim();
    title = `Listed ${word} on the injury report${comment ? `. ${comment}` : "."}`;
  }
  return `<span class="out-tag" title="${escapeHtml(title)}">OUT</span>`;
}

// TwoGun-mode markers: the same small amber dot as the A1 marker, its sentences on hover. Nothing shows in current mode
// (rows there carry no tg or src). A figure TwoGun does not cover is the current sources' and says so (row.src).
export function markerHtml(texts) {
  const list = texts.filter(Boolean);
  return list.length ? `<sup class="row-flag-marker tg-marker" title="${escapeHtml(list.join(" "))}">&#8226;</sup>` : "";
}

/** The hover sentences for one cell ("proj", "own", "salary", "status") of a TwoGun-mode row. The "status"
 *  dot follows the name in the Player cell (Adam 2026-10-18 Q1: the Status column is gone). */
export function twoGunMarkerTexts(row, field) {
  const src = row?.src;
  if (!src && !row?.tg) return [];
  const flags = Array.isArray(row?.flags) ? row.flags : [];
  const tg = row?.tg ?? null;
  const texts = [];
  // Visual QA 2026-10-15: dots only for per-row facts (not projected by TwoGun, salary differs, status changed); the
  // board's staleness is the header's one pill, never a dot or a colour on each figure.
  const projFallback = Boolean(src?.proj && src.proj !== "twogun");
  const ownFallback = Boolean(src?.own && src.own !== "twogun");
  if (field === "proj") {
    if (projFallback) texts.push(`TwoGun does not project him; this is the current sources' blend${ownFallback ? ", and so is his Own" : ""}.`);
  } else if (field === "own") {
    if (ownFallback && !projFallback) texts.push("TwoGun publishes no ownership for him; this is the current sources' Own.");
  } else if (field === "salary") {
    if (flags.includes("salaryDiffers")) texts.push(`TwoGun lists ${money(tg?.salary)}; DraftKings' ${money(row.salary)} is used for Val and the Optimizer (D13).`);
  } else if (field === "status") {
    if (flags.includes("statusChangedAfterStamp")) {
      texts.push(`His status changed after TwoGun's board was made${tg?.official ? ` (TwoGun quoted ${tg.official})` : ""}${rowIsOut(row) ? "." : "; TwoGun's number is kept."}`);
      if (tg?.call) texts.push(`TwoGun's call: ${tg.call}${tg.tag ? ` [${tg.tag}]` : ""}${untagged(tg.callText) ? `: ${untagged(tg.callText)}` : "."}`);
    }
  }
  return texts;
}

// One decimal, as he publishes them; the 3x% and 4x% headers carry the percent sign so the narrow cells never clip.
export function tgCellHtml(row, col) {
  const v = row.tg?.[col.field];
  if (v == null || Number.isNaN(v)) return "—";
  const text = dec1(v);
  const grade = row.tgGrade?.[col.field]; // Nuke and 4x% are graded like Value (grade.js, D33)
  return grade ? `<span class="grade-cell grade-${grade}">${text}</span>` : text;
}

// Injury-report status words (R82): each gets a badge; which rows dim is rowIsOut's (below).
// Exported so public/js/showdown/table.js and lineup.js can reuse these instead of keeping their own
// copies (🔵 review cleanup).
export const STATUS_INFO = {
  o: { label: "Out", short: "O", cls: "status-out" },
  out: { label: "Out", short: "O", cls: "status-out" },
  d: { label: "Doubtful", short: "D", cls: "status-doubtful" },
  doubtful: { label: "Doubtful", short: "D", cls: "status-doubtful" },
  q: { label: "Questionable", short: "Q", cls: "status-questionable" },
  questionable: { label: "Questionable", short: "Q", cls: "status-questionable" },
  ir: { label: "IR", short: "IR", cls: "status-ir" },
  suspended: { label: "Suspended", short: "SUSP", cls: "status-ir" },
  susp: { label: "Suspended", short: "SUSP", cls: "status-ir" },
  pup: { label: "PUP", short: "PUP", cls: "status-ir" },
  "injured reserve": { label: "IR", short: "IR", cls: "status-ir" },
  suspension: { label: "Suspended", short: "SUSP", cls: "status-ir" },
  "physically unable to perform": { label: "PUP", short: "PUP", cls: "status-ir" },
};

/** The status tag for player lists (never on a lineup): the short word, the full word and notes on hover. */
export function statusBadgeHtml(row, word = row?.status) {
  const raw = (word ?? "").trim();
  if (!raw) return "";
  const info = STATUS_INFO[raw.toLowerCase()];
  const why = untagged(row?.tg?.callText);
  // A row whose status TwoGun's own call replaced (src.status "twogun") and who is not called OUT: the report's word stays on the badge, with his call beside it.
  const playsOnHisWord = row?.src?.status === "twogun" && row?.tg?.call !== "OUT" ? "TwoGun lists him as playing." : "";
  const notes = [(row?.injury?.comment ?? "").trim(), why ? `TwoGun${row.tg.tag ? ` [${row.tg.tag}]` : ""}: ${why}` : "", playsOnHisWord].filter(Boolean).join(" ");
  const title = (head) => escapeHtml(notes ? `${head}. ${notes}` : head);
  const revived = revivedStatusTitle(row, info?.label ?? raw);
  if (revived) return `<span class="status-badge status-revived" title="${title(revived)}">${escapeHtml(info?.short ?? raw)}</span>`;
  if (info) return `<span class="status-badge ${info.cls}" title="${title(info.label)}">${escapeHtml(info.short)}</span>`;
  return `<span class="status-badge status-other" title="${title(raw)}">${escapeHtml(raw)}</span>`;
}

const PROJ_FLAG_LABELS = {
  thin: "Sources making up less than half the blend's weight cover this player; the projection is theirs alone.",
  injured: "Flagged injured; may affect availability this week.",
  injuryUnknown: "No projection: no source covers this player and the injury report is missing.",
};

// Every tag is a researched one (review Q1, Adam 2026-10-14: the computed chalk and value tags are gone); a
// researcher's "chalk" and "value" keep their colours.
function tagClass(tag) {
  if (tag === "chalk") return "tag-pill tag-chalk";
  if (tag === "value") return "tag-pill tag-value";
  return "tag-pill tag-other";
}

/** D43: the matchup as "vs DAL" (his team is at home) or "@ DET" (away), from the game key "AWAY@HOME"; the row's
 *  own opponent text when the game key does not place his team, and blank with neither. The one copy: the Optimizer pools, the Projections and Projected Ownership tables and the
 *  Optimizer (lineup.js) all use it. */
export function matchupText(row) {
  const m = /^([A-Z0-9]+)@([A-Z0-9]+)$/i.exec(String(row?.gameId ?? ""));
  const team = String(row?.team ?? "").toUpperCase();
  if (m && team && m[2].toUpperCase() === team) return `vs ${m[1]}`;
  if (m && team && m[1].toUpperCase() === team) return `@ ${m[2]}`;
  return row?.opp ? String(row.opp) : "";
}

/** The words the user reads for an opponent (Adam 2026-11-09): "v CHI" (his team is home), "@TB" (away); a raw opponent with a leading vs/@ is handled the same way, a bare code is shown as is; "" when unknown.
 *  Display only: parsers keep reading matchupText's "vs X" / "@ X". */
export function opponentLabel(row) {
  const text = matchupText(row).trim();
  const m = /^(vs|@)\s*(.*)$/i.exec(text);
  const code = (m ? m[2] : text).trim();
  if (!code) return "";
  if (!m) return code;
  return m[1] === "@" ? `@${code}` : `v ${code}`;
}

/**
 * A1: one sentence per blended source that failed for this player's position this run ("sourceFailed:<id>" flags,
 * server/rank/board.js), named by its label: "CBS Sports failed for TE this run and has no cached copy, so Proj is
 * blended without it." `sources`: board.sources (the loaded board's by default); the id stands in for a source the
 * board does not list. Shared by the pool's Proj cell and the Projections tab's Coverage cell.
 */
export function sourceFailedTexts(row, sources = store.get().board?.sources) {
  const labelOf = (id) => (sources ?? []).find((s) => s && s.id === id)?.label ?? id;
  const pos = row?.pos ? String(row.pos) : "his position";
  return (row?.flags ?? [])
    .filter((f) => typeof f === "string" && f.startsWith("sourceFailed:"))
    .map((f) => `${labelOf(f.slice("sourceFailed:".length))} failed for ${pos} this run and has no cached copy, so Proj is blended without it.`);
}

/** A1: the flag marker (a small dot with the sentences on hover) for the sourceFailed flags alone, or "". */
export function sourceFailedMarkerHtml(row, sources) {
  const texts = sourceFailedTexts(row, sources);
  return texts.length ? `<sup class="row-flag-marker" title="${escapeHtml(texts.join(" "))}">&#8226;</sup>` : "";
}

/** The Proj cell's flag dot: thin coverage, injured, unknown injury, and a source that failed for his position. */
export function projFlagMarkerHtml(row) {
  const flags = row.flags ?? [];
  const present = ["thin", "injured", "injuryUnknown"].filter((f) => flags.includes(f) && !(f === "injured" && flags.includes("revived")));
  const failedText = sourceFailedTexts(row);
  if (!present.length && !failedText.length) return "";
  const title = [...present.map((f) => PROJ_FLAG_LABELS[f] ?? f), ...failedText].join(" ");
  return `<sup class="row-flag-marker" title="${escapeHtml(title)}">&#8226;</sup>`;
}

export function gradedCellHtml(value, grade) {
  if (value == null || Number.isNaN(value)) return "—";
  const cls = grade ? ` grade-${grade}` : "";
  return `<span class="grade-cell${cls}">${dec2(value)}</span>`;
}

export function tagsCellHtml(row) {
  if (!row.tags || !row.tags.length) return "";
  return row.tags
    .map((t) => {
      const reason = t.reason ?? "";
      // No character cap here (👁 visual-qa third pass): the Tags cell's own nowrap/ellipsis (.tag-reason,
      // style.css) already trims to whatever width the column actually has, so a fixed 55-char cut was
      // sometimes shorter than the room available and other times still overflowing. The full reason is
      // still the hover title on the pill itself, on the reason span, and on the cell as a whole (👁
      // visual-qa fourth pass) since the ellipsis can land mid-word with no other way to read the rest.
      const pill = `<span class="${tagClass(t.tag)}" title="${escapeHtml(reason)} — ${escapeHtml(t.source ?? "")}">${escapeHtml(t.tag)}</span>`;
      const reasonHtml = reason ? `<span class="tag-reason" title="${escapeHtml(reason)}">${escapeHtml(reason)}</span>` : "";
      return `<span class="tag-item">${pill}${reasonHtml}</span>`;
    })
    .join(" ");
}

// Hover text for the whole tags cell, one entry per tag, "tag: reason" (just "tag" when it has no reason), so a pill the
// narrow cell clips is still readable (👁 visual-qa fourth pass; every tag listed, round 4).
export function tagsCellTitle(row) {
  if (!row.tags || !row.tags.length) return "";
  return row.tags
    .map((t) => {
      const name = String(t.tag ?? "").trim();
      const reason = (t.reason ?? "").trim();
      return reason ? `${name}: ${reason}` : name;
    })
    .filter(Boolean)
    .join(" · ");
}

/** The status tag(s) of one player-list row: the board status, then the injury report's word when it adds one, then a word
 *  the report used that the app does not read (row.injury.unknownStatus, G62: shown as written, never taken as a status). */
export function statusTagsHtml(row) {
  const key = (row.status ?? "").trim().toLowerCase();
  const injuryStatus = row.injury?.status;
  const same = injuryStatus && (injuryStatus.toLowerCase() === key || (STATUS_INFO[key] && STATUS_INFO[key].label === STATUS_INFO[injuryStatus.toLowerCase()]?.label));
  // With a board status of its own, the second (injury report) badge says nothing of TwoGun's call (src left off).
  const injuryHtml = injuryStatus && !same ? statusBadgeHtml({ ...row, tg: key ? null : row.tg, src: key ? undefined : row.src, injury: key ? { ...row.injury, comment: "" } : row.injury, flags: [] }, injuryStatus) : "";
  return `${statusBadgeHtml(row)}${injuryHtml}${unknownStatusHtml(row)}`;
}

/** The badge for a status word the injury report used that the app does not read, or "". */
export function unknownStatusHtml(row) {
  const word = typeof row?.injury?.unknownStatus === "string" ? row.injury.unknownStatus.trim() : "";
  if (!word) return "";
  const comment = (row.injury.comment ?? "").trim();
  const title = `${row.injury.source ?? "The injury report"} lists him as "${word}", a word this app does not read as an injury status, so he is treated as having none.${comment ? ` ${comment}` : ""}`;
  return `<span class="status-badge status-other" title="${escapeHtml(title)}">${escapeHtml(word)}</span>`;
}

// The one copy of the sort arrow (PROJECT.md D80). The space before it is an escaped no-break space (U+00A0) so the arrow stays on the last word's line.
// `reserve` (the Projections and Ownership tables) draws it on every header, hidden when not sorted, so a sort click never moves a column.
export function sortArrowText(dir) {
  return `\u{a0}${dir === "asc" ? "▲" : "▼"}`;
}
export function sortArrowHtml(active, dir, reserve = false) {
  if (!active && !reserve) return "";
  return `<span class="sort-arrow${active ? "" : " is-idle"}"${active ? "" : ' aria-hidden="true"'}>${sortArrowText(active ? dir : "desc")}</span>`;
}

// The typed-number box is typed-edit.js's (moved there in round 4, so the Showdown pool and the classic pool use the same one); re-exported for the callers that still read it here.
export { EDIT_HINT, NOT_SAVED_TEXT, readTypedNumber, closeDecision, startEdit, showNotSaved } from "./typed-edit.js";
