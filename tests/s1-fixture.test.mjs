import test from "node:test";
import assert from "node:assert/strict";
import { pages, expected } from "./fixtures/s1-pages.mjs";
import { validateParsed, validatePages } from "../src/contracts.js";

test("fixture pages have the reader shape: ordered lines with a descending y", () => {
  assert.ok(pages.length >= 2);
  for (const page of pages) {
    assert.ok(page.lines.length > 5);
    const ys = page.lines.map((l) => l.y);
    assert.deepEqual([...ys].sort((a, b) => b - a), ys);
    for (const line of page.lines) assert.equal(typeof line.text, "string");
  }
});

test("the expected parse result is valid", () => {
  assert.deepEqual(validateParsed(expected), []);
});

test("expected rows include two identical genuine charges and one source id each", () => {
  const same = expected.rows.filter((r) => r.description.includes("Shop Alpha"));
  assert.equal(same.length, 2);
  assert.equal(same[0].amount, same[1].amount);
  assert.ok(expected.rows.every((r) => r.sourceId));
});

test("opening balance plus the rows equals the closing balance", () => {
  const [open, close] = expected.balances;
  assert.equal(open.currency, "EUR");
  assert.equal(open.amount + expected.rows.reduce((sum, r) => sum + r.amount, 0), close.amount);
  assert.ok(open.asOf < close.asOf);
});

test("every transaction line in the pages appears once in the expected rows", () => {
  const dated = pages.flatMap((p) => p.lines).filter((l) => /^\d{2}-\d{2}-\d{4} /.test(l.text));
  assert.equal(dated.length, expected.rows.length);
});

test("the fixture contains no real-looking identifiers", () => {
  const text = JSON.stringify(pages);
  assert.ok(!/\b[A-Z]{2}\d{2}(?: ?\d{4}){3}\b/.test(text.replaceAll("BE00 0000 0000 0000", ""))); // pii-ok: all-zero placeholder
});

test("fixture pages pass the shared page validation, items included", () => {
  assert.deepEqual(validatePages(pages), []);
});

test("transaction lines keep four columns with the amount furthest right", () => {
  const dated = pages.flatMap((p) => p.lines).filter((l) => /^\d{2}-\d{2}-\d{4}$/.test(l.items[0].text));
  assert.equal(dated.length, expected.rows.length);
  for (const l of dated) {
    assert.equal(l.items.length, 4);
    assert.ok(l.items[3].x > l.items[2].x && l.items[2].x > l.items[1].x);
  }
});
