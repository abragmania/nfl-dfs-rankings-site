// A Showdown board as served, the part that needs no file, no clock and no hash (RULES.md D71): TwoGun's two files for a game as rows and as an applySources input, the
// ticks' figures block, and servedFrom, the work serveShowdownBoard (./board-view.js) does once it has read the saved choices, the edits, TwoGun's files and the
// overrides. The public site runs the same code in the visitor's browser on the game's baked engine inputs (site-src/site-sd-sources.js), so a tick made there gives
// the board the app's route gives for the same choices. These functions were moved here from ./board-view.js without change; that file re-exports every name it had.
import { applySources, ticksTwoGun } from "../rank/select.js";
import { presetOf, backupFor, TWOGUN_ID } from "../sources/selection-core.js";
import { twogunUnmatchedNote } from "../sources/selection-view.js";
import { centralStampToKickoffHours, centralStampToEasternText } from "../lib/et.js";
import { safeErrorText } from "../lib/notes.js";
// withTwoGunFigures (generate-request.js) attaches row.tg, his own {proj, median, ceil}; withTwoGunAsSource below adds him as an ordinary source.
import { withTwoGunFigures } from "./generate-request.js";
import { listNames } from "../lineup/soft.js";
import { boardTwoGun } from "./lineup-rows.js";
import { withSelfCheck } from "../rank/self-check.js";
import { editsMapFor } from "../sources/edits-core.js";

export const NO_OWNERSHIP_FILE_NOTE = "No ownership-sources.json for this game:"; // the start of board.js's note

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The rows with TwoGun's figures added where he has them: his FLEX projection, and his FLEX and Captain ownership (a man
 *  his posted board has no row for is 0% in both slots, Q8; a blank stays missing, D29). Nothing is added for a file not posted. */
export function withTwoGunAsSource(rows, tp, tg) {
  return rows.map((r) => {
    const id = String(r.id);
    const proj = tp?.posted ? num(tp.byId.get(id)) : null;
    const own = tg?.posted ? tg.byId.get(id) ?? null : null;
    const off = tg?.posted && tg.notOnBoardIds?.has(id);
    const flex = off ? 0 : num(own?.tgFlex);
    const cpt = off ? 0 : num(own?.tgCpt);
    if (proj === null && flex === null && cpt === null) return r;
    return {
      ...r,
      projBySource: proj === null ? r.projBySource : { ...r.projBySource, [TWOGUN_ID]: proj },
      ownFlexBySource: flex === null ? r.ownFlexBySource : { ...r.ownFlexBySource, [TWOGUN_ID]: flex },
      ownCptBySource: cpt === null ? r.ownCptBySource : { ...r.ownCptBySource, [TWOGUN_ID]: cpt }
    };
  });
}

/** G68: row.tgClose = { his (his own spelling), proj, own } on each man TwoGun's copy joined as a close match, `proj` / `own` saying which of his figures
 *  are ticked on this board (the pool marks those cells, public/js/showdown/table.js); `closeMatches` is loadTwoGunProjections' [{ id, name, his }]. With
 *  neither ticked, or no close match, the rows are returned as they are. Pure. */
export function withCloseMarks(rows, closeMatches, { proj = false, own = false } = {}) {
  const his = new Map((closeMatches ?? []).map((c) => [String(c.id), c.his]));
  return his.size && (proj || own) ? rows.map((r) => (his.has(String(r.id)) ? { ...r, tgClose: { his: his.get(String(r.id)), proj, own } } : r)) : rows;
}

/** The board foot's line for TwoGun's copy (G68): the men joined as a close match, and the count and names of the projected men carried off it
 *  because no DraftKings man matches them; null when neither. `tp`: loadTwoGunProjections' answer. Pure. */
export function twogunJoinNote(tp) {
  const close = tp?.closeMatches ?? [], off = tp?.carriedOff ?? [];
  const men = (n) => `${n} ${n === 1 ? "man" : "men"}`;
  const parts = [
    ...(close.length ? [`TwoGun's copy joined ${men(close.length)} as a close match (same team, position and last name), marked on the row: ${close.map((c) => `${c.name} (his ${c.his})`).join("; ")}.`] : []),
    ...(off.length ? [`TwoGun's copy carried off ${men(off.length)} he projects, matching no DraftKings man by exact name or close match: ${off.map((u) => `${u.name} (${u.team} ${u.pos}, ${u.proj})`).join("; ")}.`] : []),
  ];
  return parts.length ? parts.join(" ") : null;
}

