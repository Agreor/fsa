import test from "node:test";
import assert from "node:assert/strict";
import { pages as fixturePages, expected } from "./fixtures/s1-pages.mjs";
import { parse } from "../src/sources/s1.js";
import { validateParsed } from "../src/contracts.js";

const copy = () => structuredClone(fixturePages);
const lines = (pages) => pages.flatMap((page) => page.lines);
const reject = (pages, pattern) => {
  const result = parse(pages, { account: "a1" });
  assert.match(result.reason, pattern);
  assert.deepEqual(Object.keys(result), ["reason"]);
};
const setTotals = (pages, credits, debits) => {
  const all = lines(pages);
  const opening = all.findIndex((line) => line.text.includes("Ancien solde"));
  const closing = all.findIndex((line) => line.text.includes("Nouveau solde"));
  all[opening + 1].text = `${all[opening + 1].text.split(/\s+/)[0]} ${credits}`;
  all[closing + 1].text = `${all[closing + 1].text.split(/\s+/)[0]} ${debits}`;
};

test("parses the fixture into the contract outcome", () => {
  const result = parse(copy(), { account: "a1" });
  assert.deepEqual(result, expected);
  assert.deepEqual(validateParsed(result), []);
});

test("reads transactions after a repeated table header on page two", () => {
  const pages = copy();
  const page2 = pages[1];
  page2.lines.splice(-1, 0,
    { y: 598, items: [{ x: 64, text: "Date" }, { x: 117, text: "Description" }, { x: 531, text: "Montant (EUR)" }], text: "Date Description Montant (EUR)" },
    { y: 581, items: [{ x: 64, text: "20-01-2026" }, { x: 117, text: "Achat n° 000000201" }, { x: 384, text: "Shopping" }, { x: 531, text: "-50,00" }], text: "20-01-2026 Achat n° 000000201 Shopping -50,00" }, // pii-ok synthetic
    { y: 569, items: [{ x: 64, text: "20-01-2026" }, { x: 117, text: "Remboursement n° 000000202" }, { x: 384, text: "Autre" }, { x: 531, text: "+50,00" }], text: "20-01-2026 Remboursement n° 000000202 Autre +50,00" }, // pii-ok synthetic
  );
  setTotals(pages, "170,00", "-144,90");
  const result = parse(pages, { account: "a1" });
  assert.equal(result.rows.length, 6);
  assert.deepEqual(result.rows.slice(-2).map(({ date, amount, sourceId }) => ({ date, amount, sourceId })), [
    { date: "2026-01-20", amount: -5000, sourceId: "000000201" }, // pii-ok synthetic
    { date: "2026-01-20", amount: 5000, sourceId: "000000202" }, // pii-ok synthetic
  ]);
  assert.deepEqual(validateParsed(result), []);
  assert.deepEqual(result.balances, expected.balances);
});

test("rejects date-prefixed lines skipped before the table header, but parses them after it", () => {
  const transaction = (y, id, amount) => ({ y, items: [{ x: 64, text: "20-01-2026" }, { x: 117, text: `Achat n° ${id}` }, { x: 384, text: "Shopping" }, { x: 531, text: amount }], text: `20-01-2026 Achat n° ${id} Shopping ${amount}` });
  const header = { y: 598, items: [{ x: 64, text: "Date" }, { x: 117, text: "Description" }, { x: 531, text: "Montant (EUR)" }], text: "Date Description Montant (EUR)" };
  const pages = copy();
  pages[1].lines.splice(-1, 0, transaction(620, "000000201", "-50,00"), transaction(608, "000000202", "+50,00"), header); // pii-ok synthetic
  reject(pages, /page 2.*line/i);

  const accepted = copy();
  accepted[1].lines.splice(-1, 0, header, transaction(581, "000000201", "-50,00"), transaction(569, "000000202", "+50,00")); // pii-ok synthetic
  setTotals(accepted, "170,00", "-144,90");
  const result = parse(accepted, { account: "a1" });
  assert.equal(result.rows.length, 6);
  assert.deepEqual(result.balances, expected.balances);
  assert.deepEqual(validateParsed(result), []);
});

test("rejects a date-prefixed line on an information page and ignores non-prefix summaries", () => {
  const pages = copy();
  pages.splice(1, 0, { lines: [
    { y: 600, items: [{ x: 64, text: "20-01-2026" }, { x: 120, text: "Information" }], text: "20-01-2026 Information" },
  ] });
  reject(pages, /page 2.*line/i);

  const ordinary = copy();
  ordinary[1].lines.splice(-1, 0,
    { y: 620, items: [{ x: 64, text: "Résumé" }], text: "Résumé 20-01-2026" },
    { y: 619, items: [{ x: 64, text: "Date du prochain relevé 20-01-2026" }], text: "Date du prochain relevé 20-01-2026" },
  );
  assert.deepEqual(parse(ordinary, { account: "a1" }), expected);
});

