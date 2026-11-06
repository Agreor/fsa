import { assignOccurrences } from "../contracts.js";

const reason = (message) => ({ reason: message });
const MONEY = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;
const minor = (text) => (MONEY.test(text) ? Number(text.replaceAll(",", "").replace(".", "")) : null);
const DATE = /^(\d{2})\/(\d{2})\/(\d{2})$/;
const iso = (d, m, y) => {
  const value = `${y}-${m}-${d}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
};
// Column starts seen in the layout: withdrawals begin left of DEPOSIT_X, deposits left of BALANCE_X, the balance left of VIA_X.
const DEPOSIT_X = 300, BALANCE_X = 375, VIA_X = 430;

// A savings-account statement: Date, Particulars, Withdrawal, Deposit, Balance and a B/F opening row.
// Amounts come from the running balance and are checked against the column they sit in and the footer totals.
export function parse(pages, { account } = {}) {
  const lines = Array.isArray(pages) ? pages.flatMap((page) => page?.lines ?? []) : [];
  if (!lines.length) return reason("Missing input lines");
  if (!lines.some((line) => /STATEMENT OF SAVING ACCOUNT/i.test(line.text ?? ""))) return reason("Missing STATEMENT OF SAVING ACCOUNT marker");
  if (!lines.some((line) => /\bParticulars\b/.test(line.text ?? "") && /\bWithdrawal\b/.test(line.text ?? "") && /\bDeposit\b/.test(line.text ?? ""))) {
    return reason("Missing table header with Date, Particulars, Withdrawal, Deposit and Balance");
  }
  const currency = lines.map((line) => /Currency\s*\|?\s*([A-Z]{3})\b/.exec(line.text ?? "")?.[1]).find(Boolean);
  if (!currency) return reason("Missing currency");
  const period = lines.map((line) => /Statement Period\s+(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(line.text ?? "")).find(Boolean);
  const from = period && iso(period[1], period[2], period[3]);
  const to = period && iso(period[4], period[5], period[6]);
  if (!from || !to || from > to) return reason("Missing or invalid statement period");

  const rows = [];
  let previous = null; // running balance, minor units
  let opening = null;
  let debits = 0, credits = 0;
  for (const [index, line] of lines.entries()) {
    const items = [...(line.items ?? [])].sort((a, b) => a.x - b.x);
    const first = items[0]?.text ?? "";
    const dm = DATE.exec(first);
    if (!dm) continue;
    const where = `line ${index + 1}`;
    if (items[1]?.text === "B/F") {
      const balance = minor(items.at(-1)?.text ?? "");
      if (balance == null) return reason(`Invalid opening balance at ${where}`);
      if (opening !== null) continue; // each page may repeat it only once
      opening = previous = balance;
      continue;
    }
    if (previous === null) return reason(`Transaction before the opening balance at ${where}`);
    const date = iso(dm[1], dm[2], `20${dm[3]}`);
    if (!date) return reason(`Invalid date at ${where}`);
    const particulars = items[1]?.text;
    const money = items.slice(2).filter((item) => MONEY.test(item.text));
    if (!particulars || MONEY.test(particulars) || money.length !== 2) return reason(`Unrecognized transaction line at ${where}`);
    const [amountItem, balanceItem] = money;
    if (!(amountItem.x < BALANCE_X && balanceItem.x >= BALANCE_X && balanceItem.x < VIA_X)) return reason(`Unexpected columns at ${where}`);
    const amount = minor(amountItem.text), balance = minor(balanceItem.text);
    const signed = balance - previous;
    if (Math.abs(signed) !== amount) return reason(`Amount does not match the running balance at ${where}`);
    if ((signed < 0) !== (amountItem.x < DEPOSIT_X)) return reason(`Amount is in the wrong column at ${where}`);
    if (signed < 0) debits += 1; else credits += 1;
    previous = balance;
    rows.push({ date, description: particulars, amount: signed, currency, account });
  }
  if (opening === null) return reason("Missing B/F opening balance");

  const footer = (label) => lines.map((line) => new RegExp(`Total No\\. of ${label}\\s+(\\d+)\\s.*?Total ${label.slice(0, -1)} Amount\\s+(\\d{1,3}(?:,\\d{3})*\\.\\d{2})`).exec(line.text ?? "")).find(Boolean);
  const debitTotals = footer("Debits"), creditTotals = footer("Credits");
  if (!debitTotals || !creditTotals) return reason("Missing debit and credit totals");
  const sum = (sign) => rows.filter((row) => Math.sign(row.amount) === sign).reduce((total, row) => total + Math.abs(row.amount), 0);
  if (Number(debitTotals[1]) !== debits || minor(debitTotals[2]) !== sum(-1)) return reason("Debit total does not match the transactions");
  if (Number(creditTotals[1]) !== credits || minor(creditTotals[2]) !== sum(1)) return reason("Credit total does not match the transactions");

  const prior = new Date(`${from}T00:00:00Z`);
  prior.setUTCDate(prior.getUTCDate() - 1);
  return {
    rows: assignOccurrences(rows),
    coverage: { from, to },
    balances: [{ currency, asOf: prior.toISOString().slice(0, 10), amount: opening }, { currency, asOf: to, amount: previous }],
  };
}
