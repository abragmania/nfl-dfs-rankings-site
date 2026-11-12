// The one player-id array check, shared by the classic Optimizer request (generate-request.js) and the Showdown
// request checks (server/showdown/lineup-checks.js). Pure leaf: no import, so both stay browser-safe and the site
// build copies it with them.

// Ids as strings or numbers; anything else is refused, so a typo'd body never quietly rosters or excludes a player.
export function validateIdArray(value, name) {
  if (value === undefined || value === null) return { ids: [] };
  if (!Array.isArray(value)) return { error: `${name} must be an array of player ids` };
  for (const item of value) {
    if (typeof item !== "string" && typeof item !== "number") {
      return { error: `${name} must contain only player id strings or numbers` };
    }
  }
  return { ids: value };
}
