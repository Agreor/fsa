const line = (y, items) => ({ y, items, text: items.map((item) => item.text).join(" ") });
const item = (x, text) => ({ x, text });
const header = () => [
  line(700, [item(343, "Money in"), item(428, "Tax"), item(470, "Other")]),
  line(690, [40, 125, 258, 385, 537].map((x, i) => item(x,
    ["Date", "Description", "Category", "Balance", "Fees"][i]))),
  line(680, [item(343, "/out"), item(428, "withheld"), item(470, "taxes")]),
];
const section = (currency) => [
  line(720, [item(40, `Personal Account (${currency})`)]),
  line(710, [item(40, "Transaction statement")]), ...header(),
];
const row = (day, desc, category, money, balance, fee = "€0.00") => line(650, [
  item(40, `Mar ${day}, 2026`), item(125, desc), ...(category ? [item(258, category)] : []),
  item(343, money), item(385, balance), item(428, "€0.00"), item(470, "€0.00"),
  item(533, fee),
]);
const total = (money, tax = "€0.00", other = "€0.00", fees = "€0.00") =>
  line(100, [item(40, "Total"), item(343, money), item(428, tax), item(470, other),
    item(533, fees)]);
const period = () => line(740, [item(450, "Mar 1, 2026 - Mar 31, 2026")]);

// pii-ok synthetic
export const pages = [
  { lines: [period(), line(500, [item(40, "Summary")]),
    line(490, [item(40, "Interest income"), item(343, "€3.00")])] },
  { lines: [period(), line(720, [item(40, "Personal Account (AED)")]),
    line(710, [item(40, "Current account details")]),
    line(700, [item(40, "Account Number (IBAN)"), item(219, "XX00000000000000"), // pii-ok synthetic
      item(301, "Opening date"), item(509, "Jan 9, 2026")]),
    line(690, [item(40, "Interest income"), item(219, "€1.23"), item(301, "12.34 AED")])] },
  { lines: [period(), ...section("EUR"),
    line(650, [item(40, "Mar 4, 2026"), item(125, "EXAMPLE"), item(180, "SHOP"),
      item(258, "Shopping"), item(343, "-€12.34"), item(385, "€87.66"),
      item(428, "€0.00"), item(470, "€0.00"), item(533, "€0.00")]),
    line(640, [item(125, "ORDER 123")]),
    row(5, "EXAMPLE REFUND", "Shopping", "+€1,234.56", "€1,322.22"),
    row(6, "EXAMPLE CAFE", "Food", "-€2.00", "€1,320.22", "€0.50"),
    row(7, "EXAMPLE MARKET", "Food", "-€20.00", "€1,300.22"),
    row(8, "EXAMPLE STORE", "Shopping", "-€1.00", "€1,299.22"),
    row(9, "EXAMPLE BOOKS", "Shopping", "-€5.00", "€1,294.22"),
    row(10, "EXAMPLE PAY", "", "€10.00", "€1,304.22"),
    row(11, "EXAMPLE TEA", "Food", "-€4.00", "€1,300.22"),
  ] },
  { lines: [line(740, [item(450, "Mar 1, 2026"), item(500, "-"),
    item(510, "Mar 31, 2026")]), ...header(), row(12, "EXAMPLE RIDE", "Transport", "-€3.00", "€1,297.22"),
    row(13, "EXAMPLE TAXI", "Transport", "-€2.00", "€1,295.22"),
    total("€1,195.22", "€0.00", "€0.00", "€0.50"),
    ...section("USD"), total("$0.00", "$0.00", "$0.00", "$0.00"),
    line(90, [item(343, "€0.00"), item(428, "€0.00"), item(470, "€0.00"),
      item(533, "€0.00")]),
    ...section("AED"), total("0.00 AED", "0.00 AED", "0.00 AED", "0.00 AED"),
    line(80, [item(343, "€0.00"), item(428, "€0.00"), item(470, "€0.00"),
      item(533, "€0.00")])] },
];
export const expected = {
  rows: [
    [4, "EXAMPLE SHOP ORDER 123", -1234], [5, "EXAMPLE REFUND", 123456],
    [6, "EXAMPLE CAFE", -200], [7, "EXAMPLE MARKET", -2000],
    [8, "EXAMPLE STORE", -100], [9, "EXAMPLE BOOKS", -500],
    [10, "EXAMPLE PAY", 1000], [11, "EXAMPLE TEA", -400],
    [12, "EXAMPLE RIDE", -300], [13, "EXAMPLE TAXI", -200],
  ].map(([day, description, amount]) => ({ date: `2026-03-${String(day).padStart(2, "0")}`,
    description, amount, currency: "EUR", account: "r1", occurrence: 1 })),
  coverage: { from: "2026-03-01", to: "2026-03-31" },
  balances: [{ currency: "EUR", asOf: "2026-02-28", amount: 10000 },
    { currency: "EUR", asOf: "2026-03-31", amount: 129522 }],
};
