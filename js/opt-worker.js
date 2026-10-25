// The public site's Optimizer runs here, off the page's thread, so the page stays responsive while lineups are made
// (DECISIONS.md D69). tools/publish.mjs copies this file to out/js/opt-worker.js; site-src/api.js starts it as a
// module worker and falls back to the page's thread when the browser cannot. Message in: {id, args} (the arguments
// of generateResponse); message out: {id, response}.
import { generateResponse, errorBody } from "./site-generate.js";

self.onmessage = (event) => {
  const { id, args } = event.data ?? {};
  let response;
  try {
    response = generateResponse(args ?? {});
  } catch (e) {
    console.error("lineup generate: failed", e);
    response = errorBody("LINEUP_GENERATE_FAILED", "Could not make lineups.");
  }
  self.postMessage({ id, response });
};
