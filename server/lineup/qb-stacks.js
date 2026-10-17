// Adam 2026-10-16: per-QB stack settings (qbStacks: {qbId: {teammatesMin, teammatesMax, bringBack, players}}); unmarked = available.
// D73/D55: teammates count as in the global stack (a back only as a pass catcher); a QB with no entry keeps the global stack.
// D69: pure and browser-safe (no node modules, network or logging).
import { rowIsOut } from "../rank/sidelined.js"; // pure

const ENTRY_KEYS = Object.freeze(["teammatesMin", "teammatesMax", "bringBack", "players"]);
const OFFENSE = Object.freeze(["RB", "WR", "TE"]);
const STACK_AT = Object.freeze({ RB: 3, WR: 4, TE: 2 }); // the most of each a classic lineup holds (FLEX included)
const MAX_FALLBACK_TRIALS = 8;

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const upper = (v) => (v === null || v === undefined ? "" : String(v).trim().toUpperCase());
const isSet = (v) => v !== null && v !== undefined;

export function normaliseEntry(value, who, ownMax) {
  if (!isObj(value)) return { error: `The stack settings for ${who} must be an object.` };
  for (const key of Object.keys(value)) {
    if (!ENTRY_KEYS.includes(key)) return { error: `The stack settings for ${who} have an unknown field ${JSON.stringify(key)}; the fields are ${ENTRY_KEYS.join(", ")}.` };
  }
  const bound = (field, word) => {
    const n = value[field];
    if (!isSet(n)) return { n: null };
    if (!Number.isInteger(n) || n < 0 || n > ownMax) return { error: `The ${word} number of teammates for ${who} must be a whole number from 0 to ${ownMax}.` };
    return { n };
  };
  const min = bound("teammatesMin", "minimum");
  if (min.error) return { error: min.error };
  const max = bound("teammatesMax", "maximum");
  if (max.error) return { error: max.error };
  if (min.n !== null && max.n !== null && min.n > max.n) {
    return { error: `The minimum number of teammates for ${who} (${min.n}) is more than his maximum (${max.n}).` };
  }
  const bb = value.bringBack;
  if (isSet(bb) && bb !== "yes" && bb !== "no") return { error: `The bring-back setting for ${who} must be "yes", "no" or left unset.` };
  const players = {};
  if (isSet(value.players)) {
    if (!isObj(value.players)) return { error: `The players setting for ${who} must be an object of player id to "must" or "no".` };
    for (const [rawId, choice] of Object.entries(value.players)) {
      if (choice !== "must" && choice !== "no") return { error: `The choice for player ${rawId} under ${who} must be "must" or "no" (leave a player out of the list for available).` };
      players[String(rawId).trim()] = choice;
    }
  }
  return { entry: { teammatesMin: min.n, teammatesMax: max.n, bringBack: isSet(bb) ? bb : null, players } };
}

export function isBlankEntry(e) {
  return !isSet(e.teammatesMin) && !isSet(e.teammatesMax) && !isSet(e.bringBack) && Object.keys(e.players).length === 0;
}

export function validateQbStacks(raw, ctx, ownMax, lists) {
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
    const parsed = normaliseEntry(value, who, ownMax);
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
    if (e.bringBack === "no" && mustOpp > 0) {
      const pid = Object.keys(e.players).find((p) => e.players[p] === "must" && side[p] === "opp");
      return { error: `${who} is set to no bring-back, but ${ctx.nameOf(pid)} from the team he faces is marked "must".` };
    }
    if (e.teammatesMax !== null && mustOwn > e.teammatesMax) {
      return { error: `${mustOwn} of ${who}'s teammates are marked "must", but his maximum is ${e.teammatesMax}.` };
    }
    const free = (r) => e.players[String(r.id)] !== "no" && !rowIsOut(r) && !excluded.has(String(r.id));
    const skill = (r) => OFFENSE.includes(upper(r.pos));
    if (e.teammatesMin !== null) {
      const n = ctx.slateRows.filter((r) => skill(r) && upper(r.team) === team && free(r)).length;
      if (n < e.teammatesMin) return { error: `${who} needs at least ${e.teammatesMin} teammates, but only ${n} of his running backs, receivers and tight ends can be picked (the rest are marked "no", ruled out or excluded).` };
    }
    if (e.bringBack === "yes" && !ctx.slateRows.some((r) => skill(r) && opp !== "" && upper(r.team) === opp && free(r))) {
      return { error: `${who} is set to bring-back yes, but every running back, receiver and tight end of the team he faces is marked "no", ruled out or excluded.` };
    }
    if (!isBlankEntry(e)) out[id] = e;
  }
  return { qbStacks: out };
}

