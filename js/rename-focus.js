// The saved card's rename box takes the keyboard when it opens, its name selected, so typing replaces it and Enter saves (optimizer standard C27 and A12, round 5; both Optimizers). A redraw while the box stays
// open does not take the keyboard again; a box that closes lets the next one do.
let focusedFor = null;

/** Called after each draw of the panel: `renamingId` is the card whose box is open (or null). Returns whether the box was focused now. */
export function focusOpenRename(container, renamingId) {
  if (renamingId == null) {
    focusedFor = null;
    return false;
  }
  if (focusedFor === renamingId) return false;
  const input = container?.querySelector?.("[data-rename-input]");
  if (!input) return false;
  focusedFor = renamingId;
  input.focus?.({ preventScroll: true });
  input.select?.();
  return true;
}

/** Enter in a rename box saves the new name, as its Save button does (`save(id, text)`); `idOf(input)` is the card the box belongs to. */
export function wireRenameEnter(container, saveSelector, save) {
  container.querySelectorAll("[data-rename-input]").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const id = container.querySelector(saveSelector)?.dataset.id;
      if (id) save(id, input.value);
    });
  });
}
