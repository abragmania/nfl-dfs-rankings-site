// The Entries screen's frame in NBA's look (NBA lsw-main.js barHtml, lsw-upload.js uploadHtml, lsw-export.js exportHtml and lsw-maps.js
// tabStatus, copied and turned to NFL's entries; PROJECT.md Part 4 "Monday 11-23 complaints" item 7): the top bar with the figures and
// Download, the three numbered steps, the Upload screen and the Download screen. Pure builders; entries.js draws step 2 (the rows) and
// puts these around it. Imports only format.js, lineup-tags.js and totals.js, never entries.js.
import { escapeHtml, dec1 } from "./format.js";
import { lineupLabel } from "./lineup-tags.js";
import { shownTotal } from "./totals.js";

const esc = escapeHtml;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The DraftKings classic roster columns the Upload screen names (server/lineup/dk-entries.js DK_CLASSIC_SLOTS). */
export const CLASSIC_ROSTER_COLUMNS = Object.freeze(["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"]);
/** The Showdown roster columns (server/lineup/dk-showdown-entries.js DK_SHOWDOWN_SLOTS), for the Showdown tab's config. */
export const SHOWDOWN_ROSTER_COLUMNS = Object.freeze(["CPT", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX"]);

const STEPS = [
  ["Upload", "Drop the entries CSV from DraftKings (Lineups, Edit Entries, Download CSV). Every entry row is read with its contest."],
  ["Give lineups", "Each contest is offered your saved lineups 1, 2, 3 in number order, one per entry. Double ups, 50/50s and head-to-heads are Cash and take your Cash lineups; everything else is GPP."],
  ["Confirm", "Suggestions are not written until you confirm them, per GPP and Cash tab. A row you set by hand stays as you set it."],
  ["Download", "Your file comes back byte for byte except the player cells of the rows with a lineup. Upload it on DraftKings' Upload Lineups page. Refused after the first kickoff."],
];

/** The one-line status of each numbered step, { text, bad }: red when something still needs doing (NBA tabStatus). `s`: { file, entries,
 *  contests, n, waiting, locked, downloaded, noLineups }. */
export function stepStatus(s) {
  return {
    upload: s.file ? { text: `${plural(s.entries, "entry", "entries")} in ${plural(s.contests, "contest", "contests")}`, bad: false } : { text: "No file yet", bad: true },
    entries: s.noLineups
      ? { text: "No saved lineups for this slate yet", bad: true }
      : { text: `${s.n} of ${s.entries} have a lineup${s.waiting ? `, ${s.waiting} suggested and not confirmed` : ""}`, bad: s.waiting > 0 || s.n === 0 },
    export: s.locked ? { text: "Locked: the first game has kicked off", bad: true } : s.downloaded ? { text: `Downloaded ${s.downloaded}`, bad: false } : s.n ? { text: `${plural(s.n, "entry", "entries")} ready to write`, bad: false } : { text: "Nothing to write yet", bad: true },
  };
}

/** The three numbered steps (NBA's tabs3). `screen`: "upload" | "entries" | "export". */
export function stepsNavHtml(screen, st) {
  const tab = (k, n, title) => `<button type="button" class="tab3${screen === k ? " on" : ""}${st[k].bad ? " bad" : ""}" data-action="entries-go" data-screen="${k}"${screen === k ? ' aria-current="step"' : ""}><b>${n}</b><span class="tt">${title}</span><small>${esc(st[k].text)}</small></button>`;
  return `<nav class="tabs3" aria-label="Entries steps">${tab("upload", 1, "Upload file")}${tab("entries", 2, "Entries → Lineups")}${tab("export", 3, "Download")}</nav>`;
}

/** The top bar (NBA barHtml): the slate, the figures, the file chooser when the week has two slates' files, New DK file and Download.
 *  `b`: { f, label, entries, contests, gpp, cash, n, waiting, locked, busy, dlTitle, files: [{ file, label }] }. */
export function barHtml(b) {
  const chips = (b.files ?? []).length > 1
    ? `<div class="gms"><span class="gl">FILES</span>${b.files.map((x) => `<button type="button" class="fc${x.file === b.f.file ? " on" : ""}" data-action="entries-open-file" data-file="${esc(x.file)}" title="${esc(x.file)}">${esc(x.label)}</button>`).join("")}</div>`
    : "";
  const stat = (small, big, sub, cls = "", title = "") => `<div class="bst${cls === "red" ? " entries-locked" : ""}"${title ? ` title="${esc(title)}"` : ""}><small>${small}</small><b class="${cls}">${big}</b><span>${sub}</span></div>`;
  const off = b.n === 0 || b.busy || Boolean(b.locked);
  return `<div class="bar"><div class="barl"><div class="barr">
${stat("SLATE", esc(b.label), "your DraftKings entries file", "", `Entries file: ${b.f.file}`)}
${stat("ENTRIES", b.entries, `in ${plural(b.contests, "contest", "contests")}`)}
${stat("GPP · CASH", `${b.gpp} · ${b.cash}`, "entries")}
${stat("WILL CHANGE", b.n, `of ${b.entries} have a lineup`, b.n ? "pk" : "")}
${stat("SUGGESTED", b.waiting, b.waiting ? "not confirmed yet" : "nothing waiting", b.waiting ? "am" : "")}
${b.locked ? stat("LOCK", "Locked", "the first game has kicked off", "red", b.locked) : ""}</div>${chips}</div>
<div class="barx"><button type="button" class="ol" data-action="entries-upload" title="Read a fresh DraftKings entries file; you can also drop it anywhere on this screen">New DK file</button><button type="button" class="go" data-action="entries-download" data-file="${esc(b.f.file)}" title="${esc(b.dlTitle)}"${off ? " disabled" : ""}>${b.busy ? "Preparing…" : `Download for DraftKings (${b.n})`}</button></div></div>`;
}

/** Screen 1 (NBA uploadHtml): the drop box, how entries work, the columns the app reads and this week's files. `m`: the section model
 *  (uploading, files, emptyText, rosterColumns). One wording for the app and the site (G74): the app keeps the file on this machine, the
 *  site in the visitor's browser. */
export function uploadScreenHtml(m) {
  const cols = ["Entry ID", "Contest Name", "Contest ID", "Entry Fee", ...(m.rosterColumns ?? [])];
  const roster = m.rosterColumns ? "" : `<span class="wide">then the roster columns</span>`;
  const kept = "the file is kept (the app: on this computer; the website: in this browser only), so your picks are still here after a reload";
  const files = m.files ?? [];
  return `<div class="up-grid">
<section class="drop" data-drop tabindex="0">
<svg style="width:3.25rem;height:3.25rem" viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M26 36V10M14 21l12-12 12 12M8 38v6h36v-6"/></svg>
<h2>Drop your DraftKings entries file here</h2>
<p>The CSV from DraftKings: Lineups, Edit Entries, Download CSV. Every entry row is read, then each entry is given one of your saved lineups.</p>
<div class="dbtn"><button type="button" class="go" data-action="entries-upload"${m.uploading ? " disabled" : ""}>${m.uploading ? "Uploading…" : "Choose file"}</button></div>
<small>DKEntries.csv · ${kept}</small>
</section>
<aside class="how">
<h4>How entries work</h4>
${STEPS.map((s, i) => `<div class="step"><b>${i + 1}</b><div><h3>${s[0]}</h3><p>${esc(s[1])}</p></div></div>`).join("")}
</aside>
<section class="cols"><h4>What the app looks for in the file</h4><div class="colgrid">${cols.map((c) => `<span>${esc(c)}</span>`).join("")}${roster}</div></section>
<section class="recent"><h4>Files this week</h4>
${files.length ? files.map((f) => `<div class="ru"><b>${esc(f.slate?.label ?? "Unknown slate")}</b><span class="en">${plural((f.entries ?? []).length, "entry", "entries")}</span><span class="fname" title="${esc(f.file)}">${esc(f.file)}</span><button type="button" class="ol" data-action="entries-open-file" data-file="${esc(f.file)}">Open</button></div>`).join("") : `<div class="ru dim entries-empty">${esc(m.emptyText)}</div>`}
</section></div>`;
}

/**
 * Screen 3 (NBA exportHtml): the Download tile, the checks, the rows that will change and the rows left as they are. `x`: { f, entries,
 * eff, lineups, numbers, waiting, locked, busy, dlTitle, resultHtml, summaryOf, nameOf, classOf }.
 */
export function exportScreenHtml(x) {
  const byId = new Map((x.lineups ?? []).map((l) => [String(l.id), l]));
  const n = Object.keys(x.eff).length;
  const total = x.entries.length;
  const changing = x.entries.filter((e) => x.eff[e.entryId]);
  const left = x.entries.filter((e) => !x.eff[e.entryId]);
  const off = n === 0 || x.busy || Boolean(x.locked);
  const nameOf = x.nameOf ?? lineupLabel;
  const projOf = (l) => {
    const p = (l?.slots ?? []).map((s) => s?.proj);
    const known = p.filter((v) => typeof v === "number" && Number.isFinite(v)).length;
    return known > 0 && known < p.length ? null : dec1(shownTotal(p) ?? l?.totalProj); // G62: as lineupOptionLabel, one slot without a projection makes the total missing
  };
  const rows = changing.map((e) => {
    const l = byId.get(String(x.eff[e.entryId]));
    const now = x.summaryOf(e.current);
    const proj = projOf(l);
    return `<div class="et"><span class="cn">${esc(e.contestName)}</span><span class="id">${esc(e.entryId)}</span><span class="cls">${x.classOf(e) === "cash" ? "Cash" : "GPP"}</span><span class="out"${now.title ? ` title="${esc(now.title)}"` : ""}>${esc(now.text)}</span><span>→</span><span class="in">${esc(l ? nameOf(l, x.numbers) : "")}</span><span class="r">${proj ?? "—"}</span></div>`;
  }).join("");
  return `<div class="tiles">
<button type="button" class="tile am" data-action="entries-download" data-file="${esc(x.f.file)}" title="${esc(x.dlTitle)}"${off ? " disabled" : ""}><h2>${x.busy ? "Preparing…" : `Download for DraftKings (${n})`}</h2><p>${n ? `Your uploaded file with the lineups of ${plural(n, "entry", "entries")} written in; the other ${total - n} ${total - n === 1 ? "row stays" : "rows stay"} byte for byte as uploaded.` : "Give at least one entry a lineup in step 2 first."}</p></button>
<div class="checks">
<div class="ck ${n ? "ok" : "bad"}">${n ? "✓" : "✗"} ${n} of ${plural(total, "entry has", "entries have")} a lineup and will change</div>
${x.waiting ? `<div class="ck amb">⚠ ${plural(x.waiting, "suggestion is", "suggestions are")} not confirmed, so not in the file. <button type="button" class="lnk" data-action="entries-go" data-screen="entries">Confirm in step 2</button></div>` : `<div class="ck ok">✓ No suggestion waiting</div>`}
<div class="ck ${x.locked ? "bad" : "ok"}">${x.locked ? `✗ ${esc(x.locked)}` : "✓ The kickoff is checked again when you download"}</div>
<div class="ck muted">Every lineup is checked when you download: salary cap, positions, players on this slate, never the same lineup twice in a contest. A failed check refuses the file and names the entry.</div>
</div></div>
${x.resultHtml}
<div class="mapcol xt"><div class="mh"><span class="t">Will change</span><span class="muted">${plural(n, "entry", "entries")}</span></div>
<div class="et hd"><span>Contest</span><span>Entry ID</span><span>Type</span><span>In the file now</span><span></span><span>Lineup written</span><span class="r">Proj</span></div>
${rows || `<div class="rs dim">No entry has a lineup yet.</div>`}</div>
<div class="mapcol leftout"><div class="mh"><span class="t">Left as they are: no lineup assigned</span><span class="muted">${plural(left.length, "entry", "entries")}, written back exactly as uploaded</span></div>
${left.length ? `<div class="lo">${left.map((e) => `<span class="lc"><span>${esc(e.contestName)}</span> <b>${esc(e.entryId)}</b></span>`).join("")}</div>` : `<div class="rs dim">Every entry has a lineup.</div>`}
<div class="fileline">File: ${esc(x.f.file)} · Upload the downloaded file on DraftKings' Upload Lineups page and check DraftKings' confirmation.</div></div>`;
}
