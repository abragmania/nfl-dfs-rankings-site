// The sentence a saved lineup's failed Delete leaves on its card (optimizer standard A12, round 3 fix batch item 16): one plain sentence, the same words on the classic
// and the Showdown Optimizer, never the browser's raw "Failed to fetch". `data` is the server's answer when it came back refusing; `error` the thrown error when the
// request did not come back (a lost connection, or an answer that was not JSON).
export const NOT_DELETED = "Not deleted";

export function notDeletedText({ data = null, error = null } = {}) {
  if (error) {
    return error.code === "NOT_JSON" && error.message
      ? `${NOT_DELETED}: ${error.message}` // the readers' own plain sentence ("The server's answer could not be read (status 502).")
      : `${NOT_DELETED}: the app could not reach the server. Try again.`;
  }
  return `${NOT_DELETED}: ${data?.error?.message ?? "the server did not take it"}`;
}
