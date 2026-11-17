// JSON that keeps Maps and Sets (RULES.md D71): TwoGun's two Showdown files are read into Maps and Sets (server/showdown/twogun-projections.js,
// twogun-ownership.js), and the public site's engine inputs (GET /api/showdown/<key>/engine-inputs, baked beside each game's board) carry them to the
// browser. encodeTagged turns a value into plain JSON data, decodeTagged turns it back. Pure and browser-safe: no node: module.

const TAG = "$tagged";
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set);

/** `value` with every Map written as { $tagged: "map", entries } and every Set as { $tagged: "set", values }, recursively. Anything else is copied as it is. */
export function encodeTagged(value) {
  if (value instanceof Map) return { [TAG]: "map", entries: [...value].map(([k, v]) => [encodeTagged(k), encodeTagged(v)]) };
  if (value instanceof Set) return { [TAG]: "set", values: [...value].map(encodeTagged) };
  if (Array.isArray(value)) return value.map(encodeTagged);
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeTagged(v)]));
  return value;
}

/** The inverse of encodeTagged. */
export function decodeTagged(value) {
  if (Array.isArray(value)) return value.map(decodeTagged);
  if (!isPlain(value)) return value;
  if (value[TAG] === "map" && Array.isArray(value.entries)) return new Map(value.entries.map(([k, v]) => [decodeTagged(k), decodeTagged(v)]));
  if (value[TAG] === "set" && Array.isArray(value.values)) return new Set(value.values.map(decodeTagged));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeTagged(v)]));
}
