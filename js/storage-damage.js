// A stored setting the browser cannot read is named, never silently defaulted (NBA b870f19 item 8; G62, G64). One copy: every reader that finds a value in storage it cannot use calls
// noteUnreadable(name, id); the page's foot (#storage-foot in index.html, classic, Showdown and the public site alike) says "Reset to defaults because the saved copy could not be read: ...".
// A missing value or blocked storage is not damage and never calls this. The damaged value stays in storage until Adam next changes that setting; the writer then calls clearUnreadable(id) (the save replaces it).
const damaged = new Map(); // id -> { name, used }

function render() {
  if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
  const el = document.getElementById("storage-foot");
  if (!el) return;
  const line = unreadableLine();
  el.textContent = line;
  el.hidden = line === "";
}

/** Records that the saved copy of `name` (plain words, e.g. "Column choices") could not be read and `used` (default "defaults") was used instead. `id` tells one stored value from another with the same name. */
export function noteUnreadable(name, id = name, used = "defaults") {
  if (damaged.has(id) && damaged.get(id).name === name && damaged.get(id).used === used) return;
  damaged.set(id, { name, used });
  render();
}

/** The setting was saved again, so its damaged copy is gone. */
export function clearUnreadable(id) {
  if (damaged.delete(id)) render();
}

/** The names now damaged, each once, in the order they were found. */
export function unreadableNames() {
  return [...new Set([...damaged.values()].map((d) => d.name))];
}

/** The foot's sentence; "" when nothing is damaged. */
export function unreadableLine() {
  const names = unreadableNames();
  if (!names.length) return "";
  const used = [...new Set([...damaged.values()].map((d) => d.used))];
  return `Reset to ${used.join(" and ")} because the saved copy could not be read: ${names.join(", ")}.`;
}

/** For tests: forget everything. */
export function resetUnreadable() {
  damaged.clear();
  render();
}
