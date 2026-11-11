// What a Save or a Save all of lineups did, in plain words (PROJECT.md Part 4 item 5, Adam 6:30 PM 11-09): a lineup already saved is never refused and never saved
// twice. Its card reads Saved ✓, a hand-built one says where it is saved, and Save all says how many it saved, how many it skipped as already saved and which it could not
// save, with the reason (nothing dropped silently, G62). Classic and Showdown, the app and the public site. Pure; no DOM, no requests.
import { TONE_ERROR, TONE_NOTICE } from "./row-message.js";

/** The server's and the site's answer for a lineup whose men are already saved in that mode (server/lineups/duplicate.js DUPLICATE_CODE). */
export const ALREADY_SAVED_CODE = "DUPLICATE_LINEUP";

/** Whether a save's answer says the lineup is already saved (the save is then done: nothing new, nothing refused). */
export const isAlreadySavedAnswer = (data) => data?.error?.code === ALREADY_SAVED_CODE;

const NAMES_SHOWN = 6;
const namesText = (names) => (names.length <= NAMES_SHOWN ? names.join(", ") : `${names.slice(0, NAMES_SHOWN).join(", ")} and ${names.length - NAMES_SHOWN} more`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const noStop = (text) => String(text ?? "").trim().replace(/\.+$/, "");

/**
 * {text, tone} for one run over `asked` cards: `saved` the number saved now, `skipped` the names of those already saved (never sent again, or answered as already saved),
 * `failed` [{name, reason}] every card not saved and why (a run stops at its first failure, so the cards after it are listed with that reason). One card: no words when it
 * saved or was already saved (its card reads Saved ✓), else its reason, in red. Several: every part that happened, in red when any card was not saved, else a plain notice.
 */
export function saveOutcome({ asked, saved = 0, skipped = [], failed = [] }) {
  if (asked <= 1) return failed.length ? { text: failed[0].reason, tone: TONE_ERROR } : { text: "", tone: TONE_NOTICE };
  const parts = [];
  if (saved) parts.push(`Saved ${plural(saved, "lineup")}.`);
  else if (!failed.length) parts.push("Nothing new to save.");
  if (skipped.length) parts.push(`Skipped ${skipped.length} already saved (${namesText(skipped)}).`);
  const byReason = new Map();
  for (const f of failed) byReason.set(f.reason, [...(byReason.get(f.reason) ?? []), f.name]);
  for (const [reason, names] of byReason) parts.push(`Not saved: ${plural(names.length, "lineup")} (${namesText(names)}): ${noStop(reason)}.`);
  return { text: parts.join(" "), tone: failed.length ? TONE_ERROR : TONE_NOTICE };
}

/** What a Load says, where the lineup went (walkthrough friction, PROJECT.md Part 4 item 5): `name` the lineup's, `mode` "gpp" or "cash" (the tab whose working lineup took it). */
export function loadedText(name, mode) {
  return `Loaded ${name ? `"${name}"` : "the lineup"} into your ${mode === "cash" ? "Cash" : "GPP"} lineup here.`;
}

/** A hand-built lineup's Save that found it already saved: where it is, never a refusal. `name` the saved twin's name when the list has it. */
export function alreadySavedText(name) {
  return name ? `Already saved as "${name}".` : "Already saved.";
}
