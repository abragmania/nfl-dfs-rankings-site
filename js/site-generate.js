// The Optimizer on the public site (DECISIONS.md D69): POST /api/lineup/generate (server/server.js
// handleLineupGenerate) done in the visitor's browser on the published board. tools/publish.mjs copies this file to
// out/js/site-generate.js and the engine, unchanged, to out/server/lineup/ (the same relative path as here), with a
// console logger in place of server/lib/log.js. Pure: no network, no storage, no page; it runs on the page or in
// out/js/opt-worker.js.
//
// The validation, the slate's existing-lineup filter, fpCatches and the response enrichment are the route's own, from
// server/lineup/generate-request.js (copied beside the engine); tests/site-optimizer.test.mjs runs the same cases
// through both as a wiring check.
import { generateLineups } from "../server/lineup/multi.js";
import {
  generateBodyError, findGenerateSlate, prepareGenerate, existingForSlate, fpCatchesFor, enrichGenerateResult
} from "../server/lineup/generate-request.js";

export { validateGenerateSettings, matchupString } from "../server/lineup/generate-request.js";

/** The route's response envelope (server.js envelope / errorBody). */
export function envelope(body, { ok = true, stale = [] } = {}) {
  return { ok, generatedAt: new Date().toISOString(), stale, ...body };
}
export function errorBody(code, message, stale = []) {
  return envelope({ error: { code, message } }, { ok: false, stale });
}

/**
 * The route's work on baked data. `board`: the baked /api/board body (rows, slates, stale). `slate`: the baked
 * /api/slate body; the engine reads only a salary cap from it, and neither it nor the route's full slate carries
 * one, so both use DraftKings' $50,000 (D1). `body`: the request {slate, settings}. `saved`: this device's saved
 * lineups of the week (every slate); the route's own filter picks the chosen slate's. Returns the route's body.
 */
export function generateResponse({ board, slate, body: rawBody, saved }) {
  if (!board || board.ok === false || !Array.isArray(board.rows)) {
    return board && board.ok === false && board.error ? board : errorBody("NO_SLATE", "No slate has been uploaded yet.");
  }
  const body = rawBody ?? {};
  const bodyError = generateBodyError(body);
  if (bodyError) return errorBody("VALIDATION_ERROR", bodyError);
  const slateFound = findGenerateSlate(body.slate, Array.isArray(board.slates) ? board.slates : []);
  if (slateFound.error) return errorBody("VALIDATION_ERROR", slateFound.error);
  const { secondSlate } = slateFound;

  const checked = prepareGenerate(board.rows, secondSlate, body.settings);
  if (checked.error) return errorBody("VALIDATION_ERROR", checked.error);
  const { rows, rowById, slateIds } = checked;

  const existing = existingForSlate(saved, secondSlate, slateIds);
  const fpCatches = fpCatchesFor(rows);

  const stale = Array.isArray(board.stale) ? board.stale : [];
  try {
    const result = generateLineups({ rows, slate, settings: { ...checked.settings, fpCatches }, existing });
    return envelope(enrichGenerateResult(result, rowById), { stale });
  } catch (e) {
    console.error("lineup generate: failed", e);
    return errorBody("LINEUP_GENERATE_FAILED", "Could not make lineups.");
  }
}
