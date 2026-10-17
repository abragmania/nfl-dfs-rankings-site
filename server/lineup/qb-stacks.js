// RULES.md D73 (amended 2026-10-17): per-QB stack settings qbStacks: {qbId: {teammatesMin, teammatesMax, opponentsMin, opponentsMax, players}}; unmarked = available.
// RULES.md D55 (amended 2026-10-17): teammates count as in the global stack; a QB with no entry keeps the global stack.
// D69: pure and browser-safe (no node modules, network or logging).
import { rowIsOut } from "../rank/sidelined.js"; // pure

const ENTRY_KEYS = Object.freeze(["teammatesMin", "teammatesMax", "opponentsMin", "opponentsMax", "players"]);
const LEGACY_ENTRY_KEYS = Object.freeze(["bringBack"]); // translated by normaliseEntry, never kept
const OFFENSE = Object.freeze(["RB", "WR", "TE"]);
const STACK_AT = Object.freeze({ RB: 3, WR: 4, TE: 2 }); // the most of each a classic lineup holds (FLEX included)
const MAX_FALLBACK_TRIALS = 8;

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const upper = (v) => (v === null || v === undefined ? "" : String(v).trim().toUpperCase());
const isSet = (v) => v !== null && v !== undefined;

export const setsTeammates = (e) => isSet(e.teammatesMin) || isSet(e.teammatesMax);
export const setsOpponents = (e) => isSet(e.opponentsMin) || isSet(e.opponentsMax);

function sideBounds(value, who, minKey, maxKey, what, top) {
  const bound = (field, word) => {
    const n = value[field];
    if (!isSet(n)) return { n: null };
    if (!Number.isInteger(n) || n < 0 || n > top) return { error: `The ${word} number of ${what} for ${who} must be a whole number from 0 to ${top}.` };
    return { n };
  };
  const min = bound(minKey, "minimum");
  if (min.error) return { error: min.error };
  const max = bound(maxKey, "maximum");
  if (max.error) return { error: max.error };
  if (min.n !== null && max.n !== null && min.n > max.n) {
    return { error: `The minimum number of ${what} for ${who} (${min.n}) is more than his maximum (${max.n}).` };
  }
  return { min: min.n, max: max.n };
}

export function normaliseEntry(value, who, ownMax, oppMax) {
  if (!Number.isInteger(ownMax) || !Number.isInteger(oppMax)) throw new Error("normaliseEntry needs the most teammates and the most opponents a stack can ask for");
  if (!isObj(value)) return { error: `The stack settings for ${who} must be an object.` };
  for (const key of Object.keys(value)) {
    if (!ENTRY_KEYS.includes(key) && !LEGACY_ENTRY_KEYS.includes(key)) return { error: `The stack settings for ${who} have an unknown field ${JSON.stringify(key)}; the fields are ${ENTRY_KEYS.join(", ")}.` };
  }
  const v = { ...value };
  delete v.bringBack;
  // RULES.md D73 (amended 2026-10-17): old bringBack read once: yes = opponentsMin 1, no = opponentsMax 0, a number already set wins.
  const bb = value.bringBack;
  if (bb === "yes") {
    if (!isSet(v.opponentsMin)) v.opponentsMin = 1;
  } else if (bb === "no") {
    if (!isSet(v.opponentsMax)) v.opponentsMax = 0;
  } else if (isSet(bb)) {
    return { error: `The bring-back setting for ${who} must be "yes", "no" or left unset.` };
  }
  const own = sideBounds(v, who, "teammatesMin", "teammatesMax", "teammates", ownMax);
  if (own.error) return { error: own.error };
  const opp = sideBounds(v, who, "opponentsMin", "opponentsMax", "opponents", oppMax);
  if (opp.error) return { error: opp.error };
  const players = {};
  if (isSet(v.players)) {
    if (!isObj(v.players)) return { error: `The players setting for ${who} must be an object of player id to "must" or "no".` };
    for (const [rawId, choice] of Object.entries(v.players)) {
      if (choice !== "must" && choice !== "no") return { error: `The choice for player ${rawId} under ${who} must be "must" or "no" (leave a player out of the list for available).` };
      players[String(rawId).trim()] = choice;
    }
  }
  return { entry: { teammatesMin: own.min, teammatesMax: own.max, opponentsMin: opp.min, opponentsMax: opp.max, players } };
}