test("does not silently drop page-two table lines without a repeated header", () => {
  const pages = copy();
  pages[1].lines.splice(-1, 0,
    { y: 581, items: [{ x: 64, text: "20-01-2026" }, { x: 117, text: "Achat n° 000000201" }, { x: 384, text: "Shopping" }, { x: 531, text: "-50,00" }], text: "20-01-2026 Achat n° 000000201 Shopping -50,00" }, // pii-ok synthetic
    { y: 569, items: [{ x: 64, text: "20-01-2026" }, { x: 117, text: "Remboursement n° 000000202" }, { x: 384, text: "Autre" }, { x: 531, text: "+50,00" }], text: "20-01-2026 Remboursement n° 000000202 Autre +50,00" }, // pii-ok synthetic
  );
  const result = parse(pages, { account: "a1" });
  assert.ok(result.reason || result.rows.length === 6, "page-two transactions were silently dropped");
});

test("split-date cancelling transactions are detected and checked against summary totals", () => {
  const pages = copy();
  const tx = (y, id, amount) => ({
    y,
    items: [{ x: 64, text: "2" }, { x: 70, text: "0-01-2026" }, { x: 117, text: `Achat n° ${id}` }, { x: 384, text: "Shopping" }, { x: 531, text: amount }],
    text: `2 0-01-2026 Achat n° ${id} Shopping ${amount}`,
  });
  pages[1].lines.splice(-1, 0, tx(581, "000000201", "-50,00"), tx(569, "000000202", "+50,00")); // pii-ok synthetic
  const result = parse(pages, { account: "a1" });
  assert.ok(result.reason || result.rows.length === 6, "split-date transactions were silently dropped");
});

test("rejects summary totals that include silently dropped transactions", () => {
  const pages = copy();
  pages[0].lines.find((line) => line.text.startsWith("345,67")).text = "345,67 170,00";
  pages[0].lines.find((line) => line.text.startsWith("370,77")).text = "370,77 -144,90";
  pages[1].lines.splice(-1, 0,
    { y: 581, items: [{ x: 64, text: "Achat n° 000000201" }, { x: 384, text: "Shopping" }, { x: 531, text: "-50,00" }], text: "Achat n° 000000201 Shopping -50,00" }, // pii-ok synthetic
    { y: 569, items: [{ x: 64, text: "Remboursement n° 000000202" }, { x: 384, text: "Autre" }, { x: 531, text: "+50,00" }], text: "Remboursement n° 000000202 Autre +50,00" }, // pii-ok synthetic
  );
  reject(pages, /credit.*5000|5000.*credit/i);
});

test("keeps low page-two transactions and rejects transaction-shaped footer lines", () => {
  const makeLines = (y1, y2) => {
    const pages = copy();
    pages[1].lines.splice(-1, 0,
      { y: y1, items: [{ x: 64, text: "20-01-2026" }, { x: 117, text: "Achat n° 000000201" }, { x: 384, text: "Shopping" }, { x: 531, text: "-50,00" }], text: "20-01-2026 Achat n° 000000201 Shopping -50,00" }, // pii-ok synthetic
      { y: y2, items: [{ x: 64, text: "20-01-2026" }, { x: 117, text: "Remboursement n° 000000202" }, { x: 384, text: "Autre" }, { x: 531, text: "+50,00" }], text: "20-01-2026 Remboursement n° 000000202 Autre +50,00" }, // pii-ok synthetic
    );
    if (y1 > 85) setTotals(pages, "170,00", "-144,90");
    return pages;
  };
  const table = parse(makeLines(149, 137), { account: "a1" });
  assert.equal(table.rows.length, 6);
  assert.deepEqual(table.balances, expected.balances);
  assert.deepEqual(validateParsed(table), []);

  const footer = parse(makeLines(60, 48), { account: "a1" });
  assert.match(footer.reason, /page 2.*line/i);
  assert.deepEqual(Object.keys(footer), ["reason"]);

  const ordinaryFooter = copy();
  ordinaryFooter[1].lines.splice(-1, 0,
    { y: 60, items: [{ x: 64, text: "Date de traitement 20-01-2026" }], text: "Date de traitement 20-01-2026" },
  );
  assert.deepEqual(parse(ordinaryFooter, { account: "a1" }), expected);
});

