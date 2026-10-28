import { assignOccurrences } from "../contracts.js";

const reason = (message) => ({ reason: message });
const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const ordered = (line) => [...(line?.items ?? [])].sort((a, b) => a.x - b.x);
const text = (line) => ordered(line).map((item) => item.text).join(" ");
const candidate = (line) => {
  const value = text(line);
  return /^\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? ?\d{1,2}\b/i
    .test(value) && /(^|\s)[-+]?[$€£¥]\s?\d|\d[\d,]*\.\d\d(\s|$)/.test(value);
};
const where = (page, line) => `page ${page + 1}, line ${line + 1}`;

function dateValue(value) {
  const match = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(value);
  const month = months.indexOf(match?.[1]) + 1;
  if (!month) return null;
  const year = Number(match[3]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}
function euro(value) {
  const match = /^(-|\+)?€(\d{1,3}(?:,\d{3})*)\.(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const amount = Number(match[2].replaceAll(",", "")) * 100 + Number(match[3]);
  return match[1] === "-" ? -amount : amount;
}
function totalAmount(value) {
  const match = /-?\d[\d,]*(?:\.\d+)?/.exec(value ?? "");
  if (!match) return null;
  return [...match[0]].some((char) => char >= "1" && char <= "9") ? 1 : 0;
}
function headerAt(lines, index) {
  const block = lines.slice(index, index + 3).map((line) => ordered(line).map((item) => item.text));
  return block.length === 3 && block[0].join("|") === "Money in|Tax|Other"
    && block[1].join("|") === "Date|Description|Category|Balance|Fees"
    && block[2].join("|") === "/out|withheld|taxes";
}
function isWrapped(line) {
  const items = ordered(line);
  return items.length === 1 && items[0].x >= 115 && items[0].x <= 140;
}
function parseRow(line, page, index, account) {
  const items = ordered(line);
  const date = dateValue(items[0]?.text);
  const dateLike = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(items[0]?.text ?? "");
  if (!dateLike) return null;
  if (!date || items.length < 7 || items[1].x < 115 || items[1].x >= 250) {
    return { reason: `Invalid date or row at ${where(page, index)}` };
  }
  const amounts = items.filter((item) => item.x >= 330).sort((a, b) => a.x - b.x);
  if (amounts.length !== 5 || amounts.some((item) => euro(item.text) == null)) {
    return { reason: `Invalid amount at ${where(page, index)}` };
  }
  const description = items.filter((item) => item.x >= 115 && item.x < 250)
    .map((item) => item.text).join(" ");
  return { date, description, amount: euro(amounts[0].text),
    balance: euro(amounts[1].text), currency: "EUR", account };
}

export function parse(pages, { account } = {}) {
  if (!Array.isArray(pages) || !pages.length || !pages.some((page) => page?.lines?.length)) {
    return reason("Missing input pages or lines");
  }
  const entries = pages.flatMap((page, pageIndex) => (page?.lines ?? []).map((line, lineIndex) => ({
    line, pageIndex, lineIndex, items: ordered(line),
  })));
  let coverage;
  const periods = pages.map((page) => (page?.lines ?? []).filter((line) => line.y > 725)
    .flatMap((line) => [...text(line).matchAll(
      /[A-Z][a-z]{2} \d{1,2}, \d{4} - [A-Z][a-z]{2} \d{1,2}, \d{4}/g)]
      .map((match) => match[0])));
  if (periods.some((pagePeriods) => pagePeriods.length !== 1)) {
    return reason("Missing or ambiguous statement period");
  }
  const periodValues = periods.map((pagePeriods) => pagePeriods[0]);
  for (const period of periodValues) {
    const [from, to] = period.split(" - ").map(dateValue);
    if (!from || !to || from > to) return reason("Missing or invalid statement period");
    coverage ??= { from, to };
  }
  if (periodValues.some((period) => period !== periodValues[0])) {
    return reason("Statement period differs between pages");
  }
  const regions = [];
  let currency;
  for (const entry of entries) {
    const accountText = text(entry.line).trim();
    const accountMatch = /^Personal Account \(([A-Z]{3})\)$/.exec(accountText);
    if (accountMatch) currency = accountMatch[1];
    if (text(entry.line).trim() === "Transaction statement") {
      regions.push({ currency, start: entries.indexOf(entry) + 1, rows: [] });
    }
  }
  if (!regions.length) return reason("Missing Transaction statement region");
  const rows = [];
  const balances = [];
  const accepted = new Set();
  const sourceLines = entries.map((entry) => entry.line);
  for (const region of regions) {
    let index = region.start;
    while (index < entries.length && !headerAt(sourceLines, index)) index++;
    if (index >= entries.length) return reason("Missing header or Total after Transaction statement");
    index += 3;
    let previous;
    let sums = [0, 0, 0, 0];
    let first;
    let last;
    let foundTotal = false;
    while (index < entries.length) {
      const entry = entries[index];
      if (entry.line.y > 725) { index++; continue; }
      const items = entry.items;
      if (headerAt(sourceLines, index)) { index += 3; continue; }
      if (items[0]?.text === "Total") {
        const values = items.slice(1).map((item) => region.currency === "EUR"
          ? euro(item.text) : totalAmount(item.text));
        if (values.length !== 4 || values.some((value) => value == null)) {
          return reason(`Invalid Total at ${where(entry.pageIndex, entry.lineIndex)}`);
        }
        if (region.currency !== "EUR") {
          if (values.some((value) => value !== 0)) return reason("Non-zero currency region not supported");
        } else if (values.some((value, i) => value !== sums[i])) {
          return reason("Total does not match transaction sums");
        }
        foundTotal = true;
        index++;
        break;
      }
      if (region.currency !== "EUR") {
        return reason(`Transaction rows in ${region.currency} are not supported at ${where(entry.pageIndex,
          entry.lineIndex)}`);
      }
      const parsed = parseRow(entry.line, entry.pageIndex, entry.lineIndex, account);
      if (parsed?.reason) return reason(parsed.reason);
      if (parsed) {
        if (parsed.date < coverage.from || parsed.date > coverage.to) {
          return reason(`Row date outside statement period at ${where(entry.pageIndex,
            entry.lineIndex)}`);
        }
        const amounts = entry.items.filter((item) => item.x >= 330).sort((a, b) => a.x - b.x);
        const rest = amounts.slice(2).map((item) => euro(item.text));
        sums[0] += parsed.amount;
        rest.forEach((value, i) => { sums[i + 1] += value; });
        if (previous && parsed.balance - previous.balance !== parsed.amount) {
          return reason(`Invalid balance chain at ${where(entry.pageIndex, entry.lineIndex)}`);
        }
        first ??= parsed;
        last = parsed;
        previous = parsed;
        accepted.add(entry);
        parsed.fee = rest[2];
        rows.push(parsed);
      } else if (isWrapped(entry.line) && last) {
        last.description = `${last.description} ${entry.items[0].text}`;
        accepted.add(entry);
      } else if (isWrapped(entry.line)) {
        return reason(`Wrapped line without row at ${where(entry.pageIndex, entry.lineIndex)}`);
      }
      else if (entries.slice(index + 1).some((next) => next.items[0]?.text === "Total")) {
        return reason(`Invalid table line at ${where(entry.pageIndex, entry.lineIndex)}`);
      } else break;
      index++;
    }
    if (!foundTotal) return reason("Missing Total row");
    if (region.currency === "EUR" && first) {
      const prior = new Date(`${coverage.from}T00:00:00Z`);
      prior.setUTCDate(prior.getUTCDate() - 1);
      balances.push({ currency: "EUR", asOf: prior.toISOString().slice(0, 10),
        amount: first.balance - first.amount });
      balances.push({ currency: "EUR", asOf: coverage.to, amount: last.balance });
    }
  }
  for (const entry of entries) {
    if (candidate(entry.line) && !accepted.has(entry)) {
      return reason(`Unrecognised row at ${where(entry.pageIndex, entry.lineIndex)}`);
    }
  }
  const cleaned = rows.map(({ fee, balance, ...row }) => row);
  return { rows: assignOccurrences(cleaned), coverage, balances };
}