export function isBlankEntry(e) {
  return !setsTeammates(e) && !setsOpponents(e) && Object.keys(e.players).length === 0;
}

export function validateQbStacks(raw, ctx, ownMax, oppMax, lists) {
  if (raw === undefined || raw === null) return { qbStacks: {} };
  if (!isObj(raw)) return { error: "qbStacks must be an object keyed by quarterback id" };
  if (typeof ctx.rowOf !== "function" || !Array.isArray(ctx.slateRows)) return { error: "qbStacks cannot be checked: no player rows were supplied" };
  const where = ctx.slateName ? `the ${ctx.slateName}'s games` : "this slate";
  const locked = new Set(lists.locks);
  const excluded = new Set(lists.excludes);
  const out = {};
  for (const [rawId, value] of Object.entries(raw)) {
    const id = String(rawId).trim();
    if (!ctx.boardIds.has(id)) return { error: `qbStacks names a player who is not on the board: ${rawId}` };
    const who = ctx.nameOf(id);
    if (!ctx.slateIds.has(id)) return { error: `${who} is not in ${where}, so his stack settings cannot be used.` };
    const qb = ctx.rowOf(id);
    if (upper(qb.pos) !== "QB") return { error: `${who} is not a quarterback, so he cannot have stack settings.` };
    if (value === null || value === undefined) continue;
    const parsed = normaliseEntry(value, who, ownMax, oppMax);
    if (parsed.error) return { error: parsed.error };
    const e = parsed.entry;
    const team = upper(qb.team);
    const opp = upper(qb.opp);
    const side = {}; // marked player id -> "own" | "opp"
    let mustOwn = 0;
    let mustOpp = 0;
    for (const [pid, choice] of Object.entries(e.players)) {
      const name = ctx.nameOf(pid);
      if (!ctx.boardIds.has(pid)) return { error: `The players setting for ${who} names a player who is not on the board: ${pid}` };
      if (!ctx.slateIds.has(pid)) return { error: `${name}, marked "${choice}" for ${who}, is not in ${where}.` };
      const row = ctx.rowOf(pid);
      if (!OFFENSE.includes(upper(row.pos))) return { error: `${name} cannot be marked for ${who}: only running backs, receivers and tight ends of his team or the team he faces can.` };
      const t = upper(row.team);
      if (t === "" || (t !== team && t !== opp)) return { error: `${name} plays for neither ${who}'s team nor the team he faces, so he cannot be marked for ${who}.` };
      side[pid] = t === team ? "own" : "opp";
      if (choice === "no" && locked.has(pid)) return { error: `${name} is locked, so he cannot also be marked "no" for ${who}.` };
      if (choice === "must") {
        if (rowIsOut(row)) return { error: `${name} is marked "must" for ${who} but is ruled out.` };
        if (excluded.has(pid)) return { error: `${name} is marked "must" for ${who} but is excluded from every lineup.` };
        if (side[pid] === "own" && upper(row.pos) !== "RB") mustOwn++;
        else if (side[pid] === "opp") mustOpp++;
      }
    }
    if (e.opponentsMax === 0 && mustOpp > 0) {
      const pid = Object.keys(e.players).find((p) => e.players[p] === "must" && side[p] === "opp");
      return { error: `${who}'s maximum number of opponents is 0, but ${ctx.nameOf(pid)} from the team he faces is marked "must".` };
    }
    if (e.teammatesMax !== null && mustOwn > e.teammatesMax) {
      return { error: `${mustOwn} of ${who}'s teammates are marked "must", but his maximum is ${e.teammatesMax}.` };
    }
    if (e.opponentsMax !== null && mustOpp > e.opponentsMax) {
      return { error: `${mustOpp} players from the team ${who} faces are marked "must", but his maximum number of opponents is ${e.opponentsMax}.` };
    }
    const free = (r) => e.players[String(r.id)] !== "no" && !rowIsOut(r) && !excluded.has(String(r.id));
    const skill = (r) => OFFENSE.includes(upper(r.pos));
    if (e.teammatesMin !== null) {
      const n = ctx.slateRows.filter((r) => skill(r) && upper(r.team) === team && free(r)).length;
      if (n < e.teammatesMin) return { error: `${who} needs at least ${e.teammatesMin} teammates, but only ${n} of his running backs, receivers and tight ends can be picked (the rest are marked "no", ruled out or excluded).` };
    }
    if (e.opponentsMin !== null && e.opponentsMin > 0) {
      const n = opp === "" ? 0 : ctx.slateRows.filter((r) => skill(r) && upper(r.team) === opp && free(r)).length;
      const need = `${who} needs at least ${e.opponentsMin} ${e.opponentsMin === 1 ? "opponent" : "opponents"}`;
      if (n === 0) return { error: `${need}, but every running back, receiver and tight end of the team he faces is marked "no", ruled out or excluded.` };
      if (n < e.opponentsMin) return { error: `${need}, but only ${n} of the running backs, receivers and tight ends of the team he faces can be picked (the rest are marked "no", ruled out or excluded).` };
    }
    if (!isBlankEntry(e)) out[id] = e;
  }
  return { qbStacks: out };
}