test("rejects split dates, unsupported footer money, and malformed balance tokens", () => {
  const split = copy();
  split[1].lines.splice(-1, 0,
    { y: 598, items: [{ x: 64, text: "Date" }, { x: 117, text: "Description" }, { x: 531, text: "Montant (EUR)" }], text: "Date Description Montant (EUR)" },
    { y: 581, items: [{ x: 64, text: "20-01-2026" }, { x: 117, text: "Achat n° 000000201" }, { x: 384, text: "Shopping" }, { x: 531, text: "-50,00" }], text: "20-01-2026 Achat n° 000000201 Shopping -50,00" }, // pii-ok synthetic
  );
  const tx = split[1].lines.at(-2);
  tx.items[0].text = "20-01-";
  tx.items.splice(1, 0, { x: 90, text: "2026" });
  tx.text = tx.items.map((item) => item.text).join(" ");
  const splitResult = parse(split, { account: "a1" });
  assert.ok(splitResult.reason || splitResult.rows.length === 6);

  const footer = copy();
  footer[1].lines.splice(-1, 0, ...["-1’000,00", "+1’000,00"].map((amount) => ({
    y: 60, items: [{ x: 64, text: "20-01-2026" }, { x: 117, text: "Footer transaction" }, { x: 531, text: amount }], text: `20-01-2026 Footer transaction ${amount}`,
  })));
  reject(footer, /page 2.*line/i);

  for (const label of ["Ancien solde", "Nouveau solde"]) {
    const pages = copy();
    const page = pages.find((page) => page.lines.some((line) => line.text.startsWith(label)));
    const index = page.lines.findIndex((line) => line.text.startsWith(label));
    const value = page.lines[index + 1];
    value.items[0].text = value.items[0].text.replace(/(?<=^|\s)(\d{3}),/, "1’$1,");
    value.text = value.items.map((item) => item.text).join(" ");
    reject(pages, /balance.*line/i);
  }
});

test("transaction mutations either preserve the four rows or reject", () => {
  const originals = lines(copy()).filter((line) => /^\d{2}-\d{2}-\d{4}$/.test(line.items?.[0]?.text ?? ""));
  for (const original of originals) {
    const mutations = [];
    for (let i = 1; i < original.items[0].text.length; i++) mutations.push((tx) => {
      const d = tx.items[0].text;
      tx.items[0].text = d.slice(0, i);
      tx.items.splice(1, 0, { x: tx.items[1].x - 1, text: d.slice(i) });
    });
    mutations.push(
      (tx, pages) => {
        const page = pages.find((candidate) => candidate.lines.includes(tx));
        const headerIndex = page.lines.findIndex((line) => /\bDate\b/.test(line.text) && /\bMontant/.test(line.text));
        page.lines.splice(page.lines.indexOf(tx), 1);
        tx.y = 620;
        page.lines.splice(headerIndex, 0, tx);
      },
      (tx) => { tx.items.at(-1).text = tx.items.at(-1).text.replace(",", "."); },
      (tx) => { tx.items.at(-1).text = tx.items.at(-1).text.replace(/(?=\d{3},)/, "’"); },
      (tx) => { const amount = tx.items.pop(); tx.items.unshift(amount); },
      (tx) => { tx.items.pop(); },
    );
    for (const mutate of mutations) {
      const pages = copy();
      const tx = lines(pages).find((line) => line.items?.[0]?.text === original.items[0].text);
      mutate(tx, pages);
      tx.items.sort((a, b) => a.x - b.x);
      tx.text = tx.items.map((item) => item.text).join(" ");
      const result = parse(pages, { account: "a1" });
      assert.ok(result.reason || result.rows.length === 4, `unexpected row count ${result.rows?.length}`);
    }
  }
});

test("rejects empty input and missing layout markers", () => {
  reject([], /input|page|line/i);
  const pages = copy();
  for (const line of lines(pages).filter((line) => line.text.includes("Extrait de compte"))) line.text = "Relevé";
  reject(pages, /Extrait de compte/i);
  for (const line of lines(pages)) line.text = line.text.replace("Relevé", "Extrait de compte");
  const header = lines(pages).find((line) => line.text.startsWith("Date Description"));
  header.text = "Date Description Débit Crédit";
  reject(pages, /Montant/i);
});

