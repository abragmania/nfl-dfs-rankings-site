// A Load from the Lineups tab goes to the working lineup of the lineup's own mode tab (Adam 2026-11-05), so that tab comes on screen first; answering No (or Esc) to the replace question puts the tab that was on screen back.
// DOM-free; lineup.js hands it the function that switches the mode tab.

/** `setMode(mode)` puts the GPP or Cash tab on screen. go(target, current) switches when the lineup is of the other mode; undo() puts the previous tab back (once); done() keeps the switch (the Load went through). */
export function loadModeSwitch(setMode) {
  let previous = null;
  return {
    go(target, current) {
      previous = target && target !== current ? current : null;
      if (previous !== null) setMode(target);
    },
    undo() {
      if (previous === null) return;
      const back = previous;
      previous = null;
      setMode(back);
    },
    done() {
      previous = null;
    },
  };
}
