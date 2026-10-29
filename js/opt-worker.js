// The public site's Optimizer runs here, off the page's thread, so the page stays responsive while lineups are made
// (DECISIONS.md D69). tools/publish.mjs copies this file to out/js/opt-worker.js; site-worker.js starts it as a module
// worker for site-src/api.js (the classic Optimizer) and site-showdown.js (the Showdown Optimizer, RULES.md D71) and falls
// back to the page's thread when the browser cannot. Message in: {id, kind, args} (kind "showdown": the arguments of
// site-showdown.js showdownGenerateResponse; otherwise those of site-generate.js generateResponse); message out: {id, response}.
import { generateResponse, errorBody } from "./site-generate.js";
import { showdownGenerateResponse, SHOWDOWN_GENERATE_FAILED } from "./site-showdown.js";

self.onmessage = (event) => {
  const { id, kind, args } = event.data ?? {};
  let response;
  try {
    response = kind === "showdown" ? showdownGenerateResponse(args ?? {}) : generateResponse(args ?? {});
  } catch (e) {
    console.error("lineup generate: failed", e);
    response = kind === "showdown" ? SHOWDOWN_GENERATE_FAILED() : errorBody("LINEUP_GENERATE_FAILED", "Could not make lineups.");
  }
  self.postMessage({ id, response });
};