/** Hours in tenths, as load.js rounds his age; a stamp after the kickoff stays below 0 (a few minutes late is -0.1, never -0). */
const tenths = (h) => (h < 0 ? Math.floor(h * 10) / 10 : Math.round(h * 10) / 10);

/** His board's age at this game's kickoff (D30), from the files the board actually uses: each posted file that is ticked (`ticks`:
 *  { projection, ownership }, both when absent; when none is ticked the posted files, so a board that does not use him still
 *  states his true age). A projections file's stamp is its meta board stamp (a file time is no board time). Every stamp is read by
 *  et.js (the one copy); any that cannot be read makes the age null (the 36-hour rule then reads it unknown, stale). Otherwise the oldest
 *  age, except that a stamp after the kickoff (a negative age) is the one reported, since it is stale whatever the other says. */
function ageAtKickoffH(tp, tg, { kickoffEt, season, ticks = { projection: true, ownership: true } }) {
  const posted = [
    { used: ticks.projection, stamp: tp?.posted ? (tp.asOfFrom === "meta" ? tp.asOf : null) : undefined },
    { used: ticks.ownership, stamp: tg?.posted ? tg.asOf : undefined }
  ].filter((f) => f.stamp !== undefined);
  const counted = posted.some((f) => f.used) ? posted.filter((f) => f.used) : posted;
  if (!counted.length) return null;
  const ages = counted.map((f) => centralStampToKickoffHours(f.stamp, kickoffEt, season));
  if (ages.some((a) => a === null)) return null;
  return tenths(ages.some((a) => a < 0) ? Math.min(...ages) : Math.max(...ages));
}

/** applySources' inputs.twogun for a Showdown: what his two files posted. Nothing posted reads missing (or failed when a file was refused).
 *  `when`: { kickoffEt, season, ticks } of this game (the board's game.kickoffEt, the slate's season, which of his files the choices tick), for his age at kickoff. */
export function twogunInputOf(tp, tg, note = null, when = {}) {
  const posted = Boolean(tp?.posted || tg?.posted);
  const refused = [tp, tg].find((t) => t?.status === "invalid");
  const status = posted ? "ok" : refused || note ? "failed" : "missing";
  const text = note ?? (posted ? null : refused ? safeErrorText(new Error(refused.error ?? "his file was refused")) : "TwoGun has not posted Showdown figures for this game.");
  const load = {
    status, file: tp?.posted ? tp.file : tg?.posted ? tg.file : null,
    mtimeMs: Math.max(num(tp?.mtimeMs) ?? 0, num(tg?.mtimeMs) ?? 0) || null,
    // A file time is "pulled", never "posted": his projections' board stamp is only the meta file's own (asOfFrom "meta").
    // His stamps are Central text; what is served reads Eastern (the age above was read from the Central text, and nothing parses these again).
    boardUpdated: tp?.posted && tp.asOfFrom === "meta" ? centralStampToEasternText(tp.asOf, when.season) : null,
    ownershipUpdated: tg?.posted ? centralStampToEasternText(tg.asOf, when.season) : null,
    ageAtLockH: ageAtKickoffH(tp, tg, when), // null when no stamp reads as Central time: the 36-hour rule (D30) then reads the age as unknown
    // { board id: the status he quoted } for the men his CSV marks "(assumed playing)": his call that a man the injury report lists out plays (select-showdown.js).
    playingIds: tp?.posted ? Object.fromEntries(tp.playingIds ?? []) : {},
    // { board id: his own plain out word } for the men his CSV lists out with no call: out by his word where his numbers are in use (select-showdown.js).
    listedOutIds: tp?.posted ? Object.fromEntries(tp.listedOutIds ?? []) : {},
    note: text
  };
  return { load, snapshot: posted ? { showdown: true } : null };
}

