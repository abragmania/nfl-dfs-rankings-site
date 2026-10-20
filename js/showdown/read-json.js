// The one JSON reader for the Showdown mode's requests (🔵 866b0ce B4: api.js getJson, the Optimizer's generate and the meter's
// fetches each had a copy). A non-JSON answer (a 502, an HTML error page) throws an Error whose message is the plain sentence
// "The server's answer could not be read (status N)." with no address in it (B3), code "NOT_JSON" and the status, so a caller
// can show that sentence as it is instead of "Could not reach the server: ...".
export const NOT_JSON = "NOT_JSON";

/** The sentence for a non-JSON answer with this HTTP status. */
export function notJsonText(status) {
  return `The server's answer could not be read (status ${status}).`;
}

/** The parsed body of `res` (a fetch Response); throws the NOT_JSON error above when the body is not JSON. */
export async function readJson(res) {
  try {
    return await res.json();
  } catch (e) {
    const err = new Error(notJsonText(res.status));
    err.code = NOT_JSON;
    err.status = res.status;
    throw err;
  }
}

/** The sentence a page shows for a failed request: the NOT_JSON sentence as it is, anything else as a failure to reach the server. */
export function requestFailureText(e) {
  return e?.code === NOT_JSON ? e.message : `Could not reach the server: ${e?.message ?? e}`;
}
