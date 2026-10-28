import test from "node:test";
import assert from "node:assert/strict";
import { pages, expected } from "./fixtures/s5-pages.mjs";
import { parse } from "../src/sources/s5.js";
import { validateParsed } from "../src/contracts.js";

const copy = () => structuredClone(pages);
const textLine = (pages, page, line, text) => {
  pages[page].lines[line].text = text;
  pages[page].lines[line].items = text.split(" ").map((part, index) => ({ x: index * 100, text: part }));
};
const reason = (input) => {
  const result = parse(input, { account: "c1" });
  assert.equal(typeof result.reason, "string");
  return result.reason;
};
const replaceLine = (input, oldText, newText) => {
  const line = input.flatMap((page) => page.lines).find((row) => row.text === oldText);
  assert.ok(line, `missing fixture line: ${oldText}`);
  line.text = newText;
  line.items = newText.split(" ").map((text, index) => ({ x: index * 100, text }));
};

test("parses the synthetic s5 statement", () => {
  const result = parse(copy(), { account: "c1" });
  assert.deepEqual(result, expected);
  assert.deepEqual(validateParsed(result), []);
});

test("rejects when a transaction is removed or changed without reconciliation", () => {
  const deleted = copy();
  deleted[0].lines.splice(4, 1);
  assert.match(reason(deleted), /reconcil/i);
  const changed = copy();
  changed[0].lines[4].items.at(-1).text = "101.00";
  changed[0].lines[4].text = changed[0].lines[4].items.map((item) => item.text).join(" ");
  assert.match(reason(changed), /reconcil/i);
});

test("rejects missing pages and missing lines", () => {
  assert.match(reason([]), /input/i);
  assert.match(reason([{ lines: [] }]), /input/i);
});

test("requires the full header", () => {
  const input = copy();
  for (const page of input) {
    for (const line of page.lines) {
      if (line.text.startsWith("POST DATE")) {
        replaceLine(input, line.text, "POST DATE DESCRIPTION AMOUNT (THB)");
      }
    }
  }
  assert.match(reason(input), /header/i);
});

test("requires a previous balance row", () => {
  const input = copy();
  replaceLine(input, "PREVIOUS BALANCE 1,000.00", "PRIOR BALANCE 1,000.00");
  assert.match(reason(input), /PREVIOUS BALANCE/i);
});

test("requires a total row", () => {
  const input = copy();
  replaceLine(input, "TOTAL 1,150.00 200.00", "SUMMARY 1,150.00 200.00");
  assert.match(reason(input), /TOTAL/i);
});

test("minimum payment is not used as the balance", () => {
  const baseline = parse(copy(), { account: "c1" });
  const changed = copy();
  changed[0].lines[9].items[2].text = "300.00";
  changed[0].lines[9].text = changed[0].lines[9].items.map((item) => item.text).join(" ");
  assert.deepEqual(parse(changed, { account: "c1" }), baseline);
});

test("changing the TOTAL balance makes reconciliation fail", () => {
  const input = copy();
  input[0].lines[9].items[1].text = "1,126.00";
  input[0].lines[9].text = input[0].lines[9].items.map((item) => item.text).join(" ");
  assert.match(reason(input), /reconcil/i);
});

for (const count of [2, 4]) {
  test(`rejects TOTAL rows with ${count} items`, () => {
    const input = copy();
    const items = count === 2 ? ["TOTAL", "1,150.00"]
      : ["TOTAL", "1,150.00", "200.00", "1.00"];
    input[0].lines[9] = lineForTest(items);
    assert.match(reason(input), /page 1, line 10/i);
  });
}

test("keeps an extra amount item in a five-item transaction description", () => {
  const result = parse(copy(), { account: "c1" });
  assert.deepEqual(result.rows.at(-1), expected.rows.at(-1));
});

const lineForTest = (items) => ({
  text: items.join(" "), items: items.map((text, index) => ({ x: index * 100, text })),
});

test("requires a statement date", () => {
  const input = copy();
  replaceLine(input, "Statement date 05 JAN 2025", "Statement date unavailable");
  assert.match(reason(input), /statement date/i);
});

test("rejects transaction rows without an amount", () => {
  const input = copy();
  textLine(input, 0, 5, "20 DEC 15 DEC EXAMPLE SHOP BANGKOK");
  assert.match(reason(input), /page 1, line 6/i);
});