const msOf = (t) => (typeof t === "string" && /^\d{4}-\d{2}-\d{2}/.test(t) && Number.isFinite(Date.parse(t)) ? Date.parse(t) : null);
/** The oldest of a source's pull times (several cards for one source: its projection and its kicker card). */
function pulled(times) {
  const known = times.filter((t) => msOf(t) !== null).sort((a, b) => msOf(a) - msOf(b));
  return known.length ? { asOf: known[0], asOfFrom: "fetched", ms: msOf(known[0]) } : { asOf: null, asOfFrom: null, ms: null };
}
/** TwoGun's stamp as he posts it (free text, or his projections file's time), ordered by itself when it is a date, else by his file's saved time.
 *  A Central-time stamp is served as Eastern text (display only; the order is read from the original). */
const hisStamp = (asOf, asOfFrom, mtimeMs, season) => ({ asOf: centralStampToEasternText(asOf ?? null, season), asOfFrom: asOf ? asOfFrom : null, ms: msOf(asOf) ?? num(mtimeMs) });

const GAPS_TEXT = { backup: "players they miss are filled from the Our sources backups", blank: "players they miss are left blank" };

/** "TwoGun", "Sleeper, FantasyPros, CBS and ESPN, weight 1 each" or "Sleeper (weight 2) and ESPN (weight 1)"; a ticked source with no figures for this game says so. */
function namesText(list, has) {
  if (!list.length) return "no source ticked";
  const same = list.every((s) => s.weight === list[0].weight);
  const name = (s) => `${s.label}${same ? "" : ` (weight ${s.weight})`}${has(s.id) ? "" : " (no figures for this game)"}`;
  return `${listNames(list.map(name))}${same && list.length > 1 ? `, weight ${list[0].weight} each` : ""}`;
}

/** The oldest known stamp among `stamps` (live sources only), else the board's build time, else none. */
function oldest(stamps, generatedAt) {
  const known = stamps.filter((s) => s && s.ms !== null).sort((a, b) => a.ms - b.ms);
  if (known.length) return { asOf: known[0].asOf, asOfFrom: known[0].asOfFrom };
  return generatedAt ? { asOf: generatedAt, asOfFrom: "board built" } : { asOf: null, asOfFrom: null };
}

/**
 * board.figures: the source lines the Lineup tab's board path writes in place of the old fixed "This app's showdown ..."
 * strings (uniqueness-routes.js), from board.mode.ticked: { projection: { source, asOf, asOfFrom, error }, ownership:
 * { source, asOf, asOfFrom, error }, twogun }. Each names the ticked sources and carries the oldest stamp among
 * those with figures for this game: a source's pull ("fetched"), TwoGun's posted stamp ("meta" or "posted") or his
 * projections file's time ("file time"); TwoGun counts only where a row's number used his (row.src), a file source only
 * where R85 kept it (ownershipUsedIds). error: his file's refusal while TwoGun is the only source ticked for it, else
 * null. twogun: while his posted ownership file is a ticked ownership source, { notOnBoardIds, unpostedReasons,
 * incompleteReason } (Q8, the reason a blank man stays blank and the sentence when his list looks partial,
 * twogun-ownership.js), else null, so the board path needs no file of his.
 * key: `key` as given (figuresKeyOf the served key, or null), which a Generate answer carries and a batch save sends back so
 * a save after the ticks, TwoGun's files, the edits or a typed number changed is refused (lineups-routes.js).
 * `tw`: readTwoGunShowdown's { tp, tg }. null for a board with no ticked list. Pure.
 */