test("uses the declared currency and rightmost amount, and ignores footers", () => {
  const pages = copy();
  for (const line of lines(pages)) line.text = line.text.replace("Montant (EUR)", "Montant (USD)").replace("Ancien solde (EUR)", "Ancien solde (USD)").replace("Nouveau solde (EUR)", "Nouveau solde (USD)");
  const row = lines(pages).find((line) => line.items?.[0]?.text === "03-01-2026");
  row.items[1].x = 90;
  row.items[2].x = 200;
  row.items[3].x = 800;
  row.items.sort((a, b) => a.x - b.x);
  row.text = row.items.map((item) => item.text).join(" ");
  const result = parse(pages, { account: "a1" });
  assert.equal(result.rows[0].currency, "USD");
  assert.equal(result.rows[0].amount, 12000);
  assert.equal(result.rows[0].description.includes("Autre"), false);
});

test("parses decimal comma and grouped values without floating point", () => {
  const pages = copy();
  const tx = lines(pages).find((line) => line.items?.[0]?.text === "03-01-2026");
  tx.items.at(-1).text = "+1.234.567,89";
  tx.text = tx.items.map((item) => item.text).join(" ");
  reject(pages, /balance|closing|total/i);
  tx.items.at(-1).text = "+0,00";
  tx.text = tx.items.map((item) => item.text).join(" ");
  lines(pages).find((line) => line.text.startsWith("370,77")).text = "250,77 -94,90";
  lines(pages).find((line) => line.text.startsWith("345,67")).text = "345,67 0,00";
  const result = parse(pages, { account: "a1" });
  assert.equal(result.rows[0].amount, 0);
});

test("rejects invalid transaction dates, missing amounts, and balance mismatch", () => {
  for (const mutate of [
    (tx) => { tx.items[0].text = "31-02-2026"; tx.text = tx.items.map((item) => item.text).join(" "); },
    (tx) => { tx.items.pop(); tx.text = tx.items.map((item) => item.text).join(" "); },
  ]) {
    const pages = copy();
    mutate(lines(pages).find((line) => line.items?.[0]?.text === "03-01-2026"));
    reject(pages, /line|date|amount/i);
  }
  const pages = copy();
  lines(pages).find((line) => line.text.startsWith("370,77")).text = "371,77 -94,90";
  reject(pages, /balance|line/i);
  for (const label of ["Ancien solde", "Nouveau solde", "Du 01/01/2026 au 31/01/2026"]) {
    const missing = copy();
    for (const line of lines(missing).filter((item) => item.text.includes(label))) line.text = label.startsWith("Du") ? "Période inconnue" : "Solde non indiqué";
    reject(missing, /coverage|balance|line/i);
  }
});

test("returns a quiet month and numbers identical unreferenced rows", () => {
  const quiet = copy();
  quiet.forEach((page) => { page.lines = page.lines.filter((line) => !/^\d{2}-\d{2}-\d{4} /.test(line.text)); });
  lines(quiet).find((line) => line.text.startsWith("345,67")).text = "345,67 0,00";
  lines(quiet).find((line) => line.text.startsWith("370,77")).text = "345,67 0,00";
  setTotals(quiet, "0,00", "0,00");
  assert.deepEqual(parse(quiet, { account: "a1" }).rows, []);

  const repeated = copy();
  const transactions = lines(repeated).filter((line) => /^\d{2}-\d{2}-\d{4} /.test(line.text));
  for (const tx of transactions.slice(0, 2)) {
    tx.items[0].text = "03-01-2026";
    tx.items[1].text = "Courses";
    tx.items[2].text = "Groceries";
    tx.items[3].text = "120,00";
    tx.text = tx.items.map((item) => item.text).join(" ");
  }
  const between = repeated[0].lines;
  const firstIndex = between.indexOf(transactions[0]);
  const secondIndex = between.indexOf(transactions[1]);
  between.splice(firstIndex + 1, secondIndex - firstIndex - 1);
  const secondPage = repeated.find((page) => page.lines.includes(transactions[1]));
  const secondLineIndex = secondPage.lines.indexOf(transactions[1]);
  while (secondLineIndex + 1 < secondPage.lines.length && secondPage.lines[secondLineIndex + 1].y > 150 &&
    !/^\d{2}-\d{2}-\d{4} /.test(secondPage.lines[secondLineIndex + 1].text)) {
    secondPage.lines.splice(secondLineIndex + 1, 1);
  }
  lines(repeated).find((line) => line.text.startsWith("370,77")).text = "535,97 -49,70";
  setTotals(repeated, "240,00", "-49,70");
  const result = parse(repeated, { account: "a1" });
  assert.equal(result.rows[0].sourceId, undefined);
  assert.equal(result.rows[1].sourceId, undefined);
  assert.equal(result.rows[0].occurrence, 1);
  assert.equal(result.rows[1].occurrence, 2);
});
