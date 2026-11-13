// The Injuries tab (Adam 1:08 PM 11-13: "there can be an Injuries area, I can go turn someone from injured to healthy or vice versa"), on classic and Showdown, app and site.
// Lists every man of the slate on screen whom any injury source tags or hides (DraftKings' Status, ESPN, Sleeper, TwoGun's OUT, a game-day inactive, a ruled-out note) and every man
// Adam set, with what each source says, whether the board hides him now and why (D45, the red OUT tag's reason), his projection now and the In / Out control of status-switch.js
// (the same control and save path as the Sources page's Player status card; the caller wires delegateStatusClicks on the panel). The app keeps hiding by D45 on its own; this
// tab is only where Adam overrides it. A search box finds any man of the slate, so a healthy-looking one can be marked Out too. Markup and the search box only.
import { escapeHtml, money, dec1 } from "./format.js";
import { rowIsOut, STATUS_INFO, outReasonText } from "./table.js";
import { twogunCallsOut, inNeedsNumber, rowHideKind, untagged } from "./out.js";
import { statusSettingOf, listedOut, statusSegHtml } from "./status-switch.js";

const attr = (v) => escapeHtml(String(v ?? ""));
const DASH = "—";
const ESPN_FEED = "ESPN injuries"; // the feed name the boards write on row.injury.source (server/rank/sidelined.js)

/** A status word in the board's own label ("O" -> "Out", "Injured Reserve" -> "IR"); an unread word as written; "" for none. */
function label(raw) {
  const s = String(raw ?? "").trim();
  return s ? STATUS_INFO[s.toLowerCase()]?.label ?? s : "";
}

/** One short cell per source: { text, title } each, text "" when that source says nothing about him. */
export function sourceCells(row) {
  const inj = row?.injury ?? null;
  const fromEspn = inj?.source === ESPN_FEED;
  const fromSleeper = inj?.source === "Sleeper";
  const feedWord = (i) => label(i?.status) || String(i?.unknownStatus ?? "").trim();
  const note = (i) => untagged([i?.comment, i?.longComment].filter(Boolean).join(" ")).trim();
  const flag = (i) => (i?.flagOnly ? " (flag)" : "");
  const dk = label(row?.salaryStatus);
  const espn = fromEspn && feedWord(inj) ? `${feedWord(inj)}${flag(inj)}` : "";
  const other = inj?.otherFeed?.source === "Sleeper" ? label(inj.otherFeed.status) : "";
  const sleeper = fromSleeper && feedWord(inj) ? `${feedWord(inj)}${flag(inj)}` : other ? `${other} (differs from ESPN)` : "";
  const tg = row?.tg ?? null;
  const tgInUse = twogunCallsOut(row);
  const twogun = tg?.call === "OUT" ? (tgInUse ? "OUT" : "OUT (his calls not in use)") : tgInUse ? "OUT" : tg?.call === "PLAY" ? "PLAY" : ""; // his calls are made only on men an injury report lists
  const kind = rowHideKind(row);
  const flags = row?.flags ?? [];
  const rule = flags.includes("outAfterStamp") ? "Ruled out after TwoGun's board" : kind === "inactive" ? "Game-day inactive" : kind === "ruled-out" ? "Ruled out (ESPN note)" : flags.includes("heldOut") ? "Held out (ESPN note)" : "";
  return {
    dk: { text: dk, title: dk ? `DraftKings' salary file lists him ${dk}.` : "" },
    espn: { text: espn, title: fromEspn ? note(inj) : "" },
    sleeper: { text: sleeper, title: fromSleeper ? note(inj) : other ? "Sleeper's word differs from ESPN's; ESPN's stands and Sleeper's is a flag only." : "" },
    twogun: { text: twogun, title: untagged(tg?.callText ?? "") || (tgInUse && !tg ? "TwoGun's board lists him out." : "") },
    rule: { text: rule, title: rule ? (tg?.heldOut || note(inj)) : "" },
  };
}

/** True when any injury source tags him, a source hides him, or Adam set him. */
export function isTagged(row) {
  if (statusSettingOf(row) || rowIsOut(row) || listedOut(row)) return true;
  if ((row?.flags ?? []).some((f) => f === "injured" || f === "outAfterStamp" || f === "heldOut")) return true;
  return Object.values(sourceCells(row)).some((c) => c.text);
}