export function parseEntries(raw, ownMax, notes) {
  const out = new Map();
  if (!isObj(raw)) return out;
  for (const [rawId, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    const id = String(rawId).trim();
    const parsed = normaliseEntry(value, `player ${id}`, ownMax);
    if (parsed.error) notes.push(`${parsed.error} They were ignored.`);
    else if (!isBlankEntry(parsed.entry)) out.set(id, parsed.entry); // blank: the global numbers apply, as in the request check
  }
  return out;
}

// Lead ruling 2026-10-16 (review R1): bring-back "yes" = the global opponent number with its "or more"/"exactly", never fewer than 1.
export function ruleFromEntry(e, keyOfId, oppStack) {
  if (!Number.isInteger(oppStack?.n) || typeof oppStack.orMore !== "boolean") throw new Error("ruleFromEntry needs the global opponent stack setting");
  const key = (id) => keyOfId.get(id) ?? `id:${id}`;
  const marked = (choice) => Object.keys(e.players).filter((id) => e.players[id] === choice).map(key);
  const yesN = Math.max(1, oppStack.n);
  return {
    needOwn: e.teammatesMin ?? 0,
    capOwn: e.teammatesMax ?? Infinity,
    needOpp: e.bringBack === "yes" ? yesN : 0,
    capOpp: e.bringBack === "no" ? 0 : e.bringBack === "yes" && !oppStack.orMore ? yesN : Infinity,
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
    const rule = ruleFromEntry(e, h.keyOfId, h.oppStack);
    for (const [pid, choice] of Object.entries(e.players)) {
      if (choice === "no" && lockKeys.has(h.keyOfId.get(pid))) return { fatal: `${h.byId.get(pid)?.name ?? pid} is locked, so he cannot also be marked "no" for ${who}.` };
    }
    for (const k of [...rule.withKeys, ...rule.neverKeys]) protectedKeys.add(k);
    const qbKey = h.keyOfId.get(qbId);
    if (qbKey === undefined) continue;
    const qbRow = h.byId.get(qbId);
    rule.oppBinds = e.bringBack !== null || Object.keys(e.players).some((pid) => upper(h.byId.get(pid)?.team) !== "" && upper(h.byId.get(pid)?.team) === upper(qbRow?.opp));
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
  if (h.rules.rbWithOwnQbOnlyIfCatcher) {
    const rb = musts.find((c) => c.pos === "RB" && sideOf(c) === "own" && !c.catcher);
    if (rb) return `${rb.name} is marked "must" for ${who} but is not a regular pass catcher, and ${label("rbWithOwnQbOnlyIfCatcher")}.`;
  }
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
  if (e.bringBack === "no") {
    const o = [...locked, ...musts].find((c) => sideOf(c) === "opp");
    if (o) return `${who} is set to no bring-back, but ${o.name} from the team he faces is ${o.locked ? "locked" : 'marked "must"'}.`;
  }
  if (e.teammatesMax !== null) {
    const counted = [...new Map([...locked, ...musts].filter((c) => sideOf(c) === "own" && c.stackOk).map((c) => [c.key, c])).values()];
    if (counted.length > e.teammatesMax) {
      const nLocked = counted.filter((c) => c.locked).length;
      const how = nLocked === counted.length ? "locked" : nLocked === 0 ? 'marked "must"' : 'locked or marked "must"';
      return `${counted.length} of ${who}'s teammates who count toward his stack are ${how}, but his maximum is ${e.teammatesMax}.`;
    }
  }
  if (e.teammatesMin !== null && e.teammatesMin > 0) {
    const can = { RB: 0, WR: 0, TE: 0 };
    for (const c of h.candByKey.values()) if (c.stackOk && sideOf(c) === "own" && !rule.neverKeys.has(c.key)) can[c.pos]++;
    const oneBack = h.rules.noSameTeamRbs || (h.rules.noSameGameRbs && !h.allowRbGame[qb.gameIx]);
    const n = Math.min(can.RB, oneBack ? 1 : STACK_AT.RB) + Math.min(can.WR, STACK_AT.WR) + Math.min(can.TE, STACK_AT.TE);
    if (n < e.teammatesMin) {
      return `${who} needs at least ${e.teammatesMin} teammates, but only ${n} of his receivers, tight ends and pass-catching running backs can count (the others are marked "no", unavailable, or held back by the rules on running backs).`;
    }
  }
  if (e.bringBack === "yes" && ![...h.candByKey.values()].some((c) => OFFENSE.includes(c.pos) && sideOf(c) === "opp" && !rule.neverKeys.has(c.key))) {
    return `${who} is set to bring-back yes, but no running back, receiver or tight end of the team he faces can be picked (each is marked "no" or unavailable).`;
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
    spots.push({ key, h, at });
  }
  return spots;
}

export function withReachable(spots, placed, groups, gi, kRem, start, cnt) {
  if (spots === null) return false;
  cnt.fill(0);
  for (const s of spots) {
    if (s.h < gi || (s.h === gi && s.at < start)) {
      if (!placed.some((p) => p.key === s.key)) return false;
      continue;
    }
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
    if ((isSet(e.teammatesMin) && e.teammatesMin > 0) || isSet(e.teammatesMax)) parts.push({ id, label: `the number of teammates set for ${who}`, change: { teammatesMin: null, teammatesMax: null } });
    if (isSet(e.bringBack)) parts.push({ id, label: `the bring-back setting for ${who}`, change: { bringBack: null } });
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
