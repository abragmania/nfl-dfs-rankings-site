// The Entries tab's browser storage (D75): the picks, class overrides and kept rows of each uploaded file, the Sort choice, and
// the pruning of files no longer listed. Moved unchanged out of entries-wire.js (Showdown Entries plan 2026-10-20, step 3) and
// namespaced, so a second Entries tab (the Showdown game's, "nfldfs.sdentries") keeps its own keys and neither tab's pruning
// reaches the other's: every key is `${ns}.<kind>.v1:<file>` or `${ns}.sort.v1`, and the classic namespace "nfldfs.entries"
// gives today's keys byte for byte. Imported by entries-wire.js only; imports only the pure Entries modules.
import { picksStorageKey, restorePicks, sortStorageKey, restoreSort } from "./entries.js";
import { classesStorageKey, restoreClasses, groupByContest, effectiveAssignments, ENTRIES_STORAGE_NS } from "./entries-plan.js";
import { keepStorageKey, restoreKeep } from "./entries-fill.js";

/** One tab's storage. `ns`: its namespace; `getSaved()`: the saved lineups now; `lineupsFor(saved, f)`: the file's lineups;
 *  `onBlocked()`: storage threw (private browsing, quota, disabled), so the tab says so once (🔵 2026-10-17). */
export function createEntriesStorage({ ns = ENTRIES_STORAGE_NS, getSaved, lineupsFor, onBlocked }) {
  const storageBlocked = () => onBlocked?.();

  /** Picks are kept in localStorage per uploaded file name so they survive a reload (D75). */
  function readStoredPicks(f) {
    let raw = null;
    try {
      raw = window.localStorage.getItem(picksStorageKey(f.file, ns));
    } catch {
      storageBlocked();
      return {};
    }
    if (raw === null) return {};
    const saved = getSaved();
    // Before the saved lineups have loaded the list is empty: keep every id; effectiveAssignments drops a stale one.
    const lineups = Array.isArray(saved) && saved.length && f.slate?.key ? lineupsFor(saved, f) : null;
    return restorePicks(raw, f.entries, lineups);
  }

  /** `f`: the listed file (its slate is known), `assigned`: its picks. */
  function storePicks(f, assigned) {
    if (!f?.slate) return;
    const eff = effectiveAssignments(f.entries, lineupsFor(getSaved(), f), assigned);
    try {
      if (Object.keys(eff).length) window.localStorage.setItem(picksStorageKey(f.file, ns), JSON.stringify(eff));
      else window.localStorage.removeItem(picksStorageKey(f.file, ns));
    } catch {
      storageBlocked();
    }
  }

  /** 🔵 2026-10-17 (F1): the rows Adam set to "(leave as is)" or picked by hand survive a reload, per file name like the
   *  picks. Null when nothing usable is stored (or storage is blocked). */
  function readStoredKeep(f) {
    let raw = null;
    try {
      raw = window.localStorage.getItem(keepStorageKey(f.file, ns));
    } catch {
      storageBlocked();
      return null;
    }
    return raw === null ? null : restoreKeep(raw, f.entries);
  }

  function storeKeep(fileName, keep) {
    try {
      if (keep && keep.size) window.localStorage.setItem(keepStorageKey(fileName, ns), JSON.stringify([...keep].map(String)));
      else window.localStorage.removeItem(keepStorageKey(fileName, ns));
    } catch {
      storageBlocked();
    }
  }

  /** Adam's contest class overrides, kept per file name like the picks (plan item 3). */
  function readStoredClasses(f) {
    let raw = null;
    try {
      raw = window.localStorage.getItem(classesStorageKey(f.file, ns));
    } catch {
      storageBlocked();
      return {};
    }
    return raw === null ? {} : restoreClasses(raw, groupByContest(f.entries));
  }

  function storeClasses(fileName, classes) {
    const c = classes ?? {};
    try {
      if (Object.keys(c).length) window.localStorage.setItem(classesStorageKey(fileName, ns), JSON.stringify(c));
      else window.localStorage.removeItem(classesStorageKey(fileName, ns));
    } catch {
      storageBlocked();
    }
  }

  /** The stored Sort choice ("number" or "letter"), or null when storage threw. */
  function readSort() {
    try {
      return restoreSort(window.localStorage.getItem(sortStorageKey(ns)));
    } catch {
      storageBlocked();
      return null;
    }
  }

  function storeSort(sortBy) {
    try {
      window.localStorage.setItem(sortStorageKey(ns), sortBy);
    } catch {
      storageBlocked();
    }
  }

  /** After a successful load that listed at least one file: drop the stored picks, class overrides and kept rows of every
   *  file not in the list (an older upload or another week; only the newest upload of a slate can be exported). An empty
   *  list prunes nothing. Only this namespace's keys are looked at. */
  function pruneStoredPicks(names) {
    const prefixes = [picksStorageKey("", ns), classesStorageKey("", ns), keepStorageKey("", ns)];
    try {
      const ls = window.localStorage;
      for (let i = ls.length - 1; i >= 0; i--) {
        const k = ls.key(i);
        const prefix = k === null ? undefined : prefixes.find((p) => k.startsWith(p));
        if (prefix !== undefined && !names.has(k.slice(prefix.length))) ls.removeItem(k);
      }
    } catch {
      storageBlocked(); // nothing to prune
    }
  }

  return { readStoredPicks, storePicks, readStoredKeep, storeKeep, readStoredClasses, storeClasses, readSort, storeSort, pruneStoredPicks };
}
