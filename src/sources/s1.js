import { assignOccurrences } from "../contracts.js";

const date = (d, m, y) => {
  const value = `${y}-${m}-${d}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
};
const money = (value) => {
  const match = /^([+-]?)(?:(?:\d{1,3}(?:[. ]\d{3})+)|\d+),([0-9]{2})$/.exec(value);
  if (!match) return null;
  const whole = Number(value.slice(match[1].length, value.lastIndexOf(",")).replace(/[. ]/g, ""));
  const cents = whole * 100 + Number(match[2]);
  return match[1] === "-" ? -cents : cents;
};
const reason = (message) => ({ reason: message });
const FOOTER_CUTOFF_Y = 85; // The real sample's highest footer line is at y=72; table rows sit above 100.

export function parse(pages, { account } = {}) {
  const all = Array.isArray(pages) ? pages.flatMap((page) => page?.lines ?? []) : [];
  if (!all.length) return reason("Missing input lines");
  if (!all.some((line) => line.text?.includes("Extrait de compte"))) return reason("Missing Extrait de compte marker");
  const header = all.find((line) => /\bDate\b/.test(line.text ?? "") && /\bDescription\b/.test(line.text ?? "") && /\bMontant\s*\(([A-Z]{3})\)/.test(line.text ?? ""));
  if (!header) return reason("Missing table header with Date, Description and Montant (XXX)");
  const currency = header.text.match(/\bMontant\s*\(([A-Z]{3})\)/)[1];
  const coverageLine = all.find((line) => /Du \d{2}\/\d{2}\/\d{4} au \d{2}\/\d{2}\/\d{4}/.test(line.text ?? ""));
  const coverageMatch = coverageLine?.text.match(/Du (\d{2})\/(\d{2})\/(\d{4}) au (\d{2})\/(\d{2})\/(\d{4})/);
  const from = coverageMatch && date(coverageMatch[1], coverageMatch[2], coverageMatch[3]);
  const to = coverageMatch && date(coverageMatch[4], coverageMatch[5], coverageMatch[6]);
  if (!from || !to || from > to) return reason(`Missing or invalid coverage${coverageLine ? ` at line ${all.indexOf(coverageLine) + 1}` : ""}`);

  const summaryValues = (label) => {
    const index = all.findIndex((line) => line.text?.includes(label));
    if (index < 0 || !all[index + 1]) return null;
    const values = (all[index + 1].text ?? all[index + 1].items?.slice().sort((a, b) => a.x - b.x).map((item) => item.text).join(" ") ?? "").trim().split(/\s+/);
    return { line: index + 2, amounts: values.slice(0, 2).map(money) };
  };
  const opening = summaryValues(`Ancien solde (${currency})`);
  const closing = summaryValues(`Nouveau solde (${currency})`);
  if (!opening || opening.amounts[0] == null) return reason(`Missing or invalid opening balance at line ${opening?.line ?? "?"}`);
  if (!closing || closing.amounts[0] == null) return reason(`Missing or invalid closing balance at line ${closing?.line ?? "?"}`);
  if (opening.amounts[1] == null) return reason(`Missing or invalid credit total at line ${opening.line}`);
  if (closing.amounts[1] == null) return reason(`Missing or invalid debit total at line ${closing.line}`);
  opening.amount = opening.amounts[0];
  closing.amount = closing.amounts[0];

  const rows = [];
  const acceptedTransactions = new Set();
  let lineNumber = 0;
  let looseTransactions = 0;
  for (const [pageIndex, page] of pages.entries()) {
    const pageLines = page?.lines ?? [];
    const pageHeader = pageLines.findIndex((line) => /\bDate\b/.test(line.text ?? "") && /\bDescription\b/.test(line.text ?? "") && /\bMontant\s*\([A-Z]{3}\)/.test(line.text ?? ""));
    const firstDated = pageLines.findIndex((line) => /^\d+[-/.]\d+/.test(line.text?.replace(/\s/g, "") ?? ""));
    const tableStart = pageHeader >= 0 ? pageHeader : firstDated;
    let active = false;
    let pageLastRow;
    for (const [pageLineIndex, line] of pageLines.entries()) {
      lineNumber++;
      const parts = [...(line.items ?? [])].sort((a, b) => a.x - b.x);
      const first = parts[0]?.text ?? "";
      const last = parts.at(-1)?.text ?? "";
      const compact = (line.text ?? parts.map((part) => part.text).join(" ")).replace(/\s/g, "");
      const datePrefix = /^(\d{2}-\d{2}-\d{4})/.exec(compact)?.[1];
      const dateLike = /^\d+[-/.]\d+/.test(compact);
      const moneyLike = /[,\.]\d{2}$/.test(last);
      if (line.y <= FOOTER_CUTOFF_Y) {
        if (dateLike && moneyLike) return reason(`Transaction-shaped footer at page ${pageIndex + 1}, line ${lineNumber}`);
        active = false; pageLastRow = undefined; continue;
      }
      if (pageLineIndex < tableStart || tableStart < 0) continue;
      if (pageLineIndex === pageHeader) { active = true; pageLastRow = undefined; continue; }
      active = true;
      if (!active) continue;
      if (dateLike) looseTransactions++;
      if (datePrefix) {
        active = true;
        const dm = /^(\d{2})-(\d{2})-(\d{4})$/.exec(datePrefix);
        const iso = date(dm[1], dm[2], dm[3]);
        if (!iso) return reason(`Invalid date at page ${pageIndex + 1}, line ${pageLineIndex + 1}`);
        const amountText = parts.at(-1)?.text ?? "";
        const amount = money(amountText);
        if (amount == null) return reason(`Invalid or missing amount at page ${pageIndex + 1}, line ${pageLineIndex + 1}`);
        let skip = datePrefix.length;
        const afterDate = parts.map((part) => {
          if (!skip) return part.text;
          const text = part.text.slice(skip);
          skip -= Math.min(skip, part.text.length);
          return text;
        }).filter(Boolean);
        let middle = afterDate.slice(0, -1).join(" ").trim();
        let sourceId;
        middle = middle.replace(/\s*n°\s*(\d{9})\b/, (_all, id) => { sourceId = id; return ""; }).trim();
        const words = middle.split(/\s+/);
        const category = words.pop();
        const description = [words.join(" ") || (!sourceId ? category : "" )].filter(Boolean).join(" ");
        rows.push({ date: iso, description: description || category, amount, currency, account, ...(sourceId ? { sourceId } : {}) });
        acceptedTransactions.add(line);
        pageLastRow = rows.at(-1);
      } else if (first && !dateLike && !moneyLike) {
        if (pageLastRow) {
          pageLastRow.description = `${pageLastRow.description} ${line.text.trim()}`.trim();
          acceptedTransactions.add(line);
        }
      } else return reason(`Unrecognized table line at page ${pageIndex + 1}, line ${lineNumber}`);
    }
  }
  for (const [pageIndex, page] of pages.entries()) {
    for (const [pageLineIndex, line] of (page?.lines ?? []).entries()) {
      const first = [...(line.items ?? [])].sort((a, b) => a.x - b.x)[0]?.text ?? "";
      if (/^\d+[-/.]\d+/.test((line.text ?? first).replace(/\s/g, "")) && !/^\d{3}-\d{7}-\d{2}\b/.test(first) && !acceptedTransactions.has(line)) {
        return reason(`Unaccepted date-prefixed line at page ${pageIndex + 1}, line ${pageLineIndex + 1}`);
      }
    }
  }
  const balances = [
    { currency, asOf: new Date(`${from}T00:00:00Z`).toISOString().slice(0, 10), amount: opening.amount },
    { currency, asOf: to, amount: closing.amount },
  ];
  const prior = new Date(`${from}T00:00:00Z`);
  prior.setUTCDate(prior.getUTCDate() - 1);
  balances[0].asOf = prior.toISOString().slice(0, 10);
  const numbered = assignOccurrences(rows);
  if (looseTransactions !== rows.length) return reason("Transaction line count does not match parsed rows");
  const credits = numbered.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const debits = numbered.filter((row) => row.amount < 0).reduce((sum, row) => sum + row.amount, 0);
  if (credits !== opening.amounts[1]) return reason(`Credit total differs by ${credits - opening.amounts[1]} minor units at line ${opening.line}`);
  if (debits !== closing.amounts[1]) return reason(`Debit total differs by ${debits - closing.amounts[1]} minor units at line ${closing.line}`);
  if (opening.amount + numbered.reduce((sum, row) => sum + row.amount, 0) !== closing.amount) return reason(`Opening balance plus transactions does not equal closing balance at line ${closing.line}`);
  return { rows: numbered, coverage: { from, to }, balances };
}