export function boardFigures(board, tw, key = null, season = null) {
  const t = board?.mode?.ticked;
  if (!t) return null;
  const rows = board.rows ?? [];
  const cards = board.sources ?? [];
  const files = new Map((board.ownershipSources ?? []).map((s) => [s.id, s]));
  const kept = Array.isArray(board.ownershipUsedIds) ? new Set(board.ownershipUsedIds) : null;
  const projStamp = (id) => {
    if (id === TWOGUN_ID) return tw?.tp?.posted && rows.some((r) => r.src?.proj === TWOGUN_ID) ? hisStamp(tw.tp.asOf, tw.tp.asOfFrom, tw.tp.mtimeMs, season) : null;
    const mine = cards.filter((c) => ((c.kind === "projection" && c.id === id) || (c.kind === "kicker" && c.sourceId === id)) && (c.records ?? 0) > 0);
    return mine.length ? pulled(mine.map((c) => c.fetchedAt)) : null;
  };
  const ownStamp = (id) => {
    if (id === TWOGUN_ID) return tw?.tg?.posted && rows.some((r) => r.src?.own === TWOGUN_ID) ? hisStamp(tw.tg.asOf, "posted", tw.tg.mtimeMs, season) : null;
    const s = files.get(id);
    return s && (s.rows ?? []).length && (!kept || kept.has(id)) ? pulled([s.fetchedAt]) : null;
  };
  const gaps = (...kinds) => [...new Set(kinds.map((k) => GAPS_TEXT[t[k]?.gaps]).filter(Boolean))].join("; ");
  const tail = (g) => `${g ? `; ${g}` : ""}, plus Adam's typed numbers`;
  const proj = t.projection?.sources ?? [];
  const flex = t.sdOwnFlex?.sources ?? [];
  const cpt = t.sdOwnCpt?.sources ?? [];
  const same = JSON.stringify(flex) === JSON.stringify(cpt);
  const ownList = same ? `FLEX and Captain apart, ${namesText(flex, ownStamp)}` : `FLEX ${namesText(flex, ownStamp)}; Captain ${namesText(cpt, ownStamp)}`;
  const two = boardTwoGun(board);
  const refused = (file, only) => (only && file?.status === "invalid" ? file.error ?? null : null);
  const tg = two.own && tw?.tg?.posted ? tw.tg : null;
  // Each source's own stamp, so the player card dates a man's figure from the sources that made it (row.srcUsed), never from the board's ticked list or its build time:
  // { asOf, asOfFrom } (asOf null when the source carries none), and no entry at all for a source with no figures on this board (TwoGun with no file posted).
  const stampsOf = (ids, stampOf) => Object.fromEntries(ids.map((id) => [id, stampOf(id)]).filter(([, s]) => s).map(([id, s]) => [id, { asOf: s.asOf, asOfFrom: s.asOfFrom }]));
  const stamps = {
    projection: stampsOf([...new Set([...cards.filter((c) => c.kind === "projection").map((c) => c.id), ...cards.filter((c) => c.kind === "kicker").map((c) => c.sourceId), TWOGUN_ID])], projStamp),
    ownership: stampsOf([...new Set([...files.keys(), TWOGUN_ID])], ownStamp),
  };
  return {
    projection: { source: `This game's ticked projections: ${namesText(proj, projStamp)}${tail(gaps("projection"))}`, ...oldest(proj.map((s) => projStamp(s.id)), board.generatedAt), error: refused(tw?.tp, two.projOnly) }, // a typed number always wins, in every mode (Adam 2026-11-12)
    ownership: { source: `This game's ticked ownership: ${ownList}${tail(gaps("sdOwnFlex", "sdOwnCpt"))}`, ...oldest([...flex, ...cpt].map((s) => ownStamp(s.id)), board.generatedAt), error: refused(tw?.tg, two.ownOnly) },
    twogun: tg ? { notOnBoardIds: [...(tg.notOnBoardIds ?? [])], unpostedReasons: Object.fromEntries(tg.unpostedReasons ?? []), incompleteReason: tg.incompleteReason ?? null } : null,
    stamps,
    key
  };
}

