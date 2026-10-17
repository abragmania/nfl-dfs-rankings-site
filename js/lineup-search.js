// The pool uses Rankings' search; the active search shows as a chip whose × clears it everywhere.
import { escapeHtml } from "./format.js";
import { store } from "./state.js";

export function poolSearchChipHtml(search) {
  const q = String(search ?? "").trim();
  if (!q) return "";
  return `<div class="lineup-pool-search"><button type="button" class="chip toggle-chip active pool-search-chip" data-action="pool-search-clear" title="Clear the search (Rankings' search box too)">Search: "${escapeHtml(q)}" &times;</button></div>`;
}

export function wirePoolSearchChip(container) {
  container.querySelector("[data-action='pool-search-clear']")?.addEventListener("click", () => {
    const box = document.querySelector("#search-input");
    if (box) box.value = "";
    store.setFilters({ search: "" });
  });
}
