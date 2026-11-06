import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/sources/s7.js";

// Made-up statement in the real layout: dd/mm/yy, particulars, one amount column, the balance, the channel.
const line = (y, ...items) => ({ y, items: items.map(([x, text]) => ({ x, text })), text: items.map(([, text]) => text).join(" ") });
const head = [
  line(796, [439, "STATEMENT OF SAVING ACCOUNT"]),
  line(721, [308, "Currency"], [450, "THB"]),
  line(703, [308, "Statement Period"], [450, "01/09/2026 - 30/09/2026"]),
  line(644, [29, "Date"], [80, "Particulars"], [244, "Withdrawal"], [327, "Deposit"], [397, "Balance"], [498, "Via"]),
];
const out = (y, date, what, amount, balance) => line(y, [25, date], [57, what], [263, amount], [392, balance], [433, "App"]);
const inn = (y, date, what, amount, balance) => line(y, [25, date], [57, what], [329, amount], [392, balance], [433, "Auto"]);
const footer = (debits, debitSum, credits, creditSum) => [
  line(549, [20, "Total No. of Debits"], [275, String(debits)], [297, "Total Debit Amount"], [538, debitSum]),
  line(533, [20, "Total No. of Credits"], [279, String(credits)], [297, "Total Credit Amount"], [538, creditSum]),
];
const open = line(627, [25, "01/09/26"], [57, "B/F"], [392, "1,000.00"]);
const rows = [
  out(612, "02/09/26", "TRANSFER", "100.00", "900.00"),
  inn(597, "03/09/26", "SALARY", "5,000.00", "5,900.00"),
  out(582, "03/09/26", "PMT. PROMPTPAY", "50.25", "5,849.75"),
  out(567, "03/09/26", "PMT. PROMPTPAY", "50.25", "5,799.50"),
];
const good = [{ lines: [...head, open, ...rows.slice(0, 2)] }, { lines: [...head, ...rows.slice(2), ...footer(3, "200.50", 1, "5,000.00")] }];

test("reads a savings statement over two pages, with signs from the running balance", () => {
  const out = parse(good, { account: "a" });
  assert.deepEqual(out.rows.map((r) => [r.date, r.description, r.amount, r.occurrence]),
    [["2026-09-02", "TRANSFER", -10000, 1], ["2026-09-03", "SALARY", 500000, 1], ["2026-09-03", "PMT. PROMPTPAY", -5025, 1], ["2026-09-03", "PMT. PROMPTPAY", -5025, 2]]);
  assert.deepEqual(out.coverage, { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(out.balances.map((b) => [b.asOf, b.amount]), [["2026-08-31", 100000], ["2026-09-30", 579950]]);
});

test("rejects a statement whose totals, balance or columns do not add up", () => {
  const wrongTotal = [good[0], { lines: [...head, ...rows.slice(2), ...footer(3, "200.51", 1, "5,000.00")] }];
  assert.match(parse(wrongTotal, { account: "a" }).reason, /Debit total/);
  const badBalance = [{ lines: [...head, open, out(612, "02/09/26", "TRANSFER", "100.00", "901.00"), ...footer(1, "100.00", 0, "0.00")] }];
  assert.match(parse(badBalance, { account: "a" }).reason, /running balance/);
  const wrongColumn = [{ lines: [...head, open, inn(612, "02/09/26", "TRANSFER", "100.00", "900.00"), ...footer(1, "100.00", 0, "0.00")] }];
  assert.match(parse(wrongColumn, { account: "a" }).reason, /wrong column/);
  assert.match(parse([{ lines: [line(1, [1, "something else"])] }], { account: "a" }).reason, /marker/);
});
