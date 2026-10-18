// Which DraftKings export a file is, told from its own column headers (Adam 2026-10-18: "it should expect to receive the uploads
// in the same format every time ... these are csvs with column headers that never change"). Browser-loadable leaf module with
// no imports: the one Upload button (header.js), the Entries tab's button and the Showdown buttons all route through it.
//   "entries"  the first cell of the first line is `Entry ID` (DKEntries.csv, PROJECT.md Part 4 Entries)
//   "showdown" a salary file whose `Roster Position` column carries CPT in any row (🔵 2026-10-18: every row, not the first 200)
//   "classic"  a salary file with the seven columns server/slate/parse-salaries.js requires and no CPT row
//   "unknown"  anything else
const REQUIRED_SALARY_HEADERS = ["Position", "Name", "ID", "Roster Position", "Salary", "Game Info", "TeamAbbrev"];

/** The text of an uploaded file, decoded as UTF-8 with the byte order mark KEPT (a leading U+FEFF), so the server
 *  stores and writes back exactly the bytes DraftKings gave. Invalid UTF-8 throws rather than being patched. */
export function decodeEntriesBytes(buffer) {
  return new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(buffer);
}

/** One CSV line as its cells (quoted cells and doubled quotes handled; a line break inside quotes is not followed). */
function splitLine(line) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/** { kind: "entries" | "showdown" | "classic" | "unknown", firstLine } for a file's text (a leading byte order mark is ignored). */
export function dkCsvKind(text) {
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const firstLine = lines[0] ?? "";
  const header = splitLine(firstLine).map((c) => c.trim());
  if (header[0] === "Entry ID") return { kind: "entries", firstLine };
  const rp = header.indexOf("Roster Position");
  if (rp >= 0) {
    const captain = lines.slice(1).some((l) => l && (splitLine(l)[rp] ?? "").split("/").some((p) => p.trim().toUpperCase() === "CPT"));
    if (captain) return { kind: "showdown", firstLine };
    if (REQUIRED_SALARY_HEADERS.every((h) => header.includes(h))) return { kind: "classic", firstLine };
  }
  return { kind: "unknown", firstLine };
}

export const NOT_UTF8_MESSAGE = "That file is not plain UTF-8 text, so it was not uploaded. Use the entries file exactly as DraftKings exported it.";

/** A file's bytes as { kind, firstLine, text }: `text` keeps the byte order mark for an entries file (read strictly, so
 *  invalid UTF-8 throws NOT_UTF8_MESSAGE) and drops it for a salary file (what File.text() gives). */
export function readDkBytes(buffer) {
  const lenient = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer);
  const { kind, firstLine } = dkCsvKind(lenient);
  if (kind !== "entries") return { kind, firstLine, text: lenient.replace(/^﻿/, "") };
  try {
    return { kind, firstLine, text: decodeEntriesBytes(buffer) };
  } catch {
    throw new Error(NOT_UTF8_MESSAGE);
  }
}

/** The one routing of an uploaded file (Adam 2026-10-18): reads its bytes, tells the kind from the headers and hands the text
 *  to the matching handler in `deps` { classic, showdown, entries, unknown } (each gets the text; `unknown` gets the first line).
 *  Returns what the handler returns. A salary file is read by the bytes, not File.text(), so an entries file keeps its byte order mark. */
export async function routeDkUpload(file, deps) {
  const { kind, firstLine, text } = readDkBytes(await file.arrayBuffer());
  if (kind === "unknown") return deps.unknown(firstLine);
  return deps[kind](text);
}
