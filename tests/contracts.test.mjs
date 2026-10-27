import test from "node:test";
import assert from "node:assert/strict";
import {
  PDF_ERRORS, validateRow, validateParsed, assignOccurrences, rowIdentity,
} from "../src/contracts.js";

const row = (over = {}) => ({
  date: "2026-01-05", description: "Shop A", amount: -1250, currency: "EUR", account: "a1", occurrence: 1, ...over,
});

test("a complete row has no problems", () => {
  assert.deepEqual(validateRow(row()), []);
});

test("optional fields are accepted when well formed", () => {
  assert.deepEqual(validateRow(row({ sourceId: "T-1", country: "BE", time: "13:45" })), []);
});

for (const [name, over] of [
  ["a bad date", { date: "05/01/2026" }],
  ["an impossible date", { date: "2026-13-40" }],
  ["an empty description", { description: "  " }],
  ["a fractional amount", { amount: 12.5 }],
  ["a non-number amount", { amount: "12" }],
  ["a lowercase currency", { currency: "eur" }],
  ["a missing account", { account: "" }],
  ["a zero occurrence", { occurrence: 0 }],
  ["a bad country", { country: "Belgium" }],
  ["a bad time", { time: "25:99" }],
]) {
  test(`rejects ${name}`, () => {
    assert.ok(validateRow(row(over)).length > 0);
  });
}

test("rejects a row that is not an object", () => {
  assert.ok(validateRow(null).length > 0);
  assert.ok(validateRow("x").length > 0);
});

test("identity uses the source id when there is one", () => {
  assert.equal(rowIdentity(row({ sourceId: "T-1" })), rowIdentity(row({ sourceId: "T-1", description: "Shop A changed" })));
  assert.notEqual(rowIdentity(row({ sourceId: "T-1" })), rowIdentity(row({ sourceId: "T-2" })));
});

test("identity without a source id depends on every value field and the occurrence", () => {
  const base = rowIdentity(row());
  for (const over of [{ date: "2026-01-06" }, { amount: -1251 }, { currency: "USD" }, { account: "a2" }, { description: "Shop B" }, { occurrence: 2 }]) {
    assert.notEqual(rowIdentity(row(over)), base);
  }
});

test("identity ignores case and repeated spaces in the description", () => {
  assert.equal(rowIdentity(row({ description: "Shop  A" })), rowIdentity(row({ description: "shop a" })));
});

test("the same source id in different accounts is a different row", () => {
  assert.notEqual(rowIdentity(row({ sourceId: "T-1", account: "a1" })), rowIdentity(row({ sourceId: "T-1", account: "a2" })));
});

test("assignOccurrences numbers identical rows within a file in order", () => {
  const rows = assignOccurrences([row({ occurrence: undefined }), row({ occurrence: undefined }), row({ description: "Other", occurrence: undefined })]);
  assert.deepEqual(rows.map((r) => r.occurrence), [1, 2, 1]);
  assert.equal(new Set(rows.map(rowIdentity)).size, 3);
});

test("assignOccurrences leaves rows with a source id at occurrence 1", () => {
  const rows = assignOccurrences([row({ sourceId: "T-1", occurrence: undefined }), row({ sourceId: "T-2", occurrence: undefined })]);
  assert.deepEqual(rows.map((r) => r.occurrence), [1, 1]);
});

test("assignOccurrences does not change its input", () => {
  const input = [row({ occurrence: undefined })];
  assignOccurrences(input);
  assert.equal(input[0].occurrence, undefined);
});

const parsed = (over = {}) => ({
  rows: [row()], coverage: { from: "2026-01-01", to: "2026-01-31" },
  balances: [{ currency: "EUR", asOf: "2026-01-31", amount: 10000 }], ...over,
});

test("a complete parse result has no problems", () => {
  assert.deepEqual(validateParsed(parsed()), []);
});

test("coverage and balances may be absent but must be well formed when present", () => {
  assert.deepEqual(validateParsed(parsed({ coverage: null, balances: [] })), []);
  assert.ok(validateParsed(parsed({ coverage: { from: "2026-02-01", to: "2026-01-01" } })).length > 0);
  assert.ok(validateParsed(parsed({ balances: [{ currency: "EUR", asOf: "x", amount: 1 }] })).length > 0);
  assert.ok(validateParsed(parsed({ balances: [{ currency: "EUR", asOf: "2026-01-31", amount: 1.5 }] })).length > 0);
});

test("a parse result with a bad row is invalid and names the row", () => {
  const problems = validateParsed(parsed({ rows: [row(), row({ amount: 1.5 })] }));
  assert.ok(problems.some((p) => p.includes("row 2")));
});

test("a parse result must have a rows array", () => {
  assert.ok(validateParsed({}).length > 0);
  assert.ok(validateParsed(null).length > 0);
});

test("a rejection is a valid parser outcome and an empty rows array is not a rejection", () => {
  assert.deepEqual(validateParsed({ reason: "wrong columns" }), []);
  assert.ok(validateParsed({ reason: "" }).length > 0);
  assert.deepEqual(validateParsed(parsed({ rows: [] })), []);
});

test("the reader error codes are the agreed set", () => {
  assert.deepEqual([...PDF_ERRORS].sort(), ["no_text", "password_needed", "unreadable", "wrong_password"]);
});