/** The Hidden cell: { hidden, short, why } (D45): the board's own reason (the OUT tag's hover) for a hidden man; what keeps a listed man shown otherwise. */
export function hiddenCell(row) {
  if (rowIsOut(row)) {
    const kind = rowHideKind(row);
    const flags = row?.flags ?? [];
    const dk = label(row?.salaryStatus);
    const short = statusSettingOf(row) === "out" ? "You marked him Out"
      : flags.includes("outAfterStamp") ? "Ruled out after TwoGun's board"
        : twogunCallsOut(row) ? "TwoGun: OUT"
          : kind === "inactive" ? "Game-day inactive"
            : kind === "ruled-out" ? "Ruled out (ESPN note)"
              : dk && dk === label(row?.status) ? `DraftKings: ${dk}`
                : `Listed ${label(row?.status) || "injured"}`;
    return { hidden: true, short, why: outReasonText(row) };
  }
  if (statusSettingOf(row) === "in" && listedOut(row)) return { hidden: false, short: "Shown: your In", why: "You marked him In: the sources' out reading is set aside and he is projected as normal." };
  if ((row?.flags ?? []).includes("revived")) return { hidden: false, short: "Shown: your typed number", why: "A projection you typed above 0 puts him back in (D45)." };
  if (row?.injury?.flagOnly) return { hidden: false, short: "Shown: a flag only", why: "An outside feed's tag alone hides no one (D45)." };
  return { hidden: false, short: "Shown", why: "" };
}

/** The projection cell: { text, title, missing }. Missing is said as missing, never 0; an out man counts 0. */
export function projCell(row) {
  const typed = row?.override?.proj;
  const hasTyped = typeof typed === "number" && Number.isFinite(typed);
  const proj = row?.proj;
  if (rowIsOut(row)) return { text: "0", title: "Hidden, so he counts 0.", missing: false };
  const noNumber = proj == null || !Number.isFinite(Number(proj)) || (!hasTyped && (row?.flags ?? []).includes("no projection"));
  if (noNumber || inNeedsNumber(row)) return { text: "missing", title: "No source has a number for him: type one in Proj on the Optimizer (he stays listed there).", missing: true };
  const from = hasTyped ? "yours" : row?.src?.proj === "twogun" ? "TwoGun" : "blend";
  return { text: dec1(Number(proj)), from, title: hasTyped ? "Your typed number." : from === "TwoGun" ? "TwoGun's projection." : "The sources' blend.", missing: false };
}