/** The part of the overrides a figure depends on, as stable text: typed projections, typed ownership, bumps, revives and Adam's In / Out (never stars, notes or the file's updatedAt). Pure. */
export function overridesFiguresText(o) {
  const entries = (m) => Object.entries(m ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const parts = [entries(o?.proj), entries(o?.own), entries(o?.bump), [...(o?.revive ?? [])].sort(), [...(o?.reviveTwoGun ?? [])].sort()];
  const status = entries(o?.status);
  return JSON.stringify(status.length ? [...parts, status] : parts); // no In / Out set: the text an older key was made of, so it does not move
}

/**
 * The board as served for one game, from what serveShowdownBoard (./board-view.js) reads: `base` (the cached board with its hidden `inputs`), `choices` (readChoices),
 * `edits` (readEditsFor), `tw` (TwoGun's two files, readTwoGunShowdown's shape) and `overrides`. Nothing here reads a file or a clock: `env` hands in the three things
 * that do: { agreeWithin (R81), generatedAtOf(builtAt, ...changedMs) (servedGeneratedAt), figuresKey(overrides) (the figures key of the served choices, edits, overrides and files) }.
 */
export function servedFrom({ key: _key, slate, base, choices, edits, tw, overrides }, env) {
  const inputs = base.inputs;
  // board.js adds "No ownership-sources.json ... ownership is missing" when the file source is absent; that is false while
  // his posted ownership is ticked for FLEX or Captain, so it is dropped then (the note is board.js's text, matched by its start).
  const hisOwnership = tw.tg?.posted && ticksTwoGun(choices.selection.kinds, ["sdOwnFlex", "sdOwnCpt"], { classic: false });
  const hisProjection = ticksTwoGun(choices.selection.kinds, ["projection"], { classic: false });
  // The men of his projections file that were left off or not placed (a blank-ID row with no single match) are said while his projections are ticked.
  const unused = hisProjection && tw.tp?.posted ? twogunUnmatchedNote(tw.tp.unmatched) : null;
  const notes = (inputs.notes ?? []).filter((n) => !(hisOwnership && String(n).startsWith(NO_OWNERSHIP_FILE_NOTE)));
  const ticks = { projection: hisProjection, ownership: Boolean(ticksTwoGun(choices.selection.kinds, ["sdOwnFlex", "sdOwnCpt"], { classic: false })) };
  // G68: the pull's close matches and carried men, at the foot while TwoGun is ticked anywhere (his carried man's twin reads missing ownership too).
  const joins = (hisProjection || hisOwnership) && tw.tp?.posted ? twogunJoinNote(tw.tp) : null; // the same ticks as the row marks (withCloseMarks)
  const withHis = { ...inputs, rows: withTwoGunAsSource(inputs.rows, tw.tp, tw.tg),
    twogun: twogunInputOf(tw.tp, tw.tg, tw.note, { kickoffEt: inputs.game?.kickoffEt ?? null, season: slate?.season ?? inputs.slate?.season ?? null, ticks }),
    notes: [...notes, ...(unused ? [unused] : []), ...(joins ? [joins] : []), ...(edits.note ? [edits.note] : [])] };
  const board = applySources(withHis, { selection: choices.selection, overrides, slateKind: "showdown", agreeWithin: env.agreeWithin,
    backup: backupFor(choices.selection), preset: presetOf(choices.selection, "showdown"), note: choices.note, edits: editsMapFor(edits.edits, inputs.rows) });
  // As the classic board does (sources/board-view.js): the served stamp moves with this game's own save and, while TwoGun is ticked,
  // with his files, so a save is newer than the published copy and the publish freshness check sees it.
  const his = ticksTwoGun(choices.selection.kinds, ["projection", "sdOwnFlex", "sdOwnCpt"], { classic: false }) ? withHis.twogun.load.mtimeMs : null;
  // A typed number or a bump moves it too (the overrides file's own stamp, as classic's board does), now that a write no longer rebuilds the board: without it the public site would not read as behind.
  const generatedAt = env.generatedAtOf(base.generatedAt ?? board.generatedAt, ...[choices.changedMs, his, Date.parse(overrides?.updatedAt)].filter((n) => Number.isFinite(n)));
  // Adam 2026-10-20 10:03 AM ("change sources to anything for any game ... make it uniform across everything"): TwoGun's own
  // median and ceiling ride on the rows as in classic (row.tg), so the Lineup tab's builds and Cash basis read the board's own
  // rows; board.figures names the ticked sources behind them (boardFigures). Nothing is added to a row when his file is not posted.
  const withFigures = { ...board, generatedAt, rows: tw.tp?.posted ? withCloseMarks(withTwoGunFigures(board.rows, tw.tp.figuresById), tw.tp.closeMatches, { proj: Boolean(hisProjection), own: Boolean(hisOwnership) }) : board.rows };
  const served = withSelfCheck(withFigures); // G65: checked again with his ceiling on the rows (self-check.js)
  // The figures key follows what moves a figure (typed Proj and Own, bumps, revives), never the overrides file's write time: a star or a note rewrites the file but changes no figure, and must not refuse a batch's save.
  served.figures = boardFigures(served, tw, env.figuresKey(overrides),
    slate?.season ?? inputs.slate?.season ?? null);
  return served;
}