test("rejects transaction rows with a split date item", () => {
  const input = copy();
  const line = input[0].lines[5];
  line.items[0].text = "20";
  line.items[1].text = "DEC";
  line.text = line.items.map((item) => item.text).join(" ");
  assert.match(reason(input), /page 1, line 6/i);
});

test("rejects an impossible transaction date", () => {
  const input = copy();
  input[0].lines[5].items[1].text = "31 FEB";
  input[0].lines[5].text = input[0].lines[5].items.map((item) => item.text).join(" ");
  assert.match(reason(input), /date/i);
});

test("rejects an unknown transaction month", () => {
  const input = copy();
  input[0].lines[5].items[1].text = "15 XYZ";
  input[0].lines[5].text = input[0].lines[5].items.map((item) => item.text).join(" ");
  assert.match(reason(input), /date|malformed/i);
});

test("uses transaction dates and rolls December into the prior year", () => {
  const result = parse(copy(), { account: "c1" });
  assert.equal(result.rows[0].date, "2024-12-16");
  assert.equal(result.coverage.from, "2024-12-14");
});

test("parses 0.00 as integer minor units", () => {
  const input = copy();
  input[0].lines[5].items.at(-1).text = "0.00";
  input[0].lines[5].text = input[0].lines[5].items.map((item) => item.text).join(" ");
  input[0].lines[9].items[1].text = "1,050.00";
  input[0].lines[9].text = input[0].lines[9].items.map((item) => item.text).join(" ");
  const result = parse(input, { account: "c1" });
  assert.equal(result.rows[1].amount, 0);
});

test("parses large comma-grouped amounts without floating point", () => {
  const input = copy();
  input[0].lines[3].items[1].text = "2,000,000.00";
  input[0].lines[3].text = input[0].lines[3].items.map((item) => item.text).join(" ");
  input[0].lines[5].items.at(-1).text = "1,234,567.89";
  input[0].lines[5].text = input[0].lines[5].items.map((item) => item.text).join(" ");
  input[0].lines[6].items.at(-1).text = "100.00";
  input[0].lines[6].text = input[0].lines[6].items.map((item) => item.text).join(" ");
  input[0].lines[7].items.at(-1).text = "50.00 CR";
  input[0].lines[7].text = input[0].lines[7].items.map((item) => item.text).join(" ");
  input[0].lines[9].items[1].text = "3,234,617.89";
  input[0].lines[9].text = input[0].lines[9].items.map((item) => item.text).join(" ");
  const result = parse(input, { account: "c1" });
  assert.equal(result.rows[1].amount, -(123456 * 1000 + 789));
});

test("accepts February 29 in a leap year", () => {
  const input = copy();
  replaceLine(input, "Statement date 05 JAN 2025", "Statement date 05 MAR 2024");
  input[0].lines[5].items[1].text = "29 FEB";
  input[0].lines[5].text = input[0].lines[5].items.map((item) => item.text).join(" ");
  const result = parse(input, { account: "c1" });
  assert.equal(result.rows[1].date, "2024-02-29");
});

test("accepts the first and last day of a month", () => {
  const input = copy();
  input[0].lines[5].items[1].text = "01 DEC";
  input[0].lines[5].text = input[0].lines[5].items.map((item) => item.text).join(" ");
  input[0].lines[6].items[1].text = "31 DEC";
  input[0].lines[6].text = input[0].lines[6].items.map((item) => item.text).join(" ");
  const result = parse(input, { account: "c1" });
  assert.deepEqual(result.rows.slice(1, 3).map((row) => row.date), ["2024-12-01", "2024-12-31"]);
});

test("assigns separate occurrences to repeated rows", () => {
  const result = parse(copy(), { account: "c1" });
  assert.deepEqual(result.rows.slice(1, 3).map((row) => row.occurrence), [1, 2]);
});

test("rejects a statement without transactions", () => {
  const input = copy();
  input[0].lines = input[0].lines.filter((line) => !/^\d{2} [A-Z]{3}/.test(line.text));
  assert.match(reason(input), /No transaction rows/);
});

test("rejects a transaction amount that breaks reconciliation", () => {
  const input = copy();
  input[0].lines[5].items.at(-1).text = "101.00";
  input[0].lines[5].text = input[0].lines[5].items.map((item) => item.text).join(" ");
  assert.match(reason(input), /reconcil/i);
});