export function parseEntries(raw, ownMax, oppMax, notes) {
  const out = new Map();
  if (!isObj(raw)) return out;
  for (const [rawId, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    const id = String(rawId).trim();
    const parsed = normaliseEntry(value, `player ${id}`, ownMax, oppMax);
    if (parsed.error) notes.push(`${parsed.error} They were ignored.`);
    else if (!isBlankEntry(parsed.entry)) out.set(id, parsed.entry); // blank: the global numbers apply, as in the request check
  }
  return out;
}

// RULES.md D73 (amended 2026-10-17): a side with either number set is wholly his (min ?? 0, max ?? no cap); a blank side is `global` (globalRule).
export function ruleFromEntry(e, keyOfId, global) {
  const sides = ["needOwn", "capOwn", "needOpp", "capOpp"];
  if (!isObj(global) || !sides.every((k) => typeof global[k] === "number" && !Number.isNaN(global[k]))) throw new Error("ruleFromEntry needs the resolved global stack rule");
  const key = (id) => keyOfId.get(id) ?? `id:${id}`;
  const marked = (choice) => Object.keys(e.players).filter((id) => e.players[id] === choice).map(key);
  const own = setsTeammates(e);
  const opp = setsOpponents(e);
  return {
    needOwn: own ? e.teammatesMin ?? 0 : global.needOwn,
    capOwn: own ? e.teammatesMax ?? Infinity : global.capOwn,
    needOpp: opp ? e.opponentsMin ?? 0 : global.needOpp,
    capOpp: opp ? e.opponentsMax ?? Infinity : global.capOpp,
    withKeys: Object.freeze(marked("must")),
    neverKeys: new Set(marked("no"))
  };
}

export function globalRule(needOwn, capOwn, needOpp, capOpp) {
  return { needOwn, capOwn, needOpp, capOpp, withKeys: Object.freeze([]), neverKeys: new Set() };
}

export function qbStackPrepare(entries, h) {
  const rules = new Map();
  const protectedKeys = new Set();
  const notes = [];
  const noted = new Set(); // quarterbacks already reported as unable to be in any lineup
  const lockKeys = new Set(h.lockCands.map((c) => c.key));
  const lockedQb = h.lockCands.find((c) => c.pos === "QB");
  for (const [qbId, e] of entries) {
    const who = h.byId.get(qbId)?.name ?? qbId;
    const rule = ruleFromEntry(e, h.keyOfId, h.global);
    for (const [pid, choice] of Object.entries(e.players)) {
      if (choice === "no" && lockKeys.has(h.keyOfId.get(pid))) return { fatal: `${h.byId.get(pid)?.name ?? pid} is locked, so he cannot also be marked "no" for ${who}.` };
    }
    for (const k of [...rule.withKeys, ...rule.neverKeys]) protectedKeys.add(k);
    const qbKey = h.keyOfId.get(qbId);
    if (qbKey === undefined) continue;
    const qbRow = h.byId.get(qbId);
    rule.oppBinds = setsOpponents(e) || Object.keys(e.players).some((pid) => upper(h.byId.get(pid)?.team) !== "" && upper(h.byId.get(pid)?.team) === upper(qbRow?.opp));
    rules.set(qbKey, rule);
    const qb = h.candByKey.get(qbKey);
    if (!qb || (lockedQb && lockedQb.key !== qbKey)) continue;
    const missing = Object.keys(e.players).filter((pid) => e.players[pid] === "must" && !h.candByKey.has(h.keyOfId.get(pid) ?? `id:${pid}`));
    if (missing.length) {
      const names = missing.map((pid) => h.byId.get(pid)?.name ?? pid).join(", ");
      const why = `excluded, ruled out, ruled out after TwoGun's board was made, or without a salary or projection${h.ceilBuild ? ", or without a TwoGun ceiling in this ceiling build" : ""}`;
      notes.push(`${who} cannot be in any lineup: ${names} ${missing.length === 1 ? "is" : "are"} marked "must" for him but ${missing.length === 1 ? "is" : "are"} not available (${why}).`);
      noted.add(qbKey);
      continue;
    }
    const clash = entryClash(qb, e, rule, h, who);
    if (clash) return { fatal: clash };
  }
  return { rules, protectedKeys, notes, noted };
}

function entryClash(qb, e, rule, h, who) {
  const sideOf = (c) => (c.teamIx === qb.teamIx ? "own" : qb.oppIx >= 0 && c.teamIx === qb.oppIx ? "opp" : null);
  const musts = rule.withKeys.map((k) => h.candByKey.get(k));
  const locked = h.lockCands.filter((c) => OFFENSE.includes(c.pos));
  const label = (key) => `the rule "${h.ruleLabel(key)}" is on`;
  const backs = [...new Map([...musts, ...locked].filter((c) => c.pos === "RB").map((c) => [c.key, c])).values()];
  const isMust = (c) => rule.withKeys.includes(c.key);
  for (let i = 0; i < backs.length; i++) {
    for (let j = i + 1; j < backs.length; j++) {
      const [a, b] = isMust(backs[i]) ? [backs[i], backs[j]] : [backs[j], backs[i]];
      if (!isMust(a)) continue;
      const key = h.rules.noSameTeamRbs && a.teamIx === b.teamIx ? "noSameTeamRbs"
        : h.rules.noSameGameRbs && a.gameIx === b.gameIx && !h.allowRbGame[a.gameIx] ? "noSameGameRbs" : null;
      if (!key) continue;
      const pair = isMust(b) ? `${a.name} and ${b.name} are both marked "must" for ${who}` : `${a.name} is marked "must" for ${who} and ${b.name} is locked`;
      return `${pair}, but ${label(key)}.`;
    }
  }
  // RULES.md D73 (amended 2026-10-17): only a side the entry sets is checked here; a blank side acts as with no entry.
  const ownSet = setsTeammates(e);
  const oppSet = setsOpponents(e);
  const howHeld = (list) => {
    const nLocked = list.filter((c) => c.locked).length;
    return nLocked === list.length ? "locked" : nLocked === 0 ? 'marked "must"' : 'locked or marked "must"';
  };
  const unique = (list) => [...new Map(list.map((c) => [c.key, c])).values()];
  if (oppSet && rule.capOpp !== Infinity) {
    const held = unique([...locked, ...musts].filter((c) => sideOf(c) === "opp"));
    if (held.length > rule.capOpp) {
      const max = `${who}'s maximum number of opponents is ${rule.capOpp}`;
      if (held.length === 1) return `${held[0].name} from the team ${who} faces is ${howHeld(held)}, but ${max}.`;
      return `${held.length} players from the team ${who} faces are ${howHeld(held)}, but ${max}.`;
    }
  }
  if (ownSet && rule.capOwn !== Infinity) {
    const counted = unique([...locked, ...musts].filter((c) => sideOf(c) === "own" && c.stackOk));
    if (counted.length > rule.capOwn) {
      return `${counted.length} of ${who}'s teammates who count toward his stack are ${howHeld(counted)}, but his maximum is ${rule.capOwn}.`;
    }
  }
  const oneBack = h.rules.noSameTeamRbs || (h.rules.noSameGameRbs && !h.allowRbGame[qb.gameIx]);
  // The most players of one side a lineup can hold: an upper bound, so it never refuses what could be built.
  const room = (counts) => {
    const can = { RB: 0, WR: 0, TE: 0 };
    for (const c of h.candByKey.values()) if (counts(c) && !rule.neverKeys.has(c.key)) can[c.pos]++;
    return Math.min(can.RB, oneBack ? 1 : STACK_AT.RB) + Math.min(can.WR, STACK_AT.WR) + Math.min(can.TE, STACK_AT.TE);
  };
  if (ownSet && rule.needOwn > 0) {
    const n = room((c) => c.stackOk && sideOf(c) === "own");
    if (n < rule.needOwn) {
      return `${who} needs at least ${rule.needOwn} teammates, but only ${n} of his running backs, receivers and tight ends can count (the others are marked "no", unavailable, or held back by the rules on running backs).`;
    }
  }
  if (oppSet && rule.needOpp > 0) {
    const n = room((c) => OFFENSE.includes(c.pos) && sideOf(c) === "opp");
    const need = `${who} needs at least ${rule.needOpp} ${rule.needOpp === 1 ? "opponent" : "opponents"}`;
    if (n === 0) return `${need}, but no running back, receiver or tight end of the team he faces can be picked (each is marked "no" or unavailable).`;
    if (n < rule.needOpp) return `${need}, but only ${n} of the running backs, receivers and tight ends of the team he faces can count (the others are marked "no", unavailable, or held back by the rules on running backs).`;
  }
  return null;
}

export function mustPlan(withKeys, placed, groups, idxOf, candByKey) {
  const spots = [];
  for (const key of withKeys) {
    if (placed.some((p) => p.key === key)) continue;
    const pos = candByKey.get(key)?.pos;
    const h = groups.findIndex((g) => g.pos === pos);
    const at = h < 0 ? undefined : idxOf[h].get(key);
    if (at === undefined) return null;
    spots.push({ key, h, at, c: candByKey.get(key) });
  }
  return spots;
}

// Rules-repo review 2026-10-17 finding 3: a "must" player at a cap takes his QB out of every later lineup; one note per QB per batch.
export function cappedMustNotes(qbs, candByKey, capOf, noted, lineupNo) {
  const out = [];
  for (const qb of qbs) {
    if (!qb.rule || noted.has(qb.key)) continue;
    for (const key of qb.rule.withKeys) {
      const c = candByKey.get(key);
      const cap = c && !c.locked ? capOf(c) : null;
      if (cap === null) continue;
      noted.add(qb.key);
      out.push(`${qb.name} is left out of lineup ${lineupNo} onward: ${c.name}, marked "must" for him, has reached ${cap}.`);
      break;
    }
  }
  return out;
}

export function withReachable(spots, placed, groups, gi, kRem, start, cnt, canAdd = null) {
  if (spots === null) return false;
  cnt.fill(0);
  for (const s of spots) {
    if (s.h < gi || (s.h === gi && s.at < start)) {
      if (!placed.some((p) => p.key === s.key)) return false;
      continue;
    }
    if (canAdd && !canAdd(s.c)) return false; // the search's own add test only tightens down a branch — rules-repo review 2026-10-17 finding 5
    cnt[s.h]++;
  }
  for (let h = gi; h < groups.length; h++) if (cnt[h] > (h === gi ? kRem : groups[h].need)) return false;
  return true;
}

export function stackTrials(entries, nameOf) {
  const all = Object.fromEntries(entries);
  const without = (e, choice) => Object.fromEntries(Object.entries(e.players).filter(([, c]) => c !== choice));
  const parts = [];
  for (const [id, e] of entries) {
    const who = nameOf(id);
    const has = (choice) => Object.values(e.players).includes(choice);
    if (setsTeammates(e)) parts.push({ id, label: `the number of teammates set for ${who}`, change: { teammatesMin: null, teammatesMax: null } });
    if (setsOpponents(e)) parts.push({ id, label: `the number of opponents set for ${who}`, change: { opponentsMin: null, opponentsMax: null } });
    if (has("must")) parts.push({ id, label: `the players marked "must" for ${who}`, change: { players: without(e, "must") } });
    if (has("no")) parts.push({ id, label: `the players marked "no" for ${who}`, change: { players: without(e, "no") } });
  }
  const dropping = (id) => {
    const rest = { ...all };
    delete rest[id];
    return rest;
  };
  if (parts.length > MAX_FALLBACK_TRIALS) {
    return [...entries.keys()].slice(0, MAX_FALLBACK_TRIALS).map((id) => ({ label: `the stack settings for ${nameOf(id)}`, patch: { qbStacks: dropping(id) } }));
  }
  return parts.map((p) => {
    const relaxed = { ...all[p.id], ...p.change };
    return { label: p.label, patch: { qbStacks: isBlankEntry(relaxed) ? dropping(p.id) : { ...all, [p.id]: relaxed } } };
  });
}
