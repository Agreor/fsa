const line = (y, ...items) => ({
  text: items.join(" "),
  y,
  items: items.map((text, index) => ({ x: index * 100, text })),
});

export const pages = [
  { lines: [
    line(900, "1111 11XX XXXX 1111"), // pii-ok synthetic
    line(850, "Statement date", "05 JAN 2025"),
    line(800, "POST DATE", "TRANS DATE", "DESCRIPTION", "AMOUNT (THB)"),
    line(750, "PREVIOUS BALANCE", "1,000.00"),
    line(700, "21 DEC", "16 DEC", "REFUND SAMPLE", "25.00 CR"),
    line(650, "20 DEC", "15 DEC", "EXAMPLE SHOP BANGKOK", "100.00"),
    line(600, "20 DEC", "15 DEC", "EXAMPLE SHOP BANGKOK", "100.00"),
    line(550, "22 DEC", "17 DEC", "PAYMENT RECEIVED", "50.00 CR"),
    line(525, "19 DEC", "14 DEC", "EXTRA AMOUNT", "40.00", "25.00"),
    line(500, "TOTAL", "1,150.00", "200.00"),
  ] },
  { lines: [
    line(900, "Page 1/2"),
    line(850, "POST DATE", "TRANS DATE", "DESCRIPTION", "AMOUNT (THB)"),
    line(800, "¤ undecodable symbol"),
    line(750, "Info: sample statement"),
  ] },
];

export const expected = {
  rows: [
    {
      date: "2024-12-16", description: "REFUND SAMPLE", amount: 2500,
      currency: "THB", account: "c1", occurrence: 1,
    },
    {
      date: "2024-12-15", description: "EXAMPLE SHOP BANGKOK", amount: -10000,
      currency: "THB", account: "c1", occurrence: 1,
    },
    {
      date: "2024-12-15", description: "EXAMPLE SHOP BANGKOK", amount: -10000,
      currency: "THB", account: "c1", occurrence: 2,
    },
    {
      date: "2024-12-17", description: "PAYMENT RECEIVED", amount: 5000,
      currency: "THB", account: "c1", occurrence: 1,
    },
    {
      date: "2024-12-14", description: "EXTRA AMOUNT 40.00", amount: -2500,
      currency: "THB", account: "c1", occurrence: 1,
    },
  ],
  coverage: { from: "2024-12-14", to: "2025-01-05" },
  balances: [
    { currency: "THB", asOf: "2024-12-13", amount: -100000 },
    { currency: "THB", asOf: "2025-01-05", amount: -115000 },
  ],
};
