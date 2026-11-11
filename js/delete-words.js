// The sentence a saved lineup's failed Delete leaves on its card (optimizer standard A12, round 3 fix batch item 16): one plain sentence, the same words on the classic
// and the Showdown Optimizer, never the browser's raw "Failed to fetch". `data` is the server's answer when it came back refusing; `error` the thrown error when the
// request did not come back (a lost connection, or an answer that was not JSON).
export const NOT_DELETED = "Not deleted";

/** The id start of a lineup saved on this device on the public site: site-src/site-lineups.js DEVICE_ID_PREFIX. The app's pages cannot import site-src (the server serves
 *  public/ only), so this is the browser's copy, held equal to it by tests/site-readonly-delete.test.mjs. */
export const DEVICE_ID_PREFIX = "device-";

/** Whether a saved card offers Delete: always in the app; on the public site only a lineup saved on this device (its id starts DEVICE_ID_PREFIX), never the app's read-only
 *  lineups (PROJECT.md Part 4 item 5; site.css hides it too, this keeps the button out of the page). */
export const canDeleteSaved = (id, onSite) => !onSite || String(id ?? "").startsWith(DEVICE_ID_PREFIX);

export function notDeletedText({ data = null, error = null } = {}) {
  if (error) {
    return error.code === "NOT_JSON" && error.message
      ? `${NOT_DELETED}: ${error.message}` // the readers' own plain sentence ("The server's answer could not be read (status 502).")
      : `${NOT_DELETED}: the app could not reach the server. Try again.`;
  }
  return `${NOT_DELETED}: ${data?.error?.message ?? "the server did not take it"}`;
}
