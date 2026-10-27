// Shared shapes for parsers, the PDF reader and the store. Slice workers build against these and do not change them.
//
// Row: { date: "YYYY-MM-DD", description, amount (integer, minor units, negative = money out), currency ("EUR"),
//        account, occurrence (1-based), sourceId?, country? ("BE"), time? ("HH:MM") }
// Parser outcome: { rows, coverage: { from, to } | null, balances: [{ currency, asOf, amount }] } or { reason }
// PDF reader outcome: { pages: [{ lines: [{ text, y }] }] } in reading order, or { error } with a PDF_ERRORS code.
//   A line is one visual row: items whose y differ by at most 2 units are one row, sorted left to right, joined with one space;
//   lines run top to bottom (y descending). Parsers get lines, never raw positioned items.
// PDF reader factory: createPdfReader({ pdfjs, workerSrc }) -> extractPdf(file, askPassword). The app imports the pdf.js module and
//   passes it in (built into ./vendor/pdfjs/ by scripts/build.mjs); tests pass the module from node_modules. askPassword() may be async.
// Source module (src/sources/<id>.js): export parse(pages, context) -> parsed outcome; context = { account }. It rejects text that is
//   not its layout with { reason }, never with partial rows.
// Reader options: askPassword(info) -> string | null, may be async; info = { wrong?: true }. First call on password_needed; a wrong
//   password calls it again with { wrong: true }, at most 3 attempts; null cancels and ends with the last error code.
// Store (src/store.js): createStore(backend); backends memoryBackend() and indexedDbBackend(name); every method async:
//   addBatch(accountId, parsed, { fileHash, name }) -> { batchId, added, skipped }, or { duplicateFile: true, added: 0, skipped } when
//     that fileHash was already imported for the account (no batch is created);
//   undoBatch(batchId) -> { removed }; listRows({ account? }); listBatches() -> [{ id, account, name, fileHash, coverage, balances, ... }].
//   A row is identified by rowIdentity (per account); every row records every batch holding it; undo removes only rows no other batch holds.
// Import flow (src/import-flow.js): runImport({ bytes, name, accountId, source, reader, store, askPassword }) ->
//   { status: "imported", batchId, added, skipped } | { status: "duplicate_file", added: 0, skipped } | { status: "rejected", code?, reason? }.
//   code is a PDF_ERRORS value; reason is the parser's. It hashes the bytes (SHA-256) and never stores the password.
// The runnable definition of all of the above is tests/feature/slice1.feature.mjs.

export const PDF_ERRORS = ["password_needed", "wrong_password", "no_text", "unreadable"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value) => {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const isMinor = (value) => Number.isSafeInteger(value);
const isCurrency = (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value);

export function validateRow(row) {
  if (!row || typeof row !== "object") return ["row is not an object"];
  const problems = [];
  if (!isDate(row.date)) problems.push("date must be a real YYYY-MM-DD date");
  if (typeof row.description !== "string" || !row.description.trim()) problems.push("description is empty");
  if (!isMinor(row.amount)) problems.push("amount must be an integer in minor units");
  if (!isCurrency(row.currency)) problems.push("currency must be three capital letters");
  if (typeof row.account !== "string" || !row.account) problems.push("account is missing");
  if (!Number.isInteger(row.occurrence) || row.occurrence < 1) problems.push("occurrence must be 1 or more");
  if (row.sourceId !== undefined && (typeof row.sourceId !== "string" || !row.sourceId)) problems.push("sourceId must be a non-empty string");
  if (row.country !== undefined && !/^[A-Z]{2}$/.test(row.country)) problems.push("country must be two capital letters");
  if (row.time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)) problems.push("time must be HH:MM");
  return problems;
}

const normalise = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();

// A row's identity: the source id when the source gives one, otherwise every value field plus the occurrence number.
export function rowIdentity(row) {
  if (row.sourceId) return `id|${row.account}|${row.sourceId}`;
  return ["v", row.account, row.date, row.amount, row.currency, normalise(row.description), row.occurrence].join("|");
}

// Numbers identical rows within one file 1, 2, 3... in file order, so genuine repeats stay distinct.
export function assignOccurrences(rows) {
  const seen = new Map();
  return rows.map((row) => {
    if (row.sourceId) return { ...row, occurrence: 1 };
    const key = rowIdentity({ ...row, occurrence: 1 });
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return { ...row, occurrence: count };
  });
}

export function validateParsed(parsed) {
  if (!parsed || typeof parsed !== "object") return ["parse result is not an object"];
  if ("reason" in parsed) return typeof parsed.reason === "string" && parsed.reason.trim() ? [] : ["rejection needs a reason"];
  if (!Array.isArray(parsed.rows)) return ["rows must be an array"];
  const problems = [];
  parsed.rows.forEach((row, index) => validateRow(row).forEach((p) => problems.push(`row ${index + 1}: ${p}`)));
  const { coverage } = parsed;
  if (coverage != null) {
    if (!isDate(coverage.from) || !isDate(coverage.to)) problems.push("coverage needs real from and to dates");
    else if (coverage.from > coverage.to) problems.push("coverage starts after it ends");
  }
  for (const [index, balance] of (parsed.balances ?? []).entries()) {
    if (!isCurrency(balance?.currency) || !isDate(balance?.asOf) || !isMinor(balance?.amount)) {
      problems.push(`balance ${index + 1}: needs currency, real asOf date and integer amount`);
    }
  }
  return problems;
}
