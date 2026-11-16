// A man whose Min % is above his Max % (round 4 fix batch, item 18): the row says so beside his boxes, and Build refuses and names him. One copy for the classic pool and the Showdown
// pool. Pure: the percent parser is the caller's (parsePct: null for a blank box, NaN for a text that is not a percent).

export const CROSSED_TEXT = "Min is above Max";

/** Whether both boxes hold a percent and the Min is the larger. A blank or a text that is not a percent is never crossed (the box's own refusal says that). */
export function limitsCrossed(minText, maxText, parse) {
  const min = parse(minText);
  const max = parse(maxText);
  return typeof min === "number" && typeof max === "number" && !Number.isNaN(min) && !Number.isNaN(max) && min > max;
}

/** The small amber line under the Max box of a crossed man (a hint that hangs under its cell, flipping up on the last row, style.css .limit-cross); "" when not crossed. */
export function crossedNoteHtml(minText, maxText, parse) {
  return limitsCrossed(minText, maxText, parse) ? `<span class="limit-hint limit-cross cell-edit-hint" role="status">${CROSSED_TEXT}</span>` : "";
}

/** Build's refusal sentence for a crossed man (`role`: "Captain" or "FLEX" in Showdown, "" in classic), naming him and both numbers, as classic's own. */
export function crossedSentence(name, minText, maxText, role = "") {
  return `${name}'s ${role ? `${role} ` : ""}Min % (${String(minText).trim()}) is above his ${role ? `${role} ` : ""}Max % (${String(maxText).trim()}); lower the Min or raise the Max.`;
}
