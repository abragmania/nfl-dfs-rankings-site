// Same-origin check for write routes (global rule: a local server that changes state checks origin on every write).
const HOST_HEADER = /^[A-Za-z0-9.\-:\[\]]+$/;
// Both servers listen on 127.0.0.1 only, so a real page's Host is one of these; any other name with a matching Origin is a
// DNS-rebinding page (evil.example pointed at 127.0.0.1) and is refused.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when the Origin header is absent (curl, the tests) or its host:port equals Host (case-insensitive) and Host names
 *  this machine (localhost, 127.0.0.1 or [::1]). A present but empty, "null" or unparseable Origin, or a missing,
 *  malformed or non-local Host, is refused (fails closed). */
export function sameOrigin(originHeader, hostHeader) {
  if (originHeader === undefined || originHeader === null) return true;
  if (typeof originHeader !== "string" || originHeader.trim() === "" || originHeader.trim().toLowerCase() === "null") return false;
  if (typeof hostHeader !== "string" || !HOST_HEADER.test(hostHeader)) return false;
  let origin;
  let host;
  try {
    origin = new URL(originHeader.trim());
    host = new URL(`${origin.protocol}//${hostHeader}`); // same scheme, so a default port compares equal to none
  } catch {
    return false;
  }
  if (origin.host === "") return false;
  if (!LOCAL_HOSTNAMES.has(host.hostname.toLowerCase())) return false;
  return origin.host.toLowerCase() === host.host.toLowerCase();
}

/** The origin check alone, for a write that carries no body (a DELETE, a refresh): null when the request may
 *  go on, else { status: 403, code: "FORBIDDEN_ORIGIN", message } for the caller to send. */
export function refuseForeignOrigin(headers) {
  if (sameOrigin(headers?.origin, headers?.host)) return null;
  return { status: 403, code: "FORBIDDEN_ORIGIN", message: "This request came from another site." };
}

/**
 * The origin and content-type check a JSON POST route runs before it reads its body (the showdown Build, Generate and
 * meter routes). Returns null when the request may go on, else { status, code, message } for the caller to send:
 * 403 FORBIDDEN_ORIGIN (a request from another site) or 415 UNSUPPORTED_MEDIA_TYPE (anything but application/json), the
 * latter worded by `contentTypeMessage` so each route keeps its own sentence.
 */
export function refuseNonJsonPost(headers, contentTypeMessage) {
  const foreign = refuseForeignOrigin(headers);
  if (foreign) return foreign;
  if (mediaTypeOf(headers) !== "application/json") {
    return { status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: contentTypeMessage };
  }
  return null;
}

/**
 * The same check for the two salary-file uploads (POST /api/slate/upload and POST /api/showdown/upload), which take the raw
 * CSV text: 403 FORBIDDEN_ORIGIN, else 415 UNSUPPORTED_MEDIA_TYPE for anything but text/csv or text/plain, a request with
 * no content type included (every real caller sends text/csv).
 */
export function refuseNonCsvPost(headers) {
  const foreign = refuseForeignOrigin(headers);
  if (foreign) return foreign;
  const contentType = mediaTypeOf(headers);
  if (contentType !== "text/csv" && contentType !== "text/plain") {
    return { status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: "Upload must be text/csv or text/plain." };
  }
  return null;
}

/** The Content-Type header's media type, lowercased and without parameters ("" when the header is absent). */
function mediaTypeOf(headers) {
  return (headers?.["content-type"] ?? "").split(";")[0].trim().toLowerCase();
}