const weight = (row) => (rowIsOut(row) ? 0 : isTagged(row) ? 1 : 2);
const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The rows the tab lists: every tagged or set man, or with `search` every man whose name (or team code) matches. One row per man; hidden first, then tagged, then the rest, each by salary high to low. */
export function injuryRows(rows, { search = "" } = {}) {
  const q = plain(search).trim();
  const seen = new Set();
  const out = [];
  for (const r of rows ?? []) {
    if (!r || r.id == null || seen.has(String(r.id))) continue;
    const keep = q ? plain(r.name).includes(q) || plain(r.team) === q : isTagged(r);
    if (!keep) continue;
    seen.add(String(r.id));
    out.push(r);
  }
  return out.sort((a, b) => weight(a) - weight(b) || (Number(b.salary) || 0) - (Number(a.salary) || 0) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

const cellHtml = (cls, { text, title }) => `<td class="${cls}"${title ? ` title="${attr(title)}"` : ""}>${text ? escapeHtml(text) : `<span class="sp-quiet">${DASH}</span>`}</td>`;

function rowHtml(r, canWrite) {
  const s = sourceCells(r);
  const h = hiddenCell(r);
  const p = projCell(r);
  const hidden = `<td class="inj-c-hid"${h.why ? ` title="${attr(h.why)}"` : ""}><span class="st-counts ${h.hidden ? "st-counts-out" : "st-counts-in"}">${h.hidden ? "Hidden" : "Shown"}</span>${h.hidden || h.short !== "Shown" ? ` <span class="sp-quiet">${escapeHtml(h.hidden ? h.short : h.short.replace(/^Shown:\s*/, ""))}</span>` : ""}</td>`;
  const proj = `<td class="inj-c-proj${p.missing ? " inj-missing" : ""}" title="${attr(p.title)}">${escapeHtml(p.text)}${p.from ? ` <span class="sp-quiet">${escapeHtml(p.from)}</span>` : p.missing ? ` <span class="sp-quiet">type one on the Optimizer</span>` : ""}</td>`;
  return `<tr data-id="${attr(r.id)}"><td class="st-c-name">${escapeHtml(r.name ?? "")}</td><td>${escapeHtml(r.team ?? "")}</td><td>${escapeHtml(r.pos ?? "")}</td><td class="inj-c-num">${r.salary == null ? DASH : escapeHtml(money(r.salary))}</td>`
    + `${cellHtml("inj-c-src", s.dk)}${cellHtml("inj-c-src", s.espn)}${cellHtml("inj-c-src", s.sleeper)}${cellHtml("inj-c-src", s.twogun)}${cellHtml("inj-c-src", s.rule)}`
    + `${hidden}${proj}<td class="st-c-set">${statusSegHtml(r, canWrite)}</td></tr>`;
}

const HEAD = ["Player", "Team", "Pos", "Salary", "DraftKings", "ESPN", "Sleeper", "TwoGun", "Inactive / ruled out", "Board now", "Proj", "In / Out"];

/** The table and its count line for `rows` (the slate on screen's board rows). */
export function injuriesTableHtml(rows, { search = "", canWrite = true } = {}) {
  const list = injuryRows(rows, { search });
  const hidden = list.filter((r) => rowIsOut(r)).length;
  const mine = list.filter((r) => statusSettingOf(r)).length;
  const q = String(search ?? "").trim();
  const count = `${list.length} ${q ? `found for "${escapeHtml(q)}"` : "listed"}${hidden ? `, ${hidden} hidden` : ""}${mine ? `, ${mine} set by you` : ""}`;
  const empty = q ? "No player on this slate matches." : "No source tags anyone on this slate, and you have set no one. Search to mark a player Out.";
  const body = list.length ? list.map((r) => rowHtml(r, canWrite)).join("") : `<tr><td colspan="${HEAD.length}" class="sp-quiet">${escapeHtml(empty)}</td></tr>`;
  return `<span class="inj-count" data-inj-count>${count}</span><table class="st-table inj-table"><thead><tr>${HEAD.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

const searchOf = new WeakMap(); // container -> the search text typed on its tab (kept for the page's life, like the pools' filters)
const drawnOf = new WeakMap(); // container -> { rows, canWrite } last drawn, which a keystroke in the search box draws again

/**
 * Draws the tab into `container` (#injuries-panel or #sd-injuries-panel). The search box is drawn once and kept, so a redraw (a board answer after a switch) never takes its
 * caret; only the table under it is redrawn. `rows`: the slate on screen's rows. `canWrite` false: his setting as a word, no buttons.
 */
export function renderInjuriesPanel(container, rows, { canWrite = true } = {}) {
  if (!container) return;
  let host = container.querySelector("[data-inj-host]");
  if (!host) {
    container.innerHTML = `<div class="sp-panel inj-panel"><div class="sp-ch"><h3 class="sp-h">Injuries</h3><input type="search" class="inj-search" data-inj-search placeholder="Find any player to set" aria-label="Find any player on this slate" /><div class="sp-ch-r" data-inj-count-host></div></div><div data-inj-host></div></div>`;
    host = container.querySelector("[data-inj-host]");
    const box = container.querySelector("[data-inj-search]");
    box.value = searchOf.get(container) ?? "";
    box.addEventListener("input", () => {
      searchOf.set(container, box.value);
      const last = drawnOf.get(container) ?? { rows: [], canWrite: false };
      draw(container, host, last.rows, last.canWrite);
    });
  }
  drawnOf.set(container, { rows: rows ?? [], canWrite });
  draw(container, host, rows ?? [], canWrite);
}

function draw(container, host, rows, canWrite) {
  host.innerHTML = injuriesTableHtml(rows, { search: searchOf.get(container) ?? "", canWrite });
  const count = host.querySelector("[data-inj-count]");
  const countHost = container.querySelector("[data-inj-count-host]");
  if (count && countHost) {
    countHost.innerHTML = count.innerHTML;
    count.remove();
  }
}
