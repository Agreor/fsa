import test from "node:test";
import assert from "node:assert/strict";
import { pages, expected } from "./fixtures/s2-pages.mjs";
import { parse } from "../src/sources/s2.js";
import { validateParsed } from "../src/contracts.js";

const copy = () => structuredClone(pages);
const result = (input) => parse(input, { account: "r1" });
const reason = (input) => result(input).reason;
const edit = (fn) => { const input = copy(); fn(input); return input; };
const eurPage = (input) => input.findIndex((page) => page.lines.some((line) =>
  line.items?.[0]?.text === "Transaction statement"));

test("fixture parses and validates", () => {
  assert.deepEqual(result(copy()), expected);
  assert.deepEqual(validateParsed(expected), []);
});
test("split EUR transaction label is recognised", () => {
  const input = copy();
  const line = input[2].lines.find((l) => l.items?.[0]?.text === "Transaction statement");
  line.items = [{ x: 40, text: "Transaction" }, { x: 100, text: "statement" }];
  line.text = "Transaction statement";
  assert.deepEqual(result(input), expected);
});
test("split account and USD transaction labels are recognised", () => {
  const input = copy();
  const accountLine = input[3].lines.find((l) => l.items?.[0]?.text === "Personal Account (USD)");
  accountLine.items = [{ x: 40, text: "Personal Account" }, { x: 180, text: "(USD)" }];
  const accountIndex = input[3].lines.indexOf(accountLine);
  const sectionLine = input[3].lines[accountIndex + 1];
  sectionLine.items = [{ x: 40, text: "Transaction" }, { x: 100, text: "statement" }];
  assert.deepEqual(result(input), expected);
});
test("row-shaped lines outside regions reject", () => {
  const input = copy();
  input[0].lines.push({ y: 400, text: "Mar 14, 2026 EXAMPLE SHOP", items: [
    { x: 40, text: "Mar 14, 2026" }, { x: 125, text: "EXAMPLE SHOP" },
    { x: 343, text: "€1.00" }, { x: 385, text: "€1.00" }, { x: 428, text: "€0.00" },
    { x: 470, text: "€0.00" }, { x: 533, text: "€0.00" },
  ] });
  assert.match(reason(input), /unrecognised.*page 1, line/i);
});
test("shape-independent safeguard rejects transaction candidates", () => {
  const samples = [
    [{ x: 40, text: "Mar 14, 2026" }, { x: 125, text: "LOST PAYMENT" },
      ...["-€10.00", "€90.00", "€0.00", "€0.00", "€0.00"]
        .map((value, i) => ({ x: 270 + i * 10, text: value }))],
    [{ x: 40, text: "Mar 14, 2026" }, { x: 125, text: "LOST PAYMENT" },
      ...["-€10.00", "€90.00", "€0.00", "€0.00"]
        .map((value, i) => ({ x: 343 + i * 45, text: value }))],
    [{ x: 40, text: "Mar 14," }, { x: 90, text: "2026" },
      { x: 125, text: "LOST PAYMENT" }, { x: 343, text: "-€10.00" }],
    [{ x: 40, text: "Mar 14, 2026" }, { x: 125, text: "LOST PAYMENT" },
      ...["-€10.00", "€90.00", "€0.00", "€0.00"]
        .map((value, i) => ({ x: 343 + i * 45, text: value }))],
  ];
  for (const [index, items] of samples.entries()) {
    const input = copy();
    input[index === 3 ? 2 : 0].lines.push({ y: index === 3 ? 730 : 400,
      text: items.map((item) => item.text).join(" "), items });
    assert.match(reason(input), /unrecognised.*page \d+, line/i);
  }
});
test("missing period rejects", () => {
  const input = edit((p) => p.forEach((page) => { page.lines = page.lines.filter((l) => l.y <= 725); }));
  assert.match(reason(input), /period/i);
});
test("mixed page periods reject", () => {
  const input = edit((p) => { p[0].lines.find((l) => l.y > 725).items[0].text =
    "Mar 1, 2025 - Mar 31, 2025"; });
  assert.match(reason(input), /period/i);
});
test("rows outside period reject with their location", () => {
  const input = edit((p) => p.forEach((page) => {
    page.lines.find((l) => l.y > 725).items[0].text = "Mar 1, 2025 - Mar 31, 2025";
  }));
  const parsed = result(input);
  assert.match(parsed.reason, /period/i);
  assert.match(parsed.reason, /page \d+, line \d+/i);
});
test("row before period rejects, boundary dates are accepted", () => {
  const input = copy();
  const first = input[2].lines.find((l) => l.items?.[0]?.text === "Mar 4, 2026");
  first.items[0].text = "Feb 28, 2026";
  assert.match(reason(input), /period/i);
  const boundary = copy();
  const rows = boundary[2].lines.filter((l) => l.items?.[0]?.x === 40 &&
    /^Mar \d+, 2026$/.test(l.items[0].text));
  rows[0].items[0].text = "Mar 1, 2026";
  const last = boundary[3].lines.find((l) => l.items?.[0]?.text === "Mar 13, 2026");
  last.items[0].text = "Mar 31, 2026";
  const parsed = result(boundary);
  assert.ok(!parsed.reason, parsed.reason);
});
test("missing Transaction statement rejects", () => {
  const input = edit((p) => p.forEach((page) => { page.lines = page.lines.filter((l) =>
    l.items?.[0]?.text !== "Transaction statement"); }));
  assert.match(reason(input), /Transaction statement/i);
});
test("account details are ignored", () => assert.deepEqual(result(copy()), expected));
test("deleting a row fires Total", () => {
  const input = edit((p) => { p[3].lines = p[3].lines.filter((l) =>
    l.items?.[0]?.text !== "Mar 13, 2026"); });
  assert.match(reason(input), /Total/i);
});
test("altering an amount fires Total", () => {
  const input = edit((p) => { p[2].lines.find((l) => l.items?.[0]?.text === "Mar 4, 2026")
    .items.find((item) => item.x === 343).text = "-€13.34"; });
  assert.match(reason(input), /Total/i);
});
test("altering a balance fires balance", () => {
  const input = edit((p) => { p[2].lines.find((l) => l.items?.[0]?.text === "Mar 5, 2026")
    .items[4].text = "€1,323.22"; });
  assert.match(reason(input), /balance/i);
});
test("nonzero USD Total rejects", () => {
  const input = edit((p) => { const page = p[3];
    page.lines.find((l) => l.items?.[0]?.text === "Total" &&
      l.items[1].text.startsWith("$")).items[1].text = "$1.00"; });
  assert.match(reason(input), /not supported/i);
});
test("USD offsetting rows reject despite a zero Total", () => {
  const input = copy();
  const page = input[3];
  const total = page.lines.findIndex((l) => l.items?.[0]?.text === "Total" &&
    l.items[1].text.startsWith("$"));
  const row = (date, money, balance) => ({ y: 650, text: "", items: [
    { x: 40, text: date }, { x: 125, text: "EXAMPLE SHOP" }, { x: 343, text: money },
    { x: 385, text: balance }, { x: 428, text: "$0.00" }, { x: 470, text: "$0.00" },
    { x: 533, text: "$0.00" },
  ] });
  page.lines.splice(total, 0, row("Mar 14, 2026", "$100.00", "$100.00"),
    row("Mar 15, 2026", "-$100.00", "$0.00"));
  assert.match(reason(input), /not supported/i);
});
test("one USD row rejects with a nonzero Total", () => {
  const input = copy();
  const page = input[3];
  const total = page.lines.findIndex((l) => l.items?.[0]?.text === "Total" &&
    l.items[1].text.startsWith("$"));
  page.lines.splice(total, 0, { y: 650, text: "", items: [
    { x: 40, text: "Mar 14, 2026" }, { x: 125, text: "EXAMPLE SHOP" },
    { x: 343, text: "$100.00" }, { x: 385, text: "$100.00" },
    { x: 428, text: "$0.00" }, { x: 470, text: "$0.00" }, { x: 533, text: "$0.00" },
  ] });
  page.lines[total + 1].items[1].text = "$100.00";
  assert.match(reason(input), /not supported/i);
});
test("one USD row rejects with a zero Total", () => {
  const input = copy();
  const page = input[3];
  const total = page.lines.findIndex((l) => l.items?.[0]?.text === "Total" &&
    l.items[1].text.startsWith("$"));
  page.lines.splice(total, 0, { y: 650, text: "", items: [
    { x: 40, text: "Mar 14, 2026" }, { x: 125, text: "EXAMPLE SHOP" },
    { x: 343, text: "$100.00" }, { x: 385, text: "$100.00" },
    { x: 428, text: "$0.00" }, { x: 470, text: "$0.00" }, { x: 533, text: "$0.00" },
  ] });
  assert.match(reason(input), /not supported/i);
});
test("non-EUR totals accept symbol styles and reject missing numbers", () => {
  const input = copy();
  const total = input[3].lines.find((l) => l.items?.[0]?.text === "Total" &&
    l.items[1].text.startsWith("$"));
  ["A$0.00", "HK$0.00", "$0.00", "0.00 AED", "CHF 0.00", "-0.00 THB", "Kč0.00"]
    .forEach((value) => {
      total.items.slice(1).forEach((item) => { item.text = value; });
      assert.deepEqual(result(input), expected);
    });
  total.items[1].text = "A$1.00";
  assert.match(result(input).reason, /not supported/i);
  total.items[1].text = "none";
  assert.match(result(input).reason, /Total/i);
});
for (const [style, values] of Object.entries({
  "dollar zero": ["$0.00"], "Australian dollar zero": ["A$0.00"],
  "pound zero": ["£0.00"], "AED zero": ["0.00 AED"],
})) {
  test(`non-EUR Total accepts ${style}`, () => {
    const input = copy();
    const total = input[3].lines.find((l) => l.items?.[0]?.text === "Total" &&
      l.items[1].text.startsWith("$"));
    total.items.slice(1).forEach((item) => { item.text = values[0]; });
    assert.deepEqual(result(input), expected);
  });
}
test("non-EUR Total accepts whole-number yen zero", () => {
  const input = copy();
  const total = input[3].lines.find((l) => l.items?.[0]?.text === "Total" &&
    l.items[1].text.startsWith("$"));
  total.items.slice(1).forEach((item) => { item.text = "¥0"; });
  assert.deepEqual(result(input), expected);
});
test("negative euro zero Total is accepted", () => {
  const input = copy();
  input.slice(2, 4).forEach((page) => { page.lines = page.lines.filter((line) => {
    const first = line.items?.[0];
    return line.y > 725 || (!/^Mar \d/.test(first?.text ?? "") &&
      !(line.items?.length === 1 && first.x >= 115 && first.x <= 140));
  }); });
  const total = input[3].lines.find((l) => l.items?.[0]?.text === "Total" &&
    l.items[1].text.startsWith("€"));
  total.items[1].text = "-€0.00";
  total.items.slice(2).forEach((item) => { item.text = "€0.00"; });
  assert.deepEqual(result(input), { rows: [], coverage: expected.coverage, balances: [] });
});
for (const [currency, amount] of [["yen", "¥1"], ["AED", "1.00 AED"]]) {
  test(`non-EUR ${currency} nonzero Total rejects`, () => {
    const input = copy();
    const total = input[3].lines.find((l) => l.items?.[0]?.text === "Total" &&
      l.items[1].text.startsWith("$"));
    total.items.slice(1).forEach((item) => { item.text = amount; });
    assert.match(result(input).reason, /not supported/i);
  });
}
test("AED zero Total with euro equivalent is accepted", () => assert.deepEqual(result(copy()), expected));
for (const description of ["Mar 14 order total €10.00", "Mar 14, 2026 refund €10.00"]) {
  test(`wrapped candidate ${description} is accepted`, () => {
    const input = copy();
    const line = input[2].lines.find((l) => l.items?.[0]?.text === "ORDER 123");
    line.items[0].text = description;
    line.text = description;
    const parsed = result(input);
    assert.ok(!parsed.reason, parsed.reason);
    assert.ok(parsed.rows[0].description.endsWith(description));
  });
}
test("summary single-item candidate still rejects", () => {
  const input = copy();
  input[0].lines.push({ y: 400, text: "Mar 14 order total €10.00",
    items: [{ x: 125, text: "Mar 14 order total €10.00" }] });
  assert.match(reason(input), /Unrecognised/i);
});
test("x 145 candidate after a row still rejects", () => {
  const input = copy();
  input[2].lines.splice(7, 0, { y: 500, text: "Mar 14 order total €10.00",
    items: [{ x: 145, text: "Mar 14 order total €10.00" }] });
  assert.match(reason(input), /page \d+, line \d+/i);
});
test("multi-item continuation still rejects", () => {
  const input = copy();
  const line = input[2].lines.find((l) => l.items?.[0]?.text === "ORDER 123");
  line.items.push({ x: 330, text: "€1.00" });
  line.text += " €1.00";
  assert.match(reason(input), /page \d+, line \d+/i);
});
test("candidate before the first row still rejects", () => {
  const input = copy();
  input[2].lines.splice(6, 0, { y: 600, text: "Mar 14 order total €10.00",
    items: [{ x: 125, text: "Mar 14 order total €10.00" }] });
  assert.match(reason(input), /page \d+, line \d+/i);
});
test("wrapped text joins the preceding row", () => {
  assert.equal(result(copy()).rows[0].description, "EXAMPLE SHOP ORDER 123");
});
test("wrapped text without a preceding row rejects", () => {
  const input = edit((p) => { p[2].lines.splice(8, 0, p[2].lines.splice(6, 1)[0]); });
  assert.match(reason(input), /wrapped|line/i);
});
test("unknown month rejects", () => {
  const input = edit((p) => { p[2].lines.find((l) => l.items?.[0]?.text === "Mar 4, 2026")
    .items[0].text = "Foo 4, 2026"; });
  assert.match(reason(input), /page|date/i);
});
test("30 February rejects", () => {
  const input = edit((p) => { p[2].lines.find((l) => l.items?.[0]?.text === "Mar 4, 2026")
    .items[0].text = "Feb 30, 2026"; });
  assert.match(reason(input), /date/i);
});
test("29 February 2028 accepted", () => {
  const input = edit((p) => {
    p.forEach((page) => { page.lines.find((line) => line.y > 725).items[0].text =
      "Feb 1, 2026 - Mar 31, 2028"; });
    p[2].lines.find((l) => l.items?.[0]?.text === "Mar 4, 2026").items[0].text = "Feb 29, 2028";
  });
  const parsed = result(input);
  assert.equal(parsed.rows[0].date, "2028-02-29");
});
test("29 February 2027 rejects", () => {
  const input = edit((p) => { p[2].lines.find((l) => l.items?.[0]?.text === "Mar 4, 2026")
    .items[0].text = "Feb 29, 2027"; });
  assert.match(reason(input), /date|Total|balance/i);
});
test("split date rejects", () => {
  const input = edit((p) => { const items = p[2].lines.find((l) =>
    l.items?.[0]?.text === "Mar 4, 2026").items; items[0].text = "Mar 4,";
    items.splice(1, 0, { x: 80, text: "2026" }); });
  assert.match(reason(input), /page|date/i);
});
test("wrong currency symbol in EUR row rejects", () => {
  const input = edit((p) => { p[2].lines.find((l) => l.items?.[0]?.text === "Mar 4, 2026")
    .items.find((item) => item.x === 343).text = "-$12.34"; });
  assert.match(reason(input), /page|amount/i);
});
test("open region rejects", () => {
  const input = edit((p) => { p[3].lines = p[3].lines.slice(0, 9); });
  assert.match(reason(input), /Total/i);
});
test("no pages rejects", () => assert.match(reason([]), /input|page|line/i));
test("empty EUR region returns no rows", () => {
  const input = edit((p) => {
    p.forEach((page) => { page.lines = page.lines.filter((l) => {
      const first = l.items?.[0];
      return !(first?.x === 40 && /^Mar \d/.test(first.text)) &&
        !(l.items?.length === 1 && first?.x >= 115 && first?.x <= 140);
    }); });
    p[3].lines.find((l) => l.items?.[0]?.text === "Total" &&
      l.items[1].text.startsWith("€")).items.splice(1, 4, ...["€0.00", "€0.00", "€0.00", "€0.00"]
      .map((text, i) => ({ x: [343, 428, 470, 533][i], text })));
  });
  const parsed = result(input);
  assert.deepEqual(parsed.rows, []);
  assert.deepEqual(parsed.coverage, expected.coverage);
});
test("identical rows receive occurrences one and two", () => {
  const input = copy();
  const formatEuro = (minor) => {
    const sign = minor < 0 ? "-" : "";
    const absolute = Math.abs(minor);
    const whole = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}€${whole}.${String(absolute % 100).padStart(2, "0")}`;
  };
  const page = input[2];
  const originalIndex = page.lines.findIndex((line) => line.items?.[0]?.text === "Mar 4, 2026");
  const original = page.lines[originalIndex];
  const wrapped = structuredClone(page.lines[originalIndex + 1]);
  const amount = -1234;
  const duplicate = structuredClone(original);
  const euroMinor = (text) => {
    const match = /^(-)?€([\d,]+)\.(\d\d)$/.exec(text);
    return (match[1] ? -1 : 1) *
      (Number(match[2].replace(/,/g, "")) * 100 + Number(match[3]));
  };
  const shift = (line) => {
    const balance = line.items?.find((item) => item.x === 385);
    if (balance) balance.text = formatEuro(euroMinor(balance.text) + amount);
  };
  shift(duplicate);
  for (const later of input.slice(2)) for (const line of later.lines) {
    const day = Number(/^Mar (\d+),/.exec(line.items?.[0]?.text ?? "")?.[1]);
    if (day > 4) shift(line);
  }
  page.lines.splice(originalIndex + 2, 0, duplicate, wrapped);
  const totalLine = input[3].lines.find((line) => line.items?.[0]?.text === "Total");
  totalLine.items.find((item) => item.x === 343).text = formatEuro(119522 + amount);
  const parsed = result(input);
  const duplicates = parsed.rows.filter((row) => row.date === "2026-03-04");
  assert.equal(duplicates.length, 2);
  assert.equal(duplicates[0].description, duplicates[1].description);
  assert.equal(duplicates[0].amount, duplicates[1].amount);
  assert.deepEqual(duplicates.map((row) => row.occurrence), [1, 2]);
});
