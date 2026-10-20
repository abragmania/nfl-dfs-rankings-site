// Browser stand-in for server/lib/log.js on the public site (DECISIONS.md D69). tools/publish.mjs writes this file
// at out/server/lib/log.js, so the Optimizer's engine (server/lineup/multi.js), copied unchanged, logs to the
// browser console instead of the server's log file. Same names and signatures as the server logger's functions.
export function log(level, msg, extra) {
  const line = `${new Date().toISOString()} ${String(level).toUpperCase()} ${msg}${extra ? " " + JSON.stringify(extra) : ""}`;
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}
export const info = (m, e) => log("info", m, e);
export const warn = (m, e) => log("warn", m, e);
export const error = (m, e) => log("error", m, e);
