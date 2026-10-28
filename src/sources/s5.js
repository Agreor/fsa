import { assignOccurrences } from "../contracts.js";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const amountPattern = /^(\d{1,3}(?:,\d{3})*)\.(\d{2})( CR)?$/;
const reason = (message) => ({ reason: message });

function amountInMinorUnits(text) {
  const match = amountPattern.exec(text);
  if (!match) return null;
  const whole = Number(match[1].replaceAll(",", ""));
  return whole * 100 + Number(match[2]);
}

function dateValue(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year) return null;
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lineText(line) {
  return line?.text ?? line?.items?.map((item) => item.text).join(" ") ?? "";
}

function findDate(lines) {
  for (const entry of lines) {
    const match = /\bSTATEMENT DATE\b.*?(\d{2}) ([A-Z]{3}) (\d{4})/i.exec(lineText(entry.line));
    if (!match) continue;
    const month = MONTHS.indexOf(match[2].toUpperCase()) + 1;
    const date = dateValue(Number(match[3]), month, Number(match[1]));
    if (date) return { date, year: Number(match[3]), month };
  }
  return null;
}

function balance(entry, label) {
  const text = entry.line.items?.at(-1)?.text ?? "";
  const value = amountInMinorUnits(text);
  if (value == null) return { reason: `Invalid ${label} at ${entry.where}` };
  return { value: / CR$/.test(text) ? value : -value };
}

function totalBalance(entry) {
  const items = entry.line.items ?? [];
  if (items.length !== 3 || amountInMinorUnits(items[1]?.text ?? "") == null
      || amountInMinorUnits(items[2]?.text ?? "") == null) {
    return { reason: `Invalid TOTAL row at ${entry.where}` };
  }
  const text = items[1].text;
  const value = amountInMinorUnits(text);
  return { value: / CR$/.test(text) ? value : -value };
}

function transaction(line, pageIndex, lineIndex, statement) {
  const items = (line.items ?? []).map((item) => item.text);
  const location = `page ${pageIndex + 1}, line ${lineIndex + 1}`;
  const first = items[0] ?? "";
  if (!/^\d\d [A-Z]{3}$/.test(first)) return null;
  const dateMatch = /^(\d\d) ([A-Z]{3})$/.exec(items[1] ?? "");
  const amountText = items.at(-1) ?? "";
  const value = amountInMinorUnits(amountText);
  const description = items.slice(2, -1).join(" ").replace(/\s+/g, " ").trim();
  if (!dateMatch || value == null || !description) {
    return { reason: `Malformed transaction at ${location}` };
  }
  const month = MONTHS.indexOf(dateMatch[2]) + 1;
  if (!month) return { reason: `Invalid transaction date at ${location}` };
  const year = month > statement.month ? statement.year - 1 : statement.year;
  const date = dateValue(year, month, Number(dateMatch[1]));
  if (!date) return { reason: `Invalid transaction date at ${location}` };
  return {
    date,
    description,
    amount: value === 0 || / CR$/.test(amountText) ? value : -value,
  };
}

export function parse(pages, { account } = {}) {
  if (!Array.isArray(pages)) return reason("Missing input pages or lines");
  const all = pages.flatMap((page, pageIndex) =>
    (page?.lines ?? []).map((line, lineIndex) => ({
      line,
      pageIndex,
      lineIndex,
      where: `page ${pageIndex + 1}, line ${lineIndex + 1}`,
    })),
  );
  if (!all.length) return reason("Missing input pages or lines");

  const header = all.find(({ line }) => {
    const text = lineText(line);
    return /\bPOST DATE\b/.test(text)
      && /\bTRANS DATE\b/.test(text)
      && /\bDESCRIPTION\b/.test(text)
      && /\bAMOUNT \([A-Z]{3}\)/.test(text);
  });
  if (!header) return reason("Missing header with POST DATE, TRANS DATE, DESCRIPTION and AMOUNT (XXX)");
  const currency = /\bAMOUNT \(([A-Z]{3})\)/.exec(lineText(header.line))[1];

  const statement = findDate(all);
  if (!statement) return reason("Missing or invalid statement date");
  const previous = all.find(({ line }) => /^PREVIOUS BALANCE\b/.test(lineText(line)));
  if (!previous) return reason("Missing PREVIOUS BALANCE row");
  const total = all.find(({ line }) => /^TOTAL\b/.test(lineText(line)));
  if (!total) return reason("Missing TOTAL row");

  const opening = balance(previous, "PREVIOUS BALANCE");
  if (opening.reason) return reason(opening.reason);
  const closing = totalBalance(total);
  if (closing.reason) return reason(closing.reason);

  const rows = [];
  for (const [pageIndex, page] of pages.entries()) {
    for (const [lineIndex, line] of (page?.lines ?? []).entries()) {
      const parsed = transaction(line, pageIndex, lineIndex, statement);
      if (parsed?.reason) return reason(parsed.reason);
      if (parsed) rows.push({ ...parsed, currency, account });
      else if (/^\d{1,2}(?:\s|$)/.test(line.items?.[0]?.text ?? "")) {
        return reason(`Malformed transaction at page ${pageIndex + 1}, line ${lineIndex + 1}`);
      }
    }
  }
  if (!rows.length) {
    return reason("No transaction rows (shortcut: quiet card months are not supported yet)");
  }

  const numbered = assignOccurrences(rows);
  const transactionTotal = numbered.reduce((sum, row) => sum + row.amount, 0);
  if (opening.value + transactionTotal !== closing.value) {
    return reason("Reconciliation failed: opening balance plus transactions does not equal TOTAL");
  }
  const from = numbered.reduce(
    (earliest, row) => row.date < earliest ? row.date : earliest,
    numbered[0].date,
  );
  const prior = new Date(`${from}T00:00:00Z`);
  prior.setUTCDate(prior.getUTCDate() - 1);
  return {
    rows: numbered,
    coverage: { from, to: statement.date },
    balances: [
      { currency, asOf: prior.toISOString().slice(0, 10), amount: opening.value },
      { currency, asOf: statement.date, amount: closing.value },
    ],
  };
}
