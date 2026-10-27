// Shared shapes for parsers, the PDF reader and the store. Slice workers build against these and do not change them.
//
// Row: { date: "YYYY-MM-DD", description, amount (integer, minor units, negative = money out), currency ("EUR"),
//        account, occurrence (1-based), sourceId?, country? ("BE"), time? ("HH:MM") }
// Parser outcome: { rows, coverage: { from, to } | null, balances: [{ currency, asOf, amount }] } or { reason }
// PDF reader outcome: { pages: [{ lines: [{ text, y }] }] } in reading order, or { error } with a PDF_ERRORS code.
//   A line is one visual row: items whose y differ by at most 3 units are one row, sorted left to right, joined with one space;
//   lines run top to bottom (y descending). Parsers get lines, never raw positioned items.
// Store: addBatch(accountId, parsed, meta) -> { added, skipped }; undoBatch(batchId); listRows(filter); all async.

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
